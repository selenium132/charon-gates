# ghost-viewer — Tasks

## Task 1: gate.js + gate.test.js
Create `apps/ghost-viewer/gate.js` with `profile`, `GATE_DEF`, and all 9 checks.
Create `apps/ghost-viewer/gate.test.js` with unit tests and fast-check property tests for every check.
Commit: `feat(ghost-viewer): gate checks and property tests`

## Task 2: skeleton/web adapters
Create `skeleton/web/localStorage-ledger.js` and `skeleton/web/verdict-renderer.js`.
Commit: `feat(skeleton/web): localStorage ledger adapter and verdict renderer`

## Task 3: reader.js
Create `apps/ghost-viewer/reader.js` with `extractEvidence(file)`, `makeCursedEvidence()`, `makeCleanEvidence()`.
No test needed (browser APIs; verified visually via the page).
Commit: `feat(ghost-viewer): browser evidence reader and synthetic samples`

## Task 4: index.html + ui.js (complete UI)
Create `apps/ghost-viewer/index.html` and `apps/ghost-viewer/ui.js`.
Wires drop target, synthetic buttons, verdict display, contact sheet, ledger, JSONL download.
Commit: `feat(ghost-viewer): static page UI`

## Task 5: package.json + README
Create `apps/ghost-viewer/package.json` (type:module, test script using node --test).
Create `apps/ghost-viewer/README.md` (one paragraph).
Commit: `feat(ghost-viewer): package and readme`
