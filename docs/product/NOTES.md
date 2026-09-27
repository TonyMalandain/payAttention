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

## 2026-09-26 — Uninstall built and proven
- **Kind:** solution
- **Profiles:** Installer
- **Fact:** R-17 is `real`. One command removes the extension, and it stops it first if it is running. Saved choices are kept unless the owner asks to erase them. Failure paths leave nothing half-removed. All of this is proven in isolated test homes. The owner's real install was never touched.
- **Source:** reviewer round 1 and the fix round; the product manager re-ran the isolated check.
- **Touches:** solution.md R-17

## 2026-09-26 — Owner asks for smarter verdicts (AI)
- **Kind:** question
- **Profiles:** Calendar owner, Installer
- **Fact:** The owner asked whether an AI model could make verdicts smarter. Two options were offered: a local model on the owner's machine that gives a second opinion only on the verdicts the rules are unsure of, or staying rules-only until overrides show the rules failing. A cloud model would reverse D-003 and was not recommended. The owner's machine has 61 GB of RAM and a 16 GB graphics card, which is enough for a small local model. No local model runtime is installed.
- **Why:** The original prompt asked for a system "smart enough to understand" meetings. Real-data evidence so far: 1 miss in 24 events, fixed with one override.
- **Source:** the owner's question; hardware checked by the product manager.
- **Touches:** decisions.md D-003, solution.md exclusions

## 2026-09-26 — AI question closed: optional engine, owner's choice of where it runs
- **Kind:** decision
- **Fact:** The owner chose AI verdicts, with the choice of a cloud-hosted or internally hosted engine. Closed as D-017, which supersedes D-003, and D-018 (only the minimum facts are sent). R-3 was reworded; R-18 and R-19 were added.
- **Source:** the owner, 2026-09-26.
- **Touches:** decisions.md, solution.md, docs/prd/meeting-guardian.md

