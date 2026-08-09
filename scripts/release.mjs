#!/usr/bin/env node
/**
 * Bump every version this project has, and tag it.
 *
 *   node scripts/release.mjs 0.1.2 [--push]
 *
 * There are three, which is two too many and not something this script can
 * fix: `tauri.conf.json` is what Tauri bakes into the app and what the updater
 * compares against, `Cargo.toml` is what the MCP server reports itself as, and
 * `package.json` is what Vercel and npm read. They drifted once already, the
 * crate sitting a patch behind the other two, which is the whole reason this
 * exists.
 *
 * It refuses more than it does. A release goes out once and is then in other
 * people's hands, so every check here is cheaper than the alternative.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const version = process.argv[2];
const push = process.argv.includes('--push');

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: release.mjs <major.minor.patch> [--push]');
  process.exit(2);
}
const tag = `v${version}`;

// --- the refusals -----------------------------------------------------------

if (git('status', '--porcelain')) {
  console.error('refusing: the working tree has uncommitted changes.');
  console.error('A release commit should contain the version bump and nothing else.');
  process.exit(1);
}

// A tag that already exists is either a mistake or a deliberate re-cut, and the
// second one wants `git tag -f` typed out by hand rather than done quietly.
const tags = git('tag', '--list', tag);
if (tags) {
  console.error(`refusing: ${tag} already exists. Move it by hand if that is what you want:`);
  console.error(`  git tag -f ${tag} && git push -f origin ${tag}`);
  process.exit(1);
}

if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') {
  console.error('refusing: releases are cut from main.');
  process.exit(1);
}

// --- the three files --------------------------------------------------------

/** Each one, with how to read its version out and how to write a new one in. */
const FILES = [
  {
    path: 'package.json',
    read: (t) => JSON.parse(t).version,
    write: (t, v) => t.replace(/("version":\s*)"[^"]+"/, `$1"${v}"`),
  },
  {
    path: 'desktop/src-tauri/tauri.conf.json',
    read: (t) => JSON.parse(t).version,
    write: (t, v) => t.replace(/("version":\s*)"[^"]+"/, `$1"${v}"`),
  },
  {
    // Anchored to the start of a line, which is the `[package]` one. Every
    // dependency writes its version inside an inline table or after a name, so
    // none of them can match.
    path: 'desktop/src-tauri/Cargo.toml',
    read: (t) => t.match(/^version = "([^"]+)"/m)?.[1],
    write: (t, v) => t.replace(/^version = "[^"]+"/m, `version = "${v}"`),
  },
];

const before = [];
for (const file of FILES) {
  const full = resolve(ROOT, file.path);
  const text = readFileSync(full, 'utf8');
  before.push(`${file.path}: ${file.read(text)}`);
  const next = file.write(text, version);
  if (file.read(next) !== version) {
    console.error(`refusing: could not set the version in ${file.path}.`);
    process.exit(1);
  }
  writeFileSync(full, next);
}

console.log('was:');
for (const line of before) console.log(`  ${line}`);
console.log(`now: ${version} in all three`);

// --- the commit and the tag -------------------------------------------------

/*
 * Nothing to commit is a normal case, not an error.
 *
 * The version may already be right — bumped by hand, or a previous run that
 * got as far as the files and no further. `git commit` fails outright on an
 * empty change, so ask first and tag what is already there.
 */
if (git('status', '--porcelain')) {
  git('add', '--all');
  git('commit', '-m', `Release ${tag}`);
  console.log(`committed the bump`);
} else {
  console.log('the versions were already correct; nothing to commit');
}
git('tag', tag);

if (push) {
  // `main` first. It starts nothing — the workflow triggers on tags only — but
  // pushing the tag without the commit behind it leaves a release built from a
  // commit nobody can see.
  git('push', 'origin', 'main');
  git('push', 'origin', tag);
  console.log(`\npushed ${tag}. The build is running; publish the draft when it is green:`);
  console.log(`  gh run watch`);
  console.log(`  gh release edit ${tag} --draft=false`);
} else {
  console.log(`\ncommitted and tagged ${tag}, not pushed. To go:`);
  console.log(`  git push origin main && git push origin ${tag}`);
  console.log(`  gh release edit ${tag} --draft=false   # once the build is green`);
}
