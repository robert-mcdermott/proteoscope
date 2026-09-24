import { METAL_ELEMENTS, residueKindFromName } from './residues.js';

export const COULOMBIC_RANGE = [-10, 10];

const COULOMB_CONSTANT = 332;
const DEFAULT_OFFSET = 1.4;
const DEFAULT_CUTOFF = 20;
const DEFAULT_MIN_DISTANCE = 1;
const PEPTIDE_BOND_LIMIT = 2;
const TERMINAL_OXYGEN_CHARGE = -0.5;
const PHOSPHATE_OXYGENS = ['OP1', 'OP2', 'OP3', 'O1P', 'O2P', 'O3P'];
const NUCLEIC_PHOSPHATE_OXYGENS = ['OP1', 'OP2', 'O1P', 'O2P'];
const TERMINAL_PHOSPHATE_OXYGENS = ['OP3', 'O3P'];

const ARGININE = { charge: 1, names: ['NE', 'NH1', 'NH2'] };
const LYSINE = { charge: 1, names: ['NZ'] };
const ASPARTATE = { charge: -1, names: ['OD1', 'OD2'] };
const GLUTAMATE = { charge: -1, names: ['OE1', 'OE2'] };
const PHOSPHO = { charge: -2, names: PHOSPHATE_OXYGENS };
const HISTIDINIUM = { charge: 1, names: ['ND1', 'NE2'] };

const SIDE_CHAIN_CHARGES = {
  ARG: ARGININE,
  DAR: ARGININE,
  LYS: LYSINE,
  DLY: LYSINE,
  MLZ: LYSINE,
  MLY: LYSINE,
  M3L: LYSINE,
  ASP: ASPARTATE,
  DAS: ASPARTATE,
  GLU: GLUTAMATE,
  DGL: GLUTAMATE,
  CGU: { charge: -2, names: ['OE11', 'OE12', 'OE21', 'OE22'] },
  HIP: HISTIDINIUM,
  HSP: HISTIDINIUM,
  CYM: { charge: -1, names: ['SG'] },
  SEP: PHOSPHO,
  TPO: PHOSPHO,
  PTR: PHOSPHO,
};

const OXYANION_CHARGES = { SO4: -2, PO4: -3 };

const ION_CHARGES = {
  LI: 1, NA: 1, K: 1, RB: 1, CS: 1, AG: 1, TL: 1,
  MG: 2, CA: 2, ZN: 2, MN: 2, FE: 2, CO: 2, NI: 2, CU: 2, CD: 2, HG: 2, SR: 2, BA: 2,
  AL: 3, GA: 3, Y: 3, LA: 3, CE: 3, SM: 3, EU: 3, GD: 3, TB: 3, YB: 3, LU: 3,
  F: -1, CL: -1, BR: -1, I: -1,
};

const ION_RESIDUE_CHARGES = { CU1: 1, MN3: 3, '3CO': 3, '3NI': 3 };

export function assignCharges(atoms, residues) {
  const charges = new Float32Array(atoms.length);
  const indexOf = atomIndexLookup(atoms);
  const residueList = residues ?? groupResidues(atoms);

  const chains = new Map();
  for (const residue of residueList) {
    const heavy = residue.atoms.filter((atom) => !atom.isHydrogen);
    const name = String(residue.resName ?? heavy[0]?.resName ?? '').trim().toUpperCase();
    const kind = residue.kind ?? heavy[0]?.kind ?? residueKindFromName(name);

    const sideChain = SIDE_CHAIN_CHARGES[name];
    if (sideChain) spreadCharge(charges, indexOf, heavy, sideChain.names, sideChain.charge);

    if (kind === 'nucleic') {
      const terminalPhosphate = heavy.some((atom) => TERMINAL_PHOSPHATE_OXYGENS.includes(atom.name));
      if (terminalPhosphate) spreadCharge(charges, indexOf, heavy, PHOSPHATE_OXYGENS, -2);
      else spreadCharge(charges, indexOf, heavy, NUCLEIC_PHOSPHATE_OXYGENS, -1);
    }

    if (name in OXYANION_CHARGES) {
      const oxygens = heavy.filter((atom) => atom.element === 'O');
      spreadCharge(charges, indexOf, oxygens, null, OXYANION_CHARGES[name]);
    }

    if (kind === 'ion' || (kind === 'ligand' && heavy.length === 1)) {
      for (const atom of heavy) {
        const index = indexOf(atom);
        if (index >= 0) charges[index] += ionCharge(name, atom.element);
      }
    }

    if (kind === 'protein') {
      const chain = residue.chain ?? heavy[0]?.chain ?? '';
      if (!chains.has(chain)) chains.set(chain, []);
      chains.get(chain).push(residue);
    }
  }

  for (const [chain, proteinResidues] of chains) {
    const chainResidues = residueList.filter((residue) => (residue.chain ?? residue.atoms[0]?.chain ?? '') === chain);
    const first = proteinResidues[0];
    const last = proteinResidues[proteinResidues.length - 1];
    const firstN = namedAtoms(first, ['N']);
    if (firstN.length && !bondedToAny(firstN, chainResidues, first, 'C')) {
      spreadCharge(charges, indexOf, firstN, null, 1);
    }
    const lastC = namedAtoms(last, ['C']);
    if (lastC.length && !bondedToAny(lastC, chainResidues, last, 'N')) {
      for (const oxygen of namedAtoms(last, ['O', 'OXT'])) {
        const index = indexOf(oxygen);
        if (index >= 0) charges[index] += TERMINAL_OXYGEN_CHARGE;
      }
    }
  }
  return charges;
}

