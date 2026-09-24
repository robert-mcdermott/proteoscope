// Small-molecule files as docking programs and cheminformatics toolkits write them: MDL
// molfiles and SD files (V2000 and V3000; RDKit, Open Babel, GNINA, smina, DiffDock, Glide and
// GOLD exports), Tripos MOL2 (DOCK, Open Babel) and AutoDock PDBQT (Vina, smina, GNINA). Each
// record becomes a molecule: atoms with unique names, bonds with orders, formal charges, and its
// properties (SD tags, Vina and DOCK score remarks). moleculeComponent() turns a molecule into a
// chemical component (chemistry.js), so poses get bond orders, aromaticity and hydrogens the way
// PDB ligands do.
import { implicitHydrogens } from './chemistry.js';
import { atomLookupKey, finalizeAtom, makeResidueKey } from './parse.js';

const SDF_CHARGES = { 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 };
// AutoDock atom types that are not element symbols (Meeko adds G/CG glue atoms for macrocycles).
const AUTODOCK_ELEMENTS = {
  A: 'C', HD: 'H', HS: 'H', NA: 'N', NS: 'N', OA: 'O', OS: 'O', SA: 'S', G0: 'C', G1: 'C', G2: 'C', G3: 'C',
  CG0: 'C', CG1: 'C', CG2: 'C', CG3: 'C', W: 'O', Z: 'C', GA: 'C', J: 'C', Q: 'C',
};
const MOL2_ORDERS = { 1: 1, 2: 2, 3: 3, am: 1, ar: 1, du: 1, un: 1 };
const AMINO_ACIDS = new Set(['ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE', 'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL']);

// 'sdf', 'mol2' or 'pdbqt' from the name or the text; null when neither says so.
export function detectMolfile(text, name = '') {
  const lower = name.toLowerCase().replace(/\.gz$/, '');
  if (/\.(sdf|sd|mol)$/.test(lower)) return 'sdf';
  if (lower.endsWith('.mol2')) return 'mol2';
  if (lower.endsWith('.pdbqt')) return 'pdbqt';
  const head = String(text ?? '').slice(0, 4096);
  if (head.includes('@<TRIPOS>')) return 'mol2';
  if (/^(REMARK VINA|ROOT$|TORSDOF)/m.test(head)) return 'pdbqt';
  if (/^\s*\d+\s+\d+.*V[23]000\s*$/m.test(head) || /^M {2}V30 /m.test(head)) return 'sdf';
  return null;
}

// A PDBQT file of protein residues is a docking receptor (a structure); ligands are molecules.
export function isPDBQTReceptor(text) {
  let protein = 0;
  let other = 0;
  for (const line of String(text).split(/\r?\n/, 4000)) {
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    if (AMINO_ACIDS.has(line.slice(17, 20).trim())) protein += 1;
    else other += 1;
  }
  return protein > other;
}

export function parseMolfile(text, name = '', format = detectMolfile(text, name)) {
  let molecules;
  if (format === 'sdf') molecules = parseSDF(text);
  else if (format === 'mol2') molecules = parseMOL2(text);
  else if (format === 'pdbqt') molecules = parsePDBQT(text);
  else throw new Error(`${name || 'This file'} is not an SDF, MOL2 or PDBQT file.`);
  molecules = molecules.filter((molecule) => molecule.atoms.length);
  if (!molecules.length) throw new Error(`${name || 'This file'} contains no atoms.`);
  for (const molecule of molecules) finishMolecule(molecule, format);
  return { format, molecules };
}

/* ---------- SDF and molfiles ---------- */

function parseSDF(text) {
  const molecules = [];
  const lines = String(text).split(/\r?\n/);
  let start = 0;
  while (start < lines.length) {
    let end = start;
    while (end < lines.length && lines[end].trim() !== '$$$$') end += 1;
    const record = lines.slice(start, end);
    if (record.some((line) => line.trim())) molecules.push(parseMolRecord(record));
    start = end + 1;
  }
  return molecules;
}

