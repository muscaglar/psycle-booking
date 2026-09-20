# Session and accounts — session states, session persistence, the data owner, untrusted stored data and settings import
Read this when you touch `checkAuth`, sign-in or sign-out, what happens when a different member signs in, or anything that reads localStorage written elsewhere. Skip it otherwise. Related: [storage-keys.md](storage-keys.md).

**Session states**: `_sessionStateFor(hasToken, status)` (`pure:session`) → `signed-out` | `signed-in` | `expired` |
`unverified`. ONLY a 401 means the token is dead (`showSessionExpired`: token cleared, banner shown, `_myBookings`
deliberately kept — the same member nearly always comes back, and the widget keeps serving their classes). Anything
else with a stored token — offline, a timeout, 5xx / 429, a 403, a 200 whose body cannot be read as a JSON object
(an HTML error page, `null`) — is `unverified`: the token is KEPT, the tabs show "Can't reach Psycle — Retry" (`authGateHTML` / `retryAuth`), never a
Sign-in CTA, and `_healAuth` re-checks on `online` and on the next foreground. `checkAuth` is single-flight per
token and uses raw `fetch` with a 15s cap (not `apiFetch`) — a browser stub must cover both. One event tells every
module: `PsycleEvents.emit('auth:changed', { signedIn, initial, unverified })`, emitted by checkAuth (every
outcome), `clearToken` and `showSessionExpired`. `initial` is true only for the first outcome of a page load —
listeners that would repeat work the launch path already does (a search) skip it. `'profile:updated'`
(currentUser) fires whenever a /profile body was applied (`_applyProfile`): at sign-in, and through
`refreshProfile` ~1s after `booking:complete` / `booking:cancelled` / `seat:cancelled` / `waitlist:claimed` /
`waitlist:allocated`, on foreground and on `online` (30s throttle unless forced) — so plan usage and credits stay
current. Deliberate sign-out (`confirmSignOut` → `clearToken`) clears the token, profile, plan, waitlist memory and
any held filter/date state, and empties `_myBookings` through `fetchMyBookings`' no-token branch, which emits
NOTHING on purpose: an empty `bookings:loaded` means "the server confirmed no bookings" to the calendar sync.

**Session persistence**: the last rendered results are saved (debounced) to `sessionStorage` and painted
instantly on the next visit; the launch search then hydrates the cached window and refreshes it (Feature 13).

**Data owner (per-account data)**: stored per-account data belongs to a customer id, `psycle_data_owner`, stamped by `_applyProfile` → `_claimDataOwner` (js/app.js, `pure:data-owner`). Data moves ONLY when a verified `/profile` names a DIFFERENT customer — never on sign-out or expiry. No stamp = an install from before stamps existed → adopted as is — unless its history stamp (`psycle_class_history_owner`, which such installs already carry) names someone else: that member is then taken as the owner and it is a switch away from them. On a switch:
- *Stashed* (`ACCOUNT_STASH_KEYS` → `psycle_account_stash`, the small hand-entered keys Psycle cannot rebuild): `psycle_instructor_tiers`, `psycle_fav_instructors`, `psycle_bike_prefs`, `psycle_bike_history`, `psycle_weekly_template`, `psycle_recent_searches`, `psycle_notify_watchlist`. Two other members are kept, oldest out; the stash is written BEFORE anything is removed (if it cannot be written, nothing is touched); a switch cut short resumes from the stash (`pending`); the returning member's keys are restored.
- *Cleared* (`ACCOUNT_CLEAR_KEYS`): `psycle_class_history`, `psycle_history_synced`, `psycle_history_prompt_dismissed`, `psycle_calendar_data`, `psycle_offline_queue`, `psycle_history_topup_at`, `psycle_history_topup_skipped`, `psycle_booked_event_details`, and — LAST, so an inferred switch stays resumable — `psycle_class_history_owner`. Psycle can rebuild history (the newcomer is offered their own sync), and a queued booking must never replay under another token.
Emits `data:owner-changed {from,to}` before `profile:updated`. A storage error can never get in the way of a sign-in. Separately, `_applyProfile` empties the in-memory `_myBookings` when a different customer's profile lands on the same page. While signed OUT (no token), Stats shows only its Sign-in hero (`#tab-stats.stats-signed-out`, css/tabs.css).

**Stored data is untrusted / settings import**: Import settings (and the iOS Preferences mirror of one) can put anything in localStorage. Ids / seat lists / rankings / bike prefs are coerced where they are READ (`pure:stored-data` in js/app.js: `_cleanStoredId`, `_cleanStoredIdList`, `_cleanStoredHistory`, `_cleanStoredTiers`, `_cleanStoredBikePrefs`) and escaped where printed. `importSettings` (js/settings.js, `pure:import-validate`, `_planSettingsImport`) takes only the keys an export writes, each a bounded string (file ≤ 5 MB, value ≤ 1 MB) whose JSON has that key's shape, rejects unknown keys and prototype-pollution ids, and only ever ADDS to what the device holds — classes it has no record of, rankings / bike prefs / favourites / alerts it lacks; theme, filters and the sync stamp only where the device has none (confirmModal first when the device has data); a backup that names a retired theme is accepted and mapped to the theme that replaced it. Export goes through the share sheet in the iOS app (`pure:settings-export`). `window._psycleSafeSetItem(key, value)` (security.js) is the quota-aware setter: on a failed write it frees `psycle_window_cache` (and sessionStorage's `psycle_last_results`), then `psycle_cache_*` / `psycle_swr_*`, retrying after each — returns false, never throws.
