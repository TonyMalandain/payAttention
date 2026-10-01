// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../extension/core/defaults.js';
import { timingFromSettings } from '../../extension/core/timing.js';

describe('default settings', () => {
    test('online steps default to 30 / 10 / 3 / 1 min before the start', () => {
        const s = DEFAULT_SETTINGS;
        assert.deepEqual([s.onlineHeadsupMinutes, s.onlineNudgeMinutes, s.onlineInsistMinutes, s.onlineTakeoverMinutes],
            [30, 10, 3, 1]);
    });

    test('in-person steps default to 10 / 5 / 2 / 0 min before leave-by (D-008)', () => {
        const s = DEFAULT_SETTINGS;
        assert.deepEqual([s.inpersonHeadsupMinutes, s.inpersonNudgeMinutes, s.inpersonInsistMinutes, s.inpersonTakeoverMinutes],
            [10, 5, 2, 0]);
    });

    test('the other defaults: 30 min travel (D-006), 15 s heads-up, 2 / 1 min snooze, 10 min cutoff, 15 guests', () => {
        const s = DEFAULT_SETTINGS;
        assert.equal(s.defaultTravelMinutes, 30);
        assert.equal(s.headsupDisplaySeconds, 15);
        assert.equal(s.snoozeMinutes, 2);
        assert.equal(s.takeoverSnoozeMinutes, 1);
        assert.equal(s.cutoffMinutes, 10);
        assert.equal(s.largeMeetingSize, 15);
    });

    test('the word, domain and address lists are empty, sound is on, and Test alert is not in the menu', () => {
        const s = DEFAULT_SETTINGS;
        assert.deepEqual(s.extraImportantWords, []);
        assert.deepEqual(s.extraIgnoreWords, []);
        assert.deepEqual(s.ownerDomains, []);
        assert.deepEqual(s.extraOwnerAddresses, []);
        assert.equal(s.soundEnabled, true);
        assert.equal(s.showTestAlert, false);
    });

    test('the defaults are frozen, arrays included', () => {
        assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
        for (const k of ['extraImportantWords', 'extraIgnoreWords', 'ownerDomains', 'extraOwnerAddresses'])
            assert.ok(Object.isFrozen(DEFAULT_SETTINGS[k]), k);
    });
});

describe('timing from settings', () => {
    test('the defaults convert to milliseconds', () => {
        assert.deepEqual(timingFromSettings(DEFAULT_SETTINGS), {
            online: { headsUpMs: 1800000, nudgeMs: 600000, insistMs: 180000, takeoverMs: 60000 },
            inPerson: { headsUpMs: 600000, nudgeMs: 300000, insistMs: 120000, takeoverMs: 0 },
            headsUpDisplayMs: 15000, snoozeMs: 120000, takeoverSnoozeMs: 60000, cutoffMs: 600000,
        });
    });

    test('the result is frozen', () => {
        const t = timingFromSettings(DEFAULT_SETTINGS);
        assert.ok(Object.isFrozen(t));
        assert.ok(Object.isFrozen(t.online));
        assert.ok(Object.isFrozen(t.inPerson));
    });

    test('a negative value is refused, naming the field', () => {
        assert.throws(() => timingFromSettings({ ...DEFAULT_SETTINGS, onlineNudgeMinutes: -1 }),
            { name: 'TypeError', message: /onlineNudgeMinutes/ });
    });

    test('a non-number is refused, naming the field', () => {
        assert.throws(() => timingFromSettings({ ...DEFAULT_SETTINGS, snoozeMinutes: 'x' }),
            { name: 'TypeError', message: /snoozeMinutes/ });
    });

    test('a missing value is refused, naming the field', () => {
        const s = { ...DEFAULT_SETTINGS };
        delete s.cutoffMinutes;
        assert.throws(() => timingFromSettings(s), { name: 'TypeError', message: /cutoffMinutes/ });
    });

    test('an infinite value is refused', () => {
        assert.throws(() => timingFromSettings({ ...DEFAULT_SETTINGS, headsupDisplaySeconds: Infinity }),
            { name: 'TypeError', message: /headsupDisplaySeconds/ });
    });
});
