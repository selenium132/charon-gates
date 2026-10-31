/**
 * @file ghost-viewer gate: pure checks from evidence to findings.
 * No browser APIs, no fs — runs unchanged in Node and browser.
 */

/**
 * @typedef {{
 *   width: number,
 *   height: number,
 *   durationSec: number,
 *   frames: Array<{ time: number, data: Uint8ClampedArray }>,
 *   audioRms: number[] | null
 * }} VideoEvidence
 */

/** All tunable thresholds and band geometry in one place. */
export const profile = {
  maxSec: 60,
  blackFrameLumaThreshold: 16,
  blackFrameMaxShare: 0.05,
  frozenDiffThreshold: 1.0,
  frozenMaxRunSec: 3,
  silenceRmsThreshold: 0.005,
  silenceMaxRunSec: 2,
  audioWindowSec: 0.5,
  /** UI band geometry — editable estimates, not official platform figures. */
  bands: {
    topPct: 8,
    bottomPct: 20,
    rightPct: 12,
  },
  bandIntrusionRatio: 1.5,
  bandIntrusionMaxShare: 0.10,
  offCentreMaxPct: 12,
  openingMotionMinDiff: 1.0,
  openingMotionSec: 1,
  frameW: 135,
  frameH: 240,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mean luma of a grayscale Uint8ClampedArray.
 * @param {Uint8ClampedArray} data
 * @returns {number}
 */
function meanLuma(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum / data.length;
}

/**
 * Mean absolute difference between two same-length arrays.
 * @param {Uint8ClampedArray} a
 * @param {Uint8ClampedArray} b
 * @returns {number}
 */
function meanAbsDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Computes Sobel magnitude for each pixel; returns flat Float32Array (w×h).
 * Input is a grayscale Uint8ClampedArray, row-major, w×h.
 * @param {Uint8ClampedArray} data
 * @param {number} w
 * @param {number} h
 * @returns {Float32Array}
 */
function sobelMag(data, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = data[(y - 1) * w + (x - 1)];
      const tm = data[(y - 1) * w + x];
      const tr = data[(y - 1) * w + (x + 1)];
      const ml = data[y * w + (x - 1)];
      const mr = data[y * w + (x + 1)];
      const bl = data[(y + 1) * w + (x - 1)];
      const bm = data[(y + 1) * w + x];
      const br = data[(y + 1) * w + (x + 1)];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tm - tr + bl + 2 * bm + br;
      out[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/**
 * Mean of a Float32Array over a rectangular region.
 * @param {Float32Array} mag
 * @param {number} w
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {number}
 */
function meanRegion(mag, w, x0, y0, x1, y1) {
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += mag[y * w + x];
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * Weighted mean column index (edge centroid x) for a region.
 * @param {Float32Array} mag
 * @param {number} w
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {number} column index (0-based)
 */
function centroidX(mag, w, x0, y0, x1, y1) {
  let sumW = 0;
  let sumX = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = mag[y * w + x];
      sumW += v;
      sumX += v * x;
    }
  }
  return sumW === 0 ? (x0 + x1) / 2 : sumX / sumW;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * @param {typeof profile} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeAspectRatioCheck(p) {
  const target = 9 / 16;
  /** @param {VideoEvidence} ev */
  function check(ev) {
    const ratio = ev.width / ev.height;
    const diff = Math.abs(ratio - target) / target;
    return {
      checkId: 'aspect-ratio',
      measured: +ratio.toFixed(4),
      threshold: +target.toFixed(4),
      unit: 'ratio',
      passed: diff <= 0.01,
    };
  }
  check.checkId = 'aspect-ratio';
  check.params = { target };
  return check;
}

/**
 * @param {typeof profile} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeResolutionCheck(p) {
  /** @param {VideoEvidence} ev */
  function check(ev) {
    const shortSide = Math.min(ev.width, ev.height);
    return {
      checkId: 'resolution',
      measured: shortSide,
      threshold: 720,
      unit: 'px',
      passed: shortSide >= 720,
    };
  }
  check.checkId = 'resolution';
  check.params = { minShortSide: 720 };
  return check;
}

/**
 * @param {typeof profile} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeDurationCheck(p) {
  /** @param {VideoEvidence} ev */
  function check(ev) {
    return {
      checkId: 'duration',
      measured: +ev.durationSec.toFixed(2),
      threshold: p.maxSec,
      unit: 's',
      passed: ev.durationSec <= p.maxSec,
    };
  }
  check.checkId = 'duration';
  check.params = { maxSec: p.maxSec };
  return check;
}

/**
 * @param {typeof profile} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeBlackFramesCheck(p) {
  /** @param {VideoEvidence} ev */
  function check(ev) {
    if (!ev.frames || ev.frames.length === 0) {
      return { checkId: 'black-frames', measured: null, threshold: p.blackFrameMaxShare, unit: 'share', passed: false };
    }
    const blackCount = ev.frames.filter((f) => meanLuma(f.data) < p.blackFrameLumaThreshold).length;
    const share = blackCount / ev.frames.length;
    return {
      checkId: 'black-frames',
      measured: +share.toFixed(4),
      threshold: p.blackFrameMaxShare,
      unit: 'share',
      passed: share <= p.blackFrameMaxShare,
    };
  }
  check.checkId = 'black-frames';
  check.params = { lumaThreshold: p.blackFrameLumaThreshold, maxShare: p.blackFrameMaxShare };
  return check;
}

