// Residue conservation from a multiple sequence alignment, scored per query residue.
//
// The default score is the Jensen–Shannon divergence of Capra & Singh (Bioinformatics 2007;
// 23:1875–1882, doi:10.1093/bioinformatics/btm270), with the defaults of their
// score_conservation.py: Henikoff & Henikoff position-based sequence weights (J Mol Biol 1994;
// 243:574, doi:10.1016/0022-2836(94)90032-9); B read as D, Z as Q and X as a gap; weighted
// residue frequencies with a pseudocount of 1e-7; divergence in bits from the tool's BLOSUM62
// background; the score multiplied by 1 − the weighted gap fraction; columns with more than 30%
// gaps (unweighted) left unscored; and window smoothing, λ·score + (1 − λ)·mean of the scored
// columns up to 3 on either side (λ = 0.5), which the tool applies only to columns at least 3
// from either end of the alignment. The alternative is 1 − the tool's normalized Shannon entropy.
// Both read higher = more conserved, from 0 to about 1.
//
// Grades 1–9 (9 = most conserved) take the ConSurf color scale (Ashkenazy et al. NAR 2016): by
// default each grade holds a ninth of the scored residues; ConSurf's own binning of standardized
// scores (Glaser et al. Bioinformatics 2003; Landau et al. NAR 2005) is an option.

const AMINO_ACIDS = 'ARNDCQEGHILKMFPSTWYV';
const GAP = 20;
const SYMBOLS = 21;
const PSEUDOCOUNT = 1e-7;

// The tool's BLOSUM62 background (blosum62.distribution, in AMINO_ACIDS order). It sums to 1.002
// and is used as published so that the scores match the tool's.
const BACKGROUND = Float64Array.of(
  0.078, 0.051, 0.041, 0.052, 0.024, 0.034, 0.059, 0.083, 0.025, 0.062,
  0.092, 0.056, 0.024, 0.044, 0.043, 0.059, 0.055, 0.014, 0.034, 0.072,
);

// ASCII code → residue class (0–19) or GAP. B, Z and X follow the tool; selenocysteine (U),
// pyrrolysine (O) and the I/L code J take their nearest standard residue, as in align.js; '*',
// '.' and anything else count as gaps.
const CLASS_OF = buildClasses();

export const CONSERVATION_DEFAULTS = Object.freeze({
  method: 'jsd',
  window: 3,
  windowLambda: 0.5,
  gapCutoff: 0.3,
  gapPenalty: true,
  weighting: true,
  maxSequences: Infinity,
  binning: 'quantile',
});

function buildClasses() {
  const table = new Uint8Array(128).fill(GAP);
  const assign = (letter, residue) => {
    const code = AMINO_ACIDS.indexOf(residue);
    table[letter.charCodeAt(0)] = code;
    table[letter.toLowerCase().charCodeAt(0)] = code;
  };
  for (const letter of AMINO_ACIDS) assign(letter, letter);
  for (const [letter, residue] of [['B', 'D'], ['Z', 'Q'], ['U', 'C'], ['O', 'K'], ['J', 'L']]) assign(letter, residue);
  return table;
}

// ---------------------------------------------------------------------------------------------
// Parsing

const CLUSTAL_HEADER = /^(CLUSTALW?|MUSCLE|PROBCONS|MSAPROBS|KALIGN)\b/i;
const CONSERVATION_LINE = /^[*:.\s]+$/;
const BLOCK_LINE = /^(\S+)\s+(\S+)(?:\s+\d+)?$/;
const PLAIN_FASTA = /^[A-Z*-]*$/;
const PLAIN_A3M = /^[A-Z-]*$/;

