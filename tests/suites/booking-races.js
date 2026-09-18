'use strict';
// Booking races + failure wording (wave 6b). Everything here runs the SHIPPED
// code, sliced out of source as tests/suites/booking.js does:
//   - the REAL bookClass with GETs the test lands in whatever order it likes —
//     two Book taps in flight must end with ONE picker, the latest tap's;
//   - the REAL describeCancelError / _friendlyError against the REAL
//     PsycleAPI.categorizeError (js/api-client.js loaded into the same context),
//     because the point of _friendlyError is where it refuses to follow it;
//   - the REAL cancel paths with a DELETE that throws;
//   - the REAL seat-map builders (bike picker + Settings → bike preferences)
//     fed a hostile layout label.
// These paths spend credits or decide whether a member is charged a no-show.
module.exports = async function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const settingsSrc = t.readSource('js/settings.js');
  const apiClientSrc = t.readSource('js/api-client.js');
  // Top-level functions in app.js open at column 0 and close with a bare "}".
  const grab = (src, opener, closer) => {
    const lines = src.split('\n');
    const from = lines.findIndex(l => l.startsWith(opener));
    if (from === -1) throw new Error('booking-races suite: cannot find "' + opener + '" (anchor moved?)');
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (to === -1) throw new Error('booking-races suite: unterminated "' + opener + '"');
    return lines.slice(from, to + 1).join('\n');
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  const tick = () => new Promise(r => setImmediate(r));
  const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  const okDetail = slots => ({ ok: true, status: 200, json: async () => ({ slots, data: {} }) });
  function btn(label, className) {
    const b = { textContent: label || 'Book', className: className || 'book-btn', disabled: false, dataset: {}, style: {} };
    b.classList = { contains: c => b.className.split(/\s+/).includes(c) };
    return b;
  }
  const RAW = /Load failed|Failed to fetch|timed out|HTTP \d{3}|is not a function|Cannot read/;

  // ── The real bookClass, two taps in flight ───────────────────────────────
  // A signed-in member whose bookings have loaded, so a tap goes straight to
  // GET /events/{id}. `gets[path]` is that request, left pending until the test
  // settles it. `o.context` declares _bookingContext (state.js makes it a bare
  // global in the app; booking.js / clash.js run bookClass WITHOUT it, which is
  // why the guard asks `typeof`). `o.pickerShown` = what #bikeModal's inline
  // display reads.
  const tapFns = [grab(appSrc, 'function _busyLabel('), grab(appSrc, 'function describeCancelError('),
    grab(appSrc, 'function _friendlyError('), grab(appSrc, 'async function bookClass(')].join('\n');
  function raceWorld(o) {
    o = o || {};
    const log = { pickers: [], toasts: [], gets: [], restored: [], confirms: [] };
    const gets = {};
    const modal = { style: { display: o.pickerShown || 'none' } };
    const nav = { onLine: o.online !== false };
    const globals = {
      _myBookings: clone(o.bookings || {}), currentUser: { id: 1 }, _eventCache: {},
      _studioMap: { 4: { has_layout: true, name: 'Studio 1', layout: { slots: [{ id: 7 }, { id: 9 }, { id: 11 }] } } },
      window: {}, navigator: nav,
      console: { log() {}, warn() {}, info() {}, error: console.error },
      setTimeout: () => 0, clearTimeout: () => {},
      document: { getElementById: id => (id === 'bikeModal' ? modal : null) },
      getBearerToken: () => 'tok', openLoginPopup: () => {},
      confirmModal: async c => { log.confirms.push(c.title); return false; },
      toast: (msg, type) => log.toasts.push({ msg, type }),
      apiFetch: (path, opts) => { log.gets.push([path, opts && opts.retries]); return (gets[path] = deferred()).promise; },
      showBikePicker: (id, b) => { log.pickers.push(id); if (o.context) ctx._bookingContext = { eventId: id, btn: b }; modal.style.display = 'flex'; },
      submitBooking: async () => { throw new Error('booking-races suite: nothing here may POST'); },
      leaveWaitlist: async () => {}, confirmJoinWaitlist: async () => {},
      slotLabelForEvent: () => 'Bike', _waitlistClassLine: () => '', _parseSlots: x => x,
      _clearUnverifiedBooking: async () => true,
      _clashFor: () => null, _clashLabel: () => '',
      applyBookedState: (b, id, booking) => { log.restored.push(id); b.textContent = 'Bike ' + booking.slots.join(' & ') + ' ✓'; },
    };
    const ctx = t.vm.createContext(globals);
    t.vm.runInContext(apiClientSrc, ctx, { filename: 'api-client.js' }); // → window.PsycleAPI, the real categorizeError
    t.vm.runInContext("var _bookingsLoadState = 'loaded'; var MAX_SEATS = 2;\n" +
      (o.context ? 'var _bookingContext = ' + JSON.stringify(o.context === true ? null : o.context) + ';\n' : '') + tapFns, ctx);
    return { ctx, log, gets, modal, nav };
  }
  const held7 = { 101: { bookingId: 'Z', bookingIds: ['Z'], slots: [7], slotBookings: { 7: 'Z' }, waitlisted: false } };
  // The race as it happens: class 101's GET is already IN FLIGHT when the
  // member gives up waiting and taps class 202.
  async function twoTaps(w, a, b) {
    const pa = w.ctx.bookClass(101, a, 4);
    await tick();
    const pb = w.ctx.bookClass(202, b, 4);
    await tick();
    return [pa, pb];
  }

  t.section('Book: two taps in flight — only the LATEST opens a picker');
  ok(/const mySeq = bookClass\._seq = /.test(tapFns) && !/_dialogOpen\(\)/.test(grab(appSrc, 'async function bookClass(')),
    'the guard is a property on bookClass (slice-safe) and never asks _dialogOpen() — confirmModal leaves its overlay up 180ms after "Book anyway"');
  {
    // Psycle is slow: the 7:00 (101) is tapped, nothing seems to happen, so the
    // 8:00 (202) is tapped. 202 answers first, THEN 101.
    const w = raceWorld();
    const a = btn(), b = btn();
    const [pa, pb] = await twoTaps(w, a, b);
    eq(w.log.gets, [['/events/101', 1], ['/events/202', 1]], 'both GETs are out (retries:1 — the default three hold a tap on "…" for over a minute)');
    eq([a.textContent, a.disabled, b.textContent, b.disabled], ['…', true, '…', true], 'both buttons are busy');
    w.gets['/events/202'].resolve(okDetail([9, 11]));
    await pb;
    eq(w.log.pickers, [202], 'the class tapped LAST opens its picker');
    w.gets['/events/101'].resolve(okDetail([9, 11]));
    await pa;
    eq(w.log.pickers, [202], 'the earlier class landing afterwards does NOT take the picker over (the old code swapped the 8:00 map for the 7:00, usual bike pre-selected, Confirm live)');
    eq([a.textContent, a.disabled, !!a.dataset.busy], ['Book', false, false], 'the earlier button is handed back: its label, enabled, busy flag released');
    eq(w.log.toasts, [], 'and quietly — a toast would land on the class the member has moved on to');
  }
  {
    // Overtaken before it got as far as its GET (the second tap lands while the
    // first is still checking for an unverified booking): no request at all.
    const w = raceWorld();
    const a = btn(), b = btn();
    const pa = w.ctx.bookClass(101, a, 4);
    const pb = w.ctx.bookClass(202, b, 4);
    await pa;
    eq([w.log.gets, a.textContent, a.disabled, !!a.dataset.busy], [[['/events/202', 1]], 'Book', false, false],
      'a tap overtaken before its GET never sends it, and its button is handed straight back');
    w.gets['/events/202'].resolve(okDetail([9, 11]));
    await pb;
    eq([w.log.pickers, w.log.toasts], [[202], []], '…the latest tap carries on alone');
  }
  {
    // The other order: the earlier class answers FIRST. It was still overtaken.
    const w = raceWorld();
    const a = btn(), b = btn();
    const [pa, pb] = await twoTaps(w, a, b);
    w.gets['/events/101'].resolve(okDetail([9, 11]));
    await pa;
    eq([w.log.pickers, a.textContent, a.disabled], [[], 'Book', false], 'the earlier tap answering first still opens nothing: the member has tapped another class since');
    w.gets['/events/202'].resolve(okDetail([9, 11]));
    await pb;
    eq(w.log.pickers, [202], 'the latest tap gets its picker');
  }
  {
    // The overtaken class is one the member HOLDS ("Bike 7 ✓" → manage it).
    const w = raceWorld({ bookings: held7 });
    const a = btn('Bike 7 ✓', 'book-btn booked'), b = btn();
    const [pa, pb] = await twoTaps(w, a, b);
    w.gets['/events/202'].resolve(okDetail([9, 11]));
    w.gets['/events/101'].resolve(okDetail([9, 11]));
    await Promise.all([pa, pb]);
    eq([w.log.pickers, a.textContent, a.disabled], [[202], 'Bike 7 ✓', false], 'a held class is put back as HELD (applyBookedState) — never as "Book"');
    eq(w.log.restored, [101], '…through applyBookedState, which also re-wires its onclick');
  }
  {
    // "+ Add spot" on My Bookings is not a card button: its own label comes back.
    const w = raceWorld({ bookings: held7 });
    const a = btn('+ Add spot', 'booking-action-btn'), b = btn();
    const [pa, pb] = await twoTaps(w, a, b);
    w.gets['/events/202'].resolve(okDetail([9, 11]));
    w.gets['/events/101'].resolve(okDetail([9, 11]));
    await Promise.all([pa, pb]);
    eq([a.textContent, a.disabled, w.log.restored], ['+ Add spot', false, []], 'a button that is not a .book-btn gets the label it was tapped on (not "Book", not a card\'s booked state)');
  }
  {
    // The overtaken GET fails outright.
    const w = raceWorld();
    const a = btn(), b = btn();
    const [pa, pb] = await twoTaps(w, a, b);
    w.gets['/events/202'].resolve(okDetail([9, 11]));
    await pb;
    w.gets['/events/101'].reject(new TypeError('Load failed'));
    await pa;
    eq([w.log.pickers, w.log.toasts, a.textContent, a.disabled, !!a.dataset.busy], [[202], [], 'Book', false, false],
      'an overtaken tap that FAILS is silent too, and its button is live again');
  }
  {
    const w = raceWorld();
    const a = btn();
    const pa = w.ctx.bookClass(101, a, 4);
    await tick();
    w.gets['/events/101'].resolve(okDetail([9, 11]));
    await pa;
    eq([w.log.pickers, a.textContent, a.disabled], [[101], 'Book', false], 'one tap on its own is untouched: picker opens, button live behind it');
    // …and the NEXT tap is not "overtaken" by that finished one.
    const b = btn();
    w.modal.style.display = 'none';
    const pb = w.ctx.bookClass(202, b, 4);
    await tick();
    w.gets['/events/202'].resolve(okDetail([9, 11]));
    await pb;
    eq(w.log.pickers, [101, 202], 'a later tap, after the first settled, books as normal');
  }
  {
    // Not a race, the same hand-back: "Bike 7 ✓" opens the "Your booking" sheet.
    // Nothing restores the card when that sheet is simply closed again.
    const w = raceWorld({ bookings: held7 });
    const a = btn('Bike 7 ✓', 'book-btn booked');
    const pa = w.ctx.bookClass(101, a, 4);
    await tick();
    w.gets['/events/101'].resolve(okDetail([9, 11]));
    await pa;
    eq([w.log.pickers, a.textContent, a.disabled], [[101], 'Bike 7 ✓', false], 'a held class still reads as held BEHIND its picker (it was left on "Book": close the sheet and the card offered a booking the member already had)');
  }

  t.section('Book: a picker somebody else opened meanwhile is never replaced — and a closed one never blocks');
  {
    // Change spot (window.changeSpot → showBikePicker, never through bookClass)
    // opened its picker while this tap's GET was in flight.
    const w = raceWorld({ context: true });
    const a = btn();
    const pa = w.ctx.bookClass(101, a, 4);
    await tick();
    w.ctx._bookingContext = { eventId: 555, btn: null };
    w.modal.style.display = 'flex';
    w.gets['/events/101'].resolve(okDetail([9, 11]));
    await pa;
    eq([w.log.pickers, a.textContent, a.disabled, w.log.toasts], [[], 'Book', false, []], 'the open picker stays: a swap\'s context + Confirm must not be swapped for another class under the member\'s thumb');
  }
  {
    // A context left behind with the picker CLOSED (a picker that failed to
    // open) must not read as "overtaken" for ever — no class could be booked.
    const w = raceWorld({ context: { eventId: 555, btn: null }, pickerShown: 'none' });
    const a = btn();
    const pa = w.ctx.bookClass(101, a, 4);
    await tick();
    w.gets['/events/101'].resolve(okDetail([9, 11]));
    await pa;
    eq(w.log.pickers, [101], 'judged by what is on screen: a stale context with no picker showing blocks nothing');
    // Same event, picker already showing for it (the tap that opened it).
    const w2 = raceWorld({ context: true });
    const pa2 = w2.ctx.bookClass(101, btn(), 4);
    await tick();
    w2.gets['/events/101'].resolve(okDetail([9, 11]));
    await pa2;
    eq(w2.log.pickers, [101], 'with _bookingContext declared (as in the app) a plain tap still opens its picker');
  }

  t.section('Book: a class-sheet tap that had to wait for its class does not overtake a LATER tap');
  {
    // The sheet's booked button of a seat painted from saved details waits for
    // that class to be re-read (up to 10s) BEFORE bookClass runs — so before it
    // takes a sequence number. The REAL bookClass, _classDetailBookAction and
    // _ensureStudioKnown together: sheet tap on 101, then Book on 202.
    const sheetFns = [grab(appSrc, 'function _studioNeedsReread('), grab(appSrc, 'function _ensureStudioKnown('), grab(appSrc, 'function _pickerTakenSince('),
      grab(appSrc, 'async function _classDetailBookAction(')].join('\n');
    const sheetRace = () => {
      const w = raceWorld({ bookings: held7 });
      w.ctx._eventCache[101] = { id: 101, studio_id: 4, _fromSnapshot: true };
      w.ctx.document.querySelector = () => null;
      w.ctx.document.createElement = () => btn('');
      w.reread = deferred();
      w.ctx._hydrateEventDetails = () => w.reread.promise;
      w.ctx.confirmUnbook = () => { throw new Error('a layout seat opens the picker, not the cancel dialog'); };
      t.vm.runInContext('var BOOKING_VERIFY_DEADLINE_MS = 10000; var _studioRereads = {}; var _sheetActionBusy = {};\n' + sheetFns, w.ctx);
      w.rereadLands = () => { w.ctx._eventCache[101] = { id: 101, studio_id: 4 }; w.reread.resolve(); };
      return w;
    };
    let w = sheetRace();
    const pa = w.ctx._classDetailBookAction(101);
    await tick();
    const b = btn();
    const pb = w.ctx.bookClass(202, b, 4); // "+ Add spot" / Book on another class meanwhile
    await tick();
    w.rereadLands();
    await pa;
    eq(w.log.gets, [['/events/202', 1]], '101\'s re-read lands after 202 was tapped: 101 stands down — bookClass(101) never runs (it used to take the HIGHER number)');
    w.gets['/events/202'].resolve(okDetail([9, 11]));
    await pb;
    eq([w.log.pickers, b.textContent, b.disabled, w.log.toasts.filter(x => x.type === 'error')], [[202], 'Book', false, []],
      'the LATEST tap gets its picker (202 was put back silently and 101\'s "Your booking" opened instead)');
    // On its own the sheet's tap is untouched.
    w = sheetRace();
    const p1 = w.ctx._classDetailBookAction(101);
    await tick();
    w.rereadLands();
    await tick();
    w.gets['/events/101'].resolve(okDetail([9, 11]));
    await p1;
    eq(w.log.pickers, [101], 'nothing tapped meanwhile: the re-read lands and 101\'s picker opens, as before');
  }

  t.section('Book: a failed tap says something a member can act on');
  for (const [what, err, want] of [
    ['iPhone, weak signal', new TypeError('Load failed'), /offline|connection/i],
    ['Chrome, weak signal', new TypeError('Failed to fetch'), /offline|connection/i],
    ['the 15s timeout', new Error('Request timed out'), /took too long/i],
  ]) {
    const w = raceWorld();
    const a = btn();
    const pa = w.ctx.bookClass(101, a, 4);
    await tick();
    w.gets['/events/101'].reject(err);
    await pa;
    eq(w.log.toasts.length, 1, what + ': one toast');
    ok(want.test(w.log.toasts[0].msg) && !RAW.test(w.log.toasts[0].msg) && w.log.toasts[0].type === 'error', what + ': member wording, never the raw "' + err.message + '" (got "' + w.log.toasts[0].msg + '")');
    eq([a.textContent, a.disabled, !!a.dataset.busy], ['Book', false, false], what + ': the button is live again');
  }
  {
    const w = raceWorld();
    const a = btn();
    const pa = w.ctx.bookClass(101, a, 4);
    await tick();
    w.gets['/events/101'].resolve({ ok: false, status: 503, json: async () => ({}) });
    await pa;
    ok(/servers are having trouble/.test(w.log.toasts[0].msg) && !RAW.test(w.log.toasts[0].msg), 'a 5xx reads as Psycle\'s trouble, not "HTTP 503" (got "' + w.log.toasts[0].msg + '")');
    const w2 = raceWorld();
    const pa2 = w2.ctx.bookClass(101, btn(), 4);
    await tick();
    w2.gets['/events/101'].resolve({ ok: false, status: 403, json: async () => ({}) });
    await pa2;
    eq(w2.log.toasts.map(x => x.msg), ["Couldn't open this class — try again"], 'a 403 is NOT "your session expired" (categorizeError says auth; a 403 here is a refusal inside a live session) → the plain fallback');
  }

  // ── Wording table: the REAL helpers over the REAL categorizeError ─────────
  function wordWorld(online, api) {
    const nav = { onLine: online };
    const ctx = t.vm.createContext({ window: {}, navigator: nav, console });
    t.vm.runInContext(apiClientSrc, ctx, { filename: 'api-client.js' });
    if (api !== undefined) ctx.window.PsycleAPI = api;
    t.vm.runInContext(grab(appSrc, 'function describeCancelError(') + '\n' + grab(appSrc, 'function _friendlyError('), ctx);
    return ctx;
  }
  const OFFLINE = "You're offline — nothing was cancelled. Try again once you're back online.";
  const UNSURE = "Couldn't reach Psycle — this may not have been cancelled. Check My Bookings and try again.";

  t.section('Cancel wording: never a retry nobody will make, never the raw error');
  {
    const on = wordWorld(true), off = wordWorld(false);
    for (const e of [new TypeError('Load failed'), new TypeError('Failed to fetch'), new Error('Request timed out'),
      new Error('NetworkError when attempting to fetch resource.'), new TypeError('x is not a function'), new Error('')]) {
      eq(on.describeCancelError(null, null, e), UNSURE, 'online, "' + e.message + '" → may have landed (a DELETE is re-sent 3×): hedged, and points at My Bookings');
    }
    eq(off.describeCancelError(null, null, new TypeError('Load failed')), OFFLINE, 'offline → the one attempt never left the phone: nothing was cancelled');
    eq(off.describeCancelError(null, null, new Error('Request timed out')), OFFLINE, 'offline wins whatever the error says');
    eq(off.describeCancelError(null, null, new TypeError('Load failed'), true), UNSURE, 'offline NOW but online when the DELETE went out (4th arg) → it may have landed: hedged, never "nothing was cancelled"');
    eq(off.describeCancelError(null, null, new TypeError('Load failed'), false), OFFLINE, '…offline at send too → nothing left the phone');
    for (const ctx of [on, off]) {
      for (const e of [new TypeError('Load failed'), new TypeError('Failed to fetch'), new Error('Request timed out')]) {
        const msg = ctx.describeCancelError(null, null, e);
        ok(!/we'll retry|will retry|queued/i.test(msg), 'no path that reaches this branch queues anything — "' + msg + '" promises no retry');
        ok(!RAW.test(msg), '…and carries no developer text');
      }
    }
    const res = status => ({ status });
    eq(on.describeCancelError(res(401), {}), 'Session expired — sign in and try again.', '401 unchanged');
    eq(on.describeCancelError(res(403), { message: 'Too late to cancel' }), 'Too late to cancel', "Psycle's own reason still wins");
    eq(on.describeCancelError(res(403), {}), "Psycle wouldn't allow this cancellation (it may be inside the late-cancel window).", '403 with no reason unchanged (a policy refusal, not a dead session)');
    eq(on.describeCancelError(res(500), {}), "Psycle couldn't cancel this just now — check My Bookings.", 'a bare status is a sentence now, not "Cancel failed (500)" — and carries no status code (that is the error log\'s)');
    // Psycle's 500 answers {"message":"Server Error"} — a framework's stock body,
    // and it was the whole toast. The POST side filtered it; the cancel side did not.
    for (const [status, message] of [[500, 'Server Error'], [500, 'server error.'], [500, ' Internal Server Error '], [503, 'Service Unavailable'],
      [502, 'Bad Gateway'], [504, 'Gateway Timeout'], [504, 'Gateway Time-out'], [500, 'Error']]) {
      eq(on.describeCancelError(res(status), { message }), "Psycle couldn't cancel this just now — check My Bookings.", status + ' "' + message + '" → the stock body is not a reason: the hedged line, pointing at My Bookings');
    }
    eq(on.describeCancelError(res(500), { message: 'SQLSTATE[23000]: Integrity constraint violation' }), "Psycle couldn't cancel this just now — check My Bookings.", "a 5xx's text is never the toast, stock or not — it says nothing of whether the DELETE landed");
    eq(on.describeCancelError(res(422), { message: 'This class has already started' }), 'This class has already started', "a refusal's own reason (422) still shows");
    eq(on.describeCancelError(res(422), { message: 'Server Error' }), "Psycle couldn't cancel this just now — check My Bookings.", 'a stock body is no reason on a 4xx either');
    eq(on.describeCancelError(res(403), { message: 'Error.' }), "Psycle wouldn't allow this cancellation (it may be inside the late-cancel window).", '…and a 403 carrying one falls to the 403 wording');
    eq(on.describeCancelError(res(422), { message: { code: 7 } }), "Psycle couldn't cancel this just now — check My Bookings.", 'a message that is not text is never toasted ("[object Object]")');
  }

  t.section('_friendlyError: follows categorizeError only where it can be trusted');
  {
    const FB = 'FALLBACK';
    const on = wordWorld(true), off = wordWorld(false);
    const M = on.window.PsycleAPI.categorizeError;
    const server = M(new Error('HTTP 503')).userMessage, timeout = M(new Error('Request timed out')).userMessage,
      rate = M(new Error('HTTP 429')).userMessage, network = M(new TypeError('Failed to fetch')).userMessage;
    ok(server && timeout && rate && network && new Set([server, timeout, rate, network]).size === 4, 'the real categorizeError is loaded (four distinct messages)');
    for (const [e, want, why] of [
      [new Error('HTTP 500'), server, 'a 5xx thrown as `new Error("HTTP 500")`'],
      [new Error('HTTP 503'), server, '503'],
      [new Error('HTTP 429'), rate, 'rate limit'],
      [new Error('Request timed out'), timeout, "fetchWithRetry's timeout"],
      [new TypeError('Load failed'), network, "WebKit's fetch failure (the raw toast on iPhone)"],
      [new TypeError('Failed to fetch'), network, "Chrome's"],
      [new TypeError('NetworkError when attempting to fetch resource.'), network, "Firefox's"],
      [new TypeError("Cannot read properties of undefined (reading 'slots')"), FB, 'a bug in OUR code is a TypeError too — categorizeError calls it "offline"; the member\'s signal is not to blame'],
      [new Error('HTTP 403'), FB, 'a 403 is a policy refusal inside a live session — never "session expired"'],
      [new Error('HTTP 401'), FB, 'a 401 has its own global banner'],
      [new Error('HTTP 422'), FB, 'a plain client error'],
      [new Error('Unexpected token < in JSON at position 0'), FB, 'a schema/parse fault'],
      [new Error('something odd'), FB, 'unknown'],
      [null, FB, 'nothing thrown at all'],
    ]) {
      eq(on._friendlyError(e, FB), want, (e ? '"' + e.message + '"' : 'null') + ' → ' + why);
    }
    eq(off._friendlyError(new TypeError("Cannot read properties of undefined (reading 'slots')"), FB), network, 'really offline → saying so is true whatever was thrown');
    eq(wordWorld(true, null)._friendlyError(new Error('HTTP 503'), FB), FB, 'api-client.js not loaded (it loads last) → the fallback, no throw');
    eq(wordWorld(true, { categorizeError() { throw new Error('boom'); } })._friendlyError(new Error('HTTP 503'), FB), FB, 'a categorizeError that throws → the fallback');
    eq(wordWorld(true, { categorizeError: () => ({ type: 'server' }) })._friendlyError(new Error('HTTP 503'), FB), FB, 'a category with no message → the fallback, never "undefined"');
  }

  t.section('Failure toasts on the booking / waitlist / swap paths carry no raw error text');
  for (const opener of ['async function bookClass(', 'async function joinWaitlist(', 'async function leaveWaitlist(', 'async function claimWaitlistSpot(',
    'async function executeSpotSwap(', 'async function rebookNextWeek(', 'async function cancelBikeSlot(', 'async function confirmUnbook(',
    'async function upcomingCancel(', 'async function upcomingSeatCancel(']) {
    const fn = grab(appSrc, opener);
    // (leaveWaitlist still READS e.message — to tell a dropped connection from
    // anything else. What must be gone is a `.message` used as the wording.)
    ok(!/(toast|fail|failRetryable)\([^\n]*\b(e|err|bookErr)\.message/.test(fn) && !/\.message\) \|\| "Couldn't/.test(fn) && !/bookErr \? bookErr\.message/.test(fn),
      opener.replace(/^async function |\($/g, '') + ': no `.message` reaches a toast');
  }
  ok(!/\+ e\.message/.test(grab(appSrc, 'window.changeSpot = async function(eventId) {', '};')), 'changeSpot: "Failed to load spots: " + e.message is gone');

  // ── The real cancel paths with a DELETE that throws ──────────────────────
  const cancelFns = ['function _busyLabel(', 'function describeCancelError(', 'function _scheduleBookingsRefetch(', 'async function _rereadBookingsForVerify(',
    'function _dropBookingKeepPlace(', 'function _bookingIdsFor(', 'async function _readyForWholeCancel(', 'async function cancelBikeSlot(',
    'async function confirmUnbook(', 'async function upcomingCancel(', 'async function upcomingSeatCancel(']
    .map(o => grab(appSrc, o)).join('\n');
  function cancelWorld(o) {
    const log = { deletes: [], toasts: [], timers: [], queued: [], events: [], listeners: [], fetches: 0 };
    const els = {};
    const globals = {
      _myBookings: clone(o.bookings), navigator: { onLine: o.online !== false },
      console: { log() {}, warn() {}, error: console.error },
      setTimeout: (fn, ms) => { log.timers.push(ms); return log.timers.length; }, clearTimeout: () => {},
      document: { getElementById: id => els[id] || (els[id] = { textContent: '' }), querySelector: () => null },
      getBearerToken: () => 'tok',
      confirmCancelWithPolicy: async () => true,
      // dropAfterSend: the DELETE goes out online, the signal is gone by the time it fails.
      // answer(path): the DELETE is ANSWERED (a 5xx, a refusal) instead of throwing.
      apiFetch: async (path, opts) => { log.deletes.push(opts.method + ' ' + path); if (o.dropAfterSend) globals.navigator.onLine = false; if (o.answer) return o.answer(path); throw o.error; },
      toast: (msg, type) => log.toasts.push({ msg, type }),
      slotLabelForEvent: () => 'Bike', leaveWaitlist: async () => {},
      queueOfflineCancel: (id, ids) => log.queued.push(ids),
      PsycleEvents: { emit: name => log.events.push(name) },
      _noteLocalBookingWrite: () => {}, _markSeatFreed: () => {}, _syncCardButtonsForEvent: () => {},
      _afterCardCancel: () => {}, refreshUpcomingPanel: () => {}, applyBookedState: () => {},
      fetchMyBookings: async () => { log.fetches++; return false; },
    };
    // Only the sent-online-then-dropped branch reaches for `window`.
    if (o.dropAfterSend) globals.window = { addEventListener: (type, fn, opts) => log.listeners.push({ type, fn, once: !!(opts && opts.once) }) };
    const ctx = t.loadPure('js/app.js', 'booking', globals);
    t.vm.runInContext('var _bookingsRefetchTimer = null; var BOOKING_VERIFY_DEADLINE_MS = 10000;\n' + cancelFns, ctx);
    return { ctx, log, els };
  }
  const seats57 = { 77: { bookingId: 'A', bookingIds: ['A', 'B'], slots: [5, 7], slotBookings: { 5: 'A', 7: 'B' }, waitlisted: false } };
  const chip = () => ({ textContent: '×', disabled: false, closest: () => null });

  t.section('Cancel: a DELETE that throws — truthful toast, /bookings re-read, nothing invented');
  for (const [name, run] of [
    ['the My Bookings seat ×', w => w.ctx.upcomingSeatCancel(77, 7, chip())],
    ['the picker\'s own seat', w => w.ctx.cancelBikeSlot(7, 77)],
  ]) {
    let w = cancelWorld({ bookings: seats57, error: new TypeError('Load failed') });
    await run(w);
    eq(w.log.deletes, ['DELETE /bookings/B'], name + ': that seat\'s own record was tried');
    eq(w.log.toasts.map(x => x.msg), [UNSURE], name + ', online: hedged (the re-sent DELETE may have landed) — not "Load failed", not "we\'ll retry"');
    ok(w.log.timers.includes(1500), name + ', online: /bookings is re-read, so the card ends up showing what Psycle holds');
    eq([w.log.queued, w.ctx._myBookings[77].slots], [[], [5, 7]], name + ': nothing queued, local state untouched');

    w = cancelWorld({ bookings: seats57, error: new TypeError('Load failed'), online: false });
    await run(w);
    eq(w.log.toasts.map(x => x.msg), [OFFLINE], name + ', offline: told nothing was cancelled (the old toast promised a retry that per-seat cancels never queue — the seat stayed booked, and charged)');
    eq([w.log.queued, w.log.timers.includes(1500)], [[], false], name + ', offline: nothing queued, and no re-read that could only fail');

    // Online when the DELETE went out, offline by the time it failed (wifi lost,
    // the tube): the seat may be gone server-side — possibly a late-cancel charge.
    w = cancelWorld({ bookings: seats57, error: new TypeError('Load failed'), dropAfterSend: true });
    await run(w);
    eq(w.log.toasts.map(x => x.msg), [UNSURE], name + ', signal lost AFTER the DELETE left: hedged — it asserted "nothing was cancelled"');
    eq([w.log.timers, w.log.listeners.map(l => [l.type, l.once])], [[], [['online', true]]], name + ': no re-read that could only fail now — one is armed for the moment the connection is back');
    w.log.listeners[0].fn();
    eq(w.log.timers, [400], name + ': …back online → /bookings is re-read, so the card shows what Psycle holds');
  }
  for (const [name, run] of [
    ['"Cancel all"', (w, b) => w.ctx.upcomingCancel(77, b)],
    ['the Discover card', (w, b) => w.ctx.confirmUnbook('A', 77, b)],
  ]) {
    const w = cancelWorld({ bookings: seats57, error: new Error('Request timed out') });
    const b = { textContent: 'Cancel all 2', disabled: false };
    await run(w, b);
    eq(w.log.toasts.map(x => x.msg), [UNSURE], name + ', online timeout: hedged — never "You\'re offline" while online, never "Request timed out"');
    ok(w.log.timers.includes(1500) && b.disabled === false, name + ': /bookings is re-read and the button is live again');
    eq([w.log.queued, w.log.events], [[], []], name + ': not queued (online), nothing announced as cancelled');
    // Offline, these two DO queue — and say so themselves; that stays.
    const off = cancelWorld({ bookings: seats57, error: new TypeError('Load failed'), online: false });
    await run(off, { textContent: 'Cancel all 2', disabled: false });
    eq([off.log.queued, off.log.toasts.map(x => x.msg)], [[['A', 'B']], ["You're offline — cancel queued. We'll send it when you're back online."]], name + ', offline: still queued — the only path that may promise a retry, because reliability.js\'s queue really replays it');
  }

  // ── …and with a DELETE that is ANSWERED with a 5xx ───────────────────────
  // Psycle's 500 body is {"message":"Server Error"}: that was the whole toast.
  // A DELETE is re-sent up to three times, so a 5xx can follow one that landed.
  const answers = (status, body) => () => ({ ok: false, status, json: async () => body });
  const SERVER_FAULT = "Psycle couldn't cancel this just now — check My Bookings.";
  const cancelPaths = [
    ['the My Bookings seat ×', w => w.ctx.upcomingSeatCancel(77, 7, chip())],
    ['the picker\'s own seat', w => w.ctx.cancelBikeSlot(7, 77)],
    ['"Cancel all"', w => w.ctx.upcomingCancel(77, { textContent: 'Cancel all 2', disabled: false })],
    ['the Discover card', w => w.ctx.confirmUnbook('A', 77, { textContent: 'Bike 5 & 7 ✓', disabled: false })],
  ];

  t.section('Cancel: a DELETE answered 5xx — never the raw "Server Error", and /bookings is re-read');
  for (const [name, run] of cancelPaths) {
    let w = cancelWorld({ bookings: seats57, answer: answers(500, { message: 'Server Error' }) });
    await run(w);
    eq(w.log.toasts, [{ msg: SERVER_FAULT, type: 'error' }], name + ': the member wording — it toasted "Server Error"');
    ok(w.log.timers.includes(1500), name + ': the toast says "check My Bookings", so /bookings is re-read (the cancel may have landed)');
    eq([w.ctx._myBookings[77].slots, w.log.queued, w.log.events.filter(e => /cancelled$/.test(e))], [[5, 7], [], []], name + ': local state untouched, nothing queued, nothing announced as cancelled');

    // A refusal is an answer: its reason shows, and nothing needs re-reading.
    w = cancelWorld({ bookings: seats57, answer: answers(403, { message: 'Too late to cancel' }) });
    await run(w);
    eq([w.log.toasts.map(x => x.msg), w.log.timers.includes(1500), w.log.fetches], [['Too late to cancel'], false, 0], name + ", a 403 with Psycle's reason: said as it is, no re-read");
  }
  for (const [name, run] of cancelPaths.slice(2)) {
    // Two records, one DELETE lands and the other 5xxs: the immediate reconcile
    // that was already there covers it — not a second, delayed fetch on top.
    const w = cancelWorld({ bookings: seats57, answer: path => (path === '/bookings/A' ? { ok: true, status: 204, json: async () => ({}) } : answers(500, { message: 'Server Error' })()) });
    await run(w);
    eq([w.log.toasts.map(x => x.msg), w.log.fetches, w.log.timers.includes(1500)], [[SERVER_FAULT], 1, false], name + ', one record gone and one 5xx: same wording, ONE re-read (straight away)');
  }

  // ── The real seat-map builders, fed a hostile layout ─────────────────────
  // slot.label is free text in Psycle's layout editor; ids are "numeric" only by
  // habit. Both strings become innerHTML.
  const escapeHTML = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const EVIL = '<img src=x onerror=alert(1)>';
  // Seat "09": an id Number() accepts but that is not its own canonical text.
  // (An id carrying `;` or `(` coerces to NaN, is never "available", and so
  // never had a handler — the numbers-only rule is about what the app then
  // LOOKS UP: selectBike / cancelBikeSlot find a seat by data-slot="<number>".)
  const evilLayout = () => ({ slots: [
    { id: 7, label: EVIL, x: 0, y: 0 }, { id: '09', label: 'A&B', x: 1, y: 0 },
    { id: '11);alert(1);(', x: 2, y: 0 }, { id: 12, x: 3, y: 0 },
  ] });
  function pickerWorld(o) {
    o = o || {};
    const els = {};
    const el = () => { const e = { textContent: '', innerHTML: '', className: '', disabled: false, onclick: null, style: {}, attrs: {} };
      e.setAttribute = (k, v) => { e.attrs[k] = String(v); }; e.appendChild = c => c; e.insertAdjacentElement = (p, c) => c; return e; };
    const dismiss = o.noDismiss ? null : Object.assign(el(), { textContent: o.dismissLabel || 'Cancel' });
    const globals = {
      window: { _changeSpotContext: o.swap ? { eventId: 77 } : null }, _eventCache: {},
      document: { getElementById: id => els[id] || (els[id] = el()), createElement: el,
        querySelector: sel => (sel === '#bikeModal .modal-actions .btn-ghost' ? dismiss : null) },
      slotLabelForEvent: () => 'Bike', escapeHTML, confirmBikeBooking: () => {},
      _usualSlotForEvent: () => null, _cancelDeadline: () => null,
      _syncBikeSlotsA11y: () => {}, // wave 3 ends showBikePicker with this pass
    };
    const ctx = t.vm.createContext(globals);
    t.vm.runInContext('var _bookingContext = null, _selectedSlots = [], _usualPreselected = null, MAX_SEATS = 2;\n' +
      grab(appSrc, 'function pluralizeSlotLabel(') + '\n' + grab(appSrc, 'function showBikePicker('), ctx);
    ctx.showBikePicker(77, null, o.layout || evilLayout(), new Set(o.available || [9, 11, 12]), new Set(o.mine || []), 'Studio 1');
    return { els, dismiss };
  }

  t.section('Seat maps: layout labels are escaped, and only NUMBERS reach an inline handler');
  {
    const svg = pickerWorld({ mine: [7] }).els.bikeSvg.innerHTML;
    ok(!svg.includes('<img') && svg.includes(escapeHTML(EVIL)), 'bike picker: a label like <img onerror=…> is text, not markup');
    ok(svg.includes('>A&amp;B</text>') && svg.includes('>12</text>'), 'bike picker: "A&B" is escaped; a seat with no label still prints its id — byte-identical for ordinary labels');
    // (That seat has no label, so its id is PRINTED — as escaped text. Harmless
    // there; what it must never be is part of an attribute or a handler.)
    ok(!/="[^"]*alert[^"]*"/.test(svg), 'bike picker: a non-numeric id never reaches an attribute or a handler');
    eq((svg.match(/onclick="[^"]*"/g) || []).sort(), ['onclick="cancelBikeSlot(7, 77)"', 'onclick="selectBike(12)"', 'onclick="selectBike(9)"'],
      'bike picker: handlers carry numbers only (the hostile-id seat is simply not tappable)');
    eq((svg.match(/data-slot="[^"]*"/g) || []), ['data-slot="7"', 'data-slot="9"', 'data-slot="NaN"', 'data-slot="12"'], 'bike picker: data-slot is the number too (cancelBikeSlot finds its seat by it)');
  }
  {
    // Settings → Bike preferences builds the same map inside settings.js's IIFE.
    const grid = { innerHTML: '', style: {} };
    const ctx = t.vm.createContext({
      window: {}, escapeHTML, _studioMap: { 4: { layout: evilLayout() } },
      getBikePrefs: () => ({ avoid: [9], prefer: [] }),
      document: { getElementById: id => (id === 'bikePrefStudio' ? { value: '4' } : grid) },
    });
    t.vm.runInContext(grab(settingsSrc, '  window.renderBikePrefGrid = function () {', '  };'), ctx);
    ctx.window.renderBikePrefGrid();
    ok(!grid.innerHTML.includes('<img') && grid.innerHTML.includes(escapeHTML(EVIL)) && grid.innerHTML.includes('>A&amp;B</text>'), 'bike preferences: labels escaped the same way');
    eq((grid.innerHTML.match(/onclick="[^"]*"/g) || []), ['onclick="toggleBikePref(4,7)"', 'onclick="toggleBikePref(4,9)"', 'onclick="toggleBikePref(4,NaN)"', 'onclick="toggleBikePref(4,12)"'],
      'bike preferences: studio and seat go into the handler as numbers');
    ok(grid.innerHTML.includes('bike-pref-svg-slot pref-avoid" data-slot="9"'), 'bike preferences: a saved preference still marks its seat');
  }

  t.section('Bike picker: the dismiss button never reads as "cancel my booking"');
  {
    let w = pickerWorld();
    eq([w.els.modalTitle.textContent, w.dismiss.textContent], ['Select your bikes', 'Cancel'], 'a fresh booking: "Cancel" beside "Confirm booking" is clear — unchanged');
    eq(w.els.modalHint.textContent, 'Select up to 2 bikes', 'fresh booking hint unchanged');
    w = pickerWorld({ mine: [7] });
    eq([w.els.modalTitle.textContent, w.dismiss.textContent], ['Your booking', 'Close'], 'under "Your booking" it says Close: "Cancel" there reads as cancelling the class (it only ever closed the sheet)');
    eq(w.els.modalHint.textContent, 'Tap Bike 7 to cancel it, or pick another bike to add one', 'one seat held: the hint names it ("Your bikes highlighted" was plural for one)');
    w = pickerWorld({ mine: [7, 12], available: [9] });
    eq(w.els.modalHint.textContent, 'Tap a highlighted bike to cancel it', 'two seats held: no "cancel it" after a list of two');
    w = pickerWorld({ swap: true, mine: [7] });
    eq(w.dismiss.textContent, 'Close', 'a swap: Close beside "Swap bike"');
    // Set both ways on EVERY open, so nothing has to reset it on close: the
    // same button, left on "Close" by the last sheet, reads Cancel again.
    w = pickerWorld({ dismissLabel: 'Close' });
    eq(w.dismiss.textContent, 'Cancel', 'a fresh booking opened after a "Your booking" sheet reads Cancel again (assigned both ways on every open)');
    let threw = null;
    try { pickerWorld({ noDismiss: true, mine: [7] }); } catch (e) { threw = e; }
    eq(threw, null, 'a shell without that button (it has no id; found by position) does not break the picker');
  }
};
