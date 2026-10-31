/**
 * @file Integration tests for skeleton/cli/charon.js
 * Uses node:child_process spawn; no external dependencies.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(__dirname, 'charon.js');
const ARTIFACT = join(__dirname, 'fixtures', 'artifact.bin');
const PASS_GATE = join(__dirname, 'fixtures', 'pass.gate.js');
const FAIL_GATE = join(__dirname, 'fixtures', 'fail.gate.js');

/** Run CLI with given args; returns { stdout, stderr, code }. */
function runCLI(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

let tmpDir;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'charon-cli-test-'));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('judge sub-command', () => {
  it('judge with pass gate → PASS status, exit 0', async () => {
    const { stdout, code } = await runCLI(['judge', ARTIFACT, PASS_GATE]);
    const verdict = JSON.parse(stdout);
    assert.equal(verdict.status, 'PASS');
    assert.ok(verdict.artifactHash);
    assert.ok(verdict.gateHash);
    assert.equal(code, 0);
  });

  it('judge with fail gate → FAIL status, exit 1', async () => {
    const { stdout, code } = await runCLI(['judge', ARTIFACT, FAIL_GATE]);
    const verdict = JSON.parse(stdout);
    assert.equal(verdict.status, 'FAIL');
    assert.equal(code, 1);
  });

  it('judge --ledger → ledger file created with verdict line', async () => {
    const ledgerPath = join(tmpDir, 'test.jsonl');
    const { stdout, code } = await runCLI([
      'judge', ARTIFACT, PASS_GATE, '--ledger', ledgerPath,
    ]);
    assert.equal(code, 0);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(ledgerPath, 'utf8');
    const entry = JSON.parse(content.trim());
    assert.equal(entry.type, 'verdict');
    assert.equal(entry.status, 'PASS');
    assert.ok(entry.prevHash);
  });
});

describe('verify-ledger sub-command', () => {
  it('valid ledger → { ok: true }, exit 0', async () => {
    const ledgerPath = join(tmpDir, 'valid.jsonl');
    // Build ledger via judge --ledger
    await runCLI(['judge', ARTIFACT, PASS_GATE, '--ledger', ledgerPath]);
    const { stdout, code } = await runCLI(['verify-ledger', ledgerPath]);
    const result = JSON.parse(stdout);
    assert.deepEqual(result, { ok: true, firstBadIndex: null });
    assert.equal(code, 0);
  });

  it('corrupted ledger → { ok: false }, exit 1', async () => {
    const ledgerPath = join(tmpDir, 'corrupt.jsonl');
    // Write a tampered ledger manually
    const line1 = JSON.stringify({ type: 'verdict', status: 'PASS', prevHash: 'GENESIS', ts: new Date().toISOString() });
    const line2 = JSON.stringify({ type: 'verdict', status: 'FAIL', prevHash: 'deadbeef'.repeat(8), ts: new Date().toISOString() });
    await writeFile(ledgerPath, line1 + '\n' + line2 + '\n', 'utf8');
    const { stdout, code } = await runCLI(['verify-ledger', ledgerPath]);
    const result = JSON.parse(stdout);
    assert.equal(result.ok, false);
    assert.equal(code, 1);
  });
});

describe('override sub-command', () => {
  it('D7: override from non-TTY (pipe) → exit 2, stderr mentions terminal', async () => {
    // Spawn always has isTTY=false/undefined on stdin — the guard must fire.
    const ledgerPath = join(tmpDir, 'override.jsonl');
    await runCLI(['judge', ARTIFACT, FAIL_GATE, '--ledger', ledgerPath]);
    const { stderr, code } = await runCLI([
      'override', ledgerPath, '--reason', 'manual check', '--human', 'alice',
    ]);
    assert.equal(code, 2);
    assert.ok(stderr.includes('interactive terminal') || stderr.includes('isTTY'));
  });

  it('override without --human → exit 2, stderr non-empty', async () => {
    const ledgerPath = join(tmpDir, 'override2.jsonl');
    await runCLI(['judge', ARTIFACT, FAIL_GATE, '--ledger', ledgerPath]);
    const { stderr, code } = await runCLI([
      'override', ledgerPath, '--reason', 'no human',
    ]);
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });

  it('D7: override from non-TTY (pipe) → exit 2, stderr non-empty', async () => {
    const ledgerPath = join(tmpDir, 'override3.jsonl');
    await runCLI(['judge', ARTIFACT, FAIL_GATE, '--ledger', ledgerPath]);
    // runCLI uses spawn without a TTY (isTTY is undefined/false on piped stdin)
    const { stderr, code } = await runCLI([
      'override', ledgerPath, '--reason', 'agent attempt', '--human', 'bot',
    ]);
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });
});

describe('unknown sub-command', () => {
  it('prints usage to stderr and exits 2', async () => {
    const { stderr, code } = await runCLI(['notacommand']);
    assert.equal(code, 2);
    assert.ok(stderr.length > 0);
  });
});
