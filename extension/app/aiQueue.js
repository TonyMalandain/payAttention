// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The AI queue (interfaces.md §6.5): which meeting to ask next, when, what each
// outcome means, and what the controller passes to judge and to the view. It
// decides; the AI helper client only carries. Gi-free, so Node tests it. Never
// on the alert path: the controller reads only the frozen state it publishes.
import { recordAiAnswer, pruneAiAnswers } from '../core/aiAnswers.js';
import { RequestBudget } from './aiBudget.js';

/** First wait after a failed ask for one occurrence; it doubles up to ASK_RETRY_MAX_MS (constraints.md). */
export const ASK_RETRY_FIRST_MS = 60_000;
export const ASK_RETRY_MAX_MS = 1_800_000;
/** The failure codes that mean the engine could not be reached (§6.5). Frozen. */
export const ENGINE_UNREACHABLE_CODES = Object.freeze(['network', 'timeout', 'tls', 'server']);
/** Engine pause after an unreachable failure: the first, and the cap (D-031, constraints.md). */
export const UNREACHABLE_PAUSE_FIRST_MS = 30_000;
export const UNREACHABLE_PAUSE_MAX_MS = 90_000;
/** Engine pause after 'auth', 'config' or 'no-key' (the engine or its setup refused us). */
export const ENGINE_REFUSED_PAUSE_MS = 1_800_000;
/** Engine pause after 'rate-limited' without retryAfterS; with it, retryAfterS s capped at ENGINE_REFUSED_PAUSE_MS. */
export const RATE_LIMIT_PAUSE_MS = 300_000;
/** The shell's watchdog: an ask unanswered for engine.timeoutMs + this is a 'timeout'. */
export const WATCHDOG_GRACE_MS = 10_000;
/** From this many 'lost' outcomes in a row for one key, that key fails and backs off, so one crashing invite never blocks the queue. */
export const LOST_STREAK_LIMIT = 2;

const ENGINE_REFUSED_CODES = ['auth', 'config', 'no-key'];

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
 * What the controller passes to judge and to the view, published by the queue on every change.
 * Frozen; never mutated. `answers` holds the stored items (entries carry `at`, which judge
 * ignores) and is the same object until the answers change. `failedKeys` holds the occurrence
 * keys whose own most recent ask failed, and is the same Set until its contents change.
 * `engineDown` is §6.5 "engine down".
 * @typedef {Readonly<{status:'off'|'ok'|'unavailable',
 *   answers: import('../core/types.js').AiAnswers,
 *   failedKeys: ReadonlySet<string>,
 *   engineDown: boolean}>} AiState
 */

/**
 * @param {number|null} previousMs the last wait for this occurrence, or null after none or a success
 * @returns {number} ASK_RETRY_FIRST_MS for null, else min(previousMs * 2, ASK_RETRY_MAX_MS)
 */
export function nextAskRetryMs(previousMs) {
    return previousMs === null ? ASK_RETRY_FIRST_MS : Math.min(previousMs * 2, ASK_RETRY_MAX_MS);
}

/**
 * The engine pause after an unreachable failure (§6.5).
 *
 * @param {number|null} previousMs the last unreachable pause, or null when the backoff is reset
 * @returns {number} UNREACHABLE_PAUSE_FIRST_MS for null, else min(previousMs * 2, UNREACHABLE_PAUSE_MAX_MS)
 */
export function nextEnginePauseMs(previousMs) {
    return previousMs === null ? UNREACHABLE_PAUSE_FIRST_MS : Math.min(previousMs * 2, UNREACHABLE_PAUSE_MAX_MS);
}

/**
 * §6.5 "waiting meeting": the queue's pick test without the retry check. The one
 * definition; the pick and the status both use it.
 *
 * @param {import('../core/types.js').JudgedOccurrence} j
 * @param {number} cutoffMs
 * @param {number} now
 * @returns {boolean}
 */
export function isWaiting(j, cutoffMs, now) {
    return j.aiAsk !== undefined && j.start !== null && j.start >= now - cutoffMs;
}

/**
 * §6.5 "Status for the View".
 *
 * @param {{hasEngine:boolean, engineDown:boolean, failedKeys:ReadonlySet<string>}} failure
 * @param {ReadonlyArray<import('../core/types.js').JudgedOccurrence>} judged
 * @param {number} cutoffMs
 * @param {number} now
 * @returns {'off'|'ok'|'unavailable'} 'off' without an engine; 'unavailable' when a waiting
 *   meeting is decided by the rules because of a failure; else 'ok'
 */
