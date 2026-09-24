import assert from 'node:assert/strict';
import test from 'node:test';
import { findInteractions, ligandChemistry } from './interactions.js';
import {
  confidenceFromName,
  detectMolfile,
  isPDBQTReceptor,
  moleculeAtoms,
  moleculeComponent,
  parseMolfile,
  pdbqtToPDB,
  scoreColumns,
} from './molfile.js';
import { addAtomToModel, createModel, createStructure, parseStructure } from './parse.js';
import { deriveStructure } from './structure.js';
import { exampleText } from './test-data.mjs';

const v2000Atom = (x, y, z, symbol, charge = 0) => `${x.toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}${z.toFixed(4).padStart(10)} ${symbol.padEnd(3)} 0${String(charge).padStart(3)}  0  0  0  0  0  0  0  0  0  0`;
const v2000Bond = (a, b, type) => `${String(a).padStart(3)}${String(b).padStart(3)}${String(type).padStart(3)}  0`;

// Acetate (formal charge on O2 by M  CHG) and benzene with aromatic (type 4) bonds.
const SDF = [
  'acetate', '  RDKit          3D', '',
  '  4  3  0  0  0  0  0  0  0  0999 V2000',
  v2000Atom(0, 0, 0, 'C'), v2000Atom(1.25, 0, 0, 'O'), v2000Atom(-0.6, 1.1, 0, 'O'), v2000Atom(-0.8, -1.3, 0, 'C'),
  v2000Bond(1, 2, 2), v2000Bond(1, 3, 1), v2000Bond(1, 4, 1),
  'M  CHG  1   3  -1', 'M  END',
  '> <minimizedAffinity>', '-5.12', '',
  '> <CNNscore>', '0.40', '',
  '$$$$',
  'benzene', '', '',
  '  6  6  0  0  0  0  0  0  0  0999 V2000',
  ...[0, 1, 2, 3, 4, 5].map((k) => v2000Atom(1.39 * Math.cos((k * Math.PI) / 3), 1.39 * Math.sin((k * Math.PI) / 3), 0, 'C')),
  ...[0, 1, 2, 3, 4, 5].map((k) => v2000Bond(k + 1, ((k + 1) % 6) + 1, 4)),
  'M  END',
  '> <minimizedAffinity>', '-6.80', '',
  '> <CNNscore>', '0.75', '',
  '$$$$', '',
].join('\n');

test('SD files: records, bond orders, M  CHG charges, SD tags and implicit hydrogens', () => {
  assert.equal(detectMolfile(SDF, 'poses.sdf'), 'sdf');
  assert.equal(detectMolfile(SDF, 'poses'), 'sdf', 'recognized from the counts line');
  const { format, molecules } = parseMolfile(SDF, 'poses.sdf');
  assert.equal(format, 'sdf');
  assert.equal(molecules.length, 2);
  const [acetate, benzene] = molecules;
  assert.equal(acetate.title, 'acetate');
  assert.deepEqual(acetate.atoms.map((atom) => atom.name), ['C1', 'O1', 'O2', 'C2']);
  assert.deepEqual(acetate.atoms.map((atom) => atom.charge), [0, 0, -1, 0]);
  assert.equal(acetate.bonds[0].order, 2);
  assert.deepEqual(acetate.atoms.map((atom) => atom.hydrogens), [0, 0, 0, 3]);
  assert.equal(acetate.formula, 'C2H3O2');
  assert.equal(acetate.properties.get('minimizedAffinity'), '-5.12');
  assert.ok(benzene.bonds.every((bond) => bond.aromatic));
  assert.ok(benzene.atoms.every((atom) => atom.aromatic && atom.hydrogens === 1));
  assert.equal(benzene.formula, 'C6H6');
  assert.deepEqual(scoreColumns(molecules), [{ key: 'minimizedAffinity', lower: true }, { key: 'CNNscore', lower: false }]);
});

