#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * ios-app/patch-plugins.js — deterministic native-plugin patcher.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Capacitor calendar plugin (@ebarooni/capacitor-calendar v6, and even
 * upstream v8) has no way to set an EventKit event's time zone at creation
 * time, so every event was silently stamped with the DEVICE's current zone.
 * Psycle is a UK gym: its class times are Europe/London wall-clock times,
 * and the calendar entries must carry that zone regardless of where the
 * phone happens to be. That needs a few lines inside the plugin's Swift.
 *
 * Rather than pull in patch-package (a registry dependency + postinstall) for
 * a handful of anchored edits, this dependency-free script applies them:
 *
 *   - Each patch pins the exact upstream version it was written against. A
 *     resolved-version mismatch FAILS LOUD — you must re-verify the anchors
 *     against the new upstream source, then bump the pin here.
 *   - Each edit is a {find → replace} on a source anchor. If the anchor is
 *     present it is replaced (exactly once); if the replacement is already
 *     present the edit is skipped (idempotent, safe to run repeatedly); if
 *     neither is present the upstream source has drifted → FAIL LOUD.
 *   - Nothing is written unless the whole file's edits check out.
 *
 * Runs from `postinstall` (so `npm ci` on Xcode Cloud / GitHub Actions
 * always patches before `cap sync` compiles the pods) and is re-run at the
 * top of `npm run sync` / `build:open` for existing local installs.
 *
 * Modes:
 *   node patch-plugins.js            → apply (idempotent)
 *   node patch-plugins.js --check    → verify already applied; exit non-zero
 *                                      if any edit is missing (writes nothing)
 *
 * No npm dependencies — only Node built-ins (fs / path).
 */

const fs = require('fs');
const path = require('path');

const IOS_DIR = __dirname;
const NODE_MODULES = path.join(IOS_DIR, 'node_modules');

// ── Patches ───────────────────────────────────────────────────────────────
// One entry per plugin. `files` maps a package-relative path to an ordered
// list of anchored edits. Keep anchors small but unique.

