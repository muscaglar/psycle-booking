'use strict';
// Class-history reconcile (#76): the pure diff (pure:history in js/features.js)
// and the REAL fetchMyBookings wrapper around it, sliced out of source and run
// against scripted fetches. The pure function trusts whatever snapshot it is
// handed — so the second half is about the guards that decide whether a
// snapshot may be trusted at all. Each of them is a way this feature would have
// silently marked a member's upcoming classes cancelled.
module.exports = async function (t) {
  const { ok, eq } = t;
  const src = t.readSource('js/features.js');
  // features.js is one IIFE: its functions sit at two spaces and close on '  }'.
  const grab = (opener) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === '  }');
    if (from === -1 || to === -1) throw new Error('history suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };

  // The runner's zone is New York; class times are London wall clock. The real
  // resolver (pure:gym-time in app.js) is what features.js is handed at runtime.
  const london = t.loadPure('js/app.js', 'gym-time')._gymClassStartMs;
  const naive = (s) => Date.parse(String(s).replace(' ', 'T')); // what a device-local parse would say
  // Mon 21 Sep 2026, 10:30 in London (BST) = 09:30 UTC.
  const NOW = Date.UTC(2026, 8, 21, 9, 30);
  const NOW_ISO = new Date(NOW).toISOString();
  const H = 3600000;

  const p = t.loadPure('js/features.js', 'history');
  const seat = (o) => Object.assign({ bookingId: 'B1', bookingIds: ['B1'], slots: [12], slotBookings: { 12: 'B1' }, waitlisted: false }, o || {});
  const place = () => ({ bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 900 } });
  const evt = (id, start, o) => Object.assign({ id, start_at: start, instructor_id: 44, _typeName: 'Ride', _instrName: 'Alex', _locName: 'Bank' }, o || {});
  const entry = (id, date, o) => Object.assign({ eventId: String(id), typeName: 'Ride', instrName: 'Alex', locName: 'Bank', date, slots: [12], bookedAt: '2026-09-01T08:00:00.000Z' }, o || {});
  const run = (history, bookings, cache, o) => p._historyReconcile(history, bookings, cache, NOW, (o && o.startMs) || london, (o && o.max) || 2000);

  t.section('History reconcile: a seat booked elsewhere reaches history');
  ok(typeof p._historyReconcile === 'function', 'pure:history exposes _historyReconcile');
  {
    const r = run([entry(1, '2026-09-10 07:00:00')], { 50: seat({ slots: [7, 9] }) }, { 50: evt(50, '2026-09-25 18:30:00') });
    eq([r.added, r.cancelled, r.revived, r.changed], [['50'], [], [], true], 'one class added, nothing else touched');
    eq(r.history[0], { eventId: '50', typeName: 'Ride', instrName: 'Alex', instrId: '44', locName: 'Bank', date: '2026-09-25 18:30:00', slots: [7, 9], bookedAt: NOW_ISO },
      'same shape addHistoryEntry writes (plus instrId, which Stats and Explore prefer over the name), newest first');
    eq(r.history.length, 2, 'the existing entry is kept');
  }
  eq(run([entry(50, '2026-09-25 18:30:00')], { 50: seat() }, { 50: evt(50, '2026-09-25 18:30:00') }).changed, false, 'already in history → nothing to do');
  eq(run([Object.assign(entry(50, '2026-09-25 18:30:00'), { eventId: 50 })], { 50: seat() }, { 50: evt(50, '2026-09-25 18:30:00') }).added, [],
    'an entry whose eventId was stored as a number still counts as the same class');
  eq(run([], { 50: place() }, { 50: evt(50, '2026-09-25 18:30:00') }).added, [], 'a waitlist place is not an attended class → never added');
  eq(run([], { 50: seat({ waitlisted: true }) }, { 50: evt(50, '2026-09-25 18:30:00') }).added, [],
    '`waitlisted` alone decides it ("no real seat" everywhere else in the app) — even on an entry that carries an id and a slot');
  eq(run([], { 50: { bookingId: null, bookingIds: [], slots: [], slotBookings: {}, waitlisted: false } }, { 50: evt(50, '2026-09-25 18:30:00') }).added, [],
    'an entry with no booking id and no slot is not a seat → never added');
  eq(run([], { 50: seat({ bookingId: 'B9', bookingIds: ['B9', 'B10'], slots: [], slotBookings: {} }) }, { 50: evt(50, '2026-09-25 18:30:00') }).history[0].slots, [],
    'a no-layout studio books by count: a slot-less seat IS added, with no slots');
  eq(run([], { 50: seat() }, {}).changed, false, 'a seat whose class details are not cached yet is skipped, not guessed (the next fetch retries)');
  eq(run([], { 50: seat() }, { 50: { id: 50, _typeName: 'Ride' } }).changed, false, '…likewise a cache entry with no start time');
  eq(run([], { 50: seat() }, { 50: evt(50, '2026-09-18 07:00:00') }).added, ['50'], 'a class that has already run but is still listed is a class the member took → added');

  t.section('History reconcile: cancelled elsewhere');
  {
    const r = run([entry(60, '2026-09-25 18:30:00')], {}, {});
    eq([r.cancelled, r.history[0].cancelledAt, r.history[0].cancelledElsewhere], [['60'], NOW_ISO, true], 'upcoming, no seat any more → cancelled, and flagged as OUR inference');
    eq(run([entry(60, '2026-09-25 18:30:00')], { 60: place() }, { 60: evt(60, '2026-09-25 18:30:00') }).cancelled, ['60'], 'only a waitlist place left for it → the seat is gone');
    eq(run([entry(60, '2026-09-25 18:30:00')], { 60: seat() }, {}).cancelled, [], 'still holding it → untouched');
    eq(run([entry(60, '2026-09-25 18:30:00')], { 60: { bookingId: null, slots: [], slotBookings: {}, waitlisted: false } }, {}).cancelled, [],
      'anything that MAY be a seat (an optimistic entry with no id yet) keeps the entry alive — the two tests lean opposite ways on purpose');
    eq(run([entry(60, '2026-09-25 18:30:00', { cancelledAt: '2026-09-02T10:00:00.000Z' })], {}, {}).changed, false, 'already cancelled in-app → left exactly as it is');
  }
  {
    // 10:30 London now. The margin is 2h on the REAL start.
    eq(run([entry(61, '2026-09-21 12:31:00')], {}, {}).cancelled, ['61'], '12:31 London is 2h01 away → cancelled');
    eq(run([entry(61, '2026-09-21 12:30:00')], {}, {}).cancelled, [], 'exactly 2h away → left alone (Psycle may already have moved it out of "upcoming")');
    eq(run([entry(61, '2026-09-21 11:00:00')], {}, {}).cancelled, [], '30 minutes away → left alone');
    eq(run([entry(61, '2026-09-20 18:30:00')], {}, {}).cancelled, [], 'a past class is history, not a cancellation');
    eq(run([entry(61, 'soon'), entry(62, ''), entry(63, null), entry(64, undefined)], {}, {}).cancelled, [], 'an unreadable date is never provably "upcoming" → never cancelled');
  }
  {
    // The trap the London resolver exists for: 12:00 London = 11:00 UTC = 1h30 away (inside the margin).
    // Parsed device-locally in New York it reads 16:00 UTC — 6h30 away — and would be cancelled.
    const h = [entry(65, '2026-09-21 12:00:00')];
    eq(naive('2026-09-21 12:00:00') - NOW > 2 * H, true, '(the runner really is abroad: a device-local parse puts this class 6h30 away)');
    eq(run(h, {}, {}, { startMs: naive }).cancelled, ['65'], '…so a device-local resolver WOULD cancel it');
    eq(run(h, {}, {}).cancelled, [], 'the London resolver sees 1h30 → left alone');
    // UK clocks go back on Sun 25 Oct 2026: 12:00 that day is 12:00 UTC, not 11:00.
    eq(london('2026-10-25 12:00:00') - london('2026-10-24 12:00:00'), 25 * H, '(resolver is DST-correct per class date, which a single "offset right now" is not)');
  }

  t.section('History reconcile: what an untrusted snapshot would do (why the caller guards)');
  {
    const upcoming = [entry(70, '2026-09-25 18:30:00'), entry(71, '2026-09-28 07:00:00'), entry(72, '2026-09-10 07:00:00')];
    const r = run(upcoming, {}, {});
    eq(r.cancelled, ['70', '71'], 'handed the EMPTY map of a signed-out fetch, every upcoming class is marked cancelled — the function trusts its input by design');
    eq(r.history[2].cancelledAt, undefined, '(past classes are safe even then)');
  }

  t.section('History reconcile: its own cancellations are reversible');
  {
    const flagged = entry(80, '2026-09-25 18:30:00', { cancelledAt: '2026-09-20T09:00:00.000Z', cancelledElsewhere: true, slots: [3] });
    const r = run([flagged], { 80: seat({ slots: [21] }) }, { 80: evt(80, '2026-09-25 18:30:00') });
    eq([r.revived, r.added, r.history.length], [['80'], [], 1], 'the seat is back (another account was signed in, a truncated list…) → revived, not doubled up');
    eq([r.history[0].cancelledAt, r.history[0].cancelledElsewhere, r.history[0].slots], [undefined, undefined, [21]], 'both marks removed; the seat number is the one held now');
    eq(run([flagged], { 80: seat() }, {}).revived, ['80'], 'reviving needs no cached class details');

    const inApp = entry(81, '2026-09-25 18:30:00', { cancelledAt: '2026-09-20T09:00:00.000Z' });
    const r2 = run([inApp], { 81: seat() }, { 81: evt(81, '2026-09-25 18:30:00') });
    eq([r2.added, r2.revived, r2.history.length, r2.history[1].cancelledAt], [['81'], [], 2, '2026-09-20T09:00:00.000Z'],
      'a cancel the member made in-app, then a rebook: the "Cancelled" row stays and a new class is added (as addHistoryEntry always has)');
  }

  t.section('History reconcile: shape, cap and hostile input');
  {
    const h = [entry(90, '2026-09-25 18:30:00')];
    const before = JSON.stringify(h);
    const r = run(h, {}, {});
    eq([JSON.stringify(h) === before, r.history !== h, r.history[0] !== h[0]], [true, true, true], 'the input array and its entries are never mutated (the caller decides whether to write)');
    const many = [entry(1, '2026-08-01 07:00:00'), entry(2, '2026-08-02 07:00:00'), entry(3, '2026-08-03 07:00:00')];
    const capped = run(many, { 50: seat() }, { 50: evt(50, '2026-09-25 18:30:00') }, { max: 3 });
    eq(capped.history.map((x) => x.eventId), ['50', '1', '2'], 'the PSYCLE_HISTORY_MAX cap drops from the tail (oldest), never the class just added');
    eq(run(many, {}, {}, { max: 3 }).history.length, 3, 'at the cap with nothing added → nothing dropped');
    eq([run(null, null, null).history, run('junk', {}, {}).changed, run(undefined, undefined, undefined).changed], [[], false, false], 'no history / no bookings / no cache → empty and unchanged, never a throw');
    const junk = run([null, 'x', 7, entry(91, '2026-09-25 18:30:00')], { 50: seat() }, { 50: evt(50, '2026-09-25 18:30:00') });
    eq([junk.added, junk.cancelled], [['50'], ['91']], 'junk rows inside a stored history are stepped over');
  }

  // ── Wiring: the real wrapper ─────────────────────────────────────────────
  function world(o) {
    o = o || {};
    const clock = { now: NOW };
    class FixedDate extends Date {
      constructor(...a) { if (a.length) super(...a); else super(clock.now); }
      static now() { return clock.now; }
    }
    const log = { writes: 0, insights: 0, warns: [], timers: [], checks: [] };
    const store = t.makeFakeLocalStorage();
    const ls = {
      getItem: (k) => store.getItem(k),
      setItem: (k, v) => { if (k === 'psycle_class_history') log.writes++; store.setItem(k, v); },
      removeItem: (k) => store.removeItem(k),
    };
    store.setItem('psycle_class_history', JSON.stringify(o.history || []));
    if (o.owner !== undefined) store.setItem('psycle_class_history_owner', o.owner);
    if (o.queue) store.setItem('psycle_offline_queue', JSON.stringify(o.queue));
    const ctx = t.loadPure('js/features.js', 'history', {
      Date: FixedDate,
      localStorage: ls,
      console: { log() {}, warn: (...a) => log.warns.push(a.join(' ')), error: console.error },
      setTimeout: (fn, ms) => { log.timers.push({ fn, ms }); return 0; },
      document: { querySelector: () => (o.tab ? { id: o.tab } : null) },
    });
    ctx.window = ctx;
    ctx.__noteCheck = (fresh) => log.checks.push(fresh);
    ctx.PSYCLE_HISTORY_MAX = 2000;
    ctx._psycleClassStartMs = london;
    ctx.renderInsights = () => { log.insights++; };
    ctx._myBookings = {};
    ctx._eventCache = o.cache || {};
    ctx._bookingsLocalWriteAt = 0;
    // The verified member (app.js's currentUser): `user: null` = an unverified session.
    ctx.currentUser = o.user === undefined ? { id: 1 } : o.user;
    let token = o.token === undefined ? 'tok' : o.token;
    ctx.getBearerToken = () => token;
    // What app.js's fetchMyBookings does that matters here: swap the map in, say whether it was applied.
    ctx.fetchMyBookings = async function () {
      if (o.during) o.during(ctx, clock, (v) => { token = v; });
      ctx._myBookings = o.bookings || {};
      return o.result === undefined ? true : o.result;
    };
    t.vm.runInContext("var HISTORY_KEY = 'psycle_class_history';\nfunction checkWatchedEvents(fresh) { __noteCheck(fresh); }\n" +
      [grab('  function getHistory('), grab('  function saveHistory('), grab('  function _hasToken('), grab('  function _classStartMs('),
        grab('  function _historyOwnerId('), grab('  function _historyIsMine('),
        grab('  function reconcileHistoryWithBookings('), grab('  function patchFetchMyBookings(')].join('\n'), ctx);
    ctx.patchFetchMyBookings();
    const history = () => JSON.parse(store.getItem('psycle_class_history'));
    return { ctx, log, history, clock, owner: () => store.getItem('psycle_class_history_owner') };
  }
  const UPCOMING = [entry(70, '2026-09-25 18:30:00'), entry(71, '2026-09-28 07:00:00')];
  const live = (h) => h.filter((x) => !x.cancelledAt).map((x) => x.eventId);

  t.section('History wiring: a trusted snapshot is reconciled once');
  {
    const w = world({
      history: UPCOMING,
      bookings: { 70: seat(), 50: seat({ slots: [7] }), 51: seat({ slots: [8] }) },
      cache: { 50: evt(50, '2026-09-26 09:00:00'), 51: evt(51, '2026-09-27 09:00:00') },
    });
    eq(await w.ctx.fetchMyBookings(), true, 'the wrapper hands back exactly what fetchMyBookings resolved');
    eq([live(w.history()).sort(), w.history().find((x) => x.eventId === '71').cancelledElsewhere], [['50', '51', '70'], true],
      'two classes booked elsewhere added, the one cancelled elsewhere marked, the one still held untouched');
    eq(w.log.writes, 1, 'ONE history write for the whole pass (not one per class)');
    await w.ctx.fetchMyBookings();
    eq(w.log.writes, 1, 'a second fetch with nothing new writes nothing');
  }
  {
    const w = world({ history: [], bookings: { 50: seat() }, cache: { 50: evt(50, '2026-09-26 09:00:00') }, result: false });
    eq([await w.ctx.fetchMyBookings(), w.history().length], [false, 0], 'a superseded / failed fetch (false) is passed through and reconciles nothing');
    w.log.timers.forEach((x) => x.fn());
    eq([w.log.timers.map((x) => x.ms), w.log.checks], [[500], [false]], '…and the watchlist check that follows is told the fetch was NOT answered (it then sends nothing)');
    const good = world({ history: [], bookings: {} });
    await good.ctx.fetchMyBookings();
    good.log.timers.forEach((x) => x.fn());
    eq(good.log.checks, [true], 'an answered fetch → the check may talk to Psycle');
  }

  t.section('History wiring: snapshots that must NOT be trusted');
  {
    // clearToken() runs a signed-out fetchMyBookings: it resolves TRUE with an empty map.
    let w = world({ history: UPCOMING, token: '', bookings: {} });
    await w.ctx.fetchMyBookings();
    eq([live(w.history()), w.log.writes], [['70', '71'], 0], 'signed out: true + {} → history untouched (this alone would have cancelled every upcoming class)');

    w = world({ history: UPCOMING, token: '', bookings: {}, during: (c, clock, setToken) => setToken('tok') });
    await w.ctx.fetchMyBookings();
    eq(live(w.history()), ['70', '71'], 'a sign-in landing while the signed-out fetch was in flight: token present afterwards, map still empty → untouched');

    w = world({ history: UPCOMING, bookings: {}, during: (c, clock, setToken) => setToken('') });
    await w.ctx.fetchMyBookings();
    eq(live(w.history()), ['70', '71'], 'signed out while the fetch was in flight → untouched');

    // A cancel lands while the fetch is in flight: the snapshot still holds the seat just cancelled.
    const cancelled = [entry(70, '2026-09-25 18:30:00', { cancelledAt: '2026-09-21T09:29:00.000Z' })];
    w = world({ history: cancelled, bookings: { 70: seat() }, cache: { 70: evt(70, '2026-09-25 18:30:00') }, during: (c, clock) => { c._bookingsLocalWriteAt = clock.now + 5; } });
    await w.ctx.fetchMyBookings();
    eq([w.history().length, w.log.writes], [1, 0], 'raced by a local write → skipped (it would have re-added the class the member just cancelled)');
    w = world({ history: cancelled, bookings: { 70: seat() }, cache: { 70: evt(70, '2026-09-25 18:30:00') }, during: (c, clock) => { c._bookingsLocalWriteAt = clock.now; } });
    await w.ctx.fetchMyBookings();
    eq(w.history().length, 2, '(a write at or before the fetch began is not a race: that snapshot is newer than it)');

    w = world({ history: UPCOMING, bookings: {}, during: (c) => { delete c._bookingsLocalWriteAt; } });
    await w.ctx.fetchMyBookings();
    eq(live(w.history()), ['70', '71'], "app.js's write marker unreadable → assume raced, never guess");

    w = world({ history: UPCOMING, bookings: {}, queue: [{ type: 'cancel', eventId: 70 }] });
    await w.ctx.fetchMyBookings();
    eq(live(w.history()), ['70', '71'], "queued offline actions have not reached Psycle yet → its list is not the member's intent → untouched");
  }

  t.section('History wiring: the history belongs to ONE member of this install');
  {
    eq([p._historyOwnership('1', '1'), p._historyOwnership(1, '1'), p._historyOwnership('1', '2'), p._historyOwnership(null, '2'), p._historyOwnership('', '2'), p._historyOwnership('1', null), p._historyOwnership(null, null)],
      ['mine', 'mine', 'other', 'adopt', 'adopt', 'unknown', 'unknown'], 'mine / another member\'s / never stamped → adopt / nobody verified to ask for');

    // Member A's install. A signs out, B signs in: B's /bookings answer is a
    // trusted snapshot by every other guard (token before and after, no local
    // write, empty queue) — of the WRONG account.
    const bSeat = { bookings: { 900: seat() }, cache: { 900: evt(900, '2026-09-26 09:00:00') } };
    let w = world(Object.assign({ history: UPCOMING, owner: '1', user: { id: 2 } }, bSeat));
    await w.ctx.fetchMyBookings();
    eq([live(w.history()), w.log.writes, w.owner()], [['70', '71'], 0, '1'],
      'another account signed in: A\'s upcoming classes are NOT marked cancelled, B\'s seat is NOT added, the stamp stays A\'s');

    w = world(Object.assign({ history: UPCOMING, owner: '1', user: { id: 1 } }, { bookings: { 70: seat() } }));
    await w.ctx.fetchMyBookings();
    eq([live(w.history()), w.history().find((x) => x.eventId === '71').cancelledElsewhere], [['70'], true], 'A back on A\'s install → reconciled as ever');

    w = world(Object.assign({ history: UPCOMING, user: { id: 1 } }, { bookings: { 70: seat(), 71: seat() } }));
    await w.ctx.fetchMyBookings();
    eq([w.owner(), w.log.writes], ['1', 0], 'a history from before the stamp is adopted by the member who is signed in — even when nothing else changes');

    w = world(Object.assign({ history: UPCOMING, owner: '1', user: null }, bSeat));
    await w.ctx.fetchMyBookings();
    eq([live(w.history()), w.log.writes, w.owner()], [['70', '71'], 0, '1'], 'an unverified session (token kept, no profile) can load /bookings: nobody to ask for → untouched');
    w = world(Object.assign({ history: UPCOMING, user: null }, bSeat));
    await w.ctx.fetchMyBookings();
    eq([w.log.writes, w.owner()], [0, null], '…and it adopts nothing');

    // The account changes while the fetch is in flight: the list may be either one's.
    w = world(Object.assign({ history: UPCOMING, owner: '2', user: { id: 1 }, during: (c) => { c.currentUser = { id: 2 }; } }, bSeat));
    await w.ctx.fetchMyBookings();
    eq([live(w.history()), w.log.writes], [['70', '71'], 0], 'a different member after the fetch than before it → untouched, even though the stamp matches the new one');

    ok(/'psycle_class_history_owner'/.test(t.readSource('ios-app/www/native-bridge.js').split('function restoreFromNative')[0]),
      'native-bridge.js mirrors the stamp with the history it belongs to (SYNC_KEYS)');
  }

  t.section('History wiring: Stats is repainted only when it is showing and something changed');
  {
    let w = world({ history: [], bookings: { 50: seat() }, cache: { 50: evt(50, '2026-09-26 09:00:00') }, tab: 'tab-stats' });
    await w.ctx.fetchMyBookings();
    eq(w.log.insights, 1, 'Stats active + a class added → renderInsights (bookings:loaded painted it from the old history)');
    await w.ctx.fetchMyBookings();
    eq(w.log.insights, 1, 'nothing changed → no repaint');
    w = world({ history: [], bookings: { 50: seat() }, cache: { 50: evt(50, '2026-09-26 09:00:00') }, tab: 'tab-discover' });
    await w.ctx.fetchMyBookings();
    eq(w.log.insights, 0, 'another tab showing → no repaint (Stats renders from storage when opened)');
  }
  {
    const w = world({ history: [], bookings: { 50: seat() }, cache: { 50: evt(50, '2026-09-26 09:00:00') } });
    w.ctx.localStorage.getItem = () => { throw new Error('storage unavailable'); };
    eq(await w.ctx.fetchMyBookings(), true, 'a reconcile that throws never turns a good bookings fetch into a failed one');
  }
};
