# Field-test bugfixes

Six bugs found during a live 52-second vertical video run. All 28 tests passed before the run.

## F1 — ui-band-intrusion: absolute edge measure

**Bug.** The check compares band Sobel density to `ratio × centre density`. A busy centre raises the bar, so a real headline in the top band measured 0 intrusions.

**Fix.** Replace the relative comparison with an absolute one. A band is *occupied* in a frame when the share of its pixels with Sobel magnitude above `params.edgeMag` (default 80) meets or exceeds `params.minEdgeShare` (default 0.04). `measured` is the share of frames where any band is occupied. Remove `bandIntrusionRatio`; keep `bandIntrusionMaxShare` (0.10).

**Tests.**
- Existing monotonic property must keep passing.
- New regression: synthetic frame with busy centre (sine texture) and a text-like bright/dark edge stripe in the top band → `passed: false`.

## F2 — contact sheet: scale, frame selection, band style

**Bug.** The sheet showed every sampled frame (up to 105), making the page 6 400 px tall. All frames got a red border when *any* finding failed, not just frames that directly triggered a failing check. Band overlays were filled, obscuring the frame.

**Fix.**
- Show at most 24 frames, evenly spaced by index from the full list; always include frames that directly implicate a failing check (black, frozen run, band occupied).
- Mark only frames that a failing check actually implicates.
- Draw bands as thin outlines (1 px stroke) with a faint tint (alpha ≤ 0.10) so the frame stays readable.

## F3 — cursed sample: teach more, fix HOLD

**Bug.** `makeCursedEvidence` produces all-black frames with null audio → HOLD on silence-run, which causes `judge` to return HOLD (not FAIL), and an empty contact sheet teaches nothing.

**Fix.**
- Redesign the cursed sample as a believable broken short: readable fake headline blocks in the top and bottom bands, content pushed left of centre, a ~5 s frozen stretch, a static opening (identical first two frames), and audio with a 4 s silent gap (8 silent windows × 0.5 s). Must yield `FAIL` with at least four failing checks.
- Add a third button **"Judge a video with no sound track"** that calls a new `makeNoAudioEvidence()` helper and shows HOLD, demonstrating Toll rule 1.

## F4 — makeCleanEvidence: seeded randomness

**Bug.** `makeCleanEvidence` calls `Math.random()` for audio RMS, so the same sample produces a different artifact hash on every click.

**Fix.** Replace `Math.random()` with a deterministic mulberry32 seeded generator. Seed value: `0xdeadbeef`. Test: call `makeCleanEvidence()` twice and assert both calls return identical `audioRms` arrays (and thus the same artifact hash).

## F5 — CLI gate path: resolve from cwd

**Bug.** `charon.js` resolves the gate path with `new URL(gatePath, import.meta.url + '/../')`, so running `node skeleton/cli/charon.js judge a.bin skeleton/cli/fixtures/pass.gate.js` from the repo root fails.

**Fix.** Resolve relative gate paths from `process.cwd()` using `pathToFileURL(path.resolve(process.cwd(), gatePath))`. Absolute paths pass through. Add a CLI integration test that spawns from the repo root with relative paths.

## F6 — favicon 404

**Bug.** `index.html` makes no favicon declaration, so the browser requests `/favicon.ico` and gets a 404.

**Fix.** Add an inline `data:` favicon `<link>` in the `<head>` — a tiny orange skull emoji rendered to a 32×32 PNG and base64-encoded, or a minimal SVG data URI.
