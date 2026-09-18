'use strict';
// The offline queue (js/reliability.js, section D). A queued item must never
// spend credits by surprise, and a cancel the member asked for must not be
// lost while the booking may still stand:
//   • the decision table, as a pure function (pure:offline-queue);
//   • the wiring around it — section D itself, sliced out of source and run
//     against a scripted API: what drains when ('online', a /bookings answer,
//     the foreground, a sign-in), the "Book it now?" ask, owners, sign-out, the
//     My Bookings status line.
module.exports = async function (t) {
  const { ok, eq } = t;
  const utc = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi || 0);
  const clone = v => JSON.parse(JSON.stringify(v));

  // app.js's London resolver — what the browser hands the queue as
  // window._psycleClassStartMs (the suite runs in America/New_York).
  const gym = t.loadPure('js/app.js', 'gym-time', { window: {} });
  const p = t.loadPure('js/reliability.js', 'offline-queue', { _psycleClassStartMs: gym._gymClassStartMs });

  const NOW = utc(2026, 6, 1, 9, 30); // 10:30 in London (BST)
  const seatA = () => ({ 77: { bookingId: 'A', bookingIds: ['A'], slots: [5], slotBookings: { 5: 'A' }, waitlisted: false } });
  const place = () => ({ 77: { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 900 } } });
  const cancel = extra => Object.assign({ qid: 'c1', owner: 'u1', type: 'cancel', eventId: 77, bookingIds: ['A'], timestamp: '2026-05-31T08:00:00.000Z' }, extra);
  const booking = extra => Object.assign({ qid: 'b1', owner: 'u1', eventId: 77, slots: [7], spaces: 0, startAt: '2026-06-01 18:00:00', timestamp: '2026-05-31T08:00:00.000Z' }, extra);
  const decide = (item, sameSession, map, owner, now) => p._offlineQueueDecision(item, now || NOW, sameSession, map, owner === undefined ? 'u1' : owner);

  // ── Decision table: cancels ──────────────────────────────────────────────
  t.section('Offline queue: what happens to a queued CANCEL');
  eq(decide(cancel(), true, {}, 'u1'), 'send', 'queued this session: sent although the map no longer holds it (our own optimistic drop took it out)');
  eq(decide(cancel(), true, null, 'u1'), 'send', '…and with no /bookings answer at all (the reconnect replay, as before)');
  eq(decide(cancel(), false, null, 'u1'), 'keep', 'left by an earlier launch, no /bookings answer yet → kept: nothing is concluded from a list that never loaded');
  eq(decide(cancel(), false, seatA(), 'u1'), 'send', 'left by an earlier launch, the booking still stands → sent');
  eq(decide(cancel({ bookingIds: [123] }), false, { 77: { bookingId: '123', slots: [], slotBookings: {}, waitlisted: false } }, 'u1'), 'send', 'ids compare as strings (the entry id)');
  eq(decide(cancel({ bookingIds: ['B'] }), false, { 77: { bookingId: 'A', bookingIds: ['A', 'B'], slots: [], slotBookings: {}, waitlisted: false } }, 'u1'), 'send', 'found among a no-layout booking\'s record ids');
  eq(decide(cancel({ bookingIds: ['S7'] }), false, { 77: { bookingId: 'A', slots: [5, 7], slotBookings: { 5: 'A', 7: 'S7' }, waitlisted: false } }, 'u1'), 'send', 'found among the per-seat ids');
  eq(decide(cancel(), false, {}, 'u1'), 'drop', 'the booking has gone (cancelled elsewhere / class over) → dropped');
  eq(decide(cancel(), false, { 77: { bookingId: 'Z', bookingIds: ['Z'], slots: [5], slotBookings: { 5: 'Z' }, waitlisted: false } }, 'u1'), 'drop',
    'cancelled elsewhere and RE-booked since (new record ids) → the old cancel must not take the new booking');
  eq(decide(cancel(), false, place(), 'u1'), 'drop', 'only a waitlist place is left in that class → nothing to cancel');
  eq(decide(cancel({ bookingIds: [] }), false, seatA(), 'u1'), 'send', 'an id-less (legacy) cancel was for the whole class: still held → sent');
  eq(decide(cancel({ bookingIds: [] }), false, {}, 'u1'), 'drop', '…not held → dropped');
  eq(decide(cancel({ timestamp: '2025-01-01T00:00:00.000Z' }), false, seatA(), 'u1'), 'send', 'a cancel is never aged out — a year old and the booking still stands → sent');
  eq(decide(cancel({ owner: null, qid: undefined }), false, seatA(), 'u1'), 'send', 'a legacy item (no owner) is still checked against THIS account\'s bookings');
  eq(decide(cancel({ owner: 'u2' }), true, seatA(), 'u1'), 'drop', 'another member\'s cancel never runs under this account — even "live"');
  eq(decide(cancel(), true, seatA(), null), 'keep', 'no verified member (unverified session) → nothing goes out');

  // ── Decision table: bookings ─────────────────────────────────────────────
  t.section('Offline queue: what happens to a queued BOOKING');
  eq(decide(booking(), true, null, 'u1'), 'send', 'the reconnect replay of something queued this session → sent (the member is watching, as before)');
  eq(decide(booking(), true, seatA(), 'u1'), 'send', '…also as "+ Add spot" on a class already held');
  eq(decide(booking({ owner: null }), true, {}, 'u1'), 'ask', 'never auto-sent without a known owner');
  eq(decide(booking({ heldAtQueue: false }), true, seatA(), 'u1'), 'drop', 'queued for a class that was NOT held, and a seat is held now (booked some other way since) → dropped, not a second seat');
  eq(decide(booking({ heldAtQueue: false }), true, place(), 'u1'), 'send', '…a waitlist place alone is not a seat');
  eq([decide(booking({ heldAtQueue: false }), true, {}, 'u1'), decide(booking({ heldAtQueue: false }), true, null, 'u1')], ['send', 'send'], '…still unheld, or no /bookings answer → sent as before');
  eq(decide(booking({ heldAtQueue: true }), true, seatA(), 'u1'), 'send', '"+ Add spot" (held when it was queued) is still sent');
  eq(decide(booking(), false, {}, 'u1'), 'ask', 'left by an earlier launch, class still ahead, not booked → ask first');
  eq(decide(booking({ slots: [], spaces: 1 }), false, {}, 'u1'), 'ask', 'a COUNT body (no-layout studio) is asked about like any other');
  eq(decide(booking(), false, null, 'u1'), 'keep', 'no /bookings answer yet → kept ("already booked?" can\'t be known)');
  eq(decide(booking(), false, seatA(), 'u1'), 'drop', 'already booked → dropped, not asked');
  eq(decide(booking(), false, place(), 'u1'), 'drop', 'on its waitlist now (the class filled up) → dropped');
  eq(decide(booking({ owner: 'u2' }), false, {}, 'u1'), 'drop', 'another member\'s booking → dropped');
  eq(decide(booking(), false, {}, null), 'keep', 'no verified member → kept');
  eq(decide({ eventId: 77, slots: [7], spaces: 0, timestamp: 'x' }, false, {}, 'u1'), 'ask', 'a legacy item (no owner, no time) is only ever asked about');
  eq(decide({ eventId: 77, slots: [7], spaces: 0, timestamp: 'x' }, true, {}, 'u1'), 'ask', '…whatever the caller claims about the session');
  // 10:00 London on 1 Jun 2026 is 09:00Z — half an hour BEFORE `NOW`. Parsed in
  // the device zone (New York, 14:00Z) the class would still look bookable.
  eq(decide(booking({ startAt: '2026-06-01 10:00:00' }), false, {}, 'u1'), 'drop', 'the class has started (London wall clock, not the device\'s) → dropped silently');
  eq(decide(booking({ startAt: '2026-06-01 10:00:00' }), false, null, 'u1'), 'drop', '…with or without a /bookings answer');
  eq(decide(booking({ startAt: '2026-06-01 11:00:00' }), false, {}, 'u1'), 'ask', 'half an hour to go → still asked');
  eq(decide(booking({ startAt: 'soon' }), false, {}, 'u1'), 'ask', 'an unreadable time is "unknown", never "started"');
  eq([decide(null, true, {}, 'u1'), decide({ slots: [7] }, true, {}, 'u1')], ['drop', 'drop'], 'not an item (null / no event id) → dropped');

  t.section('Offline queue: when is a replay the member\'s live intent?');
  eq(p._offlineQueueIsLive(booking(), true, 'online'), true, 'a booking queued this session, on the reconnect replay');
  eq(['loaded', 'approved', 'manual', undefined].map(tr => p._offlineQueueIsLive(booking(), true, tr)), [false, false, false, false],
    '…but on no other trigger (a foreground hours later is not "watching")');
  eq(p._offlineQueueIsLive(booking(), false, 'online'), false, 'a booking restored from storage: never');
  eq(['online', 'loaded', 'manual'].map(tr => p._offlineQueueIsLive(cancel(), true, tr)), [true, true, true], 'a cancel queued this session stays live on every trigger');
  eq(p._offlineQueueIsLive(cancel(), false, 'online'), false, 'a restored cancel is checked against /bookings instead');

  t.section('Offline queue: naming a class nothing else can name');
  eq(p._queueFallbackLabel('2026-06-01 07:05:00'), 'a class on Mon 1 at 7:05am', 'from the digits — the class\'s own wall clock');
  eq(p._queueFallbackLabel('2026-06-06T18:30:00'), 'a class on Sat 6 at 6:30pm', 'T form, pm');
  eq([p._queueFallbackLabel(''), p._queueFallbackLabel(null), p._queueFallbackLabel('soon')], ['a class', 'a class', 'a class'], 'unreadable → "a class"');

  // ── Wiring: section D, run whole ─────────────────────────────────────────
  const rel = t.readSource('js/reliability.js');
  const from = rel.indexOf("  var OFFLINE_QUEUE_KEY = 'psycle_offline_queue';");
  const to = rel.lastIndexOf('})();');
  ok(from !== -1 && to > from, 'section D can be sliced (anchors moved? update tests/suites/offline-queue.js)');
  const sectionD = rel.slice(from, to);
  const KEY = 'psycle_offline_queue';
  const settle = async () => { for (let i = 0; i < 25; i++) await new Promise(r => setImmediate(r)); };

  // One scripted app per scenario. `api(path, opts)` answers every request
  // ({status, body} | Error); `stored` is what an earlier launch left behind.
  function world(opts) {
    opts = opts || {};
    const log = { calls: [], toasts: [], confirms: [], fetches: 0, released: [], signOuts: 0, passedOn: [] };
    const ls = t.makeFakeLocalStorage();
    if (opts.stored) ls.setItem(KEY, JSON.stringify(opts.stored));
    const state = { token: 'tok', answer: true, replaceDialog: false };
    const handlers = {}, winL = {}, docL = {};
    const els = {};
    const mkEl = () => ({ style: {}, attrs: {}, textContent: '', setAttribute(k, v) { this.attrs[k] = v; } });
    els['tab-bookings'] = { children: [], firstChild: null, insertBefore(el) { this.children.unshift(el); els[el.id] = el; } };
    const globals = {
      console: { log() {}, warn() {}, error: console.error },
      setTimeout, clearTimeout,
      navigator: { onLine: true },
      localStorage: ls,
      window: {
        addEventListener: (e, fn) => { (winL[e] = winL[e] || []).push(fn); },
        submitBooking: async (id, slots, btn, o) => { log.passedOn.push([id, slots]); },
        clearToken: () => { log.signOuts++; state.token = ''; },
      },
      document: {
        hidden: false, visibilityState: 'visible',
        addEventListener: (e, fn) => { (docL[e] = docL[e] || []).push(fn); },
        getElementById: id => els[id] || null,
        createElement: mkEl,
      },
      PsycleEvents: {
        on: (e, fn) => { (handlers[e] = handlers[e] || []).push(fn); },
        emit: (e, ...a) => { (handlers[e] || []).forEach(fn => fn(...a)); },
      },
      getBearerToken: () => state.token,
      toast: (msg, type) => log.toasts.push({ msg, type }),
      confirmModal: async o => {
        log.confirms.push(o);
        if (state.whileDialogIsUp) state.whileDialogIsUp();
        if (state.replaceDialog) { o.onReplaced(); return false; }
        return state.answer;
      },
      apiFetch: async (path, o) => {
        const method = (o && o.method) || 'GET';
        log.calls.push(method + ' ' + path + (o && o.body ? ' ' + o.body : ''));
        const r = await opts.api(path, o || {}, state);
        if (r instanceof Error) throw r;
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body || {} };
      },
      fetchMyBookings: () => { log.fetches++; return Promise.resolve(true); },
      refreshUpcomingPanel: () => {},
      _psycleClassStartMs: gym._gymClassStartMs,
      _waitlistClassLine: () => 'Ride 45 · Alex · Mon 1, 6:00pm',
      slotLabelForEvent: () => 'Bike',
      formatSlots: (l, s) => l + ' ' + s.join(' & '),
      _dialogOpen: () => false,
      _syncCardButtonsForEvent: id => log.released.push(id),
      _eventCache: { 77: { start_at: '2099-06-01 18:00:00' } },
      currentUser: opts.user === undefined ? { id: 'u1' } : opts.user,
      _myBookings: {},
    };
    const ctx = t.vm.createContext(globals);
    t.vm.runInContext(sectionD, ctx, { filename: 'js/reliability.js[offline queue]' });
    const w = {
      ctx, log, state, els,
      queue: () => JSON.parse(ls.getItem(KEY) || '[]'),
      // A /bookings answer: fetchMyBookings swaps the map in, then emits it.
      loaded: async map => { ctx._myBookings = map; globals.PsycleEvents.emit('bookings:loaded', map); await settle(); },
      online: async () => { (winL.online || []).forEach(fn => fn({ type: 'online' })); await settle(); },
      foreground: () => { (docL.visibilitychange || []).forEach(fn => fn()); },
      auth: async s => { globals.PsycleEvents.emit('auth:changed', s); await settle(); },
      sent: re => log.calls.filter(c => re.test(c)),
      btn: () => ({ textContent: 'Book', className: 'book-btn', disabled: false }),
    };
    return w;
  }
  const FUTURE = { status: 200, body: { data: { start_at: '2099-06-01 18:00:00' } } };
  const api = table => async (path, o) => {
    const key = ((o && o.method) || 'GET') + ' ' + path;
    const r = table[key];
    if (r === undefined) throw new Error('offline-queue suite: unscripted ' + key);
    return typeof r === 'function' ? r() : r;
  };
  const oldCancel = () => ({ qid: 'c1', owner: 'u1', type: 'cancel', eventId: 77, bookingIds: ['A'], timestamp: '2026-05-31T08:00:00.000Z' });
  const oldBooking = () => ({ qid: 'b1', owner: 'u1', eventId: 77, slots: [7], spaces: 0, startAt: '2099-06-01 18:00:00', label: 'Ride 45 · Alex · Mon 1, 6:00pm', timestamp: '2026-05-31T08:00:00.000Z' });

  t.section('Offline queue: a cancel made offline in this session goes out on reconnect');
  {
    const w = world({ api: api({ 'DELETE /bookings/A': { status: 204 }, 'DELETE /bookings/B': { status: 204 } }) });
    w.ctx.navigator.onLine = false;
    w.ctx.window.queueOfflineCancel(77, ['A', 'B']); // app.js has already dropped the class from _myBookings
    const item = w.queue()[0];
    eq([item.type, item.owner, item.bookingIds, item.startAt, item.label, typeof item.qid],
      ['cancel', 'u1', ['A', 'B'], '2099-06-01 18:00:00', 'Ride 45 · Alex · Mon 1, 6:00pm', 'string'],
      'the item is stamped: owner, its own id, the class time + label');
    eq(w.els.offlineQueueStatus && w.els.offlineQueueStatus.textContent, '1 change waiting to sync with Psycle', 'My Bookings says a change is waiting');
    eq([w.els.offlineQueueStatus.className, w.els.offlineQueueStatus.attrs.role], ['mb-queue-status', 'status'], '…in its own element at the top of the tab (a polite live region)');
    w.ctx.navigator.onLine = true;
    await w.online();
    eq(w.sent(/^DELETE/), ['DELETE /bookings/A', 'DELETE /bookings/B'], 'both records are cancelled — without asking a map that no longer holds them');
    eq([w.queue(), w.log.fetches], [[], 1], 'the queue is empty and /bookings is re-read once');
    ok(w.log.toasts.some(x => x.msg === '1 queued cancel sent'), 'the member is told');
    eq(w.els.offlineQueueStatus.style.display, 'none', 'the status line goes away');
    await w.loaded({});
    eq(w.sent(/^DELETE/).length, 2, 'the /bookings answer that follows sends nothing again');
  }

  t.section('Offline queue: a cancel stranded by a closed app is sent on the next launch');
  {
    const w = world({ stored: [oldCancel()], api: api({ 'DELETE /bookings/A': { status: 204 } }) });
    await settle();
    eq(w.log.calls, [], 'nothing goes out before /bookings has answered');
    await w.loaded(seatA());
    eq(w.sent(/^DELETE/), ['DELETE /bookings/A'], 'first /bookings answer: the booking still stands → the cancel is sent');
    eq(w.queue(), [], '…and leaves the queue');
    await w.loaded({});
    eq(w.log.calls.length, 1, 'its own re-read of /bookings does not start another drain');
  }
  {
    const w = world({ stored: [oldCancel()], api: api({}) });
    await w.loaded({});
    eq([w.log.calls, w.queue(), w.log.toasts, w.log.fetches], [[], [], [], 0], 'the booking has gone → dropped without a request, a toast or a re-read');
  }
  {
    // Legacy item (before ids/owners existed): same rule, checked against this account.
    const w = world({ stored: [{ type: 'cancel', eventId: 77, bookingIds: ['A'], timestamp: 'x' }], api: api({ 'DELETE /bookings/A': { status: 204 } }) });
    await w.loaded(seatA());
    eq([w.sent(/^DELETE/), w.queue()], [['DELETE /bookings/A'], []], 'a legacy cancel is sent while the booking stands');
  }

  t.section('Offline queue: a cancel is only given up on when Psycle refuses the cancel itself');
  for (const [status, kept, why] of [[401, true, 'session expired'], [403, true, 'a denial with a valid session'], [500, true, 'server trouble'], [422, false, 'Psycle refused this cancel']]) {
    const w = world({
      stored: [oldCancel()],
      api: async (path, o, state) => { if (status === 401) state.token = ''; return { status }; }, // apiFetch expires the session on a 401
    });
    await w.loaded(seatA());
    eq(w.queue().length, kept ? 1 : 0, status + ' (' + why + ') → ' + (kept ? 'kept for another go' : 'dropped'));
  }
  {
    const w = world({ stored: [oldCancel()], api: async () => new TypeError('Failed to fetch') });
    await w.loaded(seatA());
    eq(w.queue().length, 1, 'a network failure → kept');
    w.foreground();
    await w.loaded(seatA());
    eq(w.sent(/^DELETE/).length, 2, 'back in the foreground: the next /bookings answer tries again');
    await w.loaded(seatA());
    eq(w.sent(/^DELETE/).length, 2, '…once per foreground, not on every /bookings answer');
  }

  t.section('Offline queue: a booking stranded by a closed app is never sent blind');
  {
    const w = world({ stored: [oldBooking()], api: api({ 'GET /events/77': FUTURE, 'POST /bookings': { status: 201, body: { data: { id: 'N' } } } }) });
    await w.online();
    eq([w.sent(/^POST/), w.log.confirms.length], [[], 0], 'a reconnect alone sends nothing and asks nothing (no /bookings answer yet)');
    eq(w.log.fetches, 1, '…it asks for /bookings instead');
    await w.loaded({});
    eq(w.log.confirms.length, 1, 'once /bookings has landed the member is asked');
    const c = w.log.confirms[0];
    eq([c.confirmText, c.cancelText], ['Book it', 'Discard'], 'Book it / Discard');
    ok(/You tried to book Ride 45 · Alex · Mon 1, 6:00pm \(Bike 7\) while offline/.test(c.body), 'the dialog names the class and the seat');
    ok(/12-hour cancellation policy/.test(c.warn), '…with the usual 12-hour policy line');
    eq(w.sent(/^POST/), ['POST /bookings {"event_id":77,"slots":[7]}'], '"Book it" → the booking is sent, once');
    eq(w.queue(), [], '…and leaves the queue');
    ok(w.log.toasts.some(x => x.msg === '1 queued booking confirmed!'), 'confirmed');
  }
  {
    const w = world({ stored: [oldBooking()], api: api({ 'GET /events/77': FUTURE }) });
    w.state.answer = false;
    await w.loaded({});
    eq([w.log.confirms.length, w.sent(/^POST/), w.queue()], [1, [], []], '"Discard" → nothing is sent and the item is gone');
    eq(w.log.released, [77], 'a "Queued" card button goes back to Book');
  }
  {
    const w = world({ stored: [oldBooking()], api: api({ 'GET /events/77': FUTURE }) });
    w.state.replaceDialog = true;
    await w.loaded({});
    eq([w.sent(/^POST/), w.queue().length], [[], 1], 'a dialog displaced by another one is not an answer: nothing sent, still queued');
    w.foreground();
    w.state.replaceDialog = false;
    w.state.answer = false;
    await w.loaded({});
    eq(w.log.confirms.length, 2, '…and the member is asked again next time');
  }
  {
    const w = world({ stored: [oldBooking()], api: api({ 'GET /events/77': { status: 200, body: { data: { start_at: '2020-01-01 10:00:00' } } } }) });
    await w.loaded({});
    eq([w.log.confirms.length, w.sent(/^POST/), w.queue(), w.log.toasts], [0, [], [], []], 'the class has started (Psycle\'s own time wins over the stamp) → discarded silently');
  }
  {
    const w = world({ stored: [Object.assign(oldBooking(), { startAt: '2020-01-01 10:00:00' })], api: api({}) });
    await w.loaded({});
    eq([w.log.calls, w.log.confirms.length, w.queue()], [[], 0, []], 'known to have started from its stamp → dropped without a request');
  }
  {
    const w = world({ stored: [oldBooking()], api: api({ 'GET /events/77': { status: 404 } }) });
    await w.loaded({});
    eq([w.log.confirms.length, w.queue()], [0, []], 'the class no longer exists → discarded silently');
  }
  {
    const w = world({ stored: [oldBooking()], api: async () => new TypeError('Failed to fetch') });
    await w.loaded({});
    eq([w.log.confirms.length, w.queue().length], [0, 1], 'Psycle can\'t be reached → nothing is asked, the item waits');
  }
  {
    const w = world({ stored: [oldBooking()], api: api({}) });
    await w.loaded(seatA());
    eq([w.log.calls, w.log.confirms.length, w.queue()], [[], 0, []], 'already booked → dropped, not asked');
  }
  {
    // The dialog sat open while the session changed hands: "Book it" was the
    // previous member's answer, and a legacy item has no owner to purge it by.
    const w = world({ stored: [{ eventId: 77, slots: [7], spaces: 0, timestamp: 'x' }], api: api({ 'GET /events/77': FUTURE }) });
    w.state.whileDialogIsUp = () => { w.ctx.currentUser = { id: 'u2' }; };
    await w.loaded({});
    eq([w.log.confirms.length, w.sent(/^POST/)], [1, []], '"Book it" from a member who is no longer the one signed in sends nothing');
  }
  {
    // COUNT body + legacy shape: the two that could double-charge.
    const w = world({ stored: [{ eventId: 77, slots: [], spaces: 1, timestamp: 'x' }], api: api({ 'GET /events/77': FUTURE, 'POST /bookings': { status: 201, body: {} } }) });
    await w.online();
    await w.loaded({});
    eq(w.log.confirms.length, 1, 'a legacy COUNT booking is asked about, never auto-sent');
    ok(/You tried to book Ride 45/.test(w.log.confirms[0].body), '…named from the event cache when the item carries no label');
    eq(w.sent(/^POST/), ['POST /bookings {"event_id":77,"slots":1}'], 'only after "Book it"');
  }

  t.section('Offline queue: a booking made offline in this session');
  {
    const w = world({ api: api({ 'GET /events/77': FUTURE, 'POST /bookings': { status: 201, body: { data: { id: 'N' } } } }) });
    w.ctx.navigator.onLine = false;
    const b = w.btn();
    await w.ctx.window.submitBooking(77, [7], b);
    await w.ctx.window.submitBooking(77, [7], w.btn()); // the "Queued" label didn't survive a re-render; tapped again
    eq([w.queue().length, b.textContent, w.log.passedOn], [1, 'Queued', []], 'queued once, however often it is tapped; nothing reaches the network path');
    eq([w.queue()[0].owner, w.queue()[0].slots], ['u1', [7]], 'stamped with the member who queued it');
    w.ctx.navigator.onLine = true;
    await w.online();
    eq([w.sent(/^POST/), w.log.confirms.length, w.queue()], [['POST /bookings {"event_id":77,"slots":[7]}'], 0, []], 'reconnect → sent straight away, as before');
  }
  {
    const w = world({ api: api({ 'GET /events/77': FUTURE }) });
    w.ctx.navigator.onLine = false;
    await w.ctx.window.submitBooking(77, [7], w.btn());
    w.state.answer = false;
    w.foreground(); // hours later, no 'online' event ever fired
    await w.loaded({});
    eq([w.sent(/^POST/), w.log.confirms.length], [[], 1], 'any other trigger asks first — only the reconnect replay is "the member is watching"');
  }
  {
    // One blind replay per booking. The replay fails and the item is kept, the
    // member says "Book it" and that fails too, then books the class by hand on
    // another bike: the NEXT reconnect must not send the queued seat as well.
    const seat9 = () => ({ 77: { bookingId: 'M', bookingIds: ['M'], slots: [9], slotBookings: { 9: 'M' }, waitlisted: false } });
    const w = world({ api: api({ 'GET /events/77': FUTURE, 'POST /bookings': { status: 500, body: { message: 'Not enough credits' } } }) });
    w.ctx.navigator.onLine = false;
    await w.ctx.window.submitBooking(77, [7], w.btn());
    eq(w.queue()[0].heldAtQueue, false, 'the item records that no seat was held when it was queued');
    w.ctx.navigator.onLine = true;
    await w.online();
    eq([w.sent(/^POST/).length, w.queue().length], [1, 1], 'reconnect → sent once; a 500 keeps it queued');
    await w.loaded({});
    eq([w.log.confirms.length, w.sent(/^POST/).length, w.queue().length], [1, 2, 1], 'the /bookings answer asks; "Book it" tries once more, fails, and it is kept');
    await w.loaded(seat9()); // booked by hand on bike 9 — this answer is not armed, so nothing drains
    eq(w.queue().length, 1, '…still queued');
    await w.online();
    eq(w.sent(/^POST/).length, 2, 'the next reconnect sends NOTHING (it used to POST bike 7 on top of bike 9)');
    eq([w.queue(), w.log.released], [[], [77]], '…the class is held → the item is dropped and the card button re-synced');
  }
  {
    // GET /events throwing on the replay has the same effect: tried once, then asked about.
    let up = false;
    const w = world({ api: async (path, o) => {
      if (path === '/events/77') return up ? FUTURE : new TypeError('Failed to fetch');
      throw new Error('offline-queue suite: unscripted ' + path);
    } });
    w.ctx.navigator.onLine = false;
    await w.ctx.window.submitBooking(77, [7], w.btn());
    w.ctx.navigator.onLine = true;
    await w.online();
    eq([w.sent(/^POST/), w.queue().length], [[], 1], 'the replay could not even read the class → kept');
    up = true;
    w.state.answer = false;
    await w.online();
    eq(w.sent(/^POST/), [], 'a second reconnect does not replay it blind (no /bookings answer yet → kept)');
    await w.loaded({});
    eq([w.log.confirms.length, w.sent(/^POST/)], [1, []], '…it is asked about instead');
  }
  {
    // 'online' fires while the "Book it / Discard" dialog for that very item is up.
    const w = world({ api: api({ 'GET /events/77': FUTURE, 'POST /bookings': { status: 201, body: { data: { id: 'N' } } } }) });
    w.ctx.navigator.onLine = false;
    await w.ctx.window.submitBooking(77, [7], w.btn());
    w.ctx.navigator.onLine = true;
    w.state.answer = false;
    w.state.whileDialogIsUp = () => { w.state.whileDialogIsUp = null; w.online(); };
    w.foreground();
    await w.loaded({});
    await settle();
    eq([w.log.confirms.length, w.sent(/^POST/), w.queue()], [1, [], []], 'a reconnect behind an open ask sends nothing — "Discard" means discarded');
  }
  // The reconnect replay never ASKS from the list it found on reconnect: a class
  // booked elsewhere during the outage is not in it yet. (It used to put the
  // dialog up, the /bookings answer behind it then dropped the item, and "Book
  // it" sent nothing.) `postFails`: the replay's POST dies at the network, so
  // the item is kept and is no longer "live".
  const postFails = async (path, o) => {
    if (path === '/events/77') return FUTURE;
    if (path === '/bookings' && o.method === 'POST') return new TypeError('Failed to fetch');
    throw new Error('offline-queue suite: unscripted ' + path);
  };
  const strandedAfterReplay = async () => {
    const w = world({ api: postFails });
    const launchMap = {};
    await w.loaded(launchMap); // launch: nothing booked, nothing queued
    w.ctx.navigator.onLine = false;
    await w.ctx.window.submitBooking(77, [7], w.btn());
    w.ctx.navigator.onLine = true;
    await w.online(); // …and its own /bookings re-read never lands either
    eq([w.sent(/^POST/).length, w.queue().length, w.log.confirms.length], [1, 1, 0], 'the replay fails at the network → kept, nothing asked');
    return { w, launchMap };
  };
  {
    const { w, launchMap } = await strandedAfterReplay();
    const fetchesBefore = w.log.fetches;
    await w.online(); // booked on Psycle's own site meanwhile; the signal comes back again
    eq([w.log.confirms.length, w.log.fetches - fetchesBefore], [0, 1], 'the next reconnect asks NOTHING from the list loaded before the outage — it asks for /bookings instead');
    await w.loaded(launchMap); // app.js re-announcing the list it already had (saved class details re-read)
    eq([w.log.confirms.length, w.queue().length], [0, 1], '…the same old list announced again is no fresher');
    await w.loaded(seatA());
    eq([w.log.confirms.length, w.sent(/^POST/).length, w.queue(), w.log.released], [0, 1, [], [77]],
      'the /bookings answer holds the class → dropped without a dialog ever going up');
  }
  {
    const { w } = await strandedAfterReplay();
    w.state.answer = false;
    await w.online();
    await w.loaded({});
    eq([w.log.confirms.length, w.queue()], [1, []], 'still unbooked in the fresh answer → asked once, from that answer');
  }
  {
    // A fresh answer that lands while an earlier replay is still running counts:
    // the re-run the second reconnect asked for may ask from it.
    let answerEvent;
    const w = world({ api: async (path, o) => {
      if (path === '/events/77') return answerEvent ? FUTURE : new Promise(r => { answerEvent = r; });
      return postFails(path, o);
    } });
    await w.loaded({});
    w.ctx.navigator.onLine = false;
    await w.ctx.window.submitBooking(77, [7], w.btn());
    w.ctx.navigator.onLine = true;
    w.state.answer = false;
    await w.online();   // the replay hangs on GET /events/77
    await w.online();   // the radio flaps: a re-run is wanted, /bookings is asked for
    await w.loaded({}); // …and answers while the first replay is still out
    eq(w.log.confirms.length, 0, 'nothing is asked while the replay is still running');
    answerEvent(FUTURE);
    await settle();
    eq([w.sent(/^POST/).length, w.log.confirms.length, w.queue()], [1, 1, []], 'replay fails → the re-run asks from the answer that landed meanwhile');
  }
  {
    // The dialog sat open while a /bookings answer behind it dropped the item
    // (booked elsewhere meanwhile): "Book it" has nothing left to send.
    const w = world({ stored: [oldBooking()], api: api({ 'GET /events/77': FUTURE }) });
    w.state.whileDialogIsUp = () => { w.state.whileDialogIsUp = null; w.foreground(); w.loaded(seatA()); };
    await w.loaded({});
    await settle();
    eq([w.log.confirms.length, w.sent(/^POST/), w.queue()], [1, [], []], '"Book it" on an item dropped behind the dialog sends nothing');
    ok(w.log.toasts.some(x => /nothing was sent/i.test(x.msg)), '…and says so, instead of the dialog just closing');
  }
  {
    // A COUNT body kept after "did it land? no" is never re-sent on a later
    // reconnect without a fresh /bookings answer and an explicit "Book it".
    const w = world({ api: api({ 'GET /events/77': FUTURE, 'POST /bookings': { status: 500 }, 'GET /bookings?limit=200': { status: 200, body: { data: [] } } }) });
    w.ctx.navigator.onLine = false;
    await w.ctx.window.submitBooking(77, [], w.btn(), { spaces: 1 });
    w.ctx.navigator.onLine = true;
    await w.online();
    eq([w.sent(/^POST/), w.queue().length], [['POST /bookings {"event_id":77,"slots":1}'], 1], 'count body: sent once, did not land → kept');
    await w.online();
    eq(w.sent(/^POST/).length, 1, 'the next reconnect does not send another space');
  }
  {
    const w = world({ api: api({}) });
    await w.ctx.window.submitBooking(77, [7], w.btn());
    await w.ctx.window.submitBooking(77, null, w.btn(), { waitlist: true });
    eq([w.queue(), w.log.passedOn.length], [[], 2], 'online, or a waitlist join: passed straight on, never queued');
  }

  t.section('Offline queue: owners, sign-out, unverified sessions');
  {
    const w = world({ stored: [Object.assign(oldCancel(), { owner: 'u2' }), Object.assign(oldBooking(), { owner: 'u2' })], api: api({}) });
    await w.auth({ signedIn: true });
    eq(w.queue(), [], 'another member\'s items are purged at sign-in');
    await w.loaded(seatA());
    eq([w.log.calls, w.log.confirms.length], [[], 0], '…and nothing of theirs is ever sent or asked about');
  }
  {
    const w = world({ stored: [oldCancel()], api: api({}) });
    w.ctx.window.clearToken();
    eq([w.queue(), w.log.signOuts], [[], 1], 'a deliberate sign-out empties the queue (and still signs out)');
  }
  {
    const w = world({ stored: [oldCancel()], api: api({}) });
    w.state.token = '';
    await w.auth({ signedIn: false }); // session expired: the same member signs back in
    eq(w.queue().length, 1, 'session expiry keeps it (a cancel kept after a 401 must outlive that 401)');
    eq(w.els.offlineQueueStatus, undefined, '…but says nothing while signed out');
  }
  {
    const w = world({ stored: [oldCancel()], user: null, api: api({ 'DELETE /bookings/A': { status: 204 } }) });
    await w.loaded(seatA()); // an unverified session can still load /bookings
    eq([w.log.calls, w.queue().length], [[], 1], 'no verified member → nothing goes out');
    w.ctx.currentUser = { id: 'u1' };
    await w.loaded(seatA());
    eq(w.sent(/^DELETE/), ['DELETE /bookings/A'], 'the load after the check heals drains (it stayed armed)');
  }
  {
    // Sign-out while a replay is in flight: the drain's closing save must not put the item back.
    let answer;
    const w = world({ stored: [oldCancel()], api: () => new Promise(r => { answer = r; }) });
    await w.loaded(seatA());
    w.ctx.window.clearToken();
    answer({ status: 500 }); // "keep it" — for a queue that no longer exists
    await settle();
    eq(w.queue(), [], 'signed out mid-replay → the queue stays empty');
  }

  t.section('Offline queue: My Bookings status line');
  {
    const w = world({ stored: [oldCancel(), oldBooking(), Object.assign(oldCancel(), { qid: 'c9', owner: 'u2' })], api: async () => new TypeError('Failed to fetch') });
    w.ctx.PsycleEvents.emit('queue:changed', 3);
    eq(w.els.offlineQueueStatus.textContent, '2 changes waiting to sync with Psycle', 'counts this member\'s items only');
    delete w.els['tab-bookings'];
    w.ctx.PsycleEvents.emit('queue:changed', 3);
    ok(true, 'no tab shell yet (tabs.js builds it later) → no crash');
  }
};
