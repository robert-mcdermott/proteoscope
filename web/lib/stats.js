// Differential abundance of peptides, precursors and PTM sites: log2 intensities, median
// normalization, down-shifted imputation, moderated t-tests, Benjamini–Hochberg q-values and the
// protein-level adjustment of PTM changes; also the Student t distribution (used by HDX-MS too).
//
// A matrix is { values: Float64Array (rows × columns, row-major; NaN = missing), rows, columns }.
// Rows are features (peptides, precursors or sites), columns are samples, and values are log2
// intensities unless stated.
//
// Moderated t-tests follow limma (Smyth 2004, Stat Appl Genet Mol Biol, doi:10.2202/1544-6115.1027;
// Ritchie et al. 2015, Nucleic Acids Res, doi:10.1093/nar/gkv007) and reproduce lmFit, then eBayes
// with its defaults (robust = FALSE, trend = FALSE), of limma 3.68. Each feature is fitted on its
// non-missing values (two groups, contrast B − A), and the residual variances of the tested
// features are shrunk towards a scaled inverse-χ² prior with d0 degrees of freedom and scale s0².
// As in limma ≥ 3.62, the prior comes from the moments of the log variances (Smyth 2004) when all
// residual df are equal, and otherwise from limma's profile likelihood (fitFDistUnequalDF1): the
// scaled F likelihood maximized over d0, with s0² tied to the df-weighted mean of the log
// variances. Zero variances are moved off zero for estimating the prior only, and d0 = ∞ (no
// spread beyond sampling error) gives every feature the posterior variance s0². Phipson et al.
// 2016 (Ann Appl Stat, doi:10.1214/16-AOAS920) describe the robust variant, not implemented here.
//
// PTM changes are adjusted for protein abundance as in MSstatsPTM (Kohler et al. 2023, Mol Cell
// Proteomics, doi:10.1016/j.mcpro.2022.100477). Missing values can be imputed per sample from a
// narrowed, down-shifted normal distribution as in Perseus (Tyanova et al. 2016, Nat Methods,
// doi:10.1038/nmeth.3901).

/* ---------- Matrices ---------- */

// Raw intensities (any array-like, row-major) → log2 matrix; zero, negative and non-numeric
// values become missing.
export function log2Matrix(values, rows, columns) {
  if (values.length !== rows * columns) throw new RangeError(`Expected ${rows * columns} values, got ${values.length}`);
  const result = new Float64Array(rows * columns);
  for (let index = 0; index < result.length; index += 1) {
    const value = Number(values[index]);
    result[index] = value > 0 && value < Infinity ? Math.log2(value) : NaN;
  }
  return { values: result, rows, columns };
}

// Equal column medians: each column is shifted by the mean of the column medians minus its own
// median (over its non-missing values). offsets[column] is the amount added to that column.
export function normalizeMedians(matrix) {
  const { rows, columns } = matrix;
  const medians = new Float64Array(columns);
  const buffer = new Float64Array(rows);
  for (let column = 0; column < columns; column += 1) {
    let count = 0;
    for (let row = 0; row < rows; row += 1) {
      const value = matrix.values[row * columns + column];
      if (Number.isFinite(value)) {
        buffer[count] = value;
        count += 1;
      }
    }
    medians[column] = median(buffer.subarray(0, count));
  }
  let sum = 0;
  let used = 0;
  for (const value of medians) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    used += 1;
  }
  const offsets = medians.map((value) => (Number.isFinite(value) ? sum / used - value : 0));
  const values = new Float64Array(rows * columns);
  for (let index = 0; index < values.length; index += 1) {
    const value = matrix.values[index];
    values[index] = Number.isFinite(value) ? value + offsets[index % columns] : NaN;
  }
  return { matrix: { values, rows, columns }, offsets };
}

