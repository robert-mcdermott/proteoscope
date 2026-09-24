import {
  AMINO_ACID_CODES,
  METAL_ELEMENTS,
  MODIFIED_NUCLEOTIDES,
  NUCLEOTIDE_CODES,
  PROTONATION_VARIANTS,
  parentResidue,
  residueKindFromName,
} from './residues.js';

export const INTERACTION_TYPES = [
  { id: 'hydrogen-bond', label: 'Hydrogen bond', color: '#3fa7ff' },
  { id: 'salt-bridge', label: 'Salt bridge', color: '#ff5fa2' },
  { id: 'pi-stacking', label: 'π-stacking', color: '#39d98a' },
  { id: 'cation-pi', label: 'Cation–π', color: '#ffb347' },
  { id: 'hydrophobic', label: 'Hydrophobic', color: '#9aa3ad' },
  { id: 'halogen-bond', label: 'Halogen bond', color: '#40e0d0' },
  { id: 'metal-coordination', label: 'Metal coordination', color: '#b388ff' },
  { id: 'water-bridge', label: 'Water bridge', color: '#7ec8ff' },
];

// PLIP defaults (plip/basic/config.py).
const MIN_DIST = 0.5;
const HYDROPH_DIST_MAX = 4.0;
const HBOND_DIST_MAX = 4.1;
const HBOND_DON_ANGLE_MIN = 100;
const PISTACK_DIST_MAX = 5.5;
const PISTACK_ANG_DEV = 30;
const PISTACK_OFFSET_MAX = 2.0;
const PICATION_DIST_MAX = 6.0;
const SALTBRIDGE_DIST_MAX = 5.5;
const HALOGEN_DIST_MAX = 4.0;
const HALOGEN_ACC_ANGLE = 120;
const HALOGEN_DON_ANGLE = 165;
const HALOGEN_ANGLE_DEV = 30;
const WATER_BRIDGE_MINDIST = 2.5;
const WATER_BRIDGE_MAXDIST = 4.1;
const METAL_DIST_MAX = 3.0;
// PLIP's pi-cation check for tertiary amines (plip/structure/detection.py).
const TERTIARY_AMINE_ANGLE_MAX = 30;

// Without explicit hydrogens the D–H···A angle is unknown, so the donor–acceptor distance is
// tightened and every heavy neighbour X of the donor must satisfy X–D···A >= 90°.
const HBOND_HEAVY_DIST_MAX = 3.5;
const HBOND_HEAVY_ANGLE_MIN = 90;
const METAL_BOND_MAX = 2.6;
const RING_PLANARITY_MAX = 0.2;
const EXCLUDED_BOND_SEPARATION = 3;
const HYDROPHOBIC_PER_RESIDUE_PAIR = 3;
const CARBONYL_MAX = 1.3;
const THIOCARBONYL_MAX = 1.72;
const PAIR_SEARCH_RADIUS = Math.max(HBOND_DIST_MAX, HYDROPH_DIST_MAX, HALOGEN_DIST_MAX, METAL_DIST_MAX);
const GRID_CELL = PAIR_SEARCH_RADIUS;
const GRID_OFFSET = 8192;
const GRID_SPAN = 16384;
const DEGREES = 180 / Math.PI;

const DONOR = 1;
const ACCEPTOR = 2;
const HYDROPHOBIC = 4;
const HALOGEN_DONOR = 8;
const HALOGEN_ACCEPTOR = 16;
const METAL = 32;
const WATER = 64;
const HYDROGEN = 128;
const POLAR = DONOR | ACCEPTOR;
const PAIR_ROLES = POLAR | HYDROPHOBIC | HALOGEN_DONOR | HALOGEN_ACCEPTOR | METAL;
const PYRIDINE_TYPE = 1;
const PYRROLE_TYPE = 2;
const TAUTOMERIC_TYPE = 3;

const EMPTY = [];
const TYPE_ORDER = new Map(INTERACTION_TYPES.map((type, index) => [type.id, index]));
const LIGATING_ELEMENTS = new Set(['N', 'O', 'S']);
const HALOGEN_BOND_DONORS = new Set(['CL', 'BR', 'I']);
const HALIDES = new Set(['F', 'CL', 'BR', 'I']);

const PROTEIN_RINGS = {
  PHE: [['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']],
  TYR: [['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']],
  TRP: [
    ['CG', 'CD1', 'NE1', 'CE2', 'CD2'],
    ['CD2', 'CE2', 'CZ2', 'CH2', 'CZ3', 'CE3'],
  ],
  HIS: [['CG', 'ND1', 'CE1', 'NE2', 'CD2']],
};
const PURINE_RINGS = [
  ['N1', 'C2', 'N3', 'C4', 'C5', 'C6'],
  ['C4', 'C5', 'N7', 'C8', 'N9'],
];
const PYRIMIDINE_RINGS = [['N1', 'C2', 'N3', 'C4', 'C5', 'C6']];
const BASE_RINGS = { A: PURINE_RINGS, G: PURINE_RINGS, I: PURINE_RINGS, C: PYRIMIDINE_RINGS, U: PYRIMIDINE_RINGS, T: PYRIMIDINE_RINGS };

const SIDECHAIN_ROLES = {
  ARG: { NE: DONOR, NH1: DONOR, NH2: DONOR },
  ASN: { OD1: ACCEPTOR, ND2: DONOR },
  ASP: { OD1: ACCEPTOR, OD2: ACCEPTOR },
  CYS: { SG: DONOR },
  GLN: { OE1: ACCEPTOR, NE2: DONOR },
  GLU: { OE1: ACCEPTOR, OE2: ACCEPTOR },
  HIS: { ND1: POLAR, NE2: POLAR },
  LYS: { NZ: DONOR },
  MET: { SD: ACCEPTOR },
  SER: { OG: POLAR },
  THR: { OG1: POLAR },
  TRP: { NE1: DONOR },
  TYR: { OH: POLAR },
};
const NUCLEIC_BACKBONE_ROLES = {
  OP1: ACCEPTOR,
  OP2: ACCEPTOR,
  OP3: ACCEPTOR,
  O1P: ACCEPTOR,
  O2P: ACCEPTOR,
  O3P: ACCEPTOR,
  "O2'": POLAR,
  "O3'": ACCEPTOR,
  "O4'": ACCEPTOR,
  "O5'": ACCEPTOR,
};
const BASE_ROLES = {
  A: { N1: ACCEPTOR, N3: ACCEPTOR, N6: DONOR, N7: ACCEPTOR },
  G: { N1: DONOR, N2: DONOR, N3: ACCEPTOR, O6: ACCEPTOR, N7: ACCEPTOR },
  I: { N1: DONOR, N3: ACCEPTOR, O6: ACCEPTOR, N7: ACCEPTOR },
  C: { O2: ACCEPTOR, N3: ACCEPTOR, N4: DONOR },
  U: { O2: ACCEPTOR, N3: DONOR, O4: ACCEPTOR },
  T: { O2: ACCEPTOR, N3: DONOR, O4: ACCEPTOR },
};
const CHARGED_SIDECHAINS = {
  LYS: { sign: 1, atoms: ['NZ'], label: 'lysine' },
  ARG: { sign: 1, atoms: ['NE', 'NH1', 'NH2'], label: 'arginine' },
  HIS: { sign: 1, atoms: ['ND1', 'NE2'], label: 'histidine' },
  ASP: { sign: -1, atoms: ['OD1', 'OD2'], label: 'aspartate' },
  GLU: { sign: -1, atoms: ['OE1', 'OE2'], label: 'glutamate' },
};
const NEUTRAL_VARIANTS = new Set(['HID', 'HIE', 'HSD', 'HSE', 'ASH', 'GLH', 'LYN', 'ARN']);
const CHARGED_HISTIDINES = new Set(['HIP', 'HSP']);
const PHOSPHATE_OXYGENS = ['OP1', 'OP2', 'OP3', 'O1P', 'O2P', 'O3P'];

const contexts = new WeakMap();

