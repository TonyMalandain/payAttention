// Display strings: numbers and raw calendar text turned into what the owner
// reads, and the comma lists typed in settings parsed back. Pure, shared by
// shell/view.js and prefs.js (boundaries.md).

// Built once: formatting options are static data, and the zone is the process's.
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const MINUTE = 60000;
const MINUS = '−';
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const collapse = text => text.replace(/\s+/g, ' ').trim();
const pad2 = n => String(n).padStart(2, '0');

function cut(text, maxChars) {
    return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
}

function unique(items, keyOf = x => x) {
    const seen = new Set();
    return items.filter(item => {
        const k = keyOf(item);
        if (seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
}

/**
 * Text on one line: whitespace runs collapsed, trimmed, and cut to maxChars
 * with an ellipsis.
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {string} '(no title)' for empty text
 */
export function oneLine(text, maxChars) {
    const line = collapse(text);
    return line === '' ? '(no title)' : cut(line, maxChars);
}

/**
 * The short top-bar countdown: 'now', '24m' or '1h 05m'.
 *
 * @param {number} ms time left
 * @returns {string}
 */
export function formatShort(ms) {
    if (ms <= 0)
        return 'now';
    const m = Math.ceil(ms / MINUTE);
    if (m < 60)
        return `${m}m`;
    return `${Math.floor(m / 60)}h ${pad2(m % 60)}m`;
}

/**
 * The takeover's big countdown: 'm:ss' or 'h:mm:ss', with '−' once past.
 *
 * @param {number} ms time left; negative when past
 * @returns {string}
 */
export function formatCountdown(ms) {
    const s = ms >= 0 ? Math.ceil(ms / 1000) : Math.floor(-ms / 1000);
    const sign = ms < 0 ? MINUS : '';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = pad2(s % 60);
    return h > 0 ? `${sign}${h}:${pad2(m)}:${ss}` : `${sign}${m}:${ss}`;
}

/**
 * A time relative to now: 'in 24 min', 'in less than a minute', 'just now', '3 min ago'.
 *
 * @param {number} ms time until the moment; negative when past
 * @returns {string}
 */
export function formatRelative(ms) {
    if (ms >= MINUTE)
        return `in ${Math.ceil(ms / MINUTE)} min`;
    if (ms >= 0)
        return 'in less than a minute';
    if (ms > -MINUTE)
        return 'just now';
    return `${Math.floor(-ms / MINUTE)} min ago`;
}

/**
 * The local time of day.
 *
 * @param {number} epochMs
 * @returns {string}
 */
export function formatClock(epochMs) {
    return CLOCK.format(epochMs);
}

/**
 * A past moment for "since …": the time today, the weekday and time within the
 * last week, or the date and time before that.
 *
 * @param {number} epochMs
 * @param {number} nowMs
 * @returns {string}
 */
export function formatSince(epochMs, nowMs) {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    if (epochMs >= d.getTime())
        return formatClock(epochMs);
    // Calendar arithmetic, not ms arithmetic, so a DST change is handled.
    d.setDate(d.getDate() - 6);
    if (epochMs >= d.getTime())
        return WEEKDAY.format(epochMs);
    return DATE.format(epochMs);
}

/**
 * A calendar's name as the owner reads it in a warning: 'Work' -> 'Work calendar'.
 *
 * @param {string} name
 * @returns {string}
 */
export function calendarLabel(name) {
    const line = collapse(name);
    if (line === '')
        return 'Unnamed calendar';
    const label = cut(line, 40);
    return /\bcalendar$/i.test(label) ? label : `${label} calendar`;
}

/**
 * The headline of an alert step.
 *
 * @param {1|2|3|4} step
 * @param {'online'|'in-person'} mode
 * @returns {string}
 */
export function stepHeadline(step, mode) {
    const online = mode === 'online';
    switch (step) {
    case 1:
        return 'Heads-up';
    case 2:
        return 'Get ready';
    case 3:
        return online ? 'About to start' : 'Time to leave';
    default:
        return online ? 'Your meeting is starting' : 'Leave now';
    }
}

/**
 * The words under the takeover countdown.
 *
 * @param {'online'|'in-person'} mode
 * @param {number} ms time left; negative when past
 * @returns {string}
 */
export function countdownCaption(mode, ms) {
    if (mode === 'online')
        return ms >= 0 ? 'until it starts' : 'since it started';
    return ms >= 0 ? 'until you must leave' : 'since you should have left';
}

/**
 * A list typed in settings: split on commas and newlines, trimmed, inner
 * whitespace collapsed, empties and case-insensitive duplicates removed.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseList(text) {
    const items = text.split(/[,\n]/).map(collapse).filter(item => item !== '');
    return unique(items, item => item.toLowerCase());
}

/**
 * Email domains: lowercased, one leading '@' removed; anything that is not a
 * bare domain is dropped.
 *
 * @param {string[]} items
 * @returns {string[]}
 */
export function normalizeDomains(items) {
    const domains = items
        .map(item => item.toLowerCase().replace(/^@/, ''))
        .filter(item => !item.includes('@') && !/\s/.test(item) && item.includes('.'));
    return unique(domains);
}

/**
 * Email addresses: lowercased, a leading 'mailto:' removed; anything not
 * address-shaped is dropped.
 *
 * @param {string[]} items
 * @returns {string[]}
 */
export function normalizeAddresses(items) {
    const addresses = items
        .map(item => item.toLowerCase().replace(/^mailto:/, ''))
        .filter(item => ADDRESS.test(item));
    return unique(addresses);
}
