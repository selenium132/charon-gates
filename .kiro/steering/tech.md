---
inclusion: always
---
# Tech steering

- Node 20+ ESM JavaScript with JSDoc types. No build step. The core has **zero runtime dependencies** and runs
  unchanged in Node and in the browser (no `fs`, `path`, `process`, or `Buffer` in `skeleton/core`).
- Hashing through WebCrypto (`globalThis.crypto.subtle`).
- Checks are pure functions from evidence to a finding. All randomness is seeded so that verdicts are deterministic.
- Tests: `node --test`. Properties with `fast-check` (dev dependency only). Every Toll rule has at least one property test.
- Layout: `skeleton/` is the template. `apps/ghost-viewer/` and `apps/seance/` are two separate applications that
  import from the skeleton and contain only their domain checks, evidence readers and UI.
- Apps run as static pages (no server, no accounts, no API keys). User files never leave the browser.
- Do not read or write outside this repository. Do not use the network except to install npm dev dependencies.
- Keep it lean: if the skeleton grows past 600 lines of non-test code, stop and say why.
- Identity: never put a personal name in code, docs, commits or demos. The author is "Kanemochi".