export function findInteractions(model, groupA, options = {}) {
  const context = modelContext(model);
  const query = createQuery(context, groupA, options);
  const { wanted } = query;
  if (!query.atomsA.length || !wanted.size) return [];
  const useRings = wanted.has('pi-stacking') || wanted.has('cation-pi') || wanted.has('hydrophobic');
  const useCharges = wanted.has('salt-bridge') || wanted.has('cation-pi') || wanted.has('hydrogen-bond');
  const [ringsA, ringsB] = useRings ? splitBySide(context, query, context.rings, (ring) => ring.aromatic) : [EMPTY, EMPTY];
  const [chargesA, chargesB] = useCharges
    ? splitBySide(context, query, context.charges, (group) => query.histidinePositive || !group.histidine)
    : [EMPTY, EMPTY];
  const stacking = useRings ? detectStacking(ringsA, ringsB) : EMPTY;
  const saltBridges = useCharges ? detectSaltBridges(context, chargesA, chargesB) : EMPTY;
  const pairs = detectAtomPairs(context, query);
  const interactions = [];
  if (wanted.has('hydrogen-bond')) {
    for (const bond of refineHydrogenBonds(context, pairs.hydrogenBonds, saltBridges)) {
      interactions.push(hydrogenBondInteraction(context, bond));
    }
  }
  if (wanted.has('salt-bridge')) {
    for (const bridge of saltBridges) interactions.push(saltBridgeInteraction(context, bridge));
  }
  if (wanted.has('pi-stacking')) {
    for (const contact of stacking) interactions.push(stackingInteraction(context, contact));
  }
  if (wanted.has('cation-pi')) {
    for (const contact of detectCationPi(chargesA, chargesB, ringsA, ringsB)) {
      interactions.push(cationPiInteraction(context, contact));
    }
  }
  if (wanted.has('hydrophobic')) {
    for (const contact of refineHydrophobic(context, pairs.hydrophobic, stacking)) {
      interactions.push(atomInteraction(context, 'hydrophobic', contact, {}));
    }
  }
  if (wanted.has('halogen-bond')) {
    for (const bond of pairs.halogenBonds) interactions.push(halogenBondInteraction(context, bond));
  }
  if (wanted.has('metal-coordination')) {
    for (const contact of pairs.metalContacts) interactions.push(metalInteraction(context, contact));
  }
  if (wanted.has('water-bridge')) {
    for (const bridge of detectWaterBridges(context, query)) interactions.push(waterBridgeInteraction(context, bridge));
  }
  return interactions.sort(compareInteractions);
}

export function findInterfaceInteractions(model, chainA, chainB, options = {}) {
  const context = modelContext(model);
  const chainsA = chainSet(chainA);
  const chainsB = chainSet(chainB);
  const groupA = [];
  const groupB = [];
  for (let index = 0; index < context.count; index += 1) {
    if (context.flags[index] & (WATER | HYDROGEN)) continue;
    const chain = model.atoms[index].chain;
    if (chainsA.has(chain)) groupA.push(index);
    else if (chainsB.has(chain)) groupB.push(index);
  }
  return findInteractions(model, groupA, { ...options, groupB });
}

export function perceiveRings(model, atomIndices) {
  const context = modelContext(model);
  const selected = atomIndices == null ? null : indexMask(context.count, atomIndices);
  const rings = [];
  for (const ring of context.rings) {
    if (selected && !ring.atoms.every((index) => selected[index])) continue;
    rings.push({
      atoms: ring.atoms.slice(),
      centroid: ring.centroid.slice(),
      normal: ring.normal.slice(),
      aromatic: ring.aromatic,
      residueKey: context.residues[ring.residue].key,
    });
  }
  return rings;
}

// The chemistry of some atoms (a ligand) as interaction detection sees it at pH 7: charged
// groups, hydrogen-bond donors and acceptors, and aromatic rings.
export function ligandChemistry(model, atomIndices) {
  const context = modelContext(model);
  const selected = indexMask(context.count, atomIndices);
  const inside = (atoms) => atoms.every((index) => selected[index]);
  const heavy = atomIndices.filter((index) => !(context.flags[index] & (HYDROGEN | METAL | WATER)));
  return {
    charges: context.charges.filter((group) => inside(group.atoms)).map((group) => ({ label: group.label, sign: group.sign, atoms: group.atoms.slice() })),
    donors: heavy.filter((index) => context.flags[index] & DONOR),
    acceptors: heavy.filter((index) => context.flags[index] & ACCEPTOR),
    aromaticRings: context.rings.filter((ring) => ring.aromatic && inside(ring.atoms)).map((ring) => ring.atoms.slice()),
  };
}

function modelContext(model) {
  const cached = contexts.get(model);
  if (
    cached && cached.atoms === model.atoms && cached.bonds === model.bonds &&
    cached.count === (model.atoms?.length ?? 0) && cached.chemistryVersion === model.chemistryVersion
  ) {
    return cached;
  }
  const context = buildContext(model);
  contexts.set(model, context);
  return context;
}

function buildContext(model) {
  const atoms = model.atoms ?? [];
  const count = atoms.length;
  const context = {
    atoms: model.atoms,
    bonds: model.bonds,
    chemistryVersion: model.chemistryVersion,
    count,
    positions: new Float64Array(count * 3),
    elements: new Array(count),
    names: new Array(count),
    flags: new Uint8Array(count),
    capacity: new Uint8Array(count),
    aromatic: new Uint8Array(count),
    ringNitrogen: new Uint8Array(count),
    residueOf: new Int32Array(count),
    // Chemistry from the dictionary or the file (chemistry.js): typed atoms know their
    // hydrogens, and bonds between typed atoms their order.
    typed: new Uint8Array(count),
    hydrogenCount: new Int8Array(count),
    formalCharge: new Int8Array(count),
    orders: new Map(),
    residues: [],
    neighbors: new Array(count),
    hydrogens: new Array(count),
    metalLinks: new Array(count),
    grid: null,
    rings: [],
    charges: [],
  };
  indexAtoms(context, atoms);
  linkBonds(context, model.bonds ?? EMPTY);
  context.grid = buildGrid(context.positions, count);
  linkMetals(context);
  const chainStarts = new Set();
  const seenChains = new Set();
  context.residues.forEach((residue, residueIndex) => {
    if (residue.kind === 'protein' && !seenChains.has(residue.chain)) {
      seenChains.add(residue.chain);
      chainStarts.add(residueIndex);
    }
    perceiveResidueRings(context, residue, residueIndex);
  });
  context.residues.forEach((residue, residueIndex) => {
    perceiveResidueChemistry(context, residue, residueIndex, chainStarts.has(residueIndex));
  });
  return context;
}

function indexAtoms(context, atoms) {
  const residueIndexByKey = new Map();
  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index];
    context.positions[index * 3] = atom.x;
    context.positions[index * 3 + 1] = atom.y;
    context.positions[index * 3 + 2] = atom.z;
    const element = String(atom.element ?? '').trim().toUpperCase();
    context.elements[index] = element;
    context.names[index] = String(atom.name ?? '').trim().toUpperCase().replaceAll('*', "'");
    const key = atom.residueKey ?? `${atom.chain}:${atom.resSeq}${atom.iCode ?? ''}:${atom.resName}`;
    let residueIndex = residueIndexByKey.get(key);
    if (residueIndex === undefined) {
      residueIndex = context.residues.length;
      residueIndexByKey.set(key, residueIndex);
      const resName = String(atom.resName ?? '').trim().toUpperCase();
      const kind = atom.isWater ? 'water' : atom.kind ?? residueKindFromName(resName);
      context.residues.push({ key, resName, chain: atom.chain, kind, atoms: [], hasHydrogens: false });
    }
    const residue = context.residues[residueIndex];
    context.residueOf[index] = residueIndex;
    residue.atoms.push(index);
    if (Number.isInteger(atom.hydrogens)) {
      context.typed[index] = 1;
      context.hydrogenCount[index] = atom.hydrogens;
    }
    if (Number.isInteger(atom.charge)) context.formalCharge[index] = Math.max(-4, Math.min(4, atom.charge));
    if (element === 'H' || element === 'D' || (!element && atom.isHydrogen)) {
      context.flags[index] = HYDROGEN;
      residue.hasHydrogens = true;
    } else if (residue.kind === 'water') {
      context.flags[index] = WATER;
    } else if (METAL_ELEMENTS.has(element) && residue.kind !== 'protein' && residue.kind !== 'nucleic') {
      context.flags[index] = METAL;
    }
  }
}

function linkBonds(context, bonds) {
  const { count, flags } = context;
  for (const bond of bonds) {
    const a = bond.a;
    const b = bond.b;
    if (!(a >= 0 && a < count && b >= 0 && b < count) || a === b) continue;
    if ((flags[a] | flags[b]) & HYDROGEN) {
      if (flags[a] & HYDROGEN && !(flags[b] & (HYDROGEN | METAL))) addLink(context.hydrogens, b, a);
      if (flags[b] & HYDROGEN && !(flags[a] & (HYDROGEN | METAL))) addLink(context.hydrogens, a, b);
    } else if ((flags[a] | flags[b]) & METAL) {
      addLink(context.metalLinks, a, b);
      addLink(context.metalLinks, b, a);
    } else if (!((flags[a] | flags[b]) & WATER)) {
      addLink(context.neighbors, a, b);
      addLink(context.neighbors, b, a);
      if (context.typed[a] && context.typed[b]) {
        context.orders.set(a < b ? a * count + b : b * count + a, { order: bond.order ?? 1, aromatic: Boolean(bond.aromatic) });
      }
    }
  }
}

