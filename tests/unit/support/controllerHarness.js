// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The controller's fake parts and setup. Test support, not a test file. Import it
// after fixing process.env.TZ, since time formatting depends on the zone.
import { Controller } from '../../../extension/shell/controller.js';
import { recordSync } from '../../../extension/shell/health.js';
import { DEFAULT_SETTINGS } from '../../../extension/core/defaults.js';
import { emptyAlertState } from '../../../extension/core/alertState.js';
import { emptyAiAnswers } from '../../../extension/core/aiAnswers.js';
import { occurrenceKey } from '../../../extension/core/keys.js';
import { T0, HOUR, OWNER, SOURCE, att, event, snapshot } from './builders.js';

export const EN = T0 - 2 * HOUR;       // when the controller is built
export const JOIN = 'https://meet.google.com/abc-defg-hij';
export const WORK = { ...SOURCE, remote: true, connection: 'connected' };

/** A must-attend online meeting: important word, the owner organises, 2 other guests, a Meet link. */
export function meeting(over = {}) {
    return event({
        uid: 'client-1', summary: 'Client review', location: 'HQ', conferenceUris: [JOIN],
        organizer: { email: OWNER, name: 'me' },
        attendees: [att(OWNER), att('alice@external.test'), att('bob@external.test')],
        ...over,
    });
}
export const MEETING = meeting();
export const KEY = occurrenceKey(MEETING);
export const SNAP = snapshot([MEETING], [WORK]);

export function makeStore(onChange, h) {
    const store = {
        onChange,
        settings: { ...DEFAULT_SETTINGS, ...h.settings },
        overrides: { verdict: {}, mode: {} },
        travel: {},
        seeds: h.seeds ?? { dataAt: null, providerAt: null },
        alertWrites: [],
        aiAnswers: h.aiAnswers ?? emptyAiAnswers(),
        aiWrites: [],
        clockWrites: [],
        verdictCalls: [],
        modeCalls: [],
        travelCalls: [],
        prunes: [],
        readSettings: () => ({ ...store.settings }),
        readOverrides: () => ({ verdict: { ...store.overrides.verdict }, mode: { ...store.overrides.mode } }),
        readTravel: () => ({ ...store.travel }),
        readAlertState: () => emptyAlertState(),
        writeAlertState: state => store.alertWrites.push(state),
        readAiAnswers: () => store.aiAnswers,
        writeAiAnswers: a => {
            store.aiWrites.push(a);
            store.aiAnswers = a;
        },
        readHealthSeeds: () => store.seeds,
        writeHealthClocks: clocks => {
            h.log.push('store.writeHealthClocks');
            store.clockWrites.push(clocks);
        },
        setVerdictOverride: (key, verdict) => {
            store.verdictCalls.push([key, verdict]);
            if (verdict === null)
                delete store.overrides.verdict[key];
            else
                store.overrides.verdict[key] = verdict;
        },
        setModeOverride: (key, mode) => {
            store.modeCalls.push([key, mode]);
            if (mode === null)
                delete store.overrides.mode[key];
            else
                store.overrides.mode[key] = mode;
        },
        setTravel: (placeKey, minutes) => {
            store.travelCalls.push([placeKey, minutes]);
            store.travel[placeKey] = minutes;
        },
        pruneOccurrenceOverrides: now => store.prunes.push(now),
        destroy: () => h.log.push('store.destroy'),
    };
    return store;
}

export function makeFeed(onUpdate, h) {
    const feed = {
        snapshot: null,
        acceptedAt: null,
        syncedAt: new Map(),
        refreshes: [],
        refresh: reason => feed.refreshes.push(reason),
        destroy: () => h.log.push('feed.destroy'),
        /** A snapshot accepted now, the way CalendarFeed records it. */
        deliver: snap => {
            feed.snapshot = snap;
            feed.acceptedAt = h.now;
            feed.syncedAt = recordSync(feed.syncedAt, snap, h.now);
            onUpdate();
        },
    };
    return feed;
}

export function makeUi(dispatch, h) {
    const ui = {
        dispatch,
        views: [],
        sounds: 0,
        releases: 0,
        throwOnRender: false,
        get last() {
            return ui.views.at(-1);
        },
        render: view => {
            if (ui.throwOnRender)
                throw new Error('render broke');
            ui.views.push(view);
        },
        playAlertSound: () => ui.sounds++,
        releaseTakeover: () => ui.releases++,
        destroy: () => h.log.push('ui.destroy'),
    };
    return ui;
}

