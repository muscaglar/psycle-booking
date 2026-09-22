# Ontology — what the words in this code mean
The domain model and vocabulary of Psync: each noun, its exact field names, how the nouns relate, the state machines that decide things, the rules that must stay true. **Read this when** you are about to touch booking, cancel, waitlist, usual-week, offline, session or timetable code, or a name in the code is unclear. **Skip this when** the task is visual only (`agents/architecture/design-system.md`), and skip it when all you want is a file or a line (`agents/index/README.md`) or a step-by-step recipe (`agents/playbooks.md`).

**Never read it whole (≈ 8,600 tokens).** For one word, grep it here. Otherwise read the one section: §1 nouns and field shapes ≈ 3,400 · §2 how they relate ≈ 400 · §3 state machines ≈ 2,250 · §4 words that are easy to confuse ≈ 1,250 · §5 invariants ≈ 1,100.

Conventions used below:
- `snake_case` = a field of Psycle's API. `camelCase` = the app's own shape. A leading `_` on a cache record = derived by the app.
- A function with no file named lives in `js/app.js`; anything else names its file. `pure:<name>` is a marked region of a module that a suite evaluates alone (see §4).
- "Member" = the signed-in Psycle customer, `currentUser`. `currentUser.id` is the **customer id** every `owner` stamp holds.
- Every shape here was read off the code. Where this file and the code disagree, the code is right: fix this file.

---

## 1. The cast

### 1.1 Psycle's nouns (what the API sends)

| Noun | Arrives from | Fields the app reads | What to know |
|------|--------------|----------------------|--------------|
| **Location** | `GET /locations` (24 h cache, `js/performance.js`) | `id`, `name`, `is_visible`, `handle`; optional `address` | A building ("Psycle Oxford Circus"). **The UI calls it a "studio"**: Discover's studio chips are `selectedLocations`, chip `kind: 'location'`. `_locName` = `name` without the leading "Psycle ". The `/events?location=` filter, a usual-week `locationId` and the travel clash all mean LOCATION |
| **Studio** | `relations.studios` of `/events` and `/events/{id}` only | `id`, `name`, `location_id`, `has_layout` (boolean), `layout.slots[] {id, label?, x, y}`, `layout.objects[] {x, y}` | A room inside a location, kept in `_studioMap` by studio id. `has_layout` ALONE decides seat picker (`true`) or COUNT body (`false`); not a boolean = unknown = nothing may be sent. A list response's record may lack `layout`; the class detail carries it (`_studioFromEventDetail`, `_layoutFromEventDetail`, `pure:book-fresh`). Studio ids and location ids are different id spaces |
| **Instructor** | `GET /instructors` (24 h cache), `relations.instructors` | `id`, `full_name`, `is_visible`; optional `photo`, `image_1`, `metafields`, `bio` | Global `instructors`; `_instrName` on a cache record; printed through `instrLink(name, id)` |
| **Event type** | `GET /event-types` (24 h cache), `relations.event_types` | `id`, `name` | Psycle's own taxonomy ("RIDE 45", "REFORMER: Strength 50"). `_typeName` on a cache record. A usual-week entry matches on `eventTypeId` |
| **Event** (the code also says *class*) | `GET /events?start&end&location` rows; `GET /events/{id}` → `{data, slots, relations}` | required `id`, `start_at`, `studio_id`, `instructor_id`, `event_type_id`, `duration`, `is_fully_booked`; optional `is_waitlistable`, `capacity`, `occupancy`, `capacity_remaining`, `slots`, `is_live_stream`; also read, outside the schema: `max_bookable_slots` | See the bullets below. Required / optional is `SCHEMAS` in `js/api-client.js` (it covers every noun in this table but Studio, plus profile, booking and waitlist) |

What an event's fields mean:
- `start_at` is a **naive London wall-clock string** (`YYYY-MM-DD HH:MM:SS` from the API, and kept in that form in
  `_eventCache`; only a record seeded from a waitlist entry, `_eventCacheEntryFromWaitlist`, carries the `T` form — so
  every reader must accept both: slice the digits or `.replace(' ', 'T')`, never compare whole strings). An
  instant comes only from `_gymClassStartMs` (`pure:gym-time`). Matching, clashes, the Time row and every printed time read
  the DIGITS instead (`_clockOf`, `_clashStartMin`, `_templateWall`, `_timeBandOf`).
