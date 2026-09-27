// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The AI helper wire contract (interfaces.md §6.2, §6.6): text cleaning, the
// invite's shape and bounds, and (part 2) the messages both ends exchange.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_INVITE_BYTES, INVITE_CAPS, INVITE_FIELDS, cleanText, capText, utf8Length, normaliseReason, validateInvite,
    AI_PROTOCOL_VERSION, MAX_AI_LINE_LENGTH, AI_FAILURE_CODES,
    validateAiShellMessage, parseAiShellLine, formatAiShellMessage,
    validateAiHelperMessage, parseAiHelperLine, formatAiHelperMessage,
} from '../../extension/core/aiProtocol.js';

const MARKER = 'SECRET-MARKER-7f3a';

/** A valid invite, fresh on each call. */
function invite(over = {}) {
    return {
        title: 'Weekly sync', calendar: 'Work', start: '2026-09-28 Mon 10:00', minutes: 30, allDay: false,
        recurring: true, status: 'confirmed', busy: 'busy', description: 'Agenda', place: '',
        videoLink: 'https://zoom.us/j/1', you: { response: 'accepted', organiser: false },
        organiser: { name: 'Alice', email: 'alice@acme.test' },
        guests: [{ name: 'Bob', email: 'bob@acme.test', response: 'accepted', role: 'required' }],
        guestsTotal: 1,
        ...over,
    };
}

function isDeepFrozen(o) {
    if (typeof o !== 'object' || o === null)
        return true;
    return Object.isFrozen(o) && Object.values(o).every(isDeepFrozen);
}

describe('cleanText', () => {
    test('controls become spaces, whitespace collapses', () => {
        assert.equal(cleanText('a\nb\tc'), 'a b c');
        assert.equal(cleanText('  x   y  '), 'x y');
        assert.equal(cleanText('a\u0085b'), 'a b');
    });

    test('bidi controls and marks are removed', () => {
        assert.equal(cleanText('a\u202Eb\u2066c\u200Fd\u061Ce'), 'abcde');
    });

    test('a lone surrogate becomes U+FFFD', () => {
        assert.equal(cleanText('\ud800x'), '\uFFFDx');
    });
});

describe('capText', () => {
    test('within the cap it is unchanged', () => {
        const s = 'a'.repeat(200);
        assert.equal(capText(s, 200), s);
    });

    test('over the cap: max − 1 code points plus …', () => {
        const r = capText('a'.repeat(201), 200);
        assert.equal(r, 'a'.repeat(199) + '…');
        assert.equal(Array.from(r).length, 200);
    });

    test('counted in code points, never splitting a surrogate pair', () => {
        const r = capText('😀'.repeat(201), 200);
        assert.equal(r, '😀'.repeat(199) + '…');
    });

    test('trailing space is trimmed before the ellipsis', () => {
        assert.equal(capText('abc def', 5), 'abc…');
    });
});

describe('utf8Length', () => {
    test('bytes per character', () => {
        assert.equal(utf8Length('a'), 1);
        assert.equal(utf8Length('é'), 2);
        assert.equal(utf8Length('€'), 3);
        assert.equal(utf8Length('😀'), 4);
        assert.equal(utf8Length('\ud800'), 3);
        assert.equal(utf8Length('a😀é'), 7);
    });
});

describe('normaliseReason', () => {
    test('capped at 80 code points', () => {
        assert.equal(Array.from(normaliseReason('x'.repeat(10000))).length, 80);
    });

    test('empty after cleaning, or not a string, gives null', () => {
        assert.equal(normaliseReason('\n\t '), null);
        assert.equal(normaliseReason(5), null);
        assert.equal(normaliseReason(null), null);
    });

    test('markup is kept as text', () => {
        assert.equal(normaliseReason('<b>x</b>'), '<b>x</b>');
    });
});

describe('INVITE_FIELDS', () => {
    test('the keys and labels, in order, deep-frozen', () => {
        assert.deepEqual(INVITE_FIELDS, [
            { key: 'title', label: 'Title' },
            { key: 'calendar', label: 'Calendar name' },
            { key: 'start', label: 'Date and time' },
            { key: 'minutes', label: 'Length' },
            { key: 'allDay', label: 'Whether it is all-day' },
            { key: 'recurring', label: 'Whether it repeats' },
            { key: 'status', label: 'Status (confirmed or tentative)' },
            { key: 'busy', label: 'Busy or free' },
            { key: 'description', label: 'Description' },
            { key: 'place', label: 'Place' },
            { key: 'videoLink', label: 'Video link, without its passcode' },
            { key: 'you', label: 'Your response, and whether you organised it' },
            { key: 'organiser', label: "Organiser's name and email address" },
            { key: 'guests', label: "Guests' names, email addresses, responses and roles (up to 25)" },
            { key: 'guestsTotal', label: 'Number of guests' },
        ]);
        assert.ok(isDeepFrozen(INVITE_FIELDS));
    });

    test('INVITE_CAPS', () => {
        assert.deepEqual(INVITE_CAPS, { title: 200, calendar: 80, description: 1500, place: 200, videoLink: 300,
            name: 80, email: 254, guests: 25 });
        assert.ok(Object.isFrozen(INVITE_CAPS));
    });
});

