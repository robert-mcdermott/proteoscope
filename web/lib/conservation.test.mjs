import assert from 'node:assert/strict';
import test from 'node:test';
import { CONSERVATION_DEFAULTS, conservationGrades, conservationScores, parseAlignment } from './conservation.js';

const near = (actual, expected, tolerance, message) => {
  assert.equal(actual.length, expected.length, message);
  expected.forEach((value, index) => {
    if (Number.isNaN(value)) assert.ok(Number.isNaN(actual[index]), `${message}: position ${index} should be unscored`);
    else assert.ok(Math.abs(actual[index] - value) <= tolerance, `${message}: position ${index} is ${actual[index]}, expected ${value}`);
  });
};

// Ten sequences, 16 query columns: invariant W (2) and G (5), B → D (4), Z → Q (7), X as a gap
// (10, 14), exactly 30% gaps (12, scored) and 40% gaps (13, unscored), A3M insertions and '.'.
const PINNED = `#16\t1
>query
MKWVCGLEHRDNPAYT
>s1
MKWVCGLEHKDNPAYS
>s2
MRWICGIDHRENPSYT
>s3
MKWLCGVEHRdkDNPA-T
>s4
MKWVCGLQYRDGPAFT
>s5
LKWICGLE..HRDNP-YS
>s6
MKWVCGMEHKEN--YT
>s7
IRWVCGLEHaaa-DNPAFT
>s8
MKWVBGLZHRXN--YT
>s9
MKWVCG-EHRDN--XT
`;

// score_conservation.py (Capra & Singh; run under Python 3 with -a query) on the same alignment.
const REFERENCE = {
  jsd: [0.745775637237, 0.754377209375, 0.947702476579, 0.698937518905, 0.790821419782, 0.772412882563, 0.650136802496, 0.717621289402, 0.776395945385, 0.694158642194, 0.711486182422, 0.745439215718, 0.695707162234, NaN, 0.690049697493, 0.754002879594],
  jsdWindow0: [0.745775637237, 0.754377209375, 0.947702476579, 0.624354386774, 0.854232937493, 0.789674517997, 0.549361127531, 0.698989694161, 0.856266860237, 0.681956468109, 0.686025396492, 0.773142978900, 0.674378840349, NaN, 0.690049697493, 0.754002879594],
  jsdUnweightedWindow0: [0.749087124872, 0.760402187278, 0.947719520324, 0.629058351753, 0.850272662654, 0.789691364992, 0.524922369752, 0.711022107243, 0.863343650121, 0.685809423451, 0.680923870228, 0.788476701794, 0.610205217941, NaN, 0.648421396125, 0.753518469059],
  entropy: [0.714068638118, 0.749085515444, 0.999985131441, 0.712968245674, 0.805355679010, 0.864694035146, 0.605767286351, 0.658093408008, 0.747433906598, 0.615041435997, 0.633517515016, 0.719382513421, 0.625180545673, NaN, 0.508773999586, 0.784831838378],
  entropyWindow0: [0.714068638118, 0.749085515444, 0.999985131441, 0.626479104231, 0.871857999784, 0.999985131441, 0.461761906475, 0.595823360381, 0.820510130795, 0.583980270733, 0.584085294584, 0.820510130795, 0.593924784531, NaN, 0.508773999586, 0.784831838378],
};

const fasta = (rows) => rows.map((row, index) => `>s${index}\n${row}`).join('\n');

