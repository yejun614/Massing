#!/usr/bin/env node
/**
 * Compose `latest.json` once, from the assets already on a release.
 *
 *   node scripts/updater-manifest.mjs <tag> [--write]
 *
 * The build matrix used to do this itself: `includeUpdaterJson: true` on six
 * parallel jobs, each downloading the shared `latest.json`, merging its own
 * platform in and uploading it back. Two of the six lost that race on v0.1.1
 * and failed with `Not Found` on get- and delete-a-release-asset — and the
 * damage was not the red build, it was that the manifest which survived listed
 * four platforms out of six. The installers were all there; x86_64 Linux and
 * arm64 Windows simply would never have been offered the update.
 *
 * So no job merges anything now. The matrix uploads bundles, whose names never
 * collide, and this runs once at the end against the finished release.
 *
 * Reads the API, so it needs `GITHUB_TOKEN` (or `gh auth`) and nothing else.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'yejun614/Massing';

/**
 * Which artifact the updater can actually install, per platform.
 *
 * Not every bundle is updatable: a `.deb` or an `.rpm` is installed by the
 * system package manager and Tauri will not replace one in place. The keys are
 * the `{os}-{arch}` names the updater looks itself up by, and the patterns
 * match what the bundler names things.
 */
const PLATFORMS = [
  { key: 'windows-x86_64', match: /_x64-setup\.exe$/ },
  { key: 'windows-aarch64', match: /_arm64-setup\.exe$/ },
  { key: 'darwin-x86_64', match: /_x64\.app\.tar\.gz$/ },
  { key: 'darwin-aarch64', match: /_aarch64\.app\.tar\.gz$/ },
  { key: 'linux-x86_64', match: /_amd64\.AppImage$/ },
  { key: 'linux-aarch64', match: /_aarch64\.AppImage$/ },
];

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 << 20 });

function assetsFor(tag) {
  const releases = JSON.parse(gh(['api', `repos/${REPO}/releases`, '--paginate']));
  const release = releases.find((r) => r.tag_name === tag);
  if (!release) throw new Error(`no release tagged ${tag}`);
  return { release, assets: release.assets };
}

/**
 * Where the asset will be, rather than where the API says it is.
 *
 * This runs against a release that is still a **draft**, and a draft has no
 * tag — so GitHub answers `browser_download_url` with
 * `/releases/download/untagged-0dd4c9954a706321dd63/…`, which is a real URL
 * right up until somebody presses Publish and every one of them becomes a 404.
 * Copying that field is a race with a human: v0.1.4 was published a minute
 * before this job finished and got real URLs, v0.1.5 was published eight
 * minutes after and shipped six dead ones. Every installed copy then found the
 * update, downloaded nothing, and said `404 Not Found`.
 *
 * The published form is knowable without asking: it is the tag and the asset's
 * name, which is also exactly what `/releases/latest/download/…` resolves to.
 * So it is built rather than read, and the publish order stops mattering.
 */
const downloadUrl = (tag, name) =>
  `https://github.com/${REPO}/releases/download/${tag}/${encodeURIComponent(name)}`;

/** A signature is the whole `.sig` file, as text. */
function signature(assets, name) {
  const sig = assets.find((a) => a.name === `${name}.sig`);
  if (!sig) return null;
  return gh([
    'api',
    `repos/${REPO}/releases/assets/${sig.id}`,
    '-H',
    'Accept: application/octet-stream',
  ]).trim();
}

const tag = process.argv[2];
if (!tag) {
  console.error('usage: updater-manifest.mjs <tag> [--write]');
  process.exit(2);
}

const { release, assets } = assetsFor(tag);
const platforms = {};
const missing = [];

for (const { key, match } of PLATFORMS) {
  const bundle = assets.find((a) => match.test(a.name));
  if (!bundle) {
    missing.push(`${key}: no bundle matching ${match}`);
    continue;
  }
  const sig = signature(assets, bundle.name);
  if (!sig) {
    missing.push(`${key}: ${bundle.name} has no .sig beside it`);
    continue;
  }
  platforms[key] = { signature: sig, url: downloadUrl(tag, bundle.name) };
}

/*
 * Every platform, or none.
 *
 * A manifest missing one entry is worse than no manifest at all: the release
 * looks complete, and the platform left out stops being offered updates
 * without anybody noticing. That is precisely what happened, so it is a hard
 * failure rather than a warning nobody reads.
 */
if (missing.length) {
  console.error(`refusing to write a partial manifest for ${tag}:`);
  for (const line of missing) console.error(`  - ${line}`);
  process.exit(1);
}

/*
 * And none of them may be a draft URL.
 *
 * Unreachable while the URLs are built from the tag above, which is the point:
 * this is the assertion that keeps them built that way. The manifest is the one
 * file here whose damage is invisible — it is written by a green job, uploaded
 * to a release that looks complete, and only fails on somebody else's machine.
 */
const draftUrls = Object.entries(platforms).filter(
  ([, p]) => !p.url.includes(`/releases/download/${tag}/`)
);
if (draftUrls.length) {
  console.error(`refusing to write a manifest that does not point at ${tag}:`);
  for (const [key, p] of draftUrls) console.error(`  - ${key}: ${p.url}`);
  process.exit(1);
}

const manifest = {
  version: release.tag_name.replace(/^v/, ''),
  notes: release.body?.trim() || `Massing ${release.tag_name}`,
  pub_date: new Date().toISOString(),
  platforms,
};

const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes('--write')) {
  writeFileSync('latest.json', text);
  console.log(`wrote latest.json for ${tag}: ${Object.keys(platforms).join(', ')}`);
} else {
  console.log(text);
  console.error(`(dry run — ${Object.keys(platforms).length} platforms; pass --write to save)`);
}
