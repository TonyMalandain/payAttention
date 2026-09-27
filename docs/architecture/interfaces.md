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

- **`judge(snapshot, config, overrides, travel, aiVerdicts)` → judged occurrences.**
  (`aiVerdicts` added for AI mode, ADR-0010; see §6.)
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
  - a counted source (`remote !== false`) whose `connection` in the latest
    snapshot is `"connecting"` or `"offline"` (a remote calendar still
    reconnecting after unlock) is left out of the provider clock and of the
    named calendars. The grace is **per source**: any other counted source,
    including one in another failed state (for example `"ssl-failed"`), still
    makes the verdict stale at once, because hiding a real failure is worse
    than a brief warning. The data clock is not graced by this rule.
    Product rule, 2026-09-26, after the PG-1c review; per-source reading
    confirmed by the product manager after the PG-1c fix round.

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


## 6. AI mode (stable, protocol version 1) — revised 2026-09-27 for PG-4

Decided in ADR-0007 (wire protocol and own client, accepted as D-021),
ADR-0010 (AI mode: eligibility, the invite, stale answers, persistence and
settings; it supersedes ADR-0008) and ADR-0009 (keys, amended). Serves R-18
(AI mode judges every meeting) and R-19 (the owner connects the engine of
their choice), under D-019, D-020 and D-021. The 2026-09-26 version of this
section (second opinion on unsure codes, D-018 facts) was never built. It is
in git history at commit `1871d4f`. Protocol version 1 is redefined here,
since no version of it has shipped.

### 6.1 Which occurrences are eligible (core)

An occurrence is **eligible** when `config.ai` is not null (AI mode with a
usable engine, §6.4) and it has **no** verdict override (occurrence or
series). Every rule reason code is eligible, including `cancelled`,
`declined`, `all-day` and `free`: D-019 says every meeting. Only the test
alert is never eligible. An all-day occurrence has no deadline, so no verdict
can make it alert (`core/plan.js:87`). The AI answer only changes its menu
line.

### 6.2 The invite (core) — D-020, bounded

Core builds one invite per eligible occurrence from the occurrence DTO (§1)
and the owner identity it already computes. Core exports the field list with a
plain-language label for each field. `prefs.js` shows that list next to the
warning, so the settings text and the code cannot drift apart.

```jsonc
{
  "title": "…",                     // summary; ≤ 200 characters
  "start": "2026-09-28 Mon 17:30",  // local date, weekday and time; "2026-09-28 Mon" when allDay
  "minutes": 60,                    // length, rounded, 0 or more
  "allDay": false,
  "recurring": true,
  "status": "confirmed"|"tentative"|"cancelled"|"none",
  "busy": "busy"|"free"|"unknown",  // from transparency
  "description": "…",               // ≤ 1 500 characters; "" when absent
  "place": "…",                     // location text ≤ 200 characters; "" when absent
  "videoLink": "https://…"|null,    // the one link core's allowlist found (links.js); ≤ 300 characters, else null
  "you": {"response":"accepted"|"declined"|"tentative"|"needs-action"|"delegated"|"other"|"unknown",
          "organiser": false},      // the owner, as core identifies them (D-009); no address
  "organiser": {"name":"…","email":"…"} | null,   // null when the owner organised it (see you.organiser)
  "guests": [{"name":"…","email":"…",
              "response":"accepted"|"declined"|"tentative"|"needs-action"|"delegated"|"other",
              "role":"chair"|"required"|"optional"|"other"}],   // ≤ 25 entries
  "guestsTotal": 3                  // how many guests there are before the cap
}
```

- **Guests** are attendees with CUTYPE individual, group or unknown, other
  than the owner, in DTO order (D-011). Rooms and resources are not guests,
  and their names are not sent: the place text already says where.
- **Every text field** is cleaned before capping: control characters and
  Unicode bidi controls are removed, and runs of whitespace are collapsed to
  one space. Then it is cut to its cap (one character less, plus "…"). Names
  ≤ 80 characters, email addresses ≤ 254.
