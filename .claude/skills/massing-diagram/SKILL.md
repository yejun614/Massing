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

## Draw the whole system, then make it read well

Two things go wrong and they pull opposite ways. A diagram can be a tangle
nobody can follow, and it can be tidy and *wrong* — three blocks standing in
for a system that has a payment gateway, a vector store and an object store in
it. Everything after this section is written against the tangle, because the
tangle is what a person drawing by hand produces.

Reading it, a model produces the other one. Told a dozen times to draw less, it
draws a client, a server and a database, writes "architecture" across the top
and has answered a question nobody asked. So this section comes first and it
outranks every rule that follows:

**Every part of the system gets its own block.** The budgets below are spent on
connections, captions and colours. None of them is ever spent on a component.
There is no rule in this document that permits leaving out something that is
there, and "it would have been cluttered" is not one either — a system with
twenty parts is a diagram with twenty blocks, or it is two diagrams, each
complete in what it covers.

**No catch-alls.** `External APIs`, `Other services`, `3rd party`, `Infra` —
a caption that is a plural noun is several components someone declined to name,
and it is the most common way a diagram quietly loses two thirds of the system.
Four external services are four blocks: `Toss`, `Clova`, `S3`, `OpenAI`. If
they genuinely will not fit, that is a second diagram, not one block with a
shrug written on it.

### The order of work

1. **Inventory.** Before any JSON, list in prose every part of the system: each
   running process, each datastore, each external service it calls, each client
   that calls it, and how it is deployed. Count the list. That count is your
   block count.
2. **Group.** Sort the inventory into zones — what runs where, what is inside
   the boundary and what is outside it.
3. **Place.** Put the blocks on the grid in the order requests flow.
4. **Connect last, and least.** Only here does the connection budget apply.

Do the inventory even when the request is small; it costs three lines and it is
the step that decides whether the diagram is true rather than merely tidy. When
something on the list has no matching component type, draw it as a generic
block carrying its real name — never fold it into a neighbour.

## Start from these defaults

Diagrams get ugly because their authors try to make them *varied*. Start here,
and depart only where you can name the reason.

| Field | Default | When to depart |
|---|---|---|
| block `size` | `[2, 2]`, every block | almost never |
| block `height` | `1` — write it out, the type's own default varies | `0` for something lying flat |
| block `labelSize` | one value for all of them, 40–50 | never |
| block `labelPlane` | `left` or `right` — always set it | never |
| caption length | a proper noun of 10 characters or fewer | never |
| note `plane` | `floor`, the default — write nothing | never |
| note `size` | **50**; the 14px default is invisible on the floor | never |
| connection `labelSize` | **30**; the 12px default is unreadable | never |
| `screen`, on anything | do not use it | never |
| block count | one per thing in the inventory; 12–20 is usual | fewer only when the system really has fewer — past ~25, split the diagram |
| connection count | block count ÷ 3, at most | more means the grouping is wrong |
| zone `color` | a distinct hue per zone | zones of the same purpose share one |
| a nested zone's `color` | far from its parent's in hue AND lightness | never |
| the big title | exactly one zone at `labelSize: 96` | never |

Those numbers are measured from a diagram hand-tuned until it read well: 18
blocks, 6 connections, captions averaging six characters, every block 2x2.
Varying size, height and caption scale produces noise, not information.

## The grid

Diagrams live on an integer grid drawn in isometric projection.

    +z  height, straight up on screen
     |
 +y -+- +x       +x runs right-and-down, +y runs left-and-down

- `pos: [x, y]` is a block's MINIMUM corner, not its centre.
- `size: [width, depth]` and `height` are in cells.
- Every coordinate is an integer, and so is every footprint. Never emit
  fractions for those. `height` alone takes one decimal place, which is there
  for hand-tuning a drawing rather than for writing one — start at `1`.

A `[2, 2]` block at `[4, 4]` covers x 4–6 and y 4–6, so the next block in that
row starts at x 7 to leave a one-cell gap.

Two derived numbers decide everything on screen, and placing goes better if you
think in them rather than in x and y:

- **screen-horizontal position = `x - y`.** Differ here and two blocks can
  never hide each other, however close they are.
- **depth, larger being nearer the viewer, = `x + y`.**

## Shape of the file

```json
{
  "version": 1,
  "meta": { "title": "Payments service" },
  "canvas": { "background": "#eef1f5" },
  "groups": [
    { "id": "prod", "kind": "vpc", "label": "Production", "rect": [0, 0, 20, 16],
      "color": "#eab308", "labelSize": 96, "labelPlane": "right" }
  ],
  "nodes": [
    { "id": "api", "type": "springboot", "label": "Payments", "pos": [3, 3],
      "size": [2, 2], "height": 1, "color": "#12a37a",
      "labelSize": 44, "labelPlane": "right", "group": "prod" },
    { "id": "ledger", "type": "postgresql", "label": "Ledger", "pos": [9, 3],
      "size": [2, 2], "height": 1, "color": "#b4530f",
      "labelSize": 44, "labelPlane": "right", "group": "prod" }
  ],
  "edges": [
    { "id": "api-ledger", "from": "api", "to": "ledger", "label": "5432",
      "style": "solid", "arrow": "end", "color": "#64748b" }
  ],
  "texts": [
    { "id": "note", "text": "Write path only", "pos": [3, 9], "bold": true }
  ]
}
```

`groups`, `edges`, `texts`, `images`, `shapes`, `canvas`, `size` and
`color` are all
optional; omitted fields take the component type's defaults.

| Applies to | Fields |
|---|---|
| everything | `id` (unique across the whole document), `label`, `color` |
| block | `type`, `pos`, `size`, `height`, `group`, `labelPlane`, `labelSize`, `labelAlign` |
| zone | `kind`, `rect: [x, y, w, h]`, `parent`, `labelPlane`, `labelSize` |
| connection | `from`, `to`, `style`, `arrow`, `route`, `bend`, `labelPlane`, `labelSize`, `labelAlign` |
| note | `text` (`\n` allowed), `pos`, `size`, `bold`, `italic`, `underline`, `align` |
| picture | `src`, `pos`, `size`, `opacity` |
| anything flat | `plane`, `spin`, `z`, `behind` |

