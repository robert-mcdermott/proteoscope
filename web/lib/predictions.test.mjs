import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStructure } from './parse.js';
import { deriveStructure } from './structure.js';
import {
  MISSING_PAE,
  detectPredictionSets,
  flatSquare,
  insidePredictionFolder,
  modelTokens,
  parseAF3Confidences,
  parseAF3Summary,
  parseBoltzConfidence,
  parseChaiScores,
  parseColabFoldScores,
  parseOpenFold3Aggregated,
  parsePredictionJSON,
  parseProtenixFullData,
  parseProtenixSummary,
  rankModels,
  tokensForPAE,
} from './predictions.js';
import { interfaceScores, pDockQ, tmD0 } from './interface-scores.js';
import { examplePDB } from './test-data.mjs';

const file = (path) => ({ path, name: path.split('/').pop() });
const paths = (set) => set.models.map((model) => [model.id, model.files.structure.path]);

test('prediction folders of each tool are recognized and grouped into models', () => {
  const files = [
    // AlphaFold Server download (flattened zip).
    'fold_pd1/fold_pd1_model_0.cif', 'fold_pd1/fold_pd1_model_1.cif', 'fold_pd1/fold_pd1_full_data_0.json', 'fold_pd1/fold_pd1_full_data_1.json',
    'fold_pd1/fold_pd1_summary_confidences_0.json', 'fold_pd1/fold_pd1_summary_confidences_1.json', 'fold_pd1/fold_pd1_job_request.json',
    // AlphaFold 3 run.
    'job/job_model.cif', 'job/job_confidences.json', 'job/job_summary_confidences.json', 'job/job_ranking_scores.csv', 'job/job_data.json',
    'job/seed-1_sample-0/model.cif', 'job/seed-1_sample-0/confidences.json', 'job/seed-1_sample-0/summary_confidences.json',
    'job/seed-1_sample-1/job_seed-1_sample-1_model.cif', 'job/seed-1_sample-1/job_seed-1_sample-1_confidences.json', 'job/seed-1_sample-1/job_seed-1_sample-1_summary_confidences.json',
    // Boltz.
    'boltz_results_x/predictions/x/x_model_0.cif', 'boltz_results_x/predictions/x/confidence_x_model_0.json', 'boltz_results_x/predictions/x/pae_x_model_0.npz',
    'boltz_results_x/predictions/x/x_model_1.cif', 'boltz_results_x/predictions/x/confidence_x_model_1.json', 'boltz_results_x/msa/x_0.csv',
    // Chai-1.
    'chai/pred.model_idx_0.cif', 'chai/pred.model_idx_1.cif', 'chai/scores.model_idx_0.npz', 'chai/scores.model_idx_1.npz',
    // ColabFold, with one relaxed rank.
    'cf/p53_unrelaxed_rank_001_alphafold2_ptm_model_3_seed_000.pdb', 'cf/p53_relaxed_rank_001_alphafold2_ptm_model_3_seed_000.pdb',
    'cf/p53_scores_rank_001_alphafold2_ptm_model_3_seed_000.json', 'cf/p53_unrelaxed_rank_002_alphafold2_ptm_model_1_seed_000.pdb',
    'cf/p53_scores_rank_002_alphafold2_ptm_model_1_seed_000.json', 'cf/p53.a3m', 'cf/p53_predicted_aligned_error_v1.json',
    // Protenix, two seeds; only the second was run with --need_atom_confidence.
    'px/seed_7/predictions/px_sample_0.cif', 'px/seed_7/predictions/px_summary_confidence_sample_0.json',
    'px/seed_3/predictions/px_sample_0.cif', 'px/seed_3/predictions/px_summary_confidence_sample_0.json', 'px/seed_3/predictions/px_full_data_sample_0.json',
    // OpenFold3, and a service export that drops the seed from the names.
    'of/q1/seed_42/q1_seed_42_sample_2_model.cif', 'of/q1/seed_42/q1_seed_42_sample_2_confidences_aggregated.json', 'of/q1/seed_42/q1_seed_42_sample_2_confidences.json',
    'of/q1/seed_42/q1_seed_42_sample_1_model.cif', 'of/q1/seed_42/q1_seed_42_sample_1_confidences_aggregated.json',
    'svc/results/result_sample_1_model.pdb', 'svc/results/result_sample_1_confidences_aggregated.json',
    // Not part of any prediction.
    'notes/1abc.cif', 'notes/session.proteoscope.json', 'notes/loose_sample_0.cif',
  ].map(file);
  const { sets, rest } = detectPredictionSets(files);
  const byTool = Object.fromEntries(sets.map((set) => [set.tool === 'openfold3' ? `${set.tool}:${set.name}` : set.tool, set]));
  assert.deepEqual(Object.keys(byTool).sort(), ['af3', 'boltz', 'chai', 'colabfold', 'openfold3:q1', 'openfold3:result', 'protenix', 'server']);
  assert.deepEqual(paths(byTool.server), [['model-0', 'fold_pd1/fold_pd1_model_0.cif'], ['model-1', 'fold_pd1/fold_pd1_model_1.cif']]);
  assert.equal(byTool.server.name, 'pd1');
  assert.equal(byTool.server.models[1].files.confidences.path, 'fold_pd1/fold_pd1_full_data_1.json');
  assert.deepEqual(paths(byTool.af3), [['seed-1_sample-0', 'job/seed-1_sample-0/model.cif'], ['seed-1_sample-1', 'job/seed-1_sample-1/job_seed-1_sample-1_model.cif']]);
  assert.equal(byTool.af3.models[1].files.summary.path, 'job/seed-1_sample-1/job_seed-1_sample-1_summary_confidences.json');
  assert.equal(byTool.af3.data.path, 'job/job_data.json');
  assert.equal(byTool.boltz.models[0].files.pae.path, 'boltz_results_x/predictions/x/pae_x_model_0.npz');
  assert.equal(byTool.boltz.models[1].files.pae, null);
  assert.deepEqual(byTool.boltz.msas.map((item) => item.path), ['boltz_results_x/msa/x_0.csv']);
  assert.deepEqual(byTool.chai.models.map((model) => model.files.scores.path), ['chai/scores.model_idx_0.npz', 'chai/scores.model_idx_1.npz']);
  assert.equal(byTool.colabfold.models[0].files.structure.path, 'cf/p53_relaxed_rank_001_alphafold2_ptm_model_3_seed_000.pdb', 'relaxed wins');
  assert.equal(byTool.colabfold.models[0].label, 'Rank 1 · ptm model 3 seed 000');
  assert.deepEqual(byTool.colabfold.msas.map((item) => item.path), ['cf/p53.a3m']);
  assert.deepEqual(paths(byTool.protenix), [['seed-3_sample-0', 'px/seed_3/predictions/px_sample_0.cif'], ['seed-7_sample-0', 'px/seed_7/predictions/px_sample_0.cif']], 'seeds of one job form one set');
  assert.deepEqual(byTool.protenix.models.map((model) => model.files.confidences?.path ?? null), ['px/seed_3/predictions/px_full_data_sample_0.json', null]);
  assert.equal(byTool.protenix.models[1].label, 'Seed 7 · sample 0');
  assert.deepEqual(paths(byTool['openfold3:q1']), [['seed-42_sample-1', 'of/q1/seed_42/q1_seed_42_sample_1_model.cif'], ['seed-42_sample-2', 'of/q1/seed_42/q1_seed_42_sample_2_model.cif']]);
  assert.equal(byTool['openfold3:q1'].models[1].files.confidences.path, 'of/q1/seed_42/q1_seed_42_sample_2_confidences.json');
  assert.equal(byTool['openfold3:result'].models[0].label, 'Sample 1');
  assert.deepEqual(rest.map((item) => item.path), ['notes/1abc.cif', 'notes/session.proteoscope.json', 'notes/loose_sample_0.cif']);
  // Each set knows the folder its predictor wrote; other files there are not annotations.
  assert.deepEqual(['server', 'af3', 'boltz', 'chai', 'colabfold', 'protenix', 'openfold3:q1', 'openfold3:result'].map((key) => byTool[key].root), ['fold_pd1', 'job', 'boltz_results_x', 'chai', 'cf', 'px', 'of/q1', 'svc/results']);
  assert.deepEqual(['fold_pd1/templates/fold_pd1_template_hit_0_chains_a.cif', 'boltz_results_x/processed/records/x.json', 'svc/results/timing.json', 'notes/1abc.cif'].map((path) => insidePredictionFolder(file(path), sets)), [true, true, true, false]);
});

