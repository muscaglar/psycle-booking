'use strict';
// Wave 10c — the owner's follow-ups to the Crisp Colour build:
//   1. "Tone down": the clash warning is ONE quiet caution line — the body ink on
//      the surface it already sits on, led by a small caution mark in the theme's
//      caution colour; no filled ground, no box — in the class sheet, the seat
//      picker, the confirm dialogs and the usual-week sheet. Copy unchanged.
//   2. The floating next-class pill gets out of the way while a list is scrolled
//      DOWN and comes back on the way up, at the top and where the list ends —
//      still the same button to a keyboard and a screen reader. At REST it never
//      sits on a Book button either (the top of a Discover day put it on the
//      fourth card's): it stands aside until nothing is under it.
//   3. Desktop (>= 1024px): filters in a pinned left column, the timetable on the
//      right; the class sheet a dialog with a width of its own; "Clear filters"
//      only while a filter is on. Phones and tablets are untouched.
//
// DOM-free. Decisions are tested as tables (pure:pill-scroll in js/settings.js,
// pure:usual-week-note in js/tabs.js, _uiIcon in js/app.js); what is wired is
// checked by running the SHIPPED code, sliced out of source, over small fakes.
// Two things this suite does on purpose, because other agents of the same wave
// edit the same files: it never pins a TIME format ("6:30pm" is becoming
// "18:30"), and it never runs openClassDetail / showBikePicker whole — they
// format times, and may grow helpers this file could not hand them.
// Themes come from the registry, however many it lists. Nothing here can reach
// Psycle.
module.exports = function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const tabsSrc = t.readSource('js/tabs.js');
  const settingsSrc = t.readSource('js/settings.js');
  const themeJs = t.readSource('js/theme.js');
  const themeCss = t.readSource('css/theme.css');
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const crispAll = t.readSource('css/crisp.css');
  const crisp = noComments(crispAll);
  const tabsCss = noComments(t.readSource('css/tabs.css'));
  const sectionOf = (fromTag, toTag) => {
    const a = crispAll.indexOf(fromTag), b = toTag ? crispAll.indexOf(toTag) : crispAll.length;
    if (a === -1 || b === -1 || b <= a) throw new Error('10c-polish suite: cannot find ' + fromTag + ' (section marker moved?)');
    return noComments(crispAll.slice(a, b));
  };
  const s9b = sectionOf('/* == crisp:9b-discover == */', '/* == crisp:9c-sheets == */');
  const s9c = sectionOf('/* == crisp:9c-sheets == */', '/* == crisp:9d-bookings == */');
  const s9d = sectionOf('/* == crisp:9d-bookings == */', '/* == crisp:9e-stats-membership == */');
  const s9e = sectionOf('/* == crisp:9e-stats-membership == */', null);
  const between = (src, fromTag, toTag, what) => {
    const a = src.indexOf(fromTag), b = src.indexOf(toTag, a + 1);
    if (a === -1 || b === -1) throw new Error('10c-polish suite: cannot slice ' + (what || fromTag) + ' (anchor moved?)');
    return src.slice(a, b);
  };
  // The body of the FIRST rule whose selector is exactly `sel` (comments already stripped).
  const rule = (css, sel) => {
    const re = new RegExp('(?:^|[}\\n])\\s*' + sel.replace(/[.*+?^${}()|[\]\\#>:]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
    return (re.exec(css) || [])[1] || '';
  };
  const escapeHTML = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const EMOJI = /[☀-➿\u{1F000}-\u{1FAFF}]|&#(9888|10024|12[0-9]{4});/u;
  const CAUTION_MARK = /<circle cx="12" cy="12" r="8\.5"\/>/; // the ringed "!" — what _uiIcon('caution') draws

  // _sheetPlanNote (same region) names the billing period with _mbPeriodWord: handed in, as 9c-sheets.js does.
  const sheets = t.loadPure('js/app.js', 'sheets', { _mbPeriodWord: t.loadPure('js/app.js', 'bookings-crisp')._mbPeriodWord });

  // ════════════════════════════════════════════════════════════════════
  // 1. The clash warning, toned down
  // ════════════════════════════════════════════════════════════════════
  t.section('10c: the caution mark — one drawn line mark, decorative, never an emoji');
  {
    const svg = sheets._uiIcon('caution', 16);
    ok(/^<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"/.test(svg) && /aria-hidden="true" focusable="false"/.test(svg),
      'an inline stroke SVG in currentColor (so CSS inks it), hidden from assistive tech — the sentence says it in words');
    ok(CAUTION_MARK.test(svg) && (svg.match(/<path /g) || []).length === 2 && !/<title|\sid=|<text/i.test(svg) && !EMOJI.test(svg),
      'a ringed "!": a circle, a stroke and a dot — no title, no id, no text glyph (the warning sign is an emoji on iOS)');
    ok(/stroke-linecap="round"/.test(svg) && /d="M12 16\.4v\.01"/.test(svg), 'round caps, so the zero-length stroke IS the dot');
    eq(sheets._uiIcon('Caution', 16), '', 'own names only (case matters): nothing caller-supplied reaches the markup');
  }

  t.section('10c: class sheet — the clash is a row like its neighbours, led by the caution mark');
  {
    const sheetSrc = between(appSrc, 'window.openClassDetail = function (eventId) {', '\n};\n', 'openClassDetail');
    ok(/clashHtml = '<div class="cds-detail-row cds-clash">' \+ rowIcon\('caution'\) \+ '<span class="' \+/.test(sheetSrc), 'the row leads with rowIcon(\'caution\') (it was the two-tiles "clash" mark in the heading ink)');
    ok(/\(clash\.kind === 'overlap' && !clash\.place \? 'cds-avail-full' : 'cds-avail-waitlist'\) \+ '">' \+ escapeHTML\(_clashLabel\(clash\)\) \+ '<\/span>'/.test(sheetSrc),
      'the sentence is still _clashLabel\'s, escaped, on the same two hooks (overlap vs. squeeze / place) — copy unchanged');
    ok(/'<span class="ct-tile is-sm" data-ct="' \+ otherKey \+ '" aria-hidden="true">'/.test(sheetSrc), 'the OTHER class\'s own tile still closes the row');
    ok(/const rowIcon = name => '<span class="cds-icon" aria-hidden="true">' \+ \(typeof _uiIcon === 'function' \? _uiIcon\(name, 19\) : ''\) \+ '<\/span>';/.test(sheetSrc), 'rowIcon wraps the mark in the decorative .cds-icon, as every row does');
    // The look: no ground, no box — the row's own rules are all that is left.
    ok(!/\.cds-detail-row\.cds-clash\s*\{/.test(s9c) && !/\.cds-clash[^{]*\{[^}]*(background|border|margin)\s*:/.test(s9c), 'crisp.css gives the clash row NO ground, border or bleed of its own (it was an amber band, edge to edge)');
    ok(/\.cds-clash \.cds-icon \{ color: var\(--badge-waitlist-text\); \}/.test(s9c), 'only the MARK wears the theme\'s caution colour');
    ok(/\.cds-detail-row \.cds-avail, \.cds-detail-row \.cds-avail-full, \.cds-detail-row \.cds-avail-waitlist \{[^}]*font-weight: var\(--weight-semibold\);[^}]*color: var\(--text\);/.test(s9c) &&
      !/\.cds-clash \.cds-avail-full[^{]*\{[^}]*(color|font-weight)\s*:/.test(s9c), 'the sentence is the availability rows\' own body ink and weight — not bold heading ink');
    ok(/\.cds-detail-row \+ \.cds-detail-row \{ border-top: var\(--hairline\) solid var\(--line\); \}/.test(s9c), 'and the hairline between rows now runs above it too');
  }

  t.section('10c: seat picker — the clash chip is the same quiet line, in the header\'s ink');
  {
    // Only the clash block of showBikePicker (it formats no time): from its swap check to the block's closing brace.
    const lines = appSrc.split('\n');
    const from = lines.findIndex((l) => l === '  const _swapOpen = !!window._changeSpotContext;');
    const to = lines.findIndex((l, i) => i > from && l === '  }');
    ok(from !== -1 && to > from && to - from < 16, 'the picker\'s clash block can be sliced');
    const block = lines.slice(from, to + 1).join('\n');
    const draw = (o) => {
      const made = [];
      const el = () => { const e = { className: '', innerHTML: '', textContent: '', kids: [] }; e.appendChild = (c) => { e.kids.push(c); return c; }; made.push(e); return e; };
      const subtitle = el();
      const ctx = t.vm.createContext({ window: { _changeSpotContext: o.swap ? { eventId: 1 } : null }, opts: o.opts, _uiIcon: o.noIcons ? undefined : sheets._uiIcon,
        document: { createElement: el, getElementById: (id) => (id === 'modalSubtitle' ? subtitle : null) } });
      t.vm.runInContext('(function () {\n' + block + '\n})();', ctx, { filename: 'js/app.js[showBikePicker clash block]' });
      return subtitle.kids[0] || null;
    };
    const HOSTILE = 'Clashes with your <img src=x onerror=1> "Ride" at Bank';
    const line = draw({ opts: { clashLine: HOSTILE } });
    ok(!!line && line.className === 'modal-clash', 'a clash line → ONE .modal-clash in the subtitle (the hook is unchanged)');
    ok(CAUTION_MARK.test(line.innerHTML) && /aria-hidden="true"/.test(line.innerHTML) && line.innerHTML.indexOf('img src') === -1, 'its markup is the caution mark and nothing else — no caller text is ever written as HTML');
    eq([line.kids.length, line.kids[0] && line.kids[0].textContent, line.kids[0] && line.kids[0].innerHTML], [1, HOSTILE, ''], 'the sentence (class / studio names are API text) goes in as textContent, whole and unchanged');
    eq([draw({ opts: { clashLine: '' } }), draw({ opts: {} }), draw({ opts: null }), draw({ opts: { clashLine: HOSTILE }, swap: true })], [null, null, null, null], 'no line, no options, or a swap (a class already held): nothing is added');
    const bare = draw({ opts: { clashLine: 'x' }, noIcons: true });
    eq([bare.innerHTML, bare.kids[0].textContent], ['', 'x'], 'without _uiIcon (a suite running the picker alone): the sentence still shows, no throw');
    const chip = rule(s9c, '.modal-clash');
    ok(/background: none;/.test(chip) && /border: 0;/.test(chip) && /padding: 0;/.test(chip) && /border-radius: 0;/.test(chip), 'no chip: no fill, no border, no padding, no radius (it was a filled amber chip on the class tint)');
    ok(/color: var\(--ct-ink, var\(--text\)\);/.test(chip) && /display: flex;/.test(chip), 'the header wears the class tint, so the sentence takes the tint\'s guaranteed ink (--ct-ink; tests/suites/9a-foundation.js holds it on every swatch)');
    ok(/\.modal-clash \.ui-icon \{[^}]*flex: none;[^}]*color: var\(--badge-waitlist-text\);/.test(s9c), 'the mark: the caution colour, never squeezed by a long sentence');
  }

  t.section('10c: confirm dialogs — the warn line is the quiet line; the late-cancel warning alone keeps a ground');
  {
    const cmSrc = between(appSrc, 'function confirmModal(opts) {', 'window.confirmModal = confirmModal;', 'confirmModal');
    const draw = (opts, withIcons) => {
      let html = '';
      const overlay = { classList: { add() {}, remove() {} }, contains: () => false, querySelector: () => ({ focus() {} }), querySelectorAll: () => [], remove() {},
        set innerHTML(v) { html = v; }, get innerHTML() { return html; } };
      const ctx = t.vm.createContext(Object.assign({ console, escapeHTML, requestAnimationFrame: () => 0, setTimeout: () => 0,
        document: { activeElement: null, getElementById: () => null, createElement: () => overlay, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} } },
      withIcons === false ? {} : { _uiIcon: sheets._uiIcon }));
      t.vm.runInContext(cmSrc, ctx, { filename: 'js/app.js[confirmModal]' });
      ctx.confirmModal(opts);
      return html;
    };
    const WARN = 'Clashes with your <b>Ride</b> at Bank. Psycle\'s normal 12-hour cancellation policy applies.';
    let html = draw({ title: 'Book this spot?', body: 'Only Bike 12 is left — book it?', warn: WARN, confirmText: 'Book it' });
    const warnEl = (/<div class="confirm-warn[^"]*" id="psycleConfirmWarn">([\s\S]*?)<\/div>/.exec(html) || [])[1] || '';
    ok(/^<svg class="ui-icon" width="16"/.test(warnEl) && CAUTION_MARK.test(warnEl), 'the warn line leads with the caution mark');
    eq(warnEl.replace(/^<svg[\s\S]*?<\/svg>/, ''), '<span>' + escapeHTML(WARN) + '</span>', '…then the sentence, escaped and word for word (the clash line + the policy line, as before)');
    ok(/aria-describedby="psycleConfirmBody psycleConfirmWarn"/.test(html) && /aria-hidden="true"/.test(warnEl), 'the dialog is still described by the warn line — and the mark adds nothing to that description');
    html = draw({ title: 'Cancel this booking?', warn: 'Late.', warnClass: 'late-cancel-note', danger: true });
    ok(/<div class="confirm-warn late-cancel-note" id="psycleConfirmWarn"><svg/.test(html), 'the late-cancel dialog keeps its one class on the same element, with the same mark');
    ok(!/confirm-warn/.test(draw({ title: 'Sign out?' })), 'no warn text → no warn line');
    html = draw({ title: 'x', warn: 'y' }, false);
    ok(/id="psycleConfirmWarn"><span>y<\/span><\/div>/.test(html), 'without _uiIcon (tests/suites/a11y.js runs this slice alone): the sentence, no mark, no throw');
    // …and the usual-week sheet's own policy line, which wears the same class inside a .confirm-dialog.
    ok(/'<div class="confirm-warn">' \+ \(typeof _uiIcon === 'function' \? _uiIcon\('caution', 16\) : ''\) \+\s*'<span>Each class is booked straight away,/.test(tabsSrc) && /'<\/span><\/div>' \+/.test(tabsSrc),
      'the usual-week sheet\'s policy line is built the same way (mark, then the sentence in a span)');
    eq((appSrc + tabsSrc + settingsSrc + t.readSource('js/reliability.js') + t.readSource('js/features.js')).match(/class="confirm-warn/g).length, 2, 'those two are the only places that draw a .confirm-warn — none is left without its mark');

    const warn = rule(s9c, '.confirm-warn');
    ok(/background: none;/.test(warn) && /border: 0;/.test(warn) && /padding: 0;/.test(warn) && /color: var\(--text\);/.test(warn), 'the line: the body ink on the dialog\'s own surface — no fill, no box (it was an amber box)');
    ok(/\.confirm-dialog \.confirm-warn::before \{ content: none; \}/.test(s9c), 'the old generated glyph is off (css/styles.css still declares it; Handheld re-inks it at (0,2,1) — hence .confirm-dialog for weight)');
    ok(/\.confirm-warn \.ui-icon \{[^}]*color: var\(--badge-waitlist-text\);/.test(s9c), 'the mark: the caution colour');
    const late = rule(s9c, '.confirm-warn.late-cancel-note');
    ok(/background: var\(--badge-waitlist-bg\);/.test(late) && /color: var\(--text-heading\);/.test(late) && /padding:/.test(late), 'a cancel inside the 12-hour window costs a credit: that ONE warning keeps its caution ground (tests/suites/6e-design-tokens.js holds the pair at 4.5:1)');
  }

  t.section('10c: usual-week sheet — a row\'s warning is the quiet line (pure:usual-week-note)');
  {
    const u = t.loadPure('js/tabs.js', 'usual-week-note', { escapeHTML, _uiIcon: sheets._uiIcon });
    const CLASH = 'Clashes with your Ride at Bank — left out';
    const warn = u._uwNoteInner({ warn: true, text: CLASH });
    ok(/^<svg class="ui-icon" width="14"/.test(warn) && CAUTION_MARK.test(warn) && warn.endsWith('<span>' + CLASH + '</span>'), 'a warning: the caution mark, then the sentence — unchanged');
    eq([u._uwNoteInner({ text: 'Already booked' }), u._uwNoteInner({ ok: true, text: 'Booked ✓' })], ['<span>Already booked</span>', '<span>Booked ✓</span>'], 'a plain note and a success: the sentence alone — the mark means caution and nothing else');
    eq([u._uwNoteInner({ warn: true, text: '' }), u._uwNoteInner({ text: '' }), u._uwNoteInner({}), u._uwNoteInner(null), u._uwNoteInner(undefined)], ['', '', '', '', ''],
      'nothing to say → NOTHING: the note is still :empty, so css/styles.css still takes it out of the row');
    eq(u._uwNoteInner({ warn: true, text: '<img src=x onerror=1> & "co"' }).replace(/^<svg[\s\S]*?<\/svg>/, ''), '<span>&lt;img src=x onerror=1&gt; &amp; &quot;co&quot;</span>', 'the sentence is escaped (it can carry a class or studio name)');
    const bare = t.loadPure('js/tabs.js', 'usual-week-note', { escapeHTML });
    eq(bare._uwNoteInner({ warn: true, text: 'x' }), '<span>x</span>', 'tabs.js without app.js\'s _uiIcon: the sentence, no mark, no throw');
    // Both writers go through it — the first paint AND the run's in-place rewrite (textContent there wiped the mark).
    const row = tabsSrc.slice(tabsSrc.indexOf('  function _uwRowHtml('), tabsSrc.indexOf('  // Where focus goes when the sheet closes'));
    ok(/'" data-uw-note="' \+ row\.index \+ '">' \+ _uwNoteInner\(note\) \+ '<\/span>' \+/.test(row), 'the row\'s first paint');
    const setNote = between(tabsSrc, '        var setNote = function (i, result) {', '        };', 'setNote');
    ok(/el\.innerHTML = _uwNoteInner\(note\);/.test(setNote) && !/el\.textContent\s*=/.test(setNote) && /el\.className = 'usual-week-row-note' \+ \(note\.warn \? ' is-warn' : ''\) \+ \(note\.ok \? ' is-ok' : ''\);/.test(setNote),
      'and the rewrite while a run is going — same builder, same state classes');
    ok(/#usualWeekSheet \.usual-week-row-note\.is-warn \{[^}]*display: flex;[^}]*color: var\(--text\);/.test(s9d) && /#usualWeekSheet \.usual-week-row-note\.is-warn \.ui-icon \{[^}]*color: var\(--badge-waitlist-text\);/.test(s9d),
      'crisp.css: the body ink, the mark in the caution colour (the whole sentence was set in the caution colour)');
    ok(!/#usualWeekSheet \.usual-week-row-note[^{]*\{[^}]*background/.test(s9d), '…and no ground');
    // A tickable row is a <label>; css/styles.css's bare `label` rule (the filter-group captions') made it — caution line included — UPPERCASE and tracked out.
    ok(/^label \{[^}]*text-transform: uppercase;[^}]*letter-spacing:/m.test(noComments(t.readSource('css/styles.css'))), 'css/styles.css still dresses every bare <label> as a caption (uppercase, tracked)…');
    ok(/'<label class="usual-week-pick">/.test(row) && /#usualWeekSheet label\.usual-week-pick \{ letter-spacing: 0; text-transform: none; \}/.test(s9d),
      '…so the sheet hands its tickable rows their sentence case back: a caution line never shouts because its row can be ticked');
  }

  t.section('10c: the welcome\'s illustration draws the clash line as the app now does');
  {
    const ill = rule(s9e, '.onboard-mini-caution');
    ok(/background: none;/.test(ill) && /border: 0;/.test(ill) && /padding: 0;/.test(ill) && /color: var\(--text\);/.test(ill), 'no amber chip: the body ink, no fill, no box');
    const mark = rule(s9e, '.onboard-mini-caution::before');
    ok(/content: '!';/.test(mark) && /content: '!' \/ '';/.test(mark) && /border: var\(--hairline\) solid currentColor;/.test(mark) && /border-radius: var\(--radius-full\);/.test(mark) && /color: var\(--badge-waitlist-text\);/.test(mark),
      'its ringed "!" is drawn in CSS, in the caution colour, with empty alt text (the illustration\'s markup is a plain sentence — and carries a time another change of this wave rewrites)');
    ok(/'<div class="onboard-mini-caution">Clashes with your /.test(appSrc), 'that markup is untouched');
  }

  t.section('10c: the caution line is readable in every theme — text >= 4.5:1, the mark >= 3:1 on every ground it sits on');
  {
    const HEX = /^#[0-9a-f]{6}$/i;
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16));
    const lum = (hex) => { const c = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const contrast = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    const tokensOf = (selector) => {
      const start = themeCss.indexOf(selector + ' {');
      if (start === -1) return null;
      const out = {};
      noComments(themeCss.slice(themeCss.indexOf('{', start) + 1, themeCss.indexOf('}', start))).replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
      return out;
    };
    const rootTk = tokensOf(':root') || {};
    const themes = [];
    themeJs.replace(/\{\s*id:\s*'([a-z]+)',\s*name:\s*'[^']+',\s*base:\s*'(light|dark)'[^}]*\}/g, (m, id, base) => { themes.push({ id, base, mono: /mono:\s*true/.test(m) }); return m; });
    ok(themes.length >= 3 && themes.some((x) => x.id === 'cloud') && themes.some((x) => x.id === 'graphite'), 'the themes are read from the registry (' + themes.map((x) => x.id).join(', ') + ')');
    // The palette's card tints, per base (the picker's header is a class tint).
    const tints = { light: [], dark: [] };
    themeJs.replace(/(light|dark):\s*\{ tintSoft: '(#[0-9A-Fa-f]{6})', tintBold: '(#[0-9A-Fa-f]{6})'/g, (m, side, soft, bold) => { tints[side].push(soft, bold); return m; });
    ok(tints.light.length >= 16 && tints.dark.length === tints.light.length, 'the class tints are read from the palette (' + tints.light.length + ' per base)');
    let worstText = { v: 99, what: '' }, worstMark = { v: 99, what: '' };
    themes.forEach((th) => {
      const own = tokensOf('[data-theme="' + th.id + '"]');
      if (!own) { ok(false, th.id + ': css/theme.css has no [data-theme="' + th.id + '"] block'); return; }
      const tk = Object.assign({}, rootTk, own);
      const resolve = (v, depth) => { const m = /^var\((--[a-z0-9-]+)\)$/.exec(v || ''); return m && depth < 6 ? resolve(tk[m[1]], depth + 1) : v; };
      const val = (k) => resolve(tk[k], 0);
      const mark = val('--badge-waitlist-text');
      if (!HEX.test(mark)) { ok(false, th.id + ': --badge-waitlist-text did not resolve to a colour (' + mark + ')'); return; }
      // The sentence: the body ink on the dialog / usual-week sheet (--surface) and on the class sheet's list (--ground).
      [['--text', '--surface', 'a dialog\'s warn line, a usual-week row\'s warning'], ['--text', '--ground', 'the class sheet\'s clash row']].forEach((row) => {
        const ink = val(row[0]), ground = val(row[1]);
        if (!HEX.test(ink) || !HEX.test(ground)) { ok(false, th.id + ': ' + row[0] + ' / ' + row[1] + ' did not resolve (' + ink + ', ' + ground + ')'); return; }
        const r = contrast(ink, ground);
        if (r < worstText.v) worstText = { v: r, what: th.id + ' · ' + row[2] };
        if (!(r >= 4.5)) ok(false, th.id + ': ' + row[2] + ' — ' + row[0] + ' on ' + row[1] + ' is ' + r.toFixed(2) + ':1 (needs >= 4.5)');
      });
      // The mark: on those two grounds, and on every class tint (a mono theme's tints are its own surfaces).
      const grounds = [['--surface', val('--surface')], ['--ground', val('--ground')]].concat(th.mono ? [] : tints[th.base].map((hex, i) => ['class tint #' + i, hex]));
      grounds.forEach((g) => {
        if (!HEX.test(g[1])) { ok(false, th.id + ': ' + g[0] + ' did not resolve (' + g[1] + ')'); return; }
        const r = contrast(mark, g[1]);
        if (r < worstMark.v) worstMark = { v: r, what: th.id + ' · ' + g[0] };
        if (!(r >= 3)) ok(false, th.id + ': the caution mark ' + mark + ' on ' + g[0] + ' ' + g[1] + ' is ' + r.toFixed(2) + ':1 (a graphic needs >= 3)');
      });
    });
    ok(worstText.v >= 4.5, 'the sentence holds 4.5:1 in all ' + themes.length + ' themes — the tightest is ' + worstText.what + ' at ' + worstText.v.toFixed(2) + ':1');
    ok(worstMark.v >= 3, 'the mark holds 3:1 on every ground and every class tint — the tightest is ' + worstMark.what + ' at ' + worstMark.v.toFixed(2) + ':1');
    // Nothing of the old look is left on a clash: the amber ground belongs to the late-cancel warning alone in these sections.
    const grounded = [];
    (s9c + s9d).replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { if (/background:\s*var\(--badge-waitlist-bg\)/.test(body)) grounded.push(sel.trim()); return m; });
    eq(grounded, ['.confirm-warn.late-cancel-note'], 'in the sheets and bookings sections the caution GROUND is painted by the late-cancel warning only');
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. The next-class pill steps aside
  // ════════════════════════════════════════════════════════════════════
  t.section('10c: pill — down the list it steps aside; up, at the top and at the end it is back (pure:pill-scroll)');
  {
    const p = t.loadPure('js/settings.js', 'pill-scroll');
    ok(typeof p._pillScrollStep === 'function' && p.PILL_TUCK_AFTER > p.PILL_SHOW_AFTER && p.PILL_SHOW_AFTER > 0 && p.PILL_EDGE > 0, 'it takes more travel to hide it than to bring it back (the member scrolling up is looking for it)');
    const MAX = 2000;
    // Feed a scroll path; report tucked after each position.
    const walk = (ys, opts) => { let s = (opts && opts.from) || { y: 0, anchor: 0, dir: 0, tucked: false }; return ys.map((y) => { s = p._pillScrollStep(s, Object.assign({ y, max: MAX }, opts && opts.facts)); return s.tucked; }); };
    eq(walk([0, 10, 20]), [false, false, false], 'at the top: shown');
    // (20 is still "the top": the run down is measured from there.)
    eq(walk([10, 20, 30, 40, 50, 300]), [false, false, false, false, true, true], 'scrolling DOWN: it goes once the run has travelled ' + p.PILL_TUCK_AFTER + 'px past the top (a nudge does not hide it), and stays gone');
    eq(walk([400]), [true], 'one fling that lands mid-list has travelled too: gone');
    eq(walk([100, 400, 398, 396]), [true, true, true, true], 'a wobble of a few px up (momentum, a resting thumb) does not bring it back…');
    eq(walk([100, 400, 380]), [true, true, false], '…a real scroll UP does, after ' + p.PILL_SHOW_AFTER + 'px');
    eq(walk([100, 400, 380, 390, 400, 410]), [true, true, false, false, false, true], 'a turn starts a NEW run from where the last one ended: down again needs its ' + p.PILL_TUCK_AFTER + 'px again');
    eq(walk([100, 400, 380, 5]), [true, true, false, false], 'back at the top: shown');
    eq(walk([100, 1000, MAX - 10, MAX]), [true, true, false, false], 'where the list ENDS it is back (the panels end a pill higher there, so the last card is clear of it)');
    eq(walk([100, 1000, MAX + 80, MAX - 30, MAX + 40]), [true, true, false, false, false], 'iOS rubber band: past the end reads as the end, and the bounce back off it is a scroll UP — it does not flicker away');
    eq(walk([100, 1000, MAX, MAX - 200, MAX - 160]), [true, true, false, false, true], '…but heading back DOWN from mid-list hides it again');
    eq(walk([100, 400, -60]), [true, true, false], '…and past the top as the top');
    eq(walk([100, 400, 0]), [true, true, false], 'a jump to 0 (switchTab resets the scroller): shown');
    eq(walk([10, 30, 40], { facts: { max: 40 } }), [false, false, false], 'a list with next to nothing to scroll never hides it');
    // A dialog is up: whatever moves behind it changes nothing — and leaves no pent-up travel behind.
    let s = { y: 100, anchor: 100, dir: 0, tucked: false };
    s = p._pillScrollStep(s, { y: 900, max: MAX, dialogOpen: true });
    eq([s.tucked, s.y, s.anchor], [false, 900, 900], 'a dialog open: NOT hidden, however far the page moved behind it; the offset is followed');
    eq(p._pillScrollStep(s, { y: 910, max: MAX }).tucked, false, '…so closing it does not hide the pill on the next 10px');
    s = p._pillScrollStep({ y: 900, anchor: 500, dir: 1, tucked: true }, { y: 300, max: MAX, dialogOpen: true });
    eq(s.tucked, true, 'a dialog open: not brought back either — it never animates under a dialog');
    [[null, null], [undefined, {}], [{}, { y: 'x', max: 'y' }], [{ y: NaN, anchor: NaN, tucked: 'yes' }, { y: NaN, max: NaN }], [{ y: -5 }, { y: Infinity, max: 100 }]].forEach((pair) => {
      let out = null, threw = false;
      try { out = p._pillScrollStep(pair[0], pair[1]); } catch (e) { threw = true; }
      ok(!threw && out && typeof out.tucked === 'boolean' && out.y >= 0 && out.anchor >= 0 && !isNaN(out.y) && !isNaN(out.anchor), 'junk in (' + JSON.stringify(pair) + ') → a usable state out, no throw, no NaN');
    });
    eq(p._pillScrollStep({ y: 500, anchor: 100, dir: 1, tucked: true }, { y: 500, max: MAX }).tucked, true, 'no movement: no change');
    // "Called back": the run UP that un-tucks it — asked the same way when it stood aside for another reason (at rest, below).
    const back = (ys) => { let st = { y: 0, anchor: 0, dir: 0, tucked: false }; return ys.map((y) => { st = p._pillScrollStep(st, { y, max: MAX }); return p._pillCalledBack(st); }); };
    eq(back([100, 400, 396, 380]), [false, false, false, true], 'called back = a run up of ' + p.PILL_SHOW_AFTER + 'px mid-list (a wobble is not)');
    eq(back([30, 40, 36, 31]), [false, false, false, true], '…whether or not the scroll had tucked it (30 → 40 is a nudge: never tucked)');
    eq(back([100, 400, 5]), [false, false, false], 'arriving at the top is NOT a call back (no run: it is there anyway) — that is what the look at rest is for');
    eq(back([100, 1000, MAX]), [false, false, false], '…nor is the end of the list');
    eq([p._pillCalledBack(null), p._pillCalledBack({}), p._pillCalledBack({ dir: -1, tucked: false, anchor: NaN, y: NaN })], [false, false, false], 'junk in → false');
  }

  t.section('10c: pill — at rest it never sits on a Book button (pure:pill-rest)');
  {
    const r = t.loadPure('js/settings.js', 'pill-rest');
    ok(r.PILL_REST_MS > 0 && r.PILL_REST_AGAIN_MS >= 300, 'one look once things are quiet; the second look before it comes back waits out the cards\' entrance');
    // The entrance it waits out: the last delay of the cascade + its length (css/tabs.css), from the render; the first look is already PILL_REST_MS after it.
    const delays = (tabsCss.match(/\.class-grid \.class-card[^{]*\{ animation-delay: ([\d.]+)s; \}/g) || []).map((d) => Number(/([\d.]+)s/.exec(d)[1]));
    const enter = Number((/\.class-grid \.class-card \{ animation: cardEnter ([\d.]+)s/.exec(tabsCss) || [])[1]);
    ok(delays.length >= 6 && enter > 0 && (r.PILL_REST_MS + r.PILL_REST_AGAIN_MS) / 1000 > Math.max.apply(null, delays) + enter, 'the two looks span the cards\' entrance (' + Math.max.apply(null, delays) + 's + ' + enter + 's): the second one sees them landed');
    // Geometry: the reviewer's phone (390 × 844) — pill 23…367 × 727…772.
    const box = { left: 23, top: 727, right: 367, bottom: 772 };
    const btn = (top, left) => ({ left: left == null ? 298 : left, right: (left == null ? 298 : left) + 64, top, bottom: top + 44 });
    ok(r.PILL_OVERLAP_MIN > 0 && r.PILL_OVERLAP_MIN <= 12, 'covered = a real overlap, not a touching edge — and never so lenient that a quarter of a 44px button may hide');
    eq(r._pillCoversBook(box, [btn(711)]), true, 'the fourth card\'s Book at 711…755: 28px of it under the pill → covered');
    eq(r._pillCoversBook(box, [btn(722)]), true, '722…766 (a 5-class day): covered');
    eq(r._pillCoversBook(box, [btn(693)]), true, '693…737: 10px of its foot under the pill — a tap there opened My Bookings → covered (the centre-only rule let this one through)');
    eq(r._pillCoversBook(box, [btn(760)]), true, '…the same from below (760…804: 12px under it)');
    eq(r._pillCoversBook(box, [btn(688)]), false, '688…732: a 5px sliver under the pill → the whole button can be seen and hit: left alone');
    eq(r._pillCoversBook(box, [btn(766)]), false, '…and a 6px sliver from below (766…810)');
    eq(r._pillCoversBook(box, [btn(100), btn(400), btn(733)]), true, 'any ONE button is enough');
    eq(r._pillCoversBook(box, [btn(733, 1080)]), false, 'desktop: the Book column is nowhere near the centred pill');
    eq(r._pillCoversBook({ left: 63, top: 727, right: 327, bottom: 772 }, [btn(733)]), true, 'a shorter pill that still reaches 29px into the Book column covers it');
    eq(r._pillCoversBook({ left: 63, top: 727, right: 300, bottom: 772 }, [btn(733)]), false, 'a short pill (no seat, short names) that ends at the Book column\'s edge: nothing is covered');
    eq(r._pillCoversBook(box, [{ left: 0, top: 0, right: 0, bottom: 0 }]), false, 'a button on another tab is not laid out (an empty box at 0,0): under nothing');
    eq([r._pillCoversBook(null, [btn(733)]), r._pillCoversBook(box, null), r._pillCoversBook(box, []), r._pillCoversBook(box, [null, {}])], [false, false, false, false], 'junk in → false, no throw');
    // When the question is asked at all.
    const rest = { y: 0, anchor: 0, dir: 0, tucked: false };
    eq(r._pillRestApplies(rest, {}), true, 'at rest where it always shows (no scroll yet, the top, the end): asked');
    eq(r._pillRestApplies({ y: 300, anchor: 100, dir: 1, tucked: true }, {}), false, 'tucked by the scroll: nothing to decide');
    eq(r._pillRestApplies({ y: 286, anchor: 300, dir: -1, tucked: false }, {}), false, 'called back by a scroll up: it stays, whatever it landed on — the member asked for it');
    eq(r._pillRestApplies({ y: 40, anchor: 30, dir: 1, tucked: false }, {}), false, 'on its way down, not yet tucked: the scroll decides');
    eq([r._pillRestApplies(rest, { hidden: true }), r._pillRestApplies(rest, { focused: true }), r._pillRestApplies(null, {}), r._pillRestApplies(rest)], [false, false, false, true], 'not while there is no pill to show, not while a keyboard is ON it; junk → false');
    // Standing aside is believed at once; coming back takes two clear looks.
    eq(r._pillRestStep({ rest: false, clear: false }, true), { rest: true, clear: false, again: false }, 'a button under it → aside, at once');
    eq(r._pillRestStep({ rest: true, clear: false }, false), { rest: true, clear: true, again: true }, 'aside, and this look is clear → NOT back yet (the cards may still be sliding in): look again');
    eq(r._pillRestStep({ rest: true, clear: true }, false), { rest: false, clear: false, again: false }, '…clear again → back');
    eq(r._pillRestStep({ rest: true, clear: true }, true), { rest: true, clear: false, again: false }, '…covered after all → it never came back, and the count starts over');
    eq(r._pillRestStep({ rest: false, clear: false }, false), { rest: false, clear: false, again: false }, 'showing and clear: nothing to do, no second look');
    eq(r._pillRestStep(null, false), { rest: false, clear: false, again: false }, 'junk in → showing');
  }

  t.section('10c: pill — wired with passive listeners, one frame at a time, and never out of a keyboard\'s or a screen reader\'s reach');
  {
    const wiring = between(settingsSrc, '  var _pillTuck = { y: 0, anchor: 0, dir: 0, tucked: false };', '\n\n\n  // ═══', 'the pill\'s scroll wiring');
    const create = between(settingsSrc, '  function createPill() {', '\n  }\n', 'createPill');
    ok(/document\.addEventListener\('scroll', _pillScrollEvent, \{ capture: true, passive: true \}\);/.test(create) && /_pillEl\.addEventListener\('focus', _pillUntuck\);/.test(create),
      'installed with the pill: ONE scroll listener — capture (scroll does not bubble; .tab-content is built later), passive — and focus brings it back');
    eq((settingsSrc.match(/addEventListener\('scroll'/g) || []).length, 1, 'there is no second scroll listener');
    ok(!/getComputedStyle|getBoundingClientRect|offsetParent|offsetHeight|offsetWidth|offsetTop|getClientRects|elementFromPoint/.test(wiring), 'nothing in the scroll path asks for layout beyond the scroller\'s own three numbers');
    // The look at rest is the one place that measures — and the scroll frame only ever QUEUES it.
    const restCode = between(settingsSrc, '  // Where the pill RESTS', '  var _pillTuck = { y: 0, anchor: 0, dir: 0, tucked: false };', 'the pill\'s look at rest');
    ok(/getComputedStyle\(_pillEl\)/.test(restCode) && /getBoundingClientRect\(\)/.test(restCode), 'where the pill rests and where the Book buttons are is measured in _pillRestCheck\'s helpers…');
    const onScroll = between(wiring, '  function _pillOnScroll() {', '\n  }\n', '_pillOnScroll');
    ok(/_pillRestQueue\(\);/.test(onScroll) && !/_pillRestCheck/.test(onScroll), '…which a scroll frame never calls: it re-arms the timer, and the look happens once the list has stopped');
    ok(/_pillEl\.addEventListener\('blur', _pillRestQueue\);/.test(create) && /document\.addEventListener\('click', _pillRestQueue, true\);/.test(create) && /document\.addEventListener\('animationend', _pillRestQueue, true\);/.test(create)
      && /window\.addEventListener\('resize', _pillRestQueue\);/.test(create) && /new MutationObserver\(_pillRendered\)\.observe\(document\.body, \{ childList: true, subtree: true \}\);/.test(create),
      'whatever else can change what lies under it asks again the same way: a render, a tap, an entrance animation ending, a resize, focus leaving it');
    const update = between(settingsSrc, '  function updatePill() {', '\n  }\n', 'updatePill');
    ok(/_pillEl\.classList\.remove\('hidden'\);[\s\S]*if \(typeof _pillRestCheck === 'function'\) _pillRestCheck\(\);\s*$/.test(update), 'a pill that is shown is looked at AT ONCE (not queued): one that has to stand aside is never painted first — and every 30s after, the net under the triggers');
    // (Comments out first: they talk about aria-modal. The one attribute it READS is in the dialog selector.)
    const wiringCode = wiring.replace(/\/\/[^\n]*/g, '');
    ok(!/setAttribute|removeAttribute|\.blur\(|\.focus\(|tabIndex|\.hidden\s*=|\.innerHTML|\.textContent/.test(wiringCode), 'it never WRITES role, tabindex, aria, focus or content: tucked, the pill is exactly the button it was (only _pillA11y writes those, and only for "no next class")');
    eq(wiringCode.match(/classList\.\w+\('[\w-]+'/g), ["classList.contains('is-tucked'", "classList.toggle('is-tucked'", "classList.contains('tab-content'"], 'the ONE thing it changes is the is-tucked class');

    // The shipped wiring, over fakes.
    const p = t.loadPure('js/settings.js', 'pill-scroll');
    const pr = t.loadPure('js/settings.js', 'pill-rest');
    const world = () => {
      const w = { frames: [], classWrites: 0, queries: 0, modals: [], buttons: [], timers: [], measures: 0, keyFocus: false };
      const classes = new Set(['next-class-pill']);
      // The pill rests at 23…367 × 727…772 (left 195 is its CENTRE: a transform centres it).
      w.pill = { offsetWidth: 344, offsetHeight: 45, matches: (sel) => { if (sel !== ':focus-visible') throw new Error('unexpected selector ' + sel); return w.keyFocus; },
        classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), toggle: (c, on) => { w.classWrites++; if (on) classes.add(c); else classes.delete(c); } } };
      w.tucked = () => classes.has('is-tucked');
      w.body = { style: {}, parentElement: null };
      w.doc = { body: w.body, activeElement: w.body, querySelectorAll: (sel) => { if (sel === '.book-btn') return w.buttons; w.queries++; w.lastQuery = sel; return w.modals; } };
      w.doc.scrollingElement = { scrollTop: 0, scrollHeight: 2800, clientHeight: 800 };
      w.tabContent = { scrollTop: 0, scrollHeight: 2800, clientHeight: 700, classList: { contains: (c) => c === 'tab-content' } };
      w.ctx = t.vm.createContext({ document: w.doc, window: {}, requestAnimationFrame: (fn) => { w.frames.push(fn); return w.frames.length; }, _pillEl: w.pill, isNaN, parseFloat,
        _pillScrollStep: p._pillScrollStep, _pillCalledBack: p._pillCalledBack, PILL_REST_MS: pr.PILL_REST_MS, PILL_REST_AGAIN_MS: pr.PILL_REST_AGAIN_MS,
        _pillCoversBook: pr._pillCoversBook, _pillRestApplies: pr._pillRestApplies, _pillRestStep: pr._pillRestStep,
        getComputedStyle: (el) => { w.measures++; if (el !== w.pill) throw new Error('only the pill is asked for its style'); return { left: '195px', top: '727px' }; },
        setTimeout: (fn, ms) => { w.timers.push({ fn, ms, live: true }); return w.timers.length; },
        clearTimeout: (id) => { if (w.timers[id - 1]) w.timers[id - 1].live = false; } });
      w.ctx.window = w.ctx; // `t === window`
      t.vm.runInContext(restCode + '\n' + wiring, w.ctx, { filename: 'js/settings.js[pill rest + scroll wiring]' });
      w.frame = () => { const f = w.frames.splice(0); f.forEach((fn) => fn()); return f.length; };
      // The queued looks that are still due: run them, answer with their delays.
      w.settle = () => { const due = w.timers.filter((x) => x.live); due.forEach((x) => { x.live = false; x.fn(); }); return due.map((x) => x.ms); };
      w.button = (top, extra) => { const b = Object.assign({ disabled: false, getBoundingClientRect: () => { w.measures++; return { left: 298, right: 362, top: b.top, bottom: b.top + 44 }; } }, extra, { top }); w.buttons.push(b); return b; };
      w.scroll = (target, y) => { target.scrollTop = y; w.ctx._pillScrollEvent({ target: target === w.doc.scrollingElement ? w.doc : target }); };
      return w;
    };
    let w = world();
    w.scroll(w.tabContent, 40); w.scroll(w.tabContent, 80); w.scroll(w.tabContent, 120);
    eq([w.frames.length, w.tucked()], [1, false], 'three scroll events in one frame → ONE frame callback queued, nothing done yet');
    eq([w.frame(), w.tucked(), w.classWrites], [1, true, 1], 'the frame reads the scroller once and writes ONE class: phone — .tab-content scrolled down → tucked');
    w.scroll(w.tabContent, 200); w.frame(); w.scroll(w.tabContent, 320); w.frame();
    eq([w.tucked(), w.classWrites], [true, 1], 'still heading down: no further DOM write (the class is only touched when it changes)');
    w.scroll(w.tabContent, 290); w.frame();
    eq([w.tucked(), w.classWrites], [false, 2], 'up again → back');
    w = world();
    w.scroll(w.doc.scrollingElement, 300); w.frame();
    eq(w.tucked(), true, 'wider than a phone the DOCUMENT scrolls: the same, off document.scrollingElement');
    w = world();
    const row = { scrollTop: 0, scrollHeight: 9000, clientHeight: 50, classList: { contains: () => false } };
    w.scroll(row, 600);
    eq([w.frames.length, w.tucked()], [0, false], 'a row scrolling sideways, a sheet, the desktop filter column: not the list — ignored, not even a frame');
    // A dialog: asked only when the pill is about to change, and read off inline styles.
    w = world();
    const wrapper = { style: { display: 'none' }, parentElement: w.body };
    w.modals = [{ style: {}, parentElement: wrapper }];
    w.scroll(w.tabContent, 300); w.frame();
    eq([w.tucked(), w.lastQuery], [true, '[aria-modal="true"]'], 'the seat picker is in the page but switched off (inline display on its wrapper): not a dialog, the pill tucks');
    const asked = w.queries;
    w.scroll(w.tabContent, 600); w.frame();
    eq(w.queries, asked, '…and while nothing is about to change the question is not even asked');
    w = world();
    w.modals = [{ style: {}, parentElement: { style: { display: 'flex' }, parentElement: w.body } }];
    w.scroll(w.tabContent, 300); w.frame();
    eq([w.tucked(), w.classWrites], [false, 0], 'a dialog is up → never hidden while it is');
    w.modals = [];
    w.scroll(w.tabContent, 310); w.frame();
    eq(w.tucked(), false, 'dialog closed, 10px further: still shown (no pent-up travel)…');
    w.scroll(w.tabContent, 360); w.frame();
    eq(w.tucked(), true, '…a real scroll down hides it again');
    // Focus.
    w.ctx._pillUntuck();
    eq(w.tucked(), false, 'focus lands on it (Tab, a screen reader) → it is on screen at once');
    w.scroll(w.tabContent, 370); w.frame();
    eq(w.tucked(), false, '…and the next run down starts from there');
    const noPill = world();
    noPill.ctx._pillEl = null;
    noPill.scroll(noPill.tabContent, 500);
    ok(noPill.frame() === 1 && noPill.classWrites === 0, 'no pill yet: nothing to do, no throw');

    // At rest: the shipped look (_pillRestCheck + its helpers), over the same fakes.
    // Launch, the top of a Discover day on a phone: the fourth card's Book sits under the pill's seat badge.
    w = world();
    w.button(711); w.button(200); w.button(0, { getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) }); // + one higher up, + another tab's (not laid out)
    w.ctx._pillRestCheck(); // what updatePill does the moment it shows the pill
    eq([w.tucked(), w.classWrites], [true, 1], 'before the first scroll, a Book button under it → it stands aside at once (a tap there reached the pill and opened My Bookings)');
    ok(w.measures > 0, '…decided by measuring: the pill\'s resting box and the buttons\' boxes');
    w.buttons[0].top = 688; // 5px of its foot under the pill: a sliver, not an overlap
    w.ctx._pillRestCheck();
    eq([w.tucked(), w.settle()], [true, [pr.PILL_REST_AGAIN_MS]], 'the list re-rendered and this look is clear — NOT back yet: the cards may still be sliding in, so it looks again ' + pr.PILL_REST_AGAIN_MS + 'ms on…');
    eq([w.tucked(), w.classWrites, w.settle()], [false, 2, []], '…still clear (only a sliver of the button\'s foot is under it): back, and no third look');
    w.buttons[0].top = 711;
    w.ctx._pillRestCheck();
    w.buttons[0].top = 719; // a filter tap: the same layout, caught 8px into its entrance (still well under it)…
    w.ctx._pillRestCheck();
    w.buttons[0].top = 770; // …or caught clear of it (2px is a touching edge)
    w.ctx._pillRestCheck();
    w.buttons[0].top = 711; // landed
    eq([w.settle(), w.tucked(), w.classWrites], [[pr.PILL_REST_AGAIN_MS], true, 3], 'a render that ends where it began never blinks the pill on top of the button: the clear look mid-slide is not believed, the second one sees the cards landed');
    // A search streams its studios in: every render slides its cards in afresh, so every render starts the count over.
    w.buttons[0].top = 770;
    w.ctx._pillRestCheck();          // clear (mid-slide): one look more and it would be back…
    w.ctx._pillRendered();           // …but the next studio's cards land
    eq([w.settle(), w.tucked()], [[pr.PILL_REST_MS], true], 'a render between the two looks: the look that follows it is a FIRST look again (its cards are mid-slide too)…');
    w.buttons[0].top = 711;
    eq([w.settle(), w.tucked(), w.classWrites], [[pr.PILL_REST_AGAIN_MS], true, 3], '…so a streamed search never blinks it either');
    w.buttons[0].disabled = true;
    w.ctx._pillRestCheck(); w.settle();
    eq(w.tucked(), false, 'a disabled pill ("Full") takes no tap: nothing to keep clear');
    // The scroll frame never measures; it queues ONE look for when the list has stopped.
    w = world();
    w.button(711);
    w.scroll(w.tabContent, 4); w.frame(); w.scroll(w.tabContent, 9); w.frame(); w.scroll(w.tabContent, 12); w.frame();
    eq([w.measures, w.timers.filter((x) => x.live).map((x) => x.ms), w.tucked()], [0, [pr.PILL_REST_MS], false], 'three frames at the top: nothing measured, ONE look due ' + pr.PILL_REST_MS + 'ms after the last of them');
    eq([w.settle(), w.tucked()], [[pr.PILL_REST_MS], true], 'the list has stopped at the top, on a Book button → aside');
    w.ctx._pillRestQueue({ type: 'click' }); // it is a listener too
    eq(w.timers.filter((x) => x.live).map((x) => x.ms), [pr.PILL_REST_MS], 'as a listener it is handed an event, not a delay');
    w.settle();
    // Down the list from there: it never pops in between "at rest" and "tucked by the scroll".
    w.scroll(w.tabContent, 30); w.frame();
    w.scroll(w.tabContent, 44); w.frame();
    eq([w.tucked(), w.classWrites], [true, 1], 'scrolling down from a pill that stood aside: it stays away the whole way (no flash between the two reasons)');
    w.scroll(w.tabContent, 300); w.frame(); w.settle();
    // Called back mid-list: it stays, whatever it landed on.
    w.scroll(w.tabContent, 288); w.frame();
    eq(w.tucked(), false, 'a scroll up calls it back…');
    eq([w.settle(), w.tucked()], [[pr.PILL_REST_MS], false], '…and at rest it STAYS, on a Book button or not: the member asked for it (the next scroll down clears it)');
    // Back at the top / the end: not before the look that follows.
    w.scroll(w.tabContent, 400); w.frame(); w.settle();
    const writesBefore = w.classWrites;
    w.scroll(w.tabContent, 0); w.frame();
    eq([w.tucked(), w.classWrites], [true, writesBefore], 'a fling (or a tab switch) back to the top: NOT shown yet — it would flash on top of the button…');
    eq([w.settle(), w.tucked(), w.classWrites], [[pr.PILL_REST_MS], true, writesBefore], '…and the look finds the button under it: it never was');
    w.scroll(w.tabContent, 400); w.frame(); w.settle();
    w.buttons[0].top = 100;
    w.scroll(w.tabContent, 2100); w.frame();
    eq([w.tucked(), w.settle(), w.tucked()], [true, [pr.PILL_REST_MS], false], 'the end of the list, nothing under it: back after ONE look (nothing is sliding in after a scroll)');
    // Never under a dialog, never while a keyboard is on it, and nothing to decide with no next class.
    w = world();
    w.button(711);
    w.modals = [{ style: {}, parentElement: { style: { display: 'flex' }, parentElement: w.body } }];
    w.ctx._pillRestCheck();
    eq([w.tucked(), w.classWrites], [false, 0], 'a dialog is up: nothing changes under it');
    w.modals = [];
    w.doc.activeElement = w.pill; w.keyFocus = true;
    w.ctx._pillRestCheck();
    eq(w.tucked(), false, 'keyboard focus is ON it: it is not asked to stand aside');
    w.keyFocus = false;
    w.ctx._pillRestCheck();
    eq(w.tucked(), true, 'focus a TAP left behind does not pin it over the button (the pill is a tab stop, so a tap focuses it)');
    w.ctx._pillUntuck();
    eq(w.tucked(), false, 'focus landing on it brings it back from this too');
    w.pill.matches = () => { throw new Error('no :focus-visible here'); };
    w.ctx._pillRestCheck();
    eq(w.tucked(), false, 'an engine without :focus-visible (iOS < 15.4): any focus counts — it errs towards showing');
    w.doc.activeElement = w.body;
    w.ctx._pillRestCheck();
    eq(w.tucked(), true, '…and once focus has moved on (blur queues a look) it stands aside again');
    w.pill.classList.add('hidden');
    w.buttons.length = 0;
    w.ctx._pillRestCheck();
    eq(w.tucked(), false, 'no next class: the hidden pill keeps no "aside" for the next one to inherit');

    // The look.
    const tucked = rule(s9d, '.next-class-pill.is-tucked');
    ok(/opacity: 0;/.test(tucked) && /pointer-events: none;/.test(tucked) && /transform: translateX\(-50%\) translateY\(var\(--space-8\)\);/.test(tucked), 'tucked: faded, slid down — and out of the pointer\'s reach, so a tap goes to the card under it');
    ok(!/display\s*:|visibility\s*:/.test(tucked), '…but never display:none / visibility:hidden: it stays in the tab order and the accessibility tree');
    const net = rule(s9d, '.next-class-pill.is-tucked:focus-visible');
    ok(/opacity: 1;/.test(net) && /pointer-events: auto;/.test(net) && /transform: translateX\(-50%\);/.test(net), 'the net under the script: keyboard focus shows it, whatever the class says');
    ok(s9d.indexOf('.next-class-pill.is-tucked {') < s9d.indexOf('.next-class-pill.is-tucked:focus-visible {'), '…and comes after the rule it answers');
    const motion = (/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(s9d) || [])[1] || '';
    ok(/\.next-class-pill \{ transition: none; \}/.test(motion) && /\.next-class-pill\.is-tucked \{ transform: translateX\(-50%\); \}/.test(motion), 'reduced motion: no slide and no fade — it is simply not drawn, then drawn');
    ok(/transition: transform var\(--transition-slow\), opacity var\(--transition-slow\);/.test(noComments(t.readSource('css/settings.css'))), 'otherwise it rides the transition the pill already had (css/settings.css)');
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. Desktop
  // ════════════════════════════════════════════════════════════════════
  t.section('10c: desktop Discover — filters in a pinned left column, the timetable on the right');
  {
    const rootTokens = {};
    (/:root \{([\s\S]*?)\n\}/.exec(themeCss) || [])[1].replace(/(--[\w-]+):\s*([^;]+);/g, (m, k, v) => { rootTokens[k] = v.trim(); return m; });
    // calc(var(--a) * 8 + var(--b)) → px, from css/theme.css's :root.
    const px = (expr) => {
      const flat = String(expr).replace(/var\((--[\w-]+)\)/g, (m, k) => String(parseFloat(rootTokens[k]))).replace(/calc/g, '').trim();
      if (!/^[\d\s.+\-*/()]+$/.test(flat)) return NaN;
      return Function('"use strict"; return (' + flat + ');')();
    };
    const a = s9b.indexOf('@media (min-width: 1024px) {\n  #tab-discover.active {');
    ok(a !== -1, 'the desktop block is in crisp:9b-discover');
    const block = s9b.slice(a, s9b.indexOf('\n}\n', a) + 2);
    const grid = rule(block, '#tab-discover.active');
    ok(/display: grid;/.test(grid) && /grid-template-columns: var\(--disc-rail\) minmax\(0, 1fr\);/.test(grid) && /align-items: start;/.test(grid), 'two columns: the filter column, and minmax(0, 1fr) — so the day pager\'s wide track cannot push the page sideways');
    const rail = px((/--disc-rail: ([^;]+);/.exec(grid) || [])[1]);
    ok(rail >= 320 && rail <= 360, 'the filter column is ' + rail + 'px (the brief\'s ~320; the date row — calendar + five ranges on one line — needs 335)');
    const pin = px((/--disc-pin: ([^;]+);/.exec(grid) || [])[1]);
    const tabBar = px('calc(var(--tap-min) + var(--space-6))');
    ok(pin > tabBar && pin - tabBar <= 24, 'it pins ' + (pin - tabBar) + 'px under the sticky tab bar (' + tabBar + 'px: --tap-min + its block padding)');
    ok(/#tab-discover > \.disc-header,\s*#tab-discover > #travelNotice,\s*#tab-discover > \.results \{ grid-column: 2; \}/.test(block), 'the freshness line, the travel notice and #results (the day strip and the cards live in it) take the right-hand column');
    const col = rule(block, '#tab-discover > .controls');
    ok(/grid-column: 1;/.test(col) && /grid-row: 1 \/ span 3;/.test(col) && /position: sticky;/.test(col) && /top: var\(--disc-pin\);/.test(col), 'the filters: column one, down every row, pinned');
    ok(/max-height: calc\(100vh - var\(--disc-pin\) - var\(--space-7\)\);/.test(col) && /overflow-y: auto;/.test(col), 'taller than the window (an open calendar, many studios) it scrolls by itself');
    // At scroll 0 the column sits BELOW its pinned place (the header above the tab bar is not sticky), so its
    // foot is under the window's edge. Contained, the wheel stopped at the column's end with the instructor
    // box still cut off, and nothing moved until the pointer left the column.
    ok(!/overscroll-behavior/.test(block), '…and hands the scroll ON to the page at its end: the page moves, the column pins, and its last control comes into the window (`overscroll-behavior: contain` trapped the wheel at the top of the page)');
    // Three occupied `auto` rows share a spanning item's height EQUALLY: with the travel notice up and a short
    // list, a blank band opened under the freshness line and another under the notice. Only a flexible track
    // takes the space of an item that spans it.
    ok(/grid-template-rows: auto auto 1fr;/.test(grid), 'the rows are explicit — auto · auto · 1fr — so the filter column\'s height goes to the LAST row alone (no bands above the travel notice and the list when the list is short)');
    eq((/grid-row: 1 \/ span (\d+);/.exec(col) || [])[1], String(((/grid-template-rows: ([^;]+);/.exec(grid) || [])[1] || '').split(/\s+/).length), '…and the column spans exactly the rows that are named');
    ok(/max-width: none;/.test(col) && /margin: 0 calc\(var\(--space-2\) \* -1\);/.test(col), 'the scroll box keeps room for the pills\' shadows and focus rings, and the margin gives it back');
    ok(/#tab-discover \.instr-dropdown \{ top: auto; bottom: 100%;/.test(block), 'a scroll box would cut off a list opening below its LAST control: the instructor matches open upward here');
    // The mono themes.
    ok(/html:is\(\[data-theme="terminal"\], \[data-theme="gameboy"\]\) #tab-discover\.active \{ --disc-rail: ([^;]+); \}/.test(block), 'Terminal and Handheld (a monospace body face) get a wider column…');
    const monoRail = px((/html:is\(\[data-theme="terminal"\], \[data-theme="gameboy"\]\) #tab-discover\.active \{ --disc-rail: ([^;]+); \}/.exec(block) || [])[1]);
    ok(monoRail > rail && monoRail <= 400, '…' + monoRail + 'px, and the phone\'s tight segments, so their date row is one line too');
    ok(/html:is\(\[data-theme="terminal"\], \[data-theme="gameboy"\]\) #tab-discover \.date-track \.date-quick-btn \{ padding: 0 calc\(var\(--space-1\) \/ 2\); \}/.test(block), '(the roomy mono padding of 9b.4 is for a row that scrolls; here it would wrap)');
    // Results: a readable measure at the panel's 1080 and at the narrowest desktop.
    const gap = px((/column-gap: ([^;]+);/.exec(grid) || [])[1]);
    const inset = px('var(--space-9)') * 2;
    const at = (w) => Math.min(w, 1080) - inset - rail - gap;
    ok(at(1024) >= 560 && at(1440) <= 700, 'cards are ' + at(1024) + 'px at 1024 and ' + at(1440) + 'px on a wide window — a readable measure (they were 1032px, the action far from the name)');
    // What the old desktop overrides did is gone.
    ok(!/\.day-pill \{ width: calc\(var\(--tap-lg\) \+ var\(--space-7\)\); \}/.test(s9b), 'the day pills are no longer 72px tiles huddled left: seven span the results column, as they span a phone');
    ok(!/\.date-track \{ flex: 0 0 auto; \}/.test(s9b), 'the date track no longer hugs its ranges with desktop padding (it has to fit the column)');
    // By construction, nothing of this reaches a phone or a tablet.
    const outside = s9b.slice(0, a) + s9b.slice(a + block.length);
    ['#tab-discover.active {', '#tab-discover > .controls', '#tab-discover > .results', '#tab-discover > .disc-header', '--disc-rail', '--disc-pin', '.instr-dropdown'].forEach((needle) => {
      ok(outside.indexOf(needle) === -1, '"' + needle + '" appears only inside the >= 1024px block');
    });
    ok(!/:has\(/.test(block) && !/!important/.test(block), 'no :has() and no !important in it (tests/suites/9b-discover.js holds the whole section to that)');
    // Pinning needs .tab-content to stop being a scroll container.
    ok(/@media \(min-width: 1024px\) \{\s*\.tab-content:has\(> #tab-discover\.active\) \{ overflow: clip; \}\s*\}/.test(tabsCss), 'css/tabs.css: .tab-content is `clip`, not `hidden`, while Discover is up at >= 1024px — a rule of its own, so an engine without :has() drops only it (the column then scrolls with the page)');
    ok(/@media \(min-width: 641px\) \{\s*\.tab-content:has\(> #tab-stats\.active\) \{ overflow: clip; \}/.test(tabsCss), '…beside the Stats rule it copies, which is untouched');
  }

  t.section('10c: desktop — the class sheet is a dialog with a width of its own; the picker sits beside it');
  {
    const rootTokens = {};
    (/:root \{([\s\S]*?)\n\}/.exec(themeCss) || [])[1].replace(/(--[\w-]+):\s*([^;]+);/g, (m, k, v) => { rootTokens[k] = v.trim(); return m; });
    const px = (expr) => { const flat = String(expr).replace(/var\((--[\w-]+)\)/g, (m, k) => String(parseFloat(rootTokens[k]))).replace(/calc/g, '').trim(); return /^[\d\s.+\-*/()]+$/.test(flat) ? Function('"use strict"; return (' + flat + ');')() : NaN; };
    // (\s*: the block opens with a comment, which leaves a blank line behind once comments are stripped.)
    const opener = /@media \(min-width: 1024px\) \{\s*\.class-detail-sheet \{/.exec(s9c);
    const a = opener ? opener.index : -1;
    ok(a !== -1, 'the rule is inside a >= 1024px block of crisp:9c-sheets');
    const block = s9c.slice(a, s9c.indexOf('\n}\n', a) + 2);
    const sheet = rule(block, '.class-detail-sheet');
    ok(/width: 100%;/.test(sheet), 'width: 100% — it had a max-width only, and as an auto-margin flex item it shrank to its content (293px for a short class name: narrower than on a phone, and a different width per class)');
    const w = px((/max-width: ([^;]+);/.exec(sheet) || [])[1]);
    ok(w >= 480 && w <= 560, '…capped at ' + w + 'px');
    const picker = px((/#bikeModal \.modal \{ max-width: ([^;]+); \}/.exec(block) || [])[1]);
    ok(picker >= 480 && picker <= 560 && picker >= w, 'the seat picker: ' + picker + 'px (it was 640) — the same kind of dialog, a touch wider for the map');
    ok(a > 0 && !/\.class-detail-sheet \{[^}]*(?<![-\w])(max-)?width:/.test(s9c.slice(0, a)), 'below 1024px the sheet is still the full-width bottom sheet: no width or max-width is set outside the block');
  }

  t.section('10c: "Clear filters" is there only while a filter is on');
  {
    ok(/'<button type="button" id="discClearBtn" class="disc-clear-btn" onclick="clearFilters\(\)" hidden>Clear filters<\/button>'/.test(tabsSrc), 'it is built hidden (nothing is on at the first paint), with an id the painter can find');
    ok(/\.disc-clear-btn\[hidden\] \{ display: none; \}/.test(s9b), '[hidden] is said in CSS too: alone it loses to any display rule');
    // The SHIPPED painter, over a fake page (modelled on tests/suites/8a-filters.js).
    const chrome = between(appSrc, '// ── pure:filter-summary:start', '// ── pure:filters:start ── (DOM-free date-range helpers', 'the filter-summary chrome');
    const lines = appSrc.split('\n');
    const from = lines.findIndex((l) => l.startsWith('function _repaintKeepingFocus('));
    const to = lines.findIndex((l, i) => i > from && l === '}');
    const repaint = lines.slice(from, to + 1).join('\n');
    const constList = (name) => t.vm.runInNewContext(between(appSrc, 'const ' + name + ' = [', '\n];', name) + '\n];\n' + name + ';');
    const world = (o) => {
      const summary = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; }, contains: () => false, querySelectorAll: () => [] };
      const clear = { hidden: 'unset' };
      const els = { controlsSummary: summary, controlsToggle: { setAttribute() {}, focus() {} }, controlsCount: { textContent: '', hidden: true } };
      if (!(o && o.noButton)) els.discClearBtn = clear;
      // The date row, as far as a focus hand-off can see it: the lit range, else the first button of the row.
      const focused = [];
      const datePill = (name) => ({ focus() { focused.push(name); doc.activeElement = this; } });
      const row = { '#controlsPanel .date-quick-btn.active': (o && o.noLitPill) ? null : datePill('lit range'), '#controlsPanel .date-quick-btn': datePill('first date button') };
      const doc = { activeElement: null, getElementById: (id) => els[id] || null, querySelector: (sel) => row[sel] || null };
      const ctx = t.vm.createContext({
        console, Set, Array, Object, String, document: doc,
        selectedLocations: new Set(), selectedCategories: new Set(), selectedTimeBands: new Set(), selectedInstructors: new Set(),
        selectedStrengthSubs: new Set(constList('STRENGTH_SUBS').map((s) => s.key)), selectedReformerSubs: new Set(constList('REFORMER_SUBS').map((s) => s.key)),
        favouriteInstructors: new Set(), _availableOnly: false, locations: [{ id: 4, name: 'Psycle Bank' }], instructors: [{ id: 1, full_name: 'Alex Morgan' }],
        CATEGORY_MAP: constList('CATEGORY_MAP'), STRENGTH_SUBS: constList('STRENGTH_SUBS'), REFORMER_SUBS: constList('REFORMER_SUBS'), TIME_BANDS: constList('TIME_BANDS'),
        _topTierInstructorIds: () => [], _mirrorDatePillAria: () => {}, escapeHTML, announce: () => {}, PsycleState: { subscribe: () => {} },
      });
      t.vm.runInContext(repaint + '\n' + chrome, ctx, { filename: 'js/app.js[filter summary]' });
      return { ctx, clear, summary, doc, focused };
    };
    let w = world();
    w.ctx.updateFiltersSummary();
    eq(w.clear.hidden, true, 'nothing on → hidden (it used to sit there with nothing to clear)');
    w.ctx.selectedLocations.add('4');
    w.ctx.updateFiltersSummary();
    eq([w.clear.hidden, /class="controls-clear"/.test(w.summary.innerHTML)], [false, true], 'a studio chosen → shown — exactly when the Filters bar grows its own "Clear" (one rule for both)');
    w.clear.hidden = 'stale';
    w.ctx.updateFiltersSummary();
    eq(w.clear.hidden, false, 'the same chips again: the painter returns early — AFTER the button was put right');
    w.ctx.selectedLocations.clear(); w.ctx._availableOnly = true;
    w.ctx.updateFiltersSummary();
    eq(w.clear.hidden, false, '"Available only" alone counts as a filter');
    w.ctx._availableOnly = false;
    w.ctx.updateFiltersSummary();
    eq(w.clear.hidden, true, 'the last filter off → hidden again');
    let threw = false;
    try { world({ noButton: true }).ctx.updateFiltersSummary(); } catch (e) { threw = true; }
    ok(!threw, 'no such button in the page (tabs.js has not built it yet): no throw');
    // …which is the order of a WARM launch: the reference lists come from the 24h cache, app.js paints its one
    // launch-time summary, and initTabs (setTimeout 50) builds the button afterwards — hidden. With starred
    // instructors pre-selected and no saved filters to restore, nothing painted the summary again: a filter on,
    // and no "Clear filters" (the bar's own Clear is hidden at >= 1024px). initTabs asks for itself.
    {
      const built = tabsSrc.indexOf('discoverPanel.appendChild(discHeader);');
      const asked = tabsSrc.indexOf("if (typeof updateFiltersSummary === 'function') updateFiltersSummary();", built);
      ok(built !== -1 && asked !== -1 && asked < tabsSrc.indexOf('discoverPanel.appendChild(controls);', built),
        'initTabs repaints the summary as soon as the button is in the page — it does not wait for whoever paints it next');
      // The button the painter finds then: shown when a filter is already on, left hidden otherwise.
      const late = world({ noButton: true });
      late.ctx.selectedInstructors.add('1');
      late.ctx.updateFiltersSummary();            // app.js at launch: no button yet
      late.doc.getElementById = ((get) => (id) => (id === 'discClearBtn' ? late.clear : get(id)))(late.doc.getElementById);
      late.clear.hidden = true;                   // initTabs builds it `hidden`…
      late.ctx.updateFiltersSummary();            // …and asks
      eq(late.clear.hidden, false, 'the same chips as at launch (the painter returns early) — and the late button is still shown');
    }

    // Enter on "Clear filters" hides the button that holds the focus (display: none): the focus fell
    // to <body>. It is handed on, the way a removed chip's is.
    w = world();
    w.ctx.selectedLocations.add('4');
    w.ctx.updateFiltersSummary();
    w.doc.activeElement = w.clear;
    w.ctx.updateFiltersSummary();
    eq([w.clear.hidden, w.focused], [false, []], 'focused, a filter still on: it stays and keeps the focus — nothing is moved');
    w.ctx.selectedLocations.clear(); // what clearFilters() has done by the time it repaints the summary
    w.ctx.updateFiltersSummary();
    eq([w.clear.hidden, w.focused, w.doc.activeElement === w.clear], [true, ['lit range'], false], 'focused, the last filter cleared: hidden — and the focus goes to the lit date range, the first stop of the filter column (it fell to <body>)');
    w.ctx.updateFiltersSummary();
    eq(w.focused, ['lit range'], '…once: a later repaint does not pull the focus back there');
    w = world();
    w.ctx._availableOnly = true;
    w.ctx.updateFiltersSummary();
    w.ctx._availableOnly = false;
    w.ctx.updateFiltersSummary();
    eq([w.clear.hidden, w.focused], [true, []], 'hidden while the focus is somewhere else (a chip\'s ×, the panel\'s own control): the focus is left where it is');
    w = world({ noLitPill: true });
    w.ctx.selectedLocations.add('4');
    w.ctx.updateFiltersSummary();
    w.doc.activeElement = w.clear;
    w.ctx.selectedLocations.clear();
    w.ctx.updateFiltersSummary();
    eq(w.focused, ['first date button'], 'no range lit (it cannot happen after Clear — belt and braces): the first button of the date row');
  }
};
