// The identity of one question (interfaces.md §6.2): a changed invite, engine or
// prompt must change it, so the meeting is asked again.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hash53, fingerprint } from '../../extension/core/fingerprint.js';
import { PROMPT_VERSION } from '../../extension/core/aiPrompt.js';
import { buildInvite } from '../../extension/core/invite.js';
import { ownerIdentity } from '../../extension/core/owner.js';
import { CONFIG, OWNER, att, event, snapshot } from './support/builders.js';

const IDENT = ownerIdentity(snapshot([event()]), CONFIG);
const TAG = 'http://127.0.0.1:11434/v1|m';
const INV = buildInvite(event({ description: 'Join https://meet.google.com/abc-defg-hij', recurring: true }),
    IDENT, 'Work', -240);

describe('hash53', () => {
    test('the cyrb53 vectors', () => {
        assert.equal(hash53(''), '0bdcb81aee8d83');
        assert.equal(hash53('a'), '1c2ba782c97901');
        assert.equal(hash53('payAttention'), '13284f83f114ec');
    });
});

describe('fingerprint', () => {
    test('is hash53 of [PROMPT_VERSION, engineTag, invite]', () => {
        assert.equal(fingerprint(TAG, INV), hash53(JSON.stringify([PROMPT_VERSION, TAG, INV])));
    });

    test('14 lowercase hex characters', () => {
        assert.match(fingerprint(TAG, INV), /^[0-9a-f]{14}$/);
    });

    const mutations = {
        title: i => ({ ...i, title: i.title + 'x' }),
        calendar: i => ({ ...i, calendar: 'Family' }),
        start: i => ({ ...i, start: '2026-09-28 Mon 10:01' }),
        minutes: i => ({ ...i, minutes: i.minutes + 1 }),
        allDay: i => ({ ...i, allDay: !i.allDay }),
        recurring: i => ({ ...i, recurring: !i.recurring }),
        status: i => ({ ...i, status: 'tentative' }),
        busy: i => ({ ...i, busy: 'free' }),
        description: i => ({ ...i, description: i.description + '.' }),
        place: i => ({ ...i, place: 'Room 4' }),
        videoLink: i => ({ ...i, videoLink: null }),
        you: i => ({ ...i, you: { ...i.you, response: 'tentative' } }),
        organiser: i => ({ ...i, organiser: { ...i.organiser, email: 'x@acme.test' } }),
        guests: i => ({ ...i, guests: [{ ...i.guests[0], response: 'declined' }, ...i.guests.slice(1)] }),
        guestsTotal: i => ({ ...i, guestsTotal: i.guestsTotal + 1 }),
    };
    for (const [key, mutate] of Object.entries(mutations)) {
        test(`a change to ${key} changes it`, () => {
            assert.notEqual(fingerprint(TAG, mutate(INV)), fingerprint(TAG, INV));
        });
    }

    test('every invite field has a mutation above', () => {
        assert.deepEqual(Object.keys(mutations), Object.keys(INV));
    });

    test('a different endpoint or model changes it', () => {
        assert.notEqual(fingerprint('http://127.0.0.1:11434/v1|m2', INV), fingerprint(TAG, INV));
        assert.notEqual(fingerprint('https://api.example.test/v1|m', INV), fingerprint(TAG, INV));
    });

    test('text past the description cap does not change it', () => {
        const base = 'd'.repeat(1500);
        const a = buildInvite(event({ description: base + 'AAAA' }), IDENT, 'Work', 0);
        const b = buildInvite(event({ description: base + 'BBBB' }), IDENT, 'Work', 0);
        assert.equal(fingerprint(TAG, a), fingerprint(TAG, b));
    });

    test('a renamed calendar changes it (D-024)', () => {
        const ev = event({ attendees: [att(OWNER), att('alice@acme.test')] });
        assert.notEqual(fingerprint(TAG, buildInvite(ev, IDENT, 'Work', 0)),
            fingerprint(TAG, buildInvite(ev, IDENT, 'Work (old)', 0)));
    });
});
