import { add, cross, dot, length, normalize, scale, sub } from './math3d.js';
import { polymerSegments } from './structure.js';
import { PURINES } from './residues.js';

export const CARTOON_DIMENSIONS = {
  helixWidth: 2.1,
  helixThickness: 0.42,
  sheetWidth: 2.0,
  sheetThickness: 0.42,
  arrowWidth: 3.3,
  coilRadius: 0.26,
  nucleicRadius: 0.72,
  baseThickness: 0.34,
  baseConnectorRadius: 0.34,
};

const PROFILE = {
  coil: { exponent: 2 },
  turn: { exponent: 2 },
  helix: { exponent: 2 },
  sheet: { exponent: 6 },
};

const PURINE_RINGS = [['N1', 'C2', 'N3', 'C4', 'C5', 'C6'], ['C4', 'C5', 'N7', 'C8', 'N9']];
const PYRIMIDINE_RINGS = [['N1', 'C2', 'N3', 'C4', 'C5', 'C6']];

export function buildCartoon(model, options = {}) {
  const include = options.include ?? (() => true);
  const widthScale = options.widthScale ?? 1;
  const quality = Math.max(2, Math.min(12, Math.round(options.quality ?? 6)));
  const sides = quality >= 7 ? 16 : quality >= 4 ? 12 : 8;
  const mesh = createMeshBuilder();
  const cylinders = [];
  const canvasShapes = [];
  const covered = new Set();

  for (const segment of polymerSegments(model.residues, 'protein', include)) {
    if (segment.length < 2) continue;
    for (const residue of segment) covered.add(residue.key);
    buildProteinSegment(mesh, canvasShapes, segment, { widthScale, quality, sides });
  }
  if (options.nucleic !== false) {
    for (const segment of polymerSegments(model.residues, 'nucleic', include)) {
      if (segment.length < 2) continue;
      for (const residue of segment) covered.add(residue.key);
      buildNucleicSegment(mesh, canvasShapes, cylinders, segment, { widthScale, quality, sides });
    }
  }
  return { ...mesh.finish(), cylinders, canvasShapes, covered };
}

function buildProteinSegment(mesh, canvasShapes, residues, options) {
  const count = residues.length;
  const controls = residues.map((residue) => point(residue.backbone.CA));
  for (let index = 1; index + 1 < count; index += 1) {
    if (residues[index].ss === 'sheet' && residues[index - 1].ss === 'sheet' && residues[index + 1].ss === 'sheet') {
      const a = point(residues[index - 1].backbone.CA);
      const b = point(residues[index].backbone.CA);
      const c = point(residues[index + 1].backbone.CA);
      controls[index] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4];
    }
  }
  const guides = proteinGuides(residues, controls);
  const sheetEnds = sheetRunEnds(residues);
  const samples = [];
  for (let index = 0; index + 1 < count; index += 1) {
    for (let step = 0; step < options.quality; step += 1) {
      const t = step / options.quality;
      samples.push(splineSample(controls, guides, index, t, residues));
    }
  }
  samples.push(splineSample(controls, guides, count - 2, 1, residues));
  orientSamples(samples);

  const dims = CARTOON_DIMENSIONS;
  const w = options.widthScale;
  for (const sample of samples) {
    const residue = residues[sample.residueIndex];
    const ss = residue.ss === 'turn' ? 'coil' : residue.ss;
    sample.ss = ss;
    sample.atom = residue.representative.id;
    if (ss === 'helix') {
      sample.width = dims.helixWidth * w;
      sample.thickness = dims.helixThickness * w;
    } else if (ss === 'sheet') {
      sample.width = dims.sheetWidth * w;
      sample.thickness = dims.sheetThickness * w;
    } else {
      sample.width = dims.coilRadius * 2 * w;
      sample.thickness = dims.coilRadius * 2 * w;
    }
    sample.exponent = PROFILE[ss].exponent;
    sample.sides = options.sides;
  }
  smoothTransitions(samples);
  applyArrowheads(samples, sheetEnds, dims.arrowWidth * w, dims.sheetWidth * w);

  mesh.cap(samples[0], -1);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.arrowBase) {
      mesh.ring(sample, { width: sample.baseWidth });
      mesh.step(sample, sample.baseWidth, sample.width);
    }
    mesh.ring(sample, {}, index > 0 && !sample.arrowBase);
    if (index > 0) {
      const previous = samples[index - 1];
      const flat = sample.ss === 'helix' || sample.ss === 'sheet';
      canvasShapes.push({
        a: previous.position,
        b: sample.position,
        atom: sample.atom,
        width: Math.max(previous.width, sample.width) * (flat ? 0.3 : 0.5),
        ss: sample.ss,
      });
    }
  }
  mesh.cap(samples[samples.length - 1], 1);
}

