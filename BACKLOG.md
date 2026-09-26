# Backlog

Delivery status. Not product documentation. Owned by the product manager.

Spec for everything below: `docs/prd/meeting-guardian.md` (covers R-1…R-16 in `docs/product/solution.md`).
Architecture: `docs/architecture/` (ADR-0001…0006).

## Now — build the meeting guardian (PG-1, size L, split in three)

Build order: PG-1a → PG-1b → PG-1c. Each goes: senior engineer plan (`docs/plans/<id>.md`) → software engineer build → reviewer → product check.

### PG-1a — The judgment and timing rules (size M) — BUILT (9d9a657), reviewed: 1 defect to fix
- **What changes for the owner:** nothing visible yet. This is the part that decides which meetings matter (PRD §1), whether they are online or in person (§2), and which alert step shows at any moment (§3, §4 travel, snooze, acknowledge, overlap, 10-min cutoff, return after away).
- **Who it is for:** Calendar owner.
- **Done when:** automated tests prove every verdict reason in PRD §1, every link/place case in §2, and every timing case listed in PRD "Done when", both online and in person, with the defaults from D-006 and D-008. Also the test-alert ladder timings. Sets up the project tooling (lint, test) per `docs/architecture/testing-and-build.md`.

### PG-1b — Reading the owner's calendars (size M) — BUILT, in review
- **What changes for the owner:** the product can see every meeting in the calendars connected to the desktop, with guests, responses, organiser, free/busy, cancelled state, place, description and video link, and the owner's own addresses — without ever risking the desktop session.
- **Who it is for:** Calendar owner, Installer (no login).
- **Done when:** the helper test against the fixture calendar passes (times, time zones, recurring meetings, guests, rooms marked as rooms, video links, cancelled), it exits cleanly when its input closes, and a read-only run against the real calendars returns the next 24 h of meetings (counts only in the report). Resyncs periodically and after resume (ADR-0001).

### PG-1c — Alerts, top bar, settings, install (size L)
- **What changes for the owner:** the extension installs and shows the top-bar countdown and menu (PRD §5), the four alert steps including the full-screen takeover on every monitor that only an action clears (§3), travel-time chooser (§4), override toggles, settings window (§6), stale-calendar warning (§7), "Test alert" from the menu, alerts shown even in Do Not Disturb.
- **Who it is for:** Calendar owner, Installer.
- **Done when:** `npm run lint`, `npm test`, `npm run build`, `npm run test:helper`, `npm run smoke` all pass; the smoke test runs the test alert in a headless shell with 2 monitors, sees the takeover on both, picks an action, and confirms the input grab is released; the extension is installed into the owner's extensions folder and enabled-ready (Wayland needs log out/in to load it).

## Later candidates (not decided)

- Revisit AI-assisted verdicts if overrides turn out frequent (see `solution.md` exclusions).
- Revisit live travel estimates if fixed travel times cause late arrivals.