const PATCHES = [
  {
    // Add an optional `timeZone` (IANA identifier) to createEvent /
    // createEventWithPrompt so EKEvents carry an explicit zone instead of
    // the device's current one. Only iOS is patched (this wrapper is iOS-only).
    pkg: '@ebarooni/capacitor-calendar',
    version: '6.7.2',
    files: {
      // 1) Carry the new parameter through the shared params struct.
      'ios/Plugin/EventCreationParameters.swift': [
        {
          find:
            '    public var notes: String?\n' +
            '    public var url: String?\n' +
            '}',
          replace:
            '    public var notes: String?\n' +
            '    public var url: String?\n' +
            '    public var timeZone: String? // IANA id, e.g. "Europe/London" (nil = device zone)\n' +
            '}',
        },
      ],
      // 2) Read `timeZone` from the JS call in both create bridges.
      'ios/Plugin/CapacitorCalendarPlugin.swift': [
        {
          // createEventWithPrompt (inside its Task block)
          find:
            '            if let alertOffsetInMinutesSingle = call.getDouble("alertOffsetInMinutes") as Double? {\n' +
            '                eventParameters.alertOffsetInMinutesSingle = alertOffsetInMinutesSingle\n' +
            '            } else if let alertOffsetInMinutesMultiple = call.getArray("alertOffsetInMinutes") as? [Double]? {\n' +
            '                eventParameters.alertOffsetInMinutesMultiple = alertOffsetInMinutesMultiple\n' +
            '            }\n' +
            '\n' +
            '            do {\n' +
            '                let result = try await calendar.createEventWithPrompt(with: eventParameters)',
          replace:
            '            if let alertOffsetInMinutesSingle = call.getDouble("alertOffsetInMinutes") as Double? {\n' +
            '                eventParameters.alertOffsetInMinutesSingle = alertOffsetInMinutesSingle\n' +
            '            } else if let alertOffsetInMinutesMultiple = call.getArray("alertOffsetInMinutes") as? [Double]? {\n' +
            '                eventParameters.alertOffsetInMinutesMultiple = alertOffsetInMinutesMultiple\n' +
            '            }\n' +
            '            if let timeZone = call.getString("timeZone") {\n' +
            '                eventParameters.timeZone = timeZone\n' +
            '            }\n' +
            '\n' +
            '            do {\n' +
            '                let result = try await calendar.createEventWithPrompt(with: eventParameters)',
        },
        {
          // createEvent
          find:
            '        if let alertOffsetInMinutesSingle = call.getDouble("alertOffsetInMinutes") as Double? {\n' +
            '            eventParameters.alertOffsetInMinutesSingle = alertOffsetInMinutesSingle\n' +
            '        } else if let alertOffsetInMinutesMultiple = call.getArray("alertOffsetInMinutes") as? [Double]? {\n' +
            '            eventParameters.alertOffsetInMinutesMultiple = alertOffsetInMinutesMultiple\n' +
            '        }\n' +
            '\n' +
            '        do {\n' +
            '            let id = try calendar.createEvent(with: eventParameters)',
          replace:
            '        if let alertOffsetInMinutesSingle = call.getDouble("alertOffsetInMinutes") as Double? {\n' +
            '            eventParameters.alertOffsetInMinutesSingle = alertOffsetInMinutesSingle\n' +
            '        } else if let alertOffsetInMinutesMultiple = call.getArray("alertOffsetInMinutes") as? [Double]? {\n' +
            '            eventParameters.alertOffsetInMinutesMultiple = alertOffsetInMinutesMultiple\n' +
            '        }\n' +
            '        if let timeZone = call.getString("timeZone") {\n' +
            '            eventParameters.timeZone = timeZone\n' +
            '        }\n' +
            '\n' +
            '        do {\n' +
            '            let id = try calendar.createEvent(with: eventParameters)',
        },
      ],
      // 3) Stamp the EKEvent with the zone before it is saved / edited.
      'ios/Plugin/CapacitorCalendar.swift': [
        {
          // createEventWithPrompt
          find:
            '        if let isAllDay = parameters.isAllDay {\n' +
            '            newEvent.isAllDay = isAllDay\n' +
            '        }\n' +
            '        if let alertOffsetInMinutesSingle = parameters.alertOffsetInMinutesSingle, alertOffsetInMinutesSingle >= 0 {\n' +
            '            newEvent.addAlarm(EKAlarm(relativeOffset: TimeInterval(-alertOffsetInMinutesSingle * 60)))\n' +
            '        } else if let alertOffsetInMinutesMultiple = parameters.alertOffsetInMinutesMultiple {\n' +
            '            for alert in alertOffsetInMinutesMultiple {\n' +
            '                if alert >= 0 {\n' +
            '                    newEvent.addAlarm(EKAlarm(relativeOffset: TimeInterval(-alert * 60)))\n' +
            '                }\n' +
            '            }\n' +
            '        }\n' +
            '        if let notes = parameters.notes {\n' +
            '            newEvent.notes = notes\n' +
            '        }\n' +
            '        if let urlString = parameters.url, let url = URL(string: urlString) {\n' +
            '            newEvent.url = url\n' +
            '        }\n' +
            '\n' +
            '        return try await withCheckedThrowingContinuation { continuation in',
          replace:
            '        if let isAllDay = parameters.isAllDay {\n' +
            '            newEvent.isAllDay = isAllDay\n' +
            '        }\n' +
            '        if let timeZoneIdentifier = parameters.timeZone, let timeZone = TimeZone(identifier: timeZoneIdentifier) {\n' +
            '            newEvent.timeZone = timeZone\n' +
            '        }\n' +
            '        if let alertOffsetInMinutesSingle = parameters.alertOffsetInMinutesSingle, alertOffsetInMinutesSingle >= 0 {\n' +
            '            newEvent.addAlarm(EKAlarm(relativeOffset: TimeInterval(-alertOffsetInMinutesSingle * 60)))\n' +
            '        } else if let alertOffsetInMinutesMultiple = parameters.alertOffsetInMinutesMultiple {\n' +
            '            for alert in alertOffsetInMinutesMultiple {\n' +
            '                if alert >= 0 {\n' +
            '                    newEvent.addAlarm(EKAlarm(relativeOffset: TimeInterval(-alert * 60)))\n' +
            '                }\n' +
            '            }\n' +
            '        }\n' +
            '        if let notes = parameters.notes {\n' +
            '            newEvent.notes = notes\n' +
            '        }\n' +
            '        if let urlString = parameters.url, let url = URL(string: urlString) {\n' +
            '            newEvent.url = url\n' +
            '        }\n' +
            '\n' +
            '        return try await withCheckedThrowingContinuation { continuation in',
        },
        {
          // createEvent
          find:
            '        if let isAllDay = parameters.isAllDay {\n' +
            '            newEvent.isAllDay = isAllDay\n' +
            '        }\n' +
            '        if let alertOffsetInMinutesSingle = parameters.alertOffsetInMinutesSingle, alertOffsetInMinutesSingle >= 0 {\n' +
            '            newEvent.addAlarm(EKAlarm(relativeOffset: TimeInterval(-alertOffsetInMinutesSingle * 60)))\n' +
            '        } else if let alertOffsetInMinutesMultiple = parameters.alertOffsetInMinutesMultiple {\n' +
            '            for alert in alertOffsetInMinutesMultiple {\n' +
            '                if alert >= 0 {\n' +
            '                    newEvent.addAlarm(EKAlarm(relativeOffset: TimeInterval(-alert * 60)))\n' +
            '                }\n' +
            '            }\n' +
            '        }\n' +
            '        if let notes = parameters.notes {\n' +
            '            newEvent.notes = notes\n' +
            '        }\n' +
            '        if let urlString = parameters.url, let url = URL(string: urlString) {\n' +
            '            newEvent.url = url\n' +
            '        }\n' +
            '\n' +
            '        do {\n' +
            '            try eventStore.save(newEvent, span: .thisEvent)',
          replace:
            '        if let isAllDay = parameters.isAllDay {\n' +
            '            newEvent.isAllDay = isAllDay\n' +
            '        }\n' +
            '        if let timeZoneIdentifier = parameters.timeZone, let timeZone = TimeZone(identifier: timeZoneIdentifier) {\n' +
            '            newEvent.timeZone = timeZone\n' +
            '        }\n' +
            '        if let alertOffsetInMinutesSingle = parameters.alertOffsetInMinutesSingle, alertOffsetInMinutesSingle >= 0 {\n' +
            '            newEvent.addAlarm(EKAlarm(relativeOffset: TimeInterval(-alertOffsetInMinutesSingle * 60)))\n' +
            '        } else if let alertOffsetInMinutesMultiple = parameters.alertOffsetInMinutesMultiple {\n' +
            '            for alert in alertOffsetInMinutesMultiple {\n' +
            '                if alert >= 0 {\n' +
            '                    newEvent.addAlarm(EKAlarm(relativeOffset: TimeInterval(-alert * 60)))\n' +
            '                }\n' +
            '            }\n' +
            '        }\n' +
            '        if let notes = parameters.notes {\n' +
            '            newEvent.notes = notes\n' +
            '        }\n' +
            '        if let urlString = parameters.url, let url = URL(string: urlString) {\n' +
            '            newEvent.url = url\n' +
            '        }\n' +
            '\n' +
            '        do {\n' +
            '            try eventStore.save(newEvent, span: .thisEvent)',
        },
      ],
    },
  },
];

