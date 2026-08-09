/**
 * The desktop app, end to end: `deno task test:desktop`.
 *
 * Everything here needs a running process, which is why it is not in
 * `cases.js` — that suite is deliberately DOM-free and side-effect-free so it
 * can run in a browser as well as a terminal. This one starts the app, talks
 * to it the way a CLI would, and shuts it down.
 *
 * The window is played by a stand-in that speaks the same two messages the
 * real one does: it listens on the push channel and posts results back. That
 * covers every hop except the editor's own tool implementations, which live in
 * the page and need a browser to exercise.
 */

const PORT = 8199;
const MCP_PORT = 7399;
const APP = `http://127.0.0.1:${PORT}`;
const MCP = `http://127.0.0.1:${MCP_PORT}/`;

const passed: string[] = [];
const failed: string[] = [];
const check = (name: string, ok: boolean, detail = '') =>
  ok ? passed.push(name) : failed.push(detail ? `${name} — ${detail}` : name);

const root = new URL('../', import.meta.url);
const app = new Deno.Command(Deno.execPath(), {
  args: [
    'run',
    '--allow-read',
    '--allow-write',
    '--allow-net',
    '--allow-run',
    '--allow-env',
    new URL('desktop/main.ts', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  ],
  env: { MASSING_PORT: String(PORT), MASSING_MCP_PORT: String(MCP_PORT) },
  stdout: 'piped',
  stderr: 'piped',
}).spawn();

/** Wait for the app to answer rather than sleeping and hoping. */
async function ready(url: string, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(url, { method: 'HEAD' });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

/** The stand-in window: answers calls the way `desktop/web/shim.js` does. */
const calls: string[] = [];
function beTheWindow(signal: AbortSignal) {
  return (async () => {
    const res = await fetch(`${APP}/__massing/events`, { signal });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const message = JSON.parse(line.slice(6));
        if (message.type !== 'call') continue;
        calls.push(message.name);
        await fetch(`${APP}/__massing/result`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: message.id,
            ok: true,
            value: message.name === 'get_diagram'
              ? '{ "version": 1, "nodes": [] }'
              : `${message.name}: ${JSON.stringify(message.args)}`,
          }),
        });
      }
    }
  })();
}

async function rpc(method: string, params?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.text();
  const line = body.split('\n').find((l) => l.startsWith('data: '));
  return { status: res.status, body, json: line ? JSON.parse(line.slice(6)) : null };
}

