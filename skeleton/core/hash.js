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
 * Serialises `{ id, version, checks }` where `checks` is an array of `checkId`
 * strings (sorted key order), UTF-8 encoded.
 * @param {GateDef} gateDef - The gate definition to hash.
 * @returns {Promise<string>} Lowercase 64-character hex string.
 */
export async function gateHash(gateDef) {
  const payload = JSON.stringify({
    checks: gateDef.checks.map((fn) => fn.checkId),
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
