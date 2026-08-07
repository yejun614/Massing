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

## Running it

```sh
python -m http.server 8123        # or any static server
# → http://localhost:8123
```

Nothing to install. `npm run dev` does the same thing if you prefer.

```sh
node test/run.mjs                 # geometry + document suite (143 checks)
node build.js                     # → dist/index.html, plus the Claude skill
node build.js --doc my.arch.json   # the same, with a diagram baked in
node build.js --font Pretendard.woff2   # inline the font: no network at all
```

`test/iso.test.html` runs the identical suite in a browser, which also proves
the modules load unbundled.

## Using it

| | |
|---|---|
| Place a block | Click a component in the left panel, then click the canvas (Shift keeps it armed) |
| Move | Drag. Dragging a zone moves everything inside it |
| Resize | Select one thing, then drag a grip. A block gets an extra grip above it for its height |
| Connect | `C`, then drag from one block or zone to another |
| Re-route a connection | Select it and drag the grip on the run it turns on |
| Draw a zone | `G`, then drag a rectangle |
| Add a note | `T`, then click. Bold, italic, underline, size and colour in the inspector |
| Add a picture | The picture button, or drag an image file onto the canvas, or paste a screenshot |
| Tidy | `A` — nudge blocks apart until nothing is hidden, keeping your layout |
| Auto layout | `Shift+A` — re-flow the whole diagram from its connections |
| Rotate the view | `Q` / `E` |
| 2D / 3D | `2` |
| Pan | `H` for the pan tool, or Space + drag / middle-drag from any tool |
| Find a component | The search box at the top of the left panel |
| Light / dark | The theme button cycles system → light → dark |
| Resize the panels | Drag either panel edge; double-click to reset, arrow keys when focused |
| Hide a panel | `[` / `]`, or the two buttons beside the logo. A narrow window folds them away on its own |
| Reload from disk | `R`, or the refresh button — re-reads the open file after something else edited it |
| Export an image | `Ctrl+E` — SVG, PNG, JPG, WebP or GIF, with or without the grid, isometric or 2D, at 1× to 4× |
| Share a diagram | The share button copies a link with the whole diagram inside it |
| Everything else | The `?` button in the toolbar |

### On a phone

The two panels stop being columns and become drawers over the canvas — a phone
cannot spare 232px for a palette *and* have somewhere left to draw. Picking a
component closes the palette on its own, since the next thing you do is press
the canvas it was covering. One finger selects and drags; **two pan and zoom**,
as they do on a map. Grips are drawn larger and withheld from shapes too small
to hold them, because four dots on the corners of a small block cover the block
and dragging it stops working.

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

Only the interface changes. The canvas background belongs to the *document*, so
flipping the theme never edits someone's diagram — instead the scene derives
its ink, halo and grid colours from that background's luminance. A dark canvas
gets light labels whichever theme is on, and a white one gets dark labels even
in dark mode.

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
