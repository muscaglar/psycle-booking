/**
 * types/globals.d.ts — Ambient declarations for the Psycle Class Finder PWA.
 *
 * WHY THIS EXISTS
 * ---------------
 * This is a vanilla-JS, no-build-step PWA. Modules attach functions and objects
 * to `window` and then reference each other as *bare globals* (e.g. app.js calls
 * `escapeHTML(...)`, settings.js calls `getInstructorTier(...)`). State.js even
 * exposes mutable data (`instructors`, `_myBookings`, ...) as window property
 * accessors so older code can read/write them as plain globals.
 *
 * Without these declarations, `tsc --checkJs` would emit thousands of false
 * "Cannot find name 'X'" errors and drown out real issues. Declaring the shared
 * surface here lets advisory type-checking (`npm run typecheck`) focus on actual
 * typos and arg-count mismatches.
 *
 * Types are deliberately LOOSE (`any` where the real shape is unknown). The point
 * is to silence false positives, not to fully model the runtime. This file is NOT
 * imported anywhere — it is picked up ambiently via jsconfig.json `include`.
 */

export {}; // make this a module-free ambient file (no top-level export pollution)

declare global {
  // ───────────────────────────────────────────────────────────────────────────
  // Namespaces / singletons
  // ───────────────────────────────────────────────────────────────────────────

  // NOTE: `PsycleState`, `PsycleEvents`, and `APP_THEMES` are declared as
  // top-level `const` in their source modules (state.js / theme.js). In TS's
  // global script scope those are already visible to every other .js file, so
  // declaring them here would trigger a spurious "Cannot redeclare block-scoped
  // variable" error. They are intentionally NOT redeclared in this file.

  /** Typed API client (api-client.js). */
  var PsycleAPI: {
    SCHEMAS: Record<string, any>;
    getInstructors(...args: any[]): Promise<any>;
    getLocations(...args: any[]): Promise<any>;
    getEventTypes(...args: any[]): Promise<any>;
    getProfile(...args: any[]): Promise<any>;
    getBookings(...args: any[]): Promise<any>;
    getEvents(...args: any[]): Promise<any>;
    getEventDetail(...args: any[]): Promise<any>;
    createBooking(...args: any[]): Promise<any>;
    deleteBooking(...args: any[]): Promise<any>;
    field(...args: any[]): any;
    categorizeError(...args: any[]): any;
    validate(...args: any[]): any;
    parseJson(...args: any[]): any;
    [key: string]: any;
  };

  /** Diagnostic recorder + API contract checker (diagnostic.js). */
  var PsycleDiag: {
    record(...args: any[]): any;
    noteMissingField(...args: any[]): any;
    captureContract(...args: any[]): any;
    checkContract(...args: any[]): any;
    enterSafeMode(...args: any[]): any;
    exitSafeMode(...args: any[]): any;
    getDiagnostics(...args: any[]): any;
    [key: string]: any;
  };

  /** Encrypted token vault (security.js). */
  var _secureTokenStore: {
    get(): Promise<string | null> | string | null;
    set(token: string): Promise<void> | void;
    clear(): Promise<void> | void;
    [key: string]: any;
  };

  /** Resolves once security.js has finished bootstrapping. */
  var securityReady: Promise<any>;

  /** Quota-aware localStorage.setItem (security.js): frees the app's own caches and retries. false = not saved; never throws. */
  var _psycleSafeSetItem: ((key: string, value: string) => boolean) | undefined;

  /** Discover's day pager (app.js): the day on screen ('YYYY-MM-DD'; null = not paged), the 'start|end' it belongs to, and whether the member chose it. Memory only. */
  var _pagerDay: string | null;
  var _pagerRangeKey: string | null;
  var _pagerChosen: boolean;
  /** The day strip was rebuilt — or a theme re-measured its pills — while Discover was hidden (no layout box): switchTab('discover') puts its scroll offset back, once (tabs.js → app.js _restoreDayStrip). */
  var _dayStripRevealOwed: boolean | undefined;
  /** …and what the day swipe (interactions.js) asks of it: may a touch start, is there a day either way, follow the finger, let go. */
  var _dayPagerSwipe: {
    canStart(target: any): boolean;
    edges(): { prev: boolean; next: boolean };
    drag(offset: number, dx: number): void;
    release(result: { dir: number; dx: number; cancelled: boolean }): void;
  };
  /** The shared sideways-swipe helper (interactions.js): horizontal intent, 25% / flick release, resistance at an edge. Returns a detach function. */
  var _psycleSwipe: ((el: any, opts?: Record<string, any>) => () => void) | undefined;
  /** Stats sub-pages (tabs.js): open 'overview' | 'habits' | 'instructors' (false = unknown id); the neighbour a swipe in `dir` (+1 / -1) leads to, or null. */
  var showStatsPage: (id: string) => boolean;
  var _statsPageStep: (dir: number) => string | null;
  /** The first-run welcome was really shown in this page session (app.js _onboardReveal): Discover's one-time swipe hint then keeps for a later launch. */
  var _psycleWelcomeSeen: boolean | undefined;

  /** iOS only (security.js creates it, native-bridge resolves it): the Preferences → localStorage restore has settled. */
  var _psycleNativeRestoreReady: Promise<void> | undefined;
  /** Android app only (app.js; login.html has its own): what ONE press of Back did — true = the page dealt with it, false = nothing to close, the activity goes to the background. */
  var _psycleAndroidBack: (() => boolean) | undefined;

  // ───────────────────────────────────────────────────────────────────────────
  // Shared mutable state (exposed on window via property accessors in state.js)
  // ───────────────────────────────────────────────────────────────────────────

  var instructors: any[];
  var locations: any[];
  var eventTypes: any[];
  var currentUser: any;
  var _studioMap: Record<string, any>;
  var _myBookings: any;
  var _eventCache: Record<string, any>;
  var _activeSubscription: any;
  var selectedInstructors: Set<any>;
  // (selectedLocations is a top-level `const` in app.js — already global, not redeclared.)
  var selectedCategories: Set<any>;
  var selectedStrengthSubs: Set<any>;
  var favouriteInstructors: Set<any>;
  var _bookingContext: any;
  var _changeSpotContext: any;
  var _selectedSlots: any;
  var _upcomingCollapsed: boolean;
  var _dateQuickMode: any;
  var instrFocusIdx: number;
  var toastTimer: any;
  var _searchAborted: boolean;

  // Config / constants
  // (APP_THEMES is a top-level `const` in theme.js — already global, not redeclared.)
  var APP_VERSION: string | undefined;

  // Monkey-patch bookkeeping flags (set by reliability.js / performance.js / theme.js)
  var _originalApiFetch: any;
  var _themeBookingWrapped: boolean;
  var _themeRenderWrapped: boolean;
  var _themeSearchWrapped: boolean;
  var _themeSetStatusWrapped: boolean;
  var _eventCardTierPatched: boolean;
  var _bikePickerPrefsPatched: boolean;

  // ───────────────────────────────────────────────────────────────────────────
  // Shared functions (declared loosely as (...args: any[]) => any).
  // Many are async and/or monkey-patched at runtime; the declared signature is
  // intentionally permissive so call sites don't trip arg-count false positives.
  // ───────────────────────────────────────────────────────────────────────────

  // Core API / network (app.js, reliability.js)
  function apiFetch(...args: any[]): Promise<any>;
  function apiUrl(...args: any[]): string;
  function getBearerToken(...args: any[]): any;
  function fetchWithRetry(...args: any[]): Promise<any>;
  function fetchMyBookings(...args: any[]): Promise<any>;
  function queueOfflineCancel(...args: any[]): any;
  function processOfflineQueue(...args: any[]): any;

  // Auth / token (security.js)
  function escapeHTML(...args: any[]): string;
  function parseJWT(...args: any[]): any;
  function getTokenExpiry(...args: any[]): any;
  function isTokenExpiringSoon(...args: any[]): boolean;
  function scheduleTokenExpiryCheck(...args: any[]): any;
  function showSessionExpired(...args: any[]): any;
  // Session lifecycle (app.js). checkAuth is single-flight per token and never
  // drops the token on a network/5xx failure; both emit via PsycleEvents
  // ('auth:changed' {signedIn, initial, unverified}, 'profile:updated').
  function checkAuth(...args: any[]): Promise<any>;
  function refreshProfile(...args: any[]): Promise<any>;
  function authGateHTML(...args: any[]): string;

  // Search / filtering (app.js, interactions.js)
  function search(...args: any[]): any;
  function render(...args: any[]): any;
  function setStatus(...args: any[]): any;
  function toast(...args: any[]): any;
  function eventCard(...args: any[]): any;
  function saveFilters(...args: any[]): any;
  function restoreFilters(...args: any[]): any;
  function applyFiltersCollapsedState(...args: any[]): any;
  function filterInstrDropdown(...args: any[]): any;
  function updateDiscoverEmptyState(...args: any[]): any;

  // Booking (app.js, features.js)
  function bookClass(...args: any[]): Promise<any>;
  function submitBooking(...args: any[]): Promise<any>;
  function confirmModal(...args: any[]): any;
  function bookPrediction(...args: any[]): any;
  function predictNextClass(...args: any[]): any;
  function confirmUnbook(...args: any[]): any;
  function upcomingCancel(...args: any[]): any;
  function upcomingSeatCancel(...args: any[]): any;
  function cancelBikeSlot(...args: any[]): any;
  function findSimilar(...args: any[]): any;
  function shareClass(...args: any[]): any;
  function showBikePicker(...args: any[]): any;
  function _mergeBookedSeats(prevEntry: any, newSlots: number[], bookingId: any): any; // app.js pure:booking — reliability.js seeds its optimistic entry with it

  // Waitlists (app.js — separate /waitlists resource; places live on _myBookings entries)
  function fetchMyWaitlists(): Promise<any[] | null>;
  function confirmJoinWaitlist(eventId: any, btn?: any): Promise<boolean>;
  function joinWaitlist(eventId: any, btn?: any, opts?: any): Promise<boolean>;
  function leaveWaitlist(eventId: any, btn?: any, opts?: any): Promise<boolean>;
  function claimWaitlistSpot(eventId: any, btn?: any): Promise<boolean>;

  // Modals / detail sheets (app.js, features.js, settings.js, diagnostic.js)
  function openClassDetail(...args: any[]): any;
  function openMapForBooking(...args: any[]): any;
  // My Bookings: the card's "More" menu (app.js)
  function toggleBookingMore(btn: any): void;
  function closeBookingMore(focusBack?: boolean): void;
  function changeSpot(...args: any[]): any;
  function setChangeSpotTarget(...args: any[]): any;
  function openSettings(...args: any[]): any;
  function closeSettings(...args: any[]): any;
  function openDiagnostics(...args: any[]): any;
  function closeDiagnostics(...args: any[]): any;
  function openHistoryModal(...args: any[]): any;
  function openYearReview(...args: any[]): any;

  // Navigation / tabs (tabs.js)
  function switchTab(...args: any[]): any;
  function weekNav(...args: any[]): any;
  function planDay(...args: any[]): any;

  // Insights / rendering (tabs.js, explore.js, features.js)
  function renderMyBookings(...args: any[]): any;
  function renderInsights(...args: any[]): any;
  function renderInstrChips(...args: any[]): any;
  function renderInstrDropdown(...args: any[]): any;
  function renderReminderRow(...args: any[]): any;
  function renderThemePicker(...args: any[]): any;
  function renderClassColours(...args: any[]): any;
  function renderDiscoverPresets(...args: any[]): any;
  function renderTravelNotice(...args: any[]): any;
  function renderExplore(...args: any[]): any;
  function renderRebookHint(...args: any[]): any;
  function renderBikePrefGrid(...args: any[]): any;
  function shareInsights(...args: any[]): any;
  function shareYearReview(...args: any[]): any;

  // Weekly planner / templates (app.js, tabs.js)
  function loadWeeklyTemplate(...args: any[]): any;
  function saveWeeklyTemplate(...args: any[]): any;
  function clearWeeklyTemplate(...args: any[]): any;
  function saveWeekAsTemplate(...args: any[]): any;
  function bookTemplateWeek(...args: any[]): any;
  function bookWeeklyTemplate(...args: any[]): any;
  function detectRecurringSlots(...args: any[]): any;

  // Settings / tiers / prefs (settings.js)
  function filterTierList(...args: any[]): any;
  function setInstructorTier(...args: any[]): any;
  function getInstructorTier(...args: any[]): any;
  function tierBadgeHTML(...args: any[]): string;
  function toggleFavFromSettings(...args: any[]): any;
  function getBikePrefs(...args: any[]): any;
  function toggleBikePref(...args: any[]): any;
  function onCalendarSyncToggle(...args: any[]): any;
  function onCalendarTargetChange(...args: any[]): any;
  function onCalendarResync(...args: any[]): any;
  function onCalendarCleanupDupes(...args: any[]): any;
  function exportSettings(...args: any[]): any;
  function importSettings(...args: any[]): any;
  function downloadBugReport(...args: any[]): any;
  function copyBugReport(...args: any[]): any;
  function replayOnboarding(...args: any[]): any;

  // Saved searches / presets (interactions.js, app.js)
  function getRecentSearches(...args: any[]): any;
  function applySavedSearch(...args: any[]): any;
  function getSearchPresets(...args: any[]): any;
  function applySearchPreset(...args: any[]): any;

  // Theme (theme.js)
  function setAppTheme(...args: any[]): any;
  function getAppTheme(...args: any[]): any;
  function toggleTheme(...args: any[]): any;
  // Class-type colours (theme.js, section A2). classPictogram / classTypeKey
  // are top-level functions in app.js — already global, not redeclared.
  var PsycleClassColours: any;

  // Notifications (features.js)
  function requestNotificationPermission(...args: any[]): any;

  // Logging / diagnostics (reliability.js, diagnostic.js)
  function pushError(...args: any[]): any;
  function pushAction(...args: any[]): any;
  function getErrorLog(...args: any[]): any;
  function getActionLog(...args: any[]): any;
  function getFullLog(...args: any[]): any;
  function getDiagnosticReport(...args: any[]): any;

  // Calendar sync helpers (native-bridge.js / settings.js)
  function psycleListCalendars(...args: any[]): any;
  function psycleResyncCalendar(...args: any[]): any;
  function psycleCleanupDuplicates(...args: any[]): any;

  // Misc time/util (app.js)
  function londonOffsetDeltaMinutes(...args: any[]): number;

  // Native bridge (ios-app/www/native-bridge.js) — present only inside Capacitor.
  var Capacitor: any;
}
