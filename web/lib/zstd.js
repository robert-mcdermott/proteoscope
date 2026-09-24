// Zstandard decompression (RFC 8878) for the files that use it: DIA-NN's report.parquet pages
// and AlphaFold 3's --compress_large_output_files (.zst) output. The whole input and output are in
// memory. Frames may be concatenated; skippable frames are skipped; dictionaries are not
// supported (neither tool uses them) and the optional content checksum is not verified.

const MAGIC = 0xfd2fb528;
const BLOCK_RAW = 0;
const BLOCK_RLE = 1;
const BLOCK_COMPRESSED = 2;

// Predefined distributions (RFC 8878 §3.1.1.3.2.2) and the code tables of §3.1.1.3.2.1.
const LL_DEFAULT = [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1];
const ML_DEFAULT = [
  1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
];
const OF_DEFAULT = [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1];
const LL_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const LL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ML_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
  35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539,
];
const ML_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
];

let predefined = null;

export function isZstd(bytes) {
  return bytes?.length >= 4 && readU32(bytes, 0) === MAGIC;
}

// Decompresses every frame of `input` (a Uint8Array). `sizeHint` preallocates the output.
export function zstdDecompress(input, sizeHint = 0) {
  // Four spare bytes let the bit readers load whole words at the end of the data.
  const bytes = new Uint8Array(input.length + 8);
  bytes.set(input);
  const output = new Output(sizeHint || input.length * 4);
  let position = 0;
  while (position < input.length) {
    if (input.length - position < 4) throw new Error('zstd: truncated frame');
    const magic = readU32(bytes, position);
    if ((magic & 0xfffffff0) === 0x184d2a50) {
      if (input.length - position < 8) throw new Error('zstd: truncated skippable frame');
      position += 8 + readU32(bytes, position + 4);
      if (position > input.length) throw new Error('zstd: truncated skippable frame');
      continue;
    }
    if (magic !== MAGIC) throw new Error('zstd: not a Zstandard frame');
    position = decodeFrame(bytes, position + 4, input.length, output);
  }
  return output.result();
}

class Output {
  constructor(capacity) {
    this.buffer = new Uint8Array(Math.max(1024, capacity));
    this.length = 0;
  }

  reserve(extra) {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < needed) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  result() {
    return this.buffer.slice(0, this.length);
  }
}

function decodeFrame(bytes, start, end, output) {
  let position = start;
  const descriptor = bytes[position++];
  const contentSizeFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  if ((descriptor >> 3) & 1) throw new Error('zstd: reserved frame header bit is set');
  const checksum = (descriptor >> 2) & 1;
  const dictionaryFlag = descriptor & 3;
  if (!singleSegment) position += 1;
  const dictionaryBytes = [0, 1, 2, 4][dictionaryFlag];
  let dictionary = 0;
  for (let index = 0; index < dictionaryBytes; index += 1) dictionary += bytes[position + index] * 2 ** (8 * index);
  if (dictionary) throw new Error('zstd: frames that need a dictionary are not supported');
  position += dictionaryBytes;
  const contentSizeBytes = [singleSegment ? 1 : 0, 2, 4, 8][contentSizeFlag];
  let contentSize = 0;
  for (let index = 0; index < contentSizeBytes; index += 1) contentSize += bytes[position + index] * 2 ** (8 * index);
  if (contentSizeBytes === 2) contentSize += 256;
  position += contentSizeBytes;
  if (contentSize) output.reserve(contentSize);

  const frame = { repeat: [1, 4, 8], huffman: null, tables: { ll: null, of: null, ml: null } };
  for (;;) {
    if (position + 3 > end) throw new Error('zstd: truncated block header');
    const header = bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16);
    position += 3;
    const last = header & 1;
    const type = (header >> 1) & 3;
    const size = header >>> 3;
    if (type === BLOCK_RAW) {
      if (position + size > end) throw new Error('zstd: truncated raw block');
      output.reserve(size);
      output.buffer.set(bytes.subarray(position, position + size), output.length);
      output.length += size;
      position += size;
    } else if (type === BLOCK_RLE) {
      output.reserve(size);
      output.buffer.fill(bytes[position], output.length, output.length + size);
      output.length += size;
      position += 1;
    } else if (type === BLOCK_COMPRESSED) {
      if (position + size > end) throw new Error('zstd: truncated compressed block');
      decodeBlock(bytes, position, position + size, output, frame);
      position += size;
    } else {
      throw new Error('zstd: reserved block type');
    }
    if (last) break;
  }
  if (checksum) {
    // The checksum is not verified, but it must be there.
    if (position + 4 > end) throw new Error('zstd: truncated content checksum');
    position += 4;
  }
  return position;
}

