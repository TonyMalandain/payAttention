# Plan — PG-1c: alerts, top bar, settings, install

**Sensitive:** personal data (calendar titles, places, calendar names and people's
addresses are shown on screen and must never be logged); a modal input grab (a leaked
grab makes the Wayland desktop unusable); launching a URL from calendar data ("Join").
No secrets, no auth.

Written by the senior engineer on 2026-09-26; **revised the same day after PG-1a
(`9d9a657`) and PG-1b (`cf070ed`) were built**. Every core and helper name below is
the real exported name, read from the code. Spec: `docs/prd/meeting-guardian.md`
§3–§7 and "Done when"; decisions D-004 to D-010, D-013, D-014 in
`docs/product/decisions.md`; architecture `docs/architecture/*.md` including the
"Addendum 2026-09-26 — provider sync freshness (D-013)" at the end of
`interfaces.md`; ADR-0002 to ADR-0006.

## What changes, and for whom

The calendar owner gets an installed extension:
- a top-bar countdown to the next must-attend deadline, with a menu of today's
  meetings (verdict, reason, override, online/in-person switch, travel chooser,
  "Test alert", "Settings");
- the four alert steps: calm corner card → amber card → red pulsing centred card
  with sound → a full-screen takeover on every monitor that only an action clears;
- a settings window;
- a warning that **names the calendar(s)** that stopped updating (D-010, D-013, D-014).

The installer gets `npm run install:local`.

## The component

This ticket builds three subsystems from `boundaries.md`, plus the composition root.
The one piece of existing code it touches is the lint config, which has drifted from
`boundaries.md` (Step 1 puts that right first).

- **`extension/shell/` — responsible for:** turning calendar snapshots, stored
  settings and state, and the clock into a display model once a second, and
  turning the owner's actions into stored changes. One job per file:
  - `calendarFeed.js` — keeps the helper process alive, and hands on its last
    accepted snapshot and when each calendar was last seen in sync.
  - `store.js` — typed read and write of the GSettings schema. It is the only
    GSettings code in the shell process.
  - `settingsKeys.js` — pure: maps each `DEFAULT_SETTINGS` field to its GSettings
    key and kind.
  - `environment.js` — tells whether the owner is active, and when the machine resumed.
  - `ticker.js` — calls a function once a second.
  - `launcher.js` — opens a URL with the desktop's default handler.
  - `controller.js` — the one orchestrator (ADR-0002). It judges when inputs
    change, plans every tick, renders, routes actions, handles the sound edge,
    runs the test alert, and persists the health clocks on `disable()`.
  - `view.js` — pure: Plan, judged occurrences and health → the display model the
    UI draws.
  - `health.js`, `backoff.js`, `soundCue.js` — pure, one rule each: freshness
    (D-010/D-013/D-014), restart delay, and the sound edge.
- **`extension/ui/` — responsible for:** drawing a display model and reporting
  clicks. It decides nothing.
- **`extension/core/display.js` (new, in core) — responsible for:** turning numbers
  and raw text into display strings, and parsing the comma lists typed in settings.
  It is pure, and both `shell/view.js` and `prefs.js` use it. `boundaries.md` and
  `interfaces.md` §3 name this file.
- **`extension/extension.js` — responsible for:** building the controller in
  `enable()` and destroying it in `disable()`. No logic.
- **`extension/prefs.js` — responsible for:** editing the owner's settings keys.
- **Has drifted by:**
  - Everything above is new code.
  - `eslint.config.js` (from PG-1a) differs from `boundaries.md` in three ways:
    1. `ui/` is allowed `core/format.js`, but `boundaries.md` names `core/display.js`.
    2. The `system` built-in is not forbidden in `shell/`, `ui/`, `extension.js` or
       `prefs.js` (verified: `import System from 'system'` lints clean in `shell/`
       today).
    3. `.smoke-home/` is not ignored.
