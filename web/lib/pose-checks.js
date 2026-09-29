// Physical checks of a ligand pose as PoseBusters runs them (Buttenschoen, Morris & Deane 2024,
// Chem Sci 15:3130, doi:10.1039/D3SC04185A; version 0.6, "dock" configuration), for predicted,
// docked and modeled complexes:
//
//   Chemistry: the molecule passes RDKit's sanitization (valences) and is one connected piece.
//   Geometry: every bond length and bond angle (as a 1-3 distance) within 25% of RDKit's
//     distance-geometry bounds (dg-bounds.js), and no atom pair further apart in the graph closer
//     than 70% of its lower bound (internal clash).
//   Flatness: five- and six-membered aromatic rings, and carbon–carbon double bonds with their
//     four substituents, within 0.25 Å of a plane; isolated non-aromatic six-membered rings (none
//     or one double bond, or two in the patterns PoseBusters lists) at least 0.05 Å out of plane.
//   Contacts: no ligand atom closer to an atom of the protein, organic cofactors or waters than
//     0.75 of the sum of their van der Waals radii (covalent radii for inorganic cofactors: metals,
//     halides, phosphate, sulfate and the like); at least one protein atom within 5 Å; and at
//     most 7.5% of the ligand's volume inside the protein or cofactors (van der Waals radii × 0.8,
//     × 0.5 for inorganic cofactors and waters), computed as RDKit's ShapeTverskyIndex does on a
//     0.5 Å grid with graded shells.
//
// PoseBusters' energy ratio (UFF energy against generated conformers) is left out, so a pose
// that passes every check here is not called "PB-valid". Deliberate differences: a ring's
// distance from its plane is the largest absolute distance (PoseBusters takes the largest signed
// one, whose sign depends on the SVD routine, and misses most single atoms pushed out of a
// ring); metal atoms of the ligand (heme's iron) are left out of the chemistry, geometry and
// stereo checks, which RDKit cannot run on them, and are compared with other atoms by covalent
// radii; and atoms bonded to the ligand in the structure (covalent ligands, glycans), with their
// neighbors, are left out of the contact checks. Beyond PoseBusters' docking checks,
// stereocenters and double-bond geometry are compared with a dictionary definition (the Chemical
// Component Dictionary's ideal coordinates) when one is given, as PoseBusters compares a redocked
// pose with the crystal ligand.

import { componentName } from './chemistry.js';
import { boundsMatrix } from './dg-bounds.js';
import { symmetricEigen3 } from './math3d.js';
import { bondBetween, elementRecord, otherAtom, perceiveMolecule } from './perception.js';

export const POSE_CHECKS = [
  { id: 'sanitization', group: 'chemistry', label: 'Chemistry', title: 'RDKit accepts the molecule: no atom over its allowed valence' },
  { id: 'connected', group: 'chemistry', label: 'All atoms connected', title: 'The ligand is one molecule' },
  { id: 'bond-lengths', group: 'geometry', label: 'Bond lengths', title: 'Every bond within 25% of its RDKit distance-geometry bounds' },
  { id: 'bond-angles', group: 'geometry', label: 'Bond angles', title: 'Every 1-3 distance within 25% of its bounds' },
  { id: 'internal-clash', group: 'geometry', label: 'Internal clash', title: 'No non-bonded atom pair closer than 70% of its lower bound' },
  { id: 'aromatic-flatness', group: 'geometry', label: 'Aromatic rings flat', title: 'Five- and six-membered aromatic rings within 0.25 Å of a plane' },
  { id: 'ring-nonflatness', group: 'geometry', label: 'Saturated rings puckered', title: 'Isolated non-aromatic six-membered rings at least 0.05 Å out of plane' },
  { id: 'double-bond-flatness', group: 'geometry', label: 'Double bonds flat', title: 'C=C bonds and their substituents within 0.25 Å of a plane' },
  { id: 'chirality', group: 'stereo', label: 'Stereocenters', title: 'Tetrahedral stereocenters as in the dictionary definition' },
  { id: 'double-bond-stereo', group: 'stereo', label: 'Double-bond geometry', title: 'E/Z double bonds as in the dictionary definition' },
  { id: 'protein-distance', group: 'contacts', label: 'Distance to protein', title: 'No atom pair closer than 0.75 of the sum of van der Waals radii' },
  { id: 'protein-near', group: 'contacts', label: 'Near the protein', title: 'At least one protein atom within 5 Å' },
  { id: 'organic-distance', group: 'contacts', label: 'Distance to cofactors', title: 'Organic cofactors and other ligands: 0.75 of the van der Waals radii' },
  { id: 'inorganic-distance', group: 'contacts', label: 'Distance to ions', title: 'Metals, halides and inorganic ions: 0.75 of the covalent radii' },
  { id: 'water-distance', group: 'contacts', label: 'Distance to waters', title: 'Waters: 0.75 of the van der Waals radii' },
  { id: 'protein-overlap', group: 'contacts', label: 'Overlap with protein', title: 'At most 7.5% of the ligand volume inside the protein (radii × 0.8)' },
  { id: 'organic-overlap', group: 'contacts', label: 'Overlap with cofactors', title: 'At most 7.5% inside organic cofactors (radii × 0.8)' },
  { id: 'inorganic-overlap', group: 'contacts', label: 'Overlap with ions', title: 'At most 7.5% inside inorganic cofactors (radii × 0.5)' },
  { id: 'water-overlap', group: 'contacts', label: 'Overlap with waters', title: 'At most 7.5% inside waters (radii × 0.5)' },
];

const BOND_TOLERANCE = 0.25;
const ANGLE_TOLERANCE = 0.25;
const CLASH_TOLERANCE = 0.3;
const FLAT = 0.25;
const NOT_FLAT = 0.05;
const CONTACT_RATIO = 0.75;
const MAX_DISTANCE = 5;
const SEARCH_DISTANCE = 6;
const OVERLAP_LIMIT = 0.075;

