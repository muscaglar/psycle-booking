# Tests

A dependency-free test harness for the Psycle Booking PWA. No framework, no npm
packages, nothing to install. Three layers:

| Layer | Runs in | Covers |
|-------|---------|--------|
| `unit.js` + `suites/*.js` | Node (`npm test` / `node tests/unit.js`) | The resilience-layer modules loaded whole — `security.js` (escapeHTML), `api-client.js` (PsycleAPI), `diagnostic.js` (PsycleDiag) — the native bridge's Europe/London class-time resolver, and, through the per-feature suites, the DOM-free logic of every other module plus slices of the real shipped functions run against fakes |
| `smoke.html` | Browser / iOS simulator | Loads ALL real app scripts in production order and asserts that every module ran to its end, the critical globals exist and a few pure functions behave |
| Browser verification | A real browser, by hand or scripted | Whole flows (book, cancel, waitlist, offline, sign-in states) driven through the real DOM **against a stubbed API** — see the last section |

**The one rule that applies to all three:** `https://psycle.codexfit.com` is Psycle's real booking system. No test,
script or tool may ever send it a `POST`, `PUT` or `DELETE`. The unit tests never touch the network; the smoke page
answers every request itself; browser verification stubs the API before anything is clicked.

## 1. Unit tests — `node tests/unit.js`

Run from the repo root:

```bash
npm test            # or: node tests/unit.js
npm run ci          # check + test + drift, as CI does
```

Exit code is `0` when everything passes, `1` on any failure (so it slots into
CI). It prints a per-assertion `✓ / ✗` log and a final `N passed, M failed`
summary.

The whole run is pinned to a NON-UK zone (`process.env.TZ = 'America/New_York'`). The gym is in London and the
API's class times are naive UK wall-clock strings, so any code that parses one through the device zone visibly
disagrees with the correct London instant.

### How it works

There is no DOM in Node, so `unit.js` builds a **minimal browser shim** and uses
Node's built-in `vm` module to evaluate the three resilience modules inside it:

- **`localStorage`** — a `Map`-backed fake with `getItem/setItem/removeItem/clear`.
  Used by `diagnostic.js` (schema log + contract) and `security.js` (error log).
- **`document`** — a tiny stub whose `createElement('div')` supports the
  `textContent → innerHTML` escaping that `security.js`'s `escapeHTML` depends on.
  Setting `textContent` stores the text and exposes an HTML-escaped `innerHTML`
  (`&`, `<`, `>`, `"`, `'`). `getElementById` / `body` / `appendChild` are stubbed
  for `diagnostic.js`'s safe-mode banner code path.
- **`window`** — the sandbox's global object doubles as `window`, so each
  module's `window.foo = …` exports become reachable (`sandbox.PsycleAPI`, etc.).
- **`navigator`** — `{ onLine: true }` for `categorizeError`'s network heuristic.
- **`crypto` / `indexedDB`** — *intentionally absent*. That makes `security.js`'s
  `_cryptoAvailable` false so it takes the synchronous no-crypto path at load.
  `escapeHTML` (the only thing we test there) never needs crypto.
- `btoa`/`atob`/`TextEncoder`/`TextDecoder`/`URLSearchParams`/`setTimeout`/
  `console` come from Node natively and are passed straight into the sandbox.

`app.js`, `tabs.js` and the rest need a full DOM and are never loaded whole in Node. Their logic is reached two
other ways — pure blocks and source slices — described below. `ios-app/www/native-bridge.js` IS evaluated whole:
with no `window.Capacitor` it bails at once, but first exports its pure London resolver
(`window._psycleClassStartMs`), whose DST maths is asserted here.

### What `unit.js` itself asserts

- **`escapeHTML`** escapes `<`, `>`, `&`, `"`, `'`; `null`/`undefined` → `""`; and
  the XSS payload `x');alert(1)//` becomes inert — no raw `'`, `<`, or `>`
  survives, so it can neither close a JS string nor open a tag. (The shim escapes
  a *superset* of what real browsers escape — `'` and `"` too — so anything inert
  here is inert in the browser as well.)
