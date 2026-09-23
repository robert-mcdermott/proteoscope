// Structure-prediction outputs: AlphaFold 3 (local runs and AlphaFold Server downloads), Boltz-1
// and Boltz-2, Chai-1, and ColabFold. detectPredictionSets() groups files into ranked models by
// their names alone; the parse functions read confidence files into one shape:
//
//   { rankingScore, ptm, iptm, chainIds, chainPtm, chainPairIptm, chainPairPaeMin,
//     fractionDisordered, hasClash, complexPlddt, extra }
//
// Files are { name, path, read(), text() } records; nothing here touches the DOM.

export const PREDICTION_TOOLS = {
  af3: 'AlphaFold 3',
  server: 'AlphaFold Server',
  boltz: 'Boltz',
  chai: 'Chai-1',
  colabfold: 'ColabFold',
};

function directory(path) {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function byDirectory(files) {
  const groups = new Map();
  for (const file of files) {
    const dir = directory(file.path);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(file);
  }
  return groups;
}

function baseName(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

// Returns { sets, rest }: recognized prediction sets and the files that belong to none.
export function detectPredictionSets(files) {
  const used = new Set();
  const sets = [];
  for (const detector of [detectServer, detectAF3, detectBoltz, detectChai, detectColabFold]) {
    for (const set of detector(files.filter((file) => !used.has(file)))) {
      for (const file of set.files) used.add(file);
      sets.push(set);
    }
  }
  return { sets, rest: files.filter((file) => !used.has(file)) };
}

function makeSet(tool, name, models, files, extras = {}) {
  return { tool, toolLabel: PREDICTION_TOOLS[tool], name, models, files, ...extras };
}

// AlphaFold Server: fold_<name>_model_<i>.cif with fold_<name>_full_data_<i>.json and
// fold_<name>_summary_confidences_<i>.json; model 0 ranks first.
function detectServer(files) {
  const sets = [];
  for (const [, group] of byDirectory(files)) {
    const jobs = new Map();
    for (const file of group) {
      const match = baseName(file.path).match(/^(fold_.+)_(model|full_data|summary_confidences)_(\d+)\.(cif|json)$/i);
      if (!match) continue;
      const [, job, kind, index] = match;
      if (!jobs.has(job)) jobs.set(job, new Map());
      const models = jobs.get(job);
      if (!models.has(index)) models.set(index, {});
      models.get(index)[kind.toLowerCase()] = file;
    }
    for (const [job, models] of jobs) {
      const list = [...models].filter(([, item]) => item.model).sort((a, b) => Number(a[0]) - Number(b[0]));
      if (!list.length) continue;
      const request = group.find((file) => baseName(file.path).toLowerCase() === `${job.toLowerCase()}_job_request.json`);
      const setFiles = [...list.flatMap(([, item]) => [item.model, item.full_data, item.summary_confidences]), request].filter(Boolean);
      sets.push(makeSet('server', job.replace(/^fold_/i, ''), list.map(([index, item]) => ({
        id: `model-${index}`,
        label: `Model ${index}`,
        order: Number(index),
        files: { structure: item.model, confidences: item.full_data ?? null, summary: item.summary_confidences ?? null },
      })), setFiles, { request }));
    }
  }
  return sets;
}

// AlphaFold 3 run folder: <job>_model.cif, <job>_summary_confidences.json, <job>_confidences.json,
// <job>_ranking_scores.csv, <job>_data.json at the top, and one folder per seed and sample
// (seed-<seed>_sample-<n>/) with the same three files, named with or without the prefix.
function detectAF3(files) {
  const sets = [];
  const topLevel = files.filter((file) => /_summary_confidences\.json$/i.test(file.path) && !/seed-\d+_sample-\d+/i.test(file.path));
  const handled = new Set();
  for (const summary of topLevel) {
    const dir = directory(summary.path);
    const job = baseName(summary.path).replace(/_summary_confidences\.json$/i, '');
    const key = `${dir}|${job}`;
    if (handled.has(key)) continue;
    handled.add(key);
    const inDir = files.filter((file) => file.path.startsWith(dir ? `${dir}/` : ''));
    const top = {
      structure: inDir.find((file) => directory(file.path) === dir && new RegExp(`^${escapeRegExp(job)}_model\\.(cif|bcif)(\\.zst)?$`, 'i').test(baseName(file.path))),
      confidences: inDir.find((file) => directory(file.path) === dir && new RegExp(`^${escapeRegExp(job)}_confidences\\.json(\\.zst)?$`, 'i').test(baseName(file.path))),
      summary,
    };
    const samples = new Map();
    for (const file of inDir) {
      const folder = file.path.match(/(?:^|\/)seed-(\d+)_sample-(\d+)\/[^/]+$/i);
      if (!folder || directory(directory(file.path)) !== dir) continue;
      const id = `seed-${folder[1]}_sample-${folder[2]}`;
      if (!samples.has(id)) samples.set(id, { seed: Number(folder[1]), sample: Number(folder[2]), files: {} });
      const item = samples.get(id).files;
      const name = baseName(file.path).toLowerCase();
      if (name.endsWith('summary_confidences.json')) item.summary = file;
      else if (/confidences\.json(\.zst)?$/.test(name)) item.confidences = file;
      else if (/model\.(cif|bcif)(\.zst)?$/.test(name)) item.structure = file;
    }
    const ranking = inDir.find((file) => directory(file.path) === dir && baseName(file.path).toLowerCase() === `${job.toLowerCase()}_ranking_scores.csv`);
    const data = inDir.find((file) => directory(file.path) === dir && baseName(file.path).toLowerCase() === `${job.toLowerCase()}_data.json`);
    let models = [...samples.values()]
      .filter((item) => item.files.structure)
      .sort((a, b) => a.seed - b.seed || a.sample - b.sample)
      .map((item, order) => ({ id: `seed-${item.seed}_sample-${item.sample}`, label: `Seed ${item.seed} · sample ${item.sample}`, order, files: { structure: item.files.structure, confidences: item.files.confidences ?? null, summary: item.files.summary ?? null } }));
    if (!models.length && top.structure) models = [{ id: 'top', label: 'Top model', order: 0, files: { structure: top.structure, confidences: top.confidences ?? null, summary } }];
    if (!models.length) continue;
    const setFiles = [top.structure, top.confidences, summary, ranking, data, ...models.flatMap((model) => Object.values(model.files))].filter(Boolean);
    sets.push(makeSet('af3', job, models, [...new Set(setFiles)], { data, ranking }));
  }
  return sets;
}

// Boltz: <name>_model_<k>.cif (or .pdb) with confidence_<name>_model_<k>.json and optional
// pae_/pde_/plddt_<name>_model_<k>.npz; model 0 has the highest confidence score. Boltz-2 adds
// affinity_<name>.json.
function detectBoltz(files) {
  const sets = [];
  for (const [dir, group] of byDirectory(files)) {
    const names = new Map();
    for (const file of group) {
      const match = baseName(file.path).match(/^confidence_(.+)_model_(\d+)\.json$/i);
      if (!match) continue;
      const [, name, index] = match;
      const structure = group.find((item) => new RegExp(`^${escapeRegExp(name)}_model_${index}\\.(cif|pdb|bcif)$`, 'i').test(baseName(item.path)));
      if (!structure) continue;
      const find = (prefix) => group.find((item) => baseName(item.path).toLowerCase() === `${prefix}_${name}_model_${index}.npz`.toLowerCase()) ?? null;
      if (!names.has(name)) names.set(name, []);
      names.get(name).push({ id: `model-${index}`, label: `Model ${index}`, order: Number(index), files: { structure, confidence: file, pae: find('pae'), plddt: find('plddt'), pde: find('pde') } });
    }
    for (const [name, models] of names) {
      models.sort((a, b) => a.order - b.order);
      const affinity = group.find((item) => baseName(item.path).toLowerCase() === `affinity_${name}.json`.toLowerCase()) ?? null;
      const msaDir = directory(directory(dir));
      const msas = files.filter((item) => directory(item.path) === `${msaDir ? `${msaDir}/` : ''}msa` && /\.(a3m|csv)$/i.test(item.path) && baseName(item.path).startsWith(name));
      const setFiles = [...models.flatMap((model) => Object.values(model.files)), affinity, ...msas].filter(Boolean);
      sets.push(makeSet('boltz', name, models, setFiles, { affinity, msas }));
    }
  }
  return sets;
}

// Chai-1: pred.model_idx_<i>.cif with scores.model_idx_<i>.npz (ranked here by aggregate score)
// and, when written, pae.model_idx_<i>.npy.
function detectChai(files) {
  const sets = [];
  for (const [dir, group] of byDirectory(files)) {
    const models = [];
    for (const file of group) {
      const match = baseName(file.path).match(/^pred\.model_idx_(\d+)\.(cif|pdb|bcif)$/i);
      if (!match) continue;
      const index = match[1];
      const find = (pattern) => group.find((item) => pattern.test(baseName(item.path))) ?? null;
      models.push({
        id: `model-${index}`,
        label: `Model ${index}`,
        order: Number(index),
        files: { structure: file, scores: find(new RegExp(`^scores\\.model_idx_${index}\\.npz$`, 'i')), pae: find(new RegExp(`^pae\\.model_idx_${index}\\.(npy|npz)$`, 'i')) },
      });
    }
    if (!models.length) continue;
    models.sort((a, b) => a.order - b.order);
    const setFiles = models.flatMap((model) => Object.values(model.files)).filter(Boolean);
    sets.push(makeSet('chai', baseName(dir) || 'Chai-1', models, setFiles));
  }
  return sets;
}

// ColabFold: <name>_(unrelaxed|relaxed)_rank_<r>_<model>.pdb with
// <name>_scores_rank_<r>_<model>.json; relaxed structures win over unrelaxed ones.
function detectColabFold(files) {
  const sets = [];
  for (const [, group] of byDirectory(files)) {
    const jobs = new Map();
    for (const file of group) {
      const match = baseName(file.path).match(/^(.+?)_(unrelaxed|relaxed)_rank_(\d+)_(.+)\.(pdb|cif)$/i);
      if (!match) continue;
      const [, name, relax, rank, model] = match;
      if (!jobs.has(name)) jobs.set(name, new Map());
      const ranks = jobs.get(name);
      const existing = ranks.get(rank);
      if (existing && !(relax.toLowerCase() === 'relaxed' && existing.relax === 'unrelaxed')) continue;
      const scores = group.find((item) => baseName(item.path) === `${name}_scores_rank_${rank}_${model}.json`) ?? null;
      ranks.set(rank, { relax: relax.toLowerCase(), model, structure: file, scores, unrelaxed: existing?.structure ?? null });
    }
    for (const [name, ranks] of jobs) {
      const models = [...ranks].sort((a, b) => Number(a[0]) - Number(b[0])).map(([rank, item]) => ({
        id: `rank-${rank}`,
        label: `Rank ${Number(rank)} · ${item.model.replace(/^alphafold2_/, '').replace(/_/g, ' ')}`,
        order: Number(rank) - 1,
        files: { structure: item.structure, scores: item.scores, unrelaxed: item.unrelaxed },
      }));
      const a3m = group.find((item) => baseName(item.path) === `${name}.a3m`) ?? null;
      const pae = group.find((item) => baseName(item.path) === `${name}_predicted_aligned_error_v1.json`) ?? null;
      const setFiles = [...models.flatMap((model) => Object.values(model.files)), a3m, pae].filter(Boolean);
      // Unrelaxed duplicates of relaxed ranks and the rank-1 PAE copy belong to the set too.
      for (const file of group) {
        if (new RegExp(`^${escapeRegExp(name)}_(unrelaxed|relaxed)_rank_`).test(baseName(file.path))) setFiles.push(file);
      }
      sets.push(makeSet('colabfold', name, models, [...new Set(setFiles)], { msas: a3m ? [a3m] : [] }));
    }
  }
  return sets;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------- Confidence files ---------- */

const number = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : NaN);

// AlphaFold 3 and AlphaFold Server summary_confidences.
export function parseAF3Summary(json) {
  return {
    rankingScore: number(json.ranking_score),
    ptm: number(json.ptm),
    iptm: number(json.iptm),
    chainPtm: Array.isArray(json.chain_ptm) ? json.chain_ptm.map(number) : null,
    chainIptm: Array.isArray(json.chain_iptm) ? json.chain_iptm.map(number) : null,
    chainPairIptm: matrixOf(json.chain_pair_iptm),
    chainPairPaeMin: matrixOf(json.chain_pair_pae_min),
    fractionDisordered: number(json.fraction_disordered),
    hasClash: json.has_clash === undefined ? null : Boolean(Number(json.has_clash)),
  };
}

function matrixOf(value) {
  return Array.isArray(value) && value.every(Array.isArray) ? value.map((row) => row.map(number)) : null;
}

// AlphaFold 3 confidences (full_data for the Server): PAE over tokens, token chain ids and residue
// numbers, per-atom pLDDT and contact probabilities.
export function parseAF3Confidences(json) {
  const pae = flatSquare(json.pae);
  return {
    pae,
    tokenChainIds: Array.isArray(json.token_chain_ids) ? json.token_chain_ids.map(String) : null,
    tokenResIds: Array.isArray(json.token_res_ids) ? json.token_res_ids.map(Number) : null,
    atomPlddts: Array.isArray(json.atom_plddts) ? Float32Array.from(json.atom_plddts, number) : null,
    atomChainIds: Array.isArray(json.atom_chain_ids) ? json.atom_chain_ids.map(String) : null,
    contactProbs: flatSquare(json.contact_probs),
  };
}

export function flatSquare(rows) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0]) || rows[0].length !== rows.length) return null;
  const size = rows.length;
  const matrix = new Float32Array(size * size);
  for (let row = 0; row < size; row += 1) {
    const values = rows[row];
    for (let column = 0; column < size; column += 1) matrix[row * size + column] = Number(values[column]) || 0;
  }
  return { size, matrix };
}

