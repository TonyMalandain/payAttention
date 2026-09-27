// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Helper protocol v1 (interfaces.md §1): one JSON object per line.
// Imports nothing, so the helper can import this module alone.
// Failures carry a field *path* only, never a value: calendar content must not
// reach a log through a validation result.

/** The protocol version both sides must speak. */
export const PROTOCOL_VERSION = 1;
/**
 * Environment variables every helper spawner removes from the child's environment
 * (interfaces.md §1 "Environment"): with G_MESSAGES_DEBUG set, GLib writes library
 * DEBUG/INFO lines, the AI endpoint among them, to the helper's stdout. Frozen.
 */
export const HELPER_ENV_UNSET = Object.freeze(['G_MESSAGES_DEBUG']);
/** The longest accepted line, in characters. */
export const MAX_LINE_LENGTH = 4 * 1024 * 1024;
/** The longest accepted event description, in characters. */
export const MAX_DESCRIPTION_LENGTH = 32768;

/** Attendee participation states. */
export const PARTSTATS = Object.freeze(['needs-action', 'accepted', 'declined', 'tentative', 'delegated', 'other']);
/** Attendee calendar-user types. */
export const CUTYPES = Object.freeze(['individual', 'group', 'resource', 'room', 'unknown']);
/** Attendee roles. */
export const ROLES = Object.freeze(['chair', 'req-participant', 'opt-participant', 'non-participant', 'other']);
/** Event statuses. */
export const STATUSES = Object.freeze(['confirmed', 'tentative', 'cancelled', 'none']);
/** Event transparencies (busy/free). */
export const TRANSPARENCIES = Object.freeze(['opaque', 'transparent', 'unknown']);
/** Why the shell asks the helper for a fresh snapshot. */
export const REFRESH_REASONS = Object.freeze(['resume', 'manual']);
/** Backend link states a remote source may report (D-013); `offline` and `unknown` are the helper's, the rest mirror EDS. */
export const CONNECTION_STATES = Object.freeze(['connected', 'connecting', 'disconnected', 'awaiting-credentials', 'ssl-failed', 'offline', 'unknown']);

const STATUS_LEVELS = ['warn', 'error'];
const STATUS_CODE = /^[a-z0-9][a-z0-9._-]*$/;

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = v => typeof v === 'string';
const isFiniteNumber = v => typeof v === 'number' && Number.isFinite(v);
const isStringOrNull = v => v === null || isString(v);
const isBoolean = v => typeof v === 'boolean';
const oneOf = list => v => list.includes(v);

const SOURCE_FIELDS = [
    ['uid', isString],
    ['name', isString],
    ['backend', isString],
    ['ownerEmail', isStringOrNull],
    ['ok', isBoolean],
    ['error', isStringOrNull],
    // Added 2026-09-26 (D-013). Optional: an absent field reads as null.
    ['remote', v => v === undefined || v === null || isBoolean(v)],
    ['connection', v => v === undefined || v === null || oneOf(CONNECTION_STATES)(v)],
];

const ATTENDEE_FIELDS = [
    ['email', isString],
    ['name', isString],
    ['partstat', oneOf(PARTSTATS)],
    ['cutype', oneOf(CUTYPES)],
    ['role', oneOf(ROLES)],
];

/** @returns {string|null} the relative path of the first bad field, or null */
function checkOrganizer(v) {
    if (v === null)
        return null;
    if (!isObject(v))
        return '';
    if (!isString(v.email))
        return '.email';
    if (!isString(v.name))
        return '.name';
    return null;
}

function checkStringArray(v) {
    if (!Array.isArray(v))
        return '';
    const i = v.findIndex(s => !isString(s));
    return i === -1 ? null : `[${i}]`;
}

function checkRecords(v, fields) {
    if (!Array.isArray(v))
        return '';
    for (let i = 0; i < v.length; i++) {
        const bad = checkRecord(v[i], fields);
        if (bad !== null)
            return `[${i}]${bad}`;
    }
    return null;
}

/** @returns {string|null} '' when the record itself is bad, '.<field>…' for a field, null when valid */
function checkRecord(obj, fields) {
    if (!isObject(obj))
        return '';
    for (const [name, check] of fields) {
        const result = check(obj[name]);
        if (result === false)
            return `.${name}`;
        if (typeof result === 'string')
            return `.${name}${result}`;
    }
    return null;
}