// PoseBusters' inorganic cofactors: these elements wherever they occur, and these components.
const INORGANIC_ELEMENTS = new Set(['LI', 'BE', 'NA', 'MG', 'CL', 'K', 'CA', 'MN', 'FE', 'CO', 'NI', 'CU', 'ZN', 'BR', 'RB', 'MO', 'CD']);
const INORGANIC_COMPONENTS = new Set(['FES', 'MOS', 'PO3', 'PO4', 'PPK', 'SO3', 'SO4', 'VO4']);

// The environment class of an atom by PoseBusters' rules: 'hydrogen', 'inorganic' (by element or
// component), 'water', 'protein' (polymer records) or 'organic' (other hetero groups).
export function contactClass({ element, resName, hetero, water }) {
  const symbol = String(element ?? '').toUpperCase();
  if (symbol === 'H' || symbol === 'D') return 'hydrogen';
  if (INORGANIC_ELEMENTS.has(symbol)) return 'inorganic';
  if (water) return 'water';
  if (!hetero) return 'protein';
  if (INORGANIC_COMPONENTS.has(String(resName ?? '').toUpperCase())) return 'inorganic';
  return 'organic';
}

// ligand: { atoms: [{ element, charge, x, y, z, name }], bonds: [{ a, b, order }] }, heavy atoms;
// bonds null when the bond orders are unknown, and only the contact checks run.
// environment: [{ element, x, y, z, contact: contactClass(), key }] for every other atom.
// options.bondedKeys: environment keys bonded to the ligand and their neighbors (left out of
// the contact checks).
// options.reference: { atoms: Map(name → { x, y, z, stereo }), bonds: [{ a: name, b: name,
// stereo }] }, a dictionary definition for the stereo checks.
// Returns { molecule, checks: [{ id, label, group, passed (true, false or null: not run), value,
// detail, atoms: [ligand atom indices], links: [[ligand index, ligand index]] (stretched bonds,
// strained angles, clashing pairs), pairs: [[ligand index, environment key]] (contacts) }],
// passed, failed, checked }.
export function checkPose(ligand, environment = [], options = {}) {
  const positions = ligand.atoms.map((atom) => [atom.x, atom.y, atom.z]);
  const metal = ligand.atoms.map((atom) => isMetal(elementRecord(atom.element).z));
  if (!Array.isArray(ligand.bonds)) {
    const results = POSE_CHECKS.map((check) => ({ ...check, passed: null, value: NaN, detail: check.group === 'contacts' ? '' : 'Needs bond orders, from a dictionary entry or the file (SDF, MOL2).', atoms: [], links: [], pairs: [] }));
    const byId = new Map(results.map((check) => [check.id, check]));
    contactChecks(ligand, positions, metal, environment, options, (id, fields) => Object.assign(byId.get(id), fields));
    return summarize(null, results);
  }
  // The organic part: metal atoms and their bonds removed, indices mapped back afterwards.
  const kept = ligand.atoms.map((_, index) => index).filter((index) => !metal[index]);
  const newIndex = new Map(kept.map((index, position) => [index, position]));
  const organic = {
    atoms: kept.map((index) => ligand.atoms[index]),
    bonds: ligand.bonds.filter((bond) => newIndex.has(bond.a) && newIndex.has(bond.b)).map((bond) => ({ ...bond, a: newIndex.get(bond.a), b: newIndex.get(bond.b) })),
  };
  const molecule = perceiveMolecule(organic);
  molecule.names = organic.atoms.map((atom) => atom.name || null);
  const results = new Map(POSE_CHECKS.map((check) => [check.id, { ...check, passed: null, value: NaN, detail: '', atoms: [], links: [], pairs: [] }]));
  const set = (id, fields) => Object.assign(results.get(id), {
    ...fields,
    atoms: (fields.atoms ?? []).map((index) => kept[index]),
    links: (fields.links ?? []).map(([a, b]) => [kept[a], kept[b]]),
  });
  const setOriginal = (id, fields) => Object.assign(results.get(id), fields);

  const metals = metal.filter(Boolean).length;
  const aside = metals ? ` (${metals === 1 ? 'its metal atom is' : `its ${metals} metal atoms are`} left out)` : '';
  set('sanitization', molecule.problem ? { passed: false, detail: molecule.problem } : { passed: true, detail: `Valences within RDKit's limits${aside}.` });
  const fragments = countFragments(ligand.atoms.length, ligand.bonds);
  setOriginal('connected', { passed: fragments <= 1, value: fragments, detail: fragments <= 1 ? 'One molecule.' : `${fragments} separate pieces.` });

  const organicPositions = kept.map((index) => positions[index]);
  if (!molecule.problem && organic.atoms.length > 1) geometryChecks(molecule, organicPositions, set);
  else if (organic.atoms.length === 1) {
    for (const id of ['bond-lengths', 'bond-angles', 'internal-clash']) set(id, { passed: true, detail: 'A single atom.' });
  }
  if (!molecule.problem) flatnessChecks(molecule, organicPositions, set);
  if (options.reference) stereoChecks(molecule, organic, options.reference, set);
  else for (const id of ['chirality', 'double-bond-stereo']) set(id, { detail: 'Needs the dictionary definition of the molecule to compare with.' });
  contactChecks(ligand, positions, metal, environment, options, setOriginal);

  return summarize(molecule, [...results.values()]);
}

function summarize(molecule, checks) {
  const decided = checks.filter((check) => check.passed !== null);
  return {
    molecule,
    checks,
    checked: decided.length,
    passed: decided.filter((check) => check.passed).length,
    failed: decided.filter((check) => !check.passed).map((check) => check.id),
  };
}

// RDKit's metals: groups 1 and 2 below hydrogen, the d- and f-blocks, and Al, Ga, In, Sn, Tl, Pb,
// Bi and Po.
function isMetal(z) {
  return [3, 4, 11, 12, 13, 19, 20, 31, 37, 38, 49, 50, 55, 56, 81, 82, 83, 84, 87, 88].includes(z) || (z >= 21 && z <= 30) || (z >= 39 && z <= 48) || (z >= 57 && z <= 80) || z >= 89;
}

