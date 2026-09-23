// Rigid-body superposition and structure-comparison scores.
// Points are flat arrays [x0, y0, z0, x1, …]; a transform is { rotation: row-major 3 × 3,
// translation: [x, y, z] } and maps a moving point p to R·p + t.

export const IDENTITY_TRANSFORM = Object.freeze({ rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] });

// Least-squares fit of `mobile` onto `reference` (Horn 1987, unit quaternions). The quaternion
// form always yields a proper rotation, so mirror-image point sets are never "fitted" by a
// reflection. Returns the transform and the RMSD after fitting.
export function fitPoints(mobile, reference, weights = null) {
  const count = Math.min(mobile.length, reference.length) / 3;
  if (count < 1) return { ...cloneTransform(IDENTITY_TRANSFORM), rmsd: NaN };
  let total = 0;
  const cm = [0, 0, 0];
  const cr = [0, 0, 0];
  for (let index = 0; index < count; index += 1) {
    const w = weights ? weights[index] : 1;
    total += w;
    for (let axis = 0; axis < 3; axis += 1) {
      cm[axis] += w * mobile[index * 3 + axis];
      cr[axis] += w * reference[index * 3 + axis];
    }
  }
  if (total <= 0) return { ...cloneTransform(IDENTITY_TRANSFORM), rmsd: NaN };
  for (let axis = 0; axis < 3; axis += 1) {
    cm[axis] /= total;
    cr[axis] /= total;
  }

  // S[a][b] = Σ w · m'_a · r'_b, plus the squared norms for the RMSD.
  const S = new Float64Array(9);
  let normSum = 0;
  for (let index = 0; index < count; index += 1) {
    const w = weights ? weights[index] : 1;
    const mx = mobile[index * 3] - cm[0];
    const my = mobile[index * 3 + 1] - cm[1];
    const mz = mobile[index * 3 + 2] - cm[2];
    const rx = reference[index * 3] - cr[0];
    const ry = reference[index * 3 + 1] - cr[1];
    const rz = reference[index * 3 + 2] - cr[2];
    S[0] += w * mx * rx;
    S[1] += w * mx * ry;
    S[2] += w * mx * rz;
    S[3] += w * my * rx;
    S[4] += w * my * ry;
    S[5] += w * my * rz;
    S[6] += w * mz * rx;
    S[7] += w * mz * ry;
    S[8] += w * mz * rz;
    normSum += w * (mx * mx + my * my + mz * mz + rx * rx + ry * ry + rz * rz);
  }
  const [sxx, sxy, sxz, syx, syy, syz, szx, szy, szz] = S;
  const N = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  const { values, vectors } = symmetricEigen(N);
  let bestIndex = 0;
  for (let index = 1; index < 4; index += 1) if (values[index] > values[bestIndex]) bestIndex = index;
  const q = [vectors[0][bestIndex], vectors[1][bestIndex], vectors[2][bestIndex], vectors[3][bestIndex]];
  const length = Math.hypot(...q) || 1;
  const [q0, q1, q2, q3] = q.map((value) => value / length);
  const rotation = [
    q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3, 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2),
    2 * (q2 * q1 + q0 * q3), q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3, 2 * (q2 * q3 - q0 * q1),
    2 * (q3 * q1 - q0 * q2), 2 * (q3 * q2 + q0 * q1), q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3,
  ];
  const translation = [
    cr[0] - (rotation[0] * cm[0] + rotation[1] * cm[1] + rotation[2] * cm[2]),
    cr[1] - (rotation[3] * cm[0] + rotation[4] * cm[1] + rotation[5] * cm[2]),
    cr[2] - (rotation[6] * cm[0] + rotation[7] * cm[1] + rotation[8] * cm[2]),
  ];
  const rmsd = Math.sqrt(Math.max(0, (normSum - 2 * values[bestIndex]) / total));
  return { rotation, translation, rmsd };
}

// Fits, then repeatedly drops the worst pairs until none are farther apart than `cutoff`,
// following ChimeraX matchmaker: each cycle removes the lesser of 10% of all remaining pairs and
// half of the pairs beyond the cutoff (at least one), so a flexible loop cannot drag the fit.
export function iterativeFit(mobile, reference, options = {}) {
  const cutoff = options.cutoff ?? 2;
  const maxCycles = options.maxCycles ?? 100;
  const count = Math.min(mobile.length, reference.length) / 3;
  let active = Array.from({ length: count }, (_, index) => index);
  let fit = fitSubset(mobile, reference, active);
  let cycles = 0;
  if (Number.isFinite(cutoff) && cutoff > 0) {
    while (cycles < maxCycles && active.length > 3) {
      const distances = active.map((index) => ({ index, distance: pairDistance(mobile, reference, index, fit) }));
      const beyond = distances.filter((item) => item.distance > cutoff);
      if (!beyond.length) break;
      const remove = Math.max(1, Math.min(Math.floor(active.length * 0.1), Math.floor(beyond.length * 0.5)));
      if (active.length - remove < 3) break;
      distances.sort((a, b) => b.distance - a.distance);
      const dropped = new Set(distances.slice(0, remove).map((item) => item.index));
      active = active.filter((index) => !dropped.has(index));
      fit = fitSubset(mobile, reference, active);
      cycles += 1;
    }
  }
  const kept = new Uint8Array(count);
  for (const index of active) kept[index] = 1;
  const distances = new Float64Array(count);
  let sumAll = 0;
  for (let index = 0; index < count; index += 1) {
    distances[index] = pairDistance(mobile, reference, index, fit);
    sumAll += distances[index] ** 2;
  }
  return {
    rotation: fit.rotation,
    translation: fit.translation,
    rmsd: fit.rmsd,
    kept,
    keptCount: active.length,
    distances,
    rmsdAll: count ? Math.sqrt(sumAll / count) : NaN,
    cycles,
  };
}