## 2026-09-26 — Handoff: LLM abstraction library
- **Kind:** handoff
- **Fact:** The owner said, verbatim: "you should use a llm abstraction library, so that the user can decide to use a cloud-hosted or internally hosted llm engine". Which library, where it runs (the extension's processes are gjs, and it must never block the shell), how keys are stored, and which engines are supported first are all for the architect.
- **Source:** the owner.
- **Touches:** docs/architecture/

## 2026-09-27 — Owner's AI decisions
- **Kind:** decision
- **Fact:** The owner chose a rules-or-AI mode switch (D-019), sending the whole invite (D-020), and the standard connection instead of a bundled library (D-021). D-017 and D-018 are superseded. R-18 and R-19 were rewritten, and the PRD addendum was replaced.
- **Why:** The "unsure" line had no score behind it. The owner asked how the product scores meetings, and it does not.
- **Source:** the owner, 2026-09-27.
- **Touches:** decisions.md, solution.md, docs/prd/meeting-guardian.md

## 2026-09-27 — Architect PG-4 findings taken
- **Kind:** decision
- **Fact:** All 5 findings were taken:
  - the library → D-021;
  - the AI silencing alerts → accepted in D-019;
  - uninstall keeps the key and AI answers, and `--purge` erases them → consistent with D-016, and added to the addendum;
  - the GPU driver → noted in BACKLOG as the owner's machine issue;
  - which cloud key → asked, not yet answered, and it does not block acceptance.

  The inbox is emptied.
- **Source:** docs/inbox.md, architect.
- **Touches:** decisions.md, BACKLOG.md

## 2026-09-27 — Which cloud key
- **Kind:** question
- **Fact:** It is not known which cloud service the owner has a key for. It is needed only for the one-time hand check of a cloud engine.
- **Source:** product manager.
- **Touches:** docs/prd/meeting-guardian.md

## 2026-09-27 — Architect findings on the AI-mode design
- **Kind:** decision
- **Fact:** Three were accepted. An old AI answer stays in force while a changed invite is asked again, and the rules decide if that fails. The standard connection is refused over plain http on the public internet, and a key never goes over plain http to another machine. Passcodes are stripped from video links (D-022). Two went to the owner as questions: whether cancelled, declined and all-day meetings stay silent in AI mode, and whether the calendar name is sent.
- **Source:** docs/inbox.md, architect, 2026-09-27.
- **Touches:** decisions.md D-022, docs/prd/meeting-guardian.md

## 2026-09-27 — Two open questions for the owner
- **Kind:** question
- **Fact:** (1) In AI mode, should cancelled, declined and all-day meetings stay silent without asking the AI? (2) Should the calendar name (for example "Family") be sent with the invite?
- **Source:** architect finding; product manager.
- **Touches:** decisions.md D-019, D-020

## 2026-09-27 — Questions closed by the product manager
- **Kind:** decision
- **Fact:** Both open questions were product calls, not the owner's. They are closed as D-023 (cancelled, declined and all-day stay silent in AI mode) and D-024 (the calendar name is sent). The owner pointed out that neither needed him.
- **Source:** the owner, 2026-09-27.
- **Touches:** decisions.md, docs/prd/meeting-guardian.md

## 2026-09-27 — PG-4a plan: prompt accepted, text passcodes closed
- **Kind:** decision
- **Fact:** The AI prompt in docs/plans/PG-4a.md was accepted as written. It says "when unsure, answer must" (D-004 carried into AI mode), and it names family commitments as must-attend. Text passcodes were closed as D-025. The architecture findings were filed in the inbox.
- **Source:** senior engineer, PG-4a plan.
- **Touches:** decisions.md D-025

## 2026-09-27 — Plan-vs-D-025 gap already closed
- **Kind:** decision
- **Fact:** The architect flagged that the PG-4a plan predates D-025. The engineer building PG-4a was told that D-025 overrides the plan (text passcodes are removed in core, before the description is cut). No further ticket is needed.
- **Source:** architect report; product manager's PG-4a build brief.
- **Touches:** decisions.md D-025

## 2026-09-27 — Two owner requests: Extension Manager details link, licence
- **Kind:** decision
- **Profiles:** Installer
- **Fact:** "See Details" in Extension Manager fails because no project address is declared (backlog PG-5). The licence is Apache 2.0 (D-026, backlog PG-6). An engineer had set GPL-2.0-or-later without a decision; this was drift, now replaced.
- **Source:** the owner, 2026-09-27; GNOME extension review guidelines (licence compatibility, project address).
- **Touches:** decisions.md D-026, BACKLOG.md

## 2026-09-27 — Repository address unknown
- **Kind:** question
- **Fact:** No GitHub repository or git remote exists for the project. PG-5 needs the address. Assumed https://github.com/TonyMalandain/payAttention.
- **Source:** checked with the owner's GitHub login (TonyMalandain).
- **Touches:** BACKLOG.md PG-5

## 2026-09-27 — Licence consistency checked
- **Kind:** decision
- **Fact:** The owner asked that the licence follow GitHub's terms and not conflict with the packages used. Checked:
  - there are 0 runtime packages;
  - the 3 development tools and their 79 sub-packages are all permissive and never shipped;
  - the GNOME libraries used at run time are LGPL, MPL/LGPL or GPL-2.0-or-later, and come from the system.

  No conflict. PG-6 now requires an unmodified Apache `LICENSE` (so GitHub detects it), a `NOTICE` file, SPDX tags, and a recorded dependency check. The copyright holder is assumed to be Tony Malandain.
- **Source:** the owner; dependency scan by the product manager; GNOME extension review guidelines.
- **Touches:** decisions.md D-026, BACKLOG.md PG-6

## 2026-09-27 — Alert sound should be the owner's GNOME alert sound
- **Kind:** solution
- **Profiles:** Calendar owner
- **Fact:** The alert plays a fixed alarm-clock sound, which the owner calls "noise". It should play the alert sound chosen in GNOME Settings. Backlog item PG-7. This refines R-8/R-15 (sound at insist and takeover, sound on/off); it needs no new requirement.
- **Source:** the owner, 2026-09-27.
- **Touches:** solution.md R-8, R-15
