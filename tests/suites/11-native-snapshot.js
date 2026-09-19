'use strict';
// Wave 11 — the native surfaces in the Crisp Colour look: what the iOS bridge
// writes into the widget / Live Activity snapshot (class type + the member's
// colours), and the contracts that keep the Swift side in step with the web
// layer it copies from.
//
// Three layers, as tests/suites/ios-polish.js:
//   1. the DOM-free decisions, straight out of `pure:native-snapshot`;
//   2. the SHIPPED bridge in its own vm context against a fake Capacitor —
//      what really lands in widget_next_class / widget_upcoming / widget_week;
//   3. source contracts for Swift, which cannot run here: the fallback palette,
//      the class-type words and the eight pictograms are COPIES of values in
//      js/theme.js and js/app.js, and these hold them to the originals.
// Nothing native, no network. Class times are parsed DEVICE-locally on this
// path on purpose (owner's decision) — every class below is days out.

module.exports = async function (t) {
  const BRIDGE = 'ios-app/www/native-bridge.js';
  const BRIDGE_SRC = t.readSource(BRIDGE);
  const SWIFT = 'ios-app/ios/App/';
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const NOW = Date.UTC(2026, 8, 17, 9, 0, 0);

  const cc = t.loadPure('js/theme.js', 'class-colours');
  const core = t.loadPure('js/app.js', 'core');
  const classType = t.loadPure('js/app.js', 'class-type', { getCategory: core.getCategory });
  const PALETTE = cc.CLASS_COLOUR_PALETTE;
  const DEFAULTS = cc.CLASS_COLOUR_DEFAULTS;
  const KEYS = Array.from(cc.CLASS_COLOUR_KEYS);

  // window.PsycleClassColours, as js/theme.js builds it: get() is _ccClean of
  // whatever is stored.
  const engineFor = (stored) => ({ PALETTE: PALETTE, DEFAULTS: DEFAULTS, get: () => cc._ccClean(stored) });
  const COLOUR_FIELDS = ['ctIntensity', 'ctBase', 'ctTint', 'ctDeep', 'ctWash', 'ctBaseDark', 'ctTintDark', 'ctDeepDark', 'ctWashDark'];
  const ORIGINAL_FIELDS = ['eventId', 'startAt', 'instrName', 'typeName', 'studioName', 'locName', 'slots'];
  const colourKeysOf = (o) => Object.keys(o || {}).filter((k) => k === 'ct' || /^ct[A-Z]/.test(k)).sort();

  // ════════════════════════════════════════════════════════════════════
  t.section('Native snapshot: class type + colour fields (pure, native-bridge.js)');
  const p = t.loadPure(BRIDGE, 'native-snapshot');
  {
    t.eq([p._snapHex('#2d5fd6'), p._snapHex(' #2D5FD6 '), p._snapHex('#FFF'), p._snapHex('2D5FD6'), p._snapHex('#2D5FD6FF'), p._snapHex('rgba(45, 95, 214, 0.18)'), p._snapHex(null), p._snapHex(undefined), p._snapHex(12)],
      ['#2D5FD6', '#2D5FD6', null, null, null, null, null, null, null],
      'a colour is "#" + six hex digits, upper-cased — anything else (a short form, an alpha, an rgba() ring) is not written');

    t.eq(['RIDE: 45', 'STRENGTH 45', 'REFORMER: Strength', 'LAGREE: Upper Body & Core', 'YOGA FLOW', 'HIIT', 'BARRE 55', 'Sound Bath', ''].map((n) => p._snapClassTypeKey(n, classType.classTypeKey)),
      ['ride', 'strength', 'pilates', 'lagree', 'yoga', 'hiit', 'barre', 'other', 'other'],
      '`ct` is the app\'s OWN classTypeKey answer — the value data-ct gets');
    t.eq([p._snapClassTypeKey('RIDE', null), p._snapClassTypeKey('RIDE', undefined), p._snapClassTypeKey('RIDE', 'ride')], [null, null, null],
      'without the app\'s function there is no `ct` (Swift works the type out from the name) — no second copy of the category rules lives in the bridge');
    t.eq([p._snapClassTypeKey('RIDE', () => { throw new Error('x'); }), p._snapClassTypeKey('RIDE', () => '<b>'), p._snapClassTypeKey('RIDE', () => ({})), p._snapClassTypeKey('RIDE', () => 'RIDE')],
      [null, null, null, 'ride'], 'a throwing or odd classTypeKey costs the field, never the snapshot; the key is lower-cased');

    const soft = p._snapClassColourFields('ride', engineFor(null));
    t.eq(Object.keys(soft).sort(), COLOUR_FIELDS.slice().sort(), 'the fields: intensity, then base / tint / deep / wash for the light AND the dark appearance');
    t.eq([soft.ctIntensity, soft.ctBase, soft.ctTint, soft.ctDeep, soft.ctWash], ['soft', PALETTE.cobalt.light.base, PALETTE.cobalt.light.tintSoft, PALETTE.cobalt.light.deep, PALETTE.cobalt.light.tintBold],
      'default state: Ride is cobalt at "soft" — the pale tint is the card ground, the full tint the tile\'s wash');
    t.eq([soft.ctBaseDark, soft.ctTintDark, soft.ctDeepDark, soft.ctWashDark], [PALETTE.cobalt.dark.base, PALETTE.cobalt.dark.tintSoft, PALETTE.cobalt.dark.deep, PALETTE.cobalt.dark.tintBold],
      '…and the dark appearance is always written beside it (the widget follows the SYSTEM appearance, not the app theme)');

    const bold = p._snapClassColourFields('ride', engineFor({ v: 1, intensity: 'bold', map: {} }));
    t.eq([bold.ctIntensity, bold.ctTint, bold.ctTintDark], ['bold', PALETTE.cobalt.light.tintBold, PALETTE.cobalt.dark.tintBold], '"bold": the full tint is the ground');

    const off = p._snapClassColourFields('ride', engineFor({ v: 1, intensity: 'off', map: {} }));
    t.eq([off.ctIntensity, off.ctTint, off.ctTintDark], ['off', p.SNAPSHOT_NEUTRAL_TINT.light, p.SNAPSHOT_NEUTRAL_TINT.dark], '"off": the NEUTRAL tint is sent — the card goes neutral as a class card does');
    t.eq([off.ctBase, off.ctDeep, off.ctWash], [soft.ctBase, soft.ctDeep, soft.ctWash], '…while the class colour itself still travels, for the pictogram tile and the seat chip');

    const own = p._snapClassColourFields('ride', engineFor({ v: 1, intensity: 'soft', map: { ride: 'rose' } }));
    t.eq([own.ctBase, own.ctTint, own.ctBaseDark], [PALETTE.rose.light.base, PALETTE.rose.light.tintSoft, PALETTE.rose.dark.base], 'the member\'s own swatch for a type is what is sent');
    t.eq(p._snapClassColourFields('yoga', engineFor({ v: 1, intensity: 'soft', map: { ride: 'rose' } })).ctBase, PALETTE[DEFAULTS.yoga].light.base, '…and a type they left alone keeps its default');

    KEYS.forEach((k) => {
      const f = p._snapClassColourFields(k, engineFor(null));
      t.ok(COLOUR_FIELDS.every((name) => typeof f[name] === 'string') && COLOUR_FIELDS.filter((name) => name !== 'ctIntensity').every((name) => /^#[0-9A-F]{6}$/.test(f[name])),
        k + ': every colour field is an upper-case #RRGGBB');
    });

    t.eq([p._snapClassColourFields('ride', undefined), p._snapClassColourFields('ride', null), p._snapClassColourFields('ride', {}), p._snapClassColourFields('ride', { get: () => ({}) })], [{}, {}, {}, {}],
      'PsycleClassColours missing (or not an engine) → no colour fields; Swift draws the type in the app\'s defaults');
    t.eq(p._snapClassColourFields('ride', { PALETTE: PALETTE, DEFAULTS: DEFAULTS, get: () => { throw new Error('storage'); } }), {}, 'a throwing engine cannot break the snapshot');
    t.eq([p._snapClassColourFields(null, engineFor(null)), p._snapClassColourFields('', engineFor(null)), p._snapClassColourFields('boxing', engineFor(null)), p._snapClassColourFields('constructor', engineFor(null)), p._snapClassColourFields('__proto__', engineFor(null))],
      [{}, {}, {}, {}, {}], 'no key, an unknown key, or a prototype name → nothing (own properties only)');
    const broken = JSON.parse(JSON.stringify(PALETTE));
    broken.cobalt.dark.deep = 'rgba(0, 0, 0, 0.5)';
    t.eq(p._snapClassColourFields('ride', { PALETTE: broken, DEFAULTS: DEFAULTS, get: () => cc._ccClean(null) }), {},
      'all or nothing: ONE value that is not a colour and no colour field is written — the widget never mixes the member\'s colours with the defaults');
    t.eq(p._snapClassColourFields('ride', { PALETTE: PALETTE, DEFAULTS: DEFAULTS, get: () => ({ intensity: 'neon', map: {} }) }).ctIntensity, 'soft', 'an unknown intensity reads as the default');
  }

  // ════════════════════════════════════════════════════════════════════
  // The shipped bridge, booted as tests/suites/ios-polish.js boots it — plus a
  // timer this suite drives by hand (the colour rewrite is debounced).
  const seat = (id, slots) => ({ bookingId: id, bookingIds: [id], slots: slots || [7], slotBookings: {}, waitlisted: false });
  const cached = (startAt, typeName) => ({ start_at: startAt, _typeName: typeName || 'RIDE: 45', _instrName: 'Maya', _locName: 'Shoreditch', _studioName: 'Studio 1' });
  const day = (n) => '2026-09-' + String(n).padStart(2, '0') + ' 18:30:00';

  function boot(opts) {
    opts = opts || {};
    const ls = t.makeFakeLocalStorage();
    const native = {};
    const group = {};
    const calls = { reloads: 0, laRefresh: 0, writes: 0 };
    const handlers = {};
    const timers = [];
    const plugins = {
      Preferences: {
        get: () => Promise.resolve({ value: null }),
        set(o) { native[o.key] = o.value; if (/^widget_/.test(o.key)) calls.writes++; return Promise.resolve(); },
        remove(o) { delete native[o.key]; return Promise.resolve(); },
      },
      AppGroupPreferences: { set(o) { group[o.key] = o.value; return Promise.resolve(); } },
      WidgetCenter: { reloadAllTimelines() { calls.reloads++; return Promise.resolve(); } },
      PsycleLiveActivity: { refresh() { calls.laRefresh++; return Promise.resolve(); } },
    };
    const ctx = {
      console: { log() {}, warn() {}, error() {} },
      localStorage: ls,
      navigator: { onLine: true },
      setTimeout(fn, ms) { timers.push({ fn: fn, ms: ms, live: true }); return timers.length; },
      clearTimeout(id) { if (timers[id - 1]) timers[id - 1].live = false; },
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
      switchTab() {},
      openClassDetail() {},
      _psycleNativeRestoreResolve() {},
    };
    if (opts.classTypeKey !== false) ctx.classTypeKey = opts.classTypeKey || classType.classTypeKey;
    let stored = opts.stored === undefined ? null : opts.stored;
    if (opts.engine !== false) ctx.PsycleClassColours = opts.engine || { PALETTE: PALETTE, DEFAULTS: DEFAULTS, get: () => cc._ccClean(stored) };
    ctx.window = ctx;
    ctx.self = ctx;
    t.vm.createContext(ctx);
    t.vm.runInContext('Date.now = __now;', ctx);
    t.vm.runInContext(BRIDGE_SRC, ctx, { filename: 'native-bridge.js[native-snapshot]' });
    const launchTimers = timers.length; // the bridge's own launch passes — never run here
    return {
      ctx, calls, native, group,
      async loaded() { ctx.PsycleEvents.emit('bookings:loaded', ctx._myBookings); await flush(); await flush(); },
      // What theme.js does after set(): store, then announce.
      async setColours(next, detail) { stored = next; ctx.PsycleEvents.emit('classcolours:changed', detail || {}); await flush(); },
      async announceColours() { ctx.PsycleEvents.emit('classcolours:changed', {}); await flush(); },
      // Timers armed SINCE launch that are still live (the colour debounce).
      pending() { return timers.slice(launchTimers).filter((x) => x.live); },
      async runPending() { this.pending().forEach((x) => { x.live = false; x.fn(); }); await flush(); await flush(); },
      widget(key) { return native[key] === undefined ? undefined : JSON.parse(native[key]); },
      shared(key) { return group[key] === undefined ? undefined : JSON.parse(group[key]); },
    };
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Native snapshot: every class entry carries its type and the member\'s colours');
  {
    const b = boot({ stored: { v: 1, intensity: 'bold', map: { strength: 'rose' } } });
    b.ctx._myBookings[1] = seat(1, [12]);
    b.ctx._eventCache[1] = cached(day(20), 'RIDE: 45');
    b.ctx._myBookings[2] = seat(2, [7]);
    b.ctx._eventCache[2] = cached(day(21), 'STRENGTH 45');
    b.ctx._myBookings[3] = seat(3, [3]);
    b.ctx._eventCache[3] = cached(day(21).replace('18:30', '19:45'), 'REFORMER: Sculpt');
    await b.loaded();

    const next = b.widget('widget_next_class') || {};
    t.eq(ORIGINAL_FIELDS.map((k) => next[k]), ['1', '2026-09-20T18:30:00', 'Maya', 'RIDE: 45', 'Studio 1', 'Shoreditch', [12]],
      'the seven original fields are written exactly as before (startAt still space→T, still the device-local wall time)');
    t.eq(next.ct, 'ride', 'next class: ct');
    t.eq([next.ctIntensity, next.ctBase, next.ctTint, next.ctDeep, next.ctBaseDark, next.ctTintDark, next.ctDeepDark],
      ['bold', PALETTE.cobalt.light.base, PALETTE.cobalt.light.tintBold, PALETTE.cobalt.light.deep, PALETTE.cobalt.dark.base, PALETTE.cobalt.dark.tintBold, PALETTE.cobalt.dark.deep],
      'next class: the member\'s colours at their intensity, light and dark');
    t.eq(Object.keys(next).sort(), ORIGINAL_FIELDS.concat(['ct'], COLOUR_FIELDS).sort(), '…and nothing else is added');

    const upcoming = b.widget('widget_upcoming') || [];
    t.eq(upcoming.map((c) => [c.eventId, c.ct, c.ctBase]), [['1', 'ride', PALETTE.cobalt.light.base], ['2', 'strength', PALETTE.rose.light.base], ['3', 'pilates', PALETTE[DEFAULTS.pilates].light.base]],
      'upcoming list: each class its OWN type and colours (Strength wears the member\'s rose, the reformer class the Pilates default)');

    const week = b.widget('widget_week') || [];
    t.eq(week.map((d) => [d.day, d.count, d.firstStart]), [['2026-09-20', 1, '2026-09-20T18:30:00'], ['2026-09-21', 2, '2026-09-21T18:30:00']], 'week buckets: day / count / firstStart as before');
    t.eq(week.map((d) => [d.ct, d.ctBase, d.ctIntensity]), [['ride', PALETTE.cobalt.light.base, 'bold'], ['strength', PALETTE.rose.light.base, 'bold']],
      '…each now also wearing the type + colours of the class that OPENS the day');
    t.ok(week.every((d) => !('eventId' in d) && !('slots' in d) && !('typeName' in d)), '…and only those fields — a day bucket does not turn into a class entry');

    t.eq(b.shared('widget_next_class'), next, 'the App Group copy — the one the extension really reads — is the same JSON');
    t.eq(b.shared('widget_upcoming'), upcoming, '…for the list too');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Native snapshot: a waitlist place is still never a class on the widget');
  {
    const b = boot();
    b.ctx._myBookings[1] = seat(1);
    b.ctx._eventCache[1] = cached(day(22), 'YOGA FLOW');
    b.ctx._myBookings[2] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 9 } };
    b.ctx._eventCache[2] = cached(day(20), 'RIDE: 45'); // sooner than the seat
    await b.loaded();
    t.eq((b.widget('widget_next_class') || {}).eventId, '1', 'the sooner waitlist PLACE is skipped: "next class" is the real seat');
    t.eq((b.widget('widget_next_class') || {}).ct, 'yoga', '…with the seat\'s own type');
    t.eq((b.widget('widget_upcoming') || []).map((c) => c.eventId), ['1'], 'the upcoming list holds no place');
    t.eq((b.widget('widget_week') || []).map((d) => [d.day, d.count, d.ct]), [['2026-09-22', 1, 'yoga']], 'the week counts no place, and takes no colour from one');
  }
  {
    const b = boot();
    b.ctx._myBookings[2] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 9 } };
    b.ctx._eventCache[2] = cached(day(20));
    await b.loaded();
    t.eq([b.widget('widget_next_class'), b.widget('widget_upcoming'), b.widget('widget_week')], [null, [], []], 'only places held → the widget is empty, as before');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Native snapshot: fallbacks — no colour engine, no classTypeKey');
  {
    const b = boot({ engine: false });
    b.ctx._myBookings[1] = seat(1, [12]);
    b.ctx._eventCache[1] = cached(day(20));
    await b.loaded();
    const next = b.widget('widget_next_class') || {};
    t.eq(colourKeysOf(next), ['ct'], 'PsycleClassColours missing: the type is still sent, and NO colour field — Swift draws it in the app\'s default palette');
    t.eq(ORIGINAL_FIELDS.map((k) => next[k]), ['1', '2026-09-20T18:30:00', 'Maya', 'RIDE: 45', 'Studio 1', 'Shoreditch', [12]], '…the class itself is untouched');
    t.ok(b.calls.laRefresh >= 1 && b.calls.reloads >= 1, '…and the pass still reaches the widget reload and the Live Activity nudge');
  }
  {
    const b = boot({ classTypeKey: false });
    b.ctx._myBookings[1] = seat(1, [12]);
    b.ctx._eventCache[1] = cached(day(20));
    await b.loaded();
    const next = b.widget('widget_next_class') || {};
    t.eq(Object.keys(next).sort(), ORIGINAL_FIELDS.slice().sort(), 'no classTypeKey (the bridge on its own): exactly the snapshot an older build wrote — which Swift must keep decoding');
    t.eq(Object.keys((b.widget('widget_week') || [{}])[0]).sort(), ['count', 'day', 'firstStart'], '…week bucket included');
  }
  {
    const b = boot({ engine: { PALETTE: PALETTE, DEFAULTS: DEFAULTS, get() { throw new Error('storage'); } }, classTypeKey() { throw new Error('boom'); } });
    b.ctx._myBookings[1] = seat(1);
    b.ctx._eventCache[1] = cached(day(20));
    await b.loaded();
    t.eq((b.widget('widget_next_class') || {}).eventId, '1', 'a throwing classTypeKey / engine costs the colours, never the class');
    t.eq(colourKeysOf(b.widget('widget_next_class')), [], '…no half-written colour fields');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Native snapshot: rewritten when the member changes their class colours');
  {
    const b = boot();
    b.ctx._myBookings[1] = seat(1);
    b.ctx._eventCache[1] = cached(day(20));
    await b.loaded();
    t.eq((b.widget('widget_next_class') || {}).ctBase, PALETTE.cobalt.light.base, 'starts in the default colour');
    const before = { writes: b.calls.writes, reloads: b.calls.reloads, la: b.calls.laRefresh };

    // Arrow keys in a swatch row choose as they move: a burst of events.
    await b.setColours({ v: 1, intensity: 'soft', map: { ride: 'sky' } });
    await b.setColours({ v: 1, intensity: 'soft', map: { ride: 'teal' } });
    await b.setColours({ v: 1, intensity: 'soft', map: { ride: 'jade' } });
    t.eq(b.calls.writes, before.writes, 'nothing is written while the choices are still coming');
    t.eq(b.pending().length, 1, '…one debounce is armed, however many events arrived');
    t.eq(b.pending()[0].ms, 250, '…for 250ms');
    await b.runPending();
    t.eq((b.widget('widget_next_class') || {}).ctBase, PALETTE.jade.light.base, 'then ONE rewrite, carrying the colour they settled on');
    t.eq((b.widget('widget_upcoming') || [{}])[0].ctBase, PALETTE.jade.light.base, '…in the list');
    t.eq((b.widget('widget_week') || [{}])[0].ctBase, PALETTE.jade.light.base, '…and the week');
    t.eq([b.calls.writes - before.writes, b.calls.reloads - before.reloads, b.calls.laRefresh - before.la], [3, 1, 1],
      'three keys, one widget reload, one Live Activity nudge (so a card that is up changes colour too)');

    // A light ↔ dark switch announces the same event with the SAME choices.
    const settled = { writes: b.calls.writes, reloads: b.calls.reloads };
    await b.announceColours();
    await b.runPending();
    t.eq([b.calls.writes, b.calls.reloads], [settled.writes, settled.reloads], 'a theme switch re-announces unchanged colours: nothing is rewritten (both appearances are always in the snapshot)');

    await b.setColours({ v: 1, intensity: 'off', map: { ride: 'jade' } });
    await b.runPending();
    const off = b.widget('widget_next_class') || {};
    t.eq([off.ctIntensity, off.ctTint, off.ctTintDark, off.ctBase], ['off', p.SNAPSHOT_NEUTRAL_TINT.light, p.SNAPSHOT_NEUTRAL_TINT.dark, PALETTE.jade.light.base],
      'an intensity change is a colour change: "off" rewrites with the neutral tint');
  }
  {
    // Signed in but nothing confirmed yet: the colour event must not be what
    // blanks the widget (updateWidgetSnapshot's own guard still decides).
    const b = boot();
    await b.setColours({ v: 1, intensity: 'bold', map: {} });
    await b.runPending();
    t.eq(b.widget('widget_next_class'), undefined, 'before any bookings load, a colour change writes nothing');
  }

  // ════════════════════════════════════════════════════════════════════
  // Swift cannot run here. The values below are COPIES of web-layer values;
  // these sections fail when one side changes without the other. (The Swift
  // itself is proved by the App-scheme simulator build and by
  // ios-app/native-checks/run.sh on a Mac.)
  const classTypeSwift = t.readSource(SWIFT + 'PsycleShared/PsycleClassType.swift');
  const between = (src, a, b, what) => {
    const s = src.indexOf(a), e = src.indexOf(b);
    t.ok(s !== -1 && e > s, what + ': markers found (anchor moved?)');
    return s !== -1 && e > s ? src.slice(s, e) : '';
  };

  t.section('Swift parity: the fallback palette is the app\'s DEFAULTS, value for value');
  {
    const block = between(classTypeSwift, '// ── fallback-palette:start', '// ── fallback-palette:end', 'fallback palette');
    const rows = {};
    const re = /\.(\w+): \(Swatch\(tintSoft: "(#[0-9A-Fa-f]{6})", tintBold: "(#[0-9A-Fa-f]{6})", base: "(#[0-9A-Fa-f]{6})", deep: "(#[0-9A-Fa-f]{6})"\),\s*Swatch\(tintSoft: "(#[0-9A-Fa-f]{6})", tintBold: "(#[0-9A-Fa-f]{6})", base: "(#[0-9A-Fa-f]{6})", deep: "(#[0-9A-Fa-f]{6})"\)\)/g;
    let m;
    while ((m = re.exec(block))) rows[m[1]] = { light: m.slice(2, 6), dark: m.slice(6, 10) };
    t.eq(Object.keys(rows).sort(), KEYS.slice().sort(), 'one row per class type — the eight CATEGORY_MAP keys');
    KEYS.forEach((k) => {
      const sw = PALETTE[DEFAULTS[k]];
      const want = (side) => [side.tintSoft, side.tintBold, side.base, side.deep];
      t.eq(rows[k] || {}, { light: want(sw.light), dark: want(sw.dark) }, k + ' = ' + DEFAULTS[k] + ' (js/theme.js), light and dark');
    });
    const enumCases = (/case (ride, strength[^\n]*)\n/.exec(classTypeSwift) || [])[1] || '';
    t.eq(enumCases.split(',').map((s) => s.trim()), KEYS, 'PsycleClassType has the same eight cases, in CATEGORY_MAP order');
  }

  t.section('Swift parity: the class-type words are CATEGORY_MAP\'s');
  {
    const block = between(classTypeSwift, '// ── class-type-words:start', '// ── class-type-words:end', 'class-type words');
    const rows = [];
    const re = /\(\.(\w+), \[([^\]]*)\]\)/g;
    let m;
    while ((m = re.exec(block))) rows.push([m[1], m[2].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean)]);
    const want = JSON.parse(t.vm.runInContext('JSON.stringify(CATEGORY_MAP.filter(function (c) { return c.key !== "OTHER"; }).map(function (c) { return [c.key.toLowerCase(), c.prefixes]; }))', core));
    t.eq(rows, want, 'same categories, same words, same order (first match wins on both sides)');
    t.ok(/name\.contains\("LAGREE"\) \|\| name\.contains\("MEGAFORMER"\) \{ return \.lagree \}/.test(classTypeSwift) && /name\.contains\("REFORMER"\) \{ return \.pilates \}/.test(classTypeSwift),
      '…after getCategory\'s two equipment-first rules (Lagree, then Reformer → Pilates)');
  }

  t.section('Swift parity: the neutral surface and the inks are Cloud\'s and Graphite\'s');
  {
    const css = t.readSource('css/theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const token = (theme, name) => {
      const body = (new RegExp('\\[data-theme="' + theme + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}').exec(css) || [])[1] || '';
      return ((new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})').exec(body) || [])[1] || '').toUpperCase();
    };
    const chrome = (name) => ((new RegExp('static let ' + name + ' = PsycleRGB\\(hex: "(#[0-9A-Fa-f]{6})"\\)').exec(classTypeSwift) || [])[1] || '').toUpperCase();
    t.eq([p.SNAPSHOT_NEUTRAL_TINT.light, p.SNAPSHOT_NEUTRAL_TINT.dark], [token('cloud', '--bg-panel'), token('graphite', '--bg-panel')], 'bridge: the neutral tint of "off" is the surface of Cloud / Graphite');
    t.eq([chrome('surfaceLight'), chrome('surfaceDark')], [token('cloud', '--bg-panel'), token('graphite', '--bg-panel')], 'Swift: the same two surfaces');
    t.eq([chrome('inkOnLight'), chrome('ink2OnLight'), chrome('inkOnDark'), chrome('ink2OnDark')],
      [token('cloud', '--text'), token('cloud', '--text-muted'), token('graphite', '--text'), token('graphite', '--text-muted')],
      'Swift: copy on a class tint is --text / --text-muted — the two inks the contrast matrix holds on every tint');
  }

  t.section('Swift parity: the eight pictograms are the web marks, number for number');
  {
    const round = (n) => Math.round(n * 1000) / 1000;
    // The subset of SVG the marks use → the primitives the Swift table holds.
    function marksOf(svg) {
      const out = [];
      const re = /<(circle|rect|path)\b([^>]*)\/>/g;
      let m;
      while ((m = re.exec(svg))) {
        const attr = (name) => { const a = new RegExp('\\b' + name + '="([^"]*)"').exec(m[2]); return a ? a[1] : null; };
        if (m[1] === 'circle') out.push(['circle', [attr('cx'), attr('cy'), attr('r')].map(Number)]);
        else if (m[1] === 'rect') out.push(['rect', [attr('x'), attr('y'), attr('width'), attr('height'), attr('rx')].map(Number)]);
        else {
          const tokens = attr('d').match(/[MLHVZmlhvz]|-?\d*\.?\d+/g) || [];
          const pts = [];
          let cmd = null, x = 0, y = 0, closed = false, i = 0;
          const num = () => Number(tokens[i++]);
          while (i < tokens.length) {
            if (/[A-Za-z]/.test(tokens[i])) { cmd = tokens[i++]; if (cmd === 'z' || cmd === 'Z') { closed = true; continue; } }
            if (cmd === 'M') { x = num(); y = num(); cmd = 'L'; }
            else if (cmd === 'm') { x += num(); y += num(); cmd = 'l'; }
            else if (cmd === 'L') { x = num(); y = num(); }
            else if (cmd === 'l') { x += num(); y += num(); }
            else if (cmd === 'H') { x = num(); }
            else if (cmd === 'h') { x += num(); }
            else if (cmd === 'V') { y = num(); }
            else if (cmd === 'v') { y += num(); }
            else throw new Error('pictogram path uses a command this test does not know: ' + cmd);
            pts.push([round(x), round(y)]);
          }
          out.push([closed ? 'closed' : 'line', pts]);
        }
      }
      return out;
    }
    const swift = t.readSource(SWIFT + 'PsycleWidget/PsyclePictogram.swift');
    const table = between(swift, '// ── pictograms:start', '// ── pictograms:end', 'pictogram table');
    const swiftMarks = {};
    let current = null;
    table.split('\n').forEach((line) => {
      const head = /static let (\w+): \[PsycleMark\] = \[/.exec(line);
      if (head) { current = swiftMarks[head[1]] = []; return; }
      const prim = /^\s*\.(circle|rect|line|closed)\((.*)\),\s*$/.exec(line);
      if (!prim || !current) return;
      if (prim[1] === 'circle' || prim[1] === 'rect') current.push([prim[1], prim[2].split(',').map(Number)]);
      else current.push([prim[1], (prim[2].match(/p\(([^)]*)\)/g) || []).map((s) => s.slice(2, -1).split(',').map(Number))]);
    });
    t.eq(Object.keys(swiftMarks).sort(), Object.keys(classType.CLASS_PICTOGRAMS).sort(), 'one Swift mark per web pictogram');
    Object.keys(classType.CLASS_PICTOGRAMS).forEach((k) => {
      t.eq(swiftMarks[k] || [], marksOf(classType.CLASS_PICTOGRAMS[k]), k + ': same elements, same order, same numbers on the 24 grid');
    });
    t.ok(Object.keys(classType.CLASS_PICTOGRAMS).every((k) => marksOf(classType.CLASS_PICTOGRAMS[k]).length > 0 && (classType.CLASS_PICTOGRAMS[k].match(/<\w+/g) || []).length === marksOf(classType.CLASS_PICTOGRAMS[k]).length),
      'every element of every web mark was understood (a new SVG element kind would need a Swift primitive)');

    // The stroke: 24 grid, round caps + joins, the web's thickening steps.
    const webStroke = (px) => Number((/stroke-width="([\d.]+)"/.exec(classType.classPictogram('ride', px)) || [])[1]);
    const swiftStroke = (px) => {
      const body = (/static func strokeUnits\(forSize size: CGFloat\) -> CGFloat \{([\s\S]*?)\n    \}/.exec(swift) || [])[1] || '';
      const steps = [];
      const re = /if px <= (\d+) \{ return ([\d.]+) \}/g;
      let m;
      while ((m = re.exec(body))) steps.push([Number(m[1]), Number(m[2])]);
      const hit = steps.find((s) => px <= s[0]);
      return hit ? hit[1] : Number((/\n\s*return ([\d.]+)\s*$/.exec(body) || [])[1]);
    };
    const sizes = [8, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 28, 48];
    t.eq(sizes.map(swiftStroke), sizes.map(webStroke), 'the stroke thickens as the mark shrinks exactly as classPictogram() does (2 at 24px, 2.2 at 18px, 2.5 at 13px)');
    t.ok(/static let grid: CGFloat = 24\b/.test(swift) && /lineCap: \.round/.test(swift) && /lineJoin: \.round/.test(swift), 'a 24 grid, round caps and round joins');
    t.ok(/\.stroke\(style:/.test(swift) && !/\.fill\(/.test(swift), 'the marks are STROKED — a filled outline would be a blob');
  }

  t.section('Swift contract: 24-hour times through one formatter; no emoji, no SF Symbol look-alikes');
  {
    t.ok(/formatter\.locale = Locale\(identifier: "en_US_POSIX"\)/.test(classTypeSwift) && /private static let clock = formatter\("HH:mm"\)/.test(classTypeSwift),
      'PsycleClock: a FIXED "HH:mm" pattern under the fixed POSIX locale — the device\'s 12/24-hour setting cannot rewrite it');
    t.ok(/formatter\.timeZone = \.autoupdatingCurrent/.test(classTypeSwift), '…still in the DEVICE\'s zone (the snapshot path is device-local by the owner\'s decision — only the format changed)');
    const display = ['PsycleWidget/PsycleWidget.swift', 'PsycleWidget/PsycleWidgetLayouts.swift', 'PsycleWidget/PsycleWidgetStyle.swift', 'PsycleWidget/PsyclePictogram.swift',
      'PsycleLiveActivity/PsycleLiveActivityView.swift', 'PsycleIntents/NextClassIntent.swift'];
    display.forEach((file) => {
      const src = t.readSource(SWIFT + file).replace(/\/\/[^\n]*/g, '');
      // (\b: ISO8601DateFormatter() builds the gallery's sample START time — it prints nothing.)
      t.ok(!/\.hour\(\)|\.minute\(\)|h:mm|dateFormat\s*=|\bDateFormatter\(\)|style: \.time\b|\.formatted\(/.test(src), file + ': no clock format of its own (every printed time is PsycleClock\'s)');
      t.ok(!/Image\(systemName:|systemImage:/.test(src), file + ': no SF Symbol standing in for a class pictogram');
      t.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src), file + ': never an emoji');
    });
    const layouts = t.readSource(SWIFT + 'PsycleWidget/PsycleWidgetLayouts.swift');
    t.ok((layouts.match(/PsycleClock\.(time|dayTime|weekday)\b/g) || []).length >= 4 && /PsycleClock\.spoken\(date\)/.test(t.readSource(SWIFT + 'PsycleIntents/NextClassIntent.swift')),
      'the layouts and the Siri answer all print through PsycleClock');
    t.ok(/PsycleFittedLine/.test(layouts) && /ViewThatFits\(in: \.horizontal\)/.test(layouts), 'the Lock Screen size-stepping fix (PsycleFittedLine) is kept');
  }

  t.section('Swift contract: old payloads still decode; the new files are in their targets');
  {
    const snapshot = t.readSource(SWIFT + 'PsycleShared/PsycleSnapshot.swift');
    t.eq((snapshot.match(/style = \(try\? PsycleClassStyle\(from: decoder\)\) \?\? PsycleClassStyle\(\)/g) || []).length, 2,
      'PsycleNextClass and PsycleWeekDay read the colour fields with try? — a missing or odd value can never fail the class');
    t.ok(/func text\(_ key: CodingKeys\) -> String\? \{ \(try\? values\.decodeIfPresent\(String\.self, forKey: key\)\) \?\? nil \}/.test(classTypeSwift), 'PsycleClassStyle: every field is decodeIfPresent under try?');
    const style = between(classTypeSwift, 'public struct PsycleClassStyle', 'public init(ct:', 'PsycleClassStyle fields');
    const fields = style.match(/public var \w+: [^\n]+/g) || [];
    t.ok(fields.length === 10 && fields.every((f) => /: String\?$/.test(f)), 'all ten of its stored fields are optional strings');
    const codingKeys = (/enum CodingKeys: String, CodingKey \{([\s\S]*?)\n    \}/.exec(classTypeSwift.slice(classTypeSwift.indexOf('public struct PsycleClassStyle'))) || [])[1] || '';
    t.eq((codingKeys.match(/case \w+( = "\w+")?/g) || []).map((c) => (/"(\w+)"/.exec(c) || [null, c.replace('case ', '')])[1]).sort(), ['ct'].concat(COLOUR_FIELDS).sort(),
      '…and its coding keys are exactly the field names the bridge writes');

    const attrs = t.readSource(SWIFT + 'PsycleLiveActivity/PsycleLiveActivityAttributes.swift');
    const state = attrs.slice(attrs.indexOf('public struct ContentState'), attrs.indexOf('// Static attributes'));
    t.ok(/public var style: PsycleClassStyle\?/.test(state), 'Live Activity: ContentState.style is OPTIONAL — a card started by the previous build has no such key and still decodes');
    const fixed = attrs.slice(attrs.indexOf('// Static attributes'));
    t.eq((fixed.match(/public let \w+: [^\n]+/g) || []).map((s) => s.replace('public let ', '')), ['eventId: String', 'typeName: String', 'instrName: String', 'locName: String', 'slotSummary: String?'],
      '…and the static attributes are untouched (nothing non-optional was added anywhere)');
    t.ok(/state\.style = next\.style/.test(t.readSource(SWIFT + 'PsycleLiveActivity/PsycleLiveActivityController.swift')), 'the controller puts the snapshot\'s style into the STATE, so a colour change reaches a card that is already up');
    t.ok(/context\.state\.style \?\? PsycleClassStyle\(\)/.test(t.readSource(SWIFT + 'PsycleLiveActivity/PsycleLiveActivityView.swift')), '…and the view falls back to the class name + default colours when the state has none');

    const pbx = t.readSource(SWIFT + 'PsycleBookingBuddy.xcodeproj/project.pbxproj');
    const phase = (id) => (new RegExp(id + ' /\\* Sources \\*/ = \\{[\\s\\S]*?files = \\(([\\s\\S]*?)\\);').exec(pbx) || [])[1] || '';
    const target = (name) => (new RegExp('/\\* ' + name + ' \\*/ = \\{\\s*isa = PBXNativeTarget;[\\s\\S]*?buildPhases = \\(([\\s\\S]*?)\\);').exec(pbx) || [])[1] || '';
    const sourcesOf = (name) => phase(((/(\w{24}) \/\* Sources \*\//.exec(target(name)) || [])[1]) || 'MISSING');
    const app = sourcesOf('PsycleBookingBuddy'), ext = sourcesOf('PsycleWidgetExtension');
    t.ok(/PsycleClassType\.swift in Sources/.test(app) && /PsycleClassType\.swift in Sources/.test(ext), 'PsycleClassType.swift is compiled into BOTH targets (the intent + the controller need it in the app)');
    ['PsyclePictogram.swift', 'PsycleWidgetStyle.swift', 'PsycleWidgetLayouts.swift'].forEach((f) => {
      t.ok(new RegExp(f.replace('.', '\\.') + ' in Sources').test(ext) && !new RegExp(f.replace('.', '\\.') + ' in Sources').test(app), f + ' is compiled into the widget extension only');
    });
    ['PsycleShared', 'PsycleWidget'].forEach((dir) => {
      t.fs.readdirSync(t.path.join(t.REPO_ROOT, SWIFT + dir)).filter((f) => /\.swift$/.test(f)).forEach((f) => {
        t.ok(new RegExp('path = ' + f.replace('.', '\\.') + ';').test(pbx), dir + '/' + f + ' is in the Xcode project (a file on disk that no target compiles only fails on Xcode Cloud)');
      });
    });
    const wire = t.readSource(SWIFT + 'wire_native_targets.rb');
    ['PsycleClassType.swift', 'PsyclePictogram.swift', 'PsycleWidgetStyle.swift', 'PsycleWidgetLayouts.swift'].forEach((f) => {
      t.ok(wire.indexOf("'" + f + "'") !== -1, 'wire_native_targets.rb knows ' + f + ' (the scripted project surgery stays the whole truth)');
    });
  }

  t.section('Swift contract: snapshot times are READ with the fixed formatter too (a 12-hour phone, a non-Gregorian calendar)');
  {
    const code = (file) => t.readSource(SWIFT + file).replace(/\/\/[^\n]*/g, '');
    const factory = between(classTypeSwift, 'public enum PsycleFixedFormat', 'public enum PsycleClock', 'PsycleFixedFormat');
    t.ok(/formatter\.locale = Locale\(identifier: "en_US_POSIX"\)/.test(factory) && /formatter\.calendar = Calendar\(identifier: \.gregorian\)/.test(factory),
      'PsycleFixedFormat pins the POSIX locale AND the Gregorian calendar (on the user\'s locale "HH" is rewritten on a 12-hour phone and "yyyy" is their calendar\'s year)');
    t.ok(/private static func formatter\(_ pattern: String\) -> DateFormatter \{ PsycleFixedFormat\.formatter\(pattern\) \}/.test(classTypeSwift), 'PsycleClock prints through that same factory');
    const snapshot = code('PsycleShared/PsycleSnapshot.swift');
    t.ok(!/\bDateFormatter\(\)/.test(snapshot) && !/dateFormat\s*=/.test(snapshot),
      'PsycleSnapshot.swift builds no formatter of its own — its bare one parsed "2026-09-24T18:30:00" to nil with 24-Hour Time off (every widget empty) and to the year 1483 / 2587 under a Buddhist / Islamic calendar');
    t.eq((snapshot.match(/PsycleFixedFormat\.formatter\("[^"]+"\)/g) || []).sort(),
      ['PsycleFixedFormat.formatter("yyyy-MM-dd HH:mm:ss")', 'PsycleFixedFormat.formatter("yyyy-MM-dd\'T\'HH:mm:ss")', 'PsycleFixedFormat.formatter("yyyy-MM-dd")'].sort(),
      'the wall time, the raw API form and the week bucket\'s day are all read through it');
    const appSwift = ['PsycleWidget/PsycleWidget.swift', 'PsycleWidget/PsycleWidgetLayouts.swift', 'PsycleWidget/PsycleWidgetStyle.swift', 'PsycleLiveActivity/PsycleLiveActivityView.swift',
      'PsycleLiveActivity/PsycleLiveActivityController.swift', 'PsycleLiveActivity/PsycleLiveActivityAttributes.swift', 'PsycleIntents/NextClassIntent.swift'];
    t.ok(appSwift.every((f) => !/\bDateFormatter\(\)/.test(code(f))), 'no other widget / Live Activity / intent file builds a DateFormatter');
    const runSh = t.readSource('ios-app/native-checks/run.sh');
    t.ok(/-AppleLocale en_GB -AppleICUForce12HourTime '<true\/>'/.test(runSh) && /-AppleLocale ar_SA/.test(runSh) && /-AppleLocale th_TH/.test(runSh),
      'native-checks/run.sh runs a 12-hour UK phone (the override as a plist BOOLEAN — the string "YES" is ignored), ar_SA and th_TH');
    const checks = t.readSource('ios-app/native-checks/decode/main.swift');
    t.ok(/next\.startDate != nil/.test(checks) && /next\.startDate\.map\(PsycleClock\.dayTime\) == "Thu 18:30"/.test(checks), '…and its checks really call startDate (they used not to — which is how run 3 "passed")');
  }

  t.section('Swift contract: the countdown turns to "Now", the Live Activity paints its own ground, a name is never cut mid-word');
  {
    const snapshot = t.readSource(SWIFT + 'PsycleShared/PsycleSnapshot.swift');
    const plan = between(snapshot, 'public enum PsycleTimelinePlan', 'public enum PsycleSnapshotStore', 'PsycleTimelinePlan');
    t.ok(/if start > entryDate \{\s*steps\.append\(Step\(date: start, index: index\)\)\s*\}/.test(plan), 'PsycleTimelinePlan dates one entry exactly AT each class\'s start (Text(.relative) counts both ways: without it the card read "in 40 sec", climbing, after the start)');
    t.ok(/entryDate = max\(start\.addingTimeInterval\(60\), entryDate\.addingTimeInterval\(1\)\)/.test(plan), '…and the next class still takes over at start + 60s, dates strictly increasing');
    const widget = t.readSource(SWIFT + 'PsycleWidget/PsycleWidget.swift');
    t.ok(/PsycleTimelinePlan\.steps\(starts: upcoming\.map \{ \$0\.1 \}, now: now\)/.test(widget), 'the provider builds its entries from that plan');
    const layouts = t.readSource(SWIFT + 'PsycleWidget/PsycleWidgetLayouts.swift');
    t.ok(/if start > now \{\s*Text\("in \\\(start, style: \.relative\)"\)\s*\} else \{\s*Text\("Now"\)/.test(layouts), 'the countdown line: "in …" only while the start is ahead of its entry, else "Now"');

    const view = t.readSource(SWIFT + 'PsycleLiveActivity/PsycleLiveActivityView.swift');
    const ground = view.indexOf('.psycleActivityGround(surface.card)'), tint = view.indexOf('.activityBackgroundTint(surface.card)');
    t.ok(ground !== -1 && tint > ground, 'Live Activity: the card paints its own ground, in the pass that picks the inks — the platter tint (which lags a light ↔ dark switch) is only the hint under it');
    const style = t.readSource(SWIFT + 'PsycleWidget/PsycleWidgetStyle.swift');
    const groundFn = between(style, 'func psycleActivityGround(_ color: Color?)', 'func psycleCard(_ color: Color?)', 'psycleActivityGround');
    t.ok(/\.frame\(maxWidth: \.infinity\)\s*\.background\(color \?\? Color\.clear\)/.test(groundFn), '…filling the platter\'s width; nothing painted when the system has taken the background away');

    const head = between(layouts, 'private struct PsycleClassHead', 'private struct PsycleEmptyState', 'PsycleClassHead');
    t.ok(/var lines: Int = 3\b/.test(head) && /PsycleClassName\.balancedHalves\(title\)/.test(head) && /PsycleInlineAccessory\.shortTitle\(facts\.title\)/.test(head),
      'a class name: balanced one-line halves (whole by construction), up to three wrapped lines, and the name\'s head as a card\'s last resort');
    t.ok(!/lineLimit\(2\)/.test(head), '…never a free two-line wrap, the step that ended "PILATES: SCUL…" on every phone size');
    t.ok(/\.accessibilityLabel\(Text\(facts\.title\)\)/.test(head), 'VoiceOver gets the whole name even when the card prints its head');
    const small = between(layouts, 'struct PsycleSmallLayout', 'struct PsycleMediumLayout', 'PsycleSmallLayout');
    const ladder = (small.match(/stack\(facts, timeSize: \d+, showCountdown: (?:true|false), titleLines: \d(?:, shortTitle: true)?\)/g) || []);
    t.eq(ladder.map((s) => s.replace(/^stack\(facts, |\)$/g, '')), [
      'timeSize: 38, showCountdown: true, titleLines: 3',
      'timeSize: 38, showCountdown: false, titleLines: 3',
      'timeSize: 30, showCountdown: false, titleLines: 3',
      'timeSize: 30, showCountdown: false, titleLines: 2, shortTitle: true',
      'timeSize: 30, showCountdown: false, titleLines: 1, shortTitle: true'],
    'the small widget gives up the countdown, then the big digits, and only then shortens the name — the place and the seat stay throughout');
    const medium = between(layouts, 'struct PsycleMediumLayout', '// MARK: - Lock Screen layouts', 'PsycleMediumLayout');
    t.ok(/seatRow\(facts, showWeek: true\)\s*seatRow\(facts, showWeek: false\)/.test(medium) && /PsycleSeatChip\(text: seat, surface: surface\)\s*\.layoutPriority\(1\)/.test(medium),
      'medium: "12 this week" gives way before the seat chip is squeezed ("Beds 12 &…" on a 4.7-inch phone)');
  }
};
