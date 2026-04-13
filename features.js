/* ═══════════════════════════════════════════════════════════════
   Features Module — Class History, Instructor Profiles, Push
   Self-contained: hooks into app.js via monkey-patching.
   ═══════════════════════════════════════════════════════════════ */

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
    injectHistoryButton();
    patchSubmitBooking();
    patchCancelFunctions();
    patchEventCard();
    patchFetchMyBookings();
  }

  /* ═══════════════════════════════════════════════════════════════
     A. CLASS HISTORY
     ═══════════════════════════════════════════════════════════════ */

  const HISTORY_KEY = 'psycle_class_history';

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
  }

  function saveHistory(arr) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
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
    // Keep a reasonable limit
    if (history.length > 500) history.length = 500;
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

  // ── History button in header ──────────────────────────────────
  function injectHistoryButton() {
    const pill = document.getElementById('authPill');
    if (!pill) return;
    const btn = document.createElement('button');
    btn.className = 'history-btn';
    btn.textContent = 'History';
    btn.title = 'View class history';
    btn.onclick = openHistoryModal;
    pill.parentElement.insertBefore(btn, pill);
  }

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
          const slotsStr = entry.slots && entry.slots.length > 0 ? ' | ' + _slH + (entry.slots.length > 1 ? 's ' : ' ') + entry.slots.join(' & ') : '';
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
    window.submitBooking = async function (eventId, slots, btn) {
      const result = await orig.call(this, eventId, slots, btn);
      // After successful booking, the button will have class 'booked'
      // We check _myBookings to confirm success
      if (window._myBookings?.[String(eventId)]) {
        addHistoryEntry(eventId, slots);
      }
      return result;
    };
  }

  // ── Monkey-patch cancel functions ──────────────────────────────
  function patchCancelFunctions() {
    // confirmUnbook
    const origUnbook = window.confirmUnbook;
    if (origUnbook) {
      window.confirmUnbook = async function (bookingId, eventId, btn) {
        const hadBooking = !!window._myBookings?.[String(eventId)];
        const result = await origUnbook.call(this, bookingId, eventId, btn);
        if (hadBooking && !window._myBookings?.[String(eventId)]) {
          markHistoryCancelled(eventId);
        }
        return result;
      };
    }

    // upcomingCancel
    const origUpCancel = window.upcomingCancel;
    if (origUpCancel) {
      window.upcomingCancel = async function (eventId, btn) {
        const hadBooking = !!window._myBookings?.[String(eventId)];
        const result = await origUpCancel.call(this, eventId, btn);
        if (hadBooking && !window._myBookings?.[String(eventId)]) {
          markHistoryCancelled(eventId);
        }
        return result;
      };
    }

    // cancelBikeSlot
    const origBikeCancel = window.cancelBikeSlot;
    if (origBikeCancel) {
      window.cancelBikeSlot = async function (slotId, eventId) {
        const hadBooking = !!window._myBookings?.[String(eventId)];
        const result = await origBikeCancel.call(this, slotId, eventId);
        // If all slots were removed, booking is gone
        if (hadBooking && !window._myBookings?.[String(eventId)]) {
          markHistoryCancelled(eventId);
        }
        return result;
      };
    }

    // upcomingSeatCancel
    const origSeatCancel = window.upcomingSeatCancel;
    if (origSeatCancel) {
      window.upcomingSeatCancel = async function (eventId, slotId, btn) {
        const hadBooking = !!window._myBookings?.[String(eventId)];
        const result = await origSeatCancel.call(this, eventId, slotId, btn);
        if (hadBooking && !window._myBookings?.[String(eventId)]) {
          markHistoryCancelled(eventId);
        }
        return result;
      };
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     B. INSTRUCTOR PROFILES
     ═══════════════════════════════════════════════════════════════ */

  function openInstructorModal(instrName, instrId) {
    // Remove any existing modal
    document.getElementById('instructorModalOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'instructorModalOverlay';
    overlay.className = 'instructor-modal';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

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

    let listHtml = '';
    if (upcoming.length === 0) {
      listHtml = '<div class="instructor-empty">No upcoming classes found in cached results. Run a search to load more data.</div>';
    } else {
      listHtml = '<div class="instructor-class-list">';
      for (const evt of upcoming.slice(0, 30)) {
        const dt = new Date(evt.start_at);
        const dayStr = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        const h = dt.getHours(), m = dt.getMinutes().toString().padStart(2, '0');
        const ampm = h >= 12 ? 'pm' : 'am';
        const timeStr = (h % 12 || 12) + ':' + m + ampm;
        const typeName = evt._typeName || 'Class';
        const locName = evt._locName || '';
        listHtml += `
          <div class="instructor-class-item">
            <div class="instructor-class-day">${dayStr.replace(' ', '<br>')}</div>
            <div class="instructor-class-time">${timeStr}</div>
            <div class="instructor-class-info">
              <div class="instructor-class-type">${escapeHtml(typeName)}</div>
              <div class="instructor-class-loc">${escapeHtml(locName)}</div>
            </div>
          </div>`;
      }
      listHtml += '</div>';
    }

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="instructor-name-title">${escapeHtml(instrName)}</div>
            <div class="modal-subtitle">${upcoming.length} upcoming class${upcoming.length !== 1 ? 'es' : ''}</div>
          </div>
          <button class="modal-close" onclick="document.getElementById('instructorModalOverlay').remove()">&times;</button>
        </div>
        ${listHtml}
        <button class="instructor-view-schedule"
          onclick="window._features_filterByInstructor('${String(instrId).replace(/'/g, "\\'")}'); document.getElementById('instructorModalOverlay').remove();">
          View Full Schedule
        </button>
      </div>`;

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
      const instr = instrMap[evt.instructor_id];
      if (instr) {
        const plainName = instr.full_name;
        const escapedName = escapeHtml(plainName);
        // Replace the plain text instructor name with a clickable link
        // The eventCard renders: <div class="class-instructor">Name</div>
        const searchStr = `<div class="class-instructor">${escapedName}</div>`;
        const replaceStr = `<div class="class-instructor"><span class="instructor-link" onclick="event.stopPropagation();window._features_openInstructorModal('${plainName.replace(/'/g, "\\'")}', '${instr.id}')">${escapedName}</span></div>`;
        html = html.replace(searchStr, replaceStr);
      }

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