// Order of a bond between two typed atoms (null when the chemistry is not known).
function typedBond(context, a, b) {
  return context.orders.get(a < b ? a * context.count + b : b * context.count + a) ?? null;
}

function hasMultipleBond(context, index) {
  for (const neighbor of context.neighbors[index] ?? EMPTY) {
    const bond = typedBond(context, index, neighbor);
    if (bond && (bond.aromatic || bond.order > 1)) return true;
  }
  return false;
}

// Hydrogens on a typed atom: explicit ones in the model, otherwise the dictionary's.
function hydrogensOf(context, index) {
  const explicit = context.hydrogens[index]?.length ?? 0;
  return explicit || context.hydrogenCount[index];
}

function linkMetals(context) {
  const nearby = [];
  for (let index = 0; index < context.count; index += 1) {
    if (!(context.flags[index] & METAL)) continue;
    collectNearAtom(context, index, METAL_BOND_MAX, nearby);
    for (const other of nearby) {
      if (context.flags[other] & (HYDROGEN | METAL) || !LIGATING_ELEMENTS.has(context.elements[other])) continue;
      addLink(context.metalLinks, index, other);
      addLink(context.metalLinks, other, index);
    }
  }
}

function addLink(lists, from, to) {
  const list = lists[from];
  if (!list) lists[from] = [to];
  else if (!list.includes(to)) list.push(to);
}

function buildGrid(positions, count) {
  const cells = new Map();
  for (let index = 0; index < count; index += 1) {
    const key = cellKey(
      Math.floor(positions[index * 3] / GRID_CELL),
      Math.floor(positions[index * 3 + 1] / GRID_CELL),
      Math.floor(positions[index * 3 + 2] / GRID_CELL),
    );
    const bucket = cells.get(key);
    if (bucket) bucket.push(index);
    else cells.set(key, [index]);
  }
  return cells;
}

function cellKey(x, y, z) {
  return ((x + GRID_OFFSET) * GRID_SPAN + (y + GRID_OFFSET)) * GRID_SPAN + (z + GRID_OFFSET);
}

function collectNearAtom(context, index, radius, out) {
  const p = context.positions;
  return collectNear(context, p[index * 3], p[index * 3 + 1], p[index * 3 + 2], radius, out);
}

function collectNear(context, x, y, z, radius, out) {
  out.length = 0;
  const { grid, positions } = context;
  const limit = radius * radius;
  const maxX = Math.floor((x + radius) / GRID_CELL);
  const maxY = Math.floor((y + radius) / GRID_CELL);
  const maxZ = Math.floor((z + radius) / GRID_CELL);
  for (let cellX = Math.floor((x - radius) / GRID_CELL); cellX <= maxX; cellX += 1) {
    for (let cellY = Math.floor((y - radius) / GRID_CELL); cellY <= maxY; cellY += 1) {
      for (let cellZ = Math.floor((z - radius) / GRID_CELL); cellZ <= maxZ; cellZ += 1) {
        const bucket = grid.get(cellKey(cellX, cellY, cellZ));
        if (!bucket) continue;
        for (const other of bucket) {
          const dx = positions[other * 3] - x;
          const dy = positions[other * 3 + 1] - y;
          const dz = positions[other * 3 + 2] - z;
          if (dx * dx + dy * dy + dz * dz <= limit) out.push(other);
        }
      }
    }
  }
  return out;
}

function residueTemplate(residue) {
  if (residue.kind === 'water') return 'water';
  if (residue.kind === 'protein' && (residue.resName in AMINO_ACID_CODES || PROTONATION_VARIANTS.has(residue.resName))) return 'protein';
  if (residue.kind === 'nucleic' && residue.resName in NUCLEOTIDE_CODES && !MODIFIED_NUCLEOTIDES.has(residue.resName)) return 'nucleic';
  return 'generic';
}

function perceiveResidueRings(context, residue, residueIndex) {
  const template = residueTemplate(residue);
  let cycles = EMPTY;
  if (template === 'protein') cycles = tableCycles(context, residue, PROTEIN_RINGS[parentResidue(residue.resName)]);
  else if (template === 'nucleic') cycles = tableCycles(context, residue, BASE_RINGS[NUCLEOTIDE_CODES[residue.resName]]);
  else if (template === 'generic') cycles = smallCycles(context, residue);
  for (const atoms of cycles) {
    const geometry = ringGeometry(context, atoms);
    // The dictionary's aromatic flags follow the MDL model, which leaves out lactam rings
    // (pyridones, olaparib's phthalazinone) and half of a porphyrin's pyrroles; planar rings of
    // sp2 atoms count too, as in PLIP (Open Babel perception).
    const dictionary = atoms.every((index, position) => typedBond(context, index, atoms[(position + 1) % atoms.length])?.aromatic);
    const aromatic = template !== 'generic' || dictionary || (
      geometry.deviation <= RING_PLANARITY_MAX && atoms.every((index) => isTrigonalRingAtom(context, residue, index))
    );
    context.rings.push({
      id: context.rings.length,
      atoms,
      centroid: geometry.centroid,
      normal: geometry.normal,
      aromatic,
      residue: residueIndex,
    });
    if (!aromatic) continue;
    for (const index of atoms) context.aromatic[index] |= atoms.length === 6 ? 2 : 1;
    if (template === 'generic') classifyRingNitrogens(context, atoms);
  }
}

function isTrigonalRingAtom(context, residue, index) {
  const degree = heavyDegree(context, index);
  if (degree > 3) return false;
  if (residue.hasHydrogens && context.elements[index] === 'C' && degree + (context.hydrogens[index]?.length ?? 0) > 3) return false;
  return degree < 3 || isPlanarCenter(context, index);
}

// Electron counting for aromatic rings: a five-membered ring needs one lone-pair donor (O, S, N–R or N–H) and
// every exocyclic C=O (pyridone/uracil tautomers) needs one more. Two-connected nitrogens take the missing N–H
// (preferring those next to the carbonyl); when that is ambiguous they stay donor+acceptor.
function classifyRingNitrogens(context, atoms) {
  const { elements } = context;
  const nitrogens = atoms.filter((index) => elements[index] === 'N' && heavyDegree(context, index) === 2);
  if (!nitrogens.length) return;
  if (nitrogens.every((index) => context.typed[index])) {
    // With the hydrogens known, N–H is pyrrole-like (donor) and bare N pyridine-like (acceptor).
    for (const index of nitrogens) context.ringNitrogen[index] = hydrogensOf(context, index) ? PYRROLE_TYPE : PYRIDINE_TYPE;
    return;
  }
  const carbonyls = atoms.filter((index) => elements[index] === 'C' && hasDoubleBondedChalcogen(context, index));
  const donors = atoms.filter((index) => (
    (elements[index] !== 'C' && elements[index] !== 'N') || (elements[index] === 'N' && heavyDegree(context, index) === 3)
  )).length;
  const needed = (atoms.length === 5 ? 1 : 0) + carbonyls.length - donors;
  const nextToCarbonyl = nitrogens.filter((index) => context.neighbors[index].some((neighbor) => carbonyls.includes(neighbor)));
  const candidates = nextToCarbonyl.length ? nextToCarbonyl : nitrogens;
  for (const index of nitrogens) {
    let type = PYRIDINE_TYPE;
    if (needed > 0 && candidates.includes(index)) type = candidates.length <= needed ? PYRROLE_TYPE : TAUTOMERIC_TYPE;
    context.ringNitrogen[index] = type;
  }
}

function hasDoubleBondedChalcogen(context, carbon) {
  return (context.neighbors[carbon] ?? EMPTY).some((neighbor) => {
    if (heavyDegree(context, neighbor) !== 1) return false;
    const element = context.elements[neighbor];
    const bond = typedBond(context, carbon, neighbor);
    if (bond) return (element === 'O' || element === 'S') && bond.order === 2;
    const length = atomDistance(context, carbon, neighbor);
    return (element === 'O' && length < CARBONYL_MAX) || (element === 'S' && length < THIOCARBONYL_MAX);
  });
}

