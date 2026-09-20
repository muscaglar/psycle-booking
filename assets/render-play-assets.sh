#!/bin/sh
# Rebuild the two Google Play listing graphics that are drawings (the phone screenshots are
# photographs of the app: node tests/tools/appstore-shots.mjs --play).
#
#   ios-app/playstore-assets/icon-512.png                  512 x 512, from assets/psync-logo.svg - the
#       app icon itself, a full square: Play rounds the corners and adds the shadow.
#   ios-app/playstore-assets/feature-graphic-1024x500.png  1024 x 500, from assets/psync-play-feature.svg -
#       the mark and the wordmark on the Graphite ground (#12161F), as the launch screen wears them.
#
# Needs rsvg-convert (librsvg) and nothing else. No font is needed: the wordmark in
# psync-play-feature.svg is OUTLINES - "Psync" in Sofia Sans Condensed at weight 900, the launch
# screen's wordmark, shaped once and written into the file as one path - because a plain SVG renderer
# cannot load the app's woff2, and a fallback face would go unnoticed. The mark in it is
# psync-logo.svg's four paths, unchanged (tests/suites/22-play-release.js holds that, and the sizes).
# (Should the wordmark ever change: the path was cut from fonts/sofia-sans-condensed.woff2 with
# fontTools - the wght axis pinned at 900 - and laid out by HarfBuzz, kerning included, at 1000 units
# to the em; the SVG scales it by 0.21. No such tool is part of this repository, by design.)
#
# Both files are fully opaque, so rsvg-convert writes them WITHOUT an alpha channel - which is what
# Play asks of a feature graphic ("JPEG or 24-bit PNG, no alpha"). Nothing of Psycle's is in either.
#
#   sh assets/render-play-assets.sh
set -e
cd "$(dirname "$0")/.."
OUT=ios-app/playstore-assets
mkdir -p "$OUT"
rsvg-convert -w 512 -h 512 assets/psync-logo.svg -o "$OUT/icon-512.png"
rsvg-convert -w 1024 -h 500 assets/psync-play-feature.svg -o "$OUT/feature-graphic-1024x500.png"
echo "Play icon (512 x 512) and feature graphic (1024 x 500) rebuilt in $OUT/"
