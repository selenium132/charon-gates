# Charon Core — Requirements

EARS notation key  
- **UB** Ubiquitous: "The \<system\> shall \<action\>"  
- **EV** Event-driven: "When \<trigger\>, the \<system\> shall \<action\>"  
- **ST** State-driven: "While \<state\>, the \<system\> shall \<action\>"  
- **OPT** Optional feature: "Where \<feature\>, the \<system\> shall \<action\>"  
- **UW** Unwanted behaviour: "If \<condition\>, the \<system\> shall \<response\>"

---

## 1. Scope

These requirements cover the Charon skeleton template:

| Component | Path |
|---|---|
| Core library | `skeleton/core` |
| Node CLI | `skeleton/cli` |
| stdio MCP server | `skeleton/mcp` |
| PreToolUse hook script | `skeleton/hooks` |

Apps (`apps/ghost-viewer`, `apps/seance`) are out of scope here; they depend on this skeleton.

---

## 2. Definitions

| Term | Meaning |
|---|---|
| **Artifact** | Any file submitted to a gate for judgement (video, model weights, zip, etc.) |
| **Gate definition** | A JavaScript object (`GateDef`) that names a set of checks and their pass thresholds |
| **Check** | A pure function `(Evidence) → Finding` |
| **Evidence** | Structured data read from the artifact or its environment before judgement |
| **Finding** | `{ checkId, measured, threshold, unit, passed }` — the output of one check |
| **Verdict** | `{ status: 'PASS' \| 'FAIL' \| 'HOLD', artifactHash, gateHash, findings, ts }` |
| **Ledger** | An append-only, hash-chained file of verdict entries |
| **Override** | A ledger entry that records a human decision to pass an artifact despite a non-PASS verdict |
| **The Toll** | The five invariants all Charon gates must satisfy (product steering §Toll) |

---

## 3. Core library (`skeleton/core`)

### 3.1 Evidence and Checks

**REQ-C01 (UB)** The core shall define an `Evidence` type as a plain, JSON-serialisable object with no required fields.

**REQ-C02 (UB)** The core shall define a `Check` as a pure function with signature `(evidence: Evidence) => Finding | Promise<Finding>`.

**REQ-C03 (UB)** The core shall define a `Finding` as `{ checkId: string, measured: number | string | boolean, threshold: number | string | boolean | null, unit: string | null, passed: boolean }`.

**REQ-C04 (UB)** The core shall define a `GateDef` as `{ id: string, version: string, checks: Check[] }`.

**REQ-C05 (UB)** The core shall expose `gateHash(gateDef)` that returns the SHA-256 hex digest of the stable JSON serialisation of `{ id, version, checks: [checkId, …] }`.

**REQ-C06 (UB)** The core shall expose `artifactHash(bytes)` where `bytes` is a `Uint8Array`, returning its SHA-256 hex digest.

**REQ-C07 (UB)** All hashing shall use `globalThis.crypto.subtle` (WebCrypto) with no fallback to Node `crypto`.

### 3.2 Judgement

**REQ-C08 (UB)** The core shall expose `judge(gateDef, evidence, artifactBytes)` that runs every check in `gateDef.checks` against `evidence`, collects findings, and returns a `Verdict`.

**REQ-C09 (EV)** When all findings have `passed === true`, `judge` shall set `verdict.status` to `'PASS'`.

**REQ-C10 (EV)** When at least one finding has `passed === false`, `judge` shall set `verdict.status` to `'FAIL'`.

**REQ-C11 (EV)** When any check throws or returns a finding where `measured` is `null` or `undefined`, `judge` shall set `verdict.status` to `'HOLD'`.

**REQ-C12 (UW)** If `evidence` is missing or `null`, `judge` shall produce a `HOLD` verdict without running any checks.

**REQ-C13 (UB)** Every `Verdict` shall include `artifactHash` (SHA-256 hex of `artifactBytes`), `gateHash` (SHA-256 hex of `gateDef`), `findings` (array of all `Finding` objects), and `ts` (ISO-8601 UTC timestamp string).

**REQ-C14 (UB)** `judge` shall be deterministic for deterministic checks: identical inputs shall always produce identical verdicts (same hashes, same findings, same status).

### 3.3 Ledger

**REQ-C15 (UB)** The core shall expose `createLedger(readLines, appendLine)` that accepts two I/O callbacks and returns a ledger object, keeping the core free of `fs`/`path`/`process`/`Buffer`.

**REQ-C16 (UB)** The ledger shall expose `append(entry)` that serialises the entry as a single JSON line and writes it using the `appendLine` callback.

**REQ-C17 (UB)** Each ledger entry shall carry a `prevHash` field set to the SHA-256 hex of the preceding raw JSON line, or the string `"GENESIS"` for the first entry.

**REQ-C18 (EV)** When `append` is called, it shall read the last written line via `readLines` to compute `prevHash` before writing the new entry.

**REQ-C19 (UB)** The ledger shall expose `verify()` that replays all lines from `readLines`, recomputes each `prevHash`, and returns `{ ok: boolean, firstBadIndex: number | null }`.

**REQ-C20 (UW)** If any `prevHash` in the ledger does not match the SHA-256 of the preceding line, `verify` shall return `{ ok: false, firstBadIndex: <n> }`.

**REQ-C21 (UB)** The ledger shall expose `tail(n)` that returns the last `n` entries as parsed objects.

### 3.4 Override

**REQ-C22 (UB)** The core shall expose `buildOverrideEntry(verdict, reason, humanId)` that constructs a ledger entry of `type: 'override'` containing the original verdict's `artifactHash`, `gateHash`, the human-supplied `reason`, the `humanId` string, and the current UTC timestamp.

