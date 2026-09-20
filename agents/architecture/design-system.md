# Design system — tokens, the Crisp Colour layer (css/crisp.css), the colour ladder
Read this when you write or change CSS. Skip it when you touch only JS logic. Related: [theming.md](theming.md) (themes, the light-base specificity trap), [class-type-colours.md](class-type-colours.md), [class-card.md](class-card.md).

## Design System (css/theme.css)

**All visual values are tokenised.** Scales live in the `:root` block of `css/theme.css`; colours live in one
`[data-theme="id"]` block per theme in the same file. Well over two thousand `var()` references across the 9 CSS
files point back to these tokens. redesign.css is layout + typography only and takes every colour from them.

### Token Groups

| Group | Tokens | Example |
|-------|--------|---------|
| **Spacing** | `--space-1` (4px) through `--space-12` (48px) | `padding: var(--space-5) var(--space-7)` |
| **Radius** | `--radius-xs` (3px) through `--radius-5xl` (18px), then `--radius-6xl` 22 · `--radius-7xl` 24 · `--radius-8xl` 28, `--radius-full` (9999px); shape roles `--radius-tile` / `-chip` / `-card` / `-sheet` alias them (Handheld zeroes every one) | `border-radius: var(--radius-card)` |
| **Font size** | `--text-2xs` (9px) through `--text-6xl` (28px); Crisp type ROLES are `--type-*` (never `--text-*`, which is shared with ink colours): `--type-caption` 13 · `-meta` 13.5 · `-body` 15 · `-title` 17 · `-heading` 21 · `-day` 22 · `-time-compact` 21 · `-time` 34 · `-display` 56 · `-time-sheet` 60 · `-numeral` 88 | `font-size: var(--type-time)` |
| **Font weight** | `--weight-normal` (400) through `--weight-extrabold` (800), `--weight-black` (900 — display face only) | `font-weight: var(--weight-bold)` |
| **Shadows** | `--shadow-sm`, `--shadow-md`, `--shadow-lg`; Crisp uses ONE soft neutral shadow in two sizes: `--shadow-soft` (a raised pill / track) and `--shadow-float` (toast, sheet) | `box-shadow: var(--shadow-soft)` |
| **Glow** | Geometry that TAKES a colour where it is used (a `var()` inside a token resolves where it is declared): `--glow-ring`, `--glow-drop`, `--glow-edge`, `--glow-drop-card`; the neutral pick colours `--glow-sel-ring` / `--glow-sel-drop` are per theme. Only for what is selected or yours | `box-shadow: var(--glow-ring) var(--ct-ring), var(--glow-drop) var(--ct-drop)` |
| **Sizes** | `--tap-min` (44px), `--tap-lg` (56px), `--hairline` (1.5px), `--tile-sm/md/lg/xl` (24/28/32/48), `--dot`, `--focus-ring` / `--focus-offset` (the body ink: visible on every class tint — but NOT on an accent fill: Cloud's and Handheld's `--accent` IS `--text`. A control that draws the ring INSIDE itself — `.seg-btn`, the date track, the desktop tab pill — switches it to `--accent-ink` in its accent-filled state; tests/suites/9a-foundation.js finds every such pair) | `min-height: var(--tap-min)` |
| **Transitions** | `--transition-fast` (0.12s) through `--transition-spring` (0.3s cubic-bezier) | `transition: color var(--transition-base)` |
| **Colours** | `--bg` (= `--ground`), `--bg-panel` (= `--surface`), `--bg-deep` (= `--sunken`), `--border`, `--text`, `--accent`, `--accent-ink` (label on an accent fill), `--accent-soft`, `--danger` / `--danger-ink`, badge / skeleton sets, the toast's own set (`--toast-bg` / `-ink` / `-ok` / `-err` / `-track` — inverse on Cloud and Graphite), etc. | `color: var(--text-muted)` |
| **Favourite star** | `--fav` — the one colour of a starred instructor's ★ (`.tier-fav.is-fav`, `.fav-star.fav-on`). Set per theme and held to ≥3:1 (a graphic) on that theme's ground, surface, wells and sunken: Cloud wears the class palette's deep "sun", the dark themes a gold, Handheld its heading lime (tests/suites/10b-themes.js) | `color: var(--fav)` |
| **Class-type colours** | `--ct-<key>-tint / -wash / -base / -deep / -ring / -drop` + `--ct-on-base`, written by `PsycleClassColours` (see Key Patterns). Components never read them: css/crisp.css maps them onto `[data-ct]` as `--ct-tint` … `--ct-drop`, plus `--ct-card`, `--ct-tile`, `--ct-tile-ink`, `--ct-ink`, `--ct-ink-2` | `background: var(--ct-card)` |
| **Fonts** | `--font-display` (Sofia Sans Condensed 600–900 — wordmark, times, big numerals, headings, seat numbers; tabular numerals; NEVER small UI labels or buttons), `--font-body` (Sofia Sans 400–800; Terminal and Handheld swap in a monospace stack). `@font-face` lives in css/theme.css ONLY (build.js de-paths `../fonts/` there and nowhere else) | `font-family: var(--font-display)` |

