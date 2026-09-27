# Plan — PG-8b: take the verdict pipeline out of the alert controller into one reusable component, and split the store into a reader that cannot write and a writer

Backlog: PG-8b, the hard prerequisite for PG-8c (the terminal verdict preview; R-20, D-032, D-033).
Architecture: ADR-0011 (Leak 1 "the verdict pipeline is private to the controller", Leak 2 "the store port is one read-write interface"; "only the verdict component calls `core/judge.js`"), ADR-0012 (the preview is handed only the reader), `interfaces.md` §7.2 (binding), §6.5 (binding: AI queue, withholding, the AI tick), `boundaries.md` (`app/` row, "Ownership of data").
Depends on: PG-8a merged. Every path below is the post-PG-8a path (`extension/app/…`).

**Sensitive: personal data.** This code moves the code that feeds meeting invites to the AI queue, and the code that writes `ai-verdicts` (model-written reasons that may paraphrase names). Nothing new is logged. The log texts that move keep their exact wording: `payattention: ai-failed <what>` and `payattention: destroy-failed <part>`, codes only. No invite, title or reason is ever logged.

## What changes, and for whom

The owner notices nothing: same verdicts, same alerts, same writes. For the code:

- one component in `app/` now owns everything between the inputs and the judged list, and it is the only caller of `judge`. The alert controller uses it, and so will the preview (PG-8c), with no copied logic;
- the store is now two objects. The reader has no way to write settings, even by reaching into its internals.

Done when (backlog): the controller uses the new component; the existing controller tests keep their meaning; the reader side cannot write.

## The component

- **`app/controller.js`, responsible for (ADR-0002, as intended):** running the alert front end. It plans on every tick, renders, routes the owner's actions, and keeps alert state, sound, the test alert and calendar health.
- **Has drifted by:** since PG-4c it has also owned the verdict pipeline, which is a second job:
  - reading the inputs, and syncing the AI engine;
  - owning the calendar feed, the `AiQueue` and the AI ticker;
  - the "judge only when an input moved" flag;
  - the two-pass judge with withheld answers.

  This is `controller.js` `_loadInputs`, `_syncAi`, `_aiTick`, `_onAiChange`, `_aiSafely`, `_judgeAll`, `_onStoreChange` and `_onFeedUpdate`, and the queue construction in the constructor. Its store port also mixes the pipeline's reads with the alert side's reads and writes (`StorePort`, lines 21-37). ADR-0011 records both as the leaks that block PG-8.
- **`shell/store.js`, responsible for:** typed access to the GSettings schema. **No drift.** It is one class only because nothing needed a read-only half until now.
- **The new component `app/verdicts.js` will be responsible for:** turning the calendar snapshot, the owner's settings, overrides, travel times and AI answers into the judged list. One job, no "and".
- **This change belongs here because:** §7.2 moves exactly that code, as it is, from the controller into one `app/` component, and splits the store into two facets. The architect has decided both. This plan chooses the names and seams (§7.2: "Names are the senior engineer's; the split is the contract").

## Design in one page

```
extension.js (composition root, gjs)
  createStoreReader: onChange => new StoreReader(settings, onChange)     createStoreWriter: () => new StoreWriter(settings)
  createFeed, createAiClient, createAiTicker, createEnvironment, createUi, createTicker, launchUri, now
      │
      ▼
Controller (app/controller.js) ── owns ──► StoreWriter, Environment, Ui, alert Ticker
      │  builds, with createStoreReader/createFeed/createAiClient/createAiTicker/now
      │  and writeAnswers = answers => writer.writeAiAnswers(answers)
      ▼
Verdicts (app/verdicts.js) ── owns ──► StoreReader, CalendarFeed, AiQueue, AI ticker
      the only caller of core/judge.js

PG-8c preview (later): builds Verdicts directly with the same adapters, a StoreReader over delay()ed settings,
and writeAnswers = keep in memory. It never has a writer.
```

Why the controller builds `Verdicts`, and `extension.js` does not:
- The controller must wire `writeAnswers` to the writer it owns.
- It must destroy `Verdicts` before the writer's final flush.
- It must read the feed facts before the feed is destroyed.

All three are lifetime rules inside the alert front end. Letting the composition root build `Verdicts` would split one lifetime across two owners. The composition root still only picks adapters (ADR-0011 "front ends are compositions"). `Controller` and `Verdicts` are both `app/`.

