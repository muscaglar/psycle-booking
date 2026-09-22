# Google Play — getting the Android app into the store

The owner's runbook, in order, nothing assumed. It sits beside three files and does not repeat them:
`ANDROID.md` (what the Android app is, building it, the on-device checklist), `PLAY_STORE_LISTING.md` (every word
and picture the store listing needs, and the data-safety answers) and `CICD.md` (the iPhone pipeline).

| Leg | Who | How |
|-----|-----|-----|
| The signed bundle (`app-release.aab`) | GitHub Actions, **by hand** — or you, on a machine with Android Studio | the workflow **Android release (signed AAB)** (`.github/workflows/android-release.yml`): manual, `main` only, stops if a signing secret is missing, proves the bundle is signed by your key, keeps it for 5 days |
| The upload, the listing, every form, every release | **you**, in Play Console | nothing in this repository talks to Google Play |
| The listing graphics | the repository | `sh assets/render-play-assets.sh` (icon, feature graphic — already built, in `playstore-assets/`) and `node tests/tools/appstore-shots.mjs --play` (the six phone screenshots) |
| The privacy policy and the support page | the repository | `privacy.html` and `support.html` at the repository root, published with the web app; both name the publisher (Ajar.dev Ltd) and the contact address support@ajar.dev |

Google changes its rules and its figures often. Wherever this file gives a number of Google's — a fee, a tester
count, a number of days, an API level, a picture size — **check the current figure in Play Console** (or Play
Console Help) before you rely on it. What is written here was true to the best of the author's knowledge in
September 2026 and was **not** checked against a live Play Console: nobody has uploaded this app anywhere.

---

## 0. Two preconditions — read these before you pay for anything

### 0.1 The target API level: an upload is refused today

`ios-app/android/variables.gradle` says `targetSdkVersion = 34` (Android 14). That is what Capacitor 6 builds for.
Google Play accepts a new app, and an update to an existing one, only if it targets a recent API level, and it
raises the bar every year at the end of August: from 31 August 2025 the floor was **API 35**, and if Google has
kept to its pattern it is one higher by the time you read this. The page to read is "Target API level
requirements for Google Play apps" in Play Console Help. Below the floor, Play Console refuses the release and
names the level it wants. The cheapest way to see today's figure for yourself: upload the bundle to **Internal
testing** (step 6) and read the message.

So **a Play release needs one of two things first.** Neither is done.

**Route A — the Capacitor upgrade (recommended).** `ios-app/UPGRADE-CAPACITOR-8.md` takes the wrapper from
Capacitor 6 to 8. Each Capacitor major builds for the API level Google asks for in its year, so the upgrade brings
the target level, the Android Gradle Plugin, Gradle and every plugin along together, built and tested as a set.
What it costs:
- The runbook was written for the iPhone app, before `ios-app/android/` existed. It has **never been run** and has
  **no Android steps**. The Android half still to be written: `variables.gradle` (take the three SDK levels from
  the template of the Capacitor version you install, not from this file), the Android Gradle Plugin and the Gradle
  wrapper, the two regenerated `capacitor.*.gradle` files, and the JDK — Capacitor 7 and later want a newer JDK
  than 17, so `java-version` moves in **both** workflow files (`ci.yml` and `android-release.yml`). Confirm each
  in Capacitor's own upgrade guides.
- `minSdkVersion` rises with it (it is 22 today), so the oldest phones drop off.
- **Edge to edge.** From target 35 Android draws the app under the status bar and the navigation bar and ignores
  the bar colours this project sets (`res/values*/styles.xml`, and the bridge's `StatusBar.setBackgroundColor`).
  The page's `env(safe-area-inset-*)` rules become load-bearing on Android, where they have never been seen.
- The calendar plugin's call shapes change silently (the runbook's step 6): left alone, calendar sync just stops.
- After it, the whole on-device checklist in `ANDROID.md` is walked again, and the iPhone app's too.

