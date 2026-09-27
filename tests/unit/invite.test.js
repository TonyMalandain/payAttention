// The bounded invite (interfaces.md §6.2; D-020, D-022, D-024, D-025).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvite } from '../../extension/core/invite.js';
import { INVITE_FIELDS, MAX_INVITE_BYTES, utf8Length, validateInvite } from '../../extension/core/aiProtocol.js';
import { ownerIdentity } from '../../extension/core/owner.js';
import { occurrenceKey } from '../../extension/core/keys.js';
import { T0, MIN, CONFIG, OWNER, att, event, snapshot } from './support/builders.js';

const IDENT = ownerIdentity(snapshot([event()]), CONFIG);
const build = (over = {}, calendar = 'Work', offset = -240) => buildInvite(event(over), IDENT, calendar, offset);
const bytes = inv => utf8Length(JSON.stringify(inv));
const cp = s => Array.from(s).length;

function isDeepFrozen(o) {
    if (typeof o !== 'object' || o === null)
        return true;
    return Object.isFrozen(o) && Object.values(o).every(isDeepFrozen);
}

describe('buildInvite: shape', () => {
    test('keys in INVITE_FIELDS order, nested keys in order, deep-frozen, valid', () => {
        const inv = build({ organizer: { email: 'alice@acme.test', name: 'Alice' } });
        assert.deepEqual(Object.keys(inv), INVITE_FIELDS.map(f => f.key));
        assert.deepEqual(Object.keys(inv.you), ['response', 'organiser']);
        assert.deepEqual(Object.keys(inv.organiser), ['name', 'email']);
        assert.deepEqual(Object.keys(inv.guests[0]), ['name', 'email', 'response', 'role']);
        assert.ok(isDeepFrozen(inv));
        assert.deepEqual(validateInvite(inv), { ok: true });
    });

    test('deterministic', () => {
        assert.deepEqual(build(), build());
    });
});

describe('buildInvite: fields', () => {
    test('start in local time from the offset', () => {
        assert.equal(build({}, 'Work', -240).start, '2026-09-28 Mon 10:00');
        assert.equal(build({}, 'Work', 600).start, '2026-09-29 Tue 00:00');
        assert.equal(build({ allDay: true }, 'Work', -240).start, '2026-09-28 Mon');
    });

    test('minutes', () => {
        assert.equal(build({ end: T0 + 29.6 * MIN }).minutes, 30);
        assert.equal(build({ end: T0 - MIN }).minutes, 0);
        assert.equal(build({ end: NaN }).minutes, 0);
    });

    test('allDay, recurring and status are copied', () => {
        const inv = build({ allDay: true, recurring: true, status: 'tentative' });
        assert.equal(inv.allDay, true);
        assert.equal(inv.recurring, true);
        assert.equal(inv.status, 'tentative');
    });

    test('busy', () => {
        assert.equal(build({ transparency: 'opaque' }).busy, 'busy');
        assert.equal(build({ transparency: 'transparent' }).busy, 'free');
        assert.equal(build({ transparency: 'unknown' }).busy, 'unknown');
    });

    test('calendar is cleaned and capped; empty stays empty', () => {
        assert.equal(build({}, ' Fam\nily ').calendar, 'Fam ily');
        const long = build({}, 'c'.repeat(100)).calendar;
        assert.equal(cp(long), 80);
        assert.ok(long.endsWith('…'));
        assert.equal(build({}, '').calendar, '');
    });

    test('videoLink is cut at the query (D-022)', () => {
        assert.equal(build({ description: 'Join https://us02web.zoom.us/j/81234?pwd=abc#success' }).videoLink,
            'https://us02web.zoom.us/j/81234');
    });

    test('no link gives null', () => {
        assert.equal(build().videoLink, null);
    });

    test('an upper-case HTTPS scheme is written in lower case, so the invite stays valid', () => {
        const inv = build({ conferenceUris: ['HTTPS://MEET.GOOGLE.COM/abc-defg-hij?authuser=1'] });
        assert.equal(inv.videoLink, 'https://MEET.GOOGLE.COM/abc-defg-hij');
        assert.deepEqual(validateInvite(inv), { ok: true });
    });

    test('a link over 300 characters after cutting gives null', () => {
        const uri = 'https://meet.google.com/' + 'a'.repeat(286);
        assert.equal(uri.length, 310);
        assert.equal(build({ conferenceUris: [uri + '?pwd=x'] }).videoLink, null);
    });

    test('description and place: conferencing queries cut, other queries kept', () => {
        const inv = build({
            description: 'Join https://zoom.us/j/1?pwd=abc. Doc https://docs.example.test/a?id=7',
            location: 'https://zoom.us/j/2?pwd=def or Room 4',
        });
        assert.equal(inv.description, 'Join https://zoom.us/j/1. Doc https://docs.example.test/a?id=7');
        assert.equal(inv.place, 'https://zoom.us/j/2 or Room 4');
    });

    test('you: a tentative owner', () => {
        const inv = build({ attendees: [att(OWNER, 'tentative'), att('alice@acme.test')] });
        assert.deepEqual(inv.you, { response: 'tentative', organiser: false });
    });

    test('you organised it: organiser is null', () => {
        const inv = build({ organizer: { email: OWNER, name: 'me' } });
        assert.equal(inv.you.organiser, true);
        assert.equal(inv.organiser, null);
    });

    test('no organiser gives null; an organiser is cleaned and normalised', () => {
        assert.equal(build({ organizer: null }).organiser, null);
        assert.deepEqual(build({ organizer: { email: ' MAILTO:Alice@Acme.TEST ', name: 'Alice\tA' } }).organiser,
            { name: 'Alice A', email: 'alice@acme.test' });
    });
});

