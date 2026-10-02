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

**Environment (2026-09-27, binding on every spawner).** Whoever spawns a helper
(the calendar feed, the shell's AI side, and prefs' "Test connection") removes
`G_MESSAGES_DEBUG` from the child's environment (`Gio.SubprocessLauncher`,
`unsetenv`); the variable list is one constant in core, so the spawners cannot
disagree. Why: with it set, GLib's default log writer puts library DEBUG and
INFO lines on **stdout** whenever stderr is not the journal (a nested or
terminal shell, prefs, tests), and they carry the AI endpoint URL. The helper
cannot fix this itself (measured on gjs 1.88 / GLib 2.88):
`GLib.log_writer_default_set_use_stderr(true)` fails its assertion because gjs
has already started threads, and GIO logs before any helper code runs. Under a
normal session stderr is the journal and GLib writes there, so nothing leaks;
the rule covers every other case. The cost: library debug output from a helper
is only seen by running it by hand. The shell and prefs still log only the code
of a line that fails to parse, never its text.

**Lifecycle promises.**
- The helper exits on its own when stdin reaches EOF. If the shell dies, the helper
  dies too; there are no orphan helpers.
- The shell sends SIGKILL (`Gio.Subprocess.force_exit()`) in `disable()` and does
  not wait. The helper holds no state and writes nothing, so it needs no clean
  shutdown; the stdin-EOF exit covers the case where the shell itself dies.
- The helper exits non-zero on a fatal error. The feed restarts it with backoff
  (`constraints.md`).
- The helper never writes anything but protocol lines to stdout. Library log
  lines are kept off it by the spawner (Environment, above), not by the helper.

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

**Source neutrality (ADR-0011).** The DTO is iCalendar-shaped, so a reader
for another provider (Microsoft Graph, Google Calendar) can produce it. Three
source fields carry EDS-derived names and are defined by meaning: `backend` is
a free diagnostic label of the source kind (core never reads it); `remote`
means the calendar lives at a provider and can be synced; `connection` is the
reader's link to that provider (`awaiting-credentials` = the owner must sign
in again; `ssl-failed` = the secure connection was refused). Which calendars
are listed ("every calendar the clock menu shows", R-2) is the reader's rule.

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
  whether it is the default, the **travel target**, `deadline`. Duplicates of
  the same occurrence from two calendars are merged here, by occurrence key.

  **The mode and the travel target (PG-14, D-038, D-039, ADR-0014).** Both are
  decided in core and nowhere else; `app/` and `ui/` only carry them.
  - *Mode:* the mode override (occurrence, then series) wins. Without one, a
    meeting whose place text is not empty is `'in-person'`, and every other
    meeting is `'online'`. A video link does not decide the mode.
  - *Join (D-040):* `joinUrl` is the allowlisted https link core found, or
    null, **whatever the mode**: online or in person, detected or switched by
    the owner. Mode and Join are independent facts about a meeting; nothing
    in `app/` or `ui/` may gate Join on the mode (`app/view.js` offers Join
    exactly when `joinUrl` is not null, as before).
  - *Place text:* computed once, in `core/attendance.js`, and nowhere else.
    It is the location with links removed, and it is empty when either
    1. what is left, as a whole, is a no-place word (`NOT_A_PLACE_WORDS`:
       "online", "TBD", "phone call", "Zoom", …), or
    2. what is left names a video-call service **anywhere**, as a whole word
       (PRD §2, D-040): "Join Zoom Meeting", "Teams-Besprechung",
       "Microsoft Teams-Besprechung beitreten".

    Rule 2 uses its own list of **service names only** (Zoom, Teams, Google
    Meet, Webex, …), never the generic words of rule 1. A generic word found
    anywhere ("call", "meet", "phone", "remote", "none") would empty real
    places ("Meet at reception", "Remote office, 3rd floor"), and a real
    place read as no place is the late direction: no travel time, alerts at
    the start instead of at leave-by. Matching is whole-word with Unicode
    letter/digit edges, so a hyphen or a following word in another language
    still ends the name ("Teams-Besprechung" matches, "Zoomlion Tower" does
    not); the existing word matcher in `core/words.js` (`compileWords` /
    `findWord`) already does exactly this and is the one to use. The list is
    compiled once per module, not per meeting (`judge` budget,
    `testing-and-build.md`). It is a constant in core, like the conferencing
    host allowlist, and stays separate from it: hosts are what Join may open,
    names are what a location says; they change for different reasons.

    Accepted consequence (PRD §2 wording): a location that names a real
    place **and** a service ("Board room + Zoom") has no place text, so the
    meeting is online and gets no travel time unless the owner switches it.
    The same place text drives the travel target, so the mode and "has a
    place" still cannot disagree (`data.md`, key formats).
  - *Travel input:* `travel` is `{byPlace, byMeeting}`, two maps of key →
    minutes, read from `travel-times` and `meeting-travel-times` (`data.md`).
  - *Travel target:* for an in-person meeting, `{kind: 'place', key: <place
    key>}` when it has a place, else `{kind: 'meeting', key: <series key>}`
    (the series key also for a meeting that does not repeat). `null` for an
    online meeting. `travelMinutes` is read from that one entry only
    (`byPlace` or `byMeeting`), else the default; there is no fallback from
    one map to the other. The target is what a travel pick writes, so the
    value shown and the value overwritten are always the same entry.
