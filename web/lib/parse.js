import { inferElement } from './elements.js';
import { residueKindFromName, MODIFIED_AMINO_ACIDS } from './residues.js';

export const ASYMMETRIC_UNIT_ID = 'asym';

const BONDING_CONNECTION_TYPES = new Set(['covale', 'covale_base', 'covale_phosphate', 'covale_sugar', 'disulf', 'metalc', 'modres']);

// By name, unless a file named as mmCIF has no data block but does have PDB atom records.
export function detectStructureFormat(text, label) {
  const name = String(label || '').toLowerCase().replace(/\.gz$/, '');
  if (name.endsWith('.cif') || name.endsWith('.mmcif') || name.endsWith('.bcif')) {
    if (/^data_/im.test(text) || !/^(ATOM  |HETATM)/m.test(text)) return { kind: 'mmcif', label: 'PDBx/mmCIF' };
    return { kind: 'pdb', label: 'PDB' };
  }
  if (/^data_/im.test(text) && /_atom_site\./i.test(text)) return { kind: 'mmcif', label: 'PDBx/mmCIF' };
  return { kind: 'pdb', label: 'PDB' };
}

export function parseStructure(text, label) {
  const format = detectStructureFormat(text, label);
  return format.kind === 'mmcif' ? parseMMCIF(text, label) : parsePDB(text, label);
}

export function createStructure(label, format) {
  return {
    label,
    format,
    meta: {
      title: label,
      code: '',
      classification: '',
      method: '',
      resolution: '',
      rFree: '',
      rWork: '',
      organism: '',
      depositionDate: '',
      numModels: 0,
      keywords: '',
      isPredicted: false,
      confidenceSource: '',
    },
    entities: [],
    chainEntities: new Map(),
    chainSequences: new Map(),
    uniprotSegments: [],
    residueConfidence: new Map(),
    componentNames: new Map(),
    secondaryRanges: [],
    conect: [],
    assemblies: [],
    baseModels: [],
    activeAssemblyId: ASYMMETRIC_UNIT_ID,
    models: [],
    chains: [],
    residues: [],
  };
}

export function createModel(number) {
  return {
    number,
    atoms: [],
    residues: [],
    residueMap: new Map(),
    bonds: [],
    serialToIndex: new Map(),
    atomKeyToIndex: new Map(),
  };
}

export function addAtomToModel(model, atom) {
  model.serialToIndex.set(atom.serial, atom.id);
  registerAtomKeys(model, atom);
  model.atoms.push(atom);
}

function registerAtomKeys(model, atom) {
  for (const key of [atom.authKey, atom.labelKey]) {
    if (key && !model.atomKeyToIndex.has(key)) model.atomKeyToIndex.set(key, atom.id);
  }
}

export function atomLookupKey(chain, seq, iCode, comp, atom) {
  const parts = [chain, seq, iCode, comp, atom].map(normalizeLookupPart);
  if (!parts[0] || !parts[1] || !parts[4]) return '';
  return parts.join('|');
}

function normalizeLookupPart(value) {
  const clean = cleanCIFValue(value);
  return clean ? clean.toUpperCase() : '';
}

export function makeResidueKey(chain, seq, iCode, resName) {
  return `${chain}:${seq}${iCode || ''}:${resName}`;
}

function finalizeAtom(atom) {
  const kind = residueKindFromName(atom.resName);
  atom.kind = kind;
  atom.polymerType = kind === 'protein' || kind === 'nucleic' ? kind : 'ligand';
  atom.isWater = kind === 'water';
  atom.isHydrogen = atom.element === 'H' || atom.element === 'D';
  atom.ss = 'coil';
  atom.ssSource = 'none';
  return atom;
}

