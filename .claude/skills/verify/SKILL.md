---
name: verify
description: Build and drive the Psycle Class Finder web app end-to-end to verify changes — serve locally, drive with a browser, stub the live API at the fetch boundary.
---

# Verifying psycle-booking changes

## Build + launch
- No bundler for the web app. Serve the repo root: `python3 -m http.server 8080 --bind 127.0.0.1` (needs sandbox-off: the sandbox blocks TCP bind).
- After editing `js/*`, `css/*`, `sw.js`, or top-level HTML, run `cd ios-app && node build.js` — it flattens www/, regenerates the SW SHELL list and content-hashed CACHE version. `npm run drift` must stay green.
- Open `http://127.0.0.1:8080/psycle-finder.html` with Playwright MCP (`browser_navigate`, `browser_evaluate`).

## The live API is a DESTRUCTIVE surface
`https://psycle.codexfit.com` is the real booking system. NEVER drive booking/
cancel/swap flows against it. Read-only GETs (/instructors, /locations,
/event-types) are public and fine — the app loads live Discover data with no token.

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

## Quick checks
- `tests/smoke.html` → page title must be `SMOKE: PASS` (27 global checks). Console errors on that page are harness noise (modules loaded without full DOM).
- Known pre-existing console noise on psycle-finder.html: theme.js `injectThemeToggle` insertBefore NotFoundError, favicon 404, CSP frame-ancestors meta warning.
- Playwright `browser_evaluate` results can be huge (page snapshot attached) — keep returned objects small; results over the cap land in a file you must head/grep.

## login.html
Self-contained; stub `window.fetch` and dispatch Enter keydowns. Success writes the legacy `psycle_bearer_token` key (by design — the app migrates it).
