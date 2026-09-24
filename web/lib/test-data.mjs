// Bundled examples for the tests. The examples are gzipped mmCIF: exampleText() decompresses one,
// examplePDB() rewrites it as legacy PDB text (ATOM/HETATM, MODEL, HELIX and SHEET records) for
// tests that read fixed columns, and editCIF() moves, renames, renumbers or drops atoms in mmCIF
// text before it is parsed.
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { cifTable, parseCIFDocument } from './parse.js';
import { transformPoint } from './superpose.js';

export const DATA_DIR = new URL('../../data/', import.meta.url);

// Wall-clock limits in performance tests are multiplied by PROTEOSCOPE_TIME_SCALE (for example 5 on
// shared CI runners, which are several times slower than a developer's machine).
export const TIME_SCALE = Math.max(1, Number(process.env.PROTEOSCOPE_TIME_SCALE) || 1);

export function exampleFiles() {
  return readdirSync(DATA_DIR).filter((name) => /\.(pdb|cif)(\.gz)?$/i.test(name)).sort();
}

function stem(name) {
  return name.toLowerCase().replace(/\.gz$/, '').replace(/\.(pdb|cif)$/, '');
}

// "4hhb" (or "4hhb.pdb", as the tests named the old files) → the decompressed text.
export function exampleText(id) {
  const wanted = stem(id);
  const file = exampleFiles().find((name) => stem(name) === wanted);
  if (!file) throw new Error(`No bundled example ${id}`);
  const bytes = readFileSync(new URL(file, DATA_DIR));
  return (file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
}

export function examplePDB(id) {
  const cif = parseCIFDocument(exampleText(id));
  const lines = [...helixRecords(cif), ...sheetRecords(cif)];
  const atoms = cifTable(cif, 'atom_site');
  const column = (name) => atoms.column(name);
  const get = Object.fromEntries([
    'group_pdb', 'id', 'type_symbol', 'auth_atom_id', 'label_atom_id', 'label_alt_id', 'auth_comp_id', 'label_comp_id',
    'auth_asym_id', 'auth_seq_id', 'pdbx_pdb_ins_code', 'cartn_x', 'cartn_y', 'cartn_z', 'occupancy', 'b_iso_or_equiv', 'pdbx_pdb_model_num',
  ].map((name) => [name, column(name)]));
  const value = (name, row) => {
    const text = get[name](row);
    return text === '?' || text === '.' ? '' : text;
  };
  const models = new Set();
  for (let row = 0; row < atoms.rowCount; row += 1) models.add(value('pdbx_pdb_model_num', row) || '1');
  const multiple = models.size > 1;
  let model = null;
  for (let row = 0; row < atoms.rowCount; row += 1) {
    const number = value('pdbx_pdb_model_num', row) || '1';
    if (number !== model) {
      if (model !== null && multiple) lines.push('ENDMDL');
      model = number;
      if (multiple) lines.push(`MODEL     ${number.padStart(4)}`);
    }
    const element = value('type_symbol', row).toUpperCase();
    const name = value('auth_atom_id', row) || value('label_atom_id', row);
    const paddedName = name.length < 4 && element.length === 1 ? ` ${name}`.padEnd(4) : name.padEnd(4).slice(0, 4);
    const coordinate = (axis) => Number(value(`cartn_${axis}`, row)).toFixed(3).padStart(8);
    lines.push([
      (value('group_pdb', row) || 'ATOM').padEnd(6),
      String(Number(value('id', row)) % 100000).padStart(5),
      ' ',
      paddedName,
      (value('label_alt_id', row) || ' ').slice(0, 1),
      (value('auth_comp_id', row) || value('label_comp_id', row)).padStart(3).slice(-3),
      ' ',
      (value('auth_asym_id', row) || ' ').slice(0, 1),
      value('auth_seq_id', row).padStart(4),
      (value('pdbx_pdb_ins_code', row) || ' ').slice(0, 1),
      '   ',
      coordinate('x'),
      coordinate('y'),
      coordinate('z'),
      Number(value('occupancy', row) || 1).toFixed(2).padStart(6),
      Number(value('b_iso_or_equiv', row) || 0).toFixed(2).padStart(6),
      '          ',
      element.padStart(2),
    ].join(''));
  }
  if (multiple) lines.push('ENDMDL');
  lines.push('END');
  return `${lines.join('\n')}\n`;
}

function rangeRows(cif, category, filter = () => true) {
  const table = cifTable(cif, category);
  const rows = [];
  const read = (name) => table.column(name);
  const columns = Object.fromEntries(['conf_type_id', 'beg_auth_comp_id', 'beg_auth_asym_id', 'beg_auth_seq_id', 'pdbx_beg_pdb_ins_code',
    'end_auth_comp_id', 'end_auth_asym_id', 'end_auth_seq_id', 'pdbx_end_pdb_ins_code'].map((name) => [name, read(name)]));
  for (let row = 0; row < table.rowCount; row += 1) {
    const item = Object.fromEntries(Object.entries(columns).map(([name, get]) => [name, ['?', '.'].includes(get(row)) ? '' : get(row)]));
    if (filter(item)) rows.push(item);
  }
  return rows;
}

// HELIX: residue name at 15, chain at 19, number at 21–24, insertion code at 25; end at 27/31/33/37.
function helixRecords(cif) {
  return rangeRows(cif, 'struct_conf', (row) => row.conf_type_id.startsWith('HELX')).map((row, index) => {
    const line = Array(76).fill(' ');
    place(line, 0, 'HELIX ');
    place(line, 7, String(index + 1).padStart(3));
    placeEnds(line, row, 15, 19, 21, 27, 31, 33);
    return line.join('');
  });
}

// SHEET: residue name at 17, chain at 21, number at 22–25, insertion code at 26; end at 28/32/33/37.
function sheetRecords(cif) {
  return rangeRows(cif, 'struct_sheet_range').map((row, index) => {
    const line = Array(76).fill(' ');
    place(line, 0, 'SHEET ');
    place(line, 7, String(index + 1).padStart(3));
    placeEnds(line, row, 17, 21, 22, 28, 32, 33);
    return line.join('');
  });
}

function placeEnds(line, row, begName, begChain, begSeq, endName, endChain, endSeq) {
  place(line, begName, row.beg_auth_comp_id.padStart(3));
  place(line, begChain, row.beg_auth_asym_id.slice(0, 1));
  place(line, begSeq, row.beg_auth_seq_id.padStart(4));
  place(line, begSeq + 4, row.pdbx_beg_pdb_ins_code.slice(0, 1));
  place(line, endName, row.end_auth_comp_id.padStart(3));
  place(line, endChain, row.end_auth_asym_id.slice(0, 1));
  place(line, endSeq, row.end_auth_seq_id.padStart(4));
  place(line, endSeq + 4, row.pdbx_end_pdb_ins_code.slice(0, 1));
}

function place(line, start, text) {
  for (let index = 0; index < text.length; index += 1) line[start + index] = text[index];
}

// Rewrites the atom_site rows of mmCIF text: an optional rigid transform, author chain relabeling
// and renumbering, a chain filter and a per-chain shift (applied before the transform).
export function editCIF(text, { transform = null, chains = null, renumber = 0, only = null, shift = null } = {}) {
  const lines = text.split('\n');
  const columns = [];
  const output = [];
  let inAtoms = false;
  for (const line of lines) {
    if (line.startsWith('_atom_site.')) {
      columns.push(line.slice('_atom_site.'.length).trim().toLowerCase());
      inAtoms = true;
      output.push(line);
      continue;
    }
    if (inAtoms && /^(ATOM|HETATM)\s/.test(line)) {
      const fields = line.trim().split(/\s+/);
      const at = (name) => columns.indexOf(name);
      const chainColumn = at('auth_asym_id');
      const chain = fields[chainColumn];
      if (only && !only.includes(chain)) continue;
      let [x, y, z] = ['cartn_x', 'cartn_y', 'cartn_z'].map((name) => Number(fields[at(name)]));
      if (shift?.[chain]) [x, y, z] = [x + shift[chain][0], y + shift[chain][1], z + shift[chain][2]];
      if (transform) [x, y, z] = transformPoint(transform, x, y, z);
      [x, y, z].forEach((coordinate, axis) => {
        fields[at(['cartn_x', 'cartn_y', 'cartn_z'][axis])] = coordinate.toFixed(3);
      });
      if (chains?.[chain]) fields[chainColumn] = chains[chain];
      if (renumber) fields[at('auth_seq_id')] = String(Number(fields[at('auth_seq_id')]) + renumber);
      output.push(fields.join(' '));
      continue;
    }
    if (inAtoms && line.startsWith('#')) inAtoms = false;
    output.push(line);
  }
  return output.join('\n');
}

// Minimal MessagePack encoder for building BinaryCIF test files.
export function packMessagePack(value) {
  const parts = [];
  const push = (...bytes) => parts.push(Uint8Array.from(bytes));
  const encode = (item) => {
    if (item === null) return push(0xc0);
    if (item instanceof Uint8Array) {
      push(0xc6, (item.length >>> 24) & 255, (item.length >>> 16) & 255, (item.length >>> 8) & 255, item.length & 255);
      parts.push(item);
      return undefined;
    }
    if (typeof item === 'number') {
      if (Number.isInteger(item) && item >= 0 && item < 128) return push(item);
      if (Number.isInteger(item) && item < 0 && item >= -32) return push(item & 0xff);
      if (Number.isInteger(item) && Math.abs(item) < 2 ** 31) {
        const bytes = new Uint8Array(5);
        bytes[0] = 0xd2;
        new DataView(bytes.buffer).setInt32(1, item);
        parts.push(bytes);
        return undefined;
      }
      const bytes = new Uint8Array(9);
      bytes[0] = 0xcb;
      new DataView(bytes.buffer).setFloat64(1, item);
      parts.push(bytes);
      return undefined;
    }
    if (typeof item === 'boolean') return push(item ? 0xc3 : 0xc2);
    if (typeof item === 'string') {
      const bytes = new TextEncoder().encode(item);
      push(0xdb, (bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255);
      parts.push(bytes);
      return undefined;
    }
    if (Array.isArray(item)) {
      push(0xdd, (item.length >>> 24) & 255, (item.length >>> 16) & 255, (item.length >>> 8) & 255, item.length & 255);
      for (const element of item) encode(element);
      return undefined;
    }
    const keys = Object.keys(item);
    push(0xdf, (keys.length >>> 24) & 255, (keys.length >>> 16) & 255, (keys.length >>> 8) & 255, keys.length & 255);
    for (const key of keys) {
      encode(key);
      encode(item[key]);
    }
    return undefined;
  };
  encode(value);
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
