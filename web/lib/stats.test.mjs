import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjustBH,
  adjustForProtein,
  digamma,
  imputeDownshifted,
  log2Matrix,
  moderatedTTest,
  normalizeMedians,
  studentTCDF,
  studentTQuantile,
  trigamma,
  trigammaInverse,
} from './stats.js';

function close(actual, expected, tolerance = 1e-9, message = '') {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance * scale, `${message} ${actual} ≠ ${expected}`);
}

// log2 intensities, 30 features × 7 samples (3 A, then 4 B). Rows 0–5 change between groups,
// row 6 is constant within each group (zero variance).
const COMPLETE = [
  [25.49, 26.94, 28.43, 27.14, 29.14, 28.65, 28.33],
  [25.98, 25.75, 26.20, 26.06, 24.75, 24.43, 23.67],
  [25.07, 24.32, 24.97, 25.08, 27.53, 27.81, 27.94],
  [24.52, 25.11, 25.06, 24.92, 25.36, 25.56, 25.45],
  [27.20, 27.55, 27.38, 27.39, 24.88, 24.58, 25.14],
  [27.51, 27.50, 27.85, 27.80, 28.65, 28.41, 28.55],
  [22.50, 22.50, 22.50, 23.10, 23.10, 23.10, 23.10],
  [24.45, 24.68, 24.47, 24.91, 24.58, 24.80, 24.96],
  [22.20, 22.33, 22.52, 22.72, 22.93, 23.29, 22.43],
  [22.60, 22.47, 23.29, 22.91, 22.63, 23.06, 22.46],
  [21.77, 21.62, 21.87, 21.54, 21.19, 21.85, 21.52],
  [26.04, 25.80, 25.79, 25.87, 26.06, 25.76, 26.05],
  [25.74, 26.68, 25.34, 27.00, 26.84, 27.51, 26.68],
  [25.19, 25.23, 25.70, 25.92, 25.82, 25.40, 25.38],
  [18.16, 18.18, 18.37, 18.36, 18.58, 18.52, 18.05],
  [24.68, 24.18, 24.05, 24.09, 24.16, 23.68, 23.85],
  [24.10, 23.57, 23.38, 23.54, 24.04, 23.27, 23.04],
  [27.62, 25.16, 27.25, 25.45, 25.40, 27.25, 26.42],
  [21.90, 21.82, 21.79, 21.53, 22.16, 21.83, 21.85],
  [21.34, 20.75, 20.98, 21.17, 21.02, 21.34, 21.46],
  [27.30, 27.29, 27.59, 27.49, 27.27, 27.23, 27.32],
  [25.24, 26.15, 25.51, 26.03, 25.64, 25.72, 25.82],
  [27.21, 26.80, 26.87, 27.28, 27.17, 26.56, 26.95],
  [24.51, 24.19, 24.62, 24.98, 24.55, 24.62, 24.32],
  [26.25, 26.00, 25.11, 25.99, 25.98, 25.73, 25.82],
  [21.60, 22.09, 22.59, 23.18, 21.77, 22.22, 22.52],
  [24.08, 24.58, 26.08, 23.67, 25.13, 24.07, 26.29],
  [25.63, 26.68, 26.16, 26.37, 27.14, 26.23, 25.98],
  [21.17, 20.58, 21.12, 21.01, 21.06, 20.80, 21.09],
  [24.60, 24.58, 24.66, 24.58, 24.72, 24.92, 25.21],
];
// [row, column] cells removed for the missing-value tests: residual df then range from 3 to 5,
// row 9 keeps one value in A and row 10 none in B.
const MISSING_CELLS = [[9, 0], [11, 0], [24, 0], [7, 1], [14, 1], [9, 2], [12, 2], [10, 3], [13, 3], [24, 3], [8, 4], [10, 4], [14, 4], [10, 5], [11, 5], [8, 6], [10, 6], [19, 6]];
const A = [0, 1, 2];
const B = [3, 4, 5, 6];

