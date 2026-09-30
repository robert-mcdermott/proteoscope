import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyChemistry } from './chemistry.js';
import { boundsMatrix, uffLabels } from './dg-bounds.js';
import { parseCIFDocument, parseStructure, readChemComp } from './parse.js';
import { perceiveMolecule } from './perception.js';
import { checkPose, componentReference, contactClass, planeDeviation, residuePose } from './pose-checks.js';
import { deriveStructure } from './structure.js';
import { exampleText } from './test-data.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./testdata/ligands.json', import.meta.url), 'utf8'));
const molecule = (elements, bonds, charges = []) => ({
  atoms: elements.map((element, index) => ({ element, charge: charges[index] ?? 0 })),
  bonds: bonds.map(([a, b, order]) => ({ a, b, order })),
});
// A dictionary ligand of the fixture, without metal atoms (as checkPose() takes it).
const fixture = (code) => {
  const kept = fixtures[code].atoms.map((atom, index) => [atom, index]).filter(([atom]) => atom[1] !== 'FE');
  const position = new Map(kept.map(([, index], at) => [index, at]));
  return {
    atoms: kept.map(([[name, element, charge, , x, y, z]]) => ({ name, element, charge, x, y, z })),
    bonds: fixtures[code].bonds.filter(([a, b]) => position.has(a) && position.has(b)).map(([a, b, order]) => ({ a: position.get(a), b: position.get(b), order })),
  };
};
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);

test('perception follows RDKit: hydrogens, aromaticity, conjugation and hybridization', () => {
  // N-methylacetamide: the amide nitrogen is sp2 and conjugated with the carbonyl.
  const amide = perceiveMolecule(molecule(['C', 'C', 'O', 'N', 'C'], [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1]]));
  assert.deepEqual(amide.atoms.map((atom) => atom.hydrogens), [3, 0, 0, 1, 3]);
  assert.deepEqual(amide.atoms.map((atom) => atom.hybridization), ['SP3', 'SP2', 'SP2', 'SP2', 'SP3']);
  assert.deepEqual(amide.bonds.map((bond) => bond.conjugated), [false, true, true, false]);
  // Kekulé benzene becomes aromatic; so does uracil in RDKit's model.
  const benzene = perceiveMolecule(molecule(['C', 'C', 'C', 'C', 'C', 'C'], [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1]]));
  assert.ok(benzene.atoms.every((atom) => atom.aromatic && atom.hydrogens === 1));
  assert.ok(benzene.bonds.every((bond) => bond.order === 1.5));
  const uracil = perceiveMolecule(molecule(['O', 'C', 'N', 'C', 'O', 'C', 'C', 'N'], [[0, 1, 2], [1, 2, 1], [2, 3, 1], [3, 4, 2], [3, 5, 1], [5, 6, 2], [6, 7, 1], [7, 1, 1]]));
  assert.deepEqual(uracil.atoms.map((atom) => atom.aromatic), [false, true, true, true, false, true, true, true]);
  // A nitro group written N(=O)=O is made charge-separated, as RDKit's cleanup does (its first
  // oxygen becomes the anion).
  const nitro = perceiveMolecule(molecule(['C', 'N', 'O', 'O'], [[0, 1, 1], [1, 2, 2], [1, 3, 2]]));
  assert.deepEqual(nitro.atoms.map((atom) => atom.charge), [0, 1, -1, 0]);
  assert.equal(nitro.problem, null);
  // Aromatic bonds without a Kekulé structure (MOL2) are kekulized; pyrrole's nitrogen keeps its H.
  const pyrrole = perceiveMolecule(molecule(['N', 'C', 'C', 'C', 'C'], [[0, 1, 1.5], [1, 2, 1.5], [2, 3, 1.5], [3, 4, 1.5], [4, 0, 1.5]]));
  assert.equal(pyrrole.problem, null);
  assert.deepEqual(pyrrole.atoms.map((atom) => [atom.hydrogens, atom.aromatic, atom.hybridization]), [[1, true, 'SP2'], [1, true, 'SP2'], [1, true, 'SP2'], [1, true, 'SP2'], [1, true, 'SP2']]);
  // A neutral nitrogen with four bonds fails RDKit's sanitization.
  assert.match(perceiveMolecule(molecule(['N', 'C', 'C', 'C', 'C'], [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]])).problem, /valence of 4/);
});

