// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The controller in AI mode, with fake AI clients (testing-and-build.md Layer 1).
// The absolute rule: no alert ever waits on the AI.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Time formatting depends on the zone; fix it before the modules are loaded.
process.env.TZ = 'UTC';
const { Controller } = await import('../../extension/app/controller.js');
const { AI_UNAVAILABLE_TEXT } = await import('../../extension/app/view.js');
const { judge } = await import('../../extension/core/judge.js');
const { DEFAULT_SETTINGS } = await import('../../extension/core/defaults.js');
const { occurrenceKey } = await import('../../extension/core/keys.js');
const { parseAiAnswers } = await import('../../extension/core/aiAnswers.js');
const { T0, MIN, HOUR, OWNER, NO_TRAVEL, att, snapshot } = await import('./support/builders.js');
const {
    EN, WORK, meeting, MEETING, KEY, SNAP, setup, makeAiClient, makeStore, makeFeed,
} = await import('./support/controllerHarness.js');

const S = 1000;
const DAY = 24 * HOUR;
const AI = { verdictSource: 'ai', aiEndpoint: 'http://127.0.0.1:11434/v1', aiModel: 'test-model' };
const TAG = 'http://127.0.0.1:11434/v1|test-model';
const LADDER = [T0 - 30 * MIN, T0 - 25 * MIN, T0 - 10 * MIN, T0 - 4 * MIN, T0 - 3 * MIN, T0 - MIN, T0 - 30 * S, T0];
const LATER = meeting({ uid: 'later', start: T0 + 2 * HOUR, end: T0 + 2 * HOUR + 30 * MIN });
const failed = (code, extra = {}) => ({ type: 'failed', code, ...extra });
const verdict = (v, reason) => ({ type: 'verdict', verdict: v, reason });

/** The fingerprint judge gives this occurrence for TAG. */
function fpOf(snap, key) {
    const out = judge(snap, { ...DEFAULT_SETTINGS, ...AI, ai: { engineTag: TAG, utcOffsetMinutes: 0 } },
        { verdict: {}, mode: {} }, NO_TRAVEL, {});
    return out.find(j => j.key === key).aiAsk.fp;
}

/** Stored answers holding these items. */
const stored = items => parseAiAnswers(JSON.stringify({ v: 1, items }));

/** [step, presentation] of the alert after an alert tick at each time. */
function steps(h, times = LADDER, before = () => {}) {
    return times.map(t => {
        before(t);
        const alert = h.at(t).alert;
        return [alert?.step ?? null, alert?.presentation ?? null];
    });
}

/** The ladder a rules-mode controller shows for the same snapshot. */
function rulesSteps(snap = SNAP) {
    const h = setup();
    h.deliverAt(T0 - 2 * HOUR, snap);
    return steps(h);
}

const openAsks = h => h.aiClients.flatMap(c => c.asks.filter(a => a.open));
const allAsks = h => h.aiClients.flatMap(c => c.asks);
const rowOf = (view, key) => view.menu.meetings.find(r => r.key === key);

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