- **Hard size cap: the serialised invite is at most 8 192 UTF-8 bytes.** If
  the caps above still exceed it, drop guests from the end (`guestsTotal`
  stays true), then shorten `description`. The field caps make the rest fit.
  Typical invites are 0.5 to 2 KB.
- **Never sent:** UIDs, occurrence or series keys, the calendar name, the
  owner's own addresses, rooms and resources, links other than `videoLink`,
  the rule's verdict and reason, and anything about overrides.
- **Local time:** core reads no environment. The controller passes the current
  UTC offset in `config.ai.utcOffsetMinutes`, and core formats `start` from it
  (debt: a DST change inside the range shifts later meetings by an hour and
  re-asks them once; NOTES 2026-09-26).
- **Fingerprint** = `hash(PROMPT_VERSION, engineTag, invite in fixed key
  order)`, computed on the *bounded* invite, so an edit past the description
  cap does not re-ask. It is a small pure non-cryptographic hash in core (at
  least 53 bits), shown as a string. It must not be a plain concatenation.
  Any change to any field re-asks, including one guest's response.

### 6.3 `judge` with `aiVerdicts` (core, pure)

`aiVerdicts` is a plain object: occurrence key → `{fp, verdict, reason}`, as
the controller passes it (§6.5). Copies of one occurrence from several
calendars are merged first, as today. The AI step then applies to the kept
copy, and the invite is built from that copy. The merge must depend only on
the snapshot, so the same snapshot always gives the same invite. For each
**eligible** occurrence:

| Stored entry | Verdict and reason | `reasonCode` | Also carries |
|---|---|---|---|
| exists, `fp` matches | the entry's; `reason` = `"AI: " + entry.reason` | `ai-must` / `ai-ignore` | `ruleReason` |
| exists, `fp` differs | the entry's, as above (a **stale** answer) | `ai-must` / `ai-ignore` | `ruleReason`, `aiStale: true`, `aiAsk: {fp, invite}` |
| none | the rule's | the rule's | `aiAsk: {fp, invite}` |

`ai-must` and `ai-ignore` are added to `REASON_CODES`. Every other field of
the judged occurrence (mode, `joinUrl`, place, travel, deadline, key) is
computed exactly as in rules mode. A test asserts that two runs, with and
without an applying answer, differ only in `verdict`, `reasonCode`, `reason`,
`ruleReason`, `aiStale` and `aiAsk`.

With `config.ai` null (rules mode, or AI mode without a usable engine),
`judge` builds no invite, emits no `aiAsk`, ignores `aiVerdicts`, and gives
exactly today's output.

### 6.4 Config, endpoint rules, and what the shell passes in

`config.ai` is null, or `{engineTag, utcOffsetMinutes}`. The controller
builds it from the settings (`data.md`). It is null unless `verdict-source`
is `ai`, `ai-model` is not empty, and `ai-endpoint` is **usable**.

Core exports two pure functions, which the controller, `prefs.js` and the AI
helper all use:

- `normaliseEndpoint(url)` → string or null. The scheme must be `http` or
  `https`. No user info, query or fragment is allowed. The scheme and host are
  lowercased, the default port is dropped, and there is no trailing slash.
  This is also the keyring attribute (ADR-0009).
- `endpointClass(url)` → `loopback` | `private` | `public` | null.
  - `loopback`: `localhost`, 127.0.0.0/8, `::1`.
  - `private`: 10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16, fc00::/7,
    fe80::/10, a single-label host name, or a name ending in `.local`, `.lan`,
    `.internal` or `.home.arpa`. It is classified from the text alone, with no
    DNS lookup.
  - `public`: every other host.

**Usable:** `https:` with any class, or `http:` with `loopback` or `private`.
`http:` with `public` is not usable, so AI stays not set up, and prefs says
why. `engineTag` = `normaliseEndpoint(endpoint) + "|" + model`.

