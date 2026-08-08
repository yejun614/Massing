# `.arch.json` — the Massing diagram format

Paste this file into a chat to have a model write or edit diagrams for you.
The machine-readable contract is [`schema/arch-v1.schema.json`](../schema/arch-v1.schema.json).

## Coordinates

The diagram lives on an integer grid, drawn in isometric projection.

```
        +z  (height, straight up on screen)
         |
         |
   +y ---+--- +x
  (left-down)  (right-down)
```

- `pos: [x, y]` is a block's **minimum corner**, not its centre.
- `size: [width, depth]` in cells. Default `[2, 2]`.
- `height` in cells. The type supplies one, between 1 and 3; write `1` on
  everything instead, because a block no taller than the one behind it can
  never hide it (see below).
- Everything is an integer. Never emit fractional coordinates.

Two derived numbers decide where something lands on screen, and placing goes
better if you think in them rather than in `x` and `y`: the horizontal position
is `x - y`, and the depth — larger being nearer the viewer — is `x + y`.

A `[2, 2]` block at `pos: [4, 4]` occupies `x` 4–6 and `y` 4–6, so the next
block on the same row starts at `x: 7` if you want a one-cell gap.

## Minimal document

```json
{
  "version": 1,
  "meta": { "title": "My service" },
  "nodes": [
    { "id": "api", "type": "ec2", "label": "API", "pos": [0, 0] },
    { "id": "db", "type": "rds", "label": "Postgres", "pos": [4, 0] }
  ],
  "edges": [{ "from": "api", "to": "db", "label": "5432" }]
}
```

`groups`, `canvas`, `size`, `height` and `color` are all optional — omitted
fields fall back to the component type's defaults.

## Full example

An excerpt of the diagram the editor opens with. Note what every block carries:
one footprint, one height, one caption size, and a `labelPlane` — the default
lays a caption flat on the ground at 45 degrees, which is the commonest way a
diagram in this format comes out unreadable.

```json
{
  "version": 1,
  "meta": { "title": "Three-tier web application" },
  "groups": [
    { "id": "prod-vpc", "kind": "vpc", "label": "Production", "rect": [10, 0, 29, 16],
      "color": "#eab308", "labelSize": 96 },
    { "id": "private-subnet", "kind": "subnet", "label": "Private", "rect": [21, 1, 17, 14],
      "color": "#a855f7", "labelSize": 44, "labelPlane": "left", "parent": "prod-vpc" }
  ],
  "nodes": [
    { "id": "web-1", "type": "ec2", "label": "Web 1", "pos": [24, 3], "size": [2, 2],
      "height": 1, "color": "#12a37a", "labelSize": 40, "labelPlane": "right",
      "group": "private-subnet" },
    { "id": "jobs", "type": "sqs", "label": "Queue", "pos": [30, 12], "size": [2, 2],
      "height": 1, "color": "#2c7de0", "labelSize": 40, "labelPlane": "right",
      "group": "private-subnet" }
  ],
  "edges": [
    { "id": "e-enqueue", "from": "web-1", "to": "jobs", "route": "x", "color": "#2c7de0" }
  ],
  "texts": [
    { "id": "note-private", "text": "Nothing in the private subnet\nhas a route in from the internet.",
      "pos": [24, 19], "size": 50, "italic": true, "color": "#64748b" }
  ]
}
```

The whole thing, as the editor writes it, is in
[`examples/three-tier.arch.json`](../examples/three-tier.arch.json).

### The canvas colour

`canvas.background` is optional, and leaving it out is a real answer rather
than an omission: it means the diagram has no opinion, and the colour follows
whoever is looking — light in a light theme, dark in a dark one.

```json
{ "canvas": {} }                            // follows the theme
{ "canvas": { "background": "#ffffff" } }   // white, in any theme
```

Name a colour and it is yours in both themes. Nothing the viewer does writes
one in, so a file that stays quiet stays quiet — the editor never turns
"whatever suits" into a preference for whichever theme happened to be on when
it was saved.

## Component types

Around 130 types across these groups:

