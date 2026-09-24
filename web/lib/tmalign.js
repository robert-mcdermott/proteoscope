// Structure-only alignment: TM-align for two chains (Zhang & Skolnick 2005, Nucleic Acids Res
// 33:2302, doi:10.1093/nar/gki524) and a complex mode after MM-align (Mukherjee & Zhang 2009,
// Nucleic Acids Res 37:e83, doi:10.1093/nar/gkp318) as extended to nucleic acids by US-align (Zhang
// et al. 2022, Nat Methods 19:1109, doi:10.1038/s41592-022-01585-1).
//
// TM-align looks for the residue correspondence and superposition that maximize the TM-score,
// Σ 1/(1 + (d/d0)²) over aligned pairs divided by a chain length. Five kinds of initial alignment —
// gapless threading, secondary structure, superposition of short fragments, secondary structure
// plus the best superposition so far, and threading of the longest continuous fragment — are each
// improved by alternating a superposition search on the current pairs with dynamic programming on
// the superposed distances (gap opening −0.6, then 0; extending a gap is free). The superposition
// search is the TM-score heuristic: least-squares fits on fragments of the aligned pairs (all of
// them, half, a quarter … down to 4) seed refits on the pairs closer than d0_search + 1 Å.
//
// Parameters follow US-align. While searching, d0 = d0(Lmin) + 0.8 Å with d0(L) = 1.24·∛(L − 15) −
// 1.8 Å (0.168 Å below 20 residues), d0_search is that clamped to 4.5–8 Å, and pairs farther apart
// than d8 = 1.5·Lmin^0.3 + 3.5 Å count for nothing and are dropped from the final alignment. Final
// TM-scores use d0 of the normalizing length: d0(L), at least 0.5 Å, for proteins, and 0.6·√(L −
// 0.5) − 2.5 Å (0.3–0.7 Å below 30 nucleotides) for nucleic acids, whose chains are represented
// by C3′ atoms. Secondary structure comes from Cα–Cα distances within five residues (helix,
// strand, turn, coil) or, for RNA and DNA, from base pairs: complementary bases (G·U included)
// whose C3′ atoms are 12.5–15 Å apart, in stacks of at least two. A protein chain aligned to a
// nucleic acid is scored as nucleic acid when nucleotides outnumber residues. Chains above 1500
// residues use the fast settings (sparser seeds, two refinement rounds).
//
// Complexes: each mobile chain is aligned to each reference chain of the same molecule type, and
// chains are assigned greedily by TM-score normalized by the smaller complex, refined for oligomers
// by how well the chain centroids superpose. Then the complex is superposed on all assigned pairs,
// every chain pair is realigned on the superposed coordinates and the assignment is redone, while
// the summed score improves; a last pass aligns the assigned chains as one pseudo-chain with the
// dynamic programming confined to the assigned chain pairs. Final scores are normalized by the
// total length of each complex.

const DIAG = 1;
const LEFT = 2;
const UP = 3;
const GAP_OPEN = [-0.6, 0];
const MATCH_CUTOFF = 5;
const FAST_LENGTH = 1500;
// Consecutive atoms closer than this belong to one continuous fragment (US-align's dcu0).
const RUN_CUTOFF = 4.25;

/* ---------- Public API ---------- */

// chains: { coords (x0, y0, z0, x1, …; one atom per residue, Cα or C3′), sequence (one letter per
// residue), kind: 'protein' | 'nucleic' }. Superposes `mobile` onto `reference` and returns the
// aligned residue pairs [mobile, reference] with their distances after superposition, the
// transform (p′ = R·p + t on mobile coordinates), TM-score and d0 for either normalization, RMSD,
// aligned length, identity and the three alignment rows (':' for pairs closer than 5 Å).
// options.fast selects the sparser search (by default for chains above 1500 residues).
export function tmAlign(mobile, reference, options = {}) {
  const x = prepareChain(mobile);
  const y = prepareChain(reference);
  if (x.length < 3 || y.length < 3) throw new RangeError('TM-align needs chains of at least 3 residues');
  const fast = options.fast ?? Math.min(x.length, y.length) > FAST_LENGTH;
  return describe(x, y, alignChains(x, y, { fast }));
}

// Mobile and reference complexes: arrays of { id, coords, sequence, kind }; chains shorter than 3
// residues are ignored. chainPairs lists the assigned chains in mobile order with their residue
// pairs, distances after the complex superposition and TM-scores normalized by each chain; the
// complex scores are normalized by the total length of either complex. options.fast as for
// tmAlign (by default above 500 residues in the smaller complex, as in US-align).
export function mmAlign(mobileChains, referenceChains, options = {}) {
  const xs = mobileChains.map(prepareChain).filter((chain) => chain.length >= 3);
  const ys = referenceChains.map(prepareChain).filter((chain) => chain.length >= 3);
  if (!xs.length || !ys.length) throw new RangeError('MM-align needs a chain of at least 3 residues on each side');
  if (xs.length === 1 && ys.length === 1) return monomerComplex(xs[0], ys[0], options);
  const ctx = complexContext(xs, ys, options);
  const state = assignChains(ctx);
  if (!state) throw new RangeError('No chains of the same molecule type to align');
  return describeComplex(ctx, state);
}

/* ---------- Chains ---------- */

function prepareChain(chain) {
  const coords = chain.coords instanceof Float64Array ? chain.coords : Float64Array.from(chain.coords ?? []);
  // A missing coordinate would stall the superposition search, which relaxes its distance cutoff
  // until enough pairs fall inside it.
  if (!coords.every(Number.isFinite)) throw new RangeError(`Chain ${chain.id ?? ''} has coordinates that are not numbers`);
  const length = Math.floor(coords.length / 3);
  const kind = chain.kind === 'nucleic' ? 'nucleic' : 'protein';
  const sequence = String(chain.sequence ?? '').slice(0, length).padEnd(length, 'X');
  const upper = sequence.toUpperCase();
  const letters = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) letters[index] = upper.charCodeAt(index);
  const sec = kind === 'nucleic' ? rnaSecondary(coords, letters, length) : proteinSecondary(coords, length);
  // US-align's molecule type: positive for nucleotides, negative for residues, summed over a pair.
  return { id: chain.id, coords, length, kind, sequence, letters, sec, molecule: kind === 'nucleic' ? length : -length };
}

// Ideal Cα distances (Å) between residues i−2 … i+2 — d(i−2, i+2), d(i−2, i+1), d(i−1, i+2), then
// the three i, i+2 spacings — and the tolerance for a helix and a strand.
const HELIX = { spans: [6.37, 5.18, 5.18, 5.45, 5.45, 5.45], tolerance: 2.1 };
const STRAND = { spans: [13, 10.4, 10.4, 6.1, 6.1, 6.1], tolerance: 1.42 };

// Helix (H), strand (E), turn (T) or coil (C) from the Cα distances between residues i−2 … i+2.
function proteinSecondary(x, length) {
  const sec = new Uint8Array(length).fill(67);
  const distance = (a, b) => Math.hypot(x[a * 3] - x[b * 3], x[a * 3 + 1] - x[b * 3 + 1], x[a * 3 + 2] - x[b * 3 + 2]);
  const fits = (spans, ideal) => spans.every((value, k) => Math.abs(value - ideal.spans[k]) < ideal.tolerance);
  for (let i = 2; i + 2 < length; i += 1) {
    const spans = [distance(i - 2, i + 2), distance(i - 2, i + 1), distance(i - 1, i + 2), distance(i - 2, i), distance(i - 1, i + 1), distance(i, i + 2)];
    if (fits(spans, HELIX)) sec[i] = 72;
    else if (fits(spans, STRAND)) sec[i] = 69;
    else if (spans[0] < 8) sec[i] = 84;
  }
  return sec;
}

// RNA: '<' and '>' mark the two strands of stacked base pairs, '.' the rest.
function rnaSecondary(x, letters, length) {
  const sec = new Uint8Array(length).fill(46);
  const paired = new Uint8Array(length * length);
  for (let i = 0; i < length; i += 1) {
    for (let j = i + 1; j < length; j += 1) {
      if (!canPair(letters[i], letters[j])) continue;
      const d = Math.hypot(x[i * 3] - x[j * 3], x[i * 3 + 1] - x[j * 3 + 1], x[i * 3 + 2] - x[j * 3 + 2]);
      if (d > 12.5 && d < 15) paired[i * length + j] = paired[j * length + i] = 1;
    }
  }
  const pairedAt = (i, j) => paired[i * length + j] === 1;
  for (let i = 0; i < length - 2; i += 1) {
    for (let j = i + 3; j < length; j += 1) {
      // Only the outer pair of a stack of at least two starts a helix.
      if (!pairedAt(i, j) || (i > 0 && j + 1 < length && pairedAt(i - 1, j + 1)) || !pairedAt(i + 1, j - 1)) continue;
      let depth = 0;
      while (i + depth < length - 3 && j - depth > 0 && i + depth < j - depth && pairedAt(i + depth, j - depth)) depth += 1;
      for (let k = 0; k < depth; k += 1) {
        sec[i + k] = 60;
        sec[j - depth + 1 + k] = 62;
      }
    }
  }
  return sec;
}

// Watson–Crick and G·U pairs, indexed by the two upper-case letter codes.
const PAIRING = (() => {
  const table = new Uint8Array(128 * 128);
  for (const pair of ['AU', 'UA', 'AT', 'TA', 'GC', 'CG', 'GU', 'UG']) table[pair.charCodeAt(0) * 128 + pair.charCodeAt(1)] = 1;
  return table;
})();

function canPair(a, b) {
  return a < 128 && b < 128 && PAIRING[a * 128 + b] === 1;
}

/* ---------- Parameters ---------- */

function d0Of(length, nucleic) {
  if (nucleic) {
    if (length <= 11) return 0.3;
    if (length <= 15) return 0.4;
    if (length <= 19) return 0.5;
    if (length <= 23) return 0.6;
    if (length < 30) return 0.7;
    return 0.6 * Math.sqrt(length - 0.5) - 2.5;
  }
  if (length <= 21) return 0.5;
  return Math.max(0.5, 1.24 * Math.pow(length - 15, 1 / 3) - 1.8);
}

function clampSearch(d0) {
  return Math.min(8, Math.max(4.5, d0));
}