test('confidence files of each predictor parse into one score shape', () => {
  const summary = parseAF3Summary({ ranking_score: 0.87, ptm: 0.8, iptm: 0.78, chain_pair_iptm: [[0.9, 0.78], [0.78, 0.85]], chain_ptm: [0.9, 0.85], fraction_disordered: 0.05, has_clash: 0 });
  assert.deepEqual([summary.rankingScore, summary.iptm, summary.chainPairIptm[0][1], summary.hasClash], [0.87, 0.78, 0.78, false]);
  const confidences = parseAF3Confidences({ pae: [[0.5, 3], [4, 0.6]], contact_probs: [[1, 0.2], [0.2, 1]], token_chain_ids: ['A', 'B'], token_res_ids: [1, 1], atom_plddts: [91, 88] });
  assert.equal(confidences.pae.size, 2);
  assert.equal(confidences.pae.matrix[2], 4);
  assert.equal(confidences.contactProbs.matrix[1], Math.fround(0.2));
  assert.deepEqual(confidences.tokenChainIds, ['A', 'B']);
  assert.equal(flatSquare([[1, 2, 3]]), null, 'not square');

  const boltz = parseBoltzConfidence({ confidence_score: 0.9, ptm: 0.85, iptm: 0.8, complex_plddt: 0.88, chains_ptm: { 0: 0.9, 1: 0.7 }, pair_chains_iptm: { 0: { 0: 0.9, 1: 0.6 }, 1: { 0: 0.62, 1: 0.7 } }, ligand_iptm: 0 });
  assert.deepEqual(boltz.chainPairIptm, [[0.9, 0.6], [0.62, 0.7]]);
  assert.equal(boltz.complexPlddt, 88);

  const chai = parseChaiScores(new Map([
    ['aggregate_score', { shape: [1], data: Float32Array.from([0.7]) }],
    ['per_chain_pair_iptm', { shape: [1, 2, 2], data: Float32Array.from([0.9, 0.5, 0.5, 0.8]) }],
    ['has_inter_chain_clashes', { shape: [1], data: Uint8Array.from([1]) }],
  ]));
  assert.equal(chai.rankingScore, Math.fround(0.7));
  assert.equal(chai.chainPairIptm[0][1], 0.5);
  assert.equal(chai.hasClash, true);

  const colab = parseColabFoldScores({ plddt: [90, 80], pae: [[0.3, 5], [6, 0.3]], ptm: 0.7, iptm: 0.6, max_pae: 31.75 });
  assert.ok(Math.abs(colab.rankingScore - (0.8 * 0.6 + 0.2 * 0.7)) < 1e-12);
  assert.equal(colab.pae.size, 2);
  assert.equal(parseColabFoldScores({ plddt: [90, 70], ptm: 0.7 }).rankingScore, 80, 'monomers rank by mean pLDDT');

  const models = rankModels([{ order: 0, scores: { rankingScore: 0.2 } }, { order: 1, scores: { rankingScore: 0.9 } }, { order: 2, scores: {} }]);
  assert.deepEqual(models.map((model) => [model.order, model.rank]), [[1, 1], [0, 2], [2, 3]]);
});

