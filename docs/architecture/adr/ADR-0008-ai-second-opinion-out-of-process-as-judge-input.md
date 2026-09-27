# ADR-0008 — The AI second opinion runs in its own on-demand helper process and reaches `judge` as stored data, never on the alert path
- **Date:** 2026-09-26
- **Kind:** reversible, except the stored `ai-verdicts` key format (schema key, `data.md`)

## Context

R-18 and D-017: an optional engine judges the meetings the rules are unsure
of. Its answer replaces the rule verdict and reason, and nothing else. The
owner's overrides and the sure rules always win. When the engine is
unreachable, the rules decide and the menu says so. "An alert is never delayed
while waiting for the AI." A meeting is judged once, and asked again only when
its facts change. Only the D-018 facts are sent, and what comes back is "data,
never instructions".

The system already has a pattern for slow or risky work: the calendar helper
(ADR-0001). It is a gjs subprocess speaking NDJSON over stdio, supervised by
the shell and killed in `disable()`. And `judge` is pure (ADR-0002): overrides
already arrive as an input, next to the snapshot.

An HTTP call to an engine can take tens of seconds. A local model loading
cold on the CPU is the slow case, and on 2026-09-26 the owner's NVIDIA driver
was not loaded (see NOTES). The call can hang, fail, return garbage, or return
text crafted by whoever wrote the meeting title. It also needs the owner's API
key.

## Options

1. **HTTP from the shell process (Soup async), results into `judge`.** Fewer
   parts, and async Soup does not block the compositor. Forever cost: the API
   key and untrusted model output live in the gnome-shell process. A libsoup or
   TLS fault, or a leak, is a desktop fault. Network code lands inside the
   process whose crash ends the session. `constraints.md` says "no network from
   our code" in the shell, and this would break it in the worst place.
2. **Add the engine calls to the calendar helper.** One process fewer. Forever
   cost: the only process that reads calendars would gain network access and a
   key. The helper would have to know verdicts, which `boundaries.md` forbids.
   A crash in either job would stop both, and calendar freshness (D-010) would
   then depend on the AI.
3. **A second gjs helper, the AI helper, started only while AI is on.** It
   speaks its own NDJSON protocol, reads the key from the keyring itself, and
   returns validated verdicts. The shell stores them, and `judge` reads them as
   one more input. Forever cost: a second small protocol and a second
   supervised process.

## Decision

**Option 3.** The deciding reason: **the engine is the least trustworthy thing
the product will ever talk to** (a network, a model, text from strangers, a
secret). It must not share a process with the desktop, nor with the calendar
reader. The shape:

- **Process.** `extension/ai/` is a GJS program run with `gjs -m`. It is the
  only code that opens a network connection, and the only code that reads the
  API key. It is spawned when `ai-enabled` is true *and* there is at least one
  request to make. It is also spawned by `prefs.js` for "Test connection". It
  is killed (SIGKILL, like the calendar helper) in `disable()`, when AI is
  turned off, and when the engine settings change. It exits on stdin EOF. It
  holds no state that matters: a kill loses at most the requests in flight,
  which are asked again.
- **Contract.** `interfaces.md` §6: the shell sends `configure` (base URL,
  model, location, timeout; never the key), then `judge` requests carrying
  exactly the D-018 facts. The helper returns `verdict` or `failed` with a
  short code. Both sides validate every line with one core module.
- **Purity.** `judge` takes a fifth input, `aiVerdicts`, next to `overrides`.
  For each occurrence whose rule reason code is one of the unsure codes, and
  which has no owner override, `judge` computes the D-018 facts and their
  fingerprint. If `aiVerdicts` holds an entry for that occurrence key with the
  same fingerprint, `judge` takes its verdict and reason. Otherwise it keeps
  the rule verdict and emits an AI request for that occurrence. Invalidation is
  therefore not an event anyone has to remember: changed facts give a
  different fingerprint, so the stored answer no longer applies. `judge` still
  reads no clock and does no I/O.
- **What the AI can change.** Only `verdict`, `reason` and `reasonCode`
  (`ai-must` or `ai-ignore`) of an occurrence that was eligible. Mode, join
  link, travel, deadline and alert timing are computed exactly as before. This
  is enforced by construction in `judge`, not by trusting the reply.
- **Never on the alert path.** The tick and `plan()` never wait for the AI
  helper. A verdict that arrives is stored, and `judge` re-runs, like an
  override. Until then, the rule verdict drives the alert ladder. Because the
  ladder is level-triggered (ADR-0002), a verdict that arrives later puts the
  meeting on the step that fits the current time. It never replays passed
  steps, and it never delays any step.
- **Persistence.** Answers are stored in the GSettings key `ai-verdicts`
  (`data.md`), so a screen lock (which runs `disable()`, ADR-0005) does not
  send the same questions again at every unlock. The fingerprint is a hash, not
  the facts, so no title is stored as a key. The reason text is stored: it is
  written by the model, and it may paraphrase the title. It is capped at 80
  characters and pruned after 7 days, like `occ:` overrides. This is the first
  stored value derived from calendar content, and `data.md` says so.

## Consequences

- Easier: a hung, slow or crashing engine costs nothing but "AI unavailable —
  using rules". The shell process has no network code and never sees a key.
  The AI helper can be run by hand against a fake engine and tested without a
  shell. With AI off, no process is spawned and no request is built, so "with
  AI off, nothing is sent anywhere" holds by construction.
- Harder: a third process kind to supervise. A second versioned protocol. A
  new stored key whose format is a one-way door once written (`data.md`).
- **A verdict can change while an alert is on screen.** An `ai-ignore` that
  arrives during an alert removes it. That is the level-triggered model applied
  to a new input, and it is the D-017 cost ("an AI verdict can be wrong in new
  ways"). The one-click override is the remedy.
- The owner sees rule verdicts first, then AI verdicts a few seconds later,
  for newly seen meetings. Stored answers make this a first-sight effect only.

## Revisit when

- The engine must see more than one meeting at a time (a batch request per
  snapshot). The protocol would gain a batch message, but the process boundary
  stays.
- `ai-verdicts` grows past about 64 KiB (the same trigger as ADR-0003).
- The review process rejects a second spawned GJS helper.
