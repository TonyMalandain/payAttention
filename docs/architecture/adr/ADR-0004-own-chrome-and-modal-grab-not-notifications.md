# ADR-0004 — Alerts are the extension's own shell actors and modal grab, never notifications
- **Date:** 2026-09-26
- **Kind:** reversible

## Context

R-12: must-attend alerts must show in Do Not Disturb. R-8: the last step covers the
whole screen on every monitor and stays until an action is chosen. The owner uses
PaperWM, which rearranges window actors. On Wayland, only the compositor — here,
gnome-shell — can put something above every window and take the keyboard.

## Options

1. **The message tray (`MessageTray.Source` / notifications), with urgency
   CRITICAL.** Forever cost: DND and notification settings suppress or restyle it;
   it cannot become a full-screen takeover; it looks like the ordinary reminders
   the product exists to rise above (problem.md).
2. **A separate application window (GTK) for the takeover.** Forever cost: on
   Wayland a client cannot force itself above other windows or onto every monitor,
   cannot grab input, and is subject to PaperWM's tiling.
3. **Own St actors as shell chrome for cards; for the takeover, one actor per
   monitor in the modal-dialog layer plus `Main.pushModal`.** Forever cost: we own
   the layout, monitor changes, and grab lifetime — and a leaked grab makes the
   desktop unusable.

## Decision

Option 3. **The deciding reason: it is the only option that can meet both R-12 and
the full-screen takeover on Wayland.** The message tray is never used, so DND does
not apply.

Grab rule: every path that removes the takeover — an action, `disable()`, an
exception in the controller's tick — releases the grab. On an internal error the
takeover fails open. Being trapped by a broken overlay is worse than one missed
alert.

## Consequences

- Easier: full control of look, placement and persistence; independent of
  notification settings.
- Harder: we must handle monitors being added or removed, the overview or another
  modal holding a grab (show without grab and retry), and full-screen windows.
- Screen sharing will show the takeover to others (accepted in the PRD).
- The sound is played through the shell's sound player, not a notification.

## Revisit when

GNOME adds a supported "critical alert" surface that bypasses DND and supports
full-screen presentation.