// Perseus-style imputation: the missing values of a column are drawn from a normal distribution
// `shift` standard deviations below the mean of the column's valid values, with `width` times
// their (sample) standard deviation. Draws run column by column from a seeded generator, so a seed
// always gives the same matrix. Columns with fewer than two valid values stay as they are.
export function imputeDownshifted(matrix, options = {}) {
  const width = options.width ?? 0.3;
  const shift = options.shift ?? 1.8;
  const nextNormal = normalDeviates(options.seed ?? 1);
  const { rows, columns } = matrix;
  const values = new Float64Array(rows * columns);
  for (let index = 0; index < values.length; index += 1) values[index] = matrix.values[index] ?? NaN;
  const imputed = new Uint8Array(values.length);
  for (let column = 0; column < columns; column += 1) {
    let count = 0;
    let sum = 0;
    for (let row = 0; row < rows; row += 1) {
      const value = values[row * columns + column];
      if (!Number.isFinite(value)) continue;
      count += 1;
      sum += value;
    }
    if (count < 2) continue;
    const mean = sum / count;
    let squares = 0;
    for (let row = 0; row < rows; row += 1) {
      const value = values[row * columns + column];
      if (Number.isFinite(value)) squares += (value - mean) ** 2;
    }
    const sd = Math.sqrt(squares / (count - 1));
    for (let row = 0; row < rows; row += 1) {
      const index = row * columns + column;
      if (Number.isFinite(values[index])) continue;
      values[index] = mean - shift * sd + width * sd * nextNormal();
      imputed[index] = 1;
    }
  }
  return { matrix: { values, rows, columns }, imputed };
}

