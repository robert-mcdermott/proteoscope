import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStructure } from './parse.js';
import { deriveStructure } from './structure.js';
import { heavyAtomFor, mapValidation, summarizeEntry, validationLevel } from './validation.js';
import { MISSENSE_THRESHOLDS, missenseClass, parseAlphaMissense, rankedSubstitutions } from './missense.js';

const PDB = [
  'ATOM      1  N   LEU A  10      11.104   6.134  -6.504  1.00 20.00           N',
  'ATOM      2  CA  LEU A  10      11.639   6.071  -5.147  1.00 20.00           C',
  'ATOM      3  CD1 LEU A  10      12.000   7.000  -4.000  1.00 20.00           C',
  'ATOM      4  N   SER A  11A     12.104   7.134  -6.504  1.00 20.00           N',
  'ATOM      5  CA  SER A  11A     12.639   7.071  -5.147  1.00 20.00           C',
  'ATOM      6  OG  SER A  11A     13.500   8.500  -4.500  1.00 20.00           O',
  'HETATM    7 FE   HEM A 201      15.000   9.000  -3.000  1.00 20.00          FE',
  'END',
].join('\n');

function model() {
  const structure = parseStructure(PDB, 'test.pdb');
  deriveStructure(structure);
  return structure.models[0];
}

// The server's reduced report (see validation.go).
const REPORT = {
  id: '1ABC',
  entry: { clashscore: '7.42', 'absolute-percentile-clashscore': '61.3', 'percent-RSRZ-outliers': '1.20', 'PDB-resolution': '2.10' },
  residues: [
    { model: 1, chain: 'A', resnum: 10, resname: 'LEU', rama: 'Favored', values: { rsrz: 0.41, rscc: 0.95 }, outliers: { clash: 1 } },
    { model: 1, chain: 'A', resnum: 11, icode: 'A', resname: 'SER', rama: 'OUTLIER', rota: 'OUTLIER', values: { rsrz: 2.6 }, outliers: { clash: 1, 'bond-outlier': 1, 'angle-outlier': 2 } },
    { model: 1, chain: 'A', resnum: 201, resname: 'HEM', values: { ligRSRZ: 0.8, rscc: 0.88 }, outliers: { 'mog-angle-outlier': 1 } },
    { model: 1, chain: 'B', resnum: 5, resname: 'GLY' },
  ],
  clashes: [{ a: { model: 1, chain: 'A', resnum: 10, resname: 'LEU', atom: 'CD1' }, b: { model: 1, chain: 'A', resnum: 11, icode: 'A', resname: 'SER', atom: 'OG' }, overlap: 0.52, distance: 2.88 }],
};

test('validation reports map onto residues, insertion codes and ligands included', () => {
  const mapped = mapValidation(REPORT, model());
  assert.equal(mapped.unmatched, 1, 'chain B is not in the model');
  const leu = mapped.residues.get('A:10:LEU');
  const ser = mapped.residues.get('A:11A:SER');
  const heme = mapped.residues.get('A:201:HEM');
  assert.deepEqual(leu.criteria, ['1 clash']);
  assert.deepEqual(ser.criteria, ['1 clash', '3 geometry outliers', 'Ramachandran outlier', 'Rotamer outlier', 'RSRZ 2.6']);
  assert.equal(validationLevel(ser), 3);
  assert.equal(validationLevel(leu), 1);
  assert.equal(validationLevel(undefined), -1);
  assert.equal(heme.rsrz, 0.8);
  assert.deepEqual(heme.criteria, ['1 ligand geometry outlier']);
  assert.deepEqual([...mapped.outlierKeys].sort(), ['A:10:LEU', 'A:11A:SER', 'A:201:HEM']);
  assert.equal(mapped.clashes.length, 1);
  assert.equal(mapped.clashes[0].atomA.name, 'CD1');
  assert.equal(mapped.clashes[0].atomB.name, 'OG');
  // Hydrogens are drawn from their heavy atoms, in residues and in ligands.
  const leu10 = model().residueMap.get('A:10:LEU');
  assert.equal(heavyAtomFor(leu10, 'HD12').name, 'CD1');
  assert.equal(heavyAtomFor(leu10, 'H').name, 'N');
  assert.equal(heavyAtomFor(leu10, 'HA').name, 'CA');
  const ligand = { atoms: ['C1', 'C12', 'N3', "C5'"].map((name) => ({ name })) };
  assert.equal(heavyAtomFor(ligand, 'H12').name, 'C12');
  assert.equal(heavyAtomFor(ligand, 'H121').name, 'C12');
  assert.equal(heavyAtomFor(ligand, 'HN3').name, 'N3');
  assert.equal(heavyAtomFor(ligand, "H5''").name, "C5'");
  assert.equal(heavyAtomFor(ligand, 'H99'), null);
  const summary = summarizeEntry(REPORT.entry);
  assert.equal(summary.resolution, 2.1);
  assert.deepEqual(summary.metrics.map((metric) => [metric.label, metric.value, metric.absolute]), [['Clashscore', 7.42, 61.3], ['RSRZ outliers', 1.2, NaN]]);
});

