# Psycle Class Finder — Development Setup

## Prerequisites

- macOS
- Python 3 (comes with Xcode Command Line Tools)
- Node.js (v20+)
- Xcode (for iOS builds)

## Web App (PWA)

```bash
# Clone and serve
git clone <your-repo-url> psycle-booking
cd psycle-booking
python3 -m http.server 8080
```

Open http://localhost:8080/psycle-finder.html

That's it — no build step, no npm install for the web app.

## iOS App (Capacitor)

```bash
# From the repo root
cd ios-app

# Install Node dependencies (Capacitor + plugins)
npm install

# Sync web assets into the iOS project
# (copies js/, css/, HTML from root into ios-app/www/ and runs cap sync)
npm run sync

# Open in Xcode
npm run open
```

If `npx` or `node` isn't found, ensure your Node version is set:
```bash
# If using asdf
asdf install nodejs 20.19.5
asdf local nodejs 20.19.5

# If using nvm
nvm install 20
nvm use 20
```

### Xcode Setup (first time only)

1. After `npm run open`, Xcode opens the project
2. Select your development team: **Signing & Capabilities** → **Team**
3. Set the bundle identifier: `com.psyclefinder.app` (or your own)
4. Select a connected iPhone or simulator
5. **Product → Run** (or `Cmd+R`)

### Rebuilding after code changes

```bash
# After editing any js/ or css/ files:
cd ios-app
npm run sync

# Then in Xcode: Cmd+R to rebuild
```

Or use the shortcut:
```bash
cd ios-app && npm run build
# (runs sync + opens Xcode)
```

## Playwright (for automated screenshots / testing)

```bash
pip3 install playwright
python3 -m playwright install chromium
```

Then from the repo root:
```bash
python3 -m http.server 8080 &
python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()
    page.goto('http://localhost:8080/psycle-finder.html')
    input('Press Enter to close...')
    browser.close()
"
```

## File Structure Quick Reference

```
psycle-booking/
├── psycle-finder.html    # App entry point
├── js/                   # All JavaScript (load order matters)
├── css/                  # All CSS (design tokens in theme.css :root)
├── sw.js                 # Service Worker
├── ios-app/              # Capacitor iOS project
│   ├── npm run sync      # Copy web → ios
│   ├── npm run open      # Open Xcode
│   └── npm run build     # sync + open
├── CLAUDE.md             # Full architecture docs
├── SETUP.md              # This file
└── APP_STORE_LISTING.md  # App Store copy + assets (in ios-app/)
```
