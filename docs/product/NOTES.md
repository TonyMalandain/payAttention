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

## 2026-09-27 — PG-4a review: text passcodes leaked in grouped formats
- **Kind:** decision
- **Fact:** Google Meet PINs and spaced passcodes leaked past D-025's "next word" rule. Closed as D-027: removal runs to the end of the line.
- **Source:** reviewer, PG-4a round 1.
- **Touches:** decisions.md D-025, D-027

## 2026-09-27 — PG-6 and PG-7 plans taken
- **Kind:** decision
- **Fact:** Both plans are accepted. GNOME's "None" alert sound is respected (D-028). The planner's probes briefly polluted the owner's sound lookup cache; it repaired the cache and verified both sounds resolve. The owner was told.
- **Source:** senior engineer, PG-6 and PG-7 plans.
- **Touches:** decisions.md D-028, BACKLOG.md

## 2026-09-27 — D-027 readings accepted
- **Kind:** decision
- **Fact:** Two readings of D-027 were accepted:
  - a code alone on the next line after a keyword is also removed, so the next line is lost;
  - text after the keyword with no letter or digit is left alone ("Forgot your password.").

  "password-protected file" becomes "password-[removed]", which is within D-027's accepted cost. A start time beyond what a date can hold is still not rejected; it is logged for the senior engineer, and its only source is the calendar reader, which validates times.
- **Source:** software engineer, PG-4a round 1 fixes.
- **Touches:** decisions.md D-027

## 2026-09-27 — PG-4b plan taken
- **Kind:** decision
- **Fact:** The AI helper plan is accepted. When the owner's password store is locked, the helper never prompts. It reports no key, the rules decide, and the menu shows "AI unavailable — using rules". A keyless engine at a private address needs no key lookup. The headless keyring test was proven on this machine.
- **Source:** senior engineer, PG-4b plan.
- **Touches:** solution.md R-19

## 2026-09-27 — PG-4a accepted; passcode follow-up
- **Kind:** decision
- **Fact:** PG-4a was accepted in review round 2. Reviewer findings were closed as D-029: Zoom one-tap dial strings leaked the passcode; HTML descriptions over-removed; plurals and hidden marks inside a keyword slipped through. The follow-up ticket is PG-4a2.
- **Source:** reviewer, PG-4a round 2.
- **Touches:** decisions.md D-029, BACKLOG.md

