# css/ — read before editing here
Nine plain stylesheets: tokens and themes in theme.css, seven older component sheets, and crisp.css (the Crisp Colour look) over them all. The repo-wide rules are in the root [AGENTS.md](../AGENTS.md) — this file adds only what is local.

## Rules that bite here
Guards are in tests/suites/; D1–D7 = [agents/learnings.md](../agents/learnings.md) section D. Suites match rule TEXT: before you reformat, move or delete a rule, `grep -l "<selector>" tests/suites/*.js`.
1. **Link order is the cascade**: the table's order, crisp.css LAST. login.html links no sheet and inlines its tokens: it is copied as-is into the flat iOS www/. 9a-foundation.js, 4f-cleanup-pwa.js
2. **crisp.css is tokens only**: no hex, `rgb()`, `hsl()` or px (bar a `@media` breakpoint), every `var()` defined. A missing step goes in theme.css `:root`, a radius also zeroed in `[data-theme="gameboy"]`. A COLOUR token needs a value in every `[data-theme]` block: `:root` is only a legacy DARK fallback, so one missing from `[data-theme="cloud"]` looks wrong on Cloud alone, and 9a-foundation.js checks only that the name exists somewhere. D4 · 9a-foundation.js, 2e-css-layout.js
3. **Last wins a TIE, not specificity**: an older `:is([data-theme="light"], [data-theme="cloud"]) …` rule beats a plain Crisp selector on Cloud, the default theme. All of them are in theme.css (`git grep -n 'data-theme="cloud"]) ' -- css/theme.css`); none sits on the card root today, parts of the card (`.book-btn.booked`, `.fav-btn`, `.mb-skeleton`) still have one. Delete it if dead, else MATCH it: the SAME specificity from crisp.css, a tie won by link order — never `!important`, never the `:is(…cloud)` prefix copied into crisp.css, an id only where the section is already id-scoped. D1 · 9f-one-card.js flags only an older rule ABOVE (0,2,0) whose subject is `.class-card` / `.my-booking-card`, on background / color / radius / border / shadow: a card PART, or a prefixed rule at exactly (0,2,0), is unguarded.
4. **An id-scoped rule beats older STATE rules**: one that sets `display` on a collapsible part gets its collapsed twin. D2 · 9d-bookings.js, 14b-usual-week-card.js
5. **A `padding` / `margin` shorthand in crisp.css drops an older sheet's safe-area inset**: carry the `env()`, or list the move in `ALLOWED_MOVES`. D3 · 13-safe-area.js
6. **Class colour comes only through the ONE `[data-ct]` mapping block** (crisp:9a-foundation); nothing else reads `--ct-<key>-*`. Text on a tint: `--ct-ink`, `--ct-ink-2`, `--ct-deep` — guaranteed only on `--ct-card` (= `--ct-tint`, or `--surface` at intensity off), so a new ground must be proved against them. Colour means CLASS TYPE and nothing else (agents/decisions.md section 3). Glow: "selected, or yours". 9a-foundation.js + each section's suite (9b-discover.js … 9e-stats-membership.js)
7. **`@font-face` in theme.css only**, as a file URL: ios-app/build.js de-paths `../fonts/` there alone. No other file `url()` in any sheet: the flat iOS www/ ships no icons/ or assets/, and nothing checks a reference. An image is an inline `data:` SVG (the masks in tabs.css and crisp.css) or markup. 9a-foundation.js
8. **A `:has()` selector gets a rule of its own**: iOS < 15.4 then drops only that rule. In `crisp:9b-discover` there is NO `:has()`, `color-mix()`, `oklch()` or `!important` at all (9b-discover.js), and no `!important` in 9e (9e-stats-membership.js); the one in 9c answers settings.css's own. 2e-css-layout.js, 10c-polish.js
9. **`.cc-` is two disjoint families**: the class CARD's parts (9b) and the class COLOURS control (9e). D6 · 9f-one-card.js
10. **The My Bookings card is `.my-booking-card` on the shared `.class-card[data-ct]` root**: ground, ink, radius, border and shadow are said ONCE, in 9b.7 (`background: var(--ct-card)`). `crisp:9d-bookings` starts every selector at `#tab-bookings` (or `#usualWeekCard`, `#usualWeekSheet`, `.next-class-pill`), may not name `.class-card` or `.book-btn`, and its card-root rule carries no surface → a new ground goes through `--ct-card` in 9b.7, or a custom property varied as `--cc-pill` is. A 9d rule is already (1,x,0): if it fails on Cloud only, suspect a token (rule 2), not rule 3. 9d-bookings.js, 9f-one-card.js

Five themes — `cloud` (default, light), `graphite`, `terminal`, `gameboy` ("Handheld"), `blueprint`. A sheet may name any REGISTRY id in `[data-theme="…"]` (crisp.css names `terminal` and `gameboy`); the only other id allowed is the legacy `light` (10b-themes.js). Adding one reaches js/theme.js, both `themeBoot` scripts and login.html: [agents/playbooks.md](../agents/playbooks.md) P4.

## What is in here
In link order. CSS has no per-file symbols index: [agents/index/css-sections.md](../agents/index/css-sections.md) gives every sheet's sections with line ranges, and each token theme.css defines — grep it, then open a window. Older sheets are cut by comment banners, crisp.css by five markers.

| Sheet | Holds |
|---|---|
| styles.css | Core layout, older card / booking rules, desktop (1024px+), the welcome (`.onboard-*`) |
| theme.css | `@font-face`, `:root` scales, the theme blocks, light-base overrides, `--ct-<key>-*` defaults |
| features.css | Class history, instructor profile, notify button |
| tabs.css | Tab bar, Stats, Membership, theme picker |
| settings.css | Settings panel, tiers, bike preferences, next-class pill, Diagnostics |
| explore.css | Instructor cards, instructor map |
| redesign.css | Top bar, Discover, Filters bar, day strip + pager, the Membership tab's layout (`#tab-membership`, `.ms-*`), waitlist places: layout and type only |
| discover-layout-fix.css | Discover's filter rows; stays the last OLDER sheet (2e-css-layout.js) |
| crisp.css | The look: `/* == crisp:9a-foundation == */`, `9b-discover`, `9c-sheets`, `9d-bookings`, `9e-stats-membership` — each once, in order |

A new component: layout (px, media queries, insets) in the older sheet that owns the area, the look in the matching `crisp:*` section.

## After you edit
```bash
(cd ios-app && npm run build)   # regenerates ios-app/www/ and the CACHE stamp of both sw.js copies: commit them
npm run agents:index            # css-sections.md holds line ranges
npm run ci                      # check + test + drift, as CI runs it; reading its long log: playbooks P0
```
Then look (playbooks P8) in Cloud AND Graphite; a layout change also at 375 × 667 in Terminal and Handheld (D7). My Bookings is empty after `H.boot`: book a class on the fake first; waitlisted and past cards are not modelled (tests/AGENTS.md rule 9).

## Read next
- [design-system.md](../agents/architecture/design-system.md) — tokens, the Crisp layer in full, z-index ladder, overlay frames
- [theming.md](../agents/architecture/theming.md) — registry, `themeBoot`, the light-base trap
- [class-type-colours.md](../agents/architecture/class-type-colours.md) · [class-card.md](../agents/architecture/class-card.md) — `data-ct` · `.class-card[data-ct]`
- [agents/playbooks.md](../agents/playbooks.md) — P4 theme or swatch · P5 overlay · P6 class card · P8 browser check
