import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChemistry, bondDecorations, componentFor, implicitHydrogens } from './chemistry.js';
import { ligandChemistry } from './interactions.js';
import { parseCIFDocument, parseStructure, readChemComp } from './parse.js';
import { deriveStructure } from './structure.js';
import { examplePDB, exampleText } from './test-data.mjs';

const derive = (text, name) => deriveStructure(parseStructure(text, name));
const residueBonds = (model, residue) => {
  const ids = new Set(residue.atoms.map((atom) => atom.id));
  return model.bonds.filter((bond) => ids.has(bond.a) && ids.has(bond.b));
};
const byName = (residue, name) => residue.atoms.find((atom) => atom.name === name);

// Acetamide with explicit hydrogens, one of them a leaving atom.
const ACETAMIDE = `data_ACM
loop_
_chem_comp_atom.comp_id
_chem_comp_atom.atom_id
_chem_comp_atom.type_symbol
_chem_comp_atom.charge
_chem_comp_atom.pdbx_aromatic_flag
_chem_comp_atom.pdbx_leaving_atom_flag
ACM C1  C 0 N N
ACM O   O 0 N N
ACM N   N 0 N N
ACM C2  C 0 N N
ACM HN1 H 0 N N
ACM HN2 H 0 N Y
ACM H21 H 0 N N
loop_
_chem_comp_bond.comp_id
_chem_comp_bond.atom_id_1
_chem_comp_bond.atom_id_2
_chem_comp_bond.value_order
_chem_comp_bond.pdbx_aromatic_flag
ACM C1 O   DOUB N
ACM C1 N   SING N
ACM C1 C2  SING N
ACM N  HN1 SING N
ACM N  HN2 SING N
ACM C2 H21 SING N
`;

test('component definitions give bond orders, charges and the hydrogens of heavy atoms', () => {
  const component = readChemComp(parseCIFDocument(ACETAMIDE)).get('ACM');
  assert.equal(component.bonds.get('C1|O').order, 2);
  assert.equal(component.bonds.get('C1|N').order, 1);
  assert.equal(component.atoms.get('N').hydrogens, 1, 'the leaving hydrogen does not count');
  assert.equal(component.atoms.get('C2').hydrogens, 1);
  assert.equal(component.atoms.get('O').charge, 0);
  const phe = componentFor('PHE', new Map());
  assert.equal(phe.source, 'standard');
  assert.ok(phe.bonds.get('CD1|CG').aromatic);
  assert.equal(componentFor('ARG').bonds.get('CZ|NH2').order, 2);
  assert.equal(componentFor('HOH'), null);
});

test('1M17: erlotinib takes its bond orders from the file (a triple bond, two aromatic rings)', () => {
  const structure = derive(exampleText('1m17'), '1m17.cif');
  const model = structure.models[0];
  const erlotinib = model.residues.find((residue) => residue.resName === 'AQ4');
  assert.equal(erlotinib.chemistry, 'file');
  const bonds = residueBonds(model, erlotinib);
  assert.equal(bonds.filter((bond) => bond.order === 3).length, 1);
  assert.equal(bonds.filter((bond) => bond.aromatic).length, 17);
  assert.ok(byName(erlotinib, 'C18').aromatic);
  assert.equal(model.missingComponents.size, 0);
  const phenylalanine = model.residues.find((residue) => residue.resName === 'PHE');
  assert.ok(residueBonds(model, phenylalanine).some((bond) => bond.aromatic));
  const peptide = model.bonds.find((bond) => model.atomResidue[bond.a] !== model.atomResidue[bond.b] && bond.kind === 'covalent');
  assert.equal(peptide.order, 1);
});

test('PDB files lack component definitions until a dictionary entry supplies one', () => {
  const structure = derive(examplePDB('1m17'), '1m17.pdb');
  const model = structure.models[0];
  assert.ok(model.missingComponents.has('AQ4'));
  const erlotinib = model.residues.find((residue) => residue.resName === 'AQ4');
  assert.equal(erlotinib.chemistry, '');
  assert.ok(residueBonds(model, erlotinib).every((bond) => bond.order === 1 && !bond.aromatic));

  // The file's own definition, as the CCD would send it.
  const component = readChemComp(parseCIFDocument(exampleText('1m17'))).get('AQ4');
  component.source = 'ccd';
  structure.components.set('AQ4', component);
  const before = model.chemistryVersion;
  applyChemistry(model, structure);
  assert.equal(model.chemistryVersion, before + 1);
  assert.equal(erlotinib.chemistry, 'ccd');
  assert.equal(residueBonds(model, erlotinib).filter((bond) => bond.order === 3).length, 1);

  // A fetched entry whose atom names do not match (a docking program's "LIG") is not applied.
  const impostor = { ...component, atoms: new Map([...component.atoms].map(([name, atom]) => [`X${name}`, atom])) };
  structure.components.set('AQ4', impostor);
  applyChemistry(model, structure);
  assert.equal(erlotinib.chemistry, '');

  // Nor is one with the same atom names but other bonds (generic names C1, N1… match many entries).
  const [first] = residueBonds(model, erlotinib).filter((bond) => !model.atoms[bond.a].isHydrogen && !model.atoms[bond.b].isHydrogen);
  const names = [model.atoms[first.a].name, model.atoms[first.b].name].sort();
  const rewired = { ...component, bonds: new Map([...component.bonds].filter(([key]) => key !== names.join('|'))) };
  structure.components.set('AQ4', rewired);
  applyChemistry(model, structure);
  assert.equal(erlotinib.chemistry, '');
});

