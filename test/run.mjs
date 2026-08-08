/**
 * Node test runner: `node test/run.mjs`.
 *
 * The suite itself lives in `cases.js` and is shared with `iso.test.html`,
 * so the browser and the terminal always check the same things.
 */

import { readFileSync } from 'node:fs';
import { runCases } from './cases.js';
import { COMPONENTS, GROUP_KINDS } from '../src/data/components.js';
import { normalizeDoc, serializeDoc, DEFAULT_PLANE } from '../src/core/schema.js';
import { THREE_TIER } from '../src/data/samples.js';
import {
  encodeShareText,
  decodeShareText,
  shareUrlFrom,
  sharePayloadFrom,
} from '../src/core/share.js';

import { build, vercelFeaturesWanted } from '../build.js';
import { readConsent, writeConsent, analyticsSources } from '../src/ui/consent.js';

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) passed++;
  else failures.push(detail ? `${name} — ${detail}` : name);
}

runCases(check);

// Needs the filesystem, so it lives here rather than in the shared suite.
// `node build.js` regenerates these enums; this catches a stale commit.
const schema = JSON.parse(readFileSync(new URL('../schema/arch-v1.schema.json', import.meta.url)));
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
check(
  'the JSON Schema type enum matches the component registry',
  sameList(schema.$defs.node.properties.type.enum, COMPONENTS.map((c) => c.type)),
  'run `node build.js` to regenerate it'
);
check(
  'the JSON Schema zone enum matches the registry',
  sameList(schema.$defs.group.properties.kind.enum, GROUP_KINDS.map((k) => k.kind)),
  'run `node build.js` to regenerate it'
);
check(
  'the JSON Schema plane default matches the loader',
  schema.$defs.placement.properties.plane.default === DEFAULT_PLANE,
  `schema says ${schema.$defs.placement.properties.plane.default}, loader uses ${DEFAULT_PLANE}`
);

/*
 * A CSS declaration outranks an SVG presentation attribute, so a `font-size`
 * on either caption class silently pins every label to a fixed size however
 * the document is edited -- and reading the attribute back does not reveal it,
 * because the attribute is set correctly and simply loses.
 */
const canvasCss = readFileSync(new URL('../styles/canvas.css', import.meta.url), 'utf8');

/**
 * Declarations of the first rule whose selector is exactly `selector`.
 * Comments are stripped, or the note explaining why there is no `font-size`
 * here would itself trip the check.
 */
