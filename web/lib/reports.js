// Search-engine reports: MaxQuant, DIA-NN (TSV and Parquet), Spectronaut, FragPipe, mzTab and
// Proteome Discoverer tables, at the PSM/precursor, peptide or site level. readReport() streams a
// file (gigabytes are fine), keeps only the rows of the structure's proteins, and normalizes them;
// summarizeReport() aggregates them into peptides and modification sites for mapping.
//
// Normalized peptide rows: { sequence, proteins, genes, sample, condition, quantity, quantities,
//   q, probability, decoy, contaminant, mods: [{ position (0-based; -1 N-term), label, probability }] }
// Normalized site rows: { site: true, protein, gene, position (1-based), residue, label, probability,
//   sample, condition, quantity, quantities, decoy, contaminant }

import { FIXED_MODIFICATION_LABELS, MODIFICATIONS, parsePeptideNotation } from './proteomics.js';
import { isParquet, openParquet, parquetSource } from './parquet.js';

export const REPORT_FORMATS = {
  'maxquant-evidence': { label: 'MaxQuant evidence', kind: 'peptides' },
  'maxquant-peptides': { label: 'MaxQuant peptides', kind: 'peptides' },
  'maxquant-sites': { label: 'MaxQuant site table', kind: 'sites' },
  diann: { label: 'DIA-NN report', kind: 'peptides' },
  'diann-sites': { label: 'DIA-NN site report', kind: 'sites' },
  spectronaut: { label: 'Spectronaut report', kind: 'peptides' },
  'spectronaut-sites': { label: 'Spectronaut PTM site report', kind: 'sites' },
  'fragpipe-psm': { label: 'FragPipe psm.tsv', kind: 'peptides' },
  'fragpipe-peptides': { label: 'FragPipe peptide table', kind: 'peptides' },
  'fragpipe-sites': { label: 'FragPipe site table', kind: 'sites' },
  mztab: { label: 'mzTab', kind: 'peptides' },
  'pd-peptides': { label: 'Proteome Discoverer export', kind: 'peptides' },
};

const MOD_BY_ALIAS = new Map(MODIFICATIONS.flatMap((mod) => [mod.label, ...mod.aliases].map((alias) => [alias.toLowerCase().replace(/[^a-z0-9]/g, ''), mod])));
const MOD_BY_UNIMOD = new Map(MODIFICATIONS.map((mod) => [mod.unimod, mod]));
const FIXED = new Set(FIXED_MODIFICATION_LABELS);
const MISSING = new Set(['', 'NA', 'NAN', 'NaN', 'nan', 'NULL', 'null', 'None', 'Filtered', '#N/A', '-', 'inf', '-inf']);

/* ---------- Detection ---------- */

// The format of a table from its header cells (and, for mzTab, its first lines).
export function detectReport(header, name = '') {
  const has = (...names) => names.every((item) => header.includes(item));
  const lower = String(name).toLowerCase();
  if (has('Raw file', 'Modified sequence') && (has('Proteins') || has('Leading proteins'))) return 'maxquant-evidence';
  if (has('Positions within proteins', 'Localization prob')) return 'maxquant-sites';
  if (has('Sequence', 'Proteins', 'Start position') && !header.includes('Modified sequence')) return 'maxquant-peptides';
  if (has('Stripped.Sequence', 'Modified.Sequence') && (has('Protein.Group') || has('Protein.Ids'))) return 'diann';
  if (has('Protein', 'Residue', 'Site', 'Sequence') && (has('Gene.Names') || has('Protein.Names'))) return 'diann-sites';
  if (has('PTM.SiteLocation', 'PTM.ProteinId') || header.includes('PTM.CollapseKey')) return 'spectronaut-sites';
  if (has('PG.ProteinGroups') || has('PG.ProteinAccessions')) {
    if (header.some((cell) => /^(EG\.ModifiedSequence|EG\.ModifiedPeptide|EG\.PrecursorId|FG\.LabeledSequence|PEP\.StrippedSequence)$/.test(cell))) return 'spectronaut';
  }
  if (has('Index', 'Best Localization Probability')) return 'fragpipe-sites';
  if (has('Spectrum', 'Peptide') && (has('Assigned Modifications') || has('Modified Peptide'))) return 'fragpipe-psm';
  if ((has('Peptide') || has('Peptide Sequence')) && (has('Protein ID') || has('Protein')) && header.some((cell) => /Spectral Count$|Intensity$/.test(cell))) return 'fragpipe-peptides';
  if (has('Annotated Sequence') && (has('Master Protein Accessions') || has('Protein Accessions'))) return 'pd-peptides';
  if (lower.includes('evidence') && has('Sequence', 'Modified sequence')) return 'maxquant-evidence';
  return null;
}

export function detectDelimiter(line) {
  const count = (char) => {
    let total = 0;
    let quoted = false;
    for (const value of line) {
      if (value === '"') quoted = !quoted;
      else if (!quoted && value === char) total += 1;
    }
    return total;
  };
  const tabs = count('\t');
  if (tabs) return '\t';
  const commas = count(',');
  const semicolons = count(';');
  return semicolons > commas ? ';' : ',';
}

// CSV/TSV cells, with double-quoted fields ("a, b" and "" escapes). A quote opens a quoted field
// only at the start of a cell, so a description such as 5" nucleotidase stays one cell.
export function splitRow(line, delimiter) {
  if (!line.includes('"')) return line.split(delimiter);
  const cells = [];
  let current = '';
  let quoted = false;
  let cellStart = true;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else quoted = false;
      } else current += char;
    } else if (char === '"' && cellStart) {
      quoted = true;
      cellStart = false;
    } else if (char === delimiter) {
      cells.push(current);
      current = '';
      cellStart = true;
    } else {
      current += char;
      cellStart = false;
    }
  }
  cells.push(current);
  return cells;
}

// The cells of a row. Semicolon-separated files come from locales that write the comma as the
// decimal mark, so there "1,234" is 1.234 rather than 1234.
export function splitCells(line, delimiter) {
  const cells = splitRow(line, delimiter);
  if (delimiter !== ';') return cells;
  return cells.map((cell) => (/^\s*[+-]?\d*,\d+([eE][+-]?\d+)?\s*$/.test(cell) ? cell.replace(',', '.') : cell));
}

/* ---------- Values ---------- */