**Route B — raise `targetSdkVersion` by hand, staying on Capacitor 6.** For a floor of 35 that is one line in
`variables.gradle`. For a floor ABOVE 35 — which this section's own dating expects — it is three things:
`targetSdkVersion`, `compileSdkVersion` with it (`19-android-project.js` holds `compileSdk ≥ targetSdk`), and the
level named in `gradle.properties` (`android.suppressUnsupportedCompileSdk=35` names the one level it silences, on
an Android Gradle Plugin that already needed that for 35). It is a stopgap, and the project's own guides say not to
do it casually (`ios-app/android/AGENTS.md`, rule 9), because:
- Edge to edge arrives all the same (above), with none of the help the newer Capacitor gives for it. At target 35
  a theme can still opt out (`android:windowOptOutEdgeToEdgeEnforcement`, in a `values-v35/` style); Android
  ignores that attribute once an app targets 36. **At a floor of 36 the opt-out no longer exists: Route B is then
  edge to edge with no help at all**, on the first day.
- Capacitor 6 and its plugins were never built or tested against the newer level, and the Android Gradle Plugin
  this project pins (8.2.1) already needs a suppression to compile against 35.
- It has to be done again every August, each time further from what Capacitor 6 was made for.

**Recommendation: Route A**, on a branch, with a phone in your hand. Use Route B only if a date forces it, only on
an `android/…` branch that CI compiles, and only after looking at every screen on a real phone — the status bar,
the bottom tab bar, every sheet. Either way `tests/suites/19-android-project.js` holds `compileSdk ≥ targetSdk`.

Sideloading the debug APK (`ANDROID.md` → "Try it with nothing installed") needs none of this.

### 0.2 The policy risk: this is an unofficial client for someone else's service

Psync signs in to **Psycle's** booking system with the member's **Psycle password**. Google's reviewers, and
Google's automated checks, look hard at exactly that. The policies that apply (Play Console Help → Policy Centre):

- **Impersonation** — an app must not imply a relationship with another company that it does not have.
- **Intellectual property** — no use of someone else's trademark without permission.
- **User data** — an app that handles credentials must say plainly what it does with them, must send them over an
  encrypted connection, and must have a privacy policy that matches what it does.
- **Device and network abuse** — an app must not use another service in a way that service does not permit.
  Whether Psycle's terms allow a third-party client is a question for Psycle, not something this file can answer.

What the project already does about it, and what you must keep true:
1. The listing says **"independent"** and **"not affiliated with, or endorsed by, Psycle"** prominently: in the
   short description, as the second paragraph of the full description, in the notes to reviewers, on the privacy
   page, on the sign-in page and on the first page of the welcome. Do not soften or move it.
2. **Psycle's marks are never the app's own.** The name is "Psync", not "Psycle …"; the icon, the feature graphic
   and the screenshot frames carry nothing of Psycle's — no logo, no name treatment, no colours. "Psycle" appears
   only in sentences, as a statement of what the app works with.
3. The password goes to Psycle's own host over HTTPS and nowhere else, and is never stored (`privacy.html`).

**The only real protection is written permission from Psycle.** With it, a complaint from the trademark owner — which
is what takes such apps down — does not come, and Play Console Help has a form for giving the review team advance
notice of a permission or a licence (search it for "advance notice"). Without it, expect that the app can be
rejected at review, or removed later on Psycle's request, whatever the listing says. A removal is a strike against
the developer account, and the account is tied to your verified identity: think about that before production.
Testing tracks (step 6) are a lower-stakes place to find out.

### 0.3 Two things to line up first: they have lead time, and the forms ask for them late

- **A review-only Psycle account** (→ step 5.4). Google's reviewers cannot get past the sign-in without one, so you
  need a second, real Psycle account with **no class credits and no payment card**. Making it touches the very
  question 0.2 raises — what Psycle's terms allow — so settle the two together, before you pay for anything.
- **The testers** (→ step 1.5). A new personal developer account must run a closed test with a minimum number of
  real people (12 when this was written) opted in for a minimum number of days (14) before it may publish. Ask
  them now: the clock cannot start until they have all accepted.

---

## 1. The developer account

1. Go to Play Console and register. There is a **one-off registration fee** (US$25 when this was written).
2. Choose the account type. A **personal** account is in your own name; an **organisation** account needs a
   registered organisation and a D-U-N-S number. This guide assumes personal.
3. **Identity verification.** Google verifies your legal name and address with a government document, and asks
   for a contact e-mail address and a phone number, each of which it verifies. Read carefully what it says it will
   **show publicly** on the listing for your account type — for a personal account that has included the
   developer's name and country, and a contact e-mail address always.
4. **Device verification.** A new personal account is asked to prove it has a real Android phone, through the
   Play Console mobile app. Have one to hand.