test('rings are RDKit\'s symmetrized smallest set', () => {
  const ringSizes = (input) => perceiveMolecule(input).rings.map((ring) => ring.length).sort();
  const cubane = molecule(Array(8).fill('C'), [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 0, 1], [4, 5, 1], [5, 6, 1], [6, 7, 1], [7, 4, 1], [0, 4, 1], [1, 5, 1], [2, 6, 1], [3, 7, 1]]);
  assert.deepEqual(ringSizes(cubane), [4, 4, 4, 4, 4, 4], 'six faces, one more than the cycle rank');
  const bicyclooctane = molecule(Array(8).fill('C'), [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 0, 1], [0, 6, 1], [6, 7, 1], [7, 3, 1]]);
  assert.deepEqual(ringSizes(bicyclooctane), [6, 6, 6]);
  const naphthalene = molecule(Array(10).fill('C'), [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1], [4, 6, 1], [6, 7, 2], [7, 8, 1], [8, 9, 2], [9, 3, 1]]);
  assert.deepEqual(ringSizes(naphthalene), [6, 6]);
});

test('distance-geometry bounds match RDKit\'s GetMoleculeBoundsMatrix', () => {
  // N-methylacetamide: amides are held trans (O···C and C···C 1-4 bounds), values from RDKit.
  const amide = boundsMatrix(perceiveMolecule(molecule(['C', 'C', 'O', 'N', 'C'], [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1]])));
  close(amide.lower(0, 1), 1.476);
  close(amide.upper(0, 1), 1.496);
  close(amide.lower(1, 2), 1.247949);
  close(amide.upper(0, 2), 2.419063);
  close(amide.lower(2, 4), 2.721189);
  close(amide.upper(2, 4), 2.841189);
  close(amide.lower(0, 4), 3.789526);
  close(amide.upper(0, 4), 3.909526);
  assert.deepEqual(uffLabels(perceiveMolecule(molecule(['C', 'C', 'O', 'N', 'C'], [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1]]))), ['C_3', 'C_R', 'O_R', 'N_R', 'C_3']);
  // The whole matrix of 14 dictionary ligands, summed, against RDKit's (lower bounds; upper bounds
  // below RDKit's 1000 Å cap); with their aromatic atoms, hydrogens and rings. Heme without its iron.
  const RDKIT = {
    STI: [24, 31, 5, 2066.065399, 6260.992846], AQ4: [16, 23, 3, 1237.011857, 2756.101296], ATP: [9, 16, 3, 1356.667878, 3623.729105],
    HEM: [20, 30, 5, 2652.714764, 6444.387102], NAG: [0, 15, 1, 255.172849, 427.028533], FAD: [23, 33, 6, 4276.418234, 16424.685403],
    RAP: [0, 79, 4, 6453.968812, 23819.506759], CLR: [0, 46, 4, 1061.595722, 2533.687301], RIT: [22, 48, 4, 3844.288674, 13185.151978],
    CAM: [0, 16, 2, 121.580095, 155.270485], BEN: [6, 8, 1, 91.398753, 104.729445], '1N1': [17, 26, 4, 1634.397334, 4601.518809],
    SAM: [9, 22, 3, 1016.999186, 2468.002281], '0WM': [16, 25, 4, 1720.936353, 4220.369641],
  };
  for (const [code, [aromatic, hydrogens, rings, lower, upper]] of Object.entries(RDKIT)) {
    const perceived = perceiveMolecule(fixture(code));
    assert.equal(perceived.problem, null, code);
    assert.equal(perceived.atoms.filter((atom) => atom.aromatic).length, aromatic, `${code} aromatic atoms`);
    assert.equal(perceived.atoms.reduce((sum, atom) => sum + atom.hydrogens, 0), hydrogens, `${code} hydrogens`);
    assert.equal(perceived.rings.length, rings, `${code} rings`);
    const bounds = boundsMatrix(perceived);
    let lowerSum = 0;
    let upperSum = 0;
    for (let i = 0; i < bounds.n; i += 1) {
      for (let j = i + 1; j < bounds.n; j += 1) {
        lowerSum += bounds.lower(i, j);
        if (bounds.upper(i, j) < 999) upperSum += bounds.upper(i, j);
      }
    }
    close(lowerSum, lower, 1e-4);
    close(upperSum, upper, 1e-4);
  }
});

