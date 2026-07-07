/**
 * security.js — Security hardening for Psycle Booking PWA
 *
 * Loaded BEFORE app.js. Provides:
 *   - AES-GCM encrypted token storage (key in IndexedDB)
 *   - JWT parsing and expiry monitoring
 *   - HTML escaping utility
 *   - postMessage-based login flow
 *
 * Exposes window.securityReady (Promise) that app.js must await
 * before calling checkAuth().
 */
(function () {
  'use strict';

  // ── Clickjacking guard ──────────────────────────────────────────
  // frame-ancestors can't be enforced from a <meta> CSP (header-only), so
  // bust out of any framing here. Cross-origin top access throws — in that
  // case hide the document instead (an opaque framed page is useless for
  // clickjacking).
  try {
    if (window.top !== window.self) window.top.location = window.location;
  } catch (e) {
    try { document.documentElement.style.display = 'none'; } catch (e2) {}
  }

  // ═══════════════════════════════════════════════════════════════════
  // HTML Escaping — prevents XSS from API-sourced strings
  // ═══════════════════════════════════════════════════════════════════

  // String-replace rather than the textContent→innerHTML div trick: browsers
  // only escape & < > when serializing text nodes, but escapeHTML output is
  // interpolated into double- and single-quoted ATTRIBUTES all over the app,
  // so quotes must be escaped too or a crafted name breaks out of the
  // attribute and injects event handlers.
  var _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  window.escapeHTML = function (str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, function (c) { return _ESC_MAP[c]; });
  };

  // For interpolating a value into a single-quoted JS string INSIDE an HTML
  // attribute (onclick="f('<here>')"). Order is load-bearing: JS-escape
  // backslash+quote FIRST, then HTML-escape — the attribute parser decodes
  // entities before the JS parser runs, so the decoded text must be a valid
  // single-quoted JS string. Use this instead of hand-rolling the two steps.
  window.escapeForJsString = function (str) {
    return window.escapeHTML(String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  };


  // ═══════════════════════════════════════════════════════════════════
  // Token Encryption — AES-GCM with key in IndexedDB
  // ═══════════════════════════════════════════════════════════════════

  var ENC_TOKEN_KEY = 'psycle_bearer_token_enc';
  var LEGACY_TOKEN_KEY = 'psycle_bearer_token';
  var DB_NAME = 'psycle_sec';
  var DB_STORE = 'keys';

  var _token = null;      // decrypted token in memory
  var _cryptoKey = null;   // CryptoKey for AES-GCM
  var _cryptoAvailable = !!(window.crypto && crypto.subtle && window.indexedDB);

  // ── IndexedDB helpers ───────────────────────────────────────────

  function _openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function _idbGet(db, key) {
    return new Promise(function (resolve) {
      var tx = db.transaction(DB_STORE, 'readonly');
      var req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
  }

  function _idbPut(db, key, val) {
    return new Promise(function (resolve) {
      var tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(val, key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { resolve(); };
    });
  }

  // ── AES-GCM helpers ────────────────────────────────────────────

  // In the native app the AES key is also backed up to localStorage (which
  // native-bridge mirrors into Capacitor Preferences). iOS can purge
  // IndexedDB independently of Preferences — without this backup a purge
  // makes the mirrored ciphertext permanently undecryptable and the user is
  // silently signed out. On the web nothing is backed up: key stays in
  // IndexedDB only, so at-rest encryption is unchanged there.
  var KEY_BACKUP_KEY = 'psycle_sec_key_backup';
  var _isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  function _bufToB64(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  }
  function _b64ToBuf(b64) {
    return Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); }).buffer;
  }

  async function _getOrCreateKey() {
    var db = await _openDB();
    var raw = await _idbGet(db, 'enc_key');
    if (raw) {
      if (_isNativeApp) {
        try {
          if (!localStorage.getItem(KEY_BACKUP_KEY)) localStorage.setItem(KEY_BACKUP_KEY, _bufToB64(raw));
        } catch (e) {}
      }
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    var backup = null;
    try { backup = localStorage.getItem(KEY_BACKUP_KEY); } catch (e) {}
    if (backup) {
      try {
        var restored = _b64ToBuf(backup);
        await _idbPut(db, 'enc_key', restored);
        return await crypto.subtle.importKey('raw', restored, 'AES-GCM', false, ['encrypt', 'decrypt']);
      } catch (e) { /* corrupt backup — fall through to a fresh key */ }
    }
    var key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    var exported = await crypto.subtle.exportKey('raw', key);
    await _idbPut(db, 'enc_key', exported);
    if (_isNativeApp) {
      try { localStorage.setItem(KEY_BACKUP_KEY, _bufToB64(exported)); } catch (e) {}
    }
    return key;
  }

  async function _encrypt(plaintext) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var encoded = new TextEncoder().encode(plaintext);
    var cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, _cryptoKey, encoded);
    var cipher = new Uint8Array(cipherBuf);
    var combined = new Uint8Array(iv.length + cipher.length);
    combined.set(iv);
    combined.set(cipher, iv.length);
    return btoa(String.fromCharCode.apply(null, combined));
  }

  async function _decrypt(b64) {
    var combined = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
    var iv = combined.slice(0, 12);
    var cipher = combined.slice(12);
    var buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, _cryptoKey, cipher);
    return new TextDecoder().decode(buf);
  }

  // ── XOR fallback for non-secure contexts (file://) ─────────────

  var _xorKey = 'pSyCl3F1nD3r_2025!';

  function _xorEncode(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      out.push(str.charCodeAt(i) ^ _xorKey.charCodeAt(i % _xorKey.length));
    }
    return btoa(String.fromCharCode.apply(null, out));
  }

  function _xorDecode(b64) {
    try {
      var bytes = atob(b64);
      var out = [];
      for (var i = 0; i < bytes.length; i++) {
        out.push(bytes.charCodeAt(i) ^ _xorKey.charCodeAt(i % _xorKey.length));
      }
      return String.fromCharCode.apply(null, out);
    } catch (e) { return ''; }
  }

  // ── Error-log bridge ───────────────────────────────────────────
  // reliability.js owns the error log (psycle_error_log) and exposes
  // window.pushError — but it loads AFTER security.js, so guard with a
  // typeof check and fall back to writing the same log format directly.

  var ERROR_LOG_KEY = 'psycle_error_log';
  var MAX_ERROR_LOG_ENTRIES = 100;

  function _logSecurityError(msg) {
    try {
      if (typeof window.pushError === 'function') {
        window.pushError('[security] ' + msg);
        return;
      }
      var log = [];
      try { log = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]'); } catch (e) {}
      log.push({ timestamp: new Date().toISOString(), message: '[security] ' + msg });
      if (log.length > MAX_ERROR_LOG_ENTRIES) log = log.slice(log.length - MAX_ERROR_LOG_ENTRIES);
      localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(log));
    } catch (e) { /* logging must never break token storage */ }
  }

  // ── Secure Token Store ─────────────────────────────────────────

  window._secureTokenStore = {
    get: function () { return _token || ''; },

    set: async function (token) {
      _token = token;
      if (!token) { this.clear(); return; }
      try {
        // Values carry a format marker ('aes:' / 'xor:') so startup always
        // decodes with the right scheme — a crypto-availability flip between
        // launches must never feed one format into the other decoder.
        if (_cryptoAvailable && _cryptoKey) {
          var enc = await _encrypt(token);
          localStorage.setItem(ENC_TOKEN_KEY, 'aes:' + enc);
          localStorage.removeItem(LEGACY_TOKEN_KEY);
        } else {
          console.warn('[security] Crypto unavailable — token stored XOR-obfuscated (NOT encrypted) at rest.');
          _logSecurityError('Crypto unavailable — token stored XOR-obfuscated, not encrypted');
          localStorage.setItem(ENC_TOKEN_KEY, 'xor:' + _xorEncode(token));
          localStorage.removeItem(LEGACY_TOKEN_KEY);
        }
      } catch (e) {
        // Last resort fallback — keeps login working (login.html writes the
        // legacy key and the main app migrates it), but the token is now
        // stored in PLAINTEXT, so make the failure loud.
        var reason = (e && e.message) ? e.message : String(e);
        console.warn('[security] Token encryption FAILED (' + reason + ') — '
          + 'falling back to PLAINTEXT localStorage. The bearer token is NOT encrypted at rest.');
        _logSecurityError('Token encryption failed (' + reason + ') — plaintext localStorage fallback used');
        localStorage.setItem(LEGACY_TOKEN_KEY, token);
      }
    },

    clear: function () {
      _token = null;
      localStorage.removeItem(ENC_TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
  };

  // ── Initialization: decrypt stored token ───────────────────────

  // Timeout wrapper: if crypto init takes >3s, fall back to legacy storage
  function _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, ms); })
    ]);
  }

  // Native app: native-bridge restores mirrored keys (token ciphertext, AES
  // key backup) from Capacitor Preferences into localStorage asynchronously.
  // Wait for that restore before reading localStorage, or a post-purge launch
  // reads an empty store and signs the user out even though the token was
  // restored milliseconds later. Promise handshake (security.js loads first
  // and creates it; native-bridge resolves it), raced against a 4s cap so a
  // bridge failure can't brick startup.
  if (_isNativeApp) {
    window._psycleNativeRestoreReady = new Promise(function (resolve) {
      window._psycleNativeRestoreResolve = resolve;
    });
  }
  async function _awaitNativeRestore() {
    if (!_isNativeApp) return;
    await Promise.race([
      window._psycleNativeRestoreReady,
      new Promise(function (r) { setTimeout(r, 4000); }),
    ]);
  }

  window.securityReady = (async function () {
    await _awaitNativeRestore();

    try {
      if (_cryptoAvailable) {
        _cryptoKey = await _withTimeout(_getOrCreateKey(), 3000);
      }
    } catch (e) {
      console.warn('[security] Crypto init failed/timed out, using fallback');
      _cryptoAvailable = false;
    }

    // Migrate legacy plaintext token
    var legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacy) {
      _token = legacy;
      // Encrypt it in background
      window._secureTokenStore.set(legacy);
      return;
    }

    // Decode the stored token according to its format marker.
    var enc = localStorage.getItem(ENC_TOKEN_KEY);
    if (enc) {
      try {
        if (enc.indexOf('xor:') === 0) {
          _token = _xorDecode(enc.slice(4)) || null;
        } else if (enc.indexOf('aes:') === 0) {
          if (_cryptoAvailable && _cryptoKey) {
            _token = await _decrypt(enc.slice(4));
          } else {
            // AES blob but crypto didn't come up this launch (slow device /
            // init timeout). Never XOR-decode it into garbage and never
            // delete it — leave it for the next launch; this session just
            // needs a fresh sign-in.
            _logSecurityError('AES token stored but crypto unavailable this launch — blob kept');
            _token = null;
          }
        } else {
          // Pre-marker blob — could be AES or XOR depending on how it was
          // written. Try AES first, fall back to XOR; reject XOR output that
          // is binary garbage (an XOR-decode of an AES blob), then re-store
          // with a format marker.
          if (_cryptoAvailable && _cryptoKey) {
            try { _token = await _decrypt(enc); }
            catch (eAes) { _token = _xorDecode(enc) || null; }
          } else {
            _token = _xorDecode(enc) || null;
          }
          if (_token && !/^[\x20-\x7E]+$/.test(_token)) _token = null;
          if (_token) window._secureTokenStore.set(_token);
        }
      } catch (e) {
        // Decrypt failed — most likely the AES key was lost/rotated. KEEP the
        // blob: deleting it here would also propagate into the native
        // Preferences mirror and destroy the last copy. A later launch with
        // the right key can still recover it; this session needs a sign-in.
        console.warn('[security] Token decryption failed — sign-in required (stored blob kept)');
        _logSecurityError('Token decryption failed — possible key loss; blob kept for recovery');
        _token = null;
      }
    }
  })();


  // ═══════════════════════════════════════════════════════════════════
  // JWT Parsing & Expiry Monitoring
  // ═══════════════════════════════════════════════════════════════════

  window.parseJWT = function (token) {
    try {
      if (!token) return null;
      var parts = token.split('.');
      if (parts.length !== 3) return null;
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64));
    } catch (e) { return null; }
  };

  window.getTokenExpiry = function () {
    var payload = parseJWT(_token);
    if (!payload || !payload.exp) return null;
    return new Date(payload.exp * 1000);
  };

  var _expiryTimer = null;
  var _expiryTimer2 = null;

  // True when the token is within the warning window of expiry. Read by
  // bookClass() to warn BEFORE a booking attempt fails at checkout.
  window.isTokenExpiringSoon = function (withinMs) {
    var expiry = getTokenExpiry();
    if (!expiry) return false; // opaque/non-JWT token — can't tell, assume fine
    var msLeft = expiry.getTime() - Date.now();
    return msLeft <= (withinMs || 5 * 60 * 1000);
  };

  function _emitExpiring() {
    try {
      if (typeof PsycleState !== 'undefined') PsycleState._tokenExpiringSoon = true;
      if (typeof PsycleEvents !== 'undefined') PsycleEvents.emit('token:expiring-soon');
    } catch (e) {}
    if (typeof toast === 'function') toast('Session expiring soon — sign in again to keep booking', 'info');
  }

  // Cancel BOTH expiry timers (warning + final). Called on sign-out and on
  // session expiry so no stale timer can fire against a signed-out state or
  // a freshly re-issued token.
  window.cancelTokenExpiryCheck = function () {
    if (_expiryTimer) { clearTimeout(_expiryTimer); _expiryTimer = null; }
    if (_expiryTimer2) { clearTimeout(_expiryTimer2); _expiryTimer2 = null; }
    try { if (typeof PsycleState !== 'undefined') PsycleState._tokenExpiringSoon = false; } catch (e) {}
  };

  window.scheduleTokenExpiryCheck = function () {
    cancelTokenExpiryCheck();
    var expiry = getTokenExpiry();
    if (!expiry) return;

    var msLeft = expiry.getTime() - Date.now();

    // Timers re-check the LIVE token before acting: if the user re-logged in
    // meanwhile, the timer rearms for the new expiry instead of wiping it.
    function _fireExpiredIfStillExpired() {
      var exp = getTokenExpiry();
      if (!exp) return; // token gone or no longer parseable — nothing to expire
      if (exp.getTime() - Date.now() > 60 * 1000) { window.scheduleTokenExpiryCheck(); return; }
      if (typeof showSessionExpired === 'function') showSessionExpired();
    }

    // Warn 5 minutes before expiry
    var warnMs = msLeft - 5 * 60 * 1000;
    if (warnMs > 0) {
      _expiryTimer = setTimeout(function () {
        var exp = getTokenExpiry();
        if (!exp || exp.getTime() - Date.now() > 6 * 60 * 1000) {
          window.scheduleTokenExpiryCheck(); // token changed — rearm
          return;
        }
        _emitExpiring();
        _expiryTimer2 = setTimeout(_fireExpiredIfStillExpired, 5 * 60 * 1000);
      }, warnMs);
    } else if (msLeft > 0) {
      // Less than 5 min left
      _emitExpiring();
      _expiryTimer = setTimeout(_fireExpiredIfStillExpired, msLeft);
    } else {
      // Already expired
      _fireExpiredIfStillExpired();
    }
  };


  // ═══════════════════════════════════════════════════════════════════
  // postMessage Login Flow
  // ═══════════════════════════════════════════════════════════════════

  window.addEventListener('message', function (e) {
    // Only our own login page may hand us a token — an arbitrary page that
    // holds a window reference must not be able to replace the session.
    // (file:// contexts report origin 'null'; allow that only when we are
    // ourselves running from file://.)
    var sameOrigin = e.origin === location.origin ||
      (e.origin === 'null' && location.protocol === 'file:');
    if (!sameOrigin) return;
    if (!e.data || e.data.type !== 'PSYCLE_LOGIN_TOKEN') return;
    var token = e.data.token;
    if (!token || typeof token !== 'string' || token.length < 10) return;

    window._secureTokenStore.set(token).then(function () {
      if (typeof checkAuth === 'function') checkAuth();
      scheduleTokenExpiryCheck();
    });
  });


})();
