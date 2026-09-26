// The one orchestrator (ADR-0002). Judges when its inputs change, plans on
// every tick, renders, routes the owner's actions, and owns every part's
// lifetime. Every part that touches GNOME is injected, so this file never
// imports gi:// and runs under Node with fakes.
import { judge } from '../core/judge.js';
import { plan, actionFor } from '../core/plan.js';
import { reduce, emptyAlertState } from '../core/alertState.js';
import { timingFromSettings } from '../core/timing.js';
import { testAlert } from '../core/testAlert.js';
import { dataHealth, clocksToPersist } from './health.js';
import { buildView } from './view.js';
import { shouldPlaySound } from './soundCue.js';

const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} StorePort
 * @property {() => import('../core/types.js').Settings} readSettings
 * @property {() => import('../core/types.js').Overrides} readOverrides
 * @property {() => import('../core/types.js').TravelTimes} readTravel
 * @property {() => import('../core/types.js').AlertState} readAlertState
 * @property {(state: import('../core/types.js').AlertState) => void} writeAlertState coalesced
 * @property {() => import('./health.js').HealthSeeds} readHealthSeeds
 * @property {(clocks: {dataAt: number, providerAt: number}) => void} writeHealthClocks
 * @property {(key: string, verdict: 'must'|'ignore'|null) => void} setVerdictOverride
 * @property {(key: string, mode: 'online'|'in-person'|null) => void} setModeOverride
 * @property {(placeKey: string, minutes: number) => void} setTravel
 * @property {(now: number) => void} pruneOccurrenceOverrides
 * @property {() => void} destroy flushes a pending alert-state write
 */
/**
 * @typedef {object} FeedPort
 * @property {import('../core/types.js').Snapshot|null} snapshot last accepted
 * @property {number|null} acceptedAt
 * @property {ReadonlyMap<string, number>} syncedAt
 * @property {(reason: 'resume'|'manual') => void} refresh
 * @property {() => void} destroy
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
 *   | {type: 'runTestAlert'}} UiAction
 */

export class Controller {
    /**
     * Builds every part, loads stored state, prunes, renders once, starts ticking.
     * If any part fails to build, already-built parts are destroyed and the error rethrown.
     *
     * @param {object} deps
     * @param {(onChange: () => void) => StorePort} deps.createStore
     * @param {(onUpdate: () => void) => FeedPort} deps.createFeed
     * @param {(onResume: () => void) => EnvironmentPort} deps.createEnvironment
     * @param {(dispatch: (action: UiAction) => void) => UiPort} deps.createUi
     * @param {(onTick: () => void) => {destroy(): void}} deps.createTicker
     * @param {(uri: string, onDone: (ok: boolean) => void) => void} deps.launchUri
     * @param {() => number} deps.now
     */
    constructor(deps) {
        this._deps = deps;
        this._destroyed = false;
        this._store = null;
        this._environment = null;
        this._feed = null;
        this._ui = null;
        this._ticker = null;
        this._enabledAt = null;
        this._judged = [];
        this._judgedByKey = new Map();
        this._judgeDirty = true;
        this._test = null;
        this._lastPlan = null;
        this._lastTestPlan = null;
        this._lastVisible = null;
        this._lastFailure = null;
        try {
            this._store = deps.createStore(() => this._onStoreChange());
            this._environment = deps.createEnvironment(() => this._onResume());
            this._feed = deps.createFeed(() => this._onFeedUpdate());
            this._ui = deps.createUi(action => this._dispatch(action));

            const now = deps.now();
            this._enabledAt = now;
            this._seeds = this._store.readHealthSeeds();
            this._alertState = this._store.readAlertState();
            this._loadInputs();
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
        if (this._feed && this._enabledAt !== null) {
            try {
                clocks = clocksToPersist({
                    snapshot: this._feed.snapshot,
                    acceptedAt: this._feed.acceptedAt,
                    syncedAt: this._feed.syncedAt,
                    seeds: this._seeds,
                    enabledAt: this._enabledAt,
                });
            } catch (e) {
                console.error('payattention: destroy-failed clocks', e);
            }
        }

        const steps = [
            ['ticker', () => this._ticker?.destroy()],
            ['ui', () => this._ui?.destroy()],
            ['feed', () => this._feed?.destroy()],
            ['environment', () => this._environment?.destroy()],
            ['clocks', () => clocks && this._store?.writeHealthClocks(clocks)],
            ['store', () => this._store?.destroy()],
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
        this._feed = null;
        this._environment = null;
        this._store = null;
        this._test = null;
        this._lastPlan = null;
        this._lastTestPlan = null;
        this._judged = [];
        this._judgedByKey = new Map();
    }

    _loadInputs() {
        this._settings = this._store.readSettings();
        this._timing = timingFromSettings(this._settings);
        this._overrides = this._store.readOverrides();
        this._travel = this._store.readTravel();
        this._judgeDirty = true;
    }

    _prune(now) {
        this._alertState = reduce(this._alertState, { type: 'prune' }, now);
        this._store.writeAlertState(this._alertState);
        this._store.pruneOccurrenceOverrides(now);
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
        const feed = this._feed;
        if (this._judgeDirty) {
            this._judged = feed.snapshot ? judge(feed.snapshot, this._settings, this._overrides, this._travel) : [];
            this._judgedByKey = new Map(this._judged.map(j => [j.key, j]));
            this._judgeDirty = false;
        }

        const health = dataHealth({
            snapshot: feed.snapshot, acceptedAt: feed.acceptedAt, syncedAt: feed.syncedAt,
            seeds: this._seeds, enabledAt: this._enabledAt, now,
        });
        // plan() only passes dataHealthy through: alerts keep running from the cached snapshot (D-013).
        const env = { userActive: this._environment.isUserActive(), dataHealthy: health.state === 'ok' };

        const realPlan = plan(now, this._judged, this._alertState, this._timing, env);
        if (realPlan.primary?.recordHeadsUpShown) {
            this._alertState = reduce(this._alertState, actionFor(realPlan.primary, 'headsUpShown'), now);
            this._store.writeAlertState(this._alertState);
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
        });

        const next = view.alert ? { key: view.alert.key, step: view.alert.step } : null;
        if (shouldPlaySound(this._lastVisible, next) && this._settings.soundEnabled)
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
            this._store.setModeOverride(action.key, action.mode);
            this._overrides = this._store.readOverrides();
            this._judgeDirty = true;
            break;
        case 'setTravel':
            this._store.setTravel(action.placeKey, action.minutes);
            this._travel = this._store.readTravel();
            this._judgeDirty = true;
            break;
        }
        // Answer the click in the same frame.
        this._tick();
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
        this._store.writeAlertState(this._alertState);
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
            this._store.writeAlertState(this._alertState);
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
        this._store.setVerdictOverride(action.scope === 'series' ? j.seriesKey : action.key, action.verdict);
        this._overrides = this._store.readOverrides();
        this._judgeDirty = true;
    }

    _onStoreChange() {
        if (!this._destroyed)
            this._loadInputs();
    }

    _onFeedUpdate() {
        this._judgeDirty = true;
    }

    _onResume() {
        this._feed.refresh('resume');
        this._tick();
    }
}