5. **The closed-test rule for new personal accounts.** A personal account created after 13 November 2023 cannot
   publish to production straight away. Google's rule — "App testing requirements for new personal developer
   accounts" in Play Console Help — is that you first run a **closed test with a minimum number of testers who
   stay opted in for a minimum number of days without a break**, and only then apply for production access, with
   a short questionnaire about the test. When this was written the figures were **12 testers** for **14 days**
   (it began as 20). **Read the current numbers on that page.** The testers must be real people with Google
   accounts who accept the invitation and install the app; plan who they are before you start the clock.

Verification can take days. Start it early; nothing else in this file needs it until step 5.

---

## 2. The upload key — create it once

Play uses two keys. Google holds the **app signing key** (Play App Signing — it is not optional for a new app) and
signs what members download. You hold the **upload key**, which proves to Google that a bundle came from you.

1. On your own machine, **outside this repository** (it is public):
   ```bash
   keytool -genkeypair -v -keystore psync-upload.jks -alias psync -keyalg RSA -keysize 2048 -validity 10000
   ```
   RSA, 2048 bits or more, and a validity measured in decades (10000 days is about 27 years): Play refuses a key
   that expires too soon. `keytool` asks for a password, then for a name and organisation — those go into the
   certificate and are visible to anyone who inspects the app, so type what you are content to publish. A current
   `keytool` writes a PKCS12 store, in which the key's password **is** the store's password: use the same value
   for both wherever the two are asked for.
2. **Back it up now**: the keystore file as an attachment in your password manager, with the password and the
   alias (`psync`) beside it, and a second copy somewhere else.
3. It is never committed. `*.jks`, `*.keystore`, `*.p12`, `*.pfx` and `keystore.properties` are git-ignored at the
   root and in `ios-app/android/`, and two tests fail if one is ever tracked (`19-android-project.js`,
   `22-play-release.js`) — but the safest keystore was never inside the folder.
4. **Enrol in Play App Signing** when you create the first release (step 7): accept the default, "Google
   generates the app signing key". Afterwards Play Console → **App integrity** shows two certificates: the app
   signing key's and your upload key's. The second one's SHA-256 fingerprint is what the release workflow prints.
5. **If the upload key is lost or stolen**, the app is not: Play Console → App integrity → App signing →
   **Request upload key reset** (the account owner only). You make a new key as in 1, export its certificate —
   `keytool -export -rfc -keystore psync-upload.jks -alias psync -file upload_certificate.pem` — and send Google
   the `.pem`. Google tells you when the new key starts to work (it has been about two days). Then replace the
   four GitHub secrets (step 4).

The build reads four values — from the environment, or from `ios-app/android/keystore.properties` (git-ignored);
the environment wins. They are declared at the top of `ios-app/android/app/build.gradle`:

| Environment variable | `keystore.properties` key | What |
|---|---|---|
| `PSYNC_KEYSTORE_FILE` | `storeFile` | path to the keystore (a relative path is read from `ios-app/android/`) |
| `PSYNC_KEYSTORE_PASSWORD` | `storePassword` | the store's password |
| `PSYNC_KEY_ALIAS` | `keyAlias` | `psync` above |
| `PSYNC_KEY_PASSWORD` | `keyPassword` | the key's password (the same value, for a PKCS12 store) |

With any of the four missing, Gradle builds a release that is **unsigned** — never one signed with the debug key.
An unsigned bundle looks like any other file, which is why the workflow in step 4 refuses to produce one.

---

## 3. versionCode and versionName

Both are set **by hand** in `ios-app/android/app/build.gradle` (`defaultConfig`); nothing bumps them for you.

- `versionCode` — a whole number, never shown to anyone. **It must be higher than that of every bundle ever
  uploaded to this app, on any track.** Play refuses a bundle whose code it has seen, even one that was never
  released. Add one for every upload, including a re-upload after a failed review. It cannot go back.
- `versionName` — what a member sees ("1.0", "1.1"). Any text; keep it in step with the iPhone app's version.

Change them on a branch, merge to `main`, then build. **Remember what a push to `main` does** (`CICD.md`): it is
archived to TestFlight and publishes the web app, so put the version bump in the same merge as the work it
releases rather than in a push of its own.

---

## 4. Building the signed bundle

Both ways produce `ios-app/android/app/build/outputs/bundle/release/app-release.aab`. An `.aab` (Android App
Bundle) is what Play takes; it cannot be installed on a phone directly.

### 4a. On your own machine