| Group | Covers |
|---|---|
| Compute · Storage · Database · Network · Integration · Security | AWS-shaped services |
| Languages · Frameworks · Data stores | `java` `kotlin` `python` `rust` `springboot` `react` `tauri` `mysql` `postgresql` `redis` `rabbitmq` … |
| DevOps | `docker` `kubernetes` `jenkins` `gradle` `cargo` `gitlab` `dockerhub` `certbot` `swagger` `mattermost` `jira` … |
| Observability | `prometheus` `grafana` `loki` `alloy` `node-exporter` `healthcheck` |
| Realtime | `webrtc` `websocket` `zeromq` `stun` `turn` `p2p` `rtp` `nat` `nginx` `reverse-proxy` |
| Audio | `microphone` `asio` `wasapi` `opus` `h264` `ringbuffer` `mixer` `demucs` `ffmpeg` … |
| AI & data | `pytorch` `tensorflow` `numpy` `pandas` `gemini` `llm` `gpu` |
| Client | `windows` `desktop-app` `webview2` |
| Generic | `server` `database` `queue` `storage` `container` `user` `internet` `generic` |

The authoritative list is the `enum` in
[`schema/arch-v1.schema.json`](../schema/arch-v1.schema.json), generated from the
registry — and the prompt behind the toolbar's sparkle button carries the same
list in full.

An unknown type is drawn as a plain block and reported as a warning — it will
not stop the file from opening.

## Zones

`groups` are flat rectangles on the ground. Kinds:

| Kind | For |
|---|---|
| `host` | A machine boundary — one server, with things inside and outside it |
| `docker-network` | A compose bridge network |
| `desktop-machine` | A participant's PC, several side by side |
| `lan` | A private network, behind NAT |
| `vpc` `subnet` `az` `account` | Cloud-account scopes |
| `group` | A plain labelled box |

Pick the boundary that matches the deployment. A single server running
containers is a `host` with a `docker-network` inside it, not a `vpc`.

Membership is **geometric**. A node whose footprint sits inside a zone's `rect`
belongs to that zone, and the editor recomputes `node.group` whenever anything
moves. Setting `group` by hand is optional; making the rectangle actually
enclose the node is not.

Zones must be large enough to hold their contents. A `[2, 2]` block at
`[11, 2]` needs a zone covering at least `x` 11–13 and `y` 2–4.

## Connections

`from` and `to` name **a block or a zone** — the two are interchangeable, so
"this subnet peers with that one" and "this gateway reaches that LAN" are both
one edge. A connection to a zone starts at the zone's boundary rather than its
middle, the same way it does for a block.

```json
{ "from": "api", "to": "db" }
{ "from": "gateway", "to": "office-lan" }
{ "from": "prod-vpc", "to": "dr-vpc", "label": "peering", "style": "dashed" }
```

Routing is an elbow in grid space, so a connection keeps its shape when the
camera rotates. Two fields override it:

| Field | Meaning |
|---|---|
| `route` | `auto` (default) picks whichever elbow passes through fewer blocks; `x` or `y` pins it to one |
| `bend` | Where the run crosses over — an x coordinate under `route: "x"`, a y coordinate under `route: "y"`. Half-cell steps |

```json
{ "from": "api", "to": "db", "route": "x", "bend": 6.5 }
```

`bend` means nothing without `route`, and is dropped on load when `route` is
`auto` — so a stale number cannot come back the next time an axis is chosen. In
the editor these are what dragging a selected connection's grip writes; setting
**Route** back to Automatic in the inspector clears both.

Only blocks push a route around. A zone is a floor marking that connections are
meant to cross, so routing ignores them — otherwise every line would tie itself
in knots getting around a VPC.

Auto layout ranks **blocks** from the connections between blocks; a connection
that touches a zone is left out of that calculation and simply drawn.

## Text annotations

`texts` are free-form notes for commentary — captions, callouts, explanations.

Leave one on the floor, which is where it goes by default. A block's caption
has to stand up because it names one small thing and is read against it, but a
note is a paragraph laid on the ground of the scene: it skews with everything
else and turns with the camera, reading like writing on the floor plan rather
than a sticker on the glass.

Size is what makes that work. The ground takes a cut for the projection and
another for the 45-degree skew, so a note left at the 14px default is a grey
smudge. **Set `size` to 50** — it looks absurd in the file and is barely enough
on screen — and keep the lines short, because at that size they are already
wide.

```json
{
  "texts": [
    { "id": "why", "text": "Retries land here\nafter 3 failures", "pos": [4, 9],
      "size": 50, "italic": true, "align": "left", "color": "#64748b" }
  ]
}
```

| Field | Meaning |
|---|---|
| `text` | The note. `\n` starts a new line. Required. |
| `pos` | `[x, y]` anchor on the grid. Required. |
| `size` | Font size in pixels, 6–200. Default 14. |
| `bold` / `italic` / `underline` | Booleans, all default false. |
| `align` | `left` (default), `center` or `right`. Decides which corner `pos` is. |
| `color` | Six-digit lower-case hex. Default `#334155`. |

