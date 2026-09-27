// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// One preview run (interfaces.md §7.3, ADR-0012): the verdict component over the
// injected adapters, a 1 s run tick that waits for the calendar and the AI, and
// one outcome. It holds no judgment, and nothing it builds can write: the AI
// answers stay in the AI queue's memory for the run (D-033). Gi-free, so Node
// tests it with a fake clock.
import { aiEngine } from '../core/aiEngine.js';
import { Verdicts } from '../app/verdicts.js';
import { formatPreview } from './report.js';
import { EXIT, internalErrorText, progressText } from './cli.js';

export const SNAPSHOT_WAIT_MS = 30_000;   // constraints.md, §7.3
export const AI_WAIT_MS = 300_000;        // constraints.md, §7.3; counted from the first accepted snapshot
export const NO_CALENDAR_TEXT = 'payAttention: no calendar data after 30 seconds. The calendar helper\'s messages above say why. Run this in a terminal on your desktop, not over SSH.';

const DEP_NAMES = ['createStoreReader', 'createFeed', 'createAiClient', 'createTicker', 'progress', 'onFinish', 'now'];

/**
 * The verdict component's writeAnswers. The AI queue records every answer in its
 * own state before it calls this, so the answers live for the run and are never stored.
 */
function keepAnswersInMemoryOnly() {}

/** @typedef {{code: 0|1|3, stdout: string, stderr: string}} PreviewOutcome  no trailing newlines; '' = print nothing */

/**
 * Starts one preview run. Builds the verdict component, then a 1 s run tick.
 * Finishes exactly once: the run tick and the verdict component (so both helpers)
 * are destroyed first, then onFinish is called. onFinish is never called
 * synchronously inside startPreview, and never after stop().
 *
 * @param {object} deps
 * @param {'text'|'json'} deps.format
 * @param {(onChange: () => void) => import('../app/verdicts.js').StoreReaderPort} deps.createStoreReader
 * @param {(onUpdate: () => void) => import('../app/verdicts.js').FeedPort} deps.createFeed
 * @param {(engine: import('../app/aiQueue.js').AiEngine) => import('../app/aiQueue.js').AiClientPort} deps.createAiClient
 * @param {(onTick: () => void) => {destroy(): void}} deps.createTicker 1 s; used for the run tick and as the AI ticker
 * @param {(line: string) => void} deps.progress one stderr line, counts only
 * @param {(outcome: PreviewOutcome) => void} deps.onFinish
 * @param {() => number} deps.now
 * @returns {{stop(): void}} stop destroys everything; onFinish is then never called. Idempotent.
 * @throws {TypeError} before building anything, when one of the functions is missing
 * @throws whatever the Verdicts constructor throws (it has already cleaned up)
 */
export function startPreview(deps) {
    const missing = DEP_NAMES.filter(name => typeof deps[name] !== 'function');
    if (missing.length > 0)
        throw new TypeError(`preview: deps.${missing.join(', deps.')} must be functions`);
    const { format, createTicker, progress, onFinish, now } = deps;

    const verdicts = new Verdicts({
        createStoreReader: deps.createStoreReader,
        createFeed: deps.createFeed,
        createAiClient: deps.createAiClient,
        createAiTicker: createTicker,
        writeAnswers: keepAnswersInMemoryOnly,
        now,
    });
    const startedAt = now();
    let firstSnapshotAt = null;
    let lastPending = null;
    let finished = false;
    let runTicker = null;

    function destroyAll() {
        for (const [part, run] of [['runTicker', () => runTicker?.destroy()], ['verdicts', () => verdicts.destroy()]]) {
            try {
                run();
            } catch (e) {
                console.error(`payattention: destroy-failed ${part}`, e);
            }
        }
        runTicker = null;
    }

    function finish(outcome) {
        finished = true;
        destroyAll();
        onFinish(outcome);
    }

    function printed(t) {
        const input = {
            now: t,
            settings: verdicts.inputs.settings,
            judged: verdicts.judgedList(t).judged,
            sources: verdicts.feedFacts.snapshot.sources,
            aiStatus: verdicts.ai.status,
            aiProgress: verdicts.aiProgress(t),
        };
        return { code: EXIT.printed, stdout: formatPreview(input, format), stderr: '' };
    }

    function tick() {
        if (finished)
            return;
        const t = now();
        let outcome;
        try {
            outcome = step(t);
        } catch (e) {
            outcome = { code: EXIT.error, stdout: '', stderr: internalErrorText(e) };
        }
        if (outcome !== null)
            finish(outcome);
    }

    /** @returns {PreviewOutcome|null} null while the run still waits */
    function step(t) {
        if (verdicts.feedFacts.snapshot === null) {
            if (t - startedAt >= SNAPSHOT_WAIT_MS)
                return { code: EXIT.noCalendar, stdout: '', stderr: NO_CALENDAR_TEXT };
            return null;
        }
        firstSnapshotAt ??= t;
        if (aiEngine(verdicts.inputs.settings) === null)
            return printed(t);
        // Fetching the list is what lets the AI ticker ask (the queue pumps the last list).
        const p = verdicts.aiProgress(t);
        if (p.pending > 0 && t - firstSnapshotAt < AI_WAIT_MS) {
            if (p.pending !== lastPending)
                progress(progressText(p.pending));
            lastPending = p.pending;
            return null;
        }
        return printed(t);
    }

    try {
        runTicker = createTicker(tick);
    } catch (e) {
        verdicts.destroy();
        throw e;
    }

    return {
        stop() {
            if (finished)
                return;
            finished = true;
            destroyAll();
        },
    };
}
