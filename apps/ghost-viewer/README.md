# ghost-viewer

Pre-publish gate for vertical short videos. Runs in the browser; the file never leaves it.

1. Serve the repo root with any static server and open `apps/ghost-viewer/index.html`.
2. Press a sample button (no file, no login), or drop your own vertical video.
3. Read each of the nine rows: the measured value, the threshold, one line on why it matters. FAIL or HOLD means do not publish. Tests: `npm install && npm test`.

Who it is for: a creator whose AI agent says a video is done when the file has a black opening or no sound.

How it works: the browser decodes the file with `<video>`, Canvas and WebAudio, runs nine checks through the Charon core `judge()`, appends the verdict to a localStorage ledger, and shows a contact sheet of sampled frames. A check that cannot be measured is HOLD, never PASS.