export function toNumber(text) {
  if (typeof text === 'number') return text;
  let value = String(text ?? '').trim().replace(/^"|"$/g, '');
  if (MISSING.has(value)) return NaN;
  if (value.includes(',')) {
    // Thousands separators ("1,234,567.8"); any other single comma is a decimal mark ("0,05",
    // "2,51").
    if (/^[+-]?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(value)) value = value.replace(/,/g, '');
    else if (/^[+-]?\d+,\d+$/.test(value)) value = value.replace(',', '.');
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

// "sp|P04637|P53_HUMAN" → "P04637"; "CON__P02768" and "REV__P04637" keep their prefix so they
// can be recognized as contaminants and decoys.
export function accessionOf(text) {
  const value = String(text ?? '').trim();
  const pipes = value.match(/^(?:rev_|REV_|DECOY_|decoy_|contam_)?(?:sp|tr)\|([^|]+)\|/);
  if (pipes) return value.startsWith('rev_') || value.startsWith('REV_') || /^decoy_/i.test(value) ? `REV__${pipes[1]}` : value.startsWith('contam_') ? `CON__${pipes[1]}` : pipes[1];
  return value.split(/\s/)[0];
}

export function splitList(text, separator = /;/) {
  return String(text ?? '').split(separator).map((item) => item.trim()).filter(Boolean);
}

const isDecoyAccession = (accession) => /^(REV__|rev_|DECOY_|decoy_|XXX_)/.test(accession);
const isContaminantAccession = (accession) => /^(CON__|contam_|Cont_)/.test(accession);

// "Phospho (STY)" / "UniMod:21" / "79.9663" → "Phospho".
export function modificationLabel(text) {
  const value = String(text ?? '').trim();
  const unimod = value.match(/unimod:(\d+)/i);
  if (unimod) return MOD_BY_UNIMOD.get(Number(unimod[1]))?.label ?? `UniMod:${unimod[1]}`;
  const mass = Number(value.replace(/^[A-Za-z-]*:/, ''));
  if (Number.isFinite(mass) && /\d/.test(value)) {
    const found = MODIFICATIONS.reduce((best, mod) => (Math.abs(mod.monoisotopic - mass) < 0.02 && (!best || Math.abs(mod.monoisotopic - mass) < Math.abs(best.monoisotopic - mass)) ? mod : best), null);
    return found?.label ?? `${mass >= 0 ? '+' : ''}${mass}`;
  }
  const name = value.replace(/\s*\([^()]*\)\s*$/, '').replace(/\s*\[[^\]]*\]\s*$/, '');
  return MOD_BY_ALIAS.get(name.toLowerCase().replace(/[^a-z0-9]/g, ''))?.label ?? name;
}

/* ---------- Localization probabilities ---------- */

// "GLGPSPAGDGPS(0.327)GS(0.673)GK" (MaxQuant, FragPipe) → Map(0-based position → probability).
export function parenthesizedProbabilities(text) {
  const probabilities = new Map();
  let position = -1;
  const value = String(text ?? '');
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (/[A-Za-z]/.test(char)) position += 1;
    else if (char === '(') {
      const close = value.indexOf(')', index);
      const probability = Number(value.slice(index + 1, close));
      if (Number.isFinite(probability) && position >= 0) probabilities.set(position, probability);
      index = close;
    }
  }
  return probabilities;
}

// DIA-NN Site.Occupancy.Probabilities: "AAAS(UniMod:21){0.789000}PPT{0.211000}PIR2".
export function braceProbabilities(text) {
  const probabilities = new Map();
  let position = -1;
  const value = String(text ?? '');
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(' || char === '[') index = value.indexOf(char === '(' ? ')' : ']', index);
    else if (char === '{') {
      const close = value.indexOf('}', index);
      const probability = Number(value.slice(index + 1, close));
      if (Number.isFinite(probability)) probabilities.set(Math.max(position, -1), probability);
      index = close;
    } else if (/[A-Z]/.test(char)) position += 1;
  }
  return probabilities;
}

// Spectronaut EG.PTMLocalizationProbabilities: "_MLIS[Phospho (STY): 0.4%]AVS[Phospho (STY): 99.6%]PEIR_"
// → Map(position → { label, probability }).
export function bracketProbabilities(text) {
  const probabilities = new Map();
  let position = -1;
  const value = String(text ?? '');
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '[') {
      const close = value.indexOf(']', index);
      const content = value.slice(index + 1, close);
      const match = content.match(/^(.*):\s*([\d.]+)%$/);
      if (match) {
        const entry = probabilities.get(position) ?? {};
        const label = modificationLabel(match[1]);
        const probability = Number(match[2]) / 100;
        if (!Number.isFinite(entry[label]) || probability > entry[label]) entry[label] = probability;
        probabilities.set(position, entry);
      }
      index = close;
    } else if (/[A-Z]/.test(char)) position += 1;
  }
  return probabilities;
}

// Proteome Discoverer ptmRS: "T7(Phospho): 100; Y9(Phospho): 99.48".
export function ptmRSProbabilities(text) {
  const probabilities = new Map();
  for (const part of splitList(text)) {
    const match = part.match(/^([A-Z])(\d+)\(([^)]+)\):\s*([\d.]+)/);
    if (match) probabilities.set(Number(match[2]) - 1, { label: modificationLabel(match[3]), probability: Number(match[4]) / 100 });
  }
  return probabilities;
}

// mzTab modifications: "3[MS,MS:1001876, modification probability, 0.8]|4[...]-UNIMOD:21,8-UNIMOD:4".
export function mzTabModifications(text, length) {
  const mods = [];
  const value = String(text ?? '').trim();
  if (!value || value === 'null') return mods;
  const entries = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      entries.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim()) entries.push(current.trim());
  for (const entry of entries) {
    const dash = entry.lastIndexOf('-');
    if (dash <= 0) continue;
    const label = modificationLabel(entry.slice(dash + 1).replace(/^CHEMMOD:/i, ''));
    const candidates = entry.slice(0, dash).split('|').map((part) => {
      const match = part.match(/^(\d+)(?:\[(.*)\])?$/);
      if (!match) return null;
      // A modification probability, or a false localization rate (FLR), whose complement is used.
      const score = match[2] ? Number(match[2].split(',').pop()) : NaN;
      const probability = !match[2] ? NaN : /probability/i.test(match[2]) ? score : /false localization rate/i.test(match[2]) ? 1 - score : NaN;
      return { position: Number(match[1]), probability };
    }).filter(Boolean);
    if (!candidates.length) continue;
    const best = candidates.reduce((a, b) => ((b.probability || 0) > (a.probability || 0) ? b : a));
    const position = best.position === 0 ? -1 : best.position > length ? length : best.position - 1;
    mods.push({ position, label, probability: candidates.length > 1 && !Number.isFinite(best.probability) ? 1 / candidates.length : best.probability });
  }
  return mods;
}

/* ---------- Row parsers ---------- */

function columnFinder(header) {
  const index = new Map(header.map((name, position) => [name, position]));
  return {
    has: (name) => index.has(name),
    at: (...names) => {
      for (const name of names) if (index.has(name)) return index.get(name);
      return -1;
    },
    matching: (pattern) => header.map((name, position) => ({ name, position })).filter((item) => pattern.test(item.name)),
  };
}

const cell = (cells, position) => {
  const value = position >= 0 ? cells[position] : null;
  return value === null || value === undefined ? '' : typeof value === 'string' ? value.trim() : String(value);
};

function withMods(parsed, probabilities) {
  return (parsed?.modifications ?? []).filter((mod) => mod.label !== 'lowercase').map((mod) => {
    const known = probabilities?.(mod) ?? NaN;
    return { position: mod.position, label: mod.label, probability: known };
  });
}