Needs Android Studio (for the SDK), a **JDK 17** and Node, on a machine whose npm reaches the public registry
(`ANDROID.md` → "Building it yourself" has the detail).

```bash
cd ios-app
npm ci
npm run sync:android
cd android
export PSYNC_KEYSTORE_FILE=/full/path/to/psync-upload.jks
export PSYNC_KEY_ALIAS=psync
read -r -s PSYNC_KEYSTORE_PASSWORD && export PSYNC_KEYSTORE_PASSWORD   # typed, not echoed, not in your shell history
export PSYNC_KEY_PASSWORD="$PSYNC_KEYSTORE_PASSWORD"
./gradlew bundleRelease
jarsigner -verify app/build/outputs/bundle/release/app-release.aab        # must say: jar verified.
```

`jarsigner` exits 0 for an unsigned file too, so read its words: **"jar verified."** is a release, "jar is
unsigned." is not. (In Android Studio: Build → Generate Signed App Bundle does the same through a dialog.)
A `keystore.properties` file in `ios-app/android/` with the four lower-case keys works instead of the exports; it
holds a password in plain text, so prefer the environment.

### 4b. With the manual GitHub workflow

`.github/workflows/android-release.yml`, shown in the Actions tab as **Android release (signed AAB)**. It runs only
when you press the button, with a read-only token, and uploads nothing to Google. It refuses any ref but `main`;
with the secrets in the `play-release` environment, as below, GitHub enforces that too.

**Once: make the `play-release` environment, then create the four secrets IN it.**
1. github.com → the repository → Settings → Environments → New environment → name it `play-release` (the name the
   job uses). Under **Deployment branches and tags** choose "Selected branches and tags" and add `main`, alone. Add
   yourself as a **required reviewer**: each run then waits for your approval.
2. In that environment → Environment secrets → Add secret, four times. **Not** under Settings → Secrets and
   variables → Actions: a repository-level copy is what the environment exists to avoid. The names are exact:

| Secret | Value |
|---|---|
| `PSYNC_KEYSTORE_BASE64` | the keystore file, base64-encoded (below) |
| `PSYNC_KEYSTORE_PASSWORD` | the store's password |
| `PSYNC_KEY_ALIAS` | `psync` |
| `PSYNC_KEY_PASSWORD` | the key's password (the same value, for a PKCS12 store) |

To encode the keystore without it ever touching the clipboard or the disk a second time, with the GitHub CLI,
from the folder that holds the keystore:

```bash
# the environment must exist first (1, above); --env files each secret IN it, not at repository level
base64 -i psync-upload.jks | gh secret set PSYNC_KEYSTORE_BASE64 --env play-release --repo muscaglar/psycle-booking   # macOS
base64 -w 0 psync-upload.jks | gh secret set PSYNC_KEYSTORE_BASE64 --env play-release --repo muscaglar/psycle-booking  # Linux
gh secret set PSYNC_KEYSTORE_PASSWORD --env play-release --repo muscaglar/psycle-booking    # asks for the value; nothing is echoed
gh secret set PSYNC_KEY_ALIAS --env play-release --repo muscaglar/psycle-booking
gh secret set PSYNC_KEY_PASSWORD --env play-release --repo muscaglar/psycle-booking
```

Without the CLI: `base64 -i psync-upload.jks | pbcopy`, paste it into the secret's value box, then copy something
else so that it does not stay on the clipboard. A secret can be replaced but never read back, by you or anyone.

**Why the environment, and not repository secrets.** The workflow's own "main only" step is a convention, not a
control: a manual run uses the workflow file of the branch it is started from, so a copy on another branch that
drops that step — or any new workflow file with `on: push` — could read a REPOSITORY-level secret. An environment
limited to `main` is the control: GitHub itself refuses to hand its secrets to a job running from any other ref, or
to a job that does not name the environment, and the required reviewer means nothing is handed over until you have
looked at what asked. If you already made the four at repository level, delete them there once the environment
holds them (Settings → Secrets and variables → Actions).

**Each release:**
1. `versionCode` / `versionName` are bumped and on `main` (step 3).
2. Actions → **Android release (signed AAB)** → Run workflow → branch `main` → type the **version name** exactly
   as `build.gradle` has it ("1.0"). The input is a confirmation, not an override: if it differs from the file
   the run stops and says what the file holds. Nothing is edited on the runner.
