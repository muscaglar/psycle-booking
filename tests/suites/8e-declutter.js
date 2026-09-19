'use strict';
// Wave 8 (8e) — "Remove bloat and pointless copy".
// A product designer's example was the line under YOU MIGHT LIKE: "Matched on
// your taste, your usual times & what's bookable". It explains the machinery
// and nobody needs it. The rule this suite holds the app to:
//   · no subtitle that restates its heading or says how something is computed,
//   · no instruction for an obvious affordance, no filler adjectives, no "!",
//   · a deleted element takes its CSS rule with it (and nothing is left
//     pointing at a class that no longer has one),
//   · and the lines a member WOULD miss stay word for word: money, credits,
//     the late-cancel window, waitlist rules, what a calendar hand-over deletes,
//     what a queued / imported / signed-out action does, the affiliation line.
// Where it is cheap the SHIPPED render function is run and its output read,
// rather than its source matched.
module.exports = function (t) {
  const { ok, eq } = t;
  const read = (rel) => t.readSource(rel);
  // Code only: the reason a line went is written down in a comment beside it.
  const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const app = code(read('js/app.js'));
  const tabsSrc = read('js/tabs.js');
  const tabs = code(tabsSrc);
  const explore = code(read('js/explore.js'));
  const features = code(read('js/features.js'));
  const settings = code(read('js/settings.js'));
  const page = read('psycle-finder.html');
  const grab = (src, opener, closer) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    if (from === -1) throw new Error('8e-declutter suite: cannot find "' + opener + '" (anchor moved?)');
    const to = lines.findIndex((l, i) => i > from && l === closer);
    if (to === -1) throw new Error('8e-declutter suite: unterminated "' + opener + '"');
    return lines.slice(from, to + 1).join('\n');
  };
  const text = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const fixedDate = (fixed) => class extends Date { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };

  // ── 1. The lines that went ─────────────────────────────────────────────
  t.section('Declutter: subtitles that restate a heading or explain the machinery are gone');
  [
    [explore, /Matched on your taste/, 'explore.js "You might like": how the match is computed (the designer\'s example)'],
    [explore, /Instructors you haven\\?'t booked with yet/, 'explore.js "New to you": restated the heading'],
    [explore, /Import all past bookings from your Psycle account/, 'explore.js sync banner: said "Sync your … booking history" twice'],
    [explore, /help us find instructors/, 'explore.js "You might like" empty state: explained the matcher'],
    [tabs, /Instructors you used to book regularly/, 'tabs.js "Lapsed favourites": restated the heading'],
    [tabs, /Unique instructors per month/, 'tabs.js variety chart: the unit is in the heading now'],
    [tabs, /Tap to see that day/, 'tabs.js "Your usual slots": instruction for a button that says "Find this week"'],
    [tabs, /Best run of weeks/, 'tabs.js streak card: restated "Longest streak"'],
    [tabs, /Prefer or avoid spots, per studio|Add bookings to your calendar/, 'tabs.js Membership rows: restated "Bike / spot preferences" and "Calendar sync"'],
    [tabs, /unlock stats, heatmaps/, 'tabs.js signed-out Stats hero: a feature list to "unlock"'],
    [settings, /useful when something looks broken/, 'settings.js Diagnostics: explained the button under it'],
    [settings, /Calendar Sync \(iOS\)/, 'settings.js: "(iOS)" on a section that only exists in the iOS app'],
    [app, /get the most out of your experience/, 'app.js history-sync prompt: subtitle'],
    [app, /unlock personalised insights/, 'app.js history-sync prompt: feature list'],
    [app, /it'll show up here/, 'app.js "Nothing booked — yet": the line under it'],
    [features, /Book a class and it will appear here/, 'features.js empty history: second sentence'],
    [page, /or jump straight in/, 'psycle-finder.html Discover first paint: lead-in to three buttons'],
  ].forEach(([src, re, what]) => ok(!re.test(src), 'gone — ' + what));

  t.section('Declutter: no exclamation marks, filler or decorative emoji in headings, hints and empty states');
  [
    [tabs, /Keep it alive|Century club|incredible|Book your first class!/, 'tabs.js: streak / cost-tracker cheerleading'],
    [tabs, /story starts here/, 'tabs.js: "Your training story starts here"'],
    [explore, /impressive range/, 'explore.js: "— impressive range!"'],
    [app, /id="syncPromptTitle">Welcome/, 'app.js: a second "Welcome, <name>!" after the first-run welcome'],
    [app, /No problem —/, 'app.js: "No problem — " in front of where Sync lives'],
    [app, /Copied to clipboard!/, 'app.js: "Copied to clipboard!"'],
    [settings, /Copied to clipboard!/, 'settings.js: "Copied to clipboard!"'],
    [features, /Spot Available!|'Spot opened! '/, 'features.js browser notification: two "!" saying one thing'],
    [page, /⚠️ Your session has expired/, 'psycle-finder.html: emoji in front of the session banner'],
  ].forEach(([src, re, what]) => ok(!re.test(src), 'gone — ' + what));
  ok(/new Notification\('Spot opened', \{/.test(features) && !/new Notification\('Psycle/.test(features),
    'the browser notification wears the in-app dialog\'s title — and no longer calls this app "Psycle"');
  ok(/<span>Your session has expired\.<\/span>/.test(page) && /announce\('Your session has expired\. Sign in again to carry on\.', true\)/.test(app),
    'the session banner keeps its words (and what a screen reader is told is untouched)');

  // ── 2. CSS follows the markup ──────────────────────────────────────────
  t.section('Declutter: a deleted element takes its CSS rule with it');
  {
    const cssDir = t.path.join(t.REPO_ROOT, 'css');
    const cssFiles = t.fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'));
    const jsFiles = t.fs.readdirSync(t.JS_DIR).filter((f) => f.endsWith('.js'));
    ok(cssFiles.length >= 8 && jsFiles.length >= 15, 'found the stylesheets and modules (' + cssFiles.length + ' / ' + jsFiles.length + ')');
    ['explore-subtitle', 'insights-subtitle', 'habit-subtitle', 'diag-section-hint'].forEach((cls) => {
      const users = cssFiles.map((f) => 'css/' + f).concat(jsFiles.map((f) => 'js/' + f), ['psycle-finder.html'])
        .filter((rel) => read(rel).indexOf(cls) !== -1);
      eq(users, [], '.' + cls + ': no markup, no rule');
    });
    // The other way round: what is still printed still has its rule.
    const tabsCss = read('css/tabs.css');
    ok(/\n\.streak-hint \{/.test(tabsCss) && /class="streak-hint"/.test(tabs), '.streak-hint stays — "N to M" still uses it');
    ok(/\n\.cost-hint \{/.test(tabsCss) && /class="cost-hint"/.test(tabs), '.cost-hint stays — plan name, days to go and "If you use all N" still use it');
    ok(/\n\.discover-empty-sub \{/.test(read('css/styles.css')) && /class="discover-empty-sub"/.test(page), '.discover-empty-sub stays — the signed-out line still uses it');
    ok(/\.ms-row-sub \{/.test(read('css/redesign.css')) && (tabs.match(/class="ms-row-sub"/g) || []).length === 2,
      '.ms-row-sub stays for the two rows that list what is inside (Reminders, Data & privacy)');
    // Spacing the deleted lines used to provide.
    const habitTitle = (tabsCss.match(/\n\.habit-title \{[^}]*\}/) || [''])[0];
    ok(/margin-bottom: var\(--space-5\);/.test(habitTitle), '.habit-title carries the gap to the cards itself (it was 4px above a subtitle)');
    ok(/\n\.tab-empty-title \+ \.tab-empty-btn \{ margin-top: var\(--space-3\); \}/.test(tabsCss), 'a hero with no sub line keeps title → button at the usual 20px (tokens only)');
    ok(/\n\.discover-quick-actions \{[^}]*margin-top: var\(--space-3\);/.test(read('css/styles.css')), 'Discover\'s quick actions sit the same distance under their title');
  }

  // ── 3. The shipped Stats cards, rendered ───────────────────────────────
  t.section('Declutter: streak cards say numbers, not cheers');
  {
    const NOW = new Date(2026, 8, 18, 12, 0, 0).getTime(); // Friday
    const streaks = (history) => {
      const box = { style: {}, innerHTML: '' };
      const ctx = t.vm.createContext({
        console, Object, Math, Number, String, isNaN, Date: fixedDate(NOW),
        document: { getElementById: (id) => (id === 'streakSection' ? box : null) },
        getFullHistory: () => history,
      });
      // Wave 9: the streak block draws its weekly bars through pure:stats-charts.
      const charts = tabsSrc.slice(tabsSrc.indexOf('  // ── pure:stats-charts:start'), tabsSrc.indexOf('  // ── pure:stats-charts:end'));
      ok(charts.length > 0, 'pure:stats-charts found in js/tabs.js (anchor moved?)');
      t.vm.runInContext(charts + '\n' + grab(tabsSrc, '  function _weekIndex(', '  }') + '\n' + grab(tabsSrc, '  function renderStreaks() {', '  }'), ctx, { filename: 'js/tabs.js[streaks]' });
      ctx.renderStreaks();
      return box;
    };
    const weekly = (n) => Array.from({ length: n }, (_, i) => {
      const d = new Date(NOW - i * 7 * 86400000);
      return { eventId: String(i), date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' 07:00:00' };
    });
    const hints = (html) => { const out = []; html.replace(/<div class="streak-hint">([^<]*)<\/div>/g, (m, s) => { out.push(s); return m; }); return out; };

    let box = streaks(weekly(3));
    eq(hints(box.innerHTML), ['7 to 10'], 'three weeks running: ONE hint, and it is a number (it read "Keep it alive!" · "Best run of weeks" · "7 to 10")');
    ok(/streak-live/.test(box.innerHTML) && /<div class="streak-value">3<\/div><div class="streak-text"><div class="streak-label">week streak<\/div>/.test(box.innerHTML),
      'the live streak is still marked — by the card, not by a sentence');
    ok(!/!/.test(text(box.innerHTML)), 'no exclamation mark anywhere in the section');
    // Wave 9 (the Stats board): one block — the streak, "Longest N", twelve
    // weekly bars (no text) — then the milestones with their unit said once.
    eq(text(box.innerHTML).replace(/\d+/g, '#'), '# week streak Longest # # # # # classes # to #',
      'everything the section prints: the streak and its name, the longest run, four milestones, their unit once, one distance');
    eq((box.innerHTML.match(/class="streak-week[ "]/g) || []).length, 12, 'the last twelve weeks as bars');
    eq([(box.innerHTML.match(/streak-week is-on is-live/g) || []).length, /role="img" aria-label="Last 12 weeks: 3 with a class, 3 in a row now\."/.test(box.innerHTML)], [3, true],
      'three weeks running: three lit bars, and the chart says so in words');

    box = streaks(weekly(1));
    eq(hints(box.innerHTML), ['9 to 10'], 'a first class: no "Book this week to build it" under a streak of 1');
    box = streaks(weekly(120));
    eq([hints(box.innerHTML), /!|Century/.test(text(box.innerHTML)), /milestone-row/.test(box.innerHTML)], [[], false, false],
      'past the last milestone: no hint at all (it read "Century club!") — and no row of four reached badges either');
    box = streaks([]);
    eq(box.style.display, 'none', 'no history: the section still hides');
  }

  t.section('Declutter: a usual-slot card leads with the slot');
  {
    const NOW = new Date(2026, 8, 18, 12, 0, 0).getTime();
    const box = { style: {}, innerHTML: '' };
    const dayLine = tabsSrc.split('\n').find((l) => l.startsWith('  var DAY_NAMES_FULL = '));
    ok(!!dayLine, 'DAY_NAMES_FULL found (anchor moved?)');
    const ctx = t.vm.createContext({
      console, Object, Math, Number, String, isNaN, Date: fixedDate(NOW),
      document: { getElementById: (id) => (id === 'habitSection' ? box : null) },
      escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
      getCategory: (name) => (name === 'Ride 45' ? { key: 'RIDE' } : null),
      getFullHistory: () => ['2026-08-31', '2026-09-07', '2026-09-14'].map((d, i) => ({ eventId: String(i), date: d + ' 07:00:00', typeName: 'Ride 45' })),
      _clock24: t.loadPure('js/app.js', 'clock')._clock24, // the app's ONE time formatter (24-hour)
    });
    t.vm.runInContext(dayLine + '\n' + grab(tabsSrc, '  function _nextWeekdayDateStr(', '  }') + '\n' + grab(tabsSrc, '  function renderHabitSlots() {', '  }'), ctx, { filename: 'js/tabs.js[habits]' });
    ctx.renderHabitSlots();
    eq(text(box.innerHTML), 'Your usual slots Mondays ~07:00 Ride 45 3x in your history Find this week',
      'heading, slot, class, count, button — no subtitle, and no "You usually book" in front of what the heading already says');
    ok(/<button class="habit-find-btn" data-date="2026-09-21" data-cat="RIDE">Find this week<\/button>/.test(box.innerHTML), 'the button is untouched (next Monday, the category key)');
  }

  t.section('Declutter: headings and heroes');
  ok(/<div class="explore-title">You might like<\/div>';\s*html \+= '<div class="explore-grid">';/.test(explore), '"You might like": heading, then the cards');
  ok(/<div class="explore-title">New to you<\/div>';\s*html \+= '<div class="explore-grid">';/.test(explore), '"New to you": heading, then the cards');
  ok(/<div class="insights-title">Lapsed favourites<\/div>';\s*html \+= '<div class="lapsed-list">';/.test(tabs), '"Lapsed favourites": heading, then the list');
  ok(/<div class="insights-title">Instructors per month<\/div>';\s*html \+= '<div class="variety-chart">';/.test(tabs), 'the variety chart\'s heading names its unit');
  ok(/<div class="tab-empty-title">Nothing booked<br>— yet<\/div>\s*<button class="tab-empty-btn" onclick="switchTab\('discover'\)">Find a class<\/button>/.test(app),
    'My Bookings, confirmed empty: the title and the one action');
  ok(/<div class="tab-empty-title">Your stats<\/div>' \+\s*'<div class="tab-empty-sub">Sign in to see your streaks, habits and instructors\.<\/div>' \+\s*'<button class="tab-empty-btn" onclick="openLoginPopup\(\)">Sign in<\/button>/.test(tabs),
    'Stats, signed out: what is behind the sign-in, in one line');
  ok(/<div id="discoverQuickWrap">\s*<div class="discover-quick-actions">/.test(page), 'Discover first paint: the title, then the three shortcuts');
  ok(/id="syncPromptTitle">Sync your booking history\?<\/div>/.test(app) && !/class="modal-subtitle">One more step/.test(app) &&
    />Not now<\/button>' \+\s*'<button class="btn" id="syncPromptBtn" onclick="startSyncFromPrompt\(\)">Sync my history<\/button>/.test(app),
    'the history-sync prompt is headed by what it asks; "Sync my history" keeps its name');
  ok(/toast\('You can sync your history any time from the Stats tab', 'info'\)/.test(app), 'dismissing it still says where Sync lives');
  ok(/<strong>Sync your booking history<\/strong><br>' \+\s*'<span>Makes your Stats and suggestions accurate\.<\/span>/.test(explore), 'the Stats banner says it once');
  ok(/tap Re-sync to import them/.test(explore), '…and the "N past classes are not in it yet" line (an action the member must take) is untouched');

  // ── 4. What must stay ──────────────────────────────────────────────────
  t.section('Declutter: the lines a member would miss are still there, word for word');
  [
    [tabs, 'An independent companion for Psycle London members.<br>Not affiliated with, or endorsed by, Psycle.', 'the affiliation statement'],
    [tabs, 'No credits remaining — top up on psyclelondon.com to book', 'credits'],
    [tabs, "Psycle\\'s normal 12-hour cancellation policy applies to every one.", 'usual-week sheet: the cancellation policy'],
    [tabs, 'Nothing is booked until you press the button below.', 'usual-week sheet: nothing is spent by opening it'],
    [app, "Psycle's normal 12-hour cancellation policy applies.", 'booking confirms: the cancellation policy'],
    [app, 'Inside the 12-hour late-cancel window — cancelling is usually charged', 'picker: the late-cancel window'],
    [app, 'Cancellations inside 12 hours are usually charged by Psycle.', 'cancel dialog: the charge'],
    [app, 'keep a credit free so you can be booked in', 'waitlist: the credit rule'],
    [app, 'the waitlist closes 30 minutes before class', 'waitlist: when it closes'],
    [app, "You're offline — cancel queued. We'll send it when you're back online.", 'what a queued cancel will do'],
    [app, "You'll need your Psycle email and password to sign back in. Your bookings stay safe with Psycle.", 'sign-out consequences'],
    [app, "You're still signed in — we just couldn't confirm your account. Check your connection and try again.", 'an error and its recovery'],
    [settings, 'The calendar you pick becomes fully managed by Psync', 'calendar hand-over: what it means'],
    [settings, "duplicates are cleaned up automatically — and anything else in that calendar will ' +\n        'be removed.", 'calendar hand-over: what it deletes'],
    [settings, 'Choose a calendar to start syncing — nothing is added until you pick one.', 'calendar: nothing happens before a pick'],
    [settings, 'Nothing already on this device is replaced', 'import consequences'],
    [features, 'It is not held for you — book it before someone else does.', 'notify-me: a free spot is not a held one'],
  ].forEach(([src, needle, what]) => ok(src.indexOf(needle) !== -1, 'kept — ' + what));
  ok(/title = opts\.waitlist \? \(opts\.already \? 'Already on the waitlist' : 'On the waitlist!'\) : 'Booked!';/.test(app),
    'the Booked! sheet keeps its title: it is also the line announce() speaks (tests/suites/a11y.js), and the one place a "!" is earned');
  ok(/detail: blocked \? 'Tap to allow notifications' : '90 minutes before each class — opens the live countdown'/.test(tabs) &&
    /11:59 UK — a minute before the new booking week opens/.test(tabs), 'reminder rows still say WHEN they fire');
};
