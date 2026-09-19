#!/bin/sh
# native-checks/render.sh — draw the SHIPPED widget layouts to PNGs on a Mac.
#
#   sh ios-app/native-checks/render.sh [output-dir]     (default: a temp dir)
#
# Writes home-light / home-dark (small + medium, every class type, the three
# intensities, the empty state), small-sizes-* (the small family at every phone
# size, longest strings), activity-* (the Live Activity card), recoloured
# (accented / StandBy / Lock Screen accessories / the Dynamic Island's tile and
# chip) and pictograms. See render/main.swift for what this is and is not — it
# is a drawing of the real SwiftUI views, not WidgetKit.
#
# Swift interpreter, one concatenated file — see run.sh for why.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
APP="$HERE/../ios/App"
DEST=${1:-$(mktemp -d "${TMPDIR:-/tmp}/psync-widget-renders.XXXXXX")}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/psync-native-render.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$DEST"

cat \
  "$APP/PsycleShared/PsycleClassType.swift" \
  "$APP/PsycleShared/PsycleSnapshot.swift" \
  "$APP/PsycleWidget/PsyclePictogram.swift" \
  "$APP/PsycleWidget/PsycleWidgetStyle.swift" \
  "$APP/PsycleWidget/PsycleWidgetLayouts.swift" \
  "$HERE/render/main.swift" > "$WORK/render.swift"

swift "$WORK/render.swift" "$DEST"
echo "PNGs in $DEST"
