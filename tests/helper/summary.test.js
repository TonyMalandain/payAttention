// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatSummary } from '../../extension/helper/summary.js';

const HOUR = 3_600_000;
const G = Date.UTC(2026, 8, 28, 8, 0, 0);

function dto(over = {}) {
    return Object.assign({
        sourceUid: 'work-src', uid: 'u', recurrenceId: null, recurring: false,
        start: G, end: G + HOUR, allDay: false,
        summary: '', location: '', description: '', conferenceUris: [],
        status: 'none', transparency: 'unknown', organizer: null, attendees: [],
    }, over);
}

function att(email, cutype) {
    return { email, name: email.split('@')[0], partstat: 'accepted', cutype, role: 'req-participant' };
}

const SNAPSHOT = {
    type: 'snapshot', protocol: 1, generatedAt: G, rangeStart: G - HOUR, rangeEnd: G + 36 * HOUR,
    sources: [
        { uid: 'work-src', name: 'Secret Work Calendar', backend: 'caldav', ownerEmail: 'me@corp.test', ok: true, error: null, remote: false, connection: null },
        { uid: 'other-src', name: 'Other', backend: 'caldav', ownerEmail: null, ok: false, error: 'connect-timeout', remote: null, connection: null },
    ],
    events: [
        dto({
            uid: 'weekly-board@corp.test', recurrenceId: G + HOUR, recurring: true, start: G + HOUR, end: G + 2 * HOUR,
            summary: 'Board review', status: 'confirmed', transparency: 'opaque',
            conferenceUris: ['https://meet.corp.test/board'],
            organizer: { email: 'alice@corp.test', name: 'Alice Boss' },
            attendees: [att('me@corp.test', 'individual'), att('alice@corp.test', 'individual'), att('boardroom@corp.test', 'room')],
        }),
        dto({
            uid: 'holiday@corp.test', allDay: true, start: G + 30 * HOUR, end: G + 54 * HOUR,
            summary: 'Bastille Day', transparency: 'transparent',
        }),
        dto({
            uid: 'cancelled@corp.test', start: G + 3 * HOUR, end: G + 4 * HOUR,
            summary: 'Dentist', status: 'cancelled', description: 'Bring the x-rays', location: '5 Harley Street',
        }),
    ],
};

describe('counts-only summary', () => {
    test('a 2-source, 3-event snapshot gives the exact 7-line text', () => {
        assert.equal(formatSummary(SNAPSHOT), [
            'payattention-helper summary (counts only)',
            'protocol 1',
            'sources 2 ok 1 failed 1 with-owner-address 1',
            'source-errors connect-timeout 1',
            'occurrences 3 recurring 1 all-day 1 cancelled 1 tentative 0 with-attendees 1 with-organizer 1 ' +
                'with-conference-uri 1 with-location 1 with-description 1 transparent 1',
            'next-24h 2',
            'attendees 3 individual 2 group 0 resource 0 room 1 unknown 0',
            '',
        ].join('\n'));
    });

    test('the summary carries no calendar content', () => {
        const text = formatSummary(SNAPSHOT);
        for (const secret of ['Board review', 'Bastille', 'Dentist', 'x-rays', 'Harley', 'corp.test', 'Alice',
            'boardroom', 'Secret Work Calendar', 'Other', 'work-src', 'weekly-board', 'meet.']) {
            assert.equal(text.includes(secret), false, `summary leaks ${JSON.stringify(secret)}`);
        }
    });

    test('no source errors gives "none"', () => {
        const snap = { ...SNAPSHOT, sources: [SNAPSHOT.sources[0]], events: [] };
        assert.match(formatSummary(snap), /^source-errors none$/m);
    });

    test('source error codes are sorted and counted', () => {
        const failed = (uid, error) => ({ uid, name: '', backend: '', ownerEmail: null, ok: false, error, remote: null, connection: null });
        const snap = {
            ...SNAPSHOT, events: [],
            sources: [failed('a', 'read-failed'), failed('b', 'connect-failed'), failed('c', 'read-failed')],
        };
        assert.match(formatSummary(snap), /^source-errors connect-failed 1 read-failed 2$/m);
    });

    test('an event that ended exactly at generatedAt is not in the next 24 h, one starting at +24 h is not either', () => {
        const snap = {
            ...SNAPSHOT,
            events: [dto({ start: G - HOUR, end: G }), dto({ start: G + 24 * HOUR, end: G + 25 * HOUR }), dto({ start: G - 1, end: G + 1 })],
        };
        assert.match(formatSummary(snap), /^next-24h 1$/m);
    });
});
