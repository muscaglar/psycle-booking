'use strict';
// Waitlist polish (wave 6): the offer-window / phase helpers in the
// waitlist:pure block, what the My Bookings card, the class sheet and the two
// seat-creating dialogs say because of them, the clash helper's opt-in for
// places, the remembered-places fallback in fetchMyBookings, and the re-check
// ticker. Everything below runs the SHIPPED source, sliced out of js/app.js,
// against scripted stubs — nothing here can reach Psycle.
module.exports = async function (t) {
  const { ok, eq } = t;
  const src = t.readSource('js/app.js');
  const lines = src.split('\n');
  // Top-level functions in app.js open at column 0 and close with a bare "}".
  const grab = (opener, closer) => {
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (from === -1 || to === -1) throw new Error('waitlist-polish suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };
  const between = (fromTag, toTag) => {
    const a = src.indexOf(fromTag), b = src.indexOf(toTag, a + 1);
    if (a === -1 || b === -1) throw new Error('waitlist-polish suite: cannot slice "' + fromTag + '" … "' + toTag + '" (anchor moved?)');
    return src.slice(a, b);
  };
  const wlBlock = between('// ── waitlist:pure:start', '// ── waitlist:pure:end');
  const clashBlock = between('// ── pure:clash:start', '// ── pure:clash:end');
  const pinnedDate = (nowMs) => class PinnedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(nowMs); }
    static now() { return nowMs; }
  };
  const MIN = 60000, HOUR = 3600000;
  const utc = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi || 0);
  const escapeHTML = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // The helpers as the app runs them: with the Europe/London resolver app.js
  // ships (pure:gym-time) on window. The runner is pinned to America/New_York,
  // so a device-local reading anywhere in here would show up as a 5h error.
  const gym = t.loadPure('js/app.js', 'gym-time', { window: {} });
  const wl = t.vm.createContext({ window: gym.window });
  t.vm.runInContext(wlBlock, wl, { filename: 'js/app.js[waitlist:pure]' });

  // ── R2-25: the probe window, across midnight ──────────────────────────────
  t.section('Waitlist: the offer-check window no longer stops at midnight');
  ok(typeof wl._inWaitlistOfferWindow === 'function' && typeof wl._waitlistPhase === 'function',
    'waitlist:pure exposes _inWaitlistOfferWindow + _waitlistPhase (evaluated with no DOM / app globals)');
  {
    // Wed 12 Aug 2026, 09:00 BST = 08:00Z. "10pm the evening before" = 21:00Z on the 11th.
    const nine = '2026-08-12 09:00:00';
    const at = (d, h, mi) => wl._inWaitlistOfferWindow(nine, utc(2026, 8, d, h, mi));
    eq([at(11, 20, 59), at(11, 21, 0)], [false, true], '09:00 class: closed at 21:59 the evening before, open at 22:00 (UK wall clock)');
    eq([at(11, 22, 30), at(11, 23, 30), at(12, 5, 15)], [true, true, true],
      '…and STILL open at 23:30, 00:30 and 06:15 — `getHours() >= 22` went false at midnight and nothing asked again until 06:30');
    eq([at(12, 5, 45), at(12, 7, 59)], [true, true], 'the ordinary 2.5h window takes over as before');
    eq([at(12, 8, 0), at(12, 8, 30)], [false, false], 'a class that has started is never asked about');
    const seven = '2026-08-12T07:00:00'; // 06:00Z; the T form reads the same
    eq([wl._inWaitlistOfferWindow(seven, utc(2026, 8, 12, 3, 0)), wl._inWaitlistOfferWindow(seven, utc(2026, 8, 11, 20, 30))], [true, false],
      '07:00 class at 04:00 → asked; at 21:30 the evening before → not yet');
    const ten = '2026-08-12 10:00:00'; // 09:00Z — not an early class
    eq([wl._inWaitlistOfferWindow(ten, utc(2026, 8, 11, 21, 30)), wl._inWaitlistOfferWindow(ten, utc(2026, 8, 12, 6, 29)), wl._inWaitlistOfferWindow(ten, utc(2026, 8, 12, 6, 30))],
      [false, false, true], '10:00 class: no overnight window — 151 min out is early, 150 min out is in');
    eq([wl._inWaitlistOfferWindow('2026-08-12 05:45:00', utc(2026, 8, 11, 21, 30)), wl._inWaitlistOfferWindow('2026-08-12 06:00:00', utc(2026, 8, 11, 21, 0)),
      wl._inWaitlistOfferWindow('2026-08-12 09:59:00', utc(2026, 8, 11, 21, 0))], [false, true, true], 'the overnight rule covers 06:00–09:59 starts only');
    // Winter: 09:00 GMT = 09:00Z, 10pm the evening before = 22:00Z.
    eq([wl._inWaitlistOfferWindow('2026-01-15 09:00:00', utc(2026, 1, 14, 21, 59)), wl._inWaitlistOfferWindow('2026-01-15 09:00:00', utc(2026, 1, 14, 22, 0)),
      wl._inWaitlistOfferWindow('2026-01-15 09:00:00', utc(2026, 1, 15, 0, 30))], [false, true, true], 'GMT date: the same wall-clock rule, an hour later in UTC');
    eq([wl._inWaitlistOfferWindow(null, 0), wl._inWaitlistOfferWindow('', 0), wl._inWaitlistOfferWindow('soon', 0)], [false, false, false], 'an unreadable start is never in the window');
    ok(wl._inWaitlistOfferWindow('2099-01-01 07:00:00') === false, 'nowMs defaults to Date.now()');

    // The device zone has no say (it used to: both getHours() calls were device-local).
    const prevTz = process.env.TZ;
    try {
      for (const zone of ['Asia/Tokyo', 'Europe/London', 'Pacific/Honolulu']) {
        process.env.TZ = zone;
        eq([at(11, 20, 59), at(11, 21, 0), at(12, 5, 15)], [false, true, true], 'device in ' + zone + ': same answers');
      }
    } finally { process.env.TZ = prevTz; }
    eq(new Date('2026-07-14T07:00:00').getTimezoneOffset(), 240, 'runner zone restored after the zone checks');

    // No resolver at all (the last-resort branch): instants taken the same device-local way still line up.
    const bare = t.vm.createContext({});
    t.vm.runInContext(wlBlock, bare);
    const local = (s) => new Date(s).getTime();
    eq([bare._inWaitlistOfferWindow(nine, local('2026-08-11T21:59:00')), bare._inWaitlistOfferWindow(nine, local('2026-08-12T00:30:00'))], [false, true],
      'no resolver: the window still spans midnight on the device clock');

    // The probe reads the helper — a private copy of the window test is how it went wrong.
    const probeSrc = grab('function _placeNeedsOfferCheck(') + '\n' + grab('async function _probeWaitlistOffers(');
    ok(/_inWaitlistOfferWindow\(evt\.start_at, now\)/.test(probeSrc) && !/getHours\(\)/.test(probeSrc), '_probeWaitlistOffers picks its candidates through _inWaitlistOfferWindow (no getHours of its own)');
    eq((src.match(/const WAITLIST_OFFER_WINDOW_MS\b/g) || []).length, 1, 'WAITLIST_OFFER_WINDOW_MS is declared once (a second const would stop app.js loading)');
  }

  // ── R2-5 / R2-9: what a seatless place can still expect ───────────────────
  t.section('Waitlist: phase (auto → offers → closed) — the copy decision table');
  {
    const six = '2026-08-12 18:00:00'; // 17:00Z
    const start = utc(2026, 8, 12, 17, 0);
    const phase = (minsBefore) => wl._waitlistPhase(six, start - minsBefore * MIN);
    eq([phase(600), phase(180), phase(121)], ['auto', 'auto', 'auto'], 'more than 2h out: Psycle still books you in');
    eq([phase(120), phase(90), phase(31)], ['offers', 'offers', 'offers'], 'from 2h out: emailed offers');
    eq([phase(30), phase(5), phase(0), phase(-20)], ['closed', 'closed', 'closed', 'closed'], 'the last 30 minutes (and after the start): closed');
    eq([phase(140), wl._inWaitlistOfferWindow(six, start - 140 * MIN)], ['auto', true],
      'the app ASKS from 2.5h but only SAYS "offers" from 2h — reusing the generous probe window would deny auto-booking while it still happens');
    const seven = '2026-08-12 07:00:00'; // 06:00Z
    eq([wl._waitlistPhase(seven, utc(2026, 8, 11, 20, 59)), wl._waitlistPhase(seven, utc(2026, 8, 11, 21, 0)), wl._waitlistPhase(seven, utc(2026, 8, 11, 23, 30)),
      wl._waitlistPhase(seven, utc(2026, 8, 12, 5, 29)), wl._waitlistPhase(seven, utc(2026, 8, 12, 5, 30))], ['auto', 'offers', 'offers', 'offers', 'closed'],
    'a 07:00 class: offers from 10pm the evening before, straight through midnight, closed at 06:30');
    eq([wl._waitlistPhase(null, 0), wl._waitlistPhase('soon', 0)], ['auto', 'auto'], "a time that can't be read claims nothing about the clock");
  }

  // ── R2-5: a place that ended without a seat ───────────────────────────────
  t.section('Waitlist: a remembered place that ended without a seat is reported by the diff');
  {
    const prev = { places: { 1: 101, 2: 102, 3: 103 }, allocated: {} };
    const now = { 1: { bookingId: 9, slots: [4], waitlisted: false }, 2: { bookingId: null, slots: [], waitlisted: true, waitlist: { id: 102 } } };
    const d = wl._diffWaitlistPlaces(prev, now, 0);
    eq([d.newlyAllocated, d.ended, d.places], [['1'], ['3'], { 2: 102 }], 'place→seat is allocated, still-a-place is kept, vanished-with-no-seat is `ended` — never both');
    eq([wl._diffWaitlistPlaces(null, now, 0).ended, wl._diffWaitlistPlaces({ places: 'junk' }, {}, 0).ended], [[], []], 'no / malformed memory → nothing ended');
  }

  // fetchMyBookings and its neighbours, as bookings-load.js slices them — with
  // the REAL waitlist:pure helpers instead of stubs.
  const fetchSrc = between('let _bookingsSeq = 0;', '// Refresh bookings when the page becomes visible after being hidden');
  const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  function fetchWorld(o) {
    o = o || {};
    const w = { calls: [], renders: 0, toasts: [], events: [], skeletons: 0, lateTimers: 0 };
    let resolveWaitlists;
    w.waitlists = new Promise((r) => { resolveWaitlists = r; });
    w.answerWaitlists = (v) => { resolveWaitlists(v); return new Promise((r) => setImmediate(r)); };
    const ctx = t.vm.createContext({
      window: gym.window,
      Date: o.now ? pinnedDate(o.now) : Date,
      console: { log() {}, warn() {}, error: console.error },
      // Only the 5s /waitlists deadline is fired (at once): that is "late".
      setTimeout: (fn, ms) => { if (o.late && ms === 5000) { w.lateTimers++; fn(); } return 0; }, clearTimeout: () => {},
      getBearerToken: () => 'tok-A',
      apiFetch: async (path) => {
        w.calls.push(path);
        if (path.indexOf('/bookings') === 0) return jsonRes(200, { data: o.bookings || [] });
        if (path === '/events/555' && !o.eventFails) return jsonRes(200, { data: { id: 555, start_at: '2099-01-01 07:00:00', duration: 45, event_type_id: 1, instructor_id: 2, studio_id: 3 }, relations: {} });
        return jsonRes(503, null);
      },
      fetchMyWaitlists: () => (o.late ? w.waitlists : Promise.resolve('waitlists' in o ? o.waitlists : null)),
      renderMyBookings: () => { w.renders++; },
      showBookingSkeleton: () => { w.skeletons++; },
      toast: (msg, type) => { w.toasts.push([msg, type]); },
      PsycleEvents: { emit: (e) => { w.events.push(e); } },
      document: { querySelectorAll: () => [], getElementById: () => null },
      currentUser: { id: 7 },
      _myBookings: {}, _eventCache: o.cache || {}, _studioMap: {}, _lastWaitlistEntries: null,
      _readWaitlistPlaces: () => ({ places: Object.assign({}, o.remembered || {}), allocated: {} }),
      _writeWaitlistPlaces: () => {},
      _readBookingsSnapshot: () => o.snapshot || null,
      _waitlistClassLine: (id) => 'Class ' + id,
      _probeWaitlistOffers: () => Promise.resolve(null),
      _syncCardButtonsForEvent: () => {}, applyBookedState: () => {},
    });
    t.vm.runInContext(wlBlock + '\n' + fetchSrc, ctx, { filename: 'js/app.js[waitlist:pure + bookings fetch]' });
    w.ctx = ctx;
    w.flag = () => t.vm.runInContext('_waitlistsUnavailable', ctx);
    return w;
  }

  // ── R2-27: /waitlists unreadable on a cold launch ─────────────────────────
  t.section('Waitlist: remembered places survive an unreadable /waitlists even when Discover never cached the class');
  {
    // /bookings → [], /waitlists → null, memory: a place on event 555, cold cache.
    let w = fetchWorld({ remembered: { 555: 9001 } });
    eq(await w.ctx.fetchMyBookings(), true, 'the pass is applied');
    const held = w.ctx._myBookings['555'];
    ok(held && held.waitlisted === true && held.waitlist.id === 9001 && held.waitlist.unverified === true,
      'the remembered place is kept as an unverified stand-in (it used to be dropped: "Nothing booked — yet" over a place Psycle can still turn into a chargeable seat)');
    ok(w.calls.includes('/events/555') && !!w.ctx._eventCache['555'], '…and its class is fetched by the hydrate step, so the card can be drawn');
    eq(w.flag(), 'failed', 'the list could not be read: flagged failed (My Bookings shows its note)');

    w = fetchWorld({ remembered: { 555: 9001 }, eventFails: true });
    await w.ctx.fetchMyBookings();
    ok(!!w.ctx._myBookings['555'] && !w.ctx._eventCache['555'], 'hydrate failed too: the place stays in the map, undrawable — renderMyBookings\' `unhydrated` path (saved copy / "Couldn\'t load" + Retry) owns that, not "Nothing booked"');

    w = fetchWorld({ remembered: { 555: 9001 }, bookings: [{ id: 'B1', event_id: 555, slot: 4 }] });
    await w.ctx.fetchMyBookings();
    eq([w.ctx._myBookings['555'].waitlisted, !!w.ctx._myBookings['555'].waitlist], [false, false], 'a real booking for that class is never overwritten by the stand-in');

    w = fetchWorld({ remembered: { 555: 9001 }, waitlists: [] });
    await w.ctx.fetchMyBookings();
    eq([Object.keys(w.ctx._myBookings), w.flag()], [[], false], 'a list that WAS read (and is empty) is the truth: no stand-in, no flag');
  }

  t.section('Waitlist: a slow /waitlists is "late", not "failed" — and the stand-ins give way when it lands');
  {
    const entry = (id, eventId) => wl._normaliseWaitlistEntry({ id, status: 'waiting', event: { id: eventId, start_at: '2099-01-01 07:00:00' } });
    const complete = (arr) => arr; // fetchMyWaitlists marks a partial read with .incomplete
    const partial = (arr) => { arr.incomplete = true; return arr; };

    let w = fetchWorld({ late: true, remembered: { 555: 9001 } });
    await w.ctx.fetchMyBookings();
    eq([w.lateTimers, w.flag(), !!w.ctx._myBookings['555']], [1, 'late', true], 'past the 5s deadline with no earlier list: stand-in shown, flagged late (no error-style note for a request still in flight)');
    await w.answerWaitlists(complete([entry(9001, 555)]));
    eq([w.flag(), w.ctx._myBookings['555'].waitlist.unverified, w.ctx._myBookings['555'].waitlist.id], [false, undefined, 9001], 'it lands listing the place: the stand-in becomes the real entry');

    w = fetchWorld({ late: true, remembered: { 555: 9001 } });
    await w.ctx.fetchMyBookings();
    await w.answerWaitlists(complete([entry(9777, 555)]));
    eq(w.ctx._myBookings['555'].waitlist.id, 9777, 'listed under a NEW entry id (left and rejoined elsewhere): the real id replaces the remembered one — Leave / Claim must not act on a dead entry');

    w = fetchWorld({ late: true, remembered: { 555: 9001 } });
    await w.ctx.fetchMyBookings();
    const rendersBefore = w.renders;
    await w.answerWaitlists(complete([]));
    ok(!w.ctx._myBookings['555'] && w.renders > rendersBefore, 'a COMPLETE list without it: the stand-in is removed and the tab repainted (it used to linger as "couldn\'t re-check" with no note)');

    w = fetchWorld({ late: true, remembered: { 555: 9001 } });
    await w.ctx.fetchMyBookings();
    await w.answerWaitlists(partial([]));
    ok(!!w.ctx._myBookings['555'] && w.ctx._myBookings['555'].waitlist.unverified === true, 'an INCOMPLETE list without it proves nothing: the stand-in stays');

    w = fetchWorld({ late: true, remembered: { 555: 9001 } });
    await w.ctx.fetchMyBookings();
    const r0 = w.renders;
    await w.answerWaitlists(null);
    eq([w.flag(), w.renders - r0], ['failed', 1], 'late AND then failed: only now flagged failed, with one repaint so the note appears');
  }

  t.section('Waitlist: "ended without a booking" is said once, only when the waitlist has just closed on the place');
  {
    const NOW = utc(2026, 8, 12, 16, 40); // 17:40 BST
    const cache = (startAt) => ({ 600: { start_at: startAt } });
    let w = fetchWorld({ now: NOW, cache: cache('2026-08-12 18:00:00') }); // 20 min to go
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts, [['Your waitlist place for Class 600 ended without a booking — that waitlist has closed', 'info']], 'class 20 min away, place gone with no seat: one info toast naming the class');
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts.length, 1, '…and never twice in a session');

    w = fetchWorld({ now: NOW, cache: cache('2026-08-12 21:00:00') });
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts, [], '3h+ before class the member most likely left it themselves (here or in Psycle\'s app): silent');
    // Once the class has STARTED, absence proves nothing: /bookings lists upcoming
    // classes only, so a place Psycle turned into a seat the member attended
    // (auto-allocated overnight, or claimed on Psycle's own page) is in neither list.
    w = fetchWorld({ now: NOW, cache: cache('2026-08-12 12:40:00') });
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts, [], 'class started 5h ago, place gone: silent — it may have become a seat they rode (it toasted "ended without a booking" about a class they were charged for)');
    w = fetchWorld({ now: NOW, cache: cache('2026-08-12 17:40:00') });
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts, [], '…silent from the very minute it starts');
    w = fetchWorld({ now: NOW, snapshot: { owner: '7', items: [{ id: '600', start_at: '2026-08-12 12:40:00', type: 'Ride 45', instructor: 'Alex', waitlisted: true }] } });
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts, [], '…on a cold launch too (start read from the saved copy)');
    w = fetchWorld({ now: NOW, cache: cache('2026-08-11 16:00:00') });
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts, [], 'a class long gone: silent');
    w = fetchWorld({ now: NOW, cache: cache('2026-08-12 18:00:00') });
    t.vm.runInContext("_placesLeftHere['600'] = true;", w.ctx);
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts, [], 'a place left from this app this session: silent (leaveWaitlist keeps the memory on purpose)');
    w = fetchWorld({ now: NOW });
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts, [], 'a class nothing knows the time of: silent, never a guess');

    // Cold launch: the class is only in the saved bookings copy, which still holds the place until bookings:loaded rewrites it.
    const snapshot = { owner: '7', items: [{ id: '600', start_at: '2026-08-12 18:00:00', type: 'Ride 45', instructor: 'Alex', waitlisted: true }] };
    w = fetchWorld({ now: NOW, snapshot });
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts.map((x) => x[0]), ['Your waitlist place for Ride 45 · Alex ended without a booking — that waitlist has closed'], 'cold cache: start and label come from the saved copy');
    w = fetchWorld({ now: NOW, snapshot: Object.assign({}, snapshot, { owner: '8' }) });
    w.ctx._noteEndedPlaces(['600']);
    eq(w.toasts, [], "another account's saved copy is never read");

    w = fetchWorld({ now: NOW, cache: { 600: { start_at: '2026-08-12 18:00:00' }, 601: { start_at: '2026-08-12 17:45:00' } } });
    w.ctx._noteEndedPlaces(['600', '601']);
    eq(w.toasts.map((x) => x[0]), ['Your waitlist places for Class 600 (+1 more) ended without a booking — those waitlists have closed'], 'two at once: one toast, not one overwriting the other');
    w = fetchWorld({ now: NOW });
    w.ctx._noteEndedPlaces(undefined);
    eq(w.toasts, [], 'a diff without `ended` (the stubs bookings-load.js / session.js pass) is tolerated');
    // Inside fetchMyBookings itself: the slice also holds _refreshSeededEventDetails
    // (a later, background re-announce), whose own emit sits above in the file.
    const fmbAt = fetchSrc.indexOf('async function fetchMyBookings(');
    ok(fmbAt !== -1 && fetchSrc.indexOf('_noteEndedPlaces(diff.ended);', fmbAt) !== -1 &&
      fetchSrc.indexOf('_noteEndedPlaces(diff.ended);', fmbAt) < fetchSrc.indexOf("PsycleEvents.emit('bookings:loaded'", fmbAt),
      'fetchMyBookings notes ended places BEFORE bookings:loaded rewrites the saved copy it reads');
    ok(/_placesLeftHere\[key\] = true;/.test(grab('async function leaveWaitlist(')) && /delete _placesLeftHere\[key\];/.test(grab('async function joinWaitlist(')),
      'leaveWaitlist marks the place as left here; re-joining clears the mark');
  }

  // ── R2-5 / R2-9: the REAL My Bookings card ────────────────────────────────
  // Device-local throughout (no resolver in this world), like the card's own
  // new Date(evt.start_at): the phase and the card then share one clock.
  const renderSrc = grab('function renderMyBookings(');
  // renderMyBookings asks _classHasStarted (pure:bookings-started — the REAL
  // one) through _gymClassStartMs. No London resolver in this world, so the
  // stand-in is that resolver's own fallback: the device-local parse.
  const startedSrc = (() => {
    const a = src.indexOf('// ── pure:bookings-started:start'), b = src.indexOf('// ── pure:bookings-started:end');
    if (a === -1 || b < a) throw new Error('waitlist-polish suite: cannot slice pure:bookings-started (markers moved?)');
    return src.slice(a, b) + "\nfunction _gymClassStartMs(s) { return new Date(String(s).replace(' ', 'T')).getTime(); }";
  })();
  function cardWorld(nowIso, booking, o) {
    o = o || {};
    const els = {};
    const el = (id) => els[id] || (els[id] = { style: {}, textContent: '', innerHTML: '' });
    const ctx = t.loadPure('js/app.js', 'bookings-card', {
      Date: pinnedDate(new Date(nowIso).getTime()),
      window: {},
      document: { getElementById: el },
      localStorage: { getItem: () => null },
      currentUser: { id: 7 },
      escapeHTML,
      instrLink: (name) => escapeHTML(name),
      localDateStr: (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'),
      getCountdownText: () => '',
      slotLabelForEvent: () => 'Bike',
      _myBookings: { 77: booking },
      _eventCache: { 77: { id: 77, start_at: '2026-09-21T18:00:00', duration: 45, studio_id: 4, instructor_id: 31, _typeName: 'Ride 45', _instrName: 'Alex', _locName: 'Bank', _studioName: 'Studio 1' } },
    });
    t.vm.runInContext("var _activeSubscription = null, _showPastBookings = false, _bookingsLoadState = 'loaded', _waitlistsUnavailable = " + JSON.stringify(o.unavailable || false) + ';\n' +
      wlBlock + '\n' + startedSrc + '\n' + renderSrc, ctx, { filename: 'js/app.js[waitlist:pure + renderMyBookings]' });
    ctx.renderMyBookings();
    const html = el('upcomingList').innerHTML;
    const primary = /<button class="book-btn( booked)? mb-primary-btn" onclick="event\.stopPropagation\(\);(\w+)\(77, this\)">([^<]*)<\/button>/.exec(html) || [];
    return {
      html,
      status: (/<div class="mb-waitlist-status[^"]*">([^<]*)<\/div>/.exec(html.replace(/<div class="mb-waitlist-status" style[^>]*>[^<]*<\/div>/, '')) || [])[1] || '',
      badge: (/<span class="badge waitlist">([^<]*)<\/span>/.exec(html) || [])[1] || '',
      primary: { booked: !!primary[1], fn: primary[2], label: primary[3] },
      secondary: (html.match(/<button class="booking-action-btn" onclick="event\.stopPropagation\(\);(leaveWaitlist|claimWaitlistSpot)\(77, this\)"[^>]*>([^<]*)</) || []).slice(1),
      note: /Couldn't load your waitlist places/.test(html),
    };
  }
  const placeOnly = (extra) => ({ bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: Object.assign({ id: 900, status: 'waiting', expiresAt: null }, extra || {}) });

  t.section('My Bookings card: the Waitlisted status line follows Psycle\'s clock');
  {
    let c = cardWorld('2026-09-21T13:00:00', placeOnly()); // 5h before
    ok(/Psycle books you in automatically if a spot frees up \(keep a credit free\)/.test(c.status), '5h out: "Psycle books you in automatically…" — unchanged');
    eq([c.badge, c.primary, c.secondary], ['Waitlisted', { booked: true, fn: 'leaveWaitlist', label: 'Leave waitlist' }, ['claimWaitlistSpot', 'Check for a spot']], '…Leave leads, Check for a spot is the secondary action — unchanged');

    c = cardWorld('2026-09-21T16:30:00', placeOnly()); // 90 min before
    ok(/usually emails an offer instead of booking you in — tap Check for a spot \(keep a credit free\)/.test(c.status) && !/books you in automatically/.test(c.status),
      '90 min out: no more "books you in automatically" — it says offers, hedged ("usually"), and what to tap');
    eq([c.badge, c.primary, c.secondary], ['Waitlisted', { booked: false, fn: 'claimWaitlistSpot', label: 'Check for a spot' }, ['leaveWaitlist', 'Leave waitlist']],
      '…and "Check for a spot" leads (the one non-.booked primary button, relabelled); Leave drops to the actions row');

    c = cardWorld('2026-09-21T17:40:00', placeOnly()); // 20 min before
    ok(/^Waitlist closed — it shuts 30 minutes before class/.test(c.status) && !/books you in|emails an offer/.test(c.status), '20 min out: "Waitlist closed…" — no promise left standing');
    eq([c.badge, c.primary.fn], ['Waitlist closed', 'leaveWaitlist'], '…badge says so too; the buttons go back to Leave / Check');

    c = cardWorld('2026-09-21T16:30:00', placeOnly({ offer: { available: true, checkedAt: 0 } }));
    ok(/^A spot is free right now/.test(c.status), 'a claimable spot outranks the phase copy');
    eq([c.badge, c.primary, c.secondary], ['Spot available', { booked: false, fn: 'claimWaitlistSpot', label: 'Claim spot' }, ['leaveWaitlist', 'Leave waitlist']], '…Claim spot leads, as before');
    c = cardWorld('2026-09-21T17:40:00', placeOnly({ offer: { available: true, checkedAt: 0 } }));
    eq([c.badge, c.primary.label], ['Spot available', 'Claim spot'], 'even inside the last 30 minutes an offer that IS showing is not overwritten by "closed"');

    c = cardWorld('2026-09-21T16:30:00', { bookingId: 'A', bookingIds: ['A'], slots: [7], slotBookings: { 7: 'A' }, waitlisted: false, waitlist: { id: 900, status: 'waiting', expiresAt: null } });
    ok(/You also hold a waitlist place/.test(c.status) && c.primary.fn === 'upcomingCancel', 'a place held on top of a seat: copy and Cancel button untouched by the phase');

    c = cardWorld('2026-09-21T13:00:00', placeOnly({ unverified: true }), { unavailable: 'failed' });
    ok(c.note && /couldn't re-check with Psycle just now/.test(c.status), '/waitlists failed: the note and "couldn\'t re-check" — unchanged');
    c = cardWorld('2026-09-21T13:00:00', placeOnly({ unverified: true }), { unavailable: 'late' });
    ok(!c.note && /still checking with Psycle/.test(c.status), '/waitlists merely late: no error-style note over a request still in flight');
    c = cardWorld('2026-09-21T13:00:00', placeOnly(), { unavailable: false });
    ok(!c.note, 'list read: no note');

    // Swipe / suite contract (tests/suites/bookings-card.js): ONE non-.booked primary literal, and it only ever reaches claimWaitlistSpot.
    const primaries = (src.match(/class="book-btn[^"]*mb-primary-btn" onclick="event\.stopPropagation\(\);\w+\(/g) || []).filter((m) => !/\bbooked\b/.test(m));
    eq(primaries.length, 1, 'still exactly one non-.booked primary button literal (the label is a ternary, not a second button)');
    // The join sheet says the same thing from the same clock.
    const confirmSrc = grab('function showBookingConfirmation(');
    ok(/_waitlistPhase\(evt\.start_at\) === 'offers'/.test(confirmSrc) && /escapeHTML\(waitlistLine\)/.test(confirmSrc), 'showBookingConfirmation({waitlist:true}) picks its line through _waitlistPhase too, and escapes it');
  }

  // ── R2-8: clash helper + a held place ─────────────────────────────────────
  t.section('Clash: a held waitlist place is a possible seat — opt-in, amber, never a hard clash');
  const p = t.loadPure('js/app.js', 'clash');
  const seat = () => ({ bookingId: 'A', bookingIds: ['A'], slots: [5], slotBookings: { 5: 'A' }, waitlisted: false });
  const placeHeld = () => ({ bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 900 } });
  {
    const cacheOf = (extra) => Object.assign({ 10: { id: 10, start_at: '2026-09-21 07:00:00', duration: 45, _typeName: 'Ride', _locName: 'Oxford Circus' } }, extra || {});
    const evt = (start, o) => Object.assign({ id: 20, start_at: start, duration: 45, _typeName: 'Ride', _locName: 'Bank' }, o || {});
    const WITH = { includePlaces: true };
    eq([p._findClash(evt('2026-09-21 07:15:00'), { 10: placeHeld() }, cacheOf()), p._findClash(evt('2026-09-21 07:15:00'), { 10: placeHeld() }, cacheOf(), {})], [null, null],
      'default unchanged: a place is ignored (the headless sweep and the join dialog stay on seats)');
    const c = p._findClash(evt('2026-09-21 07:15:00'), { 10: placeHeld() }, cacheOf(), WITH);
    eq([c && c.kind, c && c.place, c && c.eventId], ['overlap', true, '10'], 'opted in: the overlapping place is reported, flagged place:true');
    eq(p._clashLabel(c), "You're also on the waitlist for the 7:00am Ride at Oxford Circus — if Psycle books you in, you'd hold both", 'said as a possibility ("also on the waitlist for the…"), never "Clashes with your…"');
    eq(p._findClash(evt('2026-09-21 08:00:00'), { 10: placeHeld() }, cacheOf(), WITH), null, 'a travel squeeze with a mere place is not worth a word');
    eq(p._findClash(evt('2026-09-21 07:00:00', { id: 10 }), { 10: placeHeld() }, cacheOf(), WITH), null, "the place's own class never clashes with itself");

    // A real seat always outranks a place — whichever comes first, whatever its kind.
    const both = cacheOf({ 11: { id: 11, start_at: '2026-09-21 07:30:00', duration: 45, _typeName: 'Barre', _locName: 'Bank' } });
    let r = p._findClash(evt('2026-09-21 07:15:00'), { 10: placeHeld(), 11: seat() }, both, WITH);
    eq([r.eventId, r.place, p._clashLabel(r)], ['11', false, 'Clashes with your 7:30am Barre at Bank'], 'place 7:00 + seat 7:30: the SEAT is named though the place starts earlier');
    r = p._findClash(evt('2026-09-21 07:15:00'), { 11: seat(), 10: placeHeld() }, both, WITH);
    eq(r.eventId, '11', '…in either key order');
    const squeeze = cacheOf({ 12: { id: 12, start_at: '2026-09-21 08:15:00', duration: 45, _typeName: 'Yoga', _locName: 'Oxford Circus' } });
    r = p._findClash(evt('2026-09-21 07:15:00'), { 10: placeHeld(), 12: seat() }, squeeze, WITH);
    eq([r.eventId, r.kind, r.place], ['12', 'travel', false], 'even a seat that is only a travel squeeze outranks an overlapping place (the seat is real)');
    r = p._findClash(evt('2026-09-21 07:15:00'), { 10: seat() }, cacheOf(), WITH);
    eq([r.place, p._clashLabel(r)], [false, 'Clashes with your 7:00am Ride at Oxford Circus'], 'seats read exactly as before, opted in or not');

    // _clashFor hands its third argument on; the class sheet is the caller that opts in.
    const ctx = t.loadPure('js/app.js', 'clash', {
      _myBookings: { 10: placeHeld() },
      _eventCache: cacheOf({ 77: { id: 77, start_at: '2026-09-21 07:15:00', duration: 45, _typeName: 'Ride', _locName: 'Bank' } }),
    });
    t.vm.runInContext(grab('function _clashFor('), ctx);
    eq([ctx._clashFor(77), ctx._clashFor(77, null), (ctx._clashFor(77, null, WITH) || {}).place], [null, null, true], '_clashFor(id, fresh, opts): opts reach _findClash; two-argument callers are unchanged');
    const sheetSrc = grab('window.openClassDetail = function (eventId) {', '};');
    ok(/_clashFor\(eventId, null, \{ includePlaces: true \}\)/.test(sheetSrc) && /clash\.kind === 'overlap' && !clash\.place \? 'cds-avail-full' : 'cds-avail-waitlist'/.test(sheetSrc),
      'the class sheet opts in, and a place gets the amber ink — never the red "full" one');
    ok(/_clashFor\(eventId\)\)/.test(grab('async function confirmJoinWaitlist(')) && /_clashFor\(eventId, evtData\)/.test(grab('async function _bookEventHeadless(')),
      'confirmJoinWaitlist and _bookEventHeadless stay on the default (a place must never make "Book my week" skip a class)');
  }

  // ── R2-26: the shared "starts in…" phrase ─────────────────────────────────
  t.section('Late-cancel wording: one "starts in…" phrase for the cancel dialog, the claim confirm and the announcement');
  const card = t.loadPure('js/app.js', 'bookings-card');
  {
    const phrase = (h) => card._startsInPhrase(card._hoursMinsLeft(h));
    eq([phrase(1.75), phrase(10), phrase(0.5), phrase(59 / 60 + 40 / 3600), phrase(10 / 3600)], ['starts in 1h 45m', 'starts in 10h', 'starts in 30 min', 'starts in 1h', 'starts in 1 min'],
      '1h 45m / 10h (no "0m") / 30 min / rounds up to 1h (never "60 min") / last seconds read "1 min"');
    ok(/_startsInPhrase\(left\)/.test(grab('function confirmCancelWithPolicy(')), 'confirmCancelWithPolicy words its warning through the same helper');
  }

  // ── R2-8 (1) + R2-26: the REAL claimWaitlistSpot, up to its confirm ───────
  t.section('Claim spot: the confirm names the fallback seat it would double up with, and the real cancel terms');
  function claimWorld(o) {
    o = o || {};
    const log = { confirms: [], calls: [], toasts: [] };
    const NOW = new Date('2026-09-21T16:15:00').getTime(); // class (77) at 18:00 → 1h 45m
    const ctx = t.loadPure('js/app.js', 'bookings-card', {
      Date: pinnedDate(NOW),
      navigator: { onLine: true },
      window: {},
      document: { createElement: () => ({ textContent: '', disabled: false, style: {} }) },
      currentUser: { id: 7, stats: { credits_remaining: 3 } },
      _myBookings: Object.assign({ 77: { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 900, status: 'waiting', expiresAt: null } } }, o.bookings || {}),
      _eventCache: Object.assign({ 77: { id: 77, start_at: '2026-09-21T18:00:00', duration: 45, _typeName: 'Ride', _locName: 'Bank' } }, o.cache || {}),
      apiFetch: async (path, opts) => {
        log.calls.push([(opts && opts.method) || 'GET', path]);
        if (opts && opts.method) throw new Error('waitlist-polish suite: a declined confirm must never send ' + opts.method + ' ' + path);
        return { ok: true, status: 200, json: async () => ({ data: { id: 900, status: 'waiting', event: Object.assign({ id: 77, start_at: '2026-09-21 18:00:00', duration: 45, is_class_full: false, available_slots: [13], required_credits: 1 }, o.event || {}) } }) };
      },
      confirmModal: async (opts) => { log.confirms.push(opts); return false; }, // the member declines
      toast: (msg) => log.toasts.push(msg),
      _waitlistClassLine: () => 'Ride · Alex · Mon 21, 6:00pm',
      _recordShape: () => {}, refreshUpcomingPanel: () => {}, fetchMyBookings: async () => true, // (_recordWaitlistShape became _recordShape upstream)
    });
    // The claim dialog counts free spots with _plural (pure:copy) and a thrown
    // error is worded by _friendlyError — the REAL ones, or a missing helper
    // would read here as "the claim failed".
    t.vm.runInContext(clashBlock + '\n' + wlBlock + '\n' + between('// ── pure:copy:start', '// ── pure:copy:end') + '\n' +
      [grab('function _busyLabel('), grab('function _clashFor('), grab('function _friendlyError('), grab('async function claimWaitlistSpot(')].join('\n'), ctx);
    return { ctx, log };
  }
  {
    // Fallback seat: event 10, 17:45–18:30 at Oxford Circus — overlaps the 18:00 being claimed.
    const fallback = { bookings: { 10: seat() }, cache: { 10: { id: 10, start_at: '2026-09-21T17:45:00', duration: 45, _typeName: 'Ride 45', _locName: 'Oxford Circus' } } };
    let w = claimWorld(fallback);
    eq(await w.ctx.claimWaitlistSpot(77, null), false, 'declined → resolves false');
    eq(w.log.confirms.map((c) => c.title), ['Claim this spot?'], 'still the one explicit confirm');
    eq(w.log.confirms[0].warn, 'Clashes with your 5:45pm Ride 45 at Oxford Circus. This class starts in 1h 45m — once claimed, cancelling is usually charged by Psycle.',
      'warn: the held seat it overlaps, then "starts in 1h 45m — once claimed, cancelling is usually charged" (was: a generic "12-hour policy applies once you\'re booked")');
    eq(w.log.calls, [['GET', '/waitlist/900']], 'nothing but the GET went out: a declined confirm books nothing');

    w = claimWorld();
    await w.ctx.claimWaitlistSpot(77, null);
    eq(w.log.confirms[0].warn, 'This class starts in 1h 45m — once claimed, cancelling is usually charged by Psycle.', 'no fallback held → no clash line');

    // The entry's own (fresh) class time wins over the cache: Psycle says it moved to tomorrow 18:00 → a free-cancel deadline exists.
    w = claimWorld({ event: { start_at: '2026-09-22 18:00:00' } });
    await w.ctx.claimWaitlistSpot(77, null);
    eq(w.log.confirms[0].warn, "Free cancel until Tue 6:00am — after that Psycle's 12-hour cancellation policy applies.", 'outside 12h (fresh time from the entry): the actual deadline');
    w = claimWorld({ event: { start_at: 'TBC' }, cache: { 77: { id: 77, start_at: 'TBC', duration: 45 } } });
    await w.ctx.claimWaitlistSpot(77, null);
    eq(w.log.confirms[0].warn, "Psycle's normal 12-hour cancellation policy applies once you're booked.", "a time that can't be read keeps today's sentence");
    w = claimWorld();
    w.ctx._clashFor = () => { throw new Error('odd cache shape'); };
    w.ctx._cancelDeadline = () => { throw new Error('odd start'); };
    await w.ctx.claimWaitlistSpot(77, null);
    eq([w.log.confirms.length, w.log.confirms[0].warn], [1, "Psycle's normal 12-hour cancellation policy applies once you're booked."], 'both lines are advisory: if they throw, the confirm still goes up with today\'s copy');
  }

  // ── R2-8 (1) + R2-26: the REAL "You're in" announcement ───────────────────
  t.section('"You\'re in" announcement: the overlap with a held seat and the real cancel terms');
  function announceWorld(o) {
    o = o || {};
    const log = { confirms: [], events: [], timers: [] };
    const els = o.els || {};
    const ctx = t.loadPure('js/app.js', 'bookings-card', {
      Date: pinnedDate(new Date(o.now || '2026-09-21T09:00:00').getTime()), // class (77) at 18:00 → 9h
      setTimeout: (fn, ms) => { log.timers.push([fn, ms]); return log.timers.length; }, clearTimeout: () => {},
      document: { getElementById: (id) => els[id] || null },
      PsycleEvents: { emit: (e) => log.events.push(e) },
      confirmModal: (opts) => { log.confirms.push(opts); return new Promise(() => {}); }, // left open
      _waitlistClassLine: (id) => 'Class ' + id,
      _myBookings: Object.assign({ 77: seat() }, o.bookings || {}),
      _eventCache: Object.assign({ 77: { id: 77, start_at: '2026-09-21T18:00:00', duration: 45, _typeName: 'Ride', _locName: 'Bank' } }, o.cache || {}),
    });
    t.vm.runInContext(clashBlock + '\n' + [grab('function _clashFor('), grab('function _dialogOpen(')].join('\n') +
      '\nvar _allocAnnounceTimer = null, _announceShowing = false; var _pendingAnnounce = { allocated: {}, emitted: {} };\n' + grab('function _announceAllocations('), ctx);
    return { ctx, log, els };
  }
  {
    // The first-run welcome can be replayed from Settings while signed in. It is
    // full-screen and ABOVE confirmModal: the dialog opened under it, took focus
    // there, and the Escape that closed the welcome answered it too — a
    // chargeable seat recorded as announced without ever being seen.
    const w = announceWorld({ els: { onboardOverlay: {} } });
    w.ctx._announceAllocations([77]);
    eq([w.log.confirms.length, w.log.events, w.log.timers.length, w.log.timers[0] && w.log.timers[0][1]], [0, [], 1, 700],
      'the welcome is up: nothing opens under it and nothing is emitted — it looks again in 700ms, as for any dialog');
    w.log.timers[0][0]();
    eq([w.log.confirms.length, w.log.timers.length], [0, 2], '…and again, for as long as it stays up');
    delete w.els.onboardOverlay;
    w.log.timers[1][0]();
    eq([w.log.confirms.length, w.log.confirms[0] && w.log.confirms[0].title, w.log.events], [1, "You're in — Psycle gave you a spot", ['waitlist:allocated']],
      'welcome closed: the announcement goes up, to be acknowledged for real');
    ok(!/onboardOverlay/.test(grab('function _dialogOpen(')), '_dialogOpen() itself does not know the welcome: launch rendering underneath must not wait for it');
  }
  {
    const fallback = { bookings: { 10: seat() }, cache: { 10: { id: 10, start_at: '2026-09-21T17:45:00', duration: 45, _typeName: 'Ride 45', _locName: 'Oxford Circus' } } };
    let w = announceWorld(fallback);
    w.ctx._announceAllocations([77]);
    eq(w.log.confirms[0].warn, 'Clashes with your 5:45pm Ride 45 at Oxford Circus. This class starts in 9h — cancelling it now is usually charged by Psycle.',
      'found 9h out, fallback held: both said (was: "the 12-hour policy applies to it from now on" — read as time to decide)');
    eq([w.log.confirms[0].title, w.log.events], ["You're in — Psycle gave you a spot", ['waitlist:allocated']], 'same dialog, same event');

    w = announceWorld({ now: '2026-09-20T09:00:00' }); // 33h out
    w.ctx._announceAllocations([77]);
    eq(w.log.confirms[0].warn, "Free cancel until Mon 6:00am — after that Psycle's 12-hour cancellation policy applies.", 'outside 12h: the actual deadline');
    w = announceWorld({ now: '2026-09-21T18:10:00' }); // already started
    w.ctx._announceAllocations([77]);
    eq(w.log.confirms[0].warn, "Psycle's normal 12-hour cancellation policy applies to it from now on.", "a class that has started keeps today's sentence");
    w = announceWorld({ bookings: { 78: seat() }, cache: { 78: { id: 78, start_at: '2026-09-22T07:00:00', duration: 45 } } });
    w.ctx._announceAllocations([77, 78]);
    eq(w.log.confirms[0].warn, "Psycle's normal 12-hour cancellation policy applies to it from now on.", "two allocations at once: two deadlines don't fit one sentence — today's copy");
    w = announceWorld({ cache: { 77: undefined } });
    w.ctx._announceAllocations([77]);
    eq(w.log.confirms.length, 1, 'an uncached class still gets its announcement (the extra lines are advisory)');
  }

  // ── R2-10: the class sheet for a claimable place ──────────────────────────
  t.section('Class sheet: a place with a spot to claim leads with Claim, not a ticked button that opens "Leave the waitlist?"');
  function sheetWorld(booking, o) {
    o = o || {};
    let sheet = null;
    const ctx = t.loadPure('js/app.js', 'clash', {
      Date: pinnedDate(new Date(o.now || '2026-09-21T16:30:00').getTime()),
      window: {}, instructors: [],
      escapeHTML, escapeForJsString: (s) => String(s),
      formatSlots: (l, s) => l + ' ' + s.join(', '), slotLabelForEvent: () => 'Bike',
      document: { getElementById: () => null, createElement: () => (sheet = { style: {}, innerHTML: '' }), body: { appendChild: () => {} } },
      _myBookings: Object.assign(booking ? { 77: booking } : {}, o.bookings || {}),
      _eventCache: Object.assign({ 77: { id: 77, start_at: '2026-09-21T18:00:00', duration: 45, instructor_id: 31, is_fully_booked: true, is_waitlistable: true, _typeName: 'Ride', _instrName: 'Alex', _locName: 'Bank' } }, o.cache || {}),
    });
    t.vm.runInContext(wlBlock + '\n' + grab('function _clashFor(') + '\n' + grab('window.openClassDetail = function (eventId) {', '};'), ctx);
    ctx.window.openClassDetail(77);
    return sheet ? sheet.innerHTML : '';
  }
  {
    let html = sheetWorld(placeOnly({ offer: { available: true, checkedAt: 0 } }));
    ok(/<button class="cds-book-btn" onclick="[^"]*_classDetailClaimAction\(77\);">Claim spot<\/button>/.test(html), 'offer showing: the primary sheet button is "Claim spot" → _classDetailClaimAction');
    ok(/<button class="cds-view-instr" onclick="[^"]*leaveWaitlist\(77, null\);">Leave waitlist<\/button>/.test(html) && !/Waitlisted ✓/.test(html), '…Leave is the secondary action; the ticked "Waitlisted ✓" is gone');
    ok(/A spot is free right now/.test(html) && !/waitlist open/.test(html), '…and the availability row says "A spot is free right now", not "Full — waitlist open"');
    html = sheetWorld(placeOnly({ status: 'notified' }));
    ok(/Claim spot/.test(html) && /A spot has opened up/.test(html), "Psycle's own offered status (no probe yet) counts too");

    html = sheetWorld(placeOnly());
    ok(/leaveWaitlist\(77, null\);">Waitlisted ✓<\/button>/.test(html) && !/Claim spot/.test(html), 'no offer: the ticked "Waitlisted ✓" → Leave button, as before');
    ok(/You’re on the waitlist/.test(html) && !/waitlist open/.test(html), '…with "You’re on the waitlist" instead of "Full — waitlist open"');
    html = sheetWorld(placeOnly({ offer: { available: true, checkedAt: 0 } }), { now: '2026-09-21T18:30:00' });
    ok(!/Claim spot/.test(html) && !/A spot is free/.test(html), 'a class that has started never offers Claim');
    html = sheetWorld(null);
    ok(/Full — waitlist open/.test(html) && /Join Waitlist/.test(html), 'not on the waitlist: "Full — waitlist open" + Join Waitlist — unchanged');

    // Opening a class that overlaps a held PLACE: amber, worded as a possibility.
    html = sheetWorld(null, { bookings: { 10: placeHeld() }, cache: { 10: { id: 10, start_at: '2026-09-21T17:45:00', duration: 45, _typeName: 'Ride 45', _locName: 'Oxford Circus' } } });
    ok(/<span class="cds-avail-waitlist">You&#39;re also on the waitlist for the 5:45pm Ride 45 at Oxford Circus|<span class="cds-avail-waitlist">You're also on the waitlist for the 5:45pm Ride 45 at Oxford Circus/.test(html),
      'sheet for a class overlapping a held place: amber "You\'re also on the waitlist for the…" row');
    html = sheetWorld(null, { bookings: { 10: seat() }, cache: { 10: { id: 10, start_at: '2026-09-21T17:45:00', duration: 45, _typeName: 'Ride 45', _locName: 'Oxford Circus' } } });
    ok(/<span class="cds-avail-full">Clashes with your 5:45pm Ride 45 at Oxford Circus/.test(html), '…a held SEAT is still the red "Clashes with your…"');
  }
  {
    // _classDetailClaimAction: which button it drives, and that one tap is one claim.
    function claimActionWorld(cardBtn) {
      const log = { toasts: [], claims: [] };
      let release;
      const ctx = t.vm.createContext({
        Number, document: { querySelector: (sel) => { log.selector = sel; return cardBtn; } },
        toast: (m) => log.toasts.push(m),
        claimWaitlistSpot: (id, btn) => { log.claims.push([id, btn]); return new Promise((r) => { release = r; }); },
      });
      t.vm.runInContext('var _sheetActionBusy = {};\n' + grab('async function _classDetailClaimAction('), ctx);
      return { ctx, log, release: () => release(true) };
    }
    let w = claimActionWorld(null);
    const first = w.ctx._classDetailClaimAction(77);
    await w.ctx._classDetailClaimAction(77); // second tap while the first GET is still out
    eq([w.log.claims, w.log.toasts], [[[77, null]], ['Checking for a spot…']], 'no card button on screen (sheet opened from Discover): says "Checking for a spot…", one claim for two taps');
    eq(w.log.selector, '.my-booking-card[data-id="77"] .mb-primary-btn:not(.booked)', "it looks for that class's own non-.booked primary button (Claim / Check — never Leave or Cancel)");
    w.release(); await first;
    w.ctx._classDetailClaimAction(77);
    eq(w.log.claims.length, 2, '…and the guard is released afterwards');
    const visible = { disabled: false, offsetParent: {} };
    w = claimActionWorld(visible);
    w.ctx._classDetailClaimAction(77);
    eq([w.log.claims, w.log.toasts], [[[77, visible]], []], "the card's button on screen: it is handed over (its '…' is the feedback) and no toast");
    w = claimActionWorld({ disabled: true, offsetParent: {} });
    w.ctx._classDetailClaimAction(77);
    eq(w.log.claims, [], 'that button already mid-request: nothing is started on top of it');
  }
  {
    // leaveWaitlist: the free spot is stated in the dialog it already shows — no second dialog.
    const leaveWorld = (booking) => {
      const log = { confirms: [] };
      const ctx = t.vm.createContext({
        Number, String,
        document: { createElement: () => ({}) },
        _myBookings: { 77: booking },
        _waitlistClassLine: () => 'Ride · Alex',
        confirmModal: async (opts) => { log.confirms.push(opts); return false; },
      });
      t.vm.runInContext(wlBlock + '\n' + grab('async function leaveWaitlist('), ctx);
      return { ctx, log };
    };
    let w = leaveWorld(placeOnly({ offer: { available: true, checkedAt: 0 } }));
    eq(await w.ctx.leaveWaitlist(77, null), false, 'declined → nothing sent');
    ok(w.log.confirms.length === 1 && /^A spot looks free to claim right now/.test(w.log.confirms[0].warn) && /that booking stays/.test(w.log.confirms[0].warn),
      'offer showing: ONE dialog, its warning opens with the free spot and keeps the existing sentence');
    w = leaveWorld(placeOnly());
    await w.ctx.leaveWaitlist(77, null);
    eq(w.log.confirms[0].warn, 'If Psycle has only just given you a spot, that booking stays — it will show in My Bookings.', 'no offer: the warning reads exactly as before');
  }

  // ── R2-20: "Same class next week" over a place ────────────────────────────
  t.section('Find similar: "Same class next week" does not call a waitlist place "booked"');
  {
    const world = (nextWeek) => {
      const log = { toasts: [], fetches: 0 };
      const ctx = t.vm.createContext({
        Date, Math, Object,
        localDateStr: (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'),
        toast: (msg, type) => log.toasts.push([msg, type]),
        apiFetch: async () => { log.fetches++; return { ok: false }; },
        _studioMap: {},
        _eventCache: {
          77: { start_at: '2026-09-22 07:00:00', instructor_id: 31, event_type_id: 7, studio_id: 4 },
          88: { start_at: '2026-09-29 07:00:00', instructor_id: 31, event_type_id: 7, studio_id: 4 },
          89: { start_at: '2026-09-29 07:15:00', instructor_id: 31, event_type_id: 7, studio_id: 4 },
        },
        _myBookings: Object.assign({ 77: seat() }, nextWeek),
      });
      t.vm.runInContext(grab('async function rebookNextWeek('), ctx);
      return { ctx, log };
    };
    let w = world({ 88: placeHeld() });
    await w.ctx.rebookNextWeek(77);
    eq([w.log.toasts, w.log.fetches], [[["You're on the waitlist for next week's class — it isn't booked yet", 'info']], 0],
      'only a place held for next week: says so (was "Already booked for next week"), and still stops — carrying on would reach bookClass\'s "Leave the waitlist?" branch');
    w = world({ 88: seat() });
    await w.ctx.rebookNextWeek(77);
    eq([w.log.toasts, w.log.fetches], [[['Already booked for next week', 'info']], 0], 'a real seat next week: "Already booked for next week" — unchanged');
    w = world({ 88: placeHeld(), 89: seat() });
    await w.ctx.rebookNextWeek(77);
    eq(w.log.toasts[0][0], 'Already booked for next week', 'a place AND a seat matching: the seat decides');
  }

  // ── R2-9: the re-check ticker ─────────────────────────────────────────────
  t.section('Offer re-check: only looks, only when someone can see it, and never repaints for nothing');
  const tickerSrc = between('const WAITLIST_RECHECK_MS = 120000;', '// After a real booking is cancelled locally');
  // renderMyBookings' own baseline stamp — the shipped line, run by the stand-in
  // below, so every painter (not only the ticker) moves what the ticker diffs against.
  const STAMP = "if (typeof _placesShownSig === 'function') _waitlistShownSig = _placesShownSig(_myBookings);";
  {
    const tail = src.slice(src.indexOf('function renderMyBookings()'), src.indexOf('// ── pure:render-perf:start'));
    const at = tail.indexOf(STAMP), commitAt = tail.indexOf("if (typeof _commitBookingsHtml === 'function')");
    ok(at !== -1 && at < commitAt && !/\breturn\b/.test(tail.slice(at, commitAt)), 'renderMyBookings stamps the ticker\'s baseline on the way to the commit (which stays its last step)');
  }
  function tickerWorld(o) {
    o = o || {};
    const w = { probes: 0, renders: 0, fetches: 0, intervals: [], cleared: [], handlers: {}, hidden: false, online: true, tab: 'tab-bookings', dialog: false, sheet: false, busyBtn: false, popup: false, token: 'tok' };
    w.now = new Date(o.now || '2026-09-21T16:30:00').getTime(); // class at 18:00 → inside the window
    class Clock extends Date { // movable: the ticker is about time passing
      constructor(...a) { if (a.length) super(...a); else super(w.now); }
      static now() { return w.now; }
    }
    const ctx = t.vm.createContext({
      JSON, Object,
      Date: Clock,
      window: {},
      navigator: { get onLine() { return w.online; } },
      document: {
        get hidden() { return w.hidden; },
        querySelector: (sel) => {
          if (sel === '.tab-panel.active') return { id: w.tab };
          if (/#upcomingList button:disabled/.test(sel) && w.busyBtn) return {};
          if (/#upcomingList \.find-similar-popup/.test(sel) && w.popup) return {};
          return null;
        },
        getElementById: (id) => (id === 'classDetailOverlay' && w.sheet ? {} : null),
        addEventListener: (type, fn) => { w.handlers['dom:' + type] = fn; },
      },
      getBearerToken: () => w.token,
      _dialogOpen: () => w.dialog,
      setInterval: (fn, ms) => { w.intervals.push(ms); return w.intervals.length; },
      clearInterval: (id) => { w.cleared.push(id); },
      PsycleEvents: { on: (e, fn) => { w.handlers[e] = fn; } },
      __painted: () => { w.renders++; },
      fetchMyBookings: () => { w.fetches++; },
      _eventCache: { 77: { start_at: '2026-09-21T18:00:00' } },
      _myBookings: { 77: placeOnly() },
      _probeWaitlistOffers: async (map) => { w.probes++; return o.probe ? o.probe(map, w) : { probed: 0, changed: false, allocated: false }; },
    });
    t.vm.runInContext(wlBlock + '\n' + grab('function _placeNeedsOfferCheck(') + '\n' + tickerSrc +
      '\nfunction renderMyBookings() { __painted(); ' + STAMP + ' }', ctx, { filename: 'js/app.js[offer re-check]' });
    w.ctx = ctx;
    // As in the app: a place only ever arrives through a fetch (or a join), which
    // repaints My Bookings and re-arms the ticker with what the cards now show.
    if (!o.unarmed) w.handlers['bookings:loaded']();
    return w;
  }
  {
    const setOffer = (available) => (map) => { map[77].waitlist.offer = { available, checkedAt: 1 }; return { probed: 1, changed: true, allocated: false }; };
    let w = tickerWorld({ probe: setOffer(true) });
    await w.ctx._waitlistRecheckTick();
    eq([w.probes, w.renders, w.fetches], [1, 1, 0], 'tab on screen, place inside the window, a spot appears → one repaint ("Spot available — Claim spot")');
    await w.ctx._waitlistRecheckTick();
    eq([w.probes, w.renders], [2, 1], 'the next look finds the same thing → NO repaint (the probe reports changed:true every time; a repaint for nothing can land mid-tap)');

    w = tickerWorld({ probe: setOffer(false) });
    await w.ctx._waitlistRecheckTick();
    eq([w.probes, w.renders], [1, 0], 'still full: the card shows the same → no repaint');

    // The clock alone moves a card on: armed at 2h10 ("books you in automatically"), still open at 1h50.
    w = tickerWorld({ now: '2026-09-21T15:50:00', probe: setOffer(false) });
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 0, '2h10 out, nothing new: no repaint');
    w.now = new Date('2026-09-21T16:10:00').getTime();
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 1, '1h50 out: the card is repainted ONCE so it stops promising auto-booking (left open, it used to say so until the next refetch)');
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 1, '…and not again while nothing moves');
    w.now = new Date('2026-09-21T17:35:00').getTime();
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 2, '25 min out: repainted once more for "Waitlist closed"');
    // …even when the probe itself is throttled out (it asked 30s ago) — the copy still has to move on.
    w = tickerWorld({ now: '2026-09-21T15:59:30' });
    w.now = new Date('2026-09-21T16:00:30').getTime();
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 1, 'a throttled probe (probed: 0) does not hold back a repaint the clock calls for');

    for (const [why, set] of [['page hidden', (x) => { x.hidden = true; }], ['offline (would only fill the error log)', (x) => { x.online = false; }],
      ['another tab showing', (x) => { x.tab = 'tab-discover'; }], ['a dialog open', (x) => { x.dialog = true; }], ['the class sheet open', (x) => { x.sheet = true; }],
      ['a card button mid-request', (x) => { x.busyBtn = true; }], ['a "Similar" popup open inside a card', (x) => { x.popup = true; }], ['signed out', (x) => { x.token = ''; }]]) {
      w = tickerWorld({ probe: setOffer(true) });
      set(w);
      await w.ctx._waitlistRecheckTick();
      eq([w.probes, w.renders], [0, 0], why + ': nothing is asked, nothing repainted');
    }
    w = tickerWorld({ probe: setOffer(true) });
    w.ctx._eventCache[77].start_at = '2026-09-22T18:00:00'; // tomorrow: outside the window
    w.handlers['bookings:loaded']();
    await w.ctx._waitlistRecheckTick();
    eq([w.probes, w.renders], [0, 0], 'no place inside the offer window: nothing is asked');

    w = tickerWorld({ probe: () => ({ probed: 1, changed: false, allocated: true }) });
    await w.ctx._waitlistRecheckTick();
    eq([w.fetches, w.renders], [1, 0], 'a probed place is a seat already → reload the bookings (that path announces it); never claimed or booked from here');
    ok(!/claimWaitlistSpot|joinWaitlist|method:/.test(tickerSrc), 'the ticker only LOOKS: it calls neither claim nor join, and sends nothing itself');

    w = tickerWorld({ probe: (map, world) => { world.ctx._myBookings = {}; return setOffer(true)(map); } });
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 0, 'the map was replaced while the probe was out (a fetch landed): its result is dropped');

    // A button goes busy while the probe is out: the repaint is owed, and paid at the next quiet tick.
    w = tickerWorld({ probe: (map, world) => { world.busyBtn = true; return setOffer(true)(map); } });
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 0, 'offer changed under a busy button: no repaint now (it would swap the button out mid-request)');
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 0, '…nor while it is still busy');
    w.busyBtn = false;
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 1, '…paid once things are quiet');
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 1, '…and only once');

    // Other painters move the same cards. (A) the fetch's OWN probe repaints
    // "Claim spot" after bookings:loaded stamped "no offer"; the next look finds
    // the spot gone — that used to equal the stale baseline, and the card kept
    // urging a claim on every later tick.
    let offer = false;
    w = tickerWorld({ probe: (map) => setOffer(offer)(map) });
    w.ctx._myBookings[77].waitlist.offer = { available: true, checkedAt: 1 };
    w.ctx.renderMyBookings(); // fetchMyBookings' probe: result.changed → renderMyBookings()
    eq(w.renders, 1, '(the fetch\'s own probe painted "Claim spot")');
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 2, 'the spot is gone at the next look → the card is repainted (it kept reading "Claim spot")');
    // (B) the ticker painted "Claim spot"; the member tapped it, the GET said
    // gone → claimWaitlistSpot wrote offer:false and repainted; then a spot frees.
    offer = true;
    w = tickerWorld({ probe: (map) => setOffer(offer)(map) });
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 1, '(the ticker painted "Claim spot")');
    w.ctx._myBookings[77].waitlist.offer = { available: false, checkedAt: 2 };
    w.ctx.renderMyBookings(); // claimWaitlistSpot → refreshUpcomingPanel()
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 3, 'another spot frees two minutes later → painted (it equalled the stale baseline and never showed)');
    await w.ctx._waitlistRecheckTick();
    eq(w.renders, 3, '…and still no repaint for nothing');

    // Places that only arrive through the late /waitlists merge: no bookings:loaded follows.
    {
      const lateSrc = src.slice(src.indexOf('// The waitlist list missed the deadline'), src.indexOf('// Places that arrived late are full classes too'));
      ok(/renderMyBookings\(\);\s*(\/\/[^\n]*\n\s*)*if \(typeof _syncWaitlistRecheck === 'function'\) _syncWaitlistRecheck\(false\);/.test(lateSrc),
        'the late merge re-arms the ticker itself, right after its repaint');
    }

    // The trailing "did it land?" re-reads of join / leave: signed out by then
    // (a 401 expired the session), fetchMyBookings' no-token branch would empty
    // the list expiry keeps — so they only run with a token.
    ok(!/setTimeout\(\(\) => \{ try \{ fetchMyBookings\(\);/.test(src) && (src.match(/setTimeout\(\(\) => \{ try \{ if \(getBearerToken\(\)\) fetchMyBookings\(\); \} catch \(err\) \{\} \}, (1500|3000)\)/g) || []).length === 3,
      'joinWaitlist\'s two 3s re-reads and leaveWaitlist\'s 1.5s one are token-guarded');

    // Arming: one interval while a place is held and the page is visible; dropped when hidden / no place / signed out.
    w = tickerWorld({ unarmed: true });
    ok(['bookings:loaded', 'waitlist:joined', 'waitlist:left', 'auth:changed', 'dom:visibilitychange'].every((k) => typeof w.handlers[k] === 'function'), 're-armed on bookings:loaded / waitlist:joined|left / auth:changed / visibilitychange');
    eq(w.intervals, [], 'nothing runs until a place is known');
    w.handlers['bookings:loaded'](); w.handlers['waitlist:joined']();
    eq(w.intervals, [120000], 'armed once (2 min), not once per event');
    w.hidden = true; w.handlers['dom:visibilitychange']();
    eq(w.cleared, [1], 'page hidden → the ticker is dropped');
    w.hidden = false; w.handlers['dom:visibilitychange']();
    eq(w.intervals.length, 2, 'visible again → re-armed');
    w.token = ''; w.handlers['auth:changed']();
    eq(w.cleared.length, 2, 'signed out → dropped');
    w.token = 'tok'; w.handlers['auth:changed']();
    w.ctx._myBookings = { 77: seat() }; w.handlers['bookings:loaded']();
    eq([w.intervals.length, w.cleared.length], [3, 3], 'no place held any more → dropped');
  }
};
