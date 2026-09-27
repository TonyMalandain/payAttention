// The shell ↔ AI helper wire contract (interfaces.md §6.2, §6.6): the messages,
// the invite's shape and bounds, and the one text-cleaning rule both share.
// Failures carry a field *path* only, never a value: meeting text must not reach
// a log through a validation result.
import { PARTSTATS, STATUSES } from './protocol.js';
import { normaliseEndpoint, isUsableEndpoint, normaliseModel } from './aiEngine.js';

/** The AI protocol version both sides must speak. */
export const AI_PROTOCOL_VERSION = 1;
/** The longest accepted line, in characters. */
export const MAX_AI_LINE_LENGTH = 16384;
/** The largest invite: UTF-8 bytes of JSON.stringify(invite). */
export const MAX_INVITE_BYTES = 8192;
/** The longest reason, in code points. */
export const MAX_REASON_LENGTH = 80;
/** The cap of each invite text field in code points, and of the guest list in entries. Frozen. */
export const INVITE_CAPS = Object.freeze({
    title: 200, calendar: 80, description: 1500, place: 200,
    videoLink: 300, name: 80, email: 254, guests: 25,
});
/** Why the helper could not judge. Frozen. */
export const AI_FAILURE_CODES = Object.freeze(['timeout', 'network', 'tls', 'auth', 'rate-limited', 'server',
    'bad-reply', 'bad-request', 'no-key', 'config']);

/** The invite's fields in their fixed order, each with the label prefs shows (interfaces §6.2, D-024). Frozen. */
export const INVITE_FIELDS = Object.freeze([
    ['title', 'Title'],
    ['calendar', 'Calendar name'],
    ['start', 'Date and time'],
    ['minutes', 'Length'],
    ['allDay', 'Whether it is all-day'],
    ['recurring', 'Whether it repeats'],
    ['status', 'Status (confirmed or tentative)'],
    ['busy', 'Busy or free'],
    ['description', 'Description'],
    ['place', 'Place'],
    ['videoLink', 'Video link, without its passcode'],
    ['you', 'Your response, and whether you organised it'],
    ['organiser', "Organiser's name and email address"],
    ['guests', "Guests' names, email addresses, responses and roles (up to 25)"],
    ['guestsTotal', 'Number of guests'],
].map(([key, label]) => Object.freeze({ key, label })));

const BUSY_VALUES = ['busy', 'free', 'unknown'];
const GUEST_ROLES = ['chair', 'required', 'optional', 'other'];
const START = /^\d{4}-\d{2}-\d{2} (Mon|Tue|Wed|Thu|Fri|Sat|Sun)( \d{2}:\d{2})?$/;

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The one cleaning rule for invite text and reasons: well-formed, control
 * characters as spaces, bidi controls and marks removed, whitespace collapsed, trimmed.
 *
 * @param {string} text
 * @returns {string}
 */
export function cleanText(text) {
    return text.toWellFormed()
        .replace(/\p{Cc}/gu, ' ')
        .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Cut a text to `max` code points: within it, unchanged; otherwise the first
 * `max − 1`, trailing space removed, then `…`.
 *
 * @param {string} text
 * @param {number} max code points, >= 1
 * @returns {string}
 */
export function capText(text, max) {
    const points = Array.from(text);
    if (points.length <= max)
        return text;
    return points.slice(0, max - 1).join('').trimEnd() + '…';
}

/**
 * @param {string} text
 * @returns {number} UTF-8 bytes; a lone surrogate counts 3 (as its U+FFFD replacement)
 */
export function utf8Length(text) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 0x80) {
            bytes += 1;
        } else if (c < 0x800) {
            bytes += 2;
        } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length &&
            text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
            bytes += 4;
            i++;
        } else {
            bytes += 3;
        }
    }
    return bytes;
}

/**
 * @param {*} text
 * @returns {string|null} cleanText, then capped at 80 code points; null when not a string or empty
 */
export function normaliseReason(text) {
    if (typeof text !== 'string')
        return null;
    const r = capText(cleanText(text), MAX_REASON_LENGTH);
    return r === '' ? null : r;
}

function isCleanText(v, cap) {
    return typeof v === 'string' && cleanText(v) === v && Array.from(v).length <= cap;
}

/** @returns {string|null} the first missing key, then the first unexpected one, or null */
function badKey(obj, keys) {
    const missing = keys.find(k => !Object.hasOwn(obj, k));
    if (missing !== undefined)
        return missing;
    return Object.keys(obj).find(k => !keys.includes(k)) ?? null;
}

