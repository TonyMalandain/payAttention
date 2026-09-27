// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The preview's command-line rules and fixed texts (interfaces.md §7.3).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    EXIT, STOP_SIGNALS, NOT_INSTALLED_TEXT, USAGE, signalExitCode, parseArgs, internalErrorText,
    meetingCount, progressText, unreadableCalendarText,
} from '../../extension/preview/cli.js';

describe('preview cli', () => {
    test('parseArgs: text by default, --json, --help and -h; anything else is a usage error', () => {
        assert.deepEqual(parseArgs([]), { format: 'text' });
        assert.deepEqual(parseArgs(['--json']), { format: 'json' });
        assert.deepEqual(parseArgs(['--help']), { help: true });
        assert.deepEqual(parseArgs(['-h']), { help: true });
        for (const argv of [['--json', '--json'], ['--jsn'], ['x'], ['--help', 'x'], ['--json', '--help']])
            assert.deepEqual(parseArgs(argv), { usageError: true }, JSON.stringify(argv));
    });

    test('a stop signal exits with 128 + its number', () => {
        assert.equal(signalExitCode(2), 130);
        assert.equal(signalExitCode(15), 143);
        assert.equal(signalExitCode(1), 129);
    });

    test('the stop signals are SIGHUP, SIGINT and SIGTERM, frozen', () => {
        assert.deepEqual(STOP_SIGNALS, [1, 2, 15]);
        assert.ok(Object.isFrozen(STOP_SIGNALS));
    });

    test('an internal error text is cleaned of terminal controls', () => {
        const text = internalErrorText(new Error('a\u001b[2Jb'));
        assert.ok(text.startsWith('payAttention preview: internal error: '));
        assert.ok(!text.includes('\u001b'));
        assert.ok(text.includes('a [2Jb'));
    });

    test('the usage text, exactly', () => {
        assert.equal(USAGE, [
            'Usage: gjs -m <payAttention install directory>/preview/main.js [--json]',
            'Shows what payAttention would decide for your upcoming meetings. Changes nothing.',
            '  --json   print one JSON object (version 1) instead of text',
            'Exit status: 0 printed, 1 usage or internal error, 2 not installed, 3 no calendar data within 30 s.',
        ].join('\n'));
    });

    test('the exit codes, frozen', () => {
        assert.deepEqual(EXIT, { printed: 0, error: 1, notInstalled: 2, noCalendar: 3 });
        assert.ok(Object.isFrozen(EXIT));
        assert.equal(NOT_INSTALLED_TEXT, 'payAttention is not installed');
    });

    test('a meeting count: singular for 1, plural otherwise', () => {
        assert.equal(meetingCount(1), '1 meeting');
        assert.equal(meetingCount(0), '0 meetings');
        assert.equal(meetingCount(2), '2 meetings');
    });

    test('the progress line counts the meetings waiting for the AI engine', () => {
        assert.equal(progressText(1), 'payAttention: asking the AI engine: 1 meeting waiting');
        assert.equal(progressText(3), 'payAttention: asking the AI engine: 3 meetings waiting');
    });

    test('an unreadable calendar in plain words, one phrase per calendar-helper source error', () => {
        assert.equal(unreadableCalendarText('Broken', 'connect-failed'), 'Could not read calendar "Broken": could not connect.');
        assert.equal(unreadableCalendarText('Slow', 'connect-timeout'), 'Could not read calendar "Slow": it did not answer in time.');
        assert.equal(unreadableCalendarText('Work', 'read-failed'), 'Could not read calendar "Work": could not read its meetings.');
    });

    test('an unknown or missing error gets a generic phrase, never the raw code', () => {
        assert.equal(unreadableCalendarText('Odd', 'no-backend'), 'Could not read calendar "Odd": something went wrong.');
        assert.equal(unreadableCalendarText('Odd', null), 'Could not read calendar "Odd": something went wrong.');
        // An inherited property name is not a known code either.
        assert.equal(unreadableCalendarText('Odd', 'toString'), 'Could not read calendar "Odd": something went wrong.');
    });

    test('the calendar name is cleaned of terminal controls', () => {
        const text = unreadableCalendarText('Bad\u001b[2J cal', 'connect-failed');
        assert.equal(text, 'Could not read calendar "Bad [2J cal": could not connect.');
    });
});
