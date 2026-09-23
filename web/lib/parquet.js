// A Parquet reader for flat tables, enough for proteomics reports: DIA-NN's report.parquet (ZSTD,
// PLAIN, required columns) and the files pandas, pyarrow or R write from them (SNAPPY or GZIP,
// dictionary encoding, optional columns). Only the footer and the requested column chunks are
// read, through `source.read(start, end)`, so a report of several gigabytes can be scanned row
// group by row group and filtered as it is read. Nested columns (lists, maps) are not supported.

import { zstdDecompress } from './zstd.js';
import { snappyDecompress } from './snappy.js';

const TYPES = ['BOOLEAN', 'INT32', 'INT64', 'INT96', 'FLOAT', 'DOUBLE', 'BYTE_ARRAY', 'FIXED_LEN_BYTE_ARRAY'];
const CODECS = ['UNCOMPRESSED', 'SNAPPY', 'GZIP', 'LZO', 'BROTLI', 'LZ4', 'ZSTD', 'LZ4_RAW'];
const ENCODING = { PLAIN: 0, PLAIN_DICTIONARY: 2, RLE: 3, BIT_PACKED: 4, RLE_DICTIONARY: 8 };
const PAGE = { DATA: 0, INDEX: 1, DICTIONARY: 2, DATA_V2: 3 };

export function isParquet(bytes) {
  return bytes?.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x41 && bytes[2] === 0x52 && bytes[3] === 0x31;
}

// A source from a Uint8Array, or from a File/Blob (only the needed ranges are read).
export function parquetSource(data) {
  if (data instanceof Uint8Array) return { size: data.length, read: async (start, end) => data.subarray(start, end) };
  return { size: data.size, read: async (start, end) => new Uint8Array(await data.slice(start, end).arrayBuffer()) };
}

export async function openParquet(source) {
  const size = source.size;
  if (size < 12) throw new Error('Not a Parquet file (too short).');
  const tail = await source.read(size - 8, size);
  if (tail[4] !== 0x50 || tail[5] !== 0x41 || tail[6] !== 0x52 || tail[7] !== 0x31) throw new Error('Not a Parquet file (no PAR1 footer).');
  const footerLength = (tail[0] | (tail[1] << 8) | (tail[2] << 16) | (tail[3] << 24)) >>> 0;
  if (footerLength + 12 > size) throw new Error('Corrupt Parquet footer.');
  const footer = await source.read(size - 8 - footerLength, size - 8);
  const meta = new ThriftReader(footer).struct();
  const schema = (meta[2] ?? []).map((element) => ({
    type: element[1],
    typeLength: element[2],
    repetition: element[3] ?? 0,
    name: element[4],
    children: element[5] ?? 0,
    convertedType: element[6],
    scale: element[7],
    logicalType: element[10],
  }));
  const columns = flatColumns(schema);
  const rowGroups = (meta[4] ?? []).map((group) => ({
    rows: Number(group[3] ?? 0),
    chunks: (group[1] ?? []).map((chunk) => {
      const data = chunk[3] ?? {};
      return {
        path: (data[3] ?? []).join('.'),
        type: data[1],
        codec: data[4] ?? 0,
        values: Number(data[5] ?? 0),
        compressedSize: Number(data[7] ?? 0),
        dataOffset: Number(data[9] ?? 0),
        dictionaryOffset: data[11] === undefined ? null : Number(data[11]),
      };
    }),
  }));
  const file = {
    rows: Number(meta[3] ?? 0),
    createdBy: meta[6] ?? '',
    columns,
    rowGroups,
    metadata: Object.fromEntries((meta[5] ?? []).map((item) => [item[1], item[2]])),
    // Reads whole columns: { name: array }.
    async readColumns(names, options = {}) {
      const result = Object.fromEntries(names.map((name) => [name, []]));
      await file.scan(names, { ...options, onRows: (rows) => {
        for (const name of names) for (const value of rows[name]) result[name].push(value);
      } });
      return result;
    },
    // Visits the table one row group at a time. With `filter` (a column name and a predicate on
    // its value) the other columns are read only for row groups with matching rows, and only
    // matching rows are passed on.
    async scan(names, options = {}) {
      for (const name of names) if (!columns.some((column) => column.name === name)) throw new Error(`The Parquet file has no column "${name}".`);
      const filterName = options.filter?.column;
      for (const [index, group] of rowGroups.entries()) {
        if (!group.rows) continue;
        let keep = null;
        const values = {};
        if (filterName) {
          const column = await readChunk(source, group, columns.find((item) => item.name === filterName));
          keep = [];
          column.forEach((value, row) => {
            if (options.filter.test(value)) keep.push(row);
          });
          options.onProgress?.(index + 1, rowGroups.length);
          if (!keep.length) continue;
          if (names.includes(filterName)) values[filterName] = keep.map((row) => column[row]);
        }
        for (const name of names) {
          if (values[name]) continue;
          const column = await readChunk(source, group, columns.find((item) => item.name === name));
          values[name] = keep ? keep.map((row) => column[row]) : column;
        }
        if (!filterName) options.onProgress?.(index + 1, rowGroups.length);
        await options.onRows?.(values, index);
      }
    },
  };
  return file;
}

