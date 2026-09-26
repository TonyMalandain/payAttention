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
        '-']) {
        test(`the location '${location}' is not a place`, () => {
            const r = judgeOne(event({ location }));
            assert.equal(r.mode, 'online');
            assert.equal(r.placeText, '');
            assert.equal(r.placeKey, null);
            assert.equal(r.deadline, T0);
        });
    }

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

    test('a link and a place together is online, keeping the place (D-007)', () => {
        const r = judgeOne(event({ location: 'HQ, Room 2', description: MEET }));
        assert.equal(r.mode, 'online');
        assert.equal(r.joinUrl, MEET);
        assert.equal(r.placeText, 'HQ, Room 2');
        assert.equal(r.placeKey, 'hq, room 2');
        assert.equal(r.travelMinutes, null);
        assert.equal(r.deadline, T0);
        assert.equal(r.modeOverridden, false);
    });

    test('an occurrence mode override to in-person moves the deadline to leave-by', () => {
        const r = judgeOne(event({ location: 'HQ, Room 2', description: MEET }), modes({ [oKey]: 'in-person' }));
        assert.equal(r.mode, 'in-person');
        assert.equal(r.modeOverridden, true);
        assert.equal(r.joinUrl, null);
        assert.equal(r.travelMinutes, 30);
        assert.equal(r.deadline, T0 - 30 * MIN);
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
        const r = judgeOne(event({ location: '  1  Main St,  Springfield ' }), { travel: { '1 main st, springfield': 45 } });
        assert.equal(r.travelMinutes, 45);
        assert.equal(r.travelIsDefault, false);
        assert.equal(r.deadline, T0 - 45 * MIN);
    });

    for (const stored of [0, -5, 1441, 'x', 2.5]) {
        test(`an invalid stored travel time (${JSON.stringify(stored)}) falls back to the default`, () => {
            const r = judgeOne(event({ location: '1 Main St' }), { travel: { '1 main st': stored } });
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
        assert.equal(r.travelMinutes, 30);
        assert.equal(r.travelIsDefault, true);
        assert.equal(r.deadline, T0 - 30 * MIN);
    });
});
