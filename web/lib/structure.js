import { elementInfo } from './elements.js';
import { dihedralAngle } from './math3d.js';
import { assignDSSP, DSSP_CARTOON } from './dssp.js';
import {
  ASYMMETRIC_UNIT_ID,
  addAtomToModel,
  applyOperationToPoint,
  atomLookupKey,
  createModel,
  makeResidueKey,
  naturalCompare,
  parseIntSafe,
} from './parse.js';
import { METAL_ELEMENTS, isModifiedResidue, oneLetterCode, parentResidue } from './residues.js';

export const MAX_ASSEMBLY_ATOMS = 300000;

const PROTEIN_BACKBONE_NAMES = new Set(['N', 'CA', 'C', 'O', 'OXT']);
const HEAVY_BOND_ELEMENTS = new Set(['S', 'SE', 'P', 'CL', 'BR', 'I', 'AS', 'SI']);

export function deriveStructure(structure, options = {}) {
  for (const model of structure.models) deriveModel(model, structure, options);
  const first = structure.models[0];
  structure.residues = first.residues;
  structure.chains = buildChains(first, structure);
  structure.sequences = new Map(structure.chains
    .filter((chain) => chain.polymerKind)
    .map((chain) => [chain.id, buildChainSequence(structure, first, chain)]));
  structure.searchItems = null;
  structure.hasFileSecondary = structure.secondaryRanges.length > 0;
  return structure;
}

export function deriveModel(model, structure, options = {}) {
  model.residues = buildModelResidues(model, structure);
  model.residueMap = new Map(model.residues.map((residue) => [residue.key, residue]));
  model.atomResidue = new Int32Array(model.atoms.length);
  model.residues.forEach((residue, index) => {
    residue.index = index;
    for (const atom of residue.atoms) model.atomResidue[atom.id] = index;
  });
  assignSecondary(model, structure, options.secondaryMode ?? 'auto');
  computeBackboneAngles(model.residues);
  model.bonds = buildBonds(model, structure.conect);
  model.bounds = computeBounds(model.atoms);
  model.bFactorRange = computeBFactorRange(model.atoms);
  // Some predictors write pLDDT to the B-factor column on a 0–1 scale.
  if (structure.meta?.isPredicted && !structure.residueConfidence?.size && model.bFactorRange.max <= 1) {
    for (const residue of model.residues) if (Number.isFinite(residue.confidence)) residue.confidence *= 100;
  }
  model.cartoonCache = new Map();
}

export function buildModelResidues(model, structure) {
  const residues = new Map();
  for (const atom of model.atoms) {
    let residue = residues.get(atom.residueKey);
    if (!residue) {
      residue = {
        key: atom.residueKey,
        index: 0,
        modelID: model.number,
        chain: atom.chain,
        sourceChain: atom.sourceChain || atom.chain,
        authChain: atom.authChain || atom.chain,
        labelChain: atom.labelChain || atom.chain,
        entityId: atom.entityId || '',
        resName: atom.resName,
        parent: parentResidue(atom.resName),
        code: oneLetterCode(atom.resName),
        resSeq: atom.resSeq,
        authSeq: atom.authSeq || String(atom.resSeq),
        labelSeq: atom.labelSeq || '',
        iCode: atom.iCode,
        kind: atom.kind,
        polymerType: atom.polymerType,
        isHet: atom.isHet,
        isWater: atom.isWater,
        modified: isModifiedResidue(atom.resName),
        atoms: [],
        atomByName: new Map(),
        backbone: {},
        representative: null,
        linkedToPrevious: false,
        ss: 'coil',
        ssSource: 'none',
        dssp: '',
        phi: NaN,
        psi: NaN,
        bFactor: 0,
        occupancy: 0,
        confidence: NaN,
      };
      residues.set(atom.residueKey, residue);
    }
    residue.atoms.push(atom);
    if (!residue.atomByName.has(atom.name)) residue.atomByName.set(atom.name, atom);
    residue.bFactor += atom.bFactor;
    residue.occupancy += atom.occupancy;
  }

  const sorted = [...residues.values()].sort(compareResidues);
  promoteModifiedPolymerResidues(sorted);
  for (const residue of sorted) finalizeResidue(residue, structure);
  linkPolymerResidues(sorted);
  return sorted;
}

