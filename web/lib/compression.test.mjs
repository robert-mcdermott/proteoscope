import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as zlib from 'node:zlib';
import { isZstd, zstdDecompress } from './zstd.js';
import { snappyDecompress } from './snappy.js';
import { isParquet, openParquet, parquetSource } from './parquet.js';
import { exampleText } from './test-data.mjs';

const TESTDATA = new URL('./testdata/', import.meta.url);
const bytesOf = (name) => new Uint8Array(readFileSync(new URL(name, TESTDATA)));

test('Zstandard frames written by the zstd tool decode (AlphaFold 3 compressed confidences)', () => {
  const packed = bytesOf('confidences.json.zst');
  assert.ok(isZstd(packed));
  const json = JSON.parse(new TextDecoder().decode(zstdDecompress(packed)));
  assert.deepEqual(json.token_res_ids, [1, 2]);
  assert.equal(json.pae[0][1], 4.5);
  assert.throws(() => zstdDecompress(new TextEncoder().encode('not compressed')), /not a Zstandard frame/);
  assert.equal(isZstd(new Uint8Array([1, 2, 3])), false);
});

// Node 22.15+ ships a Zstandard encoder, which makes every block and literal type easy to reach.
test('Zstandard decoding matches the reference encoder at every level', { skip: typeof zlib.zstdCompressSync !== 'function' && 'this Node has no zstd encoder' }, () => {
  const text = new TextEncoder().encode(exampleText('1m17'));
  const random = Uint8Array.from({ length: 70000 }, (_, index) => (index * 2654435761) >>> 24);
  const inputs = [new Uint8Array(0), new Uint8Array([42]), new Uint8Array(200000), text, random, text.subarray(0, 5000)];
  for (const input of inputs) {
    for (const level of [1, 3, 12, 19]) {
      const packed = zlib.zstdCompressSync(input, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level, [zlib.constants.ZSTD_c_checksumFlag]: 1 } });
      const unpacked = zstdDecompress(packed);
      assert.equal(unpacked.length, input.length, `length at level ${level}`);
      assert.ok(Buffer.from(unpacked).equals(Buffer.from(input)), `bytes at level ${level}`);
    }
  }
  // Concatenated frames, and a skippable frame in front.
  const two = Buffer.concat([zlib.zstdCompressSync(Buffer.from('first ')), zlib.zstdCompressSync(Buffer.from('second'))]);
  assert.equal(new TextDecoder().decode(zstdDecompress(two)), 'first second');
  const skippable = Buffer.concat([Buffer.from([0x50, 0x2a, 0x4d, 0x18, 2, 0, 0, 0, 9, 9]), zlib.zstdCompressSync(Buffer.from('after'))]);
  assert.equal(new TextDecoder().decode(zstdDecompress(skippable)), 'after');
});

test('Snappy blocks decode, including overlapping back-references', () => {
  const packed = Uint8Array.from(Buffer.from('1QlcTUVFUFFTRFBTVkVQUExTUUVURlNETFdL/hgA/hgA/hgA/hgA/hgA/hgA/hgA/hgA/hgA/hgA/hgA/hgA/hgA/hgAnhgA9BQBAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/1RFR1BEU0RURUdQRFNEVEVHUERTRA==', 'base64'));
  const expected = Buffer.concat([Buffer.from('MEEPQSDPSVEPPLSQETFSDLWK'.repeat(40)), Buffer.from(Array.from({ length: 256 }, (_, index) => index)), Buffer.from('TEGPDSD'.repeat(3))]);
  assert.ok(Buffer.from(snappyDecompress(packed)).equals(expected));
  assert.throws(() => snappyDecompress(Uint8Array.from([5, 0x0d, 1, 2])), /snappy/);
});