// The pose of one residue of a parsed model (parse.js, chemistry.js) for checkPose(): its heavy
// atoms with the bonds and charges of the definition it matched, from the dictionary or the file;
// aromatic bonds without a Kekulé order (MOL2 and SDF aromatic types) are kekulized. Without a
// matched definition the bond orders are unknown and `bonds` is null: only the contact checks
// run. Every other atom of the model is environment, classed as PoseBusters classes it, but the
// residues in options.skip (a crystal ligand docking poses were placed over, or the pose itself);
// atoms covalently bonded to the residue, and their neighbors, are listed to be left out.
export function residuePose(model, residue, component = null, options = {}) {
  const heavy = residue.atoms.filter((atom) => !atom.isHydrogen);
  const typed = component && !component.untyped && (residue.chemistry === 'ccd' || residue.chemistry === 'file');
  let bonds = null;
  const atoms = heavy.map((atom) => {
    const name = typed ? componentName(component, atom.name) : null;
    const record = name ? component.atoms.get(name) : null;
    return { name: name ?? String(atom.name ?? '').toUpperCase(), element: atom.element, charge: Number.isFinite(record?.charge) ? record.charge : atom.charge ?? 0, x: atom.x, y: atom.y, z: atom.z, id: atom.id };
  });
  if (typed) {
    const position = new Map(atoms.map((atom, index) => [atom.name, index]));
    const kekule = [...component.bonds.values()].some((bond) => bond.aromatic && bond.order === 2);
    bonds = [];
    for (const [key, bond] of component.bonds) {
      const [a, b] = key.split('|');
      if (!position.has(a) || !position.has(b)) continue;
      bonds.push({ a: position.get(a), b: position.get(b), order: bond.aromatic && !kekule ? 1.5 : bond.order });
    }
  }
  // A linked atom (a glycan's asparagine ND2, a covalent inhibitor's cysteine SG) is a bond
  // length from the ligand and its neighbors an angle away: both are left out.
  const inLigand = new Set(residue.atoms.map((atom) => atom.id));
  const linked = new Set();
  for (const bond of model.bonds ?? []) {
    if (bond.kind !== 'covalent' || inLigand.has(bond.a) === inLigand.has(bond.b)) continue;
    linked.add(inLigand.has(bond.a) ? bond.b : bond.a);
  }
  const bondedKeys = new Set(linked);
  if (linked.size) {
    for (const bond of model.bonds) {
      if (bond.kind !== 'covalent') continue;
      if (linked.has(bond.a) && !inLigand.has(bond.b)) bondedKeys.add(bond.b);
      if (linked.has(bond.b) && !inLigand.has(bond.a)) bondedKeys.add(bond.a);
    }
  }
  const environment = modelEnvironment(model, (other) => other === residue || Boolean(options.skip?.has(other.key)));
  const reference = typed && component.source === 'ccd' ? componentReference(component) : null;
  return { ligand: { atoms, bonds }, typed: Boolean(typed), environment, bondedKeys, reference };
}

// Every heavy atom of a model's residues but the skipped ones, keyed by atom id and classed as
// PoseBusters classes it.
export function modelEnvironment(model, skip = () => false) {
  const environment = [];
  for (const residue of model.residues) {
    if (skip(residue)) continue;
    const water = residue.kind === 'water';
    for (const atom of residue.atoms) {
      if (atom.isHydrogen) continue;
      environment.push({ key: atom.id, element: atom.element, x: atom.x, y: atom.y, z: atom.z, contact: contactClass({ element: atom.element, resName: residue.resName, hetero: atom.isHet, water }), residue: residue.key, label: `${residue.resName} ${residue.chain}${residue.resSeq}${residue.iCode || ''} ${atom.name}` });
    }
  }
  return environment;
}

// A molecule read from a docking file (molfile.js) as checkPose()'s ligand: heavy atoms with the
// file's bonds, aromatic ones kekulized when the file gives no Kekulé structure. Files without
// bond orders (PDBQT) give bonds null: only the contact checks run. `place` moves coordinates
// into the scene's frame.
export function moleculePose(molecule, place = (x, y, z) => [x, y, z]) {
  const heavy = [];
  const index = new Map();
  molecule.atoms.forEach((atom, position) => {
    if (String(atom.element).toUpperCase() === 'H') return;
    index.set(position, heavy.length);
    const [x, y, z] = place(atom.x, atom.y, atom.z);
    heavy.push({ name: atom.name, element: atom.element, charge: atom.charge ?? 0, x, y, z });
  });
  if (molecule.untyped) return { atoms: heavy, bonds: null };
  const kekule = molecule.bonds.some((bond) => bond.aromatic && bond.order === 2);
  const bonds = molecule.bonds
    .filter((bond) => index.has(bond.a) && index.has(bond.b))
    .map((bond) => ({ a: index.get(bond.a), b: index.get(bond.b), order: bond.aromatic && !kekule ? 1.5 : bond.order }));
  return { atoms: heavy, bonds };
}

// A dictionary definition as checkPose()'s stereo reference: atoms with ideal coordinates. With
// a ligand (residuePose()), only when the ligand is that molecule: each heavy atom in the
// definition under its name and element, each bond among them in it too (a SMILES ligand named
// LIG is not the dictionary's LIG).
export function componentReference(component, ligand = null) {
  if (ligand) {
    for (const atom of ligand.atoms) {
      const record = component.atoms.get(atom.name);
      if (!record || record.element !== String(atom.element).toUpperCase()) return null;
    }
    for (const bond of ligand.bonds ?? []) {
      const a = ligand.atoms[bond.a].name;
      const b = ligand.atoms[bond.b].name;
      if (!component.bonds.has(a < b ? `${a}|${b}` : `${b}|${a}`)) return null;
    }
  }
  const atoms = new Map();
  for (const [name, atom] of component.atoms) {
    if ([atom.x, atom.y, atom.z].every(Number.isFinite)) atoms.set(name, { x: atom.x, y: atom.y, z: atom.z, stereo: atom.stereo ?? '' });
  }
  if (!atoms.size) return null;
  const bonds = [...component.bonds].map(([key, bond]) => {
    const [a, b] = key.split('|');
    return { a, b, stereo: bond.stereo ?? '' };
  });
  return { atoms, bonds };
}

