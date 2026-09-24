import assert from 'node:assert/strict';
import test from 'node:test';

import { DSSP_CARTOON, assignDSSP, dsspSummary } from './dssp.js';
import { residueKindFromName } from './residues.js';
import { TIME_SCALE, exampleFiles, examplePDB } from './test-data.mjs';

const ALPHA = [-57, -47];
const BACKBONE_NAMES = new Set(['N', 'CA', 'C', 'O']);
const HELIX_CODES = new Set(['H', 'G', 'I']);
const HELIX_SEGMENT = ['', ...repeat('H', 8), ''];

test('ideal alpha helix is H except for its two terminal residues', () => {
  const residues = buildBackbone(20, ALPHA).map((points, index) => makeResidue('A', index + 1, 'ALA', points));
  assert.deepEqual(assignDSSP(residues), ['', ...repeat('H', 18), '']);
});

test('chain boundaries and chain breaks stop turns and helices', () => {
  const twoChains = buildBackbone(20, ALPHA)
    .map((points, index) => makeResidue(index < 10 ? 'A' : 'B', index + 1, 'ALA', points));
  assert.deepEqual(assignDSSP(twoChains), [...HELIX_SEGMENT, ...HELIX_SEGMENT]);

  const missingResidue = buildBackbone(21, ALPHA)
    .map((points, index) => makeResidue('A', index + 1, 'ALA', points))
    .filter((residue) => residue.resSeq !== 11);
  assert.deepEqual(assignDSSP(missingResidue), [...HELIX_SEGMENT, ...HELIX_SEGMENT]);

  const separated = buildBackbone(20, ALPHA)
    .map((points, index) => makeResidue('A', index + 1, 'ALA', index < 10 ? points : shiftPoints(points, 40)));
  assert.deepEqual(assignDSSP(separated), [...HELIX_SEGMENT, ...HELIX_SEGMENT]);
});

test('non-protein and incomplete residues keep their positions with empty codes', () => {
  const backbone = buildBackbone(13, ALPHA);
  const residues = [
    ...backbone.slice(0, 12).map((points, index) => makeResidue('A', index + 1, 'ALA', points)),
    makeResidue('A', 13, 'GLY', { N: backbone[12].N, C: backbone[12].C }),
    makeResidue('A', 14, 'GLY', { N: [30, 0, 0], CA: [Number.NaN, 0, 0], C: [32, 0, 0] }),
    makeResidue('A', 401, 'HEM', { FE: [5, 5, 5] }),
    makeResidue('A', 501, 'HOH', { O: [9, 9, 9] }),
    makeResidue('B', 1, 'DA', { P: [20, 0, 0] }),
  ];
  assert.deepEqual(assignDSSP(residues), ['', ...repeat('H', 10), '', '', '', '', '', '']);
  assert.deepEqual(assignDSSP([]), []);
});

test('proline cannot donate the i-4 hydrogen bond that starts a helix', () => {
  const residues = buildBackbone(20, ALPHA)
    .map((points, index) => makeResidue('A', index + 1, index === 5 ? 'PRO' : 'ALA', points));
  const codes = assignDSSP(residues);
  assert.notEqual(codes[1], 'H');
  assert.notEqual(codes[2], 'H');
  assert.deepEqual(codes.slice(3, 19), repeat('H', 16));
});

test('summary counts every code and the cartoon map covers all codes', () => {
  assert.deepEqual(dsspSummary(['H', 'H', 'E', '', 'T', 'S']), { H: 2, G: 0, I: 0, E: 1, B: 0, T: 1, S: 1, '': 1 });
  for (const code of ['H', 'G', 'I', 'E', 'B', 'T', 'S', '']) {
    assert.ok(['helix', 'sheet', 'turn', 'coil'].includes(DSSP_CARTOON[code]));
  }
});

// wwPDB HELIX records span the DSSP helix plus its capping residue on each side (the first
// C=O acceptor and the last N-H donor), which DSSP itself never labels as helix. The cap-adjusted
// score also credits a record's first and last residue when the residue inside them is helical.
for (const name of ['1ycr', '4hhb', '1m17', '3og7']) {
  test(`agrees with the helix and sheet records of ${name}`, (t) => {
    const { residues, helices, sheets } = parsePDB(examplePDB(name));
    const codes = assignDSSP(residues);
    assert.equal(codes.length, residues.length);

    const helix = helixAgreement(residues, codes, helices);
    const strand = strandAgreement(residues, codes, sheets);
    t.diagnostic(
      `${name}: helix ${formatScore(helix.raw)} (cap-adjusted ${formatScore(helix.capAdjusted)}, ${helix.count} residues), ` +
      `strand ${formatScore(strand.score)} (${strand.count} residues), ${JSON.stringify(dsspSummary(codes))}`,
    );
    if (helix.count) assert.ok(helix.capAdjusted >= 0.8, `${name} helix agreement ${helix.capAdjusted}`);
    if (strand.count) assert.ok(strand.score >= 0.75, `${name} strand agreement ${strand.score}`);
  });
}