function decodeBlock(bytes, start, end, output, frame) {
  const literals = decodeLiterals(bytes, start, end, frame);
  let position = literals.end;
  const first = bytes[position++];
  let sequences = 0;
  if (first < 128) sequences = first;
  else if (first < 255) sequences = ((first - 128) << 8) + bytes[position++];
  else {
    sequences = bytes[position] + (bytes[position + 1] << 8) + 0x7f00;
    position += 2;
  }
  const data = literals.data;
  if (!sequences) {
    output.reserve(data.length);
    output.buffer.set(data, output.length);
    output.length += data.length;
    return;
  }
  const modes = bytes[position++];
  if (modes & 3) throw new Error('zstd: reserved sequence mode bits are set');
  predefined ??= {
    ll: buildDecodingTable(LL_DEFAULT, 6),
    of: buildDecodingTable(OF_DEFAULT, 5),
    ml: buildDecodingTable(ML_DEFAULT, 6),
  };
  const tables = {};
  for (const [name, shift, maxSymbol] of [['ll', 6, 35], ['of', 4, 31], ['ml', 2, 52]]) {
    const mode = (modes >> shift) & 3;
    if (mode === 0) tables[name] = predefined[name];
    else if (mode === 1) {
      tables[name] = rleTable(bytes[position++]);
    } else if (mode === 2) {
      const description = readDistribution(bytes, position, end, maxSymbol);
      tables[name] = buildDecodingTable(description.counts, description.accuracyLog);
      position = description.end;
    } else {
      if (!frame.tables[name]) throw new Error('zstd: repeated sequence table without a previous one');
      tables[name] = frame.tables[name];
    }
    frame.tables[name] = tables[name];
  }

  const reader = new BackwardBits(bytes, position, end);
  let llState = reader.read(tables.ll.accuracyLog);
  let ofState = reader.read(tables.of.accuracyLog);
  let mlState = reader.read(tables.ml.accuracyLog);
  let literalPosition = 0;
  const repeat = frame.repeat;
  for (let index = 0; index < sequences; index += 1) {
    const ofCode = tables.of.symbol[ofState];
    const mlCode = tables.ml.symbol[mlState];
    const llCode = tables.ll.symbol[llState];
    if (ofCode > 31 || mlCode > 52 || llCode > 35) throw new Error('zstd: invalid sequence code');
    const offsetValue = 2 ** ofCode + reader.read(ofCode);
    const matchLength = ML_BASE[mlCode] + reader.read(ML_BITS[mlCode]);
    const literalLength = LL_BASE[llCode] + reader.read(LL_BITS[llCode]);
    let offset;
    if (offsetValue > 3) {
      offset = offsetValue - 3;
      repeat[2] = repeat[1];
      repeat[1] = repeat[0];
      repeat[0] = offset;
    } else {
      const which = offsetValue - 1 + (literalLength === 0 ? 1 : 0);
      if (which === 0) offset = repeat[0];
      else if (which === 3) {
        offset = repeat[0] - 1;
        repeat[2] = repeat[1];
        repeat[1] = repeat[0];
        repeat[0] = offset;
      } else {
        offset = repeat[which];
        if (which === 2) repeat[2] = repeat[1];
        repeat[1] = repeat[0];
        repeat[0] = offset;
      }
    }
    if (index + 1 < sequences) {
      llState = tables.ll.base[llState] + reader.read(tables.ll.bits[llState]);
      mlState = tables.ml.base[mlState] + reader.read(tables.ml.bits[mlState]);
      ofState = tables.of.base[ofState] + reader.read(tables.of.bits[ofState]);
    }

    if (literalPosition + literalLength > data.length) throw new Error('zstd: literal length beyond the literals');
    output.reserve(literalLength + matchLength);
    const buffer = output.buffer;
    buffer.set(data.subarray(literalPosition, literalPosition + literalLength), output.length);
    output.length += literalLength;
    literalPosition += literalLength;
    if (offset < 1 || offset > output.length) throw new Error('zstd: match offset beyond the output');
    let from = output.length - offset;
    let to = output.length;
    if (offset >= matchLength) {
      buffer.copyWithin(to, from, from + matchLength);
    } else {
      for (let count = 0; count < matchLength; count += 1) buffer[to++] = buffer[from++];
    }
    output.length += matchLength;
  }
  if (reader.remaining() !== 0) throw new Error('zstd: sequence bitstream not fully consumed');
  const rest = data.length - literalPosition;
  output.reserve(rest);
  output.buffer.set(data.subarray(literalPosition), output.length);
  output.length += rest;
}

