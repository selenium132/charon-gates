# Toll-Fixes: Bug Report

Eight defects allow the Toll to be violated. All 46 existing tests pass despite them.

---

## D1 — gateHash omits check params and function source

**Current behaviour**  
`gateHash` serialises only `{ checks: [checkId, …], id, version }`.  
Changing a check's `params` object or its `fn` body produces the same hash.  
An old PASS verdict therefore remains valid for a loosened gate.

**Expected behaviour**  
Hash each check's `checkId`, its optional `params` object (keys sorted), and `fn.toString()`.  
Any change to a params value must change the gate hash (property test required).

**Unchanged behaviour**  
`artifactHash` is unaffected. The hash is still a 64-character lowercase hex SHA-256.

---

## D2 — zero-check gate returns PASS

**Current behaviour**  
`judge` with `gateDef.checks = []` iterates nothing, never sets `anyFail` or `forceHold`, and returns `PASS`.

**Expected behaviour**  
A gate with zero checks is vacuously unverified evidence. Return `HOLD`.

**Unchanged behaviour**  
A gate with one or more all-passing checks still returns `PASS`.  
`null` evidence still returns `HOLD` before checks are run.

---

## D3 — NaN/Infinity measured and non-boolean passed are accepted

**Current behaviour**  
`judge` treats `NaN` and `Infinity` as truthy non-null values, so they count as valid evidence.  
A `passed` value that is not boolean is used directly with `!finding.passed` without validation.

**Expected behaviour**  
A finding with `measured` equal to `NaN` or `Infinity` must produce `HOLD`.  
A finding with `passed` that is not a boolean must produce `HOLD`.

**Unchanged behaviour**  
`measured: 0` (falsy finite number) still counts as valid evidence and does not trigger `HOLD`.  
`passed: false` still triggers `FAIL` normally.

---

## D4 — ledger.verify skips line 0 and tail() lets JSON errors escape

**Current behaviour**  
`verify()` loops from `i = 1` but never checks that `lines[0]` parses correctly or that its
`prevHash` equals `'GENESIS'`. A one-line ledger with arbitrary content passes verification.  
`tail()` calls `JSON.parse` directly without a try/catch, so a corrupt line throws uncaught.

**Expected behaviour**  
`verify()` must parse line 0 and confirm `parsed.prevHash === 'GENESIS'`.  
If line 0 is not parseable or its `prevHash` is not `'GENESIS'`, return `{ ok: false, firstBadIndex: 0 }`.  
`tail()` must not throw on a corrupt line; return whatever parses successfully and skip bad lines.

**Unchanged behaviour**  
A valid single-entry ledger (prevHash GENESIS) still returns `{ ok: true }`.  
The verify loop for subsequent lines is unchanged.

---

## D5 — hook reads wrong field names from Kiro CLI payload

**Current behaviour**  
The hook reads `payload.toolName` and `payload.toolInput`, but Kiro CLI 2.37 sends:

```json
{
  "session_id": "sess_x",
  "hook_event_name": "PreToolUse",
  "cwd": "/path",
  "tool_name": "execute_bash",
  "tool_input": { "command": "echo hi", "description": "...", "cwd": null,
                  "run_in_background": false, "timeout": null }
}
```

The hook therefore never matches any tool name or command, and never blocks.  
An unreadable or empty payload is silently treated as "not a release command".

**Expected behaviour**  
Read `tool_name` and `tool_input.command` from the payload.  
If the payload is unreadable (parse error, empty stdin), exit 2 to block.  
Test fixtures must use this captured payload shape.

**Unchanged behaviour**  
Pattern matching logic and exit codes are unchanged. Only the field names change.

---

## D6 — hook uses stale PASS and ignores gate identity

**Current behaviour**  
The hook checks only `artifactHash`; it never verifies the ledger chain or the gate hash.  
It reads only the last 1000 entries (a FAIL beyond that limit would be invisible).  
A newer FAIL does not beat an older PASS.

**Expected behaviour**  
(a) Run `ledger.verify()` before trusting any entry; block if the chain is broken.  
(b) `charon-hook.json` must include a required `gatePath` field. Import the gate and compute
    its current `gateHash` at hook run time.  
(c) Only entries matching both `artifactHash` and the live `gateHash` are considered.  
    Walk entries newest-first; the first matching entry wins — a newer FAIL beats an older PASS.  
(d) Read the whole ledger, not just 1000 entries.

**Unchanged behaviour**  
Override entries that match artifact+gate hash are still treated as a pass.  
Exit codes are unchanged.

---

## D7 — CLI override requires no human confirmation; hook does not guard the ledger

**Current behaviour**  
`charon override` accepts `--human anyone` from a script with no interaction.  
An agent can override silently and then release.  
The hook does not detect `charon override` shell commands or direct ledger writes.

**Expected behaviour**  
**CLI**: if `process.stdin.isTTY` is not true, write an error to stderr and exit 2.  
If it is a TTY, prompt the human to type the first 8 hex characters of the artifact hash.  
If the typed prefix does not match, exit 2.  
**Hook**: block any shell command whose text contains both `charon` and `override`.  
Block any write-tool call (`fs_write`, `str_replace`, `fs_append`) or shell command (`execute_bash`)
whose target path matches the configured `ledgerPath` (read `path` or `file_path` from
`tool_input` for write tools).

**Unchanged behaviour**  
A real human at a TTY who types the correct 8-character prefix is allowed through.  
Non-release, non-override commands that do not target the ledger are unchanged.

---

## D8 — hook command in example JSON does not fail closed

**Current behaviour**  
`charon-hook.example.json` sets `"command": "node skeleton/hooks/pre-release.js"`.  
If Node fails to load the script (syntax error, missing file), it exits non-zero but not 2.  
Kiro treats only exit 2 as a block; all other non-zero exits allow the tool through.

**Expected behaviour**  
The command must be `node skeleton/hooks/pre-release.js || exit 2`  
so that any unexpected failure is treated as a block.

**Unchanged behaviour**  
A clean exit 0 or exit 2 from the script itself is unaffected.