- `duration` is minutes. With none, a clash assumes 45 (`CLASH_DEFAULT_MIN`), as does the saved copy's "has it ended" test.
- Spots left = `capacity − occupancy` (`_spotsLeft`). `capacity_remaining` exists only on a record seeded from a waitlist entry.
- `is_fully_booked` + `is_waitlistable` decide Book / Join Waitlist / Full. For notify-me only an explicit `false` means "open".
- `GET /events/{id}`.`slots` = the ids still AVAILABLE, not the layout.
- `max_bookable_slots` = seats per booking (4 on every class observed; `TEMPLATE_MAX_SEATS`). An event that says less is believed.
- `bookable_until` (event) and `extended_booking_period` (credit type) exist in the API. The app reads neither.
- `_eventCache[id]` = the event plus `_typeName`, `_instrName`, `_locName`, `_locFullName`, `_locAddress`, `_studioName`, and
  the provenance flags `_fromWaitlist` / `_fromSnapshot` (+ `_snapshotSeenAt`).

**Category** is the app's noun, not Psycle's. `CATEGORY_MAP` (`pure:core`) has eight entries, each
`{key, label, prefixes, color}` (`color` is a getter for older call sites). The keys:
`RIDE` `STRENGTH` `YOGA` `HIIT` `PILATES` `LAGREE` `BARRE` `OTHER`.
- `getCategory(typeName)` maps an event-type NAME to one. **Equipment first**: a name containing LAGREE or MEGAFORMER is
  Lagree and one containing REFORMER is Pilates, before any discipline word — "REFORMER: Strength" is not Strength.
- `classTypeKey(typeName)` = the key lower-cased = the value of `data-ct` = the key of a class colour and a pictogram.
- Sub-filters match a word in the type name: `STRENGTH_SUBS` (UPPER / LOWER / FULL), `REFORMER_SUBS` (SIGNATURE / STRENGTH).
- Time bands (`TIME_BANDS`): `early` 0–9, `day` 9–17, `evening` 17–24, cut from the hour digits.

### 1.2 Seats, spaces, places

- **Slot = seat = spot = bike = bed**: one numbered position in a studio layout (`layout.slots[].id`). The API says *slot*,
  the code says *seat* or *spot*, the member reads `slotLabel(typeName)`: Bike (Ride) · Bed (Reformer / Pilates) · Machine
  (Lagree) · Bench (Strength) · Spot (anything else, and `slotLabelForEvent` for an uncached class).
- **Space**: a position in a studio with NO layout (`has_layout === false`). It has no number, is booked as a COUNT
  (`POST /bookings {event_id, slots: <n>}`) and is held as one slot-less record each.
- **Place**: a waitlist place. Never a seat.

**Booking RECORD** (server): `GET /bookings?limit=200` returns one record PER SEAT or per space — `id`, `event_id`, `slot`
(singular; absent for a space). One `POST /bookings` may book several seats and answers ONE id.

**Booking ENTRY** (app): `_myBookings[String(eventId)]`, built by `fetchMyBookings`, `_mergeBookedSeats`, `_withoutSeat`:

| Field | Meaning |
|-------|---------|
| `bookingId` | The first record id met, or the id a POST returned; `null` for a place. Not "the" id: a seat is cancelled by it only when `_seatCancelId` says so |
| `bookingIds` | Every record id known for the class, deduped. With `slots` empty its length is the number of SPACES held |
| `slots` | Seat numbers held (`[]` for spaces and places) |
| `slotBookings` | `{slot: recordId}`. After a POST several seats can share one id until `/bookings` is re-read |
| `waitlisted` | `true` = a place and no real seat. The one test everything downstream uses (`_isRealSeat`) |
| `waitlist` | The place, when there is one: `{id, status, addedAt, expiresAt, offer?, unverified?}`. Can ride on a real seat too (`waitlisted: false`) |
| `fromWaitlist` | `true` = the seat came from a place (allocated by Psycle, or claimed) → "From waitlist" badge |

There is **no `spaces` field on an entry**. `spaces` lives on `submitBooking`'s `opts`, a usual-week pick, an offline-queue
item and a saved-copy item. `_bookingsLoadState` is `'pending' | 'loaded' | 'failed'`; until `'loaded'`, `_myBookings` proves nothing.

**Waitlist words** (a separate server resource from bookings):
- *entry* — the server record, normalised by `_normaliseWaitlistEntry` →
  `{id, eventId, status, addedAt, expiresAt, allocatedAt, cancelledAt, event}` (a nested `event`, no flat `event_id`).
  One per member per class.
- *place* — an ACTIVE entry (`_isActiveWaitlistEntry`) as it sits in `_myBookings`.
- *offer* — close to class Psycle emails "claim it" instead of booking the member in. `waitlist.offer` =
  `{available, free, isClassFull, requiredCredits, checkedAt}`, from `GET /waitlist/{entryId}`
  (`_waitlistOfferFromDetail`). Claiming is `claimWaitlistSpot` → `POST /waitlist/{entryId} {confirmed: true}`, after a
  confirm. Never automatic.
