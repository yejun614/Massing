# How Massing works

The parts of this codebase that are not obvious, and why they are the way they
are. For what the app *does*, see the [README](../README.md); for the file
format, [FORMAT.md](FORMAT.md).

---

## 1. The projection

Everything on screen is a linear combination of three basis vectors. World
space is a grid: integer `(x, y)` on the ground, `z` upward, all in cell units.

```
ex = ( cos30,  sin30) * CELL     +x runs right and down
ey = (-cos30,  sin30) * CELL     +y runs left and down
ez = ( 0,     -1    ) * CELL     +z runs straight up the screen

screen = x*ex + y*ey + z*ez
```

Written out, that is just:

```js
sx = (x - y) * cos30 * CELL
sy = (x + y) * sin30 * CELL - z * CELL
```

Two facts fall out of this and get used everywhere:

**The inverse is trivial.** `sx` depends only on `x - y` and `sy` only on
`x + y`, so unprojecting a screen point onto the plane at height `z` is two
divisions and a rearrangement. That inverse is what makes dragging exact: the
pointer is unprojected onto the ground each frame and the delta snapped to
whole cells, so a drag lands on the same cell at any zoom or rotation.

**A unit grid direction projects to exactly `CELL` pixels.** `|ex| = |ey| =
|ez| = CELL`. Dividing a projected direction by `CELL` therefore yields a
*unit* screen vector — which is what lets flat content keep its own pixel
scale on any plane (§4).

### Rotation is not part of the projection

Camera rotation is a remap of grid coordinates applied *before* projecting:

```js
rotatePoint(x, y, 1) === { x: y, y: -x }
```

Four steps, applied 0–3 times. The projection stays a constant 2×3 matrix and
its inverse stays a one-liner. The alternative — rotating the projection
itself — would mean recomputing and re-inverting a matrix per frame for no
benefit, since only four orientations are reachable anyway.

`rotateRect` handles the consequence: an odd rotation swaps a footprint's width
and depth, so callers must use the returned `w`/`h`, not the original.

`test/cases.js` pins `unproject(project(p)) === p` for all four rotations and
both projections.

### 2D mode is a second projection, not a special case

`flatProjection` has the same `project` / `unproject` / `showsSides` shape as
`isoProjection`. Toggling 2D swaps one object. Hit testing, dragging,
depth-sorting and rendering are all written against the interface and contain
no branches on the mode.

---

## 2. Depth ordering

Blocks are painted back to front. The obvious sort key — `x + y` — is **wrong**
for boxes of mixed size:

```
A: x 0..1, y 0..6     corner sum 7
B: x 2..3, y 1..2     corner sum 6      <- sorts first, but is clearly in front
```

`A` ends at `x = 1` and `B` begins at `x = 2`, so `A` is entirely behind `B`,
yet the key says otherwise. `geom/depth.js` therefore derives a real relation:

```
A is behind B  if  A.xmax <= B.xmin  or  A.ymax <= B.ymin
otherwise, if the footprints overlap on both axes, lower z wins
```

and topologically sorts it (Kahn, always taking the lowest-key ready node so
the output is stable across frames).

### The screen-overlap guard

That relation is only meaningful for boxes that actually overlap on screen. Two
far-apart boxes can produce a contradictory pair — `A` behind `B` by the x
rule, `B` behind `A` by the y rule — which would be a cycle. Requiring their
projected bounds to intersect before adding an edge keeps the graph acyclic and
shrinks it considerably. Above 600 boxes the O(n²) build stops paying for
itself and the corner-sum fallback is used.

---

## 3. Occlusion, and how arranging fixes it

A block hides whatever is behind it. Working out exactly when turns out to be
simple. The screen position of a silhouette top is

```
screenY = depth * (CELL/2) - height * CELL
```

so a front block covers a back block's top face precisely when

```
depthBack(front) - depthFront(back)  <  2 * (height(front) - height(back))
```

Two consequences drive `core/arrange.js`:

