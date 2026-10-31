# Toll-Fixes: Tasks

Each task is a single atomic commit. Tests are written before the fix (red → green).

---

- [ ] **T1** D1: gateHash covers check params and fn source
  - Add failing property test P3c in `core/hash.test.js`
  - Update `gateHash` in `core/hash.js` to hash checkId + sorted params + fn.toString()
  - Update the D1 known-vector test with the new expected hash

- [ ] **T2** D2: zero-check gate returns HOLD
  - Add failing test in `core/judge.test.js`
  - Add zero-check guard in `core/judge.js`

- [ ] **T3** D3: NaN/Infinity measured and non-boolean passed return HOLD
  - Add failing tests in `core/judge.test.js` (NaN, Infinity, non-boolean passed)
  - Add property tests P8 (NaN/Inf → HOLD) and P9 (non-boolean passed → HOLD)
  - Add `isFiniteMeasured` helper and update check loop in `core/judge.js`

- [ ] **T4** D4: ledger.verify checks line 0; tail() swallows JSON errors
  - Add failing tests in `core/ledger.test.js` for single-line replace and corrupt tail
  - Fix `verify()` to check line 0 prevHash === GENESIS
  - Fix `tail()` to skip unparseable lines

- [ ] **T5** D5: hook reads correct Kiro CLI 2.37 field names and blocks on unreadable payload
  - Update test fixtures in `hooks/hooks.test.js` to use `tool_name`/`tool_input` shape
  - Update stdin parse block to exit 2 on empty/invalid payload
  - Update field reads in `pre-release.js`

- [ ] **T6** D6: hook verifies ledger chain, uses live gateHash, scans full ledger newest-first
  - Add failing tests in `hooks/hooks.test.js` for broken chain, stale PASS, full scan
  - Add `gatePath` requirement and live gateHash computation
  - Add `verify()` call before entry scan
  - Fix `tail(Infinity)` to return all entries
  - Update `charon-hook.example.json` to include `gatePath`

- [ ] **T7** D7: CLI override requires TTY + hash prefix; hook blocks override commands and ledger writes
  - Add failing CLI test (non-TTY → exit 2) in `cli/cli.test.js`
  - Add failing hook tests (charon override command → blocked; ledger write → blocked) in `hooks/hooks.test.js`
  - Add TTY guard and readline prompt to `override` case in `cli/charon.js`
  - Add override-command and ledger-write guards in `pre-release.js`

- [ ] **T8** D8: example hook command fails closed
  - Update `charon-hook.example.json` command to `node skeleton/hooks/pre-release.js || exit 2`
  - (No code change needed; the example JSON is the artefact)

- [ ] **T9** Repo self-application: .kiro hooks, agent, MCP config, and root charon-hook.json
  - Create `.kiro/hooks/toll-gate.json`
  - Create `.kiro/hooks/test-on-save.json`
  - Create `.kiro/agents/ferryman.json`
  - Create `.kiro/settings/mcp.json`
  - Create `charon-hook.json` at the repo root
