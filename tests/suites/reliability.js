'use strict';
// The double-booking guards in js/reliability.js. A booking POST that times out
// may already have booked (and charged) server-side, so:
//   • the apiFetch wrapper never auto-retries a POST (GET / PUT / DELETE do),
//   • the offline-queue replay never re-sends a COUNT body (no-layout studio)
//     without first re-reading /bookings — a second send books another space,
//   • two 'online' events in a row replay the queue once.
// tests/suites/booking.js runs the replay's 409 decision table against a
// scripted apiFetch; tests/suites/offline.js runs fetchWithRetry's offline
// clamp. Here the WHOLE module is loaded into a fresh sandbox and driven through
// a counting fetch stub, so what is measured is the real chain: replay → the
// wrapper's per-method default / opts.retries → fetchWithRetry → fetch.
module.exports = async function (t) {
  const { ok, eq } = t;
  const relSrc = t.readSource('js/reliability.js');
  const BASE = 'https://api.test';

  // The sandbox clock runs the backoff delays at once but must never fire the
  // per-attempt abort timer by itself: that one is RECORDED (a scripted 'hang'
  // fires it). Read its length from source so the shim follows it. Exactly that
  // length, never ">=": a fifth backoff is 16s+, and a shim that swallowed it
  // left _backoff pending for good — the run drained and exited 0, unreported.
  const timeoutDecl = /const FETCH_TIMEOUT_MS = (\d+);/.exec(relSrc);
  ok(!!timeoutDecl, 'reliability.js declares FETCH_TIMEOUT_MS (the sandbox clock keys off it)');
  const ABORT_MS = timeoutDecl ? Number(timeoutDecl[1]) : 15000;

  const pureBooking = t.loadPure('js/app.js', 'booking'); // the REAL _bookingOutcome

  // One fresh world per scenario. `w.respond(call)` answers every fetch:
  // {status, body}, an Error to reject with, or 'hang' — a request that never
  // answers, so only its own abort timer can end it.
  function world() {
    const log = { calls: [], delays: [], abortTimers: [], signals: [], toasts: [], submits: [], expired: 0, refetches: 0, listeners: {} };
    const w = { log, store: t.makeFakeLocalStorage(), nav: { onLine: true }, respond: () => ({ status: 200, body: {} }), reread: null };
    const sb = {};
    sb.window = sb; // the global doubles as window, so window.apiFetch = … rebinds the bare apiFetch the replay calls
    sb.console = { log() {}, warn() {}, error() {} }; // pushError echoes every scripted failure
    sb.localStorage = w.store;
    sb.navigator = w.nav;
    sb.AbortController = AbortController;
    sb.setTimeout = (fn, ms) => {
      if (ms === ABORT_MS) { log.abortTimers.push({ fn, ms }); return 0; }
      log.delays.push(ms); fn(); return 0;
    };
    sb.clearTimeout = () => {};
    sb.addEventListener = (type, fn) => { log.listeners[type] = fn; };
    sb.apiUrl = (path) => BASE + path;
    sb.getBearerToken = () => 'tok-SECRET';
    sb.showSessionExpired = () => { log.expired++; };
    sb.toast = (msg, type) => { log.toasts.push({ msg, type }); };
    sb.fetchMyBookings = () => { log.refetches++; };
    sb.formatSlots = (label, slots) => label + ' ' + slots.join(' & ');
    sb.slotLabelForEvent = () => 'Bike';
    sb._myBookings = {};
    sb._bookingOutcome = pureBooking._bookingOutcome;
    // true only when a fresh /bookings snapshot was applied — app.js's contract.
    sb._rereadBookingsForVerify = async () => { if (!w.reread) return false; sb._myBookings = w.reread; return true; };
    sb.apiFetch = function baseApiFetch() { throw new Error('the unwrapped apiFetch must not be reached'); };
    sb.submitBooking = async function baseSubmitBooking(eventId, slots, btn, opts) {
      log.submits.push({ eventId, slots, opts, argc: arguments.length });
      btn.textContent = 'Booked ✓';
    };
    sb.fetch = (url, opts) => {
      opts = opts || {};
      const call = {
        method: String(opts.method || 'GET').toUpperCase(),
        path: String(url).indexOf(BASE) === 0 ? String(url).slice(BASE.length) : String(url),
        body: opts.body ? JSON.parse(opts.body) : undefined,
        auth: (opts.headers || {}).Authorization,
        hasSignal: !!opts.signal,
      };
      log.calls.push(call);
      log.signals.push(opts.signal); // beside `calls`, not on them: eq() serialises a call
      const r = w.respond(call);
      if (r instanceof Error) return Promise.reject(r);
      if (r === 'hang') {
        return new Promise((resolve, reject) => {
          const signal = opts.signal;
          if (signal && signal.aborted) { reject(abortError()); return; }
          // Each attempt arms its timer before it fetches. None armed for this
          // one = nothing would ever end the request: fail here, never hang.
          const timer = log.abortTimers[log.calls.length - 1];
          if (!signal || !timer) { reject(new Error('no abort timer armed')); return; }
          signal.addEventListener('abort', () => reject(abortError()), { once: true });
          setImmediate(timer.fn);
        });
      }
      return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => (r.body === undefined ? {} : r.body) });
    };
    t.vm.createContext(sb);
    t.vm.runInContext(relSrc, sb, { filename: 'js/reliability.js' });
    w.sb = sb;
    w.count = (method, path) => log.calls.filter((c) => c.method === method && (path === undefined || c.path === path)).length;
    w.seq = () => log.calls.map((c) => c.method + ' ' + c.path);
    w.queue = () => JSON.parse(w.store.getItem('psycle_offline_queue') || '[]');
    w.said = (re) => log.toasts.some((x) => re.test(x.msg));
    return w;
  }
  // The follow-up replay is started un-awaited. Everything in the sandbox is
  // promise-driven (its setTimeout is synchronous), so one macrotask boundary
  // drains it completely — a fixed number of microtask ticks does not.
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const netError = () => new TypeError('Failed to fetch');
  const abortError = () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; return e; };

  // ── The wrapper's retry policy ───────────────────────────────────────────
  t.section('apiFetch (js/reliability.js): a POST is never re-sent; idempotent verbs retry');
  {
    const w0 = world();
    ok(typeof w0.sb.fetchWithRetry === 'function' && w0.sb.apiFetch.name === 'apiFetchWithRetry' && w0.sb._originalApiFetch.name === 'baseApiFetch',
      'loading the module replaces apiFetch with the retrying wrapper and keeps the original');

    // → [fetches made, status seen (or the error message), backoff delays]
    const attempts = async (opts, answer) => {
      const w = world();
      w.respond = () => (typeof answer === 'number' ? { status: answer } : answer());
      let seen;
      try { seen = (await w.sb.apiFetch('/bookings', opts)).status; } catch (e) { seen = e.message; }
      return { n: w.log.calls.length, seen, w };
    };

    let r = await attempts({ method: 'POST', body: '{"event_id":77,"slots":[7]}' }, 503);
    eq([r.n, r.seen, r.w.log.delays], [1, 503, []], 'POST answered 503: ONE request, no backoff, and the caller is handed the 503 to deal with');
    eq((await attempts({ method: 'post' }, 503)).n, 1, 'a lower-case "post" is a POST too');
    r = await attempts(undefined, 503);
    eq([r.n, r.seen], [4, 503], 'GET answered 503: 1 + 3 retries');
    ok(r.w.log.delays.length === 3 && r.w.log.delays.every((ms, i) => ms >= 1000 * Math.pow(2, i) && ms < 1000 * Math.pow(2, i) + 500),
      '…backing off 1s, 2s, 4s (+ under 500ms of jitter): ' + r.w.log.delays.map((ms) => Math.round(ms)).join(', '));
    ok(r.w.log.calls.every((c) => c.hasSignal), '…and every attempt carries its own abort signal (a hung request cannot hold a button on "…")');
    eq([(await attempts({ method: 'DELETE' }, 503)).n, (await attempts({ method: 'PUT' }, 503)).n], [4, 4], 'DELETE and PUT retry like GET by default');

    eq((await attempts({ method: 'PUT', retries: 0 }, 503)).n, 1, 'opts.retries: 0 switches retries off for any verb (the waitlist join relies on it)');
    eq((await attempts({ retries: 1 }, 503)).n, 2, 'opts.retries: 1 → two attempts');
    eq((await attempts({ method: 'POST', retries: 3 }, 503)).n, 4, 'a POST retries only when the caller asks by name (the slot replay does)');

    eq((await attempts({ method: 'POST' }, netError)).seen, 'Failed to fetch', 'POST with the connection dropped: the failure reaches the caller…');
    eq((await attempts({ method: 'POST' }, netError)).n, 1, '…after ONE request');
    r = await attempts({ method: 'POST' }, abortError);
    eq([r.n, r.seen], [1, 'Request timed out'], 'POST that times out — it may have booked — is NOT sent again');
    eq([(await attempts(undefined, netError)).n, (await attempts(undefined, abortError)).n], [4, 4], 'a GET that drops or times out is retried');

    // The chain behind that claim, end to end: a request that never answers is
    // ended by ITS OWN timer → abort → "Request timed out" (a hand-made
    // AbortError above proves only the last link).
    const hang = () => 'hang';
    r = await attempts({ method: 'POST', body: '{"event_id":77,"slots":[7]}' }, hang);
    eq([r.n, r.seen, r.w.log.abortTimers.map((x) => x.ms)], [1, 'Request timed out', [ABORT_MS]],
      'a POST /bookings that hangs is cut off after ' + ABORT_MS / 1000 + 's by the attempt\'s own timer — the button comes off "…" — and is not sent again');
    r = await attempts(undefined, hang);
    eq([r.n, r.seen, r.w.log.abortTimers.length, new Set(r.w.log.signals).size], [4, 'Request timed out', 4, 4],
      'a GET that hangs: four attempts, each with a timer and a signal of ITS OWN (one shared controller is already aborted on the first retry: every retry dies at once)');
    const gone = new AbortController();
    gone.abort();
    r = await attempts({ signal: gone.signal }, hang);
    eq([r.n, r.seen], [1, 'The operation was aborted'], 'a request its CALLER cancelled is not a timeout: handed straight back, never retried');

    const fourXX = [];
    for (const [opts, status] of [[undefined, 404], [{ method: 'POST' }, 409], [{ method: 'POST', retries: 3 }, 409], [{ method: 'POST' }, 422], [{ method: 'DELETE' }, 403], [undefined, 429]]) {
      fourXX.push((await attempts(opts, status)).n);
    }
    eq(fourXX, [1, 1, 1, 1, 1, 1], 'a 4xx is an answer, never retried — not even a POST that opted into retries');
    eq((await attempts(undefined, 200)).n, 1, 'a 2xx is not repeated');

    r = await attempts({ method: 'POST' }, 503);
    const errorLog = r.w.store.getItem('psycle_error_log') || '';
    eq(r.w.log.calls[0].auth, 'Bearer tok-SECRET', 'the bearer token rides on the request…');
    ok(/Network POST \/bookings → 503/.test(errorLog) && errorLog.indexOf('tok-SECRET') === -1, '…and the failure is logged as verb + path + status, never the token');
    eq([(await attempts(undefined, 401)).w.log.expired, (await attempts(undefined, 403)).w.log.expired], [1, 0], '401 ends the session; 403 (a business-rule refusal) does not');
  }

  // ── No call site may quietly opt a POST back into retries ────────────────
  t.section('POST call sites: only the slot replay opts into retries');
  {
    const sites = [];
    t.fs.readdirSync(t.JS_DIR).filter((f) => f.endsWith('.js')).sort().forEach((file) => {
      const src = t.readSource('js/' + file);
      const re = /method:\s*['"]POST['"]/g;
      let m;
      while ((m = re.exec(src))) {
        // Walk out to both ends of the options object this key sits in.
        let end = m.index, depth = 1;
        while (end < src.length && depth > 0) { const ch = src[end++]; if (ch === '{') depth++; else if (ch === '}') depth--; }
        let start = m.index;
        depth = 1;
        while (start > 0 && depth > 0) { const ch = src[--start]; if (ch === '}') depth++; else if (ch === '{') depth--; }
        const found = /retries:\s*([^,\n}]+)/.exec(src.slice(start, end));
        sites.push({ at: file + ':' + src.slice(0, m.index).split('\n').length, file, retries: found ? found[1].trim() : null });
      }
    });
    ok(sites.length >= 4 && sites.some((s) => s.file === 'app.js') && sites.some((s) => s.file === 'reliability.js'),
      'the scan finds the POST call sites (' + sites.map((s) => s.at).join(', ') + ')');
    const replay = sites.filter((s) => s.file === 'reliability.js');
    eq(replay.map((s) => s.retries), ['bySlot ? 3 : 0'], 'the replay retries a SLOT body (a duplicate is a harmless 409 for the same seat) and never a COUNT body');
    const optedIn = sites.filter((s) => s.file !== 'reliability.js' && s.retries !== null && s.retries !== '0');
    eq(optedIn.map((s) => s.at + ' retries: ' + s.retries), [], 'every other POST leaves retries unset (→ the wrapper\'s 0) or says 0');
  }

  // ── Offline queue replay, through the real retry layer ───────────────────
  const FUTURE = { status: 200, body: { data: { start_at: '2099-01-01T10:00:00' } } };
  const spaceItem = { eventId: 77, slots: [], spaces: 1, timestamp: '2026-01-01T00:00:00.000Z' };
  const seatItem = { eventId: 77, slots: [7], spaces: 0, timestamp: '2026-01-01T00:00:00.000Z' };
  // `script`: post(call) / list(call) / del(call) / event(call) → {status, body} | Error.
  function replayWorld(items, script) {
    const w = world();
    w.unexpected = [];
    w.store.setItem('psycle_offline_queue', JSON.stringify(items));
    w.respond = (call) => {
      if (call.method === 'GET' && /^\/events\/\d+$/.test(call.path)) return script.event ? script.event(call) : FUTURE;
      if (call.method === 'POST' && call.path === '/bookings' && script.post) return script.post(call, w);
      if (call.method === 'GET' && call.path === '/bookings?limit=200' && script.list) return script.list(call);
      if (call.method === 'DELETE' && script.del) return script.del(call);
      w.unexpected.push(call.method + ' ' + call.path);
      return new Error('unscripted request');
    };
    return w;
  }

  t.section('Offline queue: a COUNT body is sent once, then /bookings decides — never a blind re-send');
  {
    // Booked offline at a no-layout studio, exactly as the app queues it.
    let w = replayWorld([], { post: () => netError(), list: () => ({ status: 200, body: { data: [{ id: 'A', event_id: 77 }] } }) });
    w.nav.onLine = false;
    const btn = { textContent: 'Book', className: 'book-btn', disabled: false };
    await w.sb.submitBooking(77, [], btn, { spaces: 1 });
    eq([w.log.calls.length, w.log.submits.length, btn.textContent, btn.disabled], [0, 0, 'Queued', true], 'offline: nothing is sent, the button reads "Queued"');
    eq(w.queue().map((i) => [i.eventId, i.slots, i.spaces]), [[77, [], 1]], '…and the queued item carries the space count');
    w.nav.onLine = true;
    await w.sb.processOfflineQueue();
    eq(w.seq(), ['GET /events/77', 'POST /bookings', 'GET /bookings?limit=200'], 'back online, the POST\'s answer is lost: ONE POST, then /bookings is read');
    eq(w.log.calls[1].body, { event_id: 77, slots: 1 }, '…and that POST carried a count (slots: 1), not a seat list');
    eq([w.queue(), w.said(/^1 queued booking confirmed!$/), w.log.refetches, w.unexpected], [[], true, 1, []], '/bookings shows the class → confirmed, off the queue, My Bookings refreshed');

    w = replayWorld([spaceItem], { post: () => ({ status: 503 }), list: () => ({ status: 200, body: { data: [{ id: 'Z', event_id: 5 }] } }) });
    await w.sb.processOfflineQueue();
    eq([w.count('POST'), w.count('GET', '/bookings?limit=200')], [1, 1], 'POST answered 503: still ONE POST (the wrapper\'s 5xx retries are off for a count)');
    eq([w.queue().length, w.said(/confirmed/), w.said(/1 queued action still pending/)], [1, false, true], '/bookings says it did NOT land → kept for the next reconnect, not called booked');
    await w.sb.processOfflineQueue();
    eq(w.seq(), ['GET /events/77', 'POST /bookings', 'GET /bookings?limit=200', 'GET /events/77', 'POST /bookings', 'GET /bookings?limit=200'],
      'the next reconnect may send it again — only because a /bookings read in between said it had not landed');

    w = replayWorld([spaceItem], { post: () => netError(), list: () => netError() });
    await w.sb.processOfflineQueue();
    eq([w.count('POST'), w.count('GET', '/bookings?limit=200')], [1, 4], 'answer lost AND /bookings unreachable (the read itself is retried): still one POST');
    eq([w.queue(), w.said(/confirmed!/), w.said(/Couldn't confirm whether a queued booking went through/)], [[], false, true],
      '…can\'t tell → dropped with "check My Bookings" rather than risk a second space');
    w = replayWorld([spaceItem], { post: () => netError(), list: () => ({ status: 500 }) });
    await w.sb.processOfflineQueue();
    eq([w.count('POST'), w.queue(), w.said(/Couldn't confirm/)], [1, [], true], '/bookings answering 500 is "can\'t tell" as well');
  }

  t.section('Offline queue: a SLOT body may retry (same seat → 409), and a 409 is an answer');
  {
    let w = replayWorld([seatItem], { post: () => ({ status: 503 }) });
    await w.sb.processOfflineQueue();
    eq([w.count('POST'), w.count('GET', '/bookings?limit=200'), w.queue().length], [4, 0, 1], 'POST answered 503: 1 + 3 tries (retries: 3 reaches fetchWithRetry), then kept for later');
    eq(w.log.calls[1].body, { event_id: 77, slots: [7] }, '…each carrying the seat list');

    w = replayWorld([seatItem], { post: () => ({ status: 409, body: { message: 'Slot taken' } }) });
    w.reread = { 77: { bookingId: 'A', bookingIds: ['A'], slots: [7], slotBookings: { 7: 'A' }, waitlisted: false } };
    await w.sb.processOfflineQueue();
    eq([w.count('POST'), w.queue(), w.said(/^1 queued booking confirmed!$/)], [1, [], true], '409 and /bookings shows bike 7: one POST, confirmed, off the queue');
    w = replayWorld([seatItem], { post: () => ({ status: 409, body: {} }) });
    w.reread = {};
    await w.sb.processOfflineQueue();
    eq([w.count('POST'), w.queue(), w.said(/confirmed!/), w.said(/taken while you were offline/)], [1, [], false, true], '409 and no seat in /bookings: one POST, "taken", never "confirmed"');

    w = replayWorld([seatItem], { post: () => ({ status: 201, body: { data: { id: 'B9' } } }) });
    await w.sb.processOfflineQueue();
    eq([w.count('POST'), w.queue(), w.sb._myBookings['77'].bookingId, w.sb._myBookings['77'].slots], [1, [], 'B9', [7]], 'a plain 2xx: booked once, recorded with the id the server returned');
  }

  t.section('Offline queue: replayed once per reconnect, and never for a class that has begun');
  {
    const extra = { eventId: 88, slots: [3], spaces: 0, timestamp: '2026-01-02T00:00:00.000Z' };
    // Event 88 is queued while 77's POST is in flight (once).
    const queuesAnother = {
      post: (call, world_) => {
        if (call.body.event_id === 77) world_.store.setItem('psycle_offline_queue', JSON.stringify(world_.queue().concat([extra])));
        return { status: 201, body: { data: { id: 'B' + call.body.event_id } } };
      },
    };
    const postsFor = (world_, id) => world_.log.calls.filter((c) => c.method === 'POST' && c.body.event_id === id).length;

    let w = replayWorld([seatItem], queuesAnother);
    const online = w.log.listeners.online;
    ok(typeof online === 'function', "the replay is what the window 'online' event runs");
    await Promise.all([online(), online(), online()]); // a flapping radio fires it in bursts
    await flush();
    eq(postsFor(w, 77), 1, "three 'online' events in a row: the queued booking is POSTed once");
    eq([postsFor(w, 88), w.queue()], [1, []], '…the run that was waiting picks up the booking queued meanwhile — once — and resurrects nothing');

    w = replayWorld([seatItem], queuesAnother);
    await w.sb.processOfflineQueue();
    await flush();
    eq([postsFor(w, 77), postsFor(w, 88), w.queue().map((i) => i.eventId)], [1, 0, [88]], 'a booking queued mid-replay survives the save at the end of the run (not lost, not yet sent)');

    w = replayWorld([seatItem, spaceItem], { event: () => ({ status: 200, body: { data: { start_at: '2020-01-01T10:00:00' } } }) });
    await w.sb.processOfflineQueue();
    eq([w.count('POST'), w.queue(), w.said(/^Skipped 2 queued bookings/)], [0, [], true], 'classes that have already started are skipped: no POST, no charge');
    w = replayWorld([seatItem], { event: () => ({ status: 404 }) });
    await w.sb.processOfflineQueue();
    eq([w.count('POST'), w.queue(), w.said(/^Skipped a queued booking/)], [0, [], true], 'a class that no longer exists is skipped too');
    w = replayWorld([seatItem], { event: () => netError() });
    await w.sb.processOfflineQueue();
    eq([w.count('POST'), w.queue().length], [0, 1], 'the class can\'t be checked at all: nothing is sent, the booking waits');
  }

  t.section('Offline queue: cancels, and what submitBooking queues');
  {
    const cancel = { type: 'cancel', eventId: 77, bookingIds: ['A', 'B'], timestamp: '2026-01-01T00:00:00.000Z' };
    let w = replayWorld([cancel], { del: (call) => ({ status: call.path === '/bookings/A' ? 204 : 404 }) });
    await w.sb.processOfflineQueue();
    eq([w.seq().sort(), w.queue(), w.said(/^1 queued cancel sent$/)], [['DELETE /bookings/A', 'DELETE /bookings/B'], [], true], 'a queued cancel DELETEs every record; one already gone (404) counts as done');
    w = replayWorld([cancel], { del: () => ({ status: 503 }) });
    await w.sb.processOfflineQueue();
    eq([w.count('DELETE'), w.queue().length], [8, 1], 'a 503 on a cancel IS retried (a repeat DELETE is harmless) and the cancel stays queued');

    w = world();
    w.nav.onLine = false;
    const btn = { textContent: 'Book', className: 'book-btn', disabled: false };
    await w.sb.submitBooking(77, ['7', '9'], btn);
    eq(w.queue().map((i) => [i.eventId, i.slots, i.spaces]), [[77, [7, 9], 0]], 'offline seat booking: slots queued as numbers, no space count');
    await w.sb.submitBooking(78, [], btn, { waitlist: true });
    eq([w.queue().length, w.log.submits.map((s) => [s.eventId, s.opts, s.argc])], [1, [[78, { waitlist: true }, 4]]], 'a waitlist join is never queued — it goes straight to the original, opts intact');
    w.nav.onLine = true;
    await w.sb.submitBooking(79, [4], btn, { spaces: 0 });
    eq([w.queue().length, w.log.submits.length, w.log.submits[1].argc, w.log.submits[1].opts], [1, 2, 4, { spaces: 0 }], 'online: nothing is queued and all four arguments reach the original through both wrappers');
  }
};