- **`plan(now, judged, alertState, timing, env)` → Plan.**
  `env` carries `userActive`, `dataHealthy` and **`heldHeadsUpKey`**
  (`string|null`, required; PG-11): the occurrence whose heads-up the owner is
  holding on screen because its travel choices are open, or null. `plan`
  throws `TypeError` when it is missing, empty or not a string, so a caller
  cannot silently drop the hold. It changes one term only: a step-1 card whose
  key equals it stays visible after its display time. Snooze still hides it;
  it has no effect at steps 2–4, on which occurrences are active, on the step,
  on ordering beyond visibility, or on `recordHeadsUpShown`.
  **The hold never delays another meeting (PRD §4).** `plan` ignores
  `heldHeadsUpKey` whenever any other active occurrence is visible at step 2 or
  later (nudge, insist or takeover; a snoozed one is not visible, so it does
  not count until its snooze ends). Invariant, testable as such: when another
  occurrence is visible at step ≥ 2, the Plan is identical to the Plan for
  `heldHeadsUpKey = null`. So the held card falls back to its display-time
  term, and the other meeting takes the card on the same tick it reaches
  its step, with its sound. The only case where the held card can still be
  primary is the pre-existing earlier-deadline rule while its display time
  is unspent, exactly as with no hold. The Plan holds: the primary card (occurrence key,
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
  them through the store's writer facet and tells the verdict component to
  re-read them, which re-runs `judge` on the next tick (§3).

## 3. Controller ↔ verdict component ↔ UI (internal)

*Revised 2026-09-27 after PG-8b (ADR-0011); travel choices and the heads-up hold added 2026-09-30 for PG-11.*

**Who holds what.** Two `app/` classes, one inside the other:

- **`Verdicts`** (`app/verdicts.js`, the verdict component, §7.2) owns
  everything between the inputs and the judged list: the store's reader
  facet, the calendar feed, the `AiQueue`, the AI ticker, and the only call
  to `core/judge.js`.
- **`Controller`** (`app/controller.js`, the alert front end) builds one
  `Verdicts` and owns the rest: the environment, the UI, the 1 s alert tick,
  `plan`/`reduce` and alert state, sound, the test alert, the owner's
  override and travel writes, prune, and the health clocks.

**What `extension.js` injects into the controller** (all factories, so no
`app/` module imports `gi://`; lint-enforced since PG-8a; everything is
unit-tested under Node):

| Dependency | Goes to | Adapter in the extension |
|---|---|---|
| `createStoreReader(onChange)` → `StoreReaderPort` | `Verdicts` | `shell/store.js` `StoreReader` |
| `createStoreWriter()` → `StoreWriterPort` | controller | `shell/store.js` `StoreWriter` |
| `createFeed(onUpdate)` → `FeedPort` | `Verdicts` | `shell/calendarFeed.js` |
| `createAiClient(engine)`, `createAiTicker(onTick)` | `Verdicts` | `shell/aiHelperClient.js`, `shell/ticker.js` |
| `createEnvironment(onResume)`, `createUi(dispatch)`, `createTicker(onTick)`, `launchUri`, `now` | controller (`now` to both) | `shell/environment.js`, `ui/ui.js`, `shell/ticker.js`, `shell/launcher.js` |

The controller hands `Verdicts` a `writeAnswers` that calls
`StoreWriter.writeAiAnswers` (coalesced). The port typedefs live with their
consumer: `StoreReaderPort` and `FeedPort` in `app/verdicts.js`,
`StoreWriterPort`, `EnvironmentPort`, `UiPort` and `UiAction` in
`app/controller.js`. There is no single store port any more.

**The store's two facets** (both over the one `Gio.Settings`; the split is
the contract, ADR-0011/ADR-0012):

- **`StoreReaderPort`**: `readSettings`, `readOverrides`, `readTravel`
  (→ `{byPlace, byMeeting}` from `travel-times` and `meeting-travel-times`,
  PG-14), `readAiAnswers`, `destroy`. It connects to `changed` and calls `onChange`
  for every key except `INTERNAL_KEYS` (`alert-state`, `health-*`,
  `ai-verdicts`), so `ai-verdicts` is read once, to seed the queue, and the
  queue's copy is the live one after that. It has no write method and keeps the
  settings object in a private field, so nothing reached through it can write.
  This is the only facet the preview is given.
- **`StoreWriterPort`**: `readAlertState`/`writeAlertState` (coalesced),
  `writeAiAnswers` (coalesced; writing the stored text again is a no-op),
  `readHealthSeeds`/`writeHealthClocks`, `setVerdictOverride`,
  `setModeOverride`, `setTravel(target, minutes)` (PG-14: `target` is the
  judged travel target; `kind: 'place'` writes `travel-times`, `kind:
  'meeting'` writes `meeting-travel-times`, any other kind is refused and
  writes nothing), `pruneOccurrenceOverrides`, and `destroy`
  (flushes pending coalesced writes). It never connects to `changed`. The
  writer's own reads are of keys only the alert front end uses (alert state,
  health seeds).

**What `Verdicts` exposes to the controller:** `judgedList(now)` →
`{judged, byKey}` (recomputed only when an input moved, otherwise the same
object); `inputs` → frozen `{settings, timing, overrides, travel}`; `ai` → the
queue's last published state (`status` feeds the View); `feedFacts` →
`{snapshot, acceptedAt, syncedAt}` for health and the clocks;
`reloadOverridesAndTravel()` (called after every override or travel write);
`refresh(reason)`; `pruneAiAnswers()` (never throws); `destroy()`. The
controller destroys it before the writer, so no AI answer is written after
the writer's final flush.

**Controller ↔ UI:**

- The controller builds a display model (`View`) with the pure `app/view.js`
  from the Plan, the judged list, data health and `Verdicts.ai.status`, and
  calls `ui.render(view)`. Everything about *what* to show is resolved there
  (travel only at steps 1–2, Join whenever there is a link, in either mode,
  D-040, never "no meetings" while
  stale, Test alert in the menu only in a developer build, ADR-0013), so `ui/` only draws. `render` is idempotent: the same View twice
  changes nothing on screen.
- The UI reports every user action through one `dispatch(action)`:
  `join`, `ack`, `snooze`, `skip`, `setVerdict`, `setMode`,
  `setTravel {target, minutes}`, `toggleTravelChoices {key}`, `runTestAlert`.
  The UI never reports `headsUpShown` (see §2).
- **Travel in the View (PG-14, D-039).** Every in-person meeting, with or
  without a place, gets travel choices: the menu row's `travel` and the alert's
  `travel` (steps 1–2) carry the judged travel target, the minutes, the text
  and the full choice list. The UI passes the target back untouched in
  `setTravel {target, minutes}`; it never builds, reads or changes a target,
  and neither does `app/view.js` (it copies the judged one). The controller
  hands it to `StoreWriterPort.setTravel` and calls
  `reloadOverridesAndTravel()`, as before. The old `placeKey` field of the
  action is gone: a placeless meeting has no place key, and a second field
  that could disagree with the target is what this contract exists to
  avoid.
- **Travel choices on a card (PG-11).** The UI holds no open/closed state for
  them. It draws them open when `view.alert.travel.choicesOpen` is true, and
  its small "Change time" link dispatches `toggleTravelChoices` with the
  card's key (a toggle, so the UI never sends a stale "open"/"closed"). The
  controller:
  - holds `{key, step}` of the card whose choices are open, in memory only,
    never stored (`data.md`, "What is not stored");
  - ignores a toggle whose key is not the alert it last rendered, or whose
    alert has no travel choices;
  - passes `heldHeadsUpKey` = that key to `plan` only when it was opened at
    step 1 (a step-2 opening never revives a spent heads-up), and passes the
    `{key, step}` to `buildView`, which sets `choicesOpen` only when key and
    step match the alert and it has choices;
  - drops it on the render in which the shown alert's key or step differs from
    the one it was opened on (ack, skip, snooze, the nudge, another meeting or
    the test alert taking the card, a travel pick that moves the heads-up away);
  - for a step-1 opening only (a held heads-up), also drops it on the render
    in which the Plan shows any other occurrence visible at step ≥ 2, as
    primary or in `also` (PRD §4: the hold ends, it is not merely
    suppressed). This covers the case where the held card is still primary
    on its unspent display time: the choices close on that render, and the
    hold does not come back if the other meeting later leaves (acknowledged,
    snoozed, ignored). A step-2 opening (choices opened on a nudge card) is
    never dropped by this rule: it holds nothing back, so it cannot delay
    another meeting, and the "Change time" link keeps working on a nudge card
    beside another active meeting (product decision 2026-09-30). Only the
    key/step rule above closes it.

    A card that returns later comes back with its choices closed.

  A `setTravel` pick does not close the choices. Visibility is still decided
  only in `plan`: the UI never keeps a card up that the View says is gone.
