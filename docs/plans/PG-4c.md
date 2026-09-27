# Plan — PG-4c: the shell side of AI mode (ask the AI helper about each meeting, one at a time, soonest first; keep old answers while re-asking; fall back to the rules; retries, budget, stored answers, the helper's lifetime, and "AI:" / "AI unavailable — using rules" on screen)

Spec: `docs/prd/meeting-guardian.md`, "Addendum 2026-09-27 — AI mode" (R-18: AI mode judges every meeting; R-19: the owner connects the engine of their choice). Product decisions D-019 to D-030. Architecture: ADR-0010 (and what it carried over from ADR-0008), `interfaces.md` §6.1–§6.6 (above all §6.5, "Controller behaviour", which is binding), `data.md` ("AI answers", "Pruning"), `constraints.md` (Timing rows for AI), `testing-and-build.md` (Layer 1 "The controller is tested with fake AI clients", Layer 2b, Layer 3 item 8). The AI helper's protocol is exactly `interfaces.md` §6.6 and `docs/plans/PG-4b.md`.

**Sensitive: personal data.**
- Every `judge` line this code writes to the AI helper's stdin carries other people's names, email addresses and meeting text (D-020).
- `ai-verdicts` stores a model-written reason that may paraphrase a title or a name (`data.md`).
- Nothing in this ticket may log an invite, a title, a reason, the endpoint or anything read from a reply. Logs carry short codes only. The API key never passes through the shell (the helper reads it itself).

**The absolute rule of this ticket: no alert ever waits on the AI.** Built in by structure (the alert tick makes no call to the AI queue or the AI helper; see "Seams") and proven by the tests in Step 9.

## What changes, and for whom

- **Calendar owner, AI mode set up** (`verdict-source` = `ai`, a model, a usable endpoint):
  - each meeting that can be judged is asked about once, soonest first, one at a time;
  - its menu row and alerts read "AI: <reason>" once the answer arrives;
  - a changed invite keeps its previous AI answer while it is asked again;
  - when the engine fails, is slow, is over budget or cannot start, the rules decide and the menu says "AI unavailable — using rules";
  - answers survive a lock and unlock, so meetings are not asked again.
- **Rules mode** (the default): nothing changes. No process is started, no timer is added, nothing is sent, and `ai-verdicts` is not written (unless it holds entries older than 7 days, which are pruned as `data.md` says).

## The component

- **Responsible for:** `extension/shell/` runs the extension inside gnome-shell. It turns calendar data, stored choices and the clock into what the UI draws, and it supervises the helper processes.
- **The class it lands in:** `Controller` (`shell/controller.js`). It judges when its inputs change, plans on every tick, renders, routes the owner's actions, and owns every part's lifetime. §6.5 gives it the AI queue. This plan keeps the controller as the one orchestrator. It moves the AI decisions into a gi-free module of their own (`shell/aiQueue.js`). The process handling goes into a gi module modelled on `CalendarFeed` (`shell/aiHelperClient.js`). So the controller gains wiring, not a second job.
- **Has drifted by:**
  1. **`Store` has one hand-written write coalescer, tied to `alert-state`** (`store.js:12-13, 29-31, 78-87, 146-165`). `data.md` asks for `ai-verdicts` to be "coalesced, like alert state". Copying the timer and fields a second time would put two copies of the same mechanism in one class. Step 1 turns it into one per-key coalescer, with no change in behaviour.
  2. **The controller's Node test harness lives inside `controller.test.js`** (`tests/unit/controller.test.js:32-181, 580-592`). The AI tests need the same fakes. The repo splits tests by concern (`judge.test.js`, `judge.ai.test.js`, `judge.rulesMode.test.js`). Step 2 moves the harness into `tests/unit/support/`, with no change to any test.
  3. **Stored `ai-verdicts` has no reader or validator.** `judge` checks each entry it reads. But nothing parses, prunes or writes the stored value. The architect put this in core for PG-4c (`docs/architecture/NOTES.md`, "Parsing stored ai-verdicts belongs in core (PG-4c)"). Step 3 adds it, beside `alertState.js`, which is the same kind of thing.
- **This change belongs here because:** §6.5 assigns the queue, the withholding, the retries, the budget, the status and the helper's lifecycle to the controller. `boundaries.md` makes the store the only writer of `ai-verdicts`, on the controller's request. `view.js` owns every "what to show" decision, and `ui/` only draws. Core owns stored formats. Nothing here changes a boundary, adds a dependency, or touches a contract outside the repository.

## Design in one page

```
                alert ticker (1 s, existing)                 AI ticker (1 s, only while an engine is set up)
                          │                                                   │
Controller._tick ─► _render ─► _judgeAll(now) ─► plan ─► view      Controller._aiTick ─► AiQueue.pump(judged, cutoffMs)
                          ▲  reads this._ai (published data)                  │  sends ≤ 1 ask ─► AiHelperClient ─► gjs ai/main.js
                          │                                                   │
                          └──────── this._ai = state; _judgeDirty = true ◄── AiQueue.onChange(state)   (answer, failure, status change)
```

- **The alert tick never calls the AI queue or the AI helper client.**
  - It reads one controller field, `this._ai`: plain frozen data (status, stored answers, failed keys), like `this._overrides`.
  - The queue replaces that field through `onChange`. So nothing the AI does can delay, block or throw into `plan()` or the render.
  - The one exception is the daily prune (`_prune`), which already runs from the tick. It calls `AiQueue.prune()`, which is a pure in-memory filter plus a coalesced store write. It is wrapped so that it cannot throw. This is stated here so the reviewer sees it; it never talks to the helper.
- **The AI tick never renders or plans.** It hands the latest judged list to the queue. It does nothing while a re-judge is pending (`_judgeDirty`). So it never asks about an invite that an answer or a new snapshot has just made obsolete.
- **Withholding (§6.5) is exact, with a second `judge` pass only when needed.**
  - Pass 1 gives every stored answer to `judge` and learns which keys carry `aiAsk`.
  - Pass 2 runs only if one of those keys must be withheld: the AI is unavailable, or that key's own last ask failed. It gets the answers minus those keys.
  - Withholding never changes which keys carry `aiAsk` (with or without its entry, such a key still gets an `aiAsk`). So two passes always suffice.
  - Cost: a second pass only while something is withheld. That is while the AI is failing, when answers are not arriving, so re-judges are rare (a snapshot every 5 min, plus local edits). At the designed 2 000 occurrences that is at most 2 × the 200 ms AI-mode `judge` budget (`tests/unit/budget.test.js`). At the owner's 26 occurrences it is well under a millisecond.
- **Deciding apart from doing.** `AiQueue` decides what to ask, when, and what an outcome means. It takes `now` and an injected client, and it is tested under Node. `AiHelperClient` only spawns, writes, reads and reports. The watchdog is a decision (a timeout after `timeoutMs + 10 s`), so it lives in the queue and is tested under Node. The client only obeys `kill()`.

## Seams

New files start with the two SPDX lines every source file carries (`// SPDX-License-Identifier: Apache-2.0`, `// SPDX-FileCopyrightText: 2026 Tony Malandain`). PG-6 has landed; the PG-4b plan's "no SPDX header" line is out of date.

### `extension/core/aiAnswers.js` (new, pure core) — the stored `ai-verdicts` format

Imports `./keys.js` (`occurrenceKeyTime`, `isExpiredOccurrenceKey`) and `./aiProtocol.js` (`normaliseReason`) only.

