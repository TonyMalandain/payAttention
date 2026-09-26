import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    RETENTION_MS, occurrenceKey, seriesKey, placeKey, occurrenceKeyTime, isExpiredOccurrenceKey,
} from '../../extension/core/keys.js';
import { T0, HOUR } from './support/builders.js';

describe('occurrence and series keys', () => {
    test('a single meeting is keyed by uid and start', () => {
        assert.equal(occurrenceKey({ uid: 'evt-1', recurrenceId: null, start: T0 }), 'occ:evt-1|' + T0);
    });

    test('a series instance is keyed by its recurrence id, so the key survives a move', () => {
        assert.equal(occurrenceKey({ uid: 'evt-1', recurrenceId: T0, start: T0 + HOUR }), 'occ:evt-1|' + T0);
    });

    test('a meeting with no time gets a "none" key', () => {
        assert.equal(occurrenceKey({ uid: 'u', recurrenceId: null, start: null }), 'occ:u|none');
    });

    test('the series key is the uid', () => {
        assert.equal(seriesKey({ uid: 'evt-1' }), 'series:evt-1');
    });
});

describe('place keys', () => {
    test('a place is compared without case or extra spaces', () => {
        assert.equal(placeKey('  Café   Central\tRoom 4 '), 'café central room 4');
    });

    test('an empty or blank place has no key', () => {
        assert.equal(placeKey(''), null);
        assert.equal(placeKey('   '), null);
    });
});

describe('key time and retention', () => {
    test('the time is the digits after the last bar of an occ: key', () => {
        assert.equal(occurrenceKeyTime('occ:a|b|123'), 123);
    });

    test('keys without a numeric time give null', () => {
        assert.equal(occurrenceKeyTime('occ:x|abc'), null);
        assert.equal(occurrenceKeyTime('series:x'), null);
        assert.equal(occurrenceKeyTime('test:5'), null);
        assert.equal(occurrenceKeyTime('occ:u|none'), null);
    });

    test('retention is 7 days', () => {
        assert.equal(RETENTION_MS, 604800000);
    });

    test('an occurrence key older than the retention is expired, the boundary itself is not', () => {
        assert.equal(isExpiredOccurrenceKey('occ:u|' + (T0 - RETENTION_MS - 1), T0), true);
        assert.equal(isExpiredOccurrenceKey('occ:u|' + (T0 - RETENTION_MS), T0), false);
    });

    test('a series key never expires', () => {
        assert.equal(isExpiredOccurrenceKey('series:u', T0), false);
    });
});
