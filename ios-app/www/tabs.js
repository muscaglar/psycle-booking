/**
 * tabs.js — Tab navigation and Insights analytics
 *
 * Self-contained IIFE that creates the Discover / My Bookings / Profile
 * 3-tab system. Profile merges Insights + Explore content.
 * Renders analytics: quick stats, cost tracker, activity heatmap,
 * weekly calendar, class type distribution, lapsed favourites, variety trend,
 * and a canvas-based share image.
 *
 * Depends on: app.js (all globals), features.js (openHistoryModal),
 *             explore.js (renderExplore), state.js (PsycleEvents)
 * Exposes on window:
 *   switchTab, renderInsights, weekNav, shareInsights, planDay,
 *   openYearReview, shareYearReview, saveWeekAsTemplate, bookTemplateWeek
 */
(function () {
  'use strict';

  // ── Tab Navigation ──────────────────────────────────────────────

  var TABS = ['discover', 'bookings', 'stats', 'membership'];
  var _currentTab = 'discover';

  function initTabs() {
    var controls = document.querySelector('.controls');
    var upcomingPanel = document.getElementById('upcomingPanel');
    var results = document.getElementById('results');
    if (!controls || !results) return;

    // Create tab bar: Discover, Bookings, Stats, Membership.
    // Icons only show on mobile, where the bar docks to the bottom.
    var icon = function (paths) {
      return '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    };
    var TAB_ICONS = {
      discover: icon('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
      bookings: icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>'),
      stats: icon('<path d="M5 20v-6M12 20V8M19 20V5"/>'),
      membership: icon('<circle cx="12" cy="8" r="4"/><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/>'),
    };
    var tabBar = document.createElement('div');
    tabBar.className = 'tab-bar';
    tabBar.innerHTML =
      '<button class="tab-btn active" data-tab="discover" onclick="switchTab(\'discover\')">' + TAB_ICONS.discover + '<span class="tab-label">Discover</span></button>' +
      '<button class="tab-btn" data-tab="bookings" onclick="switchTab(\'bookings\')">' + TAB_ICONS.bookings +
        '<span class="tab-label">Bookings</span> <span class="tab-badge" id="tabBadge"></span>' +
      '</button>' +
      '<button class="tab-btn" data-tab="stats" onclick="switchTab(\'stats\')">' + TAB_ICONS.stats + '<span class="tab-label">Stats</span></button>' +
      '<button class="tab-btn" data-tab="membership" onclick="switchTab(\'membership\')">' + TAB_ICONS.membership + '<span class="tab-label">Membership</span></button>';

    // Insert tab bar after header
    var header = document.querySelector('header');
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(tabBar, header.nextSibling);
    }

    // ── Discover tab: weekly planner + discovery + filters + search results ──
    var discoverPanel = document.createElement('div');
    discoverPanel.id = 'tab-discover';
    discoverPanel.className = 'tab-panel active';

    controls.parentNode.insertBefore(discoverPanel, controls);

    // Redesign: header row — title left, freshness/refresh + clear filters right
    var discHeader = document.createElement('div');
    discHeader.className = 'disc-header';
    var discTitle = document.createElement('div');
    discTitle.className = 'disc-title';
    discTitle.innerHTML = 'Find your<br>next class';
    var discActions = document.createElement('div');
    discActions.className = 'disc-actions';
    discActions.innerHTML =
      '<span id="lastUpdated" class="last-updated"></span>' +
      '<button type="button" class="disc-clear-btn" onclick="clearFilters()">Clear filters</button>';
    discHeader.appendChild(discTitle);
    discHeader.appendChild(discActions);
    discoverPanel.appendChild(discHeader);

    // (Top unified search bar removed — the filters cover instructor/studio/type.)

    // Redesign: "N = classes matching your selection" count chip

    // Weekly planner / "save this week as a template" calendar removed from
    // Discover (not part of the redesign). #weekView is no longer created, so
    // renderWeekView() no-ops via its null-check and the section never appears.

    // Instructor discovery sections (New to you + You might like)
    var discoverExplore = document.createElement('div');
    discoverExplore.id = 'discoverExploreWrap';
    discoverExplore.innerHTML =
      '<div id="exploreNewSection" class="explore-section" style="display:none"></div>' +
      '<div id="exploreLikeSection" class="explore-section" style="display:none"></div>';

    discoverPanel.appendChild(controls);
    discoverPanel.appendChild(results);
    // Discovery lives UNDER the class finder — at the top it competed with
    // the planner and filters for attention (user feedback).
    discoverPanel.appendChild(discoverExplore);

    // ── My Bookings tab: upcoming bookings + history ──
    var bookingsPanel = document.createElement('div');
    bookingsPanel.id = 'tab-bookings';
    bookingsPanel.className = 'tab-panel';

    // Empty state (filled by renderMyBookings — sign-in CTA when logged
    // out, find-a-class CTA when logged in with nothing booked)
    var bookingsEmpty = document.createElement('div');
    bookingsEmpty.id = 'bookingsEmpty';
    bookingsEmpty.className = 'tab-empty';
    bookingsEmpty.style.display = 'none';
    bookingsPanel.appendChild(bookingsEmpty);

    if (upcomingPanel) {
      bookingsPanel.appendChild(upcomingPanel);
    }

    var historyBtnHtml = '<button class="history-in-bookings-btn" id="historyInBookingsBtn" onclick="openHistoryModal()">View full history</button>';
    var historyBtnContainer = document.createElement('div');
    historyBtnContainer.innerHTML = historyBtnHtml;
    bookingsPanel.appendChild(historyBtnContainer.firstChild);

    // ── Stats tab: fitness journey + instructor discovery ──
    var statsPanel = document.createElement('div');
    statsPanel.id = 'tab-stats';
    statsPanel.className = 'tab-panel';
    statsPanel.innerHTML =
      // Signed-out hero (filled by renderInsights)
      '<div id="statsEmpty" class="tab-empty" style="display:none"></div>' +
      // Sync banner (if needed)
      '<div id="exploreSyncSection" class="explore-section" style="display:none"></div>' +
      // Quick stats
      '<div id="statsBar" class="stats-bar" style="display:none"></div>' +
      // Habitual slot alerts — near the top so the next nudge is front and centre
      '<div id="habitSection" class="habit-section" style="display:none"></div>' +
      // Streaks & milestones
      '<div id="streakSection" class="streak-section" style="display:none"></div>' +
      '<div id="lapsedSection" class="insights-section" style="display:none"></div>' +
      // Patterns
      '<div id="recoSection" class="reco-section" style="display:none"></div>' +
      '<div id="classTypeSection" class="insights-section" style="display:none"></div>' +
      // Deep analytics
      '<div id="exploreMapSection" class="explore-section" style="display:none"></div>' +
      '<div id="varietySection" class="insights-section" style="display:none"></div>' +
      '<div id="heatmapSection" class="heatmap-section" style="display:none"></div>' +
      // Year in review entry point
      '<div id="yearReviewSection" class="insights-section" style="display:none"></div>' +
      // Share
      '<div id="shareSection" class="insights-section" style="padding:8px 24px 24px"><button class="share-insights-btn" onclick="shareInsights()">Share my stats</button></div>';

    // ── Membership tab: account, subscription, cost, settings ──
    var membershipPanel = document.createElement('div');
    membershipPanel.id = 'tab-membership';
    membershipPanel.className = 'tab-panel';
    // Membership = the user's relationship with Psycle: plan, usage,
    // and their instructor rankings/favourites. App-focused settings
    // (theme, reminders, data) live in the Settings panel.
    membershipPanel.innerHTML =
      '<div id="membershipSignin" class="tab-empty" style="display:none"></div>' +
      '<div id="costSection" class="cost-section" style="display:none"></div>' +
      '<div id="membershipInfo" class="insights-section" style="display:none"></div>' +
      // Appearance (theme cards) — moved out of the Settings overlay
      '<div class="ms-section">' +
        '<div class="ms-section-title">Appearance</div>' +
        '<div id="themePicker"></div>' +
      '</div>' +
      // Settings list — each row opens the Settings panel
      '<div class="ms-list">' +
        '<button class="ms-row" onclick="openSettings()"><span class="ms-row-text"><span class="ms-row-label">Bike preferences</span><span class="ms-row-sub">Default studio · favourite bikes</span></span><span class="ms-row-chev">›</span></button>' +
        '<button class="ms-row" onclick="openSettings()"><span class="ms-row-text"><span class="ms-row-label">Reminders</span><span class="ms-row-sub">Class reminders · waitlist alerts</span></span><span class="ms-row-chev">›</span></button>' +
        '<button class="ms-row" onclick="openSettings()"><span class="ms-row-text"><span class="ms-row-label">Calendar sync</span><span class="ms-row-sub">Add bookings to your calendar</span></span><span class="ms-row-chev">›</span></button>' +
        '<button class="ms-row" onclick="openSettings()"><span class="ms-row-text"><span class="ms-row-label">Data &amp; privacy</span><span class="ms-row-sub">Export · import · clear local data</span></span><span class="ms-row-chev">›</span></button>' +
      '</div>' +
      // Sign out (signed-in only — toggled in renderMembershipInfo)
      '<button id="signOutRow" class="ms-signout" onclick="if(typeof clearToken===\'function\')clearToken()" style="display:none">Sign out</button>' +
      '<div class="insights-section">' +
        '<div class="insights-title">Instructor Rankings & Favourites</div>' +
        '<div class="tier-group-label">Ranked</div>' +
        '<div class="tier-list tier-list-short" id="tierListRanked"></div>' +
        '<div class="tier-group-label" style="margin-top:16px">Taken a class with — not yet ranked</div>' +
        '<div class="tier-list tier-list-short" id="tierListUnranked"></div>' +
        '<div class="tier-group-label" style="margin-top:16px">Search all instructors</div>' +
        '<input class="tier-search" id="tierSearch" placeholder="Type a name…" oninput="filterTierList()">' +
        '<div class="tier-list" id="tierListSearch" style="display:none"></div>' +
      '</div>' +
      '<div class="about-block">' +
        '<div class="about-mark">PSYNC</div>' +
        '<div class="about-text">An independent companion for Psycle London riders.<br>Not affiliated with, or endorsed by, Psycle.</div>' +
      '</div>';

    // Wrap all panels in tab-content
    var tabContent = document.createElement('div');
    tabContent.className = 'tab-content';
    tabBar.parentNode.insertBefore(tabContent, discoverPanel);
    tabContent.appendChild(discoverPanel);
    tabContent.appendChild(bookingsPanel);
    tabContent.appendChild(statsPanel);
    tabContent.appendChild(membershipPanel);

    // Move banners before tab content (always visible)
    var sessionBanner = document.getElementById('sessionBanner');
    var corsBanner = document.getElementById('corsBanner');
    if (sessionBanner) tabContent.parentNode.insertBefore(sessionBanner, tabContent);
    if (corsBanner) tabContent.parentNode.insertBefore(corsBanner, tabContent);

    // Read hash (map legacy hashes)
    var hash = location.hash.replace('#', '');
    if (hash === 'insights' || hash === 'explore' || hash === 'profile') hash = 'stats';
    if (TABS.indexOf(hash) !== -1) {
      switchTab(hash, true);
    }

    // Update badge + paint the bookings empty state (checkAuth may have
    // already run and skipped it because these elements didn't exist yet)
    updateTabBadge();
    if (typeof renderMyBookings === 'function') renderMyBookings();
  }

  window.switchTab = function (tab, noHash) {
    _currentTab = tab;
    var btns = document.querySelectorAll('.tab-btn');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
      if (b.dataset.tab === tab) {
        // Centre the active tab by scrolling ONLY the tab bar.
        // scrollIntoView also scrolls ancestors (the page itself on iOS),
        // which made tab switches drag the document around.
        var bar = b.closest('.tab-bar');
        if (bar) {
          var rect = b.getBoundingClientRect();
          var barRect = bar.getBoundingClientRect();
          bar.scrollTo({
            left: bar.scrollLeft + (rect.left - barRect.left) - (barRect.width - rect.width) / 2,
            behavior: 'smooth',
          });
        }
      }
    });
    var panels = document.querySelectorAll('.tab-panel');
    panels.forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + tab);
    });
    // Panels share the document scroller — a scroll position retained from
    // a taller tab leaves a shorter one stuck past the top (iOS overshoot).
    window.scrollTo(0, 0);
    if (!noHash) {
      history.replaceState(null, '', '#' + tab);
    }
    if (tab === 'discover') {
      renderWeekView();
      if (typeof renderExplore === 'function') renderExplore();
    }
    if (tab === 'stats') {
      renderInsights();
      if (typeof renderExplore === 'function') renderExplore();
    }
    if (tab === 'membership') {
      renderMembershipInfo();
      renderCostTracker();
      if (typeof filterTierList === 'function') filterTierList();
    }
  };

  // Deep links and back/forward: react to hash changes after load
  window.addEventListener('hashchange', function () {
    var hash = location.hash.replace('#', '');
    if (hash === 'insights' || hash === 'explore' || hash === 'profile') hash = 'stats';
    if (TABS.indexOf(hash) !== -1 && hash !== _currentTab) switchTab(hash, true);
  });

  function updateTabBadge() {
    var badge = document.getElementById('tabBadge');
    if (!badge) return;
    var now = new Date();
    var count = Object.keys(_myBookings || {}).filter(function (evtId) {
      var evt = (_eventCache || {})[evtId];
      return evt && new Date(evt.start_at) > now;
    }).length;
    badge.textContent = count > 0 ? count : '';
  }

  // Update badge on booking events (via PsycleEvents)
  if (typeof PsycleEvents !== 'undefined') {
    PsycleEvents.on('bookings:loaded', function () {
      updateTabBadge();
      renderWeekView(); // Always update the week view (it's on Discover)
      if (_currentTab === 'stats') renderInsights();
    });
    PsycleEvents.on('booking:complete', function () {
      // No auto tab-switch — the confirmation overlay offers "View my
      // bookings" for users who want to jump there.
      updateTabBadge();
    });
    PsycleEvents.on('booking:cancelled', function () {
      updateTabBadge();
      if (_currentTab === 'stats') renderInsights();
    });
    PsycleEvents.on('seat:cancelled', function () {
      updateTabBadge();
      if (_currentTab === 'stats') renderInsights();
    });
  }

  // Also update badge when renderMyBookings is called directly
  var _origRender = window.renderMyBookings;
  var _patchRender = function () {
    if (!_origRender && typeof window.renderMyBookings === 'function') {
      _origRender = window.renderMyBookings;
      window.renderMyBookings = function () {
        _origRender.apply(this, arguments);
        updateTabBadge();
      };
    }
  };
  _patchRender();
  if (!_origRender) setTimeout(_patchRender, 200);

  // ── Render insights tab content ────────────────────────────────

  /**
   * Get the full class history from localStorage (synced + locally tracked).
   * Each entry has: { eventId, typeName, instrName, locName, date, cancelledAt? }
   */
  function getFullHistory() {
    try { return JSON.parse(localStorage.getItem('psycle_class_history') || '[]'); }
    catch (e) { return []; }
  }

  window.renderInsights = function () {
    // Signed-out with no data: one hero CTA instead of a page of stubs.
    // Hide actions that can only fail (share with nothing to share).
    var signedIn = (typeof currentUser !== 'undefined' && !!currentUser);
    var hasHistory = getFullHistory().some(function (h) { return !h.cancelledAt; });
    var statsEmpty = document.getElementById('statsEmpty');
    var shareSection = document.getElementById('shareSection');
    if (shareSection) shareSection.style.display = hasHistory ? '' : 'none';
    if (statsEmpty) {
      if (!signedIn && !hasHistory) {
        statsEmpty.style.display = '';
        statsEmpty.innerHTML =
          '<div class="tab-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20v-6M12 20V8M19 20V5"/></svg></div>' +
          '<div class="tab-empty-title">Your training<br>story starts here</div>' +
          '<div class="tab-empty-sub">Sign in and sync your booking history to unlock stats, heatmaps, and instructor insights.</div>' +
          '<button class="tab-empty-btn" onclick="openLoginPopup()">Sign in</button>';
      } else {
        statsEmpty.style.display = 'none';
      }
    }
    renderQuickStats();
    renderHabitSlots();
    renderStreaks();
    renderCostTracker();
    renderClassTypeDistribution();
    renderHeatmap();
    renderWeekView();
    renderRecommendations();
    renderLapsedFavourites();
    renderVarietyTrend();
    renderYearReview();
  }

  // ── Quick Stats ────────────────────────────────────────────────

  function renderQuickStats() {
    var container = document.getElementById('statsBar');
    if (!container) return;

    var now = new Date();
    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    var history = getFullHistory();

    // Upcoming from current bookings
    var upcoming = 0;
    Object.entries(bookings).forEach(function (entry) {
      var evt = cache[entry[0]];
      if (evt && new Date(evt.start_at) > now) upcoming++;
    });

    // Use full history for aggregate stats
    var thisMonth = 0;
    var totalClasses = 0;
    var soloClasses = 0;
    var socialClasses = 0;
    var studioCount = {};
    var instrCount = {};

    history.forEach(function (h) {
      if (h.cancelledAt) return;
      totalClasses++;
      var isSocial = h.slots && h.slots.length > 1;
      if (isSocial) socialClasses++; else soloClasses++;
      var dt = new Date(h.date);
      if (dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear()) {
        thisMonth++;
      }
      var loc = h.locName || 'Unknown';
      studioCount[loc] = (studioCount[loc] || 0) + 1;
      var instr = h.instrName || '';
      if (instr) instrCount[instr] = (instrCount[instr] || 0) + 1;
    });

    // Also count current bookings not yet in history
    Object.entries(bookings).forEach(function (entry) {
      var evt = cache[entry[0]];
      if (!evt) return;
      var inHistory = history.some(function (h) { return h.eventId === entry[0]; });
      if (inHistory) return;
      totalClasses++;
      var booking = bookings[entry[0]];
      var isSocial = booking && booking.slots && booking.slots.length > 1;
      if (isSocial) socialClasses++; else soloClasses++;
      var dt = new Date(evt.start_at);
      if (dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear()) {
        thisMonth++;
      }
      var loc = evt._locName || 'Unknown';
      studioCount[loc] = (studioCount[loc] || 0) + 1;
      var instr = evt._instrName || '';
      if (instr) instrCount[instr] = (instrCount[instr] || 0) + 1;
    });

    var favStudio = Object.entries(studioCount).sort(function (a, b) { return b[1] - a[1]; })[0];
    var favInstr = Object.entries(instrCount).sort(function (a, b) { return b[1] - a[1]; })[0];

    if (totalClasses === 0 && upcoming === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = '';
    var html =
      '<div class="stat-card">' +
        '<div class="stat-value">' + upcoming + '</div>' +
        '<div class="stat-label">Upcoming</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-value">' + thisMonth + '</div>' +
        '<div class="stat-label">This month</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-value">' + totalClasses + '</div>' +
        '<div class="stat-label">All time</div>' +
      '</div>';

    // Solo vs Social breakdown
    if (socialClasses > 0) {
      html +=
        '<div class="stat-card">' +
          '<div class="stat-value">' + soloClasses + '</div>' +
          '<div class="stat-label">Solo</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="stat-value">' + socialClasses + '</div>' +
          '<div class="stat-label">With a friend</div>' +
          '<div class="stat-detail">' + Math.round(socialClasses / totalClasses * 100) + '% of classes</div>' +
        '</div>';
    }

    html +=
      (favStudio ? '<div class="stat-card">' +
        '<div class="stat-value" style="font-size:16px">' + escapeHTML(favStudio[0]) + '</div>' +
        '<div class="stat-label">Top studio</div>' +
        '<div class="stat-detail">' + favStudio[1] + ' classes</div>' +
      '</div>' : '') +
      (favInstr ? '<div class="stat-card">' +
        '<div class="stat-value" style="font-size:16px">' + escapeHTML(favInstr[0]) + '</div>' +
        '<div class="stat-label">Top instructor</div>' +
        '<div class="stat-detail">' + favInstr[1] + ' classes</div>' +
      '</div>' : '');

    container.innerHTML = html;
  }

  // ── Weekly Calendar View ───────────────────────────────────────

  var _weekOffset = 0;
  var _displayedMonday = null; // start of the week currently shown (for templates)

  window.weekNav = function (dir) {
    if (dir === 0) _weekOffset = 0; // "Today" button
    else _weekOffset += dir;
    renderWeekView();
  };

  // Interactive weekly planner: tap an empty day to search for classes on that date
  window.planDay = function (dateStr) {
    var startDateEl = document.getElementById('startDate');
    var daysAheadEl = document.getElementById('daysAhead');
    if (startDateEl) startDateEl.value = dateStr;
    if (daysAheadEl) daysAheadEl.value = 1;
    switchTab('discover');
    if (typeof search === 'function') search();
  };

  function renderWeekView() {
    var container = document.getElementById('weekView');
    if (!container) return;

    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    var history = getFullHistory();
    if (Object.keys(bookings).length === 0 && history.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';

    var now = new Date();
    // Start of current week (Monday)
    var monday = new Date(now);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + (_weekOffset * 7));
    monday.setHours(0, 0, 0, 0);
    _displayedMonday = new Date(monday); // remember for "Save this week as template"

    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(monday);
      d.setDate(d.getDate() + i);
      days.push(d);
    }

    var weekLabel = days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
      ' — ' + days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    // Weekly template buttons (Feature 5). "Book my template week" only
    // appears when a saved template exists. Booking logic lives in app.js
    // (window.bookWeeklyTemplate); these are defensive UI hooks.
    var hasTemplate = false;
    try {
      hasTemplate = typeof window.loadWeeklyTemplate === 'function' &&
        Array.isArray(window.loadWeeklyTemplate()) && window.loadWeeklyTemplate().length > 0;
    } catch (e) { hasTemplate = false; }

    var templateBtns = '<button class="week-template-btn" onclick="saveWeekAsTemplate()">Save this week as template</button>';
    if (hasTemplate) {
      templateBtns += '<button class="week-template-btn week-template-book" onclick="bookTemplateWeek()">Book my template week</button>';
    }

    var html = '<div class="week-header">' +
      '<span class="week-title">' + weekLabel + '</span>' +
      '<div class="week-nav">' +
        '<button onclick="weekNav(-1)">‹</button>' +
        '<button onclick="weekNav(0)">Today</button>' +
        '<button onclick="weekNav(1)">›</button>' +
      '</div>' +
    '</div>';
    html += '<div class="week-template-bar">' + templateBtns + '</div>';

    html += '<div class="week-grid">';
    var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    days.forEach(function (day, idx) {
      var isToday = day.toDateString() === now.toDateString();
      // Use local date string (not toISOString which converts to UTC and can shift days)
      var dayStr = day.getFullYear() + '-' +
        String(day.getMonth() + 1).padStart(2, '0') + '-' +
        String(day.getDate()).padStart(2, '0');

      html += '<div class="week-day">';
      html += '<div class="week-day-label' + (isToday ? ' today' : '') + '">' +
        dayNames[idx] +
        '<span class="week-day-num' + (isToday ? ' today' : '') + '">' + day.getDate() + '</span>' +
      '</div>';

      // Find bookings on this day — current bookings first, then history
      var dayEventCount = 0;
      var shownEventIds = new Set();
      Object.entries(bookings).forEach(function (entry) {
        var evtId = entry[0];
        var booking = entry[1];
        var evt = cache[evtId];
        if (!evt) return;
        var evtDay = (evt.start_at || '').split('T')[0].split(' ')[0];
        if (evtDay !== dayStr) return;
        shownEventIds.add(evtId);
        dayEventCount++;

        var dt = new Date(evt.start_at.replace(' ', 'T'));
        var h = dt.getHours();
        var m = dt.getMinutes().toString().padStart(2, '0');
        var ampm = h >= 12 ? 'pm' : 'am';
        var timeStr = (h % 12 || 12) + ':' + m + ampm;
        var slotsCount = booking && booking.slots ? booking.slots.length : 0;
        var socialBadge = slotsCount > 1 ? '<span class="week-event-social" title="' + slotsCount + ' spots booked">+1</span>' : '';

        html += '<div class="week-event" onclick="switchTab(\'bookings\')" title="' +
          escapeHTML(evt._typeName || '') + ' · ' + escapeHTML(evt._instrName || '') + '">' +
          '<div class="week-event-time">' + timeStr + socialBadge + '</div>' +
          '<div class="week-event-name">' + escapeHTML(evt._typeName || 'Class') + '</div>' +
          '<div class="week-event-loc">' + escapeHTML(evt._locName || '') + '</div>' +
        '</div>';
      });

      // History entries not already shown from current bookings
      history.forEach(function (h) {
        if (h.cancelledAt || !h.date || shownEventIds.has(h.eventId)) return;
        var hDay = (h.date || '').split('T')[0].split(' ')[0];
        if (hDay !== dayStr) return;
        dayEventCount++;

        var dt = new Date(h.date.replace(' ', 'T'));
        var hh = dt.getHours();
        var mm = dt.getMinutes().toString().padStart(2, '0');
        var ap = hh >= 12 ? 'pm' : 'am';
        var ts = (hh % 12 || 12) + ':' + mm + ap;

        html += '<div class="week-event" style="opacity:0.7" title="' +
          escapeHTML(h.typeName || '') + ' · ' + escapeHTML(h.instrName || '') + '">' +
          '<div class="week-event-time">' + ts + '</div>' +
          '<div class="week-event-name">' + escapeHTML(h.typeName || 'Class') + '</div>' +
          '<div class="week-event-loc">' + escapeHTML(h.locName || '') + '</div>' +
        '</div>';
      });

      // Interactive empty slot: show "+ Find a class" on days with no events
      if (dayEventCount === 0) {
        html += '<div class="week-add-slot" onclick="planDay(\'' + dayStr + '\')">' +
          '<span class="week-add-icon">+</span> Find a class</div>';
      }

      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
  }

  // ── Weekly Template (Feature 5 — UI only) ──────────────────────
  // Save = scrape the displayed week's bookings into a portable template
  // array; book = hand off to app.js. Both call window.* functions that
  // live elsewhere, so guard every call and degrade with a friendly toast.

  // Collect template entries for the currently displayed week from
  // _myBookings + _eventCache. Each entry is the booking-independent
  // "shape" of a class: weekday/time + the IDs needed to rebook it.
  function _collectDisplayedWeekTemplate() {
    var monday = _displayedMonday ? new Date(_displayedMonday) : null;
    if (!monday) return [];
    var weekStart = new Date(monday); weekStart.setHours(0, 0, 0, 0);
    var weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    var entries = [];

    Object.keys(bookings).forEach(function (evtId) {
      var evt = cache[evtId];
      if (!evt || !evt.start_at) return;
      var dt = new Date(String(evt.start_at).replace(' ', 'T'));
      if (isNaN(dt.getTime())) return;
      if (dt < weekStart || dt >= weekEnd) return;

      entries.push({
        dayOfWeek: dt.getDay(),                 // 0=Sun..6=Sat
        hour: dt.getHours(),
        minute: dt.getMinutes(),
        // IDs are what app.js needs to find the equivalent class next week.
        // _eventCache stores studio_id (not location id) — pass both so the
        // booking layer can resolve whichever it prefers.
        locationId: (evt.location_id != null ? evt.location_id : (evt.studio_id != null ? evt.studio_id : null)),
        eventTypeId: (evt.event_type_id != null ? evt.event_type_id : null),
        instructorId: (evt.instructor_id != null ? evt.instructor_id : null),
        label: (evt._typeName || 'Class') + (evt._instrName ? ' · ' + evt._instrName : ''),
      });
    });

    return entries.sort(function (a, b) {
      // Monday-first ordering, then time of day.
      var ai = (a.dayOfWeek + 6) % 7, bi = (b.dayOfWeek + 6) % 7;
      if (ai !== bi) return ai - bi;
      return (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute);
    });
  }

  window.saveWeekAsTemplate = function () {
    if (typeof window.saveWeeklyTemplate !== 'function') {
      toast('Template saving isn\'t available yet', 'info');
      return;
    }
    var entries = _collectDisplayedWeekTemplate();
    if (entries.length === 0) {
      toast('No bookings in this week to save', 'info');
      return;
    }
    try {
      window.saveWeeklyTemplate(entries);
      toast('Saved ' + entries.length + ' class' + (entries.length === 1 ? '' : 'es') + ' as your template week', 'success');
      renderWeekView(); // surface the "Book my template week" button
    } catch (e) {
      console.error('[template] save failed:', e);
      toast('Couldn\'t save template', 'error');
    }
  };

  var _templateWeekRunning = false;
  window.bookTemplateWeek = async function () {
    if (typeof window.bookWeeklyTemplate !== 'function') {
      toast('Template booking isn\'t available yet', 'info');
      return;
    }
    // Double-tap guard — a second concurrent sweep would double-book.
    if (_templateWeekRunning) return;
    _templateWeekRunning = true;
    toast('Booking your template week…', 'info');
    try {
      var res = await window.bookWeeklyTemplate();
      res = res || {};
      var booked = res.booked || 0, waitlisted = res.waitlisted || 0;
      var failed = res.failed || 0, skipped = res.skipped || 0;
      var parts = [];
      parts.push(booked + ' booked');
      if (waitlisted) parts.push(waitlisted + ' waitlisted');
      if (skipped) parts.push(skipped + ' skipped');
      if (failed) parts.push(failed + ' failed');
      var type = failed > 0 ? 'error' : (booked > 0 || waitlisted > 0 ? 'success' : 'info');
      toast('Template week: ' + parts.join(' · '), type);
    } catch (e) {
      console.error('[template] book failed:', e);
      toast('Couldn\'t book your template week', 'error');
    } finally {
      _templateWeekRunning = false;
    }
  };

  // ── Recommendations ────────────────────────────────────────────

  function renderRecommendations() {
    var container = document.getElementById('recoSection');
    if (!container) return;

    var history = getFullHistory();
    if (history.length < 2) { container.style.display = 'none'; return; }

    // Analyse booking patterns from full history
    var daySlots = {}; // "friday-730" => { type, instr, loc, count }

    history.forEach(function (h) {
      if (h.cancelledAt || !h.date) return;
      var dt = new Date(h.date);
      var dayName = dt.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      var timeKey = dt.getHours() * 100 + dt.getMinutes();
      var key = dayName + '-' + timeKey;
      if (!daySlots[key]) {
        daySlots[key] = {
          day: dayName,
          time: dt.getHours() + ':' + dt.getMinutes().toString().padStart(2, '0'),
          timeAmPm: (dt.getHours() % 12 || 12) + ':' + dt.getMinutes().toString().padStart(2, '0') +
            (dt.getHours() >= 12 ? 'pm' : 'am'),
          type: h.typeName || 'Class',
          instr: h.instrName || '',
          loc: h.locName || '',
          count: 0,
        };
      }
      daySlots[key].count++;
    });

    // Sort by frequency
    var patterns = Object.values(daySlots)
      .filter(function (p) { return p.count >= 1; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 4);

    if (patterns.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';

    var html = '<div class="reco-title">Your routine</div><div class="reco-cards">';
    patterns.forEach(function (p) {
      var dayCapital = p.day.charAt(0).toUpperCase() + p.day.slice(1);
      html += '<div class="reco-card">' +
        '<div class="reco-badge">' + dayCapital + 's at ' + p.timeAmPm + '</div>' +
        '<div class="reco-class">' + escapeHTML(p.type) + '</div>' +
        '<div class="reco-detail">' + instrLink(p.instr) + (p.loc ? ' · ' + escapeHTML(p.loc) : '') + '</div>' +
        '<div class="reco-detail" style="color:#555">' + p.count + 'x booked</div>' +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  // ── Habit-slot alerts (Feature 1) ──────────────────────────────
  // Detect the user's most habitual day-of-week + time + class-type from
  // history frequency. Each card nudges "Find this week" → sets the date
  // filter to the next occurrence of that weekday and searches.

  var DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Local-date "YYYY-MM-DD" for the next occurrence of a weekday (0=Sun..6=Sat).
  // Today counts as "this week" if it still matches.
  function _nextWeekdayDateStr(dow) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var delta = (dow - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function renderHabitSlots() {
    var container = document.getElementById('habitSection');
    if (!container) return;

    var history = getFullHistory();
    if (history.length < 3) { container.style.display = 'none'; return; }

    // Bucket by day-of-week + hour + class-type. Minute is kept for the
    // label but not the key, so 7:00 and 7:05 sessions count as one habit.
    var slots = {}; // "1-7-Ride" => { dow, hour, type, count, minuteVotes }
    history.forEach(function (h) {
      if (h.cancelledAt || !h.date) return;
      var dt = new Date(String(h.date).replace(' ', 'T'));
      if (isNaN(dt.getTime())) return;
      var dow = dt.getDay();
      var hour = dt.getHours();
      var type = h.typeName || 'Class';
      var key = dow + '-' + hour + '-' + type;
      if (!slots[key]) {
        slots[key] = { dow: dow, hour: hour, type: type, count: 0, minuteVotes: {} };
      }
      slots[key].count++;
      var mm = dt.getMinutes();
      slots[key].minuteVotes[mm] = (slots[key].minuteVotes[mm] || 0) + 1;
    });

    // Habits = booked at least twice; strongest first.
    var habits = Object.values(slots)
      .filter(function (s) { return s.count >= 2; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 3);

    if (habits.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';

    var html = '<div class="habit-title">Your usual slots</div>' +
      '<div class="habit-subtitle">Tap to find this week\'s session</div>' +
      '<div class="habit-cards">';

    habits.forEach(function (s) {
      // Most common minute for this slot, for a natural "~7:00am" label.
      var topMinute = 0, topMinuteCount = -1;
      Object.keys(s.minuteVotes).forEach(function (mk) {
        if (s.minuteVotes[mk] > topMinuteCount) { topMinuteCount = s.minuteVotes[mk]; topMinute = Number(mk); }
      });
      var ampm = s.hour >= 12 ? 'pm' : 'am';
      var timeLabel = (s.hour % 12 || 12) + ':' + String(topMinute).padStart(2, '0') + ampm;
      var dayName = DAY_NAMES_FULL[s.dow];
      var dateStr = _nextWeekdayDateStr(s.dow);

      html += '<div class="habit-card">' +
        '<div class="habit-line">You usually ride <strong>' + escapeHTML(dayName) + 's ~' + timeLabel + '</strong></div>' +
        '<div class="habit-class">' + escapeHTML(s.type) + '</div>' +
        '<div class="habit-meta">' + s.count + 'x in your history</div>' +
        '<button class="habit-find-btn" data-date="' + dateStr + '">Find this week</button>' +
      '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
  }

  // Delegated handler: habit "Find this week" buttons carry a safe
  // data-date ("YYYY-MM-DD"). No name/text ever enters an onclick.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.habit-find-btn') : null;
    if (!btn) return;
    var dateStr = btn.getAttribute('data-date');
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    var startDateEl = document.getElementById('startDate');
    var daysAheadEl = document.getElementById('daysAhead');
    if (startDateEl) startDateEl.value = dateStr;
    if (daysAheadEl) daysAheadEl.value = 1;
    if (typeof window._dateQuickMode !== 'undefined') window._dateQuickMode = 'today';
    switchTab('discover');
    if (typeof search === 'function') search();
  });

  // ── Streaks & milestones (Feature 3) ───────────────────────────
  // Weekly streak = consecutive ISO-ish calendar weeks (Mon-anchored)
  // with >=1 attended class. Milestones at 10/25/50/100 total classes.

  // Monday-anchored week index: whole weeks since a fixed epoch Monday.
  // Computed from CALENDAR components in UTC space so DST transitions can't
  // shift a local-midnight timestamp across a week boundary (mixing local
  // getTime() with a UTC epoch made every BST week land one index early,
  // breaking streaks at each clock change).
  function _weekIndex(date) {
    var dayMs = 86400000;
    var dayUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    var mondayShift = (date.getDay() + 6) % 7; // Monday=0
    return Math.round((dayUTC - mondayShift * dayMs - Date.UTC(1970, 0, 5)) / (7 * dayMs));
  }

  function renderStreaks() {
    var container = document.getElementById('streakSection');
    if (!container) return;

    var history = getFullHistory();

    // Set of week indices with an attended class.
    var weeks = {};
    var total = 0;
    history.forEach(function (h) {
      if (h.cancelledAt || !h.date) return;
      var dt = new Date(String(h.date).replace(' ', 'T'));
      if (isNaN(dt.getTime())) return;
      total++;
      weeks[_weekIndex(dt)] = true;
    });

    var weekKeys = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; });
    if (weekKeys.length === 0 && total === 0) { container.style.display = 'none'; return; }

    // Longest run of consecutive week indices.
    var longest = 0, run = 0, prev = null;
    weekKeys.forEach(function (w) {
      if (prev === null || w === prev + 1) run++;
      else run = 1;
      if (run > longest) longest = run;
      prev = w;
    });

    // Current streak: run ending at this week or last week (a one-week
    // grace so a streak isn't "broken" mid-week before you've booked).
    var thisWeek = _weekIndex(new Date());
    var current = 0;
    if (weeks[thisWeek] || weeks[thisWeek - 1]) {
      var cursor = weeks[thisWeek] ? thisWeek : thisWeek - 1;
      while (weeks[cursor]) { current++; cursor--; }
    }

    var MILESTONES = [10, 25, 50, 100];
    var nextMilestone = null;
    for (var mi = 0; mi < MILESTONES.length; mi++) {
      if (total < MILESTONES[mi]) { nextMilestone = MILESTONES[mi]; break; }
    }

    container.style.display = '';
    var html = '<div class="streak-title">Streaks & milestones</div>';
    html += '<div class="streak-cards">';

    html += '<div class="streak-card' + (current >= 2 ? ' streak-live' : '') + '">' +
      '<div class="streak-value">' + current + '</div>' +
      '<div class="streak-label">Week streak</div>' +
      '<div class="streak-hint">' + (current >= 2 ? 'Keep it alive!' : 'Book this week to build it') + '</div>' +
    '</div>';

    html += '<div class="streak-card">' +
      '<div class="streak-value">' + longest + '</div>' +
      '<div class="streak-label">Longest streak</div>' +
      '<div class="streak-hint">Best run of weeks</div>' +
    '</div>';

    html += '<div class="streak-card">' +
      '<div class="streak-value">' + total + '</div>' +
      '<div class="streak-label">Classes</div>' +
      '<div class="streak-hint">' + (nextMilestone ? (nextMilestone - total) + ' to ' + nextMilestone : 'Century club!') + '</div>' +
    '</div>';

    html += '</div>';

    // Milestone badges — earned ones glow, the next is outlined as a target.
    html += '<div class="milestone-row">';
    MILESTONES.forEach(function (m) {
      var earned = total >= m;
      var isNext = !earned && m === nextMilestone;
      html += '<div class="milestone-badge' + (earned ? ' earned' : '') + (isNext ? ' next' : '') + '">' +
        '<span class="milestone-num">' + m + '</span>' +
        '<span class="milestone-cap">classes</span>' +
      '</div>';
    });
    html += '</div>';

    container.innerHTML = html;
  }

  // ── Activity Heatmap ────────────────────────────────────────────
  // GitHub-style grid: rows = hours (5am–10pm), columns = days of week
  // Color intensity shows how often that slot is booked

  function renderHeatmap() {
    var container = document.getElementById('heatmapSection');
    if (!container) return;

    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    var history = [];
    try { history = JSON.parse(localStorage.getItem('psycle_class_history') || '[]'); } catch (e) {}

    // Merge current bookings + history for a richer picture. Skip cancelled
    // history entries (never attended) and history entries whose event is
    // also in _myBookings (in-app bookings land in history immediately —
    // counting both would double-weight every upcoming class).
    var allEvents = [];
    Object.entries(bookings).forEach(function (entry) {
      var evt = cache[entry[0]];
      if (evt) allEvents.push(evt);
    });
    history.forEach(function (h) {
      if (h.cancelledAt || !h.date) return;
      if (bookings[String(h.eventId)]) return;
      allEvents.push({ start_at: h.date });
    });

    if (allEvents.length < 2) { container.style.display = 'none'; return; }
    container.style.display = '';

    // Build frequency grid: [day 0-6][hour 5-22] = count
    var HOUR_START = 5, HOUR_END = 22;
    var grid = {};
    var maxCount = 0;

    allEvents.forEach(function (evt) {
      var dt = new Date(evt.start_at);
      var day = (dt.getDay() + 6) % 7; // Monday=0
      var hour = dt.getHours();
      if (hour < HOUR_START || hour > HOUR_END) return;
      var key = day + '-' + hour;
      grid[key] = (grid[key] || 0) + 1;
      if (grid[key] > maxCount) maxCount = grid[key];
    });

    var dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    var html = '<div class="heatmap-title">Activity heatmap</div>';
    html += '<div class="heatmap-grid">';

    // Header row: hour labels
    html += '<div class="hm-corner"></div>';
    for (var h = HOUR_START; h <= HOUR_END; h++) {
      var ampm = h >= 12 ? 'p' : 'a';
      var h12 = h % 12 || 12;
      html += '<div class="hm-hour-label">' + h12 + ampm + '</div>';
    }

    // Data rows
    for (var d = 0; d < 7; d++) {
      html += '<div class="hm-day-label">' + dayLabels[d] + '</div>';
      for (var hr = HOUR_START; hr <= HOUR_END; hr++) {
        var count = grid[d + '-' + hr] || 0;
        var intensity = maxCount > 0 ? count / maxCount : 0;
        var level = count === 0 ? 0 : intensity < 0.25 ? 1 : intensity < 0.5 ? 2 : intensity < 0.75 ? 3 : 4;
        var title = count > 0 ? count + ' class' + (count !== 1 ? 'es' : '') + ' — ' + dayLabels[d] + ' ' + (hr % 12 || 12) + (hr >= 12 ? 'pm' : 'am') : '';
        html += '<div class="hm-cell hm-level-' + level + '" title="' + title + '"></div>';
      }
    }

    html += '</div>';

    // Legend
    html += '<div class="hm-legend">';
    html += '<span>Less</span>';
    for (var l = 0; l <= 4; l++) {
      html += '<div class="hm-cell hm-level-' + l + '" style="width:12px;height:12px"></div>';
    }
    html += '<span>More</span>';
    html += '</div>';

    container.innerHTML = html;
  }


  // ── Membership Info ────────────────────────────────────────────

  function renderMembershipInfo() {
    var container = document.getElementById('membershipInfo');
    if (!container) return;

    // Appearance picker + Sign-out live in the Membership tab now.
    if (typeof renderThemePicker === 'function') renderThemePicker();
    var _signOut = document.getElementById('signOutRow');
    if (_signOut) _signOut.style.display = (typeof currentUser !== 'undefined' && currentUser) ? '' : 'none';

    var sub = (typeof _activeSubscription !== 'undefined') ? _activeSubscription : null;
    var user = (typeof currentUser !== 'undefined') ? currentUser : null;
    var signinEl = document.getElementById('membershipSignin');
    if (!sub && !user) {
      container.style.display = 'none';
      if (signinEl) {
        signinEl.style.display = '';
        signinEl.innerHTML =
          '<div class="tab-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/></svg></div>' +
          '<div class="tab-empty-title">Membership</div>' +
          '<div class="tab-empty-sub">Sign in to see your plan, class usage, and cost per class.</div>' +
          '<button class="tab-empty-btn" onclick="openLoginPopup()">Sign in</button>';
      }
      return;
    }
    if (signinEl) signinEl.style.display = 'none';
    container.style.display = '';

    var html = '';

    if (sub) {
      var planName = sub.name || 'Subscription';
      var made = Number(sub.bookings_made) || 0;
      var max = sub.max_bookings || 0;
      var status = sub.status_detail || sub.status || 'Active';
      var fmtD = function (d) { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
      var fmtEnd = function (d) { var prev = new Date(d); prev.setDate(prev.getDate() - 1); return fmtD(prev); };
      var periodLabel = sub.period_start && sub.period_end
        ? fmtD(sub.period_start) + ' — ' + fmtEnd(sub.period_end) : '';

      html += '<div class="membership-card">';
      html += '<div class="membership-plan">' + escapeHTML(planName) + '</div>';
      html += '<div class="membership-status">' + escapeHTML(status) + '</div>';
      if (periodLabel) {
        html += '<div class="membership-period">Current period: ' + periodLabel + '</div>';
      }
      if (max > 0) {
        var pct = Math.round((made / max) * 100);
        var remaining = max - made;
        html += '<div class="membership-usage">' + made + ' of ' + max + ' classes used (' + remaining + ' remaining)</div>';
        html += '<div class="sub-progress" style="margin-top:8px"><div class="sub-progress-fill" style="width:' + Math.min(pct, 100) + '%"></div></div>';
      }

      // Upcoming billing periods
      var periods = sub.upcoming_billing_periods || [];
      if (periods.length > 0) {
        html += '<div class="membership-upcoming-title">Upcoming periods</div>';
        html += '<div class="membership-periods">';
        periods.slice(0, 3).forEach(function (p) {
          html += '<div class="membership-period-item">' + fmtD(p.start) + ' — ' + fmtD(p.end) +
            (p.pausable ? ' <span class="membership-pausable">Pausable</span>' : '') + '</div>';
        });
        html += '</div>';
      }

      // Plan price
      var price = Number(sub.plan?.price || 0);
      if (price > 0) {
        html += '<div class="membership-price">£' + (price / 100).toFixed(2) + '/month</div>';
      }

      html += '</div>';
    } else if (user) {
      // No recurring plan — pay-as-you-go with top-up credits. Surface the
      // balance and per-pack expiries here too, not just the small bar in
      // My Bookings (previously this tab showed nothing but the account).
      var stats = user.stats || {};
      var packs = user.available_credits || [];
      var totalCredits = Number(stats.credits_remaining) || packs.reduce(function (sum, c) {
        return sum + (Number(c.remaining != null ? c.remaining : c.credits_remaining) || 0);
      }, 0);

      html += '<div class="membership-card">';
      html += '<div class="membership-plan">Credit Pack</div>';
      html += '<div class="membership-status">Pay as you go</div>';
      if (totalCredits > 0) {
        html += '<div class="membership-usage">' + totalCredits + ' credit' + (totalCredits !== 1 ? 's' : '') + ' remaining</div>';
      } else {
        html += '<div class="membership-usage">No credits remaining — top up on psyclelondon.com to book</div>';
      }
      // Per-pack breakdown with expiry when the API provides it (fields are
      // read defensively — pack shapes vary).
      var packRows = packs.map(function (c) {
        var left = Number(c.remaining != null ? c.remaining : c.credits_remaining) || 0;
        if (left <= 0) return '';
        var name = c.name || c.title || c.plan_name || 'Credits';
        var expiry = c.expires_at || c.expiry || c.valid_until || '';
        var expiryLabel = '';
        if (expiry) {
          var d = new Date(String(expiry).replace(' ', 'T'));
          if (!isNaN(d.getTime())) {
            expiryLabel = ' · expires ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          }
        }
        return '<div class="membership-period-item">' + escapeHTML(name) + ': ' + left +
          ' credit' + (left !== 1 ? 's' : '') + expiryLabel + '</div>';
      }).filter(Boolean);
      if (packRows.length > 0) {
        html += '<div class="membership-upcoming-title">Your packs</div>';
        html += '<div class="membership-periods">' + packRows.join('') + '</div>';
      }
      html += '</div>';
    }

    // Account card (avatar + name + email), rendered above the plan/usage card.
    var acctHTML = '';
    if (user) {
      var _fn = ((user.first_name || '') + ' ' + (user.last_name || '')).trim() || 'You';
      var _ini = ((user.first_name || user.email || '?').trim().charAt(0) + (user.last_name ? user.last_name.trim().charAt(0) : '')).toUpperCase();
      acctHTML = '<div class="ms-account">' +
        '<div class="ms-account-avatar">' + escapeHTML(_ini) + '</div>' +
        '<div class="ms-account-info">' +
          '<div class="ms-account-name">' + escapeHTML(_fn) + '</div>' +
          (user.email ? '<div class="ms-account-email">' + escapeHTML(user.email) + '</div>' : '') +
        '</div>' +
      '</div>';
    }

    container.innerHTML = acctHTML + html;
  }

  // ── Cost Per Class Tracker ─────────────────────────────────────

  function renderCostTracker() {
    var container = document.getElementById('costSection');
    if (!container) return;

    var sub = (typeof _activeSubscription !== 'undefined') ? _activeSubscription : null;
    if (!sub || !sub.max_bookings) { container.style.display = 'none'; return; }
    container.style.display = '';

    var price = Number(sub.plan?.price || sub.price || 0); // price is in pence
    var made = Number(sub.bookings_made) || 0;
    var max = Number(sub.max_bookings) || 30;
    var priceGbp = price / 100;
    var costPerClass = made > 0 ? priceGbp / made : priceGbp;
    var costAtMax = priceGbp / max;
    var remaining = Math.max(0, max - made);
    var daysLeft = _daysLeftInBillingPeriod(sub);

    // Savings message
    var savingsMsg = '';
    if (made > 0 && made < max) {
      savingsMsg = 'Book ' + remaining + ' more to hit ' + _formatGbp(costAtMax) + '/class';
    } else if (made >= max) {
      savingsMsg = 'You\'ve maxed out your ' + max + ' classes — incredible!';
    }

    var html = '<div class="cost-title">Cost tracker</div>';
    html += '<div class="cost-cards">';

    // Cost per class card
    html += '<div class="cost-card cost-main">';
    html += '<div class="cost-value">' + _formatGbp(costPerClass) + '</div>';
    html += '<div class="cost-label">Per class this month</div>';
    if (made === 0) html += '<div class="cost-hint">Book your first class!</div>';
    html += '</div>';

    // Monthly spend card
    html += '<div class="cost-card">';
    html += '<div class="cost-value">' + _formatGbp(priceGbp) + '</div>';
    html += '<div class="cost-label">Monthly plan</div>';
    html += '<div class="cost-hint">' + escapeHTML(sub.name || 'Unlimited') + '</div>';
    html += '</div>';

    // Target card
    html += '<div class="cost-card">';
    html += '<div class="cost-value">' + _formatGbp(costAtMax) + '</div>';
    html += '<div class="cost-label">Best possible</div>';
    html += '<div class="cost-hint">If you use all ' + max + ' classes</div>';
    html += '</div>';

    // Pace card
    if (daysLeft > 0 && remaining > 0) {
      var perWeek = Math.ceil(remaining / (daysLeft / 7));
      html += '<div class="cost-card">';
      html += '<div class="cost-value">' + perWeek + '</div>';
      html += '<div class="cost-label">Per week needed</div>';
      html += '<div class="cost-hint">' + remaining + ' classes in ' + daysLeft + ' days</div>';
      html += '</div>';
    }

    html += '</div>';

    // Savings message
    if (savingsMsg) {
      html += '<div class="cost-savings">' + savingsMsg + '</div>';
    }

    // ── Spend-vs-usage forecast (Feature 2) ──
    // Project end-of-period bookings from current pace, then the £/class
    // you're trending toward. Uses real period dates when present; falls
    // back to the calendar-month estimate otherwise.
    html += _forecastHtml(sub, made, max, priceGbp, costAtMax);

    container.innerHTML = html;
  }

  // Returns the forecast block HTML (or '' if there isn't enough to forecast).
  function _forecastHtml(sub, made, max, priceGbp, costAtMax) {
    if (priceGbp <= 0) return '';

    // Period window from real dates if available. Note: the API's
    // period_end is the START of the next period, so it's the right
    // exclusive upper bound for "days in this period".
    var now = new Date();
    var start = sub.period_start ? new Date(String(sub.period_start).replace(' ', 'T')) : null;
    var end = sub.period_end ? new Date(String(sub.period_end).replace(' ', 'T')) : null;

    var totalDays, daysElapsed, daysLeft;
    if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
      var DAY = 86400000;
      totalDays = Math.max(1, Math.round((end - start) / DAY));
      daysElapsed = Math.min(totalDays, Math.max(0, Math.round((now - start) / DAY)));
      daysLeft = Math.max(0, totalDays - daysElapsed);
    } else {
      // Fallback: calendar month.
      var som = new Date(now.getFullYear(), now.getMonth(), 1);
      var eom = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      totalDays = eom.getDate();
      daysElapsed = Math.min(totalDays, now.getDate());
      daysLeft = Math.max(0, totalDays - daysElapsed);
    }

    // Need at least a day of usage to project anything meaningful.
    if (daysElapsed < 1 || made < 1) return '';

    var pacePerDay = made / daysElapsed;
    var projected = Math.round(pacePerDay * totalDays);
    if (max > 0) projected = Math.min(projected, max);
    projected = Math.max(projected, made); // never below what's already booked
    var projectedCost = projected > 0 ? priceGbp / projected : priceGbp;

    // One-line verdict.
    var verdict;
    if (max > 0 && projected >= max) {
      verdict = 'On pace to use all ' + max + ' classes — top value at ' + _formatGbp(costAtMax) + '/class';
    } else {
      var TARGET = 10; // "good value" threshold, £/class
      if (projectedCost <= TARGET) {
        verdict = 'On pace for ' + _formatGbp(projectedCost) + '/class — great value';
      } else {
        // How many more to drop under the target?
        var needed = Math.ceil(priceGbp / TARGET) - made;
        if (max > 0) needed = Math.min(needed, max - made);
        if (needed > 0) {
          verdict = 'Book ' + needed + ' more to beat ' + _formatGbp(TARGET) + '/class';
        } else {
          verdict = 'On pace for ' + _formatGbp(projectedCost) + '/class';
        }
      }
    }

    var html = '<div class="forecast-block">';
    html += '<div class="forecast-head">';
    html += '<div class="forecast-stat"><span class="forecast-num">' + projected + '</span><span class="forecast-cap">projected classes</span></div>';
    html += '<div class="forecast-stat"><span class="forecast-num">' + _formatGbp(projectedCost) + '</span><span class="forecast-cap">projected per class</span></div>';
    html += '</div>';
    html += '<div class="forecast-meta">' + made + ' booked · day ' + daysElapsed + ' of ' + totalDays + ' · ' + daysLeft + ' days left</div>';
    html += '<div class="forecast-verdict">' + escapeHTML(verdict) + '</div>';
    html += '</div>';
    return html;
  }

  // ── Theme picker (Membership → App) ───────────────────────────

  function renderThemePicker() {
    var box = document.getElementById('themePicker');
    if (!box || !window.APP_THEMES) return;
    var current = (typeof getAppTheme === 'function') ? getAppTheme() : 'dark';
    box.innerHTML =
      '<div class="theme-chips">' +
      window.APP_THEMES.map(function (t) {
        return '<button class="theme-chip' + (t.id === current ? ' active' : '') + '" onclick="window._pickTheme(\'' + t.id + '\')">' +
          '<span class="theme-swatch"><i style="background:' + t.accent + '"></i><i style="background:' + t.bg + '"></i></span>' +
          '<span class="theme-chip-name">' + t.name + '</span>' +
        '</button>';
      }).join('') +
      '</div>';
  }

  window._pickTheme = function (id) {
    if (typeof setAppTheme === 'function') setAppTheme(id);
    renderThemePicker();
  };
  // The picker + reminder row render inside the Settings panel, which
  // settings.js builds — expose so it can trigger them after opening.
  window.renderThemePicker = renderThemePicker;
  window.renderReminderRow = renderReminderRow;

  // ── Weekly reminder row (iOS app only — needs the native bridge) ──

  function renderReminderRow() {
    var row = document.getElementById('reminderRow');
    if (!row) return;
    if (!window._nativeReminder) { row.innerHTML = ''; return; }
    var on = window._nativeReminder.isOn();
    var html =
      '<button class="app-row" onclick="window._toggleReminder()">' +
        '<span class="app-row-text"><span class="app-row-label">Monday booking reminder</span>' +
        '<span class="app-row-detail">11:59 UK — when the new booking week opens</span></span>' +
        '<span class="app-row-switch' + (on ? ' on' : '') + '" aria-hidden="true"></span>' +
      '</button>';
    if (window._nativeClassReminders) {
      var cOn = window._nativeClassReminders.isOn();
      html +=
        '<button class="app-row" onclick="window._toggleClassReminders()">' +
          '<span class="app-row-text"><span class="app-row-label">Class reminders</span>' +
          '<span class="app-row-detail">90 minutes before each class — opens the live countdown</span></span>' +
          '<span class="app-row-switch' + (cOn ? ' on' : '') + '" aria-hidden="true"></span>' +
        '</button>';
    }
    row.innerHTML = html;
  }

  window._toggleClassReminders = async function () {
    if (!window._nativeClassReminders) return;
    if (window._nativeClassReminders.isOn()) {
      // The pref defaults ON but scheduling needs notification permission.
      // An ON-looking toggle that never armed should PROMPT on tap, not
      // silently flip to off (the opposite of what the user wants).
      var hasPerm = window._nativeClassReminders.hasPermission
        ? await window._nativeClassReminders.hasPermission() : true;
      if (!hasPerm) {
        var granted = await window._nativeClassReminders.enable();
        toast(granted ? 'Class reminders on — 90 minutes before each class' : 'Enable notifications for Psync in iOS Settings first', granted ? 'success' : 'error');
      } else {
        await window._nativeClassReminders.disable();
        toast('Class reminders off', 'info');
      }
    } else {
      var ok = await window._nativeClassReminders.enable();
      toast(ok ? 'Class reminders on — 90 minutes before each class' : 'Enable notifications for Psync in iOS Settings first', ok ? 'success' : 'error');
    }
    renderReminderRow();
  };

  window._toggleReminder = async function () {
    if (!window._nativeReminder) return;
    if (window._nativeReminder.isOn()) {
      await window._nativeReminder.disable();
      toast('Weekly reminder off', 'info');
    } else {
      var ok = await window._nativeReminder.enable();
      toast(ok ? 'Reminder set — Mondays at 11:59' : 'Enable notifications for Psycle in iOS Settings first', ok ? 'success' : 'error');
    }
    renderReminderRow();
  };

  function _formatGbp(amount) {
    return '£' + amount.toFixed(2);
  }

  function _daysLeftInBillingPeriod(sub) {
    var now = new Date();
    // Use the subscription's REAL billing period when available (same
    // normalization as _forecastHtml) — plans rarely renew on the 1st, and
    // pacing against the calendar month gave wildly wrong "per week needed".
    if (sub && sub.period_end) {
      var end = new Date(String(sub.period_end).replace(' ', 'T'));
      if (!isNaN(end.getTime()) && end > now) {
        return Math.max(0, Math.round((end - now) / 86400000));
      }
    }
    // Fallback: days left in current calendar month
    var endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return Math.max(0, endOfMonth.getDate() - now.getDate());
  }


  // ── Class Type Distribution ─────────────────────────────────────

  function renderClassTypeDistribution() {
    var container = document.getElementById('classTypeSection');
    if (!container) return;

    var history = getFullHistory();
    if (history.length === 0) { container.style.display = 'none'; return; }

    // Count by category
    var catCounts = {};
    var total = 0;
    history.forEach(function (h) {
      if (h.cancelledAt) return;
      var cat = (typeof getCategory === 'function') ? getCategory(h.typeName) : null;
      var key = cat ? cat.key : 'OTHER';
      catCounts[key] = (catCounts[key] || 0) + 1;
      total++;
    });

    if (total === 0) { container.style.display = 'none'; return; }
    container.style.display = '';

    // Sort by count descending
    var cats = (typeof CATEGORY_MAP !== 'undefined') ? CATEGORY_MAP : [];
    var sorted = cats
      .map(function (c) { return { key: c.key, label: c.label, color: c.color, count: catCounts[c.key] || 0 }; })
      .filter(function (c) { return c.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });

    var maxCount = sorted.length > 0 ? sorted[0].count : 1;

    var html = '<div class="insights-title">Class types</div>';
    html += '<div class="class-type-bars">';
    for (var i = 0; i < sorted.length; i++) {
      var c = sorted[i];
      var pct = Math.round(c.count / total * 100);
      var barW = Math.max(4, Math.round(c.count / maxCount * 100));
      html += '<div class="ct-row">' +
        '<span class="ct-label">' + c.label + '</span>' +
        '<div class="ct-bar-wrap">' +
          '<div class="ct-bar" style="width:' + barW + '%;background:' + c.color + '"></div>' +
        '</div>' +
        '<span class="ct-count">' + c.count + '</span>' +
        '<span class="ct-pct">' + pct + '%</span>' +
      '</div>';
    }

    // Show gaps — class types with 0 bookings
    var gaps = cats
      .filter(function (c) { return c.key !== 'OTHER' && !catCounts[c.key]; })
      .map(function (c) { return c.label; });
    if (gaps.length > 0) {
      html += '<div class="ct-gaps">Never tried: ' + gaps.join(', ') + '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  // ── Lapsed Favourites ──────────────────────────────────────────

  function renderLapsedFavourites() {
    var container = document.getElementById('lapsedSection');
    if (!container) return;

    var history = getFullHistory();
    if (history.length < 5) { container.style.display = 'none'; return; }

    var now = new Date();
    var LAPSE_DAYS = 60;
    var MIN_BOOKINGS = 3;

    // Build per-instructor stats from history
    var instrStats = {}; // name -> { count, lastDate }
    history.forEach(function (h) {
      if (h.cancelledAt || !h.instrName) return;
      var name = h.instrName;
      if (!instrStats[name]) instrStats[name] = { count: 0, lastDate: null, instrId: h.instrId || '' };
      instrStats[name].count++;
      if (!instrStats[name].lastDate || h.date > instrStats[name].lastDate) {
        instrStats[name].lastDate = h.date;
      }
    });

    // Find lapsed: booked MIN_BOOKINGS+ times, last booking > LAPSE_DAYS ago
    var cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - LAPSE_DAYS);
    var lapsed = Object.entries(instrStats)
      .filter(function (e) {
        return e[1].count >= MIN_BOOKINGS && new Date(e[1].lastDate) < cutoff;
      })
      .sort(function (a, b) { return b[1].count - a[1].count; })
      .slice(0, 6);

    if (lapsed.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';

    var html = '<div class="insights-title">Lapsed favourites</div>';
    html += '<div class="insights-subtitle">Instructors you used to book regularly</div>';
    html += '<div class="lapsed-list">';
    for (var i = 0; i < lapsed.length; i++) {
      var name = lapsed[i][0];
      var stat = lapsed[i][1];
      var lastDt = new Date(stat.lastDate);
      var daysAgo = Math.round((now - lastDt) / 86400000);
      var lastStr = lastDt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      var tierBadge = stat.instrId && (typeof tierBadgeHTML === 'function') ? tierBadgeHTML(stat.instrId) : '';

      html += '<div class="lapsed-item">' +
        '<div class="lapsed-name">' + instrLink(name, stat.instrId) + ' ' + tierBadge + '</div>' +
        '<div class="lapsed-detail">' + stat.count + ' classes · Last booked ' + lastStr + ' (' + daysAgo + 'd ago)</div>' +
      '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
  }

  // ── Instructor Variety Trend ───────────────────────────────────

  function renderVarietyTrend() {
    var container = document.getElementById('varietySection');
    if (!container) return;

    var history = getFullHistory();
    if (history.length < 5) { container.style.display = 'none'; return; }

    // Group by month, count unique instructors and total classes
    var months = {}; // "2025-03" -> { instructors: Set, total: number }
    history.forEach(function (h) {
      if (h.cancelledAt || !h.date) return;
      var key = h.date.substring(0, 7); // "YYYY-MM"
      if (!months[key]) months[key] = { instructors: new Set(), total: 0 };
      months[key].total++;
      if (h.instrName) months[key].instructors.add(h.instrName);
    });

    var sorted = Object.entries(months).sort(function (a, b) { return a[0].localeCompare(b[0]); });
    // Show last 12 months max
    if (sorted.length > 12) sorted = sorted.slice(sorted.length - 12);
    if (sorted.length < 2) { container.style.display = 'none'; return; }

    var maxInstr = Math.max.apply(null, sorted.map(function (e) { return e[1].instructors.size; }));
    var maxTotal = Math.max.apply(null, sorted.map(function (e) { return e[1].total; }));

    container.style.display = '';
    var html = '<div class="insights-title">Instructor variety</div>';
    html += '<div class="insights-subtitle">Unique instructors per month</div>';
    html += '<div class="variety-chart">';
    for (var i = 0; i < sorted.length; i++) {
      var key = sorted[i][0];
      var data = sorted[i][1];
      var instrH = Math.max(4, Math.round(data.instructors.size / maxInstr * 80));
      var label = key.substring(5); // "03" from "2025-03"
      var monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var monthLabel = monthNames[parseInt(label)] || label;

      html += '<div class="variety-col" title="' + monthLabel + ': ' + data.instructors.size + ' instructors, ' + data.total + ' classes">' +
        '<div class="variety-bar-area">' +
          '<span class="variety-value">' + data.instructors.size + '</span>' +
          '<div class="variety-bar" style="height:' + instrH + 'px"></div>' +
        '</div>' +
        '<div class="variety-label">' + monthLabel + '</div>' +
      '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
  }


  // ── Year in Review (Feature 4) ─────────────────────────────────
  // Entry-point button in Stats → modal summarising the year, with a
  // shareable canvas image (same share/download path as shareInsights).

  // Aggregate this year's attended history into a tidy summary object.
  function _computeYearReview(year) {
    var history = getFullHistory().filter(function (h) {
      return !h.cancelledAt && h.date && String(h.date).substring(0, 4) === String(year);
    });
    if (history.length === 0) return null;

    var instrCount = {}, studioCount = {}, dowCount = {}, hourCount = {};
    var weeks = {};
    history.forEach(function (h) {
      if (h.instrName) instrCount[h.instrName] = (instrCount[h.instrName] || 0) + 1;
      if (h.locName) studioCount[h.locName] = (studioCount[h.locName] || 0) + 1;
      var dt = new Date(String(h.date).replace(' ', 'T'));
      if (isNaN(dt.getTime())) return;
      dowCount[dt.getDay()] = (dowCount[dt.getDay()] || 0) + 1;
      hourCount[dt.getHours()] = (hourCount[dt.getHours()] || 0) + 1;
      weeks[_weekIndex(dt)] = true;
    });

    // Longest weekly streak within the year.
    var weekKeys = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; });
    var longest = 0, run = 0, prev = null;
    weekKeys.forEach(function (w) {
      if (prev === null || w === prev + 1) run++; else run = 1;
      if (run > longest) longest = run;
      prev = w;
    });

    var topInstr = Object.entries(instrCount).sort(function (a, b) { return b[1] - a[1]; })[0];
    var topStudio = Object.entries(studioCount).sort(function (a, b) { return b[1] - a[1]; })[0];
    var topDow = Object.entries(dowCount).sort(function (a, b) { return b[1] - a[1]; })[0];
    var topHour = Object.entries(hourCount).sort(function (a, b) { return b[1] - a[1]; })[0];

    var favTime = '';
    if (topHour) {
      var hr = Number(topHour[0]);
      favTime = (hr % 12 || 12) + (hr >= 12 ? 'pm' : 'am');
    }

    return {
      year: year,
      total: history.length,
      uniqueInstrs: Object.keys(instrCount).length,
      topInstr: topInstr ? topInstr[0] : '',
      topInstrCount: topInstr ? topInstr[1] : 0,
      topStudio: topStudio ? topStudio[0] : '',
      topStudioCount: topStudio ? topStudio[1] : 0,
      favDay: topDow ? DAY_NAMES_FULL[Number(topDow[0])] : '',
      favTime: favTime,
      longestStreak: longest,
    };
  }

  function renderYearReview() {
    var container = document.getElementById('yearReviewSection');
    if (!container) return;
    var year = new Date().getFullYear();
    var summary = _computeYearReview(year);
    if (!summary) { container.style.display = 'none'; return; }
    container.style.display = '';
    container.innerHTML =
      '<div class="insights-title">' + year + ' in review</div>' +
      '<button class="year-review-btn" onclick="openYearReview()">' +
        '<span class="year-review-btn-main">See your ' + year + ' wrap</span>' +
        '<span class="year-review-btn-sub">' + summary.total + ' classes · ' + summary.uniqueInstrs + ' instructors</span>' +
      '</button>';
  }

  window.openYearReview = function () {
    document.getElementById('yearReviewOverlay')?.remove();
    var year = new Date().getFullYear();
    var s = _computeYearReview(year);
    if (!s) { toast('No classes this year yet', 'info'); return; }

    var overlay = document.createElement('div');
    overlay.id = 'yearReviewOverlay';
    overlay.className = 'year-review-modal';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

    var rows = [
      { label: 'Classes', value: String(s.total) },
      { label: 'Instructors met', value: String(s.uniqueInstrs) },
      { label: 'Longest streak', value: s.longestStreak + ' week' + (s.longestStreak === 1 ? '' : 's') },
    ];
    if (s.topInstr) rows.push({ label: 'Top instructor', value: s.topInstr + ' (' + s.topInstrCount + ')' });
    if (s.topStudio) rows.push({ label: 'Top studio', value: s.topStudio + ' (' + s.topStudioCount + ')' });
    if (s.favDay) rows.push({ label: 'Favourite day', value: s.favDay });
    if (s.favTime) rows.push({ label: 'Favourite time', value: s.favTime });

    var rowsHtml = rows.map(function (r) {
      return '<div class="yr-row">' +
        '<span class="yr-row-label">' + escapeHTML(r.label) + '</span>' +
        '<span class="yr-row-value">' + escapeHTML(r.value) + '</span>' +
      '</div>';
    }).join('');

    overlay.innerHTML =
      '<div class="modal">' +
        '<div class="modal-header">' +
          '<div>' +
            '<div class="modal-title">' + year + ' in review</div>' +
            '<div class="modal-subtitle">Your year on the bike</div>' +
          '</div>' +
          '<button class="modal-close" onclick="document.getElementById(\'yearReviewOverlay\').remove()">&times;</button>' +
        '</div>' +
        '<div class="yr-rows">' + rowsHtml + '</div>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="share-insights-btn" onclick="shareYearReview()">Share my ' + year + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
  };

  window.shareYearReview = async function () {
    var year = new Date().getFullYear();
    var s = _computeYearReview(year);
    if (!s) { toast('No classes this year yet', 'info'); return; }

    var W = 640, H = 820;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    var y = 56;

    // Header
    ctx.fillStyle = '#e94560';
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('P S Y C L E', 32, y);
    ctx.fillStyle = '#555';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('YEAR IN REVIEW', 130, y);
    y += 12;
    ctx.strokeStyle = '#222';
    ctx.beginPath(); ctx.moveTo(32, y); ctx.lineTo(W - 32, y); ctx.stroke();
    y += 60;

    // Big year
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 64px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(String(year), 32, y);
    y += 28;
    ctx.fillStyle = '#888';
    ctx.font = '15px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('A year on the bike', 32, y);
    y += 48;

    // Hero number
    ctx.fillStyle = '#e94560';
    ctx.font = 'bold 88px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(String(s.total), 32, y + 10);
    ctx.fillStyle = '#888';
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('CLASSES RIDDEN', 36, y + 36);
    y += 90;

    // Detail rows (canvas draws plain strings; no HTML escaping needed here)
    var rows = [
      ['Instructors met', String(s.uniqueInstrs)],
      ['Longest streak', s.longestStreak + ' week' + (s.longestStreak === 1 ? '' : 's')],
    ];
    if (s.topInstr) rows.push(['Top instructor', s.topInstr]);
    if (s.topStudio) rows.push(['Top studio', s.topStudio]);
    if (s.favDay) rows.push(['Favourite day', s.favDay]);
    if (s.favTime) rows.push(['Favourite time', s.favTime]);

    rows.forEach(function (r) {
      ctx.fillStyle = '#666';
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(String(r[0]).toUpperCase(), 32, y);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(r[1], 32, y + 26);
      y += 56;
    });

    // Footer
    y = H - 40;
    ctx.strokeStyle = '#222';
    ctx.beginPath(); ctx.moveTo(32, y - 16); ctx.lineTo(W - 32, y - 16); ctx.stroke();
    ctx.fillStyle = '#444';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('Generated by Psycle Companion · ' + year + ' wrap', 32, y);

    try {
      var blob = await new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('toBlob returned null')); }, 'image/png');
      });
      var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || !!window.Capacitor;
      if (isMobile && navigator.share) {
        try {
          var file = new File([blob], 'psycle-' + year + '-wrap.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: 'My ' + year + ' on Psycle',
              text: s.total + ' classes · ' + s.uniqueInstrs + ' instructors',
              files: [file],
            });
            return;
          }
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') return;
        }
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'psycle-' + year + '-wrap.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Image saved — share it from your downloads', 'success');
    } catch (e) {
      console.error('[year-review] share failed:', e);
      toast('Share failed: ' + e.message, 'error');
    }
  };


  // ── Share Insights Card ─────────────────────────────────────────

  // roundRect polyfill for older browsers/WebKit
  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      if (typeof r === 'number') r = [r, r, r, r];
      var tl = r[0] || 0;
      this.moveTo(x + tl, y);
      this.lineTo(x + w - tl, y);
      this.quadraticCurveTo(x + w, y, x + w, y + tl);
      this.lineTo(x + w, y + h - tl);
      this.quadraticCurveTo(x + w, y + h, x + w - tl, y + h);
      this.lineTo(x + tl, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - tl);
      this.lineTo(x, y + tl);
      this.quadraticCurveTo(x, y, x + tl, y);
      this.closePath();
      return this;
    };
  }

  window.shareInsights = async function () {
    var history = getFullHistory().filter(function (h) { return !h.cancelledAt; });
    if (history.length === 0) { toast('No history to share yet', 'info'); return; }

    var now = new Date();
    var userName = '';
    if (typeof currentUser !== 'undefined' && currentUser) {
      userName = currentUser.first_name || currentUser.email || '';
    }

    // Gather stats
    var totalClasses = history.length;
    var soloCount = 0, socialCount = 0;
    var instrCount = {}, studioCount = {}, catCount = {};
    var firstDate = history[history.length - 1]?.date;
    var cats = (typeof CATEGORY_MAP !== 'undefined') ? CATEGORY_MAP : [];

    history.forEach(function (h) {
      if (h.slots && h.slots.length > 1) socialCount++; else soloCount++;
      if (h.instrName) instrCount[h.instrName] = (instrCount[h.instrName] || 0) + 1;
      if (h.locName) studioCount[h.locName] = (studioCount[h.locName] || 0) + 1;
      var cat = (typeof getCategory === 'function') ? getCategory(h.typeName) : null;
      var key = cat ? cat.key : 'OTHER';
      catCount[key] = (catCount[key] || 0) + 1;
    });

    var topInstr = Object.entries(instrCount).sort(function (a, b) { return b[1] - a[1]; })[0];
    var topStudio = Object.entries(studioCount).sort(function (a, b) { return b[1] - a[1]; })[0];
    var catSorted = cats
      .map(function (c) { return { key: c.key, label: c.label, color: c.color, count: catCount[c.key] || 0 }; })
      .filter(function (c) { return c.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });
    var catMax = catSorted.length > 0 ? catSorted[0].count : 1;

    // Unique instructors
    var uniqueInstrs = Object.keys(instrCount).length;

    // Render to canvas
    var W = 640, H = 820;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    // Subtle border
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    var y = 40;

    // Header
    ctx.fillStyle = '#e94560';
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('P S Y C L E', 32, y);
    ctx.fillStyle = '#555';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('CLASS FINDER', 130, y);
    y += 12;

    // Divider
    ctx.strokeStyle = '#222';
    ctx.beginPath(); ctx.moveTo(32, y); ctx.lineTo(W - 32, y); ctx.stroke();
    y += 28;

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(userName ? userName + "'s Stats" : 'My Psycle Stats', 32, y);
    y += 14;

    // Date range
    if (firstDate) {
      ctx.fillStyle = '#666';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      var fd = new Date(firstDate);
      ctx.fillText(
        fd.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) + ' — ' +
        now.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
        32, y
      );
    }
    y += 32;

    // Big stat cards
    var cardW = 130, cardH = 72, cardGap = 12, cardX = 32;
    var statCards = [
      { value: String(totalClasses), label: 'CLASSES' },
      { value: String(uniqueInstrs), label: 'INSTRUCTORS' },
      { value: String(soloCount), label: 'SOLO' },
    ];
    if (socialCount > 0) statCards.push({ value: String(socialCount), label: 'WITH A FRIEND' });

    statCards.forEach(function (card, i) {
      var cx = cardX + i * (cardW + cardGap);
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.roundRect(cx, y, cardW, cardH, 8);
      ctx.fill();
      ctx.strokeStyle = '#222';
      ctx.beginPath();
      ctx.roundRect(cx, y, cardW, cardH, 8);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(card.value, cx + 14, y + 34);
      ctx.fillStyle = '#666';
      ctx.font = '600 9px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(card.label, cx + 14, y + 52);
    });
    y += cardH + 28;

    // Top instructor & studio
    if (topInstr) {
      ctx.fillStyle = '#888';
      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('TOP INSTRUCTOR', 32, y);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(topInstr[0], 32, y + 22);
      ctx.fillStyle = '#888';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(topInstr[1] + ' classes', 32, y + 40);
    }
    if (topStudio) {
      ctx.fillStyle = '#888';
      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('TOP STUDIO', W / 2, y);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(topStudio[0], W / 2, y + 22);
      ctx.fillStyle = '#888';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(topStudio[1] + ' classes', W / 2, y + 40);
    }
    y += 64;

    // Class type bars
    ctx.fillStyle = '#888';
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('CLASS TYPES', 32, y);
    y += 14;

    catSorted.slice(0, 6).forEach(function (cat) {
      var barMaxW = W - 200;
      var barW = Math.max(6, Math.round(cat.count / catMax * barMaxW));

      ctx.fillStyle = '#666';
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(cat.label, 100, y + 14);
      ctx.textAlign = 'left';

      ctx.fillStyle = '#0d0d0d';
      ctx.beginPath(); ctx.roundRect(112, y + 2, barMaxW, 16, 3); ctx.fill();
      ctx.fillStyle = cat.color;
      ctx.beginPath(); ctx.roundRect(112, y + 2, barW, 16, 3); ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(String(cat.count), 112 + barMaxW + 8, y + 14);

      y += 24;
    });
    y += 16;

    // Footer
    ctx.strokeStyle = '#222';
    ctx.beginPath(); ctx.moveTo(32, y); ctx.lineTo(W - 32, y); ctx.stroke();
    y += 20;
    ctx.fillStyle = '#444';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('Generated by Psycle Class Finder · ' + now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), 32, y);

    // Export and share
    try {
      var blob = await new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) {
          if (b) resolve(b); else reject(new Error('toBlob returned null'));
        }, 'image/png');
      });

      // Try native share (mobile/Capacitor only — desktop share is unreliable)
      var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || !!window.Capacitor;
      if (isMobile && navigator.share) {
        try {
          var file = new File([blob], 'psycle-stats.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: 'My Psycle Stats',
              text: totalClasses + ' classes · ' + uniqueInstrs + ' instructors · Top: ' + (topInstr ? topInstr[0] : ''),
              files: [file],
            });
            return;
          }
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') return; // user cancelled
          // Fall through to download
        }
      }

      // Fallback: download
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'psycle-stats.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Image saved — share it from your downloads', 'success');
    } catch (e) {
      console.error('[share] failed:', e);
      toast('Share failed: ' + e.message, 'error');
    }
  };


  // ── Init ───────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabs);
  } else {
    // Delay slightly to let app.js render the initial DOM
    setTimeout(initTabs, 50);
  }

})();
