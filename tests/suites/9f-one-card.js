'use strict';
// Wave 9 — integration: the class card is ONE component with two wearers.
// 9b (Discover's eventCard) and 9d (My Bookings' renderMyBookings) built the
// card in parallel from one description. Merged, everything they SHARE is said
// once, in css/crisp.css crisp:9b-discover 9b.7, on `.class-card[data-ct]`
// (0,2,0); crisp:9d-bookings adds only what a held class needs.
//
// That arrangement has one weak point, and this suite guards it: 9d used to
// re-declare the card's surface at id specificity, which also SHIELDED it from
// the older sheets. With the copy gone, any older rule that outranks (0,2,0) on
// the card root wins again — two light-base rules in css/theme.css did exactly
// that (they washed the class tint out of booked and past cards on Cloud and
// Linen) and were removed. Nothing like them may come back.
// Also held here: the other old-rule leaks the integration found, the one rank
// recipe, and the two small handoffs taken (spoken rank tile, swipe tick).
module.exports = function (t) {
  const { ok, eq } = t;
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const OLDER = ['styles.css', 'theme.css', 'features.css', 'tabs.css', 'settings.css', 'explore.css', 'redesign.css', 'discover-layout-fix.css'];
  const crispAll = t.readSource('css/crisp.css');
  const section = (a, b) => noComments(crispAll.slice(crispAll.indexOf('/* == crisp:' + a + ' == */'), b ? crispAll.indexOf('/* == crisp:' + b + ' == */') : crispAll.length));
  const s9b = section('9b-discover', '9c-sheets'), s9d = section('9d-bookings', '9e-stats-membership'), s9e = section('9e-stats-membership');

  // ── a small, honest specificity reader (ids, classes/attributes/pseudo-classes) ──
  const splitTop = (sel) => { const out = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(') d++; else if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()).filter(Boolean); };
  const FN = /:(is|not|where|has)\(((?:[^()]|\([^()]*\))*)\)/;
  const spec = (sel) => {
    let a = 0, b = 0;
    for (let m = FN.exec(sel); m; m = FN.exec(sel)) {
      if (m[1] !== 'where') { const best = splitTop(m[2]).map(spec).sort((x, y) => (y[0] - x[0]) || (y[1] - x[1]))[0] || [0, 0]; a += best[0]; b += best[1]; }
      sel = sel.replace(m[0], '');
    }
    b += (sel.match(/\[[^\]]*\]/g) || []).length; sel = sel.replace(/\[[^\]]*\]/g, '');
    a += (sel.match(/#[\w-]+/g) || []).length; sel = sel.replace(/#[\w-]+/g, '');
    b += (sel.match(/\.[\w-]+/g) || []).length; sel = sel.replace(/\.[\w-]+/g, '').replace(/::[\w-]+/g, '');
    b += (sel.match(/:[\w-]+/g) || []).length;
    return [a, b];
  };
  const subjectClasses = (sel) => { let s = sel; while (FN.test(s)) s = s.replace(FN, ''); return (s.trim().split(/[\s>+~]+/).pop().replace(/::?[\w-]+(\([^)]*\))?/g, '').match(/\.[\w-]+/g) || []); };
  // Every rule of a sheet, @media flattened: [selector, declarations].
  const rulesOf = (css) => { const out = []; noComments(css).replace(/@(?:media|supports)[^{]*\{/g, '').replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { if (!/^\s*(@|from|to|\d+%)/.test(sel)) splitTop(sel).forEach((s) => out.push([s, body])); return m; }); return out; };

  t.section('9f: the specificity reader agrees with the cascade on the selectors that matter here');
  {
    eq(spec('.class-card[data-ct]'), [0, 2], 'the shared card root');
    eq(spec(':is([data-theme="light"], [data-theme="cloud"], [data-theme="linen"]) .my-booking-card.is-booked'), [0, 3], ':is() counts as its most specific argument — this is the rule that leaked');
    eq(spec('#tab-bookings .my-booking-card'), [1, 1], 'an id outranks any number of classes');
    eq(spec(':where(.a, .b) .c'), [0, 1], ':where() adds nothing');
    eq(subjectClasses(':is([data-theme="cloud"]) .mb-past .class-card'), ['.class-card'], 'the subject is the LAST compound');
  }

  t.section('9f: no older sheet outranks the shared card root on what it paints (the tint must survive in every theme)');
  {
    // What `.class-card[data-ct]` owns. A bare border-COLOUR is left out: the root says border: 0, so it has nothing to paint.
    const OWNED = /(?:^|;)\s*(background(?:-color)?|color|border-radius|box-shadow|border(?:-(?:left|right|top|bottom))?)\s*:/;
    const leaks = [];
    OLDER.forEach((f) => rulesOf(t.readSource('css/' + f)).forEach(([sel, body]) => {
      const subj = subjectClasses(sel);
      if (subj.indexOf('.class-card') === -1 && subj.indexOf('.my-booking-card') === -1) return;
      if (/::/.test(sel)) return;
      const sp = spec(sel);
      if (sp[0] === 0 && sp[1] <= 2) return; // ties go to css/crisp.css: it is linked last
      if (!OWNED.test(body)) return;
      // A pointer state may drop a shadow (the saved copy never lifts) — it may not repaint the surface.
      if (/:(hover|active)/.test(sel) && !/(?:^|;)\s*(background(?:-color)?|color|border-radius)\s*:/.test(body)) return;
      leaks.push(f + ': ' + sel);
    }));
    eq(leaks, [], 'nothing in the older sheets beats .class-card[data-ct] (0,2,0) on its surface, ink, radius, border or shadow');
    const themeCss = noComments(t.readSource('css/theme.css'));
    ok(!/\.my-booking-card\.is-booked\s*\{/.test(themeCss) && !/\.mb-past \.class-card\s*\{/.test(themeCss),
      'the two light-base rules that washed the tint out of booked / past cards on Cloud and Linen are gone — not overridden');
  }

  t.section('9f: what the card shares is said once; My Bookings adds only its own');
  {
    ok(/\.class-card\[data-ct\]\.is-booked:not\(\.my-booking-card\),\s*\.class-card\[data-ct\]\.glow-mine-card \{/.test(s9b), 'ONE glow recipe, two triggers — Discover\'s .is-booked and My Bookings\' NEXT seat');
    eq((crispAll.match(/var\(--glow-edge\) var\(--ct-base\), var\(--glow-drop-card\) var\(--ct-drop\)/g) || []).length, 2, 'the card glow is written twice in all of crisp.css: the .glow-mine-card primitive and the shared card rule — never a third copy');
    eq((noComments(crispAll).match(/\.is-waitlisted \{ border: var\(--hairline\) dashed var\(--ct-base\); \}/g) || []).length, 1, 'the dashed waitlist place: once');
    ok(!/\.class-card(?![\w-])/.test(s9d), 'crisp:9d-bookings never names .class-card: the shared card is 9b.7\'s to style');
    ok(/#tab-bookings \.my-booking-card \.cc-loc \{[^}]*white-space: normal;[^}]*color: inherit;/.test(s9d),
      'its one meta-line override: the longer "Location · Studio" unit may break INSIDE, and keeps the line\'s guaranteed ink over the legacy .class-location\'s --text-faint');
    // Both wearers print the same meta line.
    const app = t.readSource('js/app.js');
    eq((app.match(/<span class="cc-sub">|class="class-instructor cc-sub mb-meta"/g) || []).length, 3, 'eventCard, renderMyBookings and the saved copy all print the shared .cc-sub line');
    ok(app.indexOf('mb-sep') === -1 && app.indexOf('mb-instr') === -1, 'no in-text separator is left anywhere (css draws the "·" and clips it on a wrap)');
  }

  t.section('9f: ONE time block and ONE title row — Discover, My Bookings, the saved copy and the Class colours preview');
  {
    // The same class used to read differently on Discover and on My Bookings (and its text started
    // 14px further right): two builders, each pinned by its own suite. Since wave 10 the ONE builder
    // prints 24-hour time ("18:30") over the duration alone — the approved boards' form.
    const app = t.readSource('js/app.js');
    const ct = t.loadPure('js/app.js', 'class-type', { getCategory: () => null });
    eq(ct._ccTimeHTML({ hours: 18, mins: 30, duration: 45 }), '<div class="cc-time"><span class="cc-time-h">18:30</span><span class="cc-dur">45 min</span></div>',
      '_ccTimeHTML: the 24-hour time in the display face over ONE small line — the duration alone');
    eq(ct._ccTimeHTML({ hours: 18, mins: 30, duration: 45, dayHtml: 'Thu 24', hook: 'mb-when' }),
      '<div class="cc-time mb-when"><span class="mb-day">Thu 24</span><span class="cc-time-h">18:30</span><span class="cc-dur">45 min</span></div>',
      'a held class: the SAME block, led by its day, with its wearer\'s layout hook');
    eq([ct._ccTimeHTML({ hours: 0, mins: '05' }), ct._ccTimeHTML({ hours: 12, mins: 0, duration: 0 }), ct._ccTimeHTML({ hours: '7', mins: '5', duration: '50' })].map((h) => h.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')),
      ['|00:05|', '|12:00|', '|07:05|50 min|'], 'five past midnight is 00:05, noon 12:00; hours and minutes are two digits; no duration → the time alone; numbers may arrive as strings');
    eq([ct._ccTimeHTML({ hours: NaN, mins: NaN, duration: 45 }), ct._ccTimeHTML(), ct._ccTimeHTML({ hours: 25, mins: 61 })].map((h) => h.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')),
      ['|--:--|45 min|', '|--:--|', '|--:--|'], 'a time nobody can read is dashes — never "NaN:NaN", never a made-up time');
    ok(ct._ccTimeHTML({ hours: '18"><img src=x>', mins: '<b>', duration: '<i>', hook: 'mb-when"><script>' }).indexOf('<img') === -1 &&
      !/<b>|<i>|<script/.test(ct._ccTimeHTML({ hours: '18"><img src=x>', mins: '<b>', duration: '<i>', hook: 'mb-when"><script>' })),
      'only numbers (and a hook reduced to class-name characters) reach the markup; dayHtml is the caller\'s to escape');
    const fn = (opener, closer) => { const lines = app.split('\n'); const from = lines.findIndex((l) => l.startsWith(opener)); const to = lines.findIndex((l, i) => i > from && l === (closer || '}')); return from === -1 || to === -1 ? '' : lines.slice(from, to + 1).join('\n'); };
    const builders = { eventCard: fn('function eventCard('), renderMyBookings: fn('function renderMyBookings('), saved: fn('function _savedBookingsHTML(') };
    Object.keys(builders).forEach((name) => {
      const src = builders[name];
      ok(src !== '' && /_ccTimeHTML\(\{ hours/.test(src), name + ' prints the time through _ccTimeHTML');
      ok(!/cc-time-h|cc-ampm|cc-dur|class-time-ampm|mb-time|mb-dur|class="class-time/.test(src.replace(/^\s*\/\/.*$/gm, '')), name + ' builds no time markup of its own');
    });
    ok(/_ccTimeHTML\(\{ hours: dt\.getHours\(\), mins: dt\.getMinutes\(\), duration: evt\.duration \}\)/.test(builders.eventCard) &&
      /_ccTimeHTML\(\{ hours: dt\.getHours\(\), mins: dt\.getMinutes\(\), duration: evt\.duration, dayHtml: dayLabel, hook: 'mb-when' \}\)/.test(builders.renderMyBookings),
      'Discover and My Bookings hand it the same reading of the same class — My Bookings adds its day and its grid hook, nothing else');
    ok(/typeof _ccTimeHTML === 'function' \? _ccTimeHTML\(\{ hours: 18, mins: 30, duration: 45 \}\) : ''/.test(t.readSource('js/tabs.js')), 'the Class colours preview prints the same block');
    // The title row: tile + name, the name INLINE after the tile (a long name wraps the same way on both tabs).
    const title = (src) => (/<(?:span|div) class="cc-head[^"]*">\$\{[^}]+\}<span class="cc-name[^"]*"/.exec(src.replace(/<span class="ct-tile" aria-hidden="true">\$\{classPictogram\(ct, 18\)\}<\/span>/, '${tile}')) || [''])[0].replace(/ (mb-title|mb-name)/g, '').replace(/^<(span|div)/, '<x').replace(/\$\{[^}]+\}/, '${tile}');
    eq([title(builders.renderMyBookings), title(builders.saved)], [title(builders.eventCard), title(builders.eventCard)], 'the same title row in all three (hooks aside): ' + title(builders.eventCard));
    ok(title(builders.eventCard) !== '', '…and it was found');
    ok(!/class-type mb-title|t-title mb-name/.test(app), 'the legacy .class-type / .t-title on the held card\'s title are gone: they sized its line box differently from Discover\'s');
    // crisp:9d-bookings says only what a held class ADDS to those two parts.
    const rule = (sel) => (new RegExp(sel.replace(/[.#[\]]/g, '\\$&') + ' \\{([^}]*)\\}').exec(s9d) || [])[1];
    eq((rule('#tab-bookings .my-booking-card .mb-when') || '').trim(), 'grid-column: 1;', '.mb-when: its grid column — size, ink and order are 9b.7\'s .cc-time');
    eq((rule('#tab-bookings .my-booking-card .mb-title') || '').replace(/\s+/g, ' ').trim(), 'margin: 0; padding-right: calc(var(--tap-min) - var(--space-2));', '.mb-title: room for the More button — no display:flex (the tile sat BESIDE a wrapped name here, UNDER it on Discover)');
    ok(!/\.mb-time|\.mb-dur|\.class-time-ampm \{|--mb-when/.test(s9d.replace(/#usualWeek(Card|Sheet)[^{]*\{[^}]*\}/g, '')), 'no second set of time rules, and no time-column token, is left in crisp:9d-bookings');
    ok(/\.class-card\[data-ct\] \.cc-head \{ display: block; min-width: 0; \}/.test(s9b) && /\.class-card\[data-ct\] \.cc-time \{[^}]*min-width: 2\.4em;/.test(s9b), 'both are styled once, in 9b.7');
  }

  t.section('9f: the tab hero has ONE look, keyed on its host class — a fourth host cannot be missed');
  {
    // Bookings kept the pre-Crisp hero (UPPERCASE 29px title, a 36px button in the browser's own face)
    // because the Crisp rules named #statsEmpty and #membershipSignin only.
    const tabs = t.readSource('js/tabs.js');
    const hosts = [];
    tabs.replace(/(\w+)\.className = 'tab-empty';/g, (m, v) => { const id = new RegExp(v + "\\.id = '([\\w-]+)';").exec(tabs); if (id) hosts.push(id[1]); return m; });
    tabs.replace(/<div id="([\w-]+)" class="tab-empty"/g, (m, id) => { hosts.push(id); return m; });
    eq(hosts.sort(), ['bookingsEmpty', 'membershipSignin', 'statsEmpty'], 'every hero host js/tabs.js creates carries the class .tab-empty');
    ['.tab-empty .tab-empty-title', '.tab-empty .tab-empty-sub', '.tab-empty .tab-empty-btn'].forEach((sel) => ok(new RegExp('\\n' + sel.replace(/\./g, '\\.') + ' \\{').test(s9e), sel + ' is restyled by host CLASS'));
    ok(/\.tab-empty \.tab-empty-title \{[^}]*text-transform: none;/.test(s9e) && /\.tab-empty \.tab-empty-btn \{[^}]*min-height: var\(--tap-lg\);[^}]*text-transform: none;/.test(s9e) &&
      /\.tab-empty \.tab-empty-btn \{ font-family: var\(--font-body\); \}/.test(s9e.replace(/[^{}]*,\s*(?=\.tab-empty \.tab-empty-btn \{ font-family)/, '')),
      'sentence case, a --tap-lg button, in the body face (a <button> does not inherit the page\'s)');
    ok(!/#(statsEmpty|membershipSignin|bookingsEmpty) \.tab-empty-/.test(crispAll.replace(/\/\*[\s\S]*?\*\//g, '')), 'no hero rule is scoped to a host id any more');
    ok(/#tab-bookings \.rebook-hint-btn \{[^}]*font-family: var\(--font-body\);/.test(s9d), '"Find it" (the Book again? hint) names its face too');
  }

  t.section('9f: the rank tile has ONE look (9e.5); a card only says where it sits');
  {
    const recolours = (css) => rulesOf(css).filter(([sel, body]) => /\.tier-(?:badge|[SABCDF])(?![\w-])/.test(sel) && /(?:^|;)\s*(background|color|box-shadow|font-[\w-]+|border-radius)\s*:/.test(body)).map((r) => r[0]);
    eq(recolours(s9b), [], 'crisp:9b-discover does not re-colour or re-shape it');
    eq(recolours(s9d), [], 'crisp:9d-bookings does not either');
    ok(/\.class-card\[data-ct\] \.tier-badge \{ flex: none; margin-left: var\(--space-1\); vertical-align: middle; \}/.test(s9b), 'on a card: placement only');
    ok(/\.tier-badge\.tier-S,[^{]*\{[^}]*background: var\(--rank-fill\);[^}]*color: var\(--rank-ink\);/.test(s9e), 'the look: the neutral --rank-* recipe');
    // D / F on a tinted card read in --text-muted: that must BE a guaranteed card ink.
    ok(/\.tier-D, \.active-D \{[^}]*--rank-ink: var\(--text-muted\);/.test(s9e) && /--ct-ink-2: var\(--text-muted\);/.test(noComments(crispAll)),
      'the quiet tiers\' ink on a tint is --text-muted = --ct-ink-2, a pair the 9a contrast matrix holds on every swatch');
  }

  t.section('9f: the rank CONTROL (★ + S–F) has ONE look, keyed on its own classes — a second host cannot be missed');
  {
    // Membership's rows and the instructor profile print the same buttons. The Crisp tiles were
    // scoped to #tab-membership, so the profile kept settings.css's 28×24px boxes, 10px type and
    // theme.css's hex outline.
    const printed = (src) => ['tier-fav', 'tier-btns', 'tier-btn'].filter((c) => new RegExp('class="' + c + '[\'"$ ]').test(src));
    eq([printed(t.readSource('js/settings.js')), printed(t.readSource('js/features.js'))], [['tier-fav', 'tier-btns', 'tier-btn'], ['tier-fav', 'tier-btns', 'tier-btn']], 'both hosts print .tier-fav, .tier-btns and .tier-btn');
    const crispRules = rulesOf(crispAll);
    const control = crispRules.filter(([sel]) => { const subj = subjectClasses(sel); return subj.indexOf('.tier-btn') !== -1 || subj.indexOf('.tier-fav') !== -1; });
    const scoped = control.map((r) => r[0]).filter((sel) => spec(sel)[0] !== 0 || /\.instructor-|\.tier-row/.test(sel));
    ok(control.length >= 4 && scoped.length === 0, 'no rule about a rank button or the star is scoped to a host (an id, .tier-row or .instructor-*)' + (scoped.length ? ': ' + scoped.join(' · ') : ''));
    const hosted = crispRules.filter(([sel]) => subjectClasses(sel).indexOf('.tier-btns') !== -1 && sel.trim() !== '.tier-btns');
    ok(hosted.length > 0 && hosted.every(([, body]) => /^\s*flex:[^;]+;\s*$/.test(body)), 'a host only says how much of its row the six tiles take (flex) — the grid is the control\'s');
    // Every declaration 9e makes for exactly this selector (".tier-btn" is also in the shared button-face list).
    const body = (sel) => rulesOf(s9e).filter((r) => r[0] === sel).map((r) => r[1]).join(';');
    ok(/height:\s*calc\(var\(--tap-min\) - var\(--space-2\)\);/.test(body('.tier-btn')) && /border:\s*0;/.test(body('.tier-btn')) && /border-radius:\s*var\(--radius-lg\);/.test(body('.tier-btn')) &&
      /box-shadow:\s*inset 0 0 0 var\(--hairline\) var\(--line\);/.test(body('.tier-btn')) && /font-family:\s*var\(--font-display\);/.test(body('.tier-btn')) && /font-size:\s*var\(--text-lg\);/.test(body('.tier-btn')),
      'the tile: round-cornered, an inset hairline from --line (no border, no hex), the display face at --text-lg');
    ok(/display:\s*grid;\s*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);\s*gap:\s*var\(--space-2\);/.test(body('.tier-btns')), 'six equal columns, --space-2 apart');
    // The hit area: up and down to --tap-min, sideways half-way into the gap — neighbours meet, never overlap.
    ok(/inset:\s*calc\(var\(--space-1\) \* -0\.75\) calc\(var\(--space-2\) \* -0\.5\);/.test(body('.tier-btn::after')), 'the hit area reaches 0.75 × --space-1 up and down, and half the grid gap to either side');
    const tok = {};
    noComments(t.readSource('css/theme.css')).replace(/\n\s*(--(?:space-[12]|tap-min))\s*:\s*([\d.]+)px;/g, (m, k, v) => { if (!(k in tok)) tok[k] = Number(v); return m; });
    eq((tok['--tap-min'] - tok['--space-2']) + 2 * 0.75 * tok['--space-1'], tok['--tap-min'], '…which makes it exactly --tap-min tall (' + tok['--tap-min'] + 'px)');
    ok(/width:\s*var\(--tap-min\);\s*height:\s*var\(--tap-min\);/.test(body('.tier-fav')) && /\.tier-btn:focus-visible, \.tier-fav:focus-visible \{ outline: var\(--focus-ring\);/.test(s9e), 'the star is a --tap-min box; both show the body-ink focus ring');
    // At (0,1,0) the tile must not be out-ranked by an older sheet on what it paints. (A chosen rank is 9e.5's
    // ".tier-btn.active-*", (0,2,0); the pointer states are held in the next section.)
    const PAINTS = /(?:^|;)\s*(background(?:-color)?|color|border(?:-color)?|border-radius|box-shadow|width|height|font(?:-[\w-]+)?)\s*:/;
    const beaten = [];
    OLDER.forEach((f) => rulesOf(t.readSource('css/' + f)).forEach(([sel, decl]) => {
      if (subjectClasses(sel).indexOf('.tier-btn') === -1 || /:(hover|active|focus)/.test(sel)) return;
      const sp = spec(sel);
      if ((sp[0] > 0 || sp[1] > 1) && PAINTS.test(decl)) beaten.push(f + ': ' + sel);
    }));
    eq(beaten, [], 'no older sheet outranks ".tier-btn" on its size, ink, outline or face (theme.css\'s light-base #ccc rule is gone — not overridden)');
    ok(!/#tab-membership \.tier-btn\.active-/.test(noComments(crispAll)), 'the id-scoped copy of the chosen-rank fill is gone: 9e.5\'s ".tier-btn.active-*" outranks the bare tile on its own');
  }

  t.section('9f: the other old-rule leaks the merge found stay closed');
  {
    // A chosen rank under the pointer. theme.css's light-base ".tier-btn:hover" is (0,3,0).
    const lightHover = rulesOf(t.readSource('css/theme.css')).filter(([sel]) => /\.tier-btn:hover$/.test(sel)).map(([sel]) => spec(sel));
    ok(lightHover.length > 0 && lightHover.every((sp) => sp[0] === 0 && sp[1] <= 3), 'the older hover rule is still there, at most (0,3,0)…');
    const held = rulesOf(s9e).filter(([sel, body]) => /^\.tier-btn\.active-[SABCDF]:hover$/.test(sel) && /color: var\(--rank-ink\)/.test(body));
    eq(held.map((r) => r[0]).sort(), ['S', 'A', 'B', 'C', 'D', 'F'].map((x) => '.tier-btn.active-' + x + ':hover').sort(),
      '…so every chosen rank re-states its ink on :hover at (0,3,0) (it read 1.6:1 on the S tile, and on iOS :hover sticks after the tap that chose it)');
    ok(held.every(([sel]) => { const sp = spec(sel); return sp[0] === 0 && sp[1] === 3; }), 'a tie — css/crisp.css is linked last, so it wins');
    ok(!/\.explore-tier-bar\s*\{[^}]*background:\s*#/.test(noComments(t.readSource('css/theme.css'))) && /\.explore-tier-bar \{[^}]*background: none;/.test(s9e),
      'the tier bar has no track: the light-base hex track that outranked "background: none" is gone');
  }

  t.section('9f: one prefix, two meanings — ".cc-" is the class CARD (9b) and the class COLOURS control (9e)');
  {
    // Two lanes picked the same prefix in parallel. Nothing collides today; this keeps it so
    // until one of them is renamed (the older sheets style several bare .cc-* card parts, unscoped).
    const names = (css) => Array.from(new Set(css.match(/\.cc-[\w-]+/g) || [])).sort();
    const card = names(s9b), control = names(s9e);
    const older = names(OLDER.map((f) => noComments(t.readSource('css/' + f))).join('\n'));
    ok(card.indexOf('.cc-sub') !== -1 && control.indexOf('.cc-swatch') !== -1, 'both families were found');
    eq(control.filter((n) => card.indexOf(n) !== -1), [], 'the control reuses no class-card part name');
    eq(control.filter((n) => older.indexOf(n) !== -1), [], '…and none the older sheets style (redesign.css paints bare .cc-name / .cc-time / .cc-meta)');
  }

  t.section('9f: the two small handoffs taken at integration');
  {
    const settings = t.readSource('js/settings.js');
    const defs = settings.match(/'<span class="tier-badge tier-' \+ tier \+ '"[^;]*;/g) || [];
    eq(defs.length, 2, 'both tierBadgeHTML definitions found (the second is the one that wins)');
    ok(defs.every((d) => /role="img" aria-label="Ranked ' \+ tier \+ '"/.test(d)), 'the rank tile SAYS what it is ("Ranked S") — a bare letter after the instructor\'s name told a screen reader nothing; both definitions in step');
    ok(/TIERS\.indexOf\(tier\) !== -1 \? '<span class="tier-badge/.test(settings) && /TIERS\.indexOf\(tier\) === -1\) return '';/.test(settings), '…and only a checked tier letter ever reaches the attribute');
    const app = t.readSource('js/app.js');
    ok(/stepDiscoverDay\(r\.dir, 'swipe'\)\) \{ if \(typeof window\.haptic === 'function'\) window\.haptic\('tap'\); return; \}/.test(app),
      'a swipe that really changed the day gives one light tick — typeof-guarded, and only on stepDiscoverDay\'s success (never at an edge or mid-search)');
    ok(/case 'tap':\s*Haptics\.impact\(\{ style: 'LIGHT' \}\)/.test(t.readSource('ios-app/www/native-bridge.js')), '"tap" is the LIGHT impact in the iOS app');
  }
};
