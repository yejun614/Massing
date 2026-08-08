# The hosted features

Three things this editor can do when it is deployed on Vercel, and cannot do
otherwise: count visits, store diagrams at a short URL, and talk to a model that
edits the diagram for you.

They are off in every build unless asked for, and each can be switched off again
on a live deployment without a redeploy. This file is what to set up, and what
the limits are.

---

## Two switches, and why there are two

**At build time**, `MASSING_VERCEL_FEATURES=1` decides whether the bundle
contains any of this at all. Without it the page has no marker in its head, and
the client never asks a server anything — which is what keeps the promise that a
clone, a local build or an emailed `dist/index.html` reaches nothing.

```bash
node build.js                          # nothing hosted, reaches nothing
MASSING_VERCEL_FEATURES=1 node build.js  # the hosted build
```

**At runtime**, the flags decide which of the three are live. A build that
carries the code still shows no publish button if storage is switched off, and
the button is *absent* rather than disabled: a control whose only purpose is to
explain that it does not work is worse than no control.

`MASSING_ANALYTICS` is gone. It only ever covered one of the three, and a second
variable for each new feature is how a deployment ends up half-configured.

---

## What to set in the dashboard

### 1. Environment variable, on the project

| Variable | Value | Why |
|---|---|---|
| `MASSING_VERCEL_FEATURES` | `1` | Without it the deployed bundle has no hosted code in it and nothing below matters. |

Set it for Production, and for Preview if you want the features on preview
deployments too. **Redeploy after adding it** — it is read at build time.

### 2. Vercel Blob, for stored diagrams

Storage → Create Database → **Blob**, then connect it to the project. That adds
`BLOB_READ_WRITE_TOKEN` by itself; nothing else is needed.

| Variable | Set by | Notes |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Connecting the store | Its presence is what makes the storage flag default to on. |
| `BLOB_PUBLIC_BASE_URL` | Optional | `https://<store-id>.public.blob.vercel-storage.com`. Saves one lookup per cold start; the value is discovered automatically without it. |
| `BLOB_API_VERSION` | Optional | Defaults to `7`. Only touch this if Vercel bumps the REST API and reads start failing. |

### 3. A Gemini API key, for the assistant

