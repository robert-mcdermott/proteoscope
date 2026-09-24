const DEFAULT_PROBE = 1.4;
const DEFAULT_RESOLUTION = 0.5;
const DEFAULT_MAX_VOXELS = 16e6;
const DEFAULT_SMOOTHNESS = 1.5;
const DEFAULT_SASA_POINTS = 96;
const GAUSSIAN_SHARPNESS = 1.8;
const GAUSSIAN_CUTOFF = 0.005;
const GAUSSIAN_ASSIGN_REACH = 1.5;
const PROJECTION_STEPS = 2;
const CREASE_GRADIENT = 0.75;
const FAR = 1e30;
const SURFACE_KINDS = new Set(['ses', 'sas', 'vdw', 'gaussian']);

export function computeSASA(positions, radii, options = {}) {
  return sasaCore(positions, radii, options, null).areas;
}

// One pass yields both the SASA in the full assembly and each atom's SASA when only atoms of
// its own group (e.g. chain) are present, which gives buried surface area per group.
export function computeGroupedSASA(positions, radii, groups, options = {}) {
  const { areas, isolated } = sasaCore(positions, radii, options, groups);
  return { complex: areas, isolated };
}

function sasaCore(positions, radii, options, groups) {
  const probe = Math.max(0, finiteOr(options.probe, DEFAULT_PROBE));
  const pointCount = Math.max(1, Math.round(finiteOr(options.points, DEFAULT_SASA_POINTS)));
  const atomCount = radii.length;
  const areas = new Float32Array(atomCount);
  const isolated = groups ? new Float32Array(atomCount) : null;
  if (atomCount === 0) return { areas, isolated };

  const sphere = spherePoints(pointCount);
  const expanded = new Float64Array(atomCount);
  let maxExpanded = 0;
  for (let atom = 0; atom < atomCount; atom += 1) {
    const radius = Math.max(0, finiteOr(radii[atom], 0)) + probe;
    expanded[atom] = radius;
    if (radius > maxExpanded) maxExpanded = radius;
  }

  const grid = buildAtomGrid(positions, atomCount, 2 * maxExpanded);
  let capacity = 64;
  let neighborX = new Float64Array(capacity);
  let neighborY = new Float64Array(capacity);
  let neighborZ = new Float64Array(capacity);
  let neighborR2 = new Float64Array(capacity);
  let neighborSame = new Uint8Array(capacity);

  for (let atom = 0; atom < atomCount; atom += 1) {
    const cell = grid.atomCell[atom];
    if (cell < 0) continue;
    const x = positions[atom * 3];
    const y = positions[atom * 3 + 1];
    const z = positions[atom * 3 + 2];
    const radius = expanded[atom];
    const cellX = cell % grid.dimX;
    const cellY = Math.floor(cell / grid.dimX) % grid.dimY;
    const cellZ = Math.floor(cell / (grid.dimX * grid.dimY));
    let neighborCount = 0;

    for (let iz = Math.max(0, cellZ - 1); iz <= Math.min(grid.dimZ - 1, cellZ + 1); iz += 1) {
      for (let iy = Math.max(0, cellY - 1); iy <= Math.min(grid.dimY - 1, cellY + 1); iy += 1) {
        for (let ix = Math.max(0, cellX - 1); ix <= Math.min(grid.dimX - 1, cellX + 1); ix += 1) {
          const neighborCell = ix + grid.dimX * (iy + grid.dimY * iz);
          for (let slot = grid.cellStart[neighborCell]; slot < grid.cellStart[neighborCell + 1]; slot += 1) {
            const other = grid.cellAtoms[slot];
            if (other === atom) continue;
            const dx = positions[other * 3] - x;
            const dy = positions[other * 3 + 1] - y;
            const dz = positions[other * 3 + 2] - z;
            const reach = radius + expanded[other];
            if (dx * dx + dy * dy + dz * dz >= reach * reach) continue;
            if (neighborCount === capacity) {
              capacity *= 2;
              neighborX = growFloat64(neighborX, capacity);
              neighborY = growFloat64(neighborY, capacity);
              neighborZ = growFloat64(neighborZ, capacity);
              neighborR2 = growFloat64(neighborR2, capacity);
              const grownSame = new Uint8Array(capacity);
              grownSame.set(neighborSame);
              neighborSame = grownSame;
            }
            neighborX[neighborCount] = positions[other * 3];
            neighborY[neighborCount] = positions[other * 3 + 1];
            neighborZ[neighborCount] = positions[other * 3 + 2];
            neighborR2[neighborCount] = expanded[other] * expanded[other];
            neighborSame[neighborCount] = groups && groups[other] === groups[atom] ? 1 : 0;
            neighborCount += 1;
          }
        }
      }
    }

    let accessible = 0;
    let accessibleAlone = 0;
    let lastBlocker = 0;
    for (let point = 0; point < pointCount; point += 1) {
      const px = x + radius * sphere[point * 3];
      const py = y + radius * sphere[point * 3 + 1];
      const pz = z + radius * sphere[point * 3 + 2];
      if (groups) {
        let buriedAny = false;
        let buriedSame = false;
        for (let neighbor = 0; !buriedSame && neighbor < neighborCount; neighbor += 1) {
          const dx = px - neighborX[neighbor];
          const dy = py - neighborY[neighbor];
          const dz = pz - neighborZ[neighbor];
          if (dx * dx + dy * dy + dz * dz < neighborR2[neighbor]) {
            buriedAny = true;
            if (neighborSame[neighbor]) buriedSame = true;
          }
        }
        if (!buriedAny) accessible += 1;
        if (!buriedSame) accessibleAlone += 1;
        continue;
      }
      let buried = false;
      if (neighborCount > 0) {
        const dx = px - neighborX[lastBlocker];
        const dy = py - neighborY[lastBlocker];
        const dz = pz - neighborZ[lastBlocker];
        buried = dx * dx + dy * dy + dz * dz < neighborR2[lastBlocker];
      }
      for (let neighbor = 0; !buried && neighbor < neighborCount; neighbor += 1) {
        const dx = px - neighborX[neighbor];
        const dy = py - neighborY[neighbor];
        const dz = pz - neighborZ[neighbor];
        if (dx * dx + dy * dy + dz * dz < neighborR2[neighbor]) {
          buried = true;
          lastBlocker = neighbor;
        }
      }
      if (!buried) accessible += 1;
    }
    areas[atom] = (4 * Math.PI * radius * radius * accessible) / pointCount;
    if (isolated) isolated[atom] = (4 * Math.PI * radius * radius * accessibleAlone) / pointCount;
  }
  return { areas, isolated };
}

