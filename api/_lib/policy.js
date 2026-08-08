/**
 * What the hosted endpoints will and will not accept.
 *
 * A public deployment with a write endpoint on it is a public deployment
 * someone will eventually write to in bulk, and the bill for that arrives
 * whether or not anyone was malicious. So the limits live here, in one file,
 * as plain numbers with reasons attached — rather than scattered through the
 * handlers where they turn into folklore.
 *
 * Everything in this module is pure. That is deliberate: it is the part worth
 * testing, and the part that must behave the same whether it runs in a
 * function, in a test, or in someone's head while they read it.
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/**
 * The largest document that may be stored, in bytes of JSON.
 *
 * Two megabytes is far more than a diagram needs — the starter is under 6 kB,
 * and a heavily annotated one with a dozen embedded logos lands around 300 kB.
 * What eats the difference is pasted screenshots, which arrive as data URLs and
 * can be megabytes each. Refusing those is the intent rather than a side
 * effect: a picture that large belongs in the file on someone's disk, not in a
 * shared link, and the message says so.
 */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

/** The largest chat request body. Prompts are text; this is already generous. */
export const MAX_CHAT_BYTES = 256 * 1024;

/**
 * How much conversation is sent upstream.
 *
 * Older turns are dropped rather than summarised. A diagram conversation is
 * about the document, and the document is sent in full on every turn, so the
 * thing that actually carries the state is never the thing being trimmed.
 */
export const MAX_CHAT_MESSAGES = 40;

/**
 * Ceiling on one model reply, and on how long the whole call may take.
 *
 * 4096 was set when the assistant drew small diagrams and every model was a
 * lite one. It is now the thing that stops the largest model finishing: a
 * seventeen-block document is several thousand tokens of JSON on its own, and
 * the current generation spends thinking tokens against this same budget
 * before writing any of it — so the strong tier hit `MAX_TOKENS` mid-document
 * and the turn came back as "the answer was longer than the reply limit".
 *
 * A ceiling is not a cost. It is what a reply may not exceed, and replies are
 * billed for what they actually use; raising it changes nothing for the small
 * ones and lets the large one land. The real guard against a runaway is the
 * eight-step cap on the loop, which is unchanged.
 */
export const MAX_OUTPUT_TOKENS = 16_384;
export const CHAT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * How long a published link lives without being opened.
 *
 * Sliding rather than fixed: the clock runs from the last time the link was
 * *used*, not from when it was published. A diagram linked in a document
 * people still read never expires; one nobody has opened in three months does.
 * Expiring by publication date instead would kill exactly the links that are
 * working, which is the wrong half.
 *
 * Zero turns the whole thing off and nothing is ever swept.
 */
export const RETENTION_DEFAULT_DAYS = 90;

/**
 * How stale a record has to be before a read bothers to refresh it.
 *
 * Refreshing on every read would put a write behind every GET. A week's
 * resolution is far finer than ninety days needs, and it means a link opened
 * fifty times in an afternoon is written once.
 */
export const REFRESH_AFTER_DAYS = 7;

/**
 * Grace before a document with nothing pointing at it may be swept.
 *
 * A publish writes the document first and its records after, so a sweep that
 * listed the documents and the records either side of that gap would find a
 * brand-new document with no references and delete it. An hour is far longer
 * than that window and far shorter than anything else here.
 */
export const SWEEP_GRACE_MS = 60 * 60 * 1000;

const DAY_MS = 86_400_000;

/** @returns {number} days, or 0 when retention is switched off. */
export function retentionDays(env = process.env) {
  const raw = env.MASSING_RETENTION_DAYS;
  if (raw === undefined || String(raw).trim() === '') return RETENTION_DEFAULT_DAYS;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0) return RETENTION_DEFAULT_DAYS;
  return Math.floor(days);
}

/** Milliseconds since `at`, or null when it is missing or unreadable. */
export function ageOf(at, now = Date.now()) {
  const when = Date.parse(at ?? '');
  return Number.isFinite(when) ? now - when : null;
}

/**
 * Whether a link record has gone unused for longer than it is kept.
 *
 * A record with no readable timestamp counts as fresh, not expired. It is
 * either older than this feature or written by something that went wrong, and
 * neither is a reason to tell someone their link is dead.
 */
export function isExpired(at, days, now = Date.now()) {
  if (!days) return false;
  const age = ageOf(at, now);
  return age !== null && age > days * DAY_MS;
}

export function shouldRefresh(at, days, now = Date.now()) {
  if (!days) return false;
  const age = ageOf(at, now);
  return age === null || age > REFRESH_AFTER_DAYS * DAY_MS;
}

/** When a link last touched at `at` would expire, or null if never. */
export function expiryOf(at, days) {
  if (!days) return null;
  const when = Date.parse(at ?? '');
  if (!Number.isFinite(when)) return null;
  return new Date(when + days * DAY_MS).toISOString();
}

/**
 * Seconds a reply may be cached, never past the moment it stops being true.
 *
 * The document route used to send a year of `s-maxage` because a hash addresses
 * bytes that cannot change. That is still true of the bytes and no longer true
 * of the *link*, and an edge holding a year-old copy of something deleted three
 * months ago would be serving a link this deployment has already retired.
 */
