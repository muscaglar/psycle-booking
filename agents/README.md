# agents/ — index of this folder

Notes for an agent or developer arriving cold: what each file answers, the order to read them in, and how to keep
them true. Written to save you time and tokens — read the one file your question needs, not the folder.

**Read this when** you do not yet know which file holds your answer. **Skip this when** you do: go straight there.

## What each file answers

Every top-level file and folder, once. ≈ tokens = bytes ÷ 4, rounded: what the file costs to read whole.

| File | The question it answers | ≈ tokens |
|---|---|---|
| [../AGENTS.md](../AGENTS.md) | What is this repository, what must I never do, which commands prove a change, where next? Start here: its reading guide routes you by task. | 3,150 |
| README.md | This file: what is in the folder, the order to read it in, how to keep it true. | 1,500 |
| [decisions.md](decisions.md) | What has the owner already decided, and why? What is CLOSED and must not be re-offered? | 5,250 |
| [learnings.md](learnings.md) | What went wrong before, and which trap is my change about to step into? Its first 20 lines, then one section. | 8,700 |
| [playbooks.md](playbooks.md) | How do I carry out a common task safely, step by step? P0 and the one playbook; its contents table gives each one's size. | 10,300 |
| [ontology.md](ontology.md) | What does this word mean here? The domain and code vocabulary, the state machines, the invariants. Grep it, or read one section (sizes in its opening lines). | 8,700 |
| [repo-map.md](repo-map.md) | Where does X live? The file tree, the script load order, and "I want to… → edit this file". | 4,950 |
| [architecture/](architecture/) | How does this mechanism work? One file per area — read only the one your task touches. | 46,000 in all |
| [index/](index/) | On which line is this symbol, marker or suite? GENERATED, and the only place line numbers are written. Grep it; never read it whole. | 70,500 in all |
| [tools/](tools/) | What builds the index, and what proves the split lost nothing? Two dependency-free scripts: run them, do not read them. | below |

CLAUDE.md at the repository root is a four-line pointer to AGENTS.md. What it used to hold was moved, verbatim, into
architecture/ and repo-map.md.

### architecture/ and index/

One fact, one home — their files are not listed a second time here:
- architecture/ — 28 files. AGENTS.md's reading guide routes to each by task and gives each one's size.
  architecture/README.md maps the section titles of the former CLAUDE.md to them, for an older comment that says
  "CLAUDE.md → section".
- index/ — 27 generated files. index/README.md lists them with their lengths, says how to grep them and how fresh
  they are. symbols/ holds one file per script, in load order.

### tools/

| File | What it does | ≈ tokens |
|---|---|---|
| build-index.mjs | Writes index/ from the code: `npm run agents:index`. `npm run agents:check` exits 1 and names the files a rebuild would change. | 25,500 |
| check-split.mjs | Proves that every line of the former CLAUDE.md is in exactly one file here: `node agents/tools/check-split.mjs`. | 1,750 |

## The first five minutes

1. [../AGENTS.md](../AGENTS.md) — the rules and the commands.
2. [decisions.md](decisions.md) — what not to reopen.
3. [learnings.md](learnings.md) — its first 20 lines (the header and the eleven-point "Cheapest useful read" list),
   then the section for your area.
4. The ONE file in [architecture/](architecture/) for your task.
5. [index/](index/) for the line number, then open the code there.

Stop as soon as you can act. [repo-map.md](repo-map.md), [ontology.md](ontology.md) and
[playbooks.md](playbooks.md) are look-ups, not reading.

## Keeping this folder true

- **Text moves with the code.** A commit that renames, moves or deletes a function, a `pure:` marker, a suite, a
  storage key or a file also updates the agents/ file that names it.
- **The index is regenerated, never edited by hand**: `npm run agents:index`, then commit the result.
  `npm run agents:check` must exit 0 — and nothing runs it for you: it is not part of `npm run ci` or of CI. Rebuild
  before committing ANY edit that adds or removes a line in js/, css/, the HTML shells, native-bridge.js, Swift or
  tests/suites; `npm test` notices only when one of ten sampled symbols has moved (then it fails until you rebuild).
- **Line numbers live only in index/.** Everywhere else, give the symbol and the file: line numbers drift.
- **A decision is added to decisions.md the day it is made**, in the owner's own words, with its reason and the
  code or test that holds it.
- **Only names that exist.** If it is not in the code, it is not in these files: a reader will grep for it.
- **One fact, one home.** Link to the file that owns a fact; do not restate it.
- **A new, renamed or deleted file changes ONE list**: AGENTS.md's reading guide for a file under architecture/,
  the table above for a top-level file or a tool (a top-level file is in both). Correct a file's ≈ tokens when it
  grows or shrinks by a quarter. tests/suites/16-agents-docs.js fails when a list names a file that is not there,
  misses one that is, or is badly out on a size.
- **Search with `git grep`**, not `grep -r`: untracked folders at the repository root (a tool's worktrees,
  node_modules) can hold whole copies of the repository, and every hit then comes back many times over.
- **Every file opens the same way**: a title, its purpose, then when to read it and when to skip it, all within
  its first few lines. Tables and one-line bullets before paragraphs. As short as it can be while staying exact.
- **Nothing machine-specific or personal, ever — the repository is public.** No paths outside the repo, no
  hostnames beyond psycle.codexfit.com, github.com and public documentation, no registry or proxy names, no
  account names or emails, no member data, and nothing about how a particular working session was run.
- British spelling, plain sentences, no exclamation marks, no emoji.
