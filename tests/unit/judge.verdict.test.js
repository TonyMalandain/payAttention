// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_IGNORE_WORDS, BUILTIN_IMPORTANT_WORDS } from '../../extension/core/words.js';
import { REASON_CODES, aiVerdict } from '../../extension/core/verdict.js';
import { T0, OWNER, SOURCE, CONFIG, att, event, judgeOne } from './support/builders.js';

const sKey = 'series:evt-1';
const oKey = 'occ:evt-1|' + T0;
const ME_ORGANISER = { email: OWNER, name: 'me' };
const ALICE_ORGANISER = { email: 'alice@acme.test', name: 'alice' };

function expectVerdict(result, verdict, reasonCode, reason) {
    assert.equal(result.verdict, verdict);
    assert.equal(result.reasonCode, reasonCode);
    if (reason !== undefined)
        assert.equal(result.reason, reason);
}

/** `n` guests at acme.test, named g1… */
function guests(n, domain = 'acme.test') {
    return Array.from({ length: n }, (_, i) => att(`g${i + 1}@${domain}`));
}

const SMALL_2 = 'small meeting (2 guests): absence noticed';
const SMALL_1 = 'small meeting (1 guest): absence noticed';
const INSUFFICIENT = 'not enough information: treated as must-attend';

describe('verdict: overrides (PRD §1 rule 1)', () => {
    test('an occurrence override to must-attend wins over a placeholder title', () => {
        const r = judgeOne(event({ summary: 'Lunch' }), { overrides: { verdict: { [oKey]: 'must' }, mode: {} } });
        expectVerdict(r, 'must', 'override-must', 'you marked this must-attend');
        assert.equal(r.verdictOverridden, true);
    });

    test('a series override to ignore applies to an instance', () => {
        const r = judgeOne(event({ recurring: true, recurrenceId: T0 }),
            { overrides: { verdict: { [sKey]: 'ignore' }, mode: {} } });
        expectVerdict(r, 'ignore', 'override-ignore', 'you marked this ignore');
        assert.equal(r.verdictOverridden, true);
    });

    test('the occurrence override wins over the series override', () => {
        const r = judgeOne(event(), { overrides: { verdict: { [oKey]: 'must', [sKey]: 'ignore' }, mode: {} } });
        expectVerdict(r, 'must', 'override-must');
    });

    test('an override wins over cancelled', () => {
        const r = judgeOne(event({ status: 'cancelled' }), { overrides: { verdict: { [oKey]: 'must' }, mode: {} } });
        expectVerdict(r, 'must', 'override-must');
    });

    test('an invalid override value is ignored', () => {
        const r = judgeOne(event(), { overrides: { verdict: { [oKey]: 'maybe' }, mode: {} } });
        expectVerdict(r, 'must', 'small');
        assert.equal(r.verdictOverridden, false);
    });
});

