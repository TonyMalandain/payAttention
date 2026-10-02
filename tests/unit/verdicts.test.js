// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The verdict component (interfaces.md §7.2) with fake parts: everything between
// the inputs and the judged list, and nothing else.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Time formatting depends on the zone; fix it before the modules are loaded.
process.env.TZ = 'UTC';
const { Verdicts } = await import('../../extension/app/verdicts.js');
const { judge } = await import('../../extension/core/judge.js');
const { DEFAULT_SETTINGS } = await import('../../extension/core/defaults.js');
const { parseAiAnswers } = await import('../../extension/core/aiAnswers.js');
const { T0, MIN, HOUR, NO_TRAVEL, snapshot } = await import('./support/builders.js');
const {
    EN, KEY, SNAP, WORK, MEETING, meeting, makeStore, makeFeed, makeAiClient,
} = await import('./support/controllerHarness.js');

// Test data copied from controller.ai.test.js.
const DAY = 24 * HOUR;
const AI = { verdictSource: 'ai', aiEndpoint: 'http://127.0.0.1:11434/v1', aiModel: 'test-model' };
const failed = (code, extra = {}) => ({ type: 'failed', code, ...extra });
const verdict = (v, reason) => ({ type: 'verdict', verdict: v, reason });
const stored = items => parseAiAnswers(JSON.stringify({ v: 1, items }));
const STALE = () => stored({ [KEY]: { fp: '00000000000000', verdict: 'ignore', reason: 'optional sync', at: EN - HOUR } });

/** The rules-mode judged list for SNAP with nothing stored. */
const rulesOracle = () => judge(SNAP, { ...DEFAULT_SETTINGS, ai: null }, { verdict: {}, mode: {} }, NO_TRAVEL, {});

let errors;
let warns;
let realError;
let realWarn;
beforeEach(() => {
    errors = [];
    warns = [];
    realError = console.error;
    realWarn = console.warn;
    console.error = (...args) => errors.push(args);
    console.warn = (...args) => warns.push(args);
});
afterEach(() => {
    console.error = realError;
    console.warn = realWarn;
});

function depsFor(h, aiClient = makeAiClient) {
    return {
        createStoreReader: onChange => {
            h.log.push('reader.create');
            h.store.onChange = onChange;
            return h.store.reader;
        },
        createFeed: onUpdate => {
            h.log.push('feed.create');
            return (h.feed = makeFeed(onUpdate, h));
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
                destroy: () => h.log.push('aiTicker.destroy'),
            };
            h.aiTicker = ticker;
            return ticker;
        },
        writeAnswers: a => h.writes.push(a),
        now: () => h.now,
    };
}

function setup({ settings = {}, aiAnswers = null, aiClient = makeAiClient } = {}) {
    const h = { now: EN, log: [], settings, seeds: null, aiAnswers, aiClients: [], aiTicker: null, aiTickers: 0, writes: [] };
    h.store = makeStore(h);
    h.verdicts = new Verdicts(depsFor(h, aiClient));
    h.log.length = 0;
    Object.defineProperty(h, 'client', { get: () => h.aiClients.at(-1) });
    /** Move the clock to t and deliver SNAP. */
    h.deliver = t => {
        h.now = t;
        h.feed.deliver(SNAP);
    };
    /** Move the clock to t and fire the AI ticker, when one exists. */
    h.aiTick = t => {
        h.now = t;
        h.aiTicker?.fire();
    };
    return h;
}

const openAsks = h => h.aiClients.flatMap(c => c.asks.filter(a => a.open));
const allAsks = h => h.aiClients.flatMap(c => c.asks);

describe('verdicts: construction', () => {
    test('1. missing any one of the six deps throws TypeError, before any factory is called', () => {
        for (const name of ['createStoreReader', 'createFeed', 'createAiClient', 'createAiTicker', 'writeAnswers', 'now']) {
            const h = { now: EN, log: [], settings: {}, seeds: null, aiAnswers: null, aiClients: [], aiTickers: 0, writes: [] };
            h.store = makeStore(h);
            const deps = { ...depsFor(h), [name]: undefined };
            assert.throws(() => new Verdicts(deps), TypeError, name);
            assert.deepEqual(h.log, [], name);
        }
    });

    test('1. a feed that fails to build destroys the reader and rethrows', () => {
        const h = { now: EN, log: [], settings: {}, seeds: null, aiAnswers: null, aiClients: [], aiTickers: 0, writes: [] };
        h.store = makeStore(h);
        const deps = {
            ...depsFor(h),
            createFeed: () => {
                throw new Error('no feed');
            },
        };
        assert.throws(() => new Verdicts(deps), /no feed/);
        assert.deepEqual(h.log, ['reader.create', 'reader.destroy']);
    });
});

