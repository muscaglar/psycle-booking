# Improvement Programme — September 2026

> **STATUS (2026-09-18): implemented and committed (`3da5392..a9d4a9b`).** Every web-layer change below is
> unit-tested and was checked in a browser against a stubbed API; the native (Swift / Capacitor-only) changes are
> covered by unit tests of their JS decision logic where one exists and by an unsigned simulator compile only.
> `npm run ci` is green at `a9d4a9b`. **Nothing here has been run on a physical iPhone yet** — the
> [on-device checklist](#on-device-checklist--still-owed) at the end is still owed. The items under
> [Deliberately NOT changed](#deliberately-not-changed--owner-decisions) are decisions, not omissions.

This file is the audit trail for the programme. CLAUDE.md describes the resulting architecture; this file records
what moved, why a few things did not, and what still has to be looked at on a real device.

## Summary

In September 2026 the whole app was reviewed again, on top of the July 2026 full-app review's fixes and the August
move of waitlists onto Psycle's real `/waitlists` API. Most of what it found was about integrity: a booking must
never be doubled, announced before it exists, or cancelled by the wrong id; a session must not be thrown away
because Psycle could not be reached for a minute; one member's data must not become another's; a calendar must
not be emptied without being asked. The rest was speed and freshness on Discover, an offline story that cannot
spend credits by surprise, accessibility, new Lock Screen widgets, and a long tail of copy and layout. It landed
as seven commits on `improvements/best-app-pass`:

| Commit | Subject |
|--------|---------|
| `67a92f8` | Tests: load per-feature suites from tests/suites and slice pure blocks by name |
| `8b63b62` | Fix booking integrity, session state, filters and Cloud-theme readability |
| `ba70f94` | Faster, fresher Discover; clash warnings; offline saved bookings; update prompt |
| `6530770` | Spots left, time-of-day filters, faster list, accessibility, more tests |
| `4c5e6e3` | Safe offline queue, usual-week booking, history sync, Lock Screen widgets |
| `470693b` | Calendar safety, per-account data, booking races, waitlist and Monday release |
| `a9d4a9b` | Final polish: token hygiene on retries, booking dead end, stats and a11y fixes |

Range: `3da5392..a9d4a9b` (base `3da5392` = "Waitlists: use Psycle's real /waitlists API (join, list, leave, claim)
(#9)"). 117 files changed; the unit-test assertion count went from 126 (at `3da5392`; 128 after the first commit)
to 4,859.

### Follow-up: none of it reached TestFlight until `8f8c62c`

Every Xcode Cloud archive for the seven commits above **failed**, all with the same ten errors: "The iOS deployment
target 'IPHONEOS_DEPLOYMENT_TARGET' is set to 13.0, but the range of supported deployment target versions is 15.0
to 27.0.x". It had nothing to do with the changes: Xcode Cloud had moved to Xcode 27, which rejects targets below
15.0, and the project plus the nine Capacitor pods still declared 13.0 (the last green archive was `3da5392`, built
with the previous Xcode). GitHub's unsigned iOS build check stayed green throughout because its runner has an older
Xcode, so the failure was only visible as the Xcode Cloud check on each commit.

`8f8c62c` raises the project and app target to 15.0 (the widget extension stays at 16.1) and has the Podfile's
`post_install` lift any pod below 15.0 — Xcode Cloud runs a fresh `pod install`, so the floor has to live in the
Podfile. The archive for `8f8c62c` succeeded. **The app now requires iOS 15 or later.** How to read the archive
result for a commit is in `ios-app/CICD.md` under "Notes / gotchas".

## How it was done

A multi-pass review: discovery, independent verification of each finding, implementation in small patches,
adversarial code review, and browser verification against a stubbed API. A second discovery round was run on the
changed app to look for regressions and for what was still missing, and its findings went through the same passes.

- Every web-layer change was unit-tested — most through a `pure:<name>` block or a slice of the shipped function
  run against fakes (tests/README.md) — and then checked in a real browser with the API stubbed inside the page.
  Native behaviour is the exception: the Capacitor-only paths (status bar, share sheet, calendar hand-over,
  notification taps) have unit tests for their JS decision logic where one exists, but none of them could be
  exercised in a browser — they are on the [on-device checklist](#on-device-checklist--still-owed).
- **Nothing was ever written to the live API.** Psycle's API is a real booking system; every browser check
  replaced both `window.apiFetch` and `window.fetch` for the API host before anything was clicked, and each round
  confirmed that no write had left the page.
- The Swift changes (widget families, the widget deep link, Live Activity seat updates) were compiled with an
  unsigned simulator build of the full App scheme, and rebuilt after the last Swift edit. An unsigned build carries
  no entitlements, so it proves the code compiles — not that a widget can read the App Group on a phone.
- The final browser round swept the whole app for regressions in all seven themes. Its visual notes are the source
  of [Known small leftovers](#known-small-leftovers).

## What changed

### Booking & cancelling

- **No accidental second seat.** The pre-selected "usual" bike plus a tap on another bike used to book both; the
  first tap now replaces the pre-selection. Adding a second seat no longer wipes the first from local state.
- **A booking is only announced when it is real.** A booking that times out or gets a 5xx / 409 is announced only
  after `/bookings` has been re-read (bounded, so a tap always settles), and that POST is never re-sent
  automatically. Until the re-read clears it, no further booking for that class goes out. Bookings are re-read after
  every POST, because that list is the only source of per-seat record ids.
- **Book waits for your bookings.** After a flaky launch every card reads "Book", held classes included — Book now
  waits for the member's bookings to load, so a class already held cannot be booked twice.
- **Latest tap wins.** Two quick Book taps on different classes: only the latest opens a picker and the earlier
  button is restored.
- **Cancels only delete what they can prove.** Per-seat and whole-booking cancels only delete records proven to
  belong to the seat or booking; when local state cannot say, `/bookings` is re-read, and if it still cannot,
  nothing is sent.
- A refused booking (403 / 422) no longer leaves the button styled as booked.
- **Seat maps come from the class when the cache has none.** A seat studio whose cached record lacks its map takes
  it from the class detail instead of falling into the no-layout "Book this class?" path — for single bookings, for
  "+ Add spot" on a card whose studio has not loaded yet, and for the usual-week run. If the studio cannot be
  resolved at all, no confirm appears and nothing is sent. Booking by count stays exclusive to studios known to have
  no layout.
- **Clash warnings.** Booking a class that overlaps one you hold — or leaves too little time to get between two
  locations — says so in the confirm dialog or the bike picker. It warns and never blocks. A waitlist place at the
  same time is mentioned as a possible seat.
- The bike picker states the late-cancel deadline, fits the phone sheet and scrolls to the relevant seat; its
  dismiss button reads "Close" while it is showing your booking. Declining "Book another space?" leaves
  "+ Add spot" as it was.
- Booking learns fresh availability and writes it back to the list, so a class that has just filled does not read
  "Book" again after a background refresh.
- Failure messages use member wording instead of "HTTP 500", "Load failed", a raw "Server Error" or a bare status
  code — for booking, cancelling, waitlist and swap. Psycle's own business messages are still shown. Cancel toasts
  promise a retry only on the paths that really queue one.
- The "Booked!" sheet can no longer get stuck when two bookings settle within a fraction of a second.

### My Bookings

- "Similar" works again, every booking has a Cancel button, tapping a card opens the class sheet, and Share is back.
- Cards and the booking confirmation show **"Free cancel until …"**, computed in Europe/London so it is right
  abroad. Countdown chips, the cancel dialog and that line all read the same London class time and agree on wording.
- Travelling east of London no longer files a class starting in the next few hours as past. The tab badge, Stats
  "Upcoming" and the next-class pill agree with the list.
- **First paint without waiting.** My Bookings paints immediately from saved class details instead of waiting for
  one request per booking; the details refresh in the background and are never treated as server-confirmed by the
  calendar or the widget. "Change spot" and the class sheet's seat button wait for such a card's details instead of
  erroring.
- **Your usual week** is back, with a preview. "Save my usual week" from the classes you hold, then "Book my usual
  week": the sheet lists every class and what will happen (book, waitlist, already booked, clash, no match), and
  nothing is sent before the explicit "Book N classes". Waitlist joins are opt-in, classes are booked one at a
  time, the run stops on an auth or credits error, and a per-class result is shown. Studios without a seat map are
  skipped for now.
- The list skips re-rendering identical content, and one 60-second ticker updates countdowns in place.
- Usual-week entries wrap so the location stays visible; the last card can scroll clear of the floating next-class
  pill.

### Session & accounts

- A `/profile` failure with a token present shows **"Can't reach Psycle — Retry"** instead of signing the member
  out. Expiry stays 401-only. A locally expired token keeps the offline saved bookings.
- Sign-out clears the previous account's bookings, plan, pill and widget data; the hidden next-class pill is
  emptied after sign-out and on an account change.
- A request that is between retries when the member signs out, or the session expires, stops instead of going out
  again with the old token. A signed-out member gets no "queued action" toast.
- Plan usage refreshes after booking, cancelling and on resume. Book while signed out asks to sign in instead of
  opening the token dialog. The welcome history prompt stays dismissed.
- **Device data now has an owner.** When a different customer signs in, the previous member's rankings,
  favourites, bike preferences and history, usual week, recent searches and watchlist are stashed (written before
  anything is removed) and restored when they return. Class history is cleared for the newcomer, who is offered a
  sync of their own. Unstamped data from before is adopted. A storage error can never block sign-in.
- **Settings import** validates every key, shape and size, rejects prototype pollution and unknown keys, and asks
  before touching a device that already holds data. Ids and seat lists read from storage are sanitised where they
  are read and escaped where they are rendered (instructor links and chips, history, both seat maps).
- **Sign-in page:** real form semantics and autocomplete, a 15-second timeout, only real credential failures count
  towards the lockout, friendly 429 handling, a content security policy, frame busting and a referrer policy. A
  full localStorage frees re-creatable caches and retries instead of reporting a network error.
- The token-expiry timer no longer spins when the expiry is more than 24.8 days away.

### Discover

- **Instant dates.** Picking Today, Tomorrow or any day inside the week already loaded re-renders at once with no
  network calls; it used to refetch every studio and blank the list.
- **Never a truncated timetable.** A refresh interrupted by a filter tap can no longer save a partial timetable: it
  only lands if every studio answered and the date range is still the one on screen.
- **Honest freshness.** Cached timetables older than 15 minutes are refreshed quietly in the background. The first
  open of the day shows the still-valid part of yesterday's cache at once, then refreshes. Coming back the next day
  rolls "Today" forward and drops started classes. Pull-to-refresh works on Discover, and coming back online
  refreshes it too.
- **Availability on cards** — "Only 2 left", "25 spots left", "Waitlist open", "Fully booked". The API sends
  capacity and occupancy, not the field the cards used to read, so this had never rendered. Counts are only shown
  while the timetable is under 30 minutes old and re-sync after you book or cancel in place. The class sheet shows
  availability instead of a duplicate duration row.
- **Time row** — Before 9, 9–5, After 5 and "Available only". It filters the loaded timetable instantly, is saved
  with the other filters (and with recent searches), and never hides a class you are booked or waitlisted on.
- **"Next week"** date preset (next Monday to Sunday), and the **Monday release**: a timetable fetched before
  Monday 12:00 London time is never treated as fresh afterwards; while Discover is open it refreshes at the
  release; tapping the Monday reminder opens next week — without making it the saved launch default.
- "Find similar", "Book again", "View schedule / classes" and the habit shortcuts clear the filters they do not
  mean, so the promised classes are not hidden; "Same time" means that day. "Book again?" ignores classes you
  already hold.
- Day headers stick while you scroll on phones and read Today / Tomorrow. A restored date pill is scrolled into
  view inside its row.
- Error and empty states have actions (Try again, Tomorrow, Next 7 days, Clear filters, Sign in); server errors are
  classified properly, so the "Showing your last results — couldn't reach Psycle" fallback is reachable. A search
  made while studio data is still loading shows loading, not "No classes found".
- Saved filters restore correctly ("14 days", past dates, Clear filters); hidden Strength / Reformer sub-filters no
  longer filter; pagination no longer skips a class that shares a start time with the last event of a full page;
  tab switches and pull-to-refresh use the real mobile scroller.
- An "S/A" quick filter appears beside Favs once an instructor is ranked S or A.
- "New to you" and "You might like" moved from under the timetable to Stats.

### Waitlist

- The card says what is true — waiting, offer window open, or waitlist closed — and an open place is re-checked
  quietly while the app is visible. **Nothing is ever claimed automatically.**
- The class sheet offers "Claim spot", behind the usual confirm.
- The overnight offer check no longer stops at midnight, remembered places survive a cold launch without
  `/waitlists`, and "already booked" is not said over a mere waitlist place.
- Waitlist copy includes the month for classes more than six days away.

### Offline & PWA

- **The offline queue never spends credits by surprise.** Queued cancels replay on reconnect, on resume and after
  the first bookings load, but only while the booking is still held; they never age out. A booking queued while
  offline is sent automatically only if the app is still open when the connection returns. One found in storage
  after a relaunch is never sent on its own: an "Offline booking" dialog asks first, Discard removes it, and it is
  dropped quietly if the class has started or is already booked. Each item is stamped with its owner, never runs
  under another account, and the queue is cleared on sign-out. My Bookings shows "N changes waiting to sync".
- **Saved copy.** My Bookings keeps a read-only "Saved copy · HH:MM" of your held classes for launches with no
  signal. It is never fed back into live state and is cleared on sign-out, session expiry or account change. An
  offline bar shows when the browser reports offline.
- **Update prompt.** After a deploy the web app picks up the new service worker: it reloads when that is safe
  (hidden or just opened, no dialog or booking in flight), otherwise it shows a banner (`#updateBanner`) reading
  "A new version of Psync is ready." with a Reload button and a dismiss ×. It is guarded against reload loops.
- Service-worker navigations fall back to the cache after 3 seconds on a weak connection.
- App icons, manifest icons and a first-paint theme script, so there is no flash of the wrong theme; the sign-in
  page follows the app theme.
- Instructors, locations and class types honour their 24-hour cache instead of re-downloading on every launch;
  refreshes go through the retry wrapper.

### iOS

- **Calendar safety.** Choosing a calendar for sync used to delete every other upcoming event in it straight away.
  It now counts the events that would go and asks first ("Let Psync manage <calendar>?"). Consent is explicit, an
  old silent consent flag is no longer honoured, and switching calendars never wipes the old one. Re-sync and
  "Remove duplicates" report skipped versus synced truthfully and never reconcile-delete without a live session;
  "Remove duplicates" on a calendar that has not been handed over explains that and offers the hand-over confirm.
- Status bar glyphs were inverted in every theme — fixed (needs a device look, see the checklist).
- Class reminders showed as on without notification permission; the app now asks after a first booking, never at
  launch. Reminders cover every upcoming booking, and booking an earlier class no longer cancels a later reminder.
  A booking whose details failed to load still counts as booked for the widget and reminders.
- Notification taps open My Bookings and the class.
- **Widgets** *(compiles; needs a device check)*: Lock Screen rectangular and inline "next class"; the small Home
  Screen widget shows time, place and seat; tapping a widget opens My Bookings and the class — the tap survives a
  reloaded web view and is dropped after 10 seconds rather than popping late.
- **Live Activity** *(compiles; needs a device check)* shows the new seats after adding or cancelling a seat.
- Settings export and calendar export use the share sheet instead of a dead download link.
- The Preferences restore runs in parallel; the pull-to-refresh pill clears the status bar and Dynamic Island;
  permission copy names the right app.

### Accessibility

- Toasts, the session banner and the Booked! sheet are announced through polite / assertive live regions; longer
  messages stay on screen longer. Toasts raised while a dialog is open are also announced inside that dialog.
- All sheets and modals are real dialogs: labelled, focus moves in, Tab is contained, one Escape closes only the top
  layer, focus returns to the opener. Escape also closes the inline date picker and returns focus to its button.
- Bike-picker seats are keyboard-operable buttons with names and pressed or disabled state.
- Selected state is exposed, not just styled: `aria-pressed` on filter chips, date buttons, calendar days, theme
  chips and tier buttons, `role="switch"` on the reminder rows, `aria-current` on the tab bar. Clickable names and
  rows are reachable and activate with Enter or Space. The notify bell has a real accessible name and pressed state.
- Close buttons, chip removers and booking actions have finger-sized hit areas that do not overlap their
  neighbours.

### Design & copy

- Hard-coded dark-era colours were replaced with tokens, so the class sheet, booking confirmation, banners and
  popups are readable in Cloud and Linen. Accent buttons use `--accent-ink`, tertiary text tokens meet AA, and the
  "Cancel booking" label reaches AA on Cloud and Linen.
- A themed danger colour; a text contrast ladder for Terminal, Synthwave, Handheld and Blueprint; bike-picker seat
  and legend colours from tokens; one late-cancel treatment everywhere; no display face on small labels.
- Radius tokens are used throughout, so the Handheld theme is square (seat tiles included).
- Error and success toasts look different and carry a glyph as well as colour.
- Card buttons wrap instead of crushing text, the theme picker fits at 390px, the calendar button leads the date
  row, Stats sections share one inset, and on desktop the header and tab bar line up with the content column.
- Plurals ("1 class"), class-type-aware nouns, British spelling.
- The share image uses the current brand and theme at 2x, with no dead area.

### Performance

- The Discover list is built in one pass per day instead of card by card: about 1,000 cards render in a fraction
  of the previous script time. The last-results snapshot is written after a short pause instead of on every render.
- Only the first cards animate in; background refreshes do not replay the animation.
- Stats parses history once per render, the history list renders in chunks, carousels keep their scroll position,
  and instructor photos load lazily with an initials fallback.
- Reference data is not re-downloaded on warm launches; the iOS storage restore reads its keys in parallel.
- No haptic tick on automatic searches; a tick on seat pick.

### Stats, Membership, instructors & diagnostics

- **History** now includes classes booked on another device or on Psycle's own site: bookings are reconciled into
  history after each load and a quiet weekly top-up fills gaps. It only runs for the signed-in owner, never marks a
  class cancelled unless there is no seat and it is over 2 hours away, and records that it ran so it stops re-paging
  the whole history on every launch. History keeps up to 2,000 entries for every writer and survives a full
  localStorage.
- "This month", "All time", year-in-review and the share image count only classes that have started. Sharing is not
  offered when it can only fail. A history row with an unreadable date no longer adds a bogus month column.
- **"Notify me when a spot opens"** really checks the class (throttled, at most five at a time). A missing field
  never counts as "open". It opens a "Spot opened — View class" dialog and updates the list.
- Instructor profile: class rows open the class sheet, you can favourite and rank from the profile, and "View
  schedule" lands on Discover. "Unranked" chips open the rankings on Membership; Settings rows open at the right
  section.
- Cost tracker handles unlimited plans, plans without a price and zero-class plans without Infinity or "£0.00";
  its forecast never advises booking more classes than the plan has left. Membership dates parse safely on iOS.
- API drift detection is wired to real responses, with optional fields that cannot raise a false safe-mode banner.
  Bug reports carry a build id and user agent; "Copy diagnostics" works on iOS and no longer claims success when the
  copy failed.
- Dead code removed: unused virtual scroll, a duplicate ICS generator in the service worker, unreachable
  light-theme rules, never-attaching log wrappers (replaced with real action logging), dead cache helpers.

### Tests & tooling

- The unit runner loads every `tests/suites/*.js` after its built-in checks, so each feature area keeps its tests in
  its own file. Suites get `loadPure(file, name)`, which evaluates the DOM-free helpers a module marks with
  `pure:<name>:start/end` comments. A hanging suite now fails the run.
- New suites cover, among others: the double-booking guards in the retry layer, the filter engine and core
  date / slot helpers, script order between the page and the smoke page, the Discover window, clash detection, the
  offline queue, per-account data, import validation, calendar safety, the weekly template and the widget link.
- The smoke page loads the production script order, stubs `fetch` so it cannot reach the live API, and detects a
  module that throws while loading.
- Assertions: 128 → 1,122 → 1,680 → 2,318 → 3,188 → 4,597 → 4,859 across the seven commits.

## Behaviour changes worth knowing

Things a member, or whoever maintains this next, might notice and wonder about:

- **Cached timetables older than 15 minutes refresh in the background.** The list stays up and is swapped in
  place; "spots left" numbers disappear once the data is 30 minutes old. A timetable fetched before Monday 12:00
  London is stale the moment the week opens.
- **A queued offline booking asks before sending after a relaunch.** Only a booking queued in the page session
  that is still open goes out by itself when the signal returns. Queued cancels do go out by themselves — but only
  while the booking is still held.
- **Data is stashed per account.** Signing in as a different customer on the same device sets the previous
  member's rankings, favourites, bike preferences, usual week, recent searches and alerts aside (the last two other
  members are kept) and clears class history, calendar data and the offline queue. Sign-out alone moves nothing.
- **Picking a calendar asks first.** A calendar only becomes fully Psync-managed after the counted "Let Psync
  manage …?" confirm. A calendar picked under the old build is reconciled by marker only until it is handed over.
- **Cancel paths refuse to delete an id they cannot prove.** Right after a multi-seat booking, a per-seat cancel
  may say "Couldn't match … — nothing was cancelled"; a refresh (or a few seconds) resolves it. That is deliberate:
  the alternative was deleting the other seat's record.
- **A booking that Psycle did not confirm reads "Unconfirmed — retry"**, and the next tap checks `/bookings` before
  it offers the picker again. Nothing is re-sent on its own.
- **Book waits.** On a slow launch a Book tap stays on "…" until the session and the member's bookings are
  known, and can end in "Couldn't load your bookings — try again".
- **Losing Psycle is not being signed out.** Offline, a timeout, a 5xx or a 403 keeps the token and shows Retry;
  only a 401 ends the session.
- **Settings import only adds.** It never replaces history, rankings or preferences the device already has.
- **Shortcuts do not change your saved filters.** Find similar, Book again, View schedule and the Monday-reminder
  tap show their own search without replacing what the next launch restores.
- **The web app may reload itself after a deploy** — only when hidden or just opened with nothing in flight;
  otherwise it shows the "A new version of Psync is ready. · Reload" banner.
- **Notification permission is asked after a first booking**, never at launch.
- **"Notify me" only checks while the app is open** and signed in, and says so.

## Deliberately NOT changed — owner decisions

These were looked at and left alone on purpose. Please do not "fix" them in passing.

- **Device-local time remains in a few places.** The widget / Live Activity snapshot (`updateWidgetSnapshot` and
  the Swift `PsycleSnapshot` parser), the T-90 class reminders (`_scheduleClassReminders`) and the web ICS / Google
  Calendar export (js/calendar.js) still read `start_at` in the device's zone — an owner decision: moving them is an
  open follow-up that has not been green-lit, because it touches Swift and changes what a member abroad sees. The
  same device-zone parse also remains in Discover's started-class filter and facet counts (js/app.js `render`,
  `_buildFacetClasses`, `_anyStartedBetween`), the instructor profile's upcoming list (js/features.js) and one
  offline-queue replay re-check (the fresh `/events/{id}` read in js/reliability.js; the queue's own "has it
  started" test is London-resolved). My Bookings (past / upcoming), the late-cancel deadline, countdowns, waitlist
  times, the Monday release, calendar events and the Monday reminder go through the Europe/London resolver.
- **Linen's accent as text, and Terminal / Synthwave accent-ink contrast.** Linen's terracotta accent used as text
  on the page background is about 3.7:1. Terminal and Synthwave define no `--accent-ink`, so labels on their accent
  fill are white at about 3.3:1 and 3.5:1. Readable, below AA for small text, and part of those themes' look.
- **The `file://` CORS-proxy development path** in js/app.js (`IS_FILE` / `PROXY`, with its red warning banner) was
  kept as it is. (Note that the page's content security policy lists only the app's own origin and
  `psycle.codexfit.com` under `connect-src`.)
- **Multi-tab sign-out sync.** Signing out in one tab does not sign out another tab that is already open.
- **The AES key backup sits beside the ciphertext in iOS Preferences.** `psycle_sec_key_backup` is mirrored so an
  IndexedDB purge cannot orphan the encrypted token; the cost is that key and ciphertext share one store. Accepted.
- **Favourites are pre-selected on a first-ever launch.** With favourites saved and no filter state ever saved,
  Discover opens filtered to them. After that the saved filters are the authority — including a saved empty list.
- **App icons are web-only.** `icons/` serves the PWA manifest and the browser; `ios-app/build.js` does not copy it
  into the iOS bundle, where the WebView never fetches them.

## On-device checklist — still owed

None of this could be run on a phone. Each line needs a signed build on a real iPhone (the widget and Live
Activity lines cannot be exercised in an unsigned build at all: without entitlements the widget process cannot
read the App Group).

**Appearance**
- [ ] Status bar glyph colour is right in a light theme (dark glyphs on Cloud / Linen) and in a dark theme (light
      glyphs on Graphite and the flavour themes), including straight after switching theme.
- [ ] The pull-to-refresh pill sits below the Dynamic Island / status bar on Discover and My Bookings.
- [ ] Cold-launch time feels right, and the first paint is in the member's theme with no flash.

**Widgets**
- [ ] Lock Screen **rectangular** and **inline** widgets render with no placeholder on iOS 17+.
- [ ] The small Home Screen widget fits on an SE-class phone with a long class name (the instructor row is the
      one that should drop out).
- [ ] A widget tap opens My Bookings and that class's sheet — from a running app, from the background, and
      **after a force-quit** (cold launch).

**Live Activity**
- [ ] Seat text updates after adding a seat and after cancelling one.
- [ ] A card started by the previous build still renders after updating the app.

**Notifications**
- [ ] The first-booking notification ask appears once, after a first booking, and the iOS prompt follows an in-app
      yes.
- [ ] A T-90 reminder tap opens My Bookings and the class.
- [ ] A Monday reminder tap opens Discover on "Next week" (and does not make it the launch default next time).

**Share sheet**
- [ ] Settings export goes through the share sheet (file, with the text fallback) and the toast tells the truth
      when it is dismissed.
- [ ] ICS / calendar export goes through the share sheet.

**Calendar**
- [ ] The hand-over confirm against a real calendar: the count of events that would go is right, "Choose another"
      changes nothing, "Use this calendar" reconciles, and switching calendars leaves the old one's other events
      alone.

## Known small leftovers

Small, known, and still true at `a9d4a9b`. None affects a booking. The visual ones come from the last browser round.

- **Bike picker on a narrow phone.** A seat map wider than the sheet scrolls sideways, but nothing hints that it
  does (no partial seat, fade or scrollbar), so a whole column can sit out of view. Seen with a synthetic wide
  layout at 390px; worth checking against a real wide studio.
- **A few hard-coded values still bypass the tokens.** The base booked-button style (`.book-btn.booked`:
  `#1a1020` / `#e94560`) is what "Cancel booking" and "Leave waitlist" wear in Terminal, Synthwave, Handheld and
  Blueprint — readable, but off-palette in Handheld. The base `.book-btn` radius (5px) and the class sheet's top
  corners (16px) are fixed too, so they stay rounded in Handheld, where every radius token is zero.
- **Graphite's "Cancel booking" / "Leave waitlist"** use the sage accent outline (a deliberate rule in
  css/theme.css), so the destructive action does not look destructive there; the other themes tint it red or pink.
- **My Bookings export row:** the calendar emoji in "Add to Calendar" sits tight against the label.
- **Handheld, usual-week card at 375px:** a wider time ("Fri 12:30pm") pushes that row's label slightly out of line
  with the rows above.
- **Discover cards:** when the instructor line wraps, the "·" separator is left at the end of the first line.
- **Class sheet with no instructor photo** shows an empty disc rather than initials (cards and lists do have the
  initials fallback).
- **Terminal is the lowest-contrast theme.** Numbers on available seats and the disabled "Full" button are legible
  but dim; Synthwave's booked-seat label is similar. (Separate from the accent-ink decision above.)
- **Inline date picker and the keyboard.** Stepping to the next or previous month re-renders the grid (`calStep`),
  so keyboard focus drops out of the calendar and has to be tabbed back in. Escape still closes it and returns
  focus to the calendar button.
- **Hidden elements keep stale text.** When the last booking is cancelled while still signed in, the hidden
  next-class pill keeps its old text (it is `aria-hidden`, out of the tab order and invisible); only a sign-out or
  account change empties it. Likewise the "N changes waiting to sync" line is hidden, not emptied, once the queue
  is empty. Neither is visible or announced.
- **Offline-booking dialog after a relaunch** says "(Spot 3)" where the rest of the app would say "Bench 3" or
  "Bike 3": the event cache that knows the class type is gone by then, and the label falls back to "Spot".
- **No-layout bookings have still not been exercised against the live API** (by design — nothing was). Watch the
  error log for `POST /bookings` on a first booking at a studio without a seat map.
