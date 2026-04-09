// ── Calendar Subscription & ICS Export ──────────────────────────
// Generates iCalendar (RFC 5545) content from booked classes and
// provides both webcal:// subscription and manual .ics download.

const CALENDAR_DATA_KEY = 'psycle_calendar_data';

/**
 * Persist current bookings + event metadata to localStorage so the
 * service worker can generate the .ics without access to page globals.
 */
function syncCalendarData() {
  const entries = [];
  for (const [evtId, booking] of Object.entries(_myBookings)) {
    const evt = _eventCache[evtId];
    if (!evt) continue;
    // Resolve full location name (prefer _locName, fall back to studio lookup)
    let locationName = evt._locName || '';
    if (!locationName) {
      const studio = _studioMap[evt.studio_id];
      if (studio) locationName = studio.name || '';
    }
    entries.push({
      eventId: evtId,
      bookingId: booking.bookingId,
      slots: booking.slots || [],
      startAt: evt.start_at,
      duration: evt.duration,
      typeName: evt._typeName || 'Class',
      instrName: evt._instrName || '',
      locName: locationName,
    });
  }
  try {
    localStorage.setItem(CALENDAR_DATA_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('[calendar] failed to sync data:', e);
  }
}

/**
 * Format a JS Date (or ISO string) into ICS DTSTART/DTEND format:
 * YYYYMMDDTHHmmssZ
 */
function _icsTimestamp(dateInput) {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Fold long ICS lines at 75 octets per RFC 5545 Section 3.1.
 */
function _icsFold(line) {
  if (line.length <= 75) return line;
  const parts = [];
  parts.push(line.slice(0, 75));
  let i = 75;
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
}

/**
 * Build slot/bike label for description.
 * e.g. [12, 15] -> "Bikes 12 & 15", [7] -> "Bike 7", [] -> ""
 */
function _slotLabel(slots) {
  if (!slots || slots.length === 0) return '';
  if (slots.length === 1) return 'Bike ' + slots[0];
  return 'Bikes ' + slots.join(' & ');
}

/**
 * Generate a full VCALENDAR string from the provided entries array.
 * If no argument is given, reads from localStorage.
 */
function generateICS(entriesArg) {
  const entries = entriesArg || (() => {
    try {
      return JSON.parse(localStorage.getItem(CALENDAR_DATA_KEY) || '[]');
    } catch { return []; }
  })();

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Psycle Class Finder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Psycle Classes',
  ];

  for (const entry of entries) {
    const start = new Date(entry.startAt);
    const end = new Date(start.getTime() + (entry.duration || 45) * 60 * 1000);
    const slots = _slotLabel(entry.slots);
    const summary = entry.instrName
      ? `${entry.typeName} - ${entry.instrName}`
      : entry.typeName;

    const descParts = [];
    if (entry.instrName) descParts.push('Instructor: ' + entry.instrName);
    if (slots) descParts.push(slots);
    descParts.push('Duration: ' + (entry.duration || 45) + 'min');
    const description = descParts.join('\\n');

    lines.push('BEGIN:VEVENT');
    lines.push('UID:psycle-event-' + entry.eventId + '@psyclefinder');
    lines.push('DTSTAMP:' + _icsTimestamp(new Date()));
    lines.push('DTSTART:' + _icsTimestamp(start));
    lines.push('DTEND:' + _icsTimestamp(end));
    lines.push(_icsFold('SUMMARY:' + summary));
    lines.push(_icsFold('LOCATION:' + (entry.locName || '')));
    lines.push(_icsFold('DESCRIPTION:' + description));
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * Trigger a browser download of the .ics file.
 */
function downloadICS() {
  syncCalendarData();
  const ics = generateICS();
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'psycle-classes.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Calendar file downloaded', 'success');
}

/**
 * Return the webcal:// subscription URL.
 * NOTE: This only works when a server (or SW within the browser)
 * can serve the .ics file. On static hosts like GitHub Pages,
 * external calendar apps cannot reach the SW — use downloadICS()
 * or addToGoogleCalendar() instead.
 */
function getCalendarSubscriptionURL() {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return 'webcal://' + (base + 'psycle-calendar.ics').replace(/^https?:\/\//, '');
}

/**
 * Open the .ics file directly in the browser so the OS offers to
 * add events to the default calendar app. Works on iOS/macOS/Android.
 */
function openICSInCalendar() {
  syncCalendarData();
  const ics = generateICS();
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  // Opening a blob URL with text/calendar MIME triggers the OS calendar
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Add events to Google Calendar via URL scheme (one at a time for
 * the next upcoming event, since Google doesn't support bulk ICS import via URL).
 */
function addToGoogleCalendar() {
  syncCalendarData();
  let entries;
  try { entries = JSON.parse(localStorage.getItem(CALENDAR_DATA_KEY) || '[]'); } catch { entries = []; }
  const now = new Date();
  const upcoming = entries
    .filter(e => new Date(e.startAt) > now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  if (upcoming.length === 0) {
    toast('No upcoming bookings to add', 'info');
    return;
  }

  // Open Google Calendar add-event for the next class
  const e = upcoming[0];
  const start = new Date(e.startAt);
  const end = new Date(start.getTime() + (e.duration || 45) * 60 * 1000);
  const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const title = encodeURIComponent(e.instrName ? e.typeName + ' - ' + e.instrName : e.typeName);
  const loc = encodeURIComponent(e.locName || '');
  const slots = _slotLabel(e.slots);
  const details = encodeURIComponent(
    (e.instrName ? 'Instructor: ' + e.instrName + '\n' : '') +
    (slots ? slots + '\n' : '') +
    'Duration: ' + (e.duration || 45) + 'min'
  );
  const gcalUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + title +
    '&dates=' + fmt(start) + '/' + fmt(end) +
    '&location=' + loc +
    '&details=' + details;
  window.open(gcalUrl, '_blank');

  if (upcoming.length > 1) {
    toast('Opened next class in Google Calendar. Download .ics for all ' + upcoming.length + ' bookings.', 'info');
  }
}

/**
 * Render the calendar panel UI and append it after the upcoming panel.
 */
function renderCalendarPanel() {
  // Don't render twice
  if (document.getElementById('calendarPanel')) return;

  const panel = document.createElement('div');
  panel.id = 'calendarPanel';
  panel.className = 'calendar-panel';
  panel.innerHTML = `
    <div class="calendar-header">
      <h2>Calendar Sync</h2>
    </div>
    <div class="calendar-body">
      <p class="calendar-desc">Add your booked Psycle classes to your calendar. Re-download after booking or cancelling to keep it in sync.</p>
      <div class="calendar-actions">
        <button class="btn" onclick="openICSInCalendar()">Add to Calendar</button>
        <button class="btn btn-ghost" onclick="addToGoogleCalendar()">Google Calendar</button>
        <button class="btn btn-ghost" onclick="downloadICS()">Download .ics</button>
      </div>
    </div>
  `;

  // Insert after upcomingPanel
  const upcoming = document.getElementById('upcomingPanel');
  if (upcoming && upcoming.parentNode) {
    upcoming.parentNode.insertBefore(panel, upcoming.nextSibling);
  } else {
    // Fallback: insert before #results
    const results = document.getElementById('results');
    if (results && results.parentNode) {
      results.parentNode.insertBefore(panel, results);
    } else {
      document.body.appendChild(panel);
    }
  }

  // Inject minimal styles for the calendar panel
  if (!document.getElementById('calendarPanelStyles')) {
    const style = document.createElement('style');
    style.id = 'calendarPanelStyles';
    style.textContent = `
      .calendar-panel {
        margin: 0 auto;
        max-width: 800px;
        padding: 16px 24px;
        border-bottom: 1px solid #1e1e1e;
      }
      .calendar-header h2 {
        font-size: 15px;
        font-weight: 600;
        color: #ccc;
        margin: 0 0 8px 0;
      }
      .calendar-desc {
        font-size: 13px;
        color: #666;
        margin: 0 0 12px 0;
      }
      .calendar-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .calendar-actions .btn {
        padding: 8px 16px;
        font-size: 13px;
        width: auto;
      }
    `;
    document.head.appendChild(style);
  }
}

// ── Monkey-patch booking/cancel functions to keep calendar in sync ──

(function patchBookingFunctions() {
  // Wrap submitBooking
  const _origSubmitBooking = window.submitBooking;
  if (_origSubmitBooking) {
    window.submitBooking = async function(eventId, slots, btn) {
      await _origSubmitBooking.call(this, eventId, slots, btn);
      syncCalendarData();
    };
  }

  // Wrap confirmUnbook
  const _origConfirmUnbook = window.confirmUnbook;
  if (_origConfirmUnbook) {
    window.confirmUnbook = async function(bookingId, eventId, btn) {
      await _origConfirmUnbook.call(this, bookingId, eventId, btn);
      syncCalendarData();
    };
  }

  // Wrap cancelBikeSlot
  const _origCancelBikeSlot = window.cancelBikeSlot;
  if (_origCancelBikeSlot) {
    window.cancelBikeSlot = async function(slotId, eventId) {
      await _origCancelBikeSlot.call(this, slotId, eventId);
      syncCalendarData();
    };
  }

  // Wrap upcomingCancel
  const _origUpcomingCancel = window.upcomingCancel;
  if (_origUpcomingCancel) {
    window.upcomingCancel = async function(eventId, btn) {
      await _origUpcomingCancel.call(this, eventId, btn);
      syncCalendarData();
    };
  }

  // Wrap fetchMyBookings to sync after initial load
  const _origFetchMyBookings = window.fetchMyBookings;
  if (_origFetchMyBookings) {
    window.fetchMyBookings = async function() {
      await _origFetchMyBookings.call(this);
      syncCalendarData();
    };
  }
})();

// ── Respond to service worker requests for calendar data ────────
// The SW sends a MessageChannel port asking for localStorage data
// since it cannot access localStorage directly.
navigator.serviceWorker?.addEventListener('message', evt => {
  if (evt.data && evt.data.type === 'GET_CALENDAR_DATA') {
    // Make sure data is fresh
    syncCalendarData();
    const data = localStorage.getItem(CALENDAR_DATA_KEY) || '[]';
    // Reply on the transferred port
    if (evt.ports && evt.ports[0]) {
      evt.ports[0].postMessage(data);
    }
  }
});

// Render the calendar panel once the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderCalendarPanel);
} else {
  renderCalendarPanel();
}