function fitSubset(mobile, reference, indices) {
  const m = new Float64Array(indices.length * 3);
  const r = new Float64Array(indices.length * 3);
  indices.forEach((source, target) => {
    for (let axis = 0; axis < 3; axis += 1) {
      m[target * 3 + axis] = mobile[source * 3 + axis];
      r[target * 3 + axis] = reference[source * 3 + axis];
    }
  });
  return fitPoints(m, r);
}

function pairDistance(mobile, reference, index, transform) {
  const p = transformPoint(transform, mobile[index * 3], mobile[index * 3 + 1], mobile[index * 3 + 2]);
  return Math.hypot(p[0] - reference[index * 3], p[1] - reference[index * 3 + 1], p[2] - reference[index * 3 + 2]);
}

// TM-score normalization distance (Zhang & Skolnick 2004).
export function tmD0(length) {
  return length > 21 ? 1.24 * Math.cbrt(length - 15) - 1.8 : 0.5;
}

// TM-score of a fixed residue correspondence, maximized over superpositions with the heuristic
// search of the TM-score program: seed fits on fragments of decreasing length, then refit
// repeatedly on the pairs closer than d0_search. `lengthNorm` is the reference length.
export function tmScore(mobile, reference, options = {}) {
  const count = Math.min(mobile.length, reference.length) / 3;
  const lengthNorm = options.lengthNorm ?? count;
  if (count < 3 || lengthNorm < 1) return { tmScore: 0, transform: cloneTransform(IDENTITY_TRANSFORM), d0: tmD0(lengthNorm) };
  const d0 = options.d0 ?? tmD0(lengthNorm);
  const d0Search = Math.min(8, Math.max(4.5, d0));
  const scoreOf = (transform) => {
    let sum = 0;
    for (let index = 0; index < count; index += 1) {
      const d = pairDistance(mobile, reference, index, transform);
      sum += 1 / (1 + (d / d0) ** 2);
    }
    return sum / lengthNorm;
  };
  let best = { tmScore: -1, transform: null };
  const lengths = [];
  const minimum = Math.min(4, count);
  for (let length = count; length >= minimum && lengths.length < 6; length = Math.floor(length / 2)) lengths.push(length);
  const seen = new Set();
  for (const length of lengths) {
    const starts = count - length;
    const step = Math.max(1, Math.floor(starts / (options.seedsPerLength ?? 40)));
    for (let start = 0; start <= starts; start += step) {
      let subset = Array.from({ length }, (_, offset) => start + offset);
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const signature = subset.join(',');
        if (seen.has(signature)) break;
        seen.add(signature);
        const transform = fitSubset(mobile, reference, subset);
        const score = scoreOf(transform);
        if (score > best.tmScore) best = { tmScore: score, transform: { rotation: transform.rotation, translation: transform.translation } };
        let threshold = d0Search;
        let next = [];
        while (next.length < 3 && threshold < 100) {
          next = [];
          for (let index = 0; index < count; index += 1) {
            if (pairDistance(mobile, reference, index, transform) < threshold) next.push(index);
          }
          threshold += 0.5;
        }
        if (next.length < 3 || next.join(',') === signature) break;
        subset = next;
      }
    }
  }
  return { tmScore: Math.max(0, best.tmScore), transform: best.transform ?? cloneTransform(IDENTITY_TRANSFORM), d0 };
}