// A parser takes the header and returns a function from cells to a normalized row (or null).
const PARSERS = {
  'maxquant-evidence'(header) {
    const col = columnFinder(header);
    const columns = {
      sequence: col.at('Sequence'), modified: col.at('Modified sequence'), proteins: col.at('Proteins', 'Leading proteins'),
      genes: col.at('Gene names', 'Gene Names'), experiment: col.at('Experiment'), raw: col.at('Raw file'), intensity: col.at('Intensity'),
      pep: col.at('PEP'), reverse: col.at('Reverse'), contaminant: col.at('Potential contaminant', 'Contaminant'), charge: col.at('Charge'),
    };
    const probabilityColumns = col.matching(/ Probabilities$/).map((item) => ({ label: modificationLabel(item.name.replace(/ Probabilities$/, '')), position: item.position }));
    return (cells) => {
      const parsed = parsePeptideNotation(cell(cells, columns.modified));
      const sequence = cell(cells, columns.sequence) || parsed?.sequence;
      if (!sequence) return null;
      const probabilityMaps = new Map(probabilityColumns.map((item) => [item.label, parenthesizedProbabilities(cell(cells, item.position))]));
      return {
        sequence: sequence.toUpperCase(),
        proteins: splitList(cell(cells, columns.proteins)).map(accessionOf),
        genes: splitList(cell(cells, columns.genes)),
        sample: cell(cells, columns.experiment) || cell(cells, columns.raw),
        condition: '',
        quantity: toNumber(cell(cells, columns.intensity)),
        q: toNumber(cell(cells, columns.pep)),
        charge: toNumber(cell(cells, columns.charge)),
        decoy: cell(cells, columns.reverse) === '+',
        contaminant: cell(cells, columns.contaminant) === '+',
        mods: withMods(parsed, (mod) => probabilityMaps.get(mod.label)?.get(mod.position)),
      };
    };
  },
  'maxquant-peptides'(header) {
    const col = columnFinder(header);
    const lfq = col.matching(/^LFQ intensity .+/);
    const intensity = lfq.length ? lfq : col.matching(/^Intensity .+/);
    const prefix = lfq.length ? 'LFQ intensity ' : 'Intensity ';
    const columns = { sequence: col.at('Sequence'), proteins: col.at('Proteins', 'Leading razor protein'), genes: col.at('Gene names'), pep: col.at('PEP'), reverse: col.at('Reverse'), contaminant: col.at('Potential contaminant', 'Contaminant') };
    return (cells) => {
      const sequence = cell(cells, columns.sequence);
      if (!sequence) return null;
      return {
        sequence: sequence.toUpperCase(),
        proteins: splitList(cell(cells, columns.proteins)).map(accessionOf),
        genes: splitList(cell(cells, columns.genes)),
        sample: '',
        condition: '',
        quantity: NaN,
        quantities: Object.fromEntries(intensity.map((item) => [item.name.slice(prefix.length), toNumber(cells[item.position])])),
        q: toNumber(cell(cells, columns.pep)),
        decoy: cell(cells, columns.reverse) === '+',
        contaminant: cell(cells, columns.contaminant) === '+',
        mods: [],
      };
    };
  },
  'maxquant-sites'(header, name) {
    const col = columnFinder(header);
    const probabilityColumn = col.matching(/ Probabilities$/)[0];
    const label = modificationLabel(probabilityColumn ? probabilityColumn.name.replace(/ Probabilities$/, '') : String(name).replace(/Sites\.txt$/i, ''));
    const intensity = col.matching(/^Intensity (?!___).+/).filter((item) => !/___\d+$/.test(item.name));
    const columns = {
      proteins: col.at('Proteins'), positions: col.at('Positions within proteins'), residue: col.at('Amino acid'), probability: col.at('Localization prob'),
      genes: col.at('Gene names'), reverse: col.at('Reverse'), contaminant: col.at('Potential contaminant'), intensity: col.at('Intensity'),
    };
    return (cells) => {
      const proteins = splitList(cell(cells, columns.proteins)).map(accessionOf);
      const positions = splitList(cell(cells, columns.positions)).map(Number);
      if (!proteins.length || !positions.length) return null;
      return proteins.map((protein, index) => ({
        site: true,
        protein,
        gene: splitList(cell(cells, columns.genes))[0] ?? '',
        position: positions[index] ?? positions[0],
        residue: cell(cells, columns.residue),
        label,
        probability: toNumber(cell(cells, columns.probability)),
        sample: '',
        quantity: toNumber(cell(cells, columns.intensity)),
        // Without per-experiment columns (one experiment), the total intensity is the one sample.
        quantities: intensity.length ? Object.fromEntries(intensity.map((item) => [item.name.slice('Intensity '.length), toNumber(cells[item.position])])) : null,
        decoy: cell(cells, columns.reverse) === '+',
        contaminant: cell(cells, columns.contaminant) === '+',
      }));
    };
  },
  diann(header) {
    const col = columnFinder(header);
    const columns = {
      sequence: col.at('Stripped.Sequence'), modified: col.at('Modified.Sequence'), proteins: col.at('Protein.Ids', 'Protein.Group'), genes: col.at('Genes'),
      run: col.at('Run', 'File.Name'), quantity: col.at('Precursor.Normalised', 'Precursor.Quantity'), raw: col.at('Precursor.Quantity'),
      q: col.at('Q.Value'), decoy: col.at('Decoy'), confidence: col.at('PTM.Site.Confidence'), occupancy: col.at('Site.Occupancy.Probabilities'),
      charge: col.at('Precursor.Charge'), channel: col.at('Channel'),
    };
    // The precursor matrix (pr_matrix.tsv) has one quantity column per run instead of Run and
    // quantity columns: each run with a quantity becomes a row.
    const runColumns = columns.run < 0
      ? header.map((name, position) => ({ name, position })).filter(({ name }) => name && !/^(Protein\.|Precursor\.|Stripped\.|Modified\.|First\.|Genes$|Proteotypic$|Channel$|Decoy$|Q\.Value$|Lib\.|Global\.|PG\.|Translated\.)/.test(name))
      : [];
    if (runColumns.length) {
      return (cells) => {
        const sequence = cell(cells, columns.sequence);
        if (!sequence) return null;
        const parsed = parsePeptideNotation(cell(cells, columns.modified));
        const base = {
          sequence: sequence.toUpperCase(),
          proteins: splitList(cell(cells, columns.proteins)).map(accessionOf),
          genes: splitList(cell(cells, columns.genes)),
          condition: '',
          q: NaN,
          charge: toNumber(cell(cells, columns.charge)),
          decoy: false,
          contaminant: false,
          mods: withMods(parsed, () => NaN),
        };
        const rows = runColumns.map(({ name, position }) => ({ ...base, sample: name.split(/[\\/]/).pop(), quantity: toNumber(cells[position]) })).filter((row) => row.quantity > 0);
        return rows.length ? rows : [{ ...base, sample: 'all', quantity: NaN }];
      };
    }
    return (cells) => {
      const sequence = cell(cells, columns.sequence);
      if (!sequence) return null;
      const parsed = parsePeptideNotation(cell(cells, columns.modified));
      const occupancy = columns.occupancy >= 0 ? braceProbabilities(cell(cells, columns.occupancy)) : null;
      const confidence = toNumber(cell(cells, columns.confidence));
      let quantity = toNumber(cell(cells, columns.quantity));
      if (!(quantity > 0)) quantity = toNumber(cell(cells, columns.raw));
      const channel = cell(cells, columns.channel);
      return {
        sequence: sequence.toUpperCase(),
        proteins: splitList(cell(cells, columns.proteins)).map(accessionOf),
        genes: splitList(cell(cells, columns.genes)),
        sample: `${cell(cells, columns.run).split(/[\\/]/).pop()}${channel ? ` ${channel}` : ''}`,
        condition: '',
        quantity,
        q: toNumber(cell(cells, columns.q)),
        charge: toNumber(cell(cells, columns.charge)),
        decoy: ['1', 'true', 'True'].includes(cell(cells, columns.decoy)),
        contaminant: false,
        mods: withMods(parsed, (mod) => (occupancy?.has(mod.position) ? occupancy.get(mod.position) : confidence)),
      };
    };
  },
  'diann-sites'(header, name) {
    const col = columnFinder(header);
    const fixed = new Set(['Protein', 'Protein.Names', 'Gene.Names', 'Residue', 'Site', 'Sequence']);
    const runs = header.map((item, position) => ({ name: item, position })).filter((item) => !fixed.has(item.name) && item.name);
    const label = /phospho/i.test(name) || !name ? 'Phospho' : modificationLabel(String(name).replace(/sites.*$/i, ''));
    const columns = { protein: col.at('Protein'), gene: col.at('Gene.Names'), residue: col.at('Residue'), position: col.at('Site') };
    return (cells) => {
      const position = toNumber(cell(cells, columns.position));
      if (!Number.isFinite(position)) return null;
      return {
        site: true,
        protein: accessionOf(cell(cells, columns.protein)),
        gene: splitList(cell(cells, columns.gene))[0] ?? '',
        position,
        residue: cell(cells, columns.residue),
        label,
        probability: NaN,
        sample: '',
        quantity: NaN,
        quantities: Object.fromEntries(runs.map((run) => {
          const value = toNumber(cells[run.position]);
          return [run.name.split(/[\\/]/).pop(), value > 0 ? value : NaN];
        })),
        decoy: false,
        contaminant: false,
      };
    };
  },
  spectronaut(header) {
    const col = columnFinder(header);
    const columns = {
      sequence: col.at('PEP.StrippedSequence'), modified: col.at('EG.ModifiedSequence', 'EG.ModifiedPeptide', 'FG.LabeledSequence', 'EG.PrecursorId'),
      proteins: col.at('PG.ProteinAccessions', 'PG.ProteinGroups', 'PG.UniProtIds'), genes: col.at('PG.Genes'),
      file: col.at('R.FileName'), condition: col.at('R.Condition'), replicate: col.at('R.Replicate'),
      quantity: col.at('FG.Quantity', 'EG.TotalQuantity (Settings)', 'EG.TargetQuantity (Settings)', 'PEP.Quantity'),
      q: col.at('EG.Qvalue', 'FG.Qvalue'), decoy: col.at('EG.IsDecoy'), localization: col.at('EG.PTMLocalizationProbabilities'), charge: col.at('FG.Charge'),
    };
    // Exports with fragment columns (F.*) repeat each precursor once per fragment ion; its
    // quantity counts once per run. Exports list one run after another, so the precursors seen are
    // kept for the current run only (a whole report is read for statistics).
    const fragments = header.some((name) => /^F\./.test(name));
    const seen = new Set();
    let run = null;
    return (cells) => {
      const parsed = parsePeptideNotation(cell(cells, columns.modified));
      const sequence = cell(cells, columns.sequence) || parsed?.sequence;
      if (!sequence) return null;
      if (fragments) {
        const current = `${cell(cells, columns.file)}|${cell(cells, columns.condition)}|${cell(cells, columns.replicate)}`;
        if (current !== run) {
          seen.clear();
          run = current;
        }
        const key = `${cell(cells, columns.modified) || sequence}|${cell(cells, columns.charge)}`;
        if (seen.has(key)) return null;
        seen.add(key);
      }
      const localization = columns.localization >= 0 ? bracketProbabilities(cell(cells, columns.localization)) : null;
      const condition = cell(cells, columns.condition).replace(/^Not Defined$/i, '');
      const replicate = cell(cells, columns.replicate);
      return {
        sequence: sequence.toUpperCase(),
        proteins: splitList(cell(cells, columns.proteins)).map(accessionOf),
        genes: splitList(cell(cells, columns.genes)),
        sample: cell(cells, columns.file) || [condition, replicate].filter(Boolean).join(' '),
        condition,
        quantity: toNumber(cell(cells, columns.quantity)),
        q: toNumber(cell(cells, columns.q)),
        charge: toNumber(cell(cells, columns.charge)),
        decoy: /^true$/i.test(cell(cells, columns.decoy)),
        contaminant: false,
        mods: withMods(parsed, (mod) => localization?.get(mod.position)?.[mod.label]),
      };
    };
  },
  'spectronaut-sites'(header) {
    const col = columnFinder(header);
    const columns = {
      protein: col.at('PTM.ProteinId'), position: col.at('PTM.SiteLocation'), residue: col.at('PTM.SiteAA'), probability: col.at('PTM.SiteProbability'),
      title: col.at('PTM.ModificationTitle'), quantity: col.at('PTM.Quantity'), file: col.at('R.FileName'), condition: col.at('R.Condition'), gene: col.at('PG.Genes'),
      key: col.at('PTM.CollapseKey'),
    };
    return (cells) => {
      let protein = cell(cells, columns.protein);
      let position = toNumber(cell(cells, columns.position));
      let residue = cell(cells, columns.residue);
      const key = cell(cells, columns.key).match(/^(.+)_([A-Z])(\d+)_M\d+/);
      if (key && (!protein || !Number.isFinite(position))) {
        protein = key[1];
        residue = key[2];
        position = Number(key[3]);
      }
      if (!protein || !Number.isFinite(position)) return null;
      return {
        site: true,
        protein: accessionOf(protein),
        gene: cell(cells, columns.gene),
        position,
        residue,
        label: modificationLabel(cell(cells, columns.title) || 'Phospho'),
        probability: toNumber(cell(cells, columns.probability)),
        sample: cell(cells, columns.file),
        condition: cell(cells, columns.condition).replace(/^Not Defined$/i, ''),
        quantity: toNumber(cell(cells, columns.quantity)),
        decoy: false,
        contaminant: false,
      };
    };
  },
  'fragpipe-psm'(header) {
    const col = columnFinder(header);
    const localizationColumns = col.matching(/^[A-Za-z]+:-?[\d.]+$/).map((item) => ({ label: modificationLabel(item.name.split(':')[1]), position: item.position }));
    const columns = {
      sequence: col.at('Peptide'), modified: col.at('Modified Peptide'), assigned: col.at('Assigned Modifications'), protein: col.at('Protein ID', 'Protein'),
      mapped: col.at('Mapped Proteins'), gene: col.at('Gene'), file: col.at('Spectrum File'), spectrum: col.at('Spectrum'), intensity: col.at('Intensity'),
      probability: col.at('PeptideProphet Probability', 'Probability'), charge: col.at('Charge'),
    };
    // A precursor identified by several spectra in one run is quantified once: its intensity is the
    // largest of its PSMs', as MSstats' converters do by default (summaryforMultipleRows = max). Each
    // PSM row still counts as evidence and carries only what it adds to the maximum so far.
    const largest = new Map();
    return (cells) => {
      const sequence = cell(cells, columns.sequence);
      if (!sequence) return null;
      const modified = cell(cells, columns.modified);
      const parsed = modified ? parsePeptideNotation(modified) : assignedModifications(sequence, cell(cells, columns.assigned));
      const maps = new Map(localizationColumns.map((item) => [item.label, parenthesizedProbabilities(cell(cells, item.position))]));
      const file = cell(cells, columns.file) || cell(cells, columns.spectrum).split('.')[0];
      const parts = file.split(/[\\/]/).filter(Boolean);
      const primary = accessionOf(cell(cells, columns.protein));
      const sample = parts.length > 1 ? parts[parts.length - 2] : (parts[0] ?? '').replace(/\.[^.]+$/, '');
      const precursor = `${sample}|${modified || `${sequence}|${cell(cells, columns.assigned)}`}|${cell(cells, columns.charge)}`;
      const intensity = toNumber(cell(cells, columns.intensity));
      const before = largest.get(precursor) ?? 0;
      if (intensity > before) largest.set(precursor, intensity);
      return {
        sequence: sequence.toUpperCase(),
        proteins: [primary, ...splitList(cell(cells, columns.mapped), /,\s*/).map(accessionOf)].filter(Boolean),
        genes: [cell(cells, columns.gene)].filter(Boolean),
        sample,
        condition: '',
        quantity: intensity > before ? intensity - before : Number.isFinite(intensity) ? 0 : NaN,
        q: NaN,
        probability: toNumber(cell(cells, columns.probability)),
        charge: toNumber(cell(cells, columns.charge)),
        decoy: isDecoyAccession(cell(cells, columns.protein)),
        contaminant: /^contam_/.test(cell(cells, columns.protein)),
        mods: withMods(parsed, (mod) => maps.get(mod.label)?.get(mod.position)),
      };
    };
  },
  'fragpipe-peptides'(header) {
    const col = columnFinder(header);
    const maxlfq = col.matching(/ MaxLFQ Intensity$/);
    const intensity = maxlfq.length ? maxlfq : col.matching(/ Intensity$/).filter((item) => item.name !== 'Intensity');
    const suffix = maxlfq.length ? ' MaxLFQ Intensity' : ' Intensity';
    const columns = { sequence: col.at('Peptide Sequence', 'Peptide'), modified: col.at('Modified Sequence'), protein: col.at('Protein ID', 'Protein'), mapped: col.at('Mapped Proteins'), gene: col.at('Gene'), intensity: col.at('Intensity') };
    return (cells) => {
      const sequence = cell(cells, columns.sequence);
      if (!sequence) return null;
      const parsed = columns.modified >= 0 ? parsePeptideNotation(cell(cells, columns.modified)) : null;
      return {
        sequence: sequence.toUpperCase(),
        proteins: [accessionOf(cell(cells, columns.protein)), ...splitList(cell(cells, columns.mapped), /,\s*/).map(accessionOf)].filter(Boolean),
        genes: [cell(cells, columns.gene)].filter(Boolean),
        sample: '',
        condition: '',
        quantity: toNumber(cell(cells, columns.intensity)),
        quantities: intensity.length ? Object.fromEntries(intensity.map((item) => [item.name.slice(0, -suffix.length), toNumber(cells[item.position])])) : undefined,
        q: NaN,
        decoy: isDecoyAccession(cell(cells, columns.protein)),
        contaminant: /^contam_/.test(cell(cells, columns.protein)),
        mods: withMods(parsed),
      };
    };
  },
  'fragpipe-sites'(header, name) {
    const col = columnFinder(header);
    const massMatch = String(name).match(/_([A-Za-z]+)_(-?[\d.]+)\.tsv/);
    const label = massMatch ? modificationLabel(massMatch[2]) : 'Phospho';
    const maxlfq = col.matching(/ MaxLFQ Intensity$/);
    const intensity = maxlfq.length ? maxlfq : col.matching(/ Intensity$/);
    const suffix = maxlfq.length ? ' MaxLFQ Intensity' : ' Intensity';
    const columns = { index: col.at('Index'), protein: col.at('Protein ID'), gene: col.at('Gene'), probability: col.at('Best Localization Probability') };
    return (cells) => {
      const match = cell(cells, columns.index).match(/^(.+)_([A-Z])(\d+)$/);
      if (!match) return null;
      return {
        site: true,
        protein: cell(cells, columns.protein) || accessionOf(match[1]),
        gene: cell(cells, columns.gene),
        position: Number(match[3]),
        residue: match[2],
        label,
        probability: toNumber(cell(cells, columns.probability)),
        sample: '',
        quantity: NaN,
        quantities: Object.fromEntries(intensity.map((item) => [item.name.slice(0, -suffix.length), toNumber(cells[item.position])])),
        decoy: false,
        contaminant: false,
      };
    };
  },
  'pd-peptides'(header) {
    const col = columnFinder(header);
    const abundances = col.matching(/^Abundance(s \(Normalized\))?:? /).filter((item) => !/Ratio|Count|Grouped/.test(item.name));
    const normalized = abundances.filter((item) => /Normalized/.test(item.name));
    const quant = normalized.length ? normalized : abundances;
    const columns = {
      annotated: col.at('Annotated Sequence'), sequence: col.at('Sequence'), modifications: col.at('Modifications'), proteins: col.at('Master Protein Accessions', 'Protein Accessions'),
      ptmrs: col.at('ptmRS: Best Site Probabilities', 'PhosphoRS: Best Site Probabilities'), file: col.at('Spectrum File', 'File ID'), contaminant: col.at('Contaminant'),
      q: col.at('Percolator q-Value', 'q-Value', 'Qvality q-value'), charge: col.at('Charge'),
    };
    return (cells) => {
      const annotated = cell(cells, columns.annotated).replace(/^\[[^\]]*\]\.|\.\[[^\]]*\]$/g, '');
      const sequence = (cell(cells, columns.sequence) || annotated).toUpperCase();
      if (!/^[A-Z]+$/.test(sequence)) return null;
      const ptmRS = columns.ptmrs >= 0 ? ptmRSProbabilities(cell(cells, columns.ptmrs)) : null;
      const mods = pdModifications(cell(cells, columns.modifications), sequence).map((mod) => {
        const known = ptmRS?.get(mod.position);
        return { ...mod, probability: known && known.label === mod.label ? known.probability : NaN };
      });
      return {
        sequence,
        proteins: splitList(cell(cells, columns.proteins)).map(accessionOf),
        genes: [],
        sample: cell(cells, columns.file),
        condition: '',
        quantity: NaN,
        quantities: quant.length ? Object.fromEntries(quant.map((item) => [item.name.replace(/^Abundances? \(Normalized\):?\s*|^Abundances?:?\s*/, ''), toNumber(cells[item.position])])) : undefined,
        q: toNumber(cell(cells, columns.q)),
        charge: toNumber(cell(cells, columns.charge)),
        decoy: false,
        contaminant: /^true$/i.test(cell(cells, columns.contaminant)),
        mods,
      };
    };
  },
};

