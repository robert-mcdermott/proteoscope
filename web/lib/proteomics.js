import { AMINO_ACID_CODES, KYTE_DOOLITTLE } from './residues.js';

export const AVERAGE_RESIDUE_MASSES = {
  A: 71.0788, R: 156.1875, N: 114.1038, D: 115.0886, C: 103.1388, E: 129.1155, Q: 128.1307, G: 57.0519,
  H: 137.1411, I: 113.1594, L: 113.1594, K: 128.1741, M: 131.1926, F: 147.1766, P: 97.1167, S: 87.0782,
  T: 101.1051, W: 186.2132, Y: 163.176, V: 99.1326, U: 150.0388, O: 237.3018,
};

export const MONOISOTOPIC_RESIDUE_MASSES = {
  A: 71.037114, R: 156.101111, N: 114.042927, D: 115.026943, C: 103.009185, E: 129.042593, Q: 128.058578,
  G: 57.021464, H: 137.058912, I: 113.084064, L: 113.084064, K: 128.094963, M: 131.040485, F: 147.068414,
  P: 97.052764, S: 87.032028, T: 101.047679, W: 186.079313, Y: 163.063329, V: 99.068414, U: 150.953636,
  O: 237.147727,
};

export const WATER_AVERAGE_MASS = 18.01524;
export const WATER_MONOISOTOPIC_MASS = 18.010565;
export const PROTON_MASS = 1.007276;

const STANDARD_RESIDUES = 'ACDEFGHIKLMNPQRSTVWY';
const HYDROGEN_MONOISOTOPIC_MASS = 1.007825;
const HYDROXYL_MONOISOTOPIC_MASS = 17.00274;

const RESIDUE_FORMULAS = {
  A: 'C3H5NO', R: 'C6H12N4O', N: 'C4H6N2O2', D: 'C4H5NO3', C: 'C3H5NOS', E: 'C5H7NO3', Q: 'C5H8N2O2',
  G: 'C2H3NO', H: 'C6H7N3O', I: 'C6H11NO', L: 'C6H11NO', K: 'C6H12N2O', M: 'C5H9NOS', F: 'C9H9NO',
  P: 'C5H7NO', S: 'C3H5NO2', T: 'C4H7NO2', W: 'C11H10N2O', Y: 'C9H9NO2', V: 'C5H9NO', U: 'C3H5NOSe',
  O: 'C12H19N3O2',
};

// Bjellqvist pK set as used by ExPASy Compute pI/Mw and ProtParam.
const PK_N_TERMINAL = { A: 7.59, M: 7.0, S: 6.93, P: 8.36, T: 6.82, V: 7.44, E: 7.7 };
const PK_N_TERMINAL_DEFAULT = 7.5;
const PK_C_TERMINAL = { D: 4.55, E: 4.75 };
const PK_C_TERMINAL_DEFAULT = 3.55;
const PK_ACIDIC = { D: 4.05, E: 4.45, C: 9.0, Y: 10.0 };
const PK_BASIC = { H: 5.98, K: 10.0, R: 12.0 };

// Guruprasad et al. 1990 dipeptide instability weights (Biopython ProtParamData.DIWV); row = residue i, column = residue i+1.
const DIWV = {
  A: [1, 44.94, -7.49, 1, 1, 1, -7.49, 1, 1, 1, 1, 1, 20.26, 1, 1, 1, 1, 1, 1, 1],
  C: [1, 1, 20.26, 1, 1, 1, 33.6, 1, 1, 20.26, 33.6, 1, 20.26, -6.54, 1, 1, 33.6, -6.54, 24.68, 1],
  D: [1, 1, 1, 1, -6.54, 1, 1, 1, -7.49, 1, 1, 1, 1, 1, -6.54, 20.26, -14.03, 1, 1, 1],
  E: [1, 44.94, 20.26, 33.6, 1, 1, -6.54, 20.26, 1, 1, 1, 1, 20.26, 20.26, 1, 20.26, 1, 1, -14.03, 1],
  F: [1, 1, 13.34, 1, 1, 1, 1, 1, -14.03, 1, 1, 1, 20.26, 1, 1, 1, 1, 1, 1, 33.601],
  G: [-7.49, 1, 1, -6.54, 1, 13.34, 1, -7.49, -7.49, 1, 1, -7.49, 1, 1, 1, 1, -7.49, 1, 13.34, -7.49],
  H: [1, 1, 1, 1, -9.37, -9.37, 1, 44.94, 24.68, 1, 1, 24.68, -1.88, 1, 1, 1, -6.54, 1, -1.88, 44.94],
  I: [1, 1, 1, 44.94, 1, 1, 13.34, 1, -7.49, 20.26, 1, 1, -1.88, 1, 1, 1, 1, -7.49, 1, 1],
  K: [1, 1, 1, 1, 1, -7.49, 1, -7.49, 1, -7.49, 33.6, 1, -6.54, 24.64, 33.6, 1, 1, -7.49, 1, 1],
  L: [1, 1, 1, 1, 1, 1, 1, 1, -7.49, 1, 1, 1, 20.26, 33.6, 20.26, 1, 1, 1, 24.68, 1],
  M: [13.34, 1, 1, 1, 1, 1, 58.28, 1, 1, 1, -1.88, 1, 44.94, -6.54, -6.54, 44.94, -1.88, 1, 1, 24.68],
  N: [1, -1.88, 1, 1, -14.03, -14.03, 1, 44.94, 24.68, 1, 1, 1, -1.88, -6.54, 1, 1, -7.49, 1, -9.37, 1],
  P: [20.26, -6.54, -6.54, 18.38, 20.26, 1, 1, 1, 1, 1, -6.54, 1, 20.26, 20.26, -6.54, 20.26, 1, 20.26, -1.88, 1],
  Q: [1, -6.54, 20.26, 20.26, -6.54, 1, 1, 1, 1, 1, 1, 1, 20.26, 20.26, 1, 44.94, 1, -6.54, 1, -6.54],
  R: [1, 1, 1, 1, 1, -7.49, 20.26, 1, 1, 1, 1, 13.34, 20.26, 20.26, 58.28, 44.94, 1, 1, 58.28, -6.54],
  S: [1, 33.6, 1, 20.26, 1, 1, 1, 1, 1, 1, 1, 1, 44.94, 20.26, 20.26, 20.26, 1, 1, 1, 1],
  T: [1, 1, 1, 20.26, 13.34, -7.49, 1, 1, 1, 1, 1, -14.03, 1, -6.54, 1, 1, 1, 1, -14.03, 1],
  V: [1, 1, -14.03, 1, 1, -7.49, 1, 1, -1.88, 1, 1, 1, 20.26, 1, 1, 1, -7.49, 1, 1, -6.54],
  W: [-14.03, 1, 1, 1, 1, -9.37, 24.68, 1, 1, 13.34, 24.68, 13.34, 1, 1, 1, 1, -14.03, -7.49, 1, 1],
  Y: [24.68, 1, 24.68, -6.54, 1, -7.49, 13.34, 1, 1, 1, 44.94, 1, 13.34, 1, -15.91, 1, -7.49, 1, -9.37, 13.34],
};