test('a pose passes or fails PoseBusters\' checks', () => {
  // Benzene as a regular hexagon, 1.39 Å bonds, in the z = 0 plane.
  const ring = Array.from({ length: 6 }, (_, index) => [1.39 * Math.cos((index * Math.PI) / 3), 1.39 * Math.sin((index * Math.PI) / 3), 0]);
  const benzene = (positions) => ({
    atoms: positions.map(([x, y, z], index) => ({ name: `C${index + 1}`, element: 'C', charge: 0, x, y, z })),
    bonds: [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1]].map(([a, b, order]) => ({ a, b, order })),
  });
  // A protein atom 3.8 Å above the ring: near, no clash.
  const environment = [{ key: 7, element: 'C', x: 0, y: 0, z: 3.8, contact: 'protein' }];
  const byId = (result) => Object.fromEntries(result.checks.map((check) => [check.id, check]));
  const good = checkPose(benzene(ring), environment);
  assert.deepEqual(good.failed, []);
  assert.equal(good.passed, good.checked);
  assert.equal(byId(good)['aromatic-flatness'].value < 1e-9, true);
  // One atom 0.8 Å out of the plane.
  const puckered = byId(checkPose(benzene(ring.map((p, index) => (index === 0 ? [p[0], p[1], 0.8] : p))), environment));
  assert.equal(puckered['aromatic-flatness'].passed, false);
  close(puckered['aromatic-flatness'].value, planeDeviation(ring.map((p, index) => (index === 0 ? [p[0], p[1], 0.8] : p))));
  // Two bonds stretched to 1.9 Å.
  const stretched = byId(checkPose(benzene(ring.map((p, index) => (index === 0 ? [p[0] + 0.8, p[1], 0] : p))), environment));
  assert.equal(stretched['bond-lengths'].passed, false);
  assert.deepEqual(stretched['bond-lengths'].links.map((link) => link.slice().sort()), [[0, 1], [0, 5]]);
  // A protein atom 1.5 Å away clashes, unless it is bonded to the ligand; a lone ligand is far.
  const clash = [{ key: 9, element: 'O', x: 1.39, y: 0, z: 1.5, contact: 'protein' }];
  // Closest pair first: the oxygen sits 1.5 Å above one atom and near its two neighbors.
  assert.deepEqual(byId(checkPose(benzene(ring), clash))['protein-distance'].pairs.map(([atom]) => atom), [0, 1, 5]);
  assert.equal(byId(checkPose(benzene(ring), clash, { bondedKeys: new Set([9]) }))['protein-distance'].passed, true);
  assert.equal(byId(checkPose(benzene(ring), []))['protein-near'].passed, false);
  // Without bond orders only the contact checks run.
  const unknown = checkPose({ atoms: benzene(ring).atoms, bonds: null }, environment);
  assert.deepEqual(unknown.checks.filter((check) => check.passed !== null).map((check) => check.group), Array(9).fill('contacts'));
});