export function aiStatusOf(failure, judged, cutoffMs, now) {
    if (!failure.hasEngine)
        return 'off';
    const failing = judged.some(j => isWaiting(j, cutoffMs, now) &&
        (failure.engineDown || failure.failedKeys.has(j.key)));
    return failing ? 'unavailable' : 'ok';
}

/**
 * §6.5 "waiting meeting", counted for a front end that waits for the AI (the preview,
 * interfaces.md §7.3). Uses isWaiting, the one definition.
 *
 * @param {AiState} ai
 * @param {ReadonlyArray<import('../core/types.js').JudgedOccurrence>} judged
 * @param {number} cutoffMs
 * @param {number} now
 * @returns {Readonly<{pending: number, byRules: number}>} over the waiting meetings:
 *   byRules = those whose own last ask failed (ai.failedKeys) or all of them while ai.engineDown;
 *   pending = the rest (still to be answered). Frozen.
 */
export function aiProgressOf(ai, judged, cutoffMs, now) {
    let pending = 0;
    let byRules = 0;
    for (const j of judged) {
        if (!isWaiting(j, cutoffMs, now))
            continue;
        if (ai.engineDown || ai.failedKeys.has(j.key))
            byRules++;
        else
            pending++;
    }
    return Object.freeze({ pending, byRules });
}

/**
 * judge's config.ai for this engine (interfaces.md §6.4).
 *
 * @param {AiEngine|null} engine from aiEngine(settings)
 * @param {number} now
 * @returns {import('../core/types.js').AiJudgeConfig|null}
 */
export function aiJudgeConfig(engine, now) {
    if (engine === null)
        return null;
    // East positive; `|| 0` turns the −0 of UTC into 0.
    const utcOffsetMinutes = -new Date(now).getTimezoneOffset() || 0;
    return { engineTag: engine.engineTag, utcOffsetMinutes };
}

/**
 * The answers judge's second pass gets (§6.5): the entry of every key in `judged` that
 * carries aiAsk and has an entry is withheld when ai.engineDown is true, or when
 * ai.failedKeys has that key.
 *
 * @param {ReadonlyArray<import('../core/types.js').JudgedOccurrence>} judged the output of a judge pass given ai.answers
 * @param {AiState} ai
 * @returns {import('../core/types.js').AiAnswers|null} null when nothing is withheld; else a frozen copy without the withheld keys
 */
export function withholdAnswers(judged, ai) {
    const withheld = new Set();
    for (const j of judged) {
        if (j.aiAsk !== undefined && Object.hasOwn(ai.answers, j.key) && (ai.engineDown || ai.failedKeys.has(j.key)))
            withheld.add(j.key);
    }
    if (withheld.size === 0)
        return null;
    return Object.freeze(Object.fromEntries(Object.entries(ai.answers).filter(([k]) => !withheld.has(k))));
}

const isStoredAnswers = a => typeof a === 'object' && a !== null && a.v === 1 &&
    typeof a.items === 'object' && a.items !== null;

export class AiQueue {
    /**
     * Holds no engine (status 'off') and creates no client until setEngine() gives one.
     *
     * @param {object} p
     * @param {import('../core/types.js').StoredAiAnswers} p.answers what the store holds now
     * @param {(answers: import('../core/types.js').StoredAiAnswers) => void} p.writeAnswers the store's coalesced write
     * @param {(engine: AiEngine) => AiClientPort} p.createClient
     * @param {(state: AiState) => void} p.onChange called after every change of state(), never during construction, never after destroy()
     * @param {() => number} p.now
     * @throws {TypeError} when a function is missing or answers is not a StoredAiAnswers ({v:1, items:object})
     */
    constructor({ answers, writeAnswers, createClient, onChange, now }) {
        for (const [name, fn] of Object.entries({ writeAnswers, createClient, onChange, now })) {
            if (typeof fn !== 'function')
                throw new TypeError(`AiQueue: ${name} must be a function`);
        }
        if (!isStoredAnswers(answers))
            throw new TypeError('AiQueue: answers must be {v:1, items}');
        this._writeAnswers = writeAnswers;
        this._createClient = createClient;
        this._onChange = onChange;
        this._now = now;

        this._engine = null;
        this._client = null;
        this._answers = answers;
        this._inFlight = null;
        this._retry = new Map();
        /** key → that key's own asks in a row that ended in 'lost' (§6.5 "Lost streak"). */
        this._lostStreak = new Map();
        this._failedKeys = new Set();
        this._failedKeysChanged = false;
        this._engineDown = false;
        this._pausedUntil = 0;
        this._enginePauseMs = null;
        this._budget = new RequestBudget();
        this._logged = new Set();
        this._lastJudged = [];
        this._lastCutoffMs = 0;
        this._destroyed = false;
        this._state = Object.freeze({ status: 'off', answers: answers.items, failedKeys: new Set(), engineDown: false });
    }

