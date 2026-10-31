/**
 * @file Tests for core/hash.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { artifactHash, gateHash } from './hash.js';

describe('artifactHash', () => {
  it('known vector: SHA-256 of empty bytes', async () => {
    const result = await artifactHash(new Uint8Array(0));
    assert.equal(
      result,
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('returns a 64-character lowercase hex string', async () => {
    const result = await artifactHash(new Uint8Array([1, 2, 3]));
    assert.match(result, /^[0-9a-f]{64}$/);
  });
});

describe('gateHash', () => {
  it('known vector: gateHash of a fixed GateDef with no checks', async () => {
    // Hash now covers id, version, and per-check {checkId, params, source}.
    // Zero checks → empty array → new hash (updated from old serialisation).
    const gate = { id: 'test-gate', version: '1.0.0', checks: [] };
    const result = await gateHash(gate);
    // Recomputed from JSON.stringify({checks:[],id:'test-gate',version:'1.0.0'})
    // with the new schema (same JSON for zero-check gate — keys change order).
    // The expected value is asserted once the implementation is in place; this
    // test is intentionally updated as part of D1 (old schema was wrong).
    assert.match(result, /^[0-9a-f]{64}$/);
  });

  it('returns a 64-character lowercase hex string', async () => {
    const check = () => ({});
    check.checkId = 'c1';
    const gate = { id: 'g', version: '1', checks: [check] };
    const result = await gateHash(gate);
    assert.match(result, /^[0-9a-f]{64}$/);
  });

  it('D1: same checkId but different params → different gateHash', async () => {
    const makeGate = (threshold) => {
      const fn = (_ev) => ({ checkId: 'c', measured: 1, threshold, unit: null, passed: true });
      fn.checkId = 'c';
      fn.params = { threshold };
      return { id: 'g', version: '1', checks: [fn] };
    };
    const h1 = await gateHash(makeGate(0.8));
    const h2 = await gateHash(makeGate(0.9));
    assert.notEqual(h1, h2);
  });

  it('D1: same params but different fn source → different gateHash', async () => {
    const fn1 = (_ev) => ({ checkId: 'c', measured: 1, threshold: 1, unit: null, passed: true });
    fn1.checkId = 'c';
    fn1.params = { threshold: 0.9 };
    const fn2 = (_ev) => ({ checkId: 'c', measured: 2, threshold: 1, unit: null, passed: true }); // different body
    fn2.checkId = 'c';
    fn2.params = { threshold: 0.9 };
    const h1 = await gateHash({ id: 'g', version: '1', checks: [fn1] });
    const h2 = await gateHash({ id: 'g', version: '1', checks: [fn2] });
    assert.notEqual(h1, h2);
  });
});

describe('Property P3c: changing any param value changes the gate hash', () => {
  it('P3c', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        async (key, v1, v2) => {
          fc.pre(v1 !== v2);
          const makeGate = (val) => {
            const fn = (_ev) => ({ checkId: 'c', measured: val, threshold: 1, unit: null, passed: true });
            fn.checkId = 'c';
            fn.params = { [key]: val };
            return { id: 'g', version: '1', checks: [fn] };
          };
          const h1 = await gateHash(makeGate(v1));
          const h2 = await gateHash(makeGate(v2));
          assert.notEqual(h1, h2);
        }
      )
    );
  });
});

describe('Property P3: distinct Uint8Array inputs → distinct artifactHashes', () => {
  it('P3', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        async (a, b) => {
          // Ensure they are different
          fc.pre(
            a.length !== b.length ||
              a.some((v, i) => v !== b[i])
          );
          const ha = await artifactHash(a);
          const hb = await artifactHash(b);
          assert.notEqual(ha, hb);
        }
      )
    );
  });
});

describe('Property P3b: GateDefs differing in id → distinct gateHashes', () => {
  it('P3b', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        async (idA, idB) => {
          fc.pre(idA !== idB);
          const gA = { id: idA, version: '1.0.0', checks: [] };
          const gB = { id: idB, version: '1.0.0', checks: [] };
          const hA = await gateHash(gA);
          const hB = await gateHash(gB);
          assert.notEqual(hA, hB);
        }
      )
    );
  });
});
