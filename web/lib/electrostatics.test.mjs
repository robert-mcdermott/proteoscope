import assert from 'node:assert/strict';
import test from 'node:test';
import { examplePDB } from './test-data.mjs';
import { assignCharges, coulombicPotential, COULOMBIC_RANGE } from './electrostatics.js';
import { buildSurface } from './surface.js';
import { residueKindFromName } from './residues.js';

const SIDE_CHAINS = {
  LYS: ['CB', 'CG', 'CD', 'CE', 'NZ'],
  ASP: ['CB', 'CG', 'OD1', 'OD2'],
  GLU: ['CB', 'CG', 'CD', 'OE1', 'OE2'],
  ARG: ['CB', 'CG', 'CD', 'NE', 'CZ', 'NH1', 'NH2'],
  HIS: ['CB', 'CG', 'ND1', 'CD2', 'CE1', 'NE2'],
  SEP: ['CB', 'OG', 'P', 'O1P', 'O2P', 'O3P'],
  GLY: [],
};

test('K-D-E-R peptide carries formal charges on side chains and both termini', () => {
  const { atoms, residues } = buildModel([chainSpec('A', ['LYS', 'ASP', 'GLU', 'ARG'])]);
  const charges = assignCharges(atoms, residues);
  const charge = chargeReader(atoms, charges);

  assert.equal(charges.length, atoms.length);
  assertClose(charge('A', 1, 'N'), 1);
  assertClose(charge('A', 1, 'NZ'), 1);
  assertClose(charge('A', 2, 'OD1'), -0.5);
  assertClose(charge('A', 2, 'OD2'), -0.5);
  assertClose(charge('A', 3, 'OE1'), -0.5);
  assertClose(charge('A', 3, 'OE2'), -0.5);
  for (const name of ['NE', 'NH1', 'NH2']) assertClose(charge('A', 4, name), 1 / 3);
  assertClose(charge('A', 4, 'O'), -0.5);
  assertClose(charge('A', 4, 'OXT'), -0.5);
  for (const name of ['N', 'C', 'O']) {
    for (const resSeq of [2, 3]) assertClose(charge('A', resSeq, name), 0);
  }
  assertClose(charge('A', 4, 'N'), 0);
  assertClose(charge('A', 1, 'O'), 0);
  assertClose(sum(charges), 0);
  assertClose(sum(charges.filter((value) => value > 0)), 3);
  assert.equal(charges.filter((value) => value !== 0).length, 11);
});

test('only real termini are charged: caps, chain breaks and multiple chains', () => {
  const { atoms, residues } = buildModel([
    chainSpec('A', ['GLY', 'HIS', 'GLY'], { capStart: true, capEnd: true }),
    chainSpec('B', ['GLY', 'GLY', 'GLY', 'GLY'], { breakAfter: 2 }),
  ]);
  const charges = assignCharges(atoms, residues);
  const charge = chargeReader(atoms, charges);

  assertClose(charge('A', 1, 'N'), 0);
  assertClose(charge('A', 3, 'O'), 0);
  assertClose(charge('A', 4, 'N'), 0);
  assertClose(sum(charges.filter((_, index) => atoms[index].chain === 'A')), 0);
  assert.ok(charges.every((value, index) => atoms[index].resName !== 'HIS' || value === 0), 'His is neutral');

  assertClose(charge('B', 1, 'N'), 1);
  assertClose(charge('B', 2, 'O'), 0);
  assertClose(charge('B', 13, 'N'), 0);
  assertClose(charge('B', 14, 'O'), -0.5);
  assertClose(charge('B', 14, 'OXT'), -0.5);
});

