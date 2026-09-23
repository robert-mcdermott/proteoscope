// Selection language: PyMOL-style keywords and Boolean logic plus ChimeraX-style atom specs.
//
//   chain A and resi 40-80            resn STI+ATP        name CA and not hetatm
//   within 5 of resn STI              byres (around 4.5 of ligand)
//   /A:315@OG1   #2/B:10-20   :HEM   b > 60   plddt < 70   deviation > 2
//
// parseSelection() turns text into an AST; evaluateSelection() applies it to one or more targets
// (one model per structure) and returns a per-target atom mask. The module is pure.
import { METAL_ELEMENTS } from './residues.js';

export class SelectionError extends Error {
  constructor(message, position = -1) {
    super(message);
    this.name = 'SelectionError';
    this.position = position;
  }
}

const PROTEIN_BACKBONE = new Set(['N', 'CA', 'C', 'O', 'OXT', 'H', 'H1', 'H2', 'H3', 'HA', 'HA2', 'HA3']);
const NUCLEIC_BACKBONE = new Set(['P', 'OP1', 'OP2', 'OP3', 'O1P', 'O2P', 'O3P', "O5'", "C5'", "C4'", "O4'", "C3'", "O3'", "C2'", "O2'", "C1'", "H5'", "H5''", "H4'", "H3'", "H2'", "H2''", "H1'", "HO2'", "HO3'"]);

// Keyword aliases → canonical names. PyMOL abbreviations with a trailing period are accepted.
const CLASS_KEYWORDS = {
  all: 'all', '*': 'all', none: 'none',
  protein: 'protein', nucleic: 'nucleic', polymer: 'polymer',
  ligand: 'ligand', ligands: 'ligand', organic: 'ligand', 'org.': 'ligand',
  ion: 'ion', ions: 'ion', metal: 'metal', metals: 'metal',
  water: 'water', waters: 'water', solvent: 'water', 'sol.': 'water', hoh: 'water',
  hetatm: 'hetatm', het: 'hetatm',
  hydrogen: 'hydrogen', hydrogens: 'hydrogen', hydro: 'hydrogen', 'h.': 'hydrogen',
  backbone: 'backbone', bb: 'backbone', 'bb.': 'backbone',
  sidechain: 'sidechain', sidechains: 'sidechain', sc: 'sidechain', 'sc.': 'sidechain',
  helix: 'helix', helices: 'helix', sheet: 'sheet', strand: 'sheet', strands: 'sheet', coil: 'coil', loop: 'coil', loops: 'coil', turn: 'turn',
  sele: 'selected', selected: 'selected', selection: 'selected',
  focus: 'focus', sites: 'sites', site: 'sites', covered: 'covered', aligned: 'aligned',
};

const LIST_KEYWORDS = {
  chain: 'chain', c: 'chain', 'c.': 'chain', chains: 'chain',
  resi: 'resi', resid: 'resi', residue: 'resi', residues: 'resi', 'i.': 'resi',
  resn: 'resn', resname: 'resn', 'r.': 'resn',
  name: 'name', atom: 'name', 'n.': 'name',
  elem: 'elem', element: 'elem', 'e.': 'elem',
  ss: 'ss',
  entity: 'entity',
  uniprot: 'uniprot', unp: 'uniprot',
  model: 'model', state: 'model',
  structure: 'structure', object: 'structure', 'o.': 'structure',
  id: 'serial', serial: 'serial',
};

const NUMERIC_KEYWORDS = {
  b: 'b', bfactor: 'b', 'b-factor': 'b',
  q: 'q', occupancy: 'q',
  plddt: 'plddt', confidence: 'plddt',
  deviation: 'deviation', dev: 'deviation',
  lddt: 'lddt',
  rmsf: 'rmsf',
  rsa: 'rsa', exposure: 'rsa',
};

const DISTANCE_KEYWORDS = { within: 'within', around: 'around', beyond: 'beyond' };
const EXPAND_KEYWORDS = { byres: 'byres', 'br.': 'byres', byresidue: 'byres', bychain: 'bychain', 'bc.': 'bychain' };

