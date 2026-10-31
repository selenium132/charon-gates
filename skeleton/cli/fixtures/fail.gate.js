/**
 * @file Fixture gate: always fails.
 */

const alwaysFail = (_ev) => ({
  checkId: 'always-fail',
  measured: 0,
  threshold: 1,
  unit: null,
  passed: false,
});
alwaysFail.checkId = 'always-fail';

/** @type {import('../../core/types.js').GateDef} */
const gate = {
  id: 'fixture-fail',
  version: '1.0.0',
  checks: [alwaysFail],
};

export default gate;