// ── Engine ────────────────────────────────────────────────────────────────

function readPkgVersion(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
  } catch (e) {
    return null;
  }
}

/**
 * Compute the patched content of one file. Returns
 *   { content, applied: n, alreadyApplied: n }
 * or throws an Error describing the drift.
 */
function planFile(content, edits, relPath) {
  let out = content;
  let applied = 0;
  let already = 0;
  edits.forEach((edit, i) => {
    if (out.includes(edit.replace)) {
      already++;
      return;
    }
    const first = out.indexOf(edit.find);
    if (first === -1) {
      throw new Error(
        `${relPath} — edit #${i + 1}: anchor not found (upstream source changed?). ` +
        `Neither the pristine anchor nor the patched form is present.`
      );
    }
    if (out.indexOf(edit.find, first + 1) !== -1) {
      throw new Error(`${relPath} — edit #${i + 1}: anchor is not unique.`);
    }
    out = out.slice(0, first) + edit.replace + out.slice(first + edit.find.length);
    applied++;
  });
  return { content: out, applied, alreadyApplied: already };
}

function main() {
  const CHECK = process.argv.includes('--check');
  let failures = 0;
  let totalApplied = 0;
  let totalAlready = 0;

  for (const patch of PATCHES) {
    const pkgDir = path.join(NODE_MODULES, patch.pkg);
    if (!fs.existsSync(pkgDir)) {
      // npm still fires postinstall for no-install modes (--package-lock-only,
      // --dry-run) that never extract node_modules — nothing to patch, and the
      // command must not fail. Any other absence is a real error.
      if (process.env.npm_config_package_lock_only === 'true' || process.env.npm_config_dry_run === 'true') {
        console.log(`[patch-plugins] skip ${patch.pkg}: node_modules not extracted in this npm mode.`);
        continue;
      }
      console.error(`✗ ${patch.pkg}: not installed (${pkgDir}). Run \`npm ci\` first.`);
      failures++;
      continue;
    }
    const version = readPkgVersion(pkgDir);
    if (version !== patch.version) {
      console.error(
        `✗ ${patch.pkg}: patch pinned to ${patch.version} but ${version} is installed.\n` +
        `  If package.json still pins ${patch.version}, your node_modules is stale — run \`npm ci\`.\n` +
        `  If you are intentionally bumping the plugin, re-verify every edit in\n` +
        `  ios-app/patch-plugins.js against the new upstream source, then bump the pin there.`
      );
      failures++;
      continue;
    }

    // Plan every file first — write nothing until the whole plugin checks out.
    const plans = [];
    let ok = true;
    for (const rel of Object.keys(patch.files)) {
      const abs = path.join(pkgDir, rel);
      let content;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch (e) {
        console.error(`✗ ${patch.pkg}: missing ${rel}`);
        ok = false;
        continue;
      }
      try {
        const plan = planFile(content, patch.files[rel], rel);
        plans.push({ abs, rel, before: content, ...plan });
      } catch (e) {
        console.error(`✗ ${patch.pkg}: ${e.message}`);
        ok = false;
      }
    }
    if (!ok) {
      failures++;
      continue;
    }

    for (const p of plans) {
      totalApplied += p.applied;
      totalAlready += p.alreadyApplied;
      if (p.applied === 0) continue; // already fully patched
      if (CHECK) continue;
      fs.writeFileSync(p.abs, p.content);
      console.log(`  patched ${patch.pkg}/${p.rel} (${p.applied} edit${p.applied === 1 ? '' : 's'})`);
    }
    console.log(`✓ ${patch.pkg}@${version}`);
  }

  if (failures) {
    console.error(`\n[patch-plugins] ${failures} plugin(s) could not be patched.`);
    process.exit(1);
  }
  if (CHECK && totalApplied > 0) {
    console.error(
      `\n[patch-plugins] --check: ${totalApplied} edit(s) NOT applied. ` +
      `Run \`node ios-app/patch-plugins.js\` (or \`npm ci\` in ios-app).`
    );
    process.exit(1);
  }
  console.log(
    CHECK
      ? `[patch-plugins] OK — all edits applied (${totalAlready}).`
      : `[patch-plugins] OK — applied ${totalApplied}, already present ${totalAlready}.`
  );
}

main();
