// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The snapshot range and the protocol's overlap rule. Pure: the clock is a
// parameter, so nothing here reads time.

/** How far before now a snapshot reaches (constraints.md: [now − 1 h, now + 36 h)). */
export const RANGE_BEFORE_MS = 3_600_000;
/** How far after now a snapshot reaches. */
export const RANGE_AFTER_MS = 129_600_000;

/**
 * The snapshot range around a moment.
 *
 * @param {number} nowMs epoch ms
 * @returns {{rangeStart:number, rangeEnd:number}}
 */
export function snapshotRange(nowMs) {
    return { rangeStart: nowMs - RANGE_BEFORE_MS, rangeEnd: nowMs + RANGE_AFTER_MS };
}

/**
 * Protocol rule "occurrences overlapping [rangeStart, rangeEnd)". A zero-length
 * occurrence at t overlaps when rangeStart <= t < rangeEnd.
 *
 * @param {number} start
 * @param {number} end
 * @param {number} rangeStart
 * @param {number} rangeEnd
 * @returns {boolean}
 */
export function overlapsRange(start, end, rangeStart, rangeEnd) {
    if (start === end)
        return rangeStart <= start && start < rangeEnd;
    return start < rangeEnd && end > rangeStart;
}
