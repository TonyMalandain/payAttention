// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The preview's command-line rules and fixed texts (interfaces.md §7.3).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    EXIT, STOP_SIGNALS, NOT_INSTALLED_TEXT, USAGE, signalExitCode, parseArgs, internalErrorText,
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
});
