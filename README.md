# Massing

An isometric architecture diagram editor that runs in the browser.

In architecture, a **massing model** is the study that stands a building up as
plain blocks — a footprint and a height each, no detail yet — to see whether
the whole thing holds together. A system diagram is the same exercise, so the
editor works the same way: every service is a block on an integer grid, and its
height is how much it weighs in the design.

Three constraints shaped everything here:

- **No backend.** Static files only. Diagrams are real files on your disk.
- **Diagrams are text.** The `.arch.json` format is meant to be read, written and
  diffed by people *and* language models. That is a primary requirement, not an
  export feature.
- **No framework.** No React, Vue or Svelte; no bundler; zero npm dependencies.
  Rendering, state and input are all written directly against the DOM.

The third one is about `src/`, and it is exact rather than aspirational:
`grep npm: src/` is empty and the bundle you can email has nothing in it that
was not written here. The [desktop app](docs/DESKTOP.md) has two dependencies —
the MCP SDK and the schema library under it — and they stop at `desktop/`. The
editor does not know that shell exists.

## Running it

```sh
python -m http.server 8123        # or any static server
# → http://localhost:8123
```

Nothing to install. `npm run dev` does the same thing if you prefer.

```sh
node test/run.mjs                 # geometry + document suite
node build.js                     # → dist/index.html, plus the Claude skill
node build.js --doc my.arch.json   # the same, with a diagram baked in
node build.js --font Pretendard.woff2   # inline the font: no network at all
MASSING_VERCEL_FEATURES=1 node build.js  # the hosted build (off by default)
npm run dev:hosted                # the hosted build locally, real API handlers
```

`test/iso.test.html` runs the identical suite in a browser, which also proves
the modules load unbundled.

### On Deno, and on the desktop

The same two scripts run under Deno, which is what the desktop build needs.

```sh
deno task test                    # the identical suite
deno task build                   # a byte-identical dist/index.html
deno task desktop                 # → dist/desktop/, the app
deno task desktop:dev             # the app as a plain server, with DevTools
deno task test:desktop            # start it, drive it as a CLI would, stop it
```

The desktop app is the editor with three things a browser cannot give it: an
MCP server, so Claude Code or Codex can draw in the diagram you are looking at;
a watcher, so a file edited elsewhere appears at once; and native Save and
Export dialogs. See [DESKTOP.md](docs/DESKTOP.md).

Both runtimes are supported rather than one replacing the other, because the
two ends of this project disagree: the desktop build is Deno, and Vercel builds
with `node build.js` and runs `api/` on Node's `(req, res)` handlers. Keeping
`build.js` and `test/run.mjs` to what both runtimes agree on costs one import
(`node:buffer`) and means neither end is checked by a script the other never
runs.

## Using it

| | |
|---|---|
| Place a block | Click a component in the left panel, then click the canvas (Shift keeps it armed) |
| Move | Drag. Dragging a zone moves everything inside it |
| Resize | Select one thing, then drag a grip. A block gets an extra grip above it for its height |
| Connect | `C`, then drag from one block or zone to another |
| Re-route a connection | Select it and drag the grip on the run it turns on |
| Draw a zone | `G`, then drag a rectangle |
| Add a note | Double-click bare canvas, or `T` then click |
| Rename anything | Double-click it — the caret lands in its caption, whether that is a block, a zone, a connection or a note |
| Edit many at once | Select several and the inspector offers what they have in common — caption size and plane, footprint, height, line style, note styling, placement |
| Add a picture | The picture button, or drag an image file onto the canvas, or paste a screenshot |
| Several drawings in one file | The `+` on the tab strip in the bottom-left corner. Drag a tab to reorder, or click the tab you are on to rename, duplicate or delete it |
| Tidy | `A` — nudge blocks apart until nothing is hidden, keeping your layout |
| Auto layout | `Shift+A` — re-flow the whole diagram from its connections |
| Rotate the view | `Q` / `E` |
| 2D / 3D | `2` |
| Pan | `H` for the pan tool, or Space + drag / middle-drag from any tool |
| Find a component | The search box at the top of the left panel |
| Light / dark | The theme button cycles system → light → dark |
| Resize the panels | Drag either panel edge; double-click to reset, arrow keys when focused |
| Hide a panel | `[` / `]`, or the two buttons beside the logo. A narrow window folds them away on its own |
| Reload from disk | `R`, or the refresh button — re-reads the open file after something else edited it, without moving the camera |
| Export an image | `Ctrl+E` — SVG, PNG, JPG, WebP or GIF, with or without the grid, isometric or 2D, at 1× to 4× |
| Share a diagram | The share button copies a link with the whole diagram inside it |
| Publish a diagram | Deployed builds only — stores it and hands back a short link |
| Ask for a change | Deployed builds only — the assistant edits the diagram, and undo works on what it does |
| Everything else | The `?` button in the toolbar |