```js
/**
 * Nothing stored.
 * @returns {import('./types.js').StoredAiAnswers} frozen
 */
export function emptyAiAnswers()

/**
 * Read the stored AI answers (data.md "AI answers"). Anything unreadable, or a `v` other than 1,
 * gives the empty value; an invalid item is dropped on its own. Never throws.
 * An item is kept only when: its key is an occurrence key with a time (occurrenceKeyTime(key) !== null);
 * fp is a string of 1 to 64 characters; verdict is 'must' or 'ignore'; reason is a string with
 * normaliseReason(reason) === reason; at is a finite number. A kept item holds exactly
 * {fp, verdict, reason, at}, in that order; other fields are dropped.
 * @param {string|null|undefined} text
 * @returns {import('./types.js').StoredAiAnswers} frozen, items frozen
 */
export function parseAiAnswers(text)

/** @returns {string} JSON.stringify(answers) */
export function serializeAiAnswers(answers)

/**
 * The answers with this occurrence's entry set (replaced if present), `at` = now.
 * @param {import('./types.js').StoredAiAnswers} answers not mutated
 * @param {string} key an occurrence key with a time
 * @param {{fp:string, verdict:'must'|'ignore', reason:string}} answer reason already normalised
 * @param {number} now
 * @returns {import('./types.js').StoredAiAnswers} frozen
 * @throws {TypeError} when the key, fp, verdict, reason (normaliseReason(reason) !== reason) or now is invalid,
 *   by the same rules parseAiAnswers keeps an item. The message names the field, never its value.
 */
export function recordAiAnswer(answers, key, answer, now)

/**
 * Drop entries whose occurrence time is more than the retention period past (isExpiredOccurrenceKey).
 * @returns {import('./types.js').StoredAiAnswers} the SAME object when nothing expired, else a new frozen one
 */
export function pruneAiAnswers(answers, now)
```

`extension/core/types.js` gains:

```js
/** @typedef {{fp:string,verdict:'must'|'ignore',reason:string,at:number}} StoredAiAnswer   one item of data.md "AI answers" */
/** @typedef {{v:1,items:Readonly<Record<string,Readonly<StoredAiAnswer>>>}} StoredAiAnswers   exactly data.md "AI answers"; items is a valid AiAnswers for judge */
```

**Misuse designed out:**
- An answer cannot be stored without `at`, with a non-occurrence key, or with an un-normalised reason: `recordAiAnswer` throws.
- A corrupt stored value can never reach `judge`, because `parseAiAnswers` keeps only valid items.
- `pruneAiAnswers` returns the same object when nothing changed. So "write only if pruned" is an identity check, and a caller cannot rewrite the key needlessly.

### `extension/shell/store.js` (changed)

```js
/**
 * The stored AI answers. A corrupt or partly invalid value is logged once
 * ('payattention: ai-verdicts-corrupt') and read as what could be kept.
 * @returns {import('../core/types.js').StoredAiAnswers}
 */
readAiAnswers()

/**
 * Store the AI answers, coalesced exactly like writeAlertState: written FLUSH_DELAY_MS after the
 * first of a burst, or at destroy(). Writing the text already stored does nothing.
 * @param {import('../core/types.js').StoredAiAnswers} answers
 */
writeAiAnswers(answers)
```

- Corruption is detected as `readAlertState` does it: `text !== '' && serializeAiAnswers(parsed) !== text`.
- `readAiAnswers` records the text it read as that key's last written value, so writing the same answers back does nothing (as `readAlertState` does).
- `ai-verdicts` is already in `INTERNAL_KEYS` (`settingsKeys.js:212`), so writing it never calls `onChange`. Do not change that list.

### `extension/shell/aiBudget.js` (new, gi-free, Node-tested)

```js
export const AI_REQUESTS_PER_HOUR = 120;
export const AI_REQUESTS_PER_DAY = 1000;

/** The rolling request budget per engine (constraints.md), in memory. */
export class RequestBudget {
    /** Nothing spent. */
    constructor()
    /**
     * Spend one request for this engine at `now` when both rolling windows allow it.
     * A spend at time t counts in the hour window while t > now − 3 600 000, and in the
     * day window while t > now − 86 400 000. Allowed when the hour count < 120 and the day count < 1000.
     * Spends older than 24 h are forgotten on each call.
     * @param {string} engineTag
     * @param {number} now epoch ms
     * @returns {boolean} true when spent (the request may be sent); false when over budget, and nothing is spent
     */
    trySpend(engineTag, now)
}
```

**Misuse designed out:** there is no separate `allows()` and `record()`, which could be called apart or in the wrong order. Checking and spending are one call.

### `extension/shell/aiQueue.js` (new, gi-free, Node-tested)

Imports `../core/aiAnswers.js` and `./aiBudget.js` only. No `gi://` and no `resource://` import, so it runs under Node (`boundaries.md`, "Node-tested shell modules").

**Responsible for:** turning the judged meetings' AI asks into one request at a time. It keeps what the outcomes mean (stored answers, failures, status) for the controller to pass to `judge`.

```js
/** First wait after a failed ask for one occurrence; it doubles up to ASK_RETRY_MAX_MS (constraints.md). */
export const ASK_RETRY_FIRST_MS = 60_000;
export const ASK_RETRY_MAX_MS = 1_800_000;
/** Engine pause after 'auth', 'config' or 'no-key'. */
export const ENGINE_PAUSE_MS = 1_800_000;
/** Engine pause after 'rate-limited' without retryAfterS; with it, retryAfterS s capped at ENGINE_PAUSE_MS. */
export const RATE_LIMIT_PAUSE_MS = 300_000;
/** The shell's watchdog: an ask unanswered for engine.timeoutMs + this is a 'timeout'. */
export const WATCHDOG_GRACE_MS = 10_000;

/** @typedef {NonNullable<ReturnType<typeof import('../core/aiEngine.js').aiEngine>>} AiEngine */
/**
 * What the AI helper client reports for one ask. 'lost' = the helper could not start, or exited
 * or broke the protocol with the ask outstanding; it is not the engine's answer about this invite.
 * @typedef {{type:'verdict', verdict:'must'|'ignore', reason:string}
 *   | {type:'failed', code:string, retryAfterS?:number}
 *   | {type:'lost'}} AiOutcome
 */
/**
 * The AI helper, as the queue uses it (implemented by AiHelperClient; faked in tests).
 * @typedef {object} AiClientPort
 * @property {boolean} ready true when ask() may be called
 * @property {(invite: import('../core/types.js').Invite, onDone: (outcome: AiOutcome) => void) => void} ask
 *   onDone is called exactly once and never synchronously inside ask(), unless kill() or destroy() comes first
 * @property {() => void} kill drops the outstanding ask (onDone never called) and stops the helper; a later ask() respawns it
 * @property {() => void} destroy stops the helper for good; no callback afterwards
 */
/**
 * What the controller passes to judge, published by the queue on every change. Frozen; never mutated.
 * @typedef {Readonly<{status:'off'|'ok'|'unavailable',
 *   answers: import('../core/types.js').AiAnswers,
 *   failedKeys: ReadonlySet<string>}>} AiState
 *   answers: the stored items (entries carry `at`, which judge ignores);
 *   failedKeys: occurrence keys whose own most recent ask failed
 */

/**
 * @param {number|null} previousMs the last wait for this occurrence, or null after none or a success
 * @returns {number} ASK_RETRY_FIRST_MS for null, else min(previousMs * 2, ASK_RETRY_MAX_MS)
 */
export function nextAskRetryMs(previousMs)

/**
 * judge's config.ai for this engine (interfaces.md §6.4).
 * @param {AiEngine|null} engine from aiEngine(settings)
 * @param {number} now
 * @returns {import('../core/types.js').AiJudgeConfig|null} null for null; else {engineTag: engine.engineTag,
 *   utcOffsetMinutes: the local offset at now, east positive, as −Date#getTimezoneOffset(), with −0 written as 0}
 */
export function aiJudgeConfig(engine, now)

/**
 * The answers judge's second pass gets (§6.5): the entry of every key in `judged` that carries aiAsk and has
 * an entry is withheld when ai.status is 'unavailable', or when ai.failedKeys has that key.
 * @param {ReadonlyArray<import('../core/types.js').JudgedOccurrence>} judged the output of a judge pass given ai.answers
 * @param {AiState} ai
 * @returns {import('../core/types.js').AiAnswers|null} null when nothing is withheld (the first pass stands);
 *   else a frozen copy of ai.answers without the withheld keys
 */
export function withholdAnswers(judged, ai)

export class AiQueue {
    /**
     * Holds no engine (status 'off') and creates no client until setEngine() gives one.
     * @param {object} p
     * @param {import('../core/types.js').StoredAiAnswers} p.answers what the store holds now
     * @param {(answers: import('../core/types.js').StoredAiAnswers) => void} p.writeAnswers the store's coalesced write
     * @param {(engine: AiEngine) => AiClientPort} p.createClient
     * @param {(state: AiState) => void} p.onChange called after every change of state(), never during construction, never after destroy()
     * @param {() => number} p.now
     * @throws {TypeError} when a function is missing or answers is not a StoredAiAnswers ({v:1, items:object})
     */
    constructor({ answers, writeAnswers, createClient, onChange, now })

    /** @returns {AiState} the current state (the same object onChange last passed, or the initial one) */
    get state()

    /**
     * The engine to use, from aiEngine(settings). The same engineTag (or null again) does nothing.
     * Otherwise it destroys the client, forgets the ask in flight, every per-occurrence retry, the
     * engine pause, the unavailable flag and the once-only log set, and creates a client for the new
     * engine (none for null). The budget is kept (it is per engineTag). Publishes the new state.
     * @param {AiEngine|null} engine
     */
    setEngine(engine)

    /**
     * One step of the queue, called every second by the AI ticker. It sends at most one ask. See "pump" below.
     * @param {ReadonlyArray<import('../core/types.js').JudgedOccurrence>} judged the latest judge output, in judge order
     * @param {number} cutoffMs timing.cutoffMs
     */
    pump(judged, cutoffMs)

    /** Drops stored answers past retention (pruneAiAnswers), writing and publishing only when something went. */
    prune()

    /** Destroys the client. Idempotent; nothing is written or published afterwards. */
    destroy()
}
```