function proteinGuides(residues, controls) {
  const guides = [];
  let previous = null;
  for (let index = 0; index < residues.length; index += 1) {
    const residue = residues[index];
    const before = controls[Math.max(0, index - 1)];
    const after = controls[Math.min(controls.length - 1, index + 1)];
    const tangent = normalize(sub(after, before));
    let side = null;
    const { CA, C, O, N } = residue.backbone;
    if (CA && O) side = sub(point(O), point(CA));
    else if (CA && C && N) side = cross(sub(point(N), point(CA)), sub(point(C), point(CA)));
    if (side) side = normalize(sub(side, scale(tangent, dot(side, tangent))));
    if (!side || length(side) < 0.1) side = previous ?? perpendicular(tangent);
    if (previous && dot(side, previous) < 0) side = scale(side, -1);
    guides.push(side);
    previous = side;
  }
  return guides;
}

function splineSample(controls, guides, index, t, residues) {
  const p0 = controls[Math.max(0, index - 1)];
  const p1 = controls[index];
  const p2 = controls[Math.min(controls.length - 1, index + 1)];
  const p3 = controls[Math.min(controls.length - 1, index + 2)];
  const position = catmullRom(p0, p1, p2, p3, t);
  const derivative = catmullRomDerivative(p0, p1, p2, p3, t);
  const g1 = guides[index];
  const g2 = guides[Math.min(guides.length - 1, index + 1)];
  const guide = normalize([g1[0] + (g2[0] - g1[0]) * t, g1[1] + (g2[1] - g1[1]) * t, g1[2] + (g2[2] - g1[2]) * t]);
  return {
    position,
    tangent: normalize(derivative),
    guide,
    residueIndex: t < 0.5 ? index : Math.min(residues.length - 1, index + 1),
    u: index + t,
  };
}

function orientSamples(samples) {
  let previousSide = null;
  for (const sample of samples) {
    let tangent = sample.tangent;
    if (length(tangent) < 0.001) tangent = previousSide ? perpendicular(previousSide) : [1, 0, 0];
    let side = sub(sample.guide, scale(tangent, dot(sample.guide, tangent)));
    if (length(side) < 0.001) side = previousSide ?? perpendicular(tangent);
    side = normalize(side);
    if (previousSide && dot(side, previousSide) < 0) side = scale(side, -1);
    sample.tangent = tangent;
    sample.side = side;
    sample.up = normalize(cross(tangent, side));
    previousSide = side;
  }
}

function smoothTransitions(samples) {
  const widths = samples.map((sample) => sample.width);
  const thicknesses = samples.map((sample) => sample.thickness);
  const exponents = samples.map((sample) => sample.exponent);
  const radius = 2;
  for (let index = 0; index < samples.length; index += 1) {
    if (samples[index].ss === 'sheet') continue;
    let w = 0;
    let t = 0;
    let e = 0;
    let n = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const neighbor = index + offset;
      if (neighbor < 0 || neighbor >= samples.length) continue;
      w += widths[neighbor];
      t += thicknesses[neighbor];
      e += exponents[neighbor];
      n += 1;
    }
    samples[index].width = w / n;
    samples[index].thickness = t / n;
    samples[index].exponent = e / n;
  }
}

function sheetRunEnds(residues) {
  const ends = new Set();
  for (let index = 0; index < residues.length; index += 1) {
    if (residues[index].ss !== 'sheet') continue;
    const next = residues[index + 1];
    if (!next || next.ss !== 'sheet') {
      const previous = residues[index - 1];
      if (previous && previous.ss === 'sheet') ends.add(index);
    }
  }
  return ends;
}

function applyArrowheads(samples, sheetEnds, arrowWidth, sheetWidth) {
  for (const end of sheetEnds) {
    const start = end - 1;
    let baseMarked = false;
    for (const sample of samples) {
      if (sample.u < start - 1e-6 || sample.u > end + 1e-6) continue;
      const progress = (sample.u - start) / (end - start);
      sample.width = arrowWidth + (0.12 - arrowWidth) * progress;
      sample.exponent = 6;
      if (!baseMarked) {
        sample.arrowBase = true;
        sample.baseWidth = sheetWidth;
        baseMarked = true;
      }
    }
  }
}