A connection's `from` and `to` may name a **zone** as readily as a block, so
"this subnet peers with that one" is one connection:
`{ "from": "prod-vpc", "to": "dr-vpc", "label": "peering", "style": "dashed" }`

Routing is automatic and usually right; leave it alone. Only when two lines
would land on top of each other, pin one aside with `route` (`x` or `y`, the
axis it turns on) and `bend` (where it crosses over, in half cells):
`{ "from": "api", "to": "db", "route": "x", "bend": 6.5 }`

## Several drawings in one file

When the block count passes about 25 the answer is two diagrams, and `tabs` is
where the second one goes — the collections move one level down, each tab
carrying its own `groups`, `nodes`, `edges`, `texts`, `images`, `shapes` and
`cells`:

```json
{
  "version": 1,
  "meta": { "title": "Payments service" },
  "tabs": [
    { "name": "Overview", "nodes": [], "edges": [] },
    { "name": "Write path", "nodes": [], "edges": [] }
  ]
}
```

- **One drawing writes no tabs at all.** Put the collections at the top level,
  as above. A single-tab wrapper is the same file with an extra layer around it.
- `meta` and `canvas` belong to the file. A tab has a `name` and drawings.
- Ids only have to be unique **within** one tab, and a connection can only join
  two things in its own tab. Nothing crosses.
- Name a tab after what it shows — "Overview", "Write path", "Failover" — since
  that name is all anyone has before they click it. Forty characters at most;
  a longer one is cut on load.

Reach for this when one picture would have to answer two questions: a system
overview and the inside of one service, a before and an after, the happy path
and the failure path. Do not reach for it to dodge a crowded drawing — a
diagram split down the middle for want of space reads worse than the crowd.

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

## Drawing a codebase

Asked for "the architecture of this repository", what is wanted is the system
the code runs as — not its folder tree. A box per directory under
`src/main/java` is a screenshot of the file explorer; a single `App` block is
not an architecture either. What belongs on the page is everything the process
talks to, plus whatever internal structure the code actually commits to.

Five places hold the inventory, and each holds a part the others do not:

| Where to look | What it gives you |
|---|---|
| the build file — `build.gradle`, `pom.xml`, `package.json`, `pyproject.toml` | **every external system, one dependency at a time.** The richest source, and the one most often skipped |
| `docker-compose.yml`, `Dockerfile`, k8s or Helm manifests | what runs alongside it, and what it is deployed onto |
| CI workflows | the release path: registry, manifest repository, cluster |
| configuration — `application.yml`, `.env.example` | hosts, buckets, queues and vendor keys, which name services the build file missed |
| the top two levels of the source tree | the internal structure, where there is one worth drawing |

### A Spring Boot service

The dependency list *is* the inventory, and it maps almost one to one. Every
row that appears in the build is a block on the page:

| In the build | Draw |
|---|---|
| `spring-boot-starter-web` / `webflux` | the `springboot` block: the process itself |
| a JDBC driver — `mysql-connector-j`, `postgresql` | `mysql` / `postgresql`, whichever it actually is. Not the other one |
| `spring-boot-starter-data-redis`, `spring-session-data-redis` | `redis` |
| `spring-boot-starter-security`, `oauth2-client`, a JWT library | `oauth2` and `jwt` — authentication is a component, not an adjective |
| an AWS, GCS or MinIO SDK | `s3` or `storage` |
| `spring-ai-*`, an LLM client, a vector-store client | `llm` for the model, a `database` block for the vector store |
| `spring-boot-starter-mail` with a template engine | a `generic` block named for the mail provider |
| a payments, OCR, maps or messaging client | one `generic` block **each**, named for the vendor |
| `spring-kafka`, `spring-amqp` | `queue` / `rabbitmq` |
| `spring-boot-starter-actuator`, Micrometer, an agent | `healthcheck` or `prometheus`, when monitoring is part of the question |
| a Dockerfile, a CI workflow, a manifest repository | `docker`, `dockerhub`, `kubernetes` — the release path is part of the architecture whenever the question is about deployment |

A service wired to MySQL, Redis, S3, a vector store, an LLM, a payment gateway,
an OCR API and SMTP has **eight** blocks around it before its own structure is
drawn at all. Collapsing six of them into one block called `External` is
exactly the failure this section exists to prevent.

**Draw internal structure only where the code commits to one.** The flat
`controller / service / repository` split is what every Spring project has and
says nothing; leave it as the one `springboot` block. A layout the team chose
is a real decision and belongs on the page: hexagonal
`adapter / application / domain`, a module per bounded context, a separate
batch or admin process. Draw those as **zones** of kind `group`, one block
inside each for what it holds, with request flow running across them along +x.

A second process is always a second block — a batch worker, a scheduler, an
admin API, an SSE or websocket endpoint held open on its own.

### Never draw one from its name

You cannot open a URL or read a disk from here. Given a repository link and
nothing else you know the name, and a diagram drawn from a name comes out
plausible and false — which is worse than none. It will say AWS for a service
deployed on Oracle Cloud and PostgreSQL for one running MySQL, and nobody
looking at the picture can tell which parts were read and which were invented.

So do not guess. Ask for the build file, the dependency list, or the output of
`tree` — through `ask_user` where that tool is offered, in your reply where it
is not. Name the choice being made: the real system, which needs those files,
or a typical service of that kind, which is a perfectly good thing to want and
must be captioned as what it is.

## Zones

`groups` are flat regions on the ground. `rect` is `[x, y, width, height]`.
Available kinds: `host` `docker-network` `desktop-machine` `lan` `vpc` `subnet` `az` `account` `group`.