test('old atom names match dictionary entries that still use them (O1P in PLP-like components)', () => {
  const atom = (serial, name, element, x, y, z) => `HETATM${String(serial).padStart(5)} ${name.padEnd(4)} PLX A   1    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00          ${element.padStart(2)}`;
  const text = [atom(1, 'P', 'P', 0, 0, 0), atom(2, 'O1P', 'O', 1.49, 0, 0), atom(3, 'O2P', 'O', -0.5, 1.4, 0), atom(4, 'O3P', 'O', -0.5, -0.7, 1.2), atom(5, 'O4P', 'O', -0.5, -0.7, -1.2), 'END'].join('\n');
  const structure = derive(text, 'plx.pdb');
  const model = structure.models[0];
  const record = (element, charge = null) => ({ element, charge, aromatic: false, leaving: false, hydrogens: 0 });
  structure.components.set('PLX', {
    id: 'PLX', source: 'ccd',
    atoms: new Map([['P', record('P')], ['O1P', record('O')], ['O2P', record('O', -1)], ['O3P', record('O', -1)], ['O4P', record('O')]]),
    bonds: new Map([['O1P|P', { order: 2, aromatic: false }], ['O2P|P', { order: 1, aromatic: false }], ['O3P|P', { order: 1, aromatic: false }], ['O4P|P', { order: 1, aromatic: false }]]),
  });
  applyChemistry(model, structure);
  assert.equal(model.residues[0].chemistry, 'ccd');
  const double = model.bonds.find((bond) => bond.order === 2);
  assert.deepEqual([model.atoms[double.a].name, model.atoms[double.b].name].sort(), ['O1P', 'P']);
});

test('CONECT orders are counted per MODEL (multi-pose files restart their serials)', () => {
  const atom = (serial, name, element, x) => `HETATM${String(serial).padStart(5)} ${name.padEnd(4)} LIG A   1    ${x.toFixed(3).padStart(8)}   0.000   0.000  1.00  0.00          ${element.padStart(2)}`;
  const pose = (number) => [`MODEL     ${number}`, atom(1, 'C1', 'C', 0), atom(2, 'C2', 'C', 1.52), atom(3, 'O1', 'O', 2.95), 'CONECT    1    2', 'CONECT    2    1    3', 'CONECT    3    2', 'ENDMDL'];
  const model = derive([...pose(1), ...pose(2), 'END'].join('\n'), 'poses.pdb').models[0];
  assert.ok(model.bonds.every((bond) => bond.order === 1), 'ethanol stays single-bonded with two models');
});

test('dictionary hydrogens give way to bonds to other residues (6VXX glycans)', () => {
  const model = derive(exampleText('6vxx'), '6vxx.cif').models[0];
  const residueOf = model.atomResidue;
  let linked = 0;
  let free = 0;
  for (const residue of model.residues) {
    if (residue.resName !== 'NAG') continue;
    const o4 = byName(residue, 'O4');
    if (!o4) continue;
    const external = model.bonds.some((bond) => (bond.a === o4.id || bond.b === o4.id) && residueOf[bond.a] !== residueOf[bond.b]);
    if (external) {
      assert.equal(o4.hydrogens, 0, `${residue.key} O4 is a glycosidic oxygen`);
      linked += 1;
    } else {
      assert.equal(o4.hydrogens, 1, `${residue.key} O4 is a hydroxyl`);
      free += 1;
    }
  }
  assert.ok(linked > 5 && free > 5, `${linked} linked and ${free} free NAG O4`);
});

