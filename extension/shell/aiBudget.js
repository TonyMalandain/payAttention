// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The rolling AI request budget per engine (constraints.md), in memory: a lock
// resets it, and stored answers make that harmless. Gi-free, so Node tests it.

export const AI_REQUESTS_PER_HOUR = 120;
export const AI_REQUESTS_PER_DAY = 1000;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The rolling request budget per engine (constraints.md), in memory. */
export class RequestBudget {
    /** Nothing spent. */
    constructor() {
        // engineTag → spend times, ascending
        this._spends = new Map();
    }

    /**
     * Spend one request for this engine at `now` when both rolling windows allow it.
     * A spend at time t counts in the hour window while t > now − 3 600 000, and in the
     * day window while t > now − 86 400 000. Spends older than 24 h are forgotten on each call.
     *
     * @param {string} engineTag
     * @param {number} now epoch ms
     * @returns {boolean} true when spent (the request may be sent); false when over budget, and nothing is spent
     */
    trySpend(engineTag, now) {
        const times = (this._spends.get(engineTag) ?? []).filter(t => t > now - DAY_MS);
        this._spends.set(engineTag, times);
        const inHour = times.filter(t => t > now - HOUR_MS).length;
        if (inHour >= AI_REQUESTS_PER_HOUR || times.length >= AI_REQUESTS_PER_DAY)
            return false;
        let i = times.length;
        while (i > 0 && times[i - 1] > now)
            i--;
        times.splice(i, 0, now);
        return true;
    }

    /**
     * Give back the one spend recorded for this engine at exactly `sentAt`, for an
     * ask that did not reach the engine (interfaces.md §6.5). Removes at most one
     * spend; does nothing when there is none at `sentAt` for that engine.
     *
     * @param {string} engineTag
     * @param {number} sentAt epoch ms, the ask's token.sentAt
     */
    refund(engineTag, sentAt) {
        const times = this._spends.get(engineTag);
        const i = times ? times.indexOf(sentAt) : -1;
        if (i >= 0)
            times.splice(i, 1);
    }
}
