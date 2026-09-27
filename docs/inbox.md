# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — PG-4d settings page
- prefs.js now holds three jobs: widgets, the keyring writer, and a one-shot AI helper client for Test connection. All decisions are in core/aiSetup.js, but the GNOME I/O sits in prefs.js because a separate prefs module would need a new directory, --extra-source and a lint block. Worth deciding whether prefs gets a directory.
- interfaces.md §6.9 "configure from the fields as entered": built as "the applied fields". The key row, Remove and Test connection are insensitive while the address or model has an unapplied edit, so a key can never be saved for an address the owner is not looking at.
- The key-shape rule (1–4096 visible ASCII) moved to core/aiEngine.js (isSendableKey, MAX_KEY_LENGTH); ai/chat.js imports it. interfaces.md §6.7 could name it.
- New test layer: tests/ai/prefs.test.js runs the real prefs.js in the throwaway keyring session, with a stub ExtensionPreferences registered as a GResource and a private GTK display (gtk4-broadwayd). testing-and-build.md (Layer 2b and the prerequisites) should list gtk4-broadwayd and glib-compile-resources.
- Measured: gtk4-broadwayd without -u listens on TCP *:8080+display on every interface. The harness always passes -u <socket in XDG_RUNTIME_DIR>; any future use must too.
- Spawn rule in prefs: Test connection spawns the AI helper with Gio.SubprocessLauncher and unsets every name in core/protocol.js HELPER_ENV_UNSET, as shell/helperProcess.js spawnHelper does. prefs may not import shell/ (boundaries.md), so the few launcher lines are repeated there rather than shared. The lint rule that forces spawnHelper covers shell/ only; nothing but review keeps a future prefs spawn on the rule.

## 2026-09-27 — for-product — PG-4d settings wording
- The warning is the spec's text, verbatim and always shown. Next to it, a line for the entered address says "On this computer: the invite does not leave it." or "… the invite leaves your computer." (worked out from the address, interfaces.md §6.4).
- Every other text on the Verdicts page (mode lines, key status, the Yes/No reasons) was written by the senior engineer. They are listed in docs/plans/PG-4d.md and live in core/aiSetup.js. A reword is a one-line change there.

## 2026-09-27 — for-architecture — PG-4e uninstall --purge and the keyring
- Measured: Secret.password_clear on a locked collection returns false with no error and removes nothing. uninstall.sh therefore searches again after clearing and fails (exit 1, "your keyring is locked … Saved settings were not erased.") when any item of the schema remains.
- --purge clears keys first, then settings, so a locked keyring leaves both in place. An unreachable Secret Service also fails --purge (the script cannot tell "none" from "unreachable").
- The plain uninstall never calls the keyring; it prints a fixed "Kept: AI engine keys in your keyring, if you saved any" line.
- The key schema name is repeated in scripts/uninstall.sh (a shell script cannot import core). tests/smoke/uninstall-check.sh seeds items with core's constant (tests/ai/gjs/keyring.js), so a drift fails the smoke. testing-and-build.md's uninstall check paragraph could mention the throwaway keyring it now starts.
