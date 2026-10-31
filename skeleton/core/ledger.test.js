/**
 * @file Tests for core/ledger.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createLedger } from './ledger.js';

/** Build an in-memory ledger backed by a simple string array. */
function memLedger() {
  const store = [];
  const readLines = async () => [...store];
  const appendLine = async (line) => { store.push(line); };
  return { ledger: createLedger(readLines, appendLine), store };
}

/** Compute SHA-256 hex of a string using WebCrypto. */
async function sha256(str) {
  const bytes = new TextEncoder().encode(str);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('ledger — append & chain', () => {
  it('first entry has prevHash === GENESIS', async () => {
    const { ledger } = memLedger();
    await ledger.append({ type: 'verdict', status: 'PASS' });
    const entries = await ledger.tail(1);
    assert.equal(entries[0].prevHash, 'GENESIS');
  });

  it("second entry's prevHash equals SHA-256 of the first raw line", async () => {
    const { ledger, store } = memLedger();
    await ledger.append({ type: 'verdict', status: 'PASS', n: 1 });
    const firstRaw = store[0];
    await ledger.append({ type: 'verdict', status: 'FAIL', n: 2 });
    const second = JSON.parse(store[1]);
    const expected = await sha256(firstRaw);
    assert.equal(second.prevHash, expected);
  });
});

describe('ledger — verify', () => {
  it('untampered ledger returns { ok: true, firstBadIndex: null }', async () => {
    const { ledger } = memLedger();
    await ledger.append({ type: 'verdict', n: 1 });
    await ledger.append({ type: 'verdict', n: 2 });
    await ledger.append({ type: 'verdict', n: 3 });
    const result = await ledger.verify();
    assert.deepEqual(result, { ok: true, firstBadIndex: null });
  });

  it('tampered line returns { ok: false, firstBadIndex: n }', async () => {
    const { ledger, store } = memLedger();
    await ledger.append({ type: 'verdict', n: 1 });
    await ledger.append({ type: 'verdict', n: 2 });
    await ledger.append({ type: 'verdict', n: 3 });
    // Tamper with the second line (index 1)
    store[1] = store[1].replace('"n":2', '"n":99');
    const result = await ledger.verify();
    assert.equal(result.ok, false);
    // Index 2 is the first entry whose prevHash no longer matches tampered line 1
    assert.equal(result.firstBadIndex, 2);
  });

  it('D4: single-line ledger with wrong prevHash → { ok: false, firstBadIndex: 0 }', async () => {
    const store = [JSON.stringify({ type: 'verdict', prevHash: 'NOT-GENESIS', ts: new Date().toISOString() })];
    const ledger = createLedger(async () => [...store], async (l) => { store.push(l); });
    const result = await ledger.verify();
    assert.equal(result.ok, false);
    assert.equal(result.firstBadIndex, 0);
  });

  it('D4: single-line ledger with prevHash GENESIS → { ok: true }', async () => {
    const { ledger } = memLedger();
    await ledger.append({ type: 'verdict', n: 1 });
    const result = await ledger.verify();
    assert.deepEqual(result, { ok: true, firstBadIndex: null });
  });

  it('D4: unparseable line 0 → { ok: false, firstBadIndex: 0 }', async () => {
    const store = ['not valid json'];
    const ledger = createLedger(async () => [...store], async (l) => { store.push(l); });
    const result = await ledger.verify();
    assert.equal(result.ok, false);
    assert.equal(result.firstBadIndex, 0);
  });
});

describe('ledger — tail', () => {
  it('tail(2) on a 5-entry ledger returns last 2 entries', async () => {
    const { ledger } = memLedger();
    for (let i = 1; i <= 5; i++) await ledger.append({ n: i });
    const entries = await ledger.tail(2);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].n, 4);
    assert.equal(entries[1].n, 5);
  });

  it('D4: tail() does not throw on a corrupt line — skips it', async () => {
    const store = [];
    const ledger = createLedger(async () => [...store], async (l) => { store.push(l); });
    await ledger.append({ n: 1 });
    store.push('not-json');
    await ledger.append({ n: 3 });
    // tail(10) should return the two parseable entries, skip the corrupt one
    const entries = await ledger.tail(10);
    assert.ok(Array.isArray(entries));
    // Should not throw; may have 2 or 3 entries depending on slice window, but no throw
    for (const e of entries) {
      assert.ok(typeof e === 'object' && e !== null);
    }
  });
});

describe('Property P4: mutating a non-last line causes verify to return ok: false', () => {
  it('P4', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ x: fc.integer() }), { minLength: 2, maxLength: 6 }),
        fc.integer({ min: 0 }),
        async (entries, randIdx) => {
          const store = [];
          const ledger = createLedger(
            async () => [...store],
            async (line) => { store.push(line); }
          );
          for (const e of entries) await ledger.append(e);
          // Pick a non-last line to corrupt
          const idx = randIdx % (store.length - 1);
          store[idx] = store[idx] + 'X';
          const result = await ledger.verify();
          assert.equal(result.ok, false);
        }
      )
    );
  });
});

describe('Property P7: appending n entries and calling verify always returns ok: true', () => {
  it('P7', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ x: fc.integer() }), { minLength: 0, maxLength: 6 }),
        async (entries) => {
          const { ledger } = memLedger();
          for (const e of entries) await ledger.append(e);
          const result = await ledger.verify();
          assert.deepEqual(result, { ok: true, firstBadIndex: null });
        }
      )
    );
  });
});