describe('buildInvite: guests', () => {
    test('rooms and the owner are not sent', () => {
        const inv = build({
            attendees: [att(OWNER), att('alice@acme.test'),
                { email: 'room4@acme.test', name: 'Board Room 4', partstat: 'accepted', cutype: 'room', role: 'non-participant' }],
        });
        const json = JSON.stringify(inv);
        assert.ok(!json.includes('Board Room 4'));
        assert.ok(!json.includes('room4@'));
        assert.ok(!json.includes(OWNER));
        assert.equal(inv.guestsTotal, 1);
    });

    test('roles map, responses are raw', () => {
        const inv = build({
            attendees: [
                att('a@acme.test', 'needs-action', 'individual', 'chair'),
                att('b@acme.test', 'delegated', 'individual', 'req-participant'),
                att('c@acme.test', 'other', 'individual', 'opt-participant'),
                att('d@acme.test', 'declined', 'individual', 'non-participant'),
            ],
        });
        assert.deepEqual(inv.guests.map(g => [g.role, g.response]),
            [['chair', 'needs-action'], ['required', 'delegated'], ['optional', 'other'], ['other', 'declined']]);
    });

    test('30 guests: 25 listed, total 30', () => {
        const attendees = Array.from({ length: 30 }, (_, i) => att(`g${i}@acme.test`));
        const inv = build({ attendees });
        assert.equal(inv.guests.length, 25);
        assert.equal(inv.guestsTotal, 30);
        assert.equal(inv.guests[24].email, 'g24@acme.test');
    });
});

describe('buildInvite: never sent', () => {
    test('uid, sourceUid, the occurrence key, and a second conference URI', () => {
        const ev = event({ uid: 'uid-zq81', sourceUid: 'src-zq82',
            conferenceUris: ['https://meet.google.com/aaa-bbbb-ccc', 'https://meet.google.com/zzz-yyyy-xxx'] });
        const json = JSON.stringify(buildInvite(ev, IDENT, 'Work', 0));
        assert.ok(!json.includes('uid-zq81'));
        assert.ok(!json.includes('src-zq82'));
        assert.ok(!json.includes(occurrenceKey(ev)));
        assert.ok(json.includes('aaa-bbbb-ccc'));
        assert.ok(!json.includes('zzz-yyyy-xxx'));
    });
});

