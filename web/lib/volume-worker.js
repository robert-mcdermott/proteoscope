// Density maps live in this worker: parsing (CCP4/MRC files can hold hundreds of megabytes),
// isosurfaces for a region, and map values at atoms. The page keeps only summaries.
import { contourVolume, extractRegion, gridSpacing, mapFit, parseMRC, parseVolumeServerData } from './volume.js';

const volumes = new Map();

self.onmessage = (event) => {
  const { id, type, payload = {} } = event.data ?? {};
  try {
    if (type === 'parse-mrc') {
      const volume = parseMRC(new Uint8Array(payload.bytes), payload.name);
      volumes.set(payload.key, volume);
      self.postMessage({ id, result: [summary(payload.key, volume)] });
      return;
    }
    if (type === 'parse-server') {
      const list = parseVolumeServerData(new Uint8Array(payload.bytes));
      const summaries = list.map((volume, index) => {
        const key = `${payload.key}:${index}`;
        volumes.set(key, volume);
        return summary(key, volume);
      });
      self.postMessage({ id, result: summaries });
      return;
    }
    if (type === 'contour') {
      const volume = volumes.get(payload.key);
      if (!volume) throw new Error('The map is no longer loaded.');
      const region = payload.min && payload.max ? extractRegion(volume, payload.min, payload.max, payload.stride ?? 1) : payload.stride > 1 ? strided(volume, payload.stride) : volume;
      // A level is a number, or { level, below } for the side below it.
      const meshes = (payload.levels ?? []).map((item) => {
        const { level, below } = typeof item === 'number' ? { level: item } : item;
        if (!region) return { level, positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0), edges: new Uint32Array(0) };
        return { level, ...contourVolume(region, level, { zone: payload.zone, below }) };
      });
      const transfer = meshes.flatMap((mesh) => [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer, mesh.edges.buffer]);
      self.postMessage({ id, result: { meshes, spacing: region ? gridSpacing(region) : NaN } }, transfer);
      return;
    }
    if (type === 'fit') {
      const volume = volumes.get(payload.key);
      if (!volume) throw new Error('The map is no longer loaded.');
      const fit = mapFit(volume, payload.positions, payload.groups, payload.groupCount, payload.level);
      self.postMessage({ id, result: fit }, [fit.sigma.buffer, fit.inclusion.buffer, fit.counts.buffer, fit.sums.buffer, fit.sampled.buffer, fit.insideCounts.buffer]);
      return;
    }
    if (type === 'drop') {
      for (const key of [...volumes.keys()]) if (key === payload.key || key.startsWith(`${payload.key}:`)) volumes.delete(key);
      self.postMessage({ id, result: true });
      return;
    }
    throw new Error(`Unknown volume worker request "${type}"`);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};

function summary(key, volume) {
  return { key, name: volume.name, dims: volume.dims, origin: volume.origin, axes: volume.axes, stats: volume.stats, spacing: gridSpacing(volume), sampleRate: volume.sampleRate };
}

// The whole map at every `stride`-th point, for an overview of a large cryo-EM map.
function strided(volume, stride) {
  const far = volume.dims.map((count, index) => count - 1);
  const corner = (i, j, k) => {
    const [u, v, w] = volume.axes;
    return [0, 1, 2].map((axis) => volume.origin[axis] + i * u[axis] + j * v[axis] + k * w[axis]);
  };
  const points = [];
  for (let c = 0; c < 8; c += 1) points.push(corner(c & 1 ? far[0] : 0, c & 2 ? far[1] : 0, c & 4 ? far[2] : 0));
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  return extractRegion(volume, min, max, stride);
}