test('ions, oxyanions, phosphoserine and nucleic-acid phosphates', () => {
  const { atoms, residues } = buildModel([chainSpec('A', ['GLY', 'SEP', 'GLY'])]);
  const extra = [
    singleAtomResidue('B', 201, 'NA', 'NA', 'NA'),
    singleAtomResidue('B', 202, 'MG', 'MG', 'MG'),
    singleAtomResidue('B', 203, 'ZN', 'ZN', 'ZN'),
    singleAtomResidue('B', 204, 'CL', 'CL', 'CL'),
    singleAtomResidue('B', 205, 'IOD', 'I', 'I'),
    singleAtomResidue('B', 206, 'HOH', 'O', 'O'),
    residue('B', 301, 'SO4', [['S', 'S'], ['O1', 'O'], ['O2', 'O'], ['O3', 'O'], ['O4', 'O']]),
    residue('B', 302, 'PO4', [['P', 'P'], ['O1', 'O'], ['O2', 'O'], ['O3', 'O'], ['O4', 'O']]),
    residue('C', 1, 'DA', [["O5'", 'O'], ["C5'", 'C'], ["C1'", 'C'], ['N9', 'N']]),
    residue('C', 2, 'DG', [['P', 'P'], ['OP1', 'O'], ['OP2', 'O'], ["O5'", 'O'], ["C1'", 'C']]),
    residue('C', 3, 'DC', [['P', 'P'], ['O1P', 'O'], ['O2P', 'O'], ["O5'", 'O'], ["C1'", 'C']]),
  ];
  for (const item of extra) {
    residues.push(item);
    for (const atom of item.atoms) {
      atom.id = atoms.length;
      atoms.push(atom);
    }
  }
  const charges = assignCharges(atoms, residues);
  const charge = chargeReader(atoms, charges);

  for (const name of ['O1P', 'O2P', 'O3P']) assertClose(charge('A', 2, name), -2 / 3);
  assertClose(charge('A', 2, 'OG'), 0);
  assertClose(charge('B', 201, 'NA'), 1);
  assertClose(charge('B', 202, 'MG'), 2);
  assertClose(charge('B', 203, 'ZN'), 2);
  assertClose(charge('B', 204, 'CL'), -1);
  assertClose(charge('B', 205, 'I'), -1);
  assertClose(charge('B', 206, 'O'), 0);
  for (const name of ['O1', 'O2', 'O3', 'O4']) {
    assertClose(charge('B', 301, name), -0.5);
    assertClose(charge('B', 302, name), -0.75);
  }
  assertClose(charge('B', 301, 'S'), 0);
  assertClose(charge('C', 2, 'OP1'), -0.5);
  assertClose(charge('C', 2, 'OP2'), -0.5);
  assertClose(charge('C', 3, 'O1P'), -0.5);
  assertClose(charge('C', 3, 'O2P'), -0.5);
  assertClose(sum(charges.filter((_, index) => atoms[index].chain === 'C')), -2);
  assertClose(sum(charges), (1 - 2 - 1) + (1 + 2 + 2 - 1 - 1) + (-2 - 3) + -2);
});

test('assignCharges accepts atoms without residues and residues from structured clones', () => {
  const { atoms, residues } = buildModel([chainSpec('A', ['LYS', 'GLU'])]);
  const fromAtoms = assignCharges(atoms);
  const cloned = structuredClone({ atoms, residues });
  const detached = assignCharges(cloned.atoms, structuredClone(residues));
  const expected = assignCharges(atoms, residues);
  assert.deepEqual([...fromAtoms], [...expected]);
  assert.deepEqual([...detached], [...expected]);
  assertClose(sum(expected), 0);
});

