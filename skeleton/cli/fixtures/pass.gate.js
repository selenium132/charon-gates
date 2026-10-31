/**
 * @file Fixture gate: always passes.
 */

const alwaysPass = (_ev) => ({
  checkId: 'always-pass',
  measured: 1,
  threshold: 1,
  unit: null,
  passed: true,
});
alwaysPass.checkId = 'always-pass';

/** @type {import('../../core/types.js').GateDef} */
const gate = {
  id: 'fixture-pass',
  version: '1.0.0',
  checks: [alwaysPass],
};

export default gate;
