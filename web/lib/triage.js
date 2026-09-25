// Batch triage: ranks the models of many prediction jobs (a design campaign, say) on one table.
// ipSAE, pDockQ, pDockQ2 and LIS are computed the same way for every predictor, from each
// model's PAE and coordinates, so they compare jobs from different tools; ipTM, pTM and the
// ranking score are each tool's own. Sets and models are the records of predictions.js after
// scoring: { name, root, tool, toolLabel, models: [{ rank, label, scores, metrics, meanPlddt }] }.
// Nothing here touches the DOM.

export const TRIAGE_METRICS = [
  { id: 'ipsae', label: 'ipSAE', title: 'ipSAE of the interface (Dunbrack 2025), computed from the PAE' },
  { id: 'pdockq2', label: 'pDockQ2', title: 'pDockQ2 of the interface (Zhu et al. 2023)' },
  { id: 'pdockq', label: 'pDockQ', title: 'pDockQ of the interface (Bryant et al. 2022)' },
  { id: 'lis', label: 'LIS', title: 'Local interaction score of the interface (Kim et al. 2024)' },
  { id: 'iptm', label: 'ipTM', title: 'ipTM as the predictor reports it' },
  { id: 'ranking', label: 'Score', title: 'The predictor\'s own ranking score; not comparable between tools' },
  { id: 'ptm', label: 'pTM', title: 'pTM as the predictor reports it' },
  { id: 'plddt', label: 'pLDDT', title: 'Mean pLDDT of the protein and nucleic-acid residues' },
  { id: 'crosslinks', label: 'XL', title: 'Cross-links satisfied, of those mapped in the Proteomics tab' },
];

const METRIC_ALIASES = {
  ipsae: 'ipsae', pdockq2: 'pdockq2', pdockq: 'pdockq', lis: 'lis', iptm: 'iptm', ptm: 'ptm',
  ranking: 'ranking', score: 'ranking', rank: 'ranking', ranking_score: 'ranking',
  plddt: 'plddt', confidence: 'plddt',
  crosslinks: 'crosslinks', xl: 'crosslinks', xlinks: 'crosslinks', links: 'crosslinks',
};

export function triageMetric(name) {
  return METRIC_ALIASES[String(name ?? '').toLowerCase()] ?? null;
}

const finite = (value) => (Number.isFinite(value) ? value : NaN);

// The interface a row reports: the requested chain pair (either order) or the model's best by
// ipSAE. Chain IDs are matched exactly: mmCIF chains "a" and "A" are different chains.
export function triagePair(model, pair = null) {
  const pairs = model?.metrics?.pairs ?? [];
  if (pair) {
    const [a, b] = pair.map(String);
    return pairs.find((item) => (item.chainA === a && item.chainB === b) || (item.chainA === b && item.chainB === a)) ?? null;
  }
  let best = null;
  for (const item of pairs) if (!best || finite(item.ipsae) > finite(best.ipsae) || !Number.isFinite(best.ipsae)) best = item;
  return best;
}

// The chain-pair ipTM the predictor reported for the interface, when it reports one.
function reportedPairIptm(model, interfacePair) {
  if (!interfacePair) return NaN;
  const chains = model.scores?.chainIds ?? model.chains ?? [];
  const a = chains.indexOf(interfacePair.chainA);
  const b = chains.indexOf(interfacePair.chainB);
  return a >= 0 && b >= 0 ? finite(model.scores?.chainPairIptm?.[a]?.[b]) : NaN;
}

// Jobs with the same name (a "fold_input" folder in every run) are told apart by their folder.
function jobLabels(sets) {
  const names = new Map();
  for (const set of sets) names.set(set.name, (names.get(set.name) ?? 0) + 1);
  return (set) => (names.get(set.name) > 1 && set.root ? set.root : set.name);
}

// One row per model: its scores and those of the chosen interface. `crosslinks(model)` gives
// { satisfied, total } when cross-links are mapped.
export function triageRows(sets, options = {}) {
  const rows = [];
  const label = jobLabels(sets);
  for (const set of sets) {
    const job = label(set);
    for (const model of set.models) {
      const pair = triagePair(model, options.pair);
      const links = options.crosslinks?.(model) ?? null;
      rows.push({
        setId: set.id,
        modelId: model.id,
        job,
        tool: set.toolLabel ?? set.tool,
        model: model.label,
        rank: model.rank,
        models: set.models.length,
        chains: pair ? [pair.chainA, pair.chainB] : null,
        ranking: finite(model.scores?.rankingScore),
        ptm: finite(model.scores?.ptm),
        // A model without the chain pair asked for has no ipTM for it either.
        iptm: pair && Number.isFinite(reportedPairIptm(model, pair)) ? reportedPairIptm(model, pair) : options.pair ? NaN : finite(model.scores?.iptm),
        plddt: finite(model.meanPlddt),
        ipsae: finite(pair?.ipsae),
        pdockq: finite(pair?.pdockq),
        pdockq2: finite(pair?.pdockq2),
        lis: finite(pair?.lis),
        contacts: pair?.contacts ?? null,
        crosslinks: links?.total ? links.satisfied / links.total : NaN,
        crosslinkCounts: links?.total ? { satisfied: links.satisfied, total: links.total } : null,
        problem: model.problem ?? null,
      });
    }
  }
  return rows;
}