The assistant calls Google's Generative Language API directly — not through
Vercel AI Gateway — so nothing needs setting up on the Vercel side beyond the
variable. Get a key from [Google AI Studio](https://aistudio.google.com/apikey)
and add it to the project.

| Variable | Set by | Notes |
|---|---|---|
| `GEMINI_API_KEY` | You | Its presence is what makes the assistant flag default to on. |
| `MASSING_AI_MODEL` | Optional | Defaults to `gemini-2.5-flash-lite`, which is the only model this has been built and tested against. A vendor prefix is tolerated — `google/gemini-2.5-flash-lite` and `models/gemini-2.5-flash-lite` both resolve to the same thing, since the first is what this project asked for while it went through a gateway. |

The key is only ever read on the server and goes upstream in an `x-goog-api-key`
header rather than the query string, so it stays out of access logs.

> **Upgrading from the AI Gateway build?** Delete `AI_GATEWAY_API_KEY` and add
> `GEMINI_API_KEY`. If you set `MASSING_AI_MODEL` to `google/gemini-2.5-flash-lite`
> back then you can leave it — the prefix is stripped now — but unsetting it is
> tidier.

Put a **spend limit** on the key in Google AI Studio, or keep it on the free
tier. The assistant sends the authoring guide as its system instruction on every
turn — around 35 kB — which is cheap on Flash-Lite and is still a number that
multiplies. Google's free tier also has a per-minute request cap, which the
rate limits here sit under but do not guarantee.

### 4. Flags, to switch each one off without a redeploy

Optional but recommended. Storage → Create → **Edge Config**, connect it to the
project (which adds `EDGE_CONFIG`), and put these items in it:

| Item | Value |
|---|---|
| `massing_analytics` | `true` / `false` |
| `massing_storage` | `true` / `false` |
| `massing_assistant` | `true` / `false` |

Changing one takes effect within about a minute — the flags response is cached
at the edge for 30 seconds. An item left out, or left empty, defers to the
environment variable of the same name (`MASSING_FLAG_STORAGE`, and so on), and
then to the default.

The default for every feature is **on if it can work**: a flag whose credentials
are missing resolves to off no matter what the Edge Config says, because
offering a feature so it can fail on first use helps nobody.

> This uses Edge Config directly rather than the Flags SDK, so the flags do not
> appear in the Vercel Toolbar's Flags Explorer. Adding that needs the SDK and
> its encrypted discovery endpoint, which is a dependency this project does not
> have.

### 5. Cron, for deleting what expires

`vercel.json` already schedules `/api/cron/sweep` daily at 03:00 UTC. It needs
one variable, and refuses every request without it:

| Variable | Value | Why |
|---|---|---|
| `CRON_SECRET` | Any long random string | Vercel sends it as a bearer token on scheduled runs. **Without it the endpoint refuses everything**, including the scheduler — an unauthenticated deletion endpoint is worse than a sweeper that never runs. |

Cron allowances differ by plan: Hobby runs roughly once a day and fires
approximately on the hour, which is all this needs. Each run examines a bounded
number of objects and reports `truncated: true` if it ran out of budget, so a
store that has outgrown one run says so rather than looking tidy.

Skip this and nothing breaks — links still expire on read, they just never free
their storage.

### 6. Optional: lock down writing

| Variable | Effect |
|---|---|
| `MASSING_WRITE_TOKEN` | When set, storing a diagram requires the same value in an `x-massing-token` header. Reading stays open. |

Unset — the default — anyone who can load the page can store a diagram, held in
check only by the rate limits below. That is the right setting for a personal
deployment and the wrong one for a URL that has got around.

### 7. Recommended: rate limiting on the edge

Firewall → Rate Limiting, on `/api/diagrams` and `/api/chat`. The limits in the
code are per function instance and a busy deployment has several, so they stop
the obvious accident — a script in a loop, a stuck retry — and not somebody
deliberate. Vercel's own limiter is the one that does that.

---

## The policies, and the reasoning

| Limit | Value | Why that number |
|---|---|---|
| Document size | 2 MB of JSON | The starter is under 6 kB and a heavily annotated diagram with a dozen logos is about 300 kB. What eats the difference is pasted screenshots, which arrive as data URLs. Refusing those is the intent, not a side effect. |
| Store, per address | 10/min, 60/hour, 300/day | Publishing is a deliberate act. Ten in a minute is someone iterating; a hundred is a loop. |
| Chat, per address | 20/min, 200/hour, 600/day | Enough for a long working session, bounded well under what a runaway client costs. |
| Chat request body | 256 kB | Prompts are text. |
| Conversation sent | last 40 messages | Older turns are dropped rather than summarised: the diagram is sent in full every turn, so the thing carrying the state is never the thing being trimmed. |
| Model reply | 4096 tokens, 60 s | |
| Tool calls per question | 8 | Read, write, check, write again is four. Past eight it is stuck, and finding out costs money. |
| Display id | 3–64 chars, `[a-z0-9-]`, claim-once | Lower case because a URL read aloud has no case. Names that look like hex are refused, because a lookup key carries no label saying which kind it is. |
| Link lifetime | 90 days since last opened | See below. |
| Sweep budget | 4000 objects a run, deletes of 100 | A function has a deadline and the store has no known size. It takes what it can and comes back tomorrow. |

### Retention is sliding

A published link is kept for **90 days after it was last opened**, not after it
was published. Open it and the clock resets; leave it alone for three months and
it goes. That way round matters: expiring by publication date would kill exactly
the links that are still working.

| Variable | Effect |
|---|---|
| `MASSING_RETENTION_DAYS` | Days a link survives without being opened. Default 90. `0` switches retention off entirely — nothing expires and nothing is swept. |

An expired link answers **410 Gone** with the date it went and how long links
are kept, rather than a 404. "Gone" and "never existed" are different things to
whoever followed the link, and the difference is the only useful thing left to
tell them. The publish sheet says the date up front, because a lifetime nobody
mentioned is one people discover from a document they shared months ago.

Reading is what slides the clock, so a read is also a small write — throttled to
at most one a week per link, rather than a write behind every GET.

Vercel Blob has no lifecycle rules of its own, so the deleting is a cron job.
It runs in two passes: expired links first, then any document no surviving link
points at. That order is what stops it deleting a document a live link still
names, and it means republishing a name does not immediately destroy the old
version — a short link somebody shared keeps that content alive until it too
goes unused.

One consequence worth knowing: anything that fetches links keeps them alive,
including a crawler. Set `MASSING_RETENTION_DAYS` to `0` and delete by hand if
that matters more than the reclaimed space.

---

## What a published link is

Two of them, and they mean different things.

- `/d/<name>` — the name someone chose. Publishing again under it updates what it
  shows. Only whoever claimed it can do that: the claim mints a token, kept in
  that browser's `localStorage`, and the server stores only its hash. **There are
  no accounts here**, so publishing over your own name from a second machine is
  not possible. That is a real limitation and the price of having none.
- `/d/<short hash>` — the exact bytes. Never moves, whatever is published later,
  and claimed once: on the vanishingly rare occasion two documents share a
  ten-character prefix, the first keeps the link and the second simply has none
  rather than silently taking it over.

Documents are addressed by the hash of their content, so storing the same
diagram twice writes nothing the second time, and an edit is a new address
rather than a change to an old one.

Anyone with a link can read it. There is no private mode.

Both kinds expire on the same sliding rule, and each carries its own clock — so
republishing a name does not kill the content link somebody else is using.

---

## The endpoints

| Route | Method | Does |
|---|---|---|
| `/api/flags` | GET | Which features are live. Cached 30 s at the edge. |
| `/api/diagrams` | POST | Store a document. Returns hash, short hash, name, edit token. |
| `/api/diagrams/:key` | GET | Read one, by full hash, short hash or name. |
| `/api/chat` | POST | One turn with the model, translated to and from Gemini's shape. Stateless. |
| `/api/cron/sweep` | GET | Deletes expired links and the documents nothing points at. Scheduler only. |

`/api/chat` does **not** execute the model's tool calls. It hands them back, and
the editor runs them against the document actually on screen — through the same
store and the same undo history as a change made by hand. A server editing its
own copy would be editing a document nobody is looking at.

---

## Checking it after deploying

```bash
curl https://<your-deployment>/api/flags
# {"flags":{"analytics":true,"storage":true,"assistant":true}, ...}
```

If a flag is `false`, `detail` says which stage decided: `unavailable` means the
credential is missing, `edge-config` or `environment` means something switched it
off on purpose, `default` means it was never configured either way.