export function buildSurface(positions, radii, options = {}) {
  const started = now();
  const kind = options.kind ?? 'ses';
  if (!SURFACE_KINDS.has(kind)) throw new Error(`Unknown surface kind "${kind}"`);
  const probe = Math.max(0, finiteOr(options.probe, DEFAULT_PROBE));
  const maxVoxels = Math.max(4096, finiteOr(options.maxVoxels, DEFAULT_MAX_VOXELS));
  const smoothness = Math.max(0.05, finiteOr(options.smoothness, DEFAULT_SMOOTHNESS));
  const resolution = options.resolution > 0 ? options.resolution : DEFAULT_RESOLUTION;
  const timings = { grid: 0, field: 0, distance: 0, contour: 0, refine: 0, atoms: 0, total: 0 };

  const bounds = atomBounds(positions, radii);
  if (bounds.count === 0) {
    timings.total = now() - started;
    return emptySurface(resolution, timings);
  }

  const mode = kind === 'ses' && probe === 0 ? 'vdw' : kind;
  const shell = mode === 'sas' || mode === 'ses' ? probe : 0;
  const sharpness = GAUSSIAN_SHARPNESS / smoothness;
  const gaussianScale = Math.sqrt(1 + Math.log(1 / GAUSSIAN_CUTOFF) / sharpness);
  const padding = (spacing) => (mode === 'gaussian'
    ? bounds.maxRadius * gaussianScale + 3 * spacing
    : bounds.maxRadius + shell + 4 * spacing);
  const grid = planGrid(bounds, resolution, maxVoxels, padding);
  const field = new Float32Array(grid.voxelCount);
  timings.grid = now() - started;

  let mark = now();
  let iso = 0;
  if (mode === 'gaussian') {
    splatGaussians(field, grid, positions, radii, sharpness, gaussianScale);
    iso = -1;
  } else {
    // Distances are exact up to `limit`: SAS/vdW contours need three voxels beyond the iso
    // value for the refinement stencil, the SES only needs ball radii near the SAS boundary.
    const limit = shell + (mode === 'ses' ? 2 : 3) * grid.spacing;
    field.fill(limit);
    splatDistances(field, grid, positions, radii, limit);
    if (mode === 'sas') iso = probe;
  }
  timings.field = now() - mark;

  if (mode === 'ses') {
    mark = now();
    solventExcludedField(field, grid, probe);
    timings.distance = now() - mark;
  }

  mark = now();
  const mesh = contourSurfaceNets(field, grid, iso);
  timings.contour = now() - mark;

  mark = now();
  const minGradient = mode === 'gaussian' ? 0 : CREASE_GRADIENT;
  const normals = refineVertices(field, grid, iso, mesh.positions, mesh.cells, mesh.vertexCount, minGradient);
  timings.refine = now() - mark;

  mark = now();
  const reach = (mode === 'gaussian' ? GAUSSIAN_ASSIGN_REACH : shell) + 0.25 + 0.5 * grid.spacing;
  const atoms = nearestAtoms(mesh.positions, mesh.vertexCount, positions, radii, bounds.maxRadius, reach);
  repairNormals(normals, mesh.positions, mesh.vertexCount, atoms, positions);
  timings.atoms = now() - mark;
  timings.total = now() - started;

  return {
    positions: mesh.positions,
    normals,
    indices: mesh.indices,
    atoms,
    spacing: grid.spacing,
    voxelCount: grid.voxelCount,
    timings,
  };
}

