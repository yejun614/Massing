/**
 * Which file to download, per operating system.
 *
 * The bundler names its output after the version — `Massing_0.1.4_x64-setup.exe`
 * — so there is no fixed URL to link to and the page has to be told what the
 * newest release actually contains. It asks GitHub, matches the assets against
 * the table below, and offers what came back. Nothing here is a guess about
 * what a release ought to hold: a platform whose file is missing from a release
 * says so instead of linking to a 404.
 *
 * The patterns are the same shape as the ones in `scripts/updater-manifest.mjs`
 * and deliberately not shared with it. That table is the six bundles the
 * updater can install *in place*; this one is everything a person can install
 * by hand, which is why `.deb`, `.rpm` and the disk images are here and the
 * `.app.tar.gz` updater artifacts are not.
 *
 * DOM-free, so the suite can check it.
 */

/**
 * Every file worth offering, grouped by the system that can run it.
 *
 * `note` is the architecture in the words the person choosing it would use.
 * "aarch64" is what the filename says and is no help to somebody deciding
 * whether their MacBook is one.
 */
export const PLATFORMS = [
  {
    id: 'windows',
    label: 'Windows',
    match: /windows|win32|win64/i,
    files: [
      { label: 'Installer', note: 'Intel or AMD (x64)', match: /_x64-setup\.exe$/ },
      { label: 'Installer', note: 'ARM (arm64)', match: /_arm64-setup\.exe$/ },
    ],
  },
  {
    id: 'macos',
    label: 'macOS',
    match: /mac|darwin/i,
    files: [
      { label: 'Disk image', note: 'Apple silicon (M1 and later)', match: /_aarch64\.dmg$/ },
      { label: 'Disk image', note: 'Intel', match: /_x64\.dmg$/ },
    ],
  },
  {
    id: 'linux',
    label: 'Linux',
    match: /linux|x11/i,
    files: [
      { label: 'AppImage', note: 'x86_64 — runs anywhere', match: /_amd64\.AppImage$/ },
      { label: 'AppImage', note: 'arm64 — runs anywhere', match: /_aarch64\.AppImage$/ },
      { label: '.deb', note: 'x86_64 — Debian, Ubuntu', match: /_amd64\.deb$/ },
      { label: '.deb', note: 'arm64 — Debian, Ubuntu', match: /_arm64\.deb$/ },
      { label: '.rpm', note: 'x86_64 — Fedora, RHEL', match: /\.x86_64\.rpm$/ },
      { label: '.rpm', note: 'arm64 — Fedora, RHEL', match: /\.aarch64\.rpm$/ },
    ],
  },
];

/**
 * Which of the three this machine is, or `null` for anything that is not a
 * desktop at all.
 *
 * Phones are checked first and answer `null` on purpose. Android reports itself
 * as Linux and would otherwise be offered an arm64 AppImage, which is a file it
 * can download and can never run — a wrong recommendation is worse here than no
 * recommendation, because the whole point of detecting is to be trusted.
 *
 * Nothing about the architecture is detected. A browser on Apple silicon says
 * `MacIntel`, and `userAgentData` only gives the truth behind an async
 * permission-shaped call that Firefox and Safari do not implement. So both are
 * offered and named in words, which is a question anybody can answer about
 * their own machine.
 *
 * @param {string} hint  `navigator.userAgentData?.platform`, or the UA string.
 */
export function detectPlatform(hint = '') {
  if (/android|iphone|ipad|ipod/i.test(hint)) return null;
  return PLATFORMS.find((p) => p.match.test(hint))?.id ?? null;
}

/**
 * Pair a platform's files with the assets a release actually has.
 *
 * @param {{files: Array<{match: RegExp}>}} platform
 * @param {Array<{name?: string, browser_download_url?: string}>} assets
 * @returns {Array<{label: string, note: string, url: string|null}>}
 */
export function platformFiles(platform, assets = []) {
  return (platform?.files ?? []).map(({ label, note, match }) => ({
    label,
    note,
    url: assets.find((a) => match.test(a?.name ?? ''))?.browser_download_url ?? null,
  }));
}
