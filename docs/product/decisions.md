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
