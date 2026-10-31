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

/**
 * Synthesises evidence for a "cursed" video that should fail multiple checks.
 * - All black frames → fails black-frames
 * - Constant frames → fails frozen-run
 * - Null audio → HOLD on silence-run
 * @returns {import('./gate.js').VideoEvidence}
 */
export function makeCursedEvidence() {
  const frames = Array.from({ length: 14 }, (_, i) => ({
    time: i * 0.5,
    data: new Uint8ClampedArray(N), // all zeros = black
  }));
  return {
    width: 1080,
    height: 1920,
    durationSec: 7,
    frames,
    audioRms: null,
  };
}

/**
 * Synthesises evidence for a "clean" video that should pass all checks.
 * - 9:16, 1080×1920, 10 s
 * - Frames with motion (alternating values)
 * - RMS above silence threshold
 * @returns {import('./gate.js').VideoEvidence}
 */
export function makeCleanEvidence() {
  const frames = Array.from({ length: 20 }, (_, i) => {
    const data = new Uint8ClampedArray(N);
    // Vary brightness per frame so frozen-run and opening-motion checks pass
    const base = 80 + (i % 2 === 0 ? 40 : -40);
    // Avoid edges in the UI bands to keep band-intrusion low
    const topH = Math.round(H * profile.bands.topPct / 100);
    const botH = Math.round(H * profile.bands.bottomPct / 100);
    const rightW = Math.round(W * profile.bands.rightPct / 100);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Uniform inside bands, varied texture in central area
        const inBand = y < topH || y >= H - botH || x >= W - rightW;
        if (inBand) {
          data[y * W + x] = 90; // smooth in bands
        } else {
          // Gentle sine-wave texture — creates edges but centred
          data[y * W + x] = Math.round(base + 30 * Math.sin((x - W / 2) / 20) * Math.cos(y / 30));
        }
      }
    }
    return { time: i * 0.5, data };
  });

  return {
    width: 1080,
    height: 1920,
    durationSec: 10,
    frames,
    audioRms: Array.from({ length: 20 }, () => 0.05 + Math.random() * 0.1),
  };
}
