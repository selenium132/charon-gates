/**
 * @file Builds override ledger entries for human-approved exceptions.
 */

/** @import { Verdict } from './types.js' */

/**
 * Constructs a ledger entry recording a human decision to pass an artifact
 * despite a non-PASS verdict. The entry is not yet written to the ledger —
 * pass it to `ledger.append()`.
 *
 * The original `verdict.status` is preserved in `originalStatus`;
 * this function does not alter the verdict object.
 *
 * @param {Verdict} verdict - The verdict being overridden.
 * @param {string} reason - Human-supplied explanation for the override.
 * @param {string | null | undefined} humanId - Non-empty identifier of the human approver.
 * @returns {{ type: 'override', artifactHash: string, gateHash: string, reason: string, humanId: string, originalStatus: string }}
 * @throws {Error} If `humanId` is empty, null, or undefined.
 */
export function buildOverrideEntry(verdict, reason, humanId) {
  if (!humanId) {
    throw new Error('override requires a named human');
  }
  return {
    type: 'override',
    artifactHash: verdict.artifactHash,
    gateHash: verdict.gateHash,
    reason,
    humanId,
    originalStatus: verdict.status,
  };
}