export function parsePDB(text, label) {
  const structure = createStructure(label, 'pdb');
  let currentModel = null;
  let implicitModel = null;
  const titleParts = [];
  const compound = [];
  const source = [];
  const seqres = new Map();
  const remark350 = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const record = line.slice(0, 6).trim();
    if (record === 'ATOM' || record === 'HETATM') {
      if (!currentModel) {
        if (!implicitModel) {
          implicitModel = createModel(1);
          structure.models.push(implicitModel);
        }
        currentModel = implicitModel;
      }
      const atom = parseAtomLine(line, record, currentModel.atoms.length);
      if (atom) addAtomToModel(currentModel, atom);
      if (implicitModel) currentModel = implicitModel;
    } else if (record === 'HEADER') {
      structure.meta.classification = slice(line, 10, 50).trim();
      structure.meta.depositionDate = slice(line, 50, 59).trim();
      structure.meta.code = slice(line, 62, 66).trim();
    } else if (record === 'TITLE') {
      const part = slice(line, 10, 80).trim();
      if (part) titleParts.push(part);
    } else if (record === 'COMPND') {
      compound.push(slice(line, 10, 80));
    } else if (record === 'SOURCE') {
      source.push(slice(line, 10, 80));
    } else if (record === 'HETNAM') {
      const id = slice(line, 11, 14).trim();
      const text = slice(line, 15, 70).trim();
      if (id && text) {
        const previous = structure.componentNames.get(id);
        structure.componentNames.set(id, previous ? `${previous}${previous.endsWith('-') ? '' : ' '}${text}` : text);
      }
    } else if (record === 'EXPDTA') {
      structure.meta.method = slice(line, 10, 80).trim();
    } else if (record === 'KEYWDS') {
      structure.meta.keywords = `${structure.meta.keywords} ${slice(line, 10, 80).trim()}`.trim();
    } else if (record === 'REMARK') {
      parsePDBRemark(structure, line, remark350);
    } else if (record === 'NUMMDL') {
      structure.meta.numModels = parseIntSafe(slice(line, 10, 14));
    } else if (record === 'SEQRES') {
      const chain = slice(line, 11, 12).trim() || '_';
      if (!seqres.has(chain)) seqres.set(chain, []);
      seqres.get(chain).push(...slice(line, 19, 80).trim().split(/\s+/).filter(Boolean));
    } else if (record === 'DBREF') {
      const database = slice(line, 26, 32).trim();
      if (database === 'UNP') {
        structure.uniprotSegments.push({
          chain: slice(line, 12, 13).trim() || '_',
          accession: slice(line, 33, 41).trim(),
          authBegin: parseIntSafe(slice(line, 14, 18)),
          authEnd: parseIntSafe(slice(line, 20, 24)),
          dbBegin: parseIntSafe(slice(line, 55, 60)),
          dbEnd: parseIntSafe(slice(line, 62, 67)),
        });
      }
    } else if (record === 'DBREF1') {
      if (slice(line, 26, 32).trim() === 'UNP') {
        structure.uniprotSegments.push({
          chain: slice(line, 12, 13).trim() || '_',
          accession: '',
          authBegin: parseIntSafe(slice(line, 14, 18)),
          authEnd: parseIntSafe(slice(line, 20, 24)),
          dbBegin: 0,
          dbEnd: 0,
          pending: true,
        });
      }
    } else if (record === 'DBREF2') {
      const pending = structure.uniprotSegments.findLast((segment) => segment.pending);
      if (pending) {
        pending.accession = slice(line, 18, 40).trim();
        pending.dbBegin = parseIntSafe(slice(line, 45, 55));
        pending.dbEnd = parseIntSafe(slice(line, 57, 67));
        delete pending.pending;
      }
    } else if (record === 'HELIX') {
      addSecondaryRange(structure, {
        kind: 'helix',
        chain: slice(line, 19, 20).trim(),
        endChain: slice(line, 31, 32).trim(),
        start: parseIntSafe(slice(line, 21, 25)),
        end: parseIntSafe(slice(line, 33, 37)),
        startICode: slice(line, 25, 26).trim(),
        endICode: slice(line, 37, 38).trim(),
        helixClass: parseIntSafe(slice(line, 38, 40)),
      });
    } else if (record === 'SHEET') {
      addSecondaryRange(structure, {
        kind: 'sheet',
        chain: slice(line, 21, 22).trim(),
        endChain: slice(line, 32, 33).trim(),
        start: parseIntSafe(slice(line, 22, 26)),
        end: parseIntSafe(slice(line, 33, 37)),
        startICode: slice(line, 26, 27).trim(),
        endICode: slice(line, 37, 38).trim(),
      });
    } else if (record === 'SSBOND') {
      structure.conect.push({
        aKeys: [atomLookupKey(slice(line, 15, 16).trim() || '_', slice(line, 17, 21).trim(), slice(line, 21, 22).trim(), 'CYS', 'SG')],
        bKeys: [atomLookupKey(slice(line, 29, 30).trim() || '_', slice(line, 31, 35).trim(), slice(line, 35, 36).trim(), 'CYS', 'SG')],
        type: 'disulf',
      });
    } else if (record === 'MODEL') {
      currentModel = createModel(parseIntSafe(slice(line, 10, 14)) || structure.models.length + 1);
      structure.models.push(currentModel);
    } else if (record === 'ENDMDL') {
      currentModel = null;
    } else if (record === 'CONECT') {
      const sourceSerial = parseIntSafe(slice(line, 6, 11));
      for (let offset = 11; offset <= 26; offset += 5) {
        const target = parseIntSafe(slice(line, offset, offset + 5));
        if (sourceSerial && target) structure.conect.push([sourceSerial, target]);
      }
    }
  }

  if (titleParts.length) structure.meta.title = titleParts.join(' ').replace(/\s+/g, ' ');
  if (structure.meta.code) structure.meta.title = `${structure.meta.code}: ${structure.meta.title}`;
  structure.entities = parsePDBCompound(compound.join(''));
  for (const entity of structure.entities) {
    for (const chain of entity.chains) structure.chainEntities.set(chain, entity.id);
  }
  structure.meta.organism = pdbSpecification(source.join(''), 'ORGANISM_SCIENTIFIC');
  for (const [chain, residues] of seqres.entries()) structure.chainSequences.set(chain, { residues, source: 'SEQRES' });
  structure.assemblies = pdbAssemblies(remark350);
  detectPrediction(structure, `${structure.meta.title} ${structure.meta.method} ${structure.meta.keywords}`);
  for (const model of structure.models) applyAltLocationPolicy(model);
  structure.models = structure.models.filter((model) => model.atoms.length > 0);
  if (!structure.models.length) throw new Error('No ATOM or HETATM records were found in this PDB file.');
  structure.meta.numModels = structure.models.length;
  return structure;
}

function parsePDBRemark(structure, line, remark350) {
  const number = parseIntSafe(slice(line, 7, 10));
  if (number === 2 && line.includes('RESOLUTION.')) {
    const match = line.match(/RESOLUTION\.\s+([0-9.]+)/);
    if (match) structure.meta.resolution = `${match[1]} Angstroms`;
  } else if (number === 3) {
    const free = line.match(/FREE R VALUE\s*(?:\(NO CUTOFF\))?\s*:\s*([0-9.]+)/);
    if (free && !structure.meta.rFree) structure.meta.rFree = free[1];
    const work = line.match(/R VALUE\s+\(WORKING SET(?:, NO CUTOFF)?\)\s*:\s*([0-9.]+)/);
    if (work && !structure.meta.rWork) structure.meta.rWork = work[1];
  } else if (number === 350) {
    remark350.push(line.slice(10));
  } else if (number === 220 || number === 1) {
    if (/ALPHAFOLD|PREDICTED/i.test(line)) structure.meta.isPredicted = true;
  }
}

