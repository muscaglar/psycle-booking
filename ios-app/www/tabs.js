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
 *   switchTab, renderInsights, weekNav, shareInsights, planDay
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

    // Weekly planner at top
    var discoverWeekView = document.createElement('div');
    discoverWeekView.id = 'weekView';
    discoverWeekView.className = 'week-view';
    discoverWeekView.style.display = 'none';
    discoverPanel.appendChild(discoverWeekView);

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
      '<div id="lapsedSection" class="insights-section" style="display:none"></div>' +
      // Patterns
      '<div id="recoSection" class="reco-section" style="display:none"></div>' +
      '<div id="classTypeSection" class="insights-section" style="display:none"></div>' +
      // Deep analytics
      '<div id="exploreMapSection" class="explore-section" style="display:none"></div>' +
      '<div id="varietySection" class="insights-section" style="display:none"></div>' +
      '<div id="heatmapSection" class="heatmap-section" style="display:none"></div>' +
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
      '<div id="membershipInfo" class="insights-section" style="display:none"></div>' +
      '<div id="costSection" class="cost-section" style="display:none"></div>' +
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
      '<div class="insights-section app-section">' +
        '<button class="app-row" onclick="openSettings()">' +
          '<span class="app-row-text"><span class="app-row-label">Settings</span>' +
          '<span class="app-row-detail">Theme · bike preferences · reminders · data</span></span>' +
          '<span class="app-row-chevron">›</span>' +
        '</button>' +
      '</div>' +
      '<div class="about-block">' +
        '<div class="about-mark">Psycle Companion</div>' +
        '<div class="about-text">An independent companion app for Psycle London members.<br>Not affiliated with, or endorsed by, Psycle.</div>' +
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
    renderCostTracker();
    renderClassTypeDistribution();
    renderHeatmap();
    renderWeekView();
    renderRecommendations();
    renderLapsedFavourites();
    renderVarietyTrend();
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

    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(monday);
      d.setDate(d.getDate() + i);
      days.push(d);
    }

    var weekLabel = days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
      ' — ' + days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    var html = '<div class="week-header">' +
      '<span class="week-title">' + weekLabel + '</span>' +
      '<div class="week-nav">' +
        '<button onclick="weekNav(-1)">‹</button>' +
        '<button onclick="weekNav(0)">Today</button>' +
        '<button onclick="weekNav(1)">›</button>' +
      '</div>' +
    '</div>';

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

    // Merge current bookings + history for a richer picture
    var allEvents = [];
    Object.entries(bookings).forEach(function (entry) {
      var evt = cache[entry[0]];
      if (evt) allEvents.push(evt);
    });
    history.forEach(function (h) {
      if (h.date) allEvents.push({ start_at: h.date });
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

    var html = '<div class="insights-title">Your Membership</div>';

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
    }

    // User info
    if (user) {
      html += '<div class="membership-account">';
      html += '<div class="membership-detail">' + escapeHTML((user.first_name || '') + ' ' + (user.last_name || '')) + '</div>';
      html += '<div class="membership-detail" style="color:var(--text-ghost)">' + escapeHTML(user.email || '') + '</div>';
      if (user.booking_cutoff) {
        html += '<div class="membership-detail" style="margin-top:8px">Can book until: ' + new Date(user.booking_cutoff).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + '</div>';
      }
      html += '</div>';
    }

    container.innerHTML = html;
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
    var daysLeft = _daysLeftInBillingPeriod();

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

    container.innerHTML = html;
  }

  // ── Theme picker (Membership → App) ───────────────────────────

  function renderThemePicker() {
    var box = document.getElementById('themePicker');
    if (!box || !window.APP_THEMES) return;
    var current = (typeof getAppTheme === 'function') ? getAppTheme() : 'dark';
    box.innerHTML =
      '<div class="theme-picker-label">Theme</div>' +
      '<div class="theme-chips">' +
      window.APP_THEMES.map(function (t) {
        return '<button class="theme-chip' + (t.id === current ? ' active' : '') + '" onclick="window._pickTheme(\'' + t.id + '\')">' +
          '<span class="theme-swatch" style="background:' + t.bg + '"><i style="background:' + t.accent + '"></i></span>' +
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
    row.innerHTML =
      '<button class="app-row" onclick="window._toggleReminder()">' +
        '<span class="app-row-text"><span class="app-row-label">Monday booking reminder</span>' +
        '<span class="app-row-detail">11:59 UK — when the new booking week opens</span></span>' +
        '<span class="app-row-switch' + (on ? ' on' : '') + '" aria-hidden="true"></span>' +
      '</button>';
  }

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

  function _daysLeftInBillingPeriod() {
    // Approximate: days left in current calendar month
    var now = new Date();
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