/* ---------- Literals ---------- */

function decodeLiterals(bytes, start, end, frame) {
  const b0 = bytes[start];
  const type = b0 & 3;
  const sizeFormat = (b0 >> 2) & 3;
  if (type === 0 || type === 1) {
    let size;
    let header;
    if ((sizeFormat & 1) === 0) {
      size = b0 >> 3;
      header = 1;
    } else if (sizeFormat === 1) {
      size = (b0 >> 4) + (bytes[start + 1] << 4);
      header = 2;
    } else {
      size = (b0 >> 4) + (bytes[start + 1] << 4) + (bytes[start + 2] << 12);
      header = 3;
    }
    const position = start + header;
    if (type === 0) {
      if (position + size > end) throw new Error('zstd: truncated raw literals');
      return { data: bytes.subarray(position, position + size), end: position + size };
    }
    return { data: new Uint8Array(size).fill(bytes[position]), end: position + 1 };
  }
  let regenerated;
  let compressed;
  let header;
  const word = readU32(bytes, start);
  if (sizeFormat === 0 || sizeFormat === 1) {
    regenerated = (word >>> 4) & 0x3ff;
    compressed = (word >>> 14) & 0x3ff;
    header = 3;
  } else if (sizeFormat === 2) {
    regenerated = (word >>> 4) & 0x3fff;
    compressed = (word >>> 18) & 0x3fff;
    header = 4;
  } else {
    regenerated = (word >>> 4) & 0x3ffff;
    compressed = ((word >>> 22) | (bytes[start + 4] << 10)) & 0x3ffff;
    header = 5;
  }
  const streams = sizeFormat === 0 ? 1 : 4;
  let position = start + header;
  const stop = position + compressed;
  if (stop > end) throw new Error('zstd: truncated compressed literals');
  if (type === 2) {
    const tree = readHuffmanTree(bytes, position, stop);
    frame.huffman = tree.table;
    position = tree.end;
  } else if (!frame.huffman) {
    throw new Error('zstd: treeless literals without a previous Huffman table');
  }
  const data = new Uint8Array(regenerated);
  if (streams === 1) {
    decodeHuffmanStream(bytes, position, stop, frame.huffman, data, 0, regenerated);
  } else {
    const sizes = [bytes[position] | (bytes[position + 1] << 8), bytes[position + 2] | (bytes[position + 3] << 8), bytes[position + 4] | (bytes[position + 5] << 8)];
    position += 6;
    const segment = Math.floor((regenerated + 3) / 4);
    let out = 0;
    for (let index = 0; index < 4; index += 1) {
      const size = index < 3 ? sizes[index] : stop - position;
      const count = index < 3 ? segment : regenerated - 3 * segment;
      if (size < 0 || position + size > stop) throw new Error('zstd: bad Huffman jump table');
      decodeHuffmanStream(bytes, position, position + size, frame.huffman, data, out, count);
      position += size;
      out += count;
    }
  }
  return { data, end: stop };
}

