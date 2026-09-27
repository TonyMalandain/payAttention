// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The owner's recorded actions per occurrence (data.md "Alert state") and the
// reducer that updates them. Pure: `now` is always a parameter.
import { occurrenceKeyTime, isExpiredOccurrenceKey } from './keys.js';

const DONE_VALUES = [null, 'ack', 'skip'];
const ACTION_TYPES = ['ack', 'skip', 'snooze', 'headsUpShown', 'prune'];

const isPlainObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = v => typeof v === 'number' && Number.isFinite(v);
const isFiniteOrNull = v => v === null || isFiniteNumber(v);

function freezeState(items) {
    return Object.freeze({ v: 1, items: Object.freeze(items) });
}

function withItem(state, key, item) {
    return freezeState({ ...state.items, [key]: Object.freeze(item) });
}

/**
 * State with nothing recorded.
 *
 * @returns {import('./types.js').AlertState} frozen
 */
export function emptyAlertState() {
    return freezeState({});
}

function validItem(item) {
    if (!isPlainObject(item) || !isFiniteNumber(item.start) || !DONE_VALUES.includes(item.done) ||
        !isFiniteOrNull(item.doneAt) || !isFiniteOrNull(item.snoozeUntil) || !isFiniteOrNull(item.headsUpShownAt))
        return null;
    const { start, done, doneAt, snoozeUntil, headsUpShownAt } = item;
    return Object.freeze({ start, done, doneAt, snoozeUntil, headsUpShownAt });
}

/**
 * Read the stored alert state. Anything unreadable gives the empty state, and
 * an invalid item is dropped on its own, so a corrupt value never stops alerts.
 * Never throws.
 *
 * @param {string|null|undefined} text
 * @returns {import('./types.js').AlertState} frozen
 */
export function parseAlertState(text) {
    if (typeof text !== 'string' || text === '')
        return emptyAlertState();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        // Corrupt stored value: start again from nothing rather than fail.
        return emptyAlertState();
    }
    if (!isPlainObject(parsed) || parsed.v !== 1 || !isPlainObject(parsed.items))
        return emptyAlertState();
    const items = {};
    for (const [key, raw] of Object.entries(parsed.items)) {
        const item = validItem(raw);
        if (item !== null)
            items[key] = item;
    }
    return freezeState(items);
}

/**
 * The stored form of the alert state.
 *
 * @param {import('./types.js').AlertState} state
 * @returns {string}
 */
export function serializeAlertState(state) {
    return JSON.stringify(state);
}

function checkAction(action) {
    if (!isPlainObject(action) || !ACTION_TYPES.includes(action.type))
        throw new TypeError('reduce: unknown action type');
    if (action.type === 'prune')
        return;
    if (typeof action.key !== 'string' || action.key === '')
        throw new TypeError(`reduce: ${action.type} needs a non-empty key`);
    if (!isFiniteNumber(action.start))
        throw new TypeError(`reduce: ${action.type} needs a finite start`);
    if (action.type === 'snooze' && !isFiniteNumber(action.until))
        throw new TypeError('reduce: snooze needs a finite until');
}

function prune(state, now) {
    const items = {};
    for (const [key, item] of Object.entries(state.items)) {
        if (occurrenceKeyTime(key) !== null && !isExpiredOccurrenceKey(key, now))
            items[key] = item;
    }
    return freezeState(items);
}

/**
 * Apply one owner action (or a prune) to the alert state. Returns the same
 * state object when the action changes nothing.
 *
 * @param {import('./types.js').AlertState} state not mutated
 * @param {import('./types.js').AlertAction} action build per-occurrence actions with plan.js actionFor()
 * @param {number} now
 * @returns {import('./types.js').AlertState} frozen
 * @throws {TypeError} on an unknown action type, or a missing key, start or until
 */
export function reduce(state, action, now) {
    checkAction(action);
    if (action.type === 'prune')
        return prune(state, now);

    const { key, start } = action;
    const existing = Object.hasOwn(state.items, key) ? state.items[key] : undefined;
    // An item recorded for another start belongs to the meeting before it moved.
    const prev = existing?.start === start ? existing : undefined;
    const base = prev ?? { start, done: null, doneAt: null, snoozeUntil: null, headsUpShownAt: null };

    switch (action.type) {
    case 'ack':
    case 'skip':
        return withItem(state, key, { ...base, done: action.type, doneAt: now, snoozeUntil: null });
    case 'snooze':
        if (action.until <= now || base.done !== null)
            return state;
        return withItem(state, key, { ...base, snoozeUntil: action.until });
    case 'headsUpShown':
        if (base.headsUpShownAt !== null || base.done !== null)
            return state;
        return withItem(state, key, { ...base, headsUpShownAt: now });
    }
    throw new TypeError('reduce: unknown action type');
}
