import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseMMCIF, parsePDB, parseStructure, tokenizeCIF } from './parse.js';
import {
  alignResidueNames,
  deriveStructure,
  materializeAssemblyModels,
  polymerSegments,
  prepareAssemblyEstimates,
  residueForUniprotPosition,
  uniprotPositionForResidue,
} from './structure.js';
import { buildCartoon } from './cartoon.js';
import { buildScene, focusNeighborhood } from './scene.js';
import { computeAtomColors } from './coloring.js';
import { inferElement } from './elements.js';

const DATA_DIR = new URL('../../data/', import.meta.url);

function derive(structure) {
  structure.baseModels = structure.models;
  prepareAssemblyEstimates(structure);
  return deriveStructure(structure);
}

test('PDB HELIX and SHEET records assign file-backed secondary structure', () => {
  const pdb = [pdbHelix('A', 1, 4), pdbSheet('A', 5, 7), ...linearCAResidues('A', 1, 7)].join('\n');
  const structure = derive(parsePDB(pdb, 'annotated.pdb'));
  const residues = structure.models[0].residues;
  assert.equal(residues[0].ss, 'helix');
  assert.equal(residues[0].ssSource, 'file annotation');
  assert.equal(residues[4].ss, 'sheet');
});

test('mmCIF struct_conf and struct_sheet_range support multi-character label chains', () => {
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
  const structure = derive(parseMMCIF(cif, 'multi.cif'));
  const residues = structure.models[0].residues;
  assert.equal(residues[0].chain, 'AA');
  assert.equal(residues[0].ss, 'helix');
  assert.equal(residues[2].ss, 'sheet');
});

test('C-alpha-only chains without annotations fall back to CA-geometry secondary structure', () => {
  const structure = derive(parsePDB(idealHelixCAResidues('A', 1, 7).join('\n'), 'computed.pdb'));
  const helix = structure.models[0].residues.filter((residue) => residue.ss === 'helix');
  assert.ok(helix.length >= 4);
  assert.equal(helix[0].ssSource, 'CA geometry');
});

test('altLoc policy keeps the highest-occupancy conformer', () => {
  const pdb = [
    pdbAtom(1, 'CA', 'A', 'ALA', 'A', 1, 0, 0, 0, 0.2, 10),
    pdbAtom(2, 'CA', 'B', 'ALA', 'A', 1, 5, 0, 0, 0.9, 10),
  ].join('\n');
  const structure = parsePDB(pdb, 'altloc.pdb');
  assert.equal(structure.models[0].atoms.length, 1);
  assert.equal(structure.models[0].atoms[0].altLoc, 'B');
  assert.equal(structure.models[0].atoms[0].x, 5);
});

test('polymer segments break on large C-alpha gaps', () => {
  const pdb = [
    pdbAtom(1, 'CA', '', 'ALA', 'A', 1, 0, 0, 0),
    pdbAtom(2, 'CA', '', 'ALA', 'A', 2, 3.8, 0, 0),
    pdbAtom(3, 'CA', '', 'ALA', 'A', 4, 30, 0, 0),
    pdbAtom(4, 'CA', '', 'ALA', 'A', 5, 33.8, 0, 0),
  ].join('\n');
  const structure = derive(parsePDB(pdb, 'breaks.pdb'));
  const segments = polymerSegments(structure.models[0].residues, 'protein');
  assert.deepEqual(segments.map((segment) => segment.length), [2, 2]);
});

test('cartoon builds an indexed mesh that covers annotated residues', () => {
  const pdb = [pdbSheet('A', 1, 4), ...linearCAResidues('A', 1, 4)].join('\n');
  const structure = derive(parsePDB(pdb, 'cartoon.pdb'));
  const cartoon = buildCartoon(structure.models[0], { quality: 4 });
  assert.ok(cartoon.vertexCount > 0);
  assert.equal(cartoon.indices.length % 3, 0);
  assert.equal(cartoon.covered.size, 4);
  assert.equal(cartoon.vertices.byteLength, cartoon.vertexCount * 32);
  const maxIndex = cartoon.indices.reduce((max, value) => Math.max(max, value), 0);
  assert.ok(maxIndex < cartoon.vertexCount);
});

test('CIF tokenizer keeps quoted values that contain quote characters', () => {
  const tokens = tokenizeCIF(`_chem_comp.name 'N,N'-dimethyl glycine'\n_a.b "O5'"\n_x.y\n;multi\nline\n;\n_c.d x`);
  assert.deepEqual(tokens, ['_chem_comp.name', "N,N'-dimethyl glycine", '_a.b', "O5'", '_x.y', 'multi\nline', '_c.d', 'x']);
});