function matrixOf(rows, missing = []) {
  const columns = rows[0].length;
  const values = Float64Array.from(rows.flat());
  for (const [row, column] of missing) values[row * columns + column] = NaN;
  return { values, rows: rows.length, columns };
}

// limma 3.68.5 (R 4.5.3): lmFit(y, model.matrix(~0 + group)), contrasts.fit(B − A), eBayes(),
// p.adjust(p, 'BH'), on the rows with ≥ 2 values per group. Per row: [logFC, t, p, q, df.total].
const LIMMA = {
  complete: {
    d0: 0.908364685294415, s02: 0.0263714711029222, method: 'moments',
    rows: {
      0: [1.36166666666666, 1.69719416922165, 0.141350994102296, 0.385502711188081, 5.90836468529442],
      1: [-1.24916666666668, -2.25500954208877, 0.0656725929823242, 0.246272223683716, 5.90836468529442],
      6: [0.600000000000001, 12.3375578150518, 1.93592874122321e-05, 0.000580778622366964, 5.90836468529442],
      8: [0.4925, 2.28914776800663, 0.0626875681279139, 0.246272223683716, 5.90836468529442],
      14: [0.140833333333333, 0.956244742805505, 0.376420702625323, 0.664271828162335, 5.90836468529442],
    },
  },
  missing: {
    d0: 2.00032574563164, s02: 0.0331987405960814, method: 'likelihood',
    rows: {
      0: [1.36166666666666, 1.84139784760526, 0.10812108411992, 0.275217305032522, 7.00032574563164],
      6: [0.600000000000001, 8.06567672474715, 8.64877302166413e-05, 0.00242165644606596, 7.00032574563164],
      7: [0.352499999999999, 2.55667277140738, 0.043099317016713, 0.179564133923092, 6.00032574563164],
      8: [0.654999999999998, 3.02860147824255, 0.0291255883883043, 0.163103294974504, 5.00032574563164],
      11: [0.198333333333345, 1.62554524537071, 0.164970887805983, 0.355321912197502, 5.00032574563164],
      19: [0.153333333333332, 0.847610403135392, 0.429162483072454, 0.598052213048962, 6.00032574563164],
    },
  },
  // eBayes(fit, legacy = TRUE): the moment estimator despite unequal df.
  missingLegacy: {
    d0: 0.866045638629297, s02: 0.0238412400699736, method: 'moments',
    rows: {
      6: [0.600000000000001, 13.2413041777242, 1.36463618590291e-05, 0.000382098132052815, 5.8660456386293],
      8: [0.654999999999998, 2.91089218214272, 0.0454834420748857, 0.212256063016134, 3.8660456386293],
      12: [0.79750000000001, 2.20290763160692, 0.0802940033170515, 0.28102901160968, 4.8660456386293],
    },
  },
};

function assertMatchesLimma(out, reference) {
  close(out.prior.d0, reference.d0, 1e-9, 'd0');
  close(out.prior.s02, reference.s02, 1e-9, 's0²');
  assert.equal(out.prior.method, reference.method);
  for (const [row, [logFC, t, p, q, df]] of Object.entries(reference.rows)) {
    const result = out.results[row];
    close(result.logFC, logFC, 1e-12, `row ${row} logFC`);
    close(result.t, t, 1e-9, `row ${row} t`);
    close(result.p, p, 1e-9, `row ${row} p`);
    close(out.q[row], q, 1e-9, `row ${row} q`);
    close(result.df, df, 1e-9, `row ${row} df`);
    close(result.se, result.logFC / result.t, 1e-12, `row ${row} se`);
  }
}

