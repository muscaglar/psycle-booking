# Day pager and the shared swipe helper — Discover one day at a time
Read this when you change the day strip, the pager, an empty-day state or the sideways-swipe rules (Stats and the welcome follow the same numbers). Skip it otherwise.

### Day strip and day pager
**Day pager** (js/app.js "Discover: one day at a time", css/redesign.css last block): `render()` ends in `_pagerModel = _pagerModelFor(…)` + `_paintDays(container, _pagerModel)`.

A range of MORE THAN ONE day builds `#dayStrip` (`role="tablist"`, one `role="tab"` pill per day of the range — "7 days" is seven and "14 days" fourteen: `_dateModeWindow`'s `daysAhead` counts the days AFTER the first (6 / 13, like Next week's 6) — with its matching count; a day with none stays, quieter) and `#dayPager` (`role="tabpanel"`) holding ONE `.day-group`; both live inside `#results`, the strip right after `.summary`, sticky at ≤640px only (where `.tab-content` is the scroller).

ONLY THE VISIBLE DAY'S CARDS ARE IN THE DOM — nothing may assume a card of another day exists (the class sheet books through a button of its own).

### Pager state and _pagerPickDay
State is memory-only: `window._pagerDay` / `_pagerRangeKey` / `_pagerChosen` — NOT `_discoverDay`, which is the day the DATE ROW was last checked against.

Decisions are `pure:day-pager` (`_pagerPickDay`: a new range starts on its first day; the same range keeps the day across filter taps, `_renderWindowInPlace` and streamed passes; nothing moves while results arrive; once loading is done and the member has not chosen, the first day WITH classes; a chosen day that left the range falls to the first).

### Today and Tomorrow labels
Today / Tomorrow are labelled off `localDateStr()` — the SAME clock `_applyDateQuick` builds the Today / Tomorrow presets from, so a heading can never say "Today" under a lit "Tomorrow" pill (abroad, late evening).

### Find-it shortcuts start a fresh view
A "find it" shortcut is a fresh view: `_focusSearch`, `applySavedSearch` and `applySearchPreset` set `window._pagerChosen = false` just before `search()`, so over the same range the finished render lands on the first day with a match instead of a day swiped to earlier; filter chips leave the chosen day alone.

### Changing day with showDiscoverDay
Every change goes through `showDiscoverDay(day, how)` / `stepDiscoverDay(dir, how)`: it never searches, saves or bumps `_searchSeq` — it repaints the model `render()` kept — is refused while `_discoverBusy()`, calls `announce("Saturday 20 September, 14 classes")` and scrolls the top of the day back under the strip (`_pagerScrollToTop`).

A SWIPE that really changed the day also gives one light tick (`window.haptic('tap')`, typeof-guarded: a LIGHT impact in the iOS app, a 10ms vibrate where the web has one) — never at an edge or mid-search, where `stepDiscoverDay` returns false.

Equivalents for the swipe: the strip's pills (tappable) and Left / Right / Home / End in the strip — the heading deliberately carries NO previous / next chevron buttons (owner's design direction) — one delegated click listener on `#results` (`_wireDayPager`).

### Empty day states
An empty day says "No classes on this day." — once: its heading carries no count — with one button to the next (else previous) day with classes; the whole-range empty states still own `filtered.length === 0`.