describe('controller AI: no alert ever waits on the AI', () => {
    test('1. rules mode starts nothing and shows no AI line', () => {
        const h = setup();
        h.deliverAt(T0 - 2 * HOUR);
        steps(h);
        assert.equal(h.aiClients.length, 0);
        assert.equal(h.aiTickers, 0);
        assert.ok(h.ui.views.every(v => v.menu.aiStatus === null));
    });

    test('2. a helper that never answers: every step at its time, from the rules', () => {
        const h = setup({ settings: AI });
        h.deliverAt(T0 - 2 * HOUR);
        h.aiTick(T0 - 2 * HOUR);
        assert.equal(openAsks(h).length, 1);
        assert.equal(h.client.asks[0].invite.title, 'Client review');
        const seen = steps(h, LADDER, t => h.aiTick(t));
        assert.deepEqual(seen, rulesSteps());
        // The watchdog ends each hung ask 100 s after it was sent; the re-asks hang too.
        assert.ok(h.client.kills >= 1, 'the watchdog fired on the way');
        assert.ok(h.ui.views.every(v => rowOf(v, KEY) === undefined || rowOf(v, KEY).isMust));
    });

    test('3. the alert tick never calls the AI helper', () => {
        const run = settings => {
            const h = setup({ settings });
            h.deliverAt(T0 - 2 * HOUR);
            for (let i = 0; i < 200; i++)
                h.at(T0 - 40 * MIN + i * 12 * S);
            return { h, seen: steps(h) };
        };
        const ai = run(AI);
        assert.equal(ai.h.aiClients.length, 1);
        assert.equal(ai.h.client.asks.length, 0);
        assert.deepEqual(ai.seen, run({}).seen);
    });

    test('4. a broken AI side cannot stop alerts', () => {
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
        h.deliverAt(T0 - 2 * HOUR);
        const seen = steps(h, LADDER, t => h.aiTick(t));
        assert.deepEqual(seen, rulesSteps());
        const texts = errors.map(e => e[0]).filter(t => t.startsWith('payattention: ai-failed'));
        assert.ok(texts.length > 0);
        assert.equal(new Set(texts).size, texts.length, 'each distinct error once');
        assert.doesNotThrow(() => h.controller.destroy());
        assert.ok(h.log.includes('store.destroy'));
    });

    test('5. the helper cannot be created: the rules decide, and the line shows', () => {
        let h;
        assert.doesNotThrow(() => (h = setup({
            settings: AI,
            aiClient: () => {
                throw new Error('no helper');
            },
        })));
        h.deliverAt(T0 - 2 * HOUR);
        h.aiTick(T0 - 2 * HOUR);
        assert.equal(h.at(T0 - 2 * HOUR).menu.aiStatus, AI_UNAVAILABLE_TEXT);
        assert.deepEqual(steps(h, LADDER, t => h.aiTick(t)), rulesSteps());
    });

    describe('6. an answer joins at the current step', () => {
        test('an ignorable meeting the AI calls must: step 2 at once, never step 1', () => {
            const lunch = meeting({ uid: 'lunch', summary: 'Lunch placeholder', organizer: null, attendees: [] });
            const snap = snapshot([lunch], [WORK]);
            const h = setup({ settings: AI });
            h.deliverAt(T0 - 2 * HOUR, snap);
            assert.equal(rowOf(h.ui.last, occurrenceKey(lunch)).isMust, false);
            h.aiTick(T0 - 2 * HOUR);
            assert.equal(openAsks(h).length, 1);
            assert.equal(h.at(T0 - 4 * MIN).alert, null);
            h.client.answer(verdict('must', 'client lunch'));
            const v = h.at(T0 - 4 * MIN + S);
            assert.equal(v.alert.step, 2);
            assert.equal(v.alert.reason, 'AI: client lunch');
            assert.ok(h.ui.views.every(x => x.alert?.step !== 1));
        });

        test('an ignore answer at step 3 removes the alert on the next alert tick', () => {
            const h = setup({ settings: AI });
            h.deliverAt(T0 - 2 * HOUR);
            h.aiTick(T0 - 2 * HOUR);
            assert.equal(h.at(T0 - 3 * MIN).alert.step, 3);
            h.client.answer(verdict('ignore', 'optional sync'));
            assert.equal(h.at(T0 - 3 * MIN + S).alert, null);
        });
    });
});