test('element inference distinguishes alpha carbons from calcium and heme nitrogens from sodium', () => {
  assert.equal(inferElement('', ' CA ', 'protein', 'ALA'), 'C');
  assert.equal(inferElement('', 'CA  ', 'ion', 'CA'), 'CA');
  assert.equal(inferElement('', ' NA ', 'ligand', 'HEM'), 'N');
  assert.equal(inferElement('', 'FE  ', 'ligand', 'HEM'), 'FE');
  assert.equal(inferElement('', 'SE  ', 'protein', 'MSE'), 'SE');
});

test('selenomethionine is promoted into the polymer so the cartoon stays continuous', () => {
  const lines = [];
  let serial = 1;
  const names = ['ALA', 'MSE', 'ALA'];
  for (let index = 0; index < 3; index += 1) {
    const x = index * 3.8;
    const record = names[index] === 'MSE' ? 'HETATM' : 'ATOM';
    lines.push(pdbAtom(serial++, 'N', '', names[index], 'A', index + 1, x - 1.2, 0.4, 0, 1, 10, record));
    lines.push(pdbAtom(serial++, 'CA', '', names[index], 'A', index + 1, x, 0, 0, 1, 10, record));
    lines.push(pdbAtom(serial++, 'C', '', names[index], 'A', index + 1, x + 1.3, 0.5, 0, 1, 10, record));
  }
  const structure = derive(parsePDB(lines.join('\n'), 'mse.pdb'));
  const residues = structure.models[0].residues;
  assert.equal(residues[1].resName, 'MSE');
  assert.equal(residues[1].kind, 'protein');
  assert.equal(residues[1].modified, true);
  assert.equal(residues[1].code, 'M');
  assert.equal(polymerSegments(residues, 'protein')[0].length, 3);
});

test('struct_conn hydrogen bonds are not drawn as covalent bonds but disulfides are', () => {
  const cif = `data_conn
loop_
_struct_conn.id
_struct_conn.conn_type_id
_struct_conn.ptnr1_auth_asym_id
_struct_conn.ptnr1_auth_seq_id
_struct_conn.ptnr1_auth_comp_id
_struct_conn.ptnr1_auth_atom_id
_struct_conn.ptnr2_auth_asym_id
_struct_conn.ptnr2_auth_seq_id
_struct_conn.ptnr2_auth_comp_id
_struct_conn.ptnr2_auth_atom_id
hydrog1 hydrog A 1 SER OG B 1 SER OG
disulf1 disulf A 2 CYS SG B 2 CYS SG
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
ATOM 1 O OG SER A 1 0.0 0.0 0.0
ATOM 2 O OG SER B 1 2.7 0.0 0.0
ATOM 3 S SG CYS A 2 10.0 0.0 0.0
ATOM 4 S SG CYS B 2 12.04 0.0 0.0
`;
  const structure = derive(parseMMCIF(cif, 'conn.cif'));
  const bonds = structure.models[0].bonds;
  assert.equal(bonds.length, 1);
  assert.deepEqual([bonds[0].a, bonds[0].b], [2, 3]);
});

test('inter-chain disulfides are inferred from geometry', () => {
  const pdb = [
    pdbAtom(1, 'SG', '', 'CYS', 'A', 10, 0, 0, 0, 1, 10, 'ATOM', 'S'),
    pdbAtom(2, 'SG', '', 'CYS', 'B', 20, 2.05, 0, 0, 1, 10, 'ATOM', 'S'),
    pdbAtom(3, 'CA', '', 'ALA', 'A', 11, 0, 3, 0),
    pdbAtom(4, 'CA', '', 'ALA', 'B', 21, 1.2, 3, 0),
  ].join('\n');
  const structure = derive(parsePDB(pdb, 'ss.pdb'));
  const bonds = structure.models[0].bonds;
  assert.equal(bonds.length, 1);
  assert.deepEqual([bonds[0].a, bonds[0].b], [0, 1]);
});

test('SEQRES alignment marks unmodeled residues and tolerates internal gaps', () => {
  const mapping = alignResidueNames(['MET', 'ALA', 'GLY', 'SER', 'LYS', 'LEU', 'GLU'], ['ALA', 'GLY', 'LYS', 'LEU']);
  assert.deepEqual([...mapping], [-1, 0, 1, -1, 2, 3, -1]);
});

test('DBREF UniProt segments map author numbering to UniProt numbering', () => {
  const pdb = [
    'DBREF  1ABC A   10    12  UNP    P12345   TEST_HUMAN     110    112',
    'SEQRES   1 A    3  ALA GLY SER',
    pdbAtom(1, 'CA', '', 'ALA', 'A', 10, 0, 0, 0),
    pdbAtom(2, 'CA', '', 'GLY', 'A', 11, 3.8, 0, 0),
    pdbAtom(3, 'CA', '', 'SER', 'A', 12, 7.6, 0, 0),
  ].join('\n');
  const structure = derive(parsePDB(pdb, 'dbref.pdb'));
  const info = structure.sequences.get('A');
  assert.equal(info.source, 'SEQRES');
  assert.equal(info.sequence, 'AGS');
  const residue = structure.models[0].residues[1];
  assert.deepEqual(uniprotPositionForResidue(info, residue), { accession: 'P12345', position: 111 });
  assert.equal(residueForUniprotPosition(info, 112).resName, 'SER');
});