An empty day is not always a day with no classes (`_pagerEmptyState` → `m.states[day]`): `unopened` — Psycle has not put the day on the timetable yet (`_dayListedMs(day) > now`, asked per DAY — the OBSERVED release model, see Booking horizon; no preset reaches that far, a date picked in the calendar can, and a day that IS listed and empty really has no classes) → "Booking usually opens Monday 12 October, 12:00" (`_pagerOpensText(_dayOpensMs(day), …)`: the release that opens the day, named by its date because a bare "Monday" would read as the next one — and "usually", like the whole-range empty state's "Booking for these usually opens …": that date is the observed model's arithmetic, never a promise — the API does not say, and some credit types book a batch early), the jump button stays; `unknown` — it lies past `window._windowHeldEnd` of a PROVISIONAL window (`render()` hands `heldEnd` over only while it is drawing that window: `_discoverEmptyContext`'s rule, per day) → "Checking the latest timetable…" (`.empty-loading`, which `_runRevalidate` repaints when nothing more is coming) while `_revalInFlight`, else "Couldn't check this day" + Try again (`data-pager-retry` → `search({ force: true })`).

Either state prints no count in its pill (`.day-pill-count:empty` draws nothing) and is announced "not open yet" / "not loaded", never "no classes"; an unknown pill is not quiet (`.is-empty`) either.

### Owed strip reveal and theme change
A strip rebuilt while another tab is up has no layout box: `_paintDayStrip` notes `window._dayStripRevealOwed` and `switchTab('discover')` pays it once through `_restoreDayStrip()` (the date row's `_datePillRevealOwed` pattern).

A theme change re-measures the pills without a rebuild (Terminal / Handheld widen them with their mono body face): app.js listens for `theme:changed` (`_revealPillsAfterThemeChange`) and reveals the lit day and the lit date pill at once when their rows are laid out, else owes them the same way.

### Summary line over a paged range
Over a paged range the "N classes" summary line is hidden once loading is over (the strip carries the counts).

### Swipe to change day hint
One-time hint "Swipe to change day": touch screens only, `psycle_hint_dayswipe` written when first SHOWN, dismissed by a tap or the first successful swipe — and never in a page session that also showed the first-run welcome (`_pagerSawWelcome` — its overlay was up during a paint — or `window._psycleWelcomeSeen`), whose "Find your class" page has just said the same.

The welcome is judged by its overlay, never by a missing `psycle_onboarded_v1`: a launch the welcome skipped (a `#bookings` link) leaves the flag unset, and that newcomer is who the hint is for.

### Day pill parts
A pill is a small word over the date numeral over the count (`_pagerPillParts`: 'Today', else the weekday — "Tomorrow" does not fit a seventh of a phone; the spoken name is still `_pagerSpoken`'s full date).

### Held-day dot rule
A day on which the member holds a SEAT carries one small class-colour dot on its numeral (`_pagerHeldDays` — earliest class of the day by its time DIGITS, never a waitlist place, never a class that has started — drawn by `_paintDayDot` from `_myBookings` + `_eventCache` only, never fetched for, and only once `_bookingsLoadState === 'loaded'`); the pill's name says it ("…, 14 classes. You have Ride 45 at 19:00") and `_repaintDayDots` keeps it current on `bookings:loaded` / `booking:complete` / `booking:cancelled` / `seat:cancelled` / `waitlist:claimed` / `waitlist:allocated` / `auth:changed`.

### Summary line on a single day
A single day's settled "N classes" summary line is hidden too (its heading carries the count).

### Shared swipe helper
**Shared swipe helper** (js/interactions.js section D — it must stay AFTER section C: tests/suites/bookings-card.js evaluates everything between the B and C banners in a bare vm): `window._psycleSwipe(el, {shouldIgnore, edges, width, onStart, onMove, onEnd})` → detach function.

Rules in `pure:swipe-nav`: sideways only once |dx| > 12px and > 1.5×|dy|; released at ≥ 25% of the width, or a flick of ≥ 40px inside 250ms, turns the page — never past an edge, against which the content moves a third as far.

Every touch listener is passive and no touch is ever `preventDefault`-ed: the paged element carries `touch-action: pan-y pinch-zoom` (`.day-pager`, `.stats-page` — the viewport allows zoom, and the helper drops a second finger).

### Touches the swipe ignores
Ignored: a touch within 16px of the left edge (the system back gesture), on an input, in `.date-presets` / `.location-chips` / `#categoryPills` / `#dayStrip`, or under ANY ancestor that really scrolls sideways; a second finger cancels; the click that can follow a swipe is swallowed; once locked sideways `touchmove` stops propagating, so the document-level pull-to-refresh cannot read a drifting swipe as a pull.

### Users of the swipe helper
Users: the day pager (bound once to `#results`; app.js's `window._dayPagerSwipe {canStart, edges, drag, release}` limits it to inside `#dayPager` with no dialog / overlay up and no Book button busy; the list follows the finger and the target day's pill lights; reduced motion: the day simply swaps) and the Stats sub-pages (tabs.js `_wireStatsSwipe`).

The first-run welcome keeps its OWN listeners with the same numbers (`pure:welcome` — it opens while app.js is still being evaluated, before interactions.js exists); tests/suites/8f-wave8-seams.js holds the two rule sets to the same answers — change both together.

### Held-day dot: where the pieces are
**The held-day dot, on its own** (the sections above hold the rule; this is where the pieces are):
- Decision: `_pagerHeldDays(bookings, cache, days, {typeKey, started})` and `_pagerHeldSpoken` (`pure:day-pager`, its second region).
  The only caller is the impure `_heldDaysFor(m)`: it holds the `_bookingsLoadState === 'loaded'` gate and hands in `classTypeKey` and the London-resolved `_classHasStarted`.
  Paint: `_paintDayDot`, `_repaintDayDots` (with its listener array), `_paintDayStrip`.
  Look: css/crisp.css 9b.6 `.day-pill-dot` (+ its `.day-pill.active` twin) over the `.ct-dot` primitive of `crisp:9a-foundation` — NOT css/redesign.css.
- Pinned by tests/suites/9b-discover.js ("the class-colour dot marks a day on which you hold a SEAT", "dots are painted in place, from memory only …") and 10a-time24.js: the listener array VERBATIM; no `apiFetch`, `fetch(`, `search(` or `revalidate` in `_heldDaysFor` + `_paintDayDot` + `_repaintDayDots`; no `new Date`, `Date.parse`, `getHours` or `toLocale` in the text between `function _pagerHeldDays(` and `function _pagerHeldSpoken(` (keep the two adjacent, comments included); the two call lines inside `_heldDaysFor`; the dot's exact `className` and attributes, on a fake element that has only `setAttribute` / `getAttribute` / `remove`; and the closed list of selectors in `crisp:9b-discover` that may use a `--glow-*` token — a dot variant may not.
- `waitlist:joined` and `waitlist:left` are deliberately NOT in `_repaintDayDots`' list: a place marks nothing (agents/decisions.md section 3 — the implementer's reading, not the owner's words).
  A leave still repaints through the `fetchMyBookings()` → `bookings:loaded` that follows it; a join has no repaint path.
  If places ever mark a day, add both events and change the suite's regex in the same commit.
  A place's class may have NO cache entry: [waitlist.md](waitlist.md), last paragraph.
- The rule is restated in [tab-structure.md](tab-structure.md) (the Discover row), in the `.ct-dot` comment in css/crisp.css and in the comments above `_pagerHeldDays` / `_heldDaysFor`: change all of them together.
