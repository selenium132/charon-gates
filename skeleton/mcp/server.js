#!/usr/bin/env node
/**
 * @file Charon MCP server — stdio JSON-RPC 2.0, MCP 2024-11-05.
 * Tools: `judge`, `ledger_tail`. Processes requests sequentially.
 */
import { readFile, appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { judge, createLedger } from '../core/index.js';

const SERVER_INFO = { name: 'charon', version: '0.1.0' };
const PROTO = '2024-11-05';

function fsLedger(p) {
  return createLedger(async () => {
    try { return (await readFile(p, 'utf8')).split('\n').filter(Boolean); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }, async (line) => appendFile(p, line + '\n', 'utf8'));
}

const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const ok = (id, result) => out({ jsonrpc: '2.0', id, result });
const err = (id, msg) => ok(id, { isError: true, content: [{ type: 'text', text: msg }] });

const TOOLS = [
  { name: 'judge', description: 'Run a gate against an artifact and return a verdict.',
    inputSchema: { type: 'object', required: ['artifactPath', 'gatePath'],
      properties: { artifactPath: { type: 'string' }, gatePath: { type: 'string' }, ledgerPath: { type: 'string' } } } },
  { name: 'ledger_tail', description: 'Return the last n ledger entries.',
    inputSchema: { type: 'object', required: ['ledgerPath'],
      properties: { ledgerPath: { type: 'string' }, n: { type: 'integer' } } } },
];

async function callTool(id, name, args) {
  const a = args ?? {};
  if (name === 'judge') {
    if (!a.artifactPath) return err(id, 'artifactPath is required');
    if (!a.gatePath) return err(id, 'gatePath is required');
    let bytes, gateDef;
    try { bytes = await readFile(a.artifactPath); } catch (e) { return err(id, `Cannot read artifact: ${e.message}`); }
    try {
      const mod = await import(new URL(a.gatePath, import.meta.url + '/../').href);
      gateDef = mod.default;
      if (typeof mod.readEvidence === 'function') a._evidence = await mod.readEvidence(a.artifactPath);
    } catch (e) { return err(id, `Cannot import gate: ${e.message}`); }
    const verdict = await judge(gateDef, a._evidence ?? {}, new Uint8Array(bytes));
    if (a.ledgerPath) {
      try { await fsLedger(a.ledgerPath).append({ type: 'verdict', ...verdict }); }
      catch (e) { return err(id, `Cannot write ledger: ${e.message}`); }
    }
    ok(id, { content: [{ type: 'text', text: JSON.stringify(verdict) }] });
  } else if (name === 'ledger_tail') {
    if (!a.ledgerPath) return err(id, 'ledgerPath is required');
    let entries;
    try { entries = await fsLedger(a.ledgerPath).tail(a.n ?? 10); }
    catch (e) { return err(id, `Cannot read ledger: ${e.message}`); }
    ok(id, { content: [{ type: 'text', text: JSON.stringify(entries) }] });
  } else {
    err(id, `Unknown tool: ${name}`);
  }
}

async function dispatch(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  const { method, id, params } = msg;
  if (method === 'initialize') {
    ok(id, { protocolVersion: PROTO, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  } else if (method === 'notifications/initialized') {
    // notification — no response
  } else if (method === 'tools/list') {
    ok(id, { tools: TOOLS });
  } else if (method === 'tools/call') {
    await callTool(id, params?.name, params?.arguments);
  } else {
    out({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
for await (const line of rl) { if (line.trim()) await dispatch(line.trim()); }