// FragPipe "Assigned Modifications": "5S(79.9663), N-term(42.0106), 8M(15.9949)".
function assignedModifications(sequence, text) {
  const modifications = [];
  for (const part of splitList(text, /,\s*/)) {
    const match = part.match(/^(\d+)?([A-Za-z-]+)\((-?[\d.]+)\)$/);
    if (!match) continue;
    const position = match[2].toLowerCase() === 'n-term' ? -1 : match[2].toLowerCase() === 'c-term' ? sequence.length : Number(match[1]) - 1;
    modifications.push({ position, label: modificationLabel(match[3]) });
  }
  return { sequence, modifications };
}

// Proteome Discoverer "S6(Phospho); N-Term(TMTpro)" (PSMs) or "1xPhospho [S5]; 2xCarbamidomethyl [C11; C24]" (peptide groups).
function pdModifications(text, sequence) {
  const mods = [];
  const value = String(text ?? '');
  const grouped = [...value.matchAll(/\d+x([^[;]+)\s*\[([^\]]*)\]/g)];
  if (grouped.length) {
    for (const [, name, positions] of grouped) {
      for (const item of splitList(positions)) {
        const match = item.match(/^([A-Z])(\d+)$/);
        if (match) mods.push({ position: Number(match[2]) - 1, label: modificationLabel(name.trim()) });
        else if (/^N-Term/i.test(item)) mods.push({ position: -1, label: modificationLabel(name.trim()) });
      }
    }
    return mods;
  }
  for (const part of splitList(value)) {
    const match = part.match(/^([A-Z])(\d+)\(([^)]+)\)$/);
    if (match) mods.push({ position: Number(match[2]) - 1, label: modificationLabel(match[3]) });
    else if (/^N-Term/i.test(part)) mods.push({ position: -1, label: modificationLabel(part.replace(/^N-Term(\(Prot\))?\(|\)$/g, '')) });
    else if (/^C-Term/i.test(part)) mods.push({ position: sequence.length, label: modificationLabel(part.replace(/^C-Term\(|\)$/g, '')) });
  }
  return mods;
}

