// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The local offset depends on the zone; fix it before the modules are loaded.
process.env.TZ = 'UTC';
const {
    AiQueue, nextAskRetryMs, nextEnginePauseMs, isWaiting, aiStatusOf, aiProgressOf, aiJudgeConfig, withholdAnswers,
    ENGINE_UNREACHABLE_CODES, LOST_STREAK_LIMIT,
} = await import('../../extension/app/aiQueue.js');
const { emptyAiAnswers, parseAiAnswers } = await import('../../extension/core/aiAnswers.js');
const { AI_FAILURE_CODES } = await import('../../extension/core/aiProtocol.js');
const { aiEngine } = await import('../../extension/core/aiEngine.js');
const { DEFAULT_SETTINGS } = await import('../../extension/core/defaults.js');
const { T0, MIN, HOUR, judged } = await import('./support/builders.js');
const { makeAiClient } = await import('./support/controllerHarness.js');

const S = 1000;
const CUTOFF = 10 * MIN;
const ask = (fp = 'fp1') => ({ fp, invite: { n: 1 } });

/** A judged occurrence that is waiting to be asked. */
const waiting = (key, start = T0 + HOUR) => judged({ key, start, aiAsk: ask() });

describe('aiQueue: pure helpers', () => {
    test('1. nextAskRetryMs: 1, 2, 4, 8, 16, 30, 30 min', () => {
        const seen = [];
        let w = null;
        for (let i = 0; i < 7; i++) {
            w = nextAskRetryMs(w);
            seen.push(w / S);
        }
        assert.deepEqual(seen, [60, 120, 240, 480, 960, 1800, 1800]);
    });

    test('2. nextEnginePauseMs: 30, 60, 90, 90 s, and 30 s again from null', () => {
        const seen = [];
        let w = null;
        for (let i = 0; i < 4; i++) {
            w = nextEnginePauseMs(w);
            seen.push(w / S);
        }
        assert.deepEqual(seen, [30, 60, 90, 90]);
        assert.equal(nextEnginePauseMs(null), 30 * S);
    });

    test('3. the unreachable codes: frozen, and all real failure codes', () => {
        assert.deepEqual(ENGINE_UNREACHABLE_CODES, ['network', 'timeout', 'tls', 'server']);
        assert.ok(Object.isFrozen(ENGINE_UNREACHABLE_CODES));
        for (const c of ENGINE_UNREACHABLE_CODES)
            assert.ok(AI_FAILURE_CODES.includes(c), c);
    });

    test('4. aiJudgeConfig: null without an engine; the tag and the UTC offset, never −0', () => {
        assert.equal(aiJudgeConfig(null, T0), null);
        const engine = aiEngine({ ...DEFAULT_SETTINGS, verdictSource: 'ai', aiModel: 'm' });
        const c = aiJudgeConfig(engine, T0);
        assert.deepEqual(c, { engineTag: 'http://127.0.0.1:11434/v1|m', utcOffsetMinutes: 0 });
        assert.ok(Object.is(c.utcOffsetMinutes, 0));
    });

    test('5. isWaiting: an aiAsk, a start, and not more than cutoff ago', () => {
        assert.equal(isWaiting(waiting('a', T0 - CUTOFF), CUTOFF, T0), true);
        assert.equal(isWaiting(waiting('a', T0 + HOUR), CUTOFF, T0), true);
        assert.equal(isWaiting(waiting('a', T0 - CUTOFF - 1), CUTOFF, T0), false);
        assert.equal(isWaiting(judged({ start: null, aiAsk: ask() }), CUTOFF, T0), false);
        assert.equal(isWaiting(judged({ start: T0 + HOUR }), CUTOFF, T0), false);
    });

    describe('6. aiStatusOf', () => {
        const none = new Set();
        const fine = { hasEngine: true, engineDown: false, failedKeys: none };
        const down = { hasEngine: true, engineDown: true, failedKeys: none };

        test('off without an engine, whatever else', () => {
            assert.equal(aiStatusOf({ hasEngine: false, engineDown: true, failedKeys: new Set(['k1']) },
                [waiting('k1')], CUTOFF, T0), 'off');
        });

        test('ok while a meeting waits for its first answer with the engine fine', () => {
            assert.equal(aiStatusOf(fine, [waiting('k1')], CUTOFF, T0), 'ok');
        });

        test('engine down: unavailable only while some meeting waits', () => {
            assert.equal(aiStatusOf(down, [waiting('k1')], CUTOFF, T0), 'unavailable');
            assert.equal(aiStatusOf(down, [], CUTOFF, T0), 'ok');
            assert.equal(aiStatusOf(down, [waiting('k1', T0 - CUTOFF - 1)], CUTOFF, T0), 'ok');
            assert.equal(aiStatusOf(down, [judged({ key: 'k1' })], CUTOFF, T0), 'ok');
        });

        test('a failed key: unavailable only while that meeting waits', () => {
            const failed = { hasEngine: true, engineDown: false, failedKeys: new Set(['k1']) };
            assert.equal(aiStatusOf(failed, [waiting('k2'), waiting('k1')], CUTOFF, T0), 'unavailable');
            assert.equal(aiStatusOf(failed, [waiting('k1', T0 - CUTOFF - 1), waiting('k2')], CUTOFF, T0), 'ok');
            assert.equal(aiStatusOf(failed, [judged({ key: 'k1' }), waiting('k2')], CUTOFF, T0), 'ok');
        });
    });

    describe('6b. aiProgressOf', () => {
        const state = over => Object.freeze({ status: 'ok', answers: {}, failedKeys: new Set(), engineDown: false, ...over });
        const three = [waiting('k1'), waiting('k2'), waiting('k3')];
        const cases = [
            ['no aiAsk anywhere', state(), [judged({ key: 'k1' }), judged({ key: 'k2' })], { pending: 0, byRules: 0 }],
            ['three waiting, none failed, engine up', state(), three, { pending: 3, byRules: 0 }],
            ['one in failedKeys', state({ failedKeys: new Set(['k2']) }), three, { pending: 2, byRules: 1 }],
            ['engine down', state({ engineDown: true }), three, { pending: 0, byRules: 3 }],
            ['a meeting past the cutoff is not counted', state(),
                [waiting('k1', T0 - CUTOFF - 1), waiting('k2')], { pending: 1, byRules: 0 }],
            ['a failed meeting past the cutoff is not counted', state({ failedKeys: new Set(['k1']) }),
                [waiting('k1', T0 - CUTOFF - 1), waiting('k2')], { pending: 1, byRules: 0 }],
        ];

        for (const [name, ai, list, expected] of cases) {
            test(`${name}: ${JSON.stringify(expected)}`, () => {
                assert.deepEqual(aiProgressOf(ai, list, CUTOFF, T0), expected);
            });
        }

        test('the result is frozen', () => {
            assert.ok(Object.isFrozen(aiProgressOf(state(), three, CUTOFF, T0)));
        });

        test('with an engine, byRules > 0 exactly when aiStatusOf gives unavailable', () => {
            for (const [name, ai, list] of cases) {
                const status = aiStatusOf({ hasEngine: true, engineDown: ai.engineDown, failedKeys: ai.failedKeys }, list, CUTOFF, T0);
                assert.equal(aiProgressOf(ai, list, CUTOFF, T0).byRules > 0, status === 'unavailable', name);
            }
        });
    });

    describe('7. withholdAnswers', () => {
        const entry = fp => ({ fp, verdict: 'ignore', reason: 'r', at: T0 });
        const answers = Object.freeze({ k1: entry('old1'), k2: entry('cur2'), k3: entry('old3') });
        const state = over => Object.freeze({ status: 'ok', answers, failedKeys: new Set(), engineDown: false, ...over });
        // k1 and k3 have stale entries (aiAsk), k2 a current one (no aiAsk), k4 no entry (aiAsk).
        const list = [waiting('k1'), judged({ key: 'k2' }), waiting('k3'), waiting('k4')];

        test('nothing failed: null (the first pass stands)', () => {
            assert.equal(withholdAnswers(list, state()), null);
        });

        test('engine down: every entry of a key with an aiAsk is withheld; current answers kept', () => {
            const kept = withholdAnswers(list, state({ engineDown: true }));
            assert.deepEqual(Object.keys(kept), ['k2']);
            assert.ok(Object.isFrozen(kept));
        });

        test('a failed key alone: only that key, and only when it carries aiAsk', () => {
            assert.deepEqual(Object.keys(withholdAnswers(list, state({ failedKeys: new Set(['k1']) }))), ['k2', 'k3']);
            assert.equal(withholdAnswers(list, state({ failedKeys: new Set(['k2']) })), null);
            assert.equal(withholdAnswers(list, state({ failedKeys: new Set(['k4']) })), null);
        });

        test("the 'off' initial state withholds nothing", () => {
            assert.equal(withholdAnswers(list, Object.freeze({ status: 'off', answers, failedKeys: new Set(), engineDown: false })), null);
        });
    });
});

