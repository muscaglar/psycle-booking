'use strict';
// The Android class countdown, as far as the bridge goes.
//
// The iPhone app shows a Live Activity for the next held class. Android has no
// such thing: what stands in for it is ONE silent, ongoing notification with a
// countdown, from 90 minutes before the class until it starts — planned and
// posted NATIVELY (ios-app/android/, its own JVM tests and the CI emulator),
// from the widget snapshot the twins already store. Nothing here can compile,
// post or see that notification. What CAN be held is the one thing the native
// side cannot read for itself — the member's switch:
//
//   the countdown follows Class reminders (localStorage psycle_class_reminders
//   !== 'off'), so on ANDROID ONLY the bridge hands it over as one more key
//   through the AppGroupPreferences twin: 'countdown_enabled', '1' | '0'.
//
//   A. every snapshot pass carries it: '1' by default, after the pass's three
//      keys and BEFORE its ONE reload (the native side plans on the reload),
//      once per pass, and nowhere else — no Preferences copy, no new plugin
//   B. '0' when Class reminders are off; the member's word alone decides it —
//      never the notification permission, which the native side judges, and
//      which nothing here asks for
//   C. flipping the switch re-writes it at once: a pass carries it when one
//      runs to its end; otherwise it goes out by itself with a reload of its
//      own (nothing held yet, an expired session — whose kept snapshot may be
//      counting down — and turning reminders off, which runs no pass)
//   D. an app built before the key, or before the twins, or with broken ones:
//      nothing is warned, nothing is logged
//   E. the iPhone app: the key is NEVER written, its launch is still
//      IPHONE_LAUNCH_DIGEST, and its copy is what it was, to the letter
//   F. the seam: the bridge's literal and its two values against the Android
//      project's allow-list (the pure PsyncSnapshot), and the shape of the path
//
// The launch is 18-android.js's launchScenario; the fake Capacitor is
// ios-bridge.js's harness; the twins are 18-android.js's. Nothing native, no
// network. Class times on this path are device-local on purpose
// (agents/decisions.md section 4): every class below is days away.

const { harness } = require('./ios-bridge.js');
const android = require('./18-android.js');

const KEY = 'countdown_enabled';
const GROUP = 'group.com.psyclefinder.app';
const WIDGET_KEYS = ['widget_next_class', 'widget_upcoming', 'widget_week'];