- *allocation* — Psycle itself turned a place into a seat (chargeable). `_diffWaitlistPlaces` finds it against
  `psycle_waitlist_places` `{owner, places: {eventId: entryId}, allocated: {eventId: iso}}` → `newlyAllocated`, `ended`.
- Endpoints differ by one letter: `/waitlists/{eventId}` (PUT join, GET mine), `/waitlists/{entryId}` (DELETE leave),
  `/waitlist/{entryId}` (GET offer, POST claim).

### 1.3 The member

| Noun | Source | Fields the app reads |
|------|--------|----------------------|
| **Profile** | `GET /profile` → `currentUser` (`_profileFrom`; only `id` is required) | `id`, `first_name`, `email`, `subscriptions[]`, `stats.credits_remaining`, `available_credits[].remaining` |
| **Subscription / plan** | `_pickActiveSubscription(subs)` → `_activeSubscription`: the first `status === 'active'` with `max_bookings > 0` (capped), else an active one with `period_start` (unlimited) | `name`, `status`, `max_bookings`, `bookings_made`, `period_start`, `period_end`, `upcoming_billing_periods[].start`, `plan.price` or `price` (pence) |
| **Billing period** | `period_start` → `period_end` | `period_end` is the FIRST day of the next period = the reset day. Named by its length (`_mbPeriodWord`, `_mbUsageModel`: 27.5–31.5 days "month", 6.5–7.5 "week", else "period"). A capped plan counts per period, so "left" is said only for a class inside it (`_sheetPlanNote`, `_templatePlanCaution`). The unit is the booking RECORD — one per spot — never the class: `bookings_made` is Psycle's count for THIS period, and the next period's is ours, summed in spots (`_mbSpotsHeld`) |
| **Credits** | pay-as-you-go balance | `stats.credits_remaining`, else the sum of `available_credits[].remaining`. A waitlist offer costs `required_credits` |
| **Data owner** | `psycle_data_owner` | The customer id the stored per-account data belongs to (`_claimDataOwner`, `pure:data-owner`) |

### 1.4 The app's own nouns (what it remembers)

