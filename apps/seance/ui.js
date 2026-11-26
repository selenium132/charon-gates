/**
 * @file seance UI glue.
 * Wires the CSV inputs, file drop, synthetic sample buttons, verdict display,
 * bootstrap chart, ledger, and JSONL download.
 * Runs in the browser only.
 */

import { judge } from '../../skeleton/core/index.js';
import { GATE_DEF, bootstrapMeans, defaults } from './gate.js';
import {
  parseEvidenceCSV,
  parseSubmissionsCSV,
  hashFile,
  hashText,
  makeGhostEvidence,
  makeRealEvidence,
} from './reader.js';
import { createLocalStorageLedger } from '../../skeleton/web/localStorage-ledger.js';
import { renderVerdict } from '../../skeleton/web/verdict-renderer.js';

const LEDGER_KEY = 'charon:seance:ledger';
const ledger = createLocalStorageLedger(LEDGER_KEY);

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

/** @type {HTMLTextAreaElement} */ let evidenceInput;
/** @type {HTMLTextAreaElement} */ let submissionsInput;
/** @type {HTMLInputElement} */   let fileInput;
/** @type {HTMLElement} */        let fileLabel;
/** @type {HTMLButtonElement} */  let runBtn;
/** @type {HTMLButtonElement} */  let ghostBtn;
/** @type {HTMLButtonElement} */  let realBtn;
/** @type {HTMLElement} */        let statusLine;
/** @type {HTMLElement} */        let verdictArea;
/** @type {HTMLElement} */        let chartArea;
/** @type {HTMLElement} */        let ledgerArea;
/** @type {HTMLElement} */        let ledgerSection;

document.addEventListener('DOMContentLoaded', () => {
  evidenceInput   = /** @type {HTMLTextAreaElement} */ (document.getElementById('evidence-input'));
  submissionsInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('submissions-input'));
  fileInput       = /** @type {HTMLInputElement} */   (document.getElementById('file-input'));
  fileLabel       = document.getElementById('file-label');
  runBtn          = /** @type {HTMLButtonElement} */  (document.getElementById('btn-run'));
  ghostBtn        = /** @type {HTMLButtonElement} */  (document.getElementById('btn-ghost'));
  realBtn         = /** @type {HTMLButtonElement} */  (document.getElementById('btn-real'));
  statusLine      = document.getElementById('status-line');
  verdictArea     = document.getElementById('verdict-area');
  chartArea       = document.getElementById('chart-area');
  ledgerArea      = document.getElementById('ledger-area');
  ledgerSection   = document.getElementById('ledger-section');

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileLabel.textContent = f ? f.name : 'No file chosen';
  });

  runBtn.addEventListener('click', runFromInputs);
  ghostBtn.addEventListener('click', () => runSynthetic('ghost'));
  realBtn.addEventListener('click', () => runSynthetic('real'));

  document.getElementById('btn-download')
    ?.addEventListener('click', downloadLedger);
});

// ---------------------------------------------------------------------------
// Run pipeline — user inputs
// ---------------------------------------------------------------------------

