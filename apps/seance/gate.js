/**
 * @file seance gate: pure checks from evidence to findings.
 * No browser APIs, no fs — runs unchanged in Node and browser.
 */

/**
 * @typedef {{
 *   pairs: Array<{ id: string, candidate: number, best: number }>,
 *   submissions: Array<{ hash: string, local: number, public: number }>,
 *   fileHash: string | null,
 *   candidateMean: number,
 *   todayCount: number
 * }} SeanceEvidence
 */

/** Default params used by every check factory. */
export const defaults = {
  minPairs: 5,
  minZ: 2.0,
  higherIsBetter: true,
  seed: 0xdeadbeef,
  resamples: 2000,
  minRank: 0.5,
  requireRank: false,
  publicBest: null,
  maxGapPct: 5,
  dailyLimit: null,
};

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/**
 * Mulberry32 seeded PRNG. Returns a function that yields floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard error of an array of numbers.
 * @param {number[]} diffs
 * @returns {number}
 */
function standardError(diffs) {
  const n = diffs.length;
  if (n < 2) return 0;
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const variance = diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance / n);
}

/**
 * Mean of an array.
 * @param {number[]} xs
 * @returns {number}
 */
function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Rank an array from 1..n; ties get average rank.
 * @param {number[]} xs
 * @returns {number[]}
 */
function rank(xs) {
  const indexed = xs.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(xs.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j + 1) / 2; // 1-based avg
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

/**
 * Pearson correlation of two same-length arrays.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function pearson(a, b) {
  const n = a.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const da_ = a[i] - ma;
    const db_ = b[i] - mb;
    num += da_ * db_;
    da += da_ ** 2;
    db += db_ ** 2;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? 0 : num / denom;
}

/**
 * Spearman rank correlation.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function spearman(a, b) {
  return pearson(rank(a), rank(b));
}

// ---------------------------------------------------------------------------
// Public bootstrap export (used by UI chart renderer)
// ---------------------------------------------------------------------------

/**
 * Seeded bootstrap of the mean paired difference.
 * Returns the full sorted array of resampled means.
 * @param {number[]} diffs
 * @param {number} seed
 * @param {number} resamples
 * @returns {number[]}
 */
export function bootstrapMeans(diffs, seed, resamples) {
  const rand = mulberry32(seed);
  const n = diffs.length;
  const means = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += diffs[Math.floor(rand() * n)];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return means;
}

// ---------------------------------------------------------------------------
// Check factories
// ---------------------------------------------------------------------------

/**
 * @param {typeof defaults} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeSampleSizeCheck(p) {
  /** @param {SeanceEvidence} ev */
  function check(ev) {
    const n = ev.pairs?.length ?? 0;
    if (n < p.minPairs) {
      return { checkId: 'sample-size', measured: null, threshold: p.minPairs, unit: 'pairs', passed: false };
    }
    return { checkId: 'sample-size', measured: n, threshold: p.minPairs, unit: 'pairs', passed: true };
  }
  check.checkId = 'sample-size';
  check.params = { minPairs: p.minPairs };
  return check;
}

/**
 * @param {typeof defaults} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makePairedZCheck(p) {
  /** @param {SeanceEvidence} ev */
  function check(ev) {
    const diffs = (ev.pairs ?? []).map((r) => r.candidate - r.best);
    const n = diffs.length;
    if (n < 2) {
      return { checkId: 'paired-z', measured: 0, threshold: p.minZ, unit: 'z', passed: false };
    }
    const m = mean(diffs);
    const se = standardError(diffs);
    const rawZ = se === 0 ? 0 : m / se;
    const z = p.higherIsBetter ? rawZ : -rawZ;
    return {
      checkId: 'paired-z',
      measured: +z.toFixed(4),
      threshold: p.minZ,
      unit: 'z',
      passed: z >= p.minZ,
    };
  }
  check.checkId = 'paired-z';
  check.params = { higherIsBetter: p.higherIsBetter, minZ: p.minZ };
  return check;
}

/**
 * @param {typeof defaults} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeBootstrapLowerCheck(p) {
  /** @param {SeanceEvidence} ev */
  function check(ev) {
    const diffs = (ev.pairs ?? []).map((r) => r.candidate - r.best);
    if (diffs.length === 0) {
      return { checkId: 'bootstrap-lower', measured: 0, threshold: 0, unit: 'delta', passed: false };
    }
    const sortedMeans = bootstrapMeans(diffs, p.seed, p.resamples);
    const lower = sortedMeans[Math.floor(0.025 * p.resamples)];
    return {
      checkId: 'bootstrap-lower',
      measured: +lower.toFixed(6),
      threshold: 0,
      unit: 'delta',
      passed: lower > 0,
    };
  }
  check.checkId = 'bootstrap-lower';
  check.params = { resamples: p.resamples, seed: p.seed };
  return check;
}

