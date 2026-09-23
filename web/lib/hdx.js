// Hydrogen–deuterium exchange MS: DynamX (state and cluster data), HDExaminer (all results and
// uptake summary) and the long table of Masson et al. (Nat Methods 2019), read into peptide
// uptake per state and exposure, and turned into residue values and significance calls.
//
// Peptides: { protein, start, end, sequence, state, exposure (seconds), uptake (D), sd, n,
// maxUptake }. Exposure 0 is the undeuterated reference; fully deuterated controls ("FD", "MAX",
// "Full-D") are left out of the exposures.
//
// Residue values average the peptides that cover a residue, weighted by 1 / (exchanging
// residues), after dropping each peptide's first two residues (they back-exchange) and its
// prolines (no amide hydrogen), as PyHDX does. Differences are called significant with the hybrid
// test of Hageman & Weis (Anal Chem 2019) when replicate statistics are known: |ΔD| above the
// pooled-SD confidence limit and a Welch t-test below α; otherwise with a fixed ΔD threshold
// (0.5 D per time point after Houde et al. 2011).

import { detectDelimiter, splitCells, toNumber } from './reports.js';

export const HDX_FORMATS = {
  'dynamx-state': 'DynamX state data',
  'dynamx-cluster': 'DynamX cluster data',
  'hdexaminer-results': 'HDExaminer all results',
  'hdexaminer-summary': 'HDExaminer uptake summary',
  masson: 'HDX data table (Masson et al. 2019)',
};

const PROTON = 1.007276;

export function detectHDX(header) {
  const has = (...names) => names.every((name) => header.includes(name));
  if (has('Start', 'End', 'Sequence', 'State', 'Exposure', 'Uptake')) return 'dynamx-state';
  if (has('Start', 'End', 'Sequence', 'State', 'Exposure', 'File', 'z', 'Center')) return 'dynamx-cluster';
  if (has('Protein State', 'Deut Time', 'Start', 'End', 'Sequence') && (has('# Deut') || has('#D'))) return has('Experiment') ? 'hdexaminer-results' : 'hdexaminer-summary';
  if (has('Protein State', 'Deut Time (sec)', '#D')) return 'hdexaminer-summary';
  if (has('Protein state', 'Start', 'End', 'Sequence', 'HDX time (min)', 'Uptake (D)')) return 'masson';
  return null;
}

// "0s", "10.00s", "1.5 min", "FD" → seconds (NaN for fully deuterated controls).
function seconds(value, unit = 's') {
  const text = String(value ?? '').trim();
  if (/^(fd|max|full[- ]?d.*|inf)$/i.test(text)) return NaN;
  const match = text.match(/^([\d.eE+-]+)\s*(s|sec|m|min|h)?$/i);
  if (!match) return NaN;
  const number = Number(match[1]);
  const suffix = (match[2] ?? unit).toLowerCase();
  return suffix.startsWith('h') ? number * 3600 : suffix.startsWith('m') ? number * 60 : number;
}

// Exchangeable amides: all but the N-terminal residue and prolines (DynamX's MaxUptake rule).
export function maxUptakeOf(sequence) {
  const clean = String(sequence ?? '').toUpperCase();
  return Math.max(0, clean.length - 1 - [...clean.slice(1)].filter((residue) => residue === 'P').length);
}

