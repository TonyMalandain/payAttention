# ADR-0010 — AI mode: the AI helper judges every meeting without an override, from a bounded copy of the whole invite, as stored data that never sits on the alert path
- **Date:** 2026-09-27
- **Kind:** reversible, except the stored formats: the `verdict-source`, `ai-endpoint`, `ai-model` and `ai-verdicts` schema keys (`data.md`). None of them has shipped yet.
- **Status:** amended 2026-09-27 (see the end: D-022 to D-025; D-031)
- **Supersedes:** ADR-0008 (AI second opinion on "unsure" verdicts only, from the D-018 facts)

## Context

The owner replaced the "second opinion" with a mode switch (D-019, superseding
D-017). There are two modes: rules (the default), or AI. In AI mode the engine
decides every meeting. The owner's overrides always win and are not sent. An
unreachable engine means the rules decide that meeting. The owner also chose to
send the whole invite (D-020, superseding D-018): title, time, description,
place, video link, organiser, and guests with names, email addresses and
responses. Settings take one endpoint, one model and one API key (D-021, the
owner's words: "The user can specify API KEY + endpoint via settings page").
The spec is the PRD addendum "2026-09-27 — AI mode". It serves R-18 (AI mode
judges every meeting) and R-19 (the owner connects the engine of their choice).

What still holds from ADR-0008: the engine is the least trustworthy thing the
product talks to (a network, a model, text from strangers, a secret). An HTTP
call can take a minute on the owner's CPU-only machine (NOTES, 2026-09-26).
`judge` is pure (ADR-0002). `disable()` runs on every lock (ADR-0005).

What is new, and forces a new decision rather than an edit:

1. **Load.** Every meeting in range is asked, not only the unsure ones. On
   the owner's calendar that is about 4 to 10 occurrences in the 37-hour
   snapshot range (26 in 7 days, measured). At the designed scale it is up to
   2 000 (assumed, `constraints.md`).
2. **Churn.** The fingerprint now covers the guests' responses, so every RSVP
   re-asks that meeting. RSVPs cluster close to the start, which is exactly
   when the interim rule verdict can show or hide an alert.
3. **Prompt size.** A whole invite is unbounded: a Teams or Zoom description
   is often 2 to 5 KB of boilerplate, and a large meeting has hundreds of
   guests. On the CPU, prompt processing is the slow part (assumed: tens of
   tokens per second for an 8B model), so size is latency.
4. **Flicker.** In AI mode the rules verdict is only a stand-in until the
   answer arrives. If a changed invite dropped back to the rules, a meeting the
   AI had silenced could put up a heads-up for a few seconds, then lose it when
   the new answer arrives.

## Options

1. **Keep ADR-0008 and widen eligibility to every code.** Forever cost: the
   "sure/unsure" machinery stays for no purpose. Changed invites fall back to
   the rules, so force 4 appears around every RSVP.
2. **Ask about every meeting without an override, from a bounded invite. A
   stale answer keeps applying while its re-ask is pending, and is dropped
   once the engine is unavailable.** Forever cost: one more state (a stale
   answer) that the controller must clear when the engine fails.
3. **Batch: one request per snapshot, with every invite.** Forever cost: one
   bad or hostile invite spoils the verdicts for all of them. The prompt grows
   with the calendar, which is the slow case on the CPU. A partial reply needs
   its own validation rules. Churn on one meeting re-asks all of them.

## Decision

**Option 2.** The deciding reason: **one bounded invite per request keeps the
blast radius of a hostile invite to its own verdict and keeps the cost of a
change to one meeting. Serving the stale answer while it is re-asked is the
only way a changed invite does not flash an alert that the AI had already
silenced.** In detail:

- **Process** (unchanged from ADR-0008, option 3 there). `extension/ai/` is a
  gjs program, and the only code with network access or the API key. It is
  spawned only in AI mode, only when there is something to ask, and for
  "Test connection" by `prefs.js`. It is killed in `disable()`, when the mode
  leaves AI, and when an engine setting changes. It holds no state that
  matters.
- **Eligible** *(amended 2026-09-27, D-023: cancelled, declined and all-day meetings are no longer eligible; see the end)*: in AI mode with a usable engine, every judged occurrence that
  has no verdict override (occurrence or series). This includes cancelled,
  declined, all-day and free meetings, because D-019 says "every meeting", and
  their status, the owner's response, the all-day flag and busy/free are in the
  invite. An all-day occurrence has no deadline, so `plan()` never alerts for
  it, whatever the verdict is (`core/plan.js:87`). Asking about one costs a
  request and changes only the menu. Only `test` is never eligible.
- **Input** *(amended 2026-09-27, D-022, D-024, D-025: the calendar name is now sent, and passcodes are removed; see the end)*: the invite object (`interfaces.md` §6.2), built by core from the
  occurrence DTO. Every text field has a cap, the guest list is capped at 25
  with the true total given, and the serialised invite is at most 8 192 bytes.
  The UIDs, the calendar name, the occurrence key and the rule's own verdict
  are never sent. The rule verdict is left out on purpose: in AI mode the AI
  decides, and it should not be anchored on the rule it replaces.
- **Fingerprint** = hash(prompt version, engine tag, invite in fixed key
  order), where the engine tag is the normalised endpoint and the model.
  Stored answers are kept (`ai-verdicts`), keyed by occurrence key.
- **`judge`, pure,** for an eligible occurrence:
  - fingerprint matches → the stored answer applies;
  - an entry exists but its fingerprint differs → the stored answer still
    applies, marked `aiStale`, and a re-ask is emitted;
  - no entry → the rule verdict applies, and an ask is emitted.
- **Controller:** a key with an outstanding ask has either no entry or a
  stale one, and the controller knows these keys from `judge`'s output. It
  withholds those keys' stored entries from `judge` (in memory; the store keeps
  them) when the engine is down, and for any key whose own most recent ask
  failed *(wording amended 2026-09-27 for D-031; see the end)*. The rules then decide those meetings, as D-019 requires.
  It never has to compute a fingerprint itself. The rest of the queue, the
  retry rules and the status are in `interfaces.md` §6.5.