function finalizeResidue(residue, structure) {
  const count = Math.max(1, residue.atoms.length);
  residue.bFactor /= count;
  residue.occupancy /= count;
  if (residue.kind === 'protein') {
    for (const name of PROTEIN_BACKBONE_NAMES) {
      const atom = residue.atomByName.get(name);
      if (atom) residue.backbone[name] = atom;
    }
  }
  if (residue.kind === 'nucleic') {
    residue.nucleic = {
      P: residue.atomByName.get('P'),
      C4: residue.atomByName.get("C4'") ?? residue.atomByName.get('C4*'),
      C3: residue.atomByName.get("C3'") ?? residue.atomByName.get('C3*'),
      C1: residue.atomByName.get("C1'") ?? residue.atomByName.get('C1*'),
      O3: residue.atomByName.get("O3'") ?? residue.atomByName.get('O3*'),
    };
  }
  residue.representative =
    residue.backbone.CA ??
    residue.nucleic?.C4 ??
    residue.nucleic?.P ??
    residue.atoms.find((atom) => !atom.isHydrogen) ??
    residue.atoms[0];
  const confidenceKey = `${residue.labelChain}:${residue.labelSeq}`;
  if (structure.residueConfidence?.has(confidenceKey)) {
    residue.confidence = structure.residueConfidence.get(confidenceKey);
  } else if (structure.meta?.isPredicted && residue.kind !== 'water') {
    residue.confidence = residue.representative?.bFactor ?? residue.bFactor;
  }
}

// Residues whose names are not standard but carry a linked peptide or sugar-phosphate backbone
// (selenomethionine, phosphoresidues, modified nucleotides) belong to the polymer.
function promoteModifiedPolymerResidues(residues) {
  for (let index = 0; index < residues.length; index += 1) {
    const residue = residues[index];
    if (residue.kind !== 'ligand') continue;
    const names = residue.atomByName;
    const previous = residues[index - 1]?.chain === residue.chain ? residues[index - 1] : null;
    const next = residues[index + 1]?.chain === residue.chain ? residues[index + 1] : null;
    if (names.has('N') && names.has('CA') && names.has('C')) {
      const linked =
        (previous && atomDistance(previous.atomByName.get('C'), names.get('N')) <= 2.0) ||
        (next && atomDistance(names.get('C'), next.atomByName.get('N')) <= 2.0);
      if (linked) setResidueKind(residue, 'protein');
    } else if (names.has('P') && (names.has("C4'") || names.has('C4*')) && (names.has("C1'") || names.has('C1*'))) {
      const o3 = (item) => item?.atomByName.get("O3'") ?? item?.atomByName.get('O3*');
      const linked =
        (previous && atomDistance(o3(previous), names.get('P')) <= 2.0) ||
        (next && atomDistance(o3(residue), next.atomByName.get('P')) <= 2.0);
      if (linked) setResidueKind(residue, 'nucleic');
    }
  }
}

function setResidueKind(residue, kind) {
  residue.kind = kind;
  residue.polymerType = kind;
  residue.modified = true;
  for (const atom of residue.atoms) {
    atom.kind = kind;
    atom.polymerType = kind;
  }
}

function linkPolymerResidues(residues) {
  for (let index = 1; index < residues.length; index += 1) {
    const previous = residues[index - 1];
    const residue = residues[index];
    if (previous.chain !== residue.chain || previous.kind !== residue.kind) continue;
    if (residue.kind === 'protein') {
      const c = previous.backbone.C;
      const n = residue.backbone.N;
      if (c && n) {
        residue.linkedToPrevious = atomDistance(c, n) <= 2.1;
      } else if (previous.backbone.CA && residue.backbone.CA) {
        residue.linkedToPrevious = atomDistance(previous.backbone.CA, residue.backbone.CA) <= 4.4;
      }
    } else if (residue.kind === 'nucleic') {
      const o3 = previous.nucleic?.O3;
      const p = residue.nucleic?.P;
      if (o3 && p) {
        residue.linkedToPrevious = atomDistance(o3, p) <= 2.2;
      } else {
        const a = previous.nucleic?.P ?? previous.nucleic?.C4;
        const b = residue.nucleic?.P ?? residue.nucleic?.C4;
        residue.linkedToPrevious = Boolean(a && b && atomDistance(a, b) <= 8.2);
      }
    }
  }
}

export function compareResidues(a, b) {
  return naturalCompare(a.chain, b.chain) ||
    a.resSeq - b.resSeq ||
    compareInsertionCode(a.iCode, b.iCode) ||
    a.resName.localeCompare(b.resName);
}

function compareInsertionCode(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left && !right) return 0;
  if (!right) return 1;
  if (!left) return -1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

