'use strict';
// Saved class details (js/app.js): My Bookings' first paint after a relaunch no
// longer waits on one GET /events/{id} per held class. The pure helpers that
// write / read psycle_booked_event_details, and the REAL fetchMyBookings —
// sliced out of app.js with everything around it stubbed — seeding, blocking
// only on what nothing knows, and re-reading the seeded classes afterwards.
module.exports = async function (t) {
  const src = t.readSource('js/app.js');
  const KEY = 'psycle_booked_event_details';
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 8, 18, 9, 30);

  // ── Pure helpers ─────────────────────────────────────────────────────────
  t.section('Saved class details: pure helpers (js/app.js pure:event-details block)');
  const pure = t.loadPure('js/app.js', 'event-details');

  const cached = (o) => Object.assign({
    id: 101, start_at: '2026-09-19 07:30:00', duration: 45, studio_id: 4, instructor_id: 31, event_type_id: 7,
    is_live_stream: false, is_fully_booked: true, is_waitlistable: true, capacity_remaining: 0,
    description: 'x'.repeat(2000), layoutDetail: { slots: [1, 2, 3] },
    _typeName: 'Ride 45', _instrName: 'Alex', _locName: 'Oxford Circus', _locFullName: 'Psycle Oxford Circus',
    _locAddress: '76 Mortimer St', _studioName: 'Studio 1',
  }, o);
  const slim = pure._slimEventDetails(cached({}));
  t.eq(Object.keys(slim).sort(),
    ['_instrName', '_locAddress', '_locFullName', '_locName', '_studioName', '_typeName', 'duration', 'event_type_id', 'id', 'instructor_id', 'is_live_stream', 'start_at', 'studio_id'],
    'slim: identity + display fields only — no availability (full / waitlistable / spots), no description, no layout');
  t.eq([slim.id, slim.start_at, slim.duration, slim.studio_id, slim.instructor_id, slim.event_type_id, slim._typeName, slim._locAddress],
    [101, '2026-09-19 07:30:00', 45, 4, 31, 7, 'Ride 45', '76 Mortimer St'], 'slim: a well-formed class survives as it was');
  const noId = cached({}); delete noId.id;
  t.eq(pure._slimEventDetails(noId, '101').id, 101, 'slim: a cache entry with no id of its own takes the _myBookings key');
  t.eq(pure._slimEventDetails(noId), null, 'slim: no id at all → null');
  t.eq(pure._slimEventDetails(cached({ id: '101);alert(1' })), null, 'slim: an id that is not a number is rejected');
  const hostile = pure._slimEventDetails(cached({ studio_id: '4);alert(1)//', instructor_id: '<img>', event_type_id: -3, duration: 'abc' }));
  t.eq([hostile.studio_id, hostile.instructor_id, hostile.event_type_id, hostile.duration], [null, null, null, 0],
    'slim: ids and duration are coerced to numbers — the cards interpolate them into markup and inline handlers');
  t.eq(pure._slimEventDetails(cached({ start_at: 'tomorrow' })), null, 'slim: a start that is not a date-time is rejected');
  t.eq(pure._slimEventDetails(cached({ start_at: '2026-09-19 07:30:00"><script>' })), null, 'slim: …and so is a date-time with anything after it');
  t.eq(pure._slimEventDetails(cached({ start_at: null })), null, 'slim: no start → null (never an undated card)');
  t.ok(['2026-09-19T07:30:00', '2026-09-19 07:30', '2026-09-19T07:30:00.000000Z', '2026-09-19T07:30:00+01:00'].every((s) => pure._slimEventDetails(cached({ start_at: s })).start_at === s),
    'slim: the T form, no seconds, fractional seconds + Z and an explicit offset are all kept as they are');
  t.eq(pure._slimEventDetails(cached({ _typeName: 'x'.repeat(500) }))._typeName.length, 120, 'slim: text is length-capped');
  t.eq([pure._slimEventDetails(cached({ _typeName: '' }))._typeName, pure._slimEventDetails(cached({ _instrName: { evil: 1 } }))._instrName], ['Class', ''],
    'slim: a missing class name reads "Class"; a non-string name is dropped');
  t.eq([pure._slimEventDetails(cached({ is_live_stream: 1 })).is_live_stream, pure._slimEventDetails(cached({})).is_live_stream], [true, false], 'slim: is_live_stream is a boolean');
  t.eq([pure._slimEventDetails(null), pure._slimEventDetails('x')], [null, null], 'slim: null / a string → null');

  const item = (o) => Object.assign({}, slim, { seenAt: NOW - 60000 }, o);
  const entry = pure._eventCacheEntryFromSnapshot(item({}), NOW);
  t.eq([entry._fromSnapshot, entry._snapshotSeenAt, entry.id, entry._typeName], [true, NOW - 60000, 101, 'Ride 45'], 'read: a stored item becomes an _eventCache record flagged _fromSnapshot');
  t.ok(!('is_fully_booked' in entry) && !('is_waitlistable' in entry), 'read: the record says nothing about availability — bookClass and the sheet read that fresh');
  t.eq(pure._eventCacheEntryFromSnapshot(item({ seenAt: NOW - 15 * DAY }), NOW), null, 'read: details not confirmed by a real /events/{id} for 14 days are dropped');
  t.eq(pure._eventCacheEntryFromSnapshot(item({ seenAt: 'x' }), NOW), null, 'read: a junk timestamp is dropped');
  t.eq(pure._eventCacheEntryFromSnapshot(slim, NOW), null, 'read: no timestamp at all is dropped');
  t.ok(pure._eventCacheEntryFromSnapshot(item({ seenAt: NOW + DAY }), NOW) !== null, 'read: a clock that moved backwards does not throw the details away');

  const stored = (o) => JSON.stringify(Object.assign({ v: 1, items: [item({})] }, o));
  t.eq(pure._coerceEventDetailsSnapshot('{not json', NOW), null, 'storage: unparseable is nothing');
  t.eq(pure._coerceEventDetailsSnapshot(null, NOW), null, 'storage: nothing stored is nothing');
  t.eq(pure._coerceEventDetailsSnapshot(stored({ v: 2 }), NOW), null, 'storage: another version is nothing');
  t.eq(pure._coerceEventDetailsSnapshot(stored({ items: { 101: item({}) } }), NOW), null, 'storage: items must be a list');
  const byId = pure._coerceEventDetailsSnapshot(stored({ items: [item({}), { junk: true }, item({ id: 102 }), item({ id: 103, seenAt: NOW - 20 * DAY })] }), NOW);
  t.eq(Object.keys(byId), ['101', '102'], 'storage: keyed by event id; malformed and expired items dropped');
  const many = []; for (let i = 0; i < 90; i++) many.push(item({ id: 200 + i }));
  t.eq(Object.keys(pure._coerceEventDetailsSnapshot(stored({ items: many }), NOW)).length, 60, 'storage: at most 60 items are read back');

  const bookings = { 101: { bookingId: 'A', slots: [7] }, 102: { bookingId: null, slots: [], waitlisted: true }, 104: { bookingId: 'D', slots: [2] } };
  const cache = {
    101: cached({}),
    102: Object.assign({}, pure._eventCacheEntryFromSnapshot(item({ id: 102, seenAt: NOW - 3 * DAY }), NOW)), // still standing in from the last snapshot
    103: cached({ id: 103 }), // in the cache (Discover), not held
  };
  const built = pure._buildEventDetailsSnapshot(bookings, cache, NOW);
  t.eq([built.v, built.items.map((i) => i.id)], [1, [101, 102]], 'build: exactly the held classes that have details — it prunes itself; a class nothing knows (104) is left out');
  t.eq(built.items.map((i) => i.seenAt), [NOW, NOW - 3 * DAY], 'build: confirmed details are stamped now; details still standing in keep the time they were really confirmed');
  t.ok(JSON.stringify(built).indexOf('_fromSnapshot') === -1 && JSON.stringify(built).indexOf('bookingId') === -1 && JSON.stringify(built).indexOf('slots') === -1,
    'build: no provenance flags, no booking ids, no seats — class details only');
  t.eq(pure._buildEventDetailsSnapshot({}, cache, NOW).items, [], 'build: a confirmed-empty list stores no classes');
  t.eq(pure._buildEventDetailsSnapshot(null, null, NOW).items, [], 'build: nothing in, nothing out');
  const round = pure._coerceEventDetailsSnapshot(JSON.stringify(built), NOW + DAY);
  t.eq([Object.keys(round), round['101'].start_at, round['101']._fromSnapshot], [['101', '102'], '2026-09-19 07:30:00', true], 'build → storage → read round-trips');

  const a = cached({});
  t.eq(pure._eventDetailsDiffer(a, cached({ start_at: '2026-09-19T07:30:00' })), false, 'differ: the same time in the space and the T form is not a change');
  t.eq(pure._eventDetailsDiffer(a, cached({ is_fully_booked: false, capacity_remaining: 9, description: 'new' })), false, 'differ: availability / description are not what a card, calendar event or widget shows');
  t.eq(pure._eventDetailsDiffer(slim, a), false, 'differ: the slim record and the full one it came from agree');
  t.eq(pure._eventDetailsDiffer(a, cached({ start_at: '2026-09-19 08:00:00' })), true, 'differ: a moved start');
  t.eq(pure._eventDetailsDiffer(a, cached({ duration: 60 })), true, 'differ: a changed duration (the calendar event\'s end)');
  t.eq(pure._eventDetailsDiffer(a, cached({ instructor_id: 32 })), true, 'differ: a cover instructor (id)');
  t.eq(pure._eventDetailsDiffer(a, cached({ _instrName: 'Sam' })), true, 'differ: a cover instructor (name)');
  t.eq(pure._eventDetailsDiffer(a, cached({ event_type_id: 8, _typeName: 'Ride 60' })), true, 'differ: a changed class type');
  t.eq(pure._eventDetailsDiffer(a, cached({ studio_id: 5, _studioName: 'Studio 2' })), true, 'differ: a moved studio');
  t.eq(pure._eventDetailsDiffer(a, cached({ is_live_stream: true })), true, 'differ: became an online class');
  t.eq([pure._eventDetailsDiffer(a, null), pure._eventDetailsDiffer(null, null)], [true, false], 'differ: one side missing is a change; both missing is not');

  // ── The real fetchMyBookings ─────────────────────────────────────────────
  t.section('Saved class details: fetchMyBookings paints from them, blocks only on unknown classes, re-reads after the render');
  const from = src.indexOf('let _bookingsSeq = 0;');
  const to = src.indexOf('// Refresh bookings when the page becomes visible after being hidden');
  t.ok(from !== -1 && to > from, 'the bookings fetch block can be sliced (anchors moved? update tests/suites/event-details.js)');
  if (from === -1 || to <= from) return;

  const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  // A macrotask turn: every microtask the pass has queued runs first.
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const detail = (id, o) => ({
    data: Object.assign({ id, start_at: '2026-09-19 07:30:00', duration: 45, studio_id: 4, instructor_id: 31, event_type_id: 7, is_fully_booked: false }, o),
    relations: {
      instructors: [{ id: 31, full_name: 'Alex' }, { id: 32, full_name: 'Sam' }],
      studios: [{ id: 4, name: 'Studio 1', location_id: 1, has_layout: true }],
      locations: [{ id: 1, name: 'Psycle Oxford Circus', address: '76 Mortimer St' }],
      event_types: [{ id: 7, name: 'Ride 45' }],
    },
  });
  const savedFor = (ids, seenAt) => JSON.stringify({ v: 1, items: ids.map((id) => Object.assign({}, slim, { id, seenAt: seenAt || Date.now() - 60000 })) });

  function makeWorld(o) {
    o = o || {};
    const handlers = {};
    const w = { token: 'tok-A', calls: [], renders: [], events: [], skeletons: [], store: t.makeFakeLocalStorage(), bookings: o.bookings || [{ id: 'A', event_id: 101, slot: 7 }] };
    if (o.saved) w.store.setItem(KEY, o.saved);
    const ctx = t.vm.createContext({
      console: { log() {}, warn() {}, error: console.error },
      setTimeout: () => 0, clearTimeout: () => {},
      localStorage: w.store,
      getBearerToken: () => w.token,
      apiFetch: (path, opts) => new Promise((resolve, reject) => { w.calls.push({ path, opts, resolve, reject }); }),
      fetchMyWaitlists: () => Promise.resolve([]),
      showBookingSkeleton: (n) => { w.skeletons.push(n); },
      // What the render would draw: which held classes have details, and from where.
      renderMyBookings: () => { w.renders.push(Object.keys(ctx._myBookings).map((id) => (ctx._eventCache[id] ? id + ':' + ctx._eventCache[id].start_at + (ctx._eventCache[id]._fromSnapshot ? ':saved' : '') : id + ':?'))); },
      toast: () => {},
      PsycleEvents: {
        on: (e, fn) => { (handlers[e] = handlers[e] || []).push(fn); },
        emit: (e, arg) => { w.events.push(e); (handlers[e] || []).forEach((fn) => fn(arg)); },
      },
      document: { querySelectorAll: () => [], getElementById: () => null },
      _myBookings: {}, _eventCache: {}, _studioMap: {}, _lastWaitlistEntries: null,
      _mergeWaitlistsIntoBookings: () => {},
      _readWaitlistPlaces: () => ({ places: {}, allocated: {} }),
      _writeWaitlistPlaces: () => {},
      _heldPlacesOf: () => ({}),
      _diffWaitlistPlaces: () => ({ allocated: {}, newlyAllocated: [] }),
      _probeWaitlistOffers: () => Promise.resolve(null),
      _syncCardButtonsForEvent: () => {}, applyBookedState: () => {},
    });
    t.vm.runInContext(src.slice(from, to), ctx, { filename: 'js/app.js[bookings fetch]' });
    w.ctx = ctx;
    w.emit = (e, arg) => ctx.PsycleEvents.emit(e, arg);
    w.eventCalls = () => w.calls.filter((c) => c.path.indexOf('/events/') === 0);
    // Start a pass and answer /bookings; the /events/{id} requests stay open.
    // Resolves (once the pass has run as far as it can) to { done }: the
    // pass's own promise, wrapped so that awaiting load() never waits for it.
    w.load = async () => {
      const done = ctx.fetchMyBookings();
      w.calls.filter((c) => c.path.indexOf('/bookings') === 0).pop().resolve(jsonRes(200, { data: w.bookings }));
      await flush();
      return { done };
    };
    w.savedIds = () => { const s = JSON.parse(w.store.getItem(KEY) || 'null'); return s ? s.items.map((i) => i.id) : null; };
    return w;
  }

  // Relaunch, one held class, details saved last time: nothing waits on /events/{id}.
  let w = makeWorld({ saved: savedFor([101]) });
  let pass = await w.load();
  t.eq(w.renders, [['101:2026-09-19 07:30:00:saved']], 'saved details: My Bookings is painted as soon as /bookings answers — GET /events/101 has not answered yet');
  t.eq([w.events, w.skeletons], [['bookings:loaded'], []], 'saved details: bookings:loaded goes out with it (badge, widget, calendar sync no longer wait either); no skeleton');
  t.eq(await pass.done, true, 'saved details: the pass resolves true without waiting for the re-read');
  t.eq(w.eventCalls().map((c) => [c.path, c.opts]), [['/events/101', { retries: 1 }]], 'saved details: the class is re-read straight after the render — with ONE retry, not the default three');
  w.eventCalls()[0].resolve(jsonRes(200, detail(101)));
  await flush();
  t.eq([w.renders.length, w.events], [1, ['bookings:loaded']], 're-read, nothing moved: no second render (no blink), no second bookings:loaded (no calendar reconcile / widget write)');
  t.ok(!w.ctx._eventCache['101']._fromSnapshot && w.ctx._eventCache['101']._locAddress === '76 Mortimer St' && w.ctx._studioMap[4], 're-read: the cache now holds the real /events/{id} record (flag gone) and _studioMap is filled');
  t.ok(JSON.parse(w.store.getItem(KEY)).items[0].seenAt > Date.now() - 5000, 're-read, nothing moved: the saved details are re-stamped as confirmed now');

  // …and when Psycle moved the class since: repaint + re-announce, once.
  w = makeWorld({ saved: savedFor([101]) });
  await w.load();
  w.eventCalls()[0].resolve(jsonRes(200, detail(101, { start_at: '2026-09-19 08:00:00', instructor_id: 32 })));
  await flush();
  t.eq(w.renders, [['101:2026-09-19 07:30:00:saved'], ['101:2026-09-19 08:00:00']], 're-read, the class moved: My Bookings is repainted with the real time');
  t.eq(w.events, ['bookings:loaded', 'bookings:loaded'], 're-read, the class moved: bookings:loaded again, so the calendar event, widget and reminder follow');
  t.eq(JSON.parse(w.store.getItem(KEY)).items.map((i) => [i.start_at, i.instructor_id, i._instrName]), [['2026-09-19 08:00:00', 32, 'Sam']], 're-read, the class moved: the saved details are replaced');

  // A newer list took over while the re-read was out: it owns the screen.
  w = makeWorld({ saved: savedFor([101]) });
  await w.load();
  w.ctx._myBookings = {};
  w.eventCalls()[0].resolve(jsonRes(200, detail(101, { start_at: '2026-09-19 08:00:00' })));
  await flush();
  t.eq([w.renders.length, w.events], [1, ['bookings:loaded']], 're-read landing after _myBookings was replaced (sign-out, newer pass): paints and announces nothing');

  // Psycle doesn't answer the re-read: keep what is shown, ask again next pass.
  w = makeWorld({ saved: savedFor([101]) });
  await w.load();
  w.eventCalls()[0].resolve(jsonRes(503, null));
  await flush();
  t.eq([w.renders.length, w.events, w.ctx._eventCache['101']._fromSnapshot], [1, ['bookings:loaded'], true], 're-read fails: nothing repainted, the class keeps its saved details (still flagged)');
  await w.load();
  t.eq(w.eventCalls().length, 2, 're-read fails: the next fetchMyBookings asks for it again');
  w.eventCalls()[1].reject(new Error('Request timed out'));
  await flush();
  t.eq(w.ctx._eventCache['101']._fromSnapshot, true, 're-read throws: same');

  // Only what nothing knows about holds the first paint back.
  w = makeWorld({ saved: savedFor([101]), bookings: [{ id: 'A', event_id: 101, slot: 7 }, { id: 'B', event_id: 102, slot: 3 }] });
  pass = await w.load();
  t.eq([w.renders, w.events, w.skeletons], [[], [], [1]], 'one class saved, one never seen: the paint waits — behind a skeleton — for the unknown one…');
  t.eq(w.eventCalls().map((c) => c.path), ['/events/102'], '…and only that one is asked for up front');
  w.eventCalls()[0].resolve(jsonRes(200, detail(102, { start_at: '2026-09-20 10:00:00' })));
  await flush();
  t.eq(w.renders, [['101:2026-09-19 07:30:00:saved', '102:2026-09-20 10:00:00']], 'then both are painted: one from saved details, one fresh');
  t.eq(w.eventCalls().map((c) => c.path), ['/events/102', '/events/101'], 'and the saved one is re-read after the render');
  t.eq(await pass.done, true, 'the pass resolves true');
  t.eq(w.savedIds(), [101, 102], 'bookings:loaded saves the details of exactly the held classes');

  // The snapshot is never a source of bookings.
  w = makeWorld({ saved: savedFor([101, 102]), bookings: [] });
  await w.load();
  t.eq([Object.keys(w.ctx._myBookings), Object.keys(w.ctx._eventCache), w.calls.length], [[], [], 1],
    'Psycle says nothing is booked: saved details put nothing into _myBookings OR _eventCache, and no /events request goes out');
  t.eq(w.savedIds(), [], 'a confirmed-empty list empties the saved details (they prune themselves)');
  w = makeWorld({ saved: savedFor([101, 102]), bookings: [{ id: 'B', event_id: 102, slot: 3 }] });
  await w.load();
  t.eq(Object.keys(w.ctx._eventCache), ['102'], 'only ids THIS /bookings answer names are seeded — a class cancelled elsewhere stays out of the cache');

  // Details already in memory (Discover's window cache, an earlier pass) win.
  w = makeWorld({ saved: savedFor([101]) });
  w.ctx._eventCache['101'] = { id: 101, start_at: '2026-09-19 09:00:00', _typeName: 'Ride 45' };
  await w.load();
  t.eq([w.renders, w.eventCalls().length], [[['101:2026-09-19 09:00:00']], 0], 'a class _eventCache already knows is left alone: not seeded, not re-read');

  // Too old, unreadable or absent → exactly the old behaviour.
  for (const [label, saved] of [['older than 14 days', savedFor([101], Date.now() - 15 * DAY)], ['unparseable', '{nope'], ['absent', null]]) {
    w = makeWorld({ saved });
    pass = await w.load();
    t.eq([w.renders.length, w.skeletons, w.eventCalls().map((c) => c.path)], [0, [1], ['/events/101']], 'saved details ' + label + ': the first paint waits for GET /events/101 as before');
    w.eventCalls()[0].resolve(jsonRes(200, detail(101)));
    await pass.done;
    t.eq([w.renders, w.eventCalls().length], [[['101:2026-09-19 07:30:00']], 1], 'saved details ' + label + ': painted from the real record; nothing to re-read');
  }
  const bare = makeWorld({});
  bare.ctx.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
  pass = await bare.load();
  bare.eventCalls()[0].resolve(jsonRes(200, detail(101)));
  t.eq(await pass.done, true, 'a localStorage that throws on every call costs the shortcut, never the list');

  // Writing: only a confirmed list, only while signed in.
  w = makeWorld({});
  w.ctx._myBookings = { 101: { bookingId: 'A', slots: [7] } };
  w.ctx._eventCache = { 101: cached({}) };
  w.emit('bookings:loaded');
  t.eq(w.savedIds(), null, 'save: never before this session\'s list has loaded (a half-known map would throw the good details away)');
  await w.load();
  t.eq(w.savedIds(), [101], 'save: a loaded list, signed in → saved on bookings:loaded');
  w.token = '';
  w.store.removeItem(KEY);
  w.emit('bookings:loaded');
  t.eq(w.savedIds(), null, 'save: never without a token');

  // Deleting: sign-out and session expiry, not a token that is merely not in memory yet.
  w = makeWorld({ saved: savedFor([101]) });
  w.emit('auth:changed', { signedIn: true });
  t.ok(w.store.getItem(KEY) !== null, 'auth:changed while signed in keeps the saved details');
  w.token = '';
  w.store.setItem('psycle_bearer_token_enc', 'aes:…');
  w.emit('auth:changed', { signedIn: false });
  t.ok(w.store.getItem(KEY) !== null, 'no token in memory but one still stored (crypto set-up timed out): kept for the next launch');
  w.store.removeItem('psycle_bearer_token_enc');
  w.emit('auth:changed', { signedIn: false });
  t.eq(w.store.getItem(KEY), null, 'sign-out / session expiry (stored token gone): the saved details are deleted');

  // ── Source-level contracts ───────────────────────────────────────────────
  t.section('Saved class details: where the key may and may not travel');
  const fetchSrc = src.slice(src.indexOf('async function fetchMyBookings()'), src.indexOf('let _waitlistsUnavailable = false;'));
  t.ok(fetchSrc.indexOf('_seedEventCacheFromSnapshot(unknown)') !== -1 && fetchSrc.indexOf('_seedEventCacheFromSnapshot(unknown)') < fetchSrc.indexOf('_myBookings = next;'),
    'fetchMyBookings seeds before the swap, and only the ids of `next` that _eventCache does not know');
  t.ok(fetchSrc.indexOf('_refreshSeededEventDetails(next, seededIds)') > fetchSrc.indexOf("PsycleEvents.emit('bookings:loaded', _myBookings);"),
    'fetchMyBookings re-reads the seeded classes only after bookings:loaded + the render');
  t.ok(!/Promise\.race\([^)]*_hydrateEventDetails/.test(fetchSrc), 'no deadline on the blocking hydrate: announcing a list with a class missing makes the widget drop it and cancel its reminder');
  t.ok(t.readSource('js/settings.js').indexOf(KEY) === -1, 'the key is not in settings.js EXPORT_KEYS (a device-local cache, not user data)');
  t.ok(t.readSource('ios-app/www/native-bridge.js').indexOf(KEY) === -1, 'the key is not in native-bridge.js SYNC_KEYS (never mirrored to Preferences)');
};
