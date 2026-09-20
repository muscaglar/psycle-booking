# js/ — read before editing here
The web app's 15 modules: classic `defer` scripts, no bundler, no imports. Rules 2, 3 and 7 of the root [AGENTS.md](../AGENTS.md) bite hardest here — this file adds only what is local.

## Rules that bite here
Rule → why → guard. A bare `name.js` is in tests/suites/; A1, B6 … are items of [learnings.md](../agents/learnings.md).
1. **Wrappers** (root rule 3; every one: [globals.md](../agents/index/globals.md)): a wrapper forwards every argument and returns what the original returned. Never RELY on the return value of `submitBooking` or a cancel: js/reliability.js's optimistic wrapper and the iOS bridge return nothing, so read the outcome from the button or state (B6). `fetchMyBookings`' `true` IS read through its js/features.js wrapper, by `_rereadBookingsForVerify`. A new module also joins tests/smoke.html → shell.js, reliability.js, ios-bridge.js.
2. **`apiFetch` is REPLACED, not wrapped**: js/reliability.js's `apiFetchWithRetry` re-implements the headers, the 401 rule and the logging and never calls app.js's copy → change both. js/performance.js then wraps the replacement.
3. **Spend paths** (root rule 2; A1–A5): `bookClass`, `submitBooking`, `joinWaitlist`, `claimWaitlistSpot`, `bookWeeklyTemplate`, `processOfflineQueue`, and `executeSpotSwap` — its own DELETE, then its own `POST /bookings` with `retries: 0`, never through `submitBooking`. One guarded exception to "never re-sent": the offline queue's SLOT-body replay (`retries: 3`; a duplicate of the same seat comes back 409 and is checked against `/bookings`). A COUNT body is never retried: [offline.md](../agents/architecture/offline.md) → booking.js, booking-races.js, offline-queue.js.
4. **The Book button's `className` is assigned wholesale**, and js/reliability.js compares it (`'book-btn booked'`): never put a styling class or a Crisp primitive on it (A3).
5. **Sliced functions** (root rule 7; B1). Who SLICES one: the "slices js/<file>" lines of [tests.md](../agents/index/tests.md) — `grep -l "<name>" tests/suites/*.js` also lists suites that only stub the name. It RUNS in a bare vm holding only the globals its suite lists (no `navigator`, `location`, `toast`): code that runs while it builds markup reaches a new helper only behind `typeof x === 'function'`; click-time work goes in a separate top-level function. Suites pin the markup it emits AND count tokens in its SOURCE, comments included (9c-sheets.js: `.cds-cta` = the Book button + `.cds-note`; `glow-mine` once in the rendered sheet, three times in `openClassDetail`'s source), and a `// comment` line inside it can be an anchor (discover.js: `// Availability info`) → read the suite's section for that function before adding an element or a comment.
6. **`pure:` blocks** (B2): a NEW block is free of DOM and app globals; five existing ones are not — NEEDS FAKES in [pure-blocks.md](../agents/index/pure-blocks.md) → the suite named in each start marker (it evaluates the block in a bare vm; 00-harness.js tests only the loader). The legacy `// ── waitlist:pure:start` block in app.js is run by tests/unit.js itself.
7. **`start_at` is a naive London wall-clock string**: never `new Date(start_at)` for an instant — `_gymClassStartMs` / `_gymWallToUtcMs`; clashes and usual-week matching compare DIGITS; print through `_clock24` / `_clockOf` (C1) → clash.js, 10a-time24.js.
8. **Stored data is untrusted**: coerce where read (`_cleanStored…`), print through `escapeHTML` (A12) → import-validate.js. A new localStorage key has a checklist: [playbooks.md](../agents/playbooks.md) P3.
9. **DOM**: only the visible day's cards exist (E1) → 8b-day-pager.js; `renderMyBookings` ends in `_commitBookingsHtml` (E2) → render-perf.js; a new overlay joins `_OVERLAYS`, or keeps its own keys and is named in `_ownKeysOverlayUp()`; one that background dialogs must wait for (it spends, or holds unsaved input) is ALSO named in `_dialogOpen()` (E3, playbooks P5 steps 3–4) → a11y.js.
10. **One global scope**: state.js, theme.js, app.js, performance.js and calendar.js are not IIFE-wrapped, so their top-level functions AND `const` / `let` share one scope. A top-level name reused across them stops the later script loading (`const`, `let`, `class`) or silently overrides the earlier one (`function`), and check + test do not see it → after adding a top-level name there, open tests/smoke.html (`SMOKE: PASS`). Every other module is an IIFE and exports only through `window`.
11. **A new `window.*` global** gets a declaration in types/globals.d.ts (the advisory `npm run typecheck`).
12. **Reuse before you write** (app.js unless noted): `toast` (already mirrored into an open `aria-modal` dialog), `announce`, `confirmModal`, `window.escapeHTML` / `window.escapeForJsString` (js/security.js), `_uiIcon` (names = the keys of `UI_ICONS`, in `pure:sheets`), and `window.shareClass` — the ONE share path (`nativeShare` → `navigator.share` → clipboard → a textarea). No per-class URL exists: it shares a sentence and the public timetable page. js/settings.js's `_fallbackCopy` is private to its IIFE.

## What is in here
In LOAD order. Symbol index of `<file>`: `agents/index/symbols/<file>.md` — [symbols/](../agents/index/symbols/) (top-level functions, and those one level inside a module's IIFE, with their lines; nested functions are not listed, so `git grep -n` for those).

| File | Holds (wrappers: the main ones — every one is in globals.md) |
|---|---|
| state.js | `PsycleState`, `PsycleEvents` |
| security.js | token store, `window.escapeHTML`, framebust |
| theme.js | `APP_THEMES`, `PsycleClassColours`, skeletons, `haptic`; wraps `submitBooking`, `search`, `render`, `setStatus` |
| facets.js | `PsycleFacets.run`: faceted counts |
| app.js | the core (~14,000 lines): never read it whole |
| reliability.js | REPLACES `apiFetch` (rule 2); wraps `submitBooking` twice (optimistic UI, offline queue) |
| interactions.js | pull-to-refresh, swipes, `wrapGlobal` → `saveFilters` over 14 filter functions |
| performance.js | wraps `apiFetch` again (24 h reference cache) |
| calendar.js | `generateICS`, calendar links |
| features.js | history, instructor profiles, notify bell; wraps `eventCard`, `submitBooking`, `fetchMyBookings`, the four cancels |
| tabs.js | tabs, Stats, Membership, the usual-week card and sheet; wraps `renderMyBookings` |
| settings.js | Settings, `tierBadgeHTML`, `importSettings`; wraps `showBikePicker` |
| explore.js | instructor suggestions, history sync |
| api-client.js | `PsycleAPI`: typed getters, schemas |
| diagnostic.js | `PsycleDiag`: API drift, safe mode |

## After you edit
```bash
npm run check
node tests/unit.js > /tmp/unit.log 2>&1; echo exit=$?      # any writable path
grep -E "✗|passed,|stopped before|crashed" /tmp/unit.log   # the log is ~9,000 lines
(cd ios-app && npm run build)   # after ANY js/ edit; commit ios-app/www/ AND the root sw.js (its CACHE stamp changes)
npm run agents:index            # after the LAST edit to code AND suites: both are indexed; then `npm run agents:check` exits 0; commit agents/index/
npm run drift                   # with the check and the tests above, this is what `npm run ci` runs
```
Annotated, and how a stretch of work ends (step 6): playbooks.md P0.

## Read next
- [core-patterns.md](../agents/architecture/core-patterns.md) — state, events, wrappers.
- [booking.md](../agents/architecture/booking.md), then playbooks.md P2 — before a path that books, cancels, joins or claims.
- [time.md](../agents/architecture/time.md) — before a class time is parsed, compared or printed.
- learnings.md — its first 20 lines, then A (money), B (tests), C (time) or E (DOM).
- playbooks.md — P1 a filter, P5 an overlay. [repo-map.md](../agents/repo-map.md) "Where to Edit".