describe('controller AI: stored answers and re-asking', () => {
    test('7. asked once; the answer survives a lock and unlock', () => {
        const h = setup({ settings: AI });
        h.deliverAt(T0 - 2 * HOUR);
        h.aiTick(T0 - 2 * HOUR);
        h.now = T0 - 2 * HOUR + 5 * S;
        h.client.answer(verdict('ignore', 'optional sync'));
        assert.deepEqual(h.store.aiWrites.at(-1).items[KEY],
            { fp: fpOf(SNAP, KEY), verdict: 'ignore', reason: 'optional sync', at: T0 - 2 * HOUR + 5 * S });
        for (let i = 1; i <= 50; i++) {
            h.at(T0 - 2 * HOUR + 5 * S + i * S);
            h.aiTick(T0 - 2 * HOUR + 5 * S + i * S);
        }
        assert.equal(allAsks(h).length, 1);

        const h2 = setup({ settings: AI, aiAnswers: h.store.aiAnswers });
        const v = h2.deliverAt(T0 - HOUR);
        for (let i = 1; i <= 5; i++) {
            h2.at(T0 - HOUR + i * S);
            h2.aiTick(T0 - HOUR + i * S);
        }
        assert.equal(allAsks(h2).length, 0);
        assert.equal(rowOf(v, KEY).reason, 'AI: optional sync');
    });

    test('8. no re-ask before the re-judge', () => {
        const h = setup({ settings: AI });
        h.deliverAt(T0 - 2 * HOUR);
        h.aiTick(T0 - 2 * HOUR);
        h.client.answer(verdict('ignore', 'optional sync'));
        h.aiTick(T0 - 2 * HOUR + S);
        h.aiTick(T0 - 2 * HOUR + 2 * S);
        assert.equal(allAsks(h).length, 1);
    });

    const STALE = () => stored({ [KEY]: { fp: '00000000000000', verdict: 'ignore', reason: 'optional sync', at: EN - HOUR } });

    test('9. the old answer is kept while the meeting is asked again', () => {
        const h = setup({ settings: AI, aiAnswers: STALE() });
        h.deliverAt(T0 - 25 * MIN);
        h.aiTick(T0 - 25 * MIN);
        const v = h.at(T0 - 25 * MIN);
        assert.equal(v.alert, null);
        assert.equal(rowOf(v, KEY).reason, 'AI: optional sync');
        assert.equal(v.menu.aiStatus, null);
        assert.equal(openAsks(h).length, 1);
        assert.equal(openAsks(h)[0].invite.title, 'Client review');
        assert.ok(steps(h).every(([step]) => step === null));
    });

    test('10. a failure hands the meeting to the rules; its retry comes after 1 min', () => {
        const h = setup({ settings: AI, aiAnswers: STALE() });
        h.deliverAt(T0 - 25 * MIN);
        h.aiTick(T0 - 25 * MIN);
        h.at(T0 - 10 * MIN);
        assert.equal(h.ui.last.alert, null);
        const F = T0 - 10 * MIN;
        h.now = F;
        h.client.answer(failed('network'));
        let v = h.at(F);
        assert.equal(v.alert.step, 2);
        assert.equal(rowOf(v, KEY).isMust, true);
        assert.equal(v.menu.aiStatus, AI_UNAVAILABLE_TEXT);
        h.at(F + 59 * S);
        h.aiTick(F + 59 * S);
        assert.equal(allAsks(h).length, 1);
        h.at(F + 60 * S);
        h.aiTick(F + 60 * S);
        assert.equal(allAsks(h).length, 2);
        h.client.answer(verdict('must', 'client call'));
        v = h.at(F + 61 * S);
        assert.equal(v.menu.aiStatus, null);
        assert.equal(v.alert.reason, 'AI: client call');
    });

    test('11. per-key withholding: one failed meeting goes to the rules, the other keeps the AI', () => {
        const B = meeting({ uid: 'client-2', start: T0 + HOUR, end: T0 + HOUR + 30 * MIN });
        const BKEY = occurrenceKey(B);
        const entry = { fp: '00000000000000', verdict: 'ignore', reason: 'optional sync', at: EN - HOUR };
        const h = setup({ settings: AI, aiAnswers: stored({ [KEY]: entry, [BKEY]: entry }) });
        h.deliverAt(T0 - 2 * HOUR, snapshot([MEETING, B], [WORK]));
        h.aiTick(T0 - 2 * HOUR);
        assert.equal(openAsks(h)[0].invite.start, '2026-09-28 Mon 14:00', 'MEETING, the soonest, is asked first');
        h.client.answer(failed('bad-reply'));
        h.at(T0 - 2 * HOUR + S);
        h.aiTick(T0 - 2 * HOUR + S);
        assert.equal(allAsks(h).length, 2);
        h.client.answer(verdict('must', 'board prep'));
        const v = h.at(T0 - 2 * HOUR + 2 * S);
        assert.equal(rowOf(v, KEY).isMust, true);
        assert.equal(rowOf(v, KEY).reason.startsWith('Why: '), true);
        assert.equal(rowOf(v, BKEY).reason, 'AI: board prep');
        assert.equal(v.menu.aiStatus, AI_UNAVAILABLE_TEXT);
    });

    test('12. overrides and silent-by-fact meetings are never sent', () => {
        const cancelled = meeting({ uid: 'cancelled', status: 'cancelled' });
        const declined = meeting({ uid: 'declined', attendees: [att(OWNER, 'declined'), att('alice@external.test')] });
        const allDay = meeting({ uid: 'allday', allDay: true, start: Date.UTC(2026, 8, 28), end: Date.UTC(2026, 8, 29), conferenceUris: [] });
        const asked = meeting({ uid: 'asked', start: T0 + HOUR, end: T0 + HOUR + 30 * MIN });
        const h = setup({ settings: AI });
        h.deliverAt(T0 - 2 * HOUR, snapshot([MEETING, cancelled, declined, allDay, asked], [WORK]));
        h.dispatch({ type: 'setVerdict', key: KEY, verdict: 'must', scope: 'occ' });
        for (let i = 0; i < 20; i++) {
            h.at(T0 - 2 * HOUR + i * S);
            h.aiTick(T0 - 2 * HOUR + i * S);
            if (openAsks(h).length > 0)
                h.client.answer(verdict('ignore', 'x'));
        }
        const titles = allAsks(h).map(a => a.invite.title);
        assert.deepEqual(titles, ['Client review']);
        assert.equal(allAsks(h).length, 1, 'only the plain meeting');
        for (const a of allAsks(h)) {
            const json = JSON.stringify(a.invite);
            assert.ok(!json.includes(KEY) && !json.includes('client-1') && !json.includes('"must"'), json);
        }
    });

    test('13. the budget: 120 asks an hour, then the line; the 121st an hour later', () => {
        const many = Array.from({ length: 121 }, (_, i) =>
            meeting({ uid: 'm' + i, start: T0 + HOUR + i * MIN, end: T0 + HOUR + i * MIN + 30 * MIN }));
        const h = setup({ settings: AI });
        h.deliverAt(EN, snapshot(many, [WORK]));
        const first = EN;
        for (let i = 0; i < 125; i++) {
            h.aiTick(EN);
            if (openAsks(h).length > 0)
                h.client.answer(verdict('ignore', 'x'));
            h.at(EN);
        }
        assert.equal(allAsks(h).length, 120);
        assert.equal(h.ui.last.menu.aiStatus, AI_UNAVAILABLE_TEXT);
        h.at(first + HOUR - S);
        h.aiTick(first + HOUR - S);
        assert.equal(allAsks(h).length, 120);
        h.at(first + HOUR);
        h.aiTick(first + HOUR);
        assert.equal(allAsks(h).length, 121);
    });
});

