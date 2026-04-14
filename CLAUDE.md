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
├── sw.js                   # Service Worker (cache shell v9)
│
├── js/                     # All JavaScript modules (load order matters!)
│   ├── state.js            # PsycleState (reactive), PsycleEvents (emitter)
│   ├── security.js         # Auth, AES-GCM encryption, XSS protection
│   ├── app.js              # Core: API, search, booking, rendering, class detail sheet
│   ├── theme.js            # Dark/light/auto toggle, skeleton loading, haptics
│   ├── reliability.js      # Retry logic, offline queue, error/action logging
│   ├── interactions.js     # Pull-to-refresh, swipe-to-cancel, filter persistence
│   ├── performance.js      # Debounce, virtual scrolling, stale-while-revalidate
│   ├── calendar.js         # ICS generation, Google Calendar links
│   ├── features.js         # Class history, instructor profiles, notifications
│   ├── tabs.js             # 3-tab navigation, Profile rendering, share card, weekly planner
│   ├── settings.js         # Settings panel, tiers, bike prefs, bug report
│   └── explore.js          # Instructor discovery, history sync, recommendations
│
├── css/                    # All stylesheets — fully tokenized design system
│   ├── styles.css          # Core layout, class cards, booking UI, desktop layout
│   ├── theme.css           # Design tokens (:root), CSS variables, dark/light themes
│   ├── features.css        # History modal, instructor modal, notifications
│   ├── tabs.css            # Tab bar, insights sections, heatmap, cost tracker
│   ├── settings.css        # Settings panel, tier list, bike prefs, floating pill
│   └── explore.css         # Explore cards, sync banner, unranked chips
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

## Tab Structure (3 tabs)
| Tab | Name | Contents |
|-----|------|----------|
| 1 | **Book a Class** | Weekly planner, search filters (sidebar on desktop), search results, class detail sheets |
| 2 | **My Bookings** | Upcoming bookings (billing period bucketed), subscription bar, history button |
| 3 | **Profile** | All insights (stats, heatmap, cost tracker, class types, variety, lapsed) + instructor discovery (new to you, you might like, instructor map) + share card |

## Design System (css/theme.css :root)

**All visual values are tokenized.** To change the entire app's look, edit only the `:root` block in `css/theme.css`. 923 `var()` references across 6 CSS files point back to these tokens.

### Token Groups

| Group | Tokens | Example |
|-------|--------|---------|
| **Spacing** | `--space-1` (4px) through `--space-12` (48px) | `padding: var(--space-5) var(--space-7)` |
| **Radius** | `--radius-xs` (3px) through `--radius-full` (9999px) | `border-radius: var(--radius-lg)` |
| **Font size** | `--text-2xs` (9px) through `--text-6xl` (28px) | `font-size: var(--text-lg)` |
| **Font weight** | `--weight-normal` (400) through `--weight-extrabold` (800) | `font-weight: var(--weight-bold)` |
| **Shadows** | `--shadow-sm`, `--shadow-md`, `--shadow-lg` | `box-shadow: var(--shadow-md)` |
| **Transitions** | `--transition-fast` (0.12s) through `--transition-spring` (0.3s cubic-bezier) | `transition: color var(--transition-base)` |
| **Colors** | `--bg`, `--bg-panel`, `--border`, `--text`, `--accent`, etc. (~30 tokens) | `color: var(--text-muted)` |

### Color Hierarchy
```
--text-heading  #fff        Headings, high priority
--text          #f0f0f0     Body text
--text-muted    #aaa        Secondary text
--text-dim      #888        Tertiary text, labels
--text-faint    #666        Subtle text
--text-ghost    #555        Very subtle
--text-off      #444        Disabled states
```

### Theming
- Dark values defined in `:root`
- Light overrides in `[data-theme="light"]` (same file)
- Theme follows system by default, user can override to light/dark
- Shadows have separate light-mode values (less intense)

## Key Patterns

**State**: `PsycleState` in state.js — all global state with reactive `subscribe()`.
Window accessors mean you can read/write `instructors`, `_myBookings`, `_eventCache` etc. as bare globals.

