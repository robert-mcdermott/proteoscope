import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPose } from './pose-checks.js';
import { SMILESError, readSMILES, smilesMapping } from './smiles.js';

const summary = (smiles) => {
  const molecule = readSMILES(smiles);
  return {
    atoms: molecule.atoms.map((atom) => `${atom.element}${atom.charge > 0 ? '+' : atom.charge < 0 ? '-' : ''}${atom.hydrogens ? `H${atom.hydrogens}` : ''}`).join(' '),
    orders: molecule.bonds.map((bond) => bond.order).join(''),
  };
};

test('SMILES atoms, charges, hydrogens and Kekulé bonds are read as RDKit reads them', () => {
  assert.deepEqual(summary('c1ccccc1'), { atoms: 'CH1 CH1 CH1 CH1 CH1 CH1', orders: '212121' });
  // Pyrrole's [nH] takes no double bond; pyridine's n does.
  assert.deepEqual(summary('c1cc[nH]c1'), { atoms: 'CH1 CH1 CH1 NH1 CH1', orders: '12112' });
  assert.deepEqual(summary('c1ccncc1').orders, '212121');
  // An exocyclic C=O leaves its ring carbon without a ring double bond (4-pyridone).
  assert.deepEqual(summary('O=c1cc[nH]cc1'), { atoms: 'O C CH1 CH1 NH1 CH1 CH1', orders: '2121121' });
  assert.deepEqual(summary('Cn1cnc2c1c(=O)n(C)c(=O)n2C').atoms, 'CH3 N CH1 N C C C O N CH3 C O N CH3');
  assert.deepEqual(summary('C[N+](C)(C)C').atoms, 'CH3 N+ CH3 CH3 CH3');
  assert.deepEqual(summary('c1cc[cH-]c1'), { atoms: 'CH1 CH1 CH1 C-H1 CH1', orders: '12112' });
  assert.deepEqual(summary('Clc1ccc(Br)cc1').atoms, 'CL C CH1 CH1 C BR CH1 CH1');
  // Hydrogens written as atoms join their neighbor; separate pieces stay in one molecule.
  assert.deepEqual(summary('[H]C([H])([H])O').atoms, 'CH3 OH1');
  assert.deepEqual(summary('CC(=O)[O-].[Na+]'), { atoms: 'CH3 C O O- NA+', orders: '121' });
  assert.deepEqual(summary('C#N').orders, '3');
  assert.deepEqual(summary('C%10CC%10').orders, '111');
});

test('SMILES stereo: @ and @@ with the hydrogen in its place, and / \\ on double bonds', () => {
  const { stereo } = readSMILES('N[C@@H](C)C(=O)O');
  assert.deepEqual(stereo.centers, [{ center: 1, order: [0, null, 2, 3], parity: '@@' }]);
  assert.deepEqual(readSMILES('[C@H](F)(Cl)Br').stereo.centers, [{ center: 0, order: [null, 1, 2, 3], parity: '@' }]);
  // A ring bond keeps the place of its digit among the neighbors.
  assert.deepEqual(readSMILES('C1CC[C@H]2CCCC[C@@H]2C1').stereo.centers.map((center) => center.order), [[2, null, 8, 4], [7, null, 3, 9]]);
  // A sulfoxide's lone pair counts after its three neighbors, as in RDKit.
  assert.deepEqual(readSMILES('[S@](C)(=O)c1ccccc1').stereo.centers[0].order, [1, 2, 3, null]);
  assert.deepEqual(readSMILES('C[S@](=O)c1ccccc1').stereo.centers[0].order, [0, 2, 3, null]);
  assert.deepEqual(readSMILES('F/C=C/F').stereo.doubleBonds, [{ a: 1, b: 2, sa: 0, sb: 3, cis: false }]);
  assert.deepEqual(readSMILES('F/C=C\\F').stereo.doubleBonds[0].cis, true);
  assert.deepEqual(readSMILES('F\\C=C/F').stereo.doubleBonds[0].cis, true);
  assert.equal(readSMILES('c1ccccc1').stereo.doubleBonds.length, 0);
});

