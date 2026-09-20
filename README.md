# Psync — Psycle Class Finder

A fast, independent companion app for Psycle London members: find classes across every studio, book and cancel,
manage waitlist places, and keep an eye on your plan and your habits. It is a vanilla-JS progressive web app
(no framework, no bundler, no build step for the web) with a Capacitor 6 wrapper for iOS.

**What it is not.** Psync is not affiliated with, or endorsed by, Psycle. It has no server of its own: it signs in
with your own Psycle account and talks to the same customer API that Psycle's own booking pages use. Your token
and your data are stored on your device, and the page's content security policy limits where it may send requests
(`connect-src`) to the app's own origin and Psycle's API.

## Features in brief

- **Discover** — one timetable across all studios, filtered instantly in the browser: date presets (Today,
  Tomorrow, 7 days, Next week, 14 days or a picked day), time of day, "Available only", studios, class types,
  instructors, favourites and your S/A-ranked instructors. Cards show how many spots are left while the numbers
  are fresh. The list is cached, refreshes itself quietly, and knows that Psycle opens the next week on Mondays
  at 12:00 London time.
- **Booking** — a seat picker that remembers your usual spot and your prefer / avoid preferences, clash warnings
  when a class overlaps one you already hold, the late-cancel deadline stated before you commit, and a booking
  that is only announced once Psycle really shows it.
- **Waitlists** — join, leave, check for a spot and claim an offer, with the card telling you which phase the
  waitlist is in. Nothing is ever claimed automatically.
- **My Bookings** — every held class with Cancel, "Free cancel until …", Add / Change spot, Similar, Map and
  Share; a read-only saved copy when you open the app with no signal; "Your usual week", which previews every
  class before anything is booked.
- **Stats and Membership** — history, streaks, heatmap, year in review, a shareable stats card, plan usage and a
  cost tracker, instructor rankings and favourites.
- **Offline-aware** — changes made offline are queued and never spend a credit by surprise: a queued booking found
  after a relaunch asks before it is sent.
- **Five themes**, keyboard and screen-reader support throughout, and an installable PWA.
- **iOS app** — calendar sync, Home Screen and Lock Screen widgets, a Live Activity before class, class and
  Monday-release reminders, Siri "next class".

## Run it locally

```bash
git clone <your-repo-url> psycle-booking
cd psycle-booking
python3 -m http.server 8080
# open http://localhost:8080/psycle-finder.html
```

There is nothing to install for the web app. (`npm start` does the same with `npx serve`.) Always serve it over
http rather than opening the HTML file directly — the app shows a red warning if it finds itself on `file://`.

## Test

```bash
npm run ci
```

runs the three core checks that CI also runs on every push:

| Script | What it does |
|--------|--------------|
| `npm run check` | `node --check` on every shipped JavaScript file: `js/*.js`, `sw.js`, the iOS build script and plugin patcher, and the native bridge |
| `npm test` | `node tests/unit.js` — a dependency-free runner that evaluates the app's DOM-free logic (and slices of the real source) in Node, then every suite under `tests/suites/` |
| `npm run drift` | `node ios-app/build.js --check` — fails if the generated iOS web bundle (`ios-app/www/`) or the service-worker cache stamp is out of date with the source |

After editing anything under `js/`, `css/`, the HTML files, `manifest.json` or `sw.js`, regenerate the bundle with
`cd ios-app && npm run build` and commit the result, or `drift` will fail.

`npm run typecheck` is an advisory TypeScript pass over the plain JavaScript. `tests/smoke.html` loads the whole
app in a real browser and checks that every module loads and the critical globals exist. Details: [tests/README.md](tests/README.md).

## How changes are verified in a browser

Unit tests cannot see layout, focus or a full booking flow, so every behavioural change is also driven in a real
browser — **against a stubbed API**. The repo root is served on loopback, the page's `apiFetch` and `fetch` are
replaced with scripted responses, a fake token is seeded, and the flow is driven through the real DOM. The
practical recipe is in [tests/README.md](tests/README.md#driving-the-app-against-a-stubbed-api).

## The one hard rule

`https://psycle.codexfit.com` is **Psycle's real booking system**. A `POST`, `PUT` or `DELETE` there books a bike,
spends a credit, joins or leaves a waitlist, or cancels someone's class.

**Tests, scripts and tooling must never send it a write.** The unit tests never touch the network, the smoke page
answers every request itself, CI runs the browser with every host but loopback unresolvable, and browser
verification stubs the API before anything is clicked. If you are not certain a flow is stubbed, do not click
through it.

## Repository layout

[AGENTS.md](AGENTS.md) is the entry to the architecture guide — the hard rules, the commands, and a reading guide
into the [agents/](agents/) folder: the file tree, script load order and a "where to edit" table
([agents/repo-map.md](agents/repo-map.md)); design tokens and themes, the patterns that keep bookings safe, every
storage key and the API endpoints in use ([agents/architecture/](agents/architecture/README.md), one file per topic).
CLAUDE.md is a pointer to it.

Audit trail: [IMPROVEMENTS-2026-09.md](IMPROVEMENTS-2026-09.md) — the September 2026 improvement programme,
including the checklist of things that still need checking on a real phone.

## iOS app

The Capacitor wrapper lives in `ios-app/`, and the Xcode project is committed. Start with [SETUP.md](SETUP.md)
(`cd ios-app && npm ci && npm run sync && npm run open`). The widget, Live Activity and Siri targets, and how
their data reaches them, are described in [ios-app/NATIVE_FEATURES.md](ios-app/NATIVE_FEATURES.md); the
TestFlight pipeline is in [ios-app/CICD.md](ios-app/CICD.md).

## Licence

MIT, as declared in `package.json`.
