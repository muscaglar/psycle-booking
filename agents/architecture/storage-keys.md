# Storage keys — every localStorage and sessionStorage key, what it holds, whether iOS mirrors it
Read this when you add, read or clear a stored key. Skip it otherwise. For which file reads or writes a key, use the generated index ([../index/README.md](../index/README.md)); for what moves on an account switch see "Data owner" in [session-and-accounts.md](session-and-accounts.md).

## localStorage Keys
Every key the code writes today. **iOS** = mirrored to Capacitor Preferences by native-bridge.js (`SYNC_KEYS`:
restored into localStorage at launch when missing, so it survives an iOS storage purge). The AES key itself lives
in IndexedDB (`psycle_sec`), not localStorage.

| Key | iOS | Contents |
|-----|-----|----------|
| psycle_bearer_token | ✓ | Auth token in PLAIN text — written by login.html (the app migrates it to the encrypted key and removes it) and as a last-resort fallback when encryption fails |
| psycle_bearer_token_enc | ✓ | Auth token, format-marked: `aes:` (AES-GCM) or `xor:` (obfuscated only — crypto unavailable) |
| psycle_sec_key_backup | ✓ | AES key backup, written in the native apps only (iPhone and Android: `isNativePlatform()`) — so an IndexedDB purge can't orphan the mirrored ciphertext. On Android both sit in SharedPreferences, which is why the app's data is excluded from backup and device transfer ([android.md](android.md)) |
| psycle_data_owner | ✓ | Customer id the stored per-account data belongs to (absent = legacy install → adopted by the next verified profile, unless `psycle_class_history_owner` names a different member → switch from them) |
| psycle_account_stash | ✓ | `{ownerId:{savedAt,pending,keys:{key:rawValue}}}` — the last two OTHER members' small hand-entered keys, restored when they sign back in on this device |
| psycle_class_history | ✓ | Booking history (synced from API, reconciled from /bookings, topped up weekly; max 2000) |
| psycle_class_history_owner | ✓ | Customer id the history belongs to (features.js `_historyIsMine`). History is per-install and outlives a sign-out: the BACKGROUND writers — the /bookings reconcile and explore.js's silent top-up — only run for that member (an unstamped history is adopted by whoever is signed in; an unverified session touches nothing). Cleared with the history on an account switch (`ACCOUNT_CLEAR_KEYS`), so the newcomer adopts their own; on an install with no `psycle_data_owner` it also tells `_swapAccountData` whose data this is |
| psycle_history_synced | ✓ | ISO date of last completed history sync |
| psycle_history_prompt_dismissed | ✓ | `'1'` once the first-run "sync my history" prompt was dismissed (never asked again; Stats keeps a Sync entry point) |
| psycle_history_topup_at |  | ISO — when a silent weekly history top-up last STARTED (explore.js); not exported |
| psycle_history_topup_skipped |  | `{at: ISO, count}` — a silent top-up found more unknown classes than it may fetch quietly (explore.js): it waits a week and the Stats banner offers Re-sync meanwhile; removed once a sync has tried them, cleared with the history on an account switch; not exported |
| psycle_instructor_tiers | ✓ | `{instrId: "S"..."F"}` |
| psycle_fav_instructors | ✓ | `[instrId, ...]` |
| psycle_bike_prefs | ✓ | `{studioId: {avoid: [], prefer: []}}` |
| psycle_bike_history | ✓ | `{studioId:{instructorId:{slot:count}}}` — your usual spot, pre-selected in the picker |
| psycle_saved_filters | ✓ | Last filter state: `instructorIds, locationIds, categories, strengthSubs, reformerSubs, timeBands, availableOnly, startDate, daysAhead, dateQuickMode`. Its mere existence ends the first-run favourites pre-selection |
| psycle_recent_searches | ✓ | Last 5 search filter states (deduped; includes the Time row — `timeBands` + `availableOnly` — an entry saved without them resets the row) for the Discover pills |
| psycle_weekly_template | ✓ | `[{dayOfWeek,hour,minute,locationId,eventTypeId,instructorId,label,locName?,seats?}]` — "Your usual week" (weekday + London wall-clock time; booked only through the confirm sheet, never in one tap). `seats` (1–4, absent = 1) is how many seats were held when the week was saved — where the sheet STARTS and what the card prints ("2 seats"), coerced where it is read by ONE rule in two places (app.js `_templateSeats`, tabs.js `_uwCardSeats`: a NUMBER that is an integer 1–4; anything else, a numeric string included, is 1) and bounded again before anything is sent. Not part of a settings export / import |
| psycle_usual_week_collapsed | ✓ | `'1'` while the "Your usual week" card is folded; absent = expanded (the default — unfolding REMOVES the key, and the iOS mirror's copy with it). Read defensively at every paint (only the string `'1'` counts). A per-DEVICE preference: not per account, not cleared on sign-out, not exported |
| psycle_notify_watchlist | ✓ | `[eventId, ...]` for "notify me" spot alerts |
| psycle_theme | ✓ | Theme id: `cloud`, `graphite`, `terminal`, `gameboy`, `blueprint` (absent / anything else, including a legacy `dark` / `light` = follow the system). A retired id — `linen`, `synthwave` — is read as `cloud` / `graphite` and rewritten to it at the next launch |
| psycle_class_colours | ✓ | `{"v":1,"intensity":"off"\|"soft"\|"bold","map":{"ride":"cobalt",…}}` — the member's class-type colours (js/theme.js `PsycleClassColours`); `map` holds only their own choices, the rest follow DEFAULTS; untrusted on read (known keys, known swatches, own properties only); exported, and imported only where the device has none |
| psycle_onboarded_v1 | ✓ | First-run welcome completion flag — also written silently at launch when a stored session or a history of more than 3 classes shows the member is not new; Settings → "Show the welcome again" does not clear it |
| psycle_hint_dayswipe |  | `'1'` once Discover's one-time "Swipe to change day" hint was shown (written when first shown, not when dismissed) |
| ~~psycle_waitlisted_events~~ |  | RETIRED — waitlist places come from GET /waitlists; app.js deletes the old key on load and it is no longer in native SYNC_KEYS |
| psycle_waitlist_places | ✓ | `{owner:customerId, places:{eventId:entryId}, allocated:{eventId:iso}}` — last-seen waitlist places, so a place Psycle turned into a booking between launches is announced ("You're in") and badged "From waitlist"; ignored for a different owner, cleared on sign-out; mirrored because the previous places can't be re-derived from the server |
| psycle_offline_queue | ✓ | `[{qid, owner, type?:'cancel', eventId, bookingIds? \| slots+spaces, heldAtQueue?, timestamp, startAt?, label?, slotWord?}]` — changes made offline, waiting to reach Psycle (reliability.js; `pure:offline-queue`); owner-stamped, emptied on DELIBERATE sign-out only (a 401 keeps it) and on an account switch; a booking found after a relaunch is only sent after an explicit "Book it" |
| psycle_bookings_snapshot |  | `{v:1, owner, savedAt, items:[{id,start_at,duration,type,instructor,location,studio,slots,spaces,waitlisted}]}` — the read-only "Saved copy" of My Bookings (max 40 items, 14 days); never fed back into app state; deleted on sign-out, session expiry and account change |
| psycle_booked_event_details |  | `{v:1, items:[{id,start_at,duration,studio_id,instructor_id,event_type_id,…,seenAt}]}` — details of the classes in the last confirmed /bookings list, so My Bookings' first paint after a relaunch does not wait on GET /events/{id}; seeded into `_eventCache` (flagged `_fromSnapshot`) ONLY for ids the current /bookings answer names, re-read in the background, dropped after 14 days without a real re-read, deleted on sign-out / session expiry / account switch |
| psycle_window_cache |  | `{key:'start\|end', fetchedAt, events, relations}` — the Discover timetable window (read back for up to 24h; removed again if it leaves no room for small writes; first thing freed when storage is full) |
| psycle_cache_instructors · psycle_cache_locations · psycle_cache_event-types |  | `{data, timestamp}` — 24h cache of the three reference lists (performance.js); freed when storage is full. (`psycle_swr_*` is a legacy prefix that is only ever cleaned up) |
| psycle_calendar_data | ✓ | Entries (event, seats, time, names, address, lat/lon) the web ICS / Google Calendar export builds from; waitlist places excluded |
| psycle_calendar_enabled | ✓ | iOS calendar sync: `'1'` \| `'0'` (`'0'` disables it entirely) |
| psycle_calendar_mode | ✓ | iOS calendar sync: `'custom'` once the member has picked a calendar — the only value the app writes, and the only one under which anything is synced (nothing is ever auto-created or written to a default calendar) |
| psycle_calendar_target_id | ✓ | iOS calendar sync: the member-selected target calendar id |
| psycle_calendar_owned_ack | ✓ | `'2:<calendarId>'` once the member handed THAT calendar over in the ownership dialog. Absent, naming another calendar, or the legacy `'1'` (written silently on every pick by the build before the dialog — never consent) = marker-only reconcile |
| ~~psycle_native_cal_id~~ | ✓ | LEGACY — id of the dedicated calendar an earlier build auto-created. Nothing writes it any more (the bridge only reports it in `psycleGetCalendarConfig`); still in `SYNC_KEYS` |
| psycle_native_cal_events | ✓ | iOS: `{eventId: nativeCalendarEventId}` — without it a storage purge would create duplicates on the next sync |
| psycle_weekly_reminder | ✓ | iOS: `'on'` \| `'off'` (unset = off) — the Monday 12:00 "New Psycle dates are open" reminder |
| psycle_weekly_reminder_asked | ✓ | iOS: `'1'` once the in-app "Remind you on Mondays at 12:00, when new dates open?" ask (shown once, after a usual week is first saved — never at launch) was answered; a dialog displaced by another is not an answer |
| psycle_class_reminders | ✓ | iOS: `'off'` disables the T-90min class notifications (default on, permission-gated) |
| psycle_class_reminder_asked | ✓ | iOS: `'1'` once the in-app "remind me before class?" ask (shown after a first booking, never at launch) was answered |
| psycle_class_reminder_map |  | iOS: `{eventId: {id, startAt}}` of scheduled class reminders (device-local by nature) |
| psycle_error_log | ✓ | Error entries (max 100) |
| psycle_action_log | ✓ | User action entries (max 100; action name + timestamp only) |
| psycle_api_contract |  | Snapshot of expected API response shapes (field names only) for drift detection |
| psycle_api_schema_log |  | Observed response shapes + missing-field counters (field names only, no PII) |
| psycle_api_last_drift |  | ISO timestamp of the last detected API drift |
| psycle_quota_probe |  | Transient 64K pad written and removed at once by `_persistWindow` to test for free room — never left behind |

## sessionStorage Keys
| Key | Contents |
|-----|----------|
| psycle_last_results | `{events, relations, at, filters}` — last rendered search (written 1s after the last render of a burst) for instant restore on the next visit; `at` carries the data's age so stale counts are not printed |
| psycle_travel_notice_dismissed | `'1'` once the "you're away from London" travel notice was dismissed for this session |
| psycle_stats_page | The Stats sub-page last opened (`overview` \| `habits` \| `instructors`; anything else reads as Overview) |
| psycle_sw_reload_at | Timestamp of the last automatic reload after a service-worker update (reload-loop guard; written by the inline script in psycle-finder.html) |