3. The run, in order: waits for your approval (the environment's required reviewer); refuses any branch but
   `main`; **fails at once, naming the missing secret, if any of the four is not set**; `npm ci`; `npm run
   sync:android`; only then decodes the keystore — into the runner's temporary folder, never the workspace — and
   checks that it opens with the password and holds the alias; `./gradlew bundleRelease` with the four `PSYNC_…`
   variables; checks that `jarsigner` says "jar verified" **and** that the bundle's certificate is the keystore's
   own; shreds the keystore, before any other code runs; uploads the `.aab`; and shreds again, whatever happened.
4. Open the finished run. Its **summary** gives the version, the commit, the file's SHA-256 and the **upload
   certificate's SHA-256 fingerprint** — compare that with Play Console → App integrity → Upload key certificate
   the first time. Under **Artifacts**, download `psync-release-aab-<name>-<code>` (a zip holding
   `app-release.aab`). It is kept for **5 days**.

A red run never leaves a bundle behind: the upload step is after every check.

**What you are trusting when you use it.** The upload key and its password live in GitHub's encrypted secrets and
exist in clear on GitHub's runner for a few minutes per release. A secret cannot be read back, is masked in logs,
and is not given to workflows started from a fork's pull request. **Anyone who can push a workflow file to this
repository could read a REPOSITORY-level secret, from any branch** — which is why the four live in the
`play-release` environment, which only `main` can reach and only after your approval. Today the only person who can
push is you: keep it so. Gradle and its plugins run with the passwords in their environment, as they do on your own
machine. In a
public repository anyone signed in to GitHub can download a run's artifacts: a signed bundle holds no secret (it
is the app), which is why that is acceptable. If the key leaks, step 2.5 replaces it; the app signing key, which
Google holds, is untouched.

**Not automated, on purpose: the upload to Play.** The first upload of a new app can only be made by hand in Play
Console. Later ones could be automated, and this repository does not do it, because it needs a **Google Cloud
service account** invited into Play Console, whose JSON key would live in GitHub — a long-lived credential that can
publish to your listing, in a public repository's settings, usually handed to a third-party action. If you ever
want it: give the service account permission for this one app and for testing tracks only; keep its key in the
`play-release` environment behind a required reviewer; pin any third-party action to a full commit SHA (as `ci.yml`
pins the emulator runner); upload to **Internal testing** as a draft, and keep promotion to production a click of
your own. No service-account file is ever committed: `22-play-release.js` fails on a tracked one.

---

## 5. Creating the app in Play Console, form by form

Play Console → **Create app**: name `Psync: Class Booking Companion`, default language English (United Kingdom),
**App**, **Free**; accept the declarations. The dashboard then lists tasks; they are these, in any order.

### 5.1 Main store listing
Every field — name, short description, full description, category, tags, contact details — is in
`PLAY_STORE_LISTING.md`, inside the length limits. The contact **e-mail address is shown publicly**.

### 5.2 Graphics
The sizes Play asked for when this was written — check them on the upload boxes themselves:

| Asset | Play wants | The file |
|---|---|---|
| App icon | 512 × 512 PNG, up to 1 MB, a full square (Play rounds the corners and adds the shadow) | `ios-app/playstore-assets/icon-512.png` |
| Feature graphic | 1024 × 500, JPEG or 24-bit PNG with **no alpha channel** | `ios-app/playstore-assets/feature-graphic-1024x500.png` |
| Phone screenshots | 2 to 8; JPEG or 24-bit PNG, no alpha; each side from 320 to 3,840 px; the long side **at most twice** the short side. Play asks for at least four at 1080 px or more on the short side before it will feature an app | `ios-app/playstore-assets/01-discover.png` … `06-light-and-dark.png`, 1080 × 1920 — **to build**, below |
| Tablet screenshots | optional; Play only warns without them | none: the app is a phone app, portrait only |

- The icon and the feature graphic are built and committed: `sh assets/render-play-assets.sh` rebuilds both
  (`rsvg-convert` only). The feature graphic is the mark and the wordmark on the Graphite ground; its source is
  `assets/psync-play-feature.svg`, in which the wordmark is outlines, so no font is needed.
