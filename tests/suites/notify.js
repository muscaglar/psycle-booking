'use strict';
// "Notify me when a spot opens" (#100): the pure plan + the strict "opened" test
// (pure:notify in js/features.js), then the REAL checkWatchedEvents and its
// dialog, sliced out of source and run against a scripted Psycle. What matters:
// it only ever GETs, a handful at a time and not often; a missing field is never
// "open"; and a class leaves the watchlist only once the member has answered.
module.exports = async function (t) {
  const { ok, eq } = t;
  const src = t.readSource('js/features.js');
  const lines = src.split('\n');
  const region = (fromLine, untilLine) => {
    const from = lines.findIndex((l) => l.startsWith(fromLine));
    const to = lines.findIndex((l, i) => i > from && l.startsWith(untilLine));
    if (from === -1 || to === -1) throw new Error('notify suite: cannot slice "' + fromLine + '" … "' + untilLine + '" (anchor moved?)');
    return lines.slice(from, to).join('\n');
  };

  const london = t.loadPure('js/app.js', 'gym-time')._gymClassStartMs;
  // Mon 21 Sep 2026, 10:30 in London (BST) = 09:30 UTC. The runner's zone is New York.
  const NOW = Date.UTC(2026, 8, 21, 9, 30);
  const p = t.loadPure('js/features.js', 'notify');

  t.section('Notify plan: what is dropped without asking Psycle');
  ok(typeof p._watchPlan === 'function' && typeof p._watchSpotOpened === 'function', 'pure:notify exposes _watchPlan + _watchSpotOpened');
  {
    const cache = { 10: { start_at: '2026-09-25 18:30:00' }, 11: { start_at: '2026-09-20 18:30:00' }, 12: { start_at: '2026-09-21 10:30:00' }, 13: { start_at: '2026-09-21 10:31:00' } };
    const plan = (list, bookings, c) => p._watchPlan(list, bookings || {}, c || cache, NOW, london, {}, 5);
    eq(plan(['10', '11']), { drop: ['11'], check: ['10'] }, 'a class that ran yesterday is dropped; an upcoming one is checked');
    eq(plan(['12', '13']), { drop: ['12'], check: ['13'] }, 'started this minute → dropped; starting in one minute → still worth a look');
    eq(plan(['10'], { 10: { waitlisted: false } }), { drop: ['10'], check: [] }, 'already holding a seat → nothing to be told');
    eq(plan(['10'], { 10: { waitlisted: true } }), { drop: ['10'], check: [] }, "…or a waitlist place: Psycle's own waitlist has it from here");
    eq(plan(['10', 10, '10']), { drop: [], check: ['10'] }, 'duplicates (and a number stored for a string) collapse to one request');
    eq(plan(['99']), { drop: [], check: ['99'] }, 'not in the timetable cache (the watchlist outlives it) → asked about, not dropped');
    eq(plan(['10'], {}, { 10: { start_at: 'TBC' } }), { drop: [], check: ['10'] }, 'an unreadable cached time is not "past"');
    // Settings → import can write this key from a file: nothing but digits may reach a URL or a selector.
    eq(plan(['10', '../profile', '10"] , body', '', null, {}, '1e3', ' 7', '-5', '٣']).check, ['10'], 'anything that is not a plain id never becomes a request');
    eq(plan(['../profile', '10"]']).drop, ['../profile', '10"]'], '…and is pruned from the list');
    eq([plan(null), plan('10'), plan(undefined)], [{ drop: [], check: [] }, { drop: [], check: [] }, { drop: [], check: [] }], 'a corrupt (non-array) list → nothing, never a throw');
    // 12:00 London is 11:00 UTC: parsed device-locally in New York it would read 16:00 UTC.
    eq(p._watchPlan(['14'], {}, { 14: { start_at: '2026-09-21 09:00:00' } }, NOW, london, {}, 5).drop, ['14'], 'past is judged on the London start, not the device clock (09:00 London has gone; 09:00 New York has not)');
  }

  t.section('Notify plan: at most five, and a long list is not starved');
  {
    const ids = ['1', '2', '3', '4', '5', '6', '7'];
    const cache = {};
    ids.forEach((id, i) => { cache[id] = { start_at: '2026-09-2' + (8 - i) + ' 07:00:00' }; }); // id 7 is soonest (22nd), id 1 latest (28th)
    const first = p._watchPlan(ids, {}, cache, NOW, london, {}, 5);
    eq(first.check, ['7', '6', '5', '4', '3'], 'never asked before → the five SOONEST classes first');
    const checkedAt = {};
    first.check.forEach((id) => { checkedAt[id] = NOW; });
    eq(p._watchPlan(ids, {}, cache, NOW + 120000, london, checkedAt, 5).check, ['2', '1', '7', '6', '5'], 'next pass: the two that were left out go first, then round again');
    eq(p._watchPlan(['1', '99', '7'], {}, cache, NOW, london, {}, 5).check, ['7', '1', '99'], 'a class with no known time sorts last — but is still asked about');
    eq(p._watchPlan(ids, {}, cache, NOW, london, {}, 0).check, [], 'cap 0 → no requests');
  }

  t.section('Notify: only Psycle SAYING there is a spot counts');
  {
    const layout = { has_layout: true }, byCount = { has_layout: false };
    const open = (data, slots, studio) => p._watchSpotOpened(slots === undefined ? { data } : { data, slots }, studio);
    eq(open({ is_fully_booked: false }, [7], layout), true, 'not full + a bookable slot in a layout studio → open');
    eq([open({}, [7], layout), open({ is_fully_booked: null }, [7], layout), open({ is_fully_booked: undefined }, [7], layout)], [false, false, false],
      'is_fully_booked missing / null → NOT open (the old check was `!evt.is_fully_booked`: every missing field fired an alert)');
    eq([open({ is_fully_booked: true }, [7], layout), open({ is_fully_booked: 0 }, [7], layout), open({ is_fully_booked: 'false' }, [7], layout)], [false, false, false],
      'only the boolean false is an answer');
    eq([open({ is_fully_booked: false }, [], layout), open({ is_fully_booked: false }, undefined, layout), open({ is_fully_booked: false }, '7', layout)], [false, false, false],
      "layout studio with no bookable slot in the answer → not open (bookClass's own \"no seats left\" rule)");
    eq([open({ is_fully_booked: false }, [], byCount), open({ is_fully_booked: false }, undefined, byCount)], [true, true], 'a no-layout studio books by count: there is no slot list to read');
    eq([open({ is_fully_booked: false }, [7], undefined), open({ is_fully_booked: false }, undefined, undefined)], [true, true], 'studio unknown, nothing contradicting it → open');
    eq(open({ is_fully_booked: false }, [], undefined), false, 'studio unknown AND an explicitly empty slot list → no benefit of the doubt');
    eq([p._watchSpotOpened(null), p._watchSpotOpened({}), p._watchSpotOpened({ slots: [7] }, layout), p._watchSpotOpened({ is_fully_booked: false, slots: [7] }, layout)], [false, false, false, false],
      'no `data` envelope → not open (a flat or empty answer is not evidence)');
  }

  // ── Wiring: the real check + dialog ──────────────────────────────────────
  const detail = (id, o) => {
    o = o || {};
    return {
      data: Object.assign({ id, start_at: '2026-09-25 18:30:00', studio_id: 4, event_type_id: 2, instructor_id: 44, is_fully_booked: false }, o.data || {}),
      slots: o.slots === undefined ? [7] : o.slots,
      relations: { studios: [{ id: 4, name: 'Studio 1', location_id: 9, has_layout: o.hasLayout === undefined ? true : o.hasLayout }], locations: [{ id: 9, name: 'Psycle Bank', address: '1 Lane' }], event_types: [{ id: 2, name: 'Ride' }], instructors: [{ id: 44, full_name: 'Alex' }] },
    };
  };
  function world(o) {
    o = o || {};
    const clock = { now: NOW };
    class FixedDate extends Date {
      constructor(...a) { if (a.length) super(...a); else super(clock.now); }
      static now() { return clock.now; }
    }
    const log = { gets: [], opts: [], modals: [], opened: [], toasts: [], notifications: [], timers: [] };
    const store = t.makeFakeLocalStorage();
    store.setItem('psycle_notify_watchlist', JSON.stringify(o.watch || []));
    let token = o.token === undefined ? 'tok' : o.token;
    const globals = {
      Date: FixedDate,
      localStorage: store,
      navigator: { onLine: o.onLine === undefined ? true : o.onLine },
      console: { log() {}, warn() {}, error: console.error },
      setTimeout: (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; },
      clearTimeout: () => {},
      document: { querySelector: () => null, getElementById: (id) => (o.els && o.els[id]) || null },
      toast: (msg, kind) => log.toasts.push([msg, kind]),
      Promise,
    };
    const ctx = t.loadPure('js/features.js', 'notify', globals);
    ctx.window = ctx;
    ctx._psycleClassStartMs = london;
    ctx._myBookings = o.bookings || {};
    ctx._eventCache = o.cache || {};
    ctx._studioMap = o.studios || {};
    ctx.getBearerToken = () => token;
    ctx._dialogOpen = () => !!o.dialogOpen && o.dialogOpen();
    ctx._waitlistClassLine = (id) => { const e = ctx._eventCache[id]; return e ? [e._typeName, e._instrName, 'Fri 25, 6:30pm'].filter(Boolean).join(' · ') : ''; };
    ctx.openClassDetail = (id) => log.opened.push(id);
    ctx.confirmModal = (opts) => new Promise((resolve) => { log.modals.push({ opts, resolve }); });
    ctx.apiFetch = async (path, opts) => {
      log.gets.push(path);
      log.opts.push(opts);
      if (o.onGet) o.onGet(path, (v) => { token = v; });
      const id = path.replace('/events/', '');
      const answer = (o.api || {})[id];
      if (answer === 'throw') throw new Error('Request timed out');
      if (typeof answer === 'number') return { ok: false, status: answer, json: async () => ({}) };
      if (answer === 'badjson') return { ok: true, status: 200, json: async () => { throw new Error('bad json'); } };
      return { ok: true, status: 200, json: async () => (answer === undefined ? detail(Number(id), { data: { is_fully_booked: true } }) : answer) };
    };
    // pure:notify is already in the context; the rest of the notify code sits either side of it.
    t.vm.runInContext([
      region('  const NOTIFY_KEY', '  // Request notification permission'),
      region('  function _hasToken(', '  // ── pure:notify:start'),
      region('  let _watchLastPassAt', '  // ── Line class history up'),
    ].join('\n'), ctx);
    const watch = () => JSON.parse(store.getItem('psycle_notify_watchlist'));
    const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
    return { ctx, log, clock, watch, settle, store, setToken: (v) => { token = v; } };
  }
  const FULL_CACHE = (ids) => Object.fromEntries(ids.map((id) => [id, { id: Number(id), start_at: '2026-09-25 18:30:00', studio_id: 4, is_fully_booked: true, _typeName: 'Ride', _instrName: 'Alex' }]));

  t.section('Notify check: when it may talk to Psycle at all');
  {
    let w = world({ watch: [] });
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.gets, [], 'nothing watched → no requests');
    w = world({ watch: ['10'], token: '', cache: FULL_CACHE(['10']) });
    await w.ctx.checkWatchedEvents(true);
    eq([w.log.gets, w.watch()], [[], ['10']], 'signed out → no requests (and the class stays watched for when they sign in)');
    w.setToken('tok');
    w.clock.now = NOW + 1000;
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.gets, ['/events/10'], '…and a signed-out look does not use up the two-minute allowance: signing in checks straight away');
    w = world({ watch: ['10'], onLine: false, cache: FULL_CACHE(['10']) });
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.gets, [], 'offline → no requests (nothing for the error log to fill up with)');
    w = world({ watch: ['10'], cache: FULL_CACHE(['10']) });
    await w.ctx.checkWatchedEvents(false);
    await w.ctx.checkWatchedEvents();
    eq(w.log.gets, [], 'the bookings fetch that triggered it failed or was superseded → no requests: nothing is added to the load while Psycle is struggling');
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.gets, ['/events/10'], '…and that did not use up the two-minute allowance either');
    for (const corrupt of ['{"a":1}', '"10"', '7', 'null', 'not json']) {
      w = world({ watch: [] });
      w.store.setItem('psycle_notify_watchlist', corrupt);
      await w.ctx.checkWatchedEvents(true);
      eq([w.log.gets, w.ctx.getNotifyWatchlist()], [[], []], 'a corrupt watchlist (' + corrupt + ') reads as empty — no throw, no request');
    }
  }

  t.section('Notify check: GET only, five at most, every two minutes at most');
  {
    const ids = ['1', '2', '3', '4', '5', '6', '7'];
    const w = world({ watch: ids, cache: FULL_CACHE(ids) });
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.gets.length, 5, 'seven watched → five requests this pass');
    ok(w.log.gets.every((path) => /^\/events\/\d+$/.test(path)), 'every one is /events/{digits}');
    ok(w.log.opts.every((op) => op && op.retries === 0 && op.method === undefined && op.body === undefined), 'every one is a plain GET with retries:0 — never a write, never leaning on a struggling API');
    await w.ctx.checkWatchedEvents(true);
    w.clock.now = NOW + 119000;
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.gets.length, 5, 'fetchMyBookings fires often (visibility, pull-to-refresh, after a booking): within two minutes nothing more is sent');
    w.clock.now = NOW + 120000;
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.gets.slice(5, 7).sort(), ['/events/6', '/events/7'], 'two minutes on: the two left out last time go first');
    eq(w.log.gets.length, 10, '…and the pass is five again');
  }
  {
    let release;
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']) });
    const slow = w.ctx.apiFetch;
    w.ctx.apiFetch = (path, opts) => new Promise((resolve) => { release = () => resolve(slow(path, opts)); });
    const first = w.ctx.checkWatchedEvents(true);
    w.clock.now = NOW + 300000;
    await w.ctx.checkWatchedEvents(true);
    release();
    await first;
    eq(w.log.gets.length, 1, 'a pass still in flight is never joined by a second one, however long it takes');
  }
  {
    const w = world({ watch: ['1', '2', '3'], cache: FULL_CACHE(['1', '2', '3']), onGet: (path, setToken) => { if (path === '/events/1') setToken(''); } });
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.gets, ['/events/1'], 'signed out part-way through a pass → it stops there');
  }

  t.section('Notify check: pruning');
  {
    let w = world({ watch: ['10', '11', '12', '13'], cache: FULL_CACHE(['10', '11', '12', '13']), api: { 10: 404, 11: 500, 12: 403, 13: 'badjson' } });
    await w.ctx.checkWatchedEvents(true);
    eq(w.watch(), ['11', '12', '13'], '404 → the class is gone, stop watching; 500 / 403 / an unreadable body say nothing about the class → keep watching');
    w = world({ watch: ['10', '11', '12'], cache: FULL_CACHE(['10', '11', '12']), api: { 10: 404, 11: 'throw' } });
    await w.ctx.checkWatchedEvents(true);
    eq([w.log.gets, w.watch()], [['/events/10', '/events/11'], ['11', '12']], 'a network failure ends the pass (no hammering a dead connection); what was learned before it still applies');
    w = world({ watch: ['10', '20'], bookings: { 20: { waitlisted: false } }, cache: FULL_CACHE(['10', '20']) });
    await w.ctx.checkWatchedEvents(true);
    eq([w.log.gets, w.watch()], [['/events/10'], ['10']], 'a class the member now holds is dropped without a request');
    w = world({ watch: ['99'], api: { 99: detail(99, { data: { start_at: '2026-09-20 18:30:00' } }) } });
    await w.ctx.checkWatchedEvents(true);
    eq([w.watch(), w.log.modals.length], [[], 0], 'not in the cache, and Psycle says it ran yesterday → pruned, no alert');
    w = world({ watch: ['10', 'junk"]'], cache: FULL_CACHE(['10']) });
    await w.ctx.checkWatchedEvents(true);
    eq([w.log.gets, w.watch()], [['/events/10'], ['10']], 'a junk id from an imported file is pruned and never requested');
  }
  {
    // A bell tapped while the pass was awaiting must survive the pass's own write.
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: 404 }, onGet: () => { w.store.setItem('psycle_notify_watchlist', JSON.stringify(['10', '55'])); } });
    await w.ctx.checkWatchedEvents(true);
    eq(w.watch(), ['55'], 'the list is re-read at write time: a class added mid-pass is not lost');
  }

  t.section('Notify check: a spot opened');
  {
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10) } });
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.modals.length, 1, 'one dialog');
    const m = w.log.modals[0].opts;
    eq([m.title, m.confirmText, m.cancelText, m.danger], ['Spot opened', 'View class', 'Not now', undefined], 'Spot opened → View class / Not now (never the default "Keep booking")');
    ok(m.body.indexOf('Ride · Alex · Fri 25, 6:30pm') === 0 && /not held/i.test(m.body), 'it names the class and says the spot is not held');
    eq(w.log.toasts, [], 'no 3.5-second toast (the old alert: gone before it was read)');
    eq(w.ctx._eventCache['10'].is_fully_booked, false, 'the class sheet reads availability from the cache → it is updated, or "View class" would open on "Full"');
    eq(w.watch(), ['10'], 'STILL watched until the member answers: closing the app now loses nothing');
    w.log.modals[0].resolve(true);
    await w.settle();
    eq([w.log.opened, w.watch()], [['10'], []], '"View class" → openClassDetail(id), and only now does it leave the watchlist');
    ok(!/submitBooking|bookClass|joinWaitlist|\/bookings|\/waitlists/.test(region('  let _watchLastPassAt', '  // ── Line class history up')),
      'nothing in the check or its dialog can book, join or spend a credit — "View class" only opens the sheet');
  }
  {
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10) } });
    await w.ctx.checkWatchedEvents(true);
    w.log.modals[0].resolve(false);
    await w.settle();
    eq([w.log.opened, w.watch()], [[], []], '"Not now" → answered: not opened, no longer watched');
    eq(w.log.toasts.map((x) => x[1]), ['info'], '…and told so: a stray tap on the backdrop lands here too, and the bell switching off is otherwise invisible');
    ok(/tap its bell/.test(w.log.toasts[0][0]), 'the toast says how to watch again');
  }
  {
    // Storage full: the un-watch cannot be saved — "View class" must still open the class.
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10) } });
    await w.ctx.checkWatchedEvents(true);
    w.store.setItem = () => { throw new Error('QuotaExceededError'); };
    w.log.modals[0].resolve(true);
    await w.settle();
    eq(w.log.opened, ['10'], 'a failing watchlist write never swallows "View class"');
  }
  {
    // A pending alert still gets its turn from a check that may not talk to Psycle.
    let open = true;
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10) }, dialogOpen: () => open });
    await w.ctx.checkWatchedEvents(true);
    open = false;
    await w.ctx.checkWatchedEvents(false);
    eq([w.log.modals.length, w.log.gets.length], [1, 1], 'found earlier, a dialog was in the way → shown on the next check even though that one sends nothing');
  }
  {
    // The first-run welcome (replayable from Settings while signed in) is
    // full-screen and above confirmModal, and _dialogOpen() does not know it:
    // "Spot opened" opened UNDER it, and the Escape that closed the welcome
    // answered it too — the class left the watchlist unseen.
    const els = { onboardOverlay: {} };
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10) }, els });
    await w.ctx.checkWatchedEvents(true);
    eq([w.log.modals.length, w.watch(), w.log.timers.some((x) => x.ms === 700)], [0, ['10'], true], 'the welcome is up: no dialog under it, still watched, and it looks again in 700ms');
    delete els.onboardOverlay;
    w.log.timers.filter((x) => x.ms === 700).pop().fn();
    eq(w.log.modals.length, 1, 'welcome closed → the dialog gets its turn');
  }
  {
    let w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10, { data: { is_fully_booked: undefined } }) } });
    await w.ctx.checkWatchedEvents(true);
    eq([w.log.modals.length, w.watch(), w.ctx._eventCache['10'].is_fully_booked], [0, ['10'], true], 'is_fully_booked missing from the answer → no alert, still watched, cache left saying Full');
    w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10, { slots: [] }) } });
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.modals.length, 0, 'layout studio, "not full" but no bookable slot → no alert');
    w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10, { slots: [], hasLayout: false }) } });
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.modals.length, 1, 'no-layout studio (from the answer\'s own relations) → alert');
    w = world({ watch: ['10'], cache: FULL_CACHE(['10']), studios: { 4: { has_layout: true } }, api: { 10: detail(10, { slots: [], hasLayout: false }) } });
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.modals.length, 0, "_studioMap (what bookClass itself reads) wins over the answer's relations");
  }
  {
    // With app.js loaded, the cache is only ONE of three copies: the loaded
    // timetable's row (render() spreads it back over the cache on every
    // re-render) and the facet view behind the chip counts — and the rendered
    // card's disabled "Full" button is what the sheet's Book presses.
    const appSrc = t.readSource('js/app.js');
    const fresh = appSrc.slice(appSrc.indexOf('// ── pure:book-fresh:start'), appSrc.indexOf('// ── pure:book-fresh:end'));
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10, { data: { is_waitlistable: false } }) } });
    const synced = [];
    w.ctx._windowEvents = [{ id: 10, is_fully_booked: true, is_waitlistable: true }];
    w.ctx._facetClasses = [{ id: '10', full: true }];
    t.vm.runInContext(fresh, w.ctx); // the REAL _noteFreshAvailability, beside the check as in the app
    w.ctx._syncCardButtonsForEvent = (id) => synced.push([String(id), w.ctx._eventCache['10'].is_fully_booked]);
    await w.ctx.checkWatchedEvents(true);
    eq([w.ctx._eventCache['10'].is_fully_booked, w.ctx._windowEvents[0].is_fully_booked, w.ctx._windowEvents[0].is_waitlistable, w.ctx._facetClasses[0].full], [false, false, false, false],
      'a spot opened: the cache, the loaded timetable\'s row AND the chip-count view all stop saying Full (a cache-only write was undone by the next re-render)');
    eq(synced, [['10', false]], '…and the rendered card is re-synced, after the cache was written: its disabled "Full" button is the one "View class → Book" presses');
    eq(Object.assign({}, w.ctx._eventCache['10'], w.ctx._windowEvents[0]).is_fully_booked, false, 'a render-style merge (window row over cache) keeps it open');
    eq(w.log.modals.length, 1, 'the dialog still shows');

    const same = world({ watch: ['10'], cache: FULL_CACHE(['10']) }); // Psycle still says full
    const again = [];
    same.ctx._windowEvents = [{ id: 10, is_fully_booked: true }];
    t.vm.runInContext(fresh, same.ctx);
    same.ctx._syncCardButtonsForEvent = (id) => again.push(id);
    await same.ctx.checkWatchedEvents(true);
    eq(again, [], 'nothing changed → no card is touched');
  }
  {
    const w = world({ watch: ['99'], api: { 99: detail(99) } });
    await w.ctx.checkWatchedEvents(true);
    eq([w.log.modals.length, w.ctx._eventCache['99']._typeName, w.ctx._eventCache['99']._locName, w.ctx._eventCache['99']._instrName], [1, 'Ride', 'Bank', 'Alex'],
      'a watched class the cache never held is built from the answer, so the dialog can name it and "View class" has something to open');
  }

  t.section('Notify dialog: never over another dialog, never lost');
  {
    let open = true;
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10) }, dialogOpen: () => open });
    await w.ctx.checkWatchedEvents(true);
    eq([w.log.modals.length, w.log.timers.map((x) => x.ms)], [0, [700]], 'a booking confirm / the bike picker is up → wait (confirmModal is single-instance: showing ours would cancel theirs)');
    open = false;
    w.log.timers[0].fn();
    eq(w.log.modals.length, 1, '…and show once it has closed');
  }
  {
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10) } });
    await w.ctx.checkWatchedEvents(true);
    // Another confirmModal displaces ours: app.js calls onReplaced, then settles ours as cancelled.
    w.log.modals[0].opts.onReplaced();
    w.log.modals[0].resolve(false);
    await w.settle();
    eq([w.watch(), w.log.opened], [['10'], []], 'displaced ≠ answered: still watched');
    w.log.timers[w.log.timers.length - 1].fn();
    eq(w.log.modals.length, 2, '…and the dialog comes back');
  }
  {
    const w = world({ watch: ['10', '11'], cache: FULL_CACHE(['10', '11']), api: { 10: detail(10), 11: detail(11) } });
    await w.ctx.checkWatchedEvents(true);
    eq(w.log.modals.length, 1, 'two opened in one pass → one dialog at a time');
    w.log.modals[0].resolve(false);
    await w.settle();
    w.log.timers[w.log.timers.length - 1].fn();
    eq([w.log.modals.length, w.watch()], [2, ['11']], '"Not now" → the next one gets its turn');
    w.log.modals[1].resolve(true);
    await w.settle();
    eq([w.log.opened, w.watch()], [['11'], []], 'and it opens its own class');
  }
  {
    const w = world({ watch: ['10', '11'], cache: FULL_CACHE(['10', '11']), api: { 10: detail(10), 11: detail(11) } });
    await w.ctx.checkWatchedEvents(true);
    const timersBefore = w.log.timers.length;
    w.log.modals[0].resolve(true);
    await w.settle();
    eq([w.log.opened, w.watch(), w.log.timers.length - timersBefore], [['10'], ['11'], 0], '"View class" → no second dialog stacked over the sheet; the other class simply stays watched for the next check');
  }
  {
    // Found open, then full again before the member saw it (a dialog was in the way).
    let open = true;
    const api = { 10: detail(10) };
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api, dialogOpen: () => open });
    await w.ctx.checkWatchedEvents(true);
    api[10] = detail(10, { data: { is_fully_booked: true } });
    w.clock.now = NOW + 120000;
    await w.ctx.checkWatchedEvents(true);
    open = false;
    w.log.timers.forEach((x) => x.fn());
    eq([w.log.modals.length, w.watch()], [0, ['10']], 'the spot went again → no stale alert, still watched');
  }
  {
    const w = world({ watch: ['10'], cache: FULL_CACHE(['10']), api: { 10: detail(10) }, dialogOpen: () => true });
    await w.ctx.checkWatchedEvents(true);
    w.store.setItem('psycle_notify_watchlist', '[]'); // the member tapped the bell off meanwhile
    w.ctx._dialogOpen = () => false;
    w.log.timers.forEach((x) => x.fn());
    eq(w.log.modals.length, 0, 'un-watched before the dialog could show → no alert for a class they no longer care about');
  }

  t.section('Notify: the bell says what it really does');
  ok(src.indexOf('checked whenever Psync is open') !== -1, 'the toast says checks only run while the app is open (there is no server or background fetch behind the bell)');
  ok(src.indexOf('You will be notified when a spot opens') === -1 && src.indexOf('enable browser notifications for push') === -1, 'the old promises are gone');
  ok(src.indexOf('not supported in this browser') === -1, "no red \"not supported\" toast on every bell tap in the iOS app (its WebView has no Notification API)");

  // The REAL bell handler + requestNotificationPermission, beside the rest.
  t.section('Notify bell: the watch is saved at the tap, whatever the browser\'s permission prompt does');
  {
    const bellWorld = (permission, o) => {
      const w = world(o);
      const asked = { count: 0, answer: null };
      if (permission !== null) {
        w.ctx.Notification = { permission, requestPermission: () => { asked.count++; return new Promise((resolve) => { asked.answer = resolve; }); } };
      }
      t.vm.runInContext(region('  // Request notification permission', '  function _hasToken('), w.ctx);
      const classes = [];
      const attrs = {};
      const btn = { title: '', classList: { add: (c) => classes.push('+' + c), remove: (c) => classes.push('-' + c) }, setAttribute: (k, v) => { attrs[k] = v; } };
      return Object.assign(w, { asked, btn, classes, attrs, tap: (id) => w.ctx._features_toggleNotify(id, btn) });
    };

    // Chrome / Safari on the web, never asked: the prompt is left UNANSWERED.
    let w = bellWorld('default');
    w.tap(555); // not awaited — nor does the handler wait
    eq([w.watch(), w.classes, w.btn.title, w.log.toasts], [['555'], ['+watching'], 'Stop watching for openings', [['Watching this class — checked whenever Psync is open', 'success']]],
      'saved, the bell flipped and the toast shown straight away (the tap used to hang on the prompt: nothing saved, no toast — a dead tap)');
    eq(w.asked.count, 1, '…and the browser is still asked, once, after all of that');
    eq(w.attrs, { 'aria-label': 'Stop notifying me', 'aria-pressed': 'true' }, 'the bell has a NAME (its glyph is a CSS emoji — that is what was read out) and says it is on');
    w.asked.answer('granted');
    await w.settle();
    eq([w.watch(), w.log.toasts.map((x) => x[0])], [['555'], ['Watching this class — checked whenever Psync is open', 'Notifications enabled']], 'answering later changes nothing about the watch');

    w = bellWorld('default');
    w.ctx.Notification.requestPermission = () => Promise.reject(new Error('prompt dismissed'));
    await w.tap(556);
    await w.settle();
    eq(w.watch(), ['556'], 'a prompt that rejects is swallowed — the watch stands');

    w = bellWorld('denied');
    await w.tap(557);
    eq([w.watch(), w.asked.count, w.log.toasts.map((x) => x[1])], [['557'], 0, ['success']], 'notifications blocked: not asked, and no red "blocked" toast lands over the confirmation (there is one toast)');
    w = bellWorld('granted');
    await w.tap(558);
    eq([w.watch(), w.asked.count], [['558'], 0], 'already granted: nothing to ask');
    w = bellWorld(null); // the iOS app's WebView: no Notification API at all
    await w.tap(559);
    eq([w.watch(), w.log.toasts.length], [['559'], 1], 'no Notification API: watched, one toast, no throw');

    w = bellWorld('default', { watch: ['560', '561'] });
    await w.tap(560);
    eq([w.watch(), w.classes, w.asked.count, w.log.toasts], [['561'], ['-watching'], 0, [['Stopped watching this class', 'info']]], 'a second tap stops watching — and never prompts');
    eq([w.attrs, w.btn.title], [{ 'aria-label': 'Notify me when a spot opens', 'aria-pressed': 'false' }, 'Notify me when a spot opens'], '…and the name and pressed state flip back with it');
    w = bellWorld('granted', { token: null });
    await w.tap(562);
    eq(w.log.toasts[0][0], 'Watching this class — sign in so Psync can check it', 'signed out: the toast says why nothing will be checked yet');
  }
};