test('moderated t-test matches limma on complete data (moment prior, zero variance)', () => {
  const out = moderatedTTest(matrixOf(COMPLETE), A, B);
  assert.equal(out.tested, 30);
  assertMatchesLimma(out, LIMMA.complete);
  const constant = out.results[6];
  assert.equal(constant.s2, 0, 'identical values give a variance of exactly 0');
  close(constant.s2Post, (out.prior.d0 * out.prior.s02) / (5 + out.prior.d0), 1e-12, 'the prior alone sets its posterior variance');
  const first = out.results[0];
  assert.deepEqual([first.nA, first.nB], [3, 4]);
  close(first.aveExpr, 27.7314285714286, 1e-12, 'aveExpr');
});

test('moderated t-test matches limma with missing values (unequal df, profile likelihood prior)', () => {
  const matrix = matrixOf(COMPLETE, MISSING_CELLS);
  const out = moderatedTTest(matrix, A, B);
  assert.equal(out.tested, 28);
  assertMatchesLimma(out, LIMMA.missing);
  assert.deepEqual([out.results[8].nA, out.results[8].nB], [3, 2]);
  assertMatchesLimma(moderatedTTest(matrix, A, B, { legacy: true }), LIMMA.missingLegacy);
});

test('a prior estimated on a whole experiment can be applied to other features', () => {
  const whole = moderatedTTest(matrixOf(COMPLETE), A, B);
  // The same features tested one at a time with the experiment's prior give the same statistics.
  for (const row of [0, 3, 11]) {
    const values = new Float64Array(COMPLETE[row]);
    const single = moderatedTTest({ values, rows: 1, columns: values.length }, A, B, { prior: whole.prior });
    close(single.results[0].t, whole.results[row].t, 1e-12, `t of row ${row}`);
    close(single.results[0].p, whole.results[row].p, 1e-12, `p of row ${row}`);
    assert.equal(single.results[0].df, whole.results[row].df, 'the total df is capped at the experiment’s pooled df');
  }
  assert.equal(whole.prior.pooled, 30 * 5);
});

test('features below minValid are not tested and have no q-value', () => {
  const matrix = matrixOf(COMPLETE, MISSING_CELLS);
  const out = moderatedTTest(matrix, A, B);
  assert.equal(out.results[9], null, 'one value in A');
  assert.equal(out.results[10], null, 'no values in B');
  assert.ok(Number.isNaN(out.q[9]) && Number.isNaN(out.q[10]));
  assert.equal(out.q.filter((value) => !Number.isNaN(value)).length, 28);
  const loose = moderatedTTest(matrix, A, B, { minValid: 1 });
  assert.equal(loose.tested, 29);
  assert.equal(loose.results[10], null);
  assert.deepEqual([loose.results[9].nA, loose.results[9].nB], [1, 4]);
  const strict = moderatedTTest(matrix, A, B, { minValid: 3 });
  assert.ok(strict.results.every((result) => !result || (result.nA >= 3 && result.nB >= 3)));
});

test('variances without extra spread give d0 = ∞: every posterior variance is s0², df the pooled df', () => {
  const pattern = [-0.1, 0, 0.1];
  const rows = Array.from({ length: 12 }, (_, index) => {
    const base = 20 + index * 0.37;
    const change = index % 3 ? 0 : 1.5;
    return [...pattern.map((offset) => base + offset), ...pattern.map((offset) => base + change + offset)];
  });
  const out = moderatedTTest(matrixOf(rows), [0, 1, 2], [3, 4, 5]);
  assert.equal(out.prior.d0, Infinity);
  close(out.prior.s02, 0.01, 1e-12);
  for (const result of out.results) {
    assert.equal(result.s2Post, out.prior.s02);
    assert.equal(result.df, 48);
  }
  close(out.results[0].t, 1.5 / Math.sqrt((2 / 3) * out.prior.s02), 1e-12);
});

test('fewer than three features fall back to ordinary two-sample t-tests', () => {
  const out = moderatedTTest(matrixOf([[1, 2, 3, 5, 6, 7], [4, 4.5, 5, 4, 4.4, 5.2]]), [0, 1, 2], [3, 4, 5]);
  assert.deepEqual(out.prior, { d0: 0, s02: NaN, method: 'none', pooled: 8 });
  const [first] = out.results;
  close(first.t, 4 / Math.sqrt(1 * (2 / 3)), 1e-12);
  close(first.p, 2 * (1 - studentTCDF(first.t, 4)), 1e-12);
  assert.equal(first.s2Post, first.s2);
});