**Events**: `PsycleEvents.emit('booking:complete', eventId)` — modules communicate without direct imports.

**Monkey-patching**: reliability.js wraps `apiFetch` for retries and logging, features.js wraps `eventCard` for notify buttons, settings.js wraps it again for tier badges. Chain: settings → features → app.js original.

**Session persistence**: Last search results saved to `sessionStorage` and restored on next visit (Feature 13).

**Slot labels**: `slotLabel(typeName)` returns Bike/Bed/Bench/Spot based on class type. `slotLabelForEvent(eventId)` resolves via event cache.

**Instructor links**: `instrLink(name, id)` wraps any instructor name in a clickable span that opens the profile modal. Used in all cards, lists, and insights.

## Where to Edit

| I want to...                          | Edit this file           |
|---------------------------------------|--------------------------|
| Change the entire visual feel         | css/theme.css (:root block only) |
| Change search/booking logic           | js/app.js                |
| Change class card appearance          | js/app.js + css/styles.css |
| Change class detail sheet             | js/app.js (openClassDetail) + css/styles.css |
| Change tab content/layout             | js/tabs.js + css/tabs.css |
| Add a new Profile section             | js/tabs.js               |
| Change instructor discovery           | js/explore.js            |
| Change instructor modal               | js/features.js + css/features.css |
| Change settings/tiers/prefs           | js/settings.js + css/settings.css |
| Change colors only                    | css/theme.css (color vars) |
| Change spacing scale                  | css/theme.css (--space-N vars) |
| Change typography scale               | css/theme.css (--text-N vars) |
| Change border radius scale            | css/theme.css (--radius-N vars) |
| Change shadows/transitions            | css/theme.css (--shadow-N, --transition-N) |
| Add iOS-specific feature              | ios-app/www/native-bridge.js |
| Change desktop layout                 | css/styles.css (@media min-width: 1024px) |
| Change bike picker preferences        | js/settings.js (integration section) + css/settings.css |
| Change post-booking confirmation      | js/app.js (showBookingConfirmation) |
| Change "Find similar" rebook          | js/app.js (findSimilar) |
| Change share card rendering           | js/tabs.js (shareInsights, canvas code) |
| Add action logging                    | js/reliability.js (pushAction) |

## User Flows

### Booking Flow
```
Book a Class tab → tap class card → class detail sheet (photo, bio, availability)
  → tap Book → bike picker (with class summary header + preference indicators)
  → select slot(s) → confirm → post-booking confirmation (slide-up)
  → "View bookings" or "Done"
```

### History Sync Flow
```
First login → welcome modal → "Sync my history" → fetches /bookings?type=previous
  → paginates (30 concurrent detail fetches) → merges into localStorage
  → Explore tab + Insights update automatically
```

### Find Similar Flow
```
My Bookings → tap "Similar" on a booking → popup with 3 options:
  → "Same class next week" | "Same instructor, any time" | "Same time, any instructor"
  → auto-sets filters and searches
```

## API
Base: `https://psycle.codexfit.com/api/v1/customer`
Auth: Bearer token via `Authorization` header.

| Endpoint | Used for |
|----------|----------|
| GET /profile | User info, subscriptions, stats, credits |
| GET /instructors | All instructors (id, name, photo, bio, metafields) |
| GET /locations | All studio locations |
| GET /event-types | Class type taxonomy |
| GET /events?start=...&end=...&location=... | Search classes |
| GET /events/{id} | Event detail + available slots + layout |
| GET /bookings | Current/upcoming bookings |
| GET /bookings?type=previous&limit=100 | Past booking history (paginated) |
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

## sessionStorage Keys
| Key | Contents |
|-----|----------|
| psycle_last_results | Last search results (events + relations + filters) for restore on next visit |

## iOS App
- Capacitor 6 wrapper in `ios-app/`
- Sync web assets: `cd ios-app && npm run sync`
- Native features: calendar integration, haptics, local notifications (Monday 11:59 UK), persistent storage
- Bug report: `window.getDiagnosticReport()` returns full device + app + log diagnostics
