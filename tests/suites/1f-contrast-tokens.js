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

  // ── Text ladder: the two premium themes (Cloud is the default; Graphite
  //    is what every dark-mode phone gets). Linen was the third until it was
  //    retired in wave 10 — tests/suites/10b-themes.js holds it gone. ────────
  const LADDER = ['--text-muted', '--text-dim', '--text-faint', '--text-ghost'];
  ['cloud', 'graphite'].forEach((id) => {
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

  // ── Text ladder: the three flavour themes (Synthwave, the fourth, was
  //    retired in wave 10) ───────────────────────────────────────────────────
  // They never got the ladder: --text-ghost was 2.1–3.1:1 on their cards, and
  // it carries the bike-picker hint and the Discover status line. Same floor;
  // the tiers must still run loudest → quietest. Handheld's four-shade palette
  // has nothing darker than its muted lime that passes, so its tiers may tie.
  ['terminal', 'gameboy', 'blueprint'].forEach((id) => {
    t.section('Text tokens — ' + id);
    const tk = themeTokens(id);
    ['--bg', '--bg-panel'].forEach((surface) => {
      LADDER.forEach((name) => {
        const r = contrast(tk[name], tk[surface]);
        t.ok(HEX.test(tk[name]) && r >= 4.5,
          id + ': ' + name + ' ' + tk[name] + ' on ' + surface + ' is ' + r.toFixed(2) + ':1 (needs ≥4.5 — it carries real copy)');
      });
      const chain = ['--text'].concat(LADDER, ['--text-off']).map((n) => contrast(tk[n], tk[surface]));
      let ordered = true;
      for (let i = 1; i < chain.length; i++) {
        const tie = id === 'gameboy' && i > 1 && i < chain.length - 1 && chain[i] === chain[i - 1];
        if (!(chain[i] < chain[i - 1]) && !tie) ordered = false;
      }
      t.ok(ordered, id + ': text > muted ≥ dim ≥ faint ≥ ghost > off on ' + surface + (id === 'gameboy' ? ' (ties allowed)' : ' (strict)') +
        ' (' + chain.map((c) => c.toFixed(2)).join(' > ') + ')');
    });
  });

  // ── --accent-ink is the label colour for every accent fill ───────────────
  t.section('Accent ink');
  const themeJs = t.readSource('js/theme.js');
  const themeIds = [];
  themeJs.replace(/\{\s*id:\s*'([a-z]+)'/g, (m, id) => { themeIds.push(id); return m; });
  t.ok(themeIds.length >= 5 && themeIds.indexOf('cloud') !== -1, 'theme ids parsed from APP_THEMES (' + themeIds.join(', ') + ')');
  themeIds.forEach((id) => {
    const tk = themeTokens(id);
    const r = contrast(tk['--accent-ink'], tk['--accent']);
    // The premium themes + the two pale-accent flavour themes are held to AA;
    // Terminal keeps its white-on-neon look (large-text AA).
    const need = id === 'terminal' ? 3 : 4.5;
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

  // ── --danger: one themed destructive colour ──────────────────────────────
  // Sign out was a fixed #b3261e (1.8–2.9:1 on the five dark themes), the seat
  // × a 70% pink (<2.9:1 everywhere) and the cancel dialog's danger button the
  // same accent fill as "Book". The pair aliases tokens every theme already
  // tunes; tokensOf returns raw var() strings, so they are resolved by hand.
  t.section('Danger pair');
  t.eq([root['--danger'], root['--danger-ink']], ['var(--badge-full-text)', 'var(--bg-panel)'],
    '--danger / --danger-ink alias the Full-chip red and the panel in :root');
  themeIds.forEach((id) => {
    const own = tokensOf('[data-theme="' + id + '"]');
    t.ok(!('--danger' in own) && !('--danger-ink' in own), id + ': does not re-declare the pair (a literal there would dodge the checks below)');
    const tk = themeTokens(id);
    // As ink on either surface; on --bg-panel the same ratio is the --danger-ink label on a --danger fill.
    ['--bg-panel', '--bg-input'].forEach((surface) => {
      const r = contrast(tk['--badge-full-text'], tk[surface]);
      t.ok(HEX.test(tk['--badge-full-text']) && HEX.test(tk[surface]) && r >= 4.5,
        id + ': --danger ' + tk['--badge-full-text'] + ' on ' + surface + ' is ' + r.toFixed(2) + ':1 (≥4.5)');
    });
  });
  const dangerRules = rules(t.readSource('css/styles.css')).concat(rules(t.readSource('css/redesign.css')), rules(themeCss));
  function declOf(selector, prop) {
    const hits = dangerRules.filter((x) => x.selector.split(',').some((part) => part.trim() === selector));
    const vals = hits.map((x) => (new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+)').exec(x.body) || [])[1]).filter(Boolean);
    return vals.map((v) => v.trim());
  }
  [
    ['.ms-signout', 'color', 'var(--danger)'],
    ['.up-seat-chip button', 'color', 'var(--danger)'],
    ['.confirm-btn-danger', 'background', 'var(--danger)'],
    ['.confirm-btn-danger', 'color', 'var(--danger-ink)'],
    ['.swipe-cancel-bg', 'background', 'var(--danger)'],
    ['.swipe-cancel-bg span', 'color', 'var(--danger-ink)'],
  ].forEach((row) => {
    // Every declaration, in every sheet: a later light/dark patch must not bring a fixed red back.
    t.eq(declOf(row[0], row[1]), [row[2]], row[0] + ' { ' + row[1] + ' } is ' + row[2] + ' and nothing re-colours it');
  });
  t.ok(declOf('.confirm-btn-primary', 'background')[0] !== declOf('.confirm-btn-danger', 'background')[0],
    'the dialog\'s costly button no longer wears the same fill as the primary one');
  t.eq(declOf('.up-seat-chip button:hover', 'color'), [], 'the seat × has no hover colour (it used to flip red → accent)');

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
  // Accent-on-accent-soft chips: 10–12px bold labels (countdown, booked
  // seat). Held to AA on the premium themes, like the inks.
  ['.mb-countdown', '.bc-slot'].forEach((chip) => {
    t.ok((decl(chip, 'color') || '').indexOf('var(--accent,') === 0 && (decl(chip, 'background') || '').indexOf('var(--accent-soft') === 0,
      chip + ' is an --accent on --accent-soft chip at source');
    ['cloud', 'graphite'].forEach((id) => {
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
  // ~2.5:1 on every dark theme.
  const hintTag = /<span id="locationHint"[^>]*>/.exec(html);
  t.ok(!!hintTag && /class="label-hint"/.test(hintTag[0]) && !/#[0-9a-f]{3,6}/i.test(hintTag[0]), '#locationHint is class-styled (no inline hex)');
  t.ok((decl('.label-hint', 'color') || '').indexOf('var(--text-dim') === 0, '.label-hint reads --text-dim (got ' + decl('.label-hint', 'color') + ')');
  // Wave 9 (Crisp Colour): the swatches are class-styled marks (.seat-key) —
  // no inline colour at all — and "Your pick" reads the very token the map's
  // selected seat is filled with (css/crisp.css; the class colour of the class
  // being booked, the accent as its fallback).
  const legend = /<div class="bike-legend">[\s\S]*?<\/div>/.exec(html);
  const crisp = t.readSource('css/crisp.css').replace(/\/\*[\s\S]*?\*\//g, '');
  t.ok(!!legend && !/style=/.test(legend[0]) && /<i class="seat-key is-pick"><\/i> Your pick/.test(legend[0]) &&
    /\.bike-legend \.seat-key\.is-pick, \.bike-legend \.seat-key\.is-mine \{ background: var\(--seat-mine-fill\);/.test(crisp) &&
    /#bikeSvg \.bike-slot\.selected, #bikeSvg \.bike-slot\.mine \{ --seat-fill: var\(--seat-mine-fill\);/.test(crisp) &&
    /--seat-mine-fill: var\(--ct-base, var\(--accent\)\);/.test(crisp),
    'bike-picker legend "Your pick" swatch is filled from the same token as the map\'s selected seat');
};
