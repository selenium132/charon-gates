/**
 * @file Browser evidence extractor for ghost-viewer.
 * Uses <video>, OffscreenCanvas/Canvas, and WebAudio.
 * Not runnable in Node — browser APIs only.
 */

import { profile } from './gate.js';

const FPS = 2; // samples per second
const FRAME_W = profile.frameW; // 135
const FRAME_H = profile.frameH; // 240
const AUDIO_WINDOW_SEC = profile.audioWindowSec; // 0.5

/**
 * Extracts evidence from a File object by decoding in the browser.
 *
 * @param {File} file
 * @param {(progress: string) => void} [onProgress]
 * @returns {Promise<import('./gate.js').VideoEvidence>}
 */
export async function extractEvidence(file, onProgress = () => {}) {
  onProgress('Loading video…');
  const url = URL.createObjectURL(file);
  try {
    const [videoEvidence, audioRms] = await Promise.all([
      extractVideoEvidence(url, onProgress),
      extractAudioRms(file, onProgress).catch(() => null),
    ]);
    return { ...videoEvidence, audioRms };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {string} url
 * @param {(p: string) => void} onProgress
 * @returns {Promise<Omit<import('./gate.js').VideoEvidence, 'audioRms'>>}
 */
async function extractVideoEvidence(url, onProgress) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    const canvas = document.createElement('canvas');
    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    video.addEventListener('error', () => reject(new Error('Video decode error')));

    video.addEventListener('loadedmetadata', async () => {
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;

      if (!duration || !isFinite(duration)) {
        return reject(new Error('Cannot determine video duration'));
      }

      const step = 1 / FPS;
      const times = [];
      for (let t = 0; t < duration; t += step) times.push(t);
      if (times.length === 0) times.push(0);

      /** @type {Array<{ time: number, data: Uint8ClampedArray }>} */
      const frames = [];

      for (const t of times) {
        onProgress(`Sampling frame ${frames.length + 1}/${times.length}…`);
        await seekTo(video, Math.min(t, duration - 0.001));
        ctx.drawImage(video, 0, 0, FRAME_W, FRAME_H);
        const imageData = ctx.getImageData(0, 0, FRAME_W, FRAME_H);
        const gray = rgbaToGrayscale(imageData.data);
        frames.push({ time: t, data: gray });
      }

      resolve({ width, height, durationSec: duration, frames });
    });

    video.src = url;
    video.load();
  });
}

/**
 * Seeks a video element to `t` and waits for seeked event.
 * @param {HTMLVideoElement} video
 * @param {number} t
 * @returns {Promise<void>}
 */
function seekTo(video, t) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

/**
 * Converts RGBA Uint8ClampedArray to grayscale Uint8ClampedArray (BT.601 luma).
 * @param {Uint8ClampedArray} rgba
 * @returns {Uint8ClampedArray}
 */
function rgbaToGrayscale(rgba) {
  const n = rgba.length / 4;
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  }
  return out;
}

/**
 * Decodes audio from a File and returns RMS per AUDIO_WINDOW_SEC window.
 * Returns null if no audio track is found or decoding fails.
 * @param {File} file
 * @param {(p: string) => void} onProgress
 * @returns {Promise<number[] | null>}
 */
async function extractAudioRms(file, onProgress) {
  onProgress('Decoding audio…');
  const audioCtx = new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  let decoded;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    return null;
  } finally {
    audioCtx.close();
  }

  // Mix down to mono
  const n = decoded.numberOfChannels;
  const len = decoded.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < n; ch++) {
    const ch_data = decoded.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += ch_data[i];
  }
  for (let i = 0; i < len; i++) mono[i] /= n;

  const windowSamples = Math.round(AUDIO_WINDOW_SEC * decoded.sampleRate);
  const rms = [];
  for (let start = 0; start < len; start += windowSamples) {
    const end = Math.min(start + windowSamples, len);
    let sum = 0;
    for (let i = start; i < end; i++) sum += mono[i] * mono[i];
    rms.push(Math.sqrt(sum / (end - start)));
  }
  return rms;
}

