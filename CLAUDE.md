# Psycle Class Finder — Architecture

## Quick Start
```bash
python3 -m http.server 8080    # serve locally
# open http://localhost:8080/psycle-finder.html
```

## Repo Structure
```
psycle-booking/
├── psycle-finder.html      # Main app entry point
├── login.html              # Login page (extracts auth token)
├── index.html              # Redirect to psycle-finder.html
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker (cache shell)
│
├── js/                     # All JavaScript modules (load order matters!)
│   ├── state.js            # PsycleState (reactive), PsycleEvents (emitter)
│   ├── security.js         # Auth, AES-GCM encryption, XSS protection
│   ├── app.js              # Core: API calls, search, booking, rendering
│   ├── theme.js            # Dark/light/auto toggle, skeleton loading, haptics
│   ├── reliability.js      # Retry logic, offline queue, error/action logging
│   ├── interactions.js     # Pull-to-refresh, swipe-to-cancel, filter persistence
│   ├── performance.js      # Debounce, virtual scrolling, stale-while-revalidate
│   ├── calendar.js         # ICS generation, Google Calendar links
│   ├── features.js         # Class history, instructor profiles, notifications
│   ├── tabs.js             # Tab navigation, Insights rendering, share card
│   ├── settings.js         # Settings panel, tiers, bike prefs, bug report
│   └── explore.js          # Explore tab, history sync, instructor discovery
│
├── css/                    # All stylesheets
│   ├── styles.css          # Core layout, class cards, booking UI, desktop layout
│   ├── theme.css           # CSS custom properties (dark/light), all var() overrides
│   ├── features.css        # History modal, instructor modal, notifications
│   ├── tabs.css            # Tab bar, insights sections, heatmap, cost tracker
│   ├── settings.css        # Settings panel, tier list, bike prefs, floating pill
│   └── explore.css         # Explore tab cards, sync banner, unranked chips
│
└── ios-app/                # Capacitor iOS wrapper
    ├── package.json        # npm scripts: sync, open, build
    ├── capacitor.config.json
    ├── www/                # Flattened web assets (copied by npm run sync)
    │   ├── native-bridge.js  # Capacitor integration (storage, haptics, calendar, notifications)
    │   └── [all JS/CSS flattened here]
    ├── ios/                # Xcode project
    └── appstore-assets/    # Screenshots, icons for App Store
```

## Script Load Order (critical!)
```
state.js → security.js → theme.js → app.js → reliability.js →
interactions.js → performance.js → calendar.js → features.js →
tabs.js → settings.js → explore.js
```
Later modules monkey-patch earlier ones. Don't reorder.

## Key Patterns

**State**: `PsycleState` in state.js — all global state with reactive `subscribe()`.
Window accessors mean you can read/write `instructors`, `_myBookings`, `_eventCache` etc. as bare globals.

**Events**: `PsycleEvents.emit('booking:complete', eventId)` — modules communicate without direct imports.

**Monkey-patching**: reliability.js wraps `apiFetch` for retries, features.js wraps `eventCard` for instructor links, settings.js wraps it again for tier badges. Chain: settings → features → app.js original.

**CSS variables**: All colors use `var(--name, fallback)`. Dark values in `:root`, light overrides in `[data-theme="light"]`. Both defined in theme.css.

## Where to Edit

| I want to...                    | Edit this file           |
|---------------------------------|--------------------------|
| Change search/booking logic     | js/app.js                |
| Change class card appearance    | js/app.js + css/styles.css |
| Change tab content/layout       | js/tabs.js + css/tabs.css |
| Add a new Insights section      | js/tabs.js               |
| Change Explore recommendations  | js/explore.js            |
| Change instructor modal         | js/features.js + css/features.css |
| Change settings/tiers/prefs     | js/settings.js + css/settings.css |
| Change colors/theme             | css/theme.css            |
| Add iOS-specific feature        | ios-app/www/native-bridge.js |
| Change desktop layout           | css/styles.css (@media min-width: 1024px) |

## API
Base: `https://psycle.codexfit.com/api/v1/customer`
Auth: Bearer token via `Authorization` header.

| Endpoint | Used for |
|----------|----------|
| GET /profile | User info, subscriptions, stats |
| GET /instructors | All instructors (id, name, photo, bio) |
| GET /locations | All studio locations |
| GET /event-types | Class type taxonomy |
| GET /events?start=...&end=...&location=... | Search classes |
| GET /events/{id} | Event detail + available slots |
| GET /bookings | Current bookings |
| GET /bookings?type=previous&limit=100 | Past booking history |
| POST /bookings | Create booking |
| DELETE /bookings/{id} | Cancel booking |

## localStorage Keys
| Key | Contents |
|-----|----------|
| psycle_bearer_token | Auth token (plain) |
| psycle_bearer_token_enc | Auth token (AES-GCM encrypted) |
| psycle_class_history | Full booking history (synced from API) |
| psycle_history_synced | ISO date of last history sync |
| psycle_instructor_tiers | {instrId: "S"..."F"} |
| psycle_bike_prefs | {studioId: {avoid: [], prefer: []}} |
| psycle_fav_instructors | [instrId, ...] |
| psycle_saved_filters | Last search filter state |
| psycle_theme | "light", "dark", or "system" |
| psycle_notify_watchlist | [eventId, ...] for availability alerts |
| psycle_error_log | Error entries (max 100) |
| psycle_action_log | User action entries (max 100) |
