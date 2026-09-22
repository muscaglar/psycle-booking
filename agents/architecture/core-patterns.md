# Core patterns — shared state, events, monkey-patching, slot labels, instructor links
Read this when you touch any js/ module for the first time: how modules share state, talk through events and wrap each other's functions. Skip it when you change only CSS, Swift or docs. The other "Key Patterns" paragraphs sit in the topic files beside this one ([README.md](README.md) maps them).

## Key Patterns

**State**: `PsycleState` in state.js — all global state with reactive `subscribe()`.
Window accessors mean you can read/write `instructors`, `_myBookings`, `_eventCache` etc. as bare globals.

**Events**: `PsycleEvents.emit('booking:complete', eventId)` — modules communicate without direct imports. In use:
`auth:changed`, `profile:updated`, `data:owner-changed`, `bookings:loaded`, `booking:complete`, `booking:cancelled`,
`booking:cancel_failed`, `seat:cancelled`, `waitlist:joined|left|claimed|allocated`, `queue:changed`, `theme:changed`,
`classcolours:changed {intensity, map, base, mono}`, `history:synced`, `token:expiring-soon`, `api:drift-detected {reason}`.

**Monkey-patching**: reliability.js wraps `apiFetch` for retries and logging; performance.js wraps `apiFetch` again
for the 24h reference-data cache. features.js wraps `eventCard` for the notify bell (the only `eventCard` wrapper).
Nothing marks an instructor on a card: a star (favourites) is the only mark a member can put on a person, and it
lives in Membership and the instructor profile (agents/decisions.md section 3). settings.js's one monkey-patch is `showBikePicker`
(bike-preference markers). `submitBooking` is wrapped by theme.js (haptics), features.js (history), and
reliability.js twice (optimistic UI, offline queue) — every wrapper must forward all four arguments.

**Slot labels**: `slotLabel(typeName)` returns Bike/Bed/Machine (Lagree)/Bench/Spot based on class type. `slotLabelForEvent(eventId)` resolves via event cache (and answers "Spot" when the class is not cached).

**Instructor links**: `instrLink(name, id)` wraps any instructor name in a clickable span that opens the profile modal. Used in all cards, lists, and insights.

**Wrappers beyond the web four.** In the iOS app ios-app/www/native-bridge.js wraps `submitBooking` a FIFTH time (`_origSubmitBookingNative`: awaits, forwards `arguments`, then arms the calendar reconcile) and also wraps `confirmUnbook`, `upcomingCancel`, `cancelBikeSlot`, `upcomingSeatCancel`, `renderMyBookings`, `pushAction`, `clearToken`, `saveWeeklyTemplate` and `clearWeeklyTemplate`; js/features.js (`patchCancelFunctions`) wraps the four cancel functions on the web too. js/app.js calls `submitBooking(` as a bare global (a top-level function of a classic script), so every call site — the usual-week run included — reaches the LAST wrapper INSTALLED, which is not load order: js/features.js wraps from a `setTimeout`, js/theme.js from a poll that waits for app.js. Arguments are forwarded; never rely on what `submitBooking` or a cancel returns (agents/learnings.md B6). Every wrapper, per name: agents/index/globals.md.
