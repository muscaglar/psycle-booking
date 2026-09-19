'use strict';
// Booking integrity: the seat merge, the per-seat cancel id, the "what did
// that POST actually do?" decision table — and the wiring around them, run
// against the REAL submitBooking + the REAL reliability.js optimistic wrapper
// (sliced out of source) with a scripted API. Likewise the My Bookings cancels,
// Change spot, a Book tap in an unverified session, the class sheet's button
// and the offline-queue replay. These paths spend (or refund) credits.
module.exports = async function (t) {
  const { ok, eq } = t;

  // ── Pure helpers ─────────────────────────────────────────────────────────
  t.section('Booking: first tap after the usual bike was auto-selected');
  const p = t.loadPure('js/app.js', 'booking');
  ok(p._tapReplacesUsual([12], 12, 7, false) === true, 'usual 12 pre-selected, tap 7 → replaces (one seat, one credit)');
  ok(p._tapReplacesUsual([12], null, 7, false) === false, 'no auto-selection → a tap adds as before');
  ok(p._tapReplacesUsual([12, 9], 12, 7, false) === false, 'more than the auto-pick selected → normal eviction rules');
  ok(p._tapReplacesUsual([9], 12, 7, false) === false, 'the selection is no longer the auto-pick → adds');
  ok(p._tapReplacesUsual([12], 12, 7, true) === false, 'swap mode never pre-selects → untouched');
  ok(p._tapReplacesUsual([12], 12, 12, false) === false, 'tapping the usual itself is a deselect, not a replace');

  t.section('Booking: merging new seats into what is already held');
  eq(p._mergeBookedSeats(undefined, [7], 'B'),
    { bookingId: 'B', bookingIds: ['B'], slots: [7], slotBookings: { 7: 'B' }, waitlisted: false },
    'fresh single seat');
  const held = { bookingId: 'A', bookingIds: ['A'], slots: [5], slotBookings: { 5: 'A' }, waitlisted: false };
  const heldCopy = JSON.parse(JSON.stringify(held));
  const added = p._mergeBookedSeats(held, [7], 'B');
  eq(added.slots, [5, 7], 'add a seat: the seat already held survives');
  eq(added.slotBookings, { 5: 'A', 7: 'B' }, 'add a seat: each seat keeps its own record id');
  eq(added.bookingIds, ['A', 'B'], 'add a seat: a whole cancel knows both records');
  eq(held, heldCopy, 'the previous entry is not mutated (the wrapper restores it on failure)');
  const seed = p._mergeBookedSeats(held, [7], null);
  eq(seed.slots, [5, 7], 'optimistic seed (id unknown): both seats');
  eq(seed.slotBookings, { 5: 'A' }, 'optimistic seed: no record id is invented for the new seat');
  eq(seed.bookingId, 'A', 'optimistic seed: keeps the known entry id');
  eq(p._mergeBookedSeats(seed, [7], 'B'), added, 'idempotent: confirmed write over the seed == write over the original');
  eq(p._mergeBookedSeats(undefined, [5, 7], 'A').slotBookings, { 5: 'A', 7: 'A' }, 'two seats in one POST share the one returned id');
  const place = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 900 } };
  eq(p._mergeBookedSeats(place, [3], 'C').slots, [3], 'a seatless waitlist place contributes no seats');
  const spaces = p._mergeBookedSeats({ bookingId: 'A', bookingIds: ['A'], slots: [], slotBookings: {}, waitlisted: false }, [], 'B');
  eq(spaces.bookingIds, ['A', 'B'], 'no-layout "one more space": both record ids kept');
  eq(spaces.slots, [], 'no-layout: still slot-less');
  ok(p._mergeBookedSeats(Object.assign({ fromWaitlist: true }, held), [7], 'B').fromWaitlist === true, '"From waitlist" badge survives adding a seat');
  eq(p._mergeBookedSeats({ bookingId: 9, slots: [12], slotBookings: { 12: 9 } }, [12], 9).slots, [12], 'no duplicate seat');

  t.section('Booking: which record id may a per-seat cancel DELETE?');
  eq(p._seatCancelId(added, 5), 'A', 'own id, not shared → safe');
  eq(p._seatCancelId(added, '7'), 'B', 'slot id as a string resolves the same');
  eq(p._seatCancelId({ bookingId: 'A', slots: [5, 7], slotBookings: { 5: 'A', 7: 'A' }, waitlisted: false }, 7), null,
    'two seats sharing one id (fresh two-seat POST) → never guess');
  eq(p._seatCancelId({ bookingId: 'A', bookingIds: ['A'], slots: [5, 7], slotBookings: { 5: 'A' }, waitlisted: false }, 7), null,
    'seat with NO id must not fall back to the entry id (that is seat 5\'s record)');
  eq(p._seatCancelId({ bookingId: 'A', bookingIds: ['A'], slots: [5, 7], slotBookings: { 5: 'A', 7: undefined }, waitlisted: false }, 7), null,
    'an undefined id is not an id');
  eq(p._seatCancelId({ bookingId: 'A', slots: [5], slotBookings: {}, waitlisted: false }, 5), 'A', 'single seat, single record → the entry id is that seat');
  eq(p._seatCancelId({ bookingId: 'A', bookingIds: ['A', 'B'], slots: [5], slotBookings: {}, waitlisted: false }, 5), null, 'one seat listed but two records known → ambiguous');
  eq(p._seatCancelId({ bookingId: 'A', slots: [5], slotBookings: {}, waitlisted: false }, 9), null, 'a seat that is not in the entry');
  eq(p._seatCancelId(place, 5), null, 'a waitlist place has no seat to cancel');
  eq(p._seatCancelId(undefined, 5), null, 'no entry');

  t.section('Booking: can a whole cancel list every seat\'s record yet?');
  ok(p._recordIdsIncomplete({ bookingId: 'A', bookingIds: ['A'], slots: [5, 7], slotBookings: { 5: 'A', 7: 'A' }, waitlisted: false }) === true,
    'two seats sharing the one id their POST returned → incomplete');
  ok(p._recordIdsIncomplete(seed) === true, 'a new seat with no id yet → incomplete');
  ok(p._recordIdsIncomplete({ bookingId: null, slots: [7], slotBookings: {}, waitlisted: false }) === true, 'the optimistic entry (no id at all) → incomplete');
  ok(p._recordIdsIncomplete(added) === false, 'one record per seat → complete');
  ok(p._recordIdsIncomplete(held) === false, 'single seat, single record → complete');
  ok(p._recordIdsIncomplete(spaces) === false, 'no-layout spaces have no seats to match → not this check\'s business');
  ok(p._recordIdsIncomplete({ bookingId: null, bookingIds: [], slots: [], slotBookings: {}, waitlisted: false }) === true,
    'a no-layout space whose 2xx carried no id → incomplete (a cancel would fall back to an event-wide DELETE)');
  ok(p._recordIdsIncomplete(place) === false && p._recordIdsIncomplete(undefined) === false, 'a waitlist place / no entry → nothing to refresh');

  t.section('Booking: what a /bookings re-read says about an unanswered POST');
  eq(p._bookingOutcome(false, added, [7], 1).kind, 'unknown', 're-read not applied → unknown, even if local state looks booked');
  eq(p._bookingOutcome('late', added, [7], 1).kind, 'unknown', 'only a strict true counts as applied');
  eq(p._bookingOutcome(true, undefined, [7], 0), { kind: 'none', landed: [], missing: [7] }, 'no entry → none');
  eq(p._bookingOutcome(true, place, [7], 0).kind, 'none', 'only a waitlist place → none');
  eq(p._bookingOutcome(true, added, [7], 1), { kind: 'booked', landed: [7], missing: [] }, 'requested seat present → booked');
  eq(p._bookingOutcome(true, held, [7], 1), { kind: 'partial', landed: [], missing: [7] }, 'hold another seat only → partial');
  eq(p._bookingOutcome(true, held, [5, 7], 0), { kind: 'partial', landed: [5], missing: [7] }, 'one of two landed');
  eq(p._bookingOutcome(true, spaces, [], 1).kind, 'booked', 'count body: one more record than before → booked');
  eq(p._bookingOutcome(true, spaces, [], 2).kind, 'partial', 'count body: no new record → the extra space did not land');
  eq(p._bookingOutcome(true, { bookingId: 'A', slots: [], slotBookings: {}, waitlisted: false }, [], 0).kind, 'booked', 'count body, first space');

  // ── Wiring: real submitBooking + real optimistic wrapper ─────────────────
  const appSrc = t.readSource('js/app.js');
  const relSrc = t.readSource('js/reliability.js');
  // Top-level functions in app.js open at column 0 and close with a bare "}".
  const grab = (src, opener, closer) => {
    const lines = src.split('\n');
    const from = lines.findIndex(l => l.startsWith(opener));
    if (from === -1) throw new Error('booking suite: cannot find "' + opener + '"');
    const to = lines.findIndex((l, i) => i > from && l === closer);
    if (to === -1) throw new Error('booking suite: unterminated "' + opener + '"');
    return lines.slice(from, to + 1).join('\n');
  };
  const appFns = ['function _busyLabel(', 'function pluralizeSlotLabel(', 'function formatSlots(', 'function _scheduleBookingsRefetch(',
    'async function _rereadBookingsForVerify(', 'function _announceVerifiedSeats(', 'async function _settleUnverifiedBooking(',
    'async function _clearUnverifiedBooking(', 'async function submitBooking(']
    .map(o => grab(appSrc, o, '}')).join('\n');
  const wrapperSrc = grab(relSrc, '    window.submitBooking = async function optimisticSubmitBooking(', '    };');

  // One scripted world per scenario. `posts` = what POST /bookings answers (a
  // response, or an Error to throw); `reads` = what each fetchMyBookings does
  // (a map to swap in → true, false → not applied, 'hang' → never settles).
  function world(initial, posts, reads) {
    const log = { posts: [], readsAtPost: [], toasts: [], complete: [], confirmations: [], timers: [], reads: 0 };
    let token = 'tok';
    const globals = {
      _myBookings: initial,
      window: {},
      console: { log() {}, warn() {}, error: console.error }, // scripted timeouts are logged by design
      setTimeout: (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; },
      clearTimeout: () => {},
      getBearerToken: () => token,
      // _bookEventHeadless only: a layout studio with bike 7 free.
      document: { createElement: () => btn() },
      _studioMap: { 4: { has_layout: true, layout: { slots: [{ id: 7 }] } } },
      _eventCache: {},
      _usualSlotForEvent: () => null,
      apiFetch: async (path, opts) => {
        if (path === '/events/77' && !opts) return { ok: true, status: 200, json: async () => ({ slots: [7], data: {} }) };
        if (path !== '/bookings' || !opts || opts.method !== 'POST') throw new Error('unexpected call ' + path);
        log.posts.push(JSON.parse(opts.body));
        log.readsAtPost.push(log.reads);
        if (!posts.length) { ok(false, 'booking suite: an unscripted POST /bookings went out'); throw new Error('unscripted POST'); }
        const r = posts.shift();
        if (r instanceof Error) throw r;
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body || {} };
      },
      toast: (msg, type) => log.toasts.push({ msg, type }),
      slotLabelForEvent: () => 'Bike',
      showBookingConfirmation: (id, slots) => log.confirmations.push(slots),
      PsycleEvents: { emit: (name, id, slots) => { if (name === 'booking:complete') log.complete.push(slots); } },
      _recordBikeHistory: () => {},
      _rememberPlace: () => {},
      _noteLocalBookingWrite: () => {},
      refreshUpcomingPanel: () => {},
      confirmUnbook: () => {},
      joinWaitlist: () => { throw new Error('not a waitlist test'); },
    };
    const ctx = t.loadPure('js/app.js', 'booking', globals);
    // The real one is outside the booking region; same label rule.
    ctx.applyBookedState = (btn, id, booking) => {
      const s = booking.slots || [];
      btn.textContent = s.length ? ctx.formatSlots('Bike', s) + ' ✓' : 'Booked ✓';
      btn.className = 'book-btn booked';
      btn.disabled = false;
    };
    ctx.fetchMyBookings = () => {
      log.reads++;
      // As the real one: signed out = an emptied map, reported as applied.
      if (!token) { ctx._myBookings = {}; return Promise.resolve(true); }
      const r = reads.shift();
      if (r === 'hang') return new Promise(() => {});
      // The GET 401s: apiFetch expires the session (token cleared, map kept).
      if (r === 'expire') { token = null; return Promise.resolve(false); }
      if (r === false || r === undefined) return Promise.resolve(false);
      ctx._myBookings = JSON.parse(JSON.stringify(r));
      return Promise.resolve(true);
    };
    t.vm.runInContext('var _bookingsRefetchTimer = null; var _unverifiedBookings = {}; var BOOKING_VERIFY_DEADLINE_MS = 10000;\n' + appFns, ctx);
    t.vm.runInContext('var _originalSubmitBooking = submitBooking;\n' + wrapperSrc, ctx);
    // In the browser `window.submitBooking = …` rebinds the bare global too —
    // which is what _bookEventHeadless calls.
    ctx.submitBooking = ctx.window.submitBooking;
    t.vm.runInContext(grab(appSrc, 'async function _bookEventHeadless(', '}'), ctx);
    return { ctx, log, btn, submit: (slots, b, opts) => ctx.window.submitBooking(77, slots, b, opts) };
  }
  function btn(className) {
    const b = { textContent: 'Book', className: className || 'book-btn', disabled: false, dataset: {}, onclick: null };
    b.classList = { contains: c => b.className.split(/\s+/).includes(c) }; // read-only: what theme.js / old headless code looked at
    return b;
  }
  const seat5 = () => ({ 77: { bookingId: 'A', bookingIds: ['A'], slots: [5], slotBookings: { 5: 'A' }, waitlisted: false } });
  const seats57 = { 77: { bookingId: 'A', bookingIds: ['A', 'B'], slots: [5, 7], slotBookings: { 5: 'A', 7: 'B' }, waitlisted: false } };
  const hasTick = b => b.textContent.indexOf('✓') !== -1;

  t.section('Booking: "+ Add spot" keeps the seat already held (#52/#71)');
  {
    const w = world(seat5(), [{ status: 201, body: { data: { id: 'B' } } }], []);
    const b = w.btn();
    await w.submit([7], b);
    eq(w.log.posts, [{ event_id: 77, slots: [7] }], 'only the NEW seat is POSTed');
    eq(w.ctx._myBookings[77].slots, [5, 7], 'local state holds both seats');
    eq(w.ctx._myBookings[77].slotBookings, { 5: 'A', 7: 'B' }, 'each seat maps to its own record');
    eq(b.textContent, 'Bikes 5 & 7 ✓', 'the card label shows both bikes');
    eq(w.log.confirmations, [[7]], 'the confirmation overlay still announces just the new seat');
    ok(w.log.timers.some(x => x.ms === 400), 'a trailing /bookings refetch is scheduled');
    eq(w.log.reads, 0, '…and nothing is refetched synchronously');
  }
  {
    const w = world(seat5(), [{ status: 403, body: { message: 'No credits left' } }], []);
    const b = w.btn();
    await w.submit([7], b);
    eq(w.ctx._myBookings, seat5(), 'a refused add-a-seat restores exactly what was held');
    ok(!hasTick(b), 'and the label carries no tick');
    eq(w.log.reads, 0, 'a definitive 4xx needs no verification');
  }

  t.section('Booking: a confirmed seat marks its card at once, not when the refetch lands');
  {
    // css/redesign.css hides .cc-spots on .is-booked. Painted on the button
    // alone, "Only 1 left" stayed under "Bike 7 ✓" until the 400ms refetch came
    // back through applyBookedState — and for good when that refetch failed.
    const onCard = classes => {
      const set = new Set(classes);
      const b = btn();
      b.closest = sel => (sel === '.class-card' ? { classList: { add: c => set.add(c), remove: c => set.delete(c) } } : null);
      return { b, has: c => set.has(c) };
    };
    let w = world({}, [{ status: 200, body: { data: { id: 'A' } } }], []);
    let c = onCard(['class-card']);
    await w.submit([7], c.b);
    eq([c.b.textContent, c.has('is-booked'), w.log.reads], ['Bike 7 ✓', true, 0], 'a 200 → the card is .is-booked with the tick, before any /bookings read');
    const place = { 77: { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 'W1' } } };
    w = world(place, [{ status: 201, body: { data: { id: 'A' } } }], []);
    c = onCard(['class-card', 'is-waitlisted']);
    await w.submit([7], c.b);
    eq([c.has('is-booked'), c.has('is-waitlisted')], [true, false], 'a seat booked over a held waitlist place swaps the waitlist tint for the booked one');
    w = world({}, [{ status: 403, body: { message: 'No credits left' } }], []);
    c = onCard(['class-card']);
    await w.submit([7], c.b);
    ok(!c.has('is-booked'), 'a refused POST leaves the card alone');
  }

  t.section('Booking: a refused POST never leaves the button reading as booked');
  {
    // .booked is what theme.js's success haptic, the booked pill style and
    // "Book my week" read — the optimistic wrapper sets it BEFORE the POST.
    const w = world({}, [{ status: 403, body: { message: 'No credits left' } }], []);
    const b = w.btn();
    await w.submit([7], b);
    eq([b.textContent, b.className], ['Failed — retry', 'book-btn'], '403 on a fresh booking → the optimistic .booked is undone');
    ok(!w.ctx._myBookings[77], '…and no entry is left behind');
  }
  {
    const w = world({}, [{ status: 401, body: {} }], []);
    const b = w.btn();
    await w.submit([7], b);
    eq([b.textContent, b.className], ['Book', 'book-btn'], '401 (session expired mid-POST) → same');
  }
  {
    const w = world(seat5(), [{ status: 422, body: { message: 'Plan does not cover this class' } }], []);
    const b = w.btn('booking-action-btn'); // My Bookings' "+ Add spot"
    await w.submit([7], b);
    eq(b.className, 'booking-action-btn', 'a refused "+ Add spot" gets its own class back');
    const card = w.btn('book-btn booked'); // the Discover card of a class already held
    const w2 = world(seat5(), [{ status: 403, body: {} }], []);
    await w2.submit([7], card);
    eq(card.className, 'book-btn booked', 'a refused add-a-seat from the card stays .booked — bike 5 is still held');
    const stale = w.btn('book-btn booked'); // rendered as booked, but nothing is held any more
    const w3 = world({}, [{ status: 403, body: {} }], []);
    await w3.submit([7], stale);
    eq(stale.className, 'book-btn', '…but never .booked with no seat behind it');
  }
  {
    // "Book my week" counts what _bookEventHeadless reports.
    let w = world({}, [{ status: 403, body: { message: 'No credits left' } }], []);
    eq(await w.ctx._bookEventHeadless(77, 4), 'failed', 'headless: a refused class is reported failed, not booked');
    eq(w.log.posts, [{ event_id: 77, slots: [7] }], '(the POST did go out)');
    w = world({}, [{ status: 201, body: { data: { id: 'H' } } }], []);
    eq(await w.ctx._bookEventHeadless(77, 4), 'booked', 'headless: a confirmed seat is reported booked');
    w = world({}, [new Error('timeout')], [false, false]);
    eq(await w.ctx._bookEventHeadless(77, 4), 'failed', 'headless: an unconfirmed POST is not counted as booked');
  }

  t.section('Booking: a POST that never answered is verified, never guessed (#25)');
  {
    const w = world({}, [new Error('Load failed')], [{ 77: { bookingId: 'Z', bookingIds: ['Z'], slots: [7], slotBookings: { 7: 'Z' }, waitlisted: false } }]);
    const b = w.btn();
    await w.submit([7], b);
    eq(b.textContent, 'Bike 7 ✓', 'timeout, but /bookings shows the seat → booked');
    eq(w.log.complete, [[7]], 'booking:complete fires once');
    eq(w.ctx._myBookings[77].bookingId, 'Z', 'state is the server\'s entry — the wrapper did not revert it');
    ok(!w.log.toasts.some(x => /Load failed/.test(x.msg)), 'the raw network error is never shown');
    eq(w.log.posts.length, 1, 'the POST is not retried');
  }
  {
    // Landed late: the first re-read misses it, the member retries.
    const w = world({}, [new Error('timeout')], [{}, { 77: { bookingId: 'Z', bookingIds: ['Z'], slots: [7], slotBookings: { 7: 'Z' }, waitlisted: false } }]);
    const b = w.btn();
    await w.submit([7], b);
    eq(b.textContent, 'Failed — retry', 'timeout and no seat showing → a no-tick label');
    eq(b.className, 'book-btn', '…that does not read as booked (theme haptics / weekly-template count)');
    ok(!w.ctx._myBookings[77], 'no phantom entry is left behind');
    ok(w.log.toasts.some(x => /isn't showing in My Bookings/.test(x.msg)), 'the toast is hedged, not "nothing was booked"');
    ok(w.log.timers.some(x => x.ms === 3000), 'a delayed refetch is scheduled');
    const b2 = w.btn();
    await w.submit([9], b2); // picks a DIFFERENT bike on the retry
    eq(w.log.posts.length, 1, 'retry: the earlier POST had landed → NO second POST, no second credit');
    eq(b2.textContent, 'Bike 7 ✓', 'retry: the button shows the seat that was really booked');
    ok(w.log.toasts.some(x => /earlier booking went through/.test(x.msg)), 'retry: the member is told');
    eq(w.log.complete, [[7]], 'retry: history/calendar hear about the seat that landed');
  }
  {
    const w = world({}, [new Error('timeout'), { status: 201, body: { data: { id: 'Y' } } }], [{}, {}]);
    await w.submit([7], w.btn());
    const b2 = w.btn();
    await w.submit([7], b2);
    eq(w.log.posts.length, 2, 'retry after a verified "not booked" → the POST goes out');
    eq(b2.textContent, 'Bike 7 ✓', '…and books normally');
  }
  {
    const w = world({}, [new Error('timeout')], [false, false, false, false]);
    const b = w.btn();
    await w.submit([7], b);
    eq(b.textContent, 'Unconfirmed — retry', '/bookings unreachable → unconfirmed (neither booked nor failed)');
    ok(w.log.toasts.some(x => /Couldn't confirm/.test(x.msg) && /check My Bookings/.test(x.msg)), 'says to check before retrying');
    ok(!w.ctx._myBookings[77], 'the optimistic entry is dropped');
    eq(w.log.complete, [], 'nothing is announced as booked');
    const b2 = w.btn();
    await w.submit([7], b2);
    eq(w.log.posts.length, 1, 'still unverifiable → a retry sends NO second POST');
    eq(b2.textContent, 'Unconfirmed — retry', '…and says so');
  }
  {
    const w = world({}, [new Error('timeout')], ['hang']);
    const b = w.btn();
    const done = w.submit([7], b);
    await new Promise(r => setImmediate(r));
    const deadline = w.log.timers.find(x => x.ms === 10000);
    ok(!!deadline, 'the re-read races a 10s deadline');
    deadline.fn();
    await done;
    eq(b.textContent, 'Unconfirmed — retry', 'a re-read that outlives the deadline → unconfirmed, not a hung "…"');
  }
  {
    const w = world({}, [{ status: 502, body: {} }], [{ 77: { bookingId: 'Z', bookingIds: ['Z'], slots: [7], slotBookings: { 7: 'Z' }, waitlisted: false } }]);
    const b = w.btn();
    await w.submit([7], b);
    eq(b.textContent, 'Bike 7 ✓', 'a 5xx after a booking that landed → booked');
  }

  t.section('Booking: a 409 / "already" is ambiguous until /bookings answers (#25)');
  {
    const w = world(seat5(), [{ status: 409, body: { message: 'Slot taken' } }], [seat5()]);
    const b = w.btn();
    await w.submit([7], b);
    eq(b.textContent, 'Bike 5 ✓', 'lost the race for bike 7 → the button shows what IS held');
    eq(w.ctx._myBookings, seat5(), 'state is the server\'s (tick kept so the wrapper leaves it alone)');
    ok(w.log.toasts.some(x => x.msg === 'Bike 7 was just taken — pick another'), 'says the bike was taken — not "already booked"');
    eq(w.log.complete, [], 'no booking:complete for a seat we did not get');
  }
  {
    const w = world({}, [{ status: 409, body: {} }, { status: 201, body: { data: { id: 'Q' } } }], [{}]);
    const b = w.btn();
    await w.submit([7], b);
    eq(b.textContent, 'Book', 'lost the race with nothing held → bookable again');
    ok(!hasTick(b) && b.className === 'book-btn' && b.disabled === false, 'no phantom "Already booked ✓", button live');
    const b2 = w.btn();
    await w.submit([9], b2);
    eq(w.log.readsAtPost, [0, 1], 'a server refusal is definitive → the next attempt POSTs without another verify step');
    eq(b2.textContent, 'Bike 9 ✓', '…and books the other bike');
  }
  {
    // This API answers some business refusals with a 500: once a re-read has
    // shown no seat, the server's own reason beats our generic hedge.
    const w = world({}, [{ status: 500, body: { message: 'Not enough credits' } }], [{}]);
    const b = w.btn();
    await w.submit([7], b);
    eq(w.log.toasts.map(x => x.msg), ['Not enough credits'], 'a 500 with a reason, verified not booked → the reason is shown');
    eq(b.textContent, 'Failed — retry', '…on a no-tick label');
  }
  // …but a framework's stock body is no reason: Psycle's plain 500 answers
  // {"message":"Server Error"}, and that raw text was the toast.
  for (const stock of ['Server Error', 'server error.', 'Internal Server Error', 'Service Unavailable', 'Bad Gateway', 'Gateway Timeout', ' Error ']) {
    const w = world({}, [{ status: 500, body: { message: stock } }], [{}]);
    const b = w.btn();
    await w.submit([7], b);
    eq([w.log.toasts.map(x => x.msg), b.textContent], [["Psycle didn't confirm that booking and it isn't showing in My Bookings — try again"], 'Failed — retry'],
      'a 500 saying only ' + JSON.stringify(stock) + ' → the member wording, as for an empty body');
  }
  {
    const w = world({}, [{ status: 409, body: { message: 'You have already booked this class' } }], [{}]);
    const b = w.btn();
    await w.submit([7], b);
    ok(!w.log.toasts.some(x => /already booked/i.test(x.msg)), 'an "already booked" the re-read just disproved is never echoed');
    eq(b.textContent, 'Book', '…and the button does not claim a booking');
    ok(!w.ctx._myBookings[77], '…nor does state (the old code left a phantom "Already booked ✓" here)');
  }
  {
    const w = world(seat5(), [{ status: 422, body: { message: 'You have already booked this slot' } }], [seats57]);
    const b = w.btn();
    await w.submit([7], b);
    eq(b.textContent, 'Bikes 5 & 7 ✓', '"already" and /bookings agrees → booked');
    eq(w.log.complete, [[7]], 'announced once');
  }

  t.section('Booking: a partly-landed POST gates only the seat still in question');
  {
    const only7 = { 77: { bookingId: 'Z', bookingIds: ['Z'], slots: [7], slotBookings: { 7: 'Z' }, waitlisted: false } };
    const w = world({}, [new Error('timeout'), { status: 201, body: { data: { id: 'N' } } }], [only7, only7]);
    const b = w.btn();
    await w.submit([7, 9], b);
    eq(b.textContent, 'Bike 7 ✓', 'two asked for, one landed → the button shows the one held');
    eq(w.log.complete, [[7]], 'the landed seat is announced');
    ok(w.log.toasts.some(x => /Bike 9 isn't showing as booked/.test(x.msg)), 'the missing one is named');
    const b2 = w.btn();
    await w.submit([9], b2);
    eq(w.log.readsAtPost, [0, 2], 'next tap: /bookings is re-read first…');
    eq(w.log.posts.length, 2, '…bike 9 verifiably never landed → it is booked normally');
    eq(w.log.complete, [[7], [9]], 'bike 7 is NOT announced (or counted as a usual bike) a second time');
    ok(!w.log.toasts.some(x => /earlier booking went through/.test(x.msg)), 'no "your earlier booking went through" for a seat already announced');
    eq(w.ctx._myBookings[77].slots, [7, 9], 'both seats held');
  }
  {
    // …and when the missing seat turns up late, only IT is announced.
    const only7 = { 77: { bookingId: 'Z', bookingIds: ['Z'], slots: [7], slotBookings: { 7: 'Z' }, waitlisted: false } };
    const both = { 77: { bookingId: 'Z', bookingIds: ['Z', 'N'], slots: [7, 9], slotBookings: { 7: 'Z', 9: 'N' }, waitlisted: false } };
    const w = world({}, [new Error('timeout')], [only7, both]);
    await w.submit([7, 9], w.btn());
    const b2 = w.btn();
    await w.submit([9], b2);
    eq(w.log.posts.length, 1, 'the missing seat landed late → NO second POST');
    eq(w.log.complete, [[7], [9]], 'each seat announced exactly once');
    eq(b2.textContent, 'Bikes 7 & 9 ✓', 'the button shows both');
  }

  t.section("Booking: a refused add-a-seat says why (this API refuses with a 500)");
  {
    const w = world(seat5(), [{ status: 500, body: { message: 'Not enough credits' } }], [seat5()]);
    const b = w.btn('book-btn booked');
    await w.submit([7], b);
    eq(b.textContent, 'Bike 5 ✓', 'the seat already held still reads as booked');
    eq(w.log.toasts.map(x => x.msg), ["Bike 7 isn't showing as booked — Psycle said: Not enough credits"], "the server's reason is shown, with its subject");
    eq(w.ctx._myBookings, seat5(), 'state is what /bookings says');
    const w2 = world(seat5(), [{ status: 502, body: {} }], [seat5()]);
    await w2.submit([7], w2.btn());
    ok(w2.log.toasts.some(x => /Bike 7 isn't showing as booked — check My Bookings/.test(x.msg)), 'no reason given → the hedge as before');
    const w3 = world(seat5(), [{ status: 500, body: { message: 'Server Error' } }], [seat5()]);
    await w3.submit([7], w3.btn());
    eq(w3.log.toasts.map(x => x.msg), ["Bike 7 isn't showing as booked — check My Bookings before trying again"], 'a stock "Server Error" is no reason either → the hedge, never "Psycle said: Server Error"');
  }

  t.section('Booking: a session that dies mid-verify is "unconfirmed", never a verified "no seat"');
  {
    const other = { 88: { bookingId: 'K', bookingIds: ['K'], slots: [3], slotBookings: { 3: 'K' }, waitlisted: false } };
    const w = world(JSON.parse(JSON.stringify(other)), [new Error('timeout')], ['expire']);
    const b = w.btn();
    await w.submit([7], b);
    eq(b.textContent, 'Unconfirmed — retry', 'the verify GET 401s → unconfirmed (nothing was read)');
    eq(w.log.reads, 1, 'no second fetch: signed out, it would "apply" an emptied map');
    eq(w.ctx._myBookings, other, 'the bookings a session expiry deliberately keeps are still there');
    w.log.timers.filter(x => x.ms === 3000).forEach(x => x.fn());
    eq([w.log.reads, w.ctx._myBookings], [1, other], 'the trailing refetch does not empty them 3s later either');
    const b2 = w.btn();
    await w.submit([7], b2);
    eq(w.log.posts.length, 1, 'the class stays gated: no second POST while nothing can be verified');
  }

  t.section('Booking: no-layout count bodies are judged by record count');
  {
    const one = { 77: { bookingId: 'A', bookingIds: ['A'], slots: [], slotBookings: {}, waitlisted: false } };
    const two = { 77: { bookingId: 'A', bookingIds: ['A', 'B'], slots: [], slotBookings: {}, waitlisted: false } };
    let w = world(JSON.parse(JSON.stringify(one)), [new Error('timeout')], [two]);
    let b = w.btn();
    await w.submit(null, b, { spaces: 1 });
    eq(w.log.posts, [{ event_id: 77, slots: 1 }], 'count body');
    eq(b.textContent, 'Booked ✓', 'one more record than before → the extra space landed');
    eq(w.log.complete.length, 1, 'announced');
    w = world(JSON.parse(JSON.stringify(one)), [new Error('timeout'), { status: 201, body: { data: { id: 'B' } } }], [one, one]);
    b = w.btn();
    await w.submit(null, b, { spaces: 1 });
    ok(w.log.toasts.some(x => /extra space isn't showing as booked/.test(x.msg)), 'same record count → the extra space is not claimed');
    eq(w.log.complete, [], 'and not announced');
    ok(hasTick(b), 'the space already held still reads as booked');
    const b2 = w.btn();
    await w.submit(null, b2, { spaces: 1 });
    eq(w.log.readsAtPost, [0, 2], 'the retry re-reads /bookings BEFORE its POST (a count re-POST always books another space)');
    eq(w.ctx._myBookings[77].bookingIds, ['A', 'B'], 'verified not landed → the retry books it, both records kept');

    // …and when that re-read shows the first attempt DID land, no second space is bought.
    w = world(JSON.parse(JSON.stringify(one)), [new Error('timeout')], [one, two]);
    await w.submit(null, w.btn(), { spaces: 1 });
    const b3 = w.btn();
    await w.submit(null, b3, { spaces: 1 });
    eq(w.log.posts.length, 1, 'count body: the late-landing space is found on retry → NO second POST');
    ok(hasTick(b3), 'and the button reads as booked');
  }

  // ── Wiring: the My Bookings cancels ──────────────────────────────────────
  // Real upcomingSeatCancel / upcomingCancel / confirmUnbook (+ the helpers they
  // share) with a scripted API. `reads` as above; `statuses` = DELETE path →
  // status (default 204); `duringDialog(ctx)` runs while the confirm is "up".
  const cancelFns = ['function _busyLabel(', 'function _scheduleBookingsRefetch(', 'async function _rereadBookingsForVerify(', 'function _dropBookingKeepPlace(',
    'function _bookingIdsFor(', 'async function _readyForWholeCancel(', 'async function confirmUnbook(',
    'async function upcomingCancel(', 'async function upcomingSeatCancel(']
    .map(o => grab(appSrc, o, '}')).join('\n');
  const clone = o => JSON.parse(JSON.stringify(o));
  function cancelWorld(initial, reads, o) {
    o = o || {};
    const log = { deletes: [], toasts: [], events: [], queued: [], timers: [], reads: 0 };
    const globals = {
      _myBookings: clone(initial),
      navigator: { onLine: o.online !== false },
      console: { log() {}, warn() {}, error: console.error },
      setTimeout: (fn, ms) => { log.timers.push(ms); return log.timers.length; },
      clearTimeout: () => {},
      getBearerToken: () => 'tok',
      confirmCancelWithPolicy: async () => { if (o.duringDialog) o.duringDialog(ctx); return true; },
      apiFetch: async (path, opts) => {
        if (!opts || opts.method !== 'DELETE') throw new Error('unexpected call ' + path);
        log.deletes.push(path);
        const status = (o.statuses && o.statuses[path]) || 204;
        return { ok: status >= 200 && status < 300, status, json: async () => ({}) };
      },
      toast: (msg, type) => log.toasts.push({ msg, type }),
      slotLabelForEvent: () => 'Bike',
      leaveWaitlist: async () => { log.events.push('leaveWaitlist'); },
      queueOfflineCancel: (id, ids) => log.queued.push(ids),
      describeCancelError: res => 'Cancel failed (' + (res ? res.status : 'network') + ')',
      PsycleEvents: { emit: (name, id, slot) => log.events.push(slot != null ? name + ':' + slot : name) },
      _noteLocalBookingWrite: () => {}, _markSeatFreed: () => {}, _syncCardButtonsForEvent: () => {},
      _afterCardCancel: () => {}, refreshUpcomingPanel: () => {},
      applyBookedState: (b, id, booking) => { b.textContent = 'restored'; },
    };
    const ctx = t.loadPure('js/app.js', 'booking', globals);
    ctx.fetchMyBookings = () => {
      log.reads++;
      const r = reads.shift();
      if (!r) return Promise.resolve(false);
      ctx._myBookings = clone(r);
      return Promise.resolve(true);
    };
    t.vm.runInContext('var _bookingsRefetchTimer = null; var BOOKING_VERIFY_DEADLINE_MS = 10000;\n' + cancelFns, ctx);
    const chip = () => ({ textContent: '×', disabled: false, closest: () => null });
    return { ctx, log, chip };
  }
  // Bikes 5+7 booked in ONE POST: one id came back, both seats share it.
  const fresh57 = { 77: { bookingId: 'A', bookingIds: ['A'], slots: [5, 7], slotBookings: { 5: 'A', 7: 'A' }, waitlisted: false } };
  // "+ Add spot" whose 2xx carried no id: bike 7 has none, the entry id is bike 5's.
  const idless57 = { 77: { bookingId: 'A', bookingIds: ['A'], slots: [5, 7], slotBookings: { 5: 'A' }, waitlisted: false } };

  t.section('Cancel: the My Bookings seat × only ever DELETEs that seat\'s own record');
  {
    const w = cancelWorld(fresh57, [seats57]);
    await w.ctx.upcomingSeatCancel(77, 7, w.chip());
    eq(w.log.deletes, ['/bookings/B'], 'shared provisional id → /bookings is re-read, then bike 7\'s OWN record goes (never A)');
    eq(w.ctx._myBookings[77].slots, [5], 'bike 5 is still held — in the LIVE entry');
    ok(w.log.events.includes('seat:cancelled:7'), 'seat:cancelled fires');
    ok(w.log.timers.includes(400), 'and /bookings is refetched afterwards');
  }
  {
    const w = cancelWorld(fresh57, []);
    const c = w.chip();
    await w.ctx.upcomingSeatCancel(77, 7, c);
    eq(w.log.deletes, [], 're-read failed → NOTHING is sent (the old code sent DELETE /bookings/A — bike 5\'s record)');
    ok(w.log.toasts.some(x => /nothing was cancelled/.test(x.msg)), 'says nothing was cancelled');
    ok(c.disabled === false, 'the × is live again');
    eq(w.ctx._myBookings, fresh57, 'state untouched');
  }
  {
    const w = cancelWorld(idless57, []);
    await w.ctx.upcomingSeatCancel(77, 7, w.chip());
    eq(w.log.deletes, [], 'a seat with no id never falls back to the entry id or an event-wide DELETE');
  }
  {
    // The trailing refetch lands while the confirm dialog is up.
    const w = cancelWorld(fresh57, [], { duringDialog: ctx => { ctx._myBookings = clone(seats57); } });
    await w.ctx.upcomingSeatCancel(77, 7, w.chip());
    eq([w.log.deletes, w.log.reads], [['/bookings/B'], 0], 'the entry is read AFTER the dialog — fresh ids, no extra read');
    eq(w.ctx._myBookings[77].slots, [5], 'and the live entry is the one edited (not the dead pre-dialog object)');
  }
  {
    const w = cancelWorld(seats57, [], { statuses: { '/bookings/B': 404 } });
    await w.ctx.upcomingSeatCancel(77, 7, w.chip());
    eq(w.ctx._myBookings[77].slots, [5], 'a 404 on the seat\'s own record = already gone');
    const w2 = cancelWorld(seats57, [], { statuses: { '/bookings/B': 403 } });
    await w2.ctx.upcomingSeatCancel(77, 7, w2.chip());
    eq(w2.ctx._myBookings[77].slots, [5, 7], 'any other refusal leaves the seat in place');
    const w3 = cancelWorld(fresh57, [seats57], { online: false });
    await w3.ctx.upcomingSeatCancel(77, 7, w3.chip());
    eq([w3.log.deletes, w3.log.reads], [[], 0], 'offline with an unprovable id → nothing sent, nothing read');
  }

  t.section('Cancel: "Cancel all" removes one record per seat — or nothing');
  {
    const ids = w => w.log.deletes.slice().sort();
    let w = cancelWorld(fresh57, [seats57]);
    let b = { textContent: 'Cancel all 2', disabled: false };
    await w.ctx.upcomingCancel(77, b);
    eq(ids(w), ['/bookings/A', '/bookings/B'], 'shared provisional id → re-read first, then BOTH records (the old code sent A twice and called the 404 a success)');
    ok(!w.ctx._myBookings[77] && w.log.events.includes('booking:cancelled'), 'cancelled and announced');
    ok(w.log.timers.includes(400), 'and /bookings is refetched afterwards');

    w = cancelWorld(fresh57, []);
    b = { textContent: 'Cancel all 2', disabled: false };
    await w.ctx.upcomingCancel(77, b);
    eq(ids(w), [], 're-read failed → nothing is sent');
    eq([b.textContent, b.disabled], ['Cancel all 2', false], 'the button is put back');
    ok(w.log.toasts.some(x => /nothing was cancelled/.test(x.msg)) && !w.log.events.includes('booking:cancelled'), 'and nothing is announced as cancelled');
    eq(w.ctx._myBookings, fresh57, 'state untouched');

    w = cancelWorld(idless57, [seats57]);
    await w.ctx.upcomingCancel(77, { textContent: 'Cancel all 2', disabled: false });
    eq(ids(w), ['/bookings/A', '/bookings/B'], 'a seat with no id yet → re-read, then both (the old code cancelled only A and said "Booking cancelled")');

    w = cancelWorld(seats57, []);
    await w.ctx.upcomingCancel(77, { textContent: 'Cancel all 2', disabled: false });
    eq([ids(w), w.log.reads], [['/bookings/A', '/bookings/B'], 0], 'a server-loaded entry needs no re-read');

    w = cancelWorld(seats57, [], { duringDialog: ctx => { ctx._myBookings = {}; } });
    await w.ctx.upcomingCancel(77, { textContent: 'Cancel all 2', disabled: false });
    eq(ids(w), [], 'the booking went while the dialog was up → nothing is sent');

    w = cancelWorld(seats57, [], { duringDialog: ctx => { ctx._myBookings = { 77: clone(place) }; } });
    await w.ctx.upcomingCancel(77, { textContent: 'Cancel all 2', disabled: false });
    eq(ids(w), [], '…or became just a waitlist place → never DELETE /bookings');

    w = cancelWorld(fresh57, [seats57], { online: false });
    await w.ctx.upcomingCancel(77, { textContent: 'Cancel all 2', disabled: false });
    eq([w.log.queued, ids(w)], [[], []], 'offline: a cancel known to be incomplete is not queued as if it were whole');
    w = cancelWorld(seats57, [], { online: false });
    await w.ctx.upcomingCancel(77, { textContent: 'Cancel all 2', disabled: false });
    eq(w.log.queued, [['A', 'B']], 'offline with every record known → queued as before');

    // The Discover card right after a two-seat booking (its onclick is confirmUnbook until the refetch re-wires it).
    w = cancelWorld(fresh57, [seats57]);
    await w.ctx.confirmUnbook('A', 77, { textContent: 'Bikes 5 & 7 ✓', disabled: false });
    eq(ids(w), ['/bookings/A', '/bookings/B'], 'confirmUnbook: same rule');
    w = cancelWorld(fresh57, []);
    b = { textContent: 'Bikes 5 & 7 ✓', disabled: false };
    await w.ctx.confirmUnbook('A', 77, b);
    eq([ids(w), b.textContent, b.disabled], [[], 'restored', false], 'confirmUnbook: re-read failed → nothing sent, button restored from state');
    eq(w.ctx._bookingIdsFor(fresh57[77]), ['A'], '_bookingIdsFor lists a shared id once');
    eq(w.ctx._bookingIdsFor({ bookingIds: ['A', 'A', 'B'], slots: [], slotBookings: {} }), ['A', 'B'], '…for no-layout records too');
  }

  // ── Wiring: Change spot (DELETE old seat, then POST the new one) ─────────
  const swapFns = [grab(appSrc, 'function _clock24(', '}'), grab(appSrc, 'function _cancelDeadline(', '}'), grab(appSrc, 'window.changeSpot = async function(eventId) {', '};'), grab(appSrc, 'function _repaintKeepingFocus(', '}'), grab(appSrc, 'function renderChangeSpotHint(', '}'),
    grab(appSrc, 'window.setChangeSpotTarget = function (slot) {', '};'), grab(appSrc, 'async function executeSpotSwap(', '}')].join('\n');
  // `script`: call → a status, an Error to throw (the request never answered),
  // or { status, body }. Unscripted: DELETE 204, POST 201.
  function swapWorld(initial, reads, script) {
    const log = { calls: [], toasts: [], pickers: 0, closed: 0, timers: [], renders: 0, localWrites: 0 };
    const els = {};
    const globals = {
      _myBookings: clone(initial), window: {}, _selectedSlots: [9],
      _eventCache: { 77: { start_at: '2099-01-01 10:00:00', studio_id: 4 } },
      _studioMap: { 4: { has_layout: true, layout: { slots: [{ id: 5 }, { id: 7 }, { id: 9 }, { id: 11 }] } } },
      console: { log() {}, warn() {}, error: console.error },
      setTimeout: (fn, ms) => { log.timers.push(ms); return 0; }, clearTimeout: () => {},
      getBearerToken: () => 'tok',
      document: { getElementById: id => els[id] || (els[id] = { textContent: '', innerHTML: '', disabled: false }) },
      apiFetch: async (path, opts) => {
        if (path === '/events/77' && !opts) return { ok: true, status: 200, json: async () => ({ slots: [9, 11], data: {} }) };
        const call = opts.method + ' ' + path + (opts.body ? ' ' + opts.body : '');
        log.calls.push(call);
        const r = script && script[call];
        if (r instanceof Error) throw r;
        const status = (r && r.status) || r || (opts.method === 'DELETE' ? 204 : 201);
        return { ok: status >= 200 && status < 300, status, json: async () => (r && r.body) || {} };
      },
      toast: (msg, type) => log.toasts.push({ msg, type }),
      slotLabelForEvent: () => 'Bike',
      showBikePicker: () => { log.pickers++; },
      _adjustBikeHistoryForSwap: () => {},
      _noteLocalBookingWrite: () => { log.localWrites++; },
      refreshUpcomingPanel: () => { log.renders++; },
      PsycleEvents: { emit: () => {} },
    };
    const ctx = t.loadPure('js/app.js', 'booking', globals);
    ctx.closeBikePicker = () => { log.closed++; ctx.window._changeSpotContext = null; };
    ctx.fetchMyBookings = () => {
      const r = reads.shift();
      if (!r) return Promise.resolve(false);
      ctx._myBookings = clone(r);
      return Promise.resolve(true);
    };
    t.vm.runInContext('var _swapInFlight = false; var _bookingsRefetchTimer = null; var BOOKING_VERIFY_DEADLINE_MS = 10000;\n' +
      grab(appSrc, 'function _scheduleBookingsRefetch(', '}') + '\n' + grab(appSrc, 'async function _rereadBookingsForVerify(', '}') + '\n' + swapFns, ctx);
    return { ctx, log };
  }

  t.section('Change spot: never swaps off a record id it cannot prove is that seat\'s');
  {
    let w = swapWorld(fresh57, []);
    await w.ctx.window.changeSpot(77);
    eq([w.log.pickers, !!w.ctx.window._changeSpotContext], [0, false], 'seats share a provisional id and /bookings can\'t be re-read → the picker never opens (the old code fell back to local state)');
    ok(w.log.toasts.some(x => /nothing was changed/.test(x.msg)), 'and says why');

    w = swapWorld(fresh57, [seats57]);
    await w.ctx.window.changeSpot(77);
    eq([w.log.pickers, w.ctx.window._changeSpotContext.slotToChange, w.ctx.window._changeSpotContext.bookingId], [1, 5, 'A'], 're-read lands → bike 5 with ITS record');
    w.ctx.window.setChangeSpotTarget(7);
    eq(w.ctx.window._changeSpotContext.bookingId, 'B', 'retarget to bike 7 → bike 7\'s own record');
    w.ctx.window._changeSpotContext.booking = clone(idless57[77]); // a seat whose id is unknown
    w.ctx.window.setChangeSpotTarget(5);
    w.ctx.window.setChangeSpotTarget(7);
    eq([w.ctx.window._changeSpotContext.slotToChange, w.ctx.window._changeSpotContext.bookingId], [5, 'A'], 'a seat with no record of its own can\'t become the target (never the entry id)');

    w = swapWorld(seats57, []);
    w.ctx.window._changeSpotContext = { eventId: 77, slotToChange: 7, bookingId: null, booking: clone(idless57[77]) };
    await w.ctx.executeSpotSwap();
    eq(w.log.calls, [], 'no record id → NOTHING is sent (the old code sent DELETE /bookings?event_id=77 — every seat in the class)');

    // New seat refused, old seat re-POSTed, but /bookings can't say what is held now.
    const post9 = 'POST /bookings {"event_id":77,"slots":[9]}';
    w = swapWorld(seats57, [], { [post9]: 409 });
    w.ctx.window._changeSpotContext = { eventId: 77, slotToChange: 7, bookingId: 'B', booking: clone(seats57[77]) };
    await w.ctx.executeSpotSwap();
    eq(w.log.calls, ['DELETE /bookings/B', post9, 'POST /bookings {"event_id":77,"slots":[7]}'], 'swap: own record, new seat, then win the old one back');
    eq(w.log.closed, 1, 'outcome unknown → the picker closes: no retry off the stale entry (it would 404 the old id, then book a SECOND seat)');
    ok(w.log.toasts.some(x => /Check My Bookings/.test(x.msg)), 'and the member is sent to My Bookings');

    const back = { 77: { bookingId: 'A', bookingIds: ['A', 'C'], slots: [5, 7], slotBookings: { 5: 'A', 7: 'C' }, waitlisted: false } };
    w = swapWorld(seats57, [back], { [post9]: 409 });
    w.ctx.window._changeSpotContext = { eventId: 77, slotToChange: 7, bookingId: 'B', booking: clone(seats57[77]) };
    await w.ctx.executeSpotSwap();
    eq([w.log.closed, w.ctx.window._changeSpotContext.bookingId, w.ctx.window._changeSpotContext.cancelDone], [0, 'C', false],
      'old seat verifiably back → retry stays possible, aimed at its NEW record');
  }

  t.section('Change spot: what is left of a booking once a seat has been released');
  eq(p._withoutSeat(seats57[77], 5, 'A'), { bookingId: 'B', bookingIds: ['B'], slots: [7], slotBookings: { 7: 'B' }, waitlisted: false },
    'two seats: the other seat and ITS record stay, the entry id moves to a live record');
  eq(p._withoutSeat(seat5()[77], 5, 'A'), null, 'the only seat → nothing is left');
  eq(p._withoutSeat(fresh57[77], 5, 'A'), { bookingId: null, bookingIds: [], slots: [7], slotBookings: {}, waitlisted: false },
    'a seat still mapped to the dead id loses it (so _seatCancelId asks /bookings, never a 404)');
  ok(p._withoutSeat(Object.assign({ fromWaitlist: true }, seats57[77]), 7, 'B').fromWaitlist === true, '"From waitlist" badge survives');
  eq([p._withoutSeat(place, 5, 'A'), p._withoutSeat(undefined, 5, 'A')], [null, null], 'a waitlist place / no entry → nothing');
  { const before = clone(seats57[77]); p._withoutSeat(before, 5, 'A'); eq(before, seats57[77], 'the entry is not mutated'); }

  t.section('Change spot: a successful swap is recorded locally (the refetch may never land)');
  {
    const post9 = 'POST /bookings {"event_id":77,"slots":[9]}';
    const swapCtx = (w, slot, id, map) => { w.ctx.window._changeSpotContext = { eventId: 77, slotToChange: slot, bookingId: id, booking: clone(map[77]) }; };
    let w = swapWorld(seat5(), [], { [post9]: { status: 201, body: { data: { id: 'N' } } } });
    swapCtx(w, 5, 'A', seat5());
    await w.ctx.executeSpotSwap();
    eq(w.log.calls, ['DELETE /bookings/A', post9], 'swap 5 → 9');
    eq(w.ctx._myBookings[77], { bookingId: 'N', bookingIds: ['N'], slots: [9], slotBookings: { 9: 'N' }, waitlisted: false },
      'the entry is on bike 9 under ITS record at once (the old code left bike 5 / record A until a refetch that may fail)');
    eq([w.log.localWrites, w.log.renders, w.log.closed], [1, 1, 1], 'a local write is noted, My Bookings repaints, the picker closes');
    ok(w.log.timers.includes(400), 'and /bookings is refetched (scheduled, token-checked) to replace the provisional entry');
    // The refetch never lands; the member changes spot again.
    w.ctx._selectedSlots = [11];
    await w.ctx.window.changeSpot(77);
    eq([w.ctx.window._changeSpotContext.slotToChange, w.ctx.window._changeSpotContext.bookingId], [9, 'N'], 'second Change spot targets bike 9 and its new record');
    await w.ctx.executeSpotSwap();
    eq(w.log.calls.slice(2), ['DELETE /bookings/N', 'POST /bookings {"event_id":77,"slots":[11]}'],
      'bike 9 is released before 11 is booked (the old code 404ed DELETE A, then booked 11 ON TOP of 9)');
    eq(w.ctx._myBookings[77].slots, [11], 'one seat held');

    w = swapWorld(seats57, [], { [post9]: { status: 201, body: { data: { id: 'N' } } } });
    swapCtx(w, 7, 'B', seats57);
    await w.ctx.executeSpotSwap();
    eq(w.ctx._myBookings[77], { bookingId: 'N', bookingIds: ['A', 'N'], slots: [5, 9], slotBookings: { 5: 'A', 9: 'N' }, waitlisted: false },
      'two seats: the one not swapped keeps its seat and record');

    w = swapWorld({ 77: Object.assign({ fromWaitlist: true, waitlist: { id: 900 } }, seat5()[77]) }, [], {});
    swapCtx(w, 5, 'A', seat5());
    await w.ctx.executeSpotSwap();
    eq([w.ctx._myBookings[77].fromWaitlist, w.ctx._myBookings[77].waitlist, w.ctx._myBookings[77].slotBookings], [true, { id: 900 }, {}],
      'the waitlist place / badge stay attached; a 2xx with no id invents none (Change spot then re-reads)');
  }

  t.section('Change spot: a 404 on the old seat\'s record is checked against /bookings');
  {
    const gone = { 'DELETE /bookings/A': 404 };
    const on9 = { 77: { bookingId: 'N', bookingIds: ['N'], slots: [9], slotBookings: { 9: 'N' }, waitlisted: false } };
    const run = async (reads) => {
      const w = swapWorld(seat5(), reads, gone);
      w.ctx._selectedSlots = [11];
      w.ctx.window._changeSpotContext = { eventId: 77, slotToChange: 5, bookingId: 'A', booking: clone(seat5()[77]) };
      await w.ctx.executeSpotSwap();
      return w;
    };
    let w = await run([on9]); // stale entry: the seat already moved to bike 9
    eq(w.log.calls, ['DELETE /bookings/A'], 'the seat had already moved → NO POST (it would have been a second, chargeable seat)');
    eq([w.log.closed, w.ctx._myBookings[77].slots], [1, [9]], 'the picker closes on the server\'s entry');
    ok(w.log.toasts.some(x => /changed since you opened it/.test(x.msg)), 'and says the booking changed');
    w = await run([{}]); // an earlier attempt's DELETE landed without an answer
    eq(w.log.calls, ['DELETE /bookings/A', 'POST /bookings {"event_id":77,"slots":[11]}'], 'the seat really was released → the swap carries on');
    w = await run([]);
    eq([w.log.calls, w.log.closed], [['DELETE /bookings/A'], 1], '/bookings unreadable → nothing more is sent, the picker closes');
    ok(w.log.toasts.some(x => /Check My Bookings/.test(x.msg)), 'and the member is sent to My Bookings');
  }

  t.section('Change spot: a new-seat POST that never answered is verified before the old seat is re-POSTed');
  {
    const post9 = 'POST /bookings {"event_id":77,"slots":[9]}';
    const post5 = 'POST /bookings {"event_id":77,"slots":[5]}';
    const on9 = { 77: { bookingId: 'N', bookingIds: ['N'], slots: [9], slotBookings: { 9: 'N' }, waitlisted: false } };
    const back5 = { 77: { bookingId: 'C', bookingIds: ['C'], slots: [5], slotBookings: { 5: 'C' }, waitlisted: false } };
    const both = { 77: { bookingId: 'C', bookingIds: ['C', 'N'], slots: [5, 9], slotBookings: { 5: 'C', 9: 'N' }, waitlisted: false } };
    const run = async (answer, reads) => {
      const w = swapWorld(seat5(), reads, { [post9]: answer });
      w.ctx.window._changeSpotContext = { eventId: 77, slotToChange: 5, bookingId: 'A', booking: clone(seat5()[77]) };
      await w.ctx.executeSpotSwap();
      return w;
    };
    for (const [what, answer] of [['timeout', new Error('Request timed out')], ['502', 502]]) {
      let w = await run(answer, [on9]);
      eq(w.log.calls, ['DELETE /bookings/A', post9], what + ', but bike 9 DID book → bike 5 is NOT re-POSTed (the old code re-booked it: two seats, "Swap failed")');
      ok(w.log.toasts.some(x => x.msg === 'Bike changed: 5 → 9' && x.type === 'success') && w.log.closed === 1, what + ' → announced as the swap it was');
      w = await run(answer, []);
      eq([w.log.calls, w.log.closed], [['DELETE /bookings/A', post9], 1], what + ' and /bookings unreadable → NO blind re-POST, the picker closes');
      ok(w.log.toasts.some(x => /couldn't confirm which bike you hold now/.test(x.msg)) && w.log.timers.includes(3000), what + ' → "check My Bookings", refetch scheduled');
      w = await run(answer, [{}, back5]);
      eq(w.log.calls, ['DELETE /bookings/A', post9, post5], what + ', verified NOT booked → the old seat is won back as before');
      eq([w.log.closed, w.ctx.window._changeSpotContext.bookingId], [0, 'C'], what + ' → retry stays possible, aimed at the new record');
      w = await run(answer, [{}, both]);
      eq([w.log.closed, w.ctx.window._changeSpotContext], [1, null], what + ', and bike 9 landed late → both held: the picker closes, no retry loop');
      ok(w.log.toasts.some(x => /hold both Bike 5 and Bike 9/.test(x.msg)), what + ' → the member is told both are held');
    }
    const w = await run(409, [on9]);
    eq(w.log.calls, ['DELETE /bookings/A', post9, post5], 'a 4xx is a refusal → the old seat is re-POSTed at once, no verify step first');
    ok(w.log.toasts.some(x => x.msg === 'Bike changed: 5 → 9'), '…and if /bookings then shows only the new seat, that is a swap, not a "could not be restored"');
  }

  // ── Wiring: a Book tap in a session that was never verified ──────────────
  // Real bookClass + _recheckAuthForBooking. checkAuth only STARTS the bookings
  // fetch (as _checkAuthOnce does); `serverMap` lands a tick later, or never.
  const tapFns = ['function _busyLabel(', 'function _recheckAuthForBooking(', 'async function _rereadBookingsForVerify(', 'async function bookClass(']
    .map(o => grab(appSrc, o, '}')).join('\n');
  // `o.user` / `o.state`: a session whose /profile DID load while /bookings has
  // not ('pending' at launch, 'failed' after it).
  function tapWorld(initial, serverMap, o) {
    o = o || {};
    const log = { toasts: [], pickers: [], confirms: [], posts: 0, eventGets: 0, reads: 0, authChecks: 0 };
    const globals = {
      _myBookings: clone(initial), currentUser: o.user || null, _eventCache: {},
      _studioMap: { 4: { has_layout: true, name: 'Studio 1', layout: { slots: [{ id: 7 }, { id: 9 }, { id: 11 }] } } },
      console: { log() {}, warn() {}, error: console.error },
      setTimeout: () => 0, clearTimeout: () => {},
      getBearerToken: () => 'tok',
      confirmModal: async o => { log.confirms.push(o.title); return false; },
      openLoginPopup: () => {},
      toast: (msg, type) => log.toasts.push({ msg, type }),
      apiFetch: async path => {
        if (path !== '/events/77') throw new Error('unexpected call ' + path);
        log.eventGets++;
        return { ok: true, status: 200, json: async () => ({ slots: [9, 11], data: {} }) };
      },
      showBikePicker: (id, b, layout, avail, mine) => log.pickers.push([...mine]),
      submitBooking: async () => { log.posts++; },
      leaveWaitlist: async () => {}, confirmJoinWaitlist: async () => {},
      slotLabelForEvent: () => 'Bike', _waitlistClassLine: () => '', _parseSlots: x => x,
      _clearUnverifiedBooking: async () => true,
    };
    const ctx = t.loadPure('js/app.js', 'booking', globals);
    ctx.applyBookedState = (b, id, booking) => { b.textContent = ctx.formatSlots('Bike', booking.slots) + ' ✓'; b.className = 'book-btn booked'; };
    ctx.fetchMyBookings = () => new Promise(r => setImmediate(() => {
      log.reads++;
      if (!serverMap) return r(false);
      ctx._myBookings = clone(serverMap);
      ctx._bookingsLoadState = 'loaded'; // as the real one, only for an applied snapshot
      r(true);
    }));
    ctx.checkAuth = async () => { log.authChecks++; ctx.currentUser = { id: 1 }; ctx.fetchMyBookings(); };
    t.vm.runInContext('var _bookAuthRecheck = null; var MAX_SEATS = 2; var BOOKING_VERIFY_DEADLINE_MS = 10000; var _bookingsLoadState = ' + JSON.stringify(o.state || 'pending') + ';\n' +
      grab(appSrc, 'function pluralizeSlotLabel(', '}') + '\n' + grab(appSrc, 'function formatSlots(', '}') + '\n' + tapFns, ctx);
    return { ctx, log, serve: m => { serverMap = m; } };
  }
  const holds7 = { 77: { bookingId: 'Z', bookingIds: ['Z'], slots: [7], slotBookings: { 7: 'Z' }, waitlisted: false } };

  t.section('Booking: a Book tap in an unverified session waits for the member\'s bookings');
  {
    // /profile blipped at launch: nothing loaded, so the card of a class the
    // member HOLDS reads "Book". The tap heals auth — bookings land a tick later.
    const w = tapWorld({}, holds7);
    const b = btn();
    await w.ctx.bookClass(77, b, 4);
    eq([w.log.pickers, w.log.confirms, w.log.posts, w.log.eventGets], [[], [], 0, 0],
      'already held → no picker, no "Book this spot?", no POST (the old code opened the picker with the member\'s own bike drawn as taken)');
    eq([b.textContent, b.className, b.disabled], ['Bike 7 ✓', 'book-btn booked', false], 'the button now shows the booking');
    ok(w.log.toasts.some(x => /already booked into this class/.test(x.msg)), 'and says so');
    ok(!b.dataset.busy, 'the busy flag is released');
  }
  {
    const w = tapWorld({}, null);
    const b = btn();
    await w.ctx.bookClass(77, b, 4);
    eq([w.log.pickers, w.log.posts, w.log.eventGets], [[], 0, 0], 'bookings could not be loaded → the booking flow does not start');
    ok(w.log.toasts.some(x => /Couldn't load your bookings/.test(x.msg)), 'and the member is told to try again');
    eq([b.textContent, b.disabled], ['Book', false], 'the button is live again');
  }
  {
    const w = tapWorld({}, { 88: holds7[77] });
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.log.pickers, [[]], 'not held → the picker opens once the map is known');
  }
  {
    // Mid-session blip: the map is still populated and the card says "Bike 7 ✓".
    const w = tapWorld(holds7, holds7);
    await w.ctx.bookClass(77, btn('book-btn booked'), 4);
    eq(w.log.pickers, [[7]], 'a tap on a booking the card already showed carries on to manage it');
    ok(!w.log.toasts.some(x => /already booked/.test(x.msg)), '…without being told it is "already booked"');
  }

  t.section('Booking: no Book tap goes ahead until a /bookings snapshot has been applied');
  {
    // The retry the toast asks for: the first tap healed auth, so currentUser is
    // set by the second — which must not walk past the guard with no bookings.
    const w = tapWorld({}, null);
    const b = btn();
    await w.ctx.bookClass(77, b, 4);
    await w.ctx.bookClass(77, b, 4);
    eq([w.log.pickers, w.log.posts, w.log.eventGets], [[], 0, 0],
      'two taps, /bookings failing both times → no picker, no GET /events, no POST (the old second tap opened the picker with the member\'s own bike drawn as taken)');
    eq(w.log.toasts.filter(x => /Couldn't load your bookings/.test(x.msg)).length, 2, 'each tap says why');
    eq(w.log.authChecks, 1, 'a session that already healed is not re-checked');
    eq([b.textContent, b.disabled, !!b.dataset.busy], ['Book', false, false], 'the button is live again');
    w.serve(holds7);
    await w.ctx.bookClass(77, b, 4);
    eq([w.log.pickers, w.log.eventGets, b.textContent], [[], 0, 'Bike 7 ✓'], 'once /bookings answers, the seat already held is shown instead of a booking flow');
    ok(w.log.toasts.some(x => /already booked into this class/.test(x.msg)), 'and says so');
  }
  // /profile loaded, /bookings did not: signed in, yet every card reads "Book".
  for (const state of ['failed', 'pending']) {
    const w = tapWorld({}, holds7, { user: { id: 1 }, state });
    const b = btn();
    await w.ctx.bookClass(77, b, 4);
    eq([w.log.reads, w.log.authChecks], [1, 0], 'signed in, bookings ' + state + ' → /bookings is read first (no auth re-check: the session is fine)');
    eq([w.log.pickers, w.log.confirms, w.log.posts, w.log.eventGets], [[], [], 0, 0], 'signed in, bookings ' + state + ' → a class already held never reaches the picker or a POST');
    ok(w.log.toasts.some(x => /already booked into this class/.test(x.msg)), 'signed in, bookings ' + state + ' → told it is already booked');
    await w.ctx.bookClass(77, b, 4);
    eq([w.log.reads, w.log.pickers], [1, [[7]]], 'bookings now loaded → the next tap manages the booking without another read');
  }
  {
    const w = tapWorld({}, null, { user: { id: 1 }, state: 'failed' });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.log.pickers, w.log.eventGets], [[], 0], 'signed in, bookings failed and still unreadable → nothing starts');
    const w2 = tapWorld({}, {}, { user: { id: 1 }, state: 'loaded' });
    await w2.ctx.bookClass(77, btn(), 4);
    eq([w2.log.reads, w2.log.pickers], [0, [[]]], 'bookings loaded → a tap books straight away, as before');
  }

  t.section('"Book my usual week" never runs before the member\'s bookings have loaded');
  {
    // Its "already booked" skip reads _myBookings: over an unloaded map every
    // ticked class — held or not — would be booked (again). The run takes the
    // picks the member confirmed in the sheet (tests/suites/weekly-template.js
    // covers that contract); here: one ticked class, event 77.
    const templateWorld = (state, serverMap) => {
      const log = { reads: 0, seats: [] };
      const ctx = t.loadPure('js/app.js', 'booking', {
        _myBookings: {}, currentUser: { id: 1 },
        console: { log() {}, warn() {}, error: console.error },
        navigator: { onLine: true }, getBearerToken: () => 'tok',
        dismissBookingConfirmation: () => {},
        _bookTemplateSeat: async id => { log.seats.push(id); ctx._myBookings[String(id)] = { bookingId: 1, slots: [3], waitlisted: false }; return 'booked'; },
        joinWaitlist: async () => { throw new Error('a class ticked without the waitlist option never joins a waitlist'); },
        fetchMyBookings: async () => true,
      });
      ctx._rereadBookingsForVerify = async () => {
        log.reads++;
        if (!serverMap) return false;
        ctx._myBookings = clone(serverMap);
        ctx._bookingsLoadState = 'loaded';
        return true;
      };
      t.vm.runInContext('var _bookingsLoadState = ' + JSON.stringify(state) + ';\n' + grab(appSrc, 'async function _bookWeeklyTemplateInner(', '}'), ctx);
      return { log, run: () => ctx._bookWeeklyTemplateInner({ booked: 0, waitlisted: 0, failed: 0, skipped: 0 }, [{ eventId: 77, studioId: 4 }]) };
    };
    const tally = c => ({ booked: c.booked, waitlisted: c.waitlisted, failed: c.failed, skipped: c.skipped });
    let w = templateWorld('failed', null);
    let c = await w.run();
    eq([tally(c), c.stopped, w.log.seats], [{ booked: 0, waitlisted: 0, failed: 1, skipped: 0 }, 'bookings', []],
      'bookings never loaded and still unreadable → the run does not start (nothing booked)');
    w = templateWorld('pending', holds7);
    c = await w.run();
    eq([tally(c), w.log.reads, w.log.seats, c.results[0].result], [{ booked: 0, waitlisted: 0, failed: 0, skipped: 1 }, 1, [], 'already'],
      'bookings read first → the class already held is skipped, not booked a second time');
    w = templateWorld('loaded', null);
    eq([(await w.run()).booked, w.log.reads, w.log.seats], [1, 0, [77]], 'bookings already loaded → no extra read, the ticked class is booked');
  }

  t.section('Class sheet: Book / booked through a detached button');
  {
    // Opened from My Bookings there is no Discover card: each tap used to make
    // its own detached button, so bookClass's per-button guard never fired.
    const log = { toasts: [], bookClass: 0, release: null };
    const ctx = t.loadPure('js/app.js', 'booking', {
      _myBookings: clone(holds7), _eventCache: { 77: { studio_id: 4 } }, _studioMap: { 4: { has_layout: true } },
      document: { querySelector: () => null, createElement: () => ({}) },
      getBearerToken: () => 'tok',
      toast: (msg, type) => log.toasts.push({ msg, type }),
      confirmUnbook: () => { throw new Error('a layout booking re-opens the picker, not the cancel dialog'); },
      bookClass: () => { log.bookClass++; return new Promise(r => { log.release = r; }); },
    });
    t.vm.runInContext('var _sheetActionBusy = {};\n' + grab(appSrc, 'async function _classDetailBookAction(', '}'), ctx);
    const first = ctx._classDetailBookAction(77);
    await ctx._classDetailBookAction(77); // second tap while GET /events/{id} is still out
    eq(log.bookClass, 1, 'a second tap while the first is loading does not start a second flow (two pickers)');
    eq(log.toasts.map(x => x.msg), ['Loading class…'], 'and the wait is announced — the detached button\'s "…" is invisible');
    log.release();
    await first;
    ctx._classDetailBookAction(77);
    eq(log.bookClass, 2, 'once it settles the button works again');
  }
  {
    // With a Discover card the sheet acts through ITS button. The sheet can be
    // fresher than the card (a watched class just re-read as open): the card is
    // then still a disabled "Full", and click() on a disabled button is a no-op.
    const cardWorld = (card) => {
      const log = { synced: [], clicks: 0, toasts: [] };
      card.click = () => { if (!card.disabled) log.clicks++; };
      const ctx = t.loadPure('js/app.js', 'booking', {
        _myBookings: {}, _eventCache: { 77: { studio_id: 4, is_fully_booked: false } }, _studioMap: { 4: { has_layout: true } },
        document: { querySelector: () => card, createElement: () => { throw new Error('the card button is used, not a detached one'); } },
        getBearerToken: () => 'tok',
        toast: (msg, type) => log.toasts.push({ msg, type }),
        _syncCardButtonsForEvent: (id) => { log.synced.push(id); card.disabled = false; card.textContent = 'Book'; },
      });
      t.vm.runInContext('var _sheetActionBusy = {};\n' + grab(appSrc, 'async function _classDetailBookAction(', '}'), ctx);
      return { log, tap: () => ctx._classDetailBookAction(77) };
    };
    let w = cardWorld({ disabled: true, textContent: 'Full', dataset: {}, offsetParent: {} });
    await w.tap();
    eq([w.log.synced, w.log.clicks], [[77], 1], 'a card still reading a disabled "Full" is re-synced from state first, so the tap reaches bookClass (it used to do nothing)');
    w = cardWorld({ disabled: true, textContent: '…', dataset: { busy: '1' }, offsetParent: {} });
    await w.tap();
    eq([w.log.synced, w.log.clicks], [[], 0], 'a button bookClass itself disabled (mid-flight) is left alone — re-enabling it would start a second flow');
    w = cardWorld({ disabled: false, textContent: 'Book', dataset: {}, offsetParent: {} });
    await w.tap();
    eq([w.log.synced, w.log.clicks], [[], 1], 'an enabled button is simply clicked, as before');
  }

  // ── Wiring: offline-queue replay ─────────────────────────────────────────
  const queueSrc = grab(relSrc, '  async function _processOfflineQueueInner() {', '  }');
  function queueWorld(items, posts, reads) {
    const log = { toasts: [], posts: [] };
    let queue = clone(items);
    const globals = {
      _myBookings: {},
      console: { log() {}, warn() {}, error: console.error },
      setTimeout: () => 0, clearTimeout: () => {},
      getBearerToken: () => 'tok',
      toast: (msg, type) => log.toasts.push({ msg, type }),
      refreshUpcomingPanel: () => {},
      getOfflineQueue: () => clone(queue),
      saveOfflineQueue: q => { queue = clone(q); },
      // WHETHER an item may be replayed has its own suite (offline-queue.js);
      // every scenario here is the reconnect replay of something just queued.
      _offlineQueueVerdict: () => 'send',
      apiFetch: async (path, opts) => {
        if (path === '/events/77' && !opts) return { ok: true, status: 200, json: async () => ({ data: { start_at: '2099-01-01 10:00:00' } }) };
        if (path !== '/bookings' || !opts || opts.method !== 'POST') throw new Error('unexpected call ' + path);
        log.posts.push(JSON.parse(opts.body));
        const r = posts.shift();
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body || {} };
      },
    };
    const ctx = t.loadPure('js/app.js', 'booking', globals);
    ctx.fetchMyBookings = () => {
      const r = reads.shift();
      if (!r) return Promise.resolve(false);
      ctx._myBookings = clone(r);
      return Promise.resolve(true);
    };
    t.vm.runInContext('var BOOKING_VERIFY_DEADLINE_MS = 10000;\n' + grab(appSrc, 'async function _rereadBookingsForVerify(', '}') + '\n' + queueSrc, ctx);
    return { ctx, log, left: () => queue };
  }
  const queued7 = [{ eventId: 77, slots: [7], spaces: 0, timestamp: '2026-01-01T00:00:00.000Z' }];

  t.section('Offline queue: a 409 on replay is checked against /bookings, never assumed booked');
  {
    let w = queueWorld(queued7, [{ status: 409, body: { message: 'Slot taken' } }], [{}]);
    await w.ctx._processOfflineQueueInner();
    ok(!w.log.toasts.some(x => /confirmed/.test(x.msg)), 'someone else took bike 7 while offline → NOT "queued booking confirmed!"');
    ok(w.log.toasts.some(x => /taken while you were offline/.test(x.msg) && x.type === 'error'), 'the member is told the spot was taken');
    eq(w.log.toasts[w.log.toasts.length - 1].msg.indexOf('taken') !== -1, true, '…and that is the toast left on screen');
    eq([w.left(), w.log.posts.length], [[], 1], 'the server answered: the item leaves the queue, one POST only');

    w = queueWorld(queued7, [{ status: 422, body: { message: 'You have already booked this slot' } }], [holds7]);
    await w.ctx._processOfflineQueueInner();
    ok(w.log.toasts.some(x => x.msg === '1 queued booking confirmed!'), '"already" and /bookings shows the seat → confirmed');

    w = queueWorld(queued7, [{ status: 409, body: {} }], [seat5()]);
    await w.ctx._processOfflineQueueInner();
    ok(w.log.toasts.some(x => /taken while you were offline/.test(x.msg)) && !w.log.toasts.some(x => /confirmed/.test(x.msg)),
      'holding a DIFFERENT bike in the class is not the queued one landing');

    w = queueWorld(queued7, [{ status: 409, body: {} }], []);
    await w.ctx._processOfflineQueueInner();
    ok(w.log.toasts.some(x => /Couldn't confirm whether a queued booking went through/.test(x.msg)) && !w.log.toasts.some(x => /confirmed!|taken/.test(x.msg)),
      '/bookings unreadable → "check My Bookings", neither confirmed nor taken');

    const space = { 77: { bookingId: 'A', bookingIds: ['A'], slots: [], slotBookings: {}, waitlisted: false } };
    w = queueWorld([{ eventId: 77, slots: [], spaces: 1, timestamp: 'x' }], [{ status: 409, body: {} }], [space]);
    await w.ctx._processOfflineQueueInner();
    eq(w.log.posts, [{ event_id: 77, slots: 1 }], 'count body');
    ok(!w.log.toasts.some(x => /confirmed!/.test(x.msg)), 'a refused count body is never "confirmed" off a space that may have been held already');
  }
};