// ---------------------------------------------------------------------------
// Synthetic samples
// ---------------------------------------------------------------------------

const W = FRAME_W;
const H = FRAME_H;
const N = W * H;

/** Small seeded generator, so that a sample gives the same evidence on every click. */
function seeded(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws rows of text-like blocks into a frame. */
function textBlock(data, x0, y0, width, rows, fg, rnd) {
  for (let r = 0; r < rows; r++) {
    const y = y0 + r * 6;
    let x = x0;
    while (x < x0 + width) {
      const glyph = 2 + Math.floor(rnd() * 4);
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < glyph && x + dx < x0 + width; dx++) {
          const i = (y + dy) * W + x + dx;
          if (i >= 0 && i < N) data[i] = fg;
        }
      }
      x += glyph + 2;
    }
  }
}

/** A frame of a broken short: headline and caption under the UI, content pushed left. */
function brokenFrame(step) {
  const rnd = seeded(1000 + step);
  const data = new Uint8ClampedArray(N).fill(34);
  textBlock(data, 4, 3, 74, 2, 235, seeded(7));
  textBlock(data, 4, H - 34, 74, 4, 235, seeded(9));
  for (let y = 70; y < 170; y++) for (let x = 2; x < 52; x++) data[y * W + x] = 150;
  textBlock(data, 5, 80 + (step % 5) * 6, 44, 6, 20, rnd);
  return data;
}

/**
 * A believable broken short: text in the UI bands, content left of centre, a static
 * opening, a frozen stretch of 5 s, and a 4 s silent gap in the audio.
 * @returns {import('./gate.js').VideoEvidence}
 */
export function makeCursedEvidence() {
  const stills = new Set([0, 1, 2, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  let last = brokenFrame(0);
  const frames = Array.from({ length: 28 }, (_, i) => {
    if (!stills.has(i)) last = brokenFrame(i);
    return { time: i * 0.5, data: last };
  });
  const audioRms = Array.from({ length: 28 }, (_, i) => (i >= 14 && i < 22 ? 0 : 0.08));
  return { width: 1080, height: 1920, durationSec: 14, frames, audioRms };
}

/**
 * A clean short with no sound track. Unreadable evidence is HOLD, never PASS (rule 1).
 * @returns {import('./gate.js').VideoEvidence}
 */
export function makeNoAudioEvidence() {
  const clean = makeCleanEvidence();
  return { ...clean, audioRms: null };
}

/**
 * A short that should pass every check: content inside the safe area, centred, moving, with sound.
 * @returns {import('./gate.js').VideoEvidence}
 */
export function makeCleanEvidence() {
  const rnd = seeded(42);
  const topH = Math.round(H * profile.bands.topPct / 100);
  const botH = Math.round(H * profile.bands.bottomPct / 100);
  const rightW = Math.round(W * profile.bands.rightPct / 100);
  const frames = Array.from({ length: 20 }, (_, i) => {
    const data = new Uint8ClampedArray(N).fill(38);
    // A centred card, kept clear of all three bands and symmetric about the centre.
    const margin = rightW + 3;
    const cardTop = topH + 18;
    const cardBottom = H - botH - 18;
    for (let y = cardTop; y < cardBottom; y++) for (let x = margin; x < W - margin; x++) data[y * W + x] = 150 + (i % 4) * 12;
    textBlock(data, margin + 6, cardTop + 12 + (i % 6) * 6, W - 2 * margin - 12, 8, 24, seeded(100 + i));
    return { time: i * 0.5, data };
  });
  return {
    width: 1080,
    height: 1920,
    durationSec: 10,
    frames,
    audioRms: Array.from({ length: 20 }, () => 0.05 + rnd() * 0.1),
  };
}