// Search settings for two chains (US-align's parameter_set4search).
function searchParameters(xlen, ylen) {
  const lnorm = Math.min(xlen, ylen);
  const d0 = (lnorm <= 19 ? 0.168 : 1.24 * Math.pow(lnorm - 15, 1 / 3) - 1.8) + 0.8;
  return {
    lnorm,
    d0,
    d0Search: clampSearch(d0),
    scoreD8: 1.5 * Math.pow(lnorm, 0.3) + 3.5,
    // Seeds are refined only when they score above this fraction of the best so far.
    ddcc: lnorm <= 40 ? 0.1 : 0.4,
  };
}

// Scoring of a superposition search: during the search pairs beyond d8 are ignored; final scores
// count every pair.
function searchScoring(params) {
  return { d0: params.d0, d0Search: params.d0Search, norm: params.lnorm, cutoff2: params.scoreD8 * params.scoreD8 };
}

function finalScoring(length, nucleic) {
  const d0 = d0Of(length, nucleic);
  return { d0, d0Search: clampSearch(d0), norm: length, cutoff2: Infinity };
}

/* ---------- Workspace ---------- */

// Buffers for aligning chains of up to xlen × ylen residues; `dp` false leaves out the dynamic
// programming matrices when only superpositions are needed. sizeWorkspace() reuses and grows them.
function createWorkspace(xlen, ylen, dp = true) {
  const ws = {
    trace: new Uint8Array(0),
    prev: new Float64Array(0),
    cur: new Float64Array(0),
    score: new Float64Array(0),
    r1: new Float64Array(0),
    r2: new Float64Array(0),
    xtm: new Float64Array(0),
    ytm: new Float64Array(0),
    dist2: new Float64Array(0),
    sel: new Int32Array(0),
    selPrev: new Int32Array(0),
    best: new Int32Array(0),
    trial: new Int32Array(0),
    work: new Int32Array(0),
    fit: new Float64Array(12),
    fitTry: new Float64Array(12),
    lastScore: 0,
    unchanged: false,
  };
  return sizeWorkspace(ws, xlen, ylen, dp);
}

function sizeWorkspace(ws, xlen, ylen, dp = true) {
  ws.xlen = xlen;
  ws.ylen = ylen;
  ws.cols = ylen + 1;
  if (dp && ws.trace.length < (xlen + 1) * (ylen + 1)) ws.trace = new Uint8Array((xlen + 1) * (ylen + 1));
  if (dp && ws.prev.length < ylen + 1) {
    ws.prev = new Float64Array(ylen + 1);
    ws.cur = new Float64Array(ylen + 1);
    ws.score = new Float64Array(ylen + 1);
  }
  const pairs = Math.max(1, Math.min(xlen, ylen));
  if (ws.dist2.length < pairs) {
    for (const key of ['r1', 'r2', 'xtm', 'ytm']) ws[key] = new Float64Array(pairs * 3);
    ws.dist2 = new Float64Array(pairs);
    ws.sel = new Int32Array(pairs);
    ws.selPrev = new Int32Array(pairs);
  }
  if (ws.best.length < ylen) for (const key of ['best', 'trial', 'work']) ws[key] = new Int32Array(ylen);
  return ws;
}

/* ---------- Alignment search ---------- */

// TM-align of two prepared chains; `extra` asks for one more normalization length (see
// finalizeAlignment). A workspace passed in is grown as needed and reused.
function alignChains(x, y, { fast = false, extra = null, workspace = null } = {}) {
  const ws = workspace ? sizeWorkspace(workspace, x.length, y.length) : createWorkspace(x.length, y.length);
  const params = searchParameters(x.length, y.length);
  const map = searchAlignment(ws, x, y, params, { fast });
  return finalizeAlignment(ws, x, y, map, params, { nucleic: x.molecule + y.molecule > 0, fast, extra });
}

// Returns the best residue map found (reference index → mobile index or −1), in ws.best.
function searchAlignment(ws, x, y, params, options = {}) {
  const { fast = false, blocks = null, seed = null } = options;
  const { best, trial, fit } = ws;
  best.fill(-1);
  let top = -1;
  const keep = (score) => {
    if (score > top) {
      top = score;
      best.set(trial);
    }
  };
  const rounds = fast ? 2 : 30;

  gaplessThreading(ws, x.coords, y.coords, params, fast, best);
  top = Math.max(top, detailedSearch(ws, x.coords, y.coords, best, params, 40, fit));
  keep(refine(ws, x.coords, y.coords, params, fit, trial, 0, 2, rounds, blocks));

  dpSecondary(ws, x.sec, y.sec, -1, trial, blocks);
  let score = detailedSearch(ws, x.coords, y.coords, trial, params, 40, fit);
  keep(score);
  if (score > top * 0.2) keep(refine(ws, x.coords, y.coords, params, fit, trial, 0, 2, rounds, blocks));

  if (fragmentSuperpositionSeed(ws, x.coords, y.coords, params, fast, trial, blocks)) {
    score = detailedSearch(ws, x.coords, y.coords, trial, params, 40, fit);
    keep(score);
    if (score > top * params.ddcc) keep(refine(ws, x.coords, y.coords, params, fit, trial, 0, 2, 2, blocks));
  }

  secondaryPlusSuperpositionSeed(ws, x, y, params, best, trial, blocks);
  score = detailedSearch(ws, x.coords, y.coords, trial, params, 40, fit);
  keep(score);
  if (score > top * params.ddcc) keep(refine(ws, x.coords, y.coords, params, fit, trial, 0, 2, rounds, blocks));

  fragmentThreading(ws, x.coords, y.coords, params, fast, trial);
  score = detailedSearch(ws, x.coords, y.coords, trial, params, 40, fit);
  keep(score);
  if (score > top * params.ddcc) keep(refine(ws, x.coords, y.coords, params, fit, trial, 1, 2, 2, blocks));

  if (seed) {
    trial.set(seed);
    keep(detailedSearch(ws, x.coords, y.coords, trial, params, 40, fit));
    keep(refine(ws, x.coords, y.coords, params, fit, trial, 0, 2, rounds, blocks));
  }
  return best;
}

// Superposition search on the pairs of a residue map; leaves the best transform in `fit`.
function detailedSearch(ws, x, y, map, params, step, fit) {
  const count = gatherPairs(ws, x, y, map);
  return superpositionSearch(ws, count, searchScoring(params), step, fit);
}

// Alternates dynamic programming on the superposed distances with the superposition search, for
// each gap opening penalty in GAP_OPEN[first … end − 1], until the score stops changing. The best
// map goes to `out`; `fit` carries the superposition from round to round.
function refine(ws, x, y, params, fit, out, first, end, rounds, blocks) {
  const work = ws.work;
  const d02 = params.d0 * params.d0;
  const scoring = searchScoring(params);
  let best = -1;
  let previous = 0;
  for (let g = first; g < end; g += 1) {
    for (let round = 0; round < rounds; round += 1) {
      dpDistance(ws, x, y, fit, d02, GAP_OPEN[g], work, blocks);
      const count = gatherPairs(ws, x, y, work);
      const score = superpositionSearch(ws, count, scoring, 40, fit);
      if (score > best) {
        best = score;
        out.set(work);
      }
      if (round > 0 && Math.abs(previous - score) < 1e-6) break;
      previous = score;
    }
  }
  return best;
}

/* ---------- Initial alignments ---------- */

// Every ungapped register with at least half of the shorter chain aligned, scored quickly.
function gaplessThreading(ws, x, y, params, fast, out) {
  const { xlen, ylen } = ws;
  const minimum = Math.max(5, Math.floor(Math.min(xlen, ylen) / 2));
  let best = -1;
  let bestShift = minimum - ylen;
  for (let shift = minimum - ylen; shift <= xlen - minimum; shift += fast ? 5 : 1) {
    const count = gatherShift(ws, x, y, shift);
    const score = quickScore(ws, count, params);
    if (score >= best) {
      best = score;
      bestShift = shift;
    }
  }
  for (let j = 0; j < ylen; j += 1) {
    const i = j + bestShift;
    out[j] = i >= 0 && i < xlen ? i : -1;
  }
  return best;
}

// Superposes pairs of short fragments (up to 20 and 100 residues) and aligns the whole chains on
// each superposition, keeping the alignment that scores best.
function fragmentSuperpositionSeed(ws, x, y, params, fast, out, blocks) {
  const { xlen, ylen, r1, r2, fitTry, work } = ws;
  const d02 = (params.d0 + 1.5) ** 2;
  const shortest = Math.min(xlen, ylen);
  const jump = (length) => Math.min(length > 250 ? 45 : length > 200 ? 35 : length > 150 ? 25 : 15, Math.floor(length / 3)) * (fast ? 5 : 1);
  const jumpX = jump(xlen);
  const jumpY = jump(ylen);
  let best = 0;
  let found = false;
  for (const fragment of [Math.min(20, Math.floor(shortest / 3)), Math.min(100, Math.floor(shortest / 2))]) {
    for (let i = 0; i < xlen - fragment + 1; i += jumpX) {
      for (let j = 0; j < ylen - fragment + 1; j += jumpY) {
        copyPoints(x, i, r1, fragment);
        copyPoints(y, j, r2, fragment);
        kabsch(r1, r2, fragment, fitTry);
        dpDistance(ws, x, y, fitTry, d02, 0, work, blocks);
        const score = quickScore(ws, gatherPairs(ws, x, y, work), params);
        if (score > best) {
          best = score;
          out.set(work);
          found = true;
        }
      }
    }
  }
  return found;
}

// Alignment on secondary structure agreement plus distances after superposing the pairs of the
// best alignment so far.
function secondaryPlusSuperpositionSeed(ws, x, y, params, map, out, blocks) {
  const count = gatherPairs(ws, x.coords, y.coords, map);
  kabsch(ws.xtm, ws.ytm, count, ws.fitTry);
  dpDistanceSecondary(ws, x, y, ws.fitTry, (params.d0 + 1.5) ** 2, -1, out, blocks);
}

// Gapless threading of the longest run of consecutive residues (neighbors closer than 4.25 Å,
// relaxed until the run covers a third of the chain or 4 residues) against the other chain.
function fragmentThreading(ws, x, y, params, fast, out) {
  const { xlen, ylen } = ws;
  const minFragment = fast ? 8 : 4;
  const [xs, xe] = longestRun(x, xlen, RUN_CUTOFF, minFragment);
  const [ys, ye] = longestRun(y, ylen, RUN_CUTOFF, minFragment);
  const lx = xe - xs + 1;
  const ly = ye - ys + 1;
  if (lx === ly && xlen === ylen) {
    // Symmetric case: thread both runs and keep the better.
    const best = threadMobileRun(ws, x, y, params, trimRun(xs, lx, xlen), fast ? 3 : 1, minFragment, out, -1);
    return threadReferenceRun(ws, x, y, params, trimRun(ys, ly, xlen), minFragment, out, best);
  }
  const shortest = Math.min(xlen, ylen);
  const runLength = Math.min(lx, ly);
  if (lx < ly || (lx === ly && xlen < ylen)) return threadMobileRun(ws, x, y, params, trimRun(xs, runLength, shortest), fast ? 3 : 1, minFragment, out, -1);
  return threadReferenceRun(ws, x, y, params, trimRun(ys, runLength, shortest), minFragment, out, -1);
}

