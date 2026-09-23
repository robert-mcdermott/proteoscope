export const AMINO_ACID_CODES = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  SEC: 'U', PYL: 'O', ASX: 'B', GLX: 'Z', UNK: 'X',
};

export const MODIFIED_AMINO_ACIDS = {
  MSE: 'MET', FME: 'MET', CXM: 'MET',
  SEP: 'SER', SAC: 'SER', OAS: 'SER',
  TPO: 'THR', BMT: 'THR',
  PTR: 'TYR', TYS: 'TYR', PAQ: 'TYR',
  HYP: 'PRO',
  MLY: 'LYS', M3L: 'LYS', MLZ: 'LYS', ALY: 'LYS', KCX: 'LYS', LLP: 'LYS', KPI: 'LYS',
  CSO: 'CYS', CSD: 'CYS', CME: 'CYS', OCS: 'CYS', CSX: 'CYS', SMC: 'CYS', CAS: 'CYS', SCH: 'CYS', YCM: 'CYS', CSS: 'CYS', CSE: 'CYS',
  PCA: 'GLN',
  CGU: 'GLU',
  MEN: 'ASN',
  NLE: 'LEU', MLE: 'LEU',
  MVA: 'VAL',
  AIB: 'ALA', ABA: 'ALA',
  NEP: 'HIS', HIC: 'HIS', MHS: 'HIS',
  DAL: 'ALA', DAR: 'ARG', DSG: 'ASN', DAS: 'ASP', DCY: 'CYS', DGN: 'GLN', DGL: 'GLU', DHI: 'HIS', DIL: 'ILE',
  DLE: 'LEU', DLY: 'LYS', MED: 'MET', DPN: 'PHE', DPR: 'PRO', DSN: 'SER', DTH: 'THR', DTR: 'TRP', DTY: 'TYR', DVA: 'VAL',
  HID: 'HIS', HIE: 'HIS', HIP: 'HIS', HSD: 'HIS', HSE: 'HIS', HSP: 'HIS',
  CYX: 'CYS', CYM: 'CYS', ASH: 'ASP', GLH: 'GLU', LYN: 'LYS', ARN: 'ARG', TYM: 'TYR',
};

export const NUCLEOTIDE_CODES = {
  A: 'A', C: 'C', G: 'G', U: 'U', T: 'T', I: 'I', N: 'N',
  DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U', DI: 'I', DN: 'N',
  PSU: 'U', H2U: 'U', '5MU': 'U', '4SU': 'U', OMU: 'U', '5BU': 'U', UR3: 'U',
  '5MC': 'C', OMC: 'C', CBR: 'C',
  OMG: 'G', '1MG': 'G', '2MG': 'G', M2G: 'G', '7MG': 'G', YG: 'G',
  '1MA': 'A', '2MA': 'A', '6MA': 'A', MA6: 'A', A2M: 'A',
  RA: 'A', RC: 'C', RG: 'G', RU: 'U',
  RA5: 'A', RC5: 'C', RG5: 'G', RU5: 'U', RA3: 'A', RC3: 'C', RG3: 'G', RU3: 'U',
  DA5: 'A', DC5: 'C', DG5: 'G', DT5: 'T', DA3: 'A', DC3: 'C', DG3: 'G', DT3: 'T',
  ADE: 'A', CYT: 'C', GUA: 'G', URA: 'U', THY: 'T',
};

export const PROTONATION_VARIANTS = new Set([
  'HID', 'HIE', 'HIP', 'HSD', 'HSE', 'HSP', 'CYX', 'CYM', 'ASH', 'GLH', 'LYN', 'ARN', 'TYM',
]);

export const MODIFIED_NUCLEOTIDES = new Set([
  'PSU', 'H2U', '5MU', '4SU', 'OMU', '5BU', 'UR3', '5MC', 'OMC', 'CBR', 'OMG', '1MG', '2MG', 'M2G', '7MG', 'YG',
  '1MA', '2MA', '6MA', 'MA6', 'A2M',
]);

export const PURINES = new Set(['A', 'G', 'I']);

export const WATER_NAMES = new Set([
  'HOH', 'WAT', 'H2O', 'DOD', 'D2O', 'SOL', 'TIP', 'TIP3', 'TIP4', 'TIP5', 'T3P', 'T4P', 'T5P', 'SPC', 'SPCE',
]);