function parseAtomLine(line, record, id) {
  const x = parseFloatSafe(slice(line, 30, 38));
  const y = parseFloatSafe(slice(line, 38, 46));
  const z = parseFloatSafe(slice(line, 46, 54));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const rawName = slice(line, 12, 16);
  const name = rawName.trim();
  const resName = slice(line, 17, 20).trim();
  const chain = slice(line, 21, 22).trim() || '_';
  const resSeq = parseIntSafe(slice(line, 22, 26));
  const iCode = slice(line, 26, 27).trim();
  const occupancy = parseFloatSafe(slice(line, 54, 60));
  const bFactor = parseFloatSafe(slice(line, 60, 66));
  const chargeField = slice(line, 78, 80).trim();
  const authSeq = String(resSeq);
  return finalizeAtom({
    id,
    serial: parseIntSafe(slice(line, 6, 11)),
    name,
    altLoc: slice(line, 16, 17).trim(),
    resName,
    chain,
    authChain: chain,
    labelChain: chain,
    entityId: '',
    resSeq,
    authSeq,
    labelSeq: authSeq,
    iCode,
    x,
    y,
    z,
    occupancy: Number.isFinite(occupancy) ? occupancy : 1,
    bFactor: Number.isFinite(bFactor) ? bFactor : 0,
    charge: parseFormalCharge(chargeField),
    element: inferElement(slice(line, 76, 78), rawName, residueKindFromName(resName), resName),
    record,
    isHet: record === 'HETATM',
    residueKey: makeResidueKey(chain, resSeq, iCode, resName),
    authKey: atomLookupKey(chain, authSeq, iCode, resName, name),
    labelKey: '',
  });
}

function parseFormalCharge(field) {
  const match = String(field || '').match(/^([0-9])([+-])$|^([+-])([0-9])$/);
  if (!match) return 0;
  const magnitude = Number(match[1] ?? match[4]);
  const sign = (match[2] ?? match[3]) === '-' ? -1 : 1;
  return sign * magnitude;
}

function parsePDBCompound(text) {
  const entities = [];
  let current = null;
  for (const part of text.split(';')) {
    const match = part.match(/^\s*([A-Z_]+)\s*:\s*(.*)$/s);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].replace(/\s+/g, ' ').trim();
    if (key === 'MOL_ID') {
      current = { id: value, description: '', type: 'polymer', chains: [] };
      entities.push(current);
    } else if (current && key === 'MOLECULE') {
      current.description = value;
    } else if (current && key === 'CHAIN') {
      current.chains = value.split(',').map((chain) => chain.trim()).filter(Boolean);
    }
  }
  return entities;
}

