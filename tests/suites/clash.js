'use strict';
// Clash detection (#63): the pure interval helper (pure:clash in js/app.js) and
// the places that speak it — the REAL bookClass confirms + picker hand-off,
// confirmJoinWaitlist and the headless "Book my week" path, sliced out of
// source and run against a scripted API. No new gate dialog exists on purpose:
// the line rides inside the confirms the member already sees.
module.exports = async function (t) {
  const { ok, eq } = t;
  const src = t.readSource('js/app.js');
  const grab = (opener, closer) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (from === -1 || to === -1) throw new Error('clash suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };

  const p = t.loadPure('js/app.js', 'clash');
  const seat = () => ({ bookingId: 'A', bookingIds: ['A'], slots: [5], slotBookings: { 5: 'A' }, waitlisted: false });
  // Held: a 7:00 Ride (45 min) at Oxford Circus, as event 10.
  const held = { 10: seat() };
  const cache = (extra) => Object.assign({
    10: { id: 10, start_at: '2026-09-21 07:00:00', duration: 45, _typeName: 'Ride', _locName: 'Oxford Circus' },
  }, extra || {});
  const evt = (start, o) => Object.assign({ id: 20, start_at: start, duration: 45, _typeName: 'Ride', _locName: 'Oxford Circus' }, o || {});
  const kind = (c) => (c ? c.kind : null);

  t.section('Clash: overlapping a seat already held');
  ok(typeof p._findClash === 'function' && typeof p._clashLabel === 'function', 'pure:clash exposes _findClash + _clashLabel');
  {
    const c = p._findClash(evt('2026-09-21 07:15:00', { _locName: 'Bank' }), held, cache());
    eq([kind(c), c && c.eventId, c && c.heldIsFirst], ['overlap', '10', true], '7:15 at Bank while holding 7:00 at Oxford Circus → overlap with event 10');
    eq(p._clashLabel(c), 'Clashes with your 07:00 Ride at Oxford Circus', 'the sentence names the held class, its time and its location');
    eq(kind(p._findClash(evt('2026-09-21 06:30:00'), held, cache())), 'overlap', 'starting BEFORE the held class and running into it is an overlap too');
    eq(kind(p._findClash(evt('2026-09-21 07:10:00', { duration: 20 }), held, cache())), 'overlap', 'a class wholly inside the held one overlaps');
    eq(p._findClash(evt('2026-09-22 07:15:00'), held, cache()), null, 'the same time on another day is no clash');
  }

  t.section('Clash: touching end-to-start is not a clash');
  eq(p._findClash(evt('2026-09-21 07:45:00'), held, cache()), null, 'held 7:00–7:45, new 7:45 at the SAME location → back-to-back double, no warning');
  eq(p._findClash(evt('2026-09-21 06:15:00'), held, cache()), null, 'new 6:15–7:00 ending as the held one starts → none');
  eq(kind(p._findClash(evt('2026-09-21 07:44:00'), held, cache())), 'overlap', 'one shared minute is an overlap');

  t.section('Clash: a missing duration counts as 45 minutes');
  {
    const noDur = cache({ 10: { id: 10, start_at: '2026-09-21 07:00:00', _typeName: 'Ride', _locName: 'Oxford Circus' } });
    eq(kind(p._findClash(evt('2026-09-21 07:40:00'), held, noDur)), 'overlap', 'held class with no duration: 7:40 still falls inside its assumed 45 min');
    eq(p._findClash(evt('2026-09-21 07:45:00'), held, noDur), null, '…and 7:45 sits exactly at its assumed end');
    eq(kind(p._findClash(evt('2026-09-21 06:20:00', { duration: undefined }), held, cache())), 'overlap', 'the NEW class with no duration is assumed 45 min as well (6:20 → 7:05)');
    eq(kind(p._findClash(evt('2026-09-21 06:20:00', { duration: '0' }), held, cache())), 'overlap', 'a zero / junk duration falls back to 45 rather than to an instant');
  }

  t.section('Clash: what is ignored');
  {
    const place = { 10: { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 900 } } };
    eq(p._findClash(evt('2026-09-21 07:15:00'), place, cache()), null, 'a waitlist place is not a seat → ignored');
    eq(p._findClash(evt('2026-09-21 07:00:00', { id: 10 }), held, cache()), null, 'the class itself (adding a second seat) never clashes with itself');
    eq(p._findClash(evt('2026-09-21 07:00:00', { id: '10' }), held, cache()), null, '…whether its id arrives as a number or a string');
    eq(p._findClash(evt('2026-09-21 07:15:00'), held, {}), null, 'a held class with no cache entry is skipped, not guessed');
    eq(p._findClash(evt('2026-09-21 07:15:00'), held, cache({ 10: { id: 10, start_at: 'soon', duration: 45 } })), null, 'a held class whose time cannot be read is skipped');
    eq([p._findClash(evt(''), held, cache()), p._findClash(evt(null), held, cache()), p._findClash(null, held, cache())], [null, null, null], 'no readable start on the new class → no answer');
    eq([p._findClash(evt('2026-09-21 07:15:00'), null, cache()), p._findClash(evt('2026-09-21 07:15:00'), {}, null)], [null, null], 'no bookings / no cache → none (never a throw)');
  }

  t.section('Clash: space- and T-form start_at read the same');
  {
    const tForm = cache({ 10: { id: 10, start_at: '2026-09-21T07:00:00', duration: 45, _typeName: 'Ride', _locName: 'Oxford Circus' } });
    eq(kind(p._findClash(evt('2026-09-21 07:15:00'), held, tForm)), 'overlap', 'new "YYYY-MM-DD HH:MM:SS" vs held "YYYY-MM-DDTHH:MM:SS"');
    eq(kind(p._findClash(evt('2026-09-21T07:15:00'), held, cache())), 'overlap', '…and the other way round');
    eq(kind(p._findClash(evt('2026-09-21T07:15'), held, cache())), 'overlap', 'seconds are optional');
    eq(p._clashStartMin('2026-09-21 07:00:00'), p._clashStartMin('2026-09-21T07:00:00'), 'both forms give the same minute');
    // The runner's zone is New York and the UK clocks change on this day: digits only, so neither matters.
    eq(p._clashStartMin('2026-03-29 07:00:00') - p._clashStartMin('2026-03-29 00:30:00'), 390, 'wall-clock minutes on the UK clocks-forward day: 6h30, no zone maths');
    const block = src.slice(src.indexOf('// ── pure:clash:start'), src.indexOf('// ── pure:clash:end'));
    ok(block.length > 0 && !/new Date\(/.test(block.replace(/\/\/.*$/gm, '')), 'the block never builds a Date from start_at (Invalid Date on iOS WebKit for the space form)');
  }

  t.section('Clash: a tight change between two locations');
  {
    const at = (start, loc, o) => p._findClash(evt(start, Object.assign({ _locName: loc }, o || {})), held, cache());
    const after = at('2026-09-21 08:00:00', 'Bank');
    eq([kind(after), after && after.gapMin, after && after.heldIsFirst], ['travel', 15, true], 'held ends 7:45 at Oxford Circus, new 8:00 at Bank → 15 min to change location');
    eq(p._clashLabel(after), 'Starts only 15 min after your 07:00 Ride at Oxford Circus ends — a different location', 'said as a squeeze, not as a clash');
    const before = at('2026-09-21 06:00:00', 'Bank');
    eq([kind(before), before && before.gapMin, before && before.heldIsFirst], ['travel', 15, false], 'new ends 6:45 at Bank, held starts 7:00 elsewhere → the same, the other way round');
    eq(p._clashLabel(before), 'Ends only 15 min before your 07:00 Ride at Oxford Circus starts — a different location', '…and worded for that order');
    eq(p._clashLabel(at('2026-09-21 07:45:00', 'Bank')), 'Starts as your 07:00 Ride at Oxford Circus ends — a different location', 'touching at two locations: no "0 min"');
    eq(at('2026-09-21 08:15:00', 'Bank'), null, 'a full 30 minutes between locations is fine');
    eq(at('2026-09-21 08:00:00', 'Oxford Circus'), null, 'the same location needs no travel time');
    eq(at('2026-09-21 08:00:00', ''), null, 'an unknown location never invents a travel warning');
    eq(p._findClash(evt('2026-09-21 08:00:00', { _locName: 'Bank' }), held, cache({ 10: { id: 10, start_at: '2026-09-21 07:00:00', duration: 45 } })), null, '…nor does an unknown location on the held class');
  }

  t.section('Clash: which one is reported');
  {
    // Held: 7:00 Oxford Circus (event 10), 8:00 Bank (event 11), 8:20 Bank (event 12).
    const three = { 10: seat(), 11: seat(), 12: seat() };
    const c3 = cache({
      11: { id: 11, start_at: '2026-09-21 08:00:00', duration: 45, _typeName: 'Barre', _locName: 'Bank' },
      12: { id: 12, start_at: '2026-09-21 08:20:00', duration: 45, _typeName: 'Yoga', _locName: 'Bank' },
    });
    // New: 8:10–8:55 at Bank. Travel squeeze with event 10 (ended 7:45 elsewhere, 25 min), overlaps 11 and 12.
    const c = p._findClash(evt('2026-09-21 08:10:00', { _locName: 'Bank' }), three, c3);
    eq([kind(c), c && c.eventId], ['overlap', '11'], 'an overlap outranks a travel squeeze, and the earliest overlapping class is named');
    eq(p._clashLabel(c), 'Clashes with your 08:00 Barre at Bank', 'label for it');
    eq(p._clashLabel({ kind: 'overlap', start_at: '2026-09-21 18:30:00', typeName: 'Class', locName: '' }), 'Clashes with your 18:30 class',
      "the 'Class' placeholder name and a missing location read naturally");
    eq(p._clashLabel({ kind: 'overlap', start_at: '2026-09-21 12:05:00', typeName: 'Ride', locName: 'Bank' }), 'Clashes with your 12:05 Ride at Bank', 'five past noon is 12:05 — 24-hour, no am / pm');
    eq(p._clashLabel({ kind: 'overlap', start_at: '2026-09-21 00:05:00', typeName: 'Ride', locName: 'Bank' }), 'Clashes with your 00:05 Ride at Bank', 'five past midnight is 00:05 (it read "12:05am")');
    eq(p._clashLabel(null), '', 'no clash → no sentence');
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  // Event 77 is the class being booked; event 10 (7:00 Oxford Circus) is held.
  function world(o) {
    o = o || {};
    const log = { confirms: [], pickers: [], posts: [], joins: [], joinConfirms: [], toasts: [], infos: [] };
    const globals = {
      _myBookings: o.bookings || { 10: seat() },
      _eventCache: Object.assign(cache(), { 77: { id: 77, start_at: '2026-09-21 07:15:00', duration: 45, _typeName: 'Ride', _locName: 'Bank', studio_id: 4 } }, o.cache || {}),
      _studioMap: { 4: o.studio || { has_layout: true, name: 'Studio 1', layout: { slots: [{ id: 7 }, { id: 9 }] } } },
      currentUser: { id: 1 },
      console: { log() {}, warn() {}, info: (...a) => log.infos.push(a.join(' ')), error: console.error },
      setTimeout: () => 0, clearTimeout: () => {},
      document: { createElement: () => btn() },
      getBearerToken: () => 'tok',
      openLoginPopup: () => {},
      toast: (msg) => log.toasts.push(msg),
      confirmModal: async (opts) => { log.confirms.push(opts); return o.confirm !== undefined ? o.confirm : false; },
      apiFetch: async (path) => {
        if (path !== '/events/77') throw new Error('unexpected call ' + path);
        return { ok: true, status: 200, json: async () => ({ slots: o.slots || [7, 9], data: o.detail || {} }) };
      },
      showBikePicker: (...a) => log.pickers.push(a),
      submitBooking: async (id, slots, b) => { log.posts.push(slots); b.textContent = 'Bike 7 ✓'; globals._myBookings[77] = seat(); },
      joinWaitlist: async (id) => { log.joins.push(id); return true; },
      leaveWaitlist: async () => {},
      slotLabelForEvent: () => 'Bike', _waitlistClassLine: () => 'Ride · Alex · Mon 21, 07:15', _parseSlots: (x) => x,
      _clearUnverifiedBooking: async () => true,
      _usualSlotForEvent: () => null,
      applyBookedState: () => {},
    };
    const ctx = t.loadPure('js/app.js', 'clash', globals);
    t.vm.runInContext("var _bookingsLoadState = 'loaded'; var MAX_SEATS = 2;\n" +
      [grab('function _busyLabel('), grab('function _clashFor('), grab('async function bookClass('),
        grab('async function confirmJoinWaitlist('), grab('async function _bookEventHeadless(')].join('\n'), ctx);
    // bookClass calls the (stubbed) confirmJoinWaitlist by default; `realJoin` lets the real one run.
    if (!o.realJoin) {
      const real = ctx.confirmJoinWaitlist;
      ctx.realConfirmJoinWaitlist = real;
      ctx.confirmJoinWaitlist = async (...a) => { log.joinConfirms.push(a); };
    }
    return { ctx, log };
  }
  function btn() {
    return { textContent: 'Book', className: 'book-btn', disabled: false, dataset: {}, style: {}, classList: { contains: () => false } };
  }
  const POLICY = "Psycle's normal 12-hour cancellation policy applies.";
  const CLASH = 'Clashes with your 07:00 Ride at Oxford Circus';

  t.section('Clash: said inside the confirms bookClass already shows (no extra gate)');
  {
    let w = world();
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.log.confirms.length, w.log.pickers.length], [0, 1], 'a layout class still goes straight to the picker — no clash dialog in front of it');
    eq(w.log.pickers[0][6], { clashLine: CLASH }, 'the picker is handed the line (7th argument — settings.js forwards `arguments`)');

    w = world({ slots: [7] });
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.log.confirms.map((c) => [c.title, c.warn]), [['Book this spot?', CLASH + '. ' + POLICY]], 'one seat left: the existing "Book this spot?" carries the clash first, then the policy');
    eq(w.log.posts, [], '…and declining it books nothing');

    w = world({ studio: { has_layout: false, name: 'Studio 2' } });
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.log.confirms.map((c) => [c.title, c.warn]), [['Book this class?', CLASH + '. ' + POLICY]], 'no-layout studio: the existing "Book this class?" carries it too');

    w = world({ bookings: {} });
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.log.pickers[0][6], { clashLine: '' }, 'nothing held at that time → an empty line');
    w = world({ bookings: {}, slots: [7] });
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.log.confirms[0].warn, POLICY, '…and the confirm reads exactly as before');
  }

  t.section('Clash: the just-fetched event time wins over the cached one');
  {
    // Cache says 7:15 (clash); Psycle now says the class moved to 9:00 (none).
    let w = world({ slots: [7], detail: { start_at: '2026-09-21 09:00:00', duration: 45 } });
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.log.confirms[0].warn, POLICY, 'moved clear of the held class → no stale warning');
    // Cache says 9:00 (none); Psycle says 7:15 (clash).
    w = world({ slots: [7], cache: { 77: { id: 77, start_at: '2026-09-21 09:00:00', duration: 45, _typeName: 'Ride', _locName: 'Bank' } }, detail: { start_at: '2026-09-21 07:15:00' } });
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.log.confirms[0].warn, CLASH + '. ' + POLICY, 'moved ONTO the held class → warned, though the cache knew nothing');
    w = world({ slots: [7], detail: { start_at: 'TBC' } });
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.log.confirms[0].warn, CLASH + '. ' + POLICY, 'an unreadable fetched time never replaces a good cached one');
  }

  t.section('Clash: joining a waitlist (Psycle can turn the place into a chargeable seat)');
  {
    let w = world({ detail: { is_fully_booked: true, is_waitlistable: true } });
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.log.joinConfirms.map((a) => a[2]), [CLASH], 'bookClass passes its line to confirmJoinWaitlist');

    w = world({ realJoin: true, detail: { is_fully_booked: true, is_waitlistable: true } });
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.log.confirms.map((c) => c.title), ['Join the waitlist?'], 'still the one consent dialog');
    ok(w.log.confirms[0].warn.indexOf(CLASH + '. One waitlist place per person.') === 0, 'its warning opens with the clash, then the waitlist policy');
    eq(w.log.joins, [], 'declined → no PUT');

    w = world({ realJoin: true });
    await w.ctx.confirmJoinWaitlist(77, btn());
    ok(w.log.confirms[0].warn.indexOf(CLASH + '. ') === 0, 'a caller that passes no line gets the one worked out from the cache');
    w = world({ realJoin: true, bookings: {} });
    await w.ctx.confirmJoinWaitlist(77, btn());
    ok(w.log.confirms[0].warn.indexOf('One waitlist place per person.') === 0, 'no clash → the warning reads exactly as before');
  }

  t.section('Clash: "Book my week" skips a hard overlap, and only that');
  {
    let w = world();
    eq(await w.ctx._bookEventHeadless(77, 4), 'skipped', 'headless, overlapping a held seat → skipped');
    eq([w.log.posts, w.log.joins], [[], []], '…with no POST and no waitlist join');
    ok(w.log.infos.some((m) => m.indexOf(CLASH) !== -1), 'the reason is logged (the sweep has one summary toast)');

    w = world({ detail: { is_fully_booked: true, is_waitlistable: true } });
    eq([await w.ctx._bookEventHeadless(77, 4), w.log.joins], ['skipped', []], 'a FULL overlapping class is not joined either');

    // Held 7:00–7:45 at Oxford Circus; template class 8:00 at Bank: tight, but the member's own plan.
    w = world({ cache: { 77: { id: 77, start_at: '2026-09-21 08:00:00', duration: 45, _typeName: 'Ride', _locName: 'Bank' } } });
    eq([await w.ctx._bookEventHeadless(77, 4), w.log.posts], ['booked', [[7]]], 'a travel squeeze is NOT skipped');

    w = world({ bookings: {} });
    eq([await w.ctx._bookEventHeadless(77, 4), w.log.posts], ['booked', [[7]]], 'nothing held → books as before');

    w = world();
    w.ctx._clashFor = () => { throw new Error('odd cache shape'); };
    eq(await w.ctx._bookEventHeadless(77, 4), 'booked', 'the lookup is advisory: if it throws, the class is booked as before');
    const b = btn();
    w = world({ slots: [7] });
    w.ctx._clashFor = () => { throw new Error('odd cache shape'); };
    await w.ctx.bookClass(77, b, 4);
    eq([w.log.confirms.map((c) => c.warn), w.log.toasts], [[POLICY], []], '…and bookClass carries on to its confirm with no error toast');
  }
};