Pick the boundary that matches the deployment. `host`, `docker-network`,
`desktop-machine` and `lan` describe systems that run on machines;
`vpc`, `subnet`, `az` and `account` describe a cloud account. Do not
reach for cloud scopes when the thing being drawn is one server.

Membership is geometric. A zone must actually enclose its members' footprints —
setting `group` on a block that sits outside the rectangle does not put it
inside. Leave at least one cell of margin on every side; contents flush against
the boundary read as clipped. Zones may nest through `parent`, but sibling
zones must not partially overlap: nest one fully inside the other, or separate
them completely.

A big title on every zone makes the titles fight each other. Give exactly one
zone `labelSize: 96` and leave the rest at the default. `"label": ""` draws no
caption at all — but on a zone the renderer then prints the kind name instead
(`desktop-machine` becomes "Desktop machine"), so fill it in unless that is
what you wanted.

### A nested zone needs contrast with the one holding it

Zones are translucent slabs, so a zone inside a zone is painted **over** its
parent's colour, and its caption is drawn in a darkened shade of its own. Give
a subnet a colour near its VPC's and three things go at once: the inner slab
stops having a visible edge, its caption sinks into the slab it is written on,
and the two zones read as one.

Near means near in **hue**, and yellow `#eab308` against olive `#7aa116` is
about 30° apart — close enough that the inner zone all but vanishes. Put at
least a quarter turn of the colour wheel between a zone and its parent, and
lean on a difference in lightness as well as hue. Siblings that do not overlap
are free to be closer; it is the nesting that costs.

## Captions

This is where most diagrams fail.

**Always set `labelPlane` on a block.** The default is `floor`, which lays the
caption on the ground skewed 45°, where a name is barely readable. Stand it up
against the wall the block's cluster faces: `left` for a cluster on the left,
`right` for one on the right.

**Not `screen`.** It is the obvious escape and it is the wrong one: a caption
square to the viewer sits on top of the picture rather than in it, and one
block wearing a flat label among a dozen standing ones looks like a mistake.
If captions are colliding, the answer is shorter captions or more space
between blocks, not a caption pulled out of the scene.

**Captions are proper nouns of ten characters or fewer.** No sentences.

| Write | Not |
|---|---|
| `Spring` | `Rooms and login API` |
| `Demucs` | `AI splits it per instrument` |
| `Relay` | `TURN — only when blocked` |
| `Storage` | `Source audio and stem tracks` |

When an explanation is genuinely needed it goes in `texts` or on a connection,
never in a block's caption. The moment prose goes into a caption, captions
start colliding with blocks.

**One size for peers.** Every peer block gets the same `labelSize`, 40–50.
Do not build hierarchy out of block captions; build it out of the one big zone
title. Valid range is 6–96.

## Connections

**You get one connection per three blocks.** Six blocks, two connections.
Twelve blocks, four. Work the number out before you draw any, and treat it as
the budget it is — this is the single rule that decides whether a diagram reads
or turns into a tangle, and it is the one most often broken by someone who
agreed with it a paragraph earlier.

**The budget is on connections and nothing else.** It never means drawing fewer
blocks. Asked for two web servers, draw two web servers and connect one of
them — a diagram that quietly lost a block to come in under budget has answered
a question nobody asked, and is a worse failure than the tangle the budget
exists to prevent.

The default is therefore *not to draw a connection*. Sharing a zone already
states the relationship, so spend the budget only on what grouping cannot say.

Do not draw:

- icons that sit right next to each other (`user → app`, `developer → repo`)
- the obvious interior of a zone (`API → DB`, `API → cache`)
- **anything that repeats a statement already made.** This is what overspends
  the budget, every time, and it looks reasonable while you are doing it. A load
  balancer in front of two web servers is `alb → web-1` and nothing else: the
  second arm says what the first one said, and both servers reaching the same
  database says it twice more. Both servers are still *drawn* — four blocks, one
  connection.
- what a chain already implies: given `A→B→C`, drop `A→C`

Do draw:

- relationships that cross a zone boundary
- pipeline order that placement cannot show (`queue → worker → storage`)
- exceptional and conditional paths

`arrow` is `end` (the default), `start`, `both` or `none`. Use `none` for
relationships with no direction — peer, P2P, mutual; a single arrowhead on a
peer link is simply wrong. `style` is `solid`, `dashed` or `dotted`; dashed
reads as conditional or fallback. Giving a connection the colour of the blocks
it joins makes it readable with no caption at all, so label only the two or
three that carry meaning and leave the rest bare. When you do label one, give
it `"labelSize": 30` — the 12px default is a connection caption you have to go
looking for.

### Every connection must be followable end to end

A line nobody can trace is worse than no line, and there are only three ways to
lose one. Fix each by moving a block, never by adding another line.

**It runs under a block.** Routing is orthogonal, so a connection leaves as a
run along x and a run along y — two elbows are possible and the router takes
whichever passes through fewer blocks. If a block sits on *both*, the line
disappears behind it and reappears somewhere else, and the eye joins it to the
wrong thing.

**It lies on top of another connection.** Two runs along the same row are one
thick line, and which end belongs to which is now a guess. Crossings are nearly
as bad at this density: with a connection per three blocks, a diagram that
still has lines crossing is one whose blocks are in the wrong order.

**It goes the long way round.** Place the two ends of a connection in the same
row or the same column and the run is a straight line with nothing to follow —
that is the target, and it is worth moving a block to get it. Failing that, one
clean elbow. If a line sprawls across the diagram, the block is in the wrong
place; a block with more than five connections means the grouping is.

**Count them before you hand the document over.** More connections than blocks
÷ 3 means at least one of them is saying something the grouping already says.
Find that one and delete it, rather than looking for a reason why this diagram
is the exception.

Routing is automatic and gets this right on its own most of the time. `route`
and `bend` are for pinning one aside when it does not, not for rescuing a
layout that has lines in it that cannot be followed.

