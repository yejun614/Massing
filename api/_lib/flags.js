/**
 * Which hosted features are live.
 *
 * Three sources, in order, and the order is the whole design:
 *
 * 1. **Edge Config**, when one is connected. Changing a value there takes
 *    effect without a redeploy, which is what makes a flag a flag rather than a
 *    constant with extra steps — turn the assistant off while a bill is being
 *    investigated, turn it back on afterwards, no build in between.
 * 2. **Environment variables**, for a deployment with no Edge Config. Toggling
 *    one costs a redeploy, which is slower but needs nothing set up.
 * 3. **A default**, which for every feature is *off unless it can work*: a
 *    feature whose credentials are missing is not a feature, and offering it in
 *    the interface so it can fail on first use helps nobody.
 *
 * The build switch is upstream of all of this. `MASSING_VERCEL_FEATURES=1` is
 * what decides whether the page contains any of this code; the flags decide
 * what a page that does contain it is allowed to do.
 */

const FLAGS = [
  {
    key: 'analytics',
    env: 'MASSING_FLAG_ANALYTICS',
    edge: 'massing_analytics',
    /** Served by the deployment itself, so there is nothing to configure. */
    available: () => true,
  },
  {
    key: 'storage',
    env: 'MASSING_FLAG_STORAGE',
    edge: 'massing_storage',
    available: (env) => Boolean(env.BLOB_READ_WRITE_TOKEN),
  },
  {
    key: 'assistant',
    env: 'MASSING_FLAG_ASSISTANT',
    edge: 'massing_assistant',
    available: (env) => Boolean(env.AI_GATEWAY_API_KEY),
  },
];

/** The strict reading used for every switch in this project. */
function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function falsy(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value ?? '').trim().toLowerCase());
}

/**
 * Resolve one flag against an already-read Edge Config snapshot.
 *
 * Pure, and separated from the fetching for that reason: this is the part with
 * the precedence rules in it, and precedence is what goes wrong.
 */
export function resolveFlag(flag, { env = {}, edge = null } = {}) {
  const available = flag.available(env);
  const fromEdge = edge?.[flag.edge];
  if (fromEdge !== undefined && fromEdge !== null && String(fromEdge) !== '') {
    if (truthy(fromEdge)) return { on: available, source: available ? 'edge-config' : 'unavailable' };
    if (falsy(fromEdge)) return { on: false, source: 'edge-config' };
  }
  const fromEnv = env[flag.env];
  if (fromEnv !== undefined && String(fromEnv).trim() !== '') {
    if (truthy(fromEnv)) return { on: available, source: available ? 'environment' : 'unavailable' };
    if (falsy(fromEnv)) return { on: false, source: 'environment' };
  }
  return { on: available, source: available ? 'default' : 'unavailable' };
}

export function resolveAll({ env = {}, edge = null } = {}) {
  const out = {};
  for (const flag of FLAGS) out[flag.key] = resolveFlag(flag, { env, edge });
  return out;
}

export const FLAG_KEYS = FLAGS.map((f) => f.key);

/**
 * Read the connected Edge Config, or null when there is not one.
 *
 * Over the REST endpoint rather than the SDK, for the same reason as
 * everything else here: this project has no dependencies, and an Edge Config
 * read is one authenticated GET. A failure is not an error — it means the flags
 * fall through to the environment, which is exactly what a deployment without
 * an Edge Config does anyway.
 */
export async function readEdgeConfig(env = process.env, fetchImpl = fetch) {
  const connection = env.EDGE_CONFIG;
  if (!connection) return null;
  try {
    const url = new URL(connection);
    // The connection string is an items endpoint with the token in the query,
    // so asking for every item is the URL itself.
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    const items = await response.json();
    return items && typeof items === 'object' ? items : null;
  } catch {
    return null;
  }
}

/** The whole answer, in the shape the client reads. */
export async function currentFlags(env = process.env, fetchImpl = fetch) {
  const edge = await readEdgeConfig(env, fetchImpl);
  const resolved = resolveAll({ env, edge });
  const on = {};
  for (const [key, value] of Object.entries(resolved)) on[key] = value.on;
  return { flags: on, detail: resolved };
}
