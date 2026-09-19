// The mark (the app icon's two engraved halves) is drawn in five places that cannot share
// code: the icon SVGs in assets/, the header (static HTML), the welcome (js/app.js, which can
// open before anything else has run) and the sign-in page (self-contained). One geometry.
module.exports = function (t) {
  const { ok, eq } = t;
  t.section('Brand mark: one geometry everywhere it is drawn');
  const read = (f) => t.fs.readFileSync(t.path.join(t.REPO_ROOT, f), 'utf8');
  const paths = (src) => (src.match(/\bd="M[^"]+"/g) || []).map((d) => d.slice(3, -1));
  const logo = paths(read('assets/psync-logo.svg'));
  eq(logo.length, 4, 'assets/psync-logo.svg: two halves and two grooves');
  const want = logo.slice().sort();
  const four = (src, from, to) => { const i = src.indexOf(from); return paths(src.slice(i, src.indexOf(to, i))).slice().sort(); };
  eq(paths(read('assets/psync-logo-dark.svg')).sort(), want, 'the dark appearance is the same drawing');
  eq(paths(read('assets/psync-logo-tinted.svg')).sort(), want, 'the tinted appearance is the same drawing');
  eq(paths(read('assets/psync-mark.svg')).sort(), want, 'the mark alone is the same drawing');
  eq(four(read('psycle-finder.html'), '<div class="brand-mark"', '</div>'), want, 'the header draws it');
  eq(four(read('login.html'), '<div class="brand">', '</div>'), want, 'the sign-in page draws it');
  const app = read('js/app.js');
  eq(four(app, 'const _BRAND_MARK_SVG', '\n\n'), want, 'the welcome draws it');
  // Three inline copies can be in one document at a time (the welcome opens over the page): their mask ids differ.
  const ids = [read('psycle-finder.html'), app, read('login.html')].map((s) => (/<mask id="([A-Za-z]+Grooves)"/.exec(s) || [])[1]);
  ok(ids.every(Boolean) && new Set(ids).size === 3, 'each inline copy cuts its grooves with a mask id of its own (' + ids.join(', ') + ')');
  // The icon files the platforms read exist, and the asset catalogue names them.
  const set = 'ios-app/ios/App/App/Assets.xcassets/';
  const icon = JSON.parse(read(set + 'AppIcon.appiconset/Contents.json'));
  eq(icon.images.map((i) => (i.appearances ? i.appearances[0].value : 'any')).sort(), ['any', 'dark', 'tinted'], 'app icon: the default plus the dark and tinted appearances');
  ok(icon.images.every((i) => t.fs.existsSync(t.path.join(t.REPO_ROOT, set + 'AppIcon.appiconset/' + i.filename))), '…and every file it names is there');
  const splash = JSON.parse(read(set + 'Splash.imageset/Contents.json'));
  eq(splash.images.length, 6, 'launch image: three scales, light and dark');
  ok(splash.images.every((i) => t.fs.existsSync(t.path.join(t.REPO_ROOT, set + 'Splash.imageset/' + i.filename))), '…and every file it names is there');
  ok(['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'].every((f) => t.fs.existsSync(t.path.join(t.REPO_ROOT, f))), 'the web icons the manifest and the pages link to exist');
};
