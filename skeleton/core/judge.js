/**
 * @file Gate judgement: runs all checks and produces a Verdict.
 */

import { artifactHash, gateHash } from './hash.js';

/** @import { GateDef, Evidence, Verdict, Finding } from './types.js' */

/**
 * Runs every check in `gateDef` against `evidence` and returns a Verdict.
 *
 * Status precedence: HOLD > FAIL > PASS.
 * HOLD is triggered by: null/undefined evidence, a check that throws, or a
 * check that returns a finding with `measured` equal to null or undefined.
 *
 * @param {GateDef} gateDef - The gate definition (checks + metadata).
 * @param {Evidence | null | undefined} evidence - Structured evidence object.
 * @param {Uint8Array} artifactBytes - Raw bytes of the artifact being judged.
 * @returns {Promise<Verdict>} The verdict for this run.
 */
export async function judge(gateDef, evidence, artifactBytes) {
  const [artH, gateH] = await Promise.all([
    artifactHash(artifactBytes),
    gateHash(gateDef),
  ]);

  const ts = new Date().toISOString();

  // Toll rule 1: no evidence → HOLD immediately, no checks run.
  if (evidence == null) {
    return { status: 'HOLD', artifactHash: artH, gateHash: gateH, findings: [], ts };
  }

  /** @type {Finding[]} */
  const findings = [];
  let forceHold = false;
  let anyFail = false;

  for (const check of gateDef.checks) {
    /** @type {Finding} */
    let finding;
    try {
      finding = await check(evidence);
      if (finding.measured == null) {
        forceHold = true;
      } else if (!finding.passed) {
        anyFail = true;
      }
    } catch (_err) {
      finding = {
        checkId: check.checkId ?? 'unknown',
        measured: null,
        threshold: null,
        unit: null,
        passed: false,
      };
      forceHold = true;
    }
    findings.push(finding);
  }

  const status = forceHold ? 'HOLD' : anyFail ? 'FAIL' : 'PASS';
  return { status, artifactHash: artH, gateHash: gateH, findings, ts };
}
