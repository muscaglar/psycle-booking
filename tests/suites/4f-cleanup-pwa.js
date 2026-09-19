'use strict';
// Clean-up + PWA shell guards:
//   • dead code that was deleted stays deleted (and the hooks that replaced the
//     never-attaching action-log wrappers are where they have to be),
//   • sw.js: a same-origin navigation is not held hostage by a stalled network
//     (the REAL fetch handler, driven in a vm with a fake Cache Storage),
//   • the first-paint theme script (psycle-finder.html + login.html) follows
//     theme.js's rule and its colour map matches APP_THEMES,
//   • login.html's inlined design tokens equal css/theme.css, theme by theme,
//   • manifest / icon links point at PNGs that exist, at the stated size,
//   • calendar.js: the native .ics export shares a real file, truthfully.

module.exports = async function (t) {
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const swSrc = t.readSource('sw.js');
  const calJs = t.readSource('js/calendar.js');
  const perfJs = t.readSource('js/performance.js');
  const relJs = t.readSource('js/reliability.js');
  const tabsJs = t.readSource('js/tabs.js');
  const settingsJs = t.readSource('js/settings.js');
  const appJs = t.readSource('js/app.js');
  const themeJs = t.readSource('js/theme.js');
  const themeCss = t.readSource('css/theme.css');
  const finder = t.readSource('psycle-finder.html');
  const login = t.readSource('login.html');

  // ── Dead code ───────────────────────────────────────────────────────────
  t.section('Clean-up: deleted dead code stays deleted');
  t.ok(!/_virtualMode|initVirtualScroll|_makePlaceholder|_hydrateCard|class-card-placeholder/.test(perfJs),
    'performance.js: the switched-off virtual-scroll block is gone');
  t.ok(!/window\.eventCard\s*=|window\.render\s*=/.test(perfJs), 'performance.js no longer wraps eventCard() / render() for nothing');
  t.ok(/function debounce\(/.test(perfJs) && /const CACHE_PREFIX = 'psycle_cache_';/.test(perfJs) && /const TTL_24H =/.test(perfJs),
    '…while debounce and the static-list cache (CACHE_PREFIX / TTL_24H) stay');
  t.ok(!/_swGenerateICS|_swGetCalendarData|_swIcs|_swSlot|psycle-calendar\.ics|GET_CALENDAR_DATA/.test(swSrc),
    'sw.js: the drifted duplicate ICS generator and its /psycle-calendar.ics route are gone');
  t.ok(!/getCalendarSubscriptionURL|GET_CALENDAR_DATA|psycle-calendar\.ics/.test(calJs),
    'calendar.js: the caller-less webcal URL helper and the SW message listener are gone');
  t.ok(!/navigator\.serviceWorker/.test(calJs), 'calendar.js no longer touches navigator.serviceWorker at load (the iOS register-only stub cannot trip it)');
  t.ok(/function generateICS\(/.test(calJs) && /function downloadICS\(/.test(calJs) && /function openICSInCalendar\(/.test(calJs) &&
    /function addToGoogleCalendar\(/.test(calJs) && /function renderCalendarActions\(/.test(calJs), '…and every live calendar entry point is still there');
  t.ok(!/function onDiscoverSearch\(/.test(appJs), 'app.js: the caller-less onDiscoverSearch is gone');
  t.ok(/window\.shareClass = function\s*\(/.test(appJs) && /;shareClass\(\$\{/.test(appJs), '…shareClass (wired back in, and called from a booking card) is NOT');
  const lightBlocks = themeCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|\})\s*\[data-theme="light"\]\s*\{/g) || [];
  t.eq(lightBlocks.length, 0, 'theme.css: no standalone [data-theme="light"] token block (no such theme id)');
  t.ok(/:is\(\[data-theme="light"\], \[data-theme="cloud"\], \[data-theme="linen"\]\) \.book-btn\.booked/.test(themeCss),
    '…the shared :is(light, cloud, linen) component rules are untouched');

  t.section('Clean-up: the action log records what the dead wrappers claimed to');
  t.ok(!/_origSwitchTabForLog|_origExportSettings|_origImportSettings/.test(relJs),
    'reliability.js: the switchTab / export / import wrappers (installed before those functions existed) are gone');
  t.ok(/var _origToggleTheme = window\.toggleTheme;/.test(relJs) && /pushAction\('settings:theme_toggle'\)/.test(relJs),
    '…the toggleTheme wrapper (theme.js loads first, so it attaches) stays');
  {
    // Attaching is not enough: the header button has to GO THROUGH it. It was
    // bound to the original function object at theme.js load, so every tap on
    // the sun/moon flipped the theme and logged nothing. The real
    // injectThemeToggle, then a wrapper installed the way reliability.js does.
    const from = themeJs.indexOf('function injectThemeToggle() {');
    const to = themeJs.indexOf('\n}\n', from);
    t.ok(from !== -1 && to > from, 'injectThemeToggle can be sliced');
    const log = [];
    let btn = null;
    const ctx = t.vm.createContext({
      document: {
        querySelector: () => ({ appendChild: (el) => { btn = el; } }),
        getElementById: () => null,
        createElement: () => ({ setAttribute() {} }),
      },
    });
    ctx.window = ctx;
    t.vm.runInContext('function toggleTheme() { __flip(); }\n' + themeJs.slice(from, to + 2), ctx);
    ctx.__flip = () => log.push('flip');
    ctx.injectThemeToggle();
    t.vm.runInContext("var _orig = window.toggleTheme; window.toggleTheme = function () { __log(); return _orig.apply(this, arguments); };", ctx);
    ctx.__log = () => log.push('settings:theme_toggle');
    btn.onclick();
    t.eq(log, ['settings:theme_toggle', 'flip'], 'a tap on #themeToggleBtn runs whatever window.toggleTheme is AT TAP TIME — the logging wrapper, then the flip');
  }
  t.ok(/window\.pushAction = pushAction;/.test(relJs), 'pushAction is still exported for later modules');
  const stStart = tabsJs.indexOf('window.switchTab = function (tab, noHash) {');
  const stEnd = tabsJs.indexOf('// Deep links and back/forward', stStart);
  t.ok(stStart !== -1 && stEnd > stStart, 'switchTab can be sliced');
  t.ok(/if \(typeof window\.pushAction === 'function'\) window\.pushAction\('tab:switch to=' \+ tab\);/.test(tabsJs.slice(stStart, stEnd)),
    'tabs.js switchTab logs the tab switch itself (guarded: reliability.js may not have loaded)');
  const exStart = settingsJs.indexOf('window.exportSettings = function () {');
  const imStart = settingsJs.indexOf('window.importSettings = function (input) {');
  t.ok(exStart !== -1 && imStart > exStart, 'exportSettings / importSettings found');
  t.ok(/window\.pushAction\('settings:export'\)/.test(settingsJs.slice(exStart, imStart)), 'settings.js logs settings:export');
  const imBody = settingsJs.slice(imStart, settingsJs.indexOf('// Bug Report', imStart));
  t.ok(/if \(!file\) return;[\s\S]*?window\.pushAction\('settings:import'\)[\s\S]*?new FileReader\(\)/.test(imBody),
    'settings.js logs settings:import once a file was actually picked');

  // ── Service worker navigations ──────────────────────────────────────────
  t.section('Service worker: a stalled network cannot hold a cached page hostage');
  {
    const afterShell = swSrc.slice(swSrc.indexOf('];') + 2);
    // ios-app/build.js strips these substrings from the whole file for www/.
    t.ok(!/js\/|css\/|fonts\//.test(afterShell), 'nothing below the generated SHELL list would be rewritten by build.js\'s path flattening');
    t.ok(/^const CACHE = 'psycle-[0-9a-f]{8}';\nconst SHELL = \[\n/.test(swSrc), 'the generated CACHE / SHELL header is intact');

    const ORIGIN = 'https://app.test';
    const FINDER = ORIGIN + '/psync/psycle-finder.html';
    function swWorld(cachedUrls) {
      const w = { listeners: {}, timers: [], puts: [], fetches: [], net: [] };
      const page = (u) => ({ cachedPage: u });
      // Cache Storage: keyed by URL; ignoreSearch drops the query string.
      const keyOf = (req) => new URL(typeof req === 'string' ? req : req.url, ORIGIN + '/psync/').href;
      const match = (req, opts) => {
        let key = keyOf(req);
        if (opts && opts.ignoreSearch) key = key.split('?')[0];
        const hit = cachedUrls.filter((u) => (opts && opts.ignoreSearch ? u.split('?')[0] : u) === key)[0];
        return Promise.resolve(hit ? page(hit) : undefined);
      };
      const ctx = t.vm.createContext({
        self: { addEventListener: (type, fn) => { w.listeners[type] = fn; }, location: { origin: ORIGIN }, skipWaiting() {}, clients: { claim() {} } },
        caches: { match, open: () => Promise.resolve({ put: (req, res) => { w.puts.push([keyOf(req), res]); return Promise.resolve(); } }), keys: () => Promise.resolve([]) },
        fetch: (req) => { w.fetches.push(req.url); return new Promise((resolve, reject) => { w.net.push({ resolve, reject }); }); },
        setTimeout: (fn, ms) => { w.timers.push({ fn, ms }); return w.timers.length; },
        URL, Promise, Request: function () {}, Response: { error: () => ({ networkError: true }) },
      });
      t.vm.runInContext(swSrc, ctx, { filename: 'sw.js' });
      w.request = (url, mode, destination) => {
        const ev = { request: { url, mode: mode || 'navigate', destination: destination || 'document' }, responded: null, waits: [] };
        ev.respondWith = (p) => { ev.responded = Promise.resolve(p); };
        ev.waitUntil = (p) => { ev.waits.push(Promise.resolve(p)); };
        w.listeners.fetch(ev);
        return ev;
      };
      w.ok = (tag) => ({ ok: true, tag, clone() { return { copyOf: tag }; } });
      return w;
    }
    const settled = async (p) => { let out = { state: 'pending' }; p.then((v) => { out = { state: 'ok', v }; }, (e) => { out = { state: 'err', e }; }); await flush(); return out; };

    // Fast network: still network-first, and the cache is refreshed.
    let w = swWorld([FINDER]);
    let ev = w.request(FINDER);
    await flush();
    t.eq(w.timers.map((x) => x.ms), [3000], 'a cached page arms ONE 3s timer');
    w.net[0].resolve(w.ok('fresh'));
    let r = await settled(ev.responded);
    t.eq([r.state, r.v && r.v.tag], ['ok', 'fresh'], 'the network answers in time → the fresh page is shown (network-first kept)');
    t.eq(w.puts.map((p) => [p[0], p[1].copyOf]), [[FINDER, 'fresh']], '…and a copy goes into the cache');
    t.ok(ev.waits.length === 1 && (await settled(ev.waits[0])).state === 'ok', 'waitUntil covers the request and the cache write');

    // Stalled network: the cached page after 3s, the refresh still lands.
    w = swWorld([FINDER]);
    ev = w.request(FINDER);
    await flush();
    t.eq((await settled(ev.responded)).state, 'pending', 'network stalled: nothing is shown before the timer…');
    w.timers[0].fn();
    r = await settled(ev.responded);
    t.eq([r.state, r.v && r.v.cachedPage], ['ok', FINDER], '…then the cached copy of THAT page is (no white screen until the browser gives up)');
    t.eq((await settled(ev.waits[0])).state, 'pending', 'the request carries on behind it');
    w.net[0].resolve(w.ok('late'));
    await flush();
    t.eq([w.puts.map((p) => p[1].copyOf), (await settled(ev.waits[0])).state], [['late'], 'ok'], 'a late answer still refreshes the cache for next time');

    // Stalled, then failed: nothing blows up after the race is over.
    w = swWorld([FINDER]);
    ev = w.request(FINDER);
    await flush();
    w.timers[0].fn();
    await flush();
    w.net[0].reject(new TypeError('Failed to fetch'));
    t.eq([(await settled(ev.responded)).state, (await settled(ev.waits[0])).state], ['ok', 'ok'], 'a late network failure is swallowed (no unhandled rejection, waitUntil settles)');

    // Offline: the cached page at once, not after 3s.
    w = swWorld([FINDER]);
    ev = w.request(FINDER);
    await flush();
    w.net[0].reject(new TypeError('Failed to fetch'));
    r = await settled(ev.responded);
    t.eq([r.state, r.v && r.v.cachedPage], ['ok', FINDER], 'fetch rejects (offline): the cached page immediately');

    // A server error page is still the network's answer (as before).
    w = swWorld([FINDER]);
    ev = w.request(FINDER);
    await flush();
    w.net[0].resolve({ ok: false, status: 503, tag: 'down', clone() { throw new Error('must not be cached'); } });
    r = await settled(ev.responded);
    t.eq([r.v && r.v.tag, w.puts.length], ['down', 0], 'a non-OK answer is passed through and never cached');

    // Query strings open the same cached page.
    w = swWorld([FINDER]);
    ev = w.request(FINDER + '?theme=graphite');
    await flush();
    w.timers[0].fn();
    r = await settled(ev.responded);
    t.eq(r.v && r.v.cachedPage, FINDER, '?theme=… matches the cached page (ignoreSearch)');

    // A page that is NOT cached keeps the plain path: no timer, network or bust.
    w = swWorld([FINDER]);
    ev = w.request(ORIGIN + '/psync/tests/smoke.html');
    await flush();
    t.eq([w.timers.length, (await settled(ev.responded)).state], [0, 'pending'], 'an uncached page never gets the app shell after 3s — it waits for the network');
    w.net[0].reject(new TypeError('Failed to fetch'));
    r = await settled(ev.responded);
    t.eq(r.v && r.v.cachedPage, FINDER, '…and only a real failure falls back to the app page (as before)');
    w = swWorld([]);
    ev = w.request(FINDER);
    await flush();
    w.net[0].reject(new TypeError('Failed to fetch'));
    r = await settled(ev.responded);
    t.ok(r.state === 'ok' && r.v && r.v.networkError === true, 'nothing cached at all + offline: a network error, not a crash');

    // Not a same-origin navigation: today's path, untouched.
    w = swWorld([FINDER]);
    ev = w.request('https://elsewhere.test/page.html', 'no-cors', '');
    await flush();
    t.eq([w.timers.length, ev.waits.length, w.fetches.length], [0, 0, 1], 'a cross-origin *.html request is not raced');
    w = swWorld([FINDER]);
    ev = w.request(FINDER, 'cors', '');
    await flush();
    t.eq(w.timers.length, 0, 'a same-origin fetch() of a page (not a navigation) is not raced either');

    w = swWorld([FINDER]);
    ev = w.request('https://psycle.codexfit.com/api/v1/customer/bookings', 'cors', '');
    t.eq([ev.responded, w.fetches.length], [null, 0], 'API calls are still left to the network untouched');
    w = swWorld([FINDER]);
    ev = w.request(ORIGIN + '/psync/psycle-calendar.ics', 'navigate', 'document');
    await flush();
    t.eq(w.timers.length, 0, '/psycle-calendar.ics is an ordinary (uncached) URL now');
  }

  // ── First-paint theme ───────────────────────────────────────────────────
  t.section('First paint: the saved (or system) theme before any stylesheet or script file');
  {
    const boot = (html) => (/<script id="themeBoot">([\s\S]*?)<\/script>/.exec(html) || [])[1] || '';
    const code = (src) => src.replace(/^\s*\/\/.*$/gm, '').trim();
    const finderBoot = boot(finder), loginBoot = boot(login);
    t.ok(!!finderBoot && !!loginBoot, 'both pages carry the themeBoot script');
    t.eq(code(loginBoot), code(finderBoot), 'login.html and psycle-finder.html run the same code');
    const head = finder.slice(0, finder.indexOf('</head>'));
    t.ok(head.indexOf('<meta name="theme-color"') !== -1 && head.indexOf('<meta name="theme-color"') < head.indexOf('<script id="themeBoot">'),
      'psycle-finder.html: the theme-color meta sits ABOVE the script that updates it');
    t.ok(login.indexOf('<meta name="theme-color"') < login.indexOf('<script id="themeBoot">') && login.indexOf('<script id="themeBoot">') < login.indexOf('<style>'),
      'login.html: meta, then script, then styles');
    t.eq((head.match(/<meta name="theme-color"/g) || []).length, 1, 'exactly one theme-color meta (theme.js updates the first it finds)');
    t.ok(head.indexOf('<script id="themeBoot">') < head.indexOf('<link rel="stylesheet"'), 'it runs before the stylesheets are even requested');
    t.ok(!/js\/|css\/|fonts\//.test(finderBoot), 'nothing in it would be rewritten by build.js\'s path flattening');
    t.ok(/<html lang="en" data-theme="cloud">/.test(finder) && /<html lang="en" data-theme="cloud">/.test(login), 'both pages still start as Cloud if the script cannot run');
    // tests/suites/offline.js runs login.html's FIRST bare <script> as the login logic.
    t.ok(/function doLogin\(/.test((/<script>([\s\S]*?)<\/script>/.exec(login) || [])[1] || ''), 'login.html: the first attribute-less <script> is still the login logic');

    const themes = [];
    themeJs.replace(/\{\s*id:\s*'([a-z]+)'[^}]*?bg:\s*'(#[0-9a-f]{6})'/g, (m, id, bg) => { themes.push([id, bg]); return m; });
    t.ok(themes.length >= 7, 'APP_THEMES parsed (' + themes.map((x) => x[0]).join(', ') + ')');
    const map = [];
    ((/var BG = \{([^}]*)\}/.exec(finderBoot) || [])[1] || '').replace(/([a-z]+):\s*'(#[0-9a-f]{6})'/g, (m, id, bg) => { map.push([id, bg]); return m; });
    t.eq(map, themes, 'its id → background map is APP_THEMES, entry for entry');

    // Cloud's and Graphite's grounds come from the registry (wave 9 re-valued
    // both); what is pinned here is the RULE, and that the pages' <meta> starts
    // as Cloud's.
    const bgOf = (id) => (themes.filter((x) => x[0] === id)[0] || [])[1];
    const CLOUD_BG = bgOf('cloud'), GRAPHITE_BG = bgOf('graphite');
    t.ok(/^#[0-9a-f]{6}$/.test(CLOUD_BG || '') && /^#[0-9a-f]{6}$/.test(GRAPHITE_BG || '') && CLOUD_BG !== GRAPHITE_BG, 'Cloud and Graphite are in the registry with their own grounds');
    [['psycle-finder.html', finder], ['login.html', login]].forEach((pg) => {
      t.eq((/<meta name="theme-color" content="(#[0-9a-f]{6})">/.exec(pg[1]) || [])[1], CLOUD_BG, pg[0] + ': the theme-color meta starts as Cloud\'s ground (what <html data-theme="cloud"> paints if the script cannot run)');
    });
    const run = (saved, systemDark, o) => {
      o = o || {};
      const out = { attr: null, meta: CLOUD_BG };
      const ctx = t.vm.createContext({
        localStorage: o.noStorage ? { getItem() { throw new Error('denied'); } } : { getItem: (k) => (k === 'psycle_theme' ? saved : null) },
        window: o.noMatchMedia ? {} : { matchMedia: (q) => ({ matches: /dark/.test(q) ? !!systemDark : !systemDark }) },
        document: {
          documentElement: { setAttribute: (k, v) => { if (k === 'data-theme') out.attr = v; } },
          querySelector: (sel) => (o.noMeta || sel !== 'meta[name="theme-color"]' ? null : { setAttribute: (k, v) => { if (k === 'content') out.meta = v; } }),
        },
        Object,
      });
      t.vm.runInContext(finderBoot, ctx, { filename: 'psycle-finder.html[themeBoot]' });
      return [out.attr, out.meta];
    };
    themes.forEach((th) => {
      t.eq(run(th[0], th[0] === 'cloud'), [th[0], th[1]], 'saved "' + th[0] + '" wins over the system scheme, with its own status-area colour');
    });
    t.eq(run(null, true), ['graphite', GRAPHITE_BG], 'nothing saved + dark system → Graphite');
    t.eq(run(null, false), ['cloud', CLOUD_BG], 'nothing saved + light system → Cloud');
    t.eq([run('dark', false), run('light', true)], [['cloud', CLOUD_BG], ['graphite', GRAPHITE_BG]], 'a legacy "dark" / "light" value follows the system, exactly like theme.js');
    t.eq([run('constructor', true)[0], run('__proto__', false)[0], run('', true)[0]], ['graphite', 'cloud', 'graphite'], 'only an OWN key of the map counts as a saved theme');
    t.eq(run('synthwave', true, { noStorage: true }), ['graphite', GRAPHITE_BG], 'localStorage denied → the system scheme, no throw');
    t.eq(run(null, true, { noMatchMedia: true }), ['cloud', CLOUD_BG], 'no matchMedia → Cloud');
    t.eq(run('linen', false, { noMeta: true })[0], 'linen', 'no theme-color meta → the attribute is still set');
    // …and theme.js agrees on the rule it mirrors.
    t.ok(/if \(_themeById\(saved\)\) return saved;/.test(themeJs) && /\(prefers-color-scheme: dark\)'\)\.matches\) return 'graphite';/.test(themeJs) && /const DEFAULT_THEME = 'cloud';/.test(themeJs),
      'theme.js _resolveTheme still reads: saved registry id → else dark system → graphite → else cloud');
  }

  // ── login.html tokens ───────────────────────────────────────────────────
  t.section('login.html wears the app\'s theme (inlined tokens = css/theme.css)');
  {
    const style = (/<style>([\s\S]*?)<\/style>/.exec(login) || [])[1] || '';
    const decls = (css, selector) => {
      const start = css.indexOf(selector + ' {');
      if (start === -1) return null;
      const out = {};
      css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
      return out;
    };
    const root = decls(themeCss, ':root');
    const loginRoot = decls(style, ':root') || {};
    const ids = [];
    themeJs.replace(/\{\s*id:\s*'([a-z]+)'/g, (m, id) => { ids.push(id); return m; });
    const COLOURS = ['--bg', '--bg-panel', '--bg-input', '--border', '--border-light', '--text', '--text-heading', '--text-muted', '--text-dim',
      '--text-ghost', '--text-off', '--accent', '--accent-hover', '--accent-ink', '--accent-soft', '--badge-full-bg', '--badge-full-text', '--badge-full-border', '--shadow-lg'];
    Object.keys(loginRoot).forEach((k) => t.eq(loginRoot[k], root[k], 'login :root ' + k + ' = theme.css :root'));
    ids.forEach((id) => {
      const mine = decls(style, '[data-theme="' + id + '"]');
      t.ok(!!mine, 'login.html has a [data-theme="' + id + '"] block');
      if (!mine) return;
      const app = Object.assign({}, root, decls(themeCss, '[data-theme="' + id + '"]'));
      t.eq(COLOURS.filter((k) => !(k in mine)), [], id + ': every colour the page paints with is stated (no hole another theme could leak through)');
      const wrong = Object.keys(mine).filter((k) => mine[k] !== app[k]).map((k) => k + ' ' + mine[k] + ' ≠ ' + app[k]);
      t.eq(wrong, [], id + ': every inlined token equals css/theme.css');
      // Tokens the page uses from :root must be overridden wherever the app overrides them.
      const missed = Object.keys(loginRoot).filter((k) => app[k] !== root[k] && mine[k] !== app[k]);
      t.eq(missed, [], id + ': radius / font overrides of the app theme are carried too');
    });
    // Outside the token blocks the page paints with tokens only.
    const rest = style.replace(/@font-face\s*\{[^}]*\}/g, '').replace(/(:root|\[data-theme="[a-z]+"\])\s*\{[^}]*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    t.eq(rest.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) || [], [], 'no fixed colours left in the page\'s rules');
    const used = [];
    rest.replace(/var\((--[a-z0-9-]+)/g, (m, k) => { if (used.indexOf(k) === -1) used.push(k); return m; });
    t.eq(used.filter((k) => COLOURS.indexOf(k) === -1 && !(k in loginRoot)), [], 'every var() the rules read is one of the inlined tokens');
    t.ok(/\.btn \{[^}]*background: var\(--accent\); color: var\(--accent-ink\)/.test(rest), 'the accent button is labelled with --accent-ink (white is unreadable on the pale accents)');
    t.ok(/\.error \{[^}]*color: var\(--badge-full-text\)/.test(rest) && /\.error \{[^}]*background: var\(--badge-full-bg\)/.test(rest), 'the error box uses the "full" chip\'s AA-checked pair');
    t.ok(!/<link rel="stylesheet"/.test(login), 'still self-contained: no stylesheet link (it is copied as-is into the flat iOS www/)');
  }

  // ── Icons / manifest ────────────────────────────────────────────────────
  t.section('PWA icons: real PNGs, linked and listed');
  {
    const manifest = JSON.parse(t.readSource('manifest.json'));
    // "WxH" from the PNG header; null when the file is missing or not a PNG.
    const pngSize = (rel) => {
      let buf;
      try { buf = t.fs.readFileSync(t.path.join(t.REPO_ROOT, rel)); } catch (e) { return null; }
      if (buf.toString('latin1', 1, 4) !== 'PNG') return null;
      return buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20);
    };
    t.ok(manifest.icons.length >= 3 && manifest.icons.every((i) => !/^data:/.test(i.src) && i.type === 'image/png'), 'manifest icons are PNG files (no data: URI)');
    manifest.icons.forEach((i) => t.eq(pngSize(i.src), i.sizes, 'manifest ' + i.src + ' (' + i.purpose + ') really is ' + i.sizes));
    const purposes = manifest.icons.map((i) => i.sizes + ' ' + i.purpose).sort();
    t.ok(purposes.indexOf('192x192 any') !== -1 && purposes.indexOf('512x512 any') !== -1 && purposes.indexOf('512x512 maskable') !== -1,
      'any 192 + any 512 + a SEPARATE maskable 512 (' + purposes.join(', ') + ')');
    [['psycle-finder.html', finder], ['login.html', login]].forEach((pg) => {
      const icon = (/<link rel="icon"[^>]*href="([^"]+)"/.exec(pg[1]) || [])[1];
      const touch = (/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(pg[1]) || [])[1];
      t.eq([icon && pngSize(icon), touch && pngSize(touch)], ['192x192', '180x180'], pg[0] + ' links a 192px favicon and a 180px touch icon that exist');
    });
    // Any icons/… path a module names (features.js's notification icon pointed
    // at a folder that did not exist) has to be a real file.
    const named = [];
    t.fs.readdirSync(t.JS_DIR).filter((f) => f.endsWith('.js')).forEach((f) => {
      t.readSource('js/' + f).replace(/['"](icons\/[\w.-]+\.png)['"]/g, (m, rel) => { if (named.indexOf(rel) === -1) named.push(rel); return m; });
    });
    t.eq(named.filter((rel) => !pngSize(rel)), [], 'every icons/*.png a script names exists (' + (named.join(', ') || 'none named') + ')');
    t.ok(!/icons\//.test(swSrc), 'icons stay web-only: not hand-added to the generated SHELL (the iOS build has no icons/ folder)');
    const cloudBg = (/\{\s*id:\s*'cloud'[^}]*?bg:\s*'(#[0-9a-f]{6})'/.exec(themeJs) || [])[1];
    t.eq([manifest.background_color, manifest.theme_color], [cloudBg, cloudBg], 'the install / launch colours are the default theme\'s background');
    // The iOS WebView's pre-paint background is NOT a fixed colour: any one
    // value flashes for half the members (a dark one for Cloud, the default
    // theme's off-white behind Graphite on a Dark Mode phone). With the key
    // absent Capacitor paints UIColor.systemBackground, which follows Dark Mode
    // exactly as the launch screen (systemBackgroundColor) does.
    const capConfig = JSON.parse(t.readSource('ios-app/capacitor.config.json'));
    t.eq(['backgroundColor' in capConfig.ios, 'backgroundColor' in capConfig], [false, false], 'capacitor.config.json sets no fixed WebView background (→ systemBackground, light AND dark)');
    t.ok(/systemColor="systemBackgroundColor"/.test(t.readSource('ios-app/ios/App/App/Base.lproj/LaunchScreen.storyboard')), '…matching the launch screen, which is the system background too');
  }

  // ── .ics export in the iOS app ──────────────────────────────────────────
  t.section('Calendar file export in the iOS app (js/calendar.js)');
  {
    function FakeFile(parts, name, o) { this.parts = parts; this.name = name; this.type = o && o.type; }
    // share: 'ok' | 'abort' | 'refuse' | 'throw' | undefined (no Web Share);  text: true | false | 'none'
    const run = async (share, text, canShare) => {
      const log = { toasts: [], shared: null, sharedSync: false, textShared: null };
      const navigator = {};
      if (share) {
        navigator.canShare = () => canShare !== false;
        navigator.share = (data) => {
          log.shared = data;
          if (share === 'throw') throw new Error('sync failure');
          if (share === 'ok') return Promise.resolve();
          const err = new Error(share);
          err.name = share === 'abort' ? 'AbortError' : 'NotAllowedError';
          return Promise.reject(err);
        };
      }
      const window = {};
      if (text !== 'none') window.nativeShare = (title, body, url) => { log.textShared = { title, body, url }; return Promise.resolve(text); };
      const p = t.loadPure('js/calendar.js', 'ics-share', { navigator, window, File: FakeFile, Promise, toast: (m, k) => log.toasts.push([m, k]) });
      p._shareICS('BEGIN:VCALENDAR', 'psycle-classes.ics');
      log.sharedSync = log.shared !== null; // reached navigator.share before returning = still inside the tap
      await flush();
      return log;
    };

    let r = await run('ok', true);
    t.ok(r.sharedSync, 'navigator.share is called synchronously from the click (user gesture intact)');
    t.ok(r.shared.files.length === 1 && r.shared.files[0].name === 'psycle-classes.ics' && r.shared.files[0].type === 'text/calendar', 'it shares a real .ics File');
    t.eq(r.toasts, [['Calendar file shared', 'success']], 'success is toasted only once the share resolved');
    t.eq(r.textShared, null, '…with no second share sheet');
    r = await run('abort', true);
    t.eq([r.toasts, r.textShared], [[['Export cancelled', 'info']], null], 'dismissing the sheet says cancelled — never "downloaded" — and does not reopen it');
    r = await run('refuse', true);
    t.ok(r.textShared && r.textShared.body === 'BEGIN:VCALENDAR' && r.textShared.url === null, 'a refused file share falls back to the Capacitor Share plugin');
    t.eq(r.toasts, [['Calendar shared', 'success']], '…and toasts by what the fallback reports');
    r = await run('refuse', false);
    t.eq(r.toasts, [['Export cancelled', 'info']], 'fallback dismissed → cancelled');
    r = await run('throw', true);
    t.ok(r.textShared !== null, 'a share() that throws synchronously also falls back');
    r = await run('ok', true, false);
    t.ok(r.shared === null && r.textShared !== null, 'canShare({files}) false → straight to the text route');
    r = await run(undefined, 'none');
    t.eq(r.toasts.length === 1 && r.toasts[0][1], 'error', 'no way to share at all → an error toast, not a false success');

    const dl = calJs.slice(calJs.indexOf('function downloadICS() {'), calJs.indexOf('// ── pure:ics-share:start'));
    t.ok(/isNativePlatform\(\)\) \{\s*_shareICS\(ics, 'psycle-classes\.ics'\);\s*return;\s*\}\s*const blob = /.test(dl),
      'downloadICS takes the share route — and skips the dead blob click and its "downloaded" toast — on the native platform');
    t.ok(!/await /.test(dl), '…with nothing awaited between the tap and the share');
  }
};
