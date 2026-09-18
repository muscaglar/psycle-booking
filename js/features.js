/**
 * features.js — Class History, Instructor Profiles, Push Notifications
 *
 * Self-contained IIFE that hooks into app.js via monkey-patching.
 * Tracks booking history in localStorage, provides instructor profile
 * modals, and scaffolds push notification watchlists for full classes.
 *
 * Depends on: app.js (submitBooking, confirmUnbook, eventCard, _eventCache, etc.),
 *             security.js (escapeHTML), settings.js (tierBadgeHTML)
 * Exposes on window:
 *   openHistoryModal, requestNotificationPermission,
 *   _features_openInstructorModal, _features_filterByInstructor,
 *   _features_toggleNotify
 */

(function () {
  'use strict';

  // Alias the global escapeHTML from security.js (must be at top for hoisting)
  var escapeHtml = function (s) { return (window.escapeHTML || function (x) { return x; })(s); };

  // Wait for DOM + app.js globals to be available
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay to let app.js finish its sync init
    setTimeout(init, 0);
  }

  /* ═══════════════════════════════════════════════════════════════
     INIT — wire everything up
     ═══════════════════════════════════════════════════════════════ */
  function init() {
    // History button is now in the My Bookings tab (tabs.js), no header injection needed.
    patchSubmitBooking();
    patchCancelFunctions();
    patchEventCard();
    patchFetchMyBookings();
  }

  /* ═══════════════════════════════════════════════════════════════
     A. CLASS HISTORY
     ═══════════════════════════════════════════════════════════════ */

  const HISTORY_KEY = 'psycle_class_history';
  // ONE cap for both writers — explore.js's history sync reads it too. This
  // file used to cut to 500 on every booking while the sync kept 1000, so a
  // long-time member's all-time total, streaks and instructor stats shrank the
  // moment they booked in the app. Set at load, not in the deferred init(), so
  // it exists before any sync can run. 2000 × ~220 B ≈ 440 KB: inside
  // localStorage and the iOS Preferences mirror.
  window.PSYCLE_HISTORY_MAX = 2000;

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
  }

  function saveHistory(arr) {
    // Reached from the patched submitBooking AFTER the booking went through: a
    // quota error thrown here would reject it and read as a failed booking.
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); }
    catch (e) { console.warn('[features] class history not saved:', e); }
  }

  function addHistoryEntry(eventId, slots) {
    const evt = window._eventCache?.[String(eventId)];
    if (!evt) return;
    const history = getHistory();
    // Avoid duplicates for same eventId (unless previously cancelled and re-booked)
    const existing = history.find(h => h.eventId === String(eventId) && !h.cancelledAt);
    if (existing) return;
    history.unshift({
      eventId: String(eventId),
      typeName: evt._typeName || 'Class',
      instrName: evt._instrName || '',
      locName: evt._locName || '',
      date: evt.start_at,
      slots: slots ? slots.map(Number) : [],
      bookedAt: new Date().toISOString(),
    });
    // Keep a reasonable limit (newest first, so the tail is the oldest)
    if (history.length > window.PSYCLE_HISTORY_MAX) history.length = window.PSYCLE_HISTORY_MAX;
    saveHistory(history);
  }

  function markHistoryCancelled(eventId) {
    const history = getHistory();
    let changed = false;
    for (const entry of history) {
      if (entry.eventId === String(eventId) && !entry.cancelledAt) {
        entry.cancelledAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) saveHistory(history);
  }

  // Expose openHistoryModal so the My Bookings tab button can call it
  window.openHistoryModal = openHistoryModal;

  function openHistoryModal() {
    // Remove any existing modal
    document.getElementById('historyModalOverlay')?.remove();

    const history = getHistory();

    const overlay = document.createElement('div');
    overlay.id = 'historyModalOverlay';
    overlay.className = 'history-modal';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

    let bodyHtml = '';
    if (history.length === 0) {
      bodyHtml = '<div class="history-empty">No booking history yet. Book a class and it will appear here.</div>';
    } else {
      // Group by month
      const byMonth = {};
      for (const entry of history) {
        const d = new Date(entry.date);
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        const label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        if (!byMonth[key]) byMonth[key] = { label, items: [] };
        byMonth[key].items.push(entry);
      }

      // Sort months descending (most recent first)
      const sortedKeys = Object.keys(byMonth).sort().reverse();
      for (const key of sortedKeys) {
        const group = byMonth[key];
        bodyHtml += `<div class="history-month-header">${group.label}</div>`;
        for (const entry of group.items) {
          const d = new Date(entry.date);
          const dayStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
          const h = d.getHours(), m = d.getMinutes().toString().padStart(2, '0');
          const ampm = h >= 12 ? 'pm' : 'am';
          const timeStr = (h % 12 || 12) + ':' + m + ampm;
          const isCancelled = !!entry.cancelledAt;
          const _slH = (typeof slotLabel === 'function') ? slotLabel(entry.typeName) : 'Bike';
          const slotsStr = entry.slots && entry.slots.length > 0 ? ' | ' + formatSlots(_slH, entry.slots) : '';
          bodyHtml += `
            <div class="history-item${isCancelled ? ' cancelled' : ''}">
              <div class="history-date">${dayStr.replace(' ', '<br>')}</div>
              <div class="history-details">
                <div class="history-class-name">${escapeHtml(entry.typeName)}</div>
                <div class="history-sub">${escapeHtml(entry.instrName)}${entry.locName ? ' &middot; ' + escapeHtml(entry.locName) : ''}${slotsStr ? ' &middot; ' + slotsStr : ''}</div>
              </div>
              ${timeStr ? '<div style="font-size:12px;color:#888;min-width:52px;text-align:right">' + timeStr + '</div>' : ''}
              ${isCancelled ? '<span class="history-cancelled-tag">Cancelled</span>' : ''}
            </div>`;
        }
      }
    }

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="modal-title">Class History</div>
            <div class="modal-subtitle">${history.length} booking${history.length !== 1 ? 's' : ''} recorded</div>
          </div>
          <button class="modal-close" onclick="document.getElementById('historyModalOverlay').remove()">&times;</button>
        </div>
        <div>${bodyHtml}</div>
      </div>`;

    document.body.appendChild(overlay);
  }

  // ── Monkey-patch submitBooking ──────────────────────────────────
  function patchSubmitBooking() {
    const orig = window.submitBooking;
    if (!orig) return;
    // Forward ALL four arguments so opts survives the whole wrapper chain.
    window.submitBooking = async function (eventId, slots, btn, opts) {
      const result = await orig.call(this, eventId, slots, btn, opts);
      // After successful booking, the button will have class 'booked'
      // We check _myBookings to confirm success. Waitlist places are not
      // attended classes — keep them out of the class history.
      const entry = window._myBookings?.[String(eventId)];
      if (entry && !entry.waitlisted) {
        addHistoryEntry(eventId, slots);
      }
      return result;
    };
    // A claimed waitlist spot becomes a real seat outside submitBooking —
    // app.js emits booking:complete for it once /bookings confirms the seat.
    // (addHistoryEntry de-dups, so the normal booking path is unaffected.)
    if (window.PsycleEvents && typeof window.PsycleEvents.on === 'function') {
      window.PsycleEvents.on('booking:complete', function (eventId, slots) {
        const entry = window._myBookings?.[String(eventId)];
        if (entry && !entry.waitlisted) addHistoryEntry(eventId, slots);
      });
      // Seats Psycle allocated from the waitlist while the app was closed.
      window.PsycleEvents.on('waitlist:allocated', function (eventIds) {
        (eventIds || []).forEach(function (eventId) {
          const entry = window._myBookings?.[String(eventId)];
          if (entry && !entry.waitlisted) addHistoryEntry(eventId, entry.slots || []);
        });
      });
    }
  }

  // ── Monkey-patch cancel functions ──────────────────────────────
  // History tracks SEATS. A cancelled seat can leave the entry behind as a
  // waitlist place (waitlisted:true), so "cancelled" = had a seat before and
  // has none after — not "the entry disappeared".
  function hasSeat(eventId) {
    const e = window._myBookings?.[String(eventId)];
    return !!(e && !e.waitlisted);
  }

  function patchCancelFunctions() {
    // confirmUnbook
    const origUnbook = window.confirmUnbook;
    if (origUnbook) {
      window.confirmUnbook = async function (bookingId, eventId, btn) {
        const had = hasSeat(eventId);
        const result = await origUnbook.call(this, bookingId, eventId, btn);
        if (had && !hasSeat(eventId)) markHistoryCancelled(eventId);
        return result;
      };
    }

    // upcomingCancel
    const origUpCancel = window.upcomingCancel;
    if (origUpCancel) {
      window.upcomingCancel = async function (eventId, btn) {
        const had = hasSeat(eventId);
        const result = await origUpCancel.call(this, eventId, btn);
        if (had && !hasSeat(eventId)) markHistoryCancelled(eventId);
        return result;
      };
    }

    // cancelBikeSlot
    const origBikeCancel = window.cancelBikeSlot;
    if (origBikeCancel) {
      window.cancelBikeSlot = async function (slotId, eventId) {
        const had = hasSeat(eventId);
        const result = await origBikeCancel.call(this, slotId, eventId);
        // If all slots were removed, the seat is gone
        if (had && !hasSeat(eventId)) markHistoryCancelled(eventId);
        return result;
      };
    }

    // upcomingSeatCancel
    const origSeatCancel = window.upcomingSeatCancel;
    if (origSeatCancel) {
      window.upcomingSeatCancel = async function (eventId, slotId, btn) {
        const had = hasSeat(eventId);
        const result = await origSeatCancel.call(this, eventId, slotId, btn);
        if (had && !hasSeat(eventId)) markHistoryCancelled(eventId);
        return result;
      };
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     B. INSTRUCTOR PROFILES
     ═══════════════════════════════════════════════════════════════ */

  // [label, .badge modifier] for one row of the modal's class list, or null.
  // What the member most needs before tapping: is it theirs, is it full.
  function classStatusChip(evt) {
    const held = window._myBookings?.[String(evt.id)];
    if (held) return held.waitlisted ? ['Waitlisted', 'waitlist'] : ['Booked', 'highlight'];
    if (evt.is_fully_booked) return evt.is_waitlistable ? ['Waitlist', 'waitlist'] : ['Full', 'full'];
    const left = Number(evt.capacity_remaining);
    if (evt.capacity != null && evt.capacity_remaining != null && left > 0) return [left + ' left', ''];
    return null;
  }

  // ★ + S–F under the name: the Membership tab's own controls (.tier-fav /
  // .tier-btn) driven by its own writers, so a rank set here is THE rank. No
  // ids in inline handlers — the overlay's one click listener reads data-*.
  function instructorRankHtml(instrId) {
    if (typeof window.setInstructorTier !== 'function' || typeof window.toggleFavFromSettings !== 'function') return '';
    const sid = String(instrId);
    const isFav = (typeof favouriteInstructors !== 'undefined' && favouriteInstructors) ? favouriteInstructors.has(sid) : false;
    const tier = (typeof getInstructorTier === 'function') ? getInstructorTier(sid) : null;
    const btns = ['S', 'A', 'B', 'C', 'D', 'F'].map(t =>
      `<button type="button" class="tier-btn${tier === t ? ' active-' + t : ''}" data-instr-tier="${t}" aria-pressed="${tier === t}" aria-label="Rank ${t}">${t}</button>`
    ).join('');
    return `<button type="button" class="tier-fav${isFav ? ' is-fav' : ''}" data-instr-fav="1" aria-pressed="${isFav}"
        title="${isFav ? 'Remove from favourites' : 'Add to favourites'}" aria-label="${isFav ? 'Remove from favourites' : 'Add to favourites'}"></button>
      <div class="tier-btns">${btns}</div>`;
  }

  function openInstructorModal(instrName, instrId) {
    // Remove any existing modal
    document.getElementById('instructorModalOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'instructorModalOverlay';
    overlay.className = 'instructor-modal';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

    // Find instructor data from the global array
    const instrs = (typeof instructors !== 'undefined') ? instructors : [];
    const instr = instrs.find(i => String(i.id) === String(instrId));
    const photo = instr?.photo || instr?.image_1 || '';
    const meta = instr?.metafields || {};
    const bio = meta.description || '';
    const keywords = (meta.keywords || '').split(/[,|]/).map(k => k.trim()).filter(Boolean);
    const instagram = meta.instagram_handle || '';
    const handle = instr?.handle || instrName.toLowerCase().replace(/\s+/g, '-');
    const tierBadge = (typeof tierBadgeHTML === 'function') ? tierBadgeHTML(instrId) : '';

    // Gather upcoming classes for this instructor from _eventCache
    const now = new Date();
    const upcoming = [];
    const cache = window._eventCache || {};
    for (const [evtId, evt] of Object.entries(cache)) {
      if (String(evt.instructor_id) === String(instrId) && new Date(evt.start_at) > now) {
        upcoming.push(evt);
      }
    }
    upcoming.sort((a, b) => a.start_at.localeCompare(b.start_at));

    // Profile section
    let profileHtml = '<div class="instructor-profile">';
    if (photo) {
      profileHtml += `<img class="instructor-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(instrName)}" loading="eager">`;
    }
    profileHtml += '<div class="instructor-profile-info">';
    profileHtml += `<div class="instructor-name-title">${escapeHtml(instrName)} <span class="instructor-tier-slot">${tierBadge}</span></div>`;
    // Only for a real instructor record: a name with no id has nothing to rank.
    const rankHtml = instr ? instructorRankHtml(instr.id) : '';
    if (rankHtml) profileHtml += `<div class="instructor-rank">${rankHtml}</div>`;
    if (keywords.length > 0) {
      profileHtml += '<div class="instructor-keywords">' +
        keywords.map(k => `<span class="instructor-keyword">${escapeHtml(k)}</span>`).join('') +
        '</div>';
    }
    profileHtml += `<div class="modal-subtitle">${upcoming.length} upcoming class${upcoming.length !== 1 ? 'es' : ''}</div>`;
    if (instagram) {
      profileHtml += `<a class="instructor-ig" href="https://instagram.com/${escapeHtml(instagram)}" target="_blank" rel="noopener">@${escapeHtml(instagram)}</a>`;
    }
    profileHtml += '</div></div>';

    // Bio
    let bioHtml = '';
    if (bio) {
      bioHtml = `<div class="instructor-bio">${escapeHtml(bio)}</div>`;
    }

    // Class list
    let listHtml = '';
    if (upcoming.length === 0) {
      // The list is whatever Discover has loaded — not "the next 7 days".
      listHtml = '<div class="instructor-empty">No upcoming classes in the dates you\'ve searched.</div>';
    } else {
      listHtml = '<div class="instructor-class-list">';
      for (const evt of upcoming.slice(0, 20)) {
        const dt = new Date(evt.start_at);
        const dayStr = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        const h = dt.getHours(), m = dt.getMinutes().toString().padStart(2, '0');
        const ampm = h >= 12 ? 'pm' : 'am';
        const timeStr = (h % 12 || 12) + ':' + m + ampm;
        const chip = classStatusChip(evt);
        // A row opens that class's sheet (its Book works with no Discover card
        // in the DOM — _classDetailBookAction). The id rides in data-*, read by
        // the overlay's click listener below.
        listHtml += `
          <div class="instructor-class-item" role="button" tabindex="0" data-event-id="${escapeHtml(String(evt.id))}">
            <div class="instructor-class-day">${dayStr.replace(' ', '<br>')}</div>
            <div class="instructor-class-time">${timeStr}</div>
            <div class="instructor-class-info">
              <div class="instructor-class-type">${escapeHtml(evt._typeName || 'Class')}</div>
              <div class="instructor-class-loc">${escapeHtml(evt._locName || '')}</div>
            </div>
            ${chip ? `<span class="badge${chip[1] ? ' ' + chip[1] : ''}">${escapeHtml(chip[0])}</span>` : ''}
          </div>`;
      }
      listHtml += '</div>';
    }

    const psycleUrl = `https://psyclelondon.com/pages/timetable-instructor-page/${encodeURIComponent(handle)}`;

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header" style="justify-content:flex-end">
          <button class="modal-close" onclick="document.getElementById('instructorModalOverlay').remove()">&times;</button>
        </div>
        ${profileHtml}
        ${bioHtml}
        ${listHtml}
        <div class="instructor-actions">
          <button class="instructor-view-schedule" data-instr-schedule="1">
            View schedule
          </button>
          <a class="instructor-view-schedule instructor-psycle-link" href="${psycleUrl}" target="_blank" rel="noopener">
            View on Psycle
          </a>
        </div>
      </div>`;

    // One listener for everything tappable in the modal. The ids come from the
    // closure / data-*, never from a string built into an onclick.
    overlay.addEventListener('click', function (e) {
      const el = e.target && e.target.closest ? e.target : null;
      if (!el) return;
      if (el.closest('[data-instr-schedule]')) {
        window._features_filterByInstructor(instrId);
        overlay.remove();
        return;
      }
      const row = el.closest('.instructor-class-item[data-event-id]');
      if (row) {
        if (typeof window.openClassDetail !== 'function') return;
        overlay.remove();
        window.openClassDetail(row.dataset.eventId);
        return;
      }
      const fav = el.closest('[data-instr-fav]');
      const tierBtn = el.closest('[data-instr-tier]');
      if (!instr || (!fav && !tierBtn)) return;
      const picked = tierBtn ? tierBtn.dataset.instrTier : null;
      if (fav) window.toggleFavFromSettings(instr.id);
      else window.setInstructorTier(instr.id, picked);
      // Repaint from the stores those writers just changed (the tapped button
      // is replaced, so hand the focus to its successor).
      const rank = overlay.querySelector('.instructor-rank');
      if (rank) {
        rank.innerHTML = instructorRankHtml(instr.id);
        const again = rank.querySelector(fav ? '[data-instr-fav]' : '[data-instr-tier="' + picked + '"]');
        if (again) again.focus();
      }
      const slot = overlay.querySelector('.instructor-tier-slot');
      if (slot) slot.innerHTML = (typeof tierBadgeHTML === 'function') ? tierBadgeHTML(instr.id) : '';
      // The writers only repaint Membership's (hidden) list, and the tier badge
      // is baked into each card when it is built: the cards under this modal
      // kept the old rank. A star writes nothing on a card — it only brings
      // back Discover's "My favourites" quick action after a first favourite.
      if (tierBtn) {
        if (typeof _renderWindowInPlace === 'function') _renderWindowInPlace();
        if (typeof refreshUpcomingPanel === 'function') refreshUpcomingPanel();
      } else if (typeof updateDiscoverEmptyState === 'function') updateDiscoverEmptyState();
    });
    // The rows are divs with role="button": Enter / Space must work too.
    overlay.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target && e.target.matches && e.target.matches('.instructor-class-item[data-event-id]') ? e.target : null;
      if (!row) return;
      e.preventDefault();
      row.click();
    });

    document.body.appendChild(overlay);
  }

  // Filter main results to just this instructor
  window._features_filterByInstructor = function (instrId) {
    const sid = String(instrId);
    // Clear current selections and select just this instructor
    if (window.selectedInstructors) {
      window.selectedInstructors.clear();
      window.selectedInstructors.add(sid);
    }
    if (typeof window.renderInstrChips === 'function') window.renderInstrChips();
    if (typeof window.renderInstrDropdown === 'function') window.renderInstrDropdown();
    // The modal opens from My Bookings and Stats too: without the tab switch
    // the search filled a hidden panel and the tap looked like it did nothing.
    // (search() and its wrappers never switch tab; every other filter-and-
    // search CTA does it first.)
    if (typeof window.switchTab === 'function') window.switchTab('discover');
    if (typeof window.search === 'function') window.search();
  };

  // Expose for onclick in patched HTML
  window._features_openInstructorModal = openInstructorModal;

  // ── Monkey-patch eventCard to make instructor name clickable ───
  function patchEventCard() {
    const orig = window.eventCard;
    if (!orig) return;
    window.eventCard = function (evt, instrMap, studioMap, locationMap, typeMap) {
      let html = orig.call(this, evt, instrMap, studioMap, locationMap, typeMap);
      // Instructor names are already clickable via instrLink() in the base eventCard.

      // C. Add notify button for fully-booked classes
      const isFull = evt.is_fully_booked && !evt.is_waitlistable;
      if (isFull) {
        const watchlist = getNotifyWatchlist();
        const isWatching = watchlist.includes(String(evt.id));
        const notifyBtn = `<button class="notify-btn${isWatching ? ' watching' : ''}"
          title="${isWatching ? 'Stop watching for openings' : 'Notify me when a spot opens'}"
          onclick="event.stopPropagation();window._features_toggleNotify('${evt.id}', this)"></button>`;
        // Insert after the book button
        html = html.replace(
          /(<button class="book-btn"[^>]*>Full<\/button>)/,
          '$1' + notifyBtn
        );
      }

      return html;
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     C. PUSH NOTIFICATION SCAFFOLD
     ═══════════════════════════════════════════════════════════════ */

  const NOTIFY_KEY = 'psycle_notify_watchlist';

  function getNotifyWatchlist() {
    try { return JSON.parse(localStorage.getItem(NOTIFY_KEY) || '[]'); }
    catch { return []; }
  }

  function saveNotifyWatchlist(list) {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify(list));
  }

  // Request notification permission
  window.requestNotificationPermission = async function () {
    if (!('Notification' in window)) {
      if (typeof toast === 'function') toast('Notifications not supported in this browser', 'error');
      return 'denied';
    }
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') {
      if (typeof toast === 'function') toast('Notifications are blocked. Enable them in browser settings.', 'error');
      return 'denied';
    }
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      if (typeof toast === 'function') toast('Notifications enabled', 'success');
    }
    return result;
  };

  // Toggle notify watchlist for an event
  window._features_toggleNotify = async function (eventId, btn) {
    const eid = String(eventId);
    let watchlist = getNotifyWatchlist();
    const idx = watchlist.indexOf(eid);
    if (idx !== -1) {
      // Remove from watchlist
      watchlist.splice(idx, 1);
      saveNotifyWatchlist(watchlist);
      btn.classList.remove('watching');
      btn.title = 'Notify me when a spot opens';
      if (typeof toast === 'function') toast('Stopped watching this class', 'info');
    } else {
      // Request permission first
      const perm = await window.requestNotificationPermission();
      watchlist.push(eid);
      saveNotifyWatchlist(watchlist);
      btn.classList.add('watching');
      btn.title = 'Stop watching for openings';
      if (perm === 'granted') {
        if (typeof toast === 'function') toast('You will be notified when a spot opens', 'success');
      } else {
        if (typeof toast === 'function') toast('Watching for openings (toast alerts only — enable browser notifications for push)', 'info');
      }
    }
  };

  // ── Check watched events for openings ──────────────────────────
  function checkWatchedEvents() {
    const watchlist = getNotifyWatchlist();
    if (watchlist.length === 0) return;

    const cache = window._eventCache || {};
    const toRemove = [];

    for (const eid of watchlist) {
      const evt = cache[eid];
      if (!evt) continue;
      // If the event is no longer fully booked, notify!
      if (!evt.is_fully_booked) {
        const typeName = evt._typeName || 'Class';
        const instrName = evt._instrName || '';
        const dt = new Date(evt.start_at);
        const h = dt.getHours(), m = dt.getMinutes().toString().padStart(2, '0');
        const ampm = h >= 12 ? 'pm' : 'am';
        const timeStr = (h % 12 || 12) + ':' + m + ampm;
        const dayStr = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        const msg = `Spot opened! ${typeName} with ${instrName} — ${dayStr} at ${timeStr}`;

        // Browser notification if permitted
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('Psycle — Spot Available!', {
              body: msg,
              icon: 'icons/icon-192.png',
              tag: 'psycle-notify-' + eid,
            });
          } catch (e) {
            // Fallback handled below
          }
        }

        // Always show toast as fallback
        if (typeof toast === 'function') {
          toast(msg, 'success');
        }

        toRemove.push(eid);
      }
    }

    // Remove notified events from watchlist
    if (toRemove.length > 0) {
      const updated = watchlist.filter(id => !toRemove.includes(id));
      saveNotifyWatchlist(updated);
      // Update any rendered notify buttons
      for (const eid of toRemove) {
        const card = document.querySelector(`.class-card[data-id="${eid}"]`);
        if (card) {
          const btn = card.querySelector('.notify-btn');
          if (btn) {
            btn.classList.remove('watching');
            btn.title = 'Notify me when a spot opens';
          }
        }
      }
    }
  }

  // ── Monkey-patch fetchMyBookings to check watchlist ─────────────
  function patchFetchMyBookings() {
    const orig = window.fetchMyBookings;
    if (!orig) return;
    window.fetchMyBookings = async function () {
      const result = await orig.call(this);
      // After bookings refresh, check if any watched events opened up
      // Use a small delay to let _eventCache update from any concurrent render
      setTimeout(checkWatchedEvents, 500);
      return result;
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     UTILITY
     ═══════════════════════════════════════════════════════════════ */

})();