**`pump(judged, cutoffMs)`, in this order** (`now = this._now()` once):
1. Return if destroyed, if there is no engine, or if there is no client (its creation failed).
2. **Watchdog.** If an ask is in flight, and `now − sentAt ≥ engine.timeoutMs + WATCHDOG_GRACE_MS`: call `client.kill()`, then settle that ask as `{type:'failed', code:'timeout'}` (below). In either case, return.
3. Return if `now < pausedUntil`.
4. **Pick.** Walk `judged` in its order (judge sorts by start, then key, so the first match is the soonest). Take the first `j` where:
   - `j.aiAsk !== undefined`;
   - `j.start !== null && j.start >= now − cutoffMs`;
   - there is no retry record for `j.key`, or its `retryAt ≤ now`.

   Return if there is none.
5. Return if `!client.ready`. Nothing is spent, and the status does not change.
6. `budget.trySpend(engine.engineTag, now)`. On `false`: if not already unavailable, set unavailable and publish; return.
7. **Send.**
   - `token = {key: j.key, fp: j.aiAsk.fp, sentAt: now}`;
   - `inFlight = token`;
   - `client.ask(j.aiAsk.invite, outcome => this._settle(token, outcome))`.
   - If `ask` throws: log once (`payattention: ai-failed ask`), then settle the token as `{type:'lost'}`.

**Settling an outcome (`_settle(token, outcome)`)** does nothing if destroyed or if `token !== inFlight`. Otherwise it sets `inFlight = null` and continues. The whole body is in `try/catch`. On an exception it logs once (`payattention: ai-failed settle`), sets unavailable and publishes.
- **`verdict`:**
  - `answers = recordAiAnswer(answers, token.key, {fp: token.fp, verdict, reason}, now)`;
  - `writeAnswers(answers)`;
  - delete the retry record of `token.key`;
  - clear unavailable;
  - publish.
- **`failed`:**
  - the retry record of `token.key` becomes `{waitMs: w, retryAt: now + w}`, where `w = nextAskRetryMs(previous waitMs or null)`;
  - if the code is `auth`, `config` or `no-key`: `pausedUntil = max(pausedUntil, now + ENGINE_PAUSE_MS)`;
  - if the code is `rate-limited`: `pausedUntil = max(pausedUntil, now + (retryAfterS === undefined ? RATE_LIMIT_PAUSE_MS : min(retryAfterS * 1000, ENGINE_PAUSE_MS)))`;
  - set unavailable;
  - `console.warn('payattention: ai-request-failed <code>')`, once per code per engine;
  - publish.
- **`lost`:**
  - set unavailable, with no retry record;
  - `console.warn('payattention: ai-helper-lost')`, once per engine;
  - publish.
  - Why no retry record: the client's restart delay (1 s, doubling to 5 min) already limits the next ask, and a lost helper is not an answer about this invite.

**Status:** `'off'` when there is no engine, `'unavailable'` while the unavailable flag is set, else `'ok'`.
- The flag is set by a failure, a lost helper, a client that could not be created, or a budget refusal.
- It is cleared only by a verdict or by `setEngine`. This is §6.5's "and nothing has succeeded since", word for word.

**Publish:** `state = Object.freeze({status, answers: answers.items, failedKeys: new Set(retryRecords.keys())})`, then `onChange(state)`.

**Client creation** in `setEngine` is in `try/catch`. On an exception it logs once (`payattention: ai-failed client`), leaves the client null and sets unavailable. There is no retry until the engine changes.

**Misuse designed out:**
- **Configure before judge** is gone from this seam: a client is made per engine, and it configures itself.
- **Two asks at once** cannot happen: the queue holds `inFlight`, and the client refuses `ask` while not `ready`.
- **An answer for an old engine or a killed ask** is ignored by the token check.
- **A forgotten watchdog** cannot happen: the watchdog is part of `pump`, so nothing else needs to arm it.
- **Budget check and spend** are one call.

### `extension/shell/aiHelperClient.js` (new, gi: `gi://Gio`, `gi://GLib`)

Imports `../core/aiProtocol.js` (`AI_PROTOCOL_VERSION`, `parseAiHelperLine`, `formatAiShellMessage`) and `./backoff.js` (`nextRestartDelayMs`). It spawns `ai/main.js` by path; it never imports `ai/` (lint forbids that).

**Responsible for:** keeping one AI helper process for one engine, and carrying one ask at a time to it and its outcome back.

```js
export class AiHelperClient {
    /**
     * Starts nothing: the first ask() spawns the helper.
     * @param {object} p
     * @param {string[]} p.argv ['gjs', '-m', '<extension dir>/ai/main.js']
     * @param {AiEngine} p.engine from aiEngine(settings); fixed for this client's life
     * @param {() => number} p.now
     */
    constructor({ argv, engine, now })
    /** @returns {boolean} not destroyed or stopped, no ask outstanding, and a helper is running or its restart delay has passed */
    get ready()
    /** @throws {Error} 'ai-helper-client: not ready' when !ready */
    ask(invite, onDone)
    kill()
    destroy()
}
```

Behaviour, all decided:
- **`ask(invite, onDone)`:**
  1. Throw when `!ready`.
  2. `id = 'r' + (++this._nextId)`. The ids are unique for the client's whole life, across respawns, and they match the protocol's id rule.
  3. `line = formatAiShellMessage({type:'judge', id, invite})`. If it throws, log `payattention: ai-invalid-request <e.message>` once. The message holds a code and a field path only. Then deliver `{type:'failed', code:'bad-request'}` later (below) and return. Nothing is spawned or written.
  4. If no helper is running, spawn one (below). If that fails, deliver `{type:'lost'}` later and return.
  5. Record `{id, onDone}` as outstanding, and write `line`.
- **Spawning:**
  1. Format the `configure` line: `{type:'configure', protocol: AI_PROTOCOL_VERSION, endpoint: engine.endpoint, model: engine.model, timeoutMs: engine.timeoutMs}`. If that throws, log `payattention: ai-invalid-configure`, stop the client for good (`ready` is false forever) and report failure.
  2. `Gio.Subprocess.new(argv, STDIN_PIPE | STDOUT_PIPE)`. stderr is inherited, so the helper's code-only diagnostics reach the journal, as for the calendar helper. If it throws, log `payattention: ai-spawn-failed <e.message>`, schedule a restart (below) with `ranForMs = 0`, and report failure.
  3. Record `spawnedAt`, make a new `Gio.Cancellable`, and start reading and waiting exactly as `CalendarFeed._spawn` does.
  4. Write the `configure` line. It is queued before the `judge` line, so the helper always sees `configure` first. `hello` is not waited for; it is checked when it arrives.
- **Writing:** one write in flight per process.
  - Lines are queued as `Uint8Array`s.
  - `write_bytes_async` writes the head. Its callback takes the count from `write_bytes_finish`: a short write puts back `chunk.subarray(n)` at the head, and then the next chunk is written.
  - A write error, or a callback for a process that is no longer current, empties the queue and does nothing else. The exit handler reports.
  - Never start a second `write_bytes_async` while one is pending: Gio refuses it ("pending operation").