## Layout

Put blocks on a regular pitch — every 5 cells in x, every 4–6 in y. Irregular
origins read as sloppiness rather than as design.

    x origins:  7, 14 …  24, 25 …  34, 39 …  48, 53
    y origins:  8, 12, 13, 16, 18 …  24, 25, 30

Run request flow along +x and separate tiers with +y. Spreading along `x - y`
is free: blocks side by side on screen never hide each other.

Use heights 0 and 1 only. Swinging height up to 3 makes front blocks swallow
the ones behind them, and with only 0 and 1 in play occlusion disappears
entirely. Keep a diagram under about 40 blocks; split larger systems into
several.

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
  of extra `x + y`.

## Placing flat things in the world

Notes and pictures are flat rectangles and share four placement fields:

- `plane`: `floor` (lying on the ground, the DEFAULT), `right` / `left`
  (standing against a wall), or `screen` (square to the viewer whatever the
  camera does).
- `spin`: `0`, `90`, `180` or `270` degrees within that plane.
- `z`: elevation above the ground, in cells.
- `behind`: draw underneath the blocks, for a backdrop.

Three of those four are in the world and one is not. **Leave `screen` alone.**
It survives every camera rotation, which is exactly why it reads as an overlay
stuck on the front of the picture instead of as part of it — and the moment one
thing is pinned to the viewer, rotating the diagram slides it across
everything else.

Captions take the same treatment through `labelPlane`, on blocks, zones and
connections. Blocks and connections default to `floor`; zones default to
`right`, standing the name along a far edge where it stays clear of the zone's
contents. A connection's caption sits at the midpoint of the line either way —
`floor` lays it alongside, `right` / `left` stand it up above the line.

`labelAlign` (`left`, `center`, `right`; default `center`) lines a block's
caption up with its own left edge, centre or right edge, and decides which end
of a connection's caption is pinned to the line's midpoint. Leave it out unless
a caption is crowding something.

Content never renders mirrored, whatever the camera rotation, so you can use
any plane freely.

## Text annotations

`texts` are free-form notes — explanations, captions and callouts, anything
that is commentary rather than a component.

```json
{ "id": "why", "text": "Retries land here\nafter 3 failures", "pos": [4, 9],
  "size": 30, "italic": true, "align": "left", "color": "#64748b" }
```

**Leave a note on the floor.** A block's caption has to stand up because it
names one small thing and must be read against it, but a note is a paragraph
laid out on the ground of the scene — skewed with everything else, turning with
the camera, reading like writing on the floor plan rather than a sticker on the
glass. This is the one place the `floor` default is already the right answer,
so write no `plane` at all.

What makes that work is size. Floor text is foreshortened twice over — squashed
by the projection and skewed 45° — so a note at the 14px default is a smudge
nobody reads. **Set `size` to 50.** That is not a typo and not "big": it is
about what a 40px block caption comes out as once the ground has taken its cut.

At 50px a line is wide, so keep them short — two or three lines of four or five
words, split with `\n` — and park the note in open ground beside the diagram
rather than across it. `align` is `left`, `center` or `right`.

## Algorithms and data flow: flowchart shapes

`shapes` are flat outlines lying on the ground, for the parts of a picture that
are steps rather than things. A server is a cuboid because it occupies space;
"if b = 0" does not, and the century-old convention for it is a silhouette:
diamond for a question, stadium for where the thing starts and stops.

```json
{ "id": "check", "kind": "decision", "label": "b = 0 ?", "pos": [5, 8],
  "size": [6, 4], "yes": "yes", "no": "no" }
```

| `kind` | For |
|---|---|
| `terminal` | Where the algorithm begins or ends. Default `size` `[4, 2]` |
| `process` | A step that does something. `[5, 2]` |
| `decision` | A question. `[5, 3]` — give it more depth than a process, or the diamond gets thin |
| `io` | Something read in or written out. `[5, 2]` |
| `subroutine` | A step defined elsewhere. `[5, 2]` |
| `connector` | Picks a line up where it was left off. `[2, 2]` |

**A shape stands up.** `height` defaults to `0.5` — half a cell of thickness,
so the silhouette is a slab with sides rather than an outline on the floor. Read
flat through the isometric skew a diamond is a parallelogram, and the sides are
what stop it looking like one. Leave it alone unless a step should stand as tall
as a block; `0` lays it flat.

**A shape is a connection endpoint like any block**, so `edges` join them with
the same `from` and `to`, and the line stops on the real silhouette — on the
slope of a diamond, on the curve of a connector — rather than on a box around
it. That is the whole reason these are shapes and not labelled squares.

**Only a `decision` uses `yes` and `no`.** They are written beside it, at
`yesAt` and `noAt` — `top`, `right`, `bottom` or `left`, defaulting to `right`
and `bottom`. Set them to the sides the two branches actually leave from, or
they will point at nothing.

**Captions lie on the shape's top face** by default, like every other caption
here, so a step reads as writing on the slab rather than a sign floating over
it. Keep them short for that reason — a few words, not a sentence — and set
`labelPlane` to `screen` only on the odd step whose words must be read square.

Lay a flowchart out down the diagram — each step a few cells below the last, on
one column, with the branch of a decision stepping sideways. Do not mix a
flowchart into a diagram of servers: one drawing answers "what is deployed", the
other "what happens", and a file can hold both as separate tabs.

## Data structures: arrays, stacks, queues, matrices

`cells` is a run of slots. One entity for all four, because they are one picture
and what tells them apart is the shape of the run: a stack is one column, a
queue is one row, a matrix is both.

```json
{ "id": "a", "label": "a", "pos": [0, 0], "cols": 7,
  "items": ["3", "1", "4", "1", "5", "9"],
  "indices": true, "marks": [{ "text": "i", "at": 2 }] }
```