test('repeated CONECT partners are double bonds', () => {
  const atom = (serial, name, element, x, y, z) => `HETATM${String(serial).padStart(5)} ${name.padEnd(4)} LIG A   1    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00          ${element.padStart(2)}`;
  const text = [
    atom(1, 'C1', 'C', 0, 0, 0), atom(2, 'O1', 'O', 1.23, 0, 0), atom(3, 'C2', 'C', -0.75, 1.3, 0),
    'CONECT    1    2    2    3', 'CONECT    2    1    1', 'CONECT    3    1', 'END',
  ].join('\n');
  const model = derive(text, 'lig.pdb').models[0];
  const orders = Object.fromEntries(model.bonds.map((bond) => [`${model.atoms[bond.a].name}-${model.atoms[bond.b].name}`, bond.order]));
  assert.deepEqual(orders, { 'C1-O1': 2, 'C1-C2': 1 });
});

test('aromatic atoms keep their lowest valence', () => {
  // 1-methylimidazole N1 (two aromatic bonds and a methyl), thiophene S, and a pyridine-like N.
  assert.equal(implicitHydrogens('N', 4, 0, true), 0);
  assert.equal(implicitHydrogens('S', 3, 0, true), 0);
  assert.equal(implicitHydrogens('N', 3, 0, true), 0);
  // A non-aromatic nitrogen with two single bonds still gets its hydrogen.
  assert.equal(implicitHydrogens('N', 2, 0, false), 1);
});

test('implicit hydrogens follow standard valences and formal charges', () => {
  assert.equal(implicitHydrogens('C', 4), 0);
  assert.equal(implicitHydrogens('C', 1), 3);
  assert.equal(implicitHydrogens('N', 1), 2, 'amide NH2');
  assert.equal(implicitHydrogens('N', 1, 1), 3, 'ammonium');
  assert.equal(implicitHydrogens('O', 1, -1), 0, 'carboxylate oxygen');
  assert.equal(implicitHydrogens('C', 3, 0, true), 1, 'aromatic CH');
  assert.equal(implicitHydrogens('S', 4), 0, 'sulfoxide');
  assert.equal(implicitHydrogens('CL', 1), 0);
});

test('ring double bonds are offset toward the ring center, others in the substituent plane', () => {
  const model = derive(exampleText('1m17'), '1m17.cif').models[0];
  const erlotinib = model.residues.find((residue) => residue.resName === 'AQ4');
  const ids = new Set(erlotinib.atoms.map((atom) => atom.id));
  const decorations = bondDecorations(model).filter((item) => ids.has(model.bonds[item.index].a));
  const ring = decorations.find((item) => item.ring);
  const bond = model.bonds[ring.index];
  const a = model.atoms[bond.a];
  const b = model.atoms[bond.b];
  const axis = [b.x - a.x, b.y - a.y, b.z - a.z];
  assert.ok(Math.abs(axis[0] * ring.direction[0] + axis[1] * ring.direction[1] + axis[2] * ring.direction[2]) < 1e-6);
  assert.ok(Math.abs(Math.hypot(...ring.direction) - 1) < 1e-9);
  assert.ok(decorations.some((item) => !item.ring), 'the ethynyl triple bond is not in a ring');
  assert.equal(bondDecorations(model), bondDecorations(model), 'cached');
});

test('2HYY: only the N-methyl nitrogen of imatinib’s piperazine is protonated', () => {
  const model = derive(exampleText('2hyy'), '2hyy.cif').models[0];
  const imatinib = model.residues.find((residue) => residue.resName === 'STI');
  const chemistry = ligandChemistry(model, imatinib.atoms.map((atom) => atom.id));
  const cations = chemistry.charges.filter((group) => group.sign > 0);
  assert.equal(cations.length, 1);
  assert.equal(model.atoms[cations[0].atoms[0]].name, 'N51');
  // The amide nitrogen donates and does not accept; the pyridine and pyrimidine nitrogens accept.
  const amide = byName(imatinib, 'N13').id;
  assert.ok(chemistry.donors.includes(amide) && !chemistry.acceptors.includes(amide));
  assert.ok(chemistry.acceptors.includes(byName(imatinib, 'N3').id));
  assert.equal(chemistry.aromaticRings.length, 4);
});

test('4HHB: both heme propionates are carboxylates; the porphyrin keeps its aromatic pyrroles', () => {
  const model = derive(exampleText('4hhb'), '4hhb.cif').models[0];
  const heme = model.residues.find((residue) => residue.resName === 'HEM');
  const chemistry = ligandChemistry(model, heme.atoms.map((atom) => atom.id));
  assert.equal(chemistry.charges.filter((group) => group.label === 'carboxylate').length, 2);
  assert.ok(chemistry.aromaticRings.length >= 4);
});