- **Never on the alert path.** The tick and `plan()` never read or wait for
  the queue. An answer is stored, and `judge` re-runs, as after an override.
  The level-triggered ladder (ADR-0002) puts the meeting on the step that fits
  the current time.
- **What the AI can change:** `verdict`, `reason` and `reasonCode`
  (`ai-must` / `ai-ignore`) of an eligible occurrence. Nothing else: mode,
  join link, travel, deadline and timing are computed as in rules mode, by
  construction in `judge`.
- **Settings** (`data.md`). One mode key, `verdict-source` (`rules` or `ai`,
  default `rules`), replaces `ai-enabled`. One engine, `ai-endpoint` and
  `ai-model`, replaces the separate local and cloud pairs and `ai-location`.
  The API key stays in the keyring, per normalised endpoint (ADR-0009, as
  amended). An empty key is a keyless engine. Whether the invite leaves the
  computer is worked out from the endpoint by core (loopback or not), not
  stored as a setting that could disagree with it.

## Consequences

- Easier: one concept ("AI mode decides, the rules stand in"), with no
  sure/unsure list to maintain. Settings are the three things the owner named.
  A keyless local engine is just an empty key.
- Harder: request volume grows with the calendar and with RSVP churn. This is
  bounded by the budget in `constraints.md` and by stored answers. On first
  sight the owner sees rule verdicts that turn into AI verdicts one at a time,
  soonest meeting first. On the CPU this can take minutes for a full day.
  *(Corrected 2026-09-27: this bullet first said an engine or model change
  also shows rule verdicts. It does not.)* After an engine or model change the
  engine tag in every fingerprint differs, so each stored answer becomes a
  **stale** answer and keeps applying while its meeting is asked again, as for
  a changed invite (`interfaces.md` §6.3, `data.md`). Only a meeting with no
  stored answer, or one withheld because the engine is down or its own ask
  failed, shows the rule verdict.