test('performance on the largest bundled structure and a tiled 10,000-residue assembly', (t) => {
  let largest = null;
  for (const name of exampleFiles()) {
    const { residues } = parsePDB(examplePDB(name));
    const count = countProtein(residues);
    if (!largest || count > largest.count) largest = { name, residues, count };
  }

  const single = timeAssignment(largest.residues);
  t.diagnostic(`${largest.name}: ${largest.count} protein residues, first run ${single.first.toFixed(1)} ms, best ${single.best.toFixed(1)} ms`);

  const tiled = tileResidues(largest.residues, 10000);
  const timing = timeAssignment(tiled);
  t.diagnostic(`tiled ${largest.name}: ${countProtein(tiled)} protein residues, first run ${timing.first.toFixed(1)} ms, best ${timing.best.toFixed(1)} ms`);
  assert.ok(countProtein(tiled) >= 10000);
  assert.ok(timing.best < 150 * TIME_SCALE, `10k residues took ${timing.best} ms`);
});

function repeat(code, count) {
  return new Array(count).fill(code);
}

function buildBackbone(count, [phi, psi], omega = 180) {
  const residues = [];
  let n = [0, 0, 0];
  let ca = [1.458, 0, 0];
  let c = placeAtom([0, 1, 0], n, ca, 1.525, 111.2, phi);
  for (let index = 0; index < count; index += 1) {
    residues.push({ N: n, CA: ca, C: c, O: placeAtom(n, ca, c, 1.231, 120.5, psi + 180) });
    const nextN = placeAtom(n, ca, c, 1.329, 116.2, psi);
    const nextCA = placeAtom(ca, c, nextN, 1.458, 121.7, omega);
    const nextC = placeAtom(c, nextN, nextCA, 1.525, 111.2, phi);
    n = nextN;
    ca = nextCA;
    c = nextC;
  }
  return residues;
}