function countFragments(count, bonds) {
  const parent = Array.from({ length: count }, (_, index) => index);
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (const bond of bonds) parent[find(bond.a)] = find(bond.b);
  let roots = 0;
  for (let index = 0; index < count; index += 1) if (find(index) === index) roots += 1;
  return roots;
}

const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const count = (n, singular, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;

/* ---------- Bond lengths, angles and internal clashes ---------- */

// Terminal O or N atoms on one atom, one single- and one double-bonded (carboxylates, nitro
// groups, amidines): PoseBusters gives all such bonds of an element pair the widest bounds among
// them, since the file's choice of which bond is double is arbitrary.
function terminalConjugatedBonds(molecule) {
  const { atoms, bonds, neighbors } = molecule;
  const terminal = (index) => (atoms[index].z === 8 || atoms[index].z === 7) && neighbors[index].length === 1;
  const matched = [];
  for (const atom of atoms) {
    if (!terminal(atom.index)) continue;
    const bond = bonds[neighbors[atom.index][0]];
    const center = otherAtom(bond, atom.index);
    const wanted = bond.order === 1 ? 2 : bond.order === 2 ? 1 : 0;
    if (!wanted) continue;
    const partner = neighbors[center].some((bondIndex) => {
      const other = otherAtom(bonds[bondIndex], center);
      return other !== atom.index && terminal(other) && bonds[bondIndex].order === wanted;
    });
    if (partner) matched.push(bond.index);
  }
  return matched;
}

function geometryChecks(molecule, positions, set) {
  const { atoms, bonds, neighbors } = molecule;
  let bounds;
  try {
    bounds = boundsMatrix(molecule);
  } catch (error) {
    const detail = `RDKit's bounds could not be built (${error.message}).`;
    for (const id of ['bond-lengths', 'bond-angles', 'internal-clash']) set(id, { detail });
    return;
  }
  const n = atoms.length;
  const lower = (i, j) => bounds.lower(i, j);
  const upper = (i, j) => bounds.upper(i, j);
  const bondPairs = new Set(bonds.map((bond) => (bond.a < bond.b ? bond.a * n + bond.b : bond.b * n + bond.a)));
  const anglePairs = new Set();
  for (const atom of atoms) {
    const list = neighbors[atom.index];
    for (let p = 0; p < list.length; p += 1) {
      for (let q = p + 1; q < list.length; q += 1) {
        const a = otherAtom(bonds[list[p]], atom.index);
        const b = otherAtom(bonds[list[q]], atom.index);
        anglePairs.add(a < b ? a * n + b : b * n + a);
      }
    }
  }
  // Symmetrized bounds for terminal conjugated bonds, by element pair.
  const widened = new Map();
  const groups = new Map();
  for (const bondIndex of terminalConjugatedBonds(molecule)) {
    const bond = bonds[bondIndex];
    const key = [atoms[bond.a].symbol, atoms[bond.b].symbol].sort().join('-');
    const range = groups.get(key) ?? { lower: Infinity, upper: -Infinity, members: [] };
    range.lower = Math.min(range.lower, lower(bond.a, bond.b));
    range.upper = Math.max(range.upper, upper(bond.a, bond.b));
    range.members.push(bond);
    groups.set(key, range);
  }
  for (const range of groups.values()) for (const bond of range.members) widened.set(bond.index, range);

  const outOfBounds = (value, low, high) => (value < low ? (value - low) / low : value > high ? (value - high) / high : 0);
  const badBonds = [];
  let shortest = Infinity;
  let longest = -Infinity;
  for (const bond of bonds) {
    const range = widened.get(bond.index);
    const low = range ? range.lower : lower(bond.a, bond.b);
    const high = range ? range.upper : upper(bond.a, bond.b);
    const d = distance(positions[bond.a], positions[bond.b]);
    shortest = Math.min(shortest, d / low);
    longest = Math.max(longest, d / high);
    const error = outOfBounds(d, low, high);
    if (Math.abs(error) > BOND_TOLERANCE) badBonds.push({ bond, d, low, high, error });
  }
  set('bond-lengths', {
    passed: badBonds.length === 0,
    value: Math.max(1 - shortest, longest - 1, 0),
    detail: badBonds.length ? `${badBonds.length} of ${count(bonds.length, 'bond')} out of bounds, such as ${bondText(molecule, badBonds[0].bond)} at ${badBonds[0].d.toFixed(2)} Å (${badBonds[0].low.toFixed(2)}–${badBonds[0].high.toFixed(2)} Å).` : bonds.length ? `${bonds.length === 1 ? 'The bond is' : `All ${bonds.length} bonds`} within bounds (shortest ${shortest.toFixed(2)}, longest ${longest.toFixed(2)} of their limits).` : 'No bonds.',
    atoms: [...new Set(badBonds.flatMap(({ bond }) => [bond.a, bond.b]))],
    links: badBonds.map(({ bond }) => [bond.a, bond.b]),
    shortest,
    longest,
  });

  const badAngles = [];
  let extreme = 0;
  let angleCount = 0;
  const badClashes = [];
  let closest = Infinity;
  let pairCount = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const key = i * n + j;
      if (bondPairs.has(key)) continue;
      const d = distance(positions[i], positions[j]);
      const low = lower(i, j);
      if (anglePairs.has(key)) {
        angleCount += 1;
        const high = upper(i, j);
        extreme = Math.max(extreme, 2 - d / low, d / high);
        const error = Math.abs(outOfBounds(d, low, high));
        if (error > ANGLE_TOLERANCE) badAngles.push({ i, j, d, low, high });
      } else {
        pairCount += 1;
        closest = Math.min(closest, d / low);
        if (d < low && (d - low) / low < -CLASH_TOLERANCE) badClashes.push({ i, j, d, low });
      }
    }
  }
  set('bond-angles', {
    passed: badAngles.length === 0,
    value: extreme,
    detail: badAngles.length ? `${badAngles.length} of ${count(angleCount, 'angle')} out of bounds, such as ${atomLabel(molecule, badAngles[0].i)}···${atomLabel(molecule, badAngles[0].j)} at ${badAngles[0].d.toFixed(2)} Å (${badAngles[0].low.toFixed(2)}–${badAngles[0].high.toFixed(2)} Å).` : angleCount ? `${angleCount === 1 ? 'The angle is' : `All ${angleCount} angles`} within bounds.` : 'No angles.',
    atoms: [...new Set(badAngles.flatMap(({ i, j }) => [i, j]))],
    links: badAngles.map(({ i, j }) => [i, j]),
  });
  set('internal-clash', {
    passed: badClashes.length === 0,
    value: closest,
    detail: badClashes.length ? `${count(badClashes.length, 'clashing pair')}, such as ${atomLabel(molecule, badClashes[0].i)}···${atomLabel(molecule, badClashes[0].j)} at ${badClashes[0].d.toFixed(2)} Å (lower bound ${badClashes[0].low.toFixed(2)} Å).` : pairCount ? `No clashes; the closest pair is at ${closest.toFixed(2)} of its lower bound.` : 'No non-bonded pairs.',
    atoms: [...new Set(badClashes.flatMap(({ i, j }) => [i, j]))],
    links: badClashes.map(({ i, j }) => [i, j]),
  });
}