- **`PsycleAPI.categorizeError`** maps `{status:401}` → `auth`, `{status:429}` →
  `rate-limit`, `{status:503}` → `server`, `TypeError('Failed to fetch')` →
  `network`, an `AbortError` → `timeout`; each returns a non-empty `userMessage`.
- **`PsycleAPI.validate('event', …)`** returns `ok:true` for a complete event and
  `ok:false` with `start_at` listed in `missing` when that field is absent.
- **`PsycleAPI.field(obj, 'a.b.c', fallback)`** returns the nested value when
  present and the fallback (without throwing) when any segment is absent; also
  accepts an array path.
- **`PsycleAPI.parseJson`** rejects an HTML-content-type response (the corsproxy
  error-page case) — and an HTML body with no content-type — as a `schema` error,
  while still parsing valid JSON.
- **`PsycleDiag.record` + `checkContract`** — after recording a complete `event`
  shape, `checkContract` reports no missing-required drift; after recording one
  missing the required `start_at`, the drift surfaces in `missingRequired`.
- **The London resolver** in the native bridge, across both DST changes, from a New York "device".
- **The waitlist helpers** in `js/app.js` between `// ── waitlist:pure:start` and `// ── waitlist:pure:end`
  (the first pure block, with its original marker spelling): normalising entries, merging places into bookings,
  offer windows and phases, the places diff — evaluated once bare and once with the bridge's resolver on `window`.

### Suites — `tests/suites/*.js`

After its built-in checks the runner loads **every** `tests/suites/*.js` in filename order — nothing to register.
Each file exports one function, sync or async:

```js
'use strict';
module.exports = function (t) {
  t.section('My feature');
  const ctx = t.loadPure('js/app.js', 'my-feature', { /* globals the block needs */ });
  t.eq(ctx._myHelper(2), 4, 'doubles');
  t.ok(ctx._other('x'), 'accepts x');
};
```

`t` carries `ok`, `eq`, `section`, `vm`, `fs`, `path`, `REPO_ROOT`, `JS_DIR`, `makeFakeLocalStorage`, `readSource`
and `loadPure`, and all suites share the runner's pass / fail counters. A suite that throws is reported as one
failure ("suite X crashed") and the run carries on. One file per feature area keeps `unit.js` from becoming the
merge point for every change.

`00-harness.js` sorts first and tests the loader itself. It also installs a **drain guard**: a suite that awaits
something which never settles (a clock shim that swallowed the very timer a promise was waiting on, say) would
otherwise leave Node with an empty event loop — the process exits 0 with no summary and every later suite unrun.
With the guard, that run exits 1 and names the section it stopped in.

#### `t.loadPure(file, name, globals)` and `pure:<name>` markers

Modules mark their DOM-free helpers with comment pairs:

```js
// ── pure:clash:start ── (DOM-free; tests/suites/clash.js evaluates this block)
function _findClash(evt, bookings, cache, opts) { … }
// ── pure:clash:end ──
```

`loadPure` cuts every region carrying that name out of the file (a pair may repeat — `pure:core` and
`pure:booking` do — and the regions are concatenated in file order), evaluates them in a fresh `vm` context seeded
with `globals`, and returns the context. Top-level `function` and `var` declarations are reachable on it; `const`
and `let` are not. It throws when the file has no such block, or a start marker has no end.

Rules for a pure block:

- No `document`, no `window` state, no app globals — anything it needs is a parameter, or is handed in through
  `globals` by the suite.
- Say in the start marker which suite evaluates it, as the existing ones do.
- If a block calls a helper from another block, the suite loads both (or passes the helper in).

