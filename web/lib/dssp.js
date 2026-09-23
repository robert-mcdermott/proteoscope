import { parentResidue } from './residues.js';

export const DSSP_CARTOON = {
  H: 'helix',
  G: 'helix',
  I: 'helix',
  E: 'sheet',
  B: 'coil',
  T: 'turn',
  S: 'coil',
  '': 'coil',
};

const HBOND_COUPLING = 0.084 * 332;
const HBOND_MAX_ENERGY = -0.5;
const HBOND_MIN_ENERGY = -9.9;
const MIN_ATOM_DISTANCE = 0.5;
const MAX_PEPTIDE_BOND = 2.5;
const MAX_CA_DISTANCE = 9;
const BEND_COSINE = Math.cos(70 * Math.PI / 180);

const LOOP = 0;
const ALPHA_HELIX = 1;
const BETA_BRIDGE = 2;
const STRAND = 3;
const HELIX_3 = 4;
const HELIX_5 = 5;
const TURN = 6;
const BEND = 7;
const SS_CODES = ['', 'H', 'B', 'E', 'G', 'I', 'T', 'S'];

const PARALLEL = 1;
const ANTIPARALLEL = 2;

export function assignDSSP(residues) {
  const codes = new Array(residues.length).fill('');
  const backbone = collectBackbone(residues);
  if (!backbone.count) return codes;

  const hbonds = findHBonds(backbone);
  const turns = [3, 4, 5].map((span) => findTurns(backbone, hbonds, span));
  const ss = new Uint8Array(backbone.count);
  assignBetaStructure(backbone, hbonds, ss);
  assignHelices(ss, turns);
  assignTurnsAndBends(backbone, turns, ss);

  for (let index = 0; index < backbone.count; index += 1) {
    codes[backbone.source[index]] = SS_CODES[ss[index]];
  }
  return codes;
}

