// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The stored AI answers (data.md "AI answers"): read, write, record and prune.
// Pure: `now` is always a parameter.
import { occurrenceKeyTime, isExpiredOccurrenceKey } from './keys.js';
import { normaliseReason } from './aiProtocol.js';

const MAX_FP_LENGTH = 64;
const VERDICTS = ['must', 'ignore'];

const isPlainObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

// Each check names its field; the stored value is never put in a message.
const CHECKS = [
    ['fp', v => typeof v === 'string' && v.length >= 1 && v.length <= MAX_FP_LENGTH],
    ['verdict', v => VERDICTS.includes(v)],
    ['reason', v => typeof v === 'string' && normaliseReason(v) === v],
    ['at', v => typeof v === 'number' && Number.isFinite(v)],
];

const isAnswerKey = key => typeof key === 'string' && occurrenceKeyTime(key) !== null;

/** @returns {string|null} the first invalid field of an item, or null */
function badField(item) {
    for (const [field, valid] of CHECKS) {
        if (!valid(item[field]))
            return field;
    }
    return null;
}

function freezeAnswers(items) {
    return Object.freeze({ v: 1, items: Object.freeze(items) });
}

const freezeItem = ({ fp, verdict, reason, at }) => Object.freeze({ fp, verdict, reason, at });

/**
 * Nothing stored.
 *
 * @returns {import('./types.js').StoredAiAnswers} frozen
 */
export function emptyAiAnswers() {
    return freezeAnswers({});
}

/**
 * Read the stored AI answers (data.md "AI answers"). Anything unreadable, or a
 * `v` other than 1, gives the empty value; an invalid item is dropped on its own.
 * Never throws. A kept item holds exactly {fp, verdict, reason, at}, in that order.
 *
 * @param {string|null|undefined} text
 * @returns {import('./types.js').StoredAiAnswers} frozen, items frozen
 */
export function parseAiAnswers(text) {
    if (typeof text !== 'string' || text === '')
        return emptyAiAnswers();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        // Corrupt stored value: the meetings are asked again, which is the safe failure.
        return emptyAiAnswers();
    }
    if (!isPlainObject(parsed) || parsed.v !== 1 || !isPlainObject(parsed.items))
        return emptyAiAnswers();
    const items = {};
    for (const [key, raw] of Object.entries(parsed.items)) {
        if (isAnswerKey(key) && isPlainObject(raw) && badField(raw) === null)
            items[key] = freezeItem(raw);
    }
    return freezeAnswers(items);
}

/**
 * The stored form of the AI answers.
 *
 * @param {import('./types.js').StoredAiAnswers} answers
 * @returns {string}
 */
export function serializeAiAnswers(answers) {
    return JSON.stringify(answers);
}

/**
 * The answers with this occurrence's entry set (replaced if present), `at` = now.
 *
 * @param {import('./types.js').StoredAiAnswers} answers not mutated
 * @param {string} key an occurrence key with a time
 * @param {{fp:string, verdict:'must'|'ignore', reason:string}} answer reason already normalised
 * @param {number} now
 * @returns {import('./types.js').StoredAiAnswers} frozen
 * @throws {TypeError} when the key, fp, verdict, reason or now is invalid, by the same
 *   rules parseAiAnswers keeps an item. The message names the field, never its value.
 */
export function recordAiAnswer(answers, key, answer, now) {
    if (!isAnswerKey(key))
        throw new TypeError('recordAiAnswer: invalid key');
    const item = { fp: answer?.fp, verdict: answer?.verdict, reason: answer?.reason, at: now };
    const bad = badField(item);
    if (bad !== null)
        throw new TypeError(`recordAiAnswer: invalid ${bad === 'at' ? 'now' : bad}`);
    return freezeAnswers({ ...answers.items, [key]: freezeItem(item) });
}

/**
 * Drop entries whose occurrence time is more than the retention period past.
 *
 * @param {import('./types.js').StoredAiAnswers} answers
 * @param {number} now
 * @returns {import('./types.js').StoredAiAnswers} the SAME object when nothing expired, else a new frozen one
 */
export function pruneAiAnswers(answers, now) {
    const keys = Object.keys(answers.items);
    const kept = keys.filter(k => !isExpiredOccurrenceKey(k, now));
    if (kept.length === keys.length)
        return answers;
    return freezeAnswers(Object.fromEntries(kept.map(k => [k, answers.items[k]])));
}
