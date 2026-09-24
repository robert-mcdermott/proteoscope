import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSurface, computeSASA } from './surface.js';
import { TIME_SCALE, examplePDB } from './test-data.mjs';

const PROBE = 1.4;
const VDW_RADII = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, SE: 1.9 };
const WATERS = new Set(['HOH', 'WAT', 'DOD']);

test('computeSASA of an isolated atom is 4*pi*(r + probe)^2', () => {
  const areas = computeSASA(new Float32Array([1, 2, 3]), new Float32Array([1.7]));
  const expected = 4 * Math.PI * (1.7 + PROBE) ** 2;
  assert.equal(areas.length, 1);
  assertRelative(areas[0], expected, 0.02, 'single-atom SASA');
});

test('computeSASA removes the buried cap between two overlapping atoms', () => {
  const distance = 3;
  const areas = computeSASA(new Float32Array([0, 0, 0, distance, 0, 0]), new Float32Array([1.7, 1.7]), { points: 960 });
  const radius = 1.7 + PROBE;
  const buriedCap = 2 * Math.PI * radius * (radius - distance / 2);
  const expected = 4 * Math.PI * radius * radius - buriedCap;
  assertRelative(areas[0], expected, 0.01, 'first atom');
  assertRelative(areas[1], expected, 0.01, 'second atom');
});

for (const kind of ['vdw', 'sas', 'ses', 'gaussian']) {
  test(`${kind} surface of an isolated atom is a closed, outward-facing sphere`, () => {
    const center = [0.37, -1.21, 2.08];
    const radius = 1.7;
    const surface = buildSurface(new Float32Array(center), new Float32Array([radius]), { kind, resolution: 0.4 });
    const sphereRadius = kind === 'sas' ? radius + PROBE : radius;
    const { area, volume } = meshMeasures(surface);

    assertRelative(area, 4 * Math.PI * sphereRadius ** 2, 0.03, `${kind} area`);
    assertRelative(volume, (4 / 3) * Math.PI * sphereRadius ** 3, 0.03, `${kind} volume`);
    assertClosedAndConsistent(surface.indices);
    assertValidMesh(surface, 1);

    const vertexCount = surface.positions.length / 3;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const dx = surface.positions[vertex * 3] - center[0];
      const dy = surface.positions[vertex * 3 + 1] - center[1];
      const dz = surface.positions[vertex * 3 + 2] - center[2];
      const length = Math.hypot(dx, dy, dz);
      const alignment = (dx * surface.normals[vertex * 3] + dy * surface.normals[vertex * 3 + 1]
        + dz * surface.normals[vertex * 3 + 2]) / length;
      assert.ok(alignment > 0.98, `normal ${vertex} points outward (alignment ${alignment})`);
      assert.ok(Math.abs(length - sphereRadius) < 0.05, `vertex ${vertex} lies on the sphere (${length})`);
    }
  });
}

test('default resolution meshes an isolated atom within 3% of the analytic area', () => {
  for (const kind of ['vdw', 'sas', 'ses']) {
    const surface = buildSurface(new Float32Array([0, 0, 0]), new Float32Array([1.7]), { kind });
    const sphereRadius = kind === 'sas' ? 1.7 + PROBE : 1.7;
    assert.equal(surface.spacing, 0.5);
    assertRelative(meshMeasures(surface).area, 4 * Math.PI * sphereRadius ** 2, 0.03, `${kind} area at 0.5 A`);
  }
});

test('SES of two atoms fills the crease, encloses the vdW union and matches the exact volume', () => {
  const direction = [0.36, 0.48, 0.8];
  const distance = 3.2;
  const radii = new Float32Array([1.7, 1.52]);
  const positions = new Float32Array([
    0.11, 0.07, -0.13,
    0.11 + distance * direction[0], 0.07 + distance * direction[1], -0.13 + distance * direction[2],
  ]);
  const ses = buildSurface(positions, radii, { kind: 'ses' });
  const sas = buildSurface(positions, radii, { kind: 'sas' });
  const vdw = buildSurface(positions, radii, { kind: 'vdw' });
  const sesMeasures = meshMeasures(ses);
  const vdwMeasures = meshMeasures(vdw);
  const exact = exactPairVolumes(distance, radii[0], radii[1], PROBE);

  assert.ok(sesMeasures.volume > vdwMeasures.volume, 'SES volume exceeds vdW volume');
  assert.ok(exact.ses > exact.vdw * 1.05, 'the crease is significant');
  assertRelative(sesMeasures.volume, exact.ses, 0.02, 'SES volume vs exact');
  assert.ok(meshMeasures(sas).area > sesMeasures.area, 'SAS area exceeds SES area');
  assertClosedAndConsistent(ses.indices);
  assertValidMesh(ses, 2);

  for (let vertex = 0; vertex < ses.positions.length / 3; vertex += 1) {
    let nearest = Infinity;
    for (let atom = 0; atom < 2; atom += 1) {
      const gap = Math.hypot(
        ses.positions[vertex * 3] - positions[atom * 3],
        ses.positions[vertex * 3 + 1] - positions[atom * 3 + 1],
        ses.positions[vertex * 3 + 2] - positions[atom * 3 + 2],
      ) - radii[atom];
      nearest = Math.min(nearest, gap);
    }
    assert.ok(nearest > -0.05, `SES vertex ${vertex} stays outside the vdW union (${nearest})`);
    assert.ok(nearest < PROBE, `SES vertex ${vertex} stays within a probe radius of an atom (${nearest})`);
  }
});

