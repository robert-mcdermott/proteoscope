import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cellMatrix,
  contourVolume,
  detailForBudget,
  extractRegion,
  isMRC,
  mapFit,
  mapPeaks,
  parseMRC,
  parseVolumeServerData,
  sampleVolume,
  toCartesian,
  toGrid,
  volumeStats,
} from './volume.js';
import { packMessagePack } from './test-data.mjs';

const close = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

// A CCP4/MRC map of a Gaussian blob. Columns run along Z, rows along X and sections along Y
// (MAPC 3, MAPR 1, MAPS 2), and the grid starts at (2, 3, 4) grid units, as crystallographic
// maps may; values are float32 (mode 2) or int16 (mode 1), little- or big-endian.
function mrcBlob({ mode = 2, little = true, center = [9.5, 7, 8], sigma = 1.6, origin = null } = {}) {
  const counts = [12, 14, 16]; // columns (Z), rows (X), sections (Y)
  const mapping = [3, 1, 2];
  const start = origin ? [0, 0, 0] : [4, 2, 3];
  const step = 0.8; // Å, cubic 24 × 24 × 24 Å cell sampled 30 × 30 × 30
  const header = new ArrayBuffer(1024);
  const view = new DataView(header);
  const int = (word, value) => view.setInt32(word * 4, value, little);
  const float = (word, value) => view.setFloat32(word * 4, value, little);
  counts.forEach((value, index) => int(index, value));
  int(3, mode);
  start.forEach((value, index) => int(4 + index, value));
  [30, 30, 30].forEach((value, index) => int(7 + index, value));
  [24, 24, 24].forEach((value, index) => float(10 + index, value));
  [90, 90, 90].forEach((value, index) => float(13 + index, value));
  mapping.forEach((value, index) => int(16 + index, value));
  if (origin) origin.forEach((value, index) => float(49 + index, value));
  new Uint8Array(header).set([0x4d, 0x41, 0x50, 0x20], 208);
  new Uint8Array(header).set(little ? [0x44, 0x41, 0, 0] : [0x11, 0x11, 0, 0], 212);
  const size = mode === 2 ? 4 : 2;
  const data = new DataView(new ArrayBuffer(counts[0] * counts[1] * counts[2] * size));
  const offsetAxis = origin ? origin : [0, 0, 0];
  let index = 0;
  for (let section = 0; section < counts[2]; section += 1) {
    for (let row = 0; row < counts[1]; row += 1) {
      for (let columnIndex = 0; columnIndex < counts[0]; columnIndex += 1) {
        // Column → Z, row → X, section → Y.
        const x = offsetAxis[0] + (start[1] + row) * step;
        const y = offsetAxis[1] + (start[2] + section) * step;
        const z = offsetAxis[2] + (start[0] + columnIndex) * step;
        const r2 = (x - center[0]) ** 2 + (y - center[1]) ** 2 + (z - center[2]) ** 2;
        const value = Math.exp(-r2 / (2 * sigma * sigma));
        if (mode === 2) data.setFloat32(index * 4, value, little);
        else data.setInt16(index * 2, Math.round(value * 1000), little);
        index += 1;
      }
    }
  }
  const bytes = new Uint8Array(1024 + data.byteLength);
  bytes.set(new Uint8Array(header), 0);
  bytes.set(new Uint8Array(data.buffer), 1024);
  return bytes;
}

test('crystal cells: the fractional-to-Cartesian matrix keeps edge lengths and angles', () => {
  const m = cellMatrix(50, 60, 70, 90, 110, 90);
  const column = (index) => [m[0][index], m[1][index], m[2][index]];
  const length = (v) => Math.hypot(...v);
  const angle = (u, v) => (Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (length(u) * length(v))) * 180) / Math.PI;
  assert.ok(close(length(column(0)), 50) && close(length(column(1)), 60) && close(length(column(2)), 70));
  assert.ok(close(angle(column(0), column(2)), 110, 1e-9), 'β between a and c');
  assert.ok(close(angle(column(0), column(1)), 90, 1e-9) && close(angle(column(1), column(2)), 90, 1e-9));
  assert.ok(close(m[1][0], 0) && close(m[2][0], 0) && close(m[2][1], 0), 'a along x, b in the xy plane');
});

