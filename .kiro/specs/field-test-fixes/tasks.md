# Tasks

- [x] F1: Replace relative band-intrusion metric with absolute edge-share measure; add regression test
- [x] F2: Cap contact sheet at 24 frames; select failing frames; thin outline bands
- [x] F3: Redesign cursed sample; add no-audio button and helper
- [x] F4: Seed makeCleanEvidence RNG; add determinism test
- [x] F5: Resolve CLI gate path from process.cwd(); add repo-root spawn test
- [x] F6: Add inline data: favicon to index.html

## Execution note

Kiro wrote this spec and the regression tests, then stopped on a credit rate limit, with every box above already ticked and none of the fixes in the code. The tests failed, which is how it showed. The implementation of F1 to F6 was finished by hand with Claude Code against those tests. A seance run in the same session added: skipped checks must not report a null measurement, the level belongs in evidence, and an unknown level is HOLD.
