// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// One preview run (interfaces.md §7.3) with fake parts and a fake clock: it waits
// for the calendar and the AI, finishes exactly once, and never writes.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Time formatting depends on the zone; fix it before the modules are loaded.
process.env.TZ = 'UTC';
const { startPreview, SNAPSHOT_WAIT_MS, AI_WAIT_MS, NO_CALENDAR_TEXT } = await import('../../extension/preview/session.js');
const { formatPreview } = await import('../../extension/preview/report.js');
const { judge } = await import('../../extension/core/judge.js');
const { DEFAULT_SETTINGS } = await import('../../extension/core/defaults.js');
const { T0, MIN, HOUR, NO_TRAVEL, snapshot } = await import('./support/builders.js');
const { EN, SNAP, WORK, MEETING, meeting } = await import('./support/controllerHarness.js');
const { setupPreview } = await import('./support/previewHarness.js');

const AI = { verdictSource: 'ai', aiEndpoint: 'http://127.0.0.1:11434/v1', aiModel: 'test-model' };
const TWO = snapshot([MEETING, meeting({ uid: 'client-2', start: T0 + HOUR, end: T0 + 90 * MIN })], [WORK]);
const verdict = (v, reason) => ({ type: 'verdict', verdict: v, reason });
const failed = code => ({ type: 'failed', code });
const READER_METHODS = new Set(['readSettings', 'readOverrides', 'readTravel', 'readAiAnswers', 'destroy']);

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

/** Deliver a snapshot at t (the clock moves to t first). */
function deliver(h, t, snap = SNAP) {
    h.now = t;
    h.feed.deliver(snap);
}

const allDestroyed = h => h.tickers.every(t => t.destroyed) && h.log.includes('feed.destroy') && h.log.includes('reader.destroy');

describe('preview session: start', () => {
    test('1. a missing function throws TypeError, and no factory is called', () => {
        const names = ['createStoreReader', 'createFeed', 'createAiClient', 'createTicker', 'progress', 'onFinish', 'now'];
        for (const name of names) {
            const called = [];
            const deps = { format: 'text' };
            for (const n of names)
                deps[n] = () => called.push(n);
            deps[name] = undefined;
            assert.throws(() => startPreview(deps), TypeError, name);
            assert.deepEqual(called, [], name);
        }
    });

    test('10. onFinish is never called inside startPreview, even with a snapshot already there', () => {
        const h = setupPreview({ beforeStart: x => (x.initialSnapshot = SNAP) });
        assert.deepEqual(h.outcomes, []);
        h.at(EN);
        assert.equal(h.outcomes.length, 1);
        assert.equal(h.outcomes[0].code, 0);
    });
});

describe('preview session: no calendar data', () => {
    test('2. nothing before 30 s; at 30 s one outcome, code 3; parts destroyed before onFinish', () => {
        const h = setupPreview();
        h.at(EN + SNAPSHOT_WAIT_MS - 1);
        assert.deepEqual(h.outcomes, []);
        h.at(EN + SNAPSHOT_WAIT_MS);
        assert.deepEqual(h.outcomes, [{ code: 3, stdout: '', stderr: NO_CALENDAR_TEXT }]);
        assert.ok(allDestroyed(h));
        assert.deepEqual(h.log, ['ticker.destroy', 'feed.destroy', 'reader.destroy', 'onFinish']);
        h.at(EN + SNAPSHOT_WAIT_MS + 1000);
        assert.equal(h.outcomes.length, 1);
        assert.equal(SNAPSHOT_WAIT_MS, 30_000);
    });
});

describe('preview session: rules mode', () => {
    test('3. the snapshot, then one tick: code 0 with the presenter output of the same inputs; nothing asked', () => {
        const h = setupPreview({ format: 'json' });
        deliver(h, EN + 5000);
        h.at(EN + 6000);
        assert.equal(h.outcomes.length, 1);
        const judged = judge(SNAP, { ...DEFAULT_SETTINGS, ai: null }, { verdict: {}, mode: {} }, NO_TRAVEL, {});
        const expected = formatPreview({
            now: EN + 6000, settings: { ...DEFAULT_SETTINGS }, judged, sources: SNAP.sources,
            aiStatus: 'off', aiProgress: { pending: 0, byRules: 0 },
        }, 'json');
        assert.deepEqual(h.outcomes[0], { code: 0, stdout: expected, stderr: '' });
        assert.equal(h.aiClients.length, 0);
        assert.deepEqual(h.progress, []);
        assert.ok(allDestroyed(h));
    });

    test('3. text format gives the text report', () => {
        const h = setupPreview({ format: 'text' });
        deliver(h, EN);
        h.at(EN + 1000);
        assert.ok(h.outcomes[0].stdout.startsWith('payAttention verdicts, '));
        assert.ok(h.outcomes[0].stdout.includes('Client review'));
    });
});

