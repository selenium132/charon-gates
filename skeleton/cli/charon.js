#!/usr/bin/env node
/**
 * @file Charon CLI — ESM bin script.
 * Sub-commands: judge, verify-ledger, override
 * Usage:
 *   charon judge <artifact> <gate> [--ledger <path>]
 *   charon verify-ledger <path>
 *   charon override <ledger> --reason <text> --human <id>
 */

import { readFile, appendFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { judge, createLedger, buildOverrideEntry } from '../core/index.js';

/** @param {string} msg */
function die(msg, code = 2) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

/** Build Node fs-backed ledger callbacks for a file path. */
function fsLedger(ledgerPath) {
  async function readLines() {
    let text;
    try {
      text = await readFile(ledgerPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return text.split('\n').filter((l) => l.trim() !== '');
  }
  async function appendLine(line) {
    await appendFile(ledgerPath, line + '\n', 'utf8');
  }
  return createLedger(readLines, appendLine);
}

/** Parse argv into a simple { flags, positionals } structure. */
function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      flags[argv[i].slice(2)] = argv[i + 1] ?? true;
      i++;
    } else {
      positionals.push(argv[i]);
    }
  }
  return { flags, positionals };
}

const subCommand = process.argv[2];
const rest = process.argv.slice(3);

const USAGE = `Usage:
  charon judge <artifact> <gate> [--ledger <path>]
  charon verify-ledger <path>
  charon override <ledger> --reason <text> --human <id>`;

switch (subCommand) {
  case 'judge': {
    const { flags, positionals } = parseArgs(rest);
    const [artifactPath, gatePath] = positionals;
    if (!artifactPath || !gatePath) die(USAGE);

    let bytes, gateDef;
    try {
      bytes = await readFile(artifactPath);
    } catch (err) {
      die(`I/O error reading artifact: ${err.message}`, 2);
    }
    try {
      const mod = await import(new URL(gatePath, import.meta.url + '/../').href);
      gateDef = mod.default;
    } catch (err) {
      die(`I/O error importing gate: ${err.message}`, 2);
    }

    // Evidence reader: use named export `readEvidence` if present, else {}
    let evidence = {};
    try {
      const mod = await import(new URL(gatePath, import.meta.url + '/../').href);
      if (typeof mod.readEvidence === 'function') {
        evidence = await mod.readEvidence(artifactPath);
      }
    } catch {
      // ignore — evidence defaults to {}
    }

    const verdict = await judge(gateDef, evidence, new Uint8Array(bytes));

    if (flags.ledger) {
      const ledger = fsLedger(flags.ledger);
      await ledger.append({ type: 'verdict', ...verdict });
    }

    process.stdout.write(JSON.stringify(verdict) + '\n');
    process.exit(verdict.status === 'PASS' ? 0 : 1);
    break;
  }

  case 'verify-ledger': {
    const { positionals } = parseArgs(rest);
    const [ledgerPath] = positionals;
    if (!ledgerPath) die(USAGE);

    const ledger = fsLedger(ledgerPath);
    let result;
    try {
      result = await ledger.verify();
    } catch (err) {
      die(`I/O error reading ledger: ${err.message}`, 2);
    }

    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(result.ok ? 0 : 1);
    break;
  }

  case 'override': {
    const { flags, positionals } = parseArgs(rest);
    const [ledgerPath] = positionals;
    if (!ledgerPath) die(USAGE);
    if (!flags.human) {
      process.stderr.write('--human is required for override\n');
      process.exit(2);
    }
    if (!flags.reason) die('--reason is required for override');

    const ledger = fsLedger(ledgerPath);
    let recent;
    try {
      recent = await ledger.tail(10);
    } catch (err) {
      die(`I/O error reading ledger: ${err.message}`, 2);
    }

    // Find the latest verdict entry
    const lastVerdict = [...recent].reverse().find((e) => e.type === 'verdict');
    if (!lastVerdict) die('No verdict entry found in ledger', 1);

    let entry;
    try {
      entry = buildOverrideEntry(lastVerdict, flags.reason, flags.human);
    } catch (err) {
      process.stderr.write(err.message + '\n');
      process.exit(2);
    }

    await ledger.append(entry);
    process.stdout.write(JSON.stringify(entry) + '\n');
    process.exit(0);
    break;
  }

  default:
    die(USAGE);
}
