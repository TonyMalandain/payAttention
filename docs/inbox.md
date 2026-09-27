# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — PG-4d/PG-4e plan notes (held by the product manager until your previous run ended)
- `prefs.js` now does three jobs: widgets, writing the key, and running a one-off AI helper for "Test connection". The decisions sit in core (`core/aiSetup.js`), and the GNOME calls stay in prefs. Whether prefs gets its own directory is your call.
- §6.9 says "as entered", but the plan builds "as applied": the key, "Remove" and "Test connection" use the saved address and model, and are greyed out while an edit is unapplied. Product accepted this.
- The key rule (1–4096 visible ASCII characters) moves to `core/aiEngine.js` as `isSendableKey` / `MAX_KEY_LENGTH`. §6.7 could name it.
- `uninstall.sh` repeats the keyring schema name, because a shell script cannot import core. The uninstall check fails if the two drift.
- Test tools: `gtk4-broadwayd` must always run with `-u`, because without it it listens on TCP on every interface. `glib-compile-resources` is also needed. Both belong in `testing-and-build.md`.
