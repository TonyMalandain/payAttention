// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { T0, MIN, CONFIG, event, judgeOne } from './support/builders.js';

const sKey = 'series:evt-1';
const oKey = 'occ:evt-1|' + T0;
const MEET = 'https://meet.google.com/abc-defg-hij';
const modes = mode => ({ overrides: { verdict: {}, mode } });

describe('online: a conferencing link (PRD §2)', () => {
    const services = [
        'https://meet.google.com/abc-defg-hij',
        'https://zoom.us/j/123',
        'https://us02web.zoom.us/j/123?pwd=x',
        'https://zoomgov.com/j/1',
        'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc',
        'https://teams.live.com/meet/123',
        'https://acme.webex.com/meet/bob',
        'https://whereby.com/room',
        'https://meet.jit.si/Room',
        'https://8x8.vc/abc/room',
        'https://meet.goto.com/123456789',
        'https://global.gotomeeting.com/join/1',
        'https://gotomeet.me/bob',
        'https://app.slack.com/huddle/T1/C2',
    ];
    for (const url of services) {
        test(`a ${url} link in the description makes the meeting online`, () => {
            const r = judgeOne(event({ description: `Join here: ${url}` }));
            assert.equal(r.mode, 'online');
            assert.equal(r.joinUrl, url);
            assert.equal(r.deadline, T0);
        });
    }

    test('a link in the location makes the meeting online with no place', () => {
        const r = judgeOne(event({ location: 'https://zoom.us/j/9' }));
        assert.equal(r.mode, 'online');
        assert.equal(r.joinUrl, 'https://zoom.us/j/9');
        assert.equal(r.placeText, '');
    });

    test('the conference field is preferred over the description', () => {
        const r = judgeOne(event({ conferenceUris: ['https://meet.google.com/aaa-bbbb-ccc'], description: 'https://zoom.us/j/1' }));
        assert.equal(r.joinUrl, 'https://meet.google.com/aaa-bbbb-ccc');
    });

    test('a link in an HTML description is found', () => {
        const r = judgeOne(event({ description: `<p><a href="${MEET}">Join</a></p>` }));
        assert.equal(r.mode, 'online');
        assert.equal(r.joinUrl, MEET);
    });

    test('a link to a service not on the allowlist gives no Join link', () => {
        const r = judgeOne(event({ description: 'https://example.com/meet' }));
        assert.equal(r.mode, 'online');
        assert.equal(r.joinUrl, null);
        assert.equal(r.deadline, T0);
    });

    test('an http link is not a join link, so a place makes it in person', () => {
        const r = judgeOne(event({ description: 'http://zoom.us/j/1', location: 'Room 4' }));
        assert.equal(r.mode, 'in-person');
        assert.equal(r.joinUrl, null);
    });
});