test('coulombicPotential: positive near a cation, 1/r^2 decay, offset, clamp and cutoff', () => {
  const atomPositions = new Float32Array([0, 0, 0]);
  const charges = new Float32Array([1]);
  const points = new Float32Array([3, 0, 0, 6, 0, 0, 0, 0.5, 0, 0, 0, 25]);
  const normals = new Float32Array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);

  const plain = coulombicPotential(points, normals, atomPositions, charges, { offset: 0 });
  assert.ok(plain[0] > 0 && plain[1] > 0);
  assertClose(plain[0], 332 / (4 * 9), 1e-4);
  assertClose(plain[0] / plain[1], 4, 1e-4);
  assertClose(plain[2], 332 / 4, 1e-4);
  assert.equal(plain[3], 0);

  const shifted = coulombicPotential(points, normals, atomPositions, charges);
  assertClose(shifted[0], 332 / (4 * 4.4 * 4.4), 1e-4);
  assertClose(shifted[1], 332 / (4 * 7.4 * 7.4), 1e-4);

  const inward = coulombicPotential(new Float32Array([3, 0, 0]), new Float32Array([-1, 0, 0]), atomPositions, charges);
  assertClose(inward[0], 332 / (4 * 1.6 * 1.6), 1e-4);

  const anion = coulombicPotential(points, null, atomPositions, new Float32Array([-1]));
  assertClose(anion[0], -332 / 36, 1e-4);

  const dipole = coulombicPotential(
    new Float32Array([0, 0, 0, 1.5, 0, 0]),
    null,
    new Float32Array([-2, 0, 0, 2, 0, 0]),
    new Float32Array([1, -1]),
  );
  assertClose(dipole[0], 0, 1e-6);
  assert.ok(dipole[1] < 0);

  assert.deepEqual(COULOMBIC_RANGE, [-10, 10]);
  assert.equal(coulombicPotential(points, normals, atomPositions, new Float32Array([0])).every((value) => value === 0), true);
});

test('1ycr: charges and surface potential are sensible', async (t) => {
  const { atoms, residues } = parseModel(examplePDB('1ycr'));
  const charges = assignCharges(atoms, residues);
  const charge = chargeReader(atoms, charges);
  const total = sum(charges);
  t.diagnostic(`1ycr: ${atoms.length} atoms, ${charges.filter((value) => value !== 0).length} charged, net charge ${total.toFixed(2)}`);
  assertClose(charge('A', 25, 'N'), 1);
  assertClose(charge('A', 109, 'O'), -0.5);
  assertClose(charge('B', 17, 'N'), 1);
  assertClose(charge('B', 29, 'O'), -0.5);
  assertClose(charge('B', 29, 'OXT'), -0.5);
  assertClose(total, 14 - 11 + (1 - 0.5) + (1 - 1), 1e-4);

  const positions = new Float32Array(atoms.flatMap((atom) => [atom.x, atom.y, atom.z]));
  const radii = new Float32Array(atoms.map((atom) => ({ C: 1.7, N: 1.55, O: 1.52, S: 1.8 })[atom.element] ?? 1.8));
  const surface = buildSurface(positions, radii);
  const start = performance.now();
  const potential = coulombicPotential(surface.positions, surface.normals, positions, charges);
  const elapsed = performance.now() - start;
  const low = potential.reduce((min, value) => Math.min(min, value), Infinity);
  const high = potential.reduce((max, value) => Math.max(max, value), -Infinity);
  t.diagnostic(`potential at ${potential.length} vertices in ${elapsed.toFixed(1)} ms, range ${low.toFixed(1)} to ${high.toFixed(1)}`);
  assert.equal(potential.length, surface.positions.length / 3);
  assert.ok(potential.every(Number.isFinite));
  assert.ok(potential.some((value) => value > 2) && potential.some((value) => value < -2));
});

function chainSpec(chain, names, options = {}) {
  return { chain, names, ...options };
}

