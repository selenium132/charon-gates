/**
 * @file Regression tests for Ferryman finding F4: a gate without id/version must not hash.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gateHash } from './hash.js';

describe('gateHash F4', () => {
  it('rejects a gate with no id', async () => {
    await assert.rejects(() => gateHash({ version: '1', checks: [] }), TypeError);
  });
  it('rejects a gate with no version', async () => {
    await assert.rejects(() => gateHash({ id: 'g', checks: [] }), TypeError);
  });
  it('accepts a gate with id and version', async () => {
    const h = await gateHash({ id: 'g', version: '1', checks: [] });
    assert.match(h, /^[0-9a-f]{64}$/);
  });
});