function parseMolRecord(lines) {
  const molecule = newMolecule(lines[0]?.trim() ?? '');
  const counts = lines[3] ?? '';
  let cursor = 4;
  if (/V3000/.test(counts)) {
    cursor = parseV3000(lines, cursor, molecule);
  } else {
    const atomCount = Number.parseInt(counts.slice(0, 3), 10) || 0;
    const bondCount = Number.parseInt(counts.slice(3, 6), 10) || 0;
    for (let index = 0; index < atomCount; index += 1) {
      const line = lines[cursor + index] ?? '';
      const x = Number.parseFloat(line.slice(0, 10));
      const y = Number.parseFloat(line.slice(10, 20));
      const z = Number.parseFloat(line.slice(20, 30));
      if (![x, y, z].every(Number.isFinite)) throw new Error(`${molecule.title || 'A molfile record'}: atom ${index + 1} of ${atomCount} is missing or malformed.`);
      const symbol = line.slice(31, 34).trim() || line.trim().split(/\s+/)[3] || 'C';
      const code = Number.parseInt(line.slice(36, 39), 10) || 0;
      molecule.atoms.push(newAtom(symbol, x, y, z, SDF_CHARGES[code] ?? 0));
    }
    cursor += atomCount;
    for (let index = 0; index < bondCount; index += 1) {
      const line = lines[cursor + index] ?? '';
      const a = Number.parseInt(line.slice(0, 3), 10) - 1;
      const b = Number.parseInt(line.slice(3, 6), 10) - 1;
      const type = Number.parseInt(line.slice(6, 9), 10) || 1;
      addBond(molecule, a, b, type);
    }
    cursor += bondCount;
    // "M  CHG" lines replace the atom block's charges.
    let chargesReset = false;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.startsWith('M  END')) {
        cursor += 1;
        break;
      }
      if (line.startsWith('M  CHG')) {
        if (!chargesReset) {
          for (const atom of molecule.atoms) atom.charge = 0;
          chargesReset = true;
        }
        const fields = line.slice(6).trim().split(/\s+/).map(Number);
        for (let index = 1; index + 1 < fields.length; index += 2) {
          const atom = molecule.atoms[fields[index] - 1];
          if (atom) atom.charge = fields[index + 1];
        }
      }
    }
  }
  readSDFProperties(lines, cursor, molecule.properties);
  return molecule;
}

// V3000: "M  V30" lines, continued with a trailing "-".
function parseV3000(lines, cursor, molecule) {
  const logical = [];
  let pending = '';
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.startsWith('M  END')) {
      cursor += 1;
      break;
    }
    if (!line.startsWith('M  V30 ')) continue;
    const body = line.slice(7);
    if (body.endsWith('-')) {
      pending += body.slice(0, -1);
      continue;
    }
    logical.push(pending + body);
    pending = '';
  }
  let block = '';
  const indexOf = new Map();
  for (const line of logical) {
    const trimmed = line.trim();
    if (trimmed.startsWith('BEGIN ')) {
      block = trimmed.slice(6);
      continue;
    }
    if (trimmed.startsWith('END ')) {
      block = '';
      continue;
    }
    const fields = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    if (block === 'ATOM' && fields.length >= 5) {
      const options = v3000Options(fields.slice(6));
      indexOf.set(fields[0], molecule.atoms.length);
      molecule.atoms.push(newAtom(fields[1], Number(fields[2]), Number(fields[3]), Number(fields[4]), Number(options.CHG ?? 0)));
    } else if (block === 'BOND' && fields.length >= 4) {
      addBond(molecule, indexOf.get(fields[2]), indexOf.get(fields[3]), Number(fields[1]) || 1);
    }
  }
  return cursor;
}

function v3000Options(fields) {
  const options = {};
  for (const field of fields) {
    const equals = field.indexOf('=');
    if (equals > 0) options[field.slice(0, equals).toUpperCase()] = field.slice(equals + 1);
  }
  return options;
}

// "> <minimizedAffinity>" (or ">  <TAG> (1)") then value lines up to a blank line.
function readSDFProperties(lines, cursor, properties) {
  for (let index = cursor; index < lines.length; index += 1) {
    const match = lines[index].match(/^>.*?<([^>]+)>/);
    if (!match) continue;
    const values = [];
    for (index += 1; index < lines.length && lines[index].trim() !== ''; index += 1) values.push(lines[index].trim());
    properties.set(match[1].trim(), values.join(' '));
  }
}

/* ---------- MOL2 ---------- */