`cols` and `rows` are how many slots; `slot` is one slot's footprint, default
`[2, 2]` — square, like an array's boxes anywhere else. `items` fills them row-major and may be shorter than the grid — an
array with room left in it is a thing people draw on purpose. `indices` writes
numbers along the edges; turn it on only when *where* a value sits is the point.

`marks` are the pointers that make an algorithm legible: `{ "text": "top", "at":
4 }` names a slot by index, so it stays on that slot. Use them for `i`, `j`,
`head`, `tail`, `top` — the things prose would otherwise have to say.

`ends` names the two ends — `["Front", "Back"]` on a queue, `["top",
"bottom"]` on a stack — and `flow` (`back` or `forward`) marks which way things
travel through it. Between them they are what makes a picture of a queue read as
a queue rather than as a row of boxes. The name in `label` sits over the run.

A structure is a connection endpoint like a block, so an edge can run from the
step that touches it to the structure itself. Draw the algorithm as `shapes` and
the data it works on as `cells`, side by side.

## Pictures and logos

Real brand logos change the impression of a diagram more than anything else,
and a logo standing on a zone's wall does the naming that a big caption would
otherwise have to do.

```json
{ "id": "logo-docker", "src": "data:image/svg+xml;base64,PHN2Zy...",
  "pos": [15, 4], "size": [5, 5], "plane": "left" }
```

**Never fabricate a data URL.** Emit an `images` entry only for a file you
actually downloaded or a URL you verified; `src` may be either. Iconify's
`logos` collection is CC0 and full-colour, and is the first place to look:

    curl -sL -o logo.svg "https://api.iconify.design/logos/docker-icon.svg"

A correct filename does not mean correct artwork — several of the AWS icon
files on Wikimedia Commons are a coloured rounded rectangle with no glyph in
them at all. Judge by how much path data an SVG carries, not by how many shapes
it has: a glyph-less plate is around 125 characters of path data, while genuine
single-path logos run 450–700. If the file says `width="1em" height="1em"`,
replace that with the viewBox's pixel size or the logo renders blurry at 16px.

Base64 is not something to type out by hand; inject it with a script. Match
`size` to the source's aspect ratio (a square mark `[5, 5]`, a wordmark
`[9, 3]`) or the logo stretches, and set `plane` to the wall its zone faces —
a logo lying on the floor does not read as a logo. Standing pictures cover what
is behind and above them easily, so keep them clear of blocks.

## Colour

Give each zone a distinct hue, and zones of the same purpose the same one —
except where one zone sits inside another, which always wins: a nested zone
takes the colour furthest from its parent's, whatever else it has in common
with its siblings. Two subnets in one VPC are the same kind of thing and still
must not both be the VPC's colour.

Group block colours by role, one colour per tier. A palette that worked:

    zones  purple #a855f7   yellow #eab308   blue #2563eb   orange #ed7100
           green  #7aa116   pink   #e7157b
    blocks green #12a37a (apps, APIs)   teal #1f8f8f (network)
           brown #b4530f (storage)      purple #6d4bd6 (AI)
           blue  #2c7de0 (CI/CD)        slate #5a6b7b (people)
    lines  slate #64748b
    canvas #eef1f5

`canvas.background` is optional, and leaving it out is a real choice: a diagram
that names no colour follows the viewer's light or dark theme instead of being
a white rectangle in a dark room.

## Links

Anything you draw may carry a `link`, and clicking it follows that link. One
string, whose form says where it goes:

```json
{ "id": "auth", "type": "cognito", "pos": [4, 4], "link": "#token-store" }
{ "id": "inner", "kind": "process", "pos": [0, 0], "link": "tab:Write path" }
{ "id": "docs", "text": "Runbook", "pos": [2, 9], "link": "https://example.com/runbook" }
```

- `#element-id` — another element. The camera flies to it. It may be in another
  drawing of the same file; the one you are on is searched first.
- `tab:Name` — another drawing, by name. This is the one that makes a multi-tab
  file navigable rather than a stack of unrelated pictures.
- anything else — a web address, opened after a confirmation. `example.com/x` is
  read as https. **Only http, https and mailto are ever opened**; a
  `javascript:` or `data:` link is kept in the file and refuses to be followed.

Use them for the two things a single picture cannot do:

- **An overview block that opens its own detail drawing.** This is what makes
  the "two diagrams past 25 blocks" rule above work as one document instead of
  two: put `"link": "tab:Write path"` on the block the second drawing is about,
  and the overview becomes the index.
- **A block that opens the thing it stands for** — a repository, a dashboard, a
  runbook, an API reference. A diagram is usually the map somebody arrives at
  first, and a map whose landmarks lead somewhere is worth far more than one
  that has to be read alongside a list of URLs.

Link deliberately, not everywhere. A badge on every block is a badge that says
nothing, and the point of the mark is that it picks something out.

## Identifiers

Readable lower-case slugs, unique across blocks, zones, connections, notes AND
pictures in one document. Derive them from the caption: "Payments API" becomes
`payments-api`. Never use UUIDs.

## Editing an existing diagram

Return the COMPLETE document, not a patch. Never rename an id that already
exists — renaming silently breaks every connection that pointed at it, and
keeping ids is what makes the edit read as a small diff.

## What the loader forgives, and what it refuses

Unknown types become generic blocks, duplicate ids get a numeric suffix,
connections naming a missing block are dropped, and out-of-range coordinates
are clamped. Each is reported as a warning.

Two things are refused outright: text that is not JSON, and JSON that is not a
diagram — an object carrying none of `nodes`, `groups`, `edges`, `texts`,
`images` or `tabs` is rejected rather than opened as an empty canvas. So make
sure the output parses, and that it has content in the collections named above.

## Check it before you hand it over

Save the script below as `validate.mjs` — the extension matters, it is ESM —
and run `node validate.mjs diagram.arch.json` every time you write the JSON.
It exits 1 if anything is an ERROR.

