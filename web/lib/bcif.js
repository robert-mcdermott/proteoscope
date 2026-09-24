// BinaryCIF (https://github.com/molstar/BinaryCIF): MessagePack-encoded mmCIF with per-column
// encodings. decodeBinaryCIF() returns the categories of the first data block, and
// binaryCIFToText() writes them as ordinary PDBx/mmCIF text so the rest of Proteoscope (the
// parser, sessions and exports) treats the file like any other mmCIF.

export function isBinaryCIF(bytes) {
  if (!bytes?.length) return false;
  const first = bytes[0];
  // A top-level MessagePack map (fixmap, map16 or map32) whose keys include "dataBlocks".
  if (!((first & 0xf0) === 0x80 || first === 0xde || first === 0xdf)) return false;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 512)));
  return head.includes('dataBlocks');
}

export function decodeBinaryCIF(bytes) {
  const file = decodeMessagePack(bytes);
  const block = file?.dataBlocks?.[0];
  if (!block) throw new Error('This BinaryCIF file has no data blocks.');
  return { ...decodeBlock(block), encoder: file.encoder ?? '', version: file.version ?? '' };
}

// Every data block, for files with several (the volume server sends one per map channel).
export function decodeBinaryCIFBlocks(bytes) {
  const file = decodeMessagePack(bytes);
  if (!file?.dataBlocks?.length) throw new Error('This BinaryCIF file has no data blocks.');
  return file.dataBlocks.map(decodeBlock);
}

function decodeBlock(block) {
  const categories = [];
  for (const category of block.categories ?? []) {
    const columns = [];
    for (const column of category.columns ?? []) {
      const values = decodeData(column.data);
      const mask = column.mask ? decodeData(column.mask) : null;
      columns.push({ name: column.name, values, mask });
    }
    categories.push({ name: String(category.name).replace(/^_/, ''), rowCount: category.rowCount, columns });
  }
  return { header: block.header ?? '', categories };
}

export function binaryCIFToText(bytes) {
  const document = decodeBinaryCIF(bytes);
  const lines = [`data_${document.header || 'structure'}`, '#'];
  for (const category of document.categories) {
    if (!category.rowCount || !category.columns.length) continue;
    lines.push('loop_');
    for (const column of category.columns) lines.push(`_${category.name}.${column.name}`);
    for (let row = 0; row < category.rowCount; row += 1) {
      let line = '';
      for (const column of category.columns) {
        const value = cifToken(column, row);
        if (value.startsWith('\n;')) {
          lines.push(line);
          lines.push(value.slice(1));
          line = '';
        } else {
          line += line ? ` ${value}` : value;
        }
      }
      if (line) lines.push(line);
    }
    lines.push('#');
  }
  return `${lines.join('\n')}\n`;
}

function cifToken(column, row) {
  const flag = column.mask?.[row] ?? 0;
  if (flag === 1) return '.';
  if (flag === 2) return '?';
  const value = column.values[row];
  if (value === null || value === undefined) return '?';
  if (typeof value === 'number') return formatNumber(value);
  return quoteCIF(String(value));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '?';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(10)));
}