test('REMARK 350 biological assemblies are parsed and materialized for PDB files', () => {
  const pdb = [
    'REMARK 350 BIOMOLECULE: 1',
    'REMARK 350 AUTHOR DETERMINED BIOLOGICAL UNIT: DIMERIC',
    'REMARK 350 APPLY THE FOLLOWING TO CHAINS: A',
    'REMARK 350   BIOMT1   1  1.000000  0.000000  0.000000        0.00000',
    'REMARK 350   BIOMT2   1  0.000000  1.000000  0.000000        0.00000',
    'REMARK 350   BIOMT3   1  0.000000  0.000000  1.000000        0.00000',
    'REMARK 350   BIOMT1   2 -1.000000  0.000000  0.000000       10.00000',
    'REMARK 350   BIOMT2   2  0.000000 -1.000000  0.000000        0.00000',
    'REMARK 350   BIOMT3   2  0.000000  0.000000  1.000000        0.00000',
    pdbAtom(1, 'CA', '', 'ALA', 'A', 1, 1, 2, 3),
  ].join('\n');
  const structure = derive(parsePDB(pdb, 'assembly.pdb'));
  assert.equal(structure.assemblies.length, 1);
  assert.equal(structure.assemblies[0].oligomericDetails, 'dimeric');
  assert.equal(structure.assemblies[0].estimatedAtoms, 2);
  const models = materializeAssemblyModels(structure, '1');
  assert.equal(models[0].atoms.length, 2);
  assert.deepEqual([models[0].atoms[1].x, models[0].atoms[1].y, models[0].atoms[1].z], [9, -2, 3]);
});

test('ModelCIF local pLDDT marks predicted models and fills residue confidence', () => {
  const cif = `data_AF-TEST
_entry.id AF-TEST
loop_
_ma_qa_metric.id
_ma_qa_metric.mode
_ma_qa_metric.name
1 global pLDDT
2 local pLDDT
loop_
_ma_qa_metric_local.label_asym_id
_ma_qa_metric_local.label_seq_id
_ma_qa_metric_local.metric_id
_ma_qa_metric_local.metric_value
A 1 2 91.5
A 2 2 42.0
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.auth_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.B_iso_or_equiv
ATOM 1 C CA ALA A 1 1 0.0 0.0 0.0 91.5
ATOM 2 C CA GLY A 2 2 3.8 0.0 0.0 42.0
`;
  const structure = derive(parseMMCIF(cif, 'AF-TEST.cif'));
  assert.equal(structure.meta.isPredicted, true);
  assert.equal(structure.models[0].residues[0].confidence, 91.5);
  assert.equal(structure.models[0].residues[1].confidence, 42);
  const { colors, legend } = computeAtomColors(structure.models[0], structure, { scheme: 'plddt' });
  assert.equal(legend.type, 'categorical');
  assert.deepEqual([...colors.slice(0, 3)].map((value) => Math.round(value * 255)), [0, 83, 214]);
  assert.deepEqual([...colors.slice(4, 7)].map((value) => Math.round(value * 255)), [255, 125, 69]);
});

test('scene shows ligands in cartoon mode and side chains only around the focus', () => {
  const lines = [];
  let serial = 1;
  for (let index = 0; index < 5; index += 1) {
    const x = index * 3.8;
    lines.push(pdbAtom(serial++, 'N', '', 'LEU', 'A', index + 1, x - 1.2, 0.4, 0));
    lines.push(pdbAtom(serial++, 'CA', '', 'LEU', 'A', index + 1, x, 0, 0));
    lines.push(pdbAtom(serial++, 'C', '', 'LEU', 'A', index + 1, x + 1.3, 0.5, 0));
    lines.push(pdbAtom(serial++, 'O', '', 'LEU', 'A', index + 1, x + 1.5, 1.7, 0, 1, 10, 'ATOM', 'O'));
    lines.push(pdbAtom(serial++, 'CB', '', 'LEU', 'A', index + 1, x, -1.5, 0.2));
  }
  lines.push(pdbAtom(serial++, 'C1', '', 'LIG', 'A', 100, 4, -4, 0, 1, 10, 'HETATM'));
  lines.push(pdbAtom(serial++, 'C2', '', 'LIG', 'A', 100, 5.4, -4, 0, 1, 10, 'HETATM'));
  const structure = derive(parsePDB(lines.join('\n'), 'scene.pdb'));
  const model = structure.models[0];
  const display = { polymer: 'cartoon', ligand: 'ball-stick', sidechains: 'focus', atomScale: 1, bondScale: 1, cartoonWidth: 1, cartoonQuality: 3, visibleChains: null };
  const plain = buildScene(model, structure, display);
  const ligandAtoms = model.atoms.filter((atom) => atom.resName === 'LIG').map((atom) => atom.id);
  assert.ok(ligandAtoms.every((id) => plain.styles[id] > 0));
  assert.equal(plain.spheres.count, 2);
  assert.ok(plain.cartoon.vertexCount > 0);
  const neighborhood = focusNeighborhood(model, [model.atoms[ligandAtoms[0]].residueKey], 5);
  assert.ok(neighborhood.size > 1);
  const focused = buildScene(model, structure, display, { focusResidues: neighborhood });
  assert.ok(focused.spheres.count > plain.spheres.count);
});

