#!/usr/bin/env node
/**
 * Bundle the app into one self-contained `dist/index.html`.
 *
 * Built-ins only -- no bundler, no npm dependencies. The whole job is:
 * walk the ES module graph from `src/main.js`, strip the import/export
 * statements, concatenate in dependency order, and inline the stylesheets.
 * The result opens from `file://` with zero network requests, which is the
 * point: a diagram editor you can email.
 *
 * `vercel.json` runs this with `node build.js`, and so does everything else.
 *
 * This works because the project's own rules make it safe. Every module uses
 * plain named imports and exports, there are no cycles, and no module has
 * side effects at import time beyond defining things.
 *
 * `checkModule` enforces those assumptions rather than trusting them, and the
 * list of what it enforces is written in blood: `import { A as B }` shipped to
 * production as "B is not defined", because deleting the import statement also
 * deletes the renaming, and a rename is invisible until the bundle is the thing
 * running. `assertImportsResolve` is the net under it — every name a module
 * imports has to be declared by some module, or the build fails instead of
 * emitting a file that throws in a browser.
 *
 *   node build.js                    -> dist/index.html
 *   node build.js --doc example.json -> the same, with a diagram baked in
 *   node build.js --font Pretendard.woff2 -> inline the font, no network at all
 *   node build.js --skill            -> regenerate the Claude skill from prompt.js
 *   MASSING_VERCEL_FEATURES=1 node build.js -> include the hosted features
 *
 * `build()` is exported and the command line only runs when this file is the
 * program, so the tests can assemble a bundle and read it without writing
 * anything to disk.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Imported rather than taken from the global, which is the same object and
// says where it comes from.
import { Buffer } from 'node:buffer';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(ROOT, 'src/main.js');
const OUT = resolve(ROOT, 'dist/index.html');

// ---------------------------------------------------------------------------
// Module graph
// ---------------------------------------------------------------------------

/** Group 1 is the clause between `import` and `from`; group 2 the specifier. */
const IMPORT_RE = /^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
const BARE_IMPORT_RE = /^\s*import\s+['"]([^'"]+)['"];?\s*$/gm;
const EXPORT_KEYWORD_RE = /^(\s*)export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm;
const EXPORT_LIST_RE = /^\s*export\s*\{[^}]*\};?\s*$/gm;

/**
 * Keywords after which a `/` opens a regular expression rather than divides.
 *
 * The rest of the decision is positional -- see `dividesAfter` -- but these read
 * as identifiers and would otherwise be mistaken for values.
 */
const EXPRESSION_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'do', 'else', 'case', 'yield', 'await', 'throw',
]);

/**
 * Whether a `/` following `tail` is a division rather than the start of a regex.
 *
 * The one genuinely ambiguous character in JavaScript, resolved the way every
 * scanner resolves it: by what came before. A `/` after something that *is* a
 * value -- an identifier, a number, a closing bracket -- divides it; a `/` after
 * anything else opens a literal.
 *
 * The bias matters more than the completeness. Reading a real division as a
 * regex is the expensive mistake, because everything up to the next `/` then
 * stops being scanned as code; reading a real regex as division only costs the
 * tracking this exists to provide. So the cases that are actually ambiguous in
 * the abstract -- a `}` that might end an object literal rather than a block --
 * are answered as "regex", which is what they are in every line of this project,
 * and a regex is in any case abandoned at the first newline.
 */
function dividesAfter(tail) {
  const last = tail[tail.length - 1];
  if (!last) return false; // start of file: nothing to divide
  if (last === ')' || last === ']') return true;
  if (/[A-Za-z0-9_$]/.test(last)) {
    const word = /[A-Za-z_$][\w$]*$/.exec(tail)?.[0] ?? '';
    return !EXPRESSION_KEYWORDS.has(word);
  }
  return false;
}

/**
 * The source with every template literal's contents replaced by spaces.
 *
 * Everything below reads modules with line-oriented patterns, which cannot
 * tell a line of code from a line of a string that happens to contain code.
 * `data/prompt.js` holds an entire JavaScript file inside a template literal,
 * and read literally it imports `node:fs` and declares a top-level `PLANES` --
 * a bare import the bundle rejects, and a collision with `geom/plane.js`.
 *
 * Blanking is exactly length-preserving, newlines included, so a match found
 * here can be spliced out of the real source at the same offsets. Ordinary
 * quoted strings are tracked but left alone, because `from './doc.js'` is a
 * string this file very much needs to read.
 *
 * Regular expressions are tracked for the same reason as strings, and it took
 * an outage to notice they were not. `util/markdown.js` matches a fenced code
 * block with ``/^ {0,3}(`{3,}|~{3,})(.*)$/`` -- a backtick inside a regex --
 * which opened a template frame that was never really open and blanked the
 * genuine code behind it, `export function renderMarkdown` included. Nothing
 * failed: the blanked copy is only ever *read* by the checks, so what it cost
 * was those checks, silently, on that file.
 */