function pdbSpecification(text, key) {
  const match = text.match(new RegExp(`${key}\\s*:\\s*([^;]+)`));
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function pdbAssemblies(lines) {
  const assemblies = [];
  let current = null;
  let currentGenerator = null;
  const pendingRows = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    const biomolecule = line.match(/^BIOMOLECULE:\s*(\S+)/);
    if (biomolecule) {
      current = {
        id: biomolecule[1],
        details: '',
        methodDetails: '',
        oligomericDetails: '',
        oligomericCount: '',
        generators: [],
        estimatedAtoms: 0,
      };
      assemblies.push(current);
      currentGenerator = null;
      continue;
    }
    if (!current) continue;
    const author = line.match(/^AUTHOR DETERMINED BIOLOGICAL UNIT:\s*(.+)$/);
    const software = line.match(/^SOFTWARE DETERMINED QUATERNARY STRUCTURE:\s*(.+)$/);
    if (author) current.oligomericDetails = author[1].toLowerCase();
    if (software && !current.oligomericDetails) current.oligomericDetails = software[1].toLowerCase();
    const chains = line.match(/^(?:APPLY THE FOLLOWING TO CHAINS|AND CHAINS):\s*(.*)$/);
    if (chains) {
      const ids = chains[1].split(',').map((item) => item.trim()).filter(Boolean);
      if (line.startsWith('APPLY') || !currentGenerator) {
        currentGenerator = { asymIDs: new Set(), authAsymIDs: new Set(ids), expression: '', transforms: [] };
        current.generators.push(currentGenerator);
      } else {
        for (const id of ids) currentGenerator.authAsymIDs.add(id);
      }
      continue;
    }
    const biomt = line.match(/^BIOMT([123])\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (biomt && currentGenerator) {
      const row = Number(biomt[1]) - 1;
      const key = `${current.id}:${currentGenerator.transforms.length}:${biomt[2]}`;
      if (!pendingRows.has(key)) pendingRows.set(key, { matrix: [], vector: [] });
      const pending = pendingRows.get(key);
      pending.matrix[row] = [Number(biomt[3]), Number(biomt[4]), Number(biomt[5])];
      pending.vector[row] = Number(biomt[6]);
      if (row === 2) {
        currentGenerator.transforms.push({ id: biomt[2], matrix: pending.matrix, vector: pending.vector });
        pendingRows.delete(key);
      }
    }
  }
  return assemblies.filter((assembly) => assembly.generators.some((generator) => generator.transforms.length > 0));
}

export function parseMMCIF(text, label) {
  const cif = parseCIFDocument(text);
  const structure = createStructure(label, 'mmcif');
  applyMMCIFMetadata(structure, cif, label);
  applyMMCIFEntities(structure, cif);
  applyMMCIFSecondaryStructure(structure, cif);
  applyMMCIFConnections(structure, cif);
  structure.assemblies = parseMMCIFAssemblies(cif);
  applyMMCIFConfidence(structure, cif);

  const table = cifTable(cif, 'atom_site');
  if (!table.rowCount) throw new Error('No _atom_site records were found in this PDBx/mmCIF file.');
  const column = (name) => table.column(name);
  const columns = {
    group: column('group_pdb'),
    id: column('id'),
    type: column('type_symbol'),
    labelAtom: column('label_atom_id'),
    authAtom: column('auth_atom_id'),
    alt: column('label_alt_id'),
    labelComp: column('label_comp_id'),
    authComp: column('auth_comp_id'),
    labelAsym: column('label_asym_id'),
    authAsym: column('auth_asym_id'),
    entity: column('label_entity_id'),
    labelSeq: column('label_seq_id'),
    authSeq: column('auth_seq_id'),
    ins: column('pdbx_pdb_ins_code'),
    x: column('cartn_x'),
    y: column('cartn_y'),
    z: column('cartn_z'),
    occupancy: column('occupancy'),
    bFactor: column('b_iso_or_equiv'),
    charge: column('pdbx_formal_charge'),
    model: column('pdbx_pdb_model_num'),
  };
  const modelsByNumber = new Map();
  for (let row = 0; row < table.rowCount; row += 1) {
    const group = cleanCIFValue(columns.group(row)).toUpperCase();
    if (group && group !== 'ATOM' && group !== 'HETATM') continue;
    const modelNumber = parseIntSafe(columns.model(row)) || 1;
    let model = modelsByNumber.get(modelNumber);
    if (!model) {
      model = createModel(modelNumber);
      modelsByNumber.set(modelNumber, model);
      structure.models.push(model);
    }
    const atom = parseMMCIFAtom(columns, row, group === 'HETATM' ? 'HETATM' : 'ATOM', model.atoms.length);
    if (atom) addAtomToModel(model, atom);
  }

  for (const model of structure.models) applyAltLocationPolicy(model);
  structure.models.sort((a, b) => a.number - b.number);
  structure.models = structure.models.filter((model) => model.atoms.length > 0);
  if (!structure.models.length) throw new Error('No usable atom coordinates were found in this PDBx/mmCIF file.');
  structure.meta.numModels = structure.models.length;
  return structure;
}

function parseMMCIFAtom(columns, row, record, id) {
  const x = parseFloatSafe(columns.x(row));
  const y = parseFloatSafe(columns.y(row));
  const z = parseFloatSafe(columns.z(row));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const labelAtom = cleanCIFValue(columns.labelAtom(row));
  const authAtom = cleanCIFValue(columns.authAtom(row));
  const name = authAtom || labelAtom || cleanCIFValue(columns.type(row)) || 'X';
  const labelComp = cleanCIFValue(columns.labelComp(row)).toUpperCase();
  const authComp = cleanCIFValue(columns.authComp(row)).toUpperCase();
  const resName = authComp || labelComp || 'UNK';
  const authChain = cleanCIFValue(columns.authAsym(row));
  const labelChain = cleanCIFValue(columns.labelAsym(row));
  const chain = authChain || labelChain || '_';
  const authSeq = cleanCIFValue(columns.authSeq(row));
  const labelSeq = cleanCIFValue(columns.labelSeq(row));
  const seqText = authSeq || labelSeq || '0';
  const iCode = cleanCIFValue(columns.ins(row));
  const occupancy = parseFloatSafe(columns.occupancy(row));
  const bFactor = parseFloatSafe(columns.bFactor(row));
  const resSeq = parseIntSafe(seqText);
  return finalizeAtom({
    id,
    serial: parseIntSafe(columns.id(row)) || id + 1,
    name,
    altLoc: cleanCIFValue(columns.alt(row)),
    resName,
    chain,
    authChain: authChain || chain,
    labelChain: labelChain || chain,
    entityId: cleanCIFValue(columns.entity(row)),
    resSeq,
    authSeq,
    labelSeq,
    iCode,
    x,
    y,
    z,
    occupancy: Number.isFinite(occupancy) ? occupancy : 1,
    bFactor: Number.isFinite(bFactor) ? bFactor : 0,
    charge: parseIntSafe(columns.charge(row)),
    element: inferElement(cleanCIFValue(columns.type(row)), name, residueKindFromName(resName), resName),
    record,
    isHet: record === 'HETATM',
    residueKey: makeResidueKey(chain, seqText, iCode, resName),
    authKey: atomLookupKey(authChain || chain, authSeq || seqText, iCode, authComp || resName, authAtom || name),
    labelKey: atomLookupKey(labelChain || chain, labelSeq || seqText, iCode, labelComp || resName, labelAtom || name),
  });
}

export function addSecondaryRange(structure, range) {
  if (!range?.kind || !range.start || !range.end) return;
  structure.secondaryRanges.push({
    ...range,
    kind: range.kind === 'strand' ? 'sheet' : range.kind,
    chain: range.chain || range.authChain || range.labelChain || '_',
    endChain: range.endChain || range.endAuthChain || range.endLabelChain || range.chain || range.authChain || range.labelChain || '_',
    source: range.source || 'file annotation',
  });
}

export function applyAltLocationPolicy(model) {
  const groups = new Map();
  let duplicates = false;
  for (const atom of model.atoms) {
    const key = altLocationGroupKey(atom);
    const group = groups.get(key);
    if (group) {
      group.push(atom);
      duplicates = true;
    } else {
      groups.set(key, [atom]);
    }
  }
  if (!duplicates) return;

  const selected = [];
  const aliases = [];
  for (const group of groups.values()) {
    const best = group.length === 1 ? group[0] : group.slice().sort(compareAltLocationAtoms)[0];
    selected.push(best);
    if (group.length > 1) best.altCount = group.length;
    for (const atom of group) {
      if (atom !== best) aliases.push({ serial: atom.serial, chosen: best });
    }
  }
  selected.sort((a, b) => a.id - b.id);
  model.atoms = [];
  model.serialToIndex = new Map();
  model.atomKeyToIndex = new Map();
  for (const atom of selected) {
    atom.id = model.atoms.length;
    addAtomToModel(model, atom);
  }
  for (const alias of aliases) model.serialToIndex.set(alias.serial, alias.chosen.id);
}

function altLocationGroupKey(atom) {
  return `${atom.record}|${atom.chain}|${atom.labelChain}|${atom.authSeq || atom.resSeq}|${atom.labelSeq}|${atom.iCode}|${atom.resName}|${atom.name}`.toUpperCase();
}

export function compareAltLocationAtoms(a, b) {
  const occupancyDelta = (b.occupancy || 0) - (a.occupancy || 0);
  if (Math.abs(occupancyDelta) > 0.0001) return occupancyDelta;
  const aRank = altLocationRank(a.altLoc);
  const bRank = altLocationRank(b.altLoc);
  if (aRank !== bRank) return aRank - bRank;
  return a.id - b.id;
}

function altLocationRank(value) {
  const alt = String(value || '').trim().toUpperCase();
  if (alt === 'A' || alt === '1') return 0;
  if (!alt) return 1;
  return 2;
}

function applyMMCIFMetadata(structure, cif, label) {
  const code = getCIFValue(cif, ['_entry.id']) || cif.dataBlock || '';
  const title = getCIFValue(cif, ['_struct.title']) || label;
  const resolution = getCIFValue(cif, ['_refine.ls_d_res_high', '_em_3d_reconstruction.resolution', '_reflns.d_resolution_high']);
  structure.meta.code = code;
  structure.meta.title = code ? `${code}: ${collapseWhitespace(title)}` : collapseWhitespace(title);
  structure.meta.classification = getCIFValue(cif, ['_struct_keywords.pdbx_keywords', '_struct_keywords.text']);
  structure.meta.keywords = getCIFValue(cif, ['_struct_keywords.text', '_struct_keywords.pdbx_keywords']);
  structure.meta.method = getCIFColumnValues(cif, 'exptl', 'method').join('; ') || getCIFValue(cif, ['_exptl.method']);
  structure.meta.resolution = resolution ? formatResolution(resolution) : '';
  structure.meta.rFree = getCIFValue(cif, ['_refine.ls_r_factor_r_free']);
  structure.meta.rWork = getCIFValue(cif, ['_refine.ls_r_factor_r_work', '_refine.ls_r_factor_obs']);
  structure.meta.depositionDate = getCIFValue(cif, ['_pdbx_database_status.recvd_initial_deposition_date']);
  structure.meta.organism = [
    ...getCIFColumnValues(cif, 'entity_src_gen', 'pdbx_gene_src_scientific_name'),
    ...getCIFColumnValues(cif, 'entity_src_nat', 'pdbx_organism_scientific'),
    ...getCIFColumnValues(cif, 'pdbx_entity_src_syn', 'organism_scientific'),
    ...getCIFColumnValues(cif, 'ma_target_ref_db_details', 'organism_scientific'),
  ].filter((value, index, list) => list.indexOf(value) === index).join('; ');
}

function applyMMCIFEntities(structure, cif) {
  const entities = new Map();
  for (const row of getCIFRows(cif, 'entity')) {
    const id = cleanCIFValue(row.id);
    if (!id) continue;
    entities.set(id, {
      id,
      type: cleanCIFValue(row.type),
      description: collapseWhitespace(cleanCIFValue(row.pdbx_description)),
      polymerType: '',
      chains: [],
    });
  }
  for (const row of getCIFRows(cif, 'entity_poly')) {
    const entity = entities.get(cleanCIFValue(row.entity_id));
    if (!entity) continue;
    entity.polymerType = cleanCIFValue(row.type);
    entity.chains = splitCIFList(row.pdbx_strand_id);
    for (const chain of entity.chains) structure.chainEntities.set(chain, entity.id);
  }
  const polySeq = new Map();
  for (const row of getCIFRows(cif, 'entity_poly_seq')) {
    const entityId = cleanCIFValue(row.entity_id);
    if (!polySeq.has(entityId)) polySeq.set(entityId, []);
    const list = polySeq.get(entityId);
    const num = parseIntSafe(row.num);
    const monomer = cleanCIFValue(row.mon_id).toUpperCase();
    const hetero = cleanCIFValue(row.hetero).toLowerCase() === 'y';
    if (hetero && list.length && list[list.length - 1].num === num) continue;
    list.push({ num, name: monomer });
  }
  for (const entity of entities.values()) {
    const residues = polySeq.get(entity.id);
    if (!residues?.length) continue;
    for (const chain of entity.chains) {
      structure.chainSequences.set(chain, {
        residues: residues.map((item) => item.name),
        labelNumbers: residues.map((item) => item.num),
        source: 'entity_poly',
        entityId: entity.id,
      });
    }
  }
  structure.entities = [...entities.values()];
  for (const row of getCIFRows(cif, 'chem_comp')) {
    const id = cleanCIFValue(row.id).toUpperCase();
    const name = collapseWhitespace(cleanCIFValue(row.name));
    if (id && name) structure.componentNames.set(id, name);
  }
  const refs = new Map();
  for (const row of getCIFRows(cif, 'struct_ref')) {
    if (cleanCIFValue(row.db_name).toUpperCase() !== 'UNP') continue;
    refs.set(cleanCIFValue(row.id), cleanCIFValue(row.pdbx_db_accession) || cleanCIFValue(row.db_code));
  }
  for (const row of getCIFRows(cif, 'struct_ref_seq')) {
    const refId = cleanCIFValue(row.ref_id);
    if (!refs.has(refId)) continue;
    structure.uniprotSegments.push({
      chain: cleanCIFValue(row.pdbx_strand_id) || '_',
      accession: cleanCIFValue(row.pdbx_db_accession) || refs.get(refId),
      authBegin: parseIntSafe(row.pdbx_auth_seq_align_beg),
      authEnd: parseIntSafe(row.pdbx_auth_seq_align_end),
      labelBegin: parseIntSafe(row.seq_align_beg),
      labelEnd: parseIntSafe(row.seq_align_end),
      dbBegin: parseIntSafe(row.db_align_beg),
      dbEnd: parseIntSafe(row.db_align_end),
    });
  }
}

function applyMMCIFConfidence(structure, cif) {
  const metrics = getCIFRows(cif, 'ma_qa_metric');
  const local = metrics.find((row) => cleanCIFValue(row.mode).toLowerCase() === 'local' && /plddt/i.test(cleanCIFValue(row.name) + cleanCIFValue(row.type)));
  const hasModelArchive = metrics.length > 0 || cif.loops.has('ma_model_list') || cif.fields.has('_ma_model_list.model_id');
  const localId = local ? cleanCIFValue(local.id) : '';
  if (localId) {
    const table = cifTable(cif, 'ma_qa_metric_local');
    const asym = table.column('label_asym_id');
    const seq = table.column('label_seq_id');
    const metric = table.column('metric_id');
    const value = table.column('metric_value');
    let max = -Infinity;
    for (let row = 0; row < table.rowCount; row += 1) {
      if (cleanCIFValue(metric(row)) !== localId) continue;
      const score = parseFloatSafe(value(row));
      if (!Number.isFinite(score)) continue;
      structure.residueConfidence.set(`${cleanCIFValue(asym(row))}:${cleanCIFValue(seq(row))}`, score);
      max = Math.max(max, score);
    }
    // SWISS-MODEL reports QMEANDisCo as "pLDDT all-atom in [0,1]"; the viewer works in 0–100.
    if (/\[0,\s*1\]/.test(cleanCIFValue(local.type)) || (structure.residueConfidence.size && max <= 1)) {
      for (const [key, score] of structure.residueConfidence) structure.residueConfidence.set(key, score * 100);
    }
    const name = cleanCIFValue(local.name);
    if (name && !/plddt/i.test(name)) structure.meta.confidenceSource = `${name} (ModelCIF, as pLDDT)`;
  }
  const software = getCIFColumnValues(cif, 'software', 'name').join(' ');
  // Protenix names the data block <job>_sample_<n>_predicted_by_protenix.
  detectPrediction(structure, `${structure.meta.title} ${structure.meta.method} ${software} ${cif.dataBlock}`, hasModelArchive || structure.residueConfidence.size > 0);
}

function detectPrediction(structure, text, force = false) {
  if (force || /ALPHAFOLD|COLABFOLD|ESMFOLD|ROSETTAFOLD|BOLTZ|CHAI-1|OPENFOLD|PROTENIX|PREDICTED MODEL|COMPUTATIONAL MODEL|THEORETICAL MODEL/i.test(text)) {
    structure.meta.isPredicted = true;
  }
  if (structure.meta.isPredicted && !structure.meta.confidenceSource) {
    structure.meta.confidenceSource = structure.residueConfidence.size ? 'pLDDT (ModelCIF)' : 'pLDDT (B-factor column)';
  }
}

function applyMMCIFSecondaryStructure(structure, cif) {
  for (const row of getCIFRows(cif, 'struct_conf')) {
    const type = cleanCIFValue(row.conf_type_id).toUpperCase();
    const range = cifResidueRange(row);
    if (!range) continue;
    if (type.startsWith('HELX') || type.includes('HELIX')) {
      addSecondaryRange(structure, { ...range, kind: 'helix', source: 'file annotation' });
    } else if (type.startsWith('STRN') || type.includes('SHEET') || type.includes('BETA')) {
      addSecondaryRange(structure, { ...range, kind: 'sheet', source: 'file annotation' });
    } else if (type.startsWith('TURN')) {
      addSecondaryRange(structure, { ...range, kind: 'turn', source: 'file annotation' });
    }
  }
  for (const row of getCIFRows(cif, 'struct_sheet_range')) {
    const range = cifResidueRange(row);
    if (range) addSecondaryRange(structure, { ...range, kind: 'sheet', source: 'file annotation' });
  }
}

function cifResidueRange(row) {
  const authChain = firstCIFValue(row.beg_auth_asym_id);
  const labelChain = firstCIFValue(row.beg_label_asym_id);
  const endAuthChain = firstCIFValue(row.end_auth_asym_id);
  const endLabelChain = firstCIFValue(row.end_label_asym_id);
  const authStart = parseIntSafe(firstCIFValue(row.beg_auth_seq_id));
  const authEnd = parseIntSafe(firstCIFValue(row.end_auth_seq_id));
  const labelStart = parseIntSafe(firstCIFValue(row.beg_label_seq_id));
  const labelEnd = parseIntSafe(firstCIFValue(row.end_label_seq_id));
  const chain = authChain || labelChain;
  const start = authStart || labelStart;
  const end = authEnd || labelEnd;
  if (!chain || !start || !end) return null;
  return {
    chain,
    endChain: endAuthChain || endLabelChain || chain,
    authChain,
    labelChain,
    endAuthChain,
    endLabelChain,
    start,
    end,
    authStart,
    authEnd,
    labelStart,
    labelEnd,
    startICode: firstCIFValue(row.pdbx_beg_pdb_ins_code, row.beg_pdb_ins_code),
    endICode: firstCIFValue(row.pdbx_end_pdb_ins_code, row.end_pdb_ins_code),
  };
}

function applyMMCIFConnections(structure, cif) {
  for (const row of getCIFRows(cif, 'struct_conn')) {
    const type = cleanCIFValue(row.conn_type_id).toLowerCase();
    if (!BONDING_CONNECTION_TYPES.has(type)) continue;
    const aKeys = cifPartnerKeys(row, 'ptnr1');
    const bKeys = cifPartnerKeys(row, 'ptnr2');
    if (aKeys.length && bKeys.length) structure.conect.push({ aKeys, bKeys, type });
  }
}

function cifPartnerKeys(row, prefix) {
  const keys = [];
  const ins = firstCIFValue(row[`pdbx_${prefix}_pdb_ins_code`], row[`pdbx_${prefix}_label_pdb_ins_code`], row[`${prefix}_pdb_ins_code`]);
  const authKey = atomLookupKey(
    firstCIFValue(row[`${prefix}_auth_asym_id`], row[`pdbx_${prefix}_auth_asym_id`]),
    firstCIFValue(row[`${prefix}_auth_seq_id`], row[`pdbx_${prefix}_auth_seq_id`]),
    ins,
    firstCIFValue(row[`${prefix}_auth_comp_id`], row[`pdbx_${prefix}_auth_comp_id`]),
    firstCIFValue(row[`${prefix}_auth_atom_id`], row[`pdbx_${prefix}_auth_atom_id`], row[`${prefix}_label_atom_id`]),
  );
  const labelKey = atomLookupKey(
    firstCIFValue(row[`${prefix}_label_asym_id`]),
    firstCIFValue(row[`${prefix}_label_seq_id`]),
    ins,
    firstCIFValue(row[`${prefix}_label_comp_id`]),
    firstCIFValue(row[`${prefix}_label_atom_id`]),
  );
  if (authKey) keys.push(authKey);
  if (labelKey && labelKey !== authKey) keys.push(labelKey);
  return keys;
}

function parseMMCIFAssemblies(cif) {
  const operations = parseAssemblyOperations(cif);
  const assemblies = new Map();
  const ensure = (id) => {
    if (!assemblies.has(id)) {
      assemblies.set(id, {
        id,
        details: '',
        methodDetails: '',
        oligomericDetails: '',
        oligomericCount: '',
        generators: [],
        estimatedAtoms: 0,
      });
    }
    return assemblies.get(id);
  };
  for (const row of getCIFRows(cif, 'pdbx_struct_assembly')) {
    const id = firstCIFValue(row.id);
    if (!id) continue;
    Object.assign(ensure(id), {
      details: firstCIFValue(row.details),
      methodDetails: firstCIFValue(row.method_details),
      oligomericDetails: firstCIFValue(row.oligomeric_details),
      oligomericCount: firstCIFValue(row.oligomeric_count),
    });
  }
  for (const row of getCIFRows(cif, 'pdbx_struct_assembly_gen')) {
    const assemblyID = firstCIFValue(row.assembly_id);
    if (!assemblyID) continue;
    const combos = parseOperationExpression(firstCIFValue(row.oper_expression));
    ensure(assemblyID).generators.push({
      asymIDs: new Set(splitCIFList(row.asym_id_list)),
      authAsymIDs: new Set(splitCIFList(row.auth_asym_id_list)),
      expression: firstCIFValue(row.oper_expression),
      transforms: combos.map((combo) => resolveOperationCombo(combo, operations)).filter(Boolean),
    });
  }
  return [...assemblies.values()]
    .filter((assembly) => assembly.generators.some((generator) => generator.transforms.length > 0))
    .sort((a, b) => naturalCompare(a.id, b.id));
}

function parseAssemblyOperations(cif) {
  const operations = new Map();
  for (const row of getCIFRows(cif, 'pdbx_struct_oper_list')) {
    const id = firstCIFValue(row.id);
    if (!id) continue;
    operations.set(id, {
      id,
      matrix: [
        [parseFloatDefault(row['matrix[1][1]'], 1), parseFloatDefault(row['matrix[1][2]'], 0), parseFloatDefault(row['matrix[1][3]'], 0)],
        [parseFloatDefault(row['matrix[2][1]'], 0), parseFloatDefault(row['matrix[2][2]'], 1), parseFloatDefault(row['matrix[2][3]'], 0)],
        [parseFloatDefault(row['matrix[3][1]'], 0), parseFloatDefault(row['matrix[3][2]'], 0), parseFloatDefault(row['matrix[3][3]'], 1)],
      ],
      vector: [parseFloatDefault(row['vector[1]'], 0), parseFloatDefault(row['vector[2]'], 0), parseFloatDefault(row['vector[3]'], 0)],
    });
  }
  if (!operations.has('1')) operations.set('1', identityOperation('1'));
  return operations;
}

export function parseOperationExpression(expression) {
  const clean = cleanCIFValue(expression).replace(/\s+/g, '');
  if (!clean) return [];
  const groups = [];
  for (const match of clean.matchAll(/\(([^()]+)\)/g)) groups.push(parseOperationList(match[1]));
  if (!groups.length) groups.push(parseOperationList(clean));
  return cartesianProduct(groups).filter((combo) => combo.length > 0);
}

function parseOperationList(value) {
  const items = [];
  for (const part of String(value || '').split(',')) {
    const clean = part.trim();
    if (!clean) continue;
    const range = clean.match(/^(-?\d+)-(-?\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = start <= end ? 1 : -1;
      for (let item = start; step > 0 ? item <= end : item >= end; item += step) items.push(String(item));
    } else {
      items.push(clean);
    }
  }
  return items;
}

function cartesianProduct(groups) {
  return groups.reduce((sets, group) => {
    const next = [];
    for (const set of sets) {
      for (const item of group) next.push([...set, item]);
    }
    return next;
  }, [[]]);
}

function resolveOperationCombo(combo, operations) {
  let combined = identityOperation(combo.join('x') || '1');
  for (let index = combo.length - 1; index >= 0; index -= 1) {
    const operation = operations.get(combo[index]);
    if (!operation) return null;
    combined = composeOperations(operation, combined);
  }
  combined.id = combo.join('x') || '1';
  return combined;
}

export function identityOperation(id = '1') {
  return { id, matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], vector: [0, 0, 0] };
}

function composeOperations(a, b) {
  const matrix = multiplyMatrix3(a.matrix, b.matrix);
  const rotated = multiplyMatrixVector3(a.matrix, b.vector);
  return { id: `${a.id}x${b.id}`, matrix, vector: [rotated[0] + a.vector[0], rotated[1] + a.vector[1], rotated[2] + a.vector[2]] };
}

function multiplyMatrix3(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      out[row][column] = a[row][0] * b[0][column] + a[row][1] * b[1][column] + a[row][2] * b[2][column];
    }
  }
  return out;
}