// Boltz confidence_<name>_model_<k>.json; chains are keyed by their index in the structure file.
export function parseBoltzConfidence(json) {
  const chainPtm = json.chains_ptm ? Object.keys(json.chains_ptm).sort((a, b) => a - b).map((key) => number(json.chains_ptm[key])) : null;
  let chainPairIptm = null;
  if (json.pair_chains_iptm) {
    const keys = Object.keys(json.pair_chains_iptm).sort((a, b) => a - b);
    chainPairIptm = keys.map((a) => keys.map((b) => number(json.pair_chains_iptm[a]?.[b])));
  }
  return {
    rankingScore: number(json.confidence_score),
    ptm: number(json.ptm),
    iptm: number(json.iptm),
    chainPtm,
    chainPairIptm,
    complexPlddt: number(json.complex_plddt) * (number(json.complex_plddt) <= 1 ? 100 : 1),
    extra: {
      ligandIptm: number(json.ligand_iptm),
      proteinIptm: number(json.protein_iptm),
      complexIplddt: number(json.complex_iplddt),
      complexPde: number(json.complex_pde),
      complexIpde: number(json.complex_ipde),
    },
  };
}

// Boltz-2 binding-affinity predictions.
export function parseBoltzAffinity(json) {
  return {
    value: number(json.affinity_pred_value),
    probability: number(json.affinity_probability_binary),
  };
}

