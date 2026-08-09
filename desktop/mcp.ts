/**
 * The point of the desktop app: an MCP server on the diagram you are looking at.
 *
 * The editor already has an assistant, and it works — but it answers to a
 * Gemini key you pay for on top of the Claude Code, Codex or Antigravity
 * subscription you already have. This server is the same four tools offered to
 * the CLI you are already paying for, driving the same document through the
 * same loader.
 *
 * **The tools act on the open window, not on a file.** So they work on a
 * diagram that has never been saved, they land in the same undo stack as a
 * change made by hand, and the result is on screen before the tool returns.
 * The other route — a CLI that simply writes the `.arch.json` — is covered by
 * the file watcher, and needs nothing here.
 *
 * The names and the semantics are deliberately the assistant's
 * (`src/core/assistant.js`): a document written by Claude Code should meet the
 * same rules, and the same complaints, as one written by the panel.
 */

import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

type Bridge = { ask(name: string, args?: Record<string, unknown>): Promise<unknown> };

/** The port a CLI is told to use. Not sacred, but it has to be guessable. */
export const DEFAULT_MCP_PORT = 7337;

/**
 * Loopback is not access control.
 *
 * Any page in any browser on this machine can POST to `127.0.0.1:7337`, and
 * without this a visited web page could drive the editor — the DNS-rebinding
 * shape, where a hostile name resolves to loopback and the browser sends the
 * request for it. MCP clients send no `Origin` at all, so the rule is: no
 * origin is fine, a browser origin is not.
 */
function fromABrowser(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]';
  } catch {
    return true;
  }
}

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] });

function buildServer(bridge: Bridge, version: string) {
  const server = new McpServer({ name: 'massing', version });

  const call = async (name: string, args?: Record<string, unknown>) => {
    try {
      return text(String(await bridge.ask(name, args)));
    } catch (err) {
      // Reported as content rather than thrown: a model that hears "the window
      // is not open" can say so, where a transport error is something it can
      // only retry.
      return text(`Refused: ${(err as Error).message}`);
    }
  };

  server.registerTool('get_diagram', {
    description:
      'Read the diagram open in the Massing editor, as a .arch.json document. Call this ' +
      'before any edit so you are changing what is actually on screen, and so you keep the ' +
      'ids that already exist.',
    inputSchema: z.object({}),
  }, () => call('get_diagram'));

  server.registerTool('replace_diagram', {
    description:
      'Replace what is open in the editor with a complete .arch.json document. Send the ' +
      'whole document, never a fragment: anything left out is deleted. The result reports ' +
      'whatever the loader had to repair, so read it and fix what it names rather than ' +
      'assuming the edit landed as written. The change is undoable in the editor.',
    inputSchema: z.object({
      document: z.string().describe('A complete .arch.json document as JSON text.'),
    }),
  }, ({ document }: { document: string }) => call('replace_diagram', { document }));

  server.registerTool(
    'add_tab',
    {
      description:
        'Add a new drawing to the open file as a tab, beside the one already open, and switch ' +
        'to it. Use it when one picture genuinely will not hold the answer — a system past ' +
        'about 25 blocks, or a second view the person asked for alongside the first. Never use ' +
        'it to tidy one diagram into several, and never to avoid editing what is open. You ' +
        'cannot create files: the file belongs to the person.',
      inputSchema: z.object({
        name: z.string().describe('What the tab is called, after what it shows.'),
        document: z.string().describe('The new drawing as a complete .arch.json document.'),
      }),
    },
    ({ name, document }: { name: string; document: string }) => call('add_tab', { name, document }),
  );

  server.registerTool('validate_diagram', {
    description:
      'Check the diagram on screen for the faults that make one unreadable: a block hidden ' +
      'behind a taller one, a connection that vanishes under a block, blocks overlapping, a ' +
      'block outside the zone it claims, captions written as sentences, too many connections ' +
      'for the number of blocks. Call it after every edit — none of this is visible in the ' +
      'JSON. ERROR means the picture is visibly broken. Act on the report rather than ' +
      'summarising it back.',
    inputSchema: z.object({}),
  }, () => call('validate_diagram'));

  return server;
}

/**
 * Start the server, and say where it actually landed.
 *
 * The port is asked for rather than assumed: 7337 may be taken by another copy
 * of this app or by something else entirely, and a desktop app that refuses to
 * start because a port is busy is a bad desktop app. The real port is written
 * where the setup instructions can find it.
 */
export function startMcp(bridge: Bridge, { version = '0.0.0', port = DEFAULT_MCP_PORT } = {}) {
  const handler = createMcpHandler(() => buildServer(bridge, version));

  const serve = (on: number) =>
    Deno.serve({
      hostname: '127.0.0.1',
      port: on,
      onError: (err) => {
        console.error('massing mcp:', err);
        return new Response('internal error', { status: 500 });
      },
    }, (req) => {
      if (fromABrowser(req)) {
        return new Response('Refused: this endpoint is not for browsers.', { status: 403 });
      }
      return handler.fetch(req);
    });

  let server: Deno.HttpServer<Deno.NetAddr>;
  try {
    server = serve(port);
  } catch (err) {
    if (!(err instanceof Deno.errors.AddrInUse)) throw err;
    console.error(`massing mcp: ${port} is taken, taking whatever is free instead`);
    server = serve(0);
  }

  const actual = server.addr.port;
  return {
    port: actual,
    url: `http://127.0.0.1:${actual}/`,
    stop: () => server.shutdown(),
  };
}