// Shapes of real Protenix v1 and OpenFold3 outputs (the LIVIA p53–MDM2 examples).
test('Protenix and OpenFold3 confidence files, including the bare NaN Python writes', () => {
  const protenix = parseProtenixSummary({
    plddt: 63.52, gpde: 1.98, ptm: 0.335, iptm: 0.242, chain_ptm: [0.546, 0.246], chain_iptm: [0.242, 0.242],
    chain_pair_iptm: [[0, 0.242], [0.242, 0]], chain_plddt: [0.72, 0.567], has_clash: false, disorder: 0, ranking_score: 0.261, num_recycles: 10,
  });
  assert.deepEqual([protenix.rankingScore, protenix.iptm, protenix.chainPairIptm[1][0], protenix.chainPtm[1], protenix.hasClash, protenix.fractionDisordered, protenix.complexPlddt], [0.261, 0.242, 0.242, 0.246, false, 0, 63.52]);

  const full = parseProtenixFullData(parsePredictionJSON('{"token_pair_pae": [[0.8, NaN], [12.5, 0.76]], "contact_probs": [[1.0, 0.02], [0.02, 1.0]], "atom_plddt": [0.71, NaN]}'));
  assert.deepEqual(Array.from(full.pae.matrix), [0.8, MISSING_PAE, 12.5, 0.76].map(Math.fround), 'undefined PAE counts as the largest error');
  assert.equal(full.contactProbs.size, 2);
  assert.deepEqual(parsePredictionJSON('{"a": [-Infinity, NaN], "b": "NaN, kept"}'), { a: [null, null], b: 'NaN, kept' });
  assert.throws(() => parsePredictionJSON('{"a": }'), SyntaxError);

  const openfold = parseOpenFold3Aggregated({
    avg_plddt: 55.35, gpde: 2.19, iptm: 0.157, ptm: 0.317, disorder: 0.07, has_clash: 0.0, sample_ranking_score: 0.224,
    chain_ptm: { A: 0.514, B: 0.236 }, chain_pair_iptm: { '(A, B)': 0.157 }, bespoke_iptm: { '(A, B)': 0.157 },
  });
  assert.deepEqual(openfold.chainIds, ['A', 'B']);
  assert.deepEqual(openfold.chainPairIptm, [[0.514, 0.157], [0.157, 0.236]]);
  assert.deepEqual([openfold.rankingScore, openfold.hasClash, openfold.complexPlddt, openfold.fractionDisordered], [0.224, false, 55.35, 0.07]);
});