export function dsspSummary(codes) {
  const counts = { H: 0, G: 0, I: 0, E: 0, B: 0, T: 0, S: 0, '': 0 };
  for (const code of codes) {
    const key = code || '';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function collectBackbone(residues) {
  const chains = new Map();
  for (let index = 0; index < residues.length; index += 1) {
    const residue = residues[index];
    if (!hasProteinBackbone(residue)) continue;
    if (!chains.has(residue.chain)) chains.set(residue.chain, []);
    chains.get(residue.chain).push(index);
  }

  const source = [];
  for (const members of chains.values()) {
    for (const index of members) source.push(index);
  }
  const count = source.length;
  const n = new Float64Array(count * 3);
  const ca = new Float64Array(count * 3);
  const c = new Float64Array(count * 3);
  const o = new Float64Array(count * 3);
  const h = new Float64Array(count * 3);
  const hasO = new Uint8Array(count);
  const hasH = new Uint8Array(count);
  const chain = new Int32Array(count);
  const segment = new Int32Array(count);
  let chainIndex = -1;
  let segmentIndex = -1;

  for (let index = 0; index < count; index += 1) {
    const residue = residues[source[index]];
    const atoms = residue.backbone;
    const offset = index * 3;
    storePoint(n, offset, atoms.N);
    storePoint(ca, offset, atoms.CA);
    storePoint(c, offset, atoms.C);
    if (hasPosition(atoms.O)) {
      storePoint(o, offset, atoms.O);
      hasO[index] = 1;
    }

    if (index === 0 || residue.chain !== residues[source[index - 1]].chain) {
      chainIndex += 1;
      segmentIndex += 1;
    } else if (pointDistance(c, offset - 3, n, offset) > MAX_PEPTIDE_BOND) {
      segmentIndex += 1;
    } else if (hasO[index - 1] && parentResidue(residue.resName) !== 'PRO') {
      hasH[index] = placeAmideHydrogen(h, n, c, o, offset);
    }
    chain[index] = chainIndex;
    segment[index] = segmentIndex;
  }

  return { count, source, n, ca, c, o, h, hasO, hasH, chain, segment };
}

function hasProteinBackbone(residue) {
  const atoms = residue.backbone;
  return residue.kind === 'protein' && Boolean(atoms) &&
    hasPosition(atoms.N) && hasPosition(atoms.CA) && hasPosition(atoms.C);
}

function hasPosition(atom) {
  return Boolean(atom) && Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z);
}

function storePoint(target, offset, atom) {
  target[offset] = atom.x;
  target[offset + 1] = atom.y;
  target[offset + 2] = atom.z;
}

// The amide H sits 1 Å from N, parallel to the preceding carbonyl's O->C direction.
function placeAmideHydrogen(h, n, c, o, offset) {
  const previous = offset - 3;
  const dx = c[previous] - o[previous];
  const dy = c[previous + 1] - o[previous + 1];
  const dz = c[previous + 2] - o[previous + 2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(length > 0)) return 0;
  h[offset] = n[offset] + dx / length;
  h[offset + 1] = n[offset + 1] + dy / length;
  h[offset + 2] = n[offset + 2] + dz / length;
  return 1;
}

function pointDistance(a, aOffset, b, bOffset) {
  const dx = a[aOffset] - b[bOffset];
  const dy = a[aOffset + 1] - b[bOffset + 1];
  const dz = a[aOffset + 2] - b[bOffset + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function findHBonds(backbone) {
  const { count, ca, hasH, hasO } = backbone;
  const hbonds = {
    first: new Int32Array(count).fill(-1),
    firstEnergy: new Float64Array(count),
    second: new Int32Array(count).fill(-1),
    secondEnergy: new Float64Array(count),
  };
  const grid = buildGrid(ca, count, MAX_CA_DISTANCE);
  const { nx, ny, nz, start, items } = grid;
  const limit = MAX_CA_DISTANCE * MAX_CA_DISTANCE;

  for (let i = 0; i < count; i += 1) {
    const offset = i * 3;
    const x = ca[offset];
    const y = ca[offset + 1];
    const z = ca[offset + 2];
    const cellX = grid.cellX[i];
    const cellY = grid.cellY[i];
    const cellZ = grid.cellZ[i];
    for (let gz = Math.max(0, cellZ - 1); gz <= Math.min(nz - 1, cellZ + 1); gz += 1) {
      for (let gy = Math.max(0, cellY - 1); gy <= Math.min(ny - 1, cellY + 1); gy += 1) {
        for (let gx = Math.max(0, cellX - 1); gx <= Math.min(nx - 1, cellX + 1); gx += 1) {
          const cell = gx + nx * (gy + ny * gz);
          for (let slot = start[cell]; slot < start[cell + 1]; slot += 1) {
            const j = items[slot];
            if (j <= i) continue;
            const dx = ca[j * 3] - x;
            const dy = ca[j * 3 + 1] - y;
            const dz = ca[j * 3 + 2] - z;
            if (dx * dx + dy * dy + dz * dz >= limit) continue;
            if (hasH[i] && hasO[j]) recordHBond(hbonds, i, j, hbondEnergy(backbone, i, j));
            // DSSP never pairs an N-H with the carbonyl of the directly preceding residue.
            if (hasH[j] && hasO[i] && j !== i + 1) recordHBond(hbonds, j, i, hbondEnergy(backbone, j, i));
          }
        }
      }
    }
  }
  return hbonds;
}

function buildGrid(points, count, spacing) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let offset = 0; offset < count * 3; offset += 3) {
    minX = Math.min(minX, points[offset]);
    minY = Math.min(minY, points[offset + 1]);
    minZ = Math.min(minZ, points[offset + 2]);
    maxX = Math.max(maxX, points[offset]);
    maxY = Math.max(maxY, points[offset + 1]);
    maxZ = Math.max(maxZ, points[offset + 2]);
  }

  const maxCells = Math.max(4096, count * 16);
  let size = spacing;
  let nx = 1;
  let ny = 1;
  let nz = 1;
  for (;;) {
    nx = Math.floor((maxX - minX) / size) + 1;
    ny = Math.floor((maxY - minY) / size) + 1;
    nz = Math.floor((maxZ - minZ) / size) + 1;
    if (nx * ny * nz <= maxCells) break;
    size *= 2;
  }

  const cellX = new Int32Array(count);
  const cellY = new Int32Array(count);
  const cellZ = new Int32Array(count);
  const cellOf = new Int32Array(count);
  const start = new Int32Array(nx * ny * nz + 1);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    cellX[index] = Math.floor((points[offset] - minX) / size);
    cellY[index] = Math.floor((points[offset + 1] - minY) / size);
    cellZ[index] = Math.floor((points[offset + 2] - minZ) / size);
    cellOf[index] = cellX[index] + nx * (cellY[index] + ny * cellZ[index]);
    start[cellOf[index] + 1] += 1;
  }
  for (let cell = 0; cell < nx * ny * nz; cell += 1) start[cell + 1] += start[cell];

  const fill = start.slice(0, -1);
  const items = new Int32Array(count);
  for (let index = 0; index < count; index += 1) {
    items[fill[cellOf[index]]] = index;
    fill[cellOf[index]] += 1;
  }
  return { nx, ny, nz, start, items, cellX, cellY, cellZ };
}

