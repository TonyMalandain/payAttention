// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Turning one occurrence into the bounded invite the AI engine sees
// (interfaces.md §6.2; D-020, D-022, D-024, D-025, D-027, D-029, D-030). Pure.
import { INVISIBLE_MARKS, INVITE_CAPS, MAX_INVITE_BYTES, capText, cleanText, utf8Length } from './aiProtocol.js';
import { ownerFacts, ownerResponse, guestAttendees, normaliseAddress } from './owner.js';
import { detectAttendance } from './attendance.js';
import { withoutQuery, withoutConferenceQueries } from './links.js';

const MINUTE = 60000;
const MAX_OFFSET_MINUTES = 840;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BUSY = { opaque: 'busy', transparent: 'free' };
const ROLES = { 'chair': 'chair', 'req-participant': 'required', 'opt-participant': 'optional' };

// D-025 as D-027 reads it: after one of these words (whole word, any case; plurals
// too, D-029), the separators and the filler words "is" and "code" are kept, and the
// rest of that line goes. The lookahead-and-backreference makes the separator run
// atomic, so the removed part never starts with a separator. Whitespace in the run
// includes line breaks, so a value alone on the next line ("Passcode:\n123456") is
// still removed.
// A rest with no letter or digit ("Forgot your password.") holds no code and stays.
// Run before cleanText, which would join the lines.
const TEXT_PASSCODE = /\b(passcodes?|passwords?|pwd|pins?)\b(?=((?:[\s:=#-]|\b(?:is|code)\b)*))\2(?=[^\r\n]*[\p{L}\p{N}])[^\r\n]+/giu;

// D-029, D-030: a phone dial-in string is a phone number (an optional "tel:" and "+",
// then at least 7 digits, groups split by up to 3 of space, tab, ".", "-", "(" or ")")
// followed by a code: "#" or "*" right after the last digit, or a pause ("," or ";",
// after up to 3 spaces or tabs) with a digit, "#" or "*" right after it. The whole
// string, codes included, goes. A plain number, one followed by ", " as in a list, or
// one followed by a space and then "#" or "*" ("Order 1234567 #urgent") stays.
// Short plain codes ("ext #12", "Room 4#", a bare "812345#") are not caught: with
// fewer than 7 digits they cannot be told from room numbers, amounts and extensions,
// and a labelled code is caught by TEXT_PASSCODE instead. Removal is best effort (D-030).
// DIAL_NUMBER finds each number once and the scan resumes after it, so a long digit
// run is read once, and a number after a list marker or a digit ("1. +1 646…",
// "2 (+1) 646…") is still found; DIAL_CODE is then tried where the number ends.
const DIAL_NUMBER = /(?:\btel:)?\+?\d(?:[ \t.()-]{0,3}\d)*/gi;
const DIAL_CODE = /(?:[ \t]{0,3}[,;]+[\d#*]|[#*])/y;
const DIAL_REST = /[\d,;#*]*/y;
const DIAL_MIN_DIGITS = 7;

// D-030: separators a dial string may be written with, made plain before matching.
const NO_BREAK_SPACES = /[\u00A0\u202F]/g;
const HYPHENS = /[\u2010\u2011]/g;

// D-030: percent-encoded pauses and codes ("%2C", "%3B", "%23", "%2A") in a dial
// string or tel: link, decoded before matching. Only after a digit or another of
// them, so other text with a "%" is left alone.
const PERCENT_DIAL = /[\d,;#*](?:%(?:2C|3B|23|2A)[\d,;#*]*)+/gi;
const PERCENT_CHARS = { '2C': ',', '3B': ';', '23': '#', '2A': '*' };

// D-030: HTML to plain text before any removal rule. Comments, and <style> and <script>
// with their contents, go first; then conditional comment markers. A line-ending tag
// becomes a line break, so TEXT_PASSCODE stops there (cleanText turns the break into a
// space); every other tag, namespaced ones such as <o:p> too, goes. A tag name must end
// at a space, "/" or ">", and a namespace needs a letter after the ":", so
// "<https://…>" and "a < b" stay as text; stopping at the next "<" keeps the scan linear.
const HTML_TAG = /<(\/?)([a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?)(?=[\s/>])[^<>]*>/gi;
const LINE_END_CLOSERS = new Set(['p', 'li', 'div', 'tr', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const LINE_END_OPENERS = new Set(['br', 'p', 'div', 'li']);
const CONDITIONAL_MARK = /<!\[(?:if\b[^<>]*|endif)\]>/gi;

// D-030: blocks dropped with their contents. Each opener is paired with its closer. An
// unclosed one is left as text for the removal rules to read (its tag then goes as any
// tag). Once a kind is found unclosed no later one of that kind can close either, so it
// is not searched for again: that keeps the scan linear.
const BLOCK_OPEN = /<!--|<(style|script)(?=[\s/>])[^<>]*>/gi;
const BLOCK_CLOSE = { '<!--': /-->/g, 'style': /<\/style\s*>/gi, 'script': /<\/script\s*>/gi };

// D-030: entities decoded after the tags are gone, in one pass, so "&lt;br&gt;" is text
// and "&amp;#8203;" stays "&#8203;". One that names no character stays as written.
const HTML_ENTITY = /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|(nbsp|shy|amp|lt|gt|quot|apos));/g;
const NAMED_ENTITIES = { nbsp: '\u00A0', shy: '\u00AD', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function lineEndOrNothing(tag, closing, name) {
    const n = name.toLowerCase();
    return (closing ? LINE_END_CLOSERS : LINE_END_OPENERS).has(n) ? '\n' : '';
}

function withoutBlocks(text) {
    const unclosed = new Set();
    let out = '';
    let from = 0;
    BLOCK_OPEN.lastIndex = 0;
    for (let m = BLOCK_OPEN.exec(text); m !== null; m = BLOCK_OPEN.exec(text)) {
        const kind = m[1]?.toLowerCase() ?? m[0];
        if (unclosed.has(kind))
            continue;
        const close = BLOCK_CLOSE[kind];
        close.lastIndex = BLOCK_OPEN.lastIndex;
        if (!close.test(text)) {
            unclosed.add(kind);
            continue;
        }
        out += text.slice(from, m.index);
        from = BLOCK_OPEN.lastIndex = close.lastIndex;
    }
    return out + text.slice(from);
}

function decodeEntity(entity, decimal, hex, name) {
    if (name !== undefined)
        return NAMED_ENTITIES[name];
    const code = decimal !== undefined ? Number(decimal) : parseInt(hex, 16);
    return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : entity;
}

function plainText(text) {
    return withoutBlocks(text)
        .replace(CONDITIONAL_MARK, '')
        .replace(HTML_TAG, lineEndOrNothing)
        .replace(HTML_ENTITY, decodeEntity);
}

function withoutDialStrings(text) {
    let out = '';
    let from = 0;
    for (const m of text.matchAll(DIAL_NUMBER)) {
        const end = m.index + m[0].length;
        DIAL_CODE.lastIndex = end;
        // end < from: a number inside the codes of a string already removed.
        if (end < from || !DIAL_CODE.test(text) || m[0].replace(/\D/g, '').length < DIAL_MIN_DIGITS)
            continue;
        DIAL_REST.lastIndex = DIAL_CODE.lastIndex;
        DIAL_REST.test(text);
        out += text.slice(from, m.index) + '[removed]';
        from = DIAL_REST.lastIndex;
    }
    return out + text.slice(from);
}

const clean = (text, cap) => capText(cleanText(text), cap);

const pad = (n, width = 2) => String(n).padStart(width, '0');

function localStart(event, utcOffsetMinutes) {
    const d = new Date(event.start + utcOffsetMinutes * MINUTE);
    const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${WEEKDAYS[d.getUTCDay()]}`;
    return event.allDay ? date : `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function lengthMinutes(event) {
    if (!Number.isFinite(event.start) || !Number.isFinite(event.end))
        return 0;
    return Math.max(0, Math.round((event.end - event.start) / MINUTE));
}

/**
 * Description or place text, in this order: HTML made plain text (D-030), invisible
 * marks dropped (D-029, D-030), no-break spaces and hyphens made plain (D-030),
 * conferencing queries cut (D-022), percent-encoded pauses and codes decoded (D-030),
 * dial-in strings removed (D-029), text passcodes removed (D-025, D-027), cleaned; not capped.
 */
function withoutPasscodes(text) {
    const plain = withoutConferenceQueries(plainText(text)
        .replace(INVISIBLE_MARKS, '')
        .replace(NO_BREAK_SPACES, ' ')
        .replace(HYPHENS, '-'))
        .replace(PERCENT_DIAL, run => run.replace(/%(2C|3B|23|2A)/gi, (_, h) => PERCENT_CHARS[h.toUpperCase()]));
    return cleanText(withoutDialStrings(plain).replace(TEXT_PASSCODE, '$1$2[removed]'));
}

function videoLinkOf(event) {
    const link = detectAttendance(event).link;
    if (link === null)
        return null;
    // isConferenceUrl accepts any letter case in the scheme; the invite contract wants 'https://'.
    const v = cleanText(withoutQuery(link)).replace(/^https:\/\//i, 'https://');
    return Array.from(v).length <= INVITE_CAPS.videoLink ? v : null;
}

const person = p => ({
    name: clean(p.name, INVITE_CAPS.name),
    email: clean(normaliseAddress(p.email), INVITE_CAPS.email),
});

/**
 * The bounded invite for one occurrence (interfaces §6.2 with D-022, D-024, D-025,
 * D-027 and D-029). Pure. Never throws on the meeting's text; throws only on a bad
 * start, calendar name or offset (below).
 *
 * @param {import('./types.js').OccurrenceDTO} event the kept copy
 * @param {{addresses:Set<string>, domains:Set<string>}} identity from ownerIdentity()
 * @param {string} calendarName the name of event.sourceUid's calendar; '' when unknown
 * @param {number} utcOffsetMinutes integer, -840..840
 * @returns {Readonly<import('./types.js').Invite>} deep-frozen, keys in INVITE_FIELDS order,
 *          passes validateInvite
 * @throws {TypeError} when event.start is not a finite number, calendarName is not a string, or
 *         utcOffsetMinutes is not an integer in range
 */
export function buildInvite(event, identity, calendarName, utcOffsetMinutes) {
    if (!Number.isFinite(event.start))
        throw new TypeError('buildInvite: event.start must be a finite number of milliseconds');
    if (typeof calendarName !== 'string')
        throw new TypeError('buildInvite: calendarName must be a string');
    if (!Number.isInteger(utcOffsetMinutes) || Math.abs(utcOffsetMinutes) > MAX_OFFSET_MINUTES)
        throw new TypeError('buildInvite: utcOffsetMinutes must be an integer from -840 to 840');

    const organised = ownerFacts(event, identity).role === 'organizer';
    const allGuests = guestAttendees(event, identity);
    const fullDescription = withoutPasscodes(event.description);

    const invite = {
        title: clean(event.summary, INVITE_CAPS.title),
        calendar: clean(calendarName, INVITE_CAPS.calendar),
        start: localStart(event, utcOffsetMinutes),
        minutes: lengthMinutes(event),
        allDay: event.allDay,
        recurring: event.recurring,
        status: event.status,
        busy: BUSY[event.transparency] ?? 'unknown',
        description: capText(fullDescription, INVITE_CAPS.description),
        place: capText(withoutPasscodes(event.location), INVITE_CAPS.place),
        videoLink: videoLinkOf(event),
        you: { response: ownerResponse(event, identity), organiser: organised },
        organiser: organised || !event.organizer ? null : person(event.organizer),
        guests: allGuests.slice(0, INVITE_CAPS.guests).map(a => ({
            ...person(a),
            response: a.partstat,
            role: ROLES[a.role] ?? 'other',
        })),
        guestsTotal: allGuests.length,
    };

    // Guests go first, from the end; then the description is shortened.
    for (let size = utf8Length(JSON.stringify(invite)); size > MAX_INVITE_BYTES;
        size = utf8Length(JSON.stringify(invite))) {
        if (invite.guests.length > 0) {
            invite.guests.pop();
            continue;
        }
        // Unreachable while the caps hold (the worst-case test proves it); stops a loop that could not end.
        if (invite.description === '')
            break;
        const n = Math.max(0, Array.from(invite.description).length - (size - MAX_INVITE_BYTES) - 1);
        invite.description = n === 0 ? '' : capText(fullDescription, n);
    }

    Object.freeze(invite.you);
    if (invite.organiser !== null)
        Object.freeze(invite.organiser);
    invite.guests.forEach(g => Object.freeze(g));
    Object.freeze(invite.guests);
    return Object.freeze(invite);
}
