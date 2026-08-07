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
- `height` in cells. This is the visual weight of a block: `1` for a gateway,
  `2` for a server, `3` for a database.
- Everything is an integer. Never emit fractional coordinates.

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

```json
{
  "version": 1,
  "meta": { "title": "Three-tier web application" },
  "canvas": { "background": "#eef1f5" },
  "groups": [
    { "id": "prod-vpc", "kind": "vpc", "label": "Production VPC", "rect": [0, 0, 18, 12] },
    { "id": "public-subnet", "kind": "subnet", "label": "Public subnet", "rect": [1, 1, 7, 10], "parent": "prod-vpc" },
    { "id": "private-subnet", "kind": "subnet", "label": "Private subnet", "rect": [10, 1, 7, 10], "parent": "prod-vpc" }
  ],
  "nodes": [
    { "id": "alb", "type": "elb", "label": "Application LB", "pos": [2, 5], "group": "public-subnet" },
    { "id": "web-1", "type": "ec2", "label": "Web 1", "pos": [11, 2], "group": "private-subnet" },
    { "id": "db", "type": "rds", "label": "PostgreSQL", "pos": [11, 8], "height": 3, "group": "private-subnet" }
  ],
  "edges": [
    { "id": "e-web1", "from": "alb", "to": "web-1" },
    { "id": "e-db", "from": "web-1", "to": "db", "label": "5432", "style": "dashed" }
  ]
}
```

A complete, editor-generated document is in
[`examples/three-tier.arch.json`](../examples/three-tier.arch.json).

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

## Text annotations

`texts` are free-form notes for commentary — captions, callouts, explanations.
They are drawn screen-horizontal, so unlike block labels they stay readable at
every camera rotation.

```json
{
  "texts": [
    { "id": "why", "text": "Retries land here\nafter 3 failures", "pos": [4, 9],
      "size": 16, "bold": true, "align": "left", "color": "#334155" }
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
| `plane` | `screen` (square to the viewer), `floor` (lying on the ground), `right` or `left` (standing against a wall) |
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
{ "from": "api", "to": "db", "label": "5432", "labelPlane": "screen" }
```

Blocks and connections default to `floor`. **Zones default to `right`** — a zone
is large and usually full, so a caption lying flat inside it competes with its
own contents, while one standing along a far edge stays clear. `floor` writes the
zone name on the ground just inside its top corner; `left` uses the other far
edge.

A connection's caption always sits at the halfway point of the run; the plane
only decides which way it is offset from the line. `floor` lays it alongside,
`right` and `left` stand it up above, `screen` floats it over the midpoint.

`labelSize` sets the caption size in pixels on any of them, 6–96, default 12.

Text, pictures, block captions and connection captions default to `floor` —
lying on the ground is what reads as part of the isometric scene rather than
stuck on top of it. Zone
captions default to `right`. Set `plane` (or `labelPlane`) to `screen` when
something must stay square to the viewer whatever the camera is doing. Content never renders mirrored:
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

- Leave a one-cell gap between blocks; adjacent blocks read as one mass.
- Lay out left to right along `+x` for request flow, and use `+y` for tiers.
- Vary `height` so the diagram has a silhouette: databases tall, gateways flat.
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