const controller = new AbortController();
try {
  if (!await ready(APP)) throw new Error('the app never started listening');

  // --- the editor it serves -------------------------------------------------
  const html = await (await fetch(`${APP}/`)).text();
  check('the page says it is the desktop build', html.includes('name="massing-desktop"'));
  check(
    'the shim is injected ahead of the app',
    html.indexOf('/__massing/shim.js') >= 0 &&
      html.indexOf('/__massing/shim.js') < html.indexOf('src/main.js'),
    'io.js decides once, at construction, whether a file picker exists',
  );
  check('the sources are served', (await fetch(`${APP}/src/main.js`)).status === 200);
  check(
    'nothing outside the served roots is',
    (await fetch(`${APP}/src/../package.json`)).status === 404,
  );

  // --- the file API ---------------------------------------------------------
  const scratch = await Deno.makeTempDir();
  const doc = `${scratch}/probe.arch.json`;
  await Deno.writeTextFile(doc, '{"nodes":[]}');
  const post = (route: string, body: unknown) =>
    fetch(`${APP}/__massing/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  check('a file can be read', (await post('read', { path: doc })).text === '{"nodes":[]}');
  check('a missing file is reported, not thrown', Boolean((await post('read', { path: `${scratch}/nope` })).error));
  check('a file can be written', (await post('write', { path: doc, text: '{"nodes":[1]}' })).ok === true);

  // --- the watcher ----------------------------------------------------------
  // Aborting the signal at the end rejects both readers; that is how they are
  // meant to end, so the rejection is expected rather than a failure.
  beTheWindow(controller.signal).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  await post('watch', { path: doc });

  const changes: unknown[] = [];
  const watching = (async () => {
    const res = await fetch(`${APP}/__massing/events`, { signal: controller.signal });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const line of (value ?? '').split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const message = JSON.parse(line.slice(6));
        if (message.type === 'file-changed') changes.push(message);
      }
    }
  })().catch(() => {});

  await new Promise((r) => setTimeout(r, 300));
  // Somebody else edits the file.
  await Deno.writeTextFile(doc, '{"nodes":[],"edges":[]}');
  await new Promise((r) => setTimeout(r, 900));
  check('an outside edit reaches the window', changes.length === 1, `${changes.length} events`);

  // Our own save must not read as an outside edit, or every save would bounce
  // back through reload.
  const before = changes.length;
  await post('write', { path: doc, text: '{"nodes":[],"texts":[]}' });
  await new Promise((r) => setTimeout(r, 900));
  check('our own save does not', changes.length === before, `${changes.length - before} extra`);
  void watching;

  // --- registering with the CLIs --------------------------------------------
  //
  // Run against a fake HOME rather than the real one: these are the files a
  // person keeps their own settings in, and a test suite that edits them is a
  // test suite nobody should run twice.
  {
    const home = await Deno.makeTempDir();
    Deno.env.set('USERPROFILE', home);
    Deno.env.set('HOME', home);
    const { registerWith, surveyTargets } = await import('../desktop/setup.ts');
    const url = 'http://127.0.0.1:7337/';

    check('nothing is claimed to be installed on an empty machine',
      (await surveyTargets()).every((t) => !t.registered));

    // Existing settings, of the kind this must not eat.
    await Deno.mkdir(`${home}/.codex`, { recursive: true });
    await Deno.writeTextFile(
      `${home}/.codex/config.toml`,
      '# my notes\nmodel = "gpt-5"\n\n[mcp_servers.other]\nurl = "http://example.com/mcp"\n',
    );
    await Deno.writeTextFile(
      `${home}/.claude.json`,
      JSON.stringify({ numStartups: 42, mcpServers: { other: { type: 'http', url: 'http://x/' } } }),
    );

    const done = await registerWith(['claude', 'codex', 'antigravity'], url);
    check('every chosen target is written', done.length === 3 && done.every((t) => t.registered),
      JSON.stringify(done.map((t) => [t.id, t.problem])));

    const codex = await Deno.readTextFile(`${home}/.codex/config.toml`);
    check('the Codex file keeps what was already in it',
      codex.includes('# my notes') && codex.includes('model = "gpt-5"') &&
        codex.includes('[mcp_servers.other]'),
      codex);
    check('and gains ours', codex.includes('[mcp_servers.massing]') && codex.includes(url), codex);

    const claude = JSON.parse(await Deno.readTextFile(`${home}/.claude.json`));
    check('Claude Code keeps its unrelated state',
      claude.numStartups === 42 && claude.mcpServers.other,
      JSON.stringify(claude));
    check('and is pointed at us, with the type it insists on',
      claude.mcpServers.massing?.type === 'http' && claude.mcpServers.massing?.url === url);

    const anti = JSON.parse(await Deno.readTextFile(`${home}/.gemini/config/mcp_config.json`));
    check('Antigravity gets serverUrl, not url',
      anti.mcpServers.massing?.serverUrl === url && !anti.mcpServers.massing?.url);

    check('the previous file is kept beside the new one',
      (await Deno.readTextFile(`${home}/.codex/config.toml.massing-backup`)).includes('# my notes'));

    // Doing it twice is the normal case: the port can change between runs.
    await registerWith(['codex', 'claude'], 'http://127.0.0.1:9999/');
    const twice = await Deno.readTextFile(`${home}/.codex/config.toml`);
    check('running it again replaces rather than duplicates',
      twice.split('[mcp_servers.massing]').length === 2 && twice.includes('9999') &&
        twice.includes('[mcp_servers.other]'),
      twice);
    check('a second run is still one entry in Claude Code',
      JSON.parse(await Deno.readTextFile(`${home}/.claude.json`)).mcpServers.massing.url
        .includes('9999'));

    check('a machine with the config present reads as connected',
      (await surveyTargets()).filter((t) => t.registered).length === 3);
  }

  // --- MCP ------------------------------------------------------------------
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  check('MCP answers initialize', init.json?.result?.serverInfo?.name === 'massing', init.body.slice(0, 140));

  const names = ((await rpc('tools/list')).json?.result?.tools ?? [])
    .map((t: { name: string }) => t.name).sort().join();
  check(
    'it offers the same four tools as the panel',
    names === 'add_tab,get_diagram,replace_diagram,validate_diagram',
    names,
  );

  const got = await rpc('tools/call', { name: 'get_diagram', arguments: {} });
  check(
    'a tool call reaches the window and comes back',
    String(got.json?.result?.content?.[0]?.text).includes('"version": 1'),
    JSON.stringify(got.json).slice(0, 160),
  );
  const added = await rpc('tools/call', {
    name: 'add_tab',
    arguments: { name: 'Failover', document: '{"nodes":[]}' },
  });
  check(
    'arguments survive the round trip',
    String(added.json?.result?.content?.[0]?.text).includes('Failover'),
    JSON.stringify(added.json).slice(0, 160),
  );

  // Loopback is not access control: any page in any browser can post here.
  check(
    'a browser origin is turned away',
    (await rpc('tools/list', undefined, { origin: 'https://evil.example.com' })).status === 403,
  );
  check(
    'a client that sends no origin is not',
    (await rpc('tools/list')).status === 200,
  );
  check('the window saw the calls', calls.length >= 2, calls.join());
} catch (err) {
  failed.push(`the run itself: ${err}`);
} finally {
  controller.abort();
  try {
    app.kill();
  } catch { /* already gone */ }
  await app.status;
}

for (const line of passed) console.log(`  ok   ${line}`);
for (const line of failed) console.error(`  FAIL ${line}`);
console.log(`${passed.length} passed, ${failed.length} failed`);
Deno.exit(failed.length ? 1 : 0);
