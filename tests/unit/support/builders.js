// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test factories. Not a test file. Tests never read the clock: T0 is the fixed base.
import { DEFAULT_SETTINGS } from '../../../extension/core/defaults.js';
import { timingFromSettings } from '../../../extension/core/timing.js';
import { judge } from '../../../extension/core/judge.js';

export const MIN = 60_000, HOUR = 3_600_000;
export const T0 = Date.UTC(2026, 8, 28, 14, 0, 0);
export const OWNER = 'me@acme.test';
export const SOURCE = { uid: 'src-1', name: 'Work', backend: 'caldav', ownerEmail: OWNER, ok: true, error: null };

/** An attendee; the name is the email's local part. */
export function att(email, partstat = 'accepted', cutype = 'individual', role = 'req-participant') {
    return { email, name: email.split('@')[0], partstat, cutype, role };
}

/** A 2-guest meeting the owner accepted (judges to small / must), with `over` applied. */
export function event(over = {}) {
    return Object.assign({
        sourceUid: 'src-1', uid: 'evt-1', recurrenceId: null, recurring: false,
        start: T0, end: T0 + 30 * MIN, allDay: false,
        summary: 'Sync', location: '', description: '', conferenceUris: [],
        status: 'confirmed', transparency: 'opaque',
        organizer: { email: 'alice@acme.test', name: 'alice' },
        attendees: [att(OWNER), att('alice@acme.test'), att('bob@acme.test')],
    }, over);
}

export function snapshot(events, sources = [SOURCE]) {
    return {
        type: 'snapshot', protocol: 1, generatedAt: T0 - HOUR,
        rangeStart: T0 - 2 * HOUR, rangeEnd: T0 + 36 * HOUR, sources, events,
    };
}

export const CONFIG = DEFAULT_SETTINGS;
export const NO_OVERRIDES = { verdict: {}, mode: {} };
export const NO_TRAVEL = Object.freeze({ byPlace: Object.freeze({}), byMeeting: Object.freeze({}) });

/** Judge one event and return its single result. */
export function judgeOne(ev, { config = CONFIG, overrides = NO_OVERRIDES, travel = NO_TRAVEL, sources = [SOURCE] } = {}) {
    return judge(snapshot([ev], sources), config, overrides, travel)[0];
}

/** A complete must-attend online JudgedOccurrence with deadline T0, with `over` applied. */
export function judged(over = {}) {
    return Object.assign({
        key: 'occ:j1|' + T0, seriesKey: 'series:j1', recurring: false, title: 'Client sync',
        start: T0, end: T0 + 30 * MIN, allDay: false,
        verdict: 'must', reason: 'x', reasonCode: 'small', verdictOverridden: false,
        mode: 'online', modeOverridden: false, joinUrl: null,
        placeText: '', placeKey: null, travelMinutes: null, travelIsDefault: false, travelTarget: null,
        deadline: T0,
    }, over);
}

/** Recursive Object.freeze, used to prove that core does not mutate its inputs. */
export function deepFreeze(o) {
    if (typeof o === 'object' && o !== null) {
        for (const v of Object.values(o))
            deepFreeze(v);
        Object.freeze(o);
    }
    return o;
}

export const TIMING = timingFromSettings(DEFAULT_SETTINGS);
export const ENV = { userActive: true, dataHealthy: true, heldHeadsUpKey: null };
