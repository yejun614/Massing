/**
 * Registering this app with the CLIs, so nobody has to read the docs.
 *
 * Three coding agents, three unrelated config formats, one of which is TOML
 * and one of which uses a key name nobody would guess. That is a page of
 * instructions to follow correctly on a first run, and the reward for getting
 * it wrong is a tool that silently is not there.
 *
 * **Nothing here overwrites a file.** Each target is read, the one entry this
 * app owns is added or replaced, and everything else is written back exactly
 * as it was — with a `.massing-backup` copy left beside it first. These are
 * files people have their own work in; a setup button that flattened somebody's
 * Codex config would be a far worse bug than the manual instructions it
 * replaced.
 */

const HOME = Deno.env.get('USERPROFILE') ?? Deno.env.get('HOME') ?? '';

/** The name this app registers itself under, everywhere. */
export const SERVER_NAME = 'massing';

export type Target = {
  id: string;
  label: string;
  /** Where its configuration lives, spelled for a human. */
  path: string;
  /** Present means the CLI has been run at least once. */
  found: boolean;
  /** Already pointing at a Massing server, whatever the port. */
  registered: boolean;
  /** Set when this one cannot be written and why. */
  problem?: string;
};

const join = (...parts: string[]) => parts.filter(Boolean).join('/');

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function read(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

/**
 * Write, having first put the old copy somewhere safe.
 *
 * One backup, overwritten each time rather than accumulating: the point is to
 * be able to undo *this* button, and a directory filling with dated copies of
 * a config file is its own kind of mess.
 */
async function writeSafely(path: string, text: string) {
  const previous = await read(path);
  if (previous !== null) await Deno.writeTextFile(`${path}.massing-backup`, previous);
  const at = path.lastIndexOf('/');
  if (at > 0) await Deno.mkdir(path.slice(0, at), { recursive: true });
  await Deno.writeTextFile(path, text);
}

// ---------------------------------------------------------------------------
// Claude Code — ~/.claude.json, a large file with a lot of unrelated state
// ---------------------------------------------------------------------------

const claudePath = () => join(HOME, '.claude.json');

/**
 * Claude Code's config is also its scratch state — projects, history, flags.
 * It is read, one key is set, and it goes back out whole. `claude mcp add`
 * would do the same thing, but only if the CLI is on the path of a GUI process
 * that inherited its environment from the desktop session, which is exactly
 * the case where it is not.
 */
async function claudeEntry(url: string) {
  const text = await read(claudePath());
  const config = text ? JSON.parse(text) : {};
  config.mcpServers ??= {};
  config.mcpServers[SERVER_NAME] = { type: 'http', url };
  return `${JSON.stringify(config, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Codex — ~/.codex/config.toml
// ---------------------------------------------------------------------------

const codexPath = () => join(HOME, '.codex', 'config.toml');

/**
 * TOML, edited as text.
 *
 * A parser and a serialiser would be a dependency and would also reformat
 * every line of a file somebody wrote by hand. The section this app owns is
 * found by its header and replaced up to the next header; if it is absent it
 * is appended. Comments, ordering and spacing everywhere else survive
 * untouched, which a round trip through a TOML library would not guarantee.
 */
function codexSection(url: string) {
  return `[mcp_servers.${SERVER_NAME}]\nurl = "${url}"\n`;
}

async function codexEntry(url: string) {
  const text = (await read(codexPath())) ?? '';
  const header = `[mcp_servers.${SERVER_NAME}]`;
  const start = text.indexOf(header);
  if (start < 0) {
    const spacer = text.length === 0 || text.endsWith('\n\n')
      ? ''
      : text.endsWith('\n')
      ? '\n'
      : '\n\n';
    return `${text}${spacer}${codexSection(url)}`;
  }
  // Up to the next top-level or nested header, whichever comes first.
  const rest = text.slice(start + header.length);
  const next = rest.search(/^\s*\[/m);
  const tail = next < 0 ? '' : rest.slice(next);
  return `${text.slice(0, start)}${codexSection(url)}${tail ? `\n${tail}` : ''}`;
}

// ---------------------------------------------------------------------------
// Antigravity — ~/.gemini/config/mcp_config.json
// ---------------------------------------------------------------------------

const antigravityPath = () => join(HOME, '.gemini', 'config', 'mcp_config.json');

/** `serverUrl`, not `url`: the other spellings are documented as not read. */
async function antigravityEntry(url: string) {
  const text = await read(antigravityPath());
  const config = text ? JSON.parse(text) : {};
  config.mcpServers ??= {};
  config.mcpServers[SERVER_NAME] = { serverUrl: url };
  return `${JSON.stringify(config, null, 2)}\n`;
}

// ---------------------------------------------------------------------------

const TARGETS = [
  { id: 'claude', label: 'Claude Code', path: claudePath, build: claudeEntry },
  { id: 'codex', label: 'Codex', path: codexPath, build: codexEntry },
  { id: 'antigravity', label: 'Antigravity', path: antigravityPath, build: antigravityEntry },
];

/** Whether a config already names a Massing server, at any port. */
function mentionsUs(text: string | null): boolean {
  if (!text) return false;
  return new RegExp(`["\\[.]${SERVER_NAME}["\\]]?`).test(text);
}

/** What is on this machine, and what state it is in. Reads only. */
export async function surveyTargets(): Promise<Target[]> {
  const out: Target[] = [];
  for (const target of TARGETS) {
    const path = target.path();
    const text = await read(path);
    out.push({
      id: target.id,
      label: target.label,
      path,
      // A config file is the only evidence available that a CLI is installed;
      // the binary may be anywhere, and a GUI process does not reliably
      // inherit the shell's PATH to go looking.
      found: text !== null || (await exists(path.slice(0, path.lastIndexOf('/')))),
      registered: mentionsUs(text),
    });
  }
  return out;
}

/**
 * Register with the chosen targets.
 *
 * Each one is independent: a malformed Codex file must not stop Claude Code
 * being set up, so a failure is recorded against that target and the rest
 * carry on.
 */
export async function registerWith(ids: string[], url: string): Promise<Target[]> {
  const done: Target[] = [];
  for (const target of TARGETS) {
    if (!ids.includes(target.id)) continue;
    const path = target.path();
    try {
      await writeSafely(path, await target.build(url));
      done.push({ id: target.id, label: target.label, path, found: true, registered: true });
    } catch (err) {
      done.push({
        id: target.id,
        label: target.label,
        path,
        found: true,
        registered: false,
        problem: String((err as Error).message ?? err),
      });
    }
  }
  return done;
}
