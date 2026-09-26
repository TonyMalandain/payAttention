# Data

What is stored, where, in what format, and who writes it. Decided in ADR-0003:
**everything durable lives in GSettings** under one schema. There are no files of
our own on disk, and calendar content is never stored by us at all.

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

| Key | Type | Default | Meaning (PRD section) |
|---|---|---|---|
| `online-headsup-minutes` | `i` | 30 | Heads-up, minutes before start (§3, D-006) |
| `online-nudge-minutes` | `i` | 10 | Nudge, minutes before deadline |
| `online-insist-minutes` | `i` | 3 | Insist, minutes before deadline |
| `online-takeover-minutes` | `i` | 1 | Takeover, minutes before deadline |
| `inperson-headsup-minutes` | `i` | 10 | Heads-up, minutes before leave-by (D-006) |
| `inperson-nudge-minutes` | `i` | 5 | Nudge, minutes before leave-by |
| `inperson-insist-minutes` | `i` | 0 | Insist, minutes before leave-by |
| `inperson-takeover-minutes` | `i` | 1 | Takeover, minutes before leave-by (see ordering finding in `NOTES.md`) |
| `default-travel-minutes` | `i` | 30 | Travel time for a place with no stored value (D-006) |
| `headsup-display-seconds` | `i` | 15 | How long the heads-up stays |
| `snooze-minutes` | `i` | 2 | Snooze at steps 1–3 |
| `takeover-snooze-minutes` | `i` | 1 | Snooze at step 4 |
| `cutoff-minutes` | `i` | 10 | Stop alerting this long after the start |
| `large-meeting-size` | `i` | 15 | Above this many guests, a meeting is "large" |
| `extra-important-words` | `as` | `[]` | Added to the built-in important words |
| `extra-ignore-words` | `as` | `[]` | Added to the built-in ignore words |
| `owner-domains` | `as` | `[]` | The owner's email domains. Empty means "detect from the calendars' own addresses" |
| `sound-enabled` | `b` | `true` | Play a sound at insist and takeover |

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

## Pruning

- `alert-state` items and `occ:` overrides are removed once `<t>` is more than
  7 days in the past (assumed retention). The store prunes on `enable()` and daily.
- `series:` overrides and `travel-times` are kept until the owner clears them. They
  are small (one entry per series or place the owner ever touched).

## Reading `alert-state` if it is corrupt

If the JSON does not parse or `v` is unknown, the store starts from empty and logs
once. Consequence: acknowledged meetings may alert again. That is the safe failure.
