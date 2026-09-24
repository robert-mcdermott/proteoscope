import assert from 'node:assert/strict';
import test from 'node:test';
import { detectHDX, maxUptakeOf, parseHDX, peptideDifferences, residueValues, studentTCDF, studentTQuantile } from './hdx.js';

const csv = (header, rows) => [header.join(','), ...rows.map((row) => row.join(','))].join('\n');

test('Student t distribution matches tables', () => {
  assert.ok(Math.abs(studentTQuantile(0.995, 4) - 4.604) < 1e-3);
  assert.ok(Math.abs(studentTQuantile(0.975, 10) - 2.228) < 1e-3);
  assert.ok(Math.abs(studentTCDF(1.96, 1e6) - 0.975) < 1e-4);
  assert.ok(Math.abs(studentTCDF(-2.776, 4) - 0.025) < 1e-4);
});

test('formats are recognized and exchangeable amides counted as DynamX does', () => {
  assert.equal(detectHDX(['Protein', 'Start', 'End', 'Sequence', 'State', 'Exposure', 'Center', 'Uptake', 'Uptake SD']), 'dynamx-state');
  assert.equal(detectHDX(['Protein', 'Start', 'End', 'Sequence', 'State', 'Exposure', 'File', 'z', 'RT', 'Inten', 'Center']), 'dynamx-cluster');
  assert.equal(detectHDX(['Protein State', 'Deut Time', 'Experiment', 'Start', 'End', 'Sequence', 'Charge', '# Deut', 'Deut %']), 'hdexaminer-results');
  assert.equal(detectHDX(['Protein State', 'Protein', 'Start', 'End', 'Sequence', 'Deut Time (sec)', 'maxD', '#D', '%D', '#Rep', 'Stddev']), 'hdexaminer-summary');
  assert.equal(detectHDX(['chain', 'residue', 'value']), null);
  assert.equal(maxUptakeOf('MTFQIQRIY'), 8);
  assert.equal(maxUptakeOf('PKEKPYL'), 5, 'the N-terminal residue and later prolines exchange no amide');
});

test('DynamX cluster data: masses from charge states, uptake against the undeuterated mass, replicate SD', () => {
  const header = ['Protein', 'Start', 'End', 'Sequence', 'Modification', 'Fragment', 'MaxUptake', 'MHP', 'State', 'Exposure', 'File', 'z', 'RT', 'Inten', 'Center'];
  const row = (state, exposure, file, z, mass, intensity = 1000) => ['P', '10', '19', 'LKEAAGRWDV', '', '', '9', '0', state, String(exposure), file, String(z), '3', String(intensity), String(mass / z + 1.007276)];
  const text = csv(header, [
    row('apo', 0, 'r1', 1, 1000), row('apo', 0, 'r1', 2, 1000), row('apo', 0, 'r2', 1, 1000),
    row('apo', 1, 'r1', 1, 1004), row('apo', 1, 'r1', 2, 1004), row('apo', 1, 'r2', 2, 1004.2), row('apo', 1, 'r3', 1, 1003.8),
    row('bound', 0, 'r1', 1, 1000),
    row('bound', 1, 'r1', 1, 1002), row('bound', 1, 'r2', 1, 1002.2), row('bound', 1, 'r3', 1, 1001.8),
  ]);
  const data = parseHDX(text, 'cluster.csv');
  assert.equal(data.format, 'dynamx-cluster');
  assert.deepEqual(data.states, ['apo', 'bound']);
  assert.deepEqual(data.exposures, [0, 60]);
  const apo = data.peptides.find((peptide) => peptide.state === 'apo' && peptide.exposure === 60);
  assert.ok(Math.abs(apo.uptake - 4) < 1e-6);
  assert.ok(Math.abs(apo.sd - 0.2) < 1e-6);
  assert.equal(apo.n, 3);
  const difference = peptideDifferences(data, { state: 'bound', reference: 'apo', exposure: 60, alpha: 0.01 });
  assert.equal(difference.test, 'hybrid');
  const [peptide] = difference.rows;
  assert.ok(Math.abs(peptide.delta + 2) < 1e-6, 'bound takes up 2 D less');
  assert.ok(Math.abs(peptide.relative + 2 / 9) < 1e-6);
  assert.ok(peptide.significant && peptide.p < 0.01);
  // Limit: t(0.995, 4) × √(0.2²/3 + 0.2²/3).
  assert.ok(Math.abs(difference.limit - 4.604 * Math.sqrt(0.08 / 3)) < 2e-3);
});