describe('validateInvite', () => {
    test('a valid invite', () => {
        assert.deepEqual(validateInvite(invite()), { ok: true });
        assert.deepEqual(validateInvite(invite({ videoLink: null, organiser: null, guests: [], guestsTotal: 3 })),
            { ok: true });
        assert.deepEqual(validateInvite(invite({ start: '2026-09-28 Mon', allDay: true })), { ok: true });
    });

    const guest = { name: 'G', email: 'g@acme.test', response: 'accepted', role: 'required' };
    const bad = [
        ['an extra key', () => ({ ...invite(), joinUrl: MARKER }), 'joinUrl'],
        ['a missing calendar', () => { const i = invite(); delete i.calendar; return i; }, 'calendar'],
        ['a 201-character title', () => invite({ title: MARKER + 'x'.repeat(201) }), 'title'],
        ['a title with a newline', () => invite({ title: `a\n${MARKER}` }), 'title'],
        ['a bad start', () => invite({ start: '2026-9-28 Mon 10:00' }), 'start'],
        ['negative minutes', () => invite({ minutes: -1 }), 'minutes'],
        ['fractional minutes', () => invite({ minutes: 1.5 }), 'minutes'],
        ['a bad status', () => invite({ status: 'x' }), 'status'],
        ['a bad busy', () => invite({ busy: 'opaque' }), 'busy'],
        ['a videoLink with a query', () => invite({ videoLink: `https://zoom.us/j/1?pwd=${MARKER}` }), 'videoLink'],
        ['an http videoLink', () => invite({ videoLink: 'http://zoom.us/j/1' }), 'videoLink'],
        ["you.response 'maybe'", () => invite({ you: { response: 'maybe', organiser: false } }), 'you.response'],
        ['you with an extra key', () => invite({ you: { response: 'accepted', organiser: false, x: MARKER } }), 'you'],
        ['organiser with an extra key', () => invite({ organiser: { name: 'A', email: 'a@acme.test', x: MARKER } }),
            'organiser'],
        ['26 guests', () => invite({ guests: Array(26).fill(guest), guestsTotal: 26 }), 'guests'],
        ['a guest role req-participant', () => invite({ guests: [{ ...guest, role: 'req-participant' }] }),
            'guests[0].role'],
        ['guestsTotal below guests.length', () => invite({ guestsTotal: 0 }), 'guestsTotal'],
        ['a boolean allDay that is a string', () => invite({ allDay: 'false' }), 'allDay'],
        ['a guest email over 254', () => invite({ guests: [{ ...guest, email: 'e'.repeat(255) }] }),
            'guests[0].email'],
        ['an organiser name with a bidi control', () => invite({ organiser: { name: 'A\u202E', email: 'a@acme.test' } }),
            'organiser.name'],
    ];
    for (const [name, make, field] of bad) {
        test(`${name} → bad-invite at ${JSON.stringify(field)}`, () => {
            const r = validateInvite(make());
            assert.deepEqual(r, { ok: false, code: 'bad-invite', field });
            assert.ok(!JSON.stringify(r).includes(MARKER));
        });
    }

    test('an invite over 8 192 bytes built from capped fields → bad-invite at ""', () => {
        const g = i => ({ name: '😀'.repeat(80), email: `${i}`.padEnd(254, 'e'), response: 'accepted', role: 'required' });
        const big = invite({ guests: Array.from({ length: 25 }, (_, i) => g(i)), guestsTotal: 25 });
        assert.ok(utf8Length(JSON.stringify(big)) > MAX_INVITE_BYTES);
        assert.deepEqual(validateInvite(big), { ok: false, code: 'bad-invite', field: '' });
    });

    test('not an object', () => {
        for (const v of [null, [], 'x', 5])
            assert.deepEqual(validateInvite(v), { ok: false, code: 'bad-invite', field: '' });
    });
});

// ---- Part 2: the messages (interfaces.md §6.6). Exactly their keys, both directions.

const CONFIGURE = { type: 'configure', protocol: 1, endpoint: 'http://127.0.0.1:11434/v1', model: 'm', timeoutMs: 90000 };
const fails = (code, field) => (field === undefined ? { ok: false, code } : { ok: false, code, field });

