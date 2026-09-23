# agents/ — index of this folder

Notes for an agent or developer arriving cold: what each file answers, the order to read them in, and how to keep
them true. Written to save you time and tokens — read the one file your question needs, not the folder.

**Read this when** you do not yet know which file holds your answer. **Skip this when** you do: go straight there.

## What each file answers

Every top-level file and folder, once. ≈ tokens = bytes ÷ 4, rounded: what the file costs to read whole.

| File | The question it answers | ≈ tokens |
|---|---|---|
| [../AGENTS.md](../AGENTS.md) | What is this repository, what must I never do, which commands prove a change, where next? Start here: its reading guide routes you by task. | 3,900 |
| README.md | This file: what is in the folder, the order to read it in, how to keep it true. | 2,050 |
| [decisions.md](decisions.md) | What has the owner already decided, and why? What is CLOSED and must not be re-offered? | 8,600 |
| [HANDOVER.md](HANDOVER.md) | Where do things stand? The session log (newest first), how to check what `main` holds, what is and is not proved, what is the owner's, your first hour. | 8,400 |
| [backlog.md](backlog.md) | What could be done next? Candidate work with a size and a risk — propose from it, never start from it. | 5,750 |
| [learnings.md](learnings.md) | What went wrong before, and which trap is my change about to step into? Its first 20 lines, then one section. | 12,300 |
| [playbooks.md](playbooks.md) | How do I carry out a common task safely, step by step? P0 and the one playbook; its contents table gives each one's size. | 14,100 |
| [ontology.md](ontology.md) | What does this word mean here? The domain and code vocabulary, the state machines, the invariants. Grep it, or read one section (sizes in its opening lines). | 8,700 |
| [repo-map.md](repo-map.md) | Where does X live? The file tree, the script load order, and "I want to… → edit this file". | 6,950 |
| [architecture/](architecture/) | How does this mechanism work? One file per area — read only the one your task touches. | 64,500 in all |
| [index/](index/) | On which line is this symbol, marker, suite, test section or Java type? GENERATED, and the only place line numbers are written. Grep it; never read it whole. | 98,500 in all |
| [tools/](tools/) | What builds the index, and what proves the split lost nothing? Two dependency-free scripts: run them, do not read them. | below |

CLAUDE.md at the repository root is a four-line pointer to AGENTS.md. What it used to hold was moved, verbatim, into
architecture/ and repo-map.md.

Six folders carry a guide of their own: the rules local to that folder, at most 80 lines, with a CLAUDE.md pointer
of at most 3 lines beside it. Read one when you first open a file in its folder.

