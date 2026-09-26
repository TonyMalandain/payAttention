# Interfaces

The contracts between subsystems. Shapes, not implementations: names of fields and
the promises attached to them. Stability: **stable** means changing it needs an ADR
or a protocol version bump; **internal** means the senior engineer may reshape it
as long as every caller changes in the same change.

## 1. Helper ↔ calendar feed: the snapshot protocol (stable, version 1)

**Transport.** The shell spawns the helper with `Gio.Subprocess`
(`gjs -m <extension dir>/helper/<entry>.js`), with stdin and stdout piped and
stderr inherited, so helper diagnostics land in the gnome-shell journal. Messages
are UTF-8 JSON, one object per line (NDJSON). No other channel is used.

**Lifecycle promises.**
- The helper exits on its own when stdin reaches EOF. If the shell dies, the helper
  dies too; there are no orphan helpers.
- The shell sends SIGTERM (`force_exit()`) in `disable()` and does not wait.
- The helper exits non-zero on a fatal error. The feed restarts it with backoff
  (`constraints.md`).
- The helper never writes anything but protocol lines to stdout.

**Helper → shell.**

```jsonc
{"type":"hello","protocol":1}                      // once, at start

{"type":"snapshot","protocol":1,
 "generatedAt": 1790000000000,                     // epoch ms UTC
 "rangeStart":  1789996400000,                     // occurrences overlapping [rangeStart, rangeEnd)
 "rangeEnd":    1790129600000,
 "sources": [{"uid":"…","name":"…","backend":"caldav",
              "ownerEmail":"me@example.com"|null,  // EDS backend property cal-email-address, lowercased
              "ok":true,"error":null|"<short code>"}],
 "events": [ Occurrence DTO, … ]}                  // complete, not a diff

{"type":"status","level":"warn"|"error","code":"<short code>"}   // no calendar content, ever
```

Every snapshot is **complete** for its range. The feed replaces the previous one
whole. There are no incremental diffs to get wrong.

**Occurrence DTO** (one instance of a meeting; recurring series are already expanded):

```jsonc
{
  "sourceUid": "…",
  "uid": "…",                     // iCalendar UID
  "recurrenceId": 1790000000000,  // RECURRENCE-ID as epoch ms UTC for an instance of a series; null otherwise
  "recurring": true,
  "start": 1790000000000,         // epoch ms UTC; the helper resolves TZIDs
  "end":   1790003600000,
  "allDay": false,                // DTSTART is a DATE value
  "summary": "…",
  "location": "…",                // "" when absent
  "description": "…",             // "" when absent; truncated to 32 768 characters
  "conferenceUris": ["https://…"],// from X-GOOGLE-CONFERENCE, CONFERENCE (RFC 7986) and URL properties
  "status": "confirmed"|"tentative"|"cancelled"|"none",
  "transparency": "opaque"|"transparent"|"unknown",
  "organizer": {"email":"…","name":"…"} | null,
  "attendees": [{"email":"…","name":"…",
                 "partstat":"needs-action"|"accepted"|"declined"|"tentative"|"delegated"|"other",
                 "cutype":"individual"|"group"|"resource"|"room"|"unknown",
                 "role":"chair"|"req-participant"|"opt-participant"|"non-participant"|"other"}]
}
```

Email addresses are lowercased with `mailto:` removed. The DTO holds raw facts
only: no owner detection, no counting, no link detection. Those are judgments and
live in core, where they are tested.

**Shell → helper (stdin).**

```jsonc
{"type":"refresh","reason":"resume"|"manual"}   // re-read now; for remote sources also ask EDS to sync
```

**Validation.** Core exports the protocol version and a validator. The feed drops
any line that fails validation, logs a `status`-style code, and keeps the previous
snapshot. The helper and the feed both import that one module, so the contract is
defined once.

**Diagnostic mode (stable).** Run by hand, the helper also accepts `--once` (print
one snapshot and exit) and `--summary` (print counts only, no content). `--summary`
is what goes into bug reports.

## 2. Core ↔ controller (internal)

Three pure functions. The names are indicative; the shapes are the contract.

- **`judge(snapshot, config, overrides, travel)` → judged occurrences.**
  `config` holds the word lists, owner addresses and domains, large-meeting size,
  default travel, and link allowlist. Each result carries: occurrence key, series
  key, title, start, end, `verdict` (`'must'`|`'ignore'`), `reason` (the one-line
  text from the PRD) and a stable `reasonCode`, `mode` and whether it was
  overridden, `joinUrl` or null, place text and place key, travel minutes and
  whether it is the default, `deadline`. Duplicates of the same occurrence from
  two calendars are merged here, by occurrence key.
- **`plan(now, judged, alertState, timing, env)` → Plan.**
  `env` carries `userActive`. The Plan holds: the primary card (occurrence key,
  step 1–4, whether visible, time to deadline) or none; the "also" list; whether a
  takeover is required; the indicator target (next must-attend deadline within 12 h)
  and a data-health flag passed through from the feed.
- **`reduce(alertState, action, now)` → alertState.**
  Actions: `ack`, `skip`, `snooze`, `headsUpShown`, `prune`. Verdict overrides,
  mode switches, and travel changes are not alert state; the controller writes
  them to the store and re-runs `judge`.

## 3. Controller ↔ UI (internal)

- The controller calls one UI entry with the Plan and the judged occurrences it
  refers to. The UI must be idempotent: the same Plan twice changes nothing on
  screen.
- The UI calls back with actions: `join(key)`, `ack(key)`, `snooze(key)`,
  `skip(key)`, `setVerdict(key, verdict, scope)`, `setMode(key, mode)`,
  `setTravel(placeKey, minutes)`, `headsUpShown(key, at)`, `runTestAlert()`.
- `join` is handled by the controller: it opens the core-approved `joinUrl` and
  then dispatches `ack`.

## 4. Extension object (stable, used by the smoke test)

The `Extension` subclass exposes one public method, `runTestAlert()`, which the
menu item also calls. The headless smoke script reaches it through
`Main.extensionManager.lookup(uuid)` and drives the ladder with it. There is one
entry point with two real callers; no test-only branch exists in the product code.

## 5. Settings (stable)

The GSettings schema in `data.md` is a public contract: `prefs.js`, the store, and
the user's `dconf` database all depend on it. Keys may be added. Renaming or
retyping a key needs an ADR, because stored values would be lost.