describe('shell → helper: configure', () => {
    test('the default endpoint is ok', () => {
        assert.deepEqual(validateAiShellMessage(CONFIGURE), { ok: true, message: CONFIGURE });
        assert.equal(AI_PROTOCOL_VERSION, 1);
    });

    const bad = [
        ['a non-normalised endpoint', { endpoint: 'http://127.0.0.1:11434/v1/' }, 'endpoint'],
        ['an http public endpoint', { endpoint: 'http://api.example.test/v1' }, 'endpoint'],
        ['timeoutMs 999', { timeoutMs: 999 }, 'timeoutMs'],
        ['timeoutMs 120001', { timeoutMs: 120001 }, 'timeoutMs'],
        ['timeoutMs 1.5', { timeoutMs: 1000.5 }, 'timeoutMs'],
        ['an empty model', { model: '' }, 'model'],
        ['an untrimmed model', { model: ' m' }, 'model'],
        ['an extra key: the API key never travels here', { key: MARKER }, 'key'],
    ];
    for (const [name, over, field] of bad) {
        test(`${name} → invalid-configure at ${field}`, () => {
            const r = validateAiShellMessage({ ...CONFIGURE, ...over });
            assert.deepEqual(r, fails('invalid-configure', field));
            assert.ok(!JSON.stringify(r).includes(MARKER));
        });
    }

    test('another protocol → protocol-mismatch', () => {
        assert.deepEqual(validateAiShellMessage({ ...CONFIGURE, protocol: 2 }), fails('protocol-mismatch'));
    });

    test('limits 1000 and 120000 are ok', () => {
        assert.equal(validateAiShellMessage({ ...CONFIGURE, timeoutMs: 1000 }).ok, true);
        assert.equal(validateAiShellMessage({ ...CONFIGURE, timeoutMs: 120000 }).ok, true);
    });
});

describe('shell → helper: judge and probe', () => {
    test('judge is ok', () => {
        const m = { type: 'judge', id: 'occ-1.a_B', invite: invite() };
        assert.deepEqual(validateAiShellMessage(m), { ok: true, message: m });
    });

    test('a bad id → invalid-judge at id', () => {
        for (const id of ['', 'a b', 'x'.repeat(65), 5, 'occ:1|2'])
            assert.deepEqual(validateAiShellMessage({ type: 'judge', id, invite: invite() }), fails('invalid-judge', 'id'));
    });

    test('an invite with an extra key → bad-invite at invite.joinUrl', () => {
        const r = validateAiShellMessage({ type: 'judge', id: 'a', invite: { ...invite(), joinUrl: MARKER } });
        assert.deepEqual(r, fails('bad-invite', 'invite.joinUrl'));
    });

    test('a nested invite path', () => {
        const r = validateAiShellMessage({ type: 'judge', id: 'a', invite: invite({ you: { response: 'x', organiser: false } }) });
        assert.deepEqual(r, fails('bad-invite', 'invite.you.response'));
    });

    test('judge with an extra key → invalid-judge', () => {
        assert.deepEqual(validateAiShellMessage({ type: 'judge', id: 'a', invite: invite(), key: MARKER }),
            fails('invalid-judge', 'key'));
    });

    test('probe is ok; with an extra key it is refused', () => {
        assert.equal(validateAiShellMessage({ type: 'probe', id: 'p1' }).ok, true);
        assert.deepEqual(validateAiShellMessage({ type: 'probe', id: 'p1', invite: invite() }), fails('invalid-probe', 'invite'));
        assert.deepEqual(validateAiShellMessage({ type: 'probe', id: '' }), fails('invalid-probe', 'id'));
    });
});

