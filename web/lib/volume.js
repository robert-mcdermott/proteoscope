// Density maps: CCP4/MRC files (MRC2014; Cheng et al. 2015, doi:10.1016/j.jsb.2015.04.002) and
// the BinaryCIF blocks of the PDBe/RCSB volume server (2Fo-Fc and Fo-Fc maps of X-ray entries,
// EMDB maps). Every map becomes one form: values on a grid of n0 × n1 × n2 points (n0 fastest)
// whose point (i, j, k) sits at origin + i·axes[0] + j·axes[1] + k·axes[2], which covers
// non-orthogonal crystal cells and any axis order. Isosurfaces come from Surface Nets on that
// grid (the quad mesh's edges are the "chicken wire" drawn as a mesh), and map values at atoms
// give atom inclusion (EMDB) and per-residue fit.
import { decodeBinaryCIFBlocks } from './bcif.js';

const DEGREES = Math.PI / 180;

/* ---------- Cells ---------- */

// Fractional → Cartesian (PDB convention: a along x, b in the xy plane), columns a, b, c.
export function cellMatrix(a, b, c, alpha = 90, beta = 90, gamma = 90) {
  const ca = Math.cos(alpha * DEGREES);
  const cb = Math.cos(beta * DEGREES);
  const cg = Math.cos(gamma * DEGREES);
  const sg = Math.sin(gamma * DEGREES);
  const volume = Math.sqrt(Math.max(0, 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg));
  return [
    [a, b * cg, c * cb],
    [0, b * sg, (c * (ca - cb * cg)) / sg],
    [0, 0, (c * volume) / sg],
  ];
}

function column(matrix, index) {
  return [matrix[0][index], matrix[1][index], matrix[2][index]];
}