describe('controller AI: the truthful line and recovery (D-031)', () => {
    test('14. the line shows only while a waiting meeting is decided by the rules because of a failure', () => {
        const SNAP2 = snapshot([MEETING, LATER], [WORK]);
        const start = T0 - 3 * HOUR;
        const toLatersVerdict = h => {
            h.deliverAt(start, SNAP2);
            assert.equal(h.ui.last.menu.aiStatus, null, 'waiting for a first answer is not a failure');
            h.aiTick(start);
            assert.equal(openAsks(h)[0].invite.title, 'Client review');
            h.client.answer(failed('bad-reply'));
            assert.equal(h.at(start).menu.aiStatus, AI_UNAVAILABLE_TEXT);
            h.aiTick(start + S);
            assert.equal(openAsks(h).length, 1);
            h.client.answer(verdict('ignore', 'later'));
            assert.equal(h.at(start + S).menu.aiStatus, AI_UNAVAILABLE_TEXT, 'MEETING still waits on a failure');
        };

        let h = setup({ settings: AI });
        toLatersVerdict(h);
        h.at(start + MIN);
        h.aiTick(start + MIN);
        assert.equal(openAsks(h).length, 1);
        h.client.answer(verdict('must', 'client call'));
        assert.equal(h.at(start + MIN).menu.aiStatus, null);

        h = setup({ settings: AI });
        toLatersVerdict(h);
        h.client.readyValue = false;
        const shown = [];
        for (let t = start + 30 * S; t <= T0 + 10 * MIN + 30 * S; t += 30 * S) {
            shown.push([t, h.at(t).menu.aiStatus]);
            h.aiTick(t);
        }
        const after = h.at(T0 + 10 * MIN + 31 * S).menu.aiStatus;
        // Each render shows the status of the pump before it; the first pump after T0 + 10 min is at + 30 s.
        assert.ok(shown.every(([, s]) => s === AI_UNAVAILABLE_TEXT));
        assert.equal(after, null);
        assert.equal(allAsks(h).length, 2, 'no outcome in between');
    });

    test('15. an hour of outage: probes at the end of each pause, answers within 90 s of the engine returning', () => {
        const h = setup({ settings: AI });
        const start = T0 - 3 * HOUR;
        const R = T0 - 2 * HOUR;
        h.deliverAt(start);
        let firstFailure = null;
        const lineDuringOutage = [];
        for (let t = start; t < R; t += S) {
            const v = h.at(t);
            if (firstFailure !== null)
                lineDuringOutage.push(v.menu.aiStatus);
            h.aiTick(t);
            if (openAsks(h).length > 0) {
                h.client.answer(failed('network'));
                firstFailure ??= t;
            }
        }
        assert.ok(lineDuringOutage.length > 3500 && lineDuringOutage.every(s => s === AI_UNAVAILABLE_TEXT));
        const outage = allAsks(h).length;
        let answeredAt = null;
        for (let t = R; t <= R + 5 * MIN && answeredAt === null; t += S) {
            h.at(t);
            h.aiTick(t);
            if (openAsks(h).length > 0) {
                h.client.answer(verdict('ignore', 'optional sync'));
                answeredAt = t;
            }
        }
        const asks = allAsks(h);
        assert.ok(answeredAt !== null && answeredAt <= R + 90 * S, `first ask at R + ${(answeredAt - R) / S} s`);
        assert.equal(asks.length, outage + 1);
        assert.equal(h.store.aiWrites.at(-1).items[KEY].reason, 'optional sync');
        const v = h.at(answeredAt + S);
        assert.equal(v.menu.aiStatus, null);
        assert.equal(rowOf(v, KEY).reason, 'AI: optional sync');
        const gaps = asks.slice(1).map((a, i) => (a.at - asks[i].at) / S);
        assert.deepEqual(gaps.slice(0, 3), [60, 60, 90]);
        assert.ok(gaps.slice(3, -1).every(g => g === 90), JSON.stringify(gaps));
        assert.ok(gaps.at(-1) <= 90);
    });
});