// Kabsch & Sander electrostatic model: partial charges ±0.42e on C,O and ±0.20e on N,H.
function hbondEnergy(backbone, donor, acceptor) {
  const { n, h, c, o } = backbone;
  const d = donor * 3;
  const a = acceptor * 3;
  const distanceNO = pointDistance(n, d, o, a);
  const distanceHC = pointDistance(h, d, c, a);
  const distanceHO = pointDistance(h, d, o, a);
  const distanceNC = pointDistance(n, d, c, a);
  if (
    distanceNO < MIN_ATOM_DISTANCE ||
    distanceHC < MIN_ATOM_DISTANCE ||
    distanceHO < MIN_ATOM_DISTANCE ||
    distanceNC < MIN_ATOM_DISTANCE
  ) {
    return HBOND_MIN_ENERGY;
  }
  const energy = HBOND_COUPLING * (1 / distanceNO + 1 / distanceHC - 1 / distanceHO - 1 / distanceNC);
  // DSSP rounds to 0.001 kcal/mol before comparing against the cutoff.
  return Math.max(HBOND_MIN_ENERGY, Math.round(energy * 1000) / 1000);
}

// Keeps each donor's two best acceptors; ties go to the lower index, matching DSSP's scan order.
function recordHBond(hbonds, donor, acceptor, energy) {
  const { first, firstEnergy, second, secondEnergy } = hbonds;
  if (energy < firstEnergy[donor] || (energy === firstEnergy[donor] && acceptor < first[donor])) {
    second[donor] = first[donor];
    secondEnergy[donor] = firstEnergy[donor];
    first[donor] = acceptor;
    firstEnergy[donor] = energy;
  } else if (energy < secondEnergy[donor] || (energy === secondEnergy[donor] && acceptor < second[donor])) {
    second[donor] = acceptor;
    secondEnergy[donor] = energy;
  }
}

function hasHBond(hbonds, donor, acceptor) {
  return (hbonds.first[donor] === acceptor && hbonds.firstEnergy[donor] < HBOND_MAX_ENERGY) ||
    (hbonds.second[donor] === acceptor && hbonds.secondEnergy[donor] < HBOND_MAX_ENERGY);
}

function findTurns(backbone, hbonds, span) {
  const { count, segment } = backbone;
  const turn = new Uint8Array(count);
  for (let index = 0; index + span < count; index += 1) {
    if (segment[index] === segment[index + span] && hasHBond(hbonds, index + span, index)) turn[index] = 1;
  }
  return turn;
}