function now() {
  return performance.now();
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function growFloat64(array, capacity) {
  const next = new Float64Array(capacity);
  next.set(array);
  return next;
}

function spherePoints(count) {
  const points = new Float64Array(count * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const z = 1 - (2 * index + 1) / count;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const theta = goldenAngle * index;
    points[index * 3] = Math.cos(theta) * ring;
    points[index * 3 + 1] = Math.sin(theta) * ring;
    points[index * 3 + 2] = z;
  }
  return points;
}

function isUsableAtom(positions, radii, atom) {
  return Number.isFinite(positions[atom * 3])
    && Number.isFinite(positions[atom * 3 + 1])
    && Number.isFinite(positions[atom * 3 + 2])
    && Number.isFinite(radii[atom]);
}

function atomBounds(positions, radii) {
  const bounds = {
    count: 0,
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
    maxRadius: 0,
  };
  for (let atom = 0; atom < radii.length; atom += 1) {
    if (!isUsableAtom(positions, radii, atom)) continue;
    const x = positions[atom * 3];
    const y = positions[atom * 3 + 1];
    const z = positions[atom * 3 + 2];
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    bounds.maxZ = Math.max(bounds.maxZ, z);
    bounds.maxRadius = Math.max(bounds.maxRadius, radii[atom]);
    bounds.count += 1;
  }
  return bounds;
}

function buildAtomGrid(positions, atomCount, cellSize) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let valid = 0;
  for (let atom = 0; atom < atomCount; atom += 1) {
    const x = positions[atom * 3];
    const y = positions[atom * 3 + 1];
    const z = positions[atom * 3 + 2];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
    valid += 1;
  }
  const atomCell = new Int32Array(atomCount).fill(-1);
  if (valid === 0) {
    return {
      minX: 0, minY: 0, minZ: 0, size: 1, dimX: 1, dimY: 1, dimZ: 1,
      cellStart: new Int32Array(2), cellAtoms: new Int32Array(0), atomCell,
    };
  }

  let size = Math.max(cellSize, 1e-3);
  const cellLimit = Math.max(4096, atomCount * 8);
  let dimX = Math.floor((maxX - minX) / size) + 1;
  let dimY = Math.floor((maxY - minY) / size) + 1;
  let dimZ = Math.floor((maxZ - minZ) / size) + 1;
  while (dimX * dimY * dimZ > cellLimit) {
    size *= 1.25;
    dimX = Math.floor((maxX - minX) / size) + 1;
    dimY = Math.floor((maxY - minY) / size) + 1;
    dimZ = Math.floor((maxZ - minZ) / size) + 1;
  }

  const cellCount = dimX * dimY * dimZ;
  const cellStart = new Int32Array(cellCount + 1);
  for (let atom = 0; atom < atomCount; atom += 1) {
    const x = positions[atom * 3];
    const y = positions[atom * 3 + 1];
    const z = positions[atom * 3 + 2];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
    const cx = Math.min(dimX - 1, Math.floor((x - minX) / size));
    const cy = Math.min(dimY - 1, Math.floor((y - minY) / size));
    const cz = Math.min(dimZ - 1, Math.floor((z - minZ) / size));
    const cell = cx + dimX * (cy + dimY * cz);
    atomCell[atom] = cell;
    cellStart[cell + 1] += 1;
  }
  for (let cell = 0; cell < cellCount; cell += 1) cellStart[cell + 1] += cellStart[cell];
  const cursor = cellStart.slice(0, cellCount);
  const cellAtoms = new Int32Array(valid);
  for (let atom = 0; atom < atomCount; atom += 1) {
    const cell = atomCell[atom];
    if (cell < 0) continue;
    cellAtoms[cursor[cell]] = atom;
    cursor[cell] += 1;
  }
  return { minX, minY, minZ, size, dimX, dimY, dimZ, cellStart, cellAtoms, atomCell };
}

function planGrid(bounds, resolution, maxVoxels, padding) {
  let spacing = resolution;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const pad = padding(spacing);
    nx = Math.ceil((bounds.maxX - bounds.minX + 2 * pad) / spacing) + 1;
    ny = Math.ceil((bounds.maxY - bounds.minY + 2 * pad) / spacing) + 1;
    nz = Math.ceil((bounds.maxZ - bounds.minZ + 2 * pad) / spacing) + 1;
    const voxels = nx * ny * nz;
    if (voxels <= maxVoxels) break;
    spacing *= Math.max(1.002, Math.cbrt(voxels / maxVoxels));
  }
  return {
    nx,
    ny,
    nz,
    spacing,
    originX: (bounds.minX + bounds.maxX) / 2 - ((nx - 1) * spacing) / 2,
    originY: (bounds.minY + bounds.maxY) / 2 - ((ny - 1) * spacing) / 2,
    originZ: (bounds.minZ + bounds.maxZ) / 2 - ((nz - 1) * spacing) / 2,
    voxelCount: nx * ny * nz,
  };
}

