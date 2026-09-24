// NumPy .npy arrays and .npz archives (Boltz and Chai-1 write their confidence matrices this
// way). Supports the numeric and boolean dtypes plus fixed-width Unicode strings; object arrays
// need Python's pickle and are refused.
import { listZip, readZipEntry } from './zip.js';

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

export function isNpy(bytes) {
  return bytes.length >= 10 && MAGIC.every((value, index) => bytes[index] === value);
}

// Returns { dtype, shape, fortranOrder, data }, where data is a typed array (or an array of
// strings) in C order.
export function readNpy(bytes) {
  if (!isNpy(bytes)) throw new Error('Not a NumPy .npy array.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = bytes[6];
  const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const headerStart = major === 1 ? 10 : 12;
  const header = new TextDecoder(major >= 3 ? 'utf-8' : 'latin1').decode(bytes.subarray(headerStart, headerStart + headerLength));
  const descr = header.match(/'descr'\s*:\s*'([^']+)'/)?.[1];
  const fortranOrder = /'fortran_order'\s*:\s*True/.test(header);
  const shapeText = header.match(/'shape'\s*:\s*\(([^)]*)\)/)?.[1];
  if (!descr || shapeText === undefined) throw new Error('The .npy header is not understood.');
  const shape = shapeText.split(',').map((item) => item.trim()).filter(Boolean).map(Number);
  const count = shape.reduce((product, value) => product * value, 1);
  const offset = headerStart + headerLength;
  let data = decodeArray(bytes, offset, descr, count);
  if (fortranOrder && shape.length > 1) data = toCOrder(data, shape);
  return { dtype: descr, shape, fortranOrder, data };
}

function decodeArray(bytes, offset, descr, count) {
  const order = descr[0];
  const type = descr.slice(1);
  const bigEndian = order === '>';
  if (order === '|' && type[0] === 'O') throw new Error('NumPy object arrays cannot be read (they need Python pickle).');
  if (type[0] === 'U') {
    const width = Number(type.slice(1));
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, count * width * 4);
    const strings = new Array(count);
    for (let index = 0; index < count; index += 1) {
      let text = '';
      for (let char = 0; char < width; char += 1) {
        const code = view.getUint32((index * width + char) * 4, !bigEndian);
        if (!code) break;
        text += String.fromCodePoint(code);
      }
      strings[index] = text;
    }
    return strings;
  }
  if (type[0] === 'S') {
    const width = Number(type.slice(1));
    const decoder = new TextDecoder('latin1');
    return Array.from({ length: count }, (_, index) => decoder.decode(bytes.subarray(offset + index * width, offset + (index + 1) * width)).replace(/\0+$/, ''));
  }
  const kinds = {
    b1: [1, (view, at) => view.getUint8(at), Uint8Array],
    u1: [1, (view, at) => view.getUint8(at), Uint8Array],
    i1: [1, (view, at) => view.getInt8(at), Int8Array],
    u2: [2, (view, at, le) => view.getUint16(at, le), Uint16Array],
    i2: [2, (view, at, le) => view.getInt16(at, le), Int16Array],
    u4: [4, (view, at, le) => view.getUint32(at, le), Uint32Array],
    i4: [4, (view, at, le) => view.getInt32(at, le), Int32Array],
    u8: [8, (view, at, le) => Number(view.getBigUint64(at, le)), Float64Array],
    i8: [8, (view, at, le) => Number(view.getBigInt64(at, le)), Float64Array],
    f2: [2, (view, at, le) => halfToFloat(view.getUint16(at, le)), Float32Array],
    f4: [4, (view, at, le) => view.getFloat32(at, le), Float32Array],
    f8: [8, (view, at, le) => view.getFloat64(at, le), Float64Array],
  };
  const kind = kinds[type];
  if (!kind) throw new Error(`NumPy dtype ${descr} is not supported.`);
  const [size, read, ArrayType] = kind;
  if (offset + count * size > bytes.length) throw new Error('The .npy data is truncated.');
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, count * size);
  const result = new ArrayType(count);
  for (let index = 0; index < count; index += 1) result[index] = read(view, index * size, !bigEndian);
  return result;
}

function halfToFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function toCOrder(data, shape) {
  const count = data.length;
  const result = new data.constructor(count);
  const strides = shape.map((_, axis) => shape.slice(0, axis).reduce((product, value) => product * value, 1));
  const index = new Array(shape.length).fill(0);
  for (let flat = 0; flat < count; flat += 1) {
    let source = 0;
    for (let axis = 0; axis < shape.length; axis += 1) source += index[axis] * strides[axis];
    result[flat] = data[source];
    for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
      index[axis] += 1;
      if (index[axis] < shape[axis]) break;
      index[axis] = 0;
    }
  }
  return result;
}

// Reads every array of an .npz archive into a Map of key (file name without .npy) → array.
export async function readNpz(bytes) {
  const arrays = new Map();
  for (const entry of listZip(bytes)) {
    if (!entry.name.endsWith('.npy')) continue;
    arrays.set(entry.name.slice(0, -4), readNpy(await readZipEntry(bytes, entry)));
  }
  return arrays;
}

// A square matrix from an array of shape (n, n) or (1, n, n).
export function squareMatrix(array) {
  const shape = array?.shape ?? [];
  const n = shape[shape.length - 1];
  if (shape.length < 2 || shape[shape.length - 2] !== n || array.data.length < n * n) return null;
  return { size: n, matrix: Float32Array.from(array.data.subarray ? array.data.subarray(0, n * n) : array.data.slice(0, n * n)) };
}

// Writes a C-order .npy file (used by tests).
export function writeNpy(data, shape, descr = '<f4') {
  let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  const total = 10 + header.length + 1;
  header += ' '.repeat((64 - (total % 64)) % 64) + '\n';
  const body = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const bytes = new Uint8Array(10 + header.length + body.length);
  bytes.set(MAGIC, 0);
  bytes[6] = 1;
  bytes[7] = 0;
  new DataView(bytes.buffer).setUint16(8, header.length, true);
  bytes.set(new TextEncoder().encode(header), 10);
  bytes.set(body, 10 + header.length);
  return bytes;
}