test('MRC maps: axis order, start indices, modes and byte order place the density where it is', () => {
  for (const options of [{}, { mode: 1 }, { little: false }, { origin: [3.2, 2.4, 1.6] }]) {
    const bytes = mrcBlob(options);
    assert.ok(isMRC(bytes));
    const volume = parseMRC(bytes, 'blob.map');
    assert.deepEqual(volume.dims, [12, 14, 16]);
    const center = [9.5, 7, 8];
    const peak = sampleVolume(volume, ...center);
    const expected = options.mode === 1 ? 1000 : 1;
    assert.ok(peak > 0.93 * expected, `peak at the blob center (${JSON.stringify(options)}): ${peak}`);
    assert.ok(sampleVolume(volume, center[0] - 3, center[1], center[2]) < 0.2 * expected, 'the density falls off away from the center');
    const grid = toGrid(volume, 5.1, 6.2, 7.3);
    const back = toCartesian(volume, ...grid);
    assert.ok(close(back[0], 5.1, 1e-9) && close(back[1], 6.2, 1e-9) && close(back[2], 7.3, 1e-9));
    assert.ok(Number.isNaN(sampleVolume(volume, 100, 100, 100)), 'outside the grid');
  }
  assert.throws(() => parseMRC(new Uint8Array(1024), 'empty.map'), /not have a valid CCP4\/MRC header/);
  assert.throws(() => parseMRC(mrcBlob().subarray(0, 2000), 'cut.map'), /truncated/);
});

test('volume-server data: channels, axis order and fractional origins become Cartesian grids', () => {
  // Cell 40 × 50 × 60 Å; the box's fastest axis is b (axis_order 1, 0, 2), 10 steps of 1/100
  // along b, 8 of 1/80 along a and 6 of 1/60 along c, starting at fractional (0.2, 0.1, 0.5).
  const counts = [10, 8, 6];
  const values = new Float32Array(counts[0] * counts[1] * counts[2]);
  // value = the Cartesian x coordinate of each point, so the mapping can be checked.
  let index = 0;
  for (let k = 0; k < counts[2]; k += 1) {
    for (let j = 0; j < counts[1]; j += 1) {
      for (let i = 0; i < counts[0]; i += 1) values[index++] = 40 * (0.2 + j / 80) + 100 * k;
    }
  }
  const column = (name, value, type) => {
    if (typeof value === 'string') return { name, data: { encoding: [{ kind: 'StringArray', dataEncoding: [{ kind: 'ByteArray', type: 4 }], stringData: value, offsetEncoding: [{ kind: 'ByteArray', type: 4 }], offsets: Uint8Array.from([0, value.length]) }], data: Uint8Array.from([0]) }, mask: null };
    const typed = type === 'int' ? Int32Array.from([value]) : Float64Array.from([value]);
    return { name, data: { encoding: [{ kind: 'ByteArray', type: type === 'int' ? 3 : 33 }], data: new Uint8Array(typed.buffer) }, mask: null };
  };
  const info = [
    column('name', '2Fo-Fc'),
    ...[1, 0, 2].map((axis, i) => column(`axis_order[${i}]`, axis, 'int')),
    ...[0.1, 0.2, 0.5].map((value, i) => column(`origin[${i}]`, value)),
    ...[10 / 100, 8 / 80, 6 / 60].map((value, i) => column(`dimensions[${i}]`, value)),
    column('sample_rate', 1, 'int'),
    ...counts.map((value, i) => column(`sample_count[${i}]`, value, 'int')),
    ...[40, 50, 60].map((value, i) => column(`spacegroup_cell_size[${i}]`, value)),
    ...[90, 90, 90].map((value, i) => column(`spacegroup_cell_angles[${i}]`, value)),
    column('mean_source', 0), column('sigma_source', 2.5), column('min_source', -9), column('max_source', 9),
  ];
  const file = packMessagePack({
    version: '0.3.0',
    encoder: 'test',
    dataBlocks: [
      { header: 'SERVER', categories: [{ name: '_density_server_result', rowCount: 1, columns: [column('has_error', 'no'), column('is_empty', 'no')] }] },
      {
        header: '2FO-FC',
        categories: [
          { name: '_volume_data_3d_info', rowCount: 1, columns: info },
          { name: '_volume_data_3d', rowCount: values.length, columns: [{ name: 'values', data: { encoding: [{ kind: 'ByteArray', type: 32 }], data: new Uint8Array(values.buffer) }, mask: null }] },
        ],
      },
    ],
  });
  const [volume] = parseVolumeServerData(file);
  assert.equal(volume.name, '2Fo-Fc');
  assert.deepEqual(volume.dims, counts);
  assert.equal(volume.stats.rms, 2.5);
  assert.deepEqual(volume.origin.map((value) => Number(value.toFixed(9))), [8, 5, 30]);
  assert.deepEqual(volume.axes.map((axis) => axis.map((value) => Number(value.toFixed(9)))), [[0, 0.5, 0], [0.5, 0, 0], [0, 0, 1]]);
  // At grid (i, j, k) = (3, 5, 2): x = 8 + 5 · 0.5 = 10.5, and the stored value is x + 200.
  const [x, y, z] = toCartesian(volume, 3, 5, 2);
  assert.deepEqual([x, y, z].map((value) => Number(value.toFixed(9))), [10.5, 6.5, 32]);
  assert.ok(close(sampleVolume(volume, x, y, z), 210.5, 1e-4));
});

