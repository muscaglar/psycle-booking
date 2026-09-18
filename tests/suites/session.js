'use strict';
// Session lifecycle (js/app.js): what a /profile attempt means for the session,
// single-flight checkAuth, the token-change guard, refreshProfile, and the
// first-run history prompt's offer rule.
//
// Two layers:
//   1. the DOM-free helpers between the pure:session markers (t.loadPure);
//   2. checkAuth / refreshProfile themselves, sliced out of app.js by their own
//      anchors and run in a vm context with a stubbed document / fetch / event
//      bus — they touch the DOM, so they are deliberately NOT in a pure block.
module.exports = async function (t) {
  t.section('Session: pure helpers (js/app.js pure:session block)');
  const pure = t.loadPure('js/app.js', 'session');

  t.eq(pure._sessionStateFor(false, 200), 'signed-out', 'no token is signed out whatever the status');
  t.eq(pure._sessionStateFor(true, 200), 'signed-in', '200 with a token is signed in');
  t.eq(pure._sessionStateFor(true, 401), 'expired', '401 is a dead session');
  t.eq(pure._sessionStateFor(true, 403), 'unverified', '403 is a denial with a valid token (business rule / WAF / rate limit) — never a dead session');
  t.eq(pure._sessionStateFor(true, 0), 'unverified', 'a request that never completed (offline/timeout) keeps the session');
  t.eq(pure._sessionStateFor(true, 503), 'unverified', '5xx keeps the session');
  t.eq(pure._sessionStateFor(true, 429), 'unverified', '429 keeps the session');

  t.eq(pure._authGateViewFor(false, false), 'signin', 'gate: no token shows Sign in');
  t.eq(pure._authGateViewFor(false, true), 'signin', 'gate: a stale unverified flag never outranks a missing token');
  t.eq(pure._authGateViewFor(true, true), 'retry', 'gate: kept token + failed check shows Retry, never Sign in');
  t.eq(pure._authGateViewFor(true, false), 'checking', 'gate: kept token + pending check is not a Sign-in CTA either');

  const capped = { id: 1, status: 'active', max_bookings: 12, period_start: '2026-09-01' };
  const unlimited = { id: 2, status: 'active', max_bookings: 0, period_start: '2026-09-01' };
  const lapsed = { id: 3, status: 'cancelled', max_bookings: 12, period_start: '2026-08-01' };
  t.eq(pure._pickActiveSubscription([unlimited, capped]).id, 1, 'subscription: a capped active plan wins over an unlimited one');
  t.eq(pure._pickActiveSubscription([lapsed, unlimited]).id, 2, 'subscription: falls back to an active plan with a billing period');
  t.eq(pure._pickActiveSubscription([lapsed]), null, 'subscription: nothing active is null');
  t.eq(pure._pickActiveSubscription(undefined), null, 'subscription: a profile without subscriptions is null');
  t.eq(pure._pickActiveSubscription([null, capped]).id, 1, 'subscription: tolerates holes in the list');

  const offer = (o) => pure._shouldOfferHistorySync(Object.assign({ hasToken: true, synced: false, dismissed: false, historyCount: 0 }, o));
  t.ok(offer({}) === true, 'history prompt: offered to a signed-in member with no history');
  t.ok(offer({ hasToken: false }) === false, 'history prompt: never when signed out');
  t.ok(offer({ synced: true }) === false, 'history prompt: never after a completed sync');
  t.ok(offer({ dismissed: true }) === false, 'history prompt: never again after Skip / × / backdrop');
  t.ok(offer({ historyCount: 11 }) === false, 'history prompt: not once real history exists');
  t.ok(offer({ historyCount: 10 }) === true, 'history prompt: ten entries is still "little history"');
  t.ok(pure._shouldOfferHistorySync(undefined) === false, 'history prompt: no state is a no');

  // ── checkAuth / refreshProfile in a stubbed context ──────────────────────
  t.section('Session: checkAuth / refreshProfile (sliced from js/app.js)');
  const src = t.readSource('js/app.js');
  const from = src.indexOf('// ── pure:session:start');
  const to = src.indexOf('const HISTORY_PROMPT_DISMISSED_KEY');
  t.ok(from !== -1 && to > from, 'session lifecycle block found between its anchors');
  if (from === -1 || to <= from) return;

  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const PROFILE = { data: { id: 7, first_name: 'Ada', last_name: 'Lovelace', subscriptions: [capped] } };
  const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  function makeWorld(token) {
    const w = {
      token, fetches: [], apiFetches: [], events: [], toasts: [], expired: 0, renders: 0, searches: 0, bookingFetches: 0,
      els: {
        authPill: { innerHTML: 'SIGNIN' },
        settingsGear: { innerHTML: '<svg/>', hidden: true },
        sessionBanner: { style: { display: 'flex' } },
      },
      now: 1000000,
    };
    const handlers = {};
    const ctx = t.vm.createContext({
      console, AbortController,
      window: { _windowEvents: null },
      document: { getElementById: (id) => w.els[id] || null },
      PsycleEvents: {
        on: (e, fn) => { (handlers[e] = handlers[e] || []).push(fn); },
        emit: (e, arg) => { w.events.push([e, arg]); (handlers[e] || []).forEach((fn) => fn(arg)); },
      },
      setTimeout: () => 0, clearTimeout: () => {},
      getBearerToken: () => w.token,
      apiUrl: (p) => 'https://api.test' + p,
      escapeHTML: (s) => String(s),
      fetch: (url, opts) => new Promise((resolve, reject) => { w.fetches.push({ url, opts, resolve, reject }); }),
      apiFetch: (path) => new Promise((resolve, reject) => { w.apiFetches.push({ path, resolve, reject }); }),
      fetchMyBookings: () => { w.bookingFetches++; return Promise.resolve(true); },
      renderMyBookings: () => { w.renders++; },
      updateDiscoverEmptyState: () => {}, showHistorySyncPrompt: () => {},
      renderDiscoverPresets: () => {}, renderRebookHint: () => {},
      search: () => { w.searches++; },
      toast: (msg) => { w.toasts.push(msg); },
      showSessionExpired: () => { w.expired++; w.token = ''; },
      currentUser: null, _activeSubscription: null, _myBookings: {}, locations: [{ id: 1 }],
      __w: w,
    });
    t.vm.runInContext('Date.now = function () { return __w.now; };', ctx);
    t.vm.runInContext(src.slice(from, to), ctx, { filename: 'js/app.js[session lifecycle]' });
    w.ctx = ctx;
    w.authEvents = () => w.events.filter((e) => e[0] === 'auth:changed').map((e) => e[1]);
    return w;
  }

  // Single-flight + the signed-in path.
  let w = makeWorld('tok-A');
  let p1 = w.ctx.checkAuth();
  let p2 = w.ctx.checkAuth();
  t.eq(w.fetches.length, 1, 'two checkAuth() calls under one token share a single /profile request');
  t.ok(w.fetches[0].opts.signal && typeof w.fetches[0].opts.signal.aborted === 'boolean', '/profile fetch carries an abort signal (15s cap)');
  t.eq(w.fetches[0].opts.headers.Authorization, 'Bearer tok-A', '/profile is sent with the token the check started with');
  t.eq(w.els.authPill.innerHTML, '', 'no Sign-in pill while a stored token is being checked');
  w.fetches[0].resolve(jsonRes(200, PROFILE));
  await Promise.all([p1, p2]);
  t.eq(w.ctx.currentUser && w.ctx.currentUser.id, 7, 'signed in: currentUser applied');
  t.eq(w.ctx._activeSubscription && w.ctx._activeSubscription.id, 1, 'signed in: active subscription picked');
  t.eq(w.els.settingsGear.innerHTML, '<span>AL</span>', 'signed in: avatar shows initials');
  t.eq(w.els.sessionBanner.style.display, 'none', 'signed in: the "session expired" banner is hidden');
  t.eq(w.events.map((e) => e[0]), ['profile:updated', 'auth:changed'], 'signed in: profile:updated then auth:changed');
  t.eq(w.authEvents()[0], { signedIn: true, initial: true, unverified: false }, 'first outcome of the page load is initial:true');
  t.eq(w.searches, 0, 'launch sign-in does not start a second search (the launch path already does)');
  t.eq(w.bookingFetches, 1, 'signed in: bookings are fetched');

  // A later sign-in (popup / healed connection) is not initial and loads the timetable.
  w.token = 'tok-B';
  p1 = w.ctx.checkAuth();
  w.fetches[1].resolve(jsonRes(200, PROFILE));
  await p1;
  t.eq(w.authEvents()[1], { signedIn: true, initial: false, unverified: false }, 'a later sign-in is initial:false');
  t.eq(w.searches, 1, 'a later sign-in with no timetable loaded runs search()');

  // Offline / blip: the member is NOT signed out.
  w = makeWorld('tok-A');
  p1 = w.ctx.checkAuth();
  w.fetches[0].reject(new TypeError('Failed to fetch'));
  await p1;
  t.eq(w.expired, 0, 'network failure never expires the session');
  t.eq(w.token, 'tok-A', 'network failure keeps the token');
  t.eq(w.els.authPill.innerHTML, '', 'network failure shows no Sign-in pill');
  t.eq(w.els.settingsGear.hidden, false, 'network failure keeps the header avatar');
  t.eq(w.authEvents()[0], { signedIn: false, initial: true, unverified: true }, 'network failure emits unverified, not signed out');
  t.ok(w.renders >= 1, 'network failure repaints My Bookings (Retry hero)');
  t.ok(/retryAuth\(this\)/.test(w.ctx.authGateHTML()) && !/openLoginPopup/.test(w.ctx.authGateHTML()), 'gate hero offers Retry, not Sign in');
  t.eq(w.toasts.length, 0, 'plain offline does not toast');

  // Heal: the retry succeeds.
  p1 = w.ctx.checkAuth();
  w.fetches[1].resolve(jsonRes(200, PROFILE));
  await p1;
  t.eq(w.authEvents()[1], { signedIn: true, initial: false, unverified: false }, 'heal: signed in once Psycle answers');
  t.ok(!/retryAuth/.test(w.ctx.authGateHTML()), 'heal: the Retry hero is gone');
  t.eq(w.searches, 1, 'heal: the timetable loads after the connection returns');

  // 5xx: one toast, not one per retry.
  w = makeWorld('tok-A');
  p1 = w.ctx.checkAuth(); w.fetches[0].resolve(jsonRes(503, null)); await p1;
  p1 = w.ctx.checkAuth(); w.fetches[1].resolve(jsonRes(503, null)); await p1;
  t.eq(w.toasts.length, 1, '5xx toasts once, not on every heal attempt');
  t.eq(w.expired, 0, '5xx never expires the session');

  // 200 with a body that is not a profile proves nothing.
  w = makeWorld('tok-A');
  p1 = w.ctx.checkAuth(); w.fetches[0].resolve(jsonRes(200, null)); await p1;
  t.eq(w.ctx.currentUser, null, 'a 200 without a profile body does not sign in');
  t.eq(w.authEvents()[0].unverified, true, 'a 200 without a profile body is unverified');

  // 403: session expiry is 401-ONLY. checkAuth re-runs on every foreground /
  // 'online' / Retry while Psycle is misbehaving, so a 403 from an edge in
  // front of it must not cost the member their token.
  w = makeWorld('tok-A');
  p1 = w.ctx.checkAuth(); w.fetches[0].resolve(jsonRes(503, null)); await p1;
  p1 = w.ctx.checkAuth(); w.fetches[1].resolve(jsonRes(403, null)); await p1; // the heal is answered 403
  t.eq(w.expired, 0, '403 never expires the session');
  t.eq(w.token, 'tok-A', '403 keeps the token');
  t.eq(w.authEvents()[1], { signedIn: false, initial: false, unverified: true }, '403 is unverified (Retry hero), not signed out');
  t.ok(/retryAuth\(this\)/.test(w.ctx.authGateHTML()) && !/openLoginPopup/.test(w.ctx.authGateHTML()), '403 offers Retry, not Sign in');
  p1 = w.ctx.checkAuth(); w.fetches[2].resolve(jsonRes(200, PROFILE)); await p1;
  t.eq(w.ctx.currentUser && w.ctx.currentUser.id, 7, '403 heals to signed-in with the same token once Psycle answers');

  // 401: the one case that ends the session.
  w = makeWorld('tok-A');
  p1 = w.ctx.checkAuth(); w.fetches[0].resolve(jsonRes(401, null)); await p1;
  t.eq(w.expired, 1, '401 expires the session');

  // Sign-out while a check is in flight: the old answer is dropped.
  w = makeWorld('tok-A');
  p1 = w.ctx.checkAuth();
  w.token = '';
  p2 = w.ctx.checkAuth(); // what clearToken does
  await p2;
  t.eq(w.fetches.length, 1, 'signed-out check needs no request');
  t.eq(w.els.authPill.innerHTML.indexOf('Sign in') !== -1, true, 'signed out: Sign-in pill is back');
  w.fetches[0].resolve(jsonRes(200, PROFILE));
  await p1;
  t.eq(w.ctx.currentUser, null, "a /profile answer for a token that is gone is never applied");
  t.eq(w.events.filter((e) => e[0] === 'profile:updated').length, 0, 'dropped answer emits nothing');
  t.eq(w.authEvents().length, 1, 'only the signed-out outcome was announced');

  // Account switch while a check is in flight: a fresh request, old answer dropped.
  w = makeWorld('tok-A');
  p1 = w.ctx.checkAuth();
  w.token = 'tok-B';
  p2 = w.ctx.checkAuth();
  t.eq(w.fetches.length, 2, 'a different token starts its own /profile request');
  w.fetches[0].resolve(jsonRes(200, { data: { id: 1, first_name: 'Old' } }));
  await p1;
  t.eq(w.ctx.currentUser, null, "the previous token's profile is not applied to the new session");
  w.fetches[1].resolve(jsonRes(200, PROFILE));
  await p2;
  t.eq(w.ctx.currentUser.id, 7, "the new token's profile is applied");

  // refreshProfile
  w = makeWorld('');
  t.eq(await w.ctx.refreshProfile(), false, 'refreshProfile: signed out is a no-op');
  t.eq(w.apiFetches.length + w.fetches.length, 0, 'refreshProfile: signed out makes no request');

  w = makeWorld('tok-A');
  p1 = w.ctx.checkAuth(); w.fetches[0].resolve(jsonRes(200, PROFILE)); await p1;
  w.events.length = 0;
  p1 = w.ctx.refreshProfile();
  p2 = w.ctx.refreshProfile();
  t.eq(w.apiFetches.length, 1, 'refreshProfile: concurrent calls share one request');
  t.eq(w.apiFetches[0].path, '/profile', 'refreshProfile: goes through apiFetch(/profile)');
  const moved = { data: { id: 7, first_name: 'Ada', subscriptions: [Object.assign({}, capped, { bookings_made: 8 })] } };
  w.apiFetches[0].resolve(jsonRes(200, moved));
  t.eq(await p1, true, 'refreshProfile: resolves true when applied');
  await flush();
  t.eq(w.ctx._activeSubscription.bookings_made, 8, 'refreshProfile: plan usage updated');
  t.eq(w.events.map((e) => e[0]), ['profile:updated'], 'refreshProfile: emits profile:updated only (no auth change)');
  t.eq(await w.ctx.refreshProfile(), false, 'refreshProfile: throttled within 30s');
  t.eq(w.apiFetches.length, 1, 'refreshProfile: throttled call makes no request');
  p1 = w.ctx.refreshProfile(true);
  t.eq(w.apiFetches.length, 2, 'refreshProfile(force): a booking/cancel bypasses the throttle');
  w.apiFetches[1].resolve(jsonRes(503, null));
  t.eq(await p1, false, 'refreshProfile: a failed refresh resolves false');
  await flush();
  t.eq(w.ctx.currentUser && w.ctx.currentUser.id, 7, 'refreshProfile: failure keeps the last good profile');
  t.eq(w.token, 'tok-A', 'refreshProfile: failure never touches the token');
  w.now += 31000;
  p1 = w.ctx.refreshProfile();
  t.eq(w.apiFetches.length, 3, 'refreshProfile: runs again after the throttle window');
  w.token = ''; w.ctx.currentUser = null; // signed out mid-flight
  w.apiFetches[2].resolve(jsonRes(200, moved));
  t.eq(await p1, false, 'refreshProfile: an answer that lands after sign-out is dropped');
  t.eq(w.ctx.currentUser, null, 'refreshProfile: sign-out is not undone by a late answer');

  // A FAILED refresh must not arm the throttle: resume with no signal (every
  // retry fails), then 'online' a few seconds later has to get through.
  w = makeWorld('tok-A');
  p1 = w.ctx.checkAuth(); w.fetches[0].resolve(jsonRes(200, PROFILE)); await p1;
  p1 = w.ctx.refreshProfile();
  w.apiFetches[0].reject(new TypeError('Failed to fetch'));
  t.eq(await p1, false, 'refreshProfile: a rejected request resolves false');
  await flush();
  w.now += 2000;
  p1 = w.ctx.refreshProfile();
  t.eq(w.apiFetches.length, 2, "refreshProfile: a failed refresh does not throttle the 'online' catch-up that follows");
  w.apiFetches[1].resolve(jsonRes(503, null));
  t.eq(await p1, false, 'refreshProfile: …nor does a 5xx answer');
  await flush();
  p1 = w.ctx.refreshProfile();
  t.eq(w.apiFetches.length, 3, 'refreshProfile: still unthrottled after the 5xx');
  w.apiFetches[2].resolve(jsonRes(200, moved));
  t.eq(await p1, true, 'refreshProfile: the retry lands');
  await flush();
  t.eq(await w.ctx.refreshProfile(), false, 'refreshProfile: only the refresh that landed starts the 30s window');
  t.eq(w.apiFetches.length, 3, 'refreshProfile: throttled again once one has landed');

  // A forced refresh behind one already in flight goes again afterwards.
  w = makeWorld('tok-A');
  p1 = w.ctx.checkAuth(); w.fetches[0].resolve(jsonRes(200, PROFILE)); await p1;
  p1 = w.ctx.refreshProfile();
  w.ctx.refreshProfile(true);
  t.eq(w.apiFetches.length, 1, 'forced refresh while one is in flight waits for it');
  w.apiFetches[0].resolve(jsonRes(200, PROFILE));
  await p1; await flush();
  t.eq(w.apiFetches.length, 2, 'forced refresh re-runs once the stale one has landed');

  // ── clearToken / showSessionExpired / confirmSignOut (the real ones) ─────
  t.section('Session: sign-out and expiry (sliced from js/app.js)');
  const outFrom = src.indexOf('function clearToken()');
  const outTo = src.indexOf('// Token from login is now received');
  t.ok(outFrom !== -1 && outTo > outFrom, 'sign-out block found between its anchors');
  if (outFrom === -1 || outTo <= outFrom) return;

  async function signedInWorld() {
    const sw = makeWorld('tok-A');
    sw.removedKeys = []; sw.resyncs = []; sw.confirmAnswer = true;
    Object.assign(sw.ctx, {
      localStorage: { removeItem: (k) => { sw.removedKeys.push(k); } },
      WAITLIST_PLACES_KEY: 'psycle_waitlist_places',
      _lastWaitlistEntries: [{ id: 1 }],
      cancelTokenExpiryCheck: () => {},
      _resyncDiscoverButtons: (allow) => { sw.resyncs.push(allow); },
      confirmModal: () => Promise.resolve(sw.confirmAnswer),
      // What app.js's fetchMyBookings does without a token — synchronously.
      fetchMyBookings: () => { sw.bookingFetches++; if (!sw.token) { sw.ctx._myBookings = {}; sw.renders++; } return Promise.resolve(true); },
    });
    sw.ctx.window._secureTokenStore = { clear: () => { sw.token = ''; } };
    t.vm.runInContext(src.slice(outFrom, outTo), sw.ctx, { filename: 'js/app.js[sign-out]' });
    const p = sw.ctx.checkAuth();
    sw.fetches[0].resolve(jsonRes(200, PROFILE));
    await p;
    sw.ctx._myBookings = { 101: { bookingId: 5, slots: [7] } };
    sw.events.length = 0;
    return sw;
  }

  let sw = await signedInWorld();
  sw.ctx.clearToken();
  // Everything below must hold the moment clearToken returns: native-bridge's
  // wrapper recomputes the widget snapshot on the very next line.
  t.eq(sw.token, '', 'sign-out: token cleared');
  t.eq(Object.keys(sw.ctx._myBookings).length, 0, "sign-out: the previous account's bookings are gone synchronously");
  t.eq(sw.ctx._activeSubscription, null, "sign-out: the previous account's plan is gone");
  t.eq(sw.ctx.currentUser, null, 'sign-out: no current user');
  t.eq(sw.resyncs, [true], 'sign-out: Discover "Booked" buttons are released');
  t.eq(sw.events.map((e) => e[0]), ['auth:changed'], 'sign-out: announces auth:changed — and never bookings:loaded');
  t.eq(sw.events[0][1], { signedIn: false, initial: false, unverified: false }, 'sign-out: signedIn:false');
  t.ok(sw.els.authPill.innerHTML.indexOf('Sign in') !== -1 && sw.els.settingsGear.hidden === true, 'sign-out: Sign-in pill back, avatar hidden');
  t.ok(sw.removedKeys.indexOf('psycle_waitlist_places') !== -1, 'sign-out: waitlist memory still cleared');

  sw = await signedInWorld();
  sw.ctx.showSessionExpired();
  t.eq(Object.keys(sw.ctx._myBookings), ['101'], 'expiry: bookings are kept (the widget serves them until re-login)');
  t.eq(sw.ctx._activeSubscription, null, 'expiry: plan card state dropped');
  t.eq(sw.els.sessionBanner.style.display, 'flex', 'expiry: banner shown');
  t.eq(sw.events.map((e) => e[0]), ['auth:changed'], 'expiry: announces auth:changed');
  t.eq(sw.renders, 0, 'expiry: a populated My Bookings list is not re-rendered mid-flow');
  // …and the sign-in that follows clears the banner again (#70).
  sw.token = 'tok-B';
  let again = sw.ctx.checkAuth();
  sw.fetches[1].resolve(jsonRes(200, PROFILE));
  await again;
  t.eq(sw.els.sessionBanner.style.display, 'none', 're-login hides the "session expired" banner');

  sw = await signedInWorld();
  sw.ctx._myBookings = {};
  sw.ctx.showSessionExpired();
  t.eq(sw.renders, 1, 'expiry: an EMPTY My Bookings tab is repainted (Nothing booked → Sign in)');

  // Expiry keeps the map for the SAME member. A different customer signing in
  // on the same page must never see it — not even for the one repaint that
  // profile:updated triggers, and not if their own /bookings then fails.
  const OTHER = { data: { id: 8, first_name: 'Bea', subscriptions: [] } };
  const watchPaints = (world) => {
    const paints = [];
    world.ctx.renderMyBookings = () => {
      world.renders++;
      paints.push({ user: world.ctx.currentUser ? world.ctx.currentUser.id : null, ids: Object.keys(world.ctx._myBookings) });
    };
    return paints;
  };
  sw = await signedInWorld();
  sw.ctx._bookingsLoadState = 'loaded';
  sw.ctx.showSessionExpired();
  let paints = watchPaints(sw);
  sw.token = 'tok-B';
  again = sw.ctx.checkAuth();
  sw.fetches[1].resolve(jsonRes(200, OTHER));
  await again;
  t.eq(sw.ctx.currentUser.id, 8, 'owner change: the new customer is signed in');
  t.eq(Object.keys(sw.ctx._myBookings), [], "owner change: the previous customer's bookings are dropped");
  t.eq(paints, [{ user: null, ids: [] }], 'owner change: My Bookings is repainted once, EMPTY, before currentUser is set (the "checking" hero — never the old cards, never an unconfirmed "Nothing booked")');
  t.eq(sw.resyncs, [true], 'owner change: Discover "Booked" buttons are released');
  t.eq(sw.ctx._lastWaitlistEntries, null, "owner change: the previous customer's waitlist list is not reused");
  t.eq(sw.ctx._bookingsLoadState, 'pending', "owner change: the new customer's list counts as not loaded yet");
  t.eq(sw.events.map((e) => e[0]), ['auth:changed', 'profile:updated', 'auth:changed'], 'owner change: emits nothing extra — and never bookings:loaded');

  // The same member signing back in keeps the map (and is repainted with it).
  sw = await signedInWorld();
  sw.ctx._bookingsLoadState = 'loaded';
  sw.ctx.showSessionExpired();
  paints = watchPaints(sw);
  sw.token = 'tok-B';
  again = sw.ctx.checkAuth();
  sw.fetches[1].resolve(jsonRes(200, PROFILE));
  await again;
  t.eq(Object.keys(sw.ctx._myBookings), ['101'], 'same member re-login: bookings are kept');
  t.eq(paints, [{ user: 7, ids: ['101'] }], 'same member re-login: the kept list is repainted under their refreshed profile');
  t.eq(sw.resyncs, [], 'same member re-login: nothing is released');
  t.eq(sw.ctx._bookingsLoadState, 'loaded', 'same member re-login: the list still counts as loaded');

  // Same member with NOTHING booked: expiry swaps the confirmed-empty hero for
  // the Sign-in one (an unverified check: for "Can't reach Psycle"). Nothing
  // else repaints an empty tab, so if the /bookings after the re-login fails,
  // the REAL fetchMyBookings has to — or a signed-in member keeps a Sign-in CTA.
  const bkFrom = src.indexOf('let _bookingsSeq = 0;');
  const bkTo = src.indexOf('// Refresh bookings when the page becomes visible after being hidden');
  t.ok(bkFrom !== -1 && bkTo > bkFrom, 'the bookings fetch block can be sliced (anchors moved? update tests/suites/session.js)');
  async function emptyLoadedWorld() {
    const ew = await signedInWorld();
    ew.ctx.document.querySelectorAll = () => [];
    Object.assign(ew.ctx, {
      console: { log() {}, warn() {}, error: console.error }, // the scripted timeout is logged by design
      _myBookings: {}, _eventCache: {}, _studioMap: {}, _lastWaitlistEntries: null,
      fetchMyWaitlists: () => Promise.resolve([]),
      _mergeWaitlistsIntoBookings: () => {},
      _readWaitlistPlaces: () => ({ places: {}, allocated: {} }),
      _writeWaitlistPlaces: () => {},
      _heldPlacesOf: () => ({}),
      _diffWaitlistPlaces: () => ({ allocated: {}, newlyAllocated: [] }),
      _probeWaitlistOffers: () => Promise.resolve(null),
      _syncCardButtonsForEvent: () => {}, applyBookedState: () => {},
    });
    t.vm.runInContext(src.slice(bkFrom, bkTo), ew.ctx, { filename: 'js/app.js[bookings fetch]' });
    ew.state = () => t.vm.runInContext('_bookingsLoadState', ew.ctx);
    ew.answerBookings = async (status, body) => {
      const call = ew.apiFetches.filter((c) => c.path.indexOf('/bookings') === 0).pop();
      if (status) call.resolve(jsonRes(status, body)); else call.reject(new Error('Request timed out'));
      await flush(); await flush();
    };
    ew.ctx.fetchMyBookings();
    await ew.answerBookings(200, { data: [] });
    ew.paints = [];
    ew.ctx.renderMyBookings = () => { ew.paints.push({ user: ew.ctx.currentUser ? ew.ctx.currentUser.id : null, state: ew.state() }); };
    return ew;
  }
  for (const answer of [503, 0]) {
    const how = answer ? 'a 503' : 'a timeout';
    const ew = await emptyLoadedWorld();
    t.eq(ew.state(), 'loaded', 'empty list: loaded (the confirmed "Nothing booked" hero)');
    ew.ctx.showSessionExpired();
    t.eq(ew.paints, [{ user: null, state: 'pending' }], 'expiry over an empty list: the Sign-in hero is painted and the list no longer counts as loaded');
    ew.token = 'tok-B';
    const relogin = ew.ctx.checkAuth();
    ew.fetches[1].resolve(jsonRes(200, PROFILE));
    await relogin;
    await ew.answerBookings(answer, null);
    t.eq(ew.paints[ew.paints.length - 1], { user: 7, state: 'failed' },
      'same member re-login + /bookings ' + how + ': My Bookings is repainted as "Couldn\'t load your bookings / Retry" (it used to keep the Sign-in hero under a signed-in avatar)');
  }
  {
    const ew = await emptyLoadedWorld();
    const blip = ew.ctx.checkAuth();
    ew.fetches[1].resolve(jsonRes(503, null));
    await blip;
    t.eq(ew.paints, [{ user: null, state: 'pending' }], 'unverified check over an empty list: "Can\'t reach Psycle" is painted, the list no longer counts as loaded');
    const heal = ew.ctx.checkAuth();
    ew.fetches[2].resolve(jsonRes(200, PROFILE));
    await heal;
    await ew.answerBookings(503, null);
    t.eq(ew.paints[ew.paints.length - 1], { user: 7, state: 'failed' }, 'healed check + /bookings 503: the "Can\'t reach Psycle" hero gives way to Retry');
  }

  // Sign-out then a different customer: nothing to drop, so no repaint — it
  // would only flash a "Nothing booked" hero before their /bookings answers.
  sw = await signedInWorld();
  sw.ctx.clearToken();
  paints = watchPaints(sw);
  sw.resyncs.length = 0;
  sw.token = 'tok-B';
  again = sw.ctx.checkAuth();
  sw.fetches[1].resolve(jsonRes(200, OTHER));
  await again;
  t.eq(paints, [], 'owner change with nothing to drop: no repaint');
  t.eq(sw.resyncs, [], 'owner change with nothing to drop: no button resync');

  sw = await signedInWorld();
  sw.confirmAnswer = false;
  await sw.ctx.confirmSignOut();
  t.eq(sw.token, 'tok-A', 'confirmSignOut: cancelling keeps the session');
  sw.confirmAnswer = true;
  await sw.ctx.confirmSignOut();
  t.eq(sw.token, '', 'confirmSignOut: confirming signs out');

  // ── Source-level contracts other modules rely on ─────────────────────────
  t.section('Session: cross-module contracts');
  const clear = src.slice(src.indexOf('function clearToken()'), src.indexOf('async function confirmSignOut'));
  t.ok(/_activeSubscription = null/.test(clear), 'clearToken drops the previous plan');
  t.ok(/fetchMyBookings\(\);/.test(clear) && clear.indexOf('fetchMyBookings();') < clear.indexOf('checkAuth();'),
    'clearToken empties bookings (synchronously, via the no-token fetch) before announcing the sign-out');
  t.ok(!/emit\('bookings:loaded'/.test(clear), "clearToken never emits bookings:loaded (would read as server-confirmed-empty to the calendar sync)");
  const expiredSrc = src.slice(src.indexOf('function showSessionExpired()'), src.indexOf('// Token from login is now received'));
  t.ok(!/_myBookings = \{\}/.test(expiredSrc), 'session expiry keeps _myBookings (the widget serves them until re-login)');
  t.ok(/_emitAuthChanged\(false\)/.test(expiredSrc), 'session expiry announces auth:changed');
  const tabsSrc = t.readSource('js/tabs.js');
  t.ok(/PsycleEvents\.on\('auth:changed'/.test(tabsSrc) && /PsycleEvents\.on\('profile:updated'/.test(tabsSrc), 'tabs.js repaints on auth:changed and profile:updated');
  t.ok(/PsycleEvents\.on\('auth:changed'/.test(t.readSource('js/settings.js')), 'settings.js clears the next-class pill on auth:changed');
  const exploreSrc = t.readSource('js/explore.js');
  const zero = exploreSrc.slice(exploreSrc.indexOf('if (allBookings.length === 0) {'), exploreSrc.indexOf('// Update button with progress'));
  t.ok(/if \(_confirmedEmpty\) \{\s*localStorage\.setItem\(SYNC_KEY/.test(zero), 'history sync: only a confirmed-empty answer is recorded as synced');
};