test('buildSurface handles empty input and rejects unknown kinds', () => {
  const empty = buildSurface(new Float32Array(0), new Float32Array(0));
  assert.equal(empty.positions.length, 0);
  assert.equal(empty.indices.length, 0);
  assert.equal(empty.voxelCount, 0);
  assert.throws(() => buildSurface(new Float32Array(3), new Float32Array([1.5]), { kind: 'cartoon' }), /Unknown surface kind/);
});

test('maxVoxels coarsens the grid', () => {
  const { positions, radii } = gridOfAtoms(4, 4, 4, 3.5);
  const fine = buildSurface(positions, radii, { kind: 'ses' });
  const coarse = buildSurface(positions, radii, { kind: 'ses', maxVoxels: 20000 });
  assert.equal(fine.spacing, 0.5);
  assert.ok(coarse.spacing > fine.spacing);
  assert.ok(coarse.voxelCount <= 20000);
  assertValidMesh(coarse, radii.length);
});

test('1ycr: SASA is plausible and every surface kind builds quickly', async (t) => {
  const { positions, radii, count } = parseHeavyAtoms(examplePDB('1ycr'));
  assert.equal(count, 818);

  const sasaStart = performance.now();
  const sasa = computeSASA(positions, radii);
  const sasaTime = performance.now() - sasaStart;
  const total = sasa.reduce((sum, value) => sum + value, 0);
  t.diagnostic(`1ycr SASA ${total.toFixed(0)} A^2 over ${count} atoms in ${sasaTime.toFixed(1)} ms`);
  assert.ok(total > 4500 && total < 7500, `total SASA ${total}`);
  assert.ok(sasa.every((value) => value >= 0 && value <= 4 * Math.PI * (1.8 + PROBE) ** 2 + 1e-3));

  const measures = {};
  for (const kind of ['ses', 'sas', 'vdw', 'gaussian']) {
    const start = performance.now();
    const surface = buildSurface(positions, radii, { kind });
    const elapsed = performance.now() - start;
    assertValidMesh(surface, count);
    measures[kind] = meshMeasures(surface);
    t.diagnostic(describe(`1ycr ${kind}`, surface, elapsed, measures[kind]));
    if (kind === 'ses') assert.ok(elapsed < 1000 * TIME_SCALE, `SES took ${elapsed} ms`);
  }
  assert.ok(measures.vdw.volume < measures.ses.volume && measures.ses.volume < measures.sas.volume);
  assert.ok(measures.ses.area < measures.vdw.area);
  assertRelative(measures.sas.area, total, 0.08, 'SAS mesh area vs Shrake-Rupley SASA');
  assertRelative(measures.gaussian.volume, measures.ses.volume, 0.1, 'Gaussian volume vs SES volume');
});

test('1tup (~5,400 atoms): SES at 0.5 A builds in under a second', async (t) => {
  const { positions, radii, count } = parseHeavyAtoms(examplePDB('1tup'));
  const start = performance.now();
  const surface = buildSurface(positions, radii, { kind: 'ses' });
  const elapsed = performance.now() - start;
  assertValidMesh(surface, count);
  t.diagnostic(describe(`1tup ses (${count} atoms)`, surface, elapsed, meshMeasures(surface)));
  assert.equal(surface.spacing, 0.5);
  assert.ok(elapsed < 1000 * TIME_SCALE, `SES took ${elapsed} ms`);
});

test('largest bundled files build with automatic resolution', async (t) => {
  for (const name of ['1jm7', '6vxx', '7lyb']) {
    const { positions, radii, count } = parseHeavyAtoms(examplePDB(name));
    for (const kind of ['ses', 'gaussian']) {
      const start = performance.now();
      const surface = buildSurface(positions, radii, { kind });
      const elapsed = performance.now() - start;
      assertValidMesh(surface, count);
      t.diagnostic(describe(`${name} ${kind} (${count} atoms)`, surface, elapsed));
    }
  }
});

