import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const api = await loadProteoscope();

test('PDB HELIX and SHEET records assign file-backed secondary structure', () => {
  const pdb = [
    pdbHelix('A', 1, 4),
    pdbSheet('A', 5, 7),
    ...linearCAResidues('A', 1, 7),
  ].join('\n');
  const structure = api.parsePDB(pdb, 'annotated.pdb');
  api.deriveStructure(structure);

  const residues = structure.models[0].residues;
  assert.equal(residues[0].ss, 'helix');
  assert.equal(residues[0].ssSource, 'file annotation');
  assert.equal(residues[4].ss, 'sheet');
  assert.equal(residues[4].ssSource, 'file annotation');
});

test('mmCIF struct_conf and struct_sheet_range support label chains with multi-character IDs', () => {
  const cif = `data_demo
loop_
_struct_conf.conf_type_id
_struct_conf.beg_label_asym_id
_struct_conf.beg_label_seq_id
_struct_conf.end_label_asym_id
_struct_conf.end_label_seq_id
HELX_P AA 1 AA 2
loop_
_struct_sheet_range.beg_label_asym_id
_struct_sheet_range.beg_label_seq_id
_struct_sheet_range.end_label_asym_id
_struct_sheet_range.end_label_seq_id
AA 3 AA 4
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.pdbx_PDB_model_num
${mmcifCA('AA', 1, 0, 0, 0)}
${mmcifCA('AA', 2, 3.8, 0, 0)}
${mmcifCA('AA', 3, 7.6, 0, 0)}
${mmcifCA('AA', 4, 11.4, 0, 0)}
`;
  const structure = api.parseMMCIF(cif, 'multi.cif');
  api.deriveStructure(structure);

  const residues = structure.models[0].residues;
  assert.equal(residues[0].chain, 'AA');
  assert.equal(residues[0].ss, 'helix');
  assert.equal(residues[2].ss, 'sheet');
});

test('coordinate fallback computes approximate helices when annotations are absent', () => {
  const pdb = idealHelixCAResidues('A', 1, 7).join('\n');
  const structure = api.parsePDB(pdb, 'computed.pdb');
  api.deriveStructure(structure);

  const helixResidues = structure.models[0].residues.filter((residue) => residue.ss === 'helix');
  assert.ok(helixResidues.length >= 4);
  assert.equal(helixResidues[0].ssSource, 'computed');
});

test('altLoc policy picks highest occupancy deterministically', () => {
  const pdb = [
    pdbAtom(1, 'CA', 'A', 'ALA', 'A', 1, 0, 0, 0, 0.2, 10),
    pdbAtom(2, 'CA', 'B', 'ALA', 'A', 1, 5, 0, 0, 0.9, 10),
  ].join('\n');
  const structure = api.parsePDB(pdb, 'altloc.pdb');

  assert.equal(structure.models[0].atoms.length, 1);
  assert.equal(structure.models[0].atoms[0].altLoc, 'B');
  assert.equal(structure.models[0].atoms[0].x, 5);
});

test('cartoon segmentation breaks on missing residue numbers and large C-alpha gaps', () => {
  const pdb = [
    pdbAtom(1, 'CA', '', 'ALA', 'A', 1, 0, 0, 0),
    pdbAtom(2, 'CA', '', 'ALA', 'A', 2, 3.8, 0, 0),
    pdbAtom(3, 'CA', '', 'ALA', 'A', 4, 30, 0, 0),
    pdbAtom(4, 'CA', '', 'ALA', 'A', 5, 33.8, 0, 0),
  ].join('\n');
  const structure = api.parsePDB(pdb, 'breaks.pdb');
  api.deriveStructure(structure);

  const segments = api.buildProteinCartoonSegments(structure.models[0].residues, null, { ignoreVisibility: true });
  assert.deepEqual(Array.from(segments, (segment) => segment.residues.length), [2, 2]);
});