| Noun | Store | Shape | Note |
|------|-------|-------|------|
| **History entry** | `psycle_class_history` (≤ 2000, newest first) | `{eventId (string), typeName, instrName, instrId?, locName, date (= start_at), slots, bookedAt, cancelledAt?, cancelledElsewhere?}` | Writers: `addHistoryEntry`, `_historyReconcile` (`js/features.js` `pure:history`), the sync and weekly top-up (`js/explore.js`). Owner stamp: `psycle_class_history_owner` |
| **Usual-week template entry** | `psycle_weekly_template` | `{dayOfWeek (0 = Sun), hour, minute, locationId, eventTypeId, instructorId, label ("Type · Instructor"), locName?, seats?}` | A weekday plus London wall-clock digits, matched within ±20 min (`TEMPLATE_TOLERANCE_MIN`). `seats` = an integer 1–4, anything else 1 (`_templateSeats`; the same rule as `_uwCardSeats` in `js/tabs.js`) |
| **Plan row** | memory, from `planWeeklyTemplate` | `{index, entry, date, state, eventId, studioId, startAt, typeName, instrName, locName, instructorChanged, clashLine, seats, heldSeats, count, canAdd, maxSeats, beyondOpen, beyondListed}` | Read-only. States in §3.6 |
| **Pick** | memory, sheet → `bookWeeklyTemplate` | `{eventId, studioId, slots, spaces, held, joinIfFull, mayBeClosed}` | `slots` (a seat studio) OR `spaces` (a count studio), never both. Exactly what was on screen; nothing else is ever sent |
| **Offline-queue item** | `psycle_offline_queue` (`js/reliability.js`) | booking `{qid, owner, eventId, slots, spaces, heldAtQueue, timestamp, startAt?, label?, slotWord?}` · cancel `{qid, owner, type: 'cancel', eventId, bookingIds, timestamp, startAt?, label?}` | Stamped by `_stampQueueItem`. Verdicts in §3.4 |
| **Saved copy** | `psycle_bookings_snapshot` | `{v: 1, owner, savedAt, items: [{id, start_at, duration, type, instructor, location, studio, slots, spaces, waitlisted}]}` (≤ 40 items, 14 days) | DISPLAY only (`pure:offline`) |
| **Saved class details** | `psycle_booked_event_details` | `{v: 1, items: [slim event + seenAt]}` (≤ 60, 14 days) | Seeds `_eventCache` (flag `_fromSnapshot`) only for ids the live `/bookings` names (`pure:event-details`) |
| **Discover window** | memory: `window._windowKey` (`start` and `end` day joined by a bar), `_windowEvents`, `_windowRelations`, `_windowFetchedAt`, `_windowPartial`, `_windowHeldEnd`, `_windowLoadError`; disk: `psycle_window_cache` `{key, fetchedAt, events, relations}` (24 h) | ONE all-studios timetable range | `partial` = the events do not fill the key's range: never persisted, never fresh (`_setWindow`, `pure:window`) |
| **Booking horizon** (OBSERVED) | none; arithmetic in `pure:horizon` | `_bookingHorizon(now)` → `{openThrough, listedThrough, lastRelease, nextRelease, lastBatch {from, to}, nextBatch {from, to}}` | *Release* = Monday 12:00 London. *Batch* = the Friday → Thursday week a release opens, 18 to 24 days on. *Listed* = one batch further. Not in the API; advisory only |
| **Theme** | `psycle_theme` | an id of `APP_THEMES` (`js/theme.js`): `cloud` `graphite` `terminal` `gameboy` (shown as "Handheld" — grep the id, never the name) `blueprint`, each `{id, name, base, bg, accent, mono?}` | Retired ids map through `RETIRED_THEMES` |
| **Class colour** | `psycle_class_colours` `{v: 1, intensity, map}` | *swatch* = one of 11 names in `CLASS_COLOUR_PALETTE` (`js/theme.js`: cobalt sky teal jade moss sun ember rose orchid violet slate); *intensity* = `off`, `soft` (default) or `bold` | `map` holds only the member's own choices over `CLASS_COLOUR_DEFAULTS` (`js/theme.js`) |
| **Favourite** | `psycle_fav_instructors` `[instructorId]` → the `favouriteInstructors` Set | | The star |
| **Bike preferences** | `psycle_bike_prefs` `{studioId: {prefer: [slot], avoid: [slot]}}` | | Marked by hand in Settings |
| **Usual spot** | `psycle_bike_history` `{studioId: {instructorId: {slot: count}}}` | | LEARNED: the most-booked slot for that studio and instructor (`_recordBikeHistory`, `_usualSlotForEvent`) |
| **Notify-me watch** | `psycle_notify_watchlist` `[eventId]` | | Checked only while the app is open (`pure:notify`, `js/features.js`: ≤ 5 GETs a pass, ≥ 2 min apart) |

---

## 2. How they relate

```
Location 1──n Studio 1──n Event n──1 Instructor
                │            └──n──1 EventType ──name──▶ getCategory ──▶ Category
                │                                            └─▶ data-ct · class colour · pictogram · slotLabel
                └─ has_layout true  → layout.slots (seats, numbered)
                   has_layout false → spaces (a COUNT, no numbers)

Member (currentUser.id = every `owner` stamp)
  ├─ 0..n Subscription ──_pickActiveSubscription──▶ one _activeSubscription · else credits
  ├─ Event 1──n Booking RECORD (one per seat or space) ─┐
  └─ Event 0..1 Waitlist ENTRY (active = a place) ──────┴─▶ ONE entry: _myBookings[eventId]
                                                              + _eventCache[eventId] (when, where, what)
```

| The app's store | Keyed by |
|-----------------|----------|
| Bike preferences | STUDIO id |
| Usual spot | studio id → instructor id → slot |
| Favourite | instructor id |
| Usual-week entry | weekday + time + LOCATION id + event-type id + instructor id |
| History entry, watch, queue item, saved-copy item, saved class details, waitlist memory | event id |
| Every `owner` stamp (`psycle_data_owner`, queue, saved copy, waitlist memory, history owner) | customer id |

`_myBookings` says only WHAT is held. `_eventCache` says when, where and what kind. A card needs both.

---

## 3. State machines

### 3.1 Session — `_sessionStateFor(hasToken, status)` (`pure:session`; `tests/suites/session.js`)

| Input | State | What follows |
|-------|-------|--------------|
| no token | `signed-out` | Sign-in hero (`_authGateViewFor` → `signin`) |
| 2xx whose body reads as a profile | `signed-in` | `_applyProfile` |
| 401 | `expired` | `showSessionExpired`: token cleared, `_myBookings` and the offline queue KEPT |
| anything else (0 = offline or timeout, 403, 429, 5xx, a 200 that is not a profile) | `unverified` | token KEPT, "Can't reach Psycle — Retry", `_healAuth` re-checks |

One event tells every module: `auth:changed {signedIn, initial, unverified}`.