export function assignSecondary(model, structure, mode = 'auto') {
  for (const residue of model.residues) {
    residue.ss = 'coil';
    residue.ssSource = 'none';
  }
  const codes = assignDSSP(model.residues);
  model.residues.forEach((residue, index) => {
    residue.dssp = codes[index] || '';
  });
  const useFile = mode === 'file' || (mode === 'auto' && structure.secondaryRanges.length > 0);
  if (useFile) {
    applySecondaryRanges(model.residues, structure.secondaryRanges);
  } else {
    for (const residue of model.residues) {
      if (residue.kind !== 'protein' || !residue.backbone.CA) continue;
      if (residue.backbone.N && residue.backbone.C) {
        residue.ss = DSSP_CARTOON[residue.dssp] ?? 'coil';
        residue.ssSource = 'DSSP';
      }
    }
    assignCATraceSecondary(model.residues);
  }
  for (const residue of model.residues) {
    for (const atom of residue.atoms) {
      atom.ss = residue.ss;
      atom.ssSource = residue.ssSource;
    }
  }
}

function applySecondaryRanges(residues, ranges) {
  const byChain = new Map();
  for (const residue of residues) {
    if (residue.kind !== 'protein') continue;
    for (const chain of new Set([residue.sourceChain, residue.authChain, residue.labelChain])) {
      if (!byChain.has(chain)) byChain.set(chain, []);
      byChain.get(chain).push(residue);
    }
  }
  for (const range of ranges) {
    const candidates = new Set();
    for (const chain of [range.chain, range.authChain, range.labelChain, range.endChain]) {
      for (const residue of byChain.get(chain) ?? []) candidates.add(residue);
    }
    for (const residue of candidates) {
      if (!residueInSecondaryRange(residue, range)) continue;
      residue.ss = range.kind;
      residue.ssSource = range.source || 'file annotation';
    }
  }
}

function residueInSecondaryRange(residue, range) {
  if (range.labelChain && !range.authChain && residue.labelChain === range.labelChain && residue.labelSeq) {
    return sequenceInRange(parseIntSafe(residue.labelSeq), residue.iCode, range.labelStart || range.start, range.startICode, range.labelEnd || range.end, range.endICode);
  }
  const chainMatches = [range.chain, range.authChain, range.endChain].includes(residue.sourceChain) ||
    [range.chain, range.authChain, range.endChain].includes(residue.authChain);
  if (!chainMatches) return false;
  return sequenceInRange(residue.resSeq, residue.iCode, range.authStart || range.start, range.startICode, range.authEnd || range.end, range.endICode);
}

function sequenceInRange(seq, iCode, start, startICode, end, endICode) {
  if (!Number.isFinite(seq) || !start || !end) return false;
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  if (seq < low || seq > high) return false;
  if (seq === start && startICode && compareInsertionCode(iCode, startICode) < 0) return false;
  if (seq === end && endICode && compareInsertionCode(iCode, endICode) > 0) return false;
  return true;
}

// C-alpha-only chains cannot use DSSP, so approximate helices and strands from CA geometry.
function assignCATraceSecondary(residues) {
  const segments = polymerSegments(residues, 'protein').filter((segment) => segment.every((residue) => residue.ssSource === 'none'));
  for (const segment of segments) {
    const computed = new Map();
    const mark = (index, kind) => {
      if (!computed.has(index)) computed.set(index, new Set());
      computed.get(index).add(kind);
    };
    for (let index = 0; index + 3 < segment.length; index += 1) {
      const d03 = atomDistance(segment[index].backbone.CA, segment[index + 3].backbone.CA);
      const d04 = index + 4 < segment.length ? atomDistance(segment[index].backbone.CA, segment[index + 4].backbone.CA) : Infinity;
      if (d03 >= 4.7 && d03 <= 6.4 && (!Number.isFinite(d04) || d04 <= 7.4)) {
        for (let offset = 0; offset <= 3; offset += 1) mark(index + offset, 'helix');
      }
    }
    for (let index = 1; index + 1 < segment.length; index += 1) {
      const previous = segment[index - 1].backbone.CA;
      const current = segment[index].backbone.CA;
      const next = segment[index + 1].backbone.CA;
      const angle = angleAt(previous, current, next);
      const span = atomDistance(previous, next);
      if (angle >= 105 && span >= 5.7) mark(index, 'sheet');
    }
    for (const [kind, minLength] of [['helix', 4], ['sheet', 3]]) {
      let run = [];
      const flush = () => {
        if (run.length >= minLength) {
          for (const index of run) {
            if (segment[index].ssSource !== 'none') continue;
            segment[index].ss = kind;
            segment[index].ssSource = 'CA geometry';
          }
        }
        run = [];
      };
      for (let index = 0; index < segment.length; index += 1) {
        if (computed.get(index)?.has(kind)) run.push(index);
        else flush();
      }
      flush();
    }
  }
}

