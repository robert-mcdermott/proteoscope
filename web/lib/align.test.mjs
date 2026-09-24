import assert from 'node:assert/strict';
import test from 'node:test';
import { alignSequences, blosum62 } from './align.js';

const UBIQUITIN = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG';

test('BLOSUM62 is symmetric and has the standard diagonal', () => {
  const letters = 'ARNDCQEGHILKMFPSTWYV';
  for (const a of letters) for (const b of letters) assert.equal(blosum62(a, b), blosum62(b, a), `${a}${b}`);
  assert.equal(blosum62('W', 'W'), 11);
  assert.equal(blosum62('C', 'C'), 9);
  assert.equal(blosum62('A', 'A'), 4);
  assert.equal(blosum62('I', 'V'), 3);
  assert.equal(blosum62('D', 'E'), 2);
  assert.equal(blosum62('W', 'N'), -4);
  assert.equal(blosum62('U', 'C'), 9, 'selenocysteine scores as cysteine');
});

test('identical sequences align on the diagonal', () => {
  const result = alignSequences(UBIQUITIN, UBIQUITIN);
  assert.equal(result.pairs.length, UBIQUITIN.length);
  assert.ok(result.pairs.every(([i, j]) => i === j));
  assert.equal(result.identity, 1);
  assert.equal(result.rowA, UBIQUITIN);
});

test('a domain aligns into a full-length sequence without end-gap penalties', () => {
  const fragment = UBIQUITIN.slice(20, 60);
  const result = alignSequences(fragment, UBIQUITIN);
  assert.equal(result.pairs.length, fragment.length);
  assert.ok(result.pairs.every(([i, j]) => j === i + 20));
  assert.equal(result.rowA.length, result.rowB.length);
  assert.equal(result.rowA.replaceAll('-', ''), fragment);
});

test('an internal deletion opens a single gap', () => {
  const deleted = UBIQUITIN.slice(0, 30) + UBIQUITIN.slice(36);
  const result = alignSequences(UBIQUITIN, deleted);
  assert.equal(result.pairs.length, deleted.length);
  assert.equal(result.identity, 1);
  const gaps = result.rowB.match(/-+/g) ?? [];
  assert.deepEqual(gaps.map((gap) => gap.length), [6]);
});

test('point mutations stay aligned and lower identity', () => {
  const mutant = UBIQUITIN.replace('LEVEP', 'LEAEP').replace('KQLED', 'KRLED');
  const result = alignSequences(UBIQUITIN, mutant);
  assert.equal(result.pairs.length, UBIQUITIN.length);
  assert.equal(result.identical, UBIQUITIN.length - 2);
});

test('secondary structure steers gap placement away from helices', () => {
  // The second sequence lacks one of two identical residues, so the gap could go on either side
  // of the repeat; a helix on the left makes the right-hand position cheaper.
  const a = 'AAAAAKLLLLG';
  const b = 'AAAAKLLLLG';
  const ss = 'HHHHHCCCCCC';
  const result = alignSequences(a, b, { ssA: ss, ssB: ss.slice(1) });
  assert.equal(result.pairs.length, b.length);
});

test('nucleic acid alignment treats T and U as the same base', () => {
  const result = alignSequences('ACGTACGT', 'ACGUACGU', { kind: 'nucleic' });
  assert.equal(result.identity, 1);
  assert.equal(result.pairs.length, 8);
});

test('empty and oversized inputs return no pairs', () => {
  assert.equal(alignSequences('', UBIQUITIN).pairs.length, 0);
  const oversized = alignSequences(UBIQUITIN, UBIQUITIN, { maxCells: 10 });
  assert.equal(oversized.truncated, true);
  assert.equal(oversized.pairs.length, 0);
});
