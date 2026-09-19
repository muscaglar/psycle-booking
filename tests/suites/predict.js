'use strict';
// "Book again?" (js/app.js pure:predict + its two callers). features.js writes a
// class into psycle_class_history the moment it is BOOKED, so the hint used to
// count next Tuesday's booking as attendance — its score went UP — and sat
// above that very booking in My Bookings for good. History dates are naive
// wall-clock strings read device-locally (the runner is America/New_York), and
// so is everything here.
module.exports = function (t) {
  const appSrc = t.readSource('js/app.js');
  const P = t.loadPure('js/app.js', 'predict');
  // Thursday 17 Sept 2026, 10:00 on the device.
  const NOW = new Date(2026, 8, 17, 10, 0, 0).getTime();
  let seq = 0;
  const row = (date, typeName, instrName, extra) => Object.assign({ eventId: String(++seq), typeName, instrName, locName: 'Bank', date, slots: [] }, extra || {});
  const held = (start_at, typeName, instrName) => ({ id: ++seq, start_at, _typeName: typeName, _instrName: instrName });
  const TUE = [row('2026-09-08 07:00:00', 'RIDE 45', 'Alice'), row('2026-09-15 07:00:00', 'RIDE 45', 'Alice')];
  const THU = [row('2026-09-03 18:00:00', 'STRENGTH: Full Body', 'Bob'), row('2026-09-10 18:00:00', 'STRENGTH: Full Body', 'Bob')];
  const NEXT_TUE = '2026-09-22 07:00:00';
  const predict = (history, heldEvents, maps) => P._predictFrom(history, heldEvents || [], NOW, (maps || {}).types, (maps || {}).instrs);

  t.section('Book again: the habit itself (js/app.js pure:predict)');
  t.ok(typeof P._predictFrom === 'function', 'the pure:predict region defines _predictFrom');
  let p = predict(TUE, [], { types: { 'ride 45': 7 }, instrs: { alice: 31 } });
  t.eq([p.label, p.dayOfWeek, p.hour, p.minute, p.daysUntil, p.count, p.eventTypeId, p.instructorId],
    ['RIDE 45 · Alice', 2, 7, 0, 5, 2, 7, 31], 'two past Tuesdays at 7:00 → "RIDE 45 · Alice", next Tuesday, ids resolved by name');
  t.eq(predict([TUE[0]]), null, 'one class is not a habit');
  t.eq(predict(null), null, 'no history: null, no throw');
  t.eq(predict([row('2026-09-08 07:00:00', 'RIDE 45', 'Alice'), row('2026-09-15 07:00:00', 'RIDE 45', 'Alice', { cancelledAt: '2026-09-14T09:00:00Z' })]), null,
    'a cancelled class never counted, as before');
  t.eq(predict(TUE).instructorId, null, 'a name /instructors does not list resolves to null (bookPrediction then narrows by class type)');

  t.section('Book again: a booking is not attendance');
  {
    const booked = [row(NEXT_TUE, 'RIDE 45', 'Alice')].concat(TUE); // what features.js wrote at booking time
    const before = predict(TUE), after = predict(booked);
    t.eq([after.count, after.score], [before.count, before.score], "next Tuesday's booking no longer raises the count or the score (it went 7.4 → 9.8)");
    t.eq(predict([row(NEXT_TUE, 'RIDE 45', 'Alice'), row('2026-09-29 07:00:00', 'RIDE 45', 'Alice')]), null,
      'two FUTURE bookings with zero attendance are not "You usually go…"');
    t.eq(predict([row('2026-09-17 18:00:00', 'RIDE 45', 'Alice'), row('2026-09-10 18:00:00', 'RIDE 45', 'Alice')]), null,
      "this evening's class has not happened yet either");
  }

  t.section('Book again: never for the class already booked');
  {
    const booked = [row(NEXT_TUE, 'RIDE 45', 'Alice')].concat(TUE);
    t.eq(predict(booked, [held(NEXT_TUE, 'RIDE 45', 'Alice')]), null, 'next Tuesday 7:00 is held → no hint (it sat right above that booking)');
    p = predict(booked.concat(THU), [held(NEXT_TUE, 'RIDE 45', 'Alice')]);
    t.eq([p && p.label, p && p.dayOfWeek], ['STRENGTH: Full Body · Bob', 4], '…and the next-best habit gets the hint instead');
    t.eq(predict(TUE.concat([row(NEXT_TUE, 'RIDE 45', 'Alice', { cancelledAt: '2026-09-17T09:00:00Z' })]), []).label, 'RIDE 45 · Alice',
      'the booking was cancelled (no seat held, history row marked) → the hint comes back');
    t.eq(predict(TUE, [held('2026-09-22 07:15:00', 'RIDE 45', 'Alice')]), null,
      'a 7:15 start is the same class: compared within 30 minutes of the average, not by half-hour bucket (7:15 rounds to 7:30)');
    t.eq(predict(TUE, [held('2026-09-22T07:00:00', 'RIDE 45', 'Alice')]), null, 'the T-form start_at reads the same');
    t.eq(predict(TUE, [held('2026-09-22 08:00:00', 'RIDE 45', 'Alice')]).label, 'RIDE 45 · Alice', 'an hour later is another class: the hint stays');
    t.eq(predict(TUE, [held('2026-09-22 07:00:00', 'RIDE 45', 'Carol')]).label, 'RIDE 45 · Alice', "someone else's 7:00 is not Alice's");
    t.eq(predict(TUE, [held('2026-09-29 07:00:00', 'RIDE 45', 'Alice')]).label, 'RIDE 45 · Alice',
      'only the NEXT occurrence counts — the Tuesday after is booked, the one "Find it" opens is not');
    t.eq(predict(TUE, [held('2026-09-22 07:00:00', 'RIDE: 45', 'Alice')]), null, 'a renamed class type does not bring it back: one instructor teaches one class at a time');
    const anon = [row('2026-09-08 07:00:00', 'RIDE 45', ''), row('2026-09-15 07:00:00', 'RIDE 45', '')];
    t.eq([predict(anon, [held(NEXT_TUE, 'RIDE 45', '')]), predict(anon, [held(NEXT_TUE, 'YOGA', '')]).label], [null, 'RIDE 45'],
      'a history that names nobody is matched on the class type instead');
    t.eq(predict(TUE, [{ start_at: 'nonsense' }, null, {}]).label, 'RIDE 45 · Alice', 'unreadable held rows are ignored');
  }

  // The wrapper the three callers use: reads the stores, hands over the seats.
  t.section('Book again: predictNextClass() reads the seats actually held');
  {
    const grab = (opener) => {
      const lines = appSrc.split('\n');
      const from = lines.findIndex((l) => l.startsWith(opener));
      const to = lines.findIndex((l, i) => i > from && l === '}');
      if (from === -1 || to === -1) throw new Error('predict suite: cannot slice "' + opener + '" (anchor moved?)');
      return lines.slice(from, to + 1).join('\n');
    };
    class FakeDate extends Date {
      constructor(...a) { if (a.length) super(...a); else super(NOW); }
      static now() { return NOW; }
    }
    const world = (bookings) => {
      const ctx = t.loadPure('js/app.js', 'predict', {
        Date: FakeDate,
        localStorage: { getItem: () => JSON.stringify([row(NEXT_TUE, 'RIDE 45', 'Alice')].concat(TUE)) },
        eventTypes: [{ id: 7, name: 'RIDE 45' }], instructors: [{ id: 31, full_name: 'Alice' }],
        _myBookings: bookings,
        _eventCache: { 900: held(NEXT_TUE, 'RIDE 45', 'Alice') },
      });
      t.vm.runInContext(grab('function predictNextClass() {'), ctx, { filename: 'js/app.js[predictNextClass]' });
      return ctx;
    };
    t.eq(world({ 900: { bookingId: 'A', slots: [5], waitlisted: false } }).predictNextClass(), null, 'a held seat for next Tuesday → no hint');
    p = world({ 900: { bookingId: null, slots: [], waitlisted: true } }).predictNextClass();
    t.eq([p && p.label, p && p.instructorId, p && p.eventTypeId], ['RIDE 45 · Alice', 31, 7], 'a WAITLIST place is no seat: the class is still worth finding');
    t.eq(world({}).predictNextClass().label, 'RIDE 45 · Alice', 'nothing held → the hint');
    t.eq(world({ 123: { bookingId: 'B', slots: [1] } }).predictNextClass().label, 'RIDE 45 · Alice', 'a booking whose class is not in the cache is skipped, not thrown on');

    // The hint waits for /bookings: painted 1.2s after launch it knew no seats.
    const hint = (state) => {
      const made = { predicted: 0, built: 0 };
      const ctx = t.vm.createContext({
        document: { getElementById: () => null, createElement: () => { made.built++; return {}; } },
        currentUser: { id: 1 }, _bookingsLoadState: state, escapeHTML: String,
        _clock24: t.loadPure('js/app.js', 'clock')._clock24, // "You usually go Tuesdays at 07:00"
        predictNextClass: () => { made.predicted++; return { label: 'RIDE 45 · Alice', dayOfWeek: 2, hour: 7, minute: 0 }; },
      });
      t.vm.runInContext(grab('function renderRebookHint() {'), ctx, { filename: 'js/app.js[renderRebookHint]' });
      ctx.renderRebookHint();
      return made;
    };
    t.eq([hint('pending'), hint('failed')], [{ predicted: 0, built: 0 }, { predicted: 0, built: 0 }], 'renderRebookHint shows nothing until the bookings list has loaded');
    t.eq(hint('loaded'), { predicted: 1, built: 1 }, '…and renders once it has (bookings:loaded calls it again)');
    t.ok(/\['bookings:loaded', 'booking:complete', 'booking:cancelled'\]\.forEach\(evt => \{\s*try \{ PsycleEvents\.on\(evt, \(\) => \{ try \{ renderRebookHint\(\);/.test(appSrc),
      'the hint is still re-rendered on bookings:loaded / booking:complete / booking:cancelled');
  }
};
