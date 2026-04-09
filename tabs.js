/* ═══════════════════════════════════════════════════════════════════
   Tabs Module — Discover / My Bookings tab navigation
   + Quick Stats, Weekly Calendar View, Recommendations, Studio Map
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Tab Navigation ──────────────────────────────────────────────

  var TABS = ['discover', 'bookings'];
  var _currentTab = 'discover';

  function initTabs() {
    var controls = document.querySelector('.controls');
    var upcomingPanel = document.getElementById('upcomingPanel');
    var results = document.getElementById('results');
    if (!controls || !results) return;

    // Create tab bar
    var tabBar = document.createElement('div');
    tabBar.className = 'tab-bar';
    tabBar.innerHTML =
      '<button class="tab-btn active" data-tab="discover" onclick="switchTab(\'discover\')">Discover</button>' +
      '<button class="tab-btn" data-tab="bookings" onclick="switchTab(\'bookings\')">' +
        'My Bookings <span class="tab-badge" id="tabBadge"></span>' +
      '</button>';

    // Insert tab bar after header
    var header = document.querySelector('header');
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(tabBar, header.nextSibling);
    }

    // Wrap controls + results in discover panel
    var discoverPanel = document.createElement('div');
    discoverPanel.id = 'tab-discover';
    discoverPanel.className = 'tab-panel active';

    // Move session banner, CORS banner inside discover too (they stay visible)
    controls.parentNode.insertBefore(discoverPanel, controls);
    discoverPanel.appendChild(controls);
    discoverPanel.appendChild(results);

    // Create bookings panel
    var bookingsPanel = document.createElement('div');
    bookingsPanel.id = 'tab-bookings';
    bookingsPanel.className = 'tab-panel';

    // Add stats bar placeholder
    bookingsPanel.innerHTML =
      '<div id="statsBar" class="stats-bar" style="display:none"></div>' +
      '<div id="weekView" class="week-view" style="display:none"></div>' +
      '<div id="recoSection" class="reco-section" style="display:none"></div>';

    // Move upcoming panel into bookings tab
    if (upcomingPanel) {
      discoverPanel.parentNode.insertBefore(bookingsPanel, discoverPanel.nextSibling);
      bookingsPanel.appendChild(upcomingPanel);
    }

    // Add studio map, heatmap, cost tracker
    bookingsPanel.innerHTML +=
      '<div id="studioMapSection" class="studio-map-section" style="display:none"></div>' +
      '<div id="heatmapSection" class="heatmap-section" style="display:none"></div>' +
      '<div id="costSection" class="cost-section" style="display:none"></div>';

    // Wrap both panels in tab-content
    var tabContent = document.createElement('div');
    tabContent.className = 'tab-content';
    tabBar.parentNode.insertBefore(tabContent, discoverPanel);
    tabContent.appendChild(discoverPanel);
    tabContent.appendChild(bookingsPanel);

    // Move banners before tab content (always visible)
    var sessionBanner = document.getElementById('sessionBanner');
    var corsBanner = document.getElementById('corsBanner');
    if (sessionBanner) tabContent.parentNode.insertBefore(sessionBanner, tabContent);
    if (corsBanner) tabContent.parentNode.insertBefore(corsBanner, tabContent);

    // Also move toast and modals out (they're global overlays)
    // They're already positioned fixed so they work regardless

    // Read hash
    var hash = location.hash.replace('#', '');
    if (TABS.indexOf(hash) !== -1) {
      switchTab(hash, true);
    }

    // Update badge
    updateTabBadge();
  }

  window.switchTab = function (tab, noHash) {
    _currentTab = tab;
    var btns = document.querySelectorAll('.tab-btn');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    var panels = document.querySelectorAll('.tab-panel');
    panels.forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + tab);
    });
    if (!noHash) {
      history.replaceState(null, '', '#' + tab);
    }
    if (tab === 'bookings') {
      renderBookingsExtras();
    }
  };

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

  // Update badge and extras on booking events (via PsycleEvents)
  if (typeof PsycleEvents !== 'undefined') {
    PsycleEvents.on('bookings:loaded', function () {
      updateTabBadge();
      if (_currentTab === 'bookings') renderBookingsExtras();
    });
    PsycleEvents.on('booking:complete', function () {
      updateTabBadge();
      setTimeout(function () { switchTab('bookings'); }, 800);
    });
    PsycleEvents.on('booking:cancelled', function () { updateTabBadge(); });
    PsycleEvents.on('seat:cancelled', function () { updateTabBadge(); });
  }

  // Also update when renderMyBookings is called directly
  var _origRender = window.renderMyBookings;
  var _patchRender = function () {
    if (!_origRender && typeof window.renderMyBookings === 'function') {
      _origRender = window.renderMyBookings;
      window.renderMyBookings = function () {
        _origRender.apply(this, arguments);
        updateTabBadge();
        if (_currentTab === 'bookings') renderBookingsExtras();
      };
    }
  };
  _patchRender();
  if (!_origRender) setTimeout(_patchRender, 200);

  // ── Render extras when bookings tab is active ──────────────────

  function renderBookingsExtras() {
    renderQuickStats();
    renderWeekView();
    renderRecommendations();
    renderStudioMap();
    renderHeatmap();
    renderCostTracker();
  }

  // ── Quick Stats ────────────────────────────────────────────────

  function renderQuickStats() {
    var container = document.getElementById('statsBar');
    if (!container) return;

    var now = new Date();
    var bookings = _myBookings || {};
    var cache = _eventCache || {};

    var upcoming = 0;
    var thisMonth = 0;
    var studioCount = {};
    var instrCount = {};

    Object.entries(bookings).forEach(function (entry) {
      var evtId = entry[0];
      var evt = cache[evtId];
      if (!evt) return;
      var dt = new Date(evt.start_at);
      if (dt > now) upcoming++;
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

    if (Object.keys(bookings).length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = '';
    container.innerHTML =
      '<div class="stat-card">' +
        '<div class="stat-value">' + upcoming + '</div>' +
        '<div class="stat-label">Upcoming</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-value">' + thisMonth + '</div>' +
        '<div class="stat-label">This month</div>' +
      '</div>' +
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
  }

  // ── Weekly Calendar View ───────────────────────────────────────

  var _weekOffset = 0;

  window.weekNav = function (dir) {
    _weekOffset += dir;
    renderWeekView();
  };

  function renderWeekView() {
    var container = document.getElementById('weekView');
    if (!container) return;

    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    if (Object.keys(bookings).length === 0) { container.style.display = 'none'; return; }
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

      // Find bookings on this day
      Object.entries(bookings).forEach(function (entry) {
        var evtId = entry[0];
        var booking = entry[1];
        var evt = cache[evtId];
        if (!evt) return;
        // Compare using the raw date portion from the API (local time, no TZ)
        var evtDay = (evt.start_at || '').split('T')[0].split(' ')[0];
        if (evtDay !== dayStr) return;

        // Parse as local time (API returns no TZ suffix)
        var dt = new Date(evt.start_at.replace(' ', 'T'));
        var h = dt.getHours();
        var m = dt.getMinutes().toString().padStart(2, '0');
        var ampm = h >= 12 ? 'pm' : 'am';
        var timeStr = (h % 12 || 12) + ':' + m + ampm;

        html += '<div class="week-event" onclick="switchTab(\'bookings\')" title="' +
          escapeHTML(evt._typeName || '') + ' · ' + escapeHTML(evt._instrName || '') + '">' +
          '<div class="week-event-time">' + timeStr + '</div>' +
          '<div class="week-event-name">' + escapeHTML(evt._typeName || 'Class') + '</div>' +
          '<div class="week-event-loc">' + escapeHTML(evt._locName || '') + '</div>' +
        '</div>';
      });

      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;

    // Reset offset if "Today" was clicked
    if (_weekOffset !== 0 && arguments[0] === 0) _weekOffset = 0;
  }

  // ── Recommendations ────────────────────────────────────────────

  function renderRecommendations() {
    var container = document.getElementById('recoSection');
    if (!container) return;

    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    if (Object.keys(bookings).length < 2) { container.style.display = 'none'; return; }

    // Analyse booking patterns
    var daySlots = {}; // "friday-730" => { type, instr, loc, count }
    var now = new Date();

    Object.values(cache).forEach(function (evt) {
      if (!bookings[String(evt.id)]) return;
      var dt = new Date(evt.start_at);
      var dayName = dt.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      var timeKey = dt.getHours() * 100 + dt.getMinutes();
      var key = dayName + '-' + timeKey;
      if (!daySlots[key]) {
        daySlots[key] = {
          day: dayName,
          time: dt.getHours() + ':' + dt.getMinutes().toString().padStart(2, '0'),
          timeAmPm: (dt.getHours() % 12 || 12) + ':' + dt.getMinutes().toString().padStart(2, '0') +
            (dt.getHours() >= 12 ? 'pm' : 'am'),
          type: evt._typeName || 'Class',
          instr: evt._instrName || '',
          loc: evt._locName || '',
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
        '<div class="reco-detail">' + escapeHTML(p.instr) + (p.loc ? ' · ' + escapeHTML(p.loc) : '') + '</div>' +
        '<div class="reco-detail" style="color:#555">' + p.count + 'x booked</div>' +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  // ── Studio Map ─────────────────────────────────────────────────

  // London bounding box for mapping lat/lon to pixel positions
  var MAP_BOUNDS = {
    north: 51.53,
    south: 51.455,
    east: -0.01,
    west: -0.20,
  };

  var STUDIOS = {
    'Oxford Circus':  { lat: 51.5188, lon: -0.1402 },
    'Bank':           { lat: 51.5155, lon: -0.0870 },
    'Victoria':       { lat: 51.4955, lon: -0.1480 },
    'Notting Hill':   { lat: 51.5154, lon: -0.1910 },
    'London Bridge':  { lat: 51.5055, lon: -0.0860 },
    'Shoreditch':     { lat: 51.5215, lon: -0.0735 },
    'Clapham':        { lat: 51.4622, lon: -0.1680 },
  };

  function renderStudioMap() {
    var container = document.getElementById('studioMapSection');
    if (!container) return;

    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    if (Object.keys(bookings).length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';

    var now = new Date();
    // Find next booking per studio
    var nextByStudio = {};
    Object.entries(bookings).forEach(function (entry) {
      var evtId = entry[0];
      var evt = cache[evtId];
      if (!evt || new Date(evt.start_at) <= now) return;
      var loc = evt._locName || '';
      if (!nextByStudio[loc] || evt.start_at < nextByStudio[loc].start_at) {
        nextByStudio[loc] = evt;
      }
    });

    var html = '<div class="studio-map-title">Your studios</div>' +
      '<div class="studio-map-container">';

    // Draw the Thames as a subtle line
    html += '<div style="position:absolute;top:60%;left:0;right:0;height:2px;' +
      'background:linear-gradient(90deg,transparent,#1a2a3a 20%,#1a2a3a 80%,transparent);' +
      'opacity:0.5"></div>';

    Object.entries(STUDIOS).forEach(function (entry) {
      var name = entry[0];
      var geo = entry[1];
      // Map lat/lon to % position
      var x = ((geo.lon - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * 100;
      var y = ((MAP_BOUNDS.north - geo.lat) / (MAP_BOUNDS.north - MAP_BOUNDS.south)) * 100;
      x = Math.max(5, Math.min(95, x));
      y = Math.max(5, Math.min(90, y));

      var hasBooking = !!nextByStudio[name];
      var nextEvt = nextByStudio[name];
      var bookingLabel = '';
      if (nextEvt) {
        var dt = new Date(nextEvt.start_at);
        var dayStr = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        var h = dt.getHours();
        var m = dt.getMinutes().toString().padStart(2, '0');
        bookingLabel = dayStr + ' ' + (h % 12 || 12) + ':' + m + (h >= 12 ? 'pm' : 'am');
      }

      html += '<div class="studio-pin" style="left:' + x + '%;top:' + y + '%">' +
        '<div class="studio-pin-dot' + (hasBooking ? ' has-booking' : '') + '"></div>' +
        '<div class="studio-pin-label">' + escapeHTML(name) + '</div>' +
        (bookingLabel ? '<div class="studio-pin-booking">' + bookingLabel + '</div>' : '') +
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

  function _formatGbp(amount) {
    return '£' + amount.toFixed(2);
  }

  function _daysLeftInBillingPeriod() {
    // Approximate: days left in current calendar month
    var now = new Date();
    var endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return Math.max(0, endOfMonth.getDate() - now.getDate());
  }


  // ── Init ───────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabs);
  } else {
    // Delay slightly to let app.js render the initial DOM
    setTimeout(initTabs, 50);
  }

  console.log('[tabs] tabs.js loaded');
})();
