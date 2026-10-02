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
- **Which card has its travel choices open** (the heads-up hold, PG-11). Held by
  the controller in memory only. After a shell restart, lock/unlock or re-enable
  the card comes back with its choices closed, and a heads-up whose display time
  is spent does not come back. Not alert state: nothing about it is worth
  restoring, and storing it would let a hold outlive its card.

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
| `default-travel-minutes` | `i` | 30 | 0–240 | Travel time for an in-person meeting with no stored value, with or without a place (D-006, D-039) |
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
disagree on the stored format. The one repeat is `scripts/uninstall.sh`
(`--purge`), which cannot import core; the uninstall check fails if the two
drift (`boundaries.md`, known duplicates). An endpoint with no key is a keyless
engine. Switching endpoints and back finds the old key again, and a key is
never sent to an address it was not saved for.

These keys replace the `ai-enabled`, `ai-location`, `ai-local-*` and
`ai-cloud-*` keys designed on 2026-09-26. Those keys never shipped, so there is
nothing to migrate.

### Removed keys

A removed key leaves the schema; any value an install already stored for it
stays in dconf under our path, unread. GSettings never exposes a key that is
not in the compiled schema, and no code of ours names it, so the value cannot
change behaviour. It is erased with everything else by
`npm run uninstall:local -- --purge` (`dconf reset -f` on the path). We do not
write code to delete it: that code would have to know the key forever.
**A removed name is never reused** for a different meaning, or a value stored
by the old version would come back to life.

| Key | Type | Lived | Why it went |
|---|---|---|---|
| `show-test-alert` | `b` | PG-12 to PG-13, 2026-10-01 (owner's machine only) | Test alert is a developer tool, not a setting (D-037). Whether the menu offers it is now decided by the build, not by stored data (ADR-0013). An install that had it set to `true` shows no Test alert after the update, because nothing reads it |

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
| `travel-times` | `a{si}` | place key → minutes. The travel time of every in-person meeting that has a place (D-039) |
| `meeting-travel-times` | `a{si}` | series key (`series:<uid>`) → minutes. The travel time of an in-person meeting with **no** place (D-039, PG-14, ADR-0014). The key is the series key even for a meeting that does not repeat: its UID names that one meeting, so the value survives the meeting being moved |

**Which entry a meeting uses (ADR-0014).** Core (`judge`) names exactly one
*travel target* per in-person meeting, and reads and the owner's pick writes
that one entry and no other:

- the meeting has a place → `travel-times[<place key>]`;
- it has no place → `meeting-travel-times[series:<uid>]`.

There is no fallback from one to the other: a meeting with a place never reads
`meeting-travel-times`, even if an entry exists for its series (left from a
time it had no place), and a missing or invalid value means the default
travel time. So the value the menu and the card show is always the value a
pick overwrites. Values outside 1–1440 are ignored by core, as before.

"Clear travel times" in prefs resets **both** keys: to the owner they are one
thing, travel times.

Both live under our dconf path, so a plain uninstall keeps them and
`npm run uninstall:local -- --purge` erases them with everything else
(`dconf reset -f`); `scripts/uninstall.sh` names no key and needs no change.
The uninstall check seeds `meeting-travel-times` next to `travel-times`, so a
future move of either out of the path cannot pass unseen.

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
- **Place key:** the place text, trimmed, whitespace runs collapsed to one space,
  lowercased (PRD §4). The place text is the location with links removed, and
  empty when what is left is a no-place word ("Zoom", "online", "TBD", …). It
  is computed once, in `core/attendance.js`, and the same value decides both
  the mode (a place means in person, D-038) and which travel entry is used
  (D-039). Place keys and series keys live in different settings keys, so a
  location that happens to read `series:…` cannot collide with a series.

Lookup order in `judge`: occurrence override, then series override, then the rules
(PRD §1 step 1). The same order applies to mode overrides. Travel times have no
occurrence scope: one entry, chosen as above.

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
  asked again, unless the engine is down or that meeting's own last ask
  failed (`interfaces.md` §6.3 and §6.5). The new answer overwrites the entry.
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
- `series:` overrides, `travel-times` and `meeting-travel-times` are kept until
  the owner clears them. They are small (one entry per series, place or
  placeless meeting the owner ever touched). `meeting-travel-times` is not
  pruned even for a one-off meeting long past, because its key holds no time;
  an entry is about 60 bytes and is written only when the owner picks a
  travel time for an in-person meeting with no place (a few a month,
  assumed), so it stays far below the ADR-0003 64 KiB trigger for years.
  If it ever nears it, that is ADR-0014's revisit trigger.

## Reading `alert-state` if it is corrupt

If the JSON does not parse or `v` is unknown, the store starts from empty and logs
once. Consequence: acknowledged meetings may alert again. That is the safe failure.
