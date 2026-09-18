'use strict';
// Tap targets, desktop Discover spacing, radius tokens, card entrance motion.
// Whether a finger actually lands can only be proven in a browser — these pin
// the arithmetic and the cascade order the CSS depends on, so a later edit
// can't quietly bring back an overlapping hit area, a sideways-scrolling sheet
// or a rule that loses to redesign.css.
module.exports = function (t) {
  const theme = t.readSource('css/theme.css');
  const styles = t.readSource('css/styles.css');
  const tabsCss = t.readSource('css/tabs.css');
  const redesign = t.readSource('css/redesign.css');
  const fix = t.readSource('css/discover-layout-fix.css');
  const app = t.readSource('js/app.js');

  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Declarations of the first rule whose selector list ends with `selector`
  // (and, when `prop` is given, that declares it — a selector can also close
  // a shared `content/position` list).
  function ruleBody(css, selector, prop) {
    const src = noComments(css);
    for (let at = src.indexOf(selector + ' {'); at !== -1; at = src.indexOf(selector + ' {', at + 1)) {
      const open = src.indexOf('{', at);
      const body = src.slice(open + 1, src.indexOf('}', open));
      if (!prop || new RegExp('(^|[\\s;])' + prop + ':').test(body)) return body;
    }
    return null;
  }
  // Custom properties of the first `<selector> { … }` block in theme.css.
  function tokensOf(selector) {
    const body = ruleBody(theme, selector) || '';
    const out = {};
    body.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
    return out;
  }
  const root = tokensOf(':root');
  const px = (name) => parseFloat(root[name]);
  // "calc(var(--space-5) * -1)" / "-2px" / "0" → how far the area reaches OUT, in px.
  function reach(v) {
    const tok = v.match(/^calc\(var\((--[\w-]+)\) \* -1\)$/);
    if (tok) return px(tok[1]);
    const lit = v.match(/^-(\d+(?:\.\d+)?)px$/);
    if (lit) return Number(lit[1]);
    return v === '0' ? 0 : NaN;
  }
  // inset: top right bottom left — each side is one calc(...) or a literal.
  function insetOf(body) {
    const m = (body || '').match(/inset:\s*([^;]+);/);
    const parts = m ? (m[1].match(/calc\([^()]*\([^()]*\)[^()]*\)|\S+/g) || []) : [];
    return parts.length === 4 ? parts.map(reach) : null;
  }

  // ── Tap targets ───────────────────────────────────────────────────────────
  t.section('Tap targets: token + hit areas that move nothing');
  t.eq(root['--tap-min'], '44px', '--tap-min is 44px in :root');

  // The block runs from its banner comment to the end of the touch query.
  const banner = styles.indexOf('   Tap targets\n');
  const tapFrom = styles.indexOf('*/', banner) + 2;
  const tapTo = styles.indexOf('\n}\n', styles.indexOf('@media (pointer: coarse)', tapFrom)) + 3;
  t.ok(banner !== -1 && tapTo > tapFrom && tapTo - tapFrom < 6000, 'tap-target block found in styles.css');
  const tap = noComments(styles.slice(tapFrom, tapTo));

  const rel = tap.match(/([^{}]+)\{\s*position:\s*relative;\s*\}/g) || [];
  const relSelectors = rel.join(' ');
  t.ok(rel.length > 0 && !/\.onboard-skip/.test(relSelectors) && !/(^|[\s,])\.cds-close/.test(relSelectors),
    'never position:relative on .onboard-skip / .cds-close (both are position:absolute — it would un-anchor them)');
  t.ok(/\.modal-close:not\(\.cds-close\)/.test(relSelectors), '.modal-close is made relative only when it is not the class-sheet ×');
  t.ok(/\.settings-close:not\(\.diag-close\)/.test(relSelectors), '.diag-close keeps its real 44px box');
  t.ok(/position:\s*absolute/.test(ruleBody(styles, '.cds-close') || '') && /position:\s*absolute/.test(ruleBody(styles, '.onboard-skip') || ''),
    '.cds-close and .onboard-skip are still absolutely positioned (their ::after resolves against them)');
  t.ok(!/margin/.test(tap), 'no margin tricks: .travel-notice-close keeps margin-left:auto, its only right-aligner');

  // Sheets are overflow:auto — an area overhanging the padding adds a sideways scroll.
  const closeArea = ruleBody(tap, '.settings-close:not(.diag-close)::after', 'width');
  const overhang = closeArea && closeArea.match(/right:\s*calc\(var\((--[\w-]+)\) \* -1\)/);
  const pickerPad = (styles.match(/#bikeModal \.modal \{[^}]*?padding:\s*var\((--[\w-]+)\)/) || [])[1];
  t.ok(!!overhang && !!pickerPad && px(overhang[1]) <= px(pickerPad),
    'sheet × overhangs no further than the phone bike picker padding (' + pickerPad + '), the tightest header it sits in');
  t.ok(/width:\s*var\(--tap-min\)/.test(closeArea || '') && /height:\s*var\(--tap-min\)/.test(closeArea || ''), 'sheet × area is --tap-min square');

  const cds = ruleBody(styles, '.cds-close');
  const cdsArea = ruleBody(tap, '.cds-close::after', 'top');
  const side = (body, prop) => ((body || '').match(new RegExp(prop + ':\\s*(?:calc\\()?var\\((--[\\w-]+)\\)')) || [])[1];
  t.ok(['top', 'right'].every((p) => !!side(cds, p) && !!side(cdsArea, p) && px(side(cdsArea, p)) <= px(side(cds, p))),
    "class-sheet × area reaches no further than the button's own top/right offsets — the sheet corner, never past it");

  const notice = ruleBody(tap, '.travel-notice-close::after', 'top');
  t.ok(/\.travel-notice \{\s*position:\s*relative;\s*\}/.test(tap) && !/\.travel-notice-close[^{]*\{\s*position:\s*relative/.test(tap),
    'travel notice: the notice is the containing block, the button stays unpositioned');
  t.ok(/top:\s*0/.test(notice || '') && /bottom:\s*0/.test(notice || '') && /right:\s*0/.test(notice || ''),
    'travel notice × area is bounded by the notice (never onto the instructor box above it)');

  t.section('Tap targets: no area reaches a neighbouring control');
  // Refresh sits above Clear filters, `gap` apart; Clear wipes the filters unasked.
  const gap = Number(((ruleBody(redesign, '.disc-actions') || '').match(/gap:\s*(\d+)px/) || [])[1]);
  const refresh = insetOf(ruleBody(redesign, '.disc-actions .refresh-link::after', 'inset'));
  const clear = insetOf(ruleBody(redesign, '.disc-clear-btn::after', 'inset'));
  t.ok(!!refresh && !!clear && refresh.concat(clear).every((n) => n >= 0), 'Refresh / Clear filters insets parse');
  t.ok(gap > 0 && refresh && clear && refresh[2] + clear[0] < gap,
    'Refresh reaches down + Clear reaches up < the ' + gap + 'px between them — the areas never overlap');
  t.ok(refresh && clear && refresh[0] > refresh[2] && clear[2] > clear[0], 'each grows away from the other');
  t.ok(app.indexOf('class="refresh-link"') !== -1 && t.readSource('js/tabs.js').indexOf('class="disc-clear-btn"') !== -1,
    'both controls still carry the classes the hit areas hang on');

  // Seat chips wrap; the × of row 2 sits right under the × of row 1.
  const chip = ruleBody(styles, '.up-seat-chip');
  const chipPadTop = Number(((chip || '').match(/padding:\s*(\d+)px/) || [])[1]);
  const chipBorder = Number(((chip || '').match(/border:\s*(\d+)px/) || [])[1]);
  const rowGap = (tap.match(/\.up-seats \{\s*row-gap:\s*var\((--[\w-]+)\)/) || [])[1];
  const seat = insetOf(ruleBody(tap, '.up-seat-chip button::after', 'inset'));
  t.ok(!!seat && !!rowGap && chipPadTop >= 0 && chipBorder >= 0, 'seat chip geometry parses');
  t.ok(seat && seat[0] + seat[2] <= 2 * (chipPadTop + chipBorder) + px(rowGap),
    "seat ×: reach up + reach down fits between two wrapped rows' × buttons — a tap can't pick the other seat");
  // …and sideways: the next chip starts after this chip's right padding + border + the column gap.
  const chipPadRight = (chip || '').match(/padding:\s*\d+px var\((--[\w-]+)\)/);
  const colGap = ((ruleBody(styles, '.up-seats') || '').match(/gap:\s*var\((--[\w-]+)\)/) || [])[1];
  t.ok(seat && chipPadRight && colGap && seat[1] < px(chipPadRight[1]) + chipBorder + px(colGap), 'seat × stops short of the next chip');
  t.ok(seat && seat[2] < px('--space-4'), 'seat × stops short of the Cancel button (.mb-primary-btn margin-top) under the row');
  // Wave 2: the area measured ~31x30 in a browser, under the 40px floor. The ×
  // box is its font-size tall (line-height: 1) and ~11px wide (glyph + 1px padding a side).
  const seatBtn = ruleBody(styles, '.up-seat-chip button');
  const seatBtnH = /line-height:\s*1;/.test(seatBtn || '') ? px(((seatBtn || '').match(/font-size:\s*var\((--[\w-]+)\)/) || [])[1]) : NaN;
  t.ok(seat && seatBtnH + seat[0] + seat[2] >= 40, 'seat × area is at least 40px tall (' + (seat && seatBtnH + seat[0] + seat[2]) + ')');
  t.ok(seat && 10 + seat[1] + seat[3] >= 40, 'seat × area is at least 40px wide, even around a 10px glyph box');
  // A generous area is only safe because a stray tap is caught by a dialog.
  const cancelFn = app.slice(app.indexOf('async function upcomingSeatCancel('));
  const cancelBody = cancelFn.slice(0, cancelFn.indexOf('\n}\n'));
  const asks = cancelBody.indexOf('confirmCancelWithPolicy(');
  t.ok(asks !== -1 && asks < cancelBody.indexOf('apiFetch('), 'the seat × still asks before it cancels anything');

  // Instructor chip ×: 40px no longer fits INSIDE the 36px chip, so pin where
  // the 2px it stands proud goes, and that sideways it ends at the chip's edge.
  const instr = ruleBody(tap, '.instr-chip button::after', 'height');
  const instrChip = ruleBody(redesign, '.instr-chip') || '';
  const chipH = Number((instrChip.match(/height:\s*(\d+)px/) || [])[1]);
  const instrPadRight = Number((instrChip.match(/padding:\s*0 (\d+)px/) || [])[1]);
  const instrBorder = Number((instrChip.match(/border:\s*(\d+)px/) || [])[1]);
  const areaTok = ((instr || '').match(/height:\s*var\((--[\w-]+)\)/) || [])[1];
  const areaW = ((instr || '').match(/width:\s*var\((--[\w-]+)\)/) || [])[1];
  t.ok(!!areaTok && px(areaTok) >= 40 && areaW === areaTok, 'instructor chip × area is a >= 40px square (it measured 32px)');
  const proud = (px(areaTok) - chipH) / 2;
  const boxPadY = Number(((ruleBody(redesign, '.instr-box', 'padding') || '').match(/padding:\s*(\d+)px/) || [])[1]);
  const chipsGap = Number(((ruleBody(redesign, '#instrChips') || '').match(/gap:\s*(\d+)px/) || [])[1]);
  t.ok(/top:\s*50%/.test(instr || '') && /transform:\s*translateY\(-50%\)/.test(instr || '') && proud >= 0 && proud < boxPadY && 2 * proud < chipsGap,
    'it is centred on the ' + chipH + 'px chip: the ' + proud + 'px it stands proud stays inside .instr-box padding (' + boxPadY + 'px) and two wrapped rows never meet (' + chipsGap + 'px apart)');
  const instrRight = ((instr || '').match(/right:\s*(calc\(var\(--[\w-]+\) \* -1\))/) || [])[1];
  t.ok(!!instrRight && !/left:/.test(instr || '') && reach(instrRight) <= instrPadRight + instrBorder,
    "sideways it starts at the chip's own outer edge (right padding + border) and grows over the name — never onto the next chip or the search field");

  const coarse = tap.slice(tap.indexOf('@media (pointer: coarse)'));
  t.ok(tap.indexOf('@media (pointer: coarse)') !== -1 && /min-height:\s*var\(--tap-min\)/.test(coarse), 'text buttons get --tap-min height on touch screens only');
  ['.booking-action-btn', '.mb-primary-btn', '.confirm-btn', '.habit-find-btn'].forEach((sel) => {
    t.ok(coarse.indexOf(sel) !== -1, sel + ' is in the touch min-height list');
  });
  t.ok(!/min-height/.test(tap.slice(0, tap.indexOf('@media (pointer: coarse)'))), 'no min-height outside the touch query (mouse layout keeps its density)');

  // ── Desktop Discover ──────────────────────────────────────────────────────
  t.section('Desktop Discover: spacing, aligned chrome, reachable chips');
  const desk = ruleBody(styles, '  #tab-discover.active');
  t.ok(!!desk && /max-width:\s*1080px/.test(desk) && !/padding/.test(desk),
    "#tab-discover.active sets no padding (it outranks redesign.css's #tab-discover and zeroed the top)");
  const panelPad = (noComments(redesign).match(/#tab-discover \{\s*padding:\s*([^;]+);/) || [])[1] || '';
  t.ok(/^18px 22px \d+px$/.test(panelPad), 'redesign.css owns the Discover padding at every width (top 18px)');
  t.eq(panelPad.split(' ')[2], (noComments(styles).match(/\.tab-panel \{\s*padding-bottom:\s*calc\((\d+px)/) || [])[1],
    'Discover bottom padding is the .tab-panel pill clearance, not more');

  const exploreSel = '#tab-discover #discoverExploreWrap .explore-section';
  t.ok(noComments(styles).indexOf(exploreSel) === -1, 'explore-section gutter reset no longer lives in the desktop-only block');
  const firstMedia = noComments(redesign).indexOf('@media');
  const exploreAt = noComments(redesign).indexOf(exploreSel);
  t.ok(exploreAt !== -1 && exploreAt < firstMedia && /padding-left:\s*0;\s*padding-right:\s*0/.test(ruleBody(redesign, exploreSel) || ''),
    'explore rows drop their own side padding at every width (no 22+16px double inset on phones)');

  const chrome = (noComments(fix).match(/header,\s*\.tab-bar \{([^}]*)\}/) || [])[1] || '';
  t.ok(/padding-inline:\s*max\(var\(--space-9\),\s*calc\(\(100% - 1080px\) \/ 2 \+ var\(--space-9\)\)\)/.test(chrome),
    'header + tab bar are inset to the 1080px column (100%, not 100vw — scrollbar-safe)');
  t.ok(/\.tab-panel \{ max-width: 1080px/.test(styles), 'the column is still 1080px wide');
  // The banners sit between the two and kept their text at the window's edge.
  t.ok(/\.app-banner,\s*header,\s*\.tab-bar \{/.test(noComments(fix)), 'the app banners (session, CORS, offline, new version) share that inset');
  t.ok(!/padding(-block|-top|-bottom)?:/.test(chrome), '…inline padding only: each banner keeps its own block padding');
  t.ok(/<link rel="stylesheet" href="css\/discover-layout-fix\.css">\s*(?![\s\S]*<link rel="stylesheet")/.test(t.readSource('psycle-finder.html')),
    "discover-layout-fix.css is the last stylesheet, so at equal specificity it beats .app-banner(-danger)'s padding shorthand");

  // The wrap rule must repeat redesign.css's selectors (its nowrap is !important)
  // and come after this file's own unconditional nowrap/overflow rule.
  const wrapAt = fix.lastIndexOf('@media (min-width: 1024px)');
  const wrapBlock = noComments(fix.slice(wrapAt));
  t.ok(wrapAt > fix.indexOf('nuke any negative-margin bleed trick'), 'desktop wrap rule comes after the unconditional pill-row rule');
  t.ok(/flex-wrap:\s*wrap !important/.test(wrapBlock) && /overflow-x:\s*visible/.test(wrapBlock), 'chip rows wrap and stop scrolling on desktop');
  const rowRule = noComments(redesign).match(/((?:#tab-discover [^,{]+,\s*)+#tab-discover [^,{]+)\{[^}]*flex-wrap:\s*nowrap !important/);
  const rows = rowRule ? rowRule[1].split(',').map((s) => s.trim()) : [];
  t.ok(rows.length >= 3 && rows.every((sel) => wrapBlock.indexOf(sel) !== -1),
    "every row redesign.css forces to nowrap is re-listed with the same selector (a shorter one would lose to its !important)");

  // ── Radius tokens ─────────────────────────────────────────────────────────
  t.section('Radius: redesign.css reads the tokens, Handheld zeroes them all');
  const literal = (noComments(redesign).match(/border-radius:\s*[^;]+;/g) || [])
    .filter((d) => !/var\(--radius-/.test(d) && !/:\s*(0|50%);/.test(d));
  t.eq(literal, ['border-radius: 9px;'], 'only the 9px calendar nav keeps a literal radius');
  t.eq([root['--radius-4xl'], root['--radius-5xl']], ['16px', '18px'], '--radius-4xl / --radius-5xl continue the scale');
  const gb = tokensOf('[data-theme="gameboy"]');
  const radii = Object.keys(root).filter((k) => k.indexOf('--radius-') === 0);
  t.ok(radii.length >= 10 && radii.every((k) => gb[k] === '0'), 'Handheld zeroes every --radius-* token that :root defines');
  (noComments(redesign).match(/var\(--radius-[\w-]+\)/g) || []).forEach((ref, i, all) => {
    if (all.indexOf(ref) === i) t.ok(ref.slice(4, -1) in root, ref + ' resolves to a :root token');
  });

  // ── Card entrance motion ──────────────────────────────────────────────────
  t.section('Card entrance: first screen only, nothing held after it ends');
  const live = noComments(tabsCss);
  t.ok(/\.class-grid \.class-card \{ animation: cardEnter 0\.3s ease-out backwards; \}/.test(live),
    'fill-mode is backwards (both pinned transform/opacity for good and beat :hover / :active)');
  t.ok(!/\.class-card[^{]*\{[^}]*cardEnter[^}]*\bboth\b/.test(live + noComments(styles)), 'no .class-card entrance with fill-mode both is left');
  const off = live.match(/\.class-grid \.class-card:nth-child\(n\+9\),\s*\.day-group ~ \.day-group \.class-card \{ animation: none; \}/);
  t.ok(!!off, 'cards past the 8th, and every later day group, do not animate');
  t.ok(off && live.indexOf(off[0]) > live.indexOf('.class-grid .class-card:nth-child(n+6)'), 'the cap comes after the delay rules it overrides (same specificity)');
  t.ok(!/\.class-grid \.class-card:nth-child/.test(noComments(styles)), 'the dead delay rules are gone from styles.css');
  t.ok(/@keyframes cardEnter/.test(styles), '@keyframes cardEnter stays (tabs.css / explore.css use it)');
  // The cap selector is a contract with render(): #results > .day-group … .class-grid > .class-card.
  t.ok(app.indexOf("group.className = 'day-group'") !== -1 && app.indexOf("grid.className = 'class-grid'") !== -1,
    'render() still builds .day-group > .class-grid, which the cap selector relies on');
  // Press feedback: a card is :active while ANYTHING inside it is pressed. On a
  // ~1000px desktop card the scale slid the Book pill ~6px from under the
  // pointer mid-click, and the click landed on the card (detail sheet).
  const press = (live.match(/\/?\s*([^{}]*\.theme-swatch:active) \{ transform: scale\(0\.985\); \}/) || [])[1] || '';
  t.ok(press !== '' && !/\.class-card/.test(press), 'the shared press rule no longer lists .class-card');
  t.ok(live.indexOf('.class-card:active:not(:has(:is(button, a, [role="button"], [onclick]):active)) { transform: scale(0.985); }') !== -1,
    'the card presses only when the press is on the card itself — not on a button, link or instructor name inside it — in a rule of its own (no :has() → only this rule is dropped)');
  const reduced = live.slice(live.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  t.ok(/\.class-grid \.class-card,/.test(reduced), 'reduced-motion still switches the entrance off entirely');

  // ── Instructor modal: the S–F row beside a photo ──────────────────────────
  t.section('Instructor modal: the rank row fits a 375px phone');
  const features = t.readSource('css/features.css');
  const settingsCss = t.readSource('css/settings.css');
  const rankBtns = ruleBody(features, '.instructor-rank .tier-btns') || '';
  t.ok(/flex:\s*0 1 auto/.test(rankBtns) && /flex-wrap:\s*wrap/.test(rankBtns) && /min-width:\s*0/.test(rankBtns), 'in the modal the six buttons may shrink and wrap');
  t.ok(/flex-shrink:\s*0/.test(ruleBody(settingsCss, '.tier-btns') || ''), "Membership's own row keeps its fixed width (the modal rule outranks it by one class, whatever the file order)");
  // 375 − overlay padding − modal padding + border − profile padding − photo − gap.
  const tierW = parseFloat(((ruleBody(settingsCss, '.tier-btn') || '').match(/width:\s*(\d+)px/) || [])[1]);
  const tierGap = parseFloat(((ruleBody(settingsCss, '.tier-btns') || '').match(/gap:\s*(\d+)px/) || [])[1]);
  t.ok(6 * tierW + 5 * tierGap > 131 && 4 * tierW + 3 * tierGap <= 131, 'the row is wider than the ~131px column beside a photo at 375px, and four buttons fit a line (4 + 2)');

  // ── The one colour exception ──────────────────────────────────────────────
  t.section('Light bases: "Cancel booking" label contrast');
  function lum(hex) {
    const c = [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16) / 255)
      .map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const booked = ruleBody(theme, ':is([data-theme="light"], [data-theme="cloud"], [data-theme="linen"]) .book-btn.booked') || '';
  const ink = (booked.match(/[^-]color:\s*(#[0-9a-f]{6})/i) || [])[1];
  const bg = (booked.match(/background:\s*(#[0-9a-f]{6})/i) || [])[1];
  const ratio = ink && bg ? (Math.max(lum(ink), lum(bg)) + 0.05) / (Math.min(lum(ink), lum(bg)) + 0.05) : 0;
  t.ok(ratio >= 4.5, '.book-btn.booked ink on its fill is ' + ratio.toFixed(2) + ':1 (>= 4.5:1)');
};
