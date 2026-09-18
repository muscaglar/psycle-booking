'use strict';
// My Bookings card: the shared 12h late-cancel helper (_cancelDeadline), the
// cache-entry decorator rebookNextWeek seeds with (_eventCacheEntry), and the
// markup/selector pairs that silently went dead once before.
module.exports = async function (t) {
  const HOUR = 3600000;
  const pure = t.loadPure('js/app.js', 'bookings-card');
  // The runner pins TZ=America/New_York: "local" below is NOT the UK. This first
  // block has NO window._psycleClassStartMs in its context — the last-resort
  // branch (no resolver, or one that can't answer) — where start_at is parsed
  // the way the card parses it (naive → device-local), so the label still
  // carries the API's wall-clock digits. Neither build runs like this any more:
  // the web and iOS blocks further down assert the real London instant.
  const local = (s) => new Date(s).getTime();

  t.section('Bookings card: _cancelDeadline (12h late-cancel rule) — no resolver (device-local fallback)');
  t.ok(typeof pure._cancelDeadline === 'function', 'pure:bookings-card exposes _cancelDeadline (evaluated with no DOM / app globals)');

  // BST date (July). 19h out → free to cancel, deadline printed as Mon 7:00pm.
  const bstStart = '2026-07-14T07:00:00'; // Tuesday
  let d = pure._cancelDeadline(bstStart, local('2026-07-13T12:00:00'));
  t.eq(d.insideWindow, false, 'BST date, 19h before class: outside the late-cancel window');
  t.eq(d.label, 'Mon 7:00pm', 'BST date: deadline label is the class wall-clock minus 12h');
  t.eq(d.hoursUntil, 19, 'hoursUntil is measured to the class start');
  t.eq(d.deadlineMs, local(bstStart) - 12 * HOUR, "deadline = the card's own new Date(start_at) minus 12h, so card and dialog agree");

  // GMT date (January): same digits — no zone offset leaks into the label.
  d = pure._cancelDeadline('2026-01-13T07:00:00', local('2026-01-12T09:00:00'));
  t.eq(d.label, 'Mon 7:00pm', 'GMT date: same wall-clock digits as the BST case');
  t.eq(d.insideWindow, false, 'GMT date, 22h before class: outside the window');

  // Less than 12h away.
  d = pure._cancelDeadline(bstStart, local(bstStart) - 6 * HOUR);
  t.eq(d.insideWindow, true, 'class 6h away: inside the late-cancel window');
  t.eq(d.hoursUntil, 6, 'class 6h away: hoursUntil = 6');

  // Exactly 12h: conservative — never promise a free cancel at the cutoff.
  d = pure._cancelDeadline(bstStart, local(bstStart) - 12 * HOUR);
  t.eq(d.insideWindow, true, 'exactly 12h before class counts as inside the window');
  d = pure._cancelDeadline(bstStart, local(bstStart) - 12 * HOUR - 1);
  t.eq(d.insideWindow, false, '1ms before the cutoff is still free');

  // Already started: still "inside" — callers decide what a past class means.
  d = pure._cancelDeadline(bstStart, local(bstStart) + 10 * 60000);
  t.ok(d.insideWindow === true && d.hoursUntil < 0, 'a class that has started reads inside the window with negative hoursUntil');

  // Label formatting edges.
  t.eq(pure._cancelDeadline('2026-07-14T12:00:00', 0).label, 'Tue 12:00am', 'noon class → deadline 12:00am the same day');
  t.eq(pure._cancelDeadline('2026-07-14T00:15:00', 0).label, 'Mon 12:15pm', 'just-after-midnight class → deadline 12:15pm the day before');
  t.eq(pure._cancelDeadline('2026-07-14 18:30:00', 0).label, 'Tue 6:30am', "a space-separated start_at parses like the 'T' form (Safari rejects the raw string)");
  t.eq(pure._cancelDeadline('2026-07-14 18:30:00', 0).deadlineMs, local('2026-07-14T18:30:00') - 12 * HOUR, 'space-separated start_at resolves to the same instant');

  // Unreadable input never throws and never invents a deadline.
  t.eq(pure._cancelDeadline(null), null, 'null start → null');
  t.eq(pure._cancelDeadline(''), null, 'empty start → null');
  t.eq(pure._cancelDeadline('not a date'), null, 'garbage start → null');
  t.ok(pure._cancelDeadline(bstStart) !== null, 'nowMs defaults to Date.now()');

  // On a UK device even the fallback is right: the cutoff is 12 REAL hours
  // before class, so it shifts an hour on the wall clock across a clock change.
  // (Node re-reads TZ on assignment; restored below so later suites keep the
  // runner's zone.)
  const prevTz = process.env.TZ;
  try {
    process.env.TZ = 'Europe/London';
    t.eq(pure._cancelDeadline('2026-10-25T07:00:00', 0).label, 'Sat 8:00pm', 'UK device, clocks went back overnight: 7am GMT class → free until Sat 8:00pm BST');
    t.eq(pure._cancelDeadline('2026-03-29T07:00:00', 0).label, 'Sat 6:00pm', 'UK device, clocks went forward overnight: 7am BST class → free until Sat 6:00pm GMT');
    t.eq(pure._cancelDeadline('2026-07-14T07:00:00', 0).label, 'Mon 7:00pm', 'UK device, ordinary BST day');
    t.eq(pure._cancelDeadline('2026-01-13T07:00:00', 0).label, 'Mon 7:00pm', 'UK device, ordinary GMT day');
  } finally {
    process.env.TZ = prevTz;
  }
  t.eq(new Date('2026-07-14T07:00:00').getTimezoneOffset(), 240, 'runner zone restored after the UK-device checks');

  // The hosted web app / PWA never loads the iOS bridge, so js/app.js ships the
  // Europe/London resolver itself (pure:gym-time) and exports it where
  // _cancelDeadline and _waitlistTimeMs look for it. Evaluated exactly as the
  // browser gets it — no bridge anywhere in this context — on a device in New
  // York: it used to read "free, 15h to go" two hours INSIDE the charge window.
  t.section('Bookings card: _cancelDeadline — web build (no bridge), device abroad');
  const utc = (y, mo, dd, h, mi) => Date.UTC(y, mo - 1, dd, h, mi || 0);
  const abroad = '2026-09-18 07:00:00'; // 07:00 BST = 06:00Z → free cancel ends 18:00Z on the 17th
  const gym = t.loadPure('js/app.js', 'gym-time', { window: {} });
  t.ok(typeof gym.window._psycleClassStartMs === 'function', 'js/app.js exports window._psycleClassStartMs itself (pure:gym-time) — no bridge needed');
  const web = t.loadPure('js/app.js', 'bookings-card', { window: gym.window });
  d = web._cancelDeadline(abroad, utc(2026, 9, 17, 20));
  t.eq(d.deadlineMs, utc(2026, 9, 17, 18), 'web, New York: the deadline is 12h before the LONDON start (18:00Z), not the New York one (23:00Z)');
  t.eq([d.insideWindow, d.hoursUntil], [true, 10], 'web, New York: inside the window with 10h to go (was: free, 15h)');
  t.eq(d.label, 'Thu 7:00pm', 'web, New York: the printed deadline is UK wall clock');
  t.eq(web._cancelDeadline(abroad, utc(2026, 9, 17, 18) - 1).insideWindow, false, 'web: 1ms before the London cutoff is still free');
  t.eq(web._cancelDeadline('2026-11-01T07:00:00', 0).label, 'Sat 7:00pm', "web: US clocks change overnight, the UK's do not → Sat 7:00pm (device-local said 8:00pm)");
  t.eq(web._cancelDeadline('2027-03-28T07:00:00', 0).label, 'Sat 6:00pm', 'web: UK clocks go forward overnight → Sat 6:00pm GMT (device-local said 7:00pm)');
  t.eq(web._cancelDeadline('2026-10-25T07:00:00', 0).label, 'Sat 8:00pm', 'web: UK clocks go back overnight → Sat 8:00pm BST');
  t.eq([web._cancelDeadline(null), web._cancelDeadline(''), web._cancelDeadline('not a date')], [null, null, null], 'web: unreadable input is still null');
  try {
    process.env.TZ = 'Asia/Tokyo';
    d = web._cancelDeadline(abroad, utc(2026, 9, 17, 20));
    t.eq([d.insideWindow, d.hoursUntil, d.label], [true, 10, 'Thu 7:00pm'], 'web, Tokyo: the same instant and label (device-local read 2h to go)');
    process.env.TZ = 'Europe/London';
    d = web._cancelDeadline(abroad, utc(2026, 9, 17, 20));
    t.eq([d.insideWindow, d.hoursUntil, d.label], [true, 10, 'Thu 7:00pm'], 'web, UK device: unchanged');
  } finally {
    process.env.TZ = prevTz;
  }
  t.eq(new Date('2026-07-14T07:00:00').getTimezoneOffset(), 240, 'runner zone restored after the web-build zone checks');

  // In the iOS app the bridge loads last and exports its own copy of the
  // resolver. The REAL one is used here (the bridge file bails at its Capacitor
  // guard right after exporting it), on a device that is still in New York:
  // start_at is UK wall clock, so both the instant and the printed deadline
  // must be London's.
  t.section('Bookings card: _cancelDeadline — iOS bridge present, device abroad (New York)');
  const bridge = { console: { log() {} } };
  bridge.window = bridge;
  t.vm.createContext(bridge);
  t.vm.runInContext(t.readSource('ios-app/www/native-bridge.js'), bridge, { filename: 'native-bridge.js' });
  t.ok(typeof bridge._psycleClassStartMs === 'function', 'the bridge exports window._psycleClassStartMs before its Capacitor guard');
  const ios = t.loadPure('js/app.js', 'bookings-card', { window: { _psycleClassStartMs: bridge._psycleClassStartMs } });

  // Two copies of one resolver (unit.js evaluates the bridge alone, so it keeps
  // its own): whichever is in play, every shape of start_at must land on the
  // same instant.
  const shapes = ['2026-09-18 07:00:00', '2026-09-18T07:00', '2026-01-13T07:00:00.250', '2026-10-25 01:30:00', '2026-03-29 01:30:00',
    '2026-03-29T00:59:59', '2026-07-14T06:00:00Z', '2026-07-14 07:00:00 +01:00', '2026-07-14', 1789711200000, '', null, undefined, 'not a date', NaN];
  t.eq(shapes.map((x) => String(gym.window._psycleClassStartMs(x))), shapes.map((x) => String(bridge._psycleClassStartMs(x))),
    "app.js's resolver and the bridge's agree on every start_at shape (naive, DST gap/overlap, Z, offset, date-only, epoch, junk)");

  // 07:00 UK (BST) on 18 Sep = 06:00Z, so the free cancel ends 18:00Z on the
  // 17th — 2pm in New York. At 20:00Z the member is two hours INSIDE the
  // charge window; a device-local parse still promised "Free cancel until 7pm".
  d = ios._cancelDeadline(abroad, utc(2026, 9, 17, 20));
  t.eq(d.deadlineMs, utc(2026, 9, 17, 18), 'deadline is 12h before the LONDON start (18:00Z), not the New York one (23:00Z)');
  t.eq([d.insideWindow, d.hoursUntil], [true, 10], 'two hours past the real cutoff: inside the window, 10h to class');
  t.eq(d.label, 'Thu 7:00pm', 'the printed deadline is UK wall clock, like the class time next to it');
  t.eq(pure._cancelDeadline(abroad, utc(2026, 9, 17, 20)).insideWindow, false, '(same input with NO resolver at all still reads free — the device-local last resort; this is the branch that differs)');
  t.eq(ios._cancelDeadline(abroad, utc(2026, 9, 17, 18) - 1).insideWindow, false, '1ms before the London cutoff is still free');
  t.eq(ios._cancelDeadline(abroad, utc(2026, 9, 17, 18)).insideWindow, true, 'AT the London cutoff counts as inside');

  // Clock-change nights, seen from New York. The digits are London's: 12 REAL
  // hours before class, which is an hour off "start minus 12" on the UK nights.
  t.eq(ios._cancelDeadline('2026-11-01T07:00:00', 0).label, 'Sat 7:00pm', 'US clocks change overnight, the UK\'s do not: 7am GMT class → free until Sat 7:00pm (device-local said 8:00pm)');
  t.eq(ios._cancelDeadline('2027-03-28T07:00:00', 0).label, 'Sat 6:00pm', 'UK clocks go forward overnight: 7am BST class → free until Sat 6:00pm GMT (device-local said 7:00pm)');
  t.eq(ios._cancelDeadline('2026-10-25T07:00:00', 0).label, 'Sat 8:00pm', 'UK clocks go back overnight: 7am GMT class → free until Sat 8:00pm BST');
  t.eq(ios._cancelDeadline('2026-03-29T07:00:00', 0).label, 'Sat 6:00pm', 'UK spring change 2026, same rule');
  t.eq(ios._cancelDeadline('2026-07-14T07:00:00', 0).label, 'Mon 7:00pm', 'ordinary BST day');
  t.eq(ios._cancelDeadline('2026-01-13T07:00:00', 0).label, 'Mon 7:00pm', 'ordinary GMT day');
  t.eq(ios._cancelDeadline('2026-07-14T00:15:00', 0).label, 'Mon 12:15pm', 'just-after-midnight class → 12:15pm the day before (weekday from the London date)');
  t.eq(ios._cancelDeadline('2026-07-14T12:00:00', 0).label, 'Tue 12:00am', 'noon class → 12:00am the same London day');

  // An explicit offset is already an absolute instant; it is still PRINTED in UK time.
  d = ios._cancelDeadline('2026-07-14T06:00:00Z', 0);
  t.eq([d.deadlineMs, d.label], [utc(2026, 7, 13, 18), 'Mon 7:00pm'], 'a Z start keeps its instant and prints as London wall clock');
  t.eq([ios._cancelDeadline(null), ios._cancelDeadline(''), ios._cancelDeadline('not a date')], [null, null, null], 'unreadable input is still null with the bridge present');

  // A bridge that cannot resolve (NaN) must not take the helper down with it.
  const nanBridge = t.loadPure('js/app.js', 'bookings-card', { window: { _psycleClassStartMs: () => NaN } });
  d = nanBridge._cancelDeadline(bstStart, 0);
  t.eq([d.deadlineMs, d.label], [local(bstStart) - 12 * HOUR, 'Mon 7:00pm'], 'resolver returns NaN → the device-local parse and digits, as with no resolver');

  t.section('Bookings card: _eventCacheEntry (rebook-next-week cache seed)');
  const relations = {
    event_types: [{ id: 7, name: 'Ride 45' }],
    instructors: [{ id: 31, full_name: 'Alex <b>Test</b>' }],
    studios: [{ id: 4, name: 'Studio 1', location_id: 2, has_layout: true }],
    locations: [{ id: 2, name: 'Psycle Oxford Circus', address: '76 Mortimer St' }],
  };
  const row = { id: 9001, event_type_id: 7, instructor_id: 31, studio_id: 4, start_at: '2026-07-21T07:00:00', is_fully_booked: false };
  let entry = pure._eventCacheEntry(row, relations);
  t.eq([entry._typeName, entry._instrName, entry._locName, entry._locFullName, entry._locAddress, entry._studioName],
    ['Ride 45', 'Alex <b>Test</b>', 'Oxford Circus', 'Psycle Oxford Circus', '76 Mortimer St', 'Studio 1'],
    'decorates the row with the names render() derives (raw — escaping stays at the innerHTML sites)');
  t.eq(entry.start_at, row.start_at, 'keeps the API fields');

  entry = pure._eventCacheEntry({ ...row, is_fully_booked: true }, relations, { layoutDetail: 'rich', is_fully_booked: false, _typeName: 'Old' });
  t.ok(entry.layoutDetail === 'rich' && entry.is_fully_booked === true && entry._typeName === 'Ride 45',
    'merges over an existing entry: richer fields survive, fresh API fields and names win');

  entry = pure._eventCacheEntry({ ...row, studio_id: '4', instructor_id: '31' }, relations);
  t.eq([entry._instrName, entry._studioName], ['Alex <b>Test</b>', 'Studio 1'], 'string vs numeric ids still match');

  entry = pure._eventCacheEntry(row, undefined, { _typeName: 'Ride 45', _instrName: 'Alex', _locName: 'Oxford Circus' });
  t.eq([entry._typeName, entry._instrName, entry._locName], ['Ride 45', 'Alex', 'Oxford Circus'], 'a response without relations never blanks names already cached');
  t.eq(pure._eventCacheEntry(row, {})._typeName, 'Class', 'nothing known → the usual "Class" fallback');

  t.section('Bookings card: markup the handlers depend on');
  const src = t.readSource('js/app.js');
  // findSimilar anchors its popup to this class; the button lost it once and
  // "Similar" became a silent no-op on every card.
  t.ok(src.includes('.my-booking-card[data-id="${eventId}"] .find-similar-btn'), 'findSimilar looks its trigger up by .find-similar-btn');
  t.ok(/class="booking-action-btn find-similar-btn"[^>]*findSimilar\(/.test(src), 'renderMyBookings puts .find-similar-btn on the Similar button');
  t.ok(!/scrollToClass/.test(src) && !/scrollToClass/.test(t.readSource('types/globals.d.ts')), 'the stale scrollToClass handler is gone (card tap opens the class sheet)');
  t.ok(/my-booking-card" data-id="\$\{evtId\}"[^\n]*\n\s*onclick="openClassDetail\(\$\{evtId\}\)"/.test(src), 'booking card tap opens the class detail sheet');
  t.ok(/shareClass\(\$\{evtId\}\)/.test(src), 'shareClass has a caller again');
  // The sheet must never blind-call bookClass for a booked class (a no-layout
  // seat would be asked "Book another space?").
  t.ok(!/cds-book-btn booked" onclick="[^"]*bookClass\(/.test(src), "the sheet's booked button routes through _classDetailBookAction, not straight to bookClass");
  // A second 12h clock in changeSpot could refuse a swap the card still offers.
  const changeSpotSrc = sliceFn(src, 'window.changeSpot = async function(eventId) {', '};');
  t.ok(/_cancelDeadline\(evt\.start_at\)/.test(changeSpotSrc) && !/new Date\(evt\.start_at\) - new Date\(\)/.test(changeSpotSrc),
    'changeSpot gates on the same _cancelDeadline as the card that offered "Change spot"');

  // ── Time left: ONE rounding, shared by the countdown chip and the dialog ──
  // Each site floored the hour and rounded the leftover on its own, so the last
  // 30 seconds of any hour carried no further: "IN 9H 60M" on the card and
  // "starts in 9h 60m" in the copy that warns about a late-cancel charge.
  t.section('Bookings card: time left is rounded once (never "9h 60m")');
  {
    const SEC = 1 / 3600;
    const left = (h) => { const r = pure._hoursMinsLeft(h); return [r.hrs, r.mins]; };
    t.ok(typeof pure._hoursMinsLeft === 'function', 'pure:bookings-card exposes _hoursMinsLeft');
    t.eq(left(9 + 59 / 60 + 40 * SEC), [10, 0], '9h59m40s → 10h 0m (was 9h 60m)');
    t.eq(left(9 + 59 / 60 + 29 * SEC), [9, 59], '9h59m29s → 9h 59m (still rounds DOWN under the half minute)');
    t.eq(left(59 / 60 + 40 * SEC), [1, 0], '59m40s → 1h 0m (was 0h 60m)');
    t.eq([left(10), left(2.25), left(0.75), left(20 * SEC)], [[10, 0], [2, 15], [0, 45], [0, 0]], 'whole hours, 2h15m, 45m and 20s split as before');
    t.eq(left(-0.2), [0, 0], 'a class that has started never yields negative parts');
    const mins = [];
    for (let s = 0; s <= 13 * 3600; s += 7) mins.push(pure._hoursMinsLeft(s * SEC).mins);
    t.ok(mins.every((m) => m >= 0 && m <= 59), 'no instant in the next 13 hours prints a minute figure outside 0–59');

    // Both call sites must READ the helper — a private copy of the arithmetic is how they drifted.
    const countdownSrc = sliceFn(src, 'function getCountdownText(', '}');
    const confirmSrc = sliceFn(src, 'function confirmCancelWithPolicy(', '}');
    t.ok(/_hoursMinsLeft\(diffHours\)/.test(countdownSrc) && !/Math\.(floor|round)\(/.test(countdownSrc), 'getCountdownText splits the time through _hoursMinsLeft (no rounding of its own)');
    t.ok(/_hoursMinsLeft\(hoursUntil\)/.test(confirmSrc) && !/Math\.(floor|round)\(/.test(confirmSrc), 'confirmCancelWithPolicy splits the time through _hoursMinsLeft (no rounding of its own)');

    // The REAL getCountdownText. The chip is device-local (runner: New York).
    const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    const chipCtx = t.loadPure('js/app.js', 'bookings-card', { localDateStr: ymd });
    t.vm.runInContext(countdownSrc, chipCtx);
    const chip = (startAt, nowAt) => chipCtx.getCountdownText(new Date(startAt), new Date(nowAt));
    t.eq(chip('2026-09-17T18:00:00', '2026-09-17T08:00:20'), 'In 10h', 'chip, 9h59m40s to go: "In 10h" (was "In 9h 60m")');
    t.eq(chip('2026-09-17T18:00:00', '2026-09-17T17:00:20'), 'In 1h', 'chip, 59m40s to go: "In 1h" (was "In 60min")');
    t.eq([chip('2026-09-17T18:00:00', '2026-09-17T15:45:00'), chip('2026-09-17T18:00:00', '2026-09-17T17:15:00')], ['In 2h 15m', 'In 45min'], 'chip: ordinary times unchanged');
    t.eq([chip('2026-09-18T07:00:00', '2026-09-17T20:00:00'), chip('2026-09-19T07:00:00', '2026-09-17T20:00:00'), chip('2026-09-17T07:00:00', '2026-09-17T20:00:00')],
      ['Tomorrow 7:00am', null, null], 'chip: tomorrow, later and past classes unchanged');

    // The REAL confirmCancelWithPolicy, with the clock pinned (it asks _cancelDeadline for "now").
    const warnAt = (startAt, nowAt) => {
      const NOW = new Date(nowAt).getTime();
      class PinnedDate extends Date {
        constructor(...a) { if (a.length) super(...a); else super(NOW); }
        static now() { return NOW; }
      }
      let asked = null;
      const ctx = t.loadPure('js/app.js', 'bookings-card', {
        Date: PinnedDate,
        _eventCache: { 77: { start_at: startAt } },
        confirmModal: (opts) => { asked = opts; return Promise.resolve(false); },
      });
      t.vm.runInContext(confirmSrc, ctx);
      ctx.confirmCancelWithPolicy(77, 'Cancel this booking?');
      return asked && (asked.warn || null);
    };
    const CHARGED = ' Cancellations inside 12 hours are usually charged by Psycle.';
    // A zero minute part is dropped, as the chip does ("In 10h"): the two are read side by side.
    t.eq(warnAt('2026-09-18T06:00:00', '2026-09-17T20:00:20'), 'This class starts in 10h.' + CHARGED, 'dialog, 9h59m40s to go: "starts in 10h" (was "9h 60m", then "10h 0m")');
    t.eq(warnAt('2026-09-18T06:00:00', '2026-09-18T05:00:20'), 'This class starts in 1h.' + CHARGED, 'dialog, 59m40s to go: "starts in 1h" (was "60 min", then "1h 0m")');
    t.eq([warnAt('2026-09-18T06:00:00', '2026-09-17T23:30:00'), warnAt('2026-09-18T06:00:00', '2026-09-18T05:30:00'), warnAt('2026-09-18T06:00:00', '2026-09-18T05:59:50')],
      ['This class starts in 6h 30m.' + CHARGED, 'This class starts in 30 min.' + CHARGED, 'This class starts in 1 min.' + CHARGED], 'dialog: ordinary times unchanged, and the last seconds still read "1 min", never "0 min"');
    t.eq([warnAt('2026-09-18T06:00:00', '2026-09-18T06:10:00'), warnAt('2026-09-18T06:00:00', '2026-09-17T17:00:00')],
      ['This class has already started.' + CHARGED, null], 'dialog: a class that has started, and one 13h away (no warning), unchanged');
  }

  // ── Swipe-to-cancel: the REAL gesture (js/interactions.js, section B) ─────
  // It kept pointing at .upcoming-item / .up-cancel long after the cards stopped
  // carrying them — a dead gesture nothing noticed. Held here to the markup
  // renderMyBookings emits, then driven with scripted touches.
  t.section('Bookings card: swipe-to-cancel targets the markup renderMyBookings emits');
  {
    const isrc = t.readSource('js/interactions.js');
    const swipePure = t.loadPure('js/interactions.js', 'swipe-cancel');
    const konst = (name) => t.vm.runInContext(name, swipePure);
    const CARD = konst('SWIPE_CARD_SELECTOR'), BUTTON = konst('SWIPE_BUTTON_SELECTOR'), IGNORE = konst('SWIPE_IGNORE_SELECTOR');
    t.ok(!/upcoming-item|up-cancel/.test(isrc), 'interactions.js no longer looks for .upcoming-item / .up-cancel (no element carries them)');
    t.ok(CARD === '.my-booking-card' && /class="class-card [^"]*my-booking-card" data-id=/.test(src), 'the swiped element is the .my-booking-card renderMyBookings emits');
    // Which primary buttons a swipe may press: Cancel and Leave carry .booked, Claim (it BOOKS a seat) does not.
    const primaries = (src.match(/class="book-btn[^"]*mb-primary-btn" onclick="event\.stopPropagation\(\);\w+\(/g) || [])
      .map((m) => ({ booked: /\bbooked\b/.test(m), fn: /;(\w+)\($/.exec(m)[1] }));
    t.eq(primaries.filter((b) => b.booked).map((b) => b.fn).sort(), ['leaveWaitlist', 'upcomingCancel'], 'the .booked primary buttons are exactly Cancel booking and Leave waitlist');
    t.eq(primaries.filter((b) => !b.booked).map((b) => b.fn), ['claimWaitlistSpot'], '"Claim spot" is the one primary button without .booked…');
    t.ok(/^\.mb-primary-btn\.booked\b/.test(BUTTON), '…and the swipe only ever presses .mb-primary-btn.booked');
    IGNORE.split(',').map((x) => x.trim().slice(1)).forEach((cls) => t.ok(src.includes(cls), 'ignored control .' + cls + ' is still emitted by js/app.js'));
    t.ok(/\.my-booking-card \{[^}]*position: relative;/.test(t.readSource('css/styles.css')), 'the card is the containing block for the absolutely-positioned .swipe-cancel-bg');
    // The seat chips' × buttons are position:relative (tap targets): at z-index 0
    // they shared the fill's layer, came later in the tree and showed through it.
    const fillCss = t.readSource('css/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const fillZ = Number(((fillCss.match(/\.swipe-cancel-bg \{[^}]*\}/) || [''])[0].match(/z-index:\s*(\d+)/) || [])[1]);
    const popupZ = Number(((fillCss.match(/\n\.find-similar-popup \{[^}]*\}/) || [''])[0].match(/z-index:\s*(\d+)/) || [])[1]);
    t.ok(fillZ >= 1 && fillZ < popupZ, 'the Cancel fill paints over positioned card children (z-index ' + fillZ + ' ≥ 1) and still under the Similar popup (' + popupZ + ')');
    t.ok(!/\.my-booking-card \{[^}]*isolation:/.test(fillCss), '…without isolating the card (the next card would cover that popup)');

    t.eq([swipePure.swipeShouldCancel(-156, 390), swipePure.swipeShouldCancel(-155, 390)], [true, false], '40% of the card width is the cut-off');
    t.eq([swipePure.swipeShouldCancel(200, 390), swipePure.swipeShouldCancel(-200, 0)], [false, false], 'a rightward drag or an unmeasured card never cancels');
    t.eq([swipePure.swipeDirection(3, -3), swipePure.swipeDirection(-10, 4), swipePure.swipeDirection(4, -12)], [null, 'swipe', 'scroll'], 'direction: undecided under 5px, then sideways = swipe, vertical = scroll');

    // The whole section over a fake DOM. Timers run at once, so styles are read
    // mid-gesture (before touchend) and clicks after it.
    function swipeWorld(o) {
      o = o || {};
      const listeners = {};
      const node = () => ({ style: {}, className: '', textContent: '', kids: [], attrs: {}, appendChild(k) { this.kids.push(k); }, setAttribute(k, v) { this.attrs[k] = v; } });
      const btn = { isConnected: o.detached ? false : true, clicks: 0, click() { btn.clicks++; } };
      const card = {
        style: {}, offsetWidth: 390, bg: null, firstChild: null,
        classList: { contains: (c) => (o.classes || []).includes(c) },
        querySelector: (sel) => (sel === '.swipe-cancel-bg' ? card.bg : (sel === BUTTON && !o.noButton ? btn : null)),
        insertBefore: (n) => { card.bg = n; },
      };
      const ctx = t.vm.createContext({
        Math, setTimeout: (fn) => { fn(); return 0; },
        document: { addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }, createElement: node },
      });
      t.vm.runInContext(isrc.slice(isrc.indexOf('// B. Swipe-to-Cancel'), isrc.indexOf('// C. Filter Persistence')), ctx, { filename: 'js/interactions.js[swipe]' });
      const target = { closest: (sel) => (sel === IGNORE ? (o.onControl ? {} : null) : (sel === CARD ? card : null)) };
      const fire = (type, x, y, fingers) => (listeners[type] || []).forEach((fn) => fn({ target, touches: type === 'touchend' || type === 'touchcancel' ? [] : Array(fingers || 1).fill({ clientX: x, clientY: y }) }));
      return { card, btn, fire, listeners };
    }

    let sw = swipeWorld();
    t.ok(['touchstart', 'touchmove', 'touchend', 'touchcancel'].every((type) => (sw.listeners[type] || []).length === 1), 'one listener each for touchstart / touchmove / touchend / touchcancel');
    sw.fire('touchstart', 380, 300);
    t.eq([sw.card.bg, sw.card.style.animation], [null, undefined], 'a touch that has not moved leaves the card alone (a tap still opens the class sheet)');
    sw.fire('touchmove', 300, 302);
    t.eq([sw.card.style.transform, sw.card.style.transition], ['translateX(-80px)', 'none'], 'a left drag moves the card with the finger');
    t.eq(sw.card.style.animation, 'none', "the entry animation is switched off — its fill-mode 'both' outranks inline transform, the card would not move");
    t.eq([sw.card.bg && sw.card.bg.className, sw.card.bg && sw.card.bg.kids[0].textContent], ['swipe-cancel-bg', 'Cancel'], 'the Cancel layer is revealed inside the card');
    t.eq(sw.card.bg.attrs['aria-hidden'], 'true', 'the layer is decoration — a screen reader is not read a stray "Cancel" on every swiped card');
    sw.fire('touchmove', 180, 305);
    sw.fire('touchend');
    t.eq(sw.btn.clicks, 1, "a release past 40% presses the card's own Cancel button (→ upcomingCancel → the late-cancel confirm)");
    t.eq([sw.card.style.transform, sw.card.style.opacity, sw.card.style.transition], ['', '', ''], 'and the card is put back behind the dialog (declining leaves it as it was)');

    sw = swipeWorld();
    sw.fire('touchstart', 380, 300); sw.fire('touchmove', 280, 300); sw.fire('touchend');
    t.eq([sw.btn.clicks, sw.card.style.transform], [0, ''], 'a short swipe (100px of 390) snaps back without cancelling');

    sw = swipeWorld();
    sw.fire('touchstart', 380, 300); sw.fire('touchmove', 376, 360); sw.fire('touchmove', 100, 360); sw.fire('touchend');
    t.eq([sw.btn.clicks, sw.card.bg, sw.card.style.transform], [0, null, undefined], 'a vertical drag is a scroll: the gesture lets go for the rest of the touch');

    sw = swipeWorld();
    sw.fire('touchstart', 380, 300); sw.fire('touchmove', 100, 300); sw.fire('touchcancel');
    t.eq([sw.btn.clicks, sw.card.style.transform], [0, ''], 'a touch the system took over (touchcancel) never cancels, however far it had moved');

    sw = swipeWorld({ onControl: true });
    sw.fire('touchstart', 380, 300); sw.fire('touchmove', 100, 300); sw.fire('touchend');
    t.eq([sw.btn.clicks, sw.card.style.transform], [0, undefined], "a touch that starts on the card's own buttons / seat chips / Similar popup is theirs");

    sw = swipeWorld({ noButton: true }); // "Claim spot", a past class, or a button mid-request
    sw.fire('touchstart', 380, 300); sw.fire('touchmove', 100, 300); sw.fire('touchend');
    t.eq([sw.btn.clicks, sw.card.style.transform], [0, undefined], 'a card with no Cancel / Leave button to press does not swipe at all');

    sw = swipeWorld({ classes: ['is-waitlisted'] });
    sw.fire('touchstart', 380, 300); sw.fire('touchmove', 100, 300);
    t.eq(sw.card.bg.kids[0].textContent, 'Leave', 'a waitlist place reveals "Leave" (its button is Leave waitlist)');
    sw.fire('touchend');
    t.eq(sw.btn.clicks, 1, '…and presses it');

    sw = swipeWorld();
    sw.fire('touchstart', 380, 300, 2); sw.fire('touchmove', 100, 300, 2); sw.fire('touchend');
    t.eq(sw.btn.clicks, 0, 'a two-finger touch is not a swipe');

    sw = swipeWorld();
    sw.fire('touchstart', 380, 300); sw.fire('touchmove', 100, 300);
    sw.fire('touchstart', 200, 500, 2); // a second finger lands mid-swipe
    t.eq(sw.card.style.transform, '', 'a second finger mid-swipe puts the card back (it used to be left wherever the first finger had dragged it)');
    sw.fire('touchmove', 20, 300, 2); sw.fire('touchend');
    t.eq([sw.btn.clicks, sw.card.style.transform], [0, ''], '…and what is left of that touch neither moves nor cancels it');

    sw = swipeWorld({ detached: true });
    sw.fire('touchstart', 380, 300); sw.fire('touchmove', 100, 300); sw.fire('touchend');
    t.eq(sw.btn.clicks, 0, 'a button a refresh has since re-rendered away is never pressed');
  }

  // ── "↻ Similar": the REAL findSimilar / rebookNextWeek over a fake DOM ────
  // Top-level functions in app.js open at column 0 and close with a bare "}".
  function sliceFn(source, opener, closer) {
    const lines = source.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === closer);
    if (from === -1 || to === -1) throw new Error('bookings-card suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  }
  function fakeEl(extra) {
    const el = Object.assign({
      style: {}, dataset: {}, classes: [], listeners: {}, isConnected: false, parentElement: null, inside: [],
      classList: { add: (c) => el.classes.push(c) },
      addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
      appendChild(child) { child.isConnected = true; child.parentElement = el; },
      remove() { el.isConnected = false; },
      contains: (n) => n === el || el.inside.includes(n),
    }, extra || {});
    return el;
  }
  // A tap target: `within` lists the selectors target.closest() finds.
  const tapOn = (within) => ({ closest: (sel) => (within.includes(sel) ? {} : null) });
  const click = (target) => {
    const e = { target, stopped: false, prevented: false, stopPropagation() { e.stopped = true; }, preventDefault() { e.prevented = true; } };
    return e;
  };

  // One world per scenario: the member last tapped "Today" (or has an
  // instructor / studio filter on), then opens Similar on Tuesday's 7am class.
  function similarWorld(o) {
    o = o || {};
    const log = { calls: [], toasts: [], docClick: [] };
    const inputs = { startDate: { value: '' }, daysAhead: { value: '' } };
    const trigger = fakeEl();
    fakeEl().appendChild(trigger); // gives the trigger a parentElement (.booking-actions)
    let popup = null;
    const ctx = t.loadPure('js/app.js', 'bookings-card', {
      URLSearchParams,
      window: {},
      _eventCache: { 77: { start_at: '2026-09-22 07:00:00', instructor_id: 31, event_type_id: 7, studio_id: 4, _instrName: 'Alex', _typeName: o.typeName || 'Ride 45' } },
      _myBookings: { 77: { bookingId: 'A', slots: [7], slotBookings: { 7: 'A' }, waitlisted: false } },
      _studioMap: { 4: { location_id: 2 } },
      selectedInstructors: new Set(o.instructors || []),
      selectedLocations: new Set(o.locations || []),
      selectedCategories: new Set(o.categories || []),
      selectedStrengthSubs: new Set(o.strengthSubs || ['UPPER', 'LOWER', 'FULL']),
      selectedReformerSubs: new Set(o.reformerSubs || ['SIGNATURE', 'STRENGTH']),
      escapeHTML: (s) => String(s),
      localDateStr: (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'),
      toast: (msg) => log.toasts.push(msg),
      renderInstrChips: () => log.calls.push('chips'),
      updateFiltersSummary: () => log.calls.push('summary'),
      _syncFilterUI: () => log.calls.push('syncUI'),
      switchTab: (tab) => log.calls.push('tab:' + tab),
      search: () => log.calls.push('search'),
      requestAnimationFrame: () => 0,
      setTimeout: (fn) => { fn(); return 0; }, // the dismiss listener is armed 10ms later
      apiFetch: async () => ({ ok: true, json: async () => ({ data: o.events || [], relations: o.relations || {} }) }),
      document: {
        querySelector: (sel) => (sel === '.find-similar-popup' ? null : trigger),
        createElement: () => (popup = fakeEl()),
        getElementById: (id) => inputs[id],
        addEventListener: (type, fn, capture) => { if (type === 'click' && capture === true) log.docClick.push(fn); },
        removeEventListener: (type, fn) => { log.docClick = log.docClick.filter((f) => f !== fn); },
      },
    });
    // The REAL category map / sub-type list: what render() filters the alternatives by.
    t.vm.runInContext("var _dateQuickMode = 'today';\n" + sliceFn(src, 'const CATEGORY_MAP = [', '];') + '\n' + sliceFn(src, 'function getCategory(', '}') + '\n' +
      sliceFn(src, 'const REFORMER_SUBS = [', '];') + '\n' + sliceFn(src, 'async function rebookNextWeek(', '}') + '\n' +
      sliceFn(src, 'window.findSimilar = function(eventId) {', '};'), ctx);
    return {
      ctx, log, inputs, trigger,
      open() { ctx.window.findSimilar(77); return popup; },
      pick(action) {
        const e = click({ closest: () => ({ dataset: { action } }) });
        popup.listeners.click.forEach((fn) => fn(e));
        return e;
      },
    };
  }

  t.section('Find similar: a search it starts is never shrunk or mislabelled by a stale date preset');
  {
    let w = similarWorld({ instructors: ['99'] });
    w.open();
    w.pick('same-instructor');
    t.eq([w.inputs.daysAhead.value, w.ctx._dateQuickMode], [7, 'week'], '"Same instructor, any time": today + 7 days IS the week preset — the stale "today" mode is replaced');
    t.eq([...w.ctx.selectedInstructors], ['31'], 'filtered to that instructor only');
    t.ok(w.log.calls.indexOf('summary') !== -1 && w.log.calls.indexOf('summary') < w.log.calls.indexOf('search'), 'the filters summary is refreshed before the search (search() never does it)');
    t.ok(w.log.calls.indexOf('tab:discover') < w.log.calls.indexOf('search'), 'Discover is shown before the search runs');

    w = similarWorld();
    w.open();
    w.pick('same-time');
    t.eq([w.inputs.daysAhead.value, w.ctx._dateQuickMode], [8, null], '"Same time, any instructor": an 8-day custom range carries NO preset');
    t.ok(w.log.calls.includes('summary'), 'summary refreshed for the custom range too');
  }

  t.section('Find similar: "Same class next week" with no exact match shows its alternatives');
  {
    // Next Tuesday: same class type at 08:00 with someone else — inside the 2h "similar" band.
    const w = similarWorld({ instructors: ['31'], locations: ['5'], events: [{ id: 9002, event_type_id: 7, instructor_id: 99, studio_id: 4, start_at: '2026-09-29 08:00:00' }] });
    await w.ctx.rebookNextWeek(77);
    t.eq([w.inputs.startDate.value, w.inputs.daysAhead.value, w.ctx._dateQuickMode], ['2026-09-29', 1, null], 'one picked day, no preset mode');
    t.eq([...w.ctx.selectedInstructors], [], 'the instructor filter is cleared — the alternatives are other instructors');
    t.eq([...w.ctx.selectedLocations].sort(), ['2', '5'], "an active studio filter gains the class's own location instead of hiding it");
    const iTab = w.log.calls.indexOf('tab:discover'), iSearch = w.log.calls.indexOf('search');
    t.ok(iTab !== -1 && iTab < iSearch, 'switches to Discover BEFORE searching (the results used to fill a hidden tab)');
    t.ok(w.log.calls.indexOf('syncUI') !== -1 && w.log.calls.indexOf('syncUI') < iSearch, 'chips, pills and summary are re-synced first');
    t.ok(/showing alternatives/.test(w.log.toasts.join('|')), 'and only then says so');
    // The day is said the way the date pill says it, not as the raw search value.
    t.ok(/alternatives for Tue,? 29 Sept?$/.test(w.log.toasts.join('|')) && !/\d{4}-\d{2}-\d{2}/.test(w.log.toasts.join('|')),
      'the toast names the day as "Tue 29 Sep(t)", never "2026-09-29" (got: ' + w.log.toasts.join('|') + ')');

    const none = similarWorld({ locations: [] , events: [{ id: 9003, event_type_id: 7, instructor_id: 99, studio_id: 4, start_at: '2026-09-29 08:00:00' }] });
    await none.ctx.rebookNextWeek(77);
    t.eq([...none.ctx.selectedLocations], [], 'no studio filter on → none is invented');
    t.eq([...none.ctx.selectedCategories], [], 'no class-type filter on → none is invented');

    // Discover's saved filter is "Strength"; the booking being repeated is a Ride.
    const alt = [{ id: 9004, event_type_id: 7, instructor_id: 99, studio_id: 4, start_at: '2026-09-29 08:00:00' }];
    let c = similarWorld({ categories: ['STRENGTH'], strengthSubs: ['UPPER'], reformerSubs: ['SIGNATURE'], events: alt });
    await c.ctx.rebookNextWeek(77);
    t.eq([...c.ctx.selectedCategories].sort(), ['RIDE', 'STRENGTH'], "an active class-type filter gains the class's own category (render() dropped every alternative the toast announced)");
    t.eq([[...c.ctx.selectedStrengthSubs].sort(), [...c.ctx.selectedReformerSubs].sort()], [['FULL', 'LOWER', 'UPPER'], ['SIGNATURE', 'STRENGTH']],
      'sub-type filters go back to "all" — a variant left narrowed hides same-type alternatives the same way');
    t.ok(c.log.calls.indexOf('syncUI') !== -1 && c.log.calls.indexOf('syncUI') < c.log.calls.indexOf('search'), 'and the pills are re-synced before the search');
    // The cached name is only the 'Class' placeholder: the response names the type.
    c = similarWorld({ categories: ['STRENGTH'], typeName: 'Class', events: alt, relations: { event_types: [{ id: 7, name: 'REFORMER: Signature 55' }] } });
    await c.ctx.rebookNextWeek(77);
    t.eq([...c.ctx.selectedCategories].sort(), ['PILATES', 'STRENGTH'], "the type is read from the response's relations, not the cached placeholder");
    c = similarWorld({ categories: ['STRENGTH'], typeName: 'Class', events: alt });
    await c.ctx.rebookNextWeek(77);
    t.eq([...c.ctx.selectedCategories], ['STRENGTH'], 'type unknown (placeholder only) → no category is guessed');
  }

  t.section('Find similar: the tap that dismisses the popup does nothing else');
  {
    let w = similarWorld();
    let popup = w.open();
    t.eq(w.log.docClick.length, 1, 'an outside-click listener is armed (capture phase, ahead of any inline onclick)');
    const dismiss = w.log.docClick[0];

    let e = click(popup);
    dismiss(e);
    t.eq([popup.isConnected, e.stopped, w.log.docClick.length], [true, false, 1], 'a tap inside the popup is left to the popup');
    e = click(w.trigger);
    dismiss(e);
    t.eq([popup.isConnected, e.stopped], [true, false], 'so is a tap on the Similar button that opened it');

    e = click(tapOn(['.my-booking-card']));
    dismiss(e);
    t.eq([popup.isConnected, e.stopped, e.prevented], [false, true, true], 'a tap on a card closes the popup and is swallowed — no class sheet, no Cancel dialog');
    t.eq(w.log.docClick.length, 0, 'and the listener is gone');

    w = similarWorld();
    popup = w.open();
    e = click(tapOn(['.my-booking-card', '.find-similar-btn']));
    w.log.docClick[0](e);
    t.eq([popup.isConnected, e.stopped], [false, false], "another card's Similar button still works in one tap (it opens that card's popup)");

    w = similarWorld();
    popup = w.open();
    e = click(tapOn(['.tab-bar']));
    w.log.docClick[0](e);
    t.eq([popup.isConnected, e.stopped], [false, false], 'a tap outside the cards (the tab bar) dismisses and still goes through');

    // The regression a plain "always swallow" has: picking an option closes the
    // popup but leaves the listener armed — the member's NEXT tap, on a
    // Discover result, must not be eaten.
    w = similarWorld();
    popup = w.open();
    e = w.pick('same-time');
    t.ok(e.stopped && !popup.isConnected, 'picking an option closes the popup (its own tap never reaches the card)');
    e = click(tapOn(['.my-booking-card']));
    (w.log.docClick[0] || (() => {}))(e);
    t.eq([e.stopped, e.prevented, w.log.docClick.length], [false, false, 0], 'the next tap after an option was picked goes through, and the listener is removed');
  }

  // ════════════════════════════════════════════════════════════════════
  t.section('Day groups: keyed by the date, whichever form start_at takes');
  {
    // start_at arrives as 'YYYY-MM-DDTHH:MM:SS' or 'YYYY-MM-DD HH:MM:SS'.
    // split('T')[0] keeps the WHOLE space-form string: one group per class,
    // each headed "Invalid Date" (the header is new Date(key + 'T12:00:00')).
    const src = t.readSource('js/app.js');
    t.eq((src.match(/start_at\.split\('T'\)\[0\]/g) || []).length, 0, "no day key is cut at 'T' any more");
    const keys = src.match(/const day = String\([\w.]*start_at\)\.slice\(0, 10\);/g) || [];
    t.eq(keys.length, 2, 'Discover results and My Bookings both key their day groups on the first 10 characters');
    const header = (startAt) => new Date(String(startAt).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    t.eq([header('2026-09-17T18:30:00'), header('2026-09-17 18:30:00')], ['17 September', '17 September'], 'both forms land in the same, valid day group');
  }
};
