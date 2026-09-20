'use strict';
// The Android home-screen widget ("level 3"), as far as the web layer and the
// bridge go. The widget itself is Java and XML (ios-app/android/), which nothing
// here can compile or draw. What CAN be held is the half that feeds it:
//
//   The Android app registers TWINS of three of the iPhone app's own plugins,
//   under the same names and method shapes — AppGroupPreferences (set / get /
//   remove), WidgetCenter (reloadAllTimelines), PsycleDeepLink ('openURL') — so
//   the bridge's existing, branch-free path drives the widget. No twin of
//   PsycleLiveActivity: there is no Live Activity on Android.
//
//   A. the snapshot: three keys through AppGroupPreferences.set, each a JSON
//      string a reader can parse, ONE reload per pass, nothing else called
//   B. what an entry is: the seven facts, colours OPTIONAL; never a waitlist
//      place, never a class that has started, five at most; nothing personal
//   C. a widget tap: the retained 'openURL' of a cold start, a warm tap, and a
//      HOSTILE url — on Android the id began as an intent extra any app can set
//   D. an Android app WITHOUT the twins (built before them), or with broken
//      ones: nothing is warned, nothing is logged as an error
//   E. sign-out empties the widget; an expired session does not — one rule for
//      both apps, held on both
//   F. the iPhone app: its plugin calls are still IPHONE_LAUNCH_DIGEST, and the
//      widget calls the Android app makes are the iPhone's, name for name
//   G. the seam: what the bridge names, the Android project's plugins are
//      called (read only when ios-app/android/ holds them)
//   H. the colours the widget's JVM tests judge for contrast are js/theme.js's
//      own palette, value for value
//
// The launch is 18-android.js's launchScenario; the fake Capacitor is
// ios-bridge.js's harness. Nothing native, no network. Class times on this path
// are parsed DEVICE-locally on purpose (agents/decisions.md section 4): every
// class below is days away, or a day gone.

const { harness } = require('./ios-bridge.js');
const android = require('./18-android.js');

const KEYS = ['widget_next_class', 'widget_upcoming', 'widget_week'];
const GROUP = 'group.com.psyclefinder.app';
const FACTS = ['eventId', 'startAt', 'instrName', 'typeName', 'studioName', 'locName', 'slots'];
const COLOURS = ['ct', 'ctIntensity', 'ctBase', 'ctTint', 'ctDeep', 'ctWash', 'ctBaseDark', 'ctTintDark', 'ctDeepDark', 'ctWashDark'];
// The Android twin refuses a value above this (the design's bound).
const TWIN_VALUE_MAX = 64 * 1024;