function multiplyMatrixVector3(matrix, vector) {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

export function applyOperationToPoint(operation, atom) {
  const rotated = multiplyMatrixVector3(operation.matrix, [atom.x, atom.y, atom.z]);
  return [rotated[0] + operation.vector[0], rotated[1] + operation.vector[1], rotated[2] + operation.vector[2]];
}

export function splitCIFList(value) {
  return cleanCIFValue(value).split(',').map((item) => item.trim()).filter(Boolean);
}

export function parseCIFDocument(text) {
  const tokens = tokenizeCIF(text);
  const cif = { dataBlock: '', fields: new Map(), loops: new Map() };
  let index = 0;
  let seenBlock = false;
  while (index < tokens.length) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (lower.startsWith('data_')) {
      if (seenBlock) break;
      seenBlock = true;
      cif.dataBlock = token.slice(5).trim();
      index += 1;
    } else if (lower === 'loop_') {
      index += 1;
      const attributes = [];
      let category = '';
      while (index < tokens.length && tokens[index].startsWith('_')) {
        const parsed = splitCIFTag(tokens[index]);
        if (!category) category = parsed.category;
        attributes.push(parsed.attribute);
        index += 1;
      }
      if (!attributes.length) continue;
      const start = index;
      while (index < tokens.length && !isCIFControlToken(tokens[index])) index += 1;
      const values = tokens.slice(start, index);
      const rowCount = Math.floor(values.length / attributes.length);
      if (category && rowCount > 0 && !cif.loops.has(category)) {
        cif.loops.set(category, {
          attributes,
          columns: new Map(attributes.map((attribute, column) => [attribute, column])),
          values,
          rowCount,
        });
      }
    } else if (token.startsWith('_')) {
      if (index + 1 < tokens.length) cif.fields.set(normalizeCIFTag(token), tokens[index + 1]);
      index += 2;
    } else {
      index += 1;
    }
  }
  return cif;
}

