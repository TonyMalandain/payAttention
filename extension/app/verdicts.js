// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The verdict component (interfaces.md §7.2, ADR-0011): everything between the
// inputs and the judged list, and the only caller of core/judge.js. Two front
// ends use it: the alert controller and the preview. It never plans, never
// renders, never touches alert state, and writes nothing except AI answers,
// through the writeAnswers it is given.
import { judge } from '../core/judge.js';
import { timingFromSettings } from '../core/timing.js';
import { aiEngine } from '../core/aiEngine.js';
import { AiQueue, aiJudgeConfig, aiProgressOf, withholdAnswers } from './aiQueue.js';

/**
 * @typedef {object} StoreReaderPort the store's reader facet
 * @property {() => import('../core/types.js').Settings} readSettings
 * @property {() => import('../core/types.js').Overrides} readOverrides
 * @property {() => import('../core/types.js').TravelTimes} readTravel
 * @property {() => import('../core/types.js').StoredAiAnswers} readAiAnswers
 * @property {() => void} destroy stops the change signal
 */
/**
 * @typedef {object} FeedPort
 * @property {import('../core/types.js').Snapshot|null} snapshot last accepted
 * @property {number|null} acceptedAt
 * @property {ReadonlyMap<string, number>} syncedAt
 * @property {(reason: 'resume'|'manual') => void} refresh
 * @property {() => void} destroy
 */
/**
 * @typedef {Readonly<{settings: import('../core/types.js').Settings, timing: import('../core/types.js').Timing,
 *   overrides: import('../core/types.js').Overrides, travel: import('../core/types.js').TravelTimes}>} VerdictInputs
 * @typedef {Readonly<{judged: ReadonlyArray<import('../core/types.js').JudgedOccurrence>,
 *   byKey: ReadonlyMap<string, import('../core/types.js').JudgedOccurrence>}>} JudgedList
 * @typedef {Readonly<{snapshot: import('../core/types.js').Snapshot|null, acceptedAt: number|null,
 *   syncedAt: ReadonlyMap<string, number>}>} FeedFacts
 */

const EMPTY_LIST = Object.freeze({ judged: Object.freeze([]), byKey: new Map() });
const NO_PROGRESS = Object.freeze({ pending: 0, byRules: 0 });