function tableCycles(context, residue, table) {
  const cycles = [];
  for (const names of table ?? EMPTY) {
    const atoms = names.map((name) => findAtom(context, residue, name));
    if (atoms.every((index) => index >= 0)) cycles.push(atoms);
  }
  return cycles;
}

function smallCycles(context, residue) {
  const members = residue.atoms.filter((index) => !(context.flags[index] & (HYDROGEN | METAL)));
  if (members.length < 5) return EMPTY;
  const search = { context, members: new Set(members), path: [], cycles: [], seen: new Set() };
  for (const start of members) {
    search.path.length = 0;
    search.path.push(start);
    extendCycle(search, start, start);
  }
  return search.cycles;
}

function extendCycle(search, start, current) {
  const { path } = search;
  for (const next of search.context.neighbors[current] ?? EMPTY) {
    if (next === start && path.length >= 5) {
      const key = path.slice().sort((a, b) => a - b).join(',');
      if (!search.seen.has(key)) {
        search.seen.add(key);
        search.cycles.push(path.slice());
      }
    } else if (next > start && path.length < 6 && search.members.has(next) && !path.includes(next)) {
      path.push(next);
      extendCycle(search, start, next);
      path.pop();
    }
  }
}

function ringGeometry(context, atoms) {
  const p = context.positions;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const index of atoms) {
    cx += p[index * 3];
    cy += p[index * 3 + 1];
    cz += p[index * 3 + 2];
  }
  cx /= atoms.length;
  cy /= atoms.length;
  cz /= atoms.length;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let k = 0; k < atoms.length; k += 1) {
    const a = atoms[k] * 3;
    const b = atoms[(k + 1) % atoms.length] * 3;
    const ax = p[a] - cx;
    const ay = p[a + 1] - cy;
    const az = p[a + 2] - cz;
    const bx = p[b] - cx;
    const by = p[b + 1] - cy;
    const bz = p[b + 2] - cz;
    nx += ay * bz - az * by;
    ny += az * bx - ax * bz;
    nz += ax * by - ay * bx;
  }
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
  let deviation = 0;
  for (const index of atoms) {
    const height = (p[index * 3] - cx) * nx + (p[index * 3 + 1] - cy) * ny + (p[index * 3 + 2] - cz) * nz;
    deviation = Math.max(deviation, Math.abs(height));
  }
  return { centroid: [cx, cy, cz], normal: [nx, ny, nz], deviation };
}

function perceiveResidueChemistry(context, residue, residueIndex, isChainStart) {
  const template = residueTemplate(residue);
  if (template === 'water') {
    for (const index of residue.atoms) {
      if (!(context.flags[index] & WATER)) continue;
      context.flags[index] |= POLAR;
      context.capacity[index] = 2;
    }
    return;
  }
  let groups;
  if (template === 'protein') groups = proteinChargeGroups(context, residue, residueIndex, isChainStart);
  else if (template === 'nucleic') groups = nucleicChargeGroups(context, residue, residueIndex);
  else groups = genericChargeGroups(context, residue, residueIndex);
  if (residue.hasHydrogens) groups = groups.filter((group) => chargeMatchesHydrogens(context, group));

  for (const index of residue.atoms) {
    if (!(context.flags[index] & (HYDROGEN | METAL))) assignRoles(context, residue, template, index);
  }
  for (const group of groups) {
    // A nitrogen that coordinates a metal cannot also carry the proton that makes the group cationic.
    if (group.sign > 0 && group.atoms.some((index) => context.metalLinks[index])) continue;
    applyChargeRoles(context, group);
    group.id = context.charges.length;
    context.charges.push(group);
  }
  for (const index of residue.atoms) {
    const element = context.elements[index];
    if (context.flags[index] & (HYDROGEN | METAL) || !LIGATING_ELEMENTS.has(element)) continue;
    if (residue.hasHydrogens) applyExplicitHydrogens(context, index, element);
    if (context.metalLinks[index] && element !== 'O') context.flags[index] &= ~POLAR;
    const degree = heavyDegree(context, index);
    if (degree && !context.metalLinks[index] && (context.flags[index] & ACCEPTOR || (element === 'S' && degree <= 2))) {
      context.flags[index] |= HALOGEN_ACCEPTOR;
    }
  }
}

function assignRoles(context, residue, template, index) {
  const element = context.elements[index];
  const neighbors = context.neighbors[index] ?? EMPTY;
  let role;
  if (template === 'protein') role = proteinRole(context, residue, index);
  else if (template === 'nucleic') role = nucleicRole(context, residue, index);
  else role = genericRole(context, index);
  if (element === 'C' && neighbors.every((neighbor) => context.elements[neighbor] === 'C')) role |= HYDROPHOBIC;
  if (HALOGEN_BOND_DONORS.has(element) && neighbors.length === 1 && context.elements[neighbors[0]] === 'C') role |= HALOGEN_DONOR;
  context.flags[index] |= role;
  if (role & DONOR) context.capacity[index] = element === 'N' ? Math.max(1, 3 - neighbors.length) : 1;
}

function proteinRole(context, residue, index) {
  const name = context.names[index];
  const parent = parentResidue(residue.resName);
  if (name === 'N') return parent === 'PRO' ? 0 : DONOR;
  if (name === 'O' || name === 'OXT') return ACCEPTOR;
  return SIDECHAIN_ROLES[parent]?.[name] ?? 0;
}

function nucleicRole(context, residue, index) {
  const name = context.names[index];
  const backbone = NUCLEIC_BACKBONE_ROLES[name];
  if (backbone !== undefined) {
    return (name === "O3'" || name === "O5'") && heavyDegree(context, index) === 1 ? POLAR : backbone;
  }
  return BASE_ROLES[NUCLEOTIDE_CODES[residue.resName]]?.[name] ?? 0;
}

// Ligands and non-standard residues: from their chemistry when it is known, otherwise from the
// element and the heavy-atom geometry.
function genericRole(context, index) {
  if (context.typed[index]) return typedRole(context, index);
  const element = context.elements[index];
  const neighbors = context.neighbors[index] ?? EMPTY;
  const degree = neighbors.length;
  if (element === 'N') {
    if (degree === 3) return isPlanarCenter(context, index) ? 0 : ACCEPTOR;
    if (degree > 3) return 0;
    if (degree === 1 && atomDistance(context, index, neighbors[0]) < 1.2) return ACCEPTOR;
    if (context.ringNitrogen[index] === PYRIDINE_TYPE) return ACCEPTOR;
    if (context.ringNitrogen[index] === PYRROLE_TYPE) return DONOR;
    if (context.aromatic[index]) return POLAR;
    if (neighbors.some((neighbor) => isAcylLike(context, neighbor))) return DONOR;
    if (degree === 2 && neighbors.some((neighbor) => atomDistance(context, index, neighbor) < 1.31)) return ACCEPTOR;
    // Aniline/enamine N–H: the lone pair is conjugated into the unsaturated neighbour.
    if (neighbors.some((neighbor) => isUnsaturated(context, neighbor))) return DONOR;
    return POLAR;
  }
  if (element === 'O') {
    if (degree === 0) return POLAR;
    if (degree === 2) return ACCEPTOR;
    if (degree > 2) return 0;
    const partner = context.elements[neighbors[0]];
    if (partner === 'S' || partner === 'N') return ACCEPTOR;
    if (partner === 'C' && atomDistance(context, index, neighbors[0]) < CARBONYL_MAX) return ACCEPTOR;
    return POLAR;
  }
  if (degree === 0 && HALIDES.has(element)) return ACCEPTOR;
  return 0;
}

// Donors carry hydrogens; acceptors are oxygens, and nitrogens whose lone pair is free (not an
// amide, sulfonamide, aniline or pyrrole nitrogen, not four-connected).
function typedRole(context, index) {
  const element = context.elements[index];
  const neighbors = context.neighbors[index] ?? EMPTY;
  const hydrogens = hydrogensOf(context, index);
  const donor = hydrogens > 0 ? DONOR : 0;
  if (element === 'N') {
    // A cationic nitrogen (ammonium, pyridinium, the N of a nitro group) has no lone pair.
    if (neighbors.length + hydrogens >= 4 || context.formalCharge[index] > 0) return donor;
    if (context.aromatic[index]) return context.ringNitrogen[index] === PYRROLE_TYPE || neighbors.length === 3 ? donor : ACCEPTOR | donor;
    if (hasMultipleBond(context, index)) return ACCEPTOR | donor;
    const conjugated = neighbors.some((neighbor) => isUnsaturated(context, neighbor) || isAcylLike(context, neighbor));
    return conjugated ? donor : ACCEPTOR | donor;
  }
  if (element === 'O') return neighbors.length > 2 ? 0 : ACCEPTOR | donor;
  if (element === 'S') {
    if (hydrogens > 0) return DONOR;
    return neighbors.length === 1 && typedBond(context, index, neighbors[0])?.order === 2 ? ACCEPTOR : 0;
  }
  if (!neighbors.length && HALIDES.has(element)) return ACCEPTOR;
  return 0;
}