// Leaf columns of a flat schema with their maximum definition level; nested groups are skipped.
function flatColumns(schema) {
  const columns = [];
  let index = 1;
  const walk = (count, prefix, definition, repeated) => {
    for (let child = 0; child < count && index < schema.length; child += 1) {
      const element = schema[index++];
      const name = prefix ? `${prefix}.${element.name}` : element.name;
      const level = definition + (element.repetition === 1 ? 1 : 0);
      const isRepeated = repeated || element.repetition === 2;
      if (element.children) walk(element.children, name, level, isRepeated);
      else if (!isRepeated) columns.push({ name, type: TYPES[element.type] ?? 'UNKNOWN', typeLength: element.typeLength ?? 0, maxDefinition: level, ...annotation(element) });
    }
  };
  walk(schema[0]?.children ?? 0, '', 0, false);
  return columns;
}

// What a column's logical type changes about its values: unsigned integers (converted types
// UINT_8…UINT_64, or an INTEGER logical type that is not signed) and decimals (a scale).
function annotation(element) {
  const logical = element.logicalType ?? {};
  const unsigned = (element.convertedType >= 11 && element.convertedType <= 14) || (logical[10] && logical[10][2] === false);
  const decimal = element.convertedType === 5 || Boolean(logical[5]);
  const scale = decimal ? Number(logical[5]?.[1] ?? element.scale ?? 0) : null;
  return { unsigned: Boolean(unsigned), scale };
}

