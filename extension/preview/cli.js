// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The preview's command-line rules and fixed texts (interfaces.md §7.3), with the
// shared wording the run and the report print. Gi-free, so Node tests them.
import { cleanText } from '../core/aiProtocol.js';

export const EXIT = Object.freeze({ printed: 0, error: 1, notInstalled: 2, noCalendar: 3 });
/** SIGHUP (terminal closed), SIGINT, SIGTERM. */
export const STOP_SIGNALS = Object.freeze([1, 2, 15]);
export const NOT_INSTALLED_TEXT = 'payAttention is not installed';
export const USAGE = [
    'Usage: gjs -m <payAttention install directory>/preview/main.js [--json]',
    'Shows what payAttention would decide for your upcoming meetings. Changes nothing.',
    '  --json   print one JSON object (version 1) instead of text',
    'Exit status: 0 printed, 1 usage or internal error, 2 not installed, 3 no calendar data within 30 s.',
].join('\n');

/**
 * @param {number} signum
 * @returns {number} 128 + signum, the shell convention
 */
export function signalExitCode(signum) {
    return 128 + signum;
}

/**
 * @param {string[]} argv System.programArgs
 * @returns {{format: 'text'|'json'} | {help: true} | {usageError: true}}
 *   [] → text; ['--json'] → json; ['--help'] or ['-h'] → help; anything else → usageError
 */
export function parseArgs(argv) {
    if (argv.length === 0)
        return { format: 'text' };
    if (argv.length === 1 && argv[0] === '--json')
        return { format: 'json' };
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h'))
        return { help: true };
    return { usageError: true };
}

/**
 * @param {unknown} error
 * @returns {string} 'payAttention preview: internal error: ' + cleanText(String(error))
 */
export function internalErrorText(error) {
    return 'payAttention preview: internal error: ' + cleanText(String(error));
}

/**
 * @param {number} n
 * @returns {string} '1 meeting', else '<n> meetings'
 */
export function meetingCount(n) {
    return n === 1 ? '1 meeting' : `${n} meetings`;
}

/**
 * The stderr line while the run waits for the AI engine: counts only.
 *
 * @param {number} pending
 * @returns {string}
 */
export function progressText(pending) {
    return `payAttention: asking the AI engine: ${meetingCount(pending)} waiting`;
}

// The calendar helper's source error codes (helper/messages.js SOURCE_ERRORS), in plain words.
// Repeated as strings because preview/ may not import helper/ (boundaries.md).
const SOURCE_ERROR_PHRASES = new Map([
    ['connect-timeout', 'it did not answer in time'],
    ['connect-failed', 'could not connect'],
    ['read-failed', 'could not read its meetings'],
]);
const UNKNOWN_SOURCE_ERROR_PHRASE = 'something went wrong';

/**
 * One footer line for a calendar the helper could not read. The code itself is
 * never printed: --json carries it.
 *
 * @param {string} name the source's display name
 * @param {string|null} error the source's error code
 * @returns {string} 'Could not read calendar "<name>": <plain reason>.'
 */
export function unreadableCalendarText(name, error) {
    const reason = SOURCE_ERROR_PHRASES.get(error) ?? UNKNOWN_SOURCE_ERROR_PHRASE;
    return `Could not read calendar "${cleanText(name)}": ${reason}.`;
}