function parseMOL2(text) {
  const molecules = [];
  let molecule = null;
  let section = '';
  let lineInSection = 0;
  let remarks = new Map();
  const indexOf = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    // DOCK writes its scores as comment lines before each molecule.
    const dock = raw.match(/^#{5,}\s*([^:]+):\s*(\S+)/);
    if (dock) {
      remarks.set(dock[1].trim(), dock[2]);
      continue;
    }
    if (line.startsWith('@<TRIPOS>')) {
      section = line.slice(9).toUpperCase();
      lineInSection = 0;
      if (section === 'MOLECULE') {
        molecule = newMolecule('');
        molecule.properties = remarks;
        remarks = new Map();
        indexOf.clear();
        molecules.push(molecule);
      }
      continue;
    }
    if (!molecule || !line || line.startsWith('#')) continue;
    lineInSection += 1;
    const fields = line.split(/\s+/);
    if (section === 'MOLECULE' && lineInSection === 1) {
      molecule.title = line;
    } else if (section === 'ATOM' && fields.length >= 6) {
      const type = fields[5];
      if (/^(LP|Du)$/i.test(type)) continue;
      const element = mol2Element(type, fields[1]);
      const atom = newAtom(element, Number(fields[2]), Number(fields[3]), Number(fields[4]), type === 'N.4' ? 1 : 0);
      atom.sourceName = fields[1];
      atom.partialCharge = Number(fields[8]);
      if (/\.ar$/.test(type)) atom.aromatic = true;
      if (fields[7]) molecule.residueName ??= fields[7].replace(/\d+$/, '').slice(0, 3).toUpperCase();
      indexOf.set(fields[0], molecule.atoms.length);
      molecule.atoms.push(atom);
    } else if (section === 'BOND' && fields.length >= 4) {
      const type = fields[3].toLowerCase();
      if (type === 'nc') continue;
      addBond(molecule, indexOf.get(fields[1]), indexOf.get(fields[2]), type === 'ar' ? 4 : MOL2_ORDERS[type] ?? 1);
    }
  }
  return molecules;
}

function mol2Element(type, name) {
  const base = type.split('.')[0];
  if (/^(Any|Hal|Het|Hev)$/i.test(base)) return name.replace(/[^A-Za-z]/g, '').slice(0, 1) || 'C';
  return base;
}

/* ---------- PDBQT ---------- */

// Vina, smina and GNINA write one MODEL per pose with its scores as REMARK lines; bonds are not
// recorded, so they are inferred from distances.
function parsePDBQT(text) {
  const molecules = [];
  let molecule = null;
  // Vina writes flexible receptor side chains (BEGIN_RES … END_RES) inside each MODEL.
  let flexible = false;
  const start = () => {
    molecule = newMolecule('');
    // PDBQT has no bond orders: its molecules are typed from geometry, like PDB ligands.
    molecule.untyped = true;
    molecules.push(molecule);
  };
  for (const line of String(text).split(/\r?\n/)) {
    const record = line.slice(0, 6).trim();
    if (record.startsWith('BEGIN_')) {
      flexible = true;
      continue;
    }
    if (record.startsWith('END_RE')) {
      flexible = false;
      continue;
    }
    if (flexible) continue;
    if (record === 'MODEL') {
      start();
      molecule.title = `Pose ${line.slice(6).trim() || molecules.length}`;
      continue;
    }
    if (record === 'ENDMDL') {
      molecule = null;
      continue;
    }
    if (record === 'REMARK') {
      if (!molecule) start();
      const vina = line.match(/VINA RESULT:\s+(\S+)\s+(\S+)\s+(\S+)/);
      if (vina) {
        molecule.properties.set('Vina affinity', vina[1]);
        molecule.properties.set('RMSD l.b.', vina[2]);
        molecule.properties.set('RMSD u.b.', vina[3]);
        continue;
      }
      const name = line.match(/REMARK\s+Name\s*=\s*(.+)$/);
      if (name) {
        molecule.title = name[1].trim();
        continue;
      }
      const value = line.match(/^REMARK\s+([A-Za-z_][\w.]*)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*$/);
      if (value) molecule.properties.set(value[1], value[2]);
      continue;
    }
    if (record !== 'ATOM' && record !== 'HETATM') continue;
    if (!molecule) start();
    const type = line.slice(77, 79).trim() || line.slice(76, 78).trim();
    const element = AUTODOCK_ELEMENTS[type.toUpperCase()] ?? type;
    const atom = newAtom(element, Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54)), 0);
    atom.sourceName = line.slice(12, 16).trim();
    atom.partialCharge = Number(line.slice(70, 76));
    atom.autodockType = type;
    if (type === 'A') atom.aromatic = true;
    molecule.residueName ??= line.slice(17, 20).trim().toUpperCase();
    molecule.atoms.push(atom);
  }
  for (const item of molecules) inferBonds(item);
  return molecules;
}

// Rewrites a PDBQT receptor as PDB text (AutoDock types become element symbols).
export function pdbqtToPDB(text) {
  const lines = [];
  for (const line of String(text).split(/\r?\n/)) {
    const record = line.slice(0, 6).trim();
    if (record !== 'ATOM' && record !== 'HETATM') {
      if (!/^(ROOT|ENDROOT|BRANCH|ENDBRANCH|TORSDOF)/.test(record)) lines.push(line);
      continue;
    }
    const type = line.slice(77, 79).trim() || line.slice(76, 78).trim();
    const element = (AUTODOCK_ELEMENTS[type.toUpperCase()] ?? type).toUpperCase();
    lines.push(`${line.slice(0, 66).padEnd(66)}          ${element.padStart(2)}`);
  }
  return lines.join('\n');
}

