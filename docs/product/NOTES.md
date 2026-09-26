# Product working log

Append only. Newest at the bottom.

## 2026-09-26 — Project set up from a single unattended prompt
- **Kind:** decision
- **Fact:** The author asked for a GNOME extension that alerts only for meetings they cannot miss, escalates until they act, and accounts for travel time. No follow-up input is possible.
- **Why:** Notification overload makes ordinary reminders invisible.
- **Source:** the author's setup prompt.
- **Touches:** problem.md, solution.md

## 2026-09-26 — Environment observed
- **Kind:** solution
- **Fact:** The author's machine runs GNOME Shell 50.4 on Wayland, with calendars connected through GNOME Online Accounts and the desktop calendar service.
- **Source:** checked on the machine by the product manager.
- **Touches:** solution.md R-1, R-2

## 2026-09-26 — Ambiguous sentence in the prompt
- **Kind:** question
- **Fact:** "a strong alert mechanism that just something popping up 30mins before my meeting starts and then disappears" reads either as the desired first step or as a description of today's weak reminders. It was closed as D-005: brief heads-up first, then escalation.
- **Source:** the author's prompt.
- **Touches:** decisions.md D-005

## 2026-09-26 — Handoff: where the calendar data comes from
- **Kind:** handoff
- **Fact:** Product needs every calendar that the desktop clock menu shows, including attendee lists, the owner's response status, the organiser, the free/busy flag, the location, the description, and the conference link. The architect must confirm what the desktop calendar service exposes to an extension, and how.
- **Source:** product manager.
- **Touches:** docs/architecture/
