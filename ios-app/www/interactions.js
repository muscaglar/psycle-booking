/**
 * interactions.js — Touch gestures and filter persistence
 *
 * Loaded AFTER app.js. Self-contained IIFE that adds:
 *   A. Pull-to-refresh (calls window.search on threshold)
 *   B. Swipe-to-cancel on upcoming booking items
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
      return (typeof fetchMyBookings === 'function') ? (fetchMyBookings() || true) : null;
    }
    if (tabId === 'tab-discover') {
      var hasResults = document.querySelector('#results .day-group');
      if (hasResults && typeof search === 'function') return search() || true;
    }
    return null;
  }

  document.addEventListener('touchstart', function (e) {
    pullArmed = false;
    isPulling = false;
    if (window.scrollY !== 0) return;
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
    if (window.scrollY > 0) {
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
  // B. Swipe-to-Cancel on Upcoming Items
  // ═══════════════════════════════════════════════════════════════════

  const SWIPE_CANCEL_THRESHOLD = 0.4; // 40% of width
  let swipeTarget = null;
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeDeltaX = 0;
  let swipeLocked = false; // once direction is determined

  function getUpcomingItem(el) {
    return el.closest('.upcoming-item');
  }

  function ensureSwipeBg(item) {
    if (item.querySelector('.swipe-cancel-bg')) return;
    const bg = document.createElement('div');
    bg.className = 'swipe-cancel-bg';
    bg.innerHTML = '<span>Cancel</span>';
    item.insertBefore(bg, item.firstChild);
  }

  document.addEventListener('touchstart', function (e) {
    const item = getUpcomingItem(e.target);
    if (!item) return;
    // Don't start swipe on cancel buttons themselves
    if (e.target.closest('.up-cancel') || e.target.closest('.up-cancel-all') || e.target.closest('.up-seat-chip')) return;
    swipeTarget = item;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeDeltaX = 0;
    swipeLocked = false;
    ensureSwipeBg(item);
    // Remove transition during drag
    item.style.transition = 'none';
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!swipeTarget) return;
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;

    // Determine direction once we have enough movement
    if (!swipeLocked) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // too little movement
      // If vertical movement dominates, this is a scroll, not a swipe
      if (Math.abs(dy) > Math.abs(dx)) {
        swipeTarget.style.transition = '';
        swipeTarget = null;
        return;
      }
      swipeLocked = true;
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

  document.addEventListener('touchend', function () {
    if (!swipeTarget) return;
    const item = swipeTarget;
    const width = item.offsetWidth;
    const swipeRatio = Math.abs(swipeDeltaX) / width;

    item.style.transition = 'transform 0.25s ease';

    if (swipeRatio >= SWIPE_CANCEL_THRESHOLD) {
      // Slide fully off screen, then trigger cancel
      item.style.transform = `translateX(-${width}px)`;
      item.style.opacity = '0';

      // Find the event ID from the item's onclick or cancel button
      const cancelBtn = item.querySelector('.up-cancel') || item.querySelector('.up-cancel-all');
      if (cancelBtn) {
        setTimeout(function () {
          cancelBtn.click();
          // Reset after cancel completes
          setTimeout(function () {
            item.style.transition = '';
            item.style.transform = '';
            item.style.opacity = '';
          }, 300);
        }, 250);
      } else {
        // No cancel button, snap back
        item.style.transform = '';
        item.style.opacity = '';
      }
    } else {
      // Snap back
      item.style.transform = '';
    }

    // Reset cancel bg
    const bg = item.querySelector('.swipe-cancel-bg');
    if (bg) {
      setTimeout(function () { bg.style.opacity = ''; }, 250);
    }

    swipeTarget = null;
    swipeDeltaX = 0;
    swipeLocked = false;
  }, { passive: true });


  // ═══════════════════════════════════════════════════════════════════
  // C. Filter Persistence
  // ═══════════════════════════════════════════════════════════════════

  const FILTERS_KEY = 'psycle_saved_filters';

  function saveFilters() {
    try {
      const filters = {
        instructorIds: typeof selectedInstructors !== 'undefined' ? [...selectedInstructors] : [],
        locationIds: typeof selectedLocations !== 'undefined' ? [...selectedLocations] : [],
        categories: typeof selectedCategories !== 'undefined' ? [...selectedCategories] : [],
        strengthSubs: typeof selectedStrengthSubs !== 'undefined' ? [...selectedStrengthSubs] : [],
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

      // Restore date quick mode and date fields
      if (filters.dateQuickMode) {
        if (typeof _dateQuickMode !== 'undefined') {
          window._dateQuickMode = filters.dateQuickMode;
        }
        // Highlight the correct quick-pick button
        document.querySelectorAll('.date-quick-btn').forEach(function (b) {
          b.classList.remove('active');
          var modeMap = { 'today': 'Today', 'tomorrow': 'Tomorrow', 'week': '7 days' };
          if (b.textContent.trim() === modeMap[filters.dateQuickMode]) {
            b.classList.add('active');
          }
        });
        // For today/tomorrow, recalculate the actual date (it shifts daily).
        // Local-time formatting — toISOString() shifts the day in the evening
        // for timezones west of UTC.
        var fmtLocal = function (d) {
          return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
        };
        var todayDate = new Date();
        var todayStr = fmtLocal(todayDate);
        if (filters.dateQuickMode === 'today') {
          document.getElementById('startDate').value = todayStr;
          document.getElementById('daysAhead').value = 1;
          var daysGroup = document.getElementById('daysAheadGroup');
          if (daysGroup) daysGroup.style.display = 'none';
        } else if (filters.dateQuickMode === 'tomorrow') {
          var tmrw = new Date(todayDate);
          tmrw.setDate(tmrw.getDate() + 1);
          document.getElementById('startDate').value = fmtLocal(tmrw);
          document.getElementById('daysAhead').value = 1;
          var daysGroup2 = document.getElementById('daysAheadGroup');
          if (daysGroup2) daysGroup2.style.display = 'none';
        } else if (filters.dateQuickMode === 'week') {
          document.getElementById('startDate').value = todayStr;
          document.getElementById('daysAhead').value = 7;
        }
      } else {
        // Restore raw date values when no quick mode
        if (filters.startDate) {
          document.getElementById('startDate').value = filters.startDate;
        }
        if (filters.daysAhead) {
          document.getElementById('daysAhead').value = filters.daysAhead;
        }
        // Clear quick-pick buttons
        document.querySelectorAll('.date-quick-btn').forEach(function (b) {
          b.classList.remove('active');
        });
      }

      if (typeof updateFiltersSummary === 'function') updateFiltersSummary();
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
  wrapGlobal('toggleCategory', saveFilters);
  wrapGlobal('toggleStrengthSub', saveFilters);
  wrapGlobal('setDateQuick', saveFilters);
  wrapGlobal('onDateInputChange', saveFilters);

  // Hook studio chip toggles
  wrapGlobal('toggleLocation', saveFilters);

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
