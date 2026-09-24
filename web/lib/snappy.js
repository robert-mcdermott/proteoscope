// Snappy block decompression (the raw format Parquet uses for SNAPPY pages, as written by pandas
// and pyarrow): a varint length, then literals and back-references.

export function snappyDecompress(input) {
  let position = 0;
  let length = 0;
  let shift = 0;
  for (;;) {
    if (position >= input.length) throw new Error('snappy: truncated length');
    const byte = input[position++];
    length += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (!(byte & 0x80)) break;
    if (shift > 35) throw new Error('snappy: bad length');
  }
  const output = new Uint8Array(length);
  let out = 0;
  while (position < input.length) {
    const tag = input[position++];
    const type = tag & 3;
    if (type === 0) {
      let size = tag >>> 2;
      if (size >= 60) {
        const bytes = size - 59;
        if (position + bytes > input.length) throw new Error('snappy: truncated literal length');
        size = 0;
        for (let index = 0; index < bytes; index += 1) size += input[position + index] * 2 ** (8 * index);
        position += bytes;
      }
      size += 1;
      if (position + size > input.length || out + size > length) throw new Error('snappy: literal overruns the data');
      output.set(input.subarray(position, position + size), out);
      position += size;
      out += size;
      continue;
    }
    let size;
    let offset;
    // The offset of a copy takes 1, 2 or 4 more bytes.
    if (position + [0, 1, 2, 4][type] > input.length) throw new Error('snappy: truncated back-reference');
    if (type === 1) {
      size = 4 + ((tag >>> 2) & 7);
      offset = ((tag >>> 5) << 8) | input[position++];
    } else if (type === 2) {
      size = 1 + (tag >>> 2);
      offset = input[position] | (input[position + 1] << 8);
      position += 2;
    } else {
      size = 1 + (tag >>> 2);
      offset = (input[position] | (input[position + 1] << 8) | (input[position + 2] << 16) | (input[position + 3] << 24)) >>> 0;
      position += 4;
    }
    if (!offset || offset > out || out + size > length) throw new Error('snappy: bad back-reference');
    if (offset >= size) {
      output.copyWithin(out, out - offset, out - offset + size);
      out += size;
    } else {
      for (let index = 0; index < size; index += 1, out += 1) output[out] = output[out - offset];
    }
  }
  if (out !== length) throw new Error('snappy: output shorter than declared');
  return output;
}
