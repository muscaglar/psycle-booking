# Tests

A dependency-free test harness for the Psycle Booking PWA. No framework, no npm
packages, nothing to install. Two deliverables:

| File | Runs in | Covers |
|------|---------|--------|
| `unit.js` | Node (`node tests/unit.js`) | The pure, testable logic of the three resilience-layer modules: `security.js` (escapeHTML), `api-client.js` (PsycleAPI), `diagnostic.js` (PsycleDiag) |
| `smoke.html` | Browser / iOS simulator | Loads ALL real app scripts in production order and asserts the critical globals exist and a few pure functions behave |

## 1. Unit tests — `node tests/unit.js`

Run from the repo root:

```bash
node tests/unit.js
```

Exit code is `0` when everything passes, `1` on any failure (so it slots into
CI). It prints a per-assertion `✓ / ✗` log and a final `N passed, M failed`
summary.

### How it works

There is no DOM in Node, so `unit.js` builds a **minimal browser shim** and uses
Node's built-in `vm` module to evaluate the three modules inside it:

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

Only these **three** modules are loaded — `app.js`, `tabs.js`, etc. need a full
DOM and are out of scope for the Node runner (the smoke page covers them).

### What `unit.js` asserts

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

## 2. Smoke test — `tests/smoke.html`

Open it in a browser or the iOS simulator. The easiest way:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/tests/smoke.html
```

It loads **all** the app's real scripts in the same order as
`psycle-finder.html` (state, security, theme, app, reliability, interactions,
performance, calendar, features, tabs, settings, explore, api-client,
diagnostic) and then asserts that the critical globals exist and are the right
type — `search`, `bookClass`, `submitBooking`, `render`, `escapeHTML`,
`eventCard`, `checkAuth`, `fetchMyBookings`, `bookWeeklyTemplate`,
`getRecentSearches`, `renderInsights`, `openDiagnostics`, `PsycleAPI`,
`PsycleDiag`, `PsycleState`, `PsycleEvents` — plus the `PsycleAPI` /
`PsycleDiag` method surfaces and a few pure checks (`escapeHTML`,
`categorizeError`, `validate`).

The result is written as a big **PASS / FAIL** banner in the page and as the
`document.title` (`SMOKE: PASS` or `SMOKE: FAIL`), so it can be read by a human
or scraped by an automated simulator run. It is resilient: a missing global
becomes a single FAIL line, never a thrown page.

## CI hint

```bash
node tests/unit.js        # exits non-zero on failure
```

The smoke page needs a real browser engine; drive it with whatever headless
browser / simulator your CI has, and check `document.title === 'SMOKE: PASS'`.