// Reads A3M, aligned FASTA, Stockholm or Clustal text; the first sequence is the query. Rows keep
// every alignment column, including columns where the query has a gap (the tool computes weights
// and windows over all columns); `columns` gives the column of each query residue. Rows are
// uppercase with '-' for gaps. Records whose length differs from the query's are dropped and
// counted in `skipped`. Returns null when there is no sequence or the query has no residue.
export function parseAlignment(text, name = '') {
  let source = String(text ?? '');
  if (source.includes('\0')) source = source.replace(/\0/g, '');
  const lines = source.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const first = lines.find((line) => line.trim())?.trim();
  if (!first) return null;
  let parsed;
  if (/^#\s*STOCKHOLM/i.test(first)) parsed = readBlocks(lines, 'stockholm');
  else if (CLUSTAL_HEADER.test(first)) parsed = readBlocks(lines, 'clustal');
  else if (lines.some((line) => line.trimStart().startsWith('>'))) parsed = readFasta(lines, name);
  else parsed = readBlocks(lines, /\.(sto|stk|sth|stockholm)$/i.test(name) ? 'stockholm' : 'clustal');
  return parsed ? assemble(parsed) : null;
}

// A3M keeps uppercase letters and '-' as columns and drops lowercase insertions, '.' and '*'.
// Aligned FASTA keeps every letter as a column, with '.' and '-' as gaps. The two readings agree
// unless records carry insertions; records of equal length are read as aligned FASTA (A2M
// included, so no query residue is lost), otherwise the reading that keeps more records wins. An
// .a3m or .a2m name only labels an alignment that reads the same either way.
function readFasta(lines, name) {
  const names = [];
  const raws = [];
  let parts = null;
  let chainLengths = null;
  const flush = () => {
    if (parts) raws.push(parts.join(''));
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === '>') {
      flush();
      names.push(line.slice(1).trim());
      parts = [];
    } else if (line[0] === '#') {
      if (!names.length && !chainLengths) chainLengths = colabfoldLengths(line);
    } else if (line[0] !== ';' && parts) {
      parts.push(line);
    }
  }
  flush();
  if (!raws.length) return null;
  let fastaRows = null;
  if (raws.every((raw) => raw.length === raws[0].length)) {
    fastaRows = raws.map(cleanFasta);
    if (countLength(fastaRows) === raws.length) {
      const label = /\.a[23]m$/i.test(name) && !raws.some((raw) => /[a-z.]/.test(raw)) ? 'a3m' : 'fasta';
      return { format: label, names, rows: fastaRows, chainLengths };
    }
  }
  const a3mRows = raws.map(cleanA3M);
  const a3mKept = countLength(a3mRows);
  if (a3mKept === raws.length) return { format: 'a3m', names, rows: a3mRows, chainLengths };
  fastaRows ??= raws.map(cleanFasta);
  if (a3mKept >= countLength(fastaRows)) return { format: 'a3m', names, rows: a3mRows, chainLengths };
  return { format: 'fasta', names, rows: fastaRows, chainLengths };
}

// ColabFold complex MSAs start with "#len1,len2<tab>card1,card2": the chain lengths of the
// concatenated query.
function colabfoldLengths(line) {
  const lengths = line.slice(1).trim().split(/\s+/)[0].split(',').map(Number);
  return lengths.length && lengths.every((value) => Number.isInteger(value) && value > 0) ? lengths : null;
}

// Stockholm and Clustal: interleaved "name sequence" blocks. '#' lines (Stockholm markup), the
// Clustal header, conservation lines and trailing residue counts are skipped; '//' ends the
// (first) alignment.
function readBlocks(lines, format) {
  const sequences = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#' || CONSERVATION_LINE.test(line)) continue;
    if (line.startsWith('//')) break;
    if (!sequences.size && CLUSTAL_HEADER.test(line)) continue;
    const match = BLOCK_LINE.exec(line);
    if (!match) continue;
    const parts = sequences.get(match[1]);
    if (parts) parts.push(match[2]);
    else sequences.set(match[1], [match[2]]);
  }
  if (!sequences.size) return null;
  return { format, names: [...sequences.keys()], rows: [...sequences.values()].map((parts) => cleanFasta(parts.join(''))), chainLengths: null };
}

function cleanFasta(raw) {
  if (PLAIN_FASTA.test(raw)) return raw;
  return raw.replace(/[^A-Za-z*.~-]/g, '').toUpperCase().replace(/[.~]/g, '-');
}