/**
 * @param {typeof profile} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeFrozenRunCheck(p) {
  /** @param {VideoEvidence} ev */
  function check(ev) {
    if (!ev.frames || ev.frames.length < 2) {
      return { checkId: 'frozen-run', measured: 0, threshold: p.frozenMaxRunSec, unit: 's', passed: true };
    }
    let maxRun = 0;
    let curRun = 0;
    for (let i = 1; i < ev.frames.length; i++) {
      const diff = meanAbsDiff(ev.frames[i - 1].data, ev.frames[i].data);
      const dt = ev.frames[i].time - ev.frames[i - 1].time;
      if (diff < p.frozenDiffThreshold) {
        curRun += dt;
        if (curRun > maxRun) maxRun = curRun;
      } else {
        curRun = 0;
      }
    }
    return {
      checkId: 'frozen-run',
      measured: +maxRun.toFixed(2),
      threshold: p.frozenMaxRunSec,
      unit: 's',
      passed: maxRun <= p.frozenMaxRunSec,
    };
  }
  check.checkId = 'frozen-run';
  check.params = { diffThreshold: p.frozenDiffThreshold, maxRunSec: p.frozenMaxRunSec };
  return check;
}

/**
 * @param {typeof profile} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeSilenceRunCheck(p) {
  /** @param {VideoEvidence} ev */
  function check(ev) {
    if (ev.audioRms === null) {
      return { checkId: 'silence-run', measured: null, threshold: p.silenceMaxRunSec, unit: 's', passed: false };
    }
    let maxRun = 0;
    let curRun = 0;
    for (const rms of ev.audioRms) {
      if (rms < p.silenceRmsThreshold) {
        curRun += p.audioWindowSec;
        if (curRun > maxRun) maxRun = curRun;
      } else {
        curRun = 0;
      }
    }
    return {
      checkId: 'silence-run',
      measured: +maxRun.toFixed(2),
      threshold: p.silenceMaxRunSec,
      unit: 's',
      passed: maxRun <= p.silenceMaxRunSec,
    };
  }
  check.checkId = 'silence-run';
  check.params = { rmsThreshold: p.silenceRmsThreshold, maxRunSec: p.silenceMaxRunSec, windowSec: p.audioWindowSec };
  return check;
}

/**
 * @param {typeof profile} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeUiBandIntrusionCheck(p) {
  const { topPct, bottomPct, rightPct } = p.bands;
  /** @param {VideoEvidence} ev */
  function check(ev) {
    if (!ev.frames || ev.frames.length === 0) {
      return { checkId: 'ui-band-intrusion', measured: null, threshold: p.bandIntrusionMaxShare, unit: 'share', passed: false };
    }
    const w = p.frameW;
    const h = p.frameH;
    const topH = Math.round(h * topPct / 100);
    const botH = Math.round(h * bottomPct / 100);
    const rightW = Math.round(w * rightPct / 100);
    // Central area: exclude the bands
    const cx0 = 0;
    const cx1 = w - rightW;
    const cy0 = topH;
    const cy1 = h - botH;

    let intrudingFrames = 0;
    for (const f of ev.frames) {
      const mag = sobelMag(f.data, w, h);
      const centralDensity = meanRegion(mag, w, cx0, cy0, cx1, cy1);
      // Top band density
      const topDensity = meanRegion(mag, w, 0, 0, w - rightW, topH);
      // Bottom band density
      const botDensity = meanRegion(mag, w, 0, h - botH, w - rightW, h);
      // Right rail density
      const rightDensity = meanRegion(mag, w, w - rightW, 0, w, h);
      const threshold = p.bandIntrusionRatio * centralDensity;
      if (topDensity > threshold || botDensity > threshold || rightDensity > threshold) {
        intrudingFrames++;
      }
    }
    const share = intrudingFrames / ev.frames.length;
    return {
      checkId: 'ui-band-intrusion',
      measured: +share.toFixed(4),
      threshold: p.bandIntrusionMaxShare,
      unit: 'share',
      passed: share <= p.bandIntrusionMaxShare,
    };
  }
  check.checkId = 'ui-band-intrusion';
  check.params = { topPct, bottomPct, rightPct, ratio: p.bandIntrusionRatio, maxShare: p.bandIntrusionMaxShare };
  return check;
}

