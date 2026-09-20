# API — every Psycle endpoint the app uses
Read this when you add or change a request, or write a stub. Skip it otherwise. The host is a REAL booking system: nothing you run may send it a write. For call sites with line numbers use the generated index ([../index/README.md](../index/README.md)).

## API
Base: `https://psycle.codexfit.com/api/v1/customer`
Auth: Bearer token via `Authorization` header.
This is Psycle's real booking system — development and tests only ever talk to a stub (tests/README.md).

| Endpoint | Used for |
|----------|----------|
| POST /auth/login | login.html only — `{email, password}` → bearer token (15s timeout; handed to the app by same-origin postMessage, or the plain `psycle_bearer_token` key the app migrates) |
| GET /profile | User info, subscriptions, stats, credits |
| GET /instructors | All instructors (id, name, photo, bio, metafields) — cached 24h |
| GET /locations | All studio locations — cached 24h |
| GET /event-types | Class type taxonomy — cached 24h |
| GET /events?start=...&end=...&location=... | Search classes (rows carry `capacity` + `occupancy`) |
| GET /events/{id} | Event detail + available slots + studio record / layout in `relations` |
| GET /bookings?limit=200 | Current/upcoming bookings (one record per seat) |
| GET /bookings/{id} | One booking record (seat ids for an entry that lacks them) |
| GET /bookings?type=previous&limit=100 | Past booking history (paginated) |
| GET /bookings?start=…&end=…&limit=200 | History sync fallback (date-range read, `YYYY-MM-DD` bounds) when the `type=previous` read finds nothing |
| POST /bookings | Create booking — body `{event_id, slots}`; slots REQUIRED (array of slot ids, or a COUNT for a no-layout studio; "Booking slot required" otherwise). Never auto-retried |
| DELETE /bookings/{id} | Cancel one booking record |
| DELETE /bookings?event_id={eventId} | Whole-class cancel fallback when the entry carries no record id (also used by the offline-queue replay) |
| GET /waitlists?page=N | My active waitlist places (paginated, 10/page; entries carry a nested `event`, no flat event_id) |
| GET /waitlists/{eventId} | My place(s) for one event (`[]` if none; unknown event → 500) |
| PUT /waitlists/{eventId} | Join waitlist → `{success, waitlist:{id}}`; 2nd PUT → 422 "You are already on this waitlist" |
| DELETE /waitlists/{entryId} | Leave waitlist (re-delete → 500 "already been cancelled") |
| GET /waitlist/{entryId} | Entry + event availability (`is_class_full`, `available_slot_count`, `required_credits`) — the emailed-offer page |
| POST /waitlist/{entryId} | `{confirmed:true}` → accept an offered spot (creates a real booking) |
