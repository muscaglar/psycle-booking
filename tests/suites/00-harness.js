'use strict';
// Self-test for the suite loader and loadPure() in tests/unit.js.
module.exports = function (t) {
  t.section('Suite harness');
  t.ok(typeof t.loadPure === 'function' && typeof t.readSource === 'function', 'suites receive loadPure + readSource');
  let threw = false;
  try { t.loadPure('js/app.js', 'no-such-block'); } catch (e) { threw = true; }
  t.ok(threw, 'loadPure throws when a module has no such pure block');
};