## Seams

### `extension/shell/store.js` (changed): two classes; `Store` is removed

```js
export class StoreReader {
    /**
     * The store's reader facet: reads only. It holds the Gio.Settings in a
     * private field, so no caller can reach it and write.
     * @param {import('gi://Gio').default.Settings} settings
     * @param {() => void} onChange called when an owner setting or override changes; never for INTERNAL_KEYS
     */
    constructor(settings, onChange)
    /** @returns {import('../core/types.js').Settings} */                 readSettings()
    /** @returns {import('../core/types.js').Overrides} */                readOverrides()
    /** @returns {import('../core/types.js').TravelTimes} */              readTravel()
    /** @returns {import('../core/types.js').StoredAiAnswers} logs 'payattention: ai-verdicts-corrupt' as today */ readAiAnswers()
    /** Disconnects the change signal. Idempotent. */                    destroy()
}

export class StoreWriter {
    /**
     * The store's writer facet: the alert front end's own state, and the owner's
     * choices it records. Never connects to 'changed'.
     * @param {import('gi://Gio').default.Settings} settings
     */
    constructor(settings)
    readAlertState()                         // unchanged body
    writeAlertState(state)                   // unchanged, coalesced
    writeAiAnswers(answers)                  // unchanged, coalesced
    readHealthSeeds()                        // unchanged
    writeHealthClocks({ dataAt, providerAt }) // unchanged
    setVerdictOverride(key, verdict)         // unchanged
    setModeOverride(key, mode)               // unchanged
    setTravel(placeKey, minutes)             // unchanged
    pruneOccurrenceOverrides(now)            // unchanged
    /** Flushes every pending coalesced write. Idempotent. */ destroy()
}
```

Exact rules:
- **Both classes keep the settings object in a private field (`#settings`).** `StoreWriter` keeps its coalescing map in `#coalesced`. Its helpers become private methods: `#entry`, `#writeCoalesced`, `#flushKey`, `#setDictEntry`. The dictionary read both classes need becomes a module-level function `readDict(settings, key)`, which returns `settings.get_value(key).recursiveUnpack()`. `READERS` and `FLUSH_DELAY_MS` stay module-level.
- **`StoreReader` has exactly five public members:** the four reads and `destroy`. No field is public. **This is the misuse the split makes impossible:** a holder of a `StoreReader` has no method and no reachable property that writes. It cannot even write by reaching into the object, the way `store._settings.set_string(…)` would work today.
- **The `ai-verdicts` coalescing seed moves.** Today `readAiAnswers` sets `this._entry('ai-verdicts').lastWritten = text`, so that writing back the stored text is a no-op. The reader no longer shares state with the writer. So the `StoreWriter` constructor sets the `ai-verdicts` entry's `lastWritten` to `settings.get_string('ai-verdicts')`. Behaviour is the same because the controller builds the writer and reads the answers in the same constructor, with no write in between. `readAlertState` keeps setting `lastWritten` for `alert-state`, as today.
- **`StoreWriter.destroy()`**: flush exactly as today's `destroy()` does (remove each armed timeout, flush each key), then set `#settings = null`. It has no signal to disconnect.
- **`StoreReader.destroy()`**: `disconnectObject(this)`, then set `#settings = null`. If `#settings` is already null, it returns at once.
- Header comment: "Typed read and write of the GSettings schema (data.md), as two facets: StoreReader (reads only; the verdict component's, and the preview's only) and StoreWriter (the alert front end's). The only GSettings code in the shell process."

### `extension/app/verdicts.js` (new, gi-free, SPDX header)

