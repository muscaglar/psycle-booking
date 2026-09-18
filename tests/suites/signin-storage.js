'use strict';
// Storage around the sign-in path:
//   • a FULL localStorage must never cost a sign-in (js/security.js token
//     write, login.html's token write) — the app's own rebuildable caches are
//     freed first, and a storage failure is never reported as "Network error";
//   • an older stored token must not outlive a save that failed;
//   • a JWT that has expired by THIS DEVICE'S CLOCK asks Psycle (checkAuth)
//     instead of ending the session — ending it deleted the token and with it
//     the offline saved copy of My Bookings;
//   • favourites vs the iOS Preferences restore, and the one-change write;
//   • login.html hardening (CSP meta, framebust, referrer policy).
module.exports = async function (t) {
  const { ok, eq } = t;
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

  // A Storage with a quota, counted in characters like the real one.
  function quotaStorage(limit) {
    const map = new Map();
    const used = () => { let n = 0; map.forEach((v, k) => { n += k.length + v.length; }); return n; };
    return {
      limit,
      getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
      setItem(k, v) {
        k = String(k); v = String(v);
        const next = used() - (map.has(k) ? k.length + map.get(k).length : 0) + k.length + v.length;
        if (next > this.limit) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; }
        map.set(k, v);
      },
      removeItem: (k) => { map.delete(String(k)); },
      key: (i) => Array.from(map.keys())[i] || null,
      get length() { return map.size; },
      keys: () => Array.from(map.keys()),
    };
  }

  function securityWorld(store, extra) {
    const w = { timers: [], toasts: [], checks: 0, expired: 0, listeners: {} };
    const sb = {};
    sb.window = sb; sb.self = sb; sb.top = sb;
    sb.document = { createElement: () => ({}), documentElement: { style: {} } };
    sb.localStorage = store;
    sb.sessionStorage = t.makeFakeLocalStorage();
    sb.location = { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:' };
    sb.console = { log() {}, warn() {}, error() {} };
    sb.setTimeout = (fn, ms) => { w.timers.push({ fn, ms }); return w.timers.length; };
    sb.clearTimeout = () => {};
    sb.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
    sb.atob = (s) => Buffer.from(s, 'base64').toString('binary');
    sb.addEventListener = (type, fn) => { w.listeners[type] = fn; };
    sb.toast = (msg, kind) => w.toasts.push([msg, kind]);
    sb.checkAuth = () => { w.checks++; return Promise.resolve(); };
    sb.showSessionExpired = () => { w.expired++; };
    Object.assign(sb, extra || {});
    t.vm.createContext(sb);
    t.vm.runInContext(t.readSource('js/security.js'), sb, { filename: 'js/security.js' });
    w.sb = sb;
    return w;
  }
  const BIG = 'x'.repeat(4000);

  t.section('Storage full: the quota-aware setter frees the app\'s own caches, in order');
  {
    const store = quotaStorage(10000);
    store.setItem('psycle_window_cache', BIG);
    store.setItem('psycle_cache_instructors', BIG);
    store.setItem('psycle_class_history', 'h'.repeat(1500));
    const w = securityWorld(store);
    w.sb.sessionStorage.setItem('psycle_last_results', 'r');
    eq(typeof w.sb._psycleSafeSetItem, 'function', 'security.js exposes window._psycleSafeSetItem (it loads first; app.js, settings.js, theme.js and explore.js use it)');
    ok(w.sb._psycleSafeSetItem('psycle_fav_instructors', 'f'.repeat(3000)) === true, 'a write that does not fit succeeds once the timetable cache is freed');
    eq([store.getItem('psycle_window_cache'), store.getItem('psycle_cache_instructors') !== null, w.sb.sessionStorage.getItem('psycle_last_results')], [null, true, null],
      '…the timetable cache (and the session copy of the last results) went; the reference lists were NOT needed and stay (they are what an offline launch reads)');
    ok(w.sb._psycleSafeSetItem('psycle_bike_history', 'b'.repeat(4500)) === true, 'still not enough room → the reference lists go too');
    eq(store.keys().filter((k) => /^psycle_(cache|swr)_/.test(k)), [], '…every psycle_cache_* / psycle_swr_* key');
    eq(store.getItem('psycle_class_history').length, 1500, 'the member\'s own data is never what gets freed');
    eq(w.sb._psycleSafeSetItem('psycle_too_big', 'z'.repeat(20000)), false, 'nothing left to free: false — never a throw');
    const dead = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); }, key() { throw new Error('SecurityError'); }, get length() { throw new Error('SecurityError'); } };
    let threw = false, res = null;
    try {
      const dw = securityWorld(dead);
      dw.sb.securityReady.catch(() => {}); // (start-up with storage blocked is its own, older, story)
      res = dw.sb._psycleSafeSetItem('k', 'v');
    } catch (e) { threw = true; }
    ok(!threw && res === false, 'a Storage that throws on every call: false, no throw');
    // native-bridge replaces localStorage.setItem to mirror keys into Preferences — after security.js has loaded.
    const late = t.makeFakeLocalStorage();
    const lw = securityWorld(late);
    const mirrored = [];
    const realSet = late.setItem.bind(late);
    late.setItem = (k, v) => { mirrored.push(k); realSet(k, v); };
    lw.sb._psycleSafeSetItem('psycle_fav_instructors', '[]');
    eq(mirrored, ['psycle_fav_instructors'], 'setItem is looked up at call time (the iOS bridge\'s replacement is the one that runs)');
  }

  t.section('Storage full: the token save never rejects, never reads "signed out", never leaves an older token behind');
  {
    // Room for nothing: the previous member's token is stored, the bucket is full.
    const store = quotaStorage(0);
    store.limit = 100000;
    store.setItem('psycle_bearer_token_enc', 'xor:PREVIOUS-MEMBER');
    store.setItem('psycle_class_history', 'h'.repeat(500));
    store.limit = 0; // every further write fails
    const w = securityWorld(store);
    await w.sb.securityReady;
    let rejected = false;
    await w.sb._secureTokenStore.set('tok-NEW-MEMBER-1234567890').catch(() => { rejected = true; });
    ok(!rejected, 'set() resolves (it used to reject — the plaintext fallback threw as well — so the caller\'s checkAuth never ran)');
    eq(w.sb._secureTokenStore.get(), 'tok-NEW-MEMBER-1234567890', 'the token is in memory: this session works');
    eq([store.getItem('psycle_bearer_token_enc'), store.getItem('psycle_bearer_token')], [null, null], 'the OLDER stored token is removed — the next launch must not sign in as the previous member — and no plaintext copy is attempted');
    eq(w.toasts.length === 1 && /storage is full/.test(w.toasts[0][0]) && !/network/i.test(w.toasts[0][0]), true, 'the member is told, once, that it is storage (never "network")');
    eq(store.getItem('psycle_class_history').length, 500, 'their data is untouched');

    // The sign-in popup's postMessage: checkAuth runs whatever the save did.
    w.checks = 0;
    w.listeners.message({ origin: 'http://localhost', data: { type: 'PSYCLE_LOGIN_TOKEN', token: 'tok-POPUP-1234567890' } });
    await flush();
    eq(w.checks, 1, 'postMessage sign-in with a full localStorage: checkAuth still runs (the app no longer looks signed out after a successful sign-in)');
    const src = t.readSource('js/security.js');
    ok(/\.set\(token\)\.then\(_afterSave, _afterSave\)/.test(src), '…on fulfilment AND rejection');

    // Room once the timetable cache is gone: saved, nothing said.
    const store2 = quotaStorage(6000);
    store2.setItem('psycle_window_cache', 'x'.repeat(5975)); // 6 characters of room left
    const w2 = securityWorld(store2);
    await w2.sb.securityReady;
    await w2.sb._secureTokenStore.set('tok-ROOM-1234567890');
    ok(/^xor:/.test(store2.getItem('psycle_bearer_token_enc') || '') && store2.getItem('psycle_window_cache') === null && w2.toasts.length === 0,
      'a full bucket whose tenant is the timetable cache: the cache goes, the token is saved, no toast');

    // login.html's plaintext copy of THIS token survives a failed migration.
    const store3 = quotaStorage(100000);
    store3.setItem('psycle_bearer_token', 'tok-FROM-LOGIN-PAGE-123');
    store3.limit = 0;
    const w3 = securityWorld(store3);
    await w3.sb.securityReady;
    await flush();
    eq([w3.sb._secureTokenStore.get(), store3.getItem('psycle_bearer_token'), w3.toasts.length], ['tok-FROM-LOGIN-PAGE-123', 'tok-FROM-LOGIN-PAGE-123', 0],
      'in-place sign-in (iOS): the migration cannot encrypt-and-store, but the copy login.html wrote is this same token — it stays for the next launch, and nothing is said');

    // A stored token that decoded fine is not thrown away because its re-save failed.
    const store4 = quotaStorage(100000);
    const w4pre = securityWorld(store4);
    await w4pre.sb.securityReady;
    await w4pre.sb._secureTokenStore.set('tok-KEPT-1234567890');
    const blob = store4.getItem('psycle_bearer_token_enc');
    store4.limit = 0;
    const w4 = securityWorld(store4);
    await w4.sb.securityReady;
    await w4.sb._secureTokenStore.set('tok-KEPT-1234567890');
    eq([store4.getItem('psycle_bearer_token_enc'), w4.toasts.length], [blob, 0], 're-saving the token the stored blob already holds: a failed write leaves that blob alone');
  }

  t.section('Token expiry by the device clock asks Psycle — it no longer ends the session by itself');
  {
    const jwt = (secsFromNow) => 'eyJhbGciOiJIUzI1NiJ9.' +
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secsFromNow })).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') + '.sig';
    let w = securityWorld(t.makeFakeLocalStorage());
    await w.sb.securityReady;
    await w.sb._secureTokenStore.set(jwt(-3600));
    const stored = w.sb.localStorage.getItem('psycle_bearer_token_enc');
    w.sb.scheduleTokenExpiryCheck();
    eq([w.checks, w.expired], [1, 0], 'launch with a JWT that expired an hour ago: checkAuth() is called, showSessionExpired() is NOT');
    eq([w.sb._secureTokenStore.get() !== '', w.sb.localStorage.getItem('psycle_bearer_token_enc')], [true, stored],
      '…so the token — and with it the offline saved copy of My Bookings, which dies with the token — is still there when there is no signal (a 401 from Psycle ends the session exactly as before)');

    w = securityWorld(t.makeFakeLocalStorage());
    await w.sb.securityReady;
    await w.sb._secureTokenStore.set(jwt(120));
    w.timers.length = 0;
    w.sb.scheduleTokenExpiryCheck();
    eq(w.timers.length, 1, 'two minutes left: one timer to the expiry');
    // …time passes; the timer fires with the token now past its exp.
    const realNow = Date.now;
    t.vm.runInContext('Date.now = function () { return ' + (realNow() + 180000) + '; };', w.sb);
    w.timers[0].fn();
    eq([w.checks, w.expired], [1, 0], 'the expiry timer firing mid-session asks Psycle too');

    // A check that throws / rejects must not surface.
    w = securityWorld(t.makeFakeLocalStorage(), {});
    await w.sb.securityReady;
    await w.sb._secureTokenStore.set(jwt(-10));
    w.sb.checkAuth = () => Promise.reject(new Error('boom'));
    let threw = false;
    try { w.sb.scheduleTokenExpiryCheck(); await flush(); } catch (e) { threw = true; }
    ok(!threw, 'a rejected check is swallowed');
    // Without app.js (no checkAuth) the old behaviour is the fallback.
    w = securityWorld(t.makeFakeLocalStorage());
    await w.sb.securityReady;
    await w.sb._secureTokenStore.set(jwt(-10));
    w.sb.checkAuth = undefined;
    w.sb.scheduleTokenExpiryCheck();
    eq(w.expired, 1, 'no checkAuth in reach: showSessionExpired as before');
    // The policy the saved copy relies on is unchanged: it goes when the token does.
    const appSrc = t.readSource('js/app.js');
    ok(/let stale = !getBearerToken\(\);/.test(appSrc), 'app.js: the saved copy is still deleted when no token is left (sign-out, a 401)');
  }

  // ── login.html ───────────────────────────────────────────────────────────
  t.section('login.html: a full localStorage is not a "Network error"');
  {
    const loginHtml = t.readSource('login.html');
    const script = /<script>([\s\S]*?)<\/script>/.exec(loginHtml)[1];
    ok(/var LOGIN_URL = /.test(script), 'the page\'s first attribute-less <script> is still the sign-in logic (tests/suites/offline.js runs it)');
    function loginWorld(store, opener) {
      const els = {
        email: { value: 'me@example.com' }, password: { value: 'hunter2' },
        loginBtn: { disabled: false, textContent: 'Sign in', innerHTML: '' },
        errMsg: { textContent: '', style: {} }, sLogin: { style: {} }, sDone: { style: { display: 'none' } },
      };
      const w = { els, posts: 0, messages: [], store };
      const ctx = t.vm.createContext({
        location: { href: 'https://app.test/login.html', origin: 'https://app.test', protocol: 'https:' },
        document: { getElementById: (id) => els[id] },
        window: { opener: opener ? { postMessage: (m, target) => w.messages.push([m, target]) } : null, close() {} },
        localStorage: store, sessionStorage: t.makeFakeLocalStorage(),
        console: { log() {} },
        setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {},
        AbortController,
        fetch: () => { w.posts++; return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { token: 'tok-LOGIN-1234567890' } }) }); },
      });
      t.vm.runInContext(script, ctx, { filename: 'login.html[script]' });
      w.ctx = ctx;
      return w;
    }

    // Nothing to free: the honest message, and a usable button.
    let store = quotaStorage(0);
    let lw = loginWorld(store, false);
    await lw.ctx.doLogin();
    ok(/storage is full/i.test(lw.els.errMsg.textContent) && !/network/i.test(lw.els.errMsg.textContent), 'in-place sign-in, nothing can be written: "storage is full" — not "Network error. Check your connection"');
    eq([lw.els.loginBtn.disabled, lw.els.loginBtn.textContent, lw.els.sDone.style.display], [false, 'Sign in', 'none'], '…the button is usable again and the page does not claim "Connected"');
    await lw.ctx.doLogin();
    eq(lw.posts, 2, '…and the in-flight flag was released (a second attempt goes out)');

    // The timetable cache is what filled the bucket: it goes, the sign-in is saved.
    store = quotaStorage(5000);
    store.setItem('psycle_window_cache', 'x'.repeat(2500));
    store.setItem('psycle_cache_locations', 'y'.repeat(2400));
    store.setItem('psycle_fav_instructors', '["11"]');
    lw = loginWorld(store, false);
    await lw.ctx.doLogin();
    eq([store.getItem('psycle_bearer_token'), store.getItem('psycle_window_cache'), store.getItem('psycle_cache_locations'), store.getItem('psycle_fav_instructors')],
      ['tok-LOGIN-1234567890', null, null, '["11"]'], 'a bucket filled by the app\'s caches: they are freed, the token is written on the retry, the member\'s data stays');
    eq([lw.els.errMsg.textContent, lw.els.sDone.style.display, lw.els.password.value], ['', '', ''], '…and the page moves on to "Connected" with the password cleared');

    // Popup flow: the opener already has the token, so an unsaved local copy is not a failure.
    store = quotaStorage(0);
    lw = loginWorld(store, true);
    await lw.ctx.doLogin();
    eq([lw.messages.length, lw.messages[0][0].token, lw.messages[0][1], lw.els.sDone.style.display, lw.els.errMsg.textContent],
      [1, 'tok-LOGIN-1234567890', 'https://app.test', '', ''], 'popup sign-in with a full localStorage: the token went to the opener (same-origin target) and the popup finishes normally');
  }

  t.section('login.html: the page that sees the password is locked down');
  {
    const loginHtml = t.readSource('login.html');
    const head = loginHtml.slice(0, loginHtml.indexOf('</head>'));
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(head);
    ok(!!csp, 'a Content-Security-Policy meta is in <head>');
    const dirs = {};
    (csp ? csp[1] : '').split(';').map((d) => d.trim()).filter(Boolean).forEach((d) => { const parts = d.split(/\s+/); dirs[parts[0]] = parts.slice(1); });
    eq(dirs['default-src'], ["'none'"], 'default-src \'none\': nothing loads unless listed');
    eq(dirs['connect-src'], ['https://psycle.codexfit.com'], 'the only host the page can talk to is Psycle');
    eq([dirs['form-action'], dirs['base-uri']], [["'none'"], ["'none'"]], 'the form can never submit natively, and no <base> can redirect its links');
    ok(dirs['script-src'].indexOf("'unsafe-inline'") !== -1 && dirs['style-src'].indexOf("'unsafe-inline'") !== -1, 'inline script + style are allowed (the page is self-contained, with an inline onsubmit)');
    ok(dirs['font-src'].indexOf('data:') !== -1 && dirs['img-src'].indexOf("'self'") !== -1, 'the data: display font and same-origin icons load');
    ok(!Object.keys(dirs).some((k) => dirs[k].some((v) => v === '*' || v === 'https:' || v === 'http:')), 'no wildcard source anywhere');
    ok(!('frame-ancestors' in dirs), 'no frame-ancestors (browsers ignore it in a <meta> policy and log an error)');
    ok(head.indexOf('Content-Security-Policy') < head.indexOf('<script'), 'the policy comes before any script');
    ok(/<script data-framebust>[\s\S]*?window\.top !== window\.self[\s\S]*?<\/script>/.test(head), 'the framebust is in <head>, in an ATTRIBUTED script tag (so it is not mistaken for the sign-in logic)');
    ok(/<meta name="referrer" content="strict-origin-when-cross-origin">/.test(head), 'referrer policy pinned: cross-origin requests see the origin only');
    const LOGIN = /LOGIN_URL = '([^']+)'/.exec(loginHtml)[1];
    ok(LOGIN.indexOf(dirs['connect-src'][0] + '/') === 0, 'the sign-in URL is inside connect-src');
    // Everything the page references must be allowed by the policy.
    const external = (loginHtml.match(/(?:src|href)="(https?:)?\/\/[^"]+"/g) || []);
    eq(external, [], 'the page loads nothing from another origin');
  }

  // ── Favourites vs the iOS restore ────────────────────────────────────────
  t.section('Favourites: read again after the iOS Preferences restore; one change is applied to what is STORED');
  {
    const appSrc = t.readSource('js/app.js');
    const from = appSrc.indexOf('// ── pure:stored-data:start');
    const to = appSrc.indexOf('function applyFavouritesAsFilter() {');
    ok(from !== -1 && to > from, 'the favourites block can be sliced');
    const world = (native) => {
      const w = { store: t.makeFakeLocalStorage(), paints: 0, toasts: [] };
      let release = null;
      const win = {};
      if (native) win._psycleNativeRestoreReady = new Promise((r) => { release = r; });
      const ctx = t.vm.createContext({
        window: win, localStorage: w.store, favouriteInstructors: new Set(),
        renderInstrDropdown: () => { w.paints++; }, renderInstrChips() {}, updateDiscoverEmptyState() {},
        toast: (m) => w.toasts.push(m), console,
      });
      w.load = () => t.vm.runInContext(appSrc.slice(from, to), ctx, { filename: 'js/app.js[favourites]' });
      w.ctx = ctx;
      w.release = async () => { release(); await flush(); };
      w.stored = () => JSON.parse(w.store.getItem('psycle_fav_instructors') || 'null');
      return w;
    };
    const tap = (w, id) => w.ctx.toggleFavourite(id, { stopPropagation() {} });

    // The reviewer's repro: purge → launch → restore lands late → one star tap.
    let w = world(true);
    w.load();
    eq([...w.ctx.favouriteInstructors], [], 'post-purge launch: nothing in localStorage yet when app.js reads favourites');
    w.store.setItem('psycle_fav_instructors', '["11","22","33","44"]'); // native-bridge's restore
    await w.release();
    eq([...w.ctx.favouriteInstructors], ['11', '22', '33', '44'], 'once the restore settles the Set is read again (stars, the Favs button and the preset work that launch)');
    ok(w.paints >= 1, '…and the dropdown / chips / Discover presets are repainted');
    tap(w, '55');
    eq(w.stored(), ['11', '22', '33', '44', '55'], 'a star tap ADDS to the restored list (it used to save ["55"] over it — in localStorage and in the Preferences mirror)');

    // Even a stale Set cannot clobber storage (restore never signalled, a second tab…).
    w = world(false);
    w.load();
    w.store.setItem('psycle_fav_instructors', '["11","22"]'); // written behind this page's back
    tap(w, '55');
    eq(w.stored(), ['11', '22', '55'], 'a stale in-memory Set: the tap is applied to what is stored');
    eq([...w.ctx.favouriteInstructors], ['11', '22', '55'], '…and the Set catches up');
    tap(w, '22');
    eq(w.stored(), ['11', '55'], 'un-starring removes just that one');
    w.ctx.setFavourite('77', true); w.ctx.setFavourite('77', true);
    eq(w.stored(), ['11', '55', '77'], 'setFavourite(id, on) is idempotent');

    // Stored junk never reaches the Set (it becomes filter chips).
    w = world(false);
    w.store.setItem('psycle_fav_instructors', JSON.stringify(['11', 'x" autofocus onfocus="alert(1)', { id: 1 }, 22]));
    w.load();
    eq([...w.ctx.favouriteInstructors], ['11', '22'], 'favourites are coerced where they are read');

    // A full localStorage: told, not thrown.
    w = world(false);
    w.load();
    w.store.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
    let threw = false;
    try { tap(w, '55'); } catch (e) { threw = true; }
    ok(!threw && w.toasts.length === 1 && /storage is full/.test(w.toasts[0]), 'a save that cannot be written says so instead of throwing out of the tap');

    const settingsSrc = t.readSource('js/settings.js');
    ok(/setFavourite\(sid, !favouriteInstructors\.has\(sid\)\)/.test(settingsSrc), 'the Membership star (toggleFavFromSettings) goes through setFavourite too');
    const themeSrc = t.readSource('js/theme.js');
    ok(/_psycleNativeRestoreReady\.then\(function \(\) \{\s*var id = _resolveTheme\(\);\s*if \(document\.documentElement\.getAttribute\('data-theme'\) === id\) return;/.test(themeSrc),
      'theme.js re-applies the restored theme after the same handshake — only when it differs');
    const setTheme = themeSrc.slice(themeSrc.indexOf('window.setAppTheme = function (id) {'), themeSrc.indexOf('function initTheme() {'));
    ok(setTheme.indexOf('_applyTheme(id);') < setTheme.indexOf('setItem(THEME_KEY, id)') && /try \{[\s\S]*setItem\(THEME_KEY, id\)[\s\S]*\} catch/.test(setTheme),
      'setAppTheme applies first and saves inside try/catch (a full localStorage used to make the tap do nothing)');
  }

  t.section('Timetable cache: never the tenant that fills the bucket');
  {
    const appSrc = t.readSource('js/app.js');
    const from = appSrc.indexOf('function _persistWindow(');
    const to = appSrc.indexOf('function _readWindowCache() {');
    const run = (limit) => {
      const store = quotaStorage(limit);
      const ctx = t.vm.createContext({ localStorage: store, WINDOW_CACHE_KEY: 'psycle_window_cache' });
      t.vm.runInContext(appSrc.slice(from, to), ctx, { filename: 'js/app.js[_persistWindow]' });
      ctx._persistWindow('2026-09-18|7', [{ id: 1, pad: 'x'.repeat(20000) }], {});
      return store;
    };
    let store = run(1000000);
    ok(store.getItem('psycle_window_cache') !== null && store.getItem('psycle_quota_probe') === null, 'plenty of room: persisted, and the probe key is gone again');
    store = run(60000);
    eq([store.getItem('psycle_window_cache'), store.getItem('psycle_quota_probe')], [null, null], 'it fitted, but 64K more would not: the cache is dropped (the token, a favourite or history must always still fit)');
    store = run(100);
    eq(store.getItem('psycle_window_cache'), null, 'it did not fit at all: as before, nothing stored and nothing thrown');
  }
};
