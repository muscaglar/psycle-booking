// ── Centralized State Management ────────────────────────────────
// Loaded BEFORE app.js. Wraps all global state into PsycleState
// with backward-compatible window accessors so existing code works
// unchanged. Adds subscribe() for reactive updates and snapshot()
// for debugging.

const PsycleState = {
  // ── Data from API ──────────────────────────────────────────────
  instructors: [],
  locations: [],
  eventTypes: [],
  currentUser: null,

  // ── Studio layout cache (populated during render) ─────────────
  _studioMap: {},

  // ── Bookings: eventId(str) -> { bookingId, slots: [Number] } ──
  _myBookings: {},

  // ── Event metadata cache (for upcoming panel) ─────────────────
  _eventCache: {},

  // ── Filter state ──────────────────────────────────────────────
  selectedInstructors: new Set(),
  selectedCategories: new Set(),
  selectedStrengthSubs: new Set(['UPPER', 'LOWER', 'FULL']),
  favouriteInstructors: new Set(),

  // ── Booking modal state ───────────────────────────────────────
  _bookingContext: null,
  _selectedSlots: [],

  // ── UI state ──────────────────────────────────────────────────
  _upcomingCollapsed: false,
  _dateQuickMode: 'week',
  instrFocusIdx: -1,
  toastTimer: undefined,

  // ── Search abort flag ─────────────────────────────────────────
  _searchAborted: false,

  // ── Subscription system ───────────────────────────────────────
  _subscribers: {},

  /**
   * Subscribe to changes on a specific state key.
   * Returns an unsubscribe function.
   *
   *   const unsub = PsycleState.subscribe('_myBookings', (newVal, oldVal) => {
   *     console.log('Bookings changed:', newVal);
   *   });
   *   unsub(); // stop listening
   */
  subscribe(key, callback) {
    if (!this._subscribers[key]) {
      this._subscribers[key] = [];
    }
    this._subscribers[key].push(callback);
    return () => {
      const list = this._subscribers[key];
      if (list) {
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  },

  /**
   * Notify all subscribers for a given key.
   * Called automatically by property setters.
   */
  _notify(key, newVal, oldVal) {
    const list = this._subscribers[key];
    if (!list || list.length === 0) return;
    for (const cb of list) {
      try { cb(newVal, oldVal); }
      catch (e) { console.error(`[PsycleState] subscriber error for "${key}":`, e); }
    }
  },

  /**
   * Return a JSON-safe snapshot of all state for debugging.
   * Sets are converted to arrays; functions are omitted.
   */
  snapshot() {
    const snap = {};
    for (const key of Object.keys(this)) {
      if (key === '_subscribers' || typeof this[key] === 'function') continue;
      const val = this[key];
      if (val instanceof Set) {
        snap[key] = [...val];
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        try { snap[key] = JSON.parse(JSON.stringify(val)); }
        catch { snap[key] = '[unserializable]'; }
      } else {
        snap[key] = val;
      }
    }
    return snap;
  },
};

// ── Reactive property wiring ────────────────────────────────────
// For primitive/reassignable properties, we replace direct storage
// with getter/setter pairs that fire notifications on change.
// Set/Object properties keep their identity (mutated in place) so
// they stay as plain properties -- subscribers for those are fired
// via manual _notify calls or by wrapping mutating code later.

(function wireReactiveProperties() {
  // Properties that get reassigned (let in app.js)
  const reassignable = [
    'instructors',
    'locations',
    'eventTypes',
    'currentUser',
    '_myBookings',
    '_bookingContext',
    '_selectedSlots',
    '_upcomingCollapsed',
    '_dateQuickMode',
    'instrFocusIdx',
    'favouriteInstructors',
    'toastTimer',
    '_searchAborted',
  ];

  for (const key of reassignable) {
    let _value = PsycleState[key];

    Object.defineProperty(PsycleState, key, {
      enumerable: true,
      configurable: true,
      get() { return _value; },
      set(v) {
        const old = _value;
        _value = v;
        if (v !== old) {
          PsycleState._notify(key, v, old);
        }
      },
    });
  }
})();

// ── Backward-compatible window accessors ────────────────────────
// Existing code in app.js and calendar.js references these as bare
// globals (e.g. `instructors = [...]` or `_myBookings[id] = ...`).
// We define property accessors on window so reads/writes go through
// PsycleState transparently.

(function defineWindowAccessors() {
  const globals = [
    'instructors',
    'locations',
    'eventTypes',
    'currentUser',
    '_studioMap',
    '_myBookings',
    '_eventCache',
    'selectedInstructors',
    'selectedCategories',
    'selectedStrengthSubs',
    'favouriteInstructors',
    '_bookingContext',
    '_selectedSlots',
    '_upcomingCollapsed',
    '_dateQuickMode',
    'instrFocusIdx',
    'toastTimer',
    '_searchAborted',
  ];

  for (const key of globals) {
    Object.defineProperty(window, key, {
      enumerable: true,
      configurable: true,
      get() { return PsycleState[key]; },
      set(v) { PsycleState[key] = v; },
    });
  }
})();

// ── Expose PsycleState globally ─────────────────────────────────
window.PsycleState = PsycleState;
