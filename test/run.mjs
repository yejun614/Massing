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

for (const failure of failures) console.error(`FAIL  ${failure}`);
console.log(`${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