A note that is only whitespace is dropped on load — it would otherwise sit in
the document as something invisible you cannot select or find.

## Placing flat things in the isometric world

Text and pictures are both flat rectangles, so both are placed the same way.

| Field | Meaning |
|---|---|
| `plane` | `floor` (lying on the ground, the default), `right` or `left` (standing against a wall), `screen` (square to the viewer) |
| `spin` | `0`, `90`, `180` or `270` degrees, rotated within the plane |
| `z` | Elevation above the ground in cells |
| `behind` | Draw underneath the blocks and zones, e.g. a floorplan backdrop |

Captions take the same treatment through `labelPlane`, on blocks, zones and
connections — so a block's label can be written onto one of its own faces, a
zone's onto the ground inside it or standing along one of its far edges, and a
connection's flat along the line or standing above it:

```json
{ "id": "db", "type": "rds", "pos": [4, 0], "labelPlane": "right" }
{ "id": "prod-vpc", "kind": "vpc", "rect": [0, 0, 18, 12], "labelPlane": "floor" }
{ "from": "api", "to": "db", "label": "5432", "labelPlane": "left" }
```

Blocks and connections default to `floor`. **Zones default to `right`** — a zone
is large and usually full, so a caption lying flat inside it competes with its
own contents, while one standing along a far edge stays clear. `floor` writes the
zone name on the ground just inside its top corner; `left` uses the other far
edge.

A connection's caption always sits at the halfway point of the run; the plane
only decides which way it is offset from the line. `floor` lays it alongside,
`right` and `left` stand it up above, `screen` floats it over the midpoint.

Three of those four planes are in the world and one is not, which is the case
against `screen`. It survives every camera rotation, and that is exactly what
makes it read as an overlay stuck to the front of the picture rather than as
part of it — and once one thing is pinned to the viewer, rotating the diagram
slides it across everything else. Notes belong on the `floor`, captions on
`left` or `right`. `screen` is there for the 2D view, which falls back to it
because a wall seen from directly above has no height to stand on.

`labelSize` sets the caption size in pixels on any of them, 6–96, default 12.

### Which way a caption lines up

`labelAlign` is `left`, `center` (the default) or `right`, on blocks and
connections:

```json
{ "id": "db", "type": "rds", "pos": [4, 0], "labelAlign": "left" }
{ "from": "api", "to": "db", "label": "5432", "labelAlign": "right" }
```

A block has a width, so the caption lines up with the block's own left edge,
centre or right edge — whichever plane it hangs on, and whether or not the
caption is wider than the block. A connection has only its midpoint, so the
setting decides which end of the caption is pinned there; `left` starts the
text at the midpoint and runs it onward, which is how you keep a long caption
off a block it would otherwise cross.

Free text annotations have had the same three settings all along, under the
plain name `align`, measured against their own anchor.

### No caption at all

Leave `label` out and a block or a zone is named after what it is — an `ec2`
becomes "EC2 Instance", a `vpc` becomes "VPC". Set it to `""` and nothing is
drawn:

```json
{ "id": "worker-1", "type": "ec2", "label": "", "pos": [0, 0] }
```

Absent and empty are deliberately different answers, so clearing a caption in
the editor survives being saved and opened again. That is also why an empty
label is one of the few things written out rather than omitted: dropping the
key would be indistinguishable from never having set it. `""` is a normal value
on connections and pictures too, which have no name of their own to fall back
on.

Text, pictures, block captions and connection captions default to `floor` —
lying on the ground is what reads as part of the isometric scene rather than
stuck on top of it, and for a note that is also the placement to keep. Zone
captions default to `right`. A block's caption is the one thing that wants
moving: stand it against the wall its cluster faces. Content never renders mirrored:
orbiting the camera eventually brings you to the back of a wall, and the
editor flips the plane rather than showing you the reverse of your own text.
In the 2D view the walls have no height to stand on, so anything on one falls
back to facing the viewer.

## Pictures

```json
{
  "images": [
    { "id": "floorplan", "src": "data:image/webp;base64,UklGR...",
      "pos": [0, 0], "size": [20, 14], "plane": "floor",
      "opacity": 0.5, "behind": true },
    { "id": "team-logo", "src": "https://example.com/logo.svg",
      "pos": [2, 0], "size": [4, 2], "plane": "right", "z": 3 }
  ]
}
```

