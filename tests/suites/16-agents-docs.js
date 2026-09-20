// The guide for agents: AGENTS.md is the lean entry, CLAUDE.md a pointer to it, the depth is under agents/.
// An assistant loads CLAUDE.md (and what it imports) WHOLE at the start of every session, so the point of
// the split is lost the day either file grows back. This suite holds: the pointer stays a pointer, the
// entry stays short, every agents/architecture file is routed from the entry exactly once and opens
// with its purpose + "read this when / skip it when", and no link between these files is dead.
// The folder is described ONCE per file: AGENTS.md's reading guide (loaded every session) has one row per
// hand-written file and ONE for the generated index; agents/README.md's table names the top-level files, the
// tools and the two big folders as folders (architecture/ is listed file by file by the reading guide,
// index/ by its own generated README — one fact, one home). Both are held to the disk: nothing missing,
// nothing twice, nothing that is not there, no size badly out. AGENTS.md ≤ 160 lines, CLAUDE.md ≤ 8.
// None of it ships: not in ios-app/www, not in the service worker's precache list.
module.exports = function (t) {
  const { ok, eq, fs, path, REPO_ROOT } = t;
  t.section('Agents docs: a lean entry, a thin pointer, every topic file routed');
  const has = (rel) => fs.existsSync(path.join(REPO_ROOT, rel));
  const lines = (rel) => t.readSource(rel).replace(/\n$/, '').split('\n');

  const pointer = lines('CLAUDE.md');
  ok(pointer.length <= 8 && pointer.indexOf('@AGENTS.md') !== -1 && /AGENTS\.md/.test(pointer[0]),
    'CLAUDE.md is a pointer: a few lines, the first names AGENTS.md, one line is exactly "@AGENTS.md" (' + pointer.length + ' lines)');

  const entry = lines('AGENTS.md');
  ok(entry.length <= 160, 'AGENTS.md stays within 160 lines (' + entry.length + ') — depth belongs under agents/');
  ok(/^# /.test(entry[0]) && /Read this when/.test(entry[1]) && /Skip/.test(entry[1]), 'AGENTS.md opens with its purpose and when to read it');

  // The reading guide: every agents/architecture/*.md is the "Read" cell of exactly one row.
  const from = entry.indexOf('## Reading guide');
  const rest = entry.slice(from + 1);
  const next = rest.findIndex((l) => /^## /.test(l));
  const guide = from === -1 ? [] : rest.slice(0, next === -1 ? rest.length : next).filter((l) => /^\|/.test(l));
  const readCells = guide.map((row) => (row.split('|')[2] || '').trim());
  const dir = 'agents/architecture';
  const topicFiles = fs.readdirSync(path.join(REPO_ROOT, dir)).filter((f) => /\.md$/.test(f)).sort();
  ok(topicFiles.length >= 20, dir + ' holds the topic files (' + topicFiles.length + ')');
  // A row names a file bare ("booking.md" — the guide says a bare name is in agents/architecture/) or by its full path, as
  // text or as a link; "agents/README.md" and "agents/index/README.md" are other files and do not count as README.md.
  const names = (cell, f) => new RegExp('(?:^|[\\s,(\\[`])(?:' + dir + '/)?' + f.replace(/\./g, '\\.') + '(?=$|[\\s,)\\]`])').test(cell);
  const unrouted = topicFiles.filter((f) => readCells.filter((cell) => names(cell, f)).length !== 1);
  eq(unrouted, [], 'every ' + dir + ' file is routed from AGENTS.md\'s reading guide exactly once');
  ok(readCells.some((c) => c.indexOf('agents/repo-map.md') !== -1), 'so is agents/repo-map.md');

  // Every topic file says what it is for, then when to read it and when to skip it — in its first two lines.
  const headless = topicFiles.concat(['../repo-map.md']).filter((f) => {
    const head = lines(dir + '/' + f);
    return !(/^# /.test(head[0]) && /read this/i.test(head[1]) && /skip it/i.test(head[1]));
  });
  eq(headless, [], 'each opens with "# title" and a "Read this … Skip it …" line');

  // No dead links among them. agents/index/ is generated: a link into it is checked only once it exists.
  const dead = [];
  ['AGENTS.md', 'agents/repo-map.md'].concat(topicFiles.map((f) => dir + '/' + f)).forEach((rel) => {
    const text = t.readSource(rel);
    const re = /\]\(([^)#\s]+\.md)\)/g;
    let m;
    while ((m = re.exec(text))) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
      if (target.indexOf('agents/index/') === 0 && !has('agents/index')) continue;
      if (!has(target)) dead.push(rel + ' → ' + m[1]);
    }
  });
  eq(dead, [], 'every Markdown link between the guide\'s files resolves');
  // Paths the entry names in plain text (its table cells, its rules) — the ones this split owns.
  const named = (t.readSource('AGENTS.md').match(/agents\/(?:architecture\/[a-z-]+\.md|architecture\/README\.md|repo-map\.md|tools\/check-split\.mjs)/g) || []);
  eq(named.filter((p) => !has(p)), [], 'every agents/architecture, repo-map and tools path AGENTS.md names exists');

  // ── The two lists of the folder, against the disk ──────────────────────────────────────────────
  t.section('Agents docs: the reading guide and agents/README.md list what is on disk, with honest sizes');
  const walk = (rel) => fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true }).reduce((out, ent) => {
    if (ent.name[0] === '.') return out;                       // a Finder droppings file is not a doc
    const child = rel + '/' + ent.name;
    return out.concat(ent.isDirectory() ? walk(child) : [child]);
  }, []).sort();
  const everyFile = walk('agents');
  // agents/index/ is GENERATED and lists itself (its README); the always-loaded entry gives it one row.
  const generated = (f) => f.indexOf('agents/index/') === 0 && f !== 'agents/index/README.md';
  const handWritten = everyFile.filter((f) => !generated(f));
  ok(handWritten.length >= 35 && everyFile.length > handWritten.length, 'agents/ holds hand-written files (' + handWritten.length + ') and a generated index (' + (everyFile.length - handWritten.length) + ')');

  // A size is bytes ÷ 4. It may be out by a quarter (a generated file's by half) before it misleads anyone.
  const realTokens = (rel) => fs.statSync(path.join(REPO_ROOT, rel)).size / 4;
  const firstNumber = (cell) => { const m = /\d[\d,]*/.exec(cell || ''); return m ? Number(m[0].replace(/,/g, '')) : NaN; };
  const sizeComplaint = (where, rel, stated) => {
    const real = realTokens(rel), loose = generated(rel);
    const allowed = Math.max(loose ? 500 : 250, real * (loose ? 0.5 : 0.25));
    return Math.abs(stated - real) <= allowed ? null : where + ' says ' + stated + ' for ' + rel + '; bytes ÷ 4 is ' + Math.round(real / 50) * 50;
  };

  // 1. AGENTS.md's reading guide: every hand-written file is named by exactly one row.
  const esc = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namedIn = (cell, full) => {
    const form = full.indexOf(dir + '/') === 0 ? '(?:' + esc(dir + '/') + ')?' + esc(full.slice(dir.length + 1)) : esc(full);
    return new RegExp('(?:^|[\\s,(\\[`·])' + form + '(?=$|[\\s,)\\]`·])').test(cell);
  };
  const guideRows = guide.map((row) => row.split('|').slice(1, -1).map((c) => c.trim()));
  eq(handWritten.filter((f) => guideRows.filter((cells) => namedIn(cells[1] || '', f)).length !== 1), [],
    'every hand-written file under agents/ is the "Read" cell of exactly one reading-guide row');
  const guideSizes = [];
  guideRows.forEach((cells) => {
    const files = handWritten.filter((f) => namedIn(cells[1] || '', f));
    if (files.length !== 1 || !/\.md$/.test(files[0])) return;            // the tools row names two scripts: nobody reads those whole
    const complaint = sizeComplaint('AGENTS.md', files[0], firstNumber(cells[2]));
    if (complaint) guideSizes.push(complaint);
  });
  eq(guideSizes, [], 'each "≈ tokens" cell of the reading guide is within a quarter of bytes ÷ 4');

  // 2. agents/README.md: every top-level file and every tool, exactly once — and nothing that is not there. The files of
  // architecture/ and index/ are NOT repeated in it (list 1 and agents/index/README.md own them): it names the two
  // folders, with an honest total. A file cell is nothing but a name (or a link to one); a "### folder/" heading says
  // where the bare names below it live.
  const readme = lines('agents/README.md');
  const mFrom = readme.indexOf('## What each file answers');
  const mRest = readme.slice(mFrom + 1);
  const mNext = mRest.findIndex((l) => /^## /.test(l));
  const manifest = mFrom === -1 ? [] : mRest.slice(0, mNext === -1 ? mRest.length : mNext);
  let folder = 'agents';
  const listed = [], listedDirs = [], readmeSizes = [];
  manifest.forEach((l) => {
    const heading = /^### ([\w-]+)\//.exec(l);
    if (heading) { folder = 'agents/' + heading[1]; return; }
    if (!/^\|/.test(l) || /^\|\s*:?-{3}/.test(l)) return;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    cells.forEach((cell, i) => {
      const link = /^\[[^\]]*\]\(([^)]+)\)$/.exec(cell);
      const name = link ? link[1] : cell;
      if (/^[\w.-]+\/$/.test(name)) {
        const dirRel = path.posix.join(folder, name);
        listedDirs.push(dirRel);
        const total = /^\d/.test(cells[cells.length - 1] || '') ? firstNumber(cells[cells.length - 1]) : NaN;
        if (has(dirRel) && !isNaN(total)) {
          const real = walk(dirRel.replace(/\/$/, '')).reduce((sum, f) => sum + realTokens(f), 0);
          if (Math.abs(total - real) > real * (dirRel === 'agents/index/' ? 0.5 : 0.25)) readmeSizes.push('agents/README.md says ' + total + ' for ' + dirRel + '; bytes ÷ 4 is ' + Math.round(real / 500) * 500);
        }
        return;
      }
      if (!/^[\w./-]+\.(?:md|mjs)$/.test(name)) return;
      const rel = path.posix.normalize(path.posix.join(folder, name));
      listed.push(rel);
      if (!has(rel)) return;
      const sizeCell = /^\d/.test(cells[i + 1] || '') ? cells[i + 1] : cells[cells.length - 1];
      const complaint = sizeComplaint('agents/README.md', rel, firstNumber(sizeCell));
      if (complaint) readmeSizes.push(complaint);
    });
  });
  const listedElsewhere = (f) => f.indexOf(dir + '/') === 0 || f.indexOf('agents/index/') === 0;
  const expected = ['AGENTS.md'].concat(everyFile.filter((f) => !listedElsewhere(f)));
  eq(expected.filter((f) => listed.filter((l) => l === f).length !== 1), [], 'agents/README.md lists AGENTS.md, every top-level file of agents/ and every tool exactly once (' + expected.length + ' files)');
  eq(listed.filter((l) => expected.indexOf(l) === -1), [], 'and no file that is not there — nor one that the reading guide or agents/index/README.md already lists');
  eq(listedDirs.filter((d) => !has(d)), [], 'and every folder it names exists (' + listedDirs.length + ')');
  eq([dir + '/', 'agents/index/', 'agents/tools/'].filter((d) => listedDirs.indexOf(d) === -1), [], 'it names architecture/, index/ and tools/ as folders');
  ok(has('agents/index/README.md') && everyFile.filter(generated).every((f) => t.readSource('agents/index/README.md').indexOf('(' + f.slice('agents/index/'.length) + ')') !== -1),
    'agents/index/README.md (generated) links every other file of the index');
  eq(readmeSizes, [], 'each "≈ tokens" cell of agents/README.md — a folder\'s total included — is within a quarter of bytes ÷ 4 (generated: half)');

  // 3. The files the split did not own — decisions, learnings, playbooks, ontology, the folder's README — name other docs
  // in plain text and by link. Same rule: what is named exists.
  const others = handWritten.filter((f) => /\.md$/.test(f) && f.indexOf(dir + '/') !== 0 && f !== 'agents/repo-map.md');
  const deadElsewhere = [];
  others.forEach((rel) => {
    const text = t.readSource(rel);
    (text.match(/(?:^|[^\w./-])(?:AGENTS\.md|agents\/[\w./-]+\.(?:md|mjs))(?![\w-])/g) || []).forEach((hit) => {
      const p = hit.replace(/^[^A-Za-z]+/, '');
      if (!has(p)) deadElsewhere.push(rel + ' names ' + p);
    });
    const re = /\]\(([^)#\s]+)\)/g;
    let m;
    while ((m = re.exec(text))) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
      if (!has(target)) deadElsewhere.push(rel + ' → ' + m[1]);
    }
  });
  eq(deadElsewhere, [], 'every agents/ path and every link in the other hand-written files resolves (' + others.length + ' files)');

  // 4. None of it ships. ios-app/build.js copies js/, css/, fonts/ and five named root files; the docs are for the repository only.
  const www = fs.readdirSync(path.join(REPO_ROOT, 'ios-app', 'www'));
  eq(www.filter((f) => /^agents$/i.test(f) || /^(?:AGENTS|CLAUDE)\.md$/i.test(f)), [], 'ios-app/www holds no agents/ folder, no AGENTS.md, no CLAUDE.md');
  ok(!/agents\/|AGENTS\.md|CLAUDE\.md/.test(t.readSource('sw.js')) && !/agents\/|AGENTS\.md|CLAUDE\.md/.test(t.readSource('ios-app/www/sw.js')),
    'neither sw.js copy precaches (or names) any of it');
  ok(!/['"`]agents['"`/]|AGENTS\.md/.test(t.readSource('ios-app/build.js')), 'ios-app/build.js does not know the folder exists');
};
