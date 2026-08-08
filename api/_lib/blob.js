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
 * A refusal from the store, with what it actually said still attached.
 *
 * The handlers used to answer "the storage backend refused it" and log the rest,
 * which is unhelpful in exactly the situation it exists for: a deployment that
 * has just been configured and is failing for a reason nobody can see. The
 * upstream status and message are the whole diagnosis -- a wrong API version, a
 * token for a store that was deleted, a quota -- and none of them is a secret.
 * The token is never in here; the message is.
 */
export class BlobError extends Error {
  constructor(operation, status, detail) {
    super(`Blob ${operation} failed (${status})${detail ? `: ${detail}` : ''}`);
    this.name = 'BlobError';
    this.operation = operation;
    this.status = status;
    this.detail = detail;
  }
}

/** Whatever the store put in the body, in as few words as it offered them. */
async function refusal(operation, response) {
  const text = await response.text().catch(() => '');
  let detail = text.slice(0, 400);
  try {
    const parsed = JSON.parse(text);
    detail = parsed?.error?.message ?? parsed?.message ?? detail;
  } catch {
    /* not JSON; the text stands */
  }
  return new BlobError(operation, response.status, detail);
}

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
  /**
   * `maxAge` is a day rather than a year, and that is about deletion rather
   * than about freshness. Stored diagrams are swept once their links go unused,
   * and an edge holding a year-old copy would keep serving what the sweeper has
   * already removed. A day bounds how long the store and the edge can disagree.
   */
  async function put(pathname, body, { contentType = 'application/json', maxAge = 86400 } = {}) {
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
    if (!response.ok) throw await refusal('write', response);
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
    if (!response.ok) throw await refusal('read', response);
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

  /**
   * One page of the store under `prefix`.
   *
   * Paged rather than exhaustive because the sweeper is the only caller and it
   * runs against a store of unknown size on a function with a deadline. It
   * takes what it can and comes back tomorrow for the rest.
   *
   * @returns {Promise<{blobs: Array<{pathname: string, url: string, uploadedAt: string}>, cursor: string|null}>}
   */
  async function list(prefix, { cursor = null, limit = 500 } = {}) {
    const url = new URL(API);
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('limit', String(limit));
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetchImpl(url, { headers: auth(), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw await refusal('list', response);
    const body = await response.json();
    if (body.blobs?.[0]?.url) remember(body.blobs[0].url);
    return { blobs: body.blobs ?? [], cursor: body.hasMore ? body.cursor : null };
  }

  /** Remove objects by public URL. Batched, because the sweeper deletes in runs. */
  async function remove(urls) {
    if (!urls.length) return 0;
    const response = await fetchImpl(`${API}/delete`, {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ urls }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await refusal('delete', response);
    return urls.length;
  }

  return {
    put,
    get,
    getJson,
    locate,
    list,
    remove,
    get configured() { return Boolean(token); },
  };
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