test('AlphaMissense tables become per-position means with ranked substitutions', () => {
  const csv = ['protein_variant,am_pathogenicity,am_class', 'M1A,0.10,LBen', 'M1C,0.30,LBen', 'R2H,0.95,LPath', 'R2K,0.40,Amb', 'not,a,row'].join('\n');
  const parsed = parseAlphaMissense(csv);
  assert.equal(parsed.variants, 4);
  const first = parsed.positions.get(1);
  assert.equal(first.wt, 'M');
  assert.ok(Math.abs(first.mean - 0.2) < 1e-12);
  assert.deepEqual(rankedSubstitutions(parsed.positions.get(2)).map((item) => [item.aa, item.label]), [['H', 'likely pathogenic'], ['K', 'ambiguous']]);
  assert.equal(missenseClass(MISSENSE_THRESHOLDS.benign - 0.01), 'likely benign');
  assert.equal(missenseClass(0.5), 'ambiguous');
  assert.equal(parseAlphaMissense('variant_id,score\n'), null);
});

test('Top8000 Ramachandran classes follow MolProbity categories and cutoffs', async () => {
  const { classifyRamachandran, loadTop8000, ramaCategory, ramaClass, ramaDensity } = await import('./ramachandran.js');
  const tables = await loadTop8000();
  // The general-case α-helix peak and a left-handed region that only glycine favors.
  assert.ok(ramaDensity(tables.general, -63, -43) > 0.9);
  assert.equal(ramaClass(ramaDensity(tables.general, -63, -43), 'general'), 'Favored');
  assert.equal(ramaClass(ramaDensity(tables.general, 60, -120), 'general'), 'Allowed');
  assert.equal(ramaClass(ramaDensity(tables.general, 80, -170), 'general'), 'OUTLIER');
  assert.equal(ramaClass(ramaDensity(tables.glycine, 80, -170), 'glycine'), 'Favored');
  // Bins wrap at ±180°.
  assert.ok(Math.abs(ramaDensity(tables.general, -180, 150) - ramaDensity(tables.general, 180, 150)) < 1e-9);
  assert.equal(ramaClass(0.001, 'general'), 'Allowed');
  assert.equal(ramaClass(0.001, 'cisPro'), 'OUTLIER');
  assert.equal(ramaCategory({ parent: 'PRO', omega: 5 }), 'cisPro');
  assert.equal(ramaCategory({ parent: 'PRO', omega: 179 }), 'transPro');
  assert.equal(ramaCategory({ parent: 'ALA', beforeProline: true }), 'prePro');
  assert.equal(ramaCategory({ parent: 'GLY', beforeProline: true }), 'glycine');
  assert.equal(ramaCategory({ parent: 'VAL' }), 'ileVal');
  const classes = classifyRamachandran(tables, [
    { key: 'a', kind: 'protein', parent: 'ALA', phi: -63, psi: -43 },
    { key: 'b', kind: 'protein', parent: 'ALA', phi: 120, psi: -120 },
    { key: 'c', kind: 'protein', parent: 'ALA', phi: NaN, psi: 100 },
  ]);
  assert.deepEqual([...classes].map(([key, item]) => [key, item.rama]), [['a', 'Favored'], ['b', 'OUTLIER']]);
});
