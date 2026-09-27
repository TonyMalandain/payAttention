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

### D-003 — Verdicts are made locally by explainable rules, not by an AI service  [SUPERSEDED by D-017 on 2026-09-26]
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

### D-017 — An optional AI engine gives a second opinion, and the owner chooses where it runs  [SUPERSEDED by D-019 on 2026-09-27]
**Decision:** We chose to let an AI model judge the meetings the rules are unsure of. The owner turns it on and picks the engine: one hosted on their own machine or network, or a cloud service. It is off by default. The rules still decide the sure cases, the owner's overrides always win, and every AI verdict shows a one-line reason marked as the AI's opinion. If the engine is unreachable, the rules alone decide.
**Why:** The owner asked for a system "smart enough to understand" meetings, and asked for the choice between a cloud and an internally hosted engine. D-003's reasons still hold for anyone who leaves it off: privacy, working offline, and verdicts that explain themselves.
**Costs accepted:** Setup is no longer zero for owners who want AI. With a cloud engine, meeting facts leave the machine (limited by D-018). AI verdicts can change from one day to the next, and they are harder to predict than rules.
**Source:** the owner, 2026-09-26 ("you should use a llm abstraction library, so that the user can decide to use a cloud-hosted or internally hosted llm engine").

### D-018 — Only the facts the rules already use are sent to the AI engine  [SUPERSEDED by D-020 on 2026-09-27]
**Decision:** We chose to send only the meeting title, the start time and length, the number of guests from inside and outside the owner's organisation, the owner's response, whether the owner organised it, and whether it has a place or a video link. Guest names, email addresses, descriptions and places are never sent.
**Why:** It is the smallest set that lets a model judge importance. It limits what a cloud engine can learn about the owner's contacts and business.
**Costs accepted:** The model cannot use the description or the names of people, which sometimes show what a meeting is about.
**Source:** assumed by the product manager. The owner can widen it by a new decision.

### D-019 — Two verdict modes: rules, or AI deciding every meeting — 2026-09-27
**Decision:** We chose two modes the owner picks between. In **rules** mode, the fixed rules decide, which is the default and the behaviour with AI off. In **AI** mode, the AI engine decides every meeting and gives a one-line reason marked "AI:". In both modes the owner's own overrides always win. If the engine cannot be reached, the rules decide that meeting, and the menu says so.
**Why:** The earlier split between "sure" and "unsure" rules had no score behind it. It was a hand-drawn line the owner could neither see nor tune, and it hid real mistakes from the AI (a family event counted as "you organised it"). A whole-mode choice is simpler to understand.
**Costs accepted:** In AI mode, the AI can silence a meeting the rules would have alerted, including one already alerting. That goes against "when unsure, warn" (D-004). The shown reason and the one-click override are the remedy. AI verdicts can vary from day to day.
**Source:** the owner, 2026-09-27.

### D-020 — In AI mode the whole invite is sent to the engine — 2026-09-27
**Decision:** We chose to send the whole meeting invite to the AI engine, local or cloud. That is the title, time, description, place, video link, organiser and guests with their names, email addresses and responses. Settings state this plainly, and say that with a cloud engine it leaves the computer.
**Why:** More context gives better verdicts. The owner chose this knowing the privacy cost.
**Costs accepted:** With a cloud engine, contacts and business details of every meeting reach a third party. The owner accepts this by choosing AI mode with a cloud engine.
**Source:** the owner, 2026-09-27.

### D-021 — Engines are reached through one standard connection, not a bundled library — 2026-09-27
**Decision:** We chose to reach any AI engine through the standard connection most engines share. The owner enters an address (endpoint), a model name and an API key in Settings. No AI library ships inside the extension.
**Why:** The available libraries need Python or Node installed, which GNOME extensions should not require. One of them was compromised in March 2026 to steal API keys. The standard connection already covers local engines (for example Ollama) and cloud services (for example OpenAI and OpenRouter).
**Costs accepted:** An engine that does not speak the standard connection needs a gateway the owner runs themselves, or an adapter built later. This reverses the owner's first request for "an llm abstraction library".
**Source:** the owner, 2026-09-27, accepting the architect's recommendation (ADR-0007).


### D-022 — Passcodes are removed from video links before the invite is sent — 2026-09-27
**Decision:** We chose to send video links to the AI engine without their passcode or query part. Everything else in D-020 is unchanged.
**Why:** The engine only needs to know that a meeting is online. A passcode lets anyone who sees it join the meeting.
**Costs accepted:** none of practical weight.
**Source:** the product manager, closing an architect finding.

### D-023 — In AI mode, cancelled, declined and all-day meetings stay silent without asking the AI — 2026-09-27
**Decision:** We kept cancelled meetings, meetings the owner declined, and all-day events silent in AI mode, and did not send them to the engine.
**Why:** These are facts, not judgments of importance. An all-day event has no start time for the alert ladder. Asking the AI could only turn a meeting the owner declined into an alert, which is noise the product exists to remove.
**Costs accepted:** An all-day event that matters (an offsite) never alerts in either mode. It narrows "the AI decides every meeting" (D-019) to every meeting that can be attended.
**Source:** the product manager, closing an architect finding.

