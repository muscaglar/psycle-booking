#!/bin/sh
# native-checks/run.sh — run the SHIPPED widget / Live Activity Swift on a Mac.
#
# An unsigned simulator build proves the native code compiles; it cannot start
# a widget or a Live Activity. This runs the real model files (unmodified) with
# decode/main.swift, four times:
#   1. as the machine is set;
#   2. a UK phone with 24-Hour Time switched OFF (en_GB + the 12-hour override) —
#      the setting that turns a careless "HH:mm" into "6:30 pm" and makes a
#      careless parse of "…T18:30:00" return nil;
#   3. under an Arabic locale (own numerals, the Islamic calendar);
#   4. under a Thai locale (the Buddhist calendar: "2026" is 543 years ago).
# Every run must print 24-hour "18:30", READ the snapshot's "2026-09-24T18:30:00"
# as that same instant, and decode the previous build's payloads. Exit code is
# non-zero when any check fails in any run.
#
# Each run's two "(this process: …)" lines show what a DateFormatter left on the
# user's locale prints for 18:30 and reads from the snapshot's wall time — i.e.
# whether that run really reproduced the hazard. Runs 2–4 do: "6:30 pm" + nil,
# "١٨:٣٠" + the year 2587, and the year 1483. The override must be handed over as
# a plist BOOLEAN ('<true/>'): CoreFoundation ignores the string "YES", which is
# why an earlier version of this script could not reproduce run 2. The iPhone's
# own 24-Hour Time switch still stays on the device checklist (NATIVE_FEATURES.md).
#
# It goes through the Swift INTERPRETER (`swift file.swift`), not a compiled
# binary: a managed Mac with binary authorization (Santa) kills a locally built,
# ad-hoc-signed executable at launch ("Killed: 9"), while the toolchain's own
# interpreter is an ordinary signed tool. The interpreter takes one file, so the
# sources are concatenated — in dependency order, the checks last.
#
# Needs the Xcode command line tools. No network, no simulator.
#   sh ios-app/native-checks/run.sh
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
APP="$HERE/../ios/App"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/psync-native-checks.XXXXXX")
trap 'rm -rf "$OUT"' EXIT

cat \
  "$APP/PsycleShared/PsycleClassType.swift" \
  "$APP/PsycleShared/PsycleSnapshot.swift" \
  "$APP/PsycleLiveActivity/PsycleLiveActivityAttributes.swift" \
  "$APP/PsycleWidget/PsyclePictogram.swift" \
  "$HERE/decode/main.swift" > "$OUT/decode.swift"

failed=0

# run <label> <only-the-clock-lines: yes|no> [arguments for the process…]
run() {
  label=$1
  brief=$2
  shift 2
  echo "== $label =="
  if swift "$OUT/decode.swift" "$@" > "$OUT/log" 2>&1; then :; else failed=1; fi
  if [ "$brief" = yes ]; then
    grep -E "this process|FAIL|error:|18:30|06:05|00:00|native-checks/decode" "$OUT/log" || true
  else
    cat "$OUT/log"
  fi
  echo
}

run "1/4  as this machine is set" no
run "2/4  en_GB, 24-Hour Time OFF (the 12-hour override in a 24-hour region)" yes -AppleLocale en_GB -AppleICUForce12HourTime '<true/>'
run "3/4  ar_SA (own numerals, Islamic calendar)" yes -AppleLocale ar_SA -AppleLanguages "(ar)"
run "4/4  th_TH (Buddhist calendar)" yes -AppleLocale th_TH -AppleLanguages "(th)"

if [ "$failed" -ne 0 ]; then
  echo "native-checks: FAILED"
  exit 1
fi
echo "native-checks: all four runs passed"