- A block **no taller** than the one behind it can never hide it, at any
  distance. The height difference is the whole story.
- A taller block needs exactly **twice the height difference** in depth to
  clear the one behind.

So the cure for a cluttered diagram is not "spread everything out" — it is
"put tall things at the back, and pay depth only where you cannot".

**Tidy** walks back to front and pushes each block forward along `(1, 1)` until
the rule is satisfied. That direction is pure depth: it moves a block straight
down the screen and never sideways, so the user's horizontal arrangement
survives. One ordered pass suffices because pushing only ever *increases*
depth, so a block is never compared against something that moves afterwards.

**Auto layout** re-flows from the connection graph: longest-path ranking
(relaxed rather than topologically sorted, so a cycle still terminates), then
two barycentre sweeps to pull out crossings. Ranks advance along `(+1, -1)`,
which is pure screen-horizontal and changes depth *not at all* — so no rank can
occlude another, and occlusion is reduced to a within-rank problem solved by
the height rule.

`countOccluded()` reports how many blocks are currently hidden. The tests
assert it reaches zero, rather than merely asserting that something moved.

---

## 4. Flat content on isometric planes

Text and pictures are both flat rectangles, so both are placed by one function.
There are four planes: square to the viewer, lying on the ground, or standing
against either visible wall. Each is spanned by two world directions, so all
four reduce to building a 2×3 affine matrix.

Because a unit grid direction projects to exactly `CELL` pixels (§1), dividing
by `CELL` gives a unit screen vector — local pixels stay local pixels, skewed
but never rescaled. A 14px font is 14px along whichever plane it sits on.

### The readability flip

Orbiting the camera eventually brings you round to the **back** of a wall,
where the plane's axes wind the other way and everything on it draws as its own
reflection. That is genuinely what the reverse of a poster looks like — and
completely useless in a diagram.

So when the determinant goes negative the in-plane direction is flipped. The
flip is folded into the matrix rather than appended as another transform:
mirroring local `x` about `cx` maps `(x, y)` to `(2cx - x, y)`, which is
exactly `u → -u` with the origin walked along `u` by `2cx`. Mirroring about the
element's own centre leaves its footprint exactly where it was.

The tests assert both halves: no plane ever has a negative determinant at any
rotation, and the anchor always remains one of the element's four corners.

> A rounding trap worth knowing: coordinates can be rounded to the pixel, but
> the **basis** cannot. Rounding `cos30` to `0.87` stretches the axis by 0.34%
> and leaves the two axes disagreeing about scale. `round6` for the linear
> part, `round2` for the translation.

### Resizing one of these

`planeAxes` hands the same frame back as numbers so a grip can be put on a
picture's own corner. Reading a drag back the other way has a trap in it: the
flip walks the origin along `u` by twice the spin centre, which is a function of
the picture's *own size*. Map absolute points and the new size feeds straight
back into the next reading, and one drag grows the picture without bound. So the
drag is measured as a **vector** — `planeVector`, axes only, no origin — which
is the same number in every case and stable in the ones that would otherwise run
away.

---

## 5. Rendering

One SVG, seven stacked layers, and a keyed diff:

```
grid → behind → zones → edges → blocks → texts → overlay
```

The edge layer routes in **document grid space**, not screen space, so a
connection keeps its shape when the camera turns. Both ends resolve through
`endpointBox`, which answers for a block and a zone alike — each is a rectangle,
and routing only ever asks where its edges are, so connecting zones needed no
second code path. Only blocks obstruct: a zone is a floor marking connections
are meant to cross, and routing around every VPC would tie a diagram in knots.

The route has exactly one degree of freedom, which is what makes it draggable.
The path is three orthogonal segments crossing over at `bend`; at the default
crossover the middle run lands on an endpoint and the duplicate point collapses,
reproducing the plain two-segment elbow. So the parameter was added without
redrawing a single existing diagram. `edgeRoute` is exported because the grip
has to sit on the line — routing it twice, in two files, is how a grip ends up
somewhere the line is not.