async function readChunk(source, group, column) {
  const chunk = group.chunks.find((item) => item.path === column.name);
  if (!chunk) throw new Error(`Row group without column ${column.name}.`);
  const start = chunk.dictionaryOffset !== null && chunk.dictionaryOffset > 0 && chunk.dictionaryOffset < chunk.dataOffset ? chunk.dictionaryOffset : chunk.dataOffset;
  const bytes = await source.read(start, start + chunk.compressedSize);
  const values = [];
  let dictionary = null;
  let position = 0;
  while (values.length < chunk.values && position < bytes.length) {
    const reader = new ThriftReader(bytes, position);
    const header = reader.struct();
    position = reader.position;
    const type = header[1];
    const compressedSize = header[3];
    const uncompressedSize = header[2];
    if (!Number.isInteger(compressedSize) || !Number.isInteger(uncompressedSize) || compressedSize < 0 || uncompressedSize < 0 || position + compressedSize > bytes.length) {
      throw new Error(`Corrupt Parquet page in column ${column.name}.`);
    }
    const body = bytes.subarray(position, position + compressedSize);
    position += compressedSize;
    if (type === PAGE.DICTIONARY) {
      const page = await decompress(body, chunk.codec, uncompressedSize);
      dictionary = decodePlain(page, 0, column, header[7][1]).values;
    } else if (type === PAGE.DATA) {
      const page = await decompress(body, chunk.codec, uncompressedSize);
      const info = header[5];
      decodeDataPage(page, 0, info[1], info[2], column, dictionary, values);
    } else if (type === PAGE.DATA_V2) {
      const info = header[8];
      const levelBytes = info[5] + info[6];
      const compressed = info[7] !== false;
      const valuesPage = compressed ? await decompress(body.subarray(levelBytes), chunk.codec, uncompressedSize - levelBytes) : body.subarray(levelBytes);
      const levels = body.subarray(info[6], levelBytes);
      decodeDataPageV2(levels, valuesPage, info[1], info[4], column, dictionary, values);
    }
  }
  if (values.length !== chunk.values) throw new Error(`Column ${column.name} has ${values.length} values where its metadata says ${chunk.values}.`);
  return values;
}

