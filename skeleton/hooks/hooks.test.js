/**
 * @file Tests for skeleton/hooks/pre-release.js
 * Uses in-memory ledger via temp files and fake hook payloads on stdin.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLedger, judge, artifactHash } from '../core/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const HOOK = join(__dirname, 'pre-release.js');

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

/** Build an in-memory ledger backed by a file. */
function fileLedger(path) {
  async function readLines() {
    let text;
    try { text = await readFile(path, 'utf8'); } catch { return []; }
    return text.split('\n').filter((l) => l.trim() !== '');
  }
  async function appendLine(line) {
    await writeFile(path, (await readLines()).join('\n') + (await readLines()).length ? '\n' + line : line, 'utf8');
  }
  return createLedger(readLines, appendLine);
}

let tmpDir;
let artifactPath;
const ARTIFACT_CONTENT = new Uint8Array([42, 43, 44]);

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'charon-hook-test-'));
  artifactPath = join(tmpDir, 'artifact.bin');
  await writeFile(artifactPath, ARTIFACT_CONTENT);
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Helper: write a ledger file with given entries. */
async function buildLedger(ledgerPath, entries) {
  // Use a simple manual approach
  const store = [];
  const ledger = createLedger(
    async () => [...store],
    async (line) => { store.push(line); }
  );
  for (const e of entries) await ledger.append(e);
  await writeFile(ledgerPath, store.join('\n') + '\n', 'utf8');
}

describe('hook — not a release command', () => {
  it('non-release tool → exit 0', async () => {
    const ledgerPath = join(tmpDir, 'ledger1.jsonl');
    await buildLedger(ledgerPath, []);
    await writeFile(join(tmpDir, 'charon-hook.json'), JSON.stringify({
      ledgerPath,
      artifactPath,
    }));
    const { code } = await runHook(tmpDir, {
      toolName: 'read_file',
      toolInput: { command: '' },
    });
    assert.equal(code, 0);
  });
});

describe('hook — release command with matching PASS', () => {
  it('PASS entry present → exit 0, stdout {}', async () => {
    const ledgerPath = join(tmpDir, 'ledger2.jsonl');
    const artH = await artifactHash(ARTIFACT_CONTENT);

    // Build a gate that always passes
    const passCheck = (_ev) => ({ checkId: 'p', measured: 1, threshold: 1, unit: null, passed: true });
    passCheck.checkId = 'p';
    const gate = { id: 'g', version: '1', checks: [passCheck] };
    const verdict = await judge(gate, {}, ARTIFACT_CONTENT);

    await buildLedger(ledgerPath, [{ type: 'verdict', ...verdict }]);
    await writeFile(join(tmpDir, 'charon-hook.json'), JSON.stringify({
      ledgerPath,
      artifactPath,
    }));

    const { stdout, code } = await runHook(tmpDir, {
      toolName: 'execute_bash',
      toolInput: { command: 'npm run release' },
    });
    assert.equal(code, 0);
    assert.ok(stdout.includes('{}'));
  });
});

describe('hook — release command with no matching PASS', () => {
  it('no PASS entry → exit 2, stderr non-empty', async () => {
    const ledgerPath = join(tmpDir, 'ledger3.jsonl');
    // Build a FAIL verdict
    const failCheck = (_ev) => ({ checkId: 'f', measured: 0, threshold: 1, unit: null, passed: false });
    failCheck.checkId = 'f';
    const gate = { id: 'g', version: '1', checks: [failCheck] };
    const verdict = await judge(gate, {}, ARTIFACT_CONTENT);

    await buildLedger(ledgerPath, [{ type: 'verdict', ...verdict }]);
    await writeFile(join(tmpDir, 'charon-hook.json'), JSON.stringify({
      ledgerPath,
      artifactPath,
    }));

    const { stderr, code } = await runHook(tmpDir, {
      toolName: 'execute_bash',
      toolInput: { command: 'release dist/output.mp4' },
    });
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });
});

describe('hook — release command with override entry', () => {
  it('override present → exit 0', async () => {
    const ledgerPath = join(tmpDir, 'ledger4.jsonl');
    const failCheck = (_ev) => ({ checkId: 'f', measured: 0, threshold: 1, unit: null, passed: false });
    failCheck.checkId = 'f';
    const gate = { id: 'g', version: '1', checks: [failCheck] };
    const verdict = await judge(gate, {}, ARTIFACT_CONTENT);

    const { buildOverrideEntry } = await import('../core/index.js');
    const overrideEntry = buildOverrideEntry(verdict, 'manual ok', 'alice');

    await buildLedger(ledgerPath, [
      { type: 'verdict', ...verdict },
      overrideEntry,
    ]);
    await writeFile(join(tmpDir, 'charon-hook.json'), JSON.stringify({
      ledgerPath,
      artifactPath,
    }));

    const { code } = await runHook(tmpDir, {
      toolName: 'execute_bash',
      toolInput: { command: 'release' },
    });
    assert.equal(code, 0);
  });
});

describe('hook — ledger file missing', () => {
  it('ledger not found → exit 2, stderr non-empty', async () => {
    const ledgerPath = join(tmpDir, 'nonexistent.jsonl');
    await writeFile(join(tmpDir, 'charon-hook.json'), JSON.stringify({
      ledgerPath,
      artifactPath,
    }));

    const { stderr, code } = await runHook(tmpDir, {
      toolName: 'execute_bash',
      toolInput: { command: 'release' },
    });
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });
});