describe('verdicts: inputs', () => {
    test('2. the inputs are the store values, frozen, and follow a store change', () => {
        const h = setup();
        h.store.travel.byPlace.hq = 45;
        h.store.onChange();
        const { inputs } = h.verdicts;
        assert.deepEqual(inputs.settings, { ...DEFAULT_SETTINGS });
        assert.deepEqual(inputs.overrides, { verdict: {}, mode: {} });
        assert.deepEqual(inputs.travel, { byPlace: { hq: 45 }, byMeeting: {} });
        assert.equal(typeof inputs.timing.cutoffMs, 'number');
        for (const o of [inputs, inputs.settings, inputs.overrides, inputs.overrides.verdict, inputs.overrides.mode, inputs.travel,
            inputs.travel.byPlace, inputs.travel.byMeeting])
            assert.ok(Object.isFrozen(o));

        h.store.settings.soundEnabled = false;
        h.store.onChange();
        assert.equal(h.verdicts.inputs.settings.soundEnabled, false);
    });
});

describe('verdicts: judgedList, rules mode', () => {
    test('3. no snapshot gives an empty list', () => {
        const h = setup();
        const list = h.verdicts.judgedList(EN);
        assert.deepEqual(list.judged, []);
        assert.equal(list.byKey.size, 0);
    });

    test('3. after a snapshot: the rules output, keyed; the same object until an input moves', () => {
        const h = setup();
        h.deliver(EN);
        const list = h.verdicts.judgedList(EN);
        assert.deepEqual(list.judged, rulesOracle());
        assert.equal(list.byKey.get(KEY), list.judged.find(j => j.key === KEY));
        assert.ok(Object.isFrozen(list));
        assert.equal(h.verdicts.judgedList(EN + MIN), list);
    });

    test('3. a delivery, an override reload and a store change each give a new list', () => {
        const h = setup();
        h.deliver(EN);
        const first = h.verdicts.judgedList(EN);

        h.deliver(EN + MIN);
        const second = h.verdicts.judgedList(EN + MIN);
        assert.notEqual(second, first);

        h.store.overrides.verdict[KEY] = 'ignore';
        h.verdicts.reloadOverridesAndTravel();
        const third = h.verdicts.judgedList(EN + MIN);
        assert.notEqual(third, second);
        assert.equal(third.byKey.get(KEY).verdict, 'ignore');
        assert.equal(h.verdicts.inputs.overrides.verdict[KEY], 'ignore');

        delete h.store.overrides.verdict[KEY];
        h.store.onChange();
        const fourth = h.verdicts.judgedList(EN + MIN);
        assert.notEqual(fourth, third);
        assert.equal(fourth.byKey.get(KEY).verdict, 'must');
    });
});

describe('verdicts: the store', () => {
    test('4. the reader is only read; every AI write goes through writeAnswers', () => {
        const entry = { fp: 'a', verdict: 'must', reason: 'r', at: EN - 9 * DAY };
        for (const opts of [{}, { settings: AI, aiAnswers: stored({ [`occ:old|${EN - 8 * DAY}`]: entry }) }]) {
            const h = setup(opts);
            h.deliver(EN);
            h.verdicts.judgedList(EN);
            h.aiTick(EN);
            if (opts.settings) {
                h.client.answer(verdict('ignore', 'optional sync'));
                h.verdicts.judgedList(EN);
            }
            h.verdicts.pruneAiAnswers();
            h.verdicts.destroy();
            const s = h.store;
            for (const list of [s.alertWrites, s.aiWrites, s.clockWrites, s.verdictCalls, s.modeCalls, s.travelCalls, s.prunes])
                assert.deepEqual(list, []);
            if (opts.settings)
                assert.equal(h.writes.length, 2);
            else
                assert.deepEqual(h.writes, []);
        }
    });
});