/** @returns {string|null} '' for the object itself, '.<key>' for a field, or null when valid */
function checkPerson(v, extra) {
    const keys = ['name', 'email', ...Object.keys(extra)];
    if (!isObject(v) || badKey(v, keys) !== null)
        return '';
    if (!isCleanText(v.name, INVITE_CAPS.name))
        return '.name';
    if (!isCleanText(v.email, INVITE_CAPS.email))
        return '.email';
    for (const [k, allowed] of Object.entries(extra)) {
        if (!allowed.includes(v[k]))
            return '.' + k;
    }
    return null;
}

const GUEST_EXTRA = { response: PARTSTATS, role: GUEST_ROLES };

// Each check returns true (valid), false (bad at the field), or a relative path.
const INVITE_CHECKS = {
    title: v => isCleanText(v, INVITE_CAPS.title),
    calendar: v => isCleanText(v, INVITE_CAPS.calendar),
    start: v => typeof v === 'string' && START.test(v),
    minutes: v => Number.isInteger(v) && v >= 0,
    allDay: v => typeof v === 'boolean',
    recurring: v => typeof v === 'boolean',
    status: v => STATUSES.includes(v),
    busy: v => BUSY_VALUES.includes(v),
    description: v => isCleanText(v, INVITE_CAPS.description),
    place: v => isCleanText(v, INVITE_CAPS.place),
    videoLink: v => v === null ||
        (isCleanText(v, INVITE_CAPS.videoLink) && v.startsWith('https://') && !/[?#]/.test(v)),
    you: v => {
        if (!isObject(v) || badKey(v, ['response', 'organiser']) !== null)
            return false;
        if (!PARTSTATS.includes(v.response) && v.response !== 'unknown')
            return '.response';
        return typeof v.organiser === 'boolean' ? true : '.organiser';
    },
    organiser: v => {
        if (v === null)
            return true;
        const bad = checkPerson(v, {});
        return bad === null ? true : bad === '' ? false : bad;
    },
    guests: v => {
        if (!Array.isArray(v) || v.length > INVITE_CAPS.guests)
            return false;
        for (let i = 0; i < v.length; i++) {
            const bad = checkPerson(v[i], GUEST_EXTRA);
            if (bad !== null)
                return `[${i}]${bad}`;
        }
        return true;
    },
    guestsTotal: (v, invite) => Number.isInteger(v) && Array.isArray(invite.guests) && v >= invite.guests.length,
};

function badInvite(field) {
    return { ok: false, code: 'bad-invite', field };
}

/**
 * Check an invite against the contract: exactly its 15 keys, every text clean
 * and within its cap, and at most MAX_INVITE_BYTES serialised.
 *
 * @param {*} invite
 * @returns {{ok:true} | {ok:false, code:'bad-invite', field:string}} field is a path, never a value
 */
export function validateInvite(invite) {
    if (!isObject(invite))
        return badInvite('');
    const bad = badKey(invite, INVITE_FIELDS.map(f => f.key));
    if (bad !== null)
        return badInvite(bad);
    for (const { key } of INVITE_FIELDS) {
        const r = INVITE_CHECKS[key](invite[key], invite);
        if (r === false)
            return badInvite(key);
        if (typeof r === 'string')
            return badInvite(key + r);
    }
    if (utf8Length(JSON.stringify(invite)) > MAX_INVITE_BYTES)
        return badInvite('');
    return { ok: true };
}

// ---- Messages (interfaces.md §6.6). Every message has exactly its keys, in both
// directions: the two ends ship in one zip, so there is no version skew to
// tolerate, and the exact key set is the guard (unlike the calendar protocol).

const ID = /^[A-Za-z0-9._-]{1,64}$/;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
const MAX_RETRY_AFTER_S = 86400;

const isId = v => typeof v === 'string' && ID.test(v);

// A private copy of protocol.js's helpers: each helper's allowed import list stays as named.
function fail(code, field) {
    return field === undefined ? { ok: false, code } : { ok: false, code, field };
}

/** @returns {{ok:true, value:*} | {ok:false, code:string}} */
function parseLine(line) {
    const text = line.replace(/\r?\n$/, '');
    if (text.length > MAX_AI_LINE_LENGTH)
        return fail('too-large');
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        // The parser's message may quote the input, so only the code is kept.
        return fail('bad-json');
    }
}

/**
 * Check a message's own fields in order. `checks` maps each key to a predicate;
 * `optional` keys may be absent.
 *
 * @returns {{ok:true, message:object} | {ok:false, code:string, field:string}}
 */
function checkMessage(obj, code, checks, optional = []) {
    const keys = ['type', ...Object.keys(checks)];
    const missing = keys.find(k => !optional.includes(k) && !Object.hasOwn(obj, k));
    const extra = Object.keys(obj).find(k => !keys.includes(k));
    const badKeyName = missing ?? extra;
    if (badKeyName !== undefined)
        return fail(code, badKeyName);
    for (const [key, check] of Object.entries(checks)) {
        if (optional.includes(key) && !Object.hasOwn(obj, key))
            continue;
        if (!check(obj[key], obj))
            return fail(code, key);
    }
    return { ok: true, message: obj };
}

const CONFIGURE_CHECKS = {
    protocol: v => v === AI_PROTOCOL_VERSION,
    endpoint: v => normaliseEndpoint(v) === v && isUsableEndpoint(v),
    model: v => normaliseModel(v) === v,
    timeoutMs: v => Number.isInteger(v) && v >= MIN_TIMEOUT_MS && v <= MAX_TIMEOUT_MS,
};

function validateJudge(obj) {
    const shape = checkMessage(obj, 'invalid-judge', { id: isId, invite: () => true });
    if (!shape.ok)
        return shape;
    const inv = validateInvite(obj.invite);
    if (!inv.ok)
        return fail('bad-invite', inv.field === '' ? 'invite' : 'invite.' + inv.field);
    return shape;
}

/**
 * Check a parsed shell → AI helper message: `configure`, `judge` or `probe`.
 *
 * @param {*} obj
 * @returns {{ok:true, message:object} | {ok:false, code:string, field?:string}} field is a path, never a value
 */
export function validateAiShellMessage(obj) {
    if (!isObject(obj))
        return fail('bad-message');
    switch (obj.type) {
    case 'configure':
        if (obj.protocol !== AI_PROTOCOL_VERSION)
            return fail('protocol-mismatch');
        return checkMessage(obj, 'invalid-configure', CONFIGURE_CHECKS);
    case 'judge':
        return validateJudge(obj);
    case 'probe':
        return checkMessage(obj, 'invalid-probe', { id: isId });
    default:
        return fail('unknown-type');
    }
}

const FAILED_CHECKS = {
    id: isId,
    code: v => AI_FAILURE_CODES.includes(v),
    retryAfterS: (v, obj) => obj.code === 'rate-limited' && Number.isInteger(v) && v >= 0 && v <= MAX_RETRY_AFTER_S,
};

/**
 * Check a parsed AI helper → shell message: `hello`, `verdict` or `failed`.
 *
 * @param {*} obj
 * @returns {{ok:true, message:object} | {ok:false, code:string, field?:string}} field is a path, never a value
 */
export function validateAiHelperMessage(obj) {
    if (!isObject(obj))
        return fail('bad-message');
    switch (obj.type) {
    case 'hello': {
        const r = checkMessage(obj, 'protocol-mismatch', { protocol: v => v === AI_PROTOCOL_VERSION });
        return r.ok ? r : fail('protocol-mismatch');
    }
    case 'verdict':
        return checkMessage(obj, 'invalid-verdict', {
            id: isId,
            verdict: v => v === 'must' || v === 'ignore',
            reason: v => normaliseReason(v) === v,
        });
    case 'failed':
        return checkMessage(obj, 'invalid-failed', FAILED_CHECKS, ['retryAfterS']);
    default:
        return fail('unknown-type');
    }
}

/**
 * Parse and validate one line from the shell.
 *
 * @param {string} line with or without its `\n` / `\r\n` ending
 * @returns {{ok:true, message:object} | {ok:false, code:string, field?:string}}
 */
export function parseAiShellLine(line) {
    const parsed = parseLine(line);
    return parsed.ok ? validateAiShellMessage(parsed.value) : parsed;
}

/**
 * Parse and validate one line from the AI helper.
 *
 * @param {string} line with or without its `\n` / `\r\n` ending
 * @returns {{ok:true, message:object} | {ok:false, code:string, field?:string}}
 */
export function parseAiHelperLine(line) {
    const parsed = parseLine(line);
    return parsed.ok ? validateAiHelperMessage(parsed.value) : parsed;
}

function formatError(side, result) {
    return new TypeError(`invalid AI ${side} message: ${result.code}${result.field ? ' at ' + result.field : ''}`);
}

/**
 * Serialise a shell → AI helper message as one line.
 *
 * @param {object} message
 * @returns {string} JSON followed by `\n`
 * @throws {TypeError} when the message is invalid (the error names the code and path only)
 */
export function formatAiShellMessage(message) {
    const result = validateAiShellMessage(message);
    if (!result.ok)
        throw formatError('shell', result);
    return JSON.stringify(message) + '\n';
}

/**
 * Serialise an AI helper → shell message as one line.
 *
 * @param {object} message
 * @returns {string} JSON followed by `\n`
 * @throws {TypeError} when the message is invalid (the error names the code and path only)
 */
export function formatAiHelperMessage(message) {
    const result = validateAiHelperMessage(message);
    if (!result.ok)
        throw formatError('helper', result);
    return JSON.stringify(message) + '\n';
}
