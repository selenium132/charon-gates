/**
 * @file Tests for core/judge.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { judge } from './judge.js';

/** Minimal Uint8Array to use as artifact bytes in most tests. */
const BYTES = new Uint8Array([1, 2, 3]);

/** Helper to make a simple check function with a checkId. */
function makeCheck(checkId, measured, threshold, passed) {
  const fn = (_ev) => ({ checkId, measured, threshold, unit: null, passed });
  fn.checkId = checkId;
  return fn;
}

describe('judge — status', () => {
  it('all-passing checks → PASS', async () => {
    const gate = {
      id: 'g', version: '1', checks: [makeCheck('c1', 1, 0, true)],
    };
    const v = await judge(gate, { x: 1 }, BYTES);
    assert.equal(v.status, 'PASS');
  });

  it('one failing check → FAIL', async () => {
    const gate = {
      id: 'g', version: '1',
      checks: [makeCheck('c1', 1, 0, true), makeCheck('c2', 0, 1, false)],
    };
    const v = await judge(gate, {}, BYTES);
    assert.equal(v.status, 'FAIL');
  });

  it('null evidence → HOLD', async () => {
    const gate = { id: 'g', version: '1', checks: [] };
    const v = await judge(gate, null, BYTES);
    assert.equal(v.status, 'HOLD');
  });

  it('throwing check → HOLD', async () => {
    const boom = (_ev) => { throw new Error('boom'); };
    boom.checkId = 'boom';
    const gate = { id: 'g', version: '1', checks: [boom] };
    const v = await judge(gate, {}, BYTES);
    assert.equal(v.status, 'HOLD');
  });

  it('check returning measured: null → HOLD', async () => {
    const nullCheck = (_ev) => ({
      checkId: 'nc', measured: null, threshold: null, unit: null, passed: false,
    });
    nullCheck.checkId = 'nc';
    const gate = { id: 'g', version: '1', checks: [nullCheck] };
    const v = await judge(gate, {}, BYTES);
    assert.equal(v.status, 'HOLD');
  });

  it('D2: zero checks → HOLD', async () => {
    const gate = { id: 'g', version: '1', checks: [] };
    const v = await judge(gate, {}, BYTES);
    assert.equal(v.status, 'HOLD');
  });
});

describe('judge — Verdict shape', () => {
  it('verdict contains artifactHash, gateHash, findings, ts', async () => {
    const gate = { id: 'g', version: '1', checks: [makeCheck('c1', 1, 1, true)] };
    const v = await judge(gate, {}, BYTES);
    assert.ok(typeof v.artifactHash === 'string' && v.artifactHash.length === 64);
    assert.ok(typeof v.gateHash === 'string' && v.gateHash.length === 64);
    assert.ok(Array.isArray(v.findings));
    assert.ok(typeof v.ts === 'string');
    // ISO-8601 UTC
    assert.ok(!isNaN(Date.parse(v.ts)));
  });
});

describe('Property P1: judge with null evidence always returns HOLD', () => {
  it('P1', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 32 }),
        async (bytes) => {
          const gate = { id: 'g', version: '1', checks: [] };
          const v = await judge(gate, null, bytes);
          assert.equal(v.status, 'HOLD');
        }
      )
    );
  });
});

describe('Property P6: HOLD dominates FAIL when mixed outcomes contain null measured', () => {
  it('P6', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 32 }),
        async (bytes) => {
          const failCheck = (_ev) => ({
            checkId: 'fail', measured: 0, threshold: 1, unit: null, passed: false,
          });
          failCheck.checkId = 'fail';
          const nullCheck = (_ev) => ({
            checkId: 'null', measured: null, threshold: null, unit: null, passed: false,
          });
          nullCheck.checkId = 'null';
          const gate = { id: 'g', version: '1', checks: [failCheck, nullCheck] };
          const v = await judge(gate, {}, bytes);
          assert.equal(v.status, 'HOLD');
        }
      )
    );
  });
});

describe('Property P2: every finding has checkId, measured, threshold fields', () => {
  it('P2', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            checkId: fc.string({ minLength: 1 }),
            measured: fc.oneof(fc.integer(), fc.string(), fc.boolean()),
            threshold: fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)),
            passed: fc.boolean(),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        fc.uint8Array({ minLength: 0, maxLength: 32 }),
        async (checkDefs, bytes) => {
          const checks = checkDefs.map(({ checkId, measured, threshold, passed }) => {
            const fn = (_ev) => ({ checkId, measured, threshold, unit: null, passed });
            fn.checkId = checkId;
            return fn;
          });
          const gate = { id: 'g', version: '1', checks };
          const v = await judge(gate, {}, bytes);
          for (const f of v.findings) {
            assert.ok('checkId' in f);
            assert.ok('measured' in f);
            assert.ok('threshold' in f);
          }
        }
      )
    );
  });
});
