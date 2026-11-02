# seance

A static pre-submission gate for machine learning competitions. Drop a CSV of paired scores (candidate vs. current best, per fold or per seed) and, optionally, your submission history. The browser runs seven checks through the Charon core `judge()`, appends the verdict to a localStorage ledger, and shows PASS, FAIL or HOLD. No server, no upload.

| Check | Fails when |
|---|---|
| `sample-size` | fewer than 5 pairs |
| `paired-z` | the paired mean difference is under z = 2.0 |
| `bootstrap-lower` | the lower bootstrap bound of the improvement is not above 0 |
| `no-duplicate` | the same file hash was already submitted |
| `public-local-rank` | Spearman rho of local vs. public scores is under 0.5 (needs 4+ submissions; otherwise skipped, which the core turns into HOLD) |
| `level-gap` | the candidate mean is more than 5% below the public best you enter |
| `quota` | the daily submission limit is used up |

Checks that need data you did not give return HOLD, never PASS (Toll rule 1).

## Run tests

```
npm install
npm test
```

## Open the page

Serve the repo root with any static file server and open `apps/seance/index.html`. The two sample buttons ("The ghost" fails, "The real thing" passes) work without a file.

The statistics are a normal approximation on paired differences and are generous with few pairs. See "Limits" in the root README.