test('state data without replicates uses a fixed threshold; residue values skip two residues and prolines', () => {
  const header = ['Protein', 'Start', 'End', 'Sequence', 'Modification', 'Fragment', 'MaxUptake', 'MHP', 'State', 'Exposure', 'Center', 'Center SD', 'Uptake', 'Uptake SD', 'RT', 'RT SD'];
  const text = csv(header, [
    ['P', '1', '6', 'AKLPEV', '', '', '4', '0', 'A', '0.5', '0', '0', '2', '0.1', '0', '0'],
    ['P', '1', '6', 'AKLPEV', '', '', '4', '0', 'B', '0.5', '0', '0', '1.2', '0.1', '0', '0'],
    ['P', '4', '9', 'PEVKLA', '', '', '4', '0', 'A', '0.5', '0', '0', '1', '0.1', '0', '0'],
    ['P', '4', '9', 'PEVKLA', '', '', '4', '0', 'B', '0.5', '0', '0', '0.9', '0.1', '0', '0'],
  ]);
  const data = parseHDX(text);
  assert.deepEqual(data.exposures, [30]);
  const difference = peptideDifferences(data, { state: 'B', reference: 'A', exposure: 30 });
  assert.equal(difference.test, 'threshold');
  assert.equal(difference.limit, 0.5);
  assert.deepEqual(difference.rows.map((row) => row.significant), [true, false]);
  const sequence = 'AKLPEVKLA';
  const positions = new Map([[0, { start: 0, end: 5 }], [1, { start: 3, end: 8 }]]);
  const values = residueValues(difference.rows, positions, sequence, { value: 'delta', significantOnly: true });
  // Peptide 1 covers 2–5 minus Pro 3 → {2, 4, 5}; peptide 2 covers 5–8 → {5, 6, 7, 8}.
  assert.deepEqual([...values.keys()].sort((a, b) => a - b), [2, 4, 5, 6, 7, 8]);
  assert.ok(Math.abs(values.get(2) + 0.8) < 1e-9);
  assert.ok(Math.abs(values.get(5) - (-0.8 / 3) / (1 / 3 + 1 / 4)) < 1e-9, 'shared residues average by 1 / length');
  assert.equal(values.get(7), 0, 'residues of insignificant peptides only are zero');
});

test('HDExaminer tables: seconds from "Deut Time", replicates from Experiment, controls left out', () => {
  const results = csv(['Protein State', 'Deut Time', 'Experiment', 'Start', 'End', 'Sequence', 'Charge', 'Max Inty', '# Deut', 'Deut %', 'Confidence'], [
    ['S', '0s', 'e1', '5', '11', 'DVKHFSP', '2', '1e5', 'n/a', 'n/a', 'High'],
    ['S', '10.00s', 'e1', '5', '11', 'DVKHFSP', '2', '1e5', '2.0', '40', 'High'],
    ['S', '10.00s', 'e1', '5', '11', 'DVKHFSP', '3', '1e5', '2.2', '44', 'High'],
    ['S', '10.00s', 'e2', '5', '11', 'DVKHFSP', '2', '1e5', '1.9', '38', 'Medium'],
    ['S', '10.00s', 'e3', '5', '11', 'DVKHFSP', '2', '1e5', '9.9', '99', 'Low'],
    ['S', 'FD', 'e1', '5', '11', 'DVKHFSP', '2', '1e5', '5', '100', 'High'],
  ]);
  const data = parseHDX(results);
  assert.equal(data.format, 'hdexaminer-results');
  assert.deepEqual(data.exposures, [0, 10]);
  const peptide = data.peptides.find((item) => item.exposure === 10);
  assert.equal(peptide.n, 2, 'low-confidence rows are left out');
  assert.ok(Math.abs(peptide.uptake - 2) < 1e-9, 'charge states average within a replicate, then replicates');

  const summary = csv(['Protein State', 'Protein', 'Start', 'End', 'Sequence', 'Deut Time (sec)', 'maxD', '#D', '%D', '#Rep', 'Stddev'], [
    ['WT', 'B5', '1', '4', 'MDIA', '4', '2', '0.768', '47.6', '4', '0.028'],
    ['MAX', 'B5', '1', '4', 'MDIA', 'FD', '2', '1.6', '100', '2', '0.02'],
  ]);
  const parsed = parseHDX(summary);
  assert.deepEqual(parsed.states, ['WT']);
  assert.deepEqual([parsed.peptides[0].uptake, parsed.peptides[0].n, parsed.peptides[0].maxUptake], [0.768, 4, 2]);
});

test('summed differences use the time points both states have; modified forms are peptides of their own', () => {
  const header = ['Protein', 'Start', 'End', 'Sequence', 'Modification', 'Fragment', 'MaxUptake', 'MHP', 'State', 'Exposure', 'Center', 'Center SD', 'Uptake', 'Uptake SD', 'RT', 'RT SD'];
  const row = (state, minutes, uptake, modification = '') => ['P', '1', '9', 'AKLMEVKLA', modification, '', '7', '0', state, String(minutes), '0', '0', String(uptake), '0.1', '0', '0'];
  const text = csv(header, [
    row('A', 0.5, 2), row('A', 10, 4),
    row('B', 0.5, 2),
    row('A', 0.5, 1, 'Oxidation M(4)'), row('B', 0.5, 0, 'Oxidation M(4)'),
  ]);
  const difference = peptideDifferences(parseHDX(text), { state: 'B', reference: 'A', exposure: 'all' });
  const plain = difference.rows.find((item) => !item.modification);
  const oxidized = difference.rows.find((item) => item.modification);
  // B has no 10 min point, so the sums cover 30 s only: no difference, although the 10 min point
  // of A alone would add 4 D.
  assert.equal(plain.delta, 0);
  assert.equal(plain.significant, false);
  assert.equal(oxidized.delta, -1, 'the oxidized form is compared on its own');
  assert.equal(difference.rows.length, 2);
});