export function blankTemplates(source) {
  const out = [];
  // Each `${` inside a template opens a fresh code frame, which its matching
  // `}` closes -- so the nesting has to be a stack rather than a flag.
  const stack = [{ mode: 'code', depth: 0 }];
  let i = 0;
  /*
   * The last few significant characters of code, for `dividesAfter`.
   *
   * Bounded, because all it is ever asked is what the last character was and
   * what word it might be the end of. A closed string, template or regex pushes
   * a digit: whatever it contained, what precedes the next `/` is a value.
   */
  let tail = '';
  const remember = (text) => {
    const kept = (tail + text).replace(/\s+/g, '');
    tail = kept.slice(-16);
  };

  const take = (n) => { out.push(source.slice(i, i + n)); i += n; };
  const hide = (n) => {
    for (let k = 0; k < n; k++) out.push(source[i + k] === '\n' ? '\n' : ' ');
    i += n;
  };

  while (i < source.length) {
    const frame = stack[stack.length - 1];
    const c = source[i];
    const pair = source.slice(i, i + 2);

    switch (frame.mode) {
      case 'template':
        if (c === '\\') hide(2);
        else if (c === '`') { stack.pop(); remember('0'); take(1); }
        else if (pair === '${') { stack.push({ mode: 'code', depth: 0 }); take(2); }
        else hide(1);
        break;
      case 'line':
        if (c === '\n') stack.pop();
        take(1);
        break;
      case 'block':
        if (pair === '*/') { stack.pop(); take(2); } else take(1);
        break;
      case 'quote':
        if (c === '\\') take(2);
        else { if (c === frame.quote) { stack.pop(); remember('0'); } take(1); }
        break;
      /*
       * Taken through unchanged, never blanked: the point of following a regex
       * is only that a backtick, quote or slash-star inside one is not read as
       * opening something. A literal cannot span lines, so an unterminated one
       * is abandoned at the newline rather than swallowing the rest of the file
       * -- the bound that keeps a misjudged `/` cheap.
       */
      case 'regex':
        if (c === '\\') take(2);
        else if (c === '\n') { stack.pop(); take(1); }
        else if (frame.inClass) { if (c === ']') frame.inClass = false; take(1); }
        else if (c === '[') { frame.inClass = true; take(1); }
        else if (c === '/') { stack.pop(); remember('0'); take(1); }
        else take(1);
        break;
      default:
        if (pair === '//') { stack.push({ mode: 'line' }); take(2); }
        else if (pair === '/*') { stack.push({ mode: 'block' }); take(2); }
        else if (c === '/' && !dividesAfter(tail)) {
          stack.push({ mode: 'regex', inClass: false });
          take(1);
        }
        else if (c === "'" || c === '"') { stack.push({ mode: 'quote', quote: c }); take(1); }
        else if (c === '`') { stack.push({ mode: 'template' }); take(1); }
        else if (c === '{') { frame.depth++; remember(c); take(1); }
        else if (c === '}' && frame.depth === 0 && stack.length > 1) { stack.pop(); take(1); }
        else { if (c === '}') frame.depth--; remember(c); take(1); }
    }
  }
  return out.join('');
}

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
    const code = blankTemplates(source);
    checkModule(path, code);
    for (const specifier of importsOf(code)) {
      if (!specifier.startsWith('.')) {
        throw new Error(`${rel(path)} imports "${specifier}"; the bundle allows only relative paths`);
      }
      visit(resolve(dirname(path), specifier), path);
    }

    state.set(path, 'done');
    ordered.push({ path, source, code });
  }

  visit(entry, entry);
  return ordered;
}

function importsOf(source) {
  const found = new Set();
  for (const match of source.matchAll(IMPORT_RE)) found.add(match[2]);
  for (const match of source.matchAll(BARE_IMPORT_RE)) found.add(match[1]);
  return found;
}

/**
 * The names an `import { ... }` clause brings into a module's scope.
 *
 * Only the braced form, because `checkModule` has already refused every other
 * one. Once the imports are deleted and the modules share a scope, these are
 * exactly the names the module expects somebody else to have declared — which
 * is what `assertImportsResolve` goes on to check.
 */