// Huffman weights are stored as 4-bit values or FSE-compressed; the last weight is implied.
function readHuffmanTree(bytes, start, end) {
  const header = bytes[start];
  let position = start + 1;
  let weights;
  if (header >= 128) {
    const count = header - 127;
    weights = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const byte = bytes[position + (index >> 1)];
      weights[index] = index & 1 ? byte & 15 : byte >> 4;
    }
    position += Math.ceil(count / 2);
  } else {
    const stop = position + header;
    if (stop > end) throw new Error('zstd: truncated Huffman weights');
    const description = readDistribution(bytes, position, stop, 255);
    if (description.accuracyLog > 6) throw new Error('zstd: Huffman weight table accuracy too high');
    const table = buildDecodingTable(description.counts, description.accuracyLog);
    const reader = new BackwardBits(bytes, description.end, stop);
    let state1 = reader.read(table.accuracyLog);
    let state2 = reader.read(table.accuracyLog);
    weights = [];
    for (;;) {
      weights.push(table.symbol[state1]);
      state1 = table.base[state1] + reader.read(table.bits[state1]);
      if (reader.overflowed()) {
        weights.push(table.symbol[state2]);
        break;
      }
      weights.push(table.symbol[state2]);
      state2 = table.base[state2] + reader.read(table.bits[state2]);
      if (reader.overflowed()) {
        weights.push(table.symbol[state1]);
        break;
      }
      if (weights.length > 255) throw new Error('zstd: too many Huffman weights');
    }
    position = stop;
  }
  let total = 0;
  for (const weight of weights) {
    if (weight > 11) throw new Error('zstd: Huffman weight too large');
    if (weight) total += 2 ** (weight - 1);
  }
  if (!total) throw new Error('zstd: empty Huffman tree');
  const maxBits = Math.floor(Math.log2(total)) + 1;
  const remainder = 2 ** maxBits - total;
  const lastWeight = Math.log2(remainder) + 1;
  if (!Number.isInteger(lastWeight)) throw new Error('zstd: Huffman weights do not complete a tree');
  weights.push(lastWeight);
  if (maxBits > 11) throw new Error('zstd: Huffman codes too long');
  const size = 1 << maxBits;
  const symbols = new Uint8Array(size);
  const bits = new Uint8Array(size);
  let index = 0;
  for (let weight = 1; weight <= maxBits; weight += 1) {
    for (let symbol = 0; symbol < weights.length; symbol += 1) {
      if (weights[symbol] !== weight) continue;
      const span = 1 << (weight - 1);
      symbols.fill(symbol, index, index + span);
      bits.fill(maxBits + 1 - weight, index, index + span);
      index += span;
    }
  }
  if (index !== size) throw new Error('zstd: Huffman table is not complete');
  return { table: { maxBits, symbols, bits }, end: position };
}

function decodeHuffmanStream(bytes, start, end, table, data, out, count) {
  const reader = new BackwardBits(bytes, start, end);
  const { maxBits, symbols, bits } = table;
  const stop = out + count;
  for (let index = out; index < stop; index += 1) {
    const code = reader.peek(maxBits);
    data[index] = symbols[code];
    reader.skip(bits[code]);
  }
  if (reader.remaining() !== 0) throw new Error('zstd: Huffman stream not fully consumed');
}

/* ---------- FSE ---------- */

function rleTable(symbol) {
  return { accuracyLog: 0, symbol: new Uint8Array([symbol]), bits: new Uint8Array(1), base: new Uint16Array(1) };
}

