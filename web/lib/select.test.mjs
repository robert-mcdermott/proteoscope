import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parsePDB } from './parse.js';
import { deriveStructure, prepareAssemblyEstimates } from './structure.js';
import { SelectionError, countMask, looksLikeSelection, parseSelection, residueKeysFromMask, selectAtoms } from './select.js';

const DATA_DIR = new URL('../../data/', import.meta.url);

function derive(structure) {
  structure.baseModels = structure.models;
  prepareAssemblyEstimates(structure);
  deriveStructure(structure);
  return structure;
}

async function target(name, id = 1, context = {}) {
  const structure = derive(parsePDB(await readFile(new URL(name, DATA_DIR), 'utf8'), name));
  return { id, index: id, name: structure.meta.code || name, model: structure.models[0], structure, context };
}

function atomLine(serial, name, resName, chain, resSeq, iCode, x, element = 'C') {
  return `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} ${resName} ${chain}${String(resSeq).padStart(4)}${iCode}   ${x.toFixed(3).padStart(8)}${(0).toFixed(3).padStart(8)}${(0).toFixed(3).padStart(8)}  1.00 20.00          ${element.padStart(2)}`;
}

function keysOf(result, t) {
  return residueKeysFromMask(t.model, result.get(t.id));
}

test('parser handles keywords, Boolean operators, parentheses and implicit AND', () => {
  assert.deepEqual(parseSelection('chain A and resi 40-80'), {
    type: 'and',
    left: { type: 'list', key: 'chain', values: [{ exact: 'A' }] },
    right: { type: 'list', key: 'resi', values: [{ from: 40, to: 80, iCode: null, exactCode: false }] },
  });
  assert.equal(parseSelection('chain A resi 5').type, 'and');
  assert.equal(parseSelection('!water & (protein | ligand)').type, 'and');
  assert.equal(parseSelection('not water').type, 'not');
  assert.deepEqual(parseSelection('within 5 of resn STI').distance, 5);
  assert.equal(parseSelection('byres around 4.5 of ligand').type, 'byres');
  assert.deepEqual(parseSelection('b>=60'), { type: 'compare', key: 'b', operator: '>=', value: 60 });
});

test('parser errors point at the problem', () => {
  assert.throws(() => parseSelection('chain'), SelectionError);
  assert.throws(() => parseSelection('frobnicate A'), /Unknown selection keyword "frobnicate"/);
  assert.throws(() => parseSelection('resn ALA GLY'), /Unknown selection keyword "GLY"/);
  assert.throws(() => parseSelection('within of ligand'), /needs a distance/);
  assert.throws(() => parseSelection('(chain A'), /Missing "\)"/);
  assert.throws(() => parseSelection('b 50'), /needs a comparison/);
  try {
    parseSelection('chain A and frob');
  } catch (error) {
    assert.equal(error.position, 12);
  }
});

test('chains, residues, names and elements select the expected atoms in hemoglobin', async () => {
  const hb = await target('4hhb.pdb');
  const atoms = hb.model.atoms;
  const count = (text) => countMask(selectAtoms(text, [hb]).get(hb.id));

  assert.equal(count('chain A'), atoms.filter((atom) => atom.chain === 'A').length);
  assert.equal(count('chain A+C and protein'), atoms.filter((atom) => (atom.chain === 'A' || atom.chain === 'C') && atom.kind === 'protein').length);
  assert.equal(keysOf(selectAtoms('resn HEM', [hb]), hb).size, 4);
  assert.equal(count('elem FE'), 4);
  assert.equal(count(':HEM'), count('resn HEM'));

  const ca = selectAtoms('/A:1-10@CA', [hb]).get(hb.id);
  const picked = atoms.filter((atom, index) => ca[index]);
  assert.equal(picked.length, 10);
  assert.ok(picked.every((atom) => atom.name === 'CA' && atom.chain === 'A' && atom.resSeq >= 1 && atom.resSeq <= 10));

  const backbone = atoms.filter((atom, index) => selectAtoms('backbone and chain A and resi 1', [hb]).get(hb.id)[index]).map((atom) => atom.name).sort();
  assert.deepEqual(backbone, ['C', 'CA', 'N', 'O']);
  const sidechain = atoms.filter((atom, index) => selectAtoms('sidechain and /A:1', [hb]).get(hb.id)[index]).map((atom) => atom.name).sort();
  assert.deepEqual(sidechain, ['CB', 'CG1', 'CG2']);

  assert.equal(count('b > 60'), atoms.filter((atom) => atom.bFactor > 60).length);
  assert.equal(count('name C*'), atoms.filter((atom) => atom.name.startsWith('C')).length);
  const helixResidues = hb.model.residues.filter((residue) => residue.chain === 'A' && residue.kind === 'protein' && residue.ss === 'helix').length;
  assert.equal(keysOf(selectAtoms('helix and chain A', [hb]), hb).size, helixResidues);
  assert.equal(count('not all'), 0);
  assert.equal(count('water or not water'), atoms.length);
});

