// Builds helper -> shell protocol messages (interfaces.md §1) in canonical
// order. Pure. Serialising and validating is core's formatHelperMessage.
import { PROTOCOL_VERSION } from '../core/protocol.js';

/** The closed list of status codes: a status can never carry free text. */
export const STATUS_CODES = Object.freeze({
    REGISTRY_FAILED: 'registry-failed',   // error, fatal: EDS source registry could not be opened
    HELPER_FAILED: 'helper-failed',       // error, fatal: unexpected exception during startup
    SNAPSHOT_FAILED: 'snapshot-failed',   // error, not fatal: an unexpected exception while reading
    SNAPSHOT_INVALID: 'snapshot-invalid', // error, not fatal: core's formatHelperMessage rejected our own snapshot (a helper bug)
    BAD_COMMAND: 'bad-command',           // warn: a stdin line that parseShellLine rejects
    SYNC_FAILED: 'sync-failed',           // warn, diagnostic only: at least one remote refresh request could not be made in a sync round (not a provider failure; never used for health)
    EVENT_SKIPPED: 'event-skipped',       // warn: at least one instance threw while being transcribed
});

/** Why a source has ok:false in a snapshot. */
export const SOURCE_ERRORS = Object.freeze({
    CONNECT_TIMEOUT: 'connect-timeout',
    CONNECT_FAILED: 'connect-failed',
    READ_FAILED: 'read-failed',
});

const STATUS_LEVELS = ['warn', 'error'];
const KNOWN_CODES = Object.values(STATUS_CODES);

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function compareRecurrenceId(a, b) {
    if (a === b)
        return 0;
    if (a === null)
        return -1;
    if (b === null)
        return 1;
    return a - b;
}

function compareEvents(a, b) {
    return (a.start - b.start) ||
        compare(a.sourceUid, b.sourceUid) ||
        compare(a.uid, b.uid) ||
        compareRecurrenceId(a.recurrenceId, b.recurrenceId);
}

/**
 * The first line the helper writes.
 *
 * @returns {{type:'hello', protocol:number}}
 */
export function helloMessage() {
    return { type: 'hello', protocol: PROTOCOL_VERSION };
}

/**
 * A snapshot message. Canonical order: sources by uid; events by start, then
 * sourceUid, uid, recurrenceId (null first). Returns new arrays; never mutates
 * inputs.
 *
 * @param {{generatedAt:number, rangeStart:number, rangeEnd:number, sources:object[], events:object[]}} parts
 * @returns {object} the snapshot message
 */
export function snapshotMessage({ generatedAt, rangeStart, rangeEnd, sources, events }) {
    return {
        type: 'snapshot',
        protocol: PROTOCOL_VERSION,
        generatedAt,
        rangeStart,
        rangeEnd,
        sources: [...sources].sort((a, b) => compare(a.uid, b.uid)),
        events: [...events].sort(compareEvents),
    };
}

/**
 * A status message.
 *
 * @param {'warn'|'error'} level
 * @param {string} code one of STATUS_CODES
 * @returns {{type:'status', level:string, code:string}}
 * @throws {TypeError} for any other level or code
 */
export function statusMessage(level, code) {
    if (!STATUS_LEVELS.includes(level) || !KNOWN_CODES.includes(code))
        throw new TypeError('invalid status');
    return { type: 'status', level, code };
}