export const SELECTION_KEYWORDS = {
  classes: [...new Set(Object.values(CLASS_KEYWORDS))],
  lists: [...new Set(Object.values(LIST_KEYWORDS))],
  numeric: [...new Set(Object.values(NUMERIC_KEYWORDS))],
};

export function tokenizeSelection(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const start = index;
    if (char === '(' || char === ')') {
      tokens.push({ type: char, value: char, start, end: index + 1 });
      index += 1;
      continue;
    }
    if (char === '&' || char === '|') {
      const doubled = text[index + 1] === char ? 2 : 1;
      tokens.push({ type: 'op', value: char === '&' ? 'and' : 'or', start, end: index + doubled });
      index += doubled;
      continue;
    }
    const comparison = text.slice(index).match(/^(<=|>=|==|!=|<|>|=)/);
    if (comparison) {
      tokens.push({ type: 'cmp', value: comparison[1] === '==' ? '=' : comparison[1], start, end: index + comparison[1].length });
      index += comparison[1].length;
      continue;
    }
    if (char === '!') {
      tokens.push({ type: 'op', value: 'not', start, end: index + 1 });
      index += 1;
      continue;
    }
    if (char === '"') {
      const close = text.indexOf('"', index + 1);
      if (close < 0) throw new SelectionError('Unclosed quote.', index);
      tokens.push({ type: 'word', value: text.slice(index + 1, close), quoted: true, start, end: close + 1 });
      index = close + 1;
      continue;
    }
    let end = index;
    if ('/:@#'.includes(char)) {
      while (end < text.length && !/[\s()]/.test(text[end])) end += 1;
      tokens.push({ type: 'spec', value: text.slice(index, end), start, end });
    } else {
      while (end < text.length && !/[\s()<>=!&|]/.test(text[end])) end += 1;
      tokens.push({ type: 'word', value: text.slice(index, end), start, end });
    }
    index = end;
  }
  return tokens;
}