### On a phone

**The toolbar stands on its end** as a rail down the left edge, and floats:
there is no panel behind it, so the diagram runs underneath and the screen
keeps the width it appears to have. A row of twenty-nine icons on a phone is
something you scroll through hunting; a column costs 52px of width instead of
56px of height, which is the cheaper trade in portrait, and it is under the
thumb already holding the phone. Six tools stay out — select, pan, connect,
undo, redo, delete — and the rest fold behind `⋯`, which pins itself to the
bottom while open so the way back is never scrolled away. **The two panel
toggles sit in the top-right corner**, opposite the zoom controls.

**Pan is the tool a finger starts with.** With a mouse, select-first is right;
a touchscreen has no wheel, no held space and no middle button, so select-first
means every attempt to look at the rest of the diagram lands on whatever was
under the thumb. Tap the arrow on the rail to select instead. **Two fingers pan
and pinch from any tool**, and **zoom sits in the bottom-right corner**.

The two panels stop being columns and become drawers over the canvas — a phone
cannot spare 232px for a palette *and* have somewhere left to draw. Picking a
component closes the palette on its own, since the next thing you do is press
the canvas it was covering; a drawer always leaves a strip of canvas beside it
to press to dismiss it. Grips are drawn larger and withheld from shapes too
small to hold them, because four dots on the corners of a small block cover the
block and dragging it stops working.

Blocks belong to a zone by **geometry**: a block inside a VPC's rectangle is in
that VPC, and membership is recomputed whenever anything moves.

## Working with a language model

The toolbar's clipboard button copies the whole diagram as JSON. Selecting
blocks and pressing `Ctrl+C` copies just those, edges included. Both paste back
onto the canvas with `Ctrl+V`, whether the JSON came from this editor or from a
chat window.

To have a model produce a diagram, press the **sparkle button** in the toolbar.
It copies a self-contained prompt — grid rules, every component type, layout
advice — so pasting it into any chat and describing your system is enough to
get back a document this editor opens.

The same text is published as a Claude skill at
`.claude/skills/massing-diagram/SKILL.md`, generated from
[`src/data/prompt.js`](src/data/prompt.js) on every build so the button, the
file and the skill cannot drift apart. There is also
[`docs/FORMAT.md`](docs/FORMAT.md) for humans and the formal
[`schema/arch-v1.schema.json`](schema/arch-v1.schema.json).

### Watching the file change

If the model is editing the `.arch.json` on disk rather than handing you JSON in
a chat, press `R` (or the refresh button) to read it again. The camera stays
exactly where it is and the selection survives if its ids do, so you can keep
watching one corner of a diagram while it is rewritten underneath you.

Reloading is undoable like any other change, and pressing it when the file has
not actually changed does nothing at all — no undo entry, no lost selection — so
it is safe to lean on while waiting for a model to finish writing. If you had
unsaved edits, it says so and one click puts them back.

How well the button can see the file depends on where the page is running:

| | |
|---|---|
| Chrome or Edge, served over http (`npm run dev`) | Reads through the file handle. Works every time |
| Firefox | Re-reads the file you picked. Works every time |
| Chrome or Edge, opened from `file://` | Chrome invalidates its reference once the bytes change, so the button says so and offers to re-pick the file in one click |

The last row is a browser rule, not a choice: on a `file://` page the origin is
opaque and the File System Access API refuses to serve it at all. Serving the
folder is what makes the round trip seamless.

Loading is deliberately forgiving: unknown component types become plain blocks,
duplicate ids are renamed, edges pointing at missing nodes are dropped. Each
produces a warning rather than an error, so a diagram that is 95% right still
opens and tells you about the other 5%. The only hard failure is text that is
not JSON.

Saving is deterministic — fixed key order, two-space indent, short numeric
arrays kept on one line — so save → load → save is byte-identical and diffs
stay readable.

## Flat things in an isometric world

Text and pictures are both flat rectangles, so both are placed by the same four
fields: which **plane** they hang on (square to the viewer, lying on the ground,
or standing against either wall), a **spin** within that plane, an
**elevation**, and whether they sit **behind** the blocks. Captions take the
same treatment via `labelPlane`, on blocks, zones and connections alike — a
block's label can be written onto its own faces, a zone's onto the ground inside
it or standing along one of its far edges, a connection's flat along the line or
standing above it.

