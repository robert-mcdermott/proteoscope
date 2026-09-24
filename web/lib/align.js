// Pairwise sequence alignment used to pair residues before a structural superposition.
// Gotoh dynamic programming with affine gaps and free end gaps (an overlap alignment, so a
// domain structure aligns into a full-length model without end penalties). Protein scores blend
// BLOSUM62 with a secondary-structure term, as ChimeraX matchmaker does by default: 30% weight on
// the SS matrix, gap opening 18 inside helices and strands and 6 elsewhere, extension 1.

const BLOSUM_ORDER = 'ARNDCQEGHILKMFPSTWYVBZX*';
const BLOSUM62_ROWS = [
  [4, -1, -2, -2, 0, -1, -1, 0, -2, -1, -1, -1, -1, -2, -1, 1, 0, -3, -2, 0, -2, -1, 0, -4],
  [-1, 5, 0, -2, -3, 1, 0, -2, 0, -3, -2, 2, -1, -3, -2, -1, -1, -3, -2, -3, -1, 0, -1, -4],
  [-2, 0, 6, 1, -3, 0, 0, 0, 1, -3, -3, 0, -2, -3, -2, 1, 0, -4, -2, -3, 3, 0, -1, -4],
  [-2, -2, 1, 6, -3, 0, 2, -1, -1, -3, -4, -1, -3, -3, -1, 0, -1, -4, -3, -3, 4, 1, -1, -4],
  [0, -3, -3, -3, 9, -3, -4, -3, -3, -1, -1, -3, -1, -2, -3, -1, -1, -2, -2, -1, -3, -3, -2, -4],
  [-1, 1, 0, 0, -3, 5, 2, -2, 0, -3, -2, 1, 0, -3, -1, 0, -1, -2, -1, -2, 0, 3, -1, -4],
  [-1, 0, 0, 2, -4, 2, 5, -2, 0, -3, -3, 1, -2, -3, -1, 0, -1, -3, -2, -2, 1, 4, -1, -4],
  [0, -2, 0, -1, -3, -2, -2, 6, -2, -4, -4, -2, -3, -3, -2, 0, -2, -2, -3, -3, -1, -2, -1, -4],
  [-2, 0, 1, -1, -3, 0, 0, -2, 8, -3, -3, -1, -2, -1, -2, -1, -2, -2, 2, -3, 0, 0, -1, -4],
  [-1, -3, -3, -3, -1, -3, -3, -4, -3, 4, 2, -3, 1, 0, -3, -2, -1, -3, -1, 3, -3, -3, -1, -4],
  [-1, -2, -3, -4, -1, -2, -3, -4, -3, 2, 4, -2, 2, 0, -3, -2, -1, -2, -1, 1, -4, -3, -1, -4],
  [-1, 2, 0, -1, -3, 1, 1, -2, -1, -3, -2, 5, -1, -3, -1, 0, -1, -3, -2, -2, 0, 1, -1, -4],
  [-1, -1, -2, -3, -1, 0, -2, -3, -2, 1, 2, -1, 5, 0, -2, -1, -1, -1, -1, 1, -3, -1, -1, -4],
  [-2, -3, -3, -3, -2, -3, -3, -3, -1, 0, 0, -3, 0, 6, -4, -2, -2, 1, 3, -1, -3, -3, -1, -4],
  [-1, -2, -2, -1, -3, -1, -1, -2, -2, -3, -3, -1, -2, -4, 7, -1, -1, -4, -3, -2, -2, -1, -2, -4],
  [1, -1, 1, 0, -1, 0, 0, 0, -1, -2, -2, 0, -1, -2, -1, 4, 1, -3, -2, -2, 0, 0, 0, -4],
  [0, -1, 0, -1, -1, -1, -1, -2, -2, -1, -1, -1, -1, -2, -1, 1, 5, -2, -2, 0, -1, -1, 0, -4],
  [-3, -3, -4, -4, -2, -2, -3, -2, -2, -3, -2, -3, -1, 1, -4, -3, -2, 11, 2, -3, -4, -3, -2, -4],
  [-2, -2, -2, -3, -2, -1, -2, -3, 2, -1, -1, -2, -1, 3, -3, -2, -2, 2, 7, -1, -3, -2, -1, -4],
  [0, -3, -3, -3, -1, -2, -2, -3, -3, 3, 1, -2, 1, -1, -2, -2, 0, -3, -1, 4, -3, -2, -1, -4],
  [-2, -1, 3, 4, -3, 0, 1, -1, 0, -3, -4, 0, -3, -3, -2, 0, -1, -4, -3, -3, 4, 1, -1, -4],
  [-1, 0, 0, 1, -3, 3, 4, -2, 0, -3, -3, 1, -1, -3, -1, 0, -1, -3, -2, -2, 1, 4, -1, -4],
  [0, -1, -1, -1, -2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -2, 0, 0, -2, -1, -1, -1, -1, -1, -4],
  [-4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, 1],
];