export function parseSelection(text) {
  const source = String(text ?? '').trim();
  if (!source) throw new SelectionError('Empty selection.', 0);
  const tokens = tokenizeSelection(source);
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const isWord = (token, ...values) => token?.type === 'word' && !token.quoted && values.includes(token.value.toLowerCase());
  const at = (token) => token?.start ?? source.length;

  function parseOr() {
    let left = parseAnd();
    while (peek() && (isWord(peek(), 'or') || (peek().type === 'op' && peek().value === 'or'))) {
      next();
      left = { type: 'or', left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseNot();
    for (;;) {
      const token = peek();
      if (!token || token.type === ')' || isWord(token, 'or') || (token.type === 'op' && token.value === 'or')) break;
      if (isWord(token, 'and') || (token.type === 'op' && token.value === 'and')) next();
      // Juxtaposition means AND, so "chain A resi 40-80" reads naturally.
      left = { type: 'and', left, right: parseNot() };
    }
    return left;
  }

  function parseNot() {
    const token = peek();
    if (isWord(token, 'not') || (token?.type === 'op' && token.value === 'not')) {
      next();
      return { type: 'not', operand: parseNot() };
    }
    return parsePrimary();
  }

  function expectValue(keyword) {
    const token = next();
    if (!token || (token.type !== 'word' && token.type !== 'spec')) throw new SelectionError(`"${keyword}" needs a value, for example "${keyword} ${exampleFor(keyword)}".`, at(token));
    return token;
  }

  function parsePrimary() {
    const token = next();
    if (!token) throw new SelectionError('The selection ends too early.', source.length);
    if (token.type === '(') {
      const inner = parseOr();
      const close = next();
      if (close?.type !== ')') throw new SelectionError('Missing ")".', at(close));
      return inner;
    }
    if (token.type === 'spec') return parseSpec(token);
    if (token.type !== 'word' || token.quoted) throw new SelectionError(`Unexpected "${token.value}".`, token.start);
    const word = token.value.toLowerCase();
    if (DISTANCE_KEYWORDS[word]) {
      const distanceToken = next();
      const distance = Number(distanceToken?.value);
      if (!Number.isFinite(distance) || distance < 0) throw new SelectionError(`"${word}" needs a distance in Å, for example "${word} 5 of resn STI".`, at(distanceToken));
      if (isWord(peek(), 'of')) next();
      return { type: 'distance', mode: DISTANCE_KEYWORDS[word], distance, operand: parseNot() };
    }
    if (EXPAND_KEYWORDS[word]) return { type: EXPAND_KEYWORDS[word], operand: parseNot() };
    if (CLASS_KEYWORDS[word]) return { type: 'class', name: CLASS_KEYWORDS[word] };
    if (LIST_KEYWORDS[word]) {
      const key = LIST_KEYWORDS[word];
      const valueToken = expectValue(word);
      return { type: 'list', key, values: parseList(key, valueToken) };
    }
    if (NUMERIC_KEYWORDS[word]) {
      const key = NUMERIC_KEYWORDS[word];
      const operator = next();
      if (operator?.type !== 'cmp') throw new SelectionError(`"${word}" needs a comparison, for example "${word} > 50".`, at(operator));
      const valueToken = next();
      const value = Number(valueToken?.value);
      if (!Number.isFinite(value)) throw new SelectionError(`"${word} ${operator.value}" needs a number.`, at(valueToken));
      return { type: 'compare', key, operator: operator.value, value };
    }
    throw new SelectionError(`Unknown selection keyword "${token.value}". Try chain, resi, resn, name, elem, within, byres, protein, ligand or water; separate list values with "+" or ",".`, token.start);
  }

  const ast = parseOr();
  if (position < tokens.length) throw new SelectionError(`Unexpected "${tokens[position].value}".`, tokens[position].start);
  return ast;
}

function exampleFor(keyword) {
  return { chain: 'A', resi: '40-80', resn: 'STI', name: 'CA', elem: 'FE', ss: 'helix', entity: '1', uniprot: '175', model: '1', structure: '1AKE', id: '1234' }[keyword] ?? 'A';
}

function splitList(text) {
  return text.split(/[+,]/).map((item) => item.trim()).filter(Boolean);
}

// Residue numbers: single values with optional insertion code ("100A") or inclusive ranges
// ("40-80", "-5-10", "10:20").
function parseResidueRange(item, position) {
  const range = item.match(/^(-?\d+)([A-Za-z]?)(?:[-:](-?\d+)([A-Za-z]?))?$/);
  if (!range) throw new SelectionError(`"${item}" is not a residue number or range.`, position);
  const from = Number(range[1]);
  if (range[3] === undefined) return { from, to: from, iCode: range[2].toUpperCase() || null, exactCode: Boolean(range[2]) };
  const to = Number(range[3]);
  return { from: Math.min(from, to), to: Math.max(from, to), iCode: null, exactCode: false };
}

function globPattern(value, caseSensitive) {
  if (!/[*?]/.test(value)) return caseSensitive ? { exact: value } : { exact: value.toUpperCase() };
  const pattern = value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return { regex: new RegExp(`^${pattern}$`, caseSensitive ? '' : 'i') };
}

function parseList(key, token) {
  const items = splitList(token.value);
  if (!items.length) throw new SelectionError(`"${key}" needs a value.`, token.start);
  switch (key) {
    case 'resi':
    case 'uniprot':
      return items.map((item) => parseResidueRange(item, token.start));
    case 'model':
    case 'serial':
      return items.map((item) => parseResidueRange(item, token.start));
    case 'chain':
      return items.map((item) => globPattern(item, true));
    case 'ss':
      return items.map((item) => {
        const value = item.toLowerCase();
        const ss = { h: 'helix', helix: 'helix', g: 'helix', i: 'helix', e: 'sheet', s: 'sheet', b: 'sheet', sheet: 'sheet', strand: 'sheet', t: 'turn', turn: 'turn', l: 'coil', c: 'coil', coil: 'coil', loop: 'coil', '': 'coil' }[value];
        if (!ss) throw new SelectionError(`Unknown secondary structure "${item}"; use helix, sheet, turn or coil.`, token.start);
        return ss;
      });
    case 'structure':
      return items;
    default:
      return items.map((item) => globPattern(item, false));
  }
}

// ChimeraX-style atom spec: #structure/chain:residue@atom, each part optional, lists with commas.
function parseSpec(token) {
  const parts = [...token.value.matchAll(/([#/:@])([^#/:@]*)/g)];
  if (!parts.length || parts.map((part) => part[0]).join('') !== token.value) throw new SelectionError(`Cannot read the atom spec "${token.value}".`, token.start);
  const clauses = [];
  for (const [, marker, body] of parts) {
    const items = splitList(body);
    if (!items.length) throw new SelectionError(`The atom spec "${token.value}" has an empty "${marker}" part.`, token.start);
    if (marker === '#') clauses.push({ type: 'list', key: 'structure', values: items });
    else if (marker === '/') clauses.push({ type: 'list', key: 'chain', values: items.map((item) => globPattern(item, true)) });
    else if (marker === '@') clauses.push({ type: 'list', key: 'name', values: items.map((item) => globPattern(item, false)) });
    else {
      const numbers = items.filter((item) => /^-?\d/.test(item));
      const names = items.filter((item) => !/^-?\d/.test(item));
      const options = [];
      if (numbers.length) options.push({ type: 'list', key: 'resi', values: numbers.map((item) => parseResidueRange(item, token.start)) });
      if (names.length) options.push({ type: 'list', key: 'resn', values: names.map((item) => globPattern(item, false)) });
      clauses.push(options.length === 1 ? options[0] : { type: 'or', left: options[0], right: options[1] });
    }
  }
  return clauses.reduce((left, right) => (left ? { type: 'and', left, right } : right), null);
}

/* ---------- Evaluation ---------- */

// targets: [{ id, index (1-based), name, model, structure, context }] where context may hold
//   selected, focus, sites, covered, aligned: Set of residue keys
//   values: { deviation, lddt, rmsf, rsa }: Map of residue key → number
//   uniprot(residue): UniProt position or null
// Returns Map(target id → Uint8Array atom mask over target.model.atoms).
export function evaluateSelection(ast, targets) {
  return evaluateNode(ast, targets);
}

export function selectAtoms(text, targets) {
  return evaluateSelection(parseSelection(text), targets);
}

function evaluateNode(node, targets) {
  switch (node.type) {
    case 'and':
    case 'or': {
      const left = evaluateNode(node.left, targets);
      const right = evaluateNode(node.right, targets);
      for (const target of targets) {
        const a = left.get(target.id);
        const b = right.get(target.id);
        for (let index = 0; index < a.length; index += 1) a[index] = node.type === 'and' ? a[index] & b[index] : a[index] | b[index];
      }
      return left;
    }
    case 'not': {
      const result = evaluateNode(node.operand, targets);
      for (const mask of result.values()) for (let index = 0; index < mask.length; index += 1) mask[index] = mask[index] ? 0 : 1;
      return result;
    }
    case 'distance':
      return evaluateDistance(node, targets);
    case 'byres':
    case 'bychain':
      return evaluateExpansion(node, targets);
    default:
      return evaluatePredicate(node, targets);
  }
}

function evaluatePredicate(node, targets) {
  const result = new Map();
  for (const target of targets) {
    const test = compilePredicate(node, target);
    const { model } = target;
    const mask = new Uint8Array(model.atoms.length);
    for (let index = 0; index < model.atoms.length; index += 1) {
      const atom = model.atoms[index];
      if (test(atom, model.residues[model.atomResidue[index]])) mask[index] = 1;
    }
    result.set(target.id, mask);
  }
  return result;
}

function matchesPattern(value, pattern) {
  if (pattern.regex) return pattern.regex.test(value ?? '');
  return pattern.exact === value;
}

function inRanges(number, iCode, ranges) {
  for (const range of ranges) {
    if (number < range.from || number > range.to) continue;
    if (range.exactCode && (iCode || '').toUpperCase() !== range.iCode) continue;
    if (!range.exactCode && range.from === range.to && iCode) continue;
    return true;
  }
  return false;
}

function compare(value, operator, reference) {
  if (!Number.isFinite(value)) return false;
  switch (operator) {
    case '<': return value < reference;
    case '<=': return value <= reference;
    case '>': return value > reference;
    case '>=': return value >= reference;
    case '!=': return value !== reference;
    default: return value === reference;
  }
}

function compilePredicate(node, target) {
  const context = target.context ?? {};
  if (node.type === 'class') {
    switch (node.name) {
      case 'all': return () => true;
      case 'none': return () => false;
      case 'protein': return (atom) => atom.kind === 'protein';
      case 'nucleic': return (atom) => atom.kind === 'nucleic';
      case 'polymer': return (atom) => atom.kind === 'protein' || atom.kind === 'nucleic';
      case 'ligand': return (atom) => atom.kind === 'ligand';
      case 'ion': return (atom) => atom.kind === 'ion';
      case 'metal': return (atom) => METAL_ELEMENTS.has(atom.element);
      case 'water': return (atom) => atom.kind === 'water';
      case 'hetatm': return (atom) => Boolean(atom.isHet);
      case 'hydrogen': return (atom) => Boolean(atom.isHydrogen);
      case 'backbone': return (atom) => (atom.kind === 'protein' && PROTEIN_BACKBONE.has(atom.name)) || (atom.kind === 'nucleic' && NUCLEIC_BACKBONE.has(atom.name));
      case 'sidechain': return (atom) => (atom.kind === 'protein' && !PROTEIN_BACKBONE.has(atom.name)) || (atom.kind === 'nucleic' && !NUCLEIC_BACKBONE.has(atom.name));
      case 'helix':
      case 'sheet':
      case 'turn':
      case 'coil': return (atom, residue) => (residue?.kind === 'protein') && (residue.ss ?? 'coil') === node.name;
      default: {
        const keys = context[node.name];
        return (atom, residue) => Boolean(keys?.has(residue?.key));
      }
    }
  }
  if (node.type === 'compare') {
    const { key, operator, value } = node;
    if (key === 'b') return (atom) => compare(atom.bFactor, operator, value);
    if (key === 'q') return (atom) => compare(atom.occupancy, operator, value);
    if (key === 'plddt') return (atom, residue) => compare(residue?.confidence, operator, value);
    const values = context.values?.[key];
    return (atom, residue) => compare(values?.get(residue?.key), operator, value);
  }
  const { key, values } = node;
  switch (key) {
    case 'chain': return (atom) => values.some((pattern) => matchesPattern(atom.chain, pattern));
    case 'resi': return (atom) => inRanges(atom.resSeq, atom.iCode, values);
    case 'resn': return (atom) => values.some((pattern) => matchesPattern(atom.resName.toUpperCase(), pattern));
    case 'name': return (atom) => values.some((pattern) => matchesPattern(atom.name.toUpperCase(), pattern));
    case 'elem': return (atom) => values.some((pattern) => matchesPattern(atom.element.toUpperCase(), pattern));
    case 'ss': return (atom, residue) => residue?.kind === 'protein' && values.includes(residue.ss ?? 'coil');
    case 'entity': return (atom, residue) => values.some((pattern) => matchesPattern(String(residue?.entityId ?? atom.entityId ?? '').toUpperCase(), pattern));
    case 'serial': return (atom) => inRanges(atom.serial, '', values);
    case 'model': return () => inRanges(target.model.number, '', values);
    case 'uniprot': {
      const cache = new Map();
      return (atom, residue) => {
        if (!residue) return false;
        if (!cache.has(residue)) cache.set(residue, context.uniprot?.(residue) ?? null);
        const position = cache.get(residue);
        return position !== null && inRanges(position, '', values);
      };
    }
    case 'structure': {
      const match = values.some((value) => {
        const lower = value.toLowerCase();
        if (/^\d+$/.test(value)) return Number(value) === target.index;
        const range = value.match(/^(\d+)-(\d+)$/);
        if (range) return target.index >= Number(range[1]) && target.index <= Number(range[2]);
        return String(target.name ?? '').toLowerCase() === lower || globPattern(value, false).regex?.test(target.name ?? '');
      });
      return () => match;
    }
    default:
      throw new SelectionError(`Unsupported selection keyword "${key}".`);
  }
}

// within / around / beyond: distances are measured to every atom of the operand, in any target,
// so "within 5 of #1 and resn STI" also reaches atoms of superposed structures.
function evaluateDistance(node, targets) {
  const reference = evaluateNode(node.operand, targets);
  const cell = Math.max(node.distance, 1);
  const grid = new Map();
  let any = false;
  for (const target of targets) {
    const mask = reference.get(target.id);
    const atoms = target.model.atoms;
    for (let index = 0; index < atoms.length; index += 1) {
      if (!mask[index]) continue;
      const atom = atoms[index];
      const key = `${Math.floor(atom.x / cell)},${Math.floor(atom.y / cell)},${Math.floor(atom.z / cell)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(atom);
      any = true;
    }
  }
  const limit = node.distance * node.distance;
  const result = new Map();
  for (const target of targets) {
    const atoms = target.model.atoms;
    const own = reference.get(target.id);
    const mask = new Uint8Array(atoms.length);
    for (let index = 0; index < atoms.length; index += 1) {
      const atom = atoms[index];
      let near = false;
      if (any) {
        const gx = Math.floor(atom.x / cell);
        const gy = Math.floor(atom.y / cell);
        const gz = Math.floor(atom.z / cell);
        for (let dx = -1; dx <= 1 && !near; dx += 1) {
          for (let dy = -1; dy <= 1 && !near; dy += 1) {
            for (let dz = -1; dz <= 1 && !near; dz += 1) {
              const bucket = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
              if (!bucket) continue;
              for (const other of bucket) {
                const ex = atom.x - other.x;
                const ey = atom.y - other.y;
                const ez = atom.z - other.z;
                if (ex * ex + ey * ey + ez * ez <= limit) {
                  near = true;
                  break;
                }
              }
            }
          }
        }
      }
      if (node.mode === 'within') mask[index] = near ? 1 : 0;
      else if (node.mode === 'around') mask[index] = near && !own[index] ? 1 : 0;
      else mask[index] = near ? 0 : 1;
    }
    result.set(target.id, mask);
  }
  return result;
}

function evaluateExpansion(node, targets) {
  const inner = evaluateNode(node.operand, targets);
  for (const target of targets) {
    const mask = inner.get(target.id);
    const { model } = target;
    if (node.type === 'byres') {
      const residues = new Set();
      for (let index = 0; index < mask.length; index += 1) if (mask[index]) residues.add(model.atomResidue[index]);
      for (let index = 0; index < mask.length; index += 1) if (residues.has(model.atomResidue[index])) mask[index] = 1;
    } else {
      const chains = new Set();
      for (let index = 0; index < mask.length; index += 1) if (mask[index]) chains.add(model.atoms[index].chain);
      for (let index = 0; index < mask.length; index += 1) if (chains.has(model.atoms[index].chain)) mask[index] = 1;
    }
  }
  return inner;
}

// Residue keys with at least one selected atom.
export function residueKeysFromMask(model, mask) {
  const keys = new Set();
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) keys.add(model.residues[model.atomResidue[index]].key);
  }
  return keys;
}

export function countMask(mask) {
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) count += mask[index];
  return count;
}

// Quick check used to decide whether search-box text should be offered as a selection.
export function looksLikeSelection(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return false;
  if (/^[#/:@]/.test(trimmed)) return true;
  const first = trimmed.split(/[\s(<>=!]/)[0].toLowerCase();
  return Boolean(CLASS_KEYWORDS[first] || LIST_KEYWORDS[first] || NUMERIC_KEYWORDS[first] || DISTANCE_KEYWORDS[first] || EXPAND_KEYWORDS[first] || first === 'not' || trimmed.startsWith('('));
}