// ---- The queue (Step 7) ----

const DAY = 24 * HOUR;
const E1 = aiEngine({ ...DEFAULT_SETTINGS, verdictSource: 'ai', aiModel: 'm1' });
const E2 = aiEngine({ ...DEFAULT_SETTINGS, verdictSource: 'ai', aiModel: 'm2' });
const VERDICT = Object.freeze({ type: 'verdict', verdict: 'ignore', reason: 'fake' });
const failed = (code, extra = {}) => ({ type: 'failed', code, ...extra });

/** An item waiting to be asked, as judge gives it. The queue treats the invite as opaque. */
function item(i, start, fp = 'fp' + i) {
    return judged({ key: `occ:m${i}|${start}`, start, aiAsk: { fp, invite: { n: i } } });
}

/** What judge gives after a re-judge: no aiAsk where the stored entry has the same fp. */
function judgedFor(items, state) {
    return items.map(j => {
        if (j.aiAsk === undefined || state.answers[j.key]?.fp !== j.aiAsk.fp)
            return j;
        const rest = { ...j };
        delete rest.aiAsk;
        return rest;
    });
}

/** A queue with a fake clock, a fake store write and fake clients. */
function makeQueue({ answers = emptyAiAnswers(), now = T0, cutoff = CUTOFF } = {}) {
    const q = { now, writes: [], states: [], clients: [], engines: [], failCreate: false, items: [] };
    q.queue = new AiQueue({
        answers,
        writeAnswers: a => q.writes.push(a),
        createClient: engine => {
            if (q.failCreate)
                throw new Error('no helper');
            q.engines.push(engine);
            const c = makeAiClient(engine, q);
            q.clients.push(c);
            return c;
        },
        onChange: state => q.states.push(state),
        now: () => q.now,
    });
    Object.defineProperty(q, 'client', { get: () => q.clients.at(-1) });
    Object.defineProperty(q, 'state', { get: () => q.queue.state });
    Object.defineProperty(q, 'asks', { get: () => q.clients.flatMap(c => c.asks) });
    /** One pump at the current time with the re-judged items. */
    q.pump = (list = q.items) => q.queue.pump(judgedFor(list, q.queue.state), cutoff);
    /** Pump once a second from `from` to `to` (inclusive), calling onAsk for each new ask. */
    q.run = (from, to, onAsk = () => {}) => {
        for (let t = from; t <= to; t += S) {
            q.now = t;
            const before = q.asks.length;
            q.pump();
            for (const a of q.asks.slice(before))
                onAsk(a);
        }
    };
    return q;
}

