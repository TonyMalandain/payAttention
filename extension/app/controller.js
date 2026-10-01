// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The alert front end's orchestrator (ADR-0002, ADR-0011). Plans on every tick
// from the verdict component's judged list, renders, routes the owner's actions,
// and owns alert state, sound, the test alert, calendar health and every part's
// lifetime. Every part that touches GNOME is injected, so this file never
// imports gi:// and runs under Node with fakes.
import { plan, actionFor } from '../core/plan.js';
import { reduce, emptyAlertState } from '../core/alertState.js';
import { testAlert } from '../core/testAlert.js';
import { dataHealth, clocksToPersist } from './health.js';
import { buildView } from './view.js';
import { shouldPlaySound } from './soundCue.js';
import { Verdicts } from './verdicts.js';

const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} StoreWriterPort the store's writer facet
 * @property {() => import('../core/types.js').AlertState} readAlertState
 * @property {(state: import('../core/types.js').AlertState) => void} writeAlertState coalesced
 * @property {(answers: import('../core/types.js').StoredAiAnswers) => void} writeAiAnswers coalesced
 * @property {() => import('./health.js').HealthSeeds} readHealthSeeds
 * @property {(clocks: {dataAt: number, providerAt: number}) => void} writeHealthClocks
 * @property {(key: string, verdict: 'must'|'ignore'|null) => void} setVerdictOverride
 * @property {(key: string, mode: 'online'|'in-person'|null) => void} setModeOverride
 * @property {(placeKey: string, minutes: number) => void} setTravel
 * @property {(now: number) => void} pruneOccurrenceOverrides
 * @property {() => void} destroy flushes pending alert-state and ai-verdicts writes
 */
/** @typedef {{isUserActive(): boolean, destroy(): void}} EnvironmentPort */
/**
 * @typedef {{render(view: import('./view.js').View): void, playAlertSound(): void,
 *   releaseTakeover(): void, destroy(): void}} UiPort
 */
/**
 * @typedef {{type: 'join'|'ack'|'snooze'|'skip', key: string}
 *   | {type: 'setVerdict', key: string, verdict: 'must'|'ignore'|null, scope: 'occ'|'series'}
 *   | {type: 'setMode', key: string, mode: 'online'|'in-person'}
 *   | {type: 'setTravel', placeKey: string, minutes: number}
 *   | {type: 'toggleTravelChoices', key: string}
 *   | {type: 'runTestAlert'}} UiAction
 */

export class Controller {
    /**
     * Builds every part, loads stored state, prunes, renders once, starts ticking.
     * If any part fails to build, already-built parts are destroyed and the error rethrown.
     *
     * @param {object} deps
     * @param {(onChange: () => void) => import('./verdicts.js').StoreReaderPort} deps.createStoreReader
     * @param {() => StoreWriterPort} deps.createStoreWriter
     * @param {(onUpdate: () => void) => import('./verdicts.js').FeedPort} deps.createFeed
     * @param {(onResume: () => void) => EnvironmentPort} deps.createEnvironment
     * @param {(dispatch: (action: UiAction) => void) => UiPort} deps.createUi
     * @param {(onTick: () => void) => {destroy(): void}} deps.createTicker
     * @param {(engine: import('./aiQueue.js').AiEngine) => import('./aiQueue.js').AiClientPort} deps.createAiClient
     *   the AI helper client for one engine (AI mode only)
     * @param {(onTick: () => void) => {destroy(): void}} deps.createAiTicker the AI queue's 1 s ticker (AI mode only)
     * @param {(uri: string, onDone: (ok: boolean) => void) => void} deps.launchUri
     * @param {() => number} deps.now
     * @throws {TypeError} before building anything, when createAiClient or createAiTicker is not a function
     */
    constructor(deps) {
        if (typeof deps.createAiClient !== 'function' || typeof deps.createAiTicker !== 'function')
            throw new TypeError('controller: deps.createAiClient and deps.createAiTicker must be functions');
        this._deps = deps;
        this._destroyed = false;
        this._writer = null;
        this._environment = null;
        this._verdicts = null;
        this._ui = null;
        this._ticker = null;
        this._enabledAt = null;
        this._judged = [];
        this._judgedByKey = new Map();
        this._test = null;
        this._lastPlan = null;
        this._lastTestPlan = null;
        this._lastVisible = null;
        this._lastFailure = null;
        // The card whose travel choices are open, and the alert last rendered. In memory only (data.md).
        this._openTravelChoices = null;
        this._shownAlert = null;
        try {
            this._writer = deps.createStoreWriter();
            this._environment = deps.createEnvironment(() => this._onResume());
            this._verdicts = new Verdicts({
                createStoreReader: deps.createStoreReader,
                createFeed: deps.createFeed,
                createAiClient: deps.createAiClient,
                createAiTicker: deps.createAiTicker,
                writeAnswers: answers => this._writer.writeAiAnswers(answers),
                now: deps.now,
            });
            this._ui = deps.createUi(action => this._dispatch(action));

            const now = deps.now();
            this._enabledAt = now;
            this._seeds = this._writer.readHealthSeeds();
            this._alertState = this._writer.readAlertState();
            this._prune(now);

            this._tick();
            this._ticker = deps.createTicker(() => this._tick());
        } catch (e) {
            this.destroy();
            throw e;
        }
    }

