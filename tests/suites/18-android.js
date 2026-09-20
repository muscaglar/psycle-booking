'use strict';
// The Android app ("level 2": everything the iPhone app does except the
// widgets, the Live Activity and Siri — then "level 3", a home-screen widget,
// which has its own suite: 20-android-widget.js, on this file's launchScenario).
// It ships the SAME www/ folder, so what is tested here is the web layer and the
// bridge being platform-aware:
//   A. Back — the pure decision (js/app.js, pure:android-back), exhaustively
//   B. Back — the actor over a fake page: the TOP layer only, never "yes", a
//      dialog that waits on the member before any busy mark, a request in
//      flight swallows the press, focus handed back; and the shipped bookClass,
//      to hold what the actor assumes about it
//   C. copy that named the iPhone: the welcome, the reminder rows, Settings,
//      the token dialog, the waitlist "You're in" notice
//   D. the bridge booted as 'android' (tests/suites/ios-bridge.js's harness):
//      channels once, channelId + smallIcon + iconColor, the status-bar
//      colour, nothing said about the iPhone app's own plugins when an Android
//      app has none of them (one built before the widget twins), and a
//      FORGED notification tap (any app can send one on Android)
//   E. the bridge booted as 'ios': NOT ONE of those calls — its plugin calls
//      are what they were before the Android work, to the byte
//   F. the calendar plugin's Android shapes: the ownership marker is read from
//      `description`, and a row Android still lists after a delete is ignored
// Nothing native, no network. Nothing here can prove what only a compiler, an
// emulator or a phone can: that is listed where the work was handed over.

const crypto = require('crypto');
const { harness } = require('./ios-bridge.js');

// The Android app's TWINS of three of the iPhone app's own plugins (level 3, the
// home-screen widget): local Java plugins under the same names and method
// shapes — and no PsycleLiveActivity. They record as the iPhone fakes below do
// and, in `box`, keep what a native reader would hold: the stored values, every
// write in order, and the 'openURL' listener. `box.retained` = a widget tap that
// cold-started the app: handed over when the listener attaches, once, as
// Capacitor hands over a retained event (tests/suites/20-android-widget.js).
function androidTwins(rec, box) {
  box.values = box.values || {};
  box.writes = box.writes || [];
  box.listeners = box.listeners || {};
  return {
    AppGroupPreferences: {
      set(o) { rec('AppGroupPreferences.set', { group: o.group, key: o.key }); box.values[o.key] = o.value; box.writes.push([o.key, o.value]); return Promise.resolve(); },
      get(o) { rec('AppGroupPreferences.get', { group: o.group, key: o.key }); return Promise.resolve({ value: Object.prototype.hasOwnProperty.call(box.values, o.key) ? box.values[o.key] : null }); },
      remove(o) { rec('AppGroupPreferences.remove', { group: o.group, key: o.key }); delete box.values[o.key]; return Promise.resolve(); },
    },
    WidgetCenter: { reloadAllTimelines() { rec('WidgetCenter.reloadAllTimelines'); return Promise.resolve(); } },
    PsycleDeepLink: {
      addListener(name, fn) {
        rec('PsycleDeepLink.addListener', name);
        box.listeners[name] = fn;
        if (name === 'openURL' && box.retained) { const url = box.retained; box.retained = null; fn({ url: url }); }
      },
    },
  };
}

// One launch, the same on every platform: a member with the Monday reminder on,
// a usual week saved and one class held; notifications allowed. The bookings
// land, the two launch timers run (3 s: the Monday reminder is re-armed; 4 s:
// the snapshot pass, which arms the class reminder), then the theme changes.
// Returns the boot and the ORDERED plugin calls, one JSON line each.
// `opts.twins` (Android only): a box → the Android app WITH its widget twins.
// Left out, 'android' is an app built before them: none of the four names.
// `opts.globals`: page globals there before the bridge loads (boot's `globals`).
async function launchScenario(h, platform, opts) {
  const twins = platform === 'android' && opts && opts.twins ? opts.twins : null;
  const b = h.boot({
    platform: platform,
    perm: 'granted',
    theme: 'cloud',
    removeDelivered: true,
    globals: opts && opts.globals,
    local: { psycle_weekly_reminder: 'on', psycle_weekly_template: '[{"day":1}]' },
    // The iPhone app's own four. An Android app has its twins of three of them,
    // or — built before level 3 — no such names in Capacitor.Plugins at all.
    plugins: platform === 'android' ? (twins ? (rec) => androidTwins(rec, twins) : null) : (rec) => ({
      AppGroupPreferences: { set(o) { rec('AppGroupPreferences.set', { group: o.group, key: o.key }); return Promise.resolve(); } },
      WidgetCenter: { reloadAllTimelines() { rec('WidgetCenter.reloadAllTimelines'); return Promise.resolve(); } },
      PsycleLiveActivity: { refresh() { rec('PsycleLiveActivity.refresh'); return Promise.resolve(); } },
      PsycleDeepLink: { addListener(name) { rec('PsycleDeepLink.addListener', name); } },
    }),
  });
  b.ctx._myBookings['501'] = { bookingId: 9, slots: [12] };
  b.ctx._eventCache['501'] = { start_at: '2026-09-20 18:30:00', duration: 45, _typeName: 'RIDE: 45', _instrName: 'Ann', _locName: 'Bank', _studioName: 'Studio 1' };
  await h.flush();
  b.events.emit('bookings:loaded', b.ctx._myBookings);
  await b.clock.advance(5000);
  b.setTheme('graphite');
  await h.flush();
  return { b: b, lines: b.calls.plugin.map((c) => JSON.stringify(c)) };
}

// The launch restore reads every SYNC_KEYS entry: those lines change whenever a
// storage key is added, which is nobody's platform change.
const notRestore = (line) => line.indexOf('["Preferences.get"') !== 0;
const digest = (lines) => crypto.createHash('sha256').update(lines.join('\n')).digest('hex');

// The iPhone app's plugin calls for launchScenario, as the bridge made them at
// the commit BEFORE the Android work (754fbb0) — sha256 of the lines above,
// the restore's reads left out. If the iPhone path is ever changed ON PURPOSE,
// the failing check prints the new digest to put here.
const IPHONE_LAUNCH_DIGEST = '97bfb4f72ae94c22c927a95bdc54a0ac9796ee1a0f3163d660012cc5457800c5';