test('~100,000 atoms (7lyb tiled 7x) auto-coarsen and build within 4 s', async (t) => {
  const source = parseHeavyAtoms(examplePDB('7lyb'));
  const copies = 7;
  const positions = new Float32Array(source.positions.length * copies);
  const radii = new Float32Array(source.radii.length * copies);
  for (let copy = 0; copy < copies; copy += 1) {
    const shift = [(copy & 1) * 110, ((copy >> 1) & 1) * 110, ((copy >> 2) & 1) * 110];
    for (let atom = 0; atom < source.count; atom += 1) {
      const target = copy * source.count + atom;
      positions[target * 3] = source.positions[atom * 3] + shift[0];
      positions[target * 3 + 1] = source.positions[atom * 3 + 1] + shift[1];
      positions[target * 3 + 2] = source.positions[atom * 3 + 2] + shift[2];
      radii[target] = source.radii[atom];
    }
  }
  const sasaStart = performance.now();
  computeSASA(positions, radii);
  t.diagnostic(`${radii.length} atoms: SASA in ${(performance.now() - sasaStart).toFixed(0)} ms`);
  for (const kind of ['ses', 'gaussian']) {
    const start = performance.now();
    const surface = buildSurface(positions, radii, { kind });
    const elapsed = performance.now() - start;
    assertValidMesh(surface, radii.length);
    t.diagnostic(describe(`${radii.length} atoms ${kind}`, surface, elapsed));
    assert.ok(surface.voxelCount <= 16e6);
    assert.ok(surface.spacing > 0.5);
    assert.ok(elapsed < 4000 * TIME_SCALE, `${kind} took ${elapsed} ms`);
  }
});

test('surface worker answers surface, potential and sasa requests', async () => {
  const messages = [];
  globalThis.self = { postMessage: (message, transfer) => messages.push({ message, transfer }) };
  await import('./surface-worker.js');
  const positions = new Float32Array([0, 0, 0, 3, 0, 0]);
  const radii = new Float32Array([1.7, 1.7]);

  self.onmessage({
    data: {
      id: 7,
      type: 'surface',
      payload: { positions, radii, options: { kind: 'ses' }, charges: new Float32Array([1, 0]), chargePositions: positions },
    },
  });
  const surfaceReply = messages.shift();
  assert.equal(surfaceReply.message.id, 7);
  const { result } = surfaceReply.message;
  assert.equal(result.potential.length, result.positions.length / 3);
  assert.ok(result.potential.some((value) => value > 0));
  assert.ok(surfaceReply.transfer.includes(result.positions.buffer));
  assert.ok(surfaceReply.transfer.includes(result.potential.buffer));

  self.onmessage({ data: { id: 8, type: 'sasa', payload: { positions, radii } } });
  const sasaReply = messages.shift();
  assert.equal(sasaReply.message.id, 8);
  assert.equal(sasaReply.message.result.length, 2);
  assert.deepEqual(sasaReply.transfer, [sasaReply.message.result.buffer]);

  self.onmessage({ data: { id: 9, type: 'volume', payload: {} } });
  assert.deepEqual(messages.shift().message, { id: 9, error: 'Unknown surface worker request "volume"' });
});

function parseHeavyAtoms(text) {
  const coordinates = [];
  const radii = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const altLoc = line.slice(16, 17).trim();
    const resName = line.slice(17, 20).trim();
    const name = line.slice(12, 16).trim();
    const element = (line.slice(76, 78).trim() || name.replace(/[^A-Za-z]/g, '').slice(0, 1)).toUpperCase();
    if ((altLoc && altLoc !== 'A') || WATERS.has(resName) || element === 'H' || element === 'D') continue;
    coordinates.push(Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54)));
    radii.push(VDW_RADII[element] ?? 1.8);
  }
  return { positions: new Float32Array(coordinates), radii: new Float32Array(radii), count: radii.length };
}

function gridOfAtoms(countX, countY, countZ, spacing) {
  const coordinates = [];
  for (let z = 0; z < countZ; z += 1) {
    for (let y = 0; y < countY; y += 1) {
      for (let x = 0; x < countX; x += 1) coordinates.push(x * spacing, y * spacing, z * spacing);
    }
  }
  return { positions: new Float32Array(coordinates), radii: new Float32Array(coordinates.length / 3).fill(1.7) };
}

function meshMeasures(surface) {
  const { positions, indices } = surface;
  let area = 0;
  let volume = 0;
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle] * 3;
    const b = indices[triangle + 1] * 3;
    const c = indices[triangle + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    volume += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
  }
  return { area, volume };
}

