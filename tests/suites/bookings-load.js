'use strict';
// My Bookings' load state (js/app.js): an empty _myBookings can't tell "nothing
// booked" from "couldn't ask". fetchMyBookings — the real one, sliced out of
// app.js with everything around it stubbed — has to say which, so the tab can
// offer Retry instead of a "Nothing booked — yet" nobody confirmed.
module.exports = async function (t) {
  t.section('Bookings: load state (fetchMyBookings sliced from js/app.js)');
  const src = t.readSource('js/app.js');
  const from = src.indexOf('let _bookingsSeq = 0;');
  const to = src.indexOf('// Refresh bookings when the page becomes visible after being hidden');
  t.ok(from !== -1 && to > from, 'the bookings fetch block can be sliced (anchors moved? update tests/suites/bookings-load.js)');
  if (from === -1 || to <= from) return;

  const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  function makeWorld() {
    const w = { token: 'tok-A', calls: [], renders: [], toasts: [], events: [] };
    const ctx = t.vm.createContext({
      console: { log() {}, warn() {}, error: console.error },
      setTimeout: () => 0, clearTimeout: () => {},
      getBearerToken: () => w.token,
      apiFetch: (path) => new Promise((resolve, reject) => { w.calls.push({ path, resolve, reject }); }),
      fetchMyWaitlists: () => Promise.resolve([]),
      renderMyBookings: () => { w.renders.push(t.vm.runInContext('_bookingsLoadState', ctx)); },
      toast: (msg) => { w.toasts.push(msg); },
      PsycleEvents: { emit: (e) => { w.events.push(e); } },
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
    w.state = () => t.vm.runInContext('_bookingsLoadState', ctx);
    return w;
  }

  // Signed in, /bookings answers 503 after its retries: NOT "Nothing booked".
  let w = makeWorld();
  t.eq(w.state(), 'pending', 'before any answer the list counts as not loaded');
  let p = w.ctx.fetchMyBookings();
  w.calls[0].resolve(jsonRes(503, null));
  t.eq(await p, false, 'a failed /bookings resolves false');
  t.eq(w.state(), 'failed', 'never loaded + a failed attempt = failed');
  t.eq(w.renders, ['failed'], 'My Bookings is repainted once, in the failed state (the Retry hero)');
  t.eq(w.events, [], 'a failed load never emits bookings:loaded (the calendar sync reads that as server-confirmed)');

  // Retry (the hero's button) fails again, then gets through.
  const btn = { disabled: false, textContent: 'Retry' };
  p = w.ctx.retryBookingsLoad(btn);
  t.eq([btn.disabled, btn.textContent], [true, 'Retrying…'], 'Retry: the button shows it is working');
  w.calls[1].reject(new Error('Request timed out'));
  await p;
  t.eq(w.state(), 'failed', 'Retry: a thrown request (timeout / offline) is a failed load too');
  t.eq(w.toasts.length, 1, 'Retry: a second failure says so');
  t.eq([btn.disabled, btn.textContent], [false, 'Try again'], 'Retry: the button is usable again');
  p = w.ctx.retryBookingsLoad(btn);
  w.calls[2].resolve(jsonRes(200, { data: [] }));
  await p;
  t.eq(w.state(), 'loaded', 'Retry: an answer — even an empty one — is a loaded list');
  t.eq(w.renders[w.renders.length - 1], 'loaded', 'Retry: the confirmed-empty hero is painted from the loaded state');
  t.eq(w.toasts.length, 1, 'Retry: success does not toast');
  t.eq(w.events, ['bookings:loaded'], 'a loaded list announces bookings:loaded');

  // Once loaded, a failed REFRESH keeps the last good list — empty or not.
  const rendersBefore = w.renders.length;
  p = w.ctx.fetchMyBookings();
  w.calls[3].resolve(jsonRes(503, null));
  t.eq(await p, false, 'a failed refresh resolves false');
  t.eq(w.state(), 'loaded', 'a failed refresh after a good load keeps the loaded state');
  t.eq(w.renders.length, rendersBefore, 'a failed refresh repaints nothing (no "Couldn\'t load" over a confirmed list)');

  // A superseded call must not paint anything — the newer one owns the screen.
  w = makeWorld();
  const older = w.ctx.fetchMyBookings();
  const newer = w.ctx.fetchMyBookings();
  w.calls[0].resolve(jsonRes(503, null));
  t.eq(await older, false, 'superseded: the older call resolves false');
  t.eq([w.state(), w.renders.length], ['pending', 0], 'superseded: a failed OLDER call marks and paints nothing');
  w.calls[0 + 1].reject(new Error('Failed to fetch'));
  t.eq(await newer, false, 'superseded: the newer call fails too');
  t.eq([w.state(), w.renders.length], ['failed', 1], 'superseded: the NEWEST failure is the one that shows');
  w = makeWorld();
  const slow = w.ctx.fetchMyBookings();
  const fast = w.ctx.fetchMyBookings();
  w.calls[1].resolve(jsonRes(200, []));
  await fast;
  w.calls[0].reject(new Error('Request timed out'));
  await slow;
  t.eq(w.state(), 'loaded', 'superseded: an older call that throws after the newer one loaded changes nothing');

  // Retry that gets superseded (a foreground refetch lands on top of it) has
  // not failed — no "Still can't load" toast over a load that may succeed.
  w = makeWorld();
  p = w.ctx.fetchMyBookings(); w.calls[0].resolve(jsonRes(503, null)); await p;
  const retry = w.ctx.retryBookingsLoad(null);
  const foreground = w.ctx.fetchMyBookings();
  w.calls[1].resolve(jsonRes(503, null));
  await retry;
  t.eq(w.toasts.length, 0, 'Retry: a superseded attempt does not toast');
  w.calls[2].resolve(jsonRes(200, []));
  await foreground;
  t.eq(w.state(), 'loaded', 'Retry: …and the newer call loads the list');

  // A 401 has already ended the session (apiFetch → showSessionExpired clears
  // the token before the response is returned): that is not a load failure.
  w = makeWorld();
  p = w.ctx.fetchMyBookings();
  w.token = '';
  w.calls[0].resolve(jsonRes(401, null));
  await p;
  t.eq([w.state(), w.renders.length], ['pending', 0], 'a 401 is left to showSessionExpired — no "Couldn\'t load" state, no repaint');

  // Signing out starts the next member from scratch.
  w = makeWorld();
  p = w.ctx.fetchMyBookings(); w.calls[0].resolve(jsonRes(200, [])); await p;
  w.token = '';
  t.eq(await w.ctx.fetchMyBookings(), true, 'no token: the signed-out branch still resolves true');
  t.eq(w.state(), 'pending', 'no token: the load state is reset for whoever signs in next');

  // ── A list that loaded but can't be drawn ────────────────────────────────
  // Real fetchMyBookings + _hydrateEventDetails + renderMyBookings: /bookings
  // answers with two bookings, every GET /events/{id} fails (cold launch, so
  // _eventCache is empty). Two held classes are not "Nothing booked — yet".
  t.section('Bookings: a loaded list whose classes could not be loaded is not "Nothing booked"');
  {
    const lines = src.split('\n');
    const start = lines.findIndex(l => l.startsWith('function renderMyBookings('));
    const end = lines.findIndex((l, i) => i > start && l === '}');
    t.ok(start !== -1 && end > start, 'renderMyBookings can be sliced');
    const els = {};
    const el = id => els[id] || (els[id] = { style: {}, textContent: '', innerHTML: '' });
    const w = { calls: [], toasts: [], skeletons: [], events503: true };
    const ctx = t.vm.createContext({
      console: { log() {}, warn() {}, error: console.error },
      setTimeout: () => 0, clearTimeout: () => {},
      getBearerToken: () => 'tok-A',
      apiFetch: async (path) => {
        w.calls.push(path);
        if (path.indexOf('/bookings') === 0) return jsonRes(200, { data: [{ id: 'A', event_id: 101, slot: 7 }, { id: 'B', event_id: 102, slot: 3 }] });
        if (w.events503) return jsonRes(503, null);
        throw new Error('Request timed out');
      },
      fetchMyWaitlists: () => Promise.resolve([]),
      showBookingSkeleton: (n) => { w.skeletons.push(n); },
      toast: (msg) => { w.toasts.push(msg); },
      PsycleEvents: { emit: () => {} },
      document: { querySelectorAll: () => [], getElementById: el },
      localStorage: { getItem: () => null },
      authGateHTML: () => '',
      currentUser: { id: 7 },
      _myBookings: {}, _eventCache: {}, _studioMap: {}, _lastWaitlistEntries: null,
      _mergeWaitlistsIntoBookings: () => {},
      _readWaitlistPlaces: () => ({ places: {}, allocated: {} }),
      _writeWaitlistPlaces: () => {},
      _heldPlacesOf: () => ({}),
      _diffWaitlistPlaces: () => ({ allocated: {}, newlyAllocated: [] }),
      _probeWaitlistOffers: () => Promise.resolve(null),
      _syncCardButtonsForEvent: () => {}, applyBookedState: () => {},
    });
    t.vm.runInContext(src.slice(from, to) + '\n' + lines.slice(start, end + 1).join('\n'), ctx, { filename: 'js/app.js[bookings fetch + render]' });
    const hero = () => els.bookingsEmpty.innerHTML;

    // /profile has landed (currentUser is set), the first /bookings has not:
    // tabs.js's first paint — or any repaint in between — lands here. An empty
    // map is not an answer yet.
    ctx.renderMyBookings();
    t.eq(t.vm.runInContext('_bookingsLoadState', ctx), 'pending', 'signed in, /bookings not answered yet: the state is pending');
    t.eq([w.skeletons, els.bookingsEmpty.style.display], [[2], 'none'], 'pending: My Bookings shows its loading skeleton and no empty-state hero');
    t.ok(!/Nothing booked/.test(hero()), 'pending: never "Nothing booked — yet" before Psycle has answered');
    w.skeletons.length = 0;

    t.eq(await ctx.fetchMyBookings(), true, '/bookings 200 + every /events/{id} 503: the list itself loaded');
    t.eq([Object.keys(ctx._myBookings), t.vm.runInContext('_bookingsLoadState', ctx)], [['101', '102'], 'loaded'], 'two classes are held, state is loaded');
    t.ok(/Couldn't load<br>your bookings/.test(hero()) && /retryBookingsLoad\(this\)/.test(hero()), 'My Bookings offers Retry');
    t.ok(!/Nothing booked/.test(hero()), '…never "Nothing booked — yet" over two held classes');

    const btn = { disabled: false, textContent: 'Retry' };
    w.events503 = false; // now the detail requests time out instead
    await ctx.retryBookingsLoad(btn);
    t.eq(w.toasts, ["Still can't load your bookings. Check your connection."], 'Retry that still cannot draw a single class says so (the state is "loaded", so it used to be silent)');
    t.ok(/retryBookingsLoad\(this\)/.test(hero()), '…and the Retry hero stays up');

    // Signed out / not verified: the gate or Sign-in hero owns the tab.
    ctx.currentUser = null;
    ctx.renderMyBookings();
    t.ok(/Sign in/.test(hero()) && !/retryBookingsLoad/.test(hero()), 'no profile → the Sign-in hero, not Retry');
    // A confirmed-empty list is still "Nothing booked".
    ctx.currentUser = { id: 7 };
    ctx._myBookings = {};
    w.skeletons.length = 0;
    ctx.renderMyBookings();
    t.ok(/Nothing booked<br>/.test(hero()) && els.bookingsEmpty.style.display === '' && w.skeletons.length === 0,
      'a loaded, genuinely empty list still reads "Nothing booked — yet" (hero shown again, no skeleton)');
    // Signed out while pending: the Sign-in hero, never a skeleton nothing will replace.
    t.vm.runInContext("_bookingsLoadState = 'pending'", ctx);
    ctx.currentUser = null;
    ctx.renderMyBookings();
    t.ok(/Sign in/.test(hero()) && els.bookingsEmpty.style.display === '' && w.skeletons.length === 0, 'pending with no profile → the Sign-in hero, not the skeleton');
    // Pending over a map that cannot be drawn is still the Retry hero (a skeleton would never resolve).
    ctx.currentUser = { id: 7 };
    ctx._myBookings = { 101: { bookingId: 'A', slots: [7] } };
    ctx.renderMyBookings();
    t.ok(/retryBookingsLoad\(this\)/.test(hero()) && w.skeletons.length === 0, 'pending + held classes that cannot be drawn → Retry, not the skeleton');
    t.vm.runInContext("_bookingsLoadState = 'loaded'", ctx);
    // One class that CAN be drawn: Retry succeeding is not announced as a failure.
    ctx._myBookings = { 101: { bookingId: 'A', slots: [7] } };
    ctx._eventCache = { 101: { start_at: '2099-01-01 10:00:00' } };
    ctx.renderMyBookings = () => {}; // the card list itself is not this suite's business
    ctx.apiFetch = async (path) => path.indexOf('/bookings') === 0
      ? jsonRes(200, { data: [{ id: 'A', event_id: 101, slot: 7 }] }) : jsonRes(503, null);
    w.toasts.length = 0;
    await ctx.retryBookingsLoad(btn);
    t.eq(w.toasts, [], 'Retry that draws the list does not toast');
  }

  // ── Source-level contracts ───────────────────────────────────────────────
  t.section('Bookings: load state is what My Bookings and checkAuth rely on');
  // (up to the populated branch — "emptyEl.style.display = 'none'" also hides the hero while the list loads)
  const render = src.slice(src.indexOf('function renderMyBookings()'), src.indexOf('const items = _showPastBookings'));
  t.ok(/currentUser && _bookingsLoadState === 'failed'/.test(render) && /onclick="retryBookingsLoad\(this\)"/.test(render),
    'renderMyBookings: a signed-in member whose list never loaded gets "Couldn\'t load your bookings" + Retry');
  t.ok(render.indexOf("_bookingsLoadState === 'failed'") < render.indexOf('Nothing booked<br>'), 'renderMyBookings: the failed state is decided before the confirmed-empty hero');
  t.ok(/currentUser && _bookingsLoadState === 'pending'/.test(render) && render.indexOf("_bookingsLoadState === 'pending'") < render.indexOf('Nothing booked<br>'),
    'renderMyBookings: a list still loading is decided before the confirmed-empty hero too — "Nothing booked" is left for the loaded state');
  const auth = src.slice(src.indexOf('async function _checkAuthOnce('), src.indexOf('const PROFILE_REFRESH_MIN_GAP_MS'));
  t.ok(!/fetchMyBookings\(\)\.then/.test(auth), 'checkAuth no longer paints "Nothing booked" itself when its /bookings fetch fails or is merely superseded');
};
