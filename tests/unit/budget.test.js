// Order-of-magnitude guards for the tick budget in constraints.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { judge } from '../../extension/core/judge.js';
import { plan } from '../../extension/core/plan.js';
import { emptyAlertState, reduce } from '../../extension/core/alertState.js';
import { T0, MIN, HOUR, CONFIG, NO_OVERRIDES, TIMING, ENV, OWNER, att, event, snapshot, judged } from './support/builders.js';

const S = T0;

function meanMs(fn, runs, warmup) {
    for (let i = 0; i < warmup; i++)
        fn();
    const t0 = performance.now();
    for (let i = 0; i < runs; i++)
        fn();
    return (performance.now() - t0) / runs;
}

test('plan over 500 meetings takes under 1 ms on average', () => {
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
    const mean = meanMs(() => plan(S + HOUR, list, state, TIMING, ENV), 200, 20);
    assert.ok(mean < 1, `plan mean ${mean.toFixed(3)} ms`);
});

test('judge over 2 000 events takes under 20 ms on average', () => {
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
    const snap = snapshot(events);
    const mean = meanMs(() => judge(snap, CONFIG, NO_OVERRIDES, {}), 10, 2);
    assert.ok(mean < 20, `judge mean ${mean.toFixed(3)} ms`);
});
