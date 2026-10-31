/**
 * @file Contact sheet: up to 24 sampled frames with the UI bands outlined. Browser only.
 * Failing frames are always kept and carry a red outline and the reason.
 */
import { implicatedFrames } from './gate.js';

const MAX_FRAMES = 24;

/**
 * Picks at most `max` indices, failing frames first, then evenly spaced ones.
 * @param {string[][]} why
 * @param {number} max
 * @returns {number[]}
 */
export function pickFrames(why, max = MAX_FRAMES) {
  const n = why.length;
  if (n <= max) return why.map((_, i) => i);
  const bad = why.flatMap((w, i) => (w.length ? [i] : []));
  const keep = new Set();
  // Half the sheet for failing frames, evenly spaced among them.
  const badSlots = Math.min(bad.length, Math.ceil(max / 2));
  for (let k = 0; k < badSlots; k++) keep.add(bad[Math.floor((k * bad.length) / badSlots)]);
  for (let k = 0; keep.size < max && k < n; k++) keep.add(Math.floor((k * n) / (max - badSlots)) % n);
  return [...keep].sort((a, b) => a - b).slice(0, max);
}

/**
 * @param {import('./gate.js').VideoEvidence} ev
 * @param {{checkId:string,passed:boolean}[]} findings
 * @param {typeof import('./gate.js').profile} p
 * @returns {HTMLElement}
 */
export function renderContactSheet(ev, findings, p) {
  const W = p.frameW;
  const H = p.frameH;
  const topH = Math.round((H * p.bands.topPct) / 100);
  const botH = Math.round((H * p.bands.bottomPct) / 100);
  const rightW = Math.round((W * p.bands.rightPct) / 100);
  const why = implicatedFrames(ev, findings, p);

  const grid = document.createElement('div');
  grid.setAttribute('role', 'list');
  grid.setAttribute('aria-label', 'Sampled frames');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin-top:1rem;';

  for (const i of pickFrames(why)) {
    const f = ev.frames[i];
    const item = document.createElement('figure');
    item.setAttribute('role', 'listitem');
    item.style.cssText = 'margin:0;font:11px/1.35 ui-monospace,monospace;color:#8f8678;';

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.style.cssText = 'display:block;width:100%;height:auto;';
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let k = 0; k < f.data.length; k++) {
      img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = f.data[k];
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(150,120,255,0.10)';
    ctx.fillRect(0, 0, W - rightW, topH);
    ctx.fillRect(0, H - botH, W - rightW, botH);
    ctx.fillRect(W - rightW, 0, rightW, H);
    ctx.strokeStyle = 'rgba(170,145,255,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, topH + 0.5, W - rightW - 1, H - topH - botH - 1);

    if (why[i].length) canvas.style.outline = '2px solid #cc2222';
    const cap = document.createElement('figcaption');
    cap.style.marginTop = '4px';
    cap.textContent = `${f.time.toFixed(1)} s${why[i].length ? ' · ' + why[i].join(', ') : ''}`;
    if (why[i].length) cap.style.color = '#e06a5e';
    item.append(canvas, cap);
    grid.appendChild(item);
  }
  return grid;
}
