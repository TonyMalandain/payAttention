// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The AI request budget (constraints.md). Not budget.test.js, which is the tick-time budget.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RequestBudget, AI_REQUESTS_PER_HOUR, AI_REQUESTS_PER_DAY } from '../../extension/app/aiBudget.js';

const T = Date.UTC(2026, 0, 5, 9, 0, 0);
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function spendMany(b, tag, n, at) {
    const out = [];
    for (let i = 0; i < n; i++)
        out.push(b.trySpend(tag, typeof at === 'function' ? at(i) : at));
    return out;
}

describe('RequestBudget', () => {
    test('1. the limits are 120 an hour and 1000 a day', () => {
        assert.equal(AI_REQUESTS_PER_HOUR, 120);
        assert.equal(AI_REQUESTS_PER_DAY, 1000);
    });

    test('2. 120 in an hour, then refused until the first is an hour old', () => {
        const b = new RequestBudget();
        assert.ok(spendMany(b, 'a', 120, T).every(Boolean));
        assert.equal(b.trySpend('a', T), false);
        assert.equal(b.trySpend('a', T + HOUR - 1), false);
        assert.equal(b.trySpend('a', T + HOUR), true);
    });

    test('3. a refusal spends nothing', () => {
        const b = new RequestBudget();
        spendMany(b, 'a', 120, T);
        assert.ok(spendMany(b, 'a', 50, T + 10 * MIN).every(r => r === false));
        assert.ok(spendMany(b, 'a', 120, T + HOUR).every(Boolean));
        assert.equal(b.trySpend('a', T + HOUR), false);
    });

    test('4. 1000 a day, even under the hourly cap', () => {
        const b = new RequestBudget();
        assert.ok(spendMany(b, 'a', 1000, i => T + i * 40_000).every(Boolean));
        assert.equal(b.trySpend('a', T + 1000 * 40_000), false);
        assert.equal(b.trySpend('a', T + DAY), true);
    });

    test('5. each engine tag has its own budget', () => {
        const b = new RequestBudget();
        spendMany(b, 'a', 120, T);
        assert.equal(b.trySpend('a', T), false);
        assert.equal(b.trySpend('b', T), true);
    });

    describe('6. refund (D-031)', () => {
        test('gives back exactly one spend, once', () => {
            const b = new RequestBudget();
            assert.ok(spendMany(b, 'a', 120, i => T + i).every(Boolean));
            b.refund('a', T + 7);
            assert.equal(b.trySpend('a', T + 200), true);
            assert.equal(b.trySpend('a', T + 201), false);
            b.refund('a', T + 7);
            assert.equal(b.trySpend('a', T + 202), false);
        });

        test('a time with no spend, or another engine, gives nothing back', () => {
            const b = new RequestBudget();
            spendMany(b, 'a', 120, i => T + i);
            b.refund('a', T + 5000);
            b.refund('b', T + 8);
            assert.equal(b.trySpend('a', T + 300), false);
        });

        test('a spend already forgotten cannot be refunded, and nothing throws', () => {
            const b = new RequestBudget();
            b.trySpend('a', T);
            assert.equal(b.trySpend('a', T + DAY + 1), true);
            assert.doesNotThrow(() => b.refund('a', T));
            // The refund did not remove the spend at T + DAY + 1: 119 more fit, not 120.
            assert.ok(spendMany(b, 'a', 119, T + DAY + 2).every(Boolean));
            assert.equal(b.trySpend('a', T + DAY + 2), false);
        });

        test('equal times: one refund frees exactly one slot', () => {
            const b = new RequestBudget();
            spendMany(b, 'a', 118, i => T + i);
            spendMany(b, 'a', 2, T + 500);
            assert.equal(b.trySpend('a', T + 600), false);
            b.refund('a', T + 500);
            assert.equal(b.trySpend('a', T + 601), true);
            assert.equal(b.trySpend('a', T + 602), false);
        });

        test('a refund on an unknown engine does nothing and does not throw', () => {
            const b = new RequestBudget();
            assert.doesNotThrow(() => b.refund('nobody', T));
        });
    });
});
