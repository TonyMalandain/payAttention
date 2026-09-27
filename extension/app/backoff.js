// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// How long to wait before restarting the calendar helper. Pure.

export const FIRST_DELAY_MS = 1000;
export const MAX_DELAY_MS = 300_000;
/** A helper that ran this long was healthy: the next restart starts over at FIRST_DELAY_MS. */
export const HEALTHY_RESET_MS = 600_000;

/**
 * Delay before the next helper start.
 *
 * @param {number|null} previousDelayMs null for the first restart
 * @param {number} ranForMs how long the helper that just exited ran
 * @returns {number}
 */
export function nextRestartDelayMs(previousDelayMs, ranForMs) {
    if (ranForMs >= HEALTHY_RESET_MS || previousDelayMs === null)
        return FIRST_DELAY_MS;
    return Math.min(previousDelayMs * 2, MAX_DELAY_MS);
}
