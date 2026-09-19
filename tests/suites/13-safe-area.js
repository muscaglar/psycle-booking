// css/crisp.css is linked LAST and wins every tie, so a `padding` shorthand there silently drops a
// safe-area inset an older sheet had set on the same selector (it did: the Settings header sat under
// the iOS status bar). For every selector + property that carries env(safe-area-inset-*) in an older
// sheet: if crisp.css sets that property (or its shorthand) on the same selector, crisp.css must
// carry the inset for it too — on that selector, or on a part it names in ALLOWED_MOVES.
module.exports = function (t) {
  const { ok, eq } = t;
  t.section('Safe areas: the last stylesheet never drops an inset an older sheet set');
  const read = (f) => t.fs.readFileSync(t.path.join(t.REPO_ROOT, 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = (css) => { const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m; while ((m = re.exec(css))) out.push({ sels: m[1].split(',').map((x) => x.trim()), body: m[2] }); return out; };
  const decls = (body) => body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => ({ prop: d.slice(0, d.indexOf(':')).trim(), value: d.slice(d.indexOf(':') + 1) }));
  const OLD = ['styles.css', 'theme.css', 'features.css', 'tabs.css', 'settings.css', 'explore.css', 'redesign.css', 'discover-layout-fix.css'];
  const need = {}; // selector -> Set(property)
  OLD.forEach((f) => rules(read(f)).forEach((r) => decls(r.body).forEach((d) => { if (/safe-area-inset/.test(d.value)) r.sels.forEach((s) => { (need[s] = need[s] || new Set()).add(d.prop); }); })));
  ok(Object.keys(need).length >= 10 && need['.settings-header'] && need['.settings-header'].has('padding-top'), 'the older sheets set insets on ' + Object.keys(need).length + ' selectors (the Settings header among them)');
  // The inset was deliberately moved to another part: the seat picker's sheet hands its bottom inset to the sticky action bar.
  const ALLOWED_MOVES = { '#bikeModal .modal': '#bikeModal .modal-actions' };
  const crisp = rules(read('crisp.css'));
  const covers = (prop, want) => prop === want || (want.indexOf('padding') === 0 && (prop === 'padding' || prop === 'padding-block')) || (want.indexOf('margin') === 0 && (prop === 'margin' || prop === 'margin-block'));
  const dropped = [];
  Object.keys(need).forEach((sel) => need[sel].forEach((want) => {
    const mine = crisp.filter((r) => r.sels.indexOf(sel) !== -1).map((r) => decls(r.body).filter((d) => covers(d.prop, want))).reduce((a, b) => a.concat(b), []);
    if (!mine.length) return; // crisp.css leaves it alone
    const moved = ALLOWED_MOVES[sel];
    const kept = mine.some((d) => /safe-area-inset/.test(d.value)) || (moved && crisp.some((r) => r.sels.indexOf(moved) !== -1 && /safe-area-inset/.test(r.body)));
    if (!kept) dropped.push(sel + ' { ' + want + ' }');
  }));
  eq(dropped, [], 'no inset dropped by a later rule in css/crisp.css');
  const phone = /@media \(max-width: 640px\) \{\s*\.settings-panel \{ border-radius: 0; \}\s*\.settings-header \{ padding-top: calc\(var\(--space-5\) \+ env\(safe-area-inset-top\)\); border-radius: 0; \}\s*\}/;
  ok(phone.test(read('crisp.css')), 'the Settings sheet on a phone: header padded past the status bar, square corners (it is full screen)');
};