// A field check returns true/false, or, for nested values, null (valid) or a
// relative path (invalid).
const EVENT_FIELDS = [
    ['sourceUid', isString],
    ['uid', v => isString(v) && v !== ''],
    ['recurrenceId', v => v === null || isFiniteNumber(v)],
    ['recurring', isBoolean],
    ['start', isFiniteNumber],
    ['end', isFiniteNumber],
    ['allDay', isBoolean],
    ['summary', isString],
    ['location', isString],
    ['description', v => isString(v) && v.length <= MAX_DESCRIPTION_LENGTH],
    ['conferenceUris', checkStringArray],
    ['status', oneOf(STATUSES)],
    ['transparency', oneOf(TRANSPARENCIES)],
    ['organizer', checkOrganizer],
    ['attendees', v => checkRecords(v, ATTENDEE_FIELDS)],
];

const SNAPSHOT_FIELDS = [
    ['generatedAt', isFiniteNumber],
    ['rangeStart', isFiniteNumber],
    ['rangeEnd', isFiniteNumber],
    ['sources', v => checkRecords(v, SOURCE_FIELDS)],
    ['events', v => checkRecords(v, EVENT_FIELDS)],
];

function fail(code, field) {
    return field === undefined ? { ok: false, code } : { ok: false, code, field };
}

function validateSnapshot(obj) {
    if (obj.protocol !== PROTOCOL_VERSION)
        return fail('protocol-mismatch');
    const bad = checkRecord(obj, SNAPSHOT_FIELDS);
    if (bad !== null)
        return fail('invalid-snapshot', bad.slice(1));
    return { ok: true, message: obj };
}

function validateStatus(obj) {
    if (!STATUS_LEVELS.includes(obj.level))
        return fail('invalid-status', 'level');
    const code = obj.code;
    if (!isString(code) || code.length < 1 || code.length > 64 || !STATUS_CODE.test(code))
        return fail('invalid-status', 'code');
    return { ok: true, message: obj };
}

/**
 * Check a parsed helper → shell message against protocol v1. Unknown extra
 * properties are accepted and left as they are.
 *
 * @param {*} obj
 * @returns {{ok:true, message:object} | {ok:false, code:string, field?:string}}
 *   `field` is a path such as `events[3].attendees[0].partstat`, never a value
 */
export function validateHelperMessage(obj) {
    if (!isObject(obj))
        return fail('bad-message');
    switch (obj.type) {
    case 'hello':
        return obj.protocol === PROTOCOL_VERSION ? { ok: true, message: obj } : fail('protocol-mismatch');
    case 'snapshot':
        return validateSnapshot(obj);
    case 'status':
        return validateStatus(obj);
    default:
        return fail('unknown-type');
    }
}

/** @returns {{ok:true, value:*} | {ok:false, code:string}} */
function parseLine(line) {
    const text = line.replace(/\r?\n$/, '');
    if (text.length > MAX_LINE_LENGTH)
        return fail('too-large');
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        // The parser's message may quote the input, so only the code is kept.
        return fail('bad-json');
    }
}

/**
 * Parse and validate one line from the helper.
 *
 * @param {string} line one line, with or without its `\n` / `\r\n` ending
 * @returns {{ok:true, message:object} | {ok:false, code:string, field?:string}}
 */
export function parseHelperLine(line) {
    const parsed = parseLine(line);
    return parsed.ok ? validateHelperMessage(parsed.value) : parsed;
}

function formatError(side, result) {
    return new TypeError(`invalid ${side} message: ${result.code}${result.field ? ' at ' + result.field : ''}`);
}

/**
 * Serialise a helper → shell message as one protocol line.
 *
 * @param {object} message
 * @returns {string} JSON followed by `\n`
 * @throws {TypeError} when the message is not valid protocol v1 (the error names the code and path only)
 */
export function formatHelperMessage(message) {
    const result = validateHelperMessage(message);
    if (!result.ok)
        throw formatError('helper', result);
    return JSON.stringify(message) + '\n';
}

function validateShellMessage(obj) {
    if (!isObject(obj))
        return fail('bad-message');
    if (obj.type !== 'refresh')
        return fail('unknown-type');
    if (!REFRESH_REASONS.includes(obj.reason))
        return fail('invalid-refresh', 'reason');
    return { ok: true, message: obj };
}

/**
 * Parse and validate one line from the shell. The shell only sends `refresh`.
 *
 * @param {string} line
 * @returns {{ok:true, message:{type:'refresh', reason:'resume'|'manual'}} | {ok:false, code:string, field?:string}}
 */
export function parseShellLine(line) {
    const parsed = parseLine(line);
    return parsed.ok ? validateShellMessage(parsed.value) : parsed;
}

/**
 * Serialise a shell → helper message as one protocol line.
 *
 * @param {object} message
 * @returns {string} JSON followed by `\n`
 * @throws {TypeError} when the message is not a valid refresh
 */
export function formatShellMessage(message) {
    const result = validateShellMessage(message);
    if (!result.ok)
        throw formatError('shell', result);
    return JSON.stringify(message) + '\n';
}
