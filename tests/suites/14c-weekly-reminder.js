'use strict';
// Wave 13c — the Monday reminder, pointed at the usual week.
//
//   A. WHEN it fires and WHAT it says      (ios-app/www/native-bridge.js, pure:weekly-reminder)
//   B. the shipped bridge, wired           (a fake Capacitor; hand-advanced clock; nothing native)
//   C. WHICH dates a release opens         (js/app.js, pure:week-opened)
//   D. where the tap goes                  (js/app.js window._onBookingWeekOpened, sliced from shipped source)
//
// The Discover route's patience rules (launch not done, a booking in progress,
// the 15s give-up by the clock) are held in tests/suites/discover-journeys.js,
// which owns that slice; D here is the usual-week REVIEW route. Nothing in this
// file can reach a network: every plugin, timer and fetch-free function is a fake.

module.exports = async function (t) {
  const BRIDGE = 'ios-app/www/native-bridge.js';
  const BRIDGE_SRC = t.readSource(BRIDGE);
  const appSrc = t.readSource('js/app.js');
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const utc = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0);
  const iso = (d) => new Date(d).toISOString();
  const G = t.loadPure('js/app.js', 'gym-time'); // the London resolver (held to the bridge's own by tests/suites/bookings-card.js)

  const TITLE = 'New Psycle dates are open';
  const BODY_WEEK = 'Book your usual week for the dates that just opened.';
  const BODY_FIND = 'Find your classes for the dates that just opened.';
  const WEEK = JSON.stringify([{ dayOfWeek: 1, hour: 7, minute: 0, locationId: 3, eventTypeId: 9, instructorId: 4, label: 'Ride · Alex' }]);

  // ════════════════════════════════════════════════════════════════════
  t.section('Monday reminder: it fires at 12:00 London — the release itself — wherever the phone is');
  {
    const p = t.loadPure(BRIDGE, 'weekly-reminder');
    const mondays = (now, n) => p._nextMondaysNoonLondon(n || 8, now, G._gymWallToUtcMs).map(iso);
    const inLondon = (d) => {
      const parts = {};
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(d)).forEach((x) => { parts[x.type] = x.value; });
      return parts.weekday + ' ' + parts.hour + ':' + parts.minute;
    };

    // Thursday 17 September 2026 — eight weeks that cross the end of BST (25 October).
    const autumn = mondays(utc(2026, 9, 17, 9));
    t.eq(autumn, ['2026-09-21T11:00:00.000Z', '2026-09-28T11:00:00.000Z', '2026-10-05T11:00:00.000Z', '2026-10-12T11:00:00.000Z',
      '2026-10-19T11:00:00.000Z', '2026-10-26T12:00:00.000Z', '2026-11-02T12:00:00.000Z', '2026-11-09T12:00:00.000Z'],
    'the next 8 Mondays, 12:00 London: 11:00 UTC while BST lasts, 12:00 UTC once the clocks have gone back');
    t.eq(autumn.map(inLondon).filter((x) => x !== 'Mon 12:00'), [], '…every one of them reads "Mon 12:00" on a London clock (it was 11:59 until September 2026)');
    t.eq(mondays(utc(2026, 3, 20, 9), 2), ['2026-03-23T12:00:00.000Z', '2026-03-30T11:00:00.000Z'], 'and into BST in spring: the GMT Monday, then the first BST one an hour earlier in UTC');

    t.eq(mondays(utc(2026, 9, 21, 10, 30), 1), ['2026-09-21T11:00:00.000Z'], 'on the Monday itself before noon: today\'s');
    t.eq(mondays(utc(2026, 9, 21, 11, 0, 0), 1), ['2026-09-28T11:00:00.000Z'], 'at noon (and after): next Monday\'s — never an instant that is already past');
    t.eq(mondays(utc(2026, 9, 21, 10, 59, 30), 1), ['2026-09-28T11:00:00.000Z'], 'under a minute away: left to next week (iOS refuses a fire date that has gone by the time it is scheduled)');
    // A member in Sydney on their Monday morning: it is still Sunday in UTC.
    t.eq(mondays(utc(2026, 9, 20, 23, 30), 1), ['2026-09-21T11:00:00.000Z'], 'London\'s Monday when the UTC date still says Sunday: that same Monday noon');
    t.eq(mondays(utc(2026, 12, 28, 13), 2), ['2027-01-04T12:00:00.000Z', '2027-01-11T12:00:00.000Z'], 'across a year end');

    const NOW = utc(2026, 9, 17, 9);
    const blind = p._nextMondaysNoonLondon(8, NOW, () => { throw new Error('no Europe/London data'); });
    t.eq(blind.map(iso), [iso(NOW + 7 * 86400000)], 'no London zone data in the engine: ONE defensive instant a week on — never an empty schedule, never a throw');
    t.eq([p.WEEKLY_REMINDER_HOUR, p.WEEKLY_REMINDER_MINUTE], [12, 0], 'the hour is a named constant: 12:00');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Monday reminder: the copy says what the tap opens');
  {
    const p = t.loadPure(BRIDGE, 'weekly-reminder');
    t.eq([p._weeklyReminderCopy(true), p._weeklyReminderCopy(false)], [{ title: TITLE, body: BODY_WEEK }, { title: TITLE, body: BODY_FIND }],
      'one title; the body names the usual week only when one is saved');
    const all = [TITLE, BODY_WEEK, BODY_FIND].join(' ');
    t.ok(!/!/.test(all), 'no exclamation mark');
    t.ok(!/\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(all) && !/noon|opens at|get ready/i.test(all), 'no 12-hour time, and nothing left of the minute-early wording ("opens at 12:00 … get ready")');
    t.ok(!/booked|we.ll book|books/i.test(all), 'it never says anything IS or WILL BE booked — the tap opens a review');

    t.eq([p._hasUsualWeek(WEEK), p._hasUsualWeek('[]'), p._hasUsualWeek(null), p._hasUsualWeek(''), p._hasUsualWeek('{"0":1}'), p._hasUsualWeek('"week"'), p._hasUsualWeek('[oops')],
      [true, false, false, false, false, false, false], 'a usual week is a non-empty stored ARRAY — the string is untrusted (an import, the Preferences mirror)');
    t.eq([p._weeklyTapTab(true), p._weeklyTapTab(false)], ['bookings', 'discover'], 'the tap lands on My Bookings with a usual week (its review lives there), else on Discover');

    const ask = (f) => p._weeklyOfferDecision(f);
    t.eq(ask({ hasUsualWeek: true, asked: false, pref: null, permission: 'prompt' }), 'ask', 'the offer: a usual week, never asked, the switch never touched, iOS would still allow it');
    t.eq(ask({ hasUsualWeek: true, asked: false, pref: null }), 'ask', '…an unread permission rules nothing out');
    t.eq(ask({ hasUsualWeek: true, asked: false, pref: null, permission: 'granted' }), 'ask', '…and notifications already allowed still needs the question: this reminder defaults OFF');
    t.eq([ask({ hasUsualWeek: false, pref: null }), ask({ hasUsualWeek: true, asked: true, pref: null }), ask({ hasUsualWeek: true, pref: 'on' }),
      ask({ hasUsualWeek: true, pref: 'off' }), ask({ hasUsualWeek: true, pref: null, permission: 'denied' }), ask(null)],
    ['skip', 'skip', 'skip', 'skip', 'skip', 'skip'],
    'never: no usual week · already answered · already on · switched off by hand (that IS an answer) · iOS has said no (the question would lead nowhere) · no facts');
  }

  // ════════════════════════════════════════════════════════════════════
  // B. The shipped bridge against a fake Capacitor.
  function makeClock() {
    let now = utc(2026, 9, 17, 9); // Thursday
    let seq = 0;
    const timers = new Map();
    return {
      now: () => now,
      setTimeout(fn, ms) { const id = ++seq; timers.set(id, { id, at: now + (Number(ms) || 0), fn }); return id; },
      clearTimeout(id) { timers.delete(id); },
      skip(ms) { now += ms; }, // a suspended app: the clock moves, no timer runs
      async advance(ms) {
        const end = now + ms;
        for (;;) {
          await flush();
          let next = null;
          for (const tm of timers.values()) {
            if (tm.at <= end && (!next || tm.at < next.at || (tm.at === next.at && tm.id < next.id))) next = tm;
          }
          if (!next) break;
          timers.delete(next.id);
          now = Math.max(now, next.at);
          next.fn();
        }
        now = end;
        await flush();
      },
    };
  }

  /** opts: local {key:value} · perm 'prompt'|'granted'|'denied' · deny (the iOS prompt is refused) · hooks (window globals) */
  function boot(opts) {
    opts = opts || {};
    const clock = makeClock();
    const ls = t.makeFakeLocalStorage();
    Object.keys(opts.local || {}).forEach((k) => ls.setItem(k, opts.local[k]));
    const calls = { scheduled: [], cancelled: [], requested: 0, switchTab: [], toasts: [], modals: [], rowRenders: 0, prefSet: [], actions: [] };
    const state = { perm: opts.perm || 'granted' };
    const dom = { ids: new Set(), visibility: 'visible' };
    const listeners = {};
    const handlers = {};
    const plugins = {
      Preferences: {
        get: () => Promise.resolve({ value: null }),
        set(o) { calls.prefSet.push(o.key); return Promise.resolve(); },
        remove() { return Promise.resolve(); },
      },
      LocalNotifications: {
        checkPermissions: () => Promise.resolve({ display: state.perm }),
        requestPermissions() { calls.requested++; if (state.perm !== 'granted') state.perm = opts.deny ? 'denied' : 'granted'; return Promise.resolve({ display: state.perm }); },
        registerActionTypes: () => Promise.resolve(),
        addListener(name, fn) { listeners[name] = fn; },
        schedule(o) { calls.scheduled.push(o); return Promise.resolve(); },
        cancel(o) { calls.cancelled.push(o); return Promise.resolve(); },
      },
    };
    const ctx = Object.assign({
      console: { log() {}, warn() {}, error() {} },
      localStorage: ls,
      navigator: { onLine: true },
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, __now: clock.now,
      Capacitor: { Plugins: plugins, isNativePlatform: () => true },
      PsycleEvents: {
        on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return () => {}; },
        emit(evt, ...args) { (handlers[evt] || []).slice().forEach((fn) => fn(...args)); },
      },
      _eventCache: {}, _myBookings: {},
      APP_THEMES: [{ id: 'graphite', base: 'dark' }],
      matchMedia: () => ({ matches: false }),
      MutationObserver: function () { this.observe = function () {}; },
      document: {
        documentElement: { getAttribute: () => 'graphite' },
        getElementById: (id) => (dom.ids.has(id) ? { id, style: {} } : null),
        querySelector: () => null,
        addEventListener() {},
        get visibilityState() { return dom.visibility; },
      },
      switchTab(tab) { calls.switchTab.push(tab); },
      openClassDetail() {},
      toast(msg, kind) { calls.toasts.push([msg, kind]); },
      renderReminderRow() { calls.rowRenders++; },
      pushAction(a) { calls.actions.push(a); },
      confirmModal(o) {
        return new Promise((resolve) => {
          calls.modals.push({ opts: o, answer: resolve, replace() { if (typeof o.onReplaced === 'function') o.onReplaced(); resolve(false); } });
        });
      },
      _psycleNativeRestoreResolve() {},
    }, opts.hooks || {});
    ctx.window = ctx;
    ctx.self = ctx;
    t.vm.createContext(ctx);
    t.vm.runInContext('Date.now = __now;', ctx);
    t.vm.runInContext(BRIDGE_SRC, ctx, { filename: 'native-bridge.js[14c]' });
    const weekly = (o) => o.notifications.filter((n) => n.id >= 9992 && n.id <= 9999);
    return {
      ctx, clock, ls, calls, state, dom,
      emit(evt, ...args) { ctx.PsycleEvents.emit(evt, ...args); },
      tap(extra) { listeners.localNotificationActionPerformed({ actionId: 'tap', notification: { title: 'T', body: 'B', extra: extra } }); },
      // Every weekly batch scheduled so far, as its body sentence.
      bodies() { return calls.scheduled.map(weekly).filter((list) => list.length).map((list) => list[0].body); },
      lastWeekly() { const all = calls.scheduled.map(weekly).filter((list) => list.length); return all[all.length - 1] || []; },
    };
  }
  // app.js's two storage calls, as the bridge finds them on window.
  const templateHooks = (seen) => ({
    saveWeeklyTemplate(arr, extra) { seen.push(['save', arr.length, extra]); this.localStorage.setItem('psycle_weekly_template', JSON.stringify(arr)); return 'saved'; },
    clearWeeklyTemplate() { seen.push(['clear']); this.localStorage.removeItem('psycle_weekly_template'); return 'cleared'; },
  });

  t.section('Monday reminder (wired): eight rolling one-shots, re-armed at launch, idempotent');
  {
    const b = boot({ local: { psycle_weekly_reminder: 'on' } });
    t.eq(b.calls.scheduled.length, 0, 'nothing is scheduled while the app is still launching');
    await b.clock.advance(3000);
    const list = b.lastWeekly();
    t.eq(list.map((n) => n.id), [9999, 9998, 9997, 9996, 9995, 9994, 9993, 9992], 'REMINDER_IDS are unchanged — a build that armed 11:59 reminders has them REPLACED, not doubled');
    t.eq(b.calls.cancelled[0].notifications.map((n) => n.id), [9999, 9998, 9997, 9996, 9995, 9994, 9993, 9992], '…and the pass cancels those eight first');
    t.eq(list.map((n) => iso(n.schedule.at)).slice(0, 2), ['2026-09-21T11:00:00.000Z', '2026-09-28T11:00:00.000Z'], 'absolute instants through the bridge\'s OWN London resolver: Monday 12:00 London');
    t.eq([list[0].title, list[0].body, list.every((n) => n.schedule.allowWhileIdle === true)], [TITLE, BODY_FIND, true], 'no usual week saved: "Find your classes…"');
    t.eq(b.calls.requested, 0, 'a launch-time pass never shows the iOS permission prompt');

    const withWeek = boot({ local: { psycle_weekly_reminder: 'on', psycle_weekly_template: WEEK } });
    await withWeek.clock.advance(3000);
    t.eq(withWeek.lastWeekly()[0].body, BODY_WEEK, 'a usual week saved: "Book your usual week…"');

    const off = boot({ local: { psycle_weekly_template: WEEK } });
    await off.clock.advance(60000);
    t.eq([off.calls.scheduled.length, off.calls.requested], [0, 0], 'never switched on: nothing is ever scheduled or asked of iOS at launch, usual week or not');

    const noPerm = boot({ perm: 'prompt', local: { psycle_weekly_reminder: 'on' } });
    await noPerm.clock.advance(3000);
    t.eq([noPerm.calls.scheduled.length, noPerm.calls.requested], [0, 0], 'on, but iOS permission gone: silently nothing — the prompt only ever follows a deliberate tap');
  }

  t.section('Monday reminder (wired): the body follows the usual week being saved or cleared');
  {
    const seen = [];
    const b = boot({ local: { psycle_weekly_reminder: 'on' }, hooks: templateHooks(seen) });
    await b.clock.advance(3000);
    t.eq(b.bodies(), [BODY_FIND], '(launch: no usual week yet)');
    const ret = b.ctx.saveWeeklyTemplate([{ dayOfWeek: 1 }], 'second-arg');
    await flush(); await flush();
    t.eq([ret, seen], ['saved', [['save', 1, 'second-arg']]], 'the wrapper runs app.js\'s own save, forwarding every argument and the result');
    t.eq(b.bodies(), [BODY_FIND, BODY_WEEK], 'a usual week saved: the eight are re-armed with "Book your usual week…"');
    b.ctx.saveWeeklyTemplate([{ dayOfWeek: 1 }, { dayOfWeek: 3 }]);
    await flush(); await flush();
    t.eq(b.bodies().length, 2, 'saved again (Update from my bookings, a class removed): the sentence is the same, so nothing is re-armed');
    t.eq(b.ctx.clearWeeklyTemplate(), 'cleared', 'Clear goes through too');
    await flush(); await flush();
    t.eq(b.bodies(), [BODY_FIND, BODY_WEEK, BODY_FIND], '…and the reminder goes back to "Find your classes…"');
    t.eq(b.calls.requested, 0, 'a re-arm never shows the iOS permission prompt');

    // Two changes in one tick: what is armed afterwards is what is TRUE afterwards.
    b.ctx.saveWeeklyTemplate([{ dayOfWeek: 2 }]);
    b.ctx.clearWeeklyTemplate();
    await flush(); await flush(); await flush();
    t.eq(b.lastWeekly()[0].body, BODY_FIND, 'saved and cleared a moment apart: the armed sentence matches the stored week (passes are serialized, and read the week when they schedule)');

    const offSeen = [];
    const off = boot({ hooks: templateHooks(offSeen) });
    await off.clock.advance(3000);
    off.ctx.saveWeeklyTemplate([{ dayOfWeek: 1 }]);
    await flush(); await flush();
    t.eq([offSeen.length, off.calls.scheduled.length, off.calls.requested], [1, 0, 0], 'reminder off: a save is just a save — nothing scheduled, nothing asked');

    const sw = boot({ local: { psycle_weekly_reminder: 'on' } });
    await sw.clock.advance(3000);
    sw.ls.setItem('psycle_weekly_template', WEEK); // an account switch restores the other member's stashed week
    sw.emit('data:owner-changed', { from: '1', to: '2' });
    await flush(); await flush();
    t.eq(sw.bodies(), [BODY_FIND, BODY_WEEK], 'an account switch that brings a usual week with it re-arms too');

    const bare = boot({ local: { psycle_weekly_reminder: 'on' } }); // an app.js without the two functions
    await bare.clock.advance(3000);
    t.eq([typeof bare.ctx.saveWeeklyTemplate, typeof bare.ctx.clearWeeklyTemplate], ['undefined', 'undefined'], 'nothing to wrap: nothing invented on window');
  }

  t.section('Monday reminder (wired): the tap lands where the body said it would');
  {
    const seen = [];
    const find = boot({ hooks: { _onBookingWeekOpened() { seen.push('hook'); } } });
    find.tap(undefined);
    t.eq([find.calls.switchTab, seen], [['discover'], ['hook']], 'no usual week: Discover, then app.js\'s hook');
    seen.length = 0;
    const week = boot({ local: { psycle_weekly_template: WEEK }, hooks: { _onBookingWeekOpened() { seen.push('hook'); } } });
    week.tap({});
    t.eq([week.calls.switchTab, seen], [['bookings'], ['hook']], 'a usual week saved: My Bookings, then the SAME hook — which opens the review, and only that');
    const junk = boot({ local: { psycle_weekly_template: '{"not":"a list"}' } });
    junk.tap(undefined);
    t.eq(junk.calls.switchTab, ['discover'], 'a stored value that is not a list of classes reads as no usual week');
    const src = BRIDGE_SRC.replace(/\/\/[^\n]*/g, '');
    t.ok(!/\b(bookWeeklyTemplate|bookTemplateWeek|submitBooking|bookClass)\s*\(/.test(src), 'the bridge itself never opens the sheet or books anything: the web layer owns every booking rule');
  }

  t.section('Monday reminder (wired): offered once, in the app, right after a usual week is saved');
  {
    const web = { window: null, console: { log() {}, warn() {}, error() {} } };
    web.window = web;
    t.vm.createContext(web);
    t.vm.runInContext(BRIDGE_SRC, web, { filename: 'native-bridge.js[no Capacitor]' });
    t.eq(typeof web._offerWeeklyReminder, 'undefined', 'on the web (no Capacitor) the offer does not exist — no reminder UI appears where it cannot work');
    const tabs = t.readSource('js/tabs.js');
    t.eq((tabs.match(/_offerWeeklyReminder/g) || []).length, 4, 'js/tabs.js mentions it on TWO lines, each the typeof guard and the call');
    const save = tabs.slice(tabs.indexOf('window.saveWeekAsTemplate = async function'), tabs.indexOf('window.clearUsualWeek = async function'));
    t.ok(/window\.saveWeeklyTemplate\(entries\);[\s\S]*renderUsualWeekCard\(\);[\s\S]*if \(typeof window\._offerWeeklyReminder === 'function'\) window\._offerWeeklyReminder\('usual-week-saved'\);[\s\S]*\} catch \(e\) \{/.test(save),
      '…inside "Save my usual week", AFTER the save went through, behind a typeof guard');
    // …and when the review sheet CLOSES: a usual week saved by an earlier build never meets "Save" again.
    const review = tabs.slice(tabs.indexOf('window.bookTemplateWeek = async function'), tabs.indexOf('function _statsTile('));
    t.ok(/await _runUsualWeekSheet\(\{ range: range \}\);\n(\s*\/\/[^\n]*\n)*\s*if \(typeof window\._offerWeeklyReminder === 'function'\) window\._offerWeeklyReminder\('usual-week-reviewed'\);\n\s*\} catch \(e\) \{/.test(review),
      '…and in bookTemplateWeek, only AFTER the sheet it awaited has closed — never on the "save your usual week first" / "sign in again" ways out, behind the same guard');
  }
  {
    // A usual week saved by the PREVIOUS build, the reminder never offered: the member reviews (and books) their week.
    const b = boot({ perm: 'prompt', local: { psycle_weekly_template: WEEK } });
    await b.clock.advance(60000);
    b.dom.ids.add('usualWeekSheet'); // "Review and book" … the sheet is up for a while …
    await b.clock.advance(90000);
    t.eq(b.calls.modals.length, 0, 'an existing usual week, never asked: nothing at launch, nothing while the review sheet is up');
    b.dom.ids.delete('usualWeekSheet'); // … and closes: js/tabs.js offers it
    b.ctx._offerWeeklyReminder('usual-week-reviewed');
    await b.clock.advance(3000);
    t.eq([b.calls.modals.length, b.calls.modals[0] && b.calls.modals[0].opts.confirmText], [1, 'Remind me'], 'the sheet closes → the ask appears, once the UI has stayed clear');
    b.calls.modals[0].answer(true);
    await flush(); await flush();
    t.eq([b.ls.getItem('psycle_weekly_reminder'), b.lastWeekly().length, b.calls.actions], ['on', 8, ['weekly-reminder:offer yes after=usual-week-reviewed']], 'yes → on, the eight Mondays armed, one action-log line naming where it was offered');
    b.ctx._offerWeeklyReminder('usual-week-reviewed');
    await b.clock.advance(5000);
    t.eq(b.calls.modals.length, 1, 'once: the next review does not ask again');
  }
  {
    // Saved, then straight into a review that outlasts the give-up clock: the offer made at the save would have
    // given up (no answer recorded) a moment before the sheet closed — and only another save asked again.
    const b = boot({ perm: 'prompt', local: { psycle_weekly_template: WEEK } });
    b.ctx._offerWeeklyReminder('usual-week-saved');
    b.dom.ids.add('usualWeekSheet');
    await b.clock.advance(39000); // still waiting its turn
    b.dom.ids.delete('usualWeekSheet');
    b.ctx._offerWeeklyReminder('usual-week-reviewed'); // the sheet closed: offered again while the first still waits
    await b.clock.advance(3000); // past 40s since the save
    t.eq(b.calls.modals.length, 1, 'offered again while the first ask still waits: the clock starts over — ONE ask, and it is not lost to the give-up');
    const late = boot({ perm: 'prompt', local: { psycle_weekly_template: WEEK } });
    late.ctx._offerWeeklyReminder('usual-week-saved');
    late.dom.ids.add('usualWeekSheet');
    await late.clock.advance(120000); // a long review: the first offer has given up
    late.dom.ids.delete('usualWeekSheet');
    late.ctx._offerWeeklyReminder('usual-week-reviewed');
    await late.clock.advance(3000);
    t.eq([late.calls.modals.length, late.ls.getItem('psycle_weekly_reminder_asked')], [1, null], '…and after a review longer than that, the offer at its close asks afresh');
  }
  {
    const b = boot({ perm: 'prompt', local: { psycle_weekly_template: WEEK } });
    await b.clock.advance(60000);
    t.eq([b.calls.modals.length, b.calls.requested], [0, 0], 'nothing is asked at launch, however long the app sits there');
    b.ctx._offerWeeklyReminder('usual-week-saved');
    b.ctx._offerWeeklyReminder('usual-week-saved'); // a double tap on Save
    await b.clock.advance(1000);
    t.eq(b.calls.modals.length, 0, 'not in the first clear moment (the "Replace your usual week?" confirm has only just closed)');
    await b.clock.advance(1000);
    t.eq(b.calls.modals.length, 1, 'asked once the UI has stayed clear — once, however many times Save was tapped');
    const m = b.calls.modals[0].opts;
    t.eq([m.title, m.confirmText, m.cancelText], ['Remind you on Mondays at 12:00, when new dates open?', 'Remind me', 'Not now'], 'the question, with "Not now" (confirmModal defaults to "Keep booking")');
    t.ok(/Nothing is booked until you confirm\./.test(m.body) && !/!/.test(m.title + m.body), 'the body says what a tap on the reminder does — a review, nothing booked — with no exclamation mark');
    t.eq([b.calls.requested, b.ls.getItem('psycle_weekly_reminder_asked')], [0, null], 'the iOS prompt waits for an in-app yes, and nothing is remembered until there is an answer');

    b.calls.modals[0].answer(true);
    await flush(); await flush();
    t.eq([b.calls.requested, b.ls.getItem('psycle_weekly_reminder'), b.ls.getItem('psycle_weekly_reminder_asked')], [1, 'on', '1'], 'yes → the iOS permission prompt, the reminder on, the answer remembered');
    t.eq([b.lastWeekly().length, b.lastWeekly()[0].body], [8, BODY_WEEK], '…and the eight Mondays armed, with the usual-week sentence');
    t.eq(b.calls.toasts, [['Monday reminder on', 'success']], 'the same toast the Settings switch gives');
    t.ok(b.calls.rowRenders >= 1 && b.calls.prefSet.includes('psycle_weekly_reminder_asked'), 'the Settings switch is repainted, and the answer is mirrored to Preferences (a storage purge must not ask again)');
    t.eq(b.calls.actions, ['weekly-reminder:offer yes after=usual-week-saved'], 'one action-log line: a name, no free text');
    b.ctx._offerWeeklyReminder('usual-week-saved');
    await b.clock.advance(5000);
    t.eq(b.calls.modals.length, 1, 'never again after an answer');
  }
  {
    const b = boot({ perm: 'prompt', local: { psycle_weekly_template: WEEK } });
    b.ctx._offerWeeklyReminder('usual-week-saved');
    await b.clock.advance(3000);
    b.calls.modals[0].answer(false);
    await flush(); await flush();
    t.eq([b.calls.requested, b.calls.scheduled.length, b.ls.getItem('psycle_weekly_reminder'), b.ls.getItem('psycle_weekly_reminder_asked')], [0, 0, null, '1'],
      '"Not now": it stays off, iOS is never asked, nothing is scheduled — and that IS an answer');
    b.ctx._offerWeeklyReminder('usual-week-saved');
    await b.clock.advance(5000);
    t.eq(b.calls.modals.length, 1, '…so a later save does not ask again (the Settings row is the place to change it)');
  }
  {
    const b = boot({ perm: 'prompt', deny: true, local: { psycle_weekly_template: WEEK } });
    b.ctx._offerWeeklyReminder('usual-week-saved');
    await b.clock.advance(3000);
    b.calls.modals[0].answer(true);
    await flush(); await flush();
    t.eq([b.ls.getItem('psycle_weekly_reminder'), b.calls.scheduled.length, b.calls.toasts], [null, 0, [['Enable notifications for Psync in iOS Settings first', 'error']]],
      'yes in the app, "Don\'t Allow" on the iOS prompt: not on, nothing armed, and the member is told where to fix it');
  }
  {
    // Any open dialog holds it back — the usual-week sheet above all.
    const b = boot({ perm: 'prompt', local: { psycle_weekly_template: WEEK } });
    b.dom.ids.add('usualWeekSheet');
    b.ctx._offerWeeklyReminder('usual-week-saved');
    await b.clock.advance(10000);
    t.eq(b.calls.modals.length, 0, 'not while the usual-week sheet is up (a run inside it spends credits)');
    b.dom.ids.delete('usualWeekSheet');
    b.dom.ids.add('psycleConfirmOverlay');
    await b.clock.advance(5000);
    t.eq(b.calls.modals.length, 0, '…nor over a confirm dialog (confirmModal is single-instance: ours would cancel it)');
    b.dom.ids.delete('psycleConfirmOverlay');
    await b.clock.advance(2000);
    t.eq(b.calls.modals.length, 1, 'once everything has been closed for two polls running, it asks');
    b.calls.modals[0].replace(); // another dialog displaced it
    await flush(); await flush();
    t.eq([b.ls.getItem('psycle_weekly_reminder_asked'), b.calls.requested], [null, 0], 'a displaced dialog is not an answer');
    b.ctx._offerWeeklyReminder('usual-week-saved');
    await b.clock.advance(3000);
    t.eq(b.calls.modals.length, 2, '…so the next save asks again');
  }
  {
    const b = boot({ perm: 'prompt', local: { psycle_weekly_template: WEEK } });
    b.dom.ids.add('classDetailOverlay');
    b.ctx._offerWeeklyReminder('usual-week-saved');
    await b.clock.advance(5000);
    b.clock.skip(3600000); // the phone was locked for an hour
    b.dom.ids.delete('classDetailOverlay');
    await b.clock.advance(5000);
    t.eq([b.calls.modals.length, b.ls.getItem('psycle_weekly_reminder_asked')], [0, null], 'long after the save the moment has passed: it gives up BY THE CLOCK, without recording an answer');

    const hidden = boot({ perm: 'prompt', local: { psycle_weekly_template: WEEK } });
    hidden.ctx._offerWeeklyReminder('usual-week-saved');
    hidden.dom.visibility = 'hidden';
    await hidden.clock.advance(5000);
    t.eq(hidden.calls.modals.length, 0, 'never into a backgrounded app');
  }
  {
    const never = async (o, why) => {
      const b = boot(o);
      b.ctx._offerWeeklyReminder('usual-week-saved');
      await b.clock.advance(5000);
      t.eq([b.calls.modals.length, b.ls.getItem('psycle_weekly_reminder_asked')], [0, null], why);
    };
    await never({ perm: 'prompt' }, 'no usual week saved (the save failed, or was the history fallback finding nothing): no question');
    await never({ perm: 'granted', local: { psycle_weekly_template: WEEK, psycle_weekly_reminder: 'on' } }, 'already on: no question');
    await never({ perm: 'granted', local: { psycle_weekly_template: WEEK, psycle_weekly_reminder: 'off' } }, 'switched off by hand in Settings: that was the answer');
    await never({ perm: 'denied', local: { psycle_weekly_template: WEEK } }, 'iOS has already said no: the question would lead nowhere — and is not recorded as answered');

    const granted = boot({ perm: 'granted', local: { psycle_weekly_template: WEEK } });
    granted.ctx._offerWeeklyReminder('usual-week-saved');
    await granted.clock.advance(3000);
    t.eq(granted.calls.modals.length, 1, 'notifications already allowed (class reminders): still asked — this reminder defaults off');
    granted.calls.modals[0].answer(true);
    await flush(); await flush();
    t.eq([granted.ls.getItem('psycle_weekly_reminder'), granted.lastWeekly().length], ['on', 8], '…and a yes arms it');

    const odd = boot({ perm: 'prompt', local: { psycle_weekly_template: WEEK } });
    odd.ctx._offerWeeklyReminder('<img src=x onerror=1> a very long reason that goes on and on and on');
    await odd.clock.advance(3000);
    odd.calls.modals[0].answer(false);
    await flush(); await flush();
    t.ok(/^weekly-reminder:offer no after=[A-Za-z0-9-]{0,32}$/.test(odd.calls.actions[0]), 'whatever a caller passes as the reason, the action log gets a bounded slug (it goes into bug reports): "' + odd.calls.actions[0] + '"');
  }
  {
    // The first-booking ask shares the waiting rule — and "Book my usual week"
    // emits booking:complete once per seat, with the sheet still up.
    const b = boot({ perm: 'prompt' });
    b.dom.ids.add('usualWeekSheet');
    b.emit('booking:complete', '5', [12]);
    await b.clock.advance(10000);
    t.eq(b.calls.modals.length, 0, 'the class-reminder ask no longer opens over a usual-week run either');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Reminder tap: which dates a Monday release opened (observed model, advisory only)');
  {
    const p = t.loadPure('js/app.js', 'week-opened');
    const W = t.loadPure('js/app.js', 'window', { _gymWallToUtcMs: G._gymWallToUtcMs });
    const dow = (ds) => new Date(ds + 'T00:00:00Z').getUTCDay();
    // COMMON.md, 2026-09-19: "14 Sept opened Fri 2 → Thu 8 Oct; 21 Sept will open Fri 9 → Thu 15 Oct".
    t.eq(p._openedBatch(null, utc(2026, 9, 14, 11)), { from: '2026-10-02', to: '2026-10-08' }, 'the 14 September release opened Fri 2 → Thu 8 October');
    t.eq(p._openedBatch(null, utc(2026, 9, 21, 11)), { from: '2026-10-09', to: '2026-10-15' }, 'the 21 September release: Fri 9 → Thu 15 October');
    t.eq(p._openedBatch(null, W._lastReleaseMs(utc(2026, 9, 19, 15))), { from: '2026-10-02', to: '2026-10-08' }, 'on Saturday 19 September the newest batch is still the 14th\'s (through pure:window\'s _lastReleaseMs)');
    const winter = p._openedBatch(null, utc(2026, 1, 5, 12)); // GMT: the release is 12:00 UTC
    t.eq([winter, dow(winter.from), dow(winter.to)], [{ from: '2026-01-23', to: '2026-01-29' }, 5, 4], 'in winter too (the release is 12:00 UTC then): a Friday to a Thursday');
    t.eq(p._openedBatch(null, utc(2026, 12, 14, 12)), { from: '2027-01-01', to: '2027-01-07' }, 'across a year end');

    t.eq(p._openedBatch({ openThrough: '2026-10-22' }, utc(2026, 9, 21, 11)), { from: '2026-10-16', to: '2026-10-22' },
      'window._bookingHorizon owns the model where it exists: its openThrough is the batch\'s last day, and it WINS over the stand-in numbers');
    t.eq([p._openedBatch({ openThrough: 'soon' }, utc(2026, 9, 21, 11)), p._openedBatch({}, utc(2026, 9, 21, 11)), p._openedBatch({ openThrough: 20261022 }, utc(2026, 9, 21, 11))],
      [{ from: '2026-10-09', to: '2026-10-15' }, { from: '2026-10-09', to: '2026-10-15' }, { from: '2026-10-09', to: '2026-10-15' }], 'a horizon that does not carry a day falls back to the release');
    // THE SEAM with the sheet (pure:horizon, nested in pure:window): the model is
    // written down twice — _bookingHorizon's constants and the stand-in numbers
    // here. Read through the REAL horizon, through its openThrough alone, and
    // through the stand-in, the newest batch must be the same seven days — else a
    // reminder tap would land on dates the review sheet calls something else.
    t.ok(typeof W._bookingHorizon === 'function', 'pure:window carries the real _bookingHorizon (pure:horizon is nested in it)');
    [utc(2026, 9, 19, 15), utc(2026, 9, 21, 10, 59, 59), utc(2026, 9, 21, 11, 0, 5), utc(2026, 10, 26, 12, 0, 1), utc(2026, 12, 30, 9), utc(2027, 3, 29, 11, 0, 1)].forEach((now) => {
      const h = W._bookingHorizon(now);
      const viaHorizon = p._openedBatch(h, W._lastReleaseMs(now));
      t.eq([viaHorizon, p._openedBatch(null, h.lastRelease), dow(viaHorizon.from), dow(viaHorizon.to)], [h.lastBatch, h.lastBatch, 5, 4],
        new Date(now).toISOString() + ': the tap\'s batch IS the sheet\'s "Newly opened" batch (' + h.lastBatch.from + ' → ' + h.lastBatch.to + '), with or without the horizon');
    });

    t.eq([p._openedBatch(null, null), p._openedBatch(null, NaN), p._openedBatch(null, 0), p._openedBatch(undefined, undefined)], [null, null, null, null], 'neither can say (no London zone data): null — the caller then leaves the date row alone');
    t.eq([p._isoDayPlus('2026-02-27', 2), p._isoDayPlus('2028-02-27', 2), p._isoDayPlus('nope', 1), p._isoDayPlus(null, 1)], ['2026-03-01', '2028-02-29', null, null], 'plain calendar arithmetic, leap years included; anything that is not a day → null');

    const route = (hasUsualWeek, canReview) => p._weekOpenedRouteFor({ hasUsualWeek, canReview });
    t.eq([route(true, true), route(false, true), route(true, false), route(false, false), p._weekOpenedRouteFor(null)], ['review', 'discover', 'discover', 'discover', 'discover'],
      'a usual week AND a sheet to review it in → the review; anything else → Discover');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Reminder tap with a usual week: My Bookings, then the REVIEW sheet on the newest dates — nothing is booked by the tap');
  {
    const hStart = appSrc.indexOf('// ── pure:week-opened:start');
    const hEnd = appSrc.indexOf('async function search(opts) {');
    t.ok(hStart !== -1 && hEnd > hStart, 'the hook can be sliced (anchors moved? update tests/suites/14c-weekly-reminder.js)');
    const hookCode = appSrc.slice(hStart, hEnd).replace(/\/\/[^\n]*/g, '');
    t.ok(!/\b(bookWeeklyTemplate|submitBooking|bookClass|_bookTemplateSeat|_bookEventHeadless|joinWaitlist|claimWaitlistSpot|apiFetch|fetch)\s*\(/.test(hookCode),
      'the hook never books, joins, claims or fetches: it opens the sheet (or moves the date row) and stops');
    t.eq((hookCode.match(/bookTemplateWeek\(/g) || []).length, 1, '…through exactly ONE call');
    t.ok(/window\.bookTemplateWeek\(\{ range: 'newest' \}\)/.test(hookCode), '…bookTemplateWeek({ range: \'newest\' }) — the shared contract with the sheet');

    const TAPPED = utc(2026, 9, 21, 11, 0, 5); // Monday 21 September, 12:00:05 London
    const world = (o) => {
      o = o || {};
      const w = { timers: [], calls: [], tab: 'tab-bookings', now: TAPPED, dialog: false, ownKeys: false, stack: [], ids: new Set(), buttons: [], busy: false,
        token: o.signedOut ? '' : 'tok', inputs: { startDate: { value: '2026-09-21' }, daysAhead: { value: '6' } } };
      class Clock extends Date { static now() { return w.now; } }
      const globals = {
        Date: Clock, Promise,
        _gymWallToUtcMs: G._gymWallToUtcMs,
        setTimeout: (fn, ms) => { w.timers.push({ fn, ms }); return w.timers.length; }, clearTimeout() {},
        document: {
          querySelector: (sel) => (sel === '.tab-panel.active' && w.tab ? { id: w.tab } : null),
          querySelectorAll: (sel) => (sel === '.book-btn' ? w.buttons : []),
          getElementById: (id) => w.inputs[id] || (w.ids.has(id) ? { id } : null),
        },
        getBearerToken: () => w.token,
        currentUser: o.unverified ? null : { id: 7 },
        _dialogOpen: () => w.dialog, _ownKeysOverlayUp: () => w.ownKeys, _overlayStack: w.stack,
        _discoverBusy: () => w.busy,
        _revalidateIfStale: () => w.calls.push('revalidateIfStale'),
        switchTab: (tab) => w.calls.push('tab:' + tab),
        _applyDateQuick: (mode) => w.calls.push('preset:' + mode),
        setDateQuick: (mode) => w.calls.push('saved:' + mode),
        onDateInputChange: () => w.calls.push('saved:custom'),
        _syncDatePills: () => w.calls.push('pills'),
        triggerAutoSearch: () => w.calls.push('search'),
        _revealActiveDatePill: () => {},
      };
      if (o.usualWeek !== false) globals.loadWeeklyTemplate = () => (o.usualWeek || [{ dayOfWeek: 1 }]);
      if (o.sheet !== false) globals.bookTemplateWeek = o.sheet || ((opts) => { w.calls.push('review:' + JSON.stringify(opts)); return Promise.resolve(); });
      const ctx = t.loadPure('js/app.js', 'window', globals);
      ctx.window = ctx;
      // pure:horizon is NESTED in pure:window, so loadPure has just declared the
      // REAL _bookingHorizon — over anything handed in as a global. A stand-in
      // therefore goes in AFTERWARDS (as an injected global it was silently
      // replaced, and the "one that throws" case below passed without throwing).
      if (o.horizon) ctx._bookingHorizon = o.horizon;
      t.vm.runInContext('var _dateQuickMode = "week", _loadableSearchStarted = ' + (o.launched === false ? 'false' : 'true') + ';\n' + appSrc.slice(hStart, hEnd), ctx, { filename: 'js/app.js[week-opened]' });
      w.ctx = ctx;
      w.row = () => [w.inputs.startDate.value, String(w.inputs.daysAhead.value), t.vm.runInContext('_dateQuickMode', ctx), ctx._dateRowHeld];
      // Null-safe: a regression that arms no retry should FAIL an assertion, not crash the suite.
      w.retry = () => { const last = w.timers[w.timers.length - 1]; if (last) last.fn(); };
      return w;
    };
    const REVIEW = 'review:{"range":"newest"}';
    const UNTOUCHED = ['2026-09-21', '6', 'week', undefined];

    let w = world();
    w.ctx._onBookingWeekOpened();
    t.eq(w.calls, ['tab:bookings', REVIEW], 'app already up, signed in, a usual week saved: My Bookings, then the review sheet on the batch that release opened');
    t.eq([w.row(), w.timers.length], [UNTOUCHED, 0], '…and Discover\'s date row is not touched, held or searched; nothing is left polling');

    w = world({ launched: false });
    w.ctx._onBookingWeekOpened();
    t.eq([w.calls, w.timers.length], [[], 1], 'cold start from the notification, launch not done: nothing yet — a retry is armed');
    t.vm.runInContext('_loadableSearchStarted = true;', w.ctx);
    w.retry();
    t.eq(w.calls, [REVIEW], 'once launch is done the sheet opens — with no second switchTab: the bridge put the member on My Bookings at the tap');

    w = world({ unverified: true });
    w.ctx._onBookingWeekOpened();
    t.eq(w.calls, [], 'the session is not verified yet (no profile): the sheet\'s plan would call a signed-in member signed out — wait');
    w.ctx.currentUser = { id: 7 };
    w.retry();
    t.eq(w.calls, [REVIEW], '…and open once /profile has answered');
    w = world({ signedOut: true });
    w.ctx._onBookingWeekOpened();
    for (let i = 0; i < 200 && w.timers.length > i; i++) w.timers[i].fn();
    t.eq([w.calls, w.timers.length], [[], 120], 'signed out: My Bookings (its Sign-in hero) is the whole answer — bounded retries, no sheet');

    // Never over a dialog, a sheet, the welcome, the Booked sheet — or beside a booking in progress.
    const held = [
      ['a confirm dialog / the seat picker', (x) => { x.dialog = true; }, (x) => { x.dialog = false; }],
      ['the first-run welcome', (x) => { x.ownKeys = true; }, (x) => { x.ownKeys = false; }],
      ['a class sheet, Settings, an instructor profile (the overlay stack)', (x) => { x.stack.push({}); }, (x) => { x.stack.pop(); }],
      ['the "Booked!" sheet', (x) => { x.ids.add('bookingConfirmation'); }, (x) => { x.ids.delete('bookingConfirmation'); }],
      ['a Book button waiting on Psycle', (x) => { x.buttons.push({ dataset: { busy: '1' }, textContent: 'Book' }); }, (x) => { x.buttons.pop(); }],
      ['a Book button showing "…"', (x) => { x.buttons.push({ dataset: {}, textContent: '…' }); }, (x) => { x.buttons.pop(); }],
    ];
    held.forEach(([what, up, down]) => {
      const x = world();
      up(x);
      x.ctx._onBookingWeekOpened();
      const before = x.calls.slice();
      down(x);
      x.retry();
      t.eq([before, x.calls], [[], [REVIEW]], 'held back by ' + what + ' — and opened when it has gone');
    });
    w = world();
    w.ctx._dialogOpen = () => { throw new Error('boom'); };
    w.ctx._onBookingWeekOpened();
    t.eq([w.calls, w.timers.length], [[], 1], 'if it cannot tell whether something is open, it waits (bounded) rather than open over it');

    // The review ALREADY on screen is different: the tap has nothing to add, and
    // must not WAIT for it — found in a browser run: a second tap was held back
    // by the sheet itself, kept polling, and re-opened the sheet the moment the
    // member pressed "Not now". A sheet that spends credits never comes back by itself.
    w = world();
    w.ids.add('usualWeekSheet');
    w.dialog = true; // app.js's _dialogOpen() counts the sheet
    w.ctx._onBookingWeekOpened();
    t.eq([w.calls, w.timers.length], [[], 0], 'the usual-week sheet is already up: nothing opens and NO retry is left polling');
    w.ids.delete('usualWeekSheet');
    w.dialog = false; // the member closes it
    w.retry();
    t.eq(w.calls, [], '…so closing it does not bring it straight back');
    // …but a sheet opened BEFORE the 12:00 release (to be ready for it), or sitting on another range, has no
    // "Newly opened" dates — the ones this tap promised. An idle sheet is asked to show them (js/tabs.js).
    w = world();
    w.ids.add('usualWeekSheet');
    w.dialog = true;
    w.ctx._usualWeekSheetNewest = () => { w.calls.push('sheet:newest'); return true; };
    w.ctx._onBookingWeekOpened();
    t.eq([w.calls, w.timers.length], [['sheet:newest'], 0], 'the sheet is already up: IT is asked to show the newest dates — no second sheet, no tab switch, no retry left polling');
    w = world();
    w.ids.add('usualWeekSheet');
    w.ctx._usualWeekSheetNewest = () => { w.calls.push('sheet:busy'); return false; };
    w.ctx._onBookingWeekOpened();
    t.eq([w.calls, w.timers.length], [['sheet:busy'], 0], 'a sheet that refuses (a run, the seat map, a run\'s results): the tap is dropped — never queued behind a booking');
    w = world();
    w.ids.add('usualWeekSheet');
    w.ctx._usualWeekSheetNewest = () => { throw new Error('boom'); };
    w.ctx._onBookingWeekOpened();
    t.eq([w.calls, w.timers.length], [[], 0], '…and a handle that throws costs nothing');
    // …and a retry that was waiting on something else (Settings) stands down too,
    // if the member has opened the review themselves in the meantime.
    w = world();
    w.stack.push({});
    w.ctx._onBookingWeekOpened();
    w.stack.pop();
    w.ids.add('usualWeekSheet');
    w.dialog = true;
    const before = w.timers.length;
    w.retry(); // the one pending poll fires, finds the review up…
    t.eq([w.calls, before, w.timers.length], [[], 1, 1], 'held back by Settings, then the member opened the review themselves: the waiting poll stands down — it opens nothing and arms no further poll');
    w = world();
    w.stack.push({});
    w.ctx._onBookingWeekOpened();
    w.stack.pop();
    w.ids.add('usualWeekSheet');
    w.ctx._usualWeekSheetNewest = () => { w.calls.push('sheet:newest'); return true; };
    w.retry();
    t.eq(w.calls, [], '…and it does not re-list that sheet either: only the TAP itself asks — a poll seconds later would wipe ticks the member has made since');

    // The member moved on while it waited: not yanked back, no sheet out of nowhere.
    w = world();
    w.dialog = true;
    w.ctx._onBookingWeekOpened();
    w.dialog = false;
    w.tab = 'tab-discover';
    w.retry();
    t.eq([w.calls, w.timers.length], [[], 1], 'the member has left My Bookings by the retry: nothing opens, and no further retry is armed');
    // Timers freeze in a suspended app: judged by the clock.
    w = world();
    w.dialog = true;
    w.ctx._onBookingWeekOpened();
    w.now += 10000;
    w.retry();
    t.eq(w.timers.length, 2, '10s after the tap, still held back: it keeps waiting');
    w.dialog = false;
    w.now += 3 * 3600000;
    w.retry();
    t.eq([w.calls, w.timers.length], [[], 2], 'a poll that wakes hours after the tap gives up — a sheet that spends credits never opens out of nowhere');
    w.ctx._onBookingWeekOpened();
    t.eq(w.calls, ['tab:bookings', REVIEW], '…while a NEW tap starts afresh');

    // A sheet that throws or rejects never breaks the tap.
    let unhandled = 0;
    const onUnhandled = () => { unhandled++; };
    process.on('unhandledRejection', onUnhandled);
    world({ sheet: () => Promise.reject(new Error('offline')) }).ctx._onBookingWeekOpened();
    world({ sheet: () => { throw new Error('boom'); } }).ctx._onBookingWeekOpened();
    await flush(); await flush();
    process.removeListener('unhandledRejection', onUnhandled);
    t.eq(unhandled, 0, 'a review sheet that throws or rejects leaves no unhandled rejection behind');

    // Without a usual week — or with one and no sheet to open it in — it is Discover.
    w = world({ usualWeek: [] });
    w.tab = 'tab-discover';
    w.ctx._onBookingWeekOpened();
    t.eq([w.calls, w.row()], [['tab:discover', 'pills', 'search'], ['2026-10-09', '1', null, true]], 'an empty saved list is no usual week: Discover on the first of the opened dates (Fri 9 October), unsaved and held');
    w = world({ sheet: false });
    w.tab = 'tab-discover';
    w.ctx._onBookingWeekOpened();
    t.eq(w.calls, ['tab:discover', 'pills', 'search'], 'a usual week but no bookTemplateWeek on window: Discover, never a dead tap');
    w = world({ usualWeek: false, horizon: () => ({ openThrough: '2026-10-22' }) });
    w.tab = 'tab-discover';
    w.ctx._onBookingWeekOpened();
    t.eq(w.row(), ['2026-10-16', '1', null, true], 'where window._bookingHorizon exists, ITS newest batch is the one shown');
    w = world({ usualWeek: false, horizon: () => { throw new Error('boom'); } });
    w.tab = 'tab-discover';
    w.ctx._onBookingWeekOpened();
    t.eq(w.row(), ['2026-10-09', '1', null, true], '…and one that throws costs nothing: the stand-in numbers answer');
    w = world({ usualWeek: () => { throw new Error('storage'); } });
    w.ctx.loadWeeklyTemplate = () => { throw new Error('storage'); };
    w.tab = 'tab-discover';
    w.ctx._onBookingWeekOpened();
    t.eq(w.calls[0], 'tab:discover', 'a usual week that cannot be read is no usual week');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Reminder: what the app says about it, everywhere');
  {
    const tabs = t.readSource('js/tabs.js');
    t.ok(/<span class="app-row-label">Monday booking reminder<\/span>' \+\s*'<span class="app-row-detail">Mondays at 12:00 — when Psycle opens new dates<\/span>/.test(tabs), 'the Settings row: "Mondays at 12:00 — when Psycle opens new dates"');
    t.ok(/'Monday reminder on'/.test(tabs) && /'Monday reminder on'/.test(BRIDGE_SRC), 'the switch and the in-app offer give the same toast');
    t.ok(!/11:59|1159/.test(tabs + BRIDGE_SRC), 'no 11:59 left in the reminder\'s code or copy');
    const settings = t.readSource('js/settings.js');
    t.ok(/\(window\._nativeReminder \?\s*'<div class="settings-section" id="settingsSecReminders">/.test(settings), 'on the web the Reminders section is not built at all (js/settings.js) — unchanged');
    t.ok(/_rowReminders\.style\.display = window\._nativeReminder \? '' : 'none';/.test(tabs), '…and Membership hides its Reminders row there');
  }
};