async function decompress(bytes, codec, size) {
  switch (CODECS[codec]) {
    case 'UNCOMPRESSED':
      return bytes;
    case 'ZSTD':
      return zstdDecompress(bytes, size);
    case 'SNAPPY':
      return snappyDecompress(bytes);
    case 'GZIP': {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    default:
      throw new Error(`Parquet pages compressed with ${CODECS[codec] ?? codec} are not supported; re-save the table with ZSTD, SNAPPY or GZIP.`);
  }
}

function decodeDataPage(page, start, count, encoding, column, dictionary, out) {
  let position = start;
  let definitions = null;
  if (column.maxDefinition > 0) {
    const length = (page[position] | (page[position + 1] << 8) | (page[position + 2] << 16) | (page[position + 3] << 24)) >>> 0;
    position += 4;
    definitions = decodeHybrid(page, position, position + length, bitWidth(column.maxDefinition), count);
    position += length;
  }
  appendValues(page, position, count, encoding, column, dictionary, definitions, out);
}

function decodeDataPageV2(levels, page, count, encoding, column, dictionary, out) {
  const definitions = column.maxDefinition > 0 ? decodeHybrid(levels, 0, levels.length, bitWidth(column.maxDefinition), count) : null;
  appendValues(page, 0, count, encoding, column, dictionary, definitions, out);
}

function appendValues(page, position, count, encoding, column, dictionary, definitions, out) {
  if (definitions && definitions.length !== count) throw new Error(`Corrupt Parquet page in column ${column.name}: ${definitions.length} of ${count} levels.`);
  const present = definitions ? definitions.reduce((sum, level) => sum + (level === column.maxDefinition ? 1 : 0), 0) : count;
  let values;
  if (encoding === ENCODING.PLAIN) {
    values = decodePlain(page, position, column, present).values;
  } else if (encoding === ENCODING.PLAIN_DICTIONARY || encoding === ENCODING.RLE_DICTIONARY) {
    if (!dictionary) throw new Error(`Column ${column.name} is dictionary-encoded but has no dictionary page.`);
    const width = page[position];
    const indices = decodeHybrid(page, position + 1, page.length, width, present);
    values = indices.map((index) => {
      if (index >= dictionary.length) throw new Error(`Corrupt Parquet page in column ${column.name}: dictionary index ${index} of ${dictionary.length}.`);
      return dictionary[index];
    });
  } else if (encoding === ENCODING.RLE && column.type === 'BOOLEAN') {
    const length = (page[position] | (page[position + 1] << 8) | (page[position + 2] << 16) | (page[position + 3] << 24)) >>> 0;
    values = decodeHybrid(page, position + 4, position + 4 + length, 1, present).map(Boolean);
  } else {
    throw new Error(`Parquet encoding ${encoding} (column ${column.name}) is not supported.`);
  }
  if (values.length !== present) throw new Error(`Corrupt Parquet page in column ${column.name}: ${values.length} of ${present} values.`);
  if (!definitions) {
    for (const value of values) out.push(value);
    return;
  }
  let next = 0;
  for (const level of definitions) out.push(level === column.maxDefinition ? values[next++] : null);
}

const utf8 = new TextDecoder();

// Report strings are short and mostly ASCII, which String.fromCharCode builds faster than a
// TextDecoder call per value.
function decodeText(bytes, start, end) {
  if (end - start > 96) return utf8.decode(bytes.subarray(start, end));
  let text = '';
  for (let index = start; index < end; index += 1) {
    const byte = bytes[index];
    if (byte > 127) return utf8.decode(bytes.subarray(start, end));
    text += String.fromCharCode(byte);
  }
  return text;
}

function decodePlain(page, start, column, count) {
  const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
  const values = new Array(count);
  let position = start;
  switch (column.type) {
    case 'BOOLEAN':
      for (let index = 0; index < count; index += 1) values[index] = Boolean((page[position + (index >> 3)] >> (index & 7)) & 1);
      position += Math.ceil(count / 8);
      break;
    case 'INT32':
      for (let index = 0; index < count; index += 1, position += 4) values[index] = column.unsigned ? view.getUint32(position, true) : view.getInt32(position, true);
      break;
    case 'INT64':
      for (let index = 0; index < count; index += 1, position += 8) values[index] = (column.unsigned ? view.getUint32(position + 4, true) : view.getInt32(position + 4, true)) * 4294967296 + view.getUint32(position, true);
      break;
    case 'INT96':
      // Legacy timestamps: nanoseconds of the day and a Julian day, read as milliseconds since 1970.
      for (let index = 0; index < count; index += 1, position += 12) {
        const nanoseconds = view.getUint32(position + 4, true) * 4294967296 + view.getUint32(position, true);
        values[index] = (view.getInt32(position + 8, true) - 2440588) * 86400000 + nanoseconds / 1e6;
      }
      break;
    case 'FLOAT':
      for (let index = 0; index < count; index += 1, position += 4) values[index] = view.getFloat32(position, true);
      break;
    case 'DOUBLE':
      for (let index = 0; index < count; index += 1, position += 8) values[index] = view.getFloat64(position, true);
      break;
    case 'BYTE_ARRAY':
      for (let index = 0; index < count; index += 1) {
        const length = view.getUint32(position, true);
        position += 4;
        values[index] = column.scale !== null ? bigEndianInteger(page, position, position + length) : decodeText(page, position, position + length);
        position += length;
      }
      break;
    case 'FIXED_LEN_BYTE_ARRAY':
      for (let index = 0; index < count; index += 1, position += column.typeLength) {
        values[index] = column.scale !== null ? bigEndianInteger(page, position, position + column.typeLength) : utf8.decode(page.subarray(position, position + column.typeLength));
      }
      break;
    default:
      throw new Error(`Parquet type ${column.type} is not supported.`);
  }
  if (column.scale !== null && column.type !== 'FLOAT' && column.type !== 'DOUBLE') {
    const divisor = 10 ** column.scale;
    for (let index = 0; index < count; index += 1) values[index] /= divisor;
  }
  return { values, end: position };
}

// A two's-complement big-endian integer (decimals stored as bytes), as a number.
function bigEndianInteger(bytes, start, end) {
  if (end <= start) return 0;
  let value = 0n;
  for (let index = start; index < end; index += 1) value = (value << 8n) | BigInt(bytes[index]);
  if (bytes[start] & 0x80) value -= 1n << BigInt(8 * (end - start));
  return Number(value);
}

function bitWidth(max) {
  return max ? 32 - Math.clz32(max) : 0;
}

// The RLE / bit-packed hybrid encoding of levels and dictionary indices.
function decodeHybrid(bytes, start, end, width, count) {
  const values = [];
  let position = start;
  const byteWidth = Math.ceil(width / 8);
  while (values.length < count && position < end) {
    let header = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[position++];
      header += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(byte & 0x80)) break;
    }
    if (header % 2 === 1) {
      const total = Math.floor(header / 2) * 8;
      const take = Math.min(total, count - values.length);
      const mask = width >= 32 ? 0xffffffff : (1 << width) - 1;
      let bit = position * 8;
      for (let index = 0; index < take; index += 1, bit += width) {
        if (width <= 24) {
          const at = bit >>> 3;
          const word = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
          values.push((word >>> (bit & 7)) & mask);
        } else {
          let value = 0;
          for (let b = 0; b < width; b += 1) value += ((bytes[(bit + b) >> 3] >> ((bit + b) & 7)) & 1) * 2 ** b;
          values.push(value);
        }
      }
      position += Math.ceil((total * width) / 8);
    } else {
      const run = Math.floor(header / 2);
      let value = 0;
      for (let index = 0; index < byteWidth; index += 1) value |= bytes[position + index] << (8 * index);
      position += byteWidth;
      for (let index = 0; index < run && values.length < count; index += 1) values.push(value);
    }
  }
  return values;
}