// CIF quoted values end only at a matching quote followed by whitespace, so names like
// 'N,N'-dimethyl' stay intact.
export function tokenizeCIF(text) {
  const tokens = [];
  const length = text.length;
  let index = 0;
  while (index < length) {
    let code = text.charCodeAt(index);
    while (index < length && (code === 32 || code === 9 || code === 10 || code === 13)) {
      index += 1;
      code = text.charCodeAt(index);
    }
    if (index >= length) break;
    if (code === 35) {
      while (index < length && text.charCodeAt(index) !== 10) index += 1;
      continue;
    }
    if (code === 59 && (index === 0 || text.charCodeAt(index - 1) === 10)) {
      let start = index + 1;
      if (text.charCodeAt(start) === 13) start += 1;
      if (text.charCodeAt(start) === 10) start += 1;
      const close = text.indexOf('\n;', start - 1);
      const end = close < 0 ? length : close;
      tokens.push(text.slice(start, end).replace(/\r$/, ''));
      index = close < 0 ? length : close + 2;
      while (index < length && text.charCodeAt(index) !== 10) index += 1;
      continue;
    }
    if (code === 39 || code === 34) {
      const start = index + 1;
      let cursor = start;
      while (cursor < length) {
        if (text.charCodeAt(cursor) === code) {
          const next = text.charCodeAt(cursor + 1);
          if (cursor + 1 >= length || next === 32 || next === 9 || next === 10 || next === 13) break;
        }
        cursor += 1;
      }
      tokens.push(text.slice(start, cursor));
      index = cursor + 1;
      continue;
    }
    const start = index;
    while (index < length) {
      const next = text.charCodeAt(index);
      if (next === 32 || next === 9 || next === 10 || next === 13) break;
      index += 1;
    }
    tokens.push(text.slice(start, index));
  }
  return tokens;
}

