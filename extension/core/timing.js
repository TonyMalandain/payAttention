// Settings (minutes, seconds) -> Timing (ms). Unit conversion only; plan() clamps.

const MINUTE = 60000;
const SECOND = 1000;

function read(settings, field) {
    const value = settings[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        throw new TypeError(`timingFromSettings: ${field} must be a non-negative number`);
    return value;
}

function offsets(settings, prefix) {
    return Object.freeze({
        headsUpMs: read(settings, `${prefix}HeadsupMinutes`) * MINUTE,
        nudgeMs: read(settings, `${prefix}NudgeMinutes`) * MINUTE,
        insistMs: read(settings, `${prefix}InsistMinutes`) * MINUTE,
        takeoverMs: read(settings, `${prefix}TakeoverMinutes`) * MINUTE,
    });
}

/**
 * Convert the timing settings to the milliseconds plan() works in.
 *
 * @param {import('./types.js').Settings} settings
 * @returns {import('./types.js').Timing} frozen
 * @throws {TypeError} when one of the 13 timing fields is not a finite number >= 0
 */
export function timingFromSettings(settings) {
    return Object.freeze({
        online: offsets(settings, 'online'),
        inPerson: offsets(settings, 'inperson'),
        headsUpDisplayMs: read(settings, 'headsupDisplaySeconds') * SECOND,
        snoozeMs: read(settings, 'snoozeMinutes') * MINUTE,
        takeoverSnoozeMs: read(settings, 'takeoverSnoozeMinutes') * MINUTE,
        cutoffMs: read(settings, 'cutoffMinutes') * MINUTE,
    });
}
