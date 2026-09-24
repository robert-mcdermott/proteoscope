// Prediction-aware part-sphere exposure (pPSE) and disorder, as StructureMap computes them
// (Bludau et al., PLoS Biol 2022). A residue's neighbors are the Cα atoms within a radius and
// within a cone around its Cα→Cβ direction; with a PAE matrix a neighbor counts only when its
// distance plus the PAE (aligned on the residue, scored at the neighbor) stays within the radius.
//   pPSE        12 Å, 70° cone: exposure; 5 or fewer neighbors is "highly accessible"
//   full sphere 24 Å, 180°: smoothed over ±10 residues, 34.27 or less marks an intrinsically
//               disordered region (IDR)
// Glycine and residues without Cβ use a pseudo-Cβ direction: N−Cα rotated −120° about C−Cα.

export const PPSE_RADIUS = 12;
export const PPSE_ANGLE = 70;
export const PPSE_EXPOSED = 5;
export const IDR_RADIUS = 24;
export const IDR_WINDOW = 10;
export const IDR_THRESHOLD = 34.27;

// residues: [{ key, chain, ca: {x,y,z}, cb?, n?, c? }] in chain order; pae: optional
// { matrix: Float32Array(size²), size, index: Map(residue key → row) }.
// Returns Map(key → { ppse, sphere, smooth, idr, exposed }).
export function partSphereExposure(residues, options = {}) {
  const points = exposurePoints(residues, options.pae);
  const ppse = neighborCounts(points, { radius: PPSE_RADIUS, angle: PPSE_ANGLE, pae: options.pae });
  const sphere = neighborCounts(points, { radius: IDR_RADIUS, angle: 180, pae: options.pae });
  // Smoothing runs along each chain, over the residues that have both atoms.
  const result = new Map();
  const byChain = new Map();
  points.forEach((point, index) => {
    if (!byChain.has(point.chain)) byChain.set(point.chain, []);
    byChain.get(point.chain).push(index);
  });
  for (const indices of byChain.values()) {
    const smooth = smoothScore(indices.map((index) => sphere[index]), IDR_WINDOW);
    indices.forEach((index, order) => {
      result.set(points[index].key, { ppse: ppse[index], sphere: sphere[index], smooth: smooth[order], idr: smooth[order] <= IDR_THRESHOLD, exposed: ppse[index] <= PPSE_EXPOSED });
    });
  }
  return result;
}

export function exposurePoints(residues, pae = null) {
  return residues.map((residue) => ({
    key: residue.key,
    chain: residue.chain,
    ca: residue.ca,
    direction: sideChainDirection(residue),
    row: pae?.index.get(residue.key) ?? -1,
  })).filter((point) => point.ca && point.direction);
}

// For each point, the Cα atoms within `radius` whose direction lies within `angle` degrees of its
// side chain, discounted by PAE as described above. With radius 12 and 90° and no PAE this is
// the half-sphere exposure HSE-Cβ-up of Hamelryck (Biopython's HSExposureCB).
export function neighborCounts(points, { radius, angle, pae = null }) {
  const grid = buildGrid(points, radius);
  const cosine = Math.cos((angle * Math.PI) / 180);
  const counts = new Int32Array(points.length);
  points.forEach((point, index) => {
    let count = 0;
    for (const other of neighbors(grid, point.ca, radius)) {
      if (other === point) continue;
      const error = pae && point.row >= 0 && other.row >= 0 ? pae.matrix[point.row * pae.size + other.row] : 0;
      if (error > radius) continue;
      const dx = other.ca.x - point.ca.x;
      const dy = other.ca.y - point.ca.y;
      const dz = other.ca.z - point.ca.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance + error > radius || distance === 0) continue;
      if (angle < 180 && (dx * point.direction[0] + dy * point.direction[1] + dz * point.direction[2]) / distance < cosine - 1e-12) continue;
      count += 1;
    }
    counts[index] = count;
  });
  return counts;
}

// StructureMap's centered moving mean: indices max(i − w, 0) … min(i + w, n) inclusive.
export function smoothScore(values, halfWindow) {
  const result = new Float64Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const low = Math.max(index - halfWindow, 0);
    const high = Math.min(index + halfWindow, values.length);
    let sum = 0;
    let count = 0;
    for (let other = low; other <= high && other < values.length; other += 1) {
      sum += values[other];
      count += 1;
    }
    result[index] = sum / count;
  }
  return result;
}

// Unit vector from Cα toward Cβ, or toward the pseudo-Cβ of glycine.
export function sideChainDirection(residue) {
  const { ca, cb, n, c } = residue;
  if (!ca) return null;
  if (cb) return unit([cb.x - ca.x, cb.y - ca.y, cb.z - ca.z]);
  if (!n || !c) return null;
  const toN = unit([n.x - ca.x, n.y - ca.y, n.z - ca.z]);
  const axis = unit([c.x - ca.x, c.y - ca.y, c.z - ca.z]);
  return rotate(toN, axis, (-120 * Math.PI) / 180);
}

function unit(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length ? [vector[0] / length, vector[1] / length, vector[2] / length] : null;
}

// Rodrigues' rotation of `vector` about the unit `axis` (right-handed).
function rotate(vector, axis, angle) {
  if (!vector || !axis) return null;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2];
  const cross = [axis[1] * vector[2] - axis[2] * vector[1], axis[2] * vector[0] - axis[0] * vector[2], axis[0] * vector[1] - axis[1] * vector[0]];
  return [0, 1, 2].map((i) => vector[i] * cos + cross[i] * sin + axis[i] * dot * (1 - cos));
}

function buildGrid(points, size) {
  const cells = new Map();
  for (const point of points) {
    const key = cellKey(point.ca, size);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(point);
  }
  return { cells, size };
}

function cellKey(position, size) {
  return `${Math.floor(position.x / size)},${Math.floor(position.y / size)},${Math.floor(position.z / size)}`;
}

function* neighbors(grid, position, radius) {
  const reach = Math.ceil(radius / grid.size);
  const cx = Math.floor(position.x / grid.size);
  const cy = Math.floor(position.y / grid.size);
  const cz = Math.floor(position.z / grid.size);
  for (let x = cx - reach; x <= cx + reach; x += 1) {
    for (let y = cy - reach; y <= cy + reach; y += 1) {
      for (let z = cz - reach; z <= cz + reach; z += 1) {
        const cell = grid.cells.get(`${x},${y},${z}`);
        if (cell) yield* cell;
      }
    }
  }
}