| Folder guide | Local rules for | ≈ tokens |
|---|---|---|
| [../js/AGENTS.md](../js/AGENTS.md) | the 15 modules: wrappers and the `apiFetch` replacement, spend paths, sliced functions, `pure:` blocks, the one global scope, gym time | 1,950 |
| [../css/AGENTS.md](../css/AGENTS.md) | the 9 stylesheets: link order, crisp.css tokens only, the light-base tie, safe-area insets, `[data-ct]`, the one card | 1,800 |
| [../tests/AGENTS.md](../tests/AGENTS.md) | the runner, the suites, the smoke page, the fake Psycle server | 2,400 |
| [../ios-app/AGENTS.md](../ios-app/AGENTS.md) | the build into www/ (both native apps ship it), the plugin patcher, the bridge: `SYNC_KEYS`, gym time, the calendar deleters, `IS_ANDROID`, the plugin twins | 2,100 |
| [../ios-app/ios/App/AGENTS.md](../ios-app/ios/App/AGENTS.md) | the Xcode project and the Swift: the simulator build, target membership, `Codable` fields, dates, widget layouts | 2,250 |
| [../ios-app/android/AGENTS.md](../ios-app/android/AGENTS.md) | the Android Gradle project: CI is the compiler, what is generated, the Back contract, backups off, no secrets, the names other files hold, the widget's traps (plugin twins, RemoteViews, the untrusted tap, the pure classes and the XML numbers they copy), the class countdown's (one silent notification that must not outstay its class; its debug hook and CI's script are one contract) | 4,900 |

### architecture/ and index/

One fact, one home — their files are not listed a second time here:
- architecture/ — 29 files. AGENTS.md's reading guide routes to each by task and gives each one's size.
  architecture/README.md maps the section titles of the former CLAUDE.md to them, for an older comment that says
  "CLAUDE.md → section".
- index/ — 29 generated files. index/README.md lists them with their lengths, says how to grep them and how fresh
  they are. symbols/ holds one file per script, in load order.

### tools/

| File | What it does | ≈ tokens |
|---|---|---|
| build-index.mjs | Writes index/ from the code: `npm run agents:index`. `npm run agents:check` exits 1 and names the files a rebuild would change. | 29,200 |
| check-split.mjs | Proves that every line of the former CLAUDE.md is in exactly one file here: `node agents/tools/check-split.mjs`. A line edited since the split is listed, not failed. | 2,200 |

## The first five minutes

For ONE task (the usual case) — about 6,000 tokens, not the folder:
1. [../AGENTS.md](../AGENTS.md) — the rules and the commands (it is already loaded for most assistants).
2. The ONE row of its reading guide for your task → that file in [architecture/](architecture/), one section of it.
3. `grep -n -i "<feature>" decisions.md` — what not to reopen. Read the rows it finds, not the file.
4. The folder guide — the AGENTS.md of the folder you will edit in (the table above).
5. [index/](index/) for the line number, then open the code there.

Picking the PROJECT up after a gap, add: [HANDOVER.md](HANDOVER.md) — the newest session-log entry, then
"Verified / not verified" — and [learnings.md](learnings.md): its first 20 lines, then the section for your area.

Stop as soon as you can act. [repo-map.md](repo-map.md), [ontology.md](ontology.md),
[playbooks.md](playbooks.md) and [backlog.md](backlog.md) are look-ups, not reading.

## Keeping this folder true

- **Text moves with the code.** A commit that renames, moves or deletes a function, a `pure:` marker, a suite, a
  storage key or a file also updates the agents/ file that names it.
- **The index is regenerated, never edited by hand**: `npm run agents:index`, then commit the result.
  `npm run agents:check` must exit 0 — and nothing fails for you: it is not part of `npm run ci`, and CI runs it as an
  advisory step only. Rebuild before committing ANY edit that adds or removes a line in js/, css/, the HTML shells,
  native-bridge.js, Swift, the Android app's Java, tests/unit.js or tests/suites (the Java is in index/java.md; the
  Android project's XML and Gradle files are not indexed); `npm test` prints
  one advisory line when one of its samples (ten symbols, one test section, one Java method) has moved, and fails
  only when an index file or one of those samples is missing.
- **Line numbers live only in index/.** Everywhere else, give the symbol and the file: line numbers drift.
- **A decision is added to decisions.md the day it is made**, in the owner's own words, with its reason and the
  code or test that holds it.
- **Only names that exist.** If it is not in the code, it is not in these files: a reader will grep for it.
- **One fact, one home.** Link to the file that owns a fact; do not restate it.
- **A folder guide changes with its folder**: local rules only, at most 80 lines, links written relative to it.
- **A new, renamed or deleted file changes ONE list**: AGENTS.md's reading guide for a file under architecture/,
  the tables above for a top-level file, a tool or a folder guide (a top-level file is in both). Correct a file's
  ≈ tokens when it grows or shrinks by a quarter. tests/suites/16-agents-docs.js fails when a list names a file
  that is not there, misses one that is, or is badly out on a size.
- **Search with `git grep`**, not `grep -r`: untracked folders at the repository root (a tool's worktrees,
  node_modules) can hold whole copies of the repository, and every hit then comes back many times over.
- **Every file opens the same way**: a title, its purpose, then when to read it and when to skip it, all within
  its first few lines. Tables and one-line bullets before paragraphs. As short as it can be while staying exact.
- **Nothing machine-specific or personal, ever — the repository is public.** No paths outside the repo, no
  hostnames beyond psycle.codexfit.com, github.com and public documentation, no registry or proxy names, no
  account names or emails, no member data, and nothing about how a particular working session was run.
- British spelling, plain sentences, no exclamation marks, no emoji.
