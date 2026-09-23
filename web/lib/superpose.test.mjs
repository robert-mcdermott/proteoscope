import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeTransforms,
  fitPoints,
  invertTransform,
  isIdentityTransform,
  iterativeFit,
  lddt,
  rmsf,
  symmetricEigen,
  tmD0,
  tmScore,
  transformPoints,
} from './superpose.js';

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomTransform(rand) {
  const q = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5];
  const length = Math.hypot(...q);
  const [a, b, c, d] = q.map((value) => value / length);
  return {
    rotation: [
      a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c),
      2 * (b * c + a * d), a * a - b * b + c * c - d * d, 2 * (c * d - a * b),
      2 * (b * d - a * c), 2 * (c * d + a * b), a * a - b * b - c * c + d * d,
    ],
    translation: [rand() * 40 - 20, rand() * 40 - 20, rand() * 40 - 20],
  };
}

// A chain of points with 3.8 Å steps, like a Cα trace.
function randomWalk(count, rand) {
  const points = new Float64Array(count * 3);
  for (let index = 1; index < count; index += 1) {
    let dx = rand() - 0.5;
    let dy = rand() - 0.5;
    let dz = rand() - 0.5;
    const length = Math.hypot(dx, dy, dz) || 1;
    dx = (dx / length) * 3.8;
    dy = (dy / length) * 3.8;
    dz = (dz / length) * 3.8;
    points[index * 3] = points[index * 3 - 3] + dx;
    points[index * 3 + 1] = points[index * 3 - 2] + dy;
    points[index * 3 + 2] = points[index * 3 - 1] + dz;
  }
  return points;
}

function determinant(r) {
  return r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]);
}

test('symmetric eigen-decomposition reconstructs the matrix', () => {
  const matrix = [[4, 1, 2, 0.5], [1, 3, 0, 1], [2, 0, 5, 2], [0.5, 1, 2, 1]];
  const { values, vectors } = symmetricEigen(matrix);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += vectors[row][k] * values[k] * vectors[column][k];
      assert.ok(Math.abs(sum - matrix[row][column]) < 1e-9);
    }
  }
});

test('fitPoints recovers a rigid transform exactly', () => {
  const rand = random(7);
  const reference = randomWalk(60, rand);
  const truth = randomTransform(rand);
  const mobile = transformPoints(invertTransform(truth), reference);
  const fit = fitPoints(mobile, reference);
  assert.ok(fit.rmsd < 1e-6, `rmsd ${fit.rmsd}`);
  fit.rotation.forEach((value, index) => assert.ok(Math.abs(value - truth.rotation[index]) < 1e-6));
  assert.ok(Math.abs(determinant(fit.rotation) - 1) < 1e-9);
});

test('a mirror image is never fitted with a reflection', () => {
  const rand = random(11);
  const reference = randomWalk(40, rand);
  const mirrored = reference.map((value, index) => (index % 3 === 0 ? -value : value));
  const fit = fitPoints(mirrored, reference);
  assert.ok(Math.abs(determinant(fit.rotation) - 1) < 1e-9);
  assert.ok(fit.rmsd > 1);
});

test('RMSD matches a direct computation after fitting noisy points', () => {
  const rand = random(3);
  const reference = randomWalk(80, rand);
  const mobile = transformPoints(randomTransform(rand), reference).map((value) => value + (rand() - 0.5) * 0.8);
  const fit = fitPoints(mobile, reference);
  const moved = transformPoints(fit, mobile);
  let sum = 0;
  for (let index = 0; index < 80; index += 1) {
    sum += (moved[index * 3] - reference[index * 3]) ** 2 + (moved[index * 3 + 1] - reference[index * 3 + 1]) ** 2 + (moved[index * 3 + 2] - reference[index * 3 + 2]) ** 2;
  }
  assert.ok(Math.abs(Math.sqrt(sum / 80) - fit.rmsd) < 1e-6);
});