export function polymerSegments(residues, kind, include = null) {
  const segments = [];
  let current = [];
  for (const residue of residues) {
    const usable = residue.kind === kind && (kind === 'protein' ? residue.backbone.CA : (residue.nucleic?.P || residue.nucleic?.C4));
    if (!usable || (include && !include(residue))) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    if (current.length && (!residue.linkedToPrevious || current[current.length - 1].chain !== residue.chain)) {
      segments.push(current);
      current = [];
    }
    current.push(residue);
  }
  if (current.length) segments.push(current);
  return segments;
}

function computeBackboneAngles(residues) {
  for (let index = 0; index < residues.length; index += 1) {
    const residue = residues[index];
    if (residue.kind !== 'protein') continue;
    const { N, CA, C } = residue.backbone;
    if (!N || !CA || !C) continue;
    const previous = residue.linkedToPrevious ? residues[index - 1] : null;
    const next = residues[index + 1]?.linkedToPrevious ? residues[index + 1] : null;
    if (previous?.backbone.C) {
      residue.phi = degrees(dihedralAngle(point(previous.backbone.C), point(N), point(CA), point(C)));
      // ω of the preceding peptide bond tells cis from trans prolines.
      if (previous.backbone.CA) residue.omega = degrees(dihedralAngle(point(previous.backbone.CA), point(previous.backbone.C), point(N), point(CA)));
    }
    if (next?.backbone.N) {
      residue.psi = degrees(dihedralAngle(point(N), point(CA), point(C), point(next.backbone.N)));
      residue.beforeProline = (next.parent ?? next.resName) === 'PRO';
    }
  }
}

export function buildBonds(model, connections = []) {
  const atoms = model.atoms;
  const count = atoms.length;
  const bonds = [];
  const seen = new Set();
  const addBond = (a, b, kind) => {
    if (a === b || a === undefined || b === undefined) return;
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    const key = low * count + high;
    if (seen.has(key)) return;
    seen.add(key);
    bonds.push({ a: low, b: high, kind });
  };
  for (const bond of model.precomputedBonds ?? []) addBond(bond.a, bond.b, bond.kind ?? 'covalent');
  for (const connection of connections) {
    const [a, b] = resolveConnection(model, connection);
    if (a === undefined || b === undefined) continue;
    const type = Array.isArray(connection) ? '' : connection.type;
    addBond(a, b, type === 'metalc' || isMetalPair(atoms[a], atoms[b]) ? 'metal' : 'covalent');
  }
  if (!count) return bonds;

  const cellSize = 2.9;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  for (const atom of atoms) {
    if (atom.x < minX) minX = atom.x;
    if (atom.y < minY) minY = atom.y;
    if (atom.z < minZ) minZ = atom.z;
  }
  const cellX = new Int32Array(count);
  const cellY = new Int32Array(count);
  const cellZ = new Int32Array(count);
  const buckets = new Map();
  for (let index = 0; index < count; index += 1) {
    const atom = atoms[index];
    const ix = Math.floor((atom.x - minX) / cellSize);
    const iy = Math.floor((atom.y - minY) / cellSize);
    const iz = Math.floor((atom.z - minZ) / cellSize);
    cellX[index] = ix;
    cellY[index] = iy;
    cellZ[index] = iz;
    const key = cellKey(ix, iy, iz);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  }
  for (let index = 0; index < count; index += 1) {
    const atom = atoms[index];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = buckets.get(cellKey(cellX[index] + dx, cellY[index] + dy, cellZ[index] + dz));
          if (!bucket) continue;
          for (const other of bucket) {
            if (other <= index) continue;
            const kind = inferBondKind(atom, atoms[other]);
            if (kind) addBond(index, other, kind);
          }
        }
      }
    }
  }
  return bonds;
}

function cellKey(ix, iy, iz) {
  return (ix + 1) * 1099511627776 + (iy + 1) * 1048576 + (iz + 1);
}

function resolveConnection(model, connection) {
  if (Array.isArray(connection)) return [model.serialToIndex.get(connection[0]), model.serialToIndex.get(connection[1])];
  return [firstMappedIndex(model.atomKeyToIndex, connection.aKeys), firstMappedIndex(model.atomKeyToIndex, connection.bKeys)];
}

