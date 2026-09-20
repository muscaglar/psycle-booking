# Offline — failed cancels, the offline queue, the saved copy and the saved class details
Read this when you touch js/reliability.js's queue, cancel error wording, or what My Bookings shows with no answer from Psycle. Skip it otherwise. The rule behind all of it: a queued item never spends credits by surprise.

**Failed cancels**: only the two whole-booking paths (`confirmUnbook`, `upcomingCancel`) hand an offline cancel to reliability.js's queue, and only they may promise a retry ("cancel queued. We'll send it when you're back online."). Per-seat cancels (`cancelBikeSlot`, `upcomingSeatCancel`) are never queued: `describeCancelError` says "nothing was cancelled" offline, hedges online ("may not have been cancelled" + a /bookings re-read), and never shows raw error text or a bare status code. Thrown errors on booking / waitlist / swap paths are worded by `_friendlyError(e, fallback)` — any suite that slices one of those functions and drives its failure path must also grab it.

**Offline queue** (reliability.js, `psycle_offline_queue`, `pure:offline-queue`): the rule behind every branch of
`_offlineQueueDecision` is that a queued item must never spend credits by surprise, and a cancel the member asked
for is never lost while the booking may still stand. Verdicts: `send` | `ask` | `drop` | `keep`.
- Every item is owner-stamped (`_stampQueueItem`: `qid`, `owner`, class `startAt` + a `label`, because after a
  relaunch the event cache that could name the class is gone; a booking with seats also carries `slotWord` — "Bench",
  "Bike" — so the "Offline booking" dialog still says "Bench 3" then, not "Spot 3". Display only: the replay builds
  its body field by field). Another member's item never runs and is purged at their successor's sign-in; with no
  verified owner yet, everything is kept.
- *Cancels replay while held*: on `online`, on return to the foreground and after the first `/bookings` load
  (`bookings:loaded` arms the drain). One queued in this page session is sent as is; one found after a relaunch is
  sent only while `_queueCancelStillHeld` finds one of its record ids in the loaded list, otherwise dropped.
  Cancels never age out. A 5xx / 401 / 403 keeps the item queued.
- *Bookings auto-send only in the same page session, on the `online` replay that follows them* (one blind replay
  per item). Anything else — found in storage after a relaunch, a legacy item, a failed first replay — is never
  sent on its own: it is dropped quietly if the class has started or is already booked / waitlisted, otherwise an
  "Offline booking" dialog asks "Book it now?" first (Book it / Discard; one attempt per approval). Never asked
  from the list the reconnect found the app with.
- The replay validates the class first (`GET /events/{id}`: gone or started → skipped). A SLOT body is replayed
  with retries — the one place a `POST /bookings` may be re-sent, because a duplicate of the same seat can only
  come back as 409 / "already", and that answer is checked against `/bookings` (`_rereadBookingsForVerify` +
  `_bookingOutcome`) before anything is called booked or "taken while you were offline". A COUNT body (no-layout
  space) is never retried; after a lost or 5xx answer the replay re-reads `/bookings` to decide, and drops the
  item with a "couldn't confirm" toast when it cannot tell.
- Emptied on DELIBERATE sign-out only (the `clearToken` wrapper); session expiry keeps it — the same member signs
  back in and a cancel they believe went through must still be there to send. Cleared on an account switch.
- My Bookings shows "N change(s) waiting to sync with Psycle" (`#offlineQueueStatus`, `queue:changed`); with nothing
  waiting the line is hidden AND emptied (`_renderQueueStatus`).

**Saved copy vs saved class details** — two different stores, neither ever fed back as server truth:
- *Saved copy of My Bookings* (`psycle_bookings_snapshot`, `pure:offline`): display fields of each held class,
  written after every list Psycle confirms and every local change on top of one. PAINTED read-only (no buttons, no
  handlers, labelled "Saved copy · HH:MM") while this session has no answer from Psycle — an offline launch, a
  failed load. Never written into `_myBookings` / `_eventCache`: the calendar reconcile, widget and reminders read
  those and must only follow what the server said. Owner-stamped; another account's copy is never painted; deleted
  on sign-out, session expiry and account change (a token merely not in memory yet is not an ending). The iOS
  bridge reads it for one thing only: the when/what of a class the LIVE list names as held but whose
  `GET /events/{id}` failed (`_evtFromSavedItem`) — it never decides what is held.
- *Saved class details* (`psycle_booked_event_details`, `pure:event-details`): slim event records for the classes
  in the last confirmed list, so My Bookings' first paint after a relaunch does not wait on one
  `GET /events/{id}` per booking. Seeded into `_eventCache` (flagged `_fromSnapshot`) ONLY for ids the current
  `/bookings` answer names; re-read in the background straight after the render (`_refreshSeededEventDetails`);
  dropped after 14 days without a real re-read. Never a source of bookings. A card painted from them may not know
  its studio yet — Change spot, the sheet's seat button and "+ Add spot" wait for / read the class detail first
  (`_ensureStudioKnown`, `_studioFromEventDetail`).
