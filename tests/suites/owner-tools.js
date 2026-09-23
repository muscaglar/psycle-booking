'use strict';
// Owner tools: the build id in bug reports / diagnostics (js/settings.js +
// the iOS bridge's getDiagnosticReport) and Discover's "S/A" tier quick filter
// (js/app.js). Everything here runs the SHIPPED source — pure:<name> regions,
// or slices between anchor lines — against stub globals; nothing is copied.
module.exports = function (t) {
  const settingsSrc = t.readSource('js/settings.js');
  const bridgeSrc = t.readSource('ios-app/www/native-bridge.js');
  const tick = () => new Promise((r) => setImmediate(r));

  // Source between two anchor lines (the first is included, the second is not).
  function slice(src, fromAnchor, toAnchor, what) {
    const a = src.indexOf(fromAnchor);
    const b = src.indexOf(toAnchor, a + 1);
    t.ok(a !== -1 && b > a, what + ' can be sliced (anchors moved? update tests/suites/owner-tools.js)');
    return a !== -1 && b > a ? src.slice(a, b) : '';
  }

  // ══════════════════════════════════════════════════════════════════════
  // Build id
  // ══════════════════════════════════════════════════════════════════════
  // opts: cacheNames (array | 'throws' | undefined = no Cache Storage),
  //       swText (string | 'reject' | 'hang' | 404), native, controller.
  function buildIdWorld(opts) {
    opts = opts || {};
    const log = { fetched: [], cacheReads: 0, swListeners: [] };
    const timers = [];
    const window = {};
    if (opts.native) window.Capacitor = { isNativePlatform: () => true };
    if (opts.preset) window.APP_VERSION = opts.preset;
    const globals = {
      window,
      Promise,
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      navigator: {
        serviceWorker: opts.noContainer ? undefined : {
          controller: opts.controller ? {} : null,
          addEventListener: (name, fn) => { if (name === 'controllerchange') log.swListeners.push(fn); },
        },
      },
      fetch: (url) => {
        log.fetched.push(url);
        if (opts.swText === 'reject') return Promise.reject(new Error('offline'));
        if (opts.swText === 'hang') return new Promise(() => {});
        if (opts.swText === 404) return Promise.resolve({ ok: false, text: () => Promise.resolve('<html>not found</html>') });
        return Promise.resolve({ ok: true, text: () => Promise.resolve(opts.swText || '') });
      },
    };
    if (opts.cacheNames !== undefined) {
      globals.caches = {
        keys: () => {
          log.cacheReads++;
          return opts.cacheNames === 'throws' ? Promise.reject(new Error('SecurityError')) : Promise.resolve(opts.cacheNames.slice());
        },
      };
    }
    const ctx = t.loadPure('js/settings.js', 'build-id', globals);
    return { ctx, window, log, timers, opts };
  }
  const SW = "const CACHE = 'psycle-90439528';\nconst SHELL = [\n  './psycle-finder.html'\n];\n";

  t.section('Build id: web reads the content-hashed service-worker cache name');
  return (async () => {
    let w = buildIdWorld({ cacheNames: ['psycle-90439528', 'some-other-cache'] });
    t.ok(w.window.APP_VERSION === undefined && w.log.cacheReads === 0 && w.log.fetched.length === 0,
      'nothing is read at load: the build id is worked out on first need, not at startup');
    t.eq(typeof w.window.getAppVersion, 'function', 'window.getAppVersion is exported for the iOS bridge');
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-90439528', 'resolves to the psycle-<8 hex> cache name');
    t.eq(w.window.APP_VERSION, 'psycle-90439528', 'and leaves it on window.APP_VERSION (diagnostic.js + the panel read that)');
    t.eq(w.log.fetched, [], 'sw.js is not fetched when Cache Storage already names the build');
    await w.ctx.resolveAppVersion();
    t.eq(w.log.cacheReads, 1, 'a second call reuses the answer');

    w = buildIdWorld({ cacheNames: ['psycle-v42', 'psycle-ABCDEF12', 'psycle-1234567', 'xpsycle-12345678', 'psycle-123456789'], swText: SW });
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-90439528',
      'legacy psycle-vNN and near-miss names are not build ids (anchored /^psycle-[0-9a-f]{8}$/): falls through to sw.js');

    w = buildIdWorld({ cacheNames: ['psycle-aaaaaaaa', 'psycle-bbbbbbbb'] });
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-aaaaaaaa + psycle-bbbbbbbb', 'two build caches (an update mid-install) are both reported');

    t.section('Build id: falls back to the shipped sw.js');
    w = buildIdWorld({ swText: SW });
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-90439528', 'no Cache Storage at all → parsed out of sw.js');
    t.eq(w.log.fetched, ['sw.js'], 'one same-origin relative fetch of sw.js');
    w = buildIdWorld({ cacheNames: 'throws', swText: SW });
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-90439528', 'caches.keys() rejecting (private mode) → sw.js');
    w = buildIdWorld({ cacheNames: [], swText: "const CACHE = \"psycle-0badf00d\";" });
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-0badf00d', 'double-quoted CACHE line parses too (build.js tolerates both)');
    w = buildIdWorld({ cacheNames: [], swText: "const CACHE = 'psycle-v57';\n// psycle-12345678 in a comment" });
    t.eq(await w.ctx.resolveAppVersion(), null, 'only the CACHE assignment counts — a legacy stamp or a stray match elsewhere is not a build id');
    t.ok(w.window.APP_VERSION === undefined, 'and nothing is written to window.APP_VERSION');

    t.section('Build id: the iOS app never trusts Cache Storage');
    w = buildIdWorld({ native: true, cacheNames: ['psycle-0ldb1d00'], swText: SW });
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-90439528', 'a cache left behind by an OLDER build is ignored; the bundled sw.js names this one');
    t.eq(w.log.cacheReads, 0, 'Cache Storage is not even read on the native platform');

    t.section('Build id: failures are not remembered, and never hang a report');
    w = buildIdWorld({ cacheNames: [], swText: 'reject' });
    t.eq(await w.ctx.resolveAppVersion(), null, 'offline first visit → null (the report prints "unknown")');
    w.opts.swText = SW;
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-90439528', 'the next report tries again and succeeds');
    w = buildIdWorld({ cacheNames: [], swText: 404 });
    t.eq(await w.ctx.resolveAppVersion(), null, 'a 404 page for sw.js is not parsed');
    w = buildIdWorld({ cacheNames: [], swText: 'hang' });
    const hung = w.ctx.resolveAppVersion();
    await tick();
    t.eq(w.timers.map((x) => x.ms), [2000], 'a stalled request is capped at 2s');
    w.timers[0].fn();
    t.eq(await hung, null, 'and the cap resolves null rather than leaving downloadBugReport awaiting forever');
    w = buildIdWorld({ preset: 'psycle-feedface', cacheNames: ['psycle-90439528'] });
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-feedface', 'an APP_VERSION something else already set wins');
    t.eq(w.log.cacheReads, 0, 'without touching Cache Storage');

    t.section('Build id: a worker that took over mid-session is called out');
    w = buildIdWorld({ controller: true, cacheNames: ['psycle-bbbbbbbb'] });
    t.eq(w.log.swListeners.length, 1, 'a page that loaded under a worker listens for controllerchange');
    w.log.swListeners[0]();
    const swapped = await w.ctx.resolveAppVersion();
    t.ok(/^psycle-bbbbbbbb \(.*reload pending\)$/.test(swapped),
      'the old cache is gone, so the only name left is flagged — the page may still run the previous build (got "' + swapped + '")');
    w = buildIdWorld({ controller: true, cacheNames: ['psycle-aaaaaaaa'] });
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-aaaaaaaa', 'resolved BEFORE the takeover: the plain id');
    w.log.swListeners[0]();
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-aaaaaaaa', 'and it stays that id afterwards — it is still the build that is running');
    w = buildIdWorld({ controller: false, cacheNames: ['psycle-aaaaaaaa'] });
    t.eq(w.log.swListeners.length, 0, 'no controller at load (first install) → no listener: nothing on the page is stale');
    w = buildIdWorld({ noContainer: true, cacheNames: ['psycle-aaaaaaaa'] });
    t.eq(await w.ctx.resolveAppVersion(), 'psycle-aaaaaaaa', 'no ServiceWorkerContainer at all does not throw at load');

    // ════════════════════════════════════════════════════════════════════
    // Bug report
    // ════════════════════════════════════════════════════════════════════
    t.section('Bug report: names the build, waits for it, and the cancel toast points nowhere');
    t.ok(/sections\.push\('Build: ' \+ \(window\.APP_VERSION \|\| 'unknown'\)\);/.test(slice(settingsSrc, '  function buildBugReport() {', '  window.downloadBugReport = async function () {', 'buildBugReport')),
      'buildBugReport prints a Build: line from window.APP_VERSION');
    const dl = slice(settingsSrc, '  window.downloadBugReport = async function () {', '  function _fallbackCopy(text, status, what) {', 'downloadBugReport');
    t.ok(dl.indexOf('await resolveAppVersion()') !== -1 && dl.indexOf('await resolveAppVersion()') < dl.indexOf('buildBugReport()'),
      'downloadBugReport resolves the build id BEFORE it builds the report');
    const cancelToast = (/toast\('(Share cancelled[^']*)'/.exec(dl) || [])[1] || '';
    t.ok(!!cancelToast && !/copy/i.test(cancelToast), 'the share-cancel toast no longer sends the tester to a "Copy" button that does not exist ("' + cancelToast + '")');

    // ════════════════════════════════════════════════════════════════════
    // Copy diagnostics
    // ════════════════════════════════════════════════════════════════════
    t.section('Copy diagnostics: embeds the prefetched native report, never a promise');
    function diagWorld(report) {
      const window = { APP_VERSION: 'psycle-90439528' };
      if (report !== undefined) window.getDiagnosticReport = report;
      const ctx = t.vm.createContext({ console, JSON, Date, Promise, window, navigator: { onLine: true, userAgent: 'UA/1.0 (iPhone)' }, diagHasToken: () => true });
      t.vm.runInContext(slice(settingsSrc, '  var _diagReportText = null;', '  window.openDiagnostics = function () {', 'the prefetch + diagBuildCopyBlob block'), ctx, { filename: 'js/settings.js[diag copy]' });
      return { ctx, window, blob: () => JSON.parse(ctx.diagBuildCopyBlob(null)) };
    }
    let d = diagWorld(async () => '=== Psycle iOS Diagnostic Report ===\nBuild: psycle-90439528');
    d.ctx.diagPrefetchReport();
    t.eq(d.blob().diagnosticReport, '(still loading — copy again in a moment)', 'a tap before the report lands says so instead of embedding {}');
    await tick();
    t.eq(d.blob().diagnosticReport, '=== Psycle iOS Diagnostic Report ===\nBuild: psycle-90439528', 'once landed, the TEXT is embedded (it used to be the un-awaited promise → {})');
    t.eq([d.blob().environment.appVersion, d.blob().environment.userAgent], ['psycle-90439528', 'UA/1.0 (iPhone)'], 'the blob names the build and the device');
    t.ok(d.ctx.diagBuildCopyBlob(null).indexOf('[object Promise]') === -1 && !/"diagnosticReport": \{\}/.test(d.ctx.diagBuildCopyBlob(null)), 'no promise is ever serialised');
    t.eq(typeof d.ctx.diagBuildCopyBlob(null), 'string', 'diagBuildCopyBlob is still synchronous (the clipboard write needs the live tap)');

    d = diagWorld();
    d.ctx.diagPrefetchReport();
    await tick();
    t.ok(!('diagnosticReport' in d.blob()), 'web build (no bridge): no diagnosticReport key, as before');

    d = diagWorld(() => Promise.reject(new Error('bridge down')));
    d.ctx.diagPrefetchReport();
    await tick();
    t.eq(d.blob().diagnosticReport, '(native report unavailable)', 'a rejected bridge report says unavailable — "copy again in a moment" would never come true');
    d = diagWorld(() => { throw new Error('bridge threw synchronously'); });
    d.ctx.diagPrefetchReport();
    t.eq(d.blob().diagnosticReport, '(native report unavailable)', 'a bridge that throws outright never reaches the Copy tap either');

    // Open → "Clear logs" re-fetches; the slow FIRST fetch must not land last.
    const resolvers = [];
    d = diagWorld(() => new Promise((r) => resolvers.push(r)));
    d.ctx.diagPrefetchReport();
    d.ctx.diagPrefetchReport();
    resolvers[1]('after clear');
    await tick();
    resolvers[0]('before clear (stale)');
    await tick();
    t.eq(d.blob().diagnosticReport, 'after clear', 'only the newest prefetch may land — the pre-"Clear logs" report cannot overwrite it');
    t.ok(/diagPrefetchReport\(\);/.test(slice(settingsSrc, '  function clearDiagnosticLogs() {', '\n  }\n', 'clearDiagnosticLogs')), 'Clear logs re-fetches the native report');
    const opener = slice(settingsSrc, '  window.openDiagnostics = function () {', '  window.closeDiagnostics = function () {', 'openDiagnostics');
    t.ok(/diagPrefetchReport\(\);/.test(opener) && /resolveAppVersion\(\)\.then\(/.test(opener), 'opening the panel prefetches the report and resolves the build id');

    t.section('Copy diagnostics: the status line tells the truth');
    function copyWorld(o) {
      const log = { status: [], toasts: [], removed: 0 };
      const ta = { style: {}, select() {} };
      const ctx = t.vm.createContext({
        console, Promise, Error,
        navigator: o.clipboard === undefined ? {} : { clipboard: { writeText: () => (o.clipboard ? Promise.resolve() : Promise.reject(new Error('NotAllowedError'))) } },
        document: {
          createElement: () => ta,
          body: { appendChild() {}, removeChild() { log.removed++; } },
          execCommand: () => { if (o.exec === 'throws') throw new Error('nope'); return o.exec; },
        },
        toast: (m, k) => log.toasts.push([m, k]),
        diagStatus: (m, ok) => log.status.push([m, ok]),
        diagBuildCopyBlob: () => '{"blob":1}',
        diagGetDiagnostics: () => null,
        setTimeout() {},
      });
      t.vm.runInContext(
        slice(settingsSrc, '  function _fallbackCopy(text, status, what) {', '  // ═══', '_fallbackCopy') + '\n' +
        slice(settingsSrc, '  function copyDiagnostics() {', '  function clearDiagnosticLogs() {', 'copyDiagnostics + its fallback'),
        ctx, { filename: 'js/settings.js[copy]' });
      return { ctx, log };
    }
    let c = copyWorld({ clipboard: true });
    c.ctx.copyDiagnostics();
    await tick();
    t.eq(c.log.status, [['Diagnostics copied to clipboard', true]], 'clipboard API ok → copied');

    c = copyWorld({ clipboard: false, exec: true });
    c.ctx.copyDiagnostics();
    await tick();
    t.eq(c.log.status, [['Diagnostics copied to clipboard', true]], 'clipboard API refused, execCommand ok → copied');
    t.eq(c.log.toasts, [['Diagnostics copied to clipboard', 'success']], 'and the toast says Diagnostics (it used to say "Bug report")');

    c = copyWorld({ clipboard: false, exec: false });
    c.ctx.copyDiagnostics();
    await tick();
    t.eq(c.log.status.length === 1 && c.log.status[0][1], false, 'both routes refused (execCommand returns false, it does not throw) → the status line no longer claims "copied"');
    t.ok(/fail/i.test(c.log.status[0][0]) && c.log.toasts.length === 1 && c.log.toasts[0][1] === 'error', 'it reports the failure, once');
    t.eq(c.log.removed, 1, 'the scratch textarea is still removed on the failure path');

    c = copyWorld({ exec: 'throws' });
    c.ctx.copyDiagnostics();
    t.eq(c.log.status.length === 1 && c.log.status[0][1], false, 'no clipboard API and execCommand throws → failure, synchronously');

    c = copyWorld({ exec: true });
    t.eq(c.ctx._fallbackCopy('x', null), true, '_fallbackCopy returns true on success');
    t.eq(c.log.toasts[0], ['Bug report copied to clipboard', 'success'], 'and with no label passed the toast keeps its default wording, "Bug report"');

    // ════════════════════════════════════════════════════════════════════
    // iOS bridge report
    // ════════════════════════════════════════════════════════════════════
    t.section('iOS diagnostic report: names the build and the device');
    const reportFn = slice(bridgeSrc, '  window.getDiagnosticReport = async function () {', "\n\n\n  console.log('[native] Native bridge initialized');", 'getDiagnosticReport');
    async function iosReport(win) {
      const ls = t.makeFakeLocalStorage();
      ls.setItem('psycle_bearer_token', 'SECRET-TOKEN-VALUE');
      const ctx = t.vm.createContext(Object.assign({
        console, JSON, Date, Promise, Blob,
        Capacitor: { Plugins: {} },
        ACTION_LOG_NATIVE_KEY: 'psycle_native_action_log',
        screen: { width: 390, height: 844 },
        innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
        document: { documentElement: { getAttribute: () => 'cloud' } },
        navigator: { onLine: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)' },
        localStorage: ls,
      }, win));
      ctx.window = ctx;
      t.vm.runInContext(reportFn, ctx, { filename: 'native-bridge.js[getDiagnosticReport]' });
      return ctx.getDiagnosticReport();
    }
    let rep = await iosReport({ getAppVersion: async () => 'psycle-90439528' });
    t.ok(/^Build: psycle-90439528$/m.test(rep), 'Build: line comes from settings.js\'s getAppVersion');
    t.ok(/^User Agent: Mozilla\/5\.0 \(iPhone; CPU iPhone OS 18_6/m.test(rep), 'User Agent line carries the device class + iOS version (the Device/App plugins are not installed)');
    t.ok(rep.indexOf('SECRET-TOKEN-VALUE') === -1 && /psycle_bearer_token: \d+ bytes/.test(rep), 'still key names + sizes only — never a stored value');
    rep = await iosReport({ getAppVersion: () => Promise.reject(new Error('x')), APP_VERSION: 'psycle-0badf00d' });
    t.ok(/^Build: psycle-0badf00d$/m.test(rep), 'a failing resolver falls back to window.APP_VERSION');
    rep = await iosReport({});
    t.ok(/^Build: unknown$/m.test(rep), 'no resolver (older web bundle) → "unknown", no throw');

    // ════════════════════════════════════════════════════════════════════
    // ★ Favs: the one quick filter beside the instructor search
    // ════════════════════════════════════════════════════════════════════
    t.section('Favourites filter: the one quick filter, with its own spoken name');
    const html = t.readSource('psycle-finder.html');
    const favTag = (/<button[^>]*id="favBtn"[^>]*>/.exec(html) || [])[0] || '';
    const favName = (/aria-label="([^"]+)"/.exec(favTag) || [])[1] || '';
    t.ok(!!favName && /starred/i.test(favName), '★ Favs carries its own spoken name ("' + favName + '"), so the wrapping label\'s text is not read out on it');
    t.ok(!/id="tierBtn"|applyTierFilter|S\/A/.test(html) && !/applyTierFilter|_topTierInstructorIds/.test(t.readSource('js/app.js') + t.readSource('js/interactions.js')),
      'there is no grade filter: a star is the only mark a member can put on an instructor');
  })();
};