export function parseHDX(text, name = '') {
  const lines = String(text ?? '').split(/\r\n|\n|\r/).filter((line) => line.trim());
  if (lines.length < 2) return null;
  const delimiter = detectDelimiter(lines[0]);
  const header = splitCells(lines[0], delimiter).map((cell) => cell.trim());
  const format = detectHDX(header);
  if (!format) return null;
  const rows = lines.slice(1).map((line) => {
    const cells = splitCells(line, delimiter);
    return Object.fromEntries(header.map((column, index) => [column, (cells[index] ?? '').trim()]));
  });
  let peptides;
  if (format === 'dynamx-state') peptides = fromDynamXState(rows);
  else if (format === 'dynamx-cluster') peptides = fromReplicates(rows.map((row) => ({
    key: peptideKey(row), protein: row.Protein, start: toNumber(row.Start), end: toNumber(row.End), sequence: row.Sequence, modification: row.Modification ?? '', maxUptake: toNumber(row.MaxUptake ?? row['Max Exchangers']),
    state: row.State, exposure: toNumber(row.Exposure) * 60, replicate: row.File, weight: toNumber(row.Inten), mass: toNumber(row.z) * (toNumber(row.Center) - PROTON),
  })), 'mass');
  else if (format === 'hdexaminer-results') peptides = fromReplicates(rows.filter((row) => !/^low$/i.test(row.Confidence ?? '')).map((row) => ({
    key: `${row.Start}|${row.End}|${row.Sequence}`, protein: row.Protein ?? '', start: toNumber(row.Start), end: toNumber(row.End), sequence: row.Sequence, maxUptake: NaN,
    state: row['Protein State'], exposure: seconds(row['Deut Time']), replicate: row.Experiment, weight: toNumber(row['Max Inty']) || 1,
    uptake: /^0(\.0*)?s$/.test(row['Deut Time']) ? 0 : toNumber(row['# Deut'] ?? row['#D']),
  })), 'uptake');
  else if (format === 'hdexaminer-summary') {
    peptides = rows.filter((row) => !/^(max|full-?d)$/i.test(row['Protein State'])).map((row) => ({
      protein: (row.Protein ?? '').trim(), start: toNumber(row.Start), end: toNumber(row.End), sequence: row.Sequence, state: row['Protein State'],
      exposure: seconds(row['Deut Time (sec)'] ?? row['Deut Time']), uptake: toNumber(row['#D']), sd: toNumber(row.Stddev), n: toNumber(row['#Rep']),
      maxUptake: toNumber(row.maxD) || maxUptakeOf(row.Sequence),
    }));
  } else {
    peptides = rows.map((row) => ({
      protein: '', start: toNumber(row.Start), end: toNumber(row.End), sequence: row.Sequence, state: row['Protein state'],
      exposure: seconds(row['HDX time (min)'], 'min'), uptake: toNumber(row['Uptake (D)']), sd: toNumber(row['Uptake SD (D)']), n: NaN, maxUptake: maxUptakeOf(row.Sequence),
    }));
  }
  peptides = peptides.filter((peptide) => Number.isFinite(peptide.start) && Number.isFinite(peptide.end) && Number.isFinite(peptide.exposure) && Number.isFinite(peptide.uptake) && peptide.sequence);
  for (const peptide of peptides) if (!(peptide.maxUptake > 0)) peptide.maxUptake = maxUptakeOf(peptide.sequence);
  const states = [...new Set(peptides.map((peptide) => peptide.state))];
  const exposures = [...new Set(peptides.map((peptide) => peptide.exposure))].sort((a, b) => a - b);
  return { format, label: HDX_FORMATS[format], name, peptides, states, exposures };
}

function peptideKey(row) {
  return `${row.Start}|${row.End}|${row.Sequence}|${row.Modification ?? ''}|${row.Fragment ?? ''}`;
}

function fromDynamXState(rows) {
  return rows.map((row) => ({
    protein: row.Protein, start: toNumber(row.Start), end: toNumber(row.End), sequence: row.Sequence, modification: row.Modification ?? '', state: row.State,
    exposure: toNumber(row.Exposure) * 60, uptake: toNumber(row.Uptake), sd: toNumber(row['Uptake SD']), n: NaN, maxUptake: toNumber(row.MaxUptake),
  }));
}