function ruleBody(css, selector) {
  const head = `\n${selector} {`;
  const start = css.indexOf(head);
  if (start < 0) return null; // the class vanished: worth failing on too
  const open = start + head.length;
  const close = css.indexOf('}', open);
  if (close < 0) return null;
  return css.slice(open, close).replace(/\/\*[\s\S]*?\*\//g, '');
}

for (const cls of ['.block-label', '.zone-label', '.text-body']) {
  const rule = ruleBody(canvasCss, cls);
  check(
    `${cls} leaves font-size to the document`,
    rule !== null && !rule.includes('font-size'),
    rule === null
      ? `no ${cls} rule found in canvas.css`
      : 'a stylesheet font-size overrides the attribute the renderer writes'
  );
}

/*
 * Share links. Asynchronous, because the compression runs through a stream, so
 * these live here rather than in the suite `runCases` drives synchronously.
 *
 * The round trip is the whole contract: whatever a link carries has to come
 * back byte-identical, or a shared diagram silently differs from the one that
 * was shared.
 */
const shared = serializeDoc(normalizeDoc(THREE_TIER).doc);
const payload = await encodeShareText(shared);

check('a share payload decodes back to the same document', (await decodeShareText(payload)) === shared);
check(
  'a share payload is URL-safe',
  /^[A-Za-z0-9\-_]+$/.test(payload),
  `payload contained characters that need escaping: ${payload.slice(0, 40)}…`
);
check(
  'compression earns its place',
  payload.length < shared.length * 0.5,
  `${shared.length} chars of JSON became ${payload.length} of payload`
);
check(
  'an uncompressed payload still opens',
  // What a browser without CompressionStream would have written. Both forms
  // have to keep working, or links stop being portable between browsers.
  (await decodeShareText(Buffer.from(shared, 'utf8').toString('base64url'))) === shared
);
check('a fragment round-trips through the URL', sharePayloadFrom(
  new URL(shareUrlFrom(payload, 'https://example.com/app')).hash
) === payload);
check('a hash with no diagram in it reads as none', sharePayloadFrom('#somethingelse') === null);

let rejected = false;
try {
  await decodeShareText('H4sIAAAAAAAA_wrJyCxWAAAAAP__');
} catch {
  rejected = true;
}
check('a truncated payload fails loudly rather than opening as junk', rejected);

/*
 * Analytics is the one thing in the project that reaches a third party, and it
 * is a *build* switch rather than a runtime one precisely so that a clone, a
 * local build or an emailed bundle cannot be carrying it. That only holds if
 * "off" is the default and stays the default, so both halves are pinned here.
 *
 * `build()` is called directly rather than through a subprocess: it only reads
 * files, so the check costs nothing and writes nothing.
 */
const plain = build();
check(
  'a plain build reaches nothing but the font CDN',
  !plain.includes('_vercel') && !plain.includes('window.va'),
  'analytics ended up in a build that never asked for it'
);

const measured = build({ vercel: true });
const TAG = '<meta name="massing-analytics" content="/_vercel/insights/script.js /_vercel/speed-insights/script.js">'
  + '\n<meta name="massing-vercel" content="1">';
check(
  'a hosted build names both scripts in the head',
  measured.includes(TAG) && measured.indexOf(TAG) < measured.indexOf('</head>'),
  'the tag did not make it into the head, or does not name both'
);
check(
  'the scripts are named but never fetched by the page itself',
  // A <script src> here would load before anyone could be asked, which would
  // make the consent banner decorative. ui/consent.js adds the elements, and
  // only once somebody has said yes.
  !measured.includes('<script defer src="/_vercel'),
  'the build fetches them without waiting for consent'
);
check(
  'the hosted marker is the only difference between the two builds',
  (() => {
    // Cut out exactly what was added and the two builds must be the same file.
    // Anything else the switch touched shows up here.
    const from = measured.indexOf(TAG);
    if (from < 0) return false;
    // The tag arrives on a line of its own, so its newline goes with it.
    return measured.slice(0, from - 1) + measured.slice(from + TAG.length) === plain;
  })(),
  'the hosted switch changed something else as well'
);

/*
 * The switch has to be deaf to everything except a deliberate yes. An empty
 * variable, or one someone set to `0` to turn it *off*, must not ship the
 * script -- the failure that matters is shipping it by accident.
 */
for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
  check(`MASSING_VERCEL_FEATURES=${JSON.stringify(value)} enables it`,
    vercelFeaturesWanted({ MASSING_VERCEL_FEATURES: value }));
}
for (const value of ['', '0', 'false', 'no', 'off', 'maybe', undefined]) {
  check(`MASSING_VERCEL_FEATURES=${JSON.stringify(value)} leaves it off`,
    !vercelFeaturesWanted({ MASSING_VERCEL_FEATURES: value }));
}
check('no variable at all leaves it off', !vercelFeaturesWanted({}));
check('the --vercel flag is the same switch', vercelFeaturesWanted({}, ['--vercel']));
check('the old variable no longer turns anything on',
  !vercelFeaturesWanted({ MASSING_ANALYTICS: '1' }),
  'MASSING_ANALYTICS was renamed and must not keep working silently');

/*
 * Consent. The banner is only worth anything if the answer sticks, so the
 * store is exercised directly against a stand-in for localStorage -- including
 * the case where storage throws, which is a real configuration and must not
 * take the page down with it.
 */
const fakeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
};
const brokenStorage = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

check('nobody asked yet reads as no answer', readConsent(fakeStorage()) === null);
for (const answer of ['granted', 'denied']) {
  const store = fakeStorage();
  writeConsent(store, answer);
  check(`"${answer}" is remembered`, readConsent(store) === answer);
}
check(
  'a value nobody wrote is not treated as an answer',
  readConsent(fakeStorage({ 'massing:analytics-consent': 'maybe' })) === null,
  'a junk value would let a stale or tampered entry stand in for consent'
);
check('storage that throws reads as no answer', readConsent(brokenStorage) === null);
check('storage that throws does not throw on write', writeConsent(brokenStorage, 'granted') === false);

/*
 * The meta tag is what tells the app there is anything to ask about, so a build
 * without analytics has to be silent: no banner, nothing to consent to.
 */
const fakeDoc = (content) => ({
  querySelector: () => (content === null ? null : { getAttribute: () => content }),
});
check('a plain build offers nothing to consent to',
  analyticsSources(fakeDoc(null)).length === 0);