function bondText(molecule, bond) {
  return `${atomLabel(molecule, bond.a)}–${atomLabel(molecule, bond.b)}`;
}

function atomLabel(molecule, index) {
  return molecule.names?.[index] ?? `${molecule.atoms[index].symbol}${index + 1}`;
}

/* ---------- Flatness ---------- */

// Largest absolute distance of the points from their least-squares plane.
export function planeDeviation(points) {
  const count = points.length;
  const center = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k += 1) center[k] += p[k] / count;
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) m[r][c] += d[r] * d[c];
  }
  const normal = symmetricEigen3(m).vectors[2];
  let largest = 0;
  for (const p of points) largest = Math.max(largest, Math.abs((p[0] - center[0]) * normal[0] + (p[1] - center[1]) * normal[1] + (p[2] - center[2]) * normal[2]));
  return largest;
}

function flatnessChecks(molecule, positions, set) {
  const { atoms, bonds, neighbors, rings } = molecule;
  const ringBonds = (ring) => ring.map((atom, index) => bondBetween(molecule, atom, ring[(index + 1) % ring.length]));
  // [ar5^2]1…1 and [ar6^2]1…1: aromatic sp2 atoms whose smallest ring has that size, joined by
  // single or aromatic bonds.
  const aromatic = [];
  for (const ring of rings) {
    if (ring.length !== 5 && ring.length !== 6) continue;
    if (!ring.every((index) => atoms[index].aromatic && atoms[index].hybridization === 'SP2' && atoms[index].minRing === ring.length)) continue;
    if (!ringBonds(ring).every((bond) => bond.order === 1 || bond.order === 1.5)) continue;
    aromatic.push(ring);
  }
  flatResult(set, 'aromatic-flatness', aromatic.map((ring) => ({ atoms: ring, deviation: planeDeviation(ring.map((index) => positions[index])) })), { singular: 'aromatic ring', plural: 'aromatic rings' }, (d) => d <= FLAT);

  // [C;X3;^2](*)(*)=[C;X3;^2](*)(*): double-bonded aliphatic sp2 carbons, each with two other
  // neighbors and no hydrogens.
  const doubles = [];
  for (const bond of bonds) {
    if (bond.order !== 2 || bond.aromatic) continue;
    const ends = [bond.a, bond.b];
    const ok = ends.every((index) => atoms[index].z === 6 && !atoms[index].aromatic && atoms[index].hybridization === 'SP2' && atoms[index].degree + atoms[index].hydrogens === 3 && neighbors[index].length === 3);
    if (!ok) continue;
    const members = new Set(ends);
    for (const index of ends) for (const bondIndex of neighbors[index]) members.add(otherAtom(bonds[bondIndex], index));
    doubles.push({ atoms: [...members], deviation: planeDeviation([...members].map((index) => positions[index])) });
  }
  flatResult(set, 'double-bond-flatness', doubles, { singular: 'C=C double bond', plural: 'C=C double bonds' }, (d) => d <= FLAT);

  // Isolated non-aromatic six-membered rings of C, O, S or N (each atom in one ring) that should
  // pucker: at most one non-single bond anywhere, or two in PoseBusters' diene patterns.
  const puckered = [];
  for (const ring of rings) {
    if (ring.length !== 6) continue;
    if (!ring.every((index) => !atoms[index].aromatic && [6, 7, 8, 16].includes(atoms[index].z) && atoms[index].ringCount === 1)) continue;
    const orders = ringBonds(ring).map((bond) => bond.order);
    if (!matchesNonFlatPattern(ring.map((index) => atoms[index].z), orders)) continue;
    puckered.push({ atoms: ring, deviation: planeDeviation(ring.map((index) => positions[index])) });
  }
  flatResult(set, 'ring-nonflatness', puckered, { singular: 'saturated six-membered ring', plural: 'saturated six-membered rings' }, (d) => d >= NOT_FLAT, true);
}

