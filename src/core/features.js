/**
 * Which hosted features this page may use.
 *
 * Two gates, and both have to be open. The build has to have been made with
 * `MASSING_VERCEL_FEATURES=1`, which is what puts the marker in the page; and
 * the deployment has to have the feature switched on, which is what `/api/flags`
 * answers. Neither is a formality: the first keeps a downloaded bundle from
 * calling anything at all, and the second is how a feature gets turned off
 * without a redeploy when it needs to be.
 *
 * Everything starts off. The interface is built from the answer once it
 * arrives, so a slow or failed request leaves an editor with no hosted parts in
 * it rather than an editor with parts that do not work.
 */

const MARKER = 'massing-vercel';
const OFF = { analytics: false, storage: false, assistant: false };

/** Whether this build carries the hosted code at all. */
export function hostedBuild(doc = document) {
  return doc.querySelector(`meta[name="${MARKER}"]`)?.getAttribute('content') === '1';
}

export function createFeatures({ doc = document, fetchImpl = fetch } = {}) {
  let flags = { ...OFF };
  const listeners = new Set();

  function announce() {
    for (const listener of listeners) listener(flags);
  }

  return {
    get flags() {
      return flags;
    },
    /** @param {(flags: {analytics: boolean, storage: boolean, assistant: boolean}) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * Ask the deployment what is on.
     *
     * Failure is silent on purpose. There is nothing useful to tell someone
     * about a features endpoint they never knew existed, and the consequence —
     * an editor with no cloud buttons — is exactly what every offline build
     * looks like anyway.
     */
    async load() {
      if (!hostedBuild(doc)) return flags;
      try {
        const response = await fetchImpl('/api/flags', {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) return flags;
        const body = await response.json();
        flags = { ...OFF, ...(body?.flags ?? {}) };
        announce();
      } catch {
        /* no hosted features this session */
      }
      return flags;
    },
  };
}
