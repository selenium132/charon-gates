# Charon Core — Design

## 1. Module map

```
skeleton/
├── core/
│   ├── types.js          # JSDoc typedefs only (Evidence, Check, Finding, GateDef, Verdict, LedgerEntry)
│   ├── hash.js           # artifactHash(), gateHash() — WebCrypto only
│   ├── judge.js          # judge(gateDef, evidence, artifactBytes) → Verdict
│   ├── ledger.js         # createLedger(readLines, appendLine) → Ledger
│   ├── override.js       # buildOverrideEntry(verdict, reason, humanId) → LedgerEntry
│   └── index.js          # re-exports all public symbols
├── cli/
│   └── charon.js         # ESM bin script — sub-commands: judge, verify-ledger, override
├── mcp/
│   └── server.js         # stdio MCP server — tools: judge, ledger_tail
└── hooks/
    └── pre-release.js    # Kiro PreToolUse hook script
```

No `package.json` at the skeleton level; each app provides its own. A `skeleton/package.json` with `"type":"module"` and dev-dependency `fast-check` is included for running tests directly from the template.

---

## 2. Data shapes (JSDoc typedefs)

```js
/**
 * @typedef {Record<string, unknown>} Evidence
 * Plain JSON-serialisable object; no required fields.
 */

/**
 * @typedef {{ checkId: string, measured: number|string|boolean,
 *             threshold: number|string|boolean|null,
 *             unit: string|null, passed: boolean }} Finding
 */

/**
 * @typedef {(evidence: Evidence) => Finding | Promise<Finding>} Check
 */

/**
 * @typedef {{ id: string, version: string, checks: Check[] }} GateDef
 */

/**
 * @typedef {{ status: 'PASS'|'FAIL'|'HOLD',
 *             artifactHash: string, gateHash: string,
 *             findings: Finding[], ts: string }} Verdict
 */

/**
 * @typedef {{ type: 'verdict'|'override', prevHash: string,
 *             ts: string, [key: string]: unknown }} LedgerEntry
 */
```

---

## 3. Component designs

### 3.1 `core/hash.js`

**`gateHash(gateDef)`**  
Serialises `{ id, version, checks: gateDef.checks.map(fn => fn.checkId) }` with `JSON.stringify` (keys sorted for stability), encodes to UTF-8, and returns the SHA-256 hex digest via `crypto.subtle.digest`.

Each `Check` function must carry a `checkId` string property. Gate authors set this when defining checks:

```js
myCheck.checkId = 'aspect-ratio';
```

**`artifactHash(bytes)`**  
Accepts a `Uint8Array`. Returns its SHA-256 hex digest.

Both functions return `Promise<string>`. Callers must `await` them.

---

### 3.2 `core/judge.js`

```
judge(gateDef, evidence, artifactBytes)
  → await gateHash(gateDef)         → gateH
  → await artifactHash(artifactBytes) → artH
  → if evidence is null/undefined → HOLD, findings=[]
  → for each check in gateDef.checks:
       try:
         finding = await check(evidence)
         if finding.measured == null → status = HOLD
       catch:
         finding = { checkId, measured: null, threshold: null, unit: null, passed: false }
         status = HOLD
       push finding
  → if no HOLD forced: status = all passed? PASS : FAIL
  → return Verdict
```

Status precedence: `HOLD > FAIL > PASS`. Once any check triggers HOLD, the status is locked to HOLD regardless of remaining checks (remaining checks still run so all findings are reported).

---

### 3.3 `core/ledger.js`

The ledger is I/O-agnostic. Callers supply two callbacks:

| Callback | Signature | Behaviour |
|---|---|---|
| `readLines` | `() => Promise<string[]>` | Returns every raw line currently in the ledger |
| `appendLine` | `(line: string) => Promise<void>` | Appends exactly one line |

**`append(entry)`**  
1. Call `readLines()` to get current lines.  
2. `prevHash` = SHA-256 hex of the last line, or `"GENESIS"` if empty.  
3. Attach `prevHash` and `ts` (ISO-8601 UTC) to `entry`.  
4. Serialise with `JSON.stringify` (no newline in values — entries are single-line).  
5. Call `appendLine(line)`.

**`verify()`**  
1. Call `readLines()`.  
2. Walk lines in order. For each line at index `i > 0`, compute SHA-256 of line `i-1`; compare with `JSON.parse(line[i]).prevHash`.  
3. Return `{ ok: true, firstBadIndex: null }` or `{ ok: false, firstBadIndex: i }` on first mismatch.