### The Crisp Colour layer (css/crisp.css)
The look the owner chose ("Crisp Colour": Transit's type and clarity, StudioColour's colour — by CLASS TYPE, and
customisable). It is ONE stylesheet, linked LAST in psycle-finder.html, that overrides the older sheets rather than
editing them; login.html never links it (the iOS copy is flat and a test forbids a stylesheet link) and inlines its
tokens instead. ios-app/build.js discovers it and the fonts by itself. Marked sections, in this order:
- `crisp:9a-foundation` — the ONE `[data-ct]` → `--ct-*` mapping block, the intensity block (`--ct-card`, `--ct-tile`,
  `--ct-ink`, `--ct-ink-2`), and the primitives everything reuses: `.ct-tile`, `.ct-card` (+ `.is-dashed`), `.ct-dot`,
  `.glow-mine` / `.glow-mine-card` / `.glow-selected`, `.pill-btn` + its looks, `.chip`, `.seg`, `.ct-badge`, the type
  roles `.t-time` / `.t-title` / `.t-meta` …, the toast.
- `crisp:9b-discover` — header, tab bar, date row, Filters bar, day strip, and THE CLASS CARD (9b.7 — shared with My
  Bookings; see Key Patterns → The class card). `crisp:9c-sheets` — class sheet, seat picker, dialogs, Booked sheet,
  Find similar, instructor / history modals, banners. `crisp:9d-bookings` — what a held class adds, usage bars, More
  menu, usual week, next-class pill. `crisp:9e-stats-membership` — Stats, Membership, the Class colours control, the
  ONE neutral rank recipe (9e.5), Settings panel, welcome — and the TAB HERO ("Nothing booked — yet", Sign in, Can't
  reach Psycle), keyed on its host CLASS `.tab-empty` (`#bookingsEmpty`, `#statsEmpty`, `#membershipSignin`), never on
  a host id: scoped by id, Bookings was missed once (tests/suites/9f-one-card.js).
- An id-scoped rule here outranks the older sheets' STATE rules too: the desktop grid on `#tab-bookings
  .mb-period-body` (1,1,0) beat `.mb-period-section.collapsed .mb-period-body { display: none }` (0,3,0), so the fold
  is re-stated beside it. Give any rule that sets `display` on a collapsible part its collapsed twin.
- **Tokens only**: no hex, no `rgb()`, no px anywhere in the file, and every `var()` must be defined
  (tests/suites/9a-foundation.js) — a missing step is added to css/theme.css `:root` (and zeroed for Handheld if it is
  a radius). Keep a `:has()` selector in a rule of its own (iOS 15.4+).
- **Glow = "selected, or yours" — nowhere else**: the chosen day (`.day-pill.active`, the inline calendar's
  `.cal-cell.sel`); your class (the shared card rule); your seat (the picker's SVG seats — an under-fill stroke +
  `drop-shadow`, since SVG takes no box-shadow — and the Booked sheet's seat badge); and the ONE primary action of a
  sheet (`#confirmBookBtn` once enabled). The welcome's illustrations draw the same marks. Each section's suite pins
  its own list.
- **Text on a class tint** is only `--ct-ink`, `--ct-ink-2` (= `--text-muted`) or `--ct-deep` — the three the contrast
  matrix holds for every swatch × intensity × theme; never `--text-dim / -faint / -ghost`.
