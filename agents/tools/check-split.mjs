#!/usr/bin/env node
// check-split.mjs — proves that splitting CLAUDE.md into AGENTS.md + agents/**/*.md lost nothing.
//
// CLAUDE.md used to be one 171 KB architecture guide that an assistant loaded whole at the start of
// every session. It was split ON TOP OF commit 124a0b0 — the LAST commit that still holds the original,
// unsplit CLAUDE.md, which is why it is the default <rev> below (the split itself is the commit after
// it). Its text was MOVED, verbatim, into agents/repo-map.md and agents/architecture/*.md (a few opening
// lines went into AGENTS.md), and CLAUDE.md became a pointer. This script reads the ORIGINAL from git
// and checks that every non-blank line of it is in exactly one of those files. It prints any line that
// is missing or duplicated, and where each run of original lines went.
//
//   node agents/tools/check-split.mjs                 # original = git show 124a0b0:CLAUDE.md
//   node agents/tools/check-split.mjs <rev>           # another commit's CLAUDE.md
//   node agents/tools/check-split.mjs --original <f>  # a file instead of git (a shallow clone has no 124a0b0)
//   --strict   exit 1 on duplicated lines too (default: only on missing ones)
//   --quiet    no map, findings and summary only
//
// Reading the result LATER: the proof belongs to the commit that made the split. Once a moved paragraph
// is edited (as it should be, when the code it describes changes), its old lines are gone from these
// files. A line that WAS in them at the split commit is printed as "EDITED SINCE" and does not fail the
// run: that is the list of what has changed since the split, not an error to fix by undoing it. Only a
// line the split itself never carried over is "MISSING". (Without that commit in git — a shallow clone —
// the two cannot be told apart, and every such line is MISSING.)
//
// "Generic" lines — a code fence, a table's |---|---| rule — are written by every Markdown file, so they
// are only checked for "at least as many as the original had". Dependency-free; Node 18+.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAST_UNSPLIT_COMMIT = '124a0b0';   // the last commit whose CLAUDE.md is the whole guide
const SPLIT_COMMIT = 'bdd5ef5';          // the commit after it: the split, where this proof read 0 missing, 0 duplicated

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const originalAt = args.indexOf('--original');
const originalFile = originalAt !== -1 ? args[originalAt + 1] : null;
const rev = args.find((a, i) => !a.startsWith('--') && (originalAt === -1 || i !== originalAt + 1)) || LAST_UNSPLIT_COMMIT;
const strict = flag('--strict');
const quiet = flag('--quiet');

