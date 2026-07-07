#!/bin/sh
# Xcode Cloud hook: runs after clone, before xcodebuild resolves/archives.
# Installs everything the Capacitor project needs that isn't checked in:
# Node toolchain, npm deps, the flattened www/ assets, and CocoaPods.
#
# Xcode Cloud discovers this file because it sits in ci_scripts/ next to
# App.xcworkspace. It must be executable (chmod +x).
set -ex

# Node is not preinstalled on Xcode Cloud images; Homebrew is. Install the
# un-versioned formula: versioned ones (node@20, node@22, ...) get disabled
# by Homebrew after EOL, which would make `brew install` exit non-zero under
# set -e and silently kill all TestFlight delivery on some future tag push.
brew install node
node --version
npm --version

cd "$CI_PRIMARY_REPOSITORY_PATH/ios-app"

# Lockfile pins resolve to registry.npmjs.org, so plain ci works here.
npm ci

# Same recipe as local dev and the GH Actions job: deterministic www/
# flatten + SW stamp, then cap sync (copies web assets into App/public,
# regenerates the Podfile's plugin block from package.json, runs pod install).
npm run sync