module.exports = async function (t) {
  const { ok, eq } = t;
  const h = harness(t);
  const launch = android.launch;
  const bridgeSrc = t.readSource('ios-app/www/native-bridge.js');

  const names = (b) => b.calls.plugin.map((c) => c[0]);
  const isWidgetCall = (c) => /^(AppGroupPreferences|WidgetCenter|WidgetReloader|PsycleDeepLink|PsycleLiveActivity)\./.test(c[0]);
  const widgetCalls = (b, from) => b.calls.plugin.slice(from || 0).filter(isWidgetCall);
  // 'set:<key>' / 'reload' / the call's own name — one word per widget call.
  const word = (c) => (c[0] === 'AppGroupPreferences.set' ? 'set:' + c[1].key : c[0] === 'WidgetCenter.reloadAllTimelines' ? 'reload' : c[0]);
  const ONE_PASS = ['set:widget_next_class', 'set:widget_upcoming', 'set:widget_week', 'reload'];
  const parsed = (box) => ({ next: JSON.parse(box.values.widget_next_class), upcoming: JSON.parse(box.values.widget_upcoming), week: JSON.parse(box.values.widget_week) });
  const quiet = (b) => [b.calls.warns, b.calls.errors];

  // The app's own classifier and colour engine, as 11-native-snapshot.js builds them.
  const cc = t.loadPure('js/theme.js', 'class-colours');
  const core = t.loadPure('js/app.js', 'core');
  const classType = t.loadPure('js/app.js', 'class-type', { getCategory: core.getCategory });
  const engineFor = (stored) => ({ PALETTE: cc.CLASS_COLOUR_PALETTE, DEFAULTS: cc.CLASS_COLOUR_DEFAULTS, get: () => cc._ccClean(stored) });

  // ════════════════════════════════════════════════════════════════════
  // A. The snapshot reaches the widget's store
  // ════════════════════════════════════════════════════════════════════
  t.section('Android widget: the snapshot goes out through the twins — three keys, then ONE reload');
  {
    const box = {};
    const { b } = await launch(h, 'android', { twins: box });

    const used = Array.from(new Set(names(b).map((n) => n.split('.')[0]))).sort();
    eq(used, ['AppGroupPreferences', 'LocalNotifications', 'Preferences', 'PsycleDeepLink', 'StatusBar', 'WidgetCenter'],
      'one launch touches the Android app\'s plugins and its three twins — and no PsycleLiveActivity: Android has no Live Activity');
    eq(names(b).filter((n) => n === 'PsycleDeepLink.addListener').length, 1, 'the widget-tap listener attaches, once');
    eq(b.calls.plugin.filter((c) => c[0] === 'PsycleDeepLink.addListener')[0][1], 'openURL', '…for the event the iPhone plugin sends: \'openURL\'');

    const words = widgetCalls(b).filter((c) => c[0] !== 'PsycleDeepLink.addListener').map(word);
    ok(words.length >= 4 && words.length % 4 === 0, 'the snapshot was written (' + (words.length / 4) + ' passes in this launch: the bookings landing, then the 4 s launch pass)');
    const passes = [];
    for (let i = 0; i < words.length; i += 4) passes.push(words.slice(i, i + 4));
    eq(passes.filter((p) => JSON.stringify(p) !== JSON.stringify(ONE_PASS)), [], 'every pass is exactly: next class, upcoming, week — then ONE reload, after the writes it is for');
    ok(words.indexOf('AppGroupPreferences.get') === -1 && words.indexOf('AppGroupPreferences.remove') === -1, 'only set() is ever called: nothing is read back, and nothing is removed (an empty widget is a WRITTEN one — section E)');

    const sets = b.calls.plugin.filter((c) => c[0] === 'AppGroupPreferences.set').map((c) => c[1]);
    eq(Array.from(new Set(sets.map((o) => o.group))), [GROUP], 'the `group` argument still goes out, as on the iPhone (the Android twin accepts and ignores it)');
    eq(Array.from(new Set(sets.map((o) => o.key))).sort(), KEYS.slice().sort(), 'the keys are the three widget keys and no other — what the twin may limit itself to');
    ok(KEYS.every((k) => new RegExp("'" + k + "'").test(bridgeSrc)) && new RegExp("var WIDGET_APP_GROUP = '" + GROUP.replace(/\./g, '\\.') + "'").test(bridgeSrc), '…the literals the bridge holds (anchor moved?)');

    ok(box.writes.every((w) => typeof w[1] === 'string'), 'every value is a STRING (the twin stores strings only)');
    ok(box.writes.every((w) => w[1].length < TWIN_VALUE_MAX), 'and far under the twin\'s 64 KB bound (the largest here: ' + Math.max.apply(null, box.writes.map((w) => w[1].length)) + ' characters)');
    let snap = null;
    try { snap = parsed(box); } catch (e) { snap = null; }
    ok(!!snap, 'each of the three parses as JSON');
    eq(KEYS.map((k) => b.calls.prefSet.indexOf(k) !== -1), [true, true, true], 'the Preferences copies are still written beside them, as on the iPhone');
    eq(quiet(b), [[], []], 'nothing is warned or logged as an error in the whole launch');
  }

  // ════════════════════════════════════════════════════════════════════
  // B. What an entry is
  // ════════════════════════════════════════════════════════════════════
  t.section('Android widget: what a reader finds — the seven facts, colours optional, never a waitlist place or a started class');
  {
    const box = {};
    const { b } = await launch(h, 'android', { twins: box });
    const first = parsed(box);
    eq(first.next, { eventId: '501', startAt: '2026-09-20T18:30:00', instrName: 'Ann', typeName: 'RIDE: 45', studioName: 'Studio 1', locName: 'Bank', slots: [12] },
      'the next class: id (a string), a wall clock with a T and NO zone — read in the device\'s zone, the owner\'s closed decision — who, what, room, building, seats');
    eq(Object.keys(first.next), FACTS, 'with no classifier or colour engine on the page there are NO colour fields: `ct…` is optional, and a reader must draw the class without it');
    eq([first.upcoming.length, first.upcoming[0]], [1, first.next], 'widget_upcoming is an array of the same entries, soonest first');
    eq(first.week, [{ day: '2026-09-20', count: 1, firstStart: '2026-09-20T18:30:00' }], 'widget_week: one bucket per day that holds a class');

    // The app's own classifier and colours arrive; more is held.
    b.ctx.classTypeKey = classType.classTypeKey;
    b.ctx.PsycleClassColours = engineFor({ v: 1, intensity: 'bold', map: {} });
    b.ctx._myBookings['502'] = { bookingId: 10, bookingIds: [10, 11], slots: [5, 6] };
    b.ctx._eventCache['502'] = { start_at: '2026-09-21 07:00:00', duration: 45, _typeName: 'BARRE', _instrName: 'Bea Collins', _locName: 'Psycle Shoreditch', _studioName: 'Studio One' };
    b.ctx._myBookings['503'] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 9 } };
    b.ctx._eventCache['503'] = { start_at: '2026-09-19 07:00:00', duration: 45, _typeName: 'YOGA Flow', _instrName: 'Cam Reyes', _locName: 'Psycle Clapham', _studioName: 'Main Room' };
    b.ctx._myBookings['504'] = { bookingId: 12, slots: [3] };
    b.ctx._eventCache['504'] = { start_at: '2026-09-16 18:30:00', duration: 45, _typeName: 'RIDE 45', _instrName: 'Alex Hart', _locName: 'Psycle Oxford Circus', _studioName: 'Ride Studio' };
    b.ctx._myBookings['505'] = { bookingId: 13, bookingIds: [13, 14], slots: [] };
    b.ctx._eventCache['505'] = { start_at: '2026-09-22 12:15:00', duration: 50, _typeName: 'STRENGTH: Full Body', _instrName: 'Dee Okoro', _locName: 'Psycle Clapham', _studioName: 'Main Room' };
    const mark = b.calls.plugin.length;
    b.events.emit('booking:complete');
    await h.flush();
    eq(widgetCalls(b, mark).map(word), ONE_PASS, 'a booking rewrites the three keys and asks for ONE reload');

    const now = parsed(box);
    eq(now.upcoming.map((e) => e.eventId), ['501', '502', '505'], 'soonest first; the waitlist place (503, sooner than all of them) is NOT a seat and is never written; the class that has started (504) is gone');
    eq(now.next, now.upcoming[0], 'the next class is the first of them');
    eq([now.upcoming[1].slots, now.upcoming[2].slots], [[5, 6], []], 'seats are seat NUMBERS: two bikes → [5, 6]; a studio with no layout → [] — the snapshot carries no count of spaces, so a seat badge has nothing to say there (as on the iPhone)');
    eq(now.upcoming.map((e) => e.ct), ['ride', 'barre', 'strength'], 'with the app\'s classifier there, `ct` is the app\'s own class-type key');
    eq(now.upcoming.map((e) => Object.keys(e)), [FACTS.concat(COLOURS), FACTS.concat(COLOURS), FACTS.concat(COLOURS)], 'an entry is the seven facts and the ten colour fields — and nothing about WHO holds it: no name, no email, no customer id, no token');
    ok(now.upcoming.every((e) => COLOURS.filter((k) => k !== 'ct' && k !== 'ctIntensity').every((k) => /^#[0-9A-F]{6}$/.test(e[k]))), 'every colour is a literal #RRGGBB, light and Dark: a widget does no colour maths');
    eq(Array.from(new Set(now.upcoming.map((e) => e.ctIntensity))), ['bold'], 'and the member\'s intensity travels with them');
    eq(now.week.map((d) => [d.day, d.count, d.ct]), [['2026-09-20', 1, 'ride'], ['2026-09-21', 1, 'barre'], ['2026-09-22', 1, 'strength']], 'the week buckets wear the type of the class that opens the day');

    // Intensity "off": the neutral surface is what is SENT as the tint.
    b.ctx.PsycleClassColours = engineFor({ v: 1, intensity: 'off', map: {} });
    b.events.emit('classcolours:changed');
    await b.clock.advance(300);
    const off = parsed(box).next;
    eq([off.ctIntensity, off.ctTint, off.ctTintDark], ['off', '#FCFDFE', '#1B2130'], 'Class colours "off" → ctTint is the NEUTRAL surface, light and dark, while ctBase / ctDeep / ctWash still carry the class colour for the pictogram tile');
    ok(off.ctBase === now.next.ctBase && off.ctWash === now.next.ctWash, '…the class colour itself unchanged');

    // Five at most, however many are held.
    for (let i = 0; i < 8; i++) {
      b.ctx._myBookings[String(600 + i)] = { bookingId: 100 + i, slots: [i + 1] };
      b.ctx._eventCache[String(600 + i)] = { start_at: '2026-09-2' + (3 + (i % 5)) + ' 0' + (6 + (i % 3)) + ':30:00', duration: 45, _typeName: 'RIDE 45', _instrName: 'Eli Novak', _locName: 'Psycle Shoreditch', _studioName: 'Studio One' };
    }
    b.events.emit('booking:complete');
    await h.flush();
    const many = parsed(box);
    eq(many.upcoming.length, 5, 'eleven classes held → widget_upcoming keeps the next FIVE (every one of them still gets its reminder)');
    ok(box.writes.every((w) => w[1].length < TWIN_VALUE_MAX), 'and the values stay far under 64 KB (' + Math.max.apply(null, box.writes.map((w) => w[1].length)) + ' characters at most)');
    eq(quiet(b), [[], []], 'none of it warned about');
  }

  // ════════════════════════════════════════════════════════════════════
  // C. A widget tap
  // ════════════════════════════════════════════════════════════════════
  t.section('Android widget: a tap lands as on the iPhone — My Bookings, then that class');
  {
    // Cold start: the tap started the app, so the twin RETAINED the event until
    // the bridge's listener attached.
    const box = { retained: 'psync://bookings?event=501' };
    const { b } = await launch(h, 'android', { twins: box });
    eq([b.calls.switchTab, b.calls.opened], [['bookings'], ['501']], 'cold start: My Bookings at once, and that class\'s sheet as soon as /bookings shows the seat');
    ok(box.retained === null, 'the retained event was consumed once');

    box.listeners.openURL({ url: 'psync://bookings?event=501' });
    eq([b.calls.switchTab, b.calls.opened], [['bookings', 'bookings'], ['501', '501']], 'a warm tap: My Bookings and the sheet, at once');
    box.listeners.openURL({ url: 'psync://bookings' });
    eq([b.calls.switchTab.length, b.calls.opened.length], [3, 2], 'a tap on the EMPTY widget (no id): My Bookings alone — not the Monday reminder\'s route');
    eq(quiet(b), [[], []], 'nothing warned');
  }
  t.section('Android widget: a HOSTILE tap — the id began as an intent extra any app can set');
  {
    const box = {};
    const { b } = await launch(h, 'android', { twins: box });
    b.ctx._myBookings['777'] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 4 } };
    b.ctx._eventCache['777'] = { start_at: '2026-09-23 07:00:00', duration: 45 };
    b.ctx._eventCache['888'] = { start_at: '2026-09-23 08:00:00', duration: 45 }; // cached (it was on Discover), NOT held
    const scheduledBefore = b.calls.scheduled.length;
    const tap = (url) => {
      const before = [b.calls.switchTab.length, b.calls.opened.length];
      box.listeners.openURL(url === undefined ? undefined : { url: url });
      return [b.calls.switchTab.slice(before[0]), b.calls.opened.slice(before[1])];
    };

    const toBookingsOnly = ['psync://bookings?event=abc', 'psync://bookings?event=__proto__', 'psync://bookings?event=constructor', 'psync://bookings?event=501;x', 'psync://bookings?event=501%20',
      'psync://bookings?event=-1', 'psync://bookings?event=5e2', 'psync://bookings?event=0x1f5', "psync://bookings?event=1');alert(1);//", 'psync://bookings?event=%E0%A4%A', 'psync://bookings?event=abc&event=501'];
    eq(toBookingsOnly.map((u) => tap(u)).filter((r) => JSON.stringify(r) !== '[["bookings"],[]]'), [], 'an id that is not all digits → My Bookings ONLY, and no sheet is asked for: ' + toBookingsOnly.length + ' shapes');
    eq(tap('psync://bookings?event=' + '9'.repeat(5000)), [['bookings'], []], 'five thousand digits → My Bookings, no sheet, no throw (the native side passes on twelve at most; the page does not rely on it)');
    eq([tap('psync://bookings?event=888'), tap('psync://bookings?event=777')], [[['bookings'], []], [['bookings'], []]], 'digits for a class NOT held, or held only as a waitlist place → My Bookings, never a sheet: a tap can open the sheet of a held class and no other');

    const nowhere = ['https://evil.example/?event=501', 'psync://bookings.evil.example?event=501', 'psync://bookings/../discover?event=501', 'psync://discover?event=501', 'intent://bookings?event=501#Intent;end', 'javascript:alert(1)', '', null, 42, {}];
    eq(nowhere.map((u) => tap(u)).concat([tap(undefined)]).filter((r) => JSON.stringify(r) !== '[[],[]]'), [], 'anything but the one shape that is ever minted does NOTHING at all — no tab change, no sheet: ' + (nowhere.length + 1) + ' shapes');

    eq(tap('psync://bookings?event=501'), [['bookings'], ['501']], 'and after all that a real tap still works');
    eq(quiet(b), [[], []], 'none of it is warned about or logged as an error');
    eq(b.calls.scheduled.length, scheduledBefore, 'and none of it scheduled a notification: a widget tap has no SNOOZE to forge (what a forged NOTIFICATION tap is refused is 18-android.js\'s)');
  }

  // ════════════════════════════════════════════════════════════════════
  // D. No twins, or broken ones
  // ════════════════════════════════════════════════════════════════════
  t.section('Android widget: an app built before the twins — skipped without a word, sign-out included');
  {
    const world = { token: 'tok', ctx: null };
    const globals = { getBearerToken: () => world.token, clearToken() { world.token = ''; world.ctx._myBookings = {}; } };
    const { b } = await launch(h, 'android', { globals: globals });
    world.ctx = b.ctx;
    eq(widgetCalls(b), [], 'no twin, no call: not AppGroupPreferences, not WidgetCenter, not PsycleDeepLink, not PsycleLiveActivity');
    eq(KEYS.map((k) => typeof b.native[k]), ['string', 'string', 'string'], 'the pass still ran to its end (its Preferences copies are there; it is also what arms the class reminders)');
    b.ctx.clearToken();
    await h.flush();
    eq([b.native.widget_next_class, b.native.widget_upcoming, b.native.widget_week], ['null', '[]', '[]'], 'a sign-out there blanks what it can reach');
    eq([widgetCalls(b), quiet(b)], [[], [[], []]], '…and still says nothing: no warning, no error, at launch, in a pass or at sign-out');
  }
  {
    // Twins that misbehave: a set() that rejects (a value over the bound), one
    // that throws, one that answers no promise; no WidgetCenter at all.
    const broken = [
      ['rejects', { AppGroupPreferences: { set: () => Promise.reject(new Error('value too large')) }, WidgetCenter: { reloadAllTimelines: () => Promise.reject(new Error('no provider')) } }],
      ['throws', { AppGroupPreferences: { set() { throw new Error('boom'); } }, WidgetCenter: { reloadAllTimelines() { throw new Error('boom'); } } }],
      ['answers no promise', { AppGroupPreferences: { set() {} }, WidgetCenter: { reloadAllTimelines() {} }, PsycleDeepLink: {} }],
      ['is half there', { AppGroupPreferences: {}, PsycleDeepLink: { addListener() { throw new Error('boom'); } } }],
    ];
    for (const [how, plugins] of broken) {
      const b = h.boot({ platform: 'android', perm: 'granted', plugins: plugins });
      b.ctx._myBookings['501'] = { bookingId: 9, slots: [12] };
      b.ctx._eventCache['501'] = { start_at: '2026-09-20 18:30:00', duration: 45, _typeName: 'RIDE: 45', _instrName: 'Ann', _locName: 'Bank' };
      await h.flush();
      b.events.emit('bookings:loaded', b.ctx._myBookings);
      await b.clock.advance(5000);
      eq([how, b.calls.scheduled.length >= 1, quiet(b)], [how, true, [[], []]], 'a twin that ' + how + ': the pass still finishes (the class reminder is armed) and nothing is logged');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // E. Sign-out, and an expired session
  // ════════════════════════════════════════════════════════════════════
  // The rule is the iPhone's and is not re-decided here (native-bridge.js, the
  // clearToken wrapper; agents/architecture/session-and-accounts.md): a
  // DELIBERATE sign-out blanks the snapshot; a 401 keeps it — the classes are
  // still held, and the same member nearly always comes back.
  const signOutStory = async (platform) => {
    const box = {};
    const world = { token: 'tok', ctx: null };
    const b = h.boot({
      platform: platform,
      perm: 'granted',
      removeDelivered: true,
      // js/app.js's clearToken drops the token and empties _myBookings at the
      // source, synchronously (fetchMyBookings' no-token branch), emitting nothing.
      globals: { getBearerToken: () => world.token, clearToken() { world.token = ''; world.ctx._myBookings = {}; } },
      plugins: (rec) => Object.assign(android.androidTwins(rec, box), platform === 'android' ? {} : { PsycleLiveActivity: { refresh() { rec('PsycleLiveActivity.refresh'); return Promise.resolve(); } } }),
    });
    world.ctx = b.ctx;
    const held = () => {
      b.ctx._myBookings = { 501: { bookingId: 9, slots: [12] } };
      b.ctx._eventCache['501'] = { start_at: '2026-09-20 18:30:00', duration: 45, _typeName: 'RIDE: 45', _instrName: 'Ann', _locName: 'Bank', _studioName: 'Studio 1' };
    };
    const story = {};
    const step = async (name, fn) => {
      const from = box.writes.length, mark = b.calls.plugin.length;
      await fn();
      await h.flush();
      story[name] = { writes: box.writes.slice(from), calls: widgetCalls(b, mark).map(word).filter((w) => w !== 'PsycleLiveActivity.refresh'), next: box.values.widget_next_class };
    };

    await h.flush();
    await step('signed in, a class held', async () => { held(); b.events.emit('bookings:loaded', b.ctx._myBookings); });
    // 401: showSessionExpired clears the token and KEEPS _myBookings.
    await step('the session expires', async () => { world.token = ''; b.ctx.updateWidgetSnapshot(); });
    // …then some refetch runs fetchMyBookings' no-token branch, which empties the map.
    await step('then a refetch empties the map', async () => { b.ctx._myBookings = {}; b.ctx.updateWidgetSnapshot(); });
    await step('the same member signs back in', async () => { world.token = 'tok2'; held(); b.events.emit('bookings:loaded', b.ctx._myBookings); });
    await step('a deliberate sign-out', async () => { b.ctx.clearToken(); });
    await step('the app comes to the foreground, signed out', async () => { b.ctx.updateWidgetSnapshot(); });
    await step('another member signs in and holds nothing', async () => { world.token = 'tok3'; b.events.emit('bookings:loaded', b.ctx._myBookings); });
    return { b: b, box: box, story: story };
  };

  t.section('Android widget: a deliberate sign-out empties it; an expired session does not');
  {
    const { b, box, story } = await signOutStory('android');
    const idOf = (json) => { const v = JSON.parse(json); return v && v.eventId; };

    eq([story['signed in, a class held'].calls, idOf(story['signed in, a class held'].next)], [ONE_PASS, '501'], 'signed in: the class is on the widget');
    eq([story['the session expires'].calls, idOf(story['the session expires'].next)], [ONE_PASS, '501'], 'a 401 keeps the bookings, so a pass after it writes the SAME class: the widget keeps serving what is still held');
    eq([story['then a refetch empties the map'].writes, story['then a refetch empties the map'].calls, idOf(story['then a refetch empties the map'].next)], [[], [], '501'],
      '…and when a refetch then empties the map (no token, no sign-out) NOTHING is written and no reload is asked for: an expired session never blanks the widget');
    eq([story['the same member signs back in'].calls, idOf(story['the same member signs back in'].next)], [ONE_PASS, '501'], 'signing back in rewrites it from the server\'s answer');

    eq(story['a deliberate sign-out'].writes, [['widget_next_class', 'null'], ['widget_upcoming', '[]'], ['widget_week', '[]']],
      'a deliberate sign-out WRITES the empty snapshot — \'null\', \'[]\', \'[]\' — at once, in the same tick as clearToken');
    eq(story['a deliberate sign-out'].calls, ONE_PASS, '…through set(), never remove(), followed by ONE reload: the widget repaints empty without waiting for its next update');
    ok(names(b).indexOf('AppGroupPreferences.remove') === -1, '…so a reader must take \'null\' and \'[]\' as "nothing booked" (a key is never removed)');
    ok(KEYS.every((k) => !/501|Ann|Bank|RIDE/.test(box.values[k])), 'nothing of the member who left is still in the store');
    ok(b.calls.cancelled.length >= 1, 'and their armed class reminder is cancelled with it, as on the iPhone');
    eq([story['the app comes to the foreground, signed out'].writes, box.values.widget_next_class], [[], 'null'], 'signed out, later passes write nothing more: it stays empty');
    eq([story['another member signs in and holds nothing'].calls, box.values.widget_next_class], [ONE_PASS, 'null'], 'the next member\'s confirmed-empty list is written as empty too ("Nothing booked" is an honest state, not a missing one)');
    eq(quiet(b), [[], []], 'none of it is warned about');

    const ios = await signOutStory('ios');
    eq(Object.keys(ios.story), Object.keys(story), 'the iPhone app, walked through the same steps…');
    eq(Object.keys(story).filter((k) => JSON.stringify([story[k].writes, story[k].calls]) !== JSON.stringify([ios.story[k].writes, ios.story[k].calls])), [],
      '…writes and asks for the same, step for step — the same values, in the same order: ONE rule, reached through the twins (a step named here differs)');
  }
  {
    ok(/window\.clearToken = function \(\) \{\s*var result = _origClearTokenNative\.apply\(this, arguments\);\s*_snapServerConfirmed = true;[^\n]*\s*_signOutPass = true;[^\n]*\s*try \{ updateWidgetSnapshot\(\); \} catch \(e\) \{\} finally \{ _signOutPass = false; \}/.test(bridgeSrc),
      'the bridge: clearToken\'s wrapper is the ONE pass allowed to write an empty, tokenless snapshot (anchor moved?)');
    ok(!/showSessionExpired/.test(bridgeSrc.replace(/\/\/.*$/gm, '')), '…and session expiry is not wrapped at all');
  }

  // ════════════════════════════════════════════════════════════════════
  // F. The iPhone app
  // ════════════════════════════════════════════════════════════════════
  t.section('Android widget: the iPhone app is untouched, and the Android app makes the iPhone\'s widget calls');
  {
    const ios = await launch(h, 'ios');
    const d = android.iphoneLaunchDigest(ios.lines);
    eq(d.got, d.want, 'as \'ios\' the recorded plugin calls of one launch are still IPHONE_LAUNCH_DIGEST, to the byte');

    const droid = await launch(h, 'android', { twins: {} });
    const shared = (b) => widgetCalls(b).filter((c) => c[0] !== 'PsycleLiveActivity.refresh');
    eq(shared(droid.b), shared(ios.b), 'the Android app\'s calls on the three shared names are the iPhone\'s — same methods, same arguments, same order');
    ok(names(ios.b).indexOf('PsycleLiveActivity.refresh') !== -1 && names(droid.b).indexOf('PsycleLiveActivity.refresh') === -1, 'the Live Activity refresh is the iPhone\'s alone');

    // No branch of its own: the widget path never asks which platform it is on.
    const cut = (from, to) => {
      const a = bridgeSrc.indexOf(from), z = bridgeSrc.indexOf(to, a);
      if (a === -1 || z === -1) throw new Error('20-android-widget suite: cannot find "' + from + '" … "' + to + '" (anchor moved?)');
      return bridgeSrc.slice(a, z).replace(/\/\/.*$/gm, '');
    };
    const path = [cut('  // ── pure:widget-link:start', '  // ── Widget / Live Activity / Siri Snapshot'), cut('  function _prefSet(', '  // ── pure:ios-polish:start'), cut('  function updateWidgetSnapshot() {', '  window.updateWidgetSnapshot = updateWidgetSnapshot;')].join('\n');
    ok(!/IS_ANDROID|PLATFORM\b|getPlatform/.test(path), 'the tap listener, the two writers and updateWidgetSnapshot hold no platform test: the twins are found by NAME, as the Swift plugins are');
    eq(['AppGroupPreferences', 'WidgetCenter', 'PsycleDeepLink', 'PsycleLiveActivity'].map((n) => new RegExp('Capacitor\\.Plugins\\.' + n + '\\b').test(path)), [true, true, true, true], '…by existence, each of the four');
  }

  // ════════════════════════════════════════════════════════════════════
  // G. The seam with the Android project
  // ════════════════════════════════════════════════════════════════════
  t.section('Android widget: the names the bridge reaches for are the names the Android project registers');
  {
    const javaRoot = t.path.join(t.REPO_ROOT, 'ios-app', 'android', 'app', 'src', 'main', 'java');
    const javaFiles = [];
    const walk = (dir) => {
      let entries = [];
      try { entries = t.fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      entries.forEach((e) => { const p = t.path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.java$/.test(e.name)) javaFiles.push(p); });
    };
    walk(javaRoot);
    ok(javaFiles.length >= 1, 'the Android project\'s Java was found (' + javaFiles.length + ' file' + (javaFiles.length === 1 ? '' : 's') + ')');
    // A Capacitor plugin's JS name: @CapacitorPlugin(name = "…"), else the class's own name.
    const plugins = {};
    javaFiles.forEach((file) => {
      const src = t.fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const re = /@CapacitorPlugin\b([\s\S]*?)\bclass\s+(\w+)/g;
      let m;
      while ((m = re.exec(src))) {
        const named = /name\s*=\s*"([^"]+)"/.exec(m[1] || '');
        plugins[named ? named[1] : m[2]] = src;
      }
    });
    const found = Object.keys(plugins).sort();
    if (!found.length) {
      ok(true, 'no @CapacitorPlugin class in ios-app/android/ yet: the seam is held from the commit that adds the twins (until then the bridge\'s path is the quiet one of section D)');
    } else {
      eq(found, ['AppGroupPreferences', 'PsycleDeepLink', 'WidgetCenter'], 'the Android app registers exactly the three twins, under the iPhone plugins\' names — a name that differs by a letter is a widget that silently never updates — and no PsycleLiveActivity');
      const methods = (src) => { const out = []; const re = /@PluginMethod\b[^\n]*\s*public\s+void\s+(\w+)\s*\(/g; let m; while ((m = re.exec(src))) out.push(m[1]); return out.sort(); };
      eq(methods(plugins.AppGroupPreferences), ['get', 'remove', 'set'], 'AppGroupPreferences: set, get, remove — the Swift plugin\'s shape');
      ok(methods(plugins.WidgetCenter).indexOf('reloadAllTimelines') !== -1, 'WidgetCenter: reloadAllTimelines');
      ok(/"openURL"/.test(plugins.PsycleDeepLink), 'PsycleDeepLink: the event is \'openURL\', the one the bridge listens for');
      const all = javaFiles.map((f) => t.fs.readFileSync(f, 'utf8')).join('\n');
      ok(/psync:\/\/bookings/.test(all), 'and the url it builds is the shape _parseWidgetLink reads: psync://bookings?event=<id>');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // H. The palette the JVM tests judge
  // ════════════════════════════════════════════════════════════════════
  // The widget paints with literal colours the bridge copies out of js/theme.js, and PsyncSnapshotTest holds
  // every swatch, at every intensity, by day and by night, to a contrast floor — over a COPY of the palette (a
  // JVM test cannot read JavaScript). This is what makes the copy worth having: a swatch changed or added in
  // js/theme.js fails HERE until the Java table follows, and a colour that does not read then fails THERE.
  t.section('Android widget: the palette its JVM tests judge for contrast is js/theme.js\'s, value for value');
  {
    const rel = 'ios-app/android/app/src/test/java/com/psyclefinder/app/widget/PsyncSnapshotTest.java';
    const file = t.path.join(t.REPO_ROOT, rel);
    if (!t.fs.existsSync(file)) {
      ok(true, 'no ' + rel + ' yet: held from the commit that adds the widget\'s JVM tests');
    } else {
      const block = (/\/\/ palette:start\n([\s\S]*?)\/\/ palette:end/.exec(t.readSource(rel)) || [])[1] || '';
      const rows = (block.match(/^\s*\{[^{}]*\},?\s*$/gm) || []).map((line) => (line.match(/"([^"]*)"/g) || []).map((q) => q.slice(1, -1)));
      const PALETTE = cc.CLASS_COLOUR_PALETTE;
      const side = (s) => [s.tintSoft, s.tintBold, s.base, s.deep];
      ok(rows.length >= 8, 'the Java test\'s PALETTE table was found between its palette:start / palette:end markers (' + rows.length + ' rows)');
      eq(rows, Object.keys(PALETTE).map((name) => [name].concat(side(PALETTE[name].light), side(PALETTE[name].dark))),
        'every swatch of CLASS_COLOUR_PALETTE, in its order: name, then tintSoft, tintBold, base and deep for light and for dark — the four roles _snapClassColourFields writes as ctTint / ctWash / ctBase / ctDeep');
      eq(rows.reduce((bad, r) => bad.concat(r.slice(1).filter((v) => !/^#[0-9A-F]{6}$/.test(v))), []), [], '…each a literal #RRGGBB, the only form the widget reads');
      ok(/ground\(swatch, intensity, night\)/.test(t.readSource(rel)) && /"#FCFDFE"/.test(t.readSource(rel)) && /"#1B2130"/.test(t.readSource(rel)) &&
        /SNAPSHOT_NEUTRAL_TINT\s*=\s*\{\s*light:\s*'#FCFDFE',\s*dark:\s*'#1B2130'\s*\}/.test(bridgeSrc),
        '…and the neutral ground the test gives "off" is the bridge\'s SNAPSHOT_NEUTRAL_TINT, light and dark');
    }
  }
};
