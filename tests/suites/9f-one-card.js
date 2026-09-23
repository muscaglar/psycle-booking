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
// Also held here: the other old-rule leaks the integration found, the one
// canonical guard that no grade is left on a person, and the swipe tick.
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
    // The title row: tile + name, the name INLINE after the tile (a long name wraps the same way on both tabs).
    const title = (src) => (/<(?:span|div) class="cc-head[^"]*">\$\{[^}]+\}<span class="cc-name[^"]*"/.exec(src.replace(/<span class="ct-tile" aria-hidden="true">\$\{classPictogram\(ct, 18\)\}<\/span>/, '${tile}')) || [''])[0].replace(/ (mb-title|mb-name)/g, '').replace(/^<(span|div)/, '<x').replace(/\$\{[^}]+\}/, '${tile}');
    eq([title(builders.renderMyBookings), title(builders.saved)], [title(builders.eventCard), title(builders.eventCard)], 'the same title row in all three (hooks aside): ' + title(builders.eventCard));
    ok(title(builders.eventCard) !== '', '…and it was found');
    ok(!/class-type mb-title|t-title mb-name/.test(app), 'the legacy .class-type / .t-title on the held card\'s title are gone: they sized its line box differently from Discover\'s');
    // crisp:9d-bookings says only what a held class ADDS to those two parts.
    const rule = (sel) => (new RegExp(sel.replace(/[.#[\]]/g, '\\$&') + ' \\{([^}]*)\\}').exec(s9d) || [])[1];
    eq((rule('#tab-bookings .my-booking-card .mb-when') || '').trim(), 'grid-column: 1;', '.mb-when: its grid column — size, ink and order are 9b.7\'s .cc-time');
    eq((rule('#tab-bookings .my-booking-card .mb-title') || '').replace(/\s+/g, ' ').trim(), 'margin: 0; padding-right: calc(var(--tap-min) - var(--space-2));', '.mb-title: room for the More button — no display:flex (the tile sat BESIDE a wrapped name here, UNDER it on Discover)');
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

  t.section('9f: the favourite STAR has ONE look, keyed on its own class — and it is the only mark on an instructor');
  {
    // Membership's rows and the instructor profile print the same star. (They also printed six grade buttons,
    // S to F, and a grade tile rode after an instructor's name on every card: retired in September 2026.)
    const prints = (src) => /class="favs-star[$'" ]/.test(src);
    eq([prints(t.readSource('js/settings.js')), prints(t.readSource('js/features.js'))], [true, true], 'both hosts print .favs-star');
    const crispRules = rulesOf(crispAll);
    const star = crispRules.filter(([sel]) => subjectClasses(sel).indexOf('.favs-star') !== -1);
    const scoped = star.map((r) => r[0]).filter((sel) => spec(sel)[0] !== 0 || /\.instructor-|\.favs-row/.test(sel));
    ok(star.length >= 2 && scoped.length === 0, 'no rule about the star is scoped to a host (an id, .favs-row or .instructor-*)' + (scoped.length ? ': ' + scoped.join(' · ') : ''));
    const body = (sel) => rulesOf(s9e).filter((r) => r[0] === sel).map((r) => r[1]).join(';');
    ok(/width:\s*var\(--tap-min\);\s*height:\s*var\(--tap-min\);/.test(body('.favs-star')) && /\.favs-star:focus-visible \{ outline: var\(--focus-ring\);/.test(s9e), 'the star is a --tap-min box with the body-ink focus ring');
    const gone = /\.tier-|\.active-[SABCDF]\b|--rank-|explore-tier|explore-unranked/;
    const sheets = ['styles.css', 'theme.css', 'features.css', 'tabs.css', 'settings.css', 'explore.css', 'redesign.css', 'discover-layout-fix.css', 'crisp.css'];
    eq(sheets.filter((f) => gone.test(noComments(t.readSource('css/' + f)))), [], 'no sheet keeps a rule, a class or a token of the grades');
    const shipped = ['js/app.js', 'js/settings.js', 'js/features.js', 'js/explore.js', 'js/tabs.js', 'js/interactions.js', 'psycle-finder.html'];
    eq(shipped.filter((f) => /tierBadgeHTML|setInstructorTier|getInstructorTier|tier-badge|tier-btn|applyTierFilter|tierBtn|_topTierInstructorIds|explore-unranked|explore-tier|_explore_openSettingsForInstructor|tierColors|tierKeys|instructor-rank/.test(t.readSource(f))), [], '…and nothing shipped prints or sets one');
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
    const app = t.readSource('js/app.js');
    ok(/stepDiscoverDay\(r\.dir, 'swipe'\)\) \{ if \(typeof window\.haptic === 'function'\) window\.haptic\('tap'\); return; \}/.test(app),
      'a swipe that really changed the day gives one light tick — typeof-guarded, and only on stepDiscoverDay\'s success (never at an edge or mid-search)');
    ok(/case 'tap':\s*Haptics\.impact\(\{ style: 'LIGHT' \}\)/.test(t.readSource('ios-app/www/native-bridge.js')), '"tap" is the LIGHT impact in the iOS app');
  }
};