function applyChargeRoles(context, group) {
  if (group.histidine) return;
  for (const index of group.atoms) {
    if (group.sign < 0) {
      context.flags[index] = (context.flags[index] & ~DONOR) | ACCEPTOR;
    } else {
      // A quaternary ammonium, or a permanent cation without hydrogens (N-alkyl pyridinium), has
      // no hydrogen to donate; a protonated amine gains one.
      const donates = heavyDegree(context, index) < 4 && !(group.label === 'cation' && hydrogensOf(context, index) === 0);
      context.flags[index] = (context.flags[index] & ~(ACCEPTOR | DONOR)) | (donates ? DONOR : 0);
      context.capacity[index] = Math.max(1, (group.atoms.length === 1 ? 4 : 3) - heavyDegree(context, index));
    }
  }
}

function applyExplicitHydrogens(context, index, element) {
  const hydrogenCount = context.hydrogens[index]?.length ?? 0;
  let flags = context.flags[index] & ~DONOR;
  if (hydrogenCount) flags |= DONOR;
  if (hydrogenCount && element === 'N') flags &= ~ACCEPTOR;
  context.flags[index] = flags;
  context.capacity[index] = hydrogenCount;
}

function proteinChargeGroups(context, residue, residueIndex, isChainStart) {
  const groups = [];
  const parent = parentResidue(residue.resName);
  const sidechain = CHARGED_SIDECHAINS[parent];
  if (sidechain && !NEUTRAL_VARIANTS.has(residue.resName)) {
    const atoms = sidechain.atoms.map((name) => findAtom(context, residue, name));
    if (atoms.every((index) => index >= 0)) {
      const group = chargeGroup(context, atoms, sidechain.sign, residueIndex, sidechain.label);
      group.histidine = parent === 'HIS' && !CHARGED_HISTIDINES.has(residue.resName);
      groups.push(group);
    }
  }
  const nitrogen = findAtom(context, residue, 'N');
  const oxygen = findAtom(context, residue, 'O');
  const terminalOxygen = findAtom(context, residue, 'OXT');
  if (nitrogen >= 0 && (isChainStart || terminalOxygen >= 0 || context.atoms[nitrogen].isHet)) {
    const peptideBonded = (context.neighbors[nitrogen] ?? EMPTY).some((neighbor) => context.residueOf[neighbor] !== residueIndex);
    if (!peptideBonded) groups.push(chargeGroup(context, [nitrogen], 1, residueIndex, 'N-terminus'));
  }
  if (oxygen >= 0 && terminalOxygen >= 0) groups.push(chargeGroup(context, [oxygen, terminalOxygen], -1, residueIndex, 'C-terminus'));
  return groups;
}

function nucleicChargeGroups(context, residue, residueIndex) {
  const atoms = PHOSPHATE_OXYGENS.map((name) => findAtom(context, residue, name)).filter((index) => index >= 0);
  return atoms.length >= 2 ? [chargeGroup(context, atoms, -1, residueIndex, 'phosphate')] : [];
}

// Ionisable groups at pH ~7, following PLIP's ligand functional-group rules, plus amidines,
// tetrazoles and acylsulfonamides, permanent charges the chemistry records (N-alkyl pyridinium),
// and one protonated nitrogen per group of nearby amines (piperazine, ethylenediamine).
function genericChargeGroups(context, residue, residueIndex) {
  const groups = [];
  const amines = [];
  for (const index of residue.atoms) {
    if (context.flags[index] & (HYDROGEN | METAL)) continue;
    const element = context.elements[index];
    const neighbors = context.neighbors[index] ?? EMPTY;
    if (element === 'N') {
      if (isAcylSulfonamide(context, index)) {
        groups.push(chargeGroup(context, [index], -1, residueIndex, 'acylsulfonamide'));
        continue;
      }
      if (!isBasicAmine(context, index)) continue;
      const group = chargeGroup(context, [index], 1, residueIndex, neighbors.length === 4 ? 'ammonium' : 'amine');
      if (neighbors.length === 3) group.axis = planeNormal(context, neighbors);
      amines.push(group);
    } else if (element === 'C') {
      const oxygens = terminalOxygens(context, neighbors);
      // Two-connected carboxylates are formate (or a carboxylate whose C–C bond was not inferred); linear O=C=O is CO2.
      const carboxylate = oxygens.length >= 2 && (
        neighbors.length === 3 || (neighbors.length === 2 && angleAt(context, index, oxygens[0], oxygens[1]) < 150)
      );
      if (carboxylate) {
        groups.push(chargeGroup(context, oxygens, -1, residueIndex, 'carboxylate'));
        continue;
      }
      const nitrogens = amidiniumNitrogens(context, index);
      if (nitrogens) groups.push(chargeGroup(context, nitrogens, 1, residueIndex, nitrogens.length === 3 ? 'guanidinium' : 'amidinium'));
    } else if (element === 'P' || element === 'S') {
      const oxygens = terminalOxygens(context, neighbors);
      if (oxygens.length >= (element === 'P' ? 2 : 3)) {
        groups.push(chargeGroup(context, oxygens, -1, residueIndex, element === 'P' ? 'phosphate' : 'sulfonate'));
      }
    }
  }
  groups.push(...protonatedAmines(context, amines));
  for (const ring of context.rings) {
    if (ring.residue !== residueIndex || !ring.aromatic || ring.atoms.length !== 5) continue;
    const nitrogens = ring.atoms.filter((index) => context.elements[index] === 'N');
    // Only a tetrazole without an N-substituent (1H-tetrazole) is acidic.
    if (nitrogens.length === 4 && nitrogens.every((index) => heavyDegree(context, index) === 2)) groups.push(chargeGroup(context, nitrogens, -1, residueIndex, 'tetrazole'));
  }
  const grouped = new Set(groups.flatMap((group) => group.atoms));
  for (const index of residue.atoms) {
    if (grouped.has(index) || !context.typed[index]) continue;
    const charge = context.formalCharge[index];
    if (!charge || (context.neighbors[index] ?? EMPTY).some((neighbor) => Math.sign(context.formalCharge[neighbor]) === -Math.sign(charge))) continue;
    const element = context.elements[index];
    // Four-connected or aromatic nitrogen cations keep their charge at any pH; so do O⁻ and S⁻.
    const permanent = charge > 0 ? element === 'N' && (heavyDegree(context, index) === 4 || context.aromatic[index]) : element === 'O' || element === 'S';
    if (permanent) groups.push(chargeGroup(context, [index], Math.sign(charge), residueIndex, charge > 0 ? 'cation' : 'anion'));
  }
  return groups;
}

// Amines within three bonds of each other (piperazine, ethylenediamine) repel a second proton,
// so only the most basic one of such a group is charged: the one with the fewest α-carbons
// next to an unsaturated atom (a benzylic CH2 lowers the pKa by about one unit), then the first.
function protonatedAmines(context, amines) {
  if (amines.length < 2) return amines;
  const kept = [];
  const assigned = new Set();
  for (const amine of amines) {
    if (assigned.has(amine)) continue;
    const cluster = [amine];
    assigned.add(amine);
    for (let cursor = 0; cursor < cluster.length; cursor += 1) {
      for (const other of amines) {
        if (!assigned.has(other) && withinBonds(context, cluster[cursor].atoms[0], other.atoms[0], 3)) {
          assigned.add(other);
          cluster.push(other);
        }
      }
    }
    let best = cluster[0];
    for (const candidate of cluster) if (basicityPenalty(context, candidate.atoms[0]) < basicityPenalty(context, best.atoms[0])) best = candidate;
    kept.push(best);
  }
  return kept;
}

function basicityPenalty(context, nitrogen) {
  let penalty = 0;
  for (const carbon of context.neighbors[nitrogen] ?? EMPTY) {
    if ((context.neighbors[carbon] ?? EMPTY).some((neighbor) => neighbor !== nitrogen && isUnsaturated(context, neighbor))) penalty += 1;
  }
  return penalty;
}