**REQ-C23 (UW)** If `humanId` is empty, `null`, or `undefined`, `buildOverrideEntry` shall throw with the message `"override requires a named human"`.

**REQ-C24 (UB)** An override entry shall not alter `verdict.status`; it shall be an additional ledger entry recording the human decision alongside the original verdict entry.

---

## 4. Node CLI (`skeleton/cli`)

### 4.1 General

**REQ-L01 (UB)** The CLI shall be an ESM Node 20+ script with a `bin` entry, requiring no build step.

**REQ-L02 (UB)** The CLI shall read artifact bytes from a file path argument and gate definitions from a JS module path argument; it shall not read from stdin unless specified.

**REQ-L03 (UB)** The CLI shall write its final verdict as a JSON object to stdout.

**REQ-L04 (UB)** The CLI shall exit with code `0` on PASS, `1` on FAIL or HOLD, and `2` on usage or I/O error.

### 4.2 `judge` sub-command

**REQ-L05 (EV)** When `judge <artifact> <gate> [--ledger <path>]` is invoked, the CLI shall read the artifact file, instantiate the gate, run `judge()`, print the verdict JSON to stdout, and if `--ledger` is given, append the verdict to the ledger at `<path>`.

**REQ-L06 (EV)** When the `--ledger` flag is absent, the CLI shall print the verdict and exit without writing to any file.

### 4.3 `verify-ledger` sub-command

**REQ-L07 (EV)** When `verify-ledger <path>` is invoked, the CLI shall run `ledger.verify()` and print `{ ok, firstBadIndex }` as JSON to stdout, exiting with code `0` if `ok` is `true`, `1` if `ok` is `false`.

### 4.4 `override` sub-command

**REQ-L08 (EV)** When `override <ledger> --reason <text> --human <id>` is invoked, the CLI shall read the latest verdict from the ledger, call `buildOverrideEntry`, append the result to the ledger, and print the override entry as JSON to stdout.

**REQ-L09 (UW)** If `--human` is absent or empty, the CLI shall print an error message to stderr and exit with code `2`.

---

## 5. stdio MCP server (`skeleton/mcp`)

**REQ-M01 (UB)** The MCP server shall implement the Model Context Protocol over stdio, exposing exactly two tools: `judge` and `ledger_tail`.

**REQ-M02 (UB)** The MCP server shall use no runtime dependencies beyond the skeleton core and Node built-ins.

**REQ-M03 (UB)** The `judge` tool shall accept `{ artifactPath: string, gatePath: string, ledgerPath?: string }`, run the full judge pipeline, optionally append to the ledger, and return the verdict JSON.

**REQ-M04 (UB)** The `ledger_tail` tool shall accept `{ ledgerPath: string, n?: number }` and return the last `n` (default 10) ledger entries as a JSON array.

**REQ-M05 (UW)** If a tool call is missing a required parameter, the MCP server shall return a structured MCP error response and shall not crash.

**REQ-M06 (ST)** While the MCP server is running, it shall process requests one at a time (no concurrent file I/O on the same ledger path).

---

## 6. PreToolUse hook script (`skeleton/hooks`)

**REQ-H01 (UB)** The hook script shall be a standalone Node ESM script that reads a JSON context object from stdin (the Kiro hook payload).

**REQ-H02 (EV)** When the tool name in the hook payload matches a configurable release-command pattern (default: `execute_bash` with command matching `release`), the hook shall inspect the ledger for a current PASS verdict whose `artifactHash` matches the artifact configured for the gate.

**REQ-H03 (EV)** When a matching current PASS (or override) entry is found, the hook shall exit with code `0` and write `{}` to stdout (allow).

**REQ-H04 (EV)** When no matching current PASS entry is found, the hook shall exit with code `2` and write a plain-English explanation to stderr naming the missing condition.

**REQ-H05 (UW)** If the ledger file does not exist or cannot be read, the hook shall exit with code `2` (block) with an explanatory message, not code `0` (allow).

**REQ-H06 (UB)** The hook script shall be configurable via a JSON sidecar file (`charon-hook.json`) in the repository root, specifying `ledgerPath`, `artifactPath`, and optionally `releasePattern`.

---

## 7. The Toll — cross-cutting invariants

The following requirements restate the five Toll rules as testable constraints applying to the entire skeleton.

**REQ-T01 (UW)** If evidence is missing, unreadable, or a check throws, the system shall produce `HOLD`, never `PASS`. *(Toll rule 1)*

**REQ-T02 (UB)** Every verdict and finding shall state the measured value, the threshold, and the source check ID. *(Toll rule 2)*

**REQ-T03 (UB)** Changing the artifact bytes or the gate definition shall produce a different `artifactHash` or `gateHash`, making any prior verdict for the old inputs void. *(Toll rule 3)*

**REQ-T04 (UB)** The ledger shall be append-only and hash-chained so that modification of any prior entry is detectable by `verify()`. *(Toll rule 4)*

**REQ-T05 (UW)** If an attempt is made to record an override without a non-empty `humanId`, the system shall refuse with an error. *(Toll rule 5)*

---

## 8. Non-functional requirements

**REQ-N01 (UB)** `skeleton/core` shall have zero runtime npm dependencies and shall run unchanged in a browser environment (no `fs`, `path`, `process`, `Buffer`).

**REQ-N02 (UB)** The total non-test source lines across `skeleton/` (core + cli + mcp + hooks) shall not exceed 600.

**REQ-N03 (UB)** Every exported function in `skeleton/core` shall carry a JSDoc comment including `@param` and `@returns` annotations.

**REQ-N04 (UB)** Every Toll rule (REQ-T01–REQ-T05) shall have at least one property-based test implemented with `fast-check`.