const COVALENT = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07, F: 0.57, CL: 1.02, BR: 1.2, I: 1.39, B: 0.84, SI: 1.11, SE: 1.2 };

function inferBonds(molecule) {
  const atoms = molecule.atoms;
  for (let a = 0; a < atoms.length; a += 1) {
    for (let b = a + 1; b < atoms.length; b += 1) {
      const first = atoms[a];
      const second = atoms[b];
      if (first.element === 'H' && second.element === 'H') continue;
      const limit = (COVALENT[first.element] ?? 0.8) + (COVALENT[second.element] ?? 0.8) + 0.4;
      const distance = Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
      if (distance > 0.4 && distance <= limit) addBond(molecule, a, b, first.aromatic && second.aromatic ? 4 : 1);
    }
  }
}

/* ---------- Molecules ---------- */

function newMolecule(title) {
  return { title, atoms: [], bonds: [], properties: new Map(), residueName: null };
}

function newAtom(symbol, x, y, z, charge) {
  const element = normalizeElement(symbol);
  return { name: '', element, x, y, z, charge, aromatic: false, hydrogens: 0 };
}

function normalizeElement(symbol) {
  const clean = String(symbol ?? '').replace(/[^A-Za-z]/g, '');
  return clean ? clean.toUpperCase() : 'C';
}

// Bond types 1–3 are orders; 4 (SDF) and "ar" (MOL2) are aromatic; query types (5–8: single or
// double, single or aromatic, double or aromatic, any) are taken as single.
function addBond(molecule, a, b, type) {
  if (!(a >= 0 && b >= 0 && a < molecule.atoms.length && b < molecule.atoms.length) || a === b) return;
  const aromatic = type === 4;
  molecule.bonds.push({ a, b, order: type >= 1 && type <= 3 ? type : 1, aromatic });
  if (aromatic) {
    molecule.atoms[a].aromatic = true;
    molecule.atoms[b].aromatic = true;
  }
}

// Unique atom names (C1, C2, N1 …, or the file's own when they are unique) and hydrogens per
// heavy atom: explicit ones when the molecule has any, otherwise from standard valences.
function finishMolecule(molecule, format) {
  const names = molecule.atoms.map((atom) => atom.sourceName ?? '');
  const unique = names.every((name) => name && name.length <= 4) && new Set(names).size === names.length;
  const counters = new Map();
  molecule.atoms.forEach((atom, index) => {
    if (unique) {
      atom.name = names[index].toUpperCase();
      return;
    }
    const next = (counters.get(atom.element) ?? 0) + 1;
    counters.set(atom.element, next);
    atom.name = `${atom.element}${next}`.slice(0, 4);
  });
  const explicit = molecule.atoms.some((atom) => atom.element === 'H');
  const orderSum = new Float64Array(molecule.atoms.length);
  const hydrogens = new Int32Array(molecule.atoms.length);
  for (const bond of molecule.bonds) {
    const value = bond.aromatic ? 1.5 : bond.order;
    orderSum[bond.a] += value;
    orderSum[bond.b] += value;
    if (molecule.atoms[bond.a].element === 'H') hydrogens[bond.b] += 1;
    if (molecule.atoms[bond.b].element === 'H') hydrogens[bond.a] += 1;
  }
  molecule.atoms.forEach((atom, index) => {
    if (atom.element === 'H') return;
    // PDBQT keeps polar hydrogens only; SDF and MOL2 without any hydrogens imply them.
    atom.hydrogens = explicit || format === 'pdbqt'
      ? hydrogens[index]
      : implicitHydrogens(atom.element, orderSum[index], atom.charge, atom.aromatic);
  });
  // PDBQT keeps polar hydrogens only, so its formula leaves hydrogens out.
  molecule.formula = format === 'pdbqt' ? `${formula(molecule.atoms.filter((atom) => atom.element !== 'H'), true)} (without H)` : formula(molecule.atoms, explicit);
}