// Contaminant and decoy entries are recognized by their accession prefixes as well as by flags.
function markSpecialAccessions(row) {
  if (!row) return row;
  const accessions = row.site ? [row.protein] : row.proteins;
  if (accessions.length && accessions.every(isContaminantAccession)) row.contaminant = true;
  if (accessions.length && accessions.every(isDecoyAccession)) row.decoy = true;
  return row;
}

/* ---------- mzTab ---------- */

// PSM and PEP rows are both read; readReport keeps the PEP section when it has abundances (one
// value per study variable) and the PSM section otherwise.
function mzTabParser() {
  const runs = new Map();
  const variables = new Map();
  const sections = {};
  return (line) => {
    const cells = line.split('\t');
    const prefix = cells[0];
    if (prefix === 'MTD') {
      const run = cells[1]?.match(/^ms_run\[(\d+)\]-location$/);
      if (run) runs.set(run[1], (cells[2] ?? '').split(/[\\/]/).pop().replace(/\.[^.]+$/, ''));
      const variable = cells[1]?.match(/^study_variable\[(\d+)\]-description$/);
      if (variable) variables.set(variable[1], cells[2]?.trim() || `study variable ${variable[1]}`);
      return null;
    }
    if (prefix === 'PSH' || prefix === 'PEH') {
      sections[prefix === 'PSH' ? 'PSM' : 'PEP'] = columnFinder(cells);
      return null;
    }
    const columns = sections[prefix];
    if (!columns) return null;
    const sequence = cell(cells, columns.at('sequence')).toUpperCase();
    if (!/^[A-Z]+$/.test(sequence)) return null;
    const accession = cell(cells, columns.at('accession'));
    const reference = cell(cells, columns.at('spectra_ref')).match(/ms_run\[(\d+)\]/);
    const abundance = prefix === 'PEP' ? columns.matching(/^peptide_abundance_study_variable\[\d+\]$/) : [];
    const decoy = cell(cells, columns.at('opt_global_cv_MS:1002217_decoy_peptide'));
    return {
      section: prefix,
      sequence,
      proteins: splitList(accession, /[;,]/).map(accessionOf),
      genes: [],
      sample: reference ? runs.get(reference[1]) ?? `run ${reference[1]}` : '',
      condition: '',
      quantity: NaN,
      quantities: abundance.length ? Object.fromEntries(abundance.map((item) => {
        const index = item.name.match(/\[(\d+)\]/)[1];
        return [variables.get(index) ?? `study variable ${index}`, toNumber(cells[item.position])];
      })) : undefined,
      q: toNumber(cell(cells, columns.at('opt_global_q-value', 'opt_global_cv_MS:1002354_PSM-level_q-value'))),
      charge: toNumber(cell(cells, columns.at('charge'))),
      decoy: decoy === '1' || isDecoyAccession(accession),
      contaminant: false,
      mods: mzTabModifications(cell(cells, columns.at('modifications')), sequence.length),
    };
  };
}