test('V3000 molfiles, with continued lines and CHG=', () => {
  const text = [
    'methylammonium', '', '', '  0  0  0     0  0            999 V3000',
    'M  V30 BEGIN CTAB', 'M  V30 COUNTS 2 1 0 0 0', 'M  V30 BEGIN ATOM',
    'M  V30 1 C 0.0 0.0 0.0 0', 'M  V30 2 N 1.47 0.0 -',
    'M  V30 0.0 0 CHG=1', 'M  V30 END ATOM', 'M  V30 BEGIN BOND', 'M  V30 1 1 1 2', 'M  V30 END BOND', 'M  V30 END CTAB', 'M  END', '$$$$',
  ].join('\n');
  const [molecule] = parseMolfile(text, 'x.mol').molecules;
  assert.deepEqual(molecule.atoms.map((atom) => [atom.element, atom.charge, atom.hydrogens]), [['C', 0, 3], ['N', 1, 3]]);
  assert.equal(molecule.bonds.length, 1);
});

test('MOL2: SYBYL types, aromatic and amide bonds, N.4 charges and DOCK score comments', () => {
  const text = [
    '##########                 Grid_Score:     -41.25',
    '@<TRIPOS>MOLECULE', 'ligand_1', ' 4 3 1 0 0', 'SMALL', 'GASTEIGER', '',
    '@<TRIPOS>ATOM',
    '      1 C1         0.0000    0.0000    0.0000 C.2     1  LIG1       0.2',
    '      2 O1         1.2300    0.0000    0.0000 O.2     1  LIG1      -0.3',
    '      3 N1        -0.6700    1.1600    0.0000 N.am    1  LIG1      -0.2',
    '      4 N2        -0.7600   -1.3000    0.0000 N.4     1  LIG1       0.3',
    '@<TRIPOS>BOND',
    '     1     1     2    2', '     2     1     3   am', '     3     1     4    1',
  ].join('\n');
  assert.equal(detectMolfile(text, 'dock.mol2'), 'mol2');
  const [molecule] = parseMolfile(text, 'dock.mol2').molecules;
  assert.equal(molecule.title, 'ligand_1');
  assert.deepEqual(molecule.atoms.map((atom) => atom.name), ['C1', 'O1', 'N1', 'N2'], 'the file’s unique names are kept');
  assert.equal(molecule.atoms[3].charge, 1, 'N.4 is an ammonium nitrogen');
  assert.equal(molecule.atoms[2].hydrogens, 2);
  assert.equal(molecule.atoms[3].hydrogens, 3);
  assert.equal(molecule.properties.get('Grid_Score'), '-41.25');
  assert.equal(molecule.residueName, 'LIG');
});

test('PDBQT: Vina poses with scores, AutoDock types, inferred bonds and polar hydrogens', () => {
  const atom = (serial, name, x, y, z, type) => `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} UNL     1    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  0.00  0.00    +0.000 ${type.padEnd(2)}`;
  const pose = (model, shift, score) => [
    `MODEL ${model}`, `REMARK VINA RESULT:    ${score}      0.000      0.000`, 'REMARK  Name = phenol', 'ROOT',
    ...[0, 1, 2, 3, 4, 5].map((k) => atom(k + 1, `C${k + 1}`, 1.39 * Math.cos((k * Math.PI) / 3) + shift, 1.39 * Math.sin((k * Math.PI) / 3), 0, 'A')),
    atom(7, 'O1', 2.75 + shift, 0, 0, 'OA'), atom(8, 'H1', 3.1 + shift, 0.9, 0, 'HD'),
    'ENDROOT', 'TORSDOF 1', 'ENDMDL',
  ];
  const text = [...pose(1, 0, '-6.4'), ...pose(2, 5, '-5.9')].join('\n');
  assert.equal(detectMolfile(text, 'out.pdbqt'), 'pdbqt');
  assert.equal(isPDBQTReceptor(text), false);
  const { molecules } = parseMolfile(text, 'out.pdbqt');
  assert.equal(molecules.length, 2);
  const [first] = molecules;
  assert.equal(first.title, 'phenol');
  assert.equal(first.properties.get('Vina affinity'), '-6.4');
  assert.deepEqual([...new Set(first.atoms.map((item) => item.element))], ['C', 'O', 'H']);
  assert.equal(first.bonds.filter((bond) => bond.aromatic).length, 6);
  assert.equal(first.bonds.length, 8);
  assert.equal(first.atoms.find((item) => item.name === 'O1').hydrogens, 1);
  assert.deepEqual(scoreColumns(molecules), [{ key: 'Vina affinity', lower: true }]);
  // PDBQT has no bond orders: its poses are typed from geometry, and its formula leaves out the
  // hydrogens it only partly lists.
  assert.equal(moleculeComponent(first).untyped, true);
  assert.equal(first.formula, 'C6O (without H)');
  const typed = moleculeModel(first);
  assert.ok(typed.atoms.every((item) => item.hydrogens === undefined), 'geometry typing');
  assert.equal(ligandChemistry(typed, typed.atoms.map((item) => item.id)).aromaticRings.length, 1);
  // Flexible receptor residues written inside a MODEL are not part of the pose.
  const flexible = [...pose(1, 0, '-6.4').slice(0, -1), 'BEGIN_RES TYR A 169', atom(9, 'CB', 9, 9, 9, 'C'), atom(10, 'CG', 10.4, 9, 9, 'A'), 'END_RES TYR A 169', 'ENDMDL'].join('\n');
  assert.equal(parseMolfile(flexible, 'flex.pdbqt').molecules[0].atoms.length, 8);

  const receptor = 'ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00  0.00    -0.346 N \nATOM      2  CA  ALA A   1      11.639   6.071  -5.147  1.00  0.00     0.212 C \nATOM      3  O   ALA A   1      12.500   5.000  -4.500  1.00  0.00    -0.270 OA';
  assert.equal(isPDBQTReceptor(receptor), true);
  const pdb = pdbqtToPDB(receptor);
  assert.equal(pdb.split('\n')[2].slice(76, 78), ' O');
  assert.equal(parseStructure(pdb, 'receptor.pdb').models[0].atoms[2].element, 'O');
});

