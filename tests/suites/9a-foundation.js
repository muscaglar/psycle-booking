'use strict';
// Wave 9a — the Crisp Colour foundation: faces, tokens, the class-type colour
// engine (js/theme.js pure:class-colours + window.PsycleClassColours), the
// pictograms (js/app.js pure:class-type), css/crisp.css's mapping block and
// primitives, and the new key's trip through settings export / import and the
// iOS mirror.
//
// Why a contrast matrix: the member may give ANY class type ANY swatch at any
// intensity in any of the five themes, and nothing fails when a colour is merely
// unreadable. So every swatch × role × base is checked against the ink it
// carries, from the shipped values — no sampling.
module.exports = function (t) {
  const { ok, eq } = t;
  const themeCss = t.readSource('css/theme.css');
  const crispCss = t.readSource('css/crisp.css');
  const themeJs = t.readSource('js/theme.js');
  const appJs = t.readSource('js/app.js');
  const settingsJs = t.readSource('js/settings.js');
  const bridge = t.readSource('ios-app/www/native-bridge.js');
  const finder = t.readSource('psycle-finder.html');
  const login = t.readSource('login.html');
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

  // ── WCAG 2.x contrast ────────────────────────────────────────────────────
  const HEX = /^#[0-9a-f]{6}$/i;
  function rgb(hex) { return [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16)); }
  function lum(hex) {
    const c = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  const lstar = (hex) => { const y = lum(hex); return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y; };

  // Custom properties of the first `<selector> {` block of theme.css.
  function tokensOf(css, selector) {
    const start = css.indexOf(selector + ' {');
    if (start === -1) return null;
    const body = noComments(css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start)));
    const out = {};
    body.replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
    return out;
  }
  const root = tokensOf(themeCss, ':root');
  // A theme's tokens over :root, with var() aliases followed to a literal.
  function themeTokens(id) {
    const tk = Object.assign({}, root, tokensOf(themeCss, '[data-theme="' + id + '"]'));
    const resolve = (v, depth) => {
      const m = /^var\((--[a-z0-9-]+)\)$/.exec(v || '');
      return m && depth < 6 ? resolve(tk[m[1]], depth + 1) : v;
    };
    Object.keys(tk).forEach((k) => { tk[k] = resolve(tk[k], 0); });
    return tk;
  }
  const registry = [];
  themeJs.replace(/\{\s*id:\s*'([a-z]+)'[^}]*?base:\s*'(light|dark)'[^}]*?bg:\s*'(#[0-9a-f]{6})'([^}]*)\}/g, (m, id, base, bg, rest) => {
    registry.push({ id, base, bg, mono: /mono:\s*true/.test(rest) });
    return m;
  });

  // ── Faces ────────────────────────────────────────────────────────────────
  t.section('Crisp Colour faces: Sofia Sans + Sofia Sans Condensed, self-hosted, through the two font tokens');
  {
    const faces = [];
    themeCss.replace(/@font-face\s*\{([^}]*)\}/g, (m, body) => {
      faces.push({
        family: (/font-family:\s*'([^']+)'/.exec(body) || [])[1],
        weight: (/font-weight:\s*([^;]+);/.exec(body) || [])[1],
        display: (/font-display:\s*([^;]+);/.exec(body) || [])[1],
        url: (/src:\s*url\('([^']+)'\)\s*format\('woff2'\)/.exec(body) || [])[1],
      });
      return m;
    });
    const face = (name) => faces.filter((f) => f.family === name)[0] || {};
    eq([face('Sofia Sans').weight, face('Sofia Sans').url, face('Sofia Sans').display], ['400 800', '../fonts/sofia-sans.woff2', 'swap'], "'Sofia Sans' 400–800 from a file URL, font-display: swap");
    eq([face('Sofia Sans Condensed').weight, face('Sofia Sans Condensed').url, face('Sofia Sans Condensed').display], ['600 900', '../fonts/sofia-sans-condensed.woff2', 'swap'],
      "'Sofia Sans Condensed' 600–900 from a file URL, font-display: swap");
    faces.forEach((f) => {
      let magic = '';
      try { magic = t.fs.readFileSync(t.path.join(t.REPO_ROOT, 'css', f.url)).toString('latin1', 0, 4); } catch (e) {}
      eq(magic, 'wOF2', f.family + ': ' + f.url + ' exists and is a woff2 file');
    });
    ok(!/url\(\s*['"]?data:/.test(themeCss), 'no data-URI font (iOS WebKit silently rejects large ones)');
    // build.js de-paths ../fonts/ in theme.css ONLY, and copies fonts/*.woff2.
    ['styles', 'features', 'tabs', 'settings', 'explore', 'redesign', 'discover-layout-fix', 'crisp'].forEach((name) => {
      ok(!/@font-face/.test(noComments(t.readSource('css/' + name + '.css'))), 'css/' + name + '.css declares no @font-face (only theme.css is de-pathed for the flat iOS www/)');
    });
    const shipped = t.fs.readdirSync(t.path.join(t.REPO_ROOT, 'fonts')).filter((f) => /\.woff2$/.test(f)).sort();
    eq(shipped.filter((f) => themeCss.indexOf("../fonts/" + f) === -1), [], 'every fonts/*.woff2 that ships is used by a face (' + shipped.join(', ') + ')');
    ok(/^'Sofia Sans Condensed', /.test(root['--font-display']) && /^'Sofia Sans', /.test(root['--font-body']),
      '--font-display → Sofia Sans Condensed, --font-body → Sofia Sans (' + root['--font-display'] + ' · ' + root['--font-body'] + ')');
    ok(!/Hanken|AppDisplay|Bricolage/.test(root['--font-display'] + root['--font-body']), 'the retired faces are out of both stacks');
    ['terminal', 'gameboy'].forEach((id) => ok(/^ui-monospace/.test(tokensOf(themeCss, '[data-theme="' + id + '"]')['--font-body'] || ''), id + ' keeps its mono body'));
    // Components never name a face: the two tokens are the only way in.
    ['styles', 'features', 'tabs', 'settings', 'explore', 'redesign', 'crisp'].forEach((name) => {
      ok(!/Sofia Sans/.test(noComments(t.readSource('css/' + name + '.css'))), 'css/' + name + '.css reaches the faces through --font-display / --font-body only');
    });
    ok(/font-family:'Sofia Sans'[^}]*src:url\('fonts\/sofia-sans\.woff2'\) format\('woff2'\), url\('sofia-sans\.woff2'\) format\('woff2'\)/.test(login),
      'login.html loads the body face with a second, flat source (it is copied as-is into the iOS www/, which has no fonts/ folder)');
    const rule = noComments(themeCss).match(/\.stat-value, \.cost-value, \.explore-map-stat-value, \.class-time \{\s*font-variant-numeric:\s*tabular-nums;/);
    ok(!!rule, 'times and counts in the display face use tabular figures');
  }

  // ── Tokens ───────────────────────────────────────────────────────────────
  t.section('Tokens: the StyleGuide scale, the glow recipe, the chrome of Cloud and Graphite');
  {
    eq([root['--type-time'], root['--type-time-sheet'], root['--type-numeral'], root['--type-heading'], root['--type-title'], root['--type-body'], root['--type-caption']],
      ['34px', '60px', '88px', '21px', '17px', '15px', '13px'], 'type roles: card time 34, sheet time 60, stat numeral 88, heading 21, title 17, body 15, caption 13');
    ok(Object.keys(root).filter((k) => /^--type-/.test(k)).every((k) => /^[\d.]+px$/.test(root[k])), 'every --type-* token is a size (the --text-* prefix is shared with ink colours, so sizes do not use it)');
    eq([root['--radius-5xl'], root['--radius-6xl'], root['--radius-7xl'], root['--radius-8xl'], root['--radius-full']], ['18px', '22px', '24px', '28px', '9999px'], 'radius scale continues 18 / 22 / 24 / 28 / full');
    eq([root['--radius-card'], root['--radius-sheet'], root['--radius-tile'], root['--radius-chip']], ['var(--radius-6xl)', 'var(--radius-8xl)', 'var(--radius-xl)', 'var(--radius-4xl)'],
      'shape roles alias the scale: card 22, sheet 28, tile 10, chip 16');
    eq(root['--weight-black'], '900', '--weight-black (900) for times and numerals');
    eq([root['--glow-ring'], root['--glow-drop'], root['--glow-edge'], root['--glow-drop-card']], ['0 0 0 4px', '0 8px 20px -2px', '0 0 0 2px', '0 12px 30px -8px'],
      'the glow recipe is GEOMETRY that takes a colour where it is used (a var() inside a token resolves where it is declared)');
    ok(!/var\(/.test(root['--glow-ring'] + root['--glow-drop'] + root['--glow-edge'] + root['--glow-drop-card']), '…so none of the four embeds a colour token');
    registry.forEach((th) => {
      const tk = themeTokens(th.id);
      ok(!!tk['--glow-sel-ring'] && !!tk['--glow-sel-drop'] && !!tk['--shadow-soft'] && !!tk['--shadow-float'], th.id + ': has the selected-glow colours and the soft / float shadow');
      eq(tk['--bg'], th.bg, th.id + ': APP_THEMES bg is the theme\'s --bg (first-paint map, theme-color and the stylesheet agree)');
    });
    const cloud = themeTokens('cloud');
    eq([cloud['--bg'], cloud['--bg-panel'], cloud['--bg-deep'], cloud['--border'], cloud['--text'], cloud['--text-muted'], cloud['--text-ghost']],
      ['#e6e9ee', '#fcfdfe', '#d9dee6', '#d3d9e1', '#1b2130', '#3a4252', '#566073'], 'Cloud is the boards\' chrome: ground, surface, sunken, hairline, ink 900 / 700 / 500');
    eq([cloud['--accent'], cloud['--accent-ink']], ['#1b2130', '#ffffff'], 'Cloud has no hue of its own: the accent is the ink, labelled white');
    eq([cloud['--sunken'], cloud['--ground']], [cloud['--bg-deep'], cloud['--bg']], '--sunken / --ground name the boards\' roles');
    const graphite = themeTokens('graphite');
    ok(lum(graphite['--bg']) > 0.004 && lum(graphite['--bg']) < lum(graphite['--bg-panel']) && graphite['--bg'] !== '#000000', 'Graphite: a deep ground that is not pure black, under a lighter surface');
    eq(graphite['--bg-panel'], cloud['--text'], 'Graphite\'s surface is Cloud\'s ink 900 — one system, turned over');
    // Both wear an inverse toast: its own ink and glyph inks have to hold on it.
    ['cloud', 'graphite'].forEach((id) => {
      const tk = themeTokens(id);
      ['--toast-ink', '--toast-ok', '--toast-err'].forEach((k) => {
        const r = contrast(tk[k], tk['--toast-bg']);
        ok(HEX.test(tk[k]) && r >= 4.5, id + ': ' + k + ' ' + tk[k] + ' on the inverse --toast-bg ' + tk['--toast-bg'] + ' is ' + r.toFixed(2) + ':1 (≥4.5)');
      });
    });
    // The Booked! sheet used to borrow --toast-bg; on an inverse toast that would be dark on dark.
    const sheet = (/\n\.booking-confirmation \{([^}]*)\}/.exec(noComments(t.readSource('css/styles.css'))) || [])[1] || '';
    ok(/background:\s*var\(--bg-panel/.test(sheet), 'the Booked! sheet sits on --bg-panel, not on the (now inverse) toast ground');
  }

  // ── The engine ───────────────────────────────────────────────────────────
  const cc = t.loadPure('js/theme.js', 'class-colours');
  const core = t.loadPure('js/app.js', 'core');
  const KEYS = Array.from(cc.CLASS_COLOUR_KEYS);
  const PALETTE = cc.CLASS_COLOUR_PALETTE;
  const NAMES = Object.keys(PALETTE);
  const ROLES = ['tintSoft', 'tintBold', 'base', 'deep', 'ring', 'drop'];

  t.section('Class colours: the palette and the defaults');
  {
    eq(KEYS, t.vm.runInContext('CATEGORY_MAP.map(function (c) { return c.key.toLowerCase(); })', core), 'one key per CATEGORY_MAP category, lower-cased, in its order');
    ok(NAMES.length >= 10, 'at least ten named swatches (' + NAMES.join(', ') + ')');
    ['cobalt', 'ember', 'violet', 'jade', 'orchid', 'sun', 'teal', 'sky', 'rose', 'slate'].forEach((n) => ok(NAMES.indexOf(n) !== -1, 'swatch "' + n + '" is in the palette'));
    NAMES.forEach((n) => {
      const sw = PALETTE[n];
      ok(typeof sw.name === 'string' && /^[A-Z][a-z]+$/.test(sw.name), n + ': has a display name ("' + sw.name + '")');
      ['light', 'dark'].forEach((side) => {
        eq(Object.keys(sw[side]).sort(), ROLES.slice().sort(), n + ' · ' + side + ': tintSoft, tintBold, base, deep, ring, drop');
        ok(['tintSoft', 'tintBold', 'base', 'deep'].every((r) => HEX.test(sw[side][r])), n + ' · ' + side + ': the four colours are plain 6-digit hex (a canvas can paint them)');
        const b = rgb(sw[side].base).join(', ');
        ok(new RegExp('^rgba\\(' + b + ', 0\\.\\d+\\)$').test(sw[side].ring) && sw[side].drop === 'rgba(' + b + ', 0.5)', n + ' · ' + side + ': ring / drop are the base at low alpha (' + sw[side].ring + ')');
      });
    });
    eq(JSON.parse(JSON.stringify(cc.CLASS_COLOUR_DEFAULTS)), { ride: 'cobalt', strength: 'ember', yoga: 'jade', hiit: 'sun', pilates: 'violet', lagree: 'teal', barre: 'orchid', other: 'slate' },
      'DEFAULTS: ride cobalt · strength ember · yoga jade · hiit sun · pilates violet · lagree teal · barre orchid · other slate');
    eq(new Set(KEYS.map((k) => cc.CLASS_COLOUR_DEFAULTS[k])).size, KEYS.length, '…eight different swatches, so no two class types look alike out of the box');
    eq([cc.CLASS_COLOUR_DEFAULT_INTENSITY, Array.from(cc.CLASS_COLOUR_INTENSITIES), cc.CLASS_COLOUR_KEY], ['soft', ['off', 'soft', 'bold'], 'psycle_class_colours'], 'three intensities, "soft" by default, stored as psycle_class_colours');
    // The boards, value for value.
    const BOARD = { cobalt: ['#D6E2FF', '#2D5FD6', '#1A3785'], ember: ['#FFD8D0', '#CC3A1F', '#7A1E0C'], violet: ['#E6DCFF', '#7045D0', '#42238C'], jade: ['#C4EBDF', '#0A7A64', '#064A3C'], orchid: ['#FAD6F2', '#B82A8E', '#6E1454'] };
    Object.keys(BOARD).forEach((n) => eq([PALETTE[n].light.tintBold, PALETTE[n].light.base, PALETTE[n].light.deep], BOARD[n], n + ': "bold" is the approved board (tint / base / deep)'));
    const src = themeJs.slice(themeJs.indexOf('// ── pure:class-colours:start'), themeJs.indexOf('// ── pure:class-colours:end'));
    ok(!/color-mix|oklch|oklab|hsl\(|Math\.|parseInt|toString\(16\)/.test(src), 'no colour maths at runtime: every value is precomputed (no color-mix(), no oklch() — iOS 15)');
    ok(!/color-mix\(|oklch\(|oklab\(/.test(noComments(crispCss)), 'css/crisp.css uses no color-mix() / oklch() either');
  }

  t.section('Class colours: every swatch × role × base against the ink it carries');
  {
    const light = registry.filter((th) => th.base === 'light'), dark = registry.filter((th) => th.base === 'dark');
    ok(light.length >= 1 && dark.length >= 4, 'registry read (' + registry.map((x) => x.id + ':' + x.base).join(', ') + ')');
    const ON_BASE = cc.CLASS_COLOUR_ON_BASE;
    let pairs = 0;
    const worst = { v: 99, what: '' };
    const need = (ratio, min, what) => {
      pairs++;
      if (ratio < worst.v) { worst.v = ratio; worst.what = what; }
      if (!(ratio >= min)) ok(false, what + ' is ' + ratio.toFixed(2) + ':1 (needs ≥' + min + ')');
    };
    NAMES.forEach((n) => {
      [['light', light], ['dark', dark]].forEach((row) => {
        const side = row[0], sw = PALETTE[n][side];
        need(contrast(ON_BASE, sw.base), 4.5, n + ' · ' + side + ': white on base ' + sw.base);
        ['tintSoft', 'tintBold'].forEach((tint) => {
          need(contrast(sw.deep, sw[tint]), 7, n + ' · ' + side + ': deep ' + sw.deep + ' on ' + tint + ' ' + sw[tint]);
          row[1].forEach((th) => {
            const tk = themeTokens(th.id);
            // --ct-ink / --ct-ink-2: the two inks css/crisp.css promises on a tinted card.
            need(contrast(tk['--text'], sw[tint]), 4.5, n + ' · ' + th.id + ': --text on ' + tint + ' ' + sw[tint]);
            need(contrast(tk['--text-muted'], sw[tint]), 4.5, n + ' · ' + th.id + ': --text-muted on ' + tint + ' ' + sw[tint]);
          });
        });
        // Intensity "off": the hue ink sits on the theme's neutral surface instead.
        row[1].forEach((th) => need(contrast(sw.deep, themeTokens(th.id)['--bg-panel']), 4.5, n + ' · ' + th.id + ': deep ' + sw.deep + ' on --bg-panel (intensity "off")'));
      });
      // Cloud's quietest copy ink (the boards' ink 500) still reads on a tint.
      ['tintSoft', 'tintBold'].forEach((tint) => need(contrast(themeTokens('cloud')['--text-ghost'], PALETTE[n].light[tint]), 4.5, n + ' · cloud: ink 500 on ' + tint));
      // A soft card is visibly paler than a bold one, and still a tint, not the surface.
      const s = PALETTE[n].light;
      if (!(lstar(s.tintSoft) > lstar(s.tintBold) + 3 && s.tintSoft.toLowerCase() !== themeTokens('cloud')['--bg-panel'])) ok(false, n + ': light tintSoft ' + s.tintSoft + ' should sit between tintBold ' + s.tintBold + ' and the surface');
      if (!(lstar(s.tintBold) >= 89 && lstar(s.tintBold) <= 90.5)) ok(false, n + ': light tintBold L* ' + lstar(s.tintBold).toFixed(1) + ' leaves the 89–90.5 band (the tints read as ONE family in a mixed list)');
      const d = PALETTE[n].dark;
      if (!(lum(d.tintSoft) < lum(d.tintBold) && lum(d.tintBold) < 0.05)) ok(false, n + ': dark tints must stay deep (soft under bold, both under 5% luminance)');
    });
    // Intensity "off", a [data-ct] ROW on a surface panel (the usual-week rows, an instructor's class rows):
    // the row steps down to a ground of its own, which is OUTSIDE the --ct-card contract above — and it
    // carries --ct-ink (--text), --ct-ink-2 (--text-muted) and --ct-deep copy. Read the ground each rule
    // really uses. (--surface-2 looked right and was 3.77:1 for --text-muted on Handheld.)
    const flatCrisp = noComments(crispCss);
    [['#usualWeekCard .usual-week-entry', 'the usual-week rows'], ['.instructor-class-item', 'an instructor\'s class rows']].forEach((row) => {
      const m = new RegExp('html\\[data-ct-intensity="off"\\] ' + row[0].replace(/[.#]/g, '\\$&') + ' \\{ background: var\\((--[a-z0-9-]+)\\); \\}').exec(flatCrisp);
      ok(!!m, '"off": ' + row[1] + ' step down to a ground of their own (on a surface panel a surface row has no shape)');
      if (!m) return;
      registry.forEach((th) => {
        const tk = themeTokens(th.id), ground = tk[m[1]];
        ok(HEX.test(ground || ''), th.id + ': ' + m[1] + ' resolves to a colour (' + ground + ')');
        need(contrast(tk['--text'], ground), 4.5, th.id + ' · off · ' + row[1] + ': --text on ' + m[1]);
        need(contrast(tk['--text-muted'], ground), 4.5, th.id + ' · off · ' + row[1] + ': --text-muted on ' + m[1]);
        // --ct-deep there: the swatch's deep ink, or on a mono theme the theme's own (--text-heading).
        need(contrast(tk['--text-heading'], ground), 4.5, th.id + ' · off · ' + row[1] + ': --text-heading (mono deep) on ' + m[1]);
        NAMES.forEach((n) => need(contrast(PALETTE[n][th.base].deep, ground), 4.5, n + ' · ' + th.id + ' · off · ' + row[1] + ': deep on ' + m[1]));
      });
    });
    ok(pairs > 400, pairs + ' ink / ground pairs checked — every swatch, role, base and theme; the tightest is ' + worst.what + ' at ' + worst.v.toFixed(2) + ':1');

    // Terminal and Handheld, as they ship (mono): their OWN ladder.
    const monoBlock = (/\nhtml:is\(\[data-theme="terminal"\], \[data-theme="gameboy"\]\) \{([^}]*)\}/.exec(themeCss) || [])[1] || '';
    registry.filter((th) => th.mono).forEach((th) => {
      const tk = themeTokens(th.id);
      const own = (/\nhtml\[data-theme="([a-z]+)"\] \{([^}]*)\}/g, (function () {
        const m = new RegExp('\\nhtml\\[data-theme="' + th.id + '"\\] \\{([^}]*)\\}').exec(themeCss);
        const out = {};
        ((m || [])[1] || '').replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (x, k, v) => { out[k] = v.trim(); return x; });
        return out;
      })());
      const lit = (v) => { const m = /^var\((--[a-z0-9-]+)\)$/.exec(v || ''); return m ? (own[m[1]] ? lit(own[m[1]]) : tk[m[1]]) : v; };
      const tint = lit('var(--ct-mono-tint)'), wash = lit('var(--ct-mono-wash)');
      ok(HEX.test(tint) && HEX.test(wash), th.id + ': the mono tint / wash resolve to the theme\'s own tokens (' + tint + ', ' + wash + ')');
      ok(contrast(tk['--text'], tint) >= 4.5 && contrast(tk['--text-muted'], tint) >= 4.5, th.id + ' (mono): --text and --text-muted hold 4.5:1 on its card ground');
      ok(contrast(tk['--text-heading'], tint) >= 4.5 && contrast(tk['--text-heading'], wash) >= 4.5, th.id + ' (mono): the deep ink (--text-heading) holds on the card and on the calm tile');
      // Same exception 1f-contrast-tokens.js makes: Terminal keeps its white-on-neon accent (large-text AA).
      const min = th.id === 'terminal' ? 3 : 4.5;
      ok(contrast(tk['--accent-ink'], tk['--accent']) >= min, th.id + ' (mono): --accent-ink on --accent (the base fill) ≥ ' + min);
    });
    cc._ccPropNames().forEach((name) => ok(new RegExp('(^|[;\\s])' + name + ':').test(monoBlock), 'the mono block sets ' + name));
    ok(/--ct-on-base:\s*var\(--accent-ink\)/.test(monoBlock) && /--ct-ride-base:\s*var\(--accent\)/.test(monoBlock) && /--ct-ride-deep:\s*var\(--text-heading\)/.test(monoBlock),
      'mono = the theme\'s accent ladder: base → --accent, label → --accent-ink, deep → --text-heading');
  }

  t.section('Class colours: stored data is untrusted');
  {
    const j = (v) => JSON.parse(JSON.stringify(v));
    const DEF = { v: 1, intensity: 'soft', map: j(cc.CLASS_COLOUR_DEFAULTS) };
    [null, undefined, 0, 'soft', [], [1], {}, { v: 2, intensity: 'bold' }, { v: '1', intensity: 'bold' }, { v: 1 }, { v: 1, intensity: 'loud' }, { v: 1, map: 'cobalt' }, { v: 1, map: ['cobalt'] }].forEach((junk) => {
      eq(j(cc._ccClean(junk)), DEF, JSON.stringify(junk) + ' → the defaults');
    });
    eq(j(cc._ccClean({ v: 1, intensity: 'bold', map: { ride: 'sky', yoga: 'hotpink', pilates: 7, spin: 'ember' } })),
      { v: 1, intensity: 'bold', map: Object.assign({}, DEF.map, { ride: 'sky' }) }, 'a known swatch on a known key is kept; an unknown swatch, a non-string and an unknown key are dropped');
    const proto = JSON.parse('{"v":1,"map":{"ride":"constructor","strength":"__proto__","yoga":"toString","__proto__":{"hiit":"rose"}}}');
    eq(j(cc._ccClean(proto)), DEF, '"constructor" / "__proto__" / "toString" are not swatches, and a "__proto__" member is not read as choices');
    eq(cc._ccStorable(proto), null, '…and such a file has nothing worth storing');
    const inherited = Object.assign(Object.create({ intensity: 'bold', map: { ride: 'sky' } }), { v: 1 });
    eq([cc._ccChoices(inherited), cc._ccChoices(Object.create({ v: 1, intensity: 'bold' }))], [null, null], 'own members only — nothing is read off a prototype');
    eq(j(cc._ccStorable({ v: 1, intensity: 'off', map: { ride: 'sky', junk: 'x' }, extra: '<img onerror=1>' })), { v: 1, intensity: 'off', map: { ride: 'sky' } }, 'what is stored is REBUILT from known keys — nothing else of the file survives');
    eq(j(cc._ccStorable({ v: 1, map: { barre: 'rose' } })), { v: 1, intensity: 'soft', map: { barre: 'rose' } }, 'choices without an intensity store "soft"');
    // set(partial) merges
    eq(j(cc._ccMerge(null, { intensity: 'bold' })), { v: 1, intensity: 'bold', map: {} }, 'merge: an intensity alone keeps the map empty (the types follow DEFAULTS, even if they change later)');
    eq(j(cc._ccMerge({ v: 1, intensity: 'bold', map: { ride: 'sky' } }, { map: { yoga: 'moss' } })), { v: 1, intensity: 'bold', map: { ride: 'sky', yoga: 'moss' } }, 'merge: earlier choices are kept');
    eq(j(cc._ccMerge({ v: 1, intensity: 'bold', map: { ride: 'sky' } }, { intensity: 'neon', map: { ride: 'nope', yoga: 'moss' } })), { v: 1, intensity: 'bold', map: { ride: 'sky', yoga: 'moss' } },
      'merge: an invalid intensity or swatch changes nothing');
    eq(j(cc._ccMerge('garbage', undefined)), { v: 1, intensity: 'soft', map: {} }, 'merge: garbage in storage and no partial → an empty, valid object');
    eq([cc._ccKey('RIDE'), cc._ccKey('ride'), cc._ccKey('Pilates'), cc._ccKey('spin'), cc._ccKey(null), cc._ccKey('constructor')], ['ride', 'ride', 'pilates', 'other', 'other', 'other'], '_ccKey: either case; anything unknown is "other"');
  }

  t.section('Class colours: the plan apply() writes');
  {
    const j = (v) => JSON.parse(JSON.stringify(v));
    const names = Array.from(cc._ccPropNames());
    eq(names.length, KEYS.length * 6 + 1, 'six roles per class type + --ct-on-base (' + names.length + ' properties)');
    const def = cc._ccClean(null);
    const soft = cc._ccPlan(def, 'light', false), bold = cc._ccPlan(cc._ccClean({ v: 1, intensity: 'bold' }), 'light', false), off = cc._ccPlan(cc._ccClean({ v: 1, intensity: 'off' }), 'light', false);
    eq(Object.keys(j(soft.props)).sort(), names.slice().sort(), 'a plan sets every managed property — nothing is left over from the plan before');
    eq([soft.props['--ct-ride-tint'], bold.props['--ct-ride-tint'], off.props['--ct-ride-tint']], [PALETTE.cobalt.light.tintSoft, PALETTE.cobalt.light.tintBold, PALETTE.cobalt.light.tintSoft],
      'tint: pale at "soft", the boards\' at "bold"; "off" keeps the pale one for chips and seats (the CARD goes neutral in css/crisp.css)');
    eq([soft.props['--ct-ride-wash'], bold.props['--ct-ride-wash']], [PALETTE.cobalt.light.tintBold, PALETTE.cobalt.light.tintBold], 'wash is always the full tint (the calm tile of "soft")');
    eq([soft.intensity, bold.intensity, off.intensity, soft.base, soft.mono], ['soft', 'bold', 'off', 'light', false], 'the plan names the intensity for html[data-ct-intensity]');
    const dark = cc._ccPlan(def, 'dark', false);
    eq([dark.props['--ct-strength-base'], dark.props['--ct-strength-deep'], dark.props['--ct-on-base']], [PALETTE.ember.dark.base, PALETTE.ember.dark.deep, '#FFFFFF'], 'a dark base takes the dark side of the same swatch');
    eq(cc._ccPlan(def, 'sepia', false).base, 'light', 'an unknown base reads as light');
    const custom = cc._ccPlan(cc._ccClean({ v: 1, intensity: 'bold', map: { hiit: 'rose' } }), 'light', false);
    eq([custom.props['--ct-hiit-base'], custom.props['--ct-ride-base']], [PALETTE.rose.light.base, PALETTE.cobalt.light.base], 'a chosen swatch moves that class type only');
    const forged = cc._ccPlan({ intensity: 'loud', map: { ride: 'constructor' } }, 'light', false);
    eq([forged.intensity, forged.props['--ct-ride-base']], ['soft', PALETTE.cobalt.light.base], 'a state that skipped the cleaner still cannot name a non-swatch');
    // Mono themes
    const mono = cc._ccPlan(def, 'dark', true), monoOff = cc._ccPlan(cc._ccClean({ v: 1, intensity: 'off' }), 'dark', true), monoBold = cc._ccPlan(cc._ccClean({ v: 1, intensity: 'bold' }), 'dark', true);
    eq([mono.mono, Object.keys(j(mono.props)), monoOff.mono, Object.keys(j(monoOff.props))], [true, [], true, []], 'Terminal / Handheld at "soft" or "off": nothing is written — the stylesheet\'s accent ladder stands');
    eq([monoBold.mono, monoBold.props['--ct-ride-base']], [false, PALETTE.cobalt.dark.base], '…unless the member explicitly chose "bold"');
    eq(registry.filter((th) => th.mono).map((th) => th.id), ['terminal', 'gameboy'], 'APP_THEMES marks exactly Terminal and Handheld as mono');

    // The stylesheet's defaults ARE the default plan (what paints before theme.js has run).
    const block = (re) => {
      const body = (re.exec(themeCss) || [])[1] || '';
      const out = {};
      body.replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
      return out;
    };
    eq(block(/\nhtml \{\n(\s*--ct-ride-tint[^}]*)\}/), j(soft.props), 'css/theme.css `html { --ct-* }` = the default plan on a light base, value for value');
    eq(block(/\nhtml:is\(\[data-theme="graphite"\], \[data-theme="blueprint"\]\) \{([^}]*)\}/), j(dark.props), '…and the dark block = the default plan on a dark base');
    eq(registry.filter((th) => th.base === 'dark' && !th.mono).map((th) => th.id), ['graphite', 'blueprint'], 'that block lists every dark theme that is not mono');
    ok(themeCss.indexOf('\nhtml {\n  --ct-ride-tint') > themeCss.lastIndexOf('\n[data-theme="blueprint"] {'), 'the --ct-* defaults come AFTER every theme token block (suites find a theme block as the first "[data-theme=…] {")');
  }

  t.section('Class colours: window.PsycleClassColours against a fake page');
  {
    const from = themeJs.indexOf('// ── A. Themes'), to = themeJs.indexOf('// ── B. Skeleton Loading Cards');
    ok(from !== -1 && to > from, 'theme.js sections A–A2 found');
    const boot = (opts) => {
      opts = opts || {};
      const store = Object.assign({}, opts.store || {});
      const log = { events: [], writes: 0, removes: 0 };
      const style = { props: {}, setProperty(k, v) { this.props[k] = v; log.writes++; }, removeProperty(k) { delete this.props[k]; log.removes++; } };
      const attrs = { 'data-theme': opts.theme || 'cloud' };
      const documentElement = { style, getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); } };
      const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { if (opts.full) throw new Error('QuotaExceededError'); store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      };
      const window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
      const ctx = t.vm.createContext({
        window, localStorage, console, JSON, Object, String, Array,
        document: { documentElement, querySelector: () => null, getElementById: () => null },
        PsycleEvents: { emit: (name, detail) => log.events.push([name, JSON.parse(JSON.stringify(detail))]) },
        getComputedStyle: () => ({ getPropertyValue: (n) => (n in style.props ? ' ' + style.props[n] : '') }),
        haptic() {}, URLSearchParams, location: { search: '' },
      });
      t.vm.runInContext(themeJs.slice(from, to), ctx, { filename: 'js/theme.js[A–A2]' });
      return { api: window.PsycleClassColours, window, ctx, store, style, attrs, log };
    };
    let w = boot();
    const api = w.api;
    eq(Object.keys(api).sort(), ['DEFAULTS', 'DEFAULT_INTENSITY', 'INTENSITIES', 'KEY', 'KEYS', 'PALETTE', 'apply', 'clean', 'get', 'reset', 'resolve', 'set'].sort(), 'window.PsycleClassColours = { PALETTE, DEFAULTS, get, set, reset, apply } (+ KEY, KEYS, INTENSITIES, DEFAULT_INTENSITY, clean, resolve)');
    t.vm.runInContext('_applyTheme("cloud")', w.ctx);
    eq([w.attrs['data-ct-intensity'], w.style.props['--ct-ride-tint'], w.style.props['--ct-on-base'], Object.keys(w.style.props).length], ['soft', PALETTE.cobalt.light.tintSoft, '#FFFFFF', 49],
      'applying a theme applies the class colours: html[data-ct-intensity] + 49 custom properties');
    eq(w.log.events.map((e) => e[0]), ['classcolours:changed'], 'classcolours:changed is emitted');
    const before = w.log.writes;
    api.apply(); api.apply();
    eq([w.log.writes, w.log.events.length], [before, 1], 'apply() again with nothing changed: no writes, no second event');
    // set
    const state = api.set({ intensity: 'bold', map: { ride: 'sky', yoga: 'nope' } });
    eq([state.intensity, state.map.ride, state.map.yoga], ['bold', 'sky', 'jade'], 'set() returns the state in effect (the invalid swatch ignored)');
    eq(JSON.parse(w.store.psycle_class_colours), { v: 1, intensity: 'bold', map: { ride: 'sky' } }, '…stores ONLY the member\'s own choices');
    eq([w.attrs['data-ct-intensity'], w.style.props['--ct-ride-tint'], w.style.props['--ct-yoga-tint']], ['bold', PALETTE.sky.light.tintBold, PALETTE.jade.light.tintBold], '…and repaints at once');
    eq([w.log.events.length, w.log.events[1][1].intensity, w.log.events[1][1].map.ride, w.log.events[1][1].base], [2, 'bold', 'sky', 'light'], '…announcing { intensity, map, base, mono }');
    eq(JSON.parse(JSON.stringify(api.get())).map.ride, 'sky', 'get() reads it back');
    eq(JSON.parse(JSON.stringify(api.resolve('RIDE'))), { key: 'ride', swatch: 'sky', tint: PALETTE.sky.light.tintBold, base: PALETTE.sky.light.base, deep: PALETTE.sky.light.deep, onBase: '#FFFFFF' },
      'resolve("RIDE") → the literal colours on the page (trimmed), for a canvas');
    // theme base switch
    t.vm.runInContext('_applyTheme("graphite")', w.ctx);
    eq([w.style.props['--ct-ride-base'], w.log.events.length, w.log.events[2][1].base], [PALETTE.sky.dark.base, 3, 'dark'], 'Cloud → Graphite: the same swatches, their dark side');
    eq(api.resolve('ride').base, PALETTE.sky.dark.base, '…and resolve() does not answer from the theme before');
    // mono
    api.set({ intensity: 'soft' });
    t.vm.runInContext('_applyTheme("gameboy")', w.ctx);
    eq([Object.keys(w.style.props).length, w.attrs['data-ct-intensity'], w.log.events[w.log.events.length - 1][1].mono], [0, 'soft', true], 'Handheld at "soft": every inline property is REMOVED so the stylesheet\'s accent ladder shows');
    api.set({ intensity: 'bold' });
    eq([Object.keys(w.style.props).length, w.style.props['--ct-ride-base']], [49, PALETTE.sky.dark.base], 'Handheld, "bold" chosen: the palette comes back');
    // reset
    t.vm.runInContext('_applyTheme("cloud")', w.ctx);
    const kept = api.reset({ keepIntensity: true });
    eq([kept.intensity, kept.map.ride, JSON.parse(w.store.psycle_class_colours)], ['bold', 'cobalt', { v: 1, intensity: 'bold', map: {} }], 'reset({ keepIntensity }) forgets the per-type choices only');
    const fresh = api.reset();
    eq([fresh.intensity, fresh.map.ride, 'psycle_class_colours' in w.store, w.style.props['--ct-ride-tint']], ['soft', 'cobalt', false, PALETTE.cobalt.light.tintSoft], 'reset() → DEFAULTS at "soft", the key removed, the page repainted');
    // a full localStorage
    w = boot({ full: true });
    let threw = false, shown = null;
    try { shown = w.api.set({ intensity: 'off', map: { barre: 'rose' } }); } catch (e) { threw = true; }
    eq([threw, shown && shown.intensity, w.attrs['data-ct-intensity'], w.style.props['--ct-barre-base'], 'psycle_class_colours' in w.store], [false, 'off', 'off', PALETTE.rose.light.base, false],
      'storage full: set() does not throw and the choice is still shown for this page');
    // garbage in storage
    w = boot({ store: { psycle_class_colours: '{"v":1,"intensity":"bold","map":{"ride":"<script>"}' } });
    t.vm.runInContext('_applyTheme("cloud")', w.ctx);
    eq([w.attrs['data-ct-intensity'], w.style.props['--ct-ride-base']], ['soft', PALETTE.cobalt.light.base], 'unparseable JSON in the key → the defaults, no throw');
    // wiring
    ok(/function _applyTheme\(id\) \{[\s\S]*?_applyClassColours\(\);\n\}/.test(themeJs), '_applyTheme ends by applying the class colours (light ↔ dark, mono themes)');
    ok(/_psycleNativeRestoreReady\.then\(function \(\) \{ _applyClassColours\(\); \}\);/.test(themeJs), 'iOS: re-applied once the Preferences → localStorage restore has settled');
    eq((themeJs.match(/\{\s*id:\s*'/g) || []).length, 5, 'theme.js still has exactly five "{ id: \'…\' }" literals — one per theme (a dozen suites read the registry with that pattern)');
  }

  // ── Mapping block + primitives ───────────────────────────────────────────
  t.section('css/crisp.css: linked last, five sections, ONE mapping block, tokens only');
  {
    const links = [];
    finder.replace(/<link rel="stylesheet" href="css\/([\w-]+\.css)">/g, (m, f) => { links.push(f); return m; });
    eq(links[links.length - 1], 'crisp.css', 'psycle-finder.html links css/crisp.css LAST');
    ok(!/crisp\.css/.test(login), 'login.html does not link it (copied as-is into the flat iOS www/; 4f-cleanup-pwa.js holds the page to "no stylesheet link")');
    const marks = ['9a-foundation', '9b-discover', '9c-sheets', '9d-bookings', '9e-stats-membership'].map((n) => '/* == crisp:' + n + ' == */');
    const at = marks.map((m) => crispCss.indexOf(m));
    ok(at.every((i) => i !== -1) && at.every((i, n) => n === 0 || i > at[n - 1]), 'the five agent sections are marked, in order');
    marks.forEach((m) => eq(crispCss.split(m).length - 1, 1, m + ' appears once'));
    const foundation = noComments(crispCss.slice(at[0], at[1]));
    KEYS.forEach((k) => {
      const body = (new RegExp('\\[data-ct="' + k + '"\\] \\{([^}]*)\\}').exec(foundation) || [])[1] || '';
      const want = ['tint', 'wash', 'base', 'deep', 'ring', 'drop'].map((r) => '--ct-' + r + ': var(--ct-' + k + '-' + r + ');');
      ok(want.every((d) => body.indexOf(d) !== -1), '[data-ct="' + k + '"] maps all six roles');
    });
    ok(foundation.indexOf('[data-ct] {') < foundation.indexOf('[data-ct="ride"] {') && /\[data-ct\] \{\s*--ct-tint: var\(--ct-other-tint\)/.test(foundation), 'an unknown data-ct wears "other" (declared first, same specificity)');
    eq((noComments(crispCss).match(/--ct-(ride|strength|yoga|hiit|pilates|lagree|barre)-/g) || []).length, 7 * 6, 'no rule outside the mapping block reads a --ct-<key>-* token');
    ok(/html\[data-ct-intensity="off"\] \[data-ct\] \{ --ct-card: var\(--surface\); \}/.test(foundation), '"off": the card goes to the neutral surface');
    ok(/\[data-ct\] \{\s*--ct-card: var\(--ct-tint\);\s*--ct-tile: var\(--ct-wash\);\s*--ct-tile-ink: var\(--ct-deep\);/.test(foundation), '"soft" (and no attribute): the pale card, and the calm tile — full tint + deep pictogram');
    ok(/html\[data-ct-intensity="bold"\] \[data-ct\],\s*html\[data-ct-intensity="off"\] \[data-ct\] \{\s*--ct-tile: var\(--ct-base\);\s*--ct-tile-ink: var\(--ct-on-base\);/.test(foundation), '"bold" / "off": the tile is the base fill with the white mark');
    ['.ct-tile', '.ct-card', '.ct-dot', '.glow-mine', '.glow-mine-card', '.glow-selected', '.pill-btn', '.pill-primary', '.pill-secondary', '.pill-outline', '.pill-quiet', '.pill-danger', '.chip', '.seg', '.seg-btn', '.ct-badge', '.badge-late', '.t-time', '.toast'].forEach((sel) => {
      ok(new RegExp('(^|[\\s,}])' + sel.replace('.', '\\.') + '(?![\\w-])[^{}]*\\{').test(foundation), 'primitive ' + sel + ' is defined');
    });
    ok(/\.glow-mine \{ box-shadow: var\(--glow-ring\) var\(--ct-ring\), var\(--glow-drop\) var\(--ct-drop\); \}/.test(foundation), '.glow-mine = the glow geometry taking the class colours');
    ok(/\.glow-selected \{ box-shadow: var\(--glow-ring\) var\(--glow-sel-ring\), var\(--glow-drop\) var\(--glow-sel-drop\); \}/.test(foundation), '.glow-selected = the same geometry in the theme\'s neutral pick colour');
    // Tokens only.
    const all = noComments(crispCss);
    eq(all.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) || [], [], 'no colour literal anywhere in css/crisp.css');
    // (A media query cannot read a custom property: its breakpoint is the one px that may appear.)
    eq(all.replace(/@media[^{]*\{/g, '@media {').match(/(?<![\w-])\d*\.?\d+px\b/g) || [], [], 'no px literal either (sizes are tokens)');
    const defined = new Set();
    themeCss.replace(/(--[a-z0-9-]+)\s*:/g, (m, k) => { defined.add(k); return m; });
    all.replace(/(--[a-z0-9-]+)\s*:/g, (m, k) => { defined.add(k); return m; });
    const used = [];
    all.replace(/var\((--[a-z0-9-]+)/g, (m, k) => { if (used.indexOf(k) === -1) used.push(k); return m; });
    eq(used.filter((k) => !defined.has(k)), [], 'every var() in css/crisp.css names a token that exists (' + used.length + ' distinct)');
    // Touch + focus + motion
    ok(/\.pill-btn \{[^}]*min-height: var\(--tap-min\)/.test(foundation) && /\.chip \{[^}]*min-height: var\(--tap-min\)/.test(foundation) && /\.seg-btn \{[^}]*min-height: var\(--tap-min\)/.test(foundation), 'pills, chips and segments are --tap-min tall');
    ok(/\.chip\.is-compact::after \{[^}]*inset: calc\(var\(--space-1\) \* -1\) 0;/.test(foundation), 'the shorter summary chip keeps a full-height hit area');
    ['.pill-btn', '.chip', '.seg-btn', '.ct-card'].forEach((sel) => ok(new RegExp(sel.replace('.', '\\.') + ':focus-visible \\{ outline: var\\(--focus-ring\\)').test(foundation), sel + ' shows the focus ring'));
    eq(root['--focus-ring'], '2px solid var(--text)', 'the ring is the body ink — the one colour held to 4.5:1 on every tint above');
    // …but NOT on an accent fill: Cloud's and Handheld's --accent IS --text (1.00:1), Graphite's nearly (1.14:1).
    // Wherever the ring is drawn INSIDE a control (a negative outline-offset) whose selected state is an accent
    // fill, that state must switch the ring to --accent-ink. Every rule of the sheet, @media kept as context.
    {
      const rules = [];
      (function walk(css, media) {
        let i = 0;
        while (i < css.length) {
          const open = css.indexOf('{', i);
          if (open === -1) break;
          const head = css.slice(i, open).trim();
          let depth = 1, j = open + 1;
          while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
          const body = css.slice(open + 1, j - 1);
          if (/^@media/.test(head)) walk(body, head);
          else if (!/^@/.test(head)) head.split(',').forEach((sel) => rules.push({ sel: sel.trim().replace(/\s+/g, ' '), body, media }));
          i = j;
        }
      })(all, '');
      const inset = rules.filter((r) => /:focus-visible$/.test(r.sel) && /outline-offset:\s*calc\(var\(--focus-offset\) \* -\d\)/.test(r.body)).map((r) => r.sel.replace(/:focus-visible$/, ''));
      ok(inset.indexOf('.seg-btn') !== -1 && inset.indexOf('.tab-btn') !== -1 && inset.indexOf('.date-track .date-quick-btn') !== -1, 'controls that draw the ring inside themselves were found (' + inset.length + ')');
      // A selected state of one of them: the same selector plus a state suffix, filled with the accent.
      const filled = rules.filter((r) => /background:\s*var\(--accent\)/.test(r.body) && inset.some((base) => r.sel.indexOf(base) === 0 && /^[.[][^\s>+~]*$/.test(r.sel.slice(base.length))));
      eq(Array.from(new Set(filled.map((r) => r.sel))).sort(), ['.date-quick-btn.date-pick.active', '.date-track .date-quick-btn.active', '.seg-btn[aria-checked="true"]', '.seg-btn[aria-pressed="true"]', '.seg-btn[aria-selected="true"]', '.tab-btn.active'],
        'the accent-filled states of those controls: the chosen segment, the chosen date range, the current tab');
      filled.forEach((r) => {
        const ring = rules.filter((x) => x.sel === r.sel + ':focus-visible' && /outline-color:\s*var\(--accent-ink\)/.test(x.body));
        ok(ring.length === 1, r.sel + ':focus-visible takes --accent-ink (the body-ink ring was invisible on its own fill; a radiogroup\'s only tab stop IS the filled segment)');
      });
      // The phone tab bar's active tab has NO fill of its own (background: none): it keeps the body ink.
      const tabRing = rules.filter((x) => x.sel === '.tab-btn.active:focus-visible')[0] || {};
      eq(tabRing.media, '@media (min-width: 641px)', '…for the tab bar only where the current tab IS a pill (at ≤640px it has no fill, and keeps the body ink)');
      ok(rules.some((x) => x.media === '@media (max-width: 640px)' && x.sel === '.tab-btn.active' && /background:\s*none/.test(x.body)), '(the phone rule that removes the fill is still there)');
      registry.forEach((th) => {
        const tk = themeTokens(th.id), r = contrast(tk['--accent-ink'], tk['--accent']);
        ok(r >= 3, th.id + ': an --accent-ink ring on the --accent fill is ' + r.toFixed(2) + ':1 (≥3, WCAG 1.4.11) — the --text ring there is ' + contrast(tk['--text'], tk['--accent']).toFixed(2) + ':1');
      });
    }
    // A pill that glows: .pill-btn's own box-shadow comes after .glow-mine at the same specificity.
    ok(foundation.indexOf('.pill-btn.glow-mine {') > foundation.indexOf('.pill-btn {') &&
      /\.pill-btn\.glow-mine \{ box-shadow: inset 0 0 0 var\(--hairline\) var\(--pill-line\), var\(--glow-ring\) var\(--ct-ring\), var\(--glow-drop\) var\(--ct-drop\); \}/.test(foundation),
      '.pill-btn.glow-mine (0,2,0) carries the pill\'s hairline AND the glow — on a pill, .glow-mine alone lost to .pill-btn\'s own box-shadow (the class sheet\'s Book never glowed)');
    ok(/\.pill-btn\.glow-mine:disabled, \.pill-btn\.glow-mine\[aria-disabled="true"\] \{ box-shadow: inset 0 0 0 var\(--hairline\) var\(--pill-line\); \}/.test(foundation), '…and never while it is disabled');
    ok(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.pill-btn, \.chip, \.seg-btn \{ transition: none; \}/.test(foundation), 'reduced motion is respected');
    // Toast: still told apart by glyph; the tile pair is the token pair 6e checks.
    ok(/\.toast\.error::before \{ background: var\(--toast-err\); \}/.test(foundation) && /\.toast\.success::before \{ background: var\(--toast-ok\); \}/.test(foundation) && /color: var\(--toast-bg\);/.test(foundation),
      'toast glyph: a round tile in --toast-err / --toast-ok with the glyph knocked out in --toast-bg (the same pair, inverted)');
    ok(!/--ct-/.test((/\n\.toast \{[\s\S]*?\n\}\n[\s\S]*?\.toast\.success::before \{[^}]*\}/.exec(foundation) || [''])[0]), 'a toast is never class-coloured');
  }

  t.section('Class colours arrive with the deferred theme.js: nothing class-coloured paints before them');
  {
    // themeBoot sets the theme only; _applyClassColours() runs from js/theme.js (defer) and sets
    // html[data-ct-intensity] in the same call that writes the member's colours.
    const boot = (/<script id="themeBoot">([\s\S]*?)<\/script>/.exec(finder) || [])[1] || '';
    ok(boot !== '' && !/psycle_class_colours|data-ct/.test(boot), 'the first-paint script knows nothing of class colours (no palette copy to keep in step)');
    ok(/if \(root\.getAttribute\('data-ct-intensity'\) !== plan\.intensity\) root\.setAttribute\('data-ct-intensity', plan\.intensity\);/.test(themeJs) && !/data-ct-intensity=/.test(finder.slice(0, finder.indexOf('<body'))),
      'html[data-ct-intensity] exists only once theme.js has applied them — it is not in the markup');
    // Every [data-ct] element in the STATIC markup must be unpainted until then.
    const body = finder.slice(finder.indexOf('<body')).replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    const statics = body.match(/<[a-z0-9]+\b[^>]*\bdata-ct="[^"]*"[^>]*>/g) || [];
    const unpainted = statics.filter((tag) => !/style="display:none"/.test(tag));
    eq(unpainted, [], 'nothing in the static markup is class-coloured and paintable before theme.js has run (the sub-pill rows are display:none until app.js fills them; the header mark is hue-less)');
    ok(/<div class="brand-mark" aria-hidden="true"><svg [^>]*>[\s\S]*?class="bm-top"[\s\S]*?class="bm-bot"[\s\S]*?<\/svg><\/div>/.test(body) && !/<div class="brand-mark"[^>]*>[\s\S]{0,1400}?data-ct=/.test(body.slice(body.indexOf('brand-mark') - 20, body.indexOf('<h1>'))), 'the header mark is the two engraved halves, decorative (aria-hidden), with no data-ct in it');
    ok(!/data-ct-intensity\]\) \.brand-mark/.test(noComments(crispCss)) && /\n\.bm-top \{ fill: var\(--text-heading\); \}\n\.bm-bot \{ fill: var\(--text-ghost\); \}/.test(noComments(crispCss)),
      'css/crisp.css paints it from the theme\'s two inks — right from the first paint, so the old "hold it unpainted until the class colours arrive" rule is gone');
    ok(!/so at first paint/.test(t.readSource('CLAUDE.md')), 'CLAUDE.md no longer claims apply() runs at first paint');
  }

  // ── Pictograms ───────────────────────────────────────────────────────────
  t.section('Pictograms: classPictogram(key, size) — one family, eight marks');
  {
    const p = t.loadPure('js/app.js', 'class-type', { getCategory: core.getCategory });
    const marks = KEYS.map((k) => p.classPictogram(k, 24));
    eq(new Set(marks).size, 8, 'eight class types, eight different marks');
    eq(Object.keys(p.CLASS_PICTOGRAMS), KEYS, 'one mark per class-colour key, no more');
    marks.forEach((svg, i) => {
      const k = KEYS[i];
      ok(/^<svg class="ct-pic" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">.+<\/svg>$/.test(svg),
        k + ': 24 grid, stroke = currentColor, round caps and joins, aria-hidden');
      ok(!/\bid=|<title|<style|style=|<script|href|url\(|on[a-z]+=|fill="(?!none)/i.test(svg), k + ': no id, title, style, link or fill — nothing that could collide or carry a colour');
      ok(/^(<(circle|rect|path) [^<>]*\/>)+$/.test(p.CLASS_PICTOGRAMS[k]), k + ': only self-closed circle / rect / path');
      const nums = (p.CLASS_PICTOGRAMS[k].match(/(?:cx|cy|x|y)="([\d.]+)"/g) || []).map((s) => parseFloat(s.split('"')[1]));
      ok(nums.every((n) => n >= 0 && n <= 24), k + ': placed inside the 24 grid');
    });
    eq([p.classPictogram('RIDE', 24), p.classPictogram('Ride', 24)], [marks[0], marks[0]], 'the key is a CATEGORY_MAP key in either case');
    ['spin', '', null, undefined, 'constructor', '__proto__', '<svg onload=1>'].forEach((bad) => eq(p.classPictogram(bad, 24), marks[KEYS.indexOf('other')], JSON.stringify(bad) + ' → the neutral mark'));
    const sizeOf = (svg) => [(/width="(\d+)"/.exec(svg) || [])[1], (/stroke-width="([\d.]+)"/.exec(svg) || [])[1]];
    eq([sizeOf(p.classPictogram('ride')), sizeOf(p.classPictogram('ride', 18)), sizeOf(p.classPictogram('ride', 13)), sizeOf(p.classPictogram('ride', 15)), sizeOf(p.classPictogram('ride', 20)), sizeOf(p.classPictogram('ride', 28))],
      [['18', '2.2'], ['18', '2.2'], ['13', '2.5'], ['15', '2.3'], ['20', '2.1'], ['28', '2']], 'default 18px; the stroke thickens as the mark shrinks, as on the boards');
    ['huge', -5, 0, 4, 500, NaN, '18" onload="x', {}, []].forEach((bad) => eq(sizeOf(p.classPictogram('ride', bad))[0], '18', 'size ' + JSON.stringify(bad) + ' → 18 (nothing caller-supplied reaches the markup)'));
    eq(sizeOf(p.classPictogram('ride', 17.6))[0], '18', 'a fractional size is rounded');
    eq(['RIDE: 45', 'REFORMER: Strength 50', 'LAGREE: Upper Body & Core', 'STRENGTH: Lower Body', 'YOGA: Flow', 'HIIT 45', 'BARRE: Sculpt', 'Sound Bath', '', null].map(p.classTypeKey),
      ['ride', 'pilates', 'lagree', 'strength', 'yoga', 'hiit', 'barre', 'other', 'other', 'other'], 'classTypeKey(typeName) → the data-ct value');
    ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(appJs.slice(appJs.indexOf('// ── pure:class-type:start'), appJs.indexOf('// ── pure:class-type:end'))), 'never an emoji');
  }

  t.section('CATEGORY_MAP: the literal class colours are gone');
  {
    const mapSrc = appJs.slice(appJs.indexOf('const CATEGORY_MAP = ['), appJs.indexOf('function getCategory('));
    eq(mapSrc.match(/#[0-9a-f]{3,8}\b/gi) || [], [], 'no hex colour in CATEGORY_MAP');
    eq(t.vm.runInContext('CATEGORY_MAP.map(function (c) { return c.color; })', core), KEYS.map((k) => 'var(--ct-' + k + '-base)'), 'with no page to ask, `color` is the class-type token (an inline style can use it)');
    const withEngine = t.loadPure('js/app.js', 'core', { window: { PsycleClassColours: { resolve: (k) => ({ base: k === 'YOGA' ? '' : '#0A7A64' }) } } });
    eq(t.vm.runInContext('[CATEGORY_MAP[0].color, CATEGORY_MAP[2].color]', withEngine), ['#0A7A64', 'var(--ct-yoga-base)'], 'on a page it is the base colour in effect — a literal a canvas can paint — and the token while the stylesheet has not answered');
    const throwing = t.loadPure('js/app.js', 'core', { window: { PsycleClassColours: { resolve() { throw new Error('no document'); } } } });
    eq(t.vm.runInContext('CATEGORY_MAP[0].color', throwing), 'var(--ct-ride-base)', 'a throwing engine cannot break a render');
  }

  // ── Export / import / iOS mirror ─────────────────────────────────────────
  t.section('psycle_class_colours: exported, imported like the theme, mirrored on iOS');
  {
    ok(/var EXPORT_KEYS = \[[^\]]*'psycle_theme',\s*'psycle_class_colours',/.test(settingsJs), 'settings export carries the key');
    ok(/classColours: window\.PsycleClassColours \? window\.PsycleClassColours\.clean : null/.test(settingsJs), 'importSettings hands the engine\'s cleaner to the planner');
    const imp = t.loadPure('js/settings.js', 'import-validate');
    const clean = { history: (v) => (Array.isArray(v) ? v : []), tiers: (v) => v || {}, idList: (v) => (Array.isArray(v) ? v : []), bikePrefs: (v) => v || {}, classColours: cc._ccStorable };
    const plan = (file, device) => imp._planSettingsImport(file, (k) => (device || {})[k] || '', { clean, themes: ['cloud', 'graphite'], historyMax: 2000 });
    const GOOD = JSON.stringify({ v: 1, intensity: 'bold', map: { ride: 'sky', yoga: 'hotpink' }, extra: '<b>' });
    let pl = plan({ psycle_class_colours: GOOD });
    eq([JSON.parse(pl.writes.psycle_class_colours), pl.added.colours, pl.accepted, pl.skipped], [{ v: 1, intensity: 'bold', map: { ride: 'sky' } }, 1, 1, []], 'an empty device takes the CLEANED choices (unknown swatch and stray members dropped)');
    eq(imp._importSummary(pl.added), 'your class colours', 'the summary names them');
    pl = plan({ psycle_class_colours: GOOD }, { psycle_class_colours: JSON.stringify({ v: 1, intensity: 'off', map: {} }) });
    eq([pl.writes.psycle_class_colours, pl.accepted, imp._importSummary(pl.added)], [undefined, 1, ''], 'a device with its own valid choice keeps it (accepted, nothing written)');
    pl = plan({ psycle_class_colours: GOOD }, { psycle_class_colours: '{"v":9}' });
    eq(!!pl.writes.psycle_class_colours, true, 'a device holding something unusable under the key counts as having none');
    [['"soft"', 'wrong shape'], ['[1,2]', 'wrong shape'], ['{"v":2,"intensity":"bold"}', 'wrong shape'], ['{"v":1,"map":{"ride":"constructor"}}', 'wrong shape'], ['{not json', 'unreadable'], ['', 'not text']].forEach((row) => {
      pl = plan({ psycle_class_colours: row[0] });
      eq([pl.writes.psycle_class_colours, pl.skipped.map((s) => s.key + ':' + s.reason)], [undefined, ['psycle_class_colours:' + row[1]]], JSON.stringify(row[0]) + ' → skipped (' + row[1] + ')');
    });
    pl = imp._planSettingsImport({ psycle_class_colours: GOOD }, () => '', { clean: { history: clean.history, tiers: clean.tiers, idList: clean.idList, bikePrefs: clean.bikePrefs }, themes: [] });
    eq([pl.writes.psycle_class_colours, pl.skipped.length], [undefined, 1], 'no cleaner handed in → the key is refused, never copied raw');
    const syncKeys = (/var SYNC_KEYS = \[([\s\S]*?)\n  \];/.exec(bridge) || [])[1] || '';
    ok(/'psycle_class_colours'/.test(syncKeys.replace(/\/\/.*$/gm, '')), 'native-bridge.js SYNC_KEYS mirrors it to Preferences');
  }
};
