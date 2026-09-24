import assert from 'node:assert/strict';
import test from 'node:test';
import { mmAlign, tmAlign } from './tmalign.js';

// Small public-domain fixtures, one representative atom per residue with the deposited
// coordinates: protein G B1 domain (PDB 2GB1, chain A) and protein L B1 domain (PDB 1HZ6, chain B)
// as Cα; tRNA-Phe (PDB 1EHZ) and tRNA-Lys3 (PDB 1FIR) as C3′, without the modified nucleotides
// (HETATM records, which US-align skips by default); the GAL4–DNA complex (PDB 1D66: DNA chains D
// and E, protein chains A and B). "moved" is 1D66 moved rigidly with protein chain A also turned
// 20° about its centroid, its chains reordered and renamed (B → W, D → X, A → Y, E → Z).
const F = fixtures();
const GAL4 = [F.gal4D, F.gal4E, F.gal4A, F.gal4B];
const MOVED = [F.movedW, F.movedX, F.movedY, F.movedZ];

// Reference values from US-align (version 20260920, github.com/pylelab/USalign) on exactly these
// coordinates: `USalign mobile.pdb reference.pdb -m -`, with `-mm 1 -ter 1` for the complex. Its
// output rounds TM-scores to 5 decimals, RMSD and d0 to 2, identity to 3.
const US_ALIGN = {
  proteinGL: {
    tm: [0.65621, 0.60604], rmsd: 2.22, length: 53, identity: 0.113, d0: [2.48, 2.71],
    rotation: [0.929209128, 0.2344612213, 0.2856542178, 0.3668899433, -0.6779314502, -0.6370248962, 0.0442963429, 0.6967330081, -0.7159615558],
    translation: [5.2640959698, 11.3661141499, 6.3181300282],
    rows: [
      '--MTYKLILNGKT-LKGETTTEAVDAAT-AEKVFKQYANDNG--V-DGEWTYD-DATKTFTVTE--',
      '  ::::::::::: ::::::::::: :: : :::::::::::  : ::::::: :. :::::::  ',
      'EEVTIKANLIFANGSTQTAEFKGTF-EKAT-SEAYAYADTLKKDNGEWTVDVADKG-YTLNIKFAG',
    ],
  },
  proteinLG: {
    tm: [0.60604, 0.65621], rmsd: 2.22, length: 53, identity: 0.113, d0: [2.71, 2.48],
    rotation: [0.929209128, 0.3668899433, 0.0442963429, 0.2344612213, -0.6779314502, 0.6967330081, 0.2856542178, -0.6370248962, -0.7159615558],
    translation: [-9.3414290556, 2.069170138, 10.2603246752],
  },
  trna: {
    tm: [0.69472, 0.7013], rmsd: 1.67, length: 57, identity: 0.614, d0: [2.21, 2.17],
    rotation: [0.6096075506, -0.6332873174, -0.4767869627, 0.7775366616, 0.5947880856, 0.2041173024, 0.1543223059, -0.495150792, 0.8549914146],
    translation: [1.4323335507, -51.1597943134, 4.7756339098],
    rows: [
      'GCGGAUUUACUCAG-GGGAGAGCCCAGA-UAAA-UGGAGUCUGUGCGUCCACAGAAUUCGCACCA-',
      '::::: :::::::: :: :::::.:::: :::: :::::  ::::::::::::::::::::::.  ',
      'GCCCG-AUACUCAGCGG-AGAGCACAGACUUUACUGAGG--AGGGCAGUCCCUGUUCGGGCGCC-A',
    ],
  },
  complex: {
    tm: [0.84934, 0.84934], rmsd: 2.42, length: 149, identity: 0.926, d0: [4.59, 4.59],
    rotation: [0.3555496377, -0.8904702732, -0.2839844145, 0.6497477318, 0.4538949024, -0.609760037, 0.6718722648, 0.0322817311, 0.7399632083],
    translation: [20.6194088847, -7.409404373, 1.631382219],
    // -full T: chain pairs with their TM-scores (equal lengths, so one value each).
    chains: [['D', 'X', 0.35098], ['E', 'Z', 0.30396], ['A', 'Y', 0.42797], ['B', 'W', 0.96242]],
    // The one chain pair whose alignment has gaps (A → Y); the others align residue for residue.
    rowsAY: [
      'EQACDICRLKKLKCSKEKPKCAKCLKNNWECRYSPKTKRSPLTRAHLTE-VES-RLE-RL',
      'EQACDICRLKKLKCSKEKPKCAKCLKNNWECRYSPKTKRS-PLT-RAH-LTEVESRLERL',
    ],
  },
};