const gapsOf = asks => asks.slice(1).map((a, i) => (a.at - asks[i].at) / S);

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

describe('AiQueue', () => {
    test('1. off: no client, nothing published, pump does nothing', () => {
        const q = makeQueue();
        q.items = [item(1, T0 + HOUR)];
        assert.equal(q.clients.length, 0);
        assert.equal(q.states.length, 0);
        assert.equal(q.state.status, 'off');
        q.pump();
        q.queue.setEngine(null);
        assert.equal(q.states.length, 0);
        assert.equal(q.clients.length, 0);
    });

    test('2. engines: one client per engine; null destroys it and publishes off', () => {
        const q = makeQueue();
        q.queue.setEngine(E1);
        assert.equal(q.clients.length, 1);
        assert.equal(q.states.at(-1).status, 'ok');
        const published = q.states.length;
        q.queue.setEngine(E1);
        assert.equal(q.clients.length, 1);
        assert.equal(q.states.length, published);
        q.queue.setEngine(E2);
        assert.equal(q.clients.length, 2);
        assert.equal(q.clients[0].destroyed, true);
        assert.equal(q.engines[1], E2);
        q.queue.setEngine(null);
        assert.equal(q.clients[1].destroyed, true);
        assert.equal(q.states.at(-1).status, 'off');
    });

    test('3. soonest first, and never past the cutoff or without aiAsk', () => {
        const q = makeQueue();
        q.items = [item(0, T0 - 11 * MIN), item(1, T0 - 5 * MIN), judged({ key: 'occ:plain|' + T0, start: T0 }),
            item(2, T0 + HOUR), item(3, T0 + 2 * HOUR)];
        q.queue.setEngine(E1);
        const order = [];
        for (let i = 0; i < 6; i++) {
            q.pump();
            const open = q.client.asks.find(a => a.open);
            if (!open)
                break;
            order.push(open.invite.n);
            q.client.answer(VERDICT);
        }
        assert.deepEqual(order, [1, 2, 3]);
    });

    test('4. one at a time', () => {
        const q = makeQueue();
        q.items = [item(1, T0 + HOUR), item(2, T0 + 2 * HOUR)];
        q.queue.setEngine(E1);
        for (let i = 0; i < 10; i++)
            q.pump();
        assert.equal(q.client.asks.length, 1);
    });

    test('5. a verdict is stored with its fp and time, published, and applied once', () => {
        const q = makeQueue();
        const it = item(1, T0 + HOUR);
        q.items = [it];
        q.queue.setEngine(E1);
        q.pump();
        q.now = T0 + 5 * S;
        const ask = q.client.asks[0];
        q.client.answer(VERDICT);
        assert.equal(q.writes.length, 1);
        assert.deepEqual(q.writes[0].items[it.key], { fp: it.aiAsk.fp, verdict: 'ignore', reason: 'fake', at: T0 + 5 * S });
        const s = q.states.at(-1);
        assert.equal(s.status, 'ok');
        assert.equal(s.engineDown, false);
        assert.deepEqual(s.answers[it.key], { fp: it.aiAsk.fp, verdict: 'ignore', reason: 'fake', at: T0 + 5 * S });
        const published = q.states.length;
        ask.onDone(VERDICT);
        assert.equal(q.writes.length, 1);
        assert.equal(q.states.length, published);
    });

    test('6. per-occurrence retries: 1, 2, 4, 8, 16, 30, 30 min, reset by a verdict', () => {
        const q = makeQueue({ now: T0 - 20 * HOUR });
        const it = item(1, T0);
        q.items = [it];
        q.queue.setEngine(E1);
        q.pump();
        for (const waitMin of [1, 2, 4, 8, 16, 30, 30]) {
            q.client.answer(failed('bad-reply'));
            assert.equal(q.state.engineDown, false);
            assert.ok(q.state.failedKeys.has(it.key));
            const failedAt = q.now;
            const asked = q.client.asks.length;
            for (const early of [S, waitMin * MIN / 2, waitMin * MIN - 1]) {
                q.now = failedAt + early;
                q.pump();
                assert.equal(q.client.asks.length, asked, `nothing ${early} ms into a ${waitMin} min wait`);
            }
            q.now = failedAt + waitMin * MIN;
            q.pump();
            assert.equal(q.client.asks.length, asked + 1, `asked again after ${waitMin} min`);
        }
        q.client.answer(VERDICT);
        assert.equal(q.state.failedKeys.has(it.key), false);
        // The invite changes: the verdict reset the retry, so the next failure waits 1 min again.
        q.items = [item(1, T0, 'fp-changed')];
        q.pump();
        q.client.answer(failed('bad-reply'));
        const failedAt = q.now;
        q.now = failedAt + MIN - 1;
        const asked = q.client.asks.length;
        q.pump();
        assert.equal(q.client.asks.length, asked);
        q.now = failedAt + MIN;
        q.pump();
        assert.equal(q.client.asks.length, asked + 1);
    });

    describe('7. refused and rate-limited pauses', () => {
        for (const code of ['auth', 'config', 'no-key']) {
            test(`${code}: engine down, nothing asked for 30 min`, () => {
                const q = makeQueue();
                q.items = [item(1, T0 + HOUR), item(2, T0 + 2 * HOUR)];
                q.queue.setEngine(E1);
                q.pump();
                q.client.answer(failed(code));
                assert.equal(q.state.engineDown, true);
                q.run(T0 + S, T0 + 30 * MIN - 1);
                assert.equal(q.client.asks.length, 1);
                q.now = T0 + 30 * MIN;
                q.pump();
                assert.equal(q.client.asks.length, 2);
            });
        }

        for (const [extra, pauseMs] of [[{ retryAfterS: 7 }, 7 * S], [{}, 5 * MIN], [{ retryAfterS: 7200 }, 30 * MIN]]) {
            test(`rate-limited ${JSON.stringify(extra)}: pauses ${pauseMs / S} s`, () => {
                const q = makeQueue();
                q.items = [item(1, T0 + HOUR), item(2, T0 + 2 * HOUR)];
                q.queue.setEngine(E1);
                q.pump();
                q.client.answer(failed('rate-limited', extra));
                assert.equal(q.state.engineDown, true);
                q.now = T0 + pauseMs - 1;
                q.pump();
                assert.equal(q.client.asks.length, 1);
                q.now = T0 + pauseMs;
                q.pump();
                assert.equal(q.client.asks.length, 2);
                // After 7 s the first meeting still waits for its own 1 min retry; after longer pauses it is soonest again.
                assert.equal(q.client.asks[1].invite.n, pauseMs < MIN ? 2 : 1);
            });
        }

        test('an engine change during a pause asks at once, with the failure state cleared', () => {
            const q = makeQueue();
            q.items = [item(1, T0 + HOUR)];
            q.queue.setEngine(E1);
            q.pump();
            q.client.answer(failed('auth'));
            q.now = T0 + MIN;
            q.queue.setEngine(E2);
            assert.equal(q.states.at(-1).engineDown, false);
            assert.equal(q.states.at(-1).failedKeys.size, 0);
            q.pump();
            assert.equal(q.client.engine, E2);
            assert.equal(q.client.asks.length, 1);
        });

        for (const code of ['auth', 'config', 'no-key']) {
            test(`${code} gives the meeting its own 1 min retry: a bad-reply after the pause waits 2 min`, () => {
                const q = makeQueue();
                q.items = [item(1, T0 + HOUR)];
                q.queue.setEngine(E1);
                q.pump();
                q.client.answer(failed(code));
                q.now = T0 + 30 * MIN;
                q.pump();
                assert.equal(q.client.asks.length, 2);
                q.client.answer(failed('bad-reply'));
                // The refusal set waitMs to 1 min, so this failure doubles it to 2 min.
                q.now = T0 + 31 * MIN;
                q.pump();
                assert.equal(q.client.asks.length, 2, 'not re-asked 1 min after the bad-reply');
                q.now = T0 + 32 * MIN - 1;
                q.pump();
                assert.equal(q.client.asks.length, 2);
                q.now = T0 + 32 * MIN;
                q.pump();
                assert.equal(q.client.asks.length, 3, 're-asked 2 min after the bad-reply');
            });
        }
    });

    describe('7b. the rows that clear engine down or leave it alone', () => {
        test('a bad-reply after a network failure clears engine down (the engine did reply)', () => {
            const q = makeQueue();
            q.items = [item(1, T0 + HOUR)];
            q.queue.setEngine(E1);
            q.pump();
            q.client.answer(failed('network'));
            assert.equal(q.state.engineDown, true);
            q.now = T0 + MIN;
            q.pump();
            assert.equal(q.client.asks.length, 2);
            q.client.answer(failed('bad-reply'));
            assert.equal(q.state.engineDown, false);
            assert.equal(q.states.at(-1).engineDown, false);
        });

        test('bad-request leaves engine down as it was: false stays false, true stays true', () => {
            const q = makeQueue();
            q.items = [item(1, T0 + HOUR), item(2, T0 + 2 * HOUR)];
            q.queue.setEngine(E1);
            q.pump();
            q.client.answer(failed('bad-request'));
            assert.equal(q.state.engineDown, false);
            assert.equal(q.state.status, 'unavailable');
            // Engine up, so no pause: the next meeting is asked at once.
            q.pump();
            assert.equal(q.client.asks.length, 2);
            q.client.answer(failed('network'));
            assert.equal(q.state.engineDown, true);
            q.now = T0 + MIN;
            q.pump();
            assert.equal(q.client.asks.length, 3);
            q.client.answer(failed('bad-request'));
            assert.equal(q.state.engineDown, true);
        });
    });

    describe('8. an unreachable engine is probed at the end of each pause (D-031)', () => {
        for (const code of ENGINE_UNREACHABLE_CODES) {
            test(code, () => {
                const q = makeQueue();
                const A = item(1, T0 + HOUR);
                const B = item(2, T0 + 2 * HOUR);
                q.items = [A, B];
                q.queue.setEngine(E1);
                q.now = T0;
                q.pump();
                q.client.answer(failed(code));
                assert.equal(q.state.engineDown, true);
                assert.deepEqual([...q.state.failedKeys], [A.key]);
                q.run(T0 + S, T0 + 30 * MIN, () => q.client.answer(failed(code)));
                const asks = q.client.asks;
                assert.deepEqual(gapsOf(asks).slice(0, 5), [30, 60, 90, 90, 90]);
                assert.deepEqual(asks.slice(0, 3).map(a => a.invite.n), [1, 2, 1]);
                // No probe advanced A's retry: A is asked at every probe once its 1 min passed.
                assert.ok(asks.slice(2).every(a => a.invite.n === 1));
                assert.ok(gapsOf(asks).every(g => g <= 90));
                assert.deepEqual(new Set(q.state.failedKeys), new Set([A.key, B.key]));
                assert.equal(q.state.status, 'unavailable');
            });
        }
    });

    test('8. a verdict resets the unreachable backoff: the next outage pauses 30 s again', () => {
        const q = makeQueue();
        const A = item(1, T0 + HOUR);
        const B = item(2, T0 + 2 * HOUR);
        const C = item(3, T0 + 3 * HOUR);
        q.items = [A, B, C];
        q.queue.setEngine(E1);
        q.run(T0, T0 + 5 * MIN, () => q.client.answer(failed('network')));
        assert.deepEqual(gapsOf(q.client.asks).slice(-1), [90]);
        const before = q.client.asks.length;
        q.run(T0 + 5 * MIN + S, T0 + 8 * MIN, () => q.client.answer(VERDICT));
        assert.equal(q.state.engineDown, false);
        const failedAt = q.client.asks.at(-1).at;
        assert.ok(q.client.asks.length > before);
        // Every waiting meeting is answered; two invites change, and the engine is gone again.
        q.items = [item(1, T0 + HOUR, 'fp-changed'), B, item(3, T0 + 3 * HOUR, 'fp-changed')];
        q.run(failedAt + S, failedAt + 5 * MIN, () => q.client.answer(failed('network')));
        const outage = q.client.asks.filter(a => a.at > failedAt);
        assert.equal((outage[1].at - outage[0].at) / S, 30);
    });

    test('9. probes return their spends (D-031)', () => {
        const q = makeQueue({ now: T0 - 10 * HOUR });
        const t = q.now;
        const done = Array.from({ length: 119 }, (_, i) => item(i, T0 + i * MIN));
        q.items = done;
        q.queue.setEngine(E1);
        for (let i = 0; i < 119; i++) {
            q.pump();
            q.client.answer(VERDICT);
        }
        assert.equal(q.client.asks.length, 119);
        const Z = item(500, T0 - 2 * HOUR);
        q.items = [Z, ...done];
        q.run(t, t + HOUR, () => q.client.answer(failed('network')));
        const probes = q.client.asks.length - 119;
        assert.ok(probes >= 35, `about 40 probes (saw ${probes})`);
        // The engine answers again: Z first, then 119 more keys fill exactly the hour's 120.
        const more = Array.from({ length: 120 }, (_, i) => item(1000 + i, T0 + 3 * HOUR + i * MIN));
        q.items = [Z, ...done, ...more];
        const recoveredAt = q.now;
        const before = q.client.asks.length;
        // One ask a second: the budget is met within minutes; ten show that nothing more goes out.
        q.run(recoveredAt + S, recoveredAt + 10 * MIN, () => q.client.answer(VERDICT));
        const sent = q.client.asks.slice(before);
        assert.equal(sent[0].invite.n, 500);
        // Z's verdict plus 119 further keys: the answered traffic alone, never the probes, used the hour.
        assert.equal(sent.length, 120);
        assert.equal(q.state.status, 'unavailable');
    });

    describe('10. answers resume within 5 minutes of the engine returning (D-031)', () => {
        const items30 = () => Array.from({ length: 30 }, (_, i) => item(i, T0 + 2 * HOUR + i * MIN));

        test('nothing in flight when the engine returns', () => {
            const q = makeQueue({ now: T0 - 3 * HOUR });
            const start = q.now;
            q.items = items30();
            q.queue.setEngine(E1);
            q.run(start, start + HOUR, () => q.client.answer(failed('network')));
            const lastProbe = q.client.asks.at(-1).at;
            const R = lastProbe + 45 * S;
            const before = q.client.asks.length;
            q.run(start + HOUR + S, R + 5 * MIN, () => q.client.answer(VERDICT));
            const after = q.client.asks.slice(before);
            assert.ok(after[0].at > R && after[0].at <= R + 90 * S, `first ask at R + ${(after[0].at - R) / S} s`);
            assert.equal(after[0].invite.n, 0);
            assert.equal(after.length, 30);
            assert.ok(after.at(-1).at <= R + 90 * S + 30 * S);
            assert.equal(q.state.status, 'ok');
            assert.equal(q.state.engineDown, false);
            assert.equal(q.state.failedKeys.size, 0);
        });

        test('a failing ask in flight when the engine returns', () => {
            const q = makeQueue({ now: T0 - 3 * HOUR });
            const start = q.now;
            q.items = items30();
            q.queue.setEngine(E1);
            q.run(start, start + HOUR, () => q.client.answer(failed('network')));
            // The next probe hangs; the engine comes back 1 s after it was sent.
            let R = null;
            let hung = null;
            const due = [];
            let settledAt = null;
            for (let t = start + HOUR + S; t <= start + HOUR + 10 * MIN; t += S) {
                q.now = t;
                for (const d of due.filter(x => x.at === t)) {
                    if (d.ask.open) {
                        q.client.answer(VERDICT);
                        settledAt ??= t;
                    }
                }
                const before = q.client.asks.length;
                q.pump();
                for (const a of q.client.asks.slice(before)) {
                    if (hung === null) {
                        hung = a;
                        R = a.at + S;
                    } else {
                        due.push({ ask: a, at: a.at + 90 * S });
                    }
                }
            }
            assert.notEqual(hung, null);
            assert.equal(q.client.kills, 1);
            const firstAfter = due[0].ask;
            assert.ok(firstAfter.at <= R + 191 * S, `next ask at R + ${(firstAfter.at - R) / S} s`);
            assert.ok(settledAt <= R + 281 * S && settledAt < R + 300 * S, `answer at R + ${(settledAt - R) / S} s`);
            assert.ok(q.writes.length >= 1);
        });
    });

    test('11. the watchdog: a timeout at timeoutMs + 10 s, then the 30 s pause', () => {
        const q = makeQueue();
        const A = item(1, T0 + HOUR);
        const B = item(2, T0 + 2 * HOUR);
        q.items = [A, B];
        q.queue.setEngine(E1);
        q.pump();
        const sentAt = q.now;
        q.now = sentAt + 99_999;
        q.pump();
        assert.equal(q.client.kills, 0);
        q.now = sentAt + 100_000;
        q.pump();
        assert.equal(q.client.kills, 1);
        assert.equal(q.state.engineDown, true);
        assert.ok(q.state.failedKeys.has(A.key));
        q.now = sentAt + 100_000 + 30 * S - 1;
        q.pump();
        assert.equal(q.client.asks.length, 1);
        q.now = sentAt + 100_000 + 30 * S;
        q.pump();
        assert.equal(q.client.asks.length, 2);
        assert.equal(q.client.asks[1].invite.n, 2, "A waits for its own 1 min retry");
        const writes = q.writes.length;
        const published = q.states.length;
        q.client.asks[0].onDone(VERDICT);
        assert.equal(q.writes.length, writes);
        assert.equal(q.states.length, published);
    });

    test('12. lost: engine down, no retry, failed keys unchanged, the spend returned', () => {
        const q = makeQueue();
        const done = Array.from({ length: 118 }, (_, i) => item(i, T0 + HOUR + i * MIN));
        q.items = done;
        q.queue.setEngine(E1);
        for (let i = 0; i < 118; i++) {
            q.pump();
            q.client.answer(VERDICT);
        }
        const Z = item(500, T0 + 30 * MIN);
        q.items = [Z, ...done];
        q.pump();
        q.client.answer({ type: 'lost' });
        assert.equal(q.state.engineDown, true);
        assert.equal(q.state.failedKeys.size, 0);
        q.client.readyValue = false;
        q.pump();
        assert.equal(q.client.asks.length, 119);
        q.client.readyValue = true;
        q.pump();
        assert.equal(q.client.asks.at(-1).invite.n, 500, 'the same key at once: no pause, no retry');
        q.client.answer(VERDICT);
        // 118 + Z's verdict = 119 kept; the lost ask was returned, so one more fits the hour.
        const W = item(600, T0 + 20 * HOUR);
        const V = item(601, T0 + 21 * HOUR);
        q.items = [Z, ...done, W, V];
        q.pump();
        assert.equal(q.client.asks.at(-1).invite.n, 600);
        q.client.answer(VERDICT);
        q.pump();
        assert.equal(q.client.asks.at(-1).invite.n, 600, 'the 121st is refused');
    });

    test('13. the budget: 120 asks, then unavailable once, then the 121st an hour later', () => {
        const q = makeQueue();
        q.items = Array.from({ length: 121 }, (_, i) => item(i, T0 + 2 * HOUR + i * MIN));
        q.queue.setEngine(E1);
        for (let i = 0; i < 120; i++) {
            q.pump();
            q.client.answer(VERDICT);
        }
        assert.equal(q.client.asks.length, 120);
        const published = q.states.length;
        q.pump();
        assert.equal(q.client.asks.length, 120);
        assert.equal(q.states.length, published + 1);
        assert.equal(q.states.at(-1).status, 'unavailable');
        assert.equal(q.states.at(-1).engineDown, true);
        for (let i = 0; i < 5; i++)
            q.pump();
        assert.equal(q.states.length, published + 1);
        q.now = T0 + HOUR;
        q.pump();
        assert.equal(q.client.asks.length, 121);
        q.client.answer(VERDICT);
        assert.equal(q.states.at(-1).status, 'ok');
    });

    test('14. not ready: nothing sent, nothing spent, nothing published', () => {
        const q = makeQueue();
        q.items = Array.from({ length: 121 }, (_, i) => item(i, T0 + 2 * HOUR + i * MIN));
        q.queue.setEngine(E1);
        q.client.readyValue = false;
        const published = q.states.length;
        for (let i = 0; i < 50; i++)
            q.pump();
        assert.equal(q.client.asks.length, 0);
        assert.equal(q.states.length, published);
        q.client.readyValue = true;
        for (let i = 0; i < 121; i++) {
            q.pump();
            if (q.client.asks.some(a => a.open))
                q.client.answer(VERDICT);
        }
        assert.equal(q.client.asks.length, 120);
    });

    test('15. stale outcomes: before an engine change, or after destroy, do nothing', () => {
        let q = makeQueue();
        q.items = [item(1, T0 + HOUR)];
        q.queue.setEngine(E1);
        q.pump();
        const old = q.client.asks[0];
        q.queue.setEngine(E2);
        const published = q.states.length;
        old.onDone(VERDICT);
        assert.equal(q.writes.length, 0);
        assert.equal(q.states.length, published);

        q = makeQueue();
        q.items = [item(1, T0 + HOUR)];
        q.queue.setEngine(E1);
        q.pump();
        const ask = q.client.asks[0];
        const count = q.states.length;
        q.queue.destroy();
        q.queue.destroy();
        assert.equal(q.client.destroyed, true);
        ask.onDone(VERDICT);
        q.pump();
        q.queue.prune();
        assert.equal(q.writes.length, 0);
        assert.equal(q.states.length, count);
    });

    describe('16. a throwing client never throws out of the queue', () => {
        test('ask throws: logged once, engine down, unavailable', () => {
            const q = makeQueue();
            q.items = [item(1, T0 + HOUR)];
            q.queue.setEngine(E1);
            q.client.ask = () => {
                throw new Error('broken ask');
            };
            for (let i = 0; i < 5; i++)
                assert.doesNotThrow(() => q.pump());
            assert.equal(errors.filter(e => e[0] === 'payattention: ai-failed ask').length, 1);
            assert.equal(q.state.engineDown, true);
            assert.equal(q.state.status, 'unavailable');
        });

        test('the ready getter throws: logged once, engine down', () => {
            const q = makeQueue();
            q.items = [item(1, T0 + HOUR)];
            q.queue.setEngine(E1);
            Object.defineProperty(q.client, 'ready', {
                get() {
                    throw new Error('broken ready');
                },
            });
            for (let i = 0; i < 5; i++)
                assert.doesNotThrow(() => q.pump());
            assert.equal(errors.filter(e => e[0] === 'payattention: ai-failed pump').length, 1);
            assert.equal(q.state.engineDown, true);
        });

        test('createClient throws: unavailable, nothing sent; a working engine change recovers', () => {
            const q = makeQueue();
            q.items = [item(1, T0 + HOUR)];
            q.failCreate = true;
            assert.doesNotThrow(() => q.queue.setEngine(E1));
            q.pump();
            assert.equal(q.state.status, 'unavailable');
            assert.equal(q.clients.length, 0);
            assert.equal(errors.filter(e => e[0] === 'payattention: ai-failed client').length, 1);
            q.failCreate = false;
            q.queue.setEngine(E2);
            q.pump();
            assert.equal(q.client.asks.length, 1);
            assert.equal(q.state.status, 'ok');
        });
    });

    describe('17. a truthful status (D-031)', () => {
        const A = item(1, T0 + 5 * MIN);
        const B = item(2, T0 + HOUR);

        test('ok while waiting for a first answer; unavailable while a waiting meeting failed', () => {
            const q = makeQueue();
            q.items = [A, B];
            q.queue.setEngine(E1);
            q.pump();
            assert.equal(q.state.status, 'ok');
            q.client.answer(failed('bad-reply'));
            assert.equal(q.state.status, 'unavailable');
            q.now += S;
            q.pump();
            assert.equal(q.client.asks.at(-1).invite.n, 2);
            q.client.answer(VERDICT);
            assert.equal(q.state.status, 'unavailable', 'A still waits on a failure');
            q.now = T0 + MIN;
            q.pump();
            assert.equal(q.client.asks.at(-1).invite.n, 1);
            q.client.answer(VERDICT);
            assert.equal(q.state.status, 'ok');
        });

        test('a failed meeting past the cutoff no longer shows', () => {
            const q = makeQueue();
            q.items = [A, B];
            q.queue.setEngine(E1);
            q.pump();
            q.client.answer(failed('bad-reply'));
            q.now += S;
            q.pump();
            q.client.answer(VERDICT);
            assert.equal(q.state.status, 'unavailable');
            const published = q.states.length;
            q.now = T0 + 15 * MIN + 1;
            q.pump();
            assert.equal(q.states.length, published + 1);
            assert.equal(q.state.status, 'ok');
        });

        test('engine down with nothing waiting shows ok; a status-only change keeps the same objects', () => {
            const q = makeQueue();
            q.items = [A, B];
            q.queue.setEngine(E1);
            q.pump();
            q.client.answer(failed('network'));
            assert.equal(q.state.status, 'unavailable');
            const before = q.state;
            q.queue.pump([], CUTOFF);
            assert.equal(q.state.status, 'ok');
            assert.equal(q.state.engineDown, true);
            assert.equal(q.state.answers, before.answers);
            assert.equal(q.state.failedKeys, before.failedKeys);
            const published = q.states.length;
            q.queue.pump([], CUTOFF);
            assert.equal(q.states.length, published);
        });
    });

    test('18. prune drops entries past retention, writing and publishing once', () => {
        const OLD = `occ:old|${T0 - 8 * DAY}`;
        const NEW = `occ:new|${T0 - 6 * DAY}`;
        const entry = { fp: 'a', verdict: 'must', reason: 'r', at: T0 - 9 * DAY };
        const q = makeQueue({ answers: parseAiAnswers(JSON.stringify({ v: 1, items: { [OLD]: entry, [NEW]: entry } })) });
        q.queue.prune();
        assert.equal(q.writes.length, 1);
        assert.deepEqual(Object.keys(q.writes[0].items), [NEW]);
        assert.equal(q.states.length, 1);
        assert.deepEqual(Object.keys(q.state.answers), [NEW]);
        q.queue.prune();
        assert.equal(q.writes.length, 1);
        assert.equal(q.states.length, 1);
    });

    test('19. the constructor checks its arguments', () => {
        const ok = { answers: emptyAiAnswers(), writeAnswers() {}, createClient() {}, onChange() {}, now: () => T0 };
        assert.doesNotThrow(() => new AiQueue(ok));
        for (const name of ['writeAnswers', 'createClient', 'onChange', 'now'])
            assert.throws(() => new AiQueue({ ...ok, [name]: undefined }), TypeError, name);
        assert.throws(() => new AiQueue({ ...ok, answers: { v: 2, items: {} } }), TypeError);
        assert.throws(() => new AiQueue({ ...ok, answers: null }), TypeError);
    });

    describe('20. lost streak: one bad invite never blocks the others (§6.5)', () => {
        const LOST = Object.freeze({ type: 'lost' });
        const A = item(1, T0 + HOUR);
        const B = item(2, T0 + 2 * HOUR);

        test('LOST_STREAK_LIMIT is 2', () => {
            assert.equal(LOST_STREAK_LIMIT, 2);
        });

        test('a meeting whose invite always crashes the helper does not stop a later meeting getting its answer', () => {
            const q = makeQueue();
            q.items = [A, B];
            q.queue.setEngine(E1);
            q.run(T0, T0 + 10 * S, a => q.client.answer(a.invite.n === 1 ? LOST : VERDICT));
            assert.deepEqual(q.client.asks.slice(0, 3).map(a => a.invite.n), [1, 1, 2]);
            assert.equal(q.state.answers[B.key]?.verdict, 'ignore');
            assert.deepEqual([...q.state.failedKeys], [A.key]);
            assert.equal(q.state.status, 'unavailable');
        });

        test('the first lost in a row costs nothing; the second adds the key and backs it off 1, 2, 4 min', () => {
            const q = makeQueue();
            q.items = [A];
            q.queue.setEngine(E1);
            q.pump();
            q.client.answer(LOST);
            assert.equal(q.state.failedKeys.size, 0, 'first lost: failed keys unchanged');
            q.pump();
            assert.equal(q.client.asks.length, 2, 'first lost: re-asked at once, no retry');
            for (const waitMin of [1, 2, 4]) {
                q.client.answer(LOST);
                assert.deepEqual([...q.state.failedKeys], [A.key]);
                const lostAt = q.now;
                const asked = q.client.asks.length;
                q.now = lostAt + waitMin * MIN - 1;
                q.pump();
                assert.equal(q.client.asks.length, asked, `nothing before ${waitMin} min`);
                q.now = lostAt + waitMin * MIN;
                q.pump();
                assert.equal(q.client.asks.length, asked + 1, `asked again after ${waitMin} min`);
            }
        });

        test('the second lost in a row still returns its spend', () => {
            const q = makeQueue();
            const done = Array.from({ length: 119 }, (_, i) => item(100 + i, T0 + 3 * HOUR + i * MIN));
            q.items = done;
            q.queue.setEngine(E1);
            for (let i = 0; i < 119; i++) {
                q.pump();
                q.client.answer(VERDICT);
            }
            q.items = [A, ...done];
            q.pump();
            q.client.answer(LOST);
            q.pump();
            q.client.answer(LOST);
            // A is held by its retry; 119 answered + two returned losses leave room for exactly one more.
            const W = item(600, T0 + 20 * HOUR);
            const V = item(601, T0 + 21 * HOUR);
            q.items = [A, ...done, W, V];
            q.pump();
            assert.equal(q.client.asks.at(-1).invite.n, 600);
            q.client.answer(VERDICT);
            q.pump();
            assert.equal(q.client.asks.at(-1).invite.n, 600, 'the 121st is refused');
        });

        test("a verdict of that key clears its streak: the next lost is a first again", () => {
            const q = makeQueue();
            q.items = [A];
            q.queue.setEngine(E1);
            q.pump();
            q.client.answer(LOST);
            q.pump();
            q.client.answer(VERDICT);
            q.items = [item(1, T0 + HOUR, 'fp-changed')];
            q.pump();
            q.client.answer(LOST);
            assert.equal(q.state.failedKeys.size, 0);
            q.pump();
            assert.equal(q.client.asks.length, 4, 're-asked at once');
        });

        test("a failed outcome of that key clears its streak: the next lost is a first again", () => {
            const q = makeQueue();
            q.items = [A];
            q.queue.setEngine(E1);
            q.pump();
            q.client.answer(LOST);
            q.pump();
            q.client.answer(failed('bad-request'));
            q.now = T0 + MIN;
            q.pump();
            assert.equal(q.client.asks.length, 3);
            q.client.answer(LOST);
            q.pump();
            assert.equal(q.client.asks.length, 4, 're-asked at once: no retry advanced');
        });

        test("another key's verdict does not clear the streak", () => {
            const q = makeQueue();
            q.items = [A, B];
            q.queue.setEngine(E1);
            q.pump();
            q.client.answer(LOST);
            q.items = [B];
            q.pump();
            q.client.answer(VERDICT);
            q.items = [A, B];
            q.pump();
            assert.equal(q.client.asks.at(-1).invite.n, 1);
            q.client.answer(LOST);
            assert.deepEqual([...q.state.failedKeys], [A.key]);
        });

        test('an engine change clears every streak', () => {
            const q = makeQueue();
            q.items = [A];
            q.queue.setEngine(E1);
            q.pump();
            q.client.answer(LOST);
            q.queue.setEngine(E2);
            q.pump();
            assert.equal(q.client.engine, E2);
            q.client.answer(LOST);
            assert.equal(q.state.failedKeys.size, 0);
            q.pump();
            assert.equal(q.client.asks.length, 2, 're-asked at once on E2');
        });
    });
});