// One molecule as a model of its own, typed by its component.
function moleculeModel(molecule) {
  const structure = createStructure('molecule', 'pdb');
  const model = createModel(1);
  for (const atom of moleculeAtoms(molecule, { chain: 'L', firstId: 0 })) addAtomToModel(model, atom);
  structure.models.push(model);
  structure.baseModels = structure.models;
  structure.components.set('LIG', moleculeComponent(molecule));
  deriveStructure(structure);
  return structure.models[0];
}

test('molfile records: query bonds are single, malformed atom lines are errors', () => {
  const record = (bondType) => ['query', '', '', '  2  1  0  0  0  0  0  0  0  0999 V2000', v2000Atom(0, 0, 0, 'C'), v2000Atom(1.5, 0, 0, 'C'), v2000Bond(1, 2, bondType), 'M  END', '$$$$'].join('\n');
  for (const type of [5, 6, 7, 8]) assert.equal(parseMolfile(record(type), 'q.sdf').molecules[0].bonds[0].order, 1, `type ${type}`);
  const truncated = ['cut', '', '', '  3  2  0  0  0  0  0  0  0  0999 V2000', v2000Atom(0, 0, 0, 'C'), 'M  END', '$$$$'].join('\n');
  assert.throws(() => parseMolfile(truncated, 'cut.sdf'), /atom 2 of 3 is missing or malformed/);
});