function cleanA3M(raw) {
  return PLAIN_A3M.test(raw) ? raw : raw.replace(/[^A-Z-]/g, '');
}

// Rows as long as the first (the query).
function countLength(rows) {
  let count = 0;
  for (const row of rows) if (row.length === rows[0].length) count += 1;
  return count;
}

function assemble({ format, names, rows, chainLengths }) {
  const width = rows[0].length;
  const keptNames = [];
  const keptRows = [];
  rows.forEach((row, index) => {
    if (row.length !== width) return;
    keptNames.push(names[index]);
    keptRows.push(row);
  });
  const columns = queryColumns(keptRows[0]);
  if (!columns.length) return null;
  let query = '';
  for (const column of columns) query += keptRows[0][column];
  const total = chainLengths?.reduce((sum, length) => sum + length, 0);
  return {
    format,
    names: keptNames,
    rows: keptRows,
    query,
    columns,
    chainLengths: total === width && columns.length === width ? chainLengths : null,
    skipped: rows.length - keptRows.length,
  };
}

// Columns holding a query residue; '-' and '*' are not residues.
function queryColumns(row) {
  const columns = [];
  for (let index = 0; index < row.length; index += 1) {
    const char = row.charCodeAt(index);
    if (char !== 45 && char !== 42) columns.push(index);
  }
  return Int32Array.from(columns);
}

// ---------------------------------------------------------------------------------------------
// Scores

// Scores each query residue (NaN where the column is unscored) and grades it 1–9 (0 = unscored).
// ColabFold complex alignments (chainLengths) are scored and graded chain by chain, like separate
// alignments.
// A sequence without a residue in the scored chain is ignored (paired-MSA filler rows); the tool
// would count it as gaps. `sequences` is the number of sequences used; `effectiveSequences` is
// Neff as HH-suite defines it (Remmert et al. 2012): the mean over query columns of exp(Shannon
// entropy) of the weighted residue frequencies, 1 for identical sequences and at most 20.
// `segments` repeats both per chain, with the chain's query residues as [start, end).
export function conservationScores(alignment, options = {}) {
  const parameters = resolveParameters(options ?? {});
  const rows = alignment?.rows ?? [];
  const width = rows[0]?.length ?? 0;
  const columns = alignment?.columns ?? queryColumns(rows[0] ?? '');
  const scores = new Float64Array(columns.length).fill(NaN);
  const grades = new Uint8Array(columns.length);
  const result = { scores, grades, sequences: 0, effectiveSequences: 0, method: parameters.method, parameters, segments: [] };
  if (!rows.length || !width || !columns.length) return result;

  const isQuery = new Uint8Array(width);
  for (const column of columns) isQuery[column] = 1;
  const columnScores = new Float64Array(width).fill(NaN);
  const used = new Uint8Array(rows.length);
  let neffSum = 0;
  let neffColumns = 0;
  for (const [start, end] of segmentsOf(alignment, width)) {
    const segment = scoreSegment(rows, start, end, isQuery, parameters);
    columnScores.set(segment.scores, start);
    for (const index of segment.selected) used[index] = 1;
    neffSum += segment.neffSum;
    neffColumns += segment.neffColumns;
    const first = lowerBound(columns, start);
    const last = lowerBound(columns, end);
    for (let residue = first; residue < last; residue += 1) scores[residue] = columnScores[columns[residue]];
    grades.set(conservationGrades(scores.subarray(first, last), { binning: parameters.binning }), first);
    result.segments.push({
      start: first,
      end: last,
      sequences: segment.selected.length,
      effectiveSequences: segment.neffColumns ? segment.neffSum / segment.neffColumns : 0,
    });
  }
  result.sequences = used.reduce((sum, flag) => sum + flag, 0);
  result.effectiveSequences = neffColumns ? neffSum / neffColumns : 0;
  return result;
}