// NeRF: places d so that |cd| = length, angle(b, c, d) = angle and dihedral(a, b, c, d) = torsion.
function placeAtom(a, b, c, length, angleDegrees, torsionDegrees) {
  const angle = angleDegrees * Math.PI / 180;
  const torsion = torsionDegrees * Math.PI / 180;
  const bc = normalize(subtract(c, b));
  const normal = normalize(cross(subtract(b, a), bc));
  const inPlane = cross(normal, bc);
  const along = -length * Math.cos(angle);
  const up = length * Math.sin(angle) * Math.cos(torsion);
  const out = length * Math.sin(angle) * Math.sin(torsion);
  return [0, 1, 2].map((axis) => c[axis] + along * bc[axis] + up * inPlane[axis] + out * normal[axis]);
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function shiftPoints(points, dx) {
  return Object.fromEntries(Object.entries(points).map(([name, [x, y, z]]) => [name, [x + dx, y, z]]));
}

function makeResidue(chain, resSeq, resName, points) {
  const residue = {
    key: `${chain}:${resSeq}:${resName}`,
    chain,
    resName,
    resSeq,
    iCode: '',
    kind: residueKindFromName(resName),
    atoms: [],
    backbone: {},
  };
  for (const [name, [x, y, z]] of Object.entries(points)) {
    const atom = { name, element: name.slice(0, 1), resName, chain, resSeq, x, y, z };
    residue.atoms.push(atom);
    if (BACKBONE_NAMES.has(name)) residue.backbone[name] = atom;
  }
  return residue;
}

function parsePDB(text) {
  const residues = new Map();
  const helices = [];
  const sheets = [];
  for (const line of text.split(/\r?\n/)) {
    const record = line.slice(0, 6);
    if (record === 'ENDMDL') break;
    if (record === 'HELIX ') helices.push(readRange(line, 19, 21, 31, 33));
    if (record === 'SHEET ') sheets.push(readRange(line, 21, 22, 32, 33));
    if (record !== 'ATOM  ' && record !== 'HETATM') continue;
    const altLoc = line.slice(16, 17);
    if (altLoc !== ' ' && altLoc !== 'A') continue;

    const atom = {
      name: line.slice(12, 16).trim(),
      resName: line.slice(17, 20).trim(),
      chain: line.slice(21, 22).trim() || '_',
      resSeq: Number.parseInt(line.slice(22, 26), 10),
      iCode: line.slice(26, 27).trim(),
      x: Number.parseFloat(line.slice(30, 38)),
      y: Number.parseFloat(line.slice(38, 46)),
      z: Number.parseFloat(line.slice(46, 54)),
    };
    const key = `${atom.chain}:${atom.resSeq}${atom.iCode}:${atom.resName}`;
    if (!residues.has(key)) {
      residues.set(key, {
        key,
        chain: atom.chain,
        resName: atom.resName,
        resSeq: atom.resSeq,
        iCode: atom.iCode,
        kind: residueKindFromName(atom.resName),
        atoms: [],
        backbone: {},
      });
    }
    const residue = residues.get(key);
    residue.atoms.push(atom);
    if (BACKBONE_NAMES.has(atom.name)) residue.backbone[atom.name] ??= atom;
  }
  const sorted = [...residues.values()].sort((a, b) => (
    a.chain.localeCompare(b.chain) || compareSequence(a.resSeq, a.iCode, b.resSeq, b.iCode)
  ));
  return { residues: sorted, helices, sheets };
}

function readRange(line, chainColumn, seqColumn, endChainColumn, endSeqColumn) {
  return {
    chain: line.slice(chainColumn, chainColumn + 1).trim() || '_',
    start: Number.parseInt(line.slice(seqColumn, seqColumn + 4), 10),
    startICode: line.slice(seqColumn + 4, seqColumn + 5).trim(),
    endChain: line.slice(endChainColumn, endChainColumn + 1).trim() || '_',
    end: Number.parseInt(line.slice(endSeqColumn, endSeqColumn + 4), 10),
    endICode: line.slice(endSeqColumn + 4, endSeqColumn + 5).trim(),
  };
}

function compareSequence(seqA, iCodeA, seqB, iCodeB) {
  return seqA - seqB || iCodeA.localeCompare(iCodeB);
}

function rangeMembers(residues, range) {
  const members = [];
  residues.forEach((residue, index) => {
    if (residue.kind !== 'protein' || residue.chain !== range.chain) return;
    if (compareSequence(residue.resSeq, residue.iCode, range.start, range.startICode) < 0) return;
    if (compareSequence(residue.resSeq, residue.iCode, range.end, range.endICode) > 0) return;
    members.push(index);
  });
  return members;
}

function helixAgreement(residues, codes, ranges) {
  const annotated = new Set();
  const assigned = new Set();
  const capAdjusted = new Set();
  for (const range of ranges) {
    const members = rangeMembers(residues, range);
    members.forEach((index, position) => {
      annotated.add(index);
      const inward = position === 0 ? members[1] : position === members.length - 1 ? members[position - 1] : undefined;
      if (HELIX_CODES.has(codes[index])) assigned.add(index);
      if (HELIX_CODES.has(codes[index]) || HELIX_CODES.has(codes[inward])) capAdjusted.add(index);
    });
  }
  return {
    count: annotated.size,
    raw: assigned.size / annotated.size,
    capAdjusted: capAdjusted.size / annotated.size,
  };
}

function strandAgreement(residues, codes, ranges) {
  const annotated = new Set(ranges.flatMap((range) => rangeMembers(residues, range)));
  let score = 0;
  for (const index of annotated) {
    if (codes[index] === 'E') score += 1;
    else if (codes[index] === 'B') score += 0.5;
  }
  return { count: annotated.size, score: score / annotated.size };
}

function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}

function countProtein(residues) {
  return residues.filter((residue) => residue.kind === 'protein').length;
}

function timeAssignment(residues, runs = 5) {
  let first = 0;
  let best = Infinity;
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    assignDSSP(residues);
    const elapsed = performance.now() - start;
    if (run === 0) first = elapsed;
    best = Math.min(best, elapsed);
  }
  return { first, best };
}

function tileResidues(residues, target) {
  const copies = Math.ceil(target / countProtein(residues));
  const side = Math.ceil(Math.cbrt(copies));
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const residue of residues) {
    for (const atom of residue.atoms) {
      [atom.x, atom.y, atom.z].forEach((value, axis) => {
        low[axis] = Math.min(low[axis], value);
        high[axis] = Math.max(high[axis], value);
      });
    }
  }
  const spacing = 20 + Math.max(high[0] - low[0], high[1] - low[1], high[2] - low[2]);
  const tiled = [];
  for (let copy = 0; copy < copies; copy += 1) {
    const offset = [copy % side, Math.floor(copy / side) % side, Math.floor(copy / side / side)].map((cell) => cell * spacing);
    for (const residue of residues) {
      const shifted = { ...residue, chain: `${residue.chain}${copy}`, atoms: [], backbone: {} };
      for (const atom of residue.atoms) {
        const moved = { ...atom, x: atom.x + offset[0], y: atom.y + offset[1], z: atom.z + offset[2] };
        shifted.atoms.push(moved);
        if (residue.backbone[atom.name] === atom) shifted.backbone[atom.name] = moved;
      }
      tiled.push(shifted);
    }
  }
  return tiled.sort((a, b) => a.chain.localeCompare(b.chain) || compareSequence(a.resSeq, a.iCode, b.resSeq, b.iCode));
}