test('iterative pruning drops displaced pairs and keeps the rigid core', () => {
  const rand = random(19);
  const reference = randomWalk(100, rand);
  const truth = randomTransform(rand);
  const mobile = transformPoints(invertTransform(truth), reference);
  const outliers = new Set();
  for (let index = 70; index < 90; index += 1) {
    outliers.add(index);
    mobile[index * 3] += 8 + rand() * 4;
    mobile[index * 3 + 1] -= 6;
  }
  const fit = iterativeFit(mobile, reference, { cutoff: 2 });
  assert.ok(fit.rmsd < 1e-6, `core rmsd ${fit.rmsd}`);
  for (let index = 0; index < 100; index += 1) assert.equal(Boolean(fit.kept[index]), !outliers.has(index), `pair ${index}`);
  assert.ok(fit.rmsdAll > 5);
});

test('transforms compose and invert', () => {
  const rand = random(23);
  const a = randomTransform(rand);
  const b = randomTransform(rand);
  assert.ok(isIdentityTransform(composeTransforms(invertTransform(a), a), 1e-9));
  const points = randomWalk(5, rand);
  const stepwise = transformPoints(b, transformPoints(a, points));
  const composed = transformPoints(composeTransforms(b, a), points);
  stepwise.forEach((value, index) => assert.ok(Math.abs(value - composed[index]) < 1e-9));
});

test('TM-score is 1 for identical structures and finds the better of two rigid halves', () => {
  const rand = random(29);
  const reference = randomWalk(100, rand);
  assert.ok(Math.abs(tmScore(reference, reference).tmScore - 1) < 1e-9);
  assert.ok(Math.abs(tmD0(100) - 3.652) < 1e-3);

  // Shift the second half 30 Å: the best superposition matches one half exactly (0.5) and the
  // other half contributes 1/(1 + (30/d0)²) per residue.
  const mobile = Float64Array.from(reference);
  for (let index = 50; index < 100; index += 1) mobile[index * 3] += 30;
  const expected = 0.5 + (50 / (1 + (30 / tmD0(100)) ** 2)) / 100;
  const result = tmScore(mobile, reference);
  assert.ok(Math.abs(result.tmScore - expected) < 0.01, `tm ${result.tmScore} vs ${expected}`);
  const plain = fitPoints(mobile, reference);
  const plainMoved = transformPoints(plain, mobile);
  let plainScore = 0;
  for (let index = 0; index < 100; index += 1) {
    const d = Math.hypot(plainMoved[index * 3] - reference[index * 3], plainMoved[index * 3 + 1] - reference[index * 3 + 1], plainMoved[index * 3 + 2] - reference[index * 3 + 2]);
    plainScore += 1 / (1 + (d / tmD0(100)) ** 2) / 100;
  }
  assert.ok(result.tmScore > plainScore + 0.2, 'the search beats a whole-chain least-squares fit');
});

test('lDDT is superposition-free and localizes a displaced point', () => {
  const count = 20;
  const reference = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) reference[index * 3] = index * 3.8;
  const rand = random(31);
  const moved = transformPoints(randomTransform(rand), reference);
  assert.ok(Math.abs(lddt(reference, moved).global - 1) < 1e-12, 'a rigid motion preserves every distance');

  const perturbed = Float64Array.from(reference);
  perturbed[10 * 3 + 1] += 3;
  const result = lddt(reference, perturbed);
  // Point 10 has six neighbors within 15 Å (3.8, 7.6 and 11.4 Å on each side); displaced 3 Å
  // sideways they keep 2, 3 and 4 of the 4 thresholds respectively.
  assert.ok(Math.abs(result.perPoint[10] - 0.75) < 1e-12);
  assert.ok(Math.abs(result.perPoint[9] - (5 + 0.5) / 6) < 1e-12);
  assert.equal(result.perPoint[0], 1);
});

test('RMSF measures spread about the mean', () => {
  const a = new Float64Array([0, 0, 0, 5, 0, 0]);
  const b = new Float64Array([0, 0, 0, 6, 0, 0]);
  const values = rmsf([a, b]);
  assert.equal(values[0], 0);
  assert.ok(Math.abs(values[1] - 0.5) < 1e-12);
});