// The metric to rank by when none is chosen: ipSAE when any model has an interface, else pLDDT.
export function defaultTriageMetric(rows) {
  return rows.some((row) => Number.isFinite(row.ipsae)) ? 'ipsae' : 'plddt';
}

// Sorts rows by a metric, highest first; rows without a value go last, in the tools' own order.
export function sortTriageRows(rows, metric) {
  return rows.slice().sort((a, b) => {
    const left = a[metric];
    const right = b[metric];
    const leftOk = Number.isFinite(left);
    const rightOk = Number.isFinite(right);
    if (leftOk && rightOk && left !== right) return right - left;
    if (leftOk !== rightOk) return leftOk ? -1 : 1;
    return a.job.localeCompare(b.job, undefined, { numeric: true }) || a.rank - b.rank;
  });
}

// Ranks jobs (each by its best model under the metric) or all models, and filters by job name.
export function rankTriage(rows, options = {}) {
  const metric = options.metric ?? defaultTriageMetric(rows);
  const filter = String(options.filter ?? '').trim().toLowerCase();
  let sorted = sortTriageRows(filter ? rows.filter((row) => row.job.toLowerCase().includes(filter)) : rows, metric);
  if (options.level !== 'models') {
    const seen = new Set();
    sorted = sorted.filter((row) => {
      if (seen.has(row.setId)) return false;
      seen.add(row.setId);
      return true;
    });
  }
  return sorted.map((row, index) => ({ ...row, position: index + 1 }));
}

const csvNumber = (value) => (Number.isFinite(value) ? Number(value.toFixed(4)) : '');

// Every model and every interface of the sets, for a spreadsheet.
export function triageCSVRows(sets, options = {}) {
  const header = ['tool', 'job', 'rank', 'model', 'ranking_score', 'ptm', 'iptm', 'mean_plddt', 'chain_a', 'chain_b', 'chain_pair_iptm', 'ipsae', 'ipsae_a_to_b', 'ipsae_b_to_a', 'iptm_from_pae', 'pdockq', 'pdockq2', 'lis', 'contacts', 'xl_satisfied', 'xl_total'];
  const rows = [header];
  const label = jobLabels(sets);
  for (const set of sets) {
    for (const model of set.models) {
      const links = options.crosslinks?.(model) ?? null;
      const base = [set.toolLabel ?? set.tool, label(set), model.rank, model.label, csvNumber(model.scores?.rankingScore), csvNumber(model.scores?.ptm), csvNumber(model.scores?.iptm), csvNumber(model.meanPlddt)];
      const pairs = model.metrics?.pairs.length ? model.metrics.pairs : [null];
      for (const pair of pairs) {
        rows.push([...base, pair?.chainA ?? '', pair?.chainB ?? '', csvNumber(reportedPairIptm(model, pair)), csvNumber(pair?.ipsae), csvNumber(pair?.ipsaeAB), csvNumber(pair?.ipsaeBA), csvNumber(pair?.iptm), csvNumber(pair?.pdockq), csvNumber(pair?.pdockq2), csvNumber(pair?.lis), pair?.contacts ?? '', links?.satisfied ?? '', links?.total ?? '']);
      }
    }
  }
  return rows;
}

// Rows for scripts and agents: plain numbers, null where a value is missing.
export function triageRecords(rows) {
  const value = (number) => (Number.isFinite(number) ? Number(number.toFixed(4)) : null);
  return rows.map((row) => ({
    position: row.position,
    job: row.job,
    tool: row.tool,
    model: row.model,
    rank: row.rank,
    chains: row.chains,
    ipsae: value(row.ipsae),
    pdockq: value(row.pdockq),
    pdockq2: value(row.pdockq2),
    lis: value(row.lis),
    iptm: value(row.iptm),
    ptm: value(row.ptm),
    rankingScore: value(row.ranking),
    meanPlddt: value(row.plddt),
    contacts: row.contacts,
    crosslinks: row.crosslinkCounts,
    problem: row.problem,
  }));
}
