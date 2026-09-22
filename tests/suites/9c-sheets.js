'use strict';
// Wave 9c — Crisp Colour sheets: the class sheet, the seat picker, the Booked
// sheet, confirm dialogs, the Find-similar popup and the instructor / history
// modals. What is decided in code (pure:sheets in js/app.js) is tested as a
// table; what is drawn is checked by running the SHIPPED functions, sliced out
// of the source, over fake DOMs; and what css/crisp.css's 9c section paints is
// held to 4.5:1 in every theme from the shipped token values. Nothing here
// can reach Psycle.
module.exports = function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const settingsSrc = t.readSource('js/settings.js');
  const featSrc = t.readSource('js/features.js');
  const finder = t.readSource('psycle-finder.html');
  const themeCss = t.readSource('css/theme.css');
  const themeJs = t.readSource('js/theme.js');
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const crispAll = t.readSource('css/crisp.css');
  const section = noComments(crispAll.slice(crispAll.indexOf('/* == crisp:9c-sheets == */'), crispAll.indexOf('/* == crisp:9d-bookings == */')));

  const lines = appSrc.split('\n');
  // Top-level functions in app.js open at column 0 and close with a bare "}".
  const grab = (opener, closer) => {
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (from === -1 || to === -1) throw new Error('9c-sheets suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };
  const between = (src, fromTag, toTag) => {
    const a = src.indexOf(fromTag), b = src.indexOf(toTag, a + 1);
    if (a === -1 || b === -1) throw new Error('9c-sheets suite: cannot slice "' + fromTag + '" … "' + toTag + '" (anchor moved?)');
    return src.slice(a, b);
  };
  const escapeHTML = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Pictographic code points, written or as a numeric entity (the old sheet's
  // calendar / pin / people / warning sign / sparkles / clock face).
  const EMOJI = /[☀-➿\u{1F000}-\u{1FAFF}]|&#(9888|10024|12[0-9]{4});/u;

  // _sheetPlanNote names the billing period with My Bookings' own word (_mbPeriodWord,
  // pure:bookings-crisp — a hoisted top-level function in the app): handed in here.
  const p = t.loadPure('js/app.js', 'sheets', { _mbPeriodWord: t.loadPure('js/app.js', 'bookings-crisp')._mbPeriodWord });
  const classType = t.loadPure('js/app.js', 'class-type', {
    getCategory: (n) => ({ key: /ride/i.test(n) ? 'RIDE' : /strength/i.test(n) ? 'STRENGTH' : /reformer/i.test(n) ? 'PILATES' : 'OTHER' }),
  });

  // ── pure:sheets ──────────────────────────────────────────────────────────
  t.section('Sheets: line marks (_uiIcon) — the pictograms\' family, never an emoji');
  {
    ['clock', 'caution', 'spots', 'calendar', 'person', 'again', 'tick'].forEach((name) => {
      const svg = p._uiIcon(name, 19);
      ok(/^<svg class="ui-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"/.test(svg) && /aria-hidden="true" focusable="false"/.test(svg) &&
        /stroke-linecap="round" stroke-linejoin="round"/.test(svg) && !/\sid=|<title|<script|onload/i.test(svg), name + ': a decorative stroke mark in currentColor, round ends, no id / title');
    });
    eq([p._uiIcon('nope'), p._uiIcon(''), p._uiIcon(null), p._uiIcon('constructor'), p._uiIcon('__proto__'), p._uiIcon('"><img src=x>')], ['', '', '', '', '', ''],
      'an unknown name draws nothing — own names only, and nothing caller-supplied reaches the markup');
    ok(/width="19"/.test(p._uiIcon('clock')) && /width="19"/.test(p._uiIcon('clock', 'big')) && /width="19"/.test(p._uiIcon('clock', 4000)) && /width="22"/.test(p._uiIcon('tick', 22)),
      'the size is a number between 8 and 96, else 19');
    ok(/stroke-width="3"/.test(p._uiIcon('tick', 22)) && /stroke-width="2"/.test(p._uiIcon('clock', 19)), 'the tick is drawn heavier (it sits small, on a filled circle)');
  }

  t.section('Class sheet: the note beside Book says only what Psycle\'s numbers can back (_sheetPlanNote)');
  {
    const j = (v) => JSON.parse(JSON.stringify(v));
    const DAY = 86400000, start = 1000 * DAY, end = 1030 * DAY;
    const plan = (made, max) => ({ status: 'active', max_bookings: max, bookings_made: made });
    const inside = { classMs: 1010 * DAY, periodStartMs: start, periodEndMs: end };
    eq(j(p._sheetPlanNote(Object.assign({ subscription: plan(8, 12) }, inside))), { main: '1 class', sub: '4 left this month' }, 'a capped plan, a class inside the period being counted: the use and what is left');
    eq(j(p._sheetPlanNote(Object.assign({ subscription: plan(12, 12) }, inside))), { main: '1 class', sub: 'None left this month' }, 'nothing left is said in words, not as "0 left"');
    eq(j(p._sheetPlanNote(Object.assign({ subscription: plan(14, 12) }, inside))), { main: '1 class', sub: 'None left this month' }, 'more made than the cap never prints a negative');
    eq(j(p._sheetPlanNote(Object.assign({ subscription: plan('3', '12') }, inside))), { main: '1 class', sub: '9 left this month' }, 'numbers that arrive as strings are read as numbers');
    // The period is named from its own length — the word My Bookings' usage line uses for the same plan.
    const week = { classMs: 1003 * DAY, periodStartMs: start, periodEndMs: start + 7 * DAY };
    eq(j(p._sheetPlanNote(Object.assign({ subscription: plan(2, 4) }, week))), { main: '1 class', sub: '2 left this week' }, 'a plan Psycle counts by the WEEK: "2 left this week" (it said "this month" — beside My Bookings\' "2 of 4 this week")');
    eq(j(p._sheetPlanNote(Object.assign({ subscription: plan(4, 4) }, week))), { main: '1 class', sub: 'None left this week' }, '…and "None left this week"');
    eq(j(p._sheetPlanNote({ subscription: plan(8, 12), classMs: 1010 * DAY, periodStartMs: start, periodEndMs: start + 90 * DAY })), { main: '1 class', sub: '4 left this period' }, 'a length that is neither: "this period" rather than a guess');
    eq(j(p._sheetPlanNote({ subscription: plan(8, 12), classMs: 1010 * DAY, periodStartMs: NaN, periodEndMs: end })), { main: '1 class', sub: '4 left this period' }, 'no readable start: the length is unknown, so is the word');
    eq(j(p._sheetPlanNote({ subscription: plan(8, 12), classMs: 1040 * DAY, periodStartMs: start, periodEndMs: end })), { main: '1 class', sub: '' },
      'a class in the NEXT billing period: those 8 of 12 are not its count — the use alone');
    eq(j(p._sheetPlanNote({ subscription: plan(8, 12), classMs: 990 * DAY, periodStartMs: start, periodEndMs: end })), { main: '1 class', sub: '' }, '…nor for a class before the period');
    eq(j(p._sheetPlanNote({ subscription: plan(8, 12), classMs: 1010 * DAY, periodStartMs: NaN, periodEndMs: NaN })), { main: '1 class', sub: '' }, 'no readable period → no "left" claim');
    eq(j(p._sheetPlanNote({ subscription: plan(8, 12), classMs: end, periodStartMs: start, periodEndMs: end })), { main: '1 class', sub: '' }, 'period_end is the START of the next period: a class at that instant is next month\'s');
    eq(p._sheetPlanNote(Object.assign({ subscription: plan(5, 0) }, inside)), null, 'an unlimited plan has nothing to run out of: no note');
    eq(p._sheetPlanNote(Object.assign({ subscription: { status: 'active' }, creditsRemaining: 6 }, inside)), null, '…and its credits are not quoted beside a plan');
    eq(j(p._sheetPlanNote({ subscription: null, creditsRemaining: 6 })), { main: '1 credit', sub: '6 left' }, 'no plan, a credit pack: the balance');
    eq(j(p._sheetPlanNote({ creditsRemaining: '2' })), { main: '1 credit', sub: '2 left' }, '…as a string too');
    eq([p._sheetPlanNote({ creditsRemaining: 0 }), p._sheetPlanNote({ creditsRemaining: NaN }), p._sheetPlanNote({}), p._sheetPlanNote(), p._sheetPlanNote({ subscription: 'junk' })],
      [null, null, null, null, null], 'nothing known → nothing said');
  }

  t.section('Seat picker: the confirm button names what it books (_pickerConfirmLabel)');
  {
    eq([p._pickerConfirmLabel('Bike', []), p._pickerConfirmLabel('Bike', null), p._pickerConfirmLabel()], ['Book', 'Book', 'Book'], 'nothing picked: plain "Book" (the button is disabled)');
    eq([p._pickerConfirmLabel('Bike', [12]), p._pickerConfirmLabel('Bed', [3]), p._pickerConfirmLabel('Machine', [5]), p._pickerConfirmLabel('', [4])],
      ['Book bike 12', 'Book bed 3', 'Book machine 5', 'Book spot 4'], 'one seat: "Book bike 12" — the class type\'s own noun, lower-cased');
    eq([p._pickerConfirmLabel('Bike', [12, 14]), p._pickerConfirmLabel('Bench', [3, 4]), p._pickerConfirmLabel('Bench', [3])],
      ['Book bikes 12 & 14', 'Book benches 3 & 4', 'Book bench 3'], 'two seats: plural, "benches" included');
    const core = t.loadPure('js/app.js', 'core');
    ['Bike', 'Bed', 'Bench', 'Machine', 'Spot'].forEach((w) => {
      eq(p._pickerConfirmLabel(w, [1, 2]), 'Book ' + core.formatSlots(w, [1, 2]).toLowerCase(), w + ': worded as formatSlots words the same seats everywhere else');
    });
  }

  t.section('Dialogs: a destructive choice is a calm outline; filled red only for a late-cancel charge or a deletion (_confirmTone)');
  {
    eq([p._confirmTone(), p._confirmTone({}), p._confirmTone({ confirmText: 'Book it' }), p._confirmTone({ danger: false, irreversible: true }), p._confirmTone({ warnClass: 'late-cancel-note' })],
      ['primary', 'primary', 'primary', 'primary', 'primary'], 'no `danger` → the primary pill — a booking confirm is never red, whatever its warn line wears');
    eq([p._confirmTone({ danger: true }), p._confirmTone({ danger: true, warn: 'x', warnClass: 'something-else' }), p._confirmTone({ danger: true, irreversible: 'yes' })],
      ['danger', 'danger', 'danger'], 'danger alone (sign out, leave a waitlist, a free cancel): the calm outline');
    eq([p._confirmTone({ danger: true, warnClass: 'late-cancel-note' }), p._confirmTone({ danger: true, warnClass: 'x late-cancel-note y' }), p._confirmTone({ danger: true, irreversible: true })],
      ['danger-solid', 'danger-solid', 'danger-solid'], 'the late-cancel warn line, or irreversible:true: filled');
    eq(p._confirmTone({ danger: true, warnClass: 'late-cancel-notes' }), 'danger', 'a look-alike class name is not the late-cancel message');
    // Who asks for it, in the shipped source: exactly the two the brief names.
    const callers = (src) => (src.match(/confirmModal\(\{[\s\S]*?\}\)/g) || []);
    const solid = callers(appSrc).concat(callers(settingsSrc), callers(t.readSource('js/tabs.js')), callers(t.readSource('js/reliability.js')))
      .filter((c) => /danger:\s*true/.test(c) && (/warnClass:\s*'late-cancel-note'/.test(c) || /irreversible:\s*true/.test(c)));
    eq(solid.map((c) => (/title:\s*([^,\n]+)/.exec(c) || [])[1]).sort(), ["'Let Psync manage ' + q + '?'", 'base'],
      'filled red is asked for by the late-cancel branch of confirmCancelWithPolicy and by the calendar hand-over — nobody else');
    ok(/if \(deadline && deadline\.insideWindow && hoursUntil > -0\.5\) \{[\s\S]*?warnClass: 'late-cancel-note',[\s\S]*?danger: true,/.test(grab('function confirmCancelWithPolicy(')),
      '…and the late-cancel branch still passes both (the plain cancel under it passes danger alone)');
  }
  {
    // The REAL confirmModal: which classes the action button gets.
    const cmSrc = between(appSrc, 'function confirmModal(opts) {', 'window.confirmModal = confirmModal;');
    const draw = (opts) => {
      let html = '';
      const overlay = { classList: { add() {}, remove() {} }, contains: () => false, querySelector: () => ({ focus() {} }), querySelectorAll: () => [], remove() {},
        set innerHTML(v) { html = v; }, get innerHTML() { return html; } };
      const ctx = t.vm.createContext({ console, escapeHTML, requestAnimationFrame: () => 0, setTimeout: () => 0,
        document: { activeElement: null, getElementById: () => null, createElement: () => overlay, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} } });
      t.vm.runInContext(cmSrc, ctx, { filename: 'js/app.js[confirmModal]' });
      ctx.confirmModal(opts);
      return html;
    };
    const btn = (html) => (/<button class="(confirm-btn confirm-btn-(?:primary|danger)[^"]*)">/.exec(html) || [])[1];
    eq([btn(draw({ title: 'Book this class?', confirmText: 'Book it' })), btn(draw({ title: 'Sign out?', danger: true })),
      btn(draw({ title: 'Cancel this booking?', warn: 'Usually charged.', warnClass: 'late-cancel-note', danger: true })), btn(draw({ title: 'Let Psync manage "Home"?', danger: true, irreversible: true }))],
    ['confirm-btn confirm-btn-primary', 'confirm-btn confirm-btn-danger', 'confirm-btn confirm-btn-danger is-solid', 'confirm-btn confirm-btn-danger is-solid'],
    'the drawn button: primary · danger (outline) · danger is-solid ×2 — and .confirm-btn-danger stays the hook the focus / click wiring looks up');
    ok(/<button class="confirm-btn confirm-btn-cancel">Keep booking<\/button>/.test(draw({ title: 'x' })), 'the safe choice keeps its class and its default words');
  }

  // ── The seat picker, drawn ───────────────────────────────────────────────
  t.section('Seat picker: data-ct on the sheet, round seats, a ring on your usual, a tick on a seat you hold');
  function pickerWorld(o) {
    o = o || {};
    const els = {};
    const el = () => { const e = { textContent: '', innerHTML: '', className: '', disabled: false, onclick: null, style: {}, attrs: {}, parentElement: null };
      e.setAttribute = (k, v) => { e.attrs[k] = String(v); }; e.appendChild = (c) => c; e.insertAdjacentElement = (pos, c) => c; return e; };
    const ctx = t.vm.createContext({
      window: { _changeSpotContext: o.swap ? { eventId: 77 } : null },
      _eventCache: o.noEvent ? {} : { 77: { start_at: '2026-09-24T19:00:00', _typeName: o.typeName || 'Ride 45', _instrName: 'Priya', _locName: 'Shoreditch', _studioName: 'Studio 1' } },
      document: { getElementById: (id) => els[id] || (els[id] = el()), createElement: el, querySelector: () => null },
      slotLabelForEvent: () => 'Bike', escapeHTML, confirmBikeBooking: () => {},
      _usualSlotForEvent: () => (o.usual == null ? null : o.usual), _cancelDeadline: () => null, _syncBikeSlotsA11y: () => {},
      classTypeKey: classType.classTypeKey, classPictogram: classType.classPictogram, _pickerConfirmLabel: p._pickerConfirmLabel,
      _clock24: classType._clock24, // pure:clock rides with pure:class-type: the header's 24-hour time
    });
    t.vm.runInContext('var _bookingContext = null, _selectedSlots = [], _usualPreselected = null, MAX_SEATS = 2;\n' +
      grab('function pluralizeSlotLabel(') + '\n' + grab('function showBikePicker(') + '\n' + grab('function _syncPickerConfirmLabel('), ctx);
    const layout = { slots: [1, 2, 3, 4, 5, 6].map((n) => ({ id: n, x: n, y: 0 })), objects: [{ x: 3, y: 1 }] };
    ctx.showBikePicker(77, null, layout, new Set(o.available || [1, 3, 4, 6]), new Set(o.mine || []), 'Studio 1', o.opts);
    return { els, ctx };
  }
  {
    let w = pickerWorld({ usual: 4 });
    const svg = w.els.bikeSvg.innerHTML;
    eq([w.els.bikeModal.attrs['data-ct'], w.els.bikeModal.attrs['data-usual'], w.els.bikeModal.attrs['data-held'], w.els.bikeModal.style.display], ['ride', '1', '0', 'flex'],
      'a Ride class with a usual bike free: #bikeModal wears data-ct="ride", says the map has a usual seat and no held one, and opens');
    ok(/^<svg class="ct-pic" width="20"/.test(w.els.modalTile.innerHTML), 'the header tile gets the class pictogram');
    eq((svg.match(/<rect [^>]*rx="20"/g) || []).length, 6, 'every seat is a full circle by attribute (rx = half the 40-unit tile); CSS then sets rx from --radius-full');
    eq((svg.match(/dominant-baseline="central"/g) || []).length, 6, 'numbers are centred by the baseline, whatever the font size');
    eq([(svg.match(/seat-mark-usual/g) || []).length, (svg.match(/seat-mark-mine/g) || []).length], [1, 0], 'ONE usual ring, no tick');
    ok(/<g class="bike-slot selected usual" data-slot="4" onclick="selectBike\(4\)">[\s\S]*?>4<\/text><circle class="seat-mark seat-mark-usual"/.test(svg), '…inside the usual seat\'s own <g>, after its number (the a11y pass reads the first <text>, settings.js the first <rect>)');
    ok(!/seat-mark[^>]*(onclick|data-slot)/.test(svg), 'a mark carries no handler and no data-slot (cancelBikeSlot / selectBike find a seat by data-slot)');
    eq(w.els.confirmBookBtn.textContent, 'Book bike 4', 'the pre-selected usual is already named on the button');
    eq(w.els.confirmBookBtn.disabled, false, '…which is enabled, as before');

    w = pickerWorld({ mine: [2, 5] });
    eq([w.els.bikeModal.attrs['data-held'], w.els.bikeModal.attrs['data-usual'], (w.els.bikeSvg.innerHTML.match(/class="seat-mark seat-mark-mine"/g) || []).length, (w.els.bikeSvg.innerHTML.match(/seat-mark-usual/g) || []).length],
      ['1', '0', 2, 0], 'two seats held: two ticks, no usual ring, and the legend is told to show "Your booking"');
    eq([w.els.confirmBookBtn.textContent, w.els.confirmBookBtn.disabled], ['Book', true], 'nothing picked yet: "Book", disabled');

    w = pickerWorld({ typeName: 'Strength 45' });
    eq(w.els.bikeModal.attrs['data-ct'], 'strength', 'another class type, another colour');
    w = pickerWorld({ noEvent: true });
    eq(w.els.bikeModal.attrs['data-ct'], 'other', 'a class that is not cached still gets a data-ct (the neutral one) — never a stale colour from the last class');

    // A swap words its own button.
    w = pickerWorld({ mine: [2], swap: true });
    w.els.confirmBookBtn.textContent = 'Swap bike';
    t.vm.runInContext('_selectedSlots = [6]; _syncPickerConfirmLabel();', w.ctx);
    eq(w.els.confirmBookBtn.textContent, 'Swap bike', 'in a swap the label is changeSpot\'s — the sync leaves it alone');
    ok(/if \(typeof _syncPickerConfirmLabel === 'function'\) _syncPickerConfirmLabel\(\);\n\}/.test(grab('function selectBike(')), 'selectBike re-words the button LAST — after the swap branch has returned');
    ok(/confirmBtn\.textContent = 'Book';/.test(grab('function closeBikePicker(')), 'closing the picker resets it to "Book"');
  }
  {
    // The page's half: tile slot, class-styled legend, pill buttons.
    const modal = finder.slice(finder.indexOf('<div id="bikeModal"'), finder.indexOf('<div id="corsBanner"'));
    ok(/<span class="ct-tile is-lg" id="modalTile" aria-hidden="true"><\/span>/.test(modal), '#modalTile is in the page, decorative');
    const legend = (/<div class="bike-legend">[\s\S]*?<\/div>/.exec(modal) || [''])[0];
    eq((legend.match(/<i class="seat-key is-(\w+)">/g) || []).map((m) => /is-(\w+)/.exec(m)[1]), ['available', 'taken', 'pick', 'mine', 'usual'], 'five legend marks, all class-styled');
    ok(!/style=/.test(legend) && /class="seat-key-held"/.test(legend) && /class="seat-key-usual"/.test(legend), 'no inline style; the last two entries can be hidden when the map has no such seat');
    ok(/#bikeModal:not\(\[data-held="1"\]\) \.seat-key-held, #bikeModal:not\(\[data-usual="1"\]\) \.seat-key-usual \{ display: none; \}/.test(section), '…and are, unless showBikePicker said otherwise');
    ok(/<button class="btn btn-ghost pill-btn pill-quiet" onclick="closeBikePicker\(\)">Cancel<\/button>/.test(modal) && /<button class="btn pill-btn pill-primary is-lg" id="confirmBookBtn" disabled onclick="confirmBikeBooking\(\)">Book<\/button>/.test(modal),
      'the two actions are pills; the dismiss button keeps .btn-ghost (showBikePicker finds it by that) and the confirm its id');
    ok(/<svg id="bikeSvg"[^>]*role="group"[^>]*aria-label=/.test(modal) && /id="modalHint" aria-live="polite"/.test(modal) && /role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabindex="-1"/.test(modal),
      'roles, names and the live hint are untouched');
  }
  {
    // settings.js's fav / avoid marks: shapes and classes, no inline colour.
    const patch = between(settingsSrc, 'var _origShowBikePicker = window.showBikePicker;', '// Integration: Tier Badges on Class Cards');
    ok(!/#[0-9a-f]{3,8}\b/i.test(patch) && !/setAttribute\('fill'/.test(patch) && !/style="/.test(patch), 'no colour literal, no fill attribute, no inline style in the picker integration');
    ok(/createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'circle'\)[\s\S]*?classList\.add\('pref-dot', 'pref-dot-prefer'\)/.test(patch) &&
      /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'path'\)[\s\S]*?classList\.add\('pref-dot', 'pref-dot-avoid'\)/.test(patch), 'prefer = a dot, avoid = a bar (a <path>: the seat rules style every <rect> in the seat) — two shapes, not two colours');
    ok(/g\.classList\.add\('pref-prefer'\)/.test(patch) && /g\.classList\.add\('pref-avoid'\)/.test(patch) && /_syncBikeSlotsA11y\(\)/.test(patch), 'the seat classes the spoken name is read from are still set, and the a11y pass still re-run');
    ok(/<i class="seat-key is-prefer"><\/i> Your fav/.test(patch) && /<i class="seat-key is-avoid"><\/i> Avoid/.test(patch), 'its two legend entries use the same marks');
    ok(/_origShowBikePicker\.apply\(this, arguments\)/.test(patch), 'the wrapper still forwards EVERY argument (opts.clashLine rides seventh)');
  }

  // ── The class sheet, drawn ───────────────────────────────────────────────
  t.section('Class sheet: time first, the class\'s colour, one action, no emoji');
  function sheetWorld(o) {
    o = o || {};
    let sheet = null;
    const clashCtx = t.loadPure('js/app.js', 'clash', {
      window: {}, instructors: o.instructors || [], escapeHTML,
      escapeForJsString: (s) => escapeHTML(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")), // as js/security.js
      formatSlots: (l, s) => l + ' ' + s.join(' & '), slotLabelForEvent: () => 'Bike',
      document: { getElementById: () => null, createElement: () => (sheet = { style: {}, innerHTML: '' }), body: { appendChild: () => {} } },
      _myBookings: o.bookings || {},
      _eventCache: Object.assign({ 77: Object.assign({ id: 77, start_at: '2030-09-24T19:00:00', duration: 45, instructor_id: 31, _typeName: 'Ride 45', _instrName: 'Priya', _locName: 'Shoreditch', _studioName: 'Studio 1' }, o.evt || {}) }, o.cache || {}),
      _countsFresh: () => true, _spotsLeft: () => (o.left == null ? 12 : o.left),
      _waitlistOfferPending: () => false,
      _cancelDeadline: () => (o.deadline === undefined ? { insideWindow: false, label: 'Tue 07:00' } : o.deadline),
      classTypeKey: classType.classTypeKey, classPictogram: classType.classPictogram, _uiIcon: p._uiIcon, _sheetPlanNote: p._sheetPlanNote,
      parsePsycleDate: (v) => (v ? new Date(String(v).replace(' ', 'T')) : null),
      _activeSubscription: o.sub === undefined ? { status: 'active', max_bookings: 12, bookings_made: 8, period_start: '2030-09-01 00:00:00', period_end: '2030-10-01 00:00:00' } : o.sub,
      currentUser: o.user || { stats: {} },
    });
    t.vm.runInContext(grab('function _clashFor(') + '\n' + grab('window.openClassDetail = function (eventId) {', '};'), clashCtx);
    clashCtx.window.openClassDetail(77);
    return sheet ? sheet.innerHTML : '';
  }
  const seat = () => ({ bookingId: 'A', bookingIds: ['A'], slots: [12], slotBookings: { 12: 'A' }, waitlisted: false });
  const place = () => ({ bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 900, status: 'waiting' } });
  {
    let html = sheetWorld();
    ok(/^<div class="class-detail-sheet" data-ct="ride" role="dialog" aria-modal="true" tabindex="-1" aria-label="Ride 45 with Priya">/.test(html), 'data-ct on the sheet; role, modality, focusable panel and its spoken name unchanged');
    const order = ['class="cds-time t-time is-sheet">19:00</span>', 'class="cds-date">', 'class="ct-tile cds-tile" aria-hidden="true"><svg class="ct-pic" width="38"', '<h2 class="cds-type">Ride 45</h2>', 'class="cds-instr-name">Priya', 'class="cds-where">&middot; Shoreditch, Studio 1<', 'class="cds-body"'].map((s) => html.indexOf(s));
    ok(order.every((i) => i !== -1) && order.every((i, n) => n === 0 || i > order[n - 1]), 'in the class-colour block: the TIME (display face, sheet size) → date · length → pictogram tile → class name → instructor → "· place" (the separator rides with the place); then the body (' + order.join(',') + ')');
    ok(/45 min/.test(html) && !/cds-duration-badge/.test(html), 'the length sits on the date line (no accent badge)');
    ok(!EMOJI.test(html), 'no emoji anywhere in the sheet');
    ok(/<div class="cds-detail-row"><span class="cds-icon" aria-hidden="true"><svg class="ui-icon"[^>]*>.*?<\/svg><\/span><span>Free cancel until <strong>Tue 07:00<\/strong><\/span><\/div>/.test(html), 'a bookable class says when cancelling stops being free — _cancelDeadline\'s own label');
    ok(/<span class="cds-avail">12 spots left<\/span>/.test(html), 'availability keeps its words and its hook');
    eq((html.match(/glow-mine/g) || []).length, 1, 'ONE thing glows: the action');
    ok(/<button class="cds-book-btn pill-btn pill-primary is-block is-lg glow-mine" onclick="[^"]*_classDetailBookAction\(77\);">Book<\/button>/.test(html), 'Book: the filled pill, full width, tall');
    ok(/<div class="cds-cta"><button class="cds-book-btn[^>]*>Book<\/button><div class="cds-note"><span class="cds-note-main">1 class<\/span><span class="cds-note-sub">4 left this month<\/span><\/div><\/div>/.test(html), 'beside it: what it uses and what is left (8 of 12 made, class inside the period)');

    html = sheetWorld({ sub: null });
    ok(!/cds-note/.test(html), 'no plan and no credits known: no note');
    html = sheetWorld({ sub: null, user: { stats: { credits_remaining: 6 } } });
    ok(/<span class="cds-note-main">1 credit<\/span><span class="cds-note-sub">6 left<\/span>/.test(html), 'a credit pack: the balance');
    html = sheetWorld({ deadline: { insideWindow: true, label: 'x' } });
    ok(/<span class="late-cancel-note">Inside the 12-hour late-cancel window<\/span>/.test(html) && !/Free cancel until/.test(html), 'inside the window the row IS the late-cancel message and wears its one class');
    html = sheetWorld({ deadline: null });
    ok(!/Free cancel|late-cancel/.test(html) && /12 spots left/.test(html), 'a start that cannot be read: no policy row, the rest stands');

    html = sheetWorld({ bookings: { 77: seat() } });
    ok(/<button class="cds-book-btn booked pill-btn pill-primary is-block is-lg glow-mine" onclick="[^"]*_classDetailBookAction\(77\);">Bike 12 ✓<\/button>/.test(html) && !/cds-note/.test(html) && /Free cancel until/.test(html),
      'a seat you hold: the class-colour pill with the glow (it is yours), its label contract intact; no "1 class" note; the free-cancel row stays');
    html = sheetWorld({ bookings: { 77: place() }, evt: { is_fully_booked: true, is_waitlistable: true } });
    ok(/<button class="cds-book-btn booked is-place pill-btn pill-ct-outline is-block is-lg" onclick="[^"]*leaveWaitlist\(77, null\);">Waitlisted ✓<\/button>/.test(html) && !/glow-mine/.test(html) && !/Free cancel/.test(html) && !/cds-note/.test(html),
      'a waitlist place: the dashed class outline, no glow, no free-cancel row (nothing to late-cancel yet), no note');
    html = sheetWorld({ evt: { is_fully_booked: true, is_waitlistable: true } });
    ok(/<button class="cds-book-btn waitlist pill-btn pill-ct-outline is-block is-lg" onclick="[^"]*_classDetailBookAction\(77\);">Join waitlist<\/button>/.test(html) && !/glow-mine/.test(html) && !/cds-note/.test(html) && !/Free cancel/.test(html),
      'Join waitlist: the class outline — no glow, no note, no free-cancel promise');
    html = sheetWorld({ evt: { is_fully_booked: true, is_waitlistable: false } });
    ok(/<button class="cds-book-btn pill-btn pill-primary is-block is-lg" disabled>Full<\/button>/.test(html) && !/glow-mine/.test(html), 'Full: disabled, and a disabled pill never glows');
    html = sheetWorld({ bookings: { 77: seat() }, evt: { start_at: '2020-01-06T07:00:00' } });
    ok(/<button class="cds-book-btn booked pill-btn pill-primary is-block is-lg" disabled>Attended · Bike 12<\/button>/.test(html) && !/glow-mine/.test(html) && !/Free cancel|spots left|cds-note/.test(html),
      'a class that has run: "Attended · Bike 12", disabled, nothing about cancelling or spots');

    // A clash: caution row, the other class's own tile at its end.
    html = sheetWorld({ bookings: { 10: seat() }, cache: { 10: { id: 10, start_at: '2030-09-24T18:30:00', duration: 45, _typeName: 'Strength 45', _locName: 'Shoreditch' } } });
    ok(/<div class="cds-detail-row cds-clash"><span class="cds-icon" aria-hidden="true"><svg[^>]*>.*?<\/svg><\/span><span class="cds-avail-full">Clashes with your 18:30 Strength 45 at Shoreditch<\/span><span class="ct-tile is-sm" data-ct="strength" aria-hidden="true"><svg class="ct-pic" width="15"/.test(html),
      'an overlap with a held seat: one caution row — mark, the sentence (hook kept), and the OTHER class\'s tile in its own colour');
    ok(html.indexOf('Free cancel until') < html.indexOf('12 spots left') && html.indexOf('12 spots left') < html.indexOf('cds-clash'), 'row order: free-cancel · availability · clash (the clash row closes the group)');

    // Long names and hostile text.
    html = sheetWorld({ evt: { _typeName: 'RIDE: <b>The Very Long Signature Ride With Live DJ</b> 60', _instrName: 'A "B" <i>C</i>', _locName: 'Oxford <Circus>', _studioName: '' } });
    ok(!/<b>|<i>C|<Circus>/.test(html) && /&lt;b&gt;The Very Long/.test(html) && /class="cds-where">&middot; Oxford &lt;Circus&gt;</.test(html), 'class, instructor and place are API text: escaped; no studio → no dangling comma');
    ok(/\.cds-type \{[^}]*overflow-wrap: anywhere;/.test(section) && !/\.cds-type \{[^}]*white-space: nowrap/.test(section), '…and a long class name wraps instead of being clipped');
    html = sheetWorld({ evt: { _instrName: '', _locName: '', _studioName: '' } });
    ok(!/cds-who/.test(html), 'nobody and nowhere known: no empty line');
  }

  // ── The Booked sheet ─────────────────────────────────────────────────────
  t.section('Booked sheet: the tick in the class colour, your seat with the glow, neutral buttons');
  {
    let made = null;
    const ctx = t.vm.createContext({
      _eventCache: { 10: { start_at: '2030-09-24T19:00:00', _typeName: 'Strength 45', _instrName: 'Jonas' } }, announce() {}, escapeHTML,
      slotLabelForEvent: () => 'Bench', formatSlots: (l, s) => (s && s.length ? l + ' ' + s.join(' & ') : ''), _cancelDeadline: () => ({ insideWindow: false, label: 'Tue 07:00' }), _waitlistPhase: () => 'auto',
      classTypeKey: classType.classTypeKey, _uiIcon: p._uiIcon, _clock24: classType._clock24,
      document: { body: { appendChild() {} }, activeElement: null, createElement: () => (made = { id: '', className: '', innerHTML: '', classList: { add() {} }, contains: () => false, isConnected: true }), querySelectorAll: () => [] },
      requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {},
    });
    t.vm.runInContext('let _confirmationTimer = null;\n' + grab('function showBookingConfirmation(') + '\n' + grab('function dismissBookingConfirmation('), ctx);
    ctx.showBookingConfirmation(10, [7]);
    eq([made.id, made.className], ['bookingConfirmation', 'booking-confirmation'], 'the id everything polls for, and the exact class name, are unchanged');
    ok(/<div class="bc-content" data-ct="strength">\s*<div class="bc-check" aria-hidden="true"><svg class="ui-icon" width="22"/.test(made.innerHTML), 'data-ct on the content block; the tick is a drawn mark, decorative');
    ok(/<div class="bc-slot ct-badge is-seat glow-mine">Bench 7<\/div>/.test(made.innerHTML), 'the seat is the seat badge, with the glow — it is yours now');
    const actions = made.innerHTML.slice(made.innerHTML.indexOf('<div class="bc-actions">'));
    ok(/class="bc-btn bc-btn-secondary pill-btn pill-neutral"[^>]*>View my bookings</.test(actions) && /class="bc-btn bc-btn-primary pill-btn pill-primary"[^>]*>Done</.test(actions) && !/data-ct/.test(actions),
      'the buttons are neutral pills OUTSIDE the data-ct block (the class colour stays on the tick and the seat)');
    ok(/<div class="bc-title">Booked!<\/div>/.test(made.innerHTML) && /Free cancel until Tue 07:00/.test(made.innerHTML), 'title and free-cancel line as before');
    ctx.showBookingConfirmation(10, [], { waitlist: true });
    ok(/On the waitlist!/.test(made.innerHTML) && !/bc-slot/.test(made.innerHTML) && !/glow-mine/.test(made.innerHTML), 'a waitlist place: no seat, so nothing glows');
  }

  // ── Find similar, instructor profile, history ────────────────────────────
  t.section('Find similar / instructor / history: line marks and class colour, no emoji, no inline colour');
  {
    const fs = grab('window.findSimilar = function(eventId) {', '};');
    ok(!EMOJI.test(fs) && /optIcon\('calendar'\)/.test(fs) && /optIcon\('person'\)/.test(fs) && /optIcon\('clock'\)/.test(fs), 'the three options lead with _uiIcon marks');
    ok(/typeof _uiIcon === 'function' \? _uiIcon\(name, 18\) : ''/.test(fs), '…guarded, because tests/suites/bookings-card.js runs this function on its own');
    const again = between(appSrc, '// ── Extend findSimilar with the predicted "book again" suggestion', '// ── Wire the new Discover-tab surfaces');
    ok(!EMOJI.test(again) && /_uiIcon\('again', 18\)/.test(again), '"Book again" too (it was the sparkles emoji)');
    const hist = between(featSrc, '  function openHistoryModal() {', '  // ── Monkey-patch submitBooking');
    ok(/<div class="history-item\$\{isCancelled \? ' cancelled' : ''\}" data-ct="\$\{ct\}">/.test(hist) && /classTypeKey\(String\(entry\.typeName \|\| ''\)\)/.test(hist), 'a history row carries its class type as data-ct (an attribute — 2,000 rows stay cheap), from a coerced name');
    ok(!/style="/.test(hist) && /<div class="history-time">/.test(hist), 'no inline style left in the history rows (the time was an inline #888)');
    const prof = between(featSrc, '  function openInstructorModal(instrName, instrId) {', '    document.body.appendChild(overlay);');
    ok(/class="instructor-class-item" role="button" tabindex="0" data-ct="\$\{ct\}" data-event-id=/.test(prof) && /<span class="ct-tile is-lg" aria-hidden="true">\$\{classPictogram\(ct, 20\)\}<\/span>/.test(prof),
      'an instructor\'s class row is the compact class component: data-ct + the pictogram tile; still a keyboard-reachable button');
    ok(/class="instructor-view-schedule pill-btn pill-primary" data-instr-schedule="1"/.test(prof) && /class="instructor-view-schedule instructor-psycle-link pill-btn pill-outline"/.test(prof), 'its two actions are pills');
    // The row's status: Crisp primitives in Discover's own words — not the older sheets' 4px UPPERCASE .badge
    // tag in the old status palette ("2 LEFT", "FULL" in red: red is reserved for a late-cancel charge).
    const chipSrc = between(featSrc, '  function classStatusChip(evt) {', '  // ★ + S–F under the name');
    const chip = (evt, held, fresh) => {
      const ctx = t.vm.createContext({ Date, window: { _myBookings: held || {}, _countsFresh: () => fresh !== false, _spotsLeft: (e) => (Number.isFinite(e.capacity) ? Math.max(0, e.capacity - e.occupancy) : null) } });
      t.vm.runInContext(chipSrc + '\nthis.out = classStatusChip(' + JSON.stringify(evt) + ');', ctx, { filename: 'js/features.js[classStatusChip]' });
      return ctx.out ? Array.from(ctx.out) : ctx.out;
    };
    eq([chip({ id: 5 }, { 5: { waitlisted: false } }), chip({ id: 5 }, { 5: { waitlisted: true } })], [['Booked', 'ct-badge'], ['Waitlisted', 'ct-badge is-dashed']], 'yours: the class-colour badge; a place you hold: the dashed one');
    eq([chip({ id: 5, capacity: 21, occupancy: 19 }), chip({ id: 5, capacity: 21, occupancy: 7 })], [['Only 2 left', 'ct-badge'], ['14 spots left', 'instructor-class-status']], 'nearly full is the "Only 2 left" badge; otherwise a quiet "14 spots left" — Discover\'s wording');
    eq([chip({ id: 5, is_fully_booked: true, is_waitlistable: true }), chip({ id: 5, is_fully_booked: true })], [['Waitlist open', 'instructor-class-status'], ['Fully booked', 'instructor-class-status']], 'full is said quietly, never in red');
    eq([chip({ id: 5, capacity: 21, occupancy: 19 }, {}, false), chip({ id: 5 })], [null, null], 'a stale or unknown count says nothing');
    ok(/\$\{chip \? `<span class="\$\{chip\[1\]\}">\$\{escapeHtml\(chip\[0\]\)\}<\/span>` : ''\}/.test(prof) && !/class="badge/.test(prof), 'the row prints that class as is — no .badge tag is left in the profile');
    ok(/\.instructor-class-status \{[^}]*color: var\(--ct-ink-2, var\(--text-muted\)\);/.test(section) && !/\.instructor-class-item \.badge/.test(section), 'the quiet line is a guaranteed card ink (css/crisp.css); nothing restyles a .badge there');
    ok(prof.indexOf('class="instructor-class-day"') < prof.indexOf('class="instructor-class-time"') && prof.indexOf('class="instructor-class-day"') !== -1, 'day OVER time: the order the usual-week rows and My Bookings use (it was time over day)');
    // Intensity "off": --ct-card is the surface, and so is the modal panel the rows sit on.
    ok(/html\[data-ct-intensity="off"\] \.instructor-class-item \{ background: var\(--sunken\); \}/.test(section), '"off": the rows step down to the sunken well instead of vanishing into the panel (tests/suites/9a-foundation.js holds their inks on it)');
    const off = section.indexOf('html[data-ct-intensity="off"] .instructor-class-item {'), pressed = section.indexOf('.instructor-class-item[data-event-id]:active {');
    ok(off !== -1 && pressed > off, '…and a press still shows: the :active rule (0,3,0) outranks it');
  }

  // ── css/crisp.css, section 9c ────────────────────────────────────────────
  t.section('crisp:9c-sheets — shapes, the glow\'s four homes, and every ink on its ground in every theme');
  {
    ok(section.length > 4000, 'the section is there');
    ok(/\.modal, \.confirm-dialog \{[^}]*border-radius: var\(--radius-sheet\);[^}]*box-shadow: var\(--shadow-float\);/.test(section) && /\.class-detail-sheet \{[^}]*border-radius: var\(--radius-sheet\) var\(--radius-sheet\) 0 0;/.test(section) &&
      /\.booking-confirmation \{[^}]*border-radius: var\(--radius-sheet\);/.test(section), 'panels, dialogs and sheets take the sheet radius (28; Handheld zeroes it) and the one floating shadow');
    ok(/backdrop-filter: none;/.test(section), 'no glass on the scrim');
    ok(/#bikeSvg \.bike-slot rect \{[^}]*rx: var\(--radius-full\);[^}]*ry: var\(--radius-full\);/.test(section), 'seats take their corner from --radius-full: circles…');
    const gb = themeCss.slice(themeCss.indexOf('[data-theme="gameboy"] {'));
    ok(/--radius-full: 0;/.test(gb.slice(0, gb.indexOf('}'))), '…and squares on Handheld, which zeroes it');
    ok(/#bikeSvg \.bike-slot text \{[^}]*fill: var\(--seat-ink\) !important;[^}]*font-family: var\(--font-display\);/.test(section), 'seat numbers: the display face, in the seat state\'s own ink (the !important answers settings.css\'s fav / avoid inks)');
    ok(/#bikeSvg \.bike-slot:focus-visible rect \{ stroke: var\(--text\);[^}]*paint-order: normal; \}/.test(section), 'keyboard focus is still a ring drawn on the seat, over any state');
    ok(/@media \(hover: hover\) \{[^}]*#bikeSvg \.bike-slot\.available:hover/.test(section), 'hovers only where there is a hover (one sticks after a tap on iOS)');
    // The glow: the confirm pill once enabled, your pick / your seat, the seat badge, the sheet's action — and nothing else in this section.
    const glowRules = (section.match(/[^{}]+\{[^}]*(--glow-|drop-shadow\()[^}]*\}/g) || []).map((r) => r.slice(0, r.indexOf('{')).trim());
    eq(glowRules, ['#bikeSvg .bike-slot.selected rect, #bikeSvg .bike-slot.mine rect', '#confirmBookBtn:not(:disabled)'], 'in CSS the glow lives on your seats and on the enabled confirm pill only');
    // …and that pill is ON SCREEN: the picker's actions ride the panel's bottom edge, as the class sheet's do.
    // (375 x 667: header + legend + map pushed Book — the only way forward — 70px under the fold.)
    const stick = (sel) => (new RegExp('\\n' + sel.replace(/[.#]/g, '\\$&') + ' \\{([^}]*)\\}').exec(section) || [])[1] || '';
    ok(/position: sticky;\s*bottom: 0;/.test(stick('#bikeModal .modal-actions')) && /background: var\(--surface\);/.test(stick('#bikeModal .modal-actions')) && /position: sticky;\s*bottom: 0;/.test(stick('.cds-actions')),
      'both sheets keep their primary action in view: sticky to the bottom, on the panel\'s own surface');
    ok(/margin: 0;\s*padding: var\(--space-3\) var\(--space-7\) var\(--space-7\);/.test(stick('#bikeModal .modal-actions')) && !/#bikeModal \.modal-policy, #bikeModal \.modal-actions \{/.test(section),
      'full width (padding, not the side margins the map has), so the map passes UNDER the bar — with room above the pill for its glow ring');
    ok(/#bikeModal \.modal-actions \{ padding-bottom: calc\(var\(--space-7\) \+ env\(safe-area-inset-bottom\)\); \}/.test(section), 'a phone\'s home indicator is cleared by padding (it was a margin: the bar would not have covered it)');
    const sheetSrc = grab('window.openClassDetail = function (eventId) {', '};');
    eq((sheetSrc.match(/glow-mine/g) || []).length, 3, 'in the sheet: Book, Claim spot and the seat you hold — never Join / Leave / Full / Attended');
    ok(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.class-detail-sheet, \.find-similar-popup \{ animation: none; \}/.test(section), 'reduced motion: the sheet and the popup do not slide');
    ok(!/\.app-banner[^{]*\{[^}]*padding/.test(section), 'the banners\' own spacing is left alone (discover-layout-fix.css owns the desktop inset)');
    ok(/\.confirm-btn-danger \{ --pill-fill: var\(--surface\); --pill-ink: var\(--danger\); --pill-line: var\(--danger\); \}/.test(section) &&
      /\.confirm-btn-danger\.is-solid \{ --pill-fill: var\(--danger\); --pill-ink: var\(--danger-ink\);/.test(section), 'danger = outline on the surface; .is-solid = the filled pair');
    // (Wave 10c: the mark moved from a generated "!" tile into the markup — a line mark, like every other on these sheets.)
    ok(/\.confirm-dialog \.confirm-warn::before \{ content: none; \}/.test(section) && /const warnMark = typeof _uiIcon === 'function' \? _uiIcon\('caution', 16\) : '';/.test(appSrc),
      'the dialog\'s caution mark is a drawn line mark in the markup (_uiIcon) — never the warning-sign glyph iOS renders as an emoji: the generated one is switched off');

    // Contrast, from the shipped tokens.
    const HEX = /^#[0-9a-f]{6}$/i;
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16));
    const lum = (hex) => { const c = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const contrast = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    const tokensOf = (selector) => {
      const start = themeCss.indexOf(selector + ' {');
      if (start === -1) return {};
      const out = {};
      noComments(themeCss.slice(themeCss.indexOf('{', start) + 1, themeCss.indexOf('}', start))).replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
      return out;
    };
    const rootTk = tokensOf(':root');
    const themeTokens = (id) => {
      const tk = Object.assign({}, rootTk, tokensOf('[data-theme="' + id + '"]'));
      const resolve = (v, depth) => { const m = /^var\((--[a-z0-9-]+)\)$/.exec(v || ''); return m && depth < 6 ? resolve(tk[m[1]], depth + 1) : v; };
      Object.keys(tk).forEach((k) => { tk[k] = resolve(tk[k], 0); });
      return tk;
    };
    const ids = [];
    themeJs.replace(/\{\s*id:\s*'([a-z]+)'/g, (m, id) => { ids.push(id); return m; });
    eq(ids.length, 5, 'five themes read from the registry');
    // [what, ink token, ground token] — each pair is one this section paints.
    const PAIRS = [
      ['an available seat number (soft / off)', '--text', '--surface'],
      ['a taken seat number', '--text-dim', '--sunken'],
      ['sheet rows, the picker hint, history meta', '--text-muted', '--ground'],
      ['the note beside Book, dialog body', '--text-muted', '--surface'],
      ['a neutral pill / the × / a keyword chip', '--text', '--sunken'],
      ['keyword chips, the Cancelled tag', '--text-muted', '--sunken'],
      // Wave 10c: a clash is ONE quiet line — the body ink on the ground it already sits on, no fill of its own.
      ['the clash row: the body ink on the list\'s ground', '--text', '--ground'],
      ['a dialog\'s warn line: the body ink on the dialog', '--text', '--surface'],
      ['the late-cancel warn line — the one that keeps a ground', '--text-heading', '--badge-waitlist-bg'],
      ['a calm danger pill', '--danger', '--surface'],
      ['a filled danger pill', '--danger-ink', '--danger'],
    ];
    let worst = { v: 99, what: '' };
    ids.forEach((id) => {
      const tk = themeTokens(id);
      PAIRS.forEach((row) => {
        const ink = tk[row[1]], ground = tk[row[2]];
        if (!HEX.test(ink) || !HEX.test(ground)) { ok(false, id + ': ' + row[1] + ' / ' + row[2] + ' did not resolve to a colour (' + ink + ', ' + ground + ')'); return; }
        const r = contrast(ink, ground);
        if (r < worst.v) worst = { v: r, what: id + ' · ' + row[0] };
        if (!(r >= 4.5)) ok(false, id + ': ' + row[0] + ' — ' + row[1] + ' on ' + row[2] + ' is ' + r.toFixed(2) + ':1 (needs ≥4.5)');
      });
    });
    ok(worst.v >= 4.5, (ids.length * PAIRS.length) + ' ink / ground pairs of this section hold 4.5:1 in every theme — the tightest is ' + worst.what + ' at ' + worst.v.toFixed(2) + ':1');
    // Each pair above is really what the section reads.
    [[/#bikeSvg \.bike-slot\.taken \{ --seat-fill: var\(--sunken\); --seat-line: transparent; --seat-ink: var\(--text-dim\); \}/, 'taken seat = --text-dim on --sunken'],
      [/--seat-free-fill: var\(--surface\);\s*--seat-free-line: var\(--line\);\s*--seat-free-ink: var\(--text\);/, 'available seat = --text on --surface with a hairline'],
      [/html\[data-ct-intensity="bold"\] #bikeModal\[data-ct\] \{\s*--seat-free-fill: var\(--ct-tint\);\s*--seat-free-line: var\(--ct-ring\);\s*--seat-free-ink: var\(--ct-deep\);/, 'at "bold": the boards\' seat — deep ink on the tint (≥7:1, 9a-foundation.js)'],
      [/--seat-mine-fill: var\(--ct-base, var\(--accent\)\);\s*--seat-mine-ink: var\(--ct-on-base, var\(--accent-ink\)\);/, 'your pick / your seat = the label ink on the class base (≥4.5:1, 9a-foundation.js), the accent pair as the fallback'],
      [/\.cds-detail-row \.cds-avail, \.cds-detail-row \.cds-avail-full, \.cds-detail-row \.cds-avail-waitlist \{[^}]*color: var\(--text\);/, 'clash text = --text (the availability rows\' own rule: it is a row like its neighbours)'],
      [/\.cds-details \{[^}]*background: var\(--ground\);/, 'clash ground = the list\'s own --ground'],
      [/\.confirm-warn \{[^}]*background: none;[^}]*color: var\(--text\);/, 'a dialog\'s warn line = --text, no ground'],
      [/\.confirm-warn\.late-cancel-note \{[^}]*background: var\(--badge-waitlist-bg\);[^}]*color: var\(--text-heading\);/, 'the late-cancel warn = --text-heading on --badge-waitlist-bg'],
      [/\.cds-time \{ color: var\(--ct-ink\);/, 'the sheet time = --ct-ink on the class card'],
      [/\.cds-type \{[^}]*color: var\(--ct-deep\);/, 'the class name = --ct-deep'],
      [/\.cds-date \{[^}]*color: var\(--ct-ink-2\);/, 'the date line = --ct-ink-2'],
    ].forEach((row) => ok(row[0].test(section), row[1]));
    ok(!/var\(--text-(faint|ghost|off)\)/.test(section), 'no copy in this section is set in --text-faint / -ghost / -off (not guaranteed on a tint or on the sunken ground)');
    ok(!/var\(--badge-(highlight|full)-(text|bg|border)\)/.test(section), 'and none in the old status inks: on these sheets colour means class type');
  }
};
