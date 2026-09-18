'use strict';
// Widget tap → My Bookings. Three sides have to agree and none of them can be
// run on a device from here, so this suite pins the contract between them:
//   PsycleWidget.swift          mints      psync://bookings?event=<id>
//   AppGroupPreferences.swift   forwards   PsycleDeepLink 'openURL' (retained)
//   native-bridge.js            routes it  through the notification-tap router
//
// The parser and handler are tested in isolation (pure:widget-link); the cold
// launch — the normal widget-tap case, and the one that silently failed in the
// first design — is tested against the whole bridge with a fake Capacitor. The
// canonical fake-Capacitor harness lives in ios-bridge.js; this is the minimum
// the bridge needs to load, kept separate so the two suites can change apart.

module.exports = async function (t) {
  const BRIDGE = 'ios-app/www/native-bridge.js';

  // ════════════════════════════════════════════════════════════════════
  t.section('Widget link: parsing psync://bookings?event=<id>');
  {
    const p = t.loadPure(BRIDGE, 'widget-link', { window: {}, _routeNotificationTap() {} });
    const id = (url) => { const r = p._parseWidgetLink(url); return r === null ? 'REJECTED' : r.eventId; };

    t.eq(id('psync://bookings?event=123'), '123', 'the shape the widget mints → its event id');
    t.eq(id('psync://bookings'), null, 'no class on the widget → a link with no id (still ours)');
    t.eq(id('psync://bookings/'), null, 'a trailing slash is tolerated');
    t.eq(id('psync://bookings?event='), null, 'an empty id is no id');
    t.eq(id('PSYNC://Bookings?event=5'), '5', 'scheme and host are case-insensitive, as URLs are');
    t.eq(id('psync://bookings?src=widget&event=77&x=1'), '77', 'the id is found among other parameters');
    t.eq(id('psync://bookings?event=12%33'), '123', 'percent-encoding is decoded before the id is judged');
    t.eq(id('psync://bookings?event=9#frag'), '9', 'a fragment is ignored');

    t.eq(id('psync://bookings?notevent=9'), null, "a parameter merely ENDING in 'event' is not the id");
    t.eq(id('psync://bookings?event=abc'), null, 'a non-numeric id is dropped (link still lands on My Bookings)');
    t.eq(id("psync://bookings?event=1');alert(1);//"), null, 'an id carrying code is dropped, never passed on');
    t.eq(id('psync://bookings?event=%E0%A4%A'), null, 'malformed percent-encoding does not throw — just no id');

    t.eq(id('psync://discover'), 'REJECTED', 'another host is not a link we mint');
    t.eq(id('psync://bookings.evil.example?event=1'), 'REJECTED', 'a host that only STARTS with ours is rejected');
    t.eq(id('psync://bookings/extra/path?event=1'), 'REJECTED', 'an unexpected path is rejected');
    t.eq(id('https://example.com/psync://bookings?event=1'), 'REJECTED', 'our link embedded in another URL is rejected');
    t.eq([id(''), id(null), id(undefined), id(42), id({})], ['REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED'], 'junk input is rejected without throwing');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Widget link: handler routes through the notification-tap router');
  {
    const make = (over) => {
      const calls = { routed: [], switchTab: [], warned: 0 };
      const globals = Object.assign({
        window: { switchTab(tab) { calls.switchTab.push(tab); } },
        _routeNotificationTap(eventId) { calls.routed.push(eventId); },
        console: { warn() { calls.warned++; }, log() {} },
      }, over || {});
      return { calls, p: t.loadPure(BRIDGE, 'widget-link', globals) };
    };

    let h = make();
    h.p.handleWidgetURL({ url: 'psync://bookings?event=123' });
    t.eq(h.calls.routed, ['123'], 'a class on the widget → the SAME router a reminder tap uses, with its id');
    t.eq(h.calls.switchTab, [], '…and the handler leaves the tab switch to that router (no double switch)');

    h = make();
    h.p.handleWidgetURL({ url: 'psync://bookings' });
    t.eq(h.calls.switchTab, ['bookings'], 'no class on the widget → My Bookings');
    t.eq(h.calls.routed, [], "…NOT the router's own no-id case, which is the weekly reminder → Discover");

    h = make();
    h.p.handleWidgetURL({ url: 'psync://bookings?event=abc' });
    t.eq([h.calls.switchTab, h.calls.routed], [['bookings'], []], 'a bad id still lands on My Bookings, and never reaches the router');

    h = make();
    h.p.handleWidgetURL({ url: 'https://example.com/' });
    h.p.handleWidgetURL({});
    h.p.handleWidgetURL(null);
    h.p.handleWidgetURL(undefined);
    t.eq([h.calls.switchTab, h.calls.routed, h.calls.warned], [[], [], 0], 'a foreign or missing URL does nothing at all (and is not an error)');

    h = make({ window: {} });
    let threw = false;
    try { h.p.handleWidgetURL({ url: 'psync://bookings' }); } catch (e) { threw = true; }
    t.ok(!threw, 'no switchTab yet (should be impossible — the bridge loads last) → a no-op, not a throw');

    h = make({ _routeNotificationTap() { throw new Error('router blew up'); } });
    threw = false;
    try { h.p.handleWidgetURL({ url: 'psync://bookings?event=5' }); } catch (e) { threw = true; }
    t.ok(!threw && h.calls.warned === 1, 'a router failure is contained and logged — a native event callback must never throw');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Widget link: cold launch — the retained tap is replayed into the real bridge');
  // Capacitor flushes a retained event the moment the first listener attaches.
  // This fake does it SYNCHRONOUSLY, inside addListener — harsher than the real
  // (async) bridge: it proves nothing the handler needs is defined further down
  // native-bridge.js than the listener registration.
  function boot(retainedUrl) {
    const calls = { switchTab: [], opened: [], listened: [] };
    const handlers = {};
    const events = {
      on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); return () => { handlers[name] = handlers[name].filter((f) => f !== fn); }; },
      emit(name, arg) { (handlers[name] || []).slice().forEach((fn) => fn(arg)); },
    };
    let deliver = null;
    const dom = { activePanel: 'tab-discover' };
    const plugins = {
      Preferences: { get: () => Promise.resolve({ value: null }), set: () => Promise.resolve(), remove: () => Promise.resolve() },
      StatusBar: { setStyle: () => Promise.resolve() },
      LocalNotifications: {
        checkPermissions: () => Promise.resolve({ display: 'denied' }),
        requestPermissions: () => Promise.resolve({ display: 'denied' }),
        registerActionTypes: () => Promise.resolve(),
        addListener() {},
        schedule: () => Promise.resolve(),
        cancel: () => Promise.resolve(),
      },
    };
    if (retainedUrl !== false) {
      plugins.PsycleDeepLink = {
        addListener(name, fn) {
          calls.listened.push(name);
          deliver = fn;
          if (retainedUrl) fn({ url: retainedUrl });
        },
      };
    }
    const ctx = {
      console: { log() {}, warn() {}, error() {} },
      localStorage: t.makeFakeLocalStorage(),
      navigator: { onLine: true },
      // Never fire: nothing asserted here depends on a timer, and a real one
      // would outlive the suite.
      setTimeout: () => 0,
      clearTimeout() {},
      Capacitor: { Plugins: plugins, isNativePlatform: () => true },
      PsycleEvents: events,
      _eventCache: {},
      _myBookings: {},
      APP_THEMES: [],
      matchMedia: () => ({ matches: false }),
      MutationObserver: function () { this.observe = function () {}; },
      document: {
        documentElement: { getAttribute: () => null },
        getElementById: () => null,
        querySelector: (sel) => (sel === '.tab-panel.active' ? { id: dom.activePanel } : null),
        addEventListener() {},
        visibilityState: 'visible',
      },
      switchTab(tab) { calls.switchTab.push(tab); dom.activePanel = 'tab-' + tab; },
      openClassDetail(id) { calls.opened.push(id); },
      toast() {},
      renderReminderRow() {},
      confirmModal: () => new Promise(() => {}),
      _psycleNativeRestoreResolve() {},
    };
    ctx.window = ctx;
    ctx.self = ctx;
    t.vm.createContext(ctx);
    t.vm.runInContext(t.readSource(BRIDGE), ctx, { filename: 'native-bridge.js[widget-link]' });
    return { ctx, calls, events, tap: (url) => deliver({ url }) };
  }
  const seat = (id) => ({ bookingId: id, bookingIds: [id], slots: [7], slotBookings: { 7: id }, waitlisted: false });
  {
    const b = boot('psync://bookings?event=321');
    t.eq(b.calls.listened, ['openURL'], "the bridge listens for the plugin's 'openURL' event");
    t.eq(b.calls.switchTab, ['bookings'], 'cold launch: the retained tap lands on My Bookings as soon as the bridge loads');
    t.eq(b.calls.opened, [], '…with no sheet yet — bookings have not loaded');
    b.ctx._eventCache['321'] = { id: 321 };
    b.ctx._myBookings['321'] = seat(321);
    b.events.emit('bookings:loaded', {});
    t.eq(b.calls.opened, ['321'], "…and that class's sheet opens once /bookings shows the seat");
  }
  {
    const b = boot('psync://bookings?event=322');
    b.ctx._eventCache['322'] = { id: 322 };
    b.ctx._myBookings['322'] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 9 } };
    b.events.emit('bookings:loaded', {});
    t.eq([b.calls.switchTab, b.calls.opened], [['bookings'], []], 'a class since cancelled/waitlisted: My Bookings, but never a sheet with a live Book button');
  }
  {
    const b = boot(null); // plugin present, app already running, nothing retained
    t.eq(b.calls.switchTab, [], 'a normal launch (no widget tap) goes nowhere by itself');
    b.ctx._eventCache['50'] = { id: 50 };
    b.ctx._myBookings['50'] = seat(50);
    b.tap('psync://bookings?event=50');
    t.eq([b.calls.switchTab, b.calls.opened], [['bookings'], ['50']], 'warm tap: My Bookings and the sheet at once');
    b.tap('psync://bookings');
    t.eq(b.calls.switchTab, ['bookings', 'bookings'], 'warm tap on the empty widget: My Bookings');
  }
  {
    let crashed = null;
    try { boot(false); } catch (e) { crashed = e; }
    t.ok(crashed === null, 'an older native shell without the plugin: the bridge still loads (the probe is guarded)');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Widget link: a tap after iOS killed the WebView process (a dead page\'s listener is still registered)');
  // Swift can't run here, so this is a MODEL of the native side driving the
  // real handler: CAPPlugin.m's listener rules (@capacitor/ios 6 — an event is
  // retained only while NO listener is registered, and listeners are never
  // dropped when their page goes away) plus PsycleDeepLinkPlugin's own rule on
  // top (forward() / addListener in AppGroupPreferences.swift, pinned below).
  {
    const pluginSrc = t.readSource('ios-app/ios/App/App/AppGroupPreferences.swift');
    const windowMs = Number((/pendingTapWindow: TimeInterval = (\d+)/.exec(pluginSrc) || [])[1]) * 1000;
    t.ok(windowMs > 0 && windowMs <= 15000, 'the replay window is a few seconds (' + windowMs + 'ms): a sheet long after the tap is worse than none');

    const native = () => {
      const clock = { now: 0 };
      const listeners = [], retained = [];
      let pending = null;
      const notify = (data, retain) => {
        if (!listeners.length) { if (retain) retained.push(data); return; }
        listeners.forEach((fn) => fn(data));
      };
      return {
        clock,
        forward(url) { // application(_:open:) → PsycleDeepLinkPlugin.forward
          const data = { url };
          if (listeners.length) pending = { data, at: clock.now };
          notify(data, true);
        },
        addListener(fn) { // CAPPlugin.addListener, then the plugin's override
          listeners.push(fn);
          if (listeners.length === 1) retained.splice(0).forEach((d) => notify(d, false));
          const tap = pending;
          pending = null;
          if (tap && clock.now - tap.at < windowMs) notify(tap.data, false);
        },
      };
    };
    // A page = the real pure:widget-link handler; once its process is killed the
    // native listener is still there but its callback id belongs to nobody.
    const page = (n) => {
      const routed = [];
      const pure = t.loadPure(BRIDGE, 'widget-link', { window: { switchTab() { routed.push('tab'); } }, _routeNotificationTap(id) { routed.push('route:' + id); }, console: { warn() {}, log() {} } });
      const pg = { routed, alive: true };
      n.addListener((info) => { if (pg.alive) pure.handleWidgetURL(info); });
      return pg;
    };

    let n = native();
    n.forward('psync://bookings?event=111');
    t.eq(page(n).routed, ['route:111'], 'cold launch: retained, replayed once to the first page');

    n = native();
    let first = page(n);
    n.forward('psync://bookings?event=112');
    t.eq(first.routed, ['route:112'], 'warm tap on a live page: delivered once (the copy kept for a next page is never replayed to this one)');

    n = native();
    first = page(n);
    first.alive = false; // jettisoned in the background; Capacitor reloads the page on resume
    n.forward('psync://bookings?event=113');
    n.clock.now = 2500;
    const reloaded = page(n);
    t.eq([first.routed, reloaded.routed], [[], ['route:113']], 'the tap went to the dead page\'s listener — and is replayed to the reloaded page (it used to be lost: app opens on its previous tab)');
    t.eq(page(n).routed, [], '…once: a later listener gets nothing');

    n = native();
    first = page(n);
    first.alive = false;
    n.forward('psync://bookings?event=114');
    n.clock.now = windowMs + 1;
    t.eq(page(n).routed, [], 'a page that attaches after the window gets nothing (no late sheet)');

    t.ok(/if hasListeners\("openURL"\) \{\s*pendingTap = \(data, Date\(\)\)/.test(pluginSrc), 'Swift: forward() keeps a tap that went out to EXISTING listeners');
    const override = (/override public func addListener\(_ call: CAPPluginCall\) \{([\s\S]*?)\n    \}\n/.exec(pluginSrc) || [])[1] || '';
    t.ok(/super\.addListener\(call\)/.test(override) && /DispatchQueue\.main\.async/.test(override), 'Swift: addListener still registers the listener, then hops to main (forward() and the kept tap live there)');
    t.ok(/self\.pendingTap = nil/.test(override) && /pendingTapWindow/.test(override) && /self\.notifyListeners\("openURL", data: tap\.data\)/.test(override),
      'Swift: the kept tap is cleared, age-checked and replayed UN-retained');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Widget link: the Swift and JS sides name the same things');
  {
    const widget = t.readSource('ios-app/ios/App/PsycleWidget/PsycleWidget.swift');
    const plugin = t.readSource('ios-app/ios/App/App/AppGroupPreferences.swift');
    const main = t.readSource('ios-app/ios/App/App/MainViewController.swift');
    const bridge = t.readSource(BRIDGE);

    t.ok(/\.scheme = "psync"/.test(widget) && /\.host = "bookings"/.test(widget) && /URLQueryItem\(name: "event"/.test(widget),
      'the widget mints scheme "psync", host "bookings", query "event" — what _parseWidgetLink reads');
    t.ok(/\.widgetURL\(deepLink\)/.test(widget), 'every family carries the link (widgetURL on the shared body)');
    t.ok(/jsName = "PsycleDeepLink"/.test(plugin) && /Capacitor\.Plugins\.PsycleDeepLink\b/.test(bridge),
      'the plugin is exported under the name the bridge probes');
    t.ok(/notifyListeners\("openURL",[^\n]*retainUntilConsumed: true\)/.test(plugin) && /addListener\('openURL', handleWidgetURL\)/.test(bridge),
      "the event is 'openURL' on both sides, and RETAINED (a cold-launch tap arrives before any script)");
    t.ok(/registerPluginInstance\(PsycleDeepLinkPlugin\(\)\)/.test(main),
      'the plugin is registered (Capacitor 6 does not discover in-app plugins)');
    t.ok(/url\.scheme\?\.lowercased\(\) == "psync"/.test(plugin), 'only our own scheme is forwarded to the web layer');

    const families = (/\.supportedFamilies\(\[([^\]]*)\]\)/.exec(widget) || [])[1] || '';
    t.ok(/\.accessoryRectangular/.test(families) && /\.accessoryInline/.test(families), 'the Lock Screen families are offered');
    t.ok(/\.systemSmall/.test(families) && /\.systemMedium/.test(families), '…alongside the Home Screen ones that already shipped');
    t.ok(!/accessoryCircular/.test(widget), 'no circular accessory (deliberately skipped: no room for anything but a number)');
    t.ok(/case \.accessoryRectangular:/.test(widget) && /case \.accessoryInline:/.test(widget),
      'each offered accessory has its own view — neither falls through to the Home Screen layout');
  }
};