// Chai-1 scores.model_idx_<i>.npz arrays (with a leading batch axis).
export function parseChaiScores(arrays) {
  const scalar = (key) => {
    const array = arrays.get(key);
    return array ? number(array.data[0]) : NaN;
  };
  const vector = (key) => {
    const array = arrays.get(key);
    return array ? Array.from(array.data, number) : null;
  };
  let chainPairIptm = null;
  const pair = arrays.get('per_chain_pair_iptm');
  if (pair) {
    const n = pair.shape[pair.shape.length - 1];
    chainPairIptm = Array.from({ length: n }, (_, row) => Array.from({ length: n }, (__, column) => number(pair.data[row * n + column])));
  }
  const clashes = arrays.get('has_inter_chain_clashes');
  return {
    rankingScore: scalar('aggregate_score'),
    ptm: scalar('ptm'),
    iptm: scalar('iptm'),
    chainPtm: vector('per_chain_ptm'),
    chainPairIptm,
    hasClash: clashes ? Boolean(clashes.data[0]) : null,
  };
}

// ColabFold scores JSON: per-residue pLDDT, the PAE matrix, pTM and (for complexes) ipTM.
export function parseColabFoldScores(json) {
  const plddt = Array.isArray(json.plddt) ? json.plddt.map(number) : null;
  const ptm = number(json.ptm);
  const iptm = number(json.iptm);
  const meanPlddt = plddt?.length ? plddt.reduce((sum, value) => sum + value, 0) / plddt.length : NaN;
  return {
    // ColabFold ranks complexes by 0.8·ipTM + 0.2·pTM and single chains by mean pLDDT.
    rankingScore: Number.isFinite(iptm) ? 0.8 * iptm + 0.2 * ptm : meanPlddt,
    ptm,
    iptm,
    complexPlddt: meanPlddt,
    pae: flatSquare(json.pae ?? json.predicted_aligned_error),
    plddt,
  };
}

