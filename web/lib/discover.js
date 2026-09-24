// Discovery helpers for the "Find structures" panel: what a query is (UniProt accession, PDB ID,
// protein sequence or free text), PDBe's per-chain ranking grouped into entries, and the coverage
// of a protein by its structures. The searches themselves run in the Go server (search.go).

const ACCESSION = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-[0-9]+)?$/;
const PDB_ID = /^([0-9][A-Z0-9]{3}|PDB_[0-9A-Z]{8})$/;
const STANDARD = /^[ACDEFGHIKLMNPQRSTVWYX]+$/;
// FASTA records may also hold selenocysteine (U), pyrrolysine (O) and the ambiguity codes B and Z.
const EXTENDED = /^[ACDEFGHIKLMNPQRSTVWYXUOBZ]+$/;

// A pasted sequence is FASTA (a ">" header; the first record counts) or at least 25 residue
// letters written as one run, as numbered blocks (GenBank), or as blocks of one length (the last
// may be shorter); anything else is text. Words rarely qualify: most text has short words, words
// of different lengths, or letters outside the amino-acid alphabet (B, J, O, U, Z).
export function classifyQuery(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { kind: 'empty', value: '' };
  const upper = raw.toUpperCase();
  if (ACCESSION.test(upper)) return { kind: 'accession', value: upper };
  const afMatch = upper.match(/^AF-([A-Z0-9]+(?:-\d+)?)-F\d+(?:-MODEL_V\d+)?$/);
  if (afMatch && ACCESSION.test(afMatch[1])) return { kind: 'accession', value: afMatch[1] };
  if (PDB_ID.test(upper)) return { kind: 'pdb', value: upper.startsWith('PDB_') ? upper.toLowerCase() : upper };
  const fasta = raw.startsWith('>');
  const body = !fasta ? raw : /\n/.test(raw) ? firstFastaRecord(raw) : oneLineFastaSequence(raw);
  const residues = body.replace(/[\s\d]/g, '').replace(/\*$/, '').toUpperCase();
  if (fasta) return EXTENDED.test(residues) && residues.length >= 20 ? { kind: 'sequence', value: residues } : { kind: 'text', value: raw.replace(/\s+/g, ' ') };
  const blocks = body.replace(/\d/g, ' ').trim().split(/\s+/).filter(Boolean);
  const numbered = /\d/.test(body) && blocks.every((block) => block.length >= 5);
  const even = blocks.slice(0, -1).every((block) => block.length === blocks[0].length && block.length >= 5) && blocks.at(-1).length <= blocks[0].length;
  if (STANDARD.test(residues) && residues.length >= 25 && (blocks.length === 1 || numbered || even)) return { kind: 'sequence', value: residues };
  return { kind: 'text', value: raw.replace(/\s+/g, ' ') };
}

// The sequence lines of the first record of a FASTA file.
function firstFastaRecord(raw) {
  const lines = [];
  let headers = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().startsWith('>')) {
      headers += 1;
      if (headers > 1) break;
    } else {
      lines.push(line);
    }
  }
  return lines.join(' ');
}

// A FASTA record in a one-line field (the search box drops line breaks) runs the header into the
// sequence. The sequence is the last word (its lines merged into one), or the last words when it
// was written in blocks, each at least ten residue letters long.
function oneLineFastaSequence(raw) {
  const words = raw.split(/\s+/);
  let start = words.length;
  while (start > 1 && words[start - 1].length >= 10 && EXTENDED.test(words[start - 1].toUpperCase())) start -= 1;
  return words.slice(start).join(' ');
}