function firstMappedIndex(map, keys) {
  for (const key of keys ?? []) {
    if (map.has(key)) return map.get(key);
  }
  return undefined;
}

function isMetalPair(a, b) {
  return Boolean(a && b) && (METAL_ELEMENTS.has(a.element) !== METAL_ELEMENTS.has(b.element));
}

export function inferBondKind(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 < 0.16 || d2 > 8.41) return '';
  const waterA = a.kind === 'water';
  const waterB = b.kind === 'water';
  if ((waterA || waterB) && a.residueKey !== b.residueKey) return '';
  if (a.isHydrogen && b.isHydrogen) return '';
  if (a.isHydrogen || b.isHydrogen) return d2 <= 1.69 ? 'covalent' : '';
  const metalA = METAL_ELEMENTS.has(a.element);
  const metalB = METAL_ELEMENTS.has(b.element);
  if (metalA && metalB) return '';
  if (metalA || metalB) {
    const other = metalA ? b : a;
    const limit = other.element === 'C' ? 2.3 : 2.8;
    return d2 <= limit * limit ? 'metal' : '';
  }
  if (a.chain !== b.chain) {
    const ligandLink = a.kind === 'ligand' || b.kind === 'ligand';
    const disulfide = a.element === 'S' && b.element === 'S';
    if (!ligandLink && !disulfide) return '';
  }
  const heavy = HEAVY_BOND_ELEMENTS.has(a.element) || HEAVY_BOND_ELEMENTS.has(b.element);
  const cap = heavy ? 2.25 : 2.05;
  const limit = Math.min(cap, (elementInfo(a.element).covalent + elementInfo(b.element).covalent) * 1.28 + 0.18);
  return d2 <= limit * limit ? 'covalent' : '';
}

export function computeBounds(atoms) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const atom of atoms) {
    if (atom.x < min[0]) min[0] = atom.x;
    if (atom.y < min[1]) min[1] = atom.y;
    if (atom.z < min[2]) min[2] = atom.z;
    if (atom.x > max[0]) max[0] = atom.x;
    if (atom.y > max[1]) max[1] = atom.y;
    if (atom.z > max[2]) max[2] = atom.z;
  }
  if (!atoms.length) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1 };
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let radius2 = 1;
  for (const atom of atoms) {
    const dx = atom.x - center[0];
    const dy = atom.y - center[1];
    const dz = atom.z - center[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > radius2) radius2 = d2;
  }
  return { min, max, center, radius: Math.sqrt(radius2) };
}

