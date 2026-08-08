#!/usr/bin/env node
/**
 * The hosted build, running on your machine.
 *
 *   node scripts/dev.mjs          -> http://127.0.0.1:8130
 *   node scripts/dev.mjs 9000     -> a different port
 *
 * The point is the loop. Everything under `api/` is a Vercel function, and the
 * only way to exercise one used to be to deploy — which turns a one-line fix
 * into a push, a build, a cold start and a click. This mounts the *real*
 * handlers on a plain Node server instead, so the same code answers the same
 * requests with the same environment variables, and the loop is a refresh.
 *
 * Two things are faked and both are said out loud on start-up:
 *
 * - **Blob** is a Map in memory unless `BLOB_READ_WRITE_TOKEN` is set. Storing
 *   and reading diagrams work; nothing survives a restart.
 * - **Gemini** is not faked at all when `GEMINI_API_KEY` is set. That is the
 *   whole reason this exists: the model's own behaviour — function calling,
 *   reasoning signatures, which model ids a key can actually reach — is
 *   exactly what a stub cannot tell you, and what kept being discovered in
 *   production.
 *
 * Secrets come from `.env.local`, which is gitignored. Nothing is read from the
 * shell so that a key cannot leak into a command someone pastes.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
// Safe to import this early: it reads the environment only when called, and
// the environment is not assembled until a few lines below.
import { MODEL_TIERS, modelForTier, tiersPinned } from '../src/data/models.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] ?? 8130);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * `KEY=value` lines, `#` comments, quotes optional.
 *
 * Deliberately not a dependency and deliberately not clever: anything that
 * needs more than this belongs in the Vercel dashboard, which is where the
 * real values live.
 */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    out[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

Object.assign(process.env, loadEnvFile(resolve(ROOT, '.env.local')));

// The build switch is what puts the hosted code in the page at all, and a dev
// server for the hosted features that served the offline build would be a
// puzzle rather than a tool.
process.env.MASSING_VERCEL_FEATURES = '1';
if (!process.env.CRON_SECRET) process.env.CRON_SECRET = 'dev-sweep-secret';

const liveBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const liveModel = Boolean(process.env.GEMINI_API_KEY);
if (!liveBlob) process.env.BLOB_READ_WRITE_TOKEN = 'dev-in-memory';

// ---------------------------------------------------------------------------
// A blob store in memory
// ---------------------------------------------------------------------------

const objects = new Map();
const BASE = 'https://dev.public.blob.vercel-storage.com';
const realFetch = globalThis.fetch;

/**
 * Only Vercel Blob is intercepted. Anything else — Gemini above all — goes to
 * the network untouched, which is the difference between this and a stub.
 */
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (liveBlob || (!url.startsWith('https://blob.vercel-storage.com') && !url.startsWith(BASE))) {
    return realFetch(input, init);
  }

  if (url.startsWith(BASE)) {
    const pathname = decodeURI(new URL(url).pathname.replace(/^\//, ''));
    const found = objects.get(pathname);
    return found
      ? new Response(found.body, { status: 200 })
      : new Response('not found', { status: 404 });
  }
  if (url.endsWith('/delete') && init.method === 'POST') {
    for (const each of JSON.parse(init.body).urls) {
      objects.delete(decodeURI(new URL(each).pathname.replace(/^\//, '')));
    }
    return new Response('{}', { status: 200 });
  }
  if (init.method === 'PUT') {
    const pathname = decodeURI(new URL(url).pathname.replace(/^\//, ''));
    objects.set(pathname, { body: String(init.body), uploadedAt: new Date().toISOString() });
    return new Response(JSON.stringify({ url: `${BASE}/${pathname}`, pathname }), { status: 200 });
  }
  const prefix = new URL(url).searchParams.get('prefix') ?? '';
  const blobs = [...objects.entries()]
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, o]) => ({ pathname: path, url: `${BASE}/${path}`, uploadedAt: o.uploadedAt }));
  return new Response(JSON.stringify({ blobs, hasMore: false }), { status: 200 });
};

// ---------------------------------------------------------------------------
// The real handlers, and the real build
// ---------------------------------------------------------------------------

/** A Windows absolute path is not a URL, and the ESM loader wants a URL. */
const load = (relative) => import(pathToFileURL(resolve(ROOT, relative)).href);

const api = {
  '/api/flags': (await load('api/flags.js')).default,
  '/api/chat': (await load('api/chat.js')).default,
  '/api/diagrams': (await load('api/diagrams/index.js')).default,
  '/api/cron/sweep': (await load('api/cron/sweep.js')).default,
};
const readDiagram = (await load('api/diagrams/[key].js')).default;
const { build } = await load('build.js');

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const started = Date.now();
  res.on('finish', () => {
    // One line per request, because a 502 with no context is what this whole
    // exercise has been about.
    console.log(`${res.statusCode} ${req.method} ${pathname} ${Date.now() - started}ms`);
  });

  try {
    if (api[pathname]) return await api[pathname](req, res);

    const stored = /^\/api\/diagrams\/(.+)$/.exec(pathname);
    if (stored) {
      req.query = { key: decodeURIComponent(stored[1]) };
      return await readDiagram(req, res);
    }

    // Rebuilt per request rather than served from `dist/`, so editing a module
    // and refreshing is the whole edit-test loop.
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(build({ vercel: true }));
  } catch (err) {
    console.error(`!! ${pathname}`, err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
  }
}).listen(PORT, () => {
  console.log(`Massing dev server  http://127.0.0.1:${PORT}`);
  console.log(`  blob       ${liveBlob ? 'live (BLOB_READ_WRITE_TOKEN set)' : 'in memory — nothing survives a restart'}`);
  // Which models, not "a model": the panel picks between three, and being
  // told which one a tier resolves to here is the point of running locally.
  const models = tiersPinned(process.env)
    ? `pinned to ${process.env.MASSING_AI_MODEL}`
    : MODEL_TIERS.map((t) => `${t.id}=${modelForTier(t.id, process.env)}`).join('  ');
  console.log(`  assistant  ${liveModel ? `live — ${models}` : 'off (set GEMINI_API_KEY in .env.local)'}`);
  if (!existsSync(resolve(ROOT, '.env.local'))) {
    console.log('\n  No .env.local. Create one with:\n    GEMINI_API_KEY=…\n');
  }
});
