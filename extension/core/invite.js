// Turning one occurrence into the bounded invite the AI engine sees
// (interfaces.md §6.2; D-020, D-022, D-024, D-025, D-027). Pure.
import { INVITE_CAPS, MAX_INVITE_BYTES, capText, cleanText, utf8Length } from './aiProtocol.js';
import { ownerFacts, ownerResponse, guestAttendees, normaliseAddress } from './owner.js';
import { detectAttendance } from './attendance.js';
import { withoutQuery, withoutConferenceQueries } from './links.js';

const MINUTE = 60000;
const MAX_OFFSET_MINUTES = 840;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BUSY = { opaque: 'busy', transparent: 'free' };
const ROLES = { 'chair': 'chair', 'req-participant': 'required', 'opt-participant': 'optional' };

// D-025 as D-027 reads it: after one of these words (whole word, any case), the
// separators and the filler words "is" and "code" are kept, and the rest of that
// line goes. The lookahead-and-backreference makes the separator run atomic, so the
// removed part never starts with a separator. Whitespace in the run includes line
// breaks, so a value alone on the next line ("Passcode:\n123456") is still removed.
// A rest with no letter or digit ("Forgot your password.") holds no code and stays.
// Run before cleanText, which would join the lines.
const TEXT_PASSCODE = /\b(passcode|password|pwd|pin)\b(?=((?:[\s:=#-]|\b(?:is|code)\b)*))\2(?=[^\r\n]*[\p{L}\p{N}])[^\r\n]+/giu;

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

/** Description or place text: conferencing queries cut (D-022), text passcodes removed (D-025, D-027), cleaned; not capped. */
function withoutPasscodes(text) {
    return cleanText(withoutConferenceQueries(text).replace(TEXT_PASSCODE, '$1$2[removed]'));
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
 * The bounded invite for one occurrence (interfaces §6.2 with D-022, D-024 and
 * D-025). Pure; never throws on content.
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