/**
 * @param {typeof defaults} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeNoDuplicateCheck(_p) {
  /** @param {SeanceEvidence} ev */
  function check(ev) {
    const knownHashes = new Set((ev.submissions ?? []).map((s) => s.hash));
    const fh = ev.fileHash;
    const isDup = fh != null && knownHashes.has(fh);
    return {
      checkId: 'no-duplicate',
      measured: isDup ? 1 : 0,
      threshold: 0,
      unit: 'bool',
      passed: !isDup,
    };
  }
  check.checkId = 'no-duplicate';
  check.params = {};
  return check;
}

/**
 * @param {typeof defaults} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makePublicLocalRankCheck(p) {
  /** @param {SeanceEvidence} ev */
  function check(ev) {
    const subs = (ev.submissions ?? []).filter(
      (s) => typeof s.local === 'number' && typeof s.public === 'number',
    );
    if (subs.length < 4) {
      if (p.requireRank) {
        return {
          checkId: 'public-local-rank',
          measured: null,
          threshold: p.minRank,
          unit: 'rho',
          passed: false,
        };
      }
      // Skip: pass with note
      return {
        checkId: 'public-local-rank',
        measured: 'skipped',
        threshold: p.minRank,
        unit: 'rho',
        passed: true,
        note: 'fewer than 4 submission pairs — skipped',
      };
    }
    const localScores = subs.map((s) => s.local);
    const publicScores = subs.map((s) => s.public);
    const rho = spearman(localScores, publicScores);
    return {
      checkId: 'public-local-rank',
      measured: +rho.toFixed(4),
      threshold: p.minRank,
      unit: 'rho',
      passed: rho >= p.minRank,
    };
  }
  check.checkId = 'public-local-rank';
  check.params = { minRank: p.minRank, requireRank: p.requireRank };
  return check;
}

/**
 * @param {typeof defaults} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeLevelGapCheck(p) {
  /** @param {SeanceEvidence} ev */
  function check(ev) {
    // The level moves every day, so it is evidence, not gate definition. Unknown level: HOLD.
    const publicBest = ev.publicBest ?? p.publicBest;
    if (publicBest == null || !Number.isFinite(publicBest)) {
      return {
        checkId: 'level-gap',
        measured: null,
        threshold: -p.maxGapPct,
        unit: '%',
        passed: false,
        note: 'best public score not supplied',
      };
    }
    const gapPct = publicBest === 0
      ? 0
      : ((ev.candidateMean - publicBest) / Math.abs(publicBest)) * 100;
    return {
      checkId: 'level-gap',
      measured: +gapPct.toFixed(2),
      threshold: -p.maxGapPct,
      unit: '%',
      passed: gapPct >= -p.maxGapPct,
    };
  }
  check.checkId = 'level-gap';
  check.params = { maxGapPct: p.maxGapPct, publicBest: p.publicBest };
  return check;
}

/**
 * @param {typeof defaults} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeQuotaCheck(p) {
  /** @param {SeanceEvidence} ev */
  function check(ev) {
    if (p.dailyLimit == null) {
      return {
        checkId: 'quota',
        measured: ev.todayCount ?? 0,
        threshold: null,
        unit: 'submissions',
        passed: true,
        note: 'dailyLimit not set — skipped',
      };
    }
    const count = ev.todayCount ?? 0;
    return {
      checkId: 'quota',
      measured: count,
      threshold: p.dailyLimit,
      unit: 'submissions',
      passed: count < p.dailyLimit,
    };
  }
  check.checkId = 'quota';
  check.params = { dailyLimit: p.dailyLimit };
  return check;
}

// ---------------------------------------------------------------------------
// Gate definition
// ---------------------------------------------------------------------------

/** @type {import('../../skeleton/core/types.js').GateDef} */
export const GATE_DEF = {
  id: 'seance',
  version: '1.0.0',
  checks: [
    makeSampleSizeCheck(defaults),
    makePairedZCheck(defaults),
    makeBootstrapLowerCheck(defaults),
    makeNoDuplicateCheck(defaults),
    makePublicLocalRankCheck(defaults),
    makeLevelGapCheck(defaults),
    makeQuotaCheck(defaults),
  ],
};

export {
  makeSampleSizeCheck,
  makePairedZCheck,
  makeBootstrapLowerCheck,
  makeNoDuplicateCheck,
  makePublicLocalRankCheck,
  makeLevelGapCheck,
  makeQuotaCheck,
  mulberry32,
};
