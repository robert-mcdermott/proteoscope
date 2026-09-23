// Minimal ZIP writer for MolViewSpec .mvsx archives. Entries are stored or deflated, and sizes
// are written into the local headers (no data descriptors, no ZIP64), which Mol*'s reader needs.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// files: [{ name, data: Uint8Array | string }]. Returns the archive as a Uint8Array.
export async function createZip(files, options = {}) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(options.date ?? new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = crc32(raw);
    let method = 0;
    let body = raw;
    if (options.compress !== false && typeof CompressionStream !== 'undefined' && raw.length > 256) {
      const deflated = await deflateRaw(raw);
      if (deflated.length < raw.length) {
        method = 8;
        body = deflated;
      }
    }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, body);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, method, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const archive = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  return archive;
}

// Reads a ZIP written by createZip (used by tests and to check exports).
export async function readZip(archive) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= archive.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compressed = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(archive.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    let data = archive.subarray(start, start + compressed);
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    files.set(name, data);
    offset = start + compressed;
  }
  return files;
}