test('stereocenters and double bonds are compared with the dictionary\'s ideal coordinates', () => {
  // Bromochlorofluoromethane's carbon with its three heavy neighbors, and the mirror image.
  const center = { atoms: [['C1', 'C', 0, 0, 0], ['F1', 'F', 1.35, 0, 0], ['CL1', 'CL', -0.6, 1.6, 0], ['BR1', 'BR', -0.6, -0.9, 1.6]].map(([name, element, x, y, z]) => ({ name, element, charge: 0, x, y, z })), bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]].map(([a, b, order]) => ({ a, b, order })) };
  const reference = { atoms: new Map(center.atoms.map((atom) => [atom.name, { x: atom.x, y: atom.y, z: atom.z, stereo: atom.name === 'C1' ? 'R' : 'N' }])), bonds: [] };
  const chirality = (ligand) => checkPose(ligand, [], { reference }).checks.find((check) => check.id === 'chirality');
  assert.equal(chirality(center).passed, true);
  const mirrored = { ...center, atoms: center.atoms.map((atom) => ({ ...atom, z: -atom.z })) };
  assert.equal(chirality(mirrored).passed, false);
  assert.match(chirality(mirrored).detail, /1 inverted \(C1\)/);
  // (E)-2-butene, and turned to Z.
  const butene = (z) => ({ atoms: [['C1', -1.9, 1.2], ['C2', -0.67, 0.4], ['C3', 0.67, -0.4], ['C4', 1.9, z ? 1.2 : -1.2]].map(([name, x, y]) => ({ name, element: 'C', charge: 0, x, y: name === 'C4' && z ? 1.2 : y, z: 0 })), bonds: [[0, 1, 1], [1, 2, 2], [2, 3, 1]].map(([a, b, order]) => ({ a, b, order })) });
  const trans = butene(false);
  const eReference = { atoms: new Map(trans.atoms.map((atom) => [atom.name, { x: atom.x, y: atom.y, z: atom.z, stereo: '' }])), bonds: [{ a: 'C2', b: 'C3', stereo: 'E' }] };
  const doubleBond = (ligand) => checkPose(ligand, [], { reference: eReference }).checks.find((check) => check.id === 'double-bond-stereo');
  assert.equal(doubleBond(trans).passed, true);
  assert.equal(doubleBond(butene(true)).passed, false);
});

test('a residue of a model: dictionary chemistry, PoseBusters\' environment classes, covalent partners', () => {
  const structure = deriveStructure(parseStructure(exampleText('1m17'), '1m17.cif'));
  const model = structure.models[0];
  applyChemistry(model, structure);
  const residue = model.residues.find((item) => item.resName === 'AQ4');
  const pose = residuePose(model, residue, structure.components.get('AQ4'));
  assert.equal(pose.typed, true);
  assert.equal(pose.ligand.atoms.length, 29);
  assert.equal(pose.ligand.bonds.length, 31);
  const classes = new Set(pose.environment.map((atom) => atom.contact));
  assert.ok(classes.has('protein') && classes.has('water'));
  const result = checkPose(pose.ligand, pose.environment, { bondedKeys: pose.bondedKeys });
  assert.deepEqual(result.failed, []);
  // Without its chemistry, only the contacts are checked.
  assert.equal(residuePose(model, residue, null).ligand.bonds, null);
  // The file's definition has no coordinates; a dictionary entry of the same molecule does, and an
  // unrelated one is refused.
  assert.equal(componentReference(structure.components.get('AQ4'), pose.ligand), null);
  const imatinib = { id: 'STI', atoms: new Map(fixtures.STI.atoms.map(([name, element, , , x, y, z]) => [name, { element, x, y, z, stereo: '' }])), bonds: new Map() };
  assert.equal(componentReference(imatinib, pose.ligand), null);
});

test('a glycan\'s asparagine: the linked atom and its neighbor are no contacts', () => {
  const structure = deriveStructure(parseStructure(exampleText('1n8z'), '1n8z.cif'));
  const model = structure.models[0];
  applyChemistry(model, structure);
  const residue = model.residueMap.get('C:738:NAG');
  const pose = residuePose(model, residue, structure.components.get('NAG'));
  assert.deepEqual([...pose.bondedKeys].map((key) => model.atoms[key].name).sort(), ['CG', 'ND2']);
  // CG is an angle away from C1 (2.3 Å, 0.68 of the radii).
  assert.deepEqual(checkPose(pose.ligand, pose.environment, { bondedKeys: pose.bondedKeys }).failed, []);
  assert.deepEqual(checkPose(pose.ligand, pose.environment, { bondedKeys: new Set([...pose.bondedKeys].filter((key) => model.atoms[key].name === 'ND2')) }).failed, ['protein-distance']);
});