describe('buildInvite: caps and cleaning', () => {
    test('each text field is capped with …', () => {
        const inv = build({
            summary: 't'.repeat(250), description: 'd'.repeat(2000), location: 'p'.repeat(250),
            organizer: { email: 'o'.repeat(300) + '@acme.test', name: 'n'.repeat(100) },
            attendees: [att(OWNER), { email: 'e'.repeat(300), name: 'm'.repeat(100), partstat: 'accepted',
                cutype: 'individual', role: 'chair' }],
        });
        assert.equal(cp(inv.title), 200);
        assert.equal(cp(inv.description), 1500);
        assert.equal(cp(inv.place), 200);
        assert.equal(cp(inv.organiser.name), 80);
        assert.equal(cp(inv.organiser.email), 254);
        assert.equal(cp(inv.guests[0].name), 80);
        assert.equal(cp(inv.guests[0].email), 254);
        for (const s of [inv.title, inv.description, inv.place, inv.organiser.name, inv.guests[0].email])
            assert.ok(s.endsWith('…'));
    });

    test('a title with a newline and a bidi override comes out clean', () => {
        assert.equal(build({ summary: 'Sync\nnow\u202E!' }).title, 'Sync now!');
    });
});

describe('buildInvite: the 8 192-byte cap', () => {
    const bigGuest = i => ({ email: `${i}`.padEnd(254, 'e'), name: '😀'.repeat(80), partstat: 'accepted',
        cutype: 'individual', role: 'req-participant' });

    test('guests are dropped from the end first; guestsTotal and description unchanged', () => {
        const inv = build({ description: 'Agenda', attendees: [att(OWNER), ...Array.from({ length: 25 }, (_, i) => bigGuest(i))] });
        assert.ok(bytes(inv) <= MAX_INVITE_BYTES);
        assert.ok(inv.guests.length > 0 && inv.guests.length < 25);
        assert.equal(inv.guests[0].email, '0'.padEnd(254, 'e'));
        assert.equal(inv.guestsTotal, 25);
        assert.equal(inv.description, 'Agenda');
        assert.deepEqual(validateInvite(inv), { ok: true });
    });

    test('the description is shortened only after the guests are gone', () => {
        // Title, place and calendar at their caps too, so even with no guests the full description cannot fit.
        const over = { summary: '😀'.repeat(200), location: '😀'.repeat(200), description: '😀'.repeat(1500) };
        const inv = build({ ...over, attendees: [att(OWNER), ...Array.from({ length: 25 }, (_, i) => bigGuest(i))] },
            '😀'.repeat(80));
        assert.ok(bytes({ ...inv, guests: [], description: '😀'.repeat(1500) }) > MAX_INVITE_BYTES);
        assert.ok(bytes(inv) <= MAX_INVITE_BYTES);
        assert.equal(inv.guests.length, 0);
        assert.equal(inv.guestsTotal, 25);
        assert.ok(cp(inv.description) > 0 && cp(inv.description) < 1500);
        assert.ok(inv.description.endsWith('…'));
        assert.deepEqual(validateInvite(inv), { ok: true });
    });

    test('worst case: every text field at its cap still fits', () => {
        const heavy = n => '😀"'.repeat(n);
        const inv = buildInvite(event({
            summary: heavy(200), description: heavy(1500), location: heavy(200),
            conferenceUris: ['https://meet.google.com/' + 'a'.repeat(276)],
            organizer: { email: heavy(254), name: heavy(80) },
            attendees: Array.from({ length: 30 }, (_, i) => ({ email: i + heavy(254), name: heavy(80),
                partstat: 'accepted', cutype: 'individual', role: 'req-participant' })),
        }), IDENT, heavy(80), 0);
        assert.ok(bytes(inv) <= MAX_INVITE_BYTES, `${bytes(inv)} bytes`);
        assert.equal(inv.guests.length, 0);
        assert.deepEqual(validateInvite(inv), { ok: true });
        // No third branch is needed: with guests and description empty it fits with room to spare.
        assert.ok(bytes({ ...inv, guests: [], description: '' }) <= MAX_INVITE_BYTES);
    });
});