describe('verdicts: AI mode', () => {
    test('5. it asks, and the answer flows through writeAnswers into the list', () => {
        const h = setup({ settings: AI });
        assert.equal(h.aiTickers, 1);
        assert.equal(h.aiClients.length, 1);
        h.deliver(T0 - 2 * HOUR);
        h.verdicts.judgedList(T0 - 2 * HOUR);
        h.aiTick(T0 - 2 * HOUR);
        assert.equal(allAsks(h).length, 1);
        assert.equal(h.client.asks[0].invite.title, 'Client review');
        h.client.answer(verdict('ignore', 'optional sync'));
        assert.equal(h.writes.length, 1);
        assert.equal(h.verdicts.judgedList(T0 - 2 * HOUR).byKey.get(KEY).reason, 'AI: optional sync');
    });

    test('6. the AI tick waits for a pending re-judge', () => {
        const h = setup({ settings: AI });
        h.deliver(T0 - 2 * HOUR);
        h.aiTick(T0 - 2 * HOUR);
        assert.equal(allAsks(h).length, 0);

        // A list exists, but an input moved since: still no ask until it is re-judged.
        h.verdicts.judgedList(T0 - 2 * HOUR);
        h.store.onChange();
        h.aiTick(T0 - 2 * HOUR + 1000);
        assert.equal(allAsks(h).length, 0);
        h.verdicts.judgedList(T0 - 2 * HOUR + 1000);
        h.aiTick(T0 - 2 * HOUR + 2000);
        assert.equal(allAsks(h).length, 1);
    });

    test('7. withheld second pass: the old answer stands while asked again, the rules take over when the engine is down', () => {
        const h = setup({ settings: AI, aiAnswers: STALE() });
        const t = T0 - 25 * MIN;
        h.deliver(t);
        h.verdicts.judgedList(t);
        h.aiTick(t);
        assert.equal(h.verdicts.judgedList(t).byKey.get(KEY).reason, 'AI: optional sync');
        assert.equal(openAsks(h).length, 1);

        h.client.answer(failed('network'));
        assert.equal(h.verdicts.ai.engineDown, true);
        const j = h.verdicts.judgedList(t).byKey.get(KEY);
        assert.equal(j.verdict, 'must');
        assert.equal(j.reason.startsWith('AI:'), false);
        h.aiTick(t + 1000);
        assert.equal(h.verdicts.ai.status, 'unavailable');
    });

    test('8. switching to rules stops the AI side; the list is the rules output', () => {
        const h = setup({ settings: AI });
        const client = h.client;
        h.deliver(EN);
        h.store.settings.verdictSource = 'rules';
        h.store.onChange();
        assert.ok(h.log.includes('aiTicker.destroy'));
        assert.equal(client.destroyed, true);
        assert.deepEqual(h.verdicts.judgedList(EN).judged, rulesOracle());
    });

    test('9. a broken AI side cannot throw out', () => {
        const broken = () => {
            const boom = () => {
                throw new Error('broken client');
            };
            return {
                get ready() {
                    return boom();
                },
                ask: boom,
                kill: boom,
                destroy: boom,
            };
        };
        let h;
        assert.doesNotThrow(() => (h = setup({ settings: AI, aiClient: broken })));
        h.deliver(T0 - 2 * HOUR);
        assert.doesNotThrow(() => h.verdicts.judgedList(T0 - 2 * HOUR));
        assert.doesNotThrow(() => h.aiTick(T0 - 2 * HOUR));
        assert.doesNotThrow(() => h.aiTick(T0 - 2 * HOUR + 1000));
        assert.doesNotThrow(() => h.verdicts.pruneAiAnswers());
        assert.doesNotThrow(() => h.verdicts.destroy());
        const texts = errors.map(e => e[0]).filter(t => t.startsWith('payattention: ai-failed'));
        assert.ok(texts.length > 0);
        assert.equal(new Set(texts).size, texts.length, 'each distinct error once');
    });

    test('10. pruneAiAnswers writes once without the old entry; with nothing stored, nothing', () => {
        const entry = { fp: 'a', verdict: 'must', reason: 'r', at: EN - 9 * DAY };
        const OLD = `occ:old|${EN - 8 * DAY}`;
        const NEW = `occ:new|${EN - 6 * DAY}`;
        const h = setup({ aiAnswers: stored({ [OLD]: entry, [NEW]: entry }) });
        h.verdicts.pruneAiAnswers();
        assert.equal(h.writes.length, 1);
        assert.deepEqual(Object.keys(h.writes[0].items), [NEW]);

        const r = setup();
        r.verdicts.pruneAiAnswers();
        assert.deepEqual(r.writes, []);
    });
});