// PDBe lists chains, best first; the panel lists entries in that order, each with its chains,
// the widest UniProt range any of them covers, and the entry summary when one was fetched.
export function groupStructures(chains = [], entries = {}) {
  const byEntry = new Map();
  for (const chain of chains) {
    const id = String(chain.pdb ?? '').toUpperCase();
    if (!id) continue;
    let group = byEntry.get(id);
    if (!group) {
      group = {
        pdb: id,
        chains: [],
        method: chain.method ?? '',
        resolution: Number.isFinite(chain.resolution) ? chain.resolution : null,
        coverage: 0,
        unpStart: chain.unpStart,
        unpEnd: chain.unpEnd,
        summary: entries[id] ?? null,
      };
      byEntry.set(id, group);
    }
    if (!group.chains.includes(chain.chain)) group.chains.push(chain.chain);
    group.coverage = Math.max(group.coverage, Number(chain.coverage) || 0);
    if (Number.isFinite(chain.unpStart)) group.unpStart = Math.min(group.unpStart ?? chain.unpStart, chain.unpStart);
    if (Number.isFinite(chain.unpEnd)) group.unpEnd = Math.max(group.unpEnd ?? chain.unpEnd, chain.unpEnd);
  }
  return [...byEntry.values()];
}

export const STRUCTURE_SORTS = {
  rank: { label: 'PDBe rank', compare: () => 0 },
  resolution: { label: 'Resolution', compare: (a, b) => (a.resolution ?? Infinity) - (b.resolution ?? Infinity) },
  coverage: { label: 'Coverage', compare: (a, b) => b.coverage - a.coverage || (a.resolution ?? Infinity) - (b.resolution ?? Infinity) },
  newest: { label: 'Newest', compare: (a, b) => String(b.summary?.released ?? '').localeCompare(String(a.summary?.released ?? '')) },
};

export function sortStructures(groups, key = 'rank') {
  const sort = STRUCTURE_SORTS[key] ?? STRUCTURE_SORTS.rank;
  return groups.map((group, index) => ({ group, index }))
    .sort((a, b) => sort.compare(a.group, b.group) || a.index - b.index)
    .map((item) => item.group);
}

// How many entries cover each UniProt position (1-based; index 0 unused).
export function coverageDepth(groups, length) {
  const size = Math.max(0, Math.round(length) || 0);
  const depth = new Int32Array(size + 1);
  for (const group of groups) {
    const start = Math.max(1, group.unpStart ?? 1);
    const end = Math.min(size, group.unpEnd ?? 0);
    for (let position = start; position <= end; position += 1) depth[position] += 1;
  }
  return depth;
}

// "X-ray diffraction" → "X-ray"; "ELECTRON MICROSCOPY" → "EM"; "Solution NMR" → "NMR".
export function shortMethod(method) {
  const text = String(method ?? '').toLowerCase();
  if (!text) return '';
  if (text.includes('x-ray')) return 'X-ray';
  if (text.includes('electron microscopy') || text.includes('cryo')) return 'EM';
  if (text.includes('nmr')) return 'NMR';
  if (text.includes('neutron')) return 'Neutron';
  if (text.includes('electron crystallography')) return 'ED';
  return method.split(/[;,]/)[0].trim();
}

// A model's confidence as the provider reports it: pLDDT (0–100) or QMEANDisCo (0–1).
export function modelConfidence(model) {
  if (!Number.isFinite(model?.confidence)) return '';
  const type = model.confidenceType || (model.provider === 'AlphaFold DB' ? 'pLDDT' : 'confidence');
  const value = model.confidence <= 1 && type !== 'pLDDT' ? model.confidence.toFixed(2) : model.confidence.toFixed(1);
  return `${type} ${value}`;
}

// Opening a model: AlphaFold DB's canonical models go through the AlphaFold DB route (which brings
// PAE, MSA and AlphaMissense); every other model is downloaded by URL.
export function modelRequest(model, accession) {
  if (model?.provider === 'AlphaFold DB' && accession && model.id === `AF-${accession}-F1`) return { kind: 'fetch', id: accession };
  if (model?.url && model.fetchable !== false) return { kind: 'model', url: model.url };
  return null;
}
