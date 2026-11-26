/**
 * @file Playhead timeline for the Ghost Viewer "Live scan" screen.
 * Pure function: walks the same evidence the gate judges, one sample at a time,
 * and keeps the running value of three checks (black-frames, frozen-run, silence-run)
 * using the same rules as gate.js. The last step must equal the gate's own numbers;
 * scan-timeline.test.js checks that, so the animation cannot show a number the gate does not measure.
 */
import { profile } from './gate.js';

function meanLuma(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i];
  return s / data.length;
}

function meanAbsDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/**
 * @param {import('./gate.js').VideoEvidence} ev
 * @param {typeof profile} [p]
 * @returns {{ time:number, black:boolean, still:boolean, silent:boolean|null,
 *   blackShare:number, frozenRun:number, frozenMax:number, silenceRun:number|null, silenceMax:number|null,
 *   tripped:string[] }[]}
 */
export function buildScanSteps(ev, p = profile) {
  const steps = [];
  let blackCount = 0;
  let frozenCur = 0;
  let frozenMax = 0;
  let silCur = 0;
  let silMax = 0;
  const hasAudio = ev.audioRms !== null && ev.audioRms !== undefined;
  const tripped = new Set();
  ev.frames.forEach((f, i) => {
    const black = meanLuma(f.data) < p.blackFrameLumaThreshold;
    if (black) blackCount++;
    let still = false;
    if (i > 0) {
      const dt = f.time - ev.frames[i - 1].time;
      still = meanAbsDiff(ev.frames[i - 1].data, f.data) < p.frozenDiffThreshold;
      if (still) {
        frozenCur += dt;
        if (frozenCur > frozenMax) frozenMax = frozenCur;
      } else frozenCur = 0;
    }
    let silent = null;
    if (hasAudio && i < ev.audioRms.length) {
      silent = ev.audioRms[i] < p.silenceRmsThreshold;
      if (silent) {
        silCur += p.audioWindowSec;
        if (silCur > silMax) silMax = silCur;
      } else silCur = 0;
    }
    const blackShare = blackCount / (i + 1);
    // The gate judges the black share over all frames, so it only trips on the last step.
    const now = [];
    if (i === ev.frames.length - 1 && blackCount / ev.frames.length > p.blackFrameMaxShare) now.push('black-frames');
    if (frozenMax > p.frozenMaxRunSec) now.push('frozen-run');
    if (hasAudio && silMax > p.silenceMaxRunSec) now.push('silence-run');
    for (const id of now) tripped.add(id);
    steps.push({
      time: f.time, black, still, silent,
      blackShare, frozenRun: frozenCur, frozenMax,
      silenceRun: hasAudio ? silCur : null, silenceMax: hasAudio ? silMax : null,
      tripped: [...tripped],
    });
  });
  return steps;
}
