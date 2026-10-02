// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// judge(): every meeting in a snapshot -> verdict, mode, travel and deadline.
// One pass over the events; word lists and owner identity are built once per call.
import { occurrenceKey, seriesKey, placeKey } from './keys.js';
import { BUILTIN_IGNORE_WORDS, BUILTIN_IMPORTANT_WORDS, compileWords } from './words.js';
import { ownerIdentity, ownerFacts } from './owner.js';
import { ruleVerdict, overrideVerdict, aiVerdict } from './verdict.js';
import { detectAttendance } from './attendance.js';
import { buildInvite } from './invite.js';
import { fingerprint } from './fingerprint.js';
import { normaliseReason } from './aiProtocol.js';

const MINUTE = 60000;
const VERDICT_VALUES = ['must', 'ignore'];
const MODE_VALUES = ['online', 'in-person'];
const MAX_OFFSET_MINUTES = 840;

const isPlainObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkStringArray(config, field) {
    const v = config[field];
    if (!Array.isArray(v) || !v.every(s => typeof s === 'string'))
        throw new TypeError(`judge: config.${field} must be an array of strings`);
}

function checkAi(config, aiVerdicts) {
    const ai = config.ai;
    if (ai === undefined || ai === null)
        return;
    if (!isPlainObject(ai) || typeof ai.engineTag !== 'string' || ai.engineTag === '' ||
        !Number.isInteger(ai.utcOffsetMinutes) || Math.abs(ai.utcOffsetMinutes) > MAX_OFFSET_MINUTES)
        throw new TypeError('judge: config.ai must be null or {engineTag, utcOffsetMinutes}');
    if (!isPlainObject(aiVerdicts))
        throw new TypeError('judge: aiVerdicts must be an object in AI mode');
}

