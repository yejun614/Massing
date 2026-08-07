#!/usr/bin/env node
/**
 * Bundle the app into one self-contained `dist/index.html`.
 *
 * Node built-ins only -- no bundler, no npm dependencies. The whole job is:
 * walk the ES module graph from `src/main.js`, strip the import/export
 * statements, concatenate in dependency order, and inline the stylesheets.
 * The result opens from `file://` with zero network requests, which is the
 * point: a diagram editor you can email.
 *
 * This works because the project's own rules make it safe. Every module uses
 * plain named imports and exports, there are no cycles, and no module has
 * side effects at import time beyond defining things. `checkModule` below
 * enforces those assumptions rather than trusting them.
 *
 *   node build.js                    -> dist/index.html
 *   node build.js --doc example.json -> the same, with a diagram baked in
 *   node build.js --font Pretendard.woff2 -> inline the font, no network at all
 *   node build.js --skill            -> regenerate the Claude skill from prompt.js
 *   MASSING_ANALYTICS=1 node build.js -> include Vercel Web Analytics
 *
 * `build()` is exported and the command line only runs when this file is the
 * program, so the tests can assemble a bundle and read it without writing
 * anything to disk.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(ROOT, 'src/main.js');
const OUT = resolve(ROOT, 'dist/index.html');

// ---------------------------------------------------------------------------
// Module graph
// ---------------------------------------------------------------------------

const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
const BARE_IMPORT_RE = /^\s*import\s+['"]([^'"]+)['"];?\s*$/gm;
const EXPORT_KEYWORD_RE = /^(\s*)export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm;
const EXPORT_LIST_RE = /^\s*export\s*\{[^}]*\};?\s*$/gm;

/** Depth-first walk producing modules in dependency order. */
function collect(entry) {
  const ordered = [];
  const state = new Map(); // path -> 'visiting' | 'done'

  function visit(path, importedFrom) {
    if (state.get(path) === 'done') return;
    if (state.get(path) === 'visiting') {
      throw new Error(`Import cycle at ${rel(path)} (from ${rel(importedFrom)})`);
    }
    state.set(path, 'visiting');

    const source = readFileSync(path, 'utf8');
    checkModule(path, source);
    for (const specifier of importsOf(source)) {
      if (!specifier.startsWith('.')) {
        throw new Error(`${rel(path)} imports "${specifier}"; the bundle allows only relative paths`);
      }
      visit(resolve(dirname(path), specifier), path);
    }

    state.set(path, 'done');
    ordered.push({ path, source });
  }

  visit(entry, entry);
  return ordered;
}

function importsOf(source) {
  const found = new Set();
  for (const match of source.matchAll(IMPORT_RE)) found.add(match[1]);
  for (const match of source.matchAll(BARE_IMPORT_RE)) found.add(match[1]);
  return found;
}

/**
 * Concatenation only works if every module's top level can share one scope.
 * These are the two ways that quietly breaks.
 */
function checkModule(path, source) {
  if (/\bimport\s*\(/.test(source)) {
    throw new Error(`${rel(path)} uses a dynamic import(), which the bundle cannot inline`);
  }
  if (/^\s*export\s+default\b/m.test(source)) {
    throw new Error(`${rel(path)} uses "export default"; use a named export instead`);
  }
}

/** Remove module syntax, leaving declarations that are valid in one scope. */
function stripModuleSyntax(source) {
  return source
    .replace(IMPORT_RE, '')
    .replace(BARE_IMPORT_RE, '')
    .replace(EXPORT_LIST_RE, '')
    .replace(EXPORT_KEYWORD_RE, '$1')
    .trimEnd();
}

/** Names declared at a module's top level, to catch collisions after merging. */
function topLevelNames(source) {
  const names = new Set();
  const re = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of source.matchAll(re)) names.add(match[1]);
  return names;
}

