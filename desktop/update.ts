/**
 * Keeping the app current, without asking.
 *
 * `Deno.autoUpdate` polls a manifest, downloads a binary diff against the
 * version running, and stages it for the next launch. Nothing is swapped under
 * a running app: the update you fetch today is the app you start tomorrow,
 * which is the right trade for an editor somebody has a document open in.
 *
 * **It does not work everywhere, and the docs should not pretend otherwise.**
 * Applying a staged update and rolling back a launch that fails are macOS and
 * Linux only today; on Windows the patch downloads and stages and then nothing
 * happens to it. So Windows is told, once, where to get the new version rather
 * than being quietly left behind on a build that thinks it is updating.
 */

/** Where releases live. Empty until there is somewhere to publish them. */
const RELEASES = Deno.env.get('MASSING_RELEASES') ?? '';

/**
 * The key releases are signed with.
 *
 * Without it, anything that can answer for the release host can hand this app
 * a patch and have it run on the next launch — a redirect, a stale CDN entry,
 * a hostile network. With it the manifest has to carry an Ed25519 signature
 * over the version and the patch hashes, and the private half never leaves the
 * release machine. Unset, updating is switched off rather than done
 * unsigned: an update channel nobody can forge is worth more than one that
 * exists.
 */
const PUBLIC_KEY = Deno.env.get('MASSING_RELEASE_KEY') ?? '';

/** Once a day. An editor is left open for weeks; hourly would be noise. */
const EVERY = 24 * 60 * 60 * 1000;

/**
 * `Deno.autoUpdate` only exists inside a `deno desktop` binary.
 *
 * It is missing from the type definitions and missing at runtime under a plain
 * `deno run`, which is not a gap to work around — a source run is not an
 * installed app and has nothing to patch. Reaching for it through a widened
 * type keeps the check honest: the same `typeof` that satisfies the compiler
 * is the one that detects the dev run.
 */
type Updatable = typeof Deno & {
  autoUpdate?: (options: {
    url: string;
    publicKey?: string;
    interval?: number;
    onUpdateReady?: (version: string) => void;
    onRollback?: (reason: string) => void;
  }) => void;
};

export function startUpdates(notify: (message: string) => void) {
  const runtime = Deno as Updatable;
  if (typeof runtime.autoUpdate !== 'function') {
    return { on: false, reason: 'not running as an installed app' };
  }
  if (!RELEASES) return { on: false, reason: 'no release URL is configured' };
  if (!PUBLIC_KEY) return { on: false, reason: 'no release key is configured' };

  if (Deno.build.os === 'windows') {
    return {
      on: false,
      reason: 'Deno Desktop cannot apply a staged update on Windows yet',
    };
  }

  try {
    runtime.autoUpdate({
      url: RELEASES,
      publicKey: PUBLIC_KEY,
      interval: EVERY,
      onUpdateReady(version: string) {
        // Said, not done. Restarting an editor out from under someone is worse
        // than running yesterday's build for another hour.
        notify(`Massing ${version} is ready, and will be there next time you open it.`);
      },
      onRollback(reason: string) {
        // Worth surfacing rather than swallowing: a silent rollback means the
        // app is running an older build than its own version string claims,
        // and every bug report after that is against the wrong code.
        notify(`The last update would not start, so this is the previous version. (${reason})`);
      },
    });
    return { on: true };
  } catch (err) {
    return { on: false, reason: String((err as Error).message ?? err) };
  }
}