Blocks exist today in `js/app.js` (core, gym-time, copy, event-details, a11y, session, data-owner, init-gate,
filters, filter-summary, window, clash, book-fresh, booking, bookings-card, discover, day-pager, stored-data,
tier-filter, offline, bookings-started, render-perf, template, predict, welcome), `js/reliability.js` (retry-auth,
offline-queue), `js/settings.js` (calendar-sync, settings-export, import-validate, build-id), `js/tabs.js`
(cost-forecast, reminder-row, year-review, share, stats-pages), `js/features.js` (history, history-chunks, notify),
`js/explore.js` (history-topup), `js/performance.js` (static-cache), `js/calendar.js` (ics-share),
`js/interactions.js` (swipe-cancel, swipe-nav) and `ios-app/www/native-bridge.js` (widget-link, ios-polish).

#### Suites that slice shipped source by anchor lines

Much of the app's riskiest behaviour lives in functions that touch the DOM and app state — `bookClass`,
`submitBooking`, `fetchMyBookings`, the cancel paths, `findSimilar`. Rather than copy them into a testable shape,
several suites read the SHIPPED source with `t.readSource()`, cut the real function out by anchor lines, and run
it in a `vm` context against fake elements, a scripted `apiFetch` and a hand-wound clock. Two styles are in use:

- by line: from the line that starts with `async function bookClass(` down to the next line that is exactly `}`
  (top-level functions in `app.js` open at column 0 and close with a bare `}`);
- by text: everything between two anchor strings.

What that means when you edit the app:

- Renaming or moving such a function, changing its indentation, or putting a bare `}` at column 0 inside it breaks
  the slice. The suite fails loudly ("cannot slice … (anchor moved?)") instead of passing quietly — update the
  anchor in the suite.
- A sliced function runs WITHOUT the rest of its module, which is why the app guards optional collaborators with
  `typeof x === 'function'` ("the suites run this function on its own"). Keep those guards.
- Any suite that slices a booking / waitlist / swap function and drives its failure path must also grab
  `_friendlyError`, which words every thrown error on those paths.

`tests/suites/shell.js` is different again: it parses `psycle-finder.html` and `tests/smoke.html` and fails when a
`js/*.js` file is not loaded exactly once, when a tag is not `defer` (or is `async`), when a script comes from
another host, or when the smoke page's script list drifts from the app's.

## 2. Smoke test — `tests/smoke.html`

Open it in a browser or the iOS simulator. The easiest way:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
# then open http://127.0.0.1:8080/tests/smoke.html
```

- **Own fetch stub.** `app.js` starts itself the moment it loads (`/instructors`, `/locations`, `/event-types`, and
  `/profile` when this origin holds a token). Before any app script, the page replaces `window.fetch` with a stub
  that answers every request with a 200 and an empty list, and at the end it checks that `window.fetch` is *still*
  that stub. The answer is a 200 on purpose: only a 401 ends a session, so a token stored on this origin survives
  a visit to the smoke page — a 401 would sign you out of the app here.
- **Production script order.** It loads the same scripts in the same order as `psycle-finder.html` (state,
  security, theme, facets, app, reliability, interactions, performance, calendar, features, tabs, settings, explore,
  api-client, diagnostic) — synchronously rather than `defer`red, so each finishes before the next starts.
  `tests/suites/shell.js` fails `npm test` if the two lists drift apart.
- **Load errors count.** Function declarations are hoisted, so `typeof search === 'function'` is true even for an
  `app.js` that died on its first line. A listener installed ahead of every app script collects anything that
  throws while loading, or any script that fails to load, and reports it as a FAIL line.
- **Dozens of checks**: the search / booking / render pipeline, the filter core (`PsycleFacets`), the waitlist
  functions, the Discover Time-row handlers, the weekly template, recent searches and insights, diagnostics, the
  `PsycleAPI` / `PsycleDiag` method surfaces, `PsycleState` / `PsycleEvents`, and a few pure checks (`escapeHTML`,
  `categorizeError`, `validate`, `PsycleFacets.run`).

The result is written as a big **PASS / FAIL** banner in the page and as the
`document.title` (`SMOKE: PASS` or `SMOKE: FAIL`), so it can be read by a human
or scraped by an automated run. It is resilient: a missing global
becomes a single FAIL line, never a thrown page.

## CI

`.github/workflows/ci.yml` runs `npm run check`, `npm run test` and `npm run drift`, installs the iOS wrapper's npm
dependencies so the plugin patcher is exercised (`npm run patch:check`), then runs the smoke page in headless
Chrome with `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"` — no host but the runner itself resolves,
so nothing can reach the live API even by accident. It greps the dumped DOM for the PASS banner's *markup*
(`class="pass">SMOKE: PASS`), because the bare words also appear in the page's own comments. The smoke and
typecheck steps are advisory (`continue-on-error`) for now.

