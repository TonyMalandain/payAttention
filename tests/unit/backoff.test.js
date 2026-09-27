// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_DELAY_MS, MAX_DELAY_MS, HEALTHY_RESET_MS, nextRestartDelayMs } from '../../extension/app/backoff.js';

describe('helper restart delay', () => {
    test('the constants', () => {
        assert.equal(FIRST_DELAY_MS, 1000);
        assert.equal(MAX_DELAY_MS, 300_000);
        assert.equal(HEALTHY_RESET_MS, 600_000);
    });

    test('doubles from 1 s and is capped at 300 s', () => {
        const seen = [];
        let delay = null;
        for (let i = 0; i < 12; i++) {
            delay = nextRestartDelayMs(delay, 0);
            seen.push(delay / 1000);
        }
        assert.deepEqual(seen, [1, 2, 4, 8, 16, 32, 64, 128, 256, 300, 300, 300]);
    });

    test('resets after a 10-minute run', () => {
        assert.equal(nextRestartDelayMs(300_000, 600_000), 1000);
        assert.equal(nextRestartDelayMs(300_000, 599_999), 300_000);
        assert.equal(nextRestartDelayMs(8000, 599_999), 16_000);
    });
});
