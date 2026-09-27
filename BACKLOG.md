# Backlog

Delivery status. Not product documentation. Owned by the product manager.

Spec for everything below: `docs/prd/meeting-guardian.md` (covers R-1…R-19 in `docs/product/solution.md`).
Architecture: `docs/architecture/` (ADR-0001…0006).

## Done — the meeting guardian (PG-1)

- **PG-1a — The judgment and timing rules.** Built, reviewed (1 defect, fixed), accepted.
- **PG-1b — Reading the owner's calendars.** Built, reviewed (2 defects, fixed), accepted.
- **PG-1c — Alerts, top bar, settings, install.** Built, reviewed (2 defects and 1 risk, fixed), accepted in round 2.
- Checks at the end: lint clean, 647 unit tests, 66 calendar-reader tests, headless GNOME smoke test PASS, installed to `~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io` and enabled for the next login.

## Done — uninstall (PG-3)

- **PG-3 — Remove payAttention with one command.** Built, reviewed (2 defects, fixed), and checked by the product manager. `npm run uninstall:local` removes it and keeps saved choices. `npm run uninstall:local -- --purge` also erases them.

## Now — AI mode (PG-4, size L)

- **PG-4 — Rules or AI mode; AI judges every meeting from the whole invite** (spec: `docs/prd/meeting-guardian.md`, "Addendum 2026-09-27 — AI mode"; R-18, R-19, D-019, D-020, D-021). Size **L**, to be split by the architect's order: core pieces first, then the AI helper, the shell side, settings plus the password store, and uninstall `--purge`.
  - **What changes for the owner:** a mode switch in Settings. In AI mode, verdicts come from the engine they connect (endpoint, model, API key), with an "AI:" reason. The rules take over if it is down.
  - **Who it is for:** Calendar owner, Installer.
  - **Done when:** see the addendum's "Done when".
  - Architecture: ADR-0007, ADR-0009, ADR-0010, `interfaces.md` §6. Product rulings: D-019 to D-024.
  - Build order (each: plan → build → review):
    - **PG-4a — Core AI pieces (M).** Settings keys and defaults, endpoint rules, the invite builder with its limits (D-020, D-022, D-023, D-024), fingerprint, prompt text, reply and protocol checks, and `judge` taking stored AI answers. Done when unit tests prove each rule in the addendum that core owns.
    - **PG-4b — AI helper (M).** A separate process that talks to the engine and reads the key from the password store. Done when tests against a fake engine pass, with no real cloud call.
    - **PG-4c — Shell side (M).** The queue, keeping old answers while asking again, the fallback, the budget, and "AI:" / "AI unavailable" in the menu. Done when no alert ever waits on the AI (tested).
    - **PG-4d — Settings page (S).** Mode switch, endpoint, model, key, "Test connection", and the warning.
    - **PG-4e — Uninstall `--purge` (S).** Also erases the key and the stored AI answers.
- **Owner's machine (not product work):** the NVIDIA driver is not built for the running kernel, so a local engine runs on the processor (about 5 to 20 s per verdict, estimated).

## Now — small fixes from the owner

- **PG-5 — "See Details" in Extension Manager opens the GitHub repository (S).**
  - **What changes for the owner:** in Extension Manager, "See Details" opens the project's GitHub page instead of showing an error.
  - **Who it is for:** Installer.
  - **Why it fails today:** the extension does not declare a project address, so the link has nowhere to go.
  - **Done when:**
    - the extension declares the repository address;
    - "See Details" opens it (checked by hand in Extension Manager after reinstalling);
    - the README links to it too.
  - **Blocked on:** the repository's address. No GitHub repository exists yet. Assumed `https://github.com/TonyMalandain/payAttention`, to be confirmed by the owner.
- **PG-6 — Apply the Apache License 2.0 (S)** (D-026).
  - **What changes for the owner:** the project states its licence clearly.
  - **Who it is for:** Installer, and anyone who reuses the code.
  - **Done when:**
    - a `LICENSE` file holds the full Apache 2.0 text;
    - the build file's licence field says `Apache-2.0` (replacing `GPL-2.0-or-later`);
    - each source file carries a one-line licence tag;
    - the README has a "License" section;
    - the packed extension includes the licence.

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