- `join` is handled by the controller: it opens the core-approved `joinUrl` and
  then dispatches `ack`. It is the same on an in-person card (D-040): an
  in-person card can carry both the travel line and Join.
- Text formatting shared by `app/view.js` and `prefs.js` is pure code in
  `core/display.js`.

## 4. Extension object (stable, used by the smoke test)

The `Extension` subclass exposes one public method, `runTestAlert()`, which the
menu item also calls. The headless smoke script reaches it through
`Main.extensionManager.lookup(uuid)` and drives the ladder with it. There is one
entry point with two real callers; no test-only branch exists in the product code.
`runTestAlert()` is **not gated, in any build** (ADR-0013): the build decides
only whether the menu offers the item. So the smoke drives the ladder on the
normal bundle, the one that ships, where the item does not exist.

### 4.1 The developer build marker (ADR-0013, D-037; replaces the PG-12 setting)

- **Where it is:** one key in the bundle's `metadata.json`,
  `"payattention-developer": true`. Only the developer bundle has it. The
  source file `extension/metadata.json` never has it, and no build step ever
  writes into the working tree to add it (a crash mid-build would otherwise
  leave a flagged source that the next normal build ships).
- **What counts:** the value strictly `true`. Missing, `false`, `"true"` or
  anything else is a normal build. A wrong or partial marker fails toward the
  product: no item.
- **Who reads it:** only `extension.js`, the composition root, from
  `this.metadata`, which the shell has already parsed from the installed
  directory. No file read of ours, so no I/O in the shell process. It turns it
  into one plain boolean for the controller, "the menu offers Test alert".
  `app/` never sees metadata; `ui/` keeps drawing `View.menu.showTestAlert`, now
  computed from that boolean instead of a setting. `prefs.js` does not read it
  and has no Test alert switch. The preview (§7) never offers Test alert.
- **What it gates:** the presence of the Test alert item in the top-bar menu,
  and nothing else. It is fixed for the life of the loaded copy: no live flip,
  so no change signal.
- **What it may grow to gate:** another developer-only aid, only by a new
  entry in this section. It is not a general switch for alternative behaviour,
  and it never changes a verdict, a step time, or anything the owner relies on.
- **How it is removed:** installing the normal bundle. `gnome-extensions
  install --force` replaces the install directory wholesale (measured
  2026-10-01: a file present only in the earlier zip is gone afterwards), so
  `metadata.json` is the normal one again. On Wayland the running shell keeps
  the copy it loaded at login, marker included, until the next login; the same
  is true of any code change.

## 5. Settings (stable)

The GSettings schema in `data.md` is a public contract: `prefs.js`, the store, and
the user's `dconf` database all depend on it. Keys may be added. Renaming or
retyping a key needs an ADR, because stored values would be lost. Removing a
key needs a row in `data.md` "Removed keys", and its name is never reused.
A developer-only aid is never a key (ADR-0013): it goes in §4.1.

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

**Shell rule (the one definition of "stale", in `app/health.js`).**

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
  7. Lint: forbid the `system` built-in in `shell/`, `app/`, `ui/`, `extension.js`,
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

**Amended 2026-09-27** for D-022 to D-025 (before any of it shipped, so still
version 1): cancelled, declined and all-day meetings are not asked (§6.1);
the invite carries `calendar` after `title` (§6.2); conferencing-link queries
and text passcodes are removed (§6.2); unknown keys are refused (§6.6).

### 6.1 Which occurrences are eligible (core)

An occurrence is **eligible** when `config.ai` is not null (AI mode with a
usable engine, §6.4), it has **no** verdict override (occurrence or series),
and it is **not silent by fact** (D-023, amended 2026-09-27).

- **Silent by fact:** the kept copy's `status` is `cancelled`, or the owner's
  own response is `declined`, or it is all-day, or its start is not a finite
  number. Such an occurrence gets no invite and no `aiAsk`, and a stored
  `ai-verdicts` entry for its key is ignored (not deleted; it is pruned as
  usual). It keeps its rule verdict, which is `ignore` for each of these facts.
- Eligibility is decided **from the facts, not from the rule's reason code.**
  An all-day meeting whose rule code is `not-invited` is still not sent.
- Every other rule reason code is eligible, including `free`. The test alert
  is never eligible.
- The merge of copies from several calendars runs first. So a declined copy
  that loses the merge to an accepted copy does not make the occurrence
  silent (§6.3).

The 2026-09-27 first version of this section made cancelled, declined and
all-day meetings eligible, reading D-019 as "every meeting". D-023 narrowed
that to every meeting that can be attended.

### 6.2 The invite (core) — D-020, bounded

Core builds one invite per eligible occurrence from the occurrence DTO (§1)
and the owner identity it already computes. Core exports the field list with a
plain-language label for each field. `prefs.js` shows that list next to the
warning, so the settings text and the code cannot drift apart.

