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
    const gate = { id: 'test-gate', version: '1.0.0', checks: [] };
    const result = await gateHash(gate);
    assert.equal(
      result,
      '81d4445905b6f2a81cd63ec98ed8cc414d947688b830b216aa5fdbd89e0f004a'
    );
  });

  it('returns a 64-character lowercase hex string', async () => {
    const check = () => ({});
    check.checkId = 'c1';
    const gate = { id: 'g', version: '1', checks: [check] };
    const result = await gateHash(gate);
    assert.match(result, /^[0-9a-f]{64}$/);
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
