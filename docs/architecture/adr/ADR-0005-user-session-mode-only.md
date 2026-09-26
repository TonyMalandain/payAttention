# ADR-0005 — Run in the `user` session mode only; locking disables the extension
- **Date:** 2026-09-26
- **Kind:** reversible

## Context

GNOME Shell disables every extension that does not declare the `unlock-dialog`
session mode when the screen locks, and enables it again on unlock. The product
shows nothing over the lock screen (`solution.md`), and R-13 requires the right
step to appear on return.

## Options

1. **Declare `unlock-dialog`** and keep running while locked, hiding the UI.
   Forever cost: review scrutiny (allowed only when necessary), keyboard-signal
   rules in that mode, two UI states to maintain, and the risk of drawing over the
   lock screen.
2. **`user` mode only.** Lock runs `disable()`, unlock runs `enable()`. Forever cost:
   the helper is restarted and the snapshot reloaded on every unlock (under a
   second, measured warm), and all state that must survive a lock must be stored
   (ADR-0003).

## Decision

Option 2. **The deciding reason: lock and unlock become exactly the restart path,
which already has to work, so there is one path instead of two.** With the
level-triggered core (ADR-0002), the first tick after unlock shows the step that
fits the time.

## Consequences

- Easier: nothing can appear on the lock screen; no `session-modes` key in
  `metadata.json`.
- Harder: `disable()` must be complete and fast, because it runs on every lock;
  a leak multiplies per lock. Acknowledgements and snoozes must be persisted, not
  kept in memory.
- For the first second or so after unlock, before the first snapshot arrives,
  there is no calendar data. The UI shows its "no data yet" state rather than
  "no meetings".

## Revisit when

Unlock-to-first-snapshot is measured above 3 seconds, or the product decides that
something should happen while the screen is locked.
