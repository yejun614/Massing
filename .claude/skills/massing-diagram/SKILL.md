---
name: massing-diagram
description: >-
  Write and edit Massing `.arch.json` isometric architecture diagrams.
  Use when asked to create, edit or explain an isometric architecture diagram,
  a .arch.json file, or a Massing document.
---

# Massing diagram authoring

You write Massing diagrams: `.arch.json` files describing isometric
architecture diagrams. Reply with the JSON document and nothing else — no
commentary, no markdown fence — unless you were asked a question about it.

## The grid

Diagrams live on an integer grid drawn in isometric projection.

    +z  height, straight up on screen
     |
 +y -+- +x       +x runs right-and-down, +y runs left-and-down

- `pos: [x, y]` is a block's MINIMUM corner, not its centre.
- `size: [width, depth]` in cells, default `[2, 2]`.
- `height` in cells: 1 for a gateway, 2 for a service, 3 for a database.
- Every coordinate is an integer. Never emit fractions.

A `[2, 2]` block at `[4, 4]` covers x 4–6 and y 4–6, so the next block in that
row starts at x 7 to leave a one-cell gap.

## Shape of the file

```json
{
  "version": 1,
  "meta": { "title": "Payments service" },
  "groups": [
    { "id": "prod-vpc", "kind": "vpc", "label": "Production", "rect": [0, 0, 16, 12] }
  ],
  "nodes": [
    { "id": "api", "type": "springboot", "label": "Payments API", "pos": [2, 2], "group": "prod-vpc" },
    { "id": "db", "type": "postgresql", "label": "Ledger", "pos": [6, 2], "height": 3, "group": "prod-vpc" }
  ],
  "edges": [
    { "from": "api", "to": "db", "label": "5432" }
  ],
  "texts": [
    { "id": "note", "text": "Write path only", "pos": [2, 6], "bold": true }
  ]
}
```

`groups`, `edges`, `texts`, `size`, `height` and `color` are all optional.
Omitted fields take the component type's defaults.

## Component types

Compute: `ec2` `lambda` `ecs` `eks` `fargate` `batch`
Storage: `s3` `ebs` `efs` `glacier`
Database: `rds` `aurora` `dynamodb` `elasticache` `redshift`
Network: `elb` `cloudfront` `route53` `apigateway` `natgw` `igw`
Integration: `sqs` `sns` `eventbridge` `kinesis`
Security: `iam` `waf` `cognito` `kms` `oauth2` `jwt` `google` `kakao`
Languages: `java` `kotlin` `python` `javascript` `typescript` `rust`
Frameworks: `springboot` `react` `vue` `svelte` `vite` `tauri` `nodejs` `tailwind`
Data stores: `mysql` `postgresql` `mongodb` `redis` `rabbitmq` `erd` `volume` `filesystem` `flyway`
DevOps: `docker` `kubernetes` `jenkins` `git` `npm` `pip` `uv` `gradle` `cargo` `gitlab` `dockerhub` `installer` `certbot` `webhook` `worker` `terminal` `swagger` `mattermost` `jira`
AI & data: `pytorch` `tensorflow` `numpy` `pandas` `llm` `gpu` `gemini`
Observability: `prometheus` `grafana` `loki` `alloy` `node-exporter` `healthcheck`
Realtime: `webrtc` `websocket` `zeromq` `stun` `turn` `p2p` `rtp` `nat` `nginx` `reverse-proxy`
Audio: `microphone` `headphone` `speaker` `webcam` `asio` `wasapi` `audio-interface` `waveform` `opus` `h264` `ringbuffer` `mixer` `midi-keyboard` `sampler` `metronome` `music-note` `recording` `ffmpeg` `demucs`
Client: `windows` `desktop-app` `webview2`
Generic: `server` `database` `queue` `storage` `container` `user` `internet` `generic`

An unknown type still loads, drawn as a plain block. Prefer an exact match;
fall back to a generic type rather than inventing one.

## Zones

`groups` are flat regions on the ground. `rect` is `[x, y, width, height]`.
Available kinds: `host` `docker-network` `desktop-machine` `lan` `vpc` `subnet` `az` `account` `group`.

Pick the boundary that matches the deployment. `host`, `docker-network`,
`desktop-machine` and `lan` describe systems that run on machines;
`vpc`, `subnet`, `az` and `account` describe a cloud account. Do not
reach for cloud scopes when the thing being drawn is one server.