- **The iPhone screenshots do not fit.** `appstore-assets/*.png` are 1290 × 2796 — 2.17 to 1 — and Play refuses
  anything longer than 2 to 1. Do not crop or squash them. Build the Play set, the same six scenes and captions on
  a 9:16 canvas with no phone drawn round them:
  ```bash
  python3 -m http.server 8080 --bind 127.0.0.1        # from the repository root, in one terminal
  node tests/tools/appstore-shots.mjs --play           # in another: needs Google Chrome and Node 22+
  ```
  It drives the real app on the **fake** Psycle server (no request leaves the machine; every name in the pictures
  is made up) and fails if a file is not exactly 1080 × 1920. It needs Google Chrome and Node 22+. **The six files in
  `playstore-assets/` were built with it and looked at**; run it again after any change to the look, and look at all
  six before you upload them.

### 5.3 Privacy policy
App content → Privacy policy → the address of `privacy.html` on the hosted web app:

```
https://muscaglar.github.io/psycle-booking/privacy.html
```

How that address was arrived at, so that you can check it: the repository is `muscaglar/psycle-booking`
(`CICD.md`), the web app is published from `main` by GitHub Pages (the empty `.nojekyll` at the root is Pages'
switch; no workflow here deploys it), and no `CNAME` file sets a custom domain — so Pages serves the repository
root at `https://<owner>.github.io/<repository>/`. **Confirm it in Settings → Pages, which prints the site's
address**, and open the page in a private window before you give it to Google. If a custom domain is ever set,
the address changes and the listing must follow.

Before you submit it:
1. **The publisher and the contact address are in `privacy.html`**: Ajar.dev Ltd (company number 14071311) and
   support@ajar.dev, in the first section's `<span id="publisher">` — the ONE e-mail address on the page, which
   `22-play-release.js` holds it to. Use the same address as the listing's developer contact. `support.html`,
   beside it, is the page to give wherever a store asks for a support or website address.
2. Merge it to `main`: the page is live only once `main` holds it.
3. Play also wants the policy reachable **from inside the app**, and it is: Membership → Data & privacy →
   **Privacy policy** (`openPrivacyPolicy` in js/settings.js; the native apps open the hosted copy, since the page
   is not bundled). A reviewer of an app that takes another service's password looks here first.

The page is accurate to the code as of September 2026. If the app ever gains analytics, a server, a new
permission or a new host, the page changes in the same commit.

### 5.4 App access
App content → App access → **"All or some functionality is restricted"** → Add instructions. The reviewer cannot
get past the sign-in without an account, and a rejection for "we could not sign in" is the commonest one there is.

- **Make a separate Psycle account for review. Never give your own.** Give it **no class credits and no payment
  card**: a reviewer — or a robot — who presses Book must not be able to spend anything or take a real seat.
- Name: `Psycle member sign-in` · Username: that account's e-mail address · Password: its password.
- "Any other information":
  ```
  Psync is an independent companion app for members of Psycle London (psyclelondon.com). It is not affiliated
  with, or endorsed by, Psycle. It has no accounts of its own: it signs in with an existing Psycle account and
  talks to Psycle's booking system (psycle.codexfit.com) with the member's own credentials, over HTTPS.

  Without signing in: the timetable (the Discover tab) opens and can be browsed and filtered.
  To sign in: tap "Sign in" at the top of the screen, then enter the e-mail address and password given here.
  After signing in: My Bookings, Stats and Membership open. Booking a class spends a class credit on the
  Psycle account; this test account holds none. Everything else can be reviewed with it.

  The app contains no in-app purchases, no subscriptions, no ads and no analytics.
  ```
- **The pre-launch report.** For every bundle on a testing track, Google runs the app on real phones with a robot
  that taps whatever it finds. Signed out it can only read the timetable. **Do not give the pre-launch report
  sign-in credentials** (Testing → Pre-launch report → Settings) unless the account has no credits: Psync talks to
  Psycle's real booking system, and a robot that presses Book and then Confirm has booked a class.

### 5.5 Ads
App content → Ads → **No, my app does not contain ads.**

### 5.6 Content rating
App content → Content rating → start the questionnaire (IARC). E-mail address: yours. Category: **Utility,
productivity, communication or other**. Then every answer is **No**: no violence, no sexual content, no bad
language, no controlled substances, no gambling; members cannot talk to each other or share content with each
other through the app; it does not share the member's location; it sells nothing digital. Expected result:
PEGI 3 / Everyone.

### 5.7 Target audience and content
**18 and over** only. A Psycle account is an adult's, and ticking any younger band brings the Families policy
with it. "Could your store listing unintentionally appeal to children?" — No.