describe('preview session: AI mode', () => {
    test('4. waits while a meeting waits, reports each change of the count once, then prints the AI verdicts', () => {
        const h = setupPreview({ settings: AI });
        const t = EN;
        deliver(h, t, TWO);
        h.at(t + 1000);
        assert.deepEqual(h.outcomes, []);
        assert.deepEqual(h.progress, ['payAttention: asking the AI engine: 2 meetings waiting']);
        h.at(t + 2000);
        assert.equal(h.client.asks.length, 1);
        h.client.answer(verdict('must', 'fake engine'));
        h.at(t + 3000);
        assert.deepEqual(h.outcomes, []);
        h.at(t + 4000);
        h.client.answer(verdict('must', 'fake engine'));
        assert.deepEqual(h.progress, [
            'payAttention: asking the AI engine: 2 meetings waiting',
            'payAttention: asking the AI engine: 1 meeting waiting',
        ]);
        h.at(t + 5000);
        assert.equal(h.outcomes.length, 1);
        assert.equal(h.outcomes[0].code, 0);
        const json = JSON.parse(h.outcomes[0].stdout);
        assert.equal(json.verdictSource, 'ai');
        assert.equal(json.aiStatus, 'ok');
        assert.deepEqual(json.meetings.map(m => m.reasonCode), ['ai-must', 'ai-must']);
        assert.equal(h.progress.length, 2);
        assert.ok(allDestroyed(h));
        assert.equal(h.client.destroyed, true);
    });

    test('5. the engine never answers: printed at 5 minutes after the first snapshot, with the waiting footer', () => {
        const h = setupPreview({ settings: AI, format: 'text' });
        const first = EN + 10_000;
        h.at(EN + 5000);
        deliver(h, first, TWO);
        h.at(first);
        h.at(first + AI_WAIT_MS - 1);
        assert.deepEqual(h.outcomes, []);
        assert.equal(h.client.asks.length, 1, 'one ask outstanding');
        h.at(first + AI_WAIT_MS);
        assert.equal(h.outcomes.length, 1);
        assert.equal(h.outcomes[0].code, 0);
        assert.ok(h.outcomes[0].stdout.endsWith(
            '2 meetings still waiting for the AI engine after 5 minutes: shown with the verdict payAttention gives now.'),
        h.outcomes[0].stdout);
        assert.equal(AI_WAIT_MS, 300_000);
    });

    test('6. the first ask fails with network: finished on the next tick, decided by the rules', () => {
        const h = setupPreview({ settings: AI, format: 'text' });
        deliver(h, EN, TWO);
        h.at(EN + 1000);
        h.at(EN + 2000);
        h.client.answer(failed('network'));
        assert.deepEqual(h.outcomes, []);
        h.at(EN + 3000);
        assert.equal(h.outcomes.length, 1);
        assert.equal(h.outcomes[0].code, 0);
        assert.ok(h.outcomes[0].stdout.includes('2 meetings decided by the rules: the AI engine was unavailable.'));
        assert.ok(!h.outcomes[0].stdout.includes('still waiting'));
    });

    test('7. never writes: answers stay in memory; only the reader is used', () => {
        const h = setupPreview({ settings: AI });
        const storedBefore = h.store.aiAnswers;
        deliver(h, EN, TWO);
        h.at(EN + 1000);
        h.at(EN + 2000);
        h.client.answer(verdict('ignore', 'optional'));
        h.at(EN + 3000);
        h.at(EN + 4000);
        h.client.answer(verdict('must', 'fake engine'));
        h.at(EN + 5000);
        assert.equal(h.outcomes[0].code, 0);
        const s = h.store;
        for (const list of [s.aiWrites, s.alertWrites, s.clockWrites, s.verdictCalls, s.modeCalls, s.travelCalls, s.prunes])
            assert.deepEqual(list, []);
        assert.equal(h.store.aiAnswers, storedBefore);
        assert.ok(h.readerCalls.length > 0);
        for (const name of h.readerCalls)
            assert.ok(READER_METHODS.has(name), name);
    });
});

describe('preview session: stop and failures', () => {
    test('8. stop() destroys everything; later ticks give nothing; a second stop does nothing', () => {
        const h = setupPreview({ settings: AI });
        deliver(h, EN, TWO);
        h.at(EN + 1000);
        h.at(EN + 2000);
        const client = h.client;
        h.run.stop();
        assert.equal(h.tickers.length, 2);
        assert.ok(allDestroyed(h));
        assert.equal(client.destroyed, true);
        const logged = h.log.length;
        for (const ticker of h.tickers)
            ticker.fire();
        h.at(EN + AI_WAIT_MS * 2);
        h.run.stop();
        assert.deepEqual(h.outcomes, []);
        assert.equal(h.log.length, logged);
        assert.ok(!h.log.includes('onFinish'));
    });

    test('9. an internal failure: code 1 with the internal-error text, and everything destroyed', () => {
        const h = setupPreview({ settings: { largeMeetingSize: 0 } });
        deliver(h, EN);
        h.at(EN + 1000);
        assert.equal(h.outcomes.length, 1);
        assert.equal(h.outcomes[0].code, 1);
        assert.equal(h.outcomes[0].stdout, '');
        assert.ok(h.outcomes[0].stderr.startsWith('payAttention preview: internal error:'), h.outcomes[0].stderr);
        assert.ok(allDestroyed(h));
        assert.equal(h.log.at(-1), 'onFinish');
    });
});
