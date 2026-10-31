#!/usr/bin/env node
/**
 * @file Charon PreToolUse hook — blocks release commands unless the artifact
 * has a current PASS or override ledger entry.
 *
 * Reads Kiro hook payload from stdin:
 *   { "toolName": "execute_bash", "toolInput": { "command": "..." } }
 *
 * Configuration sidecar `charon-hook.json` in process.cwd():
 *   { "ledgerPath": ".charon/ledger.jsonl",  // required
 *     "artifactPath": "dist/output.mp4",     // required
 *     "releasePattern": "release" }          // optional, default "release"
 *
 * Exit 0 = allow, Exit 2 = block.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactHash, createLedger } from '../core/index.js';

function fsLedger(ledgerPath) {
  return createLedger(async () => {
    let text;
    try { text = await readFile(ledgerPath, 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') throw err; throw err; }
    return text.split('\n').filter(Boolean);
  }, async () => {});
}

async function main() {
  let config;
  try {
    config = JSON.parse(await readFile(join(process.cwd(), 'charon-hook.json'), 'utf8'));
  } catch (err) {
    process.stderr.write(`charon-hook.json not found or invalid: ${err.message}\n`);
    process.exit(2);
  }

  const { ledgerPath, artifactPath, releasePattern = 'release' } = config;
  if (!ledgerPath || !artifactPath) {
    process.stderr.write('charon-hook.json must specify ledgerPath and artifactPath\n');
    process.exit(2);
  }

  let payload = {};
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8').trim() || '{}');
  } catch { /* default {} */ }

  const toolName = payload.toolName ?? '';
  const command = payload.toolInput?.command ?? '';
  const re = new RegExp(releasePattern, 'i');

  if (!re.test(toolName) && !re.test(command)) {
    process.stdout.write('{}\n'); process.exit(0);
  }

  let artHash;
  try {
    artHash = await artifactHash(new Uint8Array(await readFile(artifactPath)));
  } catch (err) {
    process.stderr.write(`Cannot read artifact ${artifactPath}: ${err.message}\n`);
    process.exit(2);
  }

  let entries;
  try {
    entries = await fsLedger(ledgerPath).tail(1000);
  } catch (err) {
    process.stderr.write(`Cannot read ledger ${ledgerPath}: ${err.message}\n`);
    process.exit(2);
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.artifactHash !== artHash) continue;
    if ((e.type === 'verdict' && e.status === 'PASS') || e.type === 'override') {
      process.stdout.write('{}\n'); process.exit(0);
    }
  }

  process.stderr.write(
    `BLOCKED: no PASS or override for artifact ${artifactPath} (hash: ${artHash.slice(0, 12)}…)\n`
  );
  process.exit(2);
}

main().catch((err) => { process.stderr.write(`Error: ${err.message}\n`); process.exit(2); });
