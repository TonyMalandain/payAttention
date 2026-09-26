# Plan — PG-1c: alerts, top bar, settings, install

**Sensitive:** personal data (calendar titles, places, people's addresses are shown on
screen and must never be logged); a modal input grab (a leaked grab makes the Wayland
desktop unusable); launching a URL from calendar data ("Join"). No secrets, no auth.

Written by the senior engineer on 2026-09-26 (unattended run). Built after PG-1a (core)
and PG-1b (helper). Spec: `docs/prd/meeting-guardian.md` §3–§7 and "Done when";
decisions D-004, D-005, D-006, D-008, D-009, D-010 in `docs/product/decisions.md`;
architecture `docs/architecture/*.md`, ADR-0002…0006.

## What changes, and for whom

The calendar owner gets an installed extension: a top-bar countdown to the next
must-attend deadline with a menu of today's meetings (verdict, reason, override,
online/in-person switch, travel chooser, "Test alert", "Settings"); the four alert
steps (calm corner card → amber card → red pulsing centred card with sound → a
full-screen takeover on every monitor that only an action clears); a settings window;
and a warning when calendar data is stale. The installer gets `npm run install:local`.

## The component

This ticket builds three subsystems from `boundaries.md` plus the composition root.
Greenfield: nothing exists yet, so there is nothing to repair.

- **`extension/shell/` — responsible for:** turning calendar snapshots, stored
  settings/state and the clock into a display model once a second, and turning the
  owner's actions into stored changes. Split by one job per file:
  - `calendarFeed.js` — keep the helper process alive and hand on its last good snapshot.
  - `store.js` — typed read/write of the GSettings schema (the only GSettings code in the shell process).
  - `environment.js` — tell whether the owner is active, and when the machine resumed.
  - `ticker.js` — call a function once a second.
  - `launcher.js` — open a URL with the desktop's default handler.
  - `controller.js` — the one orchestrator (ADR-0002): judge when inputs change, plan every tick, render, route actions, sound edge, test alert.
  - `view.js` — pure: Plan + judged occurrences + health → the display model the UI draws.
  - `health.js`, `backoff.js`, `soundCue.js` — pure one-rule helpers (freshness, restart delay, sound edge).
- **`extension/ui/` — responsible for:** drawing a display model and reporting clicks. Decides nothing.
- **`extension/core/display.js` (new, in core) — responsible for:** turning numbers and
  raw text into display strings, and parsing comma lists typed in settings. It is pure
  and shared by `shell/view.js` and `prefs.js` (boundaries.md: `ui/` and `prefs.js`
  may use display helpers from core).
