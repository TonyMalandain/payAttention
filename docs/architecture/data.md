# Data

What is stored, where, in what format, and who writes it. Decided in ADR-0003:
**everything durable lives in GSettings** under one schema. There are no files of
our own on disk. Calendar content is never stored by us, with one bounded
exception from PG-4: the AI's one-line reason (see `ai-verdicts` below;
ADR-0010).
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
| `verdict-source` | `s` | `'rules'` | choices `rules`, `ai` | The mode: who decides verdicts (R-18, D-019). Rules by default |
| `ai-endpoint` | `s` | `'http://127.0.0.1:11434/v1'` | — | The AI engine's address (R-19, D-021). The default is Ollama on this computer. It must be usable (`interfaces.md` §6.4), or AI stays not set up |
| `ai-model` | `s` | `''` | — | The model name. Empty means AI is not set up, even in AI mode |

One endpoint and one model, as the owner described them (D-021, ADR-0010).
There is no stored "local" or "cloud" choice. Whether the invite leaves the
computer is worked out from the endpoint by core, so it can never disagree
with the address. The API key is not a setting. It is in the keyring, keyed by
the normalised endpoint (ADR-0009). The libsecret schema name and attribute are
defined once, in `core/aiEngine.js` (`ENGINE_KEY_SCHEMA_NAME`,
`ENGINE_KEY_ATTRIBUTE`), so prefs (writer) and the AI helper (reader) cannot
disagree on the stored format. An endpoint with no key is a keyless
engine. Switching endpoints and back finds the old key again, and a key is
never sent to an address it was not saved for.

These keys replace the `ai-enabled`, `ai-location`, `ai-local-*` and
`ai-cloud-*` keys designed on 2026-09-26. Those keys never shipped, so there is
nothing to migrate.

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

| `ai-verdicts` | `s` | JSON of AI answers, see below (ADR-0010). Not shown in prefs. |

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
     "fp": "…",                 // fingerprint of PROMPT_VERSION + engine tag + the bounded invite (interfaces.md §6.2); a hash, never the invite
     "verdict": "must"|"ignore",
     "reason": "…",             // normalised, at most 80 characters (interfaces.md §6.8)
     "at": 1790000000000        // when it was answered, epoch ms
   }}}
```

- Keyed by occurrence key (ADR-0003 format), so one answer per occurrence.
  An answer is **current** while its `fp` matches the current invite and
  engine. Any change to the bounded invite makes it **stale**: title,
  calendar name (D-024), time, length, status, busy/free, description, place,
  video link, organiser, or any guest, including one guest's response. So does a different endpoint or
  model, or a new prompt version. A stale answer still applies while it is
  asked again, unless the AI is unavailable or that ask failed
  (`interfaces.md` §6.3 and §6.5). The new answer overwrites the entry.
- **What it holds that is new:** `reason` is text written by the model from
  the whole invite (D-020), so it may paraphrase the title or name a person
  ("1:1 with Dana, client"). Accepted, because it lets a lock and unlock
  (ADR-0005) reuse answers instead of asking about every meeting again. It is
  bounded to 80 characters per entry, pruned with the `occ:` entries, erased by
  `--purge`, and never logged. Neither the invite nor the fingerprint input is
  stored.
- Size: one entry is at most about 200 bytes. The owner's calendar gives a few
  dozen live entries within the 7-day pruning window. At the designed scale
  (2 000 occurrences in range) it could reach the ADR-0003 64 KiB trigger
  (assumed). That is a revisit trigger in ADR-0010, not a limit enforced here.
- Corrupt JSON or an unknown `v` → start from empty and log once. The cost is
  that every meeting in range is asked again.
- Kept in rules mode, so going back to AI mode with the same engine asks
  nothing again. Old entries age out through pruning. A plain uninstall keeps
  them, and `--purge` erases them (D-016, PRD addendum).

## Pruning

- `alert-state` items, `ai-verdicts` items and `occ:` overrides are removed once
  `<t>` is more than 7 days in the past (assumed retention). The store prunes on `enable()` and daily.
- `series:` overrides and `travel-times` are kept until the owner clears them. They
  are small (one entry per series or place the owner ever touched).

## Reading `alert-state` if it is corrupt

If the JSON does not parse or `v` is unknown, the store starts from empty and logs
once. Consequence: acknowledged meetings may alert again. That is the safe failure.