Most of it defaults to **lying on the ground**, which is what reads as part of
the scene rather than stuck on top of it. Zone captions are the exception — they
stand along a far edge, because a zone is large and usually full. `screen` is
one setting away when something has to stay square to the viewer, and
`labelSize` sets any caption's size in pixels.

All of it reduces to one 2×3 matrix. The projection is linear, so projecting a
*direction* is the same call as projecting a point, and every unit grid
direction projects to exactly `CELL` pixels — divide by `CELL` and you have a
unit screen vector. Local pixels stay local pixels, skewed but never rescaled,
which is why a 14px font is 14px along whichever plane it is on.

One correction is applied on top: orbiting the camera eventually brings you
round to the *back* of a wall, where the plane's axes wind the other way and
everything on it would draw as its own reflection. That is what the reverse of
a poster really looks like, but unreadable text is no use in a diagram, so the
in-plane direction is flipped. The flip is folded into the matrix as
`u → -u` with the origin walked along `u`, which mirrors about the element's
centre and so leaves its footprint exactly where it was. The tests assert both
halves: no plane ever has a negative determinant, and the anchor always remains
one of the element's corners.

Pictures are embedded as data URLs — a diagram that points at a file on
someone's disk breaks the moment it is shared. Imports are re-encoded to at
most 1400px and WebP before embedding, and the inspector shows what each one
weighs, because those bytes live in the document forever.

## Keeping things visible

An isometric view has one structural annoyance: a block hides whatever is
behind it, and connections drawn on the ground disappear under the blocks they
run past. Two commands deal with it, and both work on the selection when there
is one.

**Tidy** (`A`) keeps your arrangement and only nudges blocks *forward along the
depth axis* — straight down the screen, never sideways — until nothing is
covered. It is idempotent: pressing it twice does nothing the second time.

**Auto layout** (`Shift+A`) re-flows the diagram from its connections: sources
on the left, each step of the flow one rank to the right, with crossings pulled
out by barycentre ordering. Each zone is laid out in its own right, so
arranging never drags a block across a VPC boundary you put it inside.

Both rest on one piece of geometry. The screen position of a silhouette top is
`depth * (CELL/2) - height * CELL`, so a front block covers a back block's top
face exactly when

```
depthBack(front) - depthFront(back)  <  2 * (height(front) - height(back))
```

Which means a block that is **no taller** than the one behind it can never hide
it, at any distance — and a taller one needs exactly twice the height
difference in depth to clear. So the cure is not "spread everything out", it is
"put tall things at the back and pay depth only where you can't". Auto layout
exploits this directly: ranks advance along `(+1, -1)`, which is pure
screen-horizontal and changes depth not at all, so no rank can ever occlude
another.

Connections help themselves too: an elbow has two possible shapes, and the
renderer picks whichever passes through fewer blocks.

**Captions count as much as the blocks they belong to.** Once labels lie on the
ground, "the block is visible" is not the same as "the diagram is readable" — a
block one cell forward will happily sit on the caption behind it. So every
ground-level caption and note contributes a rectangle of its own, at height
zero, that the pass keeps clear. Caption width comes from a deterministic
estimate in `util/text.js` (CJK counted full-width), because the pass runs with
no text metrics available and its output has to be testable.

`countOccluded()` in `src/core/arrange.js` reports how many blocks *and
captions* are currently hidden; the tests assert it reaches zero at every camera
rotation, rather than merely asserting that something moved.

## Where the file goes

Served over `http://localhost` in Chrome or Edge, `Ctrl+S` writes **in place**
through a kept file handle — pick the file once, then every save overwrites it,
which is what lets you keep the same `.arch.json` open in a text editor or hand
it to a model alongside the editor.

Everywhere else it falls back to a normal download:

- **Firefox and Safari** have no File System Access API.
- **The bundled `dist/index.html` opened from `file://`.** Chrome exposes the
  picker there and it opens, but the origin is opaque, so the write is refused
  — so that path is skipped up front rather than failing after you have already
  chosen a filename.
- Permission declined, or the write refused for any other reason.

Opening works the same way in reverse, and both directions fall through rather
than dead-end: if the direct path is refused the editor says so and uses the
browser's plain file input or a download instead. The only outcome that does
nothing is cancelling a picker yourself.

