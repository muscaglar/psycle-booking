'use strict';
// Wave 13b — the "Your usual week" CARD (js/tabs.js, css/crisp.css 9d §7).
// The owner: "I want to be able to collapse the 'Book my week' section so it
// doesn't take up too much space" — and, of its button, "I'm scared to press it
// — what will it do?". What is held here:
//   • the card is a DISCLOSURE: a real <button aria-expanded aria-controls> in a
//     real heading, no chevron; folded it is ONE row and "Review and book" is
//     still on it; the state is localStorage psycle_usual_week_collapsed
//     ('1' | absent), read defensively, default EXPANDED;
//   • the head is the SAME in both states — the two differ in aria-expanded and
//     the Show / Hide word, nothing else — so the toggle can flip in place: the
//     pressed button stays the same node (focus, a screen reader's cursor) and
//     its state is what announces the change. No toast;
//   • renderUsualWeekCard runs on every bookings / auth event: it never rewrites
//     a card that already says the same thing (no flicker, no lost focus), and
//     the first signed-in paint of a folded card IS folded;
//   • the primary reads as a review ("Review and book"), once, with every hook
//     other code reads kept; "2 seats" on an entry that books more than one;
//   • the look: tokens, tap targets, the focus ring, inks that hold 4.5:1 on the
//     card in every registered theme, and the fold's `display: none` with no
//     rule anywhere that could outrank it.
// DOM-free: the decisions are run as tables (pure:usual-week-card), the SHIPPED
// render + toggle are sliced out of source and run over a small fake card.
// Nothing here can reach Psycle.
module.exports = function (t) {
  const { ok, eq } = t;
  const tabsSrc = t.readSource('js/tabs.js');
  const themeJs = t.readSource('js/theme.js');
  const themeCss = t.readSource('css/theme.css');
  const crispAll = t.readSource('css/crisp.css');
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const KEY = 'psycle_usual_week_collapsed';
  const escapeHTML = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // What the builder calls, as the page has it: the compact-row helpers of
  // pure:usual-week-crisp, app.js's class-type key + pictogram, the ONE clock.
  const clock = t.loadPure('js/app.js', 'clock');
  const crispRow = t.loadPure('js/tabs.js', 'usual-week-crisp', { _clock24: clock._clock24 });
  const ct = t.loadPure('js/app.js', 'core', { window: {} });
  {
    const src = t.readSource('js/app.js');
    const a = src.indexOf('// ── pure:class-type:start'), b = src.indexOf('// ── pure:class-type:end', a);
    if (a === -1 || b === -1) throw new Error('14b suite: no pure:class-type markers in js/app.js');
    t.vm.runInContext(src.slice(a, b), ct, { filename: 'js/app.js[14b class-type]' });
  }
  const helpers = () => ({
    escapeHTML,
    UW_DAYS: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    _uwPlural: (n, one, many) => n + ' ' + (n === 1 ? one : many),
    _uwTime: crispRow._uwTime,
    _uwTypeOf: crispRow._uwTypeOf,
    _uwTimeHtml: (m) => '<span class="t-time is-compact">' + crispRow._uwTime(m) + '</span>',
    _uwMark: (name) => crispRow._uwClassMark(name, ct.classTypeKey, ct.classPictogram),
  });
  // The two one-line wrappers above are tabs.js's own — held to the source, so this suite cannot drift from it.
  ok(/function _uwTimeHtml\(totalMin\) \{\s*return '<span class="t-time is-compact">' \+ _uwTime\(totalMin\) \+ '<\/span>';\s*\}/.test(tabsSrc) &&
    /function _uwPlural\(n, one, many\) \{ return n \+ ' ' \+ \(n === 1 \? one : many\); \}/.test(tabsSrc) &&
    /var UW_DAYS = \['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'\];/.test(tabsSrc),
    '14b: the helpers this suite hands the builder are tabs.js\'s own, word for word');
  const u = t.loadPure('js/tabs.js', 'usual-week-card', helpers());

  const WEEK = [
    { dayOfWeek: 1, hour: 7, minute: 30, locationId: 1, eventTypeId: 201, instructorId: 101, label: 'RIDE: 45 · Alex Hart', locName: 'Psycle Oxford Circus' },
    { dayOfWeek: 3, hour: 18, minute: 30, locationId: 2, eventTypeId: 202, instructorId: 102, label: 'STRENGTH: Full Body · Bea Collins', locName: 'Psycle Shoreditch', seats: 2 },
    { dayOfWeek: 6, hour: 9, minute: 30, locationId: 1, eventTypeId: 203, instructorId: 103, label: 'YOGA: Flow · Cam Reyes', seats: 3 },
    { dayOfWeek: 4, hour: 12, minute: 15, locationId: 3, eventTypeId: 204, instructorId: 104, label: 'REFORMER: Signature · Dee Okoro', locName: 'Psycle Clapham' },
  ];
  const rowsOf = (html) => html.split('<li ').slice(1).map((r) => r.slice(0, r.indexOf('</li>')));
  const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '');

  // ════════════════════════════════════════════════════════════════════
  // 1. The stored state
  // ════════════════════════════════════════════════════════════════════
  t.section('13b: collapsed or not — psycle_usual_week_collapsed is \'1\' | absent, read defensively, default EXPANDED');
  {
    eq(u.UW_COLLAPSED_KEY, KEY, 'the key the three agents of this wave agreed on');
    eq([u._uwCollapsedFrom(null, null), u._uwCollapsedFrom(undefined, null), u._uwCollapsedFrom('', null)], [false, false, false], 'nothing stored → expanded, until the member folds it');
    eq(u._uwCollapsedFrom('1', null), true, '\'1\' → collapsed');
    eq(['0', 'true', 'yes', ' 1', '1 ', '11', 'collapsed', '{"v":1}', 'null'].map((v) => u._uwCollapsedFrom(v, null)), [false, false, false, false, false, false, false, false, false],
      'anything else an import (or an older build) could leave there → expanded: the whole card is the safe reading');
    eq([u._uwCollapsedFrom(1, null), u._uwCollapsedFrom(true, null), u._uwCollapsedFrom({}, null)], [false, false, false], 'only the STRING \'1\' (localStorage holds strings; a fake that does not is not believed)');
    eq([u._uwCollapsedFrom(null, true), u._uwCollapsedFrom('1', false)], [true, false], 'what the member did in this page session wins — so the card still folds where storage is blocked, and unfolds where a remove did not stick');
    eq([u._uwCollapsedFrom('1', undefined), u._uwCollapsedFrom('1', 0), u._uwCollapsedFrom(null, 'true')], [true, true, false], 'a session value that is not a boolean is not one: storage decides');
    eq([u._uwToggleWord(false), u._uwToggleWord(true)], ['Hide', 'Show'], 'the word says what a press does — a plain word, never a chevron');
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. Seats on a row
  // ════════════════════════════════════════════════════════════════════
  t.section('13b: "2 seats" on an entry that books more than one — an integer 1–4, anything else is 1');
  {
    eq([1, 2, 3, 4].map(u._uwCardSeats), [1, 2, 3, 4], 'Psycle\'s own range per booking');
    eq([0, -2, 5, 40, 2.5, NaN, Infinity].map(u._uwCardSeats), [1, 1, 1, 1, 1, 1, 1], 'outside it, or not whole → 1');
    eq([undefined, null, '2', '', true, [2], { seats: 2 }].map(u._uwCardSeats), [1, 1, 1, 1, 1, 1, 1], 'an entry saved before seats existed, and anything that is not a number → 1 (the card never promises a seat the stored entry does not plainly hold)');
    const rows = rowsOf(u._uwCardHtml(WEEK, false));
    eq(rows.length, 4, 'one row per entry');
    ok(/<span class="usual-week-seats"><span class="usual-week-sep"> · <\/span>2 spots<\/span>/.test(rows[1]) && /3 spots/.test(rows[2]), '"2 spots" / "3 spots" on their rows (the owner\'s word, as everywhere else)');
    ok(!/usual-week-seats/.test(rows[0]) && !/usual-week-seats/.test(rows[3]) && !/\bseats?\b/.test(text(rows[0])), 'one seat is not said: the rows of a member who never books two look as they did');
    ok(rows[1].indexOf('usual-week-seats') < rows[1].indexOf('usual-week-where') && rows[1].indexOf('usual-week-seats') > rows[1].indexOf('STRENGTH'),
      'it LEADS the second line, before the studio: the ellipsis takes the end of a line, and the count must never be what it eats');
    eq(rowsOf(u._uwCardHtml([Object.assign({}, WEEK[1], { seats: 9 }), Object.assign({}, WEEK[1], { seats: '3' })], false)).map((r) => /usual-week-seats/.test(r)), [false, false], 'stored junk prints no seat count');
    // THE SEAM with the review sheet (wave 13 integration). The card SAYS how many
    // seats an entry books; the sheet reads the SAME stored field through app.js
    // _templateSeats and starts its seat count there — the number it offers to
    // SPEND. Two rules, two files: they met once already ('3' was 1 here and 3
    // there). Held together over one table, the shipped functions both.
    const sheetSide = t.loadPure('js/app.js', 'template');
    ok(typeof sheetSide._templateSeats === 'function', 'app.js pure:template carries _templateSeats (anchor moved?)');
    const STORED = [1, 2, 3, 4, 0, -2, 5, 40, 2.5, NaN, Infinity, -Infinity, undefined, null, '', '1', '2', '3', ' 3 ', '4', 'two', true, false, [2], [3, 4], { seats: 2 }, () => 2];
    eq(STORED.map(u._uwCardSeats), STORED.map((v) => sheetSide._templateSeats(v)),
      'whatever is stored in `seats`, the card and the sheet read the SAME number — the card never says one seat over a sheet that starts at three');
    ok(/'<span class="usual-week-where"><span class="usual-week-sep"> · <\/span>' \+ escapeHTML\(en\.locName\) \+ '<\/span>'/.test(tabsSrc), 'the studio keeps its own span and separator (tests/suites/7a-final-polish.js pins the two-line label)');
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. The markup: a disclosure whose head never changes
  // ════════════════════════════════════════════════════════════════════
  t.section('13b: the card is a disclosure — a real button in a real heading, the ONE primary beside it, the body it controls');
  {
    const open = u._uwCardHtml(WEEK, false), shut = u._uwCardHtml(WEEK, true);
    ok(/^<div class="usual-week-head"><h2 class="usual-week-eyebrow t-heading"><button type="button" class="usual-week-toggle" aria-expanded="true" aria-controls="usualWeekBody" onclick="toggleUsualWeek\(\)">/.test(open),
      'the head opens with <h2><button aria-expanded aria-controls> — the accordion pattern, a native button (Enter and Space are the browser\'s)');
    ok(/aria-expanded="false" aria-controls="usualWeekBody"/.test(shut) && !/aria-expanded="true"/.test(shut), 'collapsed says so in the button\'s own state');
    eq((open.match(/ id="usualWeekBody"/g) || []).length, 1, 'aria-controls names a region that exists, once');
    ok(open.indexOf('id="usualWeekBody"') > open.indexOf('</h2>') && open.indexOf('id="usualWeekBody"') < open.indexOf('usual-week-list'), '…and it wraps the entries');
    const bodyFrom = open.indexOf('<div class="usual-week-body"');
    ok(open.indexOf('>Update from my bookings<') > bodyFrom && open.indexOf('usual-week-clear') > bodyFrom, 'the secondary actions (Update from my bookings · Clear) live in the body: folded away with it, there when it is open');
    eq(text(open.slice(0, open.indexOf('</h2>'))), 'Your usual week4 classes · Hide', 'the heading reads "Your usual week" over "4 classes · Hide"');
    ok(/<span class="usual-week-count">4 classes<\/span> <span class="usual-week-dot" aria-hidden="true">·<\/span> <span class="usual-week-toggle-word">Hide<\/span>/.test(open),
      'the dot is decoration (aria-hidden) and the spaces sit OUTSIDE it — the button\'s name is "Your usual week 4 classes Hide", not "4 classesHide"');
    eq(text(u._uwCardHtml([WEEK[0]], true)).indexOf('Your usual week1 class · Show'), 0, 'one class is "1 class"');
    ok(!/[›‹»▾▸▼▶⌄⌃˅˄]|chevron|&rsaquo;|&#x25B[0-9A-F];/i.test(open + shut), 'no chevron glyph (the Filters bar\'s rule)');
    // The two states differ in exactly the two things the in-place toggle flips.
    eq(shut.replace('aria-expanded="false"', 'aria-expanded="true"').replace('<span class="usual-week-toggle-word">Show</span>', '<span class="usual-week-toggle-word">Hide</span>'), open,
      'collapsed and expanded are the SAME markup but for aria-expanded and the Show / Hide word — which is all toggleUsualWeek has to flip');
    const buttons = (html) => (html.match(/<button [^>]*>/g) || []).map((b) => (/class="([^"]*)"/.exec(b) || [])[1]);
    eq(buttons(open), buttons(shut), 'same buttons, same order, in both states: renderUsualWeekCard\'s focus-by-position holds across a fold');
    eq(buttons(open).slice(0, 2), ['usual-week-toggle', 'week-template-btn week-template-book pill-btn pill-primary'], 'the disclosure is the card\'s first button, the primary its second');
  }

  t.section('13b: the primary reads as a review, not a spend — and keeps every hook other code reads');
  {
    const open = u._uwCardHtml(WEEK, false), shut = u._uwCardHtml(WEEK, true);
    const primary = /<button type="button" class="week-template-btn week-template-book pill-btn pill-primary" onclick="bookTemplateWeek\(\)" aria-label="Review and book your usual week">Review and book<\/button>/;
    ok(primary.test(open) && primary.test(shut), '"Review and book" (spoken: "Review and book your usual week" — the visible words are in the name), in BOTH states');
    eq([(open.match(/week-template-book/g) || []).length, (shut.match(/week-template-book/g) || []).length], [1, 1],
      'ONE .week-template-book, always rendered: the sheet\'s focus-back (`#usualWeekCard .week-template-book`, js/tabs.js _uwFocusBack) can never land on a hidden twin');
    ok(open.indexOf('week-template-book') < open.indexOf('id="usualWeekBody"'), 'it sits in the head — so a folded card still offers the one thing people come for, and it never moves when the card folds');
    ok(/onclick="bookTemplateWeek\(\)"/.test(open) && /window\.bookTemplateWeek = async function/.test(tabsSrc), 'it still calls bookTemplateWeek() with no argument (13a keeps that working): the review sheet, where nothing is booked until its own button');
    ok(!/Book my usual week/.test(open + shut), 'the old label is gone from the card');
    ok((open + shut).indexOf('!') === -1, 'no exclamation mark anywhere in what the card prints');
    ok(/onclick="saveWeekAsTemplate\(\)">Update from my bookings</.test(open) && /usual-week-clear" onclick="clearUsualWeek\(\)" aria-label="Clear your usual week">Clear</.test(open),
      'Update from my bookings · Clear: same handlers, same names');
    ok(/>Save my usual week<\/button>/.test(tabsSrc) && /Same classes every week\? Save them once, then book them together\./.test(tabsSrc), 'the invitation (nothing saved yet) keeps its words');
  }

  t.section('13b: stored text is escaped, stored junk never throws, and × still removes the row it sits on');
  {
    const nasty = [
      { dayOfWeek: 2, hour: 7, minute: 0, label: '<img src=x onerror=alert(1)> · "Mal"', locName: '<b>Shoreditch</b>', seats: 2 },
      null, 'junk', 7, [],
      { dayOfWeek: 'x', hour: 'y', minute: {}, label: null, locName: 0, seats: {} },
      WEEK[0],
    ];
    let html = '';
    try { html = u._uwCardHtml(nasty, false); } catch (e) { html = 'THREW ' + e.message; }
    ok(html.indexOf('THREW') !== 0, 'a null / string / number entry (an import, an older build) is a row, not a throw — renderUsualWeekCard runs inside initTabs' + (html.indexOf('THREW') === 0 ? ' — ' + html : ''));
    ok(!/<img|<b>/.test(html) && /&lt;img src=x onerror=alert\(1\)&gt; · &quot;Mal&quot;/.test(html) && /&lt;b&gt;Shoreditch&lt;\/b&gt;/.test(html), 'label and studio are escaped — in the row AND in the remove button\'s aria-label');
    const rows = rowsOf(html);
    eq(rows.length, nasty.length, 'every stored entry keeps its row');
    eq(rows.map((r) => Number((/removeUsualWeekEntry\((\d+)\)/.exec(r) || [])[1])), [0, 1, 2, 3, 4, 5, 6], '…and × names the entry\'s own index in the STORED list (nothing is filtered out before it is numbered)');
    ok(/aria-label="Remove  00:00 Class from your usual week"|aria-label="Remove 00:00 Class from your usual week"/.test(rows[1].replace(/Remove +/, 'Remove ')), 'junk reads "00:00 Class" — never NaN, never "undefined"');
    ok(!/NaN|undefined|\[object/.test(html), 'nothing unprintable anywhere in it');
    ok(/data-ct="ride"/.test(rows[6]) && /data-ct="other"/.test(rows[1]), 'a real entry keeps its class colour; junk is neutral');
    ok(/aria-label="Remove Mon 07:30 RIDE: 45 · Alex Hart from your usual week">×<\/button>/.test(rows[6]), 'the remove button keeps its full spoken name');
    eq(text(u._uwCardHtml([], false)).indexOf('Your usual week0 classes · Hide'), 0, 'an empty list still builds (renderUsualWeekCard never asks for it)');
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. The SHIPPED render + toggle over a fake card
  // ════════════════════════════════════════════════════════════════════
  // Everything from _placeUsualWeekCard to the export: placement, the builder,
  // the state helpers, toggleUsualWeek, the focus helpers, renderUsualWeekCard.
  const from = tabsSrc.indexOf('  function _placeUsualWeekCard(card) {');
  const to = tabsSrc.indexOf('  window.renderUsualWeekCard = renderUsualWeekCard;');
  ok(from !== -1 && to > from, '14b: the card\'s code can be sliced (anchor moved?)');
  const shipped = tabsSrc.slice(from, to) + '\n  window.renderUsualWeekCard = renderUsualWeekCard;';

  function world(opts) {
    opts = opts || {};
    const storage = opts.storage || t.makeFakeLocalStorage();
    const writes = [];
    const word = { textContent: '' };
    const btn = { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, querySelector: (sel) => (sel === '.usual-week-toggle-word' ? word : null) };
    const classes = new Set(['usual-week']);
    let html = '';
    const card = {
      style: { display: 'none' }, parentNode: null,
      classList: {
        toggle(c, on) { if (on === undefined) on = !classes.has(c); if (on) classes.add(c); else classes.delete(c); return on; },
        add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      },
      get innerHTML() { return html; },
      // A repaint makes NEW nodes: the fake button is re-read from what was written.
      set innerHTML(v) {
        html = String(v);
        writes.push({ html, collapsedClassAtWrite: classes.has('is-collapsed') });
        const m = /aria-expanded="(true|false)"/.exec(html);
        btn.attrs = m ? { 'aria-expanded': m[1] } : {};
        word.textContent = (/usual-week-toggle-word">([^<]*)</.exec(html) || [])[1] || '';
      },
      querySelector(sel) {
        if (sel !== '.usual-week-toggle') throw new Error('fake card: querySelector(' + sel + ')');
        return /class="usual-week-toggle"/.test(html) ? btn : null;
      },
      querySelectorAll(sel) { if (sel !== 'button') throw new Error('fake card: querySelectorAll(' + sel + ')'); return []; },
    };
    const state = { template: opts.template || WEEK.slice(), held: opts.held || [], history: [], log: [], toasts: [], announces: [] };
    const win = {};
    if (opts.safeSet) win._psycleSafeSetItem = (k, v) => { state.safeSets = (state.safeSets || 0) + 1; storage.setItem(k, v); return true; };
    const ctx = t.vm.createContext(Object.assign(helpers(), {
      console, Array, Math, Number, String, Object, JSON,
      window: win, localStorage: storage,
      document: { activeElement: null, getElementById: (id) => (id === 'usualWeekCard' ? (opts.noCard ? null : card) : null) },
      currentUser: opts.signedOut ? null : { id: 1 },
      _usualWeekTemplate: () => state.template,
      _collectDisplayedWeekTemplate: () => state.held,
      _usualWeekFromHistory: () => state.history,
      _uwLog: (a) => state.log.push(a),
      toast: (m) => state.toasts.push(m),
      announce: (m) => state.announces.push(m),
    }));
    t.vm.runInContext(shipped, ctx, { filename: 'js/tabs.js[14b card]' });
    return { ctx, card, btn, word, classes, writes, storage, state, render: () => win.renderUsualWeekCard(), toggle: () => win.toggleUsualWeek() };
  }

  t.section('13b: a repaint with nothing new to say writes nothing — the buttons stay the same nodes');
  {
    const w = world();
    w.render();
    eq([w.writes.length, w.card.style.display, w.classes.has('has-template'), w.classes.has('is-collapsed')], [1, '', true, false], 'first paint: the whole card, expanded (nothing stored)');
    ok(/aria-expanded="true"/.test(w.writes[0].html) && /4 classes/.test(w.writes[0].html), '…printed by the builder');
    w.render(); w.render(); w.render();
    eq(w.writes.length, 1, 'bookings:loaded / booking:complete / auth:changed repaint it again and again — the DOM is written ONCE (no flicker; focus, a screen reader\'s cursor and a finger already down all survive)');
    w.state.template = WEEK.slice(0, 3);
    w.render();
    eq([w.writes.length, /3 classes/.test(w.writes[1].html)], [2, true], 'an entry removed → it IS rewritten');
    w.state.template = [];
    w.state.held = [{}];
    w.render();
    eq([w.writes.length, /usual-week-invite/.test(w.card.innerHTML), w.classes.has('has-template'), w.card.style.display], [3, true, false, ''], 'nothing saved but classes held → the one-line invitation');
    w.state.held = [];
    w.render();
    eq([w.card.innerHTML, w.card.style.display], ['', 'none'], 'nothing to offer → empty and hidden');
    const renderFn = tabsSrc.slice(tabsSrc.indexOf('  function renderUsualWeekCard() {'), to);
    ok(renderFn.indexOf('var focusedIdx = _uwFocusedButton(card, document);') < renderFn.indexOf('card.innerHTML = html;') &&
      renderFn.indexOf('_uwRefocusButton(card, focusedIdx);') > renderFn.lastIndexOf('_placeUsualWeekCard(card);'),
      'when it does rewrite, the focused button is noted before and put back after the card is re-seated (tests/suites/weekly-template.js runs that pair)');
    ok(/if \(card\._uwHtml !== html\) \{\s*card\.innerHTML = html;\s*card\._uwHtml = html;\s*\}/.test(renderFn), 'the string last written is kept on the node (innerHTML reads back normalised, so it cannot be compared)');
  }

  t.section('13b: the toggle flips IN PLACE — same button node, its state announces it, the choice is stored');
  {
    const w = world({ safeSet: true });
    w.render();
    const node = w.card.querySelector('.usual-week-toggle');
    w.toggle();
    eq([w.writes.length, w.card.querySelector('.usual-week-toggle') === node], [1, true], 'no repaint: the button that was pressed is still the same node, so it keeps the focus');
    eq([w.btn.attrs['aria-expanded'], w.word.textContent, w.classes.has('is-collapsed')], ['false', 'Show', true], 'aria-expanded="false", "Show", .is-collapsed on the card (the stylesheet folds the body off that)');
    eq([w.storage.getItem(KEY), w.state.safeSets], ['1', 1], 'stored as \'1\' — through the quota-aware setter when security.js is there');
    eq([w.state.toasts, w.state.announces], [[], []], 'no toast, no announce(): the button\'s own state is the announcement');
    eq(w.state.log, ['usual-week:collapse'], 'one action-log line');
    w.render(); w.render();
    eq(w.writes.length, 1, 'the next background repaints STILL write nothing: the card already shows the collapsed markup');
    w.toggle();
    eq([w.btn.attrs['aria-expanded'], w.word.textContent, w.classes.has('is-collapsed'), w.storage.getItem(KEY)], ['true', 'Hide', false, null], 'and back: expanded, and the key is REMOVED (\'1\' | absent — never \'0\')');
    w.render();
    eq(w.writes.length, 1, '…still one write in all');
    eq(w.state.log, ['usual-week:collapse', 'usual-week:expand'], 'logged both ways');
    // What is on screen decides — not what is stored (another tab can change the key under an open page).
    const other = world();
    other.render();
    other.storage.setItem(KEY, '1');
    other.toggle();
    eq([other.btn.attrs['aria-expanded'], other.classes.has('is-collapsed'), other.storage.getItem(KEY)], ['false', true, '1'],
      'a press always flips what the member is LOOKING at: an expanded card folds, even if the stored value already said collapsed');
    other.toggle();
    eq([other.btn.attrs['aria-expanded'], other.storage.getItem(KEY)], ['true', null], '…and unfolds again');
  }

  t.section('13b: a folded card is folded from its FIRST paint, and survives re-renders and relaunches');
  {
    const storage = t.makeFakeLocalStorage();
    storage.setItem(KEY, '1');
    const w = world({ storage });
    w.render();
    eq([w.writes.length, w.writes[0].collapsedClassAtWrite, /aria-expanded="false"/.test(w.writes[0].html), />Show</.test(w.writes[0].html)], [1, true, true, true],
      'a relaunch with \'1\' stored: the first paint is already collapsed — class on the card BEFORE the markup lands, never an expanded frame first');
    ok(/week-template-book/.test(w.writes[0].html), '…with "Review and book" on it');
    w.render();
    eq([w.writes.length, w.classes.has('is-collapsed')], [1, true], 'and stays so across repaints');
    // Not cached: in the iOS app the first paint can come before the Preferences restore has put the key back.
    const late = world();
    late.render();
    late.storage.setItem(KEY, '1');
    late.render();
    eq([late.writes.length, late.classes.has('is-collapsed'), /aria-expanded="false"/.test(late.card.innerHTML)], [2, true, true], 'storage is read at EVERY paint (a value restored after the first paint is honoured at the next)');
    // The invitation does not fold.
    const inv = world({ storage, template: [], held: [{}] });
    inv.render();
    eq([inv.classes.has('is-collapsed'), /usual-week-toggle/.test(inv.card.innerHTML), /usual-week-invite/.test(inv.card.innerHTML)], [false, false, true], 'nothing saved yet: the invitation is not collapsible, whatever is stored');
    inv.toggle();
    eq([inv.classes.has('is-collapsed'), inv.storage.getItem(KEY), inv.state.log], [false, '1', []], '…and toggleUsualWeek() with no disclosure on the card changes nothing');
    const out = world({ storage, signedOut: true });
    out.render();
    eq([out.card.innerHTML, out.card.style.display, out.classes.has('is-collapsed')], ['', 'none', false], 'signed out: no card, no leftover class');
  }

  t.section('13b: storage that throws never breaks the card');
  {
    const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
    const w = world({ storage: broken });
    let threw = '';
    try { w.render(); w.toggle(); w.render(); } catch (e) { threw = e.message; }
    eq(threw, '', 'blocked storage (a private window, a full bucket): nothing throws');
    eq([w.classes.has('is-collapsed'), w.btn.attrs['aria-expanded'], w.writes.length], [true, 'false', 1], '…and the card still folds for this page session');
    w.state.template = WEEK.slice(0, 2);
    w.render();
    eq([w.classes.has('is-collapsed'), /aria-expanded="false"/.test(w.card.innerHTML)], [true, true], 'a later repaint keeps what the member chose');
    const none = world({ noCard: true });
    try { none.render(); none.toggle(); } catch (e) { threw = e.message; }
    eq(threw, '', 'no #usualWeekCard in the page (tabs not built yet): both return quietly');
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. css/crisp.css — the card's look
  // ════════════════════════════════════════════════════════════════════
  t.section('13b: css — the fold, the disclosure\'s target and ring, tokens only, inks that hold on the card');
  {
    const a = crispAll.indexOf('/* == crisp:9d-bookings == */'), b = crispAll.indexOf('/* == crisp:9e-stats-membership == */');
    ok(a !== -1 && b > a, 'the 9d section is there');
    const css = noComments(crispAll.slice(a, b));
    const rule = (sel) => { const i = css.indexOf(sel + ' {'); return i === -1 ? '' : css.slice(i + sel.length + 2, css.indexOf('}', i)); };
    const fold = '#usualWeekCard.is-collapsed .usual-week-body { display: none; }';
    ok(css.indexOf(fold) !== -1, 'folded = the body is not rendered (out of the tab order and of a screen reader\'s reach — what aria-expanded="false" promises)');
    // Depth 0: not inside a media block — a folded card is folded at every width.
    const before = css.slice(0, css.indexOf(fold));
    eq((before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length, 0, '…at every width (the rule sits in no @media block)');
    // The trap agents/architecture/design-system.md names (The Crisp Colour layer): a rule that gives a collapsible part a `display` outranks its fold. None may exist, in any sheet.
    const offenders = [];
    ['css/styles.css', 'css/theme.css', 'css/features.css', 'css/tabs.css', 'css/settings.css', 'css/explore.css', 'css/redesign.css', 'css/discover-layout-fix.css', 'css/crisp.css'].forEach((f) => {
      noComments(t.readSource(f)).replace(/@media[^{]*\{/g, '').replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => {
        if (/\.usual-week-body\b/.test(sel) && /(?:^|;|\s)display\s*:/.test(body) && sel.trim() !== '#usualWeekCard.is-collapsed .usual-week-body') offenders.push(f + ': ' + sel.trim());
        return m;
      });
    });
    eq(offenders, [], 'no other rule in any stylesheet sets `display` on .usual-week-body — nothing can show a body the button calls collapsed');
    const tog = rule('#usualWeekCard .usual-week-toggle');
    ok(/min-height: var\(--tap-min\);/.test(tog) && /width: calc\(100% \+ var\(--space-3\)\);/.test(tog), 'the disclosure is a --tap-min target as wide as the head allows');
    ok(/font: inherit;/.test(tog) && /text-align: left;/.test(tog) && /background: none;/.test(tog) && /border: 0;/.test(tog), 'it wears the heading\'s face, not a button\'s chrome');
    ok(/#usualWeekCard \.usual-week-toggle:focus-visible \{ outline: var\(--focus-ring\); outline-offset: var\(--focus-offset\); \}/.test(css), 'and shows the focus ring');
    ok(/flex: 1;/.test(rule('#usualWeekCard .usual-week-eyebrow')) && /min-width: 0;/.test(rule('#usualWeekCard .usual-week-eyebrow')), 'the heading takes the slack; the primary ends the row');
    ok(/text-overflow: ellipsis;/.test(rule('#usualWeekCard .usual-week-title')) && /white-space: nowrap;/.test(rule('#usualWeekCard .usual-week-meta')), 'a narrow phone in a mono theme ends a line in an ellipsis rather than pushing the primary out of the card');
    ok(/#usualWeekCard\.is-collapsed \.usual-week-head \{ margin-bottom: 0; \}/.test(css), 'folded, the head is the whole card: no gap kept for a list that is not there');
    ok(/#usualWeekCard \.usual-week-seats \{ color: var\(--ct-deep\); \}/.test(css), '"2 seats" wears --ct-deep: one of the three inks the contrast matrix holds on every tint (tests/suites/9a-foundation.js)');
    ok(/#usualWeekCard \.usual-week-seats::before \{ content: "\\A"; white-space: pre; \}/.test(css) &&
      /#usualWeekCard \.usual-week-seats \+ \.usual-week-where::before \{ content: none; \}/.test(css) &&
      /#usualWeekCard \.usual-week-seats \+ \.usual-week-where \.usual-week-sep \{ display: inline; \}/.test(css),
      'the seat count brings the line break; the studio then follows on the same line after its own " · " (never a third line)');
    const mine = css.slice(css.indexOf('#usualWeekCard.has-template {'), css.indexOf('#usualWeekSheet .usual-week-pick {'));
    ok(mine.length > 800, 'the card\'s block can be sliced');
    const decls = mine.replace(/@media[^{]*\{/g, ''); // (the one breakpoint is a media query's, not a declaration's)
    ok(!/#[0-9a-f]{3,8}\b/i.test(decls.replace(/#usualWeek(Card|Sheet)/g, '')) && !/\brgba?\(/.test(decls) && !/\d+px\b/.test(decls), 'tokens only: no hex, no rgb(), no px');
    ok(!/var\(--text-(dim|faint|ghost|off)\)/.test(mine), 'no ink the themes do not guarantee');
    ok(!/transition|animation/.test(mine), 'nothing animates: there is nothing for reduced motion to switch off');

    // The head's inks on the card's ground (--surface), in every registered theme.
    const HEX = /^#[0-9a-f]{6}$/i;
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (x, y) => { const lx = lum(x), ly = lum(y); return (Math.max(lx, ly) + 0.05) / (Math.min(lx, ly) + 0.05); };
    const tokensOf = (selector) => {
      const start = themeCss.indexOf(selector + ' {');
      if (start === -1) return {};
      const body = noComments(themeCss.slice(themeCss.indexOf('{', start) + 1, themeCss.indexOf('}', start)));
      const out = {};
      body.replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
      return out;
    };
    const themeTokens = (id) => {
      const tk = Object.assign({}, tokensOf(':root'), tokensOf('[data-theme="' + id + '"]'));
      const resolve = (v, depth) => { const m = /^var\((--[a-z0-9-]+)\)$/.exec(v || ''); return m && depth < 6 ? resolve(tk[m[1]], depth + 1) : v; };
      Object.keys(tk).forEach((k) => { tk[k] = resolve(tk[k], 0); });
      return tk;
    };
    const ids = [];
    themeJs.replace(/\{\s*id:\s*'([a-z]+)'[^}]*?base:\s*'(?:light|dark)'/g, (m, id) => { ids.push(id); return m; });
    ok(ids.length >= 5, 'the theme registry was read (' + ids.join(', ') + ')');
    ok(/background: var\(--surface\);/.test(rule('#usualWeekCard.has-template')), 'the card\'s ground is --surface');
    ok(/color: var\(--text-heading\);/.test(rule('#usualWeekCard .usual-week-eyebrow')) && /color: var\(--text-muted\);/.test(rule('#usualWeekCard .usual-week-meta')) && /color: var\(--text\);/.test(rule('#usualWeekCard .usual-week-toggle-word')),
      'title = --text-heading, "4 classes" = --text-muted, Show / Hide = --text');
    const weak = [];
    ids.forEach((id) => {
      const tk = themeTokens(id);
      ['--text-heading', '--text-muted', '--text'].forEach((ink) => {
        if (!HEX.test(tk[ink] || '') || !HEX.test(tk['--surface'] || '')) { weak.push(id + ': ' + ink + ' / --surface is not a literal'); return; }
        const r = contrast(tk[ink], tk['--surface']);
        if (r < 4.5) weak.push(id + ': ' + ink + ' on --surface is ' + r.toFixed(2) + ':1');
      });
    });
    eq(weak, [], 'every ink of the head holds 4.5:1 on the card in every theme');
  }

  t.section('13b: wiring');
  {
    ok(/window\.toggleUsualWeek = function \(\) \{/.test(tabsSrc), 'toggleUsualWeek is on window (the head\'s onclick)');
    ok(/var UW_COLLAPSED_KEY = 'psycle_usual_week_collapsed';/.test(tabsSrc) && (tabsSrc.match(/psycle_usual_week_collapsed/g) || []).length >= 1, 'the key is spelled once, in the pure block');
    const toggleFn = tabsSrc.slice(tabsSrc.indexOf('  window.toggleUsualWeek = function () {'), tabsSrc.indexOf('  // Which of the card\'s buttons holds focus'));
    ok(toggleFn.length > 0 && !/innerHTML\s*=/.test(toggleFn) && !/renderUsualWeekCard\(\)/.test(toggleFn) && !/toast\(|announce\(|scroll|\.focus\(/.test(toggleFn),
      'the toggle never repaints, toasts, announces, scrolls or moves focus — it flips a class, an attribute and a word');
    ok(/\['bookings:loaded', 'booking:complete', 'booking:cancelled', 'seat:cancelled', 'auth:changed'\]\.forEach/.test(tabsSrc), 'the events that repaint the card are the ones they were');
    ok(/usualWeekCard\.className = 'usual-week';/.test(tabsSrc) && /usualWeekCard\.id = 'usualWeekCard';/.test(tabsSrc), 'initTabs still makes the one #usualWeekCard container');
    // With nothing booked the tall "Nothing booked — yet" hero used to sit ABOVE the card, and pushed
    // "Review and book" — the way to fill the week again — below the fold of a phone.
    const order = ['bookingsPanel.appendChild(usualWeekCard);', 'bookingsPanel.appendChild(upcomingPanel);', 'bookingsPanel.appendChild(bookingsEmpty);'].map((x) => tabsSrc.indexOf(x));
    ok(order.every((i) => i !== -1) && order[0] < order[1] && order[1] < order[2], 'My Bookings is built card → list → empty-state hero: the hero comes AFTER the usual-week card');
  }
};
