'use strict';
// Wave-2 booking extras: the My Bookings countdown chip reading the same
// London-aware class start as the late-cancel warning (the runner's zone is
// New York — exactly the "member abroad" case), the shared class-history cap
// (#32) against the REAL features.js, the instructor modal's "View schedule"
// tab switch (#31) and the haptics that moved (#94).
module.exports = async function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const grab = (source, opener, closer) => {
    const lines = source.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (from === -1 || to === -1) throw new Error('booking-extras suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };

  // ── Countdown chip ───────────────────────────────────────────────────────
  // The REAL getCountdownText + _gymDayKey over the REAL London resolver.
  const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  const gym = t.loadPure('js/app.js', 'gym-time');
  const chipWorld = (win) => {
    const ctx = t.loadPure('js/app.js', 'bookings-card', { localDateStr: ymd, window: win });
    t.vm.runInContext('let _gymDayFmt = null;\n' + grab(appSrc, 'function _gymDayKey(') + '\n' + grab(appSrc, 'function getCountdownText('), ctx);
    return ctx;
  };
  const london = chipWorld({ _psycleClassStartMs: gym._gymClassStartMs });
  // As renderMyBookings calls it: the device-local Date, "now", and the raw start_at.
  const chip = (ctx, startAt, nowLocal) => ctx.getCountdownText(new Date(startAt.replace(' ', 'T')), new Date(nowLocal), startAt);

  t.section('Countdown chip: counts from the real (London) start, like the late-cancel warning');
  ok(new Date('2026-09-17T12:00:00').getTimezoneOffset() === 240, 'the runner really is in New York (UTC-4 in September) — otherwise this section proves nothing');
  {
    // 18:00 London = 13:00 New York. At 08:00 New York the class is 5 hours away;
    // read device-locally ("18:00 here") it looked 10 hours away.
    const START = '2026-09-17 18:00:00', NOW = '2026-09-17T08:00:00';
    eq(london.getCountdownText(new Date(START.replace(' ', 'T')), new Date(NOW)), 'In 10h', 'without the raw start_at the chip stays device-local (what it used to print abroad)');
    eq(chip(london, START, NOW), 'In 5h', 'given start_at it counts from the real start: "In 5h"');
    const dl = london._cancelDeadline(START, new Date(NOW).getTime());
    const left = london._hoursMinsLeft(dl.hoursUntil);
    eq([left.hrs, left.mins, dl.insideWindow], [5, 0, true], '…the same 5h the cancel dialog warns about, inside the late-cancel window');
    eq(chip(london, START, '2026-09-17T12:59:40'), 'Starting now', 'the last 30 seconds read "Starting now", never "In 0min"');
    eq(chip(london, START, '2026-09-17T12:15:00'), 'In 45min', 'minutes as before');
    eq(chip(london, START, '2026-09-17T14:00:00'), null, 'already running by the real clock → no chip (device-local it still read "In 4h")');
  }

  t.section('Countdown chip: today / tomorrow are the gym\'s calendar days');
  {
    // 20:00 Wednesday in New York is already 01:00 Thursday in London.
    eq(chip(london, '2026-09-18 07:00:00', '2026-09-17T20:00:00'), 'In 6h', "Thursday 7am, asked on London's Thursday → a countdown, not \"Tomorrow\"");
    eq(chip(london, '2026-09-18 07:00:00', '2026-09-17T10:00:00'), 'Tomorrow 7:00am', "asked on London's Wednesday afternoon → Tomorrow, with the class's own wall-clock time");
    eq(chip(london, '2026-09-19 07:00:00', '2026-09-17T10:00:00'), null, 'the day after tomorrow → no chip');
    // Clocks go back on Sun 25 Oct 2026: that London day is 25 hours long.
    eq(london._gymDayKey(Date.UTC(2026, 9, 24, 23, 30), 1), '2026-10-26', 'tomorrow is calendar arithmetic (+24h from 00:30 on the 25-hour day would still be the 25th)');
    eq(london._gymDayKey(Date.UTC(2026, 9, 24, 23, 30), 0), '2026-10-25', '…00:30 BST on the 25th is the 25th');
  }

  t.section('Countdown chip: falls back to the device clock when it has to');
  {
    const START = '2026-09-17 18:00:00', NOW = '2026-09-17T08:00:00';
    eq(chip(chipWorld({}), START, NOW), 'In 10h', 'no resolver on window → device-local, as before');
    eq(chip(chipWorld({ _psycleClassStartMs: () => NaN }), START, NOW), 'In 10h', 'a resolver that cannot answer → device-local');
    const noZone = chipWorld({ _psycleClassStartMs: gym._gymClassStartMs });
    noZone._gymDayKey = () => { throw new RangeError('Invalid time zone specified: Europe/London'); };
    eq(chip(noZone, START, NOW), 'In 10h', 'no Europe/London data → the WHOLE reading stays device-local (never a real start against a local "today")');
    eq(chip(london, '2026-09-17T18:00:00', '2026-09-17T12:59:40'), 'Starting now', 'T-form start_at works the same (18:00 London is 13:00 here)');
  }
  ok(/getCountdownText\(dt, now, evt\.start_at\)/.test(appSrc), 'renderMyBookings hands the chip the raw start_at');

  // ── Class history: one cap, and a save that cannot fail a booking ─────────
  // The REAL features.js, loaded into a sandbox that doubles as `window`.
  function featuresWorld(o) {
    o = o || {};
    const store = { psycle_class_history: JSON.stringify(o.history || []) };
    const log = { timers: [], handlers: {}, warns: [], calls: [] };
    const sb = {
      console: { log() {}, warn: (...a) => log.warns.push(a.join(' ')), error: console.error },
      setTimeout: (fn) => { log.timers.push(fn); return log.timers.length; },
      document: { readyState: 'complete', addEventListener() {}, getElementById: () => null },
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { if (o.quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } store[k] = String(v); },
      },
      escapeHTML: (s) => String(s),
      PsycleEvents: { on: (name, fn) => { log.handlers[name] = fn; } },
      _eventCache: { 900501: { id: 900501, start_at: '2026-09-21 07:00:00', _typeName: 'Ride', _instrName: 'Alex', _locName: 'Bank' } },
      _myBookings: { 900501: { bookingId: 'A', slots: [7], waitlisted: false } },
      submitBooking: async () => 'posted',
      selectedInstructors: new Set(['1', '2']),
      renderInstrChips: () => log.calls.push('chips'),
      renderInstrDropdown: () => log.calls.push('dropdown'),
      switchTab: (tab) => log.calls.push('tab:' + tab),
      search: () => log.calls.push('search'),
    };
    sb.window = sb;
    t.vm.createContext(sb);
    t.vm.runInContext(t.readSource('js/features.js'), sb, { filename: 'js/features.js' });
    const capAtLoad = sb.PSYCLE_HISTORY_MAX; // before init() has run
    log.timers.splice(0).forEach((fn) => fn()); // the deferred init(): patches submitBooking, subscribes
    return { sb, log, capAtLoad, history: () => JSON.parse(store.psycle_class_history) };
  }
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ eventId: String(i + 1), typeName: 'Ride', instrName: 'Sam', locName: 'Bank', date: '2024-01-01 07:00:00', slots: [] }));

  t.section('Class history: a booking no longer truncates a synced history (#32)');
  {
    let w = featuresWorld({ history: rows(800) });
    eq(w.capAtLoad, 2000, 'window.PSYCLE_HISTORY_MAX is set when the file loads — before the deferred init()');
    w.log.handlers['booking:complete'](900501, [7]);
    eq([w.history().length, w.history()[0].eventId], [801, '900501'], '800 synced rows + one booking → 801, newest first (it used to be cut to 500)');

    w = featuresWorld({ history: rows(2000) });
    w.log.handlers['booking:complete'](900501, [7]);
    eq([w.history().length, w.history()[0].eventId, w.history()[1999].eventId], [2000, '900501', '1999'], 'at the cap the OLDEST row is the one dropped');

    w = featuresWorld({ history: rows(3) });
    eq(await w.sb.submitBooking(900501, [7], {}, {}), 'posted', 'the patched submitBooking resolves with the original result');
    eq(w.history().length, 4, '…and records the class');

    w = featuresWorld({ history: rows(3), quota: true });
    let rejected = null;
    const res = await w.sb.submitBooking(900501, [7], {}, {}).catch((e) => { rejected = e; });
    eq([rejected, res], [null, 'posted'], 'storage full: the booking that already went through still resolves (it used to reject → read as a failed booking)');
    ok(w.log.warns.some((m) => /class history not saved/.test(m)), '…and the lost write is logged');

    const explore = t.readSource('js/explore.js');
    ok(/window\.PSYCLE_HISTORY_MAX \|\| 2000/.test(explore) && !/merged\.length > 1000/.test(explore), 'the history sync reads the same cap (no second number)');
    ok(!/history\.length > 500/.test(t.readSource('js/features.js')), 'the 500 is gone');
  }

  t.section('Instructor modal: "View schedule" lands on Discover (#31)');
  {
    const w = featuresWorld();
    w.sb._features_filterByInstructor(31);
    eq([...w.sb.selectedInstructors], ['31'], 'the filter is this instructor alone');
    eq(w.log.calls, ['chips', 'dropdown', 'tab:discover', 'search'], 'Discover is shown BEFORE the search runs (from My Bookings / Stats it filled a hidden tab)');
    // In the app, app.js's _focusSearch is there and takes over whole: it also
    // drops the studio / class-type filters that hid this instructor's classes
    // (tests/suites/discover-journeys.js runs the real one).
    const routed = featuresWorld();
    const asked = [];
    routed.sb._focusSearch = (o) => asked.push(o);
    routed.sb._features_filterByInstructor(31);
    eq([asked, routed.log.calls, [...routed.sb.selectedInstructors]], [[{ instructorId: '31' }], [], ['1', '2']],
      'with _focusSearch present it is handed the instructor and nothing else is touched here (no second search, no second tab switch)');
    const explore = t.readSource('js/explore.js');
    const chipFn = grab(explore, '  window._explore_openSettingsForInstructor = function (name) {', '  };');
    ok(/switchTab\('membership'\)/.test(chipFn) && !/openSettings\(/.test(chipFn), "Stats' Unranked chips open the Membership tab (where #tierSearch lives), not the Settings sheet");
    ok(!/_features_filterByInstructor\([^)]*\);'\s*\+\s*\n\s*'window\.switchTab/.test(explore), 'the Explore card no longer switches tab a second time');
  }

  t.section('Haptics: no tick on programmatic searches, one on a seat pick (#94)');
  {
    const wrap = grab(t.readSource('js/theme.js'), 'function wrapSearch() {');
    ok(!/haptic\(/.test(wrap.replace(/\/\/.*$/gm, '')), 'theme.js wrapSearch no longer buzzes (search() runs by itself after launch and after every filter change)');
    ok(/showSkeletonLoading\(\)/.test(wrap) && /originalSearch\.apply\(this, arguments\)/.test(wrap), '…and still shows the skeleton and forwards the call');
    const pick = grab(appSrc, 'function selectBike(');
    ok(/typeof haptic === 'function'\) \{ try \{ haptic\('tap'\); \} catch/.test(pick), "selectBike ticks with the guarded 'tap' the dialogs use (no native-bridge change needed)");
  }
};