Some browsers hand out file handles and then refuse to honour them — an
enterprise policy, a sandboxed context. There is no way to detect that without
trying, so the first refusal costs one extra dialog; after it the editor stops
using handles for the rest of the session and every later open and save takes
the working path directly.

## Sharing a link

The share button copies a URL with the entire diagram inside it. Opening that
URL anywhere loads the diagram — no account, no upload, nothing stored.

The payload rides in the fragment (`#d=…`), and that is the point rather than an
implementation detail: **a fragment is never sent to the server.** The bytes go
from your clipboard to the other person's browser without passing through any
host, which is the promise the rest of the editor makes, extended to sharing.
Whatever is serving the page never sees what is on it.

Diagram JSON is extremely repetitive — the same dozen key names once per node —
so it is gzipped before encoding, through the browser's own `CompressionStream`.
A two-block diagram comes to about 400 characters. The encoding is
self-describing: gzip's magic bytes are checked on the way back in, so a link
written by a browser that could not compress still opens in one that can.

What a link cannot do is stay short once **pictures** are embedded, because those
are already-compressed data URLs that gzip cannot help with. Past about 8000
characters the editor says so as it copies — browsers cope with far more than
chat clients and issue trackers do.

A shared link wins over the recovered-draft prompt on startup: it is an explicit
request for one particular diagram, and offering both would put two competing
documents on screen with no obvious answer. The draft stays in storage.

## When something goes wrong

Errors appear as a toast that stays until you dismiss it, with a **Copy**
button. What it copies is the reportable version, not the one-line summary:

- A malformed file gives you the parser message plus the offending line with a
  caret under the exact column.
- A crash gives you the stack, the URL and the browser string.
- Loader warnings copy the *complete* list, however many toasts were shown.

Uncaught exceptions and unhandled rejections are caught globally, so a broken
frame produces a copyable report rather than a silently frozen canvas. After
five, further errors go to the console only — and the toast says so.

## Panels

Both side panels resize by dragging their inner edge. Widths persist, reset on
double-click, and answer to the arrow keys when the divider has focus. The
component palette reflows as you drag — its column count is
`repeat(auto-fill, minmax(70px, 1fr))`, so it tracks the width in CSS with no
resize listener at all.

The dividers are absolutely positioned over each panel's edge rather than
living in the grid — a divider *inside* a scrolling panel would slide away with
a long palette. Width is clamped twice: each panel has its own bounds, and the
canvas is guaranteed 320px, so the two panels cannot conspire to close the
drawing area on a narrow window and leave you with nothing to drag back.

Either panel folds away entirely with `[` or `]`, or with the two buttons beside
the logo. A narrow window does it unprompted: the inspector goes below 1180px
and the palette below 900px, because 320px of canvas between two 232px panels
is not a drawing area.

What the viewport decides and what you decide are kept apart. Closing a panel
yourself is remembered; the window crossing a breakpoint is not, so resizing a
window never quietly rewrites your preference, and widening it again puts back
whatever you actually chose. Opening a panel while a narrow window is holding it
shut is honoured for as long as that window lasts — that choice was made under
duress, so it is not stored.

The toolbar answers to the same pressure. Both of its ends are pinned while the
middle scrolls under them: the panel toggles, because on a narrow window they
are the way a hidden panel comes back, and the document title, because whether
there is unsaved work should never be something you scroll a toolbar to find.

## Themes

The theme button cycles **system → light → dark**, and "system" is stored as
system rather than resolved once, so a machine that switches at dusk takes the
editor with it.

Flipping the theme never edits a diagram, but it does decide how one looks when
the diagram has no opinion. A document that names no `canvas.background` follows
the theme — light in light, dark in dark, because a diagram nobody has picked a
colour for should not be a white rectangle in a dark room. Pick a colour and it
is yours in either theme; the first swatch in the inspector, split light/dark,
hands the decision back.

None of that is written to the file. An automatic background stays automatic by
being *absent*, so reopening a diagram cannot turn "whatever suits" into a
preference for whichever theme happened to be on when it was saved, and
switching themes never marks anything unsaved.

The scene then derives its ink, halo and grid colours from whatever background
it ended up with, by luminance. A dark canvas gets light labels whichever theme
is on, and a white one gets dark labels even in dark mode.

## How it works

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers the load-bearing parts in
depth: the projection and why rotation sits outside it, why depth ordering is a
topological sort rather than a sort key, the occlusion rule, the plane
transform and its readability flip, the rendering diff, snapshot undo, and the
bundler's constraints.

A summary:

