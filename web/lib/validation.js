// wwPDB validation reports (as reduced by the server's /api/fetch/validation) mapped onto a
// model: per-residue outlier criteria in the style of the report's residue-property plot, fit to
// density (RSRZ and RSCC for X-ray, Q-score for cryo-EM), and clash pairs for drawing.

export const RSRZ_OUTLIER = 2;
export const RSCC_POOR = 0.8;
export const QSCORE_POOR = 0.4;

// Geometry outlier elements counted as one criterion each, as in the report's residue plot.
const GEOMETRY = ['bond-outlier', 'angle-outlier', 'chiral-outlier', 'plane-outlier'];
const LIGAND_GEOMETRY = ['mog-bond-outlier', 'mog-angle-outlier', 'mog-torsion-outlier', 'mog-ring-outlier'];

export const VALIDATION_LEVELS = [
  { label: 'No outliers', color: '#4fb286' },
  { label: '1 criterion', color: '#e8d44d' },
  { label: '2 criteria', color: '#f39c3d' },
  { label: '3 or more', color: '#e0474c' },
];

function residueLookupKey(chain, number, iCode) {
  return `${chain}:${number}${iCode || ''}`;
}

function numberValue(values, names) {
  for (const name of names) {
    const value = values?.[name];
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

// report: server JSON; model: a parsed model with residues (chain, resSeq, iCode, key, atoms).
// Returns { summary, residues: Map(residue key → record), clashes: [{ atomA, atomB, overlap }],
// outlierKeys: Set, unmatched }.
export function mapValidation(report, model, options = {}) {
  const modelNumber = options.modelNumber ?? model.number ?? 1;
  const byKey = new Map();
  for (const residue of model.residues) byKey.set(residueLookupKey(residue.chain, residue.resSeq, residue.iCode), residue);
  const residues = new Map();
  let unmatched = 0;
  for (const item of report.residues ?? []) {
    if ((item.model ?? 1) !== modelNumber) continue;
    const residue = byKey.get(residueLookupKey(item.chain, item.resnum, item.icode));
    if (!residue) {
      unmatched += 1;
      continue;
    }
    const existing = residues.get(residue.key);
    const record = describeResidue(item);
    // Alternate conformations are reported separately; keep the worse one.
    if (!existing || record.criteria.length > existing.criteria.length) residues.set(residue.key, record);
  }
  const clashes = [];
  for (const clash of report.clashes ?? []) {
    if ((clash.a.model ?? 1) !== modelNumber) continue;
    const atomA = findAtom(byKey, clash.a);
    const atomB = findAtom(byKey, clash.b);
    if (atomA && atomB) clashes.push({ atomA, atomB, overlap: clash.overlap, distance: clash.distance });
  }
  const outlierKeys = new Set([...residues].filter(([, record]) => record.criteria.length).map(([key]) => key));
  return { summary: summarizeEntry(report.entry ?? {}), residues, clashes, outlierKeys, unmatched };
}

function findAtom(byKey, side) {
  const residue = byKey.get(residueLookupKey(side.chain, side.resnum, side.icode));
  if (!residue) return null;
  return heavyAtomFor(residue, String(side.atom).toUpperCase());
}

// MolProbity reports clashes on the hydrogens Reduce adds, which X-ray models lack; a hydrogen is
// drawn from the heavy atom it is bonded to, found from PDB naming (HD21 → ND2 or CD2, HB2 → CB,
// H → N, H5'' → C5') or, in ligands, from the atom it is usually named after (H12 or H121 → C12,
// HN1 → N1).
export function heavyAtomFor(residue, name) {
  const byName = new Map(residue.atoms.map((atom) => [atom.name.toUpperCase(), atom]));
  if (byName.has(name)) return byName.get(name);
  if (!/^[HD]/.test(name)) return null;
  const rest = name.slice(1);
  if (!rest) return byName.get('N') ?? null;
  const candidates = [];
  if (/^[CNOS]\d+'*$/.test(rest)) candidates.push(rest);
  const numeric = rest.match(/^(\d+)('*)$/);
  if (numeric) {
    for (let digits = numeric[1]; digits; digits = digits.slice(0, -1)) {
      for (const element of ['C', 'N', 'O', 'S']) candidates.push(`${element}${digits}${numeric[2]}`);
    }
  }
  const prime = rest.match(/^(O?)(\d)('+)$/);
  if (prime) candidates.push(`${prime[1] || 'C'}${prime[2]}'`, `O${prime[2]}'`, `C${prime[2]}'`);
  const match = rest.match(/^([A-Z])(\d)?(\d)?$/);
  if (match) {
    const [, letter, first, second] = match;
    const suffixes = second ? [`${letter}${first}`] : first ? [`${letter}${first}`, letter] : [letter];
    for (const suffix of suffixes) for (const element of ['C', 'N', 'O', 'S']) candidates.push(`${element}${suffix}`);
    if (letter === 'H') candidates.push('OH');
  }
  for (const candidate of candidates) if (byName.has(candidate)) return byName.get(candidate);
  return null;
}

export function describeResidue(item) {
  const outliers = item.outliers ?? {};
  const values = item.values ?? {};
  const criteria = [];
  const clashes = outliers.clash ?? 0;
  if (clashes) criteria.push(`${clashes} clash${clashes > 1 ? 'es' : ''}`);
  const geometry = GEOMETRY.reduce((sum, kind) => sum + (outliers[kind] ?? 0), 0);
  if (geometry) criteria.push(`${geometry} geometry outlier${geometry > 1 ? 's' : ''}`);
  const ligandGeometry = LIGAND_GEOMETRY.reduce((sum, kind) => sum + (outliers[kind] ?? 0), 0);
  if (ligandGeometry) criteria.push(`${ligandGeometry} ligand geometry outlier${ligandGeometry > 1 ? 's' : ''}`);
  if (String(item.rama).toUpperCase() === 'OUTLIER') criteria.push('Ramachandran outlier');
  if (String(item.rota).toUpperCase() === 'OUTLIER') criteria.push('Rotamer outlier');
  const rsrz = numberValue(values, ['rsrz', 'RSRZ', 'ligRSRZ']);
  if (rsrz > RSRZ_OUTLIER) criteria.push(`RSRZ ${rsrz.toFixed(1)}`);
  return {
    criteria,
    rama: item.rama ?? '',
    rota: item.rota ?? '',
    rsrz,
    rscc: numberValue(values, ['rscc', 'RSCC', 'RSRCC']),
    qscore: numberValue(values, ['Q_score', 'Q-score', 'qscore', 'Qscore', 'q_score']),
    // PDB-REDO density-fitness scores (since 2024): inspect when EDIAm < 0.8 or OPIA < 50%.
    ediam: numberValue(values, ['EDIAm']),
    opia: numberValue(values, ['OPIA']),
    clashes,
    geometry: geometry + ligandGeometry,
  };
}

function number(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

// Summary metrics with their percentile ranks against all PDB entries (absolute) and entries of
// similar resolution (relative), when the report has them.
export function summarizeEntry(entry) {
  const metric = (label, value, absolute, relative, unit = '') => ({ label, value: number(entry[value]), absolute: number(entry[absolute]), relative: number(entry[relative]), unit });
  const metrics = [
    metric('Clashscore', 'clashscore', 'absolute-percentile-clashscore', 'relative-percentile-clashscore'),
    metric('Ramachandran outliers', 'percent-rama-outliers', 'absolute-percentile-percent-rama-outliers', 'relative-percentile-percent-rama-outliers', '%'),
    metric('Side-chain outliers', 'percent-rota-outliers', 'absolute-percentile-percent-rota-outliers', 'relative-percentile-percent-rota-outliers', '%'),
    metric('RSRZ outliers', 'percent-RSRZ-outliers', 'absolute-percentile-percent-RSRZ-outliers', 'relative-percentile-percent-RSRZ-outliers', '%'),
    metric('R-free', 'DCC_Rfree', 'absolute-percentile-DCC_Rfree', 'relative-percentile-DCC_Rfree'),
  ];
  // Cryo-EM entries: the model's average Q-score, ranked (as "qrelative") against entries of similar
  // resolution since the 2025 report update.
  const qscore = number(entry.Q_score ?? entry['Q-score'] ?? entry.qscore);
  if (Number.isFinite(qscore)) metrics.push({ label: 'Q-score', value: qscore, absolute: number(entry['absolute-percentile-qrelative']), relative: number(entry['relative-percentile-qrelative']), unit: '' });
  return {
    resolution: number(entry['PDB-resolution'] ?? entry['EMDB-resolution']),
    method: entry['EMDB-resolution'] ? 'EM' : entry['PDB-resolution'] ? 'X-ray' : '',
    metrics: metrics.filter((item) => Number.isFinite(item.value)),
  };
}

// Level 0–3 for the residue-property coloring.
export function validationLevel(record) {
  if (!record) return -1;
  return Math.min(3, record.criteria.length);
}