`src` is a `data:` URL or any image URL. The editor always writes a data URL,
because a diagram that points at a file on someone's disk breaks the moment it
is shared. Imports are re-encoded down to at most 1400px on the longest side
first, and the inspector shows what each picture weighs.

`size` is `[width, height]` in cells, measured within the plane. An image with
no `src` is dropped on load.

## Identifiers

Ids are readable slugs — lower case, hyphen separated — and must be unique
across nodes, groups, edges, texts **and** images in one document. Derive them from the label:
`"Web Server"` → `web-server`. Do not use UUIDs. A duplicate id is renamed on
load (`web-1`, `web-1-2`) and reported.

`edges[].id` may be omitted; one is generated from the endpoints.

## Rules the loader enforces

Loading is deliberately forgiving. Each of these produces a warning, never an
error:

| Situation | Result |
|---|---|
| Unknown `type` | Drawn as `generic` |
| Duplicate `id` | Renamed with a numeric suffix |
| Edge with a missing endpoint | Dropped |
| Self-edge | Dropped |
| `group` / `parent` naming a missing zone | Set to `null` |
| Zone parent cycle | Cycle broken |
| Missing `pos`, `size`, `height`, `color` | Type defaults applied |
| Text with no content | Dropped |
| Image with no `src` | Dropped |
| Unknown `plane` or `spin` | Reset to the default (`floor`) |
| Unknown `labelPlane` | Reset to the default (`floor`, or `right` on a zone) |
| `labelSize` out of range | Clamped to 6–96 |
| Text `size` or `align` out of range | Clamped to the default |
| Coordinate outside ±400 | Clamped |

The only hard failure is text that is not JSON.

Shorthand accepted for convenience: `x`/`y` instead of `pos`, `w`/`h` instead
of `size`, `name` instead of `label`, `source`/`target` instead of `from`/`to`.
These are normalised to the canonical form on save.

## Writing a good layout

Diagrams get ugly because their authors try to make them varied. Start from
these and depart only where you can name the reason.

- One footprint, `[2, 2]`, and one height, `1`, on every block. Uniform height
  is what makes occlusion impossible rather than merely unlikely.
- One caption size, 40–50, on every block; build hierarchy out of a single
  zone title at `labelSize: 96` instead. Two big titles compete.
- Set `labelPlane` on every block: `left` or `right`, never the `floor`
  default. Captions are proper nouns of ten characters or fewer — an
  explanation belongs in `texts`, where it has the floor to itself.
- Put blocks on a regular pitch, every five cells in `x` and four to six in
  `y`, and leave a one-cell gap: adjacent blocks read as one mass.
- Lay out left to right along `+x` for request flow, and use `+y` for tiers.
  Spreading along `x - y` is free, since blocks side by side on screen never
  hide each other.
- Draw at most one connection per three blocks. Sharing a zone already states
  the relationship, so lines are for what grouping cannot say: crossings of a
  zone boundary, pipeline order, and exceptional paths.
- Give the ones you do draw a caption at `labelSize: 30`; the 12px default is a
  connection caption you have to go looking for.
- Place a connection's two ends in the same row or the same column, so the run
  is a straight line with nothing to follow. Routing is orthogonal and picks
  between an x-first and a y-first elbow: if a block sits on both, the line
  vanishes behind it and the eye joins it to the wrong thing. Two runs along
  one row are a single thick line, and at this density a crossing means two
  blocks are in the wrong order. Move a block, never add a line.
- Give a nested zone a colour far from its parent's. A zone inside a zone is
  painted over it and captioned in a shade of itself, so a subnet coloured near
  its VPC loses its edge, loses its caption, and the two read as one. At least
  a quarter turn of hue, and a difference in lightness too.
- Put a zone's `rect` origin one cell outside its contents on every side.

### Tall blocks hide short ones

The view is isometric, so a block hides whatever is behind it — behind meaning
a smaller `x + y`. Precisely:

    hidden when  (front.x + front.y) - (back.x + back.w + back.y + back.h)
                 <  2 * (front.height - back.height)

So a block no taller than the one behind it can never hide it, and a taller one
needs `2 x the height difference` of extra `x + y`. Placing tall blocks at low
`x + y` and short ones at high `x + y` avoids the problem entirely. Blocks that
differ in `x - y` sit side by side on screen and never hide each other.

The editor can fix this for you: `A` tidies, `Shift+A` re-flows the layout.

## Saving

The editor writes with fixed key order, two-space indent, and short numeric
arrays kept on one line, so save → load → save is byte-identical and diffs stay
readable. Hand-written files need not match that formatting; they are
normalised on the next save.
