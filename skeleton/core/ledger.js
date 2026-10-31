/**
 * @file Append-only, hash-chained ledger.
 * I/O-agnostic: callers supply readLines and appendLine callbacks.
 */

/** @import { LedgerEntry } from './types.js' */

/**
 * Computes the SHA-256 hex digest of a UTF-8 string via WebCrypto.
 * @param {string} line
 * @returns {Promise<string>}
 */
async function sha256ofLine(line) {
  const bytes = new TextEncoder().encode(line);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Creates a ledger object backed by caller-supplied I/O callbacks.
 * The core never touches `fs`, `path`, `process`, or `Buffer`.
 *
 * @param {() => Promise<string[]>} readLines - Returns every raw line in the ledger.
 * @param {(line: string) => Promise<void>} appendLine - Appends exactly one line.
 * @returns {{ append: (entry: object) => Promise<void>, verify: () => Promise<{ok: boolean, firstBadIndex: number|null}>, tail: (n?: number) => Promise<LedgerEntry[]> }}
 */
export function createLedger(readLines, appendLine) {
  /**
   * Appends `entry` to the ledger with a computed `prevHash` and `ts`.
   * @param {object} entry - Plain object to persist (must be JSON-serialisable).
   * @returns {Promise<void>}
   */
  async function append(entry) {
    const lines = await readLines();
    const prevHash =
      lines.length === 0 ? 'GENESIS' : await sha256ofLine(lines[lines.length - 1]);
    const record = { ...entry, prevHash, ts: new Date().toISOString() };
    await appendLine(JSON.stringify(record));
  }

  /**
   * Replays all ledger lines and verifies the hash chain.
   * Also checks that line 0's prevHash is exactly 'GENESIS'.
   * @returns {Promise<{ok: boolean, firstBadIndex: number|null}>}
   */
  async function verify() {
    const lines = await readLines();
    if (lines.length === 0) return { ok: true, firstBadIndex: null };

    // Check line 0 independently: must parse and have prevHash === 'GENESIS'.
    let first;
    try {
      first = JSON.parse(lines[0]);
    } catch {
      return { ok: false, firstBadIndex: 0 };
    }
    if (first.prevHash !== 'GENESIS') {
      return { ok: false, firstBadIndex: 0 };
    }

    for (let i = 1; i < lines.length; i++) {
      const expected = await sha256ofLine(lines[i - 1]);
      let parsed;
      try {
        parsed = JSON.parse(lines[i]);
      } catch {
        return { ok: false, firstBadIndex: i };
      }
      if (parsed.prevHash !== expected) {
        return { ok: false, firstBadIndex: i };
      }
    }
    return { ok: true, firstBadIndex: null };
  }

  /**
   * Returns the last `n` entries as parsed objects. Skips unparseable lines.
   * @param {number} [n=10]
   * @returns {Promise<LedgerEntry[]>}
   */
  async function tail(n = 10) {
    const lines = await readLines();
    const results = [];
    for (const l of lines.slice(-n)) {
      try { results.push(JSON.parse(l)); } catch { /* skip corrupt line */ }
    }
    return results;
  }

  return { append, verify, tail };
}
