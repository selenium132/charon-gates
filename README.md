# Charon

A skeleton template for building **evidence gates**: small programs that decide whether an
artifact may leave the workshop, and whose verdict an AI agent cannot talk its way past.

---

## What the skeleton is

The skeleton lives in `skeleton/` and has four layers:

| Layer | Path | Purpose |
|---|---|---|
| Core | `skeleton/core/` | Hashing, judgement, ledger, override. Zero runtime dependencies. Runs in Node and the browser. |
| Web | `skeleton/web/` | localStorage ledger adapter and verdict renderer for browser apps. |
| CLI | `skeleton/cli/` | `charon` command: runs a gate file against an artifact and appends the verdict. |
| MCP server | `skeleton/mcp/` | Exposes `judge` and `ledger_tail` as Model Context Protocol tools so an agent can check its own artifacts. |

The Toll — five rules every gate obeys — is explained in `skeleton/README.md` and enforced by the core.

Two example apps are built on the skeleton:

- `apps/ghost-viewer/` — pre-publish gate for vertical short videos.
- `apps/seance/` — pre-submission gate for machine learning competitions.

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

## How to enable the Kiro hook

The hook at `.kiro/hooks/` (or `charon-hook.json` at the project root) fires when a
file is saved and runs the gate against the changed artifact. Edit the hook file to
point at the gate you want to use.

See `skeleton/hooks/charon-hook.example.json` for a working template.

---

## How to enable the MCP server

The MCP server in `skeleton/mcp/server.js` exposes two tools:

- `judge` — run a gate against an artifact and return the verdict.
- `ledger_tail` — read the last N entries from the ledger.

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

Then restart or reconnect the MCP server from the Kiro panel.

---

## Pre-existing work and tools

**Third-party dependency**: `fast-check` (dev dependency only, not included in any production
bundle). Used for property-based testing in `gate.test.js` files.

**Prior work**: The ideas for these gates came from the author's own earlier private scripts
for checking competition submissions and video quality. No code from those scripts is
included here. All code in this repository was written from scratch for this project.

No other third-party code, training data, or statistics about users appear in this repository.

---

## Limits (what Charon does not claim)

- **The ledger is a hash chain, not a signature.** It detects an edit in the middle of the file, but anyone who can write the whole file can rebuild it from the start. What stops an agent is the PreToolUse hook (`skeleton/hooks/pre-release.js`), not the ledger. Keep the ledger outside the agent's write permissions if you need more.
- **The hook only sees tool calls the agent runtime reports.** It blocks on exit code 2; any other non-zero exit lets the call through, which is why the hook command ends in `|| exit 2`.
- **ghost-viewer thresholds are the author's estimates**, not platform figures. The UI-band fractions (top 8%, bottom 20%, right 12%) were tuned on a handful of videos. The false-positive rate has not been measured.
- **seance uses a normal approximation** on paired differences. With few pairs it is generous; the `sample-size` check exists to refuse that case.