- **Reading** (`read_line_async` / `read_line_finish_utf8`, as `CalendarFeed._readNext`), one line at a time through `parseAiHelperLine`:
  - `!ok` with code `protocol-mismatch` (a `hello` with another version):
    - log `payattention: ai-protocol-mismatch (want 1)` with `console.error`;
    - stop the client for good;
    - cancel, then `force_exit`;
    - deliver `{type:'lost'}` to the outstanding ask.
  - Any other `!ok`: `console.warn('payattention: ai-invalid-line <code>[ <field>]')`, once per code per process, and ignore the line. The watchdog in the queue ends the ask.
  - `hello`: nothing.
  - `verdict` / `failed` whose `id` is the outstanding one:
    - clear the outstanding ask;
    - call its `onDone` with `{type:'verdict', verdict, reason}`, or with `{type:'failed', code}` plus `retryAfterS` only when the line has it.
  - Any other id: `console.warn('payattention: ai-unexpected-reply')`, once per process, and ignore the line.
  - A read error other than CANCELLED: `console.warn('payattention: ai-read-failed <e.message>')`, and stop reading. The watchdog ends any outstanding ask.
- **Exit** (the `wait_async` callback, ignored when cancelled or destroyed):
  - log `payattention: ai-helper-exited status N` or `… signal N`, as the calendar feed does;
  - drop the process;
  - schedule a restart with `ranForMs = now − spawnedAt`;
  - if an ask is outstanding, clear it and call its `onDone({type:'lost'})`.
- **Restart delay:** `delay = nextRestartDelayMs(previousDelay, ranForMs)`; `restartAt = now + delay`. There is no timer. `ready` is false until `now ≥ restartAt`, and the next `ask` spawns.
- **"Later":** `GLib.idle_add(GLib.PRIORITY_DEFAULT, …)`. Its source id is kept in a set and removed when it runs. `kill()` and `destroy()` remove every pending one, so "never called after kill/destroy" also holds for these.
- **`kill()`:**
  - if a process runs: cancel, `force_exit()` (SIGKILL), schedule a restart with `ranForMs = now − spawnedAt`, and drop the process;
  - always: drop the outstanding ask without calling it, empty the write queue, and remove pending "later" sources.
- **`destroy()`:** as `kill()`, but with no restart: `ready` is false forever. Idempotent.
- **Never logged:** an invite, a line's content, a reason, the endpoint or the model. The codes above are the complete list.
- **Idle helper:** once spawned, the helper keeps running until `kill()`, `destroy()`, an exit or a mode or engine change. §6.5 lists those as the kill triggers. It does not kill an idle helper, so neither does this plan.

### `extension/shell/view.js` (changed)

```js
/** The menu line while the AI cannot be used (PRD addendum, "When the engine cannot be reached"). */
export const AI_UNAVAILABLE_TEXT = 'AI unavailable — using rules';   // U+2014 em dash
```

- `buildView(p)` takes one more field, **`p.aiStatus: 'off'|'ok'|'unavailable'`**. `View.menu` gains **`aiStatus: string|null`**: `AI_UNAVAILABLE_TEXT` when `p.aiStatus === 'unavailable'`, else `null`.
- **The reason line.** A new private `reasonLine(j)` gives `j.reason` unchanged when `j.reasonCode` is `'ai-must'` or `'ai-ignore'`, and `` `Why: ${j.reason}` `` otherwise.
  - Core already writes AI reasons as `"AI: " + reason` (`verdict.js` `aiVerdict`), so the row and the alert read exactly "AI: <reason>", as the spec words it, and never "Why: AI: …".
  - It is used for `MeetingRow.reason` (`view.js:93`) and `AlertView.reason` (`view.js:69`). Rule reasons are unchanged.
- Update the `View` typedef (`view.js:31-35`) for `menu.aiStatus`.

### `extension/ui/indicator.js` (changed)

- A second non-reactive status item, right after `this._status` (`indicator.js:50-53`):
  - `new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false})`;
  - `label.name = 'payattention-menu-ai-status'`, starting hidden.
- `update()`:
  - `this._aiStatus.visible = menu.aiStatus !== null`;
  - when it is not null, `setText(this._aiStatus.label, menu.aiStatus)`.
- It decides nothing.
- `ui/alertContent.js`, `card.js` and `takeover.js` need **no change**: they draw `alert.reason` as plain `St.Label` text (`alertContent.js:64, 99`), and the view now supplies "AI: …".

### `extension/shell/controller.js` (changed) — exact changes

- **New required deps.** Update the JSDoc (`controller.js:60-68`) for both:
  - `deps.createAiClient: (engine: AiEngine) => AiClientPort`;
  - `deps.createAiTicker: (onTick: () => void) => {destroy(): void}`.
- **First statement of the constructor, before any part is built:** throw `TypeError('controller: deps.createAiClient and deps.createAiTicker must be functions')` unless both are functions. So a composition root that forgets them fails at enable in any mode, not silently in AI mode only.
- **New fields**, set before the `try`:
  - `this._aiQueue = null`;
  - `this._aiTicker = null`;
  - `this._aiEngine = null`;
  - `this._ai = null`;
  - `this._aiErrors = new Set()`.
- **Construction order inside the `try`**, after `createUi` (`controller.js:90`) and before `_loadInputs()`:
  ```js
  this._aiQueue = new AiQueue({
      answers: this._store.readAiAnswers(),
      writeAnswers: answers => this._store.writeAiAnswers(answers),
      createClient: deps.createAiClient,
      onChange: state => this._onAiChange(state),
      now: deps.now,
  });
  this._ai = this._aiQueue.state;
  ```
- **`_loadInputs()`** (`controller.js:166-172`), at its end: `this._aiEngine = aiEngine(this._settings); this._syncAi();`
- **`_syncAi()`** (new, private):
  - `this._aiSafely('engine', () => this._aiQueue.setEngine(this._aiEngine))`;
  - with an engine and no AI ticker: `this._aiSafely('ticker', () => { this._aiTicker = this._deps.createAiTicker(() => this._aiTick()); })`;
  - with no engine and an AI ticker: destroy it inside `_aiSafely('ticker', …)`, then `this._aiTicker = null`.
- **`_aiTick()`** (new):
  - return if destroyed or `this._judgeDirty`;
  - otherwise `this._aiSafely('pump', () => this._aiQueue.pump(this._judged, this._timing.cutoffMs))`.
- **`_onAiChange(state)`** (new):
  - return if destroyed;
  - `this._ai = state; this._judgeDirty = true`.
  - No immediate tick: the next alert tick, within 1 s, re-judges and renders.
- **`_aiSafely(what, fn)`** (new):
  - runs `fn` in `try/catch`;
  - on an exception, `console.error('payattention: ai-failed ' + what, e)`, once per distinct `what + String(e)` for the controller's life;
  - never rethrows.
- **`_render(now)`** (`controller.js:205-208`): replace the `judge(...)` line with `this._judged = this._judgeAll(now);`.
- **`_judgeAll(now)`** (new):
  ```js
  const snapshot = this._feed.snapshot;
  if (!snapshot)
      return [];
  const config = { ...this._settings, ai: aiJudgeConfig(this._aiEngine, now) };
  const first = judge(snapshot, config, this._overrides, this._travel, this._ai.answers);
  const kept = withholdAnswers(first, this._ai);
  return kept === null ? first : judge(snapshot, config, this._overrides, this._travel, kept);
  ```
  In rules mode `config.ai` is null, and `judge` ignores its fifth argument and gives exactly today's output (`interfaces.md` §6.3).
- **`buildView({...})`** (`controller.js:236-244`): add `aiStatus: this._ai.status`.
- **`_prune(now)`** (`controller.js:174-179`): add `this._aiSafely('prune', () => this._aiQueue.prune())`.
- **`destroy()`** steps (`controller.js:138-145`) become: `ticker`, `aiTicker` (`this._aiTicker?.destroy()`), `ai` (`this._aiQueue?.destroy()`), `ui`, `feed`, `environment`, `clocks`, `store`. Then null the two new fields with the others.
  - The AI queue goes before the store, so no answer is written after the store's final flush. The store's `destroy()` flushes a pending `ai-verdicts` write.
  - In rules mode neither new step logs anything in the test harness, so the existing destroy-order test is unchanged.

### `extension/extension.js` (changed)

Add `import { AiHelperClient } from './shell/aiHelperClient.js';`, `const AI_HELPER_ENTRY = 'main.js';`, and to the controller deps:

