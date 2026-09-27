// The owner's own answer and the guest records (interfaces.md §6.2, D-011).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PERSON_CUTYPES, ownerIdentity, ownerResponse, guestAttendees } from '../../extension/core/owner.js';
import { CONFIG, OWNER, att, event, snapshot } from './support/builders.js';

const IDENT = ownerIdentity(snapshot([event()]), CONFIG);

describe('ownerResponse', () => {
    for (const p of ['accepted', 'tentative', 'needs-action', 'delegated', 'other', 'declined']) {
        test(`${p} comes back raw`, () => {
            assert.equal(ownerResponse(event({ attendees: [att(OWNER, p), att('alice@acme.test')] }), IDENT), p);
        });
    }

    test('accepted beats declined when the owner has two entries', () => {
        const ev = event({ attendees: [att(OWNER, 'declined'), att(' MAILTO:Me@Acme.test ', 'accepted')] });
        assert.equal(ownerResponse(ev, IDENT), 'accepted');
    });

    test('no owner entry gives unknown', () => {
        assert.equal(ownerResponse(event({ attendees: [att('alice@acme.test')] }), IDENT), 'unknown');
    });

    test('the owner as organiser with no attendee entry gives unknown', () => {
        const ev = event({ organizer: { email: OWNER, name: 'me' }, attendees: [att('alice@acme.test')] });
        assert.equal(ownerResponse(ev, IDENT), 'unknown');
    });
});

describe('guestAttendees', () => {
    test('excludes the owner (any case, mailto:), rooms and resources; keeps groups and unknowns', () => {
        const ev = event({
            attendees: [
                att('MAILTO:ME@ACME.TEST'),
                att('alice@acme.test'),
                att('room4@acme.test', 'accepted', 'room'),
                att('projector@acme.test', 'accepted', 'resource'),
                att('team@acme.test', 'needs-action', 'group'),
                att('x@acme.test', 'accepted', 'unknown'),
            ],
        });
        assert.deepEqual(guestAttendees(ev, IDENT).map(a => a.email),
            ['alice@acme.test', 'team@acme.test', 'x@acme.test']);
    });

    test('keeps DTO order and drops a repeated address', () => {
        const ev = event({ attendees: [att('bob@acme.test'), att('alice@acme.test'), att(' Bob@Acme.test ')] });
        assert.deepEqual(guestAttendees(ev, IDENT).map(a => a.email), ['bob@acme.test', 'alice@acme.test']);
    });

    test('does not add the organiser', () => {
        const ev = event({ organizer: { email: 'carol@acme.test', name: 'carol' }, attendees: [att(OWNER)] });
        assert.deepEqual(guestAttendees(ev, IDENT), []);
    });

    test('returns the same record objects', () => {
        const ev = event();
        const g = guestAttendees(ev, IDENT);
        assert.equal(g[0], ev.attendees[1]);
        assert.equal(g[1], ev.attendees[2]);
    });

    test('an attendee with an empty address is kept, each time', () => {
        const ev = event({ attendees: [att(''), att('')] });
        assert.equal(guestAttendees(ev, IDENT).length, 2);
    });
});

test('PERSON_CUTYPES is frozen', () => {
    assert.deepEqual(PERSON_CUTYPES, ['individual', 'unknown', 'group']);
    assert.ok(Object.isFrozen(PERSON_CUTYPES));
});