describe('helper → shell', () => {
    test('hello', () => {
        assert.equal(validateAiHelperMessage({ type: 'hello', protocol: 1 }).ok, true);
        assert.deepEqual(validateAiHelperMessage({ type: 'hello', protocol: 2 }), fails('protocol-mismatch'));
        assert.deepEqual(validateAiHelperMessage({ type: 'hello', protocol: 1, x: 1 }), fails('protocol-mismatch'));
    });

    test('verdict is ok', () => {
        const m = { type: 'verdict', id: 'a', verdict: 'ignore', reason: 'a hold' };
        assert.deepEqual(validateAiHelperMessage(m), { ok: true, message: m });
    });

    const badVerdicts = [
        ['an unnormalised reason', { reason: ' a  hold' }, 'reason'],
        ['an 81-character reason', { reason: 'r'.repeat(81) }, 'reason'],
        ["'MUST'", { verdict: 'MUST' }, 'verdict'],
        ['an extra key', { joinUrl: MARKER }, 'joinUrl'],
        ['a bad id', { id: 'a b' }, 'id'],
    ];
    for (const [name, over, field] of badVerdicts) {
        test(`verdict with ${name} → invalid-verdict at ${field}`, () => {
            const r = validateAiHelperMessage({ type: 'verdict', id: 'a', verdict: 'must', reason: 'r', ...over });
            assert.deepEqual(r, fails('invalid-verdict', field));
            assert.ok(!JSON.stringify(r).includes(MARKER));
        });
    }

    for (const code of AI_FAILURE_CODES) {
        test(`failed ${code} is ok`, () => {
            assert.equal(validateAiHelperMessage({ type: 'failed', id: 'a', code }).ok, true);
        });
    }

    test('retryAfterS only with rate-limited, an integer 0..86400', () => {
        assert.equal(validateAiHelperMessage({ type: 'failed', id: 'a', code: 'rate-limited', retryAfterS: 30 }).ok, true);
        assert.equal(validateAiHelperMessage({ type: 'failed', id: 'a', code: 'rate-limited', retryAfterS: 0 }).ok, true);
        assert.equal(validateAiHelperMessage({ type: 'failed', id: 'a', code: 'rate-limited', retryAfterS: 86400 }).ok, true);
        for (const [code, retryAfterS] of [['timeout', 30], ['rate-limited', -1], ['rate-limited', 1.5], ['rate-limited', 86401]]) {
            assert.deepEqual(validateAiHelperMessage({ type: 'failed', id: 'a', code, retryAfterS }),
                fails('invalid-failed', 'retryAfterS'), `${code} ${retryAfterS}`);
        }
    });

    test('failed with an unknown code, or an extra message key', () => {
        assert.deepEqual(validateAiHelperMessage({ type: 'failed', id: 'a', code: 'oops' }), fails('invalid-failed', 'code'));
        assert.deepEqual(validateAiHelperMessage({ type: 'failed', id: 'a', code: 'server', message: MARKER }),
            fails('invalid-failed', 'message'));
    });

    test('AI_FAILURE_CODES is frozen', () => {
        assert.ok(Object.isFrozen(AI_FAILURE_CODES));
        assert.equal(AI_FAILURE_CODES.length, 10);
    });
});

describe('lines', () => {
    test('not an object, and an unknown type', () => {
        for (const v of [null, [], 'x', 5]) {
            assert.deepEqual(validateAiShellMessage(v), fails('bad-message'));
            assert.deepEqual(validateAiHelperMessage(v), fails('bad-message'));
        }
        assert.deepEqual(validateAiShellMessage({ type: 'hello', protocol: 1 }), fails('unknown-type'));
        assert.deepEqual(validateAiHelperMessage({ type: 'judge', id: 'a' }), fails('unknown-type'));
    });

    test('bad-json and too-large', () => {
        assert.deepEqual(parseAiShellLine('{nope'), fails('bad-json'));
        assert.deepEqual(parseAiHelperLine('{nope'), fails('bad-json'));
        const long = JSON.stringify({ type: 'probe', id: 'a', pad: 'p'.repeat(MAX_AI_LINE_LENGTH) });
        assert.deepEqual(parseAiShellLine(long), fails('too-large'));
        assert.deepEqual(parseAiHelperLine(long), fails('too-large'));
    });

    test('a line with its newline parses', () => {
        assert.equal(parseAiHelperLine('{"type":"hello","protocol":1}\r\n').ok, true);
    });

    test('format throws TypeError naming the code and path, never the value', () => {
        assert.throws(() => formatAiShellMessage({ ...CONFIGURE, key: MARKER }), e =>
            e instanceof TypeError && /invalid-configure/.test(e.message) && /key/.test(e.message) && !e.message.includes(MARKER));
        assert.throws(() => formatAiHelperMessage({ type: 'verdict', id: 'a', verdict: 'must', reason: MARKER + '\n' }), e =>
            e instanceof TypeError && /invalid-verdict/.test(e.message) && /reason/.test(e.message) && !e.message.includes(MARKER));
    });

    test('round trip', () => {
        const shell = [CONFIGURE, { type: 'judge', id: 'a', invite: invite() }, { type: 'probe', id: 'p' }];
        for (const m of shell) {
            const line = formatAiShellMessage(m);
            assert.ok(line.endsWith('\n'));
            assert.deepEqual(parseAiShellLine(line), { ok: true, message: m });
        }
        const helper = [{ type: 'hello', protocol: 1 }, { type: 'verdict', id: 'a', verdict: 'must', reason: 'r' },
            { type: 'failed', id: 'a', code: 'rate-limited', retryAfterS: 5 }];
        for (const m of helper)
            assert.deepEqual(parseAiHelperLine(formatAiHelperMessage(m)), { ok: true, message: m });
    });
});