const RESIDUE_NAMES = Object.fromEntries(Object.entries(AMINO_ACID_CODES).map(([name, code]) => [code, name]));

export function cleanSequence(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

export function sequenceProperties(sequence) {
  const clean = cleanSequence(sequence);
  const length = clean.length;
  const composition = countResidues(clean);
  const warnings = [];
  let averageMass = length ? WATER_AVERAGE_MASS : 0;
  let monoisotopicMass = length ? WATER_MONOISOTOPIC_MASS : 0;
  for (const [code, count] of Object.entries(composition)) {
    if (!count) continue;
    if (code in AVERAGE_RESIDUE_MASSES) {
      averageMass += AVERAGE_RESIDUE_MASSES[code] * count;
      monoisotopicMass += MONOISOTOPIC_RESIDUE_MASSES[code] * count;
    } else {
      warnings.push(`Contains ${count} ${code} residue${count === 1 ? '' : 's'} (excluded from mass and formula)`);
    }
  }

  const tryptophans = composition.W;
  const tyrosines = composition.Y;
  const cysteines = composition.C;
  const reduced = 5500 * tryptophans + 1490 * tyrosines;
  const extinction = { cystines: reduced + 125 * Math.floor(cysteines / 2), reduced };
  if (length && !tryptophans && !tyrosines && !cysteines) {
    warnings.push('No Trp, Tyr or Cys: protein is not visible at 280 nm');
  } else if (length && !tryptophans) {
    warnings.push('No Trp: extinction coefficient may have >10% error');
  }

  let hydropathySum = 0;
  let hydropathyCount = 0;
  for (const code of clean) {
    const value = KYTE_DOOLITTLE[RESIDUE_NAMES[code]];
    if (value === undefined) continue;
    hydropathySum += value;
    hydropathyCount += 1;
  }

  const molePercent = (code) => (100 * composition[code]) / length;
  const instabilityIndex = length ? instabilityScore(clean) : null;
  return {
    length,
    averageMass,
    monoisotopicMass,
    isoelectricPoint: isoelectricPoint(clean),
    netChargeAtPH7: length ? netCharge(clean, 7.0) : null,
    extinction,
    absorbance01: {
      cystines: averageMass && length ? extinction.cystines / averageMass : null,
      reduced: averageMass && length ? extinction.reduced / averageMass : null,
    },
    gravy: hydropathyCount ? hydropathySum / hydropathyCount : null,
    aliphaticIndex: length ? molePercent('A') + 2.9 * molePercent('V') + 3.9 * (molePercent('I') + molePercent('L')) : null,
    instabilityIndex,
    stable: instabilityIndex === null ? null : instabilityIndex < 40,
    aromaticity: length ? (composition.F + composition.W + composition.Y) / length : null,
    composition,
    formula: length ? molecularFormula(composition) : null,
    warnings,
  };
}

export function formatFormula(formula) {
  if (!formula) return '';
  return Object.entries(formula).filter(([, count]) => count > 0).map(([element, count]) => `${element}${count}`).join('');
}

export function netCharge(sequence, pH) {
  const clean = cleanSequence(sequence);
  if (!clean) return 0;
  return chargeAtPH(countResidues(clean), clean[0], clean[clean.length - 1], pH);
}

export function isoelectricPoint(sequence) {
  const clean = cleanSequence(sequence);
  if (!clean) return null;
  const composition = countResidues(clean);
  const first = clean[0];
  const last = clean[clean.length - 1];
  let low = 0;
  let high = 14;
  let middle = 7;
  while (high - low > 1e-4) {
    middle = low + (high - low) / 2;
    if (chargeAtPH(composition, first, last, middle) > 0) low = middle;
    else high = middle;
  }
  return middle;
}

export function peptideMass(sequence, { monoisotopic = true, modifications = [] } = {}) {
  const text = String(sequence ?? '');
  const parsed = /^[A-Za-z\s]*$/.test(text)
    ? { sequence: cleanSequence(text), modifications: [] }
    : parsePeptideNotation(text);
  if (!parsed?.sequence) return NaN;
  const table = monoisotopic ? MONOISOTOPIC_RESIDUE_MASSES : AVERAGE_RESIDUE_MASSES;
  let mass = monoisotopic ? WATER_MONOISOTOPIC_MASS : WATER_AVERAGE_MASS;
  for (const code of parsed.sequence) {
    if (!(code in table)) return NaN;
    mass += table[code];
  }
  for (const modification of [...parsed.modifications, ...modifications]) {
    mass += modificationMass(modification, monoisotopic);
  }
  return mass;
}

export function mz(mass, charge = 1) {
  if (!charge) return mass;
  return (mass + charge * PROTON_MASS) / Math.abs(charge);
}

function countResidues(clean) {
  const composition = Object.fromEntries([...STANDARD_RESIDUES].map((code) => [code, 0]));
  for (const code of clean) composition[code] = (composition[code] ?? 0) + 1;
  return composition;
}

function chargeAtPH(composition, first, last, pH) {
  let charge = positiveFraction(PK_N_TERMINAL[first] ?? PK_N_TERMINAL_DEFAULT, pH)
    - negativeFraction(PK_C_TERMINAL[last] ?? PK_C_TERMINAL_DEFAULT, pH);
  for (const [code, pK] of Object.entries(PK_BASIC)) charge += (composition[code] ?? 0) * positiveFraction(pK, pH);
  for (const [code, pK] of Object.entries(PK_ACIDIC)) charge -= (composition[code] ?? 0) * negativeFraction(pK, pH);
  return charge;
}

function positiveFraction(pK, pH) {
  return 1 / (1 + 10 ** (pH - pK));
}

function negativeFraction(pK, pH) {
  return 1 / (1 + 10 ** (pK - pH));
}

function instabilityScore(clean) {
  let sum = 0;
  for (let index = 0; index < clean.length - 1; index += 1) {
    const row = DIWV[clean[index]];
    const column = STANDARD_RESIDUES.indexOf(clean[index + 1]);
    if (row && column >= 0) sum += row[column];
  }
  return (10 / clean.length) * sum;
}

function molecularFormula(composition) {
  const formula = { C: 0, H: 2, N: 0, O: 1, S: 0 };
  for (const [code, count] of Object.entries(composition)) {
    if (!count || !RESIDUE_FORMULAS[code]) continue;
    for (const [, element, digits] of RESIDUE_FORMULAS[code].matchAll(/([A-Z][a-z]?)(\d*)/g)) {
      formula[element] = (formula[element] ?? 0) + count * (digits ? Number(digits) : 1);
    }
  }
  return formula;
}

export const MODIFICATIONS = [
  { label: 'Phospho', unimod: 21, monoisotopic: 79.966331, average: 79.9799, aliases: ['phospho', 'phosphorylation', 'phos', 'ph', 'p'] },
  { label: 'Oxidation', unimod: 35, monoisotopic: 15.994915, average: 15.9994, aliases: ['oxidation', 'oxidised', 'oxidized', 'ox'] },
  { label: 'Acetyl', unimod: 1, monoisotopic: 42.010565, average: 42.0367, aliases: ['acetyl', 'acetylation', 'ac'] },
  { label: 'Carbamidomethyl', unimod: 4, monoisotopic: 57.021464, average: 57.0513, aliases: ['carbamidomethyl', 'carbamidomethylation', 'cam', 'cm'] },
  {
    label: 'GlyGly',
    unimod: 121,
    monoisotopic: 114.042927,
    average: 114.1026,
    aliases: ['glygly', 'gg', 'gl', 'diglycine', 'ubiquitin', 'ubiquitination', 'ubiquitylation', 'ub'],
  },
  { label: 'Methyl', unimod: 34, monoisotopic: 14.01565, average: 14.0266, aliases: ['methyl', 'methylation', 'monomethyl', 'me', 'me1'] },
  { label: 'Dimethyl', unimod: 36, monoisotopic: 28.0313, average: 28.0532, aliases: ['dimethyl', 'dimethylation', 'me2'] },
  { label: 'Trimethyl', unimod: 37, monoisotopic: 42.04695, average: 42.0797, aliases: ['trimethyl', 'trimethylation', 'me3'] },
  { label: 'Deamidated', unimod: 7, monoisotopic: 0.984016, average: 0.9848, aliases: ['deamidated', 'deamidation', 'deam', 'de'] },
  { label: 'TMT6plex', unimod: 737, monoisotopic: 229.162932, average: 229.2634, aliases: ['tmt6plex', 'tmt10plex', 'tmt11plex', 'tmt'] },
  { label: 'TMTpro', unimod: 2016, monoisotopic: 304.207146, average: 304.3127, aliases: ['tmtpro', 'tmtpro16plex', 'tmt16plex', 'tmt18plex'] },
  { label: 'Amidated', unimod: 2, monoisotopic: -0.984016, average: -0.9848, aliases: ['amidated', 'amidation'] },
  { label: 'Gln->pyro-Glu', unimod: 28, monoisotopic: -17.026549, average: -17.0305, aliases: ['glnpyroglu', 'pyroglu', 'pyroglutamate'] },
  { label: 'Glu->pyro-Glu', unimod: 27, monoisotopic: -18.010565, average: -18.0153, aliases: ['glupyroglu'] },
];

export const FIXED_MODIFICATION_LABELS = ['Carbamidomethyl', 'TMT6plex', 'TMTpro'];

const MODIFICATION_ALIASES = new Map(MODIFICATIONS.flatMap((modification) => (
  modification.aliases.map((alias) => [alias, modification])
)));
const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);
const SEQUEST_SYMBOLS = new Set(['*', '#', '@', '^', '~', '$']);
const MISSING_VALUES = new Set(['NA', 'NAN', 'NULL', 'NONE', 'N/A']);