    /** @returns {AiState} the current state (the same object onChange last passed, or the initial one) */
    get state() {
        return this._state;
    }

    /**
     * The engine to use, from aiEngine(settings). The same engineTag (or null again)
     * does nothing. Otherwise every per-engine record is forgotten and a client is
     * made for the new engine (none for null). The budget is kept (it is per engineTag).
     *
     * @param {AiEngine|null} engine
     */
    setEngine(engine) {
        if (this._destroyed || (engine?.engineTag ?? null) === (this._engine?.engineTag ?? null))
            return;
        if (this._client !== null) {
            try {
                this._client.destroy();
            } catch (e) {
                this._logOnce('destroy', () => console.error('payattention: ai-failed destroy', e));
            }
        }
        this._engine = engine;
        this._client = null;
        this._inFlight = null;
        this._retry.clear();
        this._lostStreak.clear();
        if (this._failedKeys.size > 0) {
            this._failedKeys.clear();
            this._failedKeysChanged = true;
        }
        this._engineDown = false;
        this._pausedUntil = 0;
        this._enginePauseMs = null;
        this._logged.clear();
        if (engine !== null) {
            try {
                this._client = this._createClient(engine);
            } catch (e) {
                // No retry until the engine changes: the status says the rules decide.
                this._logOnce('client', () => console.error('payattention: ai-failed client', e));
                this._client = null;
                this._engineDown = true;
            }
        }
        this._update(this._now());
    }

    /**
     * One step of the queue, called every second by the AI ticker. It sends at
     * most one ask, and always recomputes the status. Never throws.
     *
     * @param {ReadonlyArray<import('../core/types.js').JudgedOccurrence>} judged the latest judge output, in judge order
     * @param {number} cutoffMs timing.cutoffMs
     */
    pump(judged, cutoffMs) {
        if (this._destroyed)
            return;
        const now = this._now();
        this._lastJudged = judged;
        this._lastCutoffMs = cutoffMs;
        try {
            this._step(judged, cutoffMs, now);
        } catch (e) {
            this._logOnce('pump', () => console.error('payattention: ai-failed pump', e));
            this._engineDown = true;
        }
        this._update(now);
    }

    /** Drops stored answers past retention, writing and publishing only when something went. */
    prune() {
        if (this._destroyed)
            return;
        const now = this._now();
        const pruned = pruneAiAnswers(this._answers, now);
        if (pruned === this._answers)
            return;
        this._answers = pruned;
        this._writeAnswers(pruned);
        this._update(now);
    }

