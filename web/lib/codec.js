// Compression and base64 helpers for session files and links (CompressionStream is available in
// current browsers and in Node 18+).

export async function compressText(text, format = 'gzip') {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decompressText(bytes, format = 'gzip') {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Response(stream).text();
}

// compressText also accepts bytes; this is its binary counterpart.
export async function decompressBytes(bytes, format = 'gzip') {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// PAE and similar matrices travel in sessions as bytes: value × scale, clamped to 0–255.
export function quantizeMatrix(matrix, scale = 8) {
  const bytes = new Uint8Array(matrix.length);
  for (let index = 0; index < matrix.length; index += 1) bytes[index] = Math.min(255, Math.max(0, Math.round(matrix[index] * scale)));
  return bytes;
}

export function dequantizeMatrix(bytes, scale = 8) {
  const matrix = new Float32Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) matrix[index] = bytes[index] / scale;
  return matrix;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// URL-safe base64 without padding, for #session= links.
export function toBase64Url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return base64 + '='.repeat((4 - (base64.length % 4)) % 4);
}

export async function encodeLinkPayload(text) {
  return toBase64Url(bytesToBase64(await compressText(text, 'deflate-raw')));
}

export async function decodeLinkPayload(payload) {
  return decompressText(base64ToBytes(fromBase64Url(payload)), 'deflate-raw');
}