### 3.2 A booking attempt — `submitBooking` → `_settleUnverifiedBooking` → `_bookingOutcome` (`pure:booking`; `tests/suites/booking.js`)

| The POST's answer | What happens | Button afterwards |
|-------------------|--------------|-------------------|
| 2xx | provisional entry (`_mergeBookedSeats`), then `_scheduleBookingsRefetch` | "Bike 12 ✓" or "Booked ✓", `book-btn booked` |
| 401 | session expiry | "Book" |
| any other 4xx (403, 422 …) = **refused** | Psycle's reason is toasted | "Failed — retry", no `.booked`, nothing pending |
| 409, 5xx, a message containing "already", a timeout or a dropped connection | `/bookings` is re-read within 10 s (`BOOKING_VERIFY_DEADLINE_MS`) → the outcome below | |

| `_bookingOutcome(...).kind` | Meaning | Label | `_unverifiedBookings[eventId]` |
|------------------------------|---------|-------|--------------------------------|
| `booked` | everything asked for is there (COUNT body: more records than `idsBefore`) | ✓ + `.booked` | cleared |
| `partial` | a seat is held here, not all that was asked for | ✓ for what is held | set to the seats still in question — unless `conflict` |
| `none` | no seat in this class | "Book" on a `conflict`, else "Failed — retry" | set — unless `conflict` |
| `unknown` | the re-read was not applied | "Unconfirmed — retry" | set — unless `conflict` |

`conflict` = the server answered below 500 (a 409, or "already"): it refused, so nothing can still land, and the entry is cleared for EVERY kind but `booked` before the kind is looked at (`_settleUnverifiedBooking`) — an unconfirmed 409 does not hold back the next POST. A 5xx or no answer may still land.

While a class sits in `_unverifiedBookings`, the next `submitBooking` runs `_clearUnverifiedBooking` first: no POST goes out until a re-read settles it.

**Label contract**: after `submitBooking` returns, a ✓ in the label AND `.booked` mean `/bookings` (or a clean 2xx) shows a
seat in that class. Readers: the optimistic wrapper in `js/reliability.js` (no ✓ → it drops its entry and its `.booked`),
the haptic in `js/theme.js`, `_bookTemplateSeat`. The class alone is not proof: "Queued" wears `.booked` with no ✓, and
`applyBookedState` prints "Waitlisted ✓" with `.booked` for a place — so a reader also checks `_myBookings[id]` is a real seat.

### 3.3 Waitlist phase — `_waitlistPhase(startAt, now)` (`waitlist:pure`; `tests/suites/waitlist-polish.js`, `tests/unit.js`)

| Time to class | Phase | The card |
|---------------|-------|----------|
| more than 2 h | `auto` | "Waitlisted"; Psycle books the member in |
| ≤ 2 h, or from 22:00 the evening before a class starting 06:00–09:59 (`_waitlistEarlyOffersOpen`) | `offers` | spots are offered, not given; "Check for a spot" leads |
| ≤ 30 min, or started | `closed` | "Waitlist closed" |
| unreadable time | `auto` | claims nothing |

The app ASKS (`GET /waitlist/{id}`) from earlier than it SAYS so: `_inWaitlistOfferWindow` = ≤ 2.5 h, or the same early rule.
With an offer pending the badge reads "Spot available" (the probe says a spot is free) or "Spot offered".

### 3.4 Offline queue — `_offlineQueueDecision(item, now, sameSession, myBookings, ownerId)` (`js/reliability.js` `pure:offline-queue`; `tests/suites/offline-queue.js`)

The first matching row wins.

| Condition | Verdict |
|-----------|---------|
| no item, or no `eventId` | `drop` |
| `item.owner` and `ownerId` both known and different | `drop` |
| `ownerId` unknown (unverified session) | `keep` |
| CANCEL queued in this page session | `send` |
| CANCEL, no `/bookings` map loaded this session | `keep` |
| CANCEL found after a relaunch | `send` while `_queueCancelStillHeld`, else `drop`. Never aged out |
| BOOKING that is live (`_offlineQueueIsLive`: this session AND the `online` replay) and owner-stamped | `send` — or `drop` when `heldAtQueue === false` and a seat is held now |
| BOOKING whose class has started | `drop` |
| BOOKING, no map loaded | `keep` |
| BOOKING whose class is already in `_myBookings` (seat or place) | `drop` |
| BOOKING, anything else | `ask` ("Book it now?") |

### 3.5 Window freshness (`tests/suites/window.js`, `tests/suites/discover.js`)