module.exports = async function (t) {
  const { ok, eq } = t;
  const h = harness(t);
  const bridgeSrc = t.readSource('ios-app/www/native-bridge.js');

  const isWidgetCall = (c) => /^(AppGroupPreferences|WidgetCenter|WidgetReloader|PsycleDeepLink|PsycleLiveActivity)\./.test(c[0]);
  const word = (c) => (c[0] === 'AppGroupPreferences.set' ? 'set:' + c[1].key : c[0] === 'WidgetCenter.reloadAllTimelines' ? 'reload' : c[0]);
  // The widget-side calls since `from`, one word each; the tap listener is 20-android-widget.js's.
  const words = (b, from) => b.calls.plugin.slice(from || 0).filter(isWidgetCall).filter((c) => c[0] !== 'PsycleDeepLink.addListener').map(word);
  const IPHONE_PASS = ['set:widget_next_class', 'set:widget_upcoming', 'set:widget_week', 'reload'];
  const ANDROID_PASS = ['set:widget_next_class', 'set:widget_upcoming', 'set:widget_week', 'set:' + KEY, 'reload'];
  const FLIP = ['set:' + KEY, 'reload'];
  const switchWrites = (box, from) => box.writes.slice(from || 0).filter((w) => w[0] === KEY).map((w) => w[1]);
  const quiet = (b) => [b.calls.warns, b.calls.errors];
  const passesOf = (list, size) => { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };

  // An Android app WITH its twins, booted plainly (launchScenario fixes its own
  // localStorage, and sections B and C need theirs). `world.token` is what
  // getBearerToken answers; clearToken is js/app.js's, as 20-android-widget.js
  // fakes it.
  const bootAndroid = (opts) => {
    opts = opts || {};
    const box = {};
    const world = { token: 'tok', ctx: null };
    const b = h.boot({
      platform: opts.platform || 'android',
      perm: opts.perm || 'granted',
      deny: opts.deny,
      removeDelivered: true,
      local: opts.local,
      globals: { getBearerToken: () => world.token, clearToken() { world.token = ''; world.ctx._myBookings = {}; } },
      plugins: opts.plugins || ((rec) => android.androidTwins(rec, box)),
    });
    world.ctx = b.ctx;
    return { b: b, box: box, world: world };
  };
  const hold = (b) => {
    b.ctx._myBookings = { 501: { bookingId: 9, slots: [12] } };
    b.ctx._eventCache['501'] = { start_at: '2026-09-20 18:30:00', duration: 45, _typeName: 'RIDE: 45', _instrName: 'Ann', _locName: 'Bank', _studioName: 'Studio 1' };
  };
  const landed = async (b) => { hold(b); await h.flush(); b.events.emit('bookings:loaded', b.ctx._myBookings); await h.flush(); };

  // ════════════════════════════════════════════════════════════════════
  // A. Every pass carries the switch
  // ════════════════════════════════════════════════════════════════════
  t.section('Android countdown: every snapshot pass hands over the switch — \'1\' by default, before the ONE reload, once per pass');
  {
    const box = {};
    const { b } = await android.launch(h, 'android', { twins: box });
    const all = words(b);
    const passes = passesOf(all, ANDROID_PASS.length);
    ok(passes.length >= 2, 'the launch ran ' + passes.length + ' passes (the bookings landing, then the 4 s launch pass)');
    eq(passes.filter((p) => JSON.stringify(p) !== JSON.stringify(ANDROID_PASS)), [], 'each is exactly: next class, upcoming, week, THEN the switch, THEN the reload — the native side plans on the reload, so the switch must be stored by then');
    eq([all.filter((w) => w === 'set:' + KEY).length, all.filter((w) => w === 'reload').length], [passes.length, passes.length], 'once per pass: as many switch writes as reloads, and no reload of the countdown\'s own');
    eq(switchWrites(box), passes.map(() => '1'), 'Class reminders default ON, so the switch says \'1\' — a STRING, the only kind the twin stores');

    const sets = b.calls.plugin.filter((c) => c[0] === 'AppGroupPreferences.set' && c[1].key === KEY).map((c) => c[1]);
    eq(Array.from(new Set(sets.map((o) => o.group))), [GROUP], 'through the same call as the snapshot: set({ group, key, value }), the group going out as ever');
    eq([b.calls.prefSet.indexOf(KEY), Object.prototype.hasOwnProperty.call(b.native, KEY), b.ls.getItem(KEY)], [-1, false, null],
      'and through NOTHING else: no Preferences copy (nothing would read it), no localStorage key — the member\'s switch stays psycle_class_reminders');
    ok(b.calls.plugin.every((c) => c[0] !== 'AppGroupPreferences.get' && c[0] !== 'AppGroupPreferences.remove'), 'still only set(): nothing is read back, nothing removed');
    eq(b.calls.plugin.map((c) => c[0]).filter((n) => /Countdown|LiveActivity/i.test(n)), [], 'no plugin of the countdown\'s own, and never PsycleLiveActivity: the twins are all it needs');
    eq(quiet(b), [[], []], 'nothing is warned or logged as an error in the whole launch');

    // Whatever starts a pass, the pass is the same.
    let mark = b.calls.plugin.length;
    b.ctx._myBookings['502'] = { bookingId: 10, slots: [3] };
    b.ctx._eventCache['502'] = { start_at: '2026-09-21 07:00:00', duration: 45, _typeName: 'BARRE', _instrName: 'Bo', _locName: 'Mortimer St' };
    b.events.emit('booking:complete');
    await h.flush();
    eq(words(b, mark), ANDROID_PASS, 'a booking: one pass, the switch in it');
    mark = b.calls.plugin.length;
    delete b.ctx._myBookings['502'];
    b.events.emit('booking:cancelled');
    await h.flush();
    eq(words(b, mark), ANDROID_PASS, 'a cancel: the same');
    mark = b.calls.plugin.length;
    b.ctx.updateWidgetSnapshot();
    await h.flush();
    eq(words(b, mark), ANDROID_PASS, 'the app coming back to the foreground (the same function): the same');
  }

  // ════════════════════════════════════════════════════════════════════
  // B. What the switch says
  // ════════════════════════════════════════════════════════════════════
  t.section('Android countdown: \'0\' when Class reminders are off — the member\'s word alone, never the permission');
  {
    const says = async (opts) => {
      const { b, box } = bootAndroid(opts);
      await landed(b);
      await b.clock.advance(5000);
      return { b: b, said: Array.from(new Set(switchWrites(box))), passes: passesOf(words(b), ANDROID_PASS.length) };
    };
    const off = await says({ local: { psycle_class_reminders: 'off' } });
    eq([off.said, off.passes.filter((p) => JSON.stringify(p) !== JSON.stringify(ANDROID_PASS))], [['0'], []], 'Class reminders off → every pass says \'0\', in the same place: before the reload');
    eq(off.b.calls.scheduled, [], '…and, as ever, no class reminder is armed: ONE switch for both');
    eq([(await says({ local: { psycle_class_reminders: 'on' } })).said, (await says({})).said, (await says({ local: { psycle_class_reminders: 'banana' } })).said], [['1'], ['1'], ['1']],
      '\'on\', never set, or anything that is not \'off\' → \'1\': exactly _classRemindersEnabled(), so the countdown and the reminders can never disagree');

    const denied = await says({ perm: 'denied' });
    const unasked = await says({ perm: 'prompt' });
    eq([denied.said, unasked.said], [['1'], ['1']], 'notifications refused, or never asked for → still \'1\': whether Psync may post is judged natively, silently, at each plan');
    eq([denied.b.calls.requested, unasked.b.calls.requested, unasked.b.calls.modals.length], [0, 0, 0], '…and the countdown never asks: no system prompt, no dialog — the in-context ask after a booking stays the only one');
    eq([quiet(off.b), quiet(denied.b), quiet(unasked.b)], [[[], []], [[], []], [[], []]], 'none of it warned about');
  }

  // ════════════════════════════════════════════════════════════════════
  // C. Flipping the switch
  // ════════════════════════════════════════════════════════════════════
  t.section('Android countdown: flipping Class reminders re-writes the switch at once — it does not wait for a booking change');
  {
    const { b, box } = bootAndroid();
    await landed(b);
    await b.clock.advance(5000);
    eq(switchWrites(box).slice(-1), ['1'], 'a class held, reminders on: the switch says \'1\'');

    let mark = b.calls.plugin.length, from = box.writes.length;
    await b.ctx._nativeClassReminders.disable();
    await h.flush();
    eq([words(b, mark), box.writes.slice(from)], [FLIP, [[KEY, '0']]], 'turned OFF (no pass runs there): the switch goes out by itself — \'0\', then a reload of its own, so the native side plans now and takes the countdown down');
    eq([b.ls.getItem('psycle_class_reminders'), b.calls.cancelled.length >= 1], ['off', true], '…after the preference is stored, and with the armed class reminder cancelled as before');
    ok(/"eventId":"501"/.test(box.values.widget_next_class) && /"eventId":"501"/.test(box.values.widget_upcoming), '…the snapshot itself untouched: the widget keeps its class');

    mark = b.calls.plugin.length; from = box.writes.length;
    const armed = await b.ctx._nativeClassReminders.enable();
    await h.flush();
    eq([armed, words(b, mark), switchWrites(box, from)], [true, ANDROID_PASS, ['1']], 'turned ON: enable() runs a pass, and the pass carries the switch — ONE write, ONE reload, not a second of each');

    // The Settings row's own toggle (js/tabs.js), over the real bridge API.
    const tabsSrc = t.readSource('js/tabs.js');
    const cutFrom = tabsSrc.indexOf('  var _classReminderGranted = null;'), cutTo = tabsSrc.indexOf('  function _formatGbp(');
    ok(cutFrom !== -1 && cutTo > cutFrom, 'the reminder rows found in js/tabs.js (anchor moved?)');
    const toasts = [];
    const page = { toast: (m, k) => toasts.push([m, k]), document: { getElementById: () => null, addEventListener() {}, visibilityState: 'visible' },
      Capacitor: { getPlatform: () => 'android' }, _nativeReminder: null, _nativeClassReminders: b.ctx._nativeClassReminders };
    page.window = page;
    t.vm.createContext(page);
    t.vm.runInContext(tabsSrc.slice(cutFrom, cutTo), page, { filename: 'js/tabs.js[reminder rows]' });
    mark = b.calls.plugin.length;
    await page._toggleClassReminders();
    await h.flush();
    eq([words(b, mark), switchWrites(box).slice(-1), toasts.slice(-1)], [FLIP, ['0'], [['Class reminders off', 'info']]], 'the switch in Settings, tapped while on: \'0\' goes out with the toast');
    mark = b.calls.plugin.length;
    await page._toggleClassReminders();
    await h.flush();
    eq([words(b, mark), switchWrites(box).slice(-1)], [ANDROID_PASS, ['1']], '…tapped again: a pass, \'1\'');
    eq(quiet(b), [[], []], 'none of it warned about');
  }
  {
    // A pass that ends early writes nothing — so the flip must not lean on it.
    const early = bootAndroid();
    await h.flush();
    let mark = early.b.calls.plugin.length;
    eq(await early.b.ctx._nativeClassReminders.enable(), true, 'nothing held and the server not heard yet (a cold start): enable() still answers true');
    await h.flush();
    eq([words(early.b, mark), switchWrites(early.box)], [FLIP, ['1']], '…its pass wrote nothing (an unconfirmed empty list never blanks the widget), so the switch went out by itself, once');
    ok(WIDGET_KEYS.every((k) => !Object.prototype.hasOwnProperty.call(early.box.values, k)), '…and the three widget keys were NOT written: the guard that keeps a stale-but-true snapshot stands');

    // An expired session keeps the snapshot (the iPhone's rule), so a countdown
    // may be up with nobody signed in — and the switch must still reach it.
    const { b, box, world } = bootAndroid();
    await landed(b);
    world.token = '';
    b.ctx._myBookings = {};
    mark = b.calls.plugin.length;
    await b.ctx._nativeClassReminders.disable();
    await b.ctx._nativeClassReminders.enable();
    await h.flush();
    eq([words(b, mark), switchWrites(box).slice(-2)], [FLIP.concat(FLIP), ['0', '1']], 'session expired, the map emptied by a refetch: off, then on — each flip reaches the native side, though no pass may write');
    ok(/"eventId":"501"/.test(box.values.widget_next_class), '…and the kept snapshot still names the class: expiry blanks nothing');

    // A deliberate sign-out is a pass like any other: the EMPTY snapshot is what
    // ends a countdown, and the switch says what the member last chose.
    world.token = 'tok2';
    await landed(b);
    mark = b.calls.plugin.length;
    const from = box.writes.length;
    b.ctx.clearToken();
    await h.flush();
    eq([words(b, mark), box.writes.slice(from)], [ANDROID_PASS, [['widget_next_class', 'null'], ['widget_upcoming', '[]'], ['widget_week', '[]'], [KEY, '1']]],
      'a deliberate sign-out: \'null\', \'[]\', \'[]\', the switch unchanged, ONE reload — the native plan finds no class and cancels the countdown at once');

    // A refused permission flips nothing.
    const refused = bootAndroid({ perm: 'prompt', deny: true, local: { psycle_class_reminders: 'off' } });
    await landed(refused.b);
    mark = refused.b.calls.plugin.length;
    eq(await refused.b.ctx._nativeClassReminders.enable(), false, 'turned on but the system says no: enable() answers false');
    await h.flush();
    eq([words(refused.b, mark), refused.b.ls.getItem('psycle_class_reminders'), switchWrites(refused.box).slice(-1)], [[], 'off', ['0']], '…the preference stays off, so nothing is re-written: the switch still says \'0\'');
    eq([quiet(early.b), quiet(b), quiet(refused.b)], [[[], []], [[], []], [[], []]], 'none of it warned about');
  }
  {
    // Only enable() and disable() write the preference — so only they need to
    // tell the countdown. A third writer would have to as well.
    const code = bridgeSrc.replace(/\/\/.*$/gm, '');
    eq((code.match(/localStorage\.setItem\(CLASS_REMINDER_PREF,/g) || []).length, 2, 'the bridge writes psycle_class_reminders in exactly two places (enable, disable)…');
    eq((code.match(/_androidCountdownFlipped\(/g) || []).length, 3, '…and each is followed by the flip (its definition + the two calls)');
    const webWriters = t.fs.readdirSync(t.JS_DIR).filter((f) => /\.js$/.test(f) && /psycle_class_reminders/.test(t.fs.readFileSync(t.path.join(t.JS_DIR, f), 'utf8')));
    eq(webWriters, [], '…and no js/ module names the key at all: the web layer goes through window._nativeClassReminders (a settings import does not carry it)');
  }

  // ════════════════════════════════════════════════════════════════════
  // D. Older apps, broken twins
  // ════════════════════════════════════════════════════════════════════
  t.section('Android countdown: an app built before the key, or before the twins — served without a word');
  {
    // Before the twins (level 2): none of the names exists.
    const { b } = await android.launch(h, 'android');
    const mark = b.calls.plugin.length;
    await b.ctx._nativeClassReminders.disable();
    await b.ctx._nativeClassReminders.enable();
    await h.flush();
    eq([b.calls.plugin.filter(isWidgetCall), quiet(b)], [[], [[], []]], 'no twins: no call at all — at launch, in a pass, or when the switch is flipped — and nothing logged');
    ok(b.calls.plugin.slice(mark).some((c) => c[0] === 'LocalNotifications.schedule'), '…while the reminders themselves still re-arm');

    // With the twins but before the key (level 3): the twin REFUSES a key it
    // does not know — a rejected promise the bridge must swallow.
    const box = {};
    const strict = (rec) => {
      const twins = android.androidTwins(rec, box);
      const set = twins.AppGroupPreferences.set;
      twins.AppGroupPreferences.set = (o) => {
        if (WIDGET_KEYS.indexOf(o.key) !== -1) return set(o);
        rec('AppGroupPreferences.set', { group: o.group, key: o.key });
        return Promise.reject(new Error('unknown key'));
      };
      return twins;
    };
    const old = bootAndroid({ plugins: strict });
    await landed(old.b);
    await old.b.clock.advance(5000);
    await old.b.ctx._nativeClassReminders.disable();
    await old.b.ctx._nativeClassReminders.enable();
    await h.flush();
    const oldWords = words(old.b);
    eq([Object.prototype.hasOwnProperty.call(box.values, KEY), WIDGET_KEYS.every((k) => typeof box.values[k] === 'string'), oldWords.filter((w) => w === 'reload').length >= 2, quiet(old.b)],
      [false, true, true, [[], []]], 'a twin that refuses the key: the snapshot is stored and the reloads asked for all the same, the refusal swallowed — the widget of an un-updated app is not harmed');
    ok(old.b.calls.scheduled.length >= 1, '…and the pass ran to its end: it is what arms the class reminders');
  }
  {
    const broken = [
      ['rejects', { AppGroupPreferences: { set: () => Promise.reject(new Error('no')) }, WidgetCenter: { reloadAllTimelines: () => Promise.reject(new Error('no provider')) } }],
      ['throws', { AppGroupPreferences: { set() { throw new Error('boom'); } }, WidgetCenter: { reloadAllTimelines() { throw new Error('boom'); } } }],
      ['answers no promise', { AppGroupPreferences: { set() {} }, WidgetCenter: { reloadAllTimelines() {} } }],
      ['is half there', { AppGroupPreferences: {} }],
    ];
    for (const [how, plugins] of broken) {
      const { b } = bootAndroid({ plugins: plugins });
      await landed(b);
      await b.ctx._nativeClassReminders.disable();
      const back = await b.ctx._nativeClassReminders.enable();
      await h.flush();
      eq([how, back, b.ls.getItem('psycle_class_reminders'), quiet(b)], [how, true, 'on', [[], []]], 'a twin that ' + how + ': the switch in Settings still works both ways, and nothing is logged');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // E. The iPhone app
  // ════════════════════════════════════════════════════════════════════
  t.section('Android countdown: the iPhone app never writes the key — its calls and its copy are what they were');
  {
    const ios = await android.launch(h, 'ios');
    const d = android.iphoneLaunchDigest(ios.lines);
    eq(d.got, d.want, 'as \'ios\' the recorded plugin calls of one launch are still IPHONE_LAUNCH_DIGEST, to the byte (it was NOT re-recorded for this work)');
    ok(ios.lines.join('\n').indexOf(KEY) === -1, '…and the key appears in none of them');
    const legacy = await android.launch(h, undefined);
    eq(legacy.lines, ios.lines, 'a bridge that cannot say its platform is the iPhone app, as ever');

    // The switch flipped on the iPhone: what it always did, and no more.
    const twinsAndLive = (box) => (rec) => Object.assign(android.androidTwins(rec, box), { PsycleLiveActivity: { refresh() { rec('PsycleLiveActivity.refresh'); return Promise.resolve(); } } });
    const box = {};
    const { b } = bootAndroid({ platform: 'ios', plugins: twinsAndLive(box) });
    await landed(b);
    let mark = b.calls.plugin.length;
    await b.ctx._nativeClassReminders.disable();
    await h.flush();
    eq(words(b, mark), [], 'Class reminders turned off on the iPhone: no widget-side call at all, as before (the Live Activity is not the reminders\' to end)');
    mark = b.calls.plugin.length;
    await b.ctx._nativeClassReminders.enable();
    await h.flush();
    eq(words(b, mark), IPHONE_PASS.concat(['PsycleLiveActivity.refresh']), '…turned on: the ONE pass enable() always ran — three keys, a reload, the Live Activity nudge');
    // Early-ending passes on the iPhone write nothing, flip or no flip.
    const cold = bootAndroid({ platform: 'ios', plugins: twinsAndLive({}) });
    await h.flush();
    await cold.b.ctx._nativeClassReminders.disable();
    await cold.b.ctx._nativeClassReminders.enable();
    await h.flush();
    eq(words(cold.b), [], '…and with nothing held yet, nothing at all');
    eq([switchWrites(box), Object.prototype.hasOwnProperty.call(box.values, KEY)], [[], false], 'the key is never written on the iPhone, whatever the member does');
    eq([quiet(b), quiet(cold.b)], [[[], []], [[], []]], 'nothing warned');
  }
  {
    // Copy: the iPhone's sentences are literals that did not move.
    const ios = await android.launch(h, 'ios');
    const reminder = ios.b.calls.scheduled.reduce((a, s) => a.concat(s.notifications), []).filter((x) => x.extra && x.extra.eventId)[0] || {};
    eq([reminder.title, reminder.body], ['RIDE: 45 starts in 90 minutes', 'Ann · Bank · Open Psync for the live countdown'], 'the iPhone class reminder: its title and body, to the letter');

    const ask = async (platform) => {
      const b = h.boot({ platform: platform, perm: 'prompt', deny: true });
      await h.flush();
      b.events.emit('booking:complete');
      await b.clock.advance(2500);
      const m = b.calls.modals[0];
      if (m) { m.answer(false); await h.flush(); }
      return m ? [m.opts.title, m.opts.body, m.opts.confirmText, m.opts.cancelText] : [];
    };
    const iphoneAsk = ['Remind you 90 minutes before class?', 'Psync can send a notification 90 minutes before each class you book. Tap it for the live countdown.', 'Remind me', 'Not now'];
    eq([await ask('ios'), await ask(undefined)], [iphoneAsk, iphoneAsk], 'the iPhone first-booking ask: title, body and both buttons, to the letter');
    const droidAsk = await ask('android');
    eq([droidAsk[0], droidAsk[2], droidAsk[3]], [iphoneAsk[0], iphoneAsk[2], iphoneAsk[3]], 'the Android ask differs in its body ALONE (18-android.js holds the sentence)');

    const row = t.loadPure('js/tabs.js', 'reminder-row');
    eq([row._classReminderSwitch(true, true).detail, row._classReminderSwitch(true, true, false).detail, row._classReminderSwitch(false, null).detail, row._classReminderSwitch(true, false).detail],
      ['90 minutes before each class. Opens the live countdown.', '90 minutes before each class. Opens the live countdown.', '90 minutes before each class. Opens the live countdown.', 'Tap to allow notifications'],
      'the iPhone Settings row: "opens the live countdown", and a refused permission as before');
    const welcome = t.loadPure('js/app.js', 'welcome');
    eq(welcome._welcomePages(true, true, 'ios')[3].body, 'Everything you hold in one place, with widgets and reminders on iPhone.', 'the iPhone welcome\'s last page, to the letter');

    // Android's words for the same places: a countdown in its NOTIFICATIONS — never the iPhone's furniture.
    const droid = [droidAsk[1], row._classReminderSwitch(true, true, true).detail, welcome._welcomePages(true, true, 'android')[3].body];
    eq(droid.filter((s) => /Live Activity|Lock Screen|live countdown|iPhone|iOS|!/i.test(s)), [], 'Android\'s ask, row and welcome: no "Live Activity", no "Lock Screen", no "live countdown", no exclamation mark');
    eq(droid.map((s) => /\bcountdown\b/.test(s)), [true, true, false], '…the ask and the row name the countdown (one yes, one switch, covers it too); the welcome does not, as the iPhone\'s does not');
  }

  // ════════════════════════════════════════════════════════════════════
  // F. The seam, and the shape of the path
  // ════════════════════════════════════════════════════════════════════
  t.section('Android countdown: the bridge\'s key is the Android project\'s, and the one platform test sits in its own helper');
  {
    const literal = (/\bvar COUNTDOWN_ENABLED_KEY\s*=\s*'([^'\n]*)'/.exec(bridgeSrc) || [])[1];
    eq(literal, KEY, 'the bridge holds the key as ONE literal: var COUNTDOWN_ENABLED_KEY = \'countdown_enabled\' (anchor moved?)');

    const cut = (from, to) => {
      const a = bridgeSrc.indexOf(from), z = bridgeSrc.indexOf(to, a);
      if (a === -1 || z === -1) throw new Error('21-android-countdown suite: cannot find "' + from + '" … "' + to + '" (anchor moved?)');
      return bridgeSrc.slice(a, z).replace(/\/\/.*$/gm, '');
    };
    const pass = cut('  function updateWidgetSnapshot() {', '  window.updateWidgetSnapshot = updateWidgetSnapshot;');
    const at = pass.indexOf('_androidCountdownSwitch();');
    ok(at !== -1 && pass.indexOf('_androidCountdownSwitch();', at + 1) === -1, 'updateWidgetSnapshot hands the switch over in ONE place…');
    ok(at > pass.indexOf('_writeSnapshotKey(WIDGET_WEEK_KEY') && at < pass.indexOf('reloadAllTimelines'), '…after the last of the three keys and before the reload');
    ok(!/IS_ANDROID|getPlatform/.test(pass), '…and asks no platform question itself (20-android-widget.js holds the same of the whole widget path)');
    const helper = cut('  function _androidCountdownSwitch() {', '  function _androidCountdownFlipped(');
    ok(/^\s*function _androidCountdownSwitch\(\) \{\s*if \(!IS_ANDROID\) return;/.test(helper), 'the helper\'s FIRST statement is `if (!IS_ANDROID) return;`: on the iPhone it is a no-op before anything is counted or called');
    ok(/_appGroupSet\(COUNTDOWN_ENABLED_KEY, _classRemindersEnabled\(\) \? '1' : '0'\);/.test(helper) && !/_prefSet|_writeSnapshotKey|Preferences\./.test(helper),
      '…then ONE _appGroupSet of \'1\' | \'0\' from _classRemindersEnabled() — not _writeSnapshotKey: no Preferences copy');
    const flip = cut('  function _androidCountdownFlipped(', '  function _loadReminderMap(');
    ok(/^\s*function _androidCountdownFlipped\(sendsBefore\) \{\s*if \(!IS_ANDROID \|\| _countdownSwitchSends !== sendsBefore\) return;/.test(flip), 'the flip too is Android\'s alone, and stands down when a pass already carried the switch');
    ok(!/LocalNotifications|requestPermissions|schedule\(/.test(helper + flip), 'neither schedules, posts or asks for anything: the countdown notification is the native side\'s, the T-90 reminder is untouched');
    ok(!/Capacitor\.Plugins\.\w*Countdown/i.test(bridgeSrc) && (bridgeSrc.replace(/\/\/.*$/gm, '').match(/Capacitor\.Plugins\.PsycleLiveActivity\b/g) || []).length === 1,
      'the bridge reaches for no countdown plugin, and for PsycleLiveActivity in the ONE place it always did (the iPhone\'s refresh)');

    // The Android project's side. It names the key — so the seam is HELD, not hoped for: a twin that does not
    // know the key REFUSES it (section D shows the bridge says nothing), and the countdown would never learn it
    // had been switched off.
    const javaRoot = t.path.join(t.REPO_ROOT, 'ios-app', 'android', 'app', 'src', 'main', 'java');
    const javaFiles = [];
    const walk = (dir) => {
      let entries = [];
      try { entries = t.fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      entries.forEach((e) => { const p = t.path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.java$/.test(e.name)) javaFiles.push(p); });
    };
    walk(javaRoot);
    const uncommented = (f) => t.fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const naming = javaFiles.filter((f) => uncommented(f).indexOf('"' + KEY + '"') !== -1);
    eq(naming.map((f) => t.path.basename(f)), ['PsyncSnapshot.java'], 'the Android project names "' + KEY + '" ONCE, in the pure PsyncSnapshot (KEY_COUNTDOWN_ENABLED): the twin\'s allow-list and its reader use the constant, so the literal cannot come to differ between them');
    const snapshot = naming.length ? uncommented(naming[0]) : '';
    ok(/\bKEY_COUNTDOWN_ENABLED\s*=\s*"countdown_enabled"\s*;/.test(snapshot) && /\bisStoreKey\s*\(\s*String\s+key\s*\)\s*\{\s*return\s+isWidgetKey\s*\(\s*key\s*\)\s*\|\|\s*KEY_COUNTDOWN_ENABLED\s*\.\s*equals\s*\(\s*key\s*\)\s*;/.test(snapshot),
      '…the store takes the three snapshot keys and that ONE more (isStoreKey) — no fifth');
    ok(/if\s*\(\s*KEY_COUNTDOWN_ENABLED\s*\.\s*equals\s*\(\s*key\s*\)\s*\)\s*\{\s*return\s+"1"\s*\.\s*equals\s*\(\s*value\s*\)\s*\|\|\s*"0"\s*\.\s*equals\s*\(\s*value\s*\)\s*;/.test(snapshot),
      '…under it, exactly the two values the bridge sends — "1" | "0" (fitsKey): anything else is refused, so what is stored can only mean on or off');
    ok(/\bcountdownEnabled\s*\(\s*String\s+stored\s*\)\s*\{\s*return\s*"1"\s*\.\s*equals\s*\(\s*stored\s*\)\s*;/.test(snapshot),
      '…and ONLY "1" is on: never written = OFF. The countdown FOLLOWS Class reminders, which only the page can read — so a plan run that comes before the page has said (the activity\'s start, a restart, the widget\'s update, on an app updated over a build without the key) shows nothing; the first pass writes the real value seconds later, and the twin plans at once when that turns it on');
    const all = javaFiles.map(uncommented).join('\n');
    ok(!/@CapacitorPlugin\s*\(\s*name\s*=\s*"PsycleLiveActivity"/.test(all), '…and it registers no PsycleLiveActivity: the countdown is not a plugin the bridge could call');
  }
};
