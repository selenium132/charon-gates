# Charon
Release gates for AI agents: no measured PASS, no release. Skeleton Crew entry, two apps: `apps/ghost-viewer/`, `apps/seance/`.

1. Open https://charon-gates.pages.dev/apps/ghost-viewer/ and press a sample button. No file, no login.
2. Open https://charon-gates.pages.dev/apps/seance/ and press "The ghost", then "The real thing". Scan view: https://charon-gates.pages.dev/apps/ghost-viewer/scan.html
3. Run `npm run install:all && npm test`.

## Kiro spec to running code

| Kiro artifact | What it makes | Result you can run |
|---|---|---|
| `.kiro/specs/charon-core/` (requirements, design, tasks) | `skeleton/core/`, `skeleton/cli/charon.js` | `skeleton` tests: 99 pass, 0 fail |
| `.kiro/specs/ghost-viewer/` | `apps/ghost-viewer/gate.js` (9 checks) | `node --test gate.test.js scan-timeline.test.js`: 38 pass |
| `.kiro/specs/seance/` | `apps/seance/gate.js` (7 checks) | `node --test` in `apps/seance`: 36 tests |
| `.kiro/specs/toll-fixes/bugfix.md` | `skeleton/hooks/pre-release.js` fixes D5-D8 | `skeleton/hooks/hooks.test.js` |
| `.kiro/hooks/toll-gate.json` (PreToolUse) | runs `skeleton/hooks/pre-release.js` before shell and write tools | `echo '{"tool_name":"execute_bash","tool_input":{"command":"npm publish"}}' \| node skeleton/hooks/pre-release.js` prints `BLOCKED: no current PASS or override ...`, exit 2; `ls` exits 0 |
| `.kiro/agents/ferryman.json` (read-only reviewer) | findings F1-F9 on the Toll rules | fixes in git log: F1-F3, F4/F6/F7, F8, F9 |
| `.kiro/hooks/test-on-save.json`, `.kiro/settings/mcp.json`, `.kiro/steering/` | tests on save; `skeleton/mcp/server.js` (`judge`, `ledger_tail`); product and tech rules | see `KIRO_WRITEUP.md` |

Claude Code wrote the two steering files and did the hand fixes, `scan.html` and the F8 prompt guard; `KIRO_WRITEUP.md` lists which.


---

## What the skeleton is

The skeleton lives in `skeleton/` and has four layers:

| Layer | Path | Purpose |
|---|---|---|
| Core | `skeleton/core/` | Hashing, judgement, ledger, override. Zero runtime dependencies. Runs in Node and the browser. |
| Web | `skeleton/web/` | localStorage ledger adapter and verdict renderer for browser apps. |
| CLI | `skeleton/cli/` | `charon` command: runs a gate file against an artifact and appends the verdict. |
| MCP server | `skeleton/mcp/` | Exposes `judge` and `ledger_tail` as Model Context Protocol tools so an agent can check its own artifacts. |

The Toll is five rules every gate obeys. It is explained in `skeleton/README.md` and enforced by the core.

Two example apps are built on the skeleton:

- `apps/ghost-viewer/`: pre-publish gate for vertical short videos.
- `apps/seance/`: pre-submission gate for machine learning competitions.

---

## How to make a third gate in about 20 lines

A gate is one exported `GATE_DEF` object and however many check factories you need.
Each check is a pure function from an evidence object to a `Finding`.

```js
// apps/my-gate/gate.js
import { judge } from '../../skeleton/core/index.js';

function makeScoreCheck(p) {
  function check(ev) {
    const ok = ev.score >= p.minScore;
    return {
      checkId: 'score-threshold',
      measured: ev.score,
      threshold: p.minScore,
      unit: 'score',
      passed: ok,
    };
  }
  check.checkId = 'score-threshold';
  check.params = { minScore: p.minScore };
  return check;
}

export const GATE_DEF = {
  id: 'my-gate',
  version: '1.0.0',
  checks: [makeScoreCheck({ minScore: 0.9 })],
};
```

Then call `judge(GATE_DEF, evidence, artifactBytes)` and you have a `Verdict`.
Wire a `createLocalStorageLedger` to store it, or use the CLI / MCP server from the skeleton.

---

## How to run the tests

Node 20 or newer. From the repository root:

```sh
npm run install:all   # installs fast-check (dev only) in the three packages
npm test              # skeleton (core, CLI, hooks, MCP) + ghost-viewer + seance
```

