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
| `MASSING_RELEASES` | from `tauri.conf.json` | overrides the update channel, for testing against a staging one |
| `MASSING_RELEASE_KEY` | unset | the Ed25519 public key releases are signed with |
| `MASSING_STATE` | the OS data directory | where `updates.json` and `mcp.json` are kept; a throwaway one makes a skipped version forgettable |

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

- **Windows** `%LOCALAPPDATA%\massing\mcp.json`
- **macOS** `~/Library/Application Support/massing/mcp.json`
- **Linux** `$XDG_DATA_HOME/massing/mcp.json`, or `~/.local/share/massing/mcp.json`

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

### 0. Nothing installs until somebody says so

A check **offers**; it never installs. Finding a new version raises a dialog
with three answers, and each of them is a different decision:

| | Does |
|---|---|
| **Update** | downloads and installs it now |
| **Skip this version** | writes that version into `updates.json` in the app's state directory, and the launch check stops raising it. The Help menu still offers it — somebody who went looking is not being interrupted |
| **Remind me later** | decides nothing; the next launch asks again |

This used to be one step: the launch check installed whatever it found. On
Windows that is not a background task at all — `download_and_install` hands the
bundle to `ShellExecute` and calls `exit(0)`, so the app someone had just
opened vanished and an installer they had not asked for appeared in its place.
Everything after that point belongs to the installer, which also means nothing
after that point can be reported by Massing when it goes wrong: the process
that would have shown the error is already gone.