function checkInputs(snapshot, config, overrides, travel, aiVerdicts) {
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
    if (!isPlainObject(travel) || !isPlainObject(travel.byPlace) || !isPlainObject(travel.byMeeting))
        throw new TypeError('judge: travel.byPlace and travel.byMeeting must be objects');
    checkAi(config, aiVerdicts);
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

/** The one travel entry an in-person meeting reads and a pick writes (ADR-0014); null when online. */
function travelTargetOf(mode, pKey, sKey) {
    if (mode !== 'in-person')
        return null;
    return pKey !== null ? Object.freeze({ kind: 'place', key: pKey }) : Object.freeze({ kind: 'meeting', key: sKey });
}

/** One copy of an occurrence: its result, and the DTO and owner facts it came from (facts null when overridden). */
function judgeEvent(event, config, overrides, travel, identity, ctx) {
    const key = occurrenceKey(event);
    const sKey = seriesKey(event);

    const ov = lookupOverride(overrides.verdict, key, sKey, VERDICT_VALUES);
    const facts = ov ? null : ownerFacts(event, identity);
    const v = ov ? overrideVerdict(ov) : ruleVerdict(event, facts, ctx);

    const att = detectAttendance(event);
    const mo = lookupOverride(overrides.mode, key, sKey, MODE_VALUES);
    const mode = mo ?? att.detected;
    const pKey = placeKey(att.placeText);
    const travelTarget = travelTargetOf(mode, pKey, sKey);

    let travelMinutes = null;
    let travelIsDefault = false;
    if (travelTarget !== null) {
        // That entry only: no fallback between the maps (ADR-0014).
        const t = own(travelTarget.kind === 'place' ? travel.byPlace : travel.byMeeting, travelTarget.key);
        travelIsDefault = !isValidTravel(t);
        travelMinutes = travelIsDefault ? config.defaultTravelMinutes : t;
    }

    const start = Number.isFinite(event.start) ? event.start : null;
    let deadline = null;
    if (!event.allDay && start !== null)
        deadline = mode === 'in-person' ? start - travelMinutes * MINUTE : start;

    const judged = Object.freeze({
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
        joinUrl: att.link,   // whatever the mode (D-040)
        placeText: att.placeText,
        placeKey: pKey,
        travelMinutes,
        travelIsDefault,
        travelTarget,
        deadline,
    });
    return { judged, event, facts };
}

/** D-023: cancelled, declined and all-day meetings stay silent, decided by the facts, not the reason code. */
function isSilentByFact(event, facts) {
    return event.status === 'cancelled' || facts.partstat === 'declined' || event.allDay ||
        !Number.isFinite(event.start);
}

/** A well-formed stored answer for this occurrence, or null. No other field of the entry is read. */
function storedAnswer(aiVerdicts, key) {
    if (!Object.hasOwn(aiVerdicts, key))
        return null;
    const entry = aiVerdicts[key];
    if (!isPlainObject(entry) || typeof entry.fp !== 'string' || entry.fp === '' ||
        !VERDICT_VALUES.includes(entry.verdict))
        return null;
    const reason = normaliseReason(entry.reason);
    return reason === null ? null : { fp: entry.fp, verdict: entry.verdict, reason };
}

/**
 * The AI step for one kept copy. An answer can only replace the verdict and its
 * reason: the result is the rules result spread, plus those fields.
 */
function withAiAnswer(record, ai, aiVerdicts, identity, calendarNames) {
    const { judged, event, facts } = record;
    if (facts === null || isSilentByFact(event, facts))
        return judged;
    const invite = buildInvite(event, identity, calendarNames.get(event.sourceUid) ?? '', ai.utcOffsetMinutes);
    const fp = fingerprint(ai.engineTag, invite);
    const aiAsk = Object.freeze({ fp, invite });
    const entry = storedAnswer(aiVerdicts, judged.key);
    if (entry === null)
        return Object.freeze({ ...judged, aiAsk });
    const answered = { ...judged, ...aiVerdict(entry.verdict, entry.reason), ruleReason: judged.reason };
    if (entry.fp === fp)
        return Object.freeze(answered);
    return Object.freeze({ ...answered, aiStale: true, aiAsk });
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
 * In AI mode (`config.ai` set), each kept copy that has no override and is not
 * cancelled, declined or all-day (D-023) takes its stored AI answer, and carries
 * `aiAsk` when it has none or a stale one. Rules mode output is exactly as before.
 *
 * @param {import('./types.js').Snapshot} snapshot
 * @param {import('./types.js').JudgeConfig} config the whole Settings object may be passed; `ai` null or absent = rules mode
 * @param {import('./types.js').Overrides} overrides
 * @param {import('./types.js').TravelTimes} travel
 * @param {import('./types.js').AiAnswers} [aiVerdicts] must be a plain object when config.ai is set; not read otherwise
 * @returns {ReadonlyArray<import('./types.js').JudgedOccurrence>} frozen, sorted by start (null last), then key
 * @throws {TypeError} when an argument does not have the expected shape, config.ai is malformed,
 *   or aiVerdicts is missing in AI mode
 */
export function judge(snapshot, config, overrides, travel, aiVerdicts) {
    checkInputs(snapshot, config, overrides, travel, aiVerdicts);

    const identity = ownerIdentity(snapshot, config);
    const ctx = {
        ignore: compileWords(BUILTIN_IGNORE_WORDS, config.extraIgnoreWords),
        important: compileWords(BUILTIN_IMPORTANT_WORDS, config.extraImportantWords),
        ownerDomains: identity.domains,
        largeMeetingSize: config.largeMeetingSize,
    };

    const byKey = new Map();
    for (const event of snapshot.events) {
        const record = judgeEvent(event, config, overrides, travel, identity, ctx);
        const kept = byKey.get(record.judged.key);
        if (kept === undefined || (kept.judged.verdict !== 'must' && record.judged.verdict === 'must'))
            byKey.set(record.judged.key, record);
    }
    const records = [...byKey.values()].sort((a, b) => byStartThenKey(a.judged, b.judged));
    const ai = config.ai ?? null;
    if (ai === null)
        return Object.freeze(records.map(r => r.judged));

    const calendarNames = new Map();
    for (const source of snapshot.sources) {
        if (!calendarNames.has(source.uid))
            calendarNames.set(source.uid, source.name);
    }
    return Object.freeze(records.map(r => withAiAnswer(r, ai, aiVerdicts, identity, calendarNames)));
}