function resolveParameters(options) {
  const method = String(options.method ?? CONSERVATION_DEFAULTS.method).toLowerCase();
  if (method !== 'jsd' && method !== 'entropy') throw new RangeError(`Unknown conservation method "${options.method}"; use "jsd" or "entropy".`);
  const window = Math.floor(Number(options.window ?? CONSERVATION_DEFAULTS.window));
  const maxSequences = Math.floor(Number(options.maxSequences ?? Infinity));
  return Object.freeze({
    method,
    window: Number.isFinite(window) ? Math.max(0, window) : CONSERVATION_DEFAULTS.window,
    windowLambda: unitInterval(options.windowLambda, CONSERVATION_DEFAULTS.windowLambda),
    gapCutoff: unitInterval(options.gapCutoff, CONSERVATION_DEFAULTS.gapCutoff),
    gapPenalty: Boolean(options.gapPenalty ?? CONSERVATION_DEFAULTS.gapPenalty),
    weighting: Boolean(options.weighting ?? CONSERVATION_DEFAULTS.weighting),
    maxSequences: maxSequences >= 1 ? maxSequences : Infinity,
    binning: options.binning === 'consurf' ? 'consurf' : 'quantile',
    background: 'BLOSUM62',
    pseudocount: PSEUDOCOUNT,
  });
}

function unitInterval(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
}