One case needs care: ends that already agree on an axis draw a straight run,
and crossing over *between* them cannot bend it, since every point shares that
coordinate. Stepping sideways on the other axis can, so `dragAxis` reports the
one a drag should move, which is not always the one the route turns on.

Resize grips are the exception, and deliberately so: they hang *outside* the
camera transform, in a layer of their own above everything. A grip is a control,
not scenery — it has to stay the same size on screen at every zoom, and putting
it in viewport pixels means the pointer layer hit-tests it in the coordinates it
already works in. Each grip carries what it grabs in its own data attributes, so
`input/pointer.js` reads the drag off the DOM rather than recomputing geometry
that could drift from what was drawn.

Rendering never rebuilds the tree. Each entity keeps its own `<g>` across
frames, keyed by document id; a frame creates, updates and removes, and only
the block layer is re-ordered (by `insertBefore`, moving only misplaced nodes).

**Blocks are positioned by `transform` alone.** Face polygons are computed in
the block's own coordinates, so moving a block is a single attribute write.
That is what keeps dragging smooth with no virtual DOM and no framework.

Attribute writes go through `setAttr`, which compares before writing, so an
unchanged frame touches nothing.

### Ink follows the document, not the theme

The interface theme (§7) and the diagram's own background are different things.
A dark canvas needs light labels whichever theme is on; a white canvas needs
dark ones even in dark mode. So the scene sets `--scene-ink`, `--scene-halo`
and friends from the *document's* background luminance, and `canvas.css` reads
only those. Flipping the theme never edits anyone's diagram.

---

## 6. State and undo

One store, one direction: **input → store → render**. Every subsystem talks to
the store and nothing else.

State is split in two. `doc` is the diagram and every change goes through
`commit`. Everything else — selection, camera, active tool, hover — lives
alongside it and is *not* part of history, because undoing a pan is never what
anyone wants.

**Undo stores whole-document snapshots**, not inverse commands. A diagram is a
few kilobytes, so the copy is free at this scale, and it eliminates the entire
class of bugs where an inverse operation drifts out of sync with the operation
it is supposed to undo. Drags collapse into one entry via
`beginGesture`/`endGesture`, and a gesture that changed nothing is discarded
rather than pushed.

---

## 7. The document is the product

`.arch.json` is meant to be read and written by people and language models, not
just by this editor. Two rules follow.

**Loading is forgiving.** Unknown component types degrade to a plain block,
duplicate ids get a suffix, edges naming a missing node are dropped, parent
cycles are broken, out-of-range numbers are clamped. Each produces a warning,
never an exception. A document that is 95% correct opens and tells its author
about the other 5%. The only fatal error is text that is not JSON.

### The file is a shared document

Two programs are expected to have the same `.arch.json` open — this editor and
whatever is writing it. So `io.js` tracks two different questions separately:
`handle` is where a **save** goes, `source` is where a **reload** reads from.
They usually name the same file, but not always — a document opened through the
plain file input has a source and no handle, and a Save As moves the handle to a
file the document was never read from. Collapsing them into one variable means a
reload eventually reads a file the user is not looking at.

Reload leaves the camera alone and prunes the selection rather than dropping it,
because a reload is the same diagram a moment later. It also compares the
incoming document against the current one in canonical form and does nothing
when they match: it is a button people press repeatedly while waiting for a
model to finish writing, and spending an undo entry per press would make the
history useless exactly when it is needed.

**Writing is deterministic.** Fixed key order, two-space indent, short numeric
arrays kept on one line by a small custom serialiser (`JSON.stringify` would
spread `"pos": [2, 2]` over five lines). Save → load → save is byte-identical,
which the tests assert, so diffs stay readable in version control.

Defaults are omitted on write, so an unstyled note stays a three-line object.

---

## 8. Exporting

Every format comes from one clone of the live scene, cropped to the content
rather than the viewport. Nothing is drawn a second way for export, so what is
saved is what was on screen.

