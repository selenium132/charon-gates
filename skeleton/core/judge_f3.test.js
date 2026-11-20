// Regression for Ferryman F3: a finding without checkId or threshold must not PASS.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from './judge.js';

const bytes = new Uint8Array([1, 2, 3]);
const gate = (finding) => ({ id: 'g', version: '1', checks: [async () => finding] });

describe('judge F3', () => {
  it('HOLD when checkId is missing', async () => {
    const v = await judge(gate({ measured: 1, threshold: 0, unit: 'x', passed: true }), {}, bytes);
    assert.equal(v.status, 'HOLD');
  });
  it('HOLD when threshold is missing', async () => {
    const v = await judge(gate({ checkId: 'a', measured: 1, unit: 'x', passed: true }), {}, bytes);
    assert.equal(v.status, 'HOLD');
  });
  it('PASS when the finding is complete', async () => {
    const v = await judge(gate({ checkId: 'a', measured: 1, threshold: 0, unit: 'x', passed: true }), {}, bytes);
    assert.equal(v.status, 'PASS');
  });
});
