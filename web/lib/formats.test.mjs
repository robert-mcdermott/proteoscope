import assert from 'node:assert/strict';
import test from 'node:test';
import { createZip, isZip, listZip, readZip } from './zip.js';
import { readNpy, readNpz, squareMatrix, writeNpy } from './npy.js';
import { binaryCIFToText, decodeData, decodeMessagePack, isBinaryCIF } from './bcif.js';
import { packMessagePack as pack } from './test-data.mjs';
import { detectStructureFormat, parseStructure } from './parse.js';
import { combineDepth, depthSummary, msaDepth } from './msa.js';
import { greedyModularity, paeDomains } from './pae-domains.js';

// A ZIP written the way streaming zippers (Java, some web servers) do it: bit 3 set, zero sizes in
// the local header and a data descriptor after the data.
async function zipWithDataDescriptor(name, text) {
  const archive = await createZip([{ name, data: text }], { compress: false });
  const view = new DataView(archive.buffer);
  const size = view.getUint32(18, true);
  const crc = view.getUint32(14, true);
  const nameLength = view.getUint16(26, true);
  const dataEnd = 30 + nameLength + size;
  const descriptor = new Uint8Array(16);
  const descriptorView = new DataView(descriptor.buffer);
  descriptorView.setUint32(0, 0x08074b50, true);
  descriptorView.setUint32(4, crc, true);
  descriptorView.setUint32(8, size, true);
  descriptorView.setUint32(12, size, true);
  const rebuilt = new Uint8Array(archive.length + 16);
  rebuilt.set(archive.subarray(0, dataEnd), 0);
  rebuilt.set(descriptor, dataEnd);
  rebuilt.set(archive.subarray(dataEnd), dataEnd + 16);
  const out = new DataView(rebuilt.buffer);
  out.setUint16(6, out.getUint16(6, true) | 0x0008, true);
  out.setUint32(14, 0, true);
  out.setUint32(18, 0, true);
  out.setUint32(22, 0, true);
  // Central directory and end record moved by 16 bytes.
  const central = dataEnd + 16;
  out.setUint16(central + 8, out.getUint16(central + 8, true) | 0x0008, true);
  const end = rebuilt.length - 22;
  out.setUint32(end + 16, out.getUint32(end + 16, true) + 16, true);
  return rebuilt;
}

test('ZIP entries are read through the central directory, including data-descriptor archives', async () => {
  const archive = await zipWithDataDescriptor('fold_test_model_0.cif', 'data_test\n');
  assert.ok(isZip(archive));
  const entries = listZip(archive);
  assert.deepEqual(entries.map((entry) => [entry.name, entry.size]), [['fold_test_model_0.cif', 10]]);
  const files = await readZip(archive);
  assert.equal(new TextDecoder().decode(files.get('fold_test_model_0.cif')), 'data_test\n');
  await assert.rejects(() => readZip(new Uint8Array(40)), /Not a ZIP archive/);
});

test('NumPy arrays and archives decode, including float16 and Fortran order', async () => {
  const pae = Float32Array.from([0.5, 3, 12, 0.25]);
  const npy = writeNpy(pae, [2, 2]);
  const parsed = readNpy(npy);
  assert.deepEqual(parsed.shape, [2, 2]);
  assert.deepEqual(Array.from(parsed.data), [0.5, 3, 12, 0.25]);

  const half = writeNpy(Uint16Array.from([0x3c00, 0xc000, 0x3555]), [3], '<f2');
  const halfValues = Array.from(readNpy(half).data);
  assert.equal(halfValues[0], 1);
  assert.equal(halfValues[1], -2);
  assert.ok(Math.abs(halfValues[2] - 0.333) < 0.001);

  const fortran = writeNpy(Int32Array.from([1, 4, 2, 5, 3, 6]), [2, 3], '<i4');
  // One character per byte. TextDecoder('latin1') would not do: the Encoding standard maps it to
  // windows-1252, which turns the magic byte 0x93 into U+201C.
  const header = String.fromCharCode(...fortran).replace("'fortran_order': False", "'fortran_order': True ");
  const fortranBytes = Uint8Array.from(header, (char) => char.charCodeAt(0));
  assert.deepEqual(Array.from(readNpy(fortranBytes).data), [1, 2, 3, 4, 5, 6]);

  const npz = await createZip([{ name: 'pae.npy', data: npy }, { name: 'notes.txt', data: 'x' }]);
  const arrays = await readNpz(npz);
  assert.deepEqual([...arrays.keys()], ['pae']);
  assert.deepEqual(squareMatrix(arrays.get('pae')).size, 2);
  assert.equal(squareMatrix({ shape: [1, 2, 2], data: pae }).matrix[2], 12);
  assert.equal(squareMatrix({ shape: [3], data: pae }), null);
});