## 2026-09-27 — PG-4a2 edges accepted
- **Kind:** decision
- **Fact:** Two edges were accepted:
  - "Reset PIN" at the end of a Teams line removes the next line (D-027's next-line rule). In real invites that line is a footer.
  - Percent-encoded dial strings (`%2C%2C`) are not caught. This is rare in calendar text, and it is a known gap.

  Known false positives were also accepted: date lists and European million amounts are removed, which removes more and never leaks.
- **Source:** software engineer, PG-4a2.
- **Touches:** decisions.md D-027, D-029

## 2026-09-27 — PG-4a2 review: leaks remain; plain-text-first and best effort
- **Kind:** decision
- **Fact:** The review found remaining leaks: direction marks, no-break spaces, numbered dial lines, and `<br>` with attributes. Closed as D-030: convert to plain text first, decode entities and `%xx`, share one list of invisible marks, then stop. Removal is best effort, and Settings says so. Ticket PG-4a3.
- **Why:** The fixes were turning into whack-a-mole. The owner chose the whole invite, so removal lowers risk but is not a guarantee.
- **Source:** reviewer, PG-4a2 round 1.
- **Touches:** decisions.md D-030, docs/prd/meeting-guardian.md, BACKLOG.md

## 2026-09-27 — PG-4a3 built; last passcode round
- **Kind:** decision
- **Fact:** PG-4a3 is built. All 14 review variants are removed. Accepted: zero-width joiners are dropped from text sent to the engine, which can split emoji or Persian text, and the verdict does not depend on it. The "best effort" Settings wording was added to PG-4d. No further passcode rounds are planned beyond this review (D-030).
- **Source:** software engineer, PG-4a3.
- **Touches:** decisions.md D-030, BACKLOG.md PG-4d

## 2026-09-27 — PG-4a3 review taken
- **Kind:** decision
- **Fact:** One defect was sent to a fix: the dial rule allowed spaces before `#`/`*`, so it removed dates, order numbers and hashtags. Product additions to the same fix, under D-030 ("all other tags are dropped"):
  - Outlook leftovers go: namespaced tags such as `<o:p>`, comments, conditional comments, and the contents of `<style>`/`<script>`;
  - opening `<p>`, `<div>` and `<li>` also count as line ends.

  Accepted as best effort: link addresses in HTML are not sent, and exotic dial or entity formats (notes 3–5) are not handled. No further passcode work.
- **Source:** reviewer, PG-4a3 round 1.
- **Touches:** decisions.md D-030

## 2026-09-27 — PG-4a3 closed; passcode work closed
- **Kind:** decision
- **Fact:** The PG-4a3 fix round landed. Dial codes no longer eat dates, hashtags or order numbers, and Outlook leftovers are dropped. An unclosed comment or style block keeps its text, so later rules still read it. This was accepted: the agenda of a malformed invite survives. PG-4a3 is accepted and no more passcode work is planned (D-030).
- **Source:** software engineer, PG-4a3 round 1 fixes.
- **Touches:** decisions.md D-030

## 2026-09-27 — PG-4d and PG-4e plans taken
- **Kind:** decision
- **Profiles:** Calendar owner, Installer
- **Fact:** Both plans are accepted, with three product calls:
  - the key, "Remove" and "Test connection" use the applied address and model, and are greyed out while an edit is unapplied;
  - the D-030 warning is always shown, plus a line saying whether this address keeps invites on the computer or sends them out;
  - `--purge` stops with exit 1 if the password store is locked or unreachable, before erasing settings, and says so.

  The page texts are the planner's wording, kept in one core module; the product manager reviews them on the built page. Findings for the architect are held until the architect's current inbox run ends: prefs.js carries three jobs, "as applied" versus "as entered", the key rule moving to core, the schema name repeated in uninstall.sh, and broadwayd needing `-u`.
- **Source:** senior engineer, PG-4d and PG-4e plans.
- **Touches:** solution.md R-17, R-19

## 2026-09-27 — Helper debug-output fix: ticket scope confirmed
- **Kind:** decision
- **Fact:** The architect ruled that every spawner drops `G_MESSAGES_DEBUG` from the child's environment. Product confirmed the scope: PG-4c covers the calendar helper and the AI helper spawns, and PG-4d covers "Test connection". Both backlog items were updated. The held PG-4d/PG-4e architecture notes were filed in the inbox.
- **Source:** architect, 2026-09-27.
- **Touches:** BACKLOG.md

## 2026-09-27 — PG-4c plan taken; D-031
- **Kind:** decision
- **Fact:** The PG-4c plan is accepted. Its two product-facing findings were closed as D-031: a truthful "AI unavailable" line, and recovery within 5 minutes without burning the budget. The architect was asked for the mechanism before the build. The build will also carry the spawn-environment rule (drop `G_MESSAGES_DEBUG`), which post-dates the plan.
- **Source:** senior engineer, PG-4c plan.
- **Touches:** decisions.md D-031, solution.md R-18

## 2026-09-27 — PG-4b review: local engines cut off at 60 s
- **Kind:** decision
- **Fact:** The review found that the network library's default 60 s socket timeout cut local engines off before the 90 s deadline and reported it as a network failure. For the owner, whose GPU driver is not loaded, a local model running on the processor could hit this every time, so AI mode would never work. Sent to a fix round. The other checks held: the key never leaks, no redirects are followed, the size cap holds, the keyring never prompts, and no test reaches a real service. The proxy note (a system proxy without loopback in its ignore list) is left for the architect after its current run.
- **Source:** reviewer, PG-4b round 1.
- **Touches:** solution.md R-18

## 2026-09-27 — D-031 mechanism accepted
- **Kind:** decision
- **Fact:** The architect's rule is accepted:
  - "unavailable" shows only while a waiting meeting falls back because the engine is down or its own ask failed;
  - engine-level pauses run 30 s, doubling, capped at 90 s;
  - probes made while the engine is down do not push back retries and do not spend budget.

  After the engine returns, the first answer arrives within about 281 s (by arithmetic), which is within D-031's 5 minutes. The PG-4c plan goes back to its planner for revision.
- **Source:** architect, interfaces.md §6.5.
- **Touches:** decisions.md D-031

## 2026-09-27 — Extension active in the owner's real session
- **Kind:** solution
- **Fact:** payAttention is ACTIVE in the owner's real GNOME session, and its calendar helper is running. This boot's journal shows no payAttention or shell script errors. PG-2 steps 1 and 2 passed. The installed copy is the build from before AI mode and PG-6/PG-7. A reinstall is held until the AI work lands, so the live session is not changed piecemeal.
- **Source:** product manager, read-only checks (`gnome-extensions info`, `journalctl`).
- **Touches:** solution.md R-1, BACKLOG.md PG-2

## 2026-09-27 — PG-4c built; README privacy line corrected
- **Kind:** decision
- **Fact:** PG-4c (the shell side of AI mode) is built. It proves by mutation that no alert waits on the AI. The README's "no AI service and no network call" was no longer true with AI mode; it now says rules by default, AI mode sends each invite to the chosen engine, and passcode removal is best effort (D-030). The inbox entry is removed. The leftover keyring daemons the engineer saw had already exited; nothing of ours is running.
- **Source:** software engineer, PG-4c; product manager.
- **Touches:** README.md, solution.md R-3

## 2026-09-27 — PG-4c review taken
- **Kind:** decision
- **Fact:** No code defects were found. Three §6.5 rows had no test that bites, so a test-only fix round was ordered. It also carries the benchmark measurement change, the tautological assertions, and the pruning of the retry and failed-key maps. Product rule sent to the architect: one invite that crashes the helper must never block AI answers for other meetings.
- **Source:** reviewer, PG-4c round 1.
- **Touches:** decisions.md D-031

## 2026-09-27 — PG-4d built; page texts accepted
- **Kind:** decision
- **Profiles:** Calendar owner, Installer
- **Fact:** The Verdicts page is built. All user-visible texts were reviewed by the product manager and accepted as written: plain, honest, and each failure says what to do. The "all-day" row in the field list is kept, although all-day meetings are never sent (D-023), because it lists the invite's fields. The loopback-proxy carry-over was not in this build and goes into the review fix round.
- **Source:** software engineer, PG-4d.
- **Touches:** solution.md R-19

## 2026-09-27 — PG-4d review taken
- **Kind:** decision
- **Profiles:** Calendar owner, Installer
- **Fact:** Two defects go to a fix round: the greying test cannot fail for the key row and Remove, and the loopback proxy rule is missing. Product calls added to the same round:
  - a typed key that has not been saved is cleared when the address changes, so it is never saved to the wrong address;
  - "Saved key" is blank while its lookup is pending;
  - Remove is enabled whenever a key exists for the applied address, because removal is always safe;
  - "Not tested yet." and "Testing…" move into core with the other texts.

  Accepted: saving into a locked password store may show GNOME's own unlock prompt, because the owner pressed the button. The "never prompt" rule applies to the background helper.
- **Source:** reviewer, PG-4d round 1.
- **Touches:** solution.md R-19

## 2026-09-27 — AI mode complete; reinstalled
- **Kind:** solution
- **Fact:** All AI-mode tickets (PG-4a to PG-4e, with PG-4a2, PG-4a3 and PG-4c2) are accepted. The full checks were run by the product manager on the combined tree: lint clean, 1370 unit, build, 188 helper, smoke PASS. R-18 and R-19 are now `real` (verified in code). The extension was reinstalled with `npm run install:local`; it loads at the owner's next login. The real-session check of AI mode is PG-2 step 8.
- **Source:** product manager.
- **Touches:** solution.md R-18, R-19; BACKLOG.md PG-2

## 2026-09-27 — Preview command chosen (R-20, D-032)
- **Kind:** decision
- **Profiles:** Calendar owner, Installer
- **Fact:** The owner rejected the nested GNOME desktop and accepted a terminal preview of verdicts, as long as it is not a trick coupled to the extension.
- **Source:** the owner, 2026-09-27.
- **Touches:** solution.md R-20, decisions.md D-032

## 2026-09-27 — Handoff: GNOME-independent core, swappable calendar source and shell
- **Kind:** handoff
- **Fact:** The owner, verbatim: "intuitively, the gnome-extension should be a shell and the core capabilities should be reusable. Same with access to the calendar information. That the gnome-specific parts should be well encapsulated into a contained component that can later be changed for something else, like an O365 one, or a Google one, etc. There's no reason for the core logic to be dependent on gnome." Measured today: core/ has 0 GNOME imports (22 files). The controller, AI queue and view are GNOME-free. Calendar reading and AI access are separate processes behind a JSON protocol, with the calendar reader built on EDS and the key store on the GNOME keyring. The UI, prefs and settings store are GNOME-bound. This is architecture, so the architect owns it.
- **Source:** the owner; measurement by the product manager.
- **Touches:** docs/architecture/

## 2026-09-27 — Scope unchanged: GNOME only
- **Kind:** decision
- **Fact:** Supporting O365 or Google calendars directly, or other desktops, is still out of scope ("GNOME only" in solution.md). The owner asked that the architecture keep those doors open, not that they be built. A new product decision is needed to ship any of them.
- **Source:** product manager, reading the owner's message.
- **Touches:** solution.md exclusions

## 2026-09-27 — Architect's decoupling review taken
- **Kind:** decision
- **Fact:** ADR-0011 records the owner's principle: core rules in `core/`, GNOME-free orchestration in `app/`, and GNOME as adapters, with dependencies pointing inward. Two leaks block the preview: the verdict pipeline is private to the alert controller, and the store port has no read-only side. The calendar snapshot is source-neutral, so an O365 or Google reader could feed it. Product accepted the double engine asks (D-033). The code stays inside `extension/` in separated folders (the architect's recommendation). The owner may ask for a top-level split before ticket PG-8a lands. Other findings accepted: the preview needs the desktop session (no SSH), and the waits are assumed at 30 s for calendars and at most 5 min for AI answers. The inbox was emptied; the architect had already folded its entries.
- **Source:** architect, ADR-0011, ADR-0012, interfaces.md §7.
- **Touches:** decisions.md D-033, BACKLOG.md PG-8