// The ring as atoms z[0..5] with bond k joining atoms k and k+1. Patterns from PoseBusters:
// "any" bonds at the listed positions (1-based, bond 6 closes the ring), the others single, and
// carbons where required.
const NON_FLAT = [
  { any: [6], carbons: [] },
  { any: [3, 6], carbons: [1, 2, 5, 6] },
  { any: [3, 6], carbons: [1, 2, 3, 4, 6] },
  { any: [4, 6], carbons: [1, 2, 3, 6] },
  { any: [4, 6], carbons: [1, 2, 4, 5, 6] },
];

function matchesNonFlatPattern(elements, orders) {
  for (let start = 0; start < 6; start += 1) {
    for (const direction of [1, -1]) {
      // Pattern position p (1-based) maps to ring atom start + direction·(p − 1); bond p joins
      // positions p and p + 1.
      const atomAt = (p) => (((start + direction * (p - 1)) % 6) + 6) % 6;
      const bondAt = (p) => (direction === 1 ? atomAt(p) : atomAt(p + 1));
      for (const pattern of NON_FLAT) {
        if (!pattern.carbons.every((p) => elements[atomAt(p)] === 6)) continue;
        let ok = true;
        for (let p = 1; p <= 6 && ok; p += 1) {
          if (!pattern.any.includes(p) && orders[bondAt(p)] !== 1) ok = false;
        }
        if (ok) return true;
      }
    }
  }
  return false;
}

function flatResult(set, id, systems, noun, passes, puckering = false) {
  if (!systems.length) {
    set(id, { passed: true, detail: `No ${noun.plural}.` });
    return;
  }
  const failing = systems.filter((system) => !passes(system.deviation));
  const deviations = systems.map((system) => system.deviation);
  const value = puckering ? Math.min(...deviations) : Math.max(...deviations);
  set(id, {
    passed: failing.length === 0,
    value,
    detail: failing.length
      ? `${failing.length} of ${count(systems.length, noun.singular, noun.plural)} ${failing.length === 1 ? 'is' : 'are'} ${puckering ? 'flat' : 'not flat'} (${puckering ? 'least' : 'largest'} deviation ${value.toFixed(2)} Å).`
      : `${count(systems.length, noun.singular, noun.plural)}; ${puckering ? 'least' : 'largest'} deviation from a plane ${value.toFixed(2)} Å.`,
    atoms: [...new Set(failing.flatMap((system) => system.atoms))],
  });
}

/* ---------- Stereochemistry against the dictionary ---------- */

function signedVolume(center, a, b, c) {
  const u = [a[0] - center[0], a[1] - center[1], a[2] - center[2]];
  const v = [b[0] - center[0], b[1] - center[1], b[2] - center[2]];
  const w = [c[0] - center[0], c[1] - center[1], c[2] - center[2]];
  const volume = u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0]);
  const scale = Math.hypot(...u) * Math.hypot(...v) * Math.hypot(...w);
  return scale > 0 ? volume / scale : 0;
}

function stereoChecks(molecule, ligand, reference, set) {
  const names = ligand.atoms.map((atom) => String(atom.name ?? '').toUpperCase());
  const index = new Map(names.map((name, position) => [name, position]));
  const position = (i) => [ligand.atoms[i].x, ligand.atoms[i].y, ligand.atoms[i].z];
  const ideal = (name) => {
    const atom = reference.atoms.get(name);
    return atom && [atom.x, atom.y, atom.z].every(Number.isFinite) ? [atom.x, atom.y, atom.z] : null;
  };
  // Tetrahedral centers the dictionary labels R or S, with three heavy neighbors present. Centers
  // with two terminal neighbors of one element (the phosphorus of a phosphate, whose oxygens are
  // equivalent by resonance and named in any order) are not stereocenters to InChI either.
  const inverted = [];
  const flattened = [];
  let centers = 0;
  const pseudo = (i) => {
    const terminal = molecule.neighbors[i].map((bondIndex) => otherAtom(molecule.bonds[bondIndex], i)).filter((j) => molecule.neighbors[j].length === 1).map((j) => molecule.atoms[j].z);
    return terminal.some((z, k) => terminal.indexOf(z) !== k);
  };
  for (const [name, atom] of reference.atoms) {
    if (atom.stereo !== 'R' && atom.stereo !== 'S') continue;
    const i = index.get(name);
    if (i === undefined || !ideal(name) || pseudo(i)) continue;
    const partners = molecule.neighbors[i].map((bondIndex) => otherAtom(molecule.bonds[bondIndex], i)).filter((j) => ideal(names[j])).sort((a, b) => (names[a] < names[b] ? -1 : 1)).slice(0, 3);
    if (partners.length < 3) continue;
    centers += 1;
    const pose = signedVolume(position(i), ...partners.map(position));
    const dictionary = signedVolume(ideal(name), ...partners.map((j) => ideal(names[j])));
    if (Math.abs(pose) < 0.05) flattened.push(i);
    else if (Math.sign(pose) !== Math.sign(dictionary)) inverted.push(i);
  }
  const labelOf = (i) => names[i] || `${molecule.atoms[i].symbol}${i + 1}`;
  if (!centers) set('chirality', { passed: true, detail: 'No stereocenters in the dictionary definition.' });
  else {
    const bad = [...inverted, ...flattened];
    set('chirality', {
      passed: bad.length === 0,
      value: bad.length,
      detail: bad.length ? `${[inverted.length ? `${inverted.length} inverted (${inverted.map(labelOf).join(', ')})` : '', flattened.length ? `${flattened.length} flattened (${flattened.map(labelOf).join(', ')})` : ''].filter(Boolean).join('; ')} of ${count(centers, 'stereocenter')}.` : centers === 1 ? 'The stereocenter is as in the dictionary.' : `All ${centers} stereocenters are as in the dictionary.`,
      atoms: bad,
    });
  }
  // Double bonds the dictionary labels E or Z: a substituent on each end, cis or trans.
  const flipped = [];
  let doubleBonds = 0;
  for (const bond of reference.bonds ?? []) {
    if (bond.stereo !== 'E' && bond.stereo !== 'Z') continue;
    const a = index.get(bond.a);
    const b = index.get(bond.b);
    if (a === undefined || b === undefined || !ideal(bond.a) || !ideal(bond.b)) continue;
    const substituent = (end, other) => molecule.neighbors[end].map((bondIndex) => otherAtom(molecule.bonds[bondIndex], end)).filter((j) => j !== other && ideal(names[j])).sort((x, y) => (names[x] < names[y] ? -1 : 1))[0];
    const sa = substituent(a, b);
    const sb = substituent(b, a);
    if (sa === undefined || sb === undefined) continue;
    doubleBonds += 1;
    const cisIn = (p) => {
      const axis = [p(b)[0] - p(a)[0], p(b)[1] - p(a)[1], p(b)[2] - p(a)[2]];
      const u = [p(sa)[0] - p(a)[0], p(sa)[1] - p(a)[1], p(sa)[2] - p(a)[2]];
      const v = [p(sb)[0] - p(b)[0], p(sb)[1] - p(b)[1], p(sb)[2] - p(b)[2]];
      const length2 = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
      const project = (w) => {
        const t = (w[0] * axis[0] + w[1] * axis[1] + w[2] * axis[2]) / length2;
        return [w[0] - t * axis[0], w[1] - t * axis[1], w[2] - t * axis[2]];
      };
      const pu = project(u);
      const pv = project(v);
      return pu[0] * pv[0] + pu[1] * pv[1] + pu[2] * pv[2] > 0;
    };
    if (cisIn(position) !== cisIn((j) => ideal(names[j]))) flipped.push(a, b);
  }
  if (!doubleBonds) set('double-bond-stereo', { passed: true, detail: 'No E/Z double bonds in the dictionary definition.' });
  else {
    set('double-bond-stereo', {
      passed: flipped.length === 0,
      value: flipped.length / 2,
      detail: flipped.length ? `${flipped.length / 2} of ${count(doubleBonds, 'double bond')} with the wrong E/Z geometry (${labelOf(flipped[0])}=${labelOf(flipped[1])}).` : doubleBonds === 1 ? 'The E/Z double bond is as in the dictionary.' : `All ${doubleBonds} E/Z double bonds are as in the dictionary.`,
      atoms: flipped,
    });
  }
}