The dialog says which of the two things installing means on this platform,
because they are not the same — Windows closes and reopens the app around the
installer, everywhere else the bundle is swapped underneath and the new version
is what starts next time.

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
| `TAURI_SIGNING_PRIVATE_KEY` | the **whole** generated key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password you gave it |

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY --env Production < massing.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --env Production
```

They live on the **`Production` environment**, not on the repository, which is
why the build job carries `environment: Production`. A job that does not name
an environment sees environment secrets as empty strings — no warning, no
error, just a blank where the key should be. Repository secrets would work
too, and would need that line removed.

The key file is two lines and **both** are part of it — the first is an
`untrusted comment:` line that minisign requires. Pasting only the base64
produces this, five minutes into a build:

```
failed to decode secret key: incorrect updater private key password:
Missing comment in secret key
```

That message names the password and means the key. An empty secret gives the
same error for the same reason: no comment line to find. There is no length or
character restriction on the password — it travels as an environment variable
and never touches a shell.

**Until `pubkey` is filled in the app does not check for updates at all**, and
says so on startup. That is deliberate: without a key, anything that can answer
for the release host — a redirect, a stale CDN entry, a hostile network — could
hand the app a bundle to install.

#### Back the private key up before the first release

Losing it cannot be undone by generating another one. The public key is baked
into every installed binary at build time, so a release signed with a new key
fails verification on every copy already out there, and those copies can never
auto-update again — the only way back is for each person to download and
reinstall by hand. There is one `pubkey` field and no rotation mechanism.

An installed app that hits this now says so, in a toast, instead of failing
silently for ever. That is a consolation, not a fix.

Right now there are no releases, so losing the key costs nothing. That will
never be true again, which makes this the moment to put it somewhere safe.

### 2. Releases from GitHub Actions — already wired

`.github/workflows/desktop.yml` runs **on tags only** — a push to `main` builds
nothing. Six targets on a tagged push, and it
attaches the bundles to a draft release, along with `latest.json`.

| Target | Runner | Produces |
|---|---|---|
| `aarch64-apple-darwin` | macos-14 | `.app`, `.dmg` |
| `x86_64-apple-darwin` | macos-15-intel | `.app`, `.dmg` |
| `x86_64-pc-windows-msvc` | windows-latest | NSIS installer |
| `aarch64-pc-windows-msvc` | windows-11-arm | NSIS installer |
| `x86_64-unknown-linux-gnu` | ubuntu-latest | `.deb`, `.rpm`, AppImage |
| `aarch64-unknown-linux-gnu` | ubuntu-24.04-arm | `.deb`, `.rpm`, AppImage |

Both arm64 targets build on arm64 runners rather than cross-compiling. On Linux
that would need an arm64 toolchain and arm64 WebKitGTK headers through
multiarch; on Windows the Rust half cross-compiles cleanly and the WebView2 and
NSIS halves are where it stops being worth it. Either way the result would be a
bundle no machine in the matrix had run.

GitHub's arm64 runners — `ubuntu-24.04-arm` and `windows-11-arm` — are free on
public repositories and billed on private ones. That is the one thing worth
checking before this matrix doubles somebody's bill.
 That file is
generated by `includeUpdaterJson: true`, carries the signature of each bundle,
and is exactly what `plugins.updater.endpoints` points at:

```
https://github.com/yejun614/Massing/releases/latest/download/latest.json
```

`latest` rather than a version, so an app three releases behind finds the
newest one rather than the next one.

The manifest gets a job of its own because it is the one asset every build
would otherwise write. `includeUpdaterJson: true` had each of the six download
it, merge its platform in and upload it back; on v0.1.1 two jobs lost that race
and the surviving manifest listed four platforms out of six. Every installer
was present and correct, and x86_64 Linux and arm64 Windows would simply never
have been offered the update.

`scripts/updater-manifest.mjs` composes it from the finished release and
**refuses to write a partial one** — a manifest missing a platform is worse
than no manifest, because the release looks complete. It runs by hand too:

```sh
node scripts/updater-manifest.mjs v0.1.1            # dry run
node scripts/updater-manifest.mjs v0.1.1 --write
gh release upload v0.1.1 latest.json --clobber
```

The build job carries `permissions: contents: write`, because this repository's
default workflow token is read-only. Without it every job builds for minutes
and then fails on its last step with `Resource not accessible by integration`,
which names neither the permission nor the setting.

The URLs inside `latest.json` are **built from the tag**, not read from the
API. This job runs against a release that is still a draft, and a draft has no
tag — GitHub answers `browser_download_url` with
`/releases/download/untagged-<hash>/…`, which is a real URL until somebody
presses Publish and every one of them turns into a 404. That made the manifest
a race with a human: v0.1.4 happened to be published a minute before this job
finished and was fine, v0.1.5 was published eight minutes after and shipped six
dead links, so every installed copy found the update and downloaded nothing.
The published form is knowable without asking, so it is written rather than
copied, and the script refuses to save a manifest whose URLs do not name the
tag.

`workflow_dispatch` runs the same six builds without creating a release, which
is how to exercise the bundling before committing to a tag. Pull requests get
`check` and nothing heavier.

To cut a release:

```sh
npm run release -- 0.1.2 --push
```

That sets the version in all three places it lives — `tauri.conf.json` for the
app and the updater, `Cargo.toml` for the version the MCP server reports, and
`package.json` — then commits, tags and pushes. It refuses on a dirty tree, on
a tag that exists, and off `main`, because a release is public the moment it
happens.

Without `--push` it stops after the tag and prints the two commands.

The `--` is npm's, not the script's: without it npm keeps `--push` for itself
and the script is called with the version alone. The script reads npm's
environment as well, so `npm run release 0.1.2 --push` also pushes — but the
separator is the form that works whatever is running it.

CI checks the same thing from the other side: a tagged build fails immediately
if the tag and `tauri.conf.json` disagree. They come from different places —
the app's version is compiled in, the manifest's comes from the tag — and an
app comparing the wrong two numbers either never updates or updates to
itself.

By hand, if you would rather:

```sh
git push origin main          # starts nothing; the tag is what builds
git tag v0.2.0
git push origin v0.2.0
```

The release is created as a **draft**, so nothing reaches anybody until it is
published by hand — and `latest.json` is only served once it is. Pushes that
are not tags upload the bundles as build artifacts and create no release.

Publishing is also what puts the build in front of anyone using the web app:
its toolbar has a download button, and the sheet behind it reads the newest
**published** release from the GitHub API and offers the file for the system
you are on. The filenames are matched by pattern in `src/data/downloads.js`, so
a bundler upgrade that renames `_x64-setup.exe` would leave that sheet saying
"not in this release" — the suite checks the patterns against a real release's
asset list to catch exactly that.

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

## The Help menu

**Check for updates** answers either way — the offer dialog, "0.1.2 is the
latest version", or what went wrong reaching the channel. The automatic check
at launch stays quiet when there is nothing to report, because an app that says
"no update" every morning is a nuisance; the cost of that silence is that a
working channel and a broken one look identical, and this is how you tell them
apart. It is also the one route that ignores a skipped version.

**About Massing** shows the version the running binary actually reports, plus
the platform, the Tauri version and the MCP endpoint. Everything in it is read
from the app at runtime rather than written into the page, because a version
number somebody forgot to bump is worse than none.

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
| `src-tauri/src/update.rs` | the update channel, and the skipped version |
| `src-tauri/src/window.rs` | the menu, the theme, the port file |
| `desktop/web/shim.js` | the page's half: the file-picker shim, and the tool bodies |
| `desktop/web/update-ui.js` | the offer dialog: update, skip this version, or later |
