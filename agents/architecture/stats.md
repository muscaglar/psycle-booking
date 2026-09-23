# Stats — the three sub-pages (Overview · Habits · Instructors)
Read this when you add, move or repaint a Stats section, or touch the switcher, its pinning or its swipe. Skip it otherwise. The swipe rules themselves are in [day-pager.md](day-pager.md).

### STATS_PAGES section grouping
**Stats sub-pages** (js/tabs.js, css/tabs.css last block): the grouping lives ONCE, in `STATS_PAGES` inside `pure:stats-pages` — Overview `#statsPageOverview` (statsBar, streakSection, heatmapSection, classTypeSection, yearReviewSection, shareSection — the approved Stats board, in its order) · Habits `#statsPageHabits` (habitSection, recoSection) · Instructors `#statsPageInstructors` (exploreMapSection, varietySection, lapsedSection, exploreLikeSection, exploreNewSection); initTabs builds the wrappers from it and every section keeps its id, so moving a section is an edit to that table.

### Selecting a page with showStatsPage
`window.showStatsPage(id)` selects, builds, announces the page name, logs `stats:page to=<id>` and stores `sessionStorage psycle_stats_page` (anything else stored = Overview, so a fresh launch opens Overview); `window._statsPageStep(dir)` gives the neighbour (no wrap — the arrow keys do wrap).

### Painting only the open page
`renderInsights` no longer calls the section renderers: `_syncStatsPages(heroOnly)` invalidates `_statsPainted` and builds ONLY the page on screen (`_paintStatsPage`, `_STATS_SECTION_PAINT`); the others are built when first opened and not again until the next `renderInsights`.

explore.js's `renderExplore` keeps `_exploreDirty` and returns while all three of its sections sit on a hidden `.stats-page`; `_paintStatsPage` asks it again EVERY time Instructors opens — outside the built-already guard, because explore.js can go dirty while that page is closed (`/instructors` landing, a booking made from a sheet) and "Loading instructors…" would otherwise stay up until the member left Stats; `renderExplore` returns at once when nothing changed.

### Empty page message
A page whose sections are all hidden shows ONE line ("Nothing here yet.", plus "Sync my history" only when the global banner is not already offering it) — re-evaluated by a MutationObserver on the sections' `style` attribute, because explore.js shows / hides its three after `renderInsights` has run.

### Switcher pinning and scroll
Switching keeps the pinned switcher under the thumb (`_statsScrollTarget`): scrolled past the pin point the scroller returns to exactly that point, above it nothing moves.

Pinning: `.stats-switcher-bar` is `position: sticky` — top 0 inside `.tab-content` on phones; wider, `.tab-content:has(> #tab-stats.active) { overflow: clip }` + `--stats-pin-top` (the sticky tab bar's height, `_syncStatsPin`).

### Swipe between pages
Swipe: `_wireStatsSwipe` binds the shared helper to the panel — a touch must start on a `.stats-page` with Stats up and nothing modal open (`_statsSwipeMayStart`); nothing follows the finger (one page is laid out at a time), the release opens the neighbour through `showStatsPage`; the pages are `touch-action: pan-y pinch-zoom`.

### Switcher is a tab list, not an overlay
It is a tab list, not an overlay — no `_OVERLAYS` entry.