// Coordinates RDKit embedded for these SMILES, which satisfy their stereo.
const EMBEDDED = {
  'C(=O)(O)[C@@H](N)C': [[0.97, -0.74, 0.29], [0.92, -1.66, 1.15], [2.19, -0.16, -0.05], [-0.26, -0.23, -0.38], [-1.43, -0.92, 0.07], [-0.33, 1.26, -0.13]],
  'C(/C(O)=O)=C\\C(=O)O': [[0.36, 0.09, 0.8], [1.81, 0.22, 0.74], [2.46, 0.12, -0.47], [2.45, 0.41, 1.81], [-0.34, -0.11, -0.3], [-1.78, -0.23, -0.19], [-2.36, -0.14, 0.92], [-2.57, -0.44, -1.33]],
  'C(/C(=O)O)=C/C(=O)O': [[0.81, -0.94, 0.24], [1.65, 0.19, -0.08], [2.91, -0.04, -0.04], [1.3, 1.46, -0.41], [-0.49, -0.98, 0.27], [-1.34, 0.14, -0.02], [-1.03, 1.3, -0.33], [-2.72, -0.09, 0.06]],
};

function smilesPose(smiles, coordinates) {
  const molecule = readSMILES(smiles);
  const names = molecule.atoms.map((atom, index) => `${atom.element}${index + 1}`);
  return {
    ligand: {
      atoms: molecule.atoms.map((atom, index) => ({ name: names[index], element: atom.element, charge: atom.charge, x: coordinates[index][0], y: coordinates[index][1], z: coordinates[index][2] })),
      bonds: molecule.bonds,
    },
    reference: {
      smiles: true,
      centers: molecule.stereo.centers.map((center) => ({ center: names[center.center], order: center.order.map((slot) => (slot === null ? null : names[slot])), parity: center.parity })),
      doubleBonds: molecule.stereo.doubleBonds.map((bond) => ({ a: names[bond.a], b: names[bond.b], sa: names[bond.sa], sb: names[bond.sb], cis: bond.cis })),
    },
  };
}

test('a pose is checked against the stereo of its SMILES', () => {
  const verdict = (smiles, coordinates, id) => {
    const { ligand, reference } = smilesPose(smiles, coordinates);
    return checkPose(ligand, [], { reference }).checks.find((check) => check.id === id);
  };
  const alanine = 'C(=O)(O)[C@@H](N)C';
  const chirality = verdict(alanine, EMBEDDED[alanine], 'chirality');
  assert.equal(chirality.passed, true);
  assert.equal(chirality.detail, 'The stereocenter is as in the SMILES.');
  const mirrored = EMBEDDED[alanine].map(([x, y, z]) => [-x, y, z]);
  assert.match(verdict(alanine, mirrored, 'chirality').detail, /1 inverted \(C4\)/);
  // Fumarate (trans) and maleate (cis) in their own geometry, then each in the other's.
  const fumarate = 'C(/C(O)=O)=C\\C(=O)O';
  const maleate = 'C(/C(=O)O)=C/C(=O)O';
  assert.equal(verdict(fumarate, EMBEDDED[fumarate], 'double-bond-stereo').passed, true);
  assert.equal(verdict(maleate, EMBEDDED[maleate], 'double-bond-stereo').passed, true);
  assert.equal(verdict('C(/C(O)=O)=C/C(=O)O', EMBEDDED[fumarate], 'double-bond-stereo').passed, false);
});

test('SMILES atoms pair with a model\'s: in the string\'s order, else by their bonds', () => {
  const alanine = 'C(=O)(O)[C@@H](N)C';
  const molecule = readSMILES(alanine);
  const atoms = molecule.atoms.map((atom, index) => ({ element: atom.element, x: EMBEDDED[alanine][index][0], y: EMBEDDED[alanine][index][1], z: EMBEDDED[alanine][index][2] }));
  assert.deepEqual(smilesMapping(molecule, atoms), [0, 1, 2, 3, 4, 5]);
  // The same atoms written in another order: matched through the model's bonds.
  const shuffle = [5, 3, 4, 0, 2, 1];
  const shuffled = shuffle.map((index) => atoms[index]);
  const position = new Map(shuffle.map((original, at) => [original, at]));
  const bonds = molecule.bonds.map((bond) => ({ a: position.get(bond.a), b: position.get(bond.b) }));
  const mapping = smilesMapping(molecule, shuffled, bonds);
  assert.deepEqual(mapping.map((at) => shuffle[at]).slice(0, 4), [0, 1, 2, 3].map((index) => (index === 1 || index === 2 ? mapping.map((at) => shuffle[at])[index] : index)));
  assert.equal(mapping.map((at) => shuffle[at])[3], 3, 'the stereocenter pairs with itself');
  assert.equal(smilesMapping(molecule, atoms.slice(1)), null, 'a different atom count');
});