- **This change belongs here because:** each piece sits under the responsibility
  `boundaries.md` gives its directory. Three placements need a reason:
  - **Formatting** goes in `core/display.js`, not `ui/`, because `prefs.js` and
    `shell/view.js` both need it and neither may import `ui/`.
  - **The display model** is built in `shell/view.js`, not in `ui/`. Choosing what
    to show is a decision, and the UI must not decide. Examples: travel only at
    steps 1–2, Join only with a link, never "no meetings" while stale, which
    calendars to name.
  - **The freshness rule** lives whole in `shell/health.js`, which is pure. The
    feed only records facts: when a snapshot was accepted, and when each calendar
    was seen in sync.
    - The addendum says "the feed exposes the provider clock, with seeds from the
      controller". This plan keeps the same rule and the same survival across
      helper restarts, because the map lives in the feed instance. The provider
      clock, though, is computed by `health.js` from the feed's map and the
      seeds, which the controller passes to `health.js`.
    - That keeps one testable definition of "stale" (the addendum's own words) and
      keeps the feed free of rules. This is internal to `shell/`; nothing outside
      it can see the difference.

### Why the controller and view have no `gi://` imports

`controller.js`, `view.js`, `health.js`, `backoff.js`, `soundCue.js`,
`settingsKeys.js` and `core/display.js` import only `core/` and each other.

Every part that touches GNOME is **injected into the controller as a factory**: the
store, feed, environment, ticker, launcher and UI. That makes the orchestrator
unit-testable under Node with fakes, like core (`boundaries.md`, "Node-tested shell
modules").

These modules must never gain a `gi://` or `resource://` import. If one seems
needed, the thing belongs in an injected part instead.

## Core and helper surface this plan consumes (real names, as built)

All of these exist today. Do not change any of them. The only new file in `core/` is `display.js`.

| Module | Export | Exact shape used here | Used by |
|---|---|---|---|
| `core/protocol.js` | `PROTOCOL_VERSION` | `1` | calendarFeed (log text only) |
| `core/protocol.js` | `parseHelperLine(line)` | `→ {ok:true, message} \| {ok:false, code, field?}`. It checks the 4 MiB limit (`too-large`), bad JSON (`bad-json`) and full validation. A `hello` with another version gives `{ok:false, code:'protocol-mismatch'}`. `field` is a path, never a value | calendarFeed |
| `core/protocol.js` | `formatShellMessage({type:'refresh', reason})` | `→ string` ending in `\n`; `reason` is `'resume'` or `'manual'` | calendarFeed |
| `core/defaults.js` | `DEFAULT_SETTINGS` | frozen `Settings`: camelCase of every owner-edited key (19 fields, including `extraOwnerAddresses` and `soundEnabled`) | settingsKeys, store, schema test |
| `core/timing.js` | `timingFromSettings(settings)` | `Settings → Timing` (ms). Throws `TypeError` on a negative or non-finite field | controller |
| `core/judge.js` | `judge(snapshot, config, overrides, travel)` | Pass the **whole `Settings` object** as `config`. Owner addresses come from `snapshot.sources[].ownerEmail` plus `config.extraOwnerAddresses`, **inside judge**. `overrides = {verdict: Record<string,string>, mode: Record<string,string>}`, `travel = Record<placeKey, minutes>`. Returns frozen `JudgedOccurrence[]`, sorted by start (null last), then key | controller |
| `core/types.js` | `JudgedOccurrence` | `{key, seriesKey, recurring, title, start:number\|null, end:number\|null, allDay, verdict:'must'\|'ignore', reason, reasonCode, verdictOverridden, mode:'online'\|'in-person', modeOverridden, joinUrl:string\|null, placeText, placeKey:string\|null, travelMinutes:number\|null, travelIsDefault, deadline:number\|null}` | view, controller |
| `core/plan.js` | `plan(now, judged, alertState, timing, env)` | `env = {userActive: boolean, dataHealthy: boolean}`; **both are required** (it throws otherwise). Returns frozen `Plan = {primary: Card\|null, also: {key, step}[], takeover: boolean, indicator: {key, deadline, msToDeadline}\|null, dataHealthy}` | controller, view |
| `core/types.js` | `Card` | `{key, start, step:1\|2\|3\|4, visible, deadline, msToDeadline, snoozeUntil, recordHeadsUpShown}`. There is **no title or mode on the card**: `view.js` looks those up in the judged occurrence by `key` | view, controller |
| `core/plan.js` | `actionFor(card, type)` | `type ∈ 'ack'\|'skip'\|'snooze'\|'headsUpShown'` → `AlertAction`. The snooze end comes from `card.snoozeUntil`, which `plan` computed. **This is the only way the controller builds per-occurrence actions.** | controller |
| `core/alertState.js` | `emptyAlertState()`, `parseAlertState(text)`, `serializeAlertState(state)`, `reduce(state, action, now)` | `parseAlertState` never throws: an empty or corrupt value gives the empty state. The prune action is `{type:'prune'}` | store, controller |
| `core/keys.js` | `isExpiredOccurrenceKey(key, now)` | true only for `occ:` keys whose time is older than `RETENTION_MS` (7 days). Series keys and time-less keys are never expired. **This replaces the `occurrenceTimeFromKey` the first draft planned to add; do not add it.** | store |
| `core/testAlert.js` | `testAlert(now)` | `→ {judged: [JudgedOccurrence], timing: TEST_ALERT_TIMING}`. `judged` is an **array of one**, with key `'test:'+now`, start `now+30 s`, verdict must, online, `joinUrl: null`, `recurring: false`. Its ladder runs step 1 at +0 s, 2 at +10 s, 3 at +20 s and 4 at +25 s, with cutoff at start+60 s | controller |
| `core/words.js` | `BUILTIN_IMPORTANT_WORDS`, `BUILTIN_IGNORE_WORDS` | frozen `string[]` | prefs.js |
| `helper/main.js` | the entry file | serve mode with no arguments: `gjs -m <ext>/helper/main.js`. It exits on stdin EOF. Its stderr lines are `payattention-helper: <code>` | extension.js (`HELPER_ENTRY = 'main.js'`) |

Protocol facts the feed relies on (`interfaces.md` §1 and addendum):
- Each `sources[]` entry is `{uid, name, backend, ownerEmail, ok, error, remote?, connection?}`.
  An absent `remote`/`connection` reads as `null`.
- Local sources (for example the isolated EDS's built-ins) report `remote:false`.

## Seams

All signatures are exact. Put JSDoc types on every exported function and class, in
PG-1a's style: `@param {import('./types.js').X}` for core types, and
`@param {import('../core/types.js').X}` from `shell/`. Use 4-space indentation and
`{ a, b }` brace spacing, matching `extension/core/`.

### `extension/core/display.js` (pure; imports nothing)

```js
export function oneLine(text: string, maxChars: number): string
export function formatShort(ms: number): string          // indicator countdown
export function formatCountdown(ms: number): string      // takeover big number
export function formatRelative(ms: number): string       // "in 24 min" / "3 min ago"
export function formatClock(epochMs: number): string     // local time of day
export function formatSince(epochMs: number, nowMs: number): string   // clock, or weekday + clock, or date + clock
export function calendarLabel(name: string): string      // "Work" -> "Work calendar"
export function stepHeadline(step: 1|2|3|4, mode: 'online'|'in-person'): string
export function countdownCaption(mode: 'online'|'in-person', ms: number): string
export function parseList(text: string): string[]
export function normalizeDomains(items: string[]): string[]
export function normalizeAddresses(items: string[]): string[]
```

Exact behaviour. Each bullet is one unit test.

- **`oneLine`**:
  - Collapse every whitespace run, newlines included, to one space, then trim.
  - Empty text gives `'(no title)'`.
  - If the result is longer than `maxChars`, return the first `maxChars − 1`
    characters followed by `'…'`.
- **`formatShort`**:
  - `ms <= 0` gives `'now'`.
  - Otherwise let m = ceil(ms / 60 000). If m < 60, return `` `${m}m` ``.
  - Otherwise return `` `${h}h ${mm}m` ``, with mm padded to 2 digits
    (3 900 000 → `'1h 05m'`).
- **`formatCountdown`**:
  - `ms >= 0`: s = ceil(ms / 1000).
  - `ms < 0`: s = floor(|ms| / 1000), with the prefix `'−'` (U+2212).
  - Shape is `m:ss`, or `h:mm:ss` when s ≥ 3600.
  - Examples: 45 000 → `'0:45'`; 44 001 → `'0:45'`; 0 → `'0:00'`;
    −130 000 → `'−2:10'`; 3 725 000 → `'1:02:05'`.
- **`formatRelative`**:
  - `ms >= 60 000` → `` `in ${ceil(ms / 60 000)} min` ``.
  - `0 <= ms < 60 000` → `'in less than a minute'`.
  - `−60 000 < ms < 0` → `'just now'`.
  - Otherwise → `` `${floor(|ms| / 60 000)} min ago` ``.
- **`formatClock`**:
  - `CLOCK.format(epochMs)`, where
    `const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })`
    is built once at module scope. That is static data.
  - The test sets `process.env.TZ = 'UTC'` before importing, and checks that a
    10:30 UTC time contains `'10:30'`. Tests use only times before 12:00, so
    12-hour and 24-hour locales both pass.
- **`formatSince(epochMs, nowMs)`** (addendum item 6: persisted clocks make earlier
  days common):
  - Compute local midnight of `nowMs`: `const d = new Date(nowMs); d.setHours(0, 0, 0, 0)`.
  - `epochMs >= midnight` → `formatClock(epochMs)`.
  - Else, if `epochMs >=` the same midnight moved back 6 days (use `d.setDate(d.getDate() − 6)`,
    not arithmetic, so a DST change is handled) → `WEEKDAY.format(epochMs)`, with
    `WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })`.
  - Else → `DATE.format(epochMs)`, with
    `DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })`.
  - Tests (TZ=UTC): 1 hour ago, same day → equals `formatClock`. Yesterday →
    equals `WEEKDAY`'s output, built in the test with the same options. Ten days
    ago → equals `DATE`'s output.
  - `new Date(x)` with an argument is allowed in core. Never call `new Date()` with
    no argument, or `Date.now()` (lint forbids both).
- **`calendarLabel(name)`**:
  - Collapse whitespace and trim, as `oneLine` does, and limit to 40 characters.
  - Empty → `'Unnamed calendar'`.
  - Ends with the whole word `calendar`, any case (`/\bcalendar$/i`) → the name
    unchanged.
  - Otherwise → `` `${name} calendar` ``.
  - Examples: `'Work'` → `'Work calendar'`, `'Calendar'` → `'Calendar'`,
    `'Team Calendar'` → `'Team Calendar'`, `'  '` → `'Unnamed calendar'`.
- **`stepHeadline`**:
  - 1 → `'Heads-up'`
  - 2 → `'Get ready'`
  - 3 → `'About to start'` (online) / `'Time to leave'` (in-person)
  - 4 → `'Your meeting is starting'` (online) / `'Leave now'` (in-person)
- **`countdownCaption`**: the first wording is for `ms >= 0`, the second for `ms < 0`.
  - online → `'until it starts'` / `'since it started'`
  - in-person → `'until you must leave'` / `'since you should have left'`
- **`parseList`**: split on `,` and on newlines, trim each item, collapse inner
  whitespace, drop empty items, and remove case-insensitive duplicates, keeping the
  first spelling.
- **`normalizeDomains`**: lowercase, strip one leading `@`, and drop any item that
  contains `@`, a space, or no `.`. Remove duplicates.
- **`normalizeAddresses`**: lowercase, strip a leading `mailto:`, and keep only
  items that match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Remove duplicates.

### `extension/shell/health.js` (pure) — D-010, D-013, D-014

This is the one definition of "stale" (addendum, "Shell rule").

```js
export const STALE_AFTER_MS = 15 * 60 * 1000;     // D-010
export const STARTUP_GRACE_MS = 60 * 1000;        // addendum: no flash on unlock

/** A snapshot is accepted when it lists no sources or at least one ok source. */
export function isAcceptedSnapshot(snapshot): boolean

/** ok && remote === true && connection === 'connected'. */
export function isInSync(source): boolean

/**
 * A new map: prev plus uid → at for every source of snapshot with isInSync.
 * Never removes an entry. prev is not mutated.
 * @param {ReadonlyMap<string, number>} prev
 * @returns {Map<string, number>}
 */
export function recordSync(prev, snapshot, at)

/**
 * @param {object} p
 * @param {Snapshot|null} p.snapshot            last accepted snapshot, or null
 * @param {number|null} p.acceptedAt            when it was accepted, or null
 * @param {ReadonlyMap<string, number>} p.syncedAt   uid → last time seen in sync (this enable() only)
 * @param {{dataAt: number|null, providerAt: number|null}} p.seeds   persisted at the last disable(); null = unknown
 * @param {number} p.enabledAt
 * @param {number} p.now
 * @returns {Health}
 */
export function dataHealth(p)

/** What to persist in disable(). Same inputs as dataHealth except now. */
export function clocksToPersist({ snapshot, acceptedAt, syncedAt, seeds, enabledAt }): { dataAt: number, providerAt: number }
```

```js
Health = { state: 'waiting'|'ok'|'stale', since: number|null, calendars: string[] }
// calendars: display names (source.name) of the calendars not updating; [] unless stale by provider only
```

Definitions:
- `dataClock = acceptedAt ?? seeds.dataAt ?? enabledAt`.
- `relevant` = `snapshot ? snapshot.sources.filter(s => s.remote !== false) : []`.
  An absent `remote` counts, and so does `ok:false`.
- `sourceClock(s) = syncedAt.get(s.uid) ?? seeds.providerAt ?? enabledAt`.
- `providerClock = relevant.length ? min(relevant.map(sourceClock)) : null`.

`dataHealth` decides in this order:
1. `acceptedAt === null && now − enabledAt < STARTUP_GRACE_MS` →
   `{state:'waiting', since:null, calendars:[]}`.
2. `dataExpired = now − dataClock >= STALE_AFTER_MS`.
   `staleSources = relevant.filter(s => now − sourceClock(s) >= STALE_AFTER_MS)`.
3. `dataExpired` → `{state:'stale', since: min(dataClock, ...staleSources.map(sourceClock)), calendars: []}`.
   When no accepted snapshot is fresh, every calendar is affected, so the line
   stays generic.
4. `staleSources.length > 0` →
   `{state:'stale', since: min(staleSources.map(sourceClock)), calendars: unique(staleSources.map(s => s.name))}`.
   Keep first-seen order, and compare names exactly. (D-014: judged per calendar,
   and names the calendar.)
5. `acceptedAt === null` → `{state:'waiting', since:null, calendars:[]}`.
6. Otherwise → `{state:'ok', since:null, calendars:[]}`.

`clocksToPersist`:
- `dataAt = dataClock`.
- `providerAt`:
  - `providerClock`, when a snapshot exists and `relevant` is not empty;
  - `0` when a snapshot exists and `relevant` is empty;
  - `seeds.providerAt ?? 0` when there is no snapshot.

Misuse made impossible:
- The feed, controller and UI cannot each hold their own idea of "stale". The only
  inputs are recorded facts.
- A local calendar can never trigger a provider warning (`remote:false` is excluded
  in one place).

### `extension/shell/backoff.js` (pure)

```js
export const FIRST_DELAY_MS = 1000, MAX_DELAY_MS = 300_000, HEALTHY_RESET_MS = 600_000;
/** Delay before the next helper start. previousDelayMs is null for the first restart. */
export function nextRestartDelayMs(previousDelayMs: number|null, ranForMs: number): number
```

Rule:
- `ranForMs >= HEALTHY_RESET_MS || previousDelayMs === null` → `FIRST_DELAY_MS`.
- Otherwise → `min(previousDelayMs * 2, MAX_DELAY_MS)`.

### `extension/shell/soundCue.js` (pure)

```js
/** previous/next: the visible alert of consecutive ticks, as {key, step} or null. */
export function shouldPlaySound(previous, next): boolean
```

It returns
`next !== null && next.step >= 3 && !(previous && previous.key === next.key && previous.step === next.step)`.
The controller also requires `settings.soundEnabled`.

### `extension/shell/settingsKeys.js` (pure)

```js
/** One entry per DEFAULT_SETTINGS field, in its order. Frozen. */
export const SETTINGS_KEYS  // ReadonlyArray<{field: string, key: string, kind: 'int'|'bool'|'strv'}>
/** Keys never shown in prefs and never reported to the controller as a settings change. */
export const INTERNAL_KEYS = Object.freeze(['alert-state', 'health-data-at', 'health-provider-at']);
```

- `key` = the field with every capital letter replaced by `-` plus its lowercase
  (`onlineHeadsupMinutes` → `online-headsup-minutes`).
- `kind` comes from the type of the default: number → `'int'`, boolean → `'bool'`,
  array → `'strv'`.
- It imports only `../core/defaults.js`.

### `extension/shell/view.js` (pure)

```js
export const TRAVEL_CHOICES_MIN = Object.freeze([10, 15, 20, 30, 45, 60, 90]);   // PRD §4
/**
 * @param {object} p
 * @param {Plan} p.plan                                 real meetings
 * @param {Plan|null} p.testPlan                        running test alert, or null
 * @param {JudgedOccurrence|null} p.testJudged          test.judged[0], or null
 * @param {ReadonlyArray<JudgedOccurrence>} p.judged    real, in judge order
 * @param {ReadonlyMap<string, JudgedOccurrence>} p.judgedByKey   real, by key
 * @param {Health} p.health
 * @param {number} p.now
 * @returns {View}
 */
export function buildView(p)
```

```js
View = {
  indicator: {text: string|null, highlighted: boolean, flashing: boolean, warning: boolean},
  menu: {status: string|null, meetings: MeetingRow[], signature: string},
  alert: AlertView|null,
}
MeetingRow = {key, label, detail, reason, isMust, overridden, recurring,
              mode, otherMode, modeSwitchLabel,
              travel: null | {placeKey: string|null, minutes, header, choices: number[]}}
AlertView = {key, isTest, step, presentation: 'card'|'takeover',
             headline, title, timeLine, countdown, countdownCaption, reason,
             travel: null | {placeKey: string|null, minutes, text, choices: number[]},
             also: string[], canJoin: boolean, offerSeries: boolean}
```

Rules. Each is a unit test in `tests/unit/view.test.js`.

- **Which plan draws the alert:**
  - If `testPlan?.primary?.visible`, the alert is the test's (`isTest: true`), and
    its occurrence is `testJudged`.
  - Else, if `plan.primary?.visible`, the alert is the real one, and its occurrence
    is `judgedByKey.get(plan.primary.key)`.
  - Otherwise `alert` is null.
- **Presentation:** `'takeover'` when the chosen plan's `takeover` is true, else `'card'`.
- **Alert fields** (`j` = the occurrence, `c` = the chosen plan's `primary`):
  - `headline` = `stepHeadline(c.step, j.mode)`.
  - `title` = `oneLine(j.title, 120)`.
  - `countdown` = `formatCountdown(c.deadline − now)`.
  - `countdownCaption` = `countdownCaption(j.mode, c.deadline − now)`.
  - `timeLine`:
    - online → `` `Starts at ${formatClock(j.start)} · ${formatRelative(j.start − now)}` ``
    - in-person → `` `Leave by ${formatClock(c.deadline)} · ${formatRelative(c.deadline − now)}` ``
  - `reason` = `` `Why: ${j.reason}` ``.
  - `canJoin` = `j.joinUrl !== null`. Join is shown only with a link (PRD §3).
  - `offerSeries` = `j.recurring && !isTest`. This gives "Not important: whole
    series" (PRD §3).
  - `travel` is present only when `j.mode === 'in-person' && c.step <= 2` (PRD §4):
    - `text` = `` `Travel: ${j.travelMinutes} min${j.travelIsDefault ? ' (default)' : ''}` ``
    - `choices` = `j.placeKey !== null ? TRAVEL_CHOICES_MIN : []`. A meeting switched
      to in person with no place has nowhere to store a travel time.
  - `also` = `c`'s plan `.also` mapped to `` `also: ${oneLine(title, 60)} at ${formatClock(start)}` ``,
    using `judgedByKey` (the test plan's `also` is always empty).
- **Indicator:**
  - `text` = `` `${oneLine(title, 24)} · ${formatShort(plan.indicator.msToDeadline)}` ``
    for the real plan's `indicator` target, else null. This gives the quiet icon
    when there is nothing within 12 h (PRD §5).
  - `highlighted` = the real plan or the test plan has a `primary`, visible or not.
  - `flashing` = `alert?.step === 3 && alert.presentation === 'card'`.
  - `warning` = `health.state === 'stale'`.
- **Menu rows:**
  - `meetings` = the real `judged`, **in judge order**, keeping those with
    `start !== null && end !== null && end > now && start < nextMidnight`.
    `nextMidnight` = `new Date(now)` with `setHours(24, 0, 0, 0)`.
  - `label` = `` `${j.allDay ? 'All day' : formatClock(j.start)}  ${oneLine(j.title, 40)}` ``.
  - `detail` = `` `${j.verdict === 'must' ? 'Must attend' : 'Ignorable'} · ${j.mode === 'online' ? 'online' : 'in person'}` ``,
    with `' · overridden'` appended when `j.verdictOverridden`.
  - `reason` = `` `Why: ${j.reason}` ``. `isMust` = `j.verdict === 'must'`.
    `overridden` = `j.verdictOverridden`.
  - `otherMode` = the other mode. `modeSwitchLabel` = `'Switch to in person'` /
    `'Switch to online'`.
  - `travel` is present when `j.mode === 'in-person'`:
    - `header` = `` `Travel time: ${m} min${def ? ' (default)' : ''}` ``
    - `choices` as for the alert.
- **Menu status** (D-010: never "no meetings" while stale; D-014: name the calendar):
  - `waiting` → `'Reading calendars…'`
  - `stale`, `calendars` empty → `` `Calendar not updating since ${formatSince(since, now)}. Alerts may be missing.` ``
  - `stale`, one calendar → `` `${calendarLabel(name)} not updating since ${formatSince(since, now)}. Alerts may be missing.` ``
    (for example `'Work calendar not updating since 10:42. Alerts may be missing.'`)
  - `stale`, two or more → `` `Calendars not updating since ${formatSince(since, now)}: ${list}. Alerts may be missing.` ``
    - `list` = the first 3 names through `oneLine(name, 30)`, joined with `', '`.
    - When there are more than 3, append `` `, and ${n − 3} more` ``.
  - `ok` with no rows → `'No more meetings today'`
  - `ok` with rows → null
  - While stale, the rows are still listed. Only the status line and the warning
    mark change (D-013).
- **Menu signature:** the rows joined as
  `key|label|detail|reason|overridden|recurring|mode|travelMinutes`, one row per
  line. The UI rebuilds the menu only when this changes.

### `extension/shell/controller.js` (no `gi://`)

```js
export class Controller {
  /**
   * Builds every part, loads stored state, prunes, renders once, starts ticking.
   * If any part fails to build, already-built parts are destroyed and the error rethrown.
   * @param {object} deps
   * @param {(onChange: () => void) => StorePort} deps.createStore
   * @param {(onUpdate: () => void) => FeedPort} deps.createFeed
   * @param {(onResume: () => void) => EnvironmentPort} deps.createEnvironment
   * @param {(dispatch: (action: UiAction) => void) => UiPort} deps.createUi
   * @param {(onTick: () => void) => {destroy(): void}} deps.createTicker
   * @param {(uri: string, onDone: (ok: boolean) => void) => void} deps.launchUri
   * @param {() => number} deps.now
   */
  constructor(deps)
  runTestAlert(): void
  destroy(): void          // idempotent; persists the health clocks
}
```

The ports are plain objects. The test fakes implement exactly these:

```js
StorePort = {
  readSettings(): Settings,                      // core Settings, camelCase
  readOverrides(): {verdict: Record<string,string>, mode: Record<string,string>},
  readTravel(): Record<string, number>,
  readAlertState(): AlertState,
  writeAlertState(state: AlertState): void,      // coalesced
  readHealthSeeds(): {dataAt: number|null, providerAt: number|null},   // 0 stored → null
  writeHealthClocks(clocks: {dataAt: number, providerAt: number}): void, // immediate
  setVerdictOverride(key: string, verdict: 'must'|'ignore'|null): void,
  setModeOverride(key: string, mode: 'online'|'in-person'|null): void,
  setTravel(placeKey: string, minutes: number): void,
  pruneOccurrenceOverrides(now: number): void,
  destroy(): void,                               // flushes a pending alert-state write
}
FeedPort = {
  get snapshot(): Snapshot|null,                 // last accepted
  get acceptedAt(): number|null,
  get syncedAt(): ReadonlyMap<string, number>,
  refresh(reason: 'resume'|'manual'): void,
  destroy(): void,
}
EnvironmentPort = { isUserActive(): boolean, destroy(): void }
UiPort = { render(view: View): void, playAlertSound(): void, releaseTakeover(): void, destroy(): void }
UiAction =
  | {type: 'join'|'ack'|'snooze'|'skip', key: string}
  | {type: 'setVerdict', key: string, verdict: 'must'|'ignore'|null, scope: 'occ'|'series'}
  | {type: 'setMode', key: string, mode: 'online'|'in-person'}
  | {type: 'setTravel', placeKey: string, minutes: number}
  | {type: 'runTestAlert'}
```

Misuse made impossible:
- There is no `start()` to forget, and no `setUi()` to call in the wrong order. The
  controller creates each part and hands it its callback, so every callback exists
  before the part that calls it.
- `disable()` is one call, because the controller owns every part's lifetime,
  including persisting the clocks.
- Per-occurrence alert actions can only be built from a plan `Card`, through
  `actionFor`. The controller never hand-builds `{type, key, start, until}`.

Behaviour, in order.

**Constructor.** The whole body sits in `try { … } catch (e) { this.destroy(); throw e; }`.
1. Build the parts in this order:
   1. `store = createStore(onStoreChange)`
   2. `environment = createEnvironment(onResume)`
   3. `feed = createFeed(onFeedUpdate)`
   4. `ui = createUi(dispatch)`
2. Load state:
   - `enabledAt = now()`
   - `seeds = store.readHealthSeeds()`
   - `alertState = store.readAlertState()`
3. Load inputs: `loadInputs()`. It does `settings = store.readSettings()`,
   `timing = timingFromSettings(settings)`, `overrides = store.readOverrides()`,
   `travel = store.readTravel()`, then `judgeDirty = true`.
4. Prune:
   - `alertState = reduce(alertState, {type: 'prune'}, now)`
   - `store.writeAlertState(alertState)`
   - `store.pruneOccurrenceOverrides(now)`
   - `lastPruneAt = now`
5. Run `tick()` once.
6. `ticker = createTicker(tick)`.

**`tick()`.** `now = deps.now()`. The whole body is in a `try`:
1. If `judgeDirty`:
   - `judged = feed.snapshot ? judge(feed.snapshot, settings, overrides, travel) : []`
   - rebuild `judgedByKey`
   - `judgeDirty = false`
2. `health = dataHealth({snapshot: feed.snapshot, acceptedAt: feed.acceptedAt, syncedAt: feed.syncedAt, seeds, enabledAt, now})`.
3. `env = {userActive: environment.isUserActive(), dataHealthy: health.state === 'ok'}`.
   `plan` only passes `dataHealthy` through. Nothing is gated on it (D-013: alerts
   keep running from the cached snapshot).
4. `realPlan = plan(now, judged, alertState, timing, env)`.
   If `realPlan.primary?.recordHeadsUpShown`:
   `alertState = reduce(alertState, actionFor(realPlan.primary, 'headsUpShown'), now)`,
   then `store.writeAlertState(alertState)`.
   This is the reshaped heads-up rule: core decides, the controller records, and the
   UI never reports it.
5. If `test`:
   - `testPlan = plan(now, test.judged, test.alertState, test.timing, env)`.
   - If `testPlan.primary === null`, end the test (`test = null`, `testPlan = null`).
   - Otherwise, if `testPlan.primary.recordHeadsUpShown`,
     `test.alertState = reduce(test.alertState, actionFor(testPlan.primary, 'headsUpShown'), now)`.
     This is never written to the store.
6. `view = buildView({plan: realPlan, testPlan, testJudged: test?.judged[0] ?? null, judged, judgedByKey, health, now})`.
7. **Sound:**
   - `next = view.alert ? {key: view.alert.key, step: view.alert.step} : null`.
   - If `shouldPlaySound(lastVisible, next) && settings.soundEnabled`, call
     `ui.playAlertSound()`.
   - `lastVisible = next`.
8. `ui.render(view)`.
9. `lastPlan = realPlan`; `lastTestPlan = testPlan`.
10. If `now − lastPruneAt >= 24 h`, prune as in the constructor.

**`catch (e)`** in the tick:
- Log `console.error('payattention: tick-failed', e)`, but only when `String(e)`
  differs from the last logged failure. A successful tick resets that memory.
- Then call `ui.releaseTakeover()` in its own try/catch. This is fail-open (ADR-0004).

**`dispatch(action)`.** It is ignored after `destroy()`.
- `isTest` = `test !== null && action.key === test.judged[0].key`.
- `card` = `(isTest ? lastTestPlan : lastPlan)?.primary`, only if its `key === action.key`;
  otherwise null.

Per action:
- **`ack`, `skip`, `snooze`:**
  - If `card` is null, do nothing. The click was on an alert that has since gone.
  - Otherwise `next = reduce(state, actionFor(card, action.type), now)`, on
    `test.alertState` or on `alertState`.
  - The real state is written with `store.writeAlertState`.
  - The snooze length and its step limit come from `card.snoozeUntil`. The
    controller reads no snooze setting.
- **`join`:**
  - If `card` is null, or the occurrence's `joinUrl` is null, do nothing.
  - Otherwise capture `card`, then call
    `launchUri(joinUrl, ok => { if (!destroyed && ok) { alertState = reduce(alertState, actionFor(captured, 'ack'), deps.now()); store.writeAlertState(alertState); tick(); } })`.
  - If the launch fails, the alert stays up: a false "you are fine" is the worst
    failure (D-004).
  - The test never has a link, so `join` never reaches the test.
- **`setVerdict`:**
  - If `isTest`: end the test and write nothing.
  - Else: `store.setVerdictOverride(scope === 'series' ? judgedByKey.get(key).seriesKey : key, verdict)`,
    then `overrides = store.readOverrides()` and `judgeDirty = true`.
  - If the key is unknown, do nothing.
- **`setMode`:** `store.setModeOverride(key, mode)`, then re-read overrides and set
  `judgeDirty`.
- **`setTravel`:** `store.setTravel(placeKey, minutes)`, then
  `travel = store.readTravel()` and set `judgeDirty`.
- **`runTestAlert`:** `this.runTestAlert()`.
- After any action, call `tick()` straight away, so the screen answers the click in
  the same frame.

**`runTestAlert()`:**
- `const t = testAlert(now)`.
- `test = {judged: t.judged, timing: t.timing, alertState: emptyAlertState()}`. This
  replaces any test already running.
- `tick()`.

**`onStoreChange()`:** if not destroyed, `loadInputs()`.
**`onFeedUpdate()`:** `judgeDirty = true`.
**`onResume()`:** `feed.refresh('resume')`, then `tick()`.

**`destroy()`.** A second call does nothing.
1. Set `destroyed = true`.
2. If `feed` exists, compute
   `clocks = clocksToPersist({snapshot: feed.snapshot, acceptedAt: feed.acceptedAt, syncedAt: feed.syncedAt, seeds, enabledAt})`
   in a try/catch. **Read before the feed is destroyed.**
3. Then call each of these in its own try/catch, which logs
   `payattention: destroy-failed <part>`:
   1. `ticker.destroy()`
   2. `ui.destroy()` — this releases the grab
   3. `feed.destroy()`
   4. `environment.destroy()`
   5. `store.writeHealthClocks(clocks)` — only if `clocks` was computed
   6. `store.destroy()` — this flushes the alert state
4. Null every reference.

### `extension/shell/store.js`

```js
export class Store {
  /** @param {Gio.Settings} settings  @param {() => void} onChange  (never called for INTERNAL_KEYS) */
  constructor(settings, onChange)
  // …exactly the StorePort methods above…
}
```

- **Signals:** connect with
  `settings.connectObject('changed', (_s, key) => { if (!INTERNAL_KEYS.includes(key)) onChange(); }, this)`.
- **`readSettings()`** builds a plain object from `SETTINGS_KEYS`: `int` →
  `get_int`, `bool` → `get_boolean`, `strv` → `get_strv`.
- **`readOverrides()`** →
  `{verdict: get_value('verdict-overrides').recursiveUnpack(), mode: get_value('mode-overrides').recursiveUnpack()}`.
  **`readTravel()`** → `get_value('travel-times').recursiveUnpack()`.
- **`readAlertState()`**:
  - `text = get_string('alert-state')` and `state = parseAlertState(text)`.
  - If `text !== ''` and `serializeAlertState(state) !== text`, log
    `payattention: alert-state-corrupt` once. That covers corrupt and partly
    dropped values.
  - Set `lastWritten = text`, and return `state`.
- **`readHealthSeeds()`**:
  - `dataAt` = `get_int64('health-data-at')`, with 0 → null.
  - `providerAt` = `get_int64('health-provider-at')`, with 0 → null.
- **`writeHealthClocks({dataAt, providerAt})`**:
  `set_int64('health-data-at', dataAt)` and `set_int64('health-provider-at', providerAt)`,
  written at once. Called only from `Controller.destroy()`, so there is one write
  per `disable()` and never one per tick (`data.md`).
- **Dictionary writes** (`setVerdictOverride`, `setModeOverride`, `setTravel`):
  - Copy the unpacked dictionary, then set the key, or delete it for null.
  - Write `set_value(key, new GLib.Variant('a{ss}' | 'a{si}', dict))`.
  - Write nothing when nothing changed.
- **`writeAlertState(state)`**:
  - Keep `pending = serializeAlertState(state)`.
  - If no flush is scheduled, schedule one with
    `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, flush)`.
  - `flush`:
    - `set_string('alert-state', pending)`, only if it differs from `lastWritten`
      (then update `lastWritten`);
    - clear `pending` and zero the source id;
    - return `GLib.SOURCE_REMOVE`.
- **`pruneOccurrenceOverrides(now)`**: remove every key with
  `isExpiredOccurrenceKey(key, now)` from `verdict-overrides` and `mode-overrides`.
- **`destroy()`**:
  - `GLib.Source.remove` the flush source, if it is set;
  - flush synchronously;
  - `settings.disconnectObject(this)`.

### `extension/shell/calendarFeed.js`

```js
export class CalendarFeed {
  /** Spawns the helper immediately. @param {{argv: string[], onUpdate: () => void, now: () => number}} p */
  constructor({ argv, onUpdate, now })
  get snapshot()      // last accepted snapshot, or null
  get acceptedAt()    // now() when it was accepted, or null
  get syncedAt()      // ReadonlyMap uid → last in-sync time; kept across helper restarts
  refresh(reason)     // writes formatShellMessage({type:'refresh', reason}) if a helper is running; otherwise no-op
  destroy()
}
```

**Spawning (`_spawn()`):**
- Create a new `Gio.Cancellable`.
- `proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE)`.
  Stderr is inherited, so the helper's `payattention-helper: <code>` lines reach
  the journal.
- `spawnedAt = now()`.
- `reader = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe(), close_base_stream: true})`.
- Start `_readNext()` and `proc.wait_async(cancellable, onExit)`.

If the spawn throws, log `payattention: helper-spawn-failed` and schedule a restart
as if the helper had run for 0 ms.

**`_readNext()`:** `reader.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, cb)`. In `cb`:
- `[line] = reader.read_line_finish_utf8(res)`. On a cancellation error, return silently.
- `line === null` is EOF: stop reading. `onExit` handles the restart.
- Otherwise handle the line, then call `_readNext()` again.

**Handling a line:** `r = parseHelperLine(line)`.
- `!r.ok && r.code === 'protocol-mismatch'`:
  - log `payattention: protocol-mismatch (want ${PROTOCOL_VERSION})`;
  - `proc.force_exit()`, and set `stopped = true` (no restart).
  - The data clock then expires, and the warning shows.
- `!r.ok` otherwise:
  - warn once per code per helper run: `payattention: invalid-line <code>[ <field>]`;
  - drop the line.
  - `field` is a path, never content.
- `message.type === 'snapshot'`:
  - if `isAcceptedSnapshot(message)`:
    - `t = now()`
    - replace `snapshot`
    - `acceptedAt = t`
    - `syncedAt = recordSync(syncedAt, message, t)`
    - `onUpdate()`
  - Otherwise keep the previous `snapshot`, `acceptedAt` and `syncedAt`.
  - **Never** filter or edit events.
- `message.type === 'status'`: warn once per distinct `code` per helper run:
  `payattention: helper-status <level> <code>`. `sync-failed` is diagnostic only
  (addendum): log it, never use it for health.
- `hello`: nothing.

**`onExit`:**
- If cancelled or `stopped`, return.
- Log `payattention: helper-exited <exit status or signal>`.
- `delay = nextRestartDelayMs(previousDelay, now() − spawnedAt)`; `previousDelay = delay`.
- `restartSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => { restartSourceId = 0; _spawn(); return GLib.SOURCE_REMOVE; })`.

`syncedAt` is **not** cleared on restart. That is the addendum's "across helper restarts".

**`refresh`:**
`proc.get_stdin_pipe().write_bytes_async(new GLib.Bytes(new TextEncoder().encode(formatShellMessage({type: 'refresh', reason}))), GLib.PRIORITY_DEFAULT, cancellable, cb)`.
`cb` calls `write_bytes_finish` in a try/catch and ignores errors.

**`destroy()`:**
- `stopped = true`;
- remove `restartSourceId`;
- `cancellable.cancel()`;
- `proc?.force_exit()`, which sends SIGTERM and does not wait (`interfaces.md` §1);
- null everything.

### `extension/shell/environment.js`

```js
export const ACTIVE_IDLE_MS = 60_000;   // constraints.md
export class Environment {
  /** @param {{onResume: () => void}} p */
  constructor({ onResume })
  isUserActive(): boolean     // global.backend.get_core_idle_monitor().get_idletime() < ACTIVE_IDLE_MS
  destroy()
}
```

- The constructor connects
  `LoginManager.getLoginManager().connectObject('prepare-for-sleep', (_lm, aboutToSuspend) => { if (!aboutToSuspend) onResume(); }, this)`.
- It imports `resource:///org/gnome/shell/misc/loginManager.js`.
- `destroy()` calls `disconnectObject(this)`.

### `extension/shell/ticker.js`

```js
export class Ticker {
  /** @param {number} intervalMs @param {() => void} onTick */
  constructor(intervalMs, onTick)   // GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => { onTick(); return GLib.SOURCE_CONTINUE; })
  destroy()                         // GLib.Source.remove(id) once; idempotent
}
```

### `extension/shell/launcher.js`

```js
/** Opens uri with the default handler; onDone(true) on success, onDone(false) on failure (logs payattention: join-failed). */
export function launchUri(uri, onDone)
```

- Call `Gio.AppInfo.launch_default_for_uri_async(uri, global.create_app_launch_context(0, -1), null, cb)`.
- Finish with `launch_default_for_uri_finish`, in a try/catch.
- Never log the URI.

### `extension/ui/ui.js`

```js
export class Ui {
  /** Adds the indicator to the panel. No other actors until render(). */
  constructor({ dispatch, openPreferences })
  render(view)             // idempotent: the same view twice changes nothing
  playAlertSound()         // global.display.get_sound_player().play_from_theme('alarm-clock-elapsed', 'payAttention alert', null)
  releaseTakeover()        // pops the grab and destroys the takeover actors; safe to call any time
  destroy()                // releaseTakeover, destroy card, stop pulse, re-enable unredirect if disabled, disconnect, destroy indicator
}
```

`ui/` imports nothing from `core/`. Every string arrives resolved in the `View`.

**`render(view)`:**
1. `indicator.update(view.indicator, view.menu)`.
2. `a = view.alert`, then one of three cases:
   - `a === null` → destroy the card; `takeover.hide()`.
   - `a.presentation === 'takeover'`:
     - destroy the card;
     - if the menu is open, `indicator.menu.close(BoxPointer.PopupAnimation.NONE)`;
     - `takeover.show(a, dispatch)`.
   - card:
     - `takeover.hide()`;
     - if there is no card, or `card.key`, `card.step` or `card.isTest` differs
       from `a`, destroy the old card and create `new Card(a, dispatch)`;
     - otherwise `card.update(a)`.
3. **Pulse.** It is needed when the card is at step 3 or `view.indicator.flashing`.
   - Needed, with no pulse source yet: start one with
     `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, …)`. It toggles the style class
     `payattention-pulse-on` on the card root and on the indicator box.
   - Not needed: remove the source and remove the class.
   - This is a display-only timer, which `boundaries.md` allows.
4. **Unredirect.**
   - When the first card appears, call `global.compositor.disable_unredirect()`
     once. When the card goes, call `enable_unredirect()` once.
   - This lets cards draw over direct-scanout full-screen windows. `pushModal` does
     the same for the takeover.

Connect `Main.layoutManager.connectObject('monitors-changed', …, this)`. The handler
destroys the card (the next tick recreates it on the right monitor) and calls
`takeover.relayout()`.

### `extension/ui/alertContent.js`

```js
/** Builds the content shared by a card and each takeover panel. */
export class AlertContent {
  constructor(alert, dispatch, size /* 'card' | 'takeover' */)
  get actor()          // St.BoxLayout, vertical
  update(alert)        // sets label text only where it changed
  destroy()
}
```

**Children, in order.** All are `St.Label` with plain text. Never use `use_markup` or
`set_markup`.
1. headline (`payattention-headline`)
2. title (`payattention-title`, `line_wrap` true)
3. countdown (`payattention-countdown`) and caption (`payattention-caption`) — takeover only
4. `timeLine` (`payattention-time`)
5. reason (`payattention-reason`)
6. **Travel row**, only when `alert.travel`:
   - If `travel.choices.length > 0`: a link-style `St.Button` labelled
     `` `${travel.text} · change` `` (`payattention-travel-toggle`).
   - Clicking it toggles a hidden row of `St.Button`s, one per choice, labelled
     `` `${m} min` ``. The current value gets the class `payattention-choice-current`.
   - Clicking a choice dispatches `{type: 'setTravel', placeKey, minutes}`.
   - Whether the row is open is kept on the instance.
   - When `choices` is empty: a plain label with `travel.text` only.
7. One `payattention-also` label per `also` entry.
8. **Action rows** (`St.BoxLayout`, `payattention-actions`):
   - **Row 1:** `Join` (only if `canJoin`, class `payattention-button-primary`),
     `I'm on it` (primary when there is no Join), `Snooze`.
   - **Row 2:** `Skip this one`, `Not important`, and `Not important: whole series`
     (only if `offerSeries`).

**Buttons:**
- `St.Button({label, style_class: 'payattention-button', can_focus: true, reactive: false})`.
- Names: `payattention-action-join`, `-ack`, `-snooze`, `-skip`, `-ignore`, `-ignore-series`.
- Clicks dispatch:
  - `{type: 'join'|'ack'|'snooze'|'skip', key}`
  - `{type: 'setVerdict', key, verdict: 'ignore', scope: 'occ'|'series'}`

**Arming.** The constructor starts `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, …)`.
When it fires, it sets `reactive = true` on every button, so a click already under way
when the alert appears cannot choose an action. `destroy()` removes the source.

### `extension/ui/card.js`

```js
export class Card {
  constructor(alert, dispatch)   // key/step/isTest fixed for its lifetime
  get key(); get step(); get isTest();
  update(alert)
  destroy()
}
```

- **Root:** `St.BoxLayout({name: 'payattention-card', style_class: 'payattention-card payattention-card-step' + step, reactive: true, vertical: true})`,
  containing `AlertContent(alert, dispatch, 'card')`.
- **Adding it:** `Main.layoutManager.addChrome(root)`. It stays above normal and
  full-screen windows, is not tied to full-screen, and gets an input region.
- **Monitor:** `monitorIndex = global.display.get_current_monitor()`, taken once.
- **Placement.** `_place()` runs on the root's `notify::size` and after construction,
  with `wa = Main.layoutManager.getWorkAreaForMonitor(monitorIndex)`:
  - steps 1–2: `x = wa.x + wa.width − root.width − 24`, `y = wa.y + 24`;
  - step 3: `x = wa.x + (wa.width − root.width) / 2`, `y = wa.y + (wa.height − root.height) / 2`.

  Round both to integers.
- **Focus:** never grab key focus.
- **`destroy()`:** `root.destroy()`, which also untracks the chrome.

### `extension/ui/takeover.js`

```js
export class Takeover {
  constructor()                  // connects nothing, creates no actors
  get isShown(): boolean
  show(alert, dispatch)          // build if needed, (re)take grab if not held, update text on every panel
  relayout()                     // rebuild panels for the current monitors, keeping root and grab
  hide()                         // pop grab (try/catch, log), destroy root; idempotent
  destroy()                      // hide()
}
```

**Build:**
- `root = new St.Widget({name: 'payattention-takeover', style_class: 'payattention-takeover', reactive: true, constraints: new Clutter.BindConstraint({source: global.stage, coordinate: Clutter.BindCoordinate.ALL})})`.
- `Main.layoutManager.modalDialogGroup.add_child(root)`.
- For each index `i` of `Main.layoutManager.monitors`, one panel:
  - `St.BoxLayout({name: 'payattention-takeover-monitor-' + i, style_class: 'payattention-takeover-panel', vertical: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER})`;
  - with `panel.add_constraint(new Layout.MonitorConstraint({index: i}))`;
  - containing `AlertContent(alert, dispatch, 'takeover')`.
  - Import `resource:///org/gnome/shell/ui/layout.js`.
- Connect the root's `key-press-event`:
  - `Tab` → `root.navigate_focus(global.stage.key_focus, St.DirectionType.TAB_FORWARD, true)`;
  - `ISO_Left_Tab` → `TAB_BACKWARD`;
  - return `Clutter.EVENT_STOP` for every key.

  So Escape does nothing, and Enter does nothing until the owner has tabbed to a
  button. There is no initial button focus, so a keystroke already under way cannot
  choose an action.

**Grab.** This is the last step of `show()`, and happens only after every actor is built.
- If `grab` is null:
  `try { grab = Main.pushModal(root, {actionMode: Shell.ActionMode.SYSTEM_MODAL}); }`.
- On `catch`: log `payattention: grab-failed` and leave `grab` null. The overlays
  still show, and the next `show()` (on the next tick) retries (ADR-0004).
- If building throws partway, `show()` calls `hide()` and rethrows.

**`hide()`:**
1. `if (grab) { try { Main.popModal(grab) } catch (e) { log } grab = null }`.
2. `root?.destroy()`, then `root = null`.

The pop comes before the destroy. Neither may be skipped.

### `extension/ui/indicator.js`

```js
export const Indicator = GObject.registerClass({ GTypeName: 'PayAttentionIndicator' },
class Indicator extends PanelMenu.Button {
  _init({ dispatch, openPreferences })   // super._init(0.5, 'payAttention', false); name 'payattention-indicator'
  update(indicatorView, menuView)
});
```

**Panel box.** An `St.BoxLayout` (`payattention-indicator-box`) holding:
- `St.Icon({icon_name: 'alarm-symbolic', style_class: 'system-status-icon'})`;
- a warning `St.Icon({icon_name: 'dialog-warning-symbolic', style_class: 'system-status-icon payattention-warning'})`,
  visible only when `warning`;
- an `St.Label` (`y_align` CENTER, `clutter_text.ellipsize = END`), named
  `payattention-indicator-label`, visible only when `text !== null`.

The class `payattention-indicator-highlight` is on the box while `highlighted`.

**Menu:**
- Set `this.menu.actor.name = 'payattention-menu'`.
- A status item: `PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false})`.
  - Its `label.name = 'payattention-menu-status'`.
  - It is visible only when `status !== null`, and its text is `status`.
- A `PopupMenuSection` for meetings, then a `PopupSeparatorMenuItem`.
- `Test alert` → `dispatch({type: 'runTestAlert'})`.
- `Settings` → `openPreferences()`.

The meetings section is rebuilt (`removeAll()`, then add again) only when
`menuView.signature` changes.

**Each row** is a `PopupSubMenuMenuItem(row.label)`. Add `row.detail` to the item's
box as a second `St.Label` (`payattention-row-detail`). The submenu holds:
1. An insensitive `PopupMenuItem(row.reason)`.
2. `PopupSwitchMenuItem('Must attend', row.isMust)`. Its `toggled(_, state)`
   dispatches `setVerdict(key, state ? 'must' : 'ignore', 'occ')`.
3. If recurring: `PopupMenuItem('Apply to whole series')`, which dispatches
   `setVerdict(key, row.isMust ? 'must' : 'ignore', 'series')`.
4. If overridden: `PopupMenuItem('Back to automatic')`, which dispatches
   `setVerdict(key, null, 'occ')`, and also `setVerdict(key, null, 'series')` if
   the meeting recurs.
5. `PopupMenuItem(row.modeSwitchLabel)`, which dispatches `setMode(key, row.otherMode)`.
6. If `row.travel`:
   - an insensitive `PopupMenuItem(row.travel.header)`;
   - then one `PopupMenuItem(`${m} min`)` per entry of `row.travel.choices`, with
     `setOrnament(PopupMenu.Ornament.CHECK)` on the current value and `NO_DOT` on the rest;
   - each dispatches `setTravel(row.travel.placeKey, m)`.

`Ui` adds the indicator with `Main.panel.addToStatusArea('payattention', indicator, 0, 'right')`.

### `extension/extension.js`

```js
const HELPER_ENTRY = 'main.js';   // addendum item 1; module scope holds only imports and this constant

export default class PayAttentionExtension extends Extension {
  enable()          // builds one Controller; see below
  disable()         // this._controller?.destroy(); this._controller = null; this._settings = null;
  runTestAlert()    // this._controller?.runTestAlert()   (interfaces.md §4; menu + smoke)
}
```

`enable()`:

```js
this._settings = this.getSettings();
const helperPath = `${this.path}/helper/${HELPER_ENTRY}`;   // no GLib import: extension.js imports shell/, ui/, Extension only
this._controller = new Controller({
    createStore: onChange => new Store(this._settings, onChange),
    createFeed: onUpdate => new CalendarFeed({ argv: ['gjs', '-m', helperPath], onUpdate, now: () => Date.now() }),
    createEnvironment: onResume => new Environment({ onResume }),
    createUi: dispatch => new Ui({ dispatch, openPreferences: () => this.openPreferences() }),
    createTicker: onTick => new Ticker(1000, onTick),
    launchUri,
    now: () => Date.now(),
});
```

Nothing else goes in `enable()`.

## GSettings schema (`extension/schemas/org.gnome.shell.extensions.payattention.gschema.xml`)

- **Schema:** `id="org.gnome.shell.extensions.payattention"`, `path="/org/gnome/shell/extensions/payattention/"`.
- **Summaries:** every key gets a `<summary>` in plain English, taken from the
  "Meaning" column of `data.md`.
- **Ranges:** every `i` key gets a `<range>`.

This table is `data.md` exactly. It now includes `extra-owner-addresses`, the
D-008 in-person values, and the two `health-*` keys.

| Key | Type | Default | Range |
|---|---|---|---|
| `online-headsup-minutes` | i | 30 | 1–240 |
| `online-nudge-minutes` | i | 10 | 0–120 |
| `online-insist-minutes` | i | 3 | 0–60 |
| `online-takeover-minutes` | i | 1 | 0–30 |
| `inperson-headsup-minutes` | i | 10 | 1–240 |
| `inperson-nudge-minutes` | i | 5 | 0–120 |
| `inperson-insist-minutes` | i | 2 | 0–60 |
| `inperson-takeover-minutes` | i | 0 | 0–30 |
| `default-travel-minutes` | i | 30 | 0–240 |
| `headsup-display-seconds` | i | 15 | 5–120 |
| `snooze-minutes` | i | 2 | 1–30 |
| `takeover-snooze-minutes` | i | 1 | 1–10 |
| `cutoff-minutes` | i | 10 | 0–60 |
| `large-meeting-size` | i | 15 | 2–500 |
| `extra-important-words` | as | `[]` | — |
| `extra-ignore-words` | as | `[]` | — |
| `owner-domains` | as | `[]` | — |
| `extra-owner-addresses` | as | `[]` | — |
| `sound-enabled` | b | `true` | — |
| `verdict-overrides` | a{ss} | `{}` | — |
| `mode-overrides` | a{ss} | `{}` | — |
| `travel-times` | a{si} | `{}` | — |
| `alert-state` | s | `''` | — |
| `health-data-at` | x | `0` | — |
| `health-provider-at` | x | `0` | — |

`extension/metadata.json` has exactly these keys:
- `"uuid": "payattention@tonymalandain.github.io"`
- `"name": "payAttention"`
- `"description": "Makes sure you do not miss the meetings that matter: judges each meeting, escalates to a full-screen alert on every monitor, and never relies on notifications."`
- `"shell-version": ["50"]`
- `"settings-schema": "org.gnome.shell.extensions.payattention"`

There is no `session-modes` key (ADR-0005) and no `url` key.

## Visual design (`extension/stylesheet.css`)

These are the cards' own classes, distinct from GNOME's `.notification-banner`.
They must never reuse shell notification classes. The values are fixed:

```css
.payattention-card { border-radius: 18px; padding: 20px 24px; spacing: 10px; color: #ffffff;
  box-shadow: 0 8px 28px rgba(0,0,0,0.55); transition-duration: 500ms; }
.payattention-card-step1 { width: 380px; background-color: #17324d; border: 2px solid #5fa8e8; }
.payattention-card-step2 { width: 460px; background-color: #4a3000; border: 3px solid #ffb020; }
.payattention-card-step3 { width: 640px; background-color: #5c0a0a; border: 4px solid #ff3b30; }
.payattention-card-step3.payattention-pulse-on { border-color: #ffd0cc; background-color: #7a1010; }
.payattention-headline { font-size: 11pt; font-weight: bold; letter-spacing: 1px; color: rgba(255,255,255,0.8); }
.payattention-card-step1 .payattention-title { font-size: 15pt; font-weight: bold; }
.payattention-card-step2 .payattention-title { font-size: 18pt; font-weight: bold; }
.payattention-card-step3 .payattention-title { font-size: 26pt; font-weight: 800; }
.payattention-time, .payattention-reason, .payattention-also { font-size: 11pt; }
.payattention-actions { spacing: 10px; }
.payattention-button { min-height: 44px; padding: 10px 20px; border-radius: 12px; font-size: 13pt;
  font-weight: bold; color: #ffffff; background-color: rgba(255,255,255,0.16); }
.payattention-button:hover, .payattention-button:focus { background-color: rgba(255,255,255,0.30); }
.payattention-button-primary { background-color: #ffffff; color: #111111; }
.payattention-button-primary:hover, .payattention-button-primary:focus { background-color: #e6e6e6; }
.payattention-travel-toggle { font-size: 11pt; text-decoration: underline; color: #ffd98a; }
.payattention-choice-current { background-color: #ffb020; color: #111111; }
.payattention-takeover { background-color: rgba(0,0,0,0.0); }
.payattention-takeover-panel { background-color: rgba(80,0,0,0.96); spacing: 18px; padding: 48px; color: #ffffff; }
.payattention-takeover-panel .payattention-headline { font-size: 20pt; }
.payattention-takeover-panel .payattention-title { font-size: 40pt; font-weight: 800; text-align: center; }
.payattention-countdown { font-size: 110pt; font-weight: 800; font-feature-settings: "tnum"; }
.payattention-caption { font-size: 16pt; color: rgba(255,255,255,0.85); }
.payattention-takeover-panel .payattention-time, .payattention-takeover-panel .payattention-reason { font-size: 16pt; }
.payattention-takeover-panel .payattention-button { min-height: 64px; min-width: 200px; font-size: 18pt; padding: 16px 32px; }
.payattention-indicator-highlight { background-color: rgba(255,176,32,0.35); border-radius: 99px; }
.payattention-indicator-box.payattention-pulse-on { background-color: rgba(255,59,48,0.65); }
.payattention-warning { color: #ffb020; }
.payattention-row-detail { font-size: 9pt; color: rgba(255,255,255,0.6); padding-left: 12px; }
```

## Steps

- Step 1 is a tooling repair that makes lint match `boundaries.md`.
- Pure modules are then built test-first under Node, following PG-1a's test style:
  `node:test` with `describe`/`test`, `node:assert/strict`, and builders from
  `tests/unit/support/builders.js` (`event`, `snapshot`, `SOURCE`, `judged`,
  `judgeOne`, `TIMING`, `ENV`, `T0`, `MIN`, `HOUR`).
- Shell and UI actors are built against the smoke test, which is written before them.

### Step 0 — Check the ground  [check, no code]
- `git log --oneline` shows `9d9a657` (PG-1a) and `cf070ed` (PG-1b).
- `npm ci && npm run lint && npm test && npm run test:helper` pass.
- If any fails, **stop** and report it. Do not start on a red base.

### Step 1 — Lint matches `boundaries.md`  [repair: tooling, no product behaviour]
- **Test first**, in `tests/unit/boundaries.test.js`:
  - Change the case
    `['extension/ui/probe.js', "import {f} from '../core/format.js'; …", 'ok']` to
    `'../core/display.js'` (still `'ok'`).
  - Add `['extension/ui/probe.js', "import {f} from '../core/format.js'; export {f};", 'error']`.
  - Add `import System from 'system'; export {System};` expecting `'error'` for
    `extension/shell/probe.js`, `extension/ui/probe.js`, `extension/extension.js`
    and `extension/prefs.js`.
  - Keep the existing `'ok'` case for `extension/helper/probe.js`.
  - Run `npm test`: the new `'error'` cases and the `display.js` case fail. That
    proves they test the rule.
- **Then**, in `eslint.config.js`:
  - add `const NO_SYSTEM = { regex: '^system$', message: 'only the helper may import system: System.exit would end the session (boundaries.md)' };`;
  - add `NO_SYSTEM` to the `patterns` of the `shell/`, `ui/`, `extension.js` and
    `prefs.js` blocks;
  - in the `ui/` block, change `(?!format\\.js$)` to `(?!display\\.js$)`, and the
    message to `'ui/ may import only display helpers (core/display.js)'`;
  - add `'.smoke-home/**'` to `ignores`.
- **Why here:** lint is how `boundaries.md` is enforced. This is addendum item 7,
  plus the file name that `boundaries.md` and `interfaces.md` §3 use.
- **Behaviour change:** none in the product. Lint only.

### Step 2 — Display helpers  [feature]
- **Test first:** `tests/unit/display.test.js`, with one test per bullet of the
  `core/display.js` behaviour list. It sets `process.env.TZ = 'UTC'` before a
  dynamic `await import(...)` of the module. It fails with "module not found".
- **Then:**
  - write `extension/core/display.js` exactly as specified;
  - add an import of `formatClock` and `formatSince` from `display.js` to
    `tests/unit/support/gjs-core-check.js`, plus one `check(typeof formatSince(0, 0) === 'string', 'display runs')`
    line, so the gjs run proves `Intl` works there. It was verified by hand:
    gjs 1.88 formats `{weekday:'short', …}`.
- **Why here:** pure formatting, shared by `shell/view.js` and `prefs.js`.
- **Behaviour change:** none visible yet.

### Step 3 — Freshness, restart delay, sound edge  [feature]
- **Test first:** `tests/unit/health.test.js`, `tests/unit/backoff.test.js`,
  `tests/unit/soundCue.test.js`.
  - Health: sources are built from `SOURCE` with the `remote` and `connection`
    fields set explicitly.
    - **Accepted snapshots:** `isAcceptedSnapshot` is true with no sources, true
      with one ok and one failing, and false with all failing.
    - **`isInSync`:** true only for `ok && remote === true && connection === 'connected'`.
      Each of `'connecting'`, `'offline'`, `'unknown'` and `null` gives false.
    - **`recordSync`:** adds in-sync uids only, keeps old entries, and does not
      mutate its input.
    - **Grace:** no snapshot, `now = enabledAt + 59 s`, old seeds → `waiting`.
      At `enabledAt + 60 s` → `stale`, generic (`calendars: []`), with
      `since = seeds.dataAt`. This is the addendum's "seeds from a previous run
      make it stale after the grace".
    - **No seeds:** no snapshot, `enabledAt + 14 min` → `waiting`; at 15 min →
      `stale` with `since = enabledAt`.
    - **Provider stale while snapshots are fresh** (addendum test):
      - Snapshots are accepted every 5 min.
      - Source `Work` is connected; source `Personal` has `connection: 'offline'`.
      - At `enabledAt + 15 min`: `{state:'stale', since: enabledAt, calendars:['Personal']}`.
    - **Local sources never count:** a source with `remote:false` that is never in
      sync never makes it stale.
    - **Failed sources count:** a source with `ok:false` (so `remote: null`) makes it
      stale after 15 min, and is named.
    - **An absent `remote` counts** like `null`.
    - **`since` is the older expired clock:** data expired and provider expired, with
      the provider older → `since` = the provider time, `calendars: []`.
    - **Recovery:** fresh data and all sources in sync → `ok`.
    - **Two stale sources with the same name** → the name is listed once.
    - **`clocksToPersist`**: one test each for a snapshot with relevant sources,
      a snapshot with only local sources (`providerAt: 0`), and no snapshot
      (carries `seeds.providerAt ?? 0`, and `dataAt = seeds.dataAt ?? enabledAt`).
  - Backoff: the sequence 1 s, 2 s, 4 s, … is capped at 300 s, and resets after a
    10-minute run.
  - Sound:
    - null → step 3: true;
    - same key and step: false;
    - step 3 → step 4: true;
    - step 4 → hidden → step 4: true;
    - step 2: false;
    - a different key at step 3: true.
- **Then:** `extension/shell/health.js`, `backoff.js` and `soundCue.js`, as specified.
  No `gi://` imports.
- **Behaviour change:** none visible yet.

### Step 4 — Settings keys, schema, metadata  [feature]
- **Test first:** `tests/unit/schema.test.js` (Node). `data.md` requires this test:
  "a unit test keeps the two equal".
  - It reads
    `extension/schemas/org.gnome.shell.extensions.payattention.gschema.xml` as
    text and extracts every `<key name type>` with its `<default>` and `<range>`,
    using regular expressions.
  - For each `SETTINGS_KEYS` entry:
    - a key with that name exists;
    - its type is `i`, `b` or `as` for `int`, `bool` or `strv`;
    - its default equals `DEFAULT_SETTINGS[field]` (`[]` → empty array,
      `true`/`false`, integers).
  - Every `i` key has a range equal to the table above (the test holds that table
    as a constant) and containing its default.
  - The internal keys `verdict-overrides a{ss} {}`, `mode-overrides a{ss} {}`,
    `travel-times a{si} {}`, `alert-state s ''`, `health-data-at x 0` and
    `health-provider-at x 0` exist.
  - There are no other keys.
  - `SETTINGS_KEYS` maps `inpersonTakeoverMinutes` → `inperson-takeover-minutes`,
    and `extraOwnerAddresses` → `extra-owner-addresses` with kind `strv`.
  - `INTERNAL_KEYS` is exactly the three internal names.
  - It fails first with "no such file".
- **Then:**
  - `extension/shell/settingsKeys.js`;
  - the schema XML, exactly per the table;
  - `extension/metadata.json`.
- **Check:**
  - `glib-compile-schemas --strict --dry-run extension/schemas` passes.
  - Then
    `glib-compile-schemas --targetdir=.smoke-home/schemas extension/schemas && GSETTINGS_SCHEMA_DIR=.smoke-home/schemas gsettings list-recursively org.gnome.shell.extensions.payattention`
    shows `inperson-insist-minutes 2`, `inperson-takeover-minutes 0` and
    `health-data-at int64 0`.
- **Behaviour change:** none visible yet.

### Step 5 — The display model  [feature]
- **Test first:** `tests/unit/view.test.js`.
  - Set `process.env.TZ = 'UTC'` before a dynamic import.
  - Build judged objects with `judgeOne`/`judged` from `builders.js`, so the shapes
    are real.
  - Build plans by calling core's `plan` with `TIMING`, `ENV` and `emptyAlertState()`
    at chosen times. Never hand-write a Plan.
  - One test per rule in the `view.js` section:
    - the test alert takes precedence (use `testAlert(T0)`);
    - takeover versus card;
    - travel only for in-person at steps 1–2, with `choices` empty when `placeKey`
      is null;
    - `canJoin`;
    - `offerSeries` is false for the test;
    - the "also" text;
    - the indicator text; `highlighted` while hidden but active; `flashing` only
      for a step-3 card;
    - `warning` when stale;
    - the today filter: a meeting at 13:00 today is listed; one that ended before
      now and one tomorrow at 09:00 are not; an all-day row is labelled `All day`;
    - judge order is kept;
    - every status string:
      - `waiting`;
      - `stale` generic;
      - `stale` with one name (`'Work calendar not updating since 10:42. Alerts may be missing.'`,
        with `since` at 10:42 UTC on the same day as `now`);
      - `stale` with two names;
      - `stale` with five names (`', and 2 more'`);
      - `stale` with `since` yesterday (it uses `formatSince`'s weekday form);
      - `ok` with no rows;
      - `ok` with rows (null);
    - while stale, the rows are still present;
    - the signature changes when a verdict changes, and stays the same when only
      `now` moves by 1 s.
- **Then:** `extension/shell/view.js`.
- **Behaviour change:** none visible yet.

### Step 6 — The controller  [feature]
- **Test first:** `tests/unit/controller.test.js`, with fakes for every port:
  - **Fake store:** backed by plain objects, starting from `DEFAULT_SETTINGS`. It
    records calls, and returns settable `seeds`.
  - **Fake feed:** settable `snapshot`, `acceptedAt` and `syncedAt`, and a
    `refresh` spy. Its test helper `deliver(snap)` sets
    `snapshot = snap; acceptedAt = now; syncedAt = recordSync(syncedAt, snap, now)`,
    using the real `recordSync`, and then calls `onUpdate`.
  - **Fake environment:** a settable `active`.
  - **Fake UI:** records `render` views, counts
    `playAlertSound`/`releaseTakeover`/`destroy`, and can be told to throw.
  - **Fake ticker:** exposes `fire()`.
  - **Fake `launchUri`:** stores `onDone`.
  - **`now`:** read from a variable.

  The default snapshot:
  - one source, `{...SOURCE, remote: true, connection: 'connected'}`;
  - one must-attend online meeting: the title contains `client`, the owner is the
    organiser, and there are 2 other guests;
  - a Meet link in `conferenceUris`, so `joinUrl` is not null;
  - the start is `T0`.

  Tests, one each:
  1. Construction renders once, with `menu.status === 'Reading calendars…'` and no
     alert, and creates the ticker.
  2. `deliver`, then a tick 25 min before the start: `alert.step === 1`,
     `presentation === 'card'`, and the indicator text starts with the title.
  3. 30 s before the start: `presentation === 'takeover'`, step 4.
  4. `ack`: the next render has `alert === null`, and `writeAlertState` was called
     with that key `done: 'ack'`.
  5. `snooze` at step 4: the alert is null. After `now += 60 s + 1 s`, it is back.
     `snooze` at step 2, 1 min before the step-3 time: it comes back at the step-3
     time, not after 2 min. This proves the controller uses the plan's snooze end.
  6. `join`:
     - `launchUri` is called with the join URL;
     - nothing is acknowledged until `onDone(true)`;
     - `onDone(false)` leaves the alert up;
     - `onDone(true)` after the primary has changed still acknowledges the joined
       key (the card was captured).
  7. `setVerdict` with scope `occ` writes the occurrence key, and with scope `series`
     writes `seriesKey`. `null` is passed through.
  8. `setMode` and `setTravel` reach the store with the given values, and the next
     render reflects the new judge result.
  9. Sound:
     - it plays once when step 3 first shows, and not on the next tick;
     - once more at step 4;
     - never when `soundEnabled` is false.
  10. When `ui.render` throws:
      - `releaseTakeover` is called;
      - `console.error` is called once for two identical consecutive failures (spy
        on it);
      - a later tick renders normally.
  11. `runTestAlert`:
      - `alert.isTest` is true;
      - advancing `now` by 10 s, 20 s and 25 s gives steps 2, 3 and 4;
      - `ack` on the test key never calls `writeAlertState`, and afterwards the
        alert is null;
      - `setVerdict` on the test key ends the test and writes nothing.
  12. Heads-up recording:
      - with step 1 visible and the environment active, `writeAlertState` records
        `headsUpShownAt`;
      - with the environment inactive, nothing is recorded.
  13. `onResume` → `feed.refresh('resume')`.
  14. **Data stale:** no `deliver`, and `now = enabledAt + 15 min` →
      `indicator.warning` is true, and `menu.status` starts with
      `'Calendar not updating since'`.
  15. **Provider stale while snapshots are fresh** (addendum item 5, D-014):
      - The source list is `Work` (connected) and `Personal` (`connection: 'offline'`).
      - `deliver` every 5 min.
      - The meeting starts at `enabledAt + 20 min`.
      - At `enabledAt + 15 min`:
        - `indicator.warning` is true;
        - `menu.status === 'Personal calendar not updating since ' + formatSince(enabledAt, now) + '. Alerts may be missing.'`;
        - the meeting is in `menu.meetings`;
        - `view.alert.step >= 1`: it still alerts.
  16. **Seeds and grace:**
      - The store returns seeds 20 min old.
      - At `enabledAt + 59 s` with no snapshot: `warning` is false and the status
        is `'Reading calendars…'`.
      - At `enabledAt + 60 s`: `warning` is true.
  17. **Persisting the clocks:**
      - After `deliver` at time X, `destroy()` calls
        `writeHealthClocks({dataAt: X, providerAt: X})` **before**
        `store.destroy()` (record the call order).
      - With no `deliver`, it writes `dataAt = seeds.dataAt ?? enabledAt`.
  18. A store change: the fake returns a new verdict override and fires `onChange`,
      and the next render shows the new verdict in `menu.meetings`.
  19. `destroy()`:
      - every part is destroyed, even when `ticker.destroy` throws;
      - `ui.destroy` is still called;
      - a second `destroy()` is a no-op;
      - a `launchUri` `onDone` after destroy does nothing.
  20. A constructor failure (the `createUi` fake throws): the already-built store,
      environment and feed are destroyed, and the error propagates.
- **Then:** `extension/shell/controller.js`, as specified. It imports:
  - `judge`
  - `plan`, `actionFor`
  - `reduce`, `emptyAlertState`
  - `timingFromSettings`
  - `testAlert`
  - `./health.js`, `./view.js`, `./soundCue.js`
- **Why here:** the controller is the orchestrator named in `overview.md`.
- **Behaviour change:** none visible yet.

### Step 7 — Store, with a GJS check  [feature]
- **Test first:** `tests/smoke/store-check.js`, a GJS module that `scripts/smoke.sh`
  runs before the shell.
  - It prints `PAYATTENTION-STORE PASS` or `PAYATTENTION-STORE FAIL <reason>`.
  - It runs with `GSETTINGS_BACKEND=memory` and `GSETTINGS_SCHEMA_DIR` pointing at
    the schemas compiled into the smoke directory.
  - It uses a `GLib.MainLoop` so timers run.

  Checks:
  - `readSettings()` deep-equals `DEFAULT_SETTINGS` (as a plain object).
  - `setVerdictOverride` add, overwrite and delete (null) round-trip.
  - `setTravel` round-trips.
  - Three quick `writeAlertState` calls produce exactly one `changed::alert-state`
    emission, after about 500 ms.
  - `destroy()` with a pending write flushes it synchronously.
  - A corrupt `alert-state` string gives an empty state.
  - `readHealthSeeds()`:
    - on defaults → `{dataAt: null, providerAt: null}`;
    - after `writeHealthClocks({dataAt: 1790000000000, providerAt: 1789999000000})`,
      it returns those numbers exactly (this proves `x` holds epoch ms).
  - `pruneOccurrenceOverrides` removes an `occ:` key 8 days old, keeps one 6 days
    old, and keeps `series:` keys.
  - `onChange` is not called for `alert-state` or the `health-*` keys, but is
    called for `sound-enabled`.
- **Then:** `extension/shell/store.js`.

### Step 8 — Feed, environment, ticker, launcher  [feature]
- **Test:** the smoke test (Step 10) covers these:
  - the fixture calendar's snapshot reaches the indicator;
  - the helper is gone after `disable()`.
  
  The pure decisions in these files (backoff, acceptance, sync recording) were
  tested in Step 3.
- **Then:** `extension/shell/calendarFeed.js`, `environment.js`, `ticker.js` and
  `launcher.js`, exactly as specified.

### Step 9 — Build script and npm scripts  [feature]
- `scripts/build.sh` is bash with `set -euo pipefail`. It runs from the repo root,
  which it resolves from its own path. Steps:
  1. `glib-compile-schemas --strict --dry-run extension/schemas`
  2. `mkdir -p dist`
  3. `gnome-extensions pack extension --extra-source=core --extra-source=helper --extra-source=shell --extra-source=ui --force --out-dir=dist`
  4. `test -f dist/payattention@tonymalandain.github.io.shell-extension.zip`
- `package.json` scripts:
  - **replace** the placeholder `build` and `smoke` scripts with
    `"build": "bash scripts/build.sh"` and `"smoke": "bash scripts/smoke.sh"`;
  - add `"install:local": "bash scripts/install.sh"`.
  - **Never name a script `install`:** npm runs it on `npm install`/`npm ci`.
- `.gitignore`: add `.smoke-home/`. `dist/` and `.test-home/` are already there.
- **Check:** `npm run build` produces the zip. `unzip -l` lists `core/`, `helper/`,
  `shell/`, `ui/`, `schemas/…gschema.xml`, `stylesheet.css`, `metadata.json` and
  `extension.js`. `prefs.js` is listed once it exists (Step 12).

### Step 10 — Smoke test, written before the UI  [feature: the failing test]

The smoke must **never** touch or depend on the owner's real calendars, settings or
session bus. It runs with its own D-Bus session, its own XDG directories, and one
fixture calendar that it writes itself. Several checks prove this.

**`scripts/smoke.sh`** is bash with `set -euo pipefail`. Steps:
1. `ROOT` = the repo root, resolved from the script's path.
   `: "${ROOT:?}"`.
   `T="$ROOT/.smoke-home"`, which is on the home filesystem, never `/tmp`
   (testing-and-build.md, pitfalls).
   `rm -rf "$T"`.
2. `bash "$ROOT/scripts/build.sh"`.
3. **Store check:**
   - `mkdir -p "$T/schemas"`
   - `glib-compile-schemas --targetdir="$T/schemas" "$ROOT/extension/schemas"`
   - `env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 GSETTINGS_SCHEMA_DIR="$T/schemas" GSETTINGS_BACKEND=memory gjs -m "$ROOT/tests/smoke/store-check.js" | tee "$T/store.log"`
   - `grep -q '^PAYATTENTION-STORE PASS' "$T/store.log"`, else exit 1.
4. **Isolated home:**
   - `mkdir -p "$T/data/gnome-shell/extensions" "$T/config/glib-2.0/settings" "$T/config/evolution/sources" "$T/data/evolution/calendar/smoke-cal" "$T/cache"`.
   - `XDG_DATA_HOME="$T/data" gnome-extensions install --force "$ROOT/dist/payattention@tonymalandain.github.io.shell-extension.zip"`.
5. **Fixture calendar.** It follows the pattern `tests/helper/isolatedEds.js`
   verified with a `local` backend. Write
   `$T/config/evolution/sources/smoke-cal.source`:
   ```
   [Data Source]
   DisplayName=Smoke
   Enabled=true
   Parent=local-stub

   [Calendar]
   BackendName=local
   Selected=true

   [Local Backend]
   EmailAddress=owner@smoke.test
   ```
   Then write `$T/data/evolution/calendar/smoke-cal/calendar.ics`:
   - CRLF line endings, built with `printf '%s\r\n' …`.
   - One VEVENT:
     - `UID:smoke-client@smoke.test`
     - `DTSTAMP:20260101T000000Z`
     - `DTSTART` = the next whole UTC hour after now, plus 2 h, as
       `$(date -u -d @$S +%Y%m%dT%H%M%SZ)` with
       `S=$(( ( $(date +%s) / 3600 + 3 ) * 3600 ))`
     - `DTEND` = DTSTART + 30 min
     - `SUMMARY:Smoke client review`
     - `ORGANIZER:mailto:owner@smoke.test`
     - `ATTENDEE;PARTSTAT=ACCEPTED:mailto:owner@smoke.test`
     - `ATTENDEE;PARTSTAT=ACCEPTED:mailto:guest@external.test`
   - It is between 2 h and 3 h ahead. The verdict is must (important word
     "client"), the mode is online, and no real step fires during the run: the
     heads-up is at least 1.5 h away.
6. Write `$T/config/glib-2.0/settings/keyfile`:
   ```
   [org/gnome/shell]
   enabled-extensions=['payattention@tonymalandain.github.io']
   welcome-dialog-last-shown-version='999'

   [org/gnome/desktop/notifications]
   show-banners=false
   ```
   `show-banners=false` is Do Not Disturb, so the smoke also proves R-12.
7. Run the shell with **a minimal environment**. Never spread the caller's
   environment: it carries the real `DBUS_SESSION_BUS_ADDRESS`, `WAYLAND_DISPLAY`
   and `DISPLAY` (the lesson from `isolatedEds.js`).
   ```sh
   env -i PATH="$PATH" HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" LANG=C.UTF-8 \
     XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
     XDG_CONFIG_HOME="$T/config" XDG_DATA_HOME="$T/data" XDG_CACHE_HOME="$T/cache" \
     GSETTINGS_BACKEND=keyfile GIO_USE_VFS=local PAYATTENTION_SMOKE_HOME="$T" \
     timeout 300 dbus-run-session -- gnome-shell --headless \
       --virtual-monitor 1280x720 --virtual-monitor 1024x768 \
       --wayland-display "pa-smoke-$$" \
       --automation-script "$ROOT/tests/smoke/alert-ladder.js" > "$T/shell.log" 2>&1 || true
   ```
   - `XDG_RUNTIME_DIR` is the one real directory passed through. The compositor
     needs it for its Wayland socket, and the verified recipe in
     `testing-and-build.md` used it.
   - `dbus-run-session` gives the shell, the helper and the EDS it activates a
     private bus. The isolated `XDG_*` directories give EDS only the fixture
     calendar, and GOA no accounts.
   - **Pre-decided fallback:** if the shell does not reach check 1 with `env -i`,
     but the same command with the inherited environment does, use
     `env -u DBUS_SESSION_BUS_ADDRESS -u WAYLAND_DISPLAY -u DISPLAY` plus the same
     `XDG_*`, `GSETTINGS_BACKEND`, `GIO_USE_VFS` and `PAYATTENTION_SMOKE_HOME`
     assignments in place of `env -i …`.
     - Record in the report which form was used, and why.
     - Isolation is still proven, by checks 0 and 2 below.
     - No other change to this command is allowed.
8. Print every `PAYATTENTION-` line from `shell.log`.
9. Exit 1 unless `^PAYATTENTION-SMOKE PASS` is present. Also exit 1 if any line
   matches any of:
   - `JS ERROR`
   - `JS WARNING.*payattention`
   - `payattention: (tick-failed|destroy-failed|grab-failed|protocol-mismatch|helper-spawn-failed)`
   - `payattention-helper: (registry-failed|helper-failed)`

   On failure, print the last 80 lines of `shell.log`.

**`tests/smoke/alert-ladder.js`** is an ES module exporting `async function run()`
and `function finish()` (the harness in `ui/scripting.js`).
- It uses `Scripting.sleep` from `resource:///org/gnome/shell/ui/scripting.js`,
  plus `Main`, `St`, `Clutter`, `GLib` and `Gio`.
- The whole body of `run()` is wrapped in a try/catch.
- On any failed check it prints `PAYATTENTION-SMOKE FAIL <check name>: <reason>`
  and returns. At the end it prints `PAYATTENTION-SMOKE PASS`.
- It never prints calendar titles, except the fixture's own title.

Helpers (test code):
- `waitFor(pred, timeoutMs, stepMs = 200)`.
- `findByName(actor, name)`, and `countByPrefix(global.stage, 'payattention')`,
  which is recursive over `get_children()`.
- `helperPids()`: enumerate `/proc`. For each numeric entry, read `cmdline` with
  `GLib.file_get_contents` in a try/catch, turning `\0` into spaces, and match
  `payattention@tonymalandain.github.io/helper/main.js`.
- `clickActor(actor)`:
  - create a virtual pointer with
    `Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE)`;
  - `notify_absolute_motion` to the centre, from `get_transformed_position()` and
    `get_transformed_size()`;
  - sleep 100 ms;
  - `notify_button` pressed, then released, with `Clutter.BUTTON_PRIMARY`.
- `pressKey(keyval)`: a virtual keyboard, with `notify_keyval` pressed and released.
- `ourModalEntries()`: `Main.modalActorFocusStack.filter(r => r.actor?.name?.startsWith('payattention'))`.

Checks, in order. Each has a timeout. On timeout, FAIL with the check name.

0. **Isolation.** `home = GLib.getenv('PAYATTENTION_SMOKE_HOME')` is non-empty, and:
   - `GLib.get_user_config_dir() === home + '/config'`;
   - `GLib.get_user_data_dir() === home + '/data'`.
1. **Extension active.** `ext = Main.extensionManager.lookup('payattention@tonymalandain.github.io')`
   reaches `state === 1` within 10 s, and `ext.error` is empty.
2. **Feed → judge → indicator, from the fixture only.**
   - `Main.panel.statusArea.payattention` exists.
   - Within 30 s, the actor `payattention-indicator-label` is visible and its text
     starts with `'Smoke client review · '`. This proves `hello`, an accepted
     snapshot, `judge` and `plan` all ran, and that the data came from the fixture
     (no real calendar has that title).
   - The actor `payattention-menu-status` is either hidden, or reads
     `'No more meetings today'` (when the fixture meeting falls tomorrow). It never
     starts with `'Reading'`, and never contains `'not updating'`: local sources
     are `remote:false`, so they have no provider clock.
   - `helperPids().length === 1`.
3. **Ladder.**
   - Call `ext.stateObj.runTestAlert()`.
   - Poll every 200 ms, for up to 45 s. Record each step seen, from the card's
     style class (`payattention-card-step1..3`), until an actor named
     `payattention-takeover` exists.
   - Steps 1, 2 and 3 must all have been seen. The test ladder runs 0 / 10 / 20 /
     25 s (`TEST_ALERT_TIMING`).
4. **Takeover:**
   - Its parent is `Main.layoutManager.modalDialogGroup`.
   - `Main.layoutManager.monitors.length === 2`, and it has the children
     `payattention-takeover-monitor-0` and `-1`.
   - Each panel is mapped, and its transformed position and size equal its
     monitor's `x, y, width, height`.
   - `global.stage.get_grab_actor()` is the takeover root.
   - `ourModalEntries().length === 1`.
   - There is no `payattention-card`.
   - `payattention-action-join` does not exist (the test has no link: "Join only
     with a link").
   - `payattention-action-skip` and `payattention-action-ignore` exist.
     `payattention-action-ignore-series` does not (the test does not recur).
5. **Escape.** `pressKey(Clutter.KEY_Escape)`, then sleep 500 ms. The takeover and
   the grab are unchanged.
6. **Acknowledge on the second monitor.**
   - Wait until 1 500 ms have passed since the takeover appeared (arming).
   - `clickActor` the `payattention-action-ack` button inside
     `payattention-takeover-monitor-1`.
   - Within 2 s:
     - no `payattention-takeover` or `payattention-card` actor exists;
     - `ourModalEntries().length === 0`;
     - `global.stage.get_grab_actor()` is null, or its name does not start with
       `payattention`.
   - Sleep 3 s. There are still no alert actors (the test was acknowledged).
7. **Disable.** `Main.extensionManager.disableExtension(uuid)`, then wait up to 5 s
   for `state === 2`. Then:
   - `countByPrefix === 0`;
   - `Main.panel.statusArea.payattention === undefined`;
   - `ourModalEntries().length === 0`;
   - `helperPids().length === 0` within 3 s.
8. **Lock path, with a live takeover:**
   1. `enableExtension(uuid)`, then `state === 1` within 10 s.
   2. Wait for the indicator label as in check 2. The seeds persisted by the
      previous `disable()` must not produce a warning: the fixture's sources are
      local.
   3. `runTestAlert()`, then wait up to 45 s for `payattention-takeover`.
   4. `disableExtension(uuid)`, then `state === 2`.
   5. Repeat the checks from 7, plus `global.stage.get_grab_actor()` is not ours.

**Expected now:** `npm run smoke` fails at check 1 or 2. That is the failing test the
UI steps turn green.

### Step 11 — UI and composition root  [feature]
- **Then** build these, in this order, each as specified in "Seams":
  1. `ui/alertContent.js`
  2. `ui/card.js`
  3. `ui/takeover.js`
  4. `ui/indicator.js`
  5. `ui/ui.js`
  6. `extension/stylesheet.css`
  7. `extension/extension.js`

  Run `npm run lint` after each file. Run `npm run smoke` after `ui.js` and after
  `extension.js`, until it passes.
- **Why here:** `ui/` draws and reports; `extension.js` composes.
- **Behaviour change:** the product becomes visible: indicator, menu, cards,
  takeover, sound, and the named stale warning.

### Step 12 — Preferences window  [feature]
- `extension/prefs.js`:

  ```js
  export default class PayAttentionPreferences extends ExtensionPreferences {
      async fillPreferencesWindow(window) { … }
  }
  ```

  - **Imports:**
    - `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`;
    - `gi://Adw`, `gi://Gtk`, `gi://Gio`;
    - `./core/display.js` (`parseList`, `normalizeDomains`, `normalizeAddresses`);
    - `./core/words.js` (`BUILTIN_IMPORTANT_WORDS`, `BUILTIN_IGNORE_WORDS`).
  - **Setup:** `const settings = this.getSettings();`, kept alive with
    `window._settings = settings`.
  - **Integer rows.** Each is an `Adw.SpinRow`:
    - its adjustment `lower`/`upper` come from
      `settings.settings_schema.get_key(key).get_range().recursiveUnpack()[1]`;
    - `step_increment` is 1 (5 for travel);
    - it is bound with `settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT)`.
  - **List rows.** Each is an `Adw.EntryRow` with `show_apply_button: true`:
    - its text is `settings.get_strv(key).join(', ')`;
    - on `apply`, it writes `settings.set_strv(key, normalized)` and sets the row
      text to `normalized.join(', ')`;
    - `normalized` is `parseList(text)` for the word lists,
      `normalizeDomains(parseList(text))` for `owner-domains`, and
      `normalizeAddresses(parseList(text))` for `extra-owner-addresses`.

  **Page "Alerts"** (`icon_name: 'alarm-symbolic'`):
  - **Group "Online meetings"** (description "Minutes before the start"):
    Heads-up, Nudge, Insist, Takeover → the `online-*` keys.
  - **Group "In-person meetings"** (description "Minutes before you must leave"):
    the same four rows → the `inperson-*` keys, plus
    "Default travel time (minutes)" → `default-travel-minutes`.
  - **Group "Behaviour":**
    - "Heads-up stays for (seconds)"
    - "Snooze (minutes)"
    - "Snooze during takeover (minutes)"
    - "Stop alerting after the start (minutes)" → `cutoff-minutes`
    - `Adw.SwitchRow` "Sound at insist and takeover" → `sound-enabled`, bound to `active`

  **Page "Judgment"** (`icon_name: 'emblem-important-symbolic'`):
  - **Group "Meetings":** SpinRow "Large meeting: more than this many guests" →
    `large-meeting-size`.
  - **Group "Words":**
    - EntryRow "Extra important words" → `extra-important-words`.
    - EntryRow "Extra ignore words" → `extra-ignore-words`.
    - `Adw.EntryRow` has no subtitle, so the group description holds both built-in
      lists:
      `` `Built in, important: ${BUILTIN_IMPORTANT_WORDS.join(', ')}\nBuilt in, ignore: ${BUILTIN_IGNORE_WORDS.join(', ')}` ``.
  - **Group "You":**
    - EntryRow "Your email domains (empty = detect from your calendars)" → `owner-domains`.
    - EntryRow "Extra addresses of yours" → `extra-owner-addresses`.
  - **Group "Saved choices":**
    - `Adw.ButtonRow` "Clear meeting overrides" →
      `settings.reset('verdict-overrides'); settings.reset('mode-overrides')`.
    - `Adw.ButtonRow` "Clear travel times" → `settings.reset('travel-times')`.

  It never touches `alert-state` or the `health-*` keys.
- **Test:** there is no automated GTK test. Checks:
  - `npm run lint` passes the prefs import rules, including `NO_SYSTEM`.
  - `npm run build`, then `unzip -l` lists `prefs.js`.
  - The by-hand real-session check is in Step 14.

### Step 13 — Install script  [feature]
- `scripts/install.sh` is bash with `set -euo pipefail`. Steps:
  1. `ROOT` resolved from the script's path, and `UUID=payattention@tonymalandain.github.io`.
  2. `bash "$ROOT/scripts/build.sh"`.
  3. `gnome-extensions install --force "$ROOT/dist/$UUID.shell-extension.zip"`.
     This installs to `~/.local/share/gnome-shell/extensions/$UUID/` and compiles
     the schemas. Installing from the home filesystem to the home filesystem with
     the default `TMPDIR` was verified.
  4. `test -f ~/.local/share/gnome-shell/extensions/$UUID/schemas/gschemas.compiled`.
  5. Mark it enabled for the next login:

     ```sh
     gjs -c "const {Gio} = imports.gi; const s = new Gio.Settings({schema_id: 'org.gnome.shell'}); const u = '$UUID';
       const e = s.get_strv('enabled-extensions'); if (!e.includes(u)) s.set_strv('enabled-extensions', [...e, u]);
       const d = s.get_strv('disabled-extensions'); if (d.includes(u)) s.set_strv('disabled-extensions', d.filter(x => x !== u));
       Gio.Settings.sync();"
     ```

     If `gsettings get org.gnome.shell disable-user-extensions` is `true`, print a
     warning. Do not change it.
  6. Print:

     ```
     Installed payattention@tonymalandain.github.io. On Wayland, log out and back in to load it. Then check: gnome-extensions info payattention@tonymalandain.github.io
     ```
- **Run it:** `npm run install:local` on the author's machine, as the ticket's
  "Done when" requires. This is the one step that writes to the owner's real
  session: the install directory and `enabled-extensions`. It never reads the
  calendars.

### Step 14 — Full validation  [verification]

Run these in order. Each must pass:

```sh
npm run lint
npm test
npm run build
npm run test:helper
npm run smoke
npm run install:local
```

Then confirm by hand what headless cannot show, per `testing-and-build.md` layer 4,
after the owner logs out and in:
- `gnome-extensions info payattention@tonymalandain.github.io` shows State ACTIVE.
- The journal is clean:
  `journalctl --user -b -o cat /usr/bin/gnome-shell | grep -iE 'payattention|JS ERROR'`.
- `gnome-extensions prefs payattention@tonymalandain.github.io` opens. Changing "Heads-up"
  (online) to 25 shows in
  `dconf read /org/gnome/shell/extensions/payattention/online-headsup-minutes`.
  Set it back to 30 afterwards.
- The checklist in `testing-and-build.md`, including network off for 15 min, which
  must show "<name> calendar not updating since …".

The engineer cannot log out in an unattended run. Report the manual items as
"pending owner check", not as passed.

## PRD cross-check (§3–§7, done 2026-09-26 against the built core)

| PRD / decision | Where it is met |
|---|---|
| §3 ladder, online 30/10/3/1 | `DEFAULT_SETTINGS` = schema (Step 4 test); `plan` |
| D-008 in person 10/5/2/0 before leave-by | same; the Step 4 test fails if the schema says anything else |
| §3 heads-up leaves after 15 s, only when seen while active | `plan`'s `recordHeadsUpShown`, recorded by the controller (Step 6, test 12) |
| §3 snooze 2 min, never past the next step; 1 min at step 4 | `card.snoozeUntil` via `actionFor` (Step 6, test 5) |
| §3 Join only with a link | `canJoin`; `judge` sets `joinUrl` only for online meetings with an allowlisted https link; smoke check 4 |
| §3 I'm on it, Skip this one | `ack`/`skip` buttons; smoke check 4 and 6 |
| §3 Not important, with a whole-series option for repeating meetings | `setVerdict ignore occ/series`; `offerSeries = recurring && !isTest` |
| §3 overlap → "also: <title> at <time>" | `view.also` |
| §3 cutoff 10 min after the start | `plan` |
| §3 DND does not matter | own actors; smoke runs with `show-banners=false` |
| §4 travel shown at steps 1–2, "Travel: 30 min (default) · change", choices 10/15/20/30/45/60/90, stored per place | `view.travel`, `TRAVEL_CHOICES_MIN`, `setTravel` → `travel-times` keyed by core's `placeKey` |
| §4 the menu shows travel for in-person meetings | `MeetingRow.travel` |
| §5 "Client sync · 24m"; quiet icon when nothing is within 12 h | `indicator.text` from `plan.indicator` (12 h rule in core) |
| §5 menu: time, title, verdict, reason, mode, override toggle, travel chooser, Test alert (~30 s) | `indicator.js` rows; `testAlert` takeover at +25 s |
| D-007 mode switch in the menu | `modeSwitchLabel` → `setMode` |
| §6 every listed setting | prefs pages (Step 12) |
| §7 / D-010 warning mark, "since <time>", never "no meetings" while stale | `health.js` + `view` status |
| D-013 provider not syncing for 15 min; alerts keep running | two clocks in `health.js`; controller test 15 |
| D-014 per calendar, names the calendar | `Health.calendars` → "Work calendar not updating since 10:42. Alerts may be missing." |

## Callers to update

- **`eslint.config.js`** (Step 1): `ui/` may import `core/display.js` instead of
  `format.js`; `NO_SYSTEM` goes in four blocks; `.smoke-home/**` is ignored.
  - The one caller is `tests/unit/boundaries.test.js`, updated in the same step.
  - No file imports `core/format.js` today (it does not exist), so nothing else
    breaks.
- **`tests/unit/support/gjs-core-check.js`**: add the `display.js` import and one
  check (Step 2).
- **`package.json` scripts**: replace the `build` and `smoke` placeholders, and add
  `install:local`. The callers are the validation sequence in `CLAUDE.md` and
  `testing-and-build.md`. The names match that contract.
- **`.gitignore`**: add `.smoke-home/`.
- **Core:** no existing export changes. `core/display.js` is new. The
  `occurrenceTimeFromKey` from the first draft is **dropped**: `isExpiredOccurrenceKey`
  already does the job.
- **GSettings schema:** new. Its readers are the store and `prefs.js`, both written
  here.
- **`interfaces.md` §3:** already matches this plan (one `dispatch`, a resolved
  `View`, `headsUpShown` recorded by the controller). Nothing to reshape.
- **No caller outside this repository.** The smoke test calls `runTestAlert()`, as
  `interfaces.md` §4 states.

## Out of scope

- Any change to the rules in `extension/core/` (judge, plan, reduce, keys, protocol,
  defaults, testAlert), and any change to `extension/helper/`. If one looks wrong,
  stop (see below). The only core edit is the new file `display.js`.
- The message tray, `Main.notify`, `MessageTray.Source`, or any notification API
  (ADR-0004, R-12).
- The `unlock-dialog` session mode, or drawing anything while locked (ADR-0005).
- Any new npm or system dependency.
- A "refresh calendars" menu item; per-source error codes in the menu (D-014 names
  the calendar, nothing more); live travel estimates; editing calendar events.
- Renaming or retyping any key in `data.md`.
- Architecture, product and backlog documents. Findings go to `docs/inbox.md` only.
- A LICENSE file and publishing metadata (`url`, `version-name`).

## Stop and escalate if

- Step 0 is not green.
- Core's judged or Plan objects lack a field that `view.js` needs, beyond what the
  surface table lists. Do not compute a missing field in `shell/`.
- `plan`, `judge` or `timingFromSettings` throws on values the schema allows. That
  would be a range mismatch between `data.md` and core.
- `Main.pushModal` returns something other than a Clutter grab in GNOME 50.4, or the
  smoke shows `get_grab_actor()` is not the takeover root while the takeover shows.
  Do not add workarounds that keep a grab alive by any other means.
- The helper cannot produce a snapshot inside the headless session, so check 2
  fails for reasons outside the feed. Report the `payattention-helper:` lines from
  `shell.log`. Do not weaken the check, and do not point the smoke at the real
  session bus or the real XDG directories under any circumstances.
- Neither the `env -i` form nor the pre-decided fallback in Step 10.7 starts the
  shell.
- Anything seems to need a `gi://` import in `controller.js`, `view.js`,
  `health.js`, `backoff.js`, `soundCue.js`, `settingsKeys.js` or `core/display.js`.
- A GSettings key seems to need renaming or retyping.
