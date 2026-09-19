'use strict';
// Wave 10b — two themes retired, and two small theme-level fixes.
//
//   1. Linen and Synthwave are GONE: no registry entry, no token block, no
//      selector in any stylesheet, no first-paint entry, no picker chip. Their
//      ids still mean something where a member left them — a saved
//      psycle_theme, a ?theme= link, a settings backup — and read as the theme
//      on the same base (Linen → Cloud, Synthwave → Graphite), so an explicit
//      light / dark choice does not turn into "follow the system".
//   2. Terminal and Handheld on a phone: the date row's five ranges are two
//      rows of one track, so "14 days" is not clipped at rest at 375 / 390.
//   3. The favourite star reads --fav, set per theme, >= 3:1 as a graphic.
//
// DOM-free: the real pure block, the real theme.js sections A–A2 against a fake
// page, the real first-paint scripts, the real import planner, and the shipped
// CSS read as text.
module.exports = async function (t) {
  const { ok, eq } = t;
  const themeJs = t.readSource('js/theme.js');
  const settingsJs = t.readSource('js/settings.js');
  const tabsJs = t.readSource('js/tabs.js');
  const themeCss = t.readSource('css/theme.css');
  const crispCss = t.readSource('css/crisp.css');
  const finder = t.readSource('psycle-finder.html');
  const login = t.readSource('login.html');
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const CSS_FILES = t.fs.readdirSync(t.path.join(t.REPO_ROOT, 'css')).filter((f) => /\.css$/.test(f)).sort();
  const RETIRED = { linen: 'cloud', synthwave: 'graphite' };

  const registry = [];
  themeJs.replace(/\{\s*id:\s*'([a-z]+)',\s*name:\s*'([^']+)',\s*base:\s*'(light|dark)',\s*bg:\s*'(#[0-9a-f]{6})'([^}]*)\}/g,
    (m, id, name, base, bg, rest) => { registry.push({ id, name, base, bg, mono: /mono:\s*true/.test(rest) }); return m; });
  const ids = registry.map((x) => x.id);
  const byId = (id) => registry.filter((x) => x.id === id)[0];

  // ── 1. The registry ──────────────────────────────────────────────────────
  t.section('10b themes: five themes, the two retired ones gone from the registry');
  eq(ids, ['cloud', 'graphite', 'terminal', 'gameboy', 'blueprint'], 'APP_THEMES = Cloud, Graphite, Terminal, Handheld, Blueprint — in the picker\'s order');
  eq(registry.map((x) => x.name), ['Cloud', 'Graphite', 'Terminal', 'Handheld', 'Blueprint'], 'the names a member sees');
  eq([registry.filter((x) => x.base === 'light').map((x) => x.id), registry.filter((x) => x.mono).map((x) => x.id)], [['cloud'], ['terminal', 'gameboy']],
    'Cloud is the one light base; Terminal and Handheld are still the mono pair');
  ok(/const DEFAULT_THEME = 'cloud';/.test(themeJs), 'Cloud is still the default');

  // ── 2. The retired map (pure) ────────────────────────────────────────────
  t.section('10b themes: a retired id reads as the theme on the same base (pure:theme-retired)');
  {
    const pure = t.loadPure('js/theme.js', 'theme-retired');
    eq(JSON.parse(JSON.stringify(pure.RETIRED_THEMES)), RETIRED, 'RETIRED_THEMES = { linen → cloud, synthwave → graphite }');
    eq([pure._currentThemeId('linen'), pure._currentThemeId('synthwave')], ['cloud', 'graphite'], 'Linen → Cloud, Synthwave → Graphite');
    eq([byId('cloud').base, byId('graphite').base], ['light', 'dark'], '…a light theme stays light and a dark one dark (the member\'s own choice is kept)');
    Object.keys(RETIRED).forEach((old) => ok(ids.indexOf(old) === -1 && ids.indexOf(RETIRED[old]) !== -1, old + ' is not a registry id any more, and what it maps to is'));
    eq(ids.map(pure._currentThemeId), ids, 'every current id passes through unchanged');
    eq([pure._currentThemeId('dark'), pure._currentThemeId('light'), pure._currentThemeId(''), pure._currentThemeId('LINEN'), pure._currentThemeId(' linen')], ['dark', 'light', '', 'LINEN', ' linen'],
      'legacy "dark" / "light", an empty value and near-misses are left alone (they still mean "follow the system")');
    eq([pure._currentThemeId(null), pure._currentThemeId(undefined), pure._currentThemeId(7)], [null, undefined, 7], 'a non-string comes back as it was — never a throw');
    eq(['constructor', '__proto__', 'toString', 'hasOwnProperty'].map(pure._currentThemeId), ['constructor', '__proto__', 'toString', 'hasOwnProperty'],
      'only an OWN key of the map counts (an id is untrusted text)');
    ok(/window\.RETIRED_THEMES = RETIRED_THEMES;/.test(themeJs), 'the map is exposed once, for the settings import');
  }

  // ── 3. theme.js against a fake page ──────────────────────────────────────
  t.section('10b themes: a saved / deep-linked retired theme — migrated, rewritten once, never "follow the system"');
  {
    const from = themeJs.indexOf('// ── A. Themes'), to = themeJs.indexOf('// ── B. Skeleton Loading Cards');
    ok(from !== -1 && to > from, 'theme.js sections A–A2 found');
    const boot = (opts) => {
      opts = opts || {};
      const store = Object.assign({}, opts.store || {});
      const log = { sets: [], mirrored: [], listeners: [] };
      const attrs = { 'data-theme': 'cloud' };
      const meta = { content: '#e6e9ee', setAttribute(k, v) { if (k === 'content') this.content = v; } };
      const style = { setProperty() {}, removeProperty() {} };
      const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { if (opts.readOnly) throw new Error('SecurityError'); log.sets.push([k, String(v)]); store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      };
      const window = { matchMedia: (q) => ({ matches: /dark/.test(q) ? !!opts.systemDark : !opts.systemDark, addEventListener: (n, fn) => log.listeners.push(fn) }) };
      let settle = null;
      if (opts.native) window._psycleNativeRestoreReady = new Promise((r) => { settle = r; });
      const ctx = t.vm.createContext({
        window, localStorage, console, JSON, Object, String, Array, Promise,
        document: { documentElement: { style, getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); } },
          querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null), getElementById: () => null, createElement: () => ({}) },
        PsycleEvents: { emit() {} }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
        haptic() {}, URLSearchParams, location: { search: opts.search || '' },
      });
      t.vm.runInContext(themeJs.slice(from, to), ctx, { filename: 'js/theme.js[A–A2]' });
      t.vm.runInContext('initTheme()', ctx);
      return { window, ctx, store, attrs, meta, log, settle, localStorage };
    };
    const themeSets = (w) => w.log.sets.filter((s) => s[0] === 'psycle_theme').map((s) => s[1]);

    let w = boot({ store: { psycle_theme: 'linen' }, systemDark: true });
    eq([w.attrs['data-theme'], w.meta.content, w.store.psycle_theme], ['cloud', byId('cloud').bg, 'cloud'],
      'saved "linen" on a DARK-mode phone → Cloud, Cloud\'s status-area colour, and the stored value rewritten (it would have followed the system to Graphite)');
    eq(themeSets(w), ['cloud'], '…rewritten exactly once');
    eq([w.window.getAppTheme(), w.window.getAppTheme(), themeSets(w).length], ['cloud', 'cloud', 1], '…and reading the theme again writes nothing more');

    w = boot({ store: { psycle_theme: 'synthwave' }, systemDark: false });
    eq([w.attrs['data-theme'], w.meta.content, w.store.psycle_theme, themeSets(w)], ['graphite', byId('graphite').bg, 'graphite', ['graphite']],
      'saved "synthwave" on a LIGHT-mode phone → Graphite, stored as "graphite"');
    t.vm.runInContext('toggleTheme()', w.ctx);
    eq([w.attrs['data-theme'], w.store.psycle_theme], ['cloud', 'cloud'], 'the header sun / moon still flips a migrated member between the two bases');

    w = boot({ store: {}, systemDark: true, search: '?theme=linen' });
    eq([w.attrs['data-theme'], w.store.psycle_theme], ['cloud', 'cloud'], '?theme=linen opens — and saves — Cloud');
    w = boot({ store: { psycle_theme: 'terminal' }, search: '?theme=synthwave' });
    eq([w.attrs['data-theme'], w.store.psycle_theme], ['graphite', 'graphite'], '?theme=synthwave opens Graphite, over a saved theme like any deep link');
    w = boot({ store: { psycle_theme: 'blueprint' }, search: '?theme=vaporwave' });
    eq([w.attrs['data-theme'], w.store.psycle_theme, themeSets(w)], ['blueprint', 'blueprint', []], 'an unknown ?theme= is still ignored');

    ids.forEach((id) => {
      const x = boot({ store: { psycle_theme: id }, systemDark: id === 'cloud' });
      eq([x.attrs['data-theme'], x.store.psycle_theme, themeSets(x)], [id, id, []], 'saved "' + id + '": worn as is, nothing written');
    });
    w = boot({ store: {}, systemDark: true });
    eq([w.attrs['data-theme'], 'psycle_theme' in w.store], ['graphite', false], 'nothing saved → the system scheme, and STILL nothing saved (it keeps following the system)');
    w = boot({ store: { psycle_theme: 'dark' }, systemDark: false });
    eq([w.attrs['data-theme'], w.store.psycle_theme], ['cloud', 'dark'], 'a legacy "dark" still follows the system and is not rewritten');

    let threw = false;
    try { w = boot({ store: { psycle_theme: 'linen' }, systemDark: true, readOnly: true }); } catch (e) { threw = true; }
    eq([threw, w.attrs['data-theme'], w.store.psycle_theme], [false, 'cloud', 'linen'], 'storage that refuses the rewrite: no throw, and the member still gets Cloud');
    w.log.listeners.forEach((fn) => fn());
    eq(w.attrs['data-theme'], 'cloud', '…even when the system scheme flips afterwards');

    eq(typeof w.window.setAppTheme, 'function', 'setAppTheme is exposed');
    w = boot({ store: { psycle_theme: 'cloud' } });
    w.window.setAppTheme('linen'); w.window.setAppTheme('synthwave');
    eq([w.attrs['data-theme'], w.store.psycle_theme], ['cloud', 'cloud'], 'setAppTheme refuses a retired id — nothing can pick one any more');
  }

  t.section('10b themes: iOS — the Preferences mirror follows the rewrite');
  {
    // native-bridge.js (the LAST script) patches localStorage.setItem to mirror
    // SYNC_KEYS. theme.js rewrites a retired id before that patch exists, so
    // the mirror would keep the old id and hand it back after a storage purge.
    const from = themeJs.indexOf('// ── A. Themes'), to = themeJs.indexOf('// ── B. Skeleton Loading Cards');
    const run = async (store, afterLaunch) => {
      const mirrored = [];
      const attrs = { 'data-theme': 'cloud' };
      const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
      let settle = null;
      const window = { matchMedia: () => ({ matches: true, addEventListener() {} }), _psycleNativeRestoreReady: new Promise((r) => { settle = r; }) };
      const ctx = t.vm.createContext({
        window, localStorage, console, JSON, Object, String, Array, Promise,
        document: { documentElement: { style: { setProperty() {}, removeProperty() {} }, getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); } },
          querySelector: () => null, getElementById: () => null },
        PsycleEvents: { emit() {} }, getComputedStyle: () => ({ getPropertyValue: () => '' }), haptic() {}, URLSearchParams, location: { search: '' },
      });
      t.vm.runInContext(themeJs.slice(from, to), ctx, { filename: 'js/theme.js[A–A2]' });
      t.vm.runInContext('initTheme()', ctx);
      const atLaunch = attrs['data-theme'];
      // …the bridge loads: from here on a write is mirrored.
      const raw = localStorage.setItem;
      localStorage.setItem = (k, v) => { raw(k, v); mirrored.push([k, String(v)]); };
      if (afterLaunch) afterLaunch(store);
      settle();
      await new Promise((r) => setTimeout(r, 0));
      return { atLaunch, attr: attrs['data-theme'], store, mirrored: mirrored.filter((m) => m[0] === 'psycle_theme').map((m) => m[1]) };
    };
    const a = await run({ psycle_theme: 'linen' });
    eq([a.atLaunch, a.store.psycle_theme, a.mirrored], ['cloud', 'cloud', ['cloud']], 'a launch that rewrote "linen" says "cloud" again once the bridge mirrors writes');
    const b = await run({ psycle_theme: 'graphite' });
    eq([b.attr, b.mirrored], ['graphite', []], 'an ordinary launch writes nothing after the handshake');
    // A purge: localStorage empty at launch, the restore brings the OLD id back.
    const c = await run({}, (store) => { store.psycle_theme = 'synthwave'; });
    eq([c.atLaunch, c.attr, c.store.psycle_theme, c.mirrored], ['graphite', 'graphite', 'graphite', ['graphite']],
      'after a purge the restored "synthwave" is rewritten through the patched setter — the mirror is corrected there and then');
    const d = await run({}, (store) => { store.psycle_theme = 'linen'; });
    eq([d.atLaunch, d.attr, d.store.psycle_theme], ['graphite', 'cloud', 'cloud'], '…and a restored "linen" re-themes the launch that started on the system\'s Graphite');
  }

  {
    // ── 4. First paint ─────────────────────────────────────────────────────
    t.section('10b themes: both first-paint scripts carry the same five themes and the same retired map');
    {
      const bootOf = (html) => (/<script id="themeBoot">([\s\S]*?)<\/script>/.exec(html) || [])[1] || '';
      const mapOf = (src, name) => {
        const out = {};
        ((new RegExp('var ' + name + ' = \\{([^}]*)\\}').exec(src) || [])[1] || '').replace(/([a-z]+):\s*'([^']+)'/g, (m, k, v) => { out[k] = v; return m; });
        return out;
      };
      [['psycle-finder.html', finder], ['login.html', login]].forEach((pg) => {
        const src = bootOf(pg[1]);
        const bg = {};
        registry.forEach((x) => { bg[x.id] = x.bg; });
        eq(mapOf(src, 'BG'), bg, pg[0] + ': BG = the five registry themes, id → ground');
        eq(mapOf(src, 'RETIRED'), RETIRED, pg[0] + ': RETIRED = theme.js\'s RETIRED_THEMES');
        const run = (saved, systemDark) => {
          const out = { attr: null, meta: null };
          const ctx = t.vm.createContext({
            localStorage: { getItem: (k) => (k === 'psycle_theme' ? saved : null) },
            window: { matchMedia: (q) => ({ matches: /dark/.test(q) ? !!systemDark : !systemDark }) },
            document: { documentElement: { setAttribute: (k, v) => { if (k === 'data-theme') out.attr = v; } },
              querySelector: () => ({ setAttribute: (k, v) => { if (k === 'content') out.meta = v; } }) },
            Object,
          });
          t.vm.runInContext(src, ctx, { filename: pg[0] + '[themeBoot]' });
          return [out.attr, out.meta];
        };
        eq([run('linen', true), run('synthwave', false)], [['cloud', bg.cloud], ['graphite', bg.graphite]],
          pg[0] + ': a saved retired id paints its replacement from the FIRST frame — against the system scheme, no flash of the other base');
        eq([run('hasOwnProperty', true)[0], run('constructor', false)[0]], ['graphite', 'cloud'], pg[0] + ': an inherited key is no theme and no retired theme');
      });
      ok(!/\[data-theme="(linen|synthwave)"\]/.test(login), 'login.html\'s inlined token blocks: Linen and Synthwave are gone');
    }

    // ── 5. Settings import ─────────────────────────────────────────────────
    t.section('10b themes: a settings backup that names a retired theme is accepted and mapped');
    {
      const clean = t.loadPure('js/app.js', 'stored-data');
      const imp = t.loadPure('js/settings.js', 'import-validate');
      const device = (obj) => (key) => (Object.prototype.hasOwnProperty.call(obj || {}, key) ? obj[key] : null);
      const OPTS = { clean: { history: clean._cleanStoredHistory, tiers: clean._cleanStoredTiers, idList: clean._cleanStoredIdList, bikePrefs: clean._cleanStoredBikePrefs }, themes: ids, retiredThemes: RETIRED, historyMax: 2000 };
      const plan = (file, dev, opts) => imp._planSettingsImport(file, device(dev), Object.assign({}, OPTS, opts || {}));
      let pl = plan({ psycle_theme: 'linen' }, {});
      eq([pl.writes.psycle_theme, pl.accepted, pl.skipped, pl.added.theme], ['cloud', 1, [], 1], 'a backup saved on Linen imports as Cloud — accepted, nothing skipped');
      pl = plan({ psycle_theme: 'synthwave' }, {});
      eq([pl.writes.psycle_theme, pl.accepted], ['graphite', 1], '…and one saved on Synthwave as Graphite');
      pl = plan({ psycle_theme: 'terminal' }, {});
      eq(pl.writes.psycle_theme, 'terminal', 'a current theme imports as itself');
      pl = plan({ psycle_theme: 'linen' }, { psycle_theme: 'blueprint' });
      eq([pl.writes.psycle_theme, pl.accepted], [undefined, 1], 'the device\'s own theme is still never replaced');
      pl = plan({ psycle_theme: 'terminal' }, { psycle_theme: 'synthwave' });
      eq(pl.writes.psycle_theme, undefined, 'a device still holding a retired id HAS a theme (its Graphite): the file does not override it');
      pl = plan({ psycle_theme: 'vaporwave' }, {});
      eq([pl.writes.psycle_theme, pl.skipped.map((s) => s.key + ':' + s.reason)], [undefined, ['psycle_theme:unknown theme']], 'an id that was never a theme is still refused');
      pl = plan({ psycle_theme: 'linen' }, {}, { retiredThemes: null });
      eq(pl.skipped.map((s) => s.reason), ['unknown theme'], 'without the map the planner refuses it (so the wiring below matters)');
      pl = plan({ psycle_theme: 'constructor' }, {}, { retiredThemes: RETIRED });
      eq(pl.writes.psycle_theme, undefined, 'an inherited key of the map is not a retired theme');
      pl = plan({ psycle_theme: 'linen' }, {}, { retiredThemes: { linen: 'neon' } });
      eq([pl.writes.psycle_theme, pl.skipped.length], [undefined, 1], 'what the map answers is still held to the registry');
      ok(/themes: \(window\.APP_THEMES \|\| \[\]\)\.map\(function \(t\) \{ return t\.id; \}\),\s*retiredThemes: window\.RETIRED_THEMES \|\| null,/.test(settingsJs),
        'importSettings hands the planner js/theme.js\'s map');
    }

    // ── 6. The stylesheets ─────────────────────────────────────────────────
    t.section('10b themes: no stylesheet, script or page names a retired theme');
    {
      const naming = (src) => (src.match(/linen|synthwave/gi) || []).length;
      CSS_FILES.forEach((f) => eq(naming(t.readSource('css/' + f)), 0, 'css/' + f + ': neither name appears — selectors, token blocks or comments'));
      const blocks = [];
      noComments(themeCss).replace(/(^|\n)\[data-theme="([a-z]+)"\] \{/g, (m, a, id) => { blocks.push(id); return m; });
      eq(blocks.slice().sort(), ids.slice().sort(), 'css/theme.css has exactly one token block per registry theme');
      const named = new Set();
      CSS_FILES.forEach((f) => noComments(t.readSource('css/' + f)).replace(/\[data-theme="([^"]+)"\]/g, (m, id) => { named.add(id); return m; }));
      eq(Array.from(named).filter((id) => ids.indexOf(id) === -1), ['light'], 'every [data-theme="…"] in every stylesheet is a registry id (plus the legacy "light" of the light-base list)');
      ok(noComments(themeCss).indexOf(':is([data-theme="light"], [data-theme="cloud"]) ') !== -1, 'the light-base list is :is(light, cloud) — same specificity as before');
      ok(/\nhtml:is\(\[data-theme="graphite"\], \[data-theme="blueprint"\]\) \{/.test(themeCss), 'the dark class-colour defaults list Graphite and Blueprint');
      // Scripts and pages: the names survive in ONE line each — the map.
      t.fs.readdirSync(t.JS_DIR).filter((f) => /\.js$/.test(f)).forEach((f) => {
        const lines = t.readSource('js/' + f).split('\n').filter((l) => /\blinen\b|synthwave/i.test(l));
        eq(lines.map((l) => l.trim()), f === 'theme.js' ? ["var RETIRED_THEMES = { linen: 'cloud', synthwave: 'graphite' };"] : [], 'js/' + f + (f === 'theme.js' ? ': only the retired map names them' : ': neither name'));
      });
      [['psycle-finder.html', finder], ['login.html', login]].forEach((pg) => {
        const lines = pg[1].split('\n').filter((l) => /linen|synthwave/i.test(l));
        eq(lines.map((l) => l.trim()), ["var RETIRED = { linen: 'cloud', synthwave: 'graphite' };"], pg[0] + ': only the first-paint script\'s retired map names them');
      });
      eq(naming(t.readSource('manifest.json')), 0, 'manifest.json names neither');
    }

    // ── 7. The picker ──────────────────────────────────────────────────────
    t.section('10b themes: the picker draws five chips, from the registry');
    {
      const from = tabsJs.indexOf('  function renderThemePicker() {');
      const to = tabsJs.indexOf('\n  }\n', from);
      ok(from !== -1 && to > from, 'renderThemePicker can be sliced (anchor moved?)');
      const box = { innerHTML: '' };
      const ctx = t.vm.createContext({
        window: { APP_THEMES: registry.map((x) => ({ id: x.id, name: x.name, base: x.base })) },
        document: { getElementById: (id) => (id === 'themePicker' ? box : null) },
        getAppTheme: () => 'graphite', renderClassColours() {},
      });
      t.vm.runInContext(tabsJs.slice(from, to + 4) + '\nrenderThemePicker();', ctx, { filename: 'js/tabs.js[renderThemePicker]' });
      const chips = [];
      box.innerHTML.replace(/<button class="theme-chip( active)?" aria-pressed="(true|false)" onclick="window\._pickTheme\('([a-z]+)'\)">[\s\S]*?<span class="theme-chip-name">([^<]+)<\/span>/g,
        (m, active, pressed, id, name) => { chips.push([id, name, pressed]); return m; });
      eq(chips, [['cloud', 'Cloud', 'false'], ['graphite', 'Graphite', 'true'], ['terminal', 'Terminal', 'false'], ['gameboy', 'Handheld', 'false'], ['blueprint', 'Blueprint', 'false']],
        'Cloud · Graphite · Terminal · Handheld · Blueprint — a member who was on Synthwave finds Graphite pressed');
      ok(!/linen|synthwave/i.test(tabsJs), 'js/tabs.js keeps no theme list of its own');
    }

    // ── 8. Terminal / Handheld: the date row on a phone ────────────────────
    t.section('10b themes: Terminal and Handheld — five ranges in two rows on a phone, nothing clipped at rest');
    {
      const css = noComments(crispCss);
      const rules = [];
      // A selector list split at its TOP-LEVEL commas only (":is(a, b) .x" is one selector).
      const selectors = (head) => {
        const out = [];
        let depth = 0, cur = '';
        head.split('').forEach((ch) => {
          if (ch === '(') depth++; else if (ch === ')') depth--;
          if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
        });
        out.push(cur);
        return out.map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
      };
      (function walk(src, media) {
        let i = 0;
        while (i < src.length) {
          const open = src.indexOf('{', i);
          if (open === -1) break;
          const head = src.slice(i, open).trim();
          let depth = 1, j = open + 1;
          while (j < src.length && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
          const body = src.slice(open + 1, j - 1);
          if (/^@media/.test(head)) walk(body, head.replace(/\s+/g, ' '));
          else if (!/^@/.test(head)) selectors(head).forEach((sel) => rules.push({ sel, body, media }));
          i = j;
        }
      })(css, '');
      eq(selectors(':is(.a, .b) .c, .d'), [':is(.a, .b) .c', '.d'], '(the selector splitter keeps an :is() list whole)');
      const MONO = 'html:is([data-theme="terminal"], [data-theme="gameboy"])';
      const PHONE = '@media (max-width: 640px)';
      const one = (sel, media) => { const r = rules.filter((x) => x.sel === sel && x.media === media); return r.length === 1 ? r[0].body : ''; };
      const track = one(MONO + ' .date-track', PHONE), seg = one(MONO + ' .date-track .date-quick-btn', PHONE), low = one(MONO + ' .date-track .date-quick-btn:nth-child(n+4)', PHONE);
      ok(/display:\s*grid;/.test(track) && /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);/.test(track), 'the mono track is a six-column grid at <= 640px');
      ok(/flex:\s*1 1 0;/.test(track) && /min-width:\s*0;/.test(track), '…that takes the row\'s width instead of its content\'s (nothing left to scroll)');
      ok(/border-radius:\s*var\(--radius-7xl\);/.test(track), 'its corner is a token Handheld zeroes (one row\'s pill radius + the track padding)');
      ok(/grid-column:\s*span 2;/.test(seg) && /grid-column:\s*span 3;/.test(low), 'the first three ranges span two columns, the last two three');
      // Five buttons in the markup, in this order: 3 × 2 + 2 × 3 = two FULL rows of six.
      const labels = [];
      ((/<span class="date-track">([\s\S]*?)<\/span>/.exec(finder) || [])[1] || '').replace(/<button class="date-quick-btn"[^>]*>([^<]+)<\/button>/g, (m, text) => { labels.push(text); return m; });
      eq(labels, ['Today', 'Tomorrow', '7 days', 'Next week', '14 days'], 'the five ranges, as the page prints them');
      const spans = labels.map((l, i) => (i + 1 >= 4 ? 3 : 2));
      eq([spans.reduce((a, b) => a + b, 0), spans.slice(0, 3).reduce((a, b) => a + b, 0)], [12, 6], 'Today · Tomorrow · 7 days fill the first row and Next week · 14 days the second — no orphan cell');
      // It fits: the longest label of each row against its cell, in a mono face.
      const root = {};
      ((/:root\s*\{([\s\S]*?)\n\}/.exec(themeCss) || [])[1] || '').replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { root[k] = v.trim(); return m; });
      const px = (name) => parseFloat(root[name]);
      eq([root['--space-1'], root['--space-3'], root['--space-12'], root['--type-caption'], root['--radius-7xl'], root['--tap-min']], ['4px', '8px', '48px', '13px', '24px', '44px'], 'the tokens the arithmetic below reads');
      eq(px('--tap-min') / 2 + px('--space-1') / 2, px('--radius-7xl'), 'corner = half a segment\'s height + the track\'s padding: the lit corner segment sits concentric in it');
      ok(/padding:\s*0 var\(--space-1\);/.test(seg), 'a segment keeps --space-1 each side');
      const GUTTER = 16;        // #tab-discover's side padding on a phone (the row measures 343px in a 375px window)
      const ADVANCE = 0.62;     // em per character — SF Mono / Menlo are 0.60; a little to spare
      [320, 375, 390, 430].forEach((vw) => {
        const row = vw - 2 * GUTTER - px('--space-1');                      // .date-presets' own side padding (2 × --space-1 / 2)
        const inner = row - px('--space-12') - px('--space-3') - px('--space-1'); // − calendar button − gap − the track's padding
        const col = inner / 6;
        const need = (text) => text.length * px('--type-caption') * ADVANCE + 2 * px('--space-1');
        const tight = labels.map((text, i) => [text, (i + 1 >= 4 ? 3 : 2) * col - need(text)]).filter((x) => x[1] < 0);
        eq(tight, [], vw + 'px: every label fits its cell (narrowest: a ' + (2 * col).toFixed(1) + 'px cell for "Tomorrow", which needs ' + need('Tomorrow').toFixed(1) + 'px)');
      });
      // …and one mono row really cannot fit a phone, even at the track's tightest padding — which is why.
      const oneRow = labels.reduce((a, text) => a + text.length * px('--type-caption') * 0.6 + px('--space-1'), 0);
      const room375 = 375 - 2 * GUTTER - px('--space-1') - px('--space-12') - px('--space-3') - px('--space-1');
      ok(oneRow > room375, 'one row of the five mono labels needs ' + oneRow.toFixed(0) + 'px at the tightest padding; a 375px phone\'s track has ' + room375 + 'px');
      // Every other theme keeps the one-row flex track.
      const grids = rules.filter((r) => /\.date-track(?![\w-])/.test(r.sel) && /display:\s*grid/.test(r.body));
      eq(grids.map((r) => [r.sel, r.media]), [[MONO + ' .date-track', PHONE]], 'ONLY the two mono themes, and only on a phone, re-lay the track');
      ok(/display:\s*flex;/.test(one('.date-track', '')) && /flex:\s*1 0 auto;/.test(one('.date-track', '')), 'the track every other theme wears is unchanged: one flex row');
      ok(/padding:\s*0 var\(--space-3\);/.test(one(MONO + ' .date-track .date-quick-btn', '@media (min-width: 641px)')), 'wider than a phone the mono row fits, with its roomier segments');
      eq(rules.filter((r) => r.sel.indexOf(MONO + ' .date-track') === 0 && r.media === '').length, 0, 'no mono date-track rule applies at every width');
      ok(rules.some((r) => r.sel === '.date-track .date-quick-btn' && r.media === '' && /height:\s*var\(--tap-min\);/.test(r.body)) &&
        !/(^|[;\s])(min-)?height\s*:/.test(seg), 'each range is still a fingertip tall (the mono rule sets no height of its own)');
    }

    // ── 9. The favourite star ──────────────────────────────────────────────
    t.section('10b themes: the favourite star is a token — --fav, per theme, >= 3:1 as a graphic');
    {
      const lum = (hex) => {
        const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      const tokens = (id) => {
        const at = themeCss.indexOf('\n[data-theme="' + id + '"] {');
        const out = {};
        noComments(themeCss.slice(themeCss.indexOf('{', at) + 1, themeCss.indexOf('\n}', at))).replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
        return out;
      };
      const rootFav = (/\n  --fav:\s*(#[0-9a-f]{6});/.exec(themeCss.slice(0, themeCss.indexOf('\n[data-theme="cloud"] {'))) || [])[1];
      ok(/^#[0-9a-f]{6}$/.test(rootFav || ''), ':root carries a fallback --fav (' + rootFav + ') for the legacy dark set');
      ids.forEach((id) => {
        const tk = tokens(id);
        ok(/^#[0-9a-f]{6}$/i.test(tk['--fav'] || ''), id + ': --fav is set in the theme\'s own block (' + tk['--fav'] + ')');
        ['--bg', '--bg-panel', '--bg-input', '--bg-deep'].forEach((ground) => {
          const r = contrast(tk['--fav'], tk[ground]);
          ok(r >= 3, id + ': --fav ' + tk['--fav'] + ' on ' + ground + ' ' + tk[ground] + ' is ' + r.toFixed(2) + ':1 (>= 3 — a graphic)');
        });
      });
      const cloud = tokens('cloud');
      ok(contrast('#f5c518', cloud['--bg-panel']) < 2, 'the old fixed gold was ' + contrast('#f5c518', cloud['--bg-panel']).toFixed(2) + ':1 on Cloud\'s surface — why it became a token');
      const gb = tokens('gameboy');
      ok([gb['--text'], gb['--text-heading'], gb['--text-muted'], gb['--accent']].indexOf(gb['--fav']) !== -1, 'Handheld\'s star is one of its own four shades');
      // Everywhere a favourite star is drawn.
      const settingsCss = noComments(t.readSource('css/settings.css')), stylesCss = noComments(t.readSource('css/styles.css'));
      ok(/\.tier-fav\.is-fav::before \{ color: var\(--fav, #[0-9a-f]{6}\); \}/.test(settingsCss), 'Membership rows + the instructor profile (.tier-fav.is-fav) read --fav');
      ok(/\.fav-star:hover, \.fav-star\.fav-on \{ color: var\(--fav, #[0-9a-f]{6}\); \}/.test(stylesCss), 'the instructor dropdown\'s star (.fav-star.fav-on) reads --fav');
      const starRules = [];
      CSS_FILES.forEach((f) => noComments(t.readSource('css/' + f)).replace(/([^{}]*)\{([^{}]*)\}/g, (m, sel, body) => {
        if (/\.tier-fav\.is-fav|\.fav-star\.fav-on|\.fav-star:hover/.test(sel) && /(^|[;\s])color\s*:/.test(body)) starRules.push([f, sel.trim().replace(/\s+/g, ' '), (/(^|[;\s])color\s*:\s*([^;]+)/.exec(body) || [])[2].trim()]);
        return m;
      }));
      eq(starRules.filter((r) => r[2].indexOf('var(--fav') !== 0), [], 'no rule colours a lit star with anything but --fav (' + starRules.length + ' rules)');
      ok(/class="tier-fav' \+ \(isFav \? ' is-fav' : ''\)/.test(settingsJs) && /class="tier-fav\$\{isFav \? ' is-fav' : ''\}"/.test(t.readSource('js/features.js')) && /class="fav-star\$\{fav \? ' fav-on' : ''\}"/.test(t.readSource('js/app.js')),
        'the three places that print a star still print those classes');
    }
  }
};