// Thrift compact protocol: structs become objects keyed by field id.
class ThriftReader {
  constructor(bytes, position = 0) {
    this.bytes = bytes;
    this.position = position;
  }

  byte() {
    if (this.position >= this.bytes.length) throw new Error('Truncated Parquet metadata.');
    return this.bytes[this.position++];
  }

  varint() {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = this.byte();
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(byte & 0x80)) return value;
      if (shift > 63) throw new Error('Bad varint in Parquet metadata.');
    }
  }

  zigzag() {
    const value = this.varint();
    return value % 2 ? -(value + 1) / 2 : value / 2;
  }

  // Every element of a container takes at least a byte, so a larger count is corrupt (and would
  // otherwise spin for a very long time).
  fits(count) {
    if (count > this.bytes.length - this.position) throw new Error('Corrupt Parquet metadata.');
  }

  // Inside lists and maps a boolean is a byte of its own, not part of a field header.
  element(type) {
    return type === 1 || type === 2 ? this.byte() === 1 : this.value(type);
  }

  struct() {
    const result = {};
    let field = 0;
    for (;;) {
      const header = this.byte();
      const type = header & 15;
      if (type === 0) return result;
      const delta = header >> 4;
      field = delta ? field + delta : this.zigzag();
      result[field] = this.value(type);
    }
  }

  value(type) {
    switch (type) {
      case 1:
        return true;
      case 2:
        return false;
      case 3:
        return (this.byte() << 24) >> 24;
      case 4:
      case 5:
      case 6:
        return this.zigzag();
      case 7: {
        this.fits(8);
        const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.position, 8);
        this.position += 8;
        return view.getFloat64(0, true);
      }
      case 8: {
        const length = this.varint();
        const text = utf8.decode(this.bytes.subarray(this.position, this.position + length));
        this.position += length;
        return text;
      }
      case 9:
      case 10: {
        const header = this.byte();
        const size = header >> 4 === 15 ? this.varint() : header >> 4;
        this.fits(size);
        const elementType = header & 15;
        const list = new Array(size);
        for (let index = 0; index < size; index += 1) list[index] = this.element(elementType);
        return list;
      }
      case 11: {
        const size = this.varint();
        if (!size) return {};
        this.fits(2 * size);
        const types = this.byte();
        const map = {};
        for (let index = 0; index < size; index += 1) {
          const key = this.element(types >> 4);
          map[key] = this.element(types & 15);
        }
        return map;
      }
      case 12:
        return this.struct();
      default:
        throw new Error(`Unknown Thrift type ${type} in Parquet metadata.`);
    }
  }
}
