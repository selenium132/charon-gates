/**
 * @file Gate judgement: runs all checks and produces a Verdict.
 */

import { artifactHash, gateHash } from './hash.js';

/** @import { GateDef, Evidence, Verdict, Finding } from './types.js' */

/**
 * Returns true if `v` is a valid finite measured value (not NaN, not Infinity).
 * Strings and booleans are allowed (they are not numeric and not infinite).
 * @param {unknown} v
 * @returns {boolean}
 */
function isValidMeasured(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  return true; // string or boolean are valid evidence values
}

/**
 * Runs every check in `gateDef` against `evidence` and returns a Verdict.
 *
 * Status precedence: HOLD > FAIL > PASS.
 * HOLD is triggered by: null/undefined evidence, zero checks, a check that
 * throws, a finding with `measured` equal to null/undefined/NaN/Infinity, or
 * a finding whose `passed` is not a boolean.
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

  // Toll rule 1 corollary: a gate with no checks provides no measurement → HOLD.
  if (gateDef.checks.length === 0) {
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
      if (
        finding == null ||
        typeof finding.checkId !== 'string' ||
        finding.checkId === '' ||
        finding.threshold === undefined
      ) {
        // F3: a finding must name its check and state its threshold.
        forceHold = true;
      } else if (finding.measured == null) {
        forceHold = true;
      } else if (!isValidMeasured(finding.measured)) {
        forceHold = true;
      } else if (typeof finding.passed !== 'boolean') {
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
