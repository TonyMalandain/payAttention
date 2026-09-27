// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

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

describe('buildInvite: D-025 and D-027 passcodes written as text are removed to the end of the line', () => {
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
        assert.equal(desc('The passcode is 9876 today'), 'The passcode is [removed]');
        assert.equal(desc('PASSWORD:hunter2 ok'), 'PASSWORD:[removed]');
        assert.equal(desc('Pwd = x1'), 'Pwd = [removed]');
    });

    test('the word followed by ordinary words loses the rest of its line (the cost D-027 accepts)', () => {
        assert.equal(desc('The password policy review'), 'The password [removed]');
    });

    test('D-027: a code written in groups goes whole', () => {
        assert.equal(desc('PIN: 263 947 381#'), 'PIN: [removed]');
        assert.equal(desc('Passcode: 12 34 56'), 'Passcode: [removed]');
    });

    test('D-027: separators "-", ":", "=", "#" and the filler words "is" and "code" are kept', () => {
        assert.equal(desc('Passcode - 123456'), 'Passcode - [removed]');
        assert.equal(desc('Password is: abc123'), 'Password is: [removed]');
        assert.equal(desc('PIN code: 1234'), 'PIN code: [removed]');
        assert.equal(desc('pin CODE is # 55 66'), 'pin CODE is # [removed]');
    });

    test('D-027: a word that only starts like a filler word is part of the removed value', () => {
        assert.equal(desc('PIN isolated 12 34'), 'PIN [removed]');
    });

    test('D-027: a Google Meet block keeps the text on the following lines', () => {
        const meet = [
            'Join with Google Meet: https://meet.google.com/abc-defg-hij',
            'Or dial: (US) +1 234-567-8901 PIN: 263 947 381#',
            'More phone numbers: https://tel.meet/abc-defg-hij',
            'Agenda: quarterly planning',
        ].join('\n');
        assert.equal(desc(meet), 'Join with Google Meet: https://meet.google.com/abc-defg-hij ' +
            'Or dial: (US) +1 234-567-8901 PIN: [removed] ' +
            'More phone numbers: https://tel.meet/abc-defg-hij Agenda: quarterly planning');
    });

    test('D-027: a Windows line break ends the line too', () => {
        assert.equal(desc('Passcode: 12 34\r\nThanks'), 'Passcode: [removed] Thanks');
    });

    test('whole words only: "spinning" does not match "pin"', () => {
        const text = 'spinning class, Spin class at 6, backspin: 3, pinned note, pinsetter, passwordsx, xpwd=1, pwdx=1';
        assert.equal(desc(text), text);
    });

    test('D-029: plural keywords trigger removal too', () => {
        assert.equal(desc('Passcodes: 111 and 222'), 'Passcodes: [removed]');
        assert.equal(desc('passwords = hunter2'), 'passwords = [removed]');
        assert.equal(desc('pins: 1234'), 'pins: [removed]');
        assert.equal(desc('PINs: 1234 / 5678'), 'PINs: [removed]');
        // A plural before "." is followed by a letter, so the rest of the line goes (the D-027 cost).
        assert.equal(desc('passwords.txt'), 'passwords[removed]');
    });

    test('D-029: invisible marks inside a keyword do not stop removal', () => {
        for (const mark of ['\u200B', '\u200C', '\u200D', '\u200E', '\u200F', '\u2060', '\uFEFF', '\u00AD'])
            assert.equal(desc(`Pass${mark}code: 654321`), 'Passcode: [removed]', `U+${mark.codePointAt(0).toString(16)}`);
        assert.equal(desc('P\u200Bi\u00ADN: 1234'), 'PiN: [removed]');
    });

    test('the word with nothing after it, or followed by other punctuation, is left alone', () => {
        assert.equal(desc('Forgot your password.'), 'Forgot your password.');
        // D-027: "-" is a separator, so the rest of the line goes.
        assert.equal(desc('password-protected file'), 'password-[removed]');
        assert.equal(desc('PIN'), 'PIN');
        assert.equal(desc('Passcode: '), 'Passcode:');
        assert.equal(desc('Passcode is'), 'Passcode is');
    });

    test('a value on the next line is removed too', () => {
        assert.equal(desc('Passcode:\n123456\nThanks'), 'Passcode: [removed] Thanks');
    });

    test('every occurrence is removed; a second one on the same line is inside the first removal', () => {
        assert.equal(desc('Passcode: 111\nPIN: 222'), 'Passcode: [removed] PIN: [removed]');
        assert.equal(desc('Passcode: 111 then PIN: 222'), 'Passcode: [removed]');
    });

    test('in the place too', () => {
        assert.equal(build({ location: 'Dial-in 555-0100, PIN: 7788#' }).place, 'Dial-in 555-0100, PIN: [removed]');
    });

    test('a passcode in a non-conferencing link query is removed', () => {
        assert.equal(desc('Docs https://docs.example.test/a?pwd=abc123 now'), 'Docs https://docs.example.test/a?pwd=[removed]');
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

describe('buildInvite: D-029 phone dial-in strings are removed', () => {
    const desc = text => build({ description: text }).description;

    test('the three shapes in D-029: Zoom one tap, spaced and dashed, tel:', () => {
        assert.equal(desc('+16699006833,,81234567890#,,,,*654321# US (San Jose)'), '[removed] US (San Jose)');
        assert.equal(desc('Dial +1 646-876-9923,,812345# now'), 'Dial [removed] now');
        assert.equal(desc('Tap tel:+15551234567,,123# to join'), 'Tap [removed] to join');
    });

    test('in the place too', () => {
        assert.equal(build({ location: 'Bridge +1 323-849-4874,,123456789#' }).place, 'Bridge [removed]');
    });

    test('Webex "##", a semicolon wait, a star code and parentheses', () => {
        assert.equal(desc('+1-415-655-0001,,25531234567## US Toll'), '[removed] US Toll');
        assert.equal(desc('+44 20 7946 0958;4321#'), '[removed]');
        assert.equal(desc('+1 (646) 876-9923*55'), '[removed]');
    });

    test('a plain phone number with no codes stays', () => {
        const text = '+1 669 900 6833 US (San Jose), +1 646-876-9923 US (New York), tel:+15551234567';
        assert.equal(desc(text), text);
    });

    test('short numbers, amounts, and a number followed by ", " stay', () => {
        const text = 'Rooms 3, 4, and 5; budget $1,000,000; ext #12; call 555-1234, then 555-9876; ID 812 3456 7890';
        assert.equal(desc(text), text);
    });

    test('the dial string inside an HTML tel: link goes from both the link and its text', () => {
        const html = '<a href="tel:+16699006833,,81234567890#,,,,*654321#">+16699006833,,81234567890#,,,,*654321#</a>';
        // D-030: the tag goes with its href, the dial string in the text is removed.
        assert.equal(desc(html), '[removed]');
    });
});

describe('buildInvite: D-029 HTML line breaks end the line for D-027', () => {
    const desc = text => build({ description: text }).description;

    test('<br>, <br/>, <br />, </p>, </li> and </div>, in any case, stop the removal', () => {
        for (const tag of ['<br>', '<br/>', '<br />', '<BR>', '</p>', '</P>', '</li>', '</LI >', '</div>', '</Div>'])
            assert.equal(desc(`Passcode: 654321${tag}Agenda: budget`), 'Passcode: [removed] Agenda: budget', tag);
    });

    test('a value alone on the next HTML line is removed, and the line after it stays', () => {
        assert.equal(desc('<p>Passcode:</p><p>654321</p><p>Agenda: budget</p>'), 'Passcode: [removed] Agenda: budget');
        assert.equal(desc('Passcode:<br><br>654321<br>Agenda: budget'), 'Passcode: [removed] Agenda: budget');
    });

    test('other tags are not line ends', () => {
        assert.equal(desc('Passcode: <b>654321</b> Agenda'), 'Passcode: [removed]');
        assert.equal(desc('<brand>Passcode: 1</brand>x'), 'Passcode: [removed]');
    });

    test('in the place too', () => {
        assert.equal(build({ location: 'Room 4<br>PIN: 7788<br>Floor 2' }).place, 'Room 4 PIN: [removed] Floor 2');
    });
});

describe('buildInvite: D-030 plain text first', () => {
    const desc = text => build({ description: text }).description;

    test('<br> with attributes ends the line; the agenda after it stays', () => {
        assert.equal(desc('Passcode: 654321<br clear="all">Agenda: budget'), 'Passcode: [removed] Agenda: budget');
        assert.equal(desc('Passcode: 654321<BR Class=x/>Agenda: budget'), 'Passcode: [removed] Agenda: budget');
    });

    test('</tr>, </td> and </h1> to </h6>, in any case, end the line', () => {
        for (const tag of ['</tr>', '</TD>', '</h1>', '</H2>', '</h3>', '</h4>', '</h5>', '</h6 >'])
            assert.equal(desc(`Passcode: 654321${tag}Agenda: budget`), 'Passcode: [removed] Agenda: budget', tag);
    });

    test('every other tag is removed, so a tag inside a keyword does not hide it', () => {
        assert.equal(desc('Pass<span>code</span>: 654321'), 'Passcode: [removed]');
        assert.equal(desc('<b>PIN</b>: <i class="x">1234</i>'), 'PIN: [removed]');
        assert.equal(desc('<table><tr><td>Agenda</td><td>budget</td></tr></table>'), 'Agenda budget');
    });

    test('a "<" that does not open a tag stays as text', () => {
        assert.equal(desc('a < b and c > d, 3<4'), 'a < b and c > d, 3<4');
        assert.equal(desc('Join<https://example.test/x>'), 'Join<https://example.test/x>');
    });

    test('entities are decoded: an invisible or hidden mark written as an entity does not hide a keyword', () => {
        assert.equal(desc('Pass&#8203;code: 654321'), 'Passcode: [removed]');
        assert.equal(desc('Pass&shy;code: 654321'), 'Passcode: [removed]');
        assert.equal(desc('Pass&#x200b;code: 654321'), 'Passcode: [removed]');
        assert.equal(desc('Pass&#X200B;code: 654321'), 'Passcode: [removed]');
    });

    test('named and numeric entities become their characters, once', () => {
        assert.equal(desc('a&nbsp;b &amp; &lt;c&gt; &quot;d&quot; &#39;e&#39; &#233; &#xE9;'), 'a b & <c> "d" \'e\' é é');
        assert.equal(desc('&amp;#8203; &amp;lt;'), '&#8203; &lt;');
    });

    test('an entity that names no character, or an unknown name, stays as written', () => {
        assert.equal(desc('&#99999999; &#x110000; &bogus; & amp;'), '&#99999999; &#x110000; &bogus; & amp;');
    });

    test('an entity written after the tags are gone is text, not a tag', () => {
        assert.equal(desc('&lt;br&gt;Passcode: 1'), '<br>Passcode: [removed]');
    });

    test('in the place too', () => {
        assert.equal(build({ location: 'Room&nbsp;4<br class="x">P<b>I</b>N:&nbsp;7788<br>Floor 2' }).place,
            'Room 4 PIN: [removed] Floor 2');
    });
});

describe('buildInvite: D-030 one shared list of invisible marks, stripped before matching', () => {
    const desc = text => build({ description: text }).description;

    test('direction isolates, embeddings, the Arabic letter mark and invisible operators inside a keyword', () => {
        assert.equal(desc('Pass\u2066code: 654321'), 'Passcode: [removed]');
        assert.equal(desc('Pass\u202Acode: 654321'), 'Passcode: [removed]');
        assert.equal(desc('P\u061CIN: 1234'), 'PIN: [removed]');
        assert.equal(desc('Pass\u2062code: 654321'), 'Passcode: [removed]');
    });

    test('every mark in the list, and U+034F, inside a keyword', () => {
        const marks = ['\u00AD', '\u034F', '\u061C', '\u200B', '\u200C', '\u200D', '\u200E', '\u200F',
            '\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064',
            '\u2066', '\u2067', '\u2068', '\u2069', '\uFEFF'];
        for (const mark of marks)
            assert.equal(desc(`Pass${mark}code: 654321`), 'Passcode: [removed]', `U+${mark.codePointAt(0).toString(16)}`);
    });

    test('a mark inside a dial string does not hide it', () => {
        assert.equal(desc('+1 646 876 9923,\u2066,812345#'), '[removed]');
    });
});

describe('buildInvite: D-030 dial-in strings, round 2', () => {
    const desc = text => build({ description: text }).description;

    test('no-break spaces, narrow no-break spaces and non-breaking hyphens as separators', () => {
        assert.equal(desc('+1\u00A0646\u00A0876\u00A09923,,812345#'), '[removed]');
        assert.equal(desc('+1\u202F646\u202F876\u202F9923,,812345#'), '[removed]');
        assert.equal(desc('+1\u2011646\u2011876\u20119923,,812345#'), '[removed]');
        assert.equal(desc('+1\u2010646\u2010876\u20109923,,812345#'), '[removed]');
    });

    test('a space before the pause', () => {
        assert.equal(desc('+1 646-876-9923 ,,812345#'), '[removed]');
        assert.equal(desc('Call +1 646-876-9923 ;4321# now'), 'Call [removed] now');
    });

    test('a number after a list marker or a digit is still caught; the label before it stays', () => {
        assert.equal(desc('1. +1 646-876-9923,,812345#'), '1. [removed]');
        assert.equal(desc('Option 2 - +16699006833,,812345#'), 'Option 2 - [removed]');
        assert.equal(desc('2 (+1) 646 876 9923,,4321#'), '2 ([removed]');
        assert.equal(desc('Room 5,16699006833,,1#'), 'Room 5,[removed]');
    });

    test('edges: exactly 6 digits stay, exactly 7 go', () => {
        assert.equal(desc('123456,,1#'), '123456,,1#');
        assert.equal(desc('12 34 56#'), '12 34 56#');
        assert.equal(desc('1234567,,1#'), '[removed]');
        assert.equal(desc('123 45 67#'), '[removed]');
    });

    test('edges: a pause followed directly by "#" or "*"', () => {
        assert.equal(desc('+1 646 876 9923,#'), '[removed]');
        assert.equal(desc('+1 646 876 9923;*55'), '[removed]');
        assert.equal(desc('+1 646 876 9923,, then'), '+1 646 876 9923,, then');
    });

    test('percent-encoded pauses and codes in a tel: link and in a dial string are decoded, then removed', () => {
        assert.equal(desc('<a href="tel:+16699006833,,81234567890%23,,,,*654321%23">Call</a>'), 'Call');
        assert.equal(desc('tel:+16699006833%2C%2C81234567890%23%2C%2C%2C%2C%2A654321%23 x'), '[removed] x');
        assert.equal(desc('tel:+1555123456%3B123%23'), '[removed]');
        assert.equal(desc('+16699006833%2c%2c812345%23'), '[removed]');
    });

    test('a percent sign not after a digit or pause is left alone; a short number is decoded but kept', () => {
        assert.equal(desc('100% sure, a%2Cb, x%23y'), '100% sure, a%2Cb, x%23y');
        assert.equal(desc('50%23 off'), '50# off');
    });
});

describe('buildInvite: D-025, D-027 and D-029 on whole standard invites, plain and HTML', () => {
    const AGENDA = ['Agenda: budget review and hiring plan', 'Wrap-up: action items and owners'];

    // Synthetic invites in each service's standard layout; codes and IDs are made up.
    const INVITES = {
        'Zoom': {
            lines: [
                AGENDA[0],
                'Tony Malandain is inviting you to a scheduled Zoom meeting.',
                'Join Zoom Meeting',
                'https://us02web.zoom.us/j/81234567890?pwd=Zq9xT7aBcDeFgHiJkLmN.1',
                'Meeting ID: 812 3456 7890',
                'Passcode: 654321',
                'One tap mobile',
                '+16699006833,,81234567890#,,,,*654321# US (San Jose)',
                '+16465588656,,81234567890#,,,,*654321# US (New York)',
                'Dial by your location',
                '• +1 669 900 6833 US (San Jose)',
                'Meeting ID: 812 3456 7890',
                'Passcode: 654321',
                'Find your local number: https://us02web.zoom.us/u/kdXyZ12abc',
                AGENDA[1],
            ],
            secrets: ['654321', 'Zq9xT7aBcDeFgHiJkLmN', '81234567890#'],
            kept: ['Meeting ID: 812 3456 7890', '+1 669 900 6833 US (San Jose)'],
        },
        'Google Meet': {
            lines: [
                AGENDA[0],
                'Join with Google Meet',
                'https://meet.google.com/abc-defg-hij',
                'Join by phone',
                '(US) +1 234-567-8901 PIN: 263 947 381#',
                '+1 234-567-8901,,263947381#',
                'More phone numbers',
                'https://tel.meet/abc-defg-hij?pin=263947381',
                AGENDA[1],
            ],
            secrets: ['263 947 381', '263947381'],
            kept: ['https://meet.google.com/abc-defg-hij', '(US) +1 234-567-8901 PIN:'],
        },
        'Microsoft Teams': {
            lines: [
                AGENDA[0],
                'Microsoft Teams meeting',
                'Join on your computer, mobile app or room device',
                'Click here to join the meeting<https://teams.microsoft.com/l/meetup-join/19%3ameeting_Nz%40thread.v2/0?context=%7b%22Tid%22%3a%22x9%22%7d>',
                'Meeting ID: 234 567 890 123',
                'Passcode: aB3cD4',
                'Or call in (audio only)',
                '+1 323-849-4874,,123456789#   United States, Los Angeles',
                'Phone Conference ID: 123 456 789#',
                'Find a local number | Reset PIN',
                // After "Reset PIN" this line goes as a value on the next line (D-027).
                'Learn More | Meeting options',
                '________________________________________________________________________________',
                AGENDA[1],
            ],
            secrets: ['aB3cD4', '123456789', '123 456 789', 'Tid'],
            kept: ['Meeting ID: 234 567 890 123', 'United States, Los Angeles', 'Reset PIN'],
        },
        'Webex': {
            lines: [
                AGENDA[0],
                'When it\'s time, join the Webex meeting here.',
                'Meeting number (access code): 2553 123 4567',
                'Meeting password: Xy7kPq2Rt',
                'Join meeting https://acme.webex.com/acme/j.php?MTID=m0123456789abcdef',
                'Tap to join from a mobile device (attendees only)',
                '+1-415-655-0001,,25531234567## US Toll',
                'Join by phone',
                '+1-415-655-0001 US Toll',
                'Numeric meeting password: 99754201',
                AGENDA[1],
            ],
            secrets: ['Xy7kPq2Rt', '99754201', 'm0123456789abcdef', '25531234567'],
            kept: ['Meeting number (access code): 2553 123 4567', '+1-415-655-0001 US Toll'],
        },
    };

    // The same lines as an HTML description: each line ends with one of the D-029 tags,
    // links and dial strings are wrapped in anchors as calendar clients write them.
    const ENDS = [['<p>', '</p>'], ['', '<br>'], ['<li>', '</li>'], ['<div>', '</DIV>'], ['', '<BR />']];
    const toHtml = lines => lines.map((line, i) => {
        const body = line
            .replace(/https:\/\/[^\s<>]+/g, url => `<a href="${url}">${url}</a>`)
            .replace(/\+[\d -]+,,[\d#,*]+/g, dial => `<a href="tel:${dial}">${dial}</a>`);
        const [open, close] = ENDS[i % ENDS.length];
        return `${open}${body}${close}`;
    }).join('');

    // Something left of a dial string: a pause or code touching a digit.
    const DIAL_LEFT = /\d[,;]+[\d#*]|\d#|[#*]\d/;

    for (const [service, { lines, secrets, kept }] of Object.entries(INVITES)) {
        for (const [form, description] of [['plain text', lines.join('\n')], ['HTML', toHtml(lines)]]) {
            test(`${service}, ${form}: no code or dial string survives; agenda and meeting details stay`, () => {
                const inv = build({ description, location: service === 'Zoom' ? lines[7] : '' });
                const json = JSON.stringify(inv);
                for (const secret of secrets)
                    assert.ok(!json.includes(secret), `${secret} survived: ${inv.description}`);
                assert.ok(!DIAL_LEFT.test(json), inv.description);
                for (const line of [...AGENDA, ...kept])
                    assert.ok(inv.description.includes(line), `${line} lost: ${inv.description}`);
                assert.ok(!inv.description.endsWith('…'), 'the description must not be capped for this check');
                assert.deepEqual(validateInvite(inv), { ok: true });
            });
        }
    }
});

describe('buildInvite: no catastrophic backtracking on 1 000 000 characters', () => {
    const N = 1_000_000;
    const fill = unit => unit.repeat(Math.ceil(N / unit.length)).slice(0, N);
    const INPUTS = {
        'one digit run': fill('1'),
        'digits split by spaces': fill('1 '),
        'digits split by three separators': fill('1-()'),
        'numbers each ending with a pause': fill('1234567,'),
        'plus signs and digits': fill('+1'),
        'a pause run after a number': '1234567' + fill(','),
        '"<br" then spaces': '<br' + fill(' '),
        '"</p" then spaces': '</p' + fill(' '),
        'a keyword then separators to the end': 'Passcode' + fill(' :\n'),
        'a keyword then punctuation to the end': 'Passcode' + fill('.'),
        'keywords on every line': fill('pin\n'),
        'invisible marks': fill('\u200B'),
        'tags that never close': fill('<a '),
        'tag names that never end': fill('<abcdefgh'),
        'entities that never end': fill('&#'),
        'digits split by a list marker and a plus': fill('1. +'),
        'digits after one pause each': fill('1,'),
        'percent codes after a digit': fill('1%2C'),
        'no-break spaces between digits': fill('1\u00A0'),
        'spaces before pauses': fill('1234567 ,'),
        'a mixed invite repeated': fill('Passcode: 654321<br>+16699006833,,81234567890#,,,,*654321# PIN\n'),
    };

    for (const [name, text] of Object.entries(INPUTS)) {
        test(`${name}: under 200 ms`, () => {
            const t = performance.now();
            build({ description: text });
            const ms = performance.now() - t;
            assert.ok(ms < 200, `${name} took ${ms.toFixed(0)} ms`);
        });
    }
});

describe('buildInvite: argument checks', () => {
    for (const [name, cal, off] of [['calendarName 5', 5, 0], ['offset 1.5', 'Work', 1.5], ['offset 900', 'Work', 900],
        ['offset -841', 'Work', -841]]) {
        test(`${name} throws TypeError`, () => {
            assert.throws(() => buildInvite(event(), IDENT, cal, off), TypeError);
        });
    }

    for (const start of [NaN, Infinity, -Infinity, undefined, '2026-09-28']) {
        test(`start ${String(start)} throws TypeError`, () => {
            assert.throws(() => build({ start }), TypeError);
        });
    }

    test('offsets at the limits are accepted', () => {
        assert.equal(build({}, 'Work', 840).start, '2026-09-29 Tue 04:00');
        assert.equal(build({}, 'Work', -840).start, '2026-09-28 Mon 00:00');
    });
});