describe('buildInvite: D-025 passcodes written as text are removed', () => {
    const desc = text => build({ description: text }).description;

    test('"Passcode: 123456"', () => {
        assert.equal(desc('Passcode: 123456'), 'Passcode: [removed]');
    });

    test('the meeting ID stays, the passcode goes', () => {
        assert.equal(desc('Meeting ID: 812 3456 7890 Passcode 9xY!2'), 'Meeting ID: 812 3456 7890 Passcode [removed]');
    });

    test('"pwd=abc123" and "PIN #4455"', () => {
        assert.equal(desc('pwd=abc123'), 'pwd=[removed]');
        assert.equal(desc('PIN #4455'), 'PIN #[removed]');
    });

    test('"is", no space, and any letter case', () => {
        assert.equal(desc('The passcode is 9876 today'), 'The passcode is [removed] today');
        assert.equal(desc('PASSWORD:hunter2 ok'), 'PASSWORD:[removed] ok');
        assert.equal(desc('Pwd = x1'), 'Pwd = [removed]');
    });

    test('the word followed by an ordinary word loses that word (the cost D-025 accepts)', () => {
        assert.equal(desc('The password policy review'), 'The password [removed] review');
    });

    test('whole words only: "spinning" does not match "pin"', () => {
        const text = 'spinning class, Spin class at 6, backspin: 3, pinned note, passwords.txt, xpwd=1, pwdx=1';
        assert.equal(desc(text), text);
    });

    test('the word with nothing after it, or joined by other punctuation, is left alone', () => {
        assert.equal(desc('Forgot your password.'), 'Forgot your password.');
        assert.equal(desc('password-protected file'), 'password-protected file');
        assert.equal(desc('PIN'), 'PIN');
    });

    test('a value on the next line is removed too', () => {
        assert.equal(desc('Passcode:\n123456\nThanks'), 'Passcode: [removed] Thanks');
    });

    test('every occurrence is removed', () => {
        assert.equal(desc('Passcode: 111 then PIN: 222'), 'Passcode: [removed] then PIN: [removed]');
    });

    test('in the place too', () => {
        assert.equal(build({ location: 'Dial-in 555-0100, PIN: 7788#' }).place, 'Dial-in 555-0100, PIN: [removed]');
    });

    test('a passcode in a non-conferencing link query is removed', () => {
        assert.equal(desc('Docs https://docs.example.test/a?pwd=abc123 now'), 'Docs https://docs.example.test/a?pwd=[removed] now');
    });

    test('removed before the cap, so a cut cannot leave part of a passcode', () => {
        const d = desc('x'.repeat(1480) + ' Passcode: 98765432109876543210');
        assert.ok(!/[0-9]/.test(d), d.slice(-40));
        assert.ok(d.endsWith('Passcode: [removed]'));
    });

    test('the passcode is absent from the whole invite, with the video link cut as well', () => {
        const inv = build({
            description: 'Join Zoom https://us02web.zoom.us/j/81234?pwd=Zq9xT7 Meeting ID: 812 34 Passcode: Zq9xT7',
            location: 'https://us02web.zoom.us/j/81234?pwd=Zq9xT7',
        });
        assert.ok(!JSON.stringify(inv).includes('Zq9xT7'));
        assert.ok(inv.description.includes('Meeting ID: 812 34'));
    });
});

describe('buildInvite: argument checks', () => {
    for (const [name, cal, off] of [['calendarName 5', 5, 0], ['offset 1.5', 'Work', 1.5], ['offset 900', 'Work', 900],
        ['offset -841', 'Work', -841]]) {
        test(`${name} throws TypeError`, () => {
            assert.throws(() => buildInvite(event(), IDENT, cal, off), TypeError);
        });
    }

    test('offsets at the limits are accepted', () => {
        assert.equal(build({}, 'Work', 840).start, '2026-09-29 Tue 04:00');
        assert.equal(build({}, 'Work', -840).start, '2026-09-28 Mon 00:00');
    });
});
