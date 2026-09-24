// Cross-linking MS results: search-engine exports read into unique residue pairs, and
// solvent-accessible surface distances (SASD) between linked residues.
//
// Protein positions are 1-based and, where a tool reports a peptide position, equal to the
// peptide start + the link position in the peptide − 1. Decoys are counted and left out; rows
// that report the same pair are merged (count = CSMs, score = best).
//
// SASD follows Jwalk (Bullock et al., Mol Cell Proteomics 2016): a 1 Å grid, heavy atoms made
// solid to their van der Waals radius + 0.8 Å except the side chains of the two linked residues,
// and the shortest path between the Cα atoms through empty grid points (26-neighbor steps of 1,
// √2 and √3 Å). Paths start and end at any grid point within 4 Å of each Cα that is connected to
// the bulk solvent (a flood fill from the grid border, so the small voids between atoms are never
// used), at the cost of the straight line to it; a Cα with none is buried. Jwalk's cutoff for
// DSS/BS3 is 33 Å.

import { splitCells, detectDelimiter, toNumber } from './reports.js';

export const SASD_CUTOFF = 33;

export const CROSSLINK_FORMATS = {
  'xifdr-links': 'xiFDR residue pairs',
  'xifdr-csm': 'xiFDR / xiSEARCH matches',
  xiview: 'xiVIEW table',
  plink: 'pLink',
  merox: 'MeroX',
  xlinkx: 'XlinkX / Proteome Discoverer',
  msannika: 'MS Annika',
  maxlynx: 'MaxLynx (MaxQuant)',
};

export function detectCrosslinkReport(header) {
  const has = (...names) => names.every((name) => header.includes(name));
  if (has('Protein1', 'Protein2', 'fromSite', 'ToSite')) return 'xifdr-links';
  if (has('ProteinLinkPos1', 'ProteinLinkPos2')) return 'xifdr-csm';
  if (has('Protein1', 'Protein2') && (has('SeqPos1', 'SeqPos2') || has('AbsPos1', 'AbsPos2') || has('PepPos1', 'LinkPos1', 'PepPos2', 'LinkPos2'))) return 'xiview';
  if (has('Proteins') && (has('Peptide') || has('Protein_Type')) && (has('Order') || has('Peptide_Order') || has('Protein_Type'))) return 'plink';
  if (has('Protein_Order', 'Protein')) return 'plink';
  if (has('Protein 1', 'Protein 2', 'best linkage position peptide 1')) return 'merox';
  if (has('In protein A', 'In protein B')) return 'msannika';
  if (has('Accession A', 'Accession B', 'Position A', 'Position B')) return 'xlinkx';
  if (has('Proteins1', 'Proteins2', 'Protein index of Crosslink 1')) return 'maxlynx';
  return null;
}

const first = (value) => String(value ?? '').split(';')[0].trim();
const isTrue = (value) => /^(true|1|\+|yes)$/i.test(String(value ?? '').trim());

// Tool protein IDs: "sp|P0A7V0|RS2_ECOLI" → "P0A7V0"; MeroX writes ">Cas9"; xiFDR decoys "decoy:…".
export function crosslinkProtein(text) {
  // MeroX lists ambiguous proteins as "Cas9(>Cas10/>Cas11)": the first is kept.
  const value = first(text).replace(/^>/, '').replace(/\(>.*\)$/, '').trim();
  const pipes = value.match(/^(?:sp|tr)\|([^|]+)\|/);
  return pipes ? pipes[1] : value;
}

function isDecoyProtein(text) {
  return /^(decoy|rev_|REV__|DECOY_|XXX_)/i.test(String(text ?? '').trim());
}

