# Seance — Design

## File layout

```
apps/seance/
  gate.js          pure checks, params, GATE_DEF (Node + browser)
  gate.test.js     node --test + fast-check properties
  reader.js        CSV parsers, artifact hashing, synthetic samples (browser only)
  ui.js            DOM wiring, judge call, ledger, chart (browser only)
  index.html       single-page static UI
  package.json
index.html         root landing page
README.md          root docs
LICENSE            MIT 2026 Kanemochi
```

## Evidence shape (`SeanceEvidence`)

```js
{
  pairs: Array<{ id: string, candidate: number, best: number }>,
  submissions: Array<{ hash: string, local: number, public: number }>,
  fileHash: string | null,   // SHA-256 of dropped file, or null
  candidateMean: number,     // mean of candidate column
  todayCount: number,        // ledger entries from today (computed by ui.js)
}
```

## Check design

| checkId | measured | threshold | unit | HOLD condition |
|---|---|---|---|---|
| `sample-size` | pair count | `minPairs` | `pairs` | count < minPairs → measured null |
| `paired-z` | z-score | `minZ` | `z` | none (needs sample-size to pass first in logic, but judge handles HOLD from sample-size already) |
| `bootstrap-lower` | 2.5th pct of bootstrap means | 0 | `delta` | none |
| `no-duplicate` | 1 if dup found else 0 | 0 | `bool` | — |
| `public-local-rank` | Spearman ρ or null | `minRank` | `ρ` | < 4 pairs + requireRank true → null |
| `level-gap` | gap % | -maxGapPct | `%` | publicBest not set → skip (pass with note) |
| `quota` | today count | `dailyLimit` | `submissions` | dailyLimit not set → skip (pass with note) |

`no-duplicate` returns `measured: 0` (no dup) or `measured: 1` (dup found), `threshold: 0`, `passed: measured === 0`.

## Bootstrap algorithm

Seeded PRNG: mulberry32(seed). Resample `resamples` times: draw `n` indices with replacement from the `n` paired differences, compute the mean. Sort the resulting array of means. The 2.5th percentile is `sorted[Math.floor(0.025 * resamples)]`.

## Spearman correlation

Rank each series independently (average tied ranks). ρ = Pearson correlation of the ranks.

## Correctness Properties

| Property | Invariant |
|---|---|
| Sign flip | swap(candidate, best) → z becomes −z |
| Zero diff | constant difference 0 → z = 0, 2.5th pct = 0; both checks FAIL |
| Bootstrap determinism | same seed, same pairs → identical 2.5th percentile |
| Duplicate detection | adding a known hash to submissions → no-duplicate always FAILs |
| Scale invariance | scale(candidate, k) and scale(best, k) → same z |

## UI palette — "candlelight amber on near-black"

```
--bg:      #0b0a07
--surface: #13120e
--surface2:#1a1914
--text:    #f0dfa8
--dim:     #8a7d58
--pass:    #3a7d44
--fail:    #8b1a1a
--hold:    #6b5a2e
--amber:   #c8922a
--border:  #2e2b20
```

## Bootstrap chart (inline SVG)

Width: 100% of container, height: 80px. Bins: 30. Bars drawn as `<rect>`. Two vertical lines: `x=0` (white, dashed) and `x=2.5th percentile` (amber, solid). No external SVG library.

## Wiring (ui.js)

1. Parse CSV inputs on submit or keyup-debounce.
2. If file dropped → hash bytes; else hash evidence text.
3. Count today's ledger entries for `todayCount`.
4. Build `SeanceEvidence`, call `judge(GATE_DEF, evidence, artifactBytes)`.
5. Render verdict via `renderVerdict` from skeleton/web.
6. Render bootstrap chart via local `renderBootstrapChart`.
7. Append to ledger, verify chain, show ledger section.