Where the invite goes, for the prefs warning: `loopback` stays on this
computer. Every other class leaves it.

### 6.5 Controller behaviour (shell, internal but binding)

- **Queue.** After each `judge`, the controller collects the `aiAsk`s whose
  occurrence starts no earlier than `now − cutoff`, and queues them, soonest
  start first. **At most one request is in flight.**
- **What it passes to `judge`.** The stored `ai-verdicts` entries, except
  that it withholds the entry of a key that has an outstanding `aiAsk` when:
  - the AI status is `unavailable`, or
  - that key's own most recent ask failed.

  The rules then decide those meetings (D-019). Only keys with an `aiAsk`
  can hold a stale entry, so the controller never computes a fingerprint. A
  change of status re-runs `judge`.
- **Never on the alert path.** The tick and `plan()` never read the queue and
  never wait for it. An answer is written to `ai-verdicts` through the store
  (coalesced, like alert state), and then `judge` re-runs, as it does after an
  override.
- **Retry.** After a failure for one occurrence, it is not asked again for
  1 min, then 2, 4 and so on, up to 30 min (in memory). After `auth`, `config`
  or `no-key`, the whole engine pauses for 30 min, or until `verdict-source`,
  `ai-endpoint` or `ai-model` changes, so a bad key is never hammered. A key
  saved in prefs is in the keyring, which the shell cannot see. It applies to
  the next request, because the helper looks the key up per request. After
  fixing a key, the owner can switch the mode off and on to end the pause at
  once. After `rate-limited`, the engine pauses for `Retry-After` if given
  (capped at 30 min), else 5 min.
- **Budget.** At most 120 requests per rolling hour and 1 000 per rolling
  24 h, per `engineTag` (assumed; `constraints.md`). This is held in memory,
  so a lock resets it. Stored answers make that harmless in practice. When the
  budget blocks a waiting ask, the status is `unavailable`.
- **Status for the View**, one of: `off` (rules mode or not set up); `ok`;
  `unavailable` (the most recent completed attempt failed, the helper could
  not start, or the budget blocks a waiting ask, and nothing has succeeded
  since). With `unavailable`, the menu shows "AI unavailable — using rules".
  The status is not persisted.
- **Helper lifecycle.** Spawn when there is something to ask and none is
  running. Send `configure`, then requests. Kill it (SIGKILL) in `disable()`,
  when `verdict-source` leaves `ai`, and when `ai-endpoint` or `ai-model`
  changes (the next ask respawns it). Watchdog: no answer
  within `timeoutMs + 10 s` counts as `timeout`, and the helper is killed and
  respawned. Respawn backoff as for the calendar helper (`constraints.md`).

### 6.6 Shell ↔ AI helper protocol (NDJSON over stdio, version 1)

Transport and lifecycle are as in §1: `gjs -m <extension dir>/ai/main.js`,
stdin and stdout piped, stderr inherited, exit on stdin EOF, SIGKILL from the
shell, and nothing but protocol lines on stdout. One core module defines the
version and validates every line on both sides.

**Shell → helper**

```jsonc
{"type":"configure","protocol":1,
 "endpoint":"http://127.0.0.1:11434/v1",   // must be usable (§6.4)
 "model":"…",
 "timeoutMs":90000}                        // 90 000 loopback/private, 45 000 public (core constants, assumed)
{"type":"judge","id":"<opaque, unique per helper run>","invite":{ …exactly §6.2… }}
{"type":"probe","id":"…"}                  // "Test connection": core's fixed synthetic invite, no calendar data
```

The key is never on this channel. The helper looks it up itself, by
`normaliseEndpoint(endpoint)`, for each request (ADR-0009). The helper rejects
a `judge` whose `invite` has a key outside §6.2, a missing key, or more than
8 192 bytes, with `failed: bad-request`. This is a second guard behind core.