export function cacheSeconds(at, days, ceiling, now = Date.now()) {
  if (!days) return ceiling;
  const age = ageOf(at, now);
  if (age === null) return ceiling;
  const left = Math.floor((days * DAY_MS - age) / 1000);
  return Math.max(0, Math.min(ceiling, left));
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/**
 * Per-address ceilings, as [window in ms, permitted requests].
 *
 * Best-effort by construction: the counters live in one function instance's
 * memory, and a busy deployment has several. That makes this a brake on the
 * obvious accident — a script in a loop, a stuck retry — and not a defence
 * against someone deliberate, who is what Vercel's own rate limiting on the
 * dashboard is for. Both are listed in the setup notes; neither replaces the
 * other.
 */
export const RATE_LIMITS = {
  store: [[60_000, 10], [3_600_000, 60], [86_400_000, 300]],
  chat: [[60_000, 20], [3_600_000, 200], [86_400_000, 600]],
};

/**
 * A counter that forgets.
 *
 * Keyed by address and bucket, holding only the timestamps still inside the
 * longest window, so memory is bounded by the limit itself rather than by how
 * many requests arrive.
 */
export function createRateLimiter(limits) {
  const seen = new Map();
  const longest = Math.max(...limits.map(([window]) => window));

  return {
    /** @returns {{ok: true} | {ok: false, retryAfter: number}} */
    check(key, now = Date.now()) {
      const times = (seen.get(key) ?? []).filter((at) => now - at < longest);
      for (const [window, allowed] of limits) {
        const inWindow = times.filter((at) => now - at < window);
        if (inWindow.length >= allowed) {
          const oldest = Math.min(...inWindow);
          return { ok: false, retryAfter: Math.ceil((window - (now - oldest)) / 1000) };
        }
      }
      times.push(now);
      seen.set(key, times);
      // A map that only ever grows is a leak with a long fuse. Anything whose
      // newest entry has aged out cannot affect a decision again.
      if (seen.size > 5000) {
        for (const [at, stamps] of seen) {
          if (!stamps.some((t) => now - t < longest)) seen.delete(at);
        }
      }
      return { ok: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * Names a stored diagram cannot take.
 *
 * Some because they collide with routes, the rest because they are the ones
 * someone squatting would take first.
 */
const RESERVED = new Set([
  'api', 'new', 'edit', 'admin', 'assets', 'static', 'index', 'null', 'undefined',
  'favicon', 'robots', 'sitemap', 'well-known', 'vercel', 'massing', 'help', 'about',
]);

export const DISPLAY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/;

/**
 * Normalise and check a display id.
 *
 * Lower case only, because a URL someone reads aloud has no case, and two
 * diagrams differing only in it would be a trap rather than a feature. Leading
 * and trailing dashes are out for the same reason a filename ending in a space
 * is out: it is invisible and it will be typed wrong.
 *
 * @returns {{id: string} | {error: string}}
 */
export function normaliseDisplayId(raw) {
  const id = String(raw ?? '').trim().toLowerCase();
  if (!id) return { error: 'A display id cannot be empty.' };
  if (id.length < 3 || id.length > 64) {
    return { error: 'A display id is between 3 and 64 characters.' };
  }
  if (!DISPLAY_ID_PATTERN.test(id)) {
    return {
      error:
        'A display id uses lower-case letters, digits and dashes, and starts and ends with a letter or digit.',
    };
  }
  if (RESERVED.has(id)) return { error: `"${id}" is reserved.` };
  // A 64-character hex string is what a content hash looks like, and letting
  // one be claimed as a name would make a lookup ambiguous with itself.
  if (/^[0-9a-f]{8,}$/.test(id)) {
    return { error: 'A display id cannot be a plain run of hex digits; that is what a hash looks like.' };
  }
  return { id };
}

/** A random display id, for when the author did not care to pick one. */
export function randomDisplayId() {
  return randomUUID();
}

/** Content hash. The full form addresses the blob; the short form shares well. */
export function hashDocument(text) {
  const full = createHash('sha256').update(text, 'utf8').digest('hex');
  return { full, short: full.slice(0, 10) };
}

export const SHORT_HASH_LENGTH = 10;

/**
 * What a lookup key is: a full hash, a short hash, or a display id.
 *
 * Told apart by shape rather than by asking, because a URL carries no label.
 * Hex of exactly the right lengths is a hash — which is why `normaliseDisplayId`
 * refuses to mint names that look like one.
 *
 * @returns {{kind: 'hash'|'short'|'display', key: string} | {error: string}}
 */
export function classifyKey(raw) {
  const key = String(raw ?? '').trim().toLowerCase();
  if (!key) return { error: 'No key given.' };
  if (/^[0-9a-f]{64}$/.test(key)) return { kind: 'hash', key };
  if (new RegExp(`^[0-9a-f]{${SHORT_HASH_LENGTH}}$`).test(key)) return { kind: 'short', key };
  const display = normaliseDisplayId(key);
  return display.error ? { error: display.error } : { kind: 'display', key: display.id };
}

// ---------------------------------------------------------------------------
// Edit tokens
// ---------------------------------------------------------------------------

/**
 * Who may re-point a name.
 *
 * There are no accounts here, so the only thing that can distinguish the author
 * of a display id from the next person to type it is a secret handed out when
 * the name was claimed. The client keeps it; the server keeps only its hash, so
 * a leak of the stored records does not hand anyone the names in them.
 *
 * First claim wins, and a claim without the token is refused rather than
 * silently given a different name — being told "that one is taken" is the
 * answer, and quietly publishing under a name nobody asked for is not.
 */
export function newEditToken() {
  return `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/** Constant-time, so a wrong token cannot be found one character at a time. */
export function tokenMatches(token, expectedHash) {
  if (!token || !expectedHash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(String(expectedHash), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