const bytesOf = (typed) => new Uint8Array(typed.buffer.slice(0));
const int32Column = (name, values) => ({ name, data: { encoding: [{ kind: 'ByteArray', type: 3 }], data: bytesOf(Int32Array.from(values)) }, mask: null });
const stringColumn = (name, values, mask = null) => {
  const unique = [...new Set(values)];
  const offsets = [0];
  for (const item of unique) offsets.push(offsets[offsets.length - 1] + item.length);
  return {
    name,
    data: {
      encoding: [{ kind: 'StringArray', dataEncoding: [{ kind: 'ByteArray', type: 3 }], stringData: unique.join(''), offsetEncoding: [{ kind: 'ByteArray', type: 3 }], offsets: bytesOf(Int32Array.from(offsets)) }],
      data: bytesOf(Int32Array.from(values.map((item) => unique.indexOf(item)))),
    },
    mask: mask ? { encoding: [{ kind: 'ByteArray', type: 4 }], data: Uint8Array.from(mask) } : null,
  };
};
const fixedColumn = (name, values, factor = 1000) => ({
  name,
  data: {
    encoding: [{ kind: 'FixedPoint', factor, srcType: 33 }, { kind: 'Delta', origin: 0, srcType: 3 }, { kind: 'IntegerPacking', byteCount: 1, isUnsigned: false, srcSize: values.length }, { kind: 'ByteArray', type: 1 }],
    data: (() => {
      const ints = values.map((value) => Math.round(value * factor));
      const deltas = ints.map((value, index) => (index ? value - ints[index - 1] : value));
      const packed = [];
      for (const delta of deltas) {
        let rest = delta;
        while (rest >= 127) { packed.push(127); rest -= 127; }
        while (rest <= -128) { packed.push(-128); rest += 128; }
        packed.push(rest);
      }
      return bytesOf(Int8Array.from(packed));
    })(),
  },
  mask: null,
});

