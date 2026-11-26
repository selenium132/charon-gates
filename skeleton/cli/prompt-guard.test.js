import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { overrideTerminalProblem } from './prompt-guard.js';

describe('F8 override prompt visibility', () => {
  it('both TTY -> allowed', () => {
    assert.equal(overrideTerminalProblem({ stdinIsTTY: true, stderrIsTTY: true }), null);
  });
  it('stderr redirected (prompt would be hidden) -> refused', () => {
    assert.match(overrideTerminalProblem({ stdinIsTTY: true, stderrIsTTY: false }), /stderr/);
    assert.match(overrideTerminalProblem({ stdinIsTTY: true, stderrIsTTY: undefined }), /visible prompt/);
  });
  it('stdin not TTY -> refused', () => {
    assert.match(overrideTerminalProblem({ stdinIsTTY: false, stderrIsTTY: true }), /interactive terminal/);
  });
});