// Selenocysteine, pyrrolysine and the I/L ambiguity code have no BLOSUM62 row of their own.
const LETTER_ALIASES = { U: 'C', O: 'K', J: 'L' };

// Row-major 26 × 26 lookup indexed by (charCode - 65); letters outside A-Z score as X.
const BLOSUM62_TABLE = buildBlosumTable();

// ChimeraX's default secondary-structure matrix (helix, strand, other).
const SS_SCORES = { HH: 6, EE: 6, CC: 4, HE: -9, EH: -9, HC: -6, CH: -6, EC: -6, CE: -6 };
const SS_GAP_OPEN = { H: 18, E: 18, C: 6 };

// Cells above this bound would need more than ~20 MB of traceback; callers fall back to
// residue numbering for alignments this large.
export const MAX_ALIGNMENT_CELLS = 20e6;

function buildBlosumTable() {
  const table = new Int8Array(26 * 26);
  const indexOf = (letter) => {
    const index = BLOSUM_ORDER.indexOf(LETTER_ALIASES[letter] ?? letter);
    return index >= 0 ? index : BLOSUM_ORDER.indexOf('X');
  };
  for (let a = 0; a < 26; a += 1) {
    for (let b = 0; b < 26; b += 1) {
      table[a * 26 + b] = BLOSUM62_ROWS[indexOf(String.fromCharCode(65 + a))][indexOf(String.fromCharCode(65 + b))];
    }
  }
  return table;
}

export function blosum62(a, b) {
  return BLOSUM62_TABLE[letterIndex(a) * 26 + letterIndex(b)];
}

function letterIndex(letter) {
  const code = String(letter).toUpperCase().charCodeAt(0) - 65;
  return code >= 0 && code < 26 ? code : 23; // 'X'
}

function normalizeSS(value) {
  return value === 'H' || value === 'E' ? value : 'C';
}

