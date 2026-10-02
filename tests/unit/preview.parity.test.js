// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Parity (interfaces.md §7.3, check 2): over the same settings, stored answers,
// store contents, snapshot, clock and AI outcomes, the preview lists exactly the
// meetings the alert controller holds, with the same verdicts.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Time formatting depends on the zone; fix it before the modules are loaded.
process.env.TZ = 'UTC';
const { judge } = await import('../../extension/core/judge.js');
const { DEFAULT_SETTINGS } = await import('../../extension/core/defaults.js');
const { parseAiAnswers } = await import('../../extension/core/aiAnswers.js');
const { T0, MIN, HOUR, NO_TRAVEL, snapshot } = await import('./support/builders.js');
const { EN, WORK, JOIN, MEETING, KEY, meeting, setup } = await import('./support/controllerHarness.js');
const { setupPreview } = await import('./support/previewHarness.js');

const S = 1000;
const AI = { verdictSource: 'ai', aiEndpoint: 'http://127.0.0.1:11434/v1', aiModel: 'test-model' };
const TAG = 'http://127.0.0.1:11434/v1|test-model';
const verdict = (v, reason) => ({ type: 'verdict', verdict: v, reason });
const failed = code => ({ type: 'failed', code });
const stored = items => parseAiAnswers(JSON.stringify({ v: 1, items }));

let realError;
let realWarn;
beforeEach(() => {
    realError = console.error;
    realWarn = console.warn;
    console.error = () => {};
    console.warn = () => {};
});
afterEach(() => {
    console.error = realError;
    console.warn = realWarn;
});

/** The rules-mode judged list, to learn keys, series keys and place keys. */
const rulesOf = (snap, overrides = { verdict: {}, mode: {} }) =>
    judge(snap, { ...DEFAULT_SETTINGS, ai: null }, overrides, NO_TRAVEL, {});

/** The fingerprint judge gives this occurrence for TAG (as controller.ai.test.js fpOf). */
function fpOf(snap, key) {
    const out = judge(snap, { ...DEFAULT_SETTINGS, ...AI, ai: { engineTag: TAG, utcOffsetMinutes: 0 } },
        { verdict: {}, mode: {} }, NO_TRAVEL, {});
    return out.find(j => j.key === key).aiAsk.fp;
}

/**
 * Builds the controller and the preview run over identical store contents,
 * delivers snap to both at `at`, and returns a driver that moves both clocks together.
 */
function pair({ settings = {}, aiAnswers = null, overrides = { verdict: {}, mode: {} }, travel = {}, snap, at = EN }) {
    const fill = store => {
        Object.assign(store.overrides.verdict, overrides.verdict);
        Object.assign(store.overrides.mode, overrides.mode);
        Object.assign(store.travel.byPlace, travel.byPlace ?? {});
        Object.assign(store.travel.byMeeting, travel.byMeeting ?? {});
    };
    const c = setup({ settings, aiAnswers });
    fill(c.store);
    c.store.onChange();
    const p = setupPreview({ settings, aiAnswers, format: 'json', beforeStart: h => fill(h.store) });
    for (const h of [c, p]) {
        h.now = at;
        h.feed.deliver(snap);
    }
    return {
        c, p,
        /** Both clocks to t; each fires its AI ticker first, then its own tick. */
        step(t) {
            c.now = t;
            c.aiTicker?.fire();
            c.ticker.fire();
            p.at(t);
        },
        /** The same outcome for the oldest open ask on both fake clients. */
        answer(outcome) {
            c.client.answer(outcome);
            p.client.answer(outcome);
        },
    };
}

/** The run's JSON agrees with the controller's list over the not-yet-ended meetings, and lists no other key. */
function assertParity({ c, p }) {
    assert.equal(p.outcomes.length, 1, 'the run finished');
    assert.equal(p.outcomes[0].code, 0, p.outcomes[0].stderr);
    const json = JSON.parse(p.outcomes[0].stdout);
    const now = json.generatedAt;
    const expected = c.controller._judged.filter(j => j.end === null || j.end > now);
    assert.ok(expected.length > 0);
    const byKey = new Map(json.meetings.map(m => [m.key, m]));
    for (const j of expected) {
        const m = byKey.get(j.key);
        assert.ok(m, `the preview lists ${j.key}`);
        assert.deepEqual(
            { verdict: m.verdict, reasonCode: m.reasonCode, reason: m.reason, mode: m.mode, overridden: m.overridden },
            { verdict: j.verdict, reasonCode: j.reasonCode, reason: j.reason, mode: j.mode, overridden: j.verdictOverridden },
            j.key);
    }
    assert.deepEqual([...byKey.keys()].sort(), expected.map(j => j.key).sort(), 'no other key');
    return json;
}