Each package also runs on its own: `cd skeleton && node --test`, or `cd apps/seance && npm test`.

Tests use the built-in `node:test` runner. Property tests use `fast-check` (dev dependency only).

---

## Try the apps

Both apps are static pages: no server code, no account, no key. Nothing leaves the browser.

```sh
python3 -m http.server 8000     # from the repository root, any static server works
# open http://localhost:8000/ and choose a door
```

- `apps/ghost-viewer/`: drop a vertical video, or press a sample button (cursed: 5 of 9 checks fail; clean: PASS; no sound track: HOLD).
- `apps/seance/`: press "The ghost" (FAIL) or "The real thing" (PASS), or paste your own paired scores.

---

## How to enable the Kiro hooks

Two hooks live in `.kiro/hooks/`:

- `toll-gate.json` (PreToolUse): before the agent runs a shell command or writes a file, it runs
  `skeleton/hooks/pre-release.js`. If the command matches `releasePattern` in `charon-hook.json` and the ledger has
  no current PASS (or named override) for the artifact and gate, the hook exits with code 2 and the call is blocked.
- `test-on-save.json` (PostFileSave): runs the skeleton tests when a skeleton file is saved.

Edit `charon-hook.json` (`artifactPath`, `gatePath`, `releasePattern`) to point at your own gate.
`skeleton/hooks/charon-hook.example.json` is a template.

---

## How to enable the MCP server

The MCP server in `skeleton/mcp/server.js` exposes two tools:

- `judge`: run a gate against an artifact and return the verdict.
- `ledger_tail`: read the last N entries from the ledger.

To register it in Kiro, add an entry to `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "charon": {
      "command": "node",
      "args": ["skeleton/mcp/server.js"],
      "disabled": false
    }
  }
}
```

Then restart or reconnect the MCP server from the Kiro panel. This repository already ships that entry in
`.kiro/settings/mcp.json`.

---

## How it was built

Built with Kiro (CLI, spec mode) and reviewed and fixed with Claude Code. The split:

- Written by Claude Code, from the author's brief: the steering files in `.kiro/steering/`.
- Generated with Kiro from those steering files: the specs in `.kiro/specs/` (requirements, design, tasks), the core,
  the apps, the tests, the hooks and the `ferryman` agent.
- Done with Claude Code: running the result for real, finding defects (recorded as the bugfix specs
  `toll-fixes` and `field-test-fixes`), and implementing the last fixes after the Kiro free quota ran out.
- One real example: the hook Kiro wrote read `toolName`, but the Kiro CLI sends `tool_name`. All 46 tests passed and
  the hook blocked nothing. A run in the real CLI showed it; the fix is task T5 (defect D5) in `toll-fixes`.

The specs in `.kiro/specs/` keep the original design as Kiro wrote it. Where a later bugfix spec changed something (for example the gate hash now covers check parameters and source), the bugfix spec is the current rule and the code and tests match it.

Of the Kiro products, only Kiro CLI was used. Kiro IDE, Web, Crew and powers were not.

---

## Pre-existing work and tools

Third-party dependency: `fast-check` (dev dependency only, not included in any production
bundle). Used for property-based testing in `gate.test.js` files.

Prior work: The ideas for these gates came from the author's own earlier private scripts
for checking competition submissions and video quality. No code from those scripts is
included here. All code in this repository was written from scratch for this project.

No other third-party code, training data, or statistics about users appear in this repository.

---

## Limits (what Charon does not claim)

- The ledger is a hash chain, not a signature. It detects an edit in the middle of the file, but anyone who can write the whole file can rebuild it from the start. What stops an agent is the PreToolUse hook (`skeleton/hooks/pre-release.js`), not the ledger. Keep the ledger outside the agent's write permissions if you need more.
- The hook only sees tool calls the agent runtime reports. It blocks on exit code 2; any other non-zero exit lets the call through, which is why the hook command ends in `|| exit 2`.
- ghost-viewer thresholds are the author's estimates, not platform figures. The UI-band fractions (top 8%, bottom 20%, right 12%) were tuned on a handful of videos. The false-positive rate has not been measured.
- seance uses a normal approximation on paired differences. With few pairs it is generous; the `sample-size` check exists to refuse that case.
- The hook's ledger-write guard matches common shell patterns (a redirect, `--ledger <path>`, `appendFile`). It does not parse shell, so a determined agent can find another way to write the file. Keep the ledger outside the agent's write permissions if that matters.