```js
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The verdict component (interfaces.md §7.2, ADR-0011): everything between the
// inputs and the judged list, and the only caller of core/judge.js. Two front
// ends use it: the alert controller and the preview. It never plans, never
// renders, never touches alert state, and writes nothing except AI answers,
// through the writeAnswers it is given.

/**
 * @typedef {object} StoreReaderPort the store's reader facet
 * @property {() => import('../core/types.js').Settings} readSettings
 * @property {() => import('../core/types.js').Overrides} readOverrides
 * @property {() => import('../core/types.js').TravelTimes} readTravel
 * @property {() => import('../core/types.js').StoredAiAnswers} readAiAnswers
 * @property {() => void} destroy stops the change signal
 */
/** FeedPort: moved here unchanged from controller.js. */
/**
 * @typedef {Readonly<{settings: import('../core/types.js').Settings, timing: import('../core/types.js').Timing,
 *   overrides: import('../core/types.js').Overrides, travel: import('../core/types.js').TravelTimes}>} VerdictInputs
 * @typedef {Readonly<{judged: ReadonlyArray<import('../core/types.js').JudgedOccurrence>,
 *   byKey: ReadonlyMap<string, import('../core/types.js').JudgedOccurrence>}>} JudgedList
 * @typedef {Readonly<{snapshot: import('../core/types.js').Snapshot|null, acceptedAt: number|null,
 *   syncedAt: ReadonlyMap<string, number>}>} FeedFacts
 */

export class Verdicts {
    /**
     * Builds the reader, the feed and the AI queue, reads every input, and
     * starts the AI ticker when an engine is set up. If any part fails to build,
     * the parts already built are destroyed and the error is rethrown.
     *
     * @param {object} deps
     * @param {(onChange: () => void) => StoreReaderPort} deps.createStoreReader
     * @param {(onUpdate: () => void) => FeedPort} deps.createFeed
     * @param {(engine: import('./aiQueue.js').AiEngine) => import('./aiQueue.js').AiClientPort} deps.createAiClient
     * @param {(onTick: () => void) => {destroy(): void}} deps.createAiTicker the AI queue's 1 s ticker
     * @param {(answers: import('../core/types.js').StoredAiAnswers) => void} deps.writeAnswers where AI answers go
     *   (the extension: the store's coalesced write; the preview: memory)
     * @param {() => number} deps.now
     * @throws {TypeError} before building anything, when any of the six is not a function
     */
    constructor(deps)

    /** @returns {VerdictInputs} the inputs last read; a new frozen object after every reload */
    get inputs()

    /** @returns {import('./aiQueue.js').AiState} the AI queue's last published state (status, answers, failedKeys, engineDown) */
    get ai()

    /** @returns {FeedFacts} the calendar feed's facts now, for health and for the clocks; a new frozen object per call */
    get feedFacts()

    /**
     * The judged list, recomputed at `now` only when an input moved since the
     * last computation (snapshot, settings, overrides, travel, or the AI state's
     * answers, failed keys or engine down). Otherwise the same object as last time.
     * Empty while there is no snapshot, and after destroy(). Throws only if judge
     * throws; the list is then still marked for recomputation.
     *
     * @param {number} now
     * @returns {JudgedList}
     */
    judgedList(now)

    /** Re-reads overrides and travel times (the owner just changed one) and marks the list for recomputation. */
    reloadOverridesAndTravel()

    /** @param {'resume'|'manual'} reason passed to the feed */
    refresh(reason)

    /** Drops stored AI answers past retention (writes through writeAnswers only when one went). Never throws. */
    pruneAiAnswers()

    /** Idempotent. Destroys, in order: the AI ticker, the AI queue, the feed, the reader. Logs each failure and goes on. */
    destroy()
}
```

The misuse each part rules out:
- **One constructor builds everything, and nothing is `init()`ed later.** Every getter is valid from construction on. There is no order to get wrong.
- **The component holds a reader, never a writer.** Its only write is the injected `writeAnswers`, so "never writes to the store except through `writeAnswers`" holds by construction.
- **Judging happens only inside `judgedList(now)`.** The AI tick waits while the list is marked for recomputation, as §6.5 binds today ("no re-ask before the re-judge"). A front end that calls `judgedList` once gets that moment's verdicts. A front end that wants the AI to progress calls it on its own tick. The controller does this every second, and PG-8c's preview will poll it. This is deliberate, and stated here so that PG-8c does not have to find it.
- **Inputs, the judged-list wrapper and the feed facts are frozen.** In `inputs`, `settings`, `overrides`, `overrides.verdict`, `overrides.mode` and `travel` are each `Object.freeze`d (`timing` is already frozen by core). No front end can change what the next `judge` sees. Core never mutates them (checked: no assignment into these objects in `extension/core/` or `app/view.js`).

### `extension/app/controller.js` (changed)

