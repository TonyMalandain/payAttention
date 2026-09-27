// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../../extension/core/judge.js';
import {
    T0, HOUR, OWNER, SOURCE, CONFIG, NO_OVERRIDES, att, event, snapshot, deepFreeze,
} from './support/builders.js';

const SRC2 = { uid: 'src-2', name: 'Shared', backend: 'caldav', ownerEmail: null, ok: true, error: null };

const JUDGED_KEYS = ['key', 'seriesKey', 'recurring', 'title', 'start', 'end', 'allDay', 'verdict', 'reason',
    'reasonCode', 'verdictOverridden', 'mode', 'modeOverridden', 'joinUrl', 'placeText', 'placeKey',
    'travelMinutes', 'travelIsDefault', 'deadline'];

const run = (events, sources = [SOURCE]) => judge(snapshot(events, sources), CONFIG, NO_OVERRIDES, {});

describe('judge: result shape', () => {
    test('each result has exactly the JudgedOccurrence fields, and everything is frozen', () => {
        const out = run([event()]);
        assert.deepEqual(Object.keys(out[0]).sort(), [...JUDGED_KEYS].sort());
        assert.ok(Object.isFrozen(out));
        assert.ok(Object.isFrozen(out[0]));
    });

    test('ignorable meetings are included', () => {
        const out = run([event({ summary: 'Lunch' })]);
        assert.equal(out.length, 1);
        assert.equal(out[0].verdict, 'ignore');
    });

    test('results are sorted by start, then key', () => {
        const out = run([
            event({ uid: 'c', start: T0 + HOUR }),
            event({ uid: 'b', start: T0 }),
            event({ uid: 'a', start: T0 }),
            event({ uid: 'z', start: null }),
        ]);
        assert.deepEqual(out.map(j => j.key), ['occ:a|' + T0, 'occ:b|' + T0, 'occ:c|' + (T0 + HOUR), 'occ:z|none']);
    });

    test('a series instance is keyed by its recurrence id', () => {
        const [j] = run([event({ recurring: true, recurrenceId: T0, start: T0 + HOUR })]);
        assert.equal(j.key, 'occ:evt-1|' + T0);
        assert.equal(j.seriesKey, 'series:evt-1');
    });
});

describe('judge: duplicates from several calendars', () => {
    test('the same occurrence in two calendars gives one result', () => {
        const out = run([event(), event({ sourceUid: 'src-2' })], [SOURCE, SRC2]);
        assert.equal(out.length, 1);
    });

    test('a must-attend copy wins over an ignorable one', () => {
        const declined = event({ attendees: [att(OWNER, 'declined'), att('alice@acme.test'), att('bob@acme.test')] });
        const out = run([declined, event({ sourceUid: 'src-2' })], [SOURCE, SRC2]);
        assert.equal(out.length, 1);
        assert.equal(out[0].verdict, 'must');
        assert.equal(out[0].reasonCode, 'small');
    });

    test('with two ignorable copies, the first is kept', () => {
        const out = run([event({ summary: 'Lunch' }), event({ sourceUid: 'src-2', summary: 'Gym' })], [SOURCE, SRC2]);
        assert.equal(out.length, 1);
        assert.equal(out[0].title, 'Lunch');
    });
});

describe('judge: inputs', () => {
    test('inputs are not mutated', () => {
        const snap = deepFreeze(snapshot([event({ location: '1 Main St' }), event({ uid: 'x', summary: 'Lunch' })]));
        const overrides = deepFreeze({ verdict: { 'series:x': 'must' }, mode: {} });
        assert.doesNotThrow(() => judge(snap, CONFIG, overrides, deepFreeze({ '1 main st': 15 })));
    });

    test('a missing large-meeting size is refused', () => {
        const config = { ...CONFIG };
        delete config.largeMeetingSize;
        assert.throws(() => judge(snapshot([event()]), config, NO_OVERRIDES, {}), { name: 'TypeError', message: /largeMeetingSize/ });
    });

    test('a non-string ignore word is refused', () => {
        assert.throws(() => judge(snapshot([event()]), { ...CONFIG, extraIgnoreWords: [1] }, NO_OVERRIDES, {}),
            { name: 'TypeError', message: /extraIgnoreWords/ });
    });

    test('missing overrides are refused', () => {
        assert.throws(() => judge(snapshot([event()]), CONFIG, undefined, {}), { name: 'TypeError', message: /overrides/ });
    });

    test('missing travel times are refused', () => {
        assert.throws(() => judge(snapshot([event()]), CONFIG, NO_OVERRIDES, undefined), { name: 'TypeError', message: /travel/ });
    });

    test('a snapshot without events is refused', () => {
        assert.throws(() => judge({ sources: [] }, CONFIG, NO_OVERRIDES, {}), { name: 'TypeError', message: /events/ });
    });
});
