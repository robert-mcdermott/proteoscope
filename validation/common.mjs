// Shared by run.mjs and the scripts that write the reference files: paths, the download cache,
// the structure-alignment cases and US-align's reading of PDB files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(ROOT, 'cache');
export const REFERENCE = join(ROOT, 'reference');
const USER_AGENT = 'Proteoscope-validation (+https://github.com/robert-mcdermott/proteoscope)';

export class MissingInput extends Error {}

export function readReference(name) {
  return JSON.parse(readFileSync(join(REFERENCE, name), 'utf8'));
}

// Readable but compact JSON: arrays of numbers or strings and short objects on one line, other
// objects one key per line.
export function writeReference(name, value) {
  const format = (item, indent) => {
    const inline = JSON.stringify(item);
    if (item === null || typeof item !== 'object' || inline.length <= 100) return inline;
    if (Array.isArray(item) && item.every((element) => element === null || typeof element !== 'object')) return inline;
    const inner = `${indent} `;
    if (Array.isArray(item)) return `[\n${item.map((element) => inner + format(element, inner)).join(',\n')}\n${indent}]`;
    const entries = Object.entries(item).filter(([, element]) => element !== undefined);
    return `{\n${entries.map(([key, element]) => `${inner}${JSON.stringify(key)}: ${format(element, inner)}`).join(',\n')}\n${indent}}`;
  };
  writeFileSync(join(REFERENCE, name), `${format(value, '')}\n`);
}

// Public inputs that are not in the repository are downloaded once into validation/cache/.
export async function download(name, url, { offline = false } = {}) {
  const path = join(CACHE, name);
  if (existsSync(path)) return readFileSync(path);
  if (offline) throw new MissingInput(`${name} is not in validation/cache/; run once without --offline`);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return bytes;
}

export async function pdbFile(id, options) {
  return (await download(`pdb/${id}.pdb`, `https://files.rcsb.org/download/${id}.pdb`, options)).toString('utf8');
}

/* ---------- Structure alignment (US-align) ---------- */

// Pairs of single chains (TM-align) and of complexes (MM-align, US-align -mm 1 -ter 1). A side is
// { pdb, chain } or { pdb, chains } (a subset), optionally moved by a seeded random rigid
// transform, and for complexes relabeled and reordered (`relabel`: old chain → new label, in the
// new order).
export const TM_CASES = [
  ['1UBQ vs itself', { pdb: '1UBQ', chain: 'A' }, { pdb: '1UBQ', chain: 'A' }],
  ['1UBQ vs a moved copy', { pdb: '1UBQ', chain: 'A' }, { pdb: '1UBQ', chain: 'A', move: 17 }],
  ['1AKE:A vs 4AKE:A (hinge)', { pdb: '1AKE', chain: 'A' }, { pdb: '4AKE', chain: 'A' }],
  ['4HHB:A vs 4HHB:B (α/β globin)', { pdb: '4HHB', chain: 'A' }, { pdb: '4HHB', chain: 'B' }],
  ['1MBN vs 1CPC:A (globin / phycocyanin)', { pdb: '1MBN', chain: 'A' }, { pdb: '1CPC', chain: 'A' }],
  ['1UBQ vs 1A5R (ubiquitin / SUMO-1)', { pdb: '1UBQ', chain: 'A' }, { pdb: '1A5R', chain: 'A' }],
  ['1TIM:A vs 1IGS (TIM barrels)', { pdb: '1TIM', chain: 'A' }, { pdb: '1IGS', chain: 'A' }],
  ['1TEN vs 1TIT (FN3 / Ig I27)', { pdb: '1TEN', chain: 'A' }, { pdb: '1TIT', chain: 'A' }],
  ['3CHY vs 1RCF (CheY / flavodoxin)', { pdb: '3CHY', chain: 'A' }, { pdb: '1RCF', chain: 'A' }],
  ['1ENH vs 1BDD (three-helix bundles)', { pdb: '1ENH', chain: 'A' }, { pdb: '1BDD', chain: 'A' }],
  ['2GB1 vs 1HZ6:A (protein G / L)', { pdb: '2GB1', chain: 'A' }, { pdb: '1HZ6', chain: 'A' }],
  ['1SBT vs 1CSE:E (subtilisins)', { pdb: '1SBT', chain: 'A' }, { pdb: '1CSE', chain: 'E' }],
  ['1UBQ vs 1MBN (unrelated)', { pdb: '1UBQ', chain: 'A' }, { pdb: '1MBN', chain: 'A' }],
  ['1TEN vs 1HHO:A (unrelated)', { pdb: '1TEN', chain: 'A' }, { pdb: '1HHO', chain: 'A' }],
  ['2PTC:I vs 1ENH (unrelated)', { pdb: '2PTC', chain: 'I' }, { pdb: '1ENH', chain: 'A' }],
  ['1EHZ vs 1FIR (tRNAs)', { pdb: '1EHZ', chain: 'A' }, { pdb: '1FIR', chain: 'A' }],
  ['1EHZ vs 1Y26 (tRNA / riboswitch)', { pdb: '1EHZ', chain: 'A' }, { pdb: '1Y26', chain: 'X' }],
];