describe('in person: a place and travel (PRD §2, §4)', () => {
    test('a real place makes the meeting in person, with default travel before the start', () => {
        const r = judgeOne(event({ location: '1 Main St, Springfield' }));
        assert.equal(r.mode, 'in-person');
        assert.equal(r.placeText, '1 Main St, Springfield');
        assert.equal(r.placeKey, '1 main st, springfield');
        assert.equal(r.travelMinutes, 30);
        assert.equal(r.travelIsDefault, true);
        assert.equal(r.deadline, T0 - 30 * MIN);
        assert.equal(r.joinUrl, null);
    });

    for (const location of ['Online', ' virtual ', 'Remote.', 'TBD', 'Zoom', 'Zoom Meeting', 'Phone', 'Microsoft Teams',
        '-', 'n/a', 'N/A.', 'Slack huddle']) {
        test(`the location '${location}' is not a place`, () => {
            const r = judgeOne(event({ location }));
            assert.equal(r.mode, 'online');
            assert.equal(r.placeText, '');
            assert.equal(r.placeKey, null);
            assert.equal(r.deadline, T0);
        });
    }

    // interfaces.md §2 place-text rule 2: only video-call wording names no place.
    for (const location of ['Join Zoom Meeting', 'Teams-Besprechung', 'Microsoft Teams Meeting', 'Google Meet – join',
        'Microsoft Teams-Besprechung beitreten']) {
        test(`the location '${location}', made only of video-call wording, is not a place`, () => {
            const r = judgeOne(event({ location }));
            assert.equal(r.mode, 'online');
            assert.equal(r.placeText, '');
            assert.equal(r.placeKey, null);
            assert.equal(r.deadline, T0);
        });
    }

    for (const location of ['Board room + Zoom', 'Room 4.12 / Teams', 'Meet at reception', 'Remote office, 3rd floor',
        'Zoom 2', 'Microsoft', 'Zoomlion Tower']) {
        test(`the location '${location}' names a place: in person`, () => {
            const r = judgeOne(event({ location }));
            assert.equal(r.mode, 'in-person');
            assert.equal(r.placeText, location);
        });
    }

    test('video-call wording with a link in the location is not a place, and the link is the Join link', () => {
        const r = judgeOne(event({ location: 'Join Zoom Meeting https://zoom.us/j/1' }));
        assert.equal(r.placeText, '');
        assert.equal(r.joinUrl, 'https://zoom.us/j/1');
    });

    test('a room name is a place: in person', () => {
        const r = judgeOne(event({ location: 'Conference Room B' }));
        assert.equal(r.mode, 'in-person');
        assert.equal(r.placeText, 'Conference Room B');
    });

    test('a location that is only a non-allowlisted link is not a place', () => {
        const r = judgeOne(event({ location: 'https://example.com/room' }));
        assert.equal(r.mode, 'online');
        assert.equal(r.placeText, '');
    });

    test('no link and no place is treated as online', () => {
        const r = judgeOne(event({ location: '' }));
        assert.equal(r.mode, 'online');
        assert.equal(r.travelMinutes, null);
        assert.equal(r.deadline, T0);
    });

    test('a place with a link is in person (D-038)', () => {
        const r = judgeOne(event({ location: 'HQ, Room 2', description: MEET }));
        assert.equal(r.mode, 'in-person');
        assert.equal(r.joinUrl, MEET);
        assert.equal(r.modeOverridden, false);
        assert.equal(r.placeKey, 'hq, room 2');
        assert.equal(r.travelMinutes, 30);
        assert.equal(r.travelIsDefault, true);
        assert.equal(r.deadline, T0 - 30 * MIN);
    });

    test('a series mode override to online wins over a place', () => {
        const r = judgeOne(event({ location: 'HQ, Room 2', description: MEET }), modes({ [sKey]: 'online' }));
        assert.equal(r.mode, 'online');
        assert.equal(r.travelMinutes, null);
        assert.equal(r.deadline, T0);
    });

    test('an occurrence mode override to in-person moves the deadline to leave-by', () => {
        const r = judgeOne(event({ description: MEET }), modes({ [oKey]: 'in-person' }));
        assert.equal(r.mode, 'in-person');
        assert.equal(r.modeOverridden, true);
        assert.equal(r.joinUrl, MEET);
        assert.equal(r.travelMinutes, 30);
        assert.equal(r.deadline, T0 - 30 * MIN);
    });

    test('a meeting with no link has no Join in either mode (D-040)', () => {
        assert.equal(judgeOne(event({ location: '1 Main St' })).joinUrl, null);
        assert.equal(judgeOne(event({ location: '1 Main St' }), modes({ [sKey]: 'online' })).joinUrl, null);
    });

    test('a series mode override to online applies to an instance', () => {
        const r = judgeOne(event({ recurring: true, recurrenceId: T0, location: '1 Main St' }), modes({ [sKey]: 'online' }));
        assert.equal(r.mode, 'online');
        assert.equal(r.deadline, T0);
        assert.equal(r.travelMinutes, null);
    });

    test('an invalid mode override is ignored', () => {
        const r = judgeOne(event({ location: '1 Main St' }), modes({ [oKey]: 'car' }));
        assert.equal(r.mode, 'in-person');
        assert.equal(r.modeOverridden, false);
    });

    test('a stored travel time is used for the same place written differently', () => {
        const r = judgeOne(event({ location: '  1  Main St,  Springfield ' }),
            { travel: { byPlace: { '1 main st, springfield': 45 }, byMeeting: {} } });
        assert.equal(r.travelMinutes, 45);
        assert.equal(r.travelIsDefault, false);
        assert.equal(r.deadline, T0 - 45 * MIN);
    });

    for (const stored of [0, -5, 1441, 'x', 2.5]) {
        test(`an invalid stored travel time (${JSON.stringify(stored)}) falls back to the default`, () => {
            const r = judgeOne(event({ location: '1 Main St' }), { travel: { byPlace: { '1 main st': stored }, byMeeting: {} } });
            assert.equal(r.travelMinutes, 30);
            assert.equal(r.travelIsDefault, true);
        });
    }

    test('the default travel time is a setting', () => {
        const r = judgeOne(event({ location: '1 Main St' }), { config: { ...CONFIG, defaultTravelMinutes: 20 } });
        assert.equal(r.deadline, T0 - 20 * MIN);
    });

    test('in person with no place uses the default travel time', () => {
        const r = judgeOne(event(), modes({ [oKey]: 'in-person' }));
        assert.equal(r.placeKey, null);
        assert.deepEqual(r.travelTarget, { kind: 'meeting', key: sKey });
        assert.equal(r.travelMinutes, 30);
        assert.equal(r.travelIsDefault, true);
        assert.equal(r.deadline, T0 - 30 * MIN);
    });
});