describe('verdict: ignorable and certain (PRD §1 rule 2)', () => {
    test('a cancelled meeting is ignorable', () => {
        expectVerdict(judgeOne(event({ status: 'cancelled' })), 'ignore', 'cancelled', 'cancelled');
    });

    test('a meeting the owner declined is ignorable', () => {
        const r = judgeOne(event({ attendees: [att(OWNER, 'declined'), att('alice@acme.test'), att('bob@acme.test')] }));
        expectVerdict(r, 'ignore', 'declined', 'you declined');
    });

    test('a meeting without the owner is not invited (D-009)', () => {
        const r = judgeOne(event({ attendees: [att('alice@acme.test'), att('bob@acme.test')] }));
        expectVerdict(r, 'ignore', 'not-invited', "not invited: someone else's meeting");
    });

    test('an extra owner address from settings counts as the owner', () => {
        const ev = event({ attendees: [att('me@home.test'), att('alice@acme.test'), att('bob@acme.test')] });
        expectVerdict(judgeOne(ev, { config: { ...CONFIG, extraOwnerAddresses: ['ME@home.test '] } }), 'must', 'small');
        expectVerdict(judgeOne(ev), 'ignore', 'not-invited');
    });

    test('owner addresses come from every source, not only the event\'s own', () => {
        const shared = { uid: 'src-2', name: 'Shared', backend: 'caldav', ownerEmail: null, ok: true, error: null };
        const r = judgeOne(event({ sourceUid: 'src-2' }), { sources: [SOURCE, shared] });
        expectVerdict(r, 'must', 'small');
    });

    test('an all-day event is ignorable', () => {
        expectVerdict(judgeOne(event({ allDay: true })), 'ignore', 'all-day', 'all-day event');
    });

    test('an event with no start time is ignorable and has no deadline', () => {
        const r = judgeOne(event({ start: null }));
        expectVerdict(r, 'ignore', 'all-day', 'all-day event');
        assert.equal(r.deadline, null);
    });

    test('an event marked free is ignorable', () => {
        expectVerdict(judgeOne(event({ transparency: 'transparent' })), 'ignore', 'free', 'marked as free time');
    });

    for (const w of BUILTIN_IGNORE_WORDS) {
        test(`the built-in ignore word '${w}' marks a placeholder`, () => {
            expectVerdict(judgeOne(event({ summary: w.toUpperCase() })), 'ignore', 'ignore-word', `placeholder: '${w}'`);
        });
    }

    test('an extra ignore word from settings marks a placeholder', () => {
        const r = judgeOne(event({ summary: 'Daily standup' }), { config: { ...CONFIG, extraIgnoreWords: ['Standup'] } });
        expectVerdict(r, 'ignore', 'ignore-word', "placeholder: 'standup'");
    });
});

describe('verdict: must-attend and strong (PRD §1 rule 3)', () => {
    for (const w of BUILTIN_IMPORTANT_WORDS) {
        test(`the built-in important word '${w}' makes a personal block must-attend`, () => {
            const r = judgeOne(event({ summary: 'Re: ' + w.toUpperCase(), organizer: ME_ORGANISER, attendees: [att(OWNER)] }));
            expectVerdict(r, 'must', 'important-word', `important: '${w}'`);
        });
    }

    test('an extra important word from settings makes a personal block must-attend', () => {
        const r = judgeOne(event({ summary: 'Launch prep', organizer: ME_ORGANISER, attendees: [att(OWNER)] }),
            { config: { ...CONFIG, extraImportantWords: ['Launch'] } });
        expectVerdict(r, 'must', 'important-word', "important: 'launch'");
    });

    test('an ignore word wins over an important word', () => {
        expectVerdict(judgeOne(event({ summary: 'Client lunch' })), 'ignore', 'ignore-word', "placeholder: 'lunch'");
    });

    test('the owner organised it with 1 guest: singular reason', () => {
        const r = judgeOne(event({ organizer: ME_ORGANISER, attendees: [att(OWNER), att('alice@acme.test')] }));
        expectVerdict(r, 'must', 'organizer', 'you organised it, 1 guest');
    });

    test('the owner organised it with 3 guests', () => {
        const r = judgeOne(event({ organizer: ME_ORGANISER, attendees: [att(OWNER), ...guests(3)] }));
        expectVerdict(r, 'must', 'organizer', 'you organised it, 3 guests');
    });

    test('the owner organised it with 20 guests: organiser, not large', () => {
        const r = judgeOne(event({ organizer: ME_ORGANISER, attendees: [att(OWNER), ...guests(20)] }));
        expectVerdict(r, 'must', 'organizer', 'you organised it, 20 guests');
    });

    test('rooms and resources are not guests (D-011)', () => {
        const r = judgeOne(event({
            organizer: ME_ORGANISER,
            attendees: [att(OWNER), att('room-4@resource.test', 'accepted', 'room'),
                att('beamer@resource.test', 'accepted', 'resource')],
        }));
        expectVerdict(r, 'ignore', 'no-guests', 'no other guests: personal block');
    });

    test('an external guest, owner has not answered: must-attend', () => {
        const r = judgeOne(event({
            organizer: ALICE_ORGANISER, attendees: [att(OWNER, 'needs-action'), att('carol@partner.test')],
        }));
        expectVerdict(r, 'must', 'external', 'external guests');
    });

    test('an external guest, owner accepted: must-attend', () => {
        const r = judgeOne(event({ organizer: ALICE_ORGANISER, attendees: [att(OWNER), att('carol@partner.test')] }));
        expectVerdict(r, 'must', 'external', 'external guests');
    });

    test('an external guest, owner answered maybe: ignorable', () => {
        const r = judgeOne(event({
            organizer: ALICE_ORGANISER, attendees: [att(OWNER, 'tentative'), att('carol@partner.test')],
        }));
        expectVerdict(r, 'ignore', 'maybe', 'you answered maybe');
    });

    test('owner domains from settings make a partner domain internal', () => {
        const r = judgeOne(event({ attendees: [att(OWNER), att('alice@acme.test'), att('carol@partner.test')] }),
            { config: { ...CONFIG, ownerDomains: ['acme.test', '@Partner.test'] } });
        expectVerdict(r, 'must', 'small', SMALL_2);
    });

    test('a room at another domain is not an external guest', () => {
        const r = judgeOne(event({
            attendees: [att(OWNER), att('alice@acme.test'), att('bob@acme.test'), att('hall@venue.test', 'accepted', 'room')],
        }));
        expectVerdict(r, 'must', 'small', SMALL_2);
    });
});

