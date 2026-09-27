// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    PROTOCOL_VERSION, MAX_LINE_LENGTH, CONNECTION_STATES, parseHelperLine, formatHelperMessage, parseShellLine, formatShellMessage,
    HELPER_ENV_UNSET,
} from '../../extension/core/protocol.js';
import { event, snapshot, att } from './support/builders.js';

const fixturePath = path.resolve(import.meta.dirname, '../fixtures/snapshot-sample.json');

/** A valid snapshot with `mutate` applied, as a helper line. */
function snapLine(mutate) {
    // Cloned so mutations never reach the shared SOURCE builder object.
    const snap = JSON.parse(JSON.stringify(snapshot([event()])));
    mutate(snap);
    return JSON.stringify(snap);
}

function invalidSnapshot(field) {
    return { ok: false, code: 'invalid-snapshot', field };
}

describe('helper protocol: hello and valid snapshots', () => {
    test('the protocol version is 1', () => {
        assert.equal(PROTOCOL_VERSION, 1);
    });

    test('a hello line parses', () => {
        assert.deepEqual(parseHelperLine('{"type":"hello","protocol":1}\n'),
            { ok: true, message: { type: 'hello', protocol: 1 } });
    });

    test('a hello with another protocol version is a mismatch', () => {
        assert.deepEqual(parseHelperLine('{"type":"hello","protocol":2}'), { ok: false, code: 'protocol-mismatch' });
    });

    test('the sample fixture is a valid snapshot', () => {
        const text = fs.readFileSync(fixturePath, 'utf8');
        const result = parseHelperLine(text.replace(/\n$/, ''));
        assert.equal(result.ok, true);
        assert.deepEqual(result.message, JSON.parse(text));
    });

    test('a built snapshot is valid and comes back unchanged', () => {
        const snap = snapshot([event()]);
        const result = parseHelperLine(JSON.stringify(snap));
        assert.equal(result.ok, true);
        assert.deepEqual(result.message, snap);
    });

    test('a CRLF line ending is accepted', () => {
        assert.equal(parseHelperLine(JSON.stringify(snapshot([event()])) + '\r\n').ok, true);
    });

    test('an unknown extra property is accepted and kept', () => {
        const result = parseHelperLine(snapLine(s => {
            s.events[0].x = 1;
        }));
        assert.equal(result.ok, true);
        assert.equal(result.message.events[0].x, 1);
    });
});

describe('helper protocol: envelope failures', () => {
    test('text that is not JSON is bad-json', () => {
        assert.deepEqual(parseHelperLine('not json'), { ok: false, code: 'bad-json' });
    });

    test('JSON that is not an object is bad-message', () => {
        assert.deepEqual(parseHelperLine('[1]'), { ok: false, code: 'bad-message' });
        assert.deepEqual(parseHelperLine('null'), { ok: false, code: 'bad-message' });
    });

    test('an unknown type is unknown-type', () => {
        assert.deepEqual(parseHelperLine('{"type":"nope"}'), { ok: false, code: 'unknown-type' });
    });

    test('a snapshot with another protocol version is a mismatch', () => {
        assert.deepEqual(parseHelperLine(snapLine(s => {
            s.protocol = 2;
        })), { ok: false, code: 'protocol-mismatch' });
    });

    test('a line longer than the maximum is too-large', () => {
        assert.deepEqual(parseHelperLine('x'.repeat(MAX_LINE_LENGTH + 1)), { ok: false, code: 'too-large' });
    });
});

describe('helper protocol: snapshot field failures name the first bad field', () => {
    const cases = [
        ['events', s => {
            delete s.events;
        }],
        ['events[0].start', s => {
            s.events[0].start = '10';
        }],
        ['events[0].uid', s => {
            s.events[0].uid = '';
        }],
        ['events[0].attendees[0].partstat', s => {
            s.events[0].attendees[0].partstat = 'maybe';
        }],
        ['events[0].attendees[0].cutype', s => {
            s.events[0].attendees[0].cutype = 'robot';
        }],
        ['events[0].organizer.email', s => {
            s.events[0].organizer = {};
        }],
        ['events[0].description', s => {
            s.events[0].description = 'x'.repeat(32769);
        }],
        ['events[0].conferenceUris[0]', s => {
            s.events[0].conferenceUris = [1];
        }],
        ['events[0].status', s => {
            s.events[0].status = 'gone';
        }],
        ['events[0].recurrenceId', s => {
            s.events[0].recurrenceId = 'x';
        }],
        ['sources[0].ok', s => {
            delete s.sources[0].ok;
        }],
        ['sources[0].ownerEmail', s => {
            s.sources[0].ownerEmail = 5;
        }],
        ['sources[0].remote', s => {
            s.sources[0].remote = 'yes';
        }],
        ['sources[0].connection', s => {
            s.sources[0].connection = 'online';
        }],
    ];
    for (const [field, mutate] of cases) {
        test(`a bad ${field} is reported by path`, () => {
            assert.deepEqual(parseHelperLine(snapLine(mutate)), invalidSnapshot(field));
        });
    }

    test('a source with remote and connection absent, null, or remote true with each connection state is accepted', () => {
        assert.equal(parseHelperLine(snapLine(() => {})).ok, true);
        assert.equal(parseHelperLine(snapLine(s => {
            s.sources[0].remote = null;
            s.sources[0].connection = null;
        })).ok, true);
        for (const state of CONNECTION_STATES) {
            assert.equal(parseHelperLine(snapLine(s => {
                s.sources[0].remote = true;
                s.sources[0].connection = state;
            })).ok, true, state);
        }
    });

    test('remote and connection are not cross-checked: remote false with connected is accepted', () => {
        assert.equal(parseHelperLine(snapLine(s => {
            s.sources[0].remote = false;
            s.sources[0].connection = 'connected';
        })).ok, true);
    });

    test('the connection states are the D-013 list, frozen', () => {
        assert.deepEqual([...CONNECTION_STATES],
            ['connected', 'connecting', 'disconnected', 'awaiting-credentials', 'ssl-failed', 'offline', 'unknown']);
        assert.ok(Object.isFrozen(CONNECTION_STATES));
    });

    test('a description of exactly the maximum length is accepted', () => {
        assert.equal(parseHelperLine(snapLine(s => {
            s.events[0].description = 'x'.repeat(32768);
        })).ok, true);
    });

    test('an attendee with every field valid but a bad role is reported', () => {
        const bad = att('z@acme.test');
        bad.role = 'boss';
        assert.deepEqual(parseHelperLine(snapLine(s => {
            s.events[0].attendees = [bad];
        })), invalidSnapshot('events[0].attendees[0].role'));
    });
});

