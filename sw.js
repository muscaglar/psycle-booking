const CACHE = 'psycle-v6';
const SHELL = [
  './psycle-finder.html',
  './styles.css',
  './theme.css',
  './features.css',
  './state.js',
  './security.js',
  './theme.js',
  './app.js',
  './reliability.js',
  './interactions.js',
  './performance.js',
  './calendar.js',
  './features.js',
  './tabs.css',
  './tabs.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── ICS generation inside the service worker ────────────────────
// Reads booking data from localStorage (synced by calendar.js on the
// main page) via a MessageChannel, then builds RFC 5545 content.

function _swIcsTimestamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function _swIcsFold(line) {
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

function _swSlotLabel(slots) {
  if (!slots || slots.length === 0) return '';
  if (slots.length === 1) return 'Bike ' + slots[0];
  return 'Bikes ' + slots.join(' & ');
}

function _swGenerateICS(entries) {
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
    const slots = _swSlotLabel(entry.slots);
    let summary = entry.instrName
      ? entry.typeName + ' - ' + entry.instrName
      : entry.typeName;
    if (slots) summary += ' (' + slots + ')';

    const descParts = [];
    if (entry.instrName) descParts.push('Instructor: ' + entry.instrName);
    if (slots) descParts.push(slots);
    descParts.push('Duration: ' + (entry.duration || 45) + 'min');
    const description = descParts.join('\\n');

    var locDisplay = entry.address || entry.locName || '';

    lines.push('BEGIN:VEVENT');
    lines.push('UID:psycle-event-' + entry.eventId + '@psyclefinder');
    lines.push('DTSTAMP:' + _swIcsTimestamp(new Date()));
    lines.push('DTSTART:' + _swIcsTimestamp(start));
    lines.push('DTEND:' + _swIcsTimestamp(end));
    lines.push(_swIcsFold('SUMMARY:' + summary));
    lines.push(_swIcsFold('LOCATION:' + locDisplay));
    lines.push(_swIcsFold('DESCRIPTION:' + description));
    if (entry.lat != null && entry.lon != null) {
      lines.push('GEO:' + entry.lat + ';' + entry.lon);
      var esc = function(s) { return (s || '').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, ' '); };
      lines.push(
        'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS=' + esc(entry.address || locDisplay) +
        ';X-APPLE-RADIUS=72;X-TITLE=' + esc(entry.locName || '') +
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
 * Ask a client page for the calendar data stored in localStorage.
 * Returns a Promise that resolves to the entries array.
 */
function _swGetCalendarData() {
  return self.clients.matchAll({ type: 'window' }).then(clients => {
    if (clients.length === 0) return [];
    return new Promise(resolve => {
      const ch = new MessageChannel();
      ch.port1.onmessage = evt => {
        try { resolve(JSON.parse(evt.data || '[]')); }
        catch { resolve([]); }
      };
      // Timeout after 2 seconds in case the page doesn't respond
      const timer = setTimeout(() => resolve([]), 2000);
      ch.port1.onmessage = evt => {
        clearTimeout(timer);
        try { resolve(JSON.parse(evt.data || '[]')); }
        catch { resolve([]); }
      };
      clients[0].postMessage({ type: 'GET_CALENDAR_DATA' }, [ch.port2]);
    });
  });
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Intercept requests for /psycle-calendar.ics
  if (url.pathname.endsWith('/psycle-calendar.ics')) {
    e.respondWith(
      _swGetCalendarData().then(entries => {
        const ics = _swGenerateICS(entries);
        return new Response(ics, {
          status: 200,
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'attachment; filename="psycle-classes.ics"',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      })
    );
    return;
  }

  // Always network-first for API calls
  if (url.hostname.includes('psycle.codexfit') || url.hostname.includes('corsproxy')) {
    return; // fall through to network
  }

  // Cache-first for the app shell
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