```js
#!/usr/bin/env node
/**
 * ERROR  the render is visibly broken. Fix it before handing the file over.
 * WARN   usually makes the diagram uglier. Fix unless you can name the reason.
 * INFO   numbers for reference.
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node validate.mjs <diagram.arch.json>')
  process.exit(2)
}

let doc
try {
  doc = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  console.error('ERROR  JSON did not parse — ' + e.message)
  process.exit(1)
}

const errors = [], warns = [], infos = []

/**
 * A file may hold several drawings under `tabs`, and each is checked on its
 * own: ids and coordinates only ever have to agree within one drawing, so
 * merging them would invent clashes that nobody can see.
 */
const drawings = Array.isArray(doc.tabs) && doc.tabs.length
  ? doc.tabs.map((t, i) => [t, (t.name ?? 'tab ' + (i + 1)) + ': '])
  : [[doc, '']]

for (const [view, where] of drawings) {
  const groups = view.groups ?? []
  const nodes = view.nodes ?? []
  const edges = view.edges ?? []
  const texts = view.texts ?? []
  const images = view.images ?? []

  const err = (m) => errors.push(where + m)
  const warn = (m) => warns.push(where + m)
  const info = (m) => infos.push(where + m)

  /** Footprint of a flat thing as [x0, y0, x1, y1]. */
  const box = (o) => {
    const [w, h] = o.size ?? [2, 2]
    return [o.pos[0], o.pos[1], o.pos[0] + w, o.pos[1] + h]
  }
  const rectBox = (g) => [g.rect[0], g.rect[1], g.rect[0] + g.rect[2], g.rect[1] + g.rect[3]]
  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
  // Unset means the component type decides, and those run 1 to 3.
  const heightOf = (n) => (Number.isFinite(n.height) ? n.height : 2)

  // --- identifiers -----------------------------------------------------------
  const seen = new Set()
  for (const o of [...groups, ...nodes, ...edges, ...texts, ...images]) {
    if (o.id == null) continue
    if (seen.has(o.id)) err('duplicate id "' + o.id + '" — the loader renames it with a suffix')
    seen.add(o.id)
  }
  const anchors = new Set([...groups, ...nodes].map((o) => o.id))
  for (const e of edges) {
    for (const end of ['from', 'to']) {
      if (!anchors.has(e[end])) {
        err('edge ' + (e.id ?? e.from + '->' + e.to) + ' has ' + end + '="' + e[end] +
            '", which does not exist — this edge is dropped silently')
      }
    }
  }

  // --- coordinates -----------------------------------------------------------
  // Negative coordinates are fine — the origin is not a corner of the world —
  // but a fractional one is not, and the loader rounds it somewhere you did not
  // ask for.
  for (const o of [...nodes, ...texts, ...images]) {
    const p = Array.isArray(o.pos) ? o.pos : []
    if (p.some((v) => !Number.isInteger(v))) err(o.id + ' pos is not integral')
    // A note's size is one number, a block's and a picture's is [w, h].
    if (Array.isArray(o.size) && o.size.some((v) => !Number.isInteger(v) || v <= 0)) {
      err(o.id + ' size must be positive integers')
    }
  }
  for (const g of groups) {
    if (!g.rect?.every(Number.isInteger)) err('zone ' + g.id + ' rect is not integral')
  }

  // --- block collisions ------------------------------------------------------
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (overlaps(box(nodes[i]), box(nodes[j]))) err('blocks overlap: ' + nodes[i].id + ' / ' + nodes[j].id)
    }
  }

  // --- zone membership, with a cell of margin all round ----------------------
  for (const n of nodes) {
    if (!n.group) continue
    const g = groups.find((x) => x.id === n.group)
    if (!g) { err(n.id + ' names group "' + n.group + '", which does not exist'); continue }
    const [gx0, gy0, gx1, gy1] = rectBox(g)
    const [x0, y0, x1, y1] = box(n)
    if (!(x0 > gx0 && y0 > gy0 && x1 < gx1 && y1 < gy1)) {
      err(n.id + ' is not inside zone ' + g.id + ' with a cell of margin — membership is geometric')
    }
  }

  // --- sibling zones may nest, but must not half-overlap ---------------------
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = rectBox(groups[i]), b = rectBox(groups[j])
      if (!overlaps(a, b)) continue
      const aInB = a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3]
      const bInA = b[0] >= a[0] && b[1] >= a[1] && b[2] <= a[2] && b[3] <= a[3]
      if (!aInB && !bInA) {
        warn('zones ' + groups[i].id + ' and ' + groups[j].id +
             ' partially overlap — nest fully or separate fully')
      }
    }
  }

  // --- occlusion -------------------------------------------------------------
  for (const f of nodes) {
    for (const b of nodes) {
      if (f === b) continue
      const [fx0, fy0, fx1, fy1] = box(f)
      const [bx0, by0, bx1, by1] = box(b)
      const fh = heightOf(f), bh = heightOf(b)
      if (fh <= bh) continue                  // no taller, so it can never hide it
      if (fx0 + fy0 <= bx0 + by0) continue    // not in front
      if (fx1 - fy0 < bx0 - by1 || bx1 - by0 < fx0 - fy1) continue  // side by side
      const slack = fx0 + fy0 - (bx1 + by1)
      const need = 2 * (fh - bh)
      if (slack < need) {
        err(f.id + ' hides ' + b.id + ' — needs ' + need + ' of x+y clearance, has ' + slack)
      }
    }
  }

  // --- pictures --------------------------------------------------------------
  for (const im of images) {
    if ((im.plane ?? 'floor') === 'floor') {
      for (const n of nodes) {
        if (overlaps(box(im), box(n))) warn('image ' + im.id + ' lies on top of block ' + n.id)
      }
      info('image ' + im.id + ' lies flat; for a logo, left/right usually reads better')
    }
    const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(im.src ?? '')
    if (!m) {
      if (im.src && !/^https?:\/\//.test(im.src)) err('image ' + im.id + ' src is neither a data URL nor http')
      continue
    }
    if (m[1] !== 'image/svg+xml') continue
    let svg = ''
    try { svg = Buffer.from(m[2], 'base64').toString('utf8') } catch { /* binary */ }
    if (!/<svg[\s>]/.test(svg)) { err('image ' + im.id + ' does not decode to SVG'); continue }
    // A glyph-less plate is judged by path-data volume, not by shape count:
    // measured, an empty plate is ~125 characters and a real logo 450-700.
    const shapes = (svg.match(/<(path|polygon|circle|rect|polyline|ellipse)[\s>]/g) ?? []).length
    const chars = [...svg.matchAll(/\sd="([^"]*)"/g)].reduce((s, x) => s + x[1].length, 0)
    if (shapes <= 2 && chars < 250) {
      warn('image ' + im.id + ' has ' + shapes + ' shapes and ' + chars +
           ' characters of path data — probably a glyph-less plate. Look at it')
    }
    if (/width="1em"/.test(svg)) warn('image ' + im.id + ' says width="1em" — it renders blurry at 16px')
  }

  // --- captions --------------------------------------------------------------
  const PLANES = new Set(['floor', 'screen', 'left', 'right'])
  for (const n of nodes) {
    if (!n.labelPlane) warn(n.id + ' has no labelPlane — its caption lies skewed on the floor')
    else if (!PLANES.has(n.labelPlane)) err(n.id + ' labelPlane "' + n.labelPlane + '" is not a known plane')
    else if (n.labelPlane === 'screen') {
      warn(n.id + ' has labelPlane "screen" — that sits on top of the picture, not in it. Use left or right')
    }
    if (n.label && [...n.label].length > 12) {
      warn(n.id + ' caption is ' + [...n.label].length + ' characters ("' + n.label +
           '") — cut it to a proper noun of ten or fewer')
    }
  }
  for (const g of groups) {
    if (!g.label?.trim()) warn('zone ' + g.id + ' has no caption — the renderer prints its kind name instead')
  }

  // --- catch-alls, which is how a diagram loses two thirds of the system -----
  // A plural caption is several components someone declined to name. This
  // cannot be proved from the JSON alone, so it warns rather than fails --
  // but the false positives are rare and the thing it catches is severe.
  const CATCH_ALL = /^(external|externals|other|others|etc|misc|infra|3rd[- ]party|third[- ]party|various|integrations?)\b|(apis|services|systems|clients|providers|externals|integrations)$/i
  for (const n of nodes) {
    const label = (n.label ?? '').trim()
    if (label && CATCH_ALL.test(label)) {
      warn(n.id + ' is captioned "' + label + '" — that reads as several components folded ' +
           'into one. Draw each of them, named')
    }
  }

  // --- notes -----------------------------------------------------------------
  for (const t of texts) {
    if (t.plane === 'screen') {
      warn('note ' + t.id + ' is pinned to the viewer — a note belongs on the floor of the scene')
    }
    // Floor text is foreshortened, so the 14px default is unreadable there.
    if ((t.plane ?? 'floor') === 'floor' && (t.size ?? 14) < 40) {
      warn('note ' + t.id + ' is ' + (t.size ?? 14) + 'px on the floor — 50 is what it takes to read')
    }
  }
  for (const e of edges) {
    if (e.label?.trim() && (e.labelSize ?? 12) < 24) {
      warn('edge ' + (e.id ?? e.from + '->' + e.to) + ' has a caption at ' + (e.labelSize ?? 12) +
           'px — raise it to 30')
    }
  }

  // --- zone contrast ---------------------------------------------------------
  /** [hue in degrees, lightness 0-1] of a #rrggbb colour. */
  const hsl = (hex) => {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
    let h = 0
    if (d) {
      if (max === r) h = ((g - b) / d) % 6
      else if (max === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
    }
    return [((h * 60) % 360 + 360) % 360, (max + min) / 2]
  }
  const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }

  for (const g of groups) {
    const parent = groups.find((p) => p.id === g.parent)
    if (!parent || !/^#[0-9a-f]{6}$/i.test(g.color ?? '') || !/^#[0-9a-f]{6}$/i.test(parent.color ?? '')) continue
    const [gh, gl] = hsl(g.color), [ph, pl] = hsl(parent.color)
    // A nested zone is painted over its parent and captioned in a shade of
    // itself, so a near hue makes both the slab edge and the caption vanish.
    if (hueGap(gh, ph) < 40 && Math.abs(gl - pl) < 0.25) {
      warn('zone ' + g.id + ' (' + g.color + ') is too close to its parent ' + parent.id +
           ' (' + parent.color + ') — ' + Math.round(hueGap(gh, ph)) + '° of hue apart. Nested zones need a quarter turn')
    }
  }

  // --- connections you can follow --------------------------------------------
  const anchorOf = (id) => {
    const n = nodes.find((x) => x.id === id)
    if (n) return box(n)
    const g = groups.find((x) => x.id === id)
    return g ? rectBox(g) : null
  }
  const mid = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]

  /** Does the segment p-q touch rectangle r? Liang-Barsky. */
  const cuts = ([x0, y0], [x1, y1], [rx0, ry0, rx1, ry1]) => {
    let t0 = 0, t1 = 1
    const dx = x1 - x0, dy = y1 - y0
    for (const [p, q] of [[-dx, x0 - rx0], [dx, rx1 - x0], [-dy, y0 - ry0], [dy, ry1 - y0]]) {
      if (p === 0) { if (q < 0) return false; continue }
      const t = q / p
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t }
      else { if (t < t0) return false; if (t < t1) t1 = t }
    }
    return true
  }

  for (const e of edges) {
    const a = anchorOf(e.from), b = anchorOf(e.to)
    if (!a || !b) continue
    const [p, q] = [mid(a), mid(b)]
    // The two elbows the router chooses between: along x first, or along y first.
    const elbows = [[p, [q[0], p[1]], q], [p, [p[0], q[1]], q]]
    const blockedBy = elbows.map((path) => nodes.filter((n) =>
      n.id !== e.from && n.id !== e.to &&
      (cuts(path[0], path[1], box(n)) || cuts(path[1], path[2], box(n)))).map((n) => n.id))
    // Only when BOTH routes are obstructed is the line certain to vanish behind
    // something; the router takes whichever passes through fewer blocks.
    if (blockedBy.every((hit) => hit.length)) {
      warn('edge ' + (e.id ?? e.from + '->' + e.to) + ' runs under ' +
           [...new Set(blockedBy.flat())].join(', ') + ' whichever way it turns — move a block')
    }
  }

  const side = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [x, y] = [edges[i], edges[j]]
      if ([x.from, x.to].some((id) => id === y.from || id === y.to)) continue // meeting at a block is fine
      const [a, b, c, d] = [anchorOf(x.from), anchorOf(x.to), anchorOf(y.from), anchorOf(y.to)]
      if (!a || !b || !c || !d) continue
      const [p, q, r, s] = [mid(a), mid(b), mid(c), mid(d)]
      const straddles = (side(p, q, r) > 0) !== (side(p, q, s) > 0) &&
                        (side(r, s, p) > 0) !== (side(r, s, q) > 0)
      if (straddles) {
        warn('edges ' + (x.id ?? x.from + '->' + x.to) + ' and ' + (y.id ?? y.from + '->' + y.to) +
             ' cross — at this density that means two blocks are in the wrong order')
      }
    }
  }
  for (const o of [...nodes, ...groups, ...edges]) {
    if (o.labelSize != null && (o.labelSize < 6 || o.labelSize > 96)) {
      err(o.id + ' labelSize ' + o.labelSize + ' is outside the valid range, 6 to 96')
    }
  }

  // --- uniformity, which is what the good diagrams have in common ------------
  const sizes = new Set(nodes.map((n) => (n.size ?? [2, 2]).join('x')))
  if (sizes.size > 2) warn(sizes.size + ' distinct block sizes — one uniform [2,2] reads better')
  if (nodes.some((n) => heightOf(n) > 1)) warn('heights above 1 in use — 0 and 1 alone remove occlusion entirely')
  const labelSizes = new Set(nodes.map((n) => n.labelSize ?? 12))
  if (labelSizes.size > 2) warn(labelSizes.size + ' distinct block labelSizes — peers should share one')
  const titles = groups.filter((g) => (g.labelSize ?? 12) >= 80).length
  if (titles > 1) warn(titles + ' very large zone titles — they fight each other, so keep one')

  // --- connection density ----------------------------------------------------
  if (nodes.length) {
    const ratio = edges.length / nodes.length
    if (ratio > 0.5) {
      warn(edges.length + ' edges over ' + nodes.length + ' nodes = ' + ratio.toFixed(2) +
           ' — aim for 0.33. Sharing a zone needs no edge')
    }
    const degree = {}
    for (const e of edges) {
      degree[e.from] = (degree[e.from] ?? 0) + 1
      degree[e.to] = (degree[e.to] ?? 0) + 1
    }
    for (const [id, d] of Object.entries(degree)) {
      if (d > 5) warn(id + ' has ' + d + ' edges — a sign the grouping needs rework')
    }
  }

  info(nodes.length + ' blocks · ' + edges.length + ' connections · ' + groups.length + ' zones · ' +
       images.length + ' pictures · ' + texts.length + ' notes')
}

for (const m of errors) console.log('ERROR  ' + m)
for (const m of warns) console.log('WARN   ' + m)
for (const m of infos) console.log('INFO   ' + m)
console.log(errors.length ? '\nFAILED: ' + errors.length + ' error(s), ' + warns.length + ' warning(s)'
                          : '\nPASSED (' + warns.length + ' warning(s))')
process.exit(errors.length ? 1 : 0)
```

