#!/usr/bin/env node
/**
 * @file Charon MCP server — stdio transport, JSON-RPC 2.0.
 * Implements MCP 2024-11-05 with two tools: `judge` and `ledger_tail`.
 *
 * Reads newline-delimited JSON from stdin; writes responses to stdout.
 * Processes one request at a time (Node event loop guarantees sequential stdio).
 */

import { readFile, appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { judge, createLedger } from '../core/index.js';

const SERVER_INFO = { name: 'charon', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';

/** Build Node fs-backed ledger for a given path. */
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

/** Emit a JSON-RPC response to stdout. */
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

/** Emit a JSON-RPC error response to stdout. */
function respondError(id, code, message) {
  process.stdout.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [{ type: 'text', text: message }],
      },
    }) + '\n'
  );
}

const TOOL_DESCRIPTORS = [
  {
    name: 'judge',
    description: 'Run a Charon gate against an artifact and return a verdict.',
    inputSchema: {
      type: 'object',
      properties: {
        artifactPath: { type: 'string', description: 'Path to the artifact file.' },
        gatePath: { type: 'string', description: 'Path to the gate module (ESM default export GateDef).' },
        ledgerPath: { type: 'string', description: 'Optional path to append the verdict to a ledger.' },
      },
      required: ['artifactPath', 'gatePath'],
    },
  },
  {
    name: 'ledger_tail',
    description: 'Return the last n entries from a Charon ledger.',
    inputSchema: {
      type: 'object',
      properties: {
        ledgerPath: { type: 'string', description: 'Path to the ledger file.' },
        n: { type: 'integer', description: 'Number of entries to return (default 10).' },
      },
      required: ['ledgerPath'],
    },
  },
];

/** Dispatch a tools/call request. */
async function handleToolCall(id, toolName, args) {
  if (toolName === 'judge') {
    const { artifactPath, gatePath, ledgerPath } = args ?? {};
    if (!artifactPath) return respondError(id, -32602, 'artifactPath is required');
    if (!gatePath) return respondError(id, -32602, 'gatePath is required');

    let bytes, gateDef;
    try {
      bytes = await readFile(artifactPath);
    } catch (err) {
      return respondError(id, -32603, `Cannot read artifact: ${err.message}`);
    }
    try {
      const mod = await import(new URL(gatePath, import.meta.url + '/../').href);
      gateDef = mod.default;
    } catch (err) {
      return respondError(id, -32603, `Cannot import gate: ${err.message}`);
    }

    let evidence = {};
    try {
      const mod = await import(new URL(gatePath, import.meta.url + '/../').href);
      if (typeof mod.readEvidence === 'function') {
        evidence = await mod.readEvidence(artifactPath);
      }
    } catch { /* default to {} */ }

    const verdict = await judge(gateDef, evidence, new Uint8Array(bytes));

    if (ledgerPath) {
      try {
        await fsLedger(ledgerPath).append({ type: 'verdict', ...verdict });
      } catch (err) {
        return respondError(id, -32603, `Cannot write ledger: ${err.message}`);
      }
    }

    respond(id, { content: [{ type: 'text', text: JSON.stringify(verdict) }] });
  } else if (toolName === 'ledger_tail') {
    const { ledgerPath, n } = args ?? {};
    if (!ledgerPath) return respondError(id, -32602, 'ledgerPath is required');

    let entries;
    try {
      entries = await fsLedger(ledgerPath).tail(n ?? 10);
    } catch (err) {
      return respondError(id, -32603, `Cannot read ledger: ${err.message}`);
    }

    respond(id, { content: [{ type: 'text', text: JSON.stringify(entries) }] });
  } else {
    respondError(id, -32601, `Unknown tool: ${toolName}`);
  }
}

/** Main request dispatcher. */
async function handleRequest(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'
    );
    return;
  }

  const { method, id, params } = msg;

  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      break;

    case 'notifications/initialized':
      // No response needed for notifications.
      break;

    case 'tools/list':
      respond(id, { tools: TOOL_DESCRIPTORS });
      break;

    case 'tools/call':
      await handleToolCall(id, params?.name, params?.arguments);
      break;

    default:
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        }) + '\n'
      );
  }
}

// --- Entry point ---
const rl = createInterface({ input: process.stdin, terminal: false });
for await (const line of rl) {
  const trimmed = line.trim();
  if (trimmed) await handleRequest(trimmed);
}