function assignBetaStructure(backbone, hbonds, ss) {
  const ladders = linkBulges(findLadders(backbone, hbonds), backbone.chain);
  for (const ladder of ladders) {
    const code = ladder.bridges > 1 ? STRAND : BETA_BRIDGE;
    markStrand(ss, ladder.iStart, ladder.iEnd, code);
    markStrand(ss, ladder.jStart, ladder.jEnd, code);
  }
}

// As in DSSP, a residue in any ladder stays E even if it also forms an isolated bridge.
function markStrand(ss, start, end, code) {
  for (let index = start; index <= end; index += 1) {
    if (ss[index] !== STRAND) ss[index] = code;
  }
}

function findLadders(backbone, hbonds) {
  const { count, segment } = backbone;
  const ladders = [];
  const candidates = new Int32Array(8);
  let previous = [];
  let current = [];

  for (let i = 1; i + 4 < count; i += 1) {
    if (segment[i - 1] === segment[i + 1]) {
      fillBridgeCandidates(hbonds, i, candidates);
      for (let slot = 0; slot < candidates.length; slot += 1) {
        const j = candidates[slot];
        if (j < i + 3 || j + 1 >= count || (slot > 0 && j === candidates[slot - 1])) continue;
        if (segment[j - 1] !== segment[j + 1]) continue;
        const type = bridgeType(hbonds, i, j);
        if (!type) continue;

        const expected = type === PARALLEL ? j - 1 : j + 1;
        const link = previous.find((bridge) => bridge.type === type && bridge.j === expected);
        let ladder = link?.ladder;
        if (ladder) {
          ladder.iEnd = i;
          if (type === PARALLEL) ladder.jEnd = j;
          else ladder.jStart = j;
          ladder.bridges += 1;
        } else {
          ladder = { type, iStart: i, iEnd: i, jStart: j, jEnd: j, bridges: 1 };
          ladders.push(ladder);
        }
        current.push({ type, j, ladder });
      }
    }
    const swap = previous;
    previous = current;
    current = swap;
    current.length = 0;
  }
  return ladders;
}

// Every bridge partner j of i appears among the acceptors of i or i+1, possibly shifted by one.
function fillBridgeCandidates(hbonds, i, candidates) {
  candidates[0] = hbonds.first[i];
  candidates[1] = hbonds.second[i];
  candidates[2] = hbonds.first[i + 1];
  candidates[3] = hbonds.second[i + 1];
  for (let slot = 0; slot < 4; slot += 1) {
    candidates[slot + 4] = candidates[slot] < 0 ? -1 : candidates[slot] + 1;
  }
  candidates.sort();
}

// Parallel: Hbond(i-1, j) and Hbond(j, i+1), or Hbond(j-1, i) and Hbond(i, j+1).
// Antiparallel: Hbond(i, j) and Hbond(j, i), or Hbond(i-1, j+1) and Hbond(j-1, i+1).
// Hbond(a, b) means C=O of a accepts from N-H of b; hasHBond takes (donor, acceptor).
function bridgeType(hbonds, i, j) {
  if (
    (hasHBond(hbonds, i + 1, j) && hasHBond(hbonds, j, i - 1)) ||
    (hasHBond(hbonds, j + 1, i) && hasHBond(hbonds, i, j - 1))
  ) {
    return PARALLEL;
  }
  if (
    (hasHBond(hbonds, i + 1, j - 1) && hasHBond(hbonds, j + 1, i - 1)) ||
    (hasHBond(hbonds, j, i) && hasHBond(hbonds, i, j))
  ) {
    return ANTIPARALLEL;
  }
  return 0;
}