function buildModel(specs) {
  const atoms = [];
  const residues = [];
  let offsetY = 0;
  for (const spec of specs) {
    let x = 0;
    const chainResidues = [];
    if (spec.capStart) {
      chainResidues.push(residue(spec.chain, 0, 'ACE', [['CH3', 'C', -2.4, 0.9], ['C', 'C', -1.33, 0], ['O', 'O', -1.33, -1.23]], offsetY));
    }
    spec.names.forEach((name, index) => {
      if (spec.breakAfter && index === spec.breakAfter) x += 30;
      const resSeq = index + 1 + (spec.breakAfter && index >= spec.breakAfter ? 10 : 0);
      const backbone = [['N', 'N', 0, 0], ['CA', 'C', 1.2, 0.8], ['C', 'C', 2.47, 0], ['O', 'O', 2.47, -1.23]];
      const sideChain = SIDE_CHAINS[name].map((atomName, depth) => [atomName, elementOf(atomName), 1.2, 2.3 + depth * 1.4]);
      const last = index === spec.names.length - 1;
      const oxt = last && !spec.capEnd ? [['OXT', 'O', 3.3, 0.95]] : [];
      const atomSpecs = [...backbone, ...sideChain, ...oxt].map(([atomName, element, dx, dy]) => [atomName, element, x + dx, dy]);
      chainResidues.push(residue(spec.chain, resSeq, name, atomSpecs, offsetY));
      x += 3.8;
    });
    if (spec.capEnd) chainResidues.push(residue(spec.chain, spec.names.length + 1, 'NH2', [['N', 'N', x, 0]], offsetY));
    for (const item of chainResidues) {
      residues.push(item);
      for (const atom of item.atoms) {
        atom.id = atoms.length;
        atoms.push(atom);
      }
    }
    offsetY += 40;
  }
  return { atoms, residues };
}

function residue(chain, resSeq, resName, atomSpecs, offsetY = 0) {
  const kind = residueKindFromName(resName);
  const key = `${chain}:${resSeq}:${resName}`;
  const atoms = atomSpecs.map(([name, element, x = resSeq * 5, y = 0]) => ({
    id: -1,
    name,
    element,
    resName,
    chain,
    resSeq,
    iCode: '',
    residueKey: key,
    kind,
    isHet: kind !== 'protein' && kind !== 'nucleic',
    isWater: kind === 'water',
    isHydrogen: false,
    x,
    y: y + offsetY,
    z: 0,
  }));
  return { key, chain, resName, resSeq, iCode: '', kind, atoms };
}

function singleAtomResidue(chain, resSeq, resName, name, element) {
  return residue(chain, resSeq, resName, [[name, element, resSeq * 5, 100]]);
}

function elementOf(name) {
  return name.startsWith('P') ? 'P' : name[0];
}

function chargeReader(atoms, charges) {
  return (chain, resSeq, name) => {
    const index = atoms.findIndex((atom) => atom.chain === chain && atom.resSeq === resSeq && atom.name === name);
    assert.ok(index >= 0, `atom ${chain}:${resSeq}:${name} exists`);
    return charges[index];
  };
}

function parseModel(text) {
  const atoms = [];
  const residues = new Map();
  for (const line of text.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const name = line.slice(12, 16).trim();
    const resName = line.slice(17, 20).trim();
    const chain = line.slice(21, 22).trim() || '_';
    const resSeq = Number.parseInt(line.slice(22, 26), 10);
    const iCode = line.slice(26, 27).trim();
    const element = (line.slice(76, 78).trim() || name[0]).toUpperCase();
    const kind = residueKindFromName(resName);
    if (element === 'H' || kind === 'water') continue;
    const key = `${chain}:${resSeq}${iCode}:${resName}`;
    const atom = {
      id: atoms.length,
      name,
      element,
      resName,
      chain,
      resSeq,
      iCode,
      residueKey: key,
      kind,
      isHet: line.startsWith('HETATM'),
      isWater: false,
      isHydrogen: false,
      x: Number(line.slice(30, 38)),
      y: Number(line.slice(38, 46)),
      z: Number(line.slice(46, 54)),
    };
    atoms.push(atom);
    if (!residues.has(key)) residues.set(key, { key, chain, resName, resSeq, iCode, kind, atoms: [] });
    residues.get(key).atoms.push(atom);
  }
  return { atoms, residues: [...residues.values()] };
}

function sum(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function assertClose(actual, expected, tolerance = 1e-5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}