```jsonc
{
  "title": "…",                     // summary; ≤ 200 characters
  "calendar": "…",                  // name of the kept copy's calendar (D-024); ≤ 80 characters; "" when the source is unknown
  "start": "2026-09-28 Mon 17:30",  // local date, weekday and time; "2026-09-28 Mon" when allDay
  "minutes": 60,                    // length, rounded, 0 or more
  "allDay": false,
  "recurring": true,
  "status": "confirmed"|"tentative"|"cancelled"|"none",
  "busy": "busy"|"free"|"unknown",  // from transparency
  "description": "…",               // ≤ 1 500 characters; "" when absent
  "place": "…",                     // location text ≤ 200 characters; "" when absent
  "videoLink": "https://…"|null,    // the one link core's allowlist found (links.js), cut at its first "?" or "#" (D-022); ≤ 300 characters, else null
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
- **Field order is fixed** and is core's field list (`INVITE_FIELDS`):
  `title`, `calendar`, `start`, `minutes`, `allDay`, `recurring`, `status`,
  `busy`, `description`, `place`, `videoLink`, `you`, `organiser`, `guests`,
  `guestsTotal`. The fingerprint and the prefs list both follow it.
- **Calendar (D-024).** The name of the calendar the *kept* copy of the
  occurrence comes from (the snapshot's `sources[].name`, looked up by the
  event's `sourceUid`; the first source with a given uid wins). An unknown
  source gives `""`. Renaming a calendar changes the invite, so it re-asks.
- **Passcodes (D-022, D-025, D-027, D-029, D-030).** On the raw text, before
  cleaning and capping (cleaning joins lines, and the rules need line ends).
  **Removal is best effort (D-030):** the owner chose to send the whole invite
  (D-020), so these steps lower the risk and promise nothing. An unusual or
  deliberately disguised passcode may still reach the engine, and Settings
  says so next to the "whole invite is sent" warning (§6.9). A new format that
  slips through is a known limit, not a contract breach; a rule for it is a
  product call, not an automatic fix.
  - `videoLink` is cut at its first `?` or `#`, and its scheme is written
    `https://` in lower case (the allowlist accepts any case; §6.6 requires it).
  - `description` and `place` go through these steps, in this order in core
    (`core/invite.js`, `withoutPasscodes`). Plain text comes first so every
    later rule sees one format, not HTML and text mixed (D-030):
    1. **HTML to plain text,** in this order (D-030): comments, `<style>` and
       `<script>` blocks are dropped with their contents (an unclosed one keeps
       its text, so later rules still read it); then the conditional markers
       `<![if …]>` / `<![endif]>`; then tags. A line-ending tag becomes a line
       break, so step 8 stops there: the openers `<br>`, `<p>`, `<div>`,
       `<li>` (attributes allowed) and the closers `</p>`, `</li>`, `</div>`,
       `</tr>`, `</td>`, `</h1>`–`</h6>`, any case. Every other tag, namespaced
       ones such as `<o:p>` included, is dropped. A tag is `<`, an optional
       `/`, a letter, then name characters ending at a space, `/` or `>`, so
       `<https://…>` and `a < b` stay as text. No tag is sent (D-029, D-030).
    2. **Entities decoded,** once, after the tags are gone: decimal `&#…;`,
       hex `&#x…;`, and `&nbsp;` `&shy;` `&amp;` `&lt;` `&gt;` `&quot;`
       `&apos;`. One pass, so `&lt;br&gt;` becomes text and is not a line end,
       and `&amp;#8203;` stays `&#8203;`. An entity naming no valid character
       stays as written (D-030).
    3. **Invisible marks** are dropped, so none can hide a keyword. The list is
       core's one shared `INVISIBLE_MARKS` (`core/aiProtocol.js`): soft hyphen
       U+00AD, combining grapheme joiner U+034F, Arabic letter mark U+061C,
       U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069, U+FEFF
       (D-029, D-030). `cleanText` uses the same list (below).
    4. **Separators made plain:** no-break spaces (U+00A0, U+202F) become a
       space and U+2010/U+2011 become `-`, so a dial string written with them
       still matches (D-030).
    5. **Conferencing queries:** every link whose host is on core's
       conferencing allowlist is cut at its first `?` or `#` (a trailing
       `.,;:!?` is kept). Links to other hosts are left whole (D-020).
    6. **Percent-encoded pauses and codes** `%2C` `%3B` `%23` `%2A` (any case)
       are decoded, only right after a digit, `,`, `;`, `#` or `*` (or another
       of them), so other text with `%` is untouched (D-030).
    7. **Dial-in strings:** a phone number (optional `tel:` and `+`, at least 7
       digits, groups split by up to 3 of space, tab, `.`, `-`, `(`, `)`)
       followed by `#` or `*` directly after the last digit, or (after up to
       3 spaces or tabs) by `,`/`;` then a digit, `#` or `*`, is replaced whole, codes included,
       with `[removed]`. A plain number, one followed by `, ` as in a list, or
       one followed by a space and then `#` (`Order 1234567 #urgent`) stays. Fewer than 7 digits is never a dial string: it cannot be told
       from a room number or an extension (D-029). **Must stay linear:** each
       number is found once and the scan resumes after it (D-030); a
       backtracking pattern over a long digit run is a hang in the shell.
    8. **Text passcodes:** after "passcode", "password", "pwd" or "PIN", or
       their plurals (any case, whole word; D-029), the separators (`:` `=`
       `#` `-`, whitespace including line breaks) and the fillers "is" /
       "code" are kept, and **the rest of that line** is replaced with
       `[removed]` (D-027). A value alone on the next line is therefore removed
       too. A rest with no letter or digit holds no code and is kept. The word
       itself is kept.
    9. **Cleaning**, then 10. **the cap** (below). Removal runs before the
       cap, so a cut cannot leave half a passcode.
- **Every text field** is cleaned before capping, by core's one `cleanText`:
  made well formed, control characters turned to spaces, the whole shared
  `INVISIBLE_MARKS` list removed, runs of whitespace collapsed to one space,
  trimmed. `validateInvite` rejects any text field that `cleanText` would
  change, so an invite carrying any mark on the list fails with `bad-invite`
  (D-030). Then it is cut to its cap (one character less, plus "…"). Names
  ≤ 80 characters, email addresses ≤ 254, calendar ≤ 80.
- **Hard size cap: the serialised invite is at most 8 192 UTF-8 bytes.** If
  the caps above still exceed it, drop guests from the end (`guestsTotal`
  stays true), then shorten `description`. The field caps make the rest fit.
  Typical invites are 0.5 to 2 KB.
- **Never sent:** UIDs (event and calendar), occurrence or series keys, the
  owner's own addresses, rooms and resources, the query or fragment of any
  conferencing link, a passcode written as text, a phone dial-in string with
  its codes, invisible marks, any HTML tag, the rule's verdict and
  reason, and anything about overrides. Non-conferencing links inside the
  description and place are sent as written (D-020). The calendar *name* is
  sent (D-024; it was on this list until 2026-09-27).
- **Not asked at all:** cancelled, declined and all-day occurrences (§6.1,
  D-023).
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

### 6.5 AI queue behaviour, inside the verdict component (app, internal but binding)

*Revised 2026-09-27 for D-031 (a truthful "AI unavailable" line, and recovery
within 5 minutes after an unreachable engine returns). The names in brackets
are the code's (`app/aiQueue.js`, `app/aiBudget.js`). Since PG-8b the queue,
the AI ticker, the engine sync and the withholding two-pass `judge` belong
to the verdict component (`app/verdicts.js`, §3, §7.2), not the alert
controller; the rules below are the same for every front end that builds
one (the extension, the preview).*

- **Queue.** On each AI tick (1 s, only while an engine is set; skipped
  while a re-judge is pending), the verdict component pumps the queue with
  the last judged list, and the queue collects the `aiAsk`s whose
  occurrence starts no earlier than `now − cutoff`, and queues them, soonest
  start first. **At most one request is in flight.**
- **Waiting meeting.** A judged occurrence with an `aiAsk`, a non-null start,
  and `start ≥ now − cutoff`. This is the queue's pick test without the retry
  check. Every rule below that says "waiting" means exactly this set.
- **Two pieces of failure state**, in memory, per engine (both emptied when
  the engine changes):
  - **engine down** (`engineDown`, boolean): the engine cannot be asked right
    now, or its last ask did not reach it. Set and cleared only as the table
    below says.
  - **failed keys** (`failedKeys`): keys whose own most recent ask ended in
    `failed`, whatever the code. A key leaves the set only on its own verdict
    or an engine change. This set is kept on its own; it is **not** derived
    from the per-occurrence retry records, which it no longer matches.