**`tail(n)`**  
Returns the last `n` parsed entries (default 10). If the ledger has fewer than `n` lines, returns all.

---

### 3.4 `core/override.js`

```js
buildOverrideEntry(verdict, reason, humanId)
```

Validates `humanId` (non-empty string); throws `"override requires a named human"` otherwise.  
Returns a plain object — not yet a ledger entry (no `prevHash`/`ts`). The caller passes this to `ledger.append()`.

```js
{
  type: 'override',
  artifactHash: verdict.artifactHash,
  gateHash: verdict.gateHash,
  reason,
  humanId,
  originalStatus: verdict.status
}
```

The override does not modify `verdict.status`. It is a separate record.

---

### 3.5 `cli/charon.js`

Entry point: `node skeleton/cli/charon.js <sub-command> [args]`

Sub-command dispatch via a plain `switch` on `process.argv[2]`. No external CLI parser.

**`judge <artifact> <gate> [--ledger <path>]`**  
- Read artifact with `fs/promises readFile` → `Uint8Array`.  
- Dynamic `import()` the gate module (default export must be a `GateDef`).  
- Import evidence reader from gate module's `evidence` named export if present; otherwise pass `{}`.  
- Run `judge()`.  
- If `--ledger`: create ledger with Node fs callbacks, append verdict.  
- Print verdict JSON, exit 0/1.

**`verify-ledger <path>`**  
- Create ledger from file. Run `ledger.verify()`. Print result JSON. Exit 0/1.

**`override <ledger> --reason <text> --human <id>`**  
- Read last verdict entry from ledger tail.  
- Build override entry. Append. Print entry JSON. Exit 0/1/2.

---

### 3.6 `mcp/server.js`

Implements MCP 2024-11-05 (stdio transport, JSON-RPC 2.0).

Reads newline-delimited JSON from `process.stdin`, writes responses to `process.stdout`.

**Manifest** (`initialize` response):

```json
{
  "protocolVersion": "2024-11-05",
  "capabilities": { "tools": {} },
  "serverInfo": { "name": "charon", "version": "0.1.0" }
}
```

**`tools/list`** returns descriptors for `judge` and `ledger_tail`.

**`tools/call` — `judge`**  
Input schema: `{ artifactPath: string, gatePath: string, ledgerPath?: string }`.  
Executes the same pipeline as `cli judge`. Returns `{ verdict: Verdict }`.

**`tools/call` — `ledger_tail`**  
Input schema: `{ ledgerPath: string, n?: integer }`.  
Returns `{ entries: LedgerEntry[] }`.

**Error handling**: missing required params → MCP `isError: true` content, no crash.  
Single-threaded: requests processed sequentially (Node event loop; no explicit lock needed for stdio).

---

### 3.7 `hooks/pre-release.js`

Reads Kiro hook payload from stdin (JSON):

```json
{
  "toolName": "execute_bash",
  "toolInput": { "command": "..." }
}
```

Configuration is loaded from `charon-hook.json` at `process.cwd()`:

```json
{
  "ledgerPath": ".charon/ledger.jsonl",
  "artifactPath": "dist/output.mp4",
  "releasePattern": "release"
}
```

**Decision logic:**

1. If `toolName` does not match `releasePattern` (default: any tool whose name or command contains `"release"`), exit 0 — not a release tool, allow.
2. Open ledger. Compute `artifactHash` of the file at `artifactPath`.  
3. Scan ledger entries from newest to oldest:  
   - Accept a `type: 'verdict'` entry with `status: 'PASS'` and matching `artifactHash`.  
   - Accept a `type: 'override'` entry with matching `artifactHash`.  
4. If accepted: exit 0, write `{}` to stdout.  
5. If not found: exit 2, write explanation to stderr.  
6. If ledger missing/unreadable: exit 2, write explanation to stderr.

---

## 4. Hashing contract

All hashes are lowercase hex strings of the raw SHA-256 digest (32 bytes → 64 hex chars).  
`gateHash` serialises **only** `{ id, version, checks }` where `checks` is an array of `checkId` strings (not function source). This means the hash changes when the check list changes or the gate version bumps, but not when a check's implementation is refactored without changing its ID. Gate authors must bump `version` when semantics change.

---

## 5. I/O boundary diagram

