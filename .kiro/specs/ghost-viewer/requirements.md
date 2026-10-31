# ghost-viewer — Requirements (EARS notation)

## REQ-01 Drop target
WHEN the user drags a video file onto the page, the system SHALL decode its frames and audio in the browser without sending any bytes to a server.

## REQ-02 Evidence extraction
WHEN a video file is loaded, the system SHALL extract: width, height, durationSec, an array of grayscale frames sampled at 2 fps (each 135×240 px with its timestamp), and audio RMS values in 0.5 s windows (null when no audio is decoded).

## REQ-03 Gate checks
WHERE evidence is available, the system SHALL run nine checks defined in apps/ghost-viewer/gate.js:
1. aspect-ratio — measured ratio within 1 % of 9:16
2. resolution — short side ≥ 720 px
3. duration — durationSec ≤ params.maxSec
4. black-frames — share of frames with mean luma < 16 ≤ 5 %
5. frozen-run — longest run with mean absolute frame diff < 1.0 ≤ 3 s
6. silence-run — longest run with RMS < 0.005 ≤ 2 s; null audio → measured null → HOLD
7. ui-band-intrusion — share of frames where edge density inside top/bottom/right bands > 1.5× central density ≤ 10 %
8. off-centre-layout — mean absolute horizontal centroid offset as % of width ≤ 12 %
9. opening-motion — mean frame diff over first 1 s ≥ 1.0

## REQ-04 Zero-frame HOLD
IF evidence contains zero frames, the system SHALL produce a HOLD verdict without running checks.

## REQ-05 Finding format
WHILE reporting results, every finding SHALL state measured value, threshold, and unit.

## REQ-06 Verdict display
WHEN a verdict is produced, the system SHALL display the status (PASS / FAIL / HOLD) prominently, one row per check with measured vs threshold, and a contact sheet of sampled frames with UI bands drawn over them and failing frames highlighted in red.

## REQ-07 Ledger
WHEN a verdict is produced, the system SHALL append it to a browser ledger (localStorage) via the skeleton ledger adapter, display the chain-verify result, and offer a JSONL download of the full ledger.

## REQ-08 Artifact binding
The verdict SHALL be bound to the SHA-256 of the file bytes and the SHA-256 of the gate definition.

## REQ-09 Synthetic samples
The page SHALL provide two buttons — "Judge the cursed sample" and "Judge the clean sample" — that synthesise frames and audio entirely in code and are labelled as synthetic, so a judge can run the gate without supplying a file.

## REQ-10 Privacy notice
The page SHALL display a short plain line stating that the video stays in the browser.

## REQ-11 Responsive and accessible
The UI SHALL be usable at phone width (≥ 320 px) and be keyboard-accessible with no missing alt text or unlabelled controls. All fonts SHALL be system fonts or inlined; no external font requests.

## REQ-12 Editable profile
All check thresholds and band percentages SHALL be exported from a single profile object in apps/ghost-viewer/gate.js and SHALL be editable without touching check logic.

## REQ-13 Property tests
Every check SHALL have at least one fast-check property test exercising the specified property.