| Test | Rule | Effect |
|------|------|--------|
| `_windowIsFresh(fetchedAt, now)` (`pure:window`) | age in [0, 15 min) (`WINDOW_FRESH_MS`) AND fetched at or after `_lastReleaseMs(now)` | fresh → filter in memory, no network. Stale → render at once, then `_revalidateIfStale` |
| `_countsFresh(dataAt, now)` (`pure:discover`) | age in [0, 30 min) (`SPOTS_MAX_AGE_MS`) | "Only 2 left" / "N spots left" are printed only while true |
| `window._windowPartial` | set through `_setWindow(…, partial)` | never persisted, never fresh |
| `_cachePlan(cachedKey, start, end)` | `'covers'` · `'overlap'` · `null` | adopt it · show its first days, then fetch · ignore it |

A stamp from the future (the clock moved back) is never fresh.

### 3.6 Usual week (`pure:template`; `tests/suites/weekly-template.js`, `tests/suites/14a-usual-week-sheet.js`)

Plan row `state` — `_templatePlanRow`, plus `'error'` from `planWeeklyTemplate`:

| `state` | Meaning |
|---------|---------|
| `book` | a bookable class was found. Starts ticked only with the usual instructor and not `beyondOpen` (`_uwPlanNote`, `js/tabs.js`) |
| `waitlist` · `full` | full and waitlistable (unticked; a tick means join) · full with no waitlist |
| `booked` · `waitlisted` | a real seat is already held (`canAdd`: fewer seats than asked, and room) · a place is already held |
| `clash` | a hard overlap with a held seat |
| `nolayout` | the studio's `has_layout` is unknown: listed, never bookable here |
| `nomatch` | no candidate class (`beyondListed` turns the words into "Not on the timetable yet") |
| `error` | that day's timetable could not be read |

Run result — `_bookTemplateSeat` → `bookWeeklyTemplate` (`results[i].result`):

| Result | Meaning | The run |
|--------|---------|---------|
| `booked` | the booking GREW by exactly what was shown | carries on |
| `waitlisted` | a ticked waitlist row was joined | carries on |
| `already` · `stale` | what is held no longer reads as the sheet showed it · nothing was shown, or Psycle now allows fewer seats | skipped |
| `clash` · `full` · `opened` · `nolayout` | `opened` = a ticked waitlist row whose class has a spot again: nothing booked, nothing joined | skipped |
| `taken` | a shown spot went (ids on `gone`); nothing was sent, or a 409 | carries on; "Choose again" |
| `joinfailed` | Psycle refused the waitlist join | carries on |
| `refused` | a clean "no" from Psycle (its words on `said`) | STOPS, unless the pick was `mayBeClosed` |
| `partial` | some shown spots landed, or a seat nobody showed | STOPS |
| `unconfirmed` | a seat or a place may exist | STOPS |
| `failed` | the POST may still land (`told`), or the class could not be read | STOPS |
| `queued` | the connection went | STOPS (`stopped: 'offline'`) |
| `notrun` | never reached | |

`stopped` is `''` or `'auth' | 'bookings' | 'offline' | 'failed' | 'user'`.

### 3.7 An empty day in the pager — `_pagerEmptyState(day, n, {opensMs, now, heldEnd})` (`pure:day-pager`; `tests/suites/8b-day-pager.js`)

| Result | When | The day says |
|--------|------|--------------|
| `null` | it has classes, or truly has none | "No classes on this day." |
| `'unopened'` (tested first) | `_dayListedMs(day) > now`: not on the timetable yet | "Booking usually opens Monday 12 October, 12:00" (`_pagerOpensText(_dayOpensMs(day), …)`) |
| `'unknown'` | the day lies past `window._windowHeldEnd` of a provisional window | "Checking the latest timetable…", else "Couldn't check this day" + Try again |

### 3.8 The first-run welcome — `_welcomeDecision(facts)` (`pure:welcome`; `tests/suites/8d-welcome.js`)

The first matching row wins.

| Fact | Answer | `psycle_onboarded_v1` |
|------|--------|-----------------------|
| `completed` or `smoke` | `skip` | untouched |
| `hasToken`, or `historyCount > 3` | `done` | written silently, nothing shown |
| `restorePending` (the iOS storage restore is in flight) | `wait` | untouched; a wordmark-only cover (`is-holding`) |
| `deepLink` or `dialogUp` | `skip` | untouched |
| none of the above | `show` | written when the member finishes or skips |

---

## 4. Words that are easy to confuse

