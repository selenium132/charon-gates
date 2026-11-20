/**
 * @file Tests for Ferryman F6 (corrupt lines stay visible) and F7 (in-process appends are serialised).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from './ledger.js';

async function sha256(str) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('ledger F6/F7', () => {
  it('tail returns a corrupt marker instead of skipping the line', async () => {
    const store = ['{"prevHash":"GENESIS","status":"PASS"}', 'not json'];
    const ledger = createLedger(async () => [...store], async (l) => { store.push(l); });
    const t = await ledger.tail(2);
    assert.equal(t.length, 2);
    assert.equal(t[1].corrupt, true);
    assert.equal(t[1].status, undefined);
  });

  it('verify rejects a line that parses to a non-object', async () => {
    const first = '{"prevHash":"GENESIS"}';
    const store = [first, 'null'];
    const ledger = createLedger(async () => [...store], async (l) => { store.push(l); });
    assert.equal((await sha256(first)).length, 64);
    assert.deepEqual(await ledger.verify(), { ok: false, firstBadIndex: 1 });
  });

  it('concurrent appends keep a valid chain', async () => {
    const store = [];
    const slow = async () => { await new Promise((r) => setTimeout(r, 5)); return [...store]; };
    const ledger = createLedger(slow, async (l) => { store.push(l); });
    await Promise.all([1, 2, 3, 4].map((n) => ledger.append({ n })));
    assert.equal(store.length, 4);
    assert.deepEqual(await ledger.verify(), { ok: true, firstBadIndex: null });
  });
});
