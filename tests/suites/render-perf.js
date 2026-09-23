'use strict';
// Wave 6 render-perf: work that used to be redone for nothing, outside the
// Discover list. Everything here drives the SHIPPED code, sliced out of source:
//   · My Bookings' last step (_commitBookingsHtml) behind the REAL renderMyBookings
//   · the minute tick's chip text + flip test
//   · Stats' memoised history parse (js/tabs.js) and the routine section
//   · the history modal's chunking (js/features.js)
//   · the explore sections' one-door write and the sync banner (js/explore.js)
module.exports = function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const grab = (source, opener, closer) => {
    const lines = source.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (from === -1 || to === -1) throw new Error('render-perf suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };
  const pureRegion = (src, name) => {
    const s = src.indexOf('// ── pure:' + name + ':start'), e = src.indexOf('// ── pure:' + name + ':end');
    if (s === -1 || e === -1) throw new Error('render-perf suite: pure:' + name + ' markers moved');
    return src.slice(s, e);
  };
  const noComments = (code) => code.replace(/\/\/.*$/gm, ''); // the comments say what the code no longer does
  const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // The helpers + the REAL chip text they call, in one context.
  const perfWorld = (extra) => {
    const ctx = t.loadPure('js/app.js', 'bookings-card', Object.assign({ localDateStr: ymd, window: {} }, extra || {}));
    t.vm.runInContext('let _gymDayFmt = null;\n' + grab(appSrc, 'function _gymDayKey(') + '\n' + grab(appSrc, 'function getCountdownText(') + '\n' +
      pureRegion(appSrc, 'render-perf'), ctx, { filename: 'js/app.js[render-perf]' });
    return ctx;
  };

  // ── The chip the minute tick rewrites ────────────────────────────────────
  t.section('Minute tick: the countdown chip is re-read from data-start, built as the card builds it');
  {
    const w = perfWorld();
    const START = '2026-09-17T18:00:00';
    const at = (msBefore) => new Date(START).getTime() - msBefore;
    eq(w._countdownChipText(START, at(61 * 60000)), 'In 1h 1m', '61 minutes out');
    eq(w._countdownChipText(START, at(60 * 60000)), 'In 1h', '60 minutes out: "In 1h", never "In 1h 0m"');
    eq(w._countdownChipText(START, at(59 * 1000)), 'In 1 min', '59 seconds out: "In 1 min"');
    eq(w._countdownChipText(START, at(29 * 1000)), 'Starting now', 'the last half minute: "Starting now", never "In 0 min"');
    eq(w._countdownChipText(START, at(-1000)), null, 'started: no text (that card is the flip re-render\'s job)');
    eq(w._countdownChipText('2026-09-17 18:00:00', at(61 * 60000)), 'In 1h 1m', 'the space form of start_at reads the same');
    eq(w._countdownChipText('not a date', at(0)), null, 'an unreadable data-start is left alone');
    eq(w._countdownChipText('2026-09-18T07:00:00', new Date('2026-09-17T20:00:00').getTime()), 'Tomorrow 07:00', 'tomorrow keeps the class\'s own wall-clock time');

    const chips = [
      { textContent: 'In 1h 10m', getAttribute: () => START },
      { textContent: 'In 40 min', getAttribute: () => START },
      { textContent: 'In 5 min', getAttribute: () => '2026-09-17T12:00:00' },
    ];
    const writes = [];
    chips.forEach((c, i) => { let v = c.textContent; Object.defineProperty(c, 'textContent', { get: () => v, set: (x) => { v = x; writes.push(i); } }); });
    w._tickCountdownChips({ querySelectorAll: (sel) => (sel === '.mb-countdown[data-start]' ? chips : []) }, at(40 * 60000));
    eq([chips[0].textContent, chips[1].textContent, chips[2].textContent], ['In 40 min', 'In 40 min', 'In 5 min'], 'a stale chip is corrected in place; a started class keeps its last text until its card is rebuilt');
    eq(writes, [0], 'a chip that already reads right is not written to (no DOM churn every minute)');
  }

  t.section('Minute tick: a list is only rebuilt when a card changed by itself');
  {
    const w = perfWorld();
    eq(w._anyInstantBetween([1000], 999, 1000), true, 'an instant that has just passed counts (since < t <= now)');
    eq(w._anyInstantBetween([1000], 1000, 2000), false, '…once: not again on the next tick');
    eq(w._anyInstantBetween([3000], 1000, 2000), false, 'still ahead: nothing to do');
    eq(w._anyInstantBetween([NaN, null, undefined, '1500'], 1000, 2000), false, 'unreadable instants are skipped, never a rebuild every minute');
    eq(w._anyInstantBetween([NaN, 1500], 1000, 2000), true, '…without hiding a real one beside them');
    const tick = appSrc.slice(appSrc.indexOf('function _minuteTick()'), appSrc.indexOf('document.addEventListener(\'visibilitychange\', _armMinuteTick);'));
    ok(/if \(document\.hidden\) return;/.test(tick) && /clearInterval\(_minuteTimer\)/.test(tick), 'the tick does nothing on a hidden page, and its timer is stopped there');
    ok(/list\.firstChild !== list\._mbFirst\) return;/.test(tick), 'it only touches cards renderMyBookings put up (never the skeleton, the saved copy, the empty list)');
    ok(/_bookingsFlipDue\(list\._mbAt, nowMs\) && !_bookingsListBusy\(list\)\) renderMyBookings\(\);/.test(tick), 'a rebuild needs a flip AND a list nobody is using');
    const busy = grab(appSrc, 'function _bookingsListBusy(');
    ok(/_dialogOpen\(\)/.test(busy) && /\.find-similar-popup/.test(busy) && /style\.transform/.test(busy) && /\.some\(_mbInFlight\)/.test(busy),
      '"in use" = a dialog / the picker, the Similar popup, a card mid-swipe, a button waiting on Psycle');
    const label = grab(appSrc, 'function _tickLastUpdated(');
    ok(/nodeValue/.test(label) && !/innerHTML/.test(label) && !/renderFromWindow|_renderWindowInPlace/.test(tick + label),
      '"Updated 3m ago" is a text-node swap: the Refresh button is not rebuilt and Discover\'s list is never re-rendered from here');
    ok(/_minuteTimer = setInterval\(_minuteTick, 60000\);/.test(tick) && (appSrc.match(/setInterval\(_minuteTick/g) || []).length === 1, 'one 60-second timer drives all of it');
  }

  // ── My Bookings: the last step ───────────────────────────────────────────
  // A list node that counts real writes. `firstChild` is a new object per
  // write (as in a browser), and the buttons / chips / sections are re-read
  // out of the HTML that was written.
  const makeList = () => {
    const list = { writes: 0, attrs: {}, offsetParent: {}, firstChild: null, _html: '', nodes: { button: [], chip: [], section: [] } };
    list.toggleAttribute = (n, on) => { if (on) list.attrs[n] = ''; else delete list.attrs[n]; };
    list.querySelectorAll = (sel) => {
      if (sel === 'button') return list.nodes.button;
      if (sel === '.mb-countdown[data-start]') return list.nodes.chip;
      if (sel === '.mb-period-section') return list.nodes.section;
      throw new Error('unexpected selector ' + sel);
    };
    Object.defineProperty(list, 'innerHTML', {
      get: () => list._html,
      set: (v) => {
        list.writes++;
        list._html = v;
        list.firstChild = v ? {} : null;
        const all = (re, mk) => { const out = []; let m; while ((m = re.exec(v))) out.push(mk(m)); return out; };
        list.nodes = {
          button: all(/<button([^>]*)>([^<]*)<\/button>/g, (m) => ({ className: (/class="([^"]*)"/.exec(m[1]) || [])[1] || '', textContent: m[2].replace(/&times;/g, '×'), disabled: false, dataset: {} })),
          chip: all(/<span\b[^>]*class="mb-countdown"[^>]*data-start="([^"]*)"[^>]*>([^<]*)<\/span>/g, (m) => ({ textContent: m[2], getAttribute: () => m[1] })),
          // Each section carries its bar, fresh from the markup: aria-expanded="true".
          section: all(/<div class="mb-period-section">/g, () => {
            const c = new Set(), attrs = { 'aria-expanded': 'true' };
            const bar = { getAttribute: (n) => attrs[n], setAttribute: (n, v) => { attrs[n] = String(v); } };
            return { classList: { contains: (x) => c.has(x), add: (x) => c.add(x) }, querySelector: (sel) => (sel === '.mb-period-bar' ? bar : null) };
          }),
        };
      },
    });
    return list;
  };

  t.section('My Bookings: the same list is not written twice');
  {
    const w = perfWorld();
    const A = '<div class="mb-day-group"><span class="mb-countdown" data-start="2026-09-17T18:00:00">In 3h</span><button class="book-btn booked mb-primary-btn" onclick="x()">Cancel booking</button><button class="booking-action-btn" onclick="y()">+ Add spot</button></div>';
    const NOW = new Date('2026-09-17T15:00:00').getTime();
    eq(w._bookingsHtmlKey(A), A.replace('>In 3h<', '><'), 'the comparison key drops the countdown text and nothing else');
    eq(w._bookingsHtmlKey(A.replace('In 3h', 'In 2h 59m')), w._bookingsHtmlKey(A), 'two builds a minute apart are the same list');
    eq(w._bookingsHtmlKey('<span role="img" class="mb-countdown" aria-label="x" data-start="s">In 3h</span><span class="badge">45min</span>'),
      '<span role="img" class="mb-countdown" aria-label="x" data-start="s"></span><span class="badge">45min</span>', 'more attributes on the chip (another wave\'s a11y pass) do not defeat the key; other badges keep their text');

    let list = makeList();
    eq([w._commitBookingsHtml(list, A, NOW), list.writes], [true, 1], 'first build: written');
    eq([w._commitBookingsHtml(list, A, NOW), list.writes], [false, 1], 'the same HTML again (/profile landing after /bookings): the DOM is left alone');
    eq(list._mbAt, NOW, '…and the list is still stamped as right as of now');
    eq([w._commitBookingsHtml(list, A.replace('In 3h', 'In 2h 59m'), NOW + 60000), list.writes, list.nodes.chip[0].textContent], [false, 1, 'In 2h 59m'],
      'only the countdown moved on: no rebuild — the chip is corrected in place');
    eq([w._commitBookingsHtml(list, A.replace('Cancel booking', 'Cancel all 2'), NOW), list.writes], [true, 2], 'a real change is written');
    ok('data-quiet' in list.attrs, '…quietly: cards replacing cards in front of the member do not replay their entrance');

    // Skeleton / saved copy / empty branch write the node themselves.
    list = makeList();
    w._commitBookingsHtml(list, A, NOW);
    list.innerHTML = '<div class="mb-skeleton"></div>'; // showBookingSkeleton
    const before = list.writes;
    eq([w._commitBookingsHtml(list, A, NOW), list.writes - before], [true, 1], 'after the skeleton (or the saved copy) the same HTML IS written: what is up is no longer ours');
    ok(!('data-quiet' in list.attrs), '…with its entrance: skeleton → cards is a first paint');
    list.innerHTML = ''; // the empty branch
    eq(w._commitBookingsHtml(list, A, NOW), true, 'and after the empty branch');

    // A rebuild in a hidden tab keeps the designed cascade for the way back.
    list = makeList();
    w._commitBookingsHtml(list, A, NOW);
    list.offsetParent = null;
    w._commitBookingsHtml(list, A.replace('Cancel booking', 'Cancel all 2'), NOW);
    ok(!('data-quiet' in list.attrs), 'a rebuild while My Bookings is not the tab on screen is not flagged quiet');

    // The suites' own bare nodes (bookings-load.js, offline.js) never take this path at all.
    const tail = appSrc.slice(appSrc.indexOf('function renderMyBookings()'), appSrc.indexOf('// ── pure:render-perf:start'));
    ok(/if \(typeof _commitBookingsHtml === 'function'\) _commitBookingsHtml\(list, html, now\.getTime\(\)\);\s*else list\.innerHTML = html;\s*\}\s*$/.test(tail),
      'renderMyBookings reaches it through a typeof guard, as its LAST step (other suites run the function on its own)');
  }

  t.section('My Bookings: a list that stays up never strands a button');
  {
    const w = perfWorld();
    const A = '<button class="book-btn booked mb-primary-btn">Cancel booking</button><button class="booking-action-btn">+ Add spot</button>';
    const NOW = 1e12;
    const fresh = () => { const l = makeList(); w._commitBookingsHtml(l, A, NOW); return l; };

    let list = fresh();
    list.nodes.button[0].disabled = true; list.nodes.button[0].textContent = '…'; // upcomingCancel in flight
    eq([w._commitBookingsHtml(list, A, NOW + 1000), list.writes, list.nodes.button[0].textContent], [false, 1, '…'], 'a cancel in flight keeps its "…" button: the refetch that lands meanwhile does not hand back a live "Cancel booking"');
    list.nodes.button[0].disabled = false; list.nodes.button[0].textContent = 'Cancel booking'; // the flow put it back
    eq(w._commitBookingsHtml(list, A, NOW + 2000), false, '…and once the flow has restored it, the list is still intact');

    list = fresh();
    list.nodes.button[1].dataset.busy = '1'; list.nodes.button[1].textContent = 'Join waitlist';
    eq(w._commitBookingsHtml(list, A, NOW + 1000), false, 'data-busy counts as busy too (bookClass holds the button through its dialog)');

    list = fresh();
    list.nodes.button[1].textContent = 'Book'; // bookClass opened the picker and returned
    eq([w._commitBookingsHtml(list, A, NOW + 1000), list.writes, list.nodes.button[1].textContent], [true, 2, '+ Add spot'],
      'an IDLE button a finished flow relabelled ("+ Add spot" → "Book") is healed by a rebuild, as it always was');

    list = fresh();
    list.nodes.button[1].className = 'book-btn'; // _settleUnverifiedBooking restyles it
    eq(w._commitBookingsHtml(list, A, NOW + 1000), true, '…and so is one that was restyled');

    list = fresh();
    list.nodes.button.push({ className: 'find-similar-option', textContent: 'Same class next week', disabled: false, dataset: {} }); // the Similar popup
    eq(w._commitBookingsHtml(list, A, NOW + 1000), false, 'buttons that are not ours (the Similar popup\'s options) do not count as damage — the popup survives');

    list = fresh();
    list.nodes.button[0].disabled = true;
    eq(w._commitBookingsHtml(list, A, NOW + 1000), false, 'busy, first seen');
    eq(w._commitBookingsHtml(list, A, NOW + 100000), false, 'still inside any request\'s lifetime (4 × 15s)');
    eq([w._commitBookingsHtml(list, A, NOW + 1000 + 120001), list.nodes.button[0].disabled], [true, false], 'busy for over two minutes is a flow that died: rebuilt, never a dead button for the rest of the session');

    // "+ Add spot" → picker → signal drops → Confirm: reliability.js parks THAT
    // button on "Queued" / .booked / disabled and never re-enables it. Disabled
    // under a label of its own is a flow that has ENDED, not one in flight.
    list = fresh();
    Object.assign(list.nodes.button[1], { textContent: 'Queued', className: 'book-btn booked', disabled: true });
    eq([w._mbInFlight(list.nodes.button[1]), w._commitBookingsHtml(list, A, NOW + 3000), list.nodes.button[1].textContent, list.nodes.button[1].disabled], [false, true, '+ Add spot', false],
      'a terminally disabled "Queued" is not in flight: the next render rebuilds the list and "+ Add spot" is back (it stayed dead — and both tickers off — until the tab was left)');
    const btn = (o) => Object.assign({ textContent: '×', className: 'seat-x', _mbLabel: '×', _mbClass: 'seat-x', disabled: true, dataset: {} }, o);
    eq([w._mbInFlight(btn({})), w._mbInFlight(btn({ textContent: '…' })), w._mbInFlight(btn({ _mbLabel: null, textContent: 'Anything' })), w._mbInFlight(btn({ disabled: false, dataset: { busy: '1' } })),
      w._mbInFlight(btn({ disabled: false })), w._mbInFlight(btn({ textContent: 'Full', className: 'book-btn' }))], [true, true, true, true, false, false],
      'in flight = data-busy, or disabled and: untouched (the seat ×), "…", or not ours; idle or terminally relabelled = not');
  }

  t.section('My Bookings: a folded billing period stays folded across a rebuild');
  {
    const w = perfWorld();
    const two = (n) => '<div class="mb-period-section">a' + n + '</div><div class="mb-period-section">b</div>';
    const list = makeList();
    w._commitBookingsHtml(list, two(1), 1);
    list.nodes.section[1].classList.add('collapsed');
    w._commitBookingsHtml(list, two(2), 2);
    eq([list.nodes.section[0].classList.contains('collapsed'), list.nodes.section[1].classList.contains('collapsed')], [false, true], 'the next period the member folded away is folded again after a cancel rebuilt the list');
    const expanded = (i) => list.nodes.section[i].querySelector('.mb-period-bar').getAttribute('aria-expanded');
    eq([expanded(0), expanded(1)], ['true', 'false'], '…and its bar says aria-expanded="false" with it (the fresh markup says "true": VoiceOver announced "expanded" over hidden cards)');
    list.innerHTML = '<div class="mb-skeleton"></div>';
    w._commitBookingsHtml(list, two(3), 3);
    eq([list.nodes.section[1].classList.contains('collapsed'), expanded(1)], [false, 'true'], 'a first paint starts open, and says so');
  }

  // The REAL renderMyBookings → _commitBookingsHtml, twice (a foreground: /bookings, then /profile).
  t.section('My Bookings: the real render, called twice, writes once');
  {
    const els = {};
    const list = makeList();
    const el = (id) => (id === 'upcomingList' ? list : (els[id] || (els[id] = { style: {}, textContent: '', innerHTML: '' })));
    const p = (x) => String(x).padStart(2, '0');
    const local = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`; };
    const soon = local(Date.now() + 3 * 3600000);
    const evt = (o) => Object.assign({ duration: 45, studio_id: 3, instructor_id: 9, _typeName: 'Ride <45>', _instrName: 'Ana "B"', _locName: 'Bank', _studioName: 'Studio 1' }, o);
    const w = perfWorld({
      escapeHTML: esc, instrLink: (n) => esc(n), slotLabelForEvent: () => 'Bike',
      parsePsycleDate: (v) => (v ? new Date(String(v).replace(' ', 'T')) : null),
      _waitlistOfferPending: () => false, _waitlistTimeMs: () => NaN,
      document: { getElementById: el }, localStorage: { getItem: () => '[]' },
      currentUser: { id: 7, stats: {} }, _activeSubscription: null,
      _myBookings: { 101: { bookingId: 'A', slots: [7, 8], slotBookings: {} }, 102: { bookingId: 'B', slots: [3], slotBookings: {} }, 103: { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 5, status: 'waiting' } } },
      _eventCache: { 101: evt({ start_at: soon }), 102: evt({ start_at: '2099-01-02T07:30:00' }), 103: evt({ start_at: '2099-01-03T07:30:00' }) },
    });
    // renderMyBookings asks _classHasStarted (pure:bookings-started — the REAL
    // one) through _gymClassStartMs. `soon` above is a DEVICE-local wall clock,
    // so the stand-in is that resolver's own fallback: the device-local parse.
    const startedFrom = appSrc.indexOf('// ── pure:bookings-started:start'), startedTo = appSrc.indexOf('// ── pure:bookings-started:end');
    ok(startedFrom !== -1 && startedTo > startedFrom, 'pure:bookings-started can be sliced');
    // The Waitlisted card (103) reads its status line / badge off _waitlistPhase:
    // the REAL waitlist:pure block, as tests/suites/waitlist-polish.js evaluates it.
    const wlFrom = appSrc.indexOf('// ── waitlist:pure:start'), wlTo = appSrc.indexOf('// ── waitlist:pure:end');
    ok(wlFrom !== -1 && wlTo > wlFrom, 'waitlist:pure can be sliced');
    t.vm.runInContext("var _bookingsLoadState = 'loaded', _showPastBookings = false, _waitlistsUnavailable = false;\n" +
      appSrc.slice(wlFrom, wlTo) + '\n' +
      appSrc.slice(appSrc.indexOf('// ── pure:copy:start'), appSrc.indexOf('// ── pure:copy:end')) + '\n' + // _plural: the card's counts
      appSrc.slice(startedFrom, startedTo) + "\nfunction _gymClassStartMs(s) { return new Date(String(s).replace(' ', 'T')).getTime(); }\n" +
      grab(appSrc, 'function renderMyBookings('), w, { filename: 'js/app.js[renderMyBookings]' });

    w.renderMyBookings();
    eq([list.writes, list.nodes.chip.length, list.nodes.chip[0] && list.nodes.chip[0].getAttribute('data-start')], [1, 1, soon], 'first paint: one write, and the imminent class carries a chip with its raw start_at in data-start');
    ok(/data-start="[^"<>]*"/.test(list.innerHTML) && list.innerHTML.indexOf('Ride &lt;45&gt;') !== -1, 'the card is built as before (API text escaped)');
    w.renderMyBookings();
    w.renderMyBookings();
    eq(list.writes, 1, '/profile landing, then the 0.4s refetch: byte-identical lists are not written again (3 builds → 1 write; it was 3)');
    list.nodes.chip[0].textContent = 'In 9h 59m';
    w.renderMyBookings();
    ok(list.writes === 1 && /^(In \d|Tomorrow )/.test(list.nodes.chip[0].textContent), 'a chip the clock has left behind is put right in place, without a rebuild');
    delete w._myBookings[102];
    w.renderMyBookings();
    eq([list.writes, 'data-quiet' in list.attrs], [2, true], 'a cancel changes the list: one quiet rebuild');
    ok(/data-start="\$\{escapeHTML\(evt\.start_at\)\}"/.test(appSrc), 'data-start goes through escapeHTML (start_at is API text)');
  }

  // ── Stats: one parse per paint ───────────────────────────────────────────
  t.section('Stats: the history is parsed once and shared, and a writer invalidates it by writing');
  {
    const tabsSrc = t.readSource('js/tabs.js');
    const memoVars = '  var _historyRaw = null, _historyParsed = null;';
    const memoAt = tabsSrc.indexOf('\n' + memoVars + '\n'), fnAt = tabsSrc.indexOf('\n  function getFullHistory(');
    ok(memoAt !== -1 && memoAt < fnAt && fnAt - memoAt < 400, 'getFullHistory keeps its memo beside it');
    const store = { raw: null, throws: false };
    let parses = 0;
    const ctx = t.vm.createContext({
      localStorage: { getItem: () => { if (store.throws) throw new Error('SecurityError'); return store.raw; } },
      JSON: { parse: (s) => { parses++; return JSON.parse(s); } },
    });
    t.vm.runInContext(memoVars + '\n' + grab(tabsSrc, '  function getFullHistory(', '  }'), ctx);
    const plain = (v) => JSON.parse(JSON.stringify(v)); // out of the vm realm, for eq

    eq([plain(ctx.getFullHistory()), plain(ctx.getFullHistory())], [[], []], 'nothing stored: an empty history');
    const H1 = [{ eventId: '1', typeName: 'Ride', date: '2026-09-01 07:30:00' }, { eventId: '2', typeName: 'Yoga', date: '2026-09-02T18:00:00', cancelledAt: 'x' }];
    store.raw = JSON.stringify(H1);
    parses = 0;
    const a = ctx.getFullHistory(), b = ctx.getFullHistory(), c = ctx.getFullHistory();
    eq(plain(a), H1, 'the memoised read returns exactly what a fresh JSON.parse returns');
    ok(a === b && b === c && parses === 1, 'eleven sections, one parse: the same array is handed to every caller');
    const H2 = H1.concat([{ eventId: '3', typeName: 'Lagree', date: '2026-09-03T07:00:00' }]);
    store.raw = JSON.stringify(H2); // a booking, the sync, an import, another tab
    eq([plain(ctx.getFullHistory()), parses], [H2, 2], 'any write to the key is seen on the next read — no invalidation hook to forget');
    store.raw = '{"broken';
    eq([plain(ctx.getFullHistory()), plain(ctx.getFullHistory())], [[], []], 'a corrupt value reads as empty, as before');
    store.raw = JSON.stringify(H2);
    eq(plain(ctx.getFullHistory()), H2, '…and is never what gets remembered');
    store.throws = true;
    eq(plain(ctx.getFullHistory()), [], 'storage that throws reads as empty');
    store.throws = false;

    const heat = grab(tabsSrc, '  function renderHeatmap(', '  }');
    ok(/var history = getFullHistory\(\);/.test(heat) && !/JSON\.parse/.test(heat), 'the heatmap shares the parse instead of doing its own');
    const users = tabsSrc.split('getFullHistory()').length - 2; // minus the definition
    ok(users >= 10, 'every Stats section reads through it (' + users + ' call sites)');
    // Sharing one array is only safe while nobody reorders or grows it.
    ok(!/\bhistory\.(sort|reverse|push|unshift|splice|pop|shift)\(/.test(tabsSrc), 'no section mutates the shared array');
  }

  t.section('Stats: "Your routine" names the weekday without an Intl formatter per entry');
  {
    const tabsSrc = t.readSource('js/tabs.js');
    const reco = grab(tabsSrc, '  function renderRecommendations(', '  }');
    ok(!/toLocale/.test(noComments(reco)) && /DAY_NAMES_FULL\[dt\.getDay\(\)\]\.toLowerCase\(\)/.test(reco), 'weekday from a lookup (toLocaleDateString built 2,000 formatters for a full history)');
    const box = { style: {}, innerHTML: '' };
    const hist = [
      { typeName: 'Ride', instrName: 'Ana', locName: 'Bank', date: '2026-09-04 07:30:00' }, // a Friday
      { typeName: 'Ride', instrName: 'Ana', locName: 'Bank', date: '2026-09-11T07:30:00' },
      { typeName: 'Yoga', instrName: 'Bo', locName: '', date: 'never' },
      { typeName: 'Yoga', instrName: 'Bo', locName: '', date: '2026-09-06T18:05:00', cancelledAt: 'x' },
    ];
    const ctx = t.vm.createContext({
      document: { getElementById: () => box }, getFullHistory: () => hist, escapeHTML: esc, instrLink: (n) => esc(n),
      DAY_NAMES_FULL: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      _clock24: t.loadPure('js/app.js', 'clock')._clock24, // app.js's ONE time formatter (24-hour)
    });
    t.vm.runInContext(reco, ctx);
    ctx.renderRecommendations();
    ok(/Fridays at 07:30/.test(box.innerHTML) && /2x booked/.test(box.innerHTML), 'two Friday 7:30s (space- and T-form alike) are one routine, named in 24-hour time');
    ok(!/Invalid|NaN/.test(box.innerHTML), 'an unreadable date is skipped — it used to become an "Invalid dates at NaN:NaNam" card');
  }

  // ── Class History modal ──────────────────────────────────────────────────
  t.section('Class History: a first screenful, then the rest in slices');
  {
    const c = t.loadPure('js/features.js', 'history-chunks');
    const plain = (v) => JSON.parse(JSON.stringify(v));
    eq(plain(c.historyChunks(0, 100, 200)), [], 'no rows, no chunks');
    eq(plain(c.historyChunks(1, 100, 200)), [[0, 1]], 'one row');
    eq(plain(c.historyChunks(100, 100, 200)), [[0, 100]], 'exactly the first screenful: nothing left to append');
    eq(plain(c.historyChunks(101, 100, 200)), [[0, 100], [100, 101]], 'one over: a second slice of one');
    eq(plain(c.historyChunks(300, 100, 200)), [[0, 100], [100, 300]], 'the later slices are bigger');
    eq(plain(c.historyChunks(301, 100, 200)), [[0, 100], [100, 300], [300, 301]], '…and the last one is whatever is left');
    const full = plain(c.historyChunks(2000, 100, 200));
    eq([full.length, full[0], full[full.length - 1]], [11, [0, 100], [1900, 2000]], 'the 2,000-entry cap: 11 slices');
    ok(full.every((r, i) => r[0] < r[1] && (i === 0 || r[0] === full[i - 1][1])), 'slices are contiguous: no row twice, none dropped');
    eq(plain(c.historyChunks(3, 0, 0)), [[0, 1], [1, 2], [2, 3]], 'a zero step still terminates');
  }
  {
    // The REAL openHistoryModal against a node that records what it is given.
    const featSrc = t.readSource('js/features.js');
    const mk = (n, bad) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const d = new Date(new Date('2026-09-01T07:30:00').getTime() - i * 86400000);
        out.push({ eventId: String(i), typeName: 'Ride <' + i + '>', instrName: 'Ana', locName: 'Bank', slots: [i % 40 + 1], date: i === bad ? 'garbage' : ymd(d) + ' 07:30:00' });
      }
      return out;
    };
    const world = (history) => {
      const timers = [];
      const w = { timers, overlay: null, appended: '' };
      const mkEl = () => {
        const o = { style: {}, isConnected: false, html: '', markerGone: false, remove() {} };
        Object.defineProperty(o, 'innerHTML', { get: () => o.html, set: (v) => { o.html = v; } });
        o.querySelector = (sel) => (sel === '#historyModalMore' && !o.markerGone && o.html.indexOf('id="historyModalMore"') !== -1
          ? { insertAdjacentHTML: (pos, h) => { if (pos !== 'beforebegin') throw new Error(pos); w.appended += h; }, remove: () => { o.markerGone = true; } } : null);
        w.overlay = o;
        return o;
      };
      const ctx = t.vm.createContext({
        localStorage: { getItem: () => JSON.stringify(history) }, Intl, console,
        document: { getElementById: () => null, createElement: mkEl, body: { appendChild: (o) => { o.isConnected = true; } } },
        window: { escapeHTML: esc }, setTimeout: (fn) => { timers.push(fn); return 0; },
        slotLabel: () => 'Bike', formatSlots: (l, s) => l + ' ' + s.join(' & '),
        _clock24: t.loadPure('js/app.js', 'clock')._clock24, // each row's time: app.js's ONE formatter (24-hour)
      });
      const pre = featSrc.split('\n').filter((l) => /^  (let _histMonthFmt|const HISTORY_FIRST_ROWS)/.test(l)).join('\n');
      t.vm.runInContext("var escapeHtml = function (s) { return window.escapeHTML(s); }; const HISTORY_KEY = 'psycle_class_history';\n" +
        grab(featSrc, '  function getHistory(', '  }') + '\n' + pre + '\n' + grab(featSrc, '  function historyChunks(', '  }') + '\n' +
        grab(featSrc, '  function openHistoryModal(', '  }') + '\nthis.openHistoryModal = openHistoryModal;', ctx);
      w.open = () => ctx.openHistoryModal();
      return w;
    };
    const rowsIn = (html) => (html.match(/class="history-item/g) || []).length;

    let w = world(mk(650));
    w.open();
    eq([rowsIn(w.overlay.html), /650 bookings recorded/.test(w.overlay.html), w.timers.length], [100, true, 1], '650 entries: the modal opens on the newest 100 rows (the count is still the whole history), one task armed for the rest');
    let tasks = 0;
    while (w.timers.length) { w.timers.shift()(); tasks++; }
    eq([rowsIn(w.overlay.html) + rowsIn(w.appended), tasks, w.overlay.markerGone], [650, 3, true], '…the other 550 arrive in 3 slices (200 + 200 + 150) and the marker is taken out');
    const all = w.overlay.html + w.appended;
    eq((all.match(/class="history-month-header"/g) || []).length, new Set(mk(650).map((e) => e.date.slice(0, 7))).size, 'one header per month across slices: a month split by a slice boundary is not announced twice');
    ok(all.indexOf('Ride &lt;0&gt;') !== -1 && all.indexOf('Ride <0>') === -1, 'rows are escaped as before');

    w = world(mk(650));
    w.open();
    w.timers.shift()();
    w.overlay.isConnected = false; // the member closed it
    while (w.timers.length) w.timers.shift()();
    eq(rowsIn(w.appended), 200, 'closing the modal stops the appending (nothing is built for a node that is gone)');

    w = world(mk(40, 7));
    let threw = null;
    try { w.open(); } catch (e) { threw = e; }
    eq([threw, rowsIn(w.overlay.html), w.timers.length], [null, 40, 0], 'one unreadable date does not stop the modal opening (Intl format() throws on an Invalid Date)');
    ok(w.overlay.html.indexOf('Date unknown') > w.overlay.html.indexOf('September 2026'), '…it is listed last, under "Date unknown"');
    ok(!/new Intl\.DateTimeFormat/.test(featSrc.slice(0, featSrc.indexOf('  function openHistoryModal('))), 'no formatter is built at module load (booking-extras.js runs this file in a bare sandbox)');
    ok(!/toLocaleDateString/.test(noComments(grab(featSrc, '  function openHistoryModal(', '  }'))), 'no per-row toLocaleDateString left in the modal');
  }

  // ── Explore sections ─────────────────────────────────────────────────────
  t.section('Explore: identical sections are not rebuilt; a real change keeps the carousel where it was');
  {
    const expSrc = t.readSource('js/explore.js');
    const mkSection = () => {
      const s = { writes: 0, html: '', grid: null, style: {} };
      Object.defineProperty(s, 'innerHTML', { get: () => s.html, set: (v) => { s.writes++; s.html = v; s.grid = /explore-grid/.test(v) ? { scrollLeft: 0 } : null; } });
      s.querySelector = (sel) => (sel === '.explore-grid' ? s.grid : null);
      return s;
    };
    const ctx = t.vm.createContext({});
    t.vm.runInContext(grab(expSrc, '  function setHtml(', '  }'), ctx);
    const sec = mkSection();
    const CARDS = '<div class="explore-grid"><div class="explore-card">a</div></div>';
    ctx.setHtml(sec, CARDS);
    sec.grid.scrollLeft = 480; // the member swiped along
    const gridBefore = sec.grid;
    ctx.setHtml(sec, CARDS); // bookings:loaded on a return to the app
    ok(sec.writes === 1 && sec.grid === gridBefore && sec.grid.scrollLeft === 480, 'the same HTML: nothing is touched — the row stays where it was swiped to and does not fade in again');
    ctx.setHtml(sec, CARDS.replace('>a<', '>b<'));
    eq([sec.writes, sec.grid !== gridBefore, sec.grid.scrollLeft], [2, true, 480], 'a changed row is rebuilt, and put back at the same scroll offset');
    ctx.setHtml(sec, '<div class="explore-empty">…</div>');
    ctx.setHtml(sec, CARDS);
    eq([sec.writes, sec.grid.scrollLeft], [4, 0], 'empty state → cards is remembered correctly too (a bypassed write would leave the section stuck)');
    ok(!/\b(container|\w*Section)\.innerHTML\s*=/.test(expSrc) && (expSrc.match(/setHtml\((container|newSection),/g) || []).length >= 11,
      'no section is written around setHtml — every list, empty state, the banner and "Loading…" go through it');

    // The sync banner draws its own progress.
    const state = { syncing: false, label: '', synced: '2026-09-01T10:00:00.000Z', token: 'tok' };
    const bctx = t.vm.createContext({
      localStorage: { getItem: (k) => (k === 'psycle_history_synced' ? state.synced : '[{"eventId":"1"}]') },
      getBearerToken: () => state.token, Intl,
    });
    t.vm.runInContext("var SYNC_KEY = 'psycle_history_synced', HISTORY_KEY = 'psycle_class_history', _syncing = false, _syncLabel = '';\n" +
      "var TOPUP_SKIPPED_KEY = 'psycle_history_topup_skipped';\n" + // the synced banner reads the "too many to top up" note
      'var escapeHtml = ' + esc.toString() + ';\n' +
      grab(expSrc, '  function _topUpTooBig(', '  }') + '\n' +
      grab(expSrc, '  function getHistory(', '  }') + '\n' + grab(expSrc, '  function setHtml(', '  }') + '\n' +
      grab(expSrc, '  function hasSynced(', '  }') + '\n' + grab(expSrc, '  function renderSyncBanner(', '  }') + '\n' +
      appSrc.slice(appSrc.indexOf('// ── pure:copy:start'), appSrc.indexOf('// ── pure:copy:end')), bctx); // the banner counts with _plural
    const banner = mkSection();
    bctx.renderSyncBanner(banner);
    ok(/id="syncHistoryBtn" onclick="window\._explore_syncHistory\(\)">Re-sync<\/button>/.test(banner.html), 'idle: an enabled "Re-sync"');
    t.vm.runInContext("_syncing = true; _syncLabel = 'Fetching details (31/200)...';", bctx);
    bctx.renderSyncBanner(banner); // a bookings event lands mid-sync
    ok(/id="syncHistoryBtn"[^>]* disabled>Fetching details \(31\/200\)\.\.\.<\/button>/.test(banner.html), 'mid-sync a re-render draws the button DISABLED with the live progress — it used to hand back an enabled "Sync now" that did nothing');
    t.vm.runInContext("_syncLabel = '<img src=x>';", bctx);
    bctx.renderSyncBanner(banner);
    ok(banner.html.indexOf('<img') === -1, 'the label is escaped');
    t.vm.runInContext('_syncing = false;', bctx);
    bctx.renderSyncBanner(banner);
    ok(/>Re-sync<\/button>/.test(banner.html) && !/ disabled>/.test(banner.html), 'when the sync ends the idle button is back');

    const sync = expSrc.slice(expSrc.indexOf('window._explore_syncHistory = async function'), expSrc.indexOf('// MASTER RENDER'));
    const lastRender = sync.lastIndexOf('markDirtyAndMaybeRender();');
    ok(sync.lastIndexOf('_syncing = false;', lastRender) !== -1 && sync.lastIndexOf('_syncing = false;', lastRender) > sync.lastIndexOf('localStorage.setItem(HISTORY_KEY', lastRender),
      '_syncing is cleared BEFORE the final repaint, or the banner would be drawn busy for good');
    ok(/_syncing = false;\s*paintBanner\(\);[^\n]*\n  \};/.test(sync), 'every way out repaints the banner idle — also a failure, and a sync that ended on another tab');
  }

  // ── Instructor photos ────────────────────────────────────────────────────
  t.section('Instructor photos: a circle while loading, and when the photo cannot load');
  {
    const styles = t.readSource('css/styles.css'), feat = t.readSource('css/features.css'), tabsCss = t.readSource('css/tabs.css');
    const rule = (css, sel) => { const i = css.indexOf('\n' + sel + ' {'); return i === -1 ? '' : css.slice(i, css.indexOf('}', i)); };
    ok(/background: var\(--border, #222\);/.test(rule(styles, '.cds-photo')) && /background: var\(--border, #222\);/.test(rule(feat, '.instructor-photo')), 'both photo rules carry the placeholder background (a token every theme defines)');
    ok(tabsCss.indexOf('#upcomingList[data-quiet] .class-card { animation: none; }') > tabsCss.indexOf('#results[data-quiet] .class-card { animation: none; }'), 'css/tabs.css switches the entrance off under #upcomingList[data-quiet] (its own rule: the #results line is asserted verbatim elsewhere)');

    const at = appSrc.indexOf("document.addEventListener('error', function (e) {");
    ok(at !== -1, 'app.js listens for failed images');
    const src = appSrc.slice(at, appSrc.indexOf('}, true);', at) + 9);
    ok(/\}, true\);$/.test(src), '…in the capture phase (error does not bubble)');
    const handlers = [];
    const made = [];
    const ctx = t.vm.createContext({ document: { addEventListener: (type, fn, capture) => handlers.push({ type, fn, capture }), createElement: (tag) => { const d = { tag, attrs: {}, className: '', setAttribute(k, v) { this.attrs[k] = v; } }; made.push(d); return d; } } });
    t.vm.runInContext(src, ctx);
    const img = (cls, tagName) => { const o = { tagName: tagName || 'IMG', className: cls, isConnected: true, replaced: null, classList: { contains: (c) => cls.split(' ').indexOf(c) !== -1 }, replaceWith(n) { this.replaced = n; } }; return o; };
    const fire = (target) => handlers[0].fn({ target });
    const a = img('cds-photo'), b = img('instructor-photo'), c = img('some-other-img'), d = img('cds-photo', 'SCRIPT');
    [a, b, c, d].forEach(fire);
    fire(null);
    eq([a.replaced && a.replaced.className, a.replaced && a.replaced.tag, b.replaced && b.replaced.className], ['cds-photo', 'div', 'instructor-photo'], 'a failed sheet / modal photo becomes a div of the same class — the same circle, no broken-image glyph');
    eq(a.replaced.attrs['aria-hidden'], 'true', '…hidden from screen readers (the name is printed beside it)');
    eq([c.replaced, d.replaced, made.length], [null, null, 2], 'nothing else on the page is touched');
  }
};