function quoteCIF(text) {
  if (text === '') return '.';
  if (text.includes('\n')) return `\n;${text}\n;`;
  const special = /\s/.test(text) || /^[_#$'"[\];]/.test(text) || /^(loop_|stop_|global_|data_|save_)/i.test(text) || text === '.' || text === '?';
  if (!special) return text;
  if (!text.includes("'")) return `'${text}'`;
  if (!text.includes('"')) return `"${text}"`;
  return `\n;${text}\n;`;
}

/* ---------- Column decoding ---------- */

const DATA_TYPES = {
  1: Int8Array, 2: Int16Array, 3: Int32Array, 4: Uint8Array, 5: Uint16Array, 6: Uint32Array, 32: Float32Array, 33: Float64Array,
};

export function decodeData(encoded) {
  let result = encoded.data;
  const encodings = encoded.encoding ?? [];
  for (let index = encodings.length - 1; index >= 0; index -= 1) result = decodeStep(result, encodings[index]);
  return result;
}

function decodeStep(data, encoding) {
  switch (encoding.kind) {
    case 'ByteArray': {
      const Type = DATA_TYPES[encoding.type];
      if (!Type) throw new Error(`Unknown BinaryCIF data type ${encoding.type}.`);
      if (Type === Uint8Array) return data;
      const copy = data.slice();
      return new Type(copy.buffer, 0, copy.byteLength / Type.BYTES_PER_ELEMENT);
    }
    case 'FixedPoint': {
      const output = new Float64Array(data.length);
      for (let index = 0; index < data.length; index += 1) output[index] = data[index] / encoding.factor;
      return output;
    }
    case 'IntervalQuantization': {
      const output = new Float64Array(data.length);
      const delta = (encoding.max - encoding.min) / (encoding.numSteps - 1);
      for (let index = 0; index < data.length; index += 1) output[index] = encoding.min + delta * data[index];
      return output;
    }
    case 'RunLength': {
      const output = new (DATA_TYPES[encoding.srcType] ?? Int32Array)(encoding.srcSize);
      let cursor = 0;
      for (let index = 0; index + 1 < data.length; index += 2) {
        const value = data[index];
        const count = data[index + 1];
        output.fill(value, cursor, cursor + count);
        cursor += count;
      }
      return output;
    }
    case 'Delta': {
      const output = new (DATA_TYPES[encoding.srcType] ?? Int32Array)(data.length);
      if (!data.length) return output;
      output[0] = data[0] + (encoding.origin | 0);
      for (let index = 1; index < data.length; index += 1) output[index] = data[index] + output[index - 1];
      return output;
    }
    case 'IntegerPacking':
      return unpackIntegers(data, encoding);
    case 'StringArray': {
      const offsets = decodeData({ encoding: encoding.offsetEncoding, data: encoding.offsets });
      const indices = decodeData({ encoding: encoding.dataEncoding, data });
      const text = encoding.stringData ?? '';
      const strings = new Array(offsets.length);
      strings[0] = '';
      for (let index = 1; index < offsets.length; index += 1) strings[index] = text.substring(offsets[index - 1], offsets[index]);
      const output = new Array(indices.length);
      for (let index = 0; index < indices.length; index += 1) output[index] = strings[indices[index] + 1];
      return output;
    }
    default:
      throw new Error(`Unknown BinaryCIF encoding "${encoding.kind}".`);
  }
}

// Values outside the packed range are split into a run of limit values plus a remainder.
function unpackIntegers(data, encoding) {
  if (data.length === encoding.srcSize) return Int32Array.from(data);
  const unsigned = encoding.isUnsigned;
  const upper = encoding.byteCount === 1 ? (unsigned ? 0xff : 0x7f) : (unsigned ? 0xffff : 0x7fff);
  const lower = unsigned ? null : (encoding.byteCount === 1 ? -0x80 : -0x8000);
  const output = new Int32Array(encoding.srcSize);
  let read = 0;
  let write = 0;
  while (read < data.length) {
    let value = 0;
    let item = data[read];
    while (item === upper || item === lower) {
      value += item;
      read += 1;
      item = data[read];
    }
    value += item;
    output[write] = value;
    read += 1;
    write += 1;
  }
  return output;
}

/* ---------- MessagePack ---------- */

export function decodeMessagePack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  const text = (length) => {
    const value = decoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  };
  const binary = (length) => {
    const value = bytes.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const array = (length) => {
    const value = new Array(length);
    for (let index = 0; index < length; index += 1) value[index] = read();
    return value;
  };
  const map = (length) => {
    const value = {};
    for (let index = 0; index < length; index += 1) {
      const key = read();
      value[key] = read();
    }
    return value;
  };
  function read() {
    if (offset >= bytes.length) throw new Error('The BinaryCIF data is truncated.');
    const type = bytes[offset];
    offset += 1;
    if (type < 0x80) return type;
    if (type < 0x90) return map(type & 0x0f);
    if (type < 0xa0) return array(type & 0x0f);
    if (type < 0xc0) return text(type & 0x1f);
    if (type >= 0xe0) return type - 0x100;
    let value;
    switch (type) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: value = view.getUint8(offset); offset += 1; return binary(value);
      case 0xc5: value = view.getUint16(offset); offset += 2; return binary(value);
      case 0xc6: value = view.getUint32(offset); offset += 4; return binary(value);
      case 0xca: value = view.getFloat32(offset); offset += 4; return value;
      case 0xcb: value = view.getFloat64(offset); offset += 8; return value;
      case 0xcc: value = view.getUint8(offset); offset += 1; return value;
      case 0xcd: value = view.getUint16(offset); offset += 2; return value;
      case 0xce: value = view.getUint32(offset); offset += 4; return value;
      case 0xcf: value = Number(view.getBigUint64(offset)); offset += 8; return value;
      case 0xd0: value = view.getInt8(offset); offset += 1; return value;
      case 0xd1: value = view.getInt16(offset); offset += 2; return value;
      case 0xd2: value = view.getInt32(offset); offset += 4; return value;
      case 0xd3: value = Number(view.getBigInt64(offset)); offset += 8; return value;
      case 0xd9: value = view.getUint8(offset); offset += 1; return text(value);
      case 0xda: value = view.getUint16(offset); offset += 2; return text(value);
      case 0xdb: value = view.getUint32(offset); offset += 4; return text(value);
      case 0xdc: value = view.getUint16(offset); offset += 2; return array(value);
      case 0xdd: value = view.getUint32(offset); offset += 4; return array(value);
      case 0xde: value = view.getUint16(offset); offset += 2; return map(value);
      case 0xdf: value = view.getUint32(offset); offset += 4; return map(value);
      default: throw new Error(`Unsupported MessagePack type 0x${type.toString(16)} in BinaryCIF data.`);
    }
  }
  return read();
}
