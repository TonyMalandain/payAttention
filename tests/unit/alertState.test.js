// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    emptyAlertState, parseAlertState, serializeAlertState, reduce,
} from '../../extension/core/alertState.js';
import { T0, MIN, HOUR, deepFreeze } from './support/builders.js';

const k = 'occ:e|' + T0;
const S = T0;
const E = emptyAlertState();
const item = over => ({ start: S, done: null, doneAt: null, snoozeUntil: null, headsUpShownAt: null, ...over });

describe('empty state', () => {
    test('is version 1 with no items, frozen', () => {
        assert.deepEqual(E, { v: 1, items: {} });
        assert.ok(Object.isFrozen(E));
        assert.ok(Object.isFrozen(E.items));
    });
});

describe('reduce: acknowledge and skip', () => {
    test('ack records when it was done', () => {
        const s = reduce(E, { type: 'ack', key: k, start: S }, S - 5 * MIN);
        assert.deepEqual(s.items[k], item({ done: 'ack', doneAt: S - 5 * MIN }));
    });

    test('skip records a skip', () => {
        const s = reduce(E, { type: 'skip', key: k, start: S }, S - 5 * MIN);
        assert.equal(s.items[k].done, 'skip');
    });

    test('ack clears a running snooze', () => {
        const snoozed = reduce(E, { type: 'snooze', key: k, start: S, until: S - 3 * MIN }, S - 5 * MIN);
        const s = reduce(snoozed, { type: 'ack', key: k, start: S }, S - 4 * MIN);
        assert.equal(s.items[k].snoozeUntil, null);
    });
});

describe('reduce: snooze', () => {
    test('a snooze records its end', () => {
        const s = reduce(E, { type: 'snooze', key: k, start: S, until: S - 3 * MIN }, S - 5 * MIN);
        assert.deepEqual(s.items[k], item({ snoozeUntil: S - 3 * MIN }));
    });

    test('a snooze that has already ended changes nothing', () => {
        assert.equal(reduce(E, { type: 'snooze', key: k, start: S, until: S - 5 * MIN }, S - 5 * MIN), E);
    });

    test('an acknowledged meeting cannot be snoozed', () => {
        const acked = reduce(E, { type: 'ack', key: k, start: S }, S - 10 * MIN);
        assert.equal(reduce(acked, { type: 'snooze', key: k, start: S, until: S - 3 * MIN }, S - 5 * MIN), acked);
    });
});

describe('reduce: heads-up shown', () => {
    test('the first heads-up is recorded, a second changes nothing', () => {
        const s1 = reduce(E, { type: 'headsUpShown', key: k, start: S }, S - 30 * MIN);
        assert.equal(s1.items[k].headsUpShownAt, S - 30 * MIN);
        assert.equal(reduce(s1, { type: 'headsUpShown', key: k, start: S }, S - 29 * MIN), s1);
    });

    test('a heads-up on an acknowledged meeting changes nothing', () => {
        const acked = reduce(E, { type: 'ack', key: k, start: S }, S - 40 * MIN);
        assert.equal(reduce(acked, { type: 'headsUpShown', key: k, start: S }, S - 30 * MIN), acked);
    });
});

describe('reduce: a moved meeting', () => {
    test('an action with a new start replaces the old item', () => {
        const acked = reduce(E, { type: 'ack', key: k, start: S }, S - 10 * MIN);
        const s = reduce(acked, { type: 'snooze', key: k, start: S + HOUR, until: S + HOUR - 3 * MIN }, S + HOUR - 5 * MIN);
        assert.deepEqual(s.items[k], item({ start: S + HOUR, snoozeUntil: S + HOUR - 3 * MIN }));
    });
});

describe('reduce: prune', () => {
    test('old, timeless and non-occurrence items are dropped; recent ones are kept', () => {
        const a = 'occ:a|' + (T0 - 8 * 24 * HOUR);
        const b = 'occ:b|' + (T0 - 6 * 24 * HOUR);
        const state = {
            v: 1, items: {
                [a]: item({ start: T0 - 8 * 24 * HOUR }),
                [b]: item({ start: T0 - 6 * 24 * HOUR }),
                'test:1': item(),
                'series:x': item(),
            },
        };
        assert.deepEqual(Object.keys(reduce(state, { type: 'prune' }, T0).items), [b]);
    });
});

describe('reduce: purity and bad actions', () => {
    test('the input is not mutated and the output is frozen', () => {
        const input = deepFreeze({ v: 1, items: { [k]: item() } });
        const s = reduce(input, { type: 'ack', key: k, start: S }, S);
        assert.ok(Object.isFrozen(s));
        assert.ok(Object.isFrozen(s.items));
        assert.ok(Object.isFrozen(s.items[k]));
        assert.equal(input.items[k].done, null);
    });

    test('an unknown action type is refused', () => {
        assert.throws(() => reduce(E, { type: 'nope' }, 0), TypeError);
    });

    test('an action without a key is refused', () => {
        assert.throws(() => reduce(E, { type: 'ack', start: S }, S), TypeError);
    });

    test('a snooze without an end is refused', () => {
        assert.throws(() => reduce(E, { type: 'snooze', key: k, start: S }, S), TypeError);
    });

    test('an action without a finite start is refused', () => {
        assert.throws(() => reduce(E, { type: 'ack', key: k, start: 'x' }, S), TypeError);
    });
});

describe('stored alert state', () => {
    test('serialise then parse round-trips', () => {
        let s = reduce(E, { type: 'ack', key: k, start: S }, S - 5 * MIN);
        s = reduce(s, { type: 'snooze', key: 'occ:f|1', start: 1, until: S }, S - MIN);
        assert.deepEqual(parseAlertState(serializeAlertState(s)), s);
    });

    for (const text of ['', null, undefined, 'not json', '[]', '{"v":2,"items":{}}', '{"v":1,"items":[]}', '"x"']) {
        test(`corrupt text ${JSON.stringify(text)} gives empty state`, () => {
            assert.deepEqual(parseAlertState(text), { v: 1, items: {} });
        });
    }

    test('an item with an unknown done value is dropped, its valid sibling kept', () => {
        const text = JSON.stringify({ v: 1, items: { a: item({ done: 'maybe' }), b: item() } });
        assert.deepEqual(parseAlertState(text), { v: 1, items: { b: item() } });
    });

    test('an item with a non-numeric start is dropped', () => {
        const text = JSON.stringify({ v: 1, items: { a: item({ start: 'x' }) } });
        assert.deepEqual(parseAlertState(text), { v: 1, items: {} });
    });

    test('the parsed state is frozen', () => {
        const s = parseAlertState(JSON.stringify({ v: 1, items: { b: item() } }));
        assert.ok(Object.isFrozen(s));
        assert.ok(Object.isFrozen(s.items.b));
    });
});