function readOriginal() {
  if (originalFile) return { text: fs.readFileSync(path.resolve(originalFile), 'utf8'), name: originalFile };
  try {
    const text = execFileSync('git', ['show', rev + ':CLAUDE.md'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return { text, name: rev + ':CLAUDE.md' };
  } catch (e) {
    console.error('check-split: cannot read ' + rev + ':CLAUDE.md from git (' + String(e.stderr || e.message).trim().split('\n')[0] + ').');
    console.error('             In a shallow clone, fetch that commit or pass --original <file>.');
    process.exit(2);
  }
}

// AGENTS.md, then every .md under agents/, in a stable order.
function docFiles() {
  const out = [];
  if (fs.existsSync(path.join(ROOT, 'AGENTS.md'))) out.push('AGENTS.md');
  const walk = (rel) => {
    for (const ent of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const child = rel + '/' + ent.name;
      if (ent.isDirectory()) walk(child);
      else if (ent.isFile() && ent.name.endsWith('.md')) out.push(child);
    }
  };
  if (fs.existsSync(path.join(ROOT, 'agents'))) walk('agents');
  return out;
}

const norm = (s) => s.replace(/\s+$/, '');
const isGeneric = (s) => /^\s*```/.test(s) || /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(s);
const clip = (s) => (s.length > 150 ? s.slice(0, 147) + '...' : s);

const original = readOriginal();
const origLines = original.text.split('\n').map(norm);
if (origLines.length && origLines[origLines.length - 1] === '') origLines.pop();

// line text -> [{ file, line }]
const where = new Map();
const files = docFiles();
for (const file of files) {
  fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').map(norm).forEach((text, i) => {
    if (text === '') return;
    if (!where.has(text)) where.set(text, []);
    where.get(text).push({ file, line: i + 1 });
  });
}

// distinct original line -> the original line numbers that carry it
const need = new Map();
origLines.forEach((text, i) => {
  if (text === '') return;
  if (!need.has(text)) need.set(text, []);
  need.get(text).push(i + 1);
});

const absent = [];
const duplicated = [];
for (const [text, at] of need) {
  const found = where.get(text) || [];
  if (found.length < at.length) absent.push({ text, at, found });
  else if (found.length > at.length && !isGeneric(text)) duplicated.push({ text, at, found });
}

// Lost by the split, or edited since? Every line these files held AT the split commit, read from git in one
// call (null when that commit is not there). A line the split carried over and a later commit rewrote is not a loss.
function linesAtSplit() {
  try {
    const out = execFileSync('git', ['grep', '-h', '-I', '-e', '', SPLIT_COMMIT, '--', 'AGENTS.md', ':(glob)agents/**/*.md'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const count = new Map();
    out.split('\n').map(norm).forEach((text) => { if (text !== '') count.set(text, (count.get(text) || 0) + 1); });
    return count;
  } catch (e) {
    return null;
  }
}
const atSplit = absent.length ? linesAtSplit() : null;
const editedSince = atSplit ? absent.filter((m) => (atSplit.get(m.text) || 0) >= m.at.length) : [];
const missing = absent.filter((m) => editedSince.indexOf(m) === -1);

// Where each run of original lines went (original line numbers are frozen in that last unsplit commit, so they
// do not drift). Blank and generic lines ride with their neighbours.
const home = origLines.map((text) => {
  if (text === '' || isGeneric(text)) return null;
  const found = where.get(text) || [];
  return found.length === 1 ? found[0].file : null;
});
const runsByFile = new Map();
let run = null;
for (let i = 0; i < origLines.length; i++) {
  const h = home[i];
  if (h === null) {
    // Undecided. A generic line straight after a run closes that run's fence or table; a blank line
    // only joins the run if the next decided line agrees.
    if (run && origLines[i] !== '' && run.to === i) run.to = i + 1;
    continue;
  }
  if (run && run.file === h) run.to = i + 1;
  else {
    run = { file: h, from: i + 1, to: i + 1 };
    if (!runsByFile.has(h)) runsByFile.set(h, []);
    runsByFile.get(h).push(run);
  }
}

const nonBlank = origLines.filter((t) => t !== '').length;
if (!quiet) {
  console.log('Where the lines of ' + original.name + ' went:');
  for (const file of files) {
    const runs = runsByFile.get(file);
    if (!runs) continue;
    console.log('  ' + file + '  <-  ' + runs.map((r) => (r.from === r.to ? String(r.from) : r.from + '-' + r.to)).join(', '));
  }
  console.log('');
}
for (const m of missing) {
  console.log('MISSING     (original line ' + m.at.join(', ') + '; found ' + m.found.length + ' of ' + m.at.length + ')  ' + clip(m.text));
}
for (const m of editedSince) {
  console.log('EDITED SINCE (original line ' + m.at.join(', ') + '; in these files at ' + SPLIT_COMMIT + ', rewritten later)  ' + clip(m.text));
}
if (absent.length && !atSplit) console.log('check-split: cannot read ' + SPLIT_COMMIT + ' from git, so a line edited since the split cannot be told from a lost one.');
for (const d of duplicated) {
  console.log('DUPLICATED  (original line ' + d.at.join(', ') + ')  ' + clip(d.text));
  for (const f of d.found) console.log('              in ' + f.file + ':' + f.line);
}
console.log('check-split: ' + origLines.length + ' lines in ' + original.name + ', ' + nonBlank + ' non-blank, checked against ' + files.length + ' file(s): ' +
  missing.length + ' missing, ' + duplicated.length + ' duplicated' + (editedSince.length ? ', ' + editedSince.length + ' edited since the split' : '') + '.');
process.exit(missing.length || (strict && duplicated.length) ? 1 : 0);
