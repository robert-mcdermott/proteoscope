// Multiple sequence alignments from structure-prediction runs: A3M text (ColabFold, Boltz, the
// unpairedMsa and pairedMsa fields of AlphaFold 3 data.json) reduced to per-position depth, the
// number of aligned sequences that cover each query residue. Shallow alignments are the most common
// reason for low pLDDT, so depth is shown next to confidence.

// Returns { query, depth: Int32Array, count, chainLengths } for A3M text. The first sequence is the
// query; lowercase letters are insertions and do not occupy query columns. ColabFold complex MSAs
// start with "#len1,len2<tab>card1,card2", which gives the chain boundaries of the concatenated query.
export function msaDepth(text) {
  let chainLengths = null;
  let query = null;
  let depth = null;
  let count = 0;
  let current = null;
  const finish = () => {
    if (current === null) return;
    const aligned = current.replace(/[a-z.]/g, '');
    if (query === null) {
      query = aligned;
      depth = new Int32Array(aligned.length);
    } else if (aligned.length === query.length) {
      let covered = false;
      for (let index = 0; index < aligned.length; index += 1) {
        const char = aligned.charCodeAt(index);
        if (char !== 45 && char !== 42) {
          depth[index] += 1;
          covered = true;
        }
      }
      if (covered) count += 1;
    }
    current = null;
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const lengths = line.slice(1).split(/\s+/)[0].split(',').map(Number);
      if (lengths.length && lengths.every((value) => Number.isInteger(value) && value > 0)) chainLengths = lengths;
      continue;
    }
    if (line.startsWith('>')) {
      finish();
      current = '';
      continue;
    }
    current = (current ?? '') + line;
  }
  finish();
  if (query === null) return null;
  return { query, depth, count, chainLengths };
}

// Adds several alignments of the same query (AlphaFold 3 keeps unpaired and paired MSAs apart).
export function combineDepth(results) {
  const valid = results.filter(Boolean);
  if (!valid.length) return null;
  const base = valid[0];
  const depth = new Int32Array(base.depth.length);
  let count = 0;
  for (const result of valid) {
    if (result.depth.length !== depth.length) continue;
    for (let index = 0; index < depth.length; index += 1) depth[index] += result.depth[index];
    count += result.count;
  }
  return { query: base.query, depth, count, chainLengths: base.chainLengths };
}

export function depthSummary(depth, threshold = 30) {
  if (!depth?.length) return null;
  const sorted = Array.from(depth).sort((a, b) => a - b);
  let shallow = 0;
  for (const value of depth) if (value < threshold) shallow += 1;
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted[sorted.length - 1], shallow, threshold };
}
