---
name: verify
description: Build and drive the Psycle Class Finder web app end-to-end to verify changes — serve locally, drive with a browser, stub the live API at the fetch boundary.
---

# Verifying psycle-booking changes

## Build + launch
- No bundler for the web app. Serve the repo root: `python3 -m http.server 8080 --bind 127.0.0.1` (needs sandbox-off: the sandbox blocks TCP bind).
- After editing `js/*`, `css/*`, `sw.js`, or top-level HTML, run `cd ios-app && node build.js` — it flattens www/, regenerates the SW SHELL list and content-hashed CACHE version. `npm run drift` must stay green.
- Open `http://127.0.0.1:8080/psycle-finder.html` with Playwright MCP (`browser_navigate`, `browser_evaluate`).
- STALE SERVICE WORKER: the app registers `sw.js` on every load and it precaches js/css under a content-hashed
  cache. After a rebuild, a previously-registered SW keeps serving the OLD modules (smoke shows new globals
  `undefined`; new functions silently missing). Before driving a fresh build run in the page:
  `for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k);`
  then navigate again (the first load after unregistering comes from the network). Sanity-check with
  `(await fetch('/js/app.js',{cache:'reload'}).then(r=>r.text())).includes('<new symbol>')`.

## The live API is a DESTRUCTIVE surface
`https://psycle.codexfit.com` is the real booking system. NEVER drive booking/
cancel/swap flows against it — that includes the waitlist verbs (`PUT /waitlists/{eventId}`,
`DELETE /waitlists/{entryId}`, `POST /waitlist/{entryId}` which BOOKS a seat). Read-only GETs
(/instructors, /locations, /event-types) are public and fine — the app loads live Discover data with no token.

Stub at one of two boundaries inside the page:
- `window.apiFetch = async (path, opts) => ({ ok, status, json: async () => body })` — scripted per-call responses; app code calls the bare global so the stub wins.
- `window.fetch = ...` — use this to exercise the REAL `apiFetchWithRetry` in reliability.js (retry counts, 401/403 policy).

## Seeding app state for booking/swap flows
Required globals (all window-accessible via state.js shims):
```js
await window.securityReady;
await window._secureTokenStore.set('faketoken-123456789'); // signed-in gates check getBearerToken()
window.currentUser = { first_name: 'Test' };
window._eventCache['9001'] = { id, start_at /* 'YYYY-MM-DD HH:MM:SS', future */, duration, studio_id, instructor_id, event_type_id, _typeName, _instrName, _locName, _studioName };
window._myBookings['9001'] = { bookingId, slots: [2], slotBookings: { 2: 'B1' } };
window._studioMap[77] = { id, name, has_layout: true, layout: { slots: [{id,x,y}...], objects: [] } };
```
Gotchas:
- If the token is empty, `fetchMyBookings()` wipes `_myBookings` and flows like `changeSpot` return silently — always set the token first.
- `changeSpot()` refreshes bookings first, so the stub must answer `GET /bookings?limit=200` consistently with the seeded state.
- Stub `window.confirmModal = async () => true` to auto-accept cancel dialogs.
- Drive picker UI via real DOM: `.bike-slot[data-slot="N"]` dispatchEvent click, `#confirmBookBtn`.click(); assert `#modalHint`, `#toast`, `#bikeModal` display.

## Waitlist flows (separate /waitlists resource)
`fetchMyBookings()` now ALSO calls `GET /waitlists?page=1` (paginated via `meta.last_page`) in parallel
with `GET /bookings?limit=200`, then `GET /events/{id}` for any uncached event, and — for any merged place whose
class starts within ~2.5h or whose status/expires_at reads as an offer — a 4th kind, `GET /waitlist/{entryId}`
(after the render, non-blocking). The stub must answer all four (an empty `{data:[], meta:{current_page:1,last_page:1}}`
is fine for waitlists; a non-2xx is fine for the offer probe). A `/waitlists` answer slower than 5s is treated
as "late": bookings render with the last known places and the list re-merges when it lands.
- Seed a place: `window._myBookings['9001'] = { bookingId:null, slots:[], slotBookings:{}, waitlisted:true, waitlist:{ id: 555, status:'waiting', expiresAt:null } }`.
- Join: full+waitlistable event → `bookClass` → confirm → `PUT /waitlists/9001` (expect `{success:true, waitlist:{id}}`; a `422 {message:'You are already on this waitlist'}` must end in the joined state after a `GET /waitlists/9001` lookup).
- Leave: `leaveWaitlist(9001, btn)` / My Bookings "Leave waitlist" → `DELETE /waitlists/555` (a `404` or `500 {message:'…already been cancelled…'}` must count as left). It must NEVER hit `DELETE /bookings…`.
- Claim: `claimWaitlistSpot(9001, btn)` → `GET /waitlist/555` `{data:{id,status,event:{is_class_full:false, available_slot_count:1, required_credits:1}}}` → confirm → `POST /waitlist/555 {confirmed:true}` → then it awaits `fetchMyBookings()` (stub `/bookings` to now include event 9001 with a slot) — success is only toasted once /bookings shows the seat.
- Offer probe: a waitlisted place whose class starts within ~2.5h makes `fetchMyBookings` call `GET /waitlist/{entryId}` (retries:0, throttled 90s per entry via `_offerProbeAt` — clear it between passes); `is_class_full:false` → badge "Spot available" + primary "Claim spot".
- Allocation announcement: `psycle_waitlist_places` remembers held (seatless) places; make an event move from `/waitlists` to `/bookings` between two `fetchMyBookings()` calls → `confirmModal` titled "You're in — Psycle gave you a spot", badge "From waitlist", `waitlist:allocated` in the action log. Memory's `allocated` is only written once the dialog is DISMISSED (use the real `confirmModal` and click `.confirm-btn-cancel`, or a stub that resolves); a stub that never resolves leaves it pending and the next fetch re-announces. `currentUser.id` must be set (owner stamp) or the memory reads as empty. `clearToken()` must remove the key.
- No-layout studio (`has_layout:false`): `bookClass` shows "Book this class?" (or "Book another space?" when a space is already held) and POSTs `{event_id, slots: 1}`; stub `/bookings` to return one slot-less record per space — the card shows "N spaces" and Cancel must DELETE every record id.
- Some non-stubbed background code (e.g. features' watched-events check) may still hit the live API with the fake token → a harmless 401 + "session expired" banner; hide `#sessionBanner` if it gets in the way.
- Live entry shape (for realistic stubs): `{id, status:'waiting', added_at, expires_at, cancelled_at, allocated_at, event:{id, start_at:'YYYY-MM-DD HH:MM:SS', duration, event_type:{id,name}, instructor:{id,full_name}, studio:{id,name,has_layout,location:{name,address}}, is_class_full, available_slot_count, required_credits}}`.

## Quick checks
- `tests/smoke.html` → page title must be `SMOKE: PASS` (32 global checks). Console errors on that page are harness noise (modules loaded without full DOM).
- Known pre-existing console noise on psycle-finder.html: theme.js `injectThemeToggle` insertBefore NotFoundError, favicon 404, CSP frame-ancestors meta warning.
- Playwright `browser_evaluate` results can be huge (page snapshot attached) — keep returned objects small; results over the cap land in a file you must head/grep.

## login.html
Self-contained; stub `window.fetch` and dispatch Enter keydowns. Success writes the legacy `psycle_bearer_token` key (by design — the app migrates it).