```
index.html
build.js              single-file bundler, Node built-ins only
schema/               JSON Schema for .arch.json
docs/FORMAT.md        the format, written for a model to read
examples/             a canonical document, generated by the serialiser
test/                 shared suite, run from Node or the browser
src/
  geom/iso.js         projection, rotation, box faces  ← the load-bearing module
  geom/depth.js       painter's ordering
  core/schema.js      normalise + serialise
  core/store.js       state and snapshot undo
  core/doc.js         queries and mutators
  geom/plane.js        placing flat content on isometric planes
  core/arrange.js      tidy + flow layout, the de-occlusion rule
  core/images.js       import, downscale, embed
  core/share.js        the diagram as a URL fragment
  core/gif.js          a GIF89a encoder, because no browser has one
  core/{io,export,commands}.js
  render/             scene, camera, block, group, edge, grid, overlay, handles
  input/              pointer, keyboard
  ui/                 toolbar, palette, inspector, theme, toasts, shortcuts,
                      export dialog, tooltips
  data/               component registry, icons, samples
```

A few decisions worth knowing before changing anything:

**The projection is a fixed matrix; rotation is not part of it.** Camera
rotation is a remap of grid coordinates applied *before* projecting, so the
projection stays a constant 2×3 matrix and its inverse is trivial. That inverse
is what makes dragging exact at any zoom or rotation. `test/cases.js` pins the
round-trip in all four rotations and both projections.

**Depth ordering is a topological sort, not a sort key.** The obvious
`x + y` key is wrong for boxes of mixed size — a long thin block can outscore a
small block that is clearly in front of it. `geom/depth.js` derives a real
"draw before" relation and sorts it, with a screen-overlap guard that keeps the
graph acyclic.

**Undo stores whole-document snapshots.** A diagram is a few kilobytes, so the
copy is free, and it removes the class of bugs where an inverse operation
drifts out of sync with the operation it undoes. Drags fold into one entry via
`beginGesture` / `endGesture`.

**Blocks are positioned by `transform` alone.** Face polygons are computed in
the block's own coordinates, so moving one is a single attribute write. That is
what keeps dragging smooth without a virtual DOM.

**The bundler concatenates modules into one scope**, which only works because
every module uses named imports/exports, has no cycles and no import-time side
effects. `build.js` verifies all three and fails loudly rather than producing a
broken file — including a top-level name collision check.

## Fonts

The interface and the diagram use **Pretendard JP**, loaded as a dynamic subset
so only the glyph ranges actually on screen are fetched. It is the one external
request the app makes, and nothing waits on it — the fallback stack covers
Korean, Japanese and Latin on its own.

For a bundle that must work with no network at all, inline the font:

```sh
node build.js --font path/to/PretendardJPVariable.woff2
```

That drops the CDN import and embeds the face: `dist/index.html` goes from about
200 kB to 7.2 MB and makes no network requests at all. Without it the bundle
stays small and falls back to system fonts when offline.

## Icons

All icons are inline SVG markup in `src/data/icons.js` — no files, no fetching,
which is what lets them survive the single-file bundle. Adding your own, or
dropping in an official cloud-provider pack, is documented in
[`docs/ICONS.md`](docs/ICONS.md).

Around 130 types ship, covering cloud services, languages and frameworks, data
stores, DevOps, **observability** (Prometheus, Grafana, Loki, Alloy),
**realtime transport** (WebRTC, WebSocket, ZeroMQ, STUN, TURN, nginx) and
**audio** (ASIO, WASAPI, Opus, H.264, ring buffers, Demucs, FFmpeg) — plus
machine-scale zone kinds (`host`, `docker-network`, `desktop-machine`, `lan`)
for systems that run on servers rather than in a cloud account.

