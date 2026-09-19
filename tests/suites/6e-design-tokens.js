'use strict';
// Wave 6 design-token guards: toast types, the late-cancel caution treatment,
// the bike-picker seat map, the display face, the pull-to-refresh pill.
// Pure text analysis of the CSS (and the legend markup) — no browser.
//
// Like 1f-contrast-tokens.js, these exist because nothing fails when a colour
// is merely wrong for ONE theme: the seat map shipped as Noir literals (black
// and maroon tiles on Handheld, an old-brand pink seat on Cloud) and toast()
// set a type class for years that no stylesheet styled.
module.exports = function (t) {
  // ── WCAG 2.x contrast ────────────────────────────────────────────────────
  function lum(hex) {
    let h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  const themeCss = t.readSource('css/theme.css');
  const stylesCss = t.readSource('css/styles.css');
  const settingsCss = t.readSource('css/settings.css');
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

  function tokensOf(selector) {
    const start = themeCss.indexOf(selector + ' {');
    if (start === -1) throw new Error('theme.css: no block for ' + selector);
    const body = noComments(themeCss.slice(themeCss.indexOf('{', start) + 1, themeCss.indexOf('}', start)));
    const out = {};
    body.replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
    return out;
  }
  const root = tokensOf(':root');
  // A theme's tokens with the :root fallbacks and one-hop var() aliases resolved.
  function themeTokens(id) {
    const tk = Object.assign({}, root, tokensOf('[data-theme="' + id + '"]'));
    Object.keys(tk).forEach((k) => {
      const alias = /^var\((--[a-z0-9-]+)\)$/.exec(tk[k]);
      if (alias) tk[k] = tk[alias[1]];
    });
    return tk;
  }
  const themeIds = [];
  t.readSource('js/theme.js').replace(/\{\s*id:\s*'([a-z]+)'/g, (m, id) => { themeIds.push(id); return m; });
  t.ok(themeIds.length >= 5, 'theme ids parsed from APP_THEMES (' + themeIds.join(', ') + ')');

  function rules(css) {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    const clean = noComments(css);
    while ((m = re.exec(clean))) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
    return out;
  }
  const styleRules = rules(stylesCss);
  const themeRules = rules(themeCss);
  const has = (r, selector) => r.selector.split(',').some((part) => part.trim() === selector);
  // Every value `selector` declares for `prop` in a rule list, in source order.
  function decls(list, selector, prop) {
    return list.filter((r) => has(r, selector))
      .map((r) => (new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+)').exec(r.body) || [])[1])
      .filter(Boolean).map((v) => v.trim());
  }
  // The token a theme really paints: a `[data-theme="id"] <selector>` override
  // in theme.css if there is one, else the token the source rule names.
  function paintedToken(id, selector, prop, sourceToken) {
    const v = decls(themeRules, '[data-theme="' + id + '"] ' + selector, prop)[0];
    const m = v && /^var\((--[a-z0-9-]+)\)$/.exec(v);
    return m ? m[1] : sourceToken;
  }
  const tokenOf = (v) => ((/^var\((--[a-z0-9-]+)[,)]/.exec(v || '') || [])[1]) || null;

  // ── Toast types ──────────────────────────────────────────────────────────
  t.section('Toast: error and success are told apart');
  // The contract these rules hang on: toast() puts its type on #toast as a class.
  // Any spelling counts (className template, string concat, classList) — the
  // inside of toast() is being reworked for live regions.
  const appJs = t.readSource('js/app.js');
  const toastSrc = (/function toast\([^)]*\)\s*\{[\s\S]*?\n\}/.exec(appJs) || [appJs])[0];
  t.ok(/class(?:Name|List)[^;\n]*\btype\b/.test(toastSrc), 'toast() still sets its type as a class on #toast');
  // Wave 9: the two inks are the toast's OWN tokens. Their :root defaults are
  // still the Full-chip red and the accent (so five themes paint what they
  // always did); Cloud and Graphite wear an inverse toast and tune them.
  t.eq([root['--toast-err'], root['--toast-ok'], root['--toast-ink']], ['var(--badge-full-text)', 'var(--accent)', 'var(--text)'],
    ':root: --toast-err / --toast-ok / --toast-ink default to the Full-chip red, the accent and the body ink');
  [['error', '--toast-err', "'!'"], ['success', '--toast-ok', "'\\2713\\FE0E'"]].forEach((row) => {
    const sel = '.toast.' + row[0];
    t.eq(tokenOf(decls(styleRules, sel, 'border-left-color')[0]), row[1], sel + ' edge stripe reads ' + row[1]);
    const glyph = styleRules.filter((r) => r.selector === sel + '::before')[0];
    // Not colour alone: error/success inks are the same hue in Linen, Synthwave and Handheld.
    t.ok(!!glyph && glyph.body.indexOf('content: ' + row[2] + ';') !== -1, sel + ' carries a glyph (' + row[2] + '), not colour alone');
    t.ok(!!glyph && glyph.body.indexOf('content: ' + row[2] + " / '';") > glyph.body.indexOf('content: ' + row[2] + ';'),
      '…with empty alt text declared AFTER the plain fallback (a screen reader hears the message only)');
    t.eq(tokenOf(glyph && (/(?:^|[;\s])color\s*:\s*([^;]+)/.exec(glyph.body) || [])[1]), row[1], '…in the same ink as the stripe');
    themeIds.forEach((id) => {
      const tk = themeTokens(id);
      const r = contrast(tk[row[1]], tk['--toast-bg']);
      t.ok(r >= 4.5, id + ': ' + sel + ' ink ' + tk[row[1]] + ' on --toast-bg is ' + r.toFixed(2) + ':1 (≥4.5)');
    });
  });
  t.ok(has(styleRules.filter((r) => /border-left-width:\s*3px/.test(r.body))[0] || { selector: '' }, '.toast.error'),
    'the stripe is a wider left border (two classes: it outranks theme.css\'s later .toast border colour)');
  t.eq(themeRules.filter((r) => /\.toast\.(error|success|info)/.test(r.selector)).length, 0, 'theme.css does not restyle the toast types');
  // The message itself: --toast-ink on --toast-bg (an inverse ground must bring its own ink).
  t.eq(tokenOf(decls(themeRules, '.toast', 'color')[0]), '--toast-ink', '.toast copy reads --toast-ink');
  themeIds.forEach((id) => {
    const tk = themeTokens(id);
    const r = contrast(tk['--toast-ink'], tk['--toast-bg']);
    t.ok(r >= 4.5, id + ': toast copy ' + tk['--toast-ink'] + ' on --toast-bg ' + tk['--toast-bg'] + ' is ' + r.toFixed(2) + ':1 (≥4.5)');
  });
  // The pull-to-refresh pill wears the same ground, so it takes the same ink.
  t.eq([tokenOf(decls(themeRules, '.pull-indicator', 'background')[0]), tokenOf(decls(themeRules, '.pull-text', 'color')[0])], ['--toast-bg', '--toast-ink'],
    'the pull-to-refresh pill: toast ground, toast ink');

  // ── Late-cancel caution treatment ────────────────────────────────────────
  t.section('Late-cancel note: one caution treatment');
  const TRIO = { background: '--badge-waitlist-bg', color: '--badge-waitlist-text' };
  ['.late-cancel-note', '.badge.late-cancel-note', '.badge.caution', '.bc-detail.late-cancel-note', '.modal-policy.is-late'].forEach((sel) => {
    Object.keys(TRIO).forEach((prop) => {
      t.eq(tokenOf(decls(styleRules, sel, prop)[0]), TRIO[prop], sel + ' { ' + prop + ' } reads ' + TRIO[prop]);
    });
    t.ok(/var\(--badge-waitlist-border\)/.test(decls(styleRules, sel, 'border')[0] || ''), sel + ' is outlined in --badge-waitlist-border');
  });
  // theme.css loads later and recolours .badge with ONE class: the chip form needs two.
  t.ok(decls(themeRules, '.badge', 'color').length === 1 && decls(styleRules, '.badge.late-cancel-note', 'color').length === 1,
    'the My Bookings chip form is a compound selector (it must outrank theme.css\'s .badge)');
  const metrics = styleRules.filter((r) => r.selector === ':where(.late-cancel-note)')[0];
  t.ok(!!metrics && /padding:/.test(metrics.body) && !/color|background/.test(metrics.body),
    'box metrics sit in a zero-specificity :where() — a .badge / .modal-policy keeps its own padding');
  t.eq([tokenOf(decls(styleRules, '.confirm-warn', 'background')[0]), tokenOf(decls(styleRules, '.confirm-warn', 'color')[0]),
    tokenOf(decls(styleRules, '.confirm-warn::before', 'color')[0])], ['--badge-waitlist-bg', '--text-heading', '--badge-waitlist-text'],
  'the dialog warning is the same amber box: heading ink for its sentence, amber glyph');
  t.ok(!/rgba\(233,\s*69,\s*96/.test(noComments(stylesCss).slice(noComments(stylesCss).indexOf('.confirm-warn {'), noComments(stylesCss).indexOf('.confirm-actions {'))),
    'no old-brand pink left in .confirm-warn');
  // Which element carries the hook is the markup's call: inside the dialog's
  // box it must not draw a second chip.
  t.eq([decls(styleRules, '.confirm-warn .late-cancel-note', 'background')[0], decls(styleRules, '.confirm-warn .late-cancel-note', 'color')[0]],
    ['none', 'inherit'], 'a .late-cancel-note nested in .confirm-warn is plain text (no chip in a chip)');
  themeIds.forEach((id) => {
    const tk = themeTokens(id);
    const ink = paintedToken(id, '.late-cancel-note', 'color', '--badge-waitlist-text');
    ['.modal-policy.is-late', '.badge.caution', '.confirm-warn::before'].forEach((sel) => {
      t.eq(paintedToken(id, sel, 'color', '--badge-waitlist-text'), ink, id + ': ' + sel + ' gets the same ink as .late-cancel-note');
    });
    const r = contrast(tk[ink], tk['--badge-waitlist-bg']);
    t.ok(r >= 4.5, id + ': caution chip ' + ink + ' ' + tk[ink] + ' on --badge-waitlist-bg is ' + r.toFixed(2) + ':1 (≥4.5)');
    const w = contrast(tk['--text-heading'], tk['--badge-waitlist-bg']);
    t.ok(w >= 4.5, id + ': dialog warning --text-heading on --badge-waitlist-bg is ' + w.toFixed(2) + ':1 (≥4.5)');
  });

  // ── Bike-picker seat map ─────────────────────────────────────────────────
  t.section('Seat map: every state tokenised at source');
  const seatRules = styleRules.filter((r) => /^\.bike-slot\b/.test(r.selector));
  const literal = seatRules.filter((r) => /#[0-9a-f]{3,8}\b/i.test(r.body.replace(/var\(--[a-z0-9-]+\s*,\s*#[0-9a-f]{3,8}\)/gi, 'var()')));
  t.eq(literal.map((r) => r.selector), ['.bike-slot.usual rect'], 'only the gold "your usual" ring keeps a fixed colour in styles.css');
  [
    ['.bike-slot.available rect', 'fill', '--bg-input'],
    ['.bike-slot.available rect', 'stroke', '--border-light'],
    ['.bike-slot.available:hover rect', 'stroke', '--text-dim'],
    ['.bike-slot.available:hover text', 'fill', '--text-heading'],
    ['.bike-slot.taken rect', 'fill', '--bg-deep'],
    ['.bike-slot.taken rect', 'stroke', '--border-light'],
    ['.bike-slot.taken text', 'fill', '--text-off'],
    ['.bike-slot.mine rect', 'fill', '--booked-bg'],
    ['.bike-slot.mine rect', 'stroke', '--booked-border'],
    ['.bike-slot.mine text', 'fill', '--accent'],
    ['.bike-slot.mine:hover rect', 'fill', '--badge-full-bg'],
    ['.bike-slot.mine:hover text', 'fill', '--danger'],
  ].forEach((row) => {
    t.eq(tokenOf(decls(styleRules, row[0], row[1])[0]), row[2], row[0] + ' { ' + row[1] + ' } reads ' + row[2]);
  });
  // The light patches outranked the source rules and kept your own seat pink on Cloud / Linen.
  const patches = themeRules.filter((r) => /\.bike-slot\.(available|taken|mine)\b(?!\.pref-)/.test(r.selector) && !/\[data-theme="gameboy"\]/.test(r.selector));
  t.eq(patches.map((r) => r.selector), [], 'theme.css no longer re-colours the seat states for the light themes');
  t.ok(!/233,\s*69,\s*96|#e94560/i.test(noComments(themeCss).split('\n').filter((l) => /\.bike-slot|\.up-seat-chip/.test(l)).join('\n')),
    'no old-brand pink on a seat or a seat chip in theme.css');

  // Fav / avoid numbers: the status inks, like the prefs map.
  const settingsRules = rules(settingsCss);
  t.eq([tokenOf(decls(settingsRules, '.bike-slot.pref-prefer text', 'fill')[0]), tokenOf(decls(settingsRules, '.bike-slot.pref-avoid text', 'fill')[0])],
    ['--badge-highlight-text', '--badge-full-text'], 'fav / avoid seat numbers read the status inks (the fixed green / pink fell to 2.6:1 on themed tiles)');
  t.eq(tokenOf(decls(settingsRules, '.bike-slot.mine.pref-prefer text', 'fill')[0]), '--accent', 'a fav / avoid seat you hold keeps the accent number');
  // That rule is !important, so the hover's danger ink (styles.css) needs one too:
  // without it the accent stays on the red hover tint — 3.8:1 on Linen and Handheld.
  ['.bike-slot.mine.pref-prefer:hover text', '.bike-slot.mine.pref-avoid:hover text'].forEach((sel) => {
    const v = decls(settingsRules, sel, 'fill')[0] || '';
    t.ok(tokenOf(v) === '--danger' && /!important/.test(v), sel + ' reads --danger !important (got ' + v + ')');
  });

  themeIds.forEach((id) => {
    const tk = themeTokens(id);
    const pairs = [
      ['available number', paintedToken(id, '.bike-slot.available text', 'fill', '--text-dim'), '--bg-input'],
      ['your-booking number', '--accent', '--booked-bg'],
      ['your-booking hover number', '--badge-full-text', '--badge-full-bg'],
      ['fav number', '--badge-highlight-text', '--bg-input'],
      ['avoid number', '--badge-full-text', '--bg-input'],
    ];
    pairs.forEach((p) => {
      const r = contrast(tk[p[1]], tk[p[2]]);
      t.ok(r >= 4.5, id + ': ' + p[0] + ' ' + p[1] + ' on ' + p[2] + ' is ' + r.toFixed(2) + ':1 (≥4.5)');
    });
    // A taken seat is a ghost tile on the map (--bg-deep on --bg-deep): its
    // outline must not be the map colour itself, as --border is on Cloud.
    t.ok(tk['--border-light'].toLowerCase() !== tk['--bg-deep'].toLowerCase(), id + ': the seat outline is not the map background');
  });

  const html = t.readSource('psycle-finder.html');
  // Wave 9 (Crisp Colour): the legend's swatches are class-styled marks
  // (.seat-key, css/crisp.css) painted from the SAME tokens as the map's seats,
  // so the two cannot drift; tests/suites/9c-sheets.js holds the pairs to 4.5:1.
  const legend = (/<div class="bike-legend">[\s\S]*?<\/div>/.exec(html) || [''])[0];
  const crispCss = noComments(t.readSource('css/crisp.css'));
  t.ok(/<i class="seat-key is-available"><\/i> Available/.test(legend) &&
    /\.bike-legend \.seat-key \{[^}]*background: var\(--seat-free-fill\);[^}]*var\(--seat-free-line\)/.test(crispCss) &&
    /#bikeSvg \.bike-slot \{ --seat-fill: var\(--seat-free-fill\); --seat-line: var\(--seat-free-line\);/.test(crispCss), 'legend Available = the available tile');
  t.ok(/<i class="seat-key is-taken"><\/i> Taken/.test(legend) && /\.bike-legend \.seat-key\.is-taken \{ background: var\(--sunken\);/.test(crispCss) &&
    /#bikeSvg \.bike-slot\.taken \{ --seat-fill: var\(--sunken\);/.test(crispCss), 'legend Taken = the taken tile (the same fill as the map)');
  t.ok(/<i class="seat-key is-mine"><\/i> Your booking/.test(legend) && /\.bike-legend \.seat-key\.is-pick, \.bike-legend \.seat-key\.is-mine \{ background: var\(--seat-mine-fill\);/.test(crispCss),
    'legend has a swatch for a seat you already hold');
  t.ok(!/#[0-9a-f]{3,8}\b/i.test(legend) && !/style=/.test(legend), 'no colour literal — no inline style at all — left in the legend');

  // (.onboard-icon went with the old tour's icon circle. The welcome that
  // replaced it is held to "no colour literal anywhere" in 8d-welcome.js.)
  ['.rebook-hint'].forEach((sel) => {
    t.eq(tokenOf(decls(styleRules, sel, 'background')[0]), '--accent-soft', sel + ' tint follows the accent (it was old-brand pink)');
  });
  t.ok(/^color-mix\(in srgb, var\(--accent\) 16%, var\(--bg\)\)$/.test(root['--accent-soft']), 'the :root --accent-soft recipe is the one mixed below');
  themeIds.forEach((id) => {
    const tk = themeTokens(id);
    // --accent-soft is a color-mix() on the flavour themes: mix it the way `in srgb` does.
    const soft = /^#/.test(tk['--accent-soft']) ? tk['--accent-soft'] : (function () {
      const px = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const a = px(tk['--accent']), b = px(tk['--bg']);
      return '#' + a.map((v, i) => Math.round(v * 0.16 + b[i] * 0.84).toString(16).padStart(2, '0')).join('');
    })();
    const surface = paintedToken(id, '.rebook-hint', 'background', null);
    const bg = surface ? tk[surface] : soft;
    [['.rebook-hint-eyebrow', '--accent'], ['.rebook-hint-sub', '--text-dim']].forEach((row) => {
      const ink = paintedToken(id, row[0], 'color', row[1]);
      const r = contrast(tk[ink], bg);
      t.ok(r >= 4.5, id + ': ' + row[0] + ' ' + ink + ' on the hint (' + (surface || '--accent-soft') + ') is ' + r.toFixed(2) + ':1 (≥4.5)');
    });
  });

  // ── Display face ─────────────────────────────────────────────────────────
  t.section('Display face: never on the 12px section eyebrows');
  const display = themeRules.filter((r) => /font-family:\s*var\(--font-display\)/.test(r.body)).map((r) => r.selector).join(', ');
  ['.insights-title', '.explore-title', '.reco-title', '.heatmap-title', '.cost-title', '.week-title', '.mb-period-header'].forEach((sel) => {
    t.ok(display.split(',').map((s) => s.trim()).indexOf(sel) === -1, sel + ' stays on the body face');
  });
  ['.stat-value', '.class-time', '.modal-title', '.discover-empty-title'].forEach((sel) => {
    t.ok(display.split(',').map((s) => s.trim()).indexOf(sel) !== -1, sel + ' keeps the display face (numerals / headlines)');
  });

  // ── Pull-to-refresh pill ─────────────────────────────────────────────────
  t.section('Pull-to-refresh: parked below the status bar');
  const pill = (styleRules.filter((r) => r.selector === '.pull-indicator')[0] || { body: '' }).body;
  const tops = pill.match(/(?:^|[;\s])top:\s*[^;]+/g) || [];
  t.eq(tops.map((s) => s.replace(/^[;\s]+/, '')), ['top: 0', 'top: env(safe-area-inset-top, 0px)'],
    'top: 0 first (engines without env()), then the safe-area inset');
};
