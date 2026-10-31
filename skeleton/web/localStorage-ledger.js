/**
 * @file Browser localStorage adapter for the Charon ledger.
 * Wraps createLedger with localStorage I/O.
 * Runs only in a browser (requires globalThis.localStorage).
 */

import { createLedger } from '../core/index.js';

/**
 * Creates a ledger backed by localStorage under the given key.
 * Each ledger line is stored as an item: `key:0`, `key:1`, ...
 * A length counter is stored at `key:__len`.
 *
 * @param {string} key - localStorage namespace prefix.
 * @returns {ReturnType<typeof createLedger>}
 */
export function createLocalStorageLedger(key) {
  function readLines() {
    const len = parseInt(localStorage.getItem(`${key}:__len`) ?? '0', 10);
    const lines = [];
    for (let i = 0; i < len; i++) {
      const line = localStorage.getItem(`${key}:${i}`);
      if (line != null) lines.push(line);
    }
    return Promise.resolve(lines);
  }

  function appendLine(line) {
    const len = parseInt(localStorage.getItem(`${key}:__len`) ?? '0', 10);
    localStorage.setItem(`${key}:${len}`, line);
    localStorage.setItem(`${key}:__len`, String(len + 1));
    return Promise.resolve();
  }

  return createLedger(readLines, appendLine);
}
