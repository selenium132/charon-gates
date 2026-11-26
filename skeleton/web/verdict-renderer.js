/**
 * @file Reusable verdict renderer for Charon web gates.
 * Pure DOM-building functions — no framework, no external deps.
 */

/** @import { Verdict, Finding } from '../core/types.js' */

const COLOURS = {
  PASS: '#3a7d44',
  FAIL: '#8b1a1a',
  HOLD: '#6b5a2e',
  bg: '#0a0a0c',
  text: '#e8e0d0',
  dim: '#7a7068',
  row0: '#111115',
  row1: '#16161a',
};

/**
 * Creates and returns an HTMLElement that displays the verdict status badge,
 * artifact/gate hashes, timestamp, and a findings table.
 *
 * @param {Verdict} verdict
 * @param {string} [filename]
 * @param {{ explain?: Record<string, { dir: string, meaning: string }>, summary?: boolean }} [opts]
 *   explain: per-check comparison direction (e.g. "<=") and one-line meaning, shown under each row.
 *   summary: show a one-line plain-language result above the table.
 * @returns {HTMLElement}
 */
export function renderVerdict(verdict, filename, opts = {}) {
  const explain = opts.explain ?? null;
  const wrap = el('div', { style: `font-family:system-ui,sans-serif;color:${COLOURS.text};background:${COLOURS.bg};padding:1.5rem;border-radius:8px;` });

  if (filename) {
    wrap.appendChild(el('div', {
      style: `font-size:0.8rem;color:${COLOURS.dim};margin-bottom:0.5rem;word-break:break-all;`,
      textContent: filename,
    }));
  }

  // Status badge
  const badge = el('div', {
    style: `font-size:3rem;font-weight:700;letter-spacing:0.15em;color:${COLOURS[verdict.status] ?? COLOURS.text};margin-bottom:1rem;`,
    textContent: verdict.status,
    role: 'status',
    'aria-live': 'polite',
  });
  wrap.appendChild(badge);

  if (opts.summary) {
    const bad = verdict.findings.filter((f) => !f.passed && f.measured != null).length;
    const held = verdict.findings.filter((f) => f.measured == null).length;
    const text = verdict.status === 'PASS'
      ? `All ${verdict.findings.length} checks passed. Safe to publish.`
      : verdict.status === 'FAIL'
        ? `${bad} of ${verdict.findings.length} checks failed. Do not publish until they are fixed.`
        : `HOLD: ${held} check(s) could not be measured, so nothing is passed. Fix the input and judge again.`;
    wrap.appendChild(el('p', { textContent: text, style: `font-size:1rem;margin:-0.4rem 0 1rem;color:${COLOURS.text};`, 'data-role': 'summary' }));
  }

  // Hash info
  const meta = el('div', { style: `overflow-wrap:anywhere;font-size:0.7rem;font-family:monospace;color:${COLOURS.dim};margin-bottom:1.2rem;line-height:1.6;` });
  meta.innerHTML =
    `artifact&nbsp;sha256: ${verdict.artifactHash}<br>` +
    `gate&nbsp;&nbsp;&nbsp;&nbsp;sha256: ${verdict.gateHash}<br>` +
    `timestamp: ${verdict.ts}`;
  if (opts.summary) {
    // Design: keep the two hashes out of the top of the page; they stay one click away.
    const det = el('details', { style: 'margin-bottom:1rem;' });
    det.appendChild(el('summary', { textContent: 'Show the two hashes that bind this verdict', style: `font-size:0.75rem;color:${COLOURS.dim};cursor:pointer;` }));
    det.appendChild(meta);
    wrap.appendChild(det);
  } else {
    wrap.appendChild(meta);
  }

  if (verdict.findings.length === 0) {
    wrap.appendChild(el('p', { textContent: 'No findings recorded.', style: `color:${COLOURS.dim};` }));
    return wrap;
  }

  // Findings table
  const table = el('table', {
    style: `width:100%;border-collapse:collapse;font-size:0.85rem;font-family:monospace;`,
    role: 'table',
    'aria-label': 'Gate findings',
  });
  const thead = el('thead');
  const hr = el('tr', { style: `color:${COLOURS.dim};text-align:left;` });
  for (const h of (explain ? ['Check', 'Measured', 'Must be', 'Threshold', 'Unit', ''] : ['Check', 'Measured', 'Threshold', 'Unit', ''])) {
    hr.appendChild(el('th', { textContent: h, style: 'padding:0.3rem 0.6rem;white-space:nowrap;' }));
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  verdict.findings.forEach((f, i) => {
    const row = el('tr', { style: `background:${i % 2 === 0 ? COLOURS.row0 : COLOURS.row1};` });
    const statusCell = f.passed
      ? cell('✓', `color:${COLOURS.PASS};`)
      : f.measured == null
        ? cell('HOLD', `color:${COLOURS.HOLD};font-weight:700;`)
        : cell('✗', `color:${COLOURS.FAIL};`);
    const ex = explain?.[f.checkId];
    row.appendChild(cell(f.checkId));
    row.appendChild(cell(f.measured == null ? '—' : String(f.measured)));
    if (explain) row.appendChild(cell(ex?.dir ?? '', `color:${COLOURS.dim};`));
    row.appendChild(cell(f.threshold == null ? '—' : String(f.threshold)));
    row.appendChild(cell(f.unit ?? ''));
    row.appendChild(statusCell);
    tbody.appendChild(row);
    if (ex) {
      const note = el('tr', { style: `background:${i % 2 === 0 ? COLOURS.row0 : COLOURS.row1};` });
      note.appendChild(el('td', { textContent: ex.meaning, colspan: '6', style: `padding:0 0.6rem 0.45rem;font-family:system-ui,sans-serif;font-size:0.75rem;color:${COLOURS.dim};white-space:normal;` }));
      tbody.appendChild(note);
    }
  });
  table.appendChild(tbody);
  const scroller = el('div', { style: 'overflow-x:auto;-webkit-overflow-scrolling:touch;' });
  scroller.appendChild(table);
  wrap.appendChild(scroller);

  if (opts.sourceNote) {
    wrap.appendChild(el('p', { textContent: opts.sourceNote, style: `font-size:0.75rem;color:${COLOURS.dim};margin-top:0.8rem;`, 'data-role': 'source' }));
  }

  return wrap;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} tag
 * @param {Record<string,string>} [attrs]
 * @returns {HTMLElement}
 */
function el(tag, attrs = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'textContent') node.textContent = v;
    else if (k === 'innerHTML') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  return node;
}

/**
 * @param {string} text
 * @param {string} [style]
 * @returns {HTMLElement}
 */
function cell(text, style = '') {
  const td = el('td', { textContent: text, style: `padding:0.3rem 0.6rem;white-space:nowrap;${style}` });
  return td;
}
