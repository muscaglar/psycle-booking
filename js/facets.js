/**
 * facets.js — client-side faceted filtering for the Discover timetable.
 *
 * Framework-free, no dependencies. Exposes window.PsycleFacets.
 *
 * Adapted from the Psync handoff prototype, extended for MULTI-SELECT:
 * each dimension's selection is an ARRAY of chosen values (the app keeps
 * multi-select instructors and studios), not a single string. A class
 * matches a dimension when its value is in that dimension's selected set
 * (empty set = no constraint).
 *
 * Concept:
 *   Fetch the timetable window ONCE, then hand the normalized event array
 *   to PsycleFacets.run() with the current selections. It returns:
 *     - results : events matching ALL active filters
 *     - facets  : for each dimension, every option with a match COUNT
 *                 computed as if that dimension were not yet filtered — so
 *                 options narrow as you select (cascading counts).
 *     - groups  : results bucketed by calendar day, time-sorted
 *
 * Accessors default to the underscore-normalized display fields the app
 * attaches to events (_instrName / _typeName / _locName); override via
 * opts.accessors for a different shape.
 */
(function (root) {
  'use strict';

  var DEFAULT_ACCESSORS = {
    instructor: function (c) { return c._instrName || c.instructor_name || ''; },
    category:   function (c) { return c._category || c._typeName || c.class_type || ''; },
    location:   function (c) { return c._locName || c.location_name || ''; },
    start:      function (c) { return c.start_at || c.start || ''; },
    text:       function (c) { return [c._typeName, c._instrName, c._locName].join(' '); }
  };

  var DIMENSIONS = ['instructor', 'category', 'location'];

  // Coerce a selection (array | string | null/undefined) to an array.
  function asArray(v) {
    if (v == null || v === '') return [];
    return Array.isArray(v) ? v.filter(function (x) { return x != null && x !== ''; }) : [v];
  }

  /**
   * @param {Array}  classes  normalized timetable events (the fetched window)
   * @param {Object} filters  { instructor:[], category:[], location:[], query, range }
   *                          dimension values are arrays of selected strings
   * @param {Object} opts     { accessors?, universes?, dateFilter? }
   */
  function run(classes, filters, opts) {
    classes = classes || [];
    filters = filters || {};
    opts = opts || {};
    var acc = assign({}, DEFAULT_ACCESSORS, opts.accessors || {});
    var q = (filters.query || '').trim().toLowerCase();

    // Normalize selections to arrays up front.
    var sel = {};
    DIMENSIONS.forEach(function (d) { sel[d] = asArray(filters[d]); });

    // Prefilter: date window (optional) + free-text search.
    var base = classes.filter(function (c) {
      if (opts.dateFilter && !opts.dateFilter(c)) return false;
      if (q && acc.text(c).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    // A class matches every active dimension filter EXCEPT the one named `skip`.
    function matchExcept(c, skip) {
      for (var i = 0; i < DIMENSIONS.length; i++) {
        var d = DIMENSIONS[i];
        if (d === skip) continue;
        if (sel[d].length && sel[d].indexOf(acc[d](c)) === -1) return false;
      }
      return true;
    }

    var results = base.filter(function (c) { return matchExcept(c, null); });

    // Facet options + counts. Counts EXCLUDE the option's own dimension, which
    // produces the cascading-narrowing behaviour even with multi-select.
    var facets = {};
    DIMENSIONS.forEach(function (d) {
      var universe = (opts.universes && opts.universes[d]) ||
        uniq(base.map(acc[d]).filter(Boolean)).sort();
      var pool = base.filter(function (c) { return matchExcept(c, d); });
      facets[d] = universe.map(function (v) {
        var count = 0;
        for (var i = 0; i < pool.length; i++) { if (acc[d](pool[i]) === v) count++; }
        return {
          value: v,
          count: count,
          available: count > 0,
          selected: sel[d].indexOf(v) !== -1
        };
      });
    });

    return {
      results: results,
      facets: facets,
      groups: groupByDay(results, acc.start),
      total: results.length
    };
  }

  // Bucket events by local YYYY-MM-DD, day-ascending, each day time-sorted.
  function groupByDay(list, getStart) {
    var byDay = {};
    list.forEach(function (c) {
      var key = String(getStart(c)).slice(0, 10);
      (byDay[key] = byDay[key] || []).push(c);
    });
    return Object.keys(byDay).sort().map(function (key) {
      return {
        date: key,
        items: byDay[key].sort(function (a, b) {
          return String(getStart(a)).localeCompare(String(getStart(b)));
        })
      };
    });
  }

  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
  function assign(t) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i]; if (!s) continue;
      for (var k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; }
    }
    return t;
  }

  root.PsycleFacets = { run: run };
})(typeof window !== 'undefined' ? window : globalThis);