/* ---------- Tokens ---------- */

const STANDARD_RESIDUES = new Set([
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE', 'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
  'A', 'C', 'G', 'U', 'DA', 'DC', 'DG', 'DT', 'UNK', 'N', 'DN',
]);

// The tokens of a model in the order AlphaFold 3-style predictors use: one per standard residue,
// one per heavy atom of ligands and modified residues. With perResidue, every residue is one
// token (AlphaFold 2 / ColabFold). As in ipsae.py, a residue's token is scored at its Cβ (Cα for
// glycine, C3′ for nucleotides), which gives both the distance and the pLDDT; of a modified
// residue's atom tokens only the Cα (or C1′) one takes part in interface scores.
export function modelTokens(model, options = {}) {
  const tokens = [];
  const perResidue = Boolean(options.perResidue);
  const seen = new Set();
  for (const atom of model.atoms) {
    const residue = model.residues[model.atomResidue[atom.id]];
    if (!residue || residue.kind === 'water') continue;
    const polymer = residue.kind === 'protein' || residue.kind === 'nucleic';
    const standard = polymer && STANDARD_RESIDUES.has(residue.resName);
    if (perResidue || standard) {
      if (perResidue && !polymer) continue;
      if (seen.has(residue.key)) continue;
      seen.add(residue.key);
      tokens.push(residueToken(residue, polymer));
    } else if (!atom.isHydrogen) {
      const representative = polymer && (atom.name === 'CA' || atom.name === "C1'");
      tokens.push(representative ? { ...residueToken(residue, true), atom } : { residue, atom, chain: residue.chain, polymer: false, nucleic: false, plddtAtom: atom, position: [atom.x, atom.y, atom.z] });
    }
  }
  return tokens;
}