function splatDistances(field, grid, positions, radii, limit) {
  const { nx, ny, nz, spacing, originX, originY, originZ } = grid;
  const inverse = 1 / spacing;
  const slice = nx * ny;
  for (let atom = 0; atom < radii.length; atom += 1) {
    if (!isUsableAtom(positions, radii, atom)) continue;
    const x = positions[atom * 3];
    const y = positions[atom * 3 + 1];
    const z = positions[atom * 3 + 2];
    const radius = Math.max(0, radii[atom]);
    const reach = radius + limit;
    const reach2 = reach * reach;
    const z0 = Math.max(0, Math.ceil((z - reach - originZ) * inverse));
    const z1 = Math.min(nz - 1, Math.floor((z + reach - originZ) * inverse));
    const y0 = Math.max(0, Math.ceil((y - reach - originY) * inverse));
    const y1 = Math.min(ny - 1, Math.floor((y + reach - originY) * inverse));
    for (let iz = z0; iz <= z1; iz += 1) {
      const dz = originZ + iz * spacing - z;
      const dz2 = dz * dz;
      for (let iy = y0; iy <= y1; iy += 1) {
        const dy = originY + iy * spacing - y;
        const dyz2 = dy * dy + dz2;
        if (dyz2 >= reach2) continue;
        const half = Math.sqrt(reach2 - dyz2);
        const x0 = Math.max(0, Math.ceil((x - half - originX) * inverse));
        const x1 = Math.min(nx - 1, Math.floor((x + half - originX) * inverse));
        const row = nx * iy + slice * iz;
        for (let ix = x0; ix <= x1; ix += 1) {
          const dx = originX + ix * spacing - x;
          const distance2 = dx * dx + dyz2;
          const bound = field[row + ix] + radius;
          if (bound > 0 && distance2 < bound * bound) field[row + ix] = Math.sqrt(distance2) - radius;
        }
      }
    }
  }
}

// Blobby density: each atom contributes exp(k (1 - d^2 / r^2)), so an isolated atom
// crosses the iso level 1 exactly at its vdW radius while close neighbours merge into a
// smooth envelope. The field stores -density so that "inside" is below the iso value -1.
function splatGaussians(field, grid, positions, radii, sharpness, scale) {
  const { nx, ny, nz, spacing, originX, originY, originZ } = grid;
  const inverse = 1 / spacing;
  const slice = nx * ny;
  const peak = Math.exp(sharpness);
  let maxRadius = 0;
  for (let atom = 0; atom < radii.length; atom += 1) {
    if (isUsableAtom(positions, radii, atom)) maxRadius = Math.max(maxRadius, radii[atom]);
  }
  const span = Math.ceil((2 * Math.max(maxRadius, 0.1) * scale) * inverse) + 3;
  const factorX = new Float64Array(span);
  const factorY = new Float64Array(span);
  const factorZ = new Float64Array(span);

  for (let atom = 0; atom < radii.length; atom += 1) {
    if (!isUsableAtom(positions, radii, atom)) continue;
    const x = positions[atom * 3];
    const y = positions[atom * 3 + 1];
    const z = positions[atom * 3 + 2];
    const radius = Math.max(0.1, radii[atom]);
    const falloff = sharpness / (radius * radius);
    const reach = radius * scale;
    const reach2 = reach * reach;
    const x0 = Math.max(0, Math.ceil((x - reach - originX) * inverse));
    const x1 = Math.min(nx - 1, Math.floor((x + reach - originX) * inverse));
    const y0 = Math.max(0, Math.ceil((y - reach - originY) * inverse));
    const y1 = Math.min(ny - 1, Math.floor((y + reach - originY) * inverse));
    const z0 = Math.max(0, Math.ceil((z - reach - originZ) * inverse));
    const z1 = Math.min(nz - 1, Math.floor((z + reach - originZ) * inverse));
    for (let ix = x0; ix <= x1; ix += 1) {
      const dx = originX + ix * spacing - x;
      factorX[ix - x0] = Math.exp(-falloff * dx * dx);
    }
    for (let iy = y0; iy <= y1; iy += 1) {
      const dy = originY + iy * spacing - y;
      factorY[iy - y0] = Math.exp(-falloff * dy * dy);
    }
    for (let iz = z0; iz <= z1; iz += 1) {
      const dz = originZ + iz * spacing - z;
      factorZ[iz - z0] = Math.exp(-falloff * dz * dz) * peak;
    }
    for (let iz = z0; iz <= z1; iz += 1) {
      const dz = originZ + iz * spacing - z;
      const dz2 = dz * dz;
      const weightZ = factorZ[iz - z0];
      for (let iy = y0; iy <= y1; iy += 1) {
        const dy = originY + iy * spacing - y;
        const dyz2 = dy * dy + dz2;
        if (dyz2 >= reach2) continue;
        const weight = weightZ * factorY[iy - y0];
        const half = Math.sqrt(reach2 - dyz2);
        const sx0 = Math.max(x0, Math.ceil((x - half - originX) * inverse));
        const sx1 = Math.min(x1, Math.floor((x + half - originX) * inverse));
        const row = nx * iy + slice * iz;
        for (let ix = sx0; ix <= sx1; ix += 1) {
          field[row + ix] -= weight * factorX[ix - x0];
        }
      }
    }
  }
}