/**
 * @param {typeof profile} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeOffCentreCheck(p) {
  /** @param {VideoEvidence} ev */
  function check(ev) {
    if (!ev.frames || ev.frames.length === 0) {
      return { checkId: 'off-centre-layout', measured: null, threshold: p.offCentreMaxPct, unit: '%', passed: false };
    }
    const w = p.frameW;
    const h = p.frameH;
    const cx = (w - 1) / 2;
    let totalOffset = 0;
    for (const f of ev.frames) {
      const mag = sobelMag(f.data, w, h);
      const cx_ = centroidX(mag, w, 0, 0, w, h);
      totalOffset += Math.abs(cx_ - cx);
    }
    const meanOffsetPx = totalOffset / ev.frames.length;
    const meanOffsetPct = (meanOffsetPx / w) * 100;
    return {
      checkId: 'off-centre-layout',
      measured: +meanOffsetPct.toFixed(2),
      threshold: p.offCentreMaxPct,
      unit: '%',
      passed: meanOffsetPct <= p.offCentreMaxPct,
    };
  }
  check.checkId = 'off-centre-layout';
  check.params = { maxPct: p.offCentreMaxPct };
  return check;
}

/**
 * @param {typeof profile} p
 * @returns {import('../../skeleton/core/types.js').Check}
 */
function makeOpeningMotionCheck(p) {
  /** @param {VideoEvidence} ev */
  function check(ev) {
    if (!ev.frames || ev.frames.length < 2) {
      return { checkId: 'opening-motion', measured: 0, threshold: p.openingMotionMinDiff, unit: 'mean-abs-diff', passed: false };
    }
    // Frames within first openingMotionSec seconds
    const opening = ev.frames.filter((f) => f.time < p.openingMotionSec);
    if (opening.length < 2) {
      // Fall back to first two frames
      const diff = meanAbsDiff(ev.frames[0].data, ev.frames[1].data);
      return {
        checkId: 'opening-motion',
        measured: +diff.toFixed(4),
        threshold: p.openingMotionMinDiff,
        unit: 'mean-abs-diff',
        passed: diff >= p.openingMotionMinDiff,
      };
    }
    let sum = 0;
    let count = 0;
    for (let i = 1; i < opening.length; i++) {
      sum += meanAbsDiff(opening[i - 1].data, opening[i].data);
      count++;
    }
    const mean = sum / count;
    return {
      checkId: 'opening-motion',
      measured: +mean.toFixed(4),
      threshold: p.openingMotionMinDiff,
      unit: 'mean-abs-diff',
      passed: mean >= p.openingMotionMinDiff,
    };
  }
  check.checkId = 'opening-motion';
  check.params = { minDiff: p.openingMotionMinDiff, windowSec: p.openingMotionSec };
  return check;
}

// ---------------------------------------------------------------------------
// Gate definition
// ---------------------------------------------------------------------------

/** @type {import('../../skeleton/core/types.js').GateDef} */
export const GATE_DEF = {
  id: 'ghost-viewer',
  version: '1.0.0',
  checks: [
    makeAspectRatioCheck(profile),
    makeResolutionCheck(profile),
    makeDurationCheck(profile),
    makeBlackFramesCheck(profile),
    makeFrozenRunCheck(profile),
    makeSilenceRunCheck(profile),
    makeUiBandIntrusionCheck(profile),
    makeOffCentreCheck(profile),
    makeOpeningMotionCheck(profile),
  ],
};

// Export individual check factories for testing with custom profiles
export {
  makeAspectRatioCheck,
  makeResolutionCheck,
  makeDurationCheck,
  makeBlackFramesCheck,
  makeFrozenRunCheck,
  makeSilenceRunCheck,
  makeUiBandIntrusionCheck,
  makeOffCentreCheck,
  makeOpeningMotionCheck,
};