## 2026-09-27 — PG-8c plan taken
- **Kind:** decision
- **Profiles:** Calendar owner, Installer
- **Fact:** The preview runs from the installed copy. Installing needs no logout, so `npm run install:local` then `npm run preview` meets R-20. A run straight from the checkout is not offered (ADR-0012). The plan first fixes a real GNOME leak: `StoreReader` used Shell-only `connectObject`, which would have thrown in a terminal. The README states the D-033 double-ask cost in plain words.
- **Source:** senior engineer, PG-8c plan.
- **Touches:** solution.md R-20

## 2026-09-27 — PG-8c built; two wording fixes
- **Kind:** decision
- **Profiles:** Calendar owner
- **Fact:** The preview is built. Parity with the extension and no writes are both proven. Two wording fixes go to the review fix round:
  - an all-day row shows no online or in-person label;
  - an unreadable calendar is described in plain words (for example `Could not read calendar "Broken": could not connect.`), with no raw error code.
- **Source:** product manager, reading the sample output.
- **Touches:** solution.md R-20

## 2026-09-27 — PG-8c accepted; fix round with polish
- **Kind:** decision
- **Fact:** PG-8c was accepted in review round 1 with no defects. Product accepted that the JSON `key`/`seriesKey` stay raw: they must match stored overrides, and the JSON bytes are escaped. The fix round carries:
  - the two wording fixes (all-day rows show no mode; plain words for an unreadable calendar);
  - closing the `./../` lint bypass that defeats every boundary rule (it protects the owner's decoupling principle);
  - de-duplicating the plural helper and moving the progress wording next to the other texts;
  - checking the helpers are gone after a normal exit;
  - PG-4f (Settings polish and the keyring.js comment).
- **Source:** reviewer, PG-8c round 1.
- **Touches:** solution.md R-20

## 2026-09-27 — PG-8c fix round and PG-4f accepted
- **Kind:** decision
- **Fact:** The calendar-error phrases ("could not connect", "it did not answer in time", "could not read its meetings", "something went wrong") were accepted. The fix round landed with all checks green. Follow-ups filed as PG-9: the Model field does not follow outside changes, and a mid-path `..` still sidesteps lint (to the architect).
- **Source:** software engineer, PG-8c fix round.
- **Touches:** BACKLOG.md

## 2026-09-27 — Preview demoed on the owner's real calendar
- **Kind:** solution
- **Fact:** After `npm run install:local`, with no logout, `npm run -s preview` listed the owner's next ~36 h of meetings with verdicts and reasons (rules mode), and exited 0. The verdicts matched the earlier real-week check. R-20 is `real` (demoed).
- **Source:** product manager, read-only run.
- **Touches:** solution.md R-20

## 2026-09-29 — Repository pushed to GitHub (private)
- **Kind:** decision
- **Fact:** The repo was pushed to https://github.com/TonyMalandain/payAttention as a private repository. GitHub detects the licence as Apache-2.0. Git history contains one line with the owner's child's first name (a superseded PRD addendum). Making the repo public should first scrub that from history, which is a history rewrite and the owner's call. PG-5 is unblocked.
- **Why:** The owner asked to push. Private was chosen because history holds personal calendar details.
- **Source:** the owner's request, 2026-09-29.
- **Touches:** BACKLOG.md PG-5

## 2026-09-29 — Child's name scrubbed from git history
- **Kind:** decision
- **Fact:** At the owner's request, the one line holding the owner's child's first name was rewritten in history. It was in a superseded PRD addendum, in two commits; the name was replaced with "my child". The repo was force-pushed. All 100 commits are kept, and the current files are byte-identical to before. A local backup bundle holding the old history is at `~/payattention-backup-before-scrub.bundle`, and it still contains the name. GitHub may keep the old commits reachable by their old IDs for a while, but only in this private repo. Rule going forward: no names of people from the owner's real calendar in any tracked file or commit.
- **Source:** the owner, 2026-09-29.
- **Touches:** none

## 2026-09-29 — One source for the extension ID
- **Kind:** decision
- **Fact:** The owner noticed the ID was repeated in 62 places. 16 of those were code, in 10 files (scripts, tests, package.json). PG-10 now requires `extension/metadata.json` to be the only place in code that spells out the ID, with a test to guard it. Docs may keep naming it for readers.
- **Source:** the owner, 2026-09-29.
- **Touches:** BACKLOG.md PG-10

## 2026-09-29 — No trace of the old domain anywhere
- **Kind:** decision
- **Fact:** The owner requires that the old work domain appear in no file: not in docs, ADRs, plans, code, or any past commit. Done when a search of every file in every commit finds zero matches.
- **Source:** the owner, 2026-09-29.
- **Touches:** BACKLOG.md PG-10

## 2026-09-29 — Switch-over rule accepted; alert gap until relogin
- **Kind:** decision
- **Profiles:** Calendar owner, Installer
- **Fact:** The architect's switch-over rule (testing-and-build.md, "Switching an existing install to the new UUID") is accepted. Accepted cost: from install until the owner logs out and back in, payAttention gives no alerts. The old copy is disabled at once, and the new one loads only at login. The owner is told to log out right after installing. The existing uninstall bug (it cannot tell "unknown" from "no shell reachable") is fixed in PG-10.
- **Source:** architect, ADR-0006 amendment.
- **Touches:** BACKLOG.md PG-10, README.md

## 2026-09-29 — Old domain removed everywhere; force-pushed
- **Kind:** solution
- **Fact:** The extension ID is `payattention@tonymalandain.github.io` (PG-10). The history was rewritten (107 commits). A search of history lines, every stored object and the current files finds zero matches for the old domain. Today's files are unchanged by the rewrite. The rewrite was force-pushed, and the remote matches local. Local build and test leftovers carrying the old name were deleted. Two local backup bundles still contain old content: `~/payattention-backup-before-scrub.bundle` and `~/payattention-backup-before-id-scrub.bundle`. The owner must reinstall once, from a terminal inside the session, then log out and back in.
- **Source:** product manager.
- **Touches:** BACKLOG.md PG-10, PG-2

## 2026-09-29 — Owner hears no sound during Test alert
- **Kind:** question
- **Profiles:** Calendar owner
- **Fact:** The owner hears no sound when Test alert reaches Insist and Takeover. The build running in the session was loaded at the 2026-09-26 login and is older than PG-7, so it asks for the older alarm sound. A GNOME notification that asks for the alert sound is heard, so the desktop sound path works. Next check: reinstall, log in again, run Test alert. If it is still silent, it is a defect against R-8 (the insist step has a sound), and it goes to the engineers.
- **Source:** owner report; product manager checks in the live session.
- **Touches:** BACKLOG.md PG-2

## 2026-09-30 — Travel time change on the alert card is hard to find and unreadable
- **Kind:** solution
- **Profiles:** Calendar owner
- **Fact:** On the owner's first real in-person alert, the "· change" link did not look clickable, and the travel choices showed as boxes with no readable text. Expected behaviour is now spelled out in the PRD §4 (a "Change travel time" button, labelled choices that wrap, a saved confirmation, and a heads-up card that stays while choosing), and it is ticketed as PG-11.
- **Why:** a guessed travel time gives a wrong leave-by time, which is the miss the product exists to prevent.
- **Source:** owner report; the product manager decided the expected behaviour.
- **Touches:** docs/prd/meeting-guardian.md §4, BACKLOG.md PG-11

## 2026-09-30 — PG-11 scope narrowed by the owner
- **Kind:** decision
- **Profiles:** Calendar owner
- **Fact:** The owner keeps today's row of travel time boxes. The only visual demand is that the numbers are readable. The extra question text and the "(saved for this place)" wording are dropped. The clickable "Change travel time" button and the heads-up staying while the boxes are shown stay in scope, because they answer the owner's first complaint and prevent losing the card mid-choice.
- **Source:** owner, 2026-09-30.
- **Touches:** docs/prd/meeting-guardian.md §4, BACKLOG.md PG-11

## 2026-09-30 — Menu travel choices: current mark misaligned
- **Kind:** solution
- **Profiles:** Calendar owner
- **Fact:** In the top-bar menu's travel list, the current value shows a check mark slightly left of the round marks on the other lines. Expected: one single-choice style, same mark, same column, the current one filled. Folded into PG-11.
- **Source:** owner report.
- **Touches:** docs/prd/meeting-guardian.md §4, BACKLOG.md PG-11

## 2026-09-30 — PG-11 product answers to the senior engineer
- **Kind:** decision
- **Profiles:** Calendar owner
- **Fact:** Confirmed from the PRD and the owner's words: the boxes may sit on two lines (the owner only asked for readable numbers); the boxes stay open after a pick so the owner sees the line change; closing them after the display time hides the heads-up at once; a pick that moves the heads-up into the future may hide the card, because it comes back at the right new time.
- **Why:** seven readable boxes cannot fit on one line of the heads-up card; a hidden card that returns on time keeps the promise of R-11.
- **Source:** product manager, from the PG-11 plan questions.
- **Touches:** docs/prd/meeting-guardian.md §4

## 2026-09-30 — The travel-box hold never delays another meeting
- **Kind:** decision
- **Profiles:** Calendar owner
- **Fact:** Holding a heads-up open while its travel boxes are shown must never delay another must-attend meeting. As soon as another meeting reaches its nudge or a later step, that meeting takes the card and the hold ends.
- **Why:** the architect showed that, under the proposed hold, an overlapping meeting could sit in the "also" line past its own nudge, and with earlier custom timings past insist, without its sound. The product promise is that must-attend meetings are impossible to miss; a convenience for one card cannot cost another meeting its escalation.
- **Source:** product manager, from the architect's PG-11 Part B review.
- **Touches:** docs/prd/meeting-guardian.md §4, architecture interfaces.md §2

## 2026-09-30 — PG-11 sample: product answers
- **Kind:** decision
- **Profiles:** Calendar owner
- **Fact:** The owner confirms PG-11 in the sample once Parts A, B and C are all built, so the sample shows the real behaviour. The sample may keep its heads-up on screen longer than the real 15 s, so the owner has time to look; this is a viewing aid in the sample only, never in the product.
- **Source:** product manager, answering the senior engineer's PG-11 Part D questions.
- **Touches:** BACKLOG.md PG-11

## 2026-09-30 — Changing travel time always works on a nudge card
- **Kind:** decision
- **Profiles:** Calendar owner
- **Fact:** "Change travel time" must work on a nudge card even when another meeting is also at its nudge or later. The "never delays another meeting" rule ends only a heads-up being held open; it never closes the boxes on a nudge card.
- **Why:** the reviewer found Part B turned the button off on a nudge card beside another active meeting, which is the back-to-back case where a correct leave-by time matters most. Holding a heads-up is the only thing that can delay another meeting, so only that is ended.
- **Source:** product manager, from the PG-11 Part B review.
- **Touches:** architecture interfaces.md §3; BACKLOG.md PG-11

## 2026-09-30 — Owner rejects the travel button and two-line boxes
- **Kind:** decision
- **Profiles:** Calendar owner
- **Fact:** After seeing the sample, the owner found the "Change travel time" button too invasive and the two lines of big boxes worse than before. The card keeps a small "Change time" link and one compact row of small boxes with numbers only, "min" said once. The only real fault was unreadable numbers. My earlier call to make it a full button is superseded.
- **Why:** the owner's words: "a Change Time hyperlink is probably enough … A single row with the values was nice and compact. The only problem is that we couldn't read the values". Numbers without the unit fit one row of the narrowest card; "N min" seven times does not.
- **Source:** owner, 2026-09-30, after `npm run sample`.
- **Touches:** docs/prd/meeting-guardian.md §4, BACKLOG.md PG-11 Part E

## 2026-09-30 — Owner accepts the compact travel row
- **Kind:** decision
- **Profiles:** Calendar owner
- **Fact:** After `npm run sample`, the owner accepted PG-11 Part E: a small "Change time" link and one compact row of numbers. "perfect. UI looks much better now."
- **Source:** owner, 2026-09-30.
- **Touches:** BACKLOG.md PG-11
