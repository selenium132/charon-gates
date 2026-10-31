# Charon Core — Tasks

Tasks are ordered so that each builds on the last. Complete them in sequence.  
Each task ends with a passing test run (`node --test`) unless noted otherwise.

---

## Task 1 — Scaffold the skeleton package

- [x] Create `skeleton/package.json` with `"type": "module"`, `"name": "@charon/skeleton"`, and dev dependency `fast-check`.
- [x] Create `skeleton/core/types.js` containing only JSDoc `@typedef` blocks for `Evidence`, `Check`, `Finding`, `GateDef`, `Verdict`, and `LedgerEntry` (no runtime code).
- [x] Create `skeleton/core/index.js` as an empty barrel (will be populated in later tasks).
- [x] Verify: `node --input-type=module <<< 'import "./skeleton/core/index.js"'` exits 0.

**Acceptance**: package exists, `"type":"module"` is set, `types.js` parses without error, `index.js` imports cleanly.

---

## Task 2 — Implement `core/hash.js`

- [x] Implement `artifactHash(bytes: Uint8Array): Promise<string>` using `globalThis.crypto.subtle.digest('SHA-256', bytes)`.
- [x] Implement `gateHash(gateDef: GateDef): Promise<string>` — serialise `{ id, version, checks: checkIds }` with sorted keys, UTF-8 encode, SHA-256.
- [x] Export both from `core/index.js`.
- [x] Write unit tests in `skeleton/core/hash.test.js`:
  - Known-vector test: SHA-256 of empty bytes equals the known constant.
  - Known-vector test: `gateHash` of a fixed `GateDef` equals a precomputed constant.
  - Property test (P3): for two distinct `Uint8Array` inputs, `artifactHash` returns distinct strings.
  - Property test (P3b): for two `GateDef`s differing in `id`, `gateHash` returns distinct strings.

**Acceptance**: all tests pass, no `crypto` import from Node `crypto` module.

---

## Task 3 — Implement `core/judge.js`

- [x] Implement `judge(gateDef, evidence, artifactBytes): Promise<Verdict>` following the design (§3.2): run all checks, collect findings, compute status with HOLD dominance.
- [x] Export from `core/index.js`.
- [x] Write unit tests in `skeleton/core/judge.test.js`:
  - Unit: all-passing checks → PASS.
  - Unit: one failing check → FAIL.
  - Unit: null evidence → HOLD.
  - Unit: throwing check → HOLD.
  - Unit: check returning `measured: null` → HOLD.
  - Unit: verdict contains `artifactHash`, `gateHash`, `findings`, `ts`.
  - Property test (P1): `judge(gateDef, null, bytes)` always returns HOLD.
  - Property test (P6): HOLD dominates FAIL when mixed check outcomes contain a null measured value.
  - Property test (P2): every finding in a non-throwing verdict has `checkId`, `measured`, `threshold` fields.

**Acceptance**: all tests pass.

---

## Task 4 — Implement `core/ledger.js`

- [x] Implement `createLedger(readLines, appendLine)` returning `{ append, verify, tail }` following the design (§3.3).
- [x] Export from `core/index.js`.
- [x] Write unit tests in `skeleton/core/ledger.test.js`:
  - Unit: first entry has `prevHash === 'GENESIS'`.
  - Unit: second entry's `prevHash` equals SHA-256 hex of the first raw line.
  - Unit: `verify()` on an untampered ledger returns `{ ok: true, firstBadIndex: null }`.
  - Unit: `verify()` on a tampered line returns `{ ok: false, firstBadIndex: n }`.
  - Unit: `tail(2)` on a 5-entry ledger returns last 2 entries.
  - Property test (P4): appending n ≥ 2 entries then mutating one non-last line causes verify to return `ok: false`.
  - Property test (P7): appending n ≥ 0 entries and calling verify always returns `ok: true`.

**Acceptance**: all tests pass, ledger uses only the two supplied callbacks (no direct fs calls).

---

## Task 5 — Implement `core/override.js`