describe('verdicts: the feed', () => {
    test('11. feedFacts mirrors the feed, frozen; refresh reaches the feed', () => {
        const h = setup();
        h.deliver(EN);
        const facts = h.verdicts.feedFacts;
        assert.equal(facts.snapshot, h.feed.snapshot);
        assert.equal(facts.acceptedAt, h.feed.acceptedAt);
        assert.equal(facts.syncedAt, h.feed.syncedAt);
        assert.ok(Object.isFrozen(facts));
        h.verdicts.refresh('resume');
        assert.deepEqual(h.feed.refreshes, ['resume']);
    });
});

describe('verdicts: aiProgress', () => {
    // Two meetings the AI would be asked about.
    const TWO = snapshot([MEETING, meeting({ uid: 'client-2', start: T0 + HOUR, end: T0 + 90 * MIN })], [WORK]);
    const t = T0 - 2 * HOUR;
    const withTwo = () => {
        const h = setup({ settings: AI });
        h.now = t;
        h.feed.deliver(TWO);
        return h;
    };

    test('13. rules mode after a snapshot: nothing pending, nothing by the rules', () => {
        const h = setup();
        h.deliver(EN);
        assert.deepEqual(h.verdicts.aiProgress(EN), { pending: 0, byRules: 0 });
    });

    test('13. AI mode, no answers: both pending, without a judgedList call first', () => {
        const h = withTwo();
        const p = h.verdicts.aiProgress(t);
        assert.deepEqual(p, { pending: 2, byRules: 0 });
        assert.ok(Object.isFrozen(p));
    });

    test('13. one answer delivered: one pending', () => {
        const h = withTwo();
        h.verdicts.aiProgress(t);
        h.aiTick(t);
        h.client.answer(verdict('ignore', 'optional sync'));
        assert.deepEqual(h.verdicts.aiProgress(t), { pending: 1, byRules: 0 });
    });

    test('13. a network failure (engine down): every waiting meeting is decided by the rules', () => {
        const h = withTwo();
        h.verdicts.aiProgress(t);
        h.aiTick(t);
        h.client.answer(failed('network'));
        assert.deepEqual(h.verdicts.aiProgress(t), { pending: 0, byRules: 2 });
    });

    test('13. after destroy: nothing', () => {
        const h = withTwo();
        h.verdicts.destroy();
        assert.deepEqual(h.verdicts.aiProgress(t), { pending: 0, byRules: 0 });
    });
});

describe('verdicts: destroy', () => {
    test('12. destroys every part in order, once; a late outcome writes nothing; the list is then empty', () => {
        const h = setup({ settings: AI });
        h.deliver(T0 - 2 * HOUR);
        h.verdicts.judgedList(T0 - 2 * HOUR);
        h.aiTick(T0 - 2 * HOUR);
        const client = h.client;
        h.verdicts.destroy();
        assert.deepEqual(h.log, ['aiTicker.destroy', 'aiClient.destroy', 'feed.destroy', 'reader.destroy']);
        h.verdicts.destroy();
        assert.equal(h.log.length, 4);
        client.asks[0].onDone(verdict('must', 'late'));
        assert.deepEqual(h.writes, []);
        const list = h.verdicts.judgedList(T0 - 2 * HOUR);
        assert.deepEqual(list.judged, []);
        assert.equal(list.byKey.size, 0);
    });

    test('12. after destroy, feedFacts is empty and frozen, and refresh reaches no feed', () => {
        const h = setup();
        h.deliver(EN);
        const feed = h.feed;
        h.verdicts.destroy();
        let facts;
        assert.doesNotThrow(() => (facts = h.verdicts.feedFacts));
        assert.equal(facts.snapshot, null);
        assert.equal(facts.acceptedAt, null);
        assert.equal(facts.syncedAt.size, 0);
        assert.ok(Object.isFrozen(facts));
        assert.doesNotThrow(() => h.verdicts.refresh('manual'));
        assert.deepEqual(feed.refreshes, []);
    });
});