function assertClosedAndConsistent(indices) {
  const directed = new Map();
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const from = indices[triangle + corner];
      const to = indices[triangle + ((corner + 1) % 3)];
      const key = `${from},${to}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of directed) {
    const [from, to] = key.split(',');
    assert.equal(count, 1, `directed edge ${key} is used once`);
    assert.equal(directed.get(`${to},${from}`), 1, `edge ${key} is shared by exactly two triangles with opposite winding`);
  }
}

function assertValidMesh(surface, atomCount) {
  const vertexCount = surface.positions.length / 3;
  assert.ok(surface.positions instanceof Float32Array);
  assert.ok(surface.normals instanceof Float32Array);
  assert.ok(surface.indices instanceof Uint32Array);
  assert.ok(surface.atoms instanceof Uint32Array);
  assert.ok(vertexCount > 0);
  assert.equal(surface.normals.length, surface.positions.length);
  assert.equal(surface.atoms.length, vertexCount);
  assert.equal(surface.indices.length % 3, 0);
  assert.ok(surface.voxelCount > 0 && surface.spacing > 0);
  assert.ok(Number.isFinite(surface.timings.total));
  for (let index = 0; index < surface.indices.length; index += 1) {
    if (surface.indices[index] >= vertexCount) assert.fail(`index ${index} out of range`);
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const length = Math.hypot(surface.normals[vertex * 3], surface.normals[vertex * 3 + 1], surface.normals[vertex * 3 + 2]);
    if (Math.abs(length - 1) > 1e-3) assert.fail(`normal ${vertex} has length ${length}`);
    if (surface.atoms[vertex] >= atomCount) assert.fail(`vertex ${vertex} maps to atom ${surface.atoms[vertex]}`);
  }
}

function assertRelative(actual, expected, tolerance, label) {
  const error = Math.abs(actual / expected - 1);
  assert.ok(error <= tolerance, `${label}: ${actual} vs ${expected} (${(error * 100).toFixed(2)}% > ${tolerance * 100}%)`);
}

function describe(label, surface, elapsed, measures) {
  const timings = Object.entries(surface.timings).map(([step, value]) => `${step} ${value.toFixed(0)}`).join(', ');
  const size = measures ? `, area ${measures.area.toFixed(0)} A^2, volume ${measures.volume.toFixed(0)} A^3` : '';
  return `${label}: ${elapsed.toFixed(0)} ms at ${surface.spacing.toFixed(3)} A, ${(surface.voxelCount / 1e6).toFixed(2)}M voxels, `
    + `${surface.positions.length / 3} vertices, ${surface.indices.length / 3} triangles${size} [${timings}]`;
}

// Exact volumes for two atoms: a point is inside the SES when its distance to the region
// outside both probe-expanded spheres exceeds the probe radius (axisymmetric integration).
function exactPairVolumes(distance, radiusA, radiusB, probe) {
  const expandedA = radiusA + probe;
  const expandedB = radiusB + probe;
  const step = 0.01;
  let ses = 0;
  let vdw = 0;
  for (let axial = -expandedA; axial <= distance + expandedB; axial += step) {
    for (let radial = step / 2; radial <= Math.max(expandedA, expandedB); radial += step) {
      const weight = 2 * Math.PI * radial * step * step;
      if (Math.hypot(axial, radial) < radiusA || Math.hypot(axial - distance, radial) < radiusB) vdw += weight;
      if (depthInsidePair(axial, radial, distance, expandedA, expandedB) > probe) ses += weight;
    }
  }
  return { ses, vdw };
}

function depthInsidePair(axial, radial, distance, radiusA, radiusB) {
  const fromA = Math.hypot(axial, radial);
  const fromB = Math.hypot(axial - distance, radial);
  if (fromA >= radiusA && fromB >= radiusB) return 0;
  let depth = Infinity;
  if (fromA > 1e-12 && Math.hypot((axial / fromA) * radiusA - distance, (radial / fromA) * radiusA) >= radiusB) {
    depth = Math.min(depth, Math.abs(radiusA - fromA));
  }
  if (fromB > 1e-12 && Math.hypot(distance + ((axial - distance) / fromB) * radiusB, (radial / fromB) * radiusB) >= radiusA) {
    depth = Math.min(depth, Math.abs(radiusB - fromB));
  }
  const circleAxial = (distance * distance + radiusA * radiusA - radiusB * radiusB) / (2 * distance);
  const circleRadial = Math.sqrt(Math.max(0, radiusA * radiusA - circleAxial * circleAxial));
  return Math.min(depth, Math.hypot(axial - circleAxial, radial - circleRadial));
}
