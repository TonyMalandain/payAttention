// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Order-of-magnitude guards for the tick budget in constraints.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { judge } from '../../extension/core/judge.js';
import { plan } from '../../extension/core/plan.js';
import { emptyAlertState, reduce } from '../../extension/core/alertState.js';
import { T0, MIN, HOUR, CONFIG, NO_OVERRIDES, NO_TRAVEL, TIMING, ENV, OWNER, att, event, snapshot, judged } from './support/builders.js';

const S = T0;

// The fastest of the timed runs, not the mean: `npm test` runs files in parallel, and other
// load only ever adds time, so the minimum is the stable figure (testing-and-build.md, Layer 1).
function fastestMs(fn, runs, warmup) {
    assert.ok(runs >= 10, 'at least 10 timed runs');
    for (let i = 0; i < warmup; i++)
        fn();
    let fastest = Infinity;
    for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        fn();
        fastest = Math.min(fastest, performance.now() - t0);
    }
    return fastest;
}

test('plan over 500 meetings takes under 1 ms at its fastest', () => {
    const list = [];
    let state = emptyAlertState();
    for (let i = 0; i < 500; i++) {
        const start = S + (i * 3 * MIN) % (24 * HOUR);
        const key = `occ:b${i}|${start}`;
        const inPerson = i % 2 === 1;
        list.push(judged({
            key, start, end: start + 30 * MIN,
            mode: inPerson ? 'in-person' : 'online',
            travelMinutes: inPerson ? 30 : null,
            deadline: inPerson ? start - 30 * MIN : start,
        }));
        if (i < 200)
            state = reduce(state, { type: 'headsUpShown', key, start }, start - 40 * MIN);
    }
    const fastest = fastestMs(() => plan(S + HOUR, list, state, TIMING, ENV), 200, 20);
    assert.ok(fastest < 1, `plan fastest ${fastest.toFixed(3)} ms`);
});

function twoThousandEvents() {
    const titles = ['Sync', 'Client call', 'Lunch', 'Weekly review', 'Board prep', 'Focus time', '1:1 Dana', 'Planning'];
    const events = [];
    for (let i = 0; i < 2000; i++) {
        events.push(event({
            uid: `e${i}`,
            start: S + i * MIN,
            summary: titles[i % titles.length],
            description: i % 4 === 0 ? 'Join https://meet.google.com/abc-defg-hij' : '',
            location: i % 4 === 1 ? `${i} Main St, Springfield` : '',
            attendees: [att(OWNER), att(`a${i}@acme.test`), att(`b${i}@acme.test`), att(`c${i}@partner.test`),
                att(`d${i}@acme.test`)],
        }));
    }
    return snapshot(events);
}

test('judge over 2 000 events takes under 20 ms at its fastest', () => {
    const snap = twoThousandEvents();
    const fastest = fastestMs(() => judge(snap, CONFIG, NO_OVERRIDES, NO_TRAVEL), 10, 2);
    assert.ok(fastest < 20, `judge fastest ${fastest.toFixed(3)} ms`);
});

// Judge runs per snapshot and per stored answer, never per tick (verdicts.js judgedList).
// 200 ms is an order-of-magnitude guard (assumed): every eligible event builds an invite and a fingerprint.
test('judge in AI mode over 2 000 events takes under 200 ms at its fastest', () => {
    const snap = twoThousandEvents();
    const config = { ...CONFIG, ai: { engineTag: 'http://127.0.0.1:11434/v1|m', utcOffsetMinutes: -240 } };
    const out = judge(snap, config, NO_OVERRIDES, NO_TRAVEL, {});
    assert.ok(out.filter(r => r.aiAsk).length > 1000, 'most events are asked');
    const fastest = fastestMs(() => judge(snap, config, NO_OVERRIDES, NO_TRAVEL, {}), 10, 2);
    assert.ok(fastest < 200, `judge (AI mode) fastest ${fastest.toFixed(3)} ms`);
});
