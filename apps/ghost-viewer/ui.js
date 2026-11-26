/**
 * @file ghost-viewer UI glue.
 * Wires the drop target, synthetic sample buttons, verdict display,
 * contact sheet, ledger append/verify, and JSONL download.
 * Runs in the browser only.
 */

import { judge, artifactHash } from '../../skeleton/core/index.js';
import { GATE_DEF, profile } from './gate.js';
import { extractEvidence, makeCursedEvidence, makeCleanEvidence, makeNoAudioEvidence } from './reader.js';
import { renderContactSheet } from './sheet.js';
import { createLocalStorageLedger } from '../../skeleton/web/localStorage-ledger.js';
import { renderVerdict } from '../../skeleton/web/verdict-renderer.js';

const EXPLAIN = {
  'aspect-ratio': { dir: '≈', meaning: 'Width ÷ height must match 9:16, or platforms crop or letterbox it.' },
  'resolution': { dir: '≥', meaning: 'Short side in pixels; below the minimum the video looks soft on a phone.' },
  'duration': { dir: '≤', meaning: 'Length in seconds; longer than the limit is not a Short.' },
  'black-frames': { dir: '≤', meaning: 'Share of sampled frames that are almost black. A black opening makes viewers swipe away.' },
  'frozen-run': { dir: '≤', meaning: 'Longest stretch where the picture does not change, in seconds.' },
  'silence-run': { dir: '≤', meaning: 'Longest stretch with no sound, in seconds. HOLD if there is no audio track to measure.' },
  'ui-band-intrusion': { dir: '≤', meaning: 'Share of the app-covered top, bottom and right bands that holds important detail.' },
  'off-centre-layout': { dir: '≤', meaning: 'How far the main content sits from the horizontal centre, in percent.' },
  'opening-motion': { dir: '≥', meaning: 'Average frame-to-frame change in the first seconds. Too low means a dead opening.' },
};

const LEDGER_KEY = 'charon:ghost-viewer:ledger';
const ledger = createLocalStorageLedger(LEDGER_KEY);

// ---------------------------------------------------------------------------
// DOM refs (resolved once DOMContentLoaded)
// ---------------------------------------------------------------------------

/** @type {HTMLElement} */ let dropZone;
/** @type {HTMLElement} */ let statusLine;
/** @type {HTMLElement} */ let verdictArea;
/** @type {HTMLElement} */ let contactArea;
/** @type {HTMLElement} */ let ledgerArea;
/** @type {HTMLButtonElement} */ let cursedBtn;
/** @type {HTMLButtonElement} */ let cleanBtn;
/** @type {HTMLButtonElement} */ let downloadBtn;

document.addEventListener('DOMContentLoaded', () => {
  dropZone = document.getElementById('drop-zone');
  statusLine = document.getElementById('status-line');
  verdictArea = document.getElementById('verdict-area');
  contactArea = document.getElementById('contact-area');
  ledgerArea = document.getElementById('ledger-area');
  cursedBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-cursed'));
  cleanBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-clean'));
  downloadBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-download'));

  // Drop target
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) runFile(file);
  });
  // Click to browse
  dropZone.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = () => { if (input.files?.[0]) runFile(input.files[0]); };
    input.click();
  });
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dropZone.click(); }
  });

  cursedBtn.addEventListener('click', () => runSynthetic('cursed'));
  cleanBtn.addEventListener('click', () => runSynthetic('clean'));
  document.getElementById('btn-nosound').addEventListener('click', () => runSynthetic('no sound track'));
  downloadBtn.addEventListener('click', downloadLedger);
});

// ---------------------------------------------------------------------------
// Run pipeline
// ---------------------------------------------------------------------------

/**
 * @param {File} file
 */
async function runFile(file) {
  setStatus('Reading…');
  setBusy(true);
  try {
    const [evidence, fileBytes] = await Promise.all([
      extractEvidence(file, setStatus),
      file.arrayBuffer().then((ab) => new Uint8Array(ab)),
    ]);
    await runGate(evidence, fileBytes, file.name);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

/**
 * @param {'cursed'|'clean'|'no sound track'} kind
 */
async function runSynthetic(kind) {
  setStatus(`Synthesising ${kind} sample…`);
  setBusy(true);
  try {
    const evidence = kind === 'cursed' ? makeCursedEvidence() : kind === 'clean' ? makeCleanEvidence() : makeNoAudioEvidence();
    // Synthetic artifact bytes: encode the kind label
    const fileBytes = new TextEncoder().encode(`synthetic:${kind}`);
    await runGate(evidence, fileBytes, `[synthetic: ${kind}]`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

/**
 * @param {import('./gate.js').VideoEvidence} evidence
 * @param {Uint8Array} artifactBytes
 * @param {string} label
 */
async function runGate(evidence, artifactBytes, label) {
  setStatus('Judging…');

  // HOLD immediately on zero frames (Toll rule 1 corollary)
  const effectiveEvidence = evidence.frames.length === 0 ? null : evidence;
  const verdict = await judge(GATE_DEF, effectiveEvidence, artifactBytes);

  setStatus('Measured. The verdict below comes from the numbers.');

  // Render verdict
  verdictArea.innerHTML = '';
  verdictArea.appendChild(renderVerdict(verdict, label, { explain: EXPLAIN, summary: true, sourceNote: 'Source of every number: measured in this browser from the sampled frames and audio of the file above (the built-in samples use generated data). The two hashes bind this verdict to that exact input and this exact gate.' }));

  // Render contact sheet
  contactArea.innerHTML = '';
  if (evidence.frames.length > 0) {
    const heading = document.createElement('h2');
    heading.textContent = 'Sampled frames';
    heading.style.cssText = 'font-size:0.9rem;font-weight:600;color:#7a7068;margin:1.5rem 0 0.5rem;';
    contactArea.appendChild(heading);
    contactArea.appendChild(renderContactSheet(evidence, verdict.findings, profile));
  }

  // Append to ledger and show verify result
  await ledger.append({ type: 'verdict', ...verdict, artifact: label });
  const verifyResult = await ledger.verify();
  renderLedgerStatus(verifyResult);
}

// ---------------------------------------------------------------------------
// Ledger UI
// ---------------------------------------------------------------------------

/**
 * @param {{ ok: boolean, firstBadIndex: number | null }} result
 */
function renderLedgerStatus(result) {
  ledgerArea.innerHTML = '';
  const line = document.createElement('p');
  line.style.cssText = 'font-size:0.8rem;font-family:monospace;margin:0;';
  if (result.ok) {
    line.style.color = '#3a7d44';
    line.textContent = '✓ Ledger chain verified. No tampering detected.';
  } else {
    line.style.color = '#8b1a1a';
    line.textContent = `✗ Ledger chain broken at entry ${result.firstBadIndex}.`;
  }
  ledgerArea.appendChild(line);
  document.getElementById('ledger-section').hidden = false;
}

async function downloadLedger() {
  const tail = await ledger.tail(10000);
  const jsonl = tail.map((e) => JSON.stringify(e)).join('\n');
  const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ghost-viewer-ledger.jsonl';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStatus(msg) {
  statusLine.textContent = msg;
}

function setBusy(busy) {
  cursedBtn.disabled = busy;
  cleanBtn.disabled = busy;
  document.getElementById('btn-nosound').disabled = busy;
  dropZone.setAttribute('aria-busy', String(busy));
}