### 5.8 Data safety
The answers, and the facts behind them, are a table in `PLAY_STORE_LISTING.md` → "Data safety". In one line:
**collected** — e-mail address and the actions taken in the app, for app functionality and account management,
encrypted in transit, required; **shared** — nothing; nothing sold; no advertising or analytics use. The app
cannot create an account, so the form's account-deletion questions are answered "my app does not allow users to
create an account"; what a member can delete is on the privacy page. The declaration is yours to make: read it
against Google's definitions on the day.

### 5.9 The other declarations
- **News app** — No.
- **Health apps** — Psync books fitness classes and is listed under Health & Fitness. It reads no health data, no
  sensors and no Health Connect. If the form offers "my app has no health features", that is the true answer; if
  it insists on a feature for the category, "Activity and fitness" is the nearest, and the facts above go in the
  free-text box.
- **Financial features** — "My app does not provide any financial features."
- **Government apps** — No.
- **Advertising ID** — No: the app does not use it, and its manifest does not ask for it.
- No form is needed for the permissions the app has (calendar, notifications, restart after boot for reminders
  and for the class countdown): none is on Google's list of restricted permissions. It asks for no exact-alarm
  access, no location, no foreground service — the countdown is an ordinary, silent notification with an inexact
  alarm, not a foreground service. If a later version adds one of those, Play Console will ask for a declaration.

### 5.10 Store settings
Category **Health & Fitness**; tags from Play's own list; the contact e-mail address again.
Countries: Psycle is in London — **United Kingdom** alone is an honest start, and a small audience is a small risk.

---

## 6. Testing tracks: internal → closed → production

| Track | Who gets it | Google's review | Use it for |
|---|---|---|---|
| **Internal testing** | up to 100 people you list by e-mail address | little or none; minutes | the first upload, and every bundle before anyone else sees it |
| **Closed testing** | lists of e-mail addresses (or Google Groups) you name | yes | the closed test a new personal account must pass (step 1.5) |
| Open testing | anyone with the link | yes | optional; skip it |
| **Production** | everyone in the countries you chose | yes | the release |