/* ---------- Contacts ---------- */

const CONTACTS = [
  { id: 'protein', distance: 'protein-distance', overlap: 'protein-overlap', radius: 'vdw', scale: 0.8, noun: 'protein' },
  { id: 'organic', distance: 'organic-distance', overlap: 'organic-overlap', radius: 'vdw', scale: 0.8, noun: 'cofactor' },
  { id: 'inorganic', distance: 'inorganic-distance', overlap: 'inorganic-overlap', radius: 'covalent', scale: 0.5, noun: 'ion' },
  { id: 'water', distance: 'water-distance', overlap: 'water-overlap', radius: 'vdw', scale: 0.5, noun: 'water' },
];

function contactChecks(ligand, positions, metal, environment, options, set) {
  const bonded = options.bondedKeys ?? new Set();
  const heavy = ligand.atoms.map((atom, index) => ({ index, element: atom.element, position: positions[index], metal: metal[index] })).filter((atom) => {
    const symbol = String(atom.element).toUpperCase();
    return symbol !== 'H' && symbol !== 'D';
  });
  // Environment atoms within the search distance of any ligand atom, via a coarse grid.
  const cell = SEARCH_DISTANCE;
  const grid = new Map();
  const keyOf = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const atom of heavy) {
    const key = keyOf(...atom.position);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(atom);
  }
  const nearby = new Map(CONTACTS.map((kind) => [kind.id, []]));
  // The ligand's box, grown by the search distance, rules out most of a large structure at once.
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const atom of heavy) {
    for (let k = 0; k < 3; k += 1) {
      low[k] = Math.min(low[k], atom.position[k] - SEARCH_DISTANCE);
      high[k] = Math.max(high[k], atom.position[k] + SEARCH_DISTANCE);
    }
  }
  for (const atom of environment) {
    if (!nearby.has(atom.contact) || bonded.has(atom.key)) continue;
    if (atom.x < low[0] || atom.x > high[0] || atom.y < low[1] || atom.y > high[1] || atom.z < low[2] || atom.z > high[2]) continue;
    const cx = Math.floor(atom.x / cell);
    const cy = Math.floor(atom.y / cell);
    const cz = Math.floor(atom.z / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const ligandAtom of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) best = Math.min(best, distance(ligandAtom.position, [atom.x, atom.y, atom.z]));
        }
      }
    }
    if (best <= SEARCH_DISTANCE) nearby.get(atom.contact).push({ ...atom, nearest: best });
  }
  for (const kind of CONTACTS) {
    const atoms = nearby.get(kind.id);
    const radius = (element) => (kind.radius === 'vdw' ? elementRecord(element).vdw : elementRecord(element).covalent);
    let smallest = Infinity;
    let ratio = Infinity;
    const clashes = [];
    for (const other of atoms) {
      const q = [other.x, other.y, other.z];
      const r2 = radius(other.element);
      for (const atom of heavy) {
        const d = distance(atom.position, q);
        // A metal of the ligand is measured by covalent radii, as inorganic cofactors are.
        const relative = atom.metal ? d / (elementRecord(atom.element).covalent + elementRecord(other.element).covalent) : d / (radius(atom.element) + r2);
        smallest = Math.min(smallest, d);
        ratio = Math.min(ratio, relative);
        if (relative < CONTACT_RATIO) clashes.push({ ligand: atom.index, key: other.key, d, relative, label: other.label });
      }
    }
    clashes.sort((a, b) => a.relative - b.relative);
    const noun = kind.noun;
    set(kind.distance, {
      passed: clashes.length === 0,
      value: ratio,
      detail: !atoms.length ? `No ${noun} atoms within ${SEARCH_DISTANCE} Å.` : clashes.length ? `${clashes.length} ${clashes.length === 1 ? 'pair' : 'pairs'} too close, the closest ${clashes[0].d.toFixed(2)} Å (${clashes[0].relative.toFixed(2)} of the radii)${clashes[0].label ? ` to ${clashes[0].label}` : ''}.` : `Closest ${noun} atom ${smallest.toFixed(2)} Å (${ratio.toFixed(2)} of the radii).`,
      atoms: [...new Set(clashes.map((clash) => clash.ligand))],
      pairs: clashes.map((clash) => [clash.ligand, clash.key]),
      smallest,
    });
    if (kind.id === 'protein') {
      set('protein-near', {
        passed: smallest <= MAX_DISTANCE,
        value: smallest,
        detail: Number.isFinite(smallest) ? `Closest protein atom ${smallest.toFixed(2)} Å away.` : `No protein atom within ${SEARCH_DISTANCE} Å.`,
      });
    }
    // Volume overlap: environment atoms within 6 Å × the radius scale.
    const close = atoms.filter((atom) => atom.nearest <= SEARCH_DISTANCE * kind.scale);
    if (!close.length || !heavy.length) {
      set(kind.overlap, { passed: true, value: 0, detail: `No ${noun} atoms close enough to overlap.` });
      continue;
    }
    const overlap = shapeOverlap(heavy.map((atom) => ({ element: atom.element, position: atom.position })), close.map((atom) => ({ element: atom.element, position: [atom.x, atom.y, atom.z] })), kind.scale);
    set(kind.overlap, {
      passed: overlap <= OVERLAP_LIMIT,
      value: overlap,
      detail: `${(overlap * 100).toFixed(1)}% of the ligand volume inside the ${noun} (limit ${OVERLAP_LIMIT * 100}%).`,
    });
  }
}

