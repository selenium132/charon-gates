#!/usr/bin/env node
/**
 * @file Charon PreToolUse hook — blocks release commands unless the artifact
 * has a current PASS or override ledger entry that matches both the artifact
 * hash and the live gate hash.
 *
 * Reads Kiro CLI 2.37 hook payload from stdin:
 * {
 *   "session_id": "...",
 *   "hook_event_name": "PreToolUse",
 *   "cwd": "...",
 *   "tool_name": "execute_bash",
 *   "tool_input": { "command": "...", "description": "...", "cwd": null,
 *                   "run_in_background": false, "timeout": null }
 * }
 *
 * Configuration sidecar `charon-hook.json` in process.cwd():
 *   { "ledgerPath": ".charon/ledger.jsonl",  // required
 *     "artifactPath": "dist/output.mp4",     // required
 *     "gatePath": "gates/video.gate.js",     // required
 *     "releasePattern": "release" }          // optional, default "release"
 *
 * Exit 0 = allow, Exit 2 = block.
 * Any unexpected failure also exits 2 (fail-closed via || exit 2 in the hook command).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactHash, gateHash, createLedger } from '../core/index.js';

function fsLedger(ledgerPath) {
  return createLedger(async () => {
    let text;
    try { text = await readFile(ledgerPath, 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    return text.split('\n').filter(Boolean);
  }, async () => {});
}

async function main() {
  // --- Read config ---
  let config;
  try {
    config = JSON.parse(await readFile(join(process.cwd(), 'charon-hook.json'), 'utf8'));
  } catch (err) {
    process.stderr.write(`charon-hook.json not found or invalid: ${err.message}\n`);
    process.exit(2);
  }

  const { ledgerPath, artifactPath, gatePath, releasePattern = 'release' } = config;
  if (!ledgerPath || !artifactPath) {
    process.stderr.write('charon-hook.json must specify ledgerPath and artifactPath\n');
    process.exit(2);
  }
  if (!gatePath) {
    process.stderr.write('charon-hook.json must specify gatePath\n');
    process.exit(2);
  }

  // --- Parse stdin (fail closed on empty or invalid) ---
  let payload;
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
      process.stderr.write('Empty hook payload — blocking\n');
      process.exit(2);
    }
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write('Unreadable hook payload — blocking\n');
    process.exit(2);
  }

  const toolName = payload.tool_name ?? '';
  const command = payload.tool_input?.command ?? '';
  const targetPath = payload.tool_input?.path ?? payload.tool_input?.file_path ?? '';

  // --- D7: block charon override commands ---
  if (/charon/i.test(command) && /override/i.test(command)) {
    process.stderr.write('BLOCKED: charon override via agent is not permitted\n');
    process.exit(2);
  }

  // --- D7: block direct writes to the ledger file ---
  if (targetPath && targetPath === ledgerPath) {
    process.stderr.write(`BLOCKED: direct write to ledger ${ledgerPath}\n`);
    process.exit(2);
  }
  // Also block execute_bash commands that target the ledger path
  if (command && command.includes(ledgerPath)) {
    process.stderr.write(`BLOCKED: shell command targets ledger ${ledgerPath}\n`);
    process.exit(2);
  }

  // --- Pass through non-release tools/commands ---
  const re = new RegExp(releasePattern, 'i');
  if (!re.test(toolName) && !re.test(command)) {
    process.stdout.write('{}\n'); process.exit(0);
  }

  // --- Compute artifact hash ---
  let artHash;
  try {
    artHash = await artifactHash(new Uint8Array(await readFile(artifactPath)));
  } catch (err) {
    process.stderr.write(`Cannot read artifact ${artifactPath}: ${err.message}\n`);
    process.exit(2);
  }

  // --- Compute live gate hash ---
  let liveGateHash;
  try {
    const gateUrl = new URL(gatePath, 'file://' + process.cwd() + '/').href;
    const { default: gateDef } = await import(gateUrl);
    liveGateHash = await gateHash(gateDef);
  } catch (err) {
    process.stderr.write(`Cannot load gate ${gatePath}: ${err.message}\n`);
    process.exit(2);
  }

  // --- Verify ledger chain integrity ---
  const ledger = fsLedger(ledgerPath);
  let verifyResult;
  try {
    verifyResult = await ledger.verify();
  } catch (err) {
    process.stderr.write(`Cannot read ledger ${ledgerPath}: ${err.message}\n`);
    process.exit(2);
  }
  if (!verifyResult.ok) {
    process.stderr.write(
      `BLOCKED: ledger chain is broken at index ${verifyResult.firstBadIndex}\n`
    );
    process.exit(2);
  }

  // --- Read ALL ledger entries (tail with Infinity reads all) ---
  let entries;
  try {
    entries = await ledger.tail(Infinity);
  } catch (err) {
    process.stderr.write(`Cannot read ledger ${ledgerPath}: ${err.message}\n`);
    process.exit(2);
  }

  // --- Walk entries newest-first; first match for artifact+gateHash wins ---
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.artifactHash !== artHash) continue;
    if (e.gateHash !== liveGateHash) continue;
    if ((e.type === 'verdict' && e.status === 'PASS') || e.type === 'override') {
      process.stdout.write('{}\n'); process.exit(0);
    }
    // First match that is not PASS/override means the latest verdict was not PASS
    break;
  }

  process.stderr.write(
    `BLOCKED: no current PASS or override for artifact (hash: ${artHash.slice(0, 12)}…) with gate (hash: ${liveGateHash.slice(0, 12)}…)\n`
  );
  process.exit(2);
}

main().catch((err) => { process.stderr.write(`Error: ${err.message}\n`); process.exit(2); });