// Rows of each format → { proteinA, residueA, proteinB, residueB, score, fdr, decoy } (or null).
const READERS = {
  'xifdr-links': (row) => ({
    proteinA: row.Protein1, residueA: toNumber(first(row.fromSite)), proteinB: row.Protein2, residueB: toNumber(first(row.ToSite)),
    score: toNumber(row.Score), fdr: toNumber(row.fdr), decoy: isTrue(row.isDecoy) || isTrue(row.Decoy1) || isTrue(row.Decoy2),
    count: toNumber(row['count PSMs']) || 1,
  }),
  'xifdr-csm': (row) => ({
    proteinA: row.Protein1, residueA: toNumber(first(row.ProteinLinkPos1)), proteinB: row.Protein2, residueB: toNumber(first(row.ProteinLinkPos2)),
    score: toNumber(row.Score), fdr: toNumber(row.fdr), decoy: isTrue(row.isDecoy) || isTrue(row.Decoy1) || isTrue(row.Decoy2),
  }),
  xiview: (row) => {
    const position = (side) => {
      const absolute = toNumber(first(row[`SeqPos${side}`] ?? row[`AbsPos${side}`]));
      if (Number.isFinite(absolute)) return absolute;
      return toNumber(first(row[`PepPos${side}`])) + toNumber(first(row[`LinkPos${side}`])) - 1;
    };
    return { proteinA: row.Protein1, residueA: position(1), proteinB: row.Protein2, residueB: position(2), score: toNumber(row.Score), decoy: isTrue(row.Decoy1) || isTrue(row.Decoy2) };
  },
  plink: (row) => {
    const proteins = row.Proteins ?? row.Protein ?? '';
    const match = proteins.split('/')[0].match(/^(.+)\((\d+)\)-(.+)\((\d+)\)$/);
    if (!match) return null;
    return { proteinA: match[1], residueA: Number(match[2]), proteinB: match[3], residueB: Number(match[4]), score: -Math.log10(toNumber(row.Score) || 1), decoy: isDecoyProtein(match[1]) || isDecoyProtein(match[3]) };
  },
  merox: (row, cells) => {
    // "From" appears twice; the reader keeps both as From and From#2.
    const index = (text) => Number(String(text ?? '').match(/(\d+)/)?.[1]);
    const residueA = toNumber(row.From) + index(row['best linkage position peptide 1']) - 1;
    const residueB = toNumber(row['From#2']) + index(row['best linkage position peptide 2']) - 1;
    return { proteinA: row['Protein 1'], residueA, proteinB: row['Protein 2'], residueB, score: toNumber(row.Score), decoy: isDecoyProtein(crosslinkProtein(row['Protein 1'])) || isDecoyProtein(crosslinkProtein(row['Protein 2'])) };
  },
  msannika: (row) => ({
    proteinA: row['Accession A'], residueA: toNumber(first(row['In protein A'])), proteinB: row['Accession B'], residueB: toNumber(first(row['In protein B'])),
    score: toNumber(row['Best CSM Score'] ?? row.Score), decoy: isTrue(row.Decoy) || isTrue(row['Is Decoy']), count: toNumber(row['# CSMs']) || 1,
  }),
  xlinkx: (row) => ({
    proteinA: row['Accession A'], residueA: toNumber(first(row['Position A'])), proteinB: row['Accession B'], residueB: toNumber(first(row['Position B'])),
    score: toNumber(row['Max. XlinkX Score'] ?? row['XlinkX Score']), fdr: toNumber(row['Q-value']), decoy: isTrue(row['Is Decoy']), count: toNumber(row['# CSMs']) || 1,
  }),
  maxlynx: (row) => {
    if (!/link/i.test(row['Crosslink product type'] ?? 'link') || /mono|loop/i.test(row['Crosslink product type'] ?? '')) return null;
    return {
      proteinA: row.Proteins1, residueA: toNumber(first(row['Protein index of Crosslink 1'])), proteinB: row.Proteins2, residueB: toNumber(first(row['Protein index of Crosslink 2'])),
      score: toNumber(row.Score), decoy: String(row.Decoy ?? '').trim() === '+' || isDecoyProtein(row.Proteins1),
    };
  },
};