test('group columns are checked', () => {
  const matrix = matrixOf(COMPLETE);
  assert.throws(() => moderatedTTest(matrix, [0, 1, 2], [2, 3]), RangeError);
  assert.throws(() => moderatedTTest(matrix, [], B), RangeError);
  assert.throws(() => moderatedTTest(matrix, [0, 7], B), RangeError);
  assert.throws(() => moderatedTTest(matrix, [0, 0, 1], B), RangeError);
});

test('Benjamini–Hochberg matches p.adjust, ignoring missing p-values', () => {
  const q = adjustBH([0.01, 0.04, NaN, 0.03, 0.2, 0.001, 0.04]);
  assert.ok(q instanceof Float64Array);
  [0.03, 0.048, NaN, 0.048, 0.2, 0.006, 0.048].forEach((expected, index) => {
    if (Number.isNaN(expected)) assert.ok(Number.isNaN(q[index]));
    else close(q[index], expected, 1e-15);
  });
  assert.ok(adjustBH([null, undefined, NaN]).every(Number.isNaN));
  assert.deepEqual([...adjustBH([0.5, 0.9])], [0.9, 0.9]);
});

test('PTM sites are adjusted for their protein as MSstatsPTM does', () => {
  // MSstatsPTM 2.14.0 .adjustProteinLevel on the same numbers.
  const first = adjustForProtein({ logFC: 1.2, se: 0.3, df: 6 }, { logFC: 0.5, se: 0.2, df: 10 });
  close(first.logFC, 0.7, 1e-15);
  close(first.se, 0.360555127546399, 1e-13);
  close(first.df, 11.1920529801325, 1e-12);
  close(first.t, 1.9414506867883, 1e-12);
  close(first.p, 0.0777957067333724, 1e-12);
  assert.equal(first.adjusted, true);
  const second = adjustForProtein({ logFC: -0.4, se: 0.25, df: 4.5 }, { logFC: -0.9, se: 0.1, df: Infinity });
  close(second.df, 6.0552, 1e-12);
  close(second.p, 0.112252159724398, 1e-12);
  // No protein change: the site is reported unadjusted; an infinite change keeps its sign.
  const alone = adjustForProtein({ logFC: 1.2, se: 0.3, df: 6 }, null);
  assert.deepEqual([alone.logFC, alone.se, alone.df, alone.adjusted], [1.2, 0.3, 6, false]);
  close(alone.p, 2 * (1 - studentTCDF(4, 6)), 1e-12);
  const infinite = adjustForProtein({ logFC: -Infinity, se: NaN, df: NaN }, { logFC: 0.2, se: 0.1, df: 5 });
  assert.equal(infinite.logFC, -Infinity);
  assert.ok(Number.isNaN(infinite.p));
});

test('log2 transformation treats zero, negative and non-numeric intensities as missing', () => {
  const matrix = log2Matrix([1, 2, 0, -4, NaN, '8', null, Infinity], 2, 4);
  assert.deepEqual([matrix.rows, matrix.columns], [2, 4]);
  assert.deepEqual([...matrix.values], [0, 1, NaN, NaN, NaN, 3, NaN, NaN]);
  assert.throws(() => log2Matrix([1, 2, 3], 2, 2), RangeError);
});

test('median normalization moves every column median to the mean of the medians', () => {
  const { matrix, offsets } = normalizeMedians({ values: Float64Array.from([1, 2, NaN, 2, 4, 6, 3, 6, 9]), rows: 3, columns: 3 });
  assert.deepEqual([...offsets], [2.5, 0.5, -3]);
  assert.deepEqual([...matrix.values], [3.5, 2.5, NaN, 4.5, 4.5, 3, 5.5, 6.5, 6]);
});