function buildNucleicSegment(mesh, canvasShapes, cylinders, residues, options) {
  const controls = residues.map((residue) => point(residue.nucleic.P ?? residue.nucleic.C4));
  const guides = residues.map((residue, index) => {
    const before = controls[Math.max(0, index - 1)];
    const after = controls[Math.min(controls.length - 1, index + 1)];
    return perpendicular(normalize(sub(after, before)));
  });
  const samples = [];
  for (let index = 0; index + 1 < residues.length; index += 1) {
    for (let step = 0; step < options.quality; step += 1) {
      samples.push(splineSample(controls, guides, index, step / options.quality, residues));
    }
  }
  samples.push(splineSample(controls, guides, residues.length - 2, 1, residues));
  orientSamples(samples);
  const radius = CARTOON_DIMENSIONS.nucleicRadius * options.widthScale;
  for (const sample of samples) {
    const residue = residues[sample.residueIndex];
    sample.atom = (residue.nucleic.P ?? residue.nucleic.C4 ?? residue.representative).id;
    sample.width = radius * 2;
    sample.thickness = radius * 2;
    sample.exponent = 2;
    sample.ss = 'coil';
    sample.sides = options.sides;
  }
  mesh.cap(samples[0], -1);
  samples.forEach((sample, index) => {
    mesh.ring(sample, {}, index > 0);
    if (index > 0) {
      canvasShapes.push({ a: samples[index - 1].position, b: sample.position, atom: sample.atom, width: radius, ss: 'coil' });
    }
  });
  mesh.cap(samples[samples.length - 1], 1);

  for (const residue of residues) {
    const base = baseGeometry(residue);
    if (!base) continue;
    for (const ring of base.rings) mesh.slab(ring, base.atom, CARTOON_DIMENSIONS.baseThickness * options.widthScale);
    const anchor = residue.nucleic.C4 ?? residue.nucleic.C3 ?? residue.nucleic.P;
    if (anchor) {
      cylinders.push({
        a: point(anchor),
        b: point(base.glycosidic),
        radius: CARTOON_DIMENSIONS.baseConnectorRadius * options.widthScale,
        atomA: anchor.id,
        atomB: base.glycosidic.id,
      });
      canvasShapes.push({ a: point(anchor), b: point(base.glycosidic), atom: base.atom, width: 0.5, ss: 'base' });
    }
  }
}

function baseGeometry(residue) {
  const names = residue.atomByName;
  const purine = PURINES.has(residue.code) || (names.has('N9') && names.has('C8'));
  const rings = [];
  for (const ring of purine ? PURINE_RINGS : PYRIMIDINE_RINGS) {
    const atoms = ring.map((name) => names.get(name));
    if (atoms.every(Boolean)) rings.push(atoms);
  }
  const glycosidic = names.get(purine ? 'N9' : 'N1');
  if (!rings.length || !glycosidic) return null;
  return { rings, glycosidic, atom: glycosidic.id };
}