The three settings that are *not* what was on screen — the projection, the grid
and the pixel scale — are handled by rendering the scene again with a different
state, never by patching the output. `scene.render` takes the state it draws, so
the export hands it a camera that is not the user's and the user's camera never
moves. Two consequences fall out:

- **The grid is generated for a viewport**, so an export that wants it renders
  once more with pan and zoom set to make scene coordinates and export pixels
  the same thing, and a viewport the size of the crop. Otherwise the grid stops
  where the window did.
- **`vector-effect: non-scaling-stroke` is stripped** from the inlined
  stylesheet. On screen it stops outlines fattening as the camera zooms; in a
  fixed picture it pins every stroke to one device pixel whatever size was
  asked for, so a 4× export draws four times the detail behind lines a quarter
  as thick. On the sample the grid fell from 9.8% of the image to 2.5% between
  1× and 4×; without the rule the ink per pixel is flat to three decimals.

The sheet's preview goes through that same path and is shown as an image,
rather than being a live copy of the canvas. The grid and the projection would
look right either way, but GIF's 256 colours happen in the encoder, and a
preview that skipped it would misrepresent the one format whose output actually
surprises people. It also has to wait: Chrome holds off rasterising an SVG
image until pending webfonts settle, which on a cold load is most of a second.
That wait is correct — an export must not be set in the fallback face — so the
frame says it is working rather than sitting blank, and keeps the previous
picture up while the next one is drawn.

### GIF is written by hand

`canvas.toBlob` covers PNG, JPEG and WebP. It does not cover GIF — and asking
for `image/gif` quietly returns a PNG, so the format cannot simply be listed.
`core/gif.js` is therefore a real encoder: a 5-bit histogram, median cut to 256
colours, and GIF's variable-width LZW.

The trap in the LZW is the code width. It grows as the table fills, and the
decoder grows it on its own schedule — one step later, because it learns each
code only when the next arrives. Encoder and decoder must nonetheless bump on
the same beat, which means the encoder widens *before* assigning a code and a
decoder widens *after* adding one. Off by one either way and the stream
desynchronises a few codes in, producing a file that is not corrupt so much as
plausible nonsense. The test suite decodes what the encoder wrote, and the
browser driver hands the bytes to Chrome, which is the only authority on
whether the file is really a GIF.

### A phone is not a small desktop

Three things had to change shape rather than merely shrink.

**The toolbar stops being a row.** It is the same element and the same
buttons: below 760px the grid's toolbar row goes to zero, the bar is laid over
a left padding as a fixed rail, and the flex direction turns. What is *not*
free is deciding which eight of twenty-nine buttons stay out — that is a
judgement about editing on a phone, marked in `toolbar.js` rather than in the
stylesheet, because the desktop grouping does not answer it. Two rules earned
their comments the hard way: the button that folds the rail back pins itself to
the bottom while open, or it is the last item on a list taller than the screen;
and a drawer's width now subtracts the rail, or the strip of canvas left to
dismiss it with came out eight pixels wide.

**The panels stop being columns.** 232px of palette plus 232px of inspector
leaves nothing to draw on at 390px wide, so below 760px the columns are pinned
to zero and the panels become drawers over the canvas — the same `is-collapsed`
class, a different stylesheet. Only one opens at a time, and arming a component
closes the palette, because the next thing that has to happen is a press on the
canvas it was covering.

**Pan is the default tool, on a coarse pointer.** Keyed off the pointer and not
the width: a narrow desktop window still has a wheel and a held space, and a
touchscreen laptop still has a finger. It is set once at startup rather than
enforced, so switching to select stays a switch.

**A second finger is always the camera.** There is no wheel on a phone and no
key to hold, so without a gesture the diagram could be edited but never
navigated. One finger selects and drags exactly as a mouse does; two pan and
pinch together. The first finger's drag is closed off rather than abandoned
when the second lands, so a half-finished move is still one undo entry.

