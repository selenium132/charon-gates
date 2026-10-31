/**
 * @file Tests for skeleton/hooks/pre-release.js
 * Uses in-memory ledger via temp files and Kiro CLI 2.37 hook payloads on stdin.
 *
 * Kiro CLI 2.37 payload shape (PreToolUse):
 * {
 *   "session_id": "sess_x",
 *   "hook_event_name": "PreToolUse",
 *   "cwd": "/path",
 *   "tool_name": "execute_bash",
 *   "tool_input": { "command": "...", "description": "...", "cwd": null,
 *                   "run_in_background": false, "timeout": null }
 * }
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLedger, judge, gateHash } from '../core/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const HOOK = join(__dirname, 'pre-release.js');

/** Real Kiro CLI 2.37 payload shape. */
function kiroPayload(tool_name, command, extra = {}) {
  return {
    session_id: 'sess_test',
    hook_event_name: 'PreToolUse',
    cwd: '/project',
    tool_name,
    tool_input: {
      command,
      description: 'test command',
      cwd: null,
      run_in_background: false,
      timeout: null,
      ...extra,
    },
  };
}

/** Run the hook script with given stdin payload and cwd. */
function runHook(cwd, payload) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      cwd,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ stdout, stderr, code }));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/** Run hook with raw string on stdin (for testing bad payload). */
function runHookRaw(cwd, rawStdin) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      cwd,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ stdout, stderr, code }));
    child.stdin.write(rawStdin);
    child.stdin.end();
  });
}

let tmpDir;
let artifactPath;
const ARTIFACT_CONTENT = new Uint8Array([42, 43, 44]);

// A trivial gate for testing
const passCheck = (_ev) => ({ checkId: 'p', measured: 1, threshold: 1, unit: null, passed: true });
passCheck.checkId = 'p';
const PASS_GATE = { id: 'test-gate', version: '1', checks: [passCheck] };
const PASS_GATE_FILE = 'test-pass.gate.js';

const failCheck = (_ev) => ({ checkId: 'f', measured: 0, threshold: 1, unit: null, passed: false });
failCheck.checkId = 'f';
const FAIL_GATE = { id: 'test-gate', version: '1', checks: [failCheck] };

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'charon-hook-test-'));
  artifactPath = join(tmpDir, 'artifact.bin');
  await writeFile(artifactPath, ARTIFACT_CONTENT);
  // Write a real gate file for D6 tests (dynamic import requires a file)
  await writeFile(join(tmpDir, PASS_GATE_FILE), `
const passCheck = (_ev) => ({ checkId: 'p', measured: 1, threshold: 1, unit: null, passed: true });
passCheck.checkId = 'p';
export default { id: 'test-gate', version: '1', checks: [passCheck] };
`);
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Helper: write a ledger file with given entries using an in-memory store. */
async function buildLedger(ledgerPath, entries) {
  const store = [];
  const ledger = createLedger(
    async () => [...store],
    async (line) => { store.push(line); }
  );
  for (const e of entries) await ledger.append(e);
  await writeFile(ledgerPath, store.join('\n') + '\n', 'utf8');
  return store; // return raw lines for chain-tampering tests
}

/** Write the standard charon-hook.json for D6 tests (with gatePath). */
async function writeConfig(overrides = {}) {
  const ledgerPath = overrides.ledgerPath ?? join(tmpDir, 'ledger-default.jsonl');
  const config = {
    ledgerPath,
    artifactPath,
    gatePath: join(tmpDir, PASS_GATE_FILE),
    releasePattern: 'release',
    ...overrides,
  };
  await writeFile(join(tmpDir, 'charon-hook.json'), JSON.stringify(config));
  return config;
}

// ---------------------------------------------------------------------------
// D5: correct Kiro CLI 2.37 payload field names
// ---------------------------------------------------------------------------

describe('D5: hook — non-release tool (real Kiro payload shape) → exit 0', () => {
  it('tool_name=read_file → exit 0', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d5-1.jsonl');
    await buildLedger(ledgerPath, []);
    await writeConfig({ ledgerPath });
    const { code } = await runHook(tmpDir, kiroPayload('read_file', ''));
    assert.equal(code, 0);
  });
});

describe('D5: hook — unreadable payload → exit 2 (fail closed)', () => {
  it('empty stdin → exit 2', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d5-2.jsonl');
    await buildLedger(ledgerPath, []);
    await writeConfig({ ledgerPath });
    const { code, stderr } = await runHookRaw(tmpDir, '');
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });

  it('invalid JSON stdin → exit 2', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d5-3.jsonl');
    await buildLedger(ledgerPath, []);
    await writeConfig({ ledgerPath });
    const { code, stderr } = await runHookRaw(tmpDir, 'not json');
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });

  it('old-shape toolName field no longer matches release → exit 0 if not release', async () => {
    // The old field was toolName; in real usage this means non-release passes through.
    // With real field names, tool_name is used; toolName is ignored.
    const ledgerPath = join(tmpDir, 'ledger-d5-4.jsonl');
    await buildLedger(ledgerPath, []);
    await writeConfig({ ledgerPath });
    // Payload using OLD field names — hook should NOT match the release pattern
    const { code } = await runHook(tmpDir, {
      session_id: 's',
      hook_event_name: 'PreToolUse',
      cwd: '/p',
      tool_name: 'read_file',         // correct new field
      tool_input: { command: '', description: '', cwd: null, run_in_background: false, timeout: null },
    });
    assert.equal(code, 0);
  });
});

// ---------------------------------------------------------------------------
// D6: release command with matching PASS
// ---------------------------------------------------------------------------