function scaled(vector, factor) {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

/* ---------- Volume server ---------- */

// The volume server's answer to a box or cell query: one volume per channel (block).
export function parseVolumeServerData(bytes) {
  const blocks = decodeBinaryCIFBlocks(bytes);
  const server = blocks[0]?.categories.find((category) => category.name === 'density_server_result');
  const error = categoryValue(server, 'has_error') === 'yes' ? categoryValue(server, 'error') : '';
  if (error) throw new Error(`The volume server answered: ${error}`);
  const volumes = [];
  for (const block of blocks) {
    const info = block.categories.find((category) => category.name === 'volume_data_3d_info');
    const data = block.categories.find((category) => category.name === 'volume_data_3d');
    if (!info || !data) continue;
    const get = (name) => categoryValue(info, name);
    const axisOrder = [0, 1, 2].map((index) => Number(get(`axis_order[${index}]`)));
    const origin = [0, 1, 2].map((index) => Number(get(`origin[${index}]`)));
    const dimensions = [0, 1, 2].map((index) => Number(get(`dimensions[${index}]`)));
    const counts = [0, 1, 2].map((index) => Number(get(`sample_count[${index}]`)));
    const cell = cellMatrix(...[0, 1, 2].map((index) => Number(get(`spacegroup_cell_size[${index}]`))), ...[0, 1, 2].map((index) => Number(get(`spacegroup_cell_angles[${index}]`))));
    // origin[i], dimensions[i] and sample_count[i] run along crystal axis axis_order[i]; a grid
    // step is dimensions / sample_count in fractional units.
    const fractional = [0, 0, 0];
    axisOrder.forEach((axis, index) => {
      fractional[axis] = origin[index];
    });
    const values = data.columns.find((item) => item.name === 'values')?.values;
    if (!values || values.length < counts[0] * counts[1] * counts[2]) throw new Error('The volume server sent fewer values than its grid needs.');
    volumes.push({
      name: String(get('name') || block.header),
      data: values instanceof Float32Array ? values : Float32Array.from(values),
      dims: counts,
      origin: multiply(cell, fractional),
      axes: axisOrder.map((axis, index) => scaled(column(cell, axis), dimensions[index] / counts[index])),
      stats: {
        mean: Number(get('mean_source')),
        rms: Number(get('sigma_source')),
        min: Number(get('min_source')),
        max: Number(get('max_source')),
      },
      sampleRate: Number(get('sample_rate')) || 1,
    });
  }
  if (!volumes.length) throw new Error('The volume server sent no map data for this region.');
  return volumes;
}

function categoryValue(category, name) {
  const found = category?.columns.find((item) => item.name === name);
  return found ? found.values[0] : undefined;
}

// The volume server downsamples a query only when it exceeds the voxel budget of the requested
// detail level; the finest level within `maxVoxels` keeps small boxes at full resolution.
export function detailForBudget(header, maxVoxels) {
  let detail = 0;
  for (const precision of header?.availablePrecisions ?? []) {
    if (precision.maxVoxels <= maxVoxels) detail = Math.max(detail, precision.precision);
  }
  return detail;
}

/* ---------- CCP4 / MRC ---------- */

const MRC_TYPES = { 0: Int8Array, 1: Int16Array, 2: Float32Array, 6: Uint16Array, 12: null };

export function isMRC(bytes) {
  if (!bytes || bytes.length < 1024) return false;
  return new TextDecoder('latin1').decode(bytes.subarray(208, 212)) === 'MAP ';
}

export function parseMRC(bytes, name = 'map') {
  if (!bytes || bytes.length < 1024) throw new Error(`${name} is too short to be a CCP4/MRC map.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // MACHST: 0x44 0x41 (or 0x44 0x44) little-endian; 0x11 0x11 big-endian. Fall back to the mode.
  let little = bytes[212] !== 0x11;
  if (bytes[212] !== 0x44 && bytes[212] !== 0x11) little = view.getInt32(12, true) >= 0 && view.getInt32(12, true) <= 16;
  const int = (word) => view.getInt32(word * 4, little);
  const float = (word) => view.getFloat32(word * 4, little);
  const counts = [int(0), int(1), int(2)];
  const mode = int(3);
  const start = [int(4), int(5), int(6)];
  const sampling = [int(7), int(8), int(9)];
  const cellSize = [float(10), float(11), float(12)];
  const angles = [float(13), float(14), float(15)];
  // MAPC, MAPR, MAPS: which axis (1 = X, 2 = Y, 3 = Z) columns, rows and sections run along.
  const mapping = [int(16) - 1, int(17) - 1, int(18) - 1];
  const stats = { min: float(19), max: float(20), mean: float(21), rms: float(54) };
  const extended = int(23);
  const originWords = [float(49), float(50), float(51)];
  if (!(mode in MRC_TYPES)) throw new Error(`${name}: map mode ${mode} is not supported (only 0, 1, 2, 6 and 12).`);
  if (counts.some((count) => !(count > 0)) || new Set(mapping).size !== 3 || mapping.some((axis) => axis < 0 || axis > 2)) {
    throw new Error(`${name} does not have a valid CCP4/MRC header.`);
  }
  const total = counts[0] * counts[1] * counts[2];
  const offset = 1024 + Math.max(0, extended);
  const size = mode === 0 ? 1 : mode === 2 ? 4 : 2;
  if (offset + total * size > bytes.length) throw new Error(`${name} is truncated: the header announces ${counts.join(' × ')} values.`);
  const data = new Float32Array(total);
  if (mode === 12) {
    for (let index = 0; index < total; index += 1) data[index] = float16(view.getUint16(offset + index * 2, little));
  } else if (mode === 0) {
    for (let index = 0; index < total; index += 1) data[index] = view.getInt8(offset + index);
  } else {
    const read = mode === 1 ? (at) => view.getInt16(at, little) : mode === 6 ? (at) => view.getUint16(at, little) : (at) => view.getFloat32(at, little);
    for (let index = 0; index < total; index += 1) data[index] = read(offset + index * size);
  }
  // Grid steps along X, Y and Z (MX, MY, MZ intervals across the cell); cryo-EM maps usually
  // place the box with ORIGIN (Å) and zero start indices, crystallographic maps with the starts.
  const sample = sampling.map((value, axis) => (value > 0 ? value : counts[mapping.indexOf(axis)]));
  const cell = cellMatrix(...cellSize.map((value, axis) => (value > 0 ? value : sample[axis])), ...angles.map((value) => (value > 0 ? value : 90)));
  const step = [0, 1, 2].map((axis) => scaled(column(cell, axis), 1 / sample[axis]));
  const startByAxis = [0, 0, 0];
  mapping.forEach((axis, index) => {
    startByAxis[axis] = start[index];
  });
  const useOrigin = startByAxis.every((value) => value === 0) && originWords.some((value) => Number.isFinite(value) && value !== 0);
  const origin = useOrigin
    ? originWords.map((value) => (Number.isFinite(value) ? value : 0))
    : add3(add3(scaled(step[0], startByAxis[0]), scaled(step[1], startByAxis[1])), scaled(step[2], startByAxis[2]));
  const volume = { name, data, dims: counts, origin, axes: mapping.map((axis) => step[axis]), stats, sampleRate: 1 };
  if (!(stats.rms > 0) || !Number.isFinite(stats.mean)) volume.stats = volumeStats(volume);
  return volume;
}

function float16(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

export function volumeStats(volume) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let squares = 0;
  const { data } = volume;
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    squares += value * value;
  }
  const mean = data.length ? sum / data.length : 0;
  const rms = data.length ? Math.sqrt(Math.max(0, squares / data.length - mean * mean)) : 0;
  return { min, max, mean, rms };
}

/* ---------- Grid geometry ---------- */

function multiply(matrix, vector) {
  return [0, 1, 2].map((row) => matrix[row][0] * vector[0] + matrix[row][1] * vector[1] + matrix[row][2] * vector[2]);
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// Cartesian → grid coordinates (the inverse of the axes matrix), cached on the volume.
function inverseAxes(volume) {
  if (volume.inverse) return volume.inverse;
  const [u, v, w] = volume.axes;
  const m = [[u[0], v[0], w[0]], [u[1], v[1], w[1]], [u[2], v[2], w[2]]];
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const inv = [
    [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det],
    [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det],
    [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det],
  ];
  Object.defineProperty(volume, 'inverse', { value: inv, enumerable: false, configurable: true });
  return inv;
}

export function toGrid(volume, x, y, z) {
  const inv = inverseAxes(volume);
  const dx = x - volume.origin[0];
  const dy = y - volume.origin[1];
  const dz = z - volume.origin[2];
  return [
    inv[0][0] * dx + inv[0][1] * dy + inv[0][2] * dz,
    inv[1][0] * dx + inv[1][1] * dy + inv[1][2] * dz,
    inv[2][0] * dx + inv[2][1] * dy + inv[2][2] * dz,
  ];
}

export function toCartesian(volume, i, j, k) {
  const [u, v, w] = volume.axes;
  return [
    volume.origin[0] + i * u[0] + j * v[0] + k * w[0],
    volume.origin[1] + i * u[1] + j * v[1] + k * w[1],
    volume.origin[2] + i * u[2] + j * v[2] + k * w[2],
  ];
}

// Trilinear interpolation; NaN outside the grid.
export function sampleVolume(volume, x, y, z) {
  const [gi, gj, gk] = toGrid(volume, x, y, z);
  const [n0, n1, n2] = volume.dims;
  if (!(gi >= 0 && gj >= 0 && gk >= 0 && gi <= n0 - 1 && gj <= n1 - 1 && gk <= n2 - 1)) return NaN;
  const i = Math.min(n0 - 2, Math.floor(gi));
  const j = Math.min(n1 - 2, Math.floor(gj));
  const k = Math.min(n2 - 2, Math.floor(gk));
  if (i < 0 || j < 0 || k < 0) return volume.data[Math.round(gi) + n0 * (Math.round(gj) + n1 * Math.round(gk))];
  const ti = gi - i;
  const tj = gj - j;
  const tk = gk - k;
  const data = volume.data;
  const at = (a, b, c) => data[a + n0 * (b + n1 * c)];
  const c00 = at(i, j, k) * (1 - ti) + at(i + 1, j, k) * ti;
  const c10 = at(i, j + 1, k) * (1 - ti) + at(i + 1, j + 1, k) * ti;
  const c01 = at(i, j, k + 1) * (1 - ti) + at(i + 1, j, k + 1) * ti;
  const c11 = at(i, j + 1, k + 1) * (1 - ti) + at(i + 1, j + 1, k + 1) * ti;
  return (c00 * (1 - tj) + c10 * tj) * (1 - tk) + (c01 * (1 - tj) + c11 * tj) * tk;
}

// The part of a volume inside a Cartesian box (every `stride`-th point), as a volume.
export function extractRegion(volume, min, max, stride = 1) {
  const [n0, n1, n2] = volume.dims;
  let low = [Infinity, Infinity, Infinity];
  let high = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner += 1) {
    const point = toGrid(volume, corner & 1 ? max[0] : min[0], corner & 2 ? max[1] : min[1], corner & 4 ? max[2] : min[2]);
    low = low.map((value, axis) => Math.min(value, point[axis]));
    high = high.map((value, axis) => Math.max(value, point[axis]));
  }
  const step = Math.max(1, Math.round(stride));
  const from = [0, 1, 2].map((axis) => Math.max(0, Math.floor(low[axis]) - 1));
  const to = [0, 1, 2].map((axis) => Math.min([n0, n1, n2][axis] - 1, Math.ceil(high[axis]) + 1));
  const dims = [0, 1, 2].map((axis) => Math.max(0, Math.floor((to[axis] - from[axis]) / step) + 1));
  if (dims.some((value) => value < 2)) return null;
  const data = new Float32Array(dims[0] * dims[1] * dims[2]);
  let write = 0;
  for (let k = 0; k < dims[2]; k += 1) {
    const sourceK = from[2] + k * step;
    for (let j = 0; j < dims[1]; j += 1) {
      const row = n0 * ((from[1] + j * step) + n1 * sourceK);
      for (let i = 0; i < dims[0]; i += 1) data[write++] = volume.data[row + from[0] + i * step];
    }
  }
  return {
    name: volume.name,
    data,
    dims,
    origin: toCartesian(volume, from[0], from[1], from[2]),
    axes: volume.axes.map((axis) => scaled(axis, step)),
    stats: volume.stats,
    sampleRate: (volume.sampleRate ?? 1) * step,
  };
}

// Grid spacing in Å (the longest of the three step vectors).
export function gridSpacing(volume) {
  return Math.max(...volume.axes.map((axis) => Math.hypot(...axis)));
}

/* ---------- Isosurfaces ---------- */

// Surface Nets (Gibson 1998) at `level`, positive or negative (a negative level contours the
// region below it, as for the negative Fo-Fc lobe). Returns vertex positions and normals
// (Cartesian, pointing to lower density), triangle indices and the quad edges for a mesh
// drawing. `zone` ({ points: Float32Array, radius }) keeps only faces within that distance.
export function contourVolume(volume, level, options = {}) {
  const [n0, n1, n2] = volume.dims;
  // Which side of the level is inside: options.below, else below a negative level (the negative
  // lobe of a difference map around a zero mean).
  const sign = options.below ?? level < 0 ? -1 : 1;
  const values = volume.data;
  const field = (index) => sign * (values[index] - level);
  const slice = n0 * n1;
  const cellVertex = new Int32Array(2 * slice).fill(-1);
  let capacity = 1 << 14;
  let grid = new Float32Array(capacity * 3);
  let vertexCount = 0;
  let quads = new Uint32Array(capacity * 4);
  let quadCount = 0;
  const pushVertex = (x, y, z) => {
    if (vertexCount === capacity) {
      capacity *= 2;
      const next = new Float32Array(capacity * 3);
      next.set(grid);
      grid = next;
    }
    grid[vertexCount * 3] = x;
    grid[vertexCount * 3 + 1] = y;
    grid[vertexCount * 3 + 2] = z;
    return vertexCount++;
  };
  const pushQuad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if ((quadCount + 1) * 4 > quads.length) {
      const next = new Uint32Array(quads.length * 2);
      next.set(quads);
      quads = next;
    }
    const base = quadCount * 4;
    if (flip) {
      quads[base] = a;
      quads[base + 1] = d;
      quads[base + 2] = c;
      quads[base + 3] = b;
    } else {
      quads[base] = a;
      quads[base + 1] = b;
      quads[base + 2] = c;
      quads[base + 3] = d;
    }
    quadCount += 1;
  };
  const corners = new Float64Array(8);
  for (let k = 0; k < n2 - 1; k += 1) {
    const current = (k & 1) * slice;
    const previous = slice - current;
    cellVertex.fill(-1, current, current + slice);
    for (let j = 0; j < n1 - 1; j += 1) {
      for (let i = 0; i < n0 - 1; i += 1) {
        const index = i + n0 * (j + n1 * k);
        corners[0] = field(index);
        corners[1] = field(index + 1);
        corners[2] = field(index + n0);
        corners[3] = field(index + n0 + 1);
        corners[4] = field(index + slice);
        corners[5] = field(index + slice + 1);
        corners[6] = field(index + slice + n0);
        corners[7] = field(index + slice + n0 + 1);
        let mask = 0;
        for (let corner = 0; corner < 8; corner += 1) if (corners[corner] > 0) mask |= 1 << corner;
        if (mask === 0 || mask === 255) continue;
        // The vertex is the mean of the crossings on the cell's twelve edges.
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;
        for (const [a, b] of CELL_EDGES) {
          const va = corners[a];
          const vb = corners[b];
          if ((va > 0) === (vb > 0)) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t;
          crossings += 1;
        }
        const vertex = pushVertex(i + sx / crossings, j + sy / crossings, k + sz / crossings);
        cellVertex[current + i + j * n0] = vertex;
        // Each crossing edge from the cell's lowest corner joins the four cells around it.
        const inside = corners[0] > 0;
        if ((corners[1] > 0) !== inside && j > 0 && k > 0) {
          pushQuad(cellVertex[previous + i + (j - 1) * n0], cellVertex[current + i + (j - 1) * n0], vertex, cellVertex[previous + i + j * n0], inside);
        }
        if ((corners[2] > 0) !== inside && i > 0 && k > 0) {
          pushQuad(cellVertex[previous + i - 1 + j * n0], cellVertex[previous + i + j * n0], vertex, cellVertex[current + i - 1 + j * n0], inside);
        }
        if ((corners[4] > 0) !== inside && i > 0 && j > 0) {
          pushQuad(cellVertex[current + i - 1 + (j - 1) * n0], cellVertex[current + i - 1 + j * n0], vertex, cellVertex[current + i + (j - 1) * n0], inside);
        }
      }
    }
  }

  // Cartesian positions and gradient normals (toward lower density: outward for positive levels).
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const inv = inverseAxes(volume);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const gi = grid[vertex * 3];
    const gj = grid[vertex * 3 + 1];
    const gk = grid[vertex * 3 + 2];
    const point = toCartesian(volume, gi, gj, gk);
    positions.set(point, vertex * 3);
    const g = gridGradient(volume, gi, gj, gk);
    // d(value)/d(cartesian) = invᵀ · d(value)/d(grid)
    const nx = -(inv[0][0] * g[0] + inv[1][0] * g[1] + inv[2][0] * g[2]) * sign;
    const ny = -(inv[0][1] * g[0] + inv[1][1] * g[1] + inv[2][1] * g[2]) * sign;
    const nz = -(inv[0][2] * g[0] + inv[1][2] * g[1] + inv[2][2] * g[2]) * sign;
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[vertex * 3] = nx / length;
    normals[vertex * 3 + 1] = ny / length;
    normals[vertex * 3 + 2] = nz / length;
  }

  let keep = null;
  if (options.zone?.points?.length && options.zone.radius > 0) keep = zoneMask(positions, vertexCount, options.zone.points, options.zone.radius);
  const indices = [];
  const edges = [];
  const seen = new Set();
  const edge = (a, b) => {
    const key = a < b ? a * vertexCount + b : b * vertexCount + a;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(a, b);
  };
  for (let quad = 0; quad < quadCount; quad += 1) {
    const a = quads[quad * 4];
    const b = quads[quad * 4 + 1];
    const c = quads[quad * 4 + 2];
    const d = quads[quad * 4 + 3];
    if (keep && !(keep[a] && keep[b] && keep[c] && keep[d])) continue;
    indices.push(a, b, c, a, c, d);
    edge(a, b);
    edge(b, c);
    edge(c, d);
    edge(d, a);
  }
  return { positions, normals, indices: Uint32Array.from(indices), edges: Uint32Array.from(edges), vertexCount };
}

const CELL_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

function gridGradient(volume, gi, gj, gk) {
  const [n0, n1, n2] = volume.dims;
  const i = Math.max(1, Math.min(n0 - 2, Math.round(gi)));
  const j = Math.max(1, Math.min(n1 - 2, Math.round(gj)));
  const k = Math.max(1, Math.min(n2 - 2, Math.round(gk)));
  const data = volume.data;
  const at = (a, b, c) => data[a + n0 * (b + n1 * c)];
  if (n0 < 3 || n1 < 3 || n2 < 3) return [0, 0, 1];
  return [(at(i + 1, j, k) - at(i - 1, j, k)) / 2, (at(i, j + 1, k) - at(i, j - 1, k)) / 2, (at(i, j, k + 1) - at(i, j, k - 1)) / 2];
}

// Vertices within `radius` of any point (a grid hash of the points).
function zoneMask(positions, vertexCount, points, radius) {
  const cell = radius;
  const buckets = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let index = 0; index < points.length; index += 3) {
    const bucket = key(points[index], points[index + 1], points[index + 2]);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(index);
  }
  const limit = radius * radius;
  const keep = new Uint8Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    search: for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const index of buckets.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const ex = points[index] - x;
            const ey = points[index + 1] - y;
            const ez = points[index + 2] - z;
            if (ex * ex + ey * ey + ez * ez <= limit) {
              keep[vertex] = 1;
              break search;
            }
          }
        }
      }
    }
  }
  return keep;
}

/* ---------- Fit of a model to a map ---------- */

// Map values at atom positions (x, y, z triples) with a group (residue) index per atom: atom
// inclusion, the fraction of atoms inside the contour at `level` as EMDB's validation reports it,
// and per group the mean value in units of the map's RMS and the fraction of its atoms inside.
// Atoms outside the map count as outside the contour, as in EMDB's count, and are left out of the
// means. sums, sampled and insideCounts let fits of several map tiles be added up.
export function mapFit(volume, positions, groups, groupCount, level) {
  const rms = volume.stats?.rms > 0 ? volume.stats.rms : 1;
  const mean = Number.isFinite(volume.stats?.mean) ? volume.stats.mean : 0;
  const sums = new Float64Array(groupCount);
  const sampled = new Int32Array(groupCount);
  const counts = new Int32Array(groupCount);
  const insideCounts = new Int32Array(groupCount);
  let inside = 0;
  let outside = 0;
  for (let atom = 0; atom < groups.length; atom += 1) {
    const group = groups[atom];
    counts[group] += 1;
    const value = sampleVolume(volume, positions[atom * 3], positions[atom * 3 + 1], positions[atom * 3 + 2]);
    if (!Number.isFinite(value)) {
      outside += 1;
      continue;
    }
    sums[group] += (value - mean) / rms;
    sampled[group] += 1;
    if (value >= level) {
      inside += 1;
      insideCounts[group] += 1;
    }
  }
  const sigma = new Float64Array(groupCount).fill(NaN);
  const inclusion = new Float64Array(groupCount).fill(NaN);
  for (let group = 0; group < groupCount; group += 1) {
    if (sampled[group]) sigma[group] = sums[group] / sampled[group];
    if (counts[group]) inclusion[group] = insideCounts[group] / counts[group];
  }
  return { atomInclusion: groups.length ? inside / groups.length : NaN, atoms: groups.length, inside, outside, sigma, inclusion, counts, sums, sampled, insideCounts };
}

/* ---------- Difference-map peaks ---------- */

// Local maxima above `threshold`·σ and minima below −`threshold`·σ (26 neighbors), as a
// crystallographer lists the peaks of an Fo-Fc map. Each position is refined to a parabola along
// each grid axis. Only peaks inside `core` (a Cartesian box, the part of a tile that no other
// tile covers) are kept. σ is the whole map's, from volume.stats. Sorted by height, largest first.
export function mapPeaks(volume, threshold = 3, core = null) {
  const [n0, n1, n2] = volume.dims;
  const { data } = volume;
  const rms = volume.stats?.rms > 0 ? volume.stats.rms : 1;
  const mean = Number.isFinite(volume.stats?.mean) ? volume.stats.mean : 0;
  const high = mean + threshold * rms;
  const low = mean - threshold * rms;
  const at = (i, j, k) => data[i + n0 * (j + n1 * k)];
  const peaks = [];
  for (let k = 1; k < n2 - 1; k += 1) {
    for (let j = 1; j < n1 - 1; j += 1) {
      for (let i = 1; i < n0 - 1; i += 1) {
        const value = at(i, j, k);
        const positive = value >= high;
        if (!positive && value > low) continue;
        let extreme = true;
        for (let dk = -1; dk <= 1 && extreme; dk += 1) {
          for (let dj = -1; dj <= 1 && extreme; dj += 1) {
            for (let di = -1; di <= 1; di += 1) {
              if (!di && !dj && !dk) continue;
              const other = at(i + di, j + dj, k + dk);
              // Ties go to the first point in grid order, so a flat top gives one peak.
              const before = dk < 0 || (dk === 0 && (dj < 0 || (dj === 0 && di < 0)));
              if (positive ? other > value || (other === value && before) : other < value || (other === value && before)) {
                extreme = false;
                break;
              }
            }
          }
        }
        if (!extreme) continue;
        // The parabola through three points along each axis gives the offset of its vertex and
        // how much higher (or lower) the vertex is than the grid point.
        let height = value;
        const offset = (minus, plus) => {
          const curvature = minus - 2 * value + plus;
          if (Math.abs(curvature) < 1e-12) return 0;
          const shift = Math.max(-0.5, Math.min(0.5, (minus - plus) / (2 * curvature)));
          height -= ((minus - plus) * shift) / 4;
          return shift;
        };
        const gi = i + offset(at(i - 1, j, k), at(i + 1, j, k));
        const gj = j + offset(at(i, j - 1, k), at(i, j + 1, k));
        const gk = k + offset(at(i, j, k - 1), at(i, j, k + 1));
        const position = toCartesian(volume, gi, gj, gk);
        if (core && [0, 1, 2].some((axis) => position[axis] < core.min[axis] || position[axis] >= core.max[axis])) continue;
        peaks.push({ position, sigma: (height - mean) / rms });
      }
    }
  }
  return peaks.sort((a, b) => Math.abs(b.sigma) - Math.abs(a.sigma));
}