// R–C(=O)–NH–SO2–R' is as acidic as a carboxylic acid (pKa about 4.5).
function isAcylSulfonamide(context, nitrogen) {
  const neighbors = context.neighbors[nitrogen] ?? EMPTY;
  if (neighbors.length !== 2) return false;
  const sulfonyl = neighbors.some((neighbor) => context.elements[neighbor] === 'S' && terminalOxygens(context, context.neighbors[neighbor] ?? EMPTY).length >= 2);
  const acyl = neighbors.some((neighbor) => context.elements[neighbor] === 'C' && hasDoubleBondedChalcogen(context, neighbor));
  return sulfonyl && acyl;
}

function chargeGroup(context, atoms, sign, residue, label) {
  return { id: -1, atoms, center: centroidOf(context, atoms), sign, residue, label, histidine: false, axis: null };
}

function chargeMatchesHydrogens(context, group) {
  if (group.sign < 0) {
    const protonated = group.atoms.filter((index) => context.hydrogens[index]?.length).length;
    return group.label === 'phosphate' || group.label === 'sulfonate' ? protonated < group.atoms.length : protonated === 0;
  }
  const saturated = group.atoms.length === 1 ? 4 : 3;
  return group.atoms.every((index) => heavyDegree(context, index) + (context.hydrogens[index]?.length ?? 0) >= saturated);
}

function isBasicAmine(context, index) {
  const neighbors = context.neighbors[index] ?? EMPTY;
  if (!neighbors.length || neighbors.length > 4 || context.aromatic[index]) return false;
  if (neighbors.length === 3 && isPlanarCenter(context, index)) return false;
  return neighbors.every((neighbor) => (
    context.elements[neighbor] === 'C' &&
    !isUnsaturated(context, neighbor) &&
    atomDistance(context, index, neighbor) > 1.41
  ));
}

function amidiniumNitrogens(context, carbon) {
  const neighbors = context.neighbors[carbon] ?? EMPTY;
  if (neighbors.length !== 3 || context.aromatic[carbon] || !isPlanarCenter(context, carbon)) return null;
  if (neighbors.some((neighbor) => context.elements[neighbor] !== 'N' && context.elements[neighbor] !== 'C')) return null;
  const nitrogens = neighbors.filter((neighbor) => context.elements[neighbor] === 'N');
  if (nitrogens.length < 2) return null;
  for (const nitrogen of nitrogens) {
    if (context.aromatic[nitrogen]) return null;
    for (const neighbor of context.neighbors[nitrogen]) {
      if (neighbor === carbon) continue;
      if (context.elements[neighbor] === 'O' || isAcylLike(context, neighbor)) return null;
    }
  }
  return nitrogens;
}

function isUnsaturated(context, index) {
  if (context.aromatic[index]) return true;
  if (context.typed[index]) return hasMultipleBond(context, index);
  const neighbors = context.neighbors[index] ?? EMPTY;
  const residue = context.residues[context.residueOf[index]];
  if (residue.hasHydrogens) return neighbors.length + (context.hydrogens[index]?.length ?? 0) < 4;
  if (neighbors.length === 3) return isPlanarCenter(context, index);
  if (neighbors.length === 2) return angleAt(context, index, neighbors[0], neighbors[1]) > 117;
  return false;
}

function isAcylLike(context, index) {
  const element = context.elements[index];
  if (element === 'C') return isPlanarCenter(context, index) && hasDoubleBondedChalcogen(context, index);
  if (element !== 'S' && element !== 'P') return false;
  return terminalOxygens(context, context.neighbors[index] ?? EMPTY).length > 0;
}

function isPlanarCenter(context, index) {
  const neighbors = context.neighbors[index] ?? EMPTY;
  if (neighbors.length !== 3) return false;
  if (context.typed[index]) {
    // sp2: a multiple bond, or a nitrogen conjugated with one (amide, aniline, enamine).
    return hasMultipleBond(context, index) || (context.elements[index] === 'N' && neighbors.some((neighbor) => hasMultipleBond(context, neighbor)));
  }
  const [a, b, c] = neighbors;
  return angleAt(context, index, a, b) + angleAt(context, index, a, c) + angleAt(context, index, b, c) > 350;
}

function terminalOxygens(context, neighbors) {
  return neighbors.filter((neighbor) => context.elements[neighbor] === 'O' && heavyDegree(context, neighbor) === 1);
}

function heavyDegree(context, index) {
  return context.neighbors[index]?.length ?? 0;
}

function findAtom(context, residue, name) {
  for (const index of residue.atoms) {
    if (context.names[index] === name && !(context.flags[index] & HYDROGEN)) return index;
  }
  return -1;
}

function createQuery(context, groupA, options) {
  const { count, flags } = context;
  const inA = new Uint8Array(count);
  const inB = new Uint8Array(count);
  const atomsA = [];
  for (const value of groupA ?? EMPTY) {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= count || inA[index]) continue;
    inA[index] = 1;
    if (!(flags[index] & HYDROGEN)) atomsA.push(index);
  }
  if (options.groupB) {
    for (const value of options.groupB) {
      const index = Number(value);
      if (Number.isInteger(index) && index >= 0 && index < count && !inA[index]) inB[index] = 1;
    }
  } else {
    for (let index = 0; index < count; index += 1) inB[index] = inA[index] ? 0 : 1;
  }
  const includeWater = options.includeWater === true;
  const wanted = new Set((options.types ?? [...TYPE_ORDER.keys()]).filter((id) => TYPE_ORDER.has(id)));
  if (!includeWater) wanted.delete('water-bridge');
  return { inA, inB, atomsA, includeWater, histidinePositive: options.histidinePositive !== false, wanted };
}

function indexMask(count, indices) {
  const mask = new Uint8Array(count);
  for (const value of indices) {
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < count) mask[index] = 1;
  }
  return mask;
}

function splitBySide(context, query, items, accept) {
  const sideA = [];
  const sideB = [];
  for (const item of items) {
    if (!accept(item)) continue;
    const side = sideOf(context, query, item.atoms);
    if (side === 1) sideA.push(item);
    else if (side === 2) sideB.push(item);
  }
  return [sideA, sideB];
}

function sideOf(context, query, atoms) {
  let side = 0;
  for (const index of atoms) {
    let current = 0;
    if (query.inA[index]) current = 1;
    else if (query.inB[index] && !(context.flags[index] & WATER)) current = 2;
    if (!current || (side && current !== side)) return 0;
    side = current;
  }
  return side;
}

function detectAtomPairs(context, query) {
  const { flags, elements, residueOf } = context;
  const { inB, wanted, includeWater } = query;
  const wantHydrogenBonds = wanted.has('hydrogen-bond');
  const wantHydrophobic = wanted.has('hydrophobic');
  const wantHalogenBonds = wanted.has('halogen-bond');
  const wantMetal = wanted.has('metal-coordination');
  const found = { hydrogenBonds: [], hydrophobic: [], halogenBonds: [], metalContacts: [] };
  const nearby = [];
  for (const a of query.atomsA) {
    const flagsA = flags[a];
    if (!(flagsA & PAIR_ROLES) && !LIGATING_ELEMENTS.has(elements[a])) continue;
    collectNearAtom(context, a, PAIR_SEARCH_RADIUS, nearby);
    for (const b of nearby) {
      const flagsB = flags[b];
      if (!inB[b] || flagsB & HYDROGEN) continue;
      const distance = atomDistance(context, a, b);
      if (distance <= MIN_DIST) continue;
      if ((flagsA | flagsB) & METAL) {
        if (!wantMetal || distance > METAL_DIST_MAX) continue;
        const metal = flagsA & METAL ? a : b;
        const ligand = metal === a ? b : a;
        if (flags[ligand] & METAL || !LIGATING_ELEMENTS.has(elements[ligand])) continue;
        if (ligand === b && flagsB & WATER && !includeWater) continue;
        found.metalContacts.push({ a, b, distance, metal, ligand });
        continue;
      }
      if (flagsB & WATER || residueOf[a] === residueOf[b]) continue;
      let separated;
      if (wantHydrophobic && flagsA & flagsB & HYDROPHOBIC && distance <= HYDROPH_DIST_MAX) {
        separated = !withinBonds(context, a, b, EXCLUDED_BOND_SEPARATION);
        if (separated) found.hydrophobic.push({ a, b, distance });
      }
      if (wantHydrogenBonds && (flagsA | flagsB) & POLAR) {
        const bond = hydrogenBondBetween(context, a, b, distance);
        if (bond && (separated ??= !withinBonds(context, a, b, EXCLUDED_BOND_SEPARATION))) found.hydrogenBonds.push(bond);
      }
      if (wantHalogenBonds && distance <= HALOGEN_DIST_MAX && (flagsA | flagsB) & HALOGEN_DONOR) {
        const bond = halogenBondBetween(context, a, b, distance);
        if (bond && (separated ??= !withinBonds(context, a, b, EXCLUDED_BOND_SEPARATION))) found.halogenBonds.push(bond);
      }
    }
  }
  return found;
}

