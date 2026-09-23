# Sheets, seat picker and dialogs — the class sheet, the picker (and its choose-only mode), `confirmModal`, the caution line, the Booked sheet
Read this when you change how `openClassDetail`, `showBikePicker`, `confirmModal` or the Booked sheet look or are built. Skip it for what a booking DOES ([booking.md](booking.md)) and for focus and keys ([accessibility.md](accessibility.md)).

### crisp:9c-sheets and pure:sheets helpers
**Sheets, picker and dialogs (Crisp Colour)** — css/crisp.css `crisp:9c-sheets`; the older rules for the same parts stay in styles.css / features.css / settings.css (several suites pin them) and are overridden there.

Small decisions live in `pure:sheets` (js/app.js, two regions; tests/suites/9c-sheets.js): `_uiIcon(name, size)` (line marks for sheet rows / menu options — never an emoji), `_sheetPlanNote(facts)`, `_pickerConfirmLabel(slotWord, selected)`, `_confirmTone(opts)`, `_visibleOpener(el)`.

### Class sheet
- *Class sheet* (`openClassDetail`): `data-ct` on `.class-detail-sheet`.

  A `.cds-hero.ct-card` block in the class colour — the TIME first (`.t-time.is-sheet`), date · length, the pictogram tile, the class name in `--ct-deep`, then instructor and "· place" — over `.cds-body`: ONE grouped list (`.cds-details`: free-cancel from `_cancelDeadline` · availability · clash, the clash row ONE quiet line like its neighbours — body ink, no ground — led by the caution mark, with the OTHER class's own tile), bio, and `.cds-actions` (sticky to the sheet's bottom edge) holding ONE full-width pill + `.cds-note` ("1 class · 4 left this month" — the period is NAMED from its own length by `_mbPeriodWord`, the word My Bookings' usage line uses, so a weekly plan reads "2 left this week" and anything else "this period"; only for plain Book, only what `/profile` can back: a capped plan counts per billing period, so "left" is printed only for a class inside that period; unlimited → nothing; no plan → the credit balance).

  `cds-book-btn` / `cds-view-instr` / `cds-avail*` stay as hooks; the glow (`.glow-mine`) goes to Book, Claim spot and a seat you hold — never Join / Leave / Full / Attended. (On a pill the glow is `.pill-btn.glow-mine`, in the foundation: `.pill-btn`'s own box-shadow comes after `.glow-mine` at the same specificity, and for a while the sheet's Book computed no glow at all.)

### Seat picker and choose-only mode
- *Seat picker* (`showBikePicker`): `data-ct`, `data-held`, `data-usual` on `#bikeModal`, the pictogram in `#modalTile`.

  Seats are circles (`rx` ← `--radius-full`; Handheld zeroes it → squares) numbered in the display face: available = surface + hairline (at "bold" the boards' tint), taken = sunken + `--text-dim`, your pick / your seat = class base + glow (a wide under-fill stroke + `drop-shadow`, since SVG takes no box-shadow).

  Two marks are drawn once and shown by CSS from the seat's classes: a ring on `usual`, a tick on `mine`; settings.js adds fav = dot / avoid = bar at the top-LEFT (shapes, not a green / red pair — and the number keeps its state's ink: crisp.css answers settings.css's `!important` fills with the one `!important` of its own, under `#bikeSvg`). The legend's `.seat-key` marks read the same `--seat-*` tokens as the map.

  A map wider than the sheet scrolls sideways inside `.bike-map-wrap` (the seats keep a tappable size: `min-width` up to 420px on `#bikeSvg`), and the wrap says so with scroll shades made of backgrounds alone — a `--line` shade fixed to each side edge (`scroll`) under a cover of its own `--ground` that rides each end of the content (`local`, and wider than the shade): an edge is shaded only while seats lie beyond it, and a map that fits shows none (tests/suites/17-leftovers.js).

  The confirm button names what it books ("Book bike 12"; `_syncPickerConfirmLabel`, never in a swap — changeSpot words that button).

  **Choose-only mode** (`opts.choose = { count, preselect, done }` → `window._chooseSpotContext`, the usual-week sheet's "Change spot"): the same map, but it BOOKS NOTHING — titled "Choose your bike", the sheet's suggestion preselected (not the auto-picked usual), exactly `count` seats (`selectBike`'s limit, `_chooseSpotHint`), a seat already held shown but inert, the dismiss button "Back", and the confirm "Use bike 12" → `confirmSpotChoice()` hands the ids to `done` once; every other way out is `closeBikePicker()` → `done(null)`, "no change". `confirmBikeBooking()` itself refuses in this mode (the page's own `onclick` names it), and a chooser still waiting when another picker opens is answered "no change" first.

  `#bikeModal .modal-actions` is `position: sticky; bottom: 0` on the panel's own surface, full width (padding, not the map's side margins) — as `.cds-actions` is — so Book is on screen without scrolling at 375 × 667.

### confirmModal dialogs and the caution line
- *Dialogs* (`confirmModal`, and the usual-week sheet, which wears the same `.confirm-*` family): two pills — the safe choice sunken, the action the theme primary. `danger: true` is a CALM danger outline; the filled red (`.confirm-btn-danger.is-solid`) is reserved by `_confirmTone` for a cancel inside the 12-hour window (its warn line wears `late-cancel-note`) and a deletion that cannot be undone (`irreversible: true` — the calendar hand-over).

  **The caution line** (a clash, a dialog's warn text, a usual-week row's warning) is ONE quiet line everywhere: the sentence in the body ink on the surface it already sits on — no fill, no box — led by `_uiIcon('caution')`, a ringed "!" drawn as an aria-hidden stroke SVG (the warning-sign glyph is an emoji on iOS) and inked in the theme's caution colour `--badge-waitlist-text`, which holds ≥4.5:1 on every ground and every class tint (tests/suites/10c-polish.js; the sentence in the picker's tinted header takes `--ct-ink`).

  Builders: `openClassDetail` (`rowIcon('caution')`), `showBikePicker` (`.modal-clash`: mark via `innerHTML`, the API-text sentence via `textContent`), `confirmModal` (`.confirm-warn`, behind a `typeof _uiIcon` guard) and js/tabs.js `_uwNoteInner` (`pure:usual-week-note` — the first paint AND the run's in-place rewrite go through it; an empty note stays `:empty`).

  The ONE warning that keeps a caution ground is `.confirm-warn.late-cancel-note` — a cancel inside the 12-hour window costs a credit. The welcome's illustration draws the same mark in CSS (`.onboard-mini-caution::before`).

### Booked sheet, instructor profile, history rows
- *Booked sheet*: `data-ct` on `.bc-content` (tick in the class colour, the seat as `.ct-badge.is-seat.glow-mine`); its two buttons are neutral pills outside that block; `el.className` stays exactly `booking-confirmation`.

  *Find similar*, the *instructor profile* (rows = the compact class component: `data-ct` + tile + day over time; the row's status is `classStatusChip` → `.ct-badge` "Booked" / "Only 2 left", `.ct-badge.is-dashed` "Waitlisted", else the quiet `.instructor-class-status` line in Discover's words — never the old uppercase `.badge` tag, never red for full; at intensity `off` the rows step down to `--sunken`, or they would vanish into the surface panel) and the *history* rows (`data-ct` → a colour dot; an attribute, so 2,000 rows stay cheap) take their look from the same section.

  Banners are inset soft cards below 1024px; crisp.css never sets a banner's padding (tests/suites/2e-css-layout.js).

### Text-editing overlay not built
**Not built yet: a text-editing overlay.** No overlay has a text field. Nothing handles the iOS soft keyboard over a sticky bottom action bar (`visualViewport`, `dvh`) or an unsaved draft on Escape; the first such overlay needs a check on the owner's device (agents/playbooks.md P5 — "an overlay that holds unsaved input").