function segmentsOf(alignment, width) {
  const lengths = alignment?.chainLengths;
  if (!Array.isArray(lengths) || lengths.length < 2 || lengths.reduce((sum, length) => sum + length, 0) !== width) return [[0, width]];
  let start = 0;
  return lengths.map((length) => {
    start += length;
    return [start - length, start];
  });
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

// Column scores for columns [start, end) of the rows, as the tool computes them for an
// alignment of just those columns.
function scoreSegment(rows, start, end, isQuery, parameters) {
  const width = end - start;
  const selected = selectRows(rows, start, end, parameters.maxSequences);
  const count = selected.length;
  const scores = new Float64Array(width).fill(NaN);
  if (!count) return { scores, selected, neffSum: 0, neffColumns: 0 };

  const { codes, counts } = encode(rows, selected, start, width);
  const weights = parameters.weighting ? henikoffWeights(codes, counts, count, width) : new Float64Array(count).fill(1);
  const frequencies = parameters.weighting ? weightedCounts(codes, weights, count, width) : Float64Array.from(counts);
  let total = 0;
  for (const weight of weights) total += weight;

  const raw = new Float64Array(width);
  const scored = new Uint8Array(width);
  const normalizer = Math.log(Math.max(2, Math.min(SYMBOLS, count)));
  let neffSum = 0;
  let neffColumns = 0;
  for (let column = 0; column < width; column += 1) {
    const base = column * SYMBOLS;
    if (isQuery[start + column]) {
      const neff = columnNeff(frequencies, base);
      if (neff > 0) {
        neffSum += neff;
        neffColumns += 1;
      }
    }
    if (counts[base + GAP] / count > parameters.gapCutoff) continue;
    let score = parameters.method === 'entropy' ? entropyScore(frequencies, base, total, normalizer) : divergence(frequencies, base);
    if (parameters.gapPenalty) score *= 1 - frequencies[base + GAP] / total;
    raw[column] = score;
    scored[column] = 1;
  }
  const smoothed = smooth(raw, scored, parameters.window, parameters.windowLambda);
  for (let column = 0; column < width; column += 1) if (scored[column]) scores[column] = smoothed[column];
  return { scores, selected, neffSum, neffColumns };
}

const RESIDUE = /[ACDEFGHIKLMNPQRSTVWYBZUOJacdefghiklmnpqrstvwybzuoj]/g;

// Rows with at least one residue in [start, end), the query first. Above maxSequences, rows are
// taken at even steps through the alignment (always including the query), so the subset is
// deterministic and spans the whole E-value-ordered list rather than just the closest hits.
function selectRows(rows, start, end, maxSequences) {
  const kept = [];
  rows.forEach((row, index) => {
    RESIDUE.lastIndex = start;
    const match = RESIDUE.exec(row);
    if (index === 0 || (match && match.index < end)) kept.push(index);
  });
  if (kept.length <= maxSequences) return Int32Array.from(kept);
  const step = kept.length / maxSequences;
  return Int32Array.from({ length: maxSequences }, (_, index) => kept[Math.floor(index * step)]);
}

// Residue classes, one byte per row and column (row-major), plus per-column class counts.
function encode(rows, selected, start, width) {
  const codes = new Uint8Array(selected.length * width);
  const counts = new Int32Array(width * SYMBOLS);
  for (let sequence = 0; sequence < selected.length; sequence += 1) {
    const row = rows[selected[sequence]];
    const offset = sequence * width;
    for (let column = 0; column < width; column += 1) {
      const char = row.charCodeAt(start + column);
      const code = char < 128 ? CLASS_OF[char] : GAP;
      codes[offset + column] = code;
      counts[column * SYMBOLS + code] += 1;
    }
  }
  return { codes, counts };
}

// Henikoff & Henikoff (1994): in each column a residue shared by n sequences, among r residue
// types present, adds 1 / (n·r) to each of those sequences; gaps add nothing. The weights are
// averaged over all columns, so each column with any residue contributes a total of 1 / width.
function henikoffWeights(codes, counts, count, width) {
  const share = new Float64Array(width * SYMBOLS);
  for (let column = 0; column < width; column += 1) {
    const base = column * SYMBOLS;
    let types = 0;
    for (let residue = 0; residue < GAP; residue += 1) if (counts[base + residue]) types += 1;
    for (let residue = 0; residue < GAP; residue += 1) {
      if (counts[base + residue]) share[base + residue] = 1 / (counts[base + residue] * types);
    }
  }
  const weights = new Float64Array(count);
  for (let sequence = 0; sequence < count; sequence += 1) {
    const offset = sequence * width;
    let sum = 0;
    for (let column = 0; column < width; column += 1) sum += share[column * SYMBOLS + codes[offset + column]];
    weights[sequence] = sum / width;
  }
  return weights;
}

function weightedCounts(codes, weights, count, width) {
  const frequencies = new Float64Array(width * SYMBOLS);
  for (let sequence = 0; sequence < count; sequence += 1) {
    const offset = sequence * width;
    const weight = weights[sequence];
    for (let column = 0; column < width; column += 1) frequencies[column * SYMBOLS + codes[offset + column]] += weight;
  }
  return frequencies;
}

// Jensen–Shannon divergence (bits) between the column's residue distribution, gaps left out and
// a pseudocount added to each residue, and the background.
function divergence(frequencies, base) {
  let residues = 0;
  for (let residue = 0; residue < GAP; residue += 1) residues += frequencies[base + residue];
  const scale = 1 / (residues + GAP * PSEUDOCOUNT);
  let sum = 0;
  for (let residue = 0; residue < GAP; residue += 1) {
    const p = (frequencies[base + residue] + PSEUDOCOUNT) * scale;
    const q = BACKGROUND[residue];
    const m = 0.5 * (p + q);
    sum += p * Math.log2(p / m) + q * Math.log2(q / m);
  }
  return 0.5 * sum;
}

// 1 − Shannon entropy over the 20 residues and the gap (pseudocount on each), divided by
// ln(min(21, sequences)) as the tool does: 1 for an invariant column, 0 for the most variable.
// Pseudocounts can push the entropy a hair past the maximum, so the score is clamped at 0.
function entropyScore(frequencies, base, total, normalizer) {
  const scale = 1 / (total + SYMBOLS * PSEUDOCOUNT);
  let entropy = 0;
  for (let symbol = 0; symbol < SYMBOLS; symbol += 1) {
    const p = (frequencies[base + symbol] + PSEUDOCOUNT) * scale;
    entropy -= p * Math.log(p);
  }
  return Math.max(0, 1 - entropy / normalizer);
}

function columnNeff(frequencies, base) {
  let residues = 0;
  for (let residue = 0; residue < GAP; residue += 1) residues += frequencies[base + residue];
  if (!(residues > 0)) return 0;
  let entropy = 0;
  for (let residue = 0; residue < GAP; residue += 1) {
    const p = frequencies[base + residue] / residues;
    if (p > 0) entropy -= p * Math.log(p);
  }
  return Math.exp(entropy);
}

// λ·score + (1 − λ)·(mean of the other scored columns within `window`). As in the tool, only
// columns with a full window inside the alignment are smoothed; the first and last `window`
// columns keep their own score.
function smooth(raw, scored, window, lambda) {
  if (window <= 0) return raw;
  const smoothed = Float64Array.from(raw);
  for (let column = window; column < raw.length - window; column += 1) {
    if (!scored[column]) continue;
    let sum = 0;
    let terms = 0;
    for (let other = column - window; other <= column + window; other += 1) {
      if (other === column || !scored[other]) continue;
      sum += raw[other];
      terms += 1;
    }
    if (terms) smoothed[column] = (1 - lambda) * (sum / terms) + lambda * raw[column];
  }
  return smoothed;
}

// ---------------------------------------------------------------------------------------------
// Grades

// ConSurf's nine grades applied to standardized scores (NaN → 0). ConSurf standardizes Rate4Site
// scores to mean 0 and SD 1, where negative = conserved; with c = −(score − mean) / SD the same
// holds here. The bin width is |min c| / 4.5: grade 9 is [min c, min c + width), grade 8 the next
// bin and so on, so grade 5 is centred on the mean; everything from min c + 8·width up is grade 1,
// the wider bin ConSurf keeps for the long variable tail. The most conserved residue always gets
// 9. Grades are relative to the scored residues of this alignment; if all scores are equal they
// are all 5.
// Grades 1–9 for scores (NaN = unscored, grade 0). 'quantile' (the default) gives each grade a
// ninth of the scored residues, so grade 9 is the most conserved 11% of the protein: Jensen–
// Shannon scores are not distributed like Rate4Site rates, and ConSurf's binning ('consurf')
// leaves most of them in the pale middle grades when one residue stands out. Ties share a grade.
export function conservationGrades(scores, options = {}) {
  if ((options.binning ?? 'quantile') === 'consurf') return consurfGrades(scores);
  const grades = new Uint8Array(scores.length);
  const scored = [];
  scores.forEach((score, index) => {
    if (!Number.isNaN(score)) scored.push(index);
  });
  if (!scored.length) return grades;
  scored.sort((a, b) => scores[a] - scores[b]);
  let start = 0;
  while (start < scored.length) {
    let end = start;
    while (end + 1 < scored.length && scores[scored[end + 1]] === scores[scored[start]]) end += 1;
    // The mid-rank of a run of ties, as a fraction of the scored residues.
    const rank = (start + end + 1) / 2 / scored.length;
    const grade = Math.min(9, Math.max(1, Math.ceil(rank * 9)));
    for (let position = start; position <= end; position += 1) grades[scored[position]] = scored.length === end - start + 1 ? 5 : grade;
    start = end + 1;
  }
  return grades;
}

function consurfGrades(scores) {
  const grades = new Uint8Array(scores.length);
  let sum = 0;
  let count = 0;
  for (const score of scores) {
    if (Number.isNaN(score)) continue;
    sum += score;
    count += 1;
  }
  if (!count) return grades;
  const mean = sum / count;
  let variance = 0;
  for (const score of scores) if (!Number.isNaN(score)) variance += (score - mean) ** 2;
  const sd = Math.sqrt(variance / count);
  let lowest = Infinity;
  for (const score of scores) if (!Number.isNaN(score)) lowest = Math.min(lowest, (mean - score) / sd);
  if (!(sd > 0) || !(lowest < 0)) {
    scores.forEach((score, index) => {
      if (!Number.isNaN(score)) grades[index] = 5;
    });
    return grades;
  }
  const width = -lowest / 4.5;
  scores.forEach((score, index) => {
    if (Number.isNaN(score)) return;
    const c = (mean - score) / sd;
    let grade = 1;
    for (let bin = 0; bin < 9; bin += 1) {
      if (c >= lowest + bin * width && c < lowest + (bin + 1) * width) {
        grade = 9 - bin;
        break;
      }
    }
    grades[index] = grade;
  });
  return grades;
}