function hydrogenBondBetween(context, a, b, distance) {
  const { flags } = context;
  const forward = flags[a] & DONOR && flags[b] & ACCEPTOR ? donorGeometry(context, a, b, distance) : null;
  const reverse = flags[b] & DONOR && flags[a] & ACCEPTOR ? donorGeometry(context, b, a, distance) : null;
  const best = !reverse || (forward && forward.score >= reverse.score) ? forward : reverse;
  return best ? { a, b, distance, ...best } : null;
}

function donorGeometry(context, donor, acceptor, distance) {
  const hydrogens = context.hydrogens[donor];
  if (hydrogens?.length) {
    if (distance > HBOND_DIST_MAX) return null;
    let best = null;
    for (const hydrogen of hydrogens) {
      const angle = angleAt(context, hydrogen, donor, acceptor);
      if (angle > HBOND_DON_ANGLE_MIN && (!best || angle > best.angle)) best = { donor, acceptor, hydrogen, angle, score: 180 + angle };
    }
    return best;
  }
  if (distance > HBOND_HEAVY_DIST_MAX) return null;
  const neighbors = context.neighbors[donor] ?? EMPTY;
  let donorAngle = 180;
  for (const neighbor of neighbors) donorAngle = Math.min(donorAngle, angleAt(context, donor, neighbor, acceptor));
  if (donorAngle < HBOND_HEAVY_ANGLE_MIN) return null;
  return { donor, acceptor, hydrogen: -1, donorAngle: neighbors.length ? donorAngle : null, score: donorAngle };
}

function halogenBondBetween(context, a, b, distance) {
  const { flags } = context;
  if (flags[a] & HALOGEN_DONOR && flags[b] & HALOGEN_ACCEPTOR) return halogenGeometry(context, a, b, a, b, distance);
  if (flags[b] & HALOGEN_DONOR && flags[a] & HALOGEN_ACCEPTOR) return halogenGeometry(context, a, b, b, a, distance);
  return null;
}

function halogenGeometry(context, a, b, halogen, acceptor, distance) {
  const donorAngle = angleAt(context, halogen, context.neighbors[halogen][0], acceptor);
  if (Math.abs(donorAngle - HALOGEN_DON_ANGLE) > HALOGEN_ANGLE_DEV) return null;
  let acceptorAngle = 180;
  for (const neighbor of context.neighbors[acceptor] ?? EMPTY) {
    const angle = angleAt(context, acceptor, halogen, neighbor);
    if (Math.abs(angle - HALOGEN_ACC_ANGLE) > HALOGEN_ANGLE_DEV) return null;
    acceptorAngle = Math.min(acceptorAngle, angle);
  }
  return { a, b, distance, halogen, acceptor, donorAngle, acceptorAngle };
}

