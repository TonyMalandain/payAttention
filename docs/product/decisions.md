# Decisions

Closed product decisions only. Newest at the bottom.

### D-001 — The project is non-commercial — 2026-09-26
**Decision:** We treated payAttention as a personal tool built for the author's own use, with no buyer or pricing.
**Why:** The request was "alert me". It is one person's own daily problem, and it was also framed as an experiment.
**Costs accepted:** No ICP or positioning work. If it is ever offered to others, that is a new decision.
**Source:** assumed, from the setup prompt (unattended; no follow-up possible).

### D-002 — We built instead of adopting an existing tool — 2026-09-26
**Decision:** We built a new GNOME extension instead of using an existing reminder extension or a Mac-only takeover app.
**Why:** No tool found runs on GNOME and combines importance judgment, escalation to a takeover, and travel-aware timing. "In Your Face" does the takeover on Mac and Windows only. GNOME options such as Calendar Reminders, Chronome, and Next Meeting show ordinary notifications or countdowns. The author also asked for it explicitly as an experiment.
**Costs accepted:** We own the maintenance, including keeping up with each new GNOME release.
**Source:** the author's request, plus a web search on 2026-09-26.

### D-003 — Verdicts are made locally by explainable rules, not by an AI service — 2026-09-26
**Decision:** We judged must-attend versus ignorable on the machine, from what the calendar already says, and gave every verdict a readable reason and a one-click override.
**Why:** Calendar contents are sensitive business data. The alert must work offline and instantly. A verdict you can read and correct builds trust faster than a smarter one you cannot inspect.
**Costs accepted:** Unusual meetings get misjudged until the owner overrides them once. The product is less "smart" than the author's wording ("smart enough to understand") may have imagined.
**Source:** assumed by the product manager (unattended run), recorded in `docs/product/solution.md`.

### D-004 — "About to miss it" means "has not acknowledged yet" — 2026-09-26
**Decision:** We treated every must-attend meeting as at risk until the owner acknowledges it or joins it from the alert. We did not try to detect presence in a call.
**Why:** Presence detection is unreliable and intrusive. One click is a cheap and certain signal, and a false "you are fine" is the worst failure.
**Costs accepted:** If the owner joins a meeting some other way, they must still click "I'm on it" once, or the takeover will appear.
**Source:** assumed by the product manager (unattended run).

### D-005 — The first warning is brief, and persistence comes from escalation — 2026-09-26
**Decision:** We read the prompt's "popping up 30 mins before … then disappears" as the heads-up step. It appears at the lead time and fades on its own. Only when it is ignored do the following steps stay on screen and become intrusive.
**Why:** It keeps the first warning cheap, as the author described it, while guaranteeing the escalation the author asked for when the owner is "about to miss it".
**Costs accepted:** A heads-up seen but not acted on still leads to a stronger alert. The owner must acknowledge to stop it.
**Source:** the author's prompt, as interpreted by the product manager.

### D-006 — Default lead times: 30 minutes online, travel time plus 10 minutes in person — 2026-09-26
**Decision:** We set the heads-up for online meetings at 30 minutes before the start. For in-person meetings it is 10 minutes before the leave-by time, with a default travel time of 30 minutes when the place has no stored value. All of these can be changed in settings.
**Why:** 30 minutes is the author's own number. The in-person margin gives time to pack up before leaving.
**Costs accepted:** The travel default is a guess. It will be wrong for some places until the owner sets them.
**Source:** the author's prompt (30 minutes); the other defaults are assumed.

### D-007 — A meeting with both a video link and a place counts as online — 2026-09-26
**Decision:** We treated hybrid meetings as online by default, and the owner can switch one to in-person.
**Why:** A remote option always exists, so the shorter warning is never fatal. It is also the more common case in the author's calendar (assumed).
**Costs accepted:** If the owner plans to go in person, they get a late warning unless they switch the meeting once.
**Source:** assumed by the product manager.

### D-008 — In-person steps run 10, 5, and 2 minutes before leave-by, then take over at leave-by — 2026-09-26
**Decision:** We set in-person escalation to heads-up 10 min, nudge 5 min, and insist 2 min before the leave-by time, with the takeover at the leave-by time. Steps always come in the same order.
**Why:** The first spec put the takeover before the insist step for in-person meetings, so insist could never show (found by the architect).
**Costs accepted:** In-person steps are closer together than online steps.
**Source:** the product manager, closing an architect finding.