test('down-shifted imputation is reproducible and follows the Perseus defaults', () => {
  let state = 12345;
  const uniform = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state + 0.5) / 2 ** 32;
  };
  const rows = 4000;
  const values = new Float64Array(rows * 2);
  for (let row = 0; row < rows; row += 1) {
    const normal = Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
    values[row * 2] = uniform() < 0.3 ? NaN : 25 + 2 * normal;
    values[row * 2 + 1] = row === 7 ? 21 : NaN;
  }
  const matrix = { values, rows, columns: 2 };
  const { matrix: filled, imputed } = imputeDownshifted(matrix);
  assert.deepEqual(filled.values, imputeDownshifted(matrix, { seed: 1 }).matrix.values, 'seed 1 is the default');
  assert.notDeepEqual(filled.values, imputeDownshifted(matrix, { seed: 2 }).matrix.values);
  const valid = [];
  const drawn = [];
  for (let row = 0; row < rows; row += 1) {
    const index = row * 2;
    assert.equal(imputed[index], Number.isNaN(values[index]) ? 1 : 0);
    if (imputed[index]) drawn.push(filled.values[index]);
    else {
      assert.equal(filled.values[index], values[index]);
      valid.push(values[index]);
    }
  }
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  const sd = (list) => Math.sqrt(list.reduce((sum, value) => sum + (value - mean(list)) ** 2, 0) / (list.length - 1));
  const center = mean(valid) - 1.8 * sd(valid);
  assert.ok(Math.abs(mean(drawn) - center) < 0.05 * sd(valid), 'centered 1.8 SD below the valid values');
  assert.ok(Math.abs(sd(drawn) / (0.3 * sd(valid)) - 1) < 0.1, '0.3 times as wide');
  assert.ok(imputed.every((flag, index) => index % 2 === 0 || flag === 0), 'a column with one valid value is left alone');
  assert.ok(Number.isNaN(filled.values[1]));
});

test('special functions match R and limma', () => {
  close(digamma(1), -0.5772156649015329, 1e-15);
  close(digamma(0.5), -1.9635100260214231, 1e-14);
  close(digamma(7.25), 1.9104535268837362, 1e-14);
  close(trigamma(1), Math.PI ** 2 / 6, 1e-15);
  close(trigamma(0.2), 26.267377205423777, 1e-14);
  close(trigamma(33), 0.0307668040203021, 1e-14);
  close(trigammaInverse(0.9), 1.5435475773409497, 1e-13);
  close(trigammaInverse(1e-3), 1000.4999166666823, 1e-13);
  close(trigammaInverse(trigamma(3.7)), 3.7, 1e-12);
  assert.ok(Number.isNaN(digamma(0)) && Number.isNaN(digamma(-2)));
  assert.equal(trigamma(0), Infinity);
  assert.ok(Number.isNaN(trigammaInverse(-1)));
});

test('Student t distribution matches R for fractional, large and infinite df', () => {
  close(studentTCDF(-3.5, 7.3), 4.67156926424277e-3, 1e-12);
  close(studentTCDF(2, 1e5), 0.977248518271247, 1e-12);
  close(studentTCDF(-40, 3) / 1.71903403945793e-5, 1, 1e-12, 'relative precision in the far tail');
  close(studentTCDF(0.3, 0.5), 0.577570423934755, 1e-12);
  close(studentTCDF(-6, Infinity) / 9.86587645037698e-10, 1, 1e-12, 'normal limit');
  close(studentTQuantile(0.975, 12.5), 2.16918594271254, 1e-12);
  close(studentTQuantile(0.001, 3), -10.2145318524074, 1e-12);
  close(studentTQuantile(0.9, 0.8), 4.0632911999666, 1e-12);
  for (const df of [1, 4.5, 30]) {
    for (const p of [0.01, 0.3, 0.5, 0.8, 0.999]) close(studentTCDF(studentTQuantile(p, df), df), p, 1e-13);
  }
});