    /** Destroys the client. Idempotent; nothing is written or published afterwards. */
    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        try {
            this._client?.destroy();
        } catch (e) {
            this._logOnce('destroy', () => console.error('payattention: ai-failed destroy', e));
        }
        this._client = null;
        this._inFlight = null;
    }

    _step(judged, cutoffMs, now) {
        const engine = this._engine;
        const client = this._client;
        if (engine === null || client === null)
            return;

        if (this._inFlight !== null) {
            const token = this._inFlight;
            if (now - token.sentAt >= engine.timeoutMs + WATCHDOG_GRACE_MS) {
                client.kill();
                this._settle(token, { type: 'failed', code: 'timeout' });
            }
            return;
        }
        if (now < this._pausedUntil)
            return;

        const j = judged.find(x => isWaiting(x, cutoffMs, now) &&
            !(this._retry.get(x.key)?.retryAt > now));
        if (j === undefined)
            return;
        if (!client.ready)
            return;
        if (!this._budget.trySpend(engine.engineTag, now)) {
            this._engineDown = true;
            return;
        }

        const token = { key: j.key, fp: j.aiAsk.fp, engineTag: engine.engineTag, sentAt: now, downAtSend: this._engineDown };
        this._inFlight = token;
        try {
            client.ask(j.aiAsk.invite, outcome => this._settle(token, outcome));
        } catch (e) {
            this._logOnce('ask', () => console.error('payattention: ai-failed ask', e));
            this._settle(token, { type: 'lost' });
        }
    }

    _settle(token, outcome) {
        if (this._destroyed || token !== this._inFlight)
            return;
        this._inFlight = null;
        const now = this._now();
        try {
            this._apply(token, outcome, now);
        } catch (e) {
            this._logOnce('settle', () => console.error('payattention: ai-failed settle', e));
            this._engineDown = true;
        }
        this._update(now);
    }

    /** The §6.5 outcome table. */
    _apply(token, outcome, now) {
        if (outcome.type === 'verdict') {
            this._answers = recordAiAnswer(this._answers, token.key,
                { fp: token.fp, verdict: outcome.verdict, reason: outcome.reason }, now);
            this._writeAnswers(this._answers);
            this._lostStreak.delete(token.key);
            this._engineDown = false;
            this._removeFailed(token.key);
            this._retry.delete(token.key);
            this._enginePauseMs = null;
            return;
        }
        if (outcome.type === 'lost') {
            this._logOnce('lost', () => console.warn('payattention: ai-helper-lost'));
            this._engineDown = true;
            // Not gated on downAtSend: after the first 'lost' the engine is down, so a re-ask of a crashing invite always is.
            const streak = (this._lostStreak.get(token.key) ?? 0) + 1;
            this._lostStreak.set(token.key, streak);
            if (streak >= LOST_STREAK_LIMIT) {
                this._addFailed(token.key);
                this._advanceRetry(token.key, now);
            }
            this._budget.refund(token.engineTag, token.sentAt);
            return;
        }

        this._lostStreak.delete(token.key);
        const code = outcome.code;
        this._logOnce('failed ' + code, () => console.warn(`payattention: ai-request-failed ${code}`));
        this._addFailed(token.key);
        if (ENGINE_UNREACHABLE_CODES.includes(code)) {
            this._engineDown = true;
            // A probe sent while the engine was already down says nothing about this meeting.
            if (!token.downAtSend)
                this._advanceRetry(token.key, now);
            const w = nextEnginePauseMs(this._enginePauseMs);
            this._enginePauseMs = w;
            this._pausedUntil = Math.max(this._pausedUntil, now + w);
            this._budget.refund(token.engineTag, token.sentAt);
        } else if (ENGINE_REFUSED_CODES.includes(code)) {
            this._engineDown = true;
            this._advanceRetry(token.key, now);
            this._pausedUntil = Math.max(this._pausedUntil, now + ENGINE_REFUSED_PAUSE_MS);
        } else if (code === 'rate-limited') {
            this._engineDown = true;
            this._advanceRetry(token.key, now);
            const pause = outcome.retryAfterS === undefined
                ? RATE_LIMIT_PAUSE_MS
                : Math.min(outcome.retryAfterS * 1000, ENGINE_REFUSED_PAUSE_MS);
            this._pausedUntil = Math.max(this._pausedUntil, now + pause);
        } else if (code === 'bad-reply') {
            // The engine did reply.
            this._engineDown = false;
            this._advanceRetry(token.key, now);
            this._enginePauseMs = null;
        } else {
            // 'bad-request', or a code that cannot arrive today: never pauses or unpauses the engine.
            this._advanceRetry(token.key, now);
        }
    }

    _advanceRetry(key, now) {
        const w = nextAskRetryMs(this._retry.get(key)?.waitMs ?? null);
        this._retry.set(key, { waitMs: w, retryAt: now + w });
    }

    _addFailed(key) {
        if (!this._failedKeys.has(key)) {
            this._failedKeys.add(key);
            this._failedKeysChanged = true;
        }
    }

    _removeFailed(key) {
        if (this._failedKeys.delete(key))
            this._failedKeysChanged = true;
    }

    _logOnce(id, log) {
        if (this._logged.has(id))
            return;
        this._logged.add(id);
        log();
    }

    /** The only place that publishes. */
    _update(now) {
        if (this._destroyed)
            return;
        const status = aiStatusOf({ hasEngine: this._engine !== null, engineDown: this._engineDown, failedKeys: this._failedKeys },
            this._lastJudged, this._lastCutoffMs, now);
        const failedKeys = this._failedKeysChanged ? new Set(this._failedKeys) : this._state.failedKeys;
        const s = this._state;
        if (status === s.status && this._answers.items === s.answers && this._engineDown === s.engineDown &&
            failedKeys === s.failedKeys)
            return;
        this._failedKeysChanged = false;
        this._state = Object.freeze({ status, answers: this._answers.items, failedKeys, engineDown: this._engineDown });
        this._onChange(this._state);
    }
}
