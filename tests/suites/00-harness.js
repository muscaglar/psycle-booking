'use strict';
// Self-test for the suite loader and loadPure() in tests/unit.js — and the
// run's drain guard.
//
// A suite that awaits something which never settles (a clock shim that
// swallows the very timer a promise is waiting on) leaves Node with an empty
// event loop: the process exits 0 with no summary, every later suite unrun,
// and CI reads only the exit code. 'beforeExit' fires exactly then — and never
// after the runner's own process.exit(), so the summary and crash paths are
// untouched. It is installed from HERE because this file sorts first, and `t`
// is the one object every suite is handed: wrapping t.section is enough to say
// where the run stopped.
module.exports = function (t) {
  if (!process.__psycleDrainGuard) {
    process.__psycleDrainGuard = true;
    let where = '(before the first section)';
    const section = t.section;
    t.section = function (name) {
      const frame = (new Error().stack || '').split('\n').find((l) => /[\\/]suites[\\/]/.test(l) && l.indexOf('00-harness.js') === -1);
      const file = frame && /[\\/]suites[\\/]([^\\/:]+\.js)/.exec(frame);
      where = (file ? file[1] + ' — ' : '') + name;
      return section.apply(this, arguments);
    };
    process.on('beforeExit', () => {
      console.error('\n❌ Test run stopped before the summary: "' + where + '" awaited something that never settles. Every later suite is UNRUN.');
      process.exit(1);
    });
  }

  t.section('Suite harness');
  t.ok(typeof t.loadPure === 'function' && typeof t.readSource === 'function', 'suites receive loadPure + readSource');
  let threw = false;
  try { t.loadPure('js/app.js', 'no-such-block'); } catch (e) { threw = true; }
  t.ok(threw, 'loadPure throws when a module has no such pure block');

  // The guard, for real: a child process loads this file the way the runner
  // does, then awaits a promise nobody settles. (The child skips this block.)
  if (process.env.PSYCLE_DRAIN_PROBE) return;
  const { spawnSync } = require('child_process');
  const probe = (body) => spawnSync(process.execPath, ['-e',
    "const t = { ok() {}, section() {}, loadPure() { throw new Error('none'); }, readSource() {} };\n" +
    'require(' + JSON.stringify(__filename) + ')(t);\n' +
    "t.section('a suite that hangs');\n" +
    '(async () => { ' + body + " console.log('SUMMARY'); process.exit(0); })();"],
    { env: Object.assign({}, process.env, { PSYCLE_DRAIN_PROBE: '1' }), encoding: 'utf8' });
  const hung = probe('await new Promise(() => {});');
  t.ok(hung.status === 1 && /a suite that hangs/.test(hung.stderr) && !/SUMMARY/.test(hung.stdout),
    'a suite awaiting something that never settles FAILS the run and is named (it exited 0, silently, with every later suite unrun)');
  const fine = probe('await new Promise((r) => setImmediate(r));');
  t.ok(fine.status === 0 && /SUMMARY/.test(fine.stdout) && fine.stderr === '', 'a run that reaches its own process.exit() never sees the guard');
};
