# Booking — the `bookClass` guards, verified bookings, seat-scoped cancel ids, clash warnings, no-layout studios
Read this before you change anything that books, cancels or spends credits. Skip it for the look of the sheets ([sheets-and-dialogs.md](sheets-and-dialogs.md)), waitlists ([waitlist.md](waitlist.md)), offline replay ([offline.md](offline.md)) and the usual-week run ([usual-week.md](usual-week.md)).

**Booking — `bookClass` guards** (in order; each exists because its absence booked, or offered, the wrong thing):
1. *Wait for bookings.* With no `currentUser`, or `_bookingsLoadState !== 'loaded'`, every card reads "Book" —
   held classes included. The tap stays on '…' while the session is re-checked and a `/bookings` snapshot is really
   applied (`_rereadBookingsForVerify`). A class that turns out to be held is shown as held, never re-booked. Signed
   out → a "Sign in to book" confirm.
2. *Latest tap wins.* The busy flag is per button; `bookClass._seq` + `overtaken()` is asked after every await on
   the way to a picker or confirm. An overtaken tap hands its button back (`putBack`) and fails silently. A picker
   someone else opened is never replaced.
3. *Settle the past first.* `_clearUnverifiedBooking` — see below.
4. *Fresh availability write-back.* The `GET /events/{id}` it reads (retries:1) is kept: `_noteFreshAvailability`
   (`pure:book-fresh`) writes `is_fully_booked` / `is_waitlistable` to the cache entry, the loaded window's copy
   of the event AND the facet copy, then re-syncs that class's cards — a class just learned to be full does not
   read "Book" again after the next background re-render.
5. *Studio and layout come from the class detail when the cache cannot say.* `_studioFromEventDetail` takes the
   studio the class itself names (`data.studio_id` first — a saved id can be stale) and only a record with a
   boolean `has_layout`; `_layoutFromEventDetail` supplies a seat map the cached record lacks. A known studio is
   never overridden.
6. *Count body only for `has_layout === false`.* A seat studio with no map to be had, or a studio that cannot be
   resolved at all, ends in "Couldn't load the studio map — try again": no confirm, nothing sent. See No-layout studios.
Full + not held → the waitlist path; exactly one seat left → a direct confirm instead of the picker. Two older
steps run ahead of guard 3: a token about to expire offers "Sign in again first?", and a tap on a class where
only a waitlist place is held goes to `leaveWaitlist` — never the picker, never a second join.

**Bookings are verified, and a booking POST is never re-sent** (guards: tests/suites/reliability.js "a POST is never re-sent" and "POST call sites", booking.js, booking-races.js, offline-queue.js): reliability.js's `apiFetch` retries other verbs
up to 3 times but gives a POST 0 retries by default — a timed-out `POST /bookings` may have booked server-side, so
no tap ever sends it twice (the offline queue's slot-body replay is the one, guarded, exception — see Offline
queue). `submitBooking` is the choke point the picker, the last-seat confirm, the no-layout confirm and the
usual-week run all share (Change spot's `executeSpotSwap` posts its own seat, also with `retries:0`, and has its
own recovery). A clean 2xx is shown at once from a
provisional local entry (`_mergeBookedSeats` keeps seats and record ids already held, so "+ Add spot" never forgets
the first seat) and corrected by a trailing `/bookings` re-read (`_scheduleBookingsRefetch`) — that list is the only
source of per-seat record ids. A timeout, 5xx, 409 or "already…" answer proves nothing: `_settleUnverifiedBooking`
re-reads `/bookings` under a 10s bound (`BOOKING_VERIFY_DEADLINE_MS`) and `_bookingOutcome` (`pure:booking`) says
`booked` / `partial` / `none` / `unknown`. Only what `/bookings` shows is announced; `unknown` reads "Unconfirmed —
retry" and the class stays in `_unverifiedBookings`, so NO further POST for it goes out until a re-read clears it
(`_clearUnverifiedBooking`). Label contract (reliability.js, theme.js and the usual-week run read it): ✓ + `.booked`
ONLY when `/bookings` shows a seat in that class. A refused booking (403 / 422) shows Psycle's own reason and
leaves the button un-booked.

**Seat-scoped cancel ids**: Psycle keeps one booking record per seat, but one POST returns ONE id however many
seats it booked. `_seatCancelId(booking, slotId)` returns a record id only when it is provably that seat's own
(its per-seat id, not shared with another seat — or the only seat holding the only record); otherwise `null` →
a bounded `/bookings` re-read → still `null` → "Couldn't match … — nothing was cancelled". Used by
`cancelBikeSlot` and `upcomingSeatCancel`. Whole-booking cancels (`confirmUnbook`, `upcomingCancel`) first pass
`_readyForWholeCancel`: an entry that cannot list every record it holds (`_recordIdsIncomplete`) is re-read, and
nothing is sent — online or queued — while it still cannot. `_bookingIdsFor` sends each id once. `_withoutSeat`
is what Change spot leaves behind.