- **`extension/extension.js` — responsible for:** building the controller in `enable()`, destroying it in `disable()`. No logic.
- **`extension/prefs.js` — responsible for:** editing the owner's settings keys.
- **Has drifted by:** no drift (new code).
- **This change belongs here because:** each piece is placed under the responsibility
  `boundaries.md` gives its directory. Two placements need a reason:
  - Formatting goes to `core/display.js`, not `ui/`, because both `prefs.js` and
    `shell/view.js` need it and neither may import `ui/`.
  - The display model is built in `shell/view.js`, not in `ui/`, because choosing what
    to show (for example "travel only at steps 1–2", "Join only with a link", "never
    say 'no meetings' when stale") is a decision, and the UI must not decide.

### Why the controller and view have no `gi://` imports

`controller.js`, `view.js`, `health.js`, `backoff.js`, `soundCue.js` and `core/display.js`
import only `core/` and each other. Every GNOME-touching part (store, feed, environment,
ticker, launcher, UI) is **injected into the controller as a factory**. That makes the
orchestrator unit-testable under Node with fakes, like core. These modules must never
gain a `gi://` or `resource://` import; if one seems needed, the thing belongs in an
injected part instead.

## Core surface this plan consumes (from PG-1a, contract in `interfaces.md` §1–§2)

PG-1a names its own exports. **Step 0** records the real names. Where a name below
differs but the role and shape match, use the real name. That is a mechanical rename,
not a design decision. Where a role is **missing**, stop (see "Stop and escalate").

| Role | Shape relied on | Used by |
|---|---|---|
| protocol version | integer constant (1) | calendarFeed |
| protocol validator | `(message: object) → valid or invalid` for `hello`/`snapshot`/`status` | calendarFeed |
| judge | `judge(snapshot, config, overrides, travel) → JudgedOccurrence[]`, each with occurrence key, series key, title, start, end, verdict, reason, mode, overridden, joinUrl, place key, travel minutes, travel-is-default, deadline, and whether it recurs | controller |
| plan | `plan(now, judged, alertState, timing, env) → Plan` with primary `{key, step, visible}` or none, the "also" list of keys, takeover-required flag, indicator target (key) or none | controller, view |
| reduce | `reduce(alertState, action, now) → alertState` for `ack`, `skip`, `snooze`, `headsUpShown`, `prune` | controller |
| alert-state parse / serialize | string → state (corrupt or unknown `v` → empty state), state → string | store |
| occurrence time from key | `occ:<uid>\|<t>` → `t` (ms), or null for other keys | store (pruning) |
| test alert | `(now) → {judged: JudgedOccurrence (verdict 'must', online, joinUrl null), timing}`: the compressed ladder of about 30 s | controller |
| built-in word lists | arrays of strings (important, ignore) | prefs.js (read-only display) |

Rules for the three places where PG-1a's exact shape decides the call:
- **Snooze:** if `reduce` needs the snooze length, the controller passes
  `takeover-snooze-minutes` when the alert's step is 4, otherwise `snooze-minutes`
  (from the store, in the unit `reduce` expects).
- **Owner addresses:** if `judge` reads the owner's addresses from `config` rather
  than from `snapshot.sources[].ownerEmail`, the controller builds
  `config.ownerAddresses = unique(lowercase(non-null sources[].ownerEmail) ∪ extra-owner-addresses)`.
  When `owner-domains` is empty, it also builds `config.ownerDomains` = the unique
  domains of those addresses. If `judge` reads the sources itself, pass
  `extra-owner-addresses` and `owner-domains` as they are.
- **Plan env:** always pass `{userActive}`. If `plan` also requires a data-health
  field, set it to `health.state === 'ok'`.

If core has no occurrence-time-from-key function, add
`occurrenceTimeFromKey(key: string): number | null` to the core keys module. It takes
the text after the **last** `|` of an `occ:` key, returns null for any other key, and
gets its own unit test. That is the only edit this ticket makes to PG-1a's files.

## Seams

All signatures are exact. JSDoc types go on every exported function and class, in the style PG-1a uses.

### `extension/core/display.js` (pure)

```js
export function oneLine(text: string, maxChars: number): string
export function formatShort(ms: number): string          // indicator countdown
export function formatCountdown(ms: number): string      // takeover big number
export function formatRelative(ms: number): string       // "in 24 min" / "3 min ago"
export function formatClock(epochMs: number): string     // local time of day
export function stepHeadline(step: 1|2|3|4, mode: 'online'|'in-person'): string
export function countdownCaption(mode: 'online'|'in-person', ms: number): string
export function parseList(text: string): string[]
export function normalizeDomains(items: string[]): string[]
export function normalizeAddresses(items: string[]): string[]
```

Exact behaviour (each line is one unit test):

- `oneLine`: collapse every whitespace run, including newlines, to one space, then trim. Empty text gives `'(no title)'`. If the result is longer than `maxChars`, return the first `maxChars − 1` characters followed by `'…'`.
- `formatShort`: `ms <= 0` → `'now'`. Otherwise m = ceil(ms / 60 000). If m < 60 → `` `${m}m` ``. Otherwise → `` `${h}h ${mm}m` `` with mm padded to 2 digits (for example 3 900 000 ms → `'1h 05m'`).
- `formatCountdown`: `ms >= 0` → s = ceil(ms / 1000); `ms < 0` → s = floor(|ms| / 1000) with the prefix `'−'` (U+2212). Shape is `m:ss`, or `h:mm:ss` when s ≥ 3600. Examples: 45 000 → `'0:45'`, 44 001 → `'0:45'`, 0 → `'0:00'`, −130 000 → `'−2:10'`, 3 725 000 → `'1:02:05'`.
- `formatRelative`: `ms >= 60 000` → `` `in ${ceil(ms / 60 000)} min` ``. `0 <= ms < 60 000` → `'in less than a minute'`. `−60 000 < ms < 0` → `'just now'`. Otherwise → `` `${floor(|ms| / 60 000)} min ago` ``.
- `formatClock`: `new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'}).format(epochMs)`. Build the formatter once, at module scope; that is static data. The test sets `process.env.TZ = 'UTC'` before importing and checks that a 10:30 UTC time contains `'10:30'`. Only use times before 12:00 in tests, so 12-hour and 24-hour locales both pass.
- `stepHeadline`:
  - step 1 → `'Heads-up'`
  - step 2 → `'Get ready'`
  - step 3 → `'About to start'` (online), `'Time to leave'` (in-person)
  - step 4 → `'Your meeting is starting'` (online), `'Leave now'` (in-person)
- `countdownCaption`:
  - online → `'until it starts'` / `'since it started'`
  - in-person → `'until you must leave'` / `'since you should have left'`
  - The first wording is for `ms >= 0`, the second for `ms < 0`.
- `parseList`: split on `,` and newlines, trim each item, collapse inner whitespace, drop empty items, and remove case-insensitive duplicates, keeping the first spelling.
- `normalizeDomains`: lowercase each item, strip a leading `@`, and drop any item that contains `@`, a space, or no `.`. Remove duplicates.
- `normalizeAddresses`: lowercase each item, strip a leading `mailto:`, and keep only items of the form `x@y.z` with no spaces. Remove duplicates.

### `extension/shell/health.js` (pure)

```js
export const STALE_AFTER_MS = 15 * 60 * 1000;           // D-010
/** @returns {boolean} */
export function isFreshSnapshot(snapshot)                // sources.length === 0 || sources.some(s => s.ok)
/** @returns {{state: 'waiting'|'ok'|'stale', since: number|null}} */
export function dataHealth({lastGoodAt, startedAt, now})
```

`dataHealth` works as follows:
- `lastGoodAt !== null && now − lastGoodAt < STALE` → `{state: 'ok', since: null}`.
- `lastGoodAt === null && now − startedAt < STALE` → `{state: 'waiting', since: null}`.
- Otherwise → `{state: 'stale', since: lastGoodAt ?? startedAt}`.

Misuse made impossible: there is one definition of "stale" and one of "fresh", so the
UI can never say "no meetings" on the basis of its own guess.

### `extension/shell/backoff.js` (pure)

```js
export const FIRST_DELAY_MS = 1000, MAX_DELAY_MS = 300_000, HEALTHY_RESET_MS = 600_000;
/** Delay before the next helper start. previousDelayMs is null for the first restart. */
export function nextRestartDelayMs(previousDelayMs: number|null, ranForMs: number): number
```

Rule: `ranForMs >= HEALTHY_RESET_MS || previousDelayMs === null` → `FIRST_DELAY_MS`.
Otherwise → `min(previousDelayMs * 2, MAX_DELAY_MS)`.

### `extension/shell/soundCue.js` (pure)

```js
/** previous/next: the visible alert of consecutive ticks, as {key, step} or null. */
export function shouldPlaySound(previous, next): boolean
```

It returns `next !== null && next.step >= 3 && !(previous && previous.key === next.key && previous.step === next.step)`.
The controller also requires `sound-enabled`. This is the "edge" from ADR-0002, kept
in one function.

### `extension/shell/view.js` (pure)

```js
export const TRAVEL_CHOICES_MIN = [10, 15, 20, 30, 45, 60, 90];   // PRD §4
/**
 * @param {object} p
 * @param {Plan} p.plan                     real meetings
 * @param {Plan|null} p.testPlan            running test alert, or null
 * @param {Map<string, JudgedOccurrence>} p.judgedByKey   real, keyed by occurrence key
 * @param {JudgedOccurrence|null} p.testJudged
 * @param {JudgedOccurrence[]} p.judged     real, in judge order
 * @param {{state, since}} p.health
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
              travel: null | {placeKey, minutes, header, choices}}
AlertView = {key, isTest, step, presentation: 'card'|'takeover',
             headline, title, timeLine, countdown, countdownCaption, reason,
             travel: null | {placeKey, minutes, text, choices},
             also: string[], canJoin: boolean, offerSeries: boolean}
```

Rules. Each is a unit test in `view.test.js`.

- **Which plan draws the alert.** If `testPlan` has a visible primary, the alert comes
  from the test (`isTest: true`). Otherwise it comes from `plan` if its primary is
  visible. Otherwise `alert` is null.
- **Presentation.** `'takeover'` when the chosen plan's takeover-required flag is true,
  else `'card'`.
- **Alert fields:**
  - `headline` = `stepHeadline(step, mode)`.
  - `title` = `oneLine(title, 120)`.
  - `countdown` = `formatCountdown(deadline − now)`.
  - `countdownCaption` = `countdownCaption(mode, deadline − now)`.
  - `timeLine`:
    - online → `` `Starts at ${formatClock(start)} · ${formatRelative(start − now)}` ``
    - in-person → `` `Leave by ${formatClock(deadline)} · ${formatRelative(deadline − now)}` ``
  - `reason` = `` `Why: ${reason}` ``.
  - `canJoin` = `joinUrl !== null`.
  - `offerSeries` = the meeting recurs and it is not the test.
  - `travel` is present only when mode is in-person and step ≤ 2 (PRD §4):
    `text` = `` `Travel: ${m} min${isDefault ? ' (default)' : ''}` ``, `choices` = `TRAVEL_CHOICES_MIN`.
  - `also` = the plan's also-keys mapped to `` `also: ${oneLine(title, 60)} at ${formatClock(start)}` ``.
- **Indicator:**
  - `text` = `` `${oneLine(title, 24)} · ${formatShort(deadline − now)}` `` for the real plan's indicator target, else null.
  - `highlighted` = the real or the test plan has a primary, visible or not.
  - `flashing` = `alert?.step === 3 && alert.presentation === 'card'`.
  - `warning` = `health.state === 'stale'`.
- **Menu rows:**
  - `meetings` = the real judged occurrences with `end > now` and `start < ` the next
    local midnight. The next local midnight is `new Date(now)` with `setHours(24, 0, 0, 0)`.
    Sort by start, then title.
  - `label` = `` `${formatClock(start)}  ${oneLine(title, 40)}` ``.
  - `detail` = `` `${verdict === 'must' ? 'Must attend' : 'Ignorable'} · ${mode === 'online' ? 'online' : 'in person'}` ``,
    with `' · overridden'` added when overridden.
  - `reason` = `` `Why: ${reason}` ``.
  - `modeSwitchLabel` = `'Switch to in person'` / `'Switch to online'`.
  - `travel` is present for in-person rows: `header` = `` `Travel time: ${m} min${isDefault ? ' (default)' : ''}` ``.
- **Menu status (D-010: never "no meetings" while stale):**
  - `'waiting'` → `'Reading calendars…'`
  - `'stale'` → `` `Calendar not updating since ${formatClock(since)}. Alerts may be missing.` ``
  - `'ok'` with no rows → `'No more meetings today'`
  - `'ok'` with rows → null
- **Menu signature:** `signature` = the rows joined as `key|label|detail|reason|overridden|mode|travel minutes`, one row per line. The UI rebuilds the menu only when it changes.

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
  destroy(): void          // idempotent
}
```

The ports are plain objects. The fakes in the tests implement exactly these:

```js
StorePort = {
  readTiming(), readJudgeConfig(), readOverrides(), readTravel(),
  readSoundEnabled(): boolean, readSnoozeMinutes(): {normal, takeover},
  readAlertState(), writeAlertState(state): void,
  setVerdictOverride(key: string, verdict: 'must'|'ignore'|null): void,
  setModeOverride(key: string, mode: 'online'|'in-person'|null): void,
  setTravel(placeKey: string, minutes: number): void,
  pruneOccurrenceOverrides(now: number): void,
  destroy(): void,                                 // flushes a pending alert-state write
}
FeedPort = { get snapshot(), get lastGoodAt(), get startedAt(), refresh(reason: 'resume'|'manual'): void, destroy(): void }
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
- There is no `start()` to forget and no `setUi()` to call in the wrong order. Every
  callback exists before the part that calls it, because the controller creates each
  part and passes it the callback.
