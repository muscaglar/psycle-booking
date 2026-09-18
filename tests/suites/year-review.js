'use strict';
// Year in review (Stats → "See your 2026 wrap" → the share image). History
// holds a booking from the moment it is made, so the wrap counted next week's
// classes as taken: '3 classes', 'Longest streak 3 weeks' and a share image
// reading "3 CLASSES TAKEN" for a member who had taken one. Runs the pure row
// filter (pure:year-review in js/tabs.js) and the REAL _computeYearReview,
// sliced out of source, over the real London resolver (pure:gym-time, app.js).
module.exports = async function (t) {
  const { ok, eq } = t;
  const src = t.readSource('js/tabs.js');
  // tabs.js is one IIFE: its functions sit at two spaces and close on '  }'.
  const grab = (opener) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === '  }');
    if (from === -1 || to === -1) throw new Error('year-review suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };

  // The runner's zone is New York; h.date is London wall clock.
  const london = t.loadPure('js/app.js', 'gym-time')._gymClassStartMs;
  const naive = (s) => Date.parse(String(s).replace(' ', 'T')); // what a device-local parse would say
  // Fri 18 Sep 2026, 18:30 in London (BST) = 17:30 UTC = 13:30 in New York.
  const NOW = Date.UTC(2026, 8, 18, 17, 30);
  const row = (id, date, o) => Object.assign({ eventId: String(id), typeName: 'Ride', instrName: 'Alex', locName: 'Bank', date, slots: [12] }, o || {});
  const ids = (rows) => rows.map((h) => h.eventId);

  const p = t.loadPure('js/tabs.js', 'year-review');

  t.section('Year in review: only classes that have started are counted');
  ok(typeof p._yearReviewRows === 'function', 'pure:year-review exposes _yearReviewRows');
  {
    const history = [
      row(3, '2026-09-29 07:00:00', { instrName: 'Blake' }), // next week, booked
      row(2, '2026-09-22 07:00:00', { instrName: 'Blake' }), // next week, booked
      row(1, '2026-09-10 07:00:00'),                         // taken
      row(4, '2026-09-11 07:00:00', { cancelledAt: '2026-09-09T10:00:00.000Z' }),
      row(5, '2025-09-10 07:00:00'),                         // last year
      row(6, ''),                                            // no date at all
    ];
    eq(ids(p._yearReviewRows(history, 2026, NOW, london)), ['1'], 'one class taken + two still to come → ONE (it counted all three)');
    eq(ids(p._yearReviewRows(history, 2025, NOW, london)), ['5'], "last year's wrap is last year's rows");
    eq(history.length, 6, 'the shared history array is filtered, never edited (getFullHistory hands every section the same one)');
  }
  {
    // 18:00 London today: started half an hour ago. Read device-locally in New
    // York that is 18:00 EDT = 23:00 London — "still to come" for another 4.5h.
    const history = [row(7, '2026-09-18 18:00:00'), row(8, '2026-09-18 19:00:00')];
    eq(ids(p._yearReviewRows(history, 2026, NOW, london)), ['7'], 'London wall clock decides: the 18:00 has started, the 19:00 has not');
    eq(ids(p._yearReviewRows(history, 2026, NOW, naive)), [], '…which a device-local parse gets wrong abroad (why the resolver is handed in)');
    eq(ids(p._yearReviewRows([row(9, '2026-09-18 18:30:00')], 2026, NOW, london)), ['9'], 'a class starting this minute counts');
  }
  eq(ids(p._yearReviewRows([row(10, '2026-garbage')], 2026, NOW, london)), ['10'], 'a date nothing can place is not provably ahead: kept, as before');
  eq(p._yearReviewRows([], 2026, NOW, london), [], 'no history → no rows');

  // ── The real _computeYearReview over those rows ──────────────────────────
  function world(history, o) {
    o = o || {};
    class FixedDate extends Date {
      constructor(...a) { if (a.length) super(...a); else super(NOW); }
      static now() { return NOW; }
    }
    const globals = {
      Date: FixedDate, getFullHistory: () => history,
      DAY_NAMES_FULL: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    };
    if (!o.noAppJs) globals._gymClassStartMs = london;
    const ctx = t.loadPure('js/tabs.js', 'year-review', globals);
    t.vm.runInContext(grab('  function _weekIndex(') + '\n' + grab('  function _computeYearReview('), ctx);
    return ctx;
  }

  t.section('Year in review: the summary the button, the modal and the share image all read');
  {
    // The verifier's scenario: ONE past class; /bookings adds two upcoming ones.
    const history = [row(3, '2026-09-29 07:00:00', { instrName: 'Blake' }), row(2, '2026-09-22 07:00:00', { instrName: 'Blake' }), row(1, '2026-09-10 07:00:00')];
    const s = world(history)._computeYearReview(2026);
    eq([s.total, s.uniqueInstrs, s.longestStreak, s.topInstr, s.topInstrCount], [1, 1, 1, 'Alex', 1],
      '"1 class · 1 instructor", a 1-week streak, top instructor from a class TAKEN (it read 3 · 2 · 3 weeks · Blake)');
    eq(world(history.slice(0, 2))._computeYearReview(2026), null, 'nothing taken yet this year → no wrap (the section hides; "No classes this year yet")');
    const back = world(history, { noAppJs: true })._computeYearReview(2026);
    eq(back && back.total, 1, 'without app.js the device-local parse is the fallback, not a ReferenceError');
  }
  {
    // Three taken in three consecutive weeks + one booked for the next: the
    // streak is what has happened.
    const history = [row(14, '2026-09-24 07:00:00'), row(13, '2026-09-16 07:00:00'), row(12, '2026-09-09 07:00:00'), row(11, '2026-09-02 07:00:00')];
    const s = world(history)._computeYearReview(2026);
    eq([s.total, s.longestStreak], [3, 3], "next week's booking neither counts nor extends the streak");
  }
};