- **What the verdict component passes to `judge`.** The stored `ai-verdicts` entries, except
  that it withholds the entry of a key that has an outstanding `aiAsk` when
  engine down is set, or that key is in failed keys. The rules then decide
  those meetings (D-019). Only keys with an `aiAsk` can hold a stale entry, so
  the verdict component never computes a fingerprint. A change of engine down,
  failed keys or the answers re-runs `judge`; a change of status alone needs
  only a render. Withholding never changes which keys carry `aiAsk`, so the
  status (below) and `judge` never feed each other in a loop.
- **Never on the alert path.** The tick and `plan()` never call the queue or
  the AI helper, and never wait for them; the render reads only the frozen
  state the queue last published (answers, failed keys, engine down, status),
  like overrides. The tick's one path into `app/verdicts.js` is
  `judgedList(now)`, which calls `judge` only, never the queue. An answer is
  written to `ai-verdicts` through the injected `writeAnswers` (in the
  extension, `StoreWriter.writeAiAnswers`, coalesced like alert state; in the
  preview, memory), and then `judge` re-runs, as it does after an override.
- **What each outcome does.** "Unreachable" codes are `network`, `timeout`
  (the helper's or the shell watchdog's), `tls` and `server`
  (`ENGINE_UNREACHABLE_CODES`).

  | Outcome | engine down | failed keys | per-occurrence retry | engine pause | the spend for this ask |
  |---|---|---|---|---|---|
  | `verdict` | clear | remove the key | delete the key's record | unreachable backoff reset to none | kept |
  | `failed`, unreachable code | set | add the key | advanced **only if engine down was clear when this ask was sent**; otherwise left as it was | `pausedUntil = max(pausedUntil, now + w)`, `w = nextEnginePauseMs(previous w)`: 30 s, doubling, **capped at 90 s** | **returned** to the budget |
  | `failed`, `auth` / `config` / `no-key` | set | add | advanced | 30 min, or until `verdict-source`, `ai-endpoint` or `ai-model` changes | kept |
  | `failed`, `rate-limited` | set | add | advanced | `Retry-After` if given (capped at 30 min), else 5 min | kept |
  | `failed`, `bad-reply` | clear (the engine did reply) | add | advanced | unreachable backoff reset to none | kept |
  | `failed`, `bad-request` | unchanged | add | advanced | none | kept |
  | `lost` (helper could not start, exited, or broke the protocol), the key's **first in a row** | set | unchanged | none | none (the client's own restart backoff limits it) | **returned** |
  | `lost`, the key's **second or later in a row** | set | add | advanced | none | **returned** |
  | the budget refuses a send | set | unchanged | none | none | nothing was spent |
  | the client could not be created, or settling threw | set | unchanged | none | none | — |

  - "Advanced" means the key's record becomes `{waitMs: w, retryAt: now + w}`
    with `w = nextAskRetryMs(previous waitMs or null)`: 1 min, doubling, up to
    30 min. The queue does not pick a key before its `retryAt`.
  - The ask's token records whether engine down was set when it was sent
    (`downAtSend`). So the first unreachable failure while the engine was
    fine counts against that meeting (it may be the meeting's own fault, for
    example an invite that always times out), but the probes made during an
    outage do not push any meeting's retry further out.
  - **Lost streak** (added 2026-09-27; product rule: one meeting's invite
    must never block AI answers for other meetings). The queue keeps, in
    memory, a per-key count of that key's own asks that ended in `lost` in a
    row (`lostStreak`, a `Map` key → count, beside `_retry`). On `lost`, the
    token's key count goes up by one; when the result is
    `LOST_STREAK_LIMIT` (= 2, exported beside the other constants) or more,
    the second `lost` row applies: the key is added to failed keys and its
    retry is advanced, so the queue picks the next waiting meeting. Every
    further `lost` of that key advances its retry again (1, 2, 4 … 30 min).
    A key's count is deleted on any `verdict` or `failed` outcome **of that
    key** (its ask reached the helper and came back), and every count is
    cleared on an engine change, with `_retry`. Another key's outcome does
    not reset it. `downAtSend` plays no part here: after the first `lost`
    engine down is set, so the re-ask of a crashing invite is always sent
    "while down", and must still count.
  - Why two and not one: a single helper crash (killed by the system, a
    one-off fault) should cost that meeting nothing. Why no cause test: the
    outcome does not say whether the helper was ever handed the invite (a
    spawn failure is also `lost`), and the protocol and `AiOutcome` stay as
    they are. The price, accepted: while the helper cannot start at all,
    waiting keys are backed off one after another. Nothing can be asked then
    anyway, the status already reads `unavailable`, and the first retry is
    only 1 min. A protocol mismatch stops the client for good (`ready` stays
    false), so it never reaches this rule.
  - Returned spend: `RequestBudget.refund(engineTag, sentAt)` removes the one
    spend recorded at the ask's `sentAt` for that engine (a no-op if it has
    aged out). Checking and spending stay one call (`trySpend`).
  - **During any pause nothing is sent, so nothing is spent.** The only
    requests an outage costs are the probes at the end of each pause, and
    those are returned. So an outage never leaves the budget lower than the
    answered traffic alone would have.
  - A bad key is never hammered: `auth`, `config` and `no-key` pause for
    30 min. A key saved in prefs is in the keyring, which the shell cannot
    see. It applies to the next request, because the helper looks the key up
    per request. After fixing a key, the owner can switch the mode off and on
    to end the pause at once.
  - `unreachable backoff reset to none`: the next unreachable failure pauses
    30 s again. An engine change also resets it and ends any pause.
- **Recovery bound (D-031).** Say the engine becomes reachable at time R.
  - No ask in flight at R: the pause in force ends by R + 90 s. The next pump
    (within 1 s) sends the soonest waiting meeting, because outage probes did
    not advance any retry and returned their spends. First ask by R + 91 s.
  - An ask in flight at R that still fails: it ends by the helper's deadline
    or the watchdog, at most `timeoutMs + 10 s` after it was sent (100 s for
    a local engine). Then a pause of at most 90 s. First ask by R + 191 s;
    with the engine's own answer time of at most `timeoutMs` (90 s), the
    first answer arrives by about R + 281 s, inside 5 minutes.
  - One verdict clears engine down, so the remaining waiting meetings follow
    one at a time, soonest first.
  - Two cases are outside the bound, on purpose: a budget already exhausted
    by *answered* requests (it would block with or without the outage), and a
    meeting held by its own retry from failures while the engine was fine,
    or from its own lost streak (it would not be asked without the outage
    either).
- **Budget.** At most 120 requests per rolling hour and 1 000 per rolling
  24 h, per `engineTag` (assumed; `constraints.md`). This is held in memory,
  so a lock resets it. Stored answers make that harmless in practice. Spends
  for unreachable and `lost` outcomes are returned (table above). When the
  budget blocks a waiting ask, engine down is set.
