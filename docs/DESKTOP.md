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
npm run desktop:dev      # run it, with the tree watched
npm run desktop          # build the installers
npm run test:desktop     # start it, drive it as a CLI would, stop it
npm run test:rust        # the config-writing tests
```

A **Rust toolchain** and the Tauri CLI (`cargo install tauri-cli`). On Windows
that also means the MSVC build tools and the WebView2 runtime, which ships with
Windows 11. The web app itself still needs nothing.

`npm run desktop:dev` is the one to develop against: it builds, opens the
window and watches the tree. A debug build serves the editor straight out of
the repo, so an edit to `src/` is a reload rather than a rebuild.

`npm run desktop` writes the installers to
`desktop/src-tauri/target/release/bundle/`. The app is about 10 MB, because it
uses the operating system's own webview rather than shipping a browser with it.

### What it is allowed to do

Tauri gates capabilities per plugin, and the app takes two: the file dialog and
the updater. Everything else it does — serving loopback, reading and writing
the path you chose, watching its directory — is ordinary Rust.

| Variable | Default | Meaning |
|---|---|---|
| `MASSING_MCP` | on | `off` disables the MCP server entirely |
| `MASSING_MCP_PORT` | `7337` | where MCP listens; if taken, any free port is used |
| `MASSING_RELEASES` | unset | the update channel; unset means no updating |
| `MASSING_RELEASE_KEY` | unset | the Ed25519 public key releases are signed with |

## Connecting a CLI

**Press the ⇄ button in the toolbar.** It lists the agents it can find, writes
the right entry into each one's config, and tells you to restart anything that
was already running. That is the whole setup.

It reads each file, adds or replaces the one entry named `massing`, and writes
everything else back exactly as it was — with the previous version saved beside
it as `<name>.massing-backup`. Your own settings survive, and pressing it again
after the port changes replaces the entry rather than adding a second.

| Agent | What it writes |
|---|---|
| Claude Code | `~/.claude.json` → `mcpServers.massing = { type: "http", url }` |
| Codex | `~/.codex/config.toml` → `[mcp_servers.massing]` |
| Antigravity | `~/.gemini/config/mcp_config.json` → `mcpServers.massing.serverUrl` |

### By hand

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

A GUI process has no usable stdin or stdout, so the app cannot be a stdio MCP
server. HTTP is the transport, which is also the one every CLI here supports.

Binding to loopback is not access control — any page in any browser on this
machine can post to `127.0.0.1:7337`. So requests arriving with a browser
`Origin` are refused; MCP clients send none. If you would rather have no
listener at all, `MASSING_MCP=off`.

---

## Updating, signing and releases

Three separate things, and they are worth keeping apart because only the first
one is required and only the first one is free.

### 1. The updater signature — required

Tauri will not install an update it cannot verify, so the channel needs an
Ed25519 keypair of its own. This has nothing to do with Windows or Apple; it is
Tauri checking that the bundle came from you.

```sh
cargo tauri signer generate -w ~/.massing-updater.key
```

That prints a **public** key and writes a **private** one. Put the public half
in `tauri.conf.json` under `plugins.updater.pubkey` and commit it — it is
public. Put the private half and its password in repository secrets, and
nowhere else:

| Secret | What it is |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the contents of the generated key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password you gave it |

**Until `pubkey` is filled in the app does not check for updates at all**, and
says so on startup. That is deliberate: without a key, anything that can answer
for the release host — a redirect, a stale CDN entry, a hostile network — could
hand the app a bundle to install. Losing the private key means shipping a new
public key in a new release and every older install stops updating, so treat it
like a signing key, because it is one.

### 2. Releases from GitHub Actions — already wired

`.github/workflows/desktop.yml` builds all four targets on tagged pushes and
attaches the bundles to a draft release, along with `latest.json`. That file is
generated by `includeUpdaterJson: true`, carries the signature of each bundle,
and is exactly what `plugins.updater.endpoints` points at:

```
https://github.com/yejun614/Massing/releases/latest/download/latest.json
```

`latest` rather than a version, so an app three releases behind finds the
newest one rather than the next one.

To cut a release: bump `version` in `tauri.conf.json`, tag, push the tag.

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The release is created as a **draft**, so nothing reaches anybody until it is
published by hand — and `latest.json` is only served once it is. Pushes that
are not tags upload the bundles as build artifacts and create no release.

`MASSING_RELEASES` overrides the endpoint at runtime for testing against a
staging channel. The key is never overridable, which is the point of it.

### 3. OS code signing — optional, and it costs money

Independent of the above, and only about the warning a user sees the first time
they run the app.

| | What it needs | Without it |
|---|---|---|
| **Windows** | an Authenticode certificate, or Azure Trusted Signing | SmartScreen warns until the download builds reputation |
| **macOS** | Apple Developer ID (99 USD/yr) plus notarisation | Gatekeeper refuses to open it without a right-click |
| **Linux** | nothing | nothing |

Both plug into the same workflow through environment variables —
`WINDOWS_CERTIFICATE`, or `APPLE_CERTIFICATE`, `APPLE_ID` and
`APPLE_PASSWORD` — and `tauri-action` picks them up without further changes
here. The updater works whether or not any of this is done.

**This is deliberately not done yet**, so releases are unsigned as far as the
operating system is concerned. That is a decision about money, not about
safety — the bundles are still signed for the updater — but it has a
consequence worth putting in the release notes rather than leaving people to
discover:

> **Windows** — SmartScreen shows "Windows protected your PC". *More info* →
> *Run anyway*. The warning fades as more people install the same build.
>
> **macOS** — Gatekeeper refuses a double-click. Right-click the app → *Open*,
> then *Open* again; or `xattr -dr com.apple.quarantine /Applications/Massing.app`.
>
> **Linux** — nothing to do.

The updater is unaffected on all three: it verifies its own signature and does
not consult the OS.

---

## Things worth knowing

- **Tauri's IPC is deliberately not used.** The editor is served over loopback
  so the shim can be injected as a module script *ahead of* `src/main.js` —
  that ordering is the whole reason `src/core/io.js` needs no desktop code path
  at all. Once there is a served document there is also a server, and one
  channel is better than two. It has the side benefit that every interaction
  can be driven with `curl` against a running app, which is how the tests
  check it.
- **The dialogs come from `tauri-plugin-dialog`**, not from the webview. The
  browser's own File System Access API deliberately hides the path behind a
  handle, and the path is what the watcher and the MCP setup are built on.
- **Deep links are not wired up yet.** "Open this `.arch.json` with Massing" is
  a plugin away and simply has not been done.

## How it fits together

```
  CLI ──MCP/HTTP──▶ :7337 ─┐
                           ├─▶ Tauri (Rust) ──SSE──▶ window ──▶ the document
  window ──fetch──▶ :auto ─┘        │                  ▲
                                    └── watchFs ───────┘
  other editor ──writes .arch.json──┘
```

| File | Does |
|---|---|
| `src-tauri/src/lib.rs` | starts the servers in the order that matters, builds the window |
| `src-tauri/src/server.rs` | serves the editor and `/__massing/*` |
| `src-tauri/src/bridge.rs` | the push channel, and the ask/settle pair the tools ride on |
| `src-tauri/src/files.rs` | native dialogs, and the watcher |
| `src-tauri/src/mcp.rs` | the MCP server and its four tools |
| `src-tauri/src/setup.rs` | registering with the CLIs, and the tests for it |
| `src-tauri/src/update.rs` | the update channel |
| `src-tauri/src/window.rs` | the menu, the theme, the port file |
| `desktop/web/shim.js` | the page's half: the file-picker shim, and the tool bodies |