**Clash warnings**: `_findClash(evt, bookings, cache, opts)` / `_clashFor(id, fresh, opts)` (`pure:clash`) compare
classes on their wall-clock DIGITS (never `new Date`, never the device zone). `overlap` = shared minutes
(back-to-back does not count); `travel` = different KNOWN locations with under 30 minutes between them. A class
with no duration counts as 45 minutes. An overlap outranks a travel squeeze. Advisory only — the line goes into
the confirm's `warn` text or the picker and never blocks. With `{includePlaces:true}` an overlapping waitlist
PLACE is reported as `place:true` (a real seat always outranks it): the class sheet and `bookClass`'s booking
confirms + picker opt in (`bookClashLine`); joining a waitlist and the usual-week plan and run (`planWeeklyTemplate`,
`_bookTemplateSeat`) stay seats-only — a place must never make the
usual-week run skip a class. (`templateSpotsFor`'s clash LINE, shown in the choose-only picker, does include
places: it is a sentence, and skips nothing.)

**No-layout studios**: 8 of Psycle's 19 studios have `has_layout:false`. Psycle's own client books those with `slots: <count>` (a number, not an array) and the server rejects a slot-less body ("Booking slot required"), so `bookClass` (after an explicit "Book this class?" / "Book another space?" confirm — there is no picker step) passes `{spaces: 1}` to `submitBooking` ONLY when `_studioMap[studioId].has_layout === false` is positively known (an unknown studio never gets a guessed count — and since September 2026 never gets a confirm either). `/bookings` returns one slot-less record per space: `fetchMyBookings` keeps every id in `bookingIds`, the card shows "N spaces", and `_bookingIdsFor` cancels them all. The offline queue carries `spaces` for replay but a COUNT body is never auto-retried (a re-send after a lost response would book another space) — replay re-reads `/bookings` to decide. The usual-week sheet books them the same way since wave 13 (`_bookTemplateSeat`, `{spaces: n}` for the count the row showed — still for `has_layout === false` ONLY, never a guessed count, never retried). Not yet exercised live — watch the error log for `POST /bookings` on a first no-layout booking.

**Which control cancels what** (each whole-cancel dialog is titled only "Cancel this booking?" and does not say how many seats go):

| Control | Function | Scope |
|---|---|---|
| Discover card ✓, or the class sheet's button, at a studio whose `has_layout` is true | `bookClass` → the picker; a tap on your own seat there is `cancelBikeSlot(slotId, eventId)` | one seat |
| Discover card ✓ at a studio whose `has_layout` is false — OR that was not in `_studioMap` when the button was wired (`eventCard`, `applyBookedState`: `!!_studioMap[studioId]?.has_layout`, read once) | `confirmUnbook` | whole booking |
| Discover card ✓ between a 2xx and the trailing refetch: `submitBooking` wires `confirmUnbook` until `_resyncDiscoverButtons` → `applyBookedState` re-wires it (that pass skips a busy button and never runs if the refetch fails) | `confirmUnbook` | whole booking |
| My Bookings primary ("Cancel booking" / "Cancel all N"), and swipe-to-cancel, which clicks `.mb-primary-btn.booked` | `upcomingCancel` | whole booking |
| My Bookings seat chip × | `upcomingSeatCancel` | one seat |
| Change spot | `executeSpotSwap`: its DELETE is `ctx.bookingId`, which is `_seatCancelId(booking, slotToChange)` — the same proof rule | one seat |
| Offline-queue replay of a queued whole cancel (js/reliability.js `_processOfflineQueueInner`) | the queued `bookingIds`, else `DELETE /bookings?event_id=` | whole booking |

All four cancel functions are wrapped (js/features.js, the iOS bridge): [core-patterns.md](core-patterns.md). Triage of a report: agents/playbooks.md P12.

**Where the per-seat id map comes from**: `fetchMyBookings` builds one entry per `event_id` — `bookingIds.push(b.id)`, `slotBookings[Number(b.slot)] = b.id`. The API field is `slot`, singular; a slot-less record is a no-layout space. `_mergeBookedSeats` writes the ONE id a POST returned onto every new seat until that re-read. The entry's shape: agents/ontology.md → "Booking ENTRY". `slotBookings` and `bookingIds` are object fields, so agents/index/ cannot find them: grep js/app.js.

**The two per-seat senders differ.** `upcomingSeatCancel` re-reads only while `navigator.onLine`, counts a 404 as gone, edits the LIVE entry after the await, and schedules a trailing refetch. `cancelBikeSlot` re-reads regardless, does not accept a 404, edits the entry object captured BEFORE the DELETE await (and calls `_dropBookingKeepPlace` on the live map when that copy reaches zero seats), and schedules no refetch on success. A display-only "both seats gone" can only come from the second.