test('surface nets: a sphere at the right radius with outward normals, zones and negative lobes', () => {
  const n = 32;
  const data = new Float32Array(n * n * n);
  const c = (n - 1) / 2;
  for (let k = 0; k < n; k += 1) for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) data[i + n * (j + n * k)] = 10 - Math.hypot(i - c, j - c, k - c);
  const volume = { data, dims: [n, n, n], origin: [0, 0, 0], axes: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]], stats: { mean: 0, rms: 1 } };
  const mesh = contourVolume(volume, 4);
  assert.ok(mesh.vertexCount > 500);
  const center = c * 0.5;
  let worst = 0;
  let outward = 0;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const dx = mesh.positions[vertex * 3] - center;
    const dy = mesh.positions[vertex * 3 + 1] - center;
    const dz = mesh.positions[vertex * 3 + 2] - center;
    worst = Math.max(worst, Math.abs(Math.hypot(dx, dy, dz) - 3));
    if (dx * mesh.normals[vertex * 3] + dy * mesh.normals[vertex * 3 + 1] + dz * mesh.normals[vertex * 3 + 2] > 0) outward += 1;
  }
  assert.ok(worst < 0.25, `vertices within a quarter grid step of r = 3 Å (${worst})`);
  assert.equal(outward, mesh.vertexCount, 'normals point to lower density');
  assert.equal(mesh.indices.length % 6, 0);
  assert.ok(mesh.edges.length / 2 > mesh.indices.length / 6, 'each quad contributes its edges once');

  const zoned = contourVolume(volume, 4, { zone: { points: Float32Array.from([center + 3, center, center]), radius: 1.5 } });
  assert.ok(zoned.indices.length > 0 && zoned.indices.length < mesh.indices.length / 4, 'only faces near the point remain');

  const negative = { ...volume, data: data.map((value) => -value) };
  const lobe = contourVolume(negative, -4);
  assert.equal(lobe.vertexCount, mesh.vertexCount, 'a negative level contours the region below it');
  // A difference map whose mean is not zero: the side below is asked for, not read from the sign.
  const offset = { ...volume, data: data.map((value) => 100 - value) };
  const below = contourVolume(offset, 96, { below: true });
  assert.equal(below.vertexCount, mesh.vertexCount, 'below a positive level');
  assert.ok(below.positions.every((value, index) => Math.abs(value - lobe.positions[index]) < 1e-4));
});

