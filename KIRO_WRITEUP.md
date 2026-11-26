# Built with Kiro

My AI agent once called a video done when it had a black opening and no sound. Charon makes the agent show a measured PASS before anything is released. I used the Kiro CLI on the free plan; not the IDE, Web, Crew or powers. Two apps (Ghost Viewer, Seance) sit on one skeleton.

## Who built what

Kiro CLI wrote the specs, the skeleton, both apps, the hooks, the MCP server, the custom agent file and their tests. Everything Kiro produced is in `.kiro/`.

Claude Code, a separate tool, did the rest: the two steering files, written from my brief before any spec; hand fixes for Ferryman findings F1 to F4, F6, F8, F9 and part of F7; the implementation of `field-test-fixes` after the Kiro credits ran out; the Ghost Viewer scan view (`scan.html`, `scan-timeline.js`); the demo capture scripts; this write-up.

## What Kiro did

**Steering.** `product.md` and `tech.md`, written before any spec (with Claude Code, from my brief) and loaded in every Kiro run. The rule that mattered most: no evidence means HOLD, never PASS. Every spec and test refers to it.

**Specs.** Three feature specs (`charon-core`, `ghost-viewer`, `seance`) and two bugfix specs (`toll-fixes`, `field-test-fixes`). Work done from a spec came back with tests and tasks I could check. `field-test-fixes` was finished by hand after the credits ran out, and its task file says so. I did not run the same task without a spec, so I make no speed claim.

**Hooks.** `toll-gate` runs before any tool call that could release something and exits with code 2 unless the ledger holds a PASS for that artifact. `test-on-save` re-runs the tests when a skeleton file is saved.

**MCP.** A local server exposes `judge` and `ledger_tail`, so an agent can check its own artifact and read the ledger.

**Custom agent.** Ferryman is read-only and hunts for ways around the five rules. Its first run failed: the agent file listed the MCP server as an array, the CLI wants a map. After the fix it reported 9 findings (table below).

**Property-based testing.** fast-check, by hand, in the app tests. This is not the IDE's Correctness feature, which the CLI does not have.

## Screens

Both apps run in a browser on built-in synthetic samples: no upload, no server, no login. Ghost Viewer shows each check with its measured value and threshold; a sample with no sound track gives HOLD on silence and PASS on the other eight. Its scan view (`scan.html`) moves a playhead across three lanes and turns a lane red the moment it passes its limit. Seance shows "The ghost" failing four of seven checks and "The real thing" passing. Captures are in `docs/shots/`.

## Two bugs that "done" hid

1. The hook Kiro wrote read `toolName`; the real payload says `tool_name`. All 46 tests passed and the hook blocked nothing. Running the real CLI found it. The fix is a spec.
2. A task list showed all six items checked after a rate limit stopped the run, and the code was unchanged. Seance's two sample screens both showed HOLD while its 35 tests passed. Each time I added a test that goes through the real path.

## Ferryman's 9 findings (run 2026-11-11)

F1 to F4, F6 and F9 fixed by hand on 2026-11-20 and 21. F8 fixed on 2026-11-26 (prompt goes to stderr; refused unless stdin and stderr are both a TTY; unit-tested, not tried in a live terminal). F7 partly. F5 and the cross-process part of F7 are open.

| ID | Where | Rule | Finding |
|---|---|---|---|
| F1, F2 (fixed) | `cli/charon.js` | 1 | A failed evidence read became `{}`, so checks ran on empty evidence. Now null, and judge gives HOLD. |
| F3 (fixed) | `core/judge.js` | 2 | A verdict could PASS without `checkId` or `threshold`. Now HOLD. |
| F4 (fixed) | `core/hash.js` | 3 | A gate without `id` or `version` could hash like another gate. Now `gateHash` throws. |
| F5 | `cli/charon.js` | 3 | Hashing assumes a full, unsliced buffer (not triggered today). |
| F6 (fixed), F7 (partly) | `core/ledger.js` | 4 | `tail()` dropped unreadable lines; now returns them as `{ corrupt: true }`. `append()` is serialised inside one process; two processes can still race. |
| F9 (fixed) | `hooks/pre-release.js` | 5 | The hook matched raw command text, so `tee`, `cp`, `mv`, `sed -i`, quoted paths and split names got past it. Quotes, backslashes and empty expansions are now stripped, and any write verb next to the ledger path blocks. Reading stays allowed. |
| F8 (fixed) | `cli/charon.js` | 5 | The override prompt could hide itself when output was redirected. Now it goes to stderr and needs a TTY on stdin and stderr. |