- `disable()` is one call. The controller owns every part's lifetime.

Behaviour, in order.

**Constructor.** Build in this order:
1. `store = createStore(onStoreChange)`
2. `environment = createEnvironment(onResume)`
3. `feed = createFeed(onFeedUpdate)`
4. `ui = createUi(dispatch)`

Then:
- load `alertState = store.readAlertState()` and the settings;
- prune: `alertState = reduce(alertState, prune, now)`, `store.writeAlertState(alertState)`, `store.pruneOccurrenceOverrides(now)`, and set `lastPruneAt = now`;
- run `tick()` once;
- `ticker = createTicker(tick)`.

The whole constructor body sits in `try { … } catch (e) { this.destroy(); throw e; }`.

**`tick()`** — the whole body is inside a `try`:
1. If `judgeDirty`: `judged = judge(feed.snapshot ?? EMPTY, config, overrides, travel)`.
   `EMPTY` means "no snapshot": call nothing and set `judged = []`. Then rebuild
   `judgedByKey`.
2. `health = dataHealth({lastGoodAt: feed.lastGoodAt, startedAt: feed.startedAt, now})`.
3. `env = {userActive: environment.isUserActive()}`.
4. `realPlan = plan(now, judged, alertState, timing, env)`.
5. If a test is running: `testPlan = plan(now, [test.judged], test.alertState, test.timing, env)`.
   If `testPlan` has no primary and `now >= test.judged.deadline`, end the test (`test = null`).
