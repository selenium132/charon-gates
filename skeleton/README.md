# Charon skeleton

Charon is a skeleton template for building **evidence gates**: small programs that decide whether an artifact may leave the workshop, and whose verdict an AI agent cannot talk its way past. It solves one problem — AI agents grade their own work — by replacing self-assessment with measured evidence. Every gate reads numbers from an artifact, compares them to thresholds, and writes a tamper-evident verdict to an append-only ledger. The gate either passes the artifact or holds it; there is no third opinion.

---

## Quick start: building a new gate

1. Copy this skeleton into your project or install it as a local path dependency.
2. Write a gate module (ESM, default export `GateDef`):

```js
// my-gate.js
const checkSize = (evidence) => ({
  checkId: 'file-size',
  measured: evidence.bytes,
  threshold: 10_000_000,
  unit: 'bytes',
  passed: evidence.bytes <= 10_000_000,
});
checkSize.checkId = 'file-size';

export default { id: 'my-gate', version: '1.0.0', checks: [checkSize] };

export async function readEvidence(artifactPath) {
  const { stat } = await import('node:fs/promises');
  const s = await stat(artifactPath);
  return { bytes: s.size };
}
```

3. Run the gate:

```sh
node skeleton/cli/charon.js judge dist/output.mp4 my-gate.js --ledger .charon/ledger.jsonl
```

4. Verify the ledger chain is intact:

```sh
node skeleton/cli/charon.js verify-ledger .charon/ledger.jsonl
```

5. Wire the PreToolUse hook to block releases without a PASS:
   - Copy `hooks/charon-hook.example.json` to `charon-hook.json` and fill in your paths.
   - Add a PreToolUse hook file under `.kiro/hooks/` that runs `node skeleton/hooks/pre-release.js || exit 2` (see `.kiro/hooks/toll-gate.json`).

---

## The five Toll rules

Every Charon gate always obeys these invariants:

1. **No evidence, no crossing.** Missing or unreadable evidence is HOLD, never PASS.
2. **A verdict reports what was measured, the threshold, and the source of the number.**
3. **A verdict is bound to the SHA-256 of the artifact and the gate definition.** Change either and the old verdict is void.
4. **The ledger is append-only and hash-chained.** Tampering is detectable.
5. **Agents cannot overrule.** Only a named human can record an override, and it stays visible as an override.

---

## CLI sub-commands

| Command | Effect |
|---|---|
| `charon judge <artifact> <gate> [--ledger <path>]` | Run the gate, print verdict JSON. Exits 0 on PASS, 1 on FAIL/HOLD. Appends to ledger if `--ledger` given. |
| `charon verify-ledger <path>` | Check the hash chain. Prints `{ ok, firstBadIndex }`. Exits 0 if intact. |
| `charon override <ledger> --reason <text> --human <id>` | Append a human override to the ledger. `--human` is required. |

---

## MCP tools

The MCP server (`skeleton/mcp/server.js`) exposes two tools over stdio JSON-RPC:

| Tool | Parameters | Returns |
|---|---|---|
| `judge` | `artifactPath`, `gatePath`, `ledgerPath?` | Verdict JSON |
| `ledger_tail` | `ledgerPath`, `n?` (default 10) | Array of last n ledger entries |

Start the server: `node skeleton/mcp/server.js`

---

## Notes

This skeleton is a **template**, not a published npm package. Copy it into your repository and adapt it. The `skeleton/core` module has zero runtime dependencies and runs unchanged in a browser environment.
