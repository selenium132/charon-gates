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
 * @returns {HTMLElement}
 */
export function renderVerdict(verdict, filename) {
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

  // Hash info
  const meta = el('div', { style: `overflow-wrap:anywhere;font-size:0.7rem;font-family:monospace;color:${COLOURS.dim};margin-bottom:1.2rem;line-height:1.6;` });
  meta.innerHTML =
    `artifact&nbsp;sha256: ${verdict.artifactHash}<br>` +
    `gate&nbsp;&nbsp;&nbsp;&nbsp;sha256: ${verdict.gateHash}<br>` +
    `timestamp: ${verdict.ts}`;
  wrap.appendChild(meta);

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
  for (const h of ['Check', 'Measured', 'Threshold', 'Unit', '']) {
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
    row.appendChild(cell(f.checkId));
    row.appendChild(cell(f.measured == null ? '—' : String(f.measured)));
    row.appendChild(cell(f.threshold == null ? '—' : String(f.threshold)));
    row.appendChild(cell(f.unit ?? ''));
    row.appendChild(statusCell);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  const scroller = el('div', { style: 'overflow-x:auto;-webkit-overflow-scrolling:touch;' });
  scroller.appendChild(table);
  wrap.appendChild(scroller);

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