### D-009 — Cancelled meetings and meetings the owner is not invited to are ignorable — 2026-09-26
**Decision:** We made cancelled meetings, and meetings that list guests but none of the owner's addresses, ignorable, with the reasons "cancelled" and "not invited: someone else's meeting". The owner's addresses are those of the connected calendar accounts, plus any extras in settings.
**Why:** 3 of 8 real meetings with guests in the author's week came from calendars of others. They would have caused false takeovers, and a false takeover is what makes the owner give up.
**Costs accepted:** An invitation sent to an address the product does not know gets no alert until the owner adds that address or overrides the meeting.
**Source:** the product manager, closing an architect finding based on the author's real calendar (counts only).

### D-010 — The product warns when it cannot see the calendar, and never shows "no meetings" instead — 2026-09-26
**Decision:** We chose to show a warning mark and a "calendar not updating since <time>" line after 15 minutes without fresh calendar data.
**Why:** Silent failure looks like safety, and a false "you are fine" is the worst failure (D-004).
**Costs accepted:** A short network loss can show a warning that turns out to be harmless.
**Source:** the product manager, closing an architect finding.

### D-011 — Meeting rooms and equipment are not guests — 2026-09-26
**Decision:** We counted only people other than the owner as guests, for reasons and meeting-size rules.
**Why:** A room booking does not make someone notice your absence.
**Costs accepted:** none of practical weight. A meeting whose only other attendee is a room is treated as a personal block.
**Source:** the product manager, confirming the architect's assumption.

### D-012 — A meeting with one other person is must-attend — 2026-09-26
**Decision:** We made the small-meeting rule cover 1 to 15 guests, not 2 to 15, so a 1:1 is must-attend with the reason "small meeting (1 guest)".
**Why:** In a 1:1 your absence is always noticed. The first spec left one-guest meetings with no rule (found by the senior engineer).
**Costs accepted:** none of practical weight. A 1:1 the owner does not care about needs one override.
**Source:** the product manager, closing a senior-engineer finding.

### D-013 — "Calendar not updating" also covers a calendar that cannot sync with its provider — 2026-09-26
**Decision:** We extended D-010. The warning also shows when the desktop has not synced with the calendar provider for 15 minutes, even if meetings are still shown from the saved copy. Alerts keep running from the saved copy while the warning shows.
**Why:** Offline, the saved copy looks healthy but misses newly booked meetings. That is the same false "you are fine" that D-010 exists to prevent.
**Costs accepted:** Working offline for long periods shows a steady warning.
**Source:** the product manager, closing a senior-engineer finding (PG-1b plan).

### D-014 — The stale-calendar warning is judged per calendar and names the calendar — 2026-09-26
**Decision:** We chose to show the warning when any one online calendar has not been reachable for 15 minutes, and to name that calendar in the menu line.
**Why:** One failing account hides that account's meetings, so warning is the safe direction. Naming the calendar tells the owner what to fix or hide.
**Costs accepted:** A calendar that always fails keeps the warning on until the owner fixes or hides it. A provider that is reachable but answers with errors is not detected.
**Source:** the product manager, closing an architect finding.

### D-015 — An event with no guests and no organiser is a personal block — 2026-09-26
**Decision:** We kept the rule that an event with no other guests is ignorable ("no other guests: personal block"), even when the calendar gives no guest list at all. "Not enough information" applies only when the owner's own address is unknown.
**Why:** The calendar cannot tell "no guest list" apart from "an empty guest list". Personal blocks and placeholders are the main source of noise the product exists to remove.
**Costs accepted:** A personal appointment that matters (a doctor, a flight) is silent unless its title has an important word or the owner marks it must-attend once. Overrides can cover the whole series.
**Source:** the product manager, closing a reviewer finding.

### D-016 — Uninstalling keeps the owner's saved choices unless asked to erase them — 2026-09-26
**Decision:** We chose an uninstall that removes the extension and stops it loading, keeps the saved overrides, travel times and settings by default, and erases them only when the owner asks.
**Why:** Overrides and travel times are the owner's own manual work. Losing them by accident on a reinstall costs more than leaving a few settings behind.
**Costs accepted:** A plain uninstall leaves the saved settings on the machine. The owner must use the erase option for a full clean-up.
**Source:** the product manager, after the owner pointed out that no uninstall existed (2026-09-26).