**Grips are sized to the pointer, not the screen.** This is the one that bites:
on a coarse pointer the grips are drawn larger and given a larger invisible
target still — and are withheld until the shape is comfortably bigger than they
are. Four dots on the corners of a block barely wider than they are cover the
block, and dragging it, the commonest thing anyone does, stops working
altogether. The threshold is keyed off `(pointer: coarse)` rather than the
viewport, so a touchscreen laptop gets it at any width.

---

## 9. The bundler

`build.js` walks the ES module graph from `src/main.js`, strips import/export
statements, concatenates in dependency order, and inlines the stylesheets into
one `dist/index.html` that opens from `file://` with no network requests.

Flat concatenation works only because the project's own rules hold: named
imports and exports only, no cycles, no import-time side effects. `build.js`
**verifies all three and fails loudly** rather than emitting a broken file —
including a top-level name-collision check, since every module ends up sharing
one scope.

That check has already earned its place: it caught nine duplicated helpers
(`round`, `clamp`, `download` …) that became `util/num.js` and `util/dom.js`.

### The one thing that phones home

Analytics is a build switch, `MASSING_ANALYTICS`, and it is off unless asked
for. That is not caution for its own sake: the bundle's headline property is
that it opens from a file with no network traffic, and a runtime flag would put
the burden of trusting it on everyone who clones the repo. `grep _vercel` over
the output settles the question, which is why the URL lives in `build.js` and
not in the app code.

What the switch injects is a `<meta>` **naming** the script, never a `<script>`
tag. `ui/consent.js` reads that name, asks, and adds the element only if the
answer is yes — consent that arrives after the request has gone out is not
consent, it is a notification. Both answers are stored, because re-asking
someone who declined is the behaviour that earns these banners their
reputation. Storage that throws is a real configuration, so the store falls
back to memory: asking once per visit is worse than asking once and better than
breaking the page.

`build()` is exported and the command line is guarded by a main-module check,
so the tests assemble both builds in-process and diff them — the enabled one
must differ from the plain one by exactly that tag and nothing else. The switch
is deliberately deaf to anything but an explicit yes, because the failure that
matters is shipping the script by accident, never leaving it out by accident.

---

## 10. Working without a framework

There is no virtual DOM, no reactivity system and no build step for
development. What replaces them:

| Job | Approach |
|---|---|
| Rendering | Keyed diff over `Map<id, view>`; `setAttr` skips unchanged writes |
| State | One store with `subscribe`; renders batched into one `requestAnimationFrame` |
| Undo | Whole-document snapshots |
| Panels | Built once per selection *shape*, then values synced in place — otherwise typing rebuilds the panel and steals focus |
| Templating | `h()` and `svg()` in `util/dom.js`, about forty lines |
| Tooltips | One popover moved between controls; `title` harvested on hover, so the toolbar keeps writing plain titles |
| Touch | A second finger switches the pointer machine to `pinch`; grips resize themselves off `(pointer: coarse)` |

The inspector's rebuild rule is the one that bites if forgotten: rebuild on
selection change, sync otherwise, and never write to a focused input.

---

## 11. Where things live

```
src/
  geom/iso.js       projection, rotation, box faces   ← load-bearing
  geom/plane.js     flat content on isometric planes
  geom/depth.js     painter's ordering
  core/schema.js    normalise + serialise
  core/store.js     state and snapshot undo
  core/doc.js       queries and mutators
  core/arrange.js   tidy + flow layout
  core/images.js    import, downscale, embed
  core/gif.js       a GIF89a encoder, because no browser has one
  core/{io,export,commands}.js
  render/           scene, camera, block, group, edge, text, image, grid, overlay, handles
  input/            pointer, keyboard
  ui/               toolbar, palette, inspector, theme, toasts, shortcuts,
                    export dialog, tooltips, analytics consent
  data/             component registry, icons, prompt, samples
```

Two modules are worth reading before changing anything: `geom/iso.js`, because
everything visual is built on it, and `core/schema.js`, because it defines the
contract the file format makes with the outside world.
