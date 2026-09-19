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
    try {
      const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      // Ids and seat lists are coerced where they are read (app.js,
      // pure:stored-data): the stored list can come from an imported file.
      return typeof _cleanStoredHistory === 'function' ? _cleanStoredHistory(arr) : (Array.isArray(arr) ? arr : []);
    }
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

  // ── pure:history:start ── (DOM-free; tests/suites/history.js evaluates this block)
  // History only ever heard about bookings made inside this install, so a class
  // booked on another device or on Psycle's own site broke the streak and
  // dropped out of the totals once attended. This lines history up with the
  // bookings Psycle just reported. It returns a NEW array plus what changed and
  // trusts `bookings` completely — whether that snapshot MAY be trusted (signed
  // in, not raced by a local write) is the caller's call: handed the empty map
  // of a signed-out fetch it would mark every upcoming class cancelled.
  //
  // Absence only counts as "cancelled elsewhere" for a class more than 2h away:
  // nearer than that Psycle may already have moved it out of the upcoming list.
  const HISTORY_CANCEL_MARGIN_MS = 2 * 60 * 60 * 1000;

  function _historyReconcile(history, bookings, cache, nowMs, startMs, max) {
    const out = (Array.isArray(history) ? history : []).map(h => (h && typeof h === 'object' ? Object.assign({}, h) : h));
    const map = bookings || {};
    const nowIso = new Date(nowMs).toISOString();
    const added = [], cancelled = [], revived = [];

    Object.keys(map).forEach(id => {
      const b = map[id];
      // Adding needs a real seat: a waitlist place is not an attended class.
      if (!b || b.waitlisted || !(b.bookingId || (b.bookingIds || []).length || (b.slots || []).length)) return;
      if (out.some(h => h && String(h.eventId) === id && !h.cancelledAt)) return;
      const slots = (b.slots || []).map(Number);
      // A cancellation THIS reconcile recorded is undone rather than doubled up
      // (an in-app cancel + rebook keeps its "Cancelled" row and adds a new one).
      const mine = out.find(h => h && String(h.eventId) === id && h.cancelledElsewhere);
      if (mine) {
        delete mine.cancelledAt;
        delete mine.cancelledElsewhere;
        if (slots.length) mine.slots = slots;
        revived.push(id);
        return;
      }
      const evt = cache && cache[id];
      if (!evt || !evt.start_at) return; // nothing to describe it with yet — the next fetch tries again
      out.unshift({
        eventId: id,
        typeName: evt._typeName || 'Class',
        instrName: evt._instrName || '',
        instrId: evt.instructor_id != null ? String(evt.instructor_id) : '',
        locName: evt._locName || '',
        date: evt.start_at,
        slots: slots,
        bookedAt: nowIso,
      });
      added.push(id);
    });

    out.forEach(h => {
      if (!h || typeof h !== 'object' || h.cancelledAt) return;
      const b = map[String(h.eventId)];
      if (b && !b.waitlisted) return; // anything that may be a seat keeps the entry alive
      const t = startMs(h.date);
      if (!(t > nowMs + HISTORY_CANCEL_MARGIN_MS)) return; // past, too close, or unreadable
      h.cancelledAt = nowIso;
      h.cancelledElsewhere = true;
      cancelled.push(String(h.eventId));
    });

    // Newest first, so the tail is the oldest (same cap as addHistoryEntry).
    if (max > 0 && out.length > max) out.length = max;
    return { history: out, added, cancelled, revived, changed: added.length + cancelled.length + revived.length > 0 };
  }

  // Whose history this install holds (a customer id). History is per-install
  // and outlives a sign-out, so without the stamp another account signing in
  // here had ITS /bookings reconciled against the first member's history: their
  // upcoming classes marked cancelled — for good, once attended meanwhile — and
  // the other account's classes counted in their stats. (Waitlist places, the
  // saved bookings copy and the offline queue are owner-stamped the same way.)
  //   'mine' | 'other' | 'adopt' (never stamped: an install from before the
  //   stamp, or an imported backup) | 'unknown' (no verified member to ask for)
  const HISTORY_OWNER_KEY = 'psycle_class_history_owner';
  function _historyOwnership(stored, me) {
    if (me == null || me === '') return 'unknown';
    if (stored == null || stored === '') return 'adopt';
    return String(stored) === String(me) ? 'mine' : 'other';
  }
  // ── pure:history:end ──

  // The signed-in customer, or null while the session is unverified. (typeof:
  // the suites run these functions without app state.)
  function _historyOwnerId() {
    return (typeof currentUser !== 'undefined' && currentUser && currentUser.id != null) ? String(currentUser.id) : null;
  }

  // May a BACKGROUND pass (the reconcile below, explore.js's silent top-up)
  // write this account's classes into the stored history? Only the member it
  // belongs to — an unstamped one becomes theirs here. Anything unreadable: no.
  function _historyIsMine() {
    try {
      const me = _historyOwnerId();
      const whose = _historyOwnership(localStorage.getItem(HISTORY_OWNER_KEY), me);
      if (whose === 'adopt') localStorage.setItem(HISTORY_OWNER_KEY, me);
      return whose === 'mine' || whose === 'adopt';
    } catch (e) { return false; }
  }
  window._historyIsMine = _historyIsMine;

  // Expose openHistoryModal so the My Bookings tab button can call it
  window.openHistoryModal = openHistoryModal;

  // Two formatters for the whole list, made on the first open — never at module
  // load (tests/suites/booking-extras.js runs this file in a bare sandbox).
  // toLocaleDateString builds a new Intl formatter on every call: two per row,
  // 4,000 for a full history, and nearly all of the time this modal took to open.
  let _histMonthFmt = null, _histDayFmt = null;
  const HISTORY_FIRST_ROWS = 100, HISTORY_MORE_ROWS = 200;

  // ── pure:history-chunks:start ── (DOM-free; tests/suites/render-perf.js evaluates this block)
  // Row ranges [from, to) the modal is filled in: a first screenful that opens
  // at once, then the rest in bigger steps, one per task. A full history is
  // 14,000 elements — built and parsed in one go, that was the freeze on the tap.
  function historyChunks(total, first, step) {
    var out = [];
    var from = 0;
    while (from < total) {
      var to = Math.min(total, from + Math.max(1, out.length ? step : first)); // max: a 0 step must not loop for ever
      out.push([from, to]);
      from = to;
    }
    return out;
  }
  // ── pure:history-chunks:end ──

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
      bodyHtml = '<div class="history-empty">No booking history yet.</div>';
    } else {
      if (!_histMonthFmt) {
        _histMonthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
        _histDayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      }
      // Group by month. One Date per entry, kept for its row below. A date that
      // can't be read gets a group of its own, last: format() THROWS on an
      // Invalid Date where toLocaleDateString printed "Invalid Date", and one
      // bad row must not stop the modal opening.
      const byMonth = {};
      for (const entry of history) {
        const parsed = new Date(String(entry.date).replace(' ', 'T'));
        const d = isNaN(parsed.getTime()) ? null : parsed;
        const key = d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') : '0000-00';
        if (!byMonth[key]) byMonth[key] = { label: d ? _histMonthFmt.format(d) : 'Date unknown', items: [] };
        byMonth[key].items.push({ entry, d });
      }

      // Sort months descending (most recent first). One string per row; a
      // month's header rides on its first row so slices never split them.
      const rows = [];
      const sortedKeys = Object.keys(byMonth).sort().reverse();
      for (const key of sortedKeys) {
        const group = byMonth[key];
        let lead = `<div class="history-month-header">${group.label}</div>`;
        for (const { entry, d } of group.items) {
          const dayStr = d ? _histDayFmt.format(d) : '—';
          const h = d ? d.getHours() : 0, m = d ? d.getMinutes().toString().padStart(2, '0') : '';
          const ampm = h >= 12 ? 'pm' : 'am';
          const timeStr = d ? (h % 12 || 12) + ':' + m + ampm : '';
          const isCancelled = !!entry.cancelledAt;
          const _slH = (typeof slotLabel === 'function') ? slotLabel(entry.typeName) : 'Bike';
          // Escaped: history can come from an imported file, where a slot need not be a number.
          // (No ' | ' in front: the row already joins with "·" — it read "· | Bike 12".)
          const slotsStr = entry.slots && entry.slots.length > 0 ? escapeHtml(formatSlots(_slH, entry.slots)) : '';
          // Crisp Colour: a row says its class type with the small colour mark
          // css/crisp.css draws from data-ct — an attribute, not a pictogram, so
          // 2,000 rows stay cheap. (classTypeKey only ever returns a fixed key.)
          const ct = typeof classTypeKey === 'function' ? classTypeKey(String(entry.typeName || '')) : 'other';
          rows.push(lead + `
            <div class="history-item${isCancelled ? ' cancelled' : ''}" data-ct="${ct}">
              <div class="history-date">${dayStr.replace(' ', '<br>')}</div>
              <div class="history-details">
                <div class="history-class-name">${escapeHtml(entry.typeName)}</div>
                <div class="history-sub">${escapeHtml(entry.instrName)}${entry.locName ? ' &middot; ' + escapeHtml(entry.locName) : ''}${slotsStr ? ' &middot; ' + slotsStr : ''}</div>
              </div>
              ${timeStr ? '<div class="history-time">' + timeStr + '</div>' : ''}
              ${isCancelled ? '<span class="history-cancelled-tag">Cancelled</span>' : ''}
            </div>`);
          lead = '';
        }
      }

      // The newest rows now; the rest a slice per task, in front of a hidden
      // marker, for as long as this modal is the one on screen. (The timer only
      // fires after this function has put the overlay in the document.)
      const chunks = historyChunks(rows.length, HISTORY_FIRST_ROWS, HISTORY_MORE_ROWS);
      bodyHtml = rows.slice(chunks[0][0], chunks[0][1]).join('');
      if (chunks.length > 1) {
        bodyHtml += '<div id="historyModalMore" hidden></div>';
        let next = 1;
        const appendMore = function () {
          const more = overlay.isConnected ? overlay.querySelector('#historyModalMore') : null;
          if (!more) return;
          more.insertAdjacentHTML('beforebegin', rows.slice(chunks[next][0], chunks[next][1]).join(''));
          if (++next < chunks.length) setTimeout(appendMore, 0);
          else more.remove();
        };
        setTimeout(appendMore, 0);
      }
    }

    // role / label / tabindex: app.js's overlay handling moves focus onto the
    // panel, keeps Tab inside it and closes it on Escape.
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="historyModalTitle" tabindex="-1">
        <div class="modal-header">
          <div>
            <div class="modal-title" id="historyModalTitle">Class History</div>
            <div class="modal-subtitle">${history.length} booking${history.length !== 1 ? 's' : ''} recorded</div>
          </div>
          <button class="modal-close" onclick="document.getElementById('historyModalOverlay').remove()" aria-label="Close">&times;</button>
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

  // [label, class] for one row of the modal's class list, or null. What the
  // member most needs before tapping: is it theirs, is it full. Said the way
  // the Discover card says it, with the Crisp primitives (css/crisp.css): yours
  // is a badge in the class colour (a place: the dashed one), nearly full is
  // the "Only 2 left" badge, everything else is quiet text — never the old
  // uppercase .badge tag, and never red for "full" (red is a late-cancel charge).
  function classStatusChip(evt) {
    const held = window._myBookings?.[String(evt.id)];
    if (held) return held.waitlisted ? ['Waitlisted', 'ct-badge is-dashed'] : ['Booked', 'ct-badge'];
    if (evt.is_fully_booked) return [evt.is_waitlistable ? 'Waitlist open' : 'Fully booked', 'instructor-class-status'];
    // Same count, same freshness gate as the detail sheet: this list is built
    // from _eventCache, which can be hours old — no number beats a stale one.
    const fresh = typeof window._countsFresh === 'function' && window._countsFresh(evt._countsAt, Date.now());
    const left = fresh && typeof window._spotsLeft === 'function' ? window._spotsLeft(evt) : null;
    if (left >= 1 && left <= 3) return ['Only ' + left + ' left', 'ct-badge'];
    if (left > 3) return [left + ' spots left', 'instructor-class-status'];
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
    // The id names the dialog below (this modal has no .modal-title).
    profileHtml += `<div class="instructor-name-title" id="instructorModalName">${escapeHtml(instrName)} <span class="instructor-tier-slot">${tierBadge}</span></div>`;
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
    // ★ + S–F on a row of their own UNDER the header, the width of the modal:
    // in the column beside the photo (~240px on a phone) six fingertip-sized
    // tiles cannot fit. Only for a real instructor record: a name with no id
    // has nothing to rank.
    const rankHtml = instr ? instructorRankHtml(instr.id) : '';
    if (rankHtml) profileHtml += `<div class="instructor-rank">${rankHtml}</div>`;

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
        const chip = classStatusChip(evt);
        // Crisp Colour: the row is the compact class component — its type's tile
        // (data-ct → css/crisp.css; both helpers only ever emit fixed strings),
        // then the day over the TIME in the display face — the order every
        // compact wearer uses (the usual-week rows, My Bookings).
        const ct = typeof classTypeKey === 'function' ? classTypeKey(String(evt._typeName || '')) : 'other';
        const tile = typeof classPictogram === 'function' ? `<span class="ct-tile is-lg" aria-hidden="true">${classPictogram(ct, 20)}</span>` : '';
        // A row opens that class's sheet (its Book works with no Discover card
        // in the DOM — _classDetailBookAction). The id rides in data-*, read by
        // the overlay's click listener below.
        listHtml += `
          <div class="instructor-class-item" role="button" tabindex="0" data-ct="${ct}" data-event-id="${escapeHtml(String(evt.id))}">
            ${tile}
            <div class="instructor-class-when">
              <div class="instructor-class-day">${dayStr}</div>
              <div class="instructor-class-time">${(h % 12 || 12) + ':' + m}<span class="instructor-class-ampm">${ampm}</span></div>
            </div>
            <div class="instructor-class-info">
              <div class="instructor-class-type">${escapeHtml(evt._typeName || 'Class')}</div>
              <div class="instructor-class-loc">${escapeHtml(evt._locName || '')}</div>
            </div>
            ${chip ? `<span class="${chip[1]}">${escapeHtml(chip[0])}</span>` : ''}
          </div>`;
      }
      listHtml += '</div>';
    }

    const psycleUrl = `https://psyclelondon.com/pages/timetable-instructor-page/${encodeURIComponent(handle)}`;

    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="instructorModalName" tabindex="-1">
        <div class="modal-header" style="justify-content:flex-end">
          <button class="modal-close" onclick="document.getElementById('instructorModalOverlay').remove()" aria-label="Close">&times;</button>
        </div>
        ${profileHtml}
        ${bioHtml}
        ${listHtml}
        <div class="instructor-actions">
          <button class="instructor-view-schedule pill-btn pill-primary" data-instr-schedule="1">
            View schedule
          </button>
          <a class="instructor-view-schedule instructor-psycle-link pill-btn pill-outline" href="${psycleUrl}" target="_blank" rel="noopener">
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
    // "View schedule" / "View classes" mean THIS instructor's classes: app.js's
    // _focusSearch also drops the studio and class-type filters left on
    // Discover (they hid the classes the modal had just listed), widens a
    // single-day date row to the week, shows Discover and searches.
    if (typeof window._focusSearch === 'function') { window._focusSearch({ instructorId: sid }); return; }
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
          title="${_bellTitle(isWatching)}" aria-label="${_bellLabel(isWatching)}" aria-pressed="${isWatching}"
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
    // Always an array: the key is importable, and every caller indexes into it.
    try {
      const list = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    }
    catch { return []; }
  }

  function saveNotifyWatchlist(list) {
    // Reached from the "Spot opened" dialog BEFORE it opens the class: a quota
    // error thrown here would leave "View class" doing nothing.
    try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(list)); }
    catch (e) { console.warn('[features] watchlist not saved:', e); }
  }

  // Request notification permission
  window.requestNotificationPermission = async function () {
    // No web Notification API (the iOS app's WebView): not an error worth a red
    // toast on every bell tap — the in-app "Spot opened" dialog is the alert.
    if (!('Notification' in window)) return 'denied';
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

  // The bell's glyph is a CSS emoji and its only name was a title, so the emoji
  // is what a screen reader read out. Three places put the bell in a state (the
  // card template, a tap, a watch that ends by itself): one source for its name
  // and its pressed state, so they cannot drift apart.
  function _bellTitle(watching) { return watching ? 'Stop watching for openings' : 'Notify me when a spot opens'; }
  function _bellLabel(watching) { return watching ? 'Stop notifying me' : 'Notify me when a spot opens'; }
  function _setBellState(btn, watching) {
    btn.title = _bellTitle(watching);
    btn.setAttribute('aria-label', _bellLabel(watching));
    btn.setAttribute('aria-pressed', String(!!watching));
  }

  // Toggle notify watchlist for an event
  window._features_toggleNotify = async function (eventId, btn) {
    const eid = String(eventId);
    const watchlist = getNotifyWatchlist();
    const idx = watchlist.indexOf(eid);
    if (idx !== -1) {
      // Remove from watchlist
      watchlist.splice(idx, 1);
      saveNotifyWatchlist(watchlist);
      btn.classList.remove('watching');
      _setBellState(btn, false);
      if (typeof toast === 'function') toast('Stopped watching this class', 'info');
    } else {
      // The watch first, the browser's permission prompt after — and not waited
      // for. A browser notification is a bonus on the web (the alert itself is
      // the in-app dialog), yet the tap used to hang on that prompt: until it
      // was answered nothing was saved, the bell didn't change and no toast
      // showed — a dead tap. (The list was read a moment ago, synchronously:
      // no check can have pruned it in between.)
      watchlist.push(eid);
      saveNotifyWatchlist(watchlist);
      btn.classList.add('watching');
      _setBellState(btn, true);
      // Say what this really is: there is no server or background fetch behind
      // the bell — the class is only looked at while the app is open, signed in.
      if (typeof toast === 'function') {
        toast(_hasToken() ? 'Watching this class — checked whenever Psync is open' : 'Watching this class — sign in so Psync can check it', 'success');
      }
      // Only while the answer is still open: 'granted' needs nothing, and a
      // 'denied' would put its "Notifications are blocked" over the toast above
      // on every bell tap (there is one toast; it used to come first, unseen).
      try {
        if ('Notification' in window && Notification.permission === 'default') {
          Promise.resolve(window.requestNotificationPermission()).catch(function () {});
        }
      } catch (e) {}
    }
  };

  function _hasToken() {
    return typeof window.getBearerToken === 'function' && !!window.getBearerToken();
  }

  // API class times are naive London wall clock. app.js's resolver (the bridge's
  // copy in the iOS app) gives the real instant wherever the device is; without
  // it, the device-local reading shifted by how far the device is from London.
  function _classStartMs(startAt) {
    if (typeof window._psycleClassStartMs === 'function') return window._psycleClassStartMs(startAt);
    const t = Date.parse(String(startAt == null ? '' : startAt).replace(' ', 'T'));
    const ahead = typeof window.londonOffsetDeltaMinutes === 'function' ? window.londonOffsetDeltaMinutes() : 0;
    return t + ahead * 60000;
  }

  // ── pure:notify:start ── (DOM-free; tests/suites/notify.js evaluates this block)
  const WATCH_THROTTLE_MS = 2 * 60 * 1000; // between passes — this is a real booking system, not ours to poll hard
  const WATCH_MAX_PER_PASS = 5;            // GET /events/{id} per pass

  // Which watched ids can go without asking Psycle, and which (at most `cap`)
  // to ask about now. The list is importable (Settings → import), so anything
  // that is not a plain id is dropped before it can reach a URL or a selector.
  function _watchPlan(watchlist, bookings, cache, nowMs, startMs, checkedAt, cap) {
    const drop = [], rest = [], seen = {};
    (Array.isArray(watchlist) ? watchlist : []).forEach(raw => {
      const id = String(raw);
      if (seen[id]) return;
      seen[id] = true;
      if (!/^\d+$/.test(id)) { drop.push(id); return; }
      if (bookings && bookings[id]) { drop.push(id); return; } // already holding a seat or a waitlist place
      const evt = cache && cache[id];
      const t = evt ? startMs(evt.start_at) : NaN;
      if (t <= nowMs) { drop.push(id); return; } // the class has started
      rest.push({ id, t: isNaN(t) ? Infinity : t, last: (checkedAt && checkedAt[id]) || 0 });
    });
    // Least recently asked first, so a list longer than the cap is covered over
    // successive passes instead of starving its tail; then the soonest class.
    rest.sort((a, b) => (a.last - b.last) || (a.t === b.t ? 0 : (a.t < b.t ? -1 : 1)));
    return { drop, check: rest.slice(0, cap).map(r => r.id) };
  }

  // Has a spot opened? Only Psycle SAYING so counts: a missing or null
  // is_fully_booked is never "open" (the old check read a stale cache with
  // `!evt.is_fully_booked`). Mirrors bookClass's own "no seats left" rule — a
  // layout studio also needs a bookable slot in the answer. A studio that is
  // not known to be layout-free gets no benefit of the doubt on an empty list.
  function _watchSpotOpened(detail, studio) {
    const data = detail && detail.data;
    if (!data || data.is_fully_booked !== false) return false;
    const slots = detail.slots;
    if (studio && studio.has_layout === false) return true; // booked by count: no slot list to read
    if (studio && studio.has_layout) return Array.isArray(slots) && slots.length > 0;
    return !(Array.isArray(slots) && slots.length === 0);
  }
  // ── pure:notify:end ──

  let _watchLastPassAt = 0;
  let _watchPassRunning = false;
  const _watchCheckedAt = {}; // eventId → when we last asked (this session)
  const _watchOpened = [];    // ids with an open spot the member has not been shown yet

  function _unwatchIds(ids) {
    if (!ids.length) return;
    // Re-read at write time: a bell may have been tapped while a check was awaiting.
    saveNotifyWatchlist(getNotifyWatchlist().filter(id => !ids.includes(String(id))));
    // Update any rendered notify buttons (ids are digits-only by now, or came from our own queue)
    for (const eid of ids) {
      if (!/^\d+$/.test(eid)) continue;
      const btn = document.querySelector(`.class-card[data-id="${eid}"] .notify-btn`);
      if (btn) {
        btn.classList.remove('watching');
        _setBellState(btn, false);
      }
    }
  }

  // Event detail as _eventCache holds it, for a watched class the cache never
  // had (the watchlist outlives the timetable cache) — openClassDetail and the
  // dialog line both read from there.
  function _watchCacheEntry(detail) {
    const evt = detail.data;
    const rels = detail.relations || {};
    const byId = list => Object.fromEntries((list || []).map(x => [x.id, x]));
    const type = byId(rels.event_types)[evt.event_type_id];
    const instr = byId(rels.instructors)[evt.instructor_id];
    const studio = byId(rels.studios)[evt.studio_id];
    const loc = studio ? byId(rels.locations)[studio.location_id] : null;
    return {
      ...evt,
      _typeName: type?.name || 'Class',
      _instrName: instr?.full_name || '',
      _locName: loc ? loc.name.replace('Psycle ', '') : '',
      _locFullName: loc ? loc.name : '',
      _locAddress: loc ? (loc.address || '') : '',
      _studioName: studio ? studio.name : '',
    };
  }

  // One dialog at a time, and never over a dialog the member is answering
  // (confirmModal is single-instance: showing ours would cancel theirs). A
  // class only leaves the watchlist once its dialog has actually been answered,
  // so closing the app first — or another dialog displacing ours — loses nothing.
  let _watchDialogUp = false;
  let _watchDialogTimer = null;
  function _showOpenedSpots() {
    if (_watchDialogUp) return;
    clearTimeout(_watchDialogTimer);
    const list = getNotifyWatchlist().map(String);
    while (_watchOpened.length && !(list.includes(_watchOpened[0]) && (window._eventCache || {})[_watchOpened[0]])) _watchOpened.shift();
    if (!_watchOpened.length) return;
    // The first-run welcome counts too (it can be replayed from Settings while
    // signed in): full-screen and above confirmModal, the dialog would open
    // under it and its Escape would answer both.
    const busy = (typeof window._dialogOpen === 'function' ? window._dialogOpen() : !!document.getElementById('psycleConfirmOverlay')) ||
      !!document.getElementById('onboardOverlay');
    if (busy) { _watchDialogTimer = setTimeout(_showOpenedSpots, 700); return; }
    const eid = _watchOpened[0];
    const evt = window._eventCache[eid];
    const line = (typeof window._waitlistClassLine === 'function' && window._waitlistClassLine(eid)) ||
      [evt._typeName, evt._instrName].filter(Boolean).join(' · ') || 'A class you were watching';
    if (typeof window.confirmModal !== 'function') {
      _watchOpened.shift();
      _unwatchIds([eid]);
      if (typeof toast === 'function') toast('Spot opened: ' + line, 'success');
      return;
    }
    let replaced = false;
    _watchDialogUp = true;
    window.confirmModal({
      title: 'Spot opened',
      body: line + ' has a spot free. It is not held for you — book it before someone else does.',
      confirmText: 'View class',
      cancelText: 'Not now',
      onReplaced: () => { replaced = true; },
    }).then(view => {
      _watchDialogUp = false;
      if (replaced) { _watchDialogTimer = setTimeout(_showOpenedSpots, 700); return; }
      const at = _watchOpened.indexOf(eid);
      if (at !== -1) _watchOpened.splice(at, 1);
      _unwatchIds([eid]);
      // "View class" only opens the sheet — booking stays the member's own tap there.
      if (view) { if (typeof window.openClassDetail === 'function') window.openClassDetail(eid); return; }
      // A stray tap on the backdrop lands here too, and the bell going off is
      // otherwise invisible — say so (watching on would re-alert every pass).
      if (typeof toast === 'function') toast('No longer watching that class — tap its bell to watch again', 'info');
      // Others found in the same pass get their turn. After "View class" they
      // wait for the next check (still watched) rather than stacking on the sheet.
      if (_watchOpened.length) _watchDialogTimer = setTimeout(_showOpenedSpots, 400);
    });
  }

  // ── Check watched events for openings ──────────────────────────
  // The bell used to re-read _eventCache only — a timetable copy that can be a
  // day old — so it effectively never fired. This asks Psycle about each watched
  // class: GETs only, throttled, a handful per pass, only while signed in — and
  // only after a bookings fetch Psycle ANSWERED (`fresh`): that has just proved
  // the token good, so a check is never what pops "session expired", and when
  // Psycle is failing or unreachable nothing is added to its load.
  async function checkWatchedEvents(fresh) {
    try {
      _showOpenedSpots(); // found earlier, not shown yet (a dialog was in the way / the pass is throttled)
      if (!fresh || _watchPassRunning) return;
      if (getNotifyWatchlist().length === 0) return;
      if (!_hasToken() || navigator.onLine === false || typeof window.apiFetch !== 'function') return;
      const now = Date.now();
      if (now - _watchLastPassAt < WATCH_THROTTLE_MS) return;
      _watchLastPassAt = now;
      _watchPassRunning = true;
      try {
        const cache = window._eventCache || {};
        const plan = _watchPlan(getNotifyWatchlist(), window._myBookings, cache, now, _classStartMs, _watchCheckedAt, WATCH_MAX_PER_PASS);
        const gone = plan.drop.slice();
        // One at a time: five small GETs in a row, never a burst.
        for (const eid of plan.check) {
          if (!_hasToken()) break; // signed out mid-pass
          _watchCheckedAt[eid] = Date.now();
          let res;
          // retries:0 — a background nicety must not lean on Psycle's API when it is struggling
          try { res = await window.apiFetch('/events/' + eid, { retries: 0 }); }
          catch (e) { break; } // offline / timed out: the rest wait for the next pass
          if (res.status === 404) { gone.push(eid); continue; }
          if (!res.ok) continue; // anything else says nothing about the class — keep watching
          let detail;
          try { detail = await res.json(); } catch (e) { continue; }
          if (!detail || !detail.data || typeof detail.data !== 'object') continue;
          const data = detail.data;
          if (_classStartMs(data.start_at) <= Date.now()) { gone.push(eid); continue; }
          // Keep the cache honest either way: the class sheet reads availability from it.
          // Not the cache alone — the loaded timetable's row and the chip counts
          // hold their own copy (the next re-render puts that row back over the
          // cache, and "View class" opens on "Full" again), and the rendered
          // card's DISABLED "Full" button is the one the sheet's Book presses:
          // a dead tap, on a class already taken off the watchlist. app.js owns
          // all three. (typeof: tests/suites/notify.js runs this without it.)
          const moved = typeof window._noteFreshAvailability === 'function' && window._noteFreshAvailability(eid, data);
          if (cache[eid]) {
            ['is_fully_booked', 'is_waitlistable', 'capacity', 'capacity_remaining'].forEach(k => {
              if (data[k] !== undefined) cache[eid][k] = data[k];
            });
          } else {
            cache[eid] = _watchCacheEntry(detail);
          }
          if (moved && typeof window._syncCardButtonsForEvent === 'function') window._syncCardButtonsForEvent(eid);
          const studio = (window._studioMap || {})[data.studio_id] ||
            ((detail.relations && detail.relations.studios) || []).find(s => s && String(s.id) === String(data.studio_id));
          const pending = _watchOpened.indexOf(eid);
          if (!_watchSpotOpened(detail, studio)) {
            if (pending !== -1) _watchOpened.splice(pending, 1); // it went again before the member saw it
            continue;
          }
          if (pending !== -1) continue; // already queued
          _watchOpened.push(eid);
          // Browser notification if permitted (the tab may be in the background)
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              // Same title as the in-app dialog. (It was headed "Psycle — …": this is Psync, not Psycle.)
              new Notification('Spot opened', {
                body: (typeof window._waitlistClassLine === 'function' && window._waitlistClassLine(eid)) || cache[eid]._typeName || 'Class',
                icon: 'icons/icon-192.png',
                tag: 'psycle-notify-' + eid,
              });
            } catch (e) {
              // The in-app dialog below is the alert either way
            }
          }
        }
        _unwatchIds(gone);
      } finally {
        _watchPassRunning = false;
      }
      _showOpenedSpots();
    } catch (e) {
      console.warn('[features] watchlist check failed:', e);
    }
  }

  // ── Line class history up with the bookings Psycle just reported ──
  // Every guard here is a data-corruption trap that was found, not caution for
  // its own sake — see _historyReconcile for what a wrong snapshot would do.
  function reconcileHistoryWithBookings(t0, ownerAtT0) {
    try {
      // The same verified member before and after the fetch (a sign-in as
      // someone else landing mid-flight pairs one account with the other's
      // list), and a history that is theirs — see _historyOwnership.
      const me = _historyOwnerId();
      if (me == null || me !== ownerAtT0 || !_historyIsMine()) return;
      // A book/cancel/join/leave since this fetch began: the snapshot predates
      // it (it could still hold a seat just cancelled, which would be re-added
      // as a fresh class). app.js re-runs the fetch in 250ms; that one counts.
      // Unreadable → assume raced.
      if (typeof _bookingsLocalWriteAt !== 'number' || _bookingsLocalWriteAt > t0) return;
      // Queued offline actions have not reached Psycle yet, so its list is not
      // yet what the member asked for.
      if (JSON.parse(localStorage.getItem('psycle_offline_queue') || '[]').length) return;
      // ONE read and ONE write for the whole pass (addHistoryEntry per seat
      // would re-parse and re-write the full history each time).
      const diff = _historyReconcile(getHistory(), window._myBookings, window._eventCache, Date.now(), _classStartMs, window.PSYCLE_HISTORY_MAX);
      if (!diff.changed) return;
      saveHistory(diff.history);
      // bookings:loaded already repainted Stats — from the history as it was.
      const panel = document.querySelector('.tab-panel.active');
      if (panel && panel.id === 'tab-stats' && typeof window.renderInsights === 'function') window.renderInsights();
    } catch (e) {
      console.warn('[features] history reconcile skipped:', e);
    }
  }

  // ── Monkey-patch fetchMyBookings to check watchlist + reconcile history ──
  function patchFetchMyBookings() {
    const orig = window.fetchMyBookings;
    if (!orig) return;
    window.fetchMyBookings = async function () {
      const t0 = Date.now();
      const hadToken = _hasToken();
      const ownerWas = _historyOwnerId();
      const result = await orig.call(this);
      // `true` alone proves nothing: a signed-out fetch (clearToken runs one)
      // also resolves true, with an EMPTY map. Signed in before AND after, or
      // a sign-in landing mid-flight would pair a token with that empty map.
      if (result === true && hadToken && _hasToken()) reconcileHistoryWithBookings(t0, ownerWas);
      // After bookings refresh, check if any watched events opened up
      // Use a small delay to let _eventCache update from any concurrent render
      setTimeout(function () { checkWatchedEvents(result === true); }, 500);
      return result;
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     UTILITY
     ═══════════════════════════════════════════════════════════════ */

})();
