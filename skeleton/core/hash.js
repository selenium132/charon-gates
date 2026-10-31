/**
 * @file Hashing utilities using WebCrypto only (no Node `crypto` module).
 */

/** @import { GateDef } from './types.js' */

/**
 * Returns the SHA-256 hex digest of a byte array.
 * @param {Uint8Array} bytes - The bytes to hash.
 * @returns {Promise<string>} Lowercase 64-character hex string.
 */
export async function artifactHash(bytes) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return hexOf(buf);
}

/**
 * Returns the SHA-256 hex digest of a stable serialisation of the gate definition.
 * Serialises `{ id, version, checks }` where each check entry includes its
 * `checkId`, its optional `params` object (keys sorted), and `fn.toString()`
 * so that loosening a threshold or changing check logic changes the hash.
 * @param {GateDef} gateDef - The gate definition to hash.
 * @returns {Promise<string>} Lowercase 64-character hex string.
 */
export async function gateHash(gateDef) {
  const payload = JSON.stringify({
    checks: gateDef.checks.map((fn) => ({
      checkId: fn.checkId,
      params:
        fn.params != null
          ? Object.fromEntries(
              Object.keys(fn.params)
                .sort()
                .map((k) => [k, fn.params[k]])
            )
          : null,
      source: fn.toString(),
    })),
    id: gateDef.id,
    version: gateDef.version,
  });
  const bytes = new TextEncoder().encode(payload);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return hexOf(buf);
}

/**
 * Converts an ArrayBuffer to a lowercase hex string.
 * @param {ArrayBuffer} buf
 * @returns {string}
 */
function hexOf(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
