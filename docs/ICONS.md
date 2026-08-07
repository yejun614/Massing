# Icons

Every icon is a string of SVG markup for a 24×24 viewBox, held in
[`src/data/icons.js`](../src/data/icons.js). There are no image files, no
sprite sheets and no fetching — which is what lets the whole icon set survive
the single-file bundle and work from `file://`.

## How an icon is drawn

Icons are rendered as children of a group that already sets
`fill: none; stroke: currentColor` and rounds the joins. So an icon is just its
paths, with no styling of its own:

```js
chip:
  '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>' +
  '<path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21' +
  'M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
```

The stroke colour is chosen for you at draw time — black or white, whichever
reads better against the block's top face — so never hard-code a colour. The
one exception is a shape that must be solid: opt out locally with
`fill="currentColor" stroke="none"`, as the dot in `server` does.

Stroke width is set by the renderer too, scaled so it stays about 1.4 px on
screen whatever the block's size. Draw at a nominal 1.8 and it will look right.

## Adding an icon to the source

1. Add the markup to `ICONS` in `src/data/icons.js`.
2. If it needs a placeable block, add a row to `TABLE` in
   [`src/data/components.js`](../src/data/components.js):

   ```js
   ['temporal', 'Temporal', 'devops', 'temporal', 2],
   //  type      label       category  icon       height
   ```

   Footprint is 2×2 for every type; `height` is the visual weight — 1 for a
   gateway, 2 for a service, 3 for a database.
3. Run `node build.js`. Nothing else to edit — the JSON Schema's type enum,
   the LLM prompt's component catalogue and the Claude skill are all generated
   from the registry. At 100+ types a hand-maintained copy drifts within a
   release, and a schema that disagrees with the editor is worse than none, so
   `test/run.mjs` fails if the committed schema falls out of step.

Several types can share one glyph through `ALIASES` — `nodejs` reuses `js`,
every SQL database that has no distinct mark reuses `cylinder`.

## Adding icons without touching the source

`registerIconPack` merges markup into the registry at runtime, which is the
extension point for artwork this project deliberately does not ship — the
official AWS, Azure or GCP sets, or your own company's:

```js
import { registerIconPack } from './src/data/icons.js';

registerIconPack({
  temporal: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  myservice: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
});
```

Call it before the first render. Each value is the same thing you would have
written in `ICONS`: children of a 24×24 viewBox, inheriting stroke and fill.

To load a pack from a file at runtime:

```js
registerIconPack(await (await fetch('./my-icons.json')).json());
```

That reintroduces a network request, so it is not suitable for the bundled
build. For a bundle, put the pack in `src/data/icons.js` instead — it gets
inlined with everything else.

## Using an icon pack you did not draw

Official cloud-provider icon sets are usually filled multi-colour artwork
rather than single-stroke glyphs. They will render, but two things differ:

- **Colour.** A filled icon ignores the automatic contrast colour. Either strip
  the fills so it inherits `currentColor`, or accept that it will not adapt to
  the block colour underneath it.
- **Licence.** AWS, Azure and GCP each publish terms for their architecture
  icons. This project ships none of them on purpose; if you add them, those
  terms are yours to follow.

## Why they are hand-drawn

Every built-in technology icon was drawn for this project as a single-stroke
glyph. None is a copy of a vendor's artwork, and no official icon set is
bundled.

They still have to be *recognisable*, so where a technology has a well-known
mark the glyph evokes it — Kubernetes reads as a helm, Docker as a whale. That
is a deliberately different problem from reproducing a logo: the drawing has to
survive 26 px in the palette and an isometric skew on a block face, which most
real logos do badly. It is also a different problem legally. These glyphs
identify a technology; they do not claim to be that project's mark, and the
project's trademark rights are unaffected either way. Keep new icons on the
same side of that line.

If you would rather use the genuine marks, `registerIconPack` above is the way,
and the terms attached to them become yours to follow.
