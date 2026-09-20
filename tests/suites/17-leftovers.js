'use strict';
// The "Known small leftovers" of IMPROVEMENTS-2026-09.md that were closed out:
//   • the inline date picker: stepping a month, or picking a day, kept no keyboard focus
//     (js/app.js calStep, pickCalDate),
//   • the next-class pill kept the last class's words while hidden (js/settings.js updatePill),
//   • the seat map scrolled sideways with no hint (css/crisp.css .bike-map-wrap),
//   • values that bypassed the tokens in the older sheets (css/styles.css, css/theme.css),
//   • the rule of a no-photo disc nothing prints any more.
// The REAL functions, sliced out of source and run against small fakes; the CSS is
// read as text. (The offline queue's two — the emptied status line and the seat
// word an "Offline booking" dialog prints after a relaunch — are in offline-queue.js,
// which already runs that whole section.)
module.exports = async function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const settingsSrc = t.readSource('js/settings.js');
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const grab = (src, opener, closer) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    if (from === -1) throw new Error('17-leftovers suite: cannot find "' + opener + '" (anchor moved?)');
    const to = lines.findIndex((l, i) => i > from && l === closer);
    if (to === -1) throw new Error('17-leftovers suite: unterminated "' + opener + '"');
    return lines.slice(from, to + 1).join('\n');
  };
  // The body of the ONE rule with exactly this selector (comments already out).
  const rule = (css, selector) => {
    const at = css.indexOf('\n' + selector + ' {');
    return at === -1 ? null : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // ── Inline date picker: a month step keeps keyboard focus ────────────────
  t.section('Date picker: stepping a month keeps keyboard focus in the calendar');
  {
    const world = () => {
      const w = { renders: 0, focused: [] };
      const mkNav = (name) => ({ name, focus() { w.focused.push(this); w.doc.activeElement = this; } });
      w.day = { name: 'a day cell' };
      w.el = {
        navs: [mkNav('prev #0'), mkNav('next #0')],
        contains: (n) => n === w.day || w.el.navs.indexOf(n) !== -1,
        querySelectorAll: (sel) => { if (sel !== '.cal-nav') throw new Error('unexpected selector ' + sel); return w.el.navs; },
      };
      w.doc = { body: { name: 'body' }, activeElement: null, getElementById: (id) => (id === 'datePicker' ? w.el : null) };
      w.doc.activeElement = w.doc.body;
      w.ctx = t.vm.createContext({
        document: w.doc,
        // What the real one does to the page: every node of the disclosure is
        // replaced, and focus on a removed node falls back to <body>.
        renderCalendar: () => { w.renders++; w.el.navs = [mkNav('prev #' + w.renders), mkNav('next #' + w.renders)]; w.doc.activeElement = w.doc.body; },
      });
      t.vm.runInContext('var _calMonth = null;\n' + grab(appSrc, 'function calStep(', '}') + '\nfunction __month(v) { if (v !== undefined) _calMonth = v; return _calMonth; }', w.ctx, { filename: 'js/app.js[calStep]' });
      return w;
    };

    let w = world();
    w.ctx.__month({ y: 2026, m: 8 });
    w.doc.activeElement = w.el.navs[1];
    w.ctx.calStep(1);
    eq([w.ctx.__month(), w.renders, w.focused.map((n) => n.name), w.doc.activeElement === w.el.navs[1]], [{ y: 2026, m: 9 }, 1, ['next #1'], true],
      'Enter on "Next month": October, and focus is on the NEW next arrow (the pressed one no longer exists)');
    w.ctx.calStep(1); w.ctx.calStep(1); w.ctx.calStep(1);
    eq([w.ctx.__month(), w.doc.activeElement.name], [{ y: 2027, m: 0 }, 'next #4'], '…press after press, over the year end — focus never leaves the calendar');
    w.doc.activeElement = w.el.navs[0];
    w.ctx.calStep(-1);
    eq([w.ctx.__month(), w.doc.activeElement.name], [{ y: 2026, m: 11 }, 'prev #5'], '"Previous month" hands focus to the new PREVIOUS arrow, back over the year start');
    w.doc.activeElement = w.day;
    w.ctx.calStep(1);
    eq(w.doc.activeElement.name, 'next #6', 'focus anywhere in the calendar counts (a day cell is rebuilt too)');

    w = world();
    w.ctx.__month({ y: 2026, m: 8 });
    w.ctx.calStep(1);
    eq([w.ctx.__month(), w.renders, w.focused.length], [{ y: 2026, m: 9 }, 1, 0],
      'focus nowhere (a tap in Safari never focuses the button): the month steps and NOTHING is focused — no ring appears after a tap');
    w.doc.activeElement = { name: 'the instructor search box' };
    w.ctx.calStep(-1);
    eq([w.renders, w.focused.length], [2, 0], 'focus in another control: left where it is');

    w = world();
    w.ctx.calStep(1);
    eq([w.ctx.__month(), w.renders], [null, 0], 'never opened (no month yet): nothing to step, no render');
    w.ctx.__month({ y: 2026, m: 8 });
    w.doc.getElementById = () => null;
    w.ctx.calStep(1);
    eq([w.ctx.__month(), w.focused.length], [{ y: 2026, m: 9 }, 0], 'no #datePicker in the page: the month still steps, nothing throws');
    ok(/if \(at && at !== document\.body && at !== btn && !el\.contains\(at\)\) return;/.test(grab(appSrc, 'function _wireDatePickerKeys(', '}')),
      'Escape still takes "focus nowhere" as its own: that is what a pointer press on an arrow leaves in Safari');
  }

  // ── Inline date picker: picking a day hands focus back to its button ─────
  t.section('Date picker: picking a day with the keyboard leaves focus on the calendar button');
  {
    const world = (o = {}) => {
      const w = { calls: [], focusedAfter: null };
      w.day = { name: 'a day cell' };
      w.btn = { name: '#pickDateBtn', focus() { w.focusedAfter = w.calls.slice(); w.doc.activeElement = this; } };
      // What the page does: hiding the calendar hides the focused cell with it,
      // and focus on a hidden node falls back to <body>.
      let shown = '';
      w.el = {
        contains: (n) => n === w.day,
        style: { get display() { return shown; }, set display(v) { shown = v; if (v === 'none' && w.el.contains(w.doc.activeElement)) w.doc.activeElement = w.doc.body; } },
      };
      w.inputs = { startDate: { value: '' }, daysAhead: { value: 7 } };
      const els = { datePicker: w.el, pickDateBtn: o.noButton ? null : w.btn, startDate: w.inputs.startDate, daysAhead: w.inputs.daysAhead };
      w.doc = { body: { name: 'body' }, activeElement: null, getElementById: (id) => els[id] || null };
      w.doc.activeElement = w.doc.body;
      w.ctx = t.vm.createContext({
        document: w.doc,
        onDateInputChange: () => w.calls.push('change'),
        _syncDatePills: () => w.calls.push('pills, calendar ' + (shown === 'none' ? 'closed' : 'open')),
      });
      t.vm.runInContext("var _dateQuickMode = 'today';\n" + grab(appSrc, 'function pickCalDate(', '}') + '\nfunction __mode() { return _dateQuickMode; }', w.ctx, { filename: 'js/app.js[pickCalDate]' });
      return w;
    };

    let w = world();
    w.doc.activeElement = w.day;
    w.ctx.pickCalDate('2026-09-30');
    eq([w.inputs.startDate.value, w.inputs.daysAhead.value, w.ctx.__mode(), w.el.style.display], ['2026-09-30', 1, null, 'none'], 'Enter on a day: that one day, no preset, the calendar closed — as before');
    eq([w.doc.activeElement.name, w.focusedAfter], ['#pickDateBtn', ['change', 'pills, calendar closed']],
      'and focus is on the calendar button (it fell to <body> with the hidden cell) — handed over LAST, once the button reads the chosen day');

    w = world();
    w.ctx.pickCalDate('2026-09-30');
    eq([w.el.style.display, w.calls, w.focusedAfter], ['none', ['change', 'pills, calendar closed'], null],
      'focus nowhere (a tap in Safari never focuses the cell): the day is picked and NOTHING is focused — no ring appears after a tap');
    w = world();
    w.doc.activeElement = { name: 'the instructor search box' };
    w.ctx.pickCalDate('2026-09-30');
    eq([w.focusedAfter, w.doc.activeElement.name], [null, 'the instructor search box'], 'focus in another control: left where it is');

    w = world({ noButton: true });
    w.doc.activeElement = w.day;
    w.ctx.pickCalDate('2026-09-30');
    eq([w.inputs.startDate.value, w.calls.length], ['2026-09-30', 2], 'no #pickDateBtn in the page: the day is still picked, nothing throws');
  }

  // ── The next-class pill: hidden, then emptied ────────────────────────────
  t.section('Next-class pill: the last class leaves the page once the pill is hidden');
  {
    const lines = settingsSrc.split('\n');
    const from = lines.findIndex((l) => l.startsWith('  function updatePill('));
    const to = lines.findIndex((l, i) => i > from && l === '  }');
    ok(from !== -1 && to > from, 'updatePill can be sliced');
    const NOWMS = new Date('2026-09-21T13:00:00').getTime();
    class FixedDate extends Date {
      constructor(...a) { if (a.length) super(...a); else super(NOWMS); }
      static now() { return NOWMS; }
    }
    const classes = new Set(['next-class-pill', 'hidden']);
    const pill = {
      innerHTML: '', labels: [],
      get textContent() { return this.innerHTML.replace(/<[^>]*>/g, ''); },
      set textContent(v) { this.innerHTML = String(v); },
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    };
    const ctx = t.vm.createContext({
      Date: FixedDate, Object, Math, isNaN,
      _myBookings: { 77: { bookingId: 'A', slots: [12], waitlisted: false } },
      _eventCache: { 77: { id: 77, start_at: '2026-09-21T18:00:00', _typeName: 'Ride 45', _instrName: 'Alex', _locName: 'Bank' } },
      escapeHTML: (x) => String(x), formatSlots: (l, n) => l + ' ' + n.join(' & '), slotLabelForEvent: () => 'Bike',
      _pillEl: pill, _pillA11y: (label) => { pill.labels.push(label); },
    });
    t.vm.runInContext(lines.slice(from, to + 1).join('\n'), ctx, { filename: 'js/settings.js[updatePill]' });

    ctx.updatePill();
    ok(!classes.has('hidden') && /Ride 45 — Alex/.test(pill.textContent) && /Bike 12/.test(pill.textContent), 'a class ahead: the pill shows it');
    ctx._myBookings = {}; // the last booking is cancelled, still signed in
    ctx.updatePill();
    eq([classes.has('hidden'), pill.labels[pill.labels.length - 1], /Ride 45 — Alex/.test(pill.textContent)], [true, null, true],
      'cancelled: hidden and un-named at once — and it fades out WITH its words (an emptied pill would be seen to collapse)');
    ctx.updatePill();
    eq([classes.has('hidden'), pill.textContent, pill.innerHTML], [true, '', ''], 'the next pass (the 30 s tick at the latest) empties it: the cancelled class is no longer in the page');
    ctx.updatePill();
    eq(pill.innerHTML, '', '…and stays empty while there is nothing to show');
    ctx._myBookings = { 77: { bookingId: 'B', slots: [3], waitlisted: false } };
    ctx.updatePill();
    ok(!classes.has('hidden') && /Bike 3/.test(pill.textContent), 'booked again: the markup is written afresh before the pill shows');
    ok(/if \(_pillEl\.classList\.contains\('hidden'\)\) _pillEl\.textContent = '';\s*\n\s*\}\);/.test(settingsSrc), 'a sign-out or account change still empties a hidden pill at once (tests/suites/7a-final-polish.js runs that listener)');
  }

  // ── The seat map says when it scrolls sideways ───────────────────────────
  t.section('Seat picker: a map wider than the sheet shows that it scrolls');
  {
    const crisp = noComments(t.readSource('css/crisp.css'));
    const styles = noComments(t.readSource('css/styles.css'));
    const theme = noComments(t.readSource('css/theme.css'));
    ok(/overflow:\s*auto/.test(rule(styles, '.bike-map-wrap') || ''), 'css/styles.css: the wrap is the sideways scroller (showBikePicker keeps the seats a tappable size past 420px)');
    ok(/min-width:\$\{Math\.min\(svgW, 420\)\}px/.test(appSrc), '…js/app.js still gives the map that floor');
    const body = rule(crisp, '.bike-map-wrap') || '';
    const bg = (/background:\s*([\s\S]*?);/.exec(body) || [])[1] || '';
    const layers = bg.split(/,\s*\n/).map((l) => l.trim());
    eq(layers.length, 5, 'css/crisp.css: four layers over the ground colour');
    const cover = /^linear-gradient\(var\(--ground\), var\(--ground\)\) (left|right) center \/ var\((--space-\d+)\) 100% no-repeat local$/;
    const shade = /^linear-gradient\(to (right|left), var\(--line\), transparent\) (left|right) center \/ var\((--space-\d+)\) 100% no-repeat scroll$/;
    const c = [cover.exec(layers[0]), cover.exec(layers[1])], s = [shade.exec(layers[2]), shade.exec(layers[3])];
    ok(c[0] && c[1] && c[0][1] === 'left' && c[1][1] === 'right', 'a cover of the map\'s own ground rides each END of the content (background-attachment: local)…');
    ok(s[0] && s[1] && s[0][2] === 'left' && s[0][1] === 'right' && s[1][2] === 'right' && s[1][1] === 'left',
      '…over a shade fixed to each side EDGE (scroll), fading inwards: an edge is shaded only while seats lie beyond it');
    eq(layers[4], 'var(--ground)', 'the ground itself is the last layer: a map that fits looks exactly as it did');
    const px = (name) => Number((new RegExp(name + ':\\s*(\\d+)px').exec(theme) || [])[1]);
    ok(c[0] && s[0] && c[0][2] === c[1][2] && s[0][3] === s[1][3] && px(c[0][2]) > px(s[0][3]) && px(s[0][3]) > 0,
      'each cover is wider than the shade it hides (' + (c[0] && c[0][2]) + ' over ' + (s[0] && s[0][3]) + '), so no sliver shows at the end of the scroll');
    ok(!/#[0-9a-f]{3,8}\b|rgba?\(|\d+px/i.test(body), 'tokens only, as everywhere in css/crisp.css');
  }

  // ── Values that bypassed the tokens ──────────────────────────────────────
  t.section('Older sheets: the booked button, its radius and the class sheet\'s corners read the tokens');
  {
    const styles = noComments(t.readSource('css/styles.css'));
    const theme = noComments(t.readSource('css/theme.css'));
    const booked = rule(styles, '.book-btn.booked') || '';
    ok(/background:\s*var\(--booked-bg\);\s*color:\s*var\(--accent\);\s*border:\s*1px solid var\(--booked-border\);/.test(booked) && !/#[0-9a-f]{3,8}\b/i.test(booked),
      'css/styles.css .book-btn.booked: the theme\'s own booked colours, no fixed pink');
    eq((theme.match(/(^|\n)\.book-btn\.booked\s*\{/g) || []).length, 0, 'css/theme.css: the copy of those literals is gone…');
    ok(!/\[data-theme="graphite"\] \.book-btn\.booked/.test(theme), '…and with it the Graphite rule that existed only to undo them');
    ok(/:is\(\[data-theme="light"\], \[data-theme="cloud"\]\) \.book-btn\.booked \{/.test(theme), 'the light bases keep their own (tests/suites/2e-css-layout.js holds its contrast)');
    ['--booked-bg', '--booked-border', '--accent'].forEach((tok) => ok(new RegExp('\\n\\s*' + tok + ':').test(theme), tok + ' is defined in css/theme.css'));
    ok(/border-radius:\s*var\(--radius-sm\);/.test(rule(styles, '.book-btn') || ''), 'css/styles.css .book-btn: a radius token (Handheld zeroes it)');
    ok(/border-radius:\s*var\(--radius-4xl\) var\(--radius-4xl\) 0 0;/.test(rule(styles, '.class-detail-sheet') || ''), 'css/styles.css .class-detail-sheet: its top corners too');
    const everywhere = ['css/styles.css', 'css/theme.css', 'css/crisp.css', 'css/features.css', 'css/redesign.css', 'js/app.js', 'js/features.js']
      .map((f) => t.readSource(f)).join('\n');
    ok(everywhere.indexOf('cds-photo-placeholder') === -1, 'the no-photo disc\'s rule went with the disc: with no photo the class sheet draws none (js/app.js openClassDetail)');
  }

  t.section('Date row: the calendar button grows into a pill when it carries a picked date');
  {
    // `_syncDatePills` swaps the calendar mark for words ("Sat 26 Sept"). A fixed width clipped them to "at 26 Sep" in
    // the round button; the width must be a MINIMUM, with side padding for the words.
    const crisp = t.readSource('css/crisp.css');
    const rules = []; const re = /^\.date-quick-btn\.date-pick\s*\{([^}]*)\}/gm; let m;
    while ((m = re.exec(crisp))) rules.push(m[1]);
    ok(rules.length >= 1, 'css/crisp.css styles .date-quick-btn.date-pick (selector moved?)');
    const body = rules.join('\n');
    ok(/min-width:\s*var\(--space-12\)/.test(body), 'the circle is a MINIMUM width (the mark still sits in a --space-12 circle)');
    ok(!/(^|[;\s])width:/.test(body.replace(/min-width:[^;]*;/g, '')), 'no fixed width is left to clip a picked date');
    ok(/padding:\s*0\s+var\(--space-\d+\)/.test(body), 'side padding gives the words room; none above or below (the height is fixed)');
    ok(/flex:\s*none/.test(body), 'the pill never shrinks beside the ranges: the row scrolls instead');
    const app = t.readSource('js/app.js');
    ok(/btn\.textContent = label;/.test(app) && /\(showing ' \+ label \+ '\)'/.test(app), '_syncDatePills still prints the date on the button and in its name (anchor moved?)');
  }

  t.section('"Same class next week": the carrier button is in the page but never on screen');
  {
    const app = t.readSource('js/app.js');
    const at = app.indexOf('async function rebookNextWeek(');
    const end = app.indexOf('\n}\n', at);
    const fn = at !== -1 && end !== -1 ? app.slice(at, end) : '';
    ok(fn.length > 0, 'rebookNextWeek found (anchor moved?)');
    ok(/btn\.className = 'book-btn';/.test(fn) && /document\.body\.appendChild\(btn\);/.test(fn) && /btn\.remove\(\);/.test(fn),
      'the carrier is a .book-btn IN the document while bookClass runs (the two busy guards find it by class), and is removed after');
    ok(/btn\.style\.display = 'none';/.test(fn) && /aria-hidden/.test(fn) && /btn\.tabIndex = -1;/.test(fn),
      'and it is never drawn, spoken or tabbed to: parked on <body> it was a full-width bar on the desktop layout');
    ok(fn.indexOf("btn.style.display = 'none';") < fn.indexOf('document.body.appendChild(btn);'), 'hidden BEFORE it is attached, so it never paints');
  }
};
