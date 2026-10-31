/**
 * @file Type definitions for the Charon skeleton.
 * This file contains only JSDoc typedefs — no runtime code.
 */

/**
 * Structured evidence read from an artifact or its environment before judgement.
 * Plain, JSON-serialisable object with no required fields.
 * @typedef {Record<string, unknown>} Evidence
 */

/**
 * The result of a single check: what was measured, the threshold, and whether it passed.
 * @typedef {{
 *   checkId: string,
 *   measured: number | string | boolean,
 *   threshold: number | string | boolean | null,
 *   unit: string | null,
 *   passed: boolean
 * }} Finding
 */

/**
 * A pure function from evidence to a finding.
 * May be async. Must carry a `checkId` string property.
 * @typedef {(evidence: Evidence) => Finding | Promise<Finding>} Check
 */

/**
 * A gate definition: names a set of checks and their identifiers.
 * @typedef {{ id: string, version: string, checks: Check[] }} GateDef
 */

/**
 * The outcome of running all checks in a gate against an artifact.
 * @typedef {{
 *   status: 'PASS' | 'FAIL' | 'HOLD',
 *   artifactHash: string,
 *   gateHash: string,
 *   findings: Finding[],
 *   ts: string
 * }} Verdict
 */

/**
 * A single line in the append-only ledger.
 * @typedef {{
 *   type: 'verdict' | 'override',
 *   prevHash: string,
 *   ts: string,
 *   [key: string]: unknown
 * }} LedgerEntry
 */
