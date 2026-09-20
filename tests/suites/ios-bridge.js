'use strict';
// iOS bridge (ios-app/www/native-bridge.js) + the two web-side pieces that only
// matter inside the app: the class-reminder switch (js/tabs.js) and the native
// settings export (js/settings.js).
//
// The bridge is evaluated for real, in its own vm context, against a FAKE
// Capacitor: fake plugins that record calls, fake timers + clock the test
// advances by hand, a fake localStorage and the few DOM lookups the bridge
// makes. Nothing native, no network. If the bridge starts touching a new global
// at load, boot() throws and the suite reports a crash — add the stub here.
//
// The harness (the fake Capacitor, its clock and boot()) is also exported as
// `module.exports.harness`, for a suite that boots the same bridge as ANOTHER
// platform: tests/suites/18-android.js. Everything it added is opt-in — with no
// new option the fake is what it always was (no Capacitor.getPlatform at all).

function harness(t) {
  const BRIDGE_SRC = t.readSource('ios-app/www/native-bridge.js');

  // Drain every pending microtask (setImmediate runs after the queue is empty),
  // however deep the promise chain inside the bridge is.
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  function makeClock() {
    let now = Date.UTC(2026, 8, 17, 9, 0, 0);
    let seq = 0;
    const timers = new Map();
    return {
      now: () => now,
      setTimeout(fn, ms) { const id = ++seq; timers.set(id, { id, at: now + (Number(ms) || 0), fn }); return id; },
      clearTimeout(id) { timers.delete(id); },
      // A suspended web process: the wall clock moves on, no timer runs
      // (overdue ones fire on the next advance, as they do on resume).
      skip(ms) { now += ms; },
      // Run every timer due within `ms`, in order, letting promises settle
      // between them — the same interleaving a browser gives.
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

  // Same semantics as PsycleEvents in js/state.js — including that emit() walks
  // the LIVE handler array, which is what makes a self-removing listener risky.
  function makeEvents() {
    return {
      _handlers: {},
      on(event, fn) {
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(fn);
        return () => this.off(event, fn);
      },
      off(event, fn) {
        const list = this._handlers[event];
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx !== -1) list.splice(idx, 1);
      },
      emit(event, ...args) {
        const list = this._handlers[event];
        if (!list || list.length === 0) return;
        for (const fn of list) fn(...args);
      },
    };
  }

  // The real registry's id → base pairs when they can be read out of theme.js,
  // so a new light theme is covered without touching this file. (`bg`, the
  // theme's ground, rides along when the entry has one: the Android status bar
  // wears it — 18-android.js.)
  function themeRegistry() {
    const found = [];
    const re = /\{\s*id:\s*'([\w-]+)'[^}]*?base:\s*'(light|dark)'(?:[^}]*?bg:\s*'(#[0-9a-fA-F]{6})')?/g;
    let m;
    try {
      const src = t.readSource('js/theme.js');
      while ((m = re.exec(src))) found.push(m[3] ? { id: m[1], base: m[2], bg: m[3] } : { id: m[1], base: m[2] });
    } catch (e) { /* fall through to the literal registry */ }
    const usable = found.some((x) => x.base === 'light') && found.some((x) => x.base === 'dark');
    return usable ? found : [
      { id: 'cloud', base: 'light' }, { id: 'linen', base: 'light' },
      { id: 'graphite', base: 'dark' }, { id: 'terminal', base: 'dark' },
    ];
  }

  /**
   * Evaluate the bridge with a fake Capacitor. opts:
   *   local   {key: value}  localStorage before launch
   *   native  {key: value}  Capacitor Preferences before launch
   *   prefGet (key) => Promise   override Preferences.get
   *   perm    'prompt' | 'granted' | 'denied'
   *   deny    true → the iOS prompt is answered "Don't Allow"
   *   removeDelivered  true | 'reject' → the plugin has removeDeliveredNotifications
   *   theme   data-theme at launch;  systemLight  prefers-color-scheme: light
   *   platform  'ios' | 'android' → Capacitor.getPlatform() answers it (left out:
   *             no getPlatform at all, the fake every older section boots)
   *   plugins   {Name: impl}, or (rec) => that: more plugins (a fake calendar,
   *             the iOS-only ones); rec(name, arg) writes to calls.plugin
   *   channelsFail  true → createChannel rejects (Android before 8 has none)
   *   userAgent navigator.userAgent
   * calls.plugin is the ORDERED log of every call on the built-in fakes —
   * ['Plugin.method', argument] — and calls.warns / calls.errors what the
   * bridge said on console.warn / console.error.
   */
  function boot(opts) {
    opts = opts || {};
    const clock = makeClock();
    const events = makeEvents();
    const ls = t.makeFakeLocalStorage();
    Object.keys(opts.local || {}).forEach((k) => ls.setItem(k, opts.local[k]));
    const native = Object.assign({}, opts.native || {});

    const calls = { prefGet: [], prefSet: [], setStyle: [], scheduled: [], cancelled: [], removedDelivered: [], requested: 0, switchTab: [], opened: [], toasts: [], modals: [], rowRenders: 0, restoreResolved: 0,
      setBackgroundColor: [], channels: [], plugin: [], warns: [], errors: [] };
    const rec = (name, arg) => { calls.plugin.push(arg === undefined ? [name] : [name, arg]); };
    const state = { perm: opts.perm || 'prompt' };
    // ids = elements that exist; styles = inline style per id (#bikeModal is
    // permanent markup the app shows/hides through style.display).
    const dom = { ids: new Set(), styles: {}, theme: opts.theme === undefined ? 'graphite' : opts.theme, activePanel: 'tab-discover', visibility: 'visible', observers: [] };
    const listeners = {};

    const plugins = {
      Preferences: {
        get(o) {
          rec('Preferences.get', o.key);
          calls.prefGet.push(o.key);
          if (opts.prefGet) return opts.prefGet(o.key);
          return Promise.resolve({ value: Object.prototype.hasOwnProperty.call(native, o.key) ? native[o.key] : null });
        },
        set(o) { rec('Preferences.set', o.key); calls.prefSet.push(o.key); native[o.key] = o.value; return Promise.resolve(); },
        remove(o) { rec('Preferences.remove', o.key); delete native[o.key]; return Promise.resolve(); },
      },
      // setBackgroundColor and createChannel are on the iOS proxies too (the
      // native side answers "unimplemented"), so they are always here: a test
      // can then SEE that only the Android app calls them.
      StatusBar: {
        setStyle(o) { rec('StatusBar.setStyle', o); calls.setStyle.push(o.style); return Promise.resolve(); },
        setBackgroundColor(o) { rec('StatusBar.setBackgroundColor', o); calls.setBackgroundColor.push(o.color); return Promise.resolve(); },
      },
      LocalNotifications: {
        checkPermissions() { rec('LocalNotifications.checkPermissions'); return Promise.resolve({ display: state.perm }); },
        createChannel(o) {
          rec('LocalNotifications.createChannel', o);
          calls.channels.push(o);
          return opts.channelsFail ? Promise.reject(new Error('unavailable')) : Promise.resolve();
        },
        requestPermissions() {
          rec('LocalNotifications.requestPermissions');
          calls.requested++;
          state.perm = opts.deny ? 'denied' : 'granted';
          return Promise.resolve({ display: state.perm });
        },
        registerActionTypes(o) { rec('LocalNotifications.registerActionTypes', o); return Promise.resolve(); },
        addListener(name, fn) { rec('LocalNotifications.addListener', name); listeners[name] = fn; },
        schedule(o) { rec('LocalNotifications.schedule', o); calls.scheduled.push(o); return Promise.resolve(); },
        cancel(o) { rec('LocalNotifications.cancel', o); calls.cancelled.push(o); return Promise.resolve(); },
      },
    };
    // Optional in the bridge's eyes (it feature-tests the method), so only
    // the cases that ask for it get one.
    if (opts.removeDelivered) {
      plugins.LocalNotifications.removeDeliveredNotifications = (o) => {
        rec('LocalNotifications.removeDeliveredNotifications', o);
        calls.removedDelivered.push(o);
        return opts.removeDelivered === 'reject' ? Promise.reject(new Error('nope')) : Promise.resolve();
      };
    }
    // A function is handed the recorder, so its fakes land in calls.plugin too.
    const extra = (typeof opts.plugins === 'function' ? opts.plugins(rec) : opts.plugins) || {};
    Object.keys(extra).forEach((name) => { plugins[name] = extra[name]; });
    const capacitor = { Plugins: plugins, isNativePlatform: () => true };
    if (opts.platform) capacitor.getPlatform = () => opts.platform;

    const ctx = {
      console: { log() {}, warn(...a) { calls.warns.push(a.map(String).join(' ')); }, error(...a) { calls.errors.push(a.map(String).join(' ')); } },
      localStorage: ls,
      navigator: opts.userAgent ? { onLine: true, userAgent: opts.userAgent } : { onLine: true },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      __now: clock.now,
      Capacitor: capacitor,
      PsycleEvents: events,
      _eventCache: {},
      _myBookings: {},
      APP_THEMES: themeRegistry(),
      matchMedia: (q) => ({ matches: !!opts.systemLight && /light/.test(q) }),
      MutationObserver: function (cb) { dom.observers.push(cb); this.observe = function () {}; },
      document: {
        documentElement: { getAttribute: (n) => (n === 'data-theme' ? dom.theme : null) },
        getElementById: (id) => (dom.ids.has(id) ? { id, style: dom.styles[id] || {} } : null),
        querySelector: (sel) => (sel === '.tab-panel.active' && dom.activePanel ? { id: dom.activePanel } : null),
        addEventListener() {},
        get visibilityState() { return dom.visibility; },
      },
      switchTab(tab) { calls.switchTab.push(tab); dom.activePanel = 'tab-' + tab; },
      openClassDetail(id) { calls.opened.push(id); },
      toast(msg, kind) { calls.toasts.push([msg, kind]); },
      renderReminderRow() { calls.rowRenders++; },
      // Records the dialog and hands the test its buttons. replace() is what a
      // second confirmModal does to the one on screen (app.js): tell the owner
      // it was displaced, then settle it as cancelled.
      confirmModal(o) {
        return new Promise((resolve) => {
          calls.modals.push({ opts: o, answer: resolve, replace() { if (typeof o.onReplaced === 'function') o.onReplaced(); resolve(false); } });
        });
      },
      _psycleNativeRestoreResolve() { calls.restoreResolved++; },
    };
    ctx.window = ctx;
    ctx.self = ctx;
    t.vm.createContext(ctx);
    t.vm.runInContext('Date.now = __now;', ctx);
    t.vm.runInContext(BRIDGE_SRC, ctx, { filename: 'native-bridge.js[fake-capacitor]' });

    return {
      ctx, clock, events, ls, native, calls, state, dom,
      setTheme(id) { dom.theme = id; dom.observers.forEach((cb) => cb()); },
      // `over`: other fields of the notification — a forged one brings its own title and body (18-android.js).
      tap(extra, actionId, over) {
        listeners.localNotificationActionPerformed({ actionId: actionId || 'tap', notification: Object.assign({ title: 'T', body: 'B', extra: extra }, over || {}) });
      },
      rec,
    };
  }

  return { boot, flush, themeRegistry, makeClock, makeEvents };
}

