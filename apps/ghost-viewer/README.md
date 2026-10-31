# ghost-viewer

A static pre-publish gate for vertical short videos. Drop a video file onto the page; the browser decodes it with `<video>`, Canvas, and WebAudio, runs nine checks through the Charon core `judge()`, appends the verdict to a localStorage ledger, and renders the result with a contact sheet of sampled frames. No server, no upload — the video stays in the browser.

## Run tests

```
npm install
npm test
```

## Open the page

Serve the repo root with any static file server and open `apps/ghost-viewer/index.html`. The two synthetic sample buttons work without a file.