export function coulombicPotential(points, normals, atomPositions, charges, options = {}) {
  const offset = Number.isFinite(options.offset) ? options.offset : DEFAULT_OFFSET;
  const cutoff = Number.isFinite(options.cutoff) ? Math.max(0, options.cutoff) : DEFAULT_CUTOFF;
  const minDistance = Number.isFinite(options.minDistance) ? Math.max(1e-3, options.minDistance) : DEFAULT_MIN_DISTANCE;
  const pointCount = Math.floor(points.length / 3);
  const potential = new Float32Array(pointCount);
  const grid = binCharges(atomPositions, charges, Math.max(1, cutoff / 2));
  if (!grid || pointCount === 0 || cutoff === 0) return potential;

  const { minX, minY, minZ, size, dimX, dimY, dimZ, cellStart, packed } = grid;
  const span = Math.ceil(cutoff / size);
  const cutoff2 = cutoff * cutoff;
  const minDistance2 = minDistance * minDistance;
  const scale = COULOMB_CONSTANT / 4;
  const shift = normals ? offset : 0;

  for (let point = 0; point < pointCount; point += 1) {
    const x = points[point * 3] + (normals ? normals[point * 3] * shift : 0);
    const y = points[point * 3 + 1] + (normals ? normals[point * 3 + 1] * shift : 0);
    const z = points[point * 3 + 2] + (normals ? normals[point * 3 + 2] * shift : 0);
    const cellX = Math.floor((x - minX) / size);
    const cellY = Math.floor((y - minY) / size);
    const cellZ = Math.floor((z - minZ) / size);
    let sum = 0;
    for (let iz = Math.max(0, cellZ - span); iz <= Math.min(dimZ - 1, cellZ + span); iz += 1) {
      for (let iy = Math.max(0, cellY - span); iy <= Math.min(dimY - 1, cellY + span); iy += 1) {
        const row = dimX * (iy + dimY * iz);
        const x0 = Math.max(0, cellX - span);
        const x1 = Math.min(dimX - 1, cellX + span);
        if (x1 < x0) continue;
        const end = cellStart[row + x1 + 1];
        for (let slot = cellStart[row + x0]; slot < end; slot += 1) {
          const dx = packed[slot * 4] - x;
          const dy = packed[slot * 4 + 1] - y;
          const dz = packed[slot * 4 + 2] - z;
          const distance2 = dx * dx + dy * dy + dz * dz;
          if (distance2 >= cutoff2) continue;
          sum += packed[slot * 4 + 3] / (distance2 > minDistance2 ? distance2 : minDistance2);
        }
      }
    }
    potential[point] = scale * sum;
  }
  return potential;
}

function atomIndexLookup(atoms) {
  const byAtom = new Map();
  const byId = new Map();
  atoms.forEach((atom, index) => {
    byAtom.set(atom, index);
    if (atom.id !== undefined && !byId.has(atom.id)) byId.set(atom.id, index);
  });
  return (atom) => byAtom.get(atom) ?? byId.get(atom.id) ?? -1;
}

function groupResidues(atoms) {
  const residues = new Map();
  for (const atom of atoms) {
    const key = atom.residueKey ?? `${atom.chain}:${atom.resSeq}${atom.iCode ?? ''}:${atom.resName}`;
    if (!residues.has(key)) {
      residues.set(key, {
        key,
        chain: atom.chain,
        resName: atom.resName,
        resSeq: atom.resSeq,
        iCode: atom.iCode,
        kind: atom.kind,
        atoms: [],
      });
    }
    residues.get(key).atoms.push(atom);
  }
  return [...residues.values()];
}

