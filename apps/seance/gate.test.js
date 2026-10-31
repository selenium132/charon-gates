/**
 * @file seance gate unit tests + fast-check property tests.
 * Run with: node --test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  defaults,
  bootstrapMeans,
  makeSampleSizeCheck,
  makePairedZCheck,
  makeBootstrapLowerCheck,
  makeNoDuplicateCheck,
  makePublicLocalRankCheck,
  makeLevelGapCheck,
  makeQuotaCheck,
  GATE_DEF,
} from './gate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a SeanceEvidence from minimal parts. */
function evidence(pairs = [], overrides = {}) {
  const candidateMean = pairs.length === 0
    ? 0
    : pairs.reduce((a, r) => a + r.candidate, 0) / pairs.length;
  return {
    pairs,
    submissions: [],
    fileHash: null,
    candidateMean,
    todayCount: 0,
    ...overrides,
  };
}

/**
 * Generate n pairs with candidate = (base_i + noise) + delta, best = base_i + noise.
 * Adding index-based spread ensures variance > 0 so SE > 0 and z is meaningful.
 */
function makePairs(n, delta) {
  return Array.from({ length: n }, (_, i) => {
    const base = 0.5 + i * 0.1; // spread prevents zero variance
    return { id: String(i), candidate: base + delta, best: base };
  });
}

// ---------------------------------------------------------------------------
// sample-size
// ---------------------------------------------------------------------------

describe('sample-size', () => {
  const check = makeSampleSizeCheck(defaults);

  it('HOLD when pairs < minPairs', () => {
    const f = check(evidence(makePairs(3, 0.1)));
    assert.equal(f.measured, null);
    assert.equal(f.passed, false);
  });

  it('passes when pairs >= minPairs', () => {
    const f = check(evidence(makePairs(5, 0.1)));
    assert.equal(f.measured, 5);
    assert.equal(f.passed, true);
  });

  it('HOLD when pairs is empty', () => {
    const f = check(evidence([]));
    assert.equal(f.measured, null);
    assert.equal(f.passed, false);
  });
});

// ---------------------------------------------------------------------------
// paired-z
// ---------------------------------------------------------------------------

describe('paired-z', () => {
  const check = makePairedZCheck(defaults);

  it('passes with clearly positive z', () => {
    const f = check(evidence(makePairs(20, 0.5)));
    assert.ok(f.measured >= defaults.minZ, `z=${f.measured} should be >= ${defaults.minZ}`);
    assert.equal(f.passed, true);
  });

  it('fails with negative mean diff (higherIsBetter)', () => {
    // Use pairs with varying bases so variance > 0, and mean diff clearly negative
    const pairs = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      candidate: 0.5 + i * 0.05, // increasing bases
      best: 0.5 + i * 0.05 + 0.5, // best is always 0.5 higher
    }));
    const f = check(evidence(pairs));
    assert.ok(f.measured < 0, `expected z < 0, got ${f.measured}`);
    assert.equal(f.passed, false);
  });

  it('fails with zero difference (z = 0)', () => {
    const f = check(evidence(makePairs(20, 0)));
    assert.equal(f.measured, 0);
    assert.equal(f.passed, false);
  });

  it('sign inverts when higherIsBetter = false', () => {
    const checkDown = makePairedZCheck({ ...defaults, higherIsBetter: false });
    const pairs = makePairs(20, 0.5);
    const fUp = check(evidence(pairs));
    const fDown = checkDown(evidence(pairs));
    assert.ok(fUp.measured > 0);
    assert.ok(fDown.measured < 0);
  });

  it('measured z is a finite number', () => {
    const f = check(evidence(makePairs(10, 0.5)));
    assert.ok(typeof f.measured === 'number');
    assert.ok(Number.isFinite(f.measured));
  });
});

// ---------------------------------------------------------------------------
// bootstrap-lower
// ---------------------------------------------------------------------------

describe('bootstrap-lower', () => {
  const check = makeBootstrapLowerCheck(defaults);

  it('passes when all diffs clearly positive', () => {
    const f = check(evidence(makePairs(20, 0.5)));
    assert.ok(f.measured > 0);
    assert.equal(f.passed, true);
  });

  it('fails when all diffs are zero', () => {
    const f = check(evidence(makePairs(20, 0)));
    assert.ok(f.measured <= 0);
    assert.equal(f.passed, false);
  });

  it('fails when all diffs clearly negative', () => {
    const f = check(evidence(makePairs(20, -0.5)));
    assert.ok(f.measured < 0);
    assert.equal(f.passed, false);
  });

  it('is deterministic with same seed', () => {
    const pairs = makePairs(20, 0.1);
    const ev = evidence(pairs);
    const f1 = check(ev);
    const f2 = check(ev);
    assert.equal(f1.measured, f2.measured);
  });
});

// ---------------------------------------------------------------------------
// no-duplicate
// ---------------------------------------------------------------------------

