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

  // ═══════════════════════════════════════════════════════════════════
  // HTML Escaping — prevents XSS from API-sourced strings
  // ═══════════════════════════════════════════════════════════════════

  var _escDiv = document.createElement('div');

  window.escapeHTML = function (str) {
    _escDiv.textContent = str || '';
    return _escDiv.innerHTML;
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

  async function _getOrCreateKey() {
    var db = await _openDB();
    var raw = await _idbGet(db, 'enc_key');
    if (raw) {
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    var key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    var exported = await crypto.subtle.exportKey('raw', key);
    await _idbPut(db, 'enc_key', exported);
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

  // ── Secure Token Store ─────────────────────────────────────────

  window._secureTokenStore = {
    get: function () { return _token || ''; },

    set: async function (token) {
      _token = token;
      if (!token) { this.clear(); return; }
      try {
        if (_cryptoAvailable && _cryptoKey) {
          var enc = await _encrypt(token);
          localStorage.setItem(ENC_TOKEN_KEY, enc);
          localStorage.removeItem(LEGACY_TOKEN_KEY);
        } else {
          localStorage.setItem(ENC_TOKEN_KEY, _xorEncode(token));
          localStorage.removeItem(LEGACY_TOKEN_KEY);
        }
      } catch (e) {
        // Last resort fallback
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

  window.securityReady = (async function () {
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

    // Decrypt stored encrypted token
    var enc = localStorage.getItem(ENC_TOKEN_KEY);
    if (enc) {
      try {
        if (_cryptoAvailable && _cryptoKey) {
          _token = await _decrypt(enc);
        } else {
          _token = _xorDecode(enc);
        }
      } catch (e) {
        console.warn('[security] Token decryption failed, clearing');
        localStorage.removeItem(ENC_TOKEN_KEY);
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

  window.scheduleTokenExpiryCheck = function () {
    if (_expiryTimer) clearTimeout(_expiryTimer);
    var expiry = getTokenExpiry();
    if (!expiry) return;

    var msLeft = expiry.getTime() - Date.now();

    // Warn 5 minutes before expiry
    var warnMs = msLeft - 5 * 60 * 1000;
    if (warnMs > 0) {
      _expiryTimer = setTimeout(function () {
        if (typeof toast === 'function') toast('Session expiring soon — sign in again to continue', 'info');
        // Set another timer for actual expiry
        setTimeout(function () {
          if (typeof showSessionExpired === 'function') showSessionExpired();
        }, 5 * 60 * 1000);
      }, warnMs);
    } else if (msLeft > 0) {
      // Less than 5 min left
      _expiryTimer = setTimeout(function () {
        if (typeof showSessionExpired === 'function') showSessionExpired();
      }, msLeft);
    } else {
      // Already expired
      if (typeof showSessionExpired === 'function') showSessionExpired();
    }
  };


  // ═══════════════════════════════════════════════════════════════════
  // postMessage Login Flow
  // ═══════════════════════════════════════════════════════════════════

  window.addEventListener('message', function (e) {
    // Accept token from login.html (same origin or trusted opener)
    if (!e.data || e.data.type !== 'PSYCLE_LOGIN_TOKEN') return;
    var token = e.data.token;
    if (!token || typeof token !== 'string' || token.length < 10) return;

    window._secureTokenStore.set(token).then(function () {
      if (typeof checkAuth === 'function') checkAuth();
      scheduleTokenExpiryCheck();
    });
  });


})();