describe('preview parity with the alert controller', () => {
    test('(a) rules mode: an occurrence verdict override, a series verdict override, a mode override with a stored travel time', () => {
        const weekly = meeting({ uid: 'weekly', summary: 'Weekly planning', recurring: true, recurrenceId: T0 + 3 * HOUR,
            start: T0 + 3 * HOUR, end: T0 + 3 * HOUR + 30 * MIN });
        const visit = meeting({ uid: 'visit', summary: 'Client visit', location: '1 Main St, Springfield',
            conferenceUris: [JOIN], start: T0 + 5 * HOUR, end: T0 + 6 * HOUR });
        const snap = snapshot([MEETING, weekly, visit], [WORK]);
        const [, w, v] = rulesOf(snap);
        const overrides = { verdict: { [KEY]: 'ignore', [w.seriesKey]: 'ignore' }, mode: { [v.key]: 'in-person' } };
        const target = rulesOf(snap, overrides).find(j => j.key === v.key).travelTarget;
        assert.equal(target.kind, 'place');
        const x = pair({ overrides, travel: { byPlace: { [target.key]: 45 } }, snap });
        x.step(EN + S);
        const json = assertParity(x);
        const byKey = new Map(json.meetings.map(m => [m.key, m]));
        assert.equal(byKey.get(KEY).reasonCode, 'override-ignore');
        assert.equal(byKey.get(w.key).overridden, true);
        assert.equal(byKey.get(v.key).mode, 'in-person');
        assert.equal(byKey.get(v.key).travelMinutes, 45);
    });

    // current: a stored answer with the current fingerprint; stale: fingerprint 'old'; none: nothing stored.
    const current = MEETING;
    const stale = meeting({ uid: 'stale', summary: 'Partner sync', start: T0 + 2 * HOUR, end: T0 + 2 * HOUR + 30 * MIN });
    const none = meeting({ uid: 'none', summary: 'Board prep', start: T0 + 4 * HOUR, end: T0 + 4 * HOUR + 30 * MIN });
    const SNAP3 = snapshot([current, stale, none], [WORK]);
    const staleKey = rulesOf(SNAP3)[1].key;
    const answers = () => stored({
        [KEY]: { fp: fpOf(SNAP3, KEY), verdict: 'ignore', reason: 'optional sync', at: EN - HOUR },
        [staleKey]: { fp: 'old', verdict: 'ignore', reason: 'was optional', at: EN - HOUR },
    });

    test('(b) AI mode: a current answer, a stale one and none; both engines answer the two asks alike', () => {
        const x = pair({ settings: AI, aiAnswers: answers(), snap: SNAP3 });
        let t = EN;
        for (let i = 0; i < 20 && x.p.outcomes.length === 0; i++) {
            t += S;
            x.step(t);
            if (x.p.client.asks.some(a => a.open))
                x.answer(verdict('must', 'fake engine'));
        }
        const json = assertParity(x);
        assert.equal(x.p.client.asks.length, 2);
        assert.equal(x.c.client.asks.length, 2);
        assert.deepEqual(json.meetings.map(m => m.reasonCode), ['ai-ignore', 'ai-must', 'ai-must']);
    });

    test('(c) AI mode: the first ask fails with network on both; the stale answer is withheld and the rules decide', () => {
        const x = pair({ settings: AI, aiAnswers: answers(), snap: SNAP3 });
        let t = EN;
        for (let i = 0; i < 20 && x.p.outcomes.length === 0; i++) {
            t += S;
            x.step(t);
            if (x.p.client.asks.some(a => a.open))
                x.answer(failed('network'));
        }
        const json = assertParity(x);
        assert.equal(x.p.client.asks.length, 1);
        const byKey = new Map(json.meetings.map(m => [m.key, m]));
        assert.equal(byKey.get(KEY).reasonCode, 'ai-ignore');
        assert.ok(!byKey.get(staleKey).reasonCode.startsWith('ai-'), byKey.get(staleKey).reasonCode);
        assert.equal(json.aiStatus, 'unavailable');
    });
});