async function runFromInputs() {
  setBusy(true);
  setStatus('Parsing…');
  try {
    const pairs = parseEvidenceCSV(evidenceInput.value);
    const submissions = parseSubmissionsCSV(submissionsInput.value);

    // Artifact: file hash if supplied, otherwise hash the pasted evidence text
    const file = fileInput.files?.[0] ?? null;
    let fileHash = null;
    let artifactBytes;
    if (file) {
      setStatus('Hashing file…');
      fileHash = await hashFile(file);
      artifactBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const combined = evidenceInput.value + '\n' + submissionsInput.value;
      fileHash = await hashText(combined);
      artifactBytes = new TextEncoder().encode(combined);
    }

    const candidateMean = pairs.length === 0
      ? 0
      : pairs.reduce((a, r) => a + r.candidate, 0) / pairs.length;

    const todayCount = await countTodaySubmissions();

    /** @type {import('./gate.js').SeanceEvidence} */
    const rawBest = document.getElementById('public-best').value.trim();
    const publicBest = rawBest === '' ? null : Number(rawBest);
    const ev = { pairs, submissions, fileHash, candidateMean, publicBest, todayCount };

    const label = file ? file.name : '[pasted evidence]';
    await runGate(ev, artifactBytes, label);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// Run pipeline — synthetic samples
// ---------------------------------------------------------------------------

/**
 * @param {'ghost'|'real'} kind
 */
async function runSynthetic(kind) {
  setBusy(true);
  setStatus(`Loading ${kind === 'ghost' ? 'The ghost' : 'The real thing'}…`);
  try {
    const sample = kind === 'ghost' ? makeGhostEvidence() : makeRealEvidence();
    await runGate(sample.evidence, sample.artifactBytes, sample.label);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// Core gate runner
// ---------------------------------------------------------------------------

/**
 * @param {import('./gate.js').SeanceEvidence} ev
 * @param {Uint8Array} artifactBytes
 * @param {string} label
 */
async function runGate(ev, artifactBytes, label) {
  setStatus('Judging…');

  // Toll rule 1: no pairs and no file hash → no evidence
  const effectiveEvidence = (ev.pairs.length === 0 && ev.fileHash == null) ? null : ev;
  const verdict = await judge(GATE_DEF, effectiveEvidence, artifactBytes);

  setStatus('Measured. The verdict below comes from the numbers.');

  // Verdict card
  verdictArea.innerHTML = '';
  verdictArea.appendChild(renderVerdict(verdict, label));

  // Render failure guidance
  renderGuidance(verdict, label);

  // Bootstrap chart
  chartArea.innerHTML = '';
  const diffs = ev.pairs.map((r) => r.candidate - r.best);
  if (diffs.length >= 2) {
    const sortedMeans = bootstrapMeans(diffs, defaults.seed, defaults.resamples);
    chartArea.appendChild(renderBootstrapChart(sortedMeans, defaults.resamples));
  }

  // Ledger
  await ledger.append({ type: 'verdict', ...verdict, artifact: label });
  const verifyResult = await ledger.verify();
  renderLedgerStatus(verifyResult);
}

// ---------------------------------------------------------------------------
// Failure guidance
// ---------------------------------------------------------------------------

const GUIDANCE = {
  'sample-size':       'Add more paired rows: you need at least 5 before the gate can measure anything.',
  'paired-z':          'The mean improvement is not large enough relative to its variance. Gather more pairs or wait for a more consistent gain.',
  'bootstrap-lower':   'The bootstrap 2.5th percentile crossed zero. The improvement is not reliably positive at this sample size.',
  'no-duplicate':      'This file was already submitted. Upload the correct new submission file.',
  'public-local-rank': 'Your local scores do not track the public leaderboard. Local validation cannot be trusted; investigate your validation setup.',
  'level-gap':         'The candidate score is more than the allowed gap behind the public best. Close the gap before spending a submission.',
  'quota':             'You have used all submissions allowed today. Wait until tomorrow.',
};

/**
 * @param {import('../../skeleton/core/types.js').Verdict} verdict
 * @param {string} _label
 */
function renderGuidance(verdict, _label) {
  const existing = document.getElementById('guidance-area');
  if (existing) existing.remove();

  const failingChecks = verdict.findings.filter((f) => !f.passed);
  if (failingChecks.length === 0) return;

  const section = document.createElement('section');
  section.id = 'guidance-area';
  section.setAttribute('aria-label', 'What to do next');
  section.style.cssText = 'margin-top:1rem;';

  const heading = document.createElement('p');
  heading.style.cssText = 'font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--dim);margin-bottom:0.5rem;';
  heading.textContent = 'What to do next';
  section.appendChild(heading);

  const ul = document.createElement('ul');
  ul.style.cssText = 'list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.4rem;';

  for (const f of failingChecks) {
    const msg = GUIDANCE[f.checkId];
    if (!msg) continue;
    const li = document.createElement('li');
    li.style.cssText = 'font-size:0.85rem;color:var(--text);padding:0.4rem 0.6rem;background:var(--surface);border-left:3px solid var(--fail);border-radius:0 4px 4px 0;';
    li.textContent = msg;
    ul.appendChild(li);
  }
  section.appendChild(ul);
  verdictArea.appendChild(section);
}

// ---------------------------------------------------------------------------
// Bootstrap chart (inline SVG)
// ---------------------------------------------------------------------------

/**
 * Renders a histogram of bootstrap means with 0 line and 2.5th-pct line.
 * @param {number[]} sortedMeans  Already sorted array of means.
 * @param {number} resamples
 * @returns {HTMLElement}
 */
function renderBootstrapChart(sortedMeans, resamples) {
  const BINS = 30;
  const SVG_H = 80;
  const LABEL_H = 16;
  const TOTAL_H = SVG_H + LABEL_H;
  const min = sortedMeans[0];
  const max = sortedMeans[sortedMeans.length - 1];
  const range = max - min || 1e-10;

  // Bin the data
  const counts = new Array(BINS).fill(0);
  for (const m of sortedMeans) {
    const bin = Math.min(BINS - 1, Math.floor(((m - min) / range) * BINS));
    counts[bin]++;
  }
  const maxCount = Math.max(...counts);

  const lower = sortedMeans[Math.floor(0.025 * resamples)];

  // Map value → x in [0, 100] (percentage)
  const toX = (v) => ((v - min) / range) * 100;

  const barW = 100 / BINS;

  // Build SVG string
  let bars = '';
  for (let i = 0; i < BINS; i++) {
    const h = (counts[i] / maxCount) * SVG_H;
    const x = i * barW;
    const y = SVG_H - h;
    bars += `<rect x="${x.toFixed(2)}%" y="${y.toFixed(2)}" width="${(barW - 0.3).toFixed(2)}%" height="${h.toFixed(2)}" fill="#6b5a2e" opacity="0.85"/>`;
  }

  const zeroX = toX(0);
  const lowerX = toX(lower);

  // Zero line (white dashed)
  const zeroLine = (zeroX >= 0 && zeroX <= 100)
    ? `<line x1="${zeroX.toFixed(2)}%" y1="0" x2="${zeroX.toFixed(2)}%" y2="${SVG_H}" stroke="#e8e0d0" stroke-width="1.5" stroke-dasharray="4,3" />`
    : '';

  // 2.5th percentile line (amber)
  const lowerLine = (lowerX >= 0 && lowerX <= 100)
    ? `<line x1="${lowerX.toFixed(2)}%" y1="0" x2="${lowerX.toFixed(2)}%" y2="${SVG_H}" stroke="#c8922a" stroke-width="2" />`
    : '';

  const zeroLabel = '';
  const lowerLabel = '';

  const svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${TOTAL_H}" viewBox="0 0 100 ${TOTAL_H}" preserveAspectRatio="none" role="img" aria-label="Bootstrap distribution of mean paired difference">${bars}${zeroLine}${lowerLine}${zeroLabel}${lowerLabel}</svg>`;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:1.5rem;';

  const title = document.createElement('p');
  title.style.cssText = 'font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--dim);margin-bottom:0.4rem;';
  title.textContent = 'Bootstrap distribution — mean paired difference';
  wrap.appendChild(title);

  const chartWrap = document.createElement('div');
  chartWrap.style.cssText = 'background:var(--surface);border-radius:4px;padding:0.5rem 0.5rem 0;overflow:hidden;';
  chartWrap.innerHTML = svgHtml;
  wrap.appendChild(chartWrap);

  const legend = document.createElement('p');
  legend.style.cssText = 'font-size:0.72rem;color:var(--dim);margin-top:0.3rem;';
  legend.innerHTML = '<span style="color:#e8e0d0">&#8212;&#8212;</span> zero &nbsp;&nbsp; <span style="color:#c8922a">&#8212;</span> 2.5th percentile';
  wrap.appendChild(legend);

  return wrap;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/**
 * Counts ledger entries whose `ts` field is today (local date).
 * @returns {Promise<number>}
 */
async function countTodaySubmissions() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const all = await ledger.tail(10000);
  return all.filter(
    (e) => e.type === 'verdict' && typeof e.ts === 'string' && e.ts.startsWith(today),
  ).length;
}

/**
 * @param {{ ok: boolean, firstBadIndex: number | null }} result
 */
function renderLedgerStatus(result) {
  ledgerArea.innerHTML = '';
  const line = document.createElement('p');
  line.style.cssText = 'font-size:0.8rem;font-family:monospace;margin:0;';
  if (result.ok) {
    line.style.color = '#3a7d44';
    line.textContent = 'Ledger chain intact.';
  } else {
    line.style.color = '#8b1a1a';
    line.textContent = `Ledger chain broken at entry ${result.firstBadIndex}.`;
  }
  ledgerArea.appendChild(line);
  ledgerSection.hidden = false;
}

async function downloadLedger() {
  const tail = await ledger.tail(10000);
  const jsonl = tail.map((e) => JSON.stringify(e)).join('\n');
  const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'seance-ledger.jsonl';
  a.click();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {string} msg */
function setStatus(msg) {
  if (statusLine) statusLine.textContent = msg;
}

/** @param {boolean} busy */
function setBusy(busy) {
  runBtn.disabled = busy;
  ghostBtn.disabled = busy;
  realBtn.disabled = busy;
}