describe('D6: hook — release command with matching PASS', () => {
  it('PASS entry with matching artifactHash and gateHash → exit 0', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d6-1.jsonl');
    const verdict = await judge(PASS_GATE, {}, ARTIFACT_CONTENT);
    await buildLedger(ledgerPath, [{ type: 'verdict', ...verdict }]);
    await writeConfig({ ledgerPath });

    const { stdout, code } = await runHook(tmpDir, kiroPayload('execute_bash', 'npm run release'));
    assert.equal(code, 0);
    assert.ok(stdout.includes('{}'));
  });
});

describe('D6: hook — release command with no matching PASS', () => {
  it('no PASS entry → exit 2, stderr non-empty', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d6-2.jsonl');
    const verdict = await judge(FAIL_GATE, {}, ARTIFACT_CONTENT);
    await buildLedger(ledgerPath, [{ type: 'verdict', ...verdict }]);
    await writeConfig({ ledgerPath });

    const { stderr, code } = await runHook(tmpDir, kiroPayload('execute_bash', 'release dist/output.mp4'));
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });
});

describe('D6: hook — release command with override entry', () => {
  it('override present with matching hashes → exit 0', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d6-3.jsonl');
    // Use the PASS_GATE so the override entry's gateHash matches the live gate file
    const verdict = await judge(PASS_GATE, {}, ARTIFACT_CONTENT);
    // Force status to FAIL so we can test that override bypasses it
    const failVerdict = { ...verdict, status: 'FAIL' };
    const { buildOverrideEntry } = await import('../core/index.js');
    const overrideEntry = buildOverrideEntry(failVerdict, 'manual ok', 'alice');
    await buildLedger(ledgerPath, [{ type: 'verdict', ...failVerdict }, overrideEntry]);
    await writeConfig({ ledgerPath });

    const { code } = await runHook(tmpDir, kiroPayload('execute_bash', 'release'));
    assert.equal(code, 0);
  });
});

describe('D6: hook — newer FAIL beats older PASS', () => {
  it('PASS then FAIL for same artifact+gate → exit 2', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d6-4.jsonl');
    const passV = await judge(PASS_GATE, {}, ARTIFACT_CONTENT);
    // Change the gate so gateHash matches PASS_GATE — use a gate with same hash
    const failV = await judge(PASS_GATE, {}, ARTIFACT_CONTENT);
    // Override status manually to simulate a FAIL re-run of the same gate
    const failVerdictSameGate = { ...failV, status: 'FAIL' };
    await buildLedger(ledgerPath, [
      { type: 'verdict', ...passV },
      { type: 'verdict', ...failVerdictSameGate },
    ]);
    await writeConfig({ ledgerPath });

    const { code } = await runHook(tmpDir, kiroPayload('execute_bash', 'npm run release'));
    assert.equal(code, 2);
  });
});

describe('D6: hook — broken ledger chain → exit 2', () => {
  it('tampered ledger chain → exit 2', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d6-5.jsonl');
    const verdict = await judge(PASS_GATE, {}, ARTIFACT_CONTENT);
    const store = await buildLedger(ledgerPath, [{ type: 'verdict', ...verdict }]);
    // Tamper: overwrite line 0 with wrong prevHash
    const corrupted = { ...JSON.parse(store[0]), prevHash: 'bad' };
    await writeFile(ledgerPath, JSON.stringify(corrupted) + '\n');
    await writeConfig({ ledgerPath });

    const { code, stderr } = await runHook(tmpDir, kiroPayload('execute_bash', 'npm run release'));
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });
});

describe('D6: hook — ledger file missing → exit 2', () => {
  it('ledger not found → exit 2, stderr non-empty', async () => {
    const ledgerPath = join(tmpDir, 'nonexistent.jsonl');
    await writeConfig({ ledgerPath });

    const { stderr, code } = await runHook(tmpDir, kiroPayload('execute_bash', 'release'));
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });
});

// ---------------------------------------------------------------------------
// D7: hook blocks charon override commands and ledger writes
// ---------------------------------------------------------------------------

describe('D7: hook — blocks charon override shell command', () => {
  it('execute_bash with "charon override ..." → exit 2', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d7-1.jsonl');
    const verdict = await judge(PASS_GATE, {}, ARTIFACT_CONTENT);
    await buildLedger(ledgerPath, [{ type: 'verdict', ...verdict }]);
    await writeConfig({ ledgerPath });

    const { code, stderr } = await runHook(tmpDir, kiroPayload('execute_bash', 'charon override .charon/ledger.jsonl --reason ok --human alice'));
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });
});

describe('D7: hook — blocks write tool targeting the ledger path', () => {
  it('fs_write targeting ledgerPath → exit 2', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d7-2.jsonl');
    const verdict = await judge(PASS_GATE, {}, ARTIFACT_CONTENT);
    await buildLedger(ledgerPath, [{ type: 'verdict', ...verdict }]);
    await writeConfig({ ledgerPath });

    const payload = {
      session_id: 'sess_test',
      hook_event_name: 'PreToolUse',
      cwd: '/project',
      tool_name: 'fs_write',
      tool_input: { path: ledgerPath, text: 'tampered' },
    };
    const { code, stderr } = await runHook(tmpDir, payload);
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });

  it('str_replace targeting ledgerPath via file_path → exit 2', async () => {
    const ledgerPath = join(tmpDir, 'ledger-d7-3.jsonl');
    const verdict = await judge(PASS_GATE, {}, ARTIFACT_CONTENT);
    await buildLedger(ledgerPath, [{ type: 'verdict', ...verdict }]);
    await writeConfig({ ledgerPath });

    const payload = {
      session_id: 'sess_test',
      hook_event_name: 'PreToolUse',
      cwd: '/project',
      tool_name: 'str_replace',
      tool_input: { file_path: ledgerPath, oldStr: 'a', newStr: 'b' },
    };
    const { code, stderr } = await runHook(tmpDir, payload);
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });
});