export function computeBFactorRange(atoms) {
  let min = Infinity;
  let max = -Infinity;
  for (const atom of atoms) {
    if (atom.kind === 'water') continue;
    if (atom.bFactor < min) min = atom.bFactor;
    if (atom.bFactor > max) max = atom.bFactor;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return { min: 0, max: Math.max(1, max || 1) };
  return { min, max };
}

export function buildChains(model, structure) {
  const chains = new Map();
  for (const residue of model.residues) {
    if (!chains.has(residue.chain)) {
      chains.set(residue.chain, {
        id: residue.chain,
        sourceChain: residue.sourceChain,
        atoms: 0,
        residues: 0,
        polymerResidues: 0,
        kinds: { protein: 0, nucleic: 0, ligand: 0, ion: 0, water: 0 },
        ligands: new Set(),
        entityId: '',
        description: '',
        polymerKind: '',
      });
    }
    const chain = chains.get(residue.chain);
    chain.atoms += residue.atoms.length;
    chain.residues += 1;
    chain.kinds[residue.kind] = (chain.kinds[residue.kind] ?? 0) + 1;
    if (residue.kind === 'protein' || residue.kind === 'nucleic') chain.polymerResidues += 1;
    if (residue.kind === 'ligand' || residue.kind === 'ion') chain.ligands.add(residue.resName);
    if (!chain.entityId && residue.entityId && (residue.kind === 'protein' || residue.kind === 'nucleic')) chain.entityId = residue.entityId;
  }
  const list = [...chains.values()].sort((a, b) => naturalCompare(a.id, b.id));
  for (const chain of list) {
    chain.polymerKind = chain.kinds.protein >= chain.kinds.nucleic ? (chain.kinds.protein ? 'protein' : '') : 'nucleic';
    const entityId = chain.entityId || structure.chainEntities.get(chain.sourceChain) || '';
    chain.entityId = entityId;
    const entity = structure.entities.find((item) => item.id === entityId);
    chain.description = entity?.description ?? '';
    if (!chain.polymerKind) {
      chain.description = chain.description || [...chain.ligands].slice(0, 4).join(', ') || (chain.kinds.water ? 'Water' : '');
    }
  }
  return list;
}

export function buildChainSequence(structure, model, chain) {
  const residues = model.residues.filter((residue) => residue.chain === chain.id && residue.kind === chain.polymerKind);
  const declared = structure.chainSequences.get(chain.sourceChain);
  const items = [];
  let source = 'model';
  if (declared?.labelNumbers) {
    source = declared.source;
    const byLabel = new Map(residues.map((residue) => [residue.labelSeq, residue]));
    declared.residues.forEach((name, index) => {
      const residue = byLabel.get(String(declared.labelNumbers[index])) ?? null;
      items.push({ code: oneLetterCode(name), resName: name, residue });
    });
  } else if (declared?.residues?.length) {
    source = declared.source;
    const mapping = alignResidueNames(declared.residues, residues.map((residue) => residue.resName));
    declared.residues.forEach((name, index) => {
      const observed = mapping[index];
      items.push({ code: oneLetterCode(name), resName: name, residue: observed >= 0 ? residues[observed] : null });
    });
    const used = new Set(mapping.filter((value) => value >= 0));
    residues.forEach((residue, index) => {
      if (!used.has(index)) items.push({ code: residue.code, resName: residue.resName, residue, unaligned: true });
    });
  } else {
    let previous = null;
    for (const residue of residues) {
      if (previous && !residue.linkedToPrevious && residue.resSeq - previous.resSeq > 1) {
        items.push({ code: '-', resName: '', residue: null, gap: residue.resSeq - previous.resSeq - 1 });
      }
      items.push({ code: residue.code, resName: residue.resName, residue });
      previous = residue;
    }
  }
  const segments = structure.uniprotSegments.filter((segment) => segment.chain === chain.sourceChain);
  return {
    chain: chain.id,
    kind: chain.polymerKind,
    source,
    items,
    sequence: items.filter((item) => !item.gap).map((item) => item.code).join(''),
    observed: items.filter((item) => item.residue).length,
    uniprot: segments,
  };
}

// Global alignment of declared (SEQRES) residue names to observed residues; end gaps are free.
export function alignResidueNames(reference, observed) {
  const n = reference.length;
  const m = observed.length;
  const mapping = new Int32Array(n).fill(-1);
  if (!n || !m) return mapping;
  if (n * m > 25e6) {
    let cursor = 0;
    for (let index = 0; index < n && cursor < m; index += 1) {
      if (reference[index] === observed[cursor]) {
        mapping[index] = cursor;
        cursor += 1;
      }
    }
    return mapping;
  }
  const width = m + 1;
  const score = new Int32Array((n + 1) * width);
  const trace = new Uint8Array((n + 1) * width);
  for (let j = 1; j <= m; j += 1) trace[j] = 2;
  for (let i = 1; i <= n; i += 1) trace[i * width] = 1;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const match = score[(i - 1) * width + j - 1] + (reference[i - 1] === observed[j - 1] ? 3 : oneLetterCode(reference[i - 1]) === oneLetterCode(observed[j - 1]) ? 2 : -2);
      const up = score[(i - 1) * width + j] - (j === m ? 0 : 2);
      const left = score[i * width + j - 1] - (i === n ? 0 : 2);
      let best = match;
      let direction = 0;
      if (up > best) {
        best = up;
        direction = 1;
      }
      if (left > best) {
        best = left;
        direction = 2;
      }
      score[i * width + j] = best;
      trace[i * width + j] = direction;
    }
  }
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const direction = trace[i * width + j];
    if (direction === 0) {
      if (oneLetterCode(reference[i - 1]) === oneLetterCode(observed[j - 1]) || reference[i - 1] === observed[j - 1]) mapping[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else if (direction === 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return mapping;
}

export function uniprotPositionForResidue(sequenceInfo, residue) {
  for (const segment of sequenceInfo?.uniprot ?? []) {
    if (residue.resSeq >= segment.authBegin && residue.resSeq <= segment.authEnd && !residue.iCode) {
      return { accession: segment.accession, position: segment.dbBegin + (residue.resSeq - segment.authBegin) };
    }
  }
  return null;
}

export function residueForUniprotPosition(sequenceInfo, position, accession = '') {
  for (const segment of sequenceInfo?.uniprot ?? []) {
    if (accession && segment.accession && segment.accession.split('-')[0] !== accession.split('-')[0]) continue;
    if (position >= segment.dbBegin && position <= segment.dbEnd) {
      const authNumber = segment.authBegin + (position - segment.dbBegin);
      const item = sequenceInfo.items.find((entry) => entry.residue && entry.residue.resSeq === authNumber && !entry.residue.iCode);
      if (item) return item.residue;
    }
  }
  return null;
}

export function buildSearchItems(structure) {
  const items = [];
  const model = structure.models[0];
  for (const residue of model.residues) {
    const representative = residue.representative ?? residue.atoms[0];
    const kindLabel = residue.kind === 'ligand' ? 'Ligand' : residue.kind === 'ion' ? 'Ion' : residue.kind === 'water' ? 'Water' : 'Residue';
    items.push({
      type: kindLabel,
      label: `${residue.resName} ${residue.chain}${residue.resSeq}${residue.iCode}`,
      sublabel: `${residue.atoms.length} atoms`,
      atomID: representative.id,
      residueKey: residue.key,
      haystack: `${residue.resName} ${residue.code} ${ligandAliases(residue.resName)} ${residue.chain} ${residue.resSeq} ${residue.chain}${residue.resSeq} ${residue.chain}:${residue.resSeq} ${residue.key}`.toLowerCase(),
    });
  }
  for (const atom of model.atoms) {
    items.push({
      type: 'Atom',
      label: `${atom.name} · ${atom.resName} ${atom.chain}${atom.resSeq}${atom.iCode}`,
      sublabel: `${atom.element} · serial ${atom.serial}`,
      atomID: atom.id,
      residueKey: atom.residueKey,
      haystack: `${atom.name} ${atom.element} ${atom.resName} ${atom.chain} ${atom.resSeq} ${atom.serial}`.toLowerCase(),
    });
  }
  return items;
}

function ligandAliases(resName) {
  const aliases = {
    HEM: 'heme haem porphyrin iron',
    HEC: 'heme c',
    PO4: 'phosphate',
    SO4: 'sulfate sulphate',
    HOH: 'water solvent',
    WAT: 'water solvent',
    ATP: 'adenosine triphosphate nucleotide',
    ADP: 'adenosine diphosphate nucleotide',
    ANP: 'amppnp atp analog nucleotide',
    GTP: 'guanosine triphosphate nucleotide',
    GDP: 'guanosine diphosphate nucleotide',
    GNP: 'gppnhp gtp analog nucleotide',
    NAD: 'nicotinamide cofactor',
    NAP: 'nadp cofactor',
    FAD: 'flavin cofactor',
    FMN: 'flavin mononucleotide',
    SAM: 's-adenosylmethionine cofactor',
    SAH: 's-adenosylhomocysteine',
    NAG: 'n-acetylglucosamine glycan sugar',
    MAN: 'mannose glycan sugar',
    GOL: 'glycerol cryoprotectant',
    EDO: 'ethylene glycol cryoprotectant',
    PEG: 'polyethylene glycol',
    STI: 'imatinib gleevec kinase inhibitor drug',
    AQ4: 'erlotinib tarceva kinase inhibitor drug',
    '032': 'vemurafenib kinase inhibitor drug',
    MOV: 'sotorasib amg510 kras inhibitor drug',
    TOT: 'thiazole orange intercalator ligand',
    ZN: 'zinc metal ion',
    MG: 'magnesium metal ion',
    CA: 'calcium metal ion',
    FE: 'iron metal ion',
    NA: 'sodium ion',
    CL: 'chloride ion',
    K: 'potassium ion',
  };
  return aliases[resName] ?? '';
}

export function materializeAssemblyModels(structure, assemblyID) {
  if (assemblyID === ASYMMETRIC_UNIT_ID) return structure.baseModels;
  const assembly = structure.assemblies.find((item) => item.id === assemblyID);
  if (!assembly) return structure.baseModels;
  if (assembly.estimatedAtoms > MAX_ASSEMBLY_ATOMS) {
    throw new Error(`Assembly ${assembly.id} would create ${assembly.estimatedAtoms.toLocaleString()} atoms/model, above the ${MAX_ASSEMBLY_ATOMS.toLocaleString()} atom safety limit.`);
  }
  return structure.baseModels.map((baseModel) => materializeAssemblyModel(baseModel, assembly));
}

export function prepareAssemblyEstimates(structure) {
  if (!structure.assemblies.length || !structure.baseModels.length) return;
  const firstModel = structure.baseModels[0];
  for (const assembly of structure.assemblies) {
    let total = 0;
    for (const generator of assembly.generators) {
      const selected = firstModel.atoms.filter((atom) => atomMatchesAssemblyGenerator(atom, generator)).length;
      total += selected * generator.transforms.length;
    }
    assembly.estimatedAtoms = total;
  }
}

function materializeAssemblyModel(baseModel, assembly) {
  const model = createModel(baseModel.number);
  model.precomputedBonds = [];
  const chainCopyCounts = countAssemblyChainCopies(baseModel, assembly);
  const chainOccurrences = new Map();
  for (const generator of assembly.generators) {
    const selectedAtoms = baseModel.atoms.filter((atom) => atomMatchesAssemblyGenerator(atom, generator));
    if (!selectedAtoms.length) continue;
    const selectedIDs = new Set(selectedAtoms.map((atom) => atom.id));
    for (const transform of generator.transforms) {
      const atomIDMap = new Map();
      const chainLabels = assemblyChainLabels(selectedAtoms, chainCopyCounts, chainOccurrences);
      for (const atom of selectedAtoms) {
        const copy = transformAssemblyAtom(atom, model.atoms.length, transform, chainLabels.get(atom.chain) || atom.chain);
        atomIDMap.set(atom.id, copy.id);
        addAtomToModel(model, copy);
      }
      for (const bond of baseModel.bonds ?? []) {
        if (!selectedIDs.has(bond.a) || !selectedIDs.has(bond.b)) continue;
        const a = atomIDMap.get(bond.a);
        const b = atomIDMap.get(bond.b);
        if (a !== undefined && b !== undefined) model.precomputedBonds.push({ a, b, kind: bond.kind });
      }
    }
  }
  return model;
}

function countAssemblyChainCopies(model, assembly) {
  const counts = new Map();
  for (const generator of assembly.generators) {
    const seen = new Set();
    for (const atom of model.atoms) {
      if (atomMatchesAssemblyGenerator(atom, generator)) seen.add(atom.chain);
    }
    for (const chain of seen) counts.set(chain, (counts.get(chain) || 0) + generator.transforms.length);
  }
  return counts;
}

function assemblyChainLabels(atoms, chainCopyCounts, chainOccurrences) {
  const labels = new Map();
  for (const atom of atoms) {
    if (labels.has(atom.chain)) continue;
    const copies = chainCopyCounts.get(atom.chain) || 1;
    if (copies <= 1) {
      labels.set(atom.chain, atom.chain);
    } else {
      const next = (chainOccurrences.get(atom.chain) || 0) + 1;
      chainOccurrences.set(atom.chain, next);
      labels.set(atom.chain, `${atom.chain}.${next}`);
    }
  }
  return labels;
}

export function atomMatchesAssemblyGenerator(atom, generator) {
  if (generator.asymIDs.size && generator.asymIDs.has(atom.labelChain)) return true;
  if (generator.authAsymIDs.size && generator.authAsymIDs.has(atom.authChain || atom.chain)) return true;
  return !generator.asymIDs.size && !generator.authAsymIDs.size;
}

function transformAssemblyAtom(atom, id, transform, chain) {
  const [x, y, z] = applyOperationToPoint(transform, atom);
  const seq = atom.authSeq || atom.labelSeq || atom.resSeq;
  return {
    ...atom,
    id,
    serial: id + 1,
    chain,
    sourceChain: atom.sourceChain || atom.chain,
    x,
    y,
    z,
    residueKey: makeResidueKey(chain, seq, atom.iCode, atom.resName),
    authKey: atomLookupKey(chain, atom.authSeq || atom.resSeq, atom.iCode, atom.resName, atom.name),
    labelKey: atomLookupKey(chain, atom.labelSeq || atom.resSeq, atom.iCode, atom.resName, atom.name),
  };
}

export function atomDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function angleAt(a, b, c) {
  const ab = [a.x - b.x, a.y - b.y, a.z - b.z];
  const cb = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = ab[0] * cb[0] + ab[1] * cb[1] + ab[2] * cb[2];
  const denom = Math.max(1e-6, Math.hypot(...ab) * Math.hypot(...cb));
  return Math.acos(Math.min(1, Math.max(-1, dot / denom))) * 180 / Math.PI;
}

export function point(atom) {
  return [atom.x, atom.y, atom.z];
}

function degrees(radians) {
  return radians * 180 / Math.PI;
}
