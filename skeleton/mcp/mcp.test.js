/**
 * @file Tests for skeleton/mcp/server.js
 * Spawns the server and communicates over stdio with JSON-RPC 2.0.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SERVER = join(__dirname, 'server.js');
const ARTIFACT = join(__dirname, '../cli/fixtures/artifact.bin');
const PASS_GATE = join(__dirname, '../cli/fixtures/pass.gate.js');

/**
 * Sends a list of JSON-RPC requests to the server and collects responses.
 * Closes stdin after sending, waits for stdout to close.
 * @param {object[]} requests
 * @returns {Promise<object[]>}
 */
function runMCP(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env },
    });
    const responses = [];
    let buf = '';

    child.stdout.on('data', (d) => {
      buf += d.toString();
      const parts = buf.split('\n');
      buf = parts.pop(); // keep incomplete line
      for (const part of parts) {
        const t = part.trim();
        if (t) {
          try { responses.push(JSON.parse(t)); } catch { /* skip */ }
        }
      }
    });

    child.stderr.on('data', () => { /* ignore */ });
    child.on('error', reject);
    child.on('close', () => resolve(responses));

    for (const req of requests) {
      child.stdin.write(JSON.stringify(req) + '\n');
    }
    child.stdin.end();
  });
}

describe('MCP server — initialize', () => {
  it('returns valid protocolVersion and serverInfo', async () => {
    const [res] = await runMCP([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    ]);
    assert.equal(res.result.protocolVersion, '2024-11-05');
    assert.ok(res.result.serverInfo?.name);
  });
});

describe('MCP server — tools/list', () => {
  it('contains judge and ledger_tail', async () => {
    const [, res] = await runMCP([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    const names = res.result.tools.map((t) => t.name);
    assert.ok(names.includes('judge'));
    assert.ok(names.includes('ledger_tail'));
  });
});

describe('MCP server — tools/call judge', () => {
  it('valid params → verdict in result', async () => {
    const responses = await runMCP([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'judge', arguments: { artifactPath: ARTIFACT, gatePath: PASS_GATE } },
      },
    ]);
    const res = responses.find((r) => r.id === 2);
    const text = res.result.content[0].text;
    const verdict = JSON.parse(text);
    assert.ok(['PASS', 'FAIL', 'HOLD'].includes(verdict.status));
    assert.ok(verdict.artifactHash);
  });

  it('missing artifactPath → isError: true', async () => {
    const responses = await runMCP([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'judge', arguments: { gatePath: PASS_GATE } },
      },
    ]);
    const res = responses.find((r) => r.id === 2);
    assert.equal(res.result.isError, true);
  });
});

describe('MCP server — tools/call ledger_tail', () => {
  it('valid params on empty ledger → entries array', async () => {
    // Use /dev/null as a path that resolves to an empty ledger (ENOENT → [])
    const responses = await runMCP([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'ledger_tail', arguments: { ledgerPath: '/nonexistent/ledger.jsonl', n: 5 } },
      },
    ]);
    const res = responses.find((r) => r.id === 2);
    const entries = JSON.parse(res.result.content[0].text);
    assert.ok(Array.isArray(entries));
  });
});
