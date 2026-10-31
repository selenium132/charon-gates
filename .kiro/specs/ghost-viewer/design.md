# ghost-viewer — Design

## Directory layout

```
apps/ghost-viewer/
  gate.js          pure checks + profile (Node + browser)
  gate.test.js     unit + property tests (node --test)
  reader.js        browser evidence extractor (<video>, canvas, WebAudio)
  index.html       single static page, imports reader + gate + UI glue
  ui.js            verdict renderer + contact sheet
skeleton/web/
  localStorage-ledger.js   createLedger adapter backed by localStorage
  verdict-renderer.js      reusable PASS/FAIL/HOLD badge + findings table
```

## Data flow

```
File drop → reader.js → Evidence → gate.js checks → judge() → Verdict
                                                              ↓
                                            skeleton/web/localStorage-ledger.js
                                                              ↓
                                              ui.js renders verdict + contact sheet
```

## gate.js — pure check module

Exports:
- `profile` — single object with all thresholds and band params
- `GATE_DEF` — `{ id, version, checks[] }` ready for `judge()`
- Each check function has `.checkId` and `.params` properties attached for `gateHash`

Check logic notes:
- Sobel edge density: for each pixel compute `sqrt(Gx²+Gy²)` on grayscale; mean over the region.
- Edge centroid x: weighted mean of column index by Sobel magnitude.
- Silence-run: if `evidence.audioRms` is null → return `{ measured: null, ... }` → judge sets HOLD.
- Frame difference: mean of `|a[i] - b[i]|` over all pixels between consecutive frames.

## skeleton/web/localStorage-ledger.js

Thin I/O adapter: implements `readLines` and `appendLine` over `localStorage` under a configurable key,
then calls `createLedger` from core. Exports `createLocalStorageLedger(key)`.

## skeleton/web/verdict-renderer.js

Pure DOM-building functions (no framework):
- `renderVerdict(verdict, findings)` → HTMLElement
- `renderContactSheet(frames, findings, profile)` → HTMLElement (canvas per frame, bands drawn, red border on fail)

## Correctness Properties

| Property | Checked by |
|---|---|
| All-black frames (luma=0) → black-frames FAIL | fast-check: fill frames with 0 |
| Mirrored frame → same off-centre magnitude | fast-check: mirror pixel array |
| Adding bright edges inside band → intrusion score non-decreasing | fast-check |
| Constant frames longer than frozen threshold → frozen-run FAIL | fast-check |
| Same evidence → same verdict (determinism) | fast-check |
| Null audioRms → HOLD on silence-run | fast-check |
| aspect-ratio check: w/h ratio within 1% of 9/16 ↔ passed | fast-check |

## Binding

`artifactHash` = SHA-256 of file bytes (Uint8Array).
`gateHash` = SHA-256 of gate definition serialisation (from core).
Old verdicts become invalid when either changes — enforced by core.

## Synthetic samples

`makeCursedEvidence()` and `makeCleanEvidence()` in `reader.js` (or `gate.js`).
- Cursed: black frames (fails black-frames), constant frames (fails frozen-run), null audio (HOLD).
- Clean: normal 9:16 1080×1920 frames with motion, valid RMS.

## UI design

- Background: `#0a0a0c`. Text: `#e8e0d0`. Accent PASS: `#3a7d44`. Accent FAIL: `#8b1a1a`. HOLD: `#6b5a2e`.
- Verdict badge: 4rem bold, centred.
- Findings table: monospace, striped rows.
- Contact sheet: CSS grid, 4 columns, each frame 135×240 canvas, band overlays at 8 % opacity.
- No external resources.