- It wins a TIE with the older sheets (it is last) but not a higher specificity — see Theming for the light-base trap.
- **A shorthand here can drop a safe-area inset.** The Settings header's `padding` shorthand once replaced the older
  sheet's `padding-top: calc(… + env(safe-area-inset-top))`, and on a phone the title sat under the status bar.
  tests/suites/13-safe-area.js finds every selector + property an older sheet gives an inset and fails if this file sets
  it (or its shorthand) without carrying the inset; a deliberate move to another part is listed in that test.

### Colour Hierarchy
Each theme sets its own values; the ladder is the same everywhere. Cloud's, for reference (the Crisp Colour boards'
cool graphite chrome: ground `#e6e9ee`, surface `#fcfdfe`, sunken `#d9dee6`, hairline `#d3d9e1`):
```
--text-heading  #1b2130     Headings (ink 900)
--text          #1b2130     Body text (ink 900)
--text-muted    #3a4252     Secondary text (ink 700)
--text-dim      #485165     Tertiary text, labels
--text-faint    #515b6e     Subtle text
--text-ghost    #566073     Very subtle (ink 500)
--text-off      #8a93a3     Decorative / disabled only
```
In Cloud, muted → ghost all carry real copy and hold ≥4.5:1 on `--bg`, `--bg-panel` and `--bg-deep`; `--text-off` is for
disabled states and control outlines only. Cloud has no hue of its own — its `--accent` is the ink (`#1b2130`, white
label): colour means class type. Graphite is the same system turned over (ground `#12161f`, surface = Cloud's ink 900,
pale accent `#dde3ec` with a graphite label).

### Overlays: the z-index ladder, the frames, where the CSS goes
There are no `--z-*` tokens. The ladder, read off the sheets:

| z-index | What |
|---|---|
| 150 | `.next-class-pill` |
| 200 | `.modal-overlay` — the picker, the class sheet's ROOT, the sync prompt |
| 210 | `.class-detail-sheet` (the inner sheet) |
| 250 | `.history-modal`, `.instructor-modal`, `.year-review-modal` |
| 300 | `.settings-overlay`, `.token-dialog` |
| 320 | `.diag-overlay` |
| 998 | `.usual-week-overlay` |
| 999 | `.toast` |
| 1000 | `.confirm-overlay`, `.pull-indicator` |
| 1100 | `.booking-confirmation` |
| 9000 | `.onboard-overlay` |
| 9999 | the Terminal / Blueprint texture (css/theme.css) |

- `_dialogLiveRegion` reads the computed z-index of the `body > *` LAYER, so a new overlay's ROOT needs one. Stay under 998, so toasts and the overlay's own `confirmModal` sit above it.
- **Frames.** Full screen on a phone: `.settings-overlay` / `.settings-panel` / `.settings-header` / `.settings-body` (css/settings.css); Diagnostics reuses it with `.diag-overlay { z-index: 320 }`. It already has `height: 100dvh`, both safe-area insets (`max(var(--space-7), env(safe-area-inset-*))` on the overlay; at ≤640px the header and body carry `calc(… + env(safe-area-inset-top / -bottom))`, re-stated in css/crisp.css 9e.7) and the pull-to-refresh exemption. The welcome: `.onboard-shell` pads by both insets. `.modal-overlay` + `.modal` is a CENTRED card (`max-width: 640px; max-height: 90vh`); only `#bikeModal .modal` becomes a bottom sheet.
- **Where a new component's CSS goes.** Layout (position, px sizes, media queries, safe-area insets) → the older sheet that owns the area: css/styles.css, css/features.css or css/settings.css. The look → the matching `crisp:*` section. css/crisp.css may carry `env(safe-area-inset-*)` and a unitless z-index (tokens-only bans hex, `rgb()` and px), but tests/suites/13-safe-area.js only guards insets an OLDER sheet declared: declare the inset there, and re-state it in crisp.css whenever crisp sets `padding` / `padding-block` (or the same property) on that selector — or list the move in the suite's `ALLOWED_MOVES`.
- css/styles.css pins `input, select, textarea { font-size: 16px !important }` below 1024px, to stop iOS focus auto-zoom: a `--type-*` size on a field does not take there. Do not fight it.
