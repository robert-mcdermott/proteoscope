// Rigid domains from a PAE matrix, following ChimeraX's "alphafold pae … colorDomains true"
// (after Tristan Croll's pae_to_domains): residue pairs with PAE below a cutoff are joined by edges
// weighted 1/PAE^power, and communities are found by greedy modularity maximization (Clauset,
// Newman & Moore 2004) with a resolution parameter. Matrices larger than MAX_NODES are first
// coarse-grained into consecutive blocks, which keeps the dense bookkeeping fast.

const MAX_NODES = 1000;
const MIN_PAE = 0.2;

// pae: { size, matrix: Float32Array(size²) }. Returns { labels: Int32Array(size) with domain
// indices ordered by size (−1 for residues in clusters below minSize), domains: [{ index, size }] }.
export function paeDomains(pae, options = {}) {
  const { cutoff = 5, power = 1, resolution = 0.5, minSize = 10, mask = null } = options;
  const n = pae.size;
  if (!n) return { labels: new Int32Array(0), domains: [] };
  const block = Math.ceil(n / MAX_NODES);
  const nodes = Math.ceil(n / block);
  const weights = new Float64Array(nodes * nodes);
  for (let row = 0; row < n; row += 1) {
    if (mask && !mask[row]) continue;
    const a = Math.floor(row / block);
    for (let column = row + 1; column < n; column += 1) {
      if (mask && !mask[column]) continue;
      // As in ChimeraX: the matrix is symmetrized with the smaller of PAE(i,j) and PAE(j,i), floored
      // at 0.2 Å (AlphaFold DB rounds PAE to whole ångströms, and 1/0 would swamp everything), and
      // the diagonal is left out.
      const value = Math.min(pae.matrix[row * n + column], pae.matrix[column * n + row]);
      if (!(value < cutoff)) continue;
      const b = Math.floor(column / block);
      const w = 1 / Math.max(value, MIN_PAE) ** power;
      weights[a * nodes + b] += w;
      if (a !== b) weights[b * nodes + a] += w;
    }
  }
  const community = greedyModularity(weights, nodes, resolution);
  // Expand blocks back to residues and number domains by size.
  const members = new Map();
  for (let residue = 0; residue < n; residue += 1) {
    if (mask && !mask[residue]) continue;
    const id = community[Math.floor(residue / block)];
    if (!members.has(id)) members.set(id, []);
    members.get(id).push(residue);
  }
  const ordered = [...members.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
  const labels = new Int32Array(n).fill(-1);
  const domains = [];
  for (const group of ordered) {
    if (group.length < minSize) continue;
    const index = domains.length;
    for (const residue of group) labels[residue] = index;
    domains.push({ index, size: group.length });
  }
  return { labels, domains };
}

// Dense CNM: merges the community pair with the largest modularity gain until no merge helps.
// ΔQ(i, j) = w_ij / m − γ · D_i · D_j / (2m²), with w_ij the weight between the communities, D the
// total degree (self-loops count twice) and m the total edge weight.
export function greedyModularity(weights, n, resolution = 1) {
  const degree = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) degree[i] += i === j ? 2 * weights[i * n + i] : weights[i * n + j];
    total += weights[i * n + i];
    for (let j = i + 1; j < n; j += 1) total += weights[i * n + j];
  }
  const community = Int32Array.from({ length: n }, (_, index) => index);
  if (total <= 0) return community;
  const active = new Uint8Array(n).fill(1);
  const gain = (i, j) => weights[i * n + j] / total - (resolution * degree[i] * degree[j]) / (2 * total * total);
  const best = new Int32Array(n).fill(-1);
  const bestGain = new Float64Array(n).fill(-Infinity);
  const refresh = (i) => {
    best[i] = -1;
    bestGain[i] = -Infinity;
    for (let j = 0; j < n; j += 1) {
      if (j === i || !active[j] || weights[i * n + j] <= 0) continue;
      const value = gain(i, j);
      if (value > bestGain[i]) {
        bestGain[i] = value;
        best[i] = j;
      }
    }
  };
  for (let i = 0; i < n; i += 1) refresh(i);
  for (;;) {
    let a = -1;
    for (let i = 0; i < n; i += 1) if (active[i] && best[i] >= 0 && (a < 0 || bestGain[i] > bestGain[a])) a = i;
    if (a < 0 || !(bestGain[a] > 0)) break;
    const b = best[a];
    // Merge b into a.
    for (let k = 0; k < n; k += 1) {
      if (k === a || k === b) continue;
      const w = weights[b * n + k];
      if (w) {
        weights[a * n + k] += w;
        weights[k * n + a] += w;
      }
      weights[b * n + k] = 0;
      weights[k * n + b] = 0;
    }
    weights[a * n + a] += weights[b * n + b] + weights[a * n + b];
    weights[a * n + b] = 0;
    weights[b * n + a] = 0;
    degree[a] += degree[b];
    degree[b] = 0;
    active[b] = 0;
    for (let i = 0; i < n; i += 1) if (community[i] === b) community[i] = a;
    refresh(a);
    for (let k = 0; k < n; k += 1) {
      if (!active[k] || k === a) continue;
      if (best[k] === a || best[k] === b) {
        refresh(k);
      } else if (weights[k * n + a] > 0) {
        const value = gain(k, a);
        if (value > bestGain[k]) {
          bestGain[k] = value;
          best[k] = a;
        }
      }
    }
  }
  return community;
}