- **Stale answers can be wrong for a while.** If an invite changes from "FYI"
  to something that matters, the old ignorable answer applies until the
  re-ask completes, which is seconds to about a minute on the CPU. It is asked
  first if it is the soonest. This is accepted over the flicker it prevents.
  The one-click override is the remedy (D-019's own remedy).
- **A verdict can change while an alert is on screen** (as in ADR-0008). This
  is the cost D-019 accepts.
- The stored `reason` may now paraphrase a person's name, not only a title
  (`data.md`).
- Rules mode spawns nothing, builds no invite and sends nothing, by
  construction: `config.ai` is null.

## Revisit when

- The typical first-sight backlog makes the owner wait more than about
  10 minutes for AI verdicts on a normal day. Then allow two requests at once
  for non-loopback engines, or a batch message. The process boundary stays.
- `ai-verdicts` grows past about 64 KiB (the ADR-0003 trigger).
- An invite field outside §6.2 is shown to change verdicts. (The calendar
  name was the known candidate; D-024 added it on 2026-09-27.)
- The review process rejects a second spawned gjs helper.

## Amendment 2026-09-27 — D-022, D-023, D-024, D-025

Made the same day, before anything in this ADR shipped, after the product
manager closed four findings. The decision above (option 2) stands; three of
its details change. `interfaces.md` §6.1, §6.2 and §6.6 hold the contract.

- **Eligibility narrowed (D-023).** A meeting that is cancelled, that the
  owner declined, or that is all-day (or has no finite start) is *silent by
  fact*: no invite, no ask, and any stored answer for it is ignored. It keeps
  its rule verdict, which is `ignore`. This is decided from the kept copy's
  facts after the merge, not from the rule's reason code. Why: these are
  facts, not judgments of importance. Asking could only turn a declined
  meeting into an alert, and an all-day event has no start for the ladder.
  The original text above made them eligible because D-019 said "every
  meeting"; D-023 narrows that to every meeting that can be attended. It also
  removes requests that could never change an alert.
- **The calendar name is sent (D-024).** Field `calendar`, right after
  `title`, cleaned and capped at 80 characters, from the kept copy's source;
  `""` when the source is unknown. It is in the fingerprint, so a rename
  re-asks. The "never sent" list and the revisit trigger above are amended to
  match. Why: it is the strongest clue between family logistics and work.
- **Passcodes removed (D-022, D-025).** `videoLink`, and every conferencing
  link inside the description and place, is cut at its first `?` or `#`.
  In the description and place, the value after "passcode", "password",
  "pwd" or "PIN" is replaced with `[removed]`. Why: a passcode lets anyone who
  sees it join, and the engine needs only to know the meeting is online. The
  cost accepted by product: a description that uses one of these words for
  something else loses the word after it.
- **The AI protocol refuses unknown keys in both directions.** Not a product
  decision; recorded here because it is the opposite of the calendar
  protocol's rule. Both ends ship in one zip, so there is no version skew to
  tolerate, and the exact key set is the guard on what leaves and what comes
  back.
- **Consequence for the helper's imports.** The AI helper imports exactly
  `core/aiProtocol.js`, `core/aiPrompt.js` and `core/aiEngine.js` (the calendar
  protocol module comes in transitively for its enum lists). The invite
  *builder* lives outside them, in `core/invite.js`, so the helper cannot
  build or reshape an invite; it can only check one.

## Amendment 2026-09-27 — D-031: a truthful "unavailable" line, and recovery within 5 minutes

Made before anything in this ADR shipped, after the product manager closed the
PG-4c plan's findings. The decision (option 2) stands. `interfaces.md` §6.5
holds the exact rule; this records why it has that shape.

- **"Unavailable" was one flag doing two jobs.** It withheld stale answers
  and it drove the menu line, and it stayed set until any answer arrived. A
  single bad invite (`bad-reply`) could then drop every stale answer and keep
  the line on for hours. It is now split: an *engine down* flag (set by
  engine-level failures, the budget, a lost helper; cleared by an engine
  reply) and a per-meeting *failed* set. Withholding uses both. The menu line
  is computed from what is true now: it shows only while at least one waiting
  meeting is decided by the rules because of a failure.
- **Unreachable is an engine state, not a meeting's fault.** `network`,
  `timeout`, `tls` and `server` pause the whole engine for 30 s, doubling,
  capped at 90 s, so an outage costs one probe per pause instead of one
  request per meeting per minute. Probes sent while the engine is already
  down do not push any meeting's own retry further out, and their spends are
  returned to the budget. That is what makes recovery fast: without it,
  30 waiting meetings failing once a minute would spend the hourly budget in
  four minutes, and the per-meeting retries would reach 30 min.
- **The 90 s cap is sized from D-031's 5 minutes**, not from load: a failing
  ask in flight can take `timeoutMs + 10 s` (100 s locally), then one pause,
  then the engine's own answer time (up to 90 s): about 281 s.
- **Options not taken.** Keeping per-meeting backoff only (fails the bound
  and the budget). A separate health-check request to the engine (a second
  request shape, and it proves the address answers, not that a verdict
  comes back; a real ask of the soonest meeting is both the probe and the
  work). Not counting failures in the budget at all (a cloud engine that
  answers `bad-reply` or `auth` did work, and those stay counted).
- **Cost accepted** (D-031): the line can appear and disappear as meetings
  are asked, and the engine is probed up to 40 times an hour while down.
