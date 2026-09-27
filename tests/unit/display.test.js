// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Time formatting depends on the zone; fix it before the module is loaded.
process.env.TZ = 'UTC';
const {
    oneLine, formatShort, formatCountdown, formatRelative, formatClock, formatSince,
    calendarLabel, stepHeadline, countdownCaption, parseList, normalizeDomains, normalizeAddresses,
} = await import('../../extension/core/display.js');

const MIN = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR;
const MORNING = Date.UTC(2026, 8, 28, 10, 30, 0);

describe('oneLine', () => {
    test('collapses every whitespace run, newlines included, and trims', () => {
        assert.equal(oneLine('  Client\n\n sync\t now ', 100), 'Client sync now');
    });

    test('empty text gives (no title)', () => {
        assert.equal(oneLine('', 10), '(no title)');
        assert.equal(oneLine(' \n ', 10), '(no title)');
    });

    test('longer than maxChars is cut to maxChars - 1 plus an ellipsis', () => {
        assert.equal(oneLine('abcdefghij', 5), 'abcd…');
        assert.equal(oneLine('abcde', 5), 'abcde');
    });
});

describe('formatShort', () => {
    test('zero or less is now', () => {
        assert.equal(formatShort(0), 'now');
        assert.equal(formatShort(-5000), 'now');
    });

    test('under an hour is whole minutes, rounded up', () => {
        assert.equal(formatShort(1), '1m');
        assert.equal(formatShort(24 * MIN), '24m');
        assert.equal(formatShort(23 * MIN + 1), '24m');
        assert.equal(formatShort(59 * MIN), '59m');
    });

    test('an hour or more is h and zero-padded minutes', () => {
        assert.equal(formatShort(3_900_000), '1h 05m');
        assert.equal(formatShort(60 * MIN), '1h 00m');
        assert.equal(formatShort(12 * HOUR), '12h 00m');
    });
});

describe('formatCountdown', () => {
    test('the examples', () => {
        assert.equal(formatCountdown(45_000), '0:45');
        assert.equal(formatCountdown(44_001), '0:45');
        assert.equal(formatCountdown(0), '0:00');
        assert.equal(formatCountdown(-130_000), '−2:10');
        assert.equal(formatCountdown(3_725_000), '1:02:05');
    });

    test('a negative value rounds towards zero and uses the minus sign U+2212', () => {
        assert.equal(formatCountdown(-999), '−0:00');
        assert.equal(formatCountdown(-1000), '−0:01');
    });
});

describe('formatRelative', () => {
    test('a minute or more ahead is "in N min", rounded up', () => {
        assert.equal(formatRelative(60_000), 'in 1 min');
        assert.equal(formatRelative(23 * MIN + 1), 'in 24 min');
    });

    test('less than a minute ahead', () => {
        assert.equal(formatRelative(0), 'in less than a minute');
        assert.equal(formatRelative(59_999), 'in less than a minute');
    });

    test('less than a minute ago is just now', () => {
        assert.equal(formatRelative(-1), 'just now');
        assert.equal(formatRelative(-59_999), 'just now');
    });

    test('a minute or more ago is "N min ago", rounded down', () => {
        assert.equal(formatRelative(-60_000), '1 min ago');
        assert.equal(formatRelative(-3 * MIN - 59_000), '3 min ago');
    });
});

describe('formatClock', () => {
    test('a 10:30 UTC time contains 10:30', () => {
        assert.ok(formatClock(MORNING).includes('10:30'), formatClock(MORNING));
    });
});

describe('formatSince', () => {
    const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    test('earlier the same day is the clock time', () => {
        assert.equal(formatSince(MORNING - HOUR, MORNING), formatClock(MORNING - HOUR));
    });

    test('yesterday is the weekday and time', () => {
        assert.equal(formatSince(MORNING - DAY, MORNING), WEEKDAY.format(MORNING - DAY));
    });

    test('ten days ago is the date and time', () => {
        assert.equal(formatSince(MORNING - 10 * DAY, MORNING), DATE.format(MORNING - 10 * DAY));
    });

    test('exactly local midnight counts as today', () => {
        const midnight = Date.UTC(2026, 8, 28, 0, 0, 0);
        assert.equal(formatSince(midnight, MORNING), formatClock(midnight));
    });
});

describe('calendarLabel', () => {
    test('the examples', () => {
        assert.equal(calendarLabel('Work'), 'Work calendar');
        assert.equal(calendarLabel('Calendar'), 'Calendar');
        assert.equal(calendarLabel('Team Calendar'), 'Team Calendar');
        assert.equal(calendarLabel('  '), 'Unnamed calendar');
    });

    test('whitespace is collapsed and the name limited to 40 characters', () => {
        assert.equal(calendarLabel(' My \n Work '), 'My Work calendar');
        const long = 'x'.repeat(50);
        assert.equal(calendarLabel(long), 'x'.repeat(39) + '… calendar');
    });

    test('a word merely ending in calendar is not the word calendar', () => {
        assert.equal(calendarLabel('Mycalendar'), 'Mycalendar calendar');
    });
});

describe('stepHeadline', () => {
    test('steps 1 and 2 are the same for both modes', () => {
        for (const mode of ['online', 'in-person']) {
            assert.equal(stepHeadline(1, mode), 'Heads-up');
            assert.equal(stepHeadline(2, mode), 'Get ready');
        }
    });

    test('steps 3 and 4 depend on the mode', () => {
        assert.equal(stepHeadline(3, 'online'), 'About to start');
        assert.equal(stepHeadline(3, 'in-person'), 'Time to leave');
        assert.equal(stepHeadline(4, 'online'), 'Your meeting is starting');
        assert.equal(stepHeadline(4, 'in-person'), 'Leave now');
    });
});

describe('countdownCaption', () => {
    test('online', () => {
        assert.equal(countdownCaption('online', 0), 'until it starts');
        assert.equal(countdownCaption('online', -1), 'since it started');
    });

    test('in person', () => {
        assert.equal(countdownCaption('in-person', 5000), 'until you must leave');
        assert.equal(countdownCaption('in-person', -5000), 'since you should have left');
    });
});

describe('parseList', () => {
    test('splits on commas and newlines, trims, collapses and drops empties', () => {
        assert.deepEqual(parseList(' board ,\n  all  hands ,, \n'), ['board', 'all hands']);
    });

    test('removes case-insensitive duplicates, keeping the first spelling', () => {
        assert.deepEqual(parseList('Board, board, BOARD, focus'), ['Board', 'focus']);
    });

    test('empty text gives an empty list', () => {
        assert.deepEqual(parseList(''), []);
    });
});

describe('normalizeDomains', () => {
    test('lowercases and strips one leading @', () => {
        assert.deepEqual(normalizeDomains(['@Acme.Test', 'example.org']), ['acme.test', 'example.org']);
    });

    test('drops items with an @ inside, a space, or no dot, and duplicates', () => {
        assert.deepEqual(normalizeDomains(['me@acme.test', 'acme test.org', 'localhost', 'acme.test', 'ACME.test', '@@acme.test']),
            ['acme.test']);
    });
});

describe('normalizeAddresses', () => {
    test('lowercases and strips a leading mailto:', () => {
        assert.deepEqual(normalizeAddresses(['mailto:Me@Acme.Test', 'you@example.org']), ['me@acme.test', 'you@example.org']);
    });

    test('keeps only address-shaped items, without duplicates', () => {
        assert.deepEqual(normalizeAddresses(['acme.test', 'me@acme', 'a b@acme.test', 'me@acme.test', 'ME@acme.test']),
            ['me@acme.test']);
    });
});