**Helper → shell**

```jsonc
{"type":"hello","protocol":1}
{"type":"verdict","id":"…","verdict":"must"|"ignore","reason":"…"}   // reason already normalised (6.8)
{"type":"failed","id":"…","code":"timeout"|"network"|"tls"|"auth"|"rate-limited"|"server"|"bad-reply"|"bad-request"|"no-key"|"config"}
```

`rate-limited` may carry `"retryAfterS": <integer>`. There are no other fields
and no free text: an HTTP body is never forwarded. `no-key` means the Secret
Service could not be reached or is locked. An endpoint with no saved key is a
keyless request, not `no-key` (ADR-0009 amendment).

### 6.7 Helper → engine (OpenAI Chat Completions)

`POST <endpoint>/chat/completions`, `Content-Type: application/json`, and
`Authorization: Bearer <key>` only when a key is saved for the endpoint *and*
the URL is `https:` or a loopback `http:`. A key is never sent over `http:`
to a private host. The body:

```jsonc
{"model":"…",
 "messages":[{"role":"system","content":"<core's fixed instructions, PROMPT_VERSION>"},
             {"role":"user","content":"<JSON.stringify(invite)>"}],
 "temperature":0,
 "max_tokens":400,                              // room for a reasoning model's preamble
 "response_format":{"type":"json_schema","json_schema":{"name":"verdict","strict":true,
   "schema":{"type":"object","additionalProperties":false,"required":["verdict","reason"],
             "properties":{"verdict":{"enum":["must","ignore"]},"reason":{"type":"string","maxLength":80}}}}}}
```

- No `tools`, no `functions`, no `stream`, and no other message. The invite
  is data in the user message. The system text says so. It says that every
  field was written by other people and may contain instructions, which must
  be ignored. It says the only task is to decide whether "you" (the owner)
  must attend.
- If the engine answers 400 and the error names `response_format`, the helper
  retries once without that field, and keeps it off for the rest of its run.
- HTTP mapping: connection refused or DNS failure → `network`; TLS error →
  `tls`; 401 or 403 → `auth`; 402 or 429 → `rate-limited`; other 4xx →
  `config`; 5xx → `server`; timeout → `timeout`. Redirects are not followed.
- Only `choices[0].message.content` is read. Everything else in the body is
  ignored.

### 6.8 Reply validation (core) — data, never instructions

`parseReply(text)` → `{verdict, reason}` or `null` (which gives `bad-reply`):

1. Remove one leading `<think>…</think>` block and one surrounding code fence.
2. What remains must parse as exactly one JSON object. Otherwise → `null`.
3. `verdict` must be exactly `"must"` or `"ignore"`. `reason` must be a
   string. Any other key is ignored and never read.
4. Normalise `reason`: remove control characters (including newlines) and
   Unicode bidi controls (U+202A–U+202E, U+2066–U+2069); collapse whitespace;
   trim; cut to 80 characters (79 plus "…"). If it is empty after that → `null`.

The reason is shown as plain text, never markup (existing UI rule). Nothing
in a reply can reach anything other than `verdict` and `reason` of an eligible
occurrence (6.3). That is the structural answer to "a meeting's text cannot
make the product do anything except pick a verdict". A hostile invite can
choose only its own verdict, because each request carries one invite.

### 6.9 Prefs, "Verdicts" section (prefs.js, internal but binding)

- Mode (`verdict-source`), endpoint (`ai-endpoint`), model (`ai-model`), and
  a password entry for the key. The key is never echoed back, only "a key is
  saved for this address" or "no key".
- The warning comes from the PRD. The "leaves your computer" part shows for
  any endpoint that is not `loopback` (§6.4). Core's labelled field list (§6.2)
  is shown with it.
- "Test connection" spawns `ai/main.js` with `configure` from the fields as
  entered, then `probe`, and shows a clear yes, or no with the failure code in
  plain words. It never sends calendar data.