test('BinaryCIF decodes every column encoding and becomes parseable mmCIF text', () => {
  assert.deepEqual(Array.from(decodeData({ encoding: [{ kind: 'RunLength', srcType: 3, srcSize: 5 }, { kind: 'ByteArray', type: 3 }], data: bytesOf(Int32Array.from([7, 3, 9, 2])) })), [7, 7, 7, 9, 9]);
  assert.deepEqual(Array.from(decodeData({ encoding: [{ kind: 'IntervalQuantization', min: 0, max: 1, numSteps: 3, srcType: 32 }, { kind: 'ByteArray', type: 4 }], data: Uint8Array.from([0, 1, 2]) })), [0, 0.5, 1]);
  assert.deepEqual(decodeMessagePack(Uint8Array.from([0x92, 0xa1, 0x41, 0xff])), ['A', -1]);

  const atoms = [
    ['ATOM', 'N', 'MET', 'A', 1, 27.34, 24.43, 2.614],
    ['ATOM', 'CA', 'MET', 'A', 1, 26.266, 25.413, 2.842],
    ['HETATM', 'C1', 'HEM', 'A', 142, -5.5, 10.25, -300.125],
  ];
  const file = {
    version: '0.3.0',
    encoder: 'test',
    dataBlocks: [{
      header: '1TST',
      categories: [
        { name: '_entry', rowCount: 1, columns: [stringColumn('id', ['1TST'])] },
        { name: '_struct', rowCount: 1, columns: [stringColumn('title', ["N,N'-dimethyl \"test\" structure"])] },
        {
          name: '_atom_site',
          rowCount: atoms.length,
          columns: [
            stringColumn('group_PDB', atoms.map((atom) => atom[0])),
            int32Column('id', [1, 2, 3]),
            stringColumn('type_symbol', ['N', 'C', 'C']),
            stringColumn('label_atom_id', atoms.map((atom) => atom[1])),
            stringColumn('label_comp_id', atoms.map((atom) => atom[2])),
            stringColumn('label_asym_id', ['A', 'A', 'B']),
            stringColumn('auth_asym_id', atoms.map((atom) => atom[3])),
            int32Column('auth_seq_id', atoms.map((atom) => atom[4])),
            stringColumn('pdbx_PDB_ins_code', ['', '', ''], [2, 2, 2]),
            fixedColumn('Cartn_x', atoms.map((atom) => atom[5])),
            fixedColumn('Cartn_y', atoms.map((atom) => atom[6])),
            fixedColumn('Cartn_z', atoms.map((atom) => atom[7])),
            int32Column('pdbx_PDB_model_num', [1, 1, 1]),
          ],
        },
      ],
    }],
  };
  const bytes = pack(file);
  assert.ok(isBinaryCIF(bytes));
  assert.ok(!isBinaryCIF(new TextEncoder().encode('data_1TST\n')));
  const text = binaryCIFToText(bytes);
  assert.match(text, /^data_1TST/);
  assert.match(text, /"N,N'-dimethyl "test" structure"|\n;N,N'-dimethyl "test" structure\n;/);
  const structure = parseStructure(text, '1tst.cif');
  const [n, ca, heme] = structure.models[0].atoms;
  assert.equal(structure.meta.code, '1TST');
  assert.equal(n.name, 'N');
  assert.equal(ca.x, 26.266);
  assert.equal(heme.z, -300.125);
  assert.equal(heme.resName, 'HEM');
  assert.equal(heme.iCode, '');
});

test('MSA depth counts aligned sequences per query column and ignores insertions', () => {
  const a3m = '#6,3\t1,1\n>101\t102\nMKVLAYGSR\n>hit1\nMK-LAyyYGS-\n>hit2\n---LAYGSR\n>hit3\n---------\n';
  const result = msaDepth(a3m);
  assert.equal(result.query, 'MKVLAYGSR');
  assert.deepEqual(result.chainLengths, [6, 3]);
  assert.equal(result.count, 2, 'an all-gap row does not count');
  assert.deepEqual(Array.from(result.depth), [1, 1, 0, 2, 2, 2, 2, 2, 1]);
  const both = combineDepth([result, msaDepth('>q\nMKVLAYGSR\n>p\nMKVLAYGSR\n')]);
  assert.equal(both.count, 3);
  assert.equal(both.depth[0], 2);
  assert.deepEqual(depthSummary(result.depth, 2), { median: 2, min: 0, max: 2, shallow: 4, threshold: 2 });
  assert.equal(msaDepth(''), null);
});

test('PAE domains separate two rigid blocks joined by a flexible linker', () => {
  const n = 60;
  const matrix = new Float32Array(n * n);
  const domain = (index) => (index < 25 ? 0 : index < 35 ? -1 : 1);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const a = domain(i);
      const b = domain(j);
      matrix[i * n + j] = i === j ? 0.3 : a >= 0 && a === b ? 1.5 + ((i + j) % 3) * 0.3 : 25;
    }
  }
  const { labels, domains } = paeDomains({ size: n, matrix }, { minSize: 5 });
  assert.equal(domains.length, 2);
  assert.equal(labels[0], labels[24]);
  assert.equal(labels[35], labels[59]);
  assert.notEqual(labels[0], labels[35]);
  assert.equal(labels[30], -1, 'linker residues form clusters below the minimum size');
  // Two disconnected triangles stay apart; an empty graph keeps singletons.
  const weights = new Float64Array(36);
  for (const [a, b] of [[0, 1], [1, 2], [0, 2], [3, 4], [4, 5], [3, 5]]) {
    weights[a * 6 + b] = 1;
    weights[b * 6 + a] = 1;
  }
  const community = greedyModularity(weights, 6);
  assert.equal(new Set([community[0], community[1], community[2]]).size, 1);
  assert.notEqual(community[0], community[3]);
  assert.deepEqual(Array.from(greedyModularity(new Float64Array(4), 2)), [0, 1]);
});

test('structure format follows the name unless an mmCIF name holds PDB records', () => {
  const pdb = 'ATOM      1  N   MET A   1      28.179   0.444  24.245  1.00 41.86           N\nEND\n';
  const cif = '# written by a predictor\ndata_x\nloop_\n_atom_site.id\nATOM   1    N N . MET A 1 1\n';
  assert.equal(detectStructureFormat(pdb, 'model.pdb').kind, 'pdb');
  assert.equal(detectStructureFormat(pdb, 'result_seed-1.cif').kind, 'pdb', 'no data block: PDB text under a .cif name');
  assert.equal(detectStructureFormat(cif, 'model.cif').kind, 'mmcif');
  assert.equal(detectStructureFormat('', 'empty.cif').kind, 'mmcif', 'nothing to go on: trust the name');
  assert.equal(detectStructureFormat(cif, 'upload').kind, 'mmcif');
  assert.equal(parseStructure(pdb, 'model.cif').models[0].atoms.length, 1);
  // Protenix marks its models in the data block name; their B-factors are pLDDT.
  const protenix = parseStructure(['data_job_sample_0_predicted_by_protenix', 'loop_', ...['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_comp_id', 'label_asym_id', 'label_seq_id', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'B_iso_or_equiv'].map((name) => `_atom_site.${name}`), 'ATOM 1 C CA MET A 1 0.0 0.0 0.0 43.07', ''].join('\n'), 'job_sample_0.cif');
  assert.equal(protenix.meta.isPredicted, true);
});