```js
createAiClient: engine => new AiHelperClient({ argv: ['gjs', '-m', `${this.path}/ai/${AI_HELPER_ENTRY}`], engine, now: () => Date.now() }),
createAiTicker: onTick => new Ticker(1000, onTick),
```

## Steps

Land each step as its own commit, in this order. Steps 1 and 2 are **repair and must not change behaviour**. `npm run lint`, `npm test` and `npm run smoke` are green before and after each, with the same test count. Steps 3 to 10 are the feature, each test first.

Baseline before Step 1:
- run the full sequence and note the counts (`npm test` total and passes);
- PG-4b must be merged (see "Stop and escalate if").

### Step 1 — One write coalescer per GSettings key in `Store`  [repair]
- **Test first:** none new. `tests/smoke/store-check.js` already proves the behaviour this step must keep: "no write before the delay", "exactly one alert-state write", "the last state was written", and "destroy flushes". Run `npm run smoke` (its first stage is the store check) before and after.
- **Then:** in `shell/store.js`:
  - rename `ALERT_STATE_FLUSH_MS` to `FLUSH_DELAY_MS` (same 500, comment "A burst of writes to one key is one write (data.md)");
  - replace `_pending`, `_flushId` and `_lastWritten` with `this._coalesced = new Map()` (GSettings key → `{pending: string|null, lastWritten: string|null, flushId: number}`);
  - add two private methods, `_writeCoalesced(key, text)` and `_flushKey(key)`, with exactly today's semantics per key: the first write of a burst arms one timeout, later writes replace `pending`, and a flush writes only when `pending !== lastWritten`;
  - `writeAlertState` becomes `this._writeCoalesced('alert-state', serializeAlertState(state))`;
  - `readAlertState` records `lastWritten` for `'alert-state'`;
  - `destroy()` removes every armed source and flushes every key.
- **Why here:** the store is the only GSettings writer, and coalescing is a storage concern.
- **Behaviour change:** none.