```bash
node tests/unit.js        # exits non-zero on failure
```

## Driving the app against a stubbed API

**The quick way: `tests/tools/fake-psycle.js`.** A ready-made fake Psycle server for a browser. Serve the repo,
open a blank same-origin page (`http://127.0.0.1:8080/__blank__` — a 404 is fine), clear storage, service workers
and caches, then:

```js
(0, eval)(await fetch('/tests/tools/fake-psycle.js', { cache: 'reload' }).then(r => r.text()));
await __H.boot({});                       // writes the REAL psycle-finder.html into this page
await window.securityReady; await window._secureTokenStore.set('faketoken-123456789'); await window.checkAuth();
```

`window.fetch` is the fake server from the app's first line: a 7-day timetable (3 studios, 5 class types, one empty
day, ONE full class), bookings kept in memory — one record per seat, the FIRST id answered per POST, and
`DELETE /bookings/{id}` removes exactly one record. Waitlists are NOT kept: `GET /waitlists` always answers
`data: []` and `PUT /waitlists/{id}` answers `{success: true, waitlist: {id: 555}}` without remembering it, so a
joined place vanishes at the next `fetchMyBookings()`. To hold a place, reassign `__H.serve` before `__H.boot`
(`window.fetch` looks it up on every request) and answer `GET /waitlists` from your own list, in the entry shape of
step 5 below; make another full class with `__H.events[i].is_fully_booked = true`. Not implemented at all (a 404,
listed in `__H.unknown` — assert it stays empty): `DELETE /bookings?event_id=`, `DELETE /waitlists/…`,
`GET` / `POST /waitlist/…`. `__H.writes` records every write, `__H.leaked` anything that tried to
leave, `__H.liveHits()` what the browser's own resource log saw; `__H.swipe(x0, y0, x1, y1)` sends a real touch
sequence and `__H.discover()` reports the day pager. `boot()` can answer "app did not load" when the app is up —
look for `#results` yourself; in that case it returned before installing the toast / announce recorders, so
`__H.toasts` and `__H.announces` stay empty (read `#toast`, `#srStatus` / `#srAlert` instead). One `boot()` per page
load. Clearing storage clears it for that ORIGIN, and the fake `/profile` is customer 1 — an account switch to the
app: use an origin nobody signs in on (`127.0.0.1:8080`, not a `localhost:8080` you use for real). A fresh profile starts behind the first-run welcome: seed `psycle_onboarded_v1='1'`
(and `psycle_history_prompt_dismissed='1'`) unless the welcome is what you are checking. The same server drives
`tests/tools/appstore-capture.html` and `node tests/tools/appstore-shots.mjs`, which rebuild the App Store
screenshots over Chrome's DevTools protocol (true device metrics, no dependencies).

The rest of this section is the by-hand recipe the tool was built from — still the way to script one odd response.

Unit tests cannot see layout, focus order, a dialog stacking over a picker, or a whole booking flow. Those are
checked in a real browser — with the API replaced inside the page. This is the recipe that works.

### 1. Serve the repo root on loopback