export function parsePeptideNotation(text) {
  let core = String(text ?? '').trim().replace(/^["']+|["']+$/g, '');
  core = core.replace(/(?:[./][+-]?\d{1,2}[+-]?|([A-Za-z_)\]}])\d{1,2})$/, '$1').replace(/^_+|_+$/g, '');
  const flanked = core.match(/^(?:[A-Z]|-)\.(.+)\.(?:[A-Z]|-)$/);
  if (flanked) core = flanked[1];

  const residues = [];
  const modifications = [];
  const cTerminal = [];
  const lowercase = [];
  let afterCTerminus = false;
  let index = 0;
  while (index < core.length) {
    const char = core[index];
    if ((char === 'n' || char === 'c') && OPENERS.has(core[index + 1])) {
      const close = matchingBracket(core, index + 1);
      if (close < 0) return null;
      const content = core.slice(index + 2, close);
      if (char === 'n' && !residues.length) {
        modifications.push({ position: -1, ...interpretModification(content, null, 'N') });
        index = close + 1;
        continue;
      }
      if (char === 'c' && residues.length && close === core.length - 1) {
        cTerminal.push(interpretModification(content, null, 'C'));
        index = close + 1;
        continue;
      }
    }
    if (/[A-Za-z]/.test(char)) {
      if (afterCTerminus) return null;
      residues.push(char.toUpperCase());
      if (char !== char.toUpperCase()) lowercase.push(residues.length - 1);
      index += 1;
    } else if (OPENERS.has(char)) {
      const close = matchingBracket(core, index);
      if (close < 0) return null;
      const content = core.slice(index + 1, close);
      if (!residues.length) {
        modifications.push({ position: -1, ...interpretModification(content, null, 'N') });
      } else if (afterCTerminus || (/\bc-?term/i.test(content) && close === core.length - 1)) {
        cTerminal.push(interpretModification(content, null, 'C'));
      } else {
        const residue = residues[residues.length - 1];
        modifications.push({ position: residues.length - 1, ...interpretModification(content, residue, null) });
      }
      index = close + 1;
    } else if (char === '-' || char === '.') {
      if (residues.length) afterCTerminus = true;
      index += 1;
    } else if (SEQUEST_SYMBOLS.has(char) && !afterCTerminus) {
      modifications.push({ position: residues.length - 1, label: `mod${char}` });
      index += 1;
    } else {
      return null;
    }
  }

  if (!residues.length) return null;
  const uppercaseCount = residues.length - lowercase.length;
  if (lowercase.length > uppercaseCount && uppercaseCount > 0) return null;
  if (uppercaseCount > 0) {
    for (const position of lowercase) modifications.push({ position, label: 'lowercase' });
  }
  for (const modification of cTerminal) modifications.push({ position: residues.length, ...modification });
  modifications.sort((a, b) => a.position - b.position);
  return { sequence: residues.join(''), modifications };
}