| Words | What each means here |
|-------|----------------------|
| **studio** (UI) · **studio** (API) · **location** | The UI's "studio" is an API *location* (a building). An API *studio* is a room and owns the layout. Filters and usual-week entries hold location ids; bike prefs and the usual spot hold studio ids |
| **event type · category · class type** | Psycle's name and id · the app's eight buckets (`getCategory`) · the category key lower-cased (`classTypeKey`, `data-ct`) |
| **held · booked · waitlisted · unverified** | *held* = a real seat (`_isRealSeat`). *booked* = a plan-row state, a run result, an outcome kind and a CSS class; each is defined in §3, none means "a POST was sent". *waitlisted* = `entry.waitlisted`: a place, no seat. *unverified* is three things: a session state (§3.1), a POST that may have landed (`_unverifiedBookings`), and a remembered place shown while `/waitlists` could not be read (`waitlist.unverified`) |
| **seat · space · place** | a numbered slot · an unnumbered unit in a no-layout studio · a waitlist place (§1.2) |
| **slots** | `layout.slots` = positions. `GET /events/{id}`.`slots` = AVAILABLE ids. The POST body's `slots` = an array of ids OR a count. `entry.slots` = seat numbers held |
| **record id · booking id** | A record id is one server record: one seat or one space. `entry.bookingId` is just one of them; `bookingIds` lists all; `slotBookings[slot]` is a seat's own. `_seatCancelId` decides which may be DELETEd |
| **usual spot · preferred spot · avoided spot** | learned from `psycle_bike_history` · marked by hand as `prefer` in `psycle_bike_prefs` · marked as `avoid` there. `_spotSuggestion` ranks: own pick → near a held seat → usual → preferred → nearest to usual → first free |
| **listed · open** | *listed* = on the timetable (`_dayListedMs`, `listedThrough`). *open* = bookable by the observed model (`_dayOpensMs`, `openThrough`). Both are arithmetic, never Psycle's answer |
| **release · batch** | Monday 12:00 London · the Friday → Thursday week that release opens |
| **refused · failed · unconfirmed** | *refused* = Psycle answered cleanly and said no; nothing is pending. *failed* = the POST may still land, or the class could not be read. *unconfirmed* = nobody can tell whether a seat or a place exists. The button label "Failed — retry" covers refused AND failed: `_unverifiedBookings[eventId]` tells them apart, and only while it is set is the next POST for that class held back |
| **allocated · claimed** | Psycle turned a place into a seat unasked · the member accepted an offer. Both set `fromWaitlist` |
| **saved copy · saved class details** | what is HELD, for display while Psycle has not answered · what the held classes ARE, to paint the first frame. Neither is server truth |
| **provisional** | a window adopted from an older cache while the real range loads (`_windowHeldEnd`); also the local entry written after a 2xx until `/bookings` is re-read |
| **theme · base · flavour · mono** | a registry id · `'light'` or `'dark'` (`APP_THEMES[].base`) · any theme but Cloud and Graphite · Terminal and Handheld (id `gameboy`), where class types wear the theme's accent ladder below `bold` |
| **tint · wash · base · deep · ring · drop** | the card ground at the chosen intensity · always the bold tint (the calm tile) · the strong fill · the ink of the hue · the two glow colours (`CLASS_COLOUR_ROLES`, `js/theme.js`) |
| **compact** | Two meanings already, neither a member preference: (1) the one-line class-card WEARERS — usual-week rows, instructor-profile rows, the welcome's minis (`.t-time.is-compact`, `--type-time-compact`); (2) `.chip.is-compact`, the removable filter-summary chip. A member-facing card-size preference, if one is ever built, is called "density" in code and docs |
| **pure block** | the code between `// ── pure:<name>:start` and `:end` (the waitlist block is spelt `waitlist:pure:start`). DOM-free, loaded alone by `t.loadPure` in a suite. A name may repeat in one file and regions may nest |
| **label contract** | §3.2: what a ✓ on a Book button promises |
| **choose-only mode** | `showBikePicker` with `opts.choose` (`window._chooseSpotContext`): the usual-week sheet's "Change spot". The real map; it books NOTHING; `confirmSpotChoice` hands the ids back, every other exit means "no change". Not `window._changeSpotContext`, which is the real seat swap |
| **focus stash** | `window._focusStash`: the member's own filters, kept per dimension (`loc`, `cat`, `time`) while a "find it" shortcut (`_focusSearch`) shows its own, so the next save does not overwrite them |
| **date row held** | `window._dateRowHeld`: the date on screen came from the Monday reminder's tap, so `saveFilters` (`js/interactions.js`, which wraps the filter toggles) keeps the date ALREADY stored. Released by `_releaseDateRow` |

---

## 5. Invariants

Break one of these and a member can be charged for, or lose, a class. Each line: the rule → where it is enforced → the suite that pins it.