```
                        ┌─────────────────────────────────────────┐
                        │            skeleton/core                │
                        │   hash · judge · ledger · override      │
                        │   (zero deps, browser-safe)             │
                        └────────────┬────────────────────────────┘
                                     │ import
              ┌──────────────────────┼──────────────────────────┐
              │                      │                          │
   ┌──────────▼──────────┐  ┌────────▼────────┐  ┌─────────────▼──────────┐
   │   skeleton/cli      │  │  skeleton/mcp   │  │    skeleton/hooks      │
   │  (Node fs, process) │  │ (Node fs,stdio) │  │  (Node fs, stdin/out)  │
   └─────────────────────┘  └─────────────────┘  └────────────────────────┘
```

---

## 6. Correctness Properties

Each property is expressed as a `fast-check` property test. These map directly to the Toll rules.

### P1 — No evidence, no PASS *(Toll rule 1)*

```
for all (gateDef, artifactBytes):
  verdict = await judge(gateDef, null, artifactBytes)
  assert verdict.status === 'HOLD'

for all (gateDef, evidence, artifactBytes) where any check throws:
  verdict = await judge(gateDef, evidence, artifactBytes)
  assert verdict.status === 'HOLD'
```

Strategy: use `fc.constant(null)` for evidence; for throwing checks, generate a `GateDef` whose checks always throw.

### P2 — Verdict always reports measured value, threshold, and source *(Toll rule 2)*

```
for all (gateDef, evidence, artifactBytes) where no check throws:
  verdict = await judge(gateDef, evidence, artifactBytes)
  for each finding in verdict.findings:
    assert typeof finding.checkId === 'string' && finding.checkId.length > 0
    assert 'measured' in finding
    assert 'threshold' in finding
```

Strategy: generate `GateDef` with checks that return arbitrary `Finding` objects with all fields populated.

### P3 — Hash binding: changing artifact changes hash *(Toll rule 3, artifact side)*

```
for all (bytes1, bytes2) where bytes1 !== bytes2:
  h1 = await artifactHash(bytes1)
  h2 = await artifactHash(bytes2)
  assert h1 !== h2
```

Strategy: `fc.uint8Array({ minLength: 1 })` filtered for inequality.

### P3b — Hash binding: changing gate definition changes hash *(Toll rule 3, gate side)*

```
for all (gateDef1, gateDef2) where gateDef1.id !== gateDef2.id OR
                                    gateDef1.version !== gateDef2.version OR
                                    gateDef1.checks[*].checkId differs:
  h1 = await gateHash(gateDef1)
  h2 = await gateHash(gateDef2)
  assert h1 !== h2
```

### P4 — Ledger tampering is detectable *(Toll rule 4)*

```
for all sequence of verdicts V1..Vn (n ≥ 2):
  build in-memory ledger, append all verdicts
  mutate one character in a non-last line
  result = await ledger.verify()
  assert result.ok === false
  assert result.firstBadIndex >= 1
```

Strategy: build an in-memory ledger using string arrays. Use `fc.array(verdictArb, { minLength: 2 })` then `fc.integer` to pick a line to corrupt.

### P5 — Override requires a named human *(Toll rule 5)*

```
for all (verdict, reason, humanId) where humanId is '' or null or undefined:
  assert buildOverrideEntry(verdict, reason, humanId) throws
  assert error.message === 'override requires a named human'

for all (verdict, reason, humanId) where humanId is a non-empty string:
  entry = buildOverrideEntry(verdict, reason, humanId)
  assert entry.type === 'override'
  assert entry.humanId === humanId
```

Strategy: `fc.constantFrom('', null, undefined)` for the failing case; `fc.string({ minLength: 1 })` for the passing case.

### P6 — HOLD dominates FAIL and PASS (supplement to P1)

```
for all gateDef where at least one check returns measured=null and others return passed=false:
  verdict = await judge(gateDef, evidence, artifactBytes)
  assert verdict.status === 'HOLD'
```

### P7 — Ledger verify is a no-op on an untampered ledger

```
for all sequence of n entries (n ≥ 0):
  build in-memory ledger, append all
  result = await ledger.verify()
  assert result.ok === true
  assert result.firstBadIndex === null
```

---

## 7. Line-count budget

Target: ≤ 600 non-test source lines across all of `skeleton/`.

| Module | Estimated lines |
|---|---|
| `core/types.js` | ~30 |
| `core/hash.js` | ~25 |
| `core/judge.js` | ~55 |
| `core/ledger.js` | ~80 |
| `core/override.js` | ~20 |
| `core/index.js` | ~15 |
| `cli/charon.js` | ~130 |
| `mcp/server.js` | ~150 |
| `hooks/pre-release.js` | ~70 |
| **Total** | **~575** |

If any module grows beyond estimate, cut first from CLI argument parsing (keep it minimal) and MCP manifest verbosity.
