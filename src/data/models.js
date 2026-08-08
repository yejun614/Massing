/**
 * The three models the assistant offers, and how a choice resolves to an id.
 *
 * This lives under `src/data` rather than in the endpoint because both sides
 * need it and they must not hold two opinions: the panel draws these labels,
 * and `/api/chat` resolves what the panel sent. The same reasoning put the
 * authoring guide here — a table copied into two files is a table that is
 * wrong in one of them within a release.
 *
 * **Tiers, not model ids, cross the wire.** The browser sends `"strong"`, and
 * this file is the only thing that knows what that means. A client free to name
 * a model would be a public endpoint that bills the deployment's key for
 * whatever the caller fancied, and it would pin the deployment to a model id
 * baked into someone's cached page months ago.
 *
 * **The ladder stops below Pro, on purpose.** The obvious third rung is
 * `gemini-pro-latest`, and it is not here: Google grants a free key no Pro
 * quota at all, so every Pro id answers 429 — not sometimes, and not as a rate
 * limit that clears. Massing is free software with no billing behind it, so a
 * Pro rung would be a button that is broken for everyone who runs this. Three
 * rungs that answer beat two that answer and one that apologises. A deployment
 * that does have Pro quota puts it back with one variable, and
 * `modelForTier` below is where that is arranged.
 *
 * Two of the three are floating aliases, for the reason `api/chat.js` sets out
 * at length: `gemini-2.5-flash-lite` was closed to new keys while still
 * appearing in the model listing, so a deployment nobody was watching answered
 * 404 for a name demonstrably on the list. Light is pinned to a generation
 * instead, and that is the same argument pointing the other way — a floating
 * alias climbs generations, and the cheap rung that climbs is no longer the
 * cheap rung. Light has one job and it is to stay small.
 *
 * Which is also why it is not pinned any *further* back than one generation.
 * Free-tier quota is granted per model per day, and Google withdraws it from
 * old models long before it withdraws the models: measured on a free key,
 * `gemini-2.0-flash-lite` answers 429 with
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier` on the first call of the
 * day, and the whole 2.5 line answers 404. A rung has to be recent enough to
 * still be given away.
 *
 * The gaps are measured, against this project's hardest case — "draw the
 * architecture of this Spring Boot repository", scored on how many of the
 * twelve components the repository actually has reached the drawing:
 *
 *     standard   8-10 / 12,  7-9 blocks
 *     strong       12 / 12, 13-17 blocks, internal layers and the release path
 *
 * Which is the whole reason this control exists. The lower rungs are not worse
 * versions of one answer; past a certain size of system they draw a different,
 * smaller one.
 */

/**
 * What a request naming no tier gets, and it is deliberately not the first
 * rung: this is the model the deployment already ran before there was a
 * picker, so shipping the control changes nothing for anybody who ignores it.
 */
export const DEFAULT_TIER = 'standard';

export const MODEL_TIERS = [
  {
    id: 'light',
    label: 'Light',
    model: 'gemini-3.1-flash-lite',
    /** Shown on hover. Says what it costs you, not what it is called. */
    hint: 'Cheapest and quickest, and a generation behind. Fine for edits to a diagram that already exists; it is not the one to draw a system with.',
  },
  {
    id: 'standard',
    label: 'Standard',
    model: 'gemini-flash-lite-latest',
    hint: 'The default. Draws a system honestly and covers most of what a repository contains, though it leaves internal structure out.',
  },
  {
    id: 'strong',
    label: 'Strong',
    model: 'gemini-flash-latest',
    hint: 'Slower, and the one to hand a whole repository to: it covers the components, the internal layers and the release path, and lays them out with fewer mistakes.',
  },
];

export const TIER_IDS = MODEL_TIERS.map((t) => t.id);

/** The tier record for an id, or the default one. Never null. */
export function tierFor(id) {
  return MODEL_TIERS.find((t) => t.id === id) ?? MODEL_TIERS.find((t) => t.id === DEFAULT_TIER);
}

export function isTier(id) {
  return MODEL_TIERS.some((t) => t.id === id);
}

/**
 * Which model id a tier resolves to on this deployment.
 *
 * Two levels of override, and both were already promised. `MASSING_AI_MODEL`
 * has always meant "this deployment uses this model", so it keeps meaning
 * exactly that and pins all three — an operator who set it to control cost did
 * not consent to a picker in the corner of a panel undoing that. Per-tier
 * variables are the finer instrument, for swapping one rung of the ladder
 * without owning the other two:
 *
 *     MASSING_AI_MODEL_STRONG=gemini-pro-latest
 *
 * which is exactly how a deployment with Pro quota gets the rung this file
 * declines to ship by default.
 *
 * @param {string} tier
 * @param {Record<string, string|undefined>} env
 */
export function modelForTier(tier, env = {}) {
  const pinned = String(env.MASSING_AI_MODEL ?? '').trim();
  if (pinned) return pinned;
  const found = tierFor(tier);
  const perTier = String(env[`MASSING_AI_MODEL_${found.id.toUpperCase()}`] ?? '').trim();
  return perTier || found.model;
}

/** Whether the picker can do anything here, or the deployment has pinned one. */
export function tiersPinned(env = {}) {
  return Boolean(String(env.MASSING_AI_MODEL ?? '').trim());
}
