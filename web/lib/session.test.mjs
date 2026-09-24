import assert from 'node:assert/strict';
import test from 'node:test';
import { compressText, decodeLinkPayload, decompressText, encodeLinkPayload } from './codec.js';
import { createZip, crc32, readZip } from './zip.js';
import { buildMolViewSpec, columnMajor, referenceCameraPosition, residueColors, residueSelector } from './mvs.js';

test('text survives gzip and link encoding', async () => {
  const text = 'ATOM      1  N   MET A   1      27.340  24.430   2.614  1.00  9.38           N\n'.repeat(200);
  assert.equal(await decompressText(await compressText(text)), text);
  const payload = await encodeLinkPayload(JSON.stringify({ format: 'proteoscope-session', structures: ['4AKE', '1AKE'] }));
  assert.match(payload, /^[A-Za-z0-9_-]+$/, 'URL-safe characters only');
  assert.deepEqual(JSON.parse(await decodeLinkPayload(payload)).structures, ['4AKE', '1AKE']);
});

test('CRC-32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZIP archives round-trip stored and deflated entries with sizes in the local headers', async () => {
  const big = 'HETATM'.repeat(2000);
  const archive = await createZip([{ name: 'index.mvsj', data: '{"x":1}' }, { name: 'structures/1-a.cif', data: big }]);
  const view = new DataView(archive.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true) & 0x0008, 0, 'no data descriptor');
  assert.equal(view.getUint32(22, true), 7, 'uncompressed size in the local header');
  const files = await readZip(archive);
  assert.equal(new TextDecoder().decode(files.get('index.mvsj')), '{"x":1}');
  assert.equal(new TextDecoder().decode(files.get('structures/1-a.cif')), big);
});

test('MVS rotation matrices are written column-major', () => {
  assert.deepEqual(columnMajor([1, 2, 3, 4, 5, 6, 7, 8, 9]), [1, 4, 7, 2, 5, 8, 3, 6, 9]);
});

test('residues collapse into ranges and color groups', () => {
  const residues = [
    { chain: 'A', seq: 1, color: '#ff0000' },
    { chain: 'A', seq: 2, color: '#ff0000' },
    { chain: 'A', seq: 3, color: '#0000ff' },
    { chain: 'A', seq: 5, color: '#ff0000' },
    { chain: 'A', seq: 5, iCode: 'A', color: '#ff0000' },
    { chain: 'B', seq: 6, color: '#ff0000' },
  ];
  assert.deepEqual(residueSelector(residues.filter((residue) => residue.color === '#ff0000')), [
    { auth_asym_id: 'A', beg_auth_seq_id: 1, end_auth_seq_id: 2 },
    { auth_asym_id: 'A', auth_seq_id: 5 },
    { auth_asym_id: 'A', auth_seq_id: 5, pdbx_PDB_ins_code: 'A' },
    { auth_asym_id: 'B', auth_seq_id: 6 },
  ]);
  const groups = residueColors(residues);
  assert.equal(groups.length, 2);
  assert.deepEqual(residueColors(residues.slice(0, 2)), [{ color: '#ff0000' }]);
});

test('MVS tree nests download, parse, structure, transform, component, representation and color', () => {
  const spec = buildMolViewSpec({
    title: '1AKE onto 4AKE',
    background: '#ffffff',
    camera: { target: [1, 2, 3], position: [1, 2, 53], up: [0, 1, 0] },
    structures: [{
      url: 'https://files.rcsb.org/download/1AKE.cif',
      format: 'mmcif',
      structure: { type: 'model', model_index: 0 },
      transform: { rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1], translation: [5, 0, 0] },
      components: [{
        selector: 'polymer',
        representations: [{ type: 'cartoon', colors: [{ color: '#f39c3d' }], opacity: 0.5 }],
        labels: ['1AKE'],
      }],
    }],
  }, { date: new Date('2026-09-23T00:00:00Z') });
  assert.deepEqual(spec.metadata, { version: '1', timestamp: '2026-09-23T00:00:00.000Z', title: '1AKE onto 4AKE' });
  const download = spec.root.children[0];
  assert.equal(download.kind, 'download');
  const structure = download.children[0].children[0];
  assert.equal(structure.kind, 'structure');
  assert.deepEqual(structure.children[0], { kind: 'transform', params: { rotation: [0, 1, 0, -1, 0, 0, 0, 0, 1], translation: [5, 0, 0] } });
  const component = structure.children[1];
  assert.equal(component.params.selector, 'polymer');
  assert.deepEqual(component.children[0].children, [
    { kind: 'color', params: { color: '#f39c3d' } },
    { kind: 'opacity', params: { opacity: 0.5 } },
  ]);
  assert.deepEqual(component.children[1], { kind: 'label', params: { text: '1AKE' } });
  assert.deepEqual(spec.root.children.slice(1).map((child) => child.kind), ['canvas', 'camera']);
});

test('the reference camera distance matches a 60° field of view', () => {
  const position = referenceCameraPosition([0, 0, 0], [0, 0, 100], Math.PI / 3);
  assert.ok(Math.abs(position[2] - 100) < 1e-9, 'a 60° camera is already the reference');
  const narrow = referenceCameraPosition([0, 0, 0], [0, 0, 100], (30 * Math.PI) / 180);
  assert.ok(narrow[2] < 60 && narrow[2] > 45);
});
