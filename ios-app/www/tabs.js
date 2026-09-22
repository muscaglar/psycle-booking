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
 *   switchTab, renderInsights, showStatsPage, weekNav, shareInsights, planDay,
 *   openYearReview, shareYearReview, saveWeekAsTemplate, bookTemplateWeek,
 *   clearUsualWeek, removeUsualWeekEntry, renderUsualWeekCard, toggleUsualWeek
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
    // Crisp Colour: the boards' four marks on a 24 grid, stroke 2, round ends —
    // search, calendar-check, bars, card. Size and stroke never change with
    // state; the current tab is told by the pill css/crisp.css draws behind it.
    var icon = function (paths) {
      return '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    };
    var TAB_ICONS = {
      discover: icon('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>'),
      bookings: icon('<rect x="3.5" y="5" width="17" height="15" rx="4"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M8.5 13l2.5 2.5 4.5-5"/>'),
      stats: icon('<path d="M6 19v-6"/><path d="M12 19V5"/><path d="M18 19v-9"/>'),
      membership: icon('<rect x="3" y="6" width="18" height="12.5" rx="3.5"/><path d="M3 10.5h18"/><path d="M7 14.5h4"/>'),
    };
    var tabBar = document.createElement('div');
    tabBar.className = 'tab-bar';
    // Which section is showing was a CSS class only. aria-current starts on
    // Discover here as well as in switchTab: a launch with no #hash never
    // calls switchTab.
    tabBar.setAttribute('role', 'navigation');
    tabBar.setAttribute('aria-label', 'Sections');
    tabBar.innerHTML =
      '<button class="tab-btn active" aria-current="page" data-tab="discover" onclick="switchTab(\'discover\')">' + TAB_ICONS.discover + '<span class="tab-label">Discover</span></button>' +
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

    // Crisp Colour: no headline over a loaded timetable (the boards go straight
    // from the wordmark to the date row; "Find your next class" stays the title
    // of the EMPTY state in #results). What is left is one quiet line:
    // freshness / refresh, and "Clear filters" where the Filters bar is hidden.
    var discHeader = document.createElement('div');
    discHeader.className = 'disc-header';
    var discActions = document.createElement('div');
    discActions.className = 'disc-actions';
    // "Clear filters" starts hidden: app.js updateFiltersSummary shows it only
    // while a filter is on (it used to sit there with nothing to clear).
    discActions.innerHTML =
      '<span id="lastUpdated" class="last-updated"></span>' +
      '<button type="button" id="discClearBtn" class="disc-clear-btn" onclick="clearFilters()" hidden>Clear filters</button>';
    discHeader.appendChild(discActions);
    discoverPanel.appendChild(discHeader);
    // …and is put right NOW rather than by whoever paints the summary next: on a
    // warm launch (the three reference lists come from the 24h cache) app.js's
    // one launch-time updateFiltersSummary() runs before this function has built
    // the button. A member whose starred instructors were pre-selected, with no
    // saved filters to restore, then had a filter on and no way to clear it at
    // >= 1024px (the Filters bar's own Clear is hidden there). It sets `hidden`
    // before its "same chips" early return, so this costs nothing otherwise.
    if (typeof updateFiltersSummary === 'function') updateFiltersSummary();

    // (Top unified search bar removed — the filters cover instructor/studio/type.)

    // Redesign: "N = classes matching your selection" count chip

    // Weekly planner / "save this week as a template" calendar removed from
    // Discover (not part of the redesign). #weekView is no longer created, so
    // renderWeekView() no-ops via its null-check and the section never appears.

    // Instructor discovery (New to you / You might like) lives on Stats now.
    // Under the results it sat below the whole pre-loaded timetable — a week
    // of every studio — where nobody scrolls to; above the filters it
    // competed with them for attention (user feedback).
    discoverPanel.appendChild(controls);
    // app.js's travel notice sits right above #results and can be up before
    // this runs (reference data answered from the cache): it moves with it —
    // left behind it ended up outside the panels, under the docked tab bar.
    var travelNotice = document.getElementById('travelNotice');
    if (travelNotice) discoverPanel.appendChild(travelNotice);
    discoverPanel.appendChild(results);

    // ── My Bookings tab: upcoming bookings + history ──
    var bookingsPanel = document.createElement('div');
    bookingsPanel.id = 'tab-bookings';
    bookingsPanel.className = 'tab-panel';

    // "Your usual week" (weekly template). Its own container, filled by
    // renderUsualWeekCard — which also keeps it right after #rebookHint, a
    // node app.js removes and re-creates in front of #upcomingPanel.
    var usualWeekCard = document.createElement('div');
    usualWeekCard.id = 'usualWeekCard';
    usualWeekCard.className = 'usual-week';
    usualWeekCard.style.display = 'none';
    bookingsPanel.appendChild(usualWeekCard);

    if (upcomingPanel) {
      bookingsPanel.appendChild(upcomingPanel);
    }

    // Empty state (filled by renderMyBookings — sign-in CTA when logged
    // out, find-a-class CTA when logged in with nothing booked). It comes
    // AFTER the usual-week card (and the list it stands in for, hidden then):
    // with nothing booked the tall "Nothing booked — yet" hero used to push
    // "Review and book" — the way to fill the week again — below the fold.
    var bookingsEmpty = document.createElement('div');
    bookingsEmpty.id = 'bookingsEmpty';
    bookingsEmpty.className = 'tab-empty';
    bookingsEmpty.style.display = 'none';
    bookingsPanel.appendChild(bookingsEmpty);

    var historyBtnHtml = '<button class="history-in-bookings-btn" id="historyInBookingsBtn" onclick="openHistoryModal()">View full history</button>';
    var historyBtnContainer = document.createElement('div');
    historyBtnContainer.innerHTML = historyBtnHtml;
    bookingsPanel.appendChild(historyBtnContainer.firstChild);

    // ── Stats tab: fitness journey + instructor discovery ──
    var statsPanel = document.createElement('div');
    statsPanel.id = 'tab-stats';
    statsPanel.className = 'tab-panel';
    // Every section's own container, by id. Which sub-page holds which, and in
    // what order, is STATS_PAGES' to say (pure:stats-pages below) — not this
    // list's: a section it does not name is never created.
    var statsSectionHtml = {
      // Quick stats
      statsBar: '<div id="statsBar" class="stats-bar" style="display:none"></div>',
      // Habitual slot alerts
      habitSection: '<div id="habitSection" class="habit-section" style="display:none"></div>',
      // Streaks & milestones
      streakSection: '<div id="streakSection" class="streak-section" style="display:none"></div>',
      lapsedSection: '<div id="lapsedSection" class="insights-section" style="display:none"></div>',
      // Patterns
      recoSection: '<div id="recoSection" class="reco-section" style="display:none"></div>',
      // Instructor suggestions (explore.js fills them by id)
      exploreLikeSection: '<div id="exploreLikeSection" class="explore-section" style="display:none"></div>',
      exploreNewSection: '<div id="exploreNewSection" class="explore-section" style="display:none"></div>',
      classTypeSection: '<div id="classTypeSection" class="insights-section" style="display:none"></div>',
      // Deep analytics
      exploreMapSection: '<div id="exploreMapSection" class="explore-section" style="display:none"></div>',
      varietySection: '<div id="varietySection" class="insights-section" style="display:none"></div>',
      heatmapSection: '<div id="heatmapSection" class="heatmap-section" style="display:none"></div>',
      // Year in review entry point
      yearReviewSection: '<div id="yearReviewSection" class="insights-section" style="display:none"></div>',
      // Share
      // (insets from .insights-section like its neighbours — it carried an inline 24px that ignored the phone inset)
      shareSection: '<div id="shareSection" class="insights-section"><button class="share-insights-btn" onclick="shareInsights()">Share my stats</button></div>',
    };
    statsPanel.innerHTML =
      // Signed-out hero (filled by renderInsights)
      '<div id="statsEmpty" class="tab-empty" style="display:none"></div>' +
      // Sync banner (if needed) — global: above the switcher, whichever page is open
      '<div id="exploreSyncSection" class="explore-section" style="display:none"></div>' +
      // Content switcher + the three sub-pages (only the open one is displayed)
      _statsPagesHtml(statsSectionHtml, _statsPageNow);
    _wireStatsPages(statsPanel);
    _wireStatsSwipe(statsPanel);

    // ── Membership tab: account, subscription, cost, settings ──
    var membershipPanel = document.createElement('div');
    membershipPanel.id = 'tab-membership';
    membershipPanel.className = 'tab-panel';
    // Membership = the user's relationship with Psycle: plan, usage,
    // and their instructor rankings/favourites. App-focused settings
    // (theme, reminders, data) live in the Settings panel.
    membershipPanel.innerHTML =
      '<div id="membershipSignin" class="tab-empty" style="display:none"></div>' +
      // Who, their plan, then what it costs per class (the tracker used to sit
      // above the member's own name).
      '<div id="membershipInfo" class="insights-section" style="display:none"></div>' +
      '<div id="costSection" class="cost-section" style="display:none"></div>' +
      // Appearance (theme cards) — moved out of the Settings overlay
      '<div class="ms-section">' +
        '<div class="ms-section-title">Appearance</div>' +
        '<div id="themePicker"></div>' +
        // Class colours (Crisp Colour): strength + one swatch per class type.
        // Filled by renderClassColours; everything goes through
        // window.PsycleClassColours (js/theme.js).
        '<div class="ms-section-title ms-section-title-sub" id="classColoursTitle">Class colours</div>' +
        '<div id="classColours" class="cc-control" role="group" aria-labelledby="classColoursTitle"></div>' +
      '</div>' +
      // Settings list — each row opens the Settings panel AT its own section,
      // and promises only what that section holds ("Default studio", "waitlist
      // alerts" and "clear local data" existed nowhere). Reminders / Calendar
      // sync are iOS-only: renderMembershipInfo shows or hides those two rows.
      '<div class="ms-list">' +
        '<button class="ms-row" onclick="openSettings(\'bike\')"><span class="ms-row-text"><span class="ms-row-label">Bike / spot preferences</span></span><span class="ms-row-chev">›</span></button>' +
        '<button class="ms-row" id="msRowReminders" onclick="openSettings(\'reminders\')"><span class="ms-row-text"><span class="ms-row-label">Reminders</span><span class="ms-row-sub">Monday booking · before each class</span></span><span class="ms-row-chev">›</span></button>' +
        '<button class="ms-row" id="msRowCalendar" onclick="openSettings(\'calendar\')"><span class="ms-row-text"><span class="ms-row-label">Calendar sync</span></span><span class="ms-row-chev">›</span></button>' +
        '<button class="ms-row" onclick="openSettings(\'data\')"><span class="ms-row-text"><span class="ms-row-label">Data &amp; privacy</span><span class="ms-row-sub">Export · import · bug report</span></span><span class="ms-row-chev">›</span></button>' +
      '</div>' +
      // Sign out (signed-in only — toggled in renderMembershipInfo)
      '<button id="signOutRow" class="ms-signout" onclick="if(typeof confirmSignOut===\'function\')confirmSignOut();else if(typeof clearToken===\'function\')clearToken()" style="display:none">Sign out</button>' +
      '<div class="insights-section">' +
        '<div class="insights-title">Instructor rankings and favourites</div>' +
        '<div class="tier-group-label">Ranked</div>' +
        '<div class="tier-list tier-list-short" id="tierListRanked"></div>' +
        '<div class="tier-group-label" style="margin-top:16px">Not yet ranked</div>' +
        '<div class="tier-list tier-list-short" id="tierListUnranked"></div>' +
        '<div class="tier-group-label" style="margin-top:16px">Search all instructors</div>' +
        '<input class="tier-search" id="tierSearch" placeholder="Type a name…" oninput="filterTierList()">' +
        '<div class="tier-list" id="tierListSearch" style="display:none"></div>' +
      '</div>' +
      '<div class="about-block">' +
        '<div class="about-mark">PSYNC</div>' +
        '<div class="about-text">An independent companion for Psycle London members.<br>Not affiliated with, or endorsed by, Psycle.</div>' +
      '</div>';

    // Wrap all panels in tab-content
    var tabContent = document.createElement('div');
    tabContent.className = 'tab-content';
    tabContent.setAttribute('role', 'main'); // the page has no <main>: a landmark to jump to past the header and tab bar
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
    renderUsualWeekCard();
  }

  window.switchTab = function (tab, noHash) {
    _currentTab = tab;
    var btns = document.querySelectorAll('.tab-btn');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
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
    // All four panels share ONE scroller, so an offset kept from a taller tab
    // opens the next one mid-page, or clamped to its very bottom. Which
    // scroller depends on width: at <=640px the body is overflow:hidden and
    // .tab-content scrolls (window.scrollTo alone did nothing on iPhone);
    // wider, it is the document and .tab-content's scrollTop is already 0.
    window.scrollTo(0, 0);
    var tabScroller = document.querySelector('.tab-content');
    if (tabScroller) tabScroller.scrollTop = 0;
    // Bug-report trail. Logged here: reliability.js's switchTab hook looked
    // for this function before this file had loaded, so it never installed.
    if (typeof window.pushAction === 'function') window.pushAction('tab:switch to=' + tab);
    if (!noHash) {
      history.replaceState(null, '', '#' + tab);
    }
    if (tab === 'discover') {
      renderWeekView();
      // A lit date pill restored while another tab was up could not be brought
      // into view — its row measured 0 (app.js _revealActiveDatePill left this
      // note). Now it is laid out: once, never on later visits (the row may
      // have been scrolled by hand since).
      if (window._datePillRevealOwed) {
        window._datePillRevealOwed = false;
        if (typeof _revealActiveDatePill === 'function') _revealActiveDatePill();
      }
      // The day strip the same way: a resume re-rendered Discover while another
      // tab was up, and a strip with no layout box could not take its scroll
      // offset back (app.js _paintDayStrip left this note) — the selected day
      // sat out of sight. Once, like the date row.
      if (window._dayStripRevealOwed) {
        window._dayStripRevealOwed = false;
        if (typeof _restoreDayStrip === 'function') _restoreDayStrip();
      }
      // The Filters bar's chips can name a RANK ("S/A"), and a rank changed on
      // Membership has no event to follow: re-read them on the way back in
      // (no DOM write when nothing changed).
      if (typeof updateFiltersSummary === 'function') updateFiltersSummary();
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

  // Is this held class still to come? The My Bookings list's own test (app.js:
  // start_at is London wall clock, and a time nothing can place has NOT
  // started). The badge and the Stats count parsed it device-locally and, once
  // the list stopped doing so, contradicted it on the same screen: abroad, a
  // blank badge over a list of one — or a class counted for hours after the
  // list had filed it under past.
  function _stillToCome(startAt, now) {
    return (typeof _classHasStarted === 'function' && typeof _gymClassStartMs === 'function')
      ? !_classHasStarted(startAt, now.getTime(), _gymClassStartMs)
      : new Date(startAt) > now;
  }

  function updateTabBadge() {
    var badge = document.getElementById('tabBadge');
    if (!badge) return;
    var now = new Date();
    var all = _myBookings || {};
    // Classes you actually hold a seat in — waitlist places aren't counted.
    var count = Object.keys(all).filter(function (evtId) {
      if (all[evtId] && all[evtId].waitlisted) return false;
      var evt = (_eventCache || {})[evtId];
      return evt && _stillToCome(evt.start_at, now);
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
    // Waitlist places show on the planner (as "WL") but not in the badge.
    ['waitlist:joined', 'waitlist:left'].forEach(function (evt) {
      PsycleEvents.on(evt, function () { updateTabBadge(); renderWeekView(); });
    });
    // Session changes (popup sign-in, sign-out, expiry, can't-reach-Psycle) and
    // fresh /profile numbers. Membership's renderers are private to this IIFE
    // and only ran inside switchTab, so the tab kept its sign-in hero after a
    // sign-in — and the previous account's plan card after a sign-out. Sign-out
    // also empties _myBookings WITHOUT a bookings:loaded (see clearToken), so
    // the badge and planner need this cue too.
    var _repaintMembership = function () {
      if (_currentTab !== 'membership') return;
      renderMembershipInfo();
      renderCostTracker();
    };
    PsycleEvents.on('auth:changed', function () {
      updateTabBadge();
      renderWeekView();
      _repaintMembership();
      if (_currentTab === 'membership' && typeof filterTierList === 'function') filterTierList();
      // Stats' hero follows the session too, and a sign-out has no
      // bookings:loaded to repaint it.
      if (_currentTab === 'stats') renderInsights();
    });
    PsycleEvents.on('profile:updated', _repaintMembership);
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

  // ── Stats sub-pages ─────────────────────────────────────────────
  // Stats was one scroll of thirteen sections. It is three pages behind a
  // segmented switcher now, grouped the way a member would name them:
  // how much · when and what · who.

  // ── pure:stats-pages:start ── (DOM-free; tests/suites/8c-stats-pages.js evaluates this block)
  // THE grouping. initTabs builds the pages from it, the switcher and the lazy
  // paint read it: moving a section is an edit to this table and nothing else.
  //  · Overview    — the Crisp Colour Stats board, in its order: all time with
  //                  this month and upcoming, the week streak, "When you
  //                  train", class types, the year wrap, share.
  //  · Habits      — what repeats, each with its action: usual slots, routine.
  //  · Instructors — who: the map, variety (unique INSTRUCTORS per month),
  //                  lapsed favourites, and the two suggestion rows.
  var STATS_PAGES = [
    { id: 'overview', label: 'Overview', tab: 'statsTabOverview', panel: 'statsPageOverview',
      sections: ['statsBar', 'streakSection', 'heatmapSection', 'classTypeSection', 'yearReviewSection', 'shareSection'] },
    { id: 'habits', label: 'Habits', tab: 'statsTabHabits', panel: 'statsPageHabits',
      sections: ['habitSection', 'recoSection'] },
    { id: 'instructors', label: 'Instructors', tab: 'statsTabInstructors', panel: 'statsPageInstructors',
      sections: ['exploreMapSection', 'varietySection', 'lapsedSection', 'exploreLikeSection', 'exploreNewSection'] },
  ];
  var STATS_PAGE_DEFAULT = 'overview';
  var STATS_PAGE_KEY = 'psycle_stats_page'; // sessionStorage: the page last opened, this session only

  function _statsPageById(id) {
    for (var i = 0; i < STATS_PAGES.length; i++) if (STATS_PAGES[i].id === id) return STATS_PAGES[i];
    return null;
  }
  // Whatever was stored or passed in → a real page id. Anything else (nothing
  // stored: a fresh launch; an id from another build) is Overview.
  function _statsPageId(raw) {
    return _statsPageById(raw) ? raw : STATS_PAGE_DEFAULT;
  }
  function _statsPageOfSection(sectionId) {
    for (var i = 0; i < STATS_PAGES.length; i++) {
      if (STATS_PAGES[i].sections.indexOf(sectionId) !== -1) return STATS_PAGES[i].id;
    }
    return null;
  }
  // A key pressed in the tab list → the page to move to, or null when the key
  // is not the tab list's. Left / Right wrap round; Home / End jump to the ends.
  function _statsPageForKey(currentId, key) {
    var at = STATS_PAGES.indexOf(_statsPageById(_statsPageId(currentId)));
    var n = STATS_PAGES.length;
    if (key === 'ArrowRight') return STATS_PAGES[(at + 1) % n].id;
    if (key === 'ArrowLeft') return STATS_PAGES[(at - 1 + n) % n].id;
    if (key === 'Home') return STATS_PAGES[0].id;
    if (key === 'End') return STATS_PAGES[n - 1].id;
    return null;
  }
  // The neighbour a horizontal swipe leads to (dir: +1 = next, -1 = previous).
  // Unlike the keys it does NOT wrap: a swipe past the last page goes nowhere.
  function _statsPageStep(currentId, dir) {
    var at = STATS_PAGES.indexOf(_statsPageById(_statsPageId(currentId))) + (dir < 0 ? -1 : 1);
    return (at >= 0 && at < STATS_PAGES.length) ? STATS_PAGES[at].id : null;
  }
  // Is there nothing on this page? `shown` maps a section id to true while
  // that section is displayed — whoever displayed it (tabs.js, explore.js).
  function _statsPageIsEmpty(id, shown) {
    var page = _statsPageById(id);
    if (!page) return false;
    return !page.sections.some(function (sid) { return !!(shown && shown[sid]); });
  }
  // What a page with nothing on it says: ONE line — never a blank page, never a
  // paragraph. null = the page has content. `sync`: also offer the history
  // sync — only to a member who holds a session, has never synced, and is not
  // already looking at the banner above the switcher making the same offer.
  function _statsEmptyState(id, shown, o) {
    if (!_statsPageIsEmpty(id, shown)) return null;
    o = o || {};
    return { line: 'Nothing here yet.', sync: !!o.hasToken && !o.synced && !o.bannerUp };
  }
  // Where the scroller goes when a page opens. A new page starts at its top —
  // but the switcher must not leave the thumb that just tapped it: scrolled
  // past the point where it pins, go back to exactly that point (the page's
  // first section right under it); above that point nothing moves at all.
  // `pageTop`: the page's offset in the scrolled content; `pinTop`: what the
  // switcher pins beneath (0 on a phone, the sticky tab bar when wider).
  function _statsScrollTarget(current, pageTop, barHeight, pinTop) {
    var pin = Math.max(0, Math.round((Number(pageTop) || 0) - (Number(barHeight) || 0) - (Number(pinTop) || 0)));
    return Math.min(Math.max(0, Number(current) || 0), pin);
  }
  // ── pure:stats-pages:end ──

  // The page on screen. Remembered for the session, so coming back to Stats
  // (or a reload) reopens it; a fresh launch has nothing stored → Overview.
  var _statsPageNow = (function () {
    try { return _statsPageId(sessionStorage.getItem(STATS_PAGE_KEY)); } catch (e) { return STATS_PAGE_DEFAULT; }
  })();
  // Pages built since the last renderInsights(): a page is built when it is
  // first opened, and not again until the data is looked at afresh.
  var _statsPainted = {};
  // Signed out / can't-reach-Psycle with nothing on record: the hero has the tab.
  var _statsHeroOnly = false;

  // Which function fills which section. The three explore sections are
  // explore.js's (renderExplore); #shareSection is shown or hidden by
  // renderInsights itself.
  var _STATS_SECTION_PAINT = {
    statsBar: renderQuickStats,
    streakSection: renderStreaks,
    yearReviewSection: renderYearReview,
    habitSection: renderHabitSlots,
    recoSection: renderRecommendations,
    heatmapSection: renderHeatmap,
    classTypeSection: renderClassTypeDistribution,
    varietySection: renderVarietyTrend,
    lapsedSection: renderLapsedFavourites,
  };

  // The switcher and the three page wrappers, from the table above. A real tab
  // list: role=tab buttons with a roving tabindex, each naming its tabpanel.
  function _statsPagesHtml(sectionHtml, current) {
    var tabs = '', pages = '';
    STATS_PAGES.forEach(function (p) {
      var on = p.id === current;
      tabs += '<button type="button" class="stats-switcher-tab" role="tab" id="' + p.tab + '" data-stats-page="' + p.id + '"' +
        ' aria-selected="' + (on ? 'true' : 'false') + '" aria-controls="' + p.panel + '" tabindex="' + (on ? '0' : '-1') + '"' +
        ' onclick="showStatsPage(\'' + p.id + '\')">' + p.label + '</button>';
      pages += '<div id="' + p.panel + '" class="stats-page" role="tabpanel" aria-labelledby="' + p.tab + '"' + (on ? '' : ' hidden') + '>' +
        p.sections.map(function (sid) { return sectionHtml[sid] || ''; }).join('') +
        '<div class="stats-page-empty" hidden></div>' +
      '</div>';
    });
    return '<div class="stats-switcher-bar"><div id="statsSwitcher" class="stats-switcher" role="tablist" aria-label="Stats pages">' + tabs + '</div></div>' + pages;
  }

  // Once, from initTabs. Arrow / Home / End move along the tab list (selection
  // follows focus — a page opens at once and costs nothing to leave). And a
  // page is "empty" when every section on it is hidden, whoever hid it:
  // explore.js shows and hides its three after renderInsights has run, so the
  // sections' own style attribute is watched rather than any one caller trusted.
  function _wireStatsPages(panel) {
    var switcher = panel.querySelector('#statsSwitcher');
    if (switcher) {
      switcher.addEventListener('keydown', function (e) {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        var to = _statsPageForKey(_statsPageNow, e.key);
        if (!to) return;
        e.preventDefault();
        window.showStatsPage(to);
        var tab = document.getElementById(_statsPageById(to).tab);
        if (tab) tab.focus();
      });
    }
    if (typeof MutationObserver !== 'function') return;
    var watch = new MutationObserver(function () { _syncStatsEmpty(); });
    var watched = ['exploreSyncSection']; // the banner too: while it offers the sync, an empty page does not
    STATS_PAGES.forEach(function (p) { watched = watched.concat(p.sections); });
    watched.forEach(function (sid) {
      var el = panel.querySelector('#' + sid);
      if (el) watch.observe(el, { attributes: true, attributeFilter: ['style'] });
    });
  }

  // Build the sections of one page, unless they were built since the last
  // renderInsights(). explore.js keeps its own dirty flag and does nothing
  // while its page is closed — so it is asked again here, EVERY time its page
  // opens (and only while Stats is up: renderInsights also runs behind other
  // tabs). Not behind the built-already guard: /instructors landing, or a
  // booking made from a sheet, while another page was open left explore.js
  // dirty — and "Loading instructors…" stayed up until the member left Stats.
  // renderExplore returns at once when nothing changed.
  function _paintStatsPage(id) {
    var page = _statsPageById(id);
    if (!page) return;
    var explore = page.sections.some(function (sid) { return !_STATS_SECTION_PAINT[sid] && sid.indexOf('explore') === 0; });
    if (!_statsPainted[id]) {
      _statsPainted[id] = true;
      page.sections.forEach(function (sid) { if (_STATS_SECTION_PAINT[sid]) _STATS_SECTION_PAINT[sid](); });
    }
    if (explore && _currentTab === 'stats' && typeof renderExplore === 'function') renderExplore();
  }

  // Selected tab, roving tabindex, and which page is displayed.
  function _applyStatsPage() {
    var bar = document.querySelector('#tab-stats .stats-switcher-bar');
    if (bar) bar.hidden = _statsHeroOnly;
    STATS_PAGES.forEach(function (p) {
      var on = p.id === _statsPageNow;
      var tab = document.getElementById(p.tab);
      if (tab) {
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
      }
      var panel = document.getElementById(p.panel);
      if (panel) panel.hidden = _statsHeroOnly || !on;
    });
  }

  // The one quiet line of a page with nothing on it (pure:stats-pages decides).
  function _syncStatsEmpty() {
    var page = _statsPageById(_statsPageNow);
    var panel = page && document.getElementById(page.panel);
    var slot = panel && panel.querySelector('.stats-page-empty');
    if (!slot) return;
    var shown = {};
    page.sections.forEach(function (sid) {
      var el = document.getElementById(sid);
      shown[sid] = !!el && el.style.display !== 'none';
    });
    var banner = document.getElementById('exploreSyncSection');
    var synced = false;
    try { synced = !!localStorage.getItem('psycle_history_synced'); } catch (e) {}
    var state = _statsHeroOnly ? null : _statsEmptyState(page.id, shown, {
      hasToken: typeof getBearerToken === 'function' && !!getBearerToken(),
      synced: synced,
      bannerUp: !!banner && banner.style.display !== 'none' && !!banner.firstChild,
    });
    var html = !state ? '' : '<p class="stats-page-empty-line">' + escapeHTML(state.line) + '</p>' +
      (state.sync && typeof window._explore_syncHistory === 'function'
        ? '<button type="button" class="explore-sync-btn explore-sync-btn-secondary" onclick="window._explore_syncHistory()">Sync my history</button>' : '');
    if (slot._lastHtml !== html) { slot.innerHTML = html; slot._lastHtml = html; }
    slot.hidden = !state;
  }

  // Wider than a phone the document scrolls and the tab bar is what sticks to
  // the top: the switcher pins beneath it, however tall the font makes it. On a
  // phone the bar is docked to the bottom and .tab-content scrolls → 0.
  function _syncStatsPin() {
    var bar = document.querySelector('#tab-stats .stats-switcher-bar');
    var tabBar = document.querySelector('.tab-bar');
    if (!bar || !tabBar || typeof getComputedStyle !== 'function') return;
    var top = getComputedStyle(tabBar).position === 'sticky' ? tabBar.offsetHeight : 0;
    bar.style.setProperty('--stats-pin-top', top + 'px');
  }
  window.addEventListener('resize', function () { if (_currentTab === 'stats') _syncStatsPin(); });

  // The DOM half of _statsScrollTarget. Which scroller: .tab-content on a phone
  // (css/tabs.css makes it the scroller at <=640px), the document when wider.
  function _scrollToStatsPageTop(page) {
    var bar = document.querySelector('#tab-stats .stats-switcher-bar');
    var panel = document.getElementById(page.panel);
    var scroller = document.querySelector('.tab-content');
    // Only while Stats is up: behind another tab the page measures nothing, and
    // the scroller's offset belongs to that tab.
    if (!bar || !panel || !scroller || _statsHeroOnly || _currentTab !== 'stats' || typeof getComputedStyle !== 'function') return;
    var pinTop = parseFloat(bar.style.getPropertyValue('--stats-pin-top')) || 0;
    var top = panel.getBoundingClientRect().top;
    if (/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      var at = scroller.scrollTop;
      var to = _statsScrollTarget(at, top - scroller.getBoundingClientRect().top + at, bar.offsetHeight, pinTop);
      if (to !== at) scroller.scrollTop = to;
    } else {
      var y = window.scrollY || 0;
      var toY = _statsScrollTarget(y, top + y, bar.offsetHeight, pinTop);
      if (toY !== y) window.scrollTo(0, toY);
    }
  }

  // renderInsights' half of the pages: every call is a fresh look at the data,
  // so nothing built before it is trusted — and only the page on screen is
  // built now; the other two when they are first opened.
  function _syncStatsPages(heroOnly) {
    _statsHeroOnly = !!heroOnly;
    _statsPainted = {};
    _applyStatsPage();
    _syncStatsPin();
    if (!_statsHeroOnly) _paintStatsPage(_statsPageNow);
    _syncStatsEmpty();
  }

  /**
   * Open one of the Stats sub-pages ('overview' | 'habits' | 'instructors').
   * The switcher's segments call it; so can anything else (a swipe helper:
   * _statsPageStep gives the neighbour). Returns false for an id it does not know.
   */
  window.showStatsPage = function (id) {
    var page = _statsPageById(id);
    if (!page) return false;
    var changed = page.id !== _statsPageNow;
    _statsPageNow = page.id;
    try { sessionStorage.setItem(STATS_PAGE_KEY, page.id); } catch (e) {}
    _applyStatsPage();
    if (!_statsHeroOnly) _paintStatsPage(page.id);
    _syncStatsEmpty();
    _scrollToStatsPageTop(page);
    if (changed) {
      if (typeof announce === 'function') announce(page.label);
      if (typeof window.pushAction === 'function') window.pushAction('stats:page to=' + page.id);
    }
    return true;
  };
  // For a swipe helper: the page a swipe in `dir` (+1 / -1) would open, or null.
  window._statsPageStep = function (dir) { return _statsPageStep(_statsPageNow, dir); };

  // Swipe left / right between the pages. js/interactions.js's _psycleSwipe
  // owns the gesture — the day pager's rules: clearly sideways, a quarter of
  // the width or a flick, never past an end, and a touch that starts in a row
  // that itself scrolls sideways (the tiles, the habit / streak cards, the
  // heatmap) stays that row's. Nothing follows the finger: only ONE page is
  // laid out at a time, so the release simply opens the neighbour, exactly as
  // a segment or an arrow key does (showStatsPage announces it and keeps the
  // pinned switcher where it is). The pages carry touch-action: pan-y
  // (css/tabs.css), so vertical scrolling stays the browser's.
  // May a touch on `target` become a page swipe? On a page — not the banner,
  // the hero or the switcher — with Stats on screen and nothing modal up.
  function _statsSwipeMayStart(target) {
    if (_statsHeroOnly || _currentTab !== 'stats') return false;
    if (!target || typeof target.closest !== 'function' || !target.closest('.stats-page')) return false;
    try {
      if (typeof _dialogOpen === 'function' && _dialogOpen()) return false;
      if (typeof _ownKeysOverlayUp === 'function' && _ownKeysOverlayUp()) return false;
      if (typeof _overlayStack !== 'undefined' && _overlayStack.length > 0) return false;
    } catch (e) { return false; }
    return true;
  }
  // Once, from initTabs — bound to the panel, which outlives every repaint of
  // its sections. interactions.js loads before this file; without it (a test
  // page, an old cached copy) the segments and the keys are still all there.
  function _wireStatsSwipe(panel) {
    if (!panel || typeof window._psycleSwipe !== 'function') return;
    window._psycleSwipe(panel, {
      shouldIgnore: function (target) { return !_statsSwipeMayStart(target); },
      edges: function () {
        return { prev: !!_statsPageStep(_statsPageNow, -1), next: !!_statsPageStep(_statsPageNow, 1) };
      },
      onEnd: function (r) {
        var to = r && r.dir && !r.cancelled ? _statsPageStep(_statsPageNow, r.dir) : null;
        if (to) window.showStatsPage(to);
      },
    });
  }

  // ── Render insights tab content ────────────────────────────────

  // One Stats paint asks getFullHistory() ~11 times (every section below) and
  // the string runs to 400 KB. Remembered against the raw string itself, so
  // every writer — a booking, the sync, an import, another tab — invalidates it
  // with no hook. Only a good parse is kept. Callers only read (filter /
  // forEach / some): they share the one array, so nothing here may sort or
  // push on it.
  var _historyRaw = null, _historyParsed = null;

  /**
   * Get the full class history from localStorage (synced + locally tracked).
   * Each entry has: { eventId, typeName, instrName, locName, date, cancelledAt? }
   */
  function getFullHistory() {
    var raw;
    try { raw = localStorage.getItem('psycle_class_history') || '[]'; } catch (e) { return []; }
    if (raw === _historyRaw) return _historyParsed;
    try {
      var parsed = JSON.parse(raw);
      _historyRaw = raw;
      // Coerced where it is read (app.js, pure:stored-data), like features.js
      // and explore.js — once per stored string, not once per reader.
      _historyParsed = typeof _cleanStoredHistory === 'function' ? _cleanStoredHistory(parsed) : parsed;
      return _historyParsed;
    } catch (e) { return []; }
  }

  // The stored token is only readable once security.js has decrypted it (on
  // iOS: after the Preferences restore). Until then "no token" proves nothing:
  // a first paint of Stats must not call a signed-in member signed out.
  var _tokenReadable = false;
  (window.securityReady || Promise.resolve()).then(function () {}, function () {}).then(function () {
    _tokenReadable = true;
    if (_currentTab === 'stats') window.renderInsights();
  });

  window.renderInsights = function () {
    // Signed-out with no data: one hero CTA instead of a page of stubs.
    // Hide actions that can only fail (share with nothing to share).
    var signedIn = (typeof currentUser !== 'undefined' && !!currentUser);
    var hasHistory = getFullHistory().some(function (h) { return !h.cancelledAt; });
    var statsEmpty = document.getElementById('statsEmpty');
    var shareSection = document.getElementById('shareSection');
    // Taken classes, not rows: history holds a booking from the moment it is
    // made, and "Share my stats" only draws classes TAKEN — after a first
    // booking the button was offered, and could only toast "No history to share yet".
    if (shareSection) shareSection.style.display = _hasTakenHistory() ? '' : 'none';
    // Signed OUT (no token at all — not "Psycle unreachable", which keeps the
    // member's own numbers up): the history on this device belongs to whoever
    // was last signed in, and must not be presented to the person now holding
    // it as their stats. The hero below takes the tab; css/tabs.css hides every
    // other section while the panel carries this class, whoever repaints them.
    var signedOut = _tokenReadable && !signedIn && !(typeof getBearerToken === 'function' && getBearerToken());
    var statsPanel = document.getElementById('tab-stats');
    if (statsPanel) statsPanel.classList.toggle('stats-signed-out', signedOut);
    if (statsEmpty) {
      if (signedOut || (!signedIn && !hasHistory)) {
        statsEmpty.style.display = '';
        statsEmpty.innerHTML =
          '<div class="tab-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20v-6M12 20V8M19 20V5"/></svg></div>' +
          '<div class="tab-empty-title">Your stats</div>' +
          '<div class="tab-empty-sub">Sign in to see your streaks, habits and instructors.</div>' +
          '<button class="tab-empty-btn" onclick="openLoginPopup()">Sign in</button>';
        // Token still stored but /profile unconfirmed: Retry, never "Sign in".
        var _gate = (typeof authGateHTML === 'function') ? authGateHTML() : '';
        if (_gate) statsEmpty.innerHTML = _gate;
      } else {
        statsEmpty.style.display = 'none';
      }
    }
    // The sections themselves: three sub-pages, of which only the one on screen
    // is built now (_syncStatsPages, above). While the hero has the tab — signed
    // out, or a kept token with nothing on record — there is no switcher either.
    _syncStatsPages(signedOut || (!signedIn && !hasHistory));
    renderCostTracker();
    renderWeekView();
  }

  // ── Quick Stats ────────────────────────────────────────────────

  function renderQuickStats() {
    var container = document.getElementById('statsBar');
    if (!container) return;

    var now = new Date();
    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    var history = getFullHistory();

    // Upcoming from current bookings (seats only — not waitlist places)
    var upcoming = 0;
    Object.entries(bookings).forEach(function (entry) {
      if (entry[1] && entry[1].waitlisted) return;
      var evt = cache[entry[0]];
      if (evt && _stillToCome(evt.start_at, now)) upcoming++;
    });

    // Use full history for aggregate stats
    var thisMonth = 0;
    var totalClasses = 0;
    var soloClasses = 0;
    var socialClasses = 0;
    var studioCount = {};
    var instrCount = {};

    // Classes TAKEN: history holds a booking from the moment it is made, so a
    // row still to come is "Upcoming" above — not also this month's and all
    // time's (the year wrap's own test, _takenRows).
    _takenRows(history, now.getTime(), _historyStartMs()).forEach(function (h) {
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

    // Also count current bookings not yet in history (seats only — a waitlist
    // place is not a class the user is in)
    Object.entries(bookings).forEach(function (entry) {
      if (entry[1] && entry[1].waitlisted) return;
      var evt = cache[entry[0]];
      if (!evt) return;
      // Held, not yet taken: counted under "Upcoming" only.
      if (_stillToCome(evt.start_at, now)) return;
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
    // Crisp Colour (the Stats board): ONE card with all time as the hero
    // numeral, this month and upcoming beside it; everything else is a quiet
    // tile underneath. Every figure keeps its .stat-value + .stat-label pair,
    // value first (tests and the old order of reading rely on it) — the hero
    // puts its label on top in css/crisp.css.
    var html =
      '<div class="stats-hero">' +
        '<div class="stat-card is-hero">' +
          '<div class="stat-value">' + totalClasses + '</div>' +
          '<div class="stat-label">All time</div>' +
        '</div>' +
        '<div class="stats-hero-side">' +
          '<div class="stat-card is-side">' +
            '<div class="stat-value">' + thisMonth + '</div>' +
            '<div class="stat-label">This month</div>' +
          '</div>' +
          '<div class="stat-card is-side">' +
            '<div class="stat-value">' + upcoming + '</div>' +
            '<div class="stat-label">Upcoming</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var more = '';
    // Solo vs Social breakdown
    if (socialClasses > 0) {
      more +=
        '<div class="stat-card is-tile">' +
          '<div class="stat-value">' + soloClasses + '</div>' +
          '<div class="stat-label">Solo</div>' +
        '</div>' +
        '<div class="stat-card is-tile">' +
          '<div class="stat-value">' + socialClasses + '</div>' +
          '<div class="stat-label">With a friend</div>' +
          '<div class="stat-detail">' + Math.round(socialClasses / totalClasses * 100) + '% of classes</div>' +
        '</div>';
    }

    more +=
      (favStudio ? '<div class="stat-card is-tile is-name">' +
        '<div class="stat-value">' + escapeHTML(favStudio[0]) + '</div>' +
        '<div class="stat-label">Top studio</div>' +
        '<div class="stat-detail">' + _plural(favStudio[1], 'class', 'classes') + '</div>' +
      '</div>' : '') +
      (favInstr ? '<div class="stat-card is-tile is-name">' +
        '<div class="stat-value">' + escapeHTML(favInstr[0]) + '</div>' +
        '<div class="stat-label">Top instructor</div>' +
        '<div class="stat-detail">' + _plural(favInstr[1], 'class', 'classes') + '</div>' +
      '</div>' : '');
    if (more) html += '<div class="stats-more">' + more + '</div>';

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
    // A picked day is no preset. Left alone, the mode from the last pill tap
    // is what saveFilters and the recent searches record for this date.
    if (typeof window._dateQuickMode !== 'undefined') window._dateQuickMode = null;
    if (typeof updateFiltersSummary === 'function') updateFiltersSummary();
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
      ' – ' + days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    // (The weekly-template buttons that used to sit here moved to the "Your
    // usual week" card in My Bookings — this grid is never mounted.)
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
        var timeStr = _clock24(dt.getHours(), dt.getMinutes()); // app.js (pure:clock): "18:30"
        var slotsCount = booking && booking.slots ? booking.slots.length : 0;
        var socialBadge = slotsCount > 1 ? '<span class="week-event-social" title="' + slotsCount + ' spots booked">+1</span>' : '';
        // A waitlist place is shown, but clearly not as a seat.
        var isPlace = !!(booking && booking.waitlisted);
        if (isPlace) socialBadge = '<span class="week-event-social week-event-wl" title="Waitlist place, not booked yet">WL</span>';

        html += '<div class="week-event' + (isPlace ? ' is-waitlisted' : '') + '" onclick="switchTab(\'bookings\')" title="' +
          escapeHTML(evt._typeName || '') + ' · ' + escapeHTML(evt._instrName || '') + (isPlace ? ' · waitlist' : '') + '">' +
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
        var ts = _clock24(dt.getHours(), dt.getMinutes());

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

  // ── Your usual week (weekly template — UI only) ────────────────
  // A compact card in My Bookings: save the classes ridden every week, then
  // book them together when the timetable opens. The engine is app.js
  // (planWeeklyTemplate only reads, bookWeeklyTemplate executes confirmed
  // picks); both live elsewhere, so guard every call and degrade with a toast.
  // The ONLY way to a booking from here is the sheet that lists each class.

  var UW_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // 'YYYY-MM-DD' → "Mon 21 Sep". The date is London's (app.js works it out
  // from the digits), so it is formatted as UTC — never shifted by the device.
  function _uwDateLabel(dateStr) {
    var p = String(dateStr || '').split('-').map(Number);
    if (p.length !== 3 || !p[0]) return '';
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]))
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function _uwPlural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ── pure:usual-week-crisp:start ── (DOM-free; tests/suites/9d-bookings.js evaluates this block)
  // The card and the sheet show each class as a COMPACT form of the class
  // component: pictogram tile in the class colour, day, a smaller time.

  // A template entry's label is "Type · Instructor" (app.js _templateFromSeats).
  // Only the type decides the colour: an instructor called Barrett is not Barre.
  function _uwTypeOf(label) {
    return String(label == null ? '' : label).split(' · ')[0];
  }

  // Minutes after midnight → "18:30", through app.js's one formatter (_clock24,
  // pure:clock). Stored junk reads as 00:00 — never NaN.
  function _uwTime(totalMin) {
    var min = Math.max(0, Math.round(Number(totalMin) || 0)) % 1440;
    return _clock24(Math.floor(min / 60), min % 60);
  }

  // The tile + data-ct of a class type. `keyOf` / `pictogram` are app.js's
  // classTypeKey / classPictogram; without them (tabs.js on its own) the row
  // simply has no tile and wears the neutral colour.
  function _uwClassMark(typeName, keyOf, pictogram) {
    var key = typeof keyOf === 'function' ? keyOf(typeName) : 'other';
    // It lands in an attribute: a lower-case word, whatever handed it over.
    key = String(key == null ? '' : key).toLowerCase().replace(/[^a-z]/g, '') || 'other';
    return {
      key: key,
      tile: typeof pictogram === 'function' ? '<span class="ct-tile is-sm" aria-hidden="true">' + pictogram(key, 15) + '</span>' : '',
    };
  }
  // ── pure:usual-week-crisp:end ──

  function _uwTimeHtml(totalMin) {
    return '<span class="t-time is-compact">' + _uwTime(totalMin) + '</span>';
  }

  function _uwMark(typeName) {
    return _uwClassMark(typeName,
      typeof classTypeKey === 'function' ? classTypeKey : null,
      typeof classPictogram === 'function' ? classPictogram : null);
  }

  function _usualWeekTemplate() {
    try {
      var arr = typeof window.loadWeeklyTemplate === 'function' ? window.loadWeeklyTemplate() : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  // Template entries from the REAL seats held over the next 7 days (it used to
  // read the week shown in the Discover planner, which is no longer mounted).
  // Each entry is the booking-independent "shape" of a class: weekday/time +
  // the IDs needed to find it again. The work is app.js's pure helper.
  function _collectDisplayedWeekTemplate() {
    if (typeof _templateFromSeats !== 'function' || typeof _templateLondonNow !== 'function') return [];
    return _templateFromSeats(_myBookings || {}, _eventCache || {}, _templateLondonNow(Date.now()),
      typeof _templateLocationIdFor === 'function' ? _templateLocationIdFor : null);
  }

  // Nothing booked this week (a holiday, or the first Monday with the app):
  // fall back to the slots history shows 2+ times. Only ones that can be found
  // again — a class type AND a location — and few enough to read at a glance.
  function _usualWeekFromHistory() {
    if (typeof window.detectRecurringSlots !== 'function') return [];
    var out = [];
    try {
      window.detectRecurringSlots().forEach(function (c) {
        if (c.eventTypeId == null || c.locationId == null || out.length >= 6) return;
        out.push({
          dayOfWeek: c.dayOfWeek, hour: c.hour, minute: c.minute,
          locationId: c.locationId, eventTypeId: c.eventTypeId, instructorId: c.instructorId,
          label: c.label, locName: c.locName || '',
        });
      });
    } catch (e) { return []; }
    return out.sort(function (a, b) {
      // Monday-first ordering, then time of day.
      var ai = (a.dayOfWeek + 6) % 7, bi = (b.dayOfWeek + 6) % 7;
      if (ai !== bi) return ai - bi;
      return (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute);
    });
  }

  function _uwLog(action) {
    if (typeof pushAction === 'function') { try { pushAction(action); } catch (e) {} }
  }

  window.saveWeekAsTemplate = async function () {
    if (typeof window.saveWeeklyTemplate !== 'function') {
      toast('Your usual week can\'t be saved right now', 'info');
      return;
    }
    var entries = _collectDisplayedWeekTemplate();
    var fromHistory = false;
    if (entries.length === 0) {
      entries = _usualWeekFromHistory();
      fromHistory = entries.length > 0;
    }
    if (entries.length === 0) {
      toast('Book your regular classes first, then save them as your usual week', 'info');
      return;
    }
    // Saving over a list the member built (and pruned) is not a silent act.
    var existing = _usualWeekTemplate();
    if (existing.length && typeof confirmModal === 'function') {
      var ok = await confirmModal({
        title: 'Replace your usual week?',
        body: 'Your saved ' + _uwPlural(existing.length, 'class', 'classes') + ' will be replaced by ' +
          (fromHistory ? 'the ' + _uwPlural(entries.length, 'regular class', 'regular classes') + ' in your history.'
            : 'the ' + _uwPlural(entries.length, 'class', 'classes') + ' you hold over the next 7 days.'),
        confirmText: 'Replace',
        cancelText: 'Keep it',
      });
      if (!ok) return;
    }
    try {
      window.saveWeeklyTemplate(entries);
      _uwLog('usual-week:save');
      toast(fromHistory
        ? 'Saved ' + _uwPlural(entries.length, 'regular class', 'regular classes') + ' from your history. Remove any you no longer take.'
        : 'Saved ' + _uwPlural(entries.length, 'class', 'classes') + ' as your usual week', 'success');
      renderUsualWeekCard();
      // [13c] iOS app only (native-bridge.js defines it): offer the Monday 12:00 reminder, once.
      if (typeof window._offerWeeklyReminder === 'function') window._offerWeeklyReminder('usual-week-saved');
    } catch (e) {
      console.error('[template] save failed:', e);
      toast('Couldn\'t save your usual week', 'error');
    }
  };

  // The card's own handlers (window.clearWeeklyTemplate is app.js's storage call).
  window.clearUsualWeek = async function () {
    if (typeof window.clearWeeklyTemplate !== 'function') return;
    if (typeof confirmModal === 'function') {
      var ok = await confirmModal({
        title: 'Clear your usual week?',
        body: 'This only forgets the saved list. Your bookings are not touched.',
        confirmText: 'Clear',
        cancelText: 'Keep it',
        danger: true,
      });
      if (!ok) return;
    }
    window.clearWeeklyTemplate();
    _uwLog('usual-week:clear');
    toast('Usual week cleared', 'info');
    renderUsualWeekCard();
  };

  window.removeUsualWeekEntry = function (idx) {
    if (typeof window.saveWeeklyTemplate !== 'function') return;
    var list = _usualWeekTemplate();
    if (!(idx >= 0 && idx < list.length)) return;
    list.splice(idx, 1);
    if (list.length) window.saveWeeklyTemplate(list);
    else if (typeof window.clearWeeklyTemplate === 'function') window.clearWeeklyTemplate();
    renderUsualWeekCard();
  };

  // Right after #rebookHint — a node app.js removes and re-creates in front of
  // #upcomingPanel whenever it likes. And never two "book your regulars" cards:
  // with a saved week this card is the richer one, so the single-class hint
  // (which says the same thing again) steps aside.
  function _placeUsualWeekCard(card) {
    var hint = document.getElementById('rebookHint');
    if (!hint || hint.parentNode !== card.parentNode) return;
    if (hint.nextElementSibling !== card) hint.parentNode.insertBefore(card, hint.nextSibling);
    hint.style.display = card.classList.contains('has-template') ? 'none' : '';
  }

  // The hint is re-made outside any event this module hears (first paint), so
  // watch the tab's own children — not its subtree — and re-seat the card.
  // Re-seating is idempotent, so the move it causes ends the loop it starts.
  var _usualWeekWatch = null;
  function _watchUsualWeekPlacement(card) {
    if (_usualWeekWatch || typeof MutationObserver !== 'function' || !card.parentNode) return;
    _usualWeekWatch = new MutationObserver(function () { _placeUsualWeekCard(card); });
    _usualWeekWatch.observe(card.parentNode, { childList: true });
  }

  // ── pure:usual-week-card:start ── (DOM-free; tests/suites/14b-usual-week-card.js evaluates this block)
  // The card is a DISCLOSURE. Its head — "Your usual week" over "4 classes ·
  // Hide", with the ONE primary beside it — is the same in both states, so
  // nothing moves under a thumb; collapsed, the head is all there is, and
  // "Review and book" is still one tap away. Below it, #usualWeekBody: the
  // entries and the two quiet actions (Update from my bookings · Clear).

  var UW_COLLAPSED_KEY = 'psycle_usual_week_collapsed';

  // Stored '1' = collapsed; anything else there (absent, junk, an import's
  // "true") = expanded. What the member did in THIS page session (`mem`: true /
  // false; null = nothing yet) wins, so the card still folds where storage is
  // blocked or full.
  function _uwCollapsedFrom(stored, mem) {
    if (mem === true || mem === false) return mem;
    return stored === '1';
  }

  // How many seats an entry books: an integer 1–4 (Psycle's own limit per
  // booking); anything else stored there reads as 1. The card only SAYS it —
  // seats are chosen and confirmed in the review sheet, never here.
  function _uwCardSeats(value) {
    return (typeof value === 'number' && value % 1 === 0 && value >= 1 && value <= 4) ? value : 1;
  }

  // The word that shows the head is a control (no chevron: the Filters bar's rule).
  function _uwToggleWord(collapsed) { return collapsed ? 'Show' : 'Hide'; }

  // The whole card for a saved week. The state is said in exactly TWO places —
  // aria-expanded and the Show / Hide word — which is all toggleUsualWeek has to
  // flip in place (plus .is-collapsed on the container, which is not in here).
  // Every name in it is stored (or API) text: escaped.
  function _uwCardHtml(template, collapsed) {
    var rows = template.map(function (en, i) {
      if (!en || typeof en !== 'object') en = {}; // stored junk: a row the member can still remove, never a throw
      var min = (Number(en.hour) || 0) * 60 + (Number(en.minute) || 0);
      var day = UW_DAYS[Number(en.dayOfWeek)] || '';
      var when = day + ' ' + _uwTime(min); // as words, for the remove button's name
      var label = String(en.label || 'Class');
      var seats = _uwCardSeats(en.seats);
      // A compact class component: tile, day, a smaller time — tinted by type.
      var mark = _uwMark(_uwTypeOf(label));
      return '<li class="usual-week-entry ct-card" data-ct="' + mark.key + '">' +
        mark.tile +
        '<span class="usual-week-when"><span class="usual-week-day">' + escapeHTML(day) + '</span>' + _uwTimeHtml(min) + '</span>' +
        '<span class="usual-week-what">' + escapeHTML(label) +
          // More than one seat LEADS the second line: the ellipsis takes the end of a line, and the count must never be what it eats.
          (seats > 1 ? '<span class="usual-week-seats"><span class="usual-week-sep"> · </span>' + _uwPlural(seats, 'spot', 'spots') + '</span>' : '') +
          // The separator has a span of its own: the card puts the studio on a second line (styles.css), where it is dropped.
          (en.locName ? '<span class="usual-week-where"><span class="usual-week-sep"> · </span>' + escapeHTML(en.locName) + '</span>' : '') + '</span>' +
        '<button type="button" class="usual-week-remove" onclick="removeUsualWeekEntry(' + i + ')" aria-label="' +
          escapeHTML('Remove ' + when + ' ' + label + ' from your usual week') + '">×</button>' +
      '</li>';
    }).join('');
    // The head: a real heading that IS the disclosure button (the accordion
    // pattern). Its name is its text — "Your usual week, 4 classes, Hide" — and
    // its state is aria-expanded; the dot between the two is decoration.
    return '<div class="usual-week-head">' +
        '<h2 class="usual-week-eyebrow t-heading">' +
          '<button type="button" class="usual-week-toggle" aria-expanded="' + (collapsed ? 'false' : 'true') + '" aria-controls="usualWeekBody" onclick="toggleUsualWeek()">' +
            '<span class="usual-week-title">Your usual week</span>' +
            '<span class="usual-week-meta"><span class="usual-week-count">' + _uwPlural(template.length, 'class', 'classes') + '</span>' +
              // (the spaces stay OUTSIDE the hidden dot, or the name runs the two together: "4 classesHide")
              ' <span class="usual-week-dot" aria-hidden="true">·</span> <span class="usual-week-toggle-word">' + _uwToggleWord(collapsed) + '</span></span>' +
          '</button>' +
        '</h2>' +
        // The ONE primary, in the head in BOTH states. It opens the review sheet —
        // nothing is booked by pressing it — and its label says so.
        '<button type="button" class="week-template-btn week-template-book pill-btn pill-primary" onclick="bookTemplateWeek()" aria-label="Review and book your usual week">Review and book</button>' +
      '</div>' +
      '<div class="usual-week-body" id="usualWeekBody">' +
        '<ul class="usual-week-list">' + rows + '</ul>' +
        // Two quiet actions share a phone's row (a third wrapped onto a line of its
        // own — one more reason the primary lives in the head). "Clear" is named
        // for what it clears: down here the bare word follows a list, not a title.
        '<div class="usual-week-actions">' +
          '<button type="button" class="week-template-btn pill-btn pill-quiet" onclick="saveWeekAsTemplate()">Update from my bookings</button>' +
          '<button type="button" class="week-template-btn pill-btn pill-quiet usual-week-clear" onclick="clearUsualWeek()" aria-label="Clear your usual week">Clear</button>' +
        '</div>' +
      '</div>';
  }
  // ── pure:usual-week-card:end ──

  // Collapsed or not: localStorage psycle_usual_week_collapsed ('1' | absent),
  // read at every paint — never cached: in the iOS app the first paint can come
  // before the Preferences restore — and read defensively (a blocked store is
  // simply "expanded").
  var _uwCollapsedMem = null;
  function _uwIsCollapsed() {
    var stored = null;
    try { stored = localStorage.getItem(UW_COLLAPSED_KEY); } catch (e) {}
    return _uwCollapsedFrom(stored, _uwCollapsedMem);
  }
  function _uwRememberCollapsed(collapsed) {
    _uwCollapsedMem = collapsed;
    try {
      if (!collapsed) localStorage.removeItem(UW_COLLAPSED_KEY);
      else if (typeof window._psycleSafeSetItem === 'function') window._psycleSafeSetItem(UW_COLLAPSED_KEY, '1');
      else localStorage.setItem(UW_COLLAPSED_KEY, '1');
    } catch (e) {}
  }

  // The head's button. IN PLACE — no repaint: the button that was pressed stays
  // the same node, so it keeps the focus (and a screen reader's cursor), and its
  // own state — aria-expanded — is what announces the change. No toast, no
  // scroll, no search.
  window.toggleUsualWeek = function () {
    var card = document.getElementById('usualWeekCard');
    var btn = card && card.querySelector('.usual-week-toggle');
    if (!btn) return; // the invitation (nothing saved yet) does not fold
    var template = _usualWeekTemplate();
    // What is ON SCREEN decides, not what is stored: a press always flips what
    // the member is looking at (another tab may have changed the key since).
    var collapsed = btn.getAttribute('aria-expanded') !== 'false';
    // Was the card showing exactly what the builder prints? Then after the flip
    // it still is, and the next background repaint has nothing to write.
    var inStep = card._uwHtml === _uwCardHtml(template, !collapsed);
    _uwRememberCollapsed(collapsed);
    card.classList.toggle('is-collapsed', collapsed);
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var word = btn.querySelector('.usual-week-toggle-word');
    if (word) word.textContent = _uwToggleWord(collapsed);
    card._uwHtml = inStep ? _uwCardHtml(template, collapsed) : null;
    _uwLog('usual-week:' + (collapsed ? 'collapse' : 'expand'));
  };

  // Which of the card's buttons holds focus (-1: none), and putting it back on
  // the button in that place once the card has been repainted. Every repaint
  // replaces the buttons, and the one that had focus takes it to <body> — after
  // a usual-week run that is a certainty: the sheet hands focus back to "Review
  // and book", and the /bookings re-read behind the run repaints this card
  // (bookings:loaded) a moment later — a repaint that is now skipped while the
  // card has nothing new to say, so this is for the ones that do.
  function _uwFocusedButton(card, doc) {
    return Array.prototype.indexOf.call(card.querySelectorAll('button'), doc.activeElement);
  }
  function _uwRefocusButton(card, idx) {
    if (idx < 0) return;
    var btns = card.querySelectorAll('button');
    var btn = btns[Math.min(idx, btns.length - 1)]; // an entry was removed: the one now in its place
    // preventScroll: a background repaint must not move the page.
    if (btn && typeof btn.focus === 'function') { try { btn.focus({ preventScroll: true }); } catch (e) {} }
  }

  function renderUsualWeekCard() {
    var card = document.getElementById('usualWeekCard');
    if (!card) return;
    _watchUsualWeekPlacement(card);
    var signedIn = typeof currentUser !== 'undefined' && !!currentUser;
    var template = signedIn ? _usualWeekTemplate() : [];
    card.classList.toggle('has-template', template.length > 0);
    var focusedIdx = _uwFocusedButton(card, document);

    // Only a saved week folds: the invitation below is one line already.
    var collapsed = template.length > 0 && _uwIsCollapsed();
    card.classList.toggle('is-collapsed', collapsed);
    var html = '';

    if (template.length) {
      // Head (the disclosure + the one primary) over the body it folds away: pure:usual-week-card.
      html = _uwCardHtml(template, collapsed);
    } else if (signedIn && (_collectDisplayedWeekTemplate().length || _usualWeekFromHistory().length)) {
      // Nothing saved yet: a one-line invitation, not a second card under the hint.
      html =
        '<div class="usual-week-invite">' +
          '<span class="usual-week-invite-text">Same classes every week? Save them once, then book them together.</span>' +
          '<button type="button" class="week-template-btn pill-btn pill-outline" onclick="saveWeekAsTemplate()">Save my usual week</button>' +
        '</div>';
    }
    // This runs on every bookings:loaded / booking / auth event, nearly always
    // with nothing new to say. What is already on the card is not written again:
    // the buttons stay the same nodes — focus, a screen reader's cursor and a
    // finger already down on one all survive. (_uwHtml is the string last
    // written, kept on the node: innerHTML reads back normalised.)
    if (card._uwHtml !== html) {
      card.innerHTML = html;
      card._uwHtml = html;
    }
    card.style.display = html ? '' : 'none';
    _placeUsualWeekCard(card);
    _uwRefocusButton(card, focusedIdx); // after placement: moving a node drops its focus too
  }
  window.renderUsualWeekCard = renderUsualWeekCard;

  // Same cues as the rebook hint (registered later, so this runs after it has
  // re-made its node), plus a cancelled seat and the session: the invitation
  // depends on the seats held, the whole card on being signed in.
  if (typeof PsycleEvents !== 'undefined') {
    ['bookings:loaded', 'booking:complete', 'booking:cancelled', 'seat:cancelled', 'auth:changed'].forEach(function (evt) {
      PsycleEvents.on(evt, function () { try { renderUsualWeekCard(); } catch (e) {} });
    });
  }

  // ── pure:usual-week-sheet:start ── (DOM-free; tests/suites/14a-usual-week-sheet.js evaluates this block)
  // What the sheet says about a planned row (state → copy). `pickable` rows get
  // a live checkbox; only a plain 'book' with the usual instructor, inside what
  // Psycle has opened, starts ticked — a waitlist join, a cover instructor, a
  // class that may not be open yet and one more seat in a class already held
  // (`topUp`) are the member's call, every time.
  var UW_NOT_OPEN = 'May not be open yet. Psycle opens new dates on Mondays at 12:00.';
  var UW_NOT_LISTED = 'Not on the timetable yet. Psycle adds new dates on Mondays at 12:00.';
  // What joining a waitlist from here means (it leads with a space: it follows
  // the sheet's money sentence). On screen only while a waitlist row is ticked.
  var UW_WAITLIST_NOTE = ' A ticked waitlist class joins the waitlist only while it is still full. Psycle then books you in by itself when a spot frees up, chargeable, same policy. If a spot has opened up by then, nothing is joined and it is left for you to choose.';
  function _uwPlanNote(row) {
    var join = function (parts) { return parts.filter(Boolean).join('. '); };
    if (row.state === 'book') {
      if (row.instructorChanged) return { pickable: true, on: false, warn: true, text: join(['Different instructor this week. Tick to book it anyway.', row.beyondOpen ? UW_NOT_OPEN : '']) };
      // ADVISORY (app.js pure:horizon — an observed model, not Psycle's word):
      // the row stays tickable, and Psycle's own answer is what counts.
      if (row.beyondOpen) return { pickable: true, on: false, warn: true, text: join([UW_NOT_OPEN, row.clashLine]) };
      return { pickable: true, on: true, warn: !!row.clashLine, text: row.clashLine || '' };
    }
    if (row.state === 'waitlist') return { pickable: true, on: false, warn: true, text: join(['Full. Tick to join the waitlist.', row.clashLine]) };
    if (row.state === 'booked') {
      var held = Number(row.heldSeats) || 0, asked = Number(row.seats) || 1;
      var unit = row.count ? 'space' : 'spot';
      // Fewer seats than the usual week asks for, and room left: the missing
      // one(s) can be added — those and no more.
      if (row.canAdd && held > 0 && held < asked) return { pickable: true, on: false, topUp: true, text: held + ' of ' + asked + ' ' + unit + 's held. Tick to add ' + (asked - held) + ' more.' };
      return { text: held > 1 ? 'Already booked · ' + held + ' ' + unit + 's' : 'Already booked' };
    }
    if (row.state === 'waitlisted') return { text: 'Already on the waitlist' };
    if (row.state === 'clash') return { warn: true, text: (row.clashLine || 'Clashes with a class you hold') + '. Left out.' };
    if (row.state === 'nolayout') return { text: 'Couldn\'t tell how this studio is booked. Book it from Discover.' };
    if (row.state === 'full') return { text: 'Full, and no waitlist' };
    if (row.state === 'error') return { warn: true, text: 'Couldn\'t load that day\'s timetable' };
    // An empty day past what the timetable lists (app.js pure:horizon, advisory)
    // is an unpublished day, not a changed timetable — the same reason Discover
    // gives, and the sheet's own line when NO row was found. Every Monday
    // before 12:00 that is the Fri–Sun of the third week.
    if (row.beyondListed) return { text: UW_NOT_LISTED };
    return { text: 'No matching class that day' };
  }

  // "1 of 2 seats held": the seat(s) still missing — all a top-up may ask for.
  function _uwTopUpNeed(row) {
    return Math.max(1, (Number(row.seats) || 1) - (Number(row.heldSeats) || 0));
  }

  // "Choose again" lists the same dates afresh. WHAT the member ticked is kept,
  // not just where: the class, the state it was in, whether it was a top-up or
  // a cover class, and the seats asked for (`need`: the sheet's rowNeed).
  function _uwTickOf(row, need) {
    return { eventId: row.eventId, state: row.state, topUp: !!_uwPlanNote(row).topUp, cover: !!row.instructorChanged, seats: Number(need) || 1 };
  }
  // …and a kept tick stands only on a row that is still THAT: by template index
  // alone, a seat that went while the class filled came back as a PRE-TICKED
  // waitlist join (a place Psycle turns into a charge), a class just booked at
  // one seat as a pre-ticked "add 1 more", a cover class as ticked — every one
  // a spend the member never chose. `kept`: _uwTickOf() from the run, or
  // nothing (the row was not in it: it stays unticked). Anything else that has
  // changed falls back on the rule every fresh row starts by (_uwPlanNote.on).
  // → { on, same, seats }: `seats` = the member's OWN count to put back (null:
  // the row's — a top-up only ever asks for what is missing, and only the same
  // ask stays ticked).
  function _uwKeepTick(kept, row) {
    if (!kept) return { on: false, same: false, seats: null };
    var note = _uwPlanNote(row);
    var same = !!note.pickable && row.eventId != null && String(kept.eventId) === String(row.eventId) && kept.state === row.state &&
      kept.topUp === !!note.topUp && kept.cover === !!row.instructorChanged &&
      (!note.topUp || Number(kept.seats) === _uwTopUpNeed(row));
    if (!same) return { on: !!note.on, same: false, seats: null };
    var cap = Math.floor(Number(row.maxSeats));
    var seats = Math.max(1, Math.min(Math.floor(Number(kept.seats)) || 1, cap >= 1 ? cap : 4));
    return { on: true, same: true, seats: note.topUp ? null : seats };
  }

  // …and about what happened to a ticked row once the run reached it. `info`:
  // { gone: "Bike 9" (the shown spots that went), goneMany, said: Psycle's own
  // words for a refusal, told: what the app toasted for a 'failed' — printed
  // here because that toast has faded by the time the summary is read }.
  // `again`: the sheet offers "Choose again" for it.
  function _uwResultNote(result, info) {
    info = info || {};
    if (result === 'running') return { text: 'Booking…' };
    if (result === 'booked') return { ok: true, text: 'Booked ✓' };
    if (result === 'waitlisted') return { ok: true, text: 'On the waitlist ✓' };
    if (result === 'already') return { text: 'Your booking there changed. Left as it is.' };
    if (result === 'clash') return { warn: true, text: 'Clashes with a class you hold. Not booked.' };
    if (result === 'full') return { warn: true, text: 'Filled up before we got there. Not booked.' };
    if (result === 'opened') return { warn: true, again: true, text: 'A spot has opened up. Nothing was joined. Choose again to book it.' };
    if (result === 'nolayout') return { warn: true, text: 'Couldn\'t load the studio map. Not booked. Book it from Discover.' };
    if (result === 'stale') return { warn: true, again: true, text: 'This class changed since it was listed. Not booked.' };
    if (result === 'taken') return { warn: true, again: true, text: (info.gone ? info.gone + (info.goneMany ? ' were' : ' was') : 'That spot was') + ' just taken. Not booked. Choose again.' };
    if (result === 'refused') return { warn: true, text: info.said ? 'Psycle said: ' + info.said : 'Psycle didn\'t take this booking' };
    if (result === 'partial') return { warn: true, text: 'Only part of this was booked. Check My Bookings before trying again.' };
    if (result === 'queued') return { warn: true, text: 'You went offline. Queued to book when you\'re back online.' };
    if (result === 'unconfirmed') return { warn: true, text: 'Couldn\'t confirm with Psycle. Check My Bookings before trying again.' };
    if (result === 'joinfailed') return { warn: true, text: 'Still full, and the waitlist couldn\'t be joined. See Psycle\'s message.' };
    if (result === 'failed') return { warn: true, text: info.told || 'Couldn\'t book this class. Check My Bookings before trying again.' };
    return { text: 'Not attempted' };
  }

  // The seat counts a row offers: 1 · 2, and 3 · 4 only when the saved entry
  // asked for them — never above the class's own max_bookable_slots (`max`).
  function _uwSeatOptions(saved, max) {
    var top = Math.max(2, Math.min(4, Math.floor(Number(saved)) || 1));
    var cap = Math.floor(Number(max));
    if (cap >= 1 && cap < top) top = cap;
    var out = [];
    for (var n = 1; n <= top; n++) out.push(n);
    return out;
  }

  // The confirm button counts what it will SPEND: "Book 3 classes · 4 seats".
  // t: { classes, seats, places (waitlists to join) }. '' = nothing to do.
  function _uwConfirmLabel(t) {
    t = t || {};
    var n = function (count, one, many) { return count + ' ' + (count === 1 ? one : many); };
    var classes = Math.max(0, Number(t.classes) || 0), seats = Math.max(0, Number(t.seats) || 0), places = Math.max(0, Number(t.places) || 0);
    var book = classes ? 'Book ' + n(classes, 'class', 'classes') + ' · ' + n(seats, 'spot', 'spots') : '';
    if (!places) return book;
    if (!book) return 'Join ' + n(places, 'waitlist', 'waitlists');
    return book + ' · join ' + n(places, 'waitlist', 'waitlists');
  }

  // A date range of the sheet's control, as it is labelled. `fmt(dateStr, opts)`
  // formats a London calendar date (the sheet's own _uwDateLabel family).
  function _uwRangeLabel(range, fmt) {
    if (!range) return '';
    if (range.id === 'next7') return 'Next 7 days';
    // "Fri 9 – Thu 15 Oct"; across a month end both halves carry their month.
    var sameMonth = String(range.start).slice(0, 7) === String(range.end).slice(0, 7);
    if (range.id === 'newest') return 'Newly opened · ' + fmt(range.start, sameMonth ? 'weekday' : 'full') + ' – ' + fmt(range.end, 'full');
    return fmt(range.start, 'day');
  }
  // "Newly opened · Fri 25 Sept – Thu 1 Oct" as two halves that each stay whole.
  // In the mono themes on a phone that label is wider than its track: it then
  // breaks BETWEEN the halves — the "·" kept with the words before it, so no
  // line starts on a bare dot — never in the middle of a date. One half = a
  // label with nothing to split.
  function _uwLabelHalves(label) {
    var s = String(label || ''), cut = s.indexOf(' · ');
    return cut === -1 ? [s] : [s.slice(0, cut) + '\u00a0·', s.slice(cut + 3)];
  }

  // The list's scrollTop once the sheet has re-flowed around the row the member
  // is on. Everything but the list is pinned, so a tick that shows the waitlist
  // sentence or the plan line is paid for by the LIST — and the row just ticked
  // slid under its fold. The answer keeps the part just `used` (the tick's own
  // label, or the row's spots block) on screen whole, with as much of its row
  // as the list can show — a row that fits, whole; one taller than the list (a
  // short phone squeezes the list to its floor) filling it — by the least
  // movement. Unchanged when that already holds. `row` / `used` = { top, height }
  // in the list's own content coordinates.
  function _uwScrollTopToReveal(scrollTop, viewH, row, used) {
    var cur = Number(scrollTop) || 0;
    var real = function (box) { return !!box && box.height > 0 && !isNaN(box.top); };
    if (!(viewH > 0) || !real(row)) return cur;
    // Every scrollTop that shows `box` whole — or, taller than the list, fills the list with it.
    var span = function (box) {
      var a = box.top, b = box.top + box.height - viewH;
      return [Math.min(a, b), Math.max(a, b)];
    };
    var want = span(row);
    if (real(used)) {
      var u = span(used);
      var lo = Math.max(want[0], u[0]), hi = Math.min(want[1], u[1]);
      want = lo <= hi ? [lo, hi] : u; // both cannot be had: the part just used wins
    }
    return Math.max(0, Math.min(Math.max(cur, want[0]), want[1]));
  }
  // ── pure:usual-week-sheet:end ──

  // One row of the sheet. Every name in it is API (or stored) text: escaped.
  // `spots`: the row's seat count, suggested spot(s) and "Change spot" — its own
  // block UNDER the label, so its buttons are not part of the checkbox's name.
  function _uwRowHtml(row, note, checkbox, spots) {
    var en = row.entry || {};
    var wall = (row.startAt && typeof _templateWall === 'function') ? _templateWall(row.startAt) : null;
    var min = wall ? wall.min : (Number(en.hour) || 0) * 60 + (Number(en.minute) || 0);
    var name = row.typeName || (row.eventId == null ? String(en.label || 'Class') : 'Class');
    var sub = [row.instrName, row.locName].filter(Boolean).join(' · ');
    // The compact class component again: tile · day over a smaller time · class.
    var mark = _uwMark(row.typeName || _uwTypeOf(en.label));
    var text = mark.tile +
      '<span class="usual-week-row-when"><span class="usual-week-day">' + escapeHTML(_uwDateLabel(row.date)) + '</span>' + _uwTimeHtml(min) + '</span>' +
      '<span class="usual-week-row-text">' +
        '<span class="usual-week-row-main">' + escapeHTML(name) + '</span>' +
        (sub ? '<span class="usual-week-row-sub">' + escapeHTML(sub) + '</span>' : '') +
        '<span class="usual-week-row-note' + (note.warn ? ' is-warn' : '') + (note.ok ? ' is-ok' : '') + '" data-uw-note="' + row.index + '">' + _uwNoteInner(note) + '</span>' +
      '</span>';
    return '<li class="usual-week-row" data-ct="' + mark.key + '">' +
      (checkbox != null
        ? '<label class="usual-week-pick"><input type="checkbox" data-uw-row="' + row.index + '"' + (checkbox ? ' checked' : '') + '>' + text + '</label>'
        : '<div class="usual-week-pick">' + text + '</div>') +
      (spots || '') +
    '</li>';
  }

  // ── pure:usual-week-note:start ── (DOM-free; tests/suites/10c-polish.js evaluates this block)
  // What a row's note holds. A warning (a clash, a full class, a run that
  // stopped) is ONE quiet line, as on the class sheet and in the dialogs: the
  // caution mark — decorative, the words say it; css/crisp.css inks it in the
  // theme's caution colour — and the sentence in the body ink. Nothing to say =
  // nothing at all, so the note is still `:empty` and takes no room. The run
  // rewrites a note in place (setNote), so the first paint and the rewrite both
  // come through here. typeof: tabs.js can run without app.js's _uiIcon.
  function _uwNoteInner(note) {
    if (!note || !note.text) return '';
    var mark = note.warn && typeof _uiIcon === 'function' ? _uiIcon('caution', 14) : '';
    return mark + '<span>' + escapeHTML(note.text || '') + '</span>';
  }
  // ── pure:usual-week-note:end ──

  // Where focus goes when the sheet closes: what held it on open, if that is a
  // real element still in the page — else the card's own button.
  function _uwFocusBack(prev, doc) {
    var usable = !!prev && prev !== doc.body && prev !== doc.documentElement && doc.contains(prev);
    return usable ? prev : doc.querySelector('#usualWeekCard .week-template-book');
  }

  // The sheet between "Book my usual week" and any booking. It LISTS every
  // class with its state, books nothing until its button — labelled with the
  // count — is pressed, then shows what happened to each one. Resolves when it
  // closes. Own overlay id, so nothing built on the single-instance confirmModal
  // (#psycleConfirmOverlay) can replace it — and app.js's _dialogOpen() /
  // _ownKeysOverlayUp() know that id: background dialogs (a waitlist "You're
  // in", "Spot opened", the offline-booking ask, the sync prompt) wait for this
  // to close rather than open over a run, and its keys stay its own.
  // What it shows is what it books: the dates (a control over the next 7 days
  // and the next three weeks — plus the batch a Monday release just opened), a
  // seat count per class, the spot(s) it SUGGESTS for each ticked class with
  // the reason in a few words, "Change spot" on the real seat map, and a
  // button that counts the spend. The run sends exactly those spots.
  // `opts.range === 'newest'`: open on the newly opened batch (the Monday
  // reminder's tap) — it still books nothing until its button is pressed.
  function _runUsualWeekSheet(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var previouslyFocused = document.activeElement;
      var overlay = document.createElement('div');
      overlay.id = 'usualWeekSheet';
      overlay.className = 'confirm-overlay usual-week-overlay';
      overlay.innerHTML =
        '<div class="confirm-dialog usual-week-dialog" role="dialog" aria-modal="true" aria-labelledby="usualWeekSheetTitle" tabindex="-1">' +
          '<div class="confirm-title" id="usualWeekSheetTitle">Book my usual week</div>' +
          '<div class="usual-week-sheet-body"></div>' +
        '</div>';
      document.body.appendChild(overlay);
      requestAnimationFrame(function () { overlay.classList.add('show'); });
      var dialog = overlay.querySelector('.usual-week-dialog');
      var body = overlay.querySelector('.usual-week-sheet-body');
      // checked / seats / spots / picks are per row index (template order):
      //   seats[i]  the seat count chosen for the class (starts at the saved one)
      //   spots[i]  { status: 'loading' | 'ready' | 'full' | 'error', info, sugg }
      //             — what templateSpotsFor read, and what _spotSuggestion made of it
      //   picks[i]  the member's own choice from "Change spot" (kept while free)
      // choosing: the seat map is up and this sheet has stepped out of the page.
      // reported: a run's results are on screen (until "Choose again" lists afresh).
      // on: the row the member last used, and which part of it (revealRow).
      var st = { closed: false, running: false, stop: false, plan: null, seq: 0, checked: {}, seats: {}, spots: {}, picks: {},
        keep: null, choosing: false, reported: false, saidCaution: '', saidWaitlist: false, on: null, wantNewest: opts.range === 'newest' };

      function close() {
        if (st.closed || st.running || st.choosing) return; // a run in flight is never orphaned
        st.closed = true;
        if (window._usualWeekSheetNewest === showNewest) delete window._usualWeekSheetNewest;
        overlay._psycleClosing = true; // still rendered while it fades: not a dialog to announce into (app.js _dialogLiveRegion)
        overlay.classList.remove('show');
        setTimeout(function () { overlay.remove(); }, 180);
        document.removeEventListener('keydown', onKey);
        // The card re-renders during a run, so the button that opened this may be gone.
        // <body> / <html> is "no opener", not one to go back to: a finger tap in
        // iOS WebKit doesn't focus the button, so that is what was recorded — and
        // document.contains(body) is true, which kept the fallback out of reach.
        var back = _uwFocusBack(previouslyFocused, document);
        if (back && typeof back.focus === 'function') { try { back.focus(); } catch (e) {} }
        resolve();
      }

      function onKey(e) {
        // A confirmModal stacked on top owns the keyboard while it is up — and
        // so does the seat map of "Change spot" (this sheet is out of the page
        // then, and app.js's own handler serves the picker).
        if (st.choosing || e.defaultPrevented || document.getElementById('psycleConfirmOverlay')) return;
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key !== 'Tab') return;
        var items = Array.prototype.slice.call(overlay.querySelectorAll('button, input')).filter(function (el) {
          return !el.disabled && el.offsetParent !== null;
        });
        if (!items.length) { e.preventDefault(); return; }
        var first = items[0], last = items[items.length - 1], active = document.activeElement;
        if (e.shiftKey && (active === first || !overlay.contains(active))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !overlay.contains(active))) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey);
      overlay.onclick = function (e) { if (e.target === overlay) close(); };

      // Every repaint replaces the body — and with it whichever button had
      // focus, which would otherwise drop to <body>, outside the dialog.
      function keepFocus() {
        if (!overlay.contains(document.activeElement)) { try { dialog.focus(); } catch (e) {} }
      }

      function message(text, isStatus) {
        body.innerHTML = '<div class="confirm-body"' + (isStatus ? ' role="status"' : '') + '>' + escapeHTML(text) + '</div>' +
          '<div class="confirm-actions"><button type="button" class="confirm-btn confirm-btn-cancel" data-uw-close>Close</button></div>';
        body.querySelector('[data-uw-close]').onclick = close;
        keepFocus();
      }

      // 'YYYY-MM-DD' → a London calendar date in the sheet's own words:
      // 'day' "21 Sept" · 'weekday' "Fri 9" · 'full' "Thu 15 Oct".
      function rangeDate(dateStr, how) {
        var p = String(dateStr || '').split('-').map(Number);
        if (p.length !== 3 || !p[0]) return '';
        var o = how === 'day' ? { day: 'numeric', month: 'short' } : how === 'weekday' ? { weekday: 'short', day: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' };
        o.timeZone = 'UTC';
        return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString('en-GB', o).replace(',', '');
      }

      // Spot reads are one GET per ticked class: a few at a time, and none left
      // over from a range the member has already moved on from.
      var spotJobs = [], spotJobsOut = 0;
      function pumpSpotJobs() {
        while (spotJobsOut < 3 && spotJobs.length) {
          spotJobsOut++;
          var job = spotJobs.shift();
          var next = function () { spotJobsOut--; pumpSpotJobs(); };
          Promise.resolve().then(job).then(next, next);
        }
      }

      // `start`: the first of the 7 days (none: the plan chooses — app.js
      // _templateDefaultStart). `keepTicks`: { rowIndex: _uwTickOf() } from
      // "Choose again" — the member's own ticks, seat counts and picks survive
      // that re-plan, each only on a row that is still what was ticked.
      function load(start, keepTicks) {
        var seq = ++st.seq;
        st.plan = null;
        st.reported = false;
        st.keep = keepTicks || null;
        spotJobs.length = 0;
        message('Checking the timetable…', true);
        window.planWeeklyTemplate(start, { newest: st.wantNewest }).then(function (plan) {
          if (st.closed || seq !== st.seq) return;
          st.plan = plan || { ok: false, reason: '' };
          paintPlan();
        }, function (e) {
          console.error('[template] plan failed:', e);
          if (st.closed || seq !== st.seq) return;
          message('Couldn\'t load the timetable. Try again.');
        });
      }

      // The Monday reminder's tap while this sheet is ALREADY up (app.js
      // _onBookingWeekOpened): opened before the 12:00 release to be ready for
      // it, or sitting on another range, it has no "Newly opened" dates — the
      // ones the tap promised. An idle sheet takes the tap: it lists afresh,
      // that batch first. It books nothing, and answers false — the tap is
      // then dropped, never queued — during a run, while the seat map is up,
      // and over a run's results (what happened to each class is not wiped).
      function showNewest() {
        if (st.closed || st.running || st.choosing || st.reported) return false;
        if (st.plan && st.plan.ok && st.plan.rangeId === 'newest') return true;
        st.wantNewest = true;
        load();
        return true;
      }
      window._usualWeekSheetNewest = showNewest;

      function rowByIndex(i) {
        return ((st.plan && st.plan.rows) || []).filter(function (r) { return r.index === i; })[0] || null;
      }

      // What a ticked row is: a waitlist to join, a COUNT of spaces (a studio
      // with no spot map), or seats on a map — the only kind with spots to show.
      function rowKind(r) { return r.state === 'waitlist' ? 'join' : (r.count ? 'count' : 'seats'); }

      // How many seats the row will ASK for: the missing one(s) of a class
      // already held, else the count the member chose.
      function rowNeed(r) {
        if (_uwPlanNote(r).topUp) return _uwTopUpNeed(r);
        return Math.max(1, Number(st.seats[r.index]) || 1);
      }

      function picked() {
        var out = [];
        ((st.plan && st.plan.rows) || []).forEach(function (r) {
          if (!st.checked[r.index] || !_uwPlanNote(r).pickable || r.eventId == null) return;
          out.push(r);
        });
        return out;
      }

      // A ticked row the run may take: its spots are ON SCREEN. A row still
      // reading them, or whose read failed, is not — it is left out of the count
      // on the button and of the run, and says why on its own line.
      function rowReady(r) {
        if (rowKind(r) !== 'seats') return true;
        var sp = st.spots[r.index];
        return !!(sp && sp.status === 'ready' && sp.sugg && sp.sugg.slots.length);
      }
      function rowLoading(r) {
        if (rowKind(r) !== 'seats') return false;
        var sp = st.spots[r.index];
        return !sp || sp.status === 'loading';
      }

      function totals(rows) {
        var t = { classes: 0, seats: 0, places: 0 };
        rows.forEach(function (r) {
          var kind = rowKind(r);
          if (kind === 'join') { t.places++; return; }
          t.classes++;
          t.seats += kind === 'count' ? rowNeed(r) : st.spots[r.index].sugg.slots.length;
        });
        return t;
      }

      // The number printed on a seat (a layout's label can differ from its id).
      function spotLabeller(info) {
        var by = {};
        (((info && info.layout) || {}).slots || []).forEach(function (s) { by[Number(s.id)] = s.label == null ? s.id : s.label; });
        return function (id) { return by[Number(id)] == null ? id : by[Number(id)]; };
      }
      function spotWord(r) { return typeof slotLabel === 'function' ? slotLabel(r.typeName) : 'Spot'; }
      function spotNames(r, ids, info) {
        var labels = ids.map(spotLabeller(info));
        // Three or four read as a list, in seat order ("Benches 5, 6, 10 & 11") —
        // nearest-first gave "5 & 6 & 11 & 10". A pair keeps its order: the first
        // is the one the reason is about ("your usual, plus the closest free").
        if (labels.length > 2 && labels.every(function (l) { return isFinite(Number(l)); })) labels.sort(function (a, b) { return Number(a) - Number(b); });
        return typeof formatSlots === 'function' ? formatSlots(spotWord(r), labels) : spotWord(r) + ' ' + labels.join(' & ');
      }

      // The opinion, made again from what was read (no new GET): when the seat
      // count changes, and when the member comes back from the seat map.
      function resuggest(r) {
        var sp = st.spots[r.index];
        if (!sp || !sp.info || typeof _spotSuggestion !== 'function') return;
        var info = sp.info;
        sp.sugg = _spotSuggestion({
          slots: info.layout.slots, free: info.free, count: rowNeed(r), usual: info.usual,
          prefer: info.prefer, avoid: info.avoid, held: info.held, keep: st.picks[r.index] || null,
        });
        sp.status = (info.full || !sp.sugg.slots.length) ? 'full' : 'ready';
        // Fewer free than asked for: the count follows what can be shown.
        if (sp.status === 'ready' && sp.sugg.short > 0 && !_uwPlanNote(r).topUp) st.seats[r.index] = sp.sugg.slots.length;
      }

      // The row the member is on stays on screen. A tick can show the waitlist
      // sentence or the plan line — pinned, so the LIST gives up the room — and
      // opens the row's own spots: on a 667px phone the box just ticked, focus
      // and all, was left with 3px of its row above the list's fold. Moved by
      // the list's OWN scrollTop (_uwScrollTopToReveal says where to), never
      // scrollIntoView(): that scrolls the dialog too and, on iOS, the page.
      // `part`: what was used — 'pick' (the tick's label) or 'spots' (the block
      // under it). Remembered (st.on): the row re-flows once more when its spots
      // read lands. A fresh plan forgets it, and nothing else ever moves the list.
      function revealRow(index, part) {
        st.on = { index: index, part: part };
        try {
          var list = body.querySelector('.usual-week-plan');
          var box = body.querySelector('[data-uw-row="' + index + '"]');
          var row = box && box.closest('.usual-week-row');
          if (!list || !row || !(list.scrollHeight > list.clientHeight)) return;
          var used = (part === 'spots' && row.querySelector('[data-uw-spots]:not([hidden])')) || row.querySelector('.usual-week-pick');
          // Layout px — scrollTop's own unit — walked up the offsetParent chain,
          // never getBoundingClientRect(): the dialog scales in as it opens (and
          // springs past 1), and a rect is measured THROUGH that transform — a
          // tick in the sheet's first moments would come up some 10px short.
          var edge = list.offsetTop + list.clientTop;
          var at = function (el) {
            var top = 0, n = el;
            while (n && n !== list && n !== list.offsetParent) { top += n.offsetTop + (n === el ? 0 : n.clientTop); n = n.offsetParent; }
            return { top: n === list ? top : top - edge, height: el.offsetHeight };
          };
          var to = _uwScrollTopToReveal(list.scrollTop, list.clientHeight, at(row), used ? at(used) : null);
          if (to !== list.scrollTop) list.scrollTop = to;
        } catch (e) { /* a nicety: never in the way of the tick */ }
      }

      function readSpots(r) {
        if (rowKind(r) !== 'seats' || typeof window.templateSpotsFor !== 'function') return;
        var cur = st.spots[r.index];
        if (cur && (cur.status === 'loading' || cur.status === 'ready' || cur.status === 'full')) return;
        var seq = st.seq;
        st.spots[r.index] = { status: 'loading' };
        spotJobs.push(function () {
          if (st.closed || seq !== st.seq) return null;
          return window.templateSpotsFor(r.eventId, r.studioId).then(function (info) {
            if (st.closed || seq !== st.seq) return;
            if (info && info.ok && info.kind === 'seats') { st.spots[r.index] = { status: 'ready', info: info }; resuggest(r); }
            else st.spots[r.index] = { status: 'error' };
            paintSpots(r);
            syncGo();
            // Only the row the member is on: the reads of a fresh plan move nothing.
            if (st.on && st.on.index === r.index) revealRow(r.index, st.on.part);
          });
        });
        pumpSpotJobs();
      }

      // The row's own block under its label: the opinion first, then the seat
      // count and "Change spot". Rewritten in place — the list keeps its scroll
      // offset, and the control that had focus gets it back.
      function paintSpots(r) {
        var el = body.querySelector('[data-uw-spots="' + r.index + '"]');
        if (!el) return;
        if (!st.checked[r.index]) { el.innerHTML = ''; el.hidden = true; return; }
        var focusKey = el.contains(document.activeElement) ? document.activeElement.getAttribute('data-uw-key') : null;
        var kind = rowKind(r), topUp = !!_uwPlanNote(r).topUp;
        var sp = st.spots[r.index];
        var line = '', change = '';
        // Every row has the same two controls: their spoken names say WHICH class
        // (API text — escaped, like everything else that reaches this markup).
        var forClass = escapeHTML(' for ' + (r.typeName || 'this class') + ', ' + _uwDateLabel(r.date));
        if (kind === 'count') {
          var n = rowNeed(r);
          line = '<strong>' + n + (n === 1 ? ' space' : ' spaces') + '</strong><span class="usual-week-spot-why"> · no spot to choose at this studio</span>';
        } else if (!sp || sp.status === 'loading') {
          line = '<span class="usual-week-spot-why">Checking the spots…</span>';
        } else if (sp.status === 'ready') {
          var why = typeof _spotWhyText === 'function' ? _spotWhyText(sp.sugg, spotLabeller(sp.info)) : '';
          if (sp.sugg.short > 0) why = (why ? why + ', ' : '') + 'only ' + sp.sugg.slots.length + ' free';
          line = '<strong>' + escapeHTML(spotNames(r, sp.sugg.slots, sp.info)) + '</strong>' +
            (why ? '<span class="usual-week-spot-why"> · ' + escapeHTML(why) + '</span>' : '');
          change = '<button type="button" class="pill-btn pill-quiet usual-week-change" data-uw-key="change" data-uw-change="' + r.index + '" aria-label="Change spot' + forClass + '">Change spot</button>';
        } else if (sp.status === 'full') {
          line = '<span class="usual-week-spot-why">Just filled up. Left out.</span>';
        } else {
          line = '<span class="usual-week-spot-why">Couldn\'t check the spots. Left out.</span>';
          change = '<button type="button" class="pill-btn pill-quiet usual-week-change" data-uw-key="retry" data-uw-retry="' + r.index + '" aria-label="Try again: check the spots' + forClass + '">Try again</button>';
        }
        var seats = '';
        if (!topUp) {
          var max = (sp && sp.info && sp.info.max) || r.maxSeats;
          var unit = kind === 'count' ? 'Spaces' : 'Seats';
          seats = '<div class="seg usual-week-seats" role="group" aria-label="' + unit + forClass + '">' +
            _uwSeatOptions(r.seats, max).map(function (n) {
              var on = n === rowNeed(r);
              return '<button type="button" class="seg-btn" aria-pressed="' + on + '" data-uw-key="seats-' + n + '" data-uw-seats="' + n + '"' +
                ' aria-label="' + n + (n === 1 ? (kind === 'count' ? ' space' : ' spot') : (kind === 'count' ? ' spaces' : ' spots')) + '">' + n + '</button>';
            }).join('') + '</div>';
        }
        el.hidden = false;
        el.innerHTML = '<div class="usual-week-spot-text">' + line + '</div>' + seats + change;
        Array.prototype.forEach.call(el.querySelectorAll('[data-uw-seats]'), function (b) {
          b.onclick = function () {
            if (st.running || st.choosing) return;
            st.seats[r.index] = Number(b.getAttribute('data-uw-seats'));
            // Another count is another set of spots: the member's pick of N no longer stands.
            st.picks[r.index] = null;
            resuggest(r);
            paintSpots(r);
            syncGo();
            revealRow(r.index, 'spots');
          };
        });
        var changeBtn = el.querySelector('[data-uw-change]');
        if (changeBtn) changeBtn.onclick = function () { changeSpot(r, changeBtn); };
        var retryBtn = el.querySelector('[data-uw-retry]');
        if (retryBtn) retryBtn.onclick = function () { st.spots[r.index] = null; readSpots(r); paintSpots(r); syncGo(); revealRow(r.index, 'spots'); };
        if (focusKey) {
          var back = el.querySelector('[data-uw-key="' + focusKey + '"]') || el.querySelector('button');
          if (back) { try { back.focus({ preventScroll: true }); } catch (e) {} } else keepFocus();
        }
      }

      // "Change spot": the REAL seat map, in its choose-only mode (app.js
      // showBikePicker — it books nothing and answers with the chosen ids, or
      // null for "no change"). Availability is read afresh first. The map sits
      // UNDER this sheet's layer, and app.js's one key handler stands aside
      // while #usualWeekSheet is in the page — so the sheet steps OUT of the
      // page while the map is up and comes back, as it was, with the answer.
      // _dialogOpen() stays true throughout (the picker counts), so no
      // background dialog can slip in between the two.
      function changeSpot(r, btn) {
        if (st.choosing || st.running || typeof window.showBikePicker !== 'function' || typeof window.templateSpotsFor !== 'function') return;
        st.choosing = true;
        var seq = st.seq;
        btn.disabled = true;
        btn.textContent = 'Loading…';
        var giveUp = function () { st.choosing = false; paintSpots(r); syncGo(); };
        window.templateSpotsFor(r.eventId, r.studioId).then(function (info) {
          if (st.closed || seq !== st.seq) { st.choosing = false; return; }
          if (!(info && info.ok && info.kind === 'seats')) { st.spots[r.index] = { status: 'error' }; giveUp(); return; }
          st.spots[r.index] = { status: 'ready', info: info };
          resuggest(r);
          var sp = st.spots[r.index];
          if (sp.status !== 'ready') { giveUp(); return; }
          var list = body.querySelector('.usual-week-plan');
          var scrollTop = list ? list.scrollTop : 0;
          var answered = false;
          var done = function (ids) {
            if (answered) return;
            answered = true;
            st.choosing = false;
            if (st.closed) return;
            if (!overlay.isConnected) document.body.appendChild(overlay);
            if (ids && ids.length) { st.picks[r.index] = ids.slice(); resuggest(r); }
            paintSpots(r);
            syncGo();
            var again = body.querySelector('.usual-week-plan');
            if (again) again.scrollTop = scrollTop;
            revealRow(r.index, 'spots'); // the words of another pick can wrap: "Change spot", where focus lands, stays in view
            var focusBack = body.querySelector('[data-uw-change="' + r.index + '"]');
            if (focusBack) { try { focusBack.focus({ preventScroll: true }); } catch (e) {} } else keepFocus();
          };
          try {
            window.showBikePicker(r.eventId, null, info.layout, new Set(info.free), new Set(info.held), info.studioName,
              { clashLine: info.clashLine, choose: { count: sp.sugg.slots.length, preselect: sp.sugg.slots.slice(), done: done } });
            overlay.remove();
          } catch (e) {
            console.error('[template] seat map failed:', e);
            done(null);
          }
        }, giveUp);
      }

      function paintPlan() {
        var plan = st.plan;
        if (!plan.ok) {
          message(plan.reason === 'offline' ? 'You\'re offline. Connect to book your usual week.'
            : plan.reason === 'signedout' ? 'Sign in to book your usual week.'
            : plan.reason === 'bookings' ? 'Couldn\'t load your bookings, so nothing can be checked against them. Try again.'
            : plan.reason === 'empty' ? 'Your usual week is empty. Save it from My Bookings first.'
            : 'Couldn\'t load the timetable. Try again.');
          return;
        }
        var keep = st.keep;
        st.keep = null;
        st.on = null;
        st.saidCaution = '';
        st.saidWaitlist = false;
        st.checked = {};
        st.seats = {};
        st.spots = {};
        if (!keep) st.picks = {};
        var anyWaitlist = false, anyFound = false;
        var rows = plan.rows.map(function (r) {
          var note = _uwPlanNote(r);
          if (r.state === 'waitlist') anyWaitlist = true;
          if (r.state !== 'nomatch' && r.state !== 'error') anyFound = true;
          st.seats[r.index] = r.seats;
          if (!(note.pickable && r.eventId != null)) { st.picks[r.index] = null; return _uwRowHtml(r, note, null); }
          // "Choose again" re-plans: a row the member had unticked stays
          // unticked, and a tick survives only where the row is still what was
          // ticked (_uwKeepTick) — at the member's own seat count, not the
          // saved one. A pick of theirs stands for that class at that count only.
          var on = !!note.on;
          if (keep) {
            var kept = _uwKeepTick(keep[r.index], r);
            on = kept.on;
            if (kept.seats != null) st.seats[r.index] = kept.seats;
            var pick = st.picks[r.index];
            if (!(kept.same && pick && pick.length === rowNeed(r))) st.picks[r.index] = null;
          }
          st.checked[r.index] = on;
          return _uwRowHtml(r, note, on, rowKind(r) === 'join' ? '' : '<div class="usual-week-spots" data-uw-spots="' + r.index + '" hidden></div>');
        }).join('');
        var ranges = plan.ranges || [];
        var sw = function (range) {
          var active = range.start === plan.weekStart;
          // .seg-btn: the Crisp segmented track lights the segment off aria-pressed.
          var label = _uwLabelHalves(_uwRangeLabel(range, rangeDate)).map(function (half) { return '<span>' + escapeHTML(half) + '</span>'; }).join(' ');
          return '<button type="button" class="seg-btn usual-week-switch-btn' + (range.id === 'newest' ? ' is-newest' : '') + (active ? ' active' : '') + '" aria-pressed="' + active + '" data-uw-start="' + range.start + '">' + label + '</button>';
        };
        // Past what the timetable lists (app.js pure:horizon, advisory) an empty
        // range is an unpublished one, not a changed timetable.
        var unlisted = !anyFound && plan.horizon && plan.weekEnd > plan.horizon.listedThrough;
        body.innerHTML =
          '<div class="confirm-body">' +
            '<strong class="usual-week-range">' + escapeHTML(_uwDateLabel(plan.weekStart) + ' – ' + _uwDateLabel(plan.weekEnd)) + '</strong>' +
            '<span>Nothing is booked until you press the button below.' +
            (anyFound ? '' : unlisted ? ' None of your classes were found. Psycle adds new dates on Mondays at 12:00, so these may not be on the timetable yet.'
              : ' None of your classes were found on these dates.') +
          '</span></div>' +
          '<div class="seg usual-week-switch" role="group" aria-label="Which week">' + ranges.map(sw).join('') + '</div>' +
          '<ul class="usual-week-plan">' + rows + '</ul>' +
          // No role="status": the line is written while still [hidden] and then
          // revealed — a change a screen reader does not announce. syncGo says it
          // through announce() instead (and a role here would say it twice).
          '<div class="usual-week-total" data-uw-total hidden></div>' +
          // The dialogs' warn line: the caution mark, then the sentence in the body ink.
          '<div class="confirm-warn">' + (typeof _uiIcon === 'function' ? _uiIcon('caution', 16) : '') +
            '<span>Each class is booked straight away, on the spots shown, and every spot uses a class credit or counts towards your plan. ' +
            'Psycle\'s normal 12-hour cancellation policy applies to every one.' +
            // What a waitlist join means — shown only WHILE a waitlist row is ticked
            // (syncGo): everything but the list is pinned, and on a short phone these
            // four lines (seven in the mono themes) took the list's last room for a
            // sentence about a box nobody had ticked.
            (anyWaitlist ? '<span data-uw-waitlist-note hidden>' + escapeHTML(UW_WAITLIST_NOTE) + '</span>' : '') +
          '</span></div>' +
          '<div class="confirm-actions">' +
            '<button type="button" class="confirm-btn confirm-btn-cancel" data-uw-close>Not now</button>' +
            '<button type="button" class="confirm-btn confirm-btn-primary" data-uw-go></button>' +
          '</div>';
        syncGo();
        body.querySelector('[data-uw-close]').onclick = close;
        body.querySelector('[data-uw-go]').onclick = run;
        Array.prototype.forEach.call(body.querySelectorAll('[data-uw-row]'), function (box) {
          box.onchange = function () {
            var r = rowByIndex(Number(box.dataset.uwRow));
            st.checked[Number(box.dataset.uwRow)] = box.checked;
            if (r) { if (box.checked) readSpots(r); paintSpots(r); }
            syncGo();
            revealRow(Number(box.dataset.uwRow), 'pick');
          };
        });
        Array.prototype.forEach.call(body.querySelectorAll('[data-uw-start]'), function (b) {
          b.onclick = function () { if (b.getAttribute('aria-pressed') !== 'true' && !st.choosing) load(b.dataset.uwStart); };
        });
        // The opinion on the spots, for every class that starts ticked.
        picked().forEach(function (r) { readSpots(r); paintSpots(r); });
        syncGo();
        keepFocus();
      }

      // The button counts what it will spend — only the rows whose spots are on
      // screen — and one advisory line weighs that against the plan.
      function syncGo() {
        var go = body.querySelector('[data-uw-go]');
        if (!go) return;
        var rows = picked();
        var loading = rows.some(rowLoading);
        var ready = rows.filter(rowReady);
        var label = _uwConfirmLabel(totals(ready));
        // On a phone the label runs to two lines: the "·" stays with the words
        // before it (a no-break space), so no line ever STARTS on a bare dot.
        go.textContent = loading ? 'Checking the spots…' : (label ? label.replace(/ ·/g, '\u00a0·') : 'Nothing selected');
        go.disabled = loading || !label;
        var total = body.querySelector('[data-uw-total]');
        if (!total) return;
        var caution = '';
        if (!loading && typeof window.templatePlanCaution === 'function') {
          caution = window.templatePlanCaution(ready.filter(function (r) { return rowKind(r) !== 'join'; }).map(function (r) {
            return { startAt: r.startAt, seats: rowKind(r) === 'count' ? rowNeed(r) : st.spots[r.index].sugg.slots.length };
          })) || '';
        }
        var html = _uwNoteInner({ warn: true, text: caution });
        if (total.innerHTML !== html) total.innerHTML = html;
        total.hidden = !caution;
        // The waitlist sentence follows the ticks; both money lines are SPOKEN the
        // moment they appear or change (announce() writes into this dialog's own
        // live region — app.js _dialogLiveRegion): un-hiding a node says nothing.
        var joining = rows.some(function (r) { return rowKind(r) === 'join'; });
        var waitNote = body.querySelector('[data-uw-waitlist-note]');
        if (waitNote) waitNote.hidden = !joining;
        var say = [];
        if (caution && caution !== st.saidCaution) say.push(caution);
        if (joining && waitNote && !st.saidWaitlist) say.push(UW_WAITLIST_NOTE.trim());
        st.saidCaution = caution;
        st.saidWaitlist = joining && !!waitNote;
        if (say.length && typeof announce === 'function') { try { announce(say.join(' ')); } catch (e) {} }
      }

      function run() {
        if (st.running || st.choosing) return;
        var rows = picked().filter(rowReady);
        if (!rows.length || picked().some(rowLoading)) return;
        // EXACTLY what is on screen: these spots (or this count), and no others.
        var shown = {};
        var picks = rows.map(function (r) {
          var kind = rowKind(r);
          var p = { eventId: r.eventId, studioId: r.studioId, joinIfFull: kind === 'join', mayBeClosed: !!r.beyondOpen,
            held: _uwPlanNote(r).topUp ? (Number(r.heldSeats) || 0) : 0 };
          if (kind === 'count') { p.spaces = rowNeed(r); shown[r.index] = p.spaces + (p.spaces === 1 ? ' space' : ' spaces'); }
          else if (kind === 'seats') { p.slots = st.spots[r.index].sugg.slots.slice(); shown[r.index] = spotNames(r, p.slots, st.spots[r.index].info); }
          return p;
        });
        var ticked = {};
        rows.forEach(function (r) { ticked[r.index] = _uwTickOf(r, rowNeed(r)); });
        st.running = true;
        st.stop = false;
        _uwLog('usual-week:book');
        var spotsOf = function (r) {
          return shown[r.index] ? '<div class="usual-week-spots"><div class="usual-week-spot-text"><strong>' + escapeHTML(shown[r.index]) + '</strong></div></div>' : '';
        };
        body.innerHTML =
          '<div class="confirm-body" role="status" data-uw-progress>Booking 1 of ' + rows.length + '…</div>' +
          '<ul class="usual-week-plan">' + rows.map(function (r) { return _uwRowHtml(r, _uwResultNote('notrun'), null, spotsOf(r)); }).join('') + '</ul>' +
          '<div class="confirm-actions"><button type="button" class="confirm-btn confirm-btn-cancel" data-uw-stop>Stop after this class</button></div>';
        var stopBtn = body.querySelector('[data-uw-stop]');
        stopBtn.onclick = function () { st.stop = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping…'; keepFocus(); };
        keepFocus();
        // What the run hands back beside a result: the shown spots that went,
        // Psycle's own words for a refusal (setNote reads it by row).
        var detail = {};
        var setNote = function (i, result) {
          var el = body.querySelector('[data-uw-note="' + rows[i].index + '"]');
          if (!el) return;
          var note = _uwResultNote(result, detail[i]);
          el.innerHTML = _uwNoteInner(note); // escaped there; a warning keeps its caution mark
          el.className = 'usual-week-row-note' + (note.warn ? ' is-warn' : '') + (note.ok ? ' is-ok' : '');
        };
        var noteDetail = function (i, res) {
          res = res || {};
          var gone = Array.isArray(res.gone) ? res.gone : [];
          var sp = st.spots[rows[i].index];
          detail[i] = { gone: gone.length ? spotNames(rows[i], gone, sp && sp.info) : '', goneMany: gone.length > 1, said: res.said || '', told: res.told || '' };
        };
        var finish = function (counts) {
          st.running = false;
          st.reported = true;
          counts = counts || {};
          var again = false;
          (counts.results || []).forEach(function (r, i) {
            noteDetail(i, r);
            setNote(i, r.result);
            if (_uwResultNote(r.result, detail[i]).again) again = true;
          });
          var parts = [];
          if (counts.booked) parts.push(counts.booked + ' booked');
          if (counts.waitlisted) parts.push(counts.waitlisted + ' on the waitlist');
          var rest = rows.length - (counts.booked || 0) - (counts.waitlisted || 0);
          if (rest > 0) parts.push(rest + ' not booked');
          var why = counts.stopped === 'auth' ? ' Your session expired, so the run stopped. Sign in and open this again (classes already booked are skipped).'
            : counts.stopped === 'failed' ? ' Stopped there, so nothing else was attempted: see the note on that class, then open this again. Classes already booked are skipped.'
            : counts.stopped === 'offline' ? ' You went offline, so the run stopped.'
            : counts.stopped === 'bookings' ? ' Couldn\'t load your bookings, so nothing was attempted. Try again.'
            : counts.stopped === 'user' ? ' Stopped. The rest were not attempted.' : '';
          var progress = body.querySelector('[data-uw-progress]');
          if (progress) progress.textContent = (parts.join(' · ') || 'Nothing was booked') + '.' + why;
          var actions = body.querySelector('.confirm-actions');
          // "Choose again" books nothing: it lists these dates afresh — new
          // spots shown, the same classes ticked while they are still the same
          // thing (_uwKeepTick) — for the member to confirm.
          actions.innerHTML = (again ? '<button type="button" class="confirm-btn confirm-btn-cancel" data-uw-again>Choose again</button>' : '') +
            '<button type="button" class="confirm-btn confirm-btn-primary" data-uw-close>Done</button>';
          var done = actions.querySelector('[data-uw-close]');
          done.onclick = close;
          var againBtn = actions.querySelector('[data-uw-again]');
          if (againBtn) againBtn.onclick = function () { load(st.plan.weekStart, ticked); };
          try { done.focus(); } catch (e) {}
          renderUsualWeekCard();
        };
        window.bookWeeklyTemplate(picks, {
          onProgress: function (i, result, res) {
            noteDetail(i, res);
            setNote(i, result);
            var progress = body.querySelector('[data-uw-progress]');
            if (progress && result === 'running') progress.textContent = 'Booking ' + (i + 1) + ' of ' + rows.length + '…';
          },
          shouldStop: function () { return st.stop; },
        }).then(finish, function (e) {
          console.error('[template] book failed:', e);
          finish({ stopped: 'failed' });
        });
      }

      try { dialog.focus(); } catch (e) {}
      load();
    });
  }

  // Opens the REVIEW sheet — it books nothing by itself. `opts` (optional):
  // { range: 'newest' } opens it on the batch the latest Monday release opened
  // (the Monday reminder's tap); anything else, or nothing, lets the sheet pick
  // its own dates. Called with no argument by the card's button.
  var _templateWeekRunning = false;
  window.bookTemplateWeek = async function (opts) {
    // An onclick hands over its event, not options: only a plain { range } counts.
    var range = (opts && typeof opts === 'object' && opts.range === 'newest') ? 'newest' : '';
    if (typeof window.bookWeeklyTemplate !== 'function' || typeof window.planWeeklyTemplate !== 'function') {
      toast('Your usual week can\'t be booked right now', 'info');
      return;
    }
    // Double-tap guard — one sheet, and with it one run: a second concurrent
    // sweep would double-book.
    if (_templateWeekRunning) return;
    if (!_usualWeekTemplate().length) {
      toast('Save your usual week first', 'info');
      return;
    }
    _templateWeekRunning = true;
    try {
      // As bookClass: a session about to expire fails part-way through the run.
      if (typeof isTokenExpiringSoon === 'function' && isTokenExpiringSoon() && typeof confirmModal === 'function') {
        var reauth = await confirmModal({
          title: 'Session expiring',
          body: 'Your Psycle session is about to expire and booking may fail. Sign in again first?',
          confirmText: 'Sign in',
          cancelText: 'Carry on',
        });
        if (reauth) {
          if (typeof openLoginPopup === 'function') openLoginPopup();
          return;
        }
      }
      await _runUsualWeekSheet({ range: range });
      // The sheet has closed. The Monday reminder is offered here too (iOS only —
      // native-bridge.js; its own rules: once, never answered, never over a
      // dialog): a usual week saved by an earlier build never meets "Save"
      // again, and a review opened straight after a save outlasts that offer.
      if (typeof window._offerWeeklyReminder === 'function') window._offerWeeklyReminder('usual-week-reviewed');
    } catch (e) {
      console.error('[template] book failed:', e);
      toast('Couldn\'t open your usual week', 'error');
    } finally {
      _templateWeekRunning = false;
    }
  };

  // The small pictogram tile that leads a class name on a Stats card (app.js
  // classPictogram; css/crisp.css .ct-tile). '' when app.js is not there.
  function _statsTile(ct) {
    return (typeof classPictogram === 'function')
      ? '<span class="ct-tile is-sm" aria-hidden="true">' + classPictogram(ct, 15) + '</span>' : '';
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
      var dt = new Date(String(h.date).replace(' ', 'T'));
      // An unreadable date used to become its own "Invalid dates at NaN:NaN" card.
      if (isNaN(dt.getTime())) return;
      // Not toLocaleDateString: that builds a new Intl formatter per entry — for
      // a full history, 2,000 of them and most of the time Stats took to paint.
      var dayName = DAY_NAMES_FULL[dt.getDay()].toLowerCase();
      var timeKey = dt.getHours() * 100 + dt.getMinutes();
      var key = dayName + '-' + timeKey;
      if (!daySlots[key]) {
        daySlots[key] = {
          day: dayName,
          time: _clock24(dt.getHours(), dt.getMinutes()), // app.js (pure:clock): "18:30"
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
      // The compact class component: tinted by class type, the slot first.
      // (typeof: tests run this function on its own, without app.js.)
      var ct = (typeof classTypeKey === 'function') ? classTypeKey(p.type) : 'other';
      html += '<div class="reco-card ct-card" data-ct="' + ct + '">' +
        '<div class="reco-badge">' + dayCapital + 's at ' + p.time + '</div>' +
        '<div class="reco-class">' + (typeof _statsTile === 'function' ? _statsTile(ct) : '') + escapeHTML(p.type) + '</div>' +
        '<div class="reco-detail">' + instrLink(p.instr) + (p.loc ? ' · ' + escapeHTML(p.loc) : '') + '</div>' +
        '<div class="reco-detail">' + p.count + 'x booked</div>' +
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
      '<div class="habit-cards">';

    habits.forEach(function (s) {
      // Most common minute for this slot, for a natural "~07:00" label.
      var topMinute = 0, topMinuteCount = -1;
      Object.keys(s.minuteVotes).forEach(function (mk) {
        if (s.minuteVotes[mk] > topMinuteCount) { topMinuteCount = s.minuteVotes[mk]; topMinute = Number(mk); }
      });
      var timeLabel = _clock24(s.hour, topMinute);
      var dayName = DAY_NAMES_FULL[s.dow];
      var dateStr = _nextWeekdayDateStr(s.dow);
      // The habit's class type as one of app.js's fixed category keys ('RIDE',
      // 'STRENGTH'…) — what "Find this week" narrows Discover to. '' when the
      // type is only the 'Class' placeholder: better no filter than a wrong one.
      var catKey = (typeof getCategory === 'function' && s.type !== 'Class') ? String((getCategory(s.type) || {}).key || '') : '';

      // The compact class component: tinted by class type, the slot first.
      // (typeof: tests run this function on its own, without app.js.)
      var ct = (typeof classTypeKey === 'function') ? classTypeKey(s.type) : 'other';
      html += '<div class="habit-card ct-card" data-ct="' + ct + '">' +
        '<div class="habit-line"><strong>' + escapeHTML(dayName) + 's ~' + timeLabel + '</strong></div>' +
        '<div class="habit-class">' + (typeof _statsTile === 'function' ? _statsTile(ct) : '') + escapeHTML(s.type) + '</div>' +
        '<div class="habit-meta">' + s.count + 'x in your history</div>' +
        '<button class="habit-find-btn" data-date="' + dateStr + '" data-cat="' + escapeHTML(catKey) + '">Find this week</button>' +
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
    // That one day, narrowed to the habit's own class type (a fixed category
    // key from app.js's map — never the name) and to nothing else: the studio,
    // instructor and class-type filters left on Discover used to decide what
    // "Find this week" found. app.js's _focusSearch does the rest (no preset
    // mode for a picked day, Discover shown, search).
    if (typeof window._focusSearch === 'function') {
      window._focusSearch({ categoryKey: btn.getAttribute('data-cat') || '', startDate: dateStr, daysAhead: 1 });
      return;
    }
    var startDateEl = document.getElementById('startDate');
    var daysAheadEl = document.getElementById('daysAhead');
    if (startDateEl) startDateEl.value = dateStr;
    if (daysAheadEl) daysAheadEl.value = 1;
    // The date is this week's usual day, rarely today: 'today' here labelled
    // the saved filters and the recent search "Today" over another date. (It
    // was only ever set to get a one-day window, which daysAhead=1 now gives.)
    if (typeof window._dateQuickMode !== 'undefined') window._dateQuickMode = null;
    if (typeof updateFiltersSummary === 'function') updateFiltersSummary();
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
    // Crisp Colour (the Stats board): one block — the streak as a big numeral,
    // "Longest N" under its name, and the last twelve weeks as bars (the run
    // that is still going in the ink, earlier weeks quieter, a missed week a
    // stub). No glow: a streak is not something you hold.
    var bars = _streakWeeks(weeks, thisWeek, 12);
    var html = '<div class="streak-card streak-main' + (current >= 2 ? ' streak-live' : '') + '">' +
      '<div class="streak-value">' + current + '</div>' +
      '<div class="streak-text">' +
        '<div class="streak-label">week streak</div>' +
        '<div class="streak-sub">Longest ' + longest + '</div>' +
      '</div>' +
      '<div class="streak-weeks" role="img" aria-label="' + _streakWeeksLabel(bars) + '">' +
        bars.map(function (b) { return '<span class="streak-week' + (b.on ? ' is-on' : '') + (b.live ? ' is-live' : '') + '"></span>'; }).join('') +
      '</div>' +
    '</div>';

    // Milestones, while there is still one to reach: earned ones are filled,
    // the next is outlined as a target — and the one hint is a number: how far
    // that next one is. Past the last one the row has nothing left to say (four
    // filled badges under a member's 214 classes were only noise).
    if (nextMilestone) {
      html += '<div class="milestone-row">';
      MILESTONES.forEach(function (m) {
        var earned = total >= m;
        var isNext = !earned && m === nextMilestone;
        html += '<div class="milestone-badge' + (earned ? ' earned' : '') + (isNext ? ' next' : '') + '">' +
          '<span class="milestone-num">' + m + '</span>' +
        '</div>';
      });
      // The unit once, after the four numbers — not under each of them.
      html += '<span class="milestone-cap">classes</span>';
      html += '<div class="streak-hint">' + (nextMilestone - total) + ' to ' + nextMilestone + '</div>';
      html += '</div>';
    }

    container.innerHTML = html;
  }

  // ── pure:stats-charts:start ── (DOM-free; tests/suites/9e-stats-membership.js evaluates this block)
  // The numbers behind the three Overview charts of the Crisp Colour Stats
  // board: the streak's weekly bars, the weekday × time-of-day grid and the
  // class-type bar. Class times are read off their wall-clock DIGITS (never
  // new Date(string): the digits ARE the gym's clock, in every device zone,
  // and older WebKit cannot parse 'YYYY-MM-DD HH:MM:SS' at all).

  // Five bands of the day, as the board draws them. The first takes
  // everything before 09:00 and the last everything from 18:00, so no class
  // falls off the grid.
  var HEAT_BANDS = [
    { from: 0, label: '06', name: 'early morning' },
    { from: 9, label: '09', name: 'morning' },
    { from: 12, label: '12', name: 'lunchtime' },
    { from: 15, label: '15', name: 'afternoon' },
    { from: 18, label: '18', name: 'evening' },
  ];
  var HEAT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // 'YYYY-MM-DD HH:MM…' (space or T) → { day: 0–6 Monday first, hour } | null.
  function _wallParts(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s == null ? '' : s));
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23) return null;
    var wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // a calendar date has one weekday everywhere
    return { day: (wd + 6) % 7, hour: h };
  }

  function _heatBandIndex(hour) {
    var at = 0;
    for (var i = 0; i < HEAT_BANDS.length; i++) if (hour >= HEAT_BANDS[i].from) at = i;
    return at;
  }

  // 0 = never; 1–4 = quarters of the busiest cell (the old grid's own steps).
  function _heatLevel(count, max) {
    if (!(count > 0) || !(max > 0)) return 0;
    var share = count / max;
    return share < 0.25 ? 1 : share < 0.5 ? 2 : share < 0.75 ? 3 : 4;
  }

  // Class start times → { total, max, counts[band][day], levels[band][day],
  // top: the (up to three) busiest cells, busiest first }.
  function _heatmapModel(starts) {
    var counts = HEAT_BANDS.map(function () { return [0, 0, 0, 0, 0, 0, 0]; });
    var total = 0, max = 0;
    (starts || []).forEach(function (s) {
      var p = _wallParts(s);
      if (!p) return;
      var b = _heatBandIndex(p.hour);
      counts[b][p.day]++;
      total++;
      if (counts[b][p.day] > max) max = counts[b][p.day];
    });
    var cells = [];
    counts.forEach(function (row, b) { row.forEach(function (n, d) { if (n > 0) cells.push({ band: b, day: d, count: n }); }); });
    // Ties keep calendar order (Monday first, then down the day).
    cells.sort(function (a, b) { return b.count - a.count || a.day - b.day || a.band - b.band; });
    return {
      total: total, max: max, counts: counts,
      levels: counts.map(function (row) { return row.map(function (n) { return _heatLevel(n, max); }); }),
      top: cells.slice(0, 3),
    };
  }

  // What the grid says to someone who cannot see it.
  function _heatmapLabel(model) {
    var lead = 'Classes by weekday and time of day.';
    if (!model || !model.top || !model.top.length) return lead;
    return lead + ' Most often: ' + model.top.map(function (c) { return HEAT_DAYS[c.day] + ' ' + HEAT_BANDS[c.band].name; }).join(', ') + '.';
  }

  // The streak's bars: the last `n` weeks, oldest first. `weeks` maps a week
  // index to true; `on` = a class that week, `live` = part of the run that is
  // still going (it may end last week: this week is not over yet).
  function _streakWeeks(weeks, thisWeek, n) {
    weeks = weeks || {};
    var liveFrom = null, cursor = weeks[thisWeek] ? thisWeek : (weeks[thisWeek - 1] ? thisWeek - 1 : null);
    if (cursor !== null) { liveFrom = cursor; while (weeks[liveFrom - 1]) liveFrom--; }
    var out = [];
    for (var w = thisWeek - n + 1; w <= thisWeek; w++) {
      out.push({ on: !!weeks[w], live: !!weeks[w] && liveFrom !== null && w >= liveFrom && w <= cursor });
    }
    return out;
  }

  function _streakWeeksLabel(bars) {
    var on = 0, live = 0;
    (bars || []).forEach(function (b) { if (b.on) on++; if (b.live) live++; });
    var n = (bars || []).length;
    return 'Last ' + n + ' weeks: ' + on + ' with a class' + (live > 1 ? ', ' + live + ' in a row now' : '') + '.';
  }

  // counts by CATEGORY_MAP key + the category list → what the class-type bar
  // draws: rows with a class, biggest first (ct = the data-ct value), and the
  // labels of the types never tried ("Other" is not a type to try).
  function _classTypeBreakdown(counts, cats) {
    counts = counts || {};
    var own = function (k) { return Object.prototype.hasOwnProperty.call(counts, k) ? (Number(counts[k]) || 0) : 0; };
    var rows = [], gaps = [], total = 0;
    (cats || []).forEach(function (c) {
      var n = own(c.key);
      if (n > 0) { rows.push({ key: c.key, ct: String(c.key).toLowerCase(), label: c.label, count: n }); total += n; }
      else if (c.key !== 'OTHER') gaps.push(c.label);
    });
    rows.sort(function (a, b) { return b.count - a.count; });
    return { total: total, rows: rows, gaps: gaps };
  }
  // ── pure:stats-charts:end ──

  // ── Activity Heatmap ────────────────────────────────────────────
  // "When you train": columns = days of the week, rows = five bands of the day.
  // Ink intensity shows how often that slot is booked.

  function renderHeatmap() {
    var container = document.getElementById('heatmapSection');
    if (!container) return;

    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    var history = getFullHistory(); // the shared parse, not one more of its own

    // Merge current bookings + history for a richer picture. Skip cancelled
    // history entries (never attended) and history entries whose event is
    // also in _myBookings (in-app bookings land in history immediately —
    // counting both would double-weight every upcoming class).
    var allEvents = [];
    Object.entries(bookings).forEach(function (entry) {
      if (entry[1] && entry[1].waitlisted) return; // a waitlist place isn't a class you're in
      var evt = cache[entry[0]];
      if (evt) allEvents.push(evt);
    });
    history.forEach(function (h) {
      if (h.cancelledAt || !h.date) return;
      var cur = bookings[String(h.eventId)];
      if (cur && !cur.waitlisted) return;
      allEvents.push({ start_at: h.date });
    });

    if (allEvents.length < 2) { container.style.display = 'none'; return; }
    container.style.display = '';

    // Crisp Colour (the Stats board): seven days across, five bands of the day
    // down — 35 calm cells instead of 126 specks. Graphite, never a class
    // colour: colour keeps ONE meaning. (pure:stats-charts does the counting.)
    var model = _heatmapModel(allEvents.map(function (evt) { return evt.start_at; }));
    var dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    var html = '<div class="heatmap-head">' +
      '<div class="heatmap-title">When you train</div>' +
      '<div class="hm-legend" aria-hidden="true"><span>Less</span>';
    for (var l = 0; l <= 4; l++) html += '<i class="hm-cell hm-level-' + l + '"></i>';
    html += '<span>More</span></div></div>';

    html += '<div class="heatmap-grid" role="img" aria-label="' + escapeHTML(_heatmapLabel(model)) + '">';
    html += '<span class="hm-corner"></span>';
    for (var d = 0; d < 7; d++) html += '<span class="hm-day-label">' + dayLetters[d] + '</span>';
    for (var b = 0; b < HEAT_BANDS.length; b++) {
      html += '<span class="hm-hour-label">' + HEAT_BANDS[b].label + '</span>';
      for (var dd = 0; dd < 7; dd++) {
        var count = model.counts[b][dd];
        var title = count > 0 ? _plural(count, 'class', 'classes') + ' · ' + HEAT_DAYS[dd] + ' ' + HEAT_BANDS[b].name : '';
        html += '<span class="hm-cell hm-level-' + model.levels[b][dd] + '"' + (title ? ' title="' + title + '"' : '') + '></span>';
      }
    }
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
    // A kept-but-unconfirmed token (can't reach Psycle) is still a session the
    // member must be able to end.
    var _hasSession = (typeof currentUser !== 'undefined' && currentUser) ||
      (typeof getBearerToken === 'function' && !!getBearerToken());
    if (_signOut) _signOut.style.display = _hasSession ? '' : 'none';

    // Two Settings rows lead to sections only the iOS app has (on the web the
    // Reminders section is empty and there is no Calendar section). Decided
    // here, per render and before the signed-out return — not in the template:
    // the bridge loads after this file, so a template-time check would hide
    // them in the app as well.
    var _rowReminders = document.getElementById('msRowReminders');
    if (_rowReminders) _rowReminders.style.display = window._nativeReminder ? '' : 'none';
    var _rowCalendar = document.getElementById('msRowCalendar');
    if (_rowCalendar) _rowCalendar.style.display = (typeof window.psycleListCalendars === 'function') ? '' : 'none';

    var sub = (typeof _activeSubscription !== 'undefined') ? _activeSubscription : null;
    var user = (typeof currentUser !== 'undefined') ? currentUser : null;
    var signinEl = document.getElementById('membershipSignin');
    if (!sub && !user) {
      container.style.display = 'none';
      if (signinEl) {
        signinEl.style.display = '';
        // Token still stored but /profile unconfirmed (offline launch, Psycle
        // blip): app.js supplies a Retry hero — never "Sign in" for a member.
        var gate = (typeof authGateHTML === 'function') ? authGateHTML() : '';
        if (gate) { signinEl.innerHTML = gate; return; }
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
      // These dates can arrive as 'YYYY-MM-DD HH:MM:SS', which iOS WebKit reads
      // as Invalid Date — parse them like the rest of the app (My Bookings
      // already does) and print nothing rather than "Invalid Date". A Date goes
      // straight through: parsePsycleDate(String(aDate)) is itself invalid.
      var parseD = function (d) {
        if (d instanceof Date) return d;
        return typeof parsePsycleDate === 'function' ? parsePsycleDate(d) : (d ? new Date(d) : null);
      };
      var fmtD = function (d) {
        var dt = parseD(d);
        return dt && !isNaN(dt.getTime()) ? dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      };
      // period_end is the START of the next period: show the day before.
      var fmtEnd = function (d) {
        var prev = parseD(d);
        if (!prev || isNaN(prev.getTime())) return '';
        prev = new Date(prev.getTime());
        prev.setDate(prev.getDate() - 1);
        return fmtD(prev);
      };
      var periodFrom = fmtD(sub.period_start), periodTo = fmtEnd(sub.period_end);
      var periodLabel = periodFrom && periodTo ? periodFrom + ' – ' + periodTo : '';

      html += '<div class="membership-card">';
      html += '<div class="membership-plan">' + escapeHTML(planName) + '</div>';
      html += '<div class="membership-status">' + escapeHTML(status) + '</div>';
      if (periodLabel) {
        html += '<div class="membership-period">Current period: ' + periodLabel + '</div>';
      }
      if (max > 0) {
        var pct = Math.round((made / max) * 100);
        var remaining = Math.max(0, max - made);   // Psycle can report more made than allowed: never "-1 remaining"
        html += '<div class="membership-usage">' + made + ' of ' + max + ' classes used (' + remaining + ' remaining)</div>';
        html += '<div class="sub-progress" style="margin-top:8px"><div class="sub-progress-fill" style="width:' + Math.min(pct, 100) + '%"></div></div>';
      }

      // Upcoming billing periods
      var periods = sub.upcoming_billing_periods || [];
      // A period whose dates can't be read gets no row (never " — ").
      var periodRows = periods.slice(0, 3).map(function (p) {
        var span = [fmtD(p && p.start), fmtD(p && p.end)].filter(Boolean).join(' – ');
        return span ? '<div class="membership-period-item">' + span +
          (p.pausable ? ' <span class="membership-pausable">Pausable</span>' : '') + '</div>' : '';
      }).filter(Boolean);
      if (periodRows.length > 0) {
        html += '<div class="membership-upcoming-title">Upcoming periods</div>';
        html += '<div class="membership-periods">' + periodRows.join('') + '</div>';
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
      html += '<div class="membership-plan">Credit pack</div>';
      html += '<div class="membership-status">Pay as you go</div>';
      if (totalCredits > 0) {
        html += '<div class="membership-usage">' + totalCredits + ' credit' + (totalCredits !== 1 ? 's' : '') + ' remaining</div>';
      } else {
        html += '<div class="membership-usage">No credits remaining. Top up on psyclelondon.com to book.</div>';
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
    if (!sub) { container.style.display = 'none'; return; }

    var price = Number(sub.plan?.price || sub.price || 0); // price is in pence
    var made = Number(sub.bookings_made) || 0;
    // 0 = an unlimited plan: no cap to measure against. (This read `|| 30`,
    // which nothing reached — unlimited plans were hidden outright, though My
    // Bookings shows them as 'Unlimited'.)
    var max = Number(sub.max_bookings) || 0;
    // Without a price every card read £0.00. An unlimited plan has only
    // bookings_made to go on, so it waits for the first class of the period.
    // (!(price > 0): a price that is not a number at all read "£NaN".)
    if (!(price > 0) || !isFinite(price) || (max === 0 && made < 1)) { container.style.display = 'none'; return; }
    container.style.display = '';
    var priceGbp = price / 100;
    var costPerClass = made > 0 ? priceGbp / made : priceGbp;
    var costAtMax = max > 0 ? priceGbp / max : 0; // never price / 0
    var remaining = Math.max(0, max - made);
    var daysLeft = _daysLeftInBillingPeriod(sub);

    // Savings message — capped plans only ("maxed out your 0 classes" otherwise)
    var savingsMsg = '';
    if (max > 0 && made > 0 && made < max) {
      // Only while the rest of the plan still fits in the days left: "Book 10
      // more" with a day to go is not advice (the pace card says what is left).
      if (remaining <= _bookableMore(made, max, daysLeft)) {
        savingsMsg = 'Book ' + remaining + ' more to hit ' + _formatGbp(costAtMax) + '/class';
      }
    } else if (max > 0 && made >= max) {
      savingsMsg = 'You\'ve maxed out your ' + max + ' classes';
    }

    var html = '<div class="cost-title">Cost tracker</div>';
    html += '<div class="cost-cards">';

    // Cost per class card
    html += '<div class="cost-card cost-main">';
    html += '<div class="cost-value">' + _formatGbp(costPerClass) + '</div>';
    html += '<div class="cost-label">Per class this period</div>'; // bookings_made is per billing period
    html += '</div>';

    // Monthly spend card
    html += '<div class="cost-card">';
    html += '<div class="cost-value">' + _formatGbp(priceGbp) + '</div>';
    html += '<div class="cost-label">Monthly plan</div>';
    html += '<div class="cost-hint">' + escapeHTML(sub.name || 'Unlimited') + '</div>';
    html += '</div>';

    // Target card (a cap to aim for: capped plans only)
    if (max > 0) {
      html += '<div class="cost-card">';
      html += '<div class="cost-value">' + _formatGbp(costAtMax) + '</div>';
      html += '<div class="cost-label">Best possible</div>';
      html += '<div class="cost-hint">If you use all ' + max + ' classes</div>';
      html += '</div>';
    }

    // Pace card
    if (max > 0 && daysLeft > 0 && remaining > 0) {
      html += '<div class="cost-card">';
      if (daysLeft < 7) {
        // Under a week left a weekly rate is nonsense: 4 classes in 3 days
        // read "10 per week needed". Say what is left instead.
        html += '<div class="cost-value">' + remaining + '</div>';
        html += '<div class="cost-label">Left this period</div>';
        html += '<div class="cost-hint">' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' to go</div>';
      } else {
        var perWeek = Math.ceil(remaining / (daysLeft / 7));
        html += '<div class="cost-value">' + perWeek + '</div>';
        html += '<div class="cost-label">Per week needed</div>';
        html += '<div class="cost-hint">' + remaining + ' class' + (remaining !== 1 ? 'es' : '') + ' in ' + daysLeft + ' days</div>'; // daysLeft >= 7 here
      }
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

  // ── pure:cost-forecast:start ── (DOM-free; tests/suites/3d-leftovers.js evaluates this block)
  var FORECAST_TARGET_GBP = 10; // "good value" threshold, £/class
  var FORECAST_MAX_PER_DAY = 2; // a double is a stretch already; more is not advice

  // The most classes a "Book N more" line may ask for: what the plan still
  // holds (max 0 = unlimited) and what fits in the days left, today included.
  function _bookableMore(made, max, daysLeft) {
    var byDays = (Math.max(0, Math.floor(Number(daysLeft) || 0)) + 1) * FORECAST_MAX_PER_DAY;
    if (!(max > 0)) return byDays;
    return Math.max(0, Math.min(max - made, byDays));
  }

  // The forecast's one-line verdict. It sits under the cards, so it may never
  // ask for more than they show is left: capped at 12 with 10 made it read
  // "Book 2 more to beat £10.00/class" on a plan whose best is £11.67, and
  // with a day to go it asked for a week's worth of classes.
  function _forecastVerdict(made, max, priceGbp, costAtMax, projected, projectedCost, daysLeft) {
    if (max > 0 && projected >= max) {
      return 'On pace to use all ' + max + ' classes, ' + _formatGbp(costAtMax) + '/class';
    }
    if (projectedCost <= FORECAST_TARGET_GBP) {
      return 'On pace for ' + _formatGbp(projectedCost) + '/class';
    }
    var onPace = 'On pace for ' + _formatGbp(projectedCost) + '/class';
    // How many more to drop under the target?
    var needed = Math.ceil(priceGbp / FORECAST_TARGET_GBP) - made;
    if (!(needed > 0) || !isFinite(needed)) return onPace;
    // More than the plan holds: every class used still lands above the target.
    if (max > 0 && needed > max - made) {
      return onPace + '. This plan\'s best is ' + _formatGbp(costAtMax) + '/class.';
    }
    if (needed > _bookableMore(made, max, daysLeft)) {
      return onPace + '. Too few days left to beat ' + _formatGbp(FORECAST_TARGET_GBP) + '/class.';
    }
    return 'Book ' + needed + ' more to beat ' + _formatGbp(FORECAST_TARGET_GBP) + '/class';
  }
  // ── pure:cost-forecast:end

  // Returns the forecast block HTML (or '' if there isn't enough to forecast).
  function _forecastHtml(sub, made, max, priceGbp, costAtMax) {
    if (!(priceGbp > 0) || !isFinite(priceGbp)) return '';

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
    var verdict = _forecastVerdict(made, max, priceGbp, costAtMax, projected, projectedCost, daysLeft);

    var html = '<div class="forecast-block">';
    html += '<div class="forecast-head">';
    html += '<div class="forecast-stat"><span class="forecast-num">' + projected + '</span><span class="forecast-cap">projected classes</span></div>';
    html += '<div class="forecast-stat"><span class="forecast-num">' + _formatGbp(projectedCost) + '</span><span class="forecast-cap">projected per class</span></div>';
    html += '</div>';
    html += '<div class="forecast-meta">' + made + ' booked · day ' + daysElapsed + ' of ' + totalDays + ' · ' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left</div>';
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
        // aria-pressed: the chosen theme was a border colour only. _pickTheme
        // re-renders the whole picker, so it can't go stale.
        // The swatch is a miniature of the theme's own chrome: it carries
        // data-theme, so css/theme.css's token block for THAT theme applies
        // inside it (ground, a surface card with an ink line, the accent pill).
        // No colour is copied here — and Cloud and Graphite, whose accent is
        // their ink, no longer lose a dot against a chip of the same tone.
        return '<button class="theme-chip' + (t.id === current ? ' active' : '') + '" aria-pressed="' + (t.id === current) + '" onclick="window._pickTheme(\'' + t.id + '\')">' +
          '<span class="theme-swatch" data-theme="' + t.id + '" aria-hidden="true">' +
            '<span class="theme-swatch-card"><span class="theme-swatch-ink"></span><span class="theme-swatch-pill"></span></span>' +
          '</span>' +
          '<span class="theme-chip-name">' + t.name + '</span>' +
        '</button>';
      }).join('') +
      '</div>';
    renderClassColours();
  }

  window._pickTheme = function (id) {
    if (typeof setAppTheme === 'function') setAppTheme(id);
    renderThemePicker();
  };

  // ── Class colours (Membership → Appearance) ────────────────────
  // The member's control over Crisp Colour: how strong the class colours are
  // (Off · Soft · Bold) and which swatch each class type wears. Everything is
  // read from and written through window.PsycleClassColours (js/theme.js) —
  // this file keeps no copy of the choices, names no colour of its own, and a
  // change shows at once across the app (the engine rewrites the --ct-* tokens
  // every class component reads).

  // ── pure:class-colour-control:start ── (DOM-free; tests/suites/9e-stats-membership.js evaluates this block)
  var CC_INTENSITY_LABELS = { off: 'Off', soft: 'Soft', bold: 'Bold' };
  // What the preview card says for each class type (decoration — never timetable data).
  // The tick on a chosen swatch. Every base of the engine's palette, on either
  // side, carries white at ≥ 4.5:1 (tests/suites/9a-foundation.js holds it to
  // that) — and a swatch shows the PALETTE colour even on a mono theme, where
  // --ct-on-base is the theme's own label ink.
  var CC_SWATCH_INK = '#FFFFFF';
  var CC_PREVIEW = {
    ride: 'Ride 45', strength: 'Strength 45', yoga: 'Yoga Flow', hiit: 'HIIT 45',
    pilates: 'Reformer 50', lagree: 'Lagree 50', barre: 'Barre 55', other: 'Sound Bath',
  };

  function _ccHas(obj, k) { return !!obj && Object.prototype.hasOwnProperty.call(obj, k); }

  // Everything the control draws, from what the engine says.
  //   api   window.PsycleClassColours ({ KEYS, INTENSITIES, PALETTE, DEFAULTS, get() })
  //   cats  app.js CATEGORY_MAP (the labels the Discover pills use)
  //   theme the APP_THEMES entry on screen ({ base, mono })
  //   open  the class type whose swatches are showing, or ''
  // → { intensity, intensities: [{ id, label, checked }], muted, canReset,
  //     preview: { key, name }, rows: [{ key, label, swatch, swatchName, open,
  //     swatches: [{ id, name, colour, checked }] }] }
  // `muted`: a mono theme below Bold wears its own accent ladder, so the
  // per-type choices do not show — the control says so instead of looking broken.
  // A swatch id or class key the engine does not know never reaches the markup.
  function _ccControlModel(api, cats, theme, open) {
    if (!api || typeof api.get !== 'function') return null;
    var state = api.get() || {};
    var map = state.map || {};
    var side = theme && theme.base === 'dark' ? 'dark' : 'light';
    var labels = {};
    (cats || []).forEach(function (c) { if (c && c.key) labels[String(c.key).toLowerCase()] = c.label; });
    var swatchIds = Object.keys(api.PALETTE || {});
    var keys = (api.KEYS || []).slice();
    var openKey = keys.indexOf(open) !== -1 ? open : '';
    var custom = false;
    var rows = keys.map(function (k) {
      var chosen = _ccHas(api.PALETTE, map[k]) ? map[k] : (api.DEFAULTS || {})[k];
      if (chosen !== (api.DEFAULTS || {})[k]) custom = true;
      var swatches = swatchIds.map(function (id) {
        // Only a plain hex colour goes into a style attribute.
        var base = String(((api.PALETTE[id] || {})[side] || {}).base || '');
        return { id: id, name: String(api.PALETTE[id].name || id), colour: /^#[0-9a-f]{6}$/i.test(base) ? base : '', checked: id === chosen };
      });
      var mine = swatches.filter(function (s) { return s.checked; })[0];
      return {
        key: k,
        label: labels[k] || (k.charAt(0).toUpperCase() + k.slice(1)),
        swatch: chosen,
        swatchName: mine ? mine.name : '',
        swatchColour: mine ? mine.colour : '',
        open: k === openKey,
        swatches: swatches,
      };
    });
    var intensity = (api.INTENSITIES || []).indexOf(state.intensity) !== -1 ? state.intensity : api.DEFAULT_INTENSITY;
    return {
      intensity: intensity,
      intensities: (api.INTENSITIES || []).map(function (id) { return { id: id, label: CC_INTENSITY_LABELS[id] || id, checked: id === intensity }; }),
      muted: !!(theme && theme.mono) && intensity !== 'bold',
      canReset: custom || intensity !== api.DEFAULT_INTENSITY,
      preview: { key: openKey || keys[0] || 'other', name: CC_PREVIEW[openKey || keys[0]] || '' },
      rows: rows,
    };
  }

  // A key pressed on radio `index` of `count` → the radio to move to (and
  // check: in a radio group selection follows focus), or -1 when the key is not
  // the group's. Arrows wrap; Home / End jump to the ends.
  function _ccRadioTarget(count, index, key) {
    if (!(count > 0)) return -1;
    if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
    if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return -1;
  }
  // ── pure:class-colour-control:end ──

  var _ccOpenKey = ''; // the row whose swatches are showing (one at a time) — memory only

  function _ccThemeNow() {
    var id = document.documentElement.getAttribute('data-theme');
    var list = window.APP_THEMES || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  var CC_TICK = '<svg class="cc-swatch-tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5.5 12.5l4.5 4.5 8.5-9.5"/></svg>';

  function _ccControlHtml(m) {
    var pic = function (key, size) { return (typeof classPictogram === 'function') ? classPictogram(key, size) : ''; };
    // The preview IS the class card (js/app.js eventCard's anatomy: the shared
    // time block, .cc-head, .cc-sub, .cc-spots, the Book pill — all styled by
    // css/crisp.css 9b.7 from `.class-card[data-ct]`), so what the member sees
    // here is what Discover will show. Nothing to press in it: spans, no ids,
    // aria-hidden, and .cc-preview takes it out of reach of the pointer.
    var html =
      '<div class="cc-preview class-card ct-card" data-ct="' + m.preview.key + '" aria-hidden="true">' +
        (typeof _ccTimeHTML === 'function' ? _ccTimeHTML({ hours: 18, mins: 30, duration: 45 }) : '') +
        '<div class="cc-info">' +
          '<span class="cc-head"><span class="ct-tile">' + pic(m.preview.key, 18) + '</span><span class="cc-name">' + escapeHTML(m.preview.name) + '</span></span>' +
          '<span class="cc-sub"><span class="cc-who">Maya</span><span class="cc-loc">Shoreditch</span></span>' +
          '<span class="cc-spots">25 spots left</span>' +
        '</div>' +
        '<div class="cc-action"><span class="book-btn">Book</span></div>' +
      '</div>';

    html += '<div class="seg cc-intensity" role="radiogroup" aria-label="Colour strength">' +
      m.intensities.map(function (i) {
        return '<button type="button" class="seg-btn" role="radio" aria-checked="' + i.checked + '" tabindex="' + (i.checked ? '0' : '-1') +
          '" data-cc-intensity="' + i.id + '" data-cc-focus="int:' + i.id + '">' + i.label + '</button>';
      }).join('') +
    '</div>';
    if (m.muted) html += '<p class="cc-note">Shown at Bold only in this theme.</p>';

    html += '<div class="cc-rows">' + m.rows.map(function (r) {
      var panelId = 'ccSwatches-' + r.key;
      return '<div class="cc-row' + (r.open ? ' is-open' : '') + '" data-ct="' + r.key + '">' +
        '<button type="button" class="cc-row-btn" aria-expanded="' + r.open + '" aria-controls="' + panelId + '" data-cc-row="' + r.key + '" data-cc-focus="row:' + r.key + '">' +
          '<span class="ct-tile is-lg is-solid" aria-hidden="true">' + pic(r.key, 20) + '</span>' +
          '<span class="cc-row-name">' + escapeHTML(r.label) + '</span>' +
          // The dot is the CHOSEN swatch itself (the palette's colour), also on a
          // mono theme, where the tile beside the name wears the theme's accent.
          '<span class="cc-row-swatch"><span class="cc-row-swatch-name">' + escapeHTML(r.swatchName) + '</span><span class="cc-row-dot" aria-hidden="true" style="--cc-sw:' + r.swatchColour + '"></span></span>' +
        '</button>' +
        '<div class="cc-swatches" id="' + panelId + '" role="radiogroup" aria-label="' + escapeHTML(r.label) + ' colour"' + (r.open ? '' : ' hidden') + '>' +
          (r.open ? r.swatches.map(function (s) {
            // The swatch's own colour is data from the engine's palette, handed
            // to the stylesheet as a custom property. Chosen = a tick and a
            // ring, never the colour alone; its name is what is read out.
            return '<button type="button" class="cc-swatch" role="radio" aria-checked="' + s.checked + '" tabindex="' + (s.checked ? '0' : '-1') +
              '" aria-label="' + escapeHTML(s.name) + '" title="' + escapeHTML(s.name) + '" data-cc-key="' + r.key + '" data-cc-swatch="' + s.id +
              '" data-cc-focus="sw:' + r.key + ':' + s.id + '" style="--cc-sw:' + s.colour + ';--cc-sw-ink:' + CC_SWATCH_INK + '">' + CC_TICK + '</button>';
          }).join('') : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';

    html += '<button type="button" class="pill-btn pill-quiet cc-reset" data-cc-reset="1" data-cc-focus="reset"' + (m.canReset ? '' : ' disabled') + '>Reset colours</button>';
    return html;
  }

  // Rebuilt whole on every change (it is small), with the focus put back where
  // it was: a radio group rebuilt under the keyboard must not drop the member
  // at the top of the page.
  function renderClassColours() {
    var box = document.getElementById('classColours');
    if (!box) return;
    var m = _ccControlModel(window.PsycleClassColours, (typeof CATEGORY_MAP !== 'undefined') ? CATEGORY_MAP : [], _ccThemeNow(), _ccOpenKey);
    var title = document.getElementById('classColoursTitle');
    if (title) title.style.display = m ? '' : 'none';
    if (!m) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    var html = _ccControlHtml(m);
    if (box._ccHtml === html) return;
    var held = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute('data-cc-focus') : null;
    box.innerHTML = html;
    box._ccHtml = html;
    _wireClassColours(box);
    if (!held) return;
    var back = null;
    box.querySelectorAll('[data-cc-focus]').forEach(function (el) { if (el.getAttribute('data-cc-focus') === held && !el.disabled) back = el; });
    // Reset disables itself once there is nothing to reset: the heading row of
    // the first class type is the nearest thing still there.
    if (!back) back = box.querySelector('.cc-row-btn');
    if (back) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } }
  }
  window.renderClassColours = renderClassColours;

  function _ccSet(partial, said) {
    var api = window.PsycleClassColours;
    if (!api) return;
    api.set(partial);
    if (typeof window.pushAction === 'function') window.pushAction('classcolours:set');
    if (typeof haptic === 'function') haptic('tap');
    renderClassColours(); // the engine only emits when something changed; this also covers a no-op tap
    if (said && typeof announce === 'function') announce(said);
  }

  // Once per container (it outlives every repaint of its contents).
  function _wireClassColours(box) {
    if (box._ccWired) return;
    box._ccWired = true;
    box.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-cc-intensity], [data-cc-swatch], [data-cc-row], [data-cc-reset]') : null;
      if (!t || !box.contains(t) || t.disabled) return;
      if (t.hasAttribute('data-cc-intensity')) { _ccSet({ intensity: t.getAttribute('data-cc-intensity') }); return; }
      if (t.hasAttribute('data-cc-swatch')) {
        var map = {};
        map[t.getAttribute('data-cc-key')] = t.getAttribute('data-cc-swatch');
        _ccSet({ map: map });
        return;
      }
      if (t.hasAttribute('data-cc-row')) {
        var key = t.getAttribute('data-cc-row');
        _ccOpenKey = _ccOpenKey === key ? '' : key;
        renderClassColours();
        return;
      }
      if (window.PsycleClassColours) {
        window.PsycleClassColours.reset();
        _ccOpenKey = '';
        if (typeof window.pushAction === 'function') window.pushAction('classcolours:reset');
        renderClassColours();
        if (typeof announce === 'function') announce('Class colours reset');
      }
    });
    // Radio groups: arrows move AND choose (selection follows focus), Home /
    // End jump; Tab leaves the group — only the checked radio is a tab stop.
    box.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var radio = e.target && e.target.closest ? e.target.closest('[role="radio"]') : null;
      var group = radio ? radio.closest('[role="radiogroup"]') : null;
      if (!group || !box.contains(group)) return;
      var radios = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
      var to = _ccRadioTarget(radios.length, radios.indexOf(radio), e.key);
      if (to === -1) return;
      e.preventDefault();
      radios[to].focus();
      radios[to].click();
    });
  }

  // The engine changed something (this control, an import, the iOS restore),
  // or the theme did (the swatches show the palette side of its base).
  if (typeof PsycleEvents !== 'undefined') {
    PsycleEvents.on('classcolours:changed', function () { if (_currentTab === 'membership') renderClassColours(); });
    // (The picker too: the header's sun / moon button changes the theme while
    // Membership is open, and the pressed chip would go stale.)
    PsycleEvents.on('theme:changed', function () { if (_currentTab === 'membership') renderThemePicker(); });
  }
  // The picker + reminder row render inside the Settings panel, which
  // settings.js builds — expose so it can trigger them after opening.
  window.renderThemePicker = renderThemePicker;
  window.renderReminderRow = renderReminderRow;

  // ── Weekly reminder row (the native apps only — needs the native bridge) ──

  // Last known answer to "may Psync send notifications?" for the class
  // switch. null = not resolved yet this session (first paint goes by the
  // pref alone, then corrects itself below).
  var _classReminderGranted = null;

  // ── pure:reminder-row:start
  // What the class-reminder switch shows. The pref defaults ON, but nothing
  // is scheduled without notification permission — a switch that reads on
  // while nothing is armed invites no tap. So it is on only when it really
  // is, and the detail line says what a tap will do. (Detail strings are
  // literals — they go into innerHTML unescaped.)
  // `android` (optional): the Android app — it has no Live Activity for the
  // reminder to open. Its countdown is a second, silent notification, and this
  // switch is its switch too, so the line says so. Left out, the iPhone app's
  // line, as before.
  function _classReminderSwitch(prefOn, granted, android) {
    var blocked = !!prefOn && granted === false;
    var row = {
      on: !!prefOn && !blocked,
      detail: blocked ? 'Tap to allow notifications' : '90 minutes before each class. Opens the live countdown.',
    };
    if (android && !blocked) row.detail = '90 minutes before each class. With a countdown notification.';
    return row;
  }
  // ── pure:reminder-row:end

  // These rows exist in both native apps. Two things are said differently in
  // the Android one: its countdown is a notification, not a Live Activity
  // (above), and the Settings app a refused permission is put right in is
  // Android's. The toasts below are written as the iPhone app's sentence and
  // re-worded here, so the iPhone app's copy stays the literal it always was.
  function _reminderAndroid() {
    try {
      return !!(window.Capacitor && typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() === 'android');
    } catch (e) { return false; }
  }
  function _osSettingsWords(text) {
    return _reminderAndroid() ? String(text).replace('iOS Settings', 'Android Settings') : text;
  }

  function renderReminderRow() {
    var row = document.getElementById('reminderRow');
    if (!row) return;
    if (!window._nativeReminder) { row.innerHTML = ''; return; }
    _paintReminderRow(row);
    var api = window._nativeClassReminders;
    if (!api || typeof api.hasPermission !== 'function') return;
    api.hasPermission().then(function (granted) {
      granted = !!granted;
      if (granted === _classReminderGranted) return;
      _classReminderGranted = granted;
      // Repaint whatever row is live NOW (the panel may have been rebuilt
      // or closed while the bridge call was in flight).
      var live = document.getElementById('reminderRow');
      if (live && window._nativeReminder) _paintReminderRow(live);
    }, function () {});
  }

  // Back from iOS Settings — where a blocked row sends people — nothing else
  // repaints it, so it would keep showing the old answer. (No-op unless the
  // Settings panel is open.)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') renderReminderRow();
  });

  function _paintReminderRow(row) {
    var on = window._nativeReminder.isOn();
    // role="switch" + aria-checked on the row itself: the drawn switch is
    // aria-hidden, so on / off was invisible to a screen reader. Both toggles
    // repaint this row, so the state is always the one just painted.
    var html =
      '<button class="app-row" role="switch" aria-checked="' + !!on + '" onclick="window._toggleReminder()">' +
        '<span class="app-row-text"><span class="app-row-label">Monday booking reminder</span>' +
        '<span class="app-row-detail">Mondays at 12:00 — when Psycle opens new dates</span></span>' +
        '<span class="app-row-switch' + (on ? ' on' : '') + '" aria-hidden="true"></span>' +
      '</button>';
    if (window._nativeClassReminders) {
      var cls = _classReminderSwitch(window._nativeClassReminders.isOn(), _classReminderGranted, _reminderAndroid());
      html +=
        '<button class="app-row" role="switch" aria-checked="' + !!cls.on + '" onclick="window._toggleClassReminders()">' +
          '<span class="app-row-text"><span class="app-row-label">Class reminders</span>' +
          '<span class="app-row-detail">' + cls.detail + '</span></span>' +
          '<span class="app-row-switch' + (cls.on ? ' on' : '') + '" aria-hidden="true"></span>' +
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
      // Go by what the row SHOWS as well: permission granted in iOS Settings
      // since the last paint leaves it reading "Tap to allow notifications" —
      // that tap means on, never "turn them off".
      if (!hasPerm || _classReminderGranted === false) {
        var granted = await window._nativeClassReminders.enable();
        _classReminderGranted = !!granted; // known now — don't repaint from the stale answer
        toast(granted ? 'Class reminders on' : _osSettingsWords('Enable notifications for Psync in iOS Settings first'), granted ? 'success' : 'error');
      } else {
        await window._nativeClassReminders.disable();
        toast('Class reminders off', 'info');
      }
    } else {
      var ok = await window._nativeClassReminders.enable();
      if (ok) _classReminderGranted = true; // enable() only succeeds once permission is granted
      toast(ok ? 'Class reminders on' : _osSettingsWords('Enable notifications for Psync in iOS Settings first'), ok ? 'success' : 'error');
    }
    renderReminderRow();
  };

  window._toggleReminder = async function () {
    if (!window._nativeReminder) return;
    if (window._nativeReminder.isOn()) {
      await window._nativeReminder.disable();
      toast('Monday reminder off', 'info');
    } else {
      var ok = await window._nativeReminder.enable();
      toast(ok ? 'Monday reminder on' : _osSettingsWords('Enable notifications for Psync in iOS Settings first'), ok ? 'success' : 'error');
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

    // Count by category — classes TAKEN, the rows "All time" above counts
    // (_takenRows): the bar sits under that figure and has to add up to it,
    // not to it plus next week's bookings.
    var catCounts = {};
    var total = 0;
    _takenRows(history, Date.now(), _historyStartMs()).forEach(function (h) {
      var cat = (typeof getCategory === 'function') ? getCategory(h.typeName) : null;
      var key = cat ? cat.key : 'OTHER';
      catCounts[key] = (catCounts[key] || 0) + 1;
      total++;
    });

    if (total === 0) { container.style.display = 'none'; return; }
    container.style.display = '';

    // Crisp Colour (the Stats board): ONE bar split by class type and a legend
    // that carries the numbers. Every colour is the member's own class-type
    // colour: the segment and the dot get data-ct and css/crisp.css does the
    // rest — no colour is named here. The bar is decoration (aria-hidden); the
    // legend is the text.
    var data = _classTypeBreakdown(catCounts, (typeof CATEGORY_MAP !== 'undefined') ? CATEGORY_MAP : []);

    var html = '<div class="ctd-head">' +
      '<div class="insights-title">Class types</div>' +
      '<div class="ctd-total">' + _plural(data.total, 'class', 'classes') + '</div>' +
    '</div>';
    html += '<div class="ctd-bar" aria-hidden="true">' +
      data.rows.map(function (c) { return '<span class="ctd-seg" data-ct="' + c.ct + '" style="flex-grow:' + c.count + '"></span>'; }).join('') +
    '</div>';
    html += '<ul class="ctd-legend">' +
      data.rows.map(function (c) {
        return '<li class="ctd-item" data-ct="' + c.ct + '"><span class="ct-dot" aria-hidden="true"></span>' +
          '<span class="ctd-name">' + escapeHTML(c.label) + '</span><span class="ctd-count">' + c.count + '</span></li>';
      }).join('') +
    '</ul>';

    // Show gaps — class types with 0 bookings
    if (data.gaps.length > 0) {
      html += '<div class="ct-gaps">Never tried: ' + escapeHTML(data.gaps.join(', ')) + '</div>';
    }

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
      // A date that does not read as one has no month: the first seven
      // characters of "garbage" used to get a column of their own ("ge").
      var ym = /^\d{4}-(0[1-9]|1[0-2])(?!\d)/.exec(String(h.date));
      if (!ym) return;
      var key = ym[0]; // "YYYY-MM"
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
    // The heading carries the chart's unit; it used to need a subtitle for it.
    var html = '<div class="insights-title">Instructors per month</div>';
    html += '<div class="variety-chart">';
    for (var i = 0; i < sorted.length; i++) {
      var key = sorted[i][0];
      var data = sorted[i][1];
      var instrH = Math.max(4, Math.round(data.instructors.size / maxInstr * 80));
      var label = key.substring(5); // "03" from "2025-03"
      var monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var monthLabel = monthNames[parseInt(label)] || label;

      html += '<div class="variety-col" title="' + monthLabel + ': ' + _plural(data.instructors.size, 'instructor') + ', ' + _plural(data.total, 'class', 'classes') + '">' +
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

  // ── pure:year-review:start ── (DOM-free; tests/suites/year-review.js evaluates this block)
  // The rows a year's wrap may count: this year's, not cancelled — and not
  // still to come. History holds a booking from the moment it is made
  // (features.js records it on booking:complete, its /bookings reconcile adds
  // the rest), so next week's classes were counted as taken, ran the "longest
  // streak" into the future and went out on the share image under CLASSES
  // TAKEN. `startMs`: app.js's London resolver (h.date is gym wall clock). A
  // date nothing can place is not provably ahead: it stays in, as before.
  function _yearReviewRows(history, year, nowMs, startMs) {
    return history.filter(function (h) {
      return !h.cancelledAt && h.date && String(h.date).substring(0, 4) === String(year) &&
        !(startMs(h.date) > nowMs);
    });
  }
  // The same test over every year: what the Stats tiles ("This month", "All
  // time") and the "Share my stats" image may count — they still took next
  // week's bookings for classes taken after the wrap had stopped.
  function _takenRows(history, nowMs, startMs) {
    return history.filter(function (h) { return !!h && !h.cancelledAt && !(startMs(h.date) > nowMs); });
  }
  // ── pure:year-review:end ──

  // app.js's London resolver (h.date is gym wall clock); the device-local
  // parse only when app.js is absent — the same pair _stillToCome falls back on.
  function _historyStartMs() {
    return (typeof _gymClassStartMs === 'function') ? _gymClassStartMs
      : function (d) { return new Date(String(d).replace(' ', 'T')).getTime(); };
  }

  // Is there a class TAKEN to show? shareInsights' own test — renderInsights
  // offers "Share my stats" by it.
  function _hasTakenHistory() {
    return _takenRows(getFullHistory(), Date.now(), _historyStartMs()).length > 0;
  }

  // Aggregate this year's attended history into a tidy summary object.
  function _computeYearReview(year) {
    // Same clock as _stillToCome (and the same fallback when app.js is absent).
    var startMs = (typeof _gymClassStartMs === 'function') ? _gymClassStartMs
      : function (d) { return new Date(String(d).replace(' ', 'T')).getTime(); };
    var history = _yearReviewRows(getFullHistory(), year, Date.now(), startMs);
    if (history.length === 0) return null;

    var instrCount = {}, studioCount = {}, dowCount = {}, hourCount = {}, minuteVotes = {};
    var weeks = {};
    history.forEach(function (h) {
      if (h.instrName) instrCount[h.instrName] = (instrCount[h.instrName] || 0) + 1;
      if (h.locName) studioCount[h.locName] = (studioCount[h.locName] || 0) + 1;
      var dt = new Date(String(h.date).replace(' ', 'T'));
      if (isNaN(dt.getTime())) return;
      dowCount[dt.getDay()] = (dowCount[dt.getDay()] || 0) + 1;
      var hh = dt.getHours(), mm = dt.getMinutes();
      hourCount[hh] = (hourCount[hh] || 0) + 1;
      if (!minuteVotes[hh]) minuteVotes[hh] = {};
      minuteVotes[hh][mm] = (minuteVotes[hh][mm] || 0) + 1;
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

    // The hour trained most, at the minute most of those classes start — the
    // same vote renderHabitSlots takes ("Mondays ~18:30"). A bare hour printed
    // as HH:MM ("18:00") named a time an 18:30 regular has never trained at.
    var favTime = '';
    if (topHour) {
      var votes = minuteVotes[topHour[0]] || {};
      var topMinute = 0, topMinuteCount = -1;
      Object.keys(votes).forEach(function (mk) {
        if (votes[mk] > topMinuteCount) { topMinuteCount = votes[mk]; topMinute = Number(mk); }
      });
      favTime = _clock24(Number(topHour[0]), topMinute); // "18:30"
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
    // Crisp Colour (the Stats board): one pill — its name, the year, and an
    // arrow in a graphite disc (decoration: the button's name is its text).
    container.innerHTML =
      '<button type="button" class="year-review-btn" onclick="openYearReview()">' +
        '<span class="year-review-btn-text">' +
          '<span class="year-review-btn-main">Year in review</span> ' +
          '<span class="year-review-btn-year">' + year + '</span>' +
        '</span>' +
        '<span class="year-review-btn-go" aria-hidden="true">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>' +
        '</span>' +
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

    // role / label / tabindex: app.js's overlay handling moves focus onto the
    // panel, keeps Tab inside it and closes it on Escape.
    overlay.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="yearReviewTitle" tabindex="-1">' +
        '<div class="modal-header">' +
          '<div>' +
            '<div class="modal-title" id="yearReviewTitle">' + year + ' in review</div>' +
            '<div class="modal-subtitle">Your year at Psycle</div>' +
          '</div>' +
          '<button class="modal-close" onclick="document.getElementById(\'yearReviewOverlay\').remove()" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="yr-rows">' + rowsHtml + '</div>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="share-insights-btn" onclick="shareYearReview()">Share my ' + year + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
  };

  // ── Share images (year wrap + stats card): shared helpers ───────
  // The one thing members post outside the app, so it wears the theme they
  // are looking at and the app's own name — not a pink "P S Y C L E" on black.

  // The ANDROID app's web view has no Web Share API and no download manager:
  // navigator.share is missing, and the <a download> click both functions fall
  // back to does nothing there — under a toast that said "Image saved". An
  // image needs a file on disk, which needs a plugin the app does not carry, so
  // there the card's own line goes out as TEXT through the native share sheet
  // (the bridge's nativeShare), and the toast says what happened. Resolves true
  // when it took the share over; false everywhere else, where nothing changes.
  async function _shareAsTextOnAndroid(title, text) {
    var android = false;
    try {
      android = !!(window.Capacitor && typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() === 'android');
    } catch (e) {}
    if (!android || typeof window.nativeShare !== 'function') return false;
    var shared = await window.nativeShare(title, text, null);
    toast(shared ? 'Shared' : 'Share cancelled', shared ? 'success' : 'info');
    return true;
  }

  // ── pure:share:start ── (DOM-free; tests/suites/copy.js evaluates this block)
  // Cloud, whole. Canvas silently IGNORES an invalid fillStyle (it keeps the
  // previous colour), so a token that cannot be read is never mixed with ones
  // that can: one theme's dark ink on another's dark paper is an unreadable
  // image. Any miss → this complete, known-good set.
  var SHARE_FALLBACK = { bg: '#e6e9ee', panel: '#fcfdfe', border: '#d3d9e1', heading: '#1b2130', muted: '#3a4252', accent: '#1b2130' };
  // Small grey labels read `muted` (--text-muted), never --text-faint: faint
  // is under 3:1 in Handheld, and these labels are 9–13px.
  var SHARE_TOKENS = { bg: '--bg', panel: '--bg-panel', border: '--border', heading: '--text-heading', muted: '--text-muted', accent: '--accent' };
  // One credit line for both images (they were signed "Psycle Companion" and
  // "Psycle Class Finder" — neither is the app's name).
  var SHARE_FOOTER = 'Made with Psync · an independent companion for Psycle members';
  // Export scale: a fixed integer, not devicePixelRatio — the PNG is looked at
  // on OTHER devices, and a fractional ratio (2.625) gives a non-integer
  // canvas. 640x820 @3 = 1920x2460, well inside iOS's 16.7M-pixel canvas cap.
  var SHARE_SCALE = 3;

  // read(tokenName) → the custom property's text, e.g. ' #efeee9'.
  function _sharePaletteFrom(read) {
    var out = {};
    for (var k in SHARE_TOKENS) {
      var v = String(read(SHARE_TOKENS[k]) || '').trim();
      if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) && !/^(?:rgb|hsl)a?\(/i.test(v)) return SHARE_FALLBACK;
      out[k] = v;
    }
    return out;
  }
  // ── pure:share:end ──

  function _sharePalette() {
    try {
      var cs = getComputedStyle(document.documentElement);
      return _sharePaletteFrom(function (name) { return cs.getPropertyValue(name); });
    } catch (e) { return SHARE_FALLBACK; }
  }

  // A W x H surface exported at SHARE_SCALE: every coordinate below stays in
  // 640-wide layout units, the pixels are 3x (a 640px PNG went soft as soon as
  // Messages or Instagram scaled it up to a phone's ~1170px width).
  function _shareCanvas(W, H) {
    var canvas = document.createElement('canvas');
    canvas.width = W * SHARE_SCALE; canvas.height = H * SHARE_SCALE;
    var ctx = canvas.getContext('2d');
    ctx.scale(SHARE_SCALE, SHARE_SCALE);
    return { canvas: canvas, ctx: ctx };
  }

  // Wait for the display face so the wordmark is not drawn in a fallback —
  // but never for long: navigator.share() spends the tap's activation, which a
  // slow font fetch would let lapse. The app header already uses this face, so
  // in practice it is loaded and this settles at once.
  // Crisp Colour's two faces (css/theme.css --font-display / --font-body): the
  // condensed display face for the wordmark and every numeral, the body face
  // for everything else. A canvas cannot read var(), so the stacks are here.
  var SHARE_WORDMARK_FONT = "900 22px 'Sofia Sans Condensed'";
  var SHARE_DISPLAY = "'Sofia Sans Condensed', 'Avenir Next Condensed', 'Helvetica Neue', sans-serif";
  var SHARE_BODY = "'Sofia Sans', 'Helvetica Neue', Helvetica, sans-serif";
  function _shareFontReady() {
    try {
      if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
      return Promise.race([
        Promise.all([
          document.fonts.load(SHARE_WORDMARK_FONT),
          document.fonts.load("600 12px 'Sofia Sans'"),
        ]).catch(function () {}),
        new Promise(function (resolve) { setTimeout(resolve, 250); }),
      ]);
    } catch (e) { return Promise.resolve(); }
  }

  // "Psync" + the image's section label, on one baseline.
  function _shareWordmark(ctx, pal, y, label) {
    ctx.fillStyle = pal.heading;
    ctx.font = SHARE_WORDMARK_FONT + ", 'Avenir Next Condensed', 'Helvetica Neue', sans-serif";
    ctx.fillText('Psync', 32, y);
    var wordW = ctx.measureText('Psync').width;
    ctx.fillStyle = pal.muted;
    ctx.font = '700 12px ' + SHARE_BODY;
    ctx.fillText(label, 32 + wordW + 12, y);
  }

  // The class-type colour in effect, as a literal a canvas can paint: the
  // member's own swatch through the engine (js/theme.js resolve() reads it
  // back off the page, so the mono themes answer too), else the category's
  // own colour, else the theme accent.
  function _shareClassColour(cat, pal) {
    try {
      var r = (typeof window !== 'undefined' && window.PsycleClassColours) ? window.PsycleClassColours.resolve(cat.key) : null;
      if (r && r.base) return r.base;
    } catch (e) {}
    var own = cat ? String(cat.color || '') : '';
    return own && !/^var\(/.test(own) ? own : pal.accent; // canvas ignores a var(): never hand it one
  }

  window.shareYearReview = async function () {
    var year = new Date().getFullYear();
    var s = _computeYearReview(year);
    if (!s) { toast('No classes this year yet', 'info'); return; }

    await _shareFontReady();
    var pal = _sharePalette();
    var W = 640, H = 820;
    var surface = _shareCanvas(W, H);
    var canvas = surface.canvas, ctx = surface.ctx;

    // Background
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    var y = 56;

    // Header
    _shareWordmark(ctx, pal, y, 'YEAR IN REVIEW');
    y += 12;
    ctx.strokeStyle = pal.border;
    ctx.beginPath(); ctx.moveTo(32, y); ctx.lineTo(W - 32, y); ctx.stroke();
    y += 60;

    // Big year
    ctx.fillStyle = pal.heading;
    ctx.font = '900 64px ' + SHARE_DISPLAY;
    ctx.fillText(String(year), 32, y);
    y += 28;
    ctx.fillStyle = pal.muted;
    ctx.font = '500 15px ' + SHARE_BODY;
    ctx.fillText('Your year at Psycle', 32, y);
    // Room for the 88px hero below: its digits stand ~64px above their baseline
    // (y + 10), and at 48 their tops struck through this line. The canvas has
    // ~200px spare under the last detail row, so nothing else moves off it.
    y += 76;

    // Hero number
    ctx.fillStyle = pal.accent;
    ctx.font = '900 88px ' + SHARE_DISPLAY;
    ctx.fillText(String(s.total), 32, y + 10);
    ctx.fillStyle = pal.muted;
    ctx.font = '700 13px ' + SHARE_BODY;
    // "Taken", not "ridden": the count covers Reformer, Strength, Yoga… too.
    ctx.fillText(s.total === 1 ? 'CLASS TAKEN' : 'CLASSES TAKEN', 36, y + 36);
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
      ctx.fillStyle = pal.muted;
      ctx.font = '700 12px ' + SHARE_BODY;
      ctx.fillText(String(r[0]).toUpperCase(), 32, y);
      ctx.fillStyle = pal.heading;
      ctx.font = '800 22px ' + SHARE_DISPLAY;
      // maxWidth: a long instructor/studio name squeezes instead of running off the image.
      ctx.fillText(r[1], 32, y + 26, W - 64);
      y += 56;
    });

    // Footer
    y = H - 40;
    ctx.strokeStyle = pal.border;
    ctx.beginPath(); ctx.moveTo(32, y - 16); ctx.lineTo(W - 32, y - 16); ctx.stroke();
    ctx.fillStyle = pal.muted;
    ctx.font = '500 11px ' + SHARE_BODY;
    ctx.fillText(SHARE_FOOTER, 32, y, W - 64);

    try {
      var blob = await new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('toBlob returned null')); }, 'image/png');
      });
      var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || !!window.Capacitor;
      if (isMobile && navigator.share) {
        try {
          var file = new File([blob], 'psync-' + year + '-review.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: 'My ' + year + ' on Psycle',
              text: _plural(s.total, 'class', 'classes') + ' · ' + _plural(s.uniqueInstrs, 'instructor'),
              files: [file],
            });
            return;
          }
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') return;
        }
      }
      if (await _shareAsTextOnAndroid('My ' + year + ' on Psycle', _plural(s.total, 'class', 'classes') + ' · ' + _plural(s.uniqueInstrs, 'instructor'))) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'psync-' + year + '-review.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Image saved. Share it from your downloads.', 'success');
    } catch (e) {
      console.error('[year-review] share failed:', e);
      toast('Couldn\'t share that image. Try again.', 'error');
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
    // Classes taken only — next week's bookings went out on the image as CLASSES.
    var history = _takenRows(getFullHistory(), Date.now(), _historyStartMs());
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

    // Render to canvas. H is only the scratch height: the image is cropped to
    // what was drawn before export (see "Crop" below), and framed there.
    await _shareFontReady();
    var pal = _sharePalette();
    var W = 640, H = 820;
    var surface = _shareCanvas(W, H);
    var canvas = surface.canvas, ctx = surface.ctx;

    // Background
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 2;

    var y = 40;

    // Header
    _shareWordmark(ctx, pal, y, 'MY STATS');
    y += 12;

    // Divider
    ctx.strokeStyle = pal.border;
    ctx.beginPath(); ctx.moveTo(32, y); ctx.lineTo(W - 32, y); ctx.stroke();
    y += 40; // the 32px display title stands ~24px above its baseline: clear of the rule

    // Title (maxWidth: userName falls back to an email address)
    ctx.fillStyle = pal.heading;
    ctx.font = '800 32px ' + SHARE_DISPLAY;
    ctx.fillText(userName ? userName + "'s Stats" : 'My Psycle Stats', 32, y, W - 64);
    y += 20;

    // Date range
    if (firstDate) {
      ctx.fillStyle = pal.muted;
      ctx.font = '500 13px ' + SHARE_BODY;
      var fd = new Date(firstDate);
      ctx.fillText(
        fd.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) + ' – ' +
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
      // A surface tile on the ground, as the app's cards: no outline.
      ctx.fillStyle = pal.panel;
      ctx.beginPath();
      ctx.roundRect(cx, y, cardW, cardH, 18);
      ctx.fill();
      ctx.fillStyle = pal.heading;
      ctx.font = '900 34px ' + SHARE_DISPLAY;
      ctx.fillText(card.value, cx + 16, y + 38);
      ctx.fillStyle = pal.muted;
      ctx.font = '700 10px ' + SHARE_BODY;
      ctx.fillText(card.label, cx + 16, y + 56);
    });
    y += cardH + 28;

    // Top instructor & studio
    // Names get a maxWidth (each column is W/2 - 48 wide): a long instructor
    // name used to run into the "Top studio" column beside it.
    var nameMaxW = W / 2 - 48;
    if (topInstr) {
      ctx.fillStyle = pal.muted;
      ctx.font = '700 10px ' + SHARE_BODY;
      ctx.fillText('TOP INSTRUCTOR', 32, y);
      ctx.fillStyle = pal.heading;
      ctx.font = '800 21px ' + SHARE_DISPLAY;
      ctx.fillText(topInstr[0], 32, y + 22, nameMaxW);
      ctx.fillStyle = pal.muted;
      ctx.font = '500 13px ' + SHARE_BODY;
      ctx.fillText(_plural(topInstr[1], 'class', 'classes'), 32, y + 40);
    }
    if (topStudio) {
      ctx.fillStyle = pal.muted;
      ctx.font = '700 10px ' + SHARE_BODY;
      ctx.fillText('TOP STUDIO', W / 2, y);
      ctx.fillStyle = pal.heading;
      ctx.font = '800 21px ' + SHARE_DISPLAY;
      ctx.fillText(topStudio[0], W / 2, y + 22, nameMaxW);
      ctx.fillStyle = pal.muted;
      ctx.font = '500 13px ' + SHARE_BODY;
      ctx.fillText(_plural(topStudio[1], 'class', 'classes'), W / 2, y + 40);
    }
    y += 64;

    // Class type bars
    ctx.fillStyle = pal.muted;
    ctx.font = '700 10px ' + SHARE_BODY;
    ctx.fillText('CLASS TYPES', 32, y);
    y += 14;

    catSorted.slice(0, 6).forEach(function (cat) {
      var barMaxW = W - 200;
      var barW = Math.max(6, Math.round(cat.count / catMax * barMaxW));

      ctx.fillStyle = pal.muted;
      ctx.font = '700 12px ' + SHARE_BODY;
      ctx.textAlign = 'right';
      ctx.fillText(cat.label, 100, y + 14);
      ctx.textAlign = 'left';

      ctx.fillStyle = pal.border;
      ctx.beginPath(); ctx.roundRect(112, y + 4, barMaxW, 12, 6); ctx.fill();
      ctx.fillStyle = _shareClassColour(cat, pal);
      ctx.beginPath(); ctx.roundRect(112, y + 4, Math.max(12, barW), 12, 6); ctx.fill();

      ctx.fillStyle = pal.heading;
      ctx.font = '800 14px ' + SHARE_DISPLAY;
      ctx.fillText(String(cat.count), 112 + barMaxW + 8, y + 14);

      y += 24;
    });
    y += 16;

    // Footer
    ctx.strokeStyle = pal.border;
    ctx.beginPath(); ctx.moveTo(32, y); ctx.lineTo(W - 32, y); ctx.stroke();
    y += 20;
    ctx.fillStyle = pal.muted;
    ctx.font = '500 11px ' + SHARE_BODY;
    ctx.fillText(SHARE_FOOTER, 32, y, W - 64);

    // Crop: the card used to sit on top of 340–460px of empty background
    // (41–56% of the image, depending on how many class types there are). Cut
    // the scratch surface off under the footer — measured, not a magic height,
    // so the layout above can change — and frame the result.
    var outH = Math.min(H, Math.ceil(y + 28));
    var out = document.createElement('canvas');
    out.width = W * SHARE_SCALE; out.height = outH * SHARE_SCALE;
    var octx = out.getContext('2d');
    octx.drawImage(canvas, 0, 0); // 1:1 device pixels; the taller source is clipped
    octx.scale(SHARE_SCALE, SHARE_SCALE);
    octx.strokeStyle = pal.border;
    octx.lineWidth = 2;
    octx.strokeRect(1, 1, W - 2, outH - 2);

    // Export and share
    try {
      var blob = await new Promise(function (resolve, reject) {
        out.toBlob(function (b) {
          if (b) resolve(b); else reject(new Error('toBlob returned null'));
        }, 'image/png');
      });

      // Try native share (mobile/Capacitor only — desktop share is unreliable)
      var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || !!window.Capacitor;
      if (isMobile && navigator.share) {
        try {
          var file = new File([blob], 'psync-stats.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: 'My Psycle Stats',
              text: _plural(totalClasses, 'class', 'classes') + ' · ' + _plural(uniqueInstrs, 'instructor') + (topInstr ? ' · Top: ' + topInstr[0] : ''),
              files: [file],
            });
            return;
          }
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') return; // user cancelled
          // Fall through to download
        }
      }

      if (await _shareAsTextOnAndroid('My Psycle Stats', _plural(totalClasses, 'class', 'classes') + ' · ' + _plural(uniqueInstrs, 'instructor') + (topInstr ? ' · Top: ' + topInstr[0] : ''))) return;

      // Fallback: download
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'psync-stats.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Image saved. Share it from your downloads.', 'success');
    } catch (e) {
      console.error('[share] failed:', e);
      toast('Couldn\'t share that image. Try again.', 'error');
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
