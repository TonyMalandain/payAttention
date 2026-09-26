# Backlog

Delivery status. Not product documentation. Owned by the product manager.

Spec for everything below: `docs/prd/meeting-guardian.md` (covers R-1…R-16 in `docs/product/solution.md`).
Architecture: `docs/architecture/` (ADR-0001…0006).

## Done — the meeting guardian (PG-1)

- **PG-1a — The judgment and timing rules.** Built, reviewed (1 defect, fixed), accepted.
- **PG-1b — Reading the owner's calendars.** Built, reviewed (2 defects, fixed), accepted.
- **PG-1c — Alerts, top bar, settings, install.** Built, reviewed (2 defects and 1 risk, fixed), accepted in round 2.
- Checks at the end: lint clean, 647 unit tests, 66 calendar-reader tests, headless GNOME smoke test PASS, installed to `~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io` and enabled for the next login.

## Now — needs the owner (cannot be done unattended)

- **PG-2 — First real-session check (size S).** Log out and log back in. Then:
  1. `gnome-extensions info payattention@tonymalandain.github.io` shows `ACTIVE`.
  2. `journalctl --user -b | grep -i payattention` shows no errors.
  3. The top bar shows your next must-attend meeting. The menu lists today's meetings with their reasons.
  4. **Test alert** from the menu shows all four steps. The takeover covers both monitors, even over a full-screen window, and works alongside PaperWM.
  5. Mark a personal task that matters (for example the piano pick-up) as must-attend for the whole series.
  6. Optional: turn the network off for 15 minutes and check that the "not updating" warning names the calendar.
  - The full checklist is in `docs/architecture/testing-and-build.md`, under the real-session section.

## Housekeeping (engineering)

- The plans in `docs/plans/` do not show the deviations accepted in review (the PG-1b start-up sync order, the PG-1c takeover panel layout, the menu idle rebuild, the compact takeover). Update them if the plans are reused.
- Two lint rules the architect logged as debt: forbid St/Clutter in `shell/`, and forbid creating settings in `ui/`.
- Smoke covers only the compact takeover size. Add a 1200x900 monitor to guard the regular size.

## Later candidates (not decided)

- Treat personal events with a physical place as must-attend, if several such series end up overridden (see NOTES, D-015).
- Revisit AI-assisted verdicts if overrides turn out frequent (see `solution.md` exclusions).
- Revisit live travel estimates if fixed travel times cause late arrivals.