// Reads a cross-link export (text) into unique residue pairs.
export function parseCrosslinkReport(text, name = '') {
  const lines = String(text ?? '').split(/\r\n|\n|\r/).filter((line) => line.trim());
  if (!lines.length) return null;
  const delimiter = detectDelimiter(lines[0]);
  const header = splitCells(lines[0], delimiter).map((cell) => cell.trim());
  const format = detectCrosslinkReport(header);
  if (!format) return null;
  // Repeated names (MeroX has two "From" columns) get "#2", "#3".
  const names = [];
  const seen = new Map();
  for (const cell of header) {
    const count = (seen.get(cell) ?? 0) + 1;
    seen.set(cell, count);
    names.push(count > 1 ? `${cell}#${count}` : cell);
  }
  const read = READERS[format];
  const pairs = new Map();
  let total = 0;
  let decoys = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCells(line, delimiter);
    // pLink's two-level tables: spectrum rows start with an empty first column.
    if (format === 'plink' && cells[0] === '') continue;
    const row = Object.fromEntries(names.map((column, index) => [column, (cells[index] ?? '').trim()]));
    const link = read(row, cells);
    if (!link || !Number.isFinite(link.residueA) || !Number.isFinite(link.residueB)) continue;
    total += 1;
    if (link.decoy) {
      decoys += 1;
      continue;
    }
    const a = { protein: crosslinkProtein(link.proteinA), residue: link.residueA };
    const b = { protein: crosslinkProtein(link.proteinB || link.proteinA), residue: link.residueB };
    const [low, high] = `${a.protein}|${a.residue}` <= `${b.protein}|${b.residue}` ? [a, b] : [b, a];
    const key = `${low.protein}|${low.residue}|${high.protein}|${high.residue}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { proteinA: low.protein, residueA: low.residue, proteinB: high.protein, residueB: high.residue, score: null, fdr: null, count: 0, raw: `${low.protein}:${low.residue}-${high.protein}:${high.residue}` };
      pairs.set(key, pair);
    }
    pair.count += link.count ?? 1;
    if (Number.isFinite(link.score) && (pair.score === null || link.score > pair.score)) pair.score = link.score;
    if (Number.isFinite(link.fdr) && (pair.fdr === null || link.fdr < pair.fdr)) pair.fdr = Math.max(0, link.fdr);
  }
  return { format, label: CROSSLINK_FORMATS[format], name, links: [...pairs.values()], total, decoys };
}

/* ---------- Surface distances ---------- */

const RADII = { C: 1.73, N: 1.43, O: 1.3, S: 1.67, P: 1.8, SE: 1.9 };
const BACKBONE = new Set(['N', 'CA', 'C', 'O', 'OXT']);
const STEPS = (() => {
  const steps = [];
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
    if (dx || dy || dz) steps.push([dx, dy, dz, Math.hypot(dx, dy, dz)]);
  }
  return steps;
})();

// atoms: heavy atoms [{ x, y, z, element, name, residueKey }]; pairs: [{ a: { key, ca }, b: { key, ca } }].
// Returns an array of { sasd, status } with status 'ok', 'buried' or 'far' (beyond maxDistance).
export function surfaceDistances(atoms, pairs, options = {}) {
  const grid = surfaceGrid(atoms, pairs.flatMap((pair) => [pair.a.key, pair.b.key]), options);
  return pairs.map((pair) => grid.distance(pair));
}

// The grid and its solvent are built once for a structure; `linked` lists the residues whose side
// chains are removed when the solvent is found. distance(pair) then answers one pair at a time.
export function surfaceGrid(atoms, linked, options = {}) {
  const spacing = options.spacing ?? 1;
  const maxDistance = options.maxDistance ?? 60;
  const margin = options.margin ?? 8;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const atom of atoms) {
    min = [Math.min(min[0], atom.x), Math.min(min[1], atom.y), Math.min(min[2], atom.z)];
    max = [Math.max(max[0], atom.x), Math.max(max[1], atom.y), Math.max(max[2], atom.z)];
  }
  const origin = min.map((value) => value - margin);
  const size = max.map((value, axis) => Math.ceil((value + margin - origin[axis]) / spacing) + 1);
  const [nx, ny, nz] = size;
  const total = nx * ny * nz;
  if (total > 64e6) throw new Error('The structure is too large for surface distances; show fewer chains.');
  const index = (i, j, k) => (k * ny + j) * nx + i;
  // Occupancy counts, so the side chains of a linked pair can be removed and put back.
  const counts = new Uint8Array(total);
  const bodies = new Map();
  const inflate = options.inflate ?? 0.8;
  const stamp = (atom, delta) => {
    const radius = (RADII[atom.element] ?? 1.8) + inflate;
    const reach = Math.ceil(radius / spacing);
    const ci = Math.round((atom.x - origin[0]) / spacing);
    const cj = Math.round((atom.y - origin[1]) / spacing);
    const ck = Math.round((atom.z - origin[2]) / spacing);
    for (let k = Math.max(0, ck - reach); k <= Math.min(nz - 1, ck + reach); k += 1) {
      for (let j = Math.max(0, cj - reach); j <= Math.min(ny - 1, cj + reach); j += 1) {
        for (let i = Math.max(0, ci - reach); i <= Math.min(nx - 1, ci + reach); i += 1) {
          const dx = origin[0] + i * spacing - atom.x;
          const dy = origin[1] + j * spacing - atom.y;
          const dz = origin[2] + k * spacing - atom.z;
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          const cell = index(i, j, k);
          counts[cell] = Math.max(0, Math.min(255, counts[cell] + delta));
        }
      }
    }
  };
  for (const atom of atoms) {
    stamp(atom, 1);
    if (!BACKBONE.has(atom.name)) {
      if (!bodies.has(atom.residueKey)) bodies.set(atom.residueKey, []);
      bodies.get(atom.residueKey).push(atom);
    }
  }
  // Bulk solvent: empty grid points connected to the border (through faces), with every linked
  // side chain removed.
  const linkedKeys = new Set(linked);
  for (const key of linkedKeys) for (const atom of bodies.get(key) ?? []) stamp(atom, -1);
  const solvent = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        if (i && j && k && i < nx - 1 && j < ny - 1 && k < nz - 1) continue;
        const cell = index(i, j, k);
        if (!counts[cell] && !solvent[cell]) {
          solvent[cell] = 1;
          queue[tail++] = cell;
        }
      }
    }
  }
  const plane = nx * ny;
  while (head < tail) {
    const cell = queue[head++];
    const i = cell % nx;
    const j = Math.floor(cell / nx) % ny;
    const k = Math.floor(cell / plane);
    const neighbors = [i > 0 ? cell - 1 : -1, i < nx - 1 ? cell + 1 : -1, j > 0 ? cell - nx : -1, j < ny - 1 ? cell + nx : -1, k > 0 ? cell - plane : -1, k < nz - 1 ? cell + plane : -1];
    for (const next of neighbors) {
      if (next < 0 || counts[next] || solvent[next]) continue;
      solvent[next] = 1;
      queue[tail++] = next;
    }
  }
  for (const key of linkedKeys) for (const atom of bodies.get(key) ?? []) stamp(atom, 1);
  const distance = new Float32Array(total).fill(Infinity);
  const heap = new MinHeap();
  const touched = [];
  const cellPoint = (cell) => {
    const i = cell % nx;
    const j = Math.floor(cell / nx) % ny;
    const k = Math.floor(cell / (nx * ny));
    return [origin[0] + i * spacing, origin[1] + j * spacing, origin[2] + k * spacing];
  };
  // Solvent grid points within 4 Å of the Cα, each at the cost of the straight line to it.
  const entry = (ca) => {
    const ci = Math.round((ca.x - origin[0]) / spacing);
    const cj = Math.round((ca.y - origin[1]) / spacing);
    const ck = Math.round((ca.z - origin[2]) / spacing);
    const reach = Math.ceil(4 / spacing);
    const found = [];
    for (let k = Math.max(0, ck - reach); k <= Math.min(nz - 1, ck + reach); k += 1) {
      for (let j = Math.max(0, cj - reach); j <= Math.min(ny - 1, cj + reach); j += 1) {
        for (let i = Math.max(0, ci - reach); i <= Math.min(nx - 1, ci + reach); i += 1) {
          const cell = index(i, j, k);
          if (counts[cell] || !solvent[cell]) continue;
          const [x, y, z] = cellPoint(cell);
          const cost = Math.hypot(x - ca.x, y - ca.y, z - ca.z);
          if (cost <= 4) found.push({ cell, cost });
        }
      }
    }
    return found.length ? found : null;
  };
  const distanceOf = (pair) => {
    // The surface path is never shorter than the straight line.
    const straight = Math.hypot(pair.a.ca.x - pair.b.ca.x, pair.a.ca.y - pair.b.ca.y, pair.a.ca.z - pair.b.ca.z);
    if (straight > maxDistance) return { sasd: null, status: 'far' };
    const bodyA = bodies.get(pair.a.key) ?? [];
    const bodyB = pair.b.key === pair.a.key ? [] : bodies.get(pair.b.key) ?? [];
    for (const atom of [...bodyA, ...bodyB]) stamp(atom, -1);
    try {
      const starts = entry(pair.a.ca);
      const ends = entry(pair.b.ca);
      if (!starts || !ends) return { sasd: null, status: 'buried' };
      const goal = new Map(ends.map((item) => [item.cell, item.cost]));
      for (const cell of touched) distance[cell] = Infinity;
      touched.length = 0;
      heap.clear();
      // A* toward the target Cα: the straight-line distance never overestimates the rest of the
      // path, so the first path found within `best` is the shortest.
      const target = pair.b.ca;
      const remaining = (i, j, k) => Math.hypot(origin[0] + i * spacing - target.x, origin[1] + j * spacing - target.y, origin[2] + k * spacing - target.z);
      for (const start of starts) {
        if (start.cost < distance[start.cell]) {
          distance[start.cell] = start.cost;
          touched.push(start.cell);
          const i = start.cell % nx;
          const j = Math.floor(start.cell / nx) % ny;
          const k = Math.floor(start.cell / (nx * ny));
          heap.push(start.cost + remaining(i, j, k), start.cell);
        }
      }
      let best = Infinity;
      while (heap.size) {
        const [estimate, cell] = heap.pop();
        if (estimate >= best || estimate > maxDistance) break;
        const cost = distance[cell];
        const i = cell % nx;
        const j = Math.floor(cell / nx) % ny;
        const k = Math.floor(cell / (nx * ny));
        // Distances are stored as 32-bit floats, so stale entries are recognized with a tolerance.
        if (estimate > cost + remaining(i, j, k) + 1e-3) continue;
        if (goal.has(cell)) best = Math.min(best, cost + goal.get(cell));
        for (const [dx, dy, dz, step] of STEPS) {
          const ni = i + dx;
          const nj = j + dy;
          const nk = k + dz;
          if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
          const next = index(ni, nj, nk);
          if (counts[next]) continue;
          const candidate = cost + step * spacing;
          if (candidate < distance[next]) {
            if (distance[next] === Infinity) touched.push(next);
            distance[next] = candidate;
            heap.push(candidate + remaining(ni, nj, nk), next);
          }
        }
      }
      return best <= maxDistance ? { sasd: best, status: 'ok' } : { sasd: null, status: 'far' };
    } finally {
      for (const atom of [...bodyA, ...bodyB]) stamp(atom, 1);
    }
  };
  return { distance: distanceOf };
}

class MinHeap {
  constructor() {
    this.keys = new Float64Array(1024);
    this.values = new Int32Array(1024);
    this.size = 0;
  }

  clear() {
    this.size = 0;
  }

  push(key, value) {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      const values = new Int32Array(this.size * 2);
      values.set(this.values);
      this.keys = keys;
      this.values = values;
    }
    let index = this.size++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[index] = this.keys[parent];
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.keys[index] = key;
    this.values[index] = value;
  }

  pop() {
    const top = [this.keys[0], this.values[0]];
    const key = this.keys[--this.size];
    const value = this.values[this.size];
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= this.size) break;
      const right = left + 1;
      const child = right < this.size && this.keys[right] < this.keys[left] ? right : left;
      if (this.keys[child] >= key) break;
      this.keys[index] = this.keys[child];
      this.values[index] = this.values[child];
      index = child;
    }
    this.keys[index] = key;
    this.values[index] = value;
    return top;
  }
}

// Distance histogram in fixed bins (for the plot), with the share within a cutoff.
export function distanceHistogram(values, { binWidth = 2, max = 60 } = {}) {
  const bins = new Array(Math.ceil(max / binWidth) + 1).fill(0);
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    bins[Math.min(bins.length - 1, Math.floor(value / binWidth))] += 1;
  }
  return { bins, binWidth, max };
}