// Joins ladders of the same type separated by a beta bulge: a gap of at most one residue on
// one strand and at most four on the other (index differences < 3 and < 6, as in DSSP).
function linkBulges(ladders, chain) {
  ladders.sort((a, b) => a.iStart - b.iStart);
  for (let first = 0; first < ladders.length; first += 1) {
    const ladder = ladders[first];
    for (let second = first + 1; second < ladders.length; second += 1) {
      const other = ladders[second];
      if (other.iStart - ladder.iEnd >= 6) break;
      const iGap = forwardGap(ladder.iEnd, other.iStart);
      if (other.type !== ladder.type || iGap >= 6) continue;
      if (ladder.iEnd >= other.iStart && ladder.iStart <= other.iEnd) continue;
      if (chain[Math.min(ladder.iStart, other.iStart)] !== chain[Math.max(ladder.iEnd, other.iEnd)]) continue;
      if (chain[Math.min(ladder.jStart, other.jStart)] !== chain[Math.max(ladder.jEnd, other.jEnd)]) continue;

      const jGap = ladder.type === PARALLEL
        ? forwardGap(ladder.jEnd, other.jStart)
        : forwardGap(other.jEnd, ladder.jStart);
      if (!((jGap < 6 && iGap < 3) || jGap < 3)) continue;

      ladder.iEnd = other.iEnd;
      if (ladder.type === PARALLEL) ladder.jEnd = other.jEnd;
      else ladder.jStart = other.jStart;
      ladder.bridges += other.bridges;
      ladders.splice(second, 1);
      second -= 1;
    }
  }
  return ladders;
}

function forwardGap(from, to) {
  return to >= from ? to - from : Infinity;
}

function assignHelices(ss, turns) {
  markHelices(ss, turns[1], 4, ALPHA_HELIX, true);
  markHelices(ss, turns[0], 3, HELIX_3, false);
  markHelices(ss, turns[2], 5, HELIX_5, false);
}

// A minimal helix needs n-turns at i-1 and i. Alpha helices override strands; 3-10 and pi
// helices are only placed when every residue of the minimal helix is still free.
function markHelices(ss, turn, span, code, override) {
  for (let start = 1; start < ss.length; start += 1) {
    if (!turn[start - 1] || !turn[start]) continue;
    let free = true;
    for (let index = start; !override && free && index < start + span; index += 1) {
      free = ss[index] === LOOP || ss[index] === code;
    }
    if (!free) continue;
    for (let index = start; index < start + span; index += 1) ss[index] = code;
  }
}

function assignTurnsAndBends(backbone, turns, ss) {
  const { count, ca, segment } = backbone;
  for (let index = 0; index < count; index += 1) {
    if (ss[index] !== LOOP) continue;
    if (insideTurn(turns, index)) ss[index] = TURN;
    else if (isBend(ca, segment, index)) ss[index] = BEND;
  }
}

function insideTurn(turns, index) {
  for (let span = 3; span <= 5; span += 1) {
    const turn = turns[span - 3];
    for (let back = 1; back < span && back <= index; back += 1) {
      if (turn[index - back]) return true;
    }
  }
  return false;
}

// Bend: the CA(i-2)->CA(i) and CA(i)->CA(i+2) directions differ by more than 70 degrees.
function isBend(ca, segment, index) {
  if (index < 2 || index + 2 >= segment.length || segment[index - 2] !== segment[index + 2]) return false;
  const before = (index - 2) * 3;
  const center = index * 3;
  const after = (index + 2) * 3;
  const ux = ca[center] - ca[before];
  const uy = ca[center + 1] - ca[before + 1];
  const uz = ca[center + 2] - ca[before + 2];
  const vx = ca[after] - ca[center];
  const vy = ca[after + 1] - ca[center + 1];
  const vz = ca[after + 2] - ca[center + 2];
  const lengths = (ux * ux + uy * uy + uz * uz) * (vx * vx + vy * vy + vz * vz);
  const cosine = lengths > 0 ? (ux * vx + uy * vy + uz * vz) / Math.sqrt(lengths) : 0;
  return cosine < BEND_COSINE;
}