```js
/**
 * @typedef {object} StoreWriterPort  (replaces StorePort)
 * @property {() => AlertState} readAlertState
 * @property {(state: AlertState) => void} writeAlertState coalesced
 * @property {(answers: StoredAiAnswers) => void} writeAiAnswers coalesced
 * @property {() => import('./health.js').HealthSeeds} readHealthSeeds
 * @property {(clocks: {dataAt: number, providerAt: number}) => void} writeHealthClocks
 * @property {(key: string, verdict: 'must'|'ignore'|null) => void} setVerdictOverride
 * @property {(key: string, mode: 'online'|'in-person'|null) => void} setModeOverride
 * @property {(placeKey: string, minutes: number) => void} setTravel
 * @property {(now: number) => void} pruneOccurrenceOverrides
 * @property {() => void} destroy flushes pending alert-state and ai-verdicts writes
 */

constructor(deps)
// deps: createStoreReader: (onChange) => import('./verdicts.js').StoreReaderPort   (replaces createStore)
//       createStoreWriter: () => StoreWriterPort                                  (new)
//       createFeed, createEnvironment, createUi, createTicker, createAiClient, createAiTicker, launchUri, now: unchanged
```

The existing up-front `TypeError` check for `createAiClient` and `createAiTicker` stays, with the same message. Public methods are unchanged: `runTestAlert()`, `destroy()`.

## Steps

### Step 1 — the store splits into a reader and a writer; the controller takes both  [repair]

- **Behaviour change:** none. Every GSettings read and write happens as before, and in the same order.
- **Test first:** `tests/smoke/store-check.js`, the GJS store test that `npm run smoke` runs:
  1. Import `{ StoreReader, StoreWriter }` in place of `{ Store }`.
  2. Rewrite every existing check against the facet that now owns the method. Keep each check's assertion and message unchanged:
     - `readSettings`, `readOverrides`, `readTravel`, `readAiAnswers` and the onChange checks go to a `StoreReader`;
     - everything else goes to a `StoreWriter`.
     
     Where the old code rebuilt `store` (lines 100, 120), rebuild both. At the end, `destroy()` both. The "no onChange after destroy" check destroys the reader.
  3. Add, before the final destroy, the **reader cannot write** checks:
     - `Object.getOwnPropertyNames(StoreReader.prototype).sort()` equals `['constructor', 'destroy', 'readAiAnswers', 'readOverrides', 'readSettings', 'readTravel']`, message `'the reader has only reads'`;
     - `Object.keys(reader).length === 0`, message `'the reader exposes no field'`;
     - a fresh `withSignalTracker(new Gio.Settings({ schema_id: SCHEMA_ID }))`, then `.delay()`, then a `StoreReader` over it with a counting onChange. Call all four reads, then check `!settings.get_has_unapplied()`, message `'reading never writes'`. Destroy that reader.
  4. Add the **writer does not rewrite stored AI answers** check. Store `answersWith('occ:z|1')` through `settings.set_string('ai-verdicts', serializeAiAnswers(…))`, then build a `StoreWriter`. Count `changed::ai-verdicts`, call `writeAiAnswers` with the same answers, wait 600 ms, and expect 0 emissions. Message: `'writing the stored AI answers again does nothing'`. This pins the moved coalescing seed.

  Run `npm run smoke`. It fails at import (`StoreReader` is not exported). That is the right failure.