function splitCIFTag(tag) {
  const key = normalizeCIFTag(tag).replace(/^_/, '');
  const dot = key.indexOf('.');
  if (dot < 0) return { category: key, attribute: '' };
  return { category: key.slice(0, dot), attribute: key.slice(dot + 1) };
}

function normalizeCIFTag(tag) {
  return String(tag || '').trim().toLowerCase();
}

function isCIFControlToken(token) {
  if (token.startsWith('_')) return true;
  const lower = token.toLowerCase();
  return lower === 'loop_' || lower === 'stop_' || lower.startsWith('data_') || lower.startsWith('save_');
}

export function cifTable(cif, category) {
  const key = String(category).toLowerCase();
  const loop = cif.loops.get(key);
  if (loop) {
    const width = loop.attributes.length;
    return {
      rowCount: loop.rowCount,
      column(attribute) {
        const column = loop.columns.get(String(attribute).toLowerCase());
        if (column === undefined) return () => '';
        return (row) => loop.values[row * width + column];
      },
    };
  }
  const prefix = `_${key}.`;
  const row = {};
  for (const [tag, value] of cif.fields.entries()) {
    if (tag.startsWith(prefix)) row[tag.slice(prefix.length)] = value;
  }
  const present = Object.keys(row).length > 0;
  return {
    rowCount: present ? 1 : 0,
    column(attribute) {
      const value = row[String(attribute).toLowerCase()] ?? '';
      return () => value;
    },
  };
}