// Replicate-level rows (DynamX clusters: masses per charge state; HDExaminer: #D per charge
// state): intensity-weighted mean per replicate, uptake against the undeuterated mass (DynamX),
// then mean, SD and n over replicates.
function fromReplicates(rows, measure) {
  const replicates = new Map();
  for (const row of rows) {
    if (!Number.isFinite(row[measure]) || !Number.isFinite(row.exposure)) continue;
    const key = `${row.key}|${row.state}|${row.exposure}|${row.replicate}`;
    let item = replicates.get(key);
    if (!item) {
      item = { ...row, sum: 0, weights: 0 };
      replicates.set(key, item);
    }
    const weight = row.weight > 0 ? row.weight : 1;
    item.sum += row[measure] * weight;
    item.weights += weight;
  }
  const reference = new Map();
  if (measure === 'mass') {
    for (const item of replicates.values()) {
      if (item.exposure !== 0) continue;
      const key = `${item.key}|${item.state}`;
      const entry = reference.get(key) ?? { sum: 0, count: 0 };
      entry.sum += item.sum / item.weights;
      entry.count += 1;
      reference.set(key, entry);
    }
  }
  const groups = new Map();
  for (const item of replicates.values()) {
    let value = item.sum / item.weights;
    if (measure === 'mass') {
      const base = reference.get(`${item.key}|${item.state}`);
      if (!base) continue;
      value -= base.sum / base.count;
    }
    const key = `${item.key}|${item.state}|${item.exposure}`;
    if (!groups.has(key)) groups.set(key, { ...item, values: [] });
    groups.get(key).values.push(value);
  }
  return [...groups.values()].map((group) => {
    const n = group.values.length;
    const mean = group.values.reduce((sum, value) => sum + value, 0) / n;
    const sd = n > 1 ? Math.sqrt(group.values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)) : NaN;
    return { protein: group.protein, start: group.start, end: group.end, sequence: group.sequence, modification: group.modification ?? '', state: group.state, exposure: group.exposure, uptake: group.exposure === 0 ? 0 : mean, sd: group.exposure === 0 ? 0 : sd, n, maxUptake: group.maxUptake };
  });
}

/* ---------- Differences and significance ---------- */

// Per peptide (a modified form, such as an oxidized one, is a peptide of its own): uptake of
// `state` (and `reference`) at `exposure`, or summed over the exposures after 0 that both states
// have when exposure is 'all'. Returns [{ peptide, a, b, delta, relative, significant, p }].
export function peptideDifferences(data, { state, reference = null, exposure = 'all', alpha = 0.01, threshold = null } = {}) {
  const byKey = new Map();
  for (const peptide of data.peptides) {
    if (peptide.exposure === 0) continue;
    // The sum over exposures leaves out sub-second in-exchange controls (HaDeX's 0.001 min).
    if (exposure === 'all' ? peptide.exposure < 1 : peptide.exposure !== exposure) continue;
    if (peptide.state !== state && peptide.state !== reference) continue;
    const key = `${peptide.start}|${peptide.end}|${peptide.sequence}|${peptide.modification ?? ''}`;
    if (!byKey.has(key)) byKey.set(key, { start: peptide.start, end: peptide.end, sequence: peptide.sequence, modification: peptide.modification ?? '', maxUptake: peptide.maxUptake, a: [], b: [] });
    byKey.get(key)[peptide.state === reference ? 'a' : 'b'].push(peptide);
  }
  const combine = (items) => (items.length ? {
    uptake: items.reduce((sum, item) => sum + item.uptake, 0),
    variance: items.reduce((sum, item) => sum + (Number.isFinite(item.sd) ? item.sd ** 2 : NaN), 0),
    n: Math.min(...items.map((item) => item.n)),
    count: items.length,
  } : null);
  // Summed differences compare like with like: a time point missing in one state is left out of
  // both sums.
  const shared = (entry) => {
    if (!reference || exposure !== 'all') return entry;
    const times = new Set(entry.a.map((item) => item.exposure));
    const both = new Set(entry.b.map((item) => item.exposure).filter((time) => times.has(time)));
    return { ...entry, a: entry.a.filter((item) => both.has(item.exposure)), b: entry.b.filter((item) => both.has(item.exposure)) };
  };
  const rows = [...byKey.values()].map(shared).map((entry) => ({ ...entry, a: combine(entry.a), b: combine(entry.b) })).filter((entry) => entry.b && (!reference || entry.a));
  const pool = (side) => {
    let numerator = 0;
    let denominator = 0;
    for (const row of rows) {
      const item = row[side];
      if (!item || !Number.isFinite(item.variance) || !(item.n > 1)) continue;
      numerator += (item.n - 1) * item.variance;
      denominator += item.n - 1;
    }
    return denominator ? { sd: Math.sqrt(numerator / denominator), n: rows.find((row) => row[side]?.n > 1)?.[side].n } : null;
  };
  const pooledA = reference ? pool('a') : null;
  const pooledB = pool('b');
  const replicates = Boolean(pooledA && pooledB && !threshold);
  const cutoff = threshold ?? (exposure === 'all' ? 1.1 : 0.5);
  let limit = cutoff;
  if (replicates) {
    const sem = Math.sqrt(pooledA.sd ** 2 / pooledA.n + pooledB.sd ** 2 / pooledB.n);
    limit = studentTQuantile(1 - alpha / 2, pooledA.n + pooledB.n - 2) * sem;
  }
  return {
    rows: rows.map((row) => {
      const exposures = exposure === 'all' ? row.b.count : 1;
      const maxUptake = row.maxUptake * exposures;
      if (!reference) return { ...row, delta: row.b.uptake, relative: row.b.uptake / maxUptake, significant: false, p: NaN };
      const delta = row.b.uptake - row.a.uptake;
      let p = NaN;
      if (replicates && row.a.n > 1 && row.b.n > 1 && Number.isFinite(row.a.variance) && Number.isFinite(row.b.variance)) p = welchT(row.a.uptake, row.a.variance, row.a.n, row.b.uptake, row.b.variance, row.b.n);
      const significant = Math.abs(delta) > limit && (!replicates || !(p >= alpha));
      return { ...row, delta, relative: delta / maxUptake, significant, p };
    }),
    limit,
    test: !reference ? 'uptake' : replicates ? 'hybrid' : 'threshold',
  };
}