describe('no-duplicate', () => {
  const check = makeNoDuplicateCheck(defaults);

  it('passes when no file hash provided', () => {
    const f = check(evidence([], { fileHash: null, submissions: [{ hash: 'abc', local: 0.9, public: 0.8 }] }));
    assert.equal(f.passed, true);
    assert.equal(f.measured, 0);
  });

  it('passes when file hash not in submissions', () => {
    const f = check(evidence([], { fileHash: 'xyz', submissions: [{ hash: 'abc', local: 0.9, public: 0.8 }] }));
    assert.equal(f.passed, true);
  });

  it('fails when file hash matches a submission', () => {
    const f = check(evidence([], { fileHash: 'abc', submissions: [{ hash: 'abc', local: 0.9, public: 0.8 }] }));
    assert.equal(f.passed, false);
    assert.equal(f.measured, 1);
  });
});

// ---------------------------------------------------------------------------
// public-local-rank
// ---------------------------------------------------------------------------

describe('public-local-rank', () => {
  const check = makePublicLocalRankCheck(defaults);

  const goodSubs = [
    { hash: 'a', local: 0.9, public: 0.88 },
    { hash: 'b', local: 0.85, public: 0.83 },
    { hash: 'c', local: 0.80, public: 0.79 },
    { hash: 'd', local: 0.75, public: 0.72 },
  ];

  it('passes with perfectly correlated subs', () => {
    const f = check(evidence([], { submissions: goodSubs }));
    assert.ok(f.measured >= defaults.minRank);
    assert.equal(f.passed, true);
  });

  it('skips (passes, measured "skipped") when < 4 subs and requireRank false', () => {
    const f = check(evidence([], { submissions: goodSubs.slice(0, 2) }));
    assert.equal(f.measured, 'skipped');
    assert.equal(f.passed, true);
  });

  it('HOLDs when < 4 subs and requireRank true', () => {
    const strictCheck = makePublicLocalRankCheck({ ...defaults, requireRank: true });
    const f = strictCheck(evidence([], { submissions: goodSubs.slice(0, 2) }));
    assert.equal(f.measured, null);
    assert.equal(f.passed, false);
  });

  it('fails when public and local ranks are negatively correlated', () => {
    const subs = [
      { hash: 'a', local: 0.9, public: 0.70 },
      { hash: 'b', local: 0.85, public: 0.75 },
      { hash: 'c', local: 0.80, public: 0.80 },
      { hash: 'd', local: 0.75, public: 0.88 },
    ];
    const f = check(evidence([], { submissions: subs }));
    assert.ok(f.measured < defaults.minRank);
    assert.equal(f.passed, false);
  });
});

// ---------------------------------------------------------------------------
// level-gap
// ---------------------------------------------------------------------------

describe('level-gap', () => {
  it('is HOLD evidence (measured null) when the level is unknown', () => {
    const check = makeLevelGapCheck(defaults); // publicBest: null
    const r = check({ pairs: [], submissions: [], fileHash: null, candidateMean: 0.9, todayCount: 0 });
    assert.equal(r.measured, null);
    assert.equal(r.passed, false);
  });

  it('passes when candidateMean is close to publicBest', () => {
    const check = makeLevelGapCheck({ ...defaults, publicBest: 1.0 });
    const f = check(evidence(makePairs(5, 0.1), { candidateMean: 0.98 }));
    // gap = (0.98 - 1.0) / 1.0 * 100 = -2% which is within maxGapPct 5
    assert.equal(f.passed, true);
  });

  it('fails when candidateMean is far below publicBest', () => {
    const check = makeLevelGapCheck({ ...defaults, publicBest: 1.0 });
    const f = check(evidence(makePairs(5, 0.1), { candidateMean: 0.9 }));
    // gap = (0.9 - 1.0) / 1.0 * 100 = -10% which exceeds maxGapPct 5
    assert.equal(f.passed, false);
  });

  it('passes when candidateMean exceeds publicBest', () => {
    const check = makeLevelGapCheck({ ...defaults, publicBest: 1.0 });
    const f = check(evidence(makePairs(5, 0.1), { candidateMean: 1.05 }));
    assert.equal(f.passed, true);
  });
});

// ---------------------------------------------------------------------------
// quota
// ---------------------------------------------------------------------------

describe('quota', () => {
  it('skips (passes) when dailyLimit not set', () => {
    const check = makeQuotaCheck(defaults); // dailyLimit: null
    const f = check(evidence([], { todayCount: 99 }));
    assert.equal(f.passed, true);
  });

  it('passes when todayCount below limit', () => {
    const check = makeQuotaCheck({ ...defaults, dailyLimit: 5 });
    const f = check(evidence([], { todayCount: 3 }));
    assert.equal(f.passed, true);
    assert.equal(f.measured, 3);
  });

  it('fails when todayCount equals limit', () => {
    const check = makeQuotaCheck({ ...defaults, dailyLimit: 5 });
    const f = check(evidence([], { todayCount: 5 }));
    assert.equal(f.passed, false);
  });

  it('fails when todayCount exceeds limit', () => {
    const check = makeQuotaCheck({ ...defaults, dailyLimit: 5 });
    const f = check(evidence([], { todayCount: 7 }));
    assert.equal(f.passed, false);
  });
});