module.exports = async function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const tabsSrc = t.readSource('js/tabs.js');
  const settingsSrc = t.readSource('js/settings.js');
  const bridgeSrc = t.readSource('ios-app/www/native-bridge.js');

  // ════════════════════════════════════════════════════════════════════
  // A. Back — the decision
  // ════════════════════════════════════════════════════════════════════
  t.section('Android Back: what one press does (pure:android-back), every combination');
  const p = t.loadPure('js/app.js', 'android-back');
  {
    const OUTPUTS = ['close-dialog', 'close-overlay', 'close-popup', 'close-menu', 'close-datepicker', 'collapse-filters', 'go-discover', 'none'];
    // Written apart from the code, as a table of who outranks whom.
    const oracle = (s) => {
      if (s.welcomeUp || s.dialogOpen) return 'close-dialog';
      if (s.overlayTopId) return 'close-overlay';
      if (s.similarPopupOpen) return 'close-popup';
      if (s.moreMenuOpen) return 'close-menu';
      const discover = s.tab === '' || s.tab === 'discover';
      if (!discover) return 'go-discover';
      if (s.datePickerOpen) return 'close-datepicker';
      if (s.filtersExpanded) return 'collapse-filters';
      return 'none';
    };
    const flags = ['welcomeUp', 'dialogOpen', 'similarPopupOpen', 'moreMenuOpen', 'datePickerOpen', 'filtersExpanded'];
    const tabs = ['', 'discover', 'bookings', 'stats', 'membership'];
    const wrong = [];
    const seen = {};
    let n = 0;
    for (let bits = 0; bits < (1 << flags.length); bits++) {
      ['', 'settingsOverlay'].forEach((overlayTopId) => {
        tabs.forEach((tab) => {
          const s = { overlayTopId, tab };
          flags.forEach((f, i) => { s[f] = !!(bits & (1 << i)); });
          const got = p._androidBackDecision(s);
          seen[got] = true;
          n++;
          if (got !== oracle(s)) wrong.push(JSON.stringify(s) + ' → ' + got);
        });
      });
    }
    eq([n, wrong], [640, []], 'all 640 combinations of what can be up, on every tab, answer as the priority table says');
    eq(Object.keys(seen).sort(), OUTPUTS.slice().sort(), 'exactly the eight answers — each one reachable, and no other');

    eq(p._androidBackDecision(), 'none', 'nothing known → nothing to close (the app goes to the background)');
    eq(p._androidBackDecision({ tab: 'discover' }), 'none', 'Discover with nothing open → none');
    eq(['bookings', 'stats', 'membership'].map((tab) => p._androidBackDecision({ tab })), ['go-discover', 'go-discover', 'go-discover'],
      'any other tab → Discover (the Stats sub-pages are peers, not a drill-down)');
    eq(p._androidBackDecision({ tab: 'bookings', datePickerOpen: true, filtersExpanded: true }), 'go-discover',
      'the calendar and the Filters panel are Discover\'s: left open under another tab they are out of sight, so Back goes to Discover first');
    eq(p._androidBackDecision({ tab: 'bookings', dialogOpen: true, overlayTopId: 'classDetailOverlay', moreMenuOpen: true }), 'close-dialog',
      'a confirm over a sheet over a menu → the dialog alone');
    eq(p._androidBackDecision({ welcomeUp: true, overlayTopId: 'settingsOverlay' }), 'close-dialog', 'the welcome (replayed from Settings) → the welcome first');

    eq([p._androidBackDialog({ welcomeUp: true, confirmUp: true, usualWeekUp: true }), p._androidBackDialog({ confirmUp: true, usualWeekUp: true }),
      p._androidBackDialog({ usualWeekUp: true }), p._androidBackDialog({}), p._androidBackDialog()],
    ['welcome', 'confirm', 'usual-week', '', ''], 'of the dialogs with their own keys, the top one only: welcome (9000) > confirmModal (1000) > the usual-week sheet (998)');

    eq([p._androidBackWaits(true, 0), p._androidBackWaits(true, 59000), p._androidBackWaits(true, 60001), p._androidBackWaits(false, 0), p._androidBackWaits(true, NaN)],
      [true, true, false, false, true], 'a request in flight swallows Back — for a minute at most, so a button stuck on "…" can never turn Back off for good');

    eq([p._androidBackAsksMember({ welcomeUp: true }), p._androidBackAsksMember({ confirmUp: true }), p._androidBackAsksMember({ usualWeekUp: true, dialogOpen: true, overlayTopId: 'bikeModal' }), p._androidBackAsksMember({}), p._androidBackAsksMember()],
      [true, true, false, false, false], 'the welcome and a confirm wait on the MEMBER, and are answered whatever is marked busy; the usual-week sheet (it can be mid-run) and the seat picker (mid-swap) are not');
    eq([0, 1, 3, undefined, NaN, '2'].map((i) => p._androidBackWelcomeControl(i)), ['skip', 'back', 'back', 'skip', 'skip', 'back'],
      'on the welcome Back is the welcome\'s own Back; its Skip — which writes "seen" for good — only from the first page');
  }

  // ════════════════════════════════════════════════════════════════════
  // B. Back — the actor
  // ════════════════════════════════════════════════════════════════════
  t.section('Android Back: the actor closes the TOP layer only, through that layer\'s own closer');
  const actorFrom = appSrc.indexOf('// ── pure:android-back:start');
  const actorTo = appSrc.indexOf('// ── PWA Service Worker');
  ok(actorFrom !== -1 && actorTo > actorFrom, 'the Back block found in js/app.js, ahead of the service-worker block (tests/suites/offline.js slices that one to the end of the file)');
  const actorSrc = appSrc.slice(actorFrom, actorTo);

  // A page as the actor sees it. Every selector it may use is answered here;
  // an unknown one throws — so the actor cannot so much as LOOK for a confirm
  // button without this suite failing.
  function page(o) {
    o = o || {};
    const log = [];
    // focusIn: where keyboard / TalkBack focus is — 'body', or the id of the
    // element that holds it ('panel' = the active tab's panel).
    // swapping / cancellingSeat: the seat picker mid-write (executeSpotSwap's
    // _swapInFlight; cancelBikeSlot's "Cancelling…" hint). welcomePage:
    // _onboardIdx. cancelLabel: what the confirm's cancel button reads.
    const st = Object.assign({ tab: 'discover', now: 1000000, busyAttr: false, dots: false, running: false, swapping: false, cancellingSeat: false, popup: false, menu: false,
      picker: false, filters: false, wide: false, booked: false, stack: [], confirm: null, cancelLabel: '', welcome: null, welcomePage: 0, usualWeek: null, focusIn: 'body', throws: false }, o);
    const btn = (name) => ({ click() { log.push('click ' + name); } });
    const body = { id: 'body' };
    const focused = { id: 'the control that holds focus' };
    const holds = (id) => (node) => node === focused && st.focusIn === id;
    const el = (id, extra) => Object.assign({ id, isConnected: true, style: { display: '' }, offsetParent: {}, classList: { contains: () => false }, contains: holds(id),
      focus(opts) { log.push('focus ' + id + (opts && opts.preventScroll === true ? '' : ' (and the page may scroll)')); } }, extra);
    const overlays = {};
    const popup = { dispatchEvent(e) { log.push('key ' + e.key + ' @popup'); } };
    const timers = [];
    const document = {
      body,
      get activeElement() { return st.focusIn === 'body' ? body : focused; },
      getElementById(id) {
        if (st.throws) throw new Error('no DOM');
        if (id === 'onboardOverlay') return st.welcome;
        if (id === 'psycleConfirmOverlay') return st.confirm;
        if (id === 'usualWeekSheet') return st.usualWeek;
        if (id === 'bookingConfirmation') return st.booked ? el(id) : null;
        if (id === 'datePicker') return el(id, { style: { display: st.picker ? '' : 'none' } });
        if (id === 'controlsToggle') return el(id, { offsetParent: st.wide ? null : {} });
        if (id === 'pickDateBtn' || id === 'controlsBody') return el(id);
        if (id === 'modalHint') return { textContent: st.cancellingSeat ? 'Cancelling…' : 'Select a bike' }; // permanent markup, like #bikeModal
        if (st.stack.indexOf(id) !== -1) return overlays[id] || (overlays[id] = el(id));
        return null;
      },
      querySelector(sel) {
        if (sel === '[data-busy="1"]') return st.busyAttr ? {} : null;
        if (sel === '#usualWeekSheet [data-uw-stop]') return st.running ? {} : null;
        if (sel === '.tab-panel.active') return st.tab ? { id: 'tab-' + st.tab, contains: holds('panel') } : null;
        if (sel === '.tab-btn[data-tab="discover"]') return el('the Discover tab button');
        if (sel === '.find-similar-popup') return st.popup ? popup : null;
        if (sel === '#onboardOverlay [data-onboard="skip"]') return st.welcome ? btn('welcome: Skip') : null;
        if (sel === '#onboardOverlay [data-onboard="back"]') return st.welcome ? btn('welcome: Back') : null;
        if (sel === '#psycleConfirmOverlay .confirm-btn-cancel') return st.confirm ? btn('confirm: CANCEL' + (st.cancelLabel ? ' ("' + st.cancelLabel + '")' : '')) : null;
        throw new Error('fake page: unexpected selector ' + sel);
      },
      querySelectorAll(sel) {
        if (sel !== 'button') throw new Error('fake page: unexpected selector ' + sel);
        return [{ textContent: 'Book' }, { textContent: st.dots ? '…' : 'Cancel booking' }];
      },
      dispatchEvent(e) { log.push('key ' + e.key + ' @document' + (e.bubbles && e.cancelable ? '' : ' (not a real key event)')); },
    };
    const ctx = t.vm.createContext({
      console, Date: { now: () => st.now }, Number, String, Array, Object,
      document,
      KeyboardEvent: function (type, init) { this.type = type; this.key = init.key; this.bubbles = !!init.bubbles; this.cancelable = !!init.cancelable; },
      _OVERLAYS: ['tokenDialog', 'bikeModal', 'syncPromptOverlay', 'classDetailOverlay', 'historyModalOverlay', 'instructorModalOverlay', 'yearReviewOverlay', 'settingsOverlay', 'diagOverlay'].map((id) => [id, null]),
      _overlayIsOpen: (e) => !!e && e.isConnected && e.style.display !== 'none',
      _mbMoreState: () => (st.menu ? { btn: {} } : null),
      closeBookingMore(focusBack) { log.push('closeBookingMore(' + focusBack + ')'); st.menu = false; },
      toggleDatePicker() { log.push('toggleDatePicker'); st.picker = !st.picker; },
      toggleFilters() { log.push('toggleFilters'); ctx._filtersCollapsed = !ctx._filtersCollapsed; },
      dismissBookingConfirmation() { log.push('dismissBookingConfirmation'); st.booked = false; },
      // The once-a-second look a swallowed press starts. Kept out of `log`.
      setInterval(fn, ms) { timers.push({ fn, ms, live: true }); return timers.length; },
      clearInterval(id) { if (timers[id - 1]) timers[id - 1].live = false; },
    });
    // js/app.js's own state, further up the real file: read, never written.
    Object.defineProperty(ctx, '_swapInFlight', { get: () => st.swapping, enumerable: true });
    Object.defineProperty(ctx, '_onboardIdx', { get: () => st.welcomePage, enumerable: true });
    ctx._filtersCollapsed = !st.filters;
    // In the order they OPENED — the last is on top, as _syncOverlayStack keeps it.
    ctx._overlayStack = st.stack.map((id) => ({ el: document.getElementById(id) }));
    ctx.window = ctx;
    ctx.switchTab = (tab) => { log.push('switchTab ' + tab); st.tab = tab; };
    ctx.pushAction = (a) => { log.push('trail ' + a); };
    t.vm.runInContext(actorSrc, ctx, { filename: 'js/app.js[android-back]' });
    const acts = () => log.filter((l) => l.indexOf('trail ') !== 0);
    // One second passes: every look still running runs once.
    const second = () => { st.now += 1000; timers.filter((x) => x.live).forEach((x) => x.fn()); };
    return { ctx, st, log, acts, timers, second, back: () => ctx._psycleAndroidBack() };
  }
  const dialog = (extra) => Object.assign({ _psycleClosing: false, classList: { contains: () => false } }, extra);

  {
    const w = page();
    eq([w.back(), w.log], [false, []], 'Discover, nothing open → false: MainActivity sends the app to the background — and the page did nothing at all');
    eq(typeof w.back(), 'boolean', 'the answer is a plain boolean, given at once (evaluateJavascript reads it as JSON)');
  }
  {
    const w = page({ tab: 'bookings' });
    eq([w.back(), w.acts(), w.back()], [true, ['switchTab discover'], false], 'My Bookings → Discover, and only then the background');
    ok(w.log.indexOf('trail android:back go-discover') !== -1, 'the bug-report trail says what Back did, in a fixed word');
  }
  {
    const w = page({ picker: true, filters: true, focusIn: 'elsewhere' });
    eq([w.back(), w.acts()], [true, ['toggleDatePicker']], 'calendar open over an open Filters panel → the calendar alone (toggleDatePicker\'s close branch)');
    eq([w.back(), w.acts()], [true, ['toggleDatePicker', 'toggleFilters']], 'the next press collapses the Filters panel (toggleFilters)');
    eq(w.back(), false, '…and the one after that leaves the app');
    const wide = page({ filters: true, wide: true });
    eq([wide.back(), wide.log], [false, []], 'at 1024px and up the Filters bar is hidden and the panel always open: nothing to collapse, Back is not swallowed');
  }
  {
    const w = page({ tab: 'bookings', menu: true });
    eq([w.back(), w.acts()], [true, ['closeBookingMore(true)']], 'a card\'s More menu → closeBookingMore(true): closed, focus back on its More button — and the tab stays');
    const s = page({ tab: 'bookings', popup: true, menu: true });
    eq([s.back(), s.acts()], [true, ['key Escape @popup']], '"Find similar" → a real Escape ON the popup, whose own keydown removes it and hands focus back');
  }
  {
    const w = page({ tab: 'membership', stack: ['settingsOverlay', 'diagOverlay'] });
    eq([w.back(), w.acts()], [true, ['key Escape @document']],
      'Diagnostics over Settings → ONE real Escape on document: THE keydown handler closes the top of the stack through its own closer (tests/suites/a11y.js proves which)');
    ok(w.acts().every((l) => !/switchTab|toggle|click/.test(l)), '…and nothing under it is touched');
    const picker = page({ stack: ['bikeModal'] });
    eq([picker.back(), picker.acts()], [true, ['key Escape @document']], 'the seat picker → Escape → closeBikePicker, its real closer (which also answers a usual-week "Change spot": no change)');
  }
  {
    const w = page({ booked: true, stack: ['classDetailOverlay'] });
    eq([w.back(), w.acts()], [true, ['dismissBookingConfirmation']], 'the Booked sheet over a class sheet → its Done (dismissBookingConfirmation); the class sheet stays for the next press');
    eq([w.back(), w.acts()], [true, ['dismissBookingConfirmation', 'key Escape @document']], '…which closes it');
  }

  t.section('Android Back: focus is handed back where the closer itself hands it nowhere (keyboard, switch access, TalkBack)');
  {
    // Chromium focuses a tapped button, so on Android focus usually IS inside
    // the layer that Back is about to hide.
    const cal = page({ picker: true, focusIn: 'datePicker' });
    eq([cal.back(), cal.acts()], [true, ['toggleDatePicker', 'focus pickDateBtn']], 'the calendar, focus on one of its arrows → closed, and focus goes to the calendar\'s button — as its own Escape and pickCalDate do');
    const calBody = page({ picker: true });
    eq([calBody.back(), calBody.acts()], [true, ['toggleDatePicker', 'focus pickDateBtn']], '…and from <body> too, as that Escape does');
    const calElsewhere = page({ picker: true, focusIn: 'elsewhere' });
    eq([calElsewhere.back(), calElsewhere.acts()], [true, ['toggleDatePicker']], '…but focus that is somewhere else on the page is left where it is');

    const filters = page({ filters: true, focusIn: 'controlsBody' });
    eq([filters.back(), filters.acts()], [true, ['toggleFilters', 'focus controlsToggle']], 'the Filters panel, focus on a chip inside it → collapsed, and focus goes to the Filters bar (where a tap on the bar leaves it)');
    const filtersBody = page({ filters: true });
    eq([filtersBody.back(), filtersBody.acts()], [true, ['toggleFilters']], '…focus that was not in the panel is not moved');

    const tab = page({ tab: 'stats', focusIn: 'panel' });
    eq([tab.back(), tab.acts()], [true, ['switchTab discover', 'focus the Discover tab button']], 'another tab, focus inside its panel → Discover, and focus goes to the Discover tab button (where a tap on it leaves it)');
    ok([cal, filters, tab].every((w) => w.acts().every((l) => !/may scroll/.test(l))), '…with preventScroll each time: Back must not move the page');
  }

  t.section('Android Back: never "yes" — a confirm gets its Cancel, the welcome its own Back or Skip');
  {
    const w = page({ tab: 'bookings', confirm: dialog(), stack: ['classDetailOverlay'], menu: true });
    eq([w.back(), w.acts()], [true, ['click confirm: CANCEL']], 'a confirm dialog (a booking, a late cancel, a calendar hand-over) → its own Cancel button — that and nothing else');
    const both = page({ confirm: dialog(), welcome: dialog() });
    eq([both.back(), both.acts()], [true, ['click welcome: Skip']], 'the welcome over a confirm → Skip ONLY: one Escape used to answer both, Back answers the top one');
    const uw = page({ tab: 'bookings', usualWeek: dialog() });
    eq([uw.back(), uw.acts()], [true, ['key Escape @document']], 'the usual-week sheet → Escape → its own close (which refuses while a run or a "Change spot" is going)');
    const uwConfirm = page({ tab: 'bookings', usualWeek: dialog(), confirm: dialog() });
    eq([uwConfirm.back(), uwConfirm.acts()], [true, ['click confirm: CANCEL']], 'a confirm over the usual-week sheet → the confirm\'s Cancel; the sheet stays');

    // The welcome is turned by horizontal swipes, and a swipe from the screen's
    // edge IS Android's Back gesture. Skip writes "welcome seen" for good.
    const turned = page({ welcome: dialog(), welcomePage: 2 });
    eq([turned.back(), turned.acts()], [true, ['click welcome: Back']], 'the welcome on its third page → its OWN Back button: one page back, nothing written');
    turned.st.welcomePage = 1;
    eq([turned.back(), turned.acts()], [true, ['click welcome: Back', 'click welcome: Back']], '…and again from the second');
    turned.st.welcomePage = 0;
    eq([turned.back(), turned.acts()], [true, ['click welcome: Back', 'click welcome: Back', 'click welcome: Skip']], 'only from the FIRST page is Back the welcome\'s Skip');

    // Confirms whose cancel button is not "leave it all as it was". Back
    // presses it all the same — it never picks the other button — and what that
    // means is held against the shipped code further down.
    const anyway = page({ confirm: dialog(), cancelLabel: 'Book anyway' });
    eq([anyway.back(), anyway.acts()], [true, ['click confirm: CANCEL ("Book anyway")']], '"Session expiring" → its cancel button, "Book anyway": never "Sign in", and nothing else');
    const discard = page({ confirm: dialog(), cancelLabel: 'Discard' });
    eq([discard.back(), discard.acts()], [true, ['click confirm: CANCEL ("Discard")']], '"Offline booking" → its cancel button, "Discard": the queued booking is dropped, never sent');

    const cover = page({ welcome: dialog({ classList: { contains: (c) => c === 'is-holding' } }) });
    eq([cover.back(), cover.log], [false, []], 'the welcome as a launch COVER (is-holding) is not a layer: Skip there would write "seen" for a newcomer who never saw it');
    const fading = page({ confirm: dialog({ _psycleClosing: true }) });
    eq([fading.back(), fading.log], [false, []], 'a confirm that is fading out is already answered: it is not answered twice');

    ok(!/confirm-btn-primary|confirm-btn-danger|data-onboard="(?:next|done|signin)"/.test(actorSrc), 'the actor\'s source names no confirming button at all');
    ok(!/\b(?:submitBooking|bookClass|confirmBikeBooking|confirmUnbook|upcomingCancel|cancelBikeSlot|upcomingSeatCancel|joinWaitlist|leaveWaitlist|claimWaitlistSpot|bookWeeklyTemplate|processOfflineQueue|apiFetch|fetch)\s*\(/.test(actorSrc),
      '…calls nothing that books, cancels, joins, claims or sends a request');
  }

  t.section('Android Back: a request in flight swallows the press — but a dialog that waits on the member is answered first');
  {
    const MARKS = [['busyAttr', 'data-busy="1" (a booking or a waitlist join waiting on Psycle)'], ['dots', 'a button reading "…" (_busyLabel: a cancel in flight too)'],
      ['running', 'the usual-week run ("Stop after this class" is up)'], ['swapping', 'a spot swap between its DELETE and its POST (_swapInFlight; the picker stays open under "Swapping...")'],
      ['cancellingSeat', 'one seat\'s cancel from the picker ("Cancelling…" in its hint)']];
    MARKS.forEach(([flag, what]) => {
      const inPicker = flag === 'swapping' || flag === 'cancellingSeat';
      const w = page({ tab: 'bookings', stack: inPicker ? ['bikeModal'] : [], [flag]: true });
      eq([w.back(), w.log], [true, []], what + ' → true, and NOTHING is closed, answered or logged' + (inPicker ? ' — the picker, and the swap context with it, stays' : ''));
    });
    const hintOnly = page({ tab: 'bookings', cancellingSeat: true });
    eq([hintOnly.back(), hintOnly.acts()], [true, ['switchTab discover']], 'the hint\'s words with the picker CLOSED are not a request in flight (#modalHint is permanent markup)');
    const uwRun = page({ tab: 'bookings', usualWeek: dialog(), running: true });
    eq([uwRun.back(), uwRun.log], [true, []], 'the usual-week sheet mid-run is still swallowed: it is not a dialog that waits on the member');

    // bookClass keeps data-busy (and "…") on its button while its OWN confirm
    // is up, and claimWaitlistSpot keeps "…" on Claim: read as a request in
    // flight, that made Back dead on exactly the dialogs that spend.
    MARKS.filter(([flag]) => flag !== 'cancellingSeat').forEach(([flag]) => {
      const w = page({ tab: 'bookings', confirm: dialog(), stack: flag === 'swapping' ? ['bikeModal'] : [], [flag]: true });
      eq([w.back(), w.acts()], [true, ['click confirm: CANCEL']], 'a confirm up over "' + flag + '" → its Cancel, at once: a dialog that waits on the member outranks every busy mark');
    });
    const spend = page({ confirm: dialog(), busyAttr: true, dots: true, stack: ['classDetailOverlay'] });
    eq([spend.back(), spend.acts(), spend.timers.length], [true, ['click confirm: CANCEL'], 0], '"Book this class?" as bookClass leaves it — data-busy AND "…" under the confirm → Cancel; no wait is started');
    const welcomeOver = page({ welcome: dialog(), dots: true });
    eq([welcomeOver.back(), welcomeOver.acts()], [true, ['click welcome: Skip']], 'the welcome (replayed from Settings) over a busy page → answered too');

    const w = page({ tab: 'bookings', dots: true });
    w.back();
    w.st.now += 59000;
    eq([w.back(), w.log], [true, []], 'still waiting 59 s later → still swallowed');
    w.st.now += 2000;
    eq([w.back(), w.acts()], [true, ['switchTab discover']], 'a minute on, the button is stuck rather than busy: Back works again');
    w.st.dots = false; w.st.tab = 'bookings';
    w.back();
    w.st.dots = true; w.st.tab = 'bookings';
    eq(w.back(), true, 'a NEW request later starts its own minute');
    eq(w.acts().length, 2, '…swallowed again');

    // The stretch ends when the WAITING ends, with no idle press in between:
    // the booking lands, the member taps Done, and two minutes later presses
    // Back during a cancel.
    const two = page({ tab: 'bookings', dots: true });
    eq([two.back(), two.timers.filter((x) => x.live).map((x) => x.ms)], [true, [1000]], 'a swallowed press starts ONE once-a-second look');
    two.back();
    eq(two.timers.length, 1, '…and a second swallowed press does not start another');
    two.second(); two.second();
    eq(two.timers.filter((x) => x.live).length, 1, 'still busy: it keeps looking');
    two.st.dots = false;
    two.second();
    eq(two.timers.filter((x) => x.live).length, 0, 'the request has landed: the look ends the stretch and stops');
    two.st.now += 120000;
    two.st.dots = true;
    eq([two.back(), two.log], [true, []], 'two minutes later, a NEW request and no idle press in between → swallowed (it used to be measured from the first press, found "stuck", and acted on)');

    const stuck = page({ tab: 'bookings', dots: true });
    stuck.back();
    for (let i = 0; i < 61; i++) stuck.second();
    eq([stuck.timers.filter((x) => x.live).length, stuck.back(), stuck.acts()], [0, true, ['switchTab discover']], 'a button stuck on "…": the look stops by itself at the minute (nothing is polled for good), and Back works');

    const broken = page({ throws: true });
    eq(broken.back(), false, 'a page it cannot read → false: Android does its part, nothing is closed and nothing is answered');
    const noTabs = page({ tab: 'stats' });
    delete noTabs.ctx.switchTab;
    eq(noTabs.back(), false, 'no switchTab (tabs.js failed to load) → false rather than a swallowed press');
  }
  t.section('Android Back: what the actor assumes about the shipped bookClass — busy under its own confirm; "Book anyway" goes on to a confirm, never to a POST');
  {
    // The real function, sliced as tests/suites/booking-races.js slices it.
    const grabFn = (opener) => {
      const lines = appSrc.split('\n');
      const from = lines.findIndex((l) => l.startsWith(opener));
      if (from === -1) throw new Error('18-android suite: cannot find "' + opener + '" (anchor moved?)');
      const to = lines.findIndex((l, i) => i > from && l === '}');
      return lines.slice(from, to + 1).join('\n');
    };
    const tick = () => new Promise((r) => setImmediate(r));
    // A signed-in member taps Book on a class in a studio with no seat map, the
    // session about to expire. Every confirm is answered "no" — what Back's
    // click on .confirm-btn-cancel answers — and records the button under it.
    const run = async (expiring) => {
      const seen = { confirms: [], requests: [], posts: 0, toasts: [] };
      const button = { textContent: 'Book', className: 'book-btn', disabled: false, dataset: {}, style: {} };
      button.classList = { contains: (c) => button.className.split(/\s+/).includes(c) };
      const ctx = t.vm.createContext({
        _myBookings: {}, currentUser: { id: 1 }, _eventCache: {}, _studioMap: { 4: { has_layout: false, name: 'Studio 2' } },
        window: {}, navigator: { onLine: true }, console: { log() {}, warn() {}, info() {}, error: console.error },
        setTimeout: () => 0, clearTimeout: () => {}, document: { getElementById: () => null },
        getBearerToken: () => 'tok', openLoginPopup: () => { seen.requests.push('login popup'); },
        isTokenExpiringSoon: () => expiring,
        confirmModal: async (c) => { seen.confirms.push([c.title, c.cancelText, button.dataset.busy || '', button.textContent]); return false; },
        toast: (msg) => seen.toasts.push(msg),
        apiFetch: async (path, opts) => { seen.requests.push(((opts && opts.method) || 'GET') + ' ' + path); return { ok: true, status: 200, json: async () => ({ slots: [], data: {} }) }; },
        showBikePicker: () => { seen.requests.push('picker'); },
        submitBooking: async () => { seen.posts++; },
        leaveWaitlist: async () => {}, confirmJoinWaitlist: async () => {},
        slotLabelForEvent: () => 'Space', _waitlistClassLine: () => 'Barre, 07:00', _parseSlots: (x) => x,
        _clearUnverifiedBooking: async () => true, _clashFor: () => null, _clashLabel: () => '', applyBookedState: () => {},
      });
      t.vm.runInContext("var _bookingsLoadState = 'loaded';\n" + [grabFn('function _busyLabel('), grabFn('function _friendlyError('), grabFn('async function bookClass(')].join('\n'), ctx);
      await ctx.bookClass(501, button, 4);
      await tick();
      return { seen, button };
    };
    const plain = await run(false);
    eq(plain.seen.confirms, [['Book this class?', 'Not now', '1', '…']],
      'bookClass\'s own confirm goes up over a button it still marks data-busy="1" and "…" — a double-tap guard, NOT a request in flight: hence "a dialog that waits on the member is answered first"');
    eq([plain.seen.posts, plain.seen.requests, plain.button.textContent, plain.button.disabled, 'busy' in plain.button.dataset], [0, ['GET /events/501'], 'Book', false, false],
      '…and answered "no" (Back) it books nothing and hands the button back');

    const expiring = await run(true);
    eq(expiring.seen.confirms.map((c) => c.slice(0, 2)), [['Session expiring', 'Book anyway'], ['Book this class?', 'Not now']],
      'Back on "Session expiring" presses "Book anyway": the flow CARRIES ON — to the confirm that does spend, which the next Back answers "Not now"');
    eq([expiring.seen.posts, expiring.seen.requests], [0, ['GET /events/501']], '…so two presses of Back end it with one read and no POST, and the sign-in page is never opened');

    // The cancel labels that do not mean "leave it all as it was" are named in
    // agents/architecture/android.md and ios-app/ANDROID.md. A new one fails
    // here until it is written down there too.
    const PLAIN_NO = ['Not now', 'Keep it', 'Keep booking', 'Stay signed in', 'Stay on it', 'Cancel', 'OK'];
    const labels = [];
    ['js/app.js', 'js/tabs.js', 'js/settings.js', 'js/features.js', 'js/reliability.js', 'js/explore.js', 'js/calendar.js', 'ios-app/www/native-bridge.js'].forEach((f) => {
      t.readSource(f).replace(/cancelText:\s*'([^'\n]*)'/g, (all, label) => { labels.push(label); return all; });
    });
    ok(labels.length >= 15, 'the confirms\' cancel labels were found (' + labels.length + ')');
    eq(Array.from(new Set(labels.filter((l) => PLAIN_NO.indexOf(l) === -1))).sort(), ['Book anyway', 'Carry on', 'Discard'],
      'of every confirm in the app, exactly three have a cancel button that is more than a plain "no": "Book anyway", its usual-week twin "Carry on", and "Discard"');
    const androidDoc = t.readSource('agents/architecture/android.md');
    const ownerDoc = t.readSource('ios-app/ANDROID.md');
    ok(['"Book anyway"', '"Carry on"', '"Discard"'].every((l) => androidDoc.indexOf(l) !== -1 && ownerDoc.indexOf(l) !== -1), '…and both documents say what Back does on each of them');
  }
  {
    const login = t.readSource('login.html');
    ok(/<script data-android-back>\s*window\._psycleAndroidBack = function \(\) \{\s*location\.href = [^;]+;\s*return true;\s*\};\s*<\/script>/.test(login),
      'login.html answers Back too — its own "Back to Psync" — or Back on the sign-in page would send the app to the background');
    ok(/function doLogin\(/.test((/<script>([\s\S]*?)<\/script>/.exec(login) || [])[1] || ''), '…in a script WITH an attribute: the first attribute-less one is still the sign-in logic (offline.js runs it)');
  }

  t.section('Android app: no service worker (its files are in the bundle)');
  {
    // js/app.js's last block, as tests/suites/offline.js cuts it.
    const swSrc = appSrc.slice(actorTo);
    const launch = (capacitor) => {
      const registered = [];
      const ctx = { navigator: { serviceWorker: { register: (f) => { registered.push(f); return Promise.resolve(null); } } }, document: { addEventListener() {}, hidden: false }, Date, Promise };
      if (capacitor) ctx.Capacitor = capacitor;
      ctx.window = ctx;
      t.vm.createContext(ctx);
      t.vm.runInContext(swSrc, ctx, { filename: 'js/app.js[service worker]' });
      return registered;
    };
    eq(launch({ getPlatform: () => 'android' }), [], 'the Android app registers no worker: either the registration fails at every launch, or a worker takes hold — a second cache, stale after a store update');
    eq([launch({ getPlatform: () => 'ios' }), launch({}), launch(null)], [['sw.js'], ['sw.js'], ['sw.js']], 'the iPhone app and the web register exactly as before');
    eq(launch({ getPlatform: () => { throw new Error('x'); } }), ['sw.js'], 'a platform that cannot be read changes nothing');
  }

  // ════════════════════════════════════════════════════════════════════
  // C. Copy
  // ════════════════════════════════════════════════════════════════════
  t.section('Android copy: a widget and reminders — no Lock Screen widget, no live countdown, no Siri, no iPhone');
  {
    const w = t.loadPure('js/app.js', 'welcome');
    const android = w._welcomePages(true, true, 'android');
    const text = android.map((x) => x.title + ' ' + x.body + ' ' + (x.note || '')).join(' ');
    ok(!/iPhone|iOS|widgets|Siri|Lock Screen|Live Activity|countdown/i.test(text), 'the Android welcome promises nothing the Android app lacks: no iPhone, no widgetS (it has one, on the home screen), no Lock Screen, no countdown, no Siri');
    eq(android[3].body, 'Everything you hold in one place, with a widget and reminders.', '…its last page says what it has, in as few words as the iPhone\'s: a widget and reminders');
    ok(android[3].body.split(' ').length <= w._welcomePages(true, true, 'ios')[3].body.split(' ').length, '…and is no longer than the iPhone\'s sentence');
    ok(text.indexOf('!') === -1 && /swipe between days/.test(android[1].body), '…in the house style, and told to swipe (a touch screen)');
    eq(w._welcomePages(true, true, 'ios'), w._welcomePages(true, true), 'the iPhone app\'s pages are what they were (a bridge that cannot say reads as the iPhone app)');
    ok(/widgets and reminders on iPhone/.test(w._welcomePages(true, true, 'ios')[3].body), '…widgets and reminders, "on iPhone"');
    eq(w._welcomePages(false, true, 'android'), w._welcomePages(false, true), 'the web build is not an app, whatever it is running on');
    ok(/_onboardPages = _welcomePages\(_onboardNative\(\), touch, _onboardPlatform\(\)\);/.test(appSrc), 'startOnboarding hands the platform over');
  }
  {
    const r = t.loadPure('js/tabs.js', 'reminder-row');
    eq([r._classReminderSwitch(true, true, true).detail, r._classReminderSwitch(true, false, true).detail, r._classReminderSwitch(true, true, true).on],
      ['90 minutes before each class', 'Tap to allow notifications', true], 'the class-reminder row on Android: no "live countdown" (there is no Live Activity)');
    eq(r._classReminderSwitch(true, true).detail, '90 minutes before each class — opens the live countdown', 'the iPhone app\'s line is what it was');

    // The shipped toggles, sliced as tests/suites/ios-bridge.js slices them.
    const from = tabsSrc.indexOf('  var _classReminderGranted = null;');
    const to = tabsSrc.indexOf('  function _formatGbp(');
    ok(from !== -1 && to > from, 'the reminder rows found in js/tabs.js');
    const refused = async (capacitor) => {
      const toasts = [];
      const ctx = {
        toast: (m, k) => toasts.push([m, k]),
        document: { getElementById: () => null, addEventListener() {}, visibilityState: 'visible' },
        _nativeReminder: { isOn: () => false, enable: async () => false, disable: async () => {} },
        _nativeClassReminders: { isOn: () => false, hasPermission: async () => false, enable: async () => false, disable: async () => {} },
      };
      if (capacitor) ctx.Capacitor = capacitor;
      ctx.window = ctx;
      t.vm.createContext(ctx);
      t.vm.runInContext(tabsSrc.slice(from, to), ctx, { filename: 'js/tabs.js[reminder rows]' });
      await ctx._toggleClassReminders();
      await ctx._toggleReminder();
      return toasts;
    };
    eq(await refused({ getPlatform: () => 'android' }), [['Enable notifications for Psync in Android Settings first', 'error'], ['Enable notifications for Psync in Android Settings first', 'error']],
      'a refused permission on Android is put right in ANDROID Settings');
    const ios = [['Enable notifications for Psync in iOS Settings first', 'error'], ['Enable notifications for Psync in iOS Settings first', 'error']];
    eq([await refused({ getPlatform: () => 'ios' }), await refused({}), await refused(null)], [ios, ios, ios], 'the iPhone app (and a bridge that cannot say) still reads "iOS Settings"');
  }
  {
    ok(settingsSrc.indexOf('only available in the iOS app') === -1 && /Calendar sync is only available in the Psync app\./.test(settingsSrc), 'Settings: calendar sync is "only available in the Psync app" — not "the iOS app"');
    ok(/platform === 'android' \? kv\('Android app', 'Yes'\) : platform === 'web' \? kv\('Native app', 'No'\) : kv\('iOS app', 'Yes'\)/.test(settingsSrc),
      'Diagnostics: the row says which app — "Android app", or "iOS app" exactly as before');
    const from = settingsSrc.indexOf('  var _diagReportText = null;');
    const to = settingsSrc.indexOf('  window.openDiagnostics = function () {');
    ok(from !== -1 && to > from, 'the diagnostics copy block found in js/settings.js');
    const env = (capacitor) => {
      const window = { APP_VERSION: 'psycle-1' };
      if (capacitor) window.Capacitor = capacitor;
      const ctx = t.vm.createContext({ console, JSON, Date, Promise, window, navigator: { onLine: true, userAgent: 'UA' }, diagHasToken: () => true });
      t.vm.runInContext(settingsSrc.slice(from, to), ctx, { filename: 'js/settings.js[diag copy]' });
      const e = JSON.parse(ctx.diagBuildCopyBlob(null)).environment;
      return [e.platform, e.iosApp];
    };
    eq([env({ getPlatform: () => 'android' }), env({ getPlatform: () => 'ios' }), env({}), env(null)], [['android', false], ['ios', true], ['ios', true], ['web', false]],
      '"Copy diagnostics" names the platform; iosApp stays true for the iPhone app only');
  }

  {
    // Two strings that are not behind a pure block: the line under "Connect
    // Psycle account" (static markup) and the waitlist "You're in" notice.
    const html = t.readSource('psycle-finder.html');
    ok(/<div id="tokenWorksOn"[^>]*>Works on iPhone and desktop\.<\/div>/.test(html) && html.indexOf('Works on your phone') === -1,
      'psycle-finder.html keeps the line the iPhone app and the web always showed: "Works on iPhone and desktop."');
    const cut = (opener) => {
      const lines = appSrc.split('\n');
      const from = lines.findIndex((l) => l.startsWith(opener));
      if (from === -1) throw new Error('18-android suite: cannot find "' + opener + '" (anchor moved?)');
      return lines.slice(from, lines.findIndex((l, i) => i > from && l === '}') + 1).join('\n');
    };
    const tokenLine = (platform) => {
      const els = { tokenInput: { value: 'x' }, saveTokenBtn: { disabled: false }, tokenDialog: { style: {} }, tokenWorksOn: { textContent: 'Works on iPhone and desktop.' } };
      const ctx = t.vm.createContext({ document: { getElementById: (id) => els[id] || null } });
      if (platform !== undefined) ctx._onboardPlatform = () => platform;
      t.vm.runInContext(cut('function showTokenDialog('), ctx);
      ctx.showTokenDialog();
      return [els.tokenWorksOn.textContent, els.tokenDialog.style.display];
    };
    eq(tokenLine('android'), ['Works on your phone and on desktop.', 'flex'], 'the Android app rewords it as the dialog opens: "Works on your phone and on desktop."');
    eq([tokenLine('ios'), tokenLine(''), tokenLine(undefined)], [['Works on iPhone and desktop.', 'flex'], ['Works on iPhone and desktop.', 'flex'], ['Works on iPhone and desktop.', 'flex']],
      'the iPhone app, the web, and a page that cannot say: the markup\'s own words, untouched');

    const notice = (platform) => {
      const bodies = [];
      const ctx = t.vm.createContext({
        console, Date, Object, String, Number, setTimeout: () => 0, clearTimeout: () => {},
        document: { getElementById: () => null }, PsycleEvents: { emit() {} }, _dialogOpen: () => false,
        _waitlistClassLine: () => 'Ride, Mon 07:00', _eventCache: {},
        confirmModal: (c) => { bodies.push([c.body, c.warn]); return new Promise(() => {}); }, // left open, as waitlist-polish.js leaves it
      });
      if (platform !== undefined) ctx._onboardPlatform = () => platform;
      t.vm.runInContext('var _allocAnnounceTimer = null, _announceShowing = false; var _pendingAnnounce = { allocated: {}, emitted: {} };\n' + cut('function _announceAllocations('), ctx);
      ctx._announceAllocations([77]);
      return bodies[0] || [];
    };
    const android = notice('android');
    eq(android[0], 'Your waitlist place for Ride, Mon 07:00 is now a confirmed booking. It\'s in My Bookings (and your calendar/widget if you sync).', 'the waitlist "You\'re in" notice on Android: the calendar AND the widget — the Android app has one now, so the sentence is the iPhone\'s');
    ok(!/calendar if you sync/.test(appSrc) && (appSrc.match(/\(and your calendar\/widget if you sync\)/g) || []).length === 1, '…because it is ONE sentence again, with no platform branch left to drift (js/app.js)');
    const iphone = 'Your waitlist place for Ride, Mon 07:00 is now a confirmed booking. It\'s in My Bookings (and your calendar/widget if you sync).';
    eq([notice('ios')[0], notice('')[0], notice(undefined)[0]], [iphone, iphone, iphone], 'everywhere else the sentence is what it always was');
    eq([android[1], notice('ios')[1]], ["Psycle's normal 12-hour cancellation policy applies to it from now on.", "Psycle's normal 12-hour cancellation policy applies to it from now on."], '…and the cancellation-policy line under it is the same on both: money copy is not platform copy');
  }

  t.section('Android app: a share card goes out through the native sheet — never a "saved" toast over a download that cannot happen');
  {
    const at = tabsSrc.indexOf('  async function _shareAsTextOnAndroid(');
    const end = at === -1 ? -1 : tabsSrc.indexOf('\n  }\n', at);
    ok(at !== -1 && end > at, '_shareAsTextOnAndroid found in js/tabs.js');
    const run = async (capacitor, nativeShare) => {
      const log = { toasts: [], shared: [] };
      const ctx = { toast: (m, k) => log.toasts.push([m, k]) };
      if (capacitor) ctx.Capacitor = capacitor;
      if (nativeShare !== undefined) ctx.nativeShare = (title, text, url) => { log.shared.push([title, text, url]); return Promise.resolve(nativeShare); };
      ctx.window = ctx;
      t.vm.createContext(ctx);
      t.vm.runInContext(tabsSrc.slice(at, end + 5), ctx, { filename: 'js/tabs.js[_shareAsTextOnAndroid]' });
      const took = await ctx._shareAsTextOnAndroid('My Psycle Stats', '42 classes');
      return [took, log.shared, log.toasts];
    };
    const android = { getPlatform: () => 'android' };
    eq(await run(android, true), [true, [['My Psycle Stats', '42 classes', null]], [['Shared', 'success']]], 'Android: the card\'s line is shared as text (the web view has no Web Share API and no download manager)');
    eq(await run(android, false), [true, [['My Psycle Stats', '42 classes', null]], [['Share cancelled', 'info']]], '…and a dismissed sheet says cancelled');
    eq([await run({ getPlatform: () => 'ios' }, true), await run(null, true), await run(android, undefined)], [[false, [], []], [false, [], []], [false, [], []]],
      'the iPhone app, the web, and an Android page without the bridge: untouched — the image path runs as before');
    const calls = tabsSrc.match(/if \(await _shareAsTextOnAndroid\([^\n]+\)\) return;\n\s*(?:\n\s*\/\/ Fallback: download\n\s*)?var url = URL\.createObjectURL\(blob\);/g) || [];
    eq(calls.length, 2, 'both share cards (the stats card, the year wrap) ask it right before their download fallback');
  }

  // ════════════════════════════════════════════════════════════════════
  // D. The bridge as the Android app
  // ════════════════════════════════════════════════════════════════════
  const h = harness(t);
  const names = (b) => b.calls.plugin.map((c) => c[0]);

  t.section('Android bridge: notification channels once, and every reminder filed under one');
  {
    const { b } = await launchScenario(h, 'android');
    eq(b.calls.channels.map((c) => [c.id, c.name, c.importance, 'sound' in c]), [['class-reminders', 'Class reminders', 4, false], ['new-dates', 'New dates', 4, false]],
      'two channels, plain names, importance 4, no sound named (= the phone\'s default)');
    ok(names(b).indexOf('LocalNotifications.createChannel') < names(b).indexOf('LocalNotifications.schedule'), 'created before the first reminder is scheduled');

    const sched = b.calls.scheduled.map((s) => s.notifications);
    const classes = sched.filter((list) => list[0].extra && list[0].extra.eventId)[0] || [];
    const mondays = sched.filter((list) => list.length === 8)[0] || [];
    eq([classes.length, mondays.length], [1, 8], 'the class reminder and the eight Mondays were scheduled');
    eq(classes.map((x) => [x.channelId, x.smallIcon, x.iconColor]), [['class-reminders', 'ic_stat_psync', '#1B2130']], 'a class reminder → channel class-reminders, the ic_stat_psync icon, a tint');
    eq(Array.from(new Set(mondays.map((x) => [x.channelId, x.smallIcon, x.iconColor].join('|')))), ['new-dates|ic_stat_psync|#1B2130'], 'the Monday reminder → channel new-dates, the same icon and tint');
    ok(classes.concat(mondays).every((x) => x.schedule.allowWhileIdle === true && x.sound === 'default'), 'allowWhileIdle is kept on every one (what lets an inexact alarm fire while the phone dozes)');
    ok(classes.concat(mondays).every((x) => /^#[0-9a-f]{6}$/i.test(x.iconColor)), 'the tint is a literal #rrggbb: a colour the plugin cannot parse would REJECT the whole schedule()');
    eq(classes[0].body, 'Ann · Bank', 'the class reminder promises no "live countdown" on Android');

    // More scheduling in the same launch: a second class, the switch, a re-arm.
    b.ctx._myBookings['502'] = { bookingId: 10, slots: [3] };
    b.ctx._eventCache['502'] = { start_at: '2026-09-21 07:00:00', duration: 45, _typeName: 'BARRE', _instrName: 'Bo', _locName: 'Mortimer St' };
    b.events.emit('booking:complete');
    await h.flush();
    await b.ctx._nativeReminder.enable();
    await b.ctx._nativeClassReminders.enable();
    await h.flush();
    ok(b.calls.scheduled.length >= 4, 'more reminders were scheduled (' + b.calls.scheduled.length + ' schedule calls)');
    eq(b.calls.channels.length, 2, '…and the channels were still created ONCE in this launch');
    ok(b.calls.scheduled.every((s) => s.notifications.every((x) => !!x.channelId && x.smallIcon === 'ic_stat_psync')), 'every notification of every pass carries its channel and icon');

    eq([b.calls.warns, b.calls.errors], [[], []], 'nothing is warned or logged as an error in the whole launch');
  }
  {
    const b = h.boot({ platform: 'android', perm: 'granted', channelsFail: true, local: { psycle_weekly_reminder: 'on' } });
    await b.clock.advance(5000);
    eq([b.calls.channels.length, b.calls.scheduled.length, b.calls.warns, b.calls.errors], [2, 1, [], []],
      'Android before 8 has no channels (the plugin answers "unavailable"): swallowed, the reminder is scheduled all the same');
    ok(!/changeExactNotificationSetting|checkExactNotificationSetting|SCHEDULE_EXACT_ALARM'\)/.test(bridgeSrc.replace(/\/\/.*$/gm, '')), 'the exact-alarm setting is never asked for…');
    ok(/EXACT ALARMS ARE NOT ASKED FOR/.test(bridgeSrc), '…and the bridge says why an inexact alarm is acceptable');
  }
  t.section('Android bridge: a notification tap can be FORGED there (any app can start the exported launcher with the plugin\'s extras)');
  {
    const b = h.boot({ platform: 'android', perm: 'granted' });
    b.ctx._myBookings['501'] = { bookingId: 9, slots: [12] };
    b.ctx._eventCache['501'] = { start_at: '2026-09-20 18:30:00', duration: 45 };
    await h.flush();
    ok(names(b).indexOf('LocalNotifications.registerActionTypes') === -1 && names(b).indexOf('LocalNotifications.addListener') !== -1,
      'the action type (Book / Cancel / Snooze) is NOT registered on Android — no reminder the bridge arms carries it — and taps are still listened for');

    b.tap({ eventId: '501' }, 'SNOOZE', { title: 'Your Psycle account is locked', body: 'Sign in at evil.example' });
    b.tap({}, 'SNOOZE', { title: 'Free classes' });
    await h.flush();
    eq([b.calls.scheduled, b.calls.switchTab, b.calls.opened], [[], [], []],
      'a forged SNOOZE does nothing: the payload\'s own title and body are never re-posted under Psync\'s name, and no alarm is armed');

    ['__proto__', 'constructor', '501 ', '5e2', '-1', '501;x', { id: 501 }].forEach((eventId) => {
      const f = h.boot({ platform: 'android', perm: 'granted' });
      f.ctx._myBookings['501'] = { bookingId: 9, slots: [12] };
      f.ctx._eventCache['501'] = { start_at: '2026-09-20 18:30:00', duration: 45 };
      f.tap({ eventId: eventId });
      eq([f.calls.switchTab, f.calls.opened], [['bookings'], []], 'an eventId that is not all digits (' + JSON.stringify(eventId) + ') → My Bookings, and no sheet is asked for — as a widget link with a bad id');
    });

    b.tap({ eventId: '501' });
    b.tap({ eventId: 501 });
    eq([b.calls.switchTab, b.calls.opened], [['bookings', 'bookings'], ['501', '501']], 'a real class-reminder tap (digits, as a string or a number) still lands on My Bookings and that class');
    b.tap(undefined);
    eq(b.calls.switchTab[2], 'discover', '…and the Monday reminder\'s tap, which carries no id, still takes its own route');
    eq([b.calls.warns, b.calls.errors], [[], []], 'none of it is warned about');
  }

  t.section('Android bridge: the status bar wears the theme\'s ground');
  {
    const reg = h.themeRegistry();
    ok(reg.length >= 2 && reg.every((x) => /^#[0-9a-f]{6}$/i.test(x.bg || '')), 'every APP_THEMES entry carries a #rrggbb ground (js/theme.js) — ' + reg.length + ' themes');
    const bgOf = (id) => reg.find((x) => x.id === id).bg;
    const b = h.boot({ platform: 'android', theme: 'cloud' });
    await h.flush();
    eq([b.calls.setBackgroundColor, b.calls.setStyle], [[bgOf('cloud')], ['LIGHT']], 'at launch: Cloud\'s ground, with dark glyphs');
    const wrong = [];
    reg.forEach((th) => {
      b.setTheme(th.id);
      const got = b.calls.setBackgroundColor[b.calls.setBackgroundColor.length - 1];
      if (got !== th.bg) wrong.push(th.id + '→' + got);
    });
    eq(wrong, [], 'on every theme change: that theme\'s ground');
    eq(b.calls.setBackgroundColor.length, b.calls.setStyle.length, 'the colour and the glyph style are always set together, from the same registry entry');

    const first = (base) => reg.find((x) => x.base === base).bg;
    const sysLight = h.boot({ platform: 'android', theme: null, systemLight: true });
    const sysDark = h.boot({ platform: 'android', theme: null, systemLight: false });
    eq([sysLight.calls.setBackgroundColor[0], sysDark.calls.setBackgroundColor[0]], [first('light'), first('dark')], 'no data-theme yet (following the system) → the first theme on that base, as js/theme.js falls back');

    const g = t.loadPure('ios-app/www/native-bridge.js', 'android-bridge');
    eq([g._themeGround(reg, 'no-such-theme', 'dark'), g._themeGround([{ id: 'x', base: 'dark', bg: 'red' }], 'x', 'dark'), g._themeGround(null, 'x', 'dark'), g._themeGround([{ id: 'x', base: 'dark' }], 'x', 'dark')],
      [first('dark'), null, null, null], 'an unknown theme id → the dark base\'s ground; a colour that is not #rrggbb, or no registry → null, and the bar is left alone');
  }

  // The Android app has twins of AppGroupPreferences, WidgetCenter and
  // PsycleDeepLink since level 3, and the bridge serves them by existence
  // (20-android-widget.js). THIS launch is an Android app that has none of the
  // four — one built before the twins: what it must never do is say so.
  t.section('Android bridge: an app built before the widget twins — the missing plugins are skipped without a word');
  {
    const { b, lines } = await launchScenario(h, 'android');
    const used = Array.from(new Set(names(b).map((n) => n.split('.')[0]))).sort();
    eq(used, ['LocalNotifications', 'Preferences', 'StatusBar'], 'one launch touches the plugins that app has — and no other name');
    ok(!/AppGroupPreferences|WidgetCenter|WidgetReloader|PsycleLiveActivity|PsycleDeepLink/.test(lines.join('\n')), 'no call to AppGroupPreferences, WidgetCenter, PsycleLiveActivity or PsycleDeepLink: none of them is there to call');
    eq([b.calls.warns, b.calls.errors], [[], []], 'and their absence is not warned about, at launch or in the snapshot pass');
    ok(b.calls.scheduled.length === 2, 'the snapshot pass still ran to its end: it is what arms the class reminders');

    // A reminder tap lands as it does on the iPhone.
    b.tap({ eventId: '501' });
    eq([b.calls.switchTab, b.calls.opened], [['bookings'], ['501']], 'a class-reminder tap → My Bookings, then that class');

    b.ctx.screen = { width: 412, height: 915 }; // the report reads the display; the harness has none
    const report = await b.ctx.getDiagnosticReport();
    ok(/^=== Psycle Android Diagnostic Report ===$/m.test(report) && /^Platform: android$/m.test(report), 'the diagnostic report says it is the Android app');
  }
  {
    // The two in-app asks: Android's words.
    const b = h.boot({ platform: 'android', perm: 'prompt', deny: true, local: { psycle_weekly_template: '[{"day":1}]' } });
    await h.flush();
    b.events.emit('booking:complete');
    await b.clock.advance(2500);
    ok(b.calls.modals.length === 1 && !/countdown/i.test(b.calls.modals[0].opts.body), 'the first-booking ask says nothing of a live countdown');
    b.calls.modals[0].answer(false);
    await h.flush();
    b.ctx._offerWeeklyReminder('test');
    await b.clock.advance(2500);
    eq(b.calls.modals.length, 2, 'the Monday-reminder ask opens');
    b.calls.modals[1].answer(true);
    await h.flush();
    eq(b.calls.toasts[b.calls.toasts.length - 1], ['Enable notifications for Psync in Android Settings first', 'error'], 'refused by the system → "Android Settings"');
  }

  // ════════════════════════════════════════════════════════════════════
  // E. The bridge as the iPhone app
  // ════════════════════════════════════════════════════════════════════
  t.section('iPhone bridge: not one call more, not one field more');
  {
    const ios = await launchScenario(h, 'ios');
    const legacy = await launchScenario(h, undefined);
    eq(ios.lines, legacy.lines, 'platform "ios" makes exactly the calls of a bridge that cannot say its platform — the fake every older suite boots');
    const got = digest(ios.lines.filter(notRestore));
    eq(got, IPHONE_LAUNCH_DIGEST, 'and they are, to the byte, the calls the bridge made before the Android work (new digest, if the iPhone path was changed on purpose: ' + got + ')');

    eq([ios.b.calls.channels, ios.b.calls.setBackgroundColor], [[], []], 'no channel is created and no status-bar colour is set (both methods exist on the iOS proxies: they are simply never called)');
    const all = ios.b.calls.scheduled.reduce((a, s) => a.concat(s.notifications), []);
    eq([all.length, all.filter((x) => 'channelId' in x || 'smallIcon' in x || 'iconColor' in x)], [9, []], 'none of the nine scheduled notifications has a channelId, a smallIcon or an iconColor');
    ok(/ — open Psync for the live countdown\.$/.test(all.filter((x) => x.extra)[0].body), 'the class reminder still ends "open Psync for the live countdown."');
    ok(names(ios.b).indexOf('PsycleDeepLink.addListener') !== -1 && names(ios.b).indexOf('WidgetCenter.reloadAllTimelines') !== -1 &&
      names(ios.b).indexOf('PsycleLiveActivity.refresh') !== -1 && names(ios.b).indexOf('AppGroupPreferences.set') !== -1, 'the widgets, the Live Activity and the widget link are served as before');
    ios.b.ctx.screen = { width: 390, height: 844 };
    const report = await ios.b.ctx.getDiagnosticReport();
    ok(/^=== Psycle iOS Diagnostic Report ===$/m.test(report) && /^Platform: ios$/m.test(report), 'the diagnostic report keeps its title and now names the platform');

    ios.b.tap({ eventId: '501' }, 'SNOOZE');
    await h.flush();
    const snoozed = ios.b.calls.scheduled[ios.b.calls.scheduled.length - 1].notifications[0];
    ok(!('channelId' in snoozed) && !('smallIcon' in snoozed), 'a snoozed reminder too');
  }

  // ════════════════════════════════════════════════════════════════════
  // F. The calendar plugin's Android side
  // ════════════════════════════════════════════════════════════════════
  t.section('Android calendar: the ownership marker is read from `description`; a row Android still lists after a delete is not a live event');
  {
    const START = Date.UTC(2026, 8, 20, 6, 0, 0); // 07:00 in London (BST)
    const MARK = (id) => 'Instructor: Alex\npsycle-event-id:' + id;
    // @ebarooni/capacitor-calendar 6.7.2, android/…/CapacitorCalendar.kt: ids and
    // calendarId as strings, dates as ms numbers, the notes under `description`,
    // permissions BARE (Capacitor's own checkPermissions), and a delete that
    // leaves the row in the table when `lingers` (a synced calendar).
    function androidCalendar(o) {
      const log = { created: [], deleted: [], listed: 0 };
      const rows = (o.events || []).slice();
      let seq = 900;
      const plugin = {
        checkAllPermissions: () => Promise.resolve({ readCalendar: 'granted', writeCalendar: 'granted', readWriteCalendar: 'granted' }),
        requestAllPermissions: () => Promise.resolve({ readCalendar: 'granted', writeCalendar: 'granted', readWriteCalendar: 'granted' }),
        listCalendars: () => Promise.resolve({ result: [{ id: '3', title: 'Psync', color: '#1B2130' }, { id: '4', title: 'Personal', color: '#FF0000' }] }),
        listEventsInRange(q) {
          log.listed++;
          if (typeof q.startDate !== 'number' || typeof q.endDate !== 'number') return Promise.reject(new Error('dates must be ms numbers (call.getLong)'));
          return Promise.resolve({ result: rows.map((r) => Object.assign({}, r)) });
        },
        deleteEventsById(q) {
          const gone = q.ids.map(String);
          log.deleted.push(gone);
          if (!o.lingers) gone.forEach((id) => { const i = rows.findIndex((r) => r.id === id); if (i !== -1) rows.splice(i, 1); });
          return Promise.resolve({ result: { deleted: gone, failed: [] } });
        },
        createEvent(data) {
          const id = String(++seq);
          log.created.push(data);
          rows.push({ id: id, title: data.title, description: data.notes, startDate: data.startDate, endDate: data.endDate, isAllDay: false, calendarId: String(data.calendarId) });
          return Promise.resolve({ result: id });
        },
      };
      return { plugin, log, rows };
    }
    const bootCal = (cal, platform, local) => {
      const b = h.boot({
        platform: platform,
        plugins: { CapacitorCalendar: cal.plugin },
        local: Object.assign({ psycle_calendar_mode: 'custom', psycle_calendar_target_id: '3' }, local || {}),
      });
      b.ctx._eventCache['501'] = { id: 501, start_at: '2026-09-20 07:00:00', duration: 45, _typeName: 'Ride', _instrName: 'Alex' };
      b.ctx._myBookings['501'] = { bookingId: 9001, slots: [7], waitlisted: false };
      return b;
    };
    const ride = (id) => ({ id: id, title: 'Ride — Alex (Spot 7)', description: MARK(501), startDate: START, endDate: START + 45 * 60000, isAllDay: false, calendarId: '3' });
    const dentist = { id: '60', title: 'Dentist', description: 'bring the form', startDate: START + 3600000, endDate: START + 7200000, isAllDay: false, calendarId: '3' };

    {
      const cal = androidCalendar({ events: [ride('77'), dentist] });
      const b = bootCal(cal, 'android');
      await h.flush();
      eq((await b.ctx.psycleListCalendars()).map((c) => [c.id, c.title]), [['3', 'Psync'], ['4', 'Personal']], 'bare permission aliases read as granted; the calendars are listed (Android reports no isImmutable)');
      const r = await b.ctx.syncAllBookingsToCalendar();
      eq([r.kept, r.added, r.removed, cal.log.created.length, cal.log.deleted], [1, 0, 0, 0, []],
        'the class\'s event is recognised by its marker under `description` and KEPT — not duplicated; the un-owned calendar\'s Dentist is left alone');
      eq(await b.ctx.psycleCountForeignEvents('3'), 1, 'the hand-over dialog counts the Dentist as the one event that is not a Psycle booking');
    }
    {
      const cal = androidCalendar({ events: [] });
      const b = bootCal(cal, 'android');
      await h.flush();
      const r = await b.ctx.syncAllBookingsToCalendar();
      const sent = cal.log.created[0] || {};
      eq([r.added, sent.calendarId, sent.startDate, sent.endDate, sent.isAllDay, sent.alertOffsetInMinutes, /psycle-event-id:501$/.test(sent.notes || '')],
        [1, '3', START, START + 45 * 60000, false, [60, 15], true], 'createEvent gets the names the Kotlin side reads: calendarId, ms startDate / endDate, isAllDay, alertOffsetInMinutes, and the marker in `notes`');
      eq(JSON.parse(b.ls.getItem('psycle_native_cal_events')), { 501: '901' }, '…and { result: "<id>" } is recorded as the event\'s id');
    }
    {
      // Cancel, then re-book the same seat before the calendar account has synced.
      const cal = androidCalendar({ events: [ride('77')], lingers: true });
      const b = bootCal(cal, 'android');
      await h.flush();
      delete b.ctx._myBookings['501'];
      b.events.emit('bookings:loaded', {});
      await b.clock.advance(1500);
      eq(cal.log.deleted, [['77']], 'cancelled: the reconcile deletes the class\'s event');
      ok(cal.rows.some((r) => r.id === '77'), '(Android keeps the row until the account syncs, and the plugin goes on listing it)');
      b.ctx._myBookings['501'] = { bookingId: 9002, slots: [7], waitlisted: false };
      const r = await b.ctx.syncAllBookingsToCalendar();
      eq([r.added, r.kept, cal.log.created.length], [1, 0, 1], 're-booked: the dead row is NOT taken for the class\'s event — a new event is created');
      const again = await b.ctx.syncAllBookingsToCalendar();
      eq([again.added, again.kept, again.removed, cal.log.deleted.length], [0, 1, 0, 1], 'the next pass keeps the new event, and does not delete the dead row a second time');
    }
    {
      // The same plugin answers under the iPhone app: nothing is filtered there.
      const cal = androidCalendar({ events: [ride('77')], lingers: true });
      const b = bootCal(cal, 'ios');
      await h.flush();
      delete b.ctx._myBookings['501'];
      b.events.emit('bookings:loaded', {});
      await b.clock.advance(1500);
      b.ctx._myBookings['501'] = { bookingId: 9002, slots: [7], waitlisted: false };
      const r = await b.ctx.syncAllBookingsToCalendar();
      eq([r.added, r.kept], [0, 1], 'the iPhone path lists what the plugin lists, as it always did (EventKit removes an event outright, so this never arises there)');
    }
  }

  t.section('Narrow phones: the welcome\'s time tile fits from 320 wide (most Android phones are 360)');
  {
    const crisp = t.readSource('css/crisp.css');
    const m = /^\.onboard-tile-time\s*\{([^}]*)\}/m.exec(crisp);
    t.ok(!!m, 'css/crisp.css sizes .onboard-tile-time (selector moved?)');
    const body = m ? m[1] : '';
    t.ok(/font-size:\s*min\(\s*var\(--type-time\)\s*,\s*[\d.]+vw\s*\)/.test(body), 'the numeral is the role size capped by the viewport width: "18:30" was cut at 320 and touched the edge at 360');
    const vw = Number((/([\d.]+)vw/.exec(body) || [])[1]);
    // three tiles share (width - 2 x 24 page padding - 2 x 8 gaps); each tile pads 12 a side; "18:30" in the display face
    // (Sofia Sans Condensed 900) MEASURES 2.365 em wide in a browser
    const roomAt = (w) => (w - 48 - 16) / 3 - 24;
    [320, 360, 375, 390, 412].forEach((w) => { const size = Math.min(34, w * vw / 100); t.ok(size * 2.365 <= roomAt(w), 'at ' + w + ' wide the numeral (' + size.toFixed(1) + ') fits its tile (' + roomAt(w).toFixed(0) + ' of room)'); });
    t.ok(Math.min(34, 430 * vw / 100) === 34 && Math.min(34, 375 * vw / 100) >= 30, 'at 430 wide it is the role size again, and on a 375 iPhone it is within four px of it');
    t.ok(/<span class="onboard-tile-time t-time">/.test(t.readSource('js/app.js')), 'the welcome still prints the tile with that class (anchor moved?)');
  }
};

module.exports.launchScenario = async function (h, platform) { return (await launchScenario(h, platform)).lines; };
// For 20-android-widget.js: the same launch WITH its boot ({ b, lines }), the
// Android twins (`opts.twins`, a box), and what holds the iPhone path still.
module.exports.launch = launchScenario;
module.exports.androidTwins = androidTwins;
module.exports.iphoneLaunchDigest = function (lines) { return { got: digest(lines.filter(notRestore)), want: IPHONE_LAUNCH_DIGEST }; };
