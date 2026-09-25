import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTriageMetric, rankTriage, triageCSVRows, triageMetric, triagePair, triageRecords, triageRows } from './triage.js';

const pair = (chainA, chainB, ipsae, extra = {}) => ({ chainA, chainB, ipsae, ipsaeAB: ipsae, ipsaeBA: ipsae - 0.01, iptm: ipsae + 0.1, pdockq: ipsae / 2, pdockq2: ipsae / 3, lis: ipsae / 4, contacts: 40, ...extra });
const model = (id, rank, rankingScore, pairs, extra = {}) => ({ id, rank, label: `sample ${rank - 1}`, scores: { rankingScore, iptm: rankingScore - 0.05, ptm: 0.8, chainIds: ['A', 'B', 'C'], chainPairIptm: [[0.9, 0.61, 0.2], [0.61, 0.9, 0.3], [0.2, 0.3, 0.9]] }, metrics: { pairs }, meanPlddt: 80 + rank, ...extra });

// Two AlphaFold 3 jobs and a ColabFold job. Their own ranking scores disagree with ipSAE.
const sets = [
  { id: 'p1', name: 'binder_1', root: 'campaign/binder_1', tool: 'af3', toolLabel: 'AlphaFold 3', models: [model('m1', 1, 0.9, [pair('A', 'B', 0.4)]), model('m2', 2, 0.8, [pair('A', 'B', 0.7)])] },
  { id: 'p2', name: 'binder_2', root: 'campaign/binder_2', tool: 'af3', toolLabel: 'AlphaFold 3', models: [model('m3', 1, 0.7, [pair('A', 'B', 0.55), pair('A', 'C', 0.8)])] },
  { id: 'p3', name: 'binder_3', root: 'campaign/binder_3', tool: 'colabfold', toolLabel: 'ColabFold', models: [model('m4', 1, 0.95, [], { problem: 'The PAE matrix (10 tokens) does not match the structure.' })] },
];

test('metric names and aliases', () => {
  assert.equal(triageMetric('ipSAE'), 'ipsae');
  assert.equal(triageMetric('score'), 'ranking');
  assert.equal(triageMetric('xl'), 'crosslinks');
  assert.equal(triageMetric('rmsd'), null);
});

test('the interface of a row: the best by ipSAE, or the chain pair asked for in either order', () => {
  const complex = sets[1].models[0];
  assert.deepEqual([triagePair(complex).chainA, triagePair(complex).chainB], ['A', 'C']);
  assert.equal(triagePair(complex, ['B', 'A']).ipsae, 0.55);
  assert.equal(triagePair(complex, ['B', 'C']), null);
  // mmCIF chain IDs are case-sensitive.
  assert.equal(triagePair(complex, ['a', 'b']), null);
  assert.equal(triagePair(sets[2].models[0]), null);
});

test('jobs rank by their best model under the metric; models without a value go last', () => {
  const rows = triageRows(sets);
  assert.equal(rows.length, 4);
  assert.equal(defaultTriageMetric(rows), 'ipsae');
  const jobs = rankTriage(rows, { metric: 'ipsae' });
  assert.deepEqual(jobs.map((row) => [row.position, row.job, row.model]), [[1, 'binder_2', 'sample 0'], [2, 'binder_1', 'sample 1'], [3, 'binder_3', 'sample 0']]);
  // The tools' own scores order the jobs differently.
  assert.deepEqual(rankTriage(rows, { metric: 'ranking' }).map((row) => row.job), ['binder_3', 'binder_1', 'binder_2']);
  // Every model, and a filter on the job name.
  assert.deepEqual(rankTriage(rows, { metric: 'ipsae', level: 'models' }).map((row) => row.modelId), ['m3', 'm2', 'm1', 'm4']);
  assert.deepEqual(rankTriage(rows, { metric: 'ipsae', filter: 'BINDER_1' }).map((row) => row.modelId), ['m2']);
  // A fixed chain pair: binder_2 is scored on A–B.
  const onAB = rankTriage(triageRows(sets, { pair: ['A', 'B'] }), { metric: 'ipsae' });
  assert.deepEqual(onAB.map((row) => [row.job, row.ipsae]), [['binder_1', 0.7], ['binder_2', 0.55], ['binder_3', NaN]]);
  // The reported ipTM is the predictor's chain-pair value for the interface; a job without the
  // pair has none, rather than its model-level ipTM.
  assert.equal(onAB[1].iptm, 0.61);
  assert.ok(Number.isNaN(onAB[2].iptm));
  assert.equal(rankTriage(triageRows(sets), { metric: 'ipsae' })[0].iptm, 0.2);
});

test('monomer campaigns rank by pLDDT; cross-links count when mapped', () => {
  const monomers = [{ id: 'q1', name: 'a', tool: 'boltz', toolLabel: 'Boltz', models: [{ id: 'x', rank: 1, label: 'model 0', scores: {}, meanPlddt: 70 }] }, { id: 'q2', name: 'b', tool: 'boltz', toolLabel: 'Boltz', models: [{ id: 'y', rank: 1, label: 'model 0', scores: {}, meanPlddt: 91 }] }];
  const rows = triageRows(monomers, { crosslinks: (item) => (item.id === 'x' ? { satisfied: 3, total: 4 } : { satisfied: 1, total: 4 }) });
  assert.equal(defaultTriageMetric(rows), 'plddt');
  assert.deepEqual(rankTriage(rows).map((row) => row.job), ['b', 'a']);
  assert.deepEqual(rankTriage(rows, { metric: 'crosslinks' }).map((row) => [row.job, row.crosslinks]), [['a', 0.75], ['b', 0.25]]);
});

test('jobs with the same name are told apart by their folder, in the table and the CSV', () => {
  const same = [{ ...sets[0], name: 'fold_input' }, { ...sets[1], name: 'fold_input' }];
  assert.deepEqual([...new Set(triageRows(same).map((row) => row.job))], ['campaign/binder_1', 'campaign/binder_2']);
  assert.deepEqual([...new Set(triageCSVRows(same).slice(1).map((row) => row[1]))], ['campaign/binder_1', 'campaign/binder_2']);
});

test('records for scripts use null for missing values; the CSV has one row per model and interface', () => {
  const records = triageRecords(rankTriage(triageRows(sets), { metric: 'ipsae' }));
  assert.deepEqual(records[0], { position: 1, job: 'binder_2', tool: 'AlphaFold 3', model: 'sample 0', rank: 1, chains: ['A', 'C'], ipsae: 0.8, pdockq: 0.4, pdockq2: 0.2667, lis: 0.2, iptm: 0.2, ptm: 0.8, rankingScore: 0.7, meanPlddt: 81, contacts: 40, crosslinks: null, problem: null });
  assert.equal(records[2].ipsae, null);
  assert.match(records[2].problem, /does not match/);
  const csv = triageCSVRows(sets);
  assert.equal(csv[0][1], 'job');
  assert.equal(csv.length, 1 + 2 + 2 + 1, 'header, two AF3 models of binder_1, two interfaces of binder_2, the ColabFold model');
  assert.deepEqual(csv[3].slice(0, 12), ['AlphaFold 3', 'binder_2', 1, 'sample 0', 0.7, 0.8, 0.65, 81, 'A', 'B', 0.61, 0.55]);
});