/**
 * A fake AI client (the queue's AiClientPort): records asks, and answers them
 * only when the test says so. `h.now` is the clock; `h.log`, when present,
 * records destroy().
 */
export function makeAiClient(engine, h) {
    const c = {
        engine,
        readyValue: true,
        destroyed: false,
        kills: 0,
        asks: [],
        get ready() {
            return c.readyValue && !c.destroyed && !c.asks.some(a => a.open);
        },
        ask(invite, onDone) {
            c.asks.push({ invite, onDone, open: true, at: h.now });
        },
        kill() {
            c.kills++;
            for (const a of c.asks)
                a.open = false;
        },
        destroy() {
            c.destroyed = true;
            h.log?.push('aiClient.destroy');
        },
        /** Answer the oldest open ask. */
        answer(outcome) {
            const a = c.asks.find(x => x.open);
            a.open = false;
            a.onDone(outcome);
        },
    };
    return c;
}

/**
 * A controller with fake parts. `h` holds the parts, the clock and helpers.
 * `aiClient(engine, h)` makes each AI client (default: makeAiClient).
 */
export function setup({ settings = {}, seeds = null, aiAnswers = null, aiClient = makeAiClient } = {}) {
    const h = { now: EN, log: [], launches: [], settings, seeds, aiAnswers, tickers: 0, aiClients: [], aiTickers: 0, aiTicker: null };
    const deps = {
        createStore: onChange => (h.store = makeStore(onChange, h)),
        createEnvironment: onResume => (h.env = {
            active: true,
            onResume,
            isUserActive: () => h.env.active,
            destroy: () => h.log.push('environment.destroy'),
        }),
        createFeed: onUpdate => (h.feed = makeFeed(onUpdate, h)),
        createUi: dispatch => (h.ui = makeUi(dispatch, h)),
        createTicker: onTick => {
            h.tickers++;
            return (h.ticker = {
                fire: onTick,
                throwOnDestroy: false,
                destroy: () => {
                    h.log.push('ticker.destroy');
                    if (h.ticker.throwOnDestroy)
                        throw new Error('ticker broke');
                },
            });
        },
        createAiClient: engine => {
            const c = aiClient(engine, h);
            h.aiClients.push(c);
            return c;
        },
        createAiTicker: onTick => {
            h.aiTickers++;
            const ticker = {
                fire: onTick,
                destroyed: false,
                destroy: () => {
                    ticker.destroyed = true;
                    h.log.push('aiTicker.destroy');
                },
            };
            h.aiTicker = ticker;
            return ticker;
        },
        launchUri: (uri, onDone) => h.launches.push({ uri, onDone }),
        now: () => h.now,
    };
    h.controller = new Controller(deps);
    Object.defineProperty(h, 'client', { get: () => h.aiClients.at(-1) });
    /** Move the clock to t and fire the AI ticker, when one exists. */
    h.aiTick = t => {
        h.now = t;
        h.aiTicker?.fire();
    };
    /** Move the clock to t and tick; the view rendered. */
    h.at = t => {
        h.now = t;
        h.ticker.fire();
        return h.ui.last;
    };
    /** Move the clock to t, deliver a snapshot and tick. */
    h.deliverAt = (t, snap = SNAP) => {
        h.now = t;
        h.feed.deliver(snap);
        h.ticker.fire();
        return h.ui.last;
    };
    h.dispatch = action => {
        h.ui.dispatch(action);
        return h.ui.last;
    };
    return h;
}

/** setup() with createUi throwing, recording into h.log. */
export function setupInto(h) {
    const inner = { now: EN, log: h.log, settings: {}, seeds: null };
    return new Controller({
        createStore: onChange => makeStore(onChange, inner),
        createEnvironment: onResume => ({ onResume, isUserActive: () => true, destroy: () => h.log.push('environment.destroy') }),
        createFeed: onUpdate => makeFeed(onUpdate, inner),
        createUi: () => {
            throw new Error('no panel');
        },
        createTicker: () => ({ destroy: () => h.log.push('ticker.destroy') }),
        createAiClient: () => {
            throw new Error('unused');
        },
        createAiTicker: () => ({ destroy() {} }),
        launchUri: () => {},
        now: () => EN,
    });
}