test('only marks RDKit keeps count: equivalent neighbors, amines and small rings drop theirs', () => {
  const count = (smiles) => [readSMILES(smiles).stereo.centers.length, readSMILES(smiles).stereo.doubleBonds.length];
  for (const smiles of ['[C@H](C)(C)O', 'C1CC[C@]1(F)Cl', '[N@](C)(CC)CCC', 'C[N@@+](C)(CC)CCC', 'C/C=C(/C)C', 'F/C=C1/CCCCC1']) assert.deepEqual(count(smiles), [0, 0], smiles);
  // Ring pairs with a partner center in the ring system are real (cis/trans relations).
  assert.deepEqual(count('C1CC[C@H]2CCCC[C@@H]2C1'), [2, 0]);
  assert.deepEqual(count('O[C@H]1CC[C@@H](O)CC1'), [2, 0]);
  assert.deepEqual(count('C[C@@H](O)[C@H](C)O'), [2, 0]);
  assert.deepEqual(count('C1=C\\CCCCCC/1'), [0, 1]);
});

test('symmetric molecules pair so that a meso compound or a ring junction is not called inverted', () => {
  const verdict = (smiles, coordinates, shuffle) => {
    const molecule = readSMILES(smiles);
    const atoms = shuffle.map((index) => ({ element: molecule.atoms[index].element, x: coordinates[index][0], y: coordinates[index][1], z: coordinates[index][2] }));
    const at = new Map(shuffle.map((original, position) => [original, position]));
    const mapping = smilesMapping(molecule, atoms, molecule.bonds.map((bond) => ({ a: at.get(bond.a), b: at.get(bond.b) })));
    const names = atoms.map((atom, index) => `${atom.element}${index + 1}`);
    const nameOf = (index) => names[mapping[index]];
    const ligand = { atoms: atoms.map((atom, index) => ({ ...atom, name: names[index], charge: 0 })), bonds: molecule.bonds.map((bond) => ({ a: mapping[bond.a], b: mapping[bond.b], order: bond.order })) };
    const reference = { smiles: true, centers: molecule.stereo.centers.map((center) => ({ center: nameOf(center.center), order: center.order.map((slot) => (slot === null ? null : nameOf(slot))), parity: center.parity })), doubleBonds: [] };
    return checkPose(ligand, [], { reference }).checks.find((check) => check.id === 'chirality').detail;
  };
  // meso-2,3-Butanediol written out of order, paired through its bonds either way round.
  const meso = [[1.63, 0.06, -0.59], [0.64, 0.11, 0.53], [0.39, 1.36, 1.04], [-0.64, -0.63, 0.22], [-1.54, 0.14, -0.72], [-1.34, -0.73, 1.43]];
  for (const shuffle of [[4, 3, 5, 1, 0, 2], [0, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 0]]) assert.equal(verdict('C[C@@H](O)[C@H](C)O', meso, shuffle), 'All 2 stereocenters are as in the SMILES.');
  // trans-Decalin's geometry against the trans and the cis SMILES.
  const trans = [[-2.48, -0.73, -0.13], [-2.46, 0.7, -0.48], [-1.16, 1.41, -0.44], [0.06, 0.55, -0.51], [1.29, 1.38, -0.37], [2.28, 0.82, 0.62], [2.48, -0.65, 0.44], [1.2, -1.44, 0.44], [-0.04, -0.56, 0.51], [-1.18, -1.42, 0.04]];
  const order = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
  assert.equal(verdict('C1CC[C@H]2CCCC[C@@H]2C1', trans, order), 'All 2 stereocenters are as in the SMILES.');
  assert.match(verdict('C1CC[C@H]2CCCC[C@H]2C1', trans, order), /^1 inverted/);
});

test('malformed SMILES are refused with a reason', () => {
  for (const [smiles, reason] of [['C(', /branch/], ['C1CC', /Ring 1/], ['[Xx]', /names no element/], ['c1ccc1c', /kekulized|Ring/], ['*C', /Wildcard/], ['C=', /ends with a bond/]]) {
    assert.throws(() => readSMILES(smiles), (error) => error instanceof SMILESError && reason.test(error.message), smiles);
  }
});
