/**
 * @file Tests for core/override.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildOverrideEntry } from './override.js';

/** Minimal verdict fixture. */
const verdict = {
  status: 'FAIL',
  artifactHash: 'a'.repeat(64),
  gateHash: 'b'.repeat(64),
  findings: [],
  ts: new Date().toISOString(),
};

describe('buildOverrideEntry — valid call', () => {
  it('returns entry with correct shape', () => {
    const entry = buildOverrideEntry(verdict, 'manual review ok', 'alice');
    assert.equal(entry.type, 'override');
    assert.equal(entry.artifactHash, verdict.artifactHash);
    assert.equal(entry.gateHash, verdict.gateHash);
    assert.equal(entry.humanId, 'alice');
    assert.equal(entry.reason, 'manual review ok');
    assert.equal(entry.originalStatus, 'FAIL');
  });
});

describe('buildOverrideEntry — invalid humanId', () => {
  it('empty string throws', () => {
    assert.throws(
      () => buildOverrideEntry(verdict, 'reason', ''),
      (err) => err.message === 'override requires a named human'
    );
  });

  it('null throws', () => {
    assert.throws(
      () => buildOverrideEntry(verdict, 'reason', null),
      (err) => err.message === 'override requires a named human'
    );
  });

  it('undefined throws', () => {
    assert.throws(
      () => buildOverrideEntry(verdict, 'reason', undefined),
      (err) => err.message === 'override requires a named human'
    );
  });
});

describe('Property P5 (fail case): empty-or-nullish humanId always throws', () => {
  it('P5 fail', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', null, undefined),
        (badId) => {
          assert.throws(
            () => buildOverrideEntry(verdict, 'r', badId),
            (err) => err.message === 'override requires a named human'
          );
        }
      )
    );
  });
});

describe('Property P5 (pass case): non-empty humanId always returns valid override entry', () => {
  it('P5 pass', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        (humanId) => {
          const entry = buildOverrideEntry(verdict, 'reason', humanId);
          assert.equal(entry.type, 'override');
          assert.equal(entry.humanId, humanId);
        }
      )
    );
  });
});