Membership is geometric. A zone must actually enclose its members' footprints —
setting `group` on a node that sits outside the rectangle does not put it
inside. Leave at least one cell of margin on every side.

## Text annotations

`texts` are free-form notes. They lie on the ground by default, like
everything else flat; give one `"plane": "screen"` when it must stay square
to the viewer at every camera rotation.

```json
{ "id": "why", "text": "Retries land here\nafter 3 failures", "pos": [4, 9],
  "size": 16, "bold": true, "italic": false, "underline": false,
  "align": "left", "color": "#334155" }
```

`text` may contain `\n` for line breaks. `size` is in pixels (default 14),
`align` is `left`, `center` or `right`. Use these for explanations, captions
and callouts — anything that is commentary rather than a component.

## Placing flat things in the world

Text and pictures are flat rectangles and share four placement fields:

- `plane`: `floor` (lying on the ground, the DEFAULT), `screen`
  (square to the viewer whatever the camera does), or `right` / `left`
  (standing against a wall).
- `spin`: `0`, `90`, `180` or `270` degrees within that plane.
- `z`: elevation above the ground, in cells.
- `behind`: draw underneath the blocks, for a backdrop.

Captions take the same treatment through `labelPlane`, on blocks, zones and
edges. Blocks and edges default to `floor`; zones default to `right`,
standing the name along a far edge where it stays clear of the zone's contents.
An edge caption sits at the midpoint of the line either way -- `floor` lays it
alongside, `right` / `left` stand it up above the line.
`labelSize` sets the caption size in pixels (6-96, default 12):

`{ "id": "db", "type": "rds", "pos": [4, 0], "labelPlane": "right" }`
`{ "id": "prod-vpc", "kind": "vpc", "rect": [0, 0, 18, 12], "labelPlane": "floor" }`
`{ "from": "api", "to": "db", "label": "5432", "labelPlane": "screen" }`

Raise `labelSize` on the one or two blocks a diagram is really about; it
reads better than making them taller, which costs depth (see below).

Content never renders mirrored, whatever the camera rotation, so you can use
any plane freely.

## Pictures

```json
{ "id": "floorplan", "src": "data:image/webp;base64,UklGR...", "pos": [0, 0],
  "size": [20, 14], "plane": "floor", "opacity": 0.5, "behind": true }
```

`src` may be a data URL or an ordinary image URL; `size` is
`[width, height]` in cells within the plane. Do NOT invent data URLs -- only
emit an `images` entry when you were given a real one, or a real URL.

## Identifiers

Readable lower-case slugs, unique across nodes, groups, edges, texts AND images
in one document. Derive them from the label: "Payments API" becomes `payments-api`.
Never use UUIDs. `edges[].id` and `texts[].id` may be omitted.

## Laying it out well

- Leave a one-cell gap between blocks; touching blocks read as one mass.
- Run request flow along +x, and use +y to separate tiers.
- Vary `height` so the diagram has a silhouette: databases tall, gateways flat.
- Give a zone one cell of margin around its contents on every side.
- Keep a diagram under about 40 nodes; split larger systems into several.

### Do not let tall blocks hide short ones

This is the one layout rule with real consequences, because the view is
isometric. A block hides whatever is *behind* it, and behind means a smaller
`x + y`. The exact condition is:

    a front block hides a back block when
    (front.x + front.y) - (back.x + back.w + back.y + back.h) < 2 * (front.height - back.height)

Two things follow, and they make the rule easy to obey:

- A block that is **no taller** than the one behind it can never hide it. So if
  you place tall blocks at *low* `x + y` and short ones at high `x + y`, no
  clearance is needed anywhere.
- When a taller block must sit in front, give it `2 * the height difference`
  of extra `x + y`. A `height: 3` database in front of a `height: 1` gateway
  needs 4 more units of `x + y` than the footprints alone require.

Blocks side by side on screen — differing `x - y` — never hide each other
however close they are, so spreading along `x - y` costs nothing.

## Editing an existing diagram

When given a document to change, return the COMPLETE document, not a patch.
Preserve ids that already exist so the edit reads as a small diff — renaming an
id silently breaks every edge that pointed at it.

## What the loader forgives

Unknown types become generic blocks, duplicate ids get a numeric suffix, edges
naming a missing node are dropped, and out-of-range coordinates are clamped.
Each is reported as a warning. The only fatal error is text that is not JSON,
so make sure the output parses.