/* ---------- Reading ---------- */

// Text lines of a Blob (optionally gzipped), without holding the whole file.
export async function* readLines(blob, onProgress) {
  let stream = blob.stream();
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let read = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    read += value.length;
    buffer += value;
    let start = 0;
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n', start)) {
      yield buffer.slice(start, newline).replace(/\r$/, '');
      start = newline + 1;
    }
    buffer = buffer.slice(start);
    // Old Mac exports end lines with carriage returns only.
    if (buffer.length > 1 << 20 && !buffer.includes('\n') && buffer.includes('\r')) {
      const parts = buffer.split('\r');
      buffer = parts.pop();
      for (const part of parts) yield part;
    }
    onProgress?.(read);
  }
  for (const part of buffer.split('\r')) if (part) yield part;
}

// Reads a report, keeping rows whose proteins include one of `accessions` (UniProt, compared
// without isoform suffixes) or, without accessions, whose peptide occurs in one of `sequences`.
export async function readReport(blob, options = {}) {
  const name = blob.name ?? options.name ?? 'report';
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (isParquet(head)) return readParquetReport(blob, name, options);
  const accessions = new Set((options.accessions ?? []).map((item) => item.replace(/-\d+$/, '')));
  const needles = [...accessions];
  const sequences = (options.sequences ?? []).map((sequence) => sequence.toUpperCase().replace(/I/g, 'L'));
  const keep = (row) => {
    if (!row) return false;
    if (options.keepAll) return true;
    if (accessions.size) {
      if (row.site) return accessions.has(row.protein.replace(/-\d+$/, ''));
      return row.proteins.some((protein) => accessions.has(protein.replace(/-\d+$/, '')));
    }
    if (row.site) return false;
    const peptide = row.sequence.replace(/I/g, 'L');
    return sequences.some((sequence) => sequence.includes(peptide));
  };
  let format = null;
  let parse = null;
  let delimiter = '\t';
  let header = null;
  let total = 0;
  const rows = [];
  let mzTab = null;
  // With options.collect, every row's quantities also go to a feature matrix of the whole report
  // (for statistics), so no line can be skipped unparsed.
  const collector = options.collect ? createFeatureCollector(options.collect) : null;
  for await (const line of readLines(blob, options.onProgress)) {
    if (!line.trim()) continue;
    if (!format && !mzTab && /^(MTD|COM)\t/.test(line)) {
      mzTab = mzTabParser();
      format = 'mztab';
    }
    if (mzTab) {
      if (/^(PSM|PEP)\t/.test(line)) total += 1;
      if (!collector && /^(PSM|PEP)\t/.test(line) && needles.length && !needles.some((needle) => line.includes(needle))) continue;
      const row = mzTab(line);
      if (collector && row?.section === 'PEP') collector.add(markSpecialAccessions(row), format);
      if (keep(row)) rows.push(markSpecialAccessions(row));
      continue;
    }
    if (!header) {
      delimiter = detectDelimiter(line);
      header = splitCells(line, delimiter).map((item) => item.trim());
      format = detectReport(header, name);
      if (!format) throw new Error(`${name} is not a recognized report. Supported: MaxQuant (evidence, peptides, sites), DIA-NN, Spectronaut, FragPipe, mzTab and Proteome Discoverer exports.`);
      parse = PARSERS[format](header, name);
      continue;
    }
    total += 1;
    if (!collector && needles.length && !needles.some((needle) => line.includes(needle))) continue;
    const parsed = parse(splitCells(line, delimiter));
    for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!row) continue;
      if (collector) collector.add(markSpecialAccessions(row), format);
      if (keep(row)) rows.push(markSpecialAccessions(row));
    }
  }
  if (!format) throw new Error(`${name} is empty.`);
  let kept = rows;
  if (format === 'mztab') {
    const quantified = rows.filter((row) => row.section === 'PEP' && row.quantities && Object.values(row.quantities).some((value) => value > 0));
    kept = quantified.length ? rows.filter((row) => row.section === 'PEP') : rows.filter((row) => row.section === 'PSM');
    if (!kept.length) kept = rows;
  }
  return { format, label: REPORT_FORMATS[format].label, kind: REPORT_FORMATS[format].kind, name, rows: kept, total, features: collector?.finish() ?? null };
}