Adding testers, on either testing track: Testing → the track → **Testers** tab → Create e-mail list → add the
Google-account addresses (the account on the tester's **phone**) → tick the list → Save. Then **copy the opt-in
link** ("Join on the web") and send it. A tester opens it signed in to that Google account, presses "Become a
tester", and installs Psync from the Play Store like any app. Until they accept, the listing says "not found" for
them; it can take some minutes after a release rolls out.

Tell every tester the two things `ANDROID.md` tells you: **it is the real app on Psycle's real system** — Book,
Cancel, Join and Claim are real — and bug reports come from Membership → Settings → Bug report.

For the closed test of a new personal account: the clock counts days on which the minimum number of testers is
**opted in**, without a break. A tester who leaves stops the count. Line up more people than the minimum.

---

## 7. The first release, and every later one

**First release**
1. Steps 0 to 5 are done: the target level is accepted, the account is verified, the key exists, the secrets are
   set in the `play-release` environment, the listing and every App content form is complete, `privacy.html` names
   you and is live — and the app links to it (step 5.3, point 3), or you have decided to submit without that link,
   knowing a reviewer may refuse.
2. The on-device checklist in `ANDROID.md` has been walked on a real phone with a build from this same commit.
3. Build the bundle (step 4) and download `app-release.aab`.
4. Testing → **Internal testing** → Create new release. The first time, Play asks about **Play App Signing**:
   accept "Google generates the app signing key". Upload the `.aab`. Release name: leave what it offers.
   Release notes (`en-GB`): a line or two. Save → Review release → **Start rollout to Internal testing**.
5. Install it from the Play Store on your own phone through the opt-in link, and walk the checklist's first
   sections again: a Play install is signed by Google's key, not yours, and is the only build that proves sign-in,
   storage and the widget survive that.
6. Read the **pre-launch report** when it arrives (an hour or so): crashes, and screenshots from phones you do
   not own.
7. Closed testing (if your account needs it, step 1.5): Testing → Closed testing → Create track or use "Alpha" →
   **Promote** the internal release to it (no new upload) → add the testers → send the link → wait out the days
   → Dashboard → **Apply for production access**, and answer the questions about the test truthfully.
8. Production → Create new release → promote the tested release → countries → Review → **Start rollout to
   Production**. The first review of a new app can take a week or more.

**Every later release**
1. Bump `versionCode` (always) and `versionName` (when it should show) in `build.gradle`; merge to `main` with the
   work.
2. CI is green on that commit — `Android build check (debug APK)` in particular.
3. Run the release workflow (step 4b), download the bundle, upload it to **Internal testing**, install it, look.
4. Promote it to Production. For an update Play offers a **staged rollout** (a percentage of members first):
   use it, and raise it once the vitals are quiet.
5. If the release changes what the app stores or sends, asks for a new permission, or adds a host: `privacy.html`,
   the Data safety form and `PLAY_STORE_LISTING.md` change **before** the rollout, not after.

A rejected release: read the e-mail and Play Console → **Policy status**, fix, bump `versionCode`, upload again.
Appeals are made from the same page.

---

## 8. After release

- **Crashes and ANRs.** Play Console → Quality → **Android vitals**. Google measures the user-perceived crash rate
  and the ANR ("app not responding") rate against its "bad behaviour thresholds" — about 1 % and 0.5 % when this
  was written; check the page — and demotes apps that stay above them. The app has no crash reporting of its own
  (by design), so vitals and members' bug reports are the only two sources. A JavaScript error inside the web view
  is **not** a native crash and never reaches vitals: it is in the app's own error log, which a bug report carries.
- **Policy e-mails** go to the account owner's address, and also appear under **Policy status** and the Inbox.
  They carry deadlines, often short. Read them the day they arrive; an ignored warning becomes a removal.
- **The target API level moves every year.** Around each August Google raises it, for updates first and then for
  staying visible to new members at all. Put a reminder in your calendar for June: check the page named in step
  0.1, and plan the Capacitor upgrade that carries the new level.
- **Keep the declarations true.** Data safety, the privacy policy, App access (is the review account's password
  still the one you gave?), the content rating: Google re-reviews, and a stale answer is a policy issue.
- **Keep the account alive.** Google closes developer accounts that lie unused; an occasional sign-in, and a
  verified contact address that still reaches you, are enough.
- Ratings and reviews: Play Console → Ratings and reviews. Reply in the same plain voice as the app.

---

## 9. The checklist

**Before anything**
- [ ] The target API level Play asks for today is known (step 0.1), and the project meets it — Route A or B, on a
      branch, compiled by CI, seen on a phone.
- [ ] You have decided about Psycle's permission (step 0.2), knowing what a removal does to a developer account.

**Once**
- [ ] Developer account registered, fee paid, identity and device verified.
- [ ] Upload key made outside the repository; keystore, password and alias in the password manager; a second copy.
- [ ] The `play-release` environment exists: deployment branches `main` only, you as a required reviewer.
- [ ] The four secrets exist IN that environment, and nowhere at repository level: `PSYNC_KEYSTORE_BASE64`,
      `PSYNC_KEYSTORE_PASSWORD`, `PSYNC_KEY_ALIAS`, `PSYNC_KEY_PASSWORD`.
- [ ] `privacy.html` (it names Ajar.dev Ltd and support@ajar.dev) opens at its public address in a private window,
      and so does `support.html`.
- [ ] In the installed app, Membership → Data & privacy → Privacy policy opens that page.
- [ ] A review-only Psycle account exists, with no credits and no card (steps 0.3 and 5.4).
- [ ] The testers for the closed test have been asked, and have said yes (steps 0.3 and 1.5).
- [ ] The six Play screenshots are built (`--play`), looked at, and committed beside the icon and the feature graphic.
- [ ] App created in Play Console; main store listing, graphics, privacy policy, App access, ads, content rating,
      target audience, data safety and the other declarations all show a green tick.

**Every release**
- [ ] `versionCode` is higher than any ever uploaded; `versionName` is right; both are on `main`.
- [ ] CI is green on that commit.
- [ ] The release workflow is green; the summary's certificate fingerprint is your upload key's.
- [ ] `app-release.aab` uploaded to Internal testing; installed from the Play Store on a real phone; looked at.
- [ ] The pre-launch report is read. No credentials were given to it.
- [ ] Anything that changed what the app stores, sends or asks for is already in `privacy.html`, Data safety and
      `PLAY_STORE_LISTING.md`.
- [ ] Promoted; staged rollout for an update; vitals looked at a day later.

**Every year**
- [ ] June: the new target API level is read, and the upgrade that carries it is planned.
