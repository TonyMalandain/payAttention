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

## 2026-09-26 — Coverage check, problem vs solution
- **Kind:** question
- **Fact:** Every pain in problem.md is answered: noise → R-4/R-7, "shows once" → R-8/R-13, one lead time → R-10/R-11, hand-crafted reminders → R-4/R-6. Two requirements trace only weakly: R-12 (Do Not Disturb) and R-14 (top-bar countdown). Both follow from "they have learned to ignore all of them" and from trust in verdicts (users.md), but problem.md does not name them. They are kept because both are cheap and protect the core promise. Revisit if either grows.
- **Source:** product manager reading check.
- **Touches:** solution.md R-12, R-14

## 2026-09-26 — Architect findings taken
- **Kind:** decision
- **Fact:** All six architect findings were acted on: in-person step order (D-008), not-invited and cancelled meetings (D-009), stale calendar warning (D-010, R-16), rooms are not guests (D-011), and the roughly 10-minute sync delay (stated as an exclusion in solution.md). The inbox was emptied.
- **Source:** docs/inbox.md, architect, 2026-09-26.
- **Touches:** decisions.md, solution.md, docs/prd/meeting-guardian.md

## 2026-09-26 — Handoff closed: calendar data source
- **Kind:** handoff
- **Fact:** The earlier handoff on where calendar data comes from is answered by the architect's ADR-0001. Nothing is left open on the product side.
- **Source:** docs/architecture/adr/ADR-0001-calendar-data-via-out-of-process-eds-helper.md
- **Touches:** none

## 2026-09-26 — Senior engineer findings taken (PG-1a plan)
- **Kind:** decision
- **Fact:** One-guest meetings closed as D-012. A takeover winning the card over a lower step, singular "1 guest" wording, and "not enough information" when the owner's addresses are unknown were all accepted as planned. Removed from the inbox.
- **Source:** docs/inbox.md, senior engineer, 2026-09-26.
- **Touches:** decisions.md D-012, docs/prd/meeting-guardian.md §1

## 2026-09-26 — Owner addresses: one per account, plus settings
- **Kind:** decision
- **Fact:** D-009's "addresses of the connected calendar accounts" means the one address each calendar reports. Aliases and other addresses go in the "extra owner addresses" setting. No change to D-009.
- **Source:** product manager, answering a senior-engineer finding (PG-1b plan).
- **Touches:** decisions.md D-009

## 2026-09-26 — Offline freshness closed as D-013
- **Kind:** decision
- **Fact:** A stale-provider warning is required even while meetings are served from the saved copy (D-013). The architect owns how.
- **Source:** senior engineer finding, PG-1b plan.
- **Touches:** decisions.md, solution.md R-16

## 2026-09-26 — Architect D-013 reading taken
- **Kind:** decision
- **Fact:** Per-calendar staleness accepted and closed as D-014, with the calendar named in the menu. Removed from the inbox.
- **Source:** docs/inbox.md, architect.
- **Touches:** decisions.md D-014

## 2026-09-26 — Reviewer finding on "no guest list" taken
- **Kind:** decision
- **Fact:** Closed as D-015. The PRD example was corrected. Words that mean "no physical place" were widened (phone, call, zoom meeting, teams, …), because "Zoom Meeting" typed as a location was being treated as a physical place.
- **Source:** reviewer, PG-1a round 1.
- **Touches:** decisions.md D-015, docs/prd/meeting-guardian.md §1, §2

## 2026-09-26 — Multi-calendar stale wording accepted
- **Kind:** decision
- **Fact:** When more than one calendar is stale, the menu reads "Calendars not updating since …: A, B, C. Alerts may be missing.", with ", and N more" after 3 names. This is the senior engineer's wording, and it fits D-014.
- **Source:** senior engineer, PG-1c plan refresh.
- **Touches:** decisions.md D-014

## 2026-09-26 — Verdicts checked on the author's real week
- **Kind:** solution
- **Fact:** Over 7 days of the author's real calendars (24 events), 7 were judged must-attend and 17 ignorable. All 7 must-attend were real meetings with other people: 2 weekly team meetings, 1 external 1:1, and appointments. The 17 ignorable were personal blocks, including a reminder that repeats twice a day and children's activities. One personal task that matters, picking a child up, was judged ignorable because it has no guests (the accepted cost in D-015). One series override fixes it.
- **Why:** This is the first real-data evidence for R-4, R-5 and R-7.
- **Source:** product manager, read-only run against the author's calendars on 2026-09-26. No calendar content was saved in the repo.
- **Touches:** solution.md R-4, R-5, R-7; decisions.md D-015

## 2026-09-26 — Condition to revisit D-015
- **Kind:** question
- **Fact:** Personal events with a physical place (for example children's practices) could be treated as must-attend with travel timing. This was not adopted: it would add takeovers for events another adult may handle. Revisit if the author overrides several such series to must-attend.
- **Source:** product manager.
- **Touches:** decisions.md D-015

## 2026-09-26 — All requirements proven; product verified
- **Kind:** solution
- **Fact:** All 16 requirements are now `real`. Evidence: unit tests (647), calendar-reader tests against a test calendar (66), a headless GNOME 50 smoke test with Do Not Disturb on and two monitors, screenshots of every alert step, and a read-only verdict check on the author's real week. The first load in the author's real session needs a log out and log in, which cannot be done unattended (BACKLOG PG-2).
- **Source:** product manager; reviewer round 2 accepted PG-1c.
- **Touches:** solution.md

## 2026-09-26 — Missing uninstall
- **Kind:** solution
- **Profiles:** Installer
- **Fact:** No way to remove the extension existed. Added as R-17 with D-016: saved choices are kept by default and erased only on request. Backlog item PG-3.
- **Why:** The owner raised it. The coverage check missed it, because users.md covered installing but not removing.
- **Source:** the owner, 2026-09-26.
- **Touches:** solution.md R-17, decisions.md D-016, docs/prd/meeting-guardian.md

## 2026-09-26 — Wider search for alternatives
- **Kind:** decision
- **Fact:** The owner asked whether tools outside GNOME were checked. The first search covered GNOME only. A wider search found partial matches (oh-shit-meeting, Calendar Alarm for Chrome, gcalcli, cloud AI calendars such as Calendar.AI and Reclaim, and takeover apps for Mac and Windows). None combines importance judgment, escalation to a takeover, and travel timing on Linux. D-002 still holds, and its evidence was too narrow. Recorded in alternatives.md.
- **Source:** the owner's question; web search, 2026-09-26.
- **Touches:** alternatives.md, decisions.md D-002