check('a tag with nothing in it is the same as no tag',
  analyticsSources(fakeDoc('   ')).length === 0,
  'an empty list would be read as a script to load');
check('both scripts are read out of the one tag', (() => {
  const found = analyticsSources(fakeDoc('/_vercel/insights/script.js /_vercel/speed-insights/script.js'));
  return found.length === 2 &&
    found[0] === '/_vercel/insights/script.js' &&
    found[1] === '/_vercel/speed-insights/script.js';
})(), 'the pair is one decision, so they travel in one tag');
check('the list survives odd spacing',
  analyticsSources(fakeDoc(['  a.js', '  b.js  '].join('\n'))).join() === 'a.js,b.js');


/*
 * The hosted endpoints.
 *
 * Only the parts that decide things are exercised here -- what a key is, what a
 * name may be, what the flags resolve to, when a caller has had enough. The
 * network calls around them are thin by design and cannot be reached from a
 * test without a deployment; keeping the judgement out of them is what makes
 * that acceptable.
 */
const {
  normaliseDisplayId, classifyKey, hashDocument, createRateLimiter,
  newEditToken, hashToken, tokenMatches, MAX_DOCUMENT_BYTES,
  retentionDays, isExpired, shouldRefresh, expiryOf, cacheSeconds,
  RETENTION_DEFAULT_DAYS, REFRESH_AFTER_DAYS,
} = await import('../api/_lib/policy.js');
const { resolveFlag, resolveAll } = await import('../api/_lib/flags.js');

for (const good of ['payments', 'my-diagram-2', 'a-b', 'x9z']) {
  check(`"${good}" is an acceptable display id`, normaliseDisplayId(good).id === good);
}
for (const bad of ['', 'ab', '-lead', 'trail-', 'Has Space', 'api', 'UPPER-ok?', 'a'.repeat(65)]) {
  check(`"${bad}" is refused as a display id`, Boolean(normaliseDisplayId(bad).error));
}
check('a display id is lower-cased rather than refused for case alone',
  normaliseDisplayId('  Payments-API  ').id === 'payments-api');
check('a name that looks like a hash is refused',
  Boolean(normaliseDisplayId('deadbeefcafe').error),
  'it would be indistinguishable from a lookup by hash');

const { full, short } = hashDocument('{"nodes":[]}');
check('a full hash is 64 hex characters', /^[0-9a-f]{64}$/.test(full));
check('the short hash is the front of the full one', full.startsWith(short) && short.length === 10);
check('the same bytes hash the same way', hashDocument('{"nodes":[]}').full === full);
check('a key is classified by its shape', (() => {
  return classifyKey(full).kind === 'hash' &&
    classifyKey(short).kind === 'short' &&
    classifyKey('payments').kind === 'display' &&
    Boolean(classifyKey('no spaces here').error);
})());

check('an edit token matches only itself', (() => {
  const token = newEditToken();
  const stored = hashToken(token);
  return tokenMatches(token, stored) &&
    !tokenMatches(newEditToken(), stored) &&
    !tokenMatches('', stored) &&
    !tokenMatches(token, null) &&
    // Length differs, which is the case a naive compare throws on.
    !tokenMatches(token, 'abcd');
})());
check('the stored form is not the token itself', (() => {
  const token = newEditToken();
  return hashToken(token) !== token;
})());

check('a rate limiter refuses past its ceiling and forgets afterwards', (() => {
  const limiter = createRateLimiter([[1000, 2]]);
  const t = 10_000;
  if (!limiter.check('a', t).ok) return false;
  if (!limiter.check('a', t + 10).ok) return false;
  const third = limiter.check('a', t + 20);
  if (third.ok || third.retryAfter < 1) return false;
  // A different caller is unaffected, and the window slides.
  return limiter.check('b', t + 20).ok && limiter.check('a', t + 1100).ok;
})());

