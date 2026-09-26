# Architect working log

Append only. Newest at the bottom.

## 2026-09-26 — Handoff taken: where calendar data comes from
- **Kind:** decision
- **Fact:** Took the product handoff "Where the calendar data comes from" (product NOTES, 2026-09-26). Answer: EDS through an out-of-process gjs helper (ADR-0001).
- **Why:** The shell's CalendarServer lacks the fields the verdict rules need; in-process EDS can crash the session.
- **Source:** experiments on the author's machine, recorded in ADR-0001.
- **Touches:** ADR-0001, interfaces.md

## 2026-09-26 — Shell CalendarServer is too thin
- **Kind:** interface
- **Fact:** `org.gnome.Shell.CalendarServer` exposes only `SetTimeRange(x,x,b)` and `EventsAddedOrUpdated(a(ssxxa{sv}))`.
- **Why:** Rules out the no-helper option; no attendees, partstat, organiser, or transparency.
- **Source:** `gdbus introspect --session --dest org.gnome.Shell.CalendarServer --object-path /org/gnome/Shell/CalendarServer`
- **Touches:** ADR-0001

## 2026-09-26 — gjs segfaults disposing EDS objects
- **Kind:** constraint
- **Fact:** A gjs script that creates `EDataServer.SourceRegistry.new_sync` and exits segfaults (4/4); trace: `source_registry_dispose` → `g_main_context_iteration` → NULL, called from the GC sweep.
- **Why:** This is why EDS must never run in the shell process, and why the helper's own exit path needs care.
- **Source:** `coredumpctl info` on /usr/bin/gjs-console, 2026-09-26 00:19
- **Touches:** ADR-0001, constraints.md, testing-and-build.md

## 2026-09-26 — Async instance expansion unusable from gjs
- **Kind:** constraint
- **Fact:** `ECal.Client.generate_instances` (async) takes 4 arguments in gjs and has no completion callback; `generate_instances_sync` works.
- **Why:** Forces blocking expansion, which is only acceptable out of the shell.
- **Source:** gjs warning "expected 4, got 5"; probe run.
- **Touches:** ADR-0001

## 2026-09-26 — What the author's calendars contain (counts only)
- **Kind:** data
- **Fact:** 9 enabled+selected sources (7 GOA CalDAV, 1 local, 1 contacts); next 7 days: 26 occurrences, 22 recurring, 8 with attendees (22 total, all CUTYPE individual), 8 with organiser, 5 with the source's own address among attendees (partstat: 3 accepted, 2 needs-action), 26 opaque, 7 with location, 25 with description, 6 with X-GOOGLE-CONFERENCE, 0 with RFC 7986 CONFERENCE, all times in named TZIDs, 1 occurrence present in two sources, all STATUS confirmed.
- **Why:** Sizes the design and shows which fields are really populated; duplicates must be merged; Google's link is in X-GOOGLE-CONFERENCE.
- **Source:** read-only gjs probe, 2026-09-26.
- **Touches:** constraints.md, interfaces.md

## 2026-09-26 — EDS remote refresh is 30 minutes
- **Kind:** constraint
- **Fact:** All 9 sources have ESourceRefresh enabled at 30 minutes.
- **Why:** A meeting added on the provider's side can take up to 30 min to reach the machine; the helper asks EDS to sync every 10 min to narrow this.
- **Source:** probe reading `SOURCE_EXTENSION_REFRESH`.
- **Touches:** constraints.md, ADR-0001

## 2026-09-26 — Freshness trade: helper-requested sync every 10 minutes
- **Kind:** decision
- **Fact:** The helper asks EDS to refresh remote sources every 10 min and on resume.
- **Why:** 30 min lag could make a newly-added meeting miss its 30-min heads-up. Traffic goes only to the owner's own providers, as EDS already does, so R-3 holds. The number is assumed.
- **Source:** assumed
- **Touches:** constraints.md

## 2026-09-26 — Headless shell smoke test works; devkit not installed
- **Kind:** stack
- **Fact:** `dbus-run-session -- gnome-shell --headless --virtual-monitor 1280x720 --virtual-monitor 1024x768 --automation-script <file>` with isolated XDG dirs and `GSETTINGS_BACKEND=keyfile` runs an extension to state ACTIVE with 2 monitors and exits when the script ends. `--devkit` needs the absent `mutter-devkit` package.
- **Why:** Gives a real shell test without touching the author's session.
- **Source:** probe extension run, 2026-09-26 00:24.
- **Touches:** testing-and-build.md

## 2026-09-26 — gnome-extensions tooling pitfalls
- **Kind:** stack
- **Fact:** `install` fails across filesystems when the zip has subdirectories ("Can't recursively copy directory"); `pack` segfaults if `--out-dir` is missing; `pack` needs `--extra-source` for every code dir; `install` compiles schemas.
- **Why:** Each one would otherwise cost the engineers an hour.
- **Source:** runs on 2026-09-26.
- **Touches:** testing-and-build.md

## 2026-09-26 — Fixture EDS works for helper tests
- **Kind:** stack
- **Fact:** A private EDS (isolated XDG dirs, `dbus-run-session`) with a `local` backend `.source` file and a fixture `.ics` is read by ECal; a TZID America/New_York 06:00 event came back as 10:00Z.
- **Why:** The helper can be integration-tested without the owner's data.
- **Source:** run on 2026-09-26.
- **Touches:** testing-and-build.md

## 2026-09-26 — Guests exclude rooms and resources
- **Kind:** decision
- **Fact:** "Guests" in verdict counts means attendees with CUTYPE individual or unknown, excluding the owner; rooms, resources and groups are not guests.
- **Why:** Google adds meeting rooms as attendees; counting them would inflate "N guests" and could turn a personal block into a "small meeting". Sent to product to confirm the meaning.
- **Source:** assumed
- **Touches:** interfaces.md (core judge), docs/inbox.md

## 2026-09-26 — In-person step times are out of order in the PRD
- **Kind:** question
- **Fact:** With the PRD values, the in-person takeover (1 min before leave-by) comes before insist (at leave-by). `plan` clamps offsets to be non-decreasing, so with these defaults insist is never shown for in-person meetings.
- **Why:** Clamping makes any setting safe; the product value is the product manager's call. Sent to product.
- **Source:** PRD §3 table.
- **Touches:** overview.md, data.md, docs/inbox.md

## 2026-09-26 — Owner not invited
- **Kind:** question
- **Fact:** 3 of 8 occurrences with guests do not list the source's own address as organiser or attendee (another person's calendar, or an alias). The PRD rules would fall through to "small meeting: must-attend".
- **Why:** A risk of false takeovers, which users.md names as a reason to give up. Core will compute an owner-role fact (organiser / attendee / not listed / unknown); the verdict for "not listed" is product's. Sent to product.
- **Source:** probe counts, 2026-09-26.
- **Touches:** docs/inbox.md

## 2026-09-26 — Cancelled meetings
- **Kind:** question
- **Fact:** STATUS:CANCELLED is carried in the DTO; the PRD rules do not mention cancelled meetings.
- **Why:** Some providers keep a cancelled occurrence on the calendar; without a rule it would alert. Sent to product.
- **Source:** RFC 5545; none present in the author's data today.
- **Touches:** docs/inbox.md

## 2026-09-26 — Code-side names for glossary terms
- **Kind:** question
- **Fact:** The code-side names are in `overview.md` ("Words" table) rather than in `docs/product/glossary.md`.
- **Why:** This run was told not to edit product documents; the glossary is shared and the product manager may copy them across.
- **Source:** task instruction.
- **Touches:** overview.md