function median(values) {
  const count = values.length;
  if (!count) return NaN;
  const sorted = Float64Array.from(values).sort();
  const middle = count >> 1;
  return count % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Standard normal deviates: a mulberry32 uniform generator and the Box–Muller transform.
function normalDeviates(seed) {
  let state = Math.floor(Number(seed) || 0) >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = Math.imul(state ^ (state >>> 15), state | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    const radius = Math.sqrt(-2 * Math.log(1 - uniform()));
    const angle = 2 * Math.PI * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

/* ---------- Moderated t-test ---------- */

// Two-group moderated t-test per feature, contrast B − A (logFC > 0: higher in B). A feature is
// tested when both groups have at least options.minValid (default 2) non-missing values; it is
// fitted on those values only, as lmFit does with NAs, and the prior comes from the tested
// features. Per tested row: logFC, aveExpr (mean of its values in both groups), t, p, df (total
// df of t), se (moderated SE of logFC), s2 and s2Post (residual and posterior variance), nA, nB.
// prior.method is 'moments', 'likelihood' or 'none' (under three features: plain t-tests).
// options.legacy picks the prior estimator as limma's `legacy` does: null (default) uses moments
// when all residual df are equal and the likelihood otherwise; true or false forces one.
// options.prior ({ d0, s02, pooled }) applies a prior estimated elsewhere (for example from a
// whole experiment) to a few features, with `pooled` capping the total df as limma does.
export function moderatedTTest(matrix, groupA, groupB, options = {}) {
  const { values, rows, columns } = matrix;
  const a = columnList(groupA, columns, 'groupA');
  const b = columnList(groupB, columns, 'groupB');
  if (a.some((column) => b.includes(column))) throw new RangeError('groupA and groupB share columns');
  const minValid = Math.max(1, Math.floor(options.minValid ?? 2));
  const fits = [];
  for (let row = 0; row < rows; row += 1) {
    const offset = row * columns;
    const first = groupSummary(values, offset, a);
    const second = groupSummary(values, offset, b);
    if (first.count < minValid || second.count < minValid) continue;
    const df = first.count + second.count - 2;
    fits.push({
      row,
      logFC: second.mean - first.mean,
      aveExpr: (first.sum + second.sum) / (first.count + second.count),
      s2: df > 0 ? (first.squares + second.squares) / df : NaN,
      df,
      unscaled: Math.sqrt(1 / first.count + 1 / second.count),
      nA: first.count,
      nB: second.count,
    });
  }
  const prior = options.prior
    ? { ...estimatePrior([], [], null), ...options.prior }
    : estimatePrior(fits.map((fit) => fit.s2), fits.map((fit) => fit.df), options.legacy ?? null);
  const pooled = options.prior?.pooled ?? fits.reduce((sum, fit) => sum + fit.df, 0);
  const results = new Array(rows).fill(null);
  const p = new Float64Array(rows).fill(NaN);
  for (const fit of fits) {
    const s2Post = posteriorVariance(fit.s2, fit.df, prior);
    const se = fit.unscaled * Math.sqrt(s2Post);
    const t = fit.logFC / se;
    const df = Math.min(fit.df + prior.d0, pooled);
    p[fit.row] = 2 * tTail(Math.abs(t), df);
    results[fit.row] = { logFC: fit.logFC, aveExpr: fit.aveExpr, t, p: p[fit.row], df, se, s2: fit.s2, s2Post, nA: fit.nA, nB: fit.nB };
  }
  return { results, q: adjustBH(p), prior: { ...prior, pooled }, tested: fits.length };
}

function columnList(group, columns, name) {
  const list = [...(group ?? [])];
  if (!list.length) throw new RangeError(`${name} has no columns`);
  for (const column of list) {
    if (!Number.isInteger(column) || column < 0 || column >= columns) throw new RangeError(`${name}: ${column} is not a column index`);
  }
  if (new Set(list).size !== list.length) throw new RangeError(`${name} repeats a column`);
  return list;
}

// Count, sum, mean and squared deviations of one feature's non-missing values in some columns.
// Deviations are taken from the first value, so identical values give a variance of exactly 0.
function groupSummary(values, offset, group) {
  let count = 0;
  let first = NaN;
  let shifted = 0;
  for (const column of group) {
    const value = values[offset + column];
    if (!Number.isFinite(value)) continue;
    if (!count) first = value;
    count += 1;
    shifted += value - first;
  }
  const deviation = shifted / count;
  let squares = 0;
  for (const column of group) {
    const value = values[offset + column];
    if (Number.isFinite(value)) squares += (value - first - deviation) ** 2;
  }
  return { count, sum: first * count + shifted, mean: first + deviation, squares };
}

// Posterior variance given the prior; residual df of 0 carry no variance (limma sets it to 0).
function posteriorVariance(variance, df, { d0, s02 }) {
  if (d0 === Infinity) return s02;
  if (d0 === 0) return variance;
  return ((df > 0 ? df * variance : 0) + d0 * s02) / (df + d0);
}

// Prior df and scale for the residual variances (limma squeezeVar). limma skips empirical Bayes
// below three features and stops when the prior cannot be estimated; both leave the plain
// t-statistics here (d0 = 0).
function estimatePrior(variances, dfs, legacy) {
  const none = { d0: 0, s02: NaN, method: 'none' };
  if (variances.length < 3) return none;
  let moments = legacy;
  if (moments === null) {
    let low = Infinity;
    let high = -Infinity;
    for (const df of dfs) {
      if (!(df > 0)) continue;
      low = Math.min(low, df);
      high = Math.max(high, df);
    }
    moments = low === high;
  }
  const prior = moments ? momentPrior(variances, dfs) : likelihoodPrior(variances, dfs);
  return Number.isNaN(prior.d0) ? none : prior;
}

// Smyth (2004) moment estimator: log variances, corrected for their df, have mean
// log s0² + log(d0 / 2) − ψ(d0 / 2) and variance ψ'(d / 2) + ψ'(d0 / 2).
function momentPrior(variances, dfs) {
  const x = [];
  const halves = [];
  variances.forEach((variance, index) => {
    if (!(dfs[index] > 0) || !Number.isFinite(variance)) return;
    x.push(Math.max(variance, 0));
    halves.push(dfs[index] / 2);
  });
  const count = x.length;
  if (count === 0) return { d0: NaN, s02: NaN };
  if (count === 1) return { d0: 0, s02: x[0], method: 'moments' };
  // More than half of the variances at zero: limma warns and floors at 1e-5 instead.
  const floor = 1e-5 * (median(x) || 1);
  const logMinus = memoize(logMinusDigamma);
  const tri = memoize(trigamma);
  const e = new Float64Array(count);
  let sum = 0;
  let expected = 0;
  let pooled = 0;
  for (let index = 0; index < count; index += 1) {
    x[index] = Math.max(x[index], floor);
    e[index] = Math.log(x[index]) + logMinus(halves[index]);
    sum += e[index];
    expected += tri(halves[index]);
    pooled += x[index];
  }
  const mean = sum / count;
  let squares = 0;
  for (const value of e) squares += (value - mean) ** 2;
  const excess = squares / (count - 1) - expected / count;
  if (!(excess > 0)) return { d0: Infinity, s02: pooled / count, method: 'moments' };
  const d0 = 2 * trigammaInverse(excess);
  return { d0, s02: Math.exp(mean - logMinusDigamma(d0 / 2)), method: 'moments' };
}

// Profile likelihood of limma's fitFDistUnequalDF1 (robust = FALSE): the variances follow s0² times
// an F(d, d0) distribution; for each d0, s0² makes the 1 / ψ'(d / 2)-weighted mean of the corrected
// log variances match its expectation, and d0 maximizes the likelihood. limma searches d0 / 2 =
// u / (1 − u) for u in [0.5, 0.9998] (d0 from 2 to 9998) with stats::optimize; the same search
// and tolerance here keep d0 identical.
function likelihoodPrior(variances, dfs) {
  const x = [];
  const halves = [];
  variances.forEach((variance, index) => {
    if (!(dfs[index] >= 0.01) || !Number.isFinite(variance)) return;
    x.push(Math.max(variance, 0));
    halves.push(dfs[index] / 2);
  });
  const positive = x.filter((value) => value > 0);
  if (positive.length < 2) return { d0: NaN, s02: NaN };
  // Zero variances are floored at 1e-12 × the median of the positive ones. limma's QR residuals
  // leave constant features at ~1e-30 rather than 0, so they count towards that median in
  // practice; zeros do here too, unless they are the majority.
  const floor = 1e-12 * (median(x) || median(positive));
  const logMinus = memoize(logMinusDigamma);
  const tri = memoize(trigamma);
  let weighted = 0;
  let weights = 0;
  const counts = new Map();
  for (let index = 0; index < x.length; index += 1) {
    x[index] = Math.max(x[index], floor);
    const weight = 1 / tri(halves[index]);
    weighted += weight * (Math.log(x[index]) + logMinus(halves[index]));
    weights += weight;
    counts.set(halves[index], (counts.get(halves[index]) ?? 0) + 1);
  }
  const center = weighted / weights;
  // −2 log-likelihood up to terms free of d0 and s0²; the gamma terms depend on d only.
  const minusTwiceLogLikelihood = (fraction) => {
    const half0 = fraction / (1 - fraction);
    const scale = half0 * Math.exp(center - logMinusDigamma(half0));
    const logScale = Math.log(scale);
    const logGamma0 = logGamma(half0);
    let total = 0;
    for (let index = 0; index < x.length; index += 1) total += (halves[index] + half0) * Math.log1p((halves[index] * x[index]) / scale);
    for (const [half, count] of counts) total += count * (half * logScale - logGamma(half + half0) + logGamma0);
    return 2 * total;
  };
  const fraction = minimizeBrent(minusTwiceLogLikelihood, 0.5, 0.9998, 2 ** -13);
  const half0 = fraction / (1 - fraction);
  return { d0: 2 * half0, s02: Math.exp(center - logMinusDigamma(half0)), method: 'likelihood' };
}

function memoize(fn) {
  const cache = new Map();
  return (value) => {
    let result = cache.get(value);
    if (result === undefined) {
      result = fn(value);
      cache.set(value, result);
    }
    return result;
  };
}

// Brent's (1973) minimization without derivatives: parabolic interpolation through the three best
// points, golden-section steps when a parabola is not trusted. This is the algorithm (and, with
// tolerance 2⁻¹³, the default) of R's stats::optimize, so both visit the same points.
function minimizeBrent(f, lower, upper, tolerance) {
  const golden = (3 - Math.sqrt(5)) / 2;
  const relative = Math.sqrt(Number.EPSILON);
  let a = lower;
  let b = upper;
  let x = a + golden * (b - a);
  let w = x;
  let v = x;
  let fx = f(x);
  let fw = fx;
  let fv = fx;
  let step = 0;
  let lastStep = 0;
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    const middle = (a + b) / 2;
    const tol1 = relative * Math.abs(x) + tolerance / 3;
    const tol2 = 2 * tol1;
    if (Math.abs(x - middle) <= tol2 - (b - a) / 2) break;
    let parabolic = false;
    if (Math.abs(lastStep) > tol1) {
      const r = (x - w) * (fx - fv);
      let q = (x - v) * (fx - fw);
      let p = (x - v) * q - (x - w) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p;
      else q = -q;
      const olderStep = lastStep;
      lastStep = step;
      // Accept the parabola's minimum only inside (a, b) and when the step keeps shrinking.
      if (Math.abs(p) < Math.abs(0.5 * q * olderStep) && p > q * (a - x) && p < q * (b - x)) {
        parabolic = true;
        step = p / q;
        const u = x + step;
        if (u - a < tol2 || b - u < tol2) step = x < middle ? tol1 : -tol1;
      }
    }
    if (!parabolic) {
      lastStep = x < middle ? b - x : a - x;
      step = golden * lastStep;
    }
    let u = x + step;
    if (Math.abs(step) < tol1) u = step > 0 ? x + tol1 : x - tol1;
    const fu = f(u);
    if (fu <= fx) {
      if (u < x) b = x;
      else a = x;
      [v, fv, w, fw, x, fx] = [w, fw, x, fx, u, fu];
    } else {
      if (u < x) a = u;
      else b = u;
      if (fu <= fw || w === x) [v, fv, w, fw] = [w, fw, u, fu];
      else if (fu <= fv || v === x || v === w) [v, fv] = [u, fu];
    }
  }
  return x;
}

/* ---------- Multiple testing and PTM adjustment ---------- */

// Benjamini–Hochberg adjusted p-values. Missing entries (NaN, null) stay NaN and do not count
// towards the number of tests, as with p.adjust(method = "BH") on the non-missing values.
export function adjustBH(pValues) {
  const q = new Float64Array(pValues.length).fill(NaN);
  const order = [];
  for (let index = 0; index < pValues.length; index += 1) {
    const value = pValues[index];
    if (typeof value === 'number' && !Number.isNaN(value)) order.push(index);
  }
  order.sort((first, second) => pValues[second] - pValues[first]);
  const count = order.length;
  let smallest = 1;
  order.forEach((index, position) => {
    smallest = Math.min(smallest, (count / (count - position)) * pValues[index]);
    q[index] = smallest;
  });
  return q;
}

// MSstatsPTM adjustment of a site's change for its protein's change, both { logFC, se, df }:
// logFC(site) − logFC(protein), standard errors added in quadrature, Welch–Satterthwaite df and
// a two-sided t test. As in MSstatsPTM, a site whose protein has no finite change is reported
// unadjusted (adjusted: false), and an infinite site change (a group entirely missing) keeps its
// sign without a test.
export function adjustForProtein(site, protein) {
  if (site.logFC === Infinity || site.logFC === -Infinity) return { logFC: site.logFC, se: NaN, df: NaN, t: NaN, p: NaN, adjusted: true };
  if (!Number.isFinite(protein?.logFC)) {
    const t = site.logFC / site.se;
    return { logFC: site.logFC, se: site.se, df: site.df, t, p: 2 * tTail(Math.abs(t), site.df), adjusted: false };
  }
  const siteVariance = site.se ** 2;
  const proteinVariance = protein.se ** 2;
  const logFC = site.logFC - protein.logFC;
  const se = Math.sqrt(siteVariance + proteinVariance);
  const df = (siteVariance + proteinVariance) ** 2 / (siteVariance ** 2 / site.df + proteinVariance ** 2 / protein.df);
  const t = logFC / se;
  return { logFC, se, df, t, p: 2 * tTail(Math.abs(t), df), adjusted: true };
}

/* ---------- Distributions and special functions ---------- */

// Student's t distribution through the regularized incomplete beta function; df may be
// fractional or infinite (normal).
export function studentTCDF(t, df) {
  const tail = tTail(Math.abs(t), df);
  return t >= 0 ? 1 - tail : tail;
}

export function studentTQuantile(probability, df) {
  if (!(probability >= 0 && probability <= 1) || !(df > 0)) return NaN;
  return probability < 0.5 ? -upperQuantile(probability, df) : upperQuantile(1 - probability, df);
}

// t with P(T > t) = tail ≤ ½: bracketing by doubling, then bisection to full precision.
function upperQuantile(tail, df) {
  if (tail <= 0) return Infinity;
  if (tail === 0.5) return 0;
  let low = 0;
  let high = 1;
  while (tTail(high, df) > tail) {
    low = high;
    high *= 2;
    if (high > 1e300) return Infinity;
  }
  for (let step = 0; step < 200 && high - low > 4 * Number.EPSILON * high; step += 1) {
    const middle = (low + high) / 2;
    if (tTail(middle, df) > tail) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

// P(T > t) for t ≥ 0, as ½·I_x(df / 2, ½) with x = df / (df + t²). The prefactor is formed from
// logs so that small tails keep their relative precision.
function tTail(t, df) {
  if (Number.isNaN(t) || !(df > 0)) return NaN;
  if (t === Infinity) return 0;
  if (df === Infinity) return normalTail(t);
  if (t === 0) return 0.5;
  // Beyond 1e8 df the beta function loses precision; the normal tail with its first correction in
  // 1/df is exact to double precision there.
  if (df > 1e8) return normalTail((t * (1 - 1 / (4 * df))) / Math.sqrt(1 + (t * t) / (2 * df)));
  const a = df / 2;
  const ratio = (t * t) / df;
  // t² / df can overflow or underflow; its log cannot.
  const logRatio = ratio > 0 && ratio < Infinity ? Math.log(ratio) : 2 * Math.log(t) - Math.log(df);
  const logX = ratio < Infinity ? -Math.log1p(ratio) : -logRatio;
  const front = Math.exp(a * logX + 0.5 * (logRatio + logX) - logBeta(a, 0.5));
  const x = 1 / (1 + ratio);
  if (x < (a + 1) / (a + 2.5)) return (0.5 * front * betaFraction(x, a, 0.5)) / a;
  return 0.5 - front * betaFraction(ratio / (1 + ratio), 0.5, a);
}

// Continued fraction of the incomplete beta function (modified Lentz).
function betaFraction(x, a, b) {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let result = d;
  for (let m = 1; m <= 100000; m += 1) {
    const m2 = 2 * m;
    let numerator = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    result *= d * c;
    numerator = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return result;
}

// Upper tail of the standard normal distribution: the everywhere-positive series of erf below
// z = 1.5, the continued fraction of Mills' ratio above.
function normalTail(z) {
  if (Number.isNaN(z)) return NaN;
  if (z < 0) return 1 - normalTail(-z);
  if (z === Infinity) return 0;
  if (z < 1.5) {
    const x2 = (z * z) / 2;
    let term = 1;
    let sum = 1;
    for (let n = 1; term > 1e-17 * sum; n += 1) {
      term *= (2 * x2) / (2 * n + 1);
      sum += term;
    }
    return 0.5 - (z * Math.exp(-x2) * sum) / Math.sqrt(2 * Math.PI);
  }
  const tiny = 1e-300;
  let f = z;
  let c = z;
  let d = 0;
  for (let n = 1; n < 1000; n += 1) {
    d = z + n * d;
    d = Math.abs(d) < tiny ? 1 / tiny : 1 / d;
    c = z + n / c;
    if (Math.abs(c) < tiny) c = tiny;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI) / f;
}

const LOG_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

// log Γ(x) − [(x − ½) log x − x + log √(2π)], the Stirling series remainder, for x ≥ 10.
function stirlingCorrection(x) {
  const inverse = 1 / x;
  const s = inverse * inverse;
  return inverse * (1 / 12 + s * (-1 / 360 + s * (1 / 1260 + s * (-1 / 1680 + s * (1 / 1188 + s * (-691 / 360360 + s / 156))))));
}

// log Γ(x) for x > 0: the Stirling series, after shifting x up to 10 or more by recurrence.
function logGamma(x) {
  if (!(x > 0)) return x === 0 ? Infinity : NaN;
  if (x === Infinity) return Infinity;
  let product = 1;
  let shifted = x;
  while (shifted < 10) {
    product *= shifted;
    shifted += 1;
  }
  return (shifted - 0.5) * Math.log(shifted) - shifted + LOG_SQRT_2PI + stirlingCorrection(shifted) - Math.log(product);
}

// log B(a, b), keeping large arguments' leading terms together so they cancel exactly.
function logBeta(a, b) {
  const small = Math.min(a, b);
  const large = Math.max(a, b);
  const share = small / (small + large);
  if (small >= 10) {
    const correction = stirlingCorrection(small) + stirlingCorrection(large) - stirlingCorrection(small + large);
    return -0.5 * Math.log(large) + LOG_SQRT_2PI + correction + (small - 0.5) * Math.log(share) + large * Math.log1p(-share);
  }
  if (large >= 10) {
    const correction = stirlingCorrection(large) - stirlingCorrection(small + large);
    return logGamma(small) + correction + small - small * Math.log(small + large) + (large - 0.5) * Math.log1p(-share);
  }
  return logGamma(small) + logGamma(large) - logGamma(small + large);
}

// ψ(x): recurrence up to x ≥ 10, then the asymptotic series; reflection for negative x.
export function digamma(x) {
  if (Number.isNaN(x) || x === -Infinity) return NaN;
  if (x <= 0 && Number.isInteger(x)) return NaN;
  if (x < 0) return digamma(1 - x) - Math.PI / Math.tan(Math.PI * x);
  let result = 0;
  while (x < 10) {
    result -= 1 / x;
    x += 1;
  }
  const s = 1 / (x * x);
  return result + Math.log(x) - 0.5 / x - s * (1 / 12 - s * (1 / 120 - s * (1 / 252 - s * (1 / 240 - s * (1 / 132 - s * (691 / 32760 - s / 12))))));
}

// ψ'(x), the same way.
export function trigamma(x) {
  if (Number.isNaN(x) || x === -Infinity) return NaN;
  if (x <= 0 && Number.isInteger(x)) return Infinity;
  if (x < 0) {
    const sine = Math.sin(Math.PI * x);
    return (Math.PI * Math.PI) / (sine * sine) - trigamma(1 - x);
  }
  let result = 0;
  while (x < 10) {
    result += 1 / (x * x);
    x += 1;
  }
  const inverse = 1 / x;
  const s = inverse * inverse;
  return result + inverse + 0.5 * s + inverse * s * (1 / 6 - s * (1 / 30 - s * (1 / 42 - s * (1 / 30 - s * (5 / 66 - s * (691 / 2730 - (7 * s) / 6))))));
}

// ψ''(x) for x > 0, for Newton steps on ψ'.
function tetragamma(x) {
  let result = 0;
  while (x < 10) {
    result -= 2 / (x * x * x);
    x += 1;
  }
  const inverse = 1 / x;
  const s = inverse * inverse;
  return result - s - inverse * s - s * s * (0.5 - s * (1 / 6 - s * (1 / 6 - s * (3 / 10 - s * (5 / 6 - s * (691 / 210 - (35 * s) / 2))))));
}

// y with ψ'(y) = x. Newton's method on 1 / ψ'(y), which is convex and nearly linear, converges
// monotonically from y = ½ + 1 / x (Smyth 2004); the asymptotes ψ'(y) ≈ 1 / y² (small y) and
// ≈ 1 / y (large y) serve at the extremes, as in limma.
export function trigammaInverse(x) {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x > 1e7) return 1 / Math.sqrt(x);
  if (x < 1e-6) return 1 / x;
  let y = 0.5 + 1 / x;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const value = trigamma(y);
    const step = (value * (1 - value / x)) / tetragamma(y);
    y += step;
    if (-step / y < 1e-10) break;
  }
  return y;
}

// log x − ψ(x) without cancellation for large x.
function logMinusDigamma(x) {
  if (x < 10) return Math.log(x) - digamma(x);
  const s = 1 / (x * x);
  return 0.5 / x + s * (1 / 12 - s * (1 / 120 - s * (1 / 252 - s * (1 / 240 - s * (1 / 132 - s * (691 / 32760 - s / 12))))));
}