test('distance and expansion operators find the heme pocket', async () => {
  const hb = await target('4hhb.pdb');
  const pocket = keysOf(selectAtoms('byres (within 3 of (chain A and resn HEM)) and protein', [hb]), hb);
  assert.ok(pocket.has('A:87:HIS'), 'proximal histidine His87 (F8) of the alpha chain');
  const around = selectAtoms('around 3 of resn HEM', [hb]).get(hb.id);
  assert.ok(hb.model.atoms.every((atom, index) => !(around[index] && atom.resName === 'HEM')), 'around excludes the reference atoms');
  const within = selectAtoms('within 3 of resn HEM', [hb]).get(hb.id);
  assert.ok(countMask(within) > countMask(around));
  const bychain = keysOf(selectAtoms('bychain resn HEM and chain B', [hb]), hb);
  assert.ok([...bychain].every((key) => key.startsWith('B:')) && bychain.size > 140);
});

test('structure specs and distances work across several structures', async () => {
  const first = await target('4hhb.pdb', 1);
  const second = await target('4hhb.pdb', 2);
  const both = [first, second];
  const onlySecond = selectAtoms('#2 and resn HEM', both);
  assert.equal(countMask(onlySecond.get(1)), 0);
  assert.equal(keysOf(onlySecond, second).size, 4);
  const named = selectAtoms('structure 4HHB and elem FE', both);
  assert.equal(countMask(named.get(1)) + countMask(named.get(2)), 8);
  // The copies are identical, so atoms of #2 lie within 0.1 Å of the heme of #1.
  const near = selectAtoms('within 0.1 of (#1 and resn HEM)', both);
  assert.equal(keysOf(near, second).size, 4);
});

test('insertion codes follow PDB conventions', () => {
  const lines = [
    atomLine(1, 'CA', 'GLY', 'H', 99, ' ', 0),
    atomLine(2, 'CA', 'ALA', 'H', 100, ' ', 3.8),
    atomLine(3, 'CA', 'SER', 'H', 100, 'A', 7.6),
    atomLine(4, 'CA', 'THR', 'H', 100, 'B', 11.4),
    atomLine(5, 'CA', 'LEU', 'H', 101, ' ', 15.2),
  ];
  const structure = derive(parsePDB(lines.join('\n'), 'icode.pdb'));
  const t = { id: 1, index: 1, name: 'icode', model: structure.models[0], structure };
  const names = (text) => t.model.atoms.filter((atom, index) => selectAtoms(text, [t]).get(1)[index]).map((atom) => atom.resName);
  assert.deepEqual(names('resi 100'), ['ALA']);
  assert.deepEqual(names('resi 100A'), ['SER']);
  assert.deepEqual(names('resi 100a+100B'), ['SER', 'THR']);
  assert.deepEqual(names('resi 99-101'), ['GLY', 'ALA', 'SER', 'THR', 'LEU']);
  assert.deepEqual(names('/H:100B'), ['THR']);
});

test('context sets and per-residue values drive selections', async () => {
  const hb = await target('4hhb.pdb', 1, {
    selected: new Set(['A:12:ALA', 'A:14:TRP']),
    values: { deviation: new Map([['A:12:ALA', 3.5], ['A:14:TRP', 0.4]]) },
    uniprot: (residue) => (residue.chain === 'A' ? residue.resSeq + 1 : null),
  });
  assert.deepEqual([...keysOf(selectAtoms('sele', [hb]), hb)].sort(), ['A:12:ALA', 'A:14:TRP']);
  assert.deepEqual([...keysOf(selectAtoms('deviation > 2', [hb]), hb)], ['A:12:ALA']);
  assert.deepEqual([...keysOf(selectAtoms('uniprot 11', [hb]), hb)], ['A:10:VAL']);
});

test('search text is recognized as a selection only when it starts like one', () => {
  assert.equal(looksLikeSelection('chain A and resi 40'), true);
  assert.equal(looksLikeSelection('/A:315'), true);
  assert.equal(looksLikeSelection('within 5 of ligand'), true);
  assert.equal(looksLikeSelection('STI'), false);
  assert.equal(looksLikeSelection('HIS 87'), false);
});
