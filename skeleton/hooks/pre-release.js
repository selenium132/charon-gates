#!/usr/bin/env node
/**
 * @file Charon PreToolUse hook — blocks release commands unless the artifact
 * has a current PASS or override ledger entry.
 *
 * Reads the Kiro hook payload from stdin:
 *   { "toolName": "execute_bash", "toolInput": { "command": "..." } }
 *
 * Configuration sidecar — `charon-hook.json` in process.cwd():
 * {
 *   "ledgerPath": ".charon/ledger.jsonl",   // required
 *   "artifactPath": "dist/output.mp4",      // required
 *   "releasePattern": "release"             // optional, default "release"
 * }
 *
 * Exit codes:
 *   0 — allow (not a release command, or PASS/override found)
 *   2 — block (no PASS/override found, or ledger unreadable)
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactHash, createLedger } from '../core/index.js';

/** Read all stdin as a string. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Build fs-backed ledger. */
function fsLedger(ledgerPath) {
  async function readLines() {
    let text;
    try {
      text = await readFile(ledgerPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        const e = new Error(`Ledger not found: ${ledgerPath}`);
        e.code = 'ENOENT';
        throw e;
      }
      throw err;
    }
    return text.split('\n').filter((l) => l.trim() !== '');
  }
  async function appendLine() { /* read-only use */ }
  return createLedger(readLines, appendLine);
}

async function main() {
  // Load config
  let config;
  try {
    const raw = await readFile(join(process.cwd(), 'charon-hook.json'), 'utf8');
    config = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`charon-hook.json not found or invalid: ${err.message}\n`);
    process.exit(2);
  }

  const {
    ledgerPath,
    artifactPath,
    releasePattern = 'release',
  } = config;

  if (!ledgerPath || !artifactPath) {
    process.stderr.write('charon-hook.json must specify ledgerPath and artifactPath\n');
    process.exit(2);
  }

  // Parse hook payload from stdin
  let payload;
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw.trim() || '{}');
  } catch {
    payload = {};
  }

  const toolName = payload.toolName ?? '';
  const command = payload.toolInput?.command ?? '';
  const pattern = new RegExp(releasePattern, 'i');

  // Not a release command — allow
  if (!pattern.test(toolName) && !pattern.test(command)) {
    process.stdout.write('{}\n');
    process.exit(0);
  }

  // Compute artifact hash
  let artHash;
  try {
    const bytes = await readFile(artifactPath);
    artHash = await artifactHash(new Uint8Array(bytes));
  } catch (err) {
    process.stderr.write(`Cannot read artifact at ${artifactPath}: ${err.message}\n`);
    process.exit(2);
  }

  // Read ledger entries
  let entries;
  try {
    entries = await fsLedger(ledgerPath).tail(1000);
  } catch (err) {
    process.stderr.write(`Cannot read ledger at ${ledgerPath}: ${err.message}\n`);
    process.exit(2);
  }

  // Scan from newest to oldest for a matching PASS or override
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.artifactHash !== artHash) continue;
    if (e.type === 'verdict' && e.status === 'PASS') {
      process.stdout.write('{}\n');
      process.exit(0);
    }
    if (e.type === 'override') {
      process.stdout.write('{}\n');
      process.exit(0);
    }
  }

  process.stderr.write(
    `BLOCKED: no current PASS or override found in ledger for artifact ${artifactPath} (hash: ${artHash.slice(0, 12)}…)\n`
  );
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`Unexpected error: ${err.message}\n`);
  process.exit(2);
});
