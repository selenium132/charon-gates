# Toll-Fixes: Design

## Scope

All changes live inside `skeleton/`. No new runtime dependencies are introduced.  
Each defect is fixed in isolation; the only cross-cutting concern is that D6 depends
on D5 (correct payload field names) and D2/D3 (gate semantics that determine what a PASS means).

---

## D1 — gateHash

**File**: `skeleton/core/hash.js`

Extend the per-check payload to include:
- `checkId` — as before
- `params` — the check's `.params` object if present, with keys sorted; `null` otherwise
- `source` — `fn.toString()`

The serialised payload becomes:

```js
JSON.stringify({
  checks: gateDef.checks.map((fn) => ({
    checkId: fn.checkId,
    params: fn.params != null
      ? Object.fromEntries(Object.keys(fn.params).sort().map((k) => [k, fn.params[k]]))
      : null,
    source: fn.toString(),
  })),
  id: gateDef.id,
  version: gateDef.version,
})
```

The existing known-vector test for a zero-check gate will need a new expected hash.  
A new property test (`P3c`) asserts: for any gate, changing one param value changes the hash.

---

## D2 — zero-check gate → HOLD

**File**: `skeleton/core/judge.js`

Add a guard immediately after the evidence null-check:

```js
if (gateDef.checks.length === 0) {
  return { status: 'HOLD', artifactHash: artH, gateHash: gateH, findings: [], ts };
}
```

---

## D3 — NaN/Infinity measured, non-boolean passed → HOLD

**File**: `skeleton/core/judge.js`

Add a helper `isFiniteMeasured(v)`:
```js
function isFiniteMeasured(v) {
  if (typeof v === 'number') return isFinite(v) && !isNaN(v);
  return true; // string, boolean are acceptable
}
```

In the per-check loop, after a successful `check(evidence)` call:
```js
if (!isFiniteMeasured(finding.measured)) forceHold = true;
else if (typeof finding.passed !== 'boolean') forceHold = true;
else if (finding.measured == null) forceHold = true;
else if (!finding.passed) anyFail = true;
```

Note: `finding.measured == null` (null/undefined) was already handled; keep it.

---

## D4 — ledger.verify checks line 0; tail() catches parse errors

**File**: `skeleton/core/ledger.js`

In `verify()`, before the existing loop, add:

```js
if (lines.length === 0) return { ok: true, firstBadIndex: null };
let first;
try { first = JSON.parse(lines[0]); } catch { return { ok: false, firstBadIndex: 0 }; }
if (first.prevHash !== 'GENESIS') return { ok: false, firstBadIndex: 0 };
```

In `tail()`, wrap each `JSON.parse(l)` in a try/catch and skip lines that fail:
```js
const results = [];
for (const l of lines.slice(-n)) {
  try { results.push(JSON.parse(l)); } catch { /* skip corrupt line */ }
}
return results;
```

---

## D5 — hook payload field names

**File**: `skeleton/hooks/pre-release.js`

Change:
```js
const toolName = payload.toolName ?? '';
const command = payload.toolInput?.command ?? '';
```
to:
```js
if (!payload || typeof payload !== 'object') {
  process.stderr.write('Unreadable hook payload\n');
  process.exit(2);
}
const toolName = payload.tool_name ?? '';
const command = payload.tool_input?.command ?? '';
```

Also update the stdin-parsing block to exit 2 on parse error rather than defaulting to `{}`:
```js
let payload;
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) { process.stderr.write('Empty hook payload\n'); process.exit(2); }
  payload = JSON.parse(raw);
} catch {
  process.stderr.write('Unreadable hook payload\n');
  process.exit(2);
}
```

Update test fixtures in `hooks/hooks.test.js` to use the real Kiro CLI 2.37 shape.

---

## D6 — hook gate-hash verification and full ledger scan

**File**: `skeleton/hooks/pre-release.js`  
**File**: `skeleton/hooks/charon-hook.example.json`

1. Add `gatePath` as a required field in `charon-hook.json`.  
   Update the example JSON accordingly.

2. After loading the config, validate `gatePath` is present.

3. Import the gate module and compute its `gateHash`:
   ```js
   const { default: gateDef } = await import(gateUrl);
   const liveGateHash = await gateHash(gateDef);
   ```

4. Call `ledger.verify()` before reading entries. If `!ok`, block.

5. Read all entries via `tail()` with no limit (pass `Infinity` or read lines directly):
   ```js
   // tail(n) reads last n; to read all, pass lines.length or use a large sentinel
   // Cleanest: expose readLines or use tail(Infinity) — implement tail(n) with
   // Math.min(n, lines.length) so Infinity reads everything.
   ```
   Update `tail(n)` in `ledger.js` to use `lines.slice(-n)` which already handles
   `Infinity` correctly in JS (`slice(-Infinity)` returns the whole array).

6. Walk entries newest-first; consider only those matching both `artifactHash`
   and `liveGateHash`. First match wins.

7. Also import `gateHash` from `../core/index.js`.

---

## D7 — CLI TTY guard and hook ledger protection

**File**: `skeleton/cli/charon.js`

In the `override` case, before reading the ledger:
```js
if (!process.stdin.isTTY) {
  process.stderr.write('override requires an interactive terminal\n');
  process.exit(2);
}
// Prompt for first 8 chars of artifact hash
// ... (the most recent verdict's artifactHash[:8])
process.stdout.write(`Type the first 8 characters of the artifact hash to confirm: `);
const typed = await readLine(process.stdin);
if (!typed.trimEnd().startsWith(lastVerdict.artifactHash.slice(0, 8))) {
  process.stderr.write('Hash prefix mismatch — override refused\n');
  process.exit(2);
}
```

Implement `readLine(stream)` as a small async helper using `node:readline`.

**File**: `skeleton/hooks/pre-release.js`

Add two additional block checks before the release-pattern check:

*Block charon override commands*:
```js
if (/charon/.test(command) && /override/.test(command)) {
  process.stderr.write('BLOCKED: charon override via agent is not permitted\n');
  process.exit(2);
}
```

*Block writes to the ledger path*:
```js
const targetPath = payload.tool_input?.path ?? payload.tool_input?.file_path ?? '';
if (targetPath && targetPath.includes(ledgerPath)) {
  process.stderr.write(`BLOCKED: direct write to ledger ${ledgerPath}\n`);
  process.exit(2);
}
```

These checks run for all tools (write tools as well as shell commands), so they
must execute regardless of whether `tool_name` matches `execute_bash`.

---

## D8 — fail-closed hook command

**File**: `skeleton/hooks/charon-hook.example.json`

Change `"command"` to:
```json
"command": "node skeleton/hooks/pre-release.js || exit 2"
```

---

## Test strategy

- Each defect gets at least one new failing test written first, then the fix.
- Property tests are added for D1 (params change → hash change) and D3 (NaN/Infinity → HOLD).
- D7 CLI tests use a pipe-connected stdin (isTTY = false) to confirm the non-TTY path exits 2.
- No existing test is weakened. The only existing test that changes is the D1 known-vector
  test in `hash.test.js` — its expected hash changes because the serialisation format changes.
  The reason is stated in the commit message and in the final summary.

---

## File size check

Current non-test source lines (approximate):

| File | Lines |
|------|-------|
| core/hash.js | 44 |
| core/judge.js | 56 |
| core/ledger.js | 74 |
| core/override.js | 33 |
| core/types.js | 47 |
| core/index.js | 9 |
| cli/charon.js | 143 |
| hooks/pre-release.js | 68 |
| mcp/server.js | 79 |
| **Total** | **553** |

After fixes the total will grow by roughly 50–70 lines, staying under 600.
