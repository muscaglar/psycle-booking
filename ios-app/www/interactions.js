/**
 * interactions.js — Touch gestures and filter persistence
 *
 * Loaded AFTER app.js. Self-contained IIFE that adds:
 *   A. Pull-to-refresh (calls window.search on threshold)
 *   B. Swipe-to-cancel on My Bookings cards (left swipe → the card's own Cancel / Leave button)
 *   C. Filter persistence (save/restore to localStorage)
 *
 * Depends on: app.js (search, selectedInstructors, selectedCategories, etc.)
 * Exposes on window: saveFilters, restoreFilters
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // A. Pull-to-Refresh
  // ═══════════════════════════════════════════════════════════════════

  const PULL_THRESHOLD = 110;
  const PULL_MAX = 180;
  const PULL_INTENT = 24; // downward movement required before we react at all
  let pullStartY = 0;
  let pullCurrentY = 0;
  let pullArmed = false;  // touch began at the top, outside excluded targets
  let isPulling = false;  // deliberate downward intent confirmed
  let pullIndicator = null;

  function createPullIndicator() {
    if (pullIndicator) return pullIndicator;
    pullIndicator = document.createElement('div');
    pullIndicator.className = 'pull-indicator';
    pullIndicator.innerHTML = '<div class="pull-spinner"></div><span class="pull-text">Pull to refresh</span>';
    document.body.prepend(pullIndicator);
    return pullIndicator;
  }

  function updatePullIndicator(distance) {
    if (!pullIndicator) return;
    const clamped = Math.min(distance, PULL_MAX);
    const progress = Math.min(clamped / PULL_THRESHOLD, 1);
    pullIndicator.style.transform = `translateX(-50%) translateY(${clamped - 50}px)`;
    pullIndicator.style.opacity = progress;

    const spinner = pullIndicator.querySelector('.pull-spinner');
    if (spinner) {
      spinner.style.transform = `rotate(${progress * 360}deg)`;
    }

    const text = pullIndicator.querySelector('.pull-text');
    if (text) {
      text.textContent = clamped >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
    }
  }

  function resetPullIndicator() {
    if (!pullIndicator) return;
    pullIndicator.classList.remove('refreshing');
    pullIndicator.style.transform = 'translateX(-50%) translateY(-50px)';
    // Once the pill's `top` clears the status bar / Dynamic Island, -50px alone
    // parks it BESIDE the island, where it shows for the length of the opacity
    // fade — lift it by the inset too. Second assignment on purpose: an engine
    // without env() drops it at parse time and keeps the line above.
    pullIndicator.style.transform = 'translateX(-50%) translateY(calc(-50px - env(safe-area-inset-top, 0px)))';
    pullIndicator.style.opacity = '0';
  }

  function showRefreshing() {
    if (!pullIndicator) return;
    pullIndicator.classList.add('refreshing');
    pullIndicator.style.transform = 'translateX(-50%) translateY(10px)';
    pullIndicator.style.opacity = '1';
    const text = pullIndicator.querySelector('.pull-text');
    if (text) text.textContent = 'Refreshing...';
    const spinner = pullIndicator.querySelector('.pull-spinner');
    if (spinner) spinner.style.transform = '';
  }

  // Refresh whatever is actually on screen: bookings on the My Bookings
  // tab, the last search on Discover (only if results are showing).
  // Returns a promise/truthy when a refresh ran, null when there is
  // nothing sensible to refresh (then the gesture is a no-op).
  function pullRefreshAction() {
    var active = document.querySelector('.tab-panel.active');
    var tabId = active ? active.id : 'tab-discover';
    if (tabId === 'tab-bookings') {
      // Session expired: the list is kept on purpose (the widget, Live Activity
      // and class reminders stay true until the member signs back in), and
      // fetchMyBookings' no-token branch would empty it — the next foreground
      // then blanked the widget and cancelled every armed reminder. Nothing to
      // refresh without a session: the pill just resets.
      if (typeof getBearerToken === 'function' && !getBearerToken()) return null;
      return (typeof fetchMyBookings === 'function') ? (fetchMyBookings() || true) : null;
    }
    // Discover: the same silent refresh as its "Updated · Refresh" link — the
    // list stays up and is re-rendered in place, scroll kept. (This was a
    // no-op while the gesture still armed mid-scroll; it only arms at the very
    // top now, and showed a pill that then did nothing.) Before a first load
    // there is nothing to refresh — and signed out (the public window stays in
    // memory) revalidateWindow() will not run: refreshWindow()'s promise is
    // truthy all the same, and held "Refreshing..." up over a pull that sent
    // nothing.
    if (tabId === 'tab-discover' && window._windowEvents && typeof refreshWindow === 'function' &&
        typeof getBearerToken === 'function' && getBearerToken()) {
      return refreshWindow();
    }
    return null;
  }

  // At <=640px the body is overflow:hidden and .tab-content is the scroller,
  // so window.scrollY is always 0 on iPhone and guarding on it alone armed the
  // pull on any downward drag mid-list. `> 0`, not `!== 0`: iOS rubber-banding
  // reports a NEGATIVE scrollTop at the top, which is exactly when to arm.
  let pullScroller = null;
  function pullScrolledDown() {
    return window.scrollY > 0 || (!!pullScroller && pullScroller.scrollTop > 0);
  }

  document.addEventListener('touchstart', function (e) {
    pullArmed = false;
    isPulling = false;
    pullScroller = e.target.closest ? e.target.closest('.tab-content') : null;
    if (pullScrolledDown()) return;
    // Don't capture inside overlays, scrollable widgets, or interactive elements.
    if (e.target.closest(
      '.modal-overlay, .modal, .tab-bar, button, input, select, textarea, ' +
      '.week-grid, .instr-dropdown, .settings-overlay, .confirm-overlay, ' +
      '.bike-modal-overlay, .class-detail-overlay, .instr-modal-overlay, .history-modal-overlay'
    )) return;
    pullStartY = e.touches[0].clientY;
    pullCurrentY = pullStartY;
    pullArmed = true;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!pullArmed) return;
    if (pullScrolledDown()) {
      pullArmed = false;
      isPulling = false;
      resetPullIndicator();
      return;
    }
    pullCurrentY = e.touches[0].clientY;
    const distance = pullCurrentY - pullStartY;
    // Require deliberate downward movement before showing anything
    if (!isPulling) {
      if (distance < PULL_INTENT) return;
      isPulling = true;
      createPullIndicator();
    }
    if (distance > 0) {
      updatePullIndicator(distance);
    }
  }, { passive: true });

  document.addEventListener('touchend', function () {
    if (!pullArmed) return;
    pullArmed = false;
    if (!isPulling) return;
    isPulling = false;
    const distance = pullCurrentY - pullStartY;
    if (distance >= PULL_THRESHOLD) {
      var result = null;
      try { result = pullRefreshAction(); } catch (err) { result = null; }
      if (!result) {
        resetPullIndicator();
      } else {
        showRefreshing();
        if (typeof result.then === 'function') {
          result.finally(function () {
            setTimeout(resetPullIndicator, 400);
          });
        } else {
          setTimeout(resetPullIndicator, 1500);
        }
      }
    } else {
      resetPullIndicator();
    }
    pullStartY = 0;
    pullCurrentY = 0;
  }, { passive: true });


  // ═══════════════════════════════════════════════════════════════════
  // A2. Keyboard scroll-drift fix (iOS WKWebView)
  // iOS scrolls the whole webview UP to lift a focused input above the
  // keyboard, and does NOT restore it when the keyboard dismisses — so the
  // app stays shoved up. The real scroller is .tab-content, so the document
  // itself should never hold a scroll offset. Snap it back to 0 once focus
  // leaves all text fields (i.e. the keyboard is going away).
  // ═══════════════════════════════════════════════════════════════════
  function _isTextField(el) {
    return !!(el && el.matches &&
      el.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, [contenteditable]'));
  }
  document.addEventListener('focusout', function (e) {
    if (!_isTextField(e.target)) return;
    // Defer so we run after the keyboard-dismiss + any focus move settles.
    setTimeout(function () {
      if (_isTextField(document.activeElement)) return; // moved to another field — keyboard still up
      window.scrollTo(0, 0);
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    }, 100);
  }, { passive: true });


  // ═══════════════════════════════════════════════════════════════════
  // B. Swipe-to-Cancel on My Bookings cards
  // A left swipe is a shortcut to the card's own primary button, so it goes
  // through the same confirm (late-cancel warning / Leave waitlist) as a tap.
  // ═══════════════════════════════════════════════════════════════════

  // ── pure:swipe-cancel:start ── (DOM-free; tests/suites/bookings-card.js evaluates this block)
  const SWIPE_CANCEL_THRESHOLD = 0.4; // 40% of width
  // The card markup (renderMyBookings in app.js) this gesture hangs off. Named
  // here, not inline: the gesture once outlived the classes it looked for and
  // was silently dead — the suite checks these against what app.js really emits.
  const SWIPE_CARD_SELECTOR = '.my-booking-card';
  // Only a button that cancels or leaves (.booked): "Claim spot" BOOKS a seat,
  // a past class has no button, and a disabled one is already mid-request.
  const SWIPE_BUTTON_SELECTOR = '.mb-primary-btn.booked:not(:disabled)';
  // Touches that start on the card's own controls belong to those controls.
  const SWIPE_IGNORE_SELECTOR = '.booking-actions, .up-seat-chip, .mb-primary-btn, .find-similar-popup';

  // 'scroll' = vertical intent, give the touch back; null = too early to say.
  function swipeDirection(dx, dy) {
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return null;
    return Math.abs(dy) > Math.abs(dx) ? 'scroll' : 'swipe';
  }

  // Far enough (and leftwards) to mean it? A zero-width card never qualifies.
  function swipeShouldCancel(deltaX, width) {
    return width > 0 && deltaX < 0 && Math.abs(deltaX) / width >= SWIPE_CANCEL_THRESHOLD;
  }
  // ── pure:swipe-cancel:end ──

  let swipeTarget = null;
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeDeltaX = 0;
  let swipeLocked = false; // once direction is determined

  function getUpcomingItem(el) {
    if (!el || typeof el.closest !== 'function' || el.closest(SWIPE_IGNORE_SELECTOR)) return null;
    const card = el.closest(SWIPE_CARD_SELECTOR);
    return card && card.querySelector(SWIPE_BUTTON_SELECTOR) ? card : null;
  }

  function ensureSwipeBg(item) {
    if (item.querySelector('.swipe-cancel-bg')) return;
    const bg = document.createElement('div');
    bg.className = 'swipe-cancel-bg';
    bg.setAttribute('aria-hidden', 'true'); // decoration: the real control is the card's button
    const label = document.createElement('span');
    label.textContent = item.classList.contains('is-waitlisted') ? 'Leave' : 'Cancel';
    bg.appendChild(label);
    item.insertBefore(bg, item.firstChild);
  }

  function resetSwipeStyles(item) {
    item.style.transition = '';
    item.style.transform = '';
    item.style.opacity = '';
  }

  function endSwipe(cancelled) {
    if (!swipeTarget) return;
    const item = swipeTarget;
    const locked = swipeLocked;
    const deltaX = swipeDeltaX;
    swipeTarget = null;
    swipeDeltaX = 0;
    swipeLocked = false;
    if (!locked) return; // a tap or a scroll: the card was never touched

    const width = item.offsetWidth;
    const cancelBtn = item.querySelector(SWIPE_BUTTON_SELECTOR);
    item.style.transition = 'transform 0.25s ease';

    if (!cancelled && cancelBtn && swipeShouldCancel(deltaX, width)) {
      // Slide fully off screen, then hand over to the card's own button
      item.style.transform = `translateX(-${width}px)`;
      item.style.opacity = '0';
      setTimeout(function () {
        // A refresh may have re-rendered the list meanwhile: never act through
        // a button that is no longer on the page.
        if (cancelBtn.isConnected) cancelBtn.click();
        // Back in place behind the confirm dialog — declining leaves the card as it was
        setTimeout(function () { resetSwipeStyles(item); }, 300);
      }, 250);
    } else {
      // Snap back
      item.style.transform = '';
      setTimeout(function () { item.style.transition = ''; }, 250);
    }

    // Reset cancel bg
    const bg = item.querySelector('.swipe-cancel-bg');
    if (bg) {
      setTimeout(function () { bg.style.opacity = ''; }, 250);
    }
  }

  document.addEventListener('touchstart', function (e) {
    // A second finger landing mid-swipe: put that card back first, or it
    // stays wherever the first finger left it.
    endSwipe(true);
    const item = e.touches.length === 1 ? getUpcomingItem(e.target) : null;
    if (!item) return;
    swipeTarget = item;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeDeltaX = 0;
    swipeLocked = false;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!swipeTarget) return;
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;

    // Determine direction once we have enough movement
    if (!swipeLocked) {
      const direction = swipeDirection(dx, dy);
      if (!direction) return; // too little movement
      // If vertical movement dominates, this is a scroll, not a swipe
      if (direction === 'scroll') {
        swipeTarget = null;
        return;
      }
      swipeLocked = true;
      ensureSwipeBg(swipeTarget);
      // Remove transition during drag
      swipeTarget.style.transition = 'none';
      // While .class-card's entry animation (cardEnter, fill-mode backwards) is
      // still running — the first ~0.5s after a render, stagger delay included —
      // it holds transform + opacity, and an animation outranks inline style:
      // the card would not move. Never restored: putting it back would replay
      // the entry, and the next render rebuilds the card anyway.
      swipeTarget.style.animation = 'none';
    }

    swipeDeltaX = Math.min(0, dx); // only allow left swipe
    swipeTarget.style.transform = `translateX(${swipeDeltaX}px)`;

    // Update cancel bg opacity based on progress
    const width = swipeTarget.offsetWidth;
    const progress = Math.abs(swipeDeltaX) / (width * SWIPE_CANCEL_THRESHOLD);
    const bg = swipeTarget.querySelector('.swipe-cancel-bg');
    if (bg) {
      bg.style.opacity = Math.min(progress, 1);
    }
  }, { passive: true });

  document.addEventListener('touchend', function () { endSwipe(false); }, { passive: true });
  // The system took the touch (scroll, notification, app switch): snap back,
  // never cancel on a gesture the member did not finish.
  document.addEventListener('touchcancel', function () { endSwipe(true); }, { passive: true });


  // ═══════════════════════════════════════════════════════════════════
  // C. Filter Persistence
  // ═══════════════════════════════════════════════════════════════════

  const FILTERS_KEY = 'psycle_saved_filters';

  function saveFilters() {
    try {
      // While a "find it" shortcut's filters are on screen (app.js _focusSearch),
      // what the member had on BEFORE it is what the next launch restores: the
      // shortcut is deliberately unsaved, and this save — fired by their next
      // tap (× on the instructor chip, a date pill) — used to snapshot the
      // cleared home studio / class type for good. Per dimension: one they have
      // since changed by hand is no longer held, and saves live.
      const held = (typeof window !== 'undefined' && window._focusStash) || {};
      const own = function (key, live) { return Array.isArray(held[key]) ? held[key].slice() : live; };
      const filters = {
        instructorIds: typeof selectedInstructors !== 'undefined' ? [...selectedInstructors] : [],
        locationIds: own('locationIds', typeof selectedLocations !== 'undefined' ? [...selectedLocations] : []),
        categories: own('categories', typeof selectedCategories !== 'undefined' ? [...selectedCategories] : []),
        strengthSubs: own('strengthSubs', typeof selectedStrengthSubs !== 'undefined' ? [...selectedStrengthSubs] : []),
        reformerSubs: own('reformerSubs', typeof selectedReformerSubs !== 'undefined' ? [...selectedReformerSubs] : []),
        // The Time row (app.js): band keys + the "Available only" pill.
        timeBands: own('timeBands', typeof selectedTimeBands !== 'undefined' ? [...selectedTimeBands] : []),
        availableOnly: typeof held.availableOnly === 'boolean' ? held.availableOnly
          : (typeof _availableOnly !== 'undefined' ? _availableOnly === true : false),
        startDate: document.getElementById('startDate')?.value || '',
        daysAhead: document.getElementById('daysAhead')?.value || '7',
        dateQuickMode: typeof _dateQuickMode !== 'undefined' ? _dateQuickMode : null,
      };
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch (e) {
      // Silently fail if localStorage is unavailable
    }
  }

  function restoreFilters() {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (!raw) return;
      const filters = JSON.parse(raw);

      // Restore instructor selections
      if (filters.instructorIds && Array.isArray(filters.instructorIds) && filters.instructorIds.length > 0) {
        if (typeof selectedInstructors !== 'undefined') {
          selectedInstructors.clear();
          filters.instructorIds.forEach(function (id) {
            // Only add if the instructor actually exists
            if (typeof instructors !== 'undefined' && instructors.some(function (i) { return String(i.id) === String(id); })) {
              selectedInstructors.add(String(id));
            }
          });
          if (typeof renderInstrChips === 'function') renderInstrChips();
          if (typeof renderInstrDropdown === 'function') renderInstrDropdown();
        }
      }

      // Restore studios (multi-select; legacy saves had a single locationId)
      var savedLocs = filters.locationIds || (filters.locationId ? [filters.locationId] : []);
      if (savedLocs.length > 0 && typeof selectedLocations !== 'undefined') {
        selectedLocations.clear();
        savedLocs.forEach(function (id) {
          if (typeof locations !== 'undefined' && locations.some(function (l) { return String(l.id) === String(id); })) {
            selectedLocations.add(String(id));
          }
        });
        if (typeof renderLocationChips === 'function') renderLocationChips();
      }

      // Restore categories
      if (filters.categories && Array.isArray(filters.categories)) {
        if (typeof selectedCategories !== 'undefined') {
          selectedCategories.clear();
          filters.categories.forEach(function (key) { selectedCategories.add(key); });
          if (typeof renderCategoryPills === 'function') renderCategoryPills();
        }
      }

      // Restore strength subs
      if (filters.strengthSubs && Array.isArray(filters.strengthSubs)) {
        if (typeof selectedStrengthSubs !== 'undefined') {
          selectedStrengthSubs.clear();
          filters.strengthSubs.forEach(function (key) { selectedStrengthSubs.add(key); });
          if (typeof renderStrengthSubPills === 'function') renderStrengthSubPills();
        }
      }

      // Restore reformer subs
      if (filters.reformerSubs && Array.isArray(filters.reformerSubs) && filters.reformerSubs.length > 0) {
        if (typeof selectedReformerSubs !== 'undefined') {
          selectedReformerSubs.clear();
          filters.reformerSubs.forEach(function (key) { selectedReformerSubs.add(key); });
          if (typeof renderReformerSubPills === 'function') renderReformerSubPills();
        }
      }

      // Restore the Time row. A save from before it existed has neither field
      // and comes back as "any time" (setTimeFilters validates the keys).
      if (typeof setTimeFilters === 'function') setTimeFilters(filters.timeBands, filters.availableOnly);

      // Restore the date range. app.js's _restoredDateState() decides what
      // comes back: presets (now incl. '14 days') are re-derived from today,
      // a picked date is kept only while it is still ahead, and anything else
      // falls back to the week view. The mode is ALWAYS written — the old
      // no-mode branch left the default 'week' in place over a picked date.
      // "Today" is app.js's localDateStr(): local time, because toISOString()
      // shifts the day in the evening for timezones west of UTC.
      if (typeof _restoredDateState === 'function' && typeof localDateStr === 'function') {
        var dateState = _restoredDateState(filters, localDateStr());
        window._dateQuickMode = dateState.mode;
        document.getElementById('startDate').value = dateState.startDate;
        document.getElementById('daysAhead').value = dateState.daysAhead;
        // Pills + the calendar button's date label are painted from that state.
        if (typeof _syncDatePills === 'function') _syncDatePills();
      }

      if (typeof updateFiltersSummary === 'function') updateFiltersSummary();
      // Re-apply the restored selections against the (cached) window: refresh
      // the cascading facet counts and re-render results to match the chips.
      if (typeof refreshFacetCounts === 'function') refreshFacetCounts();
      if (typeof triggerAutoSearch === 'function') triggerAutoSearch();
    } catch (e) {
      // Silently fail if stored data is corrupt
    }
  }

  // Expose to global scope
  window.saveFilters = saveFilters;
  window.restoreFilters = restoreFilters;

  // ── Monkey-patch global functions to hook saveFilters ────────────

  function wrapGlobal(name, afterFn) {
    var original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function () {
      var result = original.apply(this, arguments);
      // If the original returns a promise, save after it resolves
      if (result && typeof result.then === 'function') {
        result.then(afterFn);
      } else {
        afterFn();
      }
      return result;
    };
  }

  // Wrap functions that change filter state
  wrapGlobal('toggleInstructor', saveFilters);
  wrapGlobal('removeInstructor', saveFilters);
  wrapGlobal('applyFavouritesAsFilter', saveFilters);
  wrapGlobal('applyTierFilter', saveFilters);
  wrapGlobal('toggleCategory', saveFilters);
  wrapGlobal('toggleStrengthSub', saveFilters);
  wrapGlobal('toggleReformerSub', saveFilters);
  wrapGlobal('toggleTimeBand', saveFilters);
  wrapGlobal('toggleAvailableOnly', saveFilters);
  wrapGlobal('clearTimeFilters', saveFilters);
  wrapGlobal('setDateQuick', saveFilters);
  wrapGlobal('onDateInputChange', saveFilters);

  // Hook studio chip toggles
  wrapGlobal('toggleLocation', saveFilters);

  // "Clear filters" is a filter change too — unsaved, the cleared studio or
  // class type simply came back on the next launch.
  wrapGlobal('clearFilters', saveFilters);

  // ── Wait for init IIFE to complete, then restore filters ────────
  // The init IIFE in app.js is an async function that fetches instructors,
  // locations, and eventTypes. We use a polling approach to detect when
  // these are loaded, then restore.
  function waitForDataAndRestore() {
    if (typeof instructors !== 'undefined' && instructors.length > 0 &&
        typeof locations !== 'undefined' && locations.length > 0) {
      restoreFilters();
    } else {
      setTimeout(waitForDataAndRestore, 100);
    }
  }

  // Start polling after a small delay to let the init IIFE begin
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(waitForDataAndRestore, 200);
    });
  } else {
    setTimeout(waitForDataAndRestore, 200);
  }

})();
