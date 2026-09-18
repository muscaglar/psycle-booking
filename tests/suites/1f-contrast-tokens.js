'use strict';
// Colour-contrast guards for the design tokens (css/theme.css) and the
// stylesheets that consume them. Pure text analysis of the CSS — no browser.
//
// Why these exist: every bug this suite pins down shipped silently, because
// nothing fails when a colour is merely unreadable —
//   • tertiary text tokens below WCAG AA on the default (Cloud) theme,
//   • labels on accent buttons hard-coded to #fff / --text-heading (≈2:1 on
//     the pale Graphite / Handheld / Blueprint accents, 3:1 on Cloud's jade),
//   • [data-theme="light"] overrides that never matched (no such theme id),
//   • a JS-injected <style> with fixed colours that out-cascades theme.css.
module.exports = function (t) {
  // ── WCAG 2.x relative luminance / contrast ratio ─────────────────────────
  function rgb(hex) {
    let h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  function lum(hex) {
    const c = rgb(hex).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // ── Token blocks ─────────────────────────────────────────────────────────
  const themeCss = t.readSource('css/theme.css');

  // Custom properties declared in the first `<selector> { … }` block.
  function tokensOf(selector) {
    const start = themeCss.indexOf(selector + ' {');
    if (start === -1) throw new Error('theme.css: no block for ' + selector);
    const body = themeCss.slice(themeCss.indexOf('{', start) + 1, themeCss.indexOf('}', start))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const out = {};
    const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(body))) out[m[1]] = m[2].trim();
    return out;
  }
  const root = tokensOf(':root');
  // A theme block only overrides what it needs; the rest falls back to :root.
  function themeTokens(id) {
    return Object.assign({}, root, tokensOf('[data-theme="' + id + '"]'));
  }

  const HEX = /^#[0-9a-f]{3,8}$/i;
  t.section('Contrast — sanity');
  t.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01, 'black on white is 21:1');
  t.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.01, '#777 on white is 4.48:1 (just under AA)');

  // ── Text ladder: the three premium themes (Cloud is the default; Graphite
  //    is what every dark-mode phone gets) ─────────────────────────────────
  const LADDER = ['--text-muted', '--text-dim', '--text-faint', '--text-ghost'];
  ['cloud', 'linen', 'graphite'].forEach((id) => {
    t.section('Text tokens — ' + id);
    const tk = themeTokens(id);
    ['--bg', '--bg-panel'].forEach((surface) => {
      LADDER.forEach((name) => {
        const r = contrast(tk[name], tk[surface]);
        t.ok(HEX.test(tk[name]) && r >= 4.5,
          id + ': ' + name + ' ' + tk[name] + ' on ' + surface + ' is ' + r.toFixed(2) + ':1 (needs ≥4.5 — it carries real copy)');
      });
      // The hierarchy must survive: each tier strictly quieter than the last,
      // with --text-off (disabled/decorative only) at the bottom.
      const chain = ['--text'].concat(LADDER, ['--text-off']).map((n) => contrast(tk[n], tk[surface]));
      let ordered = true;
      for (let i = 1; i < chain.length; i++) if (!(chain[i] < chain[i - 1])) ordered = false;
      t.ok(ordered, id + ': text > muted > dim > faint > ghost > off on ' + surface +
        ' (' + chain.map((c) => c.toFixed(2)).join(' > ') + ')');
    });

    // Status inks: on their own chip, and on --bg-deep where the class sheet's
    // availability line (.cds-avail*) reuses them.
    ['full', 'waitlist', 'highlight'].forEach((kind) => {
      const ink = tk['--badge-' + kind + '-text'];
      ['--badge-' + kind + '-bg', '--bg-deep'].forEach((surface) => {
        const r = contrast(ink, tk[surface]);
        t.ok(r >= 4.5, id + ': --badge-' + kind + '-text ' + ink + ' on ' + surface + ' is ' + r.toFixed(2) + ':1 (≥4.5)');
      });
    });
    const rb = contrast(tk['--badge-text'], tk['--badge-bg']);
    t.ok(rb >= 4.5, id + ': --badge-text on --badge-bg is ' + rb.toFixed(2) + ':1 (≥4.5)');
  });

  // ── --accent-ink is the label colour for every accent fill ───────────────
  t.section('Accent ink');
  const themeJs = t.readSource('js/theme.js');
  const themeIds = [];
  themeJs.replace(/\{\s*id:\s*'([a-z]+)'/g, (m, id) => { themeIds.push(id); return m; });
  t.ok(themeIds.length >= 7 && themeIds.indexOf('cloud') !== -1, 'theme ids parsed from APP_THEMES (' + themeIds.join(', ') + ')');
  themeIds.forEach((id) => {
    const tk = themeTokens(id);
    const r = contrast(tk['--accent-ink'], tk['--accent']);
    // The premium themes + the two pale-accent flavour themes are held to AA;
    // Terminal/Synthwave keep their white-on-neon look (large-text AA).
    const need = (id === 'terminal' || id === 'synthwave') ? 3 : 4.5;
    t.ok(r >= need, id + ': --accent-ink ' + tk['--accent-ink'] + ' on --accent ' + tk['--accent'] + ' is ' + r.toFixed(2) + ':1 (≥' + need + ')');
    // …and white must NOT be assumed: on the pale accents it is unreadable.
  });
  ['graphite', 'gameboy', 'blueprint'].forEach((id) => {
    const tk = themeTokens(id);
    t.ok(contrast('#ffffff', tk['--accent']) < 3, id + ': white on --accent is below 3:1 — labels must use --accent-ink, never #fff');
  });

  // Every rule that paints an accent background and sets a text colour must
  // take that colour from --accent-ink. theme.css is included: its per-theme
  // "dark text on lime/sky" patches are gone because the source rules do it.
  const SHEETS = ['css/styles.css', 'css/theme.css', 'css/features.css', 'css/tabs.css', 'css/settings.css', 'css/explore.css'];
  function rules(css) {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    while ((m = re.exec(clean))) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
    return out;
  }
  const offenders = [];
  let accentFills = 0;
  SHEETS.forEach((file) => {
    rules(t.readSource(file)).forEach((r) => {
      if (!/background(?:-color)?\s*:\s*var\(--accent[,)]/.test(r.body)) return;
      const c = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(r.body);
      if (!c) return; // background-only restatement (theme.css) — colour is set at source
      accentFills++;
      if (!/^var\(--accent-ink[,)]/.test(c[1].trim())) offenders.push(file + ' ' + r.selector + ' → ' + c[1].trim());
    });
  });
  t.ok(accentFills >= 15, 'found the accent-filled controls (' + accentFills + ')');
  t.eq(offenders, [], 'every accent-filled control labels itself with --accent-ink');

  const gone = rules(themeCss).filter((r) =>
    /\[data-theme="(gameboy|blueprint)"\]\s+\.(btn|tab-badge|bc-btn-primary|tab-empty-btn)\b/.test(r.selector) && /(?:^|[;\s])color\s*:/.test(r.body));
  t.eq(gone.map((r) => r.selector), [], 'no per-theme button-label colour patches left in theme.css (they outranked .btn-ghost)');

  // A disabled .btn sits on --text-off, not the accent: its label must not be --accent-ink.
  const disabled = rules(t.readSource('css/styles.css')).concat(rules(themeCss)).filter((r) => r.selector === '.btn:disabled');
  t.ok(disabled.length >= 1 && disabled.every((r) => /(?:^|[;\s])color\s*:\s*var\(--text[,)]/.test(r.body)),
    '.btn:disabled sets its own label colour (--text)');
  themeIds.forEach((id) => {
    const tk = themeTokens(id);
    const r = contrast(tk['--text'], tk['--text-off']);
    t.ok(r >= 3, id + ': disabled button label (--text on --text-off) is ' + r.toFixed(2) + ':1 (≥3)');
  });

  // ── Dead theme selectors ────────────────────────────────────────────────
  // js/theme.js rejects any id outside APP_THEMES, so a [data-theme="x"] rule
  // for an unregistered x can never apply. theme.css is exempt: it keeps the
  // legacy "light"/"dark" blocks and lists "light" inside :is(...) groups.
  t.section('Theme selectors');
  const dead = [];
  SHEETS.concat(['css/redesign.css', 'css/discover-layout-fix.css']).filter((f) => f !== 'css/theme.css').forEach((file) => {
    t.readSource(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[data-theme="([^"]+)"\]/g, (m, id) => {
      if (themeIds.indexOf(id) === -1) dead.push(file + ' [data-theme="' + id + '"]');
      return m;
    });
  });
  t.eq(dead, [], 'no stylesheet targets an unregistered theme id');

  // ── Injected <style> in calendar.js ──────────────────────────────────────
  // It is appended after every <link>, so it beats theme.css on source order:
  // any colour in it has to be a token (a hex is only allowed as a fallback).
  const calJs = t.readSource('js/calendar.js');
  const tpl = /style\.textContent\s*=\s*`([\s\S]*?)`;/.exec(calJs);
  t.ok(!!tpl, 'calendar.js still injects its .cal-btn style block');
  if (tpl) {
    const bare = tpl[1].replace(/var\(--[a-z0-9-]+\s*,\s*#[0-9a-f]{3,8}\)/gi, 'var()');
    t.eq(bare.match(/#[0-9a-f]{3,8}\b/gi) || [], [], 'calendar.js injected style has no fixed colours (tokens only)');
    t.ok(/\.cal-btn\s*\{[^}]*color:\s*var\(--text-dim/.test(tpl[1]), '.cal-btn label uses --text-dim');
  }

  // ── Dark-era literals that must stay tokenised ───────────────────────────
  t.section('Tokenised components');
  const stylesRules = rules(t.readSource('css/styles.css'));
  function decl(selector, prop) {
    const r = stylesRules.filter((x) => x.selector === selector)[0];
    if (!r) return null;
    const m = new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+)').exec(r.body);
    return m ? m[1].trim() : null;
  }
  [
    ['.cds-detail-row', 'color', '--text'],
    ['.cds-avail', 'color', '--badge-highlight-text'],
    ['.cds-avail-full', 'color', '--badge-full-text'],
    ['.cds-duration-badge', 'background', '--accent-soft'],
    ['.bc-detail', 'color', '--text-muted'],
    ['.bc-btn-secondary', 'background', '--bg-input'],
    ['.modal-subtitle-line:first-child', 'color', '--text-muted'],
    ['.find-similar-popup', 'background', '--bg-panel'],
    ['.mb-countdown', 'background', '--accent-soft'],
    ['.bike-slot.selected rect', 'fill', '--accent'],
    ['.bike-slot.selected text', 'fill', '--accent-ink'],
  ].forEach((row) => {
    const v = decl(row[0], row[1]);
    t.ok(!!v && v.indexOf('var(' + row[2]) === 0, row[0] + ' { ' + row[1] + ' } reads ' + row[2] + ' (got ' + v + ')');
  });

  // ── Scoped ink overrides ────────────────────────────────────────────────
  // A tokenised pair that misses AA in ONE theme gets a scoped colour there
  // (theme.css) rather than a re-tuned brand token. Resolve what each theme
  // really paints: the `[data-theme="id"] <selector>` colour if there is one,
  // else the source rule's token.
  const themeRules = rules(themeCss);
  function inkToken(id, selector, sourceToken) {
    const want = '[data-theme="' + id + '"] ' + selector;
    const r = themeRules.filter((x) => x.selector.split(',').some((part) => part.trim() === want))[0];
    const m = r && /(?:^|[;\s])color\s*:\s*var\((--[a-z0-9-]+)\)/.exec(r.body);
    return m ? m[1] : sourceToken;
  }
  // Session-expired / safe-mode banner: the waitlist chip's colours, 13px copy.
  t.ok(decl('.app-banner, .safe-mode-banner', 'color').indexOf('var(--badge-waitlist-text') === 0 &&
    decl('.app-banner, .safe-mode-banner', 'background').indexOf('var(--badge-waitlist-bg') === 0,
    'the warning banner still takes its colours from --badge-waitlist-*');
  themeIds.forEach((id) => {
    const tk = themeTokens(id);
    const ink = inkToken(id, '.app-banner:not(.app-banner-danger)', '--badge-waitlist-text');
    t.eq(inkToken(id, '.safe-mode-banner', '--badge-waitlist-text'), ink, id + ': the safe-mode banner gets the same ink as the session banner');
    const r = contrast(tk[ink], tk['--badge-waitlist-bg']);
    t.ok(r >= 4.5, id + ': warning banner copy ' + ink + ' ' + tk[ink] + ' on --badge-waitlist-bg is ' + r.toFixed(2) + ':1 (≥4.5)');
  });
  // Accent-on-accent-soft chips: 10–12px bold labels (countdown, class
  // duration, booked seat). Held to AA on the premium themes, like the inks.
  ['.mb-countdown', '.cds-duration-badge', '.bc-slot'].forEach((chip) => {
    t.ok((decl(chip, 'color') || '').indexOf('var(--accent,') === 0 && (decl(chip, 'background') || '').indexOf('var(--accent-soft') === 0,
      chip + ' is an --accent on --accent-soft chip at source');
    ['cloud', 'linen', 'graphite'].forEach((id) => {
      const tk = themeTokens(id);
      const ink = inkToken(id, chip, '--accent');
      const r = contrast(tk[ink], tk['--accent-soft']);
      t.ok(HEX.test(tk['--accent-soft']) && r >= 4.5, id + ': ' + chip + ' ' + ink + ' ' + tk[ink] + ' on --accent-soft is ' + r.toFixed(2) + ':1 (≥4.5)');
    });
  });

  // The shell's banners/legend must not carry inline hex colours any more.
  const html = t.readSource('psycle-finder.html');
  ['sessionBanner', 'corsBanner'].forEach((id) => {
    const tag = new RegExp('<div id="' + id + '"[^>]*>').exec(html);
    t.ok(!!tag && /class="app-banner[ "]/.test(tag[0]) && !/#[0-9a-f]{3,6}/i.test(tag[0]), '#' + id + ' is class-styled (no inline hex)');
    // JS shows these with style.display = 'flex' | 'block'; the hidden default must stay inline.
    t.ok(!!tag && /style="[^"]*display:\s*none/.test(tag[0]), '#' + id + ' still starts hidden via inline display:none');
  });
  // The Discover "— all studios" aside shows by default: #555 inline was
  // ~2.5:1 on every dark theme (and the same literal sat in three JS strings).
  const hintTag = /<span id="locationHint"[^>]*>/.exec(html);
  t.ok(!!hintTag && /class="label-hint"/.test(hintTag[0]) && !/#[0-9a-f]{3,6}/i.test(hintTag[0]), '#locationHint is class-styled (no inline hex)');
  t.ok((decl('.label-hint', 'color') || '').indexOf('var(--text-dim') === 0, '.label-hint reads --text-dim (got ' + decl('.label-hint', 'color') + ')');
  ['js/app.js', 'js/settings.js', 'js/tabs.js'].forEach((file) => {
    t.ok(!/style="[^"]*color:\s*#555/.test(t.readSource(file)), file + ' has no inline color:#555 left');
  });
  const legend = /<div class="bike-legend">[\s\S]*?<\/div>/.exec(html);
  t.ok(!!legend && !/background:#[0-9a-f]{3,6}/i.test(legend[0]) && /background:var\(--accent\)/.test(legend[0]),
    'bike-picker legend "Your pick" swatch follows --accent like the map');
};
