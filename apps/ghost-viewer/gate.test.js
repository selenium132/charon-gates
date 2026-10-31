/**
 * @file Tests for ghost-viewer gate checks.
 * Unit tests + fast-check property tests.
 * Run: node --test gate.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  profile,
  GATE_DEF,
  makeAspectRatioCheck,
  makeResolutionCheck,
  makeDurationCheck,
  makeBlackFramesCheck,
  makeFrozenRunCheck,
  makeSilenceRunCheck,
  makeUiBandIntrusionCheck,
  makeOffCentreCheck,
  makeOpeningMotionCheck,
} from './gate.js';

import {
  makeCursedEvidence,
  makeCleanEvidence,
  makeNoAudioEvidence,
} from './reader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const W = profile.frameW; // 135
const H = profile.frameH; // 240
const N = W * H;

/** @returns {Uint8ClampedArray} */
function blackFrame() {
  return new Uint8ClampedArray(N); // all zeros
}

/** @param {number} v
 * @returns {Uint8ClampedArray}
 */
function solidFrame(v) {
  return new Uint8ClampedArray(N).fill(v);
}

/** @param {{ time: number, data: Uint8ClampedArray }[]} frames */
function baseEvidence(frames) {
  return {
    width: 1080,
    height: 1920,
    durationSec: 10,
    frames,
    audioRms: [0.1],
  };
}

function makeFrame(t, value = 128) {
  return { time: t, data: solidFrame(value) };
}

// ---------------------------------------------------------------------------
// aspect-ratio
// ---------------------------------------------------------------------------

