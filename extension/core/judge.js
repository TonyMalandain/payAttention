// judge(): every meeting in a snapshot -> verdict, mode, travel and deadline.
// One pass over the events; word lists and owner identity are built once per call.
import { occurrenceKey, seriesKey, placeKey } from './keys.js';
import { BUILTIN_IGNORE_WORDS, BUILTIN_IMPORTANT_WORDS, compileWords } from './words.js';
import { ownerIdentity, ownerFacts } from './owner.js';
import { ruleVerdict, overrideVerdict } from './verdict.js';
import { detectAttendance } from './attendance.js';

const MINUTE = 60000;
const VERDICT_VALUES = ['must', 'ignore'];
const MODE_VALUES = ['online', 'in-person'];

const isPlainObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkStringArray(config, field) {
    const v = config[field];
    if (!Array.isArray(v) || !v.every(s => typeof s === 'string'))
        throw new TypeError(`judge: config.${field} must be an array of strings`);
}

function checkInputs(snapshot, config, overrides, travel) {
    if (!isPlainObject(snapshot) || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.sources))
        throw new TypeError('judge: snapshot.events and snapshot.sources must be arrays');
    if (!isPlainObject(config))
        throw new TypeError('judge: config must be an object');
    for (const field of ['extraImportantWords', 'extraIgnoreWords', 'extraOwnerAddresses', 'ownerDomains'])
        checkStringArray(config, field);
    if (!Number.isInteger(config.largeMeetingSize) || config.largeMeetingSize < 1)
        throw new TypeError('judge: config.largeMeetingSize must be an integer >= 1');
    if (typeof config.defaultTravelMinutes !== 'number' || !Number.isFinite(config.defaultTravelMinutes) ||
        config.defaultTravelMinutes < 0)
        throw new TypeError('judge: config.defaultTravelMinutes must be a finite number >= 0');
    if (!isPlainObject(overrides) || !isPlainObject(overrides.verdict) || !isPlainObject(overrides.mode))
        throw new TypeError('judge: overrides.verdict and overrides.mode must be objects');
    if (!isPlainObject(travel))
        throw new TypeError('judge: travel must be an object');
}

function own(record, key) {
    return key !== null && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The occurrence override, then the series override, counting only allowed values. */
function lookupOverride(record, key, sKey, allowed) {
    for (const k of [key, sKey]) {
        const v = own(record, k);
        if (allowed.includes(v))
            return v;
    }
    return null;
}

function isValidTravel(t) {
    return Number.isInteger(t) && t >= 1 && t <= 1440;
}

function judgeEvent(event, config, overrides, travel, identity, ctx) {
    const key = occurrenceKey(event);
    const sKey = seriesKey(event);

    const ov = lookupOverride(overrides.verdict, key, sKey, VERDICT_VALUES);
    const v = ov ? overrideVerdict(ov) : ruleVerdict(event, ownerFacts(event, identity), ctx);

    const att = detectAttendance(event);
    const mo = lookupOverride(overrides.mode, key, sKey, MODE_VALUES);
    const mode = mo ?? (att.detected === 'in-person' ? 'in-person' : 'online');
    const pKey = placeKey(att.placeText);

    let travelMinutes = null;
    let travelIsDefault = false;
    if (mode === 'in-person') {
        const t = own(travel, pKey);
        travelIsDefault = !isValidTravel(t);
        travelMinutes = travelIsDefault ? config.defaultTravelMinutes : t;
    }

    const start = Number.isFinite(event.start) ? event.start : null;
    let deadline = null;
    if (!event.allDay && start !== null)
        deadline = mode === 'in-person' ? start - travelMinutes * MINUTE : start;

    return Object.freeze({
        key,
        seriesKey: sKey,
        recurring: event.recurring,
        title: event.summary,
        start,
        end: Number.isFinite(event.end) ? event.end : null,
        allDay: event.allDay,
        verdict: v.verdict,
        reason: v.reason,
        reasonCode: v.reasonCode,
        verdictOverridden: ov !== null,
        mode,
        modeOverridden: mo !== null,
        joinUrl: mode === 'online' ? att.link : null,
        placeText: att.placeText,
        placeKey: pKey,
        travelMinutes,
        travelIsDefault,
        deadline,
    });
}

function byStartThenKey(a, b) {
    if (a.start !== b.start) {
        if (a.start === null)
            return 1;
        if (b.start === null)
            return -1;
        return a.start - b.start;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Judge every meeting in a snapshot: its verdict and reason (PRD §1), online or
 * in person (§2), travel time (§4) and deadline. Ignorable meetings are
 * included. Copies of one occurrence from several calendars are merged, and a
 * must-attend copy wins, so a doubt errs toward warning.
 *
 * @param {import('./types.js').Snapshot} snapshot
 * @param {import('./types.js').JudgeConfig} config the whole Settings object may be passed
 * @param {import('./types.js').Overrides} overrides
 * @param {import('./types.js').TravelTimes} travel
 * @returns {ReadonlyArray<import('./types.js').JudgedOccurrence>} frozen, sorted by start (null last), then key
 * @throws {TypeError} when an argument does not have the expected shape
 */
export function judge(snapshot, config, overrides, travel) {
    checkInputs(snapshot, config, overrides, travel);

    const identity = ownerIdentity(snapshot, config);
    const ctx = {
        ignore: compileWords(BUILTIN_IGNORE_WORDS, config.extraIgnoreWords),
        important: compileWords(BUILTIN_IMPORTANT_WORDS, config.extraImportantWords),
        ownerDomains: identity.domains,
        largeMeetingSize: config.largeMeetingSize,
    };

    const byKey = new Map();
    for (const event of snapshot.events) {
        const judged = judgeEvent(event, config, overrides, travel, identity, ctx);
        const kept = byKey.get(judged.key);
        if (kept === undefined || (kept.verdict !== 'must' && judged.verdict === 'must'))
            byKey.set(judged.key, judged);
    }
    return Object.freeze([...byKey.values()].sort(byStartThenKey));
}