function importedNames(code) {
  const names = [];
  for (const match of code.matchAll(IMPORT_RE)) {
    const clause = match[1].trim();
    if (!clause.startsWith('{')) continue;
    for (const part of clause.replace(/[{}]/g, '').split(',')) {
      const name = part.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Concatenation only works if every module's top level can share one scope.
 * These are the ways that quietly breaks.
 *
 * "Quietly" is the word that earns this function. The bundle deletes import
 * statements outright, so anything an import statement *does* beyond naming a
 * dependency is done by nothing at all afterwards — and the result is not a
 * build failure but a working build that throws in somebody's browser. That is
 * how `import { FACE_LIGHT as TOP_LIGHT }` reached production as
 * "TOP_LIGHT is not defined": the source ran perfectly, because unbundled the
 * browser honours the rename, and only the bundle did not.
 *
 * So every form except the plain braced list is refused here rather than
 * assumed absent.
 */
export function checkModule(path, source) {
  if (/\bimport\s*\(/.test(source)) {
    throw new Error(`${rel(path)} uses a dynamic import(), which the bundle cannot inline`);
  }
  if (/^\s*export\s+default\b/m.test(source)) {
    throw new Error(`${rel(path)} uses "export default"; use a named export instead`);
  }

  for (const match of source.matchAll(IMPORT_RE)) {
    const clause = match[1].trim();
    if (clause.startsWith('*')) {
      throw new Error(
        `${rel(path)} imports a namespace ("${clause}"); the bundle has no module ` +
          'objects to give it. Import the names one by one.'
      );
    }
    if (!clause.startsWith('{')) {
      throw new Error(
        `${rel(path)} imports a default ("${clause}"); use a named import instead.`
      );
    }
    if (/\bas\b/.test(clause)) {
      throw new Error(
        `${rel(path)} renames an import ("${clause.replace(/\s+/g, ' ')}"). The bundle ` +
          'deletes the statement that would do the renaming, leaving the new name ' +
          'undeclared — which fails only once it is in a browser. Import it under its ' +
          'own name.'
      );
    }
  }

  for (const match of source.matchAll(EXPORT_LIST_RE)) {
    if (/\bas\b/.test(match[0])) {
      throw new Error(
        `${rel(path)} renames an export ("${match[0].trim()}"), which the bundle drops ` +
          'along with the statement. Export it under its own name.'
      );
    }
  }
}

/**
 * Every imported name is declared by somebody, once they all share a scope.
 *
 * The general net under `checkModule`'s specific refusals: it catches a name
 * that was never exported, one lost to a typo, and any future way of ending up
 * with an identifier the bundle reads and nothing writes. It is the check that
 * would have turned "TOP_LIGHT is not defined" from a production incident into
 * a failed build.
 *
 * Declarations are read from the blanked `code`, so a name that only ever
 * appears quoted inside a template literal does not count as declared --
 * `data/prompt.js` holds a whole JavaScript file inside one. That reading is
 * only safe because `blankTemplates` now follows regular expressions: for as
 * long as it did not, this check reported `util/markdown.js`'s `renderMarkdown`
 * as undeclared, and a check that gates the build cannot cry wolf.
 */
function assertImportsResolve(modules) {
  const declared = new Set();
  for (const { code } of modules) {
    for (const name of topLevelNames(code)) declared.add(name);
  }
  const missing = [];
  for (const { path, code } of modules) {
    for (const name of importedNames(code)) {
      if (!declared.has(name)) missing.push(`${name} (imported by ${rel(path)})`);
    }
  }
  if (missing.length) {
    throw new Error(
      `Imported but never declared, so the bundle would read an undefined name:\n  ${missing.join('\n  ')}`
    );
  }
}

/**
 * Remove module syntax, leaving declarations that are valid in one scope.
 *
 * Matched against `code` -- the same text with template literals blanked --
 * and spliced out of `source`, so a quoted example of an import survives into
 * the bundle instead of being edited as if it were one. The two are the same
 * length by construction, which is what makes the offsets interchangeable.
 */
function stripModuleSyntax(source, code) {
  const cuts = [];
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, EXPORT_LIST_RE]) {
    for (const m of code.matchAll(re)) cuts.push([m.index, m.index + m[0].length, '']);
  }
  // The keyword alone goes; the indentation in front of it stays.
  for (const m of code.matchAll(EXPORT_KEYWORD_RE)) {
    cuts.push([m.index, m.index + m[0].length, m[1]]);
  }
  cuts.sort((a, b) => a[0] - b[0]);

  let out = '';
  let at = 0;
  for (const [start, end, text] of cuts) {
    if (start < at) continue; // one match already covers this stretch
    out += source.slice(at, start) + text;
    at = end;
  }
  return (out + source.slice(at)).trimEnd();
}

/** Names declared at a module's top level, to catch collisions after merging. */
export function topLevelNames(source) {
  const names = new Set();
  const re = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of source.matchAll(re)) names.add(match[1]);
  return names;
}

function assertNoCollisions(modules) {
  const owner = new Map();
  const clashes = [];
  for (const { path, code } of modules) {
    for (const name of topLevelNames(code)) {
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
 * Vercel Web Analytics and Speed Insights.
 *
 * Off unless asked for, and asked for at build time rather than at runtime,
 * because this is the one thing in the project that phones home. Anyone who
 * clones the repo, opens the page or emails the bundle to a colleague gets a
 * build with none of this in it, and does not have to trust a runtime flag to
 * stay switched off.
 *
 * What goes in is a list of *names*, not `<script>` tags. The page must not
 * fetch them until someone has agreed, so `ui/consent.js` reads this and adds
 * the elements itself — consent that arrives after the request has gone out is
 * not consent. Keeping the URLs here rather than in the app code also means
 * `_vercel` appears in a build if and only if that build carries them, so
 * grepping the output still settles the question.
 *
 * One switch covers both. They answer different questions — how many visits,
 * and how quickly the page came up — but they are the same decision to anyone
 * being asked, and two banners for one deployment would be absurd.
 *
 * Both paths are served by the deployment itself, so they resolve on Vercel
 * and nowhere else: from a file, or from any other host, the requests fail and
 * the page carries on.
 */
const VERCEL_SCRIPTS = ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js'];

/**
 * What a hosted build carries: the measurement script names, and a marker
 * saying there are functions behind this deployment.
 *
 * The marker is what the client tests before asking `/api/flags` which of the
 * hosted features are switched on. Without it nothing calls anything, and that
 * is the property worth keeping: a bundle someone downloaded, or opened from a
 * file, makes no requests because there is nothing in it that would.
 */
const VERCEL_META = [
  `<meta name="massing-analytics" content="${VERCEL_SCRIPTS.join(' ')}">`,
  '<meta name="massing-vercel" content="1">',
].join('\n');

export function build({ docPath, fontPath, vercel = false } = {}) {
  const modules = collect(ENTRY);
  assertNoCollisions(modules);
  assertImportsResolve(modules);

  const script = modules
    .map(({ path, source, code }) => `// ---- ${rel(path)} ${'-'.repeat(Math.max(0, 60 - rel(path).length))}\n${stripModuleSyntax(source, code)}`)
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
${favicon}${vercel ? `\n${VERCEL_META}` : ''}
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
 * Whether a build should carry the hosted features at all.
 *
 * One switch for all of them — analytics, stored diagrams, the assistant —
 * because they share the property that makes a switch worth having: they are
 * the only things in the project that talk to a server. *Which* of them are
 * live is decided at runtime by the flags, and that is a different question
 * from whether this bundle can reach a server in the first place.
 *
 * Deliberately strict about what counts as yes. An environment variable that
 * is present but empty, or left at `0` or `false` by someone turning it off,
 * has to mean off — the failure that matters here is shipping the network code
 * by accident, never leaving it out by accident.
 */
export function vercelFeaturesWanted(env = process.env, args = []) {
  if (args.includes('--vercel')) return true;
  const value = String(env.MASSING_VERCEL_FEATURES ?? '').trim().toLowerCase();
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
  const { SHAPE_KINDS } = await import(new URL('./src/data/shapes.js', import.meta.url));
  const { DEFAULT_PLANE } = await import(new URL('./src/core/schema.js', import.meta.url));
  const file = resolve(ROOT, 'schema/arch-v1.schema.json');
  const schema = JSON.parse(readFileSync(file, 'utf8'));

  schema.$defs.node.properties.type.enum = COMPONENTS.map((c) => c.type);
  schema.$defs.group.properties.kind.enum = GROUP_KINDS.map((k) => k.kind);
  schema.$defs.shape.properties.kind.enum = SHAPE_KINDS.map((k) => k.kind);
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
      const vercel = vercelFeaturesWanted(process.env, args);
      const html = build({ docPath, fontPath, vercel });
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, html);
      const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
      const notes = [
        docPath && `with ${docPath} embedded`,
        fontPath && 'with the font inlined',
        // Said out loud, every time. A build that quietly started phoning home
        // is exactly the surprise this switch exists to prevent.
        vercel && 'with the hosted features',
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