describe('aspect-ratio', () => {
  const check = makeAspectRatioCheck(profile);

  it('passes 9:16 (1080×1920)', () => {
    const f = check({ width: 1080, height: 1920, durationSec: 5, frames: [makeFrame(0)], audioRms: [0.1] });
    assert.equal(f.passed, true);
  });

  it('fails 1:1', () => {
    const f = check({ width: 1080, height: 1080, durationSec: 5, frames: [makeFrame(0)], audioRms: [0.1] });
    assert.equal(f.passed, false);
  });

  it('property: w/h within 1% of 9/16 ↔ passed', () => {
    fc.assert(fc.property(
      fc.integer({ min: 100, max: 4000 }),
      (h) => {
        const target = 9 / 16;
        // width exactly at target
        const w = Math.round(h * target);
        const ev = { width: w, height: h, durationSec: 5, frames: [makeFrame(0)], audioRms: [0.1] };
        const result = check(ev);
        const ratio = w / h;
        const diff = Math.abs(ratio - target) / target;
        assert.equal(result.passed, diff <= 0.01);
      }
    ));
  });

  it('property: clearly non-9:16 ratio fails', () => {
    fc.assert(fc.property(
      fc.integer({ min: 100, max: 4000 }),
      (h) => {
        const w = h; // 1:1, clearly not 9:16
        const ev = { width: w, height: h, durationSec: 5, frames: [makeFrame(0)], audioRms: [0.1] };
        const result = check(ev);
        assert.equal(result.passed, false);
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

describe('resolution', () => {
  const check = makeResolutionCheck(profile);

  it('passes 1080×1920', () => {
    assert.equal(check({ width: 1080, height: 1920, durationSec: 5, frames: [makeFrame(0)], audioRms: [0.1] }).passed, true);
  });

  it('fails 480×854', () => {
    assert.equal(check({ width: 480, height: 854, durationSec: 5, frames: [makeFrame(0)], audioRms: [0.1] }).passed, false);
  });

  it('property: short side < 720 always fails', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 719 }),
      (shortSide) => {
        const ev = { width: shortSide, height: shortSide * 2, durationSec: 5, frames: [makeFrame(0)], audioRms: [0.1] };
        assert.equal(check(ev).passed, false);
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// duration
// ---------------------------------------------------------------------------

describe('duration', () => {
  const check = makeDurationCheck(profile);

  it('passes at exactly maxSec', () => {
    const ev = { ...baseEvidence([makeFrame(0)]), durationSec: profile.maxSec };
    assert.equal(check(ev).passed, true);
  });

  it('fails over maxSec', () => {
    const ev = { ...baseEvidence([makeFrame(0)]), durationSec: profile.maxSec + 1 };
    assert.equal(check(ev).passed, false);
  });
});

// ---------------------------------------------------------------------------
// black-frames
// ---------------------------------------------------------------------------

describe('black-frames', () => {
  const check = makeBlackFramesCheck(profile);

  it('passes with no black frames', () => {
    const frames = [makeFrame(0, 128), makeFrame(0.5, 128)];
    assert.equal(check(baseEvidence(frames)).passed, true);
  });

  it('fails when all frames are black', () => {
    const frames = Array.from({ length: 10 }, (_, i) => ({ time: i * 0.5, data: blackFrame() }));
    assert.equal(check(baseEvidence(frames)).passed, false);
  });

  it('property: all-black frames → measured share = 1 → fail', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 20 }),
      (n) => {
        const frames = Array.from({ length: n }, (_, i) => ({ time: i * 0.5, data: blackFrame() }));
        const result = check(baseEvidence(frames));
        assert.equal(result.measured, 1);
        assert.equal(result.passed, false);
      }
    ));
  });

  it('property: no black frames → pass', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 20 }),
      (n) => {
        const frames = Array.from({ length: n }, (_, i) => ({ time: i * 0.5, data: solidFrame(128) }));
        assert.equal(check(baseEvidence(frames)).passed, true);
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// frozen-run
// ---------------------------------------------------------------------------

describe('frozen-run', () => {
  const check = makeFrozenRunCheck(profile);

  it('passes with varying frames', () => {
    const frames = [
      { time: 0, data: solidFrame(0) },
      { time: 0.5, data: solidFrame(128) },
      { time: 1.0, data: solidFrame(64) },
    ];
    assert.equal(check(baseEvidence(frames)).passed, true);
  });

  it('fails when constant frames exceed max run', () => {
    // 8 identical frames at 0.5s intervals = 3.5 s run > 3 s
    const frames = Array.from({ length: 8 }, (_, i) => ({ time: i * 0.5, data: solidFrame(50) }));
    const result = check(baseEvidence(frames));
    assert.equal(result.passed, false);
  });

  it('property: constant frames for duration > frozenMaxRunSec → fail', () => {
    fc.assert(fc.property(
      fc.integer({ min: 8, max: 20 }),
      fc.integer({ min: 0, max: 200 }),
      (n, v) => {
        // n frames at 0.5s intervals → run = (n-1)*0.5 s
        const frames = Array.from({ length: n }, (_, i) => ({ time: i * 0.5, data: solidFrame(v) }));
        const result = check(baseEvidence(frames));
        // (n-1)*0.5 > 3 when n >= 8
        assert.equal(result.passed, false, `n=${n} v=${v} measured=${result.measured}`);
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// silence-run
// ---------------------------------------------------------------------------

describe('silence-run', () => {
  const check = makeSilenceRunCheck(profile);

  it('null audio → measured null → passed false', () => {
    const ev = { ...baseEvidence([makeFrame(0)]), audioRms: null };
    const r = check(ev);
    assert.equal(r.measured, null);
    assert.equal(r.passed, false);
  });

  it('passes with all non-silent audio', () => {
    const ev = { ...baseEvidence([makeFrame(0)]), audioRms: [0.1, 0.2, 0.3] };
    assert.equal(check(ev).passed, true);
  });

  it('fails with silence run exceeding limit', () => {
    // 5 silent windows × 0.5 s = 2.5 s > 2 s
    const ev = { ...baseEvidence([makeFrame(0)]), audioRms: [0, 0, 0, 0, 0] };
    assert.equal(check(ev).passed, false);
  });

  it('property: null audio always → measured null', () => {
    fc.assert(fc.property(
      fc.constant(null),
      (_) => {
        const ev = { ...baseEvidence([makeFrame(0)]), audioRms: null };
        assert.equal(check(ev).measured, null);
      }
    ));
  });

  it('property: long silence run fails', () => {
    fc.assert(fc.property(
      fc.integer({ min: 5, max: 20 }),
      (n) => {
        const ev = { ...baseEvidence([makeFrame(0)]), audioRms: Array(n).fill(0) };
        assert.equal(check(ev).passed, false);
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// ui-band-intrusion
// ---------------------------------------------------------------------------

describe('ui-band-intrusion', () => {
  const check = makeUiBandIntrusionCheck(profile);

  it('passes with smooth (solid) frames', () => {
    const frames = Array.from({ length: 5 }, (_, i) => ({ time: i * 0.5, data: solidFrame(128) }));
    assert.equal(check(baseEvidence(frames)).passed, true);
  });

  it('regression: busy centre does not hide text-like edge in top band', () => {
    // Construct a frame where the centre has a rich sine texture (many edges)
    // but also has a hard bright/dark stripe in the top band.
    // The old ratio-based check returned 0 because centre density was high.
    // The new absolute check must detect the band as occupied.
    const topH = Math.round(H * profile.bands.topPct / 100);
    const data = new Uint8ClampedArray(N);
    // Busy centre: sine-wave texture
    for (let y = topH; y < H; y++) {
      for (let x = 0; x < W; x++) {
        data[y * W + x] = Math.round(128 + 80 * Math.sin(x / 3) * Math.cos(y / 3));
      }
    }
    // Text-like hard edge stripe inside the top band (row topH-2 bright, topH-1 dark)
    const edgeRow = Math.max(1, topH - 2);
    for (let x = 0; x < W; x++) {
      data[edgeRow * W + x] = 240;
      data[(edgeRow + 1) * W + x] = 10;
    }
    const frames = [{ time: 0, data }];
    const result = check(baseEvidence(frames));
    assert.equal(result.passed, false, `expected FAIL, measured=${result.measured}`);
  });

  it('property: adding bright edges inside band never lowers intrusion score', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 5 }),
      (n) => {
        // baseline: solid grey frames
        const base = Array.from({ length: n }, (_, i) => ({
          time: i * 0.5,
          data: new Uint8ClampedArray(N).fill(100),
        }));
        const baseResult = check(baseEvidence(base));

        // modified: add a bright horizontal edge in the top band
        const topH = Math.round(H * profile.bands.topPct / 100);
        const modified = base.map((f) => {
          const d = new Uint8ClampedArray(f.data);
          // Bright row in top band creates strong edge
          const row = Math.max(1, topH - 2);
          for (let x = 0; x < W; x++) {
            d[row * W + x] = 255;
            d[(row + 1) * W + x] = 0;
          }
          return { time: f.time, data: d };
        });
        const modResult = check(baseEvidence(modified));

        assert.ok(
          modResult.measured >= baseResult.measured,
          `modified(${modResult.measured}) < base(${baseResult.measured})`
        );
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// off-centre-layout
// ---------------------------------------------------------------------------

describe('off-centre-layout', () => {
  const check = makeOffCentreCheck(profile);

  it('passes with uniform frames (centred by symmetry)', () => {
    const frames = [{ time: 0, data: solidFrame(128) }];
    assert.equal(check(baseEvidence(frames)).passed, true);
  });

  it('property: mirrored frame gives same off-centre magnitude', () => {
    fc.assert(fc.property(
      fc.uint8Array({ minLength: N, maxLength: N }),
      (rawData) => {
        const data = new Uint8ClampedArray(rawData.buffer, rawData.byteOffset, N);
        const mirrored = new Uint8ClampedArray(N);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            mirrored[y * W + (W - 1 - x)] = data[y * W + x];
          }
        }
        const r1 = check({ ...baseEvidence([{ time: 0, data }]) });
        const r2 = check({ ...baseEvidence([{ time: 0, data: mirrored }]) });
        // Magnitudes must be equal (tolerance for floating point)
        assert.ok(
          Math.abs(r1.measured - r2.measured) < 0.01,
          `original=${r1.measured} mirrored=${r2.measured}`
        );
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// opening-motion
// ---------------------------------------------------------------------------

describe('opening-motion', () => {
  const check = makeOpeningMotionCheck(profile);

  it('passes with large motion', () => {
    const frames = [
      { time: 0, data: solidFrame(0) },
      { time: 0.5, data: solidFrame(255) },
    ];
    assert.equal(check(baseEvidence(frames)).passed, true);
  });

  it('fails with still opening', () => {
    const frames = [
      { time: 0, data: solidFrame(64) },
      { time: 0.5, data: solidFrame(64) },
      { time: 2, data: solidFrame(200) },
    ];
    assert.equal(check(baseEvidence(frames)).passed, false);
  });
});

// ---------------------------------------------------------------------------
// cursed / no-audio synthetic samples (F3)
// ---------------------------------------------------------------------------

describe('cursed sample', () => {
  it('FAIL with at least four failing checks', async () => {
    const { judge } = await import('../../skeleton/core/index.js');
    const evidence = makeCursedEvidence();
    const bytes = new TextEncoder().encode('synthetic:cursed');
    const verdict = await judge(GATE_DEF, evidence, bytes);
    assert.equal(verdict.status, 'FAIL', `expected FAIL, got ${verdict.status}`);
    const failing = verdict.findings.filter((f) => !f.passed);
    assert.ok(failing.length >= 4, `expected >=4 failing checks, got ${failing.length}: ${failing.map(f=>f.checkId).join(', ')}`);
  });

  it('contact sheet has at least one frame', () => {
    const evidence = makeCursedEvidence();
    assert.ok(evidence.frames.length > 0, 'cursed evidence must have frames');
  });
});

describe('no-audio sample (F3)', () => {
  it('shows HOLD (null audioRms)', async () => {
    const { judge } = await import('../../skeleton/core/index.js');
    const evidence = makeNoAudioEvidence();
    // Null audio causes silence-run to return measured:null → HOLD
    const bytes = new TextEncoder().encode('synthetic:no-audio');
    const verdict = await judge(GATE_DEF, evidence, bytes);
    assert.equal(verdict.status, 'HOLD', `expected HOLD, got ${verdict.status}`);
  });
});

// ---------------------------------------------------------------------------
// makeCleanEvidence determinism (F4)
// ---------------------------------------------------------------------------

describe('makeCleanEvidence determinism (F4)', () => {
  it('two calls return identical audioRms arrays', () => {
    const a = makeCleanEvidence();
    const b = makeCleanEvidence();
    assert.deepEqual(a.audioRms, b.audioRms, 'audioRms must be identical across calls');
  });

  it('two calls return identical frame data', () => {
    const a = makeCleanEvidence();
    const b = makeCleanEvidence();
    assert.equal(a.frames.length, b.frames.length);
    for (let i = 0; i < a.frames.length; i++) {
      assert.deepEqual(a.frames[i].data, b.frames[i].data, `frame ${i} must be identical`);
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism (same evidence → same verdict)
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('property: same evidence always yields same verdict', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 0, max: 255 }),
      async (n, v) => {
        const frames = Array.from({ length: n }, (_, i) => ({ time: i * 0.5, data: solidFrame(v) }));
        const ev = {
          width: 1080, height: 1920, durationSec: 10,
          frames,
          audioRms: [0.1],
        };
        // Run each check twice
        for (const check of GATE_DEF.checks) {
          const r1 = await check(ev);
          const r2 = await check(ev);
          assert.deepEqual(r1, r2);
        }
      }
    ));
  });
});
