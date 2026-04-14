/**
 * calendar.js — Calendar sync and ICS export for Psycle Booking PWA
 *
 * Generates iCalendar (RFC 5545) content from booked classes.
 * Provides webcal:// subscription, .ics download, and Google Calendar integration.
 * Responds to service worker requests for calendar data via MessageChannel.
 *
 * Depends on: app.js (_myBookings, _eventCache, toast), state.js (PsycleEvents)
 * Exposes on window (as bare globals):
 *   syncCalendarData, generateICS, downloadICS, openICSInCalendar,
 *   addToGoogleCalendar, getCalendarSubscriptionURL, renderCalendarActions
 */

const CALENDAR_DATA_KEY = 'psycle_calendar_data';

// ── Psycle studio geo coordinates ────────────────────────────────
// Addresses come from the API (relations.locations.address).
// This map only stores lat/lon for map pins and travel time.
// Keys match against both "Psycle X" and stripped "X" names.
const STUDIO_GEO = {
  'oxford circus':  { lat: 51.5188, lon: -0.1402 },
  'bank':           { lat: 51.5155, lon: -0.0870 },
  'victoria':       { lat: 51.4955, lon: -0.1480 },
  'notting hill':   { lat: 51.5154, lon: -0.1910 },
  'london bridge':  { lat: 51.5055, lon: -0.0860 },
  'shoreditch':     { lat: 51.5215, lon: -0.0735 },
  'clapham':        { lat: 51.4622, lon: -0.1680 },
};

function _lookupGeo(locName) {
  if (!locName) return null;
  const key = locName.toLowerCase().replace(/^psycle\s+/, '').trim();
  return STUDIO_GEO[key] || null;
}

/**
 * Persist current bookings + event metadata to localStorage so the
 * service worker can generate the .ics without access to page globals.
 */
function syncCalendarData() {
  const entries = [];
  for (const [evtId, booking] of Object.entries(_myBookings)) {
    const evt = _eventCache[evtId];
    if (!evt) continue;
    // Use the API-provided address (from relations.locations) for calendar events
    const locFullName = evt._locFullName || ('Psycle ' + (evt._locName || ''));
    const apiAddress = evt._locAddress || '';
    const studioName = evt._studioName || '';
    // Display name: "Psycle Oxford Circus — Ride Studio 1"
    let locationDisplay = locFullName;
    if (studioName && studioName !== locFullName) {
      locationDisplay += ' — ' + studioName;
    }
    // Full address for calendar LOCATION field
    const fullAddress = apiAddress ? (locFullName + ', ' + apiAddress) : locationDisplay;
    // Geo coordinates for travel time / map pin
    const geo = _lookupGeo(locFullName) || _lookupGeo(evt._locName);
    entries.push({
      eventId: evtId,
      bookingId: booking.bookingId,
      slots: booking.slots || [],
      startAt: evt.start_at,
      duration: evt.duration,
      typeName: evt._typeName || 'Class',
      instrName: evt._instrName || '',
      locName: locationDisplay,
      address: fullAddress,
      lat: geo ? geo.lat : null,
      lon: geo ? geo.lon : null,
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
    let summary = entry.instrName
      ? `${entry.typeName} - ${entry.instrName}`
      : entry.typeName;
    if (slots) summary += ` (${slots})`;

    const descParts = [];
    if (entry.instrName) descParts.push('Instructor: ' + entry.instrName);
    if (slots) descParts.push(slots);
    descParts.push('Duration: ' + (entry.duration || 45) + 'min');
    const description = descParts.join('\\n');

    // Use full street address for LOCATION if available, otherwise display name
    const locDisplay = entry.address || entry.locName || '';

    lines.push('BEGIN:VEVENT');
    lines.push('UID:psycle-event-' + entry.eventId + '@psyclefinder');
    lines.push('DTSTAMP:' + _icsTimestamp(new Date()));
    lines.push('DTSTART:' + _icsTimestamp(start));
    lines.push('DTEND:' + _icsTimestamp(end));
    lines.push(_icsFold('SUMMARY:' + summary));
    lines.push(_icsFold('LOCATION:' + locDisplay));
    lines.push(_icsFold('DESCRIPTION:' + description));

    // Geo coordinates for travel time / map integration
    if (entry.lat != null && entry.lon != null) {
      lines.push('GEO:' + entry.lat + ';' + entry.lon);
      // Apple Calendar structured location — enables travel time alerts & map pin.
      // Apple requires: no wrapping quotes, commas escaped as \, in param values.
      const esc = s => (s || '').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, ' ');
      const appleAddr = esc(entry.address || locDisplay);
      const appleTitle = esc(entry.locName || '');
      lines.push(
        'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS=' + appleAddr +
        ';X-APPLE-RADIUS=72;X-TITLE=' + appleTitle +
        ':geo:' + entry.lat + ',' + entry.lon
      );
    }

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
  const loc = encodeURIComponent(e.address || e.locName || '');
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
 * Render calendar sync actions inside the My Bookings panel.
 * Called by renderMyBookings — only shows when there are bookings.
 */
function renderCalendarActions() {
  return `<div class="cal-actions">
    <button class="cal-btn" onclick="event.stopPropagation();openICSInCalendar()" title="Open in Calendar app">📅 Add to Calendar</button>
    <button class="cal-btn" onclick="event.stopPropagation();addToGoogleCalendar()" title="Open in Google Calendar">Google Cal</button>
    <button class="cal-btn" onclick="event.stopPropagation();downloadICS()" title="Download .ics file">Download</button>
  </div>`;
}


// Inject styles
(function() {
  if (document.getElementById('calendarPanelStyles')) return;
  const style = document.createElement('style');
  style.id = 'calendarPanelStyles';
  style.textContent = `
    .cal-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      padding: 8px 4px 4px;
      border-top: 1px solid #1a3a1a;
      margin-top: 12px;
    }
    .cal-btn {
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 5px;
      border: 1px solid #3a5a3a;
      background: transparent;
      color: #5dba5d;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
    }
    .cal-btn:hover { background: #1a3a1a; }
  `;
  document.head.appendChild(style);
})();

// ── Sync calendar on booking events (via PsycleEvents) ──────────
if (typeof PsycleEvents !== 'undefined') {
  PsycleEvents.on('booking:complete', syncCalendarData);
  PsycleEvents.on('booking:cancelled', syncCalendarData);
  PsycleEvents.on('seat:cancelled', syncCalendarData);
  PsycleEvents.on('bookings:loaded', syncCalendarData);
}

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

