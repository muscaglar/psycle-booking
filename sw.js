const CACHE = 'psycle-ae3ba666';
const SHELL = [
  './psycle-finder.html',
  './index.html',
  './login.html',
  './manifest.json',
  './fonts/bricolage.woff2',
  './fonts/display.woff2',
  './fonts/hanken.woff2',
  './css/discover-layout-fix.css',
  './css/explore.css',
  './css/features.css',
  './css/redesign.css',
  './css/settings.css',
  './css/styles.css',
  './css/tabs.css',
  './css/theme.css',
  './js/api-client.js',
  './js/app.js',
  './js/calendar.js',
  './js/diagnostic.js',
  './js/explore.js',
  './js/facets.js',
  './js/features.js',
  './js/interactions.js',
  './js/performance.js',
  './js/reliability.js',
  './js/security.js',
  './js/settings.js',
  './js/state.js',
  './js/tabs.js',
  './js/theme.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    // cache: 'reload' bypasses the browser HTTP cache. Without it a
    // conditional revalidation can return 304, which makes addAll reject
    // (silently failing the whole install), and stale cached bytes can
    // defeat the version bump.
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
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

// Same noun logic as slotLabel in js/app.js: Bed for Reformer/Pilates,
// Bench for Strength, Bike for Ride — the SW copy used to hardcode "Bike".
function _swSlotNoun(typeName) {
  const n = (typeName || '').toUpperCase();
  if (n.includes('REFORMER') || n.includes('PILATES')) return 'Bed';
  if (n.includes('STRENGTH') || n.includes('LIFT') || n.includes('WEIGHTS') || n.includes('TREAD')) return 'Bench';
  if (n.includes('RIDE')) return 'Bike';
  return 'Spot';
}

function _swSlotLabel(slots, typeName) {
  if (!slots || slots.length === 0) return '';
  const noun = _swSlotNoun(typeName);
  if (slots.length === 1) return noun + ' ' + slots[0];
  return noun + 's ' + slots.join(' & ');
}

// RFC 5545 §3.3.11 TEXT escaping (matches _icsEscapeText in js/calendar.js).
function _swIcsEscapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
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
    const slots = _swSlotLabel(entry.slots, entry.typeName);
    let summary = entry.instrName
      ? entry.typeName + ' - ' + entry.instrName
      : entry.typeName;
    if (slots) summary += ' (' + slots + ')';

    const descParts = [];
    if (entry.instrName) descParts.push('Instructor: ' + entry.instrName);
    if (slots) descParts.push(slots);
    descParts.push('Duration: ' + (entry.duration || 45) + 'min');
    const description = descParts.map(_swIcsEscapeText).join('\\n');

    var locDisplay = entry.address || entry.locName || '';

    lines.push('BEGIN:VEVENT');
    lines.push('UID:psycle-event-' + entry.eventId + '@psyclefinder');
    lines.push('DTSTAMP:' + _swIcsTimestamp(new Date()));
    lines.push('DTSTART:' + _swIcsTimestamp(start));
    lines.push('DTEND:' + _swIcsTimestamp(end));
    lines.push(_swIcsFold('SUMMARY:' + _swIcsEscapeText(summary)));
    lines.push(_swIcsFold('LOCATION:' + _swIcsEscapeText(locDisplay)));
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

  // Network-first for HTML documents so a new deploy (with a bumped CACHE
  // version) takes effect on the next load instead of being served stale.
  // Falls back to cache when offline.
  const isHtml =
    e.request.mode === 'navigate' ||
    (e.request.destination === 'document') ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/' || url.pathname.endsWith('/');

  if (isHtml) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Cache a clone of the fresh HTML for offline fallback
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('./psycle-finder.html')))
    );
    return;
  }

  // Cache-first for static assets (JS/CSS/images), with runtime caching of
  // anything that wasn't in the precache SHELL — a hand-maintained (or
  // generated) SHELL can lag behind new assets, and without this fallback
  // those assets would 404 offline despite the app "supporting offline".
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
