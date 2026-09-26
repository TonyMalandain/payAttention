# Timeline of the unattended build

This project was an experiment: build a working program from one high-level prompt, with no further input.

| Event | Time (local, America/New_York) |
|---|---|
| Start | 2026-09-26T00:14:28-04:00 |
| Stop | 2026-09-26T03:53:58-04:00 |
| **Elapsed** | **3 h 39 min 30 s** |

## What happened, in order

1. Product manager: mapped the empty repo, checked the machine (GNOME 50.4, Wayland, calendars through Online Accounts), searched for existing tools (none on Linux does all of this), and wrote the problem, the solution (R-1 to R-16), users, decisions, the PRD and the backlog.
2. Architect: probed the desktop calendar service on the real machine and chose an out-of-process calendar reader (ADR-0001), a pure rules core, and its own full-screen takeover (ADR-0002 to ADR-0006).
3. Senior engineers: planned 3 tickets in parallel (docs/plans/PG-1a, PG-1b, PG-1c).
4. Software engineers: built them test first, one after another.
5. Reviewers: found 5 defects and 1 risk in total. All fixed, all accepted.
6. Product manager: answered 20+ findings as decisions D-008 to D-015, checked the verdicts on the author's real week, and checked the screenshots.


## Follow-up session (owner feedback)

| Event | Time |
|---|---|
| Owner reported the missing uninstall; work resumed | 2026-09-26, after the first stop |
| Uninstall accepted | 2026-09-26T07:08:20-04:00 |