// Solvent-excluded field. Every grid point q outside the solvent-accessible surface
// (g(q) >= probe) is the centre of an atom-free ball of radius g(q) that the probe can
// sweep, so the union of these balls is the probe-accessible region (up to grid sampling).
// x is covered when the power distance P(x) = min_q |x - q|^2 - g(q)^2 is <= 0. P is a
// generalized squared distance transform, computed exactly with the separable
// Felzenszwalb-Huttenlocher lower envelope while carrying the radius R of the minimizing
// ball, so the result g* - |x - q*| = R - sqrt(P + R^2) is a signed distance to that ball:
// positive in solvent, negative inside the SES, with unit slope on both sides.
function solventExcludedField(field, grid, probe) {
  const { nx, ny, nz, spacing } = grid;
  const slice = nx * ny;
  const inverse = 1 / spacing;
  const ballRadius = new Float32Array(field.length);
  const longest = Math.max(nx, ny, nz);
  const scratch = {
    at: new Int32Array(longest),
    value: new Float64Array(longest),
    radius: new Float64Array(longest),
    boundary: new Float64Array(longest + 1),
  };

  for (let row = 0; row < ny * nz; row += 1) {
    const base = row * nx;
    for (let index = base; index < base + nx; index += 1) {
      const distance = field[index];
      if (distance >= probe) {
        const scaled = distance * inverse;
        field[index] = -scaled * scaled;
        ballRadius[index] = scaled;
      } else {
        field[index] = FAR;
      }
    }
    transformLine(field, ballRadius, base, 1, nx, scratch);
  }

  for (let z = 0; z < nz; z += 1) {
    for (let x = 0; x < nx; x += 1) transformLine(field, ballRadius, z * slice + x, nx, ny, scratch);
  }

  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const start = y * nx + x;
      transformLine(field, ballRadius, start, slice, nz, scratch);
      for (let index = start; index < field.length; index += slice) {
        const power = field[index];
        const radius = ballRadius[index];
        field[index] = power >= FAR
          ? -FAR
          : (radius - Math.sqrt(Math.max(0, power + radius * radius))) * spacing;
      }
    }
  }
}

function transformLine(values, radii, start, stride, length, scratch) {
  const { at, value: siteValue, radius: siteRadius, boundary } = scratch;
  const end = start + stride * length;
  const firstValue = values[start];
  const firstRadius = radii[start];
  let uniform = true;
  for (let index = start + stride; index < end; index += stride) {
    if (values[index] !== firstValue || radii[index] !== firstRadius) {
      uniform = false;
      break;
    }
  }
  if (uniform) return;
  let top = -1;
  let q = 0;
  for (let index = start; index < end; index += stride) {
    const value = values[index];
    if (value < FAR) {
      const base = value + q * q;
      let crossing = -Infinity;
      while (top >= 0) {
        const vertex = at[top];
        crossing = (base - (siteValue[top] + vertex * vertex)) / (2 * (q - vertex));
        if (crossing > boundary[top]) break;
        top -= 1;
      }
      top += 1;
      at[top] = q;
      siteValue[top] = value;
      siteRadius[top] = radii[index];
      boundary[top] = top === 0 ? -Infinity : crossing;
    }
    q += 1;
  }
  if (top < 0) return;
  let segment = 0;
  q = 0;
  for (let index = start; index < end; index += stride) {
    while (segment < top && boundary[segment + 1] < q) segment += 1;
    const offset = q - at[segment];
    values[index] = offset * offset + siteValue[segment];
    radii[index] = siteRadius[segment];
    q += 1;
  }
}

