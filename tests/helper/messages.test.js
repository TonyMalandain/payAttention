// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateHelperMessage } from '../../extension/core/protocol.js';
import {
    helloMessage, snapshotMessage, statusMessage, STATUS_CODES, SOURCE_ERRORS,
} from '../../extension/helper/messages.js';

/** A valid OccurrenceDTO with `over` applied. */
function dto(over = {}) {
    return Object.assign({
        sourceUid: 's', uid: 'u', recurrenceId: null, recurring: false,
        start: 1, end: 2, allDay: false,
        summary: '', location: '', description: '', conferenceUris: [],
        status: 'none', transparency: 'unknown', organizer: null, attendees: [],
    }, over);
}

function source(uid, over = {}) {
    return Object.assign({ uid, name: '', backend: 'local', ownerEmail: null, ok: true, error: null, remote: false, connection: null }, over);
}

function deepFreeze(o) {
    if (typeof o === 'object' && o !== null) {
        for (const v of Object.values(o))
            deepFreeze(v);
        Object.freeze(o);
    }
    return o;
}

const key = e => [e.start, e.sourceUid, e.uid, e.recurrenceId];

describe('helper messages', () => {
    test('hello is the protocol-1 hello and validates', () => {
        assert.deepEqual(helloMessage(), { type: 'hello', protocol: 1 });
        assert.equal(validateHelperMessage(helloMessage()).ok, true);
    });

    test('a snapshot carries its fields, protocol 1, and validates', () => {
        const msg = snapshotMessage({ generatedAt: 10, rangeStart: 0, rangeEnd: 20, sources: [source('a')], events: [dto()] });
        assert.deepEqual(msg, {
            type: 'snapshot', protocol: 1, generatedAt: 10, rangeStart: 0, rangeEnd: 20,
            sources: [source('a')], events: [dto()],
        });
        assert.equal(validateHelperMessage(msg).ok, true);
    });

    test('sources come out sorted by uid, with their fields unchanged', () => {
        const b = source('b', { backend: 'caldav', remote: true, connection: 'connected' });
        const a = source('a');
        const msg = snapshotMessage({ generatedAt: 0, rangeStart: 0, rangeEnd: 1, sources: [b, a], events: [] });
        assert.deepEqual(msg.sources, [source('a'), source('b', { backend: 'caldav', remote: true, connection: 'connected' })]);
        assert.equal(validateHelperMessage(msg).ok, true);
    });

    test('events come out by start, then sourceUid, uid, recurrenceId with null first', () => {
        const events = [
            dto({ start: 2, sourceUid: 's', uid: 'u', recurrenceId: null }),
            dto({ start: 1, sourceUid: 't', uid: 'u', recurrenceId: null }),
            dto({ start: 1, sourceUid: 's', uid: 'v', recurrenceId: null }),
            dto({ start: 1, sourceUid: 's', uid: 'u', recurrenceId: 5 }),
            dto({ start: 1, sourceUid: 's', uid: 'u', recurrenceId: null }),
        ];
        const msg = snapshotMessage({ generatedAt: 0, rangeStart: 0, rangeEnd: 10, sources: [], events });
        assert.deepEqual(msg.events.map(key), [
            [1, 's', 'u', null], [1, 's', 'u', 5], [1, 's', 'v', null], [1, 't', 'u', null], [2, 's', 'u', null],
        ]);
        assert.equal(validateHelperMessage(msg).ok, true);
    });

    test('the inputs are not mutated (deep-frozen inputs do not throw)', () => {
        const sources = deepFreeze([source('b'), source('a')]);
        const events = deepFreeze([dto({ start: 2 }), dto({ start: 1 })]);
        const msg = snapshotMessage({ generatedAt: 0, rangeStart: 0, rangeEnd: 10, sources, events });
        assert.deepEqual(sources.map(s => s.uid), ['b', 'a']);
        assert.deepEqual(events.map(e => e.start), [2, 1]);
        assert.notEqual(msg.events, events);
        assert.notEqual(msg.sources, sources);
    });

    test('a status with a listed level and code validates', () => {
        const msg = statusMessage('warn', 'bad-command');
        assert.deepEqual(msg, { type: 'status', level: 'warn', code: 'bad-command' });
        assert.equal(validateHelperMessage(msg).ok, true);
    });

    test('every listed status code is accepted at both levels', () => {
        for (const code of Object.values(STATUS_CODES)) {
            assert.equal(validateHelperMessage(statusMessage('warn', code)).ok, true);
            assert.equal(validateHelperMessage(statusMessage('error', code)).ok, true);
        }
    });

    test('a status with an unknown level throws TypeError', () => {
        assert.throws(() => statusMessage('info', 'bad-command'), TypeError);
    });

    test('a free-text status code throws TypeError', () => {
        assert.throws(() => statusMessage('warn', 'Tokyo sync'), TypeError);
    });

    test('a well-formed but unlisted status code throws TypeError', () => {
        assert.throws(() => statusMessage('warn', 'something-else'), TypeError);
    });

    test('the code lists are frozen', () => {
        assert.ok(Object.isFrozen(STATUS_CODES));
        assert.ok(Object.isFrozen(SOURCE_ERRORS));
        assert.deepEqual(Object.values(SOURCE_ERRORS).sort(), ['connect-failed', 'connect-timeout', 'read-failed']);
    });
});
