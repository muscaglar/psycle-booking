# Discover — live filters, the Filters bar and its chips, the timetable window cache, focused searches
Read this when you change search, filtering, the filter panel, desktop Discover or timetable caching. Skip it for the day strip and swipe ([day-pager.md](day-pager.md)) and the release model ([monday-release.md](monday-release.md)). The instant restore of the last results is "Session persistence" in [session-and-accounts.md](session-and-accounts.md).

### Live filters

**Live filters**: every filter change calls `triggerAutoSearch()`. When the loaded window already covers the
selected dates it re-filters in memory at once (no debounce, no network); otherwise a search runs after a 600ms
debounce. Overlapping searches are superseded via `_searchSeq` — stale loops stop fetching/rendering. Filtering and
the cascading chip counts go through `PsycleFacets.run()` (facets.js).

### The Filters bar

**Filters bar + chips** (js/app.js, css/redesign.css "Discover: the Filters bar", `#controlsPanel` in psycle-finder.html): the date row sits outside the collapsible body and is always on screen; Time / Location / Class Type / Instructor live in `#controlsBody` behind `#controlsToggle` — a real `<button aria-expanded aria-controls="controlsBody">` whose spoken name carries the count (`_filtersBarName`: "Filters, 3 active").

Collapsed = class `filters-collapsed` on `#controlsPanel` (in the markup, so the first paint is already collapsed) + `let _filtersCollapsed = true`; NOT persisted — it stays as the member left it for the page session only. `toggleFilters()` flips the class and `aria-expanded` and nothing else: no search, no scroll, no inline display, no focus call.

The collapse rule exists only inside `@media (max-width: 1023px)`; at ≥1024px the panel is always open and css/styles.css hides the bar.

### Filter summary chips

Chips: `_filterSummaryChips(state, maps)` (`pure:filter-summary`) → `[{kind, id, label}]` in panel order — studios ("Psycle " dropped) · class types (a narrowed sub-type row reads on its parent, "Strength · Upper") · time bands · "Available only" · instructors; when the selected instructors ARE the starred set and there are 2+, they read as ONE chip ("Favourites"). The count on the bar = the number of chips.

`updateFiltersSummary()` paints them as buttons (`data-kind` / `data-id`, "Remove filter: …") plus Clear (`clearFilters()`, which also resets the date row), skips the DOM write when nothing changed and hands focus on after a removal.

`removeFilterChip` → `_removeFilter(kind, id)` calls the SAME global the panel's own control calls (`toggleLocation` / `toggleCategory` / `toggleTimeBand` / `toggleAvailableOnly` / `removeInstructor` — the copies interactions.js wraps with `saveFilters`), only while that filter is really on (a stale chip never switches a filter ON), so the `_focusStash` release, the save, the facet counts and the live re-filter are that function's own.

Chips are hidden while the panel is open (its own pills show the state); the count and Clear stay.

### Header Clear filters button

The header's "Clear filters" (`#discClearBtn.disc-clear-btn`) is hidden below 1024px — the bar carries Clear there — and at ≥1024px it is there only while a filter is on: tabs.js builds it `hidden` and `updateFiltersSummary` sets `hidden = !chips.length` BEFORE its early return (the same rule as the bar's own "Clear").

`initTabs` calls `updateFiltersSummary()` itself as soon as the button is in the page: on a warm launch (reference lists from the 24h cache) app.js's one launch-time summary runs BEFORE the button exists, and a member whose starred instructors were pre-selected (no saved filters to restore) had a filter on and no Clear.

When the hide takes the button that holds the focus (Enter on it), the focus is handed to the lit date range (`#controlsPanel .date-quick-btn.active`) — never left to fall to `<body>`.

### Desktop Discover

