'use strict';
// Layout fixes: sub-filter pills, date row order, theme picker grid, class-card
// action wrapping. Layout itself can only be proven in a browser — these guard
// the contracts between the markup/JS and the stylesheet that make it work, so
// a later edit can't silently reintroduce the override that broke each one.
module.exports = function (t) {
  const app = t.readSource('js/app.js');
  const html = t.readSource('psycle-finder.html');
  const redesign = t.readSource('css/redesign.css');
  const styles = t.readSource('css/styles.css');

  // Declarations of the first rule whose selector list ends with `selector`.
  function ruleBody(css, selector) {
    const at = css.indexOf(selector + ' {');
    if (at === -1) return null;
    const open = css.indexOf('{', at);
    return css.slice(open + 1, css.indexOf('}', open));
  }

  // ── Sub-filter pills (Strength / Reformer) ────────────────────────────────
  t.section('Sub-filter pills: stylesheet owns the look');

  // Run the real render functions against a stub container. The slice is the
  // sub-filter block of app.js (constants + render/toggle functions); `const`s
  // aren't reachable on a vm context, so the script's last expression hands
  // back what the assertions need.
  const from = app.indexOf('// ── Strength sub-filter');
  const to = app.indexOf('// Extract slot numbers from any API format');
  t.ok(from !== -1 && to > from, 'sub-filter block found in app.js');
  const boxes = { strengthSubPills: { style: {}, innerHTML: '' }, reformerSubPills: { style: {}, innerHTML: '' } };
  const ctx = t.vm.createContext({
    Set,
    document: { getElementById: (id) => boxes[id] || null },
    selectedCategories: new Set(['STRENGTH', 'PILATES']),
    selectedStrengthSubs: new Set(['UPPER']),
    selectedReformerSubs: new Set(['SIGNATURE', 'STRENGTH']),
    triggerAutoSearch() {},
  });
  const api = t.vm.runInContext(
    app.slice(from, to) + '\n;({ STRENGTH_SUBS, REFORMER_SUBS, renderStrengthSubPills, renderReformerSubPills })',
    ctx, { filename: 'js/app.js[sub-filter]' });

  api.renderStrengthSubPills();
  api.renderReformerSubPills();
  const sHtml = boxes.strengthSubPills.innerHTML;
  const rHtml = boxes.reformerSubPills.innerHTML;
  t.eq(boxes.strengthSubPills.style.display, 'flex', 'strength row shows as flex when Strength is selected');
  t.eq(boxes.reformerSubPills.style.display, 'flex', 'reformer row shows as flex when Pilates is selected');
  t.eq((sHtml.match(/<button /g) || []).length, 3, 'three strength pills');
  t.eq((rHtml.match(/<button /g) || []).length, 2, 'two reformer pills');
  t.eq((sHtml.match(/class="sub-pill active"/g) || []).length, 1, 'only the selected strength sub is active');
  t.eq((rHtml.match(/class="sub-pill active"/g) || []).length, 2, 'both reformer subs active by default');
  t.ok(!/style=/.test(sHtml) && !/style=/.test(rHtml), 'pills carry no inline style (it would beat .sub-pill in every theme)');
  t.ok(api.STRENGTH_SUBS.concat(api.REFORMER_SUBS).every((s) => !('color' in s) && s.key && s.label && s.match),
    'sub definitions keep key/label/match and no per-pill colour');

  ctx.selectedCategories.clear();
  api.renderStrengthSubPills();
  api.renderReformerSubPills();
  t.eq(boxes.strengthSubPills.style.display, 'none', 'strength row hides when Strength is deselected');
  t.eq(boxes.reformerSubPills.style.display, 'none', 'reformer row hides when Pilates is deselected');

  // JS only flips display between none and flex, so everything else about the
  // row must come from the stylesheet — an inline flex-wrap/gap would win.
  ['strengthSubPills', 'reformerSubPills'].forEach((id) => {
    const m = html.match(new RegExp('<div id="' + id + '"([^>]*)>'));
    t.ok(!!m, '#' + id + ' exists in psycle-finder.html');
    const inline = m && (m[1].match(/style="([^"]*)"/) || [])[1];
    t.eq(inline, 'display:none', '#' + id + ' inline style is only display:none');
    t.ok(new RegExp('#tab-discover #' + id + '\\s*[,{]').test(redesign), '#' + id + ' has a row rule in redesign.css');
    t.ok(redesign.indexOf('#tab-discover #' + id + '::-webkit-scrollbar') !== -1, '#' + id + ' hides its scrollbar like the other pill rows');
  });
  const subRow = ruleBody(redesign, '#tab-discover #reformerSubPills');
  t.ok(!!subRow && /flex-wrap:\s*nowrap/.test(subRow) && /overflow-x:\s*auto/.test(subRow) && /gap:/.test(subRow),
    'sub-pill rows get nowrap + scroll + gap from redesign.css');

  t.ok(!/\.sub-pill\b/.test(styles), 'styles.css no longer styles .sub-pill (uppercase / 60% opacity / !important are gone)');
  const pill = ruleBody(redesign, '.sub-pill');
  t.ok(!!pill && /cursor:\s*pointer/.test(pill), '.sub-pill keeps cursor:pointer now the old block is gone');
  t.ok(!/!important/.test(pill || '') && !/!important/.test(ruleBody(redesign, '.sub-pill.active') || '!important'),
    '.sub-pill / .sub-pill.active need no !important');

  // ── Date row ──────────────────────────────────────────────────────────────
  t.section('Date row: calendar first, presets matched by label');
  const rowStart = html.indexOf('<div class="date-presets">');
  const rowHtml = html.slice(rowStart, html.indexOf('</div>', rowStart));
  const buttons = rowHtml.match(/<button [^>]*>/g) || [];
  t.eq(buttons.length, 6, 'date row has the calendar + five presets');
  t.ok(/id="pickDateBtn"/.test(buttons[0] || ''), '#pickDateBtn is the first pill, so it is on screen before any scrolling');
  t.ok(/class="date-quick-btn date-pick"/.test(buttons[0] || '') && /aria-label="Pick a date"/.test(buttons[0] || ''),
    'calendar pill keeps both classes and its accessible name');
  // app.js / interactions.js highlight presets by exact textContent.
  const labels = (rowHtml.match(/>([^<>]+)<\/button>/g) || []).map((s) => s.slice(1, -9));
  // 'Next week' sits BEFORE '14 days': the row already clips at 390px, and the
  // Monday-noon ritual needs it more than the fortnight.
  t.eq(labels, ['Today', 'Tomorrow', '7 days', 'Next week', '14 days'], 'preset labels and order');
  const F1g = t.loadPure('js/app.js', 'filters');
  const modeOf = (label) => (rowHtml.match(new RegExp("setDateQuick\\('([^']+)'\\)\"[^>]*>" + label + '<')) || [])[1];
  t.ok(labels.every((label) => (F1g._dateModeWindow(modeOf(label), '2026-09-17') || {}).label === label),
    "every pill's setDateQuick mode is a preset whose label IS the pill's text (that is how _syncDatePills lights it)");
  t.ok(/\.date-quick-btn\.date-pick\s*\{[^}]*padding:\s*0 11px/.test(redesign),
    'calendar padding uses a two-class selector');
  t.ok(redesign.indexOf('.date-quick-btn.date-pick') !== -1 && !/^\.date-pick\s*\{[^}]*padding/m.test(redesign),
    'no single-class .date-pick padding left to lose against .date-quick-btn');

  // ── Theme picker ──────────────────────────────────────────────────────────
  t.section('Membership theme picker: tracks can shrink, names are contained');
  const chips = ruleBody(redesign, '#tab-membership .theme-chips');
  t.ok(!!chips && /repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(chips), 'three minmax(0, 1fr) tracks (a bare 1fr cannot go below min-content)');
  t.ok(!/repeat\(\d,\s*1fr\)/.test(redesign.slice(redesign.indexOf('/* Appearance: theme cards */'), redesign.indexOf('/* Settings list */'))),
    'no bare 1fr track left in the theme picker');
  const chipName = ruleBody(redesign, '#tab-membership .theme-chip-name');
  t.ok(!!chipName && /text-transform:\s*none/.test(chipName) && /letter-spacing:\s*0/.test(chipName),
    'chip name resets the base uppercase + tracking');
  t.ok(!!chipName && /max-width:\s*100%/.test(chipName) && /overflow:\s*hidden/.test(chipName) &&
    /text-overflow:\s*ellipsis/.test(chipName) && /white-space:\s*nowrap/.test(chipName), 'chip name is contained with an ellipsis backstop');
  const lh = chipName && chipName.match(/font:\s*\d+\s+\d+px\/([\d.]+)/);
  t.ok(!!lh && Number(lh[1]) >= 1.2, 'chip name line-height >= 1.2 so overflow:hidden cannot clip descenders');

  // ── Class card action ─────────────────────────────────────────────────────
  t.section('Class card: action pill is compact and wraps by width');
  const btn = ruleBody(redesign, '.cc-action .book-btn');
  t.ok(!!btn && /letter-spacing:\s*0/.test(btn) && /text-transform:\s*none/.test(btn), 'book pill resets the base tracking + uppercase');
  t.ok(!!btn && /white-space:\s*nowrap/.test(btn) && /margin-top:\s*0/.test(btn), 'book pill stays on one line and drops the base top margin');
  t.ok(/\.class-card:not\(\.my-booking-card\)\s*\{\s*flex-wrap:\s*wrap/.test(redesign), 'Discover cards may wrap; My Bookings cards are excluded');
  const info = ruleBody(redesign, '.cc-info');
  const basis = info && info.match(/flex:\s*1 1 (\d+)px/);
  t.ok(!!basis && Number(basis[1]) >= 92 && Number(basis[1]) <= 108, '.cc-info has a real flex-basis (the wrap threshold), not 0');
  t.ok(!!info && /min-width:\s*0/.test(info), '.cc-info can still shrink below its basis instead of overflowing');
  const action = ruleBody(redesign, '.cc-action');
  t.ok(!!action && /margin-left:\s*auto/.test(action) && /flex:\s*none/.test(action), 'a wrapped action row is right-aligned');
  // applyBookedState / reliability.js / features.js key off these exact labels.
  t.ok(app.indexOf("bookLabel = 'Join Waitlist'") !== -1 && app.indexOf("'Waitlisted ✓'") !== -1,
    'button labels untouched (the ✓ convention and the Full-button regex depend on them)');

  // Wrapping by width has a cost: "Join Waitlist" → '…' → "Join Waitlist"
  // un-wraps and re-wraps the card, so every card below jumps mid-request.
  // The real _busyLabel, against a fake button + MutationObserver.
  t.section('Class card: the busy label never re-flows the card');
  const lines = app.split('\n');
  const bFrom = lines.findIndex((l) => l.startsWith('function _busyLabel('));
  const bTo = lines.findIndex((l, i) => i > bFrom && l === '}');
  t.ok(bFrom !== -1 && bTo > bFrom, '_busyLabel found in app.js');
  const observers = [];
  function FakeObserver(cb) { this.cb = cb; this.live = false; observers.push(this); }
  FakeObserver.prototype.observe = function () { this.live = true; };
  FakeObserver.prototype.disconnect = function () { this.live = false; };
  const bctx = t.vm.createContext({ MutationObserver: FakeObserver });
  t.vm.runInContext(lines.slice(bFrom, bTo + 1).join('\n'), bctx);
  const cardBtn = (inAction) => ({ textContent: 'Join Waitlist', offsetWidth: 103, style: {}, closest: (sel) => (inAction && sel === '.cc-action' ? {} : null) });

  let b = cardBtn(true);
  bctx._busyLabel(b);
  t.eq([b.textContent, b.style.minWidth, observers.length], ['…', '103px', 1], "a Discover card pill is held at the width it had before the '…'");
  observers[0].cb(); // a mutation that left the '…' in place (claimWaitlistSpot writes it twice)
  t.eq([b.style.minWidth, observers[0].live], ['103px', true], "still '…' → still held");
  bctx._busyLabel(b);
  t.eq(observers.length, 1, 'a second busy phase on a held pill (bookClass: session recheck, then the event fetch) adds no second observer');
  b.textContent = 'Waitlisted ✓';
  observers[0].cb();
  t.eq([b.style.minWidth, observers[0].live], ['', false], 'any other label releases the hold and stops observing — whichever exit wrote it');

  b = cardBtn(false);
  bctx._busyLabel(b);
  t.eq([b.textContent, b.style.minWidth, observers.length], ['…', undefined, 1], 'a button outside .cc-action (My Bookings, the detached sheet button) only gets the label');
  const stub = { textContent: 'Cancel all 2', disabled: false };
  bctx._busyLabel(stub);
  t.eq(stub.textContent, '…', 'a bare stub (no style / closest) is tolerated');
  const bare = t.vm.createContext({});
  t.vm.runInContext(lines.slice(bFrom, bTo + 1).join('\n'), bare);
  b = cardBtn(true);
  bare._busyLabel(b);
  t.eq([b.textContent, b.style.minWidth], ['…', undefined], 'no MutationObserver in the engine → no hold that nothing could release');
  t.eq(app.split("btn.textContent = '…';").length - 1, 1, "every busy label goes through _busyLabel (the one raw '…' write is inside it)");
};