describe('travel target (D-039, ADR-0014)', () => {
    const travel = (byPlace, byMeeting) => ({ travel: { byPlace, byMeeting } });
    const inPersonNoPlace = (over = {}) => ({ ...modes({ [oKey]: 'in-person' }), ...over });

    test('a meeting with a place reads and writes the place entry', () => {
        const r = judgeOne(event({ location: '1 Main St, Springfield' }), travel({ '1 main st, springfield': 45 }, {}));
        assert.deepEqual(r.travelTarget, { kind: 'place', key: '1 main st, springfield' });
        assert.ok(Object.isFrozen(r.travelTarget));
        assert.equal(r.travelMinutes, 45);
        assert.equal(r.travelIsDefault, false);
    });

    test('a meeting with no place switched to in person reads its series entry', () => {
        const r = judgeOne(event(), inPersonNoPlace(travel({}, { [sKey]: 45 })));
        assert.deepEqual(r.travelTarget, { kind: 'meeting', key: sKey });
        assert.ok(Object.isFrozen(r.travelTarget));
        assert.equal(r.travelMinutes, 45);
        assert.equal(r.travelIsDefault, false);
        assert.equal(r.deadline, T0 - 45 * MIN);
    });

    test('a one-off meeting is keyed by its series key, not its occurrence key', () => {
        const r = judgeOne(event(), inPersonNoPlace(travel({}, { [oKey]: 45 })));
        assert.equal(r.travelMinutes, 30);
        assert.equal(r.travelIsDefault, true);
    });

    test('a repeating instance switched to in person for the series is keyed by the series', () => {
        const r = judgeOne(event({ recurring: true, recurrenceId: T0 }), modes({ [sKey]: 'in-person' }));
        assert.deepEqual(r.travelTarget, { kind: 'meeting', key: sKey });
    });

    test('a place meeting never reads the meeting entry', () => {
        const r = judgeOne(event({ location: '1 Main St' }), travel({}, { [sKey]: 45 }));
        assert.equal(r.travelMinutes, 30);
        assert.equal(r.travelIsDefault, true);
    });

    test('a meeting with no place never reads a place entry', () => {
        const r = judgeOne(event(), inPersonNoPlace(travel({ [sKey]: 45 }, {})));
        assert.equal(r.travelMinutes, 30);
        assert.equal(r.travelIsDefault, true);
    });

    test('an online meeting has no target and no travel, whatever is stored', () => {
        const r = judgeOne(event({ description: MEET }), travel({ '1 main st': 45 }, { [sKey]: 45 }));
        assert.equal(r.travelTarget, null);
        assert.equal(r.travelMinutes, null);
    });

    for (const stored of [0, -5, 1441, 'x', 2.5]) {
        test(`an invalid stored meeting travel time (${JSON.stringify(stored)}) falls back to the default`, () => {
            const r = judgeOne(event(), inPersonNoPlace(travel({}, { [sKey]: stored })));
            assert.equal(r.travelMinutes, 30);
            assert.equal(r.travelIsDefault, true);
        });
    }
});
