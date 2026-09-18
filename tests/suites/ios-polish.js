'use strict';
// iOS polish (wave 6): which classes get a T-90 reminder, a held seat whose
// details failed to load, the Monday-reminder tap + copy, the pull pill's
// hidden state, and the Live Activity seat text.
//
// Two layers. The DOM-free decisions are evaluated straight out of the
// bridge's `pure:ios-polish` region. The wiring is then checked for real: the
// SHIPPED bridge runs in its own vm context against a fake Capacitor (same idea
// as tests/suites/ios-bridge.js, kept separate so neither file is the merge
// point for the other). Nothing native, no network.

module.exports = async function (t) {
  const BRIDGE_SRC = t.readSource('ios-app/www/native-bridge.js');
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  // 2026-09-17 09:00 UTC. The suite runs with TZ=America/New_York, and the
  // widget/reminder path parses class times DEVICE-locally (left that way on
  // purpose) — every class below is a day or more out, so the zone is moot.
  const NOW = Date.UTC(2026, 8, 17, 9, 0, 0);

  const seat = (id, slots) => ({ bookingId: id, bookingIds: [id], slots: slots || [7], slotBookings: {}, waitlisted: false });
  const cached = (startAt, extra) => Object.assign({ start_at: startAt, _typeName: 'Ride', _instrName: 'Alex', _locName: 'Bank', _studioName: 'Studio 1' }, extra || {});
  const savedItem = (id, startAt) => ({ id: String(id), start_at: startAt, duration: 45, type: 'Ride', instructor: 'Alex', location: 'Bank', studio: 'Studio 1', slots: [99], spaces: 0, waitlisted: false });
  const day = (n) => '2026-09-' + String(n).padStart(2, '0') + ' 07:00:00';
  // Null-safe readers: a regression should FAIL an assertion, not crash the suite.
  const idOf = (snap) => (snap || {}).eventId;
  const idsOf = (list) => (list || []).map((c) => c.eventId);

  /**
   * Evaluate the shipped bridge with a fake Capacitor. opts:
   *   local   {key: value}  localStorage before launch
   *   perm    notification permission ('granted' by default here)
   *   saved   items for app.js's _readBookingsSnapshot(); undefined = app.js has no such function
   *   hooks   extra window globals (the Discover refresh hooks)
   */
  function boot(opts) {
    opts = opts || {};
    const ls = t.makeFakeLocalStorage();
    Object.keys(opts.local || {}).forEach((k) => ls.setItem(k, opts.local[k]));
    const native = {};
    const calls = { scheduled: [], cancelled: [], removedDelivered: [], laRefresh: 0, switchTab: [], savedReads: 0 };
    const listeners = {};
    const handlers = {};
    const plugins = {
      Preferences: {
        get: () => Promise.resolve({ value: null }),
        set(o) { native[o.key] = o.value; return Promise.resolve(); },
        remove(o) { delete native[o.key]; return Promise.resolve(); },
      },
      LocalNotifications: {
        checkPermissions: () => Promise.resolve({ display: opts.perm || 'granted' }),
        requestPermissions: () => Promise.resolve({ display: opts.perm || 'granted' }),
        registerActionTypes: () => Promise.resolve(),
        addListener(name, fn) { listeners[name] = fn; },
        schedule(o) { calls.scheduled.push(o); return Promise.resolve(); },
        cancel(o) { calls.cancelled.push(o); return Promise.resolve(); },
        removeDeliveredNotifications(o) { calls.removedDelivered.push(o); return Promise.resolve(); },
      },
      PsycleLiveActivity: { refresh() { calls.laRefresh++; return Promise.resolve(); } },
    };
    const ctx = Object.assign({
      console: { log() {}, warn() {}, error() {} },
      localStorage: ls,
      navigator: { onLine: true },
      setTimeout: () => 0, // launch-time passes are driven by hand below
      clearTimeout() {},
      __now: () => NOW,
      Capacitor: { Plugins: plugins, isNativePlatform: () => true },
      PsycleEvents: {
        on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return () => {}; },
        emit(evt, ...args) { (handlers[evt] || []).slice().forEach((fn) => fn(...args)); },
      },
      _eventCache: {},
      _myBookings: {},
      APP_THEMES: [{ id: 'graphite', base: 'dark' }],
      matchMedia: () => ({ matches: false }),
      MutationObserver: function () { this.observe = function () {}; },
      document: {
        documentElement: { getAttribute: () => 'graphite' },
        getElementById: () => null,
        querySelector: () => null,
        addEventListener() {},
        visibilityState: 'visible',
      },
      switchTab(tab) { calls.switchTab.push(tab); },
      openClassDetail() {},
      _psycleNativeRestoreResolve() {},
    }, opts.hooks || {});
    if (opts.saved !== undefined) {
      ctx._readBookingsSnapshot = () => { calls.savedReads++; return opts.saved ? { owner: '1', savedAt: NOW, items: opts.saved } : null; };
    }
    ctx.window = ctx;
    ctx.self = ctx;
    t.vm.createContext(ctx);
    t.vm.runInContext('Date.now = __now;', ctx);
    t.vm.runInContext(BRIDGE_SRC, ctx, { filename: 'native-bridge.js[ios-polish]' });
    return {
      ctx, calls, native, ls,
      // One bookings load, as fetchMyBookings ends it — then let the serialized
      // reminder pass settle.
      async loaded() { ctx.PsycleEvents.emit('bookings:loaded', ctx._myBookings); await flush(); await flush(); },
      async emit(evt) { ctx.PsycleEvents.emit(evt); await flush(); await flush(); },
      tap(extra) { listeners.localNotificationActionPerformed({ actionId: 'tap', notification: { title: 'T', body: 'B', extra: extra } }); },
      armed() { return [].concat(...calls.scheduled.map((o) => o.notifications.map((n) => n.extra.eventId))).sort(); },
      cancelledIds() { return [].concat(...calls.cancelled.map((o) => o.notifications.map((n) => n.id))); },
      // undefined = the pass never wrote this key (it died before reaching it).
      widget(key) { return native[key] === undefined ? undefined : JSON.parse(native[key]); },
      map() { return JSON.parse(ls.getItem('psycle_class_reminder_map') || '{}'); },
    };
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS polish: reminder/widget decisions (pure, native-bridge.js)');
  {
    const p = t.loadPure('ios-app/www/native-bridge.js', 'ios-polish');
    t.ok(p.WIDGET_UPCOMING_MAX === 5, 'the widget timeline keeps its 5 classes (the Swift side is untouched)');
    t.ok(p.CLASS_REMINDER_MAX === 40 && p.CLASS_REMINDER_MAX + 8 < 64, 'reminders cover up to 40 classes — with the 8 weekly ids, under iOS\'s 64 pending requests');

    t.eq([p._isHeldSeat(seat(1)), p._isHeldSeat({ waitlisted: true }), p._isHeldSeat(null), p._isHeldSeat(undefined)], [true, false, false, false],
      'a held seat is a booking that is not a waitlist place — whether or not its class details loaded');

    t.eq(p._evtFromSavedItem(savedItem(5, '2026-09-18 07:00:00')),
      { start_at: '2026-09-18 07:00:00', _typeName: 'Ride', _instrName: 'Alex', _locName: 'Bank', _studioName: 'Studio 1' },
      'a saved-copy item becomes an _eventCache-shaped stand-in (start_at untouched, so an armed reminder is not re-armed)');
    t.ok(!('slots' in p._evtFromSavedItem(savedItem(5, day(18)))), '…and never carries the saved SEATS — those come from the live booking');
    t.eq([p._evtFromSavedItem(null), p._evtFromSavedItem({}), p._evtFromSavedItem({ id: '5', start_at: '' })], [null, null, null], 'nothing saved, or no start time → no stand-in');
    t.eq(p._evtFromSavedItem({ start_at: day(18) })._typeName, 'Class', 'a missing type reads "Class", as the cache path does');

    const map = { 1: { id: 8001, startAt: 'A' }, 2: { id: 8002, startAt: 'B' }, 3: { id: 8003, startAt: 'C' }, 4: { id: 8004, startAt: 'D' } };
    const wanted = { 1: { startAt: 'A' }, 2: { startAt: 'MOVED' } };
    t.eq(p._staleReminderIds(map, wanted, { 3: true }), ['2', '4'],
      'dropped: a moved class (2) and one no longer held (4). Kept: a wanted one (1) and a held seat that is merely unknown this pass (3)');
    t.eq(p._staleReminderIds(map, wanted, null), ['2', '3', '4'], 'with no unknown seats it is the old rule');
    t.eq(p._staleReminderIds(map, { 3: { startAt: 'MOVED' } }, { 3: true }).includes('3'), true, 'a class that IS known and moved is re-armed even if it was flagged unknown');
    t.eq(p._staleReminderIds({}, wanted, {}), [], 'an empty map drops nothing');
    t.eq(p._staleReminderIds(null, null, null), [], '…and bad input never throws');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS polish: every held class gets a reminder, not just the next 5 (R2-23)');
  {
    const b = boot();
    for (let i = 1; i <= 7; i++) { b.ctx._myBookings[200 + i] = seat(200 + i); b.ctx._eventCache[200 + i] = cached(day(19 + i)); }
    await b.loaded();
    t.eq(b.armed(), ['201', '202', '203', '204', '205', '206', '207'], '7 held classes arm 7 reminders');
    t.eq(idsOf(b.widget('widget_upcoming')).length, 5, '…while the widget timeline still gets exactly 5');
    t.eq(idsOf(b.widget('widget_upcoming')), ['201', '202', '203', '204', '205'], '…the soonest 5, in order');
    t.eq(idOf(b.widget('widget_next_class')), '201', '…and "next class" is the soonest');

    // Squeeze in an EARLIER class: it used to push 205 out of the shared list
    // of 5, cancelling the reminder of a class still held.
    b.ctx._myBookings[100] = seat(100);
    b.ctx._eventCache[100] = cached(day(18));
    await b.emit('booking:complete');
    t.eq(b.cancelledIds(), [], 'booking an earlier class cancels no reminder');
    t.eq(b.armed().filter((id) => id === '100').length, 1, '…and arms one for the new class');
    t.eq(Object.keys(b.map()).length, 8, '…so all 8 held classes are armed');
    t.eq(idOf(b.widget('widget_next_class')), '100', '…and the widget moves to the new next class');
  }
  {
    const b = boot();
    for (let i = 1; i <= 45; i++) { b.ctx._myBookings[300 + i] = seat(300 + i); b.ctx._eventCache[300 + i] = cached('2026-10-01 07:' + String(i).padStart(2, '0') + ':00'); }
    await b.loaded();
    t.eq(b.armed().length, 40, 'the cap holds at 40');
    t.ok(!b.armed().includes('345') && b.armed().includes('301'), '…and it is the FURTHEST classes that wait, never the soonest');
  }
  {
    const b = boot();
    b.ctx._myBookings[1] = seat(1);
    b.ctx._eventCache[1] = cached(day(20));
    b.ctx._myBookings[2] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 9 } };
    b.ctx._eventCache[2] = cached(day(19));
    await b.loaded();
    t.eq(b.armed(), ['1'], 'a waitlist place still gets no reminder');
    t.eq(idOf(b.widget('widget_next_class')), '1', '…and is still never the widget\'s "next class"');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS polish: a held class whose details failed to load is unknown, not gone (R2-16)');
  {
    // Cold launch on a weak signal: /bookings answered, every GET /events/{id}
    // failed — _eventCache is empty, _myBookings still holds the seat.
    const armedMap = JSON.stringify({ 40: { id: 8040, startAt: '2026-09-18T07:00:00' } });
    const b = boot({ local: { psycle_class_reminder_map: armedMap }, saved: [savedItem(40, '2026-09-18 07:00:00')] });
    b.ctx._myBookings[40] = seat(40, [12, 14]);
    await b.loaded();
    const written = b.widget('widget_next_class');
    const next = written || {}; // keep asserting (not crashing) if it regresses to null
    t.ok(!!written && next.eventId === '40', 'the widget keeps the class (it used to be written as null)');
    t.eq([next.startAt, next.typeName, next.instrName, next.locName], ['2026-09-18T07:00:00', 'Ride', 'Alex', 'Bank'], '…with when/what from the saved copy');
    t.eq(next.slots, [12, 14], '…and the seats from the LIVE booking, never the saved copy\'s');
    t.eq((b.widget('widget_upcoming') || []).map((c) => c.eventId), ['40'], 'widget_upcoming keeps it too — an empty list is what made Swift end the Live Activity');
    t.eq((b.widget('widget_week') || []).length, 1, 'the week key is written (a saved-copy class has no cache entry to read — that must not throw)');
    t.ok(b.calls.laRefresh >= 1, '…and the pass reaches the Live Activity nudge instead of dying in the catch');
    t.eq(b.cancelledIds(), [], 'its armed reminder is NOT cancelled');
    t.eq(b.calls.removedDelivered.length, 0, '…nor its delivered banner pulled');
    t.eq(b.calls.scheduled.length, 0, '…nor re-armed: the saved start time matches the armed one exactly');
    t.eq(b.map(), JSON.parse(armedMap), '…and the map is unchanged');
  }
  {
    // Partial failure: the sooner class failed, a later one loaded. The later
    // one used to be promoted to "next".
    const b = boot({ saved: [savedItem(40, day(18))] });
    b.ctx._myBookings[40] = seat(40);
    b.ctx._myBookings[41] = seat(41);
    b.ctx._eventCache[41] = cached(day(19));
    await b.loaded();
    t.eq(idOf(b.widget('widget_next_class')), '40', 'a partial failure no longer promotes a later class to "next"');
    t.eq(b.armed(), ['40', '41'], '…and both classes are armed');
  }
  {
    // Nothing known at all (never hydrated on this phone, no saved copy).
    const armedMap = JSON.stringify({ 40: { id: 8040, startAt: '2026-09-18T07:00:00' } });
    const b = boot({ local: { psycle_class_reminder_map: armedMap }, saved: null });
    b.ctx._myBookings[40] = seat(40);
    await b.loaded();
    t.eq(b.widget('widget_next_class'), null, 'with nothing known the widget cannot show it — but the pass still WRITES (an unhydratable id must not wedge the widget)');
    t.eq(b.cancelledIds(), [], '…and its armed reminder still survives');
    t.eq(b.map(), JSON.parse(armedMap), '…map intact');

    const noApp = boot({ local: { psycle_class_reminder_map: armedMap } }); // app.js without _readBookingsSnapshot
    noApp.ctx._myBookings[40] = seat(40);
    await noApp.loaded();
    t.eq(noApp.cancelledIds(), [], 'the saved-copy reader is typeof-guarded: its absence changes nothing else');
  }
  {
    // The pinned case must still hold: gone from /bookings = really gone.
    const armedMap = JSON.stringify({ 40: { id: 8040, startAt: '2026-09-18T07:00:00' } });
    const b = boot({ local: { psycle_class_reminder_map: armedMap }, saved: [savedItem(40, day(18))] });
    await b.loaded(); // _myBookings is empty
    t.eq(b.cancelledIds(), [8040], 'a class no longer held is still cancelled — the saved copy never decides WHAT is held');
    t.eq(b.widget('widget_next_class'), null, '…and never resurrects it on the widget');
    t.eq(b.calls.savedReads, 0, '…it is not even read when no held class is missing its details');
  }
  {
    // A held class that is KNOWN and already started is not "unknown": its
    // reminder is tidied away exactly as before.
    const armedMap = JSON.stringify({ 40: { id: 8040, startAt: '2026-09-16T07:00:00' } });
    const b = boot({ local: { psycle_class_reminder_map: armedMap } });
    b.ctx._myBookings[40] = seat(40);
    b.ctx._eventCache[40] = cached('2026-09-16 07:00:00');
    await b.loaded();
    t.eq(b.cancelledIds(), [8040], 'a held class whose (known) start has passed still has its reminder cleared');
  }
  {
    // Sign-out: app.js empties _myBookings synchronously, then the bridge's
    // clearToken wrapper recomputes. The previous account's saved copy may
    // still be in storage at that instant.
    const armedMap = JSON.stringify({ 40: { id: 8040, startAt: '2026-09-18T07:00:00' } });
    const b = boot({ local: { psycle_class_reminder_map: armedMap }, saved: [savedItem(40, day(18))], hooks: { clearToken() {} } });
    b.ctx._myBookings[40] = seat(40);
    await b.loaded();
    b.ctx._myBookings = {};
    b.ctx.clearToken();
    await flush(); await flush();
    t.eq(b.widget('widget_next_class'), null, 'sign-out still blanks the widget, saved copy or not');
    t.eq(b.cancelledIds(), [8040], '…and still cancels the previous account\'s reminder');
  }
  {
    // Session EXPIRY keeps _myBookings on purpose. A refetch that runs after it
    // (it was pull-to-refresh on My Bookings; any post-401 timer does the same)
    // takes fetchMyBookings' no-token branch, which empties the map and emits
    // nothing — and the next snapshot pass (the foreground one) then blanked the
    // widget, ended the Live Activity and cancelled every armed reminder.
    const armedMap = JSON.stringify({ 40: { id: 8040, startAt: '2026-09-18T07:00:00' } });
    let token = 'tok';
    const b = boot({ local: { psycle_class_reminder_map: armedMap }, hooks: { getBearerToken: () => token, clearToken() { token = ''; } } });
    b.ctx._myBookings[40] = seat(40);
    b.ctx._eventCache[40] = cached(day(18));
    await b.loaded();
    t.eq(idOf(b.widget('widget_next_class')), '40', '(signed in: the class is on the widget)');
    token = '';
    b.ctx._myBookings = {};
    await b.emit('booking:cancelled'); // any later pass — same function the foreground pass runs
    t.eq([idOf(b.widget('widget_next_class')), idsOf(b.widget('widget_upcoming')), b.cancelledIds()], ['40', ['40'], []],
      'token gone + map emptied, NOT a sign-out: the snapshot is left alone — widget, Live Activity and the armed reminder survive until re-login');
    // Signed in and genuinely empty still blanks (the last class was cancelled).
    token = 'tok';
    await b.emit('booking:cancelled');
    t.eq([b.widget('widget_next_class'), b.cancelledIds()], [null, [8040]], 'signed in with nothing booked: blanked and the reminder cancelled, as before');

    // A deliberate sign-out is the one tokenless-and-empty pass that MUST blank.
    const out = boot({ local: { psycle_class_reminder_map: armedMap }, hooks: { getBearerToken: () => token, clearToken() { token = ''; } } });
    out.ctx._myBookings[40] = seat(40);
    out.ctx._eventCache[40] = cached(day(18));
    await out.loaded();
    out.ctx._myBookings = {};
    out.ctx.clearToken();
    await flush(); await flush();
    t.eq([out.widget('widget_next_class'), out.cancelledIds()], [null, [8040]], 'sign-out (token already gone when the wrapper runs) still blanks the widget and cancels the reminders');
    await out.emit('booking:cancelled');
    t.eq(out.widget('widget_next_class'), null, '…and a later tokenless pass leaves it blank');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS polish: the Monday-reminder tap asks Discover for a fresh timetable (R2-17)');
  {
    const seen = [];
    const b = boot({ hooks: { revalidateWindow(o) { seen.push(o); return Promise.resolve(true); } } });
    b.tap(undefined);
    t.eq(b.calls.switchTab, ['discover'], 'the weekly reminder still lands on Discover');
    t.eq(seen, [{ silent: true }], '…and asks for a SILENT refresh (no toasts for something nobody tapped)');
  }
  {
    const seen = [];
    const b = boot({ hooks: { _onBookingWeekOpened() { seen.push('hook'); }, revalidateWindow() { seen.push('plain'); } } });
    b.tap({});
    t.eq(seen, ['hook'], 'app.js\'s own booking-week hook wins when it exists (it owns the freshness rule) — and is the ONLY call: it searches itself, a second loader would race it');
    t.eq(b.calls.switchTab, ['discover'], '…with the tap still landing on Discover straight away (the hook may wait for launch to finish)');
  }
  {
    const b = boot(); // no hook of any kind (an older app.js)
    b.tap(undefined);
    t.eq(b.calls.switchTab, ['discover'], 'with nothing to call it is still just "go to Discover"');
  }
  {
    let unhandled = 0;
    const onUnhandled = () => { unhandled++; };
    process.on('unhandledRejection', onUnhandled);
    const rejecting = boot({ hooks: { _onBookingWeekOpened: () => Promise.reject(new Error('offline')) } });
    rejecting.tap(undefined);
    const throwing = boot({ hooks: { _onBookingWeekOpened() { throw new Error('boom'); } } });
    throwing.tap(undefined);
    await flush(); await flush();
    process.removeListener('unhandledRejection', onUnhandled);
    t.eq([rejecting.calls.switchTab, throwing.calls.switchTab], [['discover'], ['discover']], 'a hook that throws or rejects never breaks the tap');
    t.eq(unhandled, 0, '…nor leaves an unhandled rejection behind');
  }
  {
    const seen = [];
    const b = boot({ hooks: { revalidateWindow() { seen.push('plain'); } } });
    b.ctx._eventCache['123'] = { id: 123 };
    b.ctx._myBookings['123'] = seat(123);
    b.tap({ eventId: 123 });
    t.eq(b.calls.switchTab, ['bookings'], 'a CLASS reminder still goes to My Bookings');
    t.eq(seen, [], '…and refreshes nothing on Discover');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS polish: copy names the right app and the right moment (R2-21)');
  {
    const b = boot({ local: { psycle_weekly_reminder: 'on' } });
    await b.ctx._nativeReminder.enable();
    const weekly = b.calls.scheduled[b.calls.scheduled.length - 1].notifications;
    t.eq(weekly.length, 8, 'the 8 rolling Monday reminders are scheduled');
    t.ok(/12:00/.test(weekly[0].title) && !/opens now/i.test(weekly[0].title), 'fired at 11:59, the title says WHEN the week opens ("' + weekly[0].title + '") — not that it has');
    t.ok(!/are available/i.test(weekly[0].body) && /noon/i.test(weekly[0].body), '…and the body no longer claims the classes are available a minute early');
    t.ok(!/in a minute/i.test(weekly[0].title + weekly[0].body), '…nor anything that goes stale when the banner is read later');

    const tabs = t.readSource('js/tabs.js');
    t.ok(!/Enable notifications for Psycle /.test(tabs), 'no toast sends the member to iOS Settings to find "Psycle" — that is the official app');
    t.eq((tabs.match(/Enable notifications for Psync in iOS Settings first/g) || []).length, 3, '…all three say Psync');
    t.ok(/11:59 UK — a minute before the new booking week opens/.test(tabs), 'the Settings row says the reminder comes a minute BEFORE the week opens');

    const plist = t.readSource('ios-app/ios/App/App/Info.plist');
    t.ok(!/Psycle Finder/.test(plist), 'the calendar permission prompt no longer names an app ("Psycle Finder") that appears nowhere else');
    t.eq((plist.match(/<string>Psync keeps the calendar you choose in step/g) || []).length, 2, '…both usage descriptions name Psync and the owned-calendar behaviour');
    t.ok(!/<string>[^<]*[&<>][^<]*<\/string>/.test(plist.slice(plist.indexOf('NSCalendarsFullAccessUsageDescription'), plist.indexOf('NSSupportsLiveActivities'))), '…with nothing XML would choke on');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS polish: the pull-to-refresh pill hides above the safe area (R2-1)');
  {
    // The SHIPPED resetPullIndicator (sliced out of the interactions.js IIFE),
    // against an element whose style behaves like the CSSOM: a value the
    // engine cannot parse is dropped and the previous one stays.
    const src = t.readSource('js/interactions.js');
    const from = src.indexOf('  function resetPullIndicator() {');
    const to = src.indexOf('  function showRefreshing() {');
    t.ok(from !== -1 && to > from, 'resetPullIndicator found in interactions.js');
    const run = (supportsEnv) => {
      const style = { _t: 'translateX(-50%) translateY(10px)', opacity: '1' };
      Object.defineProperty(style, 'transform', {
        get() { return this._t; },
        set(v) { if (supportsEnv || !/env\(/.test(v)) this._t = v; },
      });
      const ctx = { pullIndicator: { style, classList: { remove() {} } } };
      t.vm.createContext(ctx);
      t.vm.runInContext(src.slice(from, to) + '\nresetPullIndicator();', ctx, { filename: 'interactions.js[reset-pull]' });
      return style;
    };
    const modern = run(true);
    t.ok(/translateY\(calc\(-50px - env\(safe-area-inset-top, 0px\)\)\)/.test(modern.transform), 'hidden = 50px PLUS the top inset, so the fading pill is never parked beside the Dynamic Island');
    t.ok(/^translateX\(-50%\) /.test(modern.transform), '…still centred');
    t.eq(modern.opacity, '0', '…and faded out');
    const old = run(false);
    t.eq(old.transform, 'translateX(-50%) translateY(-50px)', 'an engine without env() keeps today\'s hidden position instead of leaving the pill where it was');
    t.eq(old.opacity, '0', '…and still fades');

    const show = src.slice(to, src.indexOf('  function pullRefreshAction() {'));
    t.ok(/translateY\(10px\)/.test(show) && !/env\(/.test(show), '"Refreshing..." stays 10px below the pill\'s `top` — the CSS `top` carries the inset, so the two never double up');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS polish: the Live Activity shows the seats held NOW (R2-31, Swift source contract)');
  // Swift cannot run here (the change was compiled for the simulator — app +
  // widget extension — when it was made). These pin the three edits that only
  // work TOGETHER: lose the view edit in a merge and everything still compiles,
  // while the card silently goes back to the seats it started with.
  {
    const dir = 'ios-app/ios/App/PsycleLiveActivity/';
    const attrs = t.readSource(dir + 'PsycleLiveActivityAttributes.swift');
    const state = attrs.slice(attrs.indexOf('public struct ContentState'), attrs.indexOf('// Static attributes'));
    t.ok(/public var slotSummary: String\?/.test(state), 'ContentState carries slotSummary — OPTIONAL, so a card started by the previous build still decodes');
    t.ok(/init\(startAt: Date, status: String, slotSummary: String\? = nil\)/.test(state), '…with a defaulted init parameter (no other call site has to change)');
    t.ok(/public let slotSummary: String\?/.test(attrs.slice(attrs.indexOf('// Static attributes'))), 'the static attribute stays, as the fallback');

    const ctrl = t.readSource(dir + 'PsycleLiveActivityController.swift');
    t.ok(/ContentState\(\s*startAt: start,\s*status: "Starting soon",\s*slotSummary: next\.slotSummary\s*\)/.test(ctrl), 'refreshFromSnapshot puts the snapshot\'s current seats into the state the same-event update() pushes');

    const view = t.readSource(dir + 'PsycleLiveActivityView.swift');
    t.eq((view.match(/context\.state\.slotSummary \?\? /g) || []).length, 2, 'BOTH subtitle builders (Dynamic Island + Lock Screen) read the state first, then the attributes');
    t.ok(!/if let slot = (a|context\.attributes)\.slotSummary \{/.test(view), '…and neither still reads the attributes alone');
    t.ok(/Text\(subtitle\(context\)\)/.test(view), 'the Dynamic Island helper is handed the context, not just the attributes');
  }
};
