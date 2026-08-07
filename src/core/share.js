/**
 * Putting a whole diagram inside a URL.
 *
 * The payload lives in the fragment (`#d=...`) rather than a query string, and
 * that is the point rather than a detail: a fragment is never sent to the
 * server. A link can be pasted into a chat and the diagram reaches the other
 * person's browser without passing through any host we run, which is the same
 * promise the rest of the editor makes, extended to sharing.
 *
 * The bytes are gzipped before encoding. Diagram JSON is extremely repetitive
 * -- the same dozen key names once per node -- so it compresses to a small
 * fraction of its length, and `CompressionStream` is built into the browser, so
 * this costs no dependency.
 *
 * The encoding is self-describing. Gzip's two magic bytes are checked on the
 * way back in, so a link written by a browser too old to compress still opens
 * in one that can, and a compressed link is not mistaken for text.
 */

export const SHARE_FRAGMENT_KEY = 'd';

/**
 * Past roughly this many characters a link stops being shareable in practice.
 * Browsers cope with far more, but chat clients, issue trackers and mail agents
 * truncate or line-wrap long URLs. Embedded pictures are what normally push a
 * document over it, since those are data URLs that gzip cannot help much.
 */
export const SHARE_WARN_LENGTH = 8000;

const GZIP_MAGIC = [0x1f, 0x8b];

/** Base64url: the plain alphabet's `+` and `/` do not survive being pasted. */
function base64UrlFromBytes(bytes) {
  let binary = '';
  // `apply`/spread has an argument-count ceiling, so feed it in slices.
  const CHUNK = 0x8000;
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromBase64Url(text) {
  const plain = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(plain + '='.repeat((4 - (plain.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

async function pipeThroughStream(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Serialised document -> the opaque string that goes after `#d=`. */
export async function encodeShareText(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream !== 'function') return base64UrlFromBytes(bytes);
  return base64UrlFromBytes(await pipeThroughStream(bytes, new CompressionStream('gzip')));
}

/** The inverse. Throws on anything that is not a payload we wrote. */
export async function decodeShareText(payload) {
  const bytes = bytesFromBase64Url(payload);
  const gzipped = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
  if (!gzipped) return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot read compressed links (no DecompressionStream).');
  }
  return new TextDecoder().decode(
    await pipeThroughStream(bytes, new DecompressionStream('gzip'))
  );
}

export function shareUrlFrom(payload, base = window.location.href) {
  const url = new URL(base);
  url.hash = `${SHARE_FRAGMENT_KEY}=${payload}`;
  return url.toString();
}

/** The payload in a location hash, or null when there is not one. */
export function sharePayloadFrom(hash = window.location.hash) {
  const found = new RegExp(`(?:^#|[#&])${SHARE_FRAGMENT_KEY}=([A-Za-z0-9\\-_]+)`).exec(hash);
  return found?.[1] ?? null;
}