export const MM_CASES = [
  ['4HHB vs 1HHO (hemoglobin T vs R)', { pdb: '4HHB' }, { pdb: '1HHO' }],
  ['1HHO vs 4HHB (reverse)', { pdb: '1HHO' }, { pdb: '4HHB' }],
  ['1AKE vs 4AKE (both chains)', { pdb: '1AKE' }, { pdb: '4AKE' }],
  ['2PTC vs 1TGS (protease–inhibitor)', { pdb: '2PTC' }, { pdb: '1TGS' }],
  ['1CSE vs 2PTC (subtilisin–eglin / trypsin–BPTI)', { pdb: '1CSE' }, { pdb: '2PTC' }],
  ['4HHB vs 1A3N (tetramers)', { pdb: '4HHB' }, { pdb: '1A3N' }],
  ['4HHB vs a moved, relabeled copy', { pdb: '4HHB' }, { pdb: '4HHB', move: 99, relabel: [['C', 'W'], ['A', 'X'], ['D', 'Y'], ['B', 'Z']] }],
  ['1CPC vs 4HHB (unrelated tetramers)', { pdb: '1CPC' }, { pdb: '4HHB' }],
  ['1URN vs 1DRZ (U1A–RNA / U1A–ribozyme)', { pdb: '1URN' }, { pdb: '1DRZ' }],
  ['1DRZ vs 1URN (reverse)', { pdb: '1DRZ' }, { pdb: '1URN' }],
  ['1TNF vs 1A8M (TNF trimers)', { pdb: '1TNF' }, { pdb: '1A8M' }],
  ['1ASY vs 1C0A (AspRS–tRNA)', { pdb: '1ASY' }, { pdb: '1C0A' }],
  ['1C0A vs 1ASY (reverse)', { pdb: '1C0A' }, { pdb: '1ASY' }],
  ['1ZDI vs 1ZDH (MS2 coat–RNA)', { pdb: '1ZDI' }, { pdb: '1ZDH' }],
  ['1A3N vs 4HHB:ABC (4 vs 3 chains)', { pdb: '1A3N' }, { pdb: '4HHB', chains: 'ABC' }],
  ['4HHB:ABC vs 1A3N (3 vs 4 chains)', { pdb: '4HHB', chains: 'ABC' }, { pdb: '1A3N' }],
];

const AMINO_ACIDS = {
  ALA: 'A', ASX: 'B', CYS: 'C', ASP: 'D', GLU: 'E', PHE: 'F', GLY: 'G', HIS: 'H', ILE: 'I', LYS: 'K', LEU: 'L',
  MET: 'M', MSE: 'M', MED: 'M', ASN: 'N', PYL: 'O', PRO: 'P', GLN: 'Q', ARG: 'R', SER: 'S', THR: 'T', SEC: 'U',
  VAL: 'V', TRP: 'W', TYR: 'Y', GLX: 'Z',
};

