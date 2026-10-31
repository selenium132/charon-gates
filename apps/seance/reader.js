/**
 * @file seance evidence reader.
 * CSV parsing, file hashing, and synthetic sample builders.
 * Browser-only for hashing; CSV parsing is pure (runs in Node too).
 */

/** @import { SeanceEvidence } from './gate.js' */

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parses a CSV string with headers `id,candidate,best` into pair rows.
 * Skips blank lines and lines that do not parse to finite numbers.
 *
 * @param {string} csv
 * @returns {Array<{ id: string, candidate: number, best: number }>}
 */
export function parseEvidenceCSV(csv) {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Detect and skip header
  const first = lines[0].toLowerCase();
  const start = first.startsWith('id') ? 1 : 0;

  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;
    const id = parts[0].trim();
    const candidate = parseFloat(parts[1]);
    const best = parseFloat(parts[2]);
    if (!isFinite(candidate) || !isFinite(best)) continue;
    rows.push({ id, candidate, best });
  }
  return rows;
}

/**
 * Parses a CSV string with headers `hash,local,public` into submission rows.
 * Skips blank lines and lines that do not parse to finite numbers (except hash).
 *
 * @param {string} csv
 * @returns {Array<{ hash: string, local: number, public: number }>}
 */
export function parseSubmissionsCSV(csv) {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const first = lines[0].toLowerCase();
  const start = first.startsWith('hash') ? 1 : 0;

  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;
    const hash = parts[0].trim();
    const local = parseFloat(parts[1]);
    const pub = parseFloat(parts[2]);
    if (!hash || !isFinite(local) || !isFinite(pub)) continue;
    rows.push({ hash, local, public: pub });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Artifact hashing (browser only — WebCrypto)
// ---------------------------------------------------------------------------

/**
 * Computes the SHA-256 hex digest of a File's bytes.
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function hashFile(file) {
  const ab = await file.arrayBuffer();
  const buf = await globalThis.crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes the SHA-256 hex digest of a UTF-8 string.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function hashText(text) {
  const bytes = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Synthetic samples
// ---------------------------------------------------------------------------

/**
 * "The ghost" — a lucky public score.
 * candidateMean is better than best, but the paired differences include enough
 * noise that z < 2 and the bootstrap lower bound crosses zero.
 * Result: FAIL on paired-z and bootstrap-lower (or HOLD on sample-size if too few).
 *
 * @returns {{ evidence: SeanceEvidence, artifactBytes: Uint8Array, label: string }}
 */
export function makeGhostEvidence() {
  // 6 pairs — enough to pass sample-size, but differences are noisy
  const pairs = [
    { id: '1', candidate: 0.821, best: 0.810 }, //  +0.011
    { id: '2', candidate: 0.798, best: 0.815 }, //  -0.017
    { id: '3', candidate: 0.830, best: 0.822 }, //  +0.008
    { id: '4', candidate: 0.805, best: 0.818 }, //  -0.013
    { id: '5', candidate: 0.825, best: 0.813 }, //  +0.012
    { id: '6', candidate: 0.812, best: 0.819 }, //  -0.007
  ];
  // mean diff ≈ -0.001, small and noisy — will fail paired-z and bootstrap-lower
  const candidateMean = pairs.reduce((a, r) => a + r.candidate, 0) / pairs.length;
  const ev = /** @type {SeanceEvidence} */ ({
    pairs,
    // The earlier public scores do not follow the local ones.
    submissions: [
      { hash: 'sub001', local: 0.812, public: 0.871 },
      { hash: 'sub002', local: 0.806, public: 0.802 },
      { hash: 'sub003', local: 0.819, public: 0.795 },
      { hash: 'sub004', local: 0.801, public: 0.866 },
      { hash: 'sub005', local: 0.815, public: 0.808 },
    ],
    fileHash: null,
    candidateMean,
    publicBest: 0.902,
    todayCount: 0,
  });
  return {
    evidence: ev,
    artifactBytes: new TextEncoder().encode('synthetic:ghost'),
    label: '[synthetic: The ghost]',
  };
}

/**
 * "The real thing" — a genuine improvement.
 * Consistent positive differences with low variance produce z >= 2 and
 * a bootstrap lower bound clearly above 0.
 *
 * @returns {{ evidence: SeanceEvidence, artifactBytes: Uint8Array, label: string }}
 */
export function makeRealEvidence() {
  const pairs = [
    { id: '1', candidate: 0.872, best: 0.850 }, // +0.022
    { id: '2', candidate: 0.868, best: 0.847 }, // +0.021
    { id: '3', candidate: 0.875, best: 0.851 }, // +0.024
    { id: '4', candidate: 0.863, best: 0.842 }, // +0.021
    { id: '5', candidate: 0.871, best: 0.849 }, // +0.022
    { id: '6', candidate: 0.876, best: 0.853 }, // +0.023
    { id: '7', candidate: 0.869, best: 0.846 }, // +0.023
    { id: '8', candidate: 0.874, best: 0.852 }, // +0.022
  ];
  const candidateMean = pairs.reduce((a, r) => a + r.candidate, 0) / pairs.length;

  // 5 earlier submissions with correlated local/public to pass public-local-rank
  const submissions = [
    { hash: 'sub001', local: 0.850, public: 0.845 },
    { hash: 'sub002', local: 0.842, public: 0.838 },
    { hash: 'sub003', local: 0.838, public: 0.833 },
    { hash: 'sub004', local: 0.831, public: 0.828 },
    { hash: 'sub005', local: 0.825, public: 0.820 },
  ];

  const ev = /** @type {SeanceEvidence} */ ({
    pairs,
    submissions,
    fileHash: null,
    candidateMean,
    publicBest: 0.884,
    todayCount: 1,
  });
  return {
    evidence: ev,
    artifactBytes: new TextEncoder().encode('synthetic:real'),
    label: '[synthetic: The real thing]',
  };
}
