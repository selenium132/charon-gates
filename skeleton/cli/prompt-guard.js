/**
 * F8: the override confirmation prompt must reach a human.
 * It is written to stderr (not stdout, which an agent can redirect to a file),
 * and the override is refused when stdin or stderr is not an interactive terminal.
 */
export function overrideTerminalProblem({ stdinIsTTY, stderrIsTTY }) {
  if (!stdinIsTTY) {
    return 'override requires an interactive terminal (process.stdin.isTTY must be true)';
  }
  if (!stderrIsTTY) {
    return 'override requires a visible prompt (process.stderr.isTTY must be true)';
  }
  return null;
}
