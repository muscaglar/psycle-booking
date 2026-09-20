#!/bin/sh
# Rebuild every raster copy of the Psync mark from the SVGs in this folder.
#   psync-logo.svg          the app icon (light)      psync-logo-dark.svg / -tinted.svg   its iOS 18 appearances
#   psync-mark.svg          the mark alone, grooves as real cut-outs (header, welcome, sign-in page, launch screen)
#   launch/splash-*.html    the launch image: mark + wordmark in Sofia Sans Condensed
#   psync-android-legacy.svg / -round.svg   the Android launcher icon for Android 7 and below (see below)
# Needs rsvg-convert (librsvg) for the icons and Google Chrome for the two launch images
# (they set the wordmark in the app's own font file, which a plain SVG renderer cannot load).
#
#   assets/render-icons.sh            everything
#   assets/render-icons.sh android    the Android launcher PNGs alone (rsvg-convert only, no Chrome)
set -e
cd "$(dirname "$0")/.."

# ── Android ───────────────────────────────────────────────────────────────────
# Android 8+ draws the launcher icon, the themed icon, the launch screen and the notification
# icon from VECTORS, which are hand-written and need no rendering:
#   ios-app/android/app/src/main/res/drawable/ic_launcher_foreground.xml  (its note explains the geometry)
#   …/ic_launcher_monochrome.xml · …/splash_mark.xml · …/ic_stat_psync.xml
# Only Android 7 and below reads PNGs: a 48dp icon at five densities, square and round. The two
# SVGs carry psync-logo.svg's four paths unchanged, scaled onto a ground with a hairline edge.
render_android() {
  RES=ios-app/android/app/src/main/res
  for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
    d=${pair%%:*}; s=${pair##*:}
    mkdir -p "$RES/mipmap-$d"
    rsvg-convert -w "$s" -h "$s" assets/psync-android-legacy.svg -o "$RES/mipmap-$d/ic_launcher.png"
    rsvg-convert -w "$s" -h "$s" assets/psync-android-round.svg  -o "$RES/mipmap-$d/ic_launcher_round.png"
  done
}
if [ "$1" = android ]; then render_android; echo "android launcher icons rebuilt"; exit 0; fi

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
render_android
echo "icons and launch images rebuilt"
