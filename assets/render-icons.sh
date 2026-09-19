#!/bin/sh
# Rebuild every raster copy of the Psync mark from the SVGs in this folder.
#   psync-logo.svg          the app icon (light)      psync-logo-dark.svg / -tinted.svg   its iOS 18 appearances
#   psync-mark.svg          the mark alone, grooves as real cut-outs (header, welcome, sign-in page, launch screen)
#   launch/splash-*.html    the launch image: mark + wordmark in Sofia Sans Condensed
# Needs rsvg-convert (librsvg) for the icons and Google Chrome for the two launch images
# (they set the wordmark in the app's own font file, which a plain SVG renderer cannot load).
set -e
cd "$(dirname "$0")/.."
SET=ios-app/ios/App/App/Assets.xcassets
rsvg-convert -w 1024 -h 1024 assets/psync-logo.svg        -o "$SET/AppIcon.appiconset/AppIcon-1024.png"
rsvg-convert -w 1024 -h 1024 assets/psync-logo-dark.svg   -o "$SET/AppIcon.appiconset/AppIcon-1024-dark.png"
rsvg-convert -w 1024 -h 1024 assets/psync-logo-tinted.svg -o "$SET/AppIcon.appiconset/AppIcon-1024-tinted.png"
rsvg-convert -w 512 -h 512 assets/psync-logo.svg -o icons/icon-512.png
rsvg-convert -w 192 -h 192 assets/psync-logo.svg -o icons/icon-192.png
rsvg-convert -w 180 -h 180 assets/psync-logo.svg -o icons/apple-touch-icon.png
for s in 1024 180 167 152 120 87 80 76 60 58 40 29 20; do
  rsvg-convert -w $s -h $s assets/psync-logo.svg -o "ios-app/appstore-assets/AppIcon-$s.png"
done
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
for v in light dark; do
  out="$PWD/assets/launch/splash-$v.png"; rm -f "$out"
  tmp=$(mktemp -d)
  # Headless Chrome does not always exit after --screenshot: wait for the file, then stop it.
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --user-data-dir="$tmp" \
    --allow-file-access-from-files --virtual-time-budget=4000 --window-size=2732,2732 \
    --screenshot="$out" "file://$PWD/assets/launch/splash-$v.html" >/dev/null 2>&1 &
  pid=$!; n=0; while [ ! -s "$out" ] && [ $n -lt 60 ]; do sleep 1; n=$((n+1)); done; sleep 2; kill $pid 2>/dev/null || true; rm -rf "$tmp"
  suffix=""; [ "$v" = dark ] && suffix="-dark"
  for f in "" "-1" "-2"; do cp "$out" "$SET/Splash.imageset/splash-2732x2732$f$suffix.png"; done
  rm -f "$out"
done
echo "icons and launch images rebuilt"
