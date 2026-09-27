# Data

What is stored, where, in what format, and who writes it. Decided in ADR-0003:
**everything durable lives in GSettings** under one schema. There are no files of
our own on disk. Calendar content is never stored by us, with one bounded
exception from PG-4: the AI's one-line reason (see `ai-verdicts` below).
**One exception to "everything in GSettings":** AI engine keys live in the GNOME
keyring (ADR-0009), never in GSettings.

## What is not stored

- **Calendar events.** Read fresh from evolution-data-server on every snapshot and
  held in memory only. EDS already caches them; a second cache would be a second
  source of truth (and a second copy of sensitive data).
- **Judged occurrences and Plans.** Recomputed from inputs; never persisted.
- **Test-alert state.** In memory only.

## Schema

- **Schema id:** `org.gnome.shell.extensions.payattention`
- **Path:** `/org/gnome/shell/extensions/payattention/`
- **File:** `extension/schemas/org.gnome.shell.extensions.payattention.gschema.xml`

### Settings the owner edits (prefs.js)

| Key | Type | Default | Range | Meaning (PRD section) |
|---|---|---|---|---|
| `online-headsup-minutes` | `i` | 30 | 1–240 | Heads-up, minutes before start (§3, D-006) |
| `online-nudge-minutes` | `i` | 10 | 0–120 | Nudge, minutes before deadline |
| `online-insist-minutes` | `i` | 3 | 0–60 | Insist, minutes before deadline |
| `online-takeover-minutes` | `i` | 1 | 0–30 | Takeover, minutes before deadline |
| `inperson-headsup-minutes` | `i` | 10 | 1–240 | Heads-up, minutes before leave-by (D-006, D-008) |
| `inperson-nudge-minutes` | `i` | 5 | 0–120 | Nudge, minutes before leave-by (D-008) |
| `inperson-insist-minutes` | `i` | 2 | 0–60 | Insist, minutes before leave-by (D-008) |
| `inperson-takeover-minutes` | `i` | 0 | 0–30 | Takeover, at leave-by (D-008) |
| `default-travel-minutes` | `i` | 30 | 0–240 | Travel time for a place with no stored value (D-006) |
| `headsup-display-seconds` | `i` | 15 | 5–120 | How long the heads-up stays |
| `snooze-minutes` | `i` | 2 | 1–30 | Snooze at steps 1–3 |
| `takeover-snooze-minutes` | `i` | 1 | 1–10 | Snooze at step 4 |
| `cutoff-minutes` | `i` | 10 | 0–60 | Stop alerting this long after the start |
| `large-meeting-size` | `i` | 15 | 2–500 | Above this many guests, a meeting is "large" |
| `extra-important-words` | `as` | `[]` | — | Added to the built-in important words |
| `extra-ignore-words` | `as` | `[]` | — | Added to the built-in ignore words |
| `owner-domains` | `as` | `[]` | — | The owner's email domains. Empty means "detect from the calendars' own addresses" |
| `extra-owner-addresses` | `as` | `[]` | — | Owner addresses beyond each calendar's own address, e.g. aliases (§6, D-009). Lowercased by core |
| `sound-enabled` | `b` | `true` | — | Play a sound at insist and takeover |
| `ai-enabled` | `b` | `false` | — | AI second opinion on unsure verdicts (R-18, D-017). Off by default |
| `ai-location` | `s` | `'local'` | choices `local`, `cloud` | Where the engine runs (R-19). Picks which URL and model below are active, and the privacy wording in prefs |
| `ai-local-url` | `s` | `'http://127.0.0.1:11434/v1'` | — | Base URL of an engine on this machine or network (the default is Ollama's) |
| `ai-local-model` | `s` | `''` | — | Model name for the local engine. Empty means AI is not set up |
| `ai-cloud-url` | `s` | `'https://api.openai.com/v1'` | — | Base URL of a cloud engine. Must be `https:` or AI stays off |
| `ai-cloud-model` | `s` | `''` | — | Model name for the cloud engine. Empty means AI is not set up |

The local and cloud URL and model are kept separately, so the owner can switch
`ai-location` back and forth (R-19) without typing either again. The API key
for an address is in the keyring, keyed by that address (ADR-0009).

Defaults live once, in core (`DEFAULT_SETTINGS`); the schema repeats them and a
unit test keeps the two equal. Core also clamps offsets, so steps can never come
out of order whatever the owner sets.

Built-in word lists and the conferencing host allowlist are code in `core/`, not
settings, so a release can fix them.

Every integer key gets a `<range>` in the schema, so a bad value cannot reach core.

### Values set from the menu and alerts

| Key | Type | Meaning |
|---|---|---|
| `verdict-overrides` | `a{ss}` | key → `"must"` or `"ignore"` |
| `mode-overrides` | `a{ss}` | key → `"online"` or `"in-person"` |
| `travel-times` | `a{si}` | place key → minutes |

### Internal

| Key | Type | Meaning |
|---|---|---|
| `alert-state` | `s` | JSON, see below. Not shown in prefs. |
| `health-data-at` | `x` | Epoch ms of the last fresh snapshot, written on `disable()`. `0` = unknown. Seeds the D-010 clock at the next `enable()`. |
| `health-provider-at` | `x` | Epoch ms of the oldest per-calendar provider-sync time, written on `disable()`. `0` = unknown. Seeds the D-013 clock. |

| `ai-verdicts` | `s` | JSON of AI answers, see below (ADR-0008). Not shown in prefs. |

The two `health-*` keys exist so that locking the screen (which runs `disable()`,
ADR-0005) does not reset the stale-calendar clocks: without them an owner working
offline would get 15 minutes of false "all fine" after every unlock. They are
written once per `disable()`, never per tick. See `interfaces.md`, addendum
2026-09-26.

## Keys — the stored format (one-way door, ADR-0003)

- **Series key:** `series:<uid>`. The iCalendar UID is the same for every instance of
  a series and in every calendar that holds a copy of it.
- **Occurrence key:** `occ:<uid>|<t>`, where `<t>` is the recurrence-id in epoch ms
  for an instance of a series, and the start in epoch ms for a single meeting. A
  recurrence-id stays the same when one instance is moved, so overrides and
  acknowledgements survive that. When a single (non-recurring) meeting is moved,
  its key changes and it is judged and alerted afresh. That is the safe direction:
  it warns rather than stays silent.
- **Place key:** the location text, trimmed, whitespace runs collapsed to one space,
  lowercased (PRD §4).

Lookup order in `judge`: occurrence override, then series override, then the rules
(PRD §1 step 1). The same order applies to mode overrides.

## Alert state

```jsonc
{"v":1,
 "items": {
   "occ:<uid>|<t>": {
     "start": 1790000000000,        // the start this state was recorded against
     "done": null|"ack"|"skip",
     "doneAt": 1790000000000|null,
     "snoozeUntil": 1790000000000|null,
     "headsUpShownAt": 1790000000000|null
   }}}
```

- An item whose `start` no longer matches the occurrence's current start is ignored
  (the meeting moved; alerting starts again).
- Written through the store, coalesced so a burst of actions is one write.

## AI answers (`ai-verdicts`)

```jsonc
{"v":1,
 "items": {
   "occ:<uid>|<t>": {
     "fp": "…",                 // fingerprint of PROMPT_VERSION + engine + D-018 facts (interfaces.md §6.2); a hash, never the facts
     "verdict": "must"|"ignore",
     "reason": "…",             // normalised, at most 80 characters (interfaces.md §6.8)
     "at": 1790000000000        // when it was answered, epoch ms
   }}}
```

- Keyed by occurrence key (ADR-0003 format), so one answer per occurrence.
  An answer applies only while its `fp` matches the current facts and engine.
  A changed title, time, length, guest count, answer, place or link flag, or a
  different engine or model, makes it not apply. The occurrence is then asked
  again and the entry is overwritten.
- **What it holds that is new:** `reason` is text written by the model from
  the meeting facts, so it may paraphrase the title. Accepted, because it lets
  a lock and unlock (ADR-0005) reuse answers instead of asking again. It is
  bounded to 80 characters per entry, pruned with the `occ:` entries, erased by
  `--purge`, and never logged.
- Corrupt JSON or an unknown `v` → start from empty and log once. The cost is
  that the unsure meetings are asked again.
- Kept when AI is turned off, so turning it back on with the same engine asks
  nothing again. Old entries age out through pruning.

## Pruning

- `alert-state` items, `ai-verdicts` items and `occ:` overrides are removed once
  `<t>` is more than 7 days in the past (assumed retention). The store prunes on `enable()` and daily.
- `series:` overrides and `travel-times` are kept until the owner clears them. They
  are small (one entry per series or place the owner ever touched).

## Reading `alert-state` if it is corrupt

If the JSON does not parse or `v` is unknown, the store starts from empty and logs
once. Consequence: acknowledged meetings may alert again. That is the safe failure.