// ---------------------------------------------------------------------------
// GATE_DEF structure
// ---------------------------------------------------------------------------

describe('GATE_DEF', () => {
  it('has 7 checks', () => {
    assert.equal(GATE_DEF.checks.length, 7);
  });

  it('every check has checkId and params', () => {
    for (const check of GATE_DEF.checks) {
      assert.ok(typeof check.checkId === 'string', `missing checkId on ${check.name}`);
      assert.ok(check.params !== undefined, `missing params on ${check.checkId}`);
    }
  });

  it('check ids are unique', () => {
    const ids = GATE_DEF.checks.map((c) => c.checkId);
    assert.equal(new Set(ids).size, ids.length);
  });
});

// ---------------------------------------------------------------------------
// Property tests (fast-check)
// ---------------------------------------------------------------------------

describe('property: sign flip', () => {
  it('swapping candidate and best flips z', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            base: fc.double({ min: 0.1, max: 5, noNaN: true }),
            delta: fc.double({ min: -1, max: 1, noNaN: true }),
          }),
          { minLength: 5, maxLength: 30 },
        ),
        (items) => {
          const pairs = items.map((r, i) => ({ id: String(i), candidate: r.base + r.delta, best: r.base }));
          const pairsSwapped = items.map((r, i) => ({ id: String(i), candidate: r.base, best: r.base + r.delta }));
          const check = makePairedZCheck(defaults);
          const f1 = check(evidence(pairs));
          const f2 = check(evidence(pairsSwapped));
          return Math.abs(f1.measured + f2.measured) < 1e-9;
        },
      ),
    );
  });
});

describe('property: zero diff never passes', () => {
  it('constant difference 0 never passes paired-z or bootstrap-lower', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 30 }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        (n, base) => {
          const pairs = Array.from({ length: n }, () => ({ id: '0', candidate: base, best: base }));
          const ev = evidence(pairs);
          const fz = makePairedZCheck(defaults)(ev);
          const fb = makeBootstrapLowerCheck(defaults)(ev);
          return !fz.passed && !fb.passed;
        },
      ),
    );
  });
});

describe('property: bootstrap determinism', () => {
  it('same seed and pairs always produce the same 2.5th percentile', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { minLength: 5, maxLength: 20 }),
        fc.integer({ min: 1, max: 0xffffffff }),
        (diffs, seed) => {
          const m1 = bootstrapMeans(diffs, seed, 500);
          const m2 = bootstrapMeans(diffs, seed, 500);
          const p1 = m1[Math.floor(0.025 * 500)];
          const p2 = m2[Math.floor(0.025 * 500)];
          return p1 === p2;
        },
      ),
    );
  });
});

describe('property: duplicate hash always fails', () => {
  it('adding the file hash to submissions always fails no-duplicate', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 5 }),
        (fileHash, otherHashes) => {
          const submissions = [...otherHashes, fileHash].map((h) => ({ hash: h, local: 0.9, public: 0.88 }));
          const check = makeNoDuplicateCheck(defaults);
          const f = check(evidence([], { fileHash, submissions }));
          return !f.passed && f.measured === 1;
        },
      ),
    );
  });
});

describe('property: scale invariance of z', () => {
  it('scaling all scores by a positive constant leaves z unchanged', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ candidate: fc.double({ min: 0.1, max: 2, noNaN: true }), best: fc.double({ min: 0.1, max: 2, noNaN: true }) }),
          { minLength: 5, maxLength: 20 },
        ),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        (rawPairs, k) => {
          const pairs = rawPairs.map((r, i) => ({ id: String(i), candidate: r.candidate, best: r.best }));
          const scaled = rawPairs.map((r, i) => ({ id: String(i), candidate: r.candidate * k, best: r.best * k }));
          const check = makePairedZCheck(defaults);
          const f1 = check(evidence(pairs));
          const f2 = check(evidence(scaled));
          return Math.abs(f1.measured - f2.measured) < 1e-3;
        },
      ),
    );
  });
});

describe('samples through judge()', () => {
  it('The ghost is FAIL and The real thing is PASS', async () => {
    const { judge } = await import('../../skeleton/core/index.js');
    const { GATE_DEF } = await import('./gate.js');
    const { makeGhostEvidence, makeRealEvidence } = await import('./reader.js');
    const ghost = makeGhostEvidence();
    const real = makeRealEvidence();
    assert.equal((await judge(GATE_DEF, ghost.evidence, ghost.artifactBytes)).status, 'FAIL');
    assert.equal((await judge(GATE_DEF, real.evidence, real.artifactBytes)).status, 'PASS');
  });
});