function withinBonds(context, from, to, maxBonds) {
  const visited = new Set([from]);
  let frontier = [from];
  for (let depth = 0; depth < maxBonds && frontier.length; depth += 1) {
    const next = [];
    for (const atom of frontier) {
      for (const links of [context.neighbors[atom], context.metalLinks[atom]]) {
        for (const neighbor of links ?? EMPTY) {
          if (neighbor === to) return true;
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return false;
}

function detectStacking(ringsA, ringsB) {
  const contacts = [];
  for (const ringA of ringsA) {
    for (const ringB of ringsB) {
      if (ringA.residue === ringB.residue) continue;
      const distance = pointDistance(ringA.centroid, ringB.centroid);
      if (distance <= MIN_DIST || distance > PISTACK_DIST_MAX) continue;
      const offset = Math.min(planeOffset(ringB.centroid, ringA), planeOffset(ringA.centroid, ringB));
      if (offset > PISTACK_OFFSET_MAX) continue;
      const angle = axisAngle(ringA.normal, ringB.normal);
      let subtype = '';
      if (angle <= PISTACK_ANG_DEV) subtype = 'parallel';
      else if (angle >= 90 - PISTACK_ANG_DEV) subtype = 't-shaped';
      if (subtype) contacts.push({ ringA, ringB, distance, angle, offset, subtype });
    }
  }
  const closestPerRingA = keepClosest(contacts, (contact) => `${contact.ringA.id}:${contact.ringB.residue}`);
  return keepClosest(closestPerRingA, (contact) => `${contact.ringB.id}:${contact.ringA.residue}`);
}

function detectCationPi(chargesA, chargesB, ringsA, ringsB) {
  const contacts = [];
  collectCationPi(chargesA, ringsB, 'A', contacts);
  collectCationPi(chargesB, ringsA, 'B', contacts);
  return keepClosest(contacts, (contact) => `${contact.group.id}:${contact.ring.residue}`);
}

function collectCationPi(groups, rings, cationSide, contacts) {
  for (const group of groups) {
    if (group.sign < 0) continue;
    for (const ring of rings) {
      if (group.residue === ring.residue) continue;
      const distance = pointDistance(group.center, ring.centroid);
      if (distance <= MIN_DIST || distance > PICATION_DIST_MAX) continue;
      const offset = planeOffset(group.center, ring);
      if (offset > PISTACK_OFFSET_MAX) continue;
      // PLIP: a tertiary amine must point its N–H axis at the ring, not its substituents.
      if (group.axis && axisAngle(group.axis, ring.normal) > TERTIARY_AMINE_ANGLE_MAX) continue;
      contacts.push({ group, ring, cationSide, distance, offset });
    }
  }
}

function detectSaltBridges(context, chargesA, chargesB) {
  const bridges = [];
  for (const chargeA of chargesA) {
    for (const chargeB of chargesB) {
      if (chargeA.sign === chargeB.sign || chargeA.residue === chargeB.residue) continue;
      const distance = pointDistance(chargeA.center, chargeB.center);
      if (distance <= MIN_DIST || distance > SALTBRIDGE_DIST_MAX) continue;
      bridges.push({ chargeA, chargeB, distance, closest: closestPair(context, chargeA.atoms, chargeB.atoms) });
    }
  }
  return bridges;
}

function detectWaterBridges(context, query) {
  const { flags, residueOf } = context;
  const partnersByWater = new Map();
  const nearby = [];
  for (const a of query.atomsA) {
    if (!(flags[a] & POLAR) || flags[a] & WATER) continue;
    collectNearAtom(context, a, WATER_BRIDGE_MAXDIST, nearby);
    for (const water of nearby) {
      if (!(flags[water] & WATER) || query.inA[water]) continue;
      const distance = atomDistance(context, a, water);
      if (distance < WATER_BRIDGE_MINDIST) continue;
      const partners = partnersByWater.get(water);
      if (partners) partners.push({ atom: a, distance });
      else partnersByWater.set(water, [{ atom: a, distance }]);
    }
  }
  const bridges = [];
  for (const [water, partners] of partnersByWater) {
    collectNearAtom(context, water, WATER_BRIDGE_MAXDIST, nearby);
    for (const b of nearby) {
      if (!query.inB[b] || !(flags[b] & POLAR) || flags[b] & WATER) continue;
      const distanceB = atomDistance(context, water, b);
      if (distanceB < WATER_BRIDGE_MINDIST) continue;
      for (const partner of partners) {
        const a = partner.atom;
        if (residueOf[a] === residueOf[b] || withinBonds(context, a, b, EXCLUDED_BOND_SEPARATION)) continue;
        bridges.push({ a, b, water, distance: Math.max(partner.distance, distanceB), distanceA: partner.distance, distanceB });
      }
    }
  }
  // One water usually touches several polar atoms of the same two residues; keep the tightest bridge per
  // water and residue pair, then the best water per atom pair.
  const perWater = keepClosest(bridges, (bridge) => `${bridge.water}:${residueOf[bridge.a]}:${residueOf[bridge.b]}`);
  return keepClosest(perWater, (bridge) => `${bridge.a}:${bridge.b}`);
}

// PLIP: groups already in a salt bridge do not also report H-bonds, and each donor keeps only its best
// partners (PLIP keeps one per donor; here up to its hydrogen count).
function refineHydrogenBonds(context, bonds, saltBridges) {
  const ionicPairs = new Set();
  for (const bridge of saltBridges) {
    const positive = bridge.chargeA.sign > 0 ? bridge.chargeA : bridge.chargeB;
    const negative = positive === bridge.chargeA ? bridge.chargeB : bridge.chargeA;
    for (const donor of positive.atoms) {
      for (const acceptor of negative.atoms) ionicPairs.add(donor * context.count + acceptor);
    }
  }
  const bondsByDonor = new Map();
  for (const bond of bonds) {
    if (ionicPairs.has(bond.donor * context.count + bond.acceptor)) continue;
    const list = bondsByDonor.get(bond.donor);
    if (list) list.push(bond);
    else bondsByDonor.set(bond.donor, [bond]);
  }
  const kept = [];
  for (const [donor, list] of bondsByDonor) {
    list.sort((x, y) => (x.hydrogen >= 0 ? y.angle - x.angle : x.distance - y.distance));
    kept.push(...list.slice(0, Math.max(1, context.capacity[donor])));
  }
  return kept;
}

// PLIP's clutter rules: no hydrophobic contacts between stacked rings, one contact per atom and partner
// residue (both directions), then at most a few per residue pair.
function refineHydrophobic(context, contacts, stacking) {
  const { count, residueOf } = context;
  const stackedPairs = new Set();
  for (const contact of stacking) {
    for (const a of contact.ringA.atoms) {
      for (const b of contact.ringB.atoms) stackedPairs.add(a * count + b);
    }
  }
  let kept = contacts.filter((contact) => !stackedPairs.has(contact.a * count + contact.b));
  kept = keepClosest(kept, (contact) => `${contact.a}:${residueOf[contact.b]}`);
  kept = keepClosest(kept, (contact) => `${contact.b}:${residueOf[contact.a]}`);
  kept.sort((x, y) => x.distance - y.distance);
  const perResiduePair = new Map();
  return kept.filter((contact) => {
    const key = `${residueOf[contact.a]}:${residueOf[contact.b]}`;
    const used = perResiduePair.get(key) ?? 0;
    perResiduePair.set(key, used + 1);
    return used < HYDROPHOBIC_PER_RESIDUE_PAIR;
  });
}

function keepClosest(items, keyOf) {
  const best = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const current = best.get(key);
    if (!current || item.distance < current.distance) best.set(key, item);
  }
  return [...best.values()];
}

function coordinationNumber(context, metal) {
  let total = 0;
  for (const other of collectNearAtom(context, metal, METAL_DIST_MAX, [])) {
    if (other === metal || context.flags[other] & (HYDROGEN | METAL)) continue;
    if (LIGATING_ELEMENTS.has(context.elements[other])) total += 1;
  }
  return total;
}

function closestPair(context, atomsA, atomsB) {
  let best = { a: -1, b: -1, distance: Infinity };
  for (const a of atomsA) {
    for (const b of atomsB) {
      const distance = atomDistance(context, a, b);
      if (distance < best.distance) best = { a, b, distance };
    }
  }
  return best;
}

function hydrogenBondInteraction(context, bond) {
  const details = { donor: bond.donor, acceptor: bond.acceptor, hydrogen: bond.hydrogen };
  if (bond.hydrogen >= 0) details.angle = bond.angle;
  else if (bond.donorAngle !== null) details.donorAngle = bond.donorAngle;
  return atomInteraction(context, 'hydrogen-bond', bond, details);
}

function saltBridgeInteraction(context, { chargeA, chargeB, closest, distance }) {
  return makeInteraction(context, 'salt-bridge', groupEndpoint(chargeA), groupEndpoint(chargeB), distance, {
    atomsA: chargeA.atoms.slice(),
    atomsB: chargeB.atoms.slice(),
    chargeA: chargeA.sign > 0 ? 'positive' : 'negative',
    chargeB: chargeB.sign > 0 ? 'positive' : 'negative',
    groupA: chargeA.label,
    groupB: chargeB.label,
    closestAtoms: [closest.a, closest.b],
    closestDistance: closest.distance,
  });
}

function stackingInteraction(context, { ringA, ringB, distance, subtype, angle, offset }) {
  return makeInteraction(context, 'pi-stacking', ringEndpoint(ringA), ringEndpoint(ringB), distance, {
    subtype,
    angle,
    offset,
    atomsA: ringA.atoms.slice(),
    atomsB: ringB.atoms.slice(),
  });
}

function cationPiInteraction(context, { group, ring, cationSide, distance, offset }) {
  const cationOnA = cationSide === 'A';
  const cation = groupEndpoint(group);
  const center = ringEndpoint(ring);
  return makeInteraction(context, 'cation-pi', cationOnA ? cation : center, cationOnA ? center : cation, distance, {
    cation: cationSide,
    group: group.label,
    offset,
    atomsA: (cationOnA ? group.atoms : ring.atoms).slice(),
    atomsB: (cationOnA ? ring.atoms : group.atoms).slice(),
  });
}

function halogenBondInteraction(context, bond) {
  return atomInteraction(context, 'halogen-bond', bond, {
    halogen: bond.halogen,
    acceptor: bond.acceptor,
    donorAngle: bond.donorAngle,
    acceptorAngle: bond.acceptorAngle,
  });
}

function metalInteraction(context, contact) {
  return atomInteraction(context, 'metal-coordination', contact, {
    metal: contact.metal,
    ligand: contact.ligand,
    coordination: coordinationNumber(context, contact.metal),
  });
}

function waterBridgeInteraction(context, bridge) {
  return atomInteraction(context, 'water-bridge', bridge, {
    water: bridge.water,
    waterPoint: atomPoint(context, bridge.water),
    waterResidue: context.residues[context.residueOf[bridge.water]].key,
    distanceA: bridge.distanceA,
    distanceB: bridge.distanceB,
  });
}

function atomInteraction(context, type, pair, details) {
  return makeInteraction(context, type, atomEndpoint(context, pair.a), atomEndpoint(context, pair.b), pair.distance, details);
}

function makeInteraction(context, type, endpointA, endpointB, distance, details) {
  return {
    type,
    atomA: endpointA.atom,
    atomB: endpointB.atom,
    pointA: endpointA.point,
    pointB: endpointB.point,
    distance,
    residueA: context.residues[endpointA.residue].key,
    residueB: context.residues[endpointB.residue].key,
    details,
  };
}

function atomEndpoint(context, index) {
  return { atom: index, point: atomPoint(context, index), residue: context.residueOf[index] };
}

function groupEndpoint(group) {
  return { atom: group.atoms.length === 1 ? group.atoms[0] : -1, point: group.center.slice(), residue: group.residue };
}

function ringEndpoint(ring) {
  return { atom: -1, point: ring.centroid.slice(), residue: ring.residue };
}

function compareInteractions(a, b) {
  return TYPE_ORDER.get(a.type) - TYPE_ORDER.get(b.type) || a.distance - b.distance;
}

function chainSet(chains) {
  return new Set(typeof chains === 'string' ? [chains] : [...(chains ?? EMPTY)]);
}

function atomPoint(context, index) {
  const p = context.positions;
  return [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]];
}

function atomDistance(context, a, b) {
  const p = context.positions;
  return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
}

function pointDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function angleAt(context, center, first, second) {
  const p = context.positions;
  const ax = p[first * 3] - p[center * 3];
  const ay = p[first * 3 + 1] - p[center * 3 + 1];
  const az = p[first * 3 + 2] - p[center * 3 + 2];
  const bx = p[second * 3] - p[center * 3];
  const by = p[second * 3 + 1] - p[center * 3 + 1];
  const bz = p[second * 3 + 2] - p[center * 3 + 2];
  const scale = Math.sqrt((ax * ax + ay * ay + az * az) * (bx * bx + by * by + bz * bz));
  if (!scale) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / scale))) * DEGREES;
}

function axisAngle(u, v) {
  return Math.acos(Math.min(1, Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * DEGREES;
}

function planeOffset(point, ring) {
  const dx = point[0] - ring.centroid[0];
  const dy = point[1] - ring.centroid[1];
  const dz = point[2] - ring.centroid[2];
  const height = dx * ring.normal[0] + dy * ring.normal[1] + dz * ring.normal[2];
  return Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - height * height));
}

function centroidOf(context, atoms) {
  const center = [0, 0, 0];
  for (const index of atoms) {
    center[0] += context.positions[index * 3];
    center[1] += context.positions[index * 3 + 1];
    center[2] += context.positions[index * 3 + 2];
  }
  return center.map((value) => value / atoms.length);
}

function planeNormal(context, atoms) {
  const [a, b, c] = atoms.map((index) => atomPoint(context, index));
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const length = Math.hypot(...normal) || 1;
  return normal.map((value) => value / length);
}