```bash
python3 -m http.server 8080 --bind 127.0.0.1
# http://127.0.0.1:8080/psycle-finder.html
```

A fresh profile opens behind the full-screen first-run welcome (`#onboardOverlay`, z-index 9000). Unless the
welcome is what you are checking, set `localStorage.psycle_onboarded_v1 = '1'` before the page loads (a stored
token or a `#bookings` / `#stats` / `#membership` hash also keeps it away).

Use an origin you never sign in on for real — a private window, a separate browser profile, or a different port.
localStorage belongs to the origin, and a stubbed session writes to it: the fake token replaces a real one, and a
stub `/profile` with a different customer id is an **account switch** as far as the app is concerned (the previous
member's rankings and preferences are stashed and their history is cleared — see "Data owner" in
agents/architecture/session-and-accounts.md).

### 2. After a rebuild, get rid of the old service worker

The app registers `sw.js` on every load and precaches the JS and CSS under a content-hashed cache. After
`cd ios-app && npm run build`, a previously registered worker keeps serving the OLD modules — new functions are
silently missing. Before driving a fresh build, run this in the page and then navigate again:

```js
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
```

To be sure, check that the file you changed is the one being served:
`(await fetch('/js/app.js', { cache: 'reload' }).then(r => r.text())).includes('<a new symbol>')`.

### 3. Stub BOTH `window.apiFetch` and `window.fetch`

App code calls the bare global `apiFetch`, so replacing `window.apiFetch` wins over the app's own version and its
wrappers. But `checkAuth()` reads `/profile` with raw `fetch` (it has its own 15-second cap), and anything that
slips past your `apiFetch` ends at `fetch` too. Stub both, for the API host, before anything else:

```js
const API_HOST = 'psycle.codexfit.com';
const calls = [];                       // every request the page made — assert on this
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function answer(method, path, body) {
  calls.push({ method, path, body });
  if (method === 'GET' && path === '/profile') return json({ data: { id: 1, first_name: 'Test', subscriptions: [] } });
  if (method === 'GET' && path.startsWith('/bookings')) return json({ data: BOOKINGS });   // [{ id, event_id, slot }]
  if (method === 'GET' && path.startsWith('/waitlists')) return json({ data: [], meta: { current_page: 1, last_page: 1 } });
  if (method === 'GET' && /^\/events\/\d+$/.test(path)) return json(EVENT_DETAIL[path.split('/')[2]]);
  // …script the verbs this check is about (POST /bookings, DELETE /bookings/B1, PUT /waitlists/9001)…
  return json({ message: 'unscripted ' + method + ' ' + path }, 599);   // loud, and visible in `calls`
}

const realFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = String((input && input.url) || input);
  if (!url.includes(API_HOST)) return realFetch(input, init);            // the app's own files
  return Promise.resolve(answer((init.method || 'GET').toUpperCase(), url.split('/api/v1/customer')[1] || '', init.body));
};
window.apiFetch = (path, opts = {}) =>
  Promise.resolve(answer((opts.method || 'GET').toUpperCase(), path, opts.body));
```

Return real `Response` objects: callers use `.ok`, `.status`, `.json()` and some wrappers `.clone()`.
To exercise the REAL retry layer in `reliability.js` (retry counts, the 401 / 403 policy, a request abandoned at
sign-out), leave `window.apiFetch` alone for that check and script only `window.fetch`.

An unscripted request should fail loudly, never fall through to the network. Finish every run by asserting on
`calls`: the writes you expected, and no others.

### 4. Seed the token through the real store, then let the app load its own state

```js
await window.securityReady;
await window._secureTokenStore.set('stub-token-0000000000');
await checkAuth();          // stubbed /profile → currentUser, then it starts fetchMyBookings()
await fetchMyBookings();    // resolves true once the stubbed /bookings has really been applied
```

