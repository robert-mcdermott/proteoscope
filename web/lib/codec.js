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