function residueToken(residue, polymer) {
  const byName = residue.atomByName;
  const nucleic = residue.kind === 'nucleic';
  const center = (nucleic ? byName.get("C1'") : byName.get('CA')) ?? residue.representative;
  const scored = (nucleic ? byName.get("C3'") : residue.resName === 'GLY' ? byName.get('CA') : byName.get('CB') ?? byName.get('CA')) ?? center;
  return {
    residue,
    chain: residue.chain,
    polymer,
    nucleic,
    plddtAtom: scored,
    position: scored ? [scored.x, scored.y, scored.z] : null,
  };
}

// Picks the tokenization that matches the PAE size: AlphaFold 3-style first, then one token per
// polymer residue. Returns null when neither fits.
export function tokensForPAE(model, size) {
  const af3 = modelTokens(model);
  if (af3.length === size) return af3;
  const residues = modelTokens(model, { perResidue: true });
  if (residues.length === size) return residues;
  return null;
}

// Ranks models by their ranking score (higher first), falling back to file order.
export function rankModels(models) {
  const ranked = models.slice().sort((a, b) => {
    const left = a.scores?.rankingScore;
    const right = b.scores?.rankingScore;
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return right - left;
    return a.order - b.order;
  });
  ranked.forEach((model, index) => {
    model.rank = index + 1;
  });
  return ranked;
}