// Normalized counts (RFC 8878 §4.1.1): read with a forward bit reader.
function readDistribution(bytes, start, end, maxSymbol) {
  let bit = start * 8;
  const peek = (count) => forwardBits(bytes, bit, count);
  const accuracyLog = peek(4) + 5;
  bit += 4;
  if (accuracyLog > 9) throw new Error('zstd: FSE accuracy log too large');
  let remaining = (1 << accuracyLog) + 1;
  let threshold = 1 << accuracyLog;
  let bitsNeeded = accuracyLog + 1;
  const counts = [];
  let symbol = 0;
  let previousZero = false;
  while (remaining > 1 && symbol <= maxSymbol) {
    if (previousZero) {
      let repeat = symbol;
      while (peek(16) === 0xffff) {
        repeat += 24;
        bit += 16;
      }
      while (peek(2) === 3) {
        repeat += 3;
        bit += 2;
      }
      repeat += peek(2);
      bit += 2;
      if (repeat > maxSymbol + 1) throw new Error('zstd: FSE zero run beyond the alphabet');
      while (symbol < repeat) counts[symbol++] = 0;
      if (symbol > maxSymbol) break;
    }
    const max = 2 * threshold - 1 - remaining;
    let count;
    const low = peek(bitsNeeded - 1);
    if (low < max) {
      count = low;
      bit += bitsNeeded - 1;
    } else {
      count = peek(bitsNeeded);
      if (count >= threshold) count -= max;
      bit += bitsNeeded;
    }
    count -= 1;
    remaining -= count < 0 ? -count : count;
    counts[symbol++] = count;
    previousZero = count === 0;
    while (remaining < threshold) {
      bitsNeeded -= 1;
      threshold >>= 1;
    }
  }
  if (remaining !== 1) throw new Error('zstd: corrupt FSE distribution');
  const stop = Math.ceil(bit / 8);
  if (stop > end) throw new Error('zstd: truncated FSE distribution');
  return { accuracyLog, counts, end: stop };
}

function buildDecodingTable(counts, accuracyLog) {
  const size = 1 << accuracyLog;
  const symbol = new Uint8Array(size);
  const bits = new Uint8Array(size);
  const base = new Uint16Array(size);
  const next = new Uint16Array(counts.length);
  let high = size - 1;
  counts.forEach((count, value) => {
    if (count === -1) {
      symbol[high--] = value;
      next[value] = 1;
    } else {
      next[value] = Math.max(0, count);
    }
  });
  const step = (size >> 1) + (size >> 3) + 3;
  const mask = size - 1;
  let position = 0;
  counts.forEach((count, value) => {
    for (let index = 0; index < count; index += 1) {
      symbol[position] = value;
      do position = (position + step) & mask;
      while (position > high);
    }
  });
  if (position !== 0) throw new Error('zstd: FSE table spread failed');
  for (let state = 0; state < size; state += 1) {
    const value = symbol[state];
    const nextState = next[value]++;
    const count = accuracyLog - (31 - Math.clz32(nextState));
    bits[state] = count;
    base[state] = (nextState << count) - size;
  }
  return { accuracyLog, symbol, bits, base };
}

/* ---------- Bit readers ---------- */

// Reads a stream backward from its end, as FSE and Huffman streams are written: the last byte's
// highest set bit marks the start. Reads past the beginning return zeros and set overflow.
class BackwardBits {
  constructor(bytes, start, end) {
    if (end <= start) throw new Error('zstd: empty bitstream');
    const last = bytes[end - 1];
    if (!last) throw new Error('zstd: bitstream without an end mark');
    this.bytes = bytes;
    this.start = start * 8;
    this.offset = (end - 1) * 8 + (31 - Math.clz32(last));
  }

  read(count) {
    if (!count) return 0;
    this.offset -= count;
    return this.bitsAt(this.offset, count);
  }

  peek(count) {
    return this.bitsAt(this.offset - count, count);
  }

  skip(count) {
    this.offset -= count;
  }

  remaining() {
    return this.offset - this.start;
  }

  overflowed() {
    return this.offset < this.start;
  }

  bitsAt(offset, count) {
    if (offset < this.start) {
      const available = offset + count - this.start;
      if (available <= 0) return 0;
      return this.bitsAt(this.start, available) * 2 ** (count - available);
    }
    return forwardBits(this.bytes, offset, count);
  }
}

// `count` bits (up to 32) starting at bit `offset`, least significant first.
function forwardBits(bytes, offset, count) {
  if (count > 24) return forwardBits(bytes, offset, 16) + forwardBits(bytes, offset + 16, count - 16) * 65536;
  const index = offset >>> 3;
  const word = bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16) | (bytes[index + 3] << 24);
  return (word >>> (offset & 7)) & ((1 << count) - 1);
}

function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