describe('verdict: ignorable and weaker (PRD §1 rule 4)', () => {
    test('no other guests is a personal block', () => {
        expectVerdict(judgeOne(event({ organizer: ME_ORGANISER, attendees: [att(OWNER)] })),
            'ignore', 'no-guests', 'no other guests: personal block');
        expectVerdict(judgeOne(event({ organizer: null, attendees: [] })),
            'ignore', 'no-guests', 'no other guests: personal block');
    });

    test('16 guests the owner did not organise is a large meeting', () => {
        const r = judgeOne(event({ attendees: [att(OWNER), att('alice@acme.test'), ...guests(15)] }));
        expectVerdict(r, 'ignore', 'large', 'large meeting (16 guests): absence unlikely noticed');
    });

    test('exactly the large-meeting size is still small', () => {
        const r = judgeOne(event({ attendees: [att(OWNER), att('alice@acme.test'), ...guests(14)] }));
        expectVerdict(r, 'must', 'small', 'small meeting (15 guests): absence noticed');
    });

    test('the large-meeting size is a setting', () => {
        const r = judgeOne(event({ attendees: [att(OWNER), att('alice@acme.test'), ...guests(5)] }),
            { config: { ...CONFIG, largeMeetingSize: 5 } });
        expectVerdict(r, 'ignore', 'large', 'large meeting (6 guests): absence unlikely noticed');
    });

    test('an external guest wins over large', () => {
        const r = judgeOne(event({
            attendees: [att(OWNER), att('alice@acme.test'), ...guests(14), att('carol@partner.test')],
        }));
        expectVerdict(r, 'must', 'external');
    });
});

describe('verdict: the small-meeting default (PRD §1 rule 5, D-012)', () => {
    test('a small meeting the owner accepted is must-attend', () => {
        expectVerdict(judgeOne(event()), 'must', 'small', SMALL_2);
    });

    test('a small meeting the owner has not answered is must-attend', () => {
        const r = judgeOne(event({ attendees: [att(OWNER, 'needs-action'), att('alice@acme.test'), att('bob@acme.test')] }));
        expectVerdict(r, 'must', 'small', SMALL_2);
    });

    test('a small meeting the owner answered maybe is ignorable', () => {
        const r = judgeOne(event({ attendees: [att(OWNER, 'tentative'), att('alice@acme.test'), att('bob@acme.test')] }));
        expectVerdict(r, 'ignore', 'maybe', 'you answered maybe');
    });

    test('a 1:1 the owner accepted is must-attend with a singular reason (D-012)', () => {
        const r = judgeOne(event({ organizer: ALICE_ORGANISER, attendees: [att(OWNER), att('alice@acme.test')] }));
        expectVerdict(r, 'must', 'small', SMALL_1);
    });

    test('a 1:1 the owner has not answered is must-attend (D-012)', () => {
        const r = judgeOne(event({
            organizer: ALICE_ORGANISER, attendees: [att(OWNER, 'needs-action'), att('alice@acme.test')],
        }));
        expectVerdict(r, 'must', 'small', SMALL_1);
    });

    test('a 1:1 the owner answered maybe is ignorable (D-012)', () => {
        const r = judgeOne(event({
            organizer: ALICE_ORGANISER, attendees: [att(OWNER, 'tentative'), att('alice@acme.test')],
        }));
        expectVerdict(r, 'ignore', 'maybe', 'you answered maybe');
    });

    test('the organiser counts as a guest even when not listed', () => {
        const r = judgeOne(event({ organizer: ALICE_ORGANISER, attendees: [att(OWNER)] }));
        expectVerdict(r, 'must', 'small', SMALL_1);
    });

    test('a group counts as a guest', () => {
        const r = judgeOne(event({
            organizer: ALICE_ORGANISER, attendees: [att(OWNER), att('team@acme.test', 'accepted', 'group')],
        }));
        expectVerdict(r, 'must', 'small', SMALL_2);
    });

    test('the best response counts when the owner is listed twice', () => {
        const r = judgeOne(event({
            attendees: [att(OWNER, 'declined'), att('me@home.test', 'accepted'), att('alice@acme.test'), att('bob@acme.test')],
        }), { config: { ...CONFIG, extraOwnerAddresses: ['me@home.test'] } });
        expectVerdict(r, 'must', 'small', SMALL_2);
    });

    test('each guest with an empty address counts once', () => {
        const r = judgeOne(event({ organizer: ALICE_ORGANISER, attendees: [att(OWNER), att(''), att('')] }));
        expectVerdict(r, 'must', 'small', 'small meeting (3 guests): absence noticed');
    });
});

