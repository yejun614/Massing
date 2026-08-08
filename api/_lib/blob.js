/**
 * Vercel Blob, over its REST API.
 *
 * `@vercel/blob` is a wrapper around a handful of authenticated requests, and
 * this project has no dependencies — so the requests are here instead. Three
 * operations are needed and no more: put an object at an exact path, find the
 * public URL for a path, and read one back.
 *
 * Reading is deliberately unauthenticated. A stored diagram is public the
 * moment its link is shared, so the read path is a plain `fetch` of a public
 * URL and costs the function nothing but the round trip. The token is only ever
 * used to write, and to look up a URL the first time.
 */

const API = 'https://blob.vercel-storage.com';

/**
 * The API version header the service expects.
 *
 * Pinned rather than omitted, because an unversioned call is one that changes
 * behaviour underneath a deployment nobody is watching. Overridable by
 * environment variable so a version bump does not need a code change.
 */
const API_VERSION = (env) => String(env.BLOB_API_VERSION ?? '7');

/**
 * Public URLs are `https://<store>.public.blob.vercel-storage.com/<pathname>`,
 * so one known URL yields the base for every other path in the same store.
 * Learned from the first response and kept for the life of the instance; a cold
 * start without it costs one listing call, or none at all when the base is
 * configured outright.
 */
let learnedBase = null;

function baseFrom(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function remember(url) {
  const base = baseFrom(url);
  if (base) learnedBase = base;
  return url;
}

export function createBlobStore(env = process.env, fetchImpl = fetch) {
  const token = env.BLOB_READ_WRITE_TOKEN;
  const configuredBase = env.BLOB_PUBLIC_BASE_URL?.replace(/\/+$/, '') || null;

  function auth() {
    if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not set on this deployment.');
    return { authorization: `Bearer ${token}`, 'x-api-version': API_VERSION(env) };
  }

  /**
   * Write `body` to exactly `pathname`.
   *
   * `x-add-random-suffix: 0` is what makes the path exact. The default appends
   * randomness so two uploads of the same name cannot collide, which is the
   * right default and precisely wrong here: every path this project writes is
   * either a content hash or a name someone chose, and both have to be findable
   * again by the same string.
   */
  async function put(pathname, body, { contentType = 'application/json', maxAge = 31536000 } = {}) {
    const response = await fetchImpl(`${API}/${encodeURI(pathname)}`, {
      method: 'PUT',
      headers: {
        ...auth(),
        'x-content-type': contentType,
        'x-add-random-suffix': '0',
        'x-cache-control-max-age': String(maxAge),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Blob write failed (${response.status}): ${await response.text().catch(() => '')}`);
    }
    const result = await response.json();
    remember(result.url);
    return result;
  }

  /** The public URL for a path, or null when nothing is stored there. */
  async function locate(pathname) {
    const base = configuredBase ?? learnedBase;
    if (base) return `${base}/${pathname}`;
    const url = new URL(API);
    url.searchParams.set('prefix', pathname);
    url.searchParams.set('limit', '1');
    const response = await fetchImpl(url, { headers: auth(), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const { blobs = [] } = await response.json();
    const exact = blobs.find((b) => b.pathname === pathname);
    return exact ? remember(exact.url) : null;
  }

  /**
   * Read a stored object, or null when there is none.
   *
   * A miss is a normal answer here — every lookup by display id starts by
   * asking whether that name is free — so it is a return value rather than a
   * thrown error, and only a genuine failure throws.
   */
  async function get(pathname) {
    const url = await locate(pathname);
    if (!url) return null;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Blob read failed (${response.status}).`);
    return { text: await response.text(), url };
  }

  async function getJson(pathname) {
    const found = await get(pathname);
    if (!found) return null;
    try {
      return { value: JSON.parse(found.text), url: found.url };
    } catch {
      return null; // stored bytes that are not JSON are indistinguishable from absent
    }
  }

  return { put, get, getJson, locate, get configured() { return Boolean(token); } };
}

/** Where each kind of record lives. One place, so the two handlers agree. */
export const paths = {
  /** The document itself, addressed by the hash of its bytes. */
  document: (hash) => `diagrams/${hash}.arch.json`,
  /** A name pointing at one, with the hash of the token that may re-point it. */
  alias: (id) => `aliases/${id}.json`,
  /** A short hash pointing at its full one, so a lookup is never a scan. */
  shortcut: (short) => `short/${short}.json`,
};