- **Then:**
  1. `shell/store.js` as in "Seams".
  2. `app/controller.js`:
     - replace the `StorePort` typedef with `StoreWriterPort` and `StoreReaderPort`. Put `StoreReaderPort` in the controller for this step; step 2 moves it;
     - in the constructor, `this._store = deps.createStore(…)` becomes `this._writer = deps.createStoreWriter();` then `this._reader = deps.createStoreReader(() => this._onStoreChange());`, in that order, at the same place;
     - reads of settings, overrides, travel and AI answers use `this._reader`. Every other store call uses `this._writer`;
     - the destroy steps become `['ticker', 'aiTicker', 'ai', 'ui', 'feed', 'environment', 'clocks' (this._writer), 'store' (this._writer.destroy()), 'reader' (this._reader?.destroy())]`. Null both fields afterwards.
  3. `extension/extension.js`: import `{ StoreReader, StoreWriter }`. `createStore` becomes `createStoreReader: onChange => new StoreReader(this._settings, onChange)` and `createStoreWriter: () => new StoreWriter(this._settings)`.
  4. `tests/unit/support/controllerHarness.js`: `makeStore(onChange, h)` becomes `makeStore(h)`. It returns the same record, with the same fields (`settings`, `overrides`, `travel`, `seeds`, `alertWrites`, `aiAnswers`, `aiWrites`, `clockWrites`, `verdictCalls`, `modeCalls`, `travelCalls`, `prunes`, and `onChange`, initially `null`) and two facet objects:
     - `store.reader = { readSettings, readOverrides, readTravel, readAiAnswers, destroy: () => h.log.push('reader.destroy') }`;
     - `store.writer = { readAlertState, writeAlertState, writeAiAnswers, readHealthSeeds, writeHealthClocks, setVerdictOverride, setModeOverride, setTravel, pruneOccurrenceOverrides, destroy: () => h.log.push('store.destroy') }`.

     Each function body is unchanged. `setup()` builds `h.store = makeStore(h)` before `new Controller`, and passes `createStoreWriter: () => h.store.writer` and `createStoreReader: onChange => { h.store.onChange = onChange; return h.store.reader; }`. `setupInto(h)` does the same with its `inner` record.
  5. The test edits allowed, and no others:
     - `controller.test.js` test "19. every part is destroyed in order…": append `'reader.destroy'` to the expected array;
     - test "20. a part failing to build…": expect `['feed.destroy', 'environment.destroy', 'store.destroy', 'reader.destroy']`;
     - `controller.ai.test.js` test 18: append `'reader.destroy'`;
     - test 20 "a controller without the AI factories…": replace `createStore` with `createStoreWriter: () => (log.push('store.create'), makeStore(inner).writer)` and `createStoreReader: onChange => (log.push('reader.create'), makeStore(inner).reader)`, and remove the `makeStore(onChange, …)` call form. Its assertions are unchanged (the log stays `[]`).
- **Why here:** the store is the settings adapter (ADR-0011 port table). The facets are §7.2's contract.

### Step 2 — extract the verdict component  [repair: behaviour unchanged, new internal seam]