export function getCIFRows(cif, category) {
  const key = String(category).toLowerCase();
  const loop = cif.loops.get(key);
  if (loop) {
    const rows = [];
    const width = loop.attributes.length;
    for (let row = 0; row < loop.rowCount; row += 1) {
      const item = {};
      for (let column = 0; column < width; column += 1) item[loop.attributes[column]] = loop.values[row * width + column];
      rows.push(item);
    }
    return rows;
  }
  const prefix = `_${key}.`;
  const row = {};
  for (const [tag, value] of cif.fields.entries()) {
    if (tag.startsWith(prefix)) row[tag.slice(prefix.length)] = value;
  }
  return Object.keys(row).length ? [row] : [];
}

export function getCIFValue(cif, tags) {
  for (const tag of tags) {
    const key = normalizeCIFTag(tag);
    const direct = cleanCIFValue(cif.fields.get(key));
    if (direct) return direct;
    const { category, attribute } = splitCIFTag(key);
    const table = cifTable(cif, category);
    const column = table.column(attribute);
    for (let row = 0; row < table.rowCount; row += 1) {
      const value = cleanCIFValue(column(row));
      if (value) return value;
    }
  }
  return '';
}

function getCIFColumnValues(cif, category, attribute) {
  const values = [];
  const seen = new Set();
  const table = cifTable(cif, category);
  const column = table.column(attribute);
  for (let row = 0; row < table.rowCount; row += 1) {
    const value = collapseWhitespace(cleanCIFValue(column(row)));
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function firstCIFValue(...values) {
  for (const value of values) {
    const clean = cleanCIFValue(value);
    if (clean) return clean;
  }
  return '';
}

export function cleanCIFValue(value) {
  const clean = String(value ?? '').trim();
  return clean === '.' || clean === '?' ? '' : clean;
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatResolution(value) {
  const clean = cleanCIFValue(value);
  return clean && !/angstrom/i.test(clean) ? `${clean} Angstroms` : clean;
}

export function isModifiedAminoAcid(resName) {
  return resName in MODIFIED_AMINO_ACIDS;
}

export function naturalCompare(a, b) {
  const left = String(a);
  const right = String(b);
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'variant' }) || (left < right ? -1 : left > right ? 1 : 0);
}

function slice(text, start, end) {
  return text.length > start ? text.slice(start, Math.min(end, text.length)) : '';
}

export function parseIntSafe(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseFloatSafe(value) {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseFloatDefault(value, fallback) {
  const parsed = parseFloatSafe(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