- **Status for the View**, one of:
  - `off`: rules mode, or no usable engine;
  - `unavailable`: **at least one waiting meeting is decided by the rules
    because of a failure**, that is, engine down is set, or that meeting's
    key is in failed keys;
  - `ok`: otherwise. This includes meetings not yet asked for the first time
    while the engine is fine: the rules stand in for them, but nothing failed.

  With `unavailable`, the menu shows "AI unavailable — using rules"; with
  `ok` or `off` it shows no such line. So the line is hidden when every
  waiting meeting has a current answer (there are then no waiting meetings),
  and when the only failed meetings have started more than `cutoff` ago.
  The status is computed at the end of **every** pump, whatever path it took
  (watchdog, pause, not ready, nothing to pick, budget, send), and after every
  settle, from the judged list and cutoff of the last pump and the current
  time. It is published only when it changes. It is not persisted.
- **Helper lifecycle.** Spawn when there is something to ask and none is
  running. Send `configure`, then requests. Kill it (SIGKILL) in `disable()`,
  when `verdict-source` leaves `ai`, and when `ai-endpoint` or `ai-model`
  changes (the next ask respawns it). Watchdog: no answer
  within `timeoutMs + 10 s` counts as `timeout`, and the helper is killed and
  respawned. Respawn backoff as for the calendar helper (`constraints.md`).

### 6.6 Shell ↔ AI helper protocol (NDJSON over stdio, version 1)

Transport and lifecycle are as in §1: `gjs -m <extension dir>/ai/main.js`,
stdin and stdout piped, stderr inherited, `G_MESSAGES_DEBUG` removed from its
environment (by the shell and by prefs' probe alike), exit on stdin EOF, SIGKILL
from the shell, and nothing but protocol lines on stdout. One core module defines the
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

**Unknown keys are refused, in both directions, at every level** (the
message, the invite, `you`, `organiser`, each guest). Every AI message must
have **exactly** its keys; `retryAfterS` is allowed only on a `failed` with
code `rate-limited`. This is deliberately **not** the calendar protocol's
rule (§1 ignores unknown keys for forward compatibility): the two ends of the
AI channel ship in the same zip, so there is no version skew to tolerate, and
the exact key set is the security guard that keeps anything but the invite
from reaching the network and anything but a verdict from coming back. A
change to any AI message's keys is a protocol version bump. Core's
`aiProtocol.js` validates and formats every line on both sides; its format
functions throw on anything invalid, so neither side can write a line the
other refuses.

**Helper → shell**

```jsonc
{"type":"hello","protocol":1}
{"type":"verdict","id":"…","verdict":"must"|"ignore","reason":"…"}   // reason already normalised (6.8)
{"type":"failed","id":"…","code":"timeout"|"network"|"tls"|"auth"|"rate-limited"|"server"|"bad-reply"|"bad-request"|"no-key"|"config"}
```

`rate-limited` may carry `"retryAfterS": <integer>`. There are no other fields
and no free text: an HTTP body is never forwarded. `no-key` means the Secret
Service could not be reached, or every saved item for the endpoint is locked.
An endpoint with no saved item is a keyless request, not `no-key` (ADR-0009
amendments). The helper never prompts to unlock.

### 6.7 Helper → engine (OpenAI Chat Completions)

`POST <endpoint>/chat/completions`, `Content-Type: application/json`, and
`Authorization: Bearer <key>` only when a key is saved for the endpoint *and*
the URL is `https:` or a loopback `http:`. A key is never sent over `http:`
to a private host. **A loopback endpoint is always reached directly, never
through a proxy**, whatever the desktop's proxy settings say: a proxy would
receive the bearer key in clear and the invite would leave the computer,
breaking "stays on this computer". GNOME's default ignore list already covers
loopback; this rule makes it hold when the owner's list does not. Other
endpoints honour the desktop proxy (an `https:` key travels inside the TLS
tunnel). libsoup 3: a session built with `proxy_resolver: null` uses no proxy;
the default is the GNOME resolver (both measured 2026-09-27). The body:

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
- HTTP mapping: connection refused, DNS failure, or any other libsoup
  session or protocol error → `network`; TLS error → `tls`; 3xx (redirects
  are not followed) → `config`; 401 or 403 → `auth`; 402 or 429 →
  `rate-limited`; other 4xx → `config`; 5xx, or a status outside 200–599 →
  `server`; timeout → `timeout`; a body over 1 MiB after decoding →
  `bad-reply` (read with a cap, so a hostile engine cannot exhaust memory).
- A stored key that is not 1–4 096 visible ASCII characters gives `config`
  and is never sent (it could split a header). An empty key is keyless. The
  rule is defined once, in `core/aiEngine.js` (`isSendableKey`,
  `MAX_KEY_LENGTH`): the helper uses it before sending, and prefs uses it
  before saving, so the owner cannot save a key that would silently never be
  sent (PG-4d).
- **One deadline**, `timeoutMs`, covers the key lookup, the request and the
  single `response_format` retry, so an answer never comes later than
  `timeoutMs` + about 1 s and stays inside the shell's watchdog.
- Only `choices[0].message.content` is read. Everything else in the body is
  ignored.

### 6.8 Reply validation (core) — data, never instructions

`parseReply(text)` → `{verdict, reason}` or `null` (which gives `bad-reply`):

1. Remove one leading `<think>…</think>` block and one surrounding code fence.
2. What remains must parse as exactly one JSON object. Otherwise → `null`.
3. `verdict` must be exactly `"must"` or `"ignore"`. `reason` must be a
   string. Any other key is ignored and never read.
4. Normalise `reason` with the same `cleanText` as the invite (§6.2):
   control characters (including newlines) become spaces, the whole shared
   `INVISIBLE_MARKS` list is removed (not only the bidi controls; D-030),
   whitespace collapsed, trimmed; cut to 80 characters (79 plus "…"). If it is empty after that → `null`.

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
  is shown with it, and so is a line saying that passcode and dial-in removal
  is best effort (D-030; wording is the product's).
- **Everything acts on the settings as applied, never as typed.** Saving
  the key, "Remove" and "Test connection" use the saved `ai-endpoint` and
  `ai-model`, and are greyed out while an edit to either is not yet applied.
  So a key is always saved under the address it will be sent to, and a test
  always tests what the shell will use (PG-4d; accepted by product).
- "Test connection" spawns `ai/main.js` with `configure` from the applied
  settings, then `probe`, and shows a clear yes, or no with the failure code
  in plain words. It never sends calendar data.
- **Where the code sits.** `prefs.js` stays one file at the extension root
  (GNOME loads it from there). It holds the widgets, the keyring write, and
  the one-off helper run for "Test connection". Every decision (what to show,
  whether a pasted key is usable, what a probe outcome means in words) is in
  pure core, `core/aiSetup.js`, and is tested under Node. Prefs gets its own
  directory only if a second gi module is needed beside it.

## 7. The verdict component and the verdict preview (ADR-0011, ADR-0012) — designed 2026-09-27; 7.1 built (PG-8a), 7.2 built (PG-8b), 7.3 built (PG-8c)

Serves R-20 (the owner can see what payAttention would decide, without logging
out) under D-032, and the owner's ports-and-adapters principle (ADR-0011).
Backlog item PG-8. Two refactors come first (7.1, 7.2); the preview (7.3)
depends on both.

### 7.1 `app/`: the application ring (directory move, no behaviour change) — built in PG-8a

The gi-free modules left `shell/` for `extension/app/`: `controller.js`,
`aiQueue.js`, `aiBudget.js`, `health.js`, `backoff.js`, `view.js`,
`soundCue.js`. `app/` is linted exactly like `core/` (no `gi://`, no
`resource://`, no Node built-ins, no `system`) and may import `core/`.
`shell/` keeps only adapters: `store.js`, `settingsKeys.js`,
`calendarFeed.js`, `helperProcess.js`, `aiHelperClient.js`, `ticker.js`,
`launcher.js`, `environment.js`; it may import `app/` and `core/`. The build
adds `--extra-source=app` (`scripts/build.sh`, which also fails if
`app/controller.js` is missing from the zip). Not strictly needed by the preview, but without it
the preview's lint allowlist would name modules that then move.

### 7.2 The verdict component (app/, internal but binding: two callers) — built in PG-8b as `app/verdicts.js` `Verdicts`; its surface is in §3

One component in `app/` owns **everything between the inputs and the judged
list**, and is the only caller of `core/judge.js`:

- **Takes (injected):** the store's *reader* facet (settings, overrides,
  travel, stored AI answers, and a change signal); a feed factory; the AI
  client factory and AI ticker factory; `writeAnswers` for AI answers (the
  extension passes the store's coalesced write; the preview passes an
  in-memory sink); `now`.
- **Owns:** the calendar feed, the `AiQueue`, the AI ticker, the engine sync
  (`aiEngine(settings)` → `setEngine`), the "judge only when an input moved"
  flag, and the two-pass judge with withheld answers (§6.5), moved as they are
  from `controller.js:217-272, 376-383`.
- **Exposes:** the judged list for `now` (recomputed only when dirty), the AI
  state and status (`aiStatusOf`), the feed's facts for health (snapshot,
  accepted-at, synced-at), `refresh(reason)`, a way for its owner to say "the
  overrides or travel changed", and `destroy()`.