Built-in technology marks are drawn from scratch as single-stroke glyphs, sized
to stay legible at 26px in the palette and skewed onto a block face. They are
meant to identify the technology a block stands for, not to reproduce anyone's
logo — see [Trademarks](#trademarks).

The registry is the single source: `node build.js` regenerates the JSON
Schema's type enum, the LLM prompt's catalogue and the Claude skill from it,
and the test suite fails if the committed schema drifts.

## Analytics, if you want them

The hosted copy counts page views with [Vercel Web
Analytics](https://vercel.com/docs/analytics) and watches how quickly the page
comes up with [Speed
Insights](https://vercel.com/docs/speed-insights). Your builds do neither, and
cannot start doing so by accident: it is one **build** switch, off unless asked
for.

```sh
node build.js                            # nothing hosted, no third-party request
MASSING_VERCEL_FEATURES=1 node build.js  # the hosted build
```

`--vercel` is the same switch on the command line. Anything other than a
deliberate yes — unset, empty, `0`, `false`, `off` — means off, and the build
prints `with the hosted features` when it is on, so a build that started phoning
home says so. The tests pin both halves, including that the old
`MASSING_ANALYTICS` no longer turns anything on.

### Nothing is fetched until someone agrees

A build with analytics does not contain `<script>` tags for them. It contains
their *names*, and the page asks before loading anything:

> **Count this visit?** Page views and how quickly the page loaded. No cookies,
> nothing that identifies you, and nothing is fetched unless you say yes.
>
> `No thanks`  `Allow`

One question for both. They measure different things and they are the same
decision to whoever is being asked; two banners for one deployment would be
absurd.

Consent that arrives after the request has already gone out is not consent, so
the request waits for the answer. **Both** answers are remembered in
`localStorage`, and the question is asked once — re-asking someone who already
said no is the behaviour that makes these banners hated. It is not modal: the
diagram stays usable behind it.

A build without analytics never shows it, because there is nothing to consent
to.

Two things worth knowing before switching it on:

- **They only work on Vercel.** The scripts are served from `/_vercel/…` by
  the deployment itself. Anywhere else — a file, another host — the requests
  fail and the page carries on; that path is tested too.
- **It costs the bundle its best property.** A plain build opens from `file://`
  with no network traffic at all. One built with analytics does not.

Both are cookieless and record visits rather than people, but they are still
requests to a third party, which is the whole reason this is a switch rather
than a line in `index.html`.

[`vercel.json`](vercel.json) points a Vercel project at `node build.js` and
`dist/`; set `MASSING_VERCEL_FEATURES` in the project's environment variables to
turn this on for that deployment only. Nothing about it affects anyone who is not
deploying to Vercel.

## Deployed on Vercel

The same switch turns on two more things a deployment can do, both off by
default and both individually switchable on a live deployment:

| | |
|---|---|
| **Publish** | Store the diagram and get `/d/<name>` and `/d/<hash>` back. The name can be re-pointed at a newer version by whoever claimed it; the hash never moves. Links are kept for 90 days after they are last opened, so the ones in use stay and the ones nobody opens are swept. |
| **Assistant** | Describe a change and have it made. It calls the Gemini API, reads and rewrites the document through tool calls, and edits go through the normal store — so undo works on whatever it does. |

Each is only there if the deployment says so, and the button is absent rather
than disabled when it is not. Conversations live in this browser's
`localStorage`, not on a server.

Everything to configure — the Blob store, the Gemini API key, the Edge Config
flags, the size and rate limits and what they were chosen for — is in
[`docs/VERCEL.md`](docs/VERCEL.md).

## Not included

AWS cost estimation, real-time collaboration, and importing live infrastructure
from a cloud account. Commercial tools such as Cloudcraft cover that ground;
Massing is a drawing tool and stops there. Official cloud-provider artwork is
not bundled either — see [`docs/ICONS.md`](docs/ICONS.md) for how to add it
yourself.

## Colophon

Built with [Claude Code](https://claude.com/claude-code) — the geometry, the
layout rules and this documentation were all worked out with it in the loop.

Which is also why the format is what it is. `.arch.json` was written to be read
and edited by a language model from the first commit, rather than given an
export button later, and the prompt in [`src/data/prompt.js`](src/data/prompt.js)
is the one string behind both the toolbar's sparkle button and the generated
Claude skill.

## Licence

[MIT](LICENSE). © 2026 YeJun Jung.

The toolbar's GitHub mark comes from [Octicons](https://github.com/primer/octicons)
(MIT, © GitHub, Inc.) and is used to link to this repository. Everything else in
`src/data/icons.js` and `src/ui/icons-ui.js` was drawn for this project.

## Trademarks

The MIT licence covers this project's code and artwork. It grants no rights in
anyone else's trademarks.

Massing is an independent project. It is **not affiliated with, endorsed by, or
sponsored by** Amazon Web Services, Microsoft, Google, GitHub, Cloudcraft,
Datadog, or any other company named here.

Product and service names in the component palette — EC2, S3, Lambda,
Kubernetes, PostgreSQL, React and the rest — are trademarks of their respective
owners. They appear only to say which technology a block represents, which is
the whole point of a component palette. No official logos are bundled; if you
add a vendor's icon pack yourself, that vendor's terms apply to you.