function createMeshBuilder() {
  let buffer = new ArrayBuffer(32 * 4096);
  let floats = new Float32Array(buffer);
  let uints = new Uint32Array(buffer);
  let vertexCount = 0;
  let indices = new Uint32Array(8192);
  let indexCount = 0;
  let previousRing = null;

  function ensureVertices(extra) {
    if ((vertexCount + extra) * 32 <= buffer.byteLength) return;
    let size = buffer.byteLength * 2;
    while ((vertexCount + extra) * 32 > size) size *= 2;
    const grown = new ArrayBuffer(size);
    new Uint8Array(grown).set(new Uint8Array(buffer, 0, vertexCount * 32));
    buffer = grown;
    floats = new Float32Array(buffer);
    uints = new Uint32Array(buffer);
  }

  function ensureIndices(extra) {
    if (indexCount + extra <= indices.length) return;
    let size = indices.length * 2;
    while (indexCount + extra > size) size *= 2;
    const grown = new Uint32Array(size);
    grown.set(indices.subarray(0, indexCount));
    indices = grown;
  }

  function vertex(position, normal, atom) {
    ensureVertices(1);
    const offset = vertexCount * 8;
    floats[offset] = position[0];
    floats[offset + 1] = position[1];
    floats[offset + 2] = position[2];
    floats[offset + 3] = normal[0];
    floats[offset + 4] = normal[1];
    floats[offset + 5] = normal[2];
    uints[offset + 6] = atom;
    uints[offset + 7] = 0;
    vertexCount += 1;
    return vertexCount - 1;
  }

  function triangle(a, b, c) {
    ensureIndices(3);
    indices[indexCount] = a;
    indices[indexCount + 1] = b;
    indices[indexCount + 2] = c;
    indexCount += 3;
  }

  function profile(sample, width, sides) {
    const halfWidth = Math.max(0.01, width / 2);
    const halfThickness = Math.max(0.01, sample.thickness / 2);
    const exponent = sample.exponent;
    const points = [];
    for (let index = 0; index < sides; index += 1) {
      const theta = (index / sides) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / exponent) * halfWidth;
      const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / exponent) * halfThickness;
      const gx = Math.sign(x) * Math.pow(Math.abs(x / halfWidth), exponent - 1) / halfWidth;
      const gy = Math.sign(y) * Math.pow(Math.abs(y / halfThickness), exponent - 1) / halfThickness;
      points.push({ x, y, gx, gy });
    }
    return points;
  }

  return {
    ring(sample, override = {}, connect = true) {
      const sides = sample.sides ?? 12;
      const width = override.width ?? sample.width;
      const points = profile(sample, width, sides);
      const start = vertexCount;
      for (const item of points) {
        const position = add(sample.position, add(scale(sample.side, item.x), scale(sample.up, item.y)));
        const normal = normalize(add(scale(sample.side, item.gx), scale(sample.up, item.gy)));
        vertex(position, normal, sample.atom);
      }
      if (connect && previousRing && previousRing.sides === sides) {
        for (let index = 0; index < sides; index += 1) {
          const next = (index + 1) % sides;
          triangle(previousRing.start + index, start + index, start + next);
          triangle(previousRing.start + index, start + next, previousRing.start + next);
        }
      }
      previousRing = { start, sides, sample, width };
    },
    step(sample, fromWidth, toWidth) {
      const sides = sample.sides ?? 12;
      const normal = scale(sample.tangent, -1);
      const inner = profile(sample, fromWidth, sides);
      const outer = profile(sample, toWidth, sides);
      const innerStart = vertexCount;
      for (const item of inner) vertex(add(sample.position, add(scale(sample.side, item.x), scale(sample.up, item.y))), normal, sample.atom);
      const outerStart = vertexCount;
      for (const item of outer) vertex(add(sample.position, add(scale(sample.side, item.x), scale(sample.up, item.y))), normal, sample.atom);
      for (let index = 0; index < sides; index += 1) {
        const next = (index + 1) % sides;
        triangle(innerStart + index, outerStart + index, outerStart + next);
        triangle(innerStart + index, outerStart + next, innerStart + next);
      }
      previousRing = null;
    },
    cap(sample, direction) {
      const sides = sample.sides ?? 12;
      const normal = scale(sample.tangent, direction);
      const points = profile(sample, sample.width, sides);
      const center = vertex(sample.position, normal, sample.atom);
      const start = vertexCount;
      for (const item of points) vertex(add(sample.position, add(scale(sample.side, item.x), scale(sample.up, item.y))), normal, sample.atom);
      for (let index = 0; index < sides; index += 1) triangle(center, start + index, start + ((index + 1) % sides));
      previousRing = null;
    },
    slab(ringAtoms, atom, thickness) {
      const positions = ringAtoms.map(point);
      const centroid = scale(positions.reduce((sum, p) => add(sum, p), [0, 0, 0]), 1 / positions.length);
      let normal = [0, 0, 0];
      for (let index = 0; index < positions.length; index += 1) {
        const a = positions[index];
        const b = positions[(index + 1) % positions.length];
        normal = add(normal, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
      }
      normal = normalize(normal);
      if (length(normal) < 0.5) return;
      const half = scale(normal, thickness / 2);
      for (const direction of [1, -1]) {
        const faceNormal = scale(normal, direction);
        const offset = scale(half, direction);
        const center = vertex(add(centroid, offset), faceNormal, atom);
        const start = vertexCount;
        for (const p of positions) vertex(add(p, offset), faceNormal, atom);
        for (let index = 0; index < positions.length; index += 1) triangle(center, start + index, start + ((index + 1) % positions.length));
      }
      for (let index = 0; index < positions.length; index += 1) {
        const a = positions[index];
        const b = positions[(index + 1) % positions.length];
        const edgeNormal = normalize(sub(scale(add(a, b), 0.5), centroid));
        const v0 = vertex(add(a, half), edgeNormal, atom);
        const v1 = vertex(add(b, half), edgeNormal, atom);
        const v2 = vertex(sub(b, half), edgeNormal, atom);
        const v3 = vertex(sub(a, half), edgeNormal, atom);
        triangle(v0, v1, v2);
        triangle(v0, v2, v3);
      }
      previousRing = null;
    },
    finish() {
      return {
        vertices: buffer.slice(0, vertexCount * 32),
        indices: indices.slice(0, indexCount),
        vertexCount,
      };
    },
  };
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const out = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    out[axis] = 0.5 * (
      2 * p1[axis] +
      (-p0[axis] + p2[axis]) * t +
      (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
      (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3
    );
  }
  return out;
}

function catmullRomDerivative(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const out = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    out[axis] = 0.5 * (
      (-p0[axis] + p2[axis]) +
      2 * (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t +
      3 * (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t2
    );
  }
  return out;
}

function perpendicular(v) {
  const reference = Math.abs(v[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0];
  return normalize(cross(v, reference));
}

function point(atom) {
  return [atom.x, atom.y, atom.z];
}