### Step 2 — Move the controller test harness into `tests/unit/support/`  [repair]
- **Test first:** none new. The whole of `controller.test.js` must pass with the same count before and after.
- **Then:** create `tests/unit/support/controllerHarness.js`.
  - Move into it, unchanged: `EN`, `JOIN`, `WORK`, `meeting`, `MEETING`, `KEY`, `SNAP`, `makeStore`, `makeFeed`, `makeUi`, `setup`, and `setupInto` (from the end of the file).
  - The harness imports `Controller` and `recordSync` statically.
  - `controller.test.js` keeps `process.env.TZ = 'UTC'` first. It then imports the harness with `await import('./support/controllerHarness.js')`, so the zone is fixed before any module loads. It keeps its `errors` capture and every test as they are, and drops imports it no longer uses (lint's `no-unused-vars` shows which).
  - A comment at the top of the harness says it is test support, not a test (as `builders.js` does).
- **Why here:** a shared fake belongs beside the other test factories. The AI controller tests in Step 9 need it without copying it.
- **Behaviour change:** none (test code only).

### Step 3 — The stored `ai-verdicts` format in core  [feature]
- **Test first:** `tests/unit/aiAnswers.test.js`. It fails first because the module does not exist.
  1. `parseAiAnswers` of `''`, `null`, `'{'`, `'[]'`, `'{"v":2,"items":{}}'` and `'{"v":1,"items":[]}'` each deep-equals `emptyAiAnswers()`. It is frozen and never throws.
  2. A valid value round-trips: `serializeAiAnswers(parseAiAnswers(t)) === t` for `t` with two items written in `{fp, verdict, reason, at}` order.
  3. Each invalid item is dropped alone, and its valid neighbour is kept. The invalid items are:
     - key `series:x`;
     - key `occ:a|abc` (no time);
     - `fp: ''`;
     - a 65-character fp;
     - `verdict: 'MUST'`;
     - a reason with a newline;
     - a reason of 81 characters;
     - a reason with U+200B;
     - `at: null`;
     - `at: "1"`;
     - an item that is an array.
  4. An extra field (`joinUrl`) on an item is dropped, and the item is kept with exactly its four fields.
  5. `recordAiAnswer` adds, then replaces, an entry with `at = now`. It does not mutate its input (use `deepFreeze` from `builders.js`). It throws `TypeError` for each invalid input of test 3. The error message contains the field name, and not the value.
  6. `pruneAiAnswers` at `NOW` removes `occ:old|<NOW − 8 days>` and keeps `occ:new|<NOW − 6 days>`. It returns the very same object (`===`) when nothing is expired.
- **Then:** write `extension/core/aiAnswers.js` to the seam above, modelled on `alertState.js`. Add the two typedefs to `core/types.js`. Add `import { emptyAiAnswers, parseAiAnswers, serializeAiAnswers, recordAiAnswer, pruneAiAnswers } from '../../../extension/core/aiAnswers.js';` to `tests/unit/support/gjs-core-check.js`, and one call chain in its pipeline (record, serialise, parse, prune), so core still proves it runs under gjs.
- **Why here:** a stored format is core's (NOTES 2026-09-27). It sits beside `alertState.js`, which does the same for `alert-state`.
- **Behaviour change:** none visible yet.

### Step 4 — The store reads and writes `ai-verdicts`  [feature]
- **Test first:** extend `tests/smoke/store-check.js`, after the alert-state block. It fails first because the methods do not exist.
  - `readAiAnswers()` on the default `''` deep-equals `emptyAiAnswers()`;
  - three `writeAiAnswers` calls in a burst give no `changed::ai-verdicts` within 250 ms, then exactly one write, holding the last value;
  - `writeAiAnswers` then `destroy()` writes synchronously;
  - after the store is re-created, `set_string('ai-verdicts', '{"v":1,"items":')` reads as empty;
  - in the `onChange` block, `set_string('ai-verdicts', '')` adds no `onChange`.
- **Then:** add `readAiAnswers()` and `writeAiAnswers()` to `Store`, through `_writeCoalesced('ai-verdicts', …)` from Step 1. Add the two methods to the `StorePort` typedef in `controller.js:19-33`.
- **Why here:** the store is the only GSettings writer (`boundaries.md`).
- **Behaviour change:** none visible yet. Nothing calls it.

### Step 5 — The request budget  [feature]
- **Test first:** `tests/unit/aiBudget.test.js`. Use its own `T` base; do not reuse `budget.test.js`, which is the tick-time budget.
  1. The constants are 120 and 1000.
  2. 120 spends at `T` are all `true`. The 121st at `T` and at `T + HOUR − 1` is `false`. At `T + HOUR` it is `true`.
  3. A refusal spends nothing: after 120 at `T`, 50 refused calls at `T + 10 min`, then at `T + HOUR` exactly 120 more spends succeed, and the next is refused.
  4. The day cap:
     - spend at `T + i × 40 s` for i = 0…999 (90 an hour, under the hourly cap); all are `true`;
     - the next, at `T + 1000 × 40 s`, is `false`;
     - at `T + DAY` one is `true`.
  5. Two engine tags have separate budgets: 120 on `a` does not refuse `b`.
- **Then:** `extension/shell/aiBudget.js` to the seam: a `Map` from engineTag to a sorted array of spend times, trimmed of spends older than 24 h on each call.
- **Why here:** the budget is a shell policy (`constraints.md`), gi-free and in memory.
- **Behaviour change:** none visible yet.

### Step 6 — The queue's pure helpers  [feature]
- **Test first:** `tests/unit/aiQueue.test.js`, with `process.env.TZ = 'UTC'` set before a dynamic import, as `view.test.js` does. The first block:
  1. `nextAskRetryMs`: from null, repeated calls give 60, 120, 240, 480, 960, 1800 and 1800 seconds.
  2. `aiJudgeConfig(null, T0) === null`. For `aiEngine({...DEFAULT_SETTINGS, verdictSource:'ai', aiModel:'m'})` it gives `{engineTag: 'http://127.0.0.1:11434/v1|m', utcOffsetMinutes: 0}`, and `Object.is(result.utcOffsetMinutes, 0)` holds (no −0).
  3. `withholdAnswers`, with `judged()` from `builders.js` plus `aiAsk` where needed:
     - `status:'ok'` and no failed keys → `null`;
     - `status:'unavailable'` → keys with `aiAsk` and an entry are withheld; a key with an entry and no `aiAsk` (a current answer) is kept; a key with `aiAsk` and no entry changes nothing; the result is frozen;
     - `status:'ok'` with `failedKeys` `{k1}` → only `k1` is withheld, and only when `k1` carries `aiAsk`;
     - `status:'off'` → `null`.
- **Then:** the constants, the typedefs and the three functions in `extension/shell/aiQueue.js`.
- **Why here:** they turn the queue's state into `judge` input, which is §6.5's rule. The module is gi-free, so the rule is unit-tested.
- **Behaviour change:** none visible yet.

### Step 7 — The queue  [feature]
- **Test first:** the next blocks in `tests/unit/aiQueue.test.js`. Use a fake clock `t`, and a fake client made by a `createClient` that records every engine and returns an object with:
  - `readyValue` (default true);
  - a `ready` getter: `readyValue && !destroyed && no open ask`;
  - `ask(invite, onDone)`, which records `{invite, onDone, open: true}`;
  - `kill()`, which counts and marks open asks closed;
  - `destroy()`;
  - a test-side `answer(outcome)` that calls the oldest open ask's `onDone`.

  The judged lists are `judged()` objects with `aiAsk: {fp, invite: {n: i}}` (the queue treats the invite as opaque). Capture `console.warn` and `console.error` in `beforeEach`, as `controller.test.js` does. The cases:
  1. **Off:** the constructor calls neither `createClient` nor `onChange`. `state.status === 'off'`. `pump` does nothing. `setEngine(null)` again publishes nothing.
  2. **Engines:**
     - `setEngine(E1)` creates one client and publishes `ok`;
     - `setEngine(E1)` again does nothing;
     - `setEngine(E2)` destroys the first and creates a second;
     - `setEngine(null)` destroys it and publishes `off`.
  3. **Order and cutoff:** judged items at starts `T0 − 11 min`, `T0 − 5 min`, `T0 + HOUR`, `T0 + 2 × HOUR`, with `now = T0` and cutoff 10 min. The pumps ask `T0 − 5 min`, then (after each is answered) `T0 + HOUR`, then `T0 + 2 × HOUR`. `T0 − 11 min` is never asked. An item without `aiAsk` is never asked.
  4. **One at a time:** with one ask open, ten pumps send nothing more.
  5. **Verdict:**
     - `writeAnswers` gets a state whose `items[key]` deep-equals `{fp, verdict:'ignore', reason:'fake', at: t}`;
     - `onChange` gets `status:'ok'` and `answers[key]` with that entry;
     - an outcome delivered twice is applied once.
  6. **Retries per occurrence:** the same key failing with `network` again and again is re-asked at 1, 2, 4, 8, 16, 30 and 30 min after each failure, never sooner. Pumping at `retryAt − 1` sends nothing. A verdict resets it: the next failure waits 1 min again. `failedKeys` holds the key after a failure and not after the success.
  7. **Engine pause:**
     - after `auth` (then `config`, then `no-key`, each in a fresh queue), a different key is not asked until 30 min later;
     - `rate-limited` with `retryAfterS: 7` pauses 7 s; without it, 5 min; with 7200, 30 min;
     - `setEngine(E2)` during a pause asks at once on the next pump.
  8. **Watchdog** (engine `timeoutMs` 90 000): a pump at `sentAt + 99 999` does not kill. At `sentAt + 100 000` it calls `kill()` once, the state is `unavailable`, the key has a 1 min retry, and a late `answer()` on the dropped ask changes nothing.
  9. **Lost:** `unavailable`, with no retry record. The same key is asked on the next pump once `ready` is true.
  10. **Budget:** 121 keys answered one by one, all at the same `t`. Exactly 120 asks are sent. The pump that meets the 121st publishes `unavailable` once; later pumps publish nothing. At `t + HOUR` the 121st is sent, and its verdict publishes `ok`.
  11. **Not ready:** with `readyValue = false`, pumps send nothing, spend no budget (after `readyValue = true`, 120 asks still go in the hour) and do not change the status.
  12. **Stale outcomes:** an outcome for an ask made before `setEngine(E2)`, or after `destroy()`, does nothing: no write, no publish.
  13. **Throwing client:** `ask` throws → one `console.error` (`payattention: ai-failed ask`) over 5 pumps, and the status is `unavailable`. `createClient` throws → the status is `unavailable`, `pump` does nothing, and `setEngine(E2)` with a working factory recovers.
  14. **Prune:** constructed with `occ:old|<now − 8 days>` and `occ:new|<now − 6 days>`, `prune()` writes once, without the old key, and publishes once. A second `prune()` writes nothing and publishes nothing.
  15. **Constructor checks:** a missing function or an `answers` without `v:1` throws `TypeError`.
- **Then:** the `AiQueue` class to the seam and the "pump" and "settle" rules above. Budget: `new RequestBudget()`, owned for the queue's life (not reset by `setEngine`). Retry records: `Map` key → `{waitMs, retryAt}`. Once-only logs: a `Set`, reset by `setEngine`.
- **Why here:** these are §6.5's queue, retry, budget and status rules, as values in and values out, with the process behind a port.
- **Behaviour change:** none visible yet.

### Step 8 — The view shows "AI: …" and "AI unavailable — using rules"  [feature]
- **Test first:** in `tests/unit/view.test.js`, give its `view()` helper a `aiStatus = 'off'` option passed to `buildView`. Then add a `describe('view: AI mode', …)`:
  1. `aiStatus:'unavailable'` → `menu.aiStatus === 'AI unavailable — using rules'`; `'ok'` and `'off'` → `null`.
  2. A judged item with `reasonCode:'ai-ignore'`, `reason:'AI: team social, optional'`: its menu row's `reason` is exactly `'AI: team social, optional'`.
  3. A judged item with `reasonCode:'ai-must'` at the step-1 time: `alert.reason === 'AI: client call'`.
  4. A rule reason is unchanged: `'Why: x'` for the default `judged()`.
  5. The signature changes when a row's reason goes from a rule reason to an AI reason.

  Existing view tests must pass unchanged.
- **Then:** `AI_UNAVAILABLE_TEXT`, the `aiStatus` field and the private `reasonLine(j)` in `view.js`, as in "Seams". Update its JSDoc.
- **Why here:** every "what to show" decision is `view.js`'s (`interfaces.md` §3).
- **Behaviour change:** in AI mode the row and alert read "AI: <reason>". The controller passes no `aiStatus` until Step 9. Until then `menu.aiStatus` is `null`.

### Step 9 — The controller runs the queue; no alert waits on the AI  [feature]
- **Test first (harness):** extend `tests/unit/support/controllerHarness.js`.
  - `makeStore` gains:
    - `aiAnswers` (initial `h.aiAnswers ?? emptyAiAnswers()`);
    - `aiWrites: []`;
    - `readAiAnswers: () => store.aiAnswers`;
    - `writeAiAnswers: a => { store.aiWrites.push(a); store.aiAnswers = a; }`.
  - `setup()` takes `aiAnswers` and `aiClient` options (`aiClient` is a function `(engine, h) => client`; the default makes the fake client from Step 7, moved here as `makeAiClient(engine, h)`).
  - `deps.createAiClient` pushes each client to `h.aiClients`, and `destroy()` pushes `'aiClient.destroy'` to `h.log`.
  - `deps.createAiTicker` counts `h.aiTickers` and keeps `h.aiTicker = {fire, destroyed}`, and its `destroy()` pushes `'aiTicker.destroy'` to `h.log`.
  - Two helpers:
    - `h.client` returns the last client;
    - `h.aiTick(t)` moves the clock to `t` and fires the AI ticker, when one exists.
  - `setupInto` passes `createAiClient: () => { throw new Error('unused'); }` and `createAiTicker: () => ({ destroy() {} })`.

  The existing `controller.test.js` must pass **unchanged** (rules mode).
- **Test first (behaviour):** `tests/unit/controller.ai.test.js`.
  - `process.env.TZ = 'UTC'`, then a dynamic import of the harness.
  - Capture `console.error` and `console.warn`.
  - `AI = {verdictSource:'ai', aiEndpoint:'http://127.0.0.1:11434/v1', aiModel:'test-model'}`, so `TAG = 'http://127.0.0.1:11434/v1|test-model'` and `timeoutMs` is 90 000.
  - `fpOf(snap, key)` returns `judge(snap, {...DEFAULT_SETTINGS, ...AI, ai:{engineTag: TAG, utcOffsetMinutes: 0}}, {verdict:{}, mode:{}}, {}, {})` → that key's `aiAsk.fp`.
  - `LADDER` = the times `T0 − 30 min`, `T0 − 25 min`, `T0 − 10 min`, `T0 − 4 min`, `T0 − 3 min`, `T0 − 1 min`, `T0 − 30 s` and `T0`.
  - `steps(h)` records `[alert?.step ?? null, alert?.presentation ?? null]` after `h.at(t)` for each time in `LADDER`.

  Each case fails first because the controller ignores AI mode. Rule for writing these tests: after anything that changes the judge inputs (a delivery, an outcome, a settings change), call `h.at(t)` before `h.aiTick(t)`. The AI tick does nothing while a re-judge is pending, by design (case 8).
  - **"No alert ever waits on the AI":**
    1. **Rules mode starts nothing.** Across `LADDER` in rules mode, `h.aiClients.length === 0` and `h.aiTickers === 0`. Every view has `menu.aiStatus === null`.
    2. **A helper that never answers.** In AI mode with `SNAP`, deliver at `T0 − 2 h`, then call `h.aiTick` once. Exactly one ask is open, for `MEETING`. Then, for each `t` in `LADDER`, `h.aiTick(t)` and then `h.at(t)`. The step sequence deep-equals the rules-mode `steps` for the same snapshot. The watchdog fires on the way (100 s after the ask) and changes nothing on screen: the verdict is the rule's `must` throughout.
    3. **The alert tick never calls the AI helper.** In AI mode, deliver, then call `h.at(t)` for 200 times from `T0 − 40 min` (every 12 s), never firing the AI ticker. Then run `steps(h)`, still without an AI tick. `h.client.asks.length === 0` (the client exists: `setEngine` made it), and the steps deep-equal rules mode.
    4. **A broken AI side cannot stop alerts.** Give the AI client a `ready` getter, `ask`, `kill` and `destroy` that all throw. Construction does not throw. The ladder with `h.aiTick` before each `h.at` equals rules mode. `errors` contains `payattention: ai-failed …` entries, each distinct text once. `h.controller.destroy()` does not throw, and the store is still destroyed.
    5. **The helper cannot be created.** With `createAiClient` throwing, construction succeeds, the ladder equals rules mode, and `menu.aiStatus === 'AI unavailable — using rules'`.
    6. **An answer joins at the current step.**
       - For a meeting the rules call ignorable: `meeting({uid:'lunch', summary:'Lunch placeholder', organizer: null, attendees: []})`, a personal block (D-015), judged `ignore`. Deliver at `T0 − 2 h`, and `h.aiTick` so its ask is open. At `T0 − 4 min` there is no alert. Answer `{type:'verdict', verdict:'must', reason:'client lunch'}`. The next `h.at(T0 − 4 min + 1 s)` shows step 2, never step 1, and `alert.reason === 'AI: client lunch'`.
       - For `MEETING`, with step 3 on screen at `T0 − 3 min`, an `ignore` answer removes the alert on the next alert tick (the D-019 cost).
  - **Stored answers and re-asking:**
    7. **Asked once.** After a verdict:
       - `h.store.aiWrites.at(-1).items[KEY]` deep-equals `{fp: fpOf(SNAP, KEY), verdict, reason, at: now}`;
       - 50 more AI and alert ticks send nothing;
       - a new controller built with `aiAnswers: h.store.aiAnswers` (a lock and unlock) sends nothing, and its row reason is `'AI: …'`.
    8. **No re-ask before the re-judge.** Right after a verdict, `h.aiTick` before any `h.at` sends nothing (`_judgeDirty`).
    9. **The old answer is kept while re-asking.** Stored: `KEY → {fp:'00000000000000', verdict:'ignore', reason:'optional sync', at}`, which is stale.
       - At `T0 − 25 min` (step-1 time) there is no alert, the row reads `'AI: optional sync'`, and one ask for `KEY` is open.
       - Stepping `LADDER` while the ask stays open: no alert at any step.
  - **The fallback to the rules:**
    10. From case 9's state at `T0 − 10 min`, the client answers `{type:'failed', code:'network'}`. The next `h.at` shows step 2 from the rules (the rule verdict `must`), and `menu.aiStatus` is the unavailable text. `h.aiTick` at failure + 59 s sends nothing; at failure + 60 s it asks `KEY` again. A verdict then gives `menu.aiStatus === null`.
    11. **Per-key withholding.** Two meetings, both with stale `ignore` entries. `A`'s ask fails, and then `B` succeeds, so the status is `ok`. `A` is still decided by the rules (its entry is withheld), and `B` shows its new AI verdict.
    12. **Overrides and silent-by-fact meetings are never sent.**
       - `MEETING` with an occurrence `must` override;
       - a cancelled meeting;
       - a meeting the owner declined;
       - an all-day event;

       these give zero asks over 20 AI ticks. The asks' invites, compared as JSON, never contain an override's key or value.
    13. **Budget:**
       - 121 meetings `meeting({uid:'m'+i, start: T0 + HOUR + i × MIN, end: … + 30 min})`, at `now = EN`;
       - loop: `h.aiTick`, answer the open ask, `h.at` (re-judge);
       - exactly 120 asks, then `menu.aiStatus` is the unavailable text;
       - one hour after the first ask, the 121st is sent.
  - **Lifecycle:**
    14. **Engine change.**
        - After an `auth` failure (paused), set `h.store.settings.aiModel = 'other'` and call `h.store.onChange()`;
        - the old client is destroyed, a new client gets an engine with `engineTag` `'…|other'`, and the next `h.at` then `h.aiTick` sends an ask at once (the pause is over);
        - all stored entries are stale for the new engine, and still apply while re-asked (`interfaces.md` §6.3).
    15. **Mode off.**
        - Set `verdictSource = 'rules'`, then `onChange()`;
        - the client and the AI ticker are destroyed, `menu.aiStatus === null`, and rows read `'Why: …'`;
        - the judged list deep-equals a rules-mode controller's for the same snapshot;
        - no AI ticker fires afterwards.
    16. **Destroy in AI mode.**
        - `h.log` order is `ticker.destroy`, `aiTicker.destroy`, `aiClient.destroy`, `ui.destroy`, `feed.destroy`, `environment.destroy`, `store.writeHealthClocks`, `store.destroy`;
        - an outcome delivered after `destroy()` writes nothing and renders nothing.
    17. **Prune.**
        - Constructed with stored `occ:old|<EN − 8 days>` and `occ:new|<EN − 6 days>`: exactly one `aiWrites` entry, without the old key.
        - In rules mode with an empty store: `aiWrites.length === 0`, after construction and after a day of ticks (`h.at(EN + DAY)`).
    18. **Missing factories:** `new Controller({...deps without createAiTicker})` throws `TypeError` before any part is built (no `h.log` entries).
- **Then:** the controller changes listed under "Seams". Import `aiEngine` from `../core/aiEngine.js`, and `AiQueue`, `aiJudgeConfig` and `withholdAnswers` from `./aiQueue.js`.
- **Why here:** §6.5 makes the controller the one that feeds `judge` and owns every part's lifetime. The AI decisions stay in `aiQueue.js`, and the controller only wires them.
- **Behaviour change:** AI mode works end to end against a fake client. Rules mode is unchanged: `controller.test.js` passes without changing any assertion.

### Step 10 — The real client, the composition root, the menu line and the smoke checks  [feature]
- **Test first (client, Layer 2b):** `tests/ai/shellClient.test.js` (Node) and `tests/ai/gjs/shellClient.js` (gjs). They reuse PG-4b's harness as it is: `createAiSession(name)` from `tests/ai/session.js` and `startFakeEngine()` from `tests/ai/fakeEngine.js`.
  - The Node test starts a session and a fake engine. For each scenario it runs `gjs -m tests/ai/gjs/shellClient.js <scenario> <endpoint>` with `session.env` and cwd at the repo root, and waits (20 s cap) for a `DONE` line.
  - The gjs script:
    - builds `engine = aiEngine({...DEFAULT_SETTINGS, verdictSource:'ai', aiEndpoint: endpoint, aiModel:'fake-model'})`;
    - builds `new AiHelperClient({argv: ['gjs', '-m', '<repo>/extension/ai/main.js'], engine, now: () => Date.now()})`;
    - runs a `GLib.MainLoop`;
    - prints `ASKED`, `OUTCOME <json>` and `READY <bool>` lines as the scenario says, then `DONE`.

    It refuses any endpoint not matching `^http://127\.0\.0\.1:\d+/v1$` (PG-4b's "never a real engine" rule).
  - Scenarios and assertions:
    1. `verdict`: ask `PROBE_INVITE` → exactly one `OUTCOME {"type":"verdict","verdict":"must","reason":"fake engine"}`. The engine recorded one request, whose user message `=== JSON.stringify(PROBE_INVITE)`. stderr has no `configure-again` and no `not-configured`.
    2. `sequence`: two asks, the second after the first outcome → two verdicts. The engine recorded two requests. stderr has no `configure-again` (one helper, configured once).
    3. `failed`: the engine is queued `{status: 401, body: '{}'}` → `OUTCOME {"type":"failed","code":"auth"}`. With `{status: 429, headers: {'retry-after': '7'}, body: '{}'}` → `{"type":"failed","code":"rate-limited","retryAfterS":7}`.
    4. `kill`:
       - the engine holds (`{hold: true}`); ask, wait 1.5 s, `kill()`;
       - print `READY` at once (`false`), wait 1.2 s, print `READY` (`true`);
       - ask again (default answer).

       Exactly one `OUTCOME`, the verdict. The engine recorded two requests.
    5. `exit`: argv `['gjs', '-m', '<repo>/tests/ai/gjs/missing-entry.js']` (no such file) → `OUTCOME {"type":"lost"}`; `READY false` at once, `READY true` after 1.2 s.
    6. `spawn-failed`: argv `['<repo>/.test-home/no-such-binary']` → the output is `ASKED`, then `OUTCOME {"type":"lost"}`, in that order (never synchronous).
    7. `bad-invite`: ask `{...PROBE_INVITE, uid: 'x'}` → `OUTCOME {"type":"failed","code":"bad-request"}`. The engine recorded nothing, and no child process was started.
    8. `destroy`: the engine holds; ask, wait 1 s, `destroy()`, wait 1.5 s. There is no `OUTCOME`, and no process whose `/proc/<pid>/stat` parent is the script's own pid has `ai/main.js` in its cmdline (read `/proc` as `tests/smoke/alert-ladder.js` `helperPids` does).

    In every scenario, stderr contains neither `Connection test` nor `fake engine` (no invite or reason text is logged).
- **Test first (smoke, Layer 3 item 8):** in `tests/smoke/alert-ladder.js`:
  - add `aiHelperPids(home)`, like `helperPids` with the needle `…/${UUID}/ai/main.js`;
  - check it is 0 in `checkIndicator`, after the ladder, and in `checkDisabled`;
  - in `checkIndicator`, `findByName(menu, 'payattention-menu-ai-status')` exists and its parent item is not visible.

  In `scripts/smoke.sh`, add `ai-failed|ai-protocol-mismatch|ai-spawn-failed` to the failure-code pattern (`smoke.sh:106`). Rules mode must never log them.
- **Then:**
  - `extension/shell/aiHelperClient.js` to the seam;
  - the `extension.js` wiring;
  - the indicator's AI status item.
  - If the gjs-globals block in `eslint.config.js` does not already list `tests/ai/gjs/**/*.js`, add it there (it does at the time of writing).
- **Why here:** the process belongs in `shell/` beside `calendarFeed.js`, and the root only wires. The indicator draws what the view says.
- **Behaviour change:** in a real session with AI mode set up, meetings get "AI:" verdicts, and a stopped engine shows "AI unavailable — using rules". Rules mode starts no AI helper (proven by the smoke).

### Validation
In this order:
1. `npm run lint`;
2. `npm test` (baseline plus the new cases, 0 failures);
3. `npm run build`;
4. `npm run test:helper` (it runs `tests/ai/**`, `shellClient.test.js` included);
5. `npm run smoke`.

Report the real output. Then run the Layer 4 AI checklist in `testing-and-build.md` by hand, if a local engine is available. It is not needed to accept the build.

## Callers to update

- **`Controller` constructor deps** (+`createAiClient`, +`createAiTicker`, required): `extension/extension.js`; `tests/unit/support/controllerHarness.js` (`setup`, `setupInto`).
- **`StorePort`** (+`readAiAnswers`, +`writeAiAnswers`): implemented by `shell/store.js`; faked in `controllerHarness.js`.
- **`buildView`** (+`p.aiStatus`): `shell/controller.js` `_render`; `tests/unit/view.test.js` `view()` helper.
- **`View.menu`** (+`aiStatus`): read by `ui/indicator.js` `update`. `ui/ui.js:55` passes `view.menu` through unchanged.
- **`MeetingRow.reason` / `AlertView.reason` text for `ai-*` codes:** drawn as-is by `ui/indicator.js:125` and `ui/alertContent.js:64, 99`. No code change.
- **`judge`:** unchanged. Its only production caller is the controller, which now passes `config.ai` and the fifth argument.
- **New modules and their only callers:**
  - `core/aiAnswers.js` → `shell/store.js`, `shell/aiQueue.js`, tests, `gjs-core-check.js`;
  - `shell/aiBudget.js` → `shell/aiQueue.js`;
  - `shell/aiQueue.js` → `shell/controller.js`;
  - `shell/aiHelperClient.js` → `extension/extension.js`, `tests/ai/gjs/shellClient.js`.
- **Stored format:** `ai-verdicts` is written for the first time here, exactly as `data.md` defines it. It has no reader outside this repository. PG-4e (`--purge`) erases it later.
- No contract outside this repository changes.

## Out of scope

- **Anything in `extension/ai/`** (PG-4b), prefs and "Test connection" (PG-4d), and `--purge` (PG-4e).
- **Any change to core's `judge`, `invite.js`, `fingerprint.js`, `aiProtocol.js`, `aiPrompt.js` or `aiEngine.js`.** If one seems needed, stop.
- **Sharing the spawn, read and exit code between `CalendarFeed` and `AiHelperClient`.** It is tempting, because the new client copies about 40 lines of that pattern. But `CalendarFeed` has no test below the smoke, so a refactor of it cannot be proven behaviour-preserving in this ticket. The two lifecycles also differ: the feed respawns on a timer, and the client respawns lazily. It is noted as a known duplicate for later.
- **Killing an idle AI helper**; an engine-level pause on `network`, `tls`, `timeout` or `server`; persisting the budget; asking two meetings at once; batching. Each is a change to §6.5, not an implementation choice (see the findings).
- **Any mark on screen for a stale answer**; any change to the panel warning icon; any sound or step change for AI verdicts.
- **Editing any document** under `docs/` other than this plan, and the README.
- **Adding a smoke run in AI mode against a fake engine.** Layer 4 covers the real session.

## Stop and escalate if

- **PG-4b is not merged,** or `extension/ai/main.js` behaves differently from `interfaces.md` §6.6 and `docs/plans/PG-4b.md`. That covers: `hello` first, `configure` then `judge`, one reply per request, the id rule, the failure codes and `retryAfterS`, exit on stdin EOF, and `failed: config` for a `judge` before `configure`.
- **`tests/ai/session.js` or `tests/ai/fakeEngine.js` have other names or semantics** than the PG-4b plan gives (`createAiSession`, `startFakeEngine`, `queue`, `{hold:true}`, `requests`). Adapt to a renamed export only when its behaviour is the same; otherwise stop.
- **`judge`'s AI output differs from `interfaces.md` §6.3,** for example a stale entry not applied, or `aiAsk` present on a key with a current entry. The withholding design depends on that table.
- **Any existing assertion in `controller.test.js`, `view.test.js` or `store-check.js` has to change** (other than the harness import in Step 2 and the `view()` helper's new option in Step 8). That means rules-mode behaviour moved.
- **Gio refuses the planned write pattern** (for example, `write_bytes_async` on the subprocess stdin pipe behaves differently from `calendarFeed.js:67`), or `Gio.Subprocess` needs a flag this plan does not name. Do not switch to a blocking write in the shell process.
- **A test seems to need a real engine, the owner's keyring, the owner's bus, or network beyond `127.0.0.1`.**
- **The AI-mode `judge` benchmark** (`tests/unit/budget.test.js`, "judge in AI mode over 2 000 events") fails after Step 9. The controller must not be made to call `judge` more often than this plan says.