export const ION_NAMES = new Set([
  'NA', 'K', 'LI', 'RB', 'CS', 'MG', 'CA', 'SR', 'BA', 'ZN', 'MN', 'MN3', 'FE', 'FE2', 'CO', '3CO', 'NI', '3NI',
  'CU', 'CU1', 'CU3', 'CD', 'HG', 'PB', 'AG', 'AU', 'PT', 'AL', 'GA', 'TL', 'YB', 'SM', 'GD', 'EU', 'TB', 'LU',
  'CL', 'BR', 'IOD', 'F', 'SOD', 'POT', 'CLA', 'CAL', 'CES', 'LIT', 'ZN2',
]);

export const METAL_ELEMENTS = new Set([
  'LI', 'NA', 'K', 'RB', 'CS', 'BE', 'MG', 'CA', 'SR', 'BA', 'AL', 'GA', 'IN', 'TL', 'SN', 'PB',
  'SC', 'TI', 'V', 'CR', 'MN', 'FE', 'CO', 'NI', 'CU', 'ZN', 'Y', 'ZR', 'MO', 'RU', 'RH', 'PD', 'AG', 'CD',
  'W', 'RE', 'OS', 'IR', 'PT', 'AU', 'HG', 'LA', 'CE', 'SM', 'EU', 'GD', 'TB', 'YB', 'LU', 'U',
]);

export const HYDROPHOBIC = new Set(['ALA', 'VAL', 'ILE', 'LEU', 'MET', 'PHE', 'TRP', 'PRO', 'TYR']);
export const POLAR = new Set(['SER', 'THR', 'ASN', 'GLN', 'CYS', 'GLY', 'SEC']);
export const POSITIVE = new Set(['LYS', 'ARG', 'HIS']);
export const NEGATIVE = new Set(['ASP', 'GLU']);

export const KYTE_DOOLITTLE = {
  ALA: 1.8, ARG: -4.5, ASN: -3.5, ASP: -3.5, CYS: 2.5, GLN: -3.5, GLU: -3.5, GLY: -0.4, HIS: -3.2, ILE: 4.5,
  LEU: 3.8, LYS: -3.9, MET: 1.9, PHE: 2.8, PRO: -1.6, SER: -0.8, THR: -0.7, TRP: -0.9, TYR: -1.3, VAL: 4.2,
};

export const MAX_ASA = {
  ALA: 129, ARG: 274, ASN: 195, ASP: 193, CYS: 167, GLN: 225, GLU: 223, GLY: 104, HIS: 224, ILE: 197,
  LEU: 201, LYS: 236, MET: 224, PHE: 240, PRO: 159, SER: 155, THR: 172, TRP: 285, TYR: 263, VAL: 174,
};

export function parentResidue(resName) {
  const name = String(resName || '').trim().toUpperCase();
  return MODIFIED_AMINO_ACIDS[name] ?? name;
}

export function isAminoAcidName(resName) {
  const name = String(resName || '').trim().toUpperCase();
  return name in AMINO_ACID_CODES || name in MODIFIED_AMINO_ACIDS;
}

export function isNucleotideName(resName) {
  return String(resName || '').trim().toUpperCase() in NUCLEOTIDE_CODES;
}

export function residueKindFromName(resName) {
  const name = String(resName || '').trim().toUpperCase();
  if (WATER_NAMES.has(name)) return 'water';
  if (name in AMINO_ACID_CODES || name in MODIFIED_AMINO_ACIDS) return 'protein';
  if (name in NUCLEOTIDE_CODES) return 'nucleic';
  if (ION_NAMES.has(name)) return 'ion';
  return 'ligand';
}

export function oneLetterCode(resName) {
  const name = String(resName || '').trim().toUpperCase();
  const parent = MODIFIED_AMINO_ACIDS[name] ?? name;
  return AMINO_ACID_CODES[parent] ?? NUCLEOTIDE_CODES[name] ?? 'X';
}

export function isModifiedResidue(resName) {
  const name = String(resName || '').trim().toUpperCase();
  return (name in MODIFIED_AMINO_ACIDS && !PROTONATION_VARIANTS.has(name)) || MODIFIED_NUCLEOTIDES.has(name);
}
