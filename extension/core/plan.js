// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// plan(): what is on screen right now (ADR-0002: level-triggered, recomputed on
// every tick from the time, the judged meetings and the owner's actions).
// Nothing is scheduled, so a missed tick (sleep, lock, idle) cannot lose a step.

const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const OFFSET_FIELDS = ['headsUpMs', 'nudgeMs', 'insistMs', 'takeoverMs'];
const TIMING_FIELDS = ['headsUpDisplayMs', 'snoozeMs', 'takeoverSnoozeMs', 'cutoffMs'];
const CARD_ACTIONS = ['ack', 'skip', 'snooze', 'headsUpShown'];

const isFiniteNumber = v => typeof v === 'number' && Number.isFinite(v);
const isObject = v => typeof v === 'object' && v !== null;

function checkInputs(now, judged, alertState, timing, env) {
    if (!isFiniteNumber(now))
        throw new TypeError('plan: now must be a finite number');
    if (!Array.isArray(judged))
        throw new TypeError('plan: judged must be an array');
    if (!isObject(alertState) || !isObject(alertState.items))
        throw new TypeError('plan: alertState.items must be an object');
    if (!isObject(timing))
        throw new TypeError('plan: timing must be an object');
    for (const mode of ['online', 'inPerson']) {
        for (const field of OFFSET_FIELDS) {
            if (!isObject(timing[mode]) || !isFiniteNumber(timing[mode][field]))
                throw new TypeError(`plan: timing.${mode}.${field} must be a finite number`);
        }
    }
    for (const field of TIMING_FIELDS) {
        if (!isFiniteNumber(timing[field]))
            throw new TypeError(`plan: timing.${field} must be a finite number`);
    }
    if (!isObject(env))
        throw new TypeError('plan: env must be an object');
    for (const field of ['userActive', 'dataHealthy']) {
        if (typeof env[field] !== 'boolean')
            throw new TypeError(`plan: env.${field} must be a boolean`);
    }
    if (env.heldHeadsUpKey !== null && (typeof env.heldHeadsUpKey !== 'string' || env.heldHeadsUpKey === ''))
        throw new TypeError('plan: env.heldHeadsUpKey must be null or a non-empty string');
}

/** Offsets clamped so the steps can never be out of order or after the deadline. */
function clampOffsets(o) {
    const o1 = Math.max(0, o.headsUpMs);
    const o2 = Math.min(Math.max(0, o.nudgeMs), o1);
    const o3 = Math.min(Math.max(0, o.insistMs), o2);
    const o4 = Math.min(Math.max(0, o.takeoverMs), o3);
    return [o1, o2, o3, o4];
}

function compareKeys(a, b) {
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function byDeadlineThenKey(a, b) {
    return a.deadline - b.deadline || compareKeys(a, b);
}

function byPrimaryOrder(a, b) {
    if (a.visible !== b.visible)
        return a.visible ? -1 : 1;
    const aTakeover = a.step === 4 && a.visible;
    const bTakeover = b.step === 4 && b.visible;
    if (aTakeover !== bTakeover)
        return aTakeover ? -1 : 1;
    return byDeadlineThenKey(a, b);
}

/**
 * What to show now: the one card (highest step reached, never replaying passed
 * steps), the other active meetings, whether the takeover is up, and the
 * top-bar target.
 *
 * @param {number} now
 * @param {ReadonlyArray<import('./types.js').JudgedOccurrence>} judged from judge()
 * @param {import('./types.js').AlertState} alertState
 * @param {import('./types.js').Timing} timing
 * @param {import('./types.js').PlanEnv} env
 * @returns {import('./types.js').Plan} frozen
 * @throws {TypeError} when an argument does not have the expected shape
 */
export function plan(now, judged, alertState, timing, env) {
    checkInputs(now, judged, alertState, timing, env);
    const offsets = { online: clampOffsets(timing.online), inPerson: clampOffsets(timing.inPerson) };

    const active = [];
    const indicatorCandidates = [];
    let held = null;
    for (const j of judged) {
        if (j.verdict !== 'must' || !Number.isFinite(j.deadline) || !Number.isFinite(j.start))
            continue;
        const { key, start, deadline } = j;
        const times = (j.mode === 'online' ? offsets.online : offsets.inPerson).map(o => deadline - o);
        const cutoff = start + timing.cutoffMs;
        const stored = Object.hasOwn(alertState.items, key) ? alertState.items[key] : undefined;
        // An item recorded for another start belongs to the meeting before it moved.
        const item = stored?.start === start ? stored : undefined;
        const done = item?.done ?? null;

        if (done !== 'skip' && now < cutoff && deadline - now <= TWELVE_HOURS && (done !== 'ack' || now < deadline))
            indicatorCandidates.push({ key, deadline });

        if (done !== null || now >= cutoff || now < times[0])
            continue;
        const step = times.findLastIndex(t => t <= now) + 1;
        const snoozed = item?.snoozeUntil != null && now < item.snoozeUntil;
        const headsUpShownAt = item?.headsUpShownAt ?? null;
        const visible = step === 1
            ? !snoozed && (headsUpShownAt === null || now < headsUpShownAt + timing.headsUpDisplayMs)
            : !snoozed;
        const card = {
            key,
            start,
            step,
            visible,
            deadline,
            msToDeadline: deadline - now,
            snoozeUntil: step < 4 ? Math.min(now + timing.snoozeMs, times[step]) : now + timing.takeoverSnoozeMs,
            recordHeadsUpShown: step === 1 && visible && headsUpShownAt === null && env.userActive,
        };
        active.push(card);
        if (key === env.heldHeadsUpKey && step === 1 && !snoozed)
            held = card;
    }

    // The owner holds a heads-up while its travel choices are open: it stays
    // after its display time, but a snooze still hides it and it never delays
    // another meeting. While any other one is visible at step 2 or later,
    // nothing is held (PRD §4, interfaces.md §2).
    if (held && !active.some(c => c !== held && c.visible && c.step >= 2))
        held.visible = true;

    const [first = null, ...rest] = active.sort(byPrimaryOrder);
    const primary = first && Object.freeze(first);
    const also = rest
        .filter(c => c.visible)
        .sort(byDeadlineThenKey)
        .map(c => Object.freeze({ key: c.key, step: c.step }));
    const target = indicatorCandidates.sort(byDeadlineThenKey)[0];
    const indicator = target
        ? Object.freeze({ key: target.key, deadline: target.deadline, msToDeadline: target.deadline - now })
        : null;

    return Object.freeze({
        primary,
        also: Object.freeze(also),
        takeover: !!primary && primary.visible && primary.step === 4,
        indicator,
        dataHealthy: env.dataHealthy,
    });
}

/**
 * The action for an owner's choice on a card. The only sanctioned way to build
 * per-occurrence actions: a snooze's end comes from the plan, so it can never
 * outlive its step.
 *
 * @param {import('./types.js').Card} card
 * @param {'ack'|'skip'|'snooze'|'headsUpShown'} type Join is 'ack' after opening the link
 * @returns {import('./types.js').AlertAction}
 * @throws {TypeError} for any other type
 */
export function actionFor(card, type) {
    if (!CARD_ACTIONS.includes(type))
        throw new TypeError(`actionFor: unknown action type '${type}'`);
    const action = { type, key: card.key, start: card.start };
    if (type === 'snooze')
        action.until = card.snoozeUntil;
    return Object.freeze(action);
}