test('cartoon scene builds mesh vertices and residue pick records', () => {
  const pdb = [
    pdbSheet('A', 1, 4),
    ...linearCAResidues('A', 1, 4),
  ].join('\n');
  const structure = api.parsePDB(pdb, 'cartoon.pdb');
  api.deriveStructure(structure);
  api.state.structure = structure;
  api.state.representation = 'cartoon';
  api.state.colorScheme = 'secondary';

  const scene = api.buildCartoonScene(structure.models[0], null);
  assert.ok(scene.vertexCount > 0);
  assert.ok(scene.pickRecords.length >= 4);
  assert.ok(scene.canvasShapes.length > 0);
});

async function loadProteoscope() {
  const elements = new Map();
  const makeElement = (selector) => ({
    selector,
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    dataset: {},
    parentElement: { hidden: false },
    addEventListener() {},
    appendChild() {},
    replaceChildren() {},
    querySelector() { return null; },
    setAttribute() {},
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    hidden: false,
  });
  const context = {
    __PROTEOSCOPE_TEST__: true,
    console,
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, makeElement(selector));
        return elements.get(selector);
      },
      querySelectorAll() {
        return [];
      },
      createDocumentFragment() {
        return makeElement('fragment');
      },
      createElement(tag) {
        return makeElement(tag);
      },
    },
    HTMLInputElement: class HTMLInputElement {},
    HTMLSelectElement: class HTMLSelectElement {},
    URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
    requestAnimationFrame() {},
    window: { addEventListener() {}, devicePixelRatio: 1 },
    navigator: {},
    setTimeout,
    clearTimeout,
    performance: { now: () => 0 },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(await readFile(new URL('./app.js', import.meta.url), 'utf8'), context, {
    filename: 'web/app.js',
  });
  return context.__proteoscopeTest;
}

function pdbHelix(chain, start, end) {
  const line = blankPDBLine();
  writePDB(line, 0, 'HELIX ');
  writePDB(line, 7, '1'.padStart(3));
  writePDB(line, 19, chain);
  writePDB(line, 21, String(start).padStart(4));
  writePDB(line, 31, chain);
  writePDB(line, 33, String(end).padStart(4));
  return line.join('');
}

function pdbSheet(chain, start, end) {
  const line = blankPDBLine();
  writePDB(line, 0, 'SHEET ');
  writePDB(line, 7, '1'.padStart(3));
  writePDB(line, 21, chain);
  writePDB(line, 22, String(start).padStart(4));
  writePDB(line, 32, chain);
  writePDB(line, 33, String(end).padStart(4));
  return line.join('');
}

function linearCAResidues(chain, start, end) {
  const lines = [];
  for (let seq = start; seq <= end; seq += 1) {
    lines.push(pdbAtom(seq, 'CA', '', 'ALA', chain, seq, (seq - start) * 3.8, 0, 0));
  }
  return lines;
}

function idealHelixCAResidues(chain, start, count) {
  const lines = [];
  const angle = 100 * Math.PI / 180;
  for (let index = 0; index < count; index += 1) {
    lines.push(pdbAtom(
      index + 1,
      'CA',
      '',
      'ALA',
      chain,
      start + index,
      2.3 * Math.cos(index * angle),
      2.3 * Math.sin(index * angle),
      1.5 * index,
    ));
  }
  return lines;
}

function pdbAtom(serial, name, altLoc, resName, chain, resSeq, x, y, z, occupancy = 1, bFactor = 10) {
  return 'ATOM  ' +
    String(serial).padStart(5) +
    ' ' +
    name.padStart(4) +
    String(altLoc || ' ').slice(0, 1) +
    resName.padStart(3) +
    ' ' +
    chain.slice(0, 1) +
    String(resSeq).padStart(4) +
    '    ' +
    x.toFixed(3).padStart(8) +
    y.toFixed(3).padStart(8) +
    z.toFixed(3).padStart(8) +
    occupancy.toFixed(2).padStart(6) +
    bFactor.toFixed(2).padStart(6) +
    '           C';
}

function mmcifCA(chain, seq, x, y, z) {
  return `ATOM ${seq} C CA . ALA ${chain} ${seq} ? ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)} 1.00 10.0 1`;
}

function blankPDBLine() {
  return Array.from({ length: 80 }, () => ' ');
}

function writePDB(line, start, value) {
  for (let index = 0; index < value.length; index += 1) line[start + index] = value[index];
}