function assertNoCollisions(modules) {
  const owner = new Map();
  const clashes = [];
  for (const { path, source } of modules) {
    for (const name of topLevelNames(source)) {
      if (owner.has(name)) clashes.push(`${name} (${rel(owner.get(name))} and ${rel(path)})`);
      else owner.set(name, path);
    }
  }
  if (clashes.length) {
    throw new Error(
      `Top-level names collide once modules share a scope:\n  ${clashes.join('\n  ')}\n` +
        'Rename one of each pair.'
    );
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Vercel Web Analytics.
 *
 * Off unless asked for, and asked for at build time rather than at runtime,
 * because this is the one thing in the project that phones home. Anyone who
 * clones the repo, opens the page or emails the bundle to a colleague gets a
 * build with none of this in it, and does not have to trust a runtime flag to
 * stay switched off.
 *
 * What goes in is a *name*, not a `<script>` tag. The page must not fetch it
 * until someone has agreed, so `ui/consent.js` reads this and loads the script
 * itself — consent that arrives after the request has gone out is not consent.
 * Keeping the URL here rather than in the app code also means `_vercel` appears
 * in a build if and only if that build carries analytics, so grepping the
 * output still settles the question.
 *
 * `/_vercel/insights/script.js` is served by the deployment itself, so it
 * resolves on Vercel and nowhere else: from a file, or from any other host,
 * the request fails and the page carries on.
 */
const VERCEL_ANALYTICS = '<meta name="massing-analytics" content="/_vercel/insights/script.js">';

export function build({ docPath, fontPath, analytics = false } = {}) {
  const modules = collect(ENTRY);
  assertNoCollisions(modules);

  const script = modules
    .map(({ path, source }) => `// ---- ${rel(path)} ${'-'.repeat(Math.max(0, 60 - rel(path).length))}\n${stripModuleSyntax(source)}`)
    .join('\n\n');

  let appCss = readFileSync(resolve(ROOT, 'styles/app.css'), 'utf8');
  const canvasCss = readFileSync(resolve(ROOT, 'styles/canvas.css'), 'utf8');

  // The stylesheet's one @import is the only thing that reaches the network.
  // With --font it is replaced by the embedded face; without it the rule is
  // kept, and the page falls back to system fonts when offline.
  if (fontPath) {
    const font = readFileSync(resolve(process.cwd(), fontPath));
    appCss = appCss.replace(/@import url\("https:\/\/cdn\.jsdelivr[^"]*"\);/, '');
    appCss =
      `@font-face {\n` +
      `  font-family: 'Pretendard JP Variable';\n` +
      `  font-style: normal;\n` +
      `  font-weight: 45 920;\n` +
      `  font-display: swap;\n` +
      `  src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2-variations');\n` +
      `}\n\n${appCss}`;
  }

  let embedded = 'null';
  if (docPath) {
    const text = readFileSync(resolve(process.cwd(), docPath), 'utf8');
    JSON.parse(text); // fail here rather than in the browser
    embedded = text.trim();
  }

  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const favicon = faviconOf(html);
  const body = html
    .slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .trim();

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Massing — Isometric architecture diagrams</title>
${favicon}${analytics ? `\n${VERCEL_ANALYTICS}` : ''}
<style>
${appCss}
</style>
<style data-scene-styles>
${canvasCss}
</style>
</head>
<body>
${body}

<script type="application/json" id="embedded-diagram">
${embedded}
</script>
<script type="module">
${script}
</script>
</body>
</html>
`;
}

/**
 * Whether a build should carry analytics.
 *
 * Deliberately strict about what counts as yes. An environment variable that
 * is present but empty, or left at `0` or `false` by someone turning it off,
 * has to mean off — the failure that matters here is shipping the script by
 * accident, never leaving it out by accident.
 */
export function analyticsWanted(env = process.env, args = []) {
  if (args.includes('--analytics')) return true;
  const value = String(env.MASSING_ANALYTICS ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

/**
 * Lift the favicon out of the page so the bundle keeps no second copy of it.
 *
 * The obvious `[^>]*` is wrong here. The icon is an inline SVG data URL, so the
 * attribute value contains `>` characters of its own; stopping at the first one
 * truncates the tag mid-attribute. That is not a cosmetic problem -- an
 * unterminated attribute swallows everything up to the next quote, which is the
 * `<style>` block that follows, and the page renders with no CSS at all. The
 * alternation below steps over quoted values rather than scanning blindly, and
 * the quote count is asserted rather than assumed.
 */
function faviconOf(html) {
  const tag = /<link rel="icon"(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(html)?.[0] ?? '';
  if (tag.split('"').length % 2 === 0) {
    throw new Error(`Favicon tag came out with unbalanced quotes:\n  ${tag}`);
  }
  return tag;
}

function rel(path) {
  return relative(ROOT, path).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------

/**
 * Write the Claude skill from the same prompt string the app copies, so the
 * two cannot drift. Importing the module is what keeps it honest -- there is
 * no second copy of the text anywhere.
 */
/**
 * Rewrite the JSON Schema's component and zone enums from the registry. With
 * 100+ types a hand-maintained list drifts, and a schema that disagrees with
 * the editor is worse than no schema at all.
 */
async function writeSchemaEnums() {
  const { COMPONENTS, GROUP_KINDS } = await import(
    new URL('./src/data/components.js', import.meta.url)
  );
  const { DEFAULT_PLANE } = await import(new URL('./src/core/schema.js', import.meta.url));
  const file = resolve(ROOT, 'schema/arch-v1.schema.json');
  const schema = JSON.parse(readFileSync(file, 'utf8'));

  schema.$defs.node.properties.type.enum = COMPONENTS.map((c) => c.type);
  schema.$defs.group.properties.kind.enum = GROUP_KINDS.map((k) => k.kind);
  // Written as a real `default` keyword, not only described in prose. The prose
  // is what drifted last time, and a machine-readable default is the copy a
  // validator and a language model can both be held to.
  schema.$defs.placement.properties.plane.default = DEFAULT_PLANE;

  writeFileSync(file, JSON.stringify(schema, null, 2) + '\n');
  console.log(
    `wrote ${rel(file)} (${COMPONENTS.length} types, ${GROUP_KINDS.length} zone kinds)`
  );
}

async function writeSkill() {
  const { LLM_PROMPT, PROMPT_TITLE, PROMPT_SUMMARY } = await import(
    new URL('./src/data/prompt.js', import.meta.url)
  );
  const dir = resolve(ROOT, '.claude/skills/massing-diagram');
  mkdirSync(dir, { recursive: true });
  const body =
    `---\nname: massing-diagram\ndescription: >-\n  ${PROMPT_SUMMARY}\n  Use when asked to create, edit or explain an isometric architecture diagram,\n  a .arch.json file, or a Massing document.\n---\n\n# ${PROMPT_TITLE}\n\n${LLM_PROMPT}\n`;
  const out = resolve(dir, 'SKILL.md');
  writeFileSync(out, body);
  console.log(`wrote ${rel(out)} (${(Buffer.byteLength(body) / 1024).toFixed(1)} kB)`);
}

// Importing this file for `build` must not run a build. Only the program does.
const isProgram = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isProgram) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] ?? true : null;
  };

  try {
    // Both are derived from the registry, never hand-edited.
    await writeSchemaEnums();
    await writeSkill();
    if (!args.includes('--skill')) {
      const docPath = flag('--doc');
      const fontPath = flag('--font');
      const analytics = analyticsWanted(process.env, args);
      const html = build({ docPath, fontPath, analytics });
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, html);
      const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
      const notes = [
        docPath && `with ${docPath} embedded`,
        fontPath && 'with the font inlined',
        // Said out loud, every time. A build that quietly started phoning home
        // is exactly the surprise this switch exists to prevent.
        analytics && 'with Vercel Analytics',
      ]
        .filter(Boolean)
        .join(', ');
      console.log(`built ${rel(OUT)} (${kb} kB)${notes ? ` ${notes}` : ''}`);
    }
  } catch (err) {
    console.error(`build failed: ${err.message}`);
    process.exit(1);
  }
}
