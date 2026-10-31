---
inclusion: always
---
# Charon: product steering

Charon is a skeleton template for building **evidence gates**: small programs that decide whether an
artifact may leave the workshop, and whose verdict an AI agent cannot talk its way past.

The problem it solves: AI agents grade their own work. They say "done" and "looks good" with confidence
whether or not it is. The cure is a gate made of numbers, which reads measured evidence, returns a verdict,
and writes it down.

The author runs a one-person automated operation where AI agents publish videos and submit competition
entries. Two failures came from that operation and motivate the two example apps:

1. A vertical video went out with a broken layout that nobody had looked at. (app: ghost-viewer)
2. Days of computing went into an entry that was measured only against its own earlier best, while the public
   level had moved far ahead. (app: seance)

## Who it is for
- Solo builders and small teams who let agents ship things.
- ghost-viewer: makers of vertical short videos.
- seance: people who enter machine learning competitions and want to stop fooling themselves with the
  public leaderboard.

## The rules a Charon gate always obeys (the Toll)
1. No evidence, no crossing: missing or unreadable evidence is HOLD, never PASS.
2. A verdict reports what was measured, the threshold, and the source of the number.
3. A verdict is bound to the sha-256 of the artifact and the gate definition. Change either and the old
   verdict is void.
4. The ledger is append-only and hash-chained. Tampering is detectable.
5. Agents cannot overrule. Only a named human can record an override, and it stays visible as an override.

## Voice
Halloween is the costume, not the content. Spooky words may name things (the Ferryman, the Toll, the Ledger).
Findings and error messages are plain and exact, and always state the measured number.
Never claim a thing was checked if it was not. No superlatives. No invented users or statistics.