// Residue values from peptide values: positions are the chain indices a peptide covers
// ({ peptide index → { start, end } } from sequence matching); the first two residues and prolines
// are left out, and shorter peptides weigh more.
export function residueValues(rows, positions, sequence, { value = 'relative', significantOnly = false } = {}) {
  const sums = new Map();
  rows.forEach((row, index) => {
    const match = positions.get(index);
    if (!match) return;
    const exchanging = [];
    for (let position = match.start + 2; position <= match.end; position += 1) if (sequence[position] !== 'P') exchanging.push(position);
    if (!exchanging.length) return;
    const weight = 1 / exchanging.length;
    const amount = significantOnly && !row.significant ? 0 : row[value];
    if (!Number.isFinite(amount)) return;
    for (const position of exchanging) {
      const entry = sums.get(position) ?? { sum: 0, weight: 0 };
      entry.sum += amount * weight;
      entry.weight += weight;
      sums.set(position, entry);
    }
  });
  return new Map([...sums].map(([position, entry]) => [position, entry.sum / entry.weight]));
}

function welchT(meanA, varianceA, nA, meanB, varianceB, nB) {
  const a = varianceA / nA;
  const b = varianceB / nB;
  const t = (meanB - meanA) / Math.sqrt(a + b);
  const df = (a + b) ** 2 / (a ** 2 / (nA - 1) + b ** 2 / (nB - 1));
  if (!Number.isFinite(t) || !Number.isFinite(df)) return NaN;
  return 2 * (1 - studentTCDF(Math.abs(t), df));
}

// Student's t distribution through the regularized incomplete beta function.
export function studentTCDF(t, df) {
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

export function studentTQuantile(probability, df) {
  let low = 0;
  let high = 1000;
  for (let step = 0; step < 100; step += 1) {
    const middle = (low + high) / 2;
    if (studentTCDF(middle, df) < probability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaFraction(x, a, b)) / a;
  return 1 - (front * betaFraction(1 - x, b, a)) / b;
}

// Lentz's continued fraction for the incomplete beta function.
function betaFraction(x, a, b) {
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let result = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let numerator = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    result *= d * c;
    numerator = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return result;
}

function logGamma(value) {
  const coefficients = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = value;
  let y = value;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = 1.000000000190015;
  for (const coefficient of coefficients) series += coefficient / ++y;
  return -tmp + Math.log((2.5066282746310005 * series) / x);
}
