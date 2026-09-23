# Theming — the theme registry, resolution, first paint, retired themes, the light-base trap
Read this when you add, change or retire a theme, touch `themeBoot`, or a css/crisp.css rule "does not take" on Cloud. Skip it when no colour or theme is involved.

### Theming
- `:root` holds the scales plus a legacy dark colour set that only acts as a fallback. Every shipped theme — Cloud
  included — is a `[data-theme="id"]` token block; `<html data-theme="cloud">` is in the markup. Light-base component
  fixes are written as `:is([data-theme="light"], [data-theme="cloud"])`; `light` is a legacy id that nothing applies
  any more. **That prefix is worth one class of specificity — and Cloud is the default theme.**
  A plain selector in css/crisp.css (linked last) wins a TIE against the older sheets, but loses to one of these: four
  such rules outranked the Crisp look on the light base only (booked and past My Bookings cards lost their tint).
  When a Crisp rule "does not take" on a light theme, look here first; delete the old rule if it is dead, or match its
  specificity. tests/suites/9f-one-card.js guards the class card's root against it.
- Registry: `APP_THEMES` in `js/theme.js` — `{id, name, base, bg, accent, mono?}` (`mono: true` on Terminal and
  Handheld: class types wear the theme's own accent ladder there — see Class-type colours):
  `cloud` "Cloud" (light, **default**), `graphite` "Graphite" (dark), `terminal` "Terminal" (dark; CRT green,
  scanlines, mono body), `gameboy` "Handheld" (dark; DMG palette, radius tokens zeroed, mono body), `blueprint`
  "Blueprint" (dark; grid overlay). Five themes.
- **Retired themes** (September 2026, the owner's call): Linen and Synthwave are gone — no token block, no selector in
  any stylesheet, no picker chip. Their ids live on in ONE place, `RETIRED_THEMES = { linen: 'cloud', synthwave:
  'graphite' }` (js/theme.js, `pure:theme-retired`, `_currentThemeId`): a retired id that is saved, deep-linked or
  named by a settings backup reads as the theme on the same base, so the member's own light / dark choice survives —
  left alone it would have stopped being a registry id and the app would suddenly have followed the system scheme.
  `_savedThemeId` rewrites the stored value once (and, in the iOS app, says it again after the Preferences restore so
  the mirror follows); both `themeBoot` scripts carry the same map as `RETIRED`; `_planSettingsImport` gets it as
  `opts.retiredThemes`. To retire another theme: delete its block, its selectors and its registry entry, add its id to
  that map and to both `themeBoot` scripts — tests/suites/10b-themes.js holds the three copies together.
- Resolution (`_resolveTheme`): a saved `psycle_theme` that is a registry id wins (a retired id counts as the theme
  that replaced it). Anything else — nothing saved, or a legacy `"dark"` / `"light"` — follows the system:
  `prefers-color-scheme: dark` → Graphite, otherwise Cloud, and keeps following it live until an explicit choice is
  saved.
- The picker renders from the registry in Membership → Appearance; `?theme=id` deep-links and persists a theme.
- **Mono themes on a phone**: Terminal and Handheld swap in a monospace body face, in which the date row's five ranges
  are wider than a phone. At ≤640px — there only, and in those two themes only — `.date-track` is a two-row grid
  (Today · Tomorrow · 7 days over Next week · 14 days; css/crisp.css 9b.4), so nothing is clipped at rest at 375 or 390
  and the row has nothing to scroll; every other theme keeps the one-row track.
- Header sun/moon button (`toggleTheme`) flips between the two bases: a light-base theme → Graphite, a dark-base
  theme → Cloud. It exits any flavour theme and saves the result (so the system is no longer followed).
- First paint: the inline `themeBoot` script in psycle-finder.html and login.html applies the same rule before any
  CSS paints and sets the `theme-color` meta. Its id → bg map mirrors `APP_THEMES` (tests compare the two); theme.js
  runs afterwards and has the last word. In the iOS app the bridge sets the status-bar glyph style from the theme base.
- To add a theme: new `[data-theme="id"]` block in css/theme.css + one entry in APP_THEMES + the id → bg pair in both
  `themeBoot` scripts.

**js/theme.js section A is evaluated whole by two suites** (10b-themes.js, 9a-foundation.js) against a fake page with almost nothing on it — what code added between `// ── A. Themes` and `// ── B. Skeleton Loading Cards` must survive: agents/learnings.md B7.