test('per-residue styles add side-chain sticks on the cartoon and hidden residues disappear', async () => {
  const text = await readFile(new URL('4hhb.pdb', DATA_DIR), 'utf8');
  const structure = derive(parsePDB(text, '4hhb.pdb'));
  const model = structure.models[0];
  const his = model.residueMap.get('A:87:HIS');
  const display = { polymer: 'cartoon', ligand: 'ball-stick', sidechains: 'none', showWater: false, showHydrogen: false, atomScale: 1, bondScale: 1, cartoonWidth: 1, cartoonQuality: 6, visibleChains: null };
  const plain = buildScene(model, structure, display);
  assert.ok(his.atoms.every((atom) => plain.styles[atom.id] === 0 || atom === his.representative));

  const styled = buildScene(model, structure, { ...display, residueStyles: new Map([[his.key, 'sticks']]) });
  const drawn = his.atoms.filter((atom) => styled.styles[atom.id]).map((atom) => atom.name).sort();
  assert.deepEqual(drawn, ['CA', 'CB', 'CD2', 'CE1', 'CG', 'ND1', 'NE2'], 'side chain anchored at CA, backbone left to the ribbon');

  const spheres = buildScene(model, structure, { ...display, residueStyles: new Map([[his.key, 'spacefill']]) });
  assert.ok(his.atoms.every((atom) => spheres.styles[atom.id]), 'spheres show the whole residue');

  const hidden = new Set(model.residues.filter((residue) => residue.chain === 'B').map((residue) => residue.key));
  const withoutB = buildScene(model, structure, { ...display, ligand: 'ball-stick', hiddenResidues: hidden });
  assert.ok(model.atoms.every((atom) => atom.chain !== 'B' || !withoutB.styles[atom.id]));
  assert.ok(![...withoutB.cartoon.covered].some((key) => key.startsWith('B:')), 'hidden residues leave the cartoon');
});

test('every bundled structure parses, derives and builds a cartoon', async () => {
  const files = (await readdir(DATA_DIR)).filter((name) => /\.(pdb|cif)$/i.test(name));
  assert.ok(files.length >= 10);
  for (const file of files) {
    const text = await readFile(new URL(file, DATA_DIR), 'utf8');
    const structure = derive(parseStructure(text, file));
    const model = structure.models[0];
    assert.ok(model.atoms.length > 0, file);
    assert.ok(model.bonds.length > 0, file);
    assert.ok(structure.chains.length > 0, file);
    const cartoon = buildCartoon(model, { quality: 3 });
    assert.ok(cartoon.covered.size > 0, `${file} cartoon`);
    const unknownElements = model.atoms.filter((atom) => !/^[A-Z]{1,2}$/.test(atom.element));
    assert.equal(unknownElements.length, 0, `${file} has malformed elements`);
  }
});

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
  for (let seq = start; seq <= end; seq += 1) lines.push(pdbAtom(seq, 'CA', '', 'ALA', chain, seq, (seq - start) * 3.8, 0, 0));
  return lines;
}

function idealHelixCAResidues(chain, start, count) {
  const lines = [];
  const angle = (100 * Math.PI) / 180;
  for (let index = 0; index < count; index += 1) {
    lines.push(pdbAtom(index + 1, 'CA', '', 'ALA', chain, start + index, 2.3 * Math.cos(index * angle), 2.3 * Math.sin(index * angle), 1.5 * index));
  }
  return lines;
}

function pdbAtom(serial, name, altLoc, resName, chain, resSeq, x, y, z, occupancy = 1, bFactor = 10, record = 'ATOM', element = '') {
  const paddedName = name.length >= 4 ? name : ` ${name}`.padEnd(4);
  return record.padEnd(6) +
    String(serial).padStart(5) +
    ' ' +
    paddedName +
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
    '          ' +
    (element || name[0]).padStart(2);
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
