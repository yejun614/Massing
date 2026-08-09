/**
 * The desktop app, end to end: `node test/desktop.e2e.mjs`.
 *
 * Everything here needs a running process, which is why it is not in
 * `cases.js` — that suite is deliberately DOM-free so it runs in a browser as
 * well as a terminal. This one starts the built app, talks to it the way a CLI
 * would, and shuts it down.
 *
 * The window is played by a stand-in that speaks the same two messages the real
 * one does: it listens on the push channel and posts results back. That covers
 * every hop except the four tool bodies in `desktop/web/shim.js`, which run in
 * the page and need a browser.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(
  new URL('../desktop/src-tauri/target/debug/massing.exe', import.meta.url),
);
const MCP_PORT = 7399;
const MCP = `http://127.0.0.1:${MCP_PORT}/mcp`;

const ok = [], bad = [];
const check = (name, pass, detail = '') => (pass ? ok : bad).push(detail && !pass ? `${name} — ${detail}` : name);

const app = spawn(BIN, [], { env: { ...process.env, MASSING_MCP_PORT: String(MCP_PORT) } });
let APP = '';
const port = await new Promise((resolve) => {
  let seen = '';
  app.stderr.on('data', (chunk) => {
    seen += chunk;
    const m = seen.match(/serving the editor on 127\.0\.0\.1:(\d+)/);
    if (m) resolve(m[1]);
  });
  setTimeout(() => resolve(null), 30000);
});
if (!port) { console.log('the app never said which port it took'); app.kill(); process.exit(1); }
APP = `http://127.0.0.1:${port}`;

// --- the editor it serves ---------------------------------------------------
const html = await (await fetch(`${APP}/`)).text();
check('the page says it is the desktop build', html.includes('name="massing-desktop"'));
check('the shim is injected ahead of the app',
  html.indexOf('/__massing/shim.js') >= 0 && html.indexOf('/__massing/shim.js') < html.indexOf('src/main.js'));
check('the sources are served', (await fetch(`${APP}/src/main.js`)).status === 200);
check('the shell browser code is served', (await fetch(`${APP}/__massing/mcp-ui.js`)).status === 200);
check('nothing outside the served roots is', (await fetch(`${APP}/src/../Cargo.toml`)).status === 404);

// --- the stand-in window ----------------------------------------------------
const calls = [];
const changes = [];
const post = (route, body) =>
  fetch(`${APP}/__massing/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

const es = await fetch(`${APP}/__massing/events`);
(async () => {
  const reader = es.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const msg = JSON.parse(line.slice(6));
      if (msg.type === 'file-changed') { changes.push(msg); continue; }
      if (msg.type !== 'call') continue;
      calls.push(msg.name);
      await post('result', {
        id: msg.id, ok: true,
        value: msg.name === 'get_diagram' ? '{ "version": 1, "nodes": [] }' : `${msg.name}: ${JSON.stringify(msg.args)}`,
      });
    }
  }
})().catch(() => {});
await new Promise((r) => setTimeout(r, 400));

// --- files and the watcher --------------------------------------------------
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const scratch = mkdtempSync(join(tmpdir(), 'massing-'));
const doc = join(scratch, 'probe.arch.json');
writeFileSync(doc, '{"nodes":[]}');

check('a file can be read', (await post('read', { path: doc })).text === '{"nodes":[]}');
check('a missing file is reported, not thrown', Boolean((await post('read', { path: doc + 'x' })).error));
check('a file can be written', (await post('write', { path: doc, text: '{"nodes":[1]}' })).ok === true);

await post('watch', { path: doc });
await new Promise((r) => setTimeout(r, 300));
writeFileSync(doc, '{"nodes":[],"edges":[]}');       // somebody else edits it
await new Promise((r) => setTimeout(r, 1200));
check('an outside edit reaches the window', changes.length === 1, `${changes.length} events`);
const before = changes.length;
await post('write', { path: doc, text: '{"nodes":[],"texts":[]}' });   // our own save
await new Promise((r) => setTimeout(r, 1200));
check('our own save does not', changes.length === before, `${changes.length - before} extra`);

// --- MCP --------------------------------------------------------------------
// Streamable HTTP is session-based: initialize hands back an Mcp-Session-Id
// and every later call has to carry it.
let SESSION = '';
async function notify(method) {
  await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': SESSION,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method }),
  });
}
async function rpc(method, params, headers = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(SESSION ? { 'mcp-session-id': SESSION } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const given = res.headers.get('mcp-session-id');
  if (given) SESSION = given;
  const body = await res.text();
  const line = body.split('\n').find((l) => l.startsWith('data: ') && l.includes('jsonrpc'));
  return { status: res.status, json: line ? JSON.parse(line.slice(6)) : null, body };
}
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'v', version: '1' } });
check('MCP answers initialize as massing', init.json?.result?.serverInfo?.name === 'massing', JSON.stringify(init.json)?.slice(0, 120));
await notify('notifications/initialized');
const names = ((await rpc('tools/list')).json?.result?.tools ?? []).map((t) => t.name).sort().join();
check('it offers the same four tools as the panel', names === 'add_tab,get_diagram,replace_diagram,validate_diagram', names);
const got = await rpc('tools/call', { name: 'get_diagram', arguments: {} });
check('a tool call reaches the window and comes back',
  String(got.json?.result?.content?.[0]?.text).includes('"version": 1'), JSON.stringify(got.json)?.slice(0, 160));
const added = await rpc('tools/call', { name: 'add_tab', arguments: { name: 'Failover', document: '{"nodes":[]}' } });
check('arguments survive the round trip', String(added.json?.result?.content?.[0]?.text).includes('Failover'),
  JSON.stringify(added.json)?.slice(0, 160));
check('the window saw the calls', calls.length >= 2, calls.join());

// --- the setup routes -------------------------------------------------------
const targets = await post('mcp/targets');
check('the app knows where its MCP server is', typeof targets.url === 'string' && targets.url.includes('7399'), JSON.stringify(targets).slice(0, 120));
check('it can see the agents on this machine', Array.isArray(targets.targets) && targets.targets.length === 3);
check('register refuses an empty choice', Boolean((await post('mcp/register', { ids: [] })).error));

for (const l of ok) console.log(`  ok   ${l}`);
for (const l of bad) console.log(`  FAIL ${l}`);
console.log(`${ok.length} passed, ${bad.length} failed`);
app.kill();
process.exit(bad.length ? 1 : 0);