- **Behaviour change:** none for the owner, and none in any controller assertion except the destroy order below. Every line moved into `Verdicts` keeps its logic. Only field names change (for example `this._aiQueue` becomes `this._queue`, and `this._feed` becomes `Verdicts`' own).
- **Test first:** new `tests/unit/verdicts.test.js` (SPDX header). Set `process.env.TZ = 'UTC'` before the dynamic imports, as `controller.ai.test.js` does. Import `Verdicts` from `../../extension/app/verdicts.js`, and `EN, KEY, SNAP, MEETING, meeting, makeStore, makeFeed, makeAiClient` from `./support/controllerHarness.js`. Silence and collect `console.error` and `console.warn` as `controller.ai.test.js` does. Add a local `setup({ settings = {}, aiAnswers = null, aiClient = makeAiClient } = {})`:
  - it builds `h = { now: EN, log: [], settings, seeds: null, aiAnswers, aiClients: [], aiTicker: null, aiTickers: 0, writes: [] }` and `h.store = makeStore(h)`;
  - it calls `new Verdicts({...})` with:
    - `createStoreReader` setting `h.store.onChange`;
    - `createFeed: onUpdate => (h.feed = makeFeed(onUpdate, h))`;
    - `createAiClient` pushing to `h.aiClients`;
    - `createAiTicker` recording `h.aiTicker` with `fire` and `destroy` pushing `'aiTicker.destroy'`, as the controller harness does;
    - `writeAnswers: a => h.writes.push(a)`;
    - `now: () => h.now`.
  - Helpers: `h.deliver(t)` sets the clock and calls `h.feed.deliver(SNAP)`. `h.aiTick(t)` sets the clock and calls `h.aiTicker?.fire()`.
  - Reuse the `AI`, `TAG`, `stored`, `verdict`, `failed` and `STALE` definitions: copy those small constants from `controller.ai.test.js`. They are test data, not logic.

  Tests (one `test` each, grouped by `describe`):
  1. **construction:** missing any one of the six deps throws `TypeError`, and no factory was called (factories push to a log). `createFeed` throwing destroys the reader (`'reader.destroy'` logged) and rethrows.
  2. **inputs:** equal the store's values. `Object.isFrozen` is true for `inputs`, `inputs.settings`, `inputs.overrides`, `inputs.overrides.verdict` and `inputs.travel`. After `h.store.settings.soundEnabled = false; h.store.onChange()`, `inputs.settings.soundEnabled` is false.
  3. **judgedList, rules mode:**
     - no snapshot: an empty `judged` and an empty `byKey`;
     - after `deliver`, `judged` deep-equals `judge(SNAP, { ...DEFAULT_SETTINGS, ai: null }, { verdict: {}, mode: {} }, {}, {})`, and `byKey.get(KEY)` is that list's entry;
     - a second call with a later `now` returns the **same object**;
     - after `deliver`, after `reloadOverridesAndTravel()` (with `h.store.overrides.verdict[KEY] = 'ignore'` set first), and after `h.store.onChange()`, it returns a new object that reflects the change.
  4. **the reader is only read:** after a rules-mode and an AI-mode run (build, deliver, judge, AI tick, answer, prune, destroy), `h.store.alertWrites`, `aiWrites`, `clockWrites`, `verdictCalls`, `modeCalls`, `travelCalls` and `prunes` are all empty. Every AI write is in `h.writes`.
  5. **AI mode asks, and answers flow through writeAnswers:**
     - `setup({ settings: AI })` creates one AI ticker and one client;
     - `deliver`, then `judgedList`, then `aiTick` gives one ask, whose invite title is `'Client review'`;
     - `answer(verdict('ignore', 'optional sync'))` gives `h.writes.length === 1`;
     - the next `judgedList` gives `byKey.get(KEY).reason === 'AI: optional sync'`.
  6. **the AI tick waits for a pending re-judge:** in AI mode, `deliver` then `aiTick` with no `judgedList` call gives 0 asks.
  7. **withheld second pass (§6.5):**
     - with `STALE()` stored (KEY, `fp: '00000000000000'`), `deliver`, `judgedList` and `aiTick` show `'AI: optional sync'` for KEY while KEY is asked again;
     - answering `failed('network')` gives `ai.engineDown === true`;
     - the next `judgedList` gives KEY the rules' verdict `'must'`, with a reason that does not start with `'AI:'` (as `controller.ai.test.js` test 11 checks);
     - `ai.status === 'unavailable'` after the next `aiTick`.
  8. **engine sync:** switching `h.store.settings.verdictSource` to `'rules'` and calling `h.store.onChange()` destroys the AI ticker and the client (`'aiTicker.destroy'`, `client.destroyed`). The next `judgedList` equals the rules-mode oracle of test 3.
  9. **a broken AI side cannot throw out:** with the broken client from `controller.ai.test.js` test 4 (copy its 10-line factory), `judgedList`, `aiTick`, `pruneAiAnswers` and `destroy` do not throw. The `'payattention: ai-failed …'` texts are each logged once.
  10. **pruneAiAnswers:** stored answers with one entry older than retention (as `controller.ai.test.js` test 19 builds) give exactly one `h.writes` entry without it. With nothing stored, nothing is written.
  11. **feedFacts and refresh:**
      - `feedFacts` mirrors `h.feed.snapshot`, `acceptedAt` and `syncedAt`, and is frozen;
      - `refresh('resume')` gives `h.feed.refreshes` = `['resume']`.
  12. **destroy:**
      - AI mode: the log is `['aiTicker.destroy', 'aiClient.destroy', 'feed.destroy', 'reader.destroy']`;
      - a second `destroy()` logs nothing;
      - a late outcome on the old ask adds nothing to `h.writes`;
      - `judgedList(now)` after destroy returns an empty list.

  Run `npm test`. The suite fails at import (the module does not exist). That is the right failure.
- **Then:**
  1. Create `extension/app/verdicts.js` as in "Seams", and move the following into it.
     - **From the controller's constructor:**
       - the reader creation, now `deps.createStoreReader(() => this._onStoreChange())`;
       - `deps.createFeed(() => this._onFeedUpdate())`;
       - the `new AiQueue({...})` block, with `writeAnswers: deps.writeAnswers`;
       - `this._ai = this._queue.state`;
       - then `_loadInputs()`.

       Order: reader, feed, queue, inputs. Wrap it in `try { … } catch (e) { this.destroy(); throw e; }`, as the controller does.
     - **`_loadInputs`**: as today. It builds the frozen `inputs` from `readSettings`, `timingFromSettings`, `readOverrides` and `readTravel`, sets the dirty flag, then sets the engine with `aiEngine(settings)` and calls `_syncAi()`.
     - **Moved unchanged** (renamed fields only): `_syncAi`, `_aiTick`, `_onAiChange`, `_aiSafely`, and `_judgeAll` (reading `this._inputs`).
     - **`_onStoreChange`**: `if (!this._destroyed) this._loadInputs();`.
     - **`_onFeedUpdate`**: sets the dirty flag.
     - **`judgedList(now)`**:
       - if destroyed, return the module constant `EMPTY_LIST`, which is `Object.freeze({ judged: Object.freeze([]), byKey: new Map() })`;
       - if dirty, set `judged = this._judgeAll(now)`, set `this._list = Object.freeze({ judged, byKey: new Map(judged.map(j => [j.key, j])) })`, then clear the dirty flag. The flag is cleared only after `_judgeAll` returns;
       - return `this._list`.
       
       `_aiTick` pumps with `this._list.judged` and `this._inputs.timing.cutoffMs`.
     - **`reloadOverridesAndTravel()`**: if not destroyed, re-read overrides and travel, rebuild `inputs` keeping `settings` and `timing`, and set the dirty flag.
     - **`pruneAiAnswers()`**: `this._aiSafely('prune', () => this._queue.prune())`, when not destroyed.
     - **`destroy()`**: steps `['aiTicker', 'ai', 'feed', 'reader']`, each in `try`/`catch` logging `payattention: destroy-failed <part>`, as the controller does. Then null the fields and set `this._list = EMPTY_LIST`.
     - **Types:** move the `FeedPort` and `StoreReaderPort` typedefs from `controller.js` into `verdicts.js`.
  2. `app/controller.js`: delete everything moved, and the imports it no longer uses (`judge`, `aiEngine`, `AiQueue`, `aiJudgeConfig`, `withholdAnswers`). The constructor builds, in this order:
     - `this._writer = deps.createStoreWriter()`;
     - `this._environment = deps.createEnvironment(…)`;
     - `this._verdicts = new Verdicts({ createStoreReader: deps.createStoreReader, createFeed: deps.createFeed, createAiClient: deps.createAiClient, createAiTicker: deps.createAiTicker, writeAnswers: answers => this._writer.writeAiAnswers(answers), now: deps.now })`;
     - `this._ui = deps.createUi(…)`.

     Then, as today, `enabledAt`, seeds, alert state, `_prune(now)`, `_tick()` and the ticker.
  3. **Controller uses:**

     | Where | Uses |
     |---|---|
     | `_render(now)` | `const list = this._verdicts.judgedList(now); this._judged = list.judged; this._judgedByKey = list.byKey; const { settings, timing } = this._verdicts.inputs; const feed = this._verdicts.feedFacts;` then `dataHealth({ ...feed, seeds, enabledAt, now })` as today. `plan(…, timing, env)`, `aiStatus: this._verdicts.ai.status`, `settings.soundEnabled` |
     | `_prune(now)` | the alert-state reduce and write and `pruneOccurrenceOverrides` go through `this._writer`, then `this._verdicts.pruneAiAnswers()` |
     | `setMode` / `setTravel` | the writer call, then `this._verdicts.reloadOverridesAndTravel()` (in place of the re-read and the dirty flag) |
     | `_setVerdict` | the existing-occurrence check reads `this._verdicts.inputs.overrides.verdict[action.key]`; after the writes, `this._verdicts.reloadOverridesAndTravel()` |
     | `_onResume` | `this._verdicts.refresh('resume'); this._tick();` |
     | `destroy()` | reads the clocks from `this._verdicts.feedFacts` when `this._verdicts && this._enabledAt !== null` (same `try`, same message). Steps: `['ticker', 'ui', 'verdicts', 'environment', 'clocks', 'store' (writer)]`: the reverse of construction, and still AI before the writer's flush |

     The header comment becomes: "The alert front end's orchestrator (ADR-0002, ADR-0011). Plans on every tick from the verdict component's judged list, renders, routes the owner's actions, and owns alert state, sound, the test alert, calendar health and every part's lifetime. Every part that touches GNOME is injected, so this file never imports gi:// and runs under Node with fakes."
  4. The test edits allowed, and no others. They follow only from the one-time destroy-order change, and they keep each test's meaning: every part destroyed once, in a fixed order, even when one throws; AI before the writer's flush; the clocks written before the writer is destroyed.
     - `controller.test.js` test 19: `['ticker.destroy', 'ui.destroy', 'feed.destroy', 'reader.destroy', 'environment.destroy', 'store.writeHealthClocks', 'store.destroy']`;
     - test 20: `['feed.destroy', 'reader.destroy', 'environment.destroy', 'store.destroy']`;
     - `controller.ai.test.js` test 18: `['ticker.destroy', 'ui.destroy', 'aiTicker.destroy', 'aiClient.destroy', 'feed.destroy', 'reader.destroy', 'environment.destroy', 'store.writeHealthClocks', 'store.destroy']`.
  5. `tests/unit/budget.test.js:73` comment: `controller.js _judgeDirty` becomes `verdicts.js judgedList`.
- **Why here:** §7.2 lists exactly this code as the verdict component's, and places it in `app/`.

### Validation

Run the full sequence, and report the real output of each: `npm run lint`, `npm test`, `npm run build`, `npm run test:helper`, `npm run smoke`.

- `npm test` shows every existing controller test passing with only the edits listed above, plus the new `verdicts.test.js` suite.
- The smoke run carries the store checks (step 1) and the real alert ladder through the new composition.

## Callers to update

- **`Store` (removed) → `StoreReader` and `StoreWriter`:**
  - `extension/extension.js` (step 1);
  - `tests/smoke/store-check.js` (step 1).

  Nothing else imports `shell/store.js` (grep `shell/store.js` across `extension`, `tests` and `scripts`: only those two, plus lint probe strings in `tests/unit/boundaries.test.js` that import `x`, not `Store`; leave those).
- **`Controller` deps (`createStore` → `createStoreReader` + `createStoreWriter`):**
  - `extension/extension.js`;
  - `tests/unit/support/controllerHarness.js` (`setup`, `setupInto`);
  - `tests/unit/controller.ai.test.js` test 20.
- **`StorePort` typedef (removed):** only `app/controller.js` uses it.
- **`FeedPort` typedef (moved to `verdicts.js`):** `app/controller.js`'s `createFeed` JSDoc now points to `import('./verdicts.js').FeedPort`.
- **Outside this repository:** none. `interfaces.md` §4, the extension object, is unchanged.

## Out of scope

- **The preview itself** (PG-8c): `extension/preview/`, its lint block, the `--extra-source=preview`, its presenter, and the parity tests of §7.3.
- **A callback from `Verdicts` to its owner** ("the list may have changed"). The controller does not need one. If PG-8c wants one, adding it later is an additive change to that plan.
- **A lint rule that only `app/verdicts.js` may import `core/judge.js`.** It is reported to the architect below. Do not add it here.
- **Pruning `AiQueue` `_retry` and `_failedKeys`** (BACKLOG housekeeping), and every other `AiQueue` change. `aiQueue.js` is not edited.
- **`view.js`, `health.js`, `plan`, `reduce`, `ui/`:** not touched.
- **Renaming `controllerHarness.js`,** even though `verdicts.test.js` now uses its fakes.
- **Architecture documents** (`interfaces.md` §3 and §6.5 still say "controller" for the queue's owner; `boundaries.md` "Ownership of data" names the controller as the reader of AI answers). They are reported, not edited.

## Stop and escalate if

- A controller test other than the four listed destroy-order and harness edits has to change an assertion. That would mean behaviour moved, and the extraction is wrong.
- Freezing `inputs` makes any test throw a `TypeError` for an assignment. Something mutates an input that this plan says nothing mutates. Stop and report where; do not remove the freeze.
- `judgedList` has to be called from anywhere but `Controller._render` for the controller suites to pass.
- The GJS check "writing the stored AI answers again does nothing" fails after the seed moved into the `StoreWriter` constructor.
- Any file other than `app/verdicts.js` still imports `core/judge.js` when you finish. Check with `grep -rn "core/judge.js" extension`.