const DIANN_COLUMNS = ['Stripped.Sequence', 'Modified.Sequence', 'Protein.Ids', 'Protein.Group', 'Genes', 'Run', 'Channel', 'Precursor.Normalised',
  'Precursor.Quantity', 'Q.Value', 'Decoy', 'PTM.Site.Confidence', 'Site.Occupancy.Probabilities', 'Precursor.Charge'];

async function readParquetReport(blob, name, options) {
  const file = await openParquet(parquetSource(blob));
  const available = new Set(file.columns.map((column) => column.name));
  if (!available.has('Stripped.Sequence') || !available.has('Modified.Sequence')) {
    throw new Error(`${name} is a Parquet table but not a DIA-NN report (no Stripped.Sequence / Modified.Sequence columns).`);
  }
  const columns = DIANN_COLUMNS.filter((column) => available.has(column));
  const parse = PARSERS.diann(columns);
  const accessions = (options.accessions ?? []).map((item) => item.replace(/-\d+$/, ''));
  const sequences = (options.sequences ?? []).map((sequence) => sequence.toUpperCase().replace(/I/g, 'L'));
  const proteinColumn = available.has('Protein.Ids') ? 'Protein.Ids' : 'Protein.Group';
  const collector = options.collect ? createFeatureCollector(options.collect) : null;
  const filter = options.keepAll || collector ? null
    : accessions.length ? { column: proteinColumn, test: (value) => typeof value === 'string' && accessions.some((accession) => value.includes(accession)) }
      : { column: 'Stripped.Sequence', test: (value) => typeof value === 'string' && sequences.some((sequence) => sequence.includes(value.replace(/I/g, 'L'))) };
  const rows = [];
  await file.scan(columns, {
    filter,
    onProgress: (done, count) => options.onProgress?.((done / count) * blob.size),
    onRows: (values) => {
      const count = values[columns[0]].length;
      for (let index = 0; index < count; index += 1) {
        const row = markSpecialAccessions(parse(columns.map((column) => values[column][index])));
        if (row && collector) collector.add(row, 'diann');
        if (!row || (collector && !options.keepAll && !(accessions.length
          ? row.proteins.some((protein) => accessions.includes(protein.replace(/-\d+$/, '')))
          : sequences.some((sequence) => sequence.includes(row.sequence.replace(/I/g, 'L')))))) continue;
        if (!accessions.length || options.keepAll || row.proteins.some((protein) => accessions.includes(protein.replace(/-\d+$/, '')))) rows.push(row);
      }
    },
  });
  return { format: 'diann', label: `${REPORT_FORMATS.diann.label} (Parquet)`, kind: 'peptides', name, rows, total: file.rows, features: collector?.finish() ?? null };
}

/* ---------- Features for statistics ---------- */

// The quantities of every feature in a report, for statistics over the whole experiment:
// modified peptides ("pep|SEQUENCE|3Phospho,7Oxidation") for peptide reports and sites
// ("site|P04637|15|Phospho") for site tables. Rows are filtered by q-value as summarizeReport
// does and summed per feature and sample. Localization is judged per feature, not per row, since
// search engines report it per run: a modification whose best probability stays below the
// threshold is written "?Phospho" (peptidoforms that differ only there merge), and a site table's
// site is kept when its best probability reaches it. The matrix is features × samples (NaN when
// absent); proteins holds each feature's leading protein.
export function peptideFeatureKey(sequence, mods, localization = 0.75) {
  const parts = [];
  for (const mod of mods ?? []) {
    if (FIXED.has(mod.label)) continue;
    const localized = !Number.isFinite(mod.probability) || mod.probability >= localization;
    parts.push(localized ? `${mod.position}${mod.label}` : `?${mod.label}`);
  }
  parts.sort();
  return `pep|${sequence}|${parts.join(',')}`;
}