// Two short chains (A: 3 residues, B: 2) plus a two-atom ligand and a phosphoserine, the way
// AlphaFold 3 tokenizes them.
const COMPLEX = [
  ['ATOM', 'N', 'MET', 'A', 1, 0, 0, 0, 90], ['ATOM', 'CA', 'MET', 'A', 1, 1.4, 0, 0, 90], ['ATOM', 'CB', 'MET', 'A', 1, 1.9, 1.4, 0, 90],
  ['ATOM', 'N', 'GLY', 'A', 2, 3.8, 0, 0, 85], ['ATOM', 'CA', 'GLY', 'A', 2, 5.2, 0, 0, 85],
  ['HETATM', 'N', 'SEP', 'A', 3, 7.6, 0, 0, 70], ['HETATM', 'CA', 'SEP', 'A', 3, 9.0, 0, 0, 70], ['HETATM', 'P', 'SEP', 'A', 3, 10.0, 1.0, 0, 60],
  ['ATOM', 'N', 'ALA', 'B', 1, 1.9, 6.0, 0, 80], ['ATOM', 'CA', 'ALA', 'B', 1, 1.9, 5.0, 0, 80], ['ATOM', 'CB', 'ALA', 'B', 1, 1.9, 4.0, 0, 80],
  ['ATOM', 'N', 'LYS', 'B', 2, 30, 30, 30, 40], ['ATOM', 'CA', 'LYS', 'B', 2, 31, 30, 30, 40], ['ATOM', 'CB', 'LYS', 'B', 2, 32, 30, 30, 40],
  ['HETATM', 'C1', 'LIG', 'C', 1, 3, 3, 3, 50], ['HETATM', 'O1', 'LIG', 'C', 1, 4, 3, 3, 55],
];

function complexModel() {
  const lines = COMPLEX.map(([record, name, resName, chain, seq, x, y, z, b], index) => `${record.padEnd(6)}${String(index + 1).padStart(5)} ${name.padEnd(4)} ${resName.padStart(3)} ${chain}${String(seq).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00${b.toFixed(2).padStart(6)}          ${name[0].padStart(2)}`);
  const structure = parseStructure(`${lines.join('\n')}\nEND\n`, 'model.pdb');
  structure.meta.isPredicted = true;
  deriveStructure(structure);
  return structure.models[0];
}

test('models tokenize like AlphaFold 3: residues, then per-atom modified residues and ligands', () => {
  const model = complexModel();
  const tokens = modelTokens(model);
  assert.deepEqual(tokens.map((token) => `${token.chain}${token.residue.resSeq}${token.atom ? `@${token.atom.name}` : ''}`), ['A1', 'A2', 'A3@N', 'A3@CA', 'A3@P', 'B1', 'B2', 'C1@C1', 'C1@O1']);
  // Of the phosphoserine's atom tokens only the Cα one takes part in interface scores.
  assert.deepEqual(tokens.filter((token) => token.polymer).map((token) => token.chain + token.residue.resSeq), ['A1', 'A2', 'A3', 'B1', 'B2']);
  assert.deepEqual(tokens[0].position, [1.9, 1.4, 0], 'Cβ for distances');
  assert.deepEqual(tokens[1].position, [5.2, 0, 0], 'Cα for glycine');
  assert.equal(tokensForPAE(model, 9).length, 9);
  assert.equal(tokensForPAE(model, 5).length, 5, 'one token per polymer residue (AlphaFold 2)');
  assert.equal(tokensForPAE(model, 7), null);
});