// seqA and seqB are strings (or arrays) of one-letter codes; ssA and ssB optionally give one
// secondary-structure letter (H, E or anything else for coil) per residue.
// Returns the matched index pairs plus identity, score and gapped alignment rows.
export function alignSequences(seqA, seqB, options = {}) {
  const a = Array.isArray(seqA) ? seqA.join('') : String(seqA ?? '');
  const b = Array.isArray(seqB) ? seqB.join('') : String(seqB ?? '');
  const n = a.length;
  const m = b.length;
  const empty = { pairs: [], score: 0, identity: 0, identical: 0, rowA: '', rowB: '', truncated: false };
  if (!n || !m) return empty;
  if (n * m > (options.maxCells ?? MAX_ALIGNMENT_CELLS)) return { ...empty, truncated: true };

  const nucleic = options.kind === 'nucleic';
  const useSS = !nucleic && options.ssA && options.ssB && options.ssFraction !== 0;
  const ssFraction = useSS ? (options.ssFraction ?? 0.3) : 0;
  const ssA = useSS ? Array.from(options.ssA, normalizeSS) : null;
  const ssB = useSS ? Array.from(options.ssB, normalizeSS) : null;
  const extend = options.gapExtend ?? 1;
  const defaultOpen = options.gapOpen ?? (nucleic ? 10 : 12);
  const openA = new Float64Array(n + 1);
  const openB = new Float64Array(m + 1);
  for (let i = 1; i <= n; i += 1) openA[i] = useSS ? SS_GAP_OPEN[ssA[i - 1]] : defaultOpen;
  for (let j = 1; j <= m; j += 1) openB[j] = useSS ? SS_GAP_OPEN[ssB[j - 1]] : defaultOpen;

  const codesA = new Uint8Array(n);
  const codesB = new Uint8Array(m);
  for (let i = 0; i < n; i += 1) codesA[i] = letterIndex(a[i]);
  for (let j = 0; j < m; j += 1) codesB[j] = letterIndex(b[j]);
  const substitution = nucleic
    ? (i, j) => (sameNucleotide(a[i], b[j]) ? 5 : -4)
    : (i, j) => {
      const base = BLOSUM62_TABLE[codesA[i] * 26 + codesB[j]];
      return ssFraction ? (1 - ssFraction) * base + ssFraction * SS_SCORES[ssA[i] + ssB[j]] : base;
    };

  // Rolling score rows for the match (M), gap-in-B (X: a[i] unmatched) and gap-in-A (Y: b[j]
  // unmatched) states; the full traceback is packed into one byte per cell.
  const width = m + 1;
  const trace = new Uint8Array((n + 1) * width);
  let prevM = new Float64Array(width).fill(-Infinity);
  let prevX = new Float64Array(width).fill(-Infinity);
  let prevY = new Float64Array(width).fill(0);
  prevM[0] = 0;
  prevY[0] = -Infinity;
  let curM = new Float64Array(width);
  let curX = new Float64Array(width);
  let curY = new Float64Array(width);
  let best = { score: -Infinity, i: 0, j: 0, state: 0 };
  const consider = (score, i, j, state) => {
    if (score > best.score) best = { score, i, j, state };
  };

  for (let i = 1; i <= n; i += 1) {
    curM[0] = -Infinity;
    curX[0] = 0;
    curY[0] = -Infinity;
    const row = i * width;
    for (let j = 1; j <= m; j += 1) {
      let bits = 0;
      let diagonal = prevM[j - 1];
      if (prevX[j - 1] > diagonal) {
        diagonal = prevX[j - 1];
        bits = 1;
      }
      if (prevY[j - 1] > diagonal) {
        diagonal = prevY[j - 1];
        bits = 2;
      }
      curM[j] = diagonal + substitution(i - 1, j - 1);

      const openX = prevM[j] - openA[i];
      const extendX = prevX[j] - extend;
      if (extendX > openX) {
        curX[j] = extendX;
        bits |= 4;
      } else {
        curX[j] = openX;
      }

      const openY = curM[j - 1] - openB[j];
      const extendY = curY[j - 1] - extend;
      if (extendY > openY) {
        curY[j] = extendY;
        bits |= 8;
      } else {
        curY[j] = openY;
      }
      trace[row + j] = bits;
    }
    // Trailing gaps are free: the alignment may end anywhere on the last column or last row.
    consider(curM[m], i, m, 0);
    consider(curX[m], i, m, 1);
    consider(curY[m], i, m, 2);
    if (i === n) {
      for (let j = 1; j <= m; j += 1) {
        consider(curM[j], n, j, 0);
        consider(curX[j], n, j, 1);
        consider(curY[j], n, j, 2);
      }
    }
    [prevM, curM] = [curM, prevM];
    [prevX, curX] = [curX, prevX];
    [prevY, curY] = [curY, prevY];
  }

  const pairs = [];
  let { i, j, state } = best;
  const tailA = a.slice(i);
  const tailB = b.slice(j);
  const columnsA = [];
  const columnsB = [];
  while (i > 0 && j > 0) {
    const bits = trace[i * width + j];
    if (state === 0) {
      pairs.push([i - 1, j - 1]);
      columnsA.push(a[i - 1]);
      columnsB.push(b[j - 1]);
      state = bits & 3;
      i -= 1;
      j -= 1;
    } else if (state === 1) {
      columnsA.push(a[i - 1]);
      columnsB.push('-');
      state = bits & 4 ? 1 : 0;
      i -= 1;
    } else {
      columnsA.push('-');
      columnsB.push(b[j - 1]);
      state = bits & 8 ? 2 : 0;
      j -= 1;
    }
  }
  pairs.reverse();
  const headA = a.slice(0, i);
  const headB = b.slice(0, j);
  const rowA = `${headA}${'-'.repeat(headB.length)}${columnsA.reverse().join('')}${tailA}${'-'.repeat(tailB.length)}`;
  const rowB = `${'-'.repeat(headA.length)}${headB}${columnsB.reverse().join('')}${'-'.repeat(tailA.length)}${tailB}`;
  let identical = 0;
  for (const [x, y] of pairs) {
    if (nucleic ? sameNucleotide(a[x], b[y]) : a[x].toUpperCase() === b[y].toUpperCase()) identical += 1;
  }
  return {
    pairs,
    score: best.score,
    identical,
    identity: pairs.length ? identical / pairs.length : 0,
    rowA,
    rowB,
    truncated: false,
  };
}

function sameNucleotide(x, y) {
  const a = x === 'T' ? 'U' : x;
  const b = y === 'T' ? 'U' : y;
  return a === b;
}
