# Interfaces

The contracts between subsystems. Shapes, not implementations: names of fields and
the promises attached to them. Stability: **stable** means changing it needs an ADR
or a protocol version bump; **internal** means the senior engineer may reshape it
as long as every caller changes in the same change.

## 1. Helper ↔ calendar feed: the snapshot protocol (stable, version 1)

**Transport.** The shell spawns the helper with `Gio.Subprocess`
(`gjs -m <extension dir>/helper/main.js`), with stdin and stdout piped and
stderr inherited, so helper diagnostics land in the gnome-shell journal. Messages
are UTF-8 JSON, one object per line (NDJSON). No other channel is used.

**Lifecycle promises.**
- The helper exits on its own when stdin reaches EOF. If the shell dies, the helper
  dies too; there are no orphan helpers.
- The shell sends SIGKILL (`Gio.Subprocess.force_exit()`) in `disable()` and does
  not wait. The helper holds no state and writes nothing, so it needs no clean
  shutdown; the stdin-EOF exit covers the case where the shell itself dies.
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
              "ok":true,"error":null|"<short code>",
              "remote":true|false|null,              // added 2026-09-26, see addendum (D-013)
              "connection":"connected"|…|null}],    // added 2026-09-26, see addendum (D-013)
 "events": [ Occurrence DTO, … ]}                  // complete, not a diff

{"type":"status","level":"warn"|"error","code":"<short code>"}   // no calendar content, ever
```

**Compatibility rule for v1.** The validator accepts unknown extra properties,
so a new *optional* field is additive and keeps `protocol: 1`. Removing,
renaming, retyping, or making a field required bumps the version.

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
  `config` holds the word lists, owner addresses (each source's `ownerEmail`
  plus `extra-owner-addresses`) and domains, large-meeting size, and default
  travel. The conferencing host allowlist is a constant in core, not config.
  Guests are the people other than the owner: attendees with CUTYPE individual,
  group or unknown, plus the organiser; rooms and resources are not guests (D-011). Each result carries: occurrence key, series
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
  Actions: `ack`, `skip`, `snooze`, `headsUpShown`, `prune`. The Plan's primary
  card says when the heads-up counts as shown (`recordHeadsUpShown`: step 1
  visible and the owner active), and the controller dispatches `headsUpShown`
  on that tick, so it is never recorded while the owner is idle. The snooze
  action is built by core (`actionFor(card, 'snooze')`) and carries the end time
  `plan` computed; the stored `alert-state` shape is unchanged. Verdict overrides,
  mode switches, and travel changes are not alert state; the controller writes
  them to the store and re-runs `judge`.

## 3. Controller ↔ UI (internal)

- The controller builds a display model (`View`) with the pure `shell/view.js`
  from the Plan, the judged occurrences, and data health, and calls
  `ui.render(view)`. Everything about *what* to show is resolved there (travel only
  at steps 1–2, Join only with a link, never "no meetings" while stale), so `ui/`
  only draws. `render` is idempotent: the same View twice changes nothing on screen.
- The UI reports every user action through one `dispatch(action)`:
  `join`, `ack`, `snooze`, `skip`, `setVerdict`, `setMode`, `setTravel`,
  `runTestAlert`. The UI never reports `headsUpShown` (see §2).
- `join` is handled by the controller: it opens the core-approved `joinUrl` and
  then dispatches `ack`.
- Text formatting shared by `shell/view.js` and `prefs.js` is pure code in
  `core/display.js`.
- The controller receives its GNOME-facing parts (store, feed, environment, UI,
  ticker) as injected factories, so `controller.js`, `view.js` and the small
  pure shell helpers have no `gi://` imports and are unit-tested under Node.

## 4. Extension object (stable, used by the smoke test)

The `Extension` subclass exposes one public method, `runTestAlert()`, which the
menu item also calls. The headless smoke script reaches it through
`Main.extensionManager.lookup(uuid)` and drives the ladder with it. There is one
entry point with two real callers; no test-only branch exists in the product code.

## 5. Settings (stable)

The GSettings schema in `data.md` is a public contract: `prefs.js`, the store, and
the user's `dconf` database all depend on it. Keys may be added. Renaming or
retyping a key needs an ADR, because stored values would be lost.

## Addendum 2026-09-26 — provider sync freshness (D-013)

**Why.** D-013 extends D-010: the "calendar not updating" warning must also
show when the desktop has not synced with the calendar provider for 15 minutes,
even while cached meetings keep arriving and alerting. Protocol v1 carried no
sync information. Measured on the author's machine: `ECal.Client.refresh`
completes in 0–1 ms with `true` on all 7 CalDAV sources, because it only
*schedules* a sync. So "the refresh call succeeded" says nothing about the
provider, and the planned `sync-failed` status cannot drive the warning. What EDS
does expose to a read-only client is the backend's link state: `EClient:online`
(false when EDS believes the network is down) and `ESource:connection-status`
(`CONNECTED` on all 7 CalDAV sources when online). A remote source that is online
and connected is the closest observable proxy for "can sync with the provider".

**Protocol change (additive; stays `protocol: 1`).** Two optional fields on each
`sources[]` entry. The helper transcribes; the shell judges.