test('interface scores follow the ipSAE, pDockQ, pDockQ2 and LIS definitions', () => {
  assert.equal(tmD0(10), 1, 'd0 is at least 1 Å (L floored at 26)');
  assert.ok(Math.abs(tmD0(27) - (1.24 * Math.cbrt(12) - 1.8)) < 1e-12);
  assert.equal(tmD0(1, true), 2, 'nucleic acids have d0 ≥ 2');
  const model = complexModel();
  const tokens = tokensForPAE(model, 9);
  tokens.forEach((token) => {
    token.plddt = token.plddtAtom.bFactor;
  });
  const n = 9;
  const matrix = new Float32Array(n * n).fill(25);
  for (let i = 0; i < n; i += 1) matrix[i * n + i] = 0.5;
  // A1 is confidently placed against B1 (both directions); everything else is not.
  matrix[0 * n + 5] = 2;
  matrix[5 * n + 0] = 3;
  const scores = interfaceScores({ size: n, matrix }, tokens);
  assert.deepEqual(scores.chains, ['A', 'B']);
  const [pair] = scores.pairs;
  const d0 = 1;
  assert.ok(Math.abs(pair.ipsaeAB - 1 / (1 + (2 / d0) ** 2)) < 1e-6);
  assert.ok(Math.abs(pair.ipsaeBA - 1 / (1 + (3 / d0) ** 2)) < 1e-6);
  assert.equal(pair.ipsae, pair.ipsaeAB);
  // LIS: only the pairs with PAE ≤ 12 count, one per direction.
  assert.ok(Math.abs(pair.lis - ((12 - 2) / 12 + (12 - 3) / 12) / 2) < 1e-6);
  // Contacts: A1 Cβ–B1 Cβ are 2.6 Å apart; A2 (Gly Cα) is 5.8 Å from B1 Cβ.
  assert.equal(pair.contacts, 2);
  const expected = 0.724 / (1 + Math.exp(-0.052 * (((90 + 85 + 80) / 3) * Math.log10(2) - 152.611))) + 0.018;
  assert.ok(Math.abs(pair.pdockq - expected) < 1e-9);
  assert.equal(pDockQ(tokens, { pairs: [], residuesA: new Set(), residuesB: new Set() }), 0);
  assert.ok(pair.pdockq2 > 0 && pair.pdockq2 < 0.1, 'high PAE on most contacts keeps pDockQ2 low');
  assert.throws(() => interfaceScores({ size: 4, matrix: new Float32Array(16) }, tokens), /4 rows/);
});

// The MDM2–p53 peptide complex 1YCR (chains A and B) with a made-up PAE whose values are whole
// multiples of 0.25 Å, including exact hits on the 10, 12 and 15 Å cutoffs. The expected values
// are the output of Dunbrack's ipsae.py (version 4) on the same PDB and matrix, written as an
// AlphaFold 2 scores file, at "10 10" and "15 15".
test('interface scores match ipsae.py on a reference complex', () => {
  const lines = examplePDB('1ycr').split('\n').filter((line) => line.startsWith('ATOM') && 'AB'.includes(line[21]) && ' A'.includes(line[16]));
  const structure = parseStructure(`${lines.join('\n')}\nEND\n`, '1ycr_AB.pdb');
  deriveStructure(structure);
  const model = structure.models[0];
  const chains = model.residues.filter((residue) => residue.kind === 'protein').map((residue) => residue.chain);
  const n = chains.length;
  assert.equal(n, 98);
  const matrix = new Float32Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      let k;
      if (i === j) k = 1;
      else if (chains[i] === chains[j]) k = 2 + (Math.abs(i - j) % 23);
      else if (chains[i] === 'A') k = i >= 45 && i <= 70 && j >= 88 ? 2 + ((i * 31 + j * 17) % 45) : 40 + ((i * 13 + j * 7) % 87);
      else k = j >= 40 && j <= 75 && i >= 86 ? 3 + ((i * 11 + j * 29) % 50) : 44 + ((i * 5 + j * 19) % 83);
      matrix[i * n + j] = k / 4;
    }
  }
  const tokens = tokensForPAE(model, n);
  tokens.forEach((token, index) => {
    token.plddt = 35 + ((index * 37) % 61) + 0.5;
  });
  const close = (actual, expected, digits) => assert.ok(Math.abs(actual - expected) <= 0.5 * 10 ** -digits, `${actual} vs ${expected}`);
  for (const [cutoff, ab, ba] of [[10, 0.205545, 0.117352], [15, 0.169487, 0.164811]]) {
    const [pair] = interfaceScores({ size: n, matrix }, tokens, { paeCutoff: cutoff }).pairs;
    close(pair.ipsaeAB, ab, 6);
    close(pair.ipsaeBA, ba, 6);
    close(pair.iptmAB, 0.366459, 6);
    close(pair.iptmBA, 0.165261, 6);
    close(pair.pdockq, 0.0623, 4);
    close(pair.pdockq2, 0.0254, 4);
    close(pair.lis, 0.4250, 4);
  }
});