Massing itself checks the format when it opens a file, and says what it had to
repair, so pasting the JSON back into the editor is the other half of this.

## Then look at the render

You cannot tell whether a diagram is good by reading its JSON. Every one of
these only surfaced once someone looked at the picture: captions lying flat and
skewed into mush, "Desktop machine" printed where a zone caption was left
empty, a standing logo covering a whole block behind it, three peers placed in
a perfectly straight line so the triangle between them collapsed. Ask for a
render, and check overlap, legibility and line tangle with your eyes.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| a caption is skewed and unreadable | `labelPlane` unset, so `floor` | stand it up with `left` or `right` |
| captions collide | the caption is a sentence | ten characters, a proper noun |
| a note is a grey smudge | it is on the floor at the 14px default | raise it to 28–36 |
| something floats over the picture | `screen`, the one plane outside the scene | `floor` for a note, `left`/`right` for a caption |
| a zone reads "Group" | `"label": ""` falls back to the kind | fill the caption in |
| a tangle of lines | relationships grouping already shows | cut to blocks ÷ 3 |
| busy and unfocused | size, height and caption scale varied | all 2x2, heights 0–1, one caption size |
| a block has vanished | a taller block in front hides it | drop to heights 0–1, or widen `x + y` |
| a logo is a plain square | a glyph-less plate was downloaded | check path-data volume, swap the file |
| a logo is blurry | `width="1em"` | replace it with the viewBox pixel size |
| a zone looks clipped | contents flush with the boundary | one cell of margin all round |
| a large system came out as three blocks | the connection budget was applied to components | the budget is connections only — inventory first, then draw all of it |
| one block reads `External APIs` | several systems folded into a catch-all | one block each, named for the vendor |
| tidy, and wrong about the technology | drawn from a repository's name instead of its build file | ask for the dependency list rather than guessing |
| the diagram answers a smaller question than the one asked | parts were dropped to stay under a count | nothing here permits dropping a component; split into two diagrams instead |
