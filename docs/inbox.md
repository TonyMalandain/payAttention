# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — PG-4d/PG-4e plan notes (held by the product manager until your previous run ended)
- `prefs.js` now does three jobs: widgets, writing the key, and running a one-off AI helper for "Test connection". The decisions sit in core (`core/aiSetup.js`), and the GNOME calls stay in prefs. Whether prefs gets its own directory is your call.
- §6.9 says "as entered", but the plan builds "as applied": the key, "Remove" and "Test connection" use the saved address and model, and are greyed out while an edit is unapplied. Product accepted this.
- The key rule (1–4096 visible ASCII characters) moves to `core/aiEngine.js` as `isSendableKey` / `MAX_KEY_LENGTH`. §6.7 could name it.
- `uninstall.sh` repeats the keyring schema name, because a shell script cannot import core. The uninstall check fails if the two drift.
- Test tools: `gtk4-broadwayd` must always run with `-u`, because without it it listens on TCP on every interface. `glib-compile-resources` is also needed. Both belong in `testing-and-build.md`.

## 2026-09-27 — for-architecture — PG-4c plan findings and D-031
- **D-031** needs a mechanism in §6.5 before PG-4c is built:
  - "unavailable" is shown only while an eligible meeting is being decided by rules because of a failure;
  - after an unreachable engine recovers, answers resume within 5 minutes, and failed attempts must not burn the budget so that recovery is delayed. The planner suggests an engine-level pause on `network`/`timeout`/`tls`/`server`.

  State the exact rule so the PG-4c build can follow it.
- ADR-0010's Consequences section says an engine or model change shows rule verdicts, while §6.3 and data.md keep old answers as stale answers. The plan follows §6.3; please fix the ADR.
- constraints.md says "the tick does not read AI state". It reads the published answers (as §6.5 requires), and the daily prune calls into the queue without waiting. Tighten the wording.