// Naive Surface Nets: one vertex per sign-changing cell at the mean of its edge crossings,
// one quad per sign-changing grid edge joining the four cells around it. Quads are wound
// counter-clockwise when viewed from the outside (the side where field >= iso).
function contourSurfaceNets(field, grid, iso) {
  const { nx, ny, nz, spacing, originX, originY, originZ } = grid;
  const slice = nx * ny;
  const cellVertex = new Int32Array(2 * slice);
  let vertexCapacity = 1 << 15;
  let positions = new Float32Array(vertexCapacity * 3);
  let cells = new Int32Array(vertexCapacity);
  let indices = new Uint32Array(vertexCapacity * 6);
  let vertexCount = 0;
  let indexCount = 0;

  function pushQuad(a, b, c, d, forward) {
    if (indexCount + 6 > indices.length) {
      const next = new Uint32Array(indices.length * 2);
      next.set(indices);
      indices = next;
    }
    let first = a;
    let second = b;
    let third = c;
    let fourth = d;
    if (!forward) {
      second = d;
      fourth = b;
    }
    const ax = positions[first * 3] - positions[third * 3];
    const ay = positions[first * 3 + 1] - positions[third * 3 + 1];
    const az = positions[first * 3 + 2] - positions[third * 3 + 2];
    const bx = positions[second * 3] - positions[fourth * 3];
    const by = positions[second * 3 + 1] - positions[fourth * 3 + 1];
    const bz = positions[second * 3 + 2] - positions[fourth * 3 + 2];
    if (ax * ax + ay * ay + az * az <= bx * bx + by * by + bz * bz) {
      indices[indexCount] = first;
      indices[indexCount + 1] = second;
      indices[indexCount + 2] = third;
      indices[indexCount + 3] = first;
      indices[indexCount + 4] = third;
      indices[indexCount + 5] = fourth;
    } else {
      indices[indexCount] = first;
      indices[indexCount + 1] = second;
      indices[indexCount + 2] = fourth;
      indices[indexCount + 3] = second;
      indices[indexCount + 4] = third;
      indices[indexCount + 5] = fourth;
    }
    indexCount += 6;
  }

  for (let z = 0; z < nz - 1; z += 1) {
    const current = (z & 1) * slice;
    const previous = slice - current;
    for (let y = 0; y < ny - 1; y += 1) {
      const row = y * nx + z * slice;
      let v0 = field[row] - iso;
      let v2 = field[row + nx] - iso;
      let v4 = field[row + slice] - iso;
      let v6 = field[row + nx + slice] - iso;
      for (let x = 0; x < nx - 1; x += 1) {
        const index = row + x;
        const v1 = field[index + 1] - iso;
        const v3 = field[index + nx + 1] - iso;
        const v5 = field[index + slice + 1] - iso;
        const v7 = field[index + nx + slice + 1] - iso;
        const in0 = v0 < 0;
        const in1 = v1 < 0;
        const in2 = v2 < 0;
        const in3 = v3 < 0;
        const in4 = v4 < 0;
        const in5 = v5 < 0;
        const in6 = v6 < 0;
        const in7 = v7 < 0;
        if (!(in0 === in1 && in0 === in2 && in0 === in3 && in0 === in4 && in0 === in5 && in0 === in6 && in0 === in7)) {
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let crossings = 0;
          if (in0 !== in1) { sx += v0 / (v0 - v1); crossings += 1; }
          if (in2 !== in3) { sx += v2 / (v2 - v3); sy += 1; crossings += 1; }
          if (in4 !== in5) { sx += v4 / (v4 - v5); sz += 1; crossings += 1; }
          if (in6 !== in7) { sx += v6 / (v6 - v7); sy += 1; sz += 1; crossings += 1; }
          if (in0 !== in2) { sy += v0 / (v0 - v2); crossings += 1; }
          if (in1 !== in3) { sy += v1 / (v1 - v3); sx += 1; crossings += 1; }
          if (in4 !== in6) { sy += v4 / (v4 - v6); sz += 1; crossings += 1; }
          if (in5 !== in7) { sy += v5 / (v5 - v7); sx += 1; sz += 1; crossings += 1; }
          if (in0 !== in4) { sz += v0 / (v0 - v4); crossings += 1; }
          if (in1 !== in5) { sz += v1 / (v1 - v5); sx += 1; crossings += 1; }
          if (in2 !== in6) { sz += v2 / (v2 - v6); sy += 1; crossings += 1; }
          if (in3 !== in7) { sz += v3 / (v3 - v7); sx += 1; sy += 1; crossings += 1; }

          if (vertexCount === vertexCapacity) {
            vertexCapacity *= 2;
            const nextPositions = new Float32Array(vertexCapacity * 3);
            nextPositions.set(positions);
            positions = nextPositions;
            const nextCells = new Int32Array(vertexCapacity);
            nextCells.set(cells);
            cells = nextCells;
          }
          const vertex = vertexCount;
          positions[vertex * 3] = originX + (x + sx / crossings) * spacing;
          positions[vertex * 3 + 1] = originY + (y + sy / crossings) * spacing;
          positions[vertex * 3 + 2] = originZ + (z + sz / crossings) * spacing;
          cells[vertex] = index;
          cellVertex[current + x + y * nx] = vertex;
          vertexCount += 1;

          if (in0 !== in1 && y > 0 && z > 0) {
            pushQuad(
              cellVertex[previous + x + (y - 1) * nx],
              cellVertex[previous + x + y * nx],
              vertex,
              cellVertex[current + x + (y - 1) * nx],
              in0,
            );
          }
          if (in0 !== in2 && x > 0 && z > 0) {
            pushQuad(
              cellVertex[previous + x - 1 + y * nx],
              cellVertex[current + x - 1 + y * nx],
              vertex,
              cellVertex[previous + x + y * nx],
              in0,
            );
          }
          if (in0 !== in4 && x > 0 && y > 0) {
            pushQuad(
              cellVertex[current + x - 1 + (y - 1) * nx],
              cellVertex[current + x + (y - 1) * nx],
              vertex,
              cellVertex[current + x - 1 + y * nx],
              in0,
            );
          }
        }
        v0 = v1;
        v2 = v3;
        v4 = v5;
        v6 = v7;
      }
    }
  }

  return {
    positions: positions.slice(0, vertexCount * 3),
    cells: cells.subarray(0, vertexCount),
    indices: indices.slice(0, indexCount),
    vertexCount,
  };
}