- **Also exposes, for a front end that waits for the AI (PG-8c):**
  `aiProgress(now)` → frozen `{pending, byRules}`. It calls `judgedList(now)`
  first, so the counts always describe the list as of `now`, and calling it is
  what lets the AI ticker ask (the queue pumps the last list it was given).
  The counting is `aiProgressOf(ai, judged, cutoffMs, now)` in
  `app/aiQueue.js`, over §6.5's waiting meetings using the one `isWaiting`
  definition: `byRules` = those whose own last ask failed (`failedKeys`), or
  all of them while the engine is down; `pending` = the rest. Without an
  engine, and after `destroy()`, it is `{pending: 0, byRules: 0}`.
- **After `destroy()`:** `judgedList` is empty, `feedFacts` is
  `{snapshot: null, acceptedAt: null, syncedAt: empty}`, `refresh` and
  `reloadOverridesAndTravel` do nothing. A front end may therefore read it
  from a callback that races its own teardown.
- **Never** writes to the store except through the injected `writeAnswers`,
  never plans, never renders, never touches alert state.

The alert **controller** keeps: the environment, the UI, the 1 s alert tick,
`plan`/`reduce` and alert state, sound, the test alert, override and travel
writes (through the store's *writer* facet, then telling the verdict component
to reload), prune, and the health clocks.

**The store splits into two facets.** The GSettings adapter implements both;
the extension hands the verdict component the reader and keeps the writer for
the controller. The preview is only ever given the reader. Built as
`StoreReader` and `StoreWriter` in `shell/store.js` (§3); the split is the
contract, the names are not.

Tests: the existing controller suites (`tests/unit/controller*.test.js`) pass
unchanged in meaning; the verdict component gets its own suite for the AI
paths now in `controller.ai.test.js`.

### 7.3 The preview (gjs front end, `extension/preview/`) — built in PG-8c

**Invocation.** From a terminal in the owner's desktop session:

```
gjs -m ~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io/preview/main.js [--json]
```

It needs the extension installed (for the compiled schema), not enabled. It
runs **only from the installed copy** (ADR-0012): it finds the schema and the
helpers relative to its own file, so running `extension/preview/main.js` from
the repository reports "not installed". It runs the installed files, which
may be newer than what the running shell loaded at login; that is the point.
The README gives this line. From the repository, `npm run preview` is the
shortcut (`package.json`, it runs the installed copy under
`${XDG_DATA_HOME:-$HOME/.local/share}`); for JSON a script needs
`npm run -s preview -- --json`, because without `-s` npm prints its own
banner on stdout ahead of the object.

**Files.** `preview/main.js` is the only gi code and the only place that ends
the process (composition only, like `extension.js`). The logic is gi-free and
Node-tested: `preview/cli.js` (arguments, exit codes, fixed texts),
`preview/session.js` (`startPreview`: one run, its waits and its one outcome)
and `preview/report.js` (the text and JSON presenters). The split is
`boundaries.md`'s, the file names are not a contract.

**Composition.** Its entry builds, and nothing else:

- `Gio.Settings` from `<its own directory>/../schemas` through
  `Gio.SettingsSchemaSource.new_from_directory` (as `Extension.getSettings`
  does), then **`settings.delay()` before the first read**; `apply()` is never
  called. Handed to the store adapter's reader facet only.
- The calendar feed with the extension's own argv (`gjs -m <dir>/helper/main.js`).
- The AI client factory with the extension's own argv (`gjs -m <dir>/ai/main.js`),
  and the `shell/ticker.js` ticker for the AI pump.
- The verdict component (7.2) with `writeAnswers` = keep in memory.
- The `shell/ticker.js` ticker again, at 1 s, as the run tick that decides
  when to print.
- A `GLib.MainLoop`, and handlers for SIGHUP (terminal closed), SIGINT
  (Ctrl-C) and SIGTERM (`GLibUnix.signal_add`, installed before the run
  starts so a Ctrl-C during start-up is handled) that destroy the component
  (which kills both helpers) and exit. Every exit is `System.exit` deferred to
  a main-loop idle source (the helper's rule, `testing-and-build.md`).

**When it prints.** After the first accepted snapshot, and:

- in rules mode (or AI mode with no usable engine): at once;
- in AI mode: when `aiProgress(now).pending` is 0 (no waiting meeting is
  still to be answered: each has a current answer, or its ask failed, or the
  engine is down; 7.2), or when **5 minutes** have passed **counted from the
  first accepted snapshot**, not from start-up (assumed; the AI first-answer
  target in `constraints.md` is ≤ 5 min). Waiting meetings are then printed
  with the verdict the extension would show at that moment: the rule verdict.
  Progress ("asking the AI engine: N meetings waiting") goes to stderr, counts
  only, one line each time the count changes.

The queue's pacing and budget apply unchanged (one ask in flight, 120/h in
memory), so the preview cannot hammer an engine.