check('a flag needs its credentials before anything else', (() => {
  const flag = { key: 'x', env: 'F', edge: 'f', available: (env) => Boolean(env.KEY) };
  // Asked for in every way, and still off, because it cannot work.
  return !resolveFlag(flag, { env: { F: '1' } }).on &&
    !resolveFlag(flag, { env: {}, edge: { f: 'true' } }).on &&
    resolveFlag(flag, { env: { KEY: 'k' } }).on;
})());
check('Edge Config outranks the environment', (() => {
  const flag = { key: 'x', env: 'F', edge: 'f', available: () => true };
  return !resolveFlag(flag, { env: { F: '1' }, edge: { f: '0' } }).on &&
    resolveFlag(flag, { env: { F: '0' }, edge: { f: '1' } }).on &&
    // An absent or blank Edge Config value defers rather than deciding.
    !resolveFlag(flag, { env: { F: '0' }, edge: { f: '' } }).on;
})());
check('every flag is off on a deployment with nothing configured', (() => {
  const all = resolveAll({ env: {} });
  return all.storage.on === false && all.assistant.on === false &&
    // Analytics is served by the deployment itself, so it needs no key.
    all.analytics.on === true;
})());
check('the document ceiling is stated in bytes, not vibes', MAX_DOCUMENT_BYTES === 2 * 1024 * 1024);

/*
 * The model id survives every spelling it gets configured in. This project
 * itself told people to set the vendor-prefixed form while it went through a
 * gateway, and an environment variable that was right last week must not be a
 * 404 today -- which is exactly what it was.
 */
const { modelId } = await import('../api/chat.js');
for (const [given, want] of [
  ['gemini-2.5-flash-lite', 'gemini-2.5-flash-lite'],
  ['google/gemini-2.5-flash-lite', 'gemini-2.5-flash-lite'],
  ['models/gemini-2.5-flash-lite', 'gemini-2.5-flash-lite'],
  ['  gemini-2.5-pro  ', 'gemini-2.5-pro'],
  ['', 'gemini-2.5-flash-lite'],
  [undefined, 'gemini-2.5-flash-lite'],
]) {
  check(`model ${JSON.stringify(given)} resolves to ${want}`, modelId(given) === want, modelId(given));
}

/*
 * Retention is sliding: the clock runs from the last time a link was opened,
 * not from when it was published, so the links that die are the ones nobody is
 * using. Everything below is that rule and the arithmetic under it.
 */
const DAY = 86_400_000;
const now = 1_700_000_000_000;
const ago = (days) => new Date(now - days * DAY).toISOString();

check('retention defaults to ninety days', retentionDays({}) === RETENTION_DEFAULT_DAYS);
check('retention is configurable, and zero switches it off', (() => {
  return retentionDays({ MASSING_RETENTION_DAYS: '30' }) === 30 &&
    retentionDays({ MASSING_RETENTION_DAYS: '0' }) === 0 &&
    // Nonsense falls back rather than switching retention off by accident.
    retentionDays({ MASSING_RETENTION_DAYS: 'soon' }) === RETENTION_DEFAULT_DAYS &&
    retentionDays({ MASSING_RETENTION_DAYS: '' }) === RETENTION_DEFAULT_DAYS;
})());

check('a link expires only once it has gone unused past the window', (() => {
  return !isExpired(ago(89), 90, now) && isExpired(ago(91), 90, now);
})());
check('switching retention off expires nothing', !isExpired(ago(400), 0, now));
check('an unreadable timestamp is treated as fresh, never as expired',
  !isExpired(undefined, 90, now) && !isExpired('not a date', 90, now),
  'a bad record must not read as a dead link');

check('a read refreshes a stale clock and leaves a fresh one alone', (() => {
  return !shouldRefresh(ago(1), 90, now) &&
    !shouldRefresh(ago(REFRESH_AFTER_DAYS - 1), 90, now) &&
    shouldRefresh(ago(REFRESH_AFTER_DAYS + 1), 90, now) &&
    // No timestamp at all is worth writing one.
    shouldRefresh(undefined, 90, now) &&
    !shouldRefresh(ago(400), 0, now);
})());

check('the expiry date is the window past the last use', (() => {
  const at = ago(10);
  return expiryOf(at, 90) === new Date(Date.parse(at) + 90 * DAY).toISOString() &&
    expiryOf(at, 0) === null;
})());

check('nothing may be cached past the moment it stops resolving', (() => {
  // The old header promised a year on a hash. The bytes still cannot change;
  // the link can now be gone, so the promise has to shrink with it.
  const nearlyDead = cacheSeconds(ago(89.5), 90, 31536000, now);
  return nearlyDead <= 0.5 * 86400 && nearlyDead > 0 &&
    cacheSeconds(ago(1), 90, 60, now) === 60 &&
    cacheSeconds(ago(91), 90, 31536000, now) === 0 &&
    cacheSeconds(ago(400), 0, 31536000, now) === 31536000;
})());


for (const failure of failures) console.error(`FAIL  ${failure}`);
console.log(`${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);