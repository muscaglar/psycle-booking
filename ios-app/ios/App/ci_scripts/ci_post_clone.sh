#!/bin/sh
# Xcode Cloud hook: runs after clone, before xcodebuild resolves/archives.
# Installs everything the Capacitor project needs that isn't checked in:
# Node toolchain, npm deps, the flattened www/ assets, and CocoaPods.
#
# Xcode Cloud discovers this file because it sits in ci_scripts/ next to
# App.xcworkspace. It must be executable (chmod +x).
set -ex

# Node: newer Xcode Cloud images ship it preinstalled — use that when
# present. An unconditional `brew install node` DIES on those images with a
# symlink conflict (node already exists), which killed whole archives.
# Only brew when node is genuinely missing, without the fragile implicit
# `brew update`, and recover from link conflicts explicitly.
if command -v node >/dev/null 2>&1; then
  echo "node preinstalled at $(command -v node)"
else
  export HOMEBREW_NO_AUTO_UPDATE=1
  export HOMEBREW_NO_INSTALL_CLEANUP=1
  brew install node || brew link --overwrite node
fi
node --version
npm --version

cd "$CI_PRIMARY_REPOSITORY_PATH/ios-app"

# Lockfile pins resolve to registry.npmjs.org, so plain ci works here.
# One retry absorbs transient registry/network blips — a single flake here
# otherwise kills the whole archive.
npm ci || npm ci

# Same recipe as local dev and the GH Actions job: deterministic www/
# flatten + SW stamp, then cap sync (copies web assets into App/public,
# regenerates the Podfile's plugin block from package.json, runs pod install).
npm run sync