describe('controller AI: lifecycle', () => {
    test('16. an engine change ends the pause; old answers still apply while asked again', () => {
        const entry = { fp: fpOf(snapshot([MEETING, LATER], [WORK]), KEY), verdict: 'ignore', reason: 'optional sync', at: EN };
        const h = setup({ settings: AI, aiAnswers: stored({ [KEY]: entry }) });
        h.deliverAt(T0 - 2 * HOUR, snapshot([MEETING, LATER], [WORK]));
        h.aiTick(T0 - 2 * HOUR);
        assert.equal(openAsks(h)[0].invite.start, '2026-09-28 Mon 16:00', 'LATER is asked');
        assert.equal(allAsks(h).length, 1, 'only LATER: MEETING has a current answer');
        h.client.answer(failed('auth'));
        h.at(T0 - 2 * HOUR + S);
        h.aiTick(T0 - 2 * HOUR + 2 * S);
        assert.equal(allAsks(h).length, 1, 'paused');

        const old = h.client;
        h.store.settings.aiModel = 'other';
        h.store.onChange();
        assert.equal(old.destroyed, true);
        assert.equal(h.aiClients.length, 2);
        assert.equal(h.client.engine.engineTag, 'http://127.0.0.1:11434/v1|other');
        const v = h.at(T0 - 2 * HOUR + 3 * S);
        assert.equal(rowOf(v, KEY).reason, 'AI: optional sync', 'the stale answer still applies');
        h.aiTick(T0 - 2 * HOUR + 3 * S);
        assert.equal(h.client.asks.length, 1);
        assert.equal(h.client.asks[0].invite.title, 'Client review', 'the stale MEETING, soonest, at once');
    });

    test('17. switching the mode off stops the AI side and gives exactly the rules', () => {
        const h = setup({ settings: AI });
        h.deliverAt(T0 - 2 * HOUR);
        h.aiTick(T0 - 2 * HOUR);
        h.client.answer(verdict('ignore', 'optional sync'));
        h.at(T0 - 2 * HOUR + S);
        assert.equal(rowOf(h.ui.last, KEY).reason, 'AI: optional sync');

        h.store.settings.verdictSource = 'rules';
        h.store.onChange();
        assert.equal(h.client.destroyed, true);
        assert.equal(h.aiTicker.destroyed, true);
        const v = h.at(T0 - 2 * HOUR + 2 * S);
        assert.equal(v.menu.aiStatus, null);
        assert.ok(rowOf(v, KEY).reason.startsWith('Why: '));

        const r = setup();
        const rv = r.deliverAt(T0 - 2 * HOUR + 2 * S);
        assert.deepEqual(h.controller._judged, r.controller._judged);
        assert.deepEqual(v.menu, rv.menu);
        const asks = allAsks(h).length;
        h.aiTicker.fire();
        assert.equal(allAsks(h).length, asks);
        assert.equal(h.aiTickers, 1);
    });

    test('18. destroy in AI mode: every part in order; a late outcome does nothing', () => {
        const h = setup({ settings: AI });
        h.deliverAt(T0 - 2 * HOUR);
        h.aiTick(T0 - 2 * HOUR);
        const client = h.client;
        h.controller.destroy();
        assert.deepEqual(h.log, [
            'ticker.destroy', 'ui.destroy', 'aiTicker.destroy', 'aiClient.destroy', 'feed.destroy', 'reader.destroy',
            'environment.destroy', 'store.writeHealthClocks', 'store.destroy',
        ]);
        const views = h.ui.views.length;
        client.asks[0].onDone(verdict('must', 'late'));
        assert.equal(h.store.aiWrites.length, 0);
        assert.equal(h.ui.views.length, views);
    });

    test('19. stored answers are pruned; rules mode with nothing stored writes nothing', () => {
        const entry = { fp: 'a', verdict: 'must', reason: 'r', at: EN - 9 * DAY };
        const OLD = `occ:old|${EN - 8 * DAY}`;
        const NEW = `occ:new|${EN - 6 * DAY}`;
        const h = setup({ aiAnswers: stored({ [OLD]: entry, [NEW]: entry }) });
        assert.equal(h.store.aiWrites.length, 1);
        assert.deepEqual(Object.keys(h.store.aiWrites[0].items), [NEW]);

        const r = setup();
        assert.equal(r.store.aiWrites.length, 0);
        r.at(EN + DAY);
        assert.equal(r.store.aiWrites.length, 0);
    });

    test('20. a controller without the AI factories fails before building anything', () => {
        const log = [];
        const inner = { now: EN, log, settings: {}, seeds: null };
        const deps = {
            createStoreWriter: () => (log.push('store.create'), makeStore(inner).writer),
            createStoreReader: () => (log.push('reader.create'), makeStore(inner).reader),
            createEnvironment: () => (log.push('environment.create'), { isUserActive: () => true, destroy() {} }),
            createFeed: onUpdate => (log.push('feed.create'), makeFeed(onUpdate, inner)),
            createUi: () => (log.push('ui.create'), { render() {}, playAlertSound() {}, releaseTakeover() {}, destroy() {} }),
            createTicker: () => (log.push('ticker.create'), { destroy() {} }),
            createAiClient: engine => makeAiClient(engine, inner),
            menuOffersTestAlert: false,
            launchUri: () => {},
            now: () => EN,
        };
        assert.throws(() => new Controller(deps), TypeError);
        assert.throws(() => new Controller({ ...deps, createAiTicker: () => ({ destroy() {} }), createAiClient: undefined }), TypeError);
        assert.deepEqual(log, []);
    });
});
