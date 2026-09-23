# Your usual week — the card, the review sheet, the spot suggestion and the run
Read this in full before you change anything on this path: it spends class credits, and every rule in it exists because of that. Skip it otherwise — it is the longest topic here. Related: [monday-release.md](monday-release.md) (the horizon the sheet reads, the reminder tap that opens it).

### Usual week card and entry colours

**Usual week (weekly template)**: a card in My Bookings (`renderUsualWeekCard` in tabs.js, container `#usualWeekCard` kept right after `#rebookHint`, which it hides while a template exists).

Each entry — and each row of the confirm sheet — is a COMPACT class component (`pure:usual-week-crisp`: tile, day, smaller time), coloured by the entry's TYPE alone (`_uwTypeOf`: the label is "Type · Instructor", and an instructor called Barrett is not Barre); at intensity `off` a row steps down to `--sunken` — NOT `--surface-2`, where Handheld's `--text-muted` (the row's `--ct-ink-2` copy) is 3.8:1; tests/suites/9a-foundation.js holds every ink on the ground a `[data-ct]` row really uses at `off`;

### The card as a disclosure

The card is a DISCLOSURE (`pure:usual-week-card`: `_uwCardHtml(template, collapsed)`; tests/suites/14b-usual-week-card.js): the head — `<h2><button class="usual-week-toggle" aria-expanded aria-controls="usualWeekBody">` ("Your usual week" over "4 classes · Hide"; no chevron — the Filters bar's rule) plus the ONE primary **"Review and book"** (`.week-template-book`, `onclick="bookTemplateWeek()"` with NO argument, spoken "Review and book your usual week": the owner was "scared to press" a button called "Book my usual week" — it opens a review and books nothing, and now says so; the sheet it opens keeps the title "Book my usual week") — is IDENTICAL in both states, so nothing moves under a thumb; `#usualWeekBody` holds the entries and Update from my bookings · Clear (`aria-label="Clear your usual week"`). Folded, the head is all there is: ONE row, with the primary still on it.

### Collapsing the card with toggleUsualWeek

`toggleUsualWeek()` flips `.is-collapsed` on `#usualWeekCard`, `aria-expanded` and the Show / Hide word IN PLACE (the same node: focus and a screen reader's cursor stay, and the state IS the announcement — no toast, no `announce()`, no scroll) and stores `psycle_usual_week_collapsed` (`'1'` | absent; default EXPANDED; a per-DEVICE preference — not per account, not cleared on sign-out, not exported; mirrored to iOS Preferences, where unfolding REMOVES it too); `renderUsualWeekCard` reads the key at every paint (never cached: in the iOS app the first paint can precede the Preferences restore) and skips the DOM write when the card already says the same thing (`card._uwHtml` — it runs on every bookings / auth event).

The invitation (nothing saved yet) and the signed-out state never fold. No other stylesheet rule may set `display` on `.usual-week-body`.

### Seats on a card entry

An entry may carry `seats` (1–4; absent = 1): 2–4 prints "2 seats" LEADING its second line (the ellipsis takes a line's end, and the count is what spends credits).

**The card and the sheet read that field by the SAME rule** — a NUMBER that is an integer 1–4, anything else 1 (`_uwCardSeats` here, app.js `_templateSeats` there; a numeric string is junk like any other: the app never writes one) — because the card SAYS what the sheet will offer to SPEND; 14b runs both shipped functions over one table, so change them together.

NB the class name `.usual-week-seats` means two things — the card's "2 seats" label and the sheet's seat-count `.seg` — and every rule for either is rooted at its own id (`#usualWeekCard` / `#usualWeekSheet`): keep it so.

What the button opens, and what that may book, is the next paragraph.

### Review sheet and the spend rule

**Usual week — the review sheet and the run** (js/tabs.js `_runUsualWeekSheet`, `pure:usual-week-sheet`; js/app.js `pure:template`, `pure:template-spots`; tests/suites/weekly-template.js + tests/suites/14a-usual-week-sheet.js).

THE RULE ABOVE ALL OTHERS: this path spends class credits, so nothing is ever booked that the member did not SEE and confirm in the sheet — not an extra seat, not a different seat from the ones shown, not an extra class, not on a retry; when in doubt the run STOPS and says so.

NEVER a one-tap spend: `saveWeekAsTemplate` stores the real seats held over the next 7 London days (`_templateFromSeats`; falls back to `detectRecurringSlots`), each entry with `seats` — how many were held (spaces count the same in a studio with no spot map), coerced where it is read (`_templateSeats`: an integer 1–4, anything else 1) and never above the class's own `max_bookable_slots`.

`window.bookTemplateWeek(opts)` opens the sheet — no argument from the card, `{ range: 'newest' }` from the Monday reminder's tap — and it books nothing until its button is pressed.

### Date ranges and Newly opened

- *Dates*: a wrapping `.seg` control over `_templateRanges` — "Next 7 days" and the next THREE Monday–Sunday weeks ("21 Sept" — Psycle books about three weeks ahead, see Booking horizon), plus "Newly opened · Fri 9 – Thu 15 Oct" (the batch the latest release opened, `_bookingHorizon().lastBatch`) FIRST and selected when asked for, or while that release is under 24 hours old. The chosen range is the sheet's first, bold line, then "Nothing is booked until you press the button below." It opens on the newly opened batch when that leads the list, else on the FIRST range with a usual class not yet held (`_templateDefaultStart`, judged off `_myBookings` + `_eventCache` once the bookings are loaded — no network), else the next 7 days.

### planWeeklyTemplate and row states

- *Plan*: the READ-ONLY `planWeeklyTemplate(weekStart, {newest})` (GET /events per day+location) → each entry's class + state (book / waitlist / booked / waitlisted / clash / nolayout / full / nomatch / error) plus `seats`, `heldSeats`, `count`, `canAdd`, `maxSeats`, `beyondOpen`, `beyondListed`, and `ranges` / `rangeId` / `horizon`.

  `beyondListed` (the DAY lies past `horizon.listedThrough` — every Monday before 12:00, the Fri–Sun of the third week) only changes what a `nomatch` row says: "Not on the timetable yet — Psycle adds new dates on Mondays at 12:00", not "No matching class that day".

  A studio is one of two kinds by its `has_layout` flag ALONE: `true` → seats (a list response's record doesn't always carry the seat map, and `_fetchTemplateDay` replaces a richer cached one — the map comes from the class detail, `_layoutFromEventDetail`); `false` → `count`, booked by a COUNT of spaces (see No-layout studios); neither, positively → `nolayout`: listed, never bookable here.

### What starts ticked

- *What starts ticked* (`_uwPlanNote`): only a plain class with the usual instructor, inside what Psycle has opened. Unticked, the member's call every time: a waitlist row, a cover instructor, a class past `_bookingHorizon().openThrough` ("May not be open yet — Psycle opens new dates on Mondays at 12:00" — ADVISORY: it stays tickable) and a class already held with FEWER seats than asked ("1 of 2 seats held — tick to add 1 more": `canAdd` — only the missing seat(s), no seat-count control).

### Seat count and spot suggestion

- *Seats and spots — an opinion, shown, never silent*: each bookable row has a seat count (`_uwSeatOptions`: 1 · 2, and 3 · 4 only when the saved entry asked for them; a waitlist row has none — one place per person) and, once ticked, shows the spot(s) it SUGGESTS before anything is booked.

  `templateSpotsFor` reads that class's detail (read-only; one GET per ticked row, three at a time) and the pure `_spotSuggestion` answers, in order: the member's own pick while it is free · adding to a held class → the free spot closest to the seat held · the usual spot for that studio + instructor (`psycle_bike_history`) · a PREFERRED spot (`psycle_bike_prefs`), the one nearest the usual · the free spot closest to the usual by the layout's own coordinates · the first free one (lowest id). Never an AVOIDED spot while another is free; further seats = the free spots closest to the first (ties → lower id).

  `_spotWhyText` says WHY in a few words ("your usual", "closest to your usual — 9 is taken", "first free"). Changing the seat count re-runs the suggestion with no new read. A count studio shows "N spaces · no spot to choose at this studio".

### Change spot and the seat map

- *Change spot*: the REAL seat map in the picker's choose-only mode (see Seat picker), on freshly read availability. The map sits UNDER the sheet's layer, and app.js's one key handler stands aside while `#usualWeekSheet` is in the page — so the sheet steps OUT of the page while the map is up (`st.choosing`; it neither closes nor takes keys, and `_dialogOpen()` stays true through the picker, so no background dialog slips in) and comes back, scroll offset and focus restored, with "Bike 12 · your pick" — or, from Back / Escape / ×, unchanged. Each row's controls name their class to a screen reader ("Change spot for RIDE 45, Mon 21 Sept").

### Confirm label and plan caution

- *The button counts the spend* (`_uwConfirmLabel`: "Book 3 classes · 4 seats", "… · join 1 waitlist"): only rows whose spots are ON SCREEN are counted and run — while one is still reading it says "Checking the spots…" and is disabled; a row whose read failed is left out and says so (Try again).

  ONE advisory line (`templatePlanCaution` → `_templatePlanCaution`, with the class sheet's `_sheetPlanNote` restraint: a capped plan weighs only seats inside the period `/profile` is counting) appears when the ticked seats are more than Psycle says are left — never a block. That line is written while `[hidden]` and then revealed — silent to a screen reader — so it carries NO `role="status"`: `syncGo` says it (and the waitlist sentence) through `announce()`, once, when it appears or changes.

### Pinned parts and the class list

- *Only what must stay pinned is pinned* (css/crisp.css, the end of `crisp:9d` §7): everything but the class list is pinned, so on a short phone — and in the mono themes, whose lines run longer — the list was squeezed to nothing while "Book …" stayed live.

  The list keeps a floor (a tap row per class, up to three — one `:has()` rule per step); when that and the pinned parts do not fit, the DIALOG scrolls (`overflow-y: auto`; the body's overflow lands in it); `.confirm-actions` is `position: sticky; bottom: 0` on its own surface and owns the dialog's bottom inset (the `.cds-actions` recipe). The long waitlist sentence (`UW_WAITLIST_NOTE`) is on screen only WHILE a waitlist row is ticked.

  The list is a scroller, and a scroller clips at its padding box: it has `--space-2` of inline room inside (taken back outside) so a focus ring at its edge — "Change spot", where focus lands after every spot change; the checkboxes — is whole, and a sticky hairline at each end so a cut row reads as "more below". "Newly opened · Fri 25 Sept – Thu 1 Oct" is two no-wrap halves (`_uwLabelHalves`) and that one segment may wrap between them.

### revealRow keeps the row visible

- *The row the member is on stays on screen* (`revealRow(index, part)` in the sheet, `_uwScrollTopToReveal` in `pure:usual-week-sheet`): because only the list gives, a tick that shows the waitlist sentence or the plan line SHRINKS the list — and the row just ticked, focus and all, slid under its fold (375 × 667: 3px of it left).

  After every change the member makes to a row — a tick / untick (`'pick'`: its label), a seat count, "Try again", the way back from the seat map (`'spots'`: the block under it) — and when the spots read of THAT row lands (`st.on`; a fresh plan forgets it, so the reads of a new list move nothing), the list is scrolled by the least that shows the part just used whole with as much of its row as fits: a row that fits, whole; one taller than the list (a ticked seat row against the two-row floor) filling it.

  It moves the list's OWN `scrollTop`, never `scrollIntoView()` (the dialog is a scroller too, and on iOS the page follows), and measures in LAYOUT px up the `offsetParent` chain, never `getBoundingClientRect()`: the dialog scales in as it opens (`transform: scale(0.96)` → a spring past 1) and a rect is measured through that transform while `scrollTop` is not.

### bookWeeklyTemplate and run outcomes

- *The run books exactly what was shown*: `bookWeeklyTemplate(picks, hooks)` runs the picks SEQUENTIALLY and does nothing without picks; a pick carries `slots` (the very ids on screen) or `spaces`, `held` (what the sheet showed as held), `joinIfFull`, `mayBeClosed`.

  `_bookTemplateSeat(eventId, studioId, want)` re-reads the class and sends ONE `POST /bookings` through `submitBooking` with exactly those slots (bounded again: `_templatePickSlots`, `_templateSeats`). There is NO auto-pick left in it: if ANY shown spot has gone it sends NOTHING (`'taken'`, the ids on `want.gone` → "Bike 9 was just taken — not booked. Choose again") and the run carries on; a pick with no spots, or more seats than the class now allows, is `'stale'`.

  **A ✓ is not "this POST landed"**: the label contract only says `/bookings` shows a seat in the class, and for a class ALREADY held (the "1 of 2 seats held" top-up) the seat held before earns it — so what is held is read BEFORE `submitBooking` (the optimistic wrapper rewrites the entry), and `'booked'` needs the booking to have GROWN by what was shown: every shown spot NEWLY held, or more spaces than before.

  A ✓ over a POST still in `_unverifiedBookings` (a lost / 5xx answer on a held class: the extra seat MAY still land) is `'unconfirmed'` — the run stops; some shown spots newly held — or a seat nobody showed — is `'partial'` (stops); nothing new at all, nothing pending (a 409: the spot went between the GET and the POST) is `'taken'` — that class only; a COUNT body that has not grown is settled by one `/bookings` re-read (a clean 2xx whose body names no record reads the same from there) → `'booked'`, `'refused'`, or `'unconfirmed'` when it cannot be read.

  A ticked waitlist row only asks "still full?" (`joinOnly`): `'full'` → `joinWaitlist(…, {quiet:true})`; a spot that has opened up is `'opened'` — nothing booked (none was shown), nothing joined. A top-up goes out only while the booking still reads as the sheet showed it (`held`; else `'already'` / `'stale'`).

### Run stops and Choose again

- *What stops the run*: it holds the button so it can read `submitBooking`'s label contract — "Book" = taken → carry on; "Unconfirmed — retry" → stop; "Failed — retry" is two things: still in `_unverifiedBookings` (a lost / 5xx answer that MAY have booked) → `'failed'`, stop — the row prints what was just toasted (`want.told`: Psycle's reason when its 5xx gave one, else "…isn't showing in My Bookings — try again"; the toast has faded by the time the summary is read); nothing pending → Psycle answered cleanly and said no → `'refused'`, with ITS words on the row ("Psycle said: …" — `_templateRefusalText` reads the toast `submitBooking` has just raised).

  A refusal stops the run as it always has (credits, plan: the next POST would meet the same wall) — EXCEPT for a `mayBeClosed` class, where "not yet" was the expected answer, and the run carries on. A waitlist join it couldn't confirm either way is `'unconfirmed'` and stops the run; a plain join refusal is `'joinfailed'` and carries on. The run also stops when the session or the connection goes.

  Afterwards "Choose again" (offered for taken / opened / stale) books nothing: it re-plans the same dates with fresh spots shown, for the member to confirm. It keeps WHAT was ticked, not where (`_uwTickOf` → `_uwKeepTick`, `pure:usual-week-sheet`): a tick survives only on a row that is still the same class, in the same state, still (not) a top-up / a cover class — and a top-up only for the same ask; anything else starts by the rule every fresh row starts by, so a seat that went while the class filled never comes back as a PRE-TICKED waitlist join, nor a class just booked at one seat as a pre-ticked "add 1 more". A kept row comes back at the member's OWN seat count (not the saved one), and their "Change spot" pick stands only for that class at that count.

  (`_bookEventHeadless` — book-OR-join on an auto-picked seat — has no caller.)

### The sheet counts as a dialog

- The sheet (`#usualWeekSheet`, own Escape/Tab handler) counts as a dialog in app.js's `_dialogOpen()` / `_ownKeysOverlayUp()`, so background dialogs ("Spot opened", waitlist "You're in", the offline-booking ask, the sync prompt) wait for it rather than open over — or under — a run. So do BOTH iOS asks — the first-booking class-reminder ask (a run emits `booking:complete` per seat, with the sheet still up) and the Monday-reminder offer — through the bridge's `ASK_BLOCKING_IDS`.

  A Monday-reminder TAP that finds the review already up stands down (it must never re-open a sheet the member just closed); one that arrives while "Change spot" has the sheet OUT of the page waits on the picker (`_dialogOpen()`), and both picker exits re-attach the sheet in the same task as they hide the map, so no poll can ever see neither — `_templateWeekRunning` is the second backstop.

  `dismissBookingConfirmation` handles every sheet still carrying the id, so two bookings settling within a fraction of a second cannot strand a "Booked!" sheet.

  Matching is on wall-clock DIGITS (`pure:template`) — never the device zone.

### iOS side effects of a run

**What a run sets off in the iOS app.** Every `submitBooking` in the run passes through the bridge's wrapper (calendar reconcile armed) and emits `booking:complete` (widget snapshot; the first-booking reminder ask, held back by `ASK_BLOCKING_IDS`); the run's closing `fetchMyBookings()` emits `bookings:loaded` (calendar reconcile, widget, T-90 reminders). With a calendar handed over, every seat the run books is therefore ALREADY in the iOS calendar about 1.2 s after the last change; waitlist joins and unconfirmed / failed rows never are (the reconcile reads `_myBookings`, and `_buildCalEventData` skips `waitlisted`). Nothing in js/tabs.js or js/app.js may call the Calendar plugin, and the run never awaits the calendar ([ios.md](ios.md) → "Calendar sync: when it runs").

### Sheet plumbing and post-close hook

**The sheet's plumbing.** `_runUsualWeekSheet(opts)` resolves with NO value when the sheet closes (`close()` is refused while `st.running` / `st.choosing`). A run's outcome lives only in `finish(counts)` — `{booked, waitlisted, failed, skipped, stopped, results[]}` — and one sheet can run more than once ("Choose again" → `load()` → `run()`), so anything that needs "did this review book a seat?" must ACCUMULATE on `st` and be handed out by `close()`. The post-close hook is `window.bookTemplateWeek` (js/tabs.js), straight after `await _runUsualWeekSheet(…)` — where `_offerWeeklyReminder('usual-week-reviewed')` is called.