test('regions, strides, statistics, map fit and detail levels', () => {
  const volume = parseMRC(mrcBlob(), 'blob.map');
  const region = extractRegion(volume, [6, 4, 5], [13, 10, 11]);
  assert.ok(region.dims.every((count) => count < 16));
  assert.ok(close(sampleVolume(region, 9.5, 7, 8), sampleVolume(volume, 9.5, 7, 8), 1e-6), 'a region samples like the whole map');
  const coarse = extractRegion(volume, [0, 0, 0], [30, 30, 30], 2);
  assert.ok(coarse.dims[0] <= 7 && coarse.sampleRate === 2);
  const stats = volumeStats(volume);
  assert.ok(stats.max > 0.9 && stats.min >= 0 && stats.rms > 0);

  // Two "residues": atoms at the blob center are inside the contour, atoms far away are not.
  const positions = Float32Array.from([9.5, 7, 8, 9.8, 7.2, 8.1, 3.4, 3.4, 5, 100, 100, 100]);
  const groups = Int32Array.from([0, 0, 1, 1]);
  const fit = mapFit(volume, positions, groups, 2, 0.5);
  // As in EMDB's count, an atom outside the map is outside the contour; it has no density value.
  assert.equal(fit.atoms, 4);
  assert.equal(fit.outside, 1);
  assert.ok(close(fit.atomInclusion, 2 / 4));
  assert.deepEqual([...fit.sampled], [2, 1]);
  assert.deepEqual([...fit.inclusion], [1, 0]);

  const header = { availablePrecisions: [{ precision: 0, maxVoxels: 524288 }, { precision: 1, maxVoxels: 1048576 }, { precision: 2, maxVoxels: 2097152 }, { precision: 3, maxVoxels: 4194304 }] };
  assert.equal(detailForBudget(header, 2e6), 1);
  assert.equal(detailForBudget(header, 4194304), 3);
  assert.equal(detailForBudget(header, 1000), 0);
});

test('difference-map peaks: maxima and minima past ±nσ, refined between grid points, kept once per tile core', () => {
  // A 40³ grid at 0.5 Å with a positive blob off grid points and a weaker negative one.
  const dims = [40, 40, 40];
  const data = new Float32Array(dims[0] * dims[1] * dims[2]);
  const blobs = [{ center: [6.2, 7.1, 8.3], height: 1, width: 0.8 }, { center: [13.4, 12.6, 5.9], height: -0.6, width: 0.8 }, { center: [4, 14, 14], height: 0.08, width: 0.8 }];
  for (let k = 0; k < dims[2]; k += 1) {
    for (let j = 0; j < dims[1]; j += 1) {
      for (let i = 0; i < dims[0]; i += 1) {
        const point = [i * 0.5, j * 0.5, k * 0.5];
        let value = 0;
        for (const blob of blobs) value += blob.height * Math.exp(-((point[0] - blob.center[0]) ** 2 + (point[1] - blob.center[1]) ** 2 + (point[2] - blob.center[2]) ** 2) / (2 * blob.width ** 2));
        data[i + dims[0] * (j + dims[1] * k)] = value;
      }
    }
  }
  const volume = { data, dims, origin: [0, 0, 0], axes: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]], stats: { mean: 0, rms: 0.1 } };
  const peaks = mapPeaks(volume, 3);
  assert.equal(peaks.length, 2, 'the 0.8σ blob is below 3σ');
  assert.ok(close(peaks[0].sigma, 10, 0.3) && peaks[1].sigma < -5.5, 'sorted by height, the negative one second');
  for (const [index, blob] of blobs.slice(0, 2).entries()) {
    const distance = Math.hypot(...peaks[index].position.map((value, axis) => value - blob.center[axis]));
    assert.ok(distance < 0.08, `peak ${index} at ${peaks[index].position} (refined to within ${distance.toFixed(3)} Å)`);
  }
  // A tile's core keeps what lies inside it; the neighboring tile reports the rest.
  const core = { min: [0, 0, 0], max: [10, 20, 20] };
  assert.deepEqual(mapPeaks(volume, 3, core).map((peak) => Math.sign(peak.sigma)), [1]);
  // A flat top gives one peak, not one per grid point.
  const flat = { ...volume, data: new Float32Array(data.length) };
  for (const [i, j, k] of [[10, 10, 10], [11, 10, 10], [10, 11, 10]]) flat.data[i + 40 * (j + 40 * k)] = 1;
  assert.equal(mapPeaks(flat, 3).length, 1);
});
