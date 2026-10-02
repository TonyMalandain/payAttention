// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The test alert (PRD §5): one fake must-attend meeting that runs the whole
// ladder in 25 s. The controller keeps its state in memory, never stored.

/**
 * The fast ladder: heads-up at once, nudge at +10 s, insist at +20 s, takeover
 * at +25 s, gone 60 s after the start if never acted on. Frozen.
 *
 * @type {Readonly<import('./types.js').Timing>}
 */
export const TEST_ALERT_TIMING = Object.freeze({
    online: Object.freeze({ headsUpMs: 30000, nudgeMs: 20000, insistMs: 10000, takeoverMs: 5000 }),
    inPerson: Object.freeze({ headsUpMs: 30000, nudgeMs: 20000, insistMs: 10000, takeoverMs: 5000 }),
    headsUpDisplayMs: 5000,
    snoozeMs: 5000,
    takeoverSnoozeMs: 5000,
    cutoffMs: 60000,
});

/**
 * A test-alert meeting starting 30 s from `now`, and the timing to plan it with.
 *
 * @param {number} now
 * @returns {{judged: ReadonlyArray<import('./types.js').JudgedOccurrence>, timing: import('./types.js').Timing}}
 */
export function testAlert(now) {
    const start = now + 30000;
    const judged = Object.freeze({
        key: 'test:' + now,
        seriesKey: 'test-series',
        recurring: false,
        title: 'payAttention test alert',
        start,
        end: start + 60000,
        allDay: false,
        verdict: 'must',
        reason: 'test alert',
        reasonCode: 'test',
        verdictOverridden: false,
        mode: 'online',
        modeOverridden: false,
        joinUrl: null,
        placeText: '',
        placeKey: null,
        travelMinutes: null,
        travelIsDefault: false,
        travelTarget: null,
        deadline: start,
    });
    return Object.freeze({ judged: Object.freeze([judged]), timing: TEST_ALERT_TIMING });
}
