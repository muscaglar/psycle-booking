#!/usr/bin/env node
/* Which native builds does this push need? — the `changes` job of .github/workflows/ci.yml.
 *
 * A push that touches only the web app, the tests or the docs cannot break the Swift compile, and one that
 * touches only docs or tests cannot change the Android APK either. This script reads the files a push
 * changed and answers three yes/no questions, which the native jobs read as `needs.changes.outputs.*`:
 *
 *   ios          an input of the iPhone COMPILE changed (Swift, the Xcode project, pods, the plugin patcher)
 *   android      an input of the Android APK changed (its sources, OR the web app it carries in ios-app/www/)
 *   android_src  the Android SOURCES changed (what lint can say something new about)
 *
 * It fails OPEN: anything it cannot work out (a manual run, a first push, a force-push whose old head is
 * gone, a git error) answers yes to all three, so a build is never skipped by mistake.
 * Nothing from the event is interpolated into a shell: values arrive as environment variables and git is
 * run with an argument array. tests/suites/25-ci-cost.js holds the rules below and the workflow's wiring.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

// ── areas:start ── (pure: a list of paths in, three booleans out)
// The iPhone compile reads the native project and what `npm run sync` builds it from. The web app is a
// folder of resources copied into the bundle: it cannot break a compile (Xcode Cloud archives it anyway).
const IOS_INPUTS = [
  /^ios-app\/ios\//,
  /^ios-app\/package(?:-lock)?\.json$/,
  /^ios-app\/capacitor\.config\.json$/,
  /^ios-app\/patch-plugins\.js$/,
  /^ios-app\/build\.js$/, // `npm run sync` starts with it: broken, the job (and Xcode Cloud) stops there
];
// The APK carries the web app, and the owner installs the APK of the latest `main` run: a web change needs
// a new one. ios-app/www/ is generated from the root sources and held to them by `npm run drift`, so it
// stands for every shipped web file.
const ANDROID_SOURCES = [
  /^ios-app\/android\//,
  /^ios-app\/package(?:-lock)?\.json$/,
  /^ios-app\/capacitor\.config\.json$/,
];
const ANDROID_INPUTS = ANDROID_SOURCES.concat([
  /^ios-app\/www\//,
  /^ios-app\/build\.js$/,
]);
// A change to the workflow itself, or to this script, re-proves everything.
const EVERYTHING = [
  /^\.github\/workflows\/ci\.yml$/,
  /^\.github\/scripts\//,
];

const ALL = Object.freeze({ ios: true, android: true, android_src: true });

function areasFor(files) {
  if (!Array.isArray(files)) return Object.assign({}, ALL);
  const list = files.map((f) => String(f == null ? '' : f).trim()).filter(Boolean);
  const any = (rules) => list.some((f) => rules.some((re) => re.test(f)));
  if (any(EVERYTHING)) return Object.assign({}, ALL);
  return { ios: any(IOS_INPUTS), android: any(ANDROID_INPUTS), android_src: any(ANDROID_SOURCES) };
}

// A commit id the event may name: 40 hex digits, and not the all-zero id of "there was no commit before".
function usableSha(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[0-9a-f]{40}$/.test(s) && !/^0{40}$/.test(s) ? s : '';
}
// ── areas:end ──

function changedFiles(before, after) {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // The checkout is one commit deep: fetch the old head alone (two trees are all a diff needs).
  try { git(['cat-file', '-e', before + '^{commit}']); } catch (e) { git(['fetch', '--no-tags', '--depth=1', 'origin', before]); }
  return git(['diff', '--name-only', before, after]).split('\n').filter(Boolean);
}

function main() {
  const event = String(process.env.EVENT || '');
  const before = usableSha(process.env.BEFORE);
  const after = usableSha(process.env.AFTER);
  let areas = Object.assign({}, ALL);
  let why = 'not a push with a known range: everything is built';
  if (event === 'push' && before && after) {
    try {
      const files = changedFiles(before, after);
      areas = areasFor(files);
      why = files.length + ' file(s) changed between ' + before.slice(0, 7) + ' and ' + after.slice(0, 7);
    } catch (e) {
      why = 'could not read the change (' + String((e && e.message) || e).split('\n')[0] + '): everything is built';
    }
  }
  const lines = Object.keys(ALL).map((k) => k + '=' + (areas[k] ? 'true' : 'false'));
  console.log(why);
  lines.forEach((l) => console.log(l));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

module.exports = { areasFor, usableSha };
if (require.main === module) main();
