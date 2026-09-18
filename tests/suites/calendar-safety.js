'use strict';
// Calendar safety: Psync may only destroy events in a calendar the member
// EXPLICITLY handed over (the ownership dialog → psycle_calendar_owned_ack).
//
// Three layers, all against the SHIPPED source:
//   1. the pure decision helpers native-bridge.js exports before its Capacitor
//      guard (which events count as foreign / which the old-target sweep takes);
//   2. the real bridge, evaluated against a fake Capacitor whose Calendar plugin
//      is an in-memory event list that records every delete and create;
//   3. the Settings handlers (js/settings.js, pure:calendar-sync) against a fake
//      bridge + a confirmModal the test answers by hand.
// Nothing native, no network.

module.exports = async function (t) {
  const BRIDGE_SRC = t.readSource('ios-app/www/native-bridge.js');
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const NOW = Date.UTC(2026, 8, 17, 9, 0, 0);
  const DAY = 86400000;
  const MARK = (id) => 'Instructor: Alex\npsycle-event-id:' + id;
  // The member's own life, in the calendar they might pick by mistake.
  const dentist = () => ({ id: 'e-dentist', calendarId: 'home', title: 'Dentist', startDate: NOW + 2 * DAY, notes: '' });
  const birthday = () => ({ id: 'e-bday', calendarId: 'home', title: "Mum's birthday", startDate: NOW + 30 * DAY });
  const workEvent = () => ({ id: 'e-work', calendarId: 'work', title: 'Standup', startDate: NOW + DAY });

  // ════════════════════════════════════════════════════════════════════
  t.section('Calendar safety: pure ownership decisions (native-bridge.js, no Capacitor)');
  {
    const ctx = { console: { log() {}, warn() {} } };
    ctx.window = ctx;
    t.vm.createContext(ctx);
    t.vm.runInContext(BRIDGE_SRC, ctx, { filename: 'native-bridge.js[no-capacitor]' });
    t.ok(typeof ctx._psycleCalForeignEvents === 'function' && typeof ctx._psycleCalSweepVictimIds === 'function',
      'both helpers are exported before the Capacitor bail');
    t.ok(typeof ctx.psycleSetCalendarConfig === 'undefined', '…and the bridge proper still bails without Capacitor');

    const markerOf = (ev) => { const m = /psycle-event-id:(\d+)/.exec((ev && ev.notes) || ''); return m ? m[1] : null; };
    const events = [
      dentist(), birthday(), workEvent(),
      { id: 'e-ride', calendarId: 'home', title: 'Ride', startDate: NOW + DAY, notes: MARK(501) },
      { id: 'e-orphan', title: 'Ride (no calendarId)', startDate: NOW + DAY, notes: MARK(502) },
      { id: 'e-mystery', title: 'Unattributable', startDate: NOW + DAY },
      null,
    ];
    const ids = (list) => list.map((e) => e.id).sort();

    t.eq(ids(ctx._psycleCalForeignEvents(events, 'home', markerOf)), ['e-bday', 'e-dentist'],
      'foreign = unmarked events IN that calendar (not other calendars, not ours, not unattributable ones)');
    t.eq(ctx._psycleCalForeignEvents(events, 'psy', markerOf).length, 0, 'an empty dedicated calendar has nothing foreign');
    t.eq(ctx._psycleCalForeignEvents(null, 'home', markerOf).length, 0, 'no event list → nothing (never throws)');

    t.eq(ctx._psycleCalSweepVictimIds(events, 'home', false, markerOf).slice().sort(), ['e-orphan', 'e-ride'],
      'sweep WITHOUT the ack takes only events carrying our marker — Dentist and the birthday stay');
    t.eq(ctx._psycleCalSweepVictimIds(events, 'home', true, markerOf).slice().sort(), ['e-bday', 'e-dentist', 'e-orphan', 'e-ride'],
      'sweep WITH the ack clears the handed-over calendar (the existing contract)');
    t.ok(!ctx._psycleCalSweepVictimIds(events, 'home', true, markerOf).includes('e-work'), '…and never another calendar, ack or not');
    t.ok(!ctx._psycleCalSweepVictimIds(events, 'home', true, markerOf).includes('e-mystery'), '…nor an unmarked event no calendar can be pinned on');

    const covers = ctx._psycleCalAckCovers;
    t.eq([covers('2:home', 'home'), covers('2:home', 'psy'), covers('1', 'home'), covers(null, 'home'), covers('2:', ''), covers('2:null', null)],
      [true, false, false, false, false, false],
      'the ack covers ONLY the calendar it names — the legacy "1", another calendar\'s ack and a missing target all read un-owned');
  }

  // ════════════════════════════════════════════════════════════════════
  // The real bridge against a fake Capacitor. Stubs mirror ios-bridge.js's
  // boot(): if the bridge starts touching a new global at load, add it there
  // AND here.
  function boot(opts) {
    opts = opts || {};
    const ls = t.makeFakeLocalStorage();
    Object.keys(opts.local || {}).forEach((k) => ls.setItem(k, opts.local[k]));
    const events = (opts.events || []).slice();
    const log = { deleted: [], created: [], listed: 0, fetched: 0, prefRemoved: [] };
    const state = { token: opts.token === undefined ? 'tok' : opts.token, listThrows: false, dropCalendarId: false };
    let seq = 0;
    const timers = [];

    const Calendar = {
      checkAllPermissions: () => Promise.resolve({ result: { readCalendar: 'granted', writeCalendar: 'granted' } }),
      requestAllPermissions: () => Promise.resolve({ result: { readCalendar: 'granted', writeCalendar: 'granted' } }),
      listCalendars: () => Promise.resolve({ result: [{ id: 'home', title: 'Home' }, { id: 'work', title: 'Work' }, { id: 'psy', title: 'Psycle' }] }),
      listEventsInRange(q) {
        log.listed++;
        if (state.listThrows) return Promise.reject(new Error('eventkit'));
        const out = events.filter((e) => e.startDate >= q.startDate && e.startDate <= q.endDate).map((e) => {
          const copy = Object.assign({}, e);
          if (state.dropCalendarId) delete copy.calendarId;
          return copy;
        });
        return Promise.resolve({ result: out });
      },
      deleteEventsById(o) {
        o.ids.forEach((id) => {
          const i = events.findIndex((e) => String(e.id) === String(id));
          if (i !== -1) events.splice(i, 1);
          log.deleted.push(String(id));
        });
        return Promise.resolve({ result: { deleted: o.ids, failed: [] } });
      },
      createEvent(data) {
        const id = 'n' + (++seq);
        events.push(Object.assign({ id: id }, data));
        log.created.push(data);
        return Promise.resolve({ result: id });
      },
    };

    const ctx = {
      console: { log() {}, warn() {}, error() {} },
      localStorage: ls,
      navigator: { onLine: true },
      setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
      clearTimeout() {},
      __now: () => NOW,
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          CapacitorCalendar: Calendar,
          Preferences: {
            get: () => Promise.resolve({ value: null }),
            set: () => Promise.resolve(),
            remove(o) { log.prefRemoved.push(o.key); return Promise.resolve(); },
          },
          StatusBar: { setStyle: () => Promise.resolve() },
          LocalNotifications: {
            checkPermissions: () => Promise.resolve({ display: 'denied' }),
            requestPermissions: () => Promise.resolve({ display: 'denied' }),
            registerActionTypes: () => Promise.resolve(),
            addListener() {},
            schedule: () => Promise.resolve(),
            cancel: () => Promise.resolve(),
          },
        },
      },
      PsycleEvents: { on() { return function () {}; }, off() {}, emit() {} },
      _eventCache: {
        501: { id: 501, start_at: '2026-09-20 07:00:00', duration: 45, _typeName: 'Ride', _instrName: 'Alex' },
      },
      _myBookings: {
        501: { bookingId: 9001, bookingIds: [9001], slots: [7], slotBookings: { 7: 9001 }, waitlisted: false },
      },
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
      switchTab() {}, openClassDetail() {}, toast() {}, renderReminderRow() {},
      slotLabel: () => 'Bike', // app.js's; the bridge falls back to "Spot" without it
      confirmModal: () => new Promise(() => {}),
      _psycleNativeRestoreResolve() {},
      getBearerToken: () => state.token,
      // The real one's no-token branch empties the list session expiry keeps.
      fetchMyBookings() {
        log.fetched++;
        if (!state.token) ctx._myBookings = {};
        return Promise.resolve();
      },
    };
    ctx.window = ctx;
    ctx.self = ctx;
    t.vm.createContext(ctx);
    t.vm.runInContext('Date.now = __now;', ctx);
    t.vm.runInContext(BRIDGE_SRC, ctx, { filename: 'native-bridge.js[calendar-safety]' });
    return { ctx, ls, events, log, state, titles: () => events.map((e) => e.title).sort() };
  }

  const ACK = 'psycle_calendar_owned_ack';
  const HOME_PICKED = { psycle_calendar_mode: 'custom', psycle_calendar_target_id: 'home' };
  const rideIn = (calId, id) => ({ id: id || 'e-ride', calendarId: calId, title: 'Ride — Alex (Bike 7)', startDate: Date.UTC(2026, 8, 20, 6, 0, 0), notes: MARK(501) });

  // ════════════════════════════════════════════════════════════════════
  t.section('Calendar safety: psycleCountForeignEvents is read-only and honest');
  {
    const b = boot({ events: [dentist(), birthday(), workEvent(), rideIn('home')] });
    await flush();
    t.eq(await b.ctx.psycleCountForeignEvents('home'), 2, '"Home" → 2 events that are not Psycle bookings (Dentist, birthday)');
    t.eq(await b.ctx.psycleCountForeignEvents('psy'), 0, 'an empty dedicated calendar → 0');
    t.eq(await b.ctx.psycleCountForeignEvents(''), null, 'no calendar id → null');
    t.eq([b.log.deleted.length, b.log.created.length], [0, 0], 'counting never deletes or creates anything');
    t.eq(b.ls.getItem(ACK), null, '…and never grants the ownership ack');
    t.eq(b.ls.getItem('psycle_calendar_target_id'), null, '…or stores a target');

    b.state.listThrows = true;
    t.eq(await b.ctx.psycleCountForeignEvents('home'), null, 'a failed EventKit query → null (the dialog then warns without a number)');
    b.state.listThrows = false;
    b.state.dropCalendarId = true;
    t.eq(await b.ctx.psycleCountForeignEvents('home'), null, 'a plugin that attributes no event to a calendar → null, not a reassuring 0');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Calendar safety: a pick is not consent — only ownedAck:true hands a calendar over');
  {
    // What the old Settings handler sent: a bare pick. It used to set the ack.
    const b = boot({ events: [dentist(), birthday(), workEvent()] });
    await flush();
    await b.ctx.psycleSetCalendarConfig({ mode: 'custom', targetId: 'home' });
    t.eq(b.ls.getItem(ACK), null, 'a pick without ownedAck leaves the calendar un-owned');
    t.eq(b.ctx.psycleGetCalendarConfig().ownedAck, false, 'psycleGetCalendarConfig reports ownedAck:false');
    const r = await b.ctx.psycleResyncCalendar();
    t.eq(b.ls.getItem(ACK), null, 'a bare resync never grants the ack either');
    t.eq(b.titles(), ['Dentist', "Mum's birthday", 'Ride — Alex (Bike 7)', 'Standup'], 'the reconcile adds the booking and deletes NOTHING of the member\'s');
    t.eq([r.added, r.removed], [1, 0], '…and reports it truthfully (+1, −0)');

    const dup = await b.ctx.psycleCleanupDuplicates();
    t.eq(b.ls.getItem(ACK), null, '"Remove duplicates" never grants the ack');
    t.eq([dup.removed, b.titles().length], [0, 4], '…and still leaves the personal events alone');
  }
  {
    const b = boot({ events: [dentist(), birthday(), workEvent()] });
    await flush();
    await b.ctx.psycleSetCalendarConfig({ mode: 'custom', targetId: 'home', ownedAck: true });
    t.eq(b.ls.getItem(ACK), '2:home', 'ownedAck:true (the confirmed dialog) grants the ack — bound to THAT calendar');
    t.eq(b.ctx.psycleGetCalendarConfig().ownedAck, true, '…and the config reports it');
    await b.ctx.psycleResyncCalendar({ ownedAck: true });
    t.eq(b.titles(), ['Ride — Alex (Bike 7)', 'Standup'], 'the contract is unchanged once handed over: the calendar is reconciled authoritatively');
    t.ok(b.events.some((e) => e.title === 'Standup' && e.calendarId === 'work'), '…and another calendar is never touched');
    const made = b.log.created[0];
    t.eq([made.timeZone, made.calendarId, /psycle-event-id:501/.test(made.notes), made.alertOffsetInMinutes], ['Europe/London', 'home', true, [60, 15]],
      'created events keep the v6 call shape (timeZone Europe/London, notes marker, alertOffsetInMinutes)');
  }
  {
    // The old ack was for the OLD calendar: it must not ride along to a new one.
    const b = boot({ local: Object.assign({ [ACK]: '2:psy', psycle_calendar_target_id: 'psy', psycle_calendar_mode: 'custom' }), events: [dentist(), birthday()] });
    await flush();
    await b.ctx.psycleSetCalendarConfig({ mode: 'custom', targetId: 'home' });
    t.eq(b.ls.getItem(ACK), null, 'switching to a different calendar WITHOUT ownedAck clears the previous calendar\'s ack');
    t.ok(b.log.prefRemoved.includes(ACK), '…in the Preferences mirror too (a storage purge cannot resurrect it)');
    await b.ctx.psycleResyncCalendar();
    t.ok(b.titles().includes('Dentist') && b.titles().includes("Mum's birthday"), '…so the new target\'s own events survive the sync');

    const same = boot({ local: Object.assign({ [ACK]: '2:home' }, HOME_PICKED) });
    await flush();
    await same.ctx.psycleSetCalendarConfig({ enabled: false });
    await same.ctx.psycleSetCalendarConfig({ mode: 'custom', targetId: 'home' });
    t.eq(same.ls.getItem(ACK), '2:home', 'toggling sync / re-sending the SAME target keeps its ack');
  }
  {
    // The build before the dialog wrote a bare '1' on every pick / "Re-sync now" /
    // "Remove duplicates" with nothing shown. That is not consent: "Home" picked
    // back then must not keep losing the events the member adds to it.
    const b = boot({ local: Object.assign({ [ACK]: '1' }, HOME_PICKED), events: [dentist(), birthday(), workEvent()] });
    await flush();
    t.eq(b.ctx.psycleGetCalendarConfig().ownedAck, false, 'a legacy "1" ack reads as NOT handed over (so "Re-sync now" shows the counted dialog)');
    const r = await b.ctx.psycleResyncCalendar();
    t.eq([r.added, r.removed], [1, 0], '…and the reconcile it used to unlock is marker-only: +1, −0');
    t.eq(b.titles(), ['Dentist', "Mum's birthday", 'Ride — Alex (Bike 7)', 'Standup'], 'Dentist and the birthday survive');
    t.eq(b.ls.getItem(ACK), '1', 'a bare resync does not upgrade it either');

    await b.ctx.psycleResyncCalendar({ ownedAck: true });
    t.eq(b.ls.getItem(ACK), '2:home', 'the confirmed dialog replaces it with the calendar-bound ack');
    t.eq(b.ctx.psycleGetCalendarConfig().ownedAck, true, '…which the config then reports');
    t.eq(b.titles(), ['Ride — Alex (Bike 7)', 'Standup'], '…and only THEN is the calendar reconciled authoritatively');

    // An ack naming another calendar never covers this one.
    const other = boot({ local: Object.assign({ [ACK]: '2:psy' }, HOME_PICKED), events: [dentist()] });
    await flush();
    t.eq(other.ctx.psycleGetCalendarConfig().ownedAck, false, 'an ack for a DIFFERENT calendar does not cover the current target');
    await other.ctx.psycleResyncCalendar();
    t.ok(other.titles().includes('Dentist'), '…so its events are left alone');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Calendar safety: the old-target sweep honours the OLD calendar\'s ack');
  {
    // Pre-contract member: "Home" was picked before the ownership contract
    // existed (no ack). They now move to a dedicated calendar, with consent.
    const b = boot({ local: HOME_PICKED, events: [dentist(), birthday(), workEvent(), rideIn('home')] });
    await flush();
    const res = await b.ctx.psycleSetCalendarConfig({ mode: 'custom', targetId: 'psy', ownedAck: true });
    t.eq(b.log.deleted, ['e-ride'], 'only OUR marked event leaves the old calendar');
    t.ok(b.titles().includes('Dentist') && b.titles().includes("Mum's birthday"), 'Dentist + Mum\'s birthday survive the switch (they were wiped before)');
    t.eq(res.movedFromOld, 1, 'movedFromOld counts just that one');
    t.eq(b.ls.getItem(ACK), '2:psy', 'the NEW calendar is owned (the member confirmed it)');
    await b.ctx.psycleResyncCalendar({ ownedAck: true });
    t.ok(b.events.some((e) => e.calendarId === 'psy' && /psycle-event-id:501/.test(e.notes || '')), 'the booking is re-created in the new calendar');
    t.ok(b.titles().includes('Dentist'), '…and the old personal calendar is still intact after the sync');
  }
  {
    // An old target that WAS handed over is cleared as before.
    const b = boot({ local: Object.assign({ [ACK]: '2:home' }, HOME_PICKED), events: [dentist(), workEvent(), rideIn('home')] });
    await flush();
    await b.ctx.psycleSetCalendarConfig({ mode: 'custom', targetId: 'psy', ownedAck: true });
    t.eq(b.log.deleted.slice().sort(), ['e-dentist', 'e-ride'], 'an ACKED old target is swept clean (existing contract) — other calendars untouched');
  }
  {
    // …but a legacy '1' never was consent: moving away from it is marker-only.
    const b = boot({ local: Object.assign({ [ACK]: '1' }, HOME_PICKED), events: [dentist(), workEvent(), rideIn('home')] });
    await flush();
    await b.ctx.psycleSetCalendarConfig({ mode: 'custom', targetId: 'psy', ownedAck: true });
    t.eq(b.log.deleted, ['e-ride'], 'an old target carrying only the legacy "1" keeps its unmarked events on the switch');
  }
  {
    // Mapped ids are ours by construction — they go even if the query fails.
    const b = boot({ local: Object.assign({ psycle_native_cal_events: JSON.stringify({ 501: 'e-ride' }) }, HOME_PICKED), events: [dentist(), rideIn('home')] });
    await flush();
    b.state.listThrows = true;
    await b.ctx.psycleSetCalendarConfig({ mode: 'custom', targetId: 'psy', ownedAck: true });
    t.eq(b.log.deleted, ['e-ride'], 'a failed query falls back to the mapped ids only');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Calendar safety: no reconcile, no refresh and no ack with an expired session');
  {
    const b = boot({ token: '', local: HOME_PICKED, events: [dentist(), rideIn('home')] });
    await flush();
    const before = JSON.stringify(b.ctx._myBookings);
    const r = await b.ctx.psycleResyncCalendar({ ownedAck: true });
    t.eq(r.error, 'Sign in to sync', 'signed out → { error: "Sign in to sync" }');
    t.eq(b.log.fetched, 0, 'fetchMyBookings is never called (its no-token branch would empty the kept list)');
    t.eq(JSON.stringify(b.ctx._myBookings), before, 'the bookings session expiry kept are still there');
    t.eq(b.ls.getItem(ACK), null, 'no ack is granted by a sync that cannot run');
    t.eq([b.log.deleted.length, b.log.created.length, b.log.listed], [0, 0, 0], 'the calendar is not read, written or deleted from');

    const dup = await b.ctx.psycleCleanupDuplicates();
    t.eq(dup.error, 'Sign in to sync', '"Remove duplicates" inherits the refusal');
  }
  {
    // Bookings not loaded yet (offline launch): the reconcile skips itself.
    const b = boot({ local: Object.assign({ [ACK]: '2:home' }, HOME_PICKED), events: [dentist()] });
    await flush();
    b.ctx._myBookings = {};
    const r = await b.ctx.psycleResyncCalendar();
    t.ok(!!r.skipped && !r.error, 'an unconfirmed-empty snapshot → { skipped }');
    t.eq(b.log.deleted, [], '…and deletes nothing');
    const dup = await b.ctx.psycleCleanupDuplicates();
    t.ok(!!dup.skipped, 'psycleCleanupDuplicates passes `skipped` through (it used to drop it → "No duplicates")');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Calendar safety: Settings asks before handing a calendar over (js/settings.js)');

  function settings(o) {
    o = o || {};
    const log = { toasts: [], modals: [], setCfg: [], resync: [], counted: [], lists: 0, timers: [] };
    const st = {
      token: o.token === undefined ? 'tok' : o.token,
      cfg: Object.assign({ enabled: true, mode: 'unset', targetId: null, ownedAck: false }, o.cfg || {}),
    };
    const panel = { innerHTML: '', textContent: '' };
    const calendars = [{ id: 'home', title: o.homeTitle || 'Home' }, { id: 'psy', title: 'Psycle' }];
    const window = {
      psycleListCalendars() { log.lists++; return Promise.resolve(calendars); },
      psycleGetCalendarConfig: () => Object.assign({}, st.cfg),
      psycleCountForeignEvents(id) {
        log.counted.push(id);
        return o.countThrows ? Promise.reject(new Error('eventkit')) : Promise.resolve(o.count === undefined ? 2 : o.count);
      },
      psycleSetCalendarConfig(cfg) {
        log.setCfg.push(cfg);
        st.cfg.mode = cfg.mode; st.cfg.targetId = cfg.targetId; st.cfg.ownedAck = cfg.ownedAck === true;
        return Promise.resolve({ movedFromOld: o.moved || 0 });
      },
      psycleResyncCalendar(opts) { log.resync.push(opts); return Promise.resolve(o.resync === undefined ? { added: 1, removed: 0, kept: 0 } : o.resync); },
      psycleCleanupDuplicates() { return Promise.resolve(o.cleanup); },
    };
    if (!o.noModal) {
      window.confirmModal = (opts) => new Promise((resolve) => { log.modals.push({ opts: opts, answer: resolve }); });
    }
    const selectFor = (id) => {
      const options = [{ value: '', text: 'Choose a calendar…' }].concat(calendars.map((c) => ({ value: c.id, text: c.title })));
      return { value: id, disabled: false, options: options, selectedIndex: options.findIndex((x) => x.value === id) };
    };
    const current = selectFor(st.cfg.targetId || '');
    const p = t.loadPure('js/settings.js', 'calendar-sync', {
      window: window,
      document: { getElementById: (id) => (id === 'calendarSyncPanel' ? panel : id === 'calSyncTarget' ? current : null) },
      escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      toast: (m, k) => log.toasts.push([m, k]),
      getBearerToken: () => st.token,
      setTimeout: (fn) => { log.timers.push(fn); return log.timers.length; },
    });
    return { p, window, log, st, panel, selectFor, button: () => ({ textContent: 'Re-sync now', disabled: false }) };
  }

  {
    // The headline bug: one tap on "Home" used to go straight to the bridge.
    const s = settings({ count: 2 });
    const sel = s.selectFor('home');
    const done = s.window.onCalendarTargetChange(sel);
    await flush();
    t.eq(s.log.counted, ['home'], 'the pick is counted first (read-only)');
    t.eq(s.log.modals.length, 1, 'one ownership dialog is shown');
    t.eq(s.log.setCfg.length + s.log.resync.length, 0, 'NOTHING reaches the bridge before the member answers');
    t.ok(sel.disabled === true, 'the select is locked while the question is open');
    const m = s.log.modals[0].opts;
    t.eq([m.danger, m.cancelText, m.confirmText], [true, 'Choose another', 'Use this calendar'],
      'danger styling + an explicit cancel label (confirmModal defaults to "Keep booking")');
    t.ok(/"Home"/.test(m.title) && /"Home" has 2 upcoming events that are not Psycle bookings/.test(m.body) && /delete them now/.test(m.body),
      'the dialog names the calendar and says how many events will go: ' + m.body);
    t.ok(/Past events are untouched/.test(m.body) && /can't be undone/.test(m.warn), '…what is safe, and that there is no undo');

    const listsBefore = s.log.lists;
    s.log.modals[0].answer(false);
    await done;
    await flush();
    t.eq(s.log.setCfg.length + s.log.resync.length, 0, '"Choose another" → the bridge is never told about the pick');
    t.ok(s.log.lists > listsBefore && /Choose a calendar/.test(s.panel.innerHTML), '…and the panel is re-rendered from the stored config (first pick: back to the placeholder)');
    t.ok(sel.disabled === false, '…with the select released');
  }
  {
    const s = settings({ count: 1, moved: 3, cfg: { mode: 'custom', targetId: 'psy', ownedAck: true } });
    const done = s.window.onCalendarTargetChange(s.selectFor('home'));
    await flush();
    t.ok(/has 1 upcoming event that is not a Psycle booking\. Psync will delete it now/.test(s.log.modals[0].opts.body), 'singular grammar for one event');
    s.log.modals[0].answer(true);
    await done;
    t.eq(s.log.setCfg, [{ mode: 'custom', targetId: 'home', ownedAck: true }], '"Use this calendar" → the pick is sent WITH ownedAck:true');
    t.eq(s.log.resync, [{ ownedAck: true }], '…then one resync');
    t.eq(s.log.toasts, [['Moved 3 events to new calendar', 'info']], '…and the move is toasted once it really synced');
    await flush();
    t.ok(/value="home" selected/.test(s.panel.innerHTML), 'the panel repaints with the new target selected');
  }
  {
    const zero = settings({ count: 0 });
    zero.window.onCalendarTargetChange(zero.selectFor('psy'));
    await flush();
    t.ok(/no other upcoming events right now/.test(zero.log.modals[0].opts.body) && zero.log.modals[0].opts.danger === true,
      'an empty calendar still asks (the contract applies to everything added later)');

    const unknown = settings({ countThrows: true });
    unknown.window.onCalendarTargetChange(unknown.selectFor('home'));
    await flush();
    const body = unknown.log.modals[0].opts.body;
    t.ok(/every upcoming event in "Home"/.test(body) && !/\d/.test(body), 'count unavailable → the dialog warns without inventing a number');

    const nasty = settings({ homeTitle: 'Mum & <b>Dad</b>' });
    nasty.window.onCalendarTargetChange(nasty.selectFor('home'));
    await flush();
    t.ok(nasty.log.modals[0].opts.title === 'Let Psync manage "Mum & <b>Dad</b>"?', 'the calendar name goes to confirmModal raw (no double escaping)…');
    const app = t.readSource('js/app.js');
    t.ok(/escapeHTML\(opts\.title\)/.test(app) && /escapeHTML\(opts\.body\)/.test(app) && /escapeHTML\(opts\.warn\)/.test(app),
      '…because confirmModal escapes title, body and warn itself');
    await nasty.p.renderCalendarSync();
    t.ok(/Mum &amp; &lt;b&gt;Dad/.test(nasty.panel.innerHTML) && !/<b>Dad/.test(nasty.panel.innerHTML), 'the <option> label stays escaped');
  }
  {
    const s = settings({ noModal: true });
    const sel = s.selectFor('home');
    await s.window.onCalendarTargetChange(sel);
    t.eq(s.log.setCfg.length, 0, 'no way to ask (confirmModal missing) → never assume yes');
    t.ok(sel.disabled === false, '…and the select is not left locked');
  }
  {
    // Signed out + an existing target: the sweep would remove the classes from
    // the old calendar and nothing could write them into the new one.
    const s = settings({ token: '', cfg: { mode: 'custom', targetId: 'psy', ownedAck: true } });
    await s.window.onCalendarTargetChange(s.selectFor('home'));
    t.eq([s.log.modals.length, s.log.setCfg.length], [0, 0], 'signed out → no switch, no dialog');
    t.eq(s.log.toasts, [['Sign in to switch calendars', 'error']], '…and it says why');

    const first = settings({ token: '', resync: { added: 0, removed: 0, kept: 0, error: 'Sign in to sync' } });
    const done = first.window.onCalendarTargetChange(first.selectFor('psy'));
    await flush();
    first.log.modals[0].answer(true);
    await done;
    t.eq(first.log.setCfg.length, 1, 'a FIRST pick while signed out is still allowed (nothing to sweep)');
    t.eq(first.log.toasts, [['Calendar saved, not synced yet — Sign in to sync', 'info']], '…and is honest that nothing was synced');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Calendar safety: "Re-sync now" asks too while the calendar is un-owned');
  {
    const s = settings({ count: 5, cfg: { mode: 'custom', targetId: 'home', ownedAck: false } });
    const btn = s.button();
    const done = s.window.onCalendarResync(btn);
    await flush();
    t.eq(s.log.modals.length, 1, 'a pre-contract target → the ownership dialog first');
    t.eq(s.log.counted, ['home'], '…with the count for the STORED target');
    t.eq([s.log.modals[0].opts.cancelText, s.log.modals[0].opts.danger], ['Not now', true], '…danger-styled, cancel reads "Not now"');
    t.ok(/"Home" has 5 upcoming events/.test(s.log.modals[0].opts.body), '…naming the calendar from the select');
    s.log.modals[0].answer(false);
    await done;
    t.eq(s.log.resync.length, 0, 'declined → no resync at all');
    t.eq([btn.disabled, btn.textContent], [false, 'Re-sync now'], '…and the button is released, label untouched');

    const yes = settings({ cfg: { mode: 'custom', targetId: 'home', ownedAck: false } });
    const done2 = yes.window.onCalendarResync(yes.button());
    await flush();
    yes.log.modals[0].answer(true);
    await done2;
    t.eq(yes.log.resync, [{ ownedAck: true }], 'agreed → the resync carries ownedAck:true');
  }
  {
    const owned = settings({ cfg: { mode: 'custom', targetId: 'home', ownedAck: true } });
    await owned.window.onCalendarResync(owned.button());
    t.eq([owned.log.modals.length, owned.log.resync.length, owned.log.resync[0]], [0, 1, undefined], 'an owned calendar re-syncs without asking (and grants nothing)');

    const none = settings({ resync: { added: 0, removed: 0, kept: 0, error: 'No calendar selected' } });
    const btn = none.button();
    await none.window.onCalendarResync(btn);
    t.eq([none.log.modals.length, btn.textContent], [0, 'No calendar selected'], 'no calendar chosen → no dialog, the bridge\'s error is shown');

    const out = settings({ token: '', cfg: { mode: 'custom', targetId: 'home', ownedAck: false }, resync: { added: 0, removed: 0, kept: 0, error: 'Sign in to sync' } });
    const b2 = out.button();
    await out.window.onCalendarResync(b2);
    t.eq([out.log.modals.length, b2.textContent], [0, 'Sign in to sync'], 'signed out → no ownership question for a sync that cannot run');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Calendar safety: the buttons never call a skipped reconcile a sync');
  {
    const label = async (resync) => {
      const s = settings({ cfg: { mode: 'custom', targetId: 'home', ownedAck: true }, resync: resync });
      const btn = s.button();
      await s.window.onCalendarResync(btn);
      const shown = btn.textContent;
      s.log.timers.forEach((fn) => fn());
      return [shown, btn.textContent, btn.disabled];
    };
    t.eq(await label({ added: 0, removed: 0, kept: 0, skipped: 'unconfirmed empty bookings snapshot' }), ['Bookings not loaded', 'Re-sync now', false],
      'skipped (bookings not loaded) → "Bookings not loaded", then the button resets');
    t.eq((await label({ added: 0, removed: 0, kept: 0, skipped: 'signed out' }))[0], 'Sign in to sync', 'skipped: signed out → "Sign in to sync"');
    t.eq((await label({ added: 0, removed: 0, kept: 0, skipped: 'busy' }))[0], 'Already syncing', 'a pass already in flight → "Already syncing"');
    t.eq((await label({ added: 0, removed: 0, kept: 0, error: 'Sign in to sync' }))[0], 'Sign in to sync', 'an error is shown as it is');
    t.eq((await label(null))[0], 'Sync failed', 'no result at all is a failure, not a success');
    t.eq((await label({ added: 0, removed: 0, kept: 0 }))[0], 'Synced ✓', 'a reconcile that really ran with nothing to do still reads "Synced ✓"');
    t.eq((await label({ added: 0, removed: 0, kept: 3 }))[0], 'All 3 up to date', '…or "All N up to date"');
    t.eq((await label({ added: 2, removed: 1, kept: 0 }))[0], 'Synced (+2 −1)', '…or the counts');

    const dupes = async (cleanup) => {
      const s = settings({ cleanup: cleanup });
      const btn = { textContent: 'Remove duplicates', disabled: false };
      await s.window.onCalendarCleanupDupes(btn);
      return btn.textContent;
    };
    t.eq(await dupes({ scanned: 0, removed: 0, skipped: 'unconfirmed empty bookings snapshot' }), 'Bookings not loaded', '"Remove duplicates": skipped is not "No duplicates"');
    t.eq(await dupes({ scanned: 0, removed: 0, error: 'Sign in to sync' }), 'Sign in to sync', '…nor is a refused one');
    t.eq(await dupes({ scanned: 4, removed: 0 }), 'No duplicates', 'a real scan with nothing to remove still reads "No duplicates"');
    t.eq(await dupes({ scanned: 4, removed: 2 }), 'Removed 2', '…and a real removal its count');
  }
};
