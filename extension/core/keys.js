// Stored key formats (ADR-0003, data.md). Pure: no clock, no I/O.

/** How long occurrence-keyed state is kept after its time: 7 days, in ms. */
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The key for one occurrence. A series instance is keyed by its recurrence id,
 * so the key survives the instance being moved.
 *
 * @param {{uid:string, recurrenceId:number|null, start:number|null}} event
 * @returns {string} `occ:<uid>|<recurrenceId ?? start>`, or `occ:<uid>|none`
 */
export function occurrenceKey(event) {
    const time = event.recurrenceId ?? event.start;
    return `occ:${event.uid}|${time ?? 'none'}`;
}

/**
 * The key for a whole series.
 *
 * @param {{uid:string}} event
 * @returns {string} `series:<uid>`
 */
export function seriesKey(event) {
    return `series:${event.uid}`;
}

/**
 * The key under which a travel time is stored for a place: the place text
 * compared without letter case or extra spaces.
 *
 * @param {string} text
 * @returns {string|null} null for an empty or blank place
 */
export function placeKey(text) {
    const key = text.trim().replace(/\s+/g, ' ').toLowerCase();
    return key === '' ? null : key;
}

/**
 * The time encoded in an occurrence key.
 *
 * @param {string} key
 * @returns {number|null} the digits after the last `|` of an `occ:` key, else null
 */
export function occurrenceKeyTime(key) {
    if (!key.startsWith('occ:'))
        return null;
    const tail = key.slice(key.lastIndexOf('|') + 1);
    return /^\d+$/.test(tail) ? Number(tail) : null;
}

/**
 * Whether an occurrence key is older than the retention period. Keys without a
 * time (series keys included) never expire by this rule.
 *
 * @param {string} key
 * @param {number} now ms since the epoch
 * @returns {boolean}
 */
export function isExpiredOccurrenceKey(key, now) {
    const t = occurrenceKeyTime(key);
    return t !== null && t < now - RETENTION_MS;
}