// The chains US-align reads from a PDB file by default: the first model, ATOM records only, the
// Cα of amino acids and the C3′ of nucleotides ("  A", " DA"), the first alternate location of
// each residue, and chains of at least 3 residues. Each chain keeps its ATOM lines for writing
// US-align's input.
export function usalignChains(text) {
  const chains = [];
  const firstAlternate = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (current && line.startsWith('END')) break;
    if (!line.startsWith('ATOM  ') || line.length < 54) continue;
    const resName = line.slice(17, 20);
    const nucleotide = resName[0] === ' ' && (resName[1] === 'D' || resName[1] === ' ');
    if (line.slice(12, 16) !== (nucleotide ? " C3'" : ' CA ')) continue;
    const residue = line.slice(21, 27);
    if (!firstAlternate.has(residue)) firstAlternate.set(residue, line[16]);
    else if (firstAlternate.get(residue) !== line[16]) continue;
    if (!current || current.id !== line[21]) {
      current = { id: line[21], coords: [], sequence: '', lines: [], nucleotides: 0 };
      chains.push(current);
    }
    current.coords.push(Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54)));
    current.sequence += nucleotide ? resName[2] : AMINO_ACIDS[resName] ?? 'X';
    current.nucleotides += nucleotide ? 1 : -1;
    current.lines.push(line);
  }
  return chains
    .filter((chain) => chain.coords.length >= 9)
    .map(({ nucleotides, ...chain }) => ({ ...chain, coords: Float64Array.from(chain.coords), kind: nucleotides > 0 ? 'nucleic' : 'protein' }));
}

// A reproducible rigid transform: a random unit quaternion and a translation within ±30 Å.
export function seededTransform(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const q = [random() - 0.5, random() - 0.5, random() - 0.5, random() - 0.5];
  const length = Math.hypot(...q);
  const [a, b, c, d] = q.map((value) => value / length);
  return {
    rotation: [
      a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c),
      2 * (b * c + a * d), a * a - b * b + c * c - d * d, 2 * (c * d - a * b),
      2 * (b * d - a * c), 2 * (c * d + a * b), a * a - b * b - c * c + d * d,
    ],
    translation: [random() * 60 - 30, random() * 60 - 30, random() * 60 - 30],
  };
}

// The chain moved (coordinates rounded to the PDB format's 3 decimals) and relabeled, with
// rewritten ATOM lines.
function movedChain(chain, transform, id = chain.id) {
  const { rotation: r, translation: t } = transform;
  const coords = new Float64Array(chain.coords.length);
  const lines = chain.lines.map((line, index) => {
    const [x, y, z] = chain.coords.subarray(index * 3, index * 3 + 3);
    const moved = [0, 1, 2].map((row) => Number((r[row * 3] * x + r[row * 3 + 1] * y + r[row * 3 + 2] * z + t[row]).toFixed(3)));
    coords.set(moved, index * 3);
    return `${line.slice(0, 21)}${id}${line.slice(22, 30)}${moved.map((value) => value.toFixed(3).padStart(8)).join('')}${line.slice(54)}`;
  });
  return { ...chain, id, coords, lines };
}

// The chains of one side of a case.
export function caseChains(text, side) {
  let chains = usalignChains(text);
  if (side.chain) chains = chains.filter((chain) => chain.id === side.chain);
  if (side.chains) chains = chains.filter((chain) => side.chains.includes(chain.id));
  if (!chains.length) throw new Error(`${side.pdb} has no chain ${side.chain ?? side.chains}`);
  if (side.move) {
    const transform = seededTransform(side.move);
    chains = side.relabel
      ? side.relabel.map(([from, to]) => movedChain(chains.find((chain) => chain.id === from), transform, to))
      : chains.map((chain) => movedChain(chain, transform));
  }
  return chains;
}

// Aligned index pairs [mobile, reference] from US-align's alignment rows.
export function pairsFromRows(mobileRow, referenceRow) {
  const pairs = [];
  let i = 0;
  let j = 0;
  for (let column = 0; column < mobileRow.length; column += 1) {
    const a = mobileRow[column];
    const b = referenceRow[column];
    if (a !== '-' && b !== '-') pairs.push([i, j]);
    if (a !== '-') i += 1;
    if (b !== '-') j += 1;
  }
  return pairs;
}