// A run spanning the whole (shorter) chain is trimmed to its middle 80%.
function trimRun(start, length, whole) {
  if (length !== whole) return { start, length };
  const first = Math.floor(whole * 0.1);
  const last = Math.floor(whole * 0.89);
  return { start: start + first, length: last - first + 1 };
}

// Mobile run position j + shift faces reference residue j.
function threadMobileRun(ws, x, y, params, run, step, minFragment, out, best) {
  const { ylen, work } = ws;
  const minimum = Math.max(minFragment - 1, Math.floor(Math.min(run.length, ylen) / 2.5));
  for (let shift = minimum - ylen; shift <= run.length - minimum; shift += step) {
    for (let j = 0; j < ylen; j += 1) {
      const k = j + shift;
      work[j] = k >= 0 && k < run.length ? run.start + k : -1;
    }
    const score = quickScore(ws, gatherPairs(ws, x, y, work), params);
    if (score >= best) {
      best = score;
      out.set(work);
    }
  }
  return best;
}

// Reference run position k faces mobile residue k + shift.
function threadReferenceRun(ws, x, y, params, run, minFragment, out, best) {
  const { xlen, work } = ws;
  const minimum = Math.max(minFragment - 1, Math.floor(Math.min(xlen, run.length) / 2.5));
  for (let shift = minimum - run.length; shift <= xlen - minimum; shift += 1) {
    work.fill(-1);
    for (let k = 0; k < run.length; k += 1) {
      const i = k + shift;
      if (i >= 0 && i < xlen) work[run.start + k] = i;
    }
    const score = quickScore(ws, gatherPairs(ws, x, y, work), params);
    if (score >= best) {
      best = score;
      out.set(work);
    }
  }
  return best;
}

// First and last index of the longest stretch whose consecutive atoms are closer than `cutoff`
// (raised by 10% steps until the stretch reaches min(minFragment, length / 3) residues).
function longestRun(x, length, cutoff, minFragment) {
  const needed = Math.min(minFragment, Math.floor(length / 3));
  let limit = cutoff * cutoff;
  let longest = 0;
  let bestStart = 0;
  let bestEnd = 0;
  for (let raise = 1; longest < needed; raise += 1) {
    longest = 0;
    let run = 1;
    let start = 0;
    for (let i = 1; i < length; i += 1) {
      const dx = x[i * 3 - 3] - x[i * 3];
      const dy = x[i * 3 - 2] - x[i * 3 + 1];
      const dz = x[i * 3 - 1] - x[i * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < limit) {
        run += 1;
        if (i === length - 1) {
          if (run > longest) {
            longest = run;
            bestStart = start;
            bestEnd = i;
          }
          run = 1;
        }
      } else {
        if (run > longest) {
          longest = run;
          bestStart = start;
          bestEnd = i - 1;
        }
        run = 1;
        start = i;
      }
    }
    const relaxed = Math.pow(1.1, raise) * cutoff;
    limit = relaxed * relaxed;
  }
  return [bestStart, bestEnd];
}

/* ---------- Scores for a fixed residue map ---------- */

// Copies the aligned pairs of a map into ws.xtm / ws.ytm in reference order; returns their number.
function gatherPairs(ws, x, y, map) {
  const { xtm, ytm, ylen } = ws;
  let count = 0;
  for (let j = 0; j < ylen; j += 1) {
    const i = map[j];
    if (i < 0) continue;
    const a = count * 3;
    xtm[a] = x[i * 3];
    xtm[a + 1] = x[i * 3 + 1];
    xtm[a + 2] = x[i * 3 + 2];
    ytm[a] = y[j * 3];
    ytm[a + 1] = y[j * 3 + 1];
    ytm[a + 2] = y[j * 3 + 2];
    count += 1;
  }
  return count;
}

function gatherShift(ws, x, y, shift) {
  const { xlen, ylen, xtm, ytm } = ws;
  const first = Math.max(0, -shift);
  const end = Math.min(ylen, xlen - shift);
  let count = 0;
  for (let j = first; j < end; j += 1) {
    const i = j + shift;
    const a = count * 3;
    xtm[a] = x[i * 3];
    xtm[a + 1] = x[i * 3 + 1];
    xtm[a + 2] = x[i * 3 + 2];
    ytm[a] = y[j * 3];
    ytm[a + 1] = y[j * 3 + 1];
    ytm[a + 2] = y[j * 3 + 2];
    count += 1;
  }
  return count;
}

// A quick estimate of the TM-score of the gathered pairs: fit all of them, then refit twice on the
// pairs within d0_search (at least three).
function quickScore(ws, count, params) {
  const { xtm, ytm, r1, r2, dist2, fitTry } = ws;
  const d02 = params.d0 * params.d0;
  const search2 = params.d0Search * params.d0Search;
  kabsch(xtm, ytm, count, fitTry);
  let score = scoreFit(ws, count, fitTry, d02, true);
  let chosen = selectWithin(ws, count, Math.max(search2, thirdSmallest(dist2, count)));
  if (chosen === count) return score;
  kabsch(r1, r2, chosen, fitTry);
  const second = scoreFit(ws, count, fitTry, d02, true);
  chosen = selectWithin(ws, count, Math.max(search2 + 1, thirdSmallest(dist2, count)));
  kabsch(r1, r2, chosen, fitTry);
  const third = scoreFit(ws, count, fitTry, d02, false);
  if (second >= score) score = second;
  if (third >= score) score = third;
  return score;
}

// Σ 1/(1 + d²/d0²) over the gathered pairs; keeps the squared distances when asked.
function scoreFit(ws, count, fit, d02, keepDistances) {
  const { xtm, ytm, dist2 } = ws;
  const u0 = fit[0];
  const u1 = fit[1];
  const u2 = fit[2];
  const u3 = fit[3];
  const u4 = fit[4];
  const u5 = fit[5];
  const u6 = fit[6];
  const u7 = fit[7];
  const u8 = fit[8];
  const t0 = fit[9];
  const t1 = fit[10];
  const t2 = fit[11];
  let sum = 0;
  for (let k = 0; k < count; k += 1) {
    const a = k * 3;
    const px = xtm[a];
    const py = xtm[a + 1];
    const pz = xtm[a + 2];
    const dx = t0 + u0 * px + u1 * py + u2 * pz - ytm[a];
    const dy = t1 + u3 * px + u4 * py + u5 * pz - ytm[a + 1];
    const dz = t2 + u6 * px + u7 * py + u8 * pz - ytm[a + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (keepDistances) dist2[k] = d2;
    sum += 1 / (1 + d2 / d02);
  }
  return sum;
}

// Copies pairs with d² ≤ limit into r1 / r2, relaxing the limit by 0.5 Å² until three are chosen.
function selectWithin(ws, count, limit) {
  const { xtm, ytm, r1, r2, dist2 } = ws;
  for (;;) {
    let chosen = 0;
    for (let k = 0; k < count; k += 1) {
      if (dist2[k] > limit) continue;
      const a = k * 3;
      const b = chosen * 3;
      r1[b] = xtm[a];
      r1[b + 1] = xtm[a + 1];
      r1[b + 2] = xtm[a + 2];
      r2[b] = ytm[a];
      r2[b + 1] = ytm[a + 1];
      r2[b + 2] = ytm[a + 2];
      chosen += 1;
    }
    if (chosen >= 3 || count <= 3) return chosen;
    limit += 0.5;
  }
}

function thirdSmallest(values, count) {
  let a = Infinity;
  let b = Infinity;
  let c = Infinity;
  for (let k = 0; k < count; k += 1) {
    const value = values[k];
    if (value < c) {
      if (value < b) {
        c = b;
        if (value < a) {
          b = a;
          a = value;
        } else b = value;
      } else c = value;
    }
  }
  // With fewer than three pairs, all of them are taken.
  if (count >= 3) return c;
  return count === 2 ? b : count === 1 ? a : 0;
}

// The TM-score superposition search on the gathered pairs: fits on fragments of length n, n/2 …
// (starting every `step` pairs) seed refits on the pairs within d0_search + 1 Å, at most 20 times.
// Returns the best score (normalized by scoring.norm) and leaves its transform in `out`.
function superpositionSearch(ws, count, scoring, step, out) {
  const { xtm, ytm, fitTry } = ws;
  const d02 = scoring.d0 * scoring.d0;
  let chosenSet = ws.sel;
  let usedSet = ws.selPrev;
  let best = -1;
  for (const length of fragmentLengths(count)) {
    const last = count - length;
    for (let start = 0; ; ) {
      for (let k = 0; k < length; k += 1) chosenSet[k] = start + k;
      kabsch(xtm, ytm, length, fitTry, false, chosenSet);
      let chosen = scoreAndSelect(ws, count, fitTry, d02, scoring, scoring.d0Search - 1, chosenSet, null, 0);
      if (ws.lastScore > best) {
        best = ws.lastScore;
        out.set(fitTry);
      }
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const used = chosen;
        kabsch(xtm, ytm, used, fitTry, false, chosenSet);
        const swap = usedSet;
        usedSet = chosenSet;
        chosenSet = swap;
        chosen = scoreAndSelect(ws, count, fitTry, d02, scoring, scoring.d0Search + 1, chosenSet, usedSet, used);
        if (ws.lastScore > best) {
          best = ws.lastScore;
          out.set(fitTry);
        }
        if (ws.unchanged) break;
      }
      if (start >= last) break;
      start = Math.min(start + step, last);
    }
  }
  return best;
}

function copyPoints(source, first, target, count) {
  for (let k = 0, a = first * 3, end = count * 3; k < end; k += 1) target[k] = source[a + k];
}

function fragmentLengths(count) {
  const minimum = Math.min(4, count);
  const lengths = [];
  for (let level = 0; level < 5; level += 1) {
    const length = Math.floor(count / 2 ** level);
    if (length <= minimum) {
      lengths.push(minimum);
      return lengths;
    }
    lengths.push(length);
  }
  lengths.push(minimum);
  return lengths;
}