6. `view = buildView(...)`.
7. **Heads-up marking** (replaces the UI's `headsUpShown` callback). If `view.alert`
   is step 1 and `env.userActive`, and that item's stored `headsUpShownAt` is null,
   dispatch `reduce(state, headsUpShown for alert.key, now)` on the test state or the
   real state (the real state is then written to the store).
8. **Sound.** Take `next = view.alert ? {key, step} : null`. If
   `shouldPlaySound(lastVisible, next) && store.readSoundEnabled()`, call
   `ui.playAlertSound()`. Set `lastVisible = next`.
9. `ui.render(view)`.
10. If `now − lastPruneAt >= 24 h`, prune as in the constructor.

**`catch (e)`** in the tick:
- Log `console.error('payattention: tick-failed', e)`, but only when `String(e)`
  differs from the last logged failure. Reset that memory after a successful tick.
- Then call `ui.releaseTakeover()` inside its own try/catch. This is fail-open
  (ADR-0004).

**`dispatch(action)`** — ignored after `destroy()`. `isTest` means `test && action.key === test.judged.key`.
- `ack`, `skip`, `snooze`: reduce on the test state or the real state. The real state
  is written with `store.writeAlertState`. Snooze length: see "Core surface".
- `join`: find the occurrence. If `joinUrl` is null, do nothing. Otherwise call
  `launchUri(joinUrl, ok => { if (!destroyed && ok) dispatch({type: 'ack', key}) })`.
  If the launch fails the takeover stays, because a false "you are fine" is the worst
  failure (D-004).
- `setVerdict`:
  - if `isTest`, end the test and write nothing;
  - else `store.setVerdictOverride(scope === 'series' ? judged.seriesKey : key, verdict)`, then re-read overrides and set `judgeDirty`.
- `setMode`: `store.setModeOverride(key, mode)`, then re-read overrides and set `judgeDirty`.
- `setTravel`: `store.setTravel(placeKey, minutes)`, then re-read travel and set `judgeDirty`.
- `runTestAlert`: `this.runTestAlert()`.
- After any action, call `tick()` straight away, so the screen answers the click in the same frame.

**`runTestAlert()`:**
- `const t = <core test alert>(now)`;
- `test = {judged: t.judged, timing: t.timing, alertState: <empty alert state>}` (this replaces any test already running);
- `tick()`.

**`onStoreChange()`:** re-read settings, timing, overrides and travel, and set `judgeDirty`.
**`onFeedUpdate()`:** set `judgeDirty`.
**`onResume()`:** `feed.refresh('resume')`, then `tick()`.

**`destroy()`:** set `destroyed = true`. Then call, each in its own try/catch that
logs `payattention: destroy-failed <part>`:
1. `ticker.destroy()`
2. `ui.destroy()` — this releases the grab
3. `feed.destroy()`
4. `environment.destroy()`
5. `store.destroy()` — this flushes the write

Null every reference. A second call does nothing.

### `extension/shell/store.js`

```js
export class Store {
  /** @param {Gio.Settings} settings  @param {() => void} onChange  (not called for alert-state) */
  constructor(settings, onChange)
  // …the StorePort methods above…
}
```

- Connect with `settings.connectObject('changed', (_s, key) => { if (key !== 'alert-state') onChange(); }, this)`. `destroy()` calls `settings.disconnectObject(this)`.
- **Reads:**
  - `get_int`, `get_boolean`, `get_strv`;
  - dictionaries via `get_value(key).recursiveUnpack()`;
  - `readAlertState()` uses core's parse. On an empty or corrupt string it logs `payattention: alert-state-corrupt` once (empty string: no log) and returns an empty state.
- **Writes:**
  - Dictionaries: copy the dictionary, set or delete the key (null deletes), then `set_value(key, new GLib.Variant('a{ss}' | 'a{si}', dict))`. Write nothing when nothing changed.
  - `writeAlertState(state)` serializes with core and keeps the string as `pending`. If no flush is scheduled, it schedules one with `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, flush)`. `flush` writes `set_string('alert-state', pending)` only if it differs from the last written string, then clears `pending`, zeroes the source id, and returns `GLib.SOURCE_REMOVE`.
  - `destroy()` removes the source (`GLib.Source.remove`) if it is set, flushes synchronously, and disconnects.
- **`pruneOccurrenceOverrides(now)`** removes, from `verdict-overrides` and
  `mode-overrides`, every key whose occurrence time is not null and is older than
  `now − 7 days`.
- **`readJudgeConfig()`** returns the core config built from:
  - `extra-important-words`
  - `extra-ignore-words`
  - `owner-domains`
  - `extra-owner-addresses`
  - `large-meeting-size`
  - `default-travel-minutes`

  Apply the owner-address rule under "Core surface". The owner-address merge with
  `snapshot.sources` happens in the controller, because the store never sees snapshots.
- **`readTiming()`** maps the schema table below into core's `timing` shape, in core's units.

### `extension/shell/calendarFeed.js`

```js
export class CalendarFeed {
  /** Spawns the helper immediately. @param {{argv: string[], onUpdate: () => void}} p */
  constructor({argv, onUpdate})
  get snapshot()      // last accepted snapshot or null
  get lastGoodAt()    // epoch ms of last fresh snapshot, or null
  get startedAt()     // epoch ms when this feed was constructed
  refresh(reason)     // writes {"type":"refresh","reason":…}\n if a helper is running; otherwise no-op
  destroy()
}
```

**Spawning (`_spawn()`):**
- create a new `Gio.Cancellable`;
- `proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE)`. Stderr is inherited, so helper diagnostics reach the journal;
- `spawnedAt = Date.now()`;
- `reader = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe(), close_base_stream: true})`;
- start `_readNext()` and `proc.wait_async(cancellable, onExit)`.

If the spawn throws, log `payattention: helper-spawn-failed` and schedule a restart as if the helper had run for 0 ms.

**`_readNext()`:** `reader.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, cb)`. In `cb`:
- `[line] = reader.read_line_finish_utf8(res)`. On a cancellation error, return silently.
- `line === null` is EOF: stop reading (`onExit` handles the restart).
- Otherwise handle the line and call `_readNext()` again.

**Handling a line:**
- Lines longer than 4 MiB are dropped with the warning `invalid-line`.
- `JSON.parse` inside try, then the core validator. If either fails, warn once per
  helper run with `payattention: invalid-line` and drop the line.
- `hello` with a different protocol: log `payattention: protocol-mismatch <n>`,
  `force_exit()`, and set `stopped = true`, meaning no restart. Staleness then shows
  the warning.
- `snapshot`: if `isFreshSnapshot(msg)`, replace `snapshot`, set `lastGoodAt = Date.now()`,
  and call `onUpdate()`. Otherwise keep the previous snapshot and `lastGoodAt`.
  **Never** filter or edit events.
- `status`: warn once per distinct `code` per helper run with `payattention: helper-status <level> <code>`.

**`onExit`:**
- If cancelled or `stopped`, return.
- Log `payattention: helper-exited <exit status or signal>`.
- `delay = nextRestartDelayMs(previousDelay, Date.now() − spawnedAt)`.
- `restartSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => { restartSourceId = 0; _spawn(); return GLib.SOURCE_REMOVE; })`.

**`refresh`:** `proc.get_stdin_pipe().write_bytes_async(new GLib.Bytes(new TextEncoder().encode(json + '\n')), GLib.PRIORITY_DEFAULT, cancellable, cb)`. `cb` calls `write_bytes_finish` in try/catch and ignores errors.

**`destroy()`:**
- `stopped = true`;
- remove `restartSourceId`;
- `cancellable.cancel()`;
- `proc?.force_exit()`, which is SIGTERM with no wait (interfaces.md §1);
- null everything.

### `extension/shell/environment.js`

```js
export const ACTIVE_IDLE_MS = 60_000;   // constraints.md
export class Environment {
  /** @param {{onResume: () => void}} p */
  constructor({onResume})
  isUserActive(): boolean     // global.backend.get_core_idle_monitor().get_idletime() < ACTIVE_IDLE_MS
  destroy()
}
```

The constructor connects
`LoginManager.getLoginManager().connectObject('prepare-for-sleep', (_lm, aboutToSuspend) => { if (!aboutToSuspend) onResume(); }, this)`.
It imports `resource:///org/gnome/shell/misc/loginManager.js`. `destroy()` calls `disconnectObject(this)`.

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

It calls `Gio.AppInfo.launch_default_for_uri_async(uri, global.create_app_launch_context(0, -1), null, cb)`
and finishes with `launch_default_for_uri_finish` in try/catch. Never log the URI.

### `extension/ui/ui.js`

```js
export class Ui {
  /** Adds the indicator to the panel. No other actors until render(). */
  constructor({dispatch, openPreferences})
  render(view)             // idempotent: the same view twice changes nothing
  playAlertSound()         // global.display.get_sound_player().play_from_theme('alarm-clock-elapsed', 'payAttention alert', null)
  releaseTakeover()        // pops the grab and destroys the takeover actors; safe to call any time
  destroy()                // releaseTakeover, destroy card, stop pulse, re-enable unredirect if disabled, destroy indicator
}
```

**`render(view)` algorithm:**
1. `indicator.update(view.indicator, view.menu)`.
2. `a = view.alert`, then one of three cases:
   - `a === null` → destroy the card; `takeover.hide()`.
   - `a.presentation === 'takeover'` → destroy the card;
     `indicator.menu.close(BoxPointer.PopupAnimation.NONE)` if it is open;
     `takeover.show(a, dispatch)`.
   - card → `takeover.hide()`. If there is no card, or `card.key`, `card.step` or
     `card.isTest` differs from `a`: destroy the old card and create `new Card(a, dispatch)`.
     Otherwise `card.update(a)`.
3. **Pulse.** Needed = (card at step 3) || `view.indicator.flashing`. If needed and no
   pulse source exists, start one: `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, …)`,
   which toggles the style class `payattention-pulse-on` on the card root and the
   indicator box. If not needed, remove the source and remove the class. This is a
   display-only timer; boundaries.md allows it.
4. **Unredirect.** While a card exists, keep `global.compositor.disable_unredirect()`
   applied, called once when the first card appears. Call `enable_unredirect()` once
   when the card goes away, so cards draw over direct-scanout full-screen windows.
   `pushModal` does the same for the takeover.

Connect `Main.layoutManager.connectObject('monitors-changed', …, this)`. It destroys the card (the next tick recreates it on the right monitor) and calls `takeover.relayout()`.

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

**Children, in order (all St.Label with plain text; never `use_markup`, never `set_markup`):**
1. headline (`payattention-headline`)
2. title (`payattention-title`, `line_wrap` true)
3. countdown (`payattention-countdown`) and caption (`payattention-caption`) — takeover only
4. `timeLine` (`payattention-time`)
5. reason (`payattention-reason`)
6. travel row — only when `alert.travel`. A link-style `St.Button` with the label `` `${travel.text} · change` `` (`payattention-travel-toggle`). Clicking it toggles a hidden row of `St.Button`s, one per choice, labelled `` `${m} min` ``. The current value gets the class `payattention-choice-current`. Clicking a choice dispatches `{type: 'setTravel', placeKey, minutes}`. Whether the row is open is kept on the instance.
7. one `payattention-also` label per `also` entry
8. action rows (`St.BoxLayout`, `payattention-actions`):
   - **Row 1:** `Join` (only if `canJoin`, class `payattention-button-primary`), `I'm on it` (primary when there is no Join), `Snooze`.
   - **Row 2:** `Skip this one`, `Not important`, and `Not important: whole series` (only if `offerSeries`).

**Buttons:**
- `St.Button({label, style_class: 'payattention-button', can_focus: true, reactive: false})`.
- Names: `payattention-action-join`, `-ack`, `-snooze`, `-skip`, `-ignore`, `-ignore-series`.
- Clicks dispatch:
  - `{type: 'join'|'ack'|'snooze'|'skip', key}`
  - `{type: 'setVerdict', key, verdict: 'ignore', scope: 'occ'|'series'}`

**Arming.** The constructor starts `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, …)`.
When it fires it sets `reactive = true` on every button, so a click already under way
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

- **Root:** `St.BoxLayout({name: 'payattention-card', style_class: 'payattention-card payattention-card-step' + step, reactive: true, vertical})`, containing `AlertContent(alert, dispatch, 'card')`.
- **Adding it:** `Main.layoutManager.addChrome(root)`. It stays above normal and full-screen windows, is not tied to full-screen, and gets an input region.
- **Monitor:** `monitorIndex = global.display.get_current_monitor()`, taken once.
- **Placement.** `_place()` runs on `root` `notify::size` and after construction, with `wa = Main.layoutManager.getWorkAreaForMonitor(monitorIndex)`:
  - steps 1–2: `x = wa.x + wa.width − root.width − 24`, `y = wa.y + 24`
  - step 3: `x = wa.x + (wa.width − root.width) / 2`, `y = wa.y + (wa.height − root.height) / 2`

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
- For each index `i` of `Main.layoutManager.monitors`, one `St.BoxLayout({name: 'payattention-takeover-monitor-' + i, style_class: 'payattention-takeover-panel', vertical, x_align/y_align CENTER})` with `panel.add_constraint(new Layout.MonitorConstraint({index: i}))`, containing `AlertContent(alert, dispatch, 'takeover')`. Import `resource:///org/gnome/shell/ui/layout.js`.
- Connect root `key-press-event`:
  - `Tab` → `root.navigate_focus(global.stage.key_focus, St.DirectionType.TAB_FORWARD, true)`
  - `ISO_Left_Tab` → `TAB_BACKWARD`
  - return `Clutter.EVENT_STOP` for every key.

  Escape therefore does nothing, and Enter does nothing until the owner has tabbed to a button. There is no initial button focus, so a keystroke already under way cannot choose an action.

**Grab — the last step of `show()`, and only after every actor is built:**
- If `grab` is null, `try { grab = Main.pushModal(root, {actionMode: Shell.ActionMode.SYSTEM_MODAL}); }`.
- On `catch`, log `payattention: grab-failed` and leave `grab` null. The overlays still show and the next `show()` (next tick) retries (ADR-0004).
- If building throws partway, `show()` calls `hide()` and rethrows.

**`hide()`:**
- `if (grab) { try { Main.popModal(grab) } catch (e) { log } grab = null }`.
- Then `root?.destroy()` and `root = null`.

The pop comes before the destroy, and neither may be skipped.

### `extension/ui/indicator.js`

```js
export const Indicator = GObject.registerClass({GTypeName: 'PayAttentionIndicator'},
class Indicator extends PanelMenu.Button {
  _init({dispatch, openPreferences})   // super._init(0.5, 'payAttention', false); name 'payattention-indicator'
  update(indicatorView, menuView)
});
```

**Panel box.** An `St.BoxLayout` (`payattention-indicator-box`) holding:
- `St.Icon({icon_name: 'alarm-symbolic', style_class: 'system-status-icon'})`;
- a warning `St.Icon({icon_name: 'dialog-warning-symbolic', style_class: 'system-status-icon payattention-warning'})`, visible only when `warning`;
- an `St.Label` (y_align CENTER, `clutter_text.ellipsize = END`), visible only when `text !== null`.

The class `payattention-indicator-highlight` is on the box while `highlighted`.

**Menu:**
- Set `this.menu.actor.name = 'payattention-menu'`.
- A status item: `PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false})`. Its `label.name = 'payattention-menu-status'`; it is visible only when `status !== null`, and its text is `status`.
- A `PopupMenuSection` for meetings, then a `PopupSeparatorMenuItem`.
- `Test alert` → `dispatch({type: 'runTestAlert'})`.
- `Settings` → `openPreferences()`.

The meetings section is rebuilt (`removeAll()`, then add again) only when `menuView.signature` changes.

**Each row** is a `PopupSubMenuMenuItem(row.label)`. Add `row.detail` as a second `St.Label` (`payattention-row-detail`) to the item's box. The submenu holds:
1. an insensitive `PopupMenuItem(row.reason)`;
2. `PopupSwitchMenuItem('Must attend', row.isMust)`, whose `toggled(_, state)` dispatches `setVerdict(key, state ? 'must' : 'ignore', 'occ')`;
3. if recurring, `PopupMenuItem('Apply to whole series')`, which dispatches `setVerdict(key, row.isMust ? 'must' : 'ignore', 'series')`;
4. if overridden, `PopupMenuItem('Back to automatic')`, which dispatches `setVerdict(key, null, 'occ')` and, if recurring, also `setVerdict(key, null, 'series')`;
5. `PopupMenuItem(row.modeSwitchLabel)`, which dispatches `setMode(key, row.otherMode)`;
6. if `row.travel`: an insensitive `PopupMenuItem(row.travel.header)`, then one `PopupMenuItem(`${m} min`)` per choice, with `setOrnament(PopupMenu.Ornament.CHECK)` on the current value (`NO_DOT` on the rest). Each dispatches `setTravel(row.travel.placeKey, m)`.

`Ui` adds the indicator with `Main.panel.addToStatusArea('payattention', indicator, 0, 'right')`.

### `extension/extension.js`

```js
export default class PayAttentionExtension extends Extension {
  enable()          // builds one Controller; see below
  disable()         // this._controller?.destroy(); this._controller = null; this._settings = null;
  runTestAlert()    // this._controller?.runTestAlert()   (interfaces.md §4; menu + smoke)
}
```

`enable()`:

```js
this._settings = this.getSettings();
const helperPath = GLib.build_filenamev([this.path, 'helper', HELPER_ENTRY]);  // HELPER_ENTRY: PG-1b's entry file name, module-scope const
this._controller = new Controller({
  createStore: onChange => new Store(this._settings, onChange),
  createFeed: onUpdate => new CalendarFeed({argv: ['gjs', '-m', helperPath], onUpdate}),
  createEnvironment: onResume => new Environment({onResume}),
  createUi: dispatch => new Ui({dispatch, openPreferences: () => this.openPreferences()}),
  createTicker: onTick => new Ticker(1000, onTick),
  launchUri,
  now: () => Date.now(),
});
```

Nothing else. Module scope holds only imports and the constant.

## GSettings schema (`extension/schemas/org.gnome.shell.extensions.payattention.gschema.xml`)

- **Schema:** `id="org.gnome.shell.extensions.payattention"`, `path="/org/gnome/shell/extensions/payattention/"`.
- **Summaries:** every key gets a `<summary>` in plain English, taken from the "Meaning" column of data.md.
- **Ranges:** every `i` key gets a `<range>`.

| Key | Type | Default | Range | Source |
|---|---|---|---|---|
| `online-headsup-minutes` | i | 30 | 1–240 | D-006 |
| `online-nudge-minutes` | i | 10 | 0–120 | PRD §3 |
| `online-insist-minutes` | i | 3 | 0–60 | PRD §3 |
| `online-takeover-minutes` | i | 1 | 0–30 | PRD §3 |
| `inperson-headsup-minutes` | i | 10 | 1–240 | D-006/D-008 |
| `inperson-nudge-minutes` | i | 5 | 0–120 | D-008 |
| `inperson-insist-minutes` | i | **2** | 0–60 | **D-008** (data.md says 0; see inbox) |
| `inperson-takeover-minutes` | i | **0** | 0–30 | **D-008** (data.md says 1; see inbox) |
| `default-travel-minutes` | i | 30 | 0–240 | D-006 |
| `headsup-display-seconds` | i | 15 | 5–120 | PRD §3 |
| `snooze-minutes` | i | 2 | 1–30 | PRD §3 |
| `takeover-snooze-minutes` | i | 1 | 1–10 | PRD §3 |
| `cutoff-minutes` | i | 10 | 0–60 | PRD §3 |
| `large-meeting-size` | i | 15 | 2–500 | PRD §1 |
| `extra-important-words` | as | `[]` | — | PRD §6 |
| `extra-ignore-words` | as | `[]` | — | PRD §6 |
| `owner-domains` | as | `[]` | — | PRD §6 (empty = detect) |
| `extra-owner-addresses` | as | `[]` | — | **PRD §6, D-009 (added; not in data.md — see inbox)** |
| `sound-enabled` | b | true | — | PRD §6 |
| `verdict-overrides` | a{ss} | `{}` | — | data.md |
| `mode-overrides` | a{ss} | `{}` | — | data.md |
| `travel-times` | a{si} | `{}` | — | data.md |
| `alert-state` | s | `''` | — | data.md |

`metadata.json`, exactly these keys:
- `"uuid": "payattention@tonymalandain.github.io"`
- `"name": "payAttention"`
- `"description": "Makes sure you do not miss the meetings that matter: judges each meeting, escalates to a full-screen alert on every monitor, and never relies on notifications."`
- `"shell-version": ["50"]`
- `"settings-schema": "org.gnome.shell.extensions.payattention"`

There is no `session-modes` key (ADR-0005) and no `url` key.

## Visual design (`extension/stylesheet.css`)

These are the cards' own classes, distinct from GNOME's `.notification-banner`. They
must never reuse shell notification classes. The values are fixed:

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

There are no repair steps; the code is new. Pure modules are built test-first under
Node; shell and UI actors are built against the smoke test, which is written before
them.

### Step 0 — Confirm the ground  [prerequisite, no code]
- Check that PG-1a and PG-1b are merged: `package.json`, `eslint.config.js`,
  `extension/core/…`, `extension/helper/…`, and `npm run lint && npm test && npm run test:helper` pass.
- Read core's exports and fill in the "Core surface" table in your head. Use the real
  names from here on.
- Note PG-1b's helper entry file name for `HELPER_ENTRY`.
- Note PG-1a's unit-test file naming and assertion style. Every new test file below
  follows it (names below assume `*.test.js`).
- **Stop** if any role in the "Core surface" table is missing (except
  occurrence-time-from-key, which you add).

### Step 1 — Display helpers  [feature]
- **Test first:** `tests/unit/display.test.js`, one test per bullet of the
  `core/display.js` behaviour list. It fails with "module not found", proving it
  imports the right path.
- **Then:** `extension/core/display.js` exactly as specified. It imports nothing.
- **Why here:** pure formatting shared by `shell/view.js` and `prefs.js`.
- **Behaviour change:** none visible yet.

### Step 2 — Freshness, restart delay, sound edge  [feature]
- **Test first:** `tests/unit/health.test.js`, `tests/unit/backoff.test.js`, `tests/unit/sound-cue.test.js`.
  - Health: waiting < 15 min; stale at exactly 15 min with `since = startedAt`; ok after a fresh snapshot; stale again 15 min after `lastGoodAt` with `since = lastGoodAt`; `isFreshSnapshot` with no sources (true), one ok and one failing (true), all failing (false).
  - Backoff: the sequence 1 s, 2 s, 4 s, … capped at 300 s; a reset after a 10-min run.
  - Sound: null → step 3 (true); same key and step (false); step 3 → step 4 (true); step 4 → hidden → step 4 (true); step 2 (false); a different key at step 3 (true).
- **Then:** `extension/shell/health.js`, `backoff.js`, `soundCue.js` as specified. No `gi://` imports.
- **Behaviour change:** none visible yet.

### Step 3 — Schema and metadata  [feature]
- **Test first:** run `glib-compile-schemas --strict --dry-run extension/schemas`. It fails with no schema file.
- **Then:** write the schema XML exactly per the table, and `extension/metadata.json`.
- **Check:** the dry-run passes. Then
  `glib-compile-schemas --targetdir=<scratch dir on the home fs> extension/schemas && GSETTINGS_SCHEMA_DIR=<scratch> gsettings list-recursively org.gnome.shell.extensions.payattention`
  shows the defaults: `inperson-insist-minutes 2` and `inperson-takeover-minutes 0`.

### Step 4 — The display model  [feature]
- **Test first:** `tests/unit/view.test.js`. Set `process.env.TZ = 'UTC'` before any
  import. Use judged objects from core's own `judge` on a small synthetic snapshot
  built in the test, so the shapes are real, and hand-built Plan objects in core's
  Plan shape. One test per rule in the `view.js` section:
  - test takes precedence
  - takeover vs card
  - travel only for in-person at steps 1–2
  - `canJoin`
  - `offerSeries` false for the test
  - the "also" text
  - indicator text, `highlighted` while hidden-but-active, `flashing` only at step 3 card
  - `warning` when stale
  - the today filter (a meeting at local 13:00 today is listed; one ending before now and one tomorrow at 09:00 are not)
  - sort order
  - the status strings for waiting, stale, ok-with-no-rows, and ok-with-rows (null)
  - the signature changes when a verdict changes and stays the same when only `now` moves by 1 s
- **Then:** `extension/shell/view.js`.
- **Behaviour change:** none visible yet.

### Step 5 — The controller  [feature]
- **Test first:** `tests/unit/controller.test.js`, with fakes for every port:
  - a fake store backed by plain objects that records calls;
  - a fake feed with settable `snapshot`/`lastGoodAt`/`startedAt` and a `refresh` spy;
  - a fake environment with a settable `active`;
  - a fake UI that records `render` views and counts `playAlertSound`/`releaseTakeover`/`destroy`, and can be told to throw;
  - a fake ticker that exposes `fire()`;
  - a fake `launchUri` that stores `onDone`;
  - `now` read from a variable.

  The snapshot holds one must-attend online meeting, built so core's rules make it
  must-attend (for example an important word in the title, the owner as organiser,
  and 2 other guests), with a join link.

  Tests, one each:
  1. Construction renders once with `menu.status === 'Reading calendars…'` and no alert, and creates the ticker.
  2. After `onUpdate` and a tick 25 min before the start: `alert.step === 1`, `presentation === 'card'`, and the indicator has text.
  3. 30 s before the start: `presentation === 'takeover'`, step 4.
  4. `ack` → the next render has `alert === null`, and `writeAlertState` was called with that key done.
  5. `snooze` at step 4 → the alert is null; after `now += takeover snooze + 1 s`, the alert is back.
  6. `join` → `launchUri` is called with the join URL; nothing is acknowledged until `onDone(true)`; `onDone(false)` leaves the alert up.
  7. `setVerdict` with scope `occ` writes the occurrence key and scope `series` writes the series key; `null` is passed through.
  8. `setMode` and `setTravel` reach the store with the given values.
  9. The sound plays once when step 3 first shows, not on the next tick, once more at step 4, and never when `readSoundEnabled()` is false.
  10. When `ui.render` throws, `releaseTakeover` is called; `console.error` is called once for two identical consecutive failures (spy on it); a later tick renders normally.
  11. `runTestAlert` → `alert.isTest`; advancing `now` over the test ladder reaches step 4; `ack` on the test key never calls `writeAlertState`; afterwards the alert is null. `setVerdict` on the test key ends the test and writes nothing.
  12. With step 1 visible and the environment active, `writeAlertState` records `headsUpShownAt`; with the environment inactive, nothing is recorded.
  13. `onResume` → `feed.refresh('resume')`.
  14. With `lastGoodAt` null and `now = startedAt + 15 min`, `indicator.warning` is true and `menu.status` starts with `'Calendar not updating since'`.
  15. A store change (the fake returns a new verdict override and fires `onChange`) → the next render shows the new verdict in `menu.meetings`.
  16. `destroy()`: every part is destroyed even when `ticker.destroy` throws; `ui.destroy` is still called; a second `destroy()` is a no-op; a `launchUri` `onDone` after destroy does nothing.
  17. A constructor failure (the `createUi` fake throws): the already-built store, environment and feed are destroyed, and the error propagates.
- **Then:** `extension/shell/controller.js` as specified.
- **Why here:** the controller is the orchestrator named in `overview.md`.
- **Behaviour change:** none visible yet.

### Step 6 — Store, with a GJS check  [feature]
- **Test first:** `tests/smoke/store-check.js`, a GJS module run by `scripts/smoke.sh`
  before the shell. It prints `PAYATTENTION-STORE PASS|FAIL <reason>`. It uses
  `GSETTINGS_BACKEND=memory`, with `GSETTINGS_SCHEMA_DIR` pointing at schemas compiled
  into the smoke run directory, and a `GLib.MainLoop` to let timers run. Checks:
  - defaults read back through `readTiming`/`readJudgeConfig`;
  - `setVerdictOverride` add, overwrite and delete (null) round-trip;
  - `setTravel`;
  - three quick `writeAlertState` calls produce exactly one `changed::alert-state` emission after about 500 ms (count with a `changed::alert-state` handler);
  - `destroy()` with a pending write flushes it synchronously;
  - a corrupt `alert-state` string → an empty state;
  - `pruneOccurrenceOverrides` removes an `occ:` key 8 days old, keeps one 6 days old, and keeps `series:` keys;
  - `onChange` is not called for `alert-state` but is called for `sound-enabled`.
- **Then:** `extension/shell/store.js`.

### Step 7 — Feed, environment, ticker, launcher  [feature]
- **Test:** covered by the smoke test (Step 9): the helper's snapshot reaches the menu,
  and the helper is gone after `disable()`. The pure decisions in these files (backoff
  and freshness) were tested in Step 2.
- **Then:** `extension/shell/calendarFeed.js`, `environment.js`, `ticker.js` and `launcher.js`, exactly as specified.

### Step 8 — Build script and npm scripts  [feature]
- `scripts/build.sh` (bash, `set -euo pipefail`, runs from the repo root, which it
  resolves from its own path):
  1. `glib-compile-schemas --strict --dry-run extension/schemas`
  2. `mkdir -p dist`
  3. `gnome-extensions pack extension --extra-source=core --extra-source=helper --extra-source=shell --extra-source=ui --force --out-dir=dist`
  4. `test -f dist/payattention@tonymalandain.github.io.shell-extension.zip`
- `package.json` scripts: add `"build": "bash scripts/build.sh"`,
  `"smoke": "bash scripts/smoke.sh"` and `"install:local": "bash scripts/install.sh"`.
  **Never name a script `install`**: npm runs it on `npm install`/`npm ci`.
- `.gitignore`: add `.smoke-home/` (and `dist/` if PG-1a did not).
- **Check:** `npm run build` produces the zip. `unzip -l` lists `core/`, `helper/`,
  `shell/`, `ui/`, `schemas/…gschema.xml`, `stylesheet.css`, `metadata.json`,
  `extension.js` and `prefs.js` (pack needs `prefs.js` only once it exists, which is
  Step 11).

### Step 9 — Smoke test, written before the UI  [feature: the failing test]
- `tests/smoke/alert-ladder.js`: an ES module exporting `async function run()`, using
  `Scripting.sleep` from `resource:///org/gnome/shell/ui/scripting.js`, `Main`, `St`,
  `Clutter`, `GLib` and `Gio`. The whole body is wrapped in try/catch. On any failed
  check it prints `PAYATTENTION-SMOKE FAIL <reason>` and returns. At the end it prints
  `PAYATTENTION-SMOKE PASS`.

  Helpers (test code):
  - `waitFor(pred, timeoutMs, stepMs = 200)`.
  - `findByName(actor, name)` and `countByPrefix(global.stage, 'payattention')` (recursive over `get_children()`).
  - `helperPids()`: enumerate `/proc`; for numeric entries read `cmdline` with `GLib.file_get_contents`, turning `\0` into spaces; match `payattention@tonymalandain.github.io/helper/`.
  - `clickActor(actor)`: create a virtual pointer with `Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE)`, then `notify_absolute_motion` to the centre from `get_transformed_position()` and `get_transformed_size()`, sleep 100 ms, then `notify_button` pressed and released with `Clutter.BUTTON_PRIMARY`.
  - `pressKey(keyval)`: a virtual keyboard with `notify_keyval` pressed and released.
  - `ourModalEntries()`: `Main.modalActorFocusStack.filter(r => r.actor?.name?.startsWith('payattention'))`.

  Checks, in order. Each has a timeout; on timeout, FAIL with the check name.
  1. `ext = Main.extensionManager.lookup('payattention@tonymalandain.github.io')` reaches `state === 1` within 10 s, and `ext.error` is empty.
  2. `Main.panel.statusArea.payattention` exists. Within 20 s the label `payattention-menu-status` reads `'No more meetings today'`, which proves `hello` and a fresh snapshot went through feed → controller → UI. `helperPids().length === 1`.
  3. `ext.stateObj.runTestAlert()`. Poll every 200 ms for up to 45 s. Record each step seen from the card's style class (`payattention-card-step1..3`) until an actor named `payattention-takeover` exists. Require steps 1, 2 and 3 to have been seen.
  4. Takeover:
     - Its parent is `Main.layoutManager.modalDialogGroup`.
     - It has children `payattention-takeover-monitor-0` and `-1`, and `Main.layoutManager.monitors.length === 2`.
     - Each panel is mapped, and its transformed position and size equal its monitor's `x, y, width, height`.
     - `global.stage.get_grab_actor()` is the takeover root.
     - `ourModalEntries().length === 1`.
     - There is no `payattention-card`.
  5. `pressKey(Clutter.KEY_Escape)`, sleep 500 ms. The takeover and the grab are unchanged.
  6. Wait until 1 500 ms have passed since the takeover appeared (arming). Then `clickActor` the `payattention-action-ack` button inside `payattention-takeover-monitor-1`, the second monitor. Within 2 s:
     - no `payattention-takeover` or `payattention-card` actor exists;
     - `ourModalEntries().length === 0`;
     - `global.stage.get_grab_actor()` is null or its name does not start with `payattention`.

     Sleep 3 s; still no alert actors (the test was acknowledged).
  7. `Main.extensionManager.disableExtension(uuid)`, then wait up to 5 s for `state === 2`. Then:
     - `countByPrefix === 0`;
     - `Main.panel.statusArea.payattention === undefined`;
     - `ourModalEntries().length === 0`;
     - `helperPids().length === 0` within 3 s.
  8. **Lock path, with a live takeover.** `enableExtension(uuid)` → `state === 1` within 10 s → `runTestAlert()` → wait up to 45 s for `payattention-takeover` → `disableExtension(uuid)` → `state === 2`. Then repeat the checks from 7, plus `global.stage.get_grab_actor()` not ours.
- `scripts/smoke.sh` (bash, `set -euo pipefail`):
  1. `ROOT` = the repo root.
  2. `: "${ROOT:?}"`; `rm -rf "$ROOT/.smoke-home"`; `T="$ROOT/.smoke-home"` (on the home fs, never `/tmp`, per testing-and-build.md).
  3. `bash "$ROOT/scripts/build.sh"`.
  4. **Store check:**
     - `mkdir -p "$T/schemas"`
     - `glib-compile-schemas --targetdir="$T/schemas" "$ROOT/extension/schemas"`
     - `GSETTINGS_SCHEMA_DIR="$T/schemas" GSETTINGS_BACKEND=memory gjs -m "$ROOT/tests/smoke/store-check.js" | tee "$T/store.log"`
     - `grep -q '^PAYATTENTION-STORE PASS' "$T/store.log"`, else exit 1.
  5. `mkdir -p "$T/data/gnome-shell/extensions" "$T/config/glib-2.0/settings" "$T/cache"`; `XDG_DATA_HOME="$T/data" gnome-extensions install --force "$ROOT/dist/payattention@tonymalandain.github.io.shell-extension.zip"`.
  6. Write `$T/config/glib-2.0/settings/keyfile`:
     ```
     [org/gnome/shell]
     enabled-extensions=['payattention@tonymalandain.github.io']
     welcome-dialog-last-shown-version='999'

     [org/gnome/desktop/notifications]
     show-banners=false
     ```
     `show-banners=false` is Do Not Disturb, so the smoke also proves R-12.
  7. `XDG_CONFIG_HOME="$T/config" XDG_DATA_HOME="$T/data" XDG_CACHE_HOME="$T/cache" GSETTINGS_BACKEND=keyfile timeout 300 dbus-run-session -- gnome-shell --headless --virtual-monitor 1280x720 --virtual-monitor 1024x768 --wayland-display "pa-smoke-$$" --automation-script "$ROOT/tests/smoke/alert-ladder.js" > "$T/shell.log" 2>&1 || true`
  8. Print every `PAYATTENTION-` line.
  9. Fail (exit 1) unless `^PAYATTENTION-SMOKE PASS` is present. Also fail if any line matches `JS ERROR`, or `JS WARNING.*payattention`, or `payattention: (tick-failed|destroy-failed|grab-failed)`. On failure, print the last 80 lines of `shell.log`.
- `eslint.config.js`: if PG-1a's config does not already cover `tests/smoke/**/*.js`, add a block with the gjs globals (`global`, `log`, `logError`, `print`, `console`) and no import restrictions. Also make sure `shell/`, `ui/`, `extension.js` and `prefs.js` blocks exist exactly per the `boundaries.md` import table (add the missing ones only).
- **Expected now:** `npm run smoke` fails at check 1 or 2. That is the failing test the UI steps turn green.

### Step 10 — UI and composition root  [feature]
- **Then**, in this order, each as specified in "Seams":
  1. `ui/alertContent.js`
  2. `ui/card.js`
  3. `ui/takeover.js`
  4. `ui/indicator.js`
  5. `ui/ui.js`
  6. `extension/stylesheet.css`
  7. `extension/extension.js`

  Run `npm run smoke` after each of `ui.js` and `extension.js`, until it passes.
- **Why here:** `ui/` draws and reports; `extension.js` composes.
- **Behaviour change:** the product is visible: indicator, menu, cards, takeover, sound.

### Step 11 — Preferences window  [feature]
- `extension/prefs.js`:

  ```js
  export default class PayAttentionPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) { … }
  }
  ```

  It imports `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`, `gi://Adw`,
  `gi://Gtk`, `gi://Gio` and `../core/…`: `core/display.js` and core's word lists.

  Setup:
  - `const settings = this.getSettings();`
  - Keep it alive with `window._settings = settings`.

  Integer rows:
  - Each integer row is an `Adw.SpinRow` whose adjustment `lower`/`upper` come from
    `settings.settings_schema.get_key(key).get_range().recursiveUnpack()[1]`, with
    `step_increment` 1 (5 for travel), bound with
    `settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT)`.

  List rows:
  - Each list row is an `Adw.EntryRow` with `show_apply_button: true`. Its text is
    `settings.get_strv(key).join(', ')`.
  - On `apply`, it writes `settings.set_strv(key, normalized)` and sets the row text
    to `normalized.join(', ')`. `normalized` is:
    - `parseList(text)` for the word lists;
    - `normalizeDomains(parseList(text))` for `owner-domains`;
    - `normalizeAddresses(parseList(text))` for `extra-owner-addresses`.

  **Page "Alerts"** (`icon_name: 'alarm-symbolic'`):
  - **Group "Online meetings"** (description "Minutes before the start"): Heads-up, Nudge, Insist, Takeover → the `online-*` keys.
  - **Group "In-person meetings"** (description "Minutes before you must leave"): the same four rows → the `inperson-*` keys, plus "Default travel time (minutes)" → `default-travel-minutes`.
  - **Group "Behaviour":**
    - "Heads-up stays for (seconds)"
    - "Snooze (minutes)"
    - "Snooze during takeover (minutes)"
    - "Stop alerting after the start (minutes)" → `cutoff-minutes`
    - `Adw.SwitchRow` "Sound at insist and takeover" → `sound-enabled`, bound to `active`

  **Page "Judgment"** (`icon_name: 'emblem-important-symbolic'`):
  - **Group "Meetings":** SpinRow "Large meeting: more than this many guests" → `large-meeting-size`.
  - **Group "Words":**
    - EntryRow "Extra important words" with the subtitle-like description on the group: `Built in: ` + core's important words joined with ", ".
    - EntryRow "Extra ignore words" with the same kind of description.

    Adw.EntryRow has no subtitle. Put both built-in lists in the group description.
  - **Group "You":**
    - EntryRow "Your email domains (empty = detect from your calendars)" → `owner-domains`.
    - EntryRow "Extra addresses of yours" → `extra-owner-addresses`.
  - **Group "Saved choices":**
    - `Adw.ButtonRow` "Clear meeting overrides" → `settings.reset('verdict-overrides'); settings.reset('mode-overrides')`.
    - `Adw.ButtonRow` "Clear travel times" → `settings.reset('travel-times')`.

  It never touches `alert-state`.
- **Test:** no automated GTK test. Checks:
  - `npm run lint` passes the prefs import rules;
  - after install, `gnome-extensions prefs payattention@tonymalandain.github.io` opens with no errors in `journalctl --user -b -o cat | grep -i payattention`;
  - changing "Heads-up" (online) to 25 shows in `dconf read /org/gnome/shell/extensions/payattention/online-headsup-minutes`.

### Step 12 — Install script and installation  [feature]
- `scripts/install.sh` (bash, `set -euo pipefail`):
  1. `UUID=payattention@tonymalandain.github.io`
  2. `bash "$ROOT/scripts/build.sh"`
  3. `gnome-extensions install --force "$ROOT/dist/$UUID.shell-extension.zip"`, which goes to `~/.local/share/gnome-shell/extensions/$UUID/` and compiles the schemas. Verified on this machine: install from home-fs to home-fs works with the default `TMPDIR`.
  4. `test -f ~/.local/share/gnome-shell/extensions/$UUID/schemas/gschemas.compiled`
  5. Mark it enabled for the next login with a GJS one-liner:

     ```sh
     gjs -c "const {Gio} = imports.gi; const s = new Gio.Settings({schema_id: 'org.gnome.shell'}); const u = '$UUID';
       const e = s.get_strv('enabled-extensions'); if (!e.includes(u)) s.set_strv('enabled-extensions', [...e, u]);
       const d = s.get_strv('disabled-extensions'); if (d.includes(u)) s.set_strv('disabled-extensions', d.filter(x => x !== u));
       Gio.Settings.sync();"
     ```

     If `gsettings get org.gnome.shell disable-user-extensions` is `true`, print a warning. Do not change it.
  6. Print:

     ```
     Installed payattention@tonymalandain.github.io. On Wayland, log out and back in to load it. Then check: gnome-extensions info payattention@tonymalandain.github.io
     ```
- **Run it:** `npm run install:local` on the author's machine, as the ticket's "Done when" requires.

### Step 13 — Full validation  [verification]

Run in order. Each must pass:

```sh
npm run lint
npm test
npm run build
npm run test:helper
npm run smoke
npm run install:local
```

Then confirm by hand what headless cannot show, per `testing-and-build.md` layer 4 — after the owner logs out and in:
- `gnome-extensions info payattention@tonymalandain.github.io` shows State ACTIVE;
- the journal is clean: `journalctl --user -b -o cat /usr/bin/gnome-shell | grep -iE 'payattention|JS ERROR'`;
- the checklist in `testing-and-build.md`.

The engineer cannot log out in an unattended run, so report the manual items as
"pending owner check", not as passed.

## Callers to update

- **`package.json` scripts** (created by PG-1a): add `build`, `smoke` and `install:local`. The callers are the validation sequence in `CLAUDE.md` and `testing-and-build.md`. Names match the contract; `install:local` is new.
- **`eslint.config.js`** (created by PG-1a): add blocks only where they are missing (Step 9).
- **Core keys module:** add `occurrenceTimeFromKey`, only if absent. No existing caller changes.
- **GSettings schema:** new; its readers are the store and `prefs.js`, both written here.
- **interfaces.md §3 (internal contract) is reshaped:**
  - the UI calls one `dispatch(action)` instead of eight callbacks;
  - `headsUpShown` is recorded by the controller (step 1 visible and owner active), not reported by the UI;
  - the UI receives a resolved `View`, not a raw Plan plus judged occurrences.

  All callers are in this ticket. §3 is marked internal, so the senior engineer may do this; it is recorded in the inbox for the architect.
- **No caller outside this repository.** The smoke test calls `runTestAlert()` as interfaces.md §4 states.

## Out of scope

- Any change to `extension/core/` rules (judge, plan, reduce, keys, protocol) or to `extension/helper/`. If one looks wrong, stop (see below).
- The message tray, `Main.notify`, `MessageTray.Source`, or any notification API (ADR-0004, R-12).
- The `unlock-dialog` session mode, or drawing anything while locked (ADR-0005).
- Any new npm or system dependency.
- A "refresh calendars" menu item, per-source error lines in the menu, live travel estimates, and editing calendar events.
- Renaming or retyping any key in data.md. The only schema change is the added `extra-owner-addresses`.
- Architecture documents. Findings go to `docs/inbox.md` only.
- A LICENSE file and publishing metadata (`url`, `version-name`).

## Stop and escalate if

- A role in "Core surface" is missing, or core's judged/Plan objects lack a field
  `view.js` needs (title, start, deadline, mode, joinUrl, recurring, place key, travel
  minutes/default, series key, the Plan's takeover flag or indicator target). Do not
  compute a missing field in `shell/`.
- The core test-alert factory returns a raw occurrence instead of a judged
  must-attend one, or its ladder is much longer than 45 s (the smoke timeouts assume
  about 30 s).
- Core's default in-person offsets disagree with the schema (D-008: 10/5/2/0). The
  schema values here are the product's.
- `Main.pushModal` returns something other than a Clutter grab in GNOME 50.4, or the
  smoke shows `get_grab_actor()` is not the takeover root while the takeover shows.
  Do not add workarounds that keep a grab alive by any other means.
- The helper cannot produce a snapshot inside the headless session (check 2 fails
  for reasons outside the feed). Report the helper's stderr from `shell.log`; do not
  weaken the check.
- Anything seems to need a `gi://` import in `controller.js`, `view.js`, `health.js`,
  `backoff.js`, `soundCue.js` or `core/display.js`.
- A GSettings key seems to need renaming or retyping.
