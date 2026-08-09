# The desktop app

Massing as a local application, so the model you already pay for can draw in
it. The web app and the [hosted features](VERCEL.md) are unchanged and unaware
of any of this.

Three things a browser cannot do, and they are the whole reason it exists:

- **An MCP server**, so Claude Code, Codex or Antigravity can read and change
  the diagram on screen — no second API key, no copy-paste.
- **A file watcher**, so a diagram edited by anything else appears at once.
- **Native Save and Export dialogs**, so a file goes where you chose.

---

## Running it

```sh
deno task dev            # run it, with the tree watched
deno task desktop        # build it → dist/desktop/
deno task dev:browser    # run it as a plain server, no window
deno task test:desktop   # start it, drive it as a CLI would, stop it
```

Deno **2.9 or newer** — `deno desktop` does not exist before that.

`deno task dev` is the one you want: `--hmr` compiles into a cache, opens the
window, and watches the tree, so an edit does not cost a rebuild. The first run
takes a while — it downloads the runtime and the webview backend — and later
ones start in a couple of seconds.

`deno task desktop` **compiles and does not run.** It produces a bundle under
`dist/desktop/`; the launcher inside it is what you start. It is around 80 MB,
almost all of it the Deno runtime and the webview backend, and `--compress`
shrinks the distributed copy at the cost of a one-off unpack on first launch.

`dev:browser` opens no window at all. It runs the same program as a plain
loopback server and prints a URL, which is the only way to get DevTools — the
webview backend has none.

### When a build says "access denied"

`laufey_webview.exe` is the process that owns the window, and it **outlives its
parent**. Kill `deno` from a terminal rather than closing the window and it
stays behind holding the compiled `Massing.dll` open, so the next build fails
with `os error 5` on a path under `AppData\Local\deno\desktop`. Close the
window, or:

```powershell
Get-Process -Name laufey_webview | Stop-Process -Force
```

### What it is allowed to do

The permissions are fixed when the binary is built and it can never ask for
more:

| Permission | What for |
|---|---|
| `--allow-read` | serving `index.html`, `src/`, `styles/`; reading the diagram you opened |
| `--allow-write` | saving and exporting to the path you chose |
| `--allow-net` | the loopback server and the MCP port. It never binds to a public interface |
| `--allow-run` | the operating system's file dialog, and nothing else |
| `--allow-env` | the four `MASSING_*` variables below |

| Variable | Default | Meaning |
|---|---|---|
| `MASSING_PORT` | `8123` | the editor's port, when run as a plain server |
| `MASSING_MCP` | on | `off` disables the MCP server entirely |
| `MASSING_MCP_PORT` | `7337` | where MCP listens; if taken, any free port is used |
| `MASSING_RELEASES` | unset | the auto-update channel; unset means no updating |
| `MASSING_RELEASE_KEY` | unset | the Ed25519 key releases are signed with |

---

## Connecting a CLI

The app serves MCP over Streamable HTTP at `http://127.0.0.1:7337/`. If that
port was taken it took another one and wrote it down — the running app's real
URL is always in:

- **Windows** `%APPDATA%\massing\mcp.json`
- **macOS / Linux** `$XDG_STATE_HOME/massing/mcp.json`, or
  `~/.local/state/massing/mcp.json`

**Claude Code**

```sh
claude mcp add --transport http massing --scope user http://127.0.0.1:7337/
```

**Codex** — `~/.codex/config.toml`

```toml
[mcp_servers.massing]
url = "http://127.0.0.1:7337/"
```