// Superposition-free local distance difference test (Mariani et al. 2013) over corresponding
// points: for every reference pair closer than `radius`, the fraction of the thresholds
// (0.5, 1, 2, 4 Å) within which the moving structure preserves that distance.
// Returns per-point scores (NaN where a point has no neighbors) and the global score.
export function lddt(reference, mobile, options = {}) {
  const radius = options.radius ?? 15;
  const thresholds = options.thresholds ?? [0.5, 1, 2, 4];
  const count = Math.min(mobile.length, reference.length) / 3;
  const perPoint = new Float64Array(count).fill(NaN);
  const cell = radius;
  const grid = new Map();
  const keyOf = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let index = 0; index < count; index += 1) {
    const key = keyOf(reference[index * 3], reference[index * 3 + 1], reference[index * 3 + 2]);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(index);
  }
  const radius2 = radius * radius;
  let preservedTotal = 0;
  let pairsTotal = 0;
  for (let index = 0; index < count; index += 1) {
    const x = reference[index * 3];
    const y = reference[index * 3 + 1];
    const z = reference[index * 3 + 2];
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const gz = Math.floor(z / cell);
    let preserved = 0;
    let pairs = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === index) continue;
            const rx = reference[other * 3] - x;
            const ry = reference[other * 3 + 1] - y;
            const rz = reference[other * 3 + 2] - z;
            const d2 = rx * rx + ry * ry + rz * rz;
            if (d2 >= radius2) continue;
            const dRef = Math.sqrt(d2);
            const dMob = Math.hypot(
              mobile[other * 3] - mobile[index * 3],
              mobile[other * 3 + 1] - mobile[index * 3 + 1],
              mobile[other * 3 + 2] - mobile[index * 3 + 2],
            );
            const delta = Math.abs(dRef - dMob);
            for (const threshold of thresholds) if (delta < threshold) preserved += 1;
            pairs += 1;
          }
        }
      }
    }
    if (pairs) perPoint[index] = preserved / (pairs * thresholds.length);
    preservedTotal += preserved;
    pairsTotal += pairs;
  }
  return { perPoint, global: pairsTotal ? preservedTotal / (pairsTotal * thresholds.length) : NaN };
}

// Root-mean-square fluctuation of each point across already superposed frames.
export function rmsf(frames) {
  if (!frames.length) return new Float64Array(0);
  const count = frames[0].length / 3;
  const mean = new Float64Array(count * 3);
  for (const frame of frames) for (let index = 0; index < count * 3; index += 1) mean[index] += frame[index] / frames.length;
  const result = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    let sum = 0;
    for (const frame of frames) {
      const dx = frame[index * 3] - mean[index * 3];
      const dy = frame[index * 3 + 1] - mean[index * 3 + 1];
      const dz = frame[index * 3 + 2] - mean[index * 3 + 2];
      sum += dx * dx + dy * dy + dz * dz;
    }
    result[index] = Math.sqrt(sum / frames.length);
  }
  return result;
}

export function transformPoint(transform, x, y, z) {
  const r = transform.rotation;
  const t = transform.translation;
  return [
    r[0] * x + r[1] * y + r[2] * z + t[0],
    r[3] * x + r[4] * y + r[5] * z + t[1],
    r[6] * x + r[7] * y + r[8] * z + t[2],
  ];
}

export function transformDirection(transform, x, y, z) {
  const r = transform.rotation;
  return [r[0] * x + r[1] * y + r[2] * z, r[3] * x + r[4] * y + r[5] * z, r[6] * x + r[7] * y + r[8] * z];
}

export function transformPoints(transform, points) {
  const result = new Float64Array(points.length);
  for (let index = 0; index < points.length; index += 3) {
    const p = transformPoint(transform, points[index], points[index + 1], points[index + 2]);
    result[index] = p[0];
    result[index + 1] = p[1];
    result[index + 2] = p[2];
  }
  return result;
}

// Returns the transform equivalent to applying `first`, then `second`.
export function composeTransforms(second, first) {
  const a = second.rotation;
  const b = first.rotation;
  const rotation = new Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      rotation[row * 3 + column] = a[row * 3] * b[column] + a[row * 3 + 1] * b[3 + column] + a[row * 3 + 2] * b[6 + column];
    }
  }
  const moved = transformPoint(second, ...first.translation);
  return { rotation, translation: moved };
}

export function invertTransform(transform) {
  const r = transform.rotation;
  const rotation = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
  const t = transform.translation;
  const translation = [
    -(rotation[0] * t[0] + rotation[1] * t[1] + rotation[2] * t[2]),
    -(rotation[3] * t[0] + rotation[4] * t[1] + rotation[5] * t[2]),
    -(rotation[6] * t[0] + rotation[7] * t[1] + rotation[8] * t[2]),
  ];
  return { rotation, translation };
}

export function isIdentityTransform(transform, tolerance = 1e-9) {
  if (!transform) return true;
  const expected = IDENTITY_TRANSFORM.rotation;
  return transform.rotation.every((value, index) => Math.abs(value - expected[index]) < tolerance)
    && transform.translation.every((value) => Math.abs(value) < tolerance);
}

export function cloneTransform(transform) {
  return { rotation: [...transform.rotation], translation: [...transform.translation] };
}

// Cyclic Jacobi eigen-decomposition of a small symmetric matrix (array of rows).
// Returns eigenvalues and a column-eigenvector matrix.
export function symmetricEigen(matrix) {
  const n = matrix.length;
  const a = matrix.map((row) => Float64Array.from(row));
  const v = Array.from({ length: n }, (_, row) => Float64Array.from({ length: n }, (_, column) => (row === column ? 1 : 0)));
  for (let sweep = 0; sweep < 64; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += a[p][q] * a[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: Array.from({ length: n }, (_, index) => a[index][index]), vectors: v.map((row) => Array.from(row)) };
}
