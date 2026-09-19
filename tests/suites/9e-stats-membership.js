'use strict';
// Wave 9e — Crisp Colour on Stats, Membership, the Class colours control, the
// share images and the sign-in page.
//
//   1. pure:stats-charts (js/tabs.js): the numbers behind the streak's weekly
//      bars, "When you train" and the class-type bar — read off wall-clock
//      DIGITS, so a device abroad draws the same grid (this run is pinned to
//      America/New_York).
//   2. pure:class-colour-control (js/tabs.js): what the control draws, from the
//      REAL engine's palette (js/theme.js pure:class-colours), and the radio
//      groups' keys. Then the shipped markup builder against that model.
//   3. Colour means class type: no class or rank colour is named in tabs.js /
//      explore.js any more — components say WHICH type (data-ct) and
//      css/crisp.css colours them; the heatmap and the rank tiles stay neutral.
//   4. The 9e section of css/crisp.css: contrast of every ink it puts on a
//      fill, in all seven themes; fingertip targets; focus rings.
//   5. The share images and login.html wear the new chrome and faces.
module.exports = function (t) {
  const { ok, eq } = t;
  const tabsSrc = t.readSource('js/tabs.js');
  const exploreSrc = t.readSource('js/explore.js');
  const themeJs = t.readSource('js/theme.js');
  const themeCss = t.readSource('css/theme.css');
  const crispCss = t.readSource('css/crisp.css');
  const login = t.readSource('login.html');
  const plain = (v) => JSON.parse(JSON.stringify(v)); // out of the vm realm, for eq
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const grab = (src, from, to) => {
    const a = src.indexOf(from);
    const b = a === -1 ? -1 : src.indexOf('\n' + to + '\n', a);
    return a === -1 || b === -1 ? '' : src.slice(a, b + to.length + 1);
  };

  // ── 1. Stats charts ──────────────────────────────────────────────────────
  t.section('Stats charts: class times are read off their digits (pure:stats-charts)');
  const c = t.loadPure('js/tabs.js', 'stats-charts');
  eq(plain(c._wallParts('2026-09-21 00:30:00')), { day: 0, hour: 0 }, 'Monday 00:30 London is Monday at hour 0 — also on a device five hours behind (a device-zone parse says Sunday 19:30)');
  eq(plain(c._wallParts('2026-09-27T23:45:00')), { day: 6, hour: 23 }, 'the T spelling reads the same: Sunday, 23');
  eq(plain(c._wallParts('2026-03-29 01:30:00')), { day: 6, hour: 1 }, 'a wall time inside the spring clock change still has its weekday and hour');
  eq([c._wallParts(''), c._wallParts(null), c._wallParts('garbage'), c._wallParts('2026-13-01 07:00:00'), c._wallParts('2026-09-21 24:00:00')], [null, null, null, null, null],
    'anything that is not a class time is no cell at all (it used to become a "NaN-NaN" key)');

  eq([0, 5, 8, 9, 11, 12, 14, 15, 17, 18, 21, 23].map(c._heatBandIndex), [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4],
    'five bands: before 9 · 9–12 · 12–15 · 15–18 · from 18 — the first and last take the early birds and the late classes, so nothing falls off the grid');
  eq(plain(c.HEAT_BANDS.map((b) => b.label)), ['06', '09', '12', '15', '18'], 'labelled as the board draws them');
  eq([c._heatLevel(0, 9), c._heatLevel(1, 9), c._heatLevel(3, 9), c._heatLevel(5, 9), c._heatLevel(9, 9), c._heatLevel(2, 0)], [0, 1, 2, 3, 4, 0],
    'ink steps: never → 0, then quarters of the busiest cell');
  {
    const starts = [].concat(
      Array(6).fill('2026-09-14 18:30:00'), // Monday evening ×6
      Array(3).fill('2026-09-19 09:30:00'), // Saturday morning ×3
      Array(3).fill('2026-09-17 18:30:00'), // Thursday evening ×3
      ['2026-09-15 12:30:00', 'not a date', null]
    );
    const m = c._heatmapModel(starts);
    eq([m.total, m.max, m.counts.length, m.counts[0].length], [13, 6, 5, 7], 'thirteen placeable classes on a 5 × 7 grid');
    eq([m.counts[4][0], m.counts[1][5], m.counts[4][3], m.counts[2][1]], [6, 3, 3, 1], 'each lands in its band × weekday (Monday first)');
    eq([m.levels[4][0], m.levels[1][5], m.levels[2][1], m.levels[0][0]], [4, 3, 1, 0], '…with its level');
    eq(plain(m.top), [{ band: 4, day: 0, count: 6 }, { band: 4, day: 3, count: 3 }, { band: 1, day: 5, count: 3 }], 'the three busiest cells, busiest first; ties in calendar order');
    eq(c._heatmapLabel(m), 'Classes by weekday and time of day. Most often: Monday evening, Thursday evening, Saturday morning.', 'what the grid says to someone who cannot see it');
    eq(c._heatmapLabel(c._heatmapModel([])), 'Classes by weekday and time of day.', 'nothing to name → the lead alone');
  }
  {
    const weeks = { 90: true, 91: true, 93: true, 94: true, 95: true };
    const bars = plain(c._streakWeeks(weeks, 96, 8)); // this week (96) has no class yet
    eq(bars.map((b) => (b.live ? 'L' : b.on ? 'o' : '.')).join(''), '.oo.LLL.', 'eight weeks, oldest first: an earlier run, a missed week, the run still going (it may end last week: this week is not over), this week a stub');
    eq(c._streakWeeksLabel(bars), 'Last 8 weeks: 5 with a class, 3 in a row now.', 'said in words');
    eq(plain(c._streakWeeks(weeks, 98, 4)).filter((b) => b.live).length, 0, 'two empty weeks: nothing is live any more');
    eq(c._streakWeeksLabel(c._streakWeeks({ 50: true }, 50, 12)), 'Last 12 weeks: 1 with a class.', 'a single week is not "in a row"');
    eq(plain(c._streakWeeks(null, 10, 3)), [{ on: false, live: false }, { on: false, live: false }, { on: false, live: false }], 'no history: three stubs, nothing thrown');
  }
  {
    const cats = [{ key: 'RIDE', label: 'Ride' }, { key: 'STRENGTH', label: 'Strength' }, { key: 'YOGA', label: 'Yoga' }, { key: 'OTHER', label: 'Other' }];
    const b = plain(c._classTypeBreakdown({ RIDE: 3, YOGA: 12, OTHER: 1, LAGREE: 9 }, cats));
    eq(b.rows.map((r) => r.ct + ':' + r.count), ['yoga:12', 'ride:3', 'other:1'], 'rows with a class, biggest first, keyed for data-ct (a key the category list does not name is not drawn)');
    eq([b.total, b.gaps], [16, ['Strength']], 'the total is what the bar adds up to; "Never tried" never lists Other');
    const evil = Object.create({ RIDE: 99 });
    eq(plain(c._classTypeBreakdown(evil, cats)).total, 0, 'own properties only');
    eq(plain(c._classTypeBreakdown(null, null)), { total: 0, rows: [], gaps: [] }, 'nothing in, nothing out');
  }
  ok(/_takenRows\(history, Date\.now\(\), _historyStartMs\(\)\)\.forEach/.test(grab(tabsSrc, '  function renderClassTypeDistribution() {', '  }')),
    'the class-type bar counts classes TAKEN — the same rows as "All time" above it, so the two add up');

  // ── 2. The Class colours control ─────────────────────────────────────────
  t.section('Class colours control: the model (pure:class-colour-control, on the real palette)');
  const engine = t.loadPure('js/theme.js', 'class-colours');
  const ctl = t.loadPure('js/tabs.js', 'class-colour-control');
  const CATS = [['RIDE', 'Ride'], ['STRENGTH', 'Strength'], ['YOGA', 'Yoga'], ['HIIT', 'HIIT'], ['PILATES', 'Pilates'], ['LAGREE', 'Lagree'], ['BARRE', 'Barre'], ['OTHER', 'Other']]
    .map((p) => ({ key: p[0], label: p[1] }));
  const apiWith = (stored) => ({
    KEYS: engine.CLASS_COLOUR_KEYS, INTENSITIES: engine.CLASS_COLOUR_INTENSITIES, PALETTE: engine.CLASS_COLOUR_PALETTE,
    DEFAULTS: engine.CLASS_COLOUR_DEFAULTS, DEFAULT_INTENSITY: engine.CLASS_COLOUR_DEFAULT_INTENSITY,
    get: () => engine._ccClean(stored),
  });
  const swatchIds = Object.keys(engine.CLASS_COLOUR_PALETTE);
  {
    const m = plain(ctl._ccControlModel(apiWith(null), CATS, { base: 'light' }, ''));
    eq(m.rows.map((r) => r.key), plain(engine.CLASS_COLOUR_KEYS), 'one row per class type the member could meet — all eight, in the engine\'s order');
    eq(m.rows.map((r) => r.label), CATS.map((x) => x.label), '…named as the Discover pills name them');
    eq(m.rows.map((r) => r.swatch), engine.CLASS_COLOUR_KEYS.map((k) => engine.CLASS_COLOUR_DEFAULTS[k]), 'nothing stored → every type wears its default');
    eq([m.intensity, m.intensities.map((i) => i.label + (i.checked ? '*' : ''))], ['soft', ['Off', 'Soft*', 'Bold']], 'Off · Soft · Bold, Soft chosen');
    eq([m.canReset, m.muted, m.preview.key, m.rows.some((r) => r.open)], [false, false, 'ride', false], 'at the defaults there is nothing to reset; the preview shows the first type; every row is closed');
    ok(m.rows.every((r) => r.swatches.length === swatchIds.length && r.swatches.map((s) => s.id).join() === swatchIds.join()), 'every row offers the ONE curated palette, in its own order');
    ok(m.rows.every((r) => r.swatches.filter((s) => s.checked).length === 1 && r.swatches.filter((s) => s.checked)[0].id === r.swatch), 'exactly one swatch is checked per row: the one in effect');
    ok(m.rows.every((r) => r.swatchName && r.swatchColour === r.swatches.filter((s) => s.checked)[0].colour), 'the row names its swatch ("Cobalt") and carries its colour for the dot');
    ok(m.rows[0].swatches.every((s) => /^#[0-9a-f]{6}$/i.test(s.colour) && s.colour === engine.CLASS_COLOUR_PALETTE[s.id].light.base), 'a swatch shows the palette\'s own base colour for a light theme');
  }
  {
    const stored = { v: 1, intensity: 'bold', map: { ride: 'rose', yoga: 'constructor', lagree: 'nope' } };
    const m = plain(ctl._ccControlModel(apiWith(stored), CATS, { base: 'dark', mono: true }, 'yoga'));
    eq([m.rows[0].swatch, m.rows[0].swatchName, m.rows[2].swatch, m.rows[5].swatch], ['rose', 'Rose', 'jade', 'teal'], 'a stored choice shows; a swatch the palette does not own ("constructor", "nope") falls back to the default');
    eq(m.rows[0].swatchColour, engine.CLASS_COLOUR_PALETTE.rose.dark.base, 'on a dark theme the swatches show the palette\'s dark side');
    eq([m.canReset, m.muted, m.preview.key, m.preview.name, m.rows.filter((r) => r.open).map((r) => r.key)], [true, false, 'yoga', 'Yoga Flow', ['yoga']],
      'something to reset; Bold shows the colours even on a mono theme; the open row is the one previewed');
    const soft = plain(ctl._ccControlModel(apiWith({ v: 1, intensity: 'soft', map: {} }), CATS, { base: 'dark', mono: true }, '__proto__'));
    eq([soft.muted, soft.rows.some((r) => r.open), soft.preview.key], [true, false, 'ride'], 'a mono theme below Bold: the control says the colours are not showing — and an unknown row key opens nothing');
    eq(ctl._ccControlModel(null, CATS, {}, ''), null, 'no engine (theme.js missing) → no control, nothing thrown');
    const odd = { KEYS: ['ride'], INTENSITIES: ['soft'], DEFAULT_INTENSITY: 'soft', DEFAULTS: { ride: 'x' }, PALETTE: { x: { name: 'X', light: { base: 'url(javascript:1)' }, dark: {} } }, get: () => ({ intensity: 'soft', map: {} }) };
    eq(plain(ctl._ccControlModel(odd, [], { base: 'light' }, '')).rows[0].swatches[0].colour, '', 'only a plain hex colour may reach a style attribute');
  }
  eq([['ArrowRight', 0], ['ArrowDown', 10], ['ArrowLeft', 0], ['ArrowUp', 3], ['Home', 7], ['End', 2], ['Enter', 2], ['a', 2]].map((p) => ctl._ccRadioTarget(11, p[1], p[0])),
    [1, 0, 10, 2, 0, 10, -1, -1], 'radio keys: Right / Down next, Left / Up previous — both wrap; Home / End jump; anything else is not the group\'s');
  eq(ctl._ccRadioTarget(0, 0, 'ArrowRight'), -1, 'an empty group moves nowhere');

  t.section('Class colours control: the shipped markup');
  {
    const from = tabsSrc.indexOf('  var CC_TICK = ');
    const to = tabsSrc.indexOf('  // Rebuilt whole on every change');
    ok(from !== -1 && to > from, 'the markup builder can be sliced (anchors moved? update tests/suites/9e-stats-membership.js)');
    const pureSrc = tabsSrc.slice(tabsSrc.indexOf('  // ── pure:class-colour-control:start'), tabsSrc.indexOf('  // ── pure:class-colour-control:end'));
    const ctx = t.vm.createContext({
      escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      classPictogram: (key, size) => '<svg data-pic="' + key + '" width="' + size + '"></svg>',
    });
    t.vm.runInContext(pureSrc + '\n' + tabsSrc.slice(from, to), ctx, { filename: 'js/tabs.js[class-colours]' });
    const html = ctx._ccControlHtml(ctx._ccControlModel(apiWith({ v: 1, intensity: 'bold', map: { strength: 'sky' } }), CATS, { base: 'light' }, 'strength'));
    const tags = (re) => html.match(re) || [];
    const groups = tags(/<div class="[^"]*" (?:id="[^"]*" )?role="radiogroup" aria-label="[^"]+"/g);
    eq(groups.length, 9, 'nine named radio groups: the strength, and one per class type');
    ok(/role="radiogroup" aria-label="Colour strength"/.test(html) && /role="radiogroup" aria-label="Strength colour"/.test(html), '…named for what they choose');
    const intensity = tags(/<button type="button" class="seg-btn" role="radio"[^>]*>/g);
    eq(intensity.map((b) => [/aria-checked="true"/.test(b), /tabindex="0"/.test(b)]), [[false, false], [false, false], [true, true]], 'Off · Soft · Bold are radios; only the chosen one is checked and is the group\'s one tab stop');
    const swatches = tags(/<button type="button" class="cc-swatch" role="radio"[^>]*>/g);
    eq(swatches.length, swatchIds.length, 'only the OPEN row\'s swatches are in the DOM (one palette, not eight)');
    eq(swatches.filter((b) => /aria-checked="true"/.test(b)).map((b) => (/aria-label="([^"]+)"/.exec(b) || [])[1]), ['Sky'], 'the chosen swatch is checked, and every swatch is named by its colour name');
    ok(swatches.every((b) => /aria-label="[A-Z][a-z]+"/.test(b) && /style="--cc-sw:#[0-9A-Fa-f]{6};--cc-sw-ink:#FFFFFF"/.test(b)), 'its colour reaches the stylesheet as a custom property — no fill is written here');
    ok(/class="cc-swatch-tick"/.test(html) && /\.cc-swatch\[aria-checked="true"\] \.cc-swatch-tick \{ display: block; \}/.test(crispCss) && /\.cc-swatch\[aria-checked="true"\]::before \{ box-shadow:/.test(crispCss),
      'the chosen one is marked by a tick and a ring — not by colour alone');
    const rows = tags(/<button type="button" class="cc-row-btn"[^>]*>/g);
    eq([rows.length, rows.filter((b) => /aria-expanded="true"/.test(b)).length, rows.every((b) => /aria-controls="ccSwatches-[a-z]+"/.test(b))], [8, 1, true],
      'eight rows, each a real disclosure button naming the panel it opens; one is open');
    eq((html.match(/id="ccSwatches-[a-z]+" role="radiogroup" aria-label="[^"]+" hidden/g) || []).length, 7, 'the seven closed panels are hidden');
    ok(/<div class="cc-preview class-card ct-card" data-ct="strength" aria-hidden="true">/.test(html) && /<span class="cc-head"><span class="ct-tile"><svg data-pic="strength" width="18">/.test(html) &&
      /<span class="cc-sub"><span class="cc-who">Maya<\/span><span class="cc-loc">Shoreditch<\/span><\/span><span class="cc-spots">25 spots left<\/span>/.test(html) && /<div class="cc-action"><span class="book-btn">Book<\/span><\/div>/.test(html),
      'the live preview IS the class card (.class-card.ct-card + data-ct, eventCard\'s own anatomy: .cc-head, .cc-sub, .cc-spots, the Book pill), so 9b.7 styles it — not a look-alike with rules of its own');
    ok(!/<button|role="button"|tabindex|onclick|data-id|data-event-id/.test((/<div class="cc-preview[\s\S]*?<\/div><\/div>/.exec(html) || [''])[0]) && /\.cc-preview \{\s*pointer-events: none;/.test(crispCss),
      '…decoration, with nothing to press: no button, no id the booking code could find, out of the pointer\'s reach');
    ok(!/cc-preview-(when|ampm|mins|name|meta|what|book)/.test(html + crispCss), 'the look-alike parts (and their rules) are gone');
    // The time block is the shared builder's (js/app.js _ccTimeHTML) — typeof-guarded, as the pictogram is.
    ok(html.indexOf('cc-time') === -1 && /typeof _ccTimeHTML === 'function' \? _ccTimeHTML\(\{ hours: 18, mins: 30, duration: 45 \}\) : ''/.test(tabsSrc), 'evaluated without app.js the time block is absent; in the app it is _ccTimeHTML\'s');
    const withTime = t.vm.createContext({ escapeHTML: (x) => String(x), classPictogram: () => '', _ccTimeHTML: t.loadPure('js/app.js', 'class-type', { getCategory: () => null })._ccTimeHTML });
    t.vm.runInContext(pureSrc + '\n' + tabsSrc.slice(from, to), withTime, { filename: 'js/tabs.js[class-colours + time]' });
    ok(/<div class="cc-time"><span class="cc-time-h">6:30<\/span><span class="cc-dur"><span class="cc-ampm">pm<\/span> · 45 min<\/span><\/div><div class="cc-info">/.test(
      withTime._ccControlHtml(withTime._ccControlModel(apiWith(null), CATS, { base: 'light' }, ''))), '…the very block a Discover card prints: the digits over "pm · 45 min"');
    ok(/<button type="button" class="pill-btn pill-quiet cc-reset" data-cc-reset="1" data-cc-focus="reset">Reset colours<\/button>/.test(html), '"Reset colours" is offered while something differs from the defaults');
    const atDefault = ctx._ccControlHtml(ctx._ccControlModel(apiWith(null), CATS, { base: 'light' }, ''));
    ok(/data-cc-focus="reset" disabled>Reset colours/.test(atDefault) && !/cc-note/.test(atDefault), '…and disabled at the defaults; no note on an ordinary theme');
    ok(/<p class="cc-note">Shown at Bold only in this theme\.<\/p>/.test(ctx._ccControlHtml(ctx._ccControlModel(apiWith(null), CATS, { base: 'dark', mono: true }, ''))),
      'Terminal / Handheld below Bold: one short line says why nothing changes');
  }
  {
    const wiring = tabsSrc.slice(tabsSrc.indexOf('  function _ccSet('), tabsSrc.indexOf('  // The engine changed something'));
    ok(/api\.set\(partial\);/.test(wiring) && /window\.PsycleClassColours\.reset\(\);/.test(wiring), 'every change goes through PsycleClassColours.set() / reset()');
    ok(!/psycle_class_colours|localStorage/.test(tabsSrc.slice(tabsSrc.indexOf('  // ── Class colours (Membership'), tabsSrc.indexOf('  // ── Weekly reminder row'))),
      'the control keeps no copy of the choices and never touches storage itself');
    ok(/radios\[to\]\.focus\(\);\s*radios\[to\]\.click\(\);/.test(wiring), 'arrow keys move AND choose (selection follows focus), through the same click path');
    ok(/PsycleEvents\.on\('classcolours:changed'/.test(tabsSrc) && /PsycleEvents\.on\('theme:changed', function \(\) \{ if \(_currentTab === 'membership'\) renderThemePicker\(\); \}\);/.test(tabsSrc),
      'it follows the engine (an import, the iOS restore) and the theme (the swatches show the palette side of its base)');
    ok(/id="classColours" class="cc-control" role="group" aria-labelledby="classColoursTitle"/.test(tabsSrc) &&
      tabsSrc.indexOf('<div id="themePicker"></div>') < tabsSrc.indexOf('id="classColours"'), 'it sits in Membership → Appearance, under the theme picker, as a named group');
  }

  // ── 3. Colour means class type ───────────────────────────────────────────
  t.section('No class or rank colour is named in markup any more');
  {
    const types = grab(tabsSrc, '  function renderClassTypeDistribution() {', '  }');
    ok(/class="ctd-seg" data-ct="' \+ c\.ct \+ '"/.test(types) && /class="ctd-item" data-ct="' \+ c\.ct \+ '"/.test(types) && !/\.color|background:/.test(types),
      'the class-type bar and its legend say which type (data-ct); css/crisp.css colours them');
    const card = grab(exploreSrc, '  function instrCard(profile, whyLabel) {', '  }');
    ok(/class="explore-type-tag" data-ct="' \+ ct \+ '"/.test(card) && !/style="color|cat\.color|#888/.test(card), 'instructor-card tags the same way (the base colour as text was ~2.5:1 on dark panels)');
    ok(!/tierColors|#b8860b|#2a7a2a|#222'/.test(exploreSrc) && /class="explore-tier-legend-dot tier-' \+ tierKeys\[tl\]/.test(exploreSrc),
      'the tier legend wears the SAME class as its segment — one source of colour, so "unranked" can no longer disagree with itself');
    const picker = grab(tabsSrc, '  function renderThemePicker() {', '  }');
    ok(/class="theme-swatch" data-theme="' \+ t\.id \+ '"/.test(picker) && !/style="background/.test(picker), 'a theme chip is drawn from that theme\'s OWN tokens (data-theme on the swatch) — no colour is copied into the markup');
    // …which only works while a theme's token block is a bare attribute selector
    // (it then also matches the swatch <span data-theme>), and while the swatch
    // reads the PRIMARY tokens: aliases such as --surface resolve on <html>.
    const ids = [];
    themeJs.replace(/\{\s*id:\s*'([a-z]+)'/g, (m, id) => { ids.push(id); return m; });
    eq(ids.filter((id) => themeCss.indexOf('\n[data-theme="' + id + '"] {') === -1), [], 'every theme\'s token block is a bare [data-theme="id"] selector');
    const swatchRules = (noComments(crispCss).match(/[^{}]*\.theme-swatch[^{}]*\{[^}]*\}/g) || []).join('\n');
    ok(/background: var\(--bg\);/.test(swatchRules) && /background: var\(--bg-panel\);/.test(swatchRules) && /background: var\(--accent\);/.test(swatchRules) && !/var\(--(surface|sunken|ground|line|ink)\b/.test(swatchRules),
      'the miniature is painted with primary tokens only (ground, surface card, ink line, accent pill)');
    const heat = grab(tabsSrc, '  function renderHeatmap() {', '  }');
    ok(/hm-level-/.test(heat) && !/data-ct|--ct-/.test(heat), 'the heatmap stays on the theme\'s neutral ramp: colour keeps ONE meaning');
    const section = noComments(crispCss.slice(crispCss.indexOf('/* == crisp:9e-stats-membership == */')));
    ok(section.length > 5000, 'the 9e section of css/crisp.css is there (' + section.length + ' bytes)');
    const heatRules = (section.match(/[^{}]*\.(?:hm-|heatmap-)[^{}]*\{[^}]*\}/g) || []).join('\n');
    ok(heatRules.length > 0 && !/--ct-/.test(heatRules), '…and none of its heatmap rules reads a class colour');
    const rank = (section.match(/\.tier-[SABCDF], \.active-[SABCDF] \{[^}]*\}/g) || []);
    eq([rank.length, rank.some((r) => /--ct-|--accent\b/.test(r))], [6, false], 'six rank recipes, all neutral (ink, surface, hairline, sunken)');
    ok(!/!important/.test(section), 'nothing in the section needs !important');
  }

  // ── 4. The 9e stylesheet ─────────────────────────────────────────────────
  t.section('css/crisp.css (9e): inks on fills hold in all seven themes');
  {
    const HEX = /^#[0-9a-f]{6}$/i;
    const lum = (hex) => {
      const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const tokensOf = (selector) => {
      const start = themeCss.indexOf('\n' + selector + ' {');
      if (start === -1) return {};
      const out = {};
      noComments(themeCss.slice(themeCss.indexOf('{', start) + 1, themeCss.indexOf('}', start))).replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
      return out;
    };
    const root = tokensOf(':root');
    const ids = [];
    themeJs.replace(/\{\s*id:\s*'([a-z]+)'/g, (m, id) => { ids.push(id); return m; });
    eq(ids.length, 7, 'seven themes in the registry');
    // [ink, ground, what it is, the floor] — every pair the 9e rules put together.
    const PAIRS = [
      ['--bg-panel', '--text', 'rank S / a reached milestone: the surface on the ink', 4.5],
      ['--text', '--bg-panel', 'rank A, the chosen theme chip, the main cost figure', 4.5],
      ['--text-heading', '--border', 'rank B: the heading ink on the hairline fill', 4.5],
      ['--text-muted', '--bg-deep', 'rank C, a later milestone, captions in a sunken well (cost tiles, forecast, Settings rows)', 4.5],
      ['--text-muted', '--bg', 'rank D / F / unranked in the tier bar, on the ground', 4.5],
      ['--text-muted', '--bg-panel', 'rank D / F on a card; captions on a card', 4.5],
      ['--text-ghost', '--bg-panel', 'quiet labels on a card (This month, Longest, axis labels)', 4.5],
      ['--text-ghost', '--bg', 'quiet labels on the ground (section labels, about)', 4.5],
      ['--text', '--bg-input', 'a quiet action on the surface-2 fill (View classes, the search box)', 4.5],
      ['--danger', '--bg-panel', 'Sign out: the danger ink on the surface', 4.5],
    ];
    ids.forEach((id) => {
      const tk = Object.assign({}, root, tokensOf('[data-theme="' + id + '"]'));
      const get = (k) => { let v = tk[k], n = 0; while (v && /^var\(/.test(v) && n++ < 6) v = tk[(/var\((--[a-z0-9-]+)/.exec(v) || [])[1]]; return v; };
      PAIRS.forEach((p) => {
        const ink = get(p[0]), ground = get(p[1]);
        if (!HEX.test(ink || '') || !HEX.test(ground || '')) { ok(false, id + ': ' + p[0] + ' / ' + p[1] + ' are plain colours (' + ink + ', ' + ground + ')'); return; }
        const r = contrast(ink, ground);
        ok(r >= p[3], id + ': ' + p[0] + ' on ' + p[1] + ' is ' + r.toFixed(2) + ':1 (≥' + p[3] + ') — ' + p[2]);
      });
      // The chosen Stats page / the intensity segment: the accent pair, held to
      // the app's existing floor (tests/suites/1f: 3:1 on Terminal and Synthwave).
      const need = (id === 'terminal' || id === 'synthwave') ? 3 : 4.5;
      const a = contrast(get('--accent-ink'), get('--accent'));
      ok(a >= need, id + ': --accent-ink on --accent is ' + a.toFixed(2) + ':1 (≥' + need + ') — the chosen segment');
    });
    const section = noComments(crispCss.slice(crispCss.indexOf('/* == crisp:9e-stats-membership == */')));
    const body = (sel) => { const at = section.indexOf('\n' + sel + ' {'); return at === -1 ? '' : section.slice(section.indexOf('{', at) + 1, section.indexOf('}', at)); };
    ok(/background: var\(--text\);/.test(body('.milestone-badge.earned')) && /color: var\(--bg-panel\);/.test(body('.milestone-badge.earned .milestone-num')),
      'a small number on a fill uses the ink / surface pair (an accent fill is only 3.3:1 on Terminal and Synthwave)');
    ok(/background: var\(--accent\);\s*color: var\(--accent-ink\);/.test(body('.stats-switcher-tab[aria-selected="true"]')), 'the chosen Stats page is the graphite segment of the board: accent + its own label ink');
    ok(/background: var\(--sunken\)/.test(body('#tab-membership .cost-card')) && /background: var\(--sunken\)/.test(body('.settings-panel .app-row')), 'wells inside a card are the sunken ground (muted captions fail on --bg-input in Handheld)');
  }

  t.section('css/crisp.css (9e): fingertips, focus, motion, no glass');
  {
    const section = noComments(crispCss.slice(crispCss.indexOf('/* == crisp:9e-stats-membership == */')));
    const body = (sel) => { const at = section.indexOf('\n' + sel + ' {'); return at === -1 ? '' : section.slice(section.indexOf('{', at) + 1, section.indexOf('}', at)); };
    ok(/width: var\(--tap-min\);\s*height: var\(--tap-min\);/.test(body('.cc-swatch')), 'a swatch is a fingertip-sized radio (the colour is a disc inside it)');
    ok(/min-height: var\(--tap-lg\)/.test(body('.cc-row-btn')) && /min-height: var\(--tap-lg\)/.test(body('.ms-signout')) && /min-height: var\(--tap-min\)/.test(body('.explore-sync-btn')) &&
      /min-height: var\(--tap-min\)/.test(body('.habit-card .habit-find-btn')) && /min-height: var\(--tap-min\)/.test(body('.explore-card-action')) && /min-height: var\(--tap-min\)/.test(body('.share-insights-btn')),
      'rows, Sign out and every pill are at least a fingertip tall');
    ['.cc-swatch', '.cc-row-btn', '.year-review-btn', '.share-insights-btn', '.explore-sync-btn', '.explore-unranked-item', '#tab-membership .theme-chip', '.stats-switcher-tab'].forEach((sel) => {
      ok(new RegExp(sel.replace(/[.#[\]]/g, '\\$&') + ':focus-visible \\{ outline: var\\(--focus-ring\\)').test(section), sel + ' shows the body-ink focus ring');
    });
    ok(/\.cc-swatches\[hidden\] \{ display: none; \}/.test(section), 'a closed swatch panel stays closed (a display rule would beat the attribute)');
    ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.cc-swatch::before \{ transition: none; \}/.test(section), 'reduced motion is respected');
    ok(/\.year-review-modal \{[^}]*backdrop-filter: none;/.test(section) && /\.settings-overlay \{[^}]*backdrop-filter: none;/.test(section), 'no glass behind the wrap or the Settings panel: a plain scrim');
    ok(/\.streak-card\.streak-main,\s*\.streak-card\.streak-main\.streak-live \{[^}]*box-shadow: var\(--shadow-soft\);[^}]*\}/.test(section) && !/streak[^{}]*\{[^}]*glow/.test(section),
      'the live streak has no glow — the glow is for what is selected or yours');
    ok(!/glow/.test(body('#tab-membership .theme-chip.active')), '…and neither has the chosen theme chip: an ink ring');
  }

  // ── 5. Share images + the sign-in page ───────────────────────────────────
  t.section('Share images: the new chrome, faces and class colours');
  {
    const share = t.loadPure('js/tabs.js', 'share');
    const cloud = {};
    const start = themeCss.indexOf('\n[data-theme="cloud"] {');
    noComments(themeCss.slice(themeCss.indexOf('{', start) + 1, themeCss.indexOf('}', start))).replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { cloud[k] = v.trim(); return m; });
    eq(plain(share.SHARE_FALLBACK), { bg: cloud['--bg'], panel: cloud['--bg-panel'], border: cloud['--border'], heading: cloud['--text-heading'], muted: cloud['--text-muted'], accent: cloud['--accent'] },
      'the fallback palette IS css/theme.css\'s Cloud, value for value');
    const helper = grab(tabsSrc, '  function _shareClassColour(cat, pal) {', '  }');
    ok(helper.length > 0, '_shareClassColour can be sliced');
    const run = (win, cat) => {
      const ctx = t.vm.createContext({ window: win });
      t.vm.runInContext(helper, ctx);
      return ctx._shareClassColour(cat, { accent: '#111111' });
    };
    eq(run({ PsycleClassColours: { resolve: (k) => ({ base: k === 'RIDE' ? '#C62C58' : '' }) } }, { key: 'RIDE', color: '#2D5FD6' }), '#C62C58', 'a bar is drawn in the member\'s OWN swatch (the engine reads it back off the page)');
    eq(run({}, { key: 'RIDE', color: '#2D5FD6' }), '#2D5FD6', 'no engine → the category\'s own colour');
    eq(run({ PsycleClassColours: { resolve: () => { throw new Error('x'); } } }, { key: 'RIDE', color: 'var(--ct-ride-base)' }), '#111111', 'a var() is never handed to a canvas (it would keep the previous fill): the theme accent instead');
    ok(/var SHARE_WORDMARK_FONT = "900 \d+px 'Sofia Sans Condensed'";/.test(tabsSrc) && !/Bricolage/.test(tabsSrc + themeCss), 'the wordmark is Sofia Sans Condensed 900; the Bricolage face is gone from the app');
    let gone = false;
    try { t.fs.accessSync(t.path.join(t.REPO_ROOT, 'fonts', 'bricolage.woff2')); } catch (e) { gone = true; }
    ok(gone, '…and so is fonts/bricolage.woff2');
  }

  t.section('login.html: the Crisp chrome, fonts and pill button — CSP and framebust untouched');
  {
    ok(login.indexOf("default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src https://psycle.codexfit.com; form-action 'none'; base-uri 'none';") !== -1,
      'the page\'s Content-Security-Policy is unchanged');
    ok(/<script data-framebust>[\s\S]*?window\.top\.location = window\.location;[\s\S]*?<\/script>/.test(login), 'the framebust is still there');
    ok(!/AppDisplay|src:url\(data:/.test(login), 'the data-URI display face is gone');
    ok(/font-family:'Sofia Sans Condensed'[^}]*src:url\('fonts\/sofia-sans-condensed\.woff2'\) format\('woff2'\), url\('sofia-sans-condensed\.woff2'\) format\('woff2'\)/.test(login),
      'the display face loads the same two-source way as the body face (the page is copied as-is into the flat iOS www/)');
    const style = (/<style>([\s\S]*?)<\/style>/.exec(login) || [])[1] || '';
    ok(/\.brand \.word \{[^}]*font-family: var\(--font-display\);[^}]*font-weight: 900;/.test(style) && /\n  h1 \{[^}]*font-family: var\(--font-display\)/.test(style), 'wordmark and heading in the display face');
    ok(/\.btn \{[^}]*min-height: var\(--tap-lg\);[^}]*border-radius: var\(--radius-full\);/.test(style) && !/\.btn \{[^}]*text-transform: uppercase/.test(style), 'the primary action is a tall full pill, sentence case');
    ok(/\.card \{[^}]*border-radius: var\(--radius-8xl\);/.test(style) && !/\.card \{[^}]*border: 1px/.test(style), 'one surface card with the sheet radius and no outline');
    eq((login.match(/<rect x="\d+" y="\d+" width="4" height="\d+" rx="2" fill="#[0-9A-F]{6}"\/>/g) || []).length, 5, 'the five-bar mark');
    ok(/\[data-theme="terminal"\] \.brand svg rect, \[data-theme="gameboy"\] \.brand svg rect \{ fill: var\(--accent\); \}/.test(style), '…which follows the accent on the two one-colour themes');
    ok(!/Psycle Companion/.test(login) && /not affiliated with or endorsed by Psycle\./.test(login), 'no "Psycle Companion" tag under the wordmark; the page that takes a Psycle password says it is independent');
    ['email', 'password', 'loginBtn', 'errMsg', 'sLogin', 'sDone', 'loginForm'].forEach((id) => ok(new RegExp('id="' + id + '"').test(login), '#' + id + ' is still there (the sign-in logic and its tests read it)'));
  }
};