test('Parquet: DIA-NN style (ZSTD, PLAIN, required columns, two row groups)', async () => {
  const bytes = bytesOf('diann-report.parquet');
  assert.ok(isParquet(bytes));
  const file = await openParquet(parquetSource(bytes));
  assert.equal(file.rows, 10);
  assert.equal(file.rowGroups.length, 2);
  assert.deepEqual(file.columns.map((column) => `${column.name}:${column.type}`).slice(0, 7), [
    'Run:BYTE_ARRAY', 'Protein.Ids:BYTE_ARRAY', 'Genes:BYTE_ARRAY', 'Stripped.Sequence:BYTE_ARRAY', 'Modified.Sequence:BYTE_ARRAY', 'Precursor.Charge:INT64', 'Precursor.Quantity:FLOAT',
  ]);
  const data = await file.readColumns(['Run', 'Stripped.Sequence', 'Precursor.Charge', 'Precursor.Quantity']);
  assert.deepEqual(data.Run.slice(4, 7), ['ctrl_1', 'treat_1', 'treat_1']);
  assert.deepEqual(data['Precursor.Charge'].slice(0, 3), [3, 2, 2]);
  assert.equal(data['Precursor.Quantity'][0], 200000);
  // Filtered scans read the other columns only where the filter matches.
  const kept = [];
  await file.scan(['Stripped.Sequence', 'Run'], { filter: { column: 'Genes', test: (value) => value === 'KRAS' }, onRows: (rows) => kept.push(...rows['Stripped.Sequence'].map((sequence, index) => `${rows.Run[index]}:${sequence}`)) });
  assert.deepEqual(kept, ['ctrl_1:LVVVGAGGVGK', 'treat_1:LVVVGAGGVGK']);
  await assert.rejects(file.readColumns(['Missing.Column']), /no column/);
});

test('Parquet: pandas style (SNAPPY, dictionary pages, data page v2, nullable columns)', async () => {
  const file = await openParquet(parquetSource(bytesOf('pandas-report.parquet')));
  const data = await file.readColumns(['Protein.Ids', 'Site.Occupancy.Probabilities', 'Q.Value']);
  assert.equal(data['Protein.Ids'].length, 10);
  assert.equal(data['Protein.Ids'][2], 'P04637;P04637-2');
  assert.equal(data['Site.Occupancy.Probabilities'][1], '');
  assert.ok(Math.abs(data['Q.Value'][8] - 0.03) < 1e-6);
  await assert.rejects(openParquet(parquetSource(new TextEncoder().encode('PAR1 but not really a parquet file'))), /Parquet/);
});

test('Parquet logical types: unsigned integers and decimals; corrupt pages are errors', async () => {
  const file = await openParquet(parquetSource(bytesOf('types.parquet')));
  const columns = await file.readColumns(['u32', 'u64', 'dec', 'dec64', 'wide', 'name']);
  assert.deepEqual(columns.u32, [0, 1, 2147483648, 4294967295]);
  assert.deepEqual(columns.u64, [0, 1, 2 ** 40, 2 ** 53]);
  assert.deepEqual(columns.dec, [-7936.243, 86715.171, null, 0.001]);
  assert.deepEqual(columns.dec64, [12.5, -0.25, 3, null]);
  assert.deepEqual(columns.wide, [-7936.243, 123456789012345678.901, null, 0.001], 'a decimal stored as bytes');
  assert.deepEqual(columns.name, ['a', null, 'c', 'd']);
  // A dictionary index past the dictionary's end.
  const corrupt = await openParquet(parquetSource(bytesOf('corrupt-dictionary.parquet')));
  await assert.rejects(corrupt.readColumns(corrupt.columns.map((column) => column.name)), /Corrupt Parquet page/);
});

test('truncated Zstandard and Snappy input is an error, not partial output', () => {
  const frame = bytesOf('confidences.json.zst');
  assert.throws(() => zstdDecompress(Uint8Array.from([...frame, 0x50, 0x2a, 0x4d, 0x18, 0xff, 0xff, 0, 0])), /truncated skippable frame/);
  const checksummed = zlib.zstdCompressSync ? new Uint8Array(zlib.zstdCompressSync(Buffer.from('abcde'), { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } })) : null;
  if (checksummed) assert.throws(() => zstdDecompress(checksummed.subarray(0, checksummed.length - 3)), /truncated content checksum/);
  assert.throws(() => snappyDecompress(Uint8Array.from([2, 0, 65, 2, 1])), /truncated back-reference/);
});