### D-024 — The calendar's name is sent with the invite — 2026-09-27
**Decision:** We chose to include the name of the calendar a meeting comes from (for example "Family") in what is sent to the AI engine.
**Why:** It is the strongest clue that separates family logistics from work meetings, which is the case that led to AI mode. It falls within "the whole invite" (D-020).
**Costs accepted:** The owner's calendar names reach the engine, including a cloud one.
**Source:** the product manager, closing an architect finding.

### D-025 — Passcodes written as text are also removed before sending  [SUPERSEDED by D-027 on 2026-09-27]
**Decision:** We extended D-022. In the description and the place, the value after "passcode", "password", "pwd" or "PIN" is replaced with "[removed]" before the invite is sent.
**Why:** Zoom and Teams invites usually repeat the passcode as plain text. Removing it only from links (D-022) left it going to the engine anyway.
**Costs accepted:** A description that uses one of these words for something else loses the word after it. The verdict does not depend on it.
**Source:** the product manager, closing a senior-engineer finding.

### D-026 — The project is licensed under the Apache License 2.0 — 2026-09-27
**Decision:** We chose the Apache License 2.0 for the whole project. It replaces the "GPL-2.0-or-later" an engineer had put in the build file without a decision.
**Why:** The owner's choice.
**Costs accepted:** GNOME's review rules say an extension must be distributable under terms compatible with GPL-2.0-or-later. Apache 2.0 is compatible with GPL-3.0 but not with GPL-2.0 alone. A reviewer on extensions.gnome.org could question it if the extension is ever published there. It does not affect installing it from the repository. Checked on 2026-09-27: nothing is bundled; the development tools are permissive (MIT, Apache-2.0, BSD, ISC, BlueOak) and never shipped; the GNOME libraries used at run time are LGPL or GPL-2.0-or-later and come with the system. Because GNOME Shell is GPL-2.0-*or-later* and Apache 2.0 is GPL-3.0-compatible, the combination can be distributed, so there is no conflict.
**Source:** the owner, 2026-09-27.

### D-027 — A text passcode is removed up to the end of its line — 2026-09-27
**Decision:** We changed how D-025 reads "the value". Everything after "passcode", "password", "pwd" or "PIN" (and any words such as "code" or "is" and separators such as ":", "-" or "=") is replaced with "[removed]", up to the end of that line.
**Why:** Codes are often written in groups ("PIN: 263 947 381#", "Passcode: 12 34 56"). Removing only the next word leaked most of the code (found in review).
**Costs accepted:** Text after the keyword on the same line is lost, even when it is not part of the code. The verdict does not depend on it.
**Source:** the product manager, closing a reviewer finding.


### D-028 — payAttention follows GNOME's alert-sound choice, including "None" — 2026-09-27
**Decision:** We chose to play the alert sound selected in GNOME Settings. When the owner selects "None", payAttention's alerts are silent as well. The on-screen escalation is unchanged.
**Why:** "None" is a deliberate, desktop-wide choice by the owner. Overriding it would make payAttention the one app that ignores their sound settings. The takeover is unmissable without sound.
**Costs accepted:** An owner who picks "None" but wants payAttention to beep gets no sound. They would have to choose an alert sound in GNOME Settings.
**Source:** the product manager, closing a senior-engineer finding (PG-7 plan).

### D-029 — Phone dial-in strings are removed, and HTML line breaks count as line breaks — 2026-09-27
**Decision:** We chose three changes. (1) Before sending, phone dial-in strings in the description and place are replaced with "[removed]". These are numbers with pause or extension codes, such as `+16699006833,,81234567890#,,,,*654321#`. (2) HTML line breaks (`<br>`, the end of a paragraph or list item) count as the end of a line for D-027. (3) Plural keywords ("passcodes", "passwords", "PINs") and invisible marks hidden inside a keyword do not stop removal.
**Why:** Zoom's "one tap" lines carry the passcode with no keyword before it, so D-027 missed them (found in review). The engine does not need phone numbers to judge a meeting. HTML descriptions would otherwise lose everything after a passcode, not just the rest of the line.
**Costs accepted:** Dial-in phone numbers never reach the engine, even where they would hint at a meeting's type.
**Source:** the product manager, closing reviewer findings (PG-4a round 2).

### D-030 — Invites are turned into plain text first, and passcode removal is best effort — 2026-09-27
**Decision:** We chose to convert HTML descriptions to plain text before any removal rule runs. Line-ending tags (any `<br …>` with attributes, `</p>`, `</li>`, `</div>`, `</tr>`, `</td>`, `</h1>`–`</h6>`) become line breaks. All other tags are dropped. Entities (`&nbsp;`, `&shy;`, `&#8203;`, `&#x…;`) are decoded. Percent-encoded characters in dial strings (`%2C`, `%23`) are decoded. Every invisible or direction mark the invite cleaning removes is also removed before matching. After this round, the removal of passcodes and dial-in strings is **best effort**, and Settings says so next to the "whole invite is sent" warning.
**Why:** Rule-by-rule fixes kept finding new formats (reviews of PG-4a and PG-4a2). Plain text first closes whole classes of leak at once. The owner chose to send the whole invite (D-020), so removal is a courtesy that lowers risk, not a promise. Chasing every crafted format has no end.
**Costs accepted:** An unusual or deliberately disguised passcode may still reach the engine. HTML formatting is not sent, which the engine does not need.
**Source:** the product manager, closing reviewer findings (PG-4a2 round 1).