| Field | Values | Helper fills it from |
|---|---|---|
| `remote` | `true` / `false` / `null` | `client.check_refresh_supported()`. `null` when the source failed (`ok:false`), so remoteness is unknown. |
| `connection` | `"connected"`, `"connecting"`, `"disconnected"`, `"awaiting-credentials"`, `"ssl-failed"`, `"offline"`, `"unknown"`, or `null` | `"offline"` when `client.is_online()` is false; otherwise `source.connection_status` mapped by name; an enum value not in the list gives `"unknown"`. `null` when `remote` is not `true`. |

Core's validator checks both fields *when present* and exports the connection
values as one constant both sides use. An absent field is read as `null`.

**Helper promise.** The helper also re-snapshots (through the existing 2 s
debounce) when any listed remote source's `connection-status` or its client's
`online` changes, so loss and recovery reach the shell within ≤ 3 s, not only at
the 5-minute re-snapshot. The `sync-failed` status keeps its meaning ("the
refresh request could not be made") and is diagnostic only: it is logged, never
used for health.

**Shell rule (the one definition of "stale", in `shell/health.js`).**

- *Provider clock, per source.* On each accepted snapshot, received at time `t`,
  every source with `ok && remote === true && connection === "connected"` is
  recorded as in sync at `t` (the feed keeps `uid → t` in memory across helper
  restarts). The provider clock is the **oldest** in-sync time over the current
  snapshot's sources with `remote !== false`; a source never seen in sync uses
  the seed below. No such sources → no provider clock.
- *Data clock* (D-010, as PG-1c planned): the time of the last accepted snapshot.
  A snapshot is accepted when it lists no sources or at least one `ok` source.
- *Seeds.* On `enable()` both clocks start from the values persisted on the last
  `disable()` (`health-data-at`, `health-provider-at`, `data.md`), or from
  `enable()` time when none is stored.
- *Verdict.* **Stale** when either clock is 15 min or more old, except during the
  first 60 s after `enable()` (so an unlock does not flash the warning):
  - no stale at all while no snapshot has been accepted yet;
  - no stale from the provider clock while any source it counts
    (`remote !== false`) reports `connection` `"connecting"` or `"offline"` in
    the latest snapshot (a remote calendar still reconnecting after unlock).
    Product rule, 2026-09-26, after the PG-1c review.

  After 60 s the rule above applies unchanged. `since` = the older expired clock.
  **Waiting** when not stale and no snapshot has been accepted yet. Otherwise **ok**.
- Stale changes only the indicator mark and the menu status line. Alerts keep
  running from the cached snapshot (D-013); `plan` passes `dataHealthy` through
  and does not gate any step on it.

**Residual gap (accepted).** A provider that answers with errors while the
connection stays `CONNECTED` (for example a server-side failure) is not
detected. EDS exposes no last-successful-sync time to clients. That going
offline turns `online` false or the status away from `CONNECTED` is **assumed**
from EDS's design, not measured by pulling the network; the real-session
checklist (`testing-and-build.md`, Layer 4) covers it.


**Who changes what.** The plans stay the senior engineer's; these are the
constraints they must now meet.

- **PG-1b (helper), plus core's validator:**
  1. `core/protocol.js`: validate `sources[].remote` (boolean or null) and
     `sources[].connection` (one exported value list, or null) when present;
     absent stays valid. `PROTOCOL_VERSION` stays 1. Test first.
  2. Fill both fields per source in the calendar reader, as in the table above.
  3. Re-snapshot through the existing debounce on `notify::connection-status` of
     each listed remote `ESource` and `notify::online` of its client; disconnect
     those handlers with the rest of the reader's signals.
  4. Add `EClient.is_online`, reading `ESource.connection_status`, and those two
     notify signals to the plan's list of allowed EDS calls.
  5. `sync-failed`: diagnostic only; its comment must not claim a provider failure.
  6. Helper test: the two built-in local sources report `remote:false`,
     `connection:null`; a pure test covers the status-to-string mapping,
     including an unknown value.
- **PG-1c (shell):**
  1. `HELPER_ENTRY = 'main.js'`.
  2. Feed: keep `uid → last in-sync time` across helper restarts and expose the
     provider clock with the rule above; seeds come from the controller.
  3. `health.js`: the verdict above (two clocks, 60 s grace, `since` = older
     expired clock) replaces the one-clock rule. Tests: provider stale while
     snapshots are fresh gives stale; a source with `remote:false` never counts;
     `ok:false` counts; seeds from a previous run make it stale after the grace.
  4. Schema and store: internal keys `health-data-at`, `health-provider-at`
     (`x`, default 0, `data.md`); written once in `disable()` with the flushed
     alert state; read at `enable()` and passed to the feed as seeds.
  5. Controller test: provider stale while snapshots are fresh gives the warning
     mark and the stale status line, and the day's meetings are still listed and
     still alert.
  6. Menu status: when `since` falls before today's local midnight, show the
     weekday with the time, because persisted clocks make earlier days common.
  7. Lint: forbid the `system` built-in in `shell/`, `ui/`, `extension.js`,
     `prefs.js` (`boundaries.md`).