**Antigravity** — `~/.gemini/config/mcp_config.json`. Note the key is
`serverUrl`; `url` and `httpUrl` are not read, and a project-local config is
[reportedly ignored](https://github.com/google-antigravity/antigravity-cli/issues/60),
so put it in your home directory.

```json
{ "mcpServers": { "massing": { "serverUrl": "http://127.0.0.1:7337/" } } }
```

Then, with a diagram open:

> Read the diagram, then add a Redis cache between the API and the database.

### The tools

The same four the editor's own assistant has, and deliberately so — a document
written by Claude Code should meet the same loader, and the same complaints, as
one written in the panel.

| Tool | Does |
|---|---|
| `get_diagram` | the drawing on screen, as `.arch.json` |
| `replace_diagram` | replaces it with a complete document. Undoable in the editor |
| `add_tab` | a second drawing beside the first, in the same file. Capped at eight |
| `validate_diagram` | the readability checks — hidden blocks, buried connections, captions written as sentences, too many connections |

**They act on the window, not on a file.** So they work on a diagram that has
never been saved, they land in the same undo stack as an edit made by hand, and
you watch the change happen. A CLI that would rather just write the
`.arch.json` can do that instead — the watcher picks it up.

The tools cannot create or delete files, and cannot reach a drawing in a tab
you are not looking at. The file is yours.

### Why HTTP, and what guards it

A Deno Desktop binary is a GUI process with no usable stdin or stdout, so it
cannot be a stdio MCP server. HTTP is the only transport available from inside
the app.

Binding to loopback is not access control — any page in any browser on this
machine can post to `127.0.0.1:7337`. So requests arriving with a browser
`Origin` are refused; MCP clients send none. If you would rather have no
listener at all, `MASSING_MCP=off`.

---

## Updating

`deno.json` carries the version. Set `MASSING_RELEASES` to the base URL of a
channel and `MASSING_RELEASE_KEY` to the public half of the Ed25519 key it is
signed with, and the app checks once a day, downloads a binary diff against the
version running, and stages it for the next launch. Nothing is swapped under a
running editor.

Unsigned updating is not offered. Without a key, anything that can answer for
the release host — a redirect, a stale CDN entry, a hostile network — could
hand the app a patch to run on next launch.

A channel is `latest.json` plus one `bsdiff` patch per version you support
upgrading from:

```json
{
  "version": "0.2.0",
  "patches": {
    "0.1.0": { "name": "patch-0.1.0-to-0.2.0.bin", "sha256": "…" }
  }
}
```

**On Windows the update downloads and stages and then stops.** Applying a
staged update and rolling back a failed launch are macOS and Linux only in Deno
Desktop today, so the app does not pretend otherwise: on Windows updating is
switched off and says so, and new versions are a manual download until Deno
closes that gap.

---

## The window looks wrong, and here is exactly how

Two cosmetic faults are left, both in the `webview` backend, all of this
measured rather than guessed. Neither affects what the app does.

| | `webview` (default, ~80 MB) | `cef` (~478 MB) |
|---|---|---|
| Window title | **`M`** | `Massing` |
| Application icon | **none** | correct |
| Title bar in dark mode | follows the editor | follows the editor |

**The title is one letter** because Deno Desktop names the window from
`desktop.app.name` and something on the way there reads a UTF-16 string as a C
string: `Massing` stops at the NUL byte after `M`. A spike app named `spike`
came out as `s`, which is the same bug from the other end. Three fixes were
tried, all measured: setting `document.title` from the page does not reach the
frame; there is no window object to call a setter on, because
`Deno.BrowserWindow` blocks; and `user32!SetWindowTextW` on the real window
handle **returns 1 and is then ignored** — read the title straight back and it
is still `M`. The backend's window proc takes the message and discards it, so
there is nothing left to try from outside.

**The icon is missing** because neither `desktop.app.icons` nor `--icon`
reaches a `webview` build — searching the 89 MB output for the icon's bytes
finds nothing. The same flags work on `cef`, which writes an `AppIcon.ico`
beside the binary. `desktop/icon.ico` is generated and committed either way, so
this fixes itself the day the backend honours it.

**The title bar now follows the editor.** This one is fixed. The frame is drawn
by Windows and has to be asked with `DwmSetWindowAttribute`, which needs a
window handle — so `desktop/win32.ts` finds the window by the name it already
has and asks. It follows the *editor's* theme rather than the system's, because
the theme button cycles system → light → dark and the forced settings are
exactly where the two disagree.

It is off under `deno task dev`, which sets `MASSING_FRAME=off`: the same FFI
calls in an `--hmr` build take the process down, while in an ordinary build
they are fine. A dev task that crashes is not worth a matching title bar.

Switching to `cef` is one line in `deno.json` (`"backend": "cef"`) and costs
about 400 MB per install for a correct title and icon. The default stays
`webview` because the trade did not look worth it, but it is yours to make.

## Things worth knowing

- **`Deno.BrowserWindow` is not used.** It blocks for ever on Windows under
  Deno 2.9.5, from module scope and equally from a later task, so there is no
  window object and therefore no `win.bind()` and no native menu bar. The
  runtime makes its own window; the loopback server is the only handle. The
  page calls the runtime with `fetch` and the runtime calls the page over an
  `EventSource`, which has the side benefit that every interaction can be
  driven with `curl` against a running app.
- **No native menu bar**, for the same reason. Every command is on the toolbar
  and on a keyboard shortcut, which is where they were already.
- **The dialogs are subprocesses** — PowerShell, `osascript`, `zenity` —
  because Deno Desktop has no picker yet and the system webviews on macOS
  (WKWebView) and Linux (WebKitGTK) do not implement the browser's. If no
  dialog can be shown, saving falls back to a download rather than failing.
- **Deep links are not wired up.** Schemes can be registered but Deno Desktop
  cannot yet deliver the opened URL to running code, so "open this file with
  Massing" waits on that.

## How it fits together

```
  CLI ──MCP/HTTP──▶ :7337 ─┐
                           ├─▶ Deno runtime ──SSE──▶ window ──▶ the document
  window ──fetch──▶ :auto ─┘        │                  ▲
                                    └── watchFs ───────┘
  other editor ──writes .arch.json──┘
```

| File | Does |
|---|---|
| `desktop/main.ts` | starts the servers in the order that matters, wires the rest |
| `desktop/serve.ts` | serves the editor, injecting the meta tag and the shim |
| `desktop/bridge.ts` | `/__massing/*` — dialogs, read, write, watch, and the push channel |
| `desktop/files.ts` | native dialogs, and the watcher |
| `desktop/mcp.ts` | the MCP server and its four tools |
| `desktop/update.ts` | the update channel |
| `desktop/web/shim.js` | the page's half: the file-picker shim, and the tool bodies |
