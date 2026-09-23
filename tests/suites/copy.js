'use strict';
// Member-facing wording + the two share images (wave 6, R2-22/29/33/35/15):
//  · _plural (pure:copy in js/app.js) and the call sites that used to glue a
//    count to a fixed plural ("1 classes booked", "1 instructors");
//  · one vocabulary: no ride-only words over Reformer/Strength classes, "spot"
//    for the thing a member holds, one credit line on both share images;
//  · the late-cancel message carries ONE class wherever it appears;
//  · the SHIPPED shareInsights / shareYearReview (sliced out of the tabs.js
//    IIFE) drawn onto a recording canvas: theme colours, the Psync wordmark,
//    3x export, and a stats card cropped to what was drawn.
module.exports = async function (t) {
  const { ok, eq } = t;
  const app = t.readSource('js/app.js');
  const tabs = t.readSource('js/tabs.js');
  const explore = t.readSource('js/explore.js');

  // ── _plural ────────────────────────────────────────────────────────────
  t.section('Copy: _plural');
  const p = t.loadPure('js/app.js', 'copy');
  ok(typeof p._plural === 'function', 'pure:copy exposes _plural');
  [
    [0, 'class', 'classes', '0 classes'],
    [1, 'class', 'classes', '1 class'],
    [2, 'class', 'classes', '2 classes'],
    [0, 'instructor', undefined, '0 instructors'],
    [1, 'instructor', undefined, '1 instructor'],
    [2, 'instructor', undefined, '2 instructors'],
    [1, 'booking', undefined, '1 booking'],
    [412, 'booking', undefined, '412 bookings'],
    [1, 'spot', undefined, '1 spot'],
    [3, 'spot', undefined, '3 spots'],
    ['1', 'class', 'classes', '1 class'],   // counts read back from storage / the API arrive as strings
    ['2', 'class', 'classes', '2 classes'],
  ].forEach(([n, one, many, want]) => eq(p._plural(n, one, many), want, JSON.stringify(n) + ' ' + one + ' → "' + want + '"'));

  t.section('Copy: counts are no longer glued to a fixed plural');
  // The sites that can really show 1. "N/M classes", "all N classes" and
  // "4+ spots left" are left alone on purpose: they never read 1.
  ok((tabs.match(/_plural\(/g) || []).length >= 8 && /_plural\(historyCount, 'booking'\)/.test(explore) && /_plural\(made, 'class', 'classes'\) \+ ' booked'/.test(app),
    'the call sites go through _plural instead');

  // ── Vocabulary ─────────────────────────────────────────────────────────
  t.section('Copy: one vocabulary');
  ok(!/You usually ride|Ride the same classes|no longer ride|on the bike|CLASSES RIDDEN|London riders/.test(tabs) && /Remove any you no longer take\.'/.test(tabs),
    'tabs.js: no ride-only wording over every class type (the usual-week save toast included: a Reformer-only member rides nothing)');
  // Wave 8 (declutter): the card leads with the slot itself — its heading already
  // says "Your usual slots" — and the button says what it does, so the subtitle
  // that used to explain it is gone (tests/suites/8e-declutter.js renders it).
  ok(/<div class="habit-line"><strong>' \+ escapeHTML\(dayName\)/.test(tabs) && !/You usually (ride|book) </.test(tabs) && /Your year at Psycle/.test(tabs),
    'habit card names the slot with no ride-only verb in front of it; the year wrap says "Your year at Psycle"');
  ok(!/habit-subtitle/.test(tabs) && />Find this week<\/button>/.test(tabs), 'no habit subtitle: the button itself says what it does ("Find this week")');
  ok(!/booking's seats/.test(app) && (app.match(/this booking's spots from Psycle\. Nothing was (cancelled|changed)/g) || []).length === 2,
    'app.js: "this booking\'s spots" (not seats) — and still says nothing was cancelled / changed');
  ok(/title: 'Claim this spot\?'/.test(app) && /_plural\(free, 'spot'\)\} free right now/.test(app) && /'A spot is free right now/.test(app),
    'the claim dialog uses one noun: spot');
  ok(!/so Explore can/.test(explore) && /Makes your Stats and suggestions accurate\./.test(explore), 'sync banner no longer names an "Explore" tab that does not exist (it names Stats)');
  // (comments may still name them — that is where the reason is written down)
  const tabsCode = tabs.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok(!/Psycle Companion|Psycle Class Finder|CLASS FINDER|P S Y C L E/.test(tabsCode), 'tabs.js: the retired product names are gone from the share images');
  ok(/Bike \/ spot preferences/.test(tabs), 'Membership row matches the panel it opens (Bike / Spot Preferences)');

  // ── Late-cancel message: one class ─────────────────────────────────────
  t.section('Copy: the late-cancel message wears one class everywhere');
  ok(/' is-late late-cancel-note'/.test(app), 'bike picker policy line');
  ok(/const cancelLineCls = \(deadline && deadline\.insideWindow\) \? 'late-cancel-note' : 'bc-dim';/.test(app) && /<div class="bc-detail \$\{cancelLineCls\}">/.test(app),
    'Booked! sheet line (dimmed only while it is the free-cancel note)');
  ok(/warnClass: 'late-cancel-note'/.test(app) && /class="confirm-warn\$\{opts\.warnClass \? ' ' \+ escapeHTML\(opts\.warnClass\) : ''\}"/.test(app),
    'cancel dialog: confirmModal({ warnClass }) puts it on the warn line, escaped');
  eq((app.match(/warnClass: '/g) || []).length, 1, 'only the late-cancel dialog passes warnClass — other warn: dialogs keep the plain treatment');

  // ── Share images: palette ──────────────────────────────────────────────
  t.section('Share images: palette (pure:share)');
  const sp = t.loadPure('js/tabs.js', 'share');
  // Cloud as wave 9 re-valued it (the Crisp Colour chrome; css/theme.css [data-theme="cloud"]).
  const CLOUD = { '--bg': '#e6e9ee', '--bg-panel': '#fcfdfe', '--border': '#d3d9e1', '--text-heading': '#1b2130', '--text-muted': '#3a4252', '--accent': '#1b2130' };
  const GAMEBOY = { '--bg': '#0f380f', '--bg-panel': '#133f13', '--border': '#306230', '--text-heading': '#e0f8cf', '--text-muted': '#9bbc0f', '--accent': '#9bbc0f' };
  const reader = (map) => (name) => map[name];
  eq(sp._sharePaletteFrom(reader(GAMEBOY)), { bg: '#0f380f', panel: '#133f13', border: '#306230', heading: '#e0f8cf', muted: '#9bbc0f', accent: '#9bbc0f' },
    'reads the six tokens of the theme on screen');
  eq(sp._sharePaletteFrom((name) => '  ' + GAMEBOY[name] + ' ').bg, '#0f380f', 'computed custom properties keep their leading space — trimmed');
  eq(sp._sharePaletteFrom(reader(Object.assign({}, GAMEBOY, { '--border': 'color-mix(in srgb, red, blue)' }))), sp.SHARE_FALLBACK,
    'ONE token canvas cannot paint → the whole Cloud set (never dark ink from one theme on dark paper from another)');
  eq(sp._sharePaletteFrom(() => ''), sp.SHARE_FALLBACK, 'nothing readable → Cloud');
  eq(sp._sharePaletteFrom(reader(Object.assign({}, GAMEBOY, { '--border': 'rgba(0, 0, 0, 0.2)' }))).border, 'rgba(0, 0, 0, 0.2)', 'rgb()/hsl() values are canvas-safe too');
  eq(sp._sharePaletteFrom(reader(CLOUD)), sp.SHARE_FALLBACK, 'the fallback IS Cloud, the default theme');
  ok(/Psync/.test(sp.SHARE_FOOTER) && !/Companion|Class Finder/.test(sp.SHARE_FOOTER), 'one credit line, and it names Psync');
  ok(Number.isInteger(sp.SHARE_SCALE) && sp.SHARE_SCALE >= 2, 'export scale is a whole number ≥ 2 (a fractional devicePixelRatio gives a non-integer canvas)');
  ok(640 * sp.SHARE_SCALE * 820 * sp.SHARE_SCALE < 16777216, "the scratch canvas stays under iOS's 16.7M-pixel canvas cap");
  {
    // Every theme block that ships must keep these six tokens canvas-paintable,
    // or that theme's share image silently falls back to Cloud.
    const css = t.readSource('css/theme.css');
    const safe = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^(?:rgb|hsl)a?\(/i;
    const bad = [];
    let blocks = 0;
    css.replace(/(^|\n)(:root|\[data-theme="([a-z]+)"\]) \{([^}]*)\}/g, (m, _a, _sel, id, body) => {
      blocks++;
      Object.keys(CLOUD).forEach((tok) => {
        const hit = new RegExp('(?:^|[;\\s])' + tok + ':\\s*([^;]+);').exec(body);
        if (hit && !safe.test(hit[1].trim())) bad.push((id || ':root') + ' ' + tok + ': ' + hit[1].trim());
      });
      return m;
    });
    ok(blocks >= 2, 'found the theme token blocks in css/theme.css (' + blocks + ')');
    eq(bad, [], 'every theme defines the share-image tokens as plain colours');
  }

  // ── Share images: the shipped drawing code on a recording canvas ───────
  const from = tabs.indexOf('  // ── Share images (year wrap + stats card): shared helpers');
  const to = tabs.indexOf('  // ── Init ─');
  ok(from !== -1 && to > from, 'share-image code found in tabs.js');
  if (from === -1 || to <= from) return;
  const shareSrc = tabs.slice(from, to);
  ok(!/(fill|stroke)Style = '#/.test(shareSrc), 'no hard-coded colour is left in either share function');

  const boot = (opts) => {
    opts = opts || {};
    const log = { canvases: [], exported: null, toasts: [], clicked: 0, timers: [], shared: null };
    const makeCtx = (canvas) => {
      const calls = [];
      const state = { font: '', textAlign: 'left' };
      const rec = (name) => function () { calls.push([name].concat([].slice.call(arguments))); };
      const c2d = {
        calls,
        scale: rec('scale'), fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), beginPath: rec('beginPath'),
        moveTo: rec('moveTo'), lineTo: rec('lineTo'), stroke: rec('stroke'), fill: rec('fill'), roundRect: rec('roundRect'),
        drawImage: rec('drawImage'),
        fillText(text, x, y, maxW) { calls.push(['fillText', text, x, y, maxW, state.font]); },
        measureText(s) { return { width: String(s).length * 9 }; },
      };
      ['fillStyle', 'strokeStyle', 'lineWidth'].forEach((k) => Object.defineProperty(c2d, k, { set(v) { calls.push([k, v]); }, get() { return undefined; } }));
      ['font', 'textAlign'].forEach((k) => Object.defineProperty(c2d, k, { set(v) { state[k] = v; }, get() { return state[k]; } }));
      return c2d;
    };
    const ctx = {
      console, Promise,
      setTimeout: (fn, ms) => { log.timers.push(ms); setImmediate(fn); },
      toast: (m, k) => log.toasts.push([m, k]),
      _plural: p._plural,
      getFullHistory: () => opts.history || [],
      // The stats card counts classes TAKEN: tabs.js's own filter (pure:year-review), on the device clock here.
      _takenRows: t.loadPure('js/tabs.js', 'year-review')._takenRows,
      _historyStartMs: () => (d) => new Date(String(d).replace(' ', 'T')).getTime(),
      _computeYearReview: () => opts.year || null,
      CATEGORY_MAP: opts.cats || [],
      getCategory: (typeName) => (opts.cats || []).find((c) => c.key === typeName) || null,
      currentUser: opts.user || null,
      getComputedStyle: () => ({ getPropertyValue: (name) => (opts.tokens || CLOUD)[name] }),
      navigator: opts.navigator || { userAgent: 'node' },
      File: function (parts, name) { this.name = name; },
      URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
      document: {
        documentElement: {},
        fonts: { load: opts.fontLoad || (() => Promise.resolve([])) },
        body: { appendChild() {}, removeChild() {} },
        createElement(tag) {
          if (tag !== 'canvas') return { click() { log.clicked++; } };
          const canvas = { width: 0, height: 0, getContext() { return this._c || (this._c = makeCtx(this)); }, toBlob(cb) { log.exported = this; cb({ size: 1 }); } };
          log.canvases.push(canvas);
          return canvas;
        },
      },
    };
    ctx.window = ctx;
    t.vm.createContext(ctx);
    t.vm.runInContext(shareSrc, ctx, { filename: 'tabs.js[share]' });
    return { ctx, log };
  };
  const texts = (canvas) => canvas.getContext().calls.filter((c) => c[0] === 'fillText');
  const colours = (canvas) => canvas.getContext().calls.filter((c) => c[0] === 'fillStyle' || c[0] === 'strokeStyle').map((c) => c[1]);

  const CATS = ['RIDE', 'REFORMER', 'STRENGTH', 'BARRE', 'YOGA', 'HIIT', 'OTHER'].map((k, i) => ({ key: k, label: k, color: '#c0ffe' + i }));
  const LONG_NAME = 'Bartholomew Featherstonehaugh-Cholmondeley';
  const historyOf = (n, kinds) => Array.from({ length: n }, (_, i) => ({
    date: '2026-0' + (1 + (i % 9)) + '-10 07:00:00', instrName: i === 0 ? LONG_NAME : 'Instr ' + (i % 3), locName: 'Bank', typeName: CATS[i % kinds].key, slots: [5],
  }));

  t.section('Share images: stats card');
  {
    const r = boot({ history: historyOf(24, 7), cats: CATS, user: { email: 'a.very.long.address@example.co.uk' } });
    await r.ctx.shareInsights();
    eq(r.log.canvases.length, 2, 'a scratch surface and the cropped output');
    const scratch = r.log.canvases[0], out = r.log.exported;
    ok(out === r.log.canvases[1] && out !== scratch, 'the CROPPED canvas is what gets exported');
    eq([scratch.width, scratch.height], [640 * sp.SHARE_SCALE, 820 * sp.SHARE_SCALE], 'drawn at the export scale…');
    eq(scratch.getContext().calls.find((c) => c[0] === 'scale'), ['scale', sp.SHARE_SCALE, sp.SHARE_SCALE], '…with the layout still in 640-wide units');
    const footer = texts(scratch).find((c) => c[1] === sp.SHARE_FOOTER);
    ok(!!footer, 'the shared credit line is drawn');
    eq([out.width, out.height], [640 * sp.SHARE_SCALE, Math.ceil(footer[3] + 28) * sp.SHARE_SCALE], 'output is cut off just under the footer');
    ok(out.height < scratch.height * 0.7, 'no dead area: ' + out.height / sp.SHARE_SCALE + 'px tall instead of 820');
    eq(out.getContext().calls[0].slice(0, 1).concat([out.getContext().calls[0][1] === scratch]), ['drawImage', true], 'the scratch surface is copied 1:1 before the frame is stroked');
    ok(out.getContext().calls.some((c) => c[0] === 'strokeRect' && c[4] === Math.ceil(footer[3] + 28) - 2), 'the frame follows the cropped height');
    ok(!scratch.getContext().calls.some((c) => c[0] === 'strokeRect'), 'and is no longer drawn around the 820px scratch area');

    const word = texts(scratch).find((c) => c[1] === 'Psync');
    ok(!!word && /^900 \d+px 'Sofia Sans Condensed'/.test(word[5]), 'wordmark "Psync" in the display face (Sofia Sans Condensed 900, as the app header)');
    ok(!/Bricolage|Hanken|AppDisplay|apple-system/.test(shareSrc), 'no retired or system face is left in the share code: numerals in the display face, labels in the body face');
    ok(texts(scratch).filter((c) => /^\d+$/.test(c[1])).every((c) => /Sofia Sans Condensed/.test(c[5])), 'every numeral is set in the display face');
    ok(!texts(scratch).some((c) => /P S Y C L E|CLASS FINDER|Generated by/.test(c[1])), 'the retired wordmark and credits are not drawn');
    const allowed = Object.keys(CLOUD).map((k) => CLOUD[k]).concat(CATS.map((c) => c.color));
    eq(colours(scratch).concat(colours(out)).filter((v) => allowed.indexOf(v) === -1), [], 'every fill/stroke is a theme token or a class-type colour');
    eq(colours(scratch)[0], CLOUD['--bg'], 'background is the theme paper');

    const name = texts(scratch).find((c) => c[1] === LONG_NAME) || texts(scratch).find((c) => /^Instr /.test(c[1]));
    eq(name[4], 272, 'instructor name is capped to its column (it used to run into "Top studio")');
    eq(texts(scratch).find((c) => c[1] === 'Bank')[4], 272, 'studio name too');
    eq(texts(scratch).find((c) => /'s Stats$/.test(c[1]))[4], 576, 'title is capped to the card (the name falls back to an email address)');
    eq(footer[4], 576, 'footer too');
    eq(texts(scratch).filter((c) => CATS.some((k) => k.label === c[1])).length, 6, 'at most six class-type bars');
    eq([r.log.clicked, r.log.toasts[0] && r.log.toasts[0][1]], [1, 'success'], 'no native share here → the PNG is downloaded');
  }
  {
    const six = boot({ history: historyOf(24, 7), cats: CATS });
    const one = boot({ history: historyOf(1, 1), cats: CATS, tokens: GAMEBOY });
    await six.ctx.shareInsights();
    await one.ctx.shareInsights();
    ok(one.log.exported.height < six.log.exported.height, 'a one-class-type member gets a shorter card, not more empty space');
    eq(colours(one.log.canvases[0])[0], GAMEBOY['--bg'], 'it wears the theme on screen (Handheld here)');
    const drawn = texts(one.log.canvases[0]).map((c) => c[1]);
    ok(drawn.indexOf('1 class') !== -1 && !drawn.some((s) => /^1 classes/.test(s)), 'a first booking reads "1 class"');
  }
  {
    const r = boot({ history: historyOf(3, 2), cats: CATS, tokens: Object.assign({}, GAMEBOY, { '--text-muted': '' }) });
    await r.ctx.shareInsights();
    eq(colours(r.log.canvases[0])[0], CLOUD['--bg'], 'an unreadable token → the image is drawn in Cloud, whole');
  }
  {
    const r = boot({ history: [] });
    await r.ctx.shareInsights();
    eq([r.log.canvases.length, r.log.toasts[0] && r.log.toasts[0][0]], [0, 'No history to share yet'], 'nothing to share → says so, draws nothing');
  }
  {
    // History holds a booking from the moment it is made: next year's is not a class taken.
    const later = { date: '2099-01-05 07:00:00', instrName: 'Not Yet', locName: 'Bank', typeName: 'RIDE', slots: [5] };
    const r = boot({ history: [later].concat(historyOf(3, 2)), cats: CATS });
    await r.ctx.shareInsights();
    const drawn = texts(r.log.canvases[0]);
    const classes = drawn[drawn.findIndex((c) => c[1] === 'CLASSES') - 1];
    eq([classes && classes[1], drawn.some((c) => c[1] === 'Not Yet')], ['3', false], 'a booking still to come is not on the image: CLASSES 3 (it read 4), and its instructor cannot be "top"');
    const none = boot({ history: [later], cats: CATS });
    await none.ctx.shareInsights();
    eq([none.log.canvases.length, none.log.toasts[0] && none.log.toasts[0][0]], [0, 'No history to share yet'], 'only bookings still to come → nothing to share yet');
  }
  {
    // The display face must never hold the share up: navigator.share() needs
    // the tap's activation, and a font that never loads would let it lapse.
    const r = boot({ history: historyOf(3, 2), cats: CATS, fontLoad: () => new Promise(() => {}) });
    await r.ctx.shareInsights();
    ok(!!r.log.exported && r.log.timers.length === 1 && r.log.timers[0] <= 300, 'a font that never loads is given up on after ' + r.log.timers[0] + 'ms');
  }
  {
    const shared = [];
    const r = boot({
      history: historyOf(1, 1), cats: CATS,
      navigator: { userAgent: 'iPhone', canShare: () => true, share: async (d) => { shared.push(d); } },
    });
    await r.ctx.shareInsights();
    eq(shared.length && shared[0].text, '1 class · 1 instructor · Top: ' + LONG_NAME, 'share-sheet text pluralises too');
    eq(r.log.clicked, 0, 'shared natively → no download');
  }

  t.section('Share images: year wrap');
  {
    const year = { total: 1, uniqueInstrs: 1, longestStreak: 1, topInstr: LONG_NAME, topStudio: 'Bank', favDay: 'Monday', favTime: '07:00' };
    const shared = [];
    const r = boot({ year, tokens: GAMEBOY, navigator: { userAgent: 'iPhone', canShare: () => true, share: async (d) => { shared.push(d); } } });
    await r.ctx.shareYearReview();
    const canvas = r.log.exported;
    eq([r.log.canvases.length, canvas.width, canvas.height], [1, 640 * sp.SHARE_SCALE, 820 * sp.SHARE_SCALE], 'one canvas, exported at the same scale');
    const drawn = texts(canvas).map((c) => c[1]);
    ok(drawn.indexOf('Psync') !== -1 && drawn.indexOf('YEAR IN REVIEW') !== -1 && drawn.indexOf(sp.SHARE_FOOTER) !== -1, 'same wordmark, same credit line');
    ok(drawn.indexOf('CLASS TAKEN') !== -1 && drawn.indexOf('Your year at Psycle') !== -1 && !drawn.some((s) => /RIDDEN|on the bike/i.test(s)), 'no ride-only wording; "1 CLASS TAKEN"');
    eq(texts(canvas).find((c) => c[1] === LONG_NAME)[4], 576, 'row values are capped to the card width');
    const allowed = Object.keys(GAMEBOY).map((k) => GAMEBOY[k]);
    eq(colours(canvas).filter((v) => allowed.indexOf(v) === -1), [], 'every fill/stroke is a theme token');
    eq(shared.length && shared[0].text, '1 class · 1 instructor', 'share-sheet text pluralises');

    const many = boot({ year: Object.assign({}, year, { total: 20 }) });
    await many.ctx.shareYearReview();
    ok(texts(many.log.exported).some((c) => c[1] === 'CLASSES TAKEN'), '20 → "CLASSES TAKEN"');

    // Layout: the 88px hero number used to be drawn 58px under the subtitle's
    // baseline — its digits (~0.72em tall) struck through "Your year at Psycle".
    const px = (c) => Number((/(\d+)px/.exec(c[5]) || [])[1]);
    const sub = texts(many.log.exported).find((c) => c[1] === 'Your year at Psycle');
    const hero = texts(many.log.exported).find((c) => c[1] === '20');
    const label = texts(many.log.exported).find((c) => c[1] === 'CLASSES TAKEN');
    ok(px(hero) === 88 && hero[3] - Math.ceil(px(hero) * 0.75) >= sub[3] + 8, 'the hero number\'s digits start clear of the subtitle (baseline ' + hero[3] + ', subtitle ' + sub[3] + ')');
    ok(label[3] - px(label) > hero[3], '…and its "CLASSES TAKEN" label still sits under it');
    const lastRow = texts(many.log.exported).filter((c) => /22px/.test(c[5])).pop();
    const footer = texts(many.log.exported).find((c) => c[1] === sp.SHARE_FOOTER);
    ok(lastRow[3] + 24 < footer[3] - 16, 'with all six detail rows the last one still ends above the footer rule');
  }
};
