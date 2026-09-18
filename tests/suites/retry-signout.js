'use strict';
// js/reliability.js builds a request's Authorization header ONCE and the retry
// loop re-sends it after every backoff (1s, 2s, 4s…). A member who signs out —
// or whose session ends, or who switches account — in one of those gaps had the
// OLD bearer token sent out again, up to three more times, and the offline
// drain then told a signed-out screen "1 queued action still pending".
// Same sandbox as tests/suites/reliability.js (the whole module, a counting
// fetch stub), with a token that can change and a hook that fires DURING a
// backoff — which is exactly when a sign-out lands.
module.exports = async function (t) {
  const { ok, eq } = t;
  const relSrc = t.readSource('js/reliability.js');
  const BASE = 'https://api.test';
  const timeoutDecl = /const FETCH_TIMEOUT_MS = (\d+);/.exec(relSrc);
  const ABORT_MS = timeoutDecl ? Number(timeoutDecl[1]) : 15000;

  t.section('Retry: may this request be sent again? (pure:retry-auth)');
  {
    const p = t.loadPure('js/reliability.js', 'retry-auth');
    ok(typeof p._retryTokenStillValid === 'function', 'pure:retry-auth exposes _retryTokenStillValid');
    eq(p._retryTokenStillValid('tok-A', 'tok-A'), true, 'the token it started with is still the stored one → retry');
    eq([p._retryTokenStillValid('tok-A', ''), p._retryTokenStillValid('tok-A', null), p._retryTokenStillValid('tok-A', undefined)], [false, false, false],
      'signed out / session ended since (no token stored) → never sent again');
    eq(p._retryTokenStillValid('tok-A', 'tok-B'), false, 'another account signed in since → the first member\'s request is not re-sent (nor re-sent as the second)');
    eq([p._retryTokenStillValid('', ''), p._retryTokenStillValid('', 'tok-B'), p._retryTokenStillValid(undefined, '')], [true, true, true],
      'a request that carried no token has no credential to re-send: retried as before');
  }

  // One fresh world. `w.token` is what getBearerToken() answers; `w.onBackoff`
  // runs when a backoff delay starts (the sandbox clock then elapses it at once).
  function world(o) {
    o = o || {};
    const log = { calls: [], backoffs: 0, toasts: [], expired: 0, refetches: 0, listeners: {} };
    const w = { log, store: t.makeFakeLocalStorage(), nav: { onLine: true }, token: o.token === undefined ? 'tok-A' : o.token, respond: () => ({ status: 200, body: {} }), onBackoff: null };
    const sb = {};
    sb.window = sb;
    sb.console = { log() {}, warn() {}, error() {} };
    sb.localStorage = w.store;
    sb.navigator = w.nav;
    sb.document = { hidden: false, visibilityState: 'visible', addEventListener() {}, getElementById: () => null };
    sb.currentUser = { id: 42 };
    sb.AbortController = AbortController;
    sb.setTimeout = (fn, ms) => {
      if (ms === ABORT_MS) return 0; // the per-attempt abort timer: never fires here
      log.backoffs++;
      if (w.onBackoff) w.onBackoff(log.backoffs);
      fn();
      return 0;
    };
    sb.clearTimeout = () => {};
    sb.addEventListener = (type, fn) => { log.listeners[type] = fn; };
    sb.apiUrl = (path) => BASE + path;
    sb.getBearerToken = () => w.token;
    sb.showSessionExpired = () => { log.expired++; w.token = ''; }; // app.js clears the stored token first
    // app.js's sign-out. Present BEFORE the module loads, so its "empty the
    // queue on a deliberate sign-out" wrapper is installed around it.
    sb.clearToken = () => { w.token = ''; sb.currentUser = null; };
    sb.toast = (msg, type) => { log.toasts.push({ msg, type }); };
    sb.fetchMyBookings = () => { log.refetches++; };
    sb.formatSlots = (label, slots) => label + ' ' + slots.join(' & ');
    sb.slotLabelForEvent = () => 'Bike';
    sb._myBookings = {};
    sb.apiFetch = function baseApiFetch() { throw new Error('the unwrapped apiFetch must not be reached'); };
    sb.submitBooking = async function baseSubmitBooking(eventId, slots, btn) { btn.textContent = 'Booked ✓'; };
    sb.fetch = (url, opts) => {
      opts = opts || {};
      const call = {
        method: String(opts.method || 'GET').toUpperCase(),
        path: String(url).indexOf(BASE) === 0 ? String(url).slice(BASE.length) : String(url),
        auth: (opts.headers || {}).Authorization,
      };
      log.calls.push(call);
      const r = w.respond(call);
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => (r.body === undefined ? {} : r.body) });
    };
    t.vm.createContext(sb);
    t.vm.runInContext(relSrc, sb, { filename: 'js/reliability.js' });
    w.sb = sb;
    w.queue = () => JSON.parse(w.store.getItem('psycle_offline_queue') || '[]');
    w.said = (re) => log.toasts.some((x) => re.test(x.msg));
    w.errorLog = () => w.store.getItem('psycle_error_log') || '';
    return w;
  }
  const netError = () => new TypeError('Failed to fetch');
  // → what the caller of apiFetch saw
  const run = async (w, path, opts) => {
    try { const res = await w.sb.apiFetch(path, opts); return { status: res.status }; }
    catch (e) { return { name: e.name, message: e.message, abandoned: e.abandoned === true }; }
  };

  t.section('Retry: a sign-out during the backoff stops the old token going out again');
  {
    let w = world();
    w.respond = () => ({ status: 503 });
    let seen = await run(w, '/bookings');
    eq([w.log.calls.length, seen], [4, { status: 503 }], '(still signed in: a 503 is tried 1 + 3 times and the last answer handed back, as before)');
    ok(w.log.calls.every((c) => c.auth === 'Bearer tok-A'), '…each attempt carrying the token the request was built with');

    w = world();
    w.respond = () => ({ status: 503 });
    w.onBackoff = (n) => { if (n === 1) w.sb.clearToken(); }; // the member signs out while the first retry is waiting
    seen = await run(w, '/bookings');
    eq(w.log.calls.map((c) => c.auth), ['Bearer tok-A'], 'signed out during the first backoff → ONE request in all: the old token is never sent again (it used to go out three more times)');
    eq([seen.name, seen.abandoned], ['AbortError', true], '…and the caller gets an abort-style rejection — "gave up", the same shape as a request its caller cancelled — not a 503 to act on');
    eq(w.log.expired, 0, 'no "session expired" banner is raised at someone who signed out on purpose');
    ok(/Network GET \/bookings → ABANDONED/.test(w.errorLog()) && w.errorLog().indexOf('tok-A') === -1, 'the log says the request was abandoned — path and verb only, never the token');

    w = world();
    w.respond = () => netError();
    w.onBackoff = (n) => { if (n === 2) w.token = ''; }; // after the second failure this time
    seen = await run(w, '/events/77');
    eq([w.log.calls.length, seen.name], [2, 'AbortError'], 'a dropped connection is retried once, then the sign-out stops it: two requests, not four');

    w = world();
    w.respond = () => ({ status: 503 });
    w.onBackoff = (n) => { if (n === 1) w.token = 'tok-B'; }; // signed out and straight back in as someone else
    seen = await run(w, '/bookings');
    eq([w.log.calls.map((c) => c.auth), seen.name], [['Bearer tok-A'], 'AbortError'],
      'another account by the time the retry is due: not re-sent with the first member\'s token, and not re-sent as the second member either');

    w = world();
    w.respond = () => ({ status: 503 });
    w.onBackoff = (n) => { if (n === 1) { w.token = ''; } if (n === 2) { w.token = 'tok-A'; } };
    seen = await run(w, '/bookings');
    eq(w.log.calls.length, 1, 'the check is made BEFORE each retry: gone at the first one is gone — a token that comes back later does not revive the request');
  }

  t.section('Retry: what is NOT stopped');
  {
    let w = world({ token: '' });
    w.respond = () => ({ status: 503 });
    let seen = await run(w, '/instructors');
    eq([w.log.calls.length, w.log.calls.every((c) => c.auth === undefined), seen], [4, true, { status: 503 }],
      'a request that never carried a token (nothing to leak) is retried exactly as before');
    w = world({ token: '' });
    w.respond = () => ({ status: 503 });
    w.onBackoff = (n) => { if (n === 1) w.token = 'tok-B'; };
    await run(w, '/instructors');
    eq([w.log.calls.length, w.log.calls.every((c) => c.auth === undefined)], [4, true], '…also when someone signs in meanwhile: it still goes out without a credential');

    w = world();
    w.respond = () => ({ status: 503 });
    w.onBackoff = () => { w.token = ''; };
    seen = await run(w, '/bookings', { method: 'POST', body: '{"event_id":77,"slots":[7]}' });
    eq([w.log.calls.length, seen], [1, { status: 503 }], 'a POST is never retried in the first place: its one answer still reaches the caller');

    // fetchWithRetry by itself (no fourth argument) — every other caller.
    w = world();
    w.respond = () => netError();
    w.onBackoff = () => { w.token = ''; };
    let err = null;
    try { await w.sb.fetchWithRetry(BASE + '/x', {}); } catch (e) { err = e; }
    eq([w.log.calls.length, err && err.message], [4, 'Failed to fetch'], 'fetchWithRetry without a "still wanted?" check behaves as before');
    err = null;
    const asked = [];
    w = world();
    w.respond = () => netError();
    try { await w.sb.fetchWithRetry(BASE + '/x', {}, 3, () => { asked.push(w.log.calls.length); return asked.length < 2; }); } catch (e) { err = e; }
    eq([asked, w.log.calls.length, err && err.name], [[1, 2], 2, 'AbortError'], 'the check is asked before each RETRY (never before the first attempt) and its first "no" ends the request');
  }

  // ── The offline drain ────────────────────────────────────────────────────
  const queueCancelOffline = (w) => {
    w.nav.onLine = false;
    w.sb.queueOfflineCancel(77, ['A']);
    w.nav.onLine = true;
  };

  t.section('Offline queue: nobody signed in is told about "pending" actions');
  {
    // The brief's case: the queued cancel is between retries when the member signs out.
    let w = world();
    queueCancelOffline(w);
    w.respond = () => ({ status: 503 });
    w.onBackoff = (n) => { if (n === 1) w.sb.clearToken(); };
    await w.sb.processOfflineQueue('online');
    eq(w.log.calls.map((c) => c.method + ' ' + c.path + ' ' + c.auth), ['DELETE /bookings/A Bearer tok-A'], 'the DELETE goes out once; its retries die with the sign-out');
    eq([w.said(/still pending/), w.said(/could not be completed/)], [false, false], 'no "1 queued action still pending" toast lands on the signed-out screen (it used to)');
    eq(w.queue(), [], '…and the deliberate sign-out has emptied the queue once the run saved (whoever signs in next inherits nothing)');

    // A session that EXPIRES under the drain (401): kept for the sign-in that follows, said by the banner — not by a toast.
    w = world();
    queueCancelOffline(w);
    w.respond = () => ({ status: 401 });
    await w.sb.processOfflineQueue('online');
    eq([w.log.expired, w.queue().length, w.said(/still pending/)], [1, 1, false], 'a 401 mid-drain: the session banner speaks, the cancel stays queued, and no "still pending" toast is added on top');

    // Still signed in: the status toasts are exactly as they were.
    w = world();
    queueCancelOffline(w);
    w.respond = () => ({ status: 503 });
    await w.sb.processOfflineQueue('online');
    eq([w.log.calls.length, w.queue().length, w.said(/^1 queued action still pending$/)], [4, 1, true], 'signed in, Psycle failing: retried, kept, and "1 queued action still pending" as before');
    w = world();
    queueCancelOffline(w);
    w.respond = () => ({ status: 422 });
    await w.sb.processOfflineQueue('online');
    eq([w.queue(), w.said(/^1 queued action could not be completed$/)], [[], true], 'signed in, a definitive refusal: dropped and said, as before');
  }

  t.section('Offline queue: the status line is for a signed-in member only (source)');
  {
    const line = relSrc.slice(relSrc.indexOf('  function _renderQueueStatus() {'), relSrc.indexOf('  // ── When the queue drains ──'));
    ok(/var count = getBearerToken\(\) \? getOfflineQueue\(\)\.filter\(/.test(line), '"N changes waiting to sync" counts nothing while there is no token');
    ok(/PsycleEvents\.on\('auth:changed', function \(s\) \{[\s\S]*?_renderQueueStatus\(\);\s*\}\);/.test(relSrc), '…and it is repainted on every auth change');
  }
};