describe('helper protocol: status messages', () => {
    test('a warn status with a slug code is valid', () => {
        assert.equal(parseHelperLine('{"type":"status","level":"warn","code":"source-timeout"}').ok, true);
    });

    test('an unknown level is invalid-status at level', () => {
        assert.deepEqual(parseHelperLine('{"type":"status","level":"info","code":"x"}'),
            { ok: false, code: 'invalid-status', field: 'level' });
    });

    test('a code that is not a slug is invalid-status at code', () => {
        assert.deepEqual(parseHelperLine('{"type":"status","level":"warn","code":"Bad Code"}'),
            { ok: false, code: 'invalid-status', field: 'code' });
    });
});

describe('helper protocol: no event content leaks', () => {
    const secretLine = () => snapLine(s => {
        s.events[0].summary = 'SECRET-TITLE';
        s.events[0].location = 'SECRET-PLACE';
        s.events[0].start = 'bad';
    });

    test('a failed validation carries paths only', () => {
        const text = JSON.stringify(parseHelperLine(secretLine()));
        assert.ok(!text.includes('SECRET-TITLE'));
        assert.ok(!text.includes('SECRET-PLACE'));
    });

    test('a refused format does not echo content in its error', () => {
        const msg = JSON.parse(secretLine());
        assert.throws(() => formatHelperMessage(msg), err => {
            assert.ok(err instanceof TypeError);
            assert.ok(!err.message.includes('SECRET-TITLE'));
            return true;
        });
    });
});

describe('helper protocol: formatting', () => {
    test('a formatted snapshot is one line that parses back', () => {
        const snap = snapshot([event()]);
        const line = formatHelperMessage(snap);
        assert.ok(line.endsWith('\n'));
        assert.deepEqual(parseHelperLine(line), { ok: true, message: snap });
    });

    test('an invalid message cannot be formatted', () => {
        assert.throws(() => formatHelperMessage({ type: 'status', level: 'info', code: 'x' }), err => {
            assert.ok(err instanceof TypeError);
            assert.ok(err.message.includes('invalid-status'));
            assert.ok(err.message.includes('level'));
            return true;
        });
    });
});

describe('shell protocol', () => {
    test('refresh for resume or manual parses', () => {
        assert.deepEqual(parseShellLine('{"type":"refresh","reason":"resume"}'),
            { ok: true, message: { type: 'refresh', reason: 'resume' } });
        assert.equal(parseShellLine('{"type":"refresh","reason":"manual"}').ok, true);
    });

    test('an unknown refresh reason is invalid-refresh at reason', () => {
        assert.deepEqual(parseShellLine('{"type":"refresh","reason":"other"}'),
            { ok: false, code: 'invalid-refresh', field: 'reason' });
    });

    test('the shell only sends refresh', () => {
        assert.deepEqual(parseShellLine('{"type":"hello","protocol":1}'), { ok: false, code: 'unknown-type' });
    });

    test('a refresh formats as one exact line', () => {
        assert.equal(formatShellMessage({ type: 'refresh', reason: 'manual' }), '{"type":"refresh","reason":"manual"}\n');
    });

    test('an invalid shell message cannot be formatted', () => {
        assert.throws(() => formatShellMessage({ type: 'refresh', reason: 'other' }), /invalid-refresh at reason/);
    });
});

describe('helper environment (interfaces.md §1 "Environment")', () => {
    test('every spawner removes exactly G_MESSAGES_DEBUG, from one frozen list', () => {
        assert.deepEqual(HELPER_ENV_UNSET, ['G_MESSAGES_DEBUG']);
        assert.ok(Object.isFrozen(HELPER_ENV_UNSET));
    });
});