**Desktop Discover** (css/crisp.css 9b.9, all inside `@media (min-width: 1024px)`): `#tab-discover.active` is a two-column grid — `#controlsPanel` a 352px filter column (392px on the mono themes, whose date row needs it) pinned under the sticky tab bar, scrolling by itself when taller than the window (so the instructor matches open UPWARD there; NO `overscroll-behavior: contain` — at the top of the page the column sits below its pinned place with its foot under the window's edge, and only the chained page scroll brings its last control up), and `.disc-header` / `#travelNotice` / `#results` (day strip + cards, ~590–650px) on the right.

The rows are explicit — `grid-template-rows: auto auto 1fr`, the column spanning all three: left to `auto`, three OCCUPIED rows share the taller filter column's height equally (blank bands under the freshness line and the travel notice over a short list); only a flexible track takes a spanning item's space alone.

Pinning needs `.tab-content` to be `overflow: clip` while Discover is up — a `:has()` rule of its own in css/tabs.css beside Stats' (9b may hold no `:has()`); without it the column scrolls with the page. tests/suites/10c-polish.js holds it, and that none of it exists below 1024px.

### Filters summary updates and Enter in the Filters bar

The summary follows stars through `PsycleState.subscribe('favouriteInstructors')`; `switchTab('discover')` re-reads the chips too (no DOM write when nothing changed). Enter inside `#controlsBar` never also runs `search()`.

### Crisp Colour on the Filters bar

Crisp Colour (css/crisp.css `crisp:9b-discover`): the bar carries NO chevron — it leads with a sliders mark and, while the panel is open, is LIT (accent fill); colour means class type, so only a `category` chip gets `data-ct` (its key lower-cased) and wears its class wash, as do the panel's class-type pills (`data-ct` + a pictogram tile) and the two sub-pill rows (`#strengthSubPills data-ct="strength"`, `#reformerSubPills data-ct="pilates"`); studios, time bands and instructors stay neutral (lit = the sunken well with an ink ring).

### Date track and pill rows

The five date ranges share one segmented track (`.date-track`, a plain wrapper inside `.date-presets`, which still scrolls when the track cannot fit; Terminal and Handheld lay it out in two rows on a phone instead — see Theming → Mono themes on a phone).

Every pill row in the panel is one side-scrolling line below 1024px EXCEPT the Time row: its four controls in 24-hour words are wider than a phone, and "Available only" sat half off the edge, so `#tab-discover #timePills` wraps at every width (css/discover-layout-fix.css — not css/crisp.css, whose 9b section may not use `!important`, and redesign.css's `nowrap !important` has to be beaten).

### Discover window cache

**Discover window cache**: one all-studios timetable window is kept in memory (`window._windowKey` =
`'start|end'`, `_windowEvents`, `_windowRelations`, `_windowFetchedAt`) and in `psycle_window_cache`
(read back for up to 24h). Rules (`pure:window`, tests/suites/window.js):
- *Instant in-window dates*: Today, Tomorrow or any picked day inside the loaded range re-renders from memory
  (`_windowCovers` → `renderFromWindow`). At launch `_cachePlan` adopts a cache that `covers` the range, or shows
  the still-valid first days of an `overlap` at once while the real range loads.
- *15-minute freshness*: `_windowIsFresh` (`WINDOW_FRESH_MS`). Older numbers still render immediately, then
  `_revalidateIfStale` refreshes silently and re-renders in place, keeping the scroll offset and never under an
  open dialog or a busy Book button. "Spots left" counts are printed only while the data is under 30 minutes old
  (`_countsFresh`). A failed background refresh backs off for 60s.
- *Never commit a partial window*: `_runRevalidate` commits and persists only when every studio answered and the
  view has not moved to a range the fetch does not hold (a latched `gone()` that ignores `_searchSeq`). An
  all-empty 200 commits nothing. A window flagged `partial` is never persisted and never counts as fresh.
  `_revalRange` refreshes a covering window as a whole, so refreshing "Today" cannot shrink the loaded week.
- *Roll-forward on resume*: `_discoverResumed` (visibilitychange, and `online`) → `_rollDiscoverForward`
  re-derives the date row when the day has changed (Today stays today; a range now in the past falls back to the
  week); same day: drops classes that have started and revalidates if stale.
- *Monday 12:00 London release*: see "Monday-noon release" in [monday-release.md](monday-release.md) — a timetable fetched before the latest release is
  never fresh.
- *Pull-to-refresh* (interactions.js) and the Refresh link both call `refreshWindow()`; on My Bookings the pull
  re-reads `/bookings`.

`_persistWindow` removes the cache again if 64K more would not fit beside it — a cache must never be what fills
the bucket.

### Focused searches

**Focused searches**: every "find it" shortcut (Find similar's same-instructor / same-time, the "Book again?" hint, instructor modal "View schedule", Explore "View classes", Stats "Find this week") goes through `_focusSearch({instructorId, locationId, categoryKey | typeName, mode | startDate+daysAhead, keepTimeRow})` in app.js (typeof-guarded from features.js / tabs.js): it clears ALL filters — the Time row and "Available only" included (only same-time passes `keepTimeRow`, after `_admitTimeBands` admitted the class's own band) — applies only what was passed, shows Discover and searches.

The Filters bar stays collapsed; its chips show what the shortcut set. Same-time shows the held class's OWN day while it is still ahead (else the next occurrence of its weekday).

### Focused searches and _focusStash

Deliberately NOT saved (`saveFilters`), so a shortcut never replaces the filters the next launch restores — and so the member's NEXT tap doesn't save them for it, what stood before is stashed per dimension in `window._focusStash` (`loc` / `cat`+subs / `time`): `saveFilters` writes a held dimension instead of the live set, a dimension changed by hand is released (`_dropFocusStash(dim)` in toggleLocation / toggleCategory / the Time-row controls), × on the last instructor chip puts the rest back on screen (`_restoreFocusStash`), and Clear filters / a recent-search pill / sign-out forget it.
