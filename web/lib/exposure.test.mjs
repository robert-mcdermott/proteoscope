import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { parseStructure } from './parse.js';
import { deriveStructure } from './structure.js';
import { IDR_THRESHOLD, exposurePoints, neighborCounts, partSphereExposure, smoothScore } from './exposure.js';
import { exampleText } from './test-data.mjs';

function p53Residues() {
  const structure = parseStructure(exampleText('af-p04637-f1-model_v6'), 'AF-P04637-F1.cif');
  structure.baseModels = structure.models;
  deriveStructure(structure);
  const atom = (residue, name) => residue.atoms.find((item) => item.name === name) ?? null;
  return structure.models[0].residues.filter((residue) => residue.kind === 'protein').map((residue) => ({
    key: residue.key, chain: residue.chain, resSeq: residue.resSeq, ca: atom(residue, 'CA'), cb: atom(residue, 'CB'), n: atom(residue, 'N'), c: atom(residue, 'C'),
  }));
}

test('StructureMap smoothing is a centered mean clipped at the ends', () => {
  assert.deepEqual([...smoothScore([1, 2, 3, 4, 5], 1)], [1.5, 2, 3, 4, 4.5]);
});

// Reference: Biopython HSExposureCB(radius 12) on the same model, EXP_HSE_B_U.
test('12 Å, 90° neighbor counts equal half-sphere exposure (HSE-Cβ up), glycine included', () => {
  const residues = p53Residues();
  const points = exposurePoints(residues);
  const counts = neighborCounts(points, { radius: 12, angle: 90 });
  const byNumber = new Map(points.map((point, index) => [Number(point.key.split(':')[1]), counts[index]]));
  const expected = { 1: 0, 2: 2, 20: 2, 100: 13, 102: 6, 150: 6, 175: 18, 220: 21, 248: 0, 273: 20, 300: 1, 330: 7, 350: 5, 393: 0 };
  for (const [number, value] of Object.entries(expected)) assert.equal(byNumber.get(Number(number)), value, `residue ${number}`);
  assert.equal([...counts].reduce((sum, value) => sum + value, 0), 2970);
});

test('pPSE with the AlphaFold PAE marks p53\'s termini disordered and its DNA-binding domain folded', () => {
  const residues = p53Residues();
  const json = JSON.parse(gunzipSync(readFileSync(new URL('../../data/AF-P04637-F1-predicted_aligned_error_v6.json.gz', import.meta.url))).toString('utf8'));
  const matrix = json[0].predicted_aligned_error;
  const size = matrix.length;
  const pae = { size, matrix: Float32Array.from(matrix.flat()), index: new Map(residues.map((residue, index) => [residue.key, index])) };
  const result = partSphereExposure(residues, { pae });
  const at = (number) => result.get(residues.find((residue) => residue.resSeq === number).key);
  for (const number of [10, 40, 70, 380, 390]) assert.equal(at(number).idr, true, `residue ${number} is in a disordered terminus`);
  for (const number of [120, 175, 220, 248, 273]) assert.equal(at(number).idr, false, `residue ${number} is in the DNA-binding domain`);
  assert.ok(at(175).smooth > IDR_THRESHOLD);
  // Without PAE, the disordered termini of a single model look more buried than they are.
  const plain = partSphereExposure(residues);
  assert.ok(plain.get(at(10) && residues[9].key).sphere >= at(10).sphere);
  const idrFraction = [...result.values()].filter((value) => value.idr).length / result.size;
  assert.ok(idrFraction > 0.25 && idrFraction < 0.6, `IDR fraction ${idrFraction}`);
});