const DEP_NAMES = ['createStoreReader', 'createFeed', 'createAiClient', 'createAiTicker', 'writeAnswers', 'now'];

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
    constructor(deps) {
        const missing = DEP_NAMES.filter(name => typeof deps[name] !== 'function');
        if (missing.length > 0)
            throw new TypeError(`verdicts: deps.${missing.join(', deps.')} must be functions`);
        this._deps = deps;
        this._destroyed = false;
        this._reader = null;
        this._feed = null;
        this._queue = null;
        this._aiTicker = null;
        this._aiEngine = null;
        this._ai = null;
        this._aiErrors = new Set();
        this._inputs = null;
        this._list = EMPTY_LIST;
        this._dirty = true;
        try {
            this._reader = deps.createStoreReader(() => this._onStoreChange());
            this._feed = deps.createFeed(() => this._onFeedUpdate());
            this._queue = new AiQueue({
                answers: this._reader.readAiAnswers(),
                writeAnswers: deps.writeAnswers,
                createClient: deps.createAiClient,
                onChange: state => this._onAiChange(state),
                now: deps.now,
            });
            this._ai = this._queue.state;
            this._loadInputs();
        } catch (e) {
            this.destroy();
            throw e;
        }
    }

    /** @returns {VerdictInputs} the inputs last read; a new frozen object after every reload */
    get inputs() {
        return this._inputs;
    }

    /** @returns {import('./aiQueue.js').AiState} the AI queue's last published state (status, answers, failedKeys, engineDown) */
    get ai() {
        return this._ai;
    }

    /**
     * @returns {FeedFacts} the calendar feed's facts now, for health and for the clocks; a new frozen object per call.
     *   After destroy(), no snapshot, no times and an empty syncedAt.
     */
    get feedFacts() {
        if (this._destroyed)
            return Object.freeze({ snapshot: null, acceptedAt: null, syncedAt: new Map() });
        const feed = this._feed;
        return Object.freeze({ snapshot: feed.snapshot, acceptedAt: feed.acceptedAt, syncedAt: feed.syncedAt });
    }

    /**
     * The judged list, recomputed at `now` only when an input moved since the
     * last computation (snapshot, settings, overrides, travel, or the AI state's
     * answers, failed keys or engine down). Otherwise the same object as last time.
     * Empty while there is no snapshot, and after destroy(). Throws only if judge
     * throws; the list is then still marked for recomputation.
     * AI asks happen only after judgedList is called again following a change.
     *
     * @param {number} now
     * @returns {JudgedList}
     */
    judgedList(now) {
        if (this._destroyed)
            return EMPTY_LIST;
        if (this._dirty) {
            const judged = this._judgeAll(now);
            this._list = Object.freeze({ judged, byKey: new Map(judged.map(j => [j.key, j])) });
            this._dirty = false;
        }
        return this._list;
    }

    /**
     * How far the AI has got, for a front end that waits for it (interfaces.md §7.3).
     * Computes judgedList(now) first, so the counts always describe the list as of now.
     *
     * @param {number} now
     * @returns {Readonly<{pending: number, byRules: number}>} aiProgressOf over that list;
     *   {pending: 0, byRules: 0} without an engine (no aiAsk is ever set) and after destroy()
     */
    aiProgress(now) {
        if (this._destroyed)
            return NO_PROGRESS;
        return aiProgressOf(this._ai, this.judgedList(now).judged, this._inputs.timing.cutoffMs, now);
    }

    /** Re-reads overrides and travel times (the owner just changed one) and marks the list for recomputation. */
    reloadOverridesAndTravel() {
        if (this._destroyed)
            return;
        const { settings, timing } = this._inputs;
        this._inputs = freezeInputs(settings, timing, this._reader.readOverrides(), this._reader.readTravel());
        this._dirty = true;
    }

    /** @param {'resume'|'manual'} reason passed to the feed; does nothing after destroy() */
    refresh(reason) {
        if (this._destroyed)
            return;
        this._feed.refresh(reason);
    }

    /** Drops stored AI answers past retention (writes through writeAnswers only when one went). Never throws. */
    pruneAiAnswers() {
        if (this._destroyed)
            return;
        this._aiSafely('prune', () => this._queue.prune());
    }

    /** Idempotent. Destroys, in order: the AI ticker, the AI queue, the feed, the reader. Logs each failure and goes on. */
    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        const steps = [
            ['aiTicker', () => this._aiTicker?.destroy()],
            ['ai', () => this._queue?.destroy()],
            ['feed', () => this._feed?.destroy()],
            ['reader', () => this._reader?.destroy()],
        ];
        for (const [part, run] of steps) {
            try {
                run();
            } catch (e) {
                console.error(`payattention: destroy-failed ${part}`, e);
            }
        }
        this._aiTicker = null;
        this._queue = null;
        this._feed = null;
        this._reader = null;
        this._list = EMPTY_LIST;
    }

    _loadInputs() {
        const settings = this._reader.readSettings();
        this._inputs = freezeInputs(settings, timingFromSettings(settings), this._reader.readOverrides(), this._reader.readTravel());
        this._dirty = true;
        this._aiEngine = aiEngine(settings);
        this._syncAi();
    }

    /** Gives the queue the engine, and runs the AI ticker only while there is one. */
    _syncAi() {
        this._aiSafely('engine', () => this._queue.setEngine(this._aiEngine));
        if (this._aiEngine !== null && this._aiTicker === null) {
            this._aiSafely('ticker', () => {
                this._aiTicker = this._deps.createAiTicker(() => this._aiTick());
            });
        } else if (this._aiEngine === null && this._aiTicker !== null) {
            this._aiSafely('ticker', () => this._aiTicker.destroy());
            this._aiTicker = null;
        }
    }

    /** The AI ticker: never judges, and waits for a pending re-judge. */
    _aiTick() {
        if (this._destroyed || this._dirty)
            return;
        this._aiSafely('pump', () => this._queue.pump(this._list.judged, this._inputs.timing.cutoffMs));
    }

    /** The queue published a new state; the next judgedList re-judges if the inputs moved. */
    _onAiChange(state) {
        if (this._destroyed)
            return;
        const previous = this._ai;
        this._ai = state;
        if (state.answers !== previous.answers || state.failedKeys !== previous.failedKeys ||
            state.engineDown !== previous.engineDown)
            this._dirty = true;
    }

    /** Runs an AI step so that it can never throw into a front end; logs each distinct failure once. */
    _aiSafely(what, fn) {
        try {
            fn();
        } catch (e) {
            const id = what + String(e);
            if (!this._aiErrors.has(id)) {
                this._aiErrors.add(id);
                console.error('payattention: ai-failed ' + what, e);
            }
        }
    }

    /**
     * judge, with the stored AI answers minus those withheld (§6.5). A second pass
     * runs only while something is withheld. In rules mode config.ai is null, and
     * judge gives exactly the rules output.
     */
    _judgeAll(now) {
        const snapshot = this._feed.snapshot;
        if (!snapshot)
            return [];
        const { settings, overrides, travel } = this._inputs;
        const config = { ...settings, ai: aiJudgeConfig(this._aiEngine, now) };
        const first = judge(snapshot, config, overrides, travel, this._ai.answers);
        const kept = withholdAnswers(first, this._ai);
        return kept === null ? first : judge(snapshot, config, overrides, travel, kept);
    }

    _onStoreChange() {
        if (!this._destroyed)
            this._loadInputs();
    }

    _onFeedUpdate() {
        this._dirty = true;
    }
}

/** No front end can change what the next judge sees. */
function freezeInputs(settings, timing, overrides, travel) {
    return Object.freeze({
        settings: Object.freeze(settings),
        timing,
        overrides: Object.freeze({ verdict: Object.freeze(overrides.verdict), mode: Object.freeze(overrides.mode) }),
        travel: Object.freeze(travel),
    });
}
