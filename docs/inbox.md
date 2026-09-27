# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — proxy and the bearer key (PG-4b review note)
- A system proxy whose ignore list lacks `localhost`/`127.0.0.1` would receive a bearer key sent to an `http://127.0.0.1` engine. GNOME's default ignores loopback, and the plan put proxies out of scope. Worth one line, or a rule that loopback requests bypass the proxy.

## 2026-09-27 — for-architecture — constraints.md row 50 vs §6.5 (PG-4c plan revision)
- `constraints.md` row 50 says the unreachable backoff is "reset by any engine reply". The §6.5 table resets it only on `verdict` and `bad-reply`. The plan follows the table; align the row.

## 2026-09-27 — for-architecture — smoke failure codes and a timing test under load (PG-4c)
- `testing-and-build.md` Layer 3 lists the log codes the smoke fails on. `scripts/smoke.sh` now also fails on `ai-failed`, `ai-protocol-mismatch` and `ai-spawn-failed` (PG-4c plan, Step 11); the list in the document is one release behind.
- `tests/unit/budget.test.js` "judge over 2 000 events takes under 20 ms on average" failed once in about ten `npm test` runs during PG-4c, while other test files ran in parallel. It passed on every rerun. A wall-clock bound shared with parallel CPU-heavy tests may flake in CI.