test('only a tetrazole without an N-substituent is charged; a cationic N accepts nothing', () => {
  // 5-methyl-1H-tetrazole and 1,5-dimethyltetrazole, Kekulé bonds, without hydrogens.
  const radius = 1.33 / (2 * Math.sin(Math.PI / 5));
  const ring = [90, 162, 234, 306, 18].map((degrees) => [radius * Math.cos((degrees * Math.PI) / 180), radius * Math.sin((degrees * Math.PI) / 180)]);
  const out = (index, length) => ring[index].map((value) => (value * (radius + length)) / radius);
  const tetrazole = (methylated) => {
    const atoms = [v2000Atom(...ring[0], 0, 'C'), ...ring.slice(1).map(([x, y]) => v2000Atom(x, y, 0, 'N')), v2000Atom(...out(0, 1.49), 0, 'C')];
    const bonds = [v2000Bond(1, 2, 1), v2000Bond(2, 3, 1), v2000Bond(3, 4, 2), v2000Bond(4, 5, 1), v2000Bond(5, 1, 2), v2000Bond(1, 6, 1)];
    if (methylated) {
      atoms.push(v2000Atom(...out(1, 1.47), 0, 'C'));
      bonds.push(v2000Bond(2, 7, 1));
    }
    return ['tetrazole', '', '', `${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`, ...atoms, ...bonds, 'M  END', '$$$$'].join('\n');
  };
  const charges = (text) => {
    const model = moleculeModel(parseMolfile(text, 't.sdf').molecules[0]);
    return ligandChemistry(model, model.atoms.map((atom) => atom.id)).charges.map((group) => group.label);
  };
  assert.deepEqual(charges(tetrazole(false)), ['tetrazole']);
  assert.deepEqual(charges(tetrazole(true)), []);

  // Nitromethane: the nitro N is N⁺ and never an acceptor; its oxygens are.
  const nitro = ['nitromethane', '', '', '  4  3  0  0  0  0  0  0  0  0999 V2000',
    v2000Atom(0, 0, 0, 'C'), v2000Atom(1.49, 0, 0, 'N', 3), v2000Atom(2.1, 1.07, 0, 'O'), v2000Atom(2.1, -1.07, 0, 'O', 5),
    v2000Bond(1, 2, 1), v2000Bond(2, 3, 2), v2000Bond(2, 4, 1), 'M  END', '$$$$'].join('\n');
  const model = moleculeModel(parseMolfile(nitro, 'nitro.sdf').molecules[0]);
  const chemistry = ligandChemistry(model, model.atoms.map((atom) => atom.id));
  const nitrogen = model.atoms.find((atom) => atom.element === 'N').id;
  assert.ok(!chemistry.acceptors.includes(nitrogen));
  assert.equal(chemistry.acceptors.filter((index) => model.atoms[index].element === 'O').length, 2);
});

test('DiffDock file names carry the rank and confidence', () => {
  assert.deepEqual(confidenceFromName('rank1_confidence-0.52.sdf'), { rank: 1, confidence: -0.52 });
  assert.deepEqual(confidenceFromName('rank12.sdf'), { rank: 12, confidence: Number.NaN });
  assert.equal(confidenceFromName('ligand.sdf'), null);
});

test('a pose placed over the crystal ligand bonds to nothing and finds the hinge H-bond (1M17)', () => {
  const structure = parseStructure(exampleText('1m17'), '1m17.cif');
  const base = structure.models[0];
  const erlotinib = base.atoms.filter((atom) => atom.resName === 'AQ4' && !atom.isHydrogen);
  const index = new Map(erlotinib.map((atom, position) => [atom.name, position + 1]));
  const component = structure.components.get('AQ4');
  const bonds = [...component.bonds]
    .map(([key, bond]) => [...key.split('|').map((name) => index.get(name)), bond.order])
    .filter(([a, b]) => a && b);
  const text = [
    'erlotinib', '', '', `${String(erlotinib.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`,
    ...erlotinib.map((atom) => v2000Atom(atom.x, atom.y, atom.z, atom.element[0] + atom.element.slice(1).toLowerCase())),
    ...bonds.map(([a, b, order]) => v2000Bond(a, b, order)), 'M  END', '$$$$',
  ].join('\n');
  const [molecule] = parseMolfile(text, 'pose.sdf').molecules;
  const model = createModel(1);
  for (const atom of base.atoms) addAtomToModel(model, { ...atom, id: model.atoms.length });
  const first = model.atoms.length;
  for (const atom of moleculeAtoms(molecule, { chain: 'L', firstId: first })) addAtomToModel(model, atom);
  structure.models = [model];
  structure.components.set('LIG', moleculeComponent(molecule));
  deriveStructure(structure);
  const derived = structure.models[0];
  assert.ok(!derived.bonds.some((bond) => (bond.a >= first) !== (bond.b >= first)), 'no bond joins the pose to the crystal ligand');
  const pose = derived.atoms.slice(first).map((atom) => atom.id);
  assert.equal(ligandChemistry(derived, pose).aromaticRings.length, 3);
  const partners = derived.atoms.filter((atom) => atom.kind !== 'ligand').map((atom) => atom.id);
  const hinge = findInteractions(derived, pose, { groupB: partners }).filter((item) => item.type === 'hydrogen-bond');
  assert.deepEqual(hinge.map((item) => item.residueB), ['A:769:MET']);
});