// Pulls each vertex onto the iso-surface with a few Newton steps (kept inside its cell so
// the Surface Nets topology stays valid). Trilinear interpolation of a convex distance
// field overestimates it between grid points, which would shrink spheres by ~h^2/(4r), so
// the interpolated value subtracts the per-axis quadratic term t(1 - t)/2 * f''. In a
// distance field a gradient well below unit length marks a crease between atoms, where a
// Newton step would fold triangles over, so those vertices keep their Surface Nets position.
// Normals come from the trilinearly interpolated central-difference gradient (outward).
function refineVertices(field, grid, iso, positions, cells, vertexCount, minGradient) {
  const { nx, ny, spacing, originX, originY, originZ } = grid;
  const slice = nx * ny;
  const inverse = 1 / spacing;
  const creaseLimit = minGradient * minGradient * spacing * spacing;
  const normals = new Float32Array(vertexCount * 3);
  const values = new Float64Array(8);
  const gradX = new Float64Array(8);
  const gradY = new Float64Array(8);
  const gradZ = new Float64Array(8);
  const curveX = new Float64Array(8);
  const curveY = new Float64Array(8);
  const curveZ = new Float64Array(8);
  const weights = new Float64Array(8);

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const cell = cells[vertex];
    const cellZ = Math.floor(cell / slice);
    const cellY = Math.floor((cell - cellZ * slice) / nx);
    const cellX = cell - cellZ * slice - cellY * nx;
    for (let corner = 0; corner < 8; corner += 1) {
      const index = cell + (corner & 1) + ((corner >> 1) & 1) * nx + (corner >> 2) * slice;
      const center = field[index];
      const left = field[index - 1];
      const right = field[index + 1];
      const down = field[index - nx];
      const up = field[index + nx];
      const back = field[index - slice];
      const front = field[index + slice];
      values[corner] = center - iso;
      gradX[corner] = right - left;
      gradY[corner] = up - down;
      gradZ[corner] = front - back;
      curveX[corner] = right + left - 2 * center;
      curveY[corner] = up + down - 2 * center;
      curveZ[corner] = front + back - 2 * center;
    }
    let tx = (positions[vertex * 3] - originX) * inverse - cellX;
    let ty = (positions[vertex * 3 + 1] - originY) * inverse - cellY;
    let tz = (positions[vertex * 3 + 2] - originZ) * inverse - cellZ;
    let nxValue = 0;
    let nyValue = 0;
    let nzValue = 0;
    for (let step = 0; step <= PROJECTION_STEPS; step += 1) {
      trilinearWeights(weights, tx, ty, tz);
      let value = 0;
      let bendX = 0;
      let bendY = 0;
      let bendZ = 0;
      nxValue = 0;
      nyValue = 0;
      nzValue = 0;
      for (let corner = 0; corner < 8; corner += 1) {
        const weight = weights[corner];
        value += weight * values[corner];
        nxValue += weight * gradX[corner];
        nyValue += weight * gradY[corner];
        nzValue += weight * gradZ[corner];
        bendX += weight * curveX[corner];
        bendY += weight * curveY[corner];
        bendZ += weight * curveZ[corner];
      }
      if (step === PROJECTION_STEPS) break;
      value -= 0.5 * (tx * (1 - tx) * bendX + ty * (1 - ty) * bendY + tz * (1 - tz) * bendZ);
      const length2 = (nxValue * nxValue + nyValue * nyValue + nzValue * nzValue) * 0.25;
      if (!(length2 > 1e-12) || length2 < creaseLimit) break;
      const move = (value * 0.5) / length2;
      tx = clamp01(tx - move * nxValue);
      ty = clamp01(ty - move * nyValue);
      tz = clamp01(tz - move * nzValue);
    }
    positions[vertex * 3] = originX + (cellX + tx) * spacing;
    positions[vertex * 3 + 1] = originY + (cellY + ty) * spacing;
    positions[vertex * 3 + 2] = originZ + (cellZ + tz) * spacing;
    const length = Math.hypot(nxValue, nyValue, nzValue);
    if (length > 1e-12) {
      normals[vertex * 3] = nxValue / length;
      normals[vertex * 3 + 1] = nyValue / length;
      normals[vertex * 3 + 2] = nzValue / length;
    }
  }
  return normals;
}