test('a definition that lists bonds only (as OpenFold3 writes) still types the ligand', () => {
  // The 1M17 file without its _chem_comp_atom loop: the bond table alone remains.
  const lines = exampleText('1m17').split('\n');
  const start = lines.findIndex((line) => line.startsWith('_chem_comp_atom.')) - 1;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('#'));
  const structure = deriveStructure(parseStructure([...lines.slice(0, start), ...lines.slice(end)].join('\n'), '1m17.cif'));
  const model = structure.models[0];
  const residue = model.residues.find((item) => item.resName === 'AQ4');
  assert.equal(residue.chemistry, 'file');
  assert.equal(model.bonds.filter((bond) => model.atomResidue[bond.a] === residue.index && bond.order === 2).length, 8);
  const pose = residuePose(model, residue, residue.component);
  // The same bond orders as with the complete definition.
  const complete = deriveStructure(parseStructure(exampleText('1m17'), '1m17.cif')).models[0];
  const full = complete.residues.find((item) => item.resName === 'AQ4');
  const orders = (ligand) => ligand.bonds.map((bond) => `${ligand.atoms[bond.a].name}-${ligand.atoms[bond.b].name}:${bond.order}`).sort();
  assert.deepEqual(orders(pose.ligand), orders(residuePose(complete, full, full.component).ligand));
  const result = checkPose(pose.ligand, pose.environment, { bondedKeys: pose.bondedKeys });
  assert.deepEqual(result.failed, []);
  assert.equal(result.checked, 17);
});

test('contact classes follow PoseBusters: metals and halides by element, waters, polymer and hetero records', () => {
  assert.equal(contactClass({ element: 'ZN', resName: 'ZN', hetero: true }), 'inorganic');
  assert.equal(contactClass({ element: 'O', resName: 'SO4', hetero: true }), 'inorganic');
  assert.equal(contactClass({ element: 'CL', resName: 'LIG', hetero: true }), 'inorganic');
  assert.equal(contactClass({ element: 'O', resName: 'HOH', hetero: true, water: true }), 'water');
  assert.equal(contactClass({ element: 'N', resName: 'ALA', hetero: false }), 'protein');
  assert.equal(contactClass({ element: 'C', resName: 'NAD', hetero: true }), 'organic');
  assert.equal(contactClass({ element: 'H', resName: 'ALA', hetero: false }), 'hydrogen');
});

test('dictionary entries keep ideal coordinates and R/S and E/Z labels', () => {
  const text = `data_TST
loop_
_chem_comp_atom.comp_id
_chem_comp_atom.atom_id
_chem_comp_atom.type_symbol
_chem_comp_atom.charge
_chem_comp_atom.pdbx_stereo_config
_chem_comp_atom.model_Cartn_x
_chem_comp_atom.model_Cartn_y
_chem_comp_atom.model_Cartn_z
_chem_comp_atom.pdbx_model_Cartn_x_ideal
_chem_comp_atom.pdbx_model_Cartn_y_ideal
_chem_comp_atom.pdbx_model_Cartn_z_ideal
TST C1 C 0 R 9.0 9.0 9.0 0.100 0.200 0.300
TST C2 C 0 N 9.0 9.0 9.0 ? ? ?
loop_
_chem_comp_bond.comp_id
_chem_comp_bond.atom_id_1
_chem_comp_bond.atom_id_2
_chem_comp_bond.value_order
_chem_comp_bond.pdbx_stereo_config
TST C1 C2 DOUB E
`;
  const component = readChemComp(parseCIFDocument(text)).get('TST');
  assert.deepEqual([component.atoms.get('C1').x, component.atoms.get('C1').y, component.atoms.get('C1').z, component.atoms.get('C1').stereo], [0.1, 0.2, 0.3, 'R']);
  assert.deepEqual([component.atoms.get('C2').x, component.atoms.get('C2').stereo], [9, 'N'], 'model coordinates when the ideal ones are missing');
  assert.equal(component.bonds.get('C1|C2').stereo, 'E');
});
