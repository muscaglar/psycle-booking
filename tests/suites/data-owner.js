'use strict';
// Whose data is on this device (js/app.js, pure:data-owner + _claimDataOwner):
// history, rankings, favourites, bike prefs, the usual bike, the weekly
// template… used to belong to the INSTALL. A second member signing in on the
// same device inherited all of it, was never offered their own history sync,
// and a manual sync merged both members' classes for good.
//
// Two layers, like the session suite:
//   1. the DOM-free block, driven with a fake Storage (incl. one that is full,
//      and one cut short half-way through a switch);
//   2. the REAL _applyProfile, sliced by the session suite's anchors, with a
//      localStorage in reach — the swap has to land BEFORE profile:updated.
module.exports = async function (t) {
  const { ok, eq } = t;
  const p = t.loadPure('js/app.js', 'data-owner');
  const NOW = '2026-09-18T09:00:00.000Z', LATER = '2026-09-19T09:00:00.000Z';

  const A_DATA = {
    psycle_instructor_tiers: '{"11":"S"}',
    psycle_fav_instructors: '["11","22"]',
    psycle_bike_prefs: '{"4":{"avoid":[1],"prefer":[7]}}',
    psycle_bike_history: '{"4":{"11":{"7":3}}}',
    psycle_weekly_template: '[{"dayOfWeek":1,"hour":7,"minute":0}]',
    psycle_recent_searches: '[{"instructors":["11"]}]',
    psycle_notify_watchlist: '["901"]',
    psycle_class_history: '[{"eventId":"1","instrName":"Alex","date":"2026-01-05 07:00:00"}]',
    psycle_history_synced: '2026-02-01T00:00:00.000Z',
    psycle_history_prompt_dismissed: '1',
    psycle_calendar_data: '[{"eventId":"1"}]',
    psycle_offline_queue: '[{"eventId":77,"slots":[7]}]',
  };
  const SMALL = ['psycle_instructor_tiers', 'psycle_fav_instructors', 'psycle_bike_prefs', 'psycle_bike_history',
    'psycle_weekly_template', 'psycle_recent_searches', 'psycle_notify_watchlist'];
  const REBUILDABLE = ['psycle_class_history', 'psycle_history_synced', 'psycle_history_prompt_dismissed', 'psycle_calendar_data', 'psycle_offline_queue', 'psycle_class_history_owner'];
  // features.js's own verdict on the history stamp (what _historyIsMine asks).
  const historyOwnership = t.loadPure('js/features.js', 'history')._historyOwnership;
  const seed = (extra) => {
    const s = t.makeFakeLocalStorage();
    Object.entries(Object.assign({}, A_DATA, extra || {})).forEach(([k, v]) => s.setItem(k, v));
    return s;
  };
  const stashOf = (s) => JSON.parse(s.getItem('psycle_account_stash') || '{}');

  t.section('Data owner: the plan');
  eq(p._dataOwnerPlan(null, 7), 'adopt', 'no stamp yet (an install from before stamps existed): adopt');
  eq(p._dataOwnerPlan('', 7), 'adopt', 'an empty stamp is no stamp');
  eq(p._dataOwnerPlan('7', 7), 'same', 'same customer (number vs stored string): same');
  eq(p._dataOwnerPlan('7', '8'), 'switch', 'a different customer id: switch');
  eq([p._dataOwnerPlan('7', null), p._dataOwnerPlan('7', undefined), p._dataOwnerPlan('7', '')], ['none', 'none', 'none'], 'a profile without an id decides nothing');

  t.section('Data owner: legacy install is adopted, never wiped');
  {
    const s = seed();
    const before = s._dump();
    const r = p._swapAccountData(s, 7, NOW);
    eq(r.action, 'adopt', 'first verified profile on an unstamped install → adopt');
    eq(s.getItem('psycle_data_owner'), '7', '…the install is stamped with that customer');
    const after = s._dump();
    delete after.psycle_data_owner;
    eq(after, before, '…and not one key is moved or removed (a wipe here would cost every member their history on update)');
  }

  t.section('Data owner: same member is a no-op');
  {
    const s = seed({ psycle_data_owner: '7' });
    const before = s._dump();
    const r = p._swapAccountData(s, '7', NOW);
    eq([r.action, s._dump()], ['same', before], 'signing back in as the stamped member touches nothing (sign-out / expiry never move data)');
    eq(p._swapAccountData(s, null, NOW).action, 'none', 'no id → nothing');
    eq(s._dump(), before, '…still untouched');
  }

  t.section('Data owner: A → B stashes A\'s hand-entered keys and clears what Psycle can rebuild');
  let sAB;
  {
    const s = seed({ psycle_data_owner: '7', psycle_class_history_owner: '7', psycle_theme: 'linen', psycle_saved_filters: '{"locationIds":["3"]}', psycle_bearer_token_enc: 'aes:blob' });
    const writes = [];
    const realSet = s.setItem.bind(s);
    // The stash must be on disk BEFORE the first removal.
    let stashWrittenBeforeRemoval = null;
    const realRemove = s.removeItem.bind(s);
    s.removeItem = (k) => { if (stashWrittenBeforeRemoval === null) stashWrittenBeforeRemoval = !!s.getItem('psycle_account_stash'); realRemove(k); };
    s.setItem = (k, v) => { writes.push(k); realSet(k, v); };
    const r = p._swapAccountData(s, 8, NOW);
    eq([r.action, r.from, r.to], ['switch', '7', '8'], 'a different verified customer → switch');
    ok(stashWrittenBeforeRemoval === true, 'the stash is written BEFORE anything is removed');
    eq(writes[0], 'psycle_account_stash', '…it is the very first write');
    eq(SMALL.concat(REBUILDABLE).filter((k) => s.getItem(k) !== null), [], 'none of A\'s per-account keys is left for B (history, sync flags, rankings, favourites, bike prefs/history, template, searches, alerts, calendar data, offline queue)');
    eq(r.cleared.slice().sort(), SMALL.concat(REBUILDABLE).sort(), '…and the result lists exactly those');
    eq(s.getItem('psycle_data_owner'), '8', 'the install is now stamped B');
    eq([s.getItem('psycle_class_history_owner'), historyOwnership(s.getItem('psycle_class_history_owner'), '8')], [null, 'adopt'],
      'the HISTORY stamp goes with the history: left on A, B\'s /bookings reconcile and weekly top-up were refused for good (_historyIsMine → "other")');
    eq(t.vm.runInContext('ACCOUNT_CLEAR_KEYS[ACCOUNT_CLEAR_KEYS.length - 1]', p), 'psycle_class_history_owner', '…and it is the LAST key removed (a switch inferred from it must stay resumable until then)');
    const stash = stashOf(s);
    eq(Object.keys(stash), ['7'], 'A is the one member in the stash');
    eq(Object.keys(stash['7'].keys).sort(), SMALL.slice().sort(), 'A\'s stash holds the small hand-entered keys…');
    eq(SMALL.map((k) => stash['7'].keys[k]), SMALL.map((k) => A_DATA[k]), '…byte for byte');
    ok(!REBUILDABLE.some((k) => k in stash['7'].keys), '…and NOT the class history, its flags or the offline queue (re-syncable / never to be replayed)');
    eq([stash['7'].savedAt, stash['7'].pending], [NOW, ''], 'stamped with when, and no longer pending');
    eq([s.getItem('psycle_theme'), s.getItem('psycle_saved_filters'), s.getItem('psycle_bearer_token_enc')], ['linen', '{"locationIds":["3"]}', 'aes:blob'],
      'device-level keys (theme, last filters, the token) are not account data: untouched');
    eq(r.restored, [], 'B is new here: nothing to restore');
    sAB = s;
    s.setItem = realSet; s.removeItem = realRemove;
  }

  t.section('Data owner: B → A restores A\'s, stashes B\'s');
  {
    const s = sAB;
    // B uses the app for a while.
    s.setItem('psycle_instructor_tiers', '{"55":"A"}');
    s.setItem('psycle_fav_instructors', '["55"]');
    s.setItem('psycle_class_history', '[{"eventId":"9","instrName":"Bea","date":"2026-09-01 07:00:00"}]');
    s.setItem('psycle_history_synced', '2026-09-02T00:00:00.000Z');
    s.setItem('psycle_class_history_owner', '8'); // features.js adopted the empty history for B
    const r = p._swapAccountData(s, '7', LATER);
    eq([r.action, r.from, r.to], ['switch', '8', '7'], 'A comes back');
    eq(SMALL.map((k) => s.getItem(k)), SMALL.map((k) => A_DATA[k]), 'every one of A\'s small keys is back exactly as it was');
    eq(r.restored.slice().sort(), SMALL.slice().sort(), '…and the result lists them');
    eq([s.getItem('psycle_class_history'), s.getItem('psycle_history_synced'), s.getItem('psycle_history_prompt_dismissed')], [null, null, null],
      'B\'s class history is NOT handed to A — and A\'s own was never stashed: A is offered a fresh sync');
    const stash = stashOf(s);
    eq(Object.keys(stash), ['8'], 'the stash now holds B only (A\'s entry is consumed)');
    eq([stash['8'].keys.psycle_instructor_tiers, stash['8'].keys.psycle_fav_instructors], ['{"55":"A"}', '["55"]'], '…with B\'s rankings and favourites');
    eq(s.getItem('psycle_data_owner'), '7', 'stamped A again');
    eq([s.getItem('psycle_class_history_owner'), historyOwnership(s.getItem('psycle_class_history_owner'), '7')], [null, 'adopt'], '…and B\'s history stamp is gone: A adopts the fresh history');
  }

  t.section('Data owner: an unstamped install whose HISTORY is stamped someone else\'s is a switch, not an adopt');
  {
    // Updated from the build that stamped histories but not installs: member 111's
    // device, and the first verified /profile after the update is member 222.
    const s = seed({ psycle_class_history_owner: '111' });
    const r = p._swapAccountData(s, '222', NOW);
    eq([r.action, r.from, r.to], ['switch', '111', '222'], 'history stamp 111 + profile 222 → switch 111 → 222 (adopt made 222 the owner of 111\'s rankings AND history)');
    eq([s.getItem('psycle_class_history'), s.getItem('psycle_class_history_owner'), s.getItem('psycle_instructor_tiers'), s.getItem('psycle_data_owner')], [null, null, null, '222'],
      '222 starts clean: no history of 111\'s, no stamp, no rankings');
    eq(stashOf(s)['111'].keys.psycle_instructor_tiers, A_DATA.psycle_instructor_tiers, '111\'s hand-entered keys are stashed under THEIR id');
    const back = p._swapAccountData(s, '111', LATER);
    eq([back.action, s.getItem('psycle_instructor_tiers'), s.getItem('psycle_fav_instructors')], ['switch', A_DATA.psycle_instructor_tiers, A_DATA.psycle_fav_instructors],
      '111 comes back to their own rankings and favourites (they were stashed under 222 and lost before)');

    // The same member as the history stamp: still a plain adopt, nothing moved.
    const mine = seed({ psycle_class_history_owner: '7' });
    const before = mine._dump();
    eq(p._swapAccountData(mine, 7, NOW).action, 'adopt', 'history stamp = this member → adopt as before');
    const after = mine._dump(); delete after.psycle_data_owner;
    eq(after, before, '…and not one key is moved');

    // A stamp the stash could not be keyed by is no evidence of anything.
    for (const junk of ['__proto__', 'bad id!', 'x'.repeat(65), '']) {
      const j = seed({ psycle_class_history_owner: junk });
      eq([p._swapAccountData(j, '8', NOW).action, j.getItem('psycle_class_history') !== null], ['adopt', true], 'history stamp ' + JSON.stringify(junk.slice(0, 12)) + ' → adopt, nothing removed');
    }

    // Killed just before the last removal (the history stamp — removed LAST for
    // exactly this): the next /profile infers the same switch and resumes it.
    const k = seed({ psycle_class_history_owner: '111' });
    const realRemove = k.removeItem.bind(k);
    k.removeItem = (key) => { if (key === 'psycle_class_history_owner') throw new Error('killed'); realRemove(key); };
    const realSet = k.setItem.bind(k);
    k.setItem = (key, v) => { if (key === 'psycle_data_owner') throw new Error('killed'); realSet(key, v); };
    eq([p._swapAccountData(k, '222', NOW).action, k.getItem('psycle_class_history_owner'), k.getItem('psycle_data_owner')], ['error', '111', null], 'first attempt dies with the history stamp still there and no install stamp');
    k.removeItem = realRemove; k.setItem = realSet;
    k.setItem('psycle_fav_instructors', '["222s"]'); // 222 starred someone in between
    const again = p._swapAccountData(k, '222', LATER);
    eq([again.action, again.from, k.getItem('psycle_class_history_owner')], ['switch', '111', null], 'second attempt: still read as a switch away from 111, and finished');
    eq(stashOf(k)['111'].keys.psycle_fav_instructors, A_DATA.psycle_fav_instructors, '…resumed from the stash — 111\'s favourites, not the half-moved value');
    // Killed one step later (stamp removed, install not stamped yet): nothing of
    // 111's is left to hand over, so adopting the cleaned install is right.
    const k2 = seed({ psycle_class_history_owner: '111' });
    const realSet2 = k2.setItem.bind(k2);
    k2.setItem = (key, v) => { if (key === 'psycle_data_owner') throw new Error('killed'); realSet2(key, v); };
    p._swapAccountData(k2, '222', NOW);
    k2.setItem = realSet2;
    eq([p._swapAccountData(k2, '222', LATER).action, k2.getItem('psycle_class_history'), stashOf(k2)['111'].keys.psycle_instructor_tiers], ['adopt', null, A_DATA.psycle_instructor_tiers],
      '…and a kill after that removal: 222 adopts an install already emptied of 111\'s data; 111\'s stash is intact');
  }

  t.section('Data owner: at most two members are kept, the oldest goes');
  {
    const s = t.makeFakeLocalStorage();
    s.setItem('psycle_data_owner', '1');
    s.setItem('psycle_fav_instructors', '["1"]');
    p._swapAccountData(s, '2', '2026-01-01T00:00:00.000Z');
    s.setItem('psycle_fav_instructors', '["2"]');
    p._swapAccountData(s, '3', '2026-02-01T00:00:00.000Z');
    s.setItem('psycle_fav_instructors', '["3"]');
    p._swapAccountData(s, '4', '2026-03-01T00:00:00.000Z');
    eq(Object.keys(stashOf(s)).sort(), ['2', '3'], 'after 1→2→3→4 the stash holds the two most recent leavers (member 1 is gone)');
    // A returning member is never the one evicted to make room.
    p._swapAccountData(s, '2', '2026-04-01T00:00:00.000Z');
    eq([s.getItem('psycle_fav_instructors'), Object.keys(stashOf(s)).sort()], ['["2"]', ['3', '4']], 'member 2 returns: their favourites are restored; the stash is 3 and 4');
  }

  t.section('Data owner: a corrupt stash is tolerated');
  {
    for (const junk of ['{not json', '[]', '"str"', '{"7":null,"__proto__":{"keys":{"psycle_fav_instructors":"[\\"evil\\"]"}},"9":{"keys":"nope"}}']) {
      const s = seed({ psycle_data_owner: '7', psycle_account_stash: junk });
      let r = null, threw = false;
      try { r = p._swapAccountData(s, '8', NOW); } catch (e) { threw = true; }
      ok(!threw && r.action === 'switch', 'stash = ' + junk.slice(0, 24) + '… → the switch still happens');
      eq(Object.keys(stashOf(s)), ['7'], '…and the junk is replaced by a clean stash holding A');
    }
    const parsed = p._parseAccountStash(JSON.stringify({
      8: { savedAt: NOW, keys: { psycle_fav_instructors: '["1"]', psycle_bearer_token_enc: 'aes:STOLEN', psycle_theme: 'linen', psycle_bike_prefs: 123, psycle_recent_searches: 'x'.repeat(300000) } },
      'bad id!': { keys: {} },
    }));
    eq(Object.keys(parsed), ['8'], 'owner ids that are not a plain token are dropped');
    eq(Object.keys(parsed['8'].keys), ['psycle_fav_instructors'], 'only allow-listed per-account keys with string values of a sane size survive — a stash can never plant a token, a theme or a huge value');
    ok({}.polluted === undefined && Object.prototype.keys === undefined, 'a "__proto__" owner pollutes nothing');
    // A stash that names a returning member but carries junk for them restores nothing dangerous.
    const s = seed({ psycle_data_owner: '7', psycle_account_stash: JSON.stringify({ 8: { savedAt: NOW, keys: { psycle_bearer_token_enc: 'aes:STOLEN', psycle_fav_instructors: '["5"]' } } }) });
    p._swapAccountData(s, '8', NOW);
    eq([s.getItem('psycle_bearer_token_enc'), s.getItem('psycle_fav_instructors')], [null, '["5"]'], '…restoring writes allow-listed keys only');
  }

  t.section('Data owner: a full localStorage is tolerated — and costs nobody their data');
  {
    const s = seed({ psycle_data_owner: '7' });
    const before = s._dump();
    const realSet = s.setItem.bind(s);
    s.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
    let r = null, threw = false;
    try { r = p._swapAccountData(s, '8', NOW); } catch (e) { threw = true; }
    ok(!threw, 'a throwing setItem never escapes (nothing here may block a sign-in)');
    eq(r.action, 'error', '…the switch is reported as not done');
    eq(s._dump(), before, '…and because the stash could not be written, NOTHING was removed (A\'s data is not thrown away unsaved)');
    eq(s.getItem('psycle_data_owner'), '7', '…the stamp still says A, so the next /profile tries again');
    s.setItem = realSet;
    eq(p._swapAccountData(s, '8', NOW).action, 'switch', 'once there is room the same call goes through');

    // The quota-aware writer from security.js is used when handed in.
    const s2 = seed({ psycle_data_owner: '7' });
    const viaWriter = [];
    const r2 = p._swapAccountData(s2, '8', NOW, (k, v) => { viaWriter.push(k); s2.setItem(k, v); return true; });
    eq([r2.action, viaWriter[0], viaWriter[viaWriter.length - 1]], ['switch', 'psycle_account_stash', 'psycle_account_stash'], 'every write goes through the writer it is given (stash first, stash tidy last)');
    ok(viaWriter.indexOf('psycle_data_owner') !== -1, '…including the stamp');
    const s3 = seed({ psycle_data_owner: '7' });
    eq([p._swapAccountData(s3, '8', NOW, () => false).action, s3.getItem('psycle_class_history') !== null], ['error', true], 'a writer that reports failure (false) stops the switch the same way');

    // Storage that throws on READ (Safari with storage blocked).
    const dead = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } };
    let r4 = null, threw4 = false;
    try { r4 = p._swapAccountData(dead, '8', NOW); } catch (e) { threw4 = true; }
    ok(!threw4 && r4.action === 'error', 'a Storage that throws on every call: reported, never thrown');
  }

  t.section('Data owner: a switch cut short is resumed, not repeated over half-moved keys');
  {
    // Returning member 8 has a stash entry; the app is killed right after the
    // first of 8's keys has been restored (before the stamp).
    const s = seed({ psycle_data_owner: '7', psycle_account_stash: JSON.stringify({ 8: { savedAt: NOW, pending: '', keys: { psycle_fav_instructors: '["88"]', psycle_instructor_tiers: '{"88":"S"}' } } }) });
    const realSet = s.setItem.bind(s);
    let restoredWrites = 0;
    s.setItem = (k, v) => {
      if (k === 'psycle_instructor_tiers' || k === 'psycle_fav_instructors') { if (++restoredWrites === 2) throw new Error('killed'); }
      if (k === 'psycle_data_owner') throw new Error('killed');
      realSet(k, v);
    };
    eq(p._swapAccountData(s, '8', NOW).action, 'error', 'first attempt dies before the stamp');
    eq(s.getItem('psycle_data_owner'), '7', '…so the stamp still says A — while localStorage already holds one of B\'s keys');
    s.setItem = realSet;
    const r = p._swapAccountData(s, '8', LATER);
    eq(r.action, 'switch', 'the next /profile finishes the job');
    const stash = stashOf(s);
    eq(stash['7'].keys.psycle_fav_instructors, A_DATA.psycle_fav_instructors, 'A\'s stash still holds A\'s favourites — NOT the half-restored B value that was sitting in localStorage');
    eq(SMALL.filter((k) => stash['7'].keys[k] !== A_DATA[k]), [], '…every one of A\'s keys is intact');
    eq([s.getItem('psycle_fav_instructors'), s.getItem('psycle_instructor_tiers'), Object.keys(stash)], ['["88"]', '{"88":"S"}', ['7']], 'B has their own back, and B\'s entry is consumed');
  }

  // ── The real _applyProfile ───────────────────────────────────────────────
  t.section('Data owner: _applyProfile moves the data before anything repaints (sliced from js/app.js)');
  const src = t.readSource('js/app.js');
  const from = src.indexOf('// ── pure:session:start');
  const to = src.indexOf('const HISTORY_PROMPT_DISMISSED_KEY');
  ok(from !== -1 && to > from && src.indexOf('function _claimDataOwner(', from) < to, 'the session-lifecycle slice (the session suite\'s anchors) contains _claimDataOwner');
  const applySrc = src.slice(src.indexOf('function _applyProfile(data) {'), src.indexOf('// Single-flight per token'));
  ok(/try \{ if \(typeof _claimDataOwner === 'function'\) _claimDataOwner\(user\.id\); \} catch \(e\) \{\}/.test(applySrc), '_applyProfile calls it typeof-guarded inside try/catch (other suites run this block without localStorage)');
  ok(applySrc.indexOf('_claimDataOwner(user.id)') < applySrc.indexOf('currentUser = user;') && applySrc.indexOf('_claimDataOwner(user.id)') < applySrc.indexOf("PsycleEvents.emit('profile:updated'"),
    '…before currentUser is set and before profile:updated fires');
  const signOutSrc = src.slice(src.indexOf('function clearToken() {'), src.indexOf('function showSessionExpired() {'));
  ok(!/psycle_data_owner|_claimDataOwner|_swapAccountData|DATA_OWNER_KEY/.test(signOutSrc), 'sign-out does not touch the stamp or the data (the same member nearly always comes back)');
  const expiredSrc = src.slice(src.indexOf('function showSessionExpired() {'), src.indexOf('// Token from login is now received'));
  ok(!/psycle_data_owner|_claimDataOwner|_swapAccountData|DATA_OWNER_KEY/.test(expiredSrc), 'nor does session expiry');

  if (from !== -1 && to > from) {
    const world = (store) => {
      const w = { events: [], favReloads: 0, chips: 0, seenAtProfileUpdated: null };
      const ctxInit = {
        console, AbortController,
        window: { _windowEvents: null },
        document: { getElementById: () => null },
        PsycleEvents: {
          on() {},
          emit: (e, arg) => {
            w.events.push(e);
            if (e !== 'profile:updated' || !store) return;
            try { w.seenAtProfileUpdated = { owner: store.getItem('psycle_data_owner'), history: store.getItem('psycle_class_history'), favs: store.getItem('psycle_fav_instructors') }; } catch (err) {}
          },
        },
        setTimeout: () => 0, clearTimeout: () => {},
        getBearerToken: () => 'tok', apiUrl: (x) => x, escapeHTML: String,
        fetch: () => new Promise(() => {}), apiFetch: () => new Promise(() => {}),
        fetchMyBookings: () => Promise.resolve(true), renderMyBookings() {}, _resyncDiscoverButtons() {},
        updateDiscoverEmptyState() {}, showHistorySyncPrompt() {}, renderDiscoverPresets() {}, renderRebookHint() {},
        search() {}, toast() {}, showSessionExpired() {},
        loadFavourites: () => { w.favReloads++; return new Set(JSON.parse((store && store.getItem('psycle_fav_instructors')) || '[]')); },
        renderInstrDropdown() {}, renderInstrChips: () => { w.chips++; },
        favouriteInstructors: new Set(['stale']),
        currentUser: null, _activeSubscription: null, _myBookings: {}, _lastWaitlistEntries: null, _bookingsLoadState: 'pending', locations: [],
      };
      if (store) ctxInit.localStorage = store;
      const ctx = t.vm.createContext(ctxInit);
      t.vm.runInContext(src.slice(from, to), ctx, { filename: 'js/app.js[session lifecycle]' });
      w.ctx = ctx;
      return w;
    };
    const profile = (id) => ({ data: { id, first_name: 'Ada', subscriptions: [] } });

    // No localStorage at all (how the session suite runs this block).
    let w = world(null);
    let applied = false, threw = false;
    try { applied = w.ctx._applyProfile(profile(7)); } catch (e) { threw = true; }
    ok(!threw && applied === true && w.ctx.currentUser.id === 7, 'no localStorage in reach: the profile is applied all the same');

    // Legacy install, then the same member, then someone else.
    const store = seed();
    w = world(store);
    w.ctx._applyProfile(profile(7));
    eq([store.getItem('psycle_data_owner'), store.getItem('psycle_class_history') === A_DATA.psycle_class_history, w.favReloads], ['7', true, 0], 'legacy install: stamped, nothing moved, nothing reloaded');
    w.ctx._applyProfile(profile(7));
    eq([store.getItem('psycle_class_history') === A_DATA.psycle_class_history, w.events.indexOf('data:owner-changed')], [true, -1], 'a /profile refresh for the same member: no-op');
    w.events.length = 0;
    w.ctx._applyProfile(profile(8));
    eq(w.seenAtProfileUpdated, { owner: '8', history: null, favs: null }, 'a different member: by the time profile:updated fires the stamp is theirs and A\'s history / favourites are gone');
    ok(w.events.indexOf('data:owner-changed') !== -1 && w.events.indexOf('data:owner-changed') < w.events.indexOf('profile:updated'), '…data:owner-changed is emitted first, for modules that keep their own copy');
    eq([w.favReloads, w.chips, [...w.ctx.favouriteInstructors]], [1, 1, []], '…the in-memory favourites Set is re-read (it held A\'s stars) and the chips repainted');
    eq(w.ctx.currentUser.id, 8, '…and the profile is applied');

    // A Storage that throws must never stop a sign-in.
    const dead = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } };
    w = world(dead);
    threw = false;
    try { applied = w.ctx._applyProfile(profile(9)); } catch (e) { threw = true; }
    ok(!threw && applied === true && w.ctx.currentUser.id === 9, 'a localStorage that throws on every call: the sign-in still completes');
  }

  // ── Stats while signed out ───────────────────────────────────────────────
  t.section('Stats: signed out, the previous member\'s numbers are behind the Sign-in hero');
  {
    const tabsSrc = t.readSource('js/tabs.js');
    const rFrom = tabsSrc.indexOf('  window.renderInsights = function () {');
    const rTo = tabsSrc.indexOf('  // ── Quick Stats', rFrom);
    ok(rFrom !== -1 && rTo > rFrom, 'renderInsights can be sliced');
    if (rFrom !== -1 && rTo > rFrom) {
      const run = (o) => {
        const panelClasses = new Set();
        const els = {
          statsEmpty: { style: { display: 'none' }, innerHTML: '' },
          shareSection: { style: {} },
          'tab-stats': { classList: { toggle: (c, on) => { if (on) panelClasses.add(c); else panelClasses.delete(c); } } },
        };
        const known = {
          window: {}, document: { getElementById: (id) => els[id] || null },
          currentUser: o.user || null,
          getBearerToken: () => o.token || '',
          authGateHTML: () => (o.token ? '<button onclick="retryAuth(this)">Retry</button>' : ''),
          getFullHistory: () => o.history || [],
          _tokenReadable: o.readable !== false,
        };
        // Anything else the function calls (its section renderers — other
        // agents add to that list) is a no-op here.
        const noop = () => {};
        const scope = new Proxy(known, { has: () => true, get: (target, k) => (k === Symbol.unscopables ? undefined : (k in target ? target[k] : noop)) });
        // (Repo source in a vm, as every suite does — `with` only so that the
        // Proxy above can answer for identifiers this test does not know.)
        t.vm.runInContext('with (scope) {' + tabsSrc.slice(rFrom, rTo) + '\n}', t.vm.createContext({ scope }), { filename: 'js/tabs.js[renderInsights]' });
        known.window.renderInsights();
        return { gated: panelClasses.has('stats-signed-out'), hero: els.statsEmpty.style.display === '' ? els.statsEmpty.innerHTML : null };
      };
      const hist = [{ eventId: '1', date: '2026-01-05 07:00:00' }];
      let r = run({ history: hist });
      ok(r.gated && /openLoginPopup\(\)/.test(r.hero || ''), 'no token + history on the device: the panel is gated and the hero offers Sign in (it used to show the last member\'s totals, streaks and heatmap)');
      r = run({ history: [] });
      ok(r.gated && /openLoginPopup\(\)/.test(r.hero || ''), 'no token, no history: the same hero as before');
      r = run({ history: hist, token: 'tok' });
      ok(!r.gated && r.hero === null, 'token kept but Psycle unreachable (offline launch): the member\'s own stats stay up — not gated');
      r = run({ history: [], token: 'tok' });
      ok(!r.gated && /retryAuth/.test(r.hero || ''), '…with no history that state still gets the Retry hero, never Sign in');
      r = run({ history: hist, token: 'tok', user: { id: 7 } });
      ok(!r.gated && r.hero === null, 'signed in: stats as ever');
      r = run({ history: hist, readable: false });
      ok(!r.gated && r.hero === null, 'first paint BEFORE security.js has decrypted the token (iOS: before the Preferences restore): "no token" proves nothing yet — not gated');
    }
    ok(/\(window\.securityReady \|\| Promise\.resolve\(\)\)\.then\(function \(\) \{\}, function \(\) \{\}\)\.then\(function \(\) \{\s*_tokenReadable = true;\s*if \(_currentTab === 'stats'\) window\.renderInsights\(\);/.test(tabsSrc),
      '…and Stats is painted again the moment the token is readable (either outcome of securityReady)');
    const css = t.readSource('css/tabs.css');
    ok(/#tab-stats\.stats-signed-out > :not\(#statsEmpty\) \{ display: none !important; \}/.test(css), 'css/tabs.css hides every other Stats section while the panel is gated (several modules un-hide sections in there)');
  }
};