- [x] Implement `buildOverrideEntry(verdict, reason, humanId)` following the design (§3.4).
- [x] Export from `core/index.js`.
- [x] Write unit tests in `skeleton/core/override.test.js`:
  - Unit: valid call returns entry with `type: 'override'`, correct `artifactHash`, `gateHash`, `humanId`, `reason`, `originalStatus`.
  - Unit: empty-string `humanId` throws `"override requires a named human"`.
  - Unit: `null` `humanId` throws.
  - Unit: `undefined` `humanId` throws.
  - Property test (P5, fail case): arbitrary empty-or-nullish `humanId` always throws.
  - Property test (P5, pass case): arbitrary non-empty `humanId` always returns a valid override entry.

**Acceptance**: all tests pass.

---

## Task 6 — Implement `cli/charon.js`

- [x] Create `skeleton/cli/charon.js` as an ESM bin script with `#!/usr/bin/env node`.
- [x] Implement `judge`, `verify-ledger`, and `override` sub-commands following the design (§3.5).
- [x] Wire up Node `fs/promises` callbacks to `createLedger` for `--ledger` usage.
- [x] Add `"bin": { "charon": "./cli/charon.js" }` to `skeleton/package.json`.
- [x] Write integration tests in `skeleton/cli/cli.test.js` using `node:child_process` `spawn`:
  - `judge` with a fixture artifact and gate → stdout contains valid verdict JSON, exit code matches status.
  - `judge --ledger` → ledger file created, contains the verdict line.
  - `verify-ledger` on a valid ledger → `{ ok: true }`, exit 0.
  - `verify-ledger` on a corrupted ledger → `{ ok: false }`, exit 1.
  - `override` with valid `--human` → override entry appended, exit 0.
  - `override` without `--human` → exit 2, stderr non-empty.

**Acceptance**: all tests pass, `charon --help` (or unknown sub-command) prints usage to stderr and exits 2.

---

## Task 7 — Implement `mcp/server.js`

- [x] Create `skeleton/mcp/server.js` implementing MCP 2024-11-05 stdio transport (JSON-RPC 2.0).
- [x] Handle `initialize`, `tools/list`, and `tools/call` for `judge` and `ledger_tail`.
- [x] Handle missing required parameters with a structured MCP error response.
- [x] Write unit tests in `skeleton/mcp/mcp.test.js` by spawning the server and sending JSON-RPC messages over stdio:
  - `initialize` → valid `protocolVersion` and `serverInfo`.
  - `tools/list` → contains both `judge` and `ledger_tail`.
  - `tools/call judge` with valid params → verdict in result.
  - `tools/call ledger_tail` with valid params → entries array in result.
  - `tools/call judge` with missing `artifactPath` → `isError: true` in response.

**Acceptance**: all tests pass, server does not crash on malformed input.

---

## Task 8 — Implement `hooks/pre-release.js`

- [x] Create `skeleton/hooks/pre-release.js` following the design (§3.7).
- [x] Document the `charon-hook.json` sidecar format in a comment block at the top of the file.
- [x] Create `skeleton/hooks/charon-hook.example.json` as a reference config.
- [x] Write unit tests in `skeleton/hooks/hooks.test.js` using an in-memory ledger and fake hook payloads:
  - Payload is not a release command → exit 0.
  - Payload is a release command, ledger has matching PASS → exit 0, stdout `{}`.
  - Payload is a release command, ledger has no matching PASS → exit 2, stderr non-empty.
  - Payload is a release command, ledger has an override for the artifact → exit 0.
  - Ledger file does not exist → exit 2, stderr non-empty.

**Acceptance**: all tests pass; the hook script can be wired into `.kiro/hooks/pre-release.json` by any consuming repo.

---

## Task 9 — Integration smoke test and line-count check

- [ ] Run the full test suite from `skeleton/`: `node --test skeleton/**/*.test.js`.
- [ ] Count non-test, non-blank source lines across `skeleton/` (core + cli + mcp + hooks). Confirm the count does not exceed 600.
- [ ] If over budget, trim and document the reason before proceeding.
- [ ] Create `skeleton/README.md` with:
  - One-paragraph description of what Charon is.
  - Quick-start for using the skeleton to build a new gate.
  - The five Toll rules (verbatim from product steering).
  - Brief description of each CLI sub-command and MCP tool.
  - A note that the skeleton is a template, not a published package.

**Acceptance**: all tests pass, line count ≤ 600, README exists and is accurate.