// Scores the gathered pairs under `fit` (into ws.lastScore) and lists in `chosenSet` the pairs
// closer than `cut`, relaxed by 0.5 Å until at least three are listed. ws.unchanged tells whether
// the list equals `previous` (of length previousCount).
function scoreAndSelect(ws, count, fit, d02, scoring, cut, chosenSet, previous, previousCount) {
  const { xtm, ytm, dist2 } = ws;
  const cutoff2 = scoring.cutoff2;
  const limit = cut * cut;
  const u0 = fit[0];
  const u1 = fit[1];
  const u2 = fit[2];
  const u3 = fit[3];
  const u4 = fit[4];
  const u5 = fit[5];
  const u6 = fit[6];
  const u7 = fit[7];
  const u8 = fit[8];
  const t0 = fit[9];
  const t1 = fit[10];
  const t2 = fit[11];
  let sum = 0;
  let chosen = 0;
  let same = previous !== null;
  for (let k = 0; k < count; k += 1) {
    const a = k * 3;
    const px = xtm[a];
    const py = xtm[a + 1];
    const pz = xtm[a + 2];
    const dx = t0 + u0 * px + u1 * py + u2 * pz - ytm[a];
    const dy = t1 + u3 * px + u4 * py + u5 * pz - ytm[a + 1];
    const dz = t2 + u6 * px + u7 * py + u8 * pz - ytm[a + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    dist2[k] = d2;
    if (d2 <= cutoff2) sum += 1 / (1 + d2 / d02);
    if (d2 < limit) {
      if (same && (chosen >= previousCount || previous[chosen] !== k)) same = false;
      chosenSet[chosen++] = k;
    }
  }
  ws.lastScore = sum / scoring.norm;
  for (let relax = 1; chosen < 3 && count > 3; relax += 1) {
    const wider = cut + relax * 0.5;
    const relaxed = wider * wider;
    chosen = 0;
    same = previous !== null;
    for (let k = 0; k < count; k += 1) {
      if (!(dist2[k] < relaxed)) continue;
      if (same && (chosen >= previousCount || previous[chosen] !== k)) same = false;
      chosenSet[chosen++] = k;
    }
  }
  ws.unchanged = same && chosen === previousCount;
  return chosen;
}

/* ---------- Final alignment ---------- */

// Superposes on the best map, keeps the pairs within d8 and scores them normalized by each chain;
// `extra` adds a TM-score for another length whose superposition then becomes the reported one
// (US-align's -u, used by the complex mode).
function finalizeAlignment(ws, x, y, map, params, options = {}) {
  const { nucleic = false, fast = false, extra = null } = options;
  const count = gatherPairs(ws, x.coords, y.coords, map);
  const prune = new Float64Array(12);
  superpositionSearch(ws, count, searchScoring(params), fast ? 40 : 1, prune);
  const cutoff2 = params.scoreD8 * params.scoreD8;
  const mobileIndex = [];
  const referenceIndex = [];
  for (let j = 0; j < y.length; j += 1) {
    const i = map[j];
    if (i < 0) continue;
    if (squaredDistance(prune, x.coords, i, y.coords, j) <= cutoff2) {
      mobileIndex.push(i);
      referenceIndex.push(j);
    }
  }
  const kept = gatherIndexPairs(ws, x.coords, y.coords, mobileIndex, referenceIndex);
  const rmsd = kept ? Math.sqrt(kabsch(ws.xtm, ws.ytm, kept, ws.fitTry, true) / kept) : NaN;
  const reference = finalScoring(y.length, nucleic);
  const mobile = finalScoring(x.length, nucleic);
  const fitReference = new Float64Array(12);
  const tmReference = Math.max(0, superpositionSearch(ws, kept, reference, 1, fitReference));
  const tmMobile = Math.max(0, superpositionSearch(ws, kept, mobile, 1, ws.fitTry));
  let transform = fitReference;
  let tmExtra = null;
  if (extra) {
    transform = new Float64Array(12);
    tmExtra = Math.max(0, superpositionSearch(ws, kept, finalScoring(extra, nucleic), 1, transform));
  }
  return { mobileIndex, referenceIndex, rmsd, tmReference, tmMobile, tmExtra, d0Reference: reference.d0, d0Mobile: mobile.d0, transform };
}

function gatherIndexPairs(ws, x, y, mobileIndex, referenceIndex) {
  const { xtm, ytm } = ws;
  for (let k = 0; k < mobileIndex.length; k += 1) {
    const i = mobileIndex[k] * 3;
    const j = referenceIndex[k] * 3;
    xtm[k * 3] = x[i];
    xtm[k * 3 + 1] = x[i + 1];
    xtm[k * 3 + 2] = x[i + 2];
    ytm[k * 3] = y[j];
    ytm[k * 3 + 1] = y[j + 1];
    ytm[k * 3 + 2] = y[j + 2];
  }
  return mobileIndex.length;
}

function squaredDistance(fit, x, i, y, j) {
  const px = x[i * 3];
  const py = x[i * 3 + 1];
  const pz = x[i * 3 + 2];
  const dx = fit[9] + fit[0] * px + fit[1] * py + fit[2] * pz - y[j * 3];
  const dy = fit[10] + fit[3] * px + fit[4] * py + fit[5] * pz - y[j * 3 + 1];
  const dz = fit[11] + fit[6] * px + fit[7] * py + fit[8] * pz - y[j * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

// The public result: pairs, distances after superposition, scores and the three alignment rows.
function describe(x, y, final) {
  const { mobileIndex, referenceIndex, transform } = final;
  const count = mobileIndex.length;
  const pairs = new Array(count);
  const distances = new Float64Array(count);
  let identical = 0;
  let rowMobile = '';
  let rowMatch = '';
  let rowReference = '';
  let i0 = 0;
  let j0 = 0;
  for (let k = 0; k < count; k += 1) {
    const i = mobileIndex[k];
    const j = referenceIndex[k];
    for (; i0 < i; i0 += 1) {
      rowMobile += x.sequence[i0];
      rowMatch += ' ';
      rowReference += '-';
    }
    for (; j0 < j; j0 += 1) {
      rowMobile += '-';
      rowMatch += ' ';
      rowReference += y.sequence[j0];
    }
    const d = Math.sqrt(squaredDistance(transform, x.coords, i, y.coords, j));
    pairs[k] = [i, j];
    distances[k] = d;
    if (x.letters[i] === y.letters[j]) identical += 1;
    rowMobile += x.sequence[i];
    rowMatch += d < MATCH_CUTOFF ? ':' : '.';
    rowReference += y.sequence[j];
    i0 = i + 1;
    j0 = j + 1;
  }
  for (; i0 < x.length; i0 += 1) {
    rowMobile += x.sequence[i0];
    rowMatch += ' ';
    rowReference += '-';
  }
  for (; j0 < y.length; j0 += 1) {
    rowMobile += '-';
    rowMatch += ' ';
    rowReference += y.sequence[j0];
  }
  return {
    pairs,
    distances,
    transform: toTransform(transform),
    tmScore: { mobile: final.tmMobile, reference: final.tmReference },
    d0: { mobile: final.d0Mobile, reference: final.d0Reference },
    rmsd: final.rmsd,
    alignedLength: count,
    identity: count ? identical / count : 0,
    alignment: { mobile: rowMobile, match: rowMatch, reference: rowReference },
  };
}

function toTransform(fit) {
  return { rotation: Array.from(fit.subarray(0, 9)), translation: Array.from(fit.subarray(9, 12)) };
}

/* ---------- Complexes ---------- */

// Settings shared by the complex steps. aa and na are the smaller complex's total protein and
// nucleic-acid lengths; chain-pair scores are TM-scores normalized by them, times the length.
function complexContext(xs, ys, options) {
  const total = (chains, nucleic) => chains.reduce((sum, chain) => sum + ((chain.molecule > 0) === nucleic ? chain.length : 0), 0);
  const aa = Math.min(total(xs, false), total(ys, false));
  const na = Math.min(total(xs, true), total(ys, true));
  return { xs, ys, n1: xs.length, n2: ys.length, aa, na, fast: options.fast ?? aa + na > 500, ws: createWorkspace(0, 0) };
}

function compatible(ctx, i, j) {
  return ctx.xs[i].molecule * ctx.ys[j].molecule > 0;
}

function pairLength(ctx, i, j) {
  return ctx.xs[i].molecule + ctx.ys[j].molecule > 0 ? ctx.na : ctx.aa;
}

// Chain assignment state: scores[i·n2 + j] (−1 for incompatible chains), the residue maps of the
// chain pairs (reference residue → mobile residue or −1) and the assignment both ways.
function newState(ctx) {
  return {
    scores: new Float64Array(ctx.n1 * ctx.n2).fill(-1),
    maps: new Array(ctx.n1 * ctx.n2).fill(null),
    assign1: new Int32Array(ctx.n1).fill(-1),
    assign2: new Int32Array(ctx.n2).fill(-1),
  };
}

function copyState(state) {
  return { scores: state.scores.slice(), maps: state.maps.slice(), assign1: state.assign1.slice(), assign2: state.assign2.slice() };
}

function restoreState(target, source) {
  target.scores.set(source.scores);
  for (let k = 0; k < source.maps.length; k += 1) target.maps[k] = source.maps[k];
  target.assign1.set(source.assign1);
  target.assign2.set(source.assign2);
}

function assignedCount(state) {
  let count = 0;
  for (const j of state.assign1) if (j >= 0) count += 1;
  return count;
}

// MM-align's search: TM-align every compatible chain pair, assign chains, then iterate complex
// superposition and realignment while the summed score improves, and finally try the assigned
// chains as one pseudo-chain.
function assignChains(ctx) {
  const { xs, ys, n1, n2 } = ctx;
  const state = newState(ctx);
  const transforms = new Array(n1 * n2).fill(null);
  let bestMonomer = -1;
  let bestPair = -1;
  for (let i = 0; i < n1; i += 1) {
    for (let j = 0; j < n2; j += 1) {
      if (!compatible(ctx, i, j)) continue;
      const k = i * n2 + j;
      const length = pairLength(ctx, i, j);
      const final = alignChains(xs[i], ys[j], { fast: ctx.fast, extra: length, workspace: ctx.ws });
      state.scores[k] = final.tmExtra * length;
      state.maps[k] = mapOf(final, ys[j].length);
      transforms[k] = final.transform;
      if (state.scores[k] > bestMonomer) {
        bestMonomer = state.scores[k];
        bestPair = k;
      }
    }
  }
  if (greedyAssignment(ctx, state) <= 0) return null;
  refineInitialAssignment(ctx, state, transforms);

  const initial = copyState(state);
  const initialPairs = assignedCount(state);
  const rounds = Math.max(2, 5 - Math.floor((ctx.aa + ctx.na) / 200));
  let total = iterateAssignment(ctx, state, 0, rounds);
  if (total < bestMonomer) {
    // The iteration did worse than the best single chain pair: restart from that pair alone.
    restoreState(state, initial);
    state.assign1.fill(-1);
    state.assign2.fill(-1);
    state.assign1[Math.floor(bestPair / n2)] = bestPair % n2;
    state.assign2[bestPair % n2] = Math.floor(bestPair / n2);
    total = iterateAssignment(ctx, state, bestMonomer, rounds);
  }
  const start = assignedCount(state) >= initialPairs ? copyState(state) : initial;
  if (ctx.aa + ctx.na < 10000 && alignAsOneChain(ctx, start) > total) return start;
  return state;
}

function mapOf(final, length) {
  const map = new Int32Array(length).fill(-1);
  for (let k = 0; k < final.mobileIndex.length; k += 1) map[final.referenceIndex[k]] = final.mobileIndex[k];
  return map;
}

// Greedy assignment by descending score, then pairwise swaps while they raise the summed score.
function greedyAssignment(ctx, state) {
  const { n1, n2 } = ctx;
  const { scores, assign1, assign2 } = state;
  assign1.fill(-1);
  assign2.fill(-1);
  let total = 0;
  for (;;) {
    let best = -1;
    let bi = 0;
    let bj = 0;
    for (let i = 0; i < n1; i += 1) {
      if (assign1[i] >= 0) continue;
      for (let j = 0; j < n2; j += 1) {
        const value = scores[i * n2 + j];
        if (assign2[j] >= 0 || value <= 0) continue;
        if (value > best) {
          best = value;
          bi = i;
          bj = j;
        }
      }
    }
    if (best <= 0) break;
    assign1[bi] = bj;
    assign2[bj] = bi;
    total += best;
  }
  if (total <= 0) return total;
  for (let round = 0; round < Math.min(n1, n2) * 5; round += 1) {
    let delta = -1;
    for (let i = 0; i < n1 && !(delta > 0); i += 1) {
      const oldJ = assign1[i];
      for (let j = 0; j < n2; j += 1) {
        if (j === assign1[i] || scores[i * n2 + j] <= 0) continue;
        const oldI = assign2[j];
        delta = scores[i * n2 + j];
        if (oldJ >= 0) delta -= scores[i * n2 + oldJ];
        if (oldI >= 0) delta -= scores[oldI * n2 + j];
        if (oldI >= 0 && oldJ >= 0) delta += scores[oldI * n2 + oldJ];
        if (delta > 0) {
          swapAssignment(assign1, assign2, i, j, oldI, oldJ);
          total += delta;
          break;
        }
      }
    }
    if (!(delta > 0)) break;
  }
  return total;
}

// Gives mobile chain i the reference chain j; their former partners get each other.
function swapAssignment(assign1, assign2, i, j, oldI, oldJ) {
  assign1[i] = j;
  if (oldI >= 0) assign1[oldI] = oldJ;
  assign2[j] = i;
  if (oldJ >= 0) assign2[oldJ] = oldI;
}

// Dimers of one molecule type may swap their two chains; oligomers are reassigned by how well the
// chain centroids superpose.
function refineInitialAssignment(ctx, state, transforms) {
  const pairs = assignedCount(state);
  let oligomer = pairs >= 3;
  if (pairs === 2) {
    const count = (chains) => [chains.filter((chain) => chain.molecule > 0).length, chains.filter((chain) => chain.molecule <= 0).length];
    const [na1, aa1] = count(ctx.xs);
    const [na2, aa2] = count(ctx.ys);
    if (na1 === 1 && na2 === 1 && aa1 === 1 && aa2 === 1) oligomer = false;
    else if ((Math.min(na1, na2) === 0 && aa1 === 2 && aa2 === 2) || (Math.min(aa1, aa2) === 0 && na1 === 2 && na2 === 2)) {
      adjustDimer(ctx, state);
      oligomer = false;
    } else oligomer = true;
  }
  if (!oligomer) return;
  const xc = centroids(ctx.xs);
  const yc = centroids(ctx.ys);
  const d0 = Math.min(centroidSpacing(xc), centroidSpacing(yc));
  refineByCentroidsHomo(ctx, state, transforms, xc, yc, d0);
  // The swap search runs over the complex with fewer chains. US-align leaves the score matrix
  // untransposed in the other case and reads past its rows; this is the evident intent.
  if (ctx.n1 <= ctx.n2) refineByCentroidsHetero(state.scores, state.assign1, state.assign2, ctx.n1, ctx.n2, xc, yc, d0, ctx.aa + ctx.na);
  else refineByCentroidsHetero(transpose(state.scores, ctx.n1, ctx.n2), state.assign2, state.assign1, ctx.n2, ctx.n1, yc, xc, d0, ctx.aa + ctx.na);
}

// Keeps or swaps the two chain pairs of a dimer, whichever superposes better on the chain
// alignments. US-align scores this test with a 1 Å distance scale, Σ 1/(1 + d²).
function adjustDimer(ctx, state) {
  const { assign1, assign2 } = state;
  const chains = [];
  for (let i = 0; i < ctx.n1; i += 1) if (assign1[i] >= 0) chains.push(i);
  const [i1, i2] = chains;
  const j1 = assign1[i1];
  const j2 = assign1[i2];
  const kept = dimerScore(ctx, state, [[i1, j1], [i2, j2]]);
  const swapped = dimerScore(ctx, state, [[i1, j2], [i2, j1]]);
  if (kept < swapped) {
    assign1[i1] = j2;
    assign1[i2] = j1;
    assign2[j1] = i2;
    assign2[j2] = i1;
  }
}

function dimerScore(ctx, state, chainPairs) {
  const a = [];
  const b = [];
  for (const [i, j] of chainPairs) {
    const map = state.maps[i * ctx.n2 + j];
    if (!map) continue;
    const x = ctx.xs[i].coords;
    const y = ctx.ys[j].coords;
    for (let r = 0; r < map.length; r += 1) {
      if (map[r] < 0) continue;
      a.push(x[map[r] * 3], x[map[r] * 3 + 1], x[map[r] * 3 + 2]);
      b.push(y[r * 3], y[r * 3 + 1], y[r * 3 + 2]);
    }
  }
  const fit = new Float64Array(12);
  kabsch(a, b, a.length / 3, fit);
  let score = 0;
  for (let k = 0; k < a.length / 3; k += 1) score += 1 / (1 + squaredDistance(fit, a, k, b, k));
  return score;
}

function centroids(chains) {
  const out = new Float64Array(chains.length * 3);
  chains.forEach((chain, c) => {
    for (let r = 0; r < chain.length; r += 1) {
      for (let axis = 0; axis < 3; axis += 1) out[c * 3 + axis] += chain.coords[r * 3 + axis];
    }
    for (let axis = 0; axis < 3; axis += 1) out[c * 3 + axis] /= chain.length;
  });
  return out;
}

// Mean distance from each chain centroid to its nearest neighbour: the d0 of centroid scores.
function centroidSpacing(c) {
  const count = c.length / 3;
  let sum = 0;
  for (let a = 0; a < count; a += 1) {
    let nearest = -1;
    for (let b = 0; b < count; b += 1) {
      if (a === b) continue;
      const d = Math.hypot(c[a * 3] - c[b * 3], c[a * 3 + 1] - c[b * 3 + 1], c[a * 3 + 2] - c[b * 3 + 2]);
      if (nearest <= 0 || d < nearest) nearest = d;
    }
    sum += nearest;
  }
  return sum / count;
}

function transpose(values, rows, columns) {
  const out = new Float64Array(values.length);
  for (let i = 0; i < rows; i += 1) for (let j = 0; j < columns; j += 1) out[j * rows + i] = values[i * columns + j];
  return out;
}

// For homo-oligomers: every chain pair's own superposition is applied to the mobile centroids and
// the chains are assigned greedily by (chain score × centroid proximity); the seed whose
// assignment scores best (summed chain score × mean centroid proximity) wins.
function refineByCentroidsHomo(ctx, state, transforms, xc, yc, d0) {
  const { n1, n2 } = ctx;
  const { scores } = state;
  const total = n1 * n2;
  const length = ctx.aa + ctx.na;
  const closeness = new Float64Array(total);
  const order = Array.from({ length: total }, () => [0, 0]);
  const moved = new Float64Array(n1 * 3);
  const a1 = new Int32Array(n1);
  const a2 = new Int32Array(n2);
  let best = 0;
  let found = false;
  for (let seed = 0; seed < total; seed += 1) {
    if (scores[seed] <= 0) continue;
    const fit = transforms[seed];
    for (let i = 0; i < n1; i += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        moved[i * 3 + axis] = fit[9 + axis] + fit[axis * 3] * xc[i * 3] + fit[axis * 3 + 1] * xc[i * 3 + 1] + fit[axis * 3 + 2] * xc[i * 3 + 2];
      }
    }
    for (let k = 0; k < total; k += 1) {
      closeness[k] = 0;
      order[k][0] = -1;
      order[k][1] = k;
      if (scores[k] <= 0) continue;
      const i = Math.floor(k / n2);
      const j = k % n2;
      const d2 = (moved[i * 3] - yc[j * 3]) ** 2 + (moved[i * 3 + 1] - yc[j * 3 + 1]) ** 2 + (moved[i * 3 + 2] - yc[j * 3 + 2]) ** 2;
      closeness[k] = 1 / (1 + d2 / (d0 * d0));
      order[k][0] = closeness[k] * scores[k];
    }
    a1.fill(-1);
    a2.fill(-1);
    a1[Math.floor(seed / n2)] = seed % n2;
    a2[seed % n2] = Math.floor(seed / n2);
    let sum = scores[seed];
    let near = closeness[seed];
    order.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    for (let k = total - 1; k >= 0; k -= 1) {
      const index = order[k][1];
      if (scores[index] <= 0) break;
      const i = Math.floor(index / n2);
      const j = index % n2;
      if (a1[i] >= 0 || a2[j] >= 0) continue;
      a1[i] = j;
      a2[j] = i;
      sum += scores[index];
      near += closeness[index];
    }
    const score = (sum / length) * (near / Math.min(n1, n2));
    if (!found || score > best) {
      found = true;
      best = score;
      state.assign1.set(a1);
      state.assign2.set(a2);
    }
  }
}

// For hetero-oligomers: pairwise swaps while they raise the summed chain score times the
// pseudo-TM-score of the superposed chain centroids.
function refineByCentroidsHetero(scores, assign1, assign2, n1, n2, xc, yc, d0, length) {
  let current = centroidScore(scores, assign1, n1, n2, xc, yc, d0, length);
  const trial1 = assign1.slice();
  const trial2 = assign2.slice();
  for (let round = 0; round < n1 * n2; round += 1) {
    let improved = false;
    for (let i = 0; i < n1; i += 1) {
      const oldJ = assign1[i];
      for (let j = 0; j < n2; j += 1) {
        if (j === assign1[i] || scores[i * n2 + j] <= 0) continue;
        const oldI = assign2[j];
        swapAssignment(trial1, trial2, i, j, oldI, oldJ);
        const score = centroidScore(scores, trial1, n1, n2, xc, yc, d0, length);
        if (score > current) {
          swapAssignment(assign1, assign2, i, j, oldI, oldJ);
          current = score;
          improved = true;
          break;
        }
        trial1.set(assign1);
        trial2.set(assign2);
      }
    }
    if (!improved) break;
  }
}

function centroidScore(scores, assign1, n1, n2, xc, yc, d0, length) {
  const a = [];
  const b = [];
  let sum = 0;
  for (let i = 0; i < n1; i += 1) {
    const j = assign1[i];
    if (j < 0) continue;
    a.push(xc[i * 3], xc[i * 3 + 1], xc[i * 3 + 2]);
    b.push(yc[j * 3], yc[j * 3 + 1], yc[j * 3 + 2]);
    sum += scores[i * n2 + j];
  }
  const count = a.length / 3;
  let near = 1;
  if (count >= 3) {
    const fit = new Float64Array(12);
    kabsch(a, b, count, fit);
    near = 0;
    for (let k = 0; k < count; k += 1) near += 1 / (1 + squaredDistance(fit, a, k, b, k) / (d0 * d0));
  } else if (count === 2) {
    // As in US-align, two chains are compared without superposition.
    near = 1 / (1 + ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / (d0 * d0));
  }
  return (sum / length) * (near / Math.min(n1, n2));
}

// Superpose the complex on the assigned chain pairs, realign every chain pair on that superposition
// and reassign, for as long as the summed score improves. Returns the best total.
function iterateAssignment(ctx, state, best, rounds) {
  const trial = copyState(state);
  for (let round = 0; round < rounds; round += 1) {
    const fit = complexSuperposition(ctx, trial);
    if (fit) realignAll(ctx, trial, fit, false);
    const total = greedyAssignment(ctx, trial);
    if (total <= best) break;
    best = total;
    restoreState(state, trial);
  }
  return best;
}

// Concatenated residue pairs of the assigned chains, in mobile chain order.
function complexPairs(ctx, state) {
  const mobile = [];
  const reference = [];
  let molecule = 0;
  for (let i = 0; i < ctx.n1; i += 1) {
    const j = state.assign1[i];
    if (j < 0) continue;
    const map = state.maps[i * ctx.n2 + j];
    const x = ctx.xs[i].coords;
    const y = ctx.ys[j].coords;
    molecule += ctx.xs[i].molecule + ctx.ys[j].molecule;
    for (let r = 0; map && r < map.length; r += 1) {
      if (map[r] < 0) continue;
      mobile.push(x[map[r] * 3], x[map[r] * 3 + 1], x[map[r] * 3 + 2]);
      reference.push(y[r * 3], y[r * 3 + 1], y[r * 3 + 2]);
    }
  }
  return { mobile: Float64Array.from(mobile), reference: Float64Array.from(reference), count: mobile.length / 3, molecule };
}

// The superposition maximizing the complex TM-score normalized by the assignment length.
function complexSuperposition(ctx, state) {
  let xlen = 0;
  let ylen = 0;
  for (let i = 0; i < ctx.n1; i += 1) {
    if (state.assign1[i] < 0) continue;
    xlen += ctx.xs[i].length;
    ylen += ctx.ys[state.assign1[i]].length;
  }
  if (xlen <= 3 || ylen <= 3) return null;
  const pairs = complexPairs(ctx, state);
  const ws = createWorkspace(pairs.count, pairs.count, false);
  ws.xtm.set(pairs.mobile);
  ws.ytm.set(pairs.reference);
  const fit = new Float64Array(12);
  superpositionSearch(ws, pairs.count, finalScoring(ctx.aa + ctx.na, pairs.molecule > 0), 1, fit);
  return fit;
}

// Realigns every compatible chain pair on the given superposition (dynamic programming on the
// superposed distances, no gap penalty, pairs beyond d8 dropped) and rescores it. Returns the sum
// over assigned pairs; `dropEmpty` unassigns pairs left without aligned residues.
function realignAll(ctx, state, fit, dropEmpty) {
  const { xs, ys, n1, n2 } = ctx;
  let total = 0;
  for (let i = 0; i < n1; i += 1) {
    for (let j = 0; j < n2; j += 1) {
      const k = i * n2 + j;
      if (!compatible(ctx, i, j)) {
        state.scores[k] = -1;
        continue;
      }
      const length = pairLength(ctx, i, j);
      const { score, map } = realignSuperposed(ctx.ws, xs[i], ys[j], fit, length);
      state.scores[k] = score;
      state.maps[k] = map;
      if (state.assign1[i] !== j) continue;
      if (dropEmpty && score <= 0) state.assign1[i] = state.assign2[j] = -1;
      else total += score;
    }
  }
  return total;
}

function realignSuperposed(ws, x, y, fit, length) {
  sizeWorkspace(ws, x.length, y.length);
  const params = searchParameters(length, length);
  const d0 = d0Of(length, x.molecule + y.molecule > 0);
  const map = new Int32Array(y.length);
  dpDistance(ws, x.coords, y.coords, fit, params.d0 * params.d0, 0, map);
  let sum = 0;
  for (let j = 0; j < y.length; j += 1) {
    if (map[j] < 0) continue;
    const d = Math.sqrt(squaredDistance(fit, x.coords, map[j], y.coords, j));
    if (d <= params.scoreD8) sum += 1 / (1 + (d / d0) * (d / d0));
    else map[j] = -1;
  }
  return { score: (sum / length) * length, map };
}

// The cross-chain pass: TM-align of the assigned chains concatenated in assignment order, with the
// dynamic programming confined to assigned chain pairs and the current alignment as an extra seed,
// then realignment of every chain pair on the resulting superposition. Returns the new total.
// Cells outside the chain blocks are excluded outright (US-align scores them FLT_MIN instead).
function alignAsOneChain(ctx, state) {
  const order = [];
  for (let i = 0; i < ctx.n1; i += 1) if (state.assign1[i] >= 0) order.push(i);
  const x = concatenate(order.map((i) => ctx.xs[i]));
  const y = concatenate(order.map((i) => ctx.ys[state.assign1[i]]));
  if (x.length <= 3 || y.length <= 3) return -Infinity;
  const blocks = { lo: new Int32Array(x.length + 1), hi: new Int32Array(x.length + 1) };
  const seed = new Int32Array(y.length).fill(-1);
  let xo = 0;
  let yo = 0;
  for (const i of order) {
    const j = state.assign1[i];
    const xlen = ctx.xs[i].length;
    const ylen = ctx.ys[j].length;
    for (let r = 1; r <= xlen; r += 1) {
      blocks.lo[xo + r] = yo + 1;
      blocks.hi[xo + r] = yo + ylen;
    }
    const map = state.maps[i * ctx.n2 + j];
    for (let r = 0; map && r < ylen; r += 1) if (map[r] >= 0) seed[yo + r] = xo + map[r];
    xo += xlen;
    yo += ylen;
  }
  const ws = createWorkspace(x.length, y.length);
  const params = searchParameters(x.length, y.length);
  const map = searchAlignment(ws, x, y, params, { fast: ctx.fast, blocks, seed });
  const final = finalizeAlignment(ws, x, y, map, params, { nucleic: x.molecule + y.molecule > 0, fast: ctx.fast, extra: ctx.aa + ctx.na });
  return realignAll(ctx, state, final.transform, true);
}

function concatenate(chains) {
  const length = chains.reduce((sum, chain) => sum + chain.length, 0);
  const coords = new Float64Array(length * 3);
  const sec = new Uint8Array(length);
  const letters = new Uint8Array(length);
  let offset = 0;
  let molecule = 0;
  for (const chain of chains) {
    coords.set(chain.coords.subarray(0, chain.length * 3), offset * 3);
    sec.set(chain.sec, offset);
    letters.set(chain.letters, offset);
    offset += chain.length;
    molecule += chain.molecule;
  }
  return { coords, length, sec, letters, sequence: chains.map((chain) => chain.sequence).join(''), molecule };
}

// Final complex scores: superposition and TM-scores on all aligned pairs, normalized by the total
// length of each complex; each chain pair is scored under that superposition by its own lengths.
function describeComplex(ctx, state) {
  const { xs, ys, n1, n2 } = ctx;
  const pairs = complexPairs(ctx, state);
  const xTotal = xs.reduce((sum, chain) => sum + chain.length, 0);
  const yTotal = ys.reduce((sum, chain) => sum + chain.length, 0);
  const nucleic = pairs.molecule > 0;
  const ws = createWorkspace(pairs.count, pairs.count, false);
  ws.xtm.set(pairs.mobile);
  ws.ytm.set(pairs.reference);
  const rmsd = pairs.count ? Math.sqrt(kabsch(ws.xtm, ws.ytm, pairs.count, ws.fitTry, true) / pairs.count) : NaN;
  const reference = finalScoring(yTotal, nucleic);
  const mobile = finalScoring(xTotal, nucleic);
  const fit = new Float64Array(12);
  const tmReference = Math.max(0, superpositionSearch(ws, pairs.count, reference, 1, fit));
  const tmMobile = Math.max(0, superpositionSearch(ws, pairs.count, mobile, 1, ws.fitTry));
  const chainPairs = [];
  let identical = 0;
  for (let i = 0; i < n1; i += 1) {
    const j = state.assign1[i];
    if (j < 0) continue;
    const x = xs[i];
    const y = ys[j];
    const map = state.maps[i * n2 + j];
    const chainNucleic = x.molecule + y.molecule > 0;
    const d0x = d0Of(x.length, chainNucleic);
    const d0y = d0Of(y.length, chainNucleic);
    const list = [];
    const distances = [];
    let sumX = 0;
    let sumY = 0;
    for (let r = 0; map && r < map.length; r += 1) {
      if (map[r] < 0) continue;
      const d = Math.sqrt(squaredDistance(fit, x.coords, map[r], y.coords, r));
      list.push([map[r], r]);
      distances.push(d);
      sumX += 1 / (1 + (d / d0x) ** 2);
      sumY += 1 / (1 + (d / d0y) ** 2);
      if (x.letters[map[r]] === y.letters[r]) identical += 1;
    }
    chainPairs.push({
      mobile: x.id,
      reference: y.id,
      pairs: list,
      distances: Float64Array.from(distances),
      tmScore: { mobile: sumX / x.length, reference: sumY / y.length },
    });
  }
  return {
    chainPairs,
    transform: toTransform(fit),
    tmScore: { mobile: tmMobile, reference: tmReference },
    d0: { mobile: mobile.d0, reference: reference.d0 },
    rmsd,
    alignedLength: pairs.count,
    identity: pairs.count ? identical / pairs.count : 0,
  };
}

// Both complexes are single chains: plain TM-align, reported like a complex.
function monomerComplex(x, y, options) {
  const fast = options.fast ?? Math.min(x.length, y.length) > FAST_LENGTH;
  const result = describe(x, y, alignChains(x, y, { fast }));
  return {
    chainPairs: [{ mobile: x.id, reference: y.id, pairs: result.pairs, distances: result.distances, tmScore: result.tmScore }],
    transform: result.transform,
    tmScore: result.tmScore,
    d0: result.d0,
    rmsd: result.rmsd,
    alignedLength: result.alignedLength,
    identity: result.identity,
  };
}

/* ---------- Dynamic programming ---------- */

// Needleman–Wunsch as TM-align runs it: a gap costs `gapOpen` once, when it follows an aligned pair,
// and nothing while it extends; end gaps are free. Each row's scores are in ws.score[1 … ylen];
// ties prefer the diagonal, then a gap in the mobile chain.
function dpBegin(ws, gapOpen, blocks) {
  const { trace, cols, xlen, prev } = ws;
  for (let i = 0; i <= xlen; i += 1) trace[i * cols] = 0;
  trace.fill(0, 0, cols);
  // The complex mode charges leading gaps too.
  for (let j = 0; j < cols; j += 1) prev[j] = blocks ? j * gapOpen : 0;
}

function dpRow(ws, i, gapOpen, blocks) {
  const { cols, trace, score } = ws;
  const prev = ws.prev;
  const cur = ws.cur;
  const base = i * cols;
  const above = base - cols;
  cur[0] = blocks ? i * gapOpen : 0;
  if (blocks) {
    const lo = blocks.lo[i];
    const hi = blocks.hi[i];
    for (let j = 1; j < cols; j += 1) if (j < lo || j > hi) score[j] = -Infinity;
  }
  for (let j = 1; j < cols; j += 1) {
    const d = prev[j - 1] + score[j];
    const h = trace[above + j] === DIAG ? prev[j] + gapOpen : prev[j];
    const v = trace[base + j - 1] === DIAG ? cur[j - 1] + gapOpen : cur[j - 1];
    if (d >= h && d >= v) {
      trace[base + j] = DIAG;
      cur[j] = d;
    } else if (v >= h) {
      trace[base + j] = LEFT;
      cur[j] = v;
    } else {
      trace[base + j] = UP;
      cur[j] = h;
    }
  }
  ws.prev = cur;
  ws.cur = prev;
}

function dpTraceback(ws, map) {
  const { trace, cols } = ws;
  map.fill(-1);
  let i = ws.xlen;
  let j = ws.ylen;
  while (i > 0 && j > 0) {
    const step = trace[i * cols + j];
    if (step === DIAG) {
      map[j - 1] = i - 1;
      i -= 1;
      j -= 1;
    } else if (step === LEFT) j -= 1;
    else i -= 1;
  }
}

// Scores 1/(1 + d²/d02) with the mobile chain superposed by `fit`. This is the hot loop of the
// whole search, so scoring and recurrence are fused and the left neighbour stays in registers.
function dpDistance(ws, x, y, fit, d02, gapOpen, map, blocks = null) {
  const { xlen, ylen, cols, trace } = ws;
  const u0 = fit[0];
  const u1 = fit[1];
  const u2 = fit[2];
  const u3 = fit[3];
  const u4 = fit[4];
  const u5 = fit[5];
  const u6 = fit[6];
  const u7 = fit[7];
  const u8 = fit[8];
  const t0 = fit[9];
  const t1 = fit[10];
  const t2 = fit[11];
  dpBegin(ws, gapOpen, blocks);
  let prev = ws.prev;
  let cur = ws.cur;
  for (let i = 1; i <= xlen; i += 1) {
    const a = (i - 1) * 3;
    const px = t0 + u0 * x[a] + u1 * x[a + 1] + u2 * x[a + 2];
    const py = t1 + u3 * x[a] + u4 * x[a + 1] + u5 * x[a + 2];
    const pz = t2 + u6 * x[a] + u7 * x[a + 1] + u8 * x[a + 2];
    // Cells outside the allowed columns (complex mode) can only be passed through with gaps.
    const lo = blocks ? blocks.lo[i] : 1;
    const hi = blocks ? blocks.hi[i] : ylen;
    const base = i * cols;
    const above = base - cols;
    let left = blocks ? i * gapOpen : 0;
    let leftDiag = false;
    let corner = prev[0];
    cur[0] = left;
    let j = 1;
    for (; j < lo; j += 1) {
      const up = prev[j];
      corner = up;
      const h = trace[above + j] === DIAG ? up + gapOpen : up;
      const v = leftDiag ? left + gapOpen : left;
      trace[base + j] = v >= h ? LEFT : UP;
      left = v >= h ? v : h;
      leftDiag = false;
      cur[j] = left;
    }
    for (let b = (j - 1) * 3; j <= hi; j += 1, b += 3) {
      const dx = px - y[b];
      const dy = py - y[b + 1];
      const dz = pz - y[b + 2];
      const d = corner + 1 / (1 + (dx * dx + dy * dy + dz * dz) / d02);
      const up = prev[j];
      corner = up;
      const h = trace[above + j] === DIAG ? up + gapOpen : up;
      const v = leftDiag ? left + gapOpen : left;
      let step;
      if (d >= h && d >= v) {
        step = DIAG;
        left = d;
      } else if (v >= h) {
        step = LEFT;
        left = v;
      } else {
        step = UP;
        left = h;
      }
      leftDiag = step === DIAG;
      trace[base + j] = step;
      cur[j] = left;
    }
    for (; j <= ylen; j += 1) {
      const up = prev[j];
      const h = trace[above + j] === DIAG ? up + gapOpen : up;
      const v = leftDiag ? left + gapOpen : left;
      trace[base + j] = v >= h ? LEFT : UP;
      left = v >= h ? v : h;
      leftDiag = false;
      cur[j] = left;
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  ws.prev = prev;
  ws.cur = cur;
  dpTraceback(ws, map);
}

// Scores 1 for equal secondary structure, 0 otherwise.
function dpSecondary(ws, secx, secy, gapOpen, map, blocks = null) {
  const { xlen, ylen, score } = ws;
  dpBegin(ws, gapOpen, blocks);
  for (let i = 1; i <= xlen; i += 1) {
    const s = secx[i - 1];
    for (let j = 1; j <= ylen; j += 1) score[j] = secy[j - 1] === s ? 1 : 0;
    dpRow(ws, i, gapOpen, blocks);
  }
  dpTraceback(ws, map);
}

// Distance score as in dpDistance plus 0.5 for equal secondary structure.
function dpDistanceSecondary(ws, x, y, fit, d02, gapOpen, map, blocks = null) {
  const { xlen, ylen, score } = ws;
  const secx = x.sec;
  const secy = y.sec;
  const xc = x.coords;
  const yc = y.coords;
  const u0 = fit[0];
  const u1 = fit[1];
  const u2 = fit[2];
  const u3 = fit[3];
  const u4 = fit[4];
  const u5 = fit[5];
  const u6 = fit[6];
  const u7 = fit[7];
  const u8 = fit[8];
  const t0 = fit[9];
  const t1 = fit[10];
  const t2 = fit[11];
  dpBegin(ws, gapOpen, null);
  for (let i = 1; i <= xlen; i += 1) {
    const a = (i - 1) * 3;
    const px = t0 + u0 * xc[a] + u1 * xc[a + 1] + u2 * xc[a + 2];
    const py = t1 + u3 * xc[a] + u4 * xc[a + 1] + u5 * xc[a + 2];
    const pz = t2 + u6 * xc[a] + u7 * xc[a + 1] + u8 * xc[a + 2];
    const s = secx[i - 1];
    for (let j = 1, b = 0; j <= ylen; j += 1, b += 3) {
      const dx = px - yc[b];
      const dy = py - yc[b + 1];
      const dz = pz - yc[b + 2];
      score[j] = 1 / (1 + (dx * dx + dy * dy + dz * dz) / d02) + (secy[j - 1] === s ? 0.5 : 0);
    }
    if (blocks) {
      const lo = blocks.lo[i];
      const hi = blocks.hi[i];
      for (let j = 1; j <= ylen; j += 1) if (j < lo || j > hi) score[j] = -Infinity;
    }
    dpRow(ws, i, gapOpen, null);
  }
  dpTraceback(ws, map);
}

/* ---------- Superposition ---------- */

const TOLERANCE = 0.01;
const TINY = 1e-8;
// Scratch for kabsch(): covariance, centroids, eigenvalues and the two orthonormal frames.
const COV = new Float64Array(9);
const CENTER_A = new Float64Array(3);
const CENTER_B = new Float64Array(3);
const EIGEN = new Float64Array(3);
const AXES_A = new Float64Array(9);
const AXES_B = new Float64Array(9);
const SYM = new Float64Array(6);

// Least-squares superposition of n points a onto b (flat xyz arrays) after Kabsch (Acta Cryst 1976
// A32:922; 1978 A34:827): the rotation comes from the eigenvectors of RᵀR, R being the covariance
// of the centred sets, with the eigenvalues from the trigonometric solution of the cubic, so no
// SVD or iteration is needed. Writes [r00 … r22, tx, ty, tz] to `out`; with `residual` returns
// Σ |R·a + t − b|² after fitting. `index` lists the points to use (the first n by default).
function kabsch(a, b, n, out, residual = false, index = null) {
  out.fill(0);
  out[0] = out[4] = out[8] = 1;
  if (n < 1) return 0;
  const r = COV;
  const ca = CENTER_A;
  const cb = CENTER_B;
  const e = EIGEN;
  covariance(a, b, n, index, r, ca, cb);
  const determinant = det3(r);
  // M = RᵀR, symmetric: m00, m01, m02, m11, m12, m22.
  const m = SYM;
  m[0] = r[0] * r[0] + r[3] * r[3] + r[6] * r[6];
  m[1] = r[0] * r[1] + r[3] * r[4] + r[6] * r[7];
  m[2] = r[0] * r[2] + r[3] * r[5] + r[6] * r[8];
  m[3] = r[1] * r[1] + r[4] * r[4] + r[7] * r[7];
  m[4] = r[1] * r[2] + r[4] * r[5] + r[7] * r[8];
  m[5] = r[2] * r[2] + r[5] * r[5] + r[8] * r[8];
  const mean = (m[0] + m[3] + m[5]) / 3;
  const minors = (m[3] * m[5] - m[4] * m[4] + m[0] * m[5] - m[2] * m[2] + m[0] * m[3] - m[1] * m[1]) / 3;
  e[0] = e[1] = e[2] = mean;
  if (mean > 0) {
    const axesA = AXES_A;
    axesA.fill(0);
    axesA[0] = axesA[4] = axesA[8] = 1;
    // Eigenvalues λ = mean + 2√h·cos(θ − 2πk/3) of the depressed cubic; with h ≤ 0 all three are
    // equal and any frame will do.
    const h = mean * mean - minors;
    let failed = false;
    if (h > 0) {
      const g = (mean * minors - determinant * determinant) / 2 - mean * h;
      const root = Math.sqrt(h);
      const theta = Math.atan2(Math.sqrt(Math.max(0, h * h * h - g * g)), -g) / 3;
      const cth = root * Math.cos(theta);
      const sth = root * Math.sqrt(3) * Math.sin(theta);
      e[0] = mean + cth + cth;
      e[1] = mean - cth + sth;
      e[2] = mean - cth - sth;
      failed = !eigenAxes(m, e, axesA);
    }
    if (!failed) {
      rotationFromAxes(r, axesA, out);
      for (let row = 0; row < 3; row += 1) {
        out[9 + row] = cb[row] - out[row * 3] * ca[0] - out[row * 3 + 1] * ca[1] - out[row * 3 + 2] * ca[2];
      }
    }
  } else {
    for (let row = 0; row < 3; row += 1) out[9 + row] = cb[row] - ca[row];
  }
  if (!residual) return 0;
  let spread = 0;
  for (let m = 0; m < n; m += 1) {
    const k = (index === null ? m : index[m]) * 3;
    for (let axis = 0; axis < 3; axis += 1) spread += (a[k + axis] - ca[axis]) ** 2 + (b[k + axis] - cb[axis]) ** 2;
  }
  const s0 = Math.sqrt(Math.max(0, e[0]));
  const s1 = Math.sqrt(Math.max(0, e[1]));
  const s2 = Math.sqrt(Math.max(0, e[2]));
  return Math.max(0, spread - 2 * (s0 + s1 + (determinant < 0 ? -s2 : s2)));
}

// Covariance R[j][k] = Σ (b_j − b̄_j)(a_k − ā_k) (rows follow b, columns follow a) and centroids.
function covariance(a, b, n, index, r, ca, cb) {
  let sa0 = 0;
  let sa1 = 0;
  let sa2 = 0;
  let sb0 = 0;
  let sb1 = 0;
  let sb2 = 0;
  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c10 = 0;
  let c11 = 0;
  let c12 = 0;
  let c20 = 0;
  let c21 = 0;
  let c22 = 0;
  for (let m = 0; m < n; m += 1) {
    const k = (index === null ? m : index[m]) * 3;
    const a0 = a[k];
    const a1 = a[k + 1];
    const a2 = a[k + 2];
    const b0 = b[k];
    const b1 = b[k + 1];
    const b2 = b[k + 2];
    sa0 += a0;
    sa1 += a1;
    sa2 += a2;
    sb0 += b0;
    sb1 += b1;
    sb2 += b2;
    c00 += b0 * a0;
    c01 += b0 * a1;
    c02 += b0 * a2;
    c10 += b1 * a0;
    c11 += b1 * a1;
    c12 += b1 * a2;
    c20 += b2 * a0;
    c21 += b2 * a1;
    c22 += b2 * a2;
  }
  r[0] = c00 - (sa0 * sb0) / n;
  r[1] = c01 - (sa1 * sb0) / n;
  r[2] = c02 - (sa2 * sb0) / n;
  r[3] = c10 - (sa0 * sb1) / n;
  r[4] = c11 - (sa1 * sb1) / n;
  r[5] = c12 - (sa2 * sb1) / n;
  r[6] = c20 - (sa0 * sb2) / n;
  r[7] = c21 - (sa1 * sb2) / n;
  r[8] = c22 - (sa2 * sb2) / n;
  ca[0] = sa0 / n;
  ca[1] = sa1 / n;
  ca[2] = sa2 / n;
  cb[0] = sb0 / n;
  cb[1] = sb1 / n;
  cb[2] = sb2 / n;
}

// b_l = R·a_l for the two largest axes; the third completes a right-handed frame, so the result is
// a proper rotation even when the best fit would be a reflection. U = Σ b_l a_lᵀ.
function rotationFromAxes(r, axesA, out) {
  const axesB = AXES_B;
  axesB.fill(0);
  for (let l = 0; l < 2; l += 1) {
    let norm = 0;
    for (let row = 0; row < 3; row += 1) {
      const value = r[row * 3] * axesA[l] + r[row * 3 + 1] * axesA[3 + l] + r[row * 3 + 2] * axesA[6 + l];
      axesB[row * 3 + l] = value;
      norm += value * value;
    }
    const scale = norm > TINY ? 1 / Math.sqrt(norm) : 0;
    for (let row = 0; row < 3; row += 1) axesB[row * 3 + l] *= scale;
  }
  if (!orthonormalize(axesB, 0, 1)) return;
  cross(axesB, 0, 1, 2);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      out[row * 3 + column] = axesB[row * 3] * axesA[column * 3] + axesB[row * 3 + 1] * axesA[column * 3 + 1] + axesB[row * 3 + 2] * axesA[column * 3 + 2];
    }
  }
}

// Eigenvectors of the symmetric M (m00, m01, m02, m11, m12, m22) for the largest and smallest
// eigenvalues, as columns 0 and 2 of `axes` (row-major); column 1 completes a right-handed frame.
// Each comes from the column of adj(M − λI) with the largest diagonal element; the better separated
// eigenvalue keeps its vector and the other is orthogonalized against it.
function eigenAxes(m, e, axes) {
  for (let l = 0; l <= 2; l += 2) {
    const lambda = e[l];
    const a00 = zeroTiny((lambda - m[3]) * (lambda - m[5]) - m[4] * m[4]);
    const a01 = zeroTiny((lambda - m[5]) * m[1] + m[2] * m[4]);
    const a11 = zeroTiny((lambda - m[0]) * (lambda - m[5]) - m[2] * m[2]);
    const a02 = zeroTiny((lambda - m[3]) * m[2] + m[1] * m[4]);
    const a12 = zeroTiny((lambda - m[0]) * m[4] + m[1] * m[2]);
    const a22 = zeroTiny((lambda - m[0]) * (lambda - m[3]) - m[1] * m[1]);
    let v0 = a02;
    let v1 = a12;
    let v2 = a22;
    if (Math.abs(a00) >= Math.abs(a11)) {
      if (Math.abs(a00) >= Math.abs(a22)) {
        v0 = a00;
        v1 = a01;
        v2 = a02;
      }
    } else if (Math.abs(a11) >= Math.abs(a22)) {
      v0 = a01;
      v1 = a11;
      v2 = a12;
    }
    const norm = v0 * v0 + v1 * v1 + v2 * v2;
    const scale = norm > TINY ? 1 / Math.sqrt(norm) : 0;
    axes[l] = v0 * scale;
    axes[3 + l] = v1 * scale;
    axes[6 + l] = v2 * scale;
  }
  const keep = e[0] - e[1] > e[1] - e[2] ? 0 : 2;
  if (!orthonormalize(axes, keep, 2 - keep)) return false;
  cross(axes, 2, 0, 1);
  return true;
}

function zeroTiny(value) {
  return Math.abs(value) <= TINY ? 0 : value;
}

// Makes column `fix` a unit vector orthogonal to column `keep`; when they are (nearly) parallel,
// any perpendicular will do: the one in the plane of keep's two largest components.
function orthonormalize(axes, keep, fix) {
  let dot = 0;
  for (let row = 0; row < 3; row += 1) dot += axes[row * 3 + keep] * axes[row * 3 + fix];
  let norm = 0;
  for (let row = 0; row < 3; row += 1) {
    axes[row * 3 + fix] -= dot * axes[row * 3 + keep];
    norm += axes[row * 3 + fix] ** 2;
  }
  if (norm > TOLERANCE) {
    const scale = 1 / Math.sqrt(norm);
    for (let row = 0; row < 3; row += 1) axes[row * 3 + fix] *= scale;
    return true;
  }
  let smallest = 0;
  let size = 1;
  for (let row = 0; row < 3; row += 1) {
    if (Math.abs(axes[row * 3 + keep]) <= size) {
      size = Math.abs(axes[row * 3 + keep]);
      smallest = row;
    }
  }
  const k = (smallest + 1) % 3;
  const l = (smallest + 2) % 3;
  const length = Math.hypot(axes[k * 3 + keep], axes[l * 3 + keep]);
  if (!(length > TOLERANCE)) return false;
  axes[smallest * 3 + fix] = 0;
  axes[k * 3 + fix] = -axes[l * 3 + keep] / length;
  axes[l * 3 + fix] = axes[k * 3 + keep] / length;
  return true;
}

// Column c = column a × column b.
function cross(axes, a, b, c) {
  const ax = axes[a];
  const ay = axes[3 + a];
  const az = axes[6 + a];
  const bx = axes[b];
  const by = axes[3 + b];
  const bz = axes[6 + b];
  axes[c] = ay * bz - az * by;
  axes[3 + c] = az * bx - ax * bz;
  axes[6 + c] = ax * by - ay * bx;
}

function det3(m) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}
