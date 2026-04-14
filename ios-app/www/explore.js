/**
 * explore.js — Instructor Discovery Tab
 *
 * Self-contained IIFE that provides the Explore tab content:
 *   - "New to you" instructor recommendations
 *   - "You might like" similarity-based suggestions
 *   - Instructor map (tier distribution, most booked, unranked)
 *   - Full booking history sync from the Psycle API
 *
 * Depends on: app.js (instructors, _eventCache, _myBookings, getCategory, instrLink),
 *             settings.js (tierBadgeHTML), state.js (PsycleState, PsycleEvents)
 * Exposes on window:
 *   renderExplore, _explore_syncHistory, _explore_resetSync,
 *   _explore_openSettingsForInstructor
 */
(function () {
  'use strict';

  var escapeHtml = function (s) { return (window.escapeHTML || function (x) { return x; })(s); };

  var HISTORY_KEY = 'psycle_class_history';
  var TIER_KEY = 'psycle_instructor_tiers';
  var SYNC_KEY = 'psycle_history_synced';
  var _exploreDirty = true;
  var _syncing = false;

  /** Parse class history from localStorage. Shared across all explore functions. */
  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA LAYER
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Build a name → id reverse lookup from the instructors array.
   * Normalises names to lowercase for fuzzy matching.
   */
  function buildNameIndex() {
    var idx = {};
    var instrs = (typeof instructors !== 'undefined') ? instructors : [];
    for (var i = 0; i < instrs.length; i++) {
      idx[instrs[i].full_name.toLowerCase()] = String(instrs[i].id);
    }
    return idx;
  }

  /**
   * Gather a comprehensive profile for every known instructor.
   * Returns: { instrId: { id, name, classTypes: Set, locations: Set, bookCount, hasUpcoming } }
   */
  function gatherInstructorProfiles() {
    var profiles = {};
    var nameIndex = buildNameIndex();
    var instrs = (typeof instructors !== 'undefined') ? instructors : [];
    var cache = (typeof _eventCache !== 'undefined') ? _eventCache : {};
    var bookings = (typeof _myBookings !== 'undefined') ? _myBookings : {};
    var now = new Date();

    // Seed profiles from the instructors array (ensures all known instructors appear)
    for (var i = 0; i < instrs.length; i++) {
      var instr = instrs[i];
      var sid = String(instr.id);
      profiles[sid] = {
        id: sid,
        name: instr.full_name,
        classTypes: new Set(),
        locations: new Set(),
        bookCount: 0,
        hasUpcoming: false,
      };
    }

    // Enrich from _eventCache (live events from searches)
    var evtIds = Object.keys(cache);
    for (var e = 0; e < evtIds.length; e++) {
      var evt = cache[evtIds[e]];
      if (!evt || !evt.instructor_id) continue;
      var eid = String(evt.instructor_id);
      var p = profiles[eid];
      if (!p) continue;
      if (evt._typeName) p.classTypes.add(evt._typeName);
      if (evt._locName) p.locations.add(evt._locName);
      if (!evt.is_fully_booked && new Date(evt.start_at) > now) {
        p.hasUpcoming = true;
      }
    }

    // Enrich from class history (most reliable for who the user has booked)
    var history = getHistory();
    for (var h = 0; h < history.length; h++) {
      var entry = history[h];
      if (entry.cancelledAt) continue;
      var hid = entry.instrId || nameIndex[(entry.instrName || '').toLowerCase()];
      if (!hid || !profiles[hid]) continue;
      profiles[hid].bookCount++;
      if (entry.typeName) profiles[hid].classTypes.add(entry.typeName);
      if (entry.locName) profiles[hid].locations.add(entry.locName);
    }

    // Also count current bookings
    var bIds = Object.keys(bookings);
    for (var b = 0; b < bIds.length; b++) {
      var bevt = cache[bIds[b]];
      if (!bevt || !bevt.instructor_id) continue;
      var bid = String(bevt.instructor_id);
      if (profiles[bid]) {
        profiles[bid].bookCount++;
      }
    }

    return profiles;
  }

  /**
   * Build the set of instructor IDs the user has booked with.
   */
  function getBookedInstructorIds(profiles) {
    var nameIndex = buildNameIndex();
    var booked = new Set();
    var cache = (typeof _eventCache !== 'undefined') ? _eventCache : {};
    var bookings = (typeof _myBookings !== 'undefined') ? _myBookings : {};

    // From class history
    var history = getHistory();
    for (var h = 0; h < history.length; h++) {
      if (history[h].cancelledAt) continue;
      var hid = history[h].instrId || nameIndex[(history[h].instrName || '').toLowerCase()];
      if (hid) booked.add(hid);
    }

    // From current bookings
    var bIds = Object.keys(bookings);
    for (var b = 0; b < bIds.length; b++) {
      var evt = cache[bIds[b]];
      if (evt && evt.instructor_id) booked.add(String(evt.instructor_id));
    }

    return booked;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: "New to you"
  // ═══════════════════════════════════════════════════════════════════

  function computeNewToYou(profiles) {
    var booked = getBookedInstructorIds(profiles);
    var results = [];
    var ids = Object.keys(profiles);
    for (var i = 0; i < ids.length; i++) {
      var p = profiles[ids[i]];
      if (!booked.has(p.id)) results.push(p);
    }
    // Sort: upcoming first, then alphabetical
    results.sort(function (a, b) {
      if (a.hasUpcoming !== b.hasUpcoming) return b.hasUpcoming ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    return results.slice(0, 20);
  }

  function renderNewToYou(container, profiles) {
    var list = computeNewToYou(profiles);
    if (list.length === 0) {
      var booked = getBookedInstructorIds(profiles);
      var total = Object.keys(profiles).length;
      if (total > 0 && booked.size >= total) {
        container.innerHTML = '<div class="explore-title">New to you</div>' +
          '<div class="explore-empty">You\'ve booked with every instructor — impressive range!</div>';
      } else {
        container.innerHTML = '<div class="explore-title">New to you</div>' +
          '<div class="explore-empty">Book some classes to see who you haven\'t tried yet.</div>';
      }
      container.style.display = '';
      return;
    }

    var html = '<div class="explore-title">New to you</div>';
    html += '<div class="explore-subtitle">Instructors you haven\'t booked with yet</div>';
    html += '<div class="explore-grid">';
    for (var i = 0; i < list.length; i++) {
      html += instrCard(list[i], null);
    }
    html += '</div>';
    container.innerHTML = html;
    container.style.display = '';
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: "You might like"
  // ═══════════════════════════════════════════════════════════════════

  function computeYouMightLike(profiles) {
    var favs = (typeof favouriteInstructors !== 'undefined') ? favouriteInstructors : new Set();
    var tiers = {};
    try { tiers = JSON.parse(localStorage.getItem(TIER_KEY) || '{}'); } catch (e) {}

    // Build reference set: favourites + S/A tier instructors
    var refIds = new Set();
    favs.forEach(function (id) { refIds.add(String(id)); });
    var tierKeys = Object.keys(tiers);
    for (var t = 0; t < tierKeys.length; t++) {
      if (tiers[tierKeys[t]] === 'S' || tiers[tierKeys[t]] === 'A') {
        refIds.add(String(tierKeys[t]));
      }
    }

    if (refIds.size === 0) return { results: [], noRefs: true };

    // Build reference profile: aggregate class types and locations
    var refClassTypes = new Set();
    var refLocations = new Set();
    refIds.forEach(function (id) {
      var p = profiles[id];
      if (!p) return;
      p.classTypes.forEach(function (ct) { refClassTypes.add(ct); });
      p.locations.forEach(function (loc) { refLocations.add(loc); });
    });

    // Score every non-reference instructor
    var booked = getBookedInstructorIds(profiles);
    var candidates = [];
    var ids = Object.keys(profiles);
    for (var i = 0; i < ids.length; i++) {
      var p = profiles[ids[i]];
      // Skip favourites, reference instructors, and anyone already ranked
      var hasTier = !!tiers[p.id];
      if (refIds.has(p.id) || favs.has(p.id) || hasTier) continue;

      var typeMatches = [];
      p.classTypes.forEach(function (ct) { if (refClassTypes.has(ct)) typeMatches.push(ct); });
      var locMatches = [];
      p.locations.forEach(function (loc) { if (refLocations.has(loc)) locMatches.push(loc); });

      var score = (typeMatches.length * 2) + locMatches.length + (p.hasUpcoming ? 1 : 0);
      if (score > 0) {
        candidates.push({
          profile: p,
          score: score,
          typeMatches: typeMatches,
          locMatches: locMatches,
          isNew: !booked.has(p.id),
        });
      }
    }

    candidates.sort(function (a, b) { return b.score - a.score; });
    return { results: candidates.slice(0, 12), noRefs: false };
  }

  function renderYouMightLike(container, profiles) {
    var data = computeYouMightLike(profiles);

    if (data.noRefs) {
      container.innerHTML = '<div class="explore-title">You might like</div>' +
        '<div class="explore-empty">Star some favourite instructors or rank them in Settings to get personalised recommendations.</div>';
      container.style.display = '';
      return;
    }

    if (data.results.length === 0) {
      container.innerHTML = '<div class="explore-title">You might like</div>' +
        '<div class="explore-empty">Run a search to help us find instructors similar to your favourites.</div>';
      container.style.display = '';
      return;
    }

    var html = '<div class="explore-title">You might like</div>';
    html += '<div class="explore-subtitle">Based on your favourites and top-rated instructors</div>';
    html += '<div class="explore-grid">';
    for (var i = 0; i < data.results.length; i++) {
      var c = data.results[i];
      // Build a "why" label
      var why = '';
      if (c.typeMatches.length > 0) {
        var catName = getShortCategoryName(c.typeMatches[0]);
        why = 'Also teaches ' + catName;
      } else if (c.locMatches.length > 0) {
        why = 'Also at ' + c.locMatches[0];
      }
      html += instrCard(c.profile, why);
    }
    html += '</div>';
    container.innerHTML = html;
    container.style.display = '';
  }

  function getShortCategoryName(typeName) {
    if (typeof getCategory === 'function') {
      var cat = getCategory(typeName);
      if (cat && cat.label) return cat.label;
    }
    return typeName;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: "Your instructor map"
  // ═══════════════════════════════════════════════════════════════════

  function computeInstructorMap(profiles) {
    var nameIndex = buildNameIndex();
    var instrStats = {}; // instrId -> { name, count, classTypes: Set }
    var history = getHistory();

    var soloCount = 0;
    var socialCount = 0;

    // From history
    for (var h = 0; h < history.length; h++) {
      if (history[h].cancelledAt) continue;
      var isSocial = history[h].slots && history[h].slots.length > 1;
      if (isSocial) socialCount++; else soloCount++;
      var hid = nameIndex[(history[h].instrName || '').toLowerCase()];
      if (!hid) continue;
      if (!instrStats[hid]) {
        instrStats[hid] = { name: history[h].instrName, count: 0, classTypes: new Set() };
      }
      instrStats[hid].count++;
      if (history[h].typeName) instrStats[hid].classTypes.add(history[h].typeName);
    }

    // From current bookings
    var cache = (typeof _eventCache !== 'undefined') ? _eventCache : {};
    var bookings = (typeof _myBookings !== 'undefined') ? _myBookings : {};
    var bIds = Object.keys(bookings);
    for (var b = 0; b < bIds.length; b++) {
      var evt = cache[bIds[b]];
      if (!evt || !evt.instructor_id) continue;
      var bid = String(evt.instructor_id);
      if (!instrStats[bid]) {
        instrStats[bid] = { name: evt._instrName || 'Unknown', count: 0, classTypes: new Set() };
      }
      instrStats[bid].count++;
      if (evt._typeName) instrStats[bid].classTypes.add(evt._typeName);
    }

    var uniqueCount = Object.keys(instrStats).length;

    // Tier distribution
    var tierCounts = { S: 0, A: 0, B: 0, C: 0, D: 0, F: 0, unranked: 0 };
    var unrankedList = []; // { id, name, count }
    var tiers = {};
    try { tiers = JSON.parse(localStorage.getItem(TIER_KEY) || '{}'); } catch (e) {}
    var sIds = Object.keys(instrStats);
    for (var s = 0; s < sIds.length; s++) {
      var tier = tiers[sIds[s]] || null;
      if (tier && tierCounts.hasOwnProperty(tier)) {
        tierCounts[tier]++;
      } else {
        tierCounts.unranked++;
        unrankedList.push({ id: sIds[s], name: instrStats[sIds[s]].name, count: instrStats[sIds[s]].count });
      }
    }
    unrankedList.sort(function (a, b) { return b.count - a.count; });

    // Top 3 most booked
    var sorted = Object.entries(instrStats).sort(function (a, b) { return b[1].count - a[1].count; });
    var mostBooked = sorted.slice(0, 3);

    // Tried once count
    var triedOnce = sorted.filter(function (e) { return e[1].count === 1; }).length;

    return {
      uniqueCount: uniqueCount,
      tierCounts: tierCounts,
      mostBooked: mostBooked,
      triedOnce: triedOnce,
      totalBookings: sorted.reduce(function (sum, e) { return sum + e[1].count; }, 0),
      soloCount: soloCount,
      socialCount: socialCount,
      unrankedList: unrankedList,
    };
  }

  function renderInstructorMap(container, profiles) {
    var data = computeInstructorMap(profiles);

    if (data.uniqueCount === 0) {
      container.innerHTML = '<div class="explore-title">Your instructor map</div>' +
        '<div class="explore-empty">Book your first class to start building your instructor map.</div>';
      container.style.display = '';
      return;
    }

    var html = '<div class="explore-title">Your instructor map</div>';

    // Stat cards row
    html += '<div class="explore-map-stats">';
    html += '<div class="explore-map-stat">' +
      '<div class="explore-map-stat-value">' + data.uniqueCount + '</div>' +
      '<div class="explore-map-stat-label">Instructors</div></div>';
    html += '<div class="explore-map-stat">' +
      '<div class="explore-map-stat-value">' + data.totalBookings + '</div>' +
      '<div class="explore-map-stat-label">Total classes</div></div>';
    if (data.triedOnce > 0) {
      html += '<div class="explore-map-stat">' +
        '<div class="explore-map-stat-value">' + data.triedOnce + '</div>' +
        '<div class="explore-map-stat-label">Tried once</div></div>';
    }
    if (data.socialCount > 0) {
      html += '<div class="explore-map-stat">' +
        '<div class="explore-map-stat-value">' + data.soloCount + '</div>' +
        '<div class="explore-map-stat-label">Solo</div></div>';
      html += '<div class="explore-map-stat">' +
        '<div class="explore-map-stat-value">' + data.socialCount + '</div>' +
        '<div class="explore-map-stat-label">With a friend</div></div>';
    }
    html += '</div>';

    // Tier distribution bar
    var tierTotal = 0;
    var tierKeys = ['S', 'A', 'B', 'C', 'D', 'F', 'unranked'];
    for (var t = 0; t < tierKeys.length; t++) tierTotal += data.tierCounts[tierKeys[t]];

    if (tierTotal > 0 && data.tierCounts.unranked < tierTotal) {
      html += '<div class="explore-tier-bar-wrap">';
      html += '<div class="explore-tier-bar-label">Tier distribution</div>';
      html += '<div class="explore-tier-bar">';
      for (var ti = 0; ti < tierKeys.length; ti++) {
        var count = data.tierCounts[tierKeys[ti]];
        if (count === 0) continue;
        var pct = (count / tierTotal * 100).toFixed(1);
        var label = pct >= 10 ? tierKeys[ti] + ' (' + count + ')' : count > 0 ? tierKeys[ti] : '';
        html += '<div class="explore-tier-seg tier-' + tierKeys[ti] + '" ' +
          'style="flex:' + count + '" title="' + tierKeys[ti] + ': ' + count + '">' +
          label + '</div>';
      }
      html += '</div>';

      // Legend
      html += '<div class="explore-tier-legend">';
      var tierColors = { S: '#b8860b', A: '#2a7a2a', B: '#2a5a8a', C: '#555', D: '#8a5a2a', F: '#8a2a2a', unranked: '#222' };
      for (var tl = 0; tl < tierKeys.length; tl++) {
        if (data.tierCounts[tierKeys[tl]] === 0) continue;
        html += '<span class="explore-tier-legend-item">' +
          '<span class="explore-tier-legend-dot" style="background:' + tierColors[tierKeys[tl]] + '"></span>' +
          tierKeys[tl] + ' (' + data.tierCounts[tierKeys[tl]] + ')</span>';
      }
      html += '</div>';
      html += '</div>';
    }

    // Unranked instructors — prompt to rank them
    if (data.unrankedList.length > 0) {
      html += '<div class="explore-tier-bar-label" style="margin-bottom:8px">Unranked (' + data.unrankedList.length + ')</div>';
      html += '<div class="explore-unranked-list">';
      for (var u = 0; u < data.unrankedList.length; u++) {
        var ui = data.unrankedList[u];
        html += '<button class="explore-unranked-item" onclick="window._explore_openSettingsForInstructor(\'' +
          escapeHtml(ui.name).replace(/'/g, "\\'") + '\')">' +
          '<span class="explore-unranked-name">' + escapeHtml(ui.name) + '</span>' +
          '<span class="explore-unranked-count">' + ui.count + ' class' + (ui.count !== 1 ? 'es' : '') + '</span>' +
        '</button>';
      }
      html += '</div>';
    }

    // Most booked list
    if (data.mostBooked.length > 0) {
      html += '<div class="explore-tier-bar-label" style="margin-bottom:8px">Most booked</div>';
      html += '<div class="explore-top-list">';
      for (var m = 0; m < data.mostBooked.length; m++) {
        var entry = data.mostBooked[m];
        var instrId = entry[0];
        var stat = entry[1];
        var tierBadge = (typeof tierBadgeHTML === 'function') ? tierBadgeHTML(instrId) : '';
        html += '<div class="explore-top-item">' +
          '<span class="explore-top-rank">' + (m + 1) + '</span>' +
          '<span class="explore-top-name">' + ((typeof instrLink === 'function') ? instrLink(stat.name, instrId) : escapeHtml(stat.name)) + ' ' + tierBadge + '</span>' +
          '<span class="explore-top-count">' + stat.count + ' class' + (stat.count !== 1 ? 'es' : '') + '</span>' +
        '</div>';
      }
      html += '</div>';
    }

    container.innerHTML = html;
    container.style.display = '';
  }

  // ═══════════════════════════════════════════════════════════════════
  // SHARED: Instructor card renderer
  // ═══════════════════════════════════════════════════════════════════

  function instrCard(profile, whyLabel) {
    var tierBadge = (typeof tierBadgeHTML === 'function') ? tierBadgeHTML(profile.id) : '';

    // Class type tags (color-coded)
    var tagHtml = '';
    if (profile.classTypes.size > 0) {
      tagHtml = '<div class="explore-tags">';
      profile.classTypes.forEach(function (typeName) {
        var cat = (typeof getCategory === 'function') ? getCategory(typeName) : null;
        var color = cat ? cat.color : '#888';
        var label = cat ? cat.label : typeName;
        tagHtml += '<span class="explore-type-tag" style="color:' + color + ';border-color:' + color + '">' +
          escapeHtml(label) + '</span>';
      });
      tagHtml += '</div>';
    }

    // Location text
    var locHtml = '';
    if (profile.locations.size > 0) {
      var locs = [];
      profile.locations.forEach(function (l) { locs.push(l); });
      locHtml = '<div class="explore-loc-tag">' + escapeHtml(locs.join(' / ')) + '</div>';
    }

    var nameEscaped = profile.name.replace(/'/g, "\\'");

    return '<div class="explore-card">' +
      (whyLabel ? '<div class="explore-why">' + escapeHtml(whyLabel) + '</div>' : '') +
      '<div class="explore-card-header">' +
        '<span class="explore-card-name" onclick="event.stopPropagation();' +
          'window._features_openInstructorModal(\'' + nameEscaped + '\',\'' + profile.id + '\')">' +
          escapeHtml(profile.name) + '</span>' +
        tierBadge +
      '</div>' +
      tagHtml +
      locHtml +
      '<button class="explore-card-action" onclick="' +
        'window._features_filterByInstructor(\'' + profile.id + '\');' +
        'window.switchTab(\'discover\')' +
      '">View classes</button>' +
    '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════
  // HISTORY SYNC — Fetch full booking history from Psycle API
  // ═══════════════════════════════════════════════════════════════════

  function hasSynced() {
    return !!localStorage.getItem(SYNC_KEY);
  }

  function renderSyncBanner(container) {
    if (!container) return;
    if (!getBearerToken()) {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';

    var synced = hasSynced();
    var syncDate = synced ? localStorage.getItem(SYNC_KEY) : null;
    var dateLabel = '';
    if (syncDate) {
      try {
        var d = new Date(syncDate);
        dateLabel = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      } catch (e) {}
    }

    var history = getHistory();
    var historyCount = history.length;

    if (synced) {
      container.innerHTML =
        '<div class="explore-sync-banner explore-sync-done">' +
          '<div class="explore-sync-text">' +
            '<strong>' + historyCount + ' bookings in history</strong>' +
            (dateLabel ? '<br><span>Last synced ' + dateLabel + '</span>' : '') +
          '</div>' +
          '<button class="explore-sync-btn explore-sync-btn-secondary" id="syncHistoryBtn" onclick="window._explore_syncHistory()">Re-sync</button>' +
        '</div>';
    } else {
      container.innerHTML =
        '<div class="explore-sync-banner">' +
          '<div class="explore-sync-text">' +
            '<strong>Sync your full booking history</strong><br>' +
            '<span>Import all past bookings from your Psycle account so Explore can give accurate recommendations.</span>' +
          '</div>' +
          '<button class="explore-sync-btn" id="syncHistoryBtn" onclick="window._explore_syncHistory()">Sync now</button>' +
        '</div>';
    }
  }

  /**
   * Probe the API for past bookings using common codexfit patterns.
   * Tries multiple approaches and uses whatever returns data.
   */
  window._explore_openSettingsForInstructor = function (name) {
    if (typeof openSettings === 'function') openSettings();
    // Wait for settings panel to render, then pre-fill the search
    setTimeout(function () {
      var search = document.getElementById('tierSearch');
      if (search) {
        search.value = name;
        search.dispatchEvent(new Event('input'));
        search.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 200);
  };

  window._explore_resetSync = function () {
    localStorage.removeItem(SYNC_KEY);
    _exploreDirty = true;
    window.renderExplore();
    if (typeof toast === 'function') toast('Sync flag cleared — you can sync again', 'info');
  };

  window._explore_syncHistory = async function () {
    if (_syncing) return;
    _syncing = true;

    var btn = document.getElementById('syncHistoryBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Syncing...';
    }

    var allBookings = [];

    try {
      // Strategy 1: Try /bookings with type=previous (confirmed Psycle API pattern)
      var strategies = [
        '/bookings?type=previous&limit=100',
      ];

      var foundBookings = false;
      for (var s = 0; s < strategies.length; s++) {
        try {
          var res = await apiFetch(strategies[s]);
          if (!res.ok) { continue; }
          var data = await res.json();
          var list = Array.isArray(data) ? data : (data.data || []);
          if (list.length > 0) {
            allBookings = list;
            foundBookings = true;

            // Check if there's pagination and fetch more pages
            var totalPages = data.meta?.last_page || data.meta?.total_pages || data.last_page || 1;
            var currentPage = data.meta?.current_page || data.current_page || 1;
            if (totalPages > 1) {
              var baseUrl = strategies[s];
              for (var pg = currentPage + 1; pg <= totalPages && pg <= 100; pg++) {
                var sep = baseUrl.includes('?') ? '&' : '?';
                if (btn) btn.textContent = 'Fetching page ' + pg + ' of ' + totalPages + '...';
                var pgRes = await apiFetch(baseUrl + sep + 'page=' + pg);
                if (!pgRes.ok) break;
                var pgData = await pgRes.json();
                var pgList = Array.isArray(pgData) ? pgData : (pgData.data || []);
                if (pgList.length === 0) break;
                allBookings = allBookings.concat(pgList);
              }
            }
            break;
          }
        } catch (e) { /* try next strategy */ }
      }

      // Strategy 2: If nothing found, try date-range based fetching
      if (!foundBookings) {
        var now = new Date();
        var yearAgo = new Date(now);
        yearAgo.setFullYear(yearAgo.getFullYear() - 2);
        var startStr = yearAgo.toISOString().split('T')[0];
        var endStr = now.toISOString().split('T')[0];
        try {
          var rangeUrl = '/bookings?start=' + startStr + '&end=' + endStr + '&limit=200';
          var rangeRes = await apiFetch(rangeUrl);
          if (rangeRes.ok) {
            var rangeData = await rangeRes.json();
            var rangeList = Array.isArray(rangeData) ? rangeData : (rangeData.data || []);
            if (rangeList.length > 0) {
              allBookings = rangeList;
              foundBookings = true;
            }
          }
        } catch (e) { /* date-range fallback failed */ }
      }
      if (allBookings.length === 0) {
        if (typeof toast === 'function') toast('No past bookings found from the API. Your current history is up to date.', 'info');
        _syncing = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Sync now'; }
        return;
      }

      // Update button with progress
      if (btn) btn.textContent = 'Fetching details (' + allBookings.length + ' bookings)...';

      // Fetch event details for each booking to get instructor/type/location
      var existing = getHistory();
      var existingIds = new Set(existing.map(function (e) { return e.eventId; }));
      var newEntries = [];
      var batchSize = 30;

      // Deduplicate bookings by event_id (multiple slots = multiple records)
      var seenEvents = new Set();
      var uniqueBookings = allBookings.filter(function (b) {
        var eid = String(b.event_id);
        if (seenEvents.has(eid) || existingIds.has(eid)) return false;
        seenEvents.add(eid);
        return true;
      });

      // Fetch event details in batches
      for (var i = 0; i < uniqueBookings.length; i += batchSize) {
        var batch = uniqueBookings.slice(i, i + batchSize);
        if (btn) btn.textContent = 'Fetching details (' + (i + 1) + '/' + uniqueBookings.length + ')...';

        await Promise.all(batch.map(async function (booking) {
          var evtId = String(booking.event_id);
          try {
            var r = await apiFetch('/events/' + evtId);
            if (!r.ok) return;
            var d = await r.json();
            var evt = d.data || d;
            var rels = d.relations || {};
            var instrMap = Object.fromEntries((rels.instructors || []).map(function (x) { return [x.id, x]; }));
            var typeMap = Object.fromEntries((rels.event_types || []).map(function (x) { return [x.id, x]; }));
            var studioMap = Object.fromEntries((rels.studios || []).map(function (x) { return [x.id, x]; }));
            var locationMap = Object.fromEntries((rels.locations || []).map(function (x) { return [x.id, x]; }));

            var type = typeMap[evt.event_type_id];
            var instr = instrMap[evt.instructor_id];
            var studio = studioMap[evt.studio_id];
            var loc = studio ? locationMap[studio.location_id] : null;

            // Collect all slots for this event
            var slots = allBookings
              .filter(function (b) { return String(b.event_id) === evtId && b.slot; })
              .map(function (b) { return Number(b.slot); });

            newEntries.push({
              eventId: evtId,
              typeName: type?.name || 'Class',
              instrName: instr?.full_name || '',
              instrId: instr ? String(instr.id) : '',
              locName: loc ? loc.name.replace('Psycle ', '') : '',
              date: evt.start_at,
              slots: slots,
              bookedAt: booking.created_at || evt.start_at,
              synced: true,
            });

            // Also cache in _eventCache for immediate use
            if (typeof _eventCache !== 'undefined') {
              _eventCache[evtId] = {
                ...evt,
                _typeName: type?.name || 'Class',
                _instrName: instr?.full_name || '',
                _locName: loc ? loc.name.replace('Psycle ', '') : '',
                _locFullName: loc ? loc.name : '',
                _locAddress: loc ? (loc.address || '') : '',
                _studioName: studio ? studio.name : '',
              };
            }
          } catch (e) { /* skip failed event fetches */ }
        }));
      }

      // Merge with existing history (new entries at the end, sorted by date)
      var merged = existing.concat(newEntries);
      merged.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      // Deduplicate by eventId (keep first occurrence, which is most recent)
      var seen = new Set();
      merged = merged.filter(function (e) {
        if (seen.has(e.eventId)) return false;
        seen.add(e.eventId);
        return true;
      });
      if (merged.length > 1000) merged.length = 1000;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
      localStorage.setItem(SYNC_KEY, new Date().toISOString());

      if (typeof toast === 'function') {
        toast('Synced ' + newEntries.length + ' past booking' + (newEntries.length !== 1 ? 's' : '') + ' (' + merged.length + ' total in history)', 'success');
      }

      // Re-render all tabs that use history
      markDirtyAndMaybeRender();
      // Also re-render Insights if it has been rendered
      if (typeof renderInsights === 'function') renderInsights();
      // Emit event so any other listeners can react
      if (typeof PsycleEvents !== 'undefined') PsycleEvents.emit('history:synced');

    } catch (e) {
      console.error('[explore] sync failed:', e);
      if (typeof toast === 'function') toast('Sync failed: ' + e.message, 'error');
    }

    _syncing = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Sync now'; }
  };

  // ═══════════════════════════════════════════════════════════════════
  // MASTER RENDER
  // ═══════════════════════════════════════════════════════════════════

  window.renderExplore = function () {
    if (!_exploreDirty) return;
    _exploreDirty = false;

    var syncSection = document.getElementById('exploreSyncSection');
    var newSection = document.getElementById('exploreNewSection');
    var likeSection = document.getElementById('exploreLikeSection');
    var mapSection = document.getElementById('exploreMapSection');
    if (!newSection || !likeSection || !mapSection) return;

    var instrs = (typeof instructors !== 'undefined') ? instructors : [];

    // Sync banner
    renderSyncBanner(syncSection);

    // Loading state if data not ready
    if (!instrs || instrs.length === 0) {
      newSection.innerHTML = '<div class="explore-loading">Loading instructors...</div>';
      newSection.style.display = '';
      likeSection.style.display = 'none';
      mapSection.style.display = 'none';
      _exploreDirty = true; // retry on next switch
      return;
    }

    var profiles = gatherInstructorProfiles();
    renderNewToYou(newSection, profiles);
    renderYouMightLike(likeSection, profiles);
    renderInstructorMap(mapSection, profiles);
  };

  // ═══════════════════════════════════════════════════════════════════
  // REACTIVITY: Mark dirty on data changes, re-render if tab active
  // ═══════════════════════════════════════════════════════════════════

  function markDirtyAndMaybeRender() {
    _exploreDirty = true;
    // Re-render if discover or stats tab is active (explore sections live in both)
    var activePanel = document.querySelector('.tab-panel.active');
    if (activePanel && (activePanel.id === 'tab-discover' || activePanel.id === 'tab-stats' || activePanel.id === 'tab-profile' || activePanel.id === 'tab-explore')) {
      window.renderExplore();
    }
  }

  if (typeof PsycleState !== 'undefined' && PsycleState.subscribe) {
    PsycleState.subscribe('instructors', function () { markDirtyAndMaybeRender(); });
  }

  if (typeof PsycleEvents !== 'undefined') {
    PsycleEvents.on('bookings:loaded', markDirtyAndMaybeRender);
    PsycleEvents.on('booking:complete', markDirtyAndMaybeRender);
    PsycleEvents.on('booking:cancelled', markDirtyAndMaybeRender);
    PsycleEvents.on('seat:cancelled', markDirtyAndMaybeRender);
  }

})();