function close(actual, expected, tolerance, label = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} vs ${expected}`);
}

function assertMatchesUSalign(result, expected) {
  close(result.tmScore.mobile, expected.tm[0], 6e-6, 'TM-score (mobile)');
  close(result.tmScore.reference, expected.tm[1], 6e-6, 'TM-score (reference)');
  close(result.rmsd, expected.rmsd, 0.005, 'RMSD');
  assert.equal(result.alignedLength, expected.length);
  close(result.identity, expected.identity, 5e-4, 'identity');
  close(result.d0.mobile, expected.d0[0], 0.005, 'd0 (mobile)');
  close(result.d0.reference, expected.d0[1], 0.005, 'd0 (reference)');
  result.transform.rotation.forEach((value, index) => close(value, expected.rotation[index], 1e-6, `rotation ${index}`));
  result.transform.translation.forEach((value, index) => close(value, expected.translation[index], 1e-5, `translation ${index}`));
}

// Residue pairs [mobile, reference] read off two alignment rows.
function pairsFromRows(mobileRow, referenceRow) {
  const pairs = [];
  let i = 0;
  let j = 0;
  for (let k = 0; k < mobileRow.length; k += 1) {
    if (mobileRow[k] !== '-' && referenceRow[k] !== '-') pairs.push([i, j]);
    if (mobileRow[k] !== '-') i += 1;
    if (referenceRow[k] !== '-') j += 1;
  }
  return pairs;
}

function transformPoints(transform, coords) {
  const r = transform.rotation;
  const t = transform.translation;
  const out = new Float64Array(coords.length);
  for (let k = 0; k < coords.length; k += 3) {
    for (let axis = 0; axis < 3; axis += 1) out[k + axis] = r[axis * 3] * coords[k] + r[axis * 3 + 1] * coords[k + 1] + r[axis * 3 + 2] * coords[k + 2] + t[axis];
  }
  return out;
}

function rigidMotion(axis, angle, translation) {
  const length = Math.hypot(...axis);
  const [x, y, z] = axis.map((value) => value / length);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return {
    rotation: [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    translation,
  };
}

// Distances reported for the pairs must be those after applying the reported transform.
function assertDistancesFollowTransform(result, mobile, reference) {
  const moved = transformPoints(result.transform, mobile.coords);
  result.pairs.forEach(([i, j], k) => {
    const d = Math.hypot(moved[i * 3] - reference.coords[j * 3], moved[i * 3 + 1] - reference.coords[j * 3 + 1], moved[i * 3 + 2] - reference.coords[j * 3 + 2]);
    close(result.distances[k], d, 1e-9, `distance ${k}`);
  });
}

test('a rigidly moved copy aligns residue for residue with TM-score 1', () => {
  const motion = rigidMotion([0.2, -0.7, 0.4], 2.1, [14, -3, 27]);
  const copy = { ...F.proteinG, coords: transformPoints(motion, F.proteinG.coords) };
  const result = tmAlign(F.proteinG, copy);
  assert.equal(result.alignedLength, 56);
  result.pairs.forEach((pair, k) => assert.deepEqual(pair, [k, k]));
  close(result.tmScore.mobile, 1, 1e-9);
  close(result.tmScore.reference, 1, 1e-9);
  close(result.rmsd, 0, 1e-6);
  assert.equal(result.identity, 1);
  assert.ok(Math.max(...result.distances) < 1e-6);
  // The transform takes the mobile chain onto the reference: here the motion itself.
  result.transform.rotation.forEach((value, index) => close(value, motion.rotation[index], 1e-9));
  result.transform.translation.forEach((value, index) => close(value, motion.translation[index], 1e-7));
  assert.equal(result.alignment.match, ':'.repeat(56));
  assert.equal(result.alignment.mobile, F.proteinG.sequence);
});

test('an inserted loop is left unaligned', () => {
  // Six residues after residue 20, in a hairpin pointing away from the protein.
  const base = F.proteinG.coords;
  const at = 20;
  const center = [0, 1, 2].map((axis) => base.filter((_, index) => index % 3 === axis).reduce((sum, value) => sum + value, 0) / 56);
  const anchor = base.slice(at * 3, at * 3 + 3);
  const out = anchor.map((value, axis) => value - center[axis]);
  const norm = Math.hypot(...out);
  const side = [out[1], -out[0], 0].map((value) => value / Math.hypot(out[0], out[1]));
  const loop = [1, 2, 3, 3, 2, 1].flatMap((step, k) => anchor.map((value, axis) => value + (out[axis] / norm) * 3.8 * step + (k >= 3 ? side[axis] * 3.8 : 0)));
  const mobile = {
    kind: 'protein',
    sequence: `${F.proteinG.sequence.slice(0, at + 1)}GGGGGG${F.proteinG.sequence.slice(at + 1)}`,
    coords: [...base.slice(0, (at + 1) * 3), ...loop, ...base.slice((at + 1) * 3)],
  };
  const result = tmAlign(mobile, F.proteinG);
  assert.deepEqual(result.pairs, Array.from({ length: 56 }, (_, j) => [j <= at ? j : j + 6, j]));
  close(result.tmScore.reference, 1, 1e-9);
  close(result.tmScore.mobile, 56 / 62, 1e-9);
  close(result.rmsd, 0, 1e-6);
  assert.ok(result.alignment.mobile.includes('GGGGGG') && result.alignment.reference.includes('------'));
});

test('protein G against protein L (remote homologs) reproduces US-align', () => {
  const expected = US_ALIGN.proteinGL;
  const result = tmAlign(F.proteinG, F.proteinL);
  assertMatchesUSalign(result, expected);
  assert.deepEqual(result.alignment, { mobile: expected.rows[0], match: expected.rows[1], reference: expected.rows[2] });
  assert.deepEqual(result.pairs, pairsFromRows(expected.rows[0], expected.rows[2]));
  assertDistancesFollowTransform(result, F.proteinG, F.proteinL);
  // The fast settings (US-align's -fast) find the same alignment for this pair.
  assertMatchesUSalign(tmAlign(F.proteinG, F.proteinL, { fast: true }), expected);
});

test('swapping mobile and reference swaps the normalizations', () => {
  const result = tmAlign(F.proteinL, F.proteinG);
  assertMatchesUSalign(result, US_ALIGN.proteinLG);
  assert.deepEqual(result.pairs, pairsFromRows(US_ALIGN.proteinGL.rows[2], US_ALIGN.proteinGL.rows[0]));
});

test('tRNAs are scored with the nucleic-acid d0, as by US-align', () => {
  const expected = US_ALIGN.trna;
  const result = tmAlign(F.trnaPhe, F.trnaLys);
  assertMatchesUSalign(result, expected);
  assert.deepEqual(result.alignment, { mobile: expected.rows[0], match: expected.rows[1], reference: expected.rows[2] });
  assertDistancesFollowTransform(result, F.trnaPhe, F.trnaLys);
});

test('complexes: chains are matched across renaming and reordering, as by USalign -mm 1', () => {
  const expected = US_ALIGN.complex;
  const result = mmAlign(GAL4, MOVED);
  assert.deepEqual(result.chainPairs.map((pair) => [pair.mobile, pair.reference]), expected.chains.map(([a, b]) => [a, b]));
  assertMatchesUSalign(result, expected);
  const byId = Object.fromEntries([...GAL4, ...MOVED].map((chain) => [chain.id, chain]));
  result.chainPairs.forEach((pair, index) => {
    close(pair.tmScore.mobile, expected.chains[index][2], 6e-6, `${pair.mobile} TM-score`);
    close(pair.tmScore.reference, expected.chains[index][2], 6e-6, `${pair.reference} TM-score`);
    const rows = pair.mobile === 'A' ? expected.rowsAY : null;
    const length = byId[pair.mobile].sequence.length;
    assert.deepEqual(pair.pairs, rows ? pairsFromRows(...rows) : Array.from({ length }, (_, k) => [k, k]));
    assertDistancesFollowTransform({ ...pair, transform: result.transform }, byId[pair.mobile], byId[pair.reference]);
  });
});

test('a complex against its moved copy, chains shuffled, superposes exactly', () => {
  const motion = rigidMotion([-0.4, 0.1, 0.9], 0.7, [-5, 12, 30]);
  const copy = [F.gal4B, F.gal4D, F.gal4A, F.gal4E].map((chain) => ({ ...chain, id: `${chain.id}'`, coords: transformPoints(motion, chain.coords) }));
  const result = mmAlign(GAL4, copy);
  assert.deepEqual(result.chainPairs.map((pair) => `${pair.mobile}${pair.reference}`), ["DD'", "EE'", "AA'", "BB'"]);
  close(result.tmScore.mobile, 1, 1e-9);
  close(result.tmScore.reference, 1, 1e-9);
  // Kabsch's closed-form residual loses a few digits to cancellation.
  close(result.rmsd, 0, 1e-4);
  assert.equal(result.alignedLength, 152);
  result.transform.rotation.forEach((value, index) => close(value, motion.rotation[index], 1e-9));
});