test('A3M: ColabFold header, insertions, dots and stop codons dropped, odd records skipped', () => {
  const text = '#4,3\t1,1\n>101\t102\nMKVLGHW\n>hit1\nMKiLLgGHW\n>hit2\nMR--G.HW\n>short\nMKV\n>hit3\n-KVL---\n>hit4\nMKVLGHW*\n';
  const alignment = parseAlignment(text, 'complex.a3m');
  assert.equal(alignment.format, 'a3m');
  assert.deepEqual(alignment.names, ['101\t102', 'hit1', 'hit2', 'hit3', 'hit4']);
  assert.deepEqual(alignment.rows, ['MKVLGHW', 'MKLLGHW', 'MR--GHW', '-KVL---', 'MKVLGHW']);
  assert.equal(alignment.query, 'MKVLGHW');
  assert.deepEqual([...alignment.columns], [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(alignment.chainLengths, [4, 3]);
  assert.equal(alignment.skipped, 1);
  const windows = parseAlignment('\uFEFF>q\r\nMKV\r\n>b\r\nMKI\r\n\0');
  assert.deepEqual(windows.rows, ['MKV', 'MKI'], 'BOM, CRLF and NUL are tolerated');
  assert.equal(parseAlignment(''), null);
  assert.equal(parseAlignment('>q\n---\n>b\nMKV\n'), null, 'a query without residues cannot be mapped');
});

test('aligned FASTA, Stockholm and Clustal read to the same rows; query-gap columns are kept', () => {
  const expected = { names: ['q', 'b', 'c'], rows: ['MK-VL-W', 'MKAIL-W', 'MR-VIGW'], query: 'MKVLW', columns: [0, 1, 3, 4, 6] };
  const texts = {
    fasta: '>q\nMK-VL.W\n>b\nMKAIL-W\n>c\nmr-vIGw\n',
    stockholm: '# STOCKHOLM 1.0\n#=GF ID test\n#=GS q DE query\nq   MK-V\nb   MKAI\nc   mr-v\n#=GC SS_cons ....\n\nq   L.W\n#=GR q SS HHH\nb   L-W\nc   IGw\n//\nextra ACD\n',
    clustal: 'CLUSTAL W (1.83) multiple sequence alignment\n\nq      MK-V 3\nb      MKAI 4\nc      MR-V 3\n       **  \n\nq      L-W 5\nb      L-W 6\nc      IGW 6\n       .:*\n',
  };
  for (const [format, text] of Object.entries(texts)) {
    const alignment = parseAlignment(text);
    assert.equal(alignment.format, format);
    assert.deepEqual(alignment.names, expected.names, format);
    assert.deepEqual(alignment.rows, expected.rows, format);
    assert.equal(alignment.query, expected.query, format);
    assert.deepEqual([...alignment.columns], expected.columns, format);
  }
  assert.equal(parseAlignment('>q\nMKV\n>b\nMKI\n', 'x.a3m').format, 'a3m', 'the name labels an alignment that reads the same either way');
});

test('scores match the published score_conservation.py', () => {
  const alignment = parseAlignment(PINNED, 'pinned.a3m');
  assert.equal(alignment.rows.length, 10);
  assert.equal(alignment.query, 'MKWVCGLEHRDNPAYT');
  const result = conservationScores(alignment);
  near(result.scores, REFERENCE.jsd, 1e-9, 'JSD, window 3');
  near(conservationScores(alignment, { window: 0 }).scores, REFERENCE.jsdWindow0, 1e-9, 'JSD, window 0');
  near(conservationScores(alignment, { window: 0, weighting: false }).scores, REFERENCE.jsdUnweightedWindow0, 1e-9, 'JSD, unweighted');
  near(conservationScores(alignment, { method: 'entropy' }).scores, REFERENCE.entropy, 1e-9, 'entropy, window 3');
  near(conservationScores(alignment, { method: 'entropy', window: 0 }).scores, REFERENCE.entropyWindow0, 1e-9, 'entropy, window 0');
  assert.equal(result.method, 'jsd');
  assert.equal(result.sequences, 10);
  assert.deepEqual(result.grades, conservationGrades(result.scores));
  assert.deepEqual(conservationScores(alignment, { binning: 'consurf' }).grades, conservationGrades(result.scores, { binning: 'consurf' }));
  assert.equal(result.grades[2], 9, 'the invariant tryptophan is the most conserved');
  assert.equal(result.grades[13], 0, 'unscored');
});

test('invariant columns score the divergence of a point mass; the gap penalty uses Henikoff weights', () => {
  // Identical sequences: Henikoff weights sum to 1, so each residue class carries the 1e-7
  // pseudocount against a total of 1 (the tool's background sums to 1.002).
  const background = { W: 0.014, A: 0.078 };
  const pointMass = (q) => {
    const pseudocount = 1e-7;
    const p = (1 + pseudocount) / (1 + 20 * pseudocount);
    const rest = pseudocount / (1 + 20 * pseudocount);
    let sum = p * Math.log2(2 * p / (p + q)) + q * Math.log2(2 * q / (p + q));
    const others = [0.078, 0.051, 0.041, 0.052, 0.024, 0.034, 0.059, 0.083, 0.025, 0.062, 0.092, 0.056, 0.024, 0.044, 0.043, 0.059, 0.055, 0.014, 0.034, 0.072];
    others.splice(others.indexOf(q), 1);
    for (const other of others) sum += rest * Math.log2(2 * rest / (rest + other)) + other * Math.log2(2 * other / (rest + other));
    return sum / 2;
  };
  const invariant = conservationScores(parseAlignment(fasta(['WA', 'WA', 'WA', 'WA'])), { window: 0 });
  near(invariant.scores, [pointMass(background.W), pointMass(background.A)], 1e-12, 'point masses');
  assert.ok(Math.abs(invariant.scores[0] - 0.9477) < 1e-4);

  // Weights: AC and AC share column 1 (1 / (2 × 1) each) and C against D in column 2 (1 / (2 × 2)
  // each, D 1 / (1 × 2)): 0.375, 0.375 and 0.25. Column 1 holds the 0.25 gap → factor 0.75.
  const alignment = parseAlignment(fasta(['AC', 'AC', '-D']));
  assert.ok(Number.isNaN(conservationScores(alignment).scores[0]), 'one gap in three is over the 30% cutoff');
  const penalized = conservationScores(alignment, { window: 0, gapCutoff: 0.5 }).scores[0];
  const plain = conservationScores(alignment, { window: 0, gapCutoff: 0.5, gapPenalty: false }).scores[0];
  assert.ok(Math.abs(penalized / plain - 0.75) < 1e-12);
  const tenRows = fasta(['AW', 'AW', 'AW', 'AW', 'AW', 'AW', 'AW', '-W', '-W', '-W']);
  assert.ok(!Number.isNaN(conservationScores(parseAlignment(tenRows)).scores[0]), 'exactly 30% gaps is scored');
});

test('B, Z, X and rare letters are read like the tool; rows without residues are ignored', () => {
  const rows = ['MDECKLWS', 'MBZUOJWS', 'MDQCKL*S', 'MXECKLWS', 'MDECKLWT', 'MDECRIWS', 'MNECKLWS'];
  const plain = rows.map((row) => row.replace(/B/g, 'D').replace(/Z/g, 'Q').replace(/U/g, 'C').replace(/O/g, 'K').replace(/J/g, 'L').replace(/[X*]/g, '-'));
  const odd = conservationScores(parseAlignment(fasta(rows)), { window: 1 });
  const standard = conservationScores(parseAlignment(fasta(plain)), { window: 1 });
  assert.deepEqual(odd.scores, standard.scores);
  const withFiller = conservationScores(parseAlignment(fasta([...plain, '--------', 'XXXXXXXX'])), { window: 1 });
  assert.deepEqual(withFiller.scores, standard.scores);
  assert.equal(withFiller.sequences, plain.length);
  const queryX = parseAlignment(fasta(['MXEC', 'MDEC']));
  assert.equal(queryX.query, 'MXEC', 'an X in the query is still a query residue');
});

test('window smoothing averages scored neighbours and leaves the ends as they are', () => {
  const alignment = parseAlignment(PINNED);
  const raw = conservationScores(alignment, { window: 0 }).scores;
  const smoothed = conservationScores(alignment).scores;
  for (const column of [0, 1, 2, 14, 15]) assert.equal(smoothed[column], raw[column]);
  // Column 12: neighbours 9–15 without the unscored column 13, λ = 0.5.
  const neighbours = [raw[9], raw[10], raw[11], raw[14], raw[15]];
  const expected = 0.5 * raw[12] + 0.5 * (neighbours.reduce((sum, value) => sum + value, 0) / neighbours.length);
  assert.ok(Math.abs(smoothed[12] - expected) < 1e-15);
  const custom = conservationScores(alignment, { window: 1, windowLambda: 0.25 }).scores;
  assert.ok(Math.abs(custom[5] - (0.25 * raw[5] + 0.75 * (raw[4] + raw[6]) / 2)) < 1e-15);
});

test('grades split the scored residues into ninths by default', () => {
  const scores = Float64Array.from([0.9, 0.1, 0.5, NaN, 0.3, 0.7, 0.2, 0.6, 0.8, 0.4]);
  assert.deepEqual([...conservationGrades(scores)], [9, 1, 5, 0, 3, 7, 2, 6, 8, 4]);
  assert.deepEqual([...conservationGrades(Float64Array.from([0.2, 0.2, 0.9, 0.1]))], [5, 5, 8, 2], 'ties share the grade of their mid-rank');
  assert.deepEqual([...conservationGrades([0.7, 0.7, NaN])], [5, 5, 0], 'no spread → all average');
});

test('grades bin standardized scores as ConSurf does', () => {
  // Mean 0: bins are 1 wide from the top score, 4.5, so grade 5 spans (−0.5, 0.5] and grade 1
  // everything at or below −3.5.
  const scores = [4.5, 3, 2, 1, 0.1, -1, -2, -3, -4, -0.6];
  assert.deepEqual([...conservationGrades(scores, { binning: 'consurf' })], [9, 8, 7, 6, 5, 4, 3, 2, 1, 4]);
  assert.deepEqual([...conservationGrades(scores.map((score) => 0.1 * score + 0.3), { binning: 'consurf' })], [9, 8, 7, 6, 5, 4, 3, 2, 1, 4], 'invariant to scale and shift');
  assert.deepEqual([...conservationGrades([1, NaN, 0.5, 0.5, 0.5, 0], { binning: 'consurf' })], [9, 0, 5, 5, 5, 1]);
  assert.deepEqual([...conservationGrades([0.7, 0.7, NaN], { binning: 'consurf' })], [5, 5, 0], 'no spread → all average');
  assert.deepEqual([...conservationGrades([NaN, NaN], { binning: 'consurf' })], [0, 0]);
});

test('ColabFold complex alignments are scored chain by chain', () => {
  const complex = parseAlignment('#4,3\t1,1\n>101\t102\nMKVLGHW\n>p1\nMKILGHF\n>p2\nMRVLGYW\n>101\nMKVL---\n>u1\nMKVI---\n>u2\nMRVL---\n>102\n----GHW\n>v1\n----GHF\n>v2\n----AHW\n');
  const result = conservationScores(complex);
  const first = conservationScores(parseAlignment(fasta(['MKVL', 'MKIL', 'MRVL', 'MKVL', 'MKVI', 'MRVL'])));
  const second = conservationScores(parseAlignment(fasta(['GHW', 'GHF', 'GYW', 'GHW', 'GHF', 'AHW'])));
  assert.deepEqual(result.scores, Float64Array.of(...first.scores, ...second.scores));
  assert.deepEqual(result.grades, Uint8Array.of(...first.grades, ...second.grades));
  assert.equal(result.sequences, 9);
  assert.deepEqual(result.segments.map(({ start, end, sequences }) => [start, end, sequences]), [[0, 4, 6], [4, 7, 6]]);
  const whole = conservationScores({ ...complex, chainLengths: null });
  assert.ok(whole.scores.every(Number.isNaN), 'as one alignment every column is a third gaps');
});

test('maxSequences takes evenly spaced rows and keeps the query', () => {
  const letters = 'ACDEFGHIKLMNPQRSTVWY';
  const rows = Array.from({ length: 25 }, (_, index) => `M${letters[index % 20]}${letters[(index * 7) % 20]}W${letters[(index * 3) % 20]}`);
  const alignment = parseAlignment(fasta(rows));
  const capped = conservationScores(alignment, { maxSequences: 5, window: 0 });
  const chosen = conservationScores(parseAlignment(fasta([0, 5, 10, 15, 20].map((index) => rows[index]))), { window: 0 });
  assert.deepEqual(capped.scores, chosen.scores);
  assert.equal(capped.sequences, 5);
  assert.equal(capped.parameters.maxSequences, 5);
  assert.equal(conservationScores(alignment).sequences, 25);
});

test('effective sequences, parameters and bad options', () => {
  assert.equal(conservationScores(parseAlignment(fasta(['MKV', 'MKV', 'MKV']))).effectiveSequences, 1);
  assert.ok(Math.abs(conservationScores(parseAlignment(fasta(['AAAA', 'CCCC']))).effectiveSequences - 2) < 1e-12);
  const { parameters } = conservationScores(parseAlignment(PINNED));
  assert.deepEqual({ ...parameters }, { ...CONSERVATION_DEFAULTS, background: 'BLOSUM62', pseudocount: 1e-7 });
  assert.throws(() => conservationScores(parseAlignment(PINNED), { method: 'rate4site' }), RangeError);
  const empty = conservationScores(null);
  assert.equal(empty.scores.length, 0);
  assert.equal(empty.sequences, 0);
});
