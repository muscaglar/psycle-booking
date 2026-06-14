# Keeping `ios-app/www/` in sync

The iOS app ships a flattened copy of the web app under `ios-app/www/`, plus a
service-worker cache version derived from content. Both are produced
deterministically by `ios-app/build.js` — never edit `www/` by hand (except
`www/native-bridge.js`, which is the one hand-maintained file and is never
overwritten by the build).

## Commands

Run from `ios-app/`:

| Command | What it does |
|---------|--------------|
| `npm run build` | Regenerate `www/` and stamp the SW cache version. Idempotent. |
| `npm run sync` | `build` then `npx cap sync ios`. |
| `npm run build:open` | `build` + `cap sync` + `cap open ios`. |
| `npm run sync:check` | Dry-run drift check. Exits non-zero if `www/` (or the SW `CACHE` line) is out of date. Writes nothing. |

After editing anything in root `js/`, `css/`, `*.html`, `manifest.json`, or
`sw.js`, run `npm run build` and commit the regenerated `www/` and `sw.js`.

## Git pre-commit hook (drift guard)

Block commits that would leave `www/` out of sync with the source. Paste this
into `.git/hooks/pre-commit` and make it executable
(`chmod +x .git/hooks/pre-commit`):

```sh
#!/bin/sh
# Fail the commit if the iOS www/ mirror or the service-worker cache version
# is out of date with root js/css/html. Regenerate with: (cd ios-app && npm run build)
node ios-app/build.js --check || {
  echo
  echo "✗ ios-app/www/ is out of sync. Run: (cd ios-app && npm run build) and re-stage."
  exit 1
}
```

> Run the hook from the **repo root** (that's where git invokes it), so the
> relative path `ios-app/build.js` resolves. `build.js` itself locates the repo
> via its own `__dirname`, so it works regardless of the caller's CWD.

### CI

The same check works in CI — fail the job if the committed `www/` drifted:

```sh
node ios-app/build.js --check
```