test('one chain on each side is plain TM-align', () => {
  const single = tmAlign(F.trnaPhe, F.trnaLys);
  const complex = mmAlign([F.trnaPhe], [F.trnaLys]);
  assert.deepEqual(complex.tmScore, single.tmScore);
  assert.deepEqual(complex.transform, single.transform);
  assert.deepEqual(complex.chainPairs[0].pairs, single.pairs);
  assert.equal(complex.rmsd, single.rmsd);
});

test('inputs: plain arrays work, chains under three residues are refused', () => {
  const result = tmAlign({ ...F.proteinG, coords: Array.from(F.proteinG.coords) }, F.proteinL);
  close(result.tmScore.reference, US_ALIGN.proteinGL.tm[1], 6e-6);
  const tiny = { kind: 'protein', sequence: 'GA', coords: F.proteinG.coords.slice(0, 6) };
  assert.throws(() => tmAlign(tiny, F.proteinL), RangeError);
  assert.throws(() => mmAlign([tiny], [F.proteinL]), RangeError);
  // Chains too short to align are skipped within a complex.
  const skipped = mmAlign([F.proteinG, tiny], [F.proteinL]);
  assert.equal(skipped.chainPairs.length, 1);
});

// Coordinates from the PDB entries named above (x0, y0, z0, x1, …).
function fixtures() {
  return {
    proteinG: {
      id: 'A',
      kind: 'protein',
      sequence: 'MTYKLILNGKTLKGETTTEAVDAATAEKVFKQYANDNGVDGEWTYDDATKTFTVTE',
      coords: [
        -13.296, 0.028, 3.924, -9.669, -0.447, 4.998, -7.173, -2.314, 2.811, -3.922, -3.881, 4.044,
        -0.651, -2.752, 2.466, 2.338, -5.105, 2.255, 5.682, -3.321, 1.9, 8.137, -5.541, 0.03,
        10.92, -2.963, 0.07, 14.315, -4.474, -0.703, 16.093, -3.026, 2.321, 12.799, -2.608, 4.198,
        9.579, -4.606, 4.659, 6.374, -3.757, 6.521, 2.583, -3.604, 6.342, -0.108, -1.143, 7.43,
        -3.848, -0.651, 6.886, -5.35, 2.653, 5.692, -8.945, 3.892, 5.458, -10.035, 4.811, 1.92,
        -13.437, 5.248, 0.258, -12.201, 3.975, -3.121, -9.237, 2.226, -4.777, -7.956, 5.461, -6.338,
        -7.46, 7.449, -3.135, -6.08, 4.229, -1.648, -3.26, 4.204, -4.207, -2.011, 7.699, -3.277,
        -2.843, 7.366, 0.433, -0.555, 4.359, 0.858, 1.993, 5.797, -1.574, 2.188, 8.829, 0.712,
        3.147, 6.462, 3.535, 5.735, 4.444, 1.604, 7.291, 7.781, 0.621, 8.013, 8.481, 4.295,
        10.155, 5.328, 4.045, 11.601, 5.491, 0.523, 9.672, 2.625, -1.112, 8.48, 3.669, -4.587,
        8.449, 1.498, -7.716, 5.817, -1.093, -8.656, 2.365, -1.045, -7.038, -0.167, -3.897, -6.929,
        -3.762, -4.276, -5.696, -5.366, -7.437, -4.268, -9.109, -6.81, -4.634, -9.462, -10.504, -3.768,
        -8.885, -9.951, -0.032, -8.673, -6.154, 0.203, -4.889, -6.162, 0.598, -2.612, -3.587, -1.056,
        0.96, -4.492, -1.948, 3.999, -2.641, -3.279, 7.534, -3.776, -4.109, 10.556, -1.553, -4.826,
      ],
    },
    proteinL: {
      id: 'B',
      kind: 'protein',
      sequence: 'EEVTIKANLIFANGSTQTAEFKGTFEKATSEAYAYADTLKKDNGEWTVDVADKGYTLNIKFAG',
      coords: [
        -10.401, 0.004, 6.331, -7.115, 0.53, 4.484, -5.87, 3.906, 3.294, -2.711, 5.14, 1.6,
        -0.757, 7.864, 3.361, 1.764, 9.776, 1.258, 4.823, 11.228, 2.963, 6.854, 13.911, 1.223,
        10.329, 13.889, 2.767, 11.567, 17.46, 2.414, 15.26, 17.785, 3.195, 17.23, 20.899, 4.105,
        19.456, 20.364, 1.078, 16.527, 20.922, -1.289, 15.904, 17.264, -2.055, 12.323, 16.029, -1.925,
        11.677, 12.279, -1.74, 8.37, 10.43, -1.496, 7.171, 7.396, 0.436, 3.767, 5.738, 0.611,
        2.289, 3.692, 3.447, -0.806, 1.564, 2.889, -2.742, 0.146, 5.819, -5.13, 1.355, 8.5,
        -4.926, 5.111, 9.064, -3.232, 4.556, 12.421, -0.791, 1.91, 11.251, 0.216, 3.878, 8.143,
        0.591, 7.156, 10.036, 2.639, 5.683, 12.896, 4.899, 3.8, 10.481, 5.483, 6.947, 8.404,
        6.546, 8.809, 11.53, 8.72, 5.898, 12.68, 10.417, 5.894, 9.276, 10.996, 9.662, 9.442,
        12.607, 9.197, 12.859, 15.247, 6.873, 11.343, 16.364, 9.786, 9.16, 17.077, 12.233, 11.995,
        20.68, 11.235, 12.695, 21.825, 12.157, 9.191, 19.2, 14.713, 8.156, 18.264, 16.551, 11.333,
        15.115, 16.947, 13.418, 11.778, 17.002, 11.613, 8.297, 18.462, 11.961, 5.302, 17.761, 9.778,
        2.983, 20.1, 7.894, -0.24, 18.094, 7.598, -2.108, 18.431, 4.309, -5.034, 16.717, 2.599,
        -6.591, 15.778, 5.941, -3.589, 13.684, 6.919, -3.207, 11.849, 3.636, -0.242, 14.004, 2.659,
        2.439, 14.374, 5.323, 4.953, 17.072, 4.42, 7.829, 16.063, 6.655, 10.473, 18.773, 6.801,
        13.983, 18.056, 8.066, 16.06, 20.879, 9.553, 19.471, 19.543, 8.576,
      ],
    },
    trnaPhe: {
      id: 'A',
      kind: 'nucleic',
      sequence: 'GCGGAUUUACUCAGGGGAGAGCCCAGAUAAAUGGAGUCUGUGCGUCCACAGAAUUCGCACCA',
      coords: [
        52.454, 49.03, 54.074, 58.09, 47.947, 55.197, 63.405, 46.499, 53.04, 66.881, 44.84, 48.611,
        67.665, 43.715, 42.964, 66.344, 45.708, 37.85, 64.317, 49.197, 33.459, 66.269, 51.519, 28.297,
        63.82, 50.923, 22.466, 61.091, 42.406, 24.335, 65.015, 40.119, 27.684, 70.084, 42.477, 30.389,
        75.617, 44.841, 31.12, 77.992, 49.4, 32.793, 81.426, 60.038, 35.456, 80.907, 62.116, 29.171,
        79.164, 60.229, 23.679, 75.125, 56.852, 22.735, 75.794, 50.585, 21.102, 75.794, 45.028, 19.486,
        73.094, 40.484, 17.855, 68.156, 38.899, 15.531, 62.21, 44.814, 9.004, 63.942, 47.721, 4.187,
        68.423, 48.084, 0.399, 73.716, 46.785, -1.754, 77.123, 42.485, -2.938, 73.601, 33.208, -7.129,
        66.228, 34.575, -5.733, 66.712, 33.999, -0.388, 72.876, 32.339, 8.008, 79.592, 46.251, 7.508,
        76.726, 51.067, 8.272, 72.19, 54.541, 9.414, 67.277, 56.14, 11.871, 64.685, 55.408, 16.681,
        62.833, 59.116, 27.493, 66.457, 56.168, 31.682, 59.871, 61.655, 34.983, 60.529, 66.527, 37.797,
        63.616, 69.845, 41, 68.665, 70.782, 43.62, 78.954, 73.036, 36.142, 76.221, 68.672, 33.883,
        71.352, 58.357, 34.366, 74.192, 57.08, 39.322, 74.297, 58.531, 44.524, 70.391, 60.442, 48.405,
        64.958, 61.089, 49.85, 59.459, 60.433, 48.632, 55.711, 57.868, 45.316, 53.666, 54.171, 41.354,
        53.636, 49.208, 38.725, 55.315, 43.758, 37.955, 57.3, 39.247, 40.746, 58.743, 35.702, 45.172,
        58.716, 34.693, 50.839, 56.261, 36.155, 55.979, 51.987, 38.727, 58.75, 46.291, 39.627, 58.66,
        42.136, 36.747, 56.733, 37.025, 39.585, 59.305,
      ],
    },
    trnaLys: {
      id: 'A',
      kind: 'nucleic',
      sequence: 'GCCCGAUACUCAGCGGAGAGCACAGACUUUACUGAGGAGGGCAGUCCCUGUUCGGGCGCCA',
      coords: [
        -23.633, 30.78, 35.087, -19.47, 34.326, 36.678, -14.059, 35.97, 36.849, -9.103, 36.823, 34.317,
        -5.619, 36.448, 29.607, -6.555, 34.977, 18.242, -3.93, 37.191, 13.448, -1.978, 34.251, 8.092,
        0.129, 28.719, 14.45, 2.473, 31.197, 19.076, 3.078, 37.1, 20.285, 3.947, 42.769, 19.931,
        1.101, 47.282, 18.677, -3.014, 54.535, 24, -4.915, 54.658, 18.201, -2.025, 56.041, 12.184,
        1.325, 46.759, 9.238, 6.144, 42.9, 8.796, 10.335, 39.098, 10.647, 12.163, 33.69, 11.771,
        10.856, 28.662, 9.983, 7.852, 26.135, 5.951, 7.914, 27.881, -4.507, 12.04, 29.642, -8.111,
        17.349, 31.068, -9.109, 23.081, 31.75, -7.776, 27.374, 28.641, -5.764, 28.636, 23.335, -5.543,
        21.985, 19.351, -6.31, 18.604, 19.415, -1.599, 20.812, 26.408, 6.674, 21.575, 36.243, 2.568,
        17.921, 39.114, -0.667, 12.674, 40.194, -2.432, 7.039, 39.242, -3.274, 1.851, 37.688, -2.367,
        -1.923, 36.332, 1.707, -17.987, 39.101, 13.579, -22.454, 42.5, 14.164, -24.178, 47.371, 16.334,
        -22.628, 52.49, 18.719, -14.633, 60.708, 11.878, -11.962, 55.723, 11.781, -8.981, 45.85, 16.116,
        -8.206, 47.804, 20.994, -11.52, 49.878, 25.338, -16.76, 48.54, 27.406, -21.105, 45.017, 27.547,
        -23.048, 39.854, 26.06, -22.409, 34.633, 23.582, -19.52, 30.44, 21.064, -14.968, 27.601, 21.411,
        -10.076, 25.12, 23.679, -7.492, 24.4, 28.743, -7.103, 24.886, 34.592, -9.524, 25.669, 39.726,
        -14.383, 25.315, 42.619, -19.876, 24.234, 43.331, -24.463, 21.267, 41.911, -23.749, 17.084, 46.872,
        -21.596, 12.057, 49.425,
      ],
    },
    gal4D: {
      id: 'D',
      kind: 'nucleic',
      sequence: 'CCGGAGGACAGTCCTCCGG',
      coords: [
        23.957, 71.289, 34.142, 23.549, 66.709, 30.739, 24.907, 63.659, 25.28, 29.988, 60.419, 23.839,
        36.038, 58.59, 23.839, 39.404, 55.824, 27.006, 39.971, 50.87, 30.101, 39.362, 46.708, 34.513,
        34.863, 43.351, 35.948, 29.396, 40.421, 35.66, 25.685, 37.357, 32.424, 24.41, 36.003, 26.199,
        25.402, 33.653, 21.367, 27.736, 29.072, 17.776, 32.33, 25.252, 17.089, 35.456, 20.572, 19.027,
        38.745, 17.627, 23.543, 37.993, 13.784, 27.747, 34.677, 10.653, 31.899,
      ],
    },
    gal4E: {
      id: 'E',
      kind: 'nucleic',
      sequence: 'CCGGAGGACTGTCCTCCGG',
      coords: [
        22.093, 13.078, 23.713, 24.068, 17.248, 28.038, 27.194, 19.725, 32.747, 31.552, 23.417, 32.684,
        37.062, 24.74, 31.058, 40.115, 28.101, 26.833, 39.813, 32.938, 23.07, 37.224, 36.935, 19.343,
        32.416, 40.339, 19.324, 27.597, 42.981, 21.374, 25.135, 46.521, 25.375, 25.279, 47.35, 31.628,
        26.994, 50.058, 36.283, 30.722, 54.04, 38.833, 34.795, 58.196, 38.653, 37.463, 62.797, 35.912,
        38.835, 65.206, 30.423, 37.485, 68.713, 26.393, 33.617, 72.447, 22.936,
      ],
    },
    gal4A: {
      id: 'A',
      kind: 'protein',
      sequence: 'EQACDICRLKKLKCSKEKPKCAKCLKNNWECRYSPKTKRSPLTRAHLTEVESRLERL',
      coords: [
        37.329, 54.343, 43.577, 33.767, 55.382, 44.453, 33.349, 59.118, 43.995, 30.843, 60.782, 46.374,
        27.093, 61.267, 45.719, 27.356, 64.926, 44.893, 30.329, 64.742, 42.448, 28.44, 61.655, 41.046,
        25.31, 63.75, 40.753, 27.463, 66.355, 39.132, 29.635, 64.209, 36.772, 32.757, 65.72, 38.202,
        36.154, 64.453, 39.464, 35.948, 63.406, 43.148, 39.055, 63.658, 45.271, 37.487, 60.741, 47.266,
        38.554, 61.666, 50.801, 36.243, 60.388, 53.491, 34.784, 62.15, 55.679, 33.997, 65.058, 53.342,
        35.71, 65.28, 50.064, 37.56, 68.442, 49.02, 34.613, 70.166, 47.344, 32.049, 69.189, 50.096,
        34.485, 70.152, 52.895, 35.212, 73.496, 51.387, 31.529, 74.009, 50.452, 30.042, 72.575, 53.682,
        27.954, 70.095, 51.719, 27.017, 66.661, 53.105, 29.578, 64.049, 52.002, 27.667, 60.868, 51.652,
        29.451, 58.086, 49.588, 26.311, 55.928, 49.175, 26.232, 52.193, 48.226, 26.114, 50.994, 44.652,
        22.355, 49.995, 44.488, 21.504, 46.662, 43.175, 19.707, 46.031, 39.91, 18.226, 42.91, 38.195,
        20.569, 40.305, 36.505, 20.862, 41.295, 32.964, 20.971, 37.77, 31.802, 19.469, 36.241, 28.623,
        17.311, 34.052, 30.93, 15.815, 37.04, 32.725, 15.21, 38.993, 29.535, 13.353, 36.297, 27.623,
        11.636, 35.137, 30.788, 10.081, 38.474, 31.493, 9.619, 39.603, 27.835, 7.659, 36.328, 27.386,
        5.681, 36.394, 30.673, 4.427, 39.813, 29.415, 3.797, 38.699, 25.823, 1.777, 35.681, 26.714,
        -0.825, 37.645, 28.68,
      ],
    },
    gal4B: {
      id: 'B',
      kind: 'protein',
      sequence: 'EQACDICRLKKLKCSKEKPKCAKCLKNNWECRYSPKTKRSPLTRAHLTEVESRLERL',
      coords: [
        33.093, 28.846, 8.919, 30.562, 28.297, 11.585, 29.484, 24.856, 12.508, 26.697, 23.103, 10.74,
        23.509, 22.243, 12.487, 24.065, 18.434, 12.858, 27.423, 18.843, 14.472, 25.742, 21.706, 16.306,
        23.033, 19.78, 18.157, 25.289, 16.783, 18.487, 28.024, 19.1, 19.825, 30.648, 17.869, 17.433,
        33.566, 19.289, 15.592, 32.751, 20.77, 12.276, 35.006, 21.152, 9.28, 32.615, 24.054, 8.268,
        33.421, 23.397, 4.611, 30.448, 24.558, 2.583, 28.227, 23.06, 0.895, 28.806, 19.718, 2.644,
        31.013, 19.452, 5.696, 32.804, 16.048, 5.762, 30.503, 14.156, 8.093, 27.399, 14.938, 6.009,
        29.424, 14.226, 2.757, 30.781, 10.96, 4.201, 27.494, 10.073, 5.911, 25.081, 11.383, 3.307,
        23.086, 13.652, 5.565, 21.538, 17.059, 4.863, 23.884, 19.706, 5.776, 22.531, 23.044, 6.721,
        24.165, 26.063, 8.157, 20.991, 27.814, 9.048, 21.711, 31.514, 9.817, 22.404, 33.907, 12.652,
        19.602, 33.449, 15.252, 18.409, 37.07, 15.759, 17.417, 37.815, 19.44, 16.205, 40.88, 21.434,
        19.012, 43.167, 22.795, 20.292, 42.228, 26.276, 20.658, 45.966, 27.061, 19.556, 47.69, 30.143,
        16.715, 49.906, 28.839, 15.119, 46.979, 27.049, 15.246, 44.864, 30.273, 13.799, 47.786, 32.2,
        11.152, 48.874, 29.479, 9.94, 45.334, 29.588, 9.866, 44.611, 33.399, 8.117, 47.998, 33.723,
        5.7, 46.99, 31.089, 5.031, 43.768, 32.891, 4.844, 45.512, 36.401, 2.181, 47.674, 34.776,
        -0.077, 44.654, 33.696,
      ],
    },
    movedW: {
      id: 'W',
      kind: 'protein',
      sequence: 'EQACDICRLKKLKCSKEKPKCAKCLKNNWECRYSPKTKRSPLTRAHLTEVESRLERL',
      coords: [
        4.142, 21.644, 31.493, 2.965, 18.132, 31.799, 5.385, 15.304, 31.794, 6.557, 13.695, 28.631,
        5.719, 10.147, 27.817, 9.184, 8.567, 28.49, 9.448, 10.038, 31.928, 5.772, 9.134, 32.156,
        6.012, 5.36, 31.746, 9.335, 5.307, 33.516, 7.776, 7.392, 36.319, 10.486, 9.995, 36.291,
        10.763, 13.673, 36.852, 10.19, 15.763, 33.825, 11.525, 19.21, 33.09, 8.451, 19.533, 30.722,
        10.43, 21.933, 28.536, 9.023, 21.677, 25.035, 10.133, 20.513, 22.307, 12.766, 18.347, 24.021,
        12.804, 17.894, 27.769, 16.416, 17.502, 29.035, 16.615, 13.731, 29.254, 15.519, 13.249, 25.627,
        17.831, 16.197, 24.555, 20.751, 14.764, 26.559, 19.915, 11.16, 25.651, 18.74, 11.685, 22.093,
        15.357, 10.052, 22.432, 12.02, 10.983, 20.854, 10.167, 13.21, 23.079, 6.45, 13.266, 22.859,
        3.867, 14.879, 24.997, 0.97, 13.032, 23.536, -2.321, 14.739, 24.563, -5.092, 14.612, 27.122,
        -6.421, 11, 27.199, -10.201, 11.55, 26.757, -12.328, 9.052, 28.837, -16.077, 8.459, 29.495,
        -17.593, 10.565, 32.364, -17.397, 8.934, 35.819, -20.846, 10.412, 36.623, -23.697, 8.64, 38.175,
        -26.222, 8.523, 35.295, -23.599, 7.188, 32.917, -22.663, 4.406, 35.421, -26.342, 3.63, 35.874,
        -27.362, 3.968, 32.074, -24.647, 1.488, 31.373, -25.199, -1.142, 34.171, -28.901, -0.961, 33.224,
        -28.003, -1.473, 29.657, -25.911, -4.448, 30.578, -28.605, -5.855, 33.059, -30.923, -5.687, 30.058,
        -28.657, -7.926, 27.77,
      ],
    },
    movedX: {
      id: 'X',
      kind: 'nucleic',
      sequence: 'CCGGAGGACAGTCCTCCGG',
      coords: [
        -44.475, 19.932, 43.925, -39.486, 19.59, 41.147, -34.637, 22.336, 38.001, -29.607, 25.102, 40.333,
        -25.952, 28.304, 44.375, -23.335, 27.419, 48.999, -19.683, 23.717, 51.719, -17.535, 18.813, 54.634,
        -16.492, 13.44, 52.731, -15.623, 8.635, 48.895, -13.142, 6.682, 44.031, -10.45, 8.896, 38.548,
        -6.54, 11.345, 35.621, -0.574, 12.941, 34.529, 4.578, 14.674, 37.104, 9.198, 13.486, 40.664,
        11.534, 11.671, 46.243, 13.414, 6.939, 48.905, 13.817, 0.853, 49.815,
      ],
    },
    movedY: {
      id: 'Y',
      kind: 'protein',
      sequence: 'EQACDICRLKKLKCSKEKPKCAKCLKNNWECRYSPKTKRSPLTRAHLTEVESRLERL',
      coords: [
        -26.226, 16.206, 58.668, -28.608, 13.41, 57.65, -32.198, 14.528, 58.098, -34.67, 11.744, 59.018,
        -36.672, 9.598, 56.545, -39.924, 11.413, 57.065, -38.611, 15.024, 56.766, -36.617, 13.601, 53.756,
        -39.82, 12.165, 52.361, -41.36, 15.517, 53.023, -38.585, 17.902, 51.797, -38.636, 19.718, 55.079,
        -36.048, 20.994, 57.611, -35.065, 18.23, 60.082, -33.954, 19.22, 63.548, -31.878, 15.961, 63.418,
        -32.174, 14.806, 67.033, -31.875, 11.076, 67.486, -34.013, 9.195, 68.87, -37.058, 10.968, 67.414,
        -36.658, 14.314, 65.873, -38.812, 17.257, 66.971, -41.644, 16.703, 64.494, -41.722, 12.843, 64.939,
        -41.513, 13.144, 68.755, -44.309, 15.623, 68.914, -46.317, 13.709, 66.267, -45.521, 10.188, 67.56,
        -44.179, 9.156, 64.169, -41.392, 6.574, 63.773, -37.994, 8.314, 63.616, -35.89, 6.19, 61.389,
        -32.686, 7.919, 60, -32.022, 5.259, 57.322, -28.679, 4.661, 55.497, -27.745, 6.441, 52.306,
        -28.383, 3.532, 49.799, -25.736, 2.726, 47.37, -25.999, 3.277, 43.64, -23.816, 2.332, 40.604,
        -20.532, 4.283, 39.869, -21.423, 7.003, 37.542, -18.201, 6.737, 35.715, -17.523, 7.173, 31.967,
        -16.343, 3.516, 31.953, -19.625, 2.225, 33.35, -21.751, 4.372, 31.064, -20.116, 3.408, 27.782,
        -19.666, -0.155, 28.972, -23.324, -0.702, 29.582, -24.655, 1.59, 26.78, -22.489, -0.536, 24.423,
        -23.26, -3.991, 25.903, -26.929, -3.072, 25.171, -26.283, -1.624, 21.703, -24.335, -4.551, 20.43,
        -27.133, -7.055, 21.057,
      ],
    },
    movedZ: {
      id: 'Z',
      kind: 'nucleic',
      sequence: 'CCGGAGGACTGTCCTCCGG',
      coords: [
        9.96, -1.596, 35.311, 5.577, -0.94, 39.823, 2.97, -0.514, 45.4, 1.16, 4.105, 48.23,
        2.325, 9.34, 50.678, 1.652, 15.399, 49.537, -1.602, 19.619, 46.495, -4.884, 21.912, 41.963,
        -9.52, 20.265, 38.723, -14.116, 17.042, 37.023, -19.323, 14.645, 38.343, -21.935, 11.422, 43.097,
        -25.204, 11.045, 47.693, -28.286, 13.832, 52.05, -30.57, 18.542, 54.599, -32.933, 24.03, 54.3,
        -32.933, 29.283, 51.103, -35.27, 32.359, 47.173, -38.829, 33.52, 41.993,
      ],
    },
  };
}