// RDKit's ShapeTverskyIndex(ligand, other, alpha 1, beta 0): both molecules are encoded on one
// grid (0.5 Å spacing, 2 bits per point) in the ligand's principal-axes frame, each atom a sphere
// of its van der Waals radius × scale with value 3 inside and 2, 1 in 0.25 Å shells outside
// (the largest value wins); the overlap is Σ min(ligand, other) / Σ ligand. The axes' signs
// follow this solver rather than RDKit's, which moves the grid by a fraction of a spacing.
export function shapeOverlap(first, second, scale, spacing = 0.5) {
  const count = first.length;
  const centroid = [0, 0, 0];
  for (const atom of first) for (let k = 0; k < 3; k += 1) centroid[k] += atom.position[k] / count;
  const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const atom of first) {
    const d = atom.position.map((value, k) => value - centroid[k]);
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) covariance[r][c] += d[r] * d[c];
  }
  let axes = count > 1 ? symmetricEigen3(covariance).vectors : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const determinant = axes[0][0] * (axes[1][1] * axes[2][2] - axes[1][2] * axes[2][1]) - axes[0][1] * (axes[1][0] * axes[2][2] - axes[1][2] * axes[2][0]) + axes[0][2] * (axes[1][0] * axes[2][1] - axes[1][1] * axes[2][0]);
  if (determinant < 0) axes = [axes[0], axes[1], axes[2].map((value) => -value)];
  const transform = (p) => {
    const d = [p[0] - centroid[0], p[1] - centroid[1], p[2] - centroid[2]];
    return axes.map((axis) => axis[0] * d[0] + axis[1] * d[1] + axis[2] * d[2]);
  };
  const a = first.map((atom) => ({ radius: elementRecord(atom.element).vdw * scale, position: transform(atom.position) }));
  const b = second.map((atom) => ({ radius: elementRecord(atom.element).vdw * scale, position: transform(atom.position) }));
  const padding = 2.5;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const atom of [...a, ...b]) {
    for (let k = 0; k < 3; k += 1) {
      low[k] = Math.min(low[k], atom.position[k] - padding);
      high[k] = Math.max(high[k], atom.position[k] + padding);
    }
  }
  const dims = low.map((value, k) => Math.floor((high[k] - value) / spacing + 0.5));
  const size = dims[0] * dims[1] * dims[2];
  const encode = (atoms) => {
    const grid = new Uint8Array(size);
    const step = 0.25 / spacing;
    for (const atom of atoms) {
      const g = atom.position.map((value, k) => (value - low[k]) / spacing);
      const index = g.map((value) => Math.floor(value + 0.5));
      if (index.some((value, k) => value < 0 || value >= dims[k])) continue;
      const base = atom.radius / spacing;
      const outer = base + 3 * step;
      const outer2 = outer * outer;
      const base2 = base * base;
      for (let z = Math.ceil(g[2] - outer); z <= Math.floor(g[2] + outer); z += 1) {
        if (z < 0 || z >= dims[2]) continue;
        const dz2 = (z - g[2]) ** 2;
        for (let y = Math.ceil(g[1] - outer); y <= Math.floor(g[1] + outer); y += 1) {
          if (y < 0 || y >= dims[1]) continue;
          const dyz = (y - g[1]) ** 2 + dz2;
          if (dyz >= outer2) continue;
          const row = (z * dims[1] + y) * dims[0];
          for (let x = Math.ceil(g[0] - outer); x <= Math.floor(g[0] + outer); x += 1) {
            if (x < 0 || x >= dims[0]) continue;
            const current = grid[row + x];
            if (current >= 3) continue;
            const d2 = (x - g[0]) ** 2 + dyz;
            if (d2 >= outer2) continue;
            let value = 3;
            if (d2 >= base2) {
              const change = Math.floor((Math.sqrt(d2) - base) / step + 1);
              value = change < 3 ? 3 - change : 0;
            }
            if (value > current) grid[row + x] = value;
          }
        }
      }
    }
    return grid;
  };
  const gridA = encode(a);
  const gridB = encode(b);
  let total = 0;
  let shared = 0;
  for (let index = 0; index < size; index += 1) {
    total += gridA[index];
    shared += Math.min(gridA[index], gridB[index]);
  }
  return total ? shared / total : 0;
}
