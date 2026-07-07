#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * ios-app/build.js — deterministic build/sync for the Capacitor iOS mirror.
 *
 * WHY THIS EXISTS
 * ---------------
 * The iOS app ships a *flattened* copy of the web app under ios-app/www/.
 * Previously this was produced by a fragile `cp + sed` one-liner in
 * package.json. That pipeline drifted: www/ would silently fall behind root
 * (e.g. new modules api-client.js / diagnostic.js never got copied), and the
 * service-worker cache version (`const CACHE = 'psycle-vNN'`) had to be bumped
 * by hand on every change — easy to forget, which serves users stale bytes.
 *
 * This script replaces that pipeline with a single deterministic transform:
 *
 *   1. Auto-discovers ROOT js/*.js + css/*.css (no hardcoded file list) so new
 *      modules are picked up automatically.
 *   2. Copies the HTML/manifest/sw/fonts and the flattened JS/CSS into www/,
 *      rewriting asset paths (`js/`, `css/`, `fonts/`, `../fonts/`) for the
 *      flat layout, and injecting the native-bridge.js <script> tag.
 *   3. Computes a content hash over every shell asset and stamps it into the
 *      `const CACHE = '...'` line of BOTH ../sw.js and www/sw.js, so the cache
 *      version tracks content automatically — no manual bumps, ever.
 *
 * native-bridge.js is HAND-MAINTAINED and lives ONLY in www/. It is never
 * copied from root (there is no root copy) and never overwritten here.
 *
 * Modes:
 *   node build.js            → write the build (idempotent)
 *   node build.js --check    → dry-run; exit non-zero if anything WOULD change
 *                              (prints diverged files). For CI / pre-commit.
 *
 * No npm dependencies — only Node built-ins (fs / path / crypto).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Paths ───────────────────────────────────────────────────────────────────
// __dirname is ios-app/, ROOT is the repo root one level up.
const IOS_DIR = __dirname;
const ROOT = path.resolve(IOS_DIR, '..');
const WWW = path.join(IOS_DIR, 'www');

// Root files copied verbatim (no path rewriting except where noted below).
const ROOT_TOP_FILES = [
  'index.html',
  'psycle-finder.html',
  'login.html',
  'manifest.json',
  'sw.js',
];

// The hand-maintained native bridge — must survive every build untouched.
const NATIVE_BRIDGE = 'native-bridge.js';

// The <script> tag injected into the flattened psycle-finder.html. Mirrors the
// other module tags (defer) and points at the flat path.
const NATIVE_BRIDGE_TAG = '<script defer src="native-bridge.js"></script>';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** List files in `dir` matching `ext` (e.g. '.js'), sorted for determinism. */
function listByExt(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext) && fs.statSync(path.join(dir, f)).isFile())
    .sort();
}

/**
 * Rewrite the asset paths in HTML / sw.js content so the flat www/ layout
 * resolves: strip the `js/`, `css/`, and `fonts/` directory prefixes.
 * Matches the original sed: 's|js/||g; s|css/||g; s|fonts/||g'.
 */