    /** Starts the ~30 s test alert, replacing any test already running. Never stored. */
    runTestAlert() {
        if (this._destroyed)
            return;
        const t = testAlert(this._deps.now());
        this._test = { judged: t.judged, timing: t.timing, alertState: emptyAlertState() };
        this._tick();
    }

    /** Idempotent. Persists the health clocks, then destroys every part; the UI releases the grab. */
    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        // Read before the feed is destroyed. Only once enabledAt and the seeds were loaded.
        let clocks = null;
        if (this._verdicts && this._enabledAt !== null) {
            try {
                const feed = this._verdicts.feedFacts;
                clocks = clocksToPersist({
                    snapshot: feed.snapshot,
                    acceptedAt: feed.acceptedAt,
                    syncedAt: feed.syncedAt,
                    seeds: this._seeds,
                    enabledAt: this._enabledAt,
                });
            } catch (e) {
                console.error('payattention: destroy-failed clocks', e);
            }
        }

        // The reverse of construction.
        const steps = [
            ['ticker', () => this._ticker?.destroy()],
            ['ui', () => this._ui?.destroy()],
            // Before the writer, so no answer is written after its final flush.
            ['verdicts', () => this._verdicts?.destroy()],
            ['environment', () => this._environment?.destroy()],
            ['clocks', () => clocks && this._writer?.writeHealthClocks(clocks)],
            ['store', () => this._writer?.destroy()],
        ];
        for (const [part, run] of steps) {
            try {
                run();
            } catch (e) {
                console.error(`payattention: destroy-failed ${part}`, e);
            }
        }