**Which meetings.** Every judged occurrence of the snapshot range (now − 1 h
to now + 36 h) whose end is after now, in judge order, must and ignore alike.
The test alert is never shown.

**Text output (default).** A header with the time, then the verdict source:
the rules; AI with the model and where it runs from `endpointClass` (on this
computer / on the local network / on the internet, the last two saying
invites leave the computer); or the rules because AI mode is on but its
address or model cannot be used. Then per local day a heading, and per meeting: start–end time,
verdict (`MUST` / `ignore`), online / in person (with travel minutes when in
person; neither on an all-day row), title, and core's reason on its own line (AI reasons already read
"AI: …", `core/verdict.js:99`); "your choice" when overridden. A footer: calendars
that failed (`ok:false`, one line each, by name, with the error code in plain
words; the JSON keeps the code), and in AI mode the count of meetings the
rules decided because the engine was unavailable (`byRules`), and the count
still waiting for the engine when the 5 minutes ran out (`pending`), shown
with the verdict payAttention gives now. "Your choice" marks a verdict
override only, as `overridden` does. Layout is the senior
engineer's; the fields are the contract.

**Every calendar- or engine-derived string is passed through core's
`cleanText` before printing** (`core/aiProtocol.js:71`). It turns every
control character, ESC and the C1 range included, into a space and removes
the direction overrides. Why: titles come from strangers' invites; printed
raw, an escape sequence in a title can rewrite the owner's terminal.

**`--json` (stable once shipped, `"v": 1`, additive changes only).** One
object on stdout:

```jsonc
{"v":1, "generatedAt":1790000000000,
 "verdictSource":"rules"|"ai", "aiStatus":"off"|"ok"|"unavailable",
 "calendars":[{"name":"…","ok":true,"error":null}],
 "meetings":[{"key":"occ:…","seriesKey":"series:…","start":…, "end":…,
              "title":"…","verdict":"must"|"ignore","reasonCode":"…","reason":"…",
              "mode":"online"|"in-person","overridden":false,"travelMinutes":…|null}]}
```

Field values are the judged occurrence's own, unformatted, with these
rules:

- `generatedAt` is the moment the list was computed (the tick that printed),
  not the start of the run.
- `overridden` is the judged occurrence's `verdictOverridden`: a mode override
  alone does not set it.
- `title`, `reason`, and each calendar's `name` and `error` pass through
  `cleanText`, as in the text output. `key` and `seriesKey` are identifiers
  that must match the stored override keys and are never cleaned.
- The JSON text is **ASCII-only**: every code unit above U+007E is written as
  a `\uXXXX` escape. Why: gjs `print()` converts to the locale's charset, so
  raw UTF-8 could be corrupted on a non-UTF-8 terminal; parsing gives back
  the same strings.
- `meetings` lists the same meetings as the text output (judge order, end
  after now or unknown).

**Exit status.** 0 printed (also for `--help`, on stdout); 1 usage or
internal error; 2 the extension is not installed (metadata or compiled schema
not found or unreadable); 3 no calendar snapshot within **30 s** (assumed);
128 + the signal number when stopped by a signal: **130** Ctrl-C (SIGINT),
**129** terminal closed (SIGHUP), **143** killed (SIGTERM), the shell
convention. An AI failure never changes the exit status: it is shown.
Internal-error text passes through `cleanText` too.

**Failure behaviour.**

| Case | What happens |
|---|---|
| Not installed | "payAttention is not installed" on stderr, exit 2. |
| Calendar helper cannot start or keeps crashing | The feed's usual restart and backoff; no snapshot in 30 s → exit 3 with a fixed line pointing at the helper's own status lines, which the helper writes to the same stderr above it. |
| Some calendars fail | Verdicts from the rest, failed ones named in the footer (as the extension). |
| No key, locked keyring, engine down, lost helper | The queue's own rules (§6.5): rule verdicts for those meetings, footer says so, exit 0. |
| Ctrl-C, terminal closed, killed | Signal handler destroys the component, exit 130 / 129 / 143; if the process dies anyway, both helpers exit on stdin EOF (§1). |
| Run with the extension active | Both read settings; only the extension writes. Two AI helpers, two budgets: up to 240 asks/h to the engine. EDS serves both. |
| Outside the desktop session (SSH, no session bus) | EDS unreachable → exit 3; keyring unreachable → AI falls back to rules. |
| A different `TZ` from the shell's | Times are local to the preview's process; the invite's start text changes, so AI answers would be re-asked. The README says to run it from a terminal on the desktop. |

**Parity with the extension — how it is proved.**

1. *By construction (lint, `eslint.config.js`).* `preview/` may import
   `core/` (except `judge.js`, `plan.js`, `alertState.js`) and, from `app/`,
   only `app/verdicts.js`. Only `preview/main.js` may import the adapters
   `shell/store.js` (the reader: importing `StoreWriter` is a lint error),
   `shell/calendarFeed.js`, `shell/aiHelperClient.js`,
   `shell/helperProcess.js`, `shell/ticker.js`, `gi://` Gio, GLib and
   GLibUnix, and the `system` built-in (its own process, as the helpers); it
   may not name `Gio.Subprocess` (spawning goes through `spawnHelper`). The
   other `preview/` files are linted like `app/`. No `preview/` file may use
   a dynamic `import()`, which lint could not see. Everything else is
   forbidden, including `ui/`, `helper/`, `ai/`, `extension.js`, `prefs.js`
   and `resource://`.
2. *Unit (Node).* A parity test builds the alert controller and the preview's
   gi-free presenter over the same fake inputs — rules mode, occurrence and
   series overrides, travel, current and stale stored AI answers, and an
   engine-down state that exercises the withheld second pass — and asserts
   that every meeting the controller judged appears in the preview output with
   the same key, verdict, reason code, reason, mode and overridden flag.
3. *Integration (the helper layer's isolated EDS).* The preview, installed
   from the built zip into a throwaway home and run with `--json` against the
   helper tests' fixture calendars and a keyfile GSettings backend, gives the
   verdicts expected for those fixtures (`tests/helper/preview.test.js`;
   `testing-and-build.md` Layer 2c).
4. *Never writes.* The same run with `GSETTINGS_BACKEND=keyfile` in a
   throwaway config directory leaves the keyfile byte-identical, and in AI
   mode (against the fake engine) the throwaway keyring's items are unchanged.