function matchingBracket(text, start) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (OPENERS.has(text[index])) {
      depth += 1;
    } else if (CLOSERS.has(text[index])) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function interpretModification(content, residue, terminal) {
  const text = content.split('|')[0].replace(/#\w*$/, '').trim();
  const unimod = text.match(/^(?:unimod|u)\s*:\s*(\d+)$/i);
  if (unimod) {
    const id = Number(unimod[1]);
    const known = MODIFICATIONS.find((modification) => modification.unimod === id);
    return known ? knownModification(known) : { label: `UniMod:${id}`, unimod: id };
  }
  const name = text.replace(/^(?:u|obs)\s*:\s*/i, '');
  const number = name.match(/^([+-])?(\d+\.?\d*|\.\d+)$/);
  if (number) {
    const value = Number(number[2]) * (number[1] === '-' ? -1 : 1);
    return massModification(value, Boolean(number[1]), !number[2].includes('.'), residue, terminal);
  }
  const label = name.replace(/\s+\([^()]*\)$/, '').trim() || name;
  const known = MODIFICATION_ALIASES.get(modificationKey(label));
  return known ? knownModification(known) : { label };
}

// TPP/FragPipe write the total residue (or terminal group) mass, e.g. M[147] or n[43]; everyone else writes deltas.
function massModification(value, signed, integer, residue, terminal) {
  const tolerance = integer ? 0.5 : 0.01;
  const base = terminal === 'N' ? HYDROGEN_MONOISOTOPIC_MASS
    : terminal === 'C' ? HYDROXYL_MONOISOTOPIC_MASS
      : MONOISOTOPIC_RESIDUE_MASSES[residue];
  const totalAllowed = !signed && base !== undefined && (Boolean(terminal) || value >= 100);
  const asDelta = matchModificationMass(value, tolerance);
  const asTotal = totalAllowed ? matchModificationMass(value - base, tolerance) : null;
  const known = integer ? asTotal ?? asDelta : asDelta ?? asTotal;
  if (known) return knownModification(known);
  const delta = Math.round((totalAllowed && integer ? value - base : value) * 1e6) / 1e6;
  return { label: `${delta >= 0 ? '+' : ''}${Number(delta.toFixed(4))}`, massDelta: delta };
}

function matchModificationMass(delta, tolerance) {
  let best = null;
  for (const modification of MODIFICATIONS) {
    const error = Math.abs(modification.monoisotopic - delta);
    if (error <= tolerance && (!best || error < Math.abs(best.monoisotopic - delta))) best = modification;
  }
  return best;
}

function knownModification(modification) {
  return { label: modification.label, unimod: modification.unimod, massDelta: modification.monoisotopic };
}

function modificationKey(label) {
  return String(label ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function modificationMass(modification, monoisotopic) {
  if (typeof modification === 'number') return modification;
  const known = MODIFICATIONS.find((entry) => entry.unimod === modification?.unimod)
    ?? MODIFICATION_ALIASES.get(modificationKey(modification?.label));
  if (known) return monoisotopic ? known.monoisotopic : known.average;
  return Number.isFinite(modification?.massDelta) ? modification.massDelta : NaN;
}

const PEPTIDE_HEADER_WORDS = new Set([
  'sequence', 'sequences', 'peptide', 'peptides', 'intensity', 'abundance', 'quantity', 'value', 'score', 'charge',
  'protein', 'proteins', 'gene', 'genes', 'count', 'ratio', 'mass', 'modifications', 'mods',
]);
const PEPTIDE_HEADER_PATTERN = /sequence|peptide|intensit|abundan|quantit|protein|charge|modif|precursor|ratio|score|value|count|gene|mass|area|lfq|psm/;
const PEPTIDE_VALUE_PATTERN = /intensit|abundan|quantit|lfq|area|ratio|spectralcount|psms|^value|signal|log2|foldchange|^fc$|^counts?$/;

export function parsePeptides(text) {
  const entries = new Map();
  let columns = null;
  for (const line of dataLines(text)) {
    const { cells, delimiter } = splitCells(line);
    if (isPeptideHeader(cells, delimiter)) {
      columns = peptideColumns(cells);
      continue;
    }
    const sequenceIndex = columns?.sequence >= 0 ? columns.sequence : cells.findIndex((cell) => peptideCell(cell));
    const peptide = sequenceIndex >= 0 ? peptideCell(cells[sequenceIndex]) : null;
    if (!peptide) continue;

    let value = null;
    if (columns?.value >= 0) {
      value = parseNumber(cells[columns.value], delimiter);
    } else {
      for (let index = sequenceIndex + 1; index < cells.length && value === null; index += 1) {
        value = parseNumber(cells[index], delimiter);
      }
    }

    let entry = entries.get(peptide.sequence);
    if (!entry) {
      entry = { raw: cells[sequenceIndex], sequence: peptide.sequence, modifications: [], count: 0, sum: 0, valued: 0, keys: new Set() };
      entries.set(peptide.sequence, entry);
    }
    entry.count += 1;
    if (value !== null) {
      entry.sum += value;
      entry.valued += 1;
    }
    for (const modification of peptide.modifications) {
      const key = `${modification.position}|${modification.label}`;
      if (entry.keys.has(key)) continue;
      entry.keys.add(key);
      entry.modifications.push(modification);
    }
  }

  return [...entries.values()].map((entry) => ({
    raw: entry.raw,
    sequence: entry.sequence,
    modifications: entry.modifications.sort((a, b) => a.position - b.position),
    value: entry.valued ? entry.sum / entry.valued : null,
    count: entry.count,
  }));
}

export function mapPeptides(peptides, chains, options = {}) {
  const { ilEquivalent = true, allowInitiatorMetLoss = true, ignoreModifications = FIXED_MODIFICATION_LABELS } = options;
  const normalize = (text) => {
    const upper = String(text ?? '').toUpperCase();
    return ilEquivalent ? upper.replace(/[IJ]/g, 'L') : upper;
  };
  const entries = peptides.map((peptide) => (typeof peptide === 'string' ? { sequence: peptide, modifications: [], value: null } : peptide));
  const queries = entries.map((entry) => normalize(entry.sequence));
  const ignored = new Set(ignoreModifications);
  const matched = new Uint8Array(entries.length);
  const matchCache = new Map();
  const sites = new Map();

  const results = chains.map((chain) => {
    const sequence = String(chain.sequence ?? '').toUpperCase();
    const length = sequence.length;
    const target = normalize(sequence);
    if (!matchCache.has(target)) matchCache.set(target, findPeptideMatches(queries, target, allowInitiatorMetLoss));
    const matches = matchCache.get(target);
    const coverage = new Uint16Array(length);
    const sums = new Float64Array(length);
    const counts = new Uint32Array(length);

    for (const match of matches) {
      const entry = entries[match.peptide];
      const value = Number.isFinite(entry.value) ? entry.value : null;
      matched[match.peptide] = 1;
      for (let position = match.start; position <= match.end; position += 1) {
        if (coverage[position] < 65535) coverage[position] += 1;
        if (value === null) continue;
        sums[position] += value;
        counts[position] += 1;
      }
      for (const modification of entry.modifications ?? []) {
        if (ignored.has(modification.label)) continue;
        const peptideLength = queries[match.peptide].length;
        const terminal = modification.position < 0 ? 'N' : modification.position >= peptideLength ? 'C' : null;
        const offset = Math.min(Math.max(modification.position, 0), peptideLength - 1) - match.trim;
        if (offset < 0 && terminal !== 'N') continue;
        const position = match.start + Math.max(offset, 0);
        const key = `${chain.id}|${position}|${modification.label}`;
        const site = sites.get(key);
        if (site) {
          if (!site.peptides.includes(match.peptide)) site.peptides.push(match.peptide);
          continue;
        }
        sites.set(key, {
          chainId: chain.id,
          position,
          residue: sequence[position],
          label: modification.label,
          terminal,
          peptide: match.peptide,
          peptides: [match.peptide],
        });
      }
    }

    const values = new Float32Array(length);
    let coveredCount = 0;
    for (let position = 0; position < length; position += 1) {
      values[position] = counts[position] ? sums[position] / counts[position] : NaN;
      if (coverage[position]) coveredCount += 1;
    }
    return {
      id: chain.id,
      coverage,
      values,
      coveredCount,
      coverageFraction: length ? coveredCount / length : 0,
      matches: matches.map(({ peptide, start, end }) => ({ peptide, start, end })),
    };
  });

  const unmatched = [];
  matched.forEach((flag, index) => {
    if (!flag) unmatched.push(index);
  });
  return { chains: results, unmatched, modifiedSites: [...sites.values()] };
}

function findPeptideMatches(queries, target, allowInitiatorMetLoss) {
  const matches = [];
  queries.forEach((query, peptide) => {
    if (!query) return;
    let found = false;
    for (let start = target.indexOf(query); start >= 0; start = target.indexOf(query, start + 1)) {
      matches.push({ peptide, start, end: start + query.length - 1, trim: 0 });
      found = true;
    }
    // Chain construct lacks the initiator Met that the protein N-terminal peptide still carries.
    if (!found && allowInitiatorMetLoss && query.length > 2 && query[0] === 'M' && target.startsWith(query.slice(1))) {
      matches.push({ peptide, start: 0, end: query.length - 2, trim: 1 });
    }
  });
  return matches.sort((a, b) => a.start - b.start || a.peptide - b.peptide);
}

function isPeptideHeader(cells, delimiter) {
  if (cells.some((cell) => parseNumber(cell, delimiter) !== null)) return false;
  let keyword = false;
  for (const cell of cells) {
    const key = headerKey(cell);
    const peptide = peptideCell(cell);
    if (peptide?.sequence.length >= 5 && !(cells.length > 1 && PEPTIDE_HEADER_WORDS.has(key))) return false;
    if (PEPTIDE_HEADER_PATTERN.test(key)) keyword = true;
  }
  return keyword;
}

function peptideColumns(cells) {
  const keys = cells.map(headerKey);
  let sequence = -1;
  let best = 0;
  keys.forEach((key, index) => {
    const score = /modifiedsequence|modifiedpeptide|peptidoform|proforma|precursorid/.test(key) ? 3
      : /sequence/.test(key) ? 2
        : /^(peptide|peptides|pep)$/.test(key) ? 1 : 0;
    if (score > best) {
      best = score;
      sequence = index;
    }
  });
  const value = keys.findIndex((key, index) => (
    index !== sequence && PEPTIDE_VALUE_PATTERN.test(key) && !/^(?:pg|protein|gene)/.test(key)
  ));
  return { sequence, value };
}

function peptideCell(cell) {
  const text = String(cell ?? '').trim();
  if (!text || MISSING_VALUES.has(text.toUpperCase())) return null;
  const parsed = parsePeptideNotation(text);
  return parsed && parsed.sequence.length >= 2 ? parsed : null;
}

function headerKey(cell) {
  return String(cell ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function dataLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function splitCells(line) {
  for (const delimiter of ['\t', ';', ',']) {
    const cells = splitTopLevel(line, (char) => char === delimiter);
    if (cells.length > 1) return { cells, delimiter };
  }
  return { cells: splitTopLevel(line, (char) => /\s/.test(char)).filter(Boolean), delimiter: ' ' };
}

function splitTopLevel(line, isDelimiter) {
  const cells = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && OPENERS.has(char)) depth += 1;
    else if (!quoted && CLOSERS.has(char)) depth = Math.max(0, depth - 1);
    if (!quoted && depth === 0 && isDelimiter(char)) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseNumber(text, delimiter = ',') {
  let value = String(text ?? '').trim();
  if (delimiter !== ',' && /^[+-]?\d+,\d+$/.test(value)) value = value.replace(',', '.');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;
  return Number(value);
}

const THREE_LETTER_CODES = { ...AMINO_ACID_CODES, XAA: 'X', TER: '*' };
const MUTANT_CODES = new Set([...STANDARD_RESIDUES, 'U', 'O']);
const SITE_MODIFICATIONS = [
  { modification: 'Phospho', abbreviation: 'p', aliases: ['p', 'ph', 'phos', 'phospho', 'phosphorylation', 'phosphorylated'] },
  { modification: 'Acetyl', abbreviation: 'ac', aliases: ['ac', 'acetyl', 'acetylation', 'acetylated'] },
  {
    modification: 'Methyl',
    abbreviation: 'me',
    aliases: ['me', 'me1', 'me2', 'me3', 'me2s', 'me2a', 'methyl', 'methylation', 'methylated', 'dimethyl', 'trimethyl'],
  },
  {
    modification: 'Ubiquitin',
    abbreviation: 'ub',
    aliases: ['ub', 'ub1', 'ubi', 'ubiquitin', 'ubiquitination', 'ubiquitylation', 'ubiquitinated', 'gg', 'glygly'],
  },
  { modification: 'SUMO', abbreviation: 'su', aliases: ['su', 'sumo', 'sumoylation', 'sumoylated'] },
  { modification: 'Glyco', abbreviation: 'glyco', aliases: ['glyco', 'glycosylation', 'glycosylated', 'og', 'oglcnac', 'glcnac', 'hexnac'] },
  { modification: 'Hydroxy', abbreviation: 'oh', aliases: ['oh', 'hy', 'hydroxy', 'hydroxyl', 'hydroxylation', 'hydroxylated'] },
  { modification: 'Nitro', abbreviation: 'no2', aliases: ['no2', 'nitro', 'nitration', 'nitrated'] },
  { modification: 'Oxidation', abbreviation: 'ox', aliases: ['ox', 'oxidation', 'oxidized', 'oxidised'] },
  { modification: 'Citrullination', abbreviation: 'cit', aliases: ['cit', 'citrulline', 'citrullination', 'citrullinated'] },
  { modification: 'Sulfo', abbreviation: 'so3', aliases: ['so3', 'sulfo', 'sulfation', 'sulfated', 'sulphation'] },
  { modification: 'Crotonyl', abbreviation: 'cr', aliases: ['cr', 'crotonyl', 'crotonylation'] },
  { modification: 'Succinyl', abbreviation: 'succ', aliases: ['succ', 'succinyl', 'succinylation'] },
  { modification: 'Propionyl', abbreviation: 'pr', aliases: ['pr', 'propionyl', 'propionylation'] },
  { modification: 'Butyryl', abbreviation: 'bu', aliases: ['bu', 'butyryl', 'butyrylation'] },
  { modification: 'Lactyl', abbreviation: 'la', aliases: ['la', 'lactyl', 'lactylation'] },
  { modification: 'Formyl', abbreviation: 'fo', aliases: ['fo', 'formyl', 'formylation'] },
  { modification: 'ADP-ribosyl', abbreviation: 'ar', aliases: ['ar', 'adpr', 'adpribosyl', 'adpribosylation'] },
  { modification: 'Palmitoyl', abbreviation: 'palm', aliases: ['palm', 'palmitoyl', 'palmitoylation'] },
  { modification: 'Nitrosyl', abbreviation: 'sno', aliases: ['sno', 'nitrosyl', 'nitrosylation', 'snitrosylation'] },
];
const SITE_MODIFICATION_ALIASES = new Map(SITE_MODIFICATIONS.flatMap((entry) => entry.aliases.map((alias) => [alias, entry])));
const METHYL_DEGREES = { me1: 'me1', me2: 'me2', me3: 'me3', me2s: 'me2s', me2a: 'me2a', dimethyl: 'me2', trimethyl: 'me3' };

export function parseSites(text) {
  const sites = [];
  for (const line of dataLines(text)) {
    const tokens = [];
    const pattern = /[^\s,;]+/g;
    let previousEnd = 0;
    for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
      tokens.push({ text: match[0], separator: line.slice(previousEnd, match.index) });
      previousEnd = match.index + match[0].length;
    }

    let pendingChain = null;
    let pendingRaw = '';
    let last = null;
    for (let index = 0; index < tokens.length; index += 1) {
      const { text: token, separator } = tokens[index];
      const next = tokens[index + 1]?.text ?? '';
      if (/^chain$/i.test(token) && /^[A-Za-z0-9]{1,4}:?$/.test(next)) {
        pendingChain = next.replace(':', '');
        pendingRaw = `${token} ${next} `;
        index += 1;
        last = null;
        continue;
      }
      const chainOnly = token.match(/^([A-Za-z0-9]{1,4}):$/);
      if (chainOnly || (/^[A-Za-z]$/.test(token) && parseSiteToken(next))) {
        pendingChain = chainOnly ? chainOnly[1] : token;
        pendingRaw = `${token} `;
        last = null;
        continue;
      }

      const number = parseNumber(token);
      const positionOnly = (site) => !site.wt && !site.mutant && !site.modification;
      if (number !== null && last && last.value === null
        && (!/^\d+$/.test(token) || separator.includes('\t') || !positionOnly(last))) {
        last.value = number;
        last = null;
        continue;
      }
      const site = parseSiteToken(token);
      if (!site) {
        last = null;
        continue;
      }
      site.raw = `${pendingRaw}${token}`;
      if (!site.chain && pendingChain) site.chain = pendingChain;
      pendingChain = null;
      pendingRaw = '';
      sites.push(site);
      last = site;
    }
  }
  return sites;
}

function parseSiteToken(token) {
  let text = String(token ?? '').replace(/[()]/g, '').trim();
  let chain = null;
  const chained = text.match(/^([A-Za-z0-9]{1,4})[:/_](.+)$/);
  if (chained) {
    chain = chained[1];
    text = chained[2];
  }
  text = text.replace(/^p\./, '');

  if (/^\d+$/.test(text)) return siteRecord(chain, null, Number(text), null, null, null);

  const prefixed = text.match(/^([A-Za-z]+?)-?([A-Z][a-z]{2}|[A-Z])(\d+)$/);
  if (prefixed) {
    const modification = SITE_MODIFICATION_ALIASES.get(prefixed[1].toLowerCase());
    const wt = residueCode(prefixed[2]);
    if (modification && wt) return siteRecord(chain, wt, Number(prefixed[3]), null, modification, prefixed[1].toLowerCase());
  }

  const plain = text.match(/^([A-Za-z]{3}|[A-Z])(\d+)(.*)$/);
  if (!plain) return null;
  const wt = residueCode(plain[1]);
  if (!wt) return null;
  const position = Number(plain[2]);
  const rest = plain[3];
  if (!rest) return siteRecord(chain, wt, position, null, null, null);
  if (/^(?:[A-Za-z]{1,3})?fs(?:\*|ter|x)?\d*$/i.test(rest)) return siteRecord(chain, wt, position, 'fs', null, null);
  if (/^(?:del|dup)$/i.test(rest)) return siteRecord(chain, wt, position, rest.toLowerCase(), null, null);
  if (rest === '*' || rest === 'X' || /^(?:ter|stop)$/i.test(rest)) return siteRecord(chain, wt, position, '*', null, null);
  if (rest.length === 3 && THREE_LETTER_CODES[rest.toUpperCase()]) {
    return siteRecord(chain, wt, position, THREE_LETTER_CODES[rest.toUpperCase()], null, null);
  }
  if (rest.length === 1 && MUTANT_CODES.has(rest)) return siteRecord(chain, wt, position, rest, null, null);
  const suffix = rest.replace(/^-/, '').toLowerCase();
  const modification = SITE_MODIFICATION_ALIASES.get(suffix);
  return modification ? siteRecord(chain, wt, position, null, modification, suffix) : null;
}

function residueCode(text) {
  if (text.length === 1) return MUTANT_CODES.has(text) ? text : null;
  const code = THREE_LETTER_CODES[text.toUpperCase()];
  return code && code !== '*' ? code : null;
}

function siteRecord(chain, wt, position, mutant, modification, alias) {
  const residue = `${wt ?? ''}${position}`;
  let label = mutant ? `${residue}${mutant}` : residue;
  if (modification?.modification === 'Phospho') {
    label = `p${residue}`;
  } else if (modification) {
    label = `${residue}${modification.modification === 'Methyl' ? METHYL_DEGREES[alias] ?? 'me' : modification.abbreviation}`;
  }
  return {
    raw: '',
    chain,
    wt,
    position,
    mutant,
    modification: modification?.modification ?? null,
    label,
    value: null,
  };
}

export const CROSSLINKERS = [
  { id: 'dss', label: 'DSS / BS3', spacer: 11.4, maxCaCa: 30, note: 'Lys-Lys (also S/T/Y, N-term); 26-30 Å Cα-Cα (Merkley 2014)' },
  { id: 'dsso', label: 'DSSO', spacer: 10.1, maxCaCa: 30, note: 'MS-cleavable, Lys-reactive' },
  { id: 'dsbu', label: 'DSBU (BuUrBu)', spacer: 12.5, maxCaCa: 30, note: 'MS-cleavable, Lys-reactive; PyXlinkViewer uses 27 Å' },
  { id: 'bs2g', label: 'BS2G / DSG', spacer: 7.7, maxCaCa: 25, note: 'Short Lys-reactive linker' },
  { id: 'edc', label: 'EDC / DMTMM (zero-length)', spacer: 0, maxCaCa: 20, note: 'Lys to Asp/Glu; strict 12 Å, lenient 25 Å' },
  { id: 'phox', label: 'PhoX / DSPP', spacer: 5, maxCaCa: 20, note: 'IMAC-enrichable, Lys-reactive (Steigenberger 2019)' },
  { id: 'sda', label: 'sulfo-SDA', spacer: 3.9, maxCaCa: 25, note: 'Photo-activated diazirine: Lys to any residue' },
  { id: 'custom', label: 'Custom', spacer: null, maxCaCa: 30, note: 'Set your own Cα-Cα cutoff' },
];

const CROSSLINK_RESIDUE_BASES = [
  'abspos', 'proteinlinkpos', 'seqpos', 'residue', 'resi', 'resseq', 'resid', 'residuenumber', 'position', 'pos', 'site',
  'linkpos', 'linkposition',
];
const CROSSLINK_PROTEIN_BASES = ['protein', 'proteinid', 'prot', 'chain', 'chainid', 'accession', 'proteinaccession', 'uniprot', 'molecule'];
const CROSSLINK_SIDE_SUFFIXES = [['1', '2'], ['a', 'b']];
const MISSING_PROTEINS = new Set(['', '-', 'NA', 'N/A', 'NULL', 'NONE']);

export function parseCrosslinks(text) {
  const links = [];
  let skipped = 0;
  let table = null;
  for (const line of dataLines(text)) {
    const { cells, delimiter } = splitCells(line);
    const header = crosslinkColumns(cells);
    if (header) {
      table = { ...header, delimiter };
      continue;
    }
    const parsed = table ? [crosslinkFromRow(line, table)].filter(Boolean) : crosslinksFromText(line, cells, delimiter);
    links.push(...parsed);
    if (!parsed.length && /\d/.test(line)) skipped += 1;
  }
  return { links, skipped };
}

function crosslinkColumns(cells) {
  const keys = cells.map(headerKey);
  if (cells.some((cell) => parseNumber(cell) !== null)) return null;
  let residue = sideColumns(keys, CROSSLINK_RESIDUE_BASES);
  if (!residue && keys.includes('fromsite') && keys.includes('tosite')) {
    residue = { a: keys.indexOf('fromsite'), b: keys.indexOf('tosite'), base: 'site' };
  }
  if (!residue) return null;
  return {
    residue,
    protein: sideColumns(keys, CROSSLINK_PROTEIN_BASES),
    peptideStart: residue.base.startsWith('link') ? sideColumns(keys, ['peppos', 'peptideposition', 'pepstart']) : null,
    score: keys.findIndex((key) => key.includes('score')),
  };
}

function sideColumns(keys, bases) {
  for (const base of bases) {
    for (const [first, second] of CROSSLINK_SIDE_SUFFIXES) {
      const a = keys.indexOf(`${base}${first}`);
      const b = keys.indexOf(`${base}${second}`);
      if (a >= 0 && b >= 0) return { a, b, base };
    }
  }
  return null;
}

// xiNET-style tables give LinkPos relative to the peptide when PepPos (peptide start) columns are present.
function crosslinkFromRow(line, table) {
  const cells = table.delimiter === ' '
    ? splitTopLevel(line, (char) => /\s/.test(char)).filter(Boolean)
    : splitTopLevel(line, (char) => char === table.delimiter);
  const first = cells[table.residue.a]?.trim().match(/^([A-Z])?(\d+)(?:[;|,].*)?$/);
  const second = cells[table.residue.b]?.trim().match(/^([A-Z])?(\d+)(?:[;|,].*)?$/);
  if (!first || !second) return null;
  let residueA = Number(first[2]);
  let residueB = Number(second[2]);
  if (table.peptideStart) {
    const startA = parseNumber(cells[table.peptideStart.a]);
    const startB = parseNumber(cells[table.peptideStart.b]);
    if (startA !== null) residueA += startA - 1;
    if (startB !== null) residueB += startB - 1;
  }
  return crosslinkRecord(
    line,
    { protein: table.protein ? cells[table.protein.a] : null, amino: first[1], residue: residueA },
    { protein: table.protein ? cells[table.protein.b] : null, amino: second[1], residue: residueB },
    table.score >= 0 ? parseNumber(cells[table.score], table.delimiter) : null,
  );
}

function crosslinksFromText(line, cells, delimiter) {
  const pipe = line.match(/^(\d+)\|([^|]*)\|(\d+)\|([^|]*)$/);
  if (pipe) {
    return [crosslinkRecord(line, { protein: pipe[2], residue: Number(pipe[1]) }, { protein: pipe[4], residue: Number(pipe[3]) }, null)];
  }
  const whole = crosslinkWithScore(line);
  if (whole) return [whole];

  const links = [];
  let last = null;
  for (const cell of cells) {
    const score = parseNumber(cell, delimiter);
    if (score !== null && last && last.score === null) {
      last.score = score;
      continue;
    }
    const sides = crosslinkSides(cell);
    last = sides ? crosslinkRecord(cell, sides[0], sides[1], null) : null;
    if (last) links.push(last);
  }
  if (links.length) return links;
  const joined = crosslinkWithScore(cells.join(' '));
  return joined ? [{ ...joined, raw: line }] : [];
}

function crosslinkWithScore(text) {
  const scored = text.match(/^(.*\S)[\s,;]+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i);
  const scoredSides = scored ? crosslinkSides(scored[1]) : null;
  if (scoredSides) return crosslinkRecord(text, scoredSides[0], scoredSides[1], Number(scored[2]));
  const sides = crosslinkSides(text);
  return sides ? crosslinkRecord(text, sides[0], sides[1], null) : null;
}

function crosslinkSides(text) {
  const clean = text.trim();
  for (let index = 1; index < clean.length - 1; index += 1) {
    if (!/[-:~\s]/.test(clean[index])) continue;
    const first = crosslinkSide(clean.slice(0, index));
    const second = first ? crosslinkSide(clean.slice(index + 1)) : null;
    if (second) return [first, second];
  }
  return null;
}

function crosslinkSide(text) {
  const value = text.trim();
  const match = value.match(/^([^\s:;,()]+?)\s*\(\s*([A-Z])?(\d+)\s*\)$/)
    ?? value.match(/^([^\s:;,()]+?)\s*[:_|\s]\s*([A-Z])?(\d+)$/)
    ?? value.match(/^()([A-Z])?(\d+)$/);
  return match ? { protein: match[1] || null, amino: match[2], residue: Number(match[3]) } : null;
}

function crosslinkRecord(raw, first, second, score) {
  const protein = (value) => {
    const clean = String(value ?? '').trim();
    return MISSING_PROTEINS.has(clean.toUpperCase()) ? null : clean;
  };
  return {
    raw,
    proteinA: protein(first.protein),
    residueA: first.residue,
    proteinB: protein(second.protein),
    residueB: second.residue,
    ...(first.amino ? { aminoA: first.amino } : {}),
    ...(second.amino ? { aminoB: second.amino } : {}),
    score,
  };
}

const RESIDUE_DATA_CHAIN_KEYS = new Set(['chain', 'chainid', 'ch', 'authasymid', 'labelasymid', 'asymid', 'strand', 'segid']);
const RESIDUE_DATA_RESIDUE_KEYS = new Set([
  'residue', 'resi', 'resseq', 'resid', 'resnum', 'resno', 'residuenumber', 'residueid', 'position', 'pos', 'seqid',
  'authseqid', 'number', 'res', 'seqnum',
]);
const RESIDUE_DATA_ICODE_KEYS = new Set(['icode', 'inscode', 'insertion', 'insertioncode', 'pdbxpdbinscode']);
const RESIDUE_DATA_VALUE_KEYS = new Set(['value', 'score', 'val']);
const RESIDUE_DATA_OTHER_KEYS = new Set(['resname', 'residuename', 'resn', 'aa', 'aminoacid', 'restype', 'compid', 'wt']);

export function parseResidueData(text) {
  const rows = [];
  let name = null;
  let columns = null;
  let skipped = 0;
  for (const line of dataLines(text)) {
    const { cells, delimiter } = splitCells(line);
    const header = residueDataColumns(cells);
    if (header) {
      columns = header;
      name = name ?? (cells[header.value].trim() || null);
      continue;
    }
    if (!rows.length && !name && !/\d/.test(line)) {
      name = line;
      continue;
    }
    const row = columns ? residueRowFromColumns(cells, columns, delimiter) : residueRowFromCells(cells, delimiter);
    if (row) rows.push(row);
    else skipped += 1;
  }
  return { name: name ?? 'Custom data', rows, skipped };
}

function residueDataColumns(cells) {
  if (cells.length < 2 || cells.some((cell) => parseNumber(cell) !== null)) return null;
  const keys = cells.map(headerKey);
  const residue = keys.findIndex((key) => RESIDUE_DATA_RESIDUE_KEYS.has(key));
  if (residue < 0) return null;
  const chain = keys.findIndex((key) => RESIDUE_DATA_CHAIN_KEYS.has(key));
  const insertion = keys.findIndex((key) => RESIDUE_DATA_ICODE_KEYS.has(key));
  let value = keys.findIndex((key) => RESIDUE_DATA_VALUE_KEYS.has(key));
  if (value < 0) {
    value = keys.findIndex((key, index) => key && ![chain, residue, insertion].includes(index) && !RESIDUE_DATA_OTHER_KEYS.has(key));
  }
  return value < 0 ? null : { chain, residue, insertion, value };
}

function residueRowFromColumns(cells, columns, delimiter) {
  const cell = String(cells[columns.residue] ?? '').trim();
  const chained = cell.match(/^([A-Za-z0-9]{1,4})[:/](.+)$/);
  const residue = residueToken(chained ? chained[2] : cell);
  const value = parseNumber(cells[columns.value], delimiter);
  if (!residue || value === null) return null;
  const chain = columns.chain >= 0 ? String(cells[columns.chain] ?? '').trim() : chained?.[1] ?? '';
  const insertion = columns.insertion >= 0 ? String(cells[columns.insertion] ?? '').trim().replace(/^[.?]$/, '') : '';
  return { chain: chain || null, resSeq: residue.resSeq, iCode: insertion || residue.iCode, value };
}

function residueRowFromCells(cells, delimiter) {
  const parts = cells.flatMap((cell) => {
    const chained = cell.match(/^([A-Za-z0-9]{1,4})[:/](.+)$/);
    return chained ? [chained[1], chained[2]] : [cell];
  });
  const numberAfter = (start) => parts.slice(start).map((part) => parseNumber(part, delimiter)).find((value) => value !== null) ?? null;
  const hasChain = parts.length >= 3 && /^[A-Za-z0-9]{1,4}$/.test(parts[0]) && residueToken(parts[1]) && numberAfter(2) !== null;
  const residue = residueToken(parts[hasChain ? 1 : 0]);
  const value = numberAfter(hasChain ? 2 : 1);
  if (!residue || value === null) return null;
  return { chain: hasChain ? parts[0] : null, resSeq: residue.resSeq, iCode: residue.iCode, value };
}

function residueToken(text) {
  const match = String(text ?? '').trim().match(/^(?:[A-Za-z]{3}|[A-Za-z])?(-?\d+)([A-Za-z]?)$/);
  return match ? { resSeq: Number(match[1]), iCode: match[2] } : null;
}

export const ENZYMES = [
  { id: 'trypsin', label: 'Trypsin', rule: 'C-term to K/R, not before P' },
  { id: 'trypsin-p', label: 'Trypsin/P', rule: 'C-term to K/R, also before P' },
  { id: 'lysc', label: 'Lys-C', rule: 'C-term to K' },
  { id: 'lysn', label: 'Lys-N', rule: 'N-term to K' },
  { id: 'gluc', label: 'Glu-C', rule: 'C-term to E' },
  { id: 'aspn', label: 'Asp-N', rule: 'N-term to D' },
  { id: 'chymotrypsin', label: 'Chymotrypsin (high specificity)', rule: 'C-term to F/W/Y, not before P' },
  { id: 'argc', label: 'Arg-C', rule: 'C-term to R' },
];

const CLEAVAGE_RULES = {
  trypsin: { after: 'KR', notBefore: 'P' },
  'trypsin-p': { after: 'KR' },
  lysc: { after: 'K' },
  lysn: { before: 'K' },
  gluc: { after: 'E' },
  aspn: { before: 'D' },
  chymotrypsin: { after: 'FWY', notBefore: 'P' },
  argc: { after: 'R' },
};

export function digest(sequence, enzymeId = 'trypsin', options = {}) {
  const { missedCleavages = 0, minLength = 6, maxLength = 40 } = options;
  const rule = CLEAVAGE_RULES[enzymeId];
  if (!rule) throw new Error(`Unknown enzyme: ${enzymeId}`);
  const clean = cleanSequence(sequence);
  const boundaries = [0];
  for (let index = 1; index < clean.length; index += 1) {
    const previous = clean[index - 1];
    const current = clean[index];
    const cutsAfter = rule.after?.includes(previous) && !rule.notBefore?.includes(current);
    if (cutsAfter || rule.before?.includes(current)) boundaries.push(index);
  }
  boundaries.push(clean.length);

  const peptides = [];
  for (let first = 0; first < boundaries.length - 1; first += 1) {
    for (let missed = 0; missed <= missedCleavages && first + missed + 1 < boundaries.length; missed += 1) {
      const start = boundaries[first];
      const stop = boundaries[first + missed + 1];
      if (stop - start < minLength || stop - start > maxLength) continue;
      peptides.push({ start, end: stop - 1, sequence: clean.slice(start, stop), missed });
    }
  }
  return peptides;
}