export function createFeatureCollector(options = {}) {
  const qCutoff = options.qValue ?? 0.01;
  const localization = options.localization ?? 0.75;
  // Features by their peptidoform (every modification at its position), with the best
  // localization probability of each modification over the rows.
  const features = new Map();
  const keys = [];
  const proteins = [];
  const modifications = [];
  const best = [];
  const samples = new Map();
  let capacity = 1 << 16;
  let featureOf = new Int32Array(capacity);
  let sampleOf = new Int32Array(capacity);
  let values = new Float64Array(capacity);
  let count = 0;
  const sampleIndex = (sample) => {
    let index = samples.get(sample);
    if (index === undefined) {
      index = samples.size;
      samples.set(sample, index);
    }
    return index;
  };
  const push = (feature, sample, value) => {
    if (count === capacity) {
      capacity *= 2;
      const grow = (array, Type) => {
        const next = new Type(capacity);
        next.set(array);
        return next;
      };
      featureOf = grow(featureOf, Int32Array);
      sampleOf = grow(sampleOf, Int32Array);
      values = grow(values, Float64Array);
    }
    featureOf[count] = feature;
    sampleOf[count] = sampleIndex(sample);
    values[count] = value;
    count += 1;
  };
  const probabilityOf = (value) => (Number.isFinite(value) ? value : 1);
  return {
    add(row, format) {
      if (!row || row.decoy || row.contaminant) return;
      let key;
      let mods = [];
      let probabilities;
      if (row.site) {
        if (FIXED.has(row.label)) return;
        key = `site|${row.protein}|${row.position}|${row.label}`;
        probabilities = [probabilityOf(row.probability)];
      } else {
        if (Number.isFinite(row.q) && row.q > qCutoff && format !== 'maxquant-evidence' && format !== 'maxquant-peptides') return;
        mods = (row.mods ?? []).filter((mod) => !FIXED.has(mod.label)).sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
        key = `pep|${row.sequence}|${mods.map((mod) => `${mod.position}${mod.label}`).sort().join(',')}`;
        probabilities = mods.map((mod) => probabilityOf(mod.probability));
      }
      let feature = features.get(key);
      if (feature === undefined) {
        feature = keys.length;
        features.set(key, feature);
        keys.push(key);
        proteins.push(String((row.site ? row.protein : row.proteins?.[0] ?? row.protein) ?? ''));
        modifications.push(row.site ? null : mods.map((mod) => ({ position: mod.position, label: mod.label })));
        best.push(probabilities);
      } else {
        const known = best[feature];
        probabilities.forEach((value, index) => {
          if (value > known[index]) known[index] = value;
        });
      }
      if (row.quantities) {
        for (const [sample, value] of Object.entries(row.quantities)) if (Number.isFinite(value) && value > 0) push(feature, sample, value);
      } else if (Number.isFinite(row.quantity) && row.quantity > 0) {
        push(feature, row.sample || 'all', row.quantity);
      }
    },
    finish() {
      // Final keys: unlocalized modifications become "?Label"; features that end up with the same
      // key merge, and sites below the threshold are left out.
      const finalKeys = [];
      const finalProteins = [];
      const finalIndex = new Map();
      const target = new Int32Array(keys.length).fill(-1);
      keys.forEach((key, feature) => {
        let final = key;
        if (key.startsWith('site|')) {
          if (best[feature][0] < localization) return;
        } else {
          const sequence = key.slice(4, key.lastIndexOf('|'));
          final = peptideFeatureKey(sequence, modifications[feature].map((mod, index) => ({ ...mod, probability: best[feature][index] })), localization);
        }
        let index = finalIndex.get(final);
        if (index === undefined) {
          index = finalKeys.length;
          finalIndex.set(final, index);
          finalKeys.push(final);
          finalProteins.push(proteins[feature]);
        }
        target[feature] = index;
      });
      const columns = samples.size;
      const matrix = new Float64Array(finalKeys.length * columns).fill(NaN);
      for (let index = 0; index < count; index += 1) {
        const row = target[featureOf[index]];
        if (row < 0) continue;
        const cell = row * columns + sampleOf[index];
        matrix[cell] = Number.isNaN(matrix[cell]) ? values[index] : matrix[cell] + values[index];
      }
      return { keys: finalKeys, proteins: finalProteins, samples: [...samples.keys()], values: matrix, rows: finalKeys.length, columns };
    },
  };
}

/* ---------- Aggregation ---------- */

// Filters rows (decoys, contaminants, q-value) and aggregates them: peptides with their
// per-sample quantities and localized sites, or site-table sites. Samples keep file order.
export function summarizeReport(report, options = {}) {
  const qCutoff = options.qValue ?? 0.01;
  const localization = options.localization ?? 0.75;
  const samples = [];
  const conditions = new Map();
  const noteSample = (sample, condition) => {
    if (!sample) return;
    if (!conditions.has(sample)) {
      samples.push(sample);
      conditions.set(sample, condition ?? '');
    }
  };
  let filtered = 0;
  const peptides = new Map();
  const sites = new Map();
  for (const row of report.rows) {
    if (row.decoy || row.contaminant) {
      filtered += 1;
      continue;
    }
    if (!row.site && Number.isFinite(row.q) && row.q > qCutoff && report.format !== 'maxquant-evidence' && report.format !== 'maxquant-peptides') {
      filtered += 1;
      continue;
    }
    if (row.site) {
      if (FIXED.has(row.label)) continue;
      const key = `${row.protein}|${row.position}|${row.label}`;
      let site = sites.get(key);
      if (!site) {
        site = { protein: row.protein, gene: row.gene, position: row.position, residue: row.residue, label: row.label, probability: NaN, count: 0, quantities: {} };
        sites.set(key, site);
      }
      site.count += 1;
      if (Number.isFinite(row.probability) && !(row.probability <= site.probability)) site.probability = row.probability;
      addQuantities(site.quantities, row, noteSample);
      continue;
    }
    let peptide = peptides.get(row.sequence);
    if (!peptide) {
      peptide = { sequence: row.sequence, proteins: row.proteins, genes: row.genes, count: 0, quantities: {}, sites: new Map() };
      peptides.set(row.sequence, peptide);
    }
    peptide.count += 1;
    addQuantities(peptide.quantities, row, noteSample);
    for (const mod of row.mods ?? []) {
      if (FIXED.has(mod.label)) continue;
      const key = `${mod.position}|${mod.label}`;
      let site = peptide.sites.get(key);
      if (!site) {
        site = { position: mod.position, label: mod.label, probability: NaN, count: 0, localized: 0, quantities: {} };
        peptide.sites.set(key, site);
      }
      site.count += 1;
      const probability = Number.isFinite(mod.probability) ? mod.probability : NaN;
      if (Number.isFinite(probability) && !(probability <= site.probability)) site.probability = probability;
      if (!Number.isFinite(probability) || probability >= localization) {
        site.localized += 1;
        addQuantities(site.quantities, row, () => {});
      }
    }
  }
  return {
    peptides: [...peptides.values()].map((peptide) => ({ ...peptide, sites: [...peptide.sites.values()].filter((site) => site.localized > 0) })),
    sites: [...sites.values()].filter((site) => !Number.isFinite(site.probability) || site.probability >= localization),
    samples,
    conditions,
    filtered,
    localization,
    qValue: qCutoff,
  };
}

function addQuantities(target, row, noteSample) {
  if (row.quantities) {
    for (const [sample, value] of Object.entries(row.quantities)) {
      noteSample(sample, row.condition);
      if (Number.isFinite(value) && value > 0) target[sample] = (target[sample] ?? 0) + value;
    }
    return;
  }
  const sample = row.sample || 'all';
  noteSample(sample, row.condition);
  if (Number.isFinite(row.quantity) && row.quantity > 0) target[sample] = (target[sample] ?? 0) + row.quantity;
}

// Per-peptide (or per-site) value for coloring: 'count' (PSMs or precursors), 'intensity' (log10 of
// the mean over the chosen samples) or 'ratio' (log2 of mean B / mean A).
export function quantValue(item, mode, groupA = [], groupB = []) {
  if (mode === 'count') return item.count;
  const mean = (samples) => {
    const values = samples.map((sample) => item.quantities[sample]).filter((value) => value > 0);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
  };
  if (mode === 'intensity') {
    const samples = groupA.length || groupB.length ? [...groupA, ...groupB] : Object.keys(item.quantities);
    const value = mean(samples);
    return value > 0 ? Math.log10(value) : NaN;
  }
  const a = mean(groupA);
  const b = mean(groupB);
  return a > 0 && b > 0 ? Math.log2(b / a) : NaN;
}