function namedAtoms(residue, names) {
  return residue.atoms.filter((atom) => !atom.isHydrogen && names.includes(atom.name));
}

// Splits a formal charge evenly over the atoms that are present, so truncated side chains
// and alternate conformers keep the group's total charge.
function spreadCharge(charges, indexOf, atoms, names, total) {
  const targets = names ? atoms.filter((atom) => names.includes(atom.name)) : atoms;
  const indices = targets.map(indexOf).filter((index) => index >= 0);
  if (!indices.length) return;
  const share = total / indices.length;
  for (const index of indices) charges[index] += share;
}

function bondedToAny(ends, residues, self, partnerName) {
  const limit2 = PEPTIDE_BOND_LIMIT * PEPTIDE_BOND_LIMIT;
  for (const residue of residues) {
    if (residue === self) continue;
    for (const partner of residue.atoms) {
      if (partner.name !== partnerName) continue;
      for (const end of ends) {
        const dx = partner.x - end.x;
        const dy = partner.y - end.y;
        const dz = partner.z - end.z;
        if (dx * dx + dy * dy + dz * dz <= limit2) return true;
      }
    }
  }
  return false;
}

function ionCharge(resName, element) {
  if (resName in ION_RESIDUE_CHARGES) return ION_RESIDUE_CHARGES[resName];
  const symbol = String(element || resName || '').toUpperCase();
  if (symbol in ION_CHARGES) return ION_CHARGES[symbol];
  return METAL_ELEMENTS.has(symbol) ? 2 : 0;
}

function binCharges(positions, charges, cellSize) {
  let count = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let atom = 0; atom < charges.length; atom += 1) {
    if (!isChargedAtom(positions, charges, atom)) continue;
    minX = Math.min(minX, positions[atom * 3]);
    minY = Math.min(minY, positions[atom * 3 + 1]);
    minZ = Math.min(minZ, positions[atom * 3 + 2]);
    maxX = Math.max(maxX, positions[atom * 3]);
    maxY = Math.max(maxY, positions[atom * 3 + 1]);
    maxZ = Math.max(maxZ, positions[atom * 3 + 2]);
    count += 1;
  }
  if (count === 0) return null;

  let size = cellSize;
  let dimX = Math.floor((maxX - minX) / size) + 1;
  let dimY = Math.floor((maxY - minY) / size) + 1;
  let dimZ = Math.floor((maxZ - minZ) / size) + 1;
  while (dimX * dimY * dimZ > Math.max(4096, count * 8)) {
    size *= 1.25;
    dimX = Math.floor((maxX - minX) / size) + 1;
    dimY = Math.floor((maxY - minY) / size) + 1;
    dimZ = Math.floor((maxZ - minZ) / size) + 1;
  }
  const cellCount = dimX * dimY * dimZ;
  const cellOf = new Int32Array(charges.length).fill(-1);
  const cellStart = new Int32Array(cellCount + 1);
  for (let atom = 0; atom < charges.length; atom += 1) {
    if (!isChargedAtom(positions, charges, atom)) continue;
    const cell = Math.min(dimX - 1, Math.floor((positions[atom * 3] - minX) / size))
      + dimX * (Math.min(dimY - 1, Math.floor((positions[atom * 3 + 1] - minY) / size))
      + dimY * Math.min(dimZ - 1, Math.floor((positions[atom * 3 + 2] - minZ) / size)));
    cellOf[atom] = cell;
    cellStart[cell + 1] += 1;
  }
  for (let cell = 0; cell < cellCount; cell += 1) cellStart[cell + 1] += cellStart[cell];
  const cursor = cellStart.slice(0, cellCount);
  const packed = new Float64Array(count * 4);
  for (let atom = 0; atom < charges.length; atom += 1) {
    const cell = cellOf[atom];
    if (cell < 0) continue;
    const slot = cursor[cell];
    cursor[cell] += 1;
    packed[slot * 4] = positions[atom * 3];
    packed[slot * 4 + 1] = positions[atom * 3 + 1];
    packed[slot * 4 + 2] = positions[atom * 3 + 2];
    packed[slot * 4 + 3] = charges[atom];
  }
  return { minX, minY, minZ, size, dimX, dimY, dimZ, cellStart, packed };
}

function isChargedAtom(positions, charges, atom) {
  return charges[atom] !== 0
    && Number.isFinite(charges[atom])
    && Number.isFinite(positions[atom * 3])
    && Number.isFinite(positions[atom * 3 + 1])
    && Number.isFinite(positions[atom * 3 + 2]);
}