With no token, `fetchMyBookings()` empties `_myBookings` and flows such as Change spot return silently. And
`bookClass` refuses to carry on until a `/bookings` answer has been applied in this session — poking `_myBookings`
by hand is not enough, so give the stub a `/bookings` answer that matches the state you want. The profile needs an
`id` (owner stamps for the saved copy, waitlist memory and the offline queue all hang off it).

`fetchMyBookings()` reads, in order: `GET /bookings?limit=200` and `GET /waitlists?page=1` side by side (a
`/waitlists` answer slower than 5 seconds is treated as late), `GET /events/{id}` for any held class it has no
details for, and — for a waitlist place close to class time — `GET /waitlist/{entryId}` after the render.

### 5. Shape the data the way the renderers expect

- **`start_at` in the event cache is T-form** — `YYYY-MM-DDTHH:MM:SS`, no zone, London wall clock. Several
  renderers hand it straight to `new Date()`, and WebKit answers Invalid Date for the space form. (Waitlist entries
  arrive in the space form and the app normalises them; your stubbed `/events` rows and anything you put in
  `_eventCache` should already be T-form.) Use a time in the future.
- **Stub studios WITH a layout unless you are testing the no-layout path.** `bookClass` takes the studio from
  `_studioMap` or from the class detail's `relations.studios`. With `has_layout: false` it skips the picker and asks
  "Book this class?" — and a studio it cannot resolve at all ends in "Couldn't load the studio map". A seat studio
  looks like:
  `{ id: 77, name: 'Ride Studio 1', location_id: 5, has_layout: true, layout: { slots: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 60, y: 0 }], objects: [] } }`,
  and `GET /events/{id}` answers `{ data: {…event}, slots: [<bookable slot ids>], relations: { studios, locations, instructors, event_types } }`.
- A held seat: `/bookings` returns one record per seat, `{ id: 'B1', event_id: 9001, slot: 2 }`. No-layout spaces
  are slot-less records, one per space.
- A waitlist place: an entry in `/waitlists` with a nested `event` (`{ id, status: 'waiting', added_at, expires_at,
  event: { id, start_at, duration, event_type: { id, name }, instructor: { id, full_name }, studio: { id, name,
  has_layout, location: { name, address } } } }`).

### 6. Stub `window.confirmModal` so awaited flows cannot hang

Booking confirms, the cancel-policy dialog, waitlist joins, the calendar hand-over and the offline-booking ask all
`await confirmModal(…)`. A script that awaits `bookClass(…)` with nobody to click the dialog waits for ever:

```js
const asked = [];
window.confirmModal = async (opts) => { asked.push(opts); return true; };   // or false, to test the decline path
```

Assert on `asked` (titles, body, the `warn` line) rather than on the DOM when the copy is what you are checking;
use the real `confirmModal` and click its buttons when focus, Escape or stacking is what you are checking. Note
that acknowledgement-based flows (the waitlist "You're in" announcement) only record their state once the dialog
resolves — a stub that never resolves leaves them pending.

### 7. Drive the real DOM, and read the real outputs

Picker seats are `.bike-slot[data-slot="N"]` (dispatch a click), the confirm button is `#confirmBookBtn`, the hint
is `#modalHint`, toasts land in `#toast`, screen-reader announcements in `#srStatus` / `#srAlert`. Events worth
listening to: `booking:complete`, `booking:cancelled`, `seat:cancelled`, `waitlist:joined|left|claimed|allocated`,
`bookings:loaded`, `auth:changed`.

### 8. Never click through a write against un-stubbed state

If the stub is not installed — a reload dropped it, the service worker served an old page, you are on the hosted
app instead of loopback — then Book, Cancel, Leave waitlist and Claim spot are **real**: they spend a credit, give
up a seat or a waitlist place, for whichever account the page is signed in as. Install the stub first, confirm it
is in place (`window.fetch` and `window.apiFetch` are your functions), and only then click. After any navigation or
reload, install it again. Read-only `GET`s against the live API (timetable, instructors, locations) are harmless;
every other verb is not.