function flattenAssetPaths(content) {
  return content
    .replace(/js\//g, '')
    .replace(/css\//g, '')
    .replace(/fonts\//g, '');
}

/**
 * Rewrite the @font-face url() in theme.css from '../fonts/display.woff2' to
 * 'display.woff2'. Matches the original sed: 's|\.\./fonts/||g'.
 */
function flattenThemeFontPath(content) {
  return content.replace(/\.\.\/fonts\//g, '');
}

/**
 * Inject the native-bridge <script> immediately before </body>, but only if it
 * is not already present (idempotent — re-running must not duplicate the tag).
 */
function injectNativeBridge(html) {
  if (html.includes(NATIVE_BRIDGE_TAG)) return html;
  return html.replace(/<\/body>/, `${NATIVE_BRIDGE_TAG}\n</body>`);
}

/**
 * Replace the `const CACHE = '...'` version with `const CACHE = 'psycle-<hash>'`.
 * Tolerant of both legacy `'psycle-vNN'` and content-hash `'psycle-<hash>'`
 * forms (and single/double quotes). Returns the content unchanged if no CACHE
 * line is found (so it never silently corrupts a file).
 */
function stampCacheVersion(swContent, hash) {
  return swContent.replace(
    /(const\s+CACHE\s*=\s*['"])psycle-[A-Za-z0-9]+(['"])/,
    `$1psycle-${hash}$2`
  );
}

/**
 * Replace the `const SHELL = [...]` precache list with a generated one.
 * The hand-maintained list rotted (new modules/css/fonts never added →
 * broken offline PWA); the build already auto-discovers every shipped
 * asset, so it is the single source of truth for the SHELL too.
 * Returns content unchanged if no SHELL block is found.
 */
function stampShellList(swContent, shellPaths) {
  const list = shellPaths.map((p) => `  './${p}'`).join(',\n');
  return swContent.replace(
    /const\s+SHELL\s*=\s*\[[\s\S]*?\];/,
    `const SHELL = [\n${list}\n];`
  );
}

/** Short, stable content hash (first 8 hex chars of sha256). */
function shortHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

// ── Build planning ───────────────────────────────────────────────────────────
//
// We compute a *plan*: a map of { wwwRelativePath -> finalBytes (Buffer) }.
// This single source of truth drives BOTH the write path and the --check
// (drift-detection) path, so the two can never disagree. Nothing is written
// while building the plan.

/**
 * Build the plan, returning:
 *   { files: Map<relPath, Buffer>, rootSw: Buffer, hash: string }
 * `files` are the www/ outputs. `rootSw` is the new ../sw.js content (only the
 * CACHE line changes). `hash` is the computed shell hash (for reporting).
 *
 * The native-bridge.js is intentionally NOT included in `files`: it is owned by
 * www/ and we must neither copy nor overwrite it.
 */
function buildPlan() {
  const files = new Map();

  // 1. Auto-discover module lists (sorted) — new files picked up for free.
  const jsFiles = listByExt(path.join(ROOT, 'js'), '.js');
  const cssFiles = listByExt(path.join(ROOT, 'css'), '.css');
  const fontFiles = listByExt(path.join(ROOT, 'fonts'), '.woff2');

  // 2. Flattened JS — copied verbatim (module bodies don't reference js/ paths).
  for (const f of jsFiles) {
    files.set(f, fs.readFileSync(path.join(ROOT, 'js', f)));
  }

  // 3. Flattened CSS — copied verbatim EXCEPT theme.css, whose @font-face url
  //    must be de-pathed (../fonts/display.woff2 -> display.woff2).
  for (const f of cssFiles) {
    let buf = fs.readFileSync(path.join(ROOT, 'css', f));
    if (f === 'theme.css') {
      buf = Buffer.from(flattenThemeFontPath(buf.toString('utf8')), 'utf8');
    }
    files.set(f, buf);
  }

  // 4. Fonts — copied verbatim into the flat root of www/.
  for (const f of fontFiles) {
    files.set(f, fs.readFileSync(path.join(ROOT, 'fonts', f)));
  }

  // 5. The generated SHELL lists. Root form keeps directory prefixes; the
  //    www/ form is flat and additionally precaches native-bridge.js.
  const rootShell = [
    'psycle-finder.html',
    'index.html',
    'login.html',
    'manifest.json',
    ...fontFiles.map((f) => `fonts/${f}`),
    ...cssFiles.map((f) => `css/${f}`),
    ...jsFiles.map((f) => `js/${f}`),
  ];
  const wwwShell = [
    ...rootShell.map((p) => p.replace(/^(?:js|css|fonts)\//, '')),
    NATIVE_BRIDGE,
  ];

  // 6. Top-level files. psycle-finder.html and sw.js get path-flattening;
  //    psycle-finder.html additionally gets the native-bridge tag injected.
  //    sw.js gets the generated (flat) SHELL list stamped in.
  //    index.html / login.html / manifest.json are copied verbatim (they carry
  //    no js//css//fonts/ prefixes — verified — so flattening is a no-op there,
  //    but we keep them verbatim to avoid surprising rewrites).
  for (const f of ROOT_TOP_FILES) {
    let buf = fs.readFileSync(path.join(ROOT, f));
    if (f === 'psycle-finder.html') {
      let html = flattenAssetPaths(buf.toString('utf8'));
      html = injectNativeBridge(html);
      buf = Buffer.from(html, 'utf8');
    } else if (f === 'sw.js') {
      let sw = stampShellList(buf.toString('utf8'), wwwShell);
      buf = Buffer.from(flattenAssetPaths(sw), 'utf8');
    }
    files.set(f, buf);
  }

  // 7. Compute the shell content hash. The SHELL is the cacheable runtime
  //    surface: HTML + manifest + fonts + CSS + JS (everything the SW caches).
  //    We hash the FLATTENED www/ bytes so the version reflects exactly what
  //    ships to the device. native-bridge.js is part of that runtime surface,
  //    so include it in the hash (read from www/, where it lives).
  //    sw.js itself is excluded from the hash input — otherwise stamping the
  //    hash into sw.js would change sw.js, which would change the hash (a
  //    fixed-point problem). The SW's job is to cache the *other* assets.
  const hashParts = [];
  const nbPath = path.join(WWW, NATIVE_BRIDGE);
  const nbBytes = fs.existsSync(nbPath) ? fs.readFileSync(nbPath) : Buffer.alloc(0);
  // Deterministic order: sorted relpath, then native-bridge, excluding sw.js.
  for (const rel of [...files.keys()].sort()) {
    if (rel === 'sw.js') continue;
    hashParts.push(`${rel}\n`);
    hashParts.push(files.get(rel));
  }
  hashParts.push(`${NATIVE_BRIDGE}\n`);
  hashParts.push(nbBytes);
  const hash = shortHash(Buffer.concat(hashParts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p)))));

  // 8. Stamp the hash into BOTH sw copies (and the generated SHELL into the
  //    root copy — the www copy already got its flat SHELL in step 6).
  const wwwSw = stampCacheVersion(files.get('sw.js').toString('utf8'), hash);
  files.set('sw.js', Buffer.from(wwwSw, 'utf8'));

  const rootSwRaw = fs.readFileSync(path.join(ROOT, 'sw.js')).toString('utf8');
  const rootSw = Buffer.from(
    stampCacheVersion(stampShellList(rootSwRaw, rootShell), hash),
    'utf8'
  );

  return { files, rootSw, hash };
}

// ── Apply / check ─────────────────────────────────────────────────────────────

/**
 * Compare a planned output Buffer against what's on disk.
 * Returns true if the on-disk content already matches (no write needed).
 */
function matchesDisk(absPath, buf) {
  if (!fs.existsSync(absPath)) return false;
  return fs.readFileSync(absPath).equals(buf);
}

/** Write all planned outputs to disk. Idempotent: only writes changed files. */
function applyPlan(plan) {
  fs.mkdirSync(WWW, { recursive: true });
  let written = 0;

  for (const [rel, buf] of plan.files) {
    const abs = path.join(WWW, rel);
    if (!matchesDisk(abs, buf)) {
      fs.writeFileSync(abs, buf);
      written++;
    }
  }

  // Root sw.js (cache stamp).
  const rootSwPath = path.join(ROOT, 'sw.js');
  if (!matchesDisk(rootSwPath, plan.rootSw)) {
    fs.writeFileSync(rootSwPath, plan.rootSw);
    written++;
  }

  console.log(`[build] cache version: psycle-${plan.hash}`);
  console.log(
    written === 0
      ? '[build] up to date — no files changed.'
      : `[build] wrote ${written} file(s) into www/ (+ root sw.js cache stamp).`
  );
}

/**
 * Dry-run drift detection. Computes the plan and compares every planned output
 * against disk WITHOUT writing. Returns a list of diverged file paths
 * (relative to repo root for readability). Empty list == no drift.
 */
function detectDrift(plan) {
  const diverged = [];

  for (const [rel, buf] of plan.files) {
    if (!matchesDisk(path.join(WWW, rel), buf)) {
      diverged.push(path.join('ios-app', 'www', rel));
    }
  }
  if (!matchesDisk(path.join(ROOT, 'sw.js'), plan.rootSw)) {
    diverged.push('sw.js (CACHE version)');
  }

  return diverged;
}

// ── Entry point ───────────────────────────────────────────────────────────────

function main() {
  const checkMode = process.argv.includes('--check');
  const plan = buildPlan();

  if (checkMode) {
    const diverged = detectDrift(plan);
    if (diverged.length === 0) {
      console.log(`[build --check] OK — www/ is in sync (cache psycle-${plan.hash}).`);
      process.exit(0);
    }
    console.error(
      `[build --check] DRIFT DETECTED — ${diverged.length} file(s) would change:`
    );
    for (const f of diverged) console.error(`  • ${f}`);
    console.error('\nRun `npm run build` (in ios-app/) to regenerate www/ and the SW cache.');
    process.exit(1);
  }

  applyPlan(plan);
}

main();
