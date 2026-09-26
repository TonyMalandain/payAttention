import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotRange, overlapsRange } from '../../extension/helper/range.js';

describe('snapshot range', () => {
    test('the range is one hour before now to 36 hours after', () => {
        const T = 1_800_000_000_000;
        assert.deepEqual(snapshotRange(T), { rangeStart: T - 3_600_000, rangeEnd: T + 129_600_000 });
    });
});

describe('overlap with [rangeStart, rangeEnd)', () => {
    test('an occurrence ending exactly at rangeStart does not overlap', () => {
        assert.equal(overlapsRange(10, 20, 20, 30), false);
    });

    test('an occurrence spanning rangeStart overlaps', () => {
        assert.equal(overlapsRange(19, 21, 20, 30), true);
    });

    test('an occurrence starting exactly at rangeEnd does not overlap', () => {
        assert.equal(overlapsRange(30, 40, 20, 30), false);
    });

    test('an occurrence spanning rangeEnd overlaps', () => {
        assert.equal(overlapsRange(29, 31, 20, 30), true);
    });

    test('a zero-length occurrence at rangeStart overlaps', () => {
        assert.equal(overlapsRange(20, 20, 20, 30), true);
    });

    test('a zero-length occurrence at rangeEnd does not overlap', () => {
        assert.equal(overlapsRange(30, 30, 20, 30), false);
    });

    test('a zero-length occurrence before rangeStart does not overlap', () => {
        assert.equal(overlapsRange(19, 19, 20, 30), false);
    });
});
