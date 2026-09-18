'use strict';
// The page shell: which scripts load, and in what order. Later modules
// monkey-patch earlier ones (settings → features → app.js; reliability.js
// wraps apiFetch; app.js calls PsycleFacets), so the order IS behaviour — and
// nothing else checks it: ios-app/build.js copies whatever the HTML says.
//   • psycle-finder.html loads every js/*.js once, deferred, never async,
//   • tests/smoke.html loads the same list in the same order (it once lacked
//     facets.js, so "SMOKE: PASS" was certifying an app that does not exist),
//   • the smoke page cannot reach Psycle's live API, and CI's grep for its
//     result can actually fail.
module.exports = async function (t) {
  const { ok, eq } = t;
  const finderHtml = t.readSource('psycle-finder.html');
  const smokeHtml = t.readSource('tests/smoke.html');

  // <script src> tags in document order, comments ignored: [{src, attrs, at}].
  function scriptTags(html) {
    const out = [];
    const live = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length)); // keep offsets
    const re = /<script\b([^>]*)>/g;
    let m;
    while ((m = re.exec(live))) {
      const src = /\bsrc="([^"]*)"/.exec(m[1]);
      if (src) out.push({ src: src[1], attrs: m[1], at: m.index });
    }
    return out;
  }
  // A page-relative src as a repo path: '../js/app.js' from tests/ → 'js/app.js'.
  const repoPath = (pageDir, src) => t.path.posix.normalize(t.path.posix.join(pageDir, src));

  t.section('psycle-finder.html: every module, once, in a fixed order');
  const finder = scriptTags(finderHtml);
  const finderList = finder.map((s) => repoPath('', s.src));
  const onDisk = t.fs.readdirSync(t.JS_DIR).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f).sort();
  ok(finder.length >= 14, 'the script tags are found (' + finder.length + ')');
  eq(finder.filter((s) => /^(https?:)?\/\//i.test(s.src)).map((s) => s.src), [], 'no script comes from another host — the app ships every line it runs');
  eq(finderList.filter((p) => !t.fs.existsSync(t.path.join(t.REPO_ROOT, p))), [], 'every src exists on disk');
  eq(onDisk.filter((p) => finderList.indexOf(p) === -1), [], 'every js/*.js is loaded (a module nobody loads is dead weight — or a forgotten tag)');
  eq(finderList.filter((p, i) => finderList.indexOf(p) !== i), [], 'none is loaded twice (a second run would re-wrap apiFetch / submitBooking)');
  eq(finder.filter((s) => !/\bdefer\b/.test(s.attrs) || /\basync\b/.test(s.attrs)).map((s) => s.src), [], 'all deferred, none async: defer keeps document order, async would not');

  // The few orderings the code depends on, by name — so a reshuffle that keeps
  // both pages in step still fails here.
  const before = (a, b) => finderList.indexOf('js/' + a) !== -1 && finderList.indexOf('js/' + a) < finderList.indexOf('js/' + b);
  ok(before('state.js', 'security.js') && before('security.js', 'app.js'), 'state → security → app (app.js reads PsycleState and the token store)');
  ok(before('facets.js', 'app.js'), 'facets.js before app.js (discoverFacets calls PsycleFacets.run)');
  ok(before('app.js', 'reliability.js'), 'app.js before reliability.js (it wraps the apiFetch / submitBooking it finds)');
  ok(before('reliability.js', 'performance.js'), 'reliability.js before performance.js (the reference-data cache patch wraps the retrying apiFetch; loaded the other way round, reliability.js rebuilds apiFetch from fetchWithRetry and the patch is silently discarded)');
  ok(before('reliability.js', 'features.js') && before('features.js', 'settings.js'), 'reliability → features → settings (each wraps the last one\'s eventCard / submitBooking)');
  ok(before('explore.js', 'api-client.js') && before('api-client.js', 'diagnostic.js'), 'api-client and diagnostic last, in that order (diagnostic reads PsycleAPI.SCHEMAS)');

  t.section('tests/smoke.html: the same scripts, in the same order');
  const smoke = scriptTags(smokeHtml);
  const smokeList = smoke.map((s) => repoPath('tests', s.src));
  eq(smokeList, finderList, 'smoke.html lists exactly what psycle-finder.html lists, in the same order');
  eq(smoke.filter((s) => /\b(defer|async)\b/.test(s.attrs)).map((s) => s.src), [], 'loaded synchronously — the inline runner at the end must find every module evaluated');
  ok(/checkMember\('PsycleFacets', 'run', 'function'\)/.test(smokeHtml), 'the page checks PsycleFacets.run');

  t.section('tests/smoke.html: cannot reach the live API');
  const firstSrcAt = smoke.length ? smoke[0].at : -1;
  const head = firstSrcAt === -1 ? '' : smokeHtml.slice(0, firstSrcAt);
  const inlineBefore = (head.replace(/<!--[\s\S]*?-->/g, '').match(/<script>([\s\S]*?)<\/script>/g) || []).map((s) => s.replace(/^<script>|<\/script>$/g, ''));
  const stubSrc = inlineBefore.filter((s) => /window\.fetch\s*=/.test(s))[0];
  ok(!!stubSrc, 'window.fetch is replaced by an inline script that comes BEFORE the first app script (app.js fetches as it loads)');
  ok(!/codexfit/i.test(smokeHtml.replace(/<!--[\s\S]*?-->/g, '')), 'the page itself names no API host');
  if (stubSrc && typeof Response === 'function') {
    // The "real" fetch here only records: nothing in this suite touches a network.
    const real = [];
    const win = { fetch: (url) => { real.push(String(url)); return Promise.resolve(new Response('{"data":["LIVE"]}', { status: 200 })); } };
    const ctx = t.vm.createContext({ window: win, Response, Promise });
    t.vm.runInContext(stubSrc, ctx, { filename: 'tests/smoke.html[fetch stub]' });
    let seen = null, threw = null;
    try {
      const a = await win.fetch('https://psycle.codexfit.com/api/v1/customer/instructors', { headers: { Authorization: 'Bearer x' } });
      const b = await win.fetch('https://psycle.codexfit.com/api/v1/customer/bookings', { method: 'POST', body: '{"event_id":1,"slots":[1]}' });
      seen = { ok: a.ok, status: a.status, cloned: await a.clone().json(), first: await a.json(), second: await b.json() };
    } catch (e) { threw = e; }
    eq(real, [], 'a GET and a POST through the stub: the real fetch is never called');
    eq(threw && threw.message, null, 'the stub answers without throwing');
    eq(seen && [seen.ok, seen.status, seen.cloned, seen.first], [true, 200, { data: [] }, { data: [] }], 'the answer is a real Response — ok, 200, {data: []}, clone() works (performance.js clones before caching)');
    eq(seen && seen.second, { data: [] }, 'each call gets its own Response (a body can be read once)');
    ok(!!seen && seen.status !== 401, 'never a 401: on an origin holding a session that would sign the developer out of the app');
    ok(win.fetch === win.__smokeFetchStub && /window\.fetch === window\.__smokeFetchStub/.test(smokeHtml), 'the runner fails the page if a module swaps another fetch in');
  } else if (stubSrc) {
    ok(true, '(no global Response in this Node — the stub was checked for position only)');
  }

  // Hoisted function declarations satisfy every typeof check for a module that
  // died on its first line: the page listens for the throw itself.
  t.section('tests/smoke.html: a module that throws while loading fails the page');
  const listenerSrc = inlineBefore.filter((s) => /__smokeLoadErrors/.test(s))[0];
  ok(!!listenerSrc && !/window\.fetch\s*=/.test(listenerSrc), 'an inline script of its own, BEFORE the first app script, collects load errors (the fetch stub below it is evaluated here in a bare sandbox)');
  ok(head.indexOf('__smokeLoadErrors') < head.indexOf('window.fetch ='), '…ahead of the fetch stub too: nothing runs before it');
  if (listenerSrc) {
    let handler = null, capture = null;
    const win = { addEventListener: (type, fn, cap) => { if (type === 'error') { handler = fn; capture = cap; } } };
    t.vm.runInContext(listenerSrc, t.vm.createContext({ window: win, String }), { filename: 'tests/smoke.html[load errors]' });
    ok(typeof handler === 'function' && capture === true, "it listens for 'error' on window, in the capture phase (a script that fails to load does not bubble)");
    eq(win.__smokeLoadErrors, [], 'nothing thrown → an empty list');
    handler({ target: win, message: "Uncaught TypeError: Cannot read properties of null (reading 'boom')", filename: 'http://127.0.0.1:8080/js/app.js', lineno: 1 });
    handler({ target: { tagName: 'SCRIPT', getAttribute: () => '../js/explore.js' } });
    handler({ target: { tagName: 'IMG', getAttribute: () => 'x.png' } });
    handler({ target: { tagName: 'LINK' } });
    eq(win.__smokeLoadErrors, ["Uncaught TypeError: Cannot read properties of null (reading 'boom') (app.js:1)", 'could not load ../js/explore.js'],
      'a throw at a module\'s top level and a script that 404s are recorded — a stray image or stylesheet error is not');
  }
  const runner = smokeHtml.slice(smokeHtml.lastIndexOf('<script>'));
  ok(/line\(false, 'threw while loading: ' \+ m\)/.test(runner) && /line\(true, 'no script threw or failed to load'\)/.test(runner) && /!Array\.isArray\(loadErrors\)/.test(runner),
    'the runner turns each one into a FAIL line (and fails if the listener itself went missing)');
  ok(runner.indexOf('threw while loading') < runner.indexOf("banner.className = 'pass'"), '…before the banner is decided');

  t.section('CI: the smoke step can fail, and typecheck no longer hides a missing tsc');
  const ci = t.readSource('.github/workflows/ci.yml');
  const PASS_MARKUP = 'class="pass">SMOKE: PASS';
  ok(smokeHtml.indexOf(PASS_MARKUP) === -1, 'the PASS banner markup appears nowhere in the page source — only the runner can produce it');
  ok(/<div id="banner" class="run">/.test(smokeHtml) && /banner\.className = 'pass';\s*banner\.textContent = 'SMOKE: PASS';/.test(smokeHtml), '…by setting the banner to class "pass" + "SMOKE: PASS"');
  ok(/SMOKE: PASS/.test(smokeHtml.replace(/<script>[\s\S]*?<\/script>/g, '')), '(while the bare words DO sit in its comments — why a grep for them alone would always pass)');
  const smokeStep = (/- name: Smoke test[\s\S]*?(?=\n {6}(?:#|- name:))/.exec(ci) || [''])[0];
  ok(smokeStep.indexOf("grep -q '" + PASS_MARKUP + "'") !== -1, 'ci.yml greps the dumped DOM for the banner markup');
  ok(!/grep[^\n]*'SMOKE: PASS'/.test(smokeStep), '…and never for the bare words');
  ok(/http:\/\/127\.0\.0\.1:8080\/tests\/smoke\.html/.test(smokeStep) && /--host-resolver-rules="MAP \* ~NOTFOUND, EXCLUDE 127\.0\.0\.1"/.test(smokeStep),
    'Chrome is pointed at the runner\'s own server and can resolve no other host');
  ok(/--retry-connrefused/.test(smokeStep), 'the step waits for the server before opening the page');
  ok(!/\$\{\{/.test(smokeStep), 'no ${{ }} expression is interpolated into the shell');

  const pkg = JSON.parse(t.readSource('package.json'));
  ok(/^tsc\b/.test(pkg.scripts.typecheck) && !/\|\|\s*true/.test(pkg.scripts.typecheck), 'npm run typecheck reports tsc\'s own exit code (no "|| true")');
  const typeStep = (/- name: Type check[\s\S]*?(?=\n {2}\S|\n {6}- name:|$)/.exec(ci) || [''])[0];
  ok(/run: npm run typecheck/.test(typeStep) && /continue-on-error: true/.test(typeStep), '…and stays advisory in CI through continue-on-error');
  eq(pkg.scripts.ci, 'npm run check && npm run test && npm run drift', 'npm run ci (the pre-commit gate) is unchanged: it never ran typecheck');
};