module.exports = async function (t) {
  const { boot, flush, themeRegistry } = harness(t);

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS bridge: status bar style follows the theme base');
  // The plugin's enum names the BACKGROUND: 'LIGHT' = dark text for light
  // backgrounds, 'DARK' = light text for dark backgrounds.
  {
    const reg = themeRegistry();
    const b = boot({ theme: reg.find((x) => x.base === 'light').id });
    await flush();
    t.eq(b.calls.setStyle[b.calls.setStyle.length - 1], 'LIGHT', 'a light-base theme at launch asks for LIGHT (dark glyphs)');
    let wrong = [];
    reg.forEach((th) => {
      b.setTheme(th.id);
      const got = b.calls.setStyle[b.calls.setStyle.length - 1];
      if (got !== (th.base === 'light' ? 'LIGHT' : 'DARK')) wrong.push(th.id + '→' + got);
    });
    t.eq(wrong, [], 'every registered theme maps light→LIGHT / dark→DARK after a theme change');
    b.setTheme('no-such-theme');
    t.eq(b.calls.setStyle[b.calls.setStyle.length - 1], 'DARK', 'an unknown theme id falls back to the dark base (light glyphs)');

    const sysLight = boot({ theme: null, systemLight: true });
    t.eq(sysLight.calls.setStyle[0], 'LIGHT', 'no data-theme + system light scheme → LIGHT');
    const sysDark = boot({ theme: null, systemLight: false });
    t.eq(sysDark.calls.setStyle[0], 'DARK', 'no data-theme + system dark scheme → DARK');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS bridge: launch restore (Preferences → localStorage)');
  {
    const b = boot({
      local: { psycle_theme: 'cloud' },
      native: { psycle_theme: 'graphite', psycle_bearer_token_enc: 'aes:abc', psycle_class_reminder_asked: '1' },
    });
    t.ok(b.ctx._psycleNativeRestoreDone === false, 'the handshake is not released synchronously');
    await flush();
    t.ok(!b.calls.prefGet.includes('psycle_theme'), 'a key localStorage already has costs no bridge read');
    t.eq(b.ls.getItem('psycle_theme'), 'cloud', '…and is never overwritten by the mirrored copy');
    t.eq(b.ls.getItem('psycle_bearer_token_enc'), 'aes:abc', 'a missing key is restored');
    t.eq(b.ls.getItem('psycle_class_reminder_asked'), '1', 'the reminder-asked flag survives a storage purge');
    t.ok(!b.calls.prefSet.includes('psycle_bearer_token_enc'), 'a restored value is not echoed straight back into Preferences');
    t.ok(b.ctx._psycleNativeRestoreDone === true && b.calls.restoreResolved === 1, 'the security.js handshake resolves exactly once');

    b.ls.setItem('psycle_history_prompt_dismissed', '1');
    b.ls.setItem('psycle_class_reminder_asked', '1');
    t.ok(b.calls.prefSet.includes('psycle_history_prompt_dismissed') && b.calls.prefSet.includes('psycle_class_reminder_asked'),
      'both one-time-answer keys are mirrored to Preferences');
  }
  {
    // Reads are issued together, and the handshake waits for ALL of them —
    // including when one of them fails.
    const pending = {};
    const b = boot({
      prefGet: (key) => {
        if (key === 'psycle_bearer_token') return Promise.reject(new Error('bridge hiccup'));
        return new Promise((resolve) => { pending[key] = resolve; });
      },
    });
    await flush();
    t.ok(Object.keys(pending).length > 10, 'every missing key is requested before any answer arrives (no serial await): ' + Object.keys(pending).length + ' in flight');
    t.ok(b.ctx._psycleNativeRestoreDone === false, 'one rejected read does not release the handshake early');

    b.ctx.localStorage.setItem('psycle_bearer_token_enc', 'aes:fresh'); // written while the read is in flight
    Object.keys(pending).forEach((key) => pending[key]({ value: key === 'psycle_bearer_token_enc' ? 'aes:stale' : (key === 'psycle_fav_instructors' ? '[7]' : null) }));
    await flush();
    t.eq(b.ls.getItem('psycle_bearer_token_enc'), 'aes:fresh', 'a value written during the wait is not overwritten by the stale mirror');
    t.eq(b.ls.getItem('psycle_fav_instructors'), '[7]', 'the other keys still restore when one read rejected');
    t.ok(b.ctx._psycleNativeRestoreDone === true && b.calls.restoreResolved === 1, 'the handshake resolves once the whole batch settled');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS bridge: a tapped notification lands somewhere');
  // The sheet only opens for a class the user still holds a seat in, so every
  // case seeds the booking too (as fetchMyBookings builds it) — otherwise the
  // "no sheet" cases below would pass for the wrong reason.
  const seat = (id) => ({ bookingId: id, bookingIds: [id], slots: [7], slotBookings: { 7: id }, waitlisted: false });
  {
    const b = boot();
    b.tap(undefined);
    t.eq(b.calls.switchTab, ['discover'], 'weekly reminder (no eventId) → Discover');
    t.eq(b.calls.opened, [], '…and opens no sheet');
  }
  {
    const b = boot();
    b.ctx._eventCache['123'] = { id: 123 };
    b.ctx._myBookings['123'] = seat(123);
    b.tap({ eventId: 123 });
    t.eq(b.calls.switchTab, ['bookings'], 'class reminder → My Bookings');
    t.eq(b.calls.opened, ['123'], '…and the class sheet opens at once when the event is cached (string key)');
  }
  {
    // Cold start: the tap beats the bookings fetch.
    const b = boot();
    const loadedHandlers = () => (b.events._handlers['bookings:loaded'] || []).length;
    const before = loadedHandlers();
    b.tap({ eventId: '55' });
    t.eq(b.calls.opened, [], 'nothing opens while the event is unknown');
    t.eq(loadedHandlers(), before + 1, '…it waits on bookings:loaded instead');
    let laterListenerRan = 0;
    b.events.on('bookings:loaded', () => { laterListenerRan++; }); // registered AFTER the bridge's one-shot
    b.ctx._eventCache['55'] = { id: 55 };
    b.ctx._myBookings['55'] = seat(55);
    b.events.emit('bookings:loaded', {});
    t.eq(b.calls.opened, ['55'], 'the sheet opens on the first bookings:loaded');
    t.eq(laterListenerRan, 1, 'a listener registered after the one-shot still gets that same emit (no mid-emit splice)');
    await b.clock.advance(50);
    b.events.emit('bookings:loaded', {});
    t.eq(b.calls.opened, ['55'], 'it is a one-shot — a later bookings:loaded opens nothing more');
    t.eq(loadedHandlers(), before + 1, 'the one-shot listener is unsubscribed (only this test\'s own listener is left)');
  }
  {
    const b = boot();
    const before = (b.events._handlers['bookings:loaded'] || []).length;
    b.tap({ eventId: '77' });
    await b.clock.advance(10500);
    t.eq(b.events._handlers['bookings:loaded'].length, before, 'after ~10s the wait is dropped and its listener removed');
    b.ctx._eventCache['77'] = { id: 77 };
    b.ctx._myBookings['77'] = seat(77);
    b.events.emit('bookings:loaded', {});
    t.eq(b.calls.opened, [], 'bookings that load ~10s+ after the tap never pop a sheet late');
  }
  {
    // Suspended right after the tap: the 10s timer froze with the process, so
    // it has NOT fired when bookings finally load — only the clock knows.
    const b = boot();
    const before = (b.events._handlers['bookings:loaded'] || []).length;
    b.tap({ eventId: '78' });
    b.clock.skip(3 * 3600 * 1000);
    b.ctx._eventCache['78'] = { id: 78 };
    b.ctx._myBookings['78'] = seat(78);
    b.events.emit('bookings:loaded', {});
    t.eq(b.calls.opened, [], 'a frozen give-up timer cannot let a sheet pop hours after the tap (judged by the clock)');
    await b.clock.advance(50);
    t.eq(b.events._handlers['bookings:loaded'].length, before, '…and that late emit still ends the wait (listener removed)');
  }
  {
    // Still inside the window: a slow-but-timely load opens the sheet.
    const b = boot();
    b.tap({ eventId: '79' });
    await b.clock.advance(9000);
    b.ctx._eventCache['79'] = { id: 79 };
    b.ctx._myBookings['79'] = seat(79);
    b.events.emit('bookings:loaded', {});
    t.eq(b.calls.opened, ['79'], 'bookings that load within the wait still open the sheet');
  }
  {
    const b = boot();
    b.tap({ eventId: '88' });
    b.ctx.switchTab('stats'); // the user moved on while bookings were loading
    b.ctx._eventCache['88'] = { id: 88 };
    b.ctx._myBookings['88'] = seat(88);
    b.events.emit('bookings:loaded', {});
    t.eq(b.calls.opened, [], 'no sheet if the user has left My Bookings in the meantime');
  }
  {
    const b = boot();
    b.tap({ eventId: '1' });
    b.tap({ eventId: '2' });
    b.ctx._eventCache['1'] = { id: 1 };
    b.ctx._eventCache['2'] = { id: 2 };
    b.ctx._myBookings['1'] = seat(1);
    b.ctx._myBookings['2'] = seat(2);
    b.events.emit('bookings:loaded', {});
    t.eq(b.calls.opened, ['2'], 'only the latest tap may still open a sheet');
  }
  {
    // The banner outlives the booking: cancelled in-app, the class stays in
    // _eventCache and its sheet would offer a live "Book".
    const b = boot();
    b.ctx._eventCache['40'] = { id: 40 };
    b.tap({ eventId: 40 });
    t.eq(b.calls.switchTab, ['bookings'], 'a reminder for a class since cancelled still lands on My Bookings');
    t.eq(b.calls.opened, [], '…but opens no sheet (it would show a live Book button)');
    b.events.emit('bookings:loaded', {});
    t.eq(b.calls.opened, [], '…nor when the foreground refresh confirms it is gone');

    const w = boot();
    w.ctx._eventCache['41'] = { id: 41 };
    w.ctx._myBookings['41'] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 9 } };
    w.tap({ eventId: 41 });
    t.eq(w.calls.opened, [], 'a waitlist place is not a held seat — no sheet either');

    // Cold start: the cache may already know the class (restored search
    // results) before /bookings has answered.
    const c = boot();
    c.ctx._eventCache['42'] = { id: 42 };
    c.tap({ eventId: 42 });
    t.eq(c.calls.opened, [], 'cached but bookings not loaded yet → waits');
    c.ctx._myBookings['42'] = seat(42);
    c.events.emit('bookings:loaded', {});
    t.eq(c.calls.opened, ['42'], '…and opens once /bookings shows the seat');
  }
  {
    const b = boot();
    b.tap({ eventId: '9' }, 'SNOOZE');
    t.eq(b.calls.switchTab, [], 'SNOOZE does not route into the web app');
    t.ok(b.calls.scheduled.length === 1 && b.calls.scheduled[0].notifications[0].extra.eventId === '9', 'SNOOZE re-schedules the reminder with its payload');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS bridge: class-reminder permission ask (first booking only)');
  {
    const b = boot({ perm: 'prompt' });
    await b.clock.advance(60000);
    t.ok(b.calls.modals.length === 0 && b.calls.requested === 0, 'nothing is asked at launch, however long the app sits there');

    // submitBooking shows the sheet BEFORE emitting; claim flows emit first.
    b.events.emit('booking:complete', '5', [12]);
    b.dom.ids.add('bookingConfirmation');
    await b.clock.advance(5000);
    t.eq(b.calls.modals.length, 0, 'not while the "Booked!" sheet is up');
    b.dom.ids.delete('bookingConfirmation');
    await b.clock.advance(1000);
    t.eq(b.calls.modals.length, 0, 'not in the first clear moment either (a follow-up dialog may be about to open)');
    await b.clock.advance(1000);
    t.eq(b.calls.modals.length, 1, 'asked once the UI has stayed clear');
    t.eq(b.calls.modals[0].opts.cancelText, 'Not now', 'the cancel button is "Not now" (confirmModal defaults to "Keep booking")');
    t.eq(b.calls.requested, 0, 'the iOS prompt waits for an in-app yes');
    t.eq(b.ls.getItem('psycle_class_reminder_asked'), null, 'not marked asked until answered');

    b.calls.modals[0].answer(true);
    await flush();
    t.eq(b.calls.requested, 1, 'yes → the iOS permission prompt');
    t.eq(b.ls.getItem('psycle_class_reminder_asked'), '1', 'answered → remembered');
    t.eq(b.ls.getItem('psycle_class_reminders'), 'on', 'granted → reminders armed');
    t.ok(b.calls.toasts.some((x) => x[1] === 'success'), 'granted → success toast');
    t.ok(b.calls.rowRenders >= 1, 'the Settings switch is repainted');
  }
  {
    const b = boot({ perm: 'prompt' });
    b.events.emit('booking:complete', '5', []);
    b.events.emit('booking:complete', '6', []);
    b.events.emit('booking:complete', '7', []); // "book my week" burst
    await b.clock.advance(3000);
    t.eq(b.calls.modals.length, 1, 'a burst of bookings asks once');
    b.calls.modals[0].answer(false);
    await flush();
    t.eq(b.calls.requested, 0, '"Not now" never reaches the iOS prompt');
    t.eq(b.ls.getItem('psycle_class_reminder_asked'), '1', '"Not now" is an answer');
    b.events.emit('booking:complete', '8', []);
    await b.clock.advance(5000);
    t.eq(b.calls.modals.length, 1, '…so a later booking does not ask again');
  }
  {
    const b = boot({ perm: 'prompt' });
    b.events.emit('booking:complete', '5', []);
    await b.clock.advance(3000);
    b.calls.modals[0].replace(); // another confirmModal (e.g. the "You're in" allocation notice) displaced it
    await flush();
    t.eq(b.ls.getItem('psycle_class_reminder_asked'), null, 'a displaced dialog is not an answer');
    t.eq(b.calls.requested, 0, '…and never triggers the iOS prompt');
    b.events.emit('booking:complete', '6', []);
    await b.clock.advance(3000);
    t.eq(b.calls.modals.length, 2, '…so the next booking asks again');
  }
  {
    const b = boot({ perm: 'prompt' });
    b.dom.ids.add('psycleConfirmOverlay');
    b.events.emit('booking:complete', '5', []);
    await b.clock.advance(45000);
    b.dom.ids.delete('psycleConfirmOverlay');
    await b.clock.advance(10000);
    t.eq(b.calls.modals.length, 0, 'a dialog that blocks for ~40s+ drops the ask instead of popping it late');
    b.events.emit('booking:complete', '6', []);
    await b.clock.advance(3000);
    t.eq(b.calls.modals.length, 1, '…and a later booking gets another chance');
  }
  {
    // Booking rush: "Booked!" is dismissed and the next class's sheet / seat
    // picker is already open — the ask sits above both, so it must wait.
    const b = boot({ perm: 'prompt' });
    b.events.emit('booking:complete', '5', [12]);
    b.dom.ids.add('classDetailOverlay');
    await b.clock.advance(4000);
    t.eq(b.calls.modals.length, 0, 'not over the class sheet');
    b.dom.ids.delete('classDetailOverlay');
    b.dom.ids.add('bikeModal');
    b.dom.styles.bikeModal = { display: 'flex' };
    await b.clock.advance(4000);
    t.eq(b.calls.modals.length, 0, 'not over the open seat picker (static markup, shown through style.display)');
    b.dom.styles.bikeModal = { display: 'none' };
    await b.clock.advance(1000);
    t.eq(b.calls.modals.length, 0, 'a closed picker still in the DOM does not block — but one clear poll is not enough');
    await b.clock.advance(1000);
    t.eq(b.calls.modals.length, 1, 'asked two clear polls after the picker closes');
  }
  {
    const blockers = ['syncPromptOverlay', 'onboardOverlay', 'instructorModalOverlay', 'historyModalOverlay', 'settingsOverlay', 'diagOverlay', 'yearReviewOverlay'];
    const stacked = [];
    for (const id of blockers) {
      const b = boot({ perm: 'prompt' });
      b.dom.ids.add(id);
      b.events.emit('booking:complete', '5', []);
      await b.clock.advance(6000);
      if (b.calls.modals.length) stacked.push(id);
    }
    t.eq(stacked, [], 'never stacked on the welcome/sync prompt, the tour or any other overlay');

    const b = boot({ perm: 'prompt' });
    b.dom.ids.add('bikeModal'); // always in the page
    b.dom.styles.bikeModal = { display: 'none' };
    b.events.emit('waitlist:joined', '5');
    await b.clock.advance(6000);
    t.eq(b.calls.modals.length, 0, 'joining a waitlist is not a booking — no ask');
    b.events.emit('booking:complete', '5', []);
    await b.clock.advance(2000);
    t.eq(b.calls.modals.length, 1, 'the hidden picker markup alone never blocks the ask');
  }
  {
    // Booked, then straight onto a waitlist for the next class: the ask was
    // still waiting for "Booked!" to clear. Opening it after "On the
    // waitlist!" would read as a reminder for a place that never gets one.
    const b = boot({ perm: 'prompt' });
    b.events.emit('booking:complete', '5', [12]);
    b.dom.ids.add('bookingConfirmation');
    await b.clock.advance(1500);
    b.events.emit('waitlist:joined', '6'); // its sheet reuses #bookingConfirmation
    await b.clock.advance(3000);
    b.dom.ids.delete('bookingConfirmation');
    await b.clock.advance(10000);
    t.eq(b.calls.modals.length, 0, 'a waitlist join drops the ask that was waiting its turn');
    t.eq(b.ls.getItem('psycle_class_reminder_asked'), null, '…without recording an answer');
    b.events.emit('booking:complete', '7', []);
    await b.clock.advance(3000);
    t.eq(b.calls.modals.length, 1, '…and the next real booking asks');
  }
  {
    const granted = boot({ perm: 'granted' });
    granted.events.emit('booking:complete', '5', []);
    await granted.clock.advance(5000);
    const denied = boot({ perm: 'denied' });
    denied.events.emit('booking:complete', '5', []);
    await denied.clock.advance(5000);
    const off = boot({ perm: 'prompt', local: { psycle_class_reminders: 'off' } });
    off.events.emit('booking:complete', '5', []);
    await off.clock.advance(5000);
    t.eq([granted.calls.modals.length, denied.calls.modals.length, off.calls.modals.length], [0, 0, 0],
      'no ask when already granted, already denied, or reminders are switched off');
    t.eq(denied.ls.getItem('psycle_class_reminder_asked'), null, 'a skipped ask is not recorded as answered');
  }
  {
    const b = boot({ perm: 'prompt', deny: true });
    b.events.emit('booking:complete', '5', []);
    await b.clock.advance(3000);
    b.calls.modals[0].answer(true);
    await flush();
    t.ok(b.calls.requested === 1 && !b.calls.toasts.some((x) => x[1] === 'success'), 'yes, then "Don\'t Allow" on the iOS prompt → no success toast');
    t.ok(await b.ctx._nativeClassReminders.hasPermission() === false, '…and hasPermission() reports false for the Settings switch');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('iOS bridge: a cancelled class takes its delivered banner with it');
  {
    const map = JSON.stringify({ 40: { id: 8040, startAt: '2026-09-17T18:00:00' } });
    const b = boot({ perm: 'granted', removeDelivered: true, local: { psycle_class_reminder_map: map } });
    b.events.emit('bookings:loaded', {}); // /bookings no longer has class 40
    await flush();
    t.eq(b.calls.cancelled.map((o) => o.notifications), [[{ id: 8040 }]], 'the pending reminder is cancelled');
    t.eq(b.calls.removedDelivered.map((o) => o.notifications), [[{ id: 8040 }]], '…and an already-delivered banner is pulled from Notification Center');
    t.eq(b.ls.getItem('psycle_class_reminder_map'), '{}', '…and forgotten');

    const old = boot({ perm: 'granted', local: { psycle_class_reminder_map: map } }); // plugin without the method
    old.events.emit('bookings:loaded', {});
    await flush();
    t.eq(old.ls.getItem('psycle_class_reminder_map'), '{}', 'a plugin without removeDeliveredNotifications still reconciles');

    const bad = boot({ perm: 'granted', removeDelivered: 'reject', local: { psycle_class_reminder_map: map } });
    bad.events.emit('bookings:loaded', {});
    await flush();
    t.eq(bad.ls.getItem('psycle_class_reminder_map'), '{}', 'a failing removal never stops the reconcile');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Class-reminder switch (js/tabs.js)');
  {
    const p = t.loadPure('js/tabs.js', 'reminder-row');
    const normal = p._classReminderSwitch(true, true).detail;
    t.eq(p._classReminderSwitch(true, true).on, true, 'pref on + permission granted → ON');
    t.eq(p._classReminderSwitch(true, false).on, false, 'pref on but permission NOT granted → OFF (it never armed)');
    t.eq(p._classReminderSwitch(true, false).detail, 'Tap to allow notifications', '…and the detail says what a tap does');
    t.eq(p._classReminderSwitch(true, null).on, true, 'permission not resolved yet → first paint goes by the pref');
    t.eq(p._classReminderSwitch(false, true).on, false, 'pref off → OFF');
    t.eq(p._classReminderSwitch(false, false).detail, normal, 'pref off keeps the normal detail (tapping turns it on, which prompts)');
    t.ok(!/[<>&"']/.test(p._classReminderSwitch(true, false).detail + normal), 'detail strings are safe to drop into innerHTML');
  }
  {
    // The SHIPPED row + toggle (sliced out of the tabs.js IIFE), against a
    // fake bridge whose permission the test flips the way iOS Settings does.
    const tabsSrc = t.readSource('js/tabs.js');
    const from = tabsSrc.indexOf('  var _classReminderGranted = null;');
    const to = tabsSrc.indexOf('  window._toggleReminder = async function () {');
    t.ok(from !== -1 && to > from, 'reminder row + class toggle found in tabs.js');
    const bootRow = (perm) => {
      const log = { toasts: [], enabled: 0, disabled: 0, onVisible: [] };
      const st = { perm: perm, pref: true, visibility: 'visible' };
      const row = { innerHTML: '' };
      const ctx = {
        toast: (m, k) => log.toasts.push([m, k]),
        document: {
          getElementById: (id) => (id === 'reminderRow' ? row : null),
          addEventListener: (name, fn) => { if (name === 'visibilitychange') log.onVisible.push(fn); },
          get visibilityState() { return st.visibility; },
        },
        _nativeReminder: { isOn: () => false },
        _nativeClassReminders: {
          isOn: () => st.pref,
          hasPermission: async () => st.perm === 'granted',
          enable: async () => { log.enabled++; if (st.perm !== 'granted') return false; st.pref = true; return true; },
          disable: async () => { log.disabled++; st.pref = false; },
        },
      };
      ctx.window = ctx;
      t.vm.createContext(ctx);
      t.vm.runInContext(tabsSrc.slice(from, to), ctx, { filename: 'tabs.js[reminder-row]' });
      const classRow = () => row.innerHTML.slice(row.innerHTML.indexOf('Class reminders'));
      return {
        ctx, log, st,
        blocked: () => /Tap to allow notifications/.test(classRow()),
        on: () => /app-row-switch on/.test(classRow()),
        foreground: () => log.onVisible.forEach((fn) => fn()),
      };
    };

    const r = bootRow('denied');
    r.ctx.renderReminderRow();
    await flush();
    t.ok(r.blocked() && !r.on(), 'permission denied → the row reads OFF / "Tap to allow notifications"');
    await r.ctx._toggleClassReminders();
    t.eq(r.log.toasts[r.log.toasts.length - 1][1], 'error', 'tapping it while iOS still says no → "iOS Settings first"');

    r.st.perm = 'granted'; // the user allows notifications in iOS Settings…
    r.foreground(); // …and comes back
    await flush();
    t.ok(!r.blocked() && r.on(), 'returning to the app repaints the row from the live permission (ON)');
    t.eq(r.log.disabled, 0, '…without touching the pref');

    // The tap can also beat that repaint: the row still says "Tap to allow".
    const q = bootRow('denied');
    q.ctx.renderReminderRow();
    await flush();
    q.st.perm = 'granted';
    await q.ctx._toggleClassReminders();
    await flush();
    t.eq([q.log.enabled, q.log.disabled], [1, 0], 'a tap on a blocked-looking row arms reminders — it never turns them off');
    t.eq(q.log.toasts[q.log.toasts.length - 1][1], 'success', '…and says they are on');
    t.ok(q.st.pref === true && q.on() && !q.blocked(), '…and the row now reads ON');
    await q.ctx._toggleClassReminders();
    t.eq(q.log.disabled, 1, 'a tap on a row that reads ON still turns them off');

    const hidden = bootRow('denied');
    hidden.ctx.renderReminderRow();
    await flush();
    hidden.st.perm = 'granted';
    hidden.st.visibility = 'hidden';
    hidden.foreground();
    await flush();
    t.ok(hidden.blocked(), 'going to the background repaints nothing');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Settings export in the iOS app (js/settings.js)');
  {
    function FakeFile(parts, name, o) { this.parts = parts; this.name = name; this.type = o && o.type; }
    // share: 'ok' | 'abort' | 'refuse' | 'throw' | undefined (no Web Share);  text: true | false | 'none'
    const run = async (share, text, canShare) => {
      const log = { toasts: [], shared: null, sharedSync: false, textShared: null };
      const navigator = {};
      if (share) {
        navigator.canShare = () => canShare !== false;
        navigator.share = (data) => {
          log.shared = data;
          if (share === 'throw') throw new Error('sync failure');
          if (share === 'ok') return Promise.resolve();
          const err = new Error(share);
          err.name = share === 'abort' ? 'AbortError' : 'NotAllowedError';
          return Promise.reject(err);
        };
      }
      const window = {};
      if (text !== 'none') window.nativeShare = (title, body, url) => { log.textShared = { title, body, url }; return Promise.resolve(text); };
      const p = t.loadPure('js/settings.js', 'settings-export', { navigator, window, File: FakeFile, toast: (m, k) => log.toasts.push([m, k]) });
      p._shareSettingsExport('{"a":1}', 'psycle-settings-2026-09-17.json');
      log.sharedSync = log.shared !== null; // reached navigator.share before returning = still inside the tap
      await flush();
      return log;
    };

    let r = await run('ok', true);
    t.ok(r.sharedSync, 'navigator.share is called synchronously from the click (user gesture intact)');
    t.ok(r.shared.files.length === 1 && r.shared.files[0].name === 'psycle-settings-2026-09-17.json' && r.shared.files[0].type === 'application/json', 'it shares a real .json File');
    t.eq(r.toasts, [['Settings exported', 'success']], 'success is toasted only once the share resolved');
    t.eq(r.textShared, null, '…with no second share sheet');

    r = await run('abort', true);
    t.eq(r.toasts, [['Export cancelled', 'info']], 'dismissing the share sheet says cancelled — never "exported"');
    t.eq(r.textShared, null, 'a cancel does not reopen the sheet through the text route');

    r = await run('refuse', true);
    t.ok(r.textShared && r.textShared.body === '{"a":1}' && r.textShared.url === null, 'a refused file share falls back to sharing the JSON as text');
    t.eq(r.toasts, [['Settings exported', 'success']], '…and toasts by what the fallback reports');

    r = await run('refuse', false);
    t.eq(r.toasts, [['Export cancelled', 'info']], 'fallback dismissed → cancelled');

    r = await run('throw', true);
    t.ok(r.textShared !== null, 'a share() that throws synchronously also falls back');

    r = await run('ok', true, false);
    t.ok(r.shared === null && r.textShared !== null, 'canShare({files}) false → straight to the text route');

    r = await run(undefined, true);
    t.ok(r.textShared !== null, 'no Web Share API → text route');

    r = await run(undefined, 'none');
    t.eq(r.toasts.length === 1 && r.toasts[0][1], 'error', 'no way to share at all → an error toast, not a false success');

    const settingsSrc = t.readSource('js/settings.js');
    const accept = (/id="settingsImportFile" accept="([^"]*)"/.exec(settingsSrc) || [])[1] || '';
    t.ok(/\.json/.test(accept) && /\.txt/.test(accept), 'the import picker accepts the .txt a text export is saved as (accept="' + accept + '")');
    t.ok(/isNativePlatform\(\)\) \{\s*_shareSettingsExport\(json, fileName\);\s*return;/.test(settingsSrc), 'exportSettings takes the share route (and skips the dead blob download) on the native platform');
  }
};

module.exports.harness = harness;