        this._ticker = null;
        this._ui = null;
        this._verdicts = null;
        this._environment = null;
        this._writer = null;
        this._test = null;
        this._lastPlan = null;
        this._lastTestPlan = null;
        this._openTravelChoices = null;
        this._shownAlert = null;
        this._judged = [];
        this._judgedByKey = new Map();
    }

    _prune(now) {
        this._alertState = reduce(this._alertState, { type: 'prune' }, now);
        this._writer.writeAlertState(this._alertState);
        this._writer.pruneOccurrenceOverrides(now);
        this._verdicts.pruneAiAnswers();
        this._lastPruneAt = now;
    }

    _tick() {
        if (this._destroyed)
            return;
        const now = this._deps.now();
        try {
            this._render(now);
            this._lastFailure = null;
        } catch (e) {
            // Fail open (ADR-0004): never leave a takeover up that nothing drives.
            const text = String(e);
            if (text !== this._lastFailure) {
                console.error('payattention: tick-failed', e);
                this._lastFailure = text;
            }
            try {
                this._ui.releaseTakeover();
            } catch (releaseError) {
                console.error('payattention: tick-failed release', releaseError);
            }
        }
    }

    _render(now) {
        const list = this._verdicts.judgedList(now);
        this._judged = list.judged;
        this._judgedByKey = list.byKey;
        const { settings, timing } = this._verdicts.inputs;
        const feed = this._verdicts.feedFacts;

        const health = dataHealth({
            snapshot: feed.snapshot, acceptedAt: feed.acceptedAt, syncedAt: feed.syncedAt,
            seeds: this._seeds, enabledAt: this._enabledAt, now,
        });
        // plan() only passes dataHealthy through: alerts keep running from the cached snapshot (D-013).
        // Only choices opened on a heads-up hold it: one opened on the nudge never revives a spent heads-up.
        const open = this._openTravelChoices;
        const env = {
            userActive: this._environment.isUserActive(),
            dataHealthy: health.state === 'ok',
            heldHeadsUpKey: open?.step === 1 ? open.key : null,
        };

        const realPlan = plan(now, this._judged, this._alertState, timing, env);
        // The hold never delays another meeting, and ends for good once one is visible at its nudge or later.
        // Choices opened on the nudge hold nothing back, so this never closes them.
        const shownCards = realPlan.primary?.visible ? [realPlan.primary, ...realPlan.also] : realPlan.also;
        if (open?.step === 1 && shownCards.some(c => c.key !== open.key && c.step >= 2))
            this._openTravelChoices = null;
        if (realPlan.primary?.recordHeadsUpShown) {
            this._alertState = reduce(this._alertState, actionFor(realPlan.primary, 'headsUpShown'), now);
            this._writer.writeAlertState(this._alertState);
        }

        let testPlan = null;
        if (this._test) {
            const test = this._test;
            testPlan = plan(now, test.judged, test.alertState, test.timing, env);
            if (testPlan.primary === null) {
                this._test = null;
                testPlan = null;
            } else if (testPlan.primary.recordHeadsUpShown) {
                test.alertState = reduce(test.alertState, actionFor(testPlan.primary, 'headsUpShown'), now);
            }
        }

        const view = buildView({
            plan: realPlan,
            testPlan,
            testJudged: this._test?.judged[0] ?? null,
            judged: this._judged,
            judgedByKey: this._judgedByKey,
            health,
            now,
            aiStatus: this._verdicts.ai.status,
            showTestAlert: settings.showTestAlert,
            openTravelChoices: this._openTravelChoices,
        });
        // A hold never outlives its card: ack, skip, snooze, the nudge, another alert taking the card.
        const held = this._openTravelChoices;
        if (held && (view.alert?.key !== held.key || view.alert.step !== held.step))
            this._openTravelChoices = null;
        this._shownAlert = view.alert;

        const next = view.alert ? { key: view.alert.key, step: view.alert.step } : null;
        if (shouldPlaySound(this._lastVisible, next) && settings.soundEnabled)
            this._ui.playAlertSound();
        this._lastVisible = next;

        this._ui.render(view);
        this._lastPlan = realPlan;
        this._lastTestPlan = testPlan;

        if (now - this._lastPruneAt >= PRUNE_EVERY_MS)
            this._prune(now);
    }

    _dispatch(action) {
        if (this._destroyed)
            return;
        if (action.type === 'runTestAlert') {
            this.runTestAlert();
            return;
        }

        const now = this._deps.now();
        const isTest = this._test !== null && action.key === this._test.judged[0].key;
        const shown = (isTest ? this._lastTestPlan : this._lastPlan)?.primary ?? null;
        const card = shown?.key === action.key ? shown : null;

        switch (action.type) {
        case 'ack':
        case 'skip':
        case 'snooze':
            this._applyCardAction(card, action.type, isTest, now);
            break;
        case 'join':
            this._join(card, isTest);
            break;
        case 'setVerdict':
            this._setVerdict(action, isTest);
            break;
        case 'setMode':
            this._writer.setModeOverride(action.key, action.mode);
            this._verdicts.reloadOverridesAndTravel();
            break;
        case 'setTravel':
            this._writer.setTravel(action.placeKey, action.minutes);
            this._verdicts.reloadOverridesAndTravel();
            break;
        case 'toggleTravelChoices':
            this._toggleTravelChoices(action.key);
            break;
        }
        // Answer the click in the same frame.
        this._tick();
    }

    _toggleTravelChoices(key) {
        const shown = this._shownAlert;
        // A click on a card that has since gone, or on one with no choices, holds nothing.
        if (shown?.key !== key || !(shown.travel?.choices.length > 0))
            return;
        const open = this._openTravelChoices;
        this._openTravelChoices = open?.key === key && open.step === shown.step ? null : { key, step: shown.step };
    }

    _applyCardAction(card, type, isTest, now) {
        // No card: the click was on an alert that has since gone.
        if (card === null)
            return;
        if (isTest) {
            this._test.alertState = reduce(this._test.alertState, actionFor(card, type), now);
            return;
        }
        this._alertState = reduce(this._alertState, actionFor(card, type), now);
        this._writer.writeAlertState(this._alertState);
    }

    _join(card, isTest) {
        // The test never has a link.
        if (card === null || isTest)
            return;
        const joinUrl = this._judgedByKey.get(card.key)?.joinUrl ?? null;
        if (joinUrl === null)
            return;
        const captured = card;
        this._deps.launchUri(joinUrl, ok => {
            // A failed launch leaves the alert up: a false "you are fine" is the worst failure (D-004).
            if (this._destroyed || !ok)
                return;
            this._alertState = reduce(this._alertState, actionFor(captured, 'ack'), this._deps.now());
            this._writer.writeAlertState(this._alertState);
            this._tick();
        });
    }

    _setVerdict(action, isTest) {
        if (isTest) {
            this._test = null;
            return;
        }
        const j = this._judgedByKey.get(action.key);
        if (!j)
            return;
        if (action.scope === 'series') {
            this._writer.setVerdictOverride(j.seriesKey, action.verdict);
            // A whole-series verdict covers this occurrence too (PRD §3); judge reads the
            // occurrence override first, so one left in place would win.
            if (action.verdict !== null && this._verdicts.inputs.overrides.verdict[action.key] !== undefined)
                this._writer.setVerdictOverride(action.key, null);
        } else {
            this._writer.setVerdictOverride(action.key, action.verdict);
        }
        this._verdicts.reloadOverridesAndTravel();
    }

    _onResume() {
        this._verdicts.refresh('resume');
        this._tick();
    }
}