describe('verdict: not enough information', () => {
    test('when the owner is unknown, the meeting is must-attend', () => {
        const r = judgeOne(event({
            organizer: { email: 'x@acme.test', name: 'x' }, attendees: [att('x@acme.test'), att('y@acme.test')],
        }), { sources: [{ ...SOURCE, ownerEmail: null }] });
        expectVerdict(r, 'must', 'insufficient-data', INSUFFICIENT);
    });

    test('when the owner is unknown, 16 guests is not a large meeting: must-attend', () => {
        const r = judgeOne(event({ attendees: [att('alice@acme.test'), ...guests(15)] }),
            { sources: [{ ...SOURCE, ownerEmail: null }] });
        expectVerdict(r, 'must', 'insufficient-data', INSUFFICIENT);
    });
});

describe('verdict: rule order', () => {
    test('declined wins over an important title', () => {
        const r = judgeOne(event({
            summary: 'Client review',
            attendees: [att(OWNER, 'declined'), att('alice@acme.test'), att('bob@acme.test')],
        }));
        expectVerdict(r, 'ignore', 'declined');
    });

    test('cancelled wins over declined', () => {
        const r = judgeOne(event({
            status: 'cancelled', attendees: [att(OWNER, 'declined'), att('alice@acme.test'), att('bob@acme.test')],
        }));
        expectVerdict(r, 'ignore', 'cancelled');
    });

    test('not invited wins over all-day', () => {
        const r = judgeOne(event({ allDay: true, attendees: [att('alice@acme.test'), att('bob@acme.test')] }));
        expectVerdict(r, 'ignore', 'not-invited');
    });

    test('all-day wins over free', () => {
        expectVerdict(judgeOne(event({ allDay: true, transparency: 'transparent' })), 'ignore', 'all-day');
    });

    test('free wins over a placeholder title', () => {
        expectVerdict(judgeOne(event({ transparency: 'transparent', summary: 'Lunch' })), 'ignore', 'free');
    });
});

describe('verdict: AI answers (PG-4a)', () => {
    test('REASON_CODES ends with the two AI codes and is still frozen', () => {
        assert.deepEqual(REASON_CODES.slice(-3), ['test', 'ai-must', 'ai-ignore']);
        assert.ok(Object.isFrozen(REASON_CODES));
    });

    test("aiVerdict('must')", () => {
        assert.deepEqual(aiVerdict('must', 'x'), { verdict: 'must', reasonCode: 'ai-must', reason: 'AI: x' });
    });

    test("aiVerdict('ignore')", () => {
        assert.deepEqual(aiVerdict('ignore', 'a hold'), { verdict: 'ignore', reasonCode: 'ai-ignore', reason: 'AI: a hold' });
    });
});
