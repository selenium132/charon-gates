# Seance — Requirements (EARS notation)

## Context

Seance is a static browser gate that answers: "Is this score improvement real, or are you talking to a ghost?" Run it before spending a competition submission.

## Functional Requirements

### Evidence input
- WHEN the user pastes CSV with columns `id,candidate,best`, the system SHALL parse it into paired rows.
- WHEN the user pastes a submissions CSV with columns `hash,local,public`, the system SHALL store it for rank and duplicate checks.
- WHEN the user provides a file, the system SHALL use its SHA-256 as the artifact hash; OTHERWISE the system SHALL hash the pasted evidence text.
- WHEN the user clicks a synthetic sample button, the system SHALL load pre-built evidence without requiring any file.

### Gate checks (`apps/seance/gate.js`)
- IF fewer than `params.minPairs` (default 5) paired rows exist, the system SHALL return `measured: null` for `sample-size` (HOLD).
- WHEN at least `minPairs` rows exist, the system SHALL compute z = mean(candidate − best) / SE, signed by `params.higherIsBetter` (default true), and PASS `paired-z` only when z ≥ `params.minZ` (default 2.0).
- WHEN bootstrap is run with `params.seed` and `params.resamples` (default 2000), the system SHALL resample paired differences, compute the 2.5th percentile of means, and PASS `bootstrap-lower` only when that percentile > 0; the same seed SHALL always produce the same result.
- WHEN a file hash is among hashes in the submissions CSV, the system SHALL FAIL `no-duplicate`.
- WHEN fewer than 4 `local,public` pairs exist AND `params.requireRank` is false (default), the system SHALL PASS `public-local-rank` with a note and `measured: null` reported; WHEN fewer than 4 pairs exist AND `params.requireRank` is true, the system SHALL return `measured: null` (HOLD).
- WHEN at least 4 `local,public` pairs exist, the system SHALL compute Spearman correlation and PASS `public-local-rank` only when ρ ≥ `params.minRank` (default 0.5).
- WHEN `params.publicBest` is set, the system SHALL compute gap = (candidateMean − publicBest) / |publicBest| × 100 (negative if behind) and PASS `level-gap` only when gap ≥ −`params.maxGapPct` (default 5).
- WHEN `params.publicBest` is not set, the system SHALL skip `level-gap` with a PASS and a note.
- WHEN `params.dailyLimit` is set, the system SHALL count submissions recorded today in the ledger and FAIL `quota` when the count ≥ `params.dailyLimit`.
- WHEN `params.dailyLimit` is not set, the system SHALL PASS `quota` with a note.

### Verdict and findings
- WHEN any finding's `measured` is null, the system SHALL return overall status HOLD.
- WHEN all findings pass, the system SHALL return PASS.
- WHEN any finding fails (none null), the system SHALL return FAIL.
- WHEN a finding fails, the UI SHALL display one plain sentence saying what to do next.

### Bootstrap chart
- WHEN a verdict is displayed, the system SHALL render an inline SVG histogram of the bootstrap distribution with the 0 line and 2.5th-percentile line marked.

### Ledger
- WHEN a verdict is produced, the system SHALL append it to the localStorage hash-chained ledger and show the chain-verify result.

### Synthetic samples
- The system SHALL provide "The ghost" (lucky public score, paired noise — should FAIL or HOLD) and "The real thing" (genuine improvement — should PASS).
- Both SHALL be labelled as synthetic.

### Property tests (fast-check, dev only)
- Swapping candidate and best columns SHALL flip the sign of z.
- A constant paired difference of 0 SHALL never PASS `paired-z` or `bootstrap-lower`.
- Bootstrap with the same seed SHALL always return the same percentile.
- Adding a hash already in the submissions list SHALL always FAIL `no-duplicate`.
- Scaling both score columns by a positive constant SHALL leave z unchanged.

## Non-functional Requirements
- WHERE the skeleton core (`skeleton/core/`) is imported, it SHALL NOT be modified.
- The page SHALL work at phone width with keyboard-only navigation.
- No external resources, no emoji, no server, no API keys, no user data leaving the browser.
- Zero runtime dependencies beyond the skeleton.