| # | Rule | Enforced in | Pinned by |
|---|------|-------------|-----------|
| 1 | A `POST /bookings` is never re-sent. The one guarded exception: the offline queue's SLOT-body replay, whose 409 is checked against `/bookings` | `apiFetch` in `js/reliability.js` (a POST defaults to 0 retries); `submitBooking` → `_clearUnverifiedBooking` | `tests/suites/reliability.js`, `tests/suites/booking.js` |
| 2 | ✓ + `.booked` only when `/bookings` shows a seat in that class | `_settleUnverifiedBooking`, `_bookingOutcome`, the optimistic wrapper | `tests/suites/booking.js`, `tests/suites/reliability.js` |
| 3 | A COUNT body only for `has_layout === false`, positively known. An unknown studio gets no confirm and sends nothing | `bookClass`, `_studioFromEventDetail`, `_bookTemplateSeat` | `tests/suites/add-spot-studio.js`, `tests/suites/3d-leftovers.js`, `tests/suites/14a-usual-week-sheet.js` |
| 4 | A `waitlisted` entry never reaches the calendar, the widget, reminders, history, the next-class pill or the badge | `_buildCalEventData` and the snapshot / reminder filters in `ios-app/www/native-bridge.js`; `js/calendar.js`; `_historyReconcile` | `tests/suites/history.js` (history), `tests/suites/11-native-snapshot.js` (widget), `tests/suites/ios-polish.js` (reminders), `tests/suites/3d-leftovers.js` (badge, pill). No suite was found that pins the calendar case |
| 5 | The saved copy is painted, never written into `_myBookings` or `_eventCache` | `pure:offline`, `_savedBookingsHTML` | `tests/suites/offline.js` |
| 6 | Stored data moves between accounts only when a verified `/profile` names a DIFFERENT customer id. Never on sign-out or expiry | `_applyProfile` → `_claimDataOwner` → `_swapAccountData` (`_dataOwnerPlan`: `none`, `adopt`, `same`, `switch`) | `tests/suites/data-owner.js` |
| 7 | Stored data is untrusted: coerced where it is read, escaped where it is printed | `pure:stored-data` (`_cleanStoredId`, `_cleanStoredIdList`, `_cleanStoredHistory`, `_cleanStoredTiers`, `_cleanStoredBikePrefs`); `_planSettingsImport` in `js/settings.js` | `tests/suites/import-validate.js` |
| 8 | A time that decides something is London-resolved (`_gymClassStartMs`) or read off the digits. Three paths are device-local on purpose: the widget / Live Activity snapshot, the T-90 class reminders, the web ICS / Google Calendar export (`js/calendar.js`) | `pure:gym-time` here and its twin `_classStartMs` in `ios-app/www/native-bridge.js` — change both together | `tests/unit.js` runs under `TZ=America/New_York`; `tests/suites/bookings-card.js` holds the two resolvers to the same answers |
| 9 | Every wrapper of `submitBooking` forwards all four arguments (`eventId, slots, btn, opts`) | `js/theme.js`, `js/features.js`, `js/reliability.js` (two wrappers) | `tests/suites/reliability.js` |
| 10 | `_commitBookingsHtml(list, html, now)` stays the LAST statement of `renderMyBookings` | `renderMyBookings` | `tests/suites/render-perf.js` |
| 11 | The usual-week run books exactly the spots shown, or nothing. There is no auto-pick and no substitute seat | `_bookTemplateSeat`, `_templatePickSlots`, `bookWeeklyTemplate` | `tests/suites/14a-usual-week-sheet.js`, `tests/suites/weekly-template.js` |
| 12 | A per-seat cancel DELETEs only a record id that is provably that seat's own. A whole cancel waits until every record id is known | `_seatCancelId`, `_recordIdsIncomplete`, `_readyForWholeCancel` | `tests/suites/booking.js` |
| 13 | The booking horizon explains and suggests. It never blocks a booking or hides a class | `pure:horizon`, `pure:week-opened` (the model is written down twice: keep them equal) | `tests/suites/14c-weekly-reminder.js`, `tests/suites/14a-usual-week-sheet.js` |
| 14 | Nothing is ever claimed, joined or booked without a confirm the member saw | `claimWaitlistSpot`, `confirmJoinWaitlist`, `bookTemplateWeek`, the offline queue's `ask` | `tests/suites/offline-queue.js`, `tests/suites/waitlist-polish.js`, `tests/suites/14a-usual-week-sheet.js` |

Why each rule exists, and what went wrong before it did: `agents/learnings.md`. What the owner has decided and will not
reopen (the device-local paths in row 8 among them): `agents/decisions.md`.
