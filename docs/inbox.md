# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-26 — for-architecture — PG-3 uninstall: testing-and-build.md is out of date
- The smoke gained two checks. `tests/smoke/uninstall-check.sh` runs install and uninstall in an isolated home, with isolated dconf (no GSETTINGS_BACKEND override, own XDG_RUNTIME_DIR). Smoke step 9 uninstalls while a takeover holds the grab.
- `npm run uninstall:local` exists.
- install.sh now honours XDG_DATA_HOME in its post-install check.
- Measured: `gnome-extensions uninstall` runs `disable()` synchronously and deletes the directory, but leaves the UUID in enabled-extensions.
- The Layer 3 list and the install section of testing-and-build.md need these lines. boundaries.md's "scripts/: build, install, smoke wrappers" should mention uninstall.