function trilinearWeights(weights, tx, ty, tz) {
  const sx = 1 - tx;
  const sy = 1 - ty;
  const sz = 1 - tz;
  weights[0] = sx * sy * sz;
  weights[1] = tx * sy * sz;
  weights[2] = sx * ty * sz;
  weights[3] = tx * ty * sz;
  weights[4] = sx * sy * tz;
  weights[5] = tx * sy * tz;
  weights[6] = sx * ty * tz;
  weights[7] = tx * ty * tz;
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// Each atom scores the vertices within radius + reach through a vertex grid, so the work
// follows the real neighbourhoods; vertices that no atom reached fall back to an expanding
// search over an atom grid.
function nearestAtoms(vertexPositions, vertexCount, positions, radii, maxRadius, reach) {
  const atoms = new Uint32Array(vertexCount);
  if (vertexCount === 0) return atoms;
  const grid = buildAtomGrid(vertexPositions, vertexCount, Math.max(1, (maxRadius + reach) / 2));
  const { minX, minY, minZ, size, dimX, dimY, dimZ, cellStart, cellAtoms: cellVertices } = grid;
  const inverse = 1 / size;
  const packed = new Float32Array(cellVertices.length * 3);
  for (let slot = 0; slot < cellVertices.length; slot += 1) {
    const vertex = cellVertices[slot];
    packed[slot * 3] = vertexPositions[vertex * 3];
    packed[slot * 3 + 1] = vertexPositions[vertex * 3 + 1];
    packed[slot * 3 + 2] = vertexPositions[vertex * 3 + 2];
  }
  const best = new Float32Array(cellVertices.length).fill(Infinity);
  const owner = new Uint32Array(cellVertices.length);

  for (let atom = 0; atom < radii.length; atom += 1) {
    if (!isUsableAtom(positions, radii, atom)) continue;
    const x = positions[atom * 3];
    const y = positions[atom * 3 + 1];
    const z = positions[atom * 3 + 2];
    const radius = radii[atom];
    const limit = Math.max(0, radius) + reach;
    const limit2 = limit * limit;
    const x0 = Math.max(0, Math.floor((x - limit - minX) * inverse));
    const x1 = Math.min(dimX - 1, Math.floor((x + limit - minX) * inverse));
    const y0 = Math.max(0, Math.floor((y - limit - minY) * inverse));
    const y1 = Math.min(dimY - 1, Math.floor((y + limit - minY) * inverse));
    const z0 = Math.max(0, Math.floor((z - limit - minZ) * inverse));
    const z1 = Math.min(dimZ - 1, Math.floor((z + limit - minZ) * inverse));
    for (let iz = z0; iz <= z1; iz += 1) {
      const gapZ = boxGap(z, minZ + iz * size, size);
      for (let iy = y0; iy <= y1; iy += 1) {
        const gapY = boxGap(y, minY + iy * size, size);
        const gapYZ = gapY * gapY + gapZ * gapZ;
        if (gapYZ >= limit2) continue;
        const row = dimX * (iy + dimY * iz);
        for (let ix = x0; ix <= x1; ix += 1) {
          const gapX = boxGap(x, minX + ix * size, size);
          if (gapX * gapX + gapYZ >= limit2) continue;
          const cell = row + ix;
          const end = cellStart[cell + 1];
          for (let slot = cellStart[cell]; slot < end; slot += 1) {
            const dx = packed[slot * 3] - x;
            const dy = packed[slot * 3 + 1] - y;
            const dz = packed[slot * 3 + 2] - z;
            const distance2 = dx * dx + dy * dy + dz * dz;
            if (distance2 >= limit2) continue;
            const bound = best[slot] + radius;
            if (bound > 0 && distance2 < bound * bound) {
              best[slot] = Math.sqrt(distance2) - radius;
              owner[slot] = atom;
            }
          }
        }
      }
    }
  }

  let atomGrid = null;
  for (let slot = 0; slot < cellVertices.length; slot += 1) {
    const vertex = cellVertices[slot];
    if (best[slot] !== Infinity) {
      atoms[vertex] = owner[slot];
      continue;
    }
    atomGrid ??= buildAtomGrid(positions, radii.length, maxRadius + reach);
    atoms[vertex] = searchNearestAtom(
      atomGrid,
      positions,
      radii,
      maxRadius,
      vertexPositions[vertex * 3],
      vertexPositions[vertex * 3 + 1],
      vertexPositions[vertex * 3 + 2],
    );
  }
  return atoms;
}

function boxGap(value, low, size) {
  if (value < low) return low - value;
  if (value > low + size) return value - low - size;
  return 0;
}

function searchNearestAtom(grid, positions, radii, maxRadius, x, y, z) {
  const { minX, minY, minZ, size, dimX, dimY, dimZ, cellStart, cellAtoms } = grid;
  const cellX = Math.min(dimX - 1, Math.max(0, Math.floor((x - minX) / size)));
  const cellY = Math.min(dimY - 1, Math.max(0, Math.floor((y - minY) / size)));
  const cellZ = Math.min(dimZ - 1, Math.max(0, Math.floor((z - minZ) / size)));
  const maxRing = Math.max(dimX, dimY, dimZ);
  let best = Infinity;
  let bestAtom = 0;
  for (let ring = 1; ring <= maxRing; ring += 1) {
    const x0 = Math.max(0, cellX - ring);
    const x1 = Math.min(dimX - 1, cellX + ring);
    const y0 = Math.max(0, cellY - ring);
    const y1 = Math.min(dimY - 1, cellY + ring);
    const z0 = Math.max(0, cellZ - ring);
    const z1 = Math.min(dimZ - 1, cellZ + ring);
    for (let iz = z0; iz <= z1; iz += 1) {
      const shellZ = iz === cellZ - ring || iz === cellZ + ring;
      for (let iy = y0; iy <= y1; iy += 1) {
        const shellY = shellZ || iy === cellY - ring || iy === cellY + ring;
        for (let ix = x0; ix <= x1; ix += 1) {
          if (ring > 1 && !shellY && ix !== cellX - ring && ix !== cellX + ring) continue;
          const cell = ix + dimX * (iy + dimY * iz);
          for (let slot = cellStart[cell]; slot < cellStart[cell + 1]; slot += 1) {
            const atom = cellAtoms[slot];
            if (!Number.isFinite(radii[atom])) continue;
            const dx = positions[atom * 3] - x;
            const dy = positions[atom * 3 + 1] - y;
            const dz = positions[atom * 3 + 2] - z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) - radii[atom];
            if (distance < best) {
              best = distance;
              bestAtom = atom;
            }
          }
        }
      }
    }
    const covered = x0 === 0 && y0 === 0 && z0 === 0 && x1 === dimX - 1 && y1 === dimY - 1 && z1 === dimZ - 1;
    if (covered || best <= ring * size - maxRadius) break;
  }
  return bestAtom;
}

function repairNormals(normals, vertexPositions, vertexCount, atoms, positions) {
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    if (normals[vertex * 3] !== 0 || normals[vertex * 3 + 1] !== 0 || normals[vertex * 3 + 2] !== 0) continue;
    const atom = atoms[vertex];
    const dx = vertexPositions[vertex * 3] - positions[atom * 3];
    const dy = vertexPositions[vertex * 3 + 1] - positions[atom * 3 + 1];
    const dz = vertexPositions[vertex * 3 + 2] - positions[atom * 3 + 2];
    const length = Math.hypot(dx, dy, dz);
    if (length > 0) {
      normals[vertex * 3] = dx / length;
      normals[vertex * 3 + 1] = dy / length;
      normals[vertex * 3 + 2] = dz / length;
    } else {
      normals[vertex * 3 + 2] = 1;
    }
  }
}

function emptySurface(spacing, timings) {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
    atoms: new Uint32Array(0),
    spacing,
    voxelCount: 0,
    timings,
  };
}