// Hill order (C, H, then alphabetical), implicit hydrogens included.
function formula(atoms, explicit) {
  const counts = new Map();
  for (const atom of atoms) {
    counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
    if (!explicit && atom.element !== 'H') counts.set('H', (counts.get('H') ?? 0) + atom.hydrogens);
  }
  const symbol = (element) => element[0] + element.slice(1).toLowerCase();
  const order = [...counts.keys()].sort((a, b) => (a === 'C' ? -1 : b === 'C' ? 1 : a === 'H' ? -1 : b === 'H' ? 1 : a.localeCompare(b)));
  return order.filter((element) => counts.get(element) > 0).map((element) => `${symbol(element)}${counts.get(element) > 1 ? counts.get(element) : ''}`).join('');
}

// The molecule as a chemical component for chemistry.js: bond orders, aromatic flags, formal
// charges and hydrogens, keyed by the atom names finishMolecule() assigned.
export function moleculeComponent(molecule, id = 'LIG') {
  const component = { id, source: 'file', isolated: true, untyped: Boolean(molecule.untyped), atoms: new Map(), bonds: new Map() };
  for (const atom of molecule.atoms) {
    component.atoms.set(atom.name, { element: atom.element, charge: atom.charge || null, aromatic: atom.aromatic, leaving: false, hydrogens: atom.hydrogens });
  }
  for (const bond of molecule.bonds) {
    const a = molecule.atoms[bond.a].name;
    const b = molecule.atoms[bond.b].name;
    component.bonds.set(a < b ? `${a}|${b}` : `${b}|${a}`, { order: bond.order, aromatic: bond.aromatic });
  }
  return component;
}

// Atom records in parse.js's form for one molecule as a single residue (HETATM), ids from
// `firstId` so they can follow a receptor's atoms in the same model.
export function moleculeAtoms(molecule, { chain = 'L', resName = 'LIG', resSeq = 1, firstId = 0, firstSerial = firstId + 1 } = {}) {
  return molecule.atoms.map((atom, index) => finalizeAtom({
    id: firstId + index,
    serial: firstSerial + index,
    name: atom.name,
    altLoc: '',
    resName,
    chain,
    authChain: chain,
    labelChain: chain,
    entityId: '',
    resSeq,
    authSeq: String(resSeq),
    labelSeq: String(resSeq),
    iCode: '',
    x: atom.x,
    y: atom.y,
    z: atom.z,
    occupancy: 1,
    bFactor: 0,
    charge: atom.charge,
    element: atom.element,
    record: 'HETATM',
    isHet: true,
    residueKey: makeResidueKey(chain, resSeq, '', resName),
    authKey: atomLookupKey(chain, String(resSeq), '', resName, atom.name),
    labelKey: '',
  }));
}

/* ---------- Scores ---------- */

// Score columns of a set of poses: the numeric properties shared by most molecules, known
// docking scores first, each with whether lower values are better.
const KNOWN_SCORES = [
  { pattern: /^(vina affinity|minimizedaffinity|affinity|vina|smina)$/i, lower: true, unit: 'kcal/mol' },
  { pattern: /^cnnscore$/i, lower: false },
  { pattern: /^cnnaffinity$/i, lower: false },
  { pattern: /^cnn_vs$/i, lower: false },
  { pattern: /^confidence$/i, lower: false },
  { pattern: /(docking_score|glide_gscore|gscore|emodel)$/i, lower: true },
  { pattern: /^(grid_score|score|total_score|scoring|rdock|inter)$/i, lower: true },
  { pattern: /fitness|plp/i, lower: false },
];
const IDENTIFIERS = /^(id|name|title|smiles|inchi|inchikey|rmsd.*|pose|rank|index|mol_id|zinc.*|chembl.*)$/i;

export function scoreColumns(molecules) {
  const counts = new Map();
  for (const molecule of molecules) {
    for (const [key, value] of molecule.properties) {
      if (IDENTIFIERS.test(key) || !Number.isFinite(Number(value)) || value === '') continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const columns = [...counts]
    .filter(([, count]) => count >= molecules.length / 2)
    .map(([key]) => {
      const known = KNOWN_SCORES.findIndex((item) => item.pattern.test(key));
      return { key, rank: known < 0 ? KNOWN_SCORES.length : known, lower: known < 0 ? /energy|score|affinity|dg/i.test(key) : KNOWN_SCORES[known].lower };
    })
    .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
  return columns.slice(0, 6).map(({ key, lower }) => ({ key, lower }));
}

// DiffDock names its poses rank1_confidence-0.52.sdf; the confidence becomes a property.
export function confidenceFromName(name) {
  const match = String(name).match(/rank(\d+)(?:_confidence(-?\d+(?:\.\d+)?))?/i);
  return match ? { rank: Number(match[1]), confidence: match[2] === undefined ? NaN : Number(match[2]) } : null;
}
