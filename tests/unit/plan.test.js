// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { plan, actionFor } from '../../extension/core/plan.js';
import { emptyAlertState, reduce } from '../../extension/core/alertState.js';
import { timingFromSettings } from '../../extension/core/timing.js';
import { DEFAULT_SETTINGS } from '../../extension/core/defaults.js';
import { T0, MIN, HOUR, TIMING, ENV, judged, deepFreeze } from './support/builders.js';

const S = T0;
const E = emptyAlertState();
const p = (now, list, state = E, timing = TIMING, env = ENV) => plan(now, list, state, timing, env);
const stepAt = (now, list, state, timing, env) => p(now, list, state, timing, env).primary?.step ?? 'none';

const ONLINE = judged();
const KEY = ONLINE.key;
const L = S - 30 * MIN;
const IN_PERSON = judged({ mode: 'in-person', travelMinutes: 30, deadline: L, placeText: 'HQ', placeKey: 'hq' });

/** Snooze the primary card at `now`, the way the controller does. */
function snoozeAt(now, list, state = E, timing = TIMING) {
    const card = p(now, list, state, timing).primary;
    return { card, state: reduce(state, actionFor(card, 'snooze'), now) };
}

function ackAt(now, list, state = E) {
    const card = p(now, list, state).primary;
    return reduce(state, actionFor(card, 'ack'), now);
}

describe('plan: online ladder (PRD §3)', () => {
    const cases = [
        [S - 30 * MIN - 1, 'none'], [S - 30 * MIN, 1],
        [S - 10 * MIN - 1, 1], [S - 10 * MIN, 2],
        [S - 3 * MIN - 1, 2], [S - 3 * MIN, 3],
        [S - MIN - 1, 3], [S - MIN, 4],
        [S, 4], [S + 10 * MIN - 1, 4],
        [S + 10 * MIN, 'none'],
    ];
    for (const [now, expected] of cases) {
        test(`at start${now - S >= 0 ? '+' : ''}${now - S} ms the step is ${expected}`, () => {
            assert.equal(stepAt(now, [ONLINE]), expected);
        });
    }

    test('before the heads-up there is no card and no takeover', () => {
        assert.equal(p(S - 30 * MIN - 1, [ONLINE]).takeover, false);
    });

    test('the heads-up is visible and asks to be recorded', () => {
        const card = p(S - 30 * MIN, [ONLINE]).primary;
        assert.equal(card.visible, true);
        assert.equal(card.recordHeadsUpShown, true);
    });

    test('step 4 is a takeover', () => {
        assert.equal(p(S - MIN, [ONLINE]).takeover, true);
    });

    test('the card carries the time left to the deadline', () => {
        assert.equal(p(S - 10 * MIN, [ONLINE]).primary.msToDeadline, 600000);
    });
});

describe('plan: in-person ladder counts to leave-by (PRD §3, D-008)', () => {
    const cases = [
        [L - 10 * MIN - 1, 'none'], [L - 10 * MIN, 1],
        [L - 5 * MIN, 2], [L - 2 * MIN - 1, 2], [L - 2 * MIN, 3],
        [L - 1, 3], [L, 4],
        [S + 10 * MIN - 1, 4], [S + 10 * MIN, 'none'],
    ];
    for (const [now, expected] of cases) {
        test(`at leave-by${now - L >= 0 ? '+' : ''}${now - L} ms the step is ${expected}`, () => {
            assert.equal(stepAt(now, [IN_PERSON]), expected);
        });
    }

    test('the takeover starts at leave-by', () => {
        assert.equal(p(L, [IN_PERSON]).takeover, true);
    });
});

describe('plan: timing edge cases', () => {
    test('a hybrid meeting uses online timing', () => {
        const hybrid = judged({ mode: 'online', placeText: 'HQ', placeKey: 'hq', deadline: S });
        assert.equal(stepAt(S - MIN, [hybrid]), 4);
        assert.equal(stepAt(S - 11 * MIN, [hybrid]), 1);
    });

    test('custom heads-up timing is used', () => {
        const timing = timingFromSettings({ ...DEFAULT_SETTINGS, onlineHeadsupMinutes: 15 });
        assert.equal(stepAt(S - 16 * MIN, [ONLINE], E, timing), 'none');
        assert.equal(stepAt(S - 15 * MIN, [ONLINE], E, timing), 1);
    });

    test('a custom cutoff is used', () => {
        const timing = timingFromSettings({ ...DEFAULT_SETTINGS, cutoffMinutes: 5 });
        assert.equal(stepAt(S + 5 * MIN, [ONLINE], E, timing), 'none');
    });

    test('out-of-order in-person settings are clamped so the order holds', () => {
        const timing = timingFromSettings({ ...DEFAULT_SETTINGS, inpersonInsistMinutes: 0, inpersonTakeoverMinutes: 1 });
        assert.equal(stepAt(L - MIN, [IN_PERSON], E, timing), 2);
        assert.equal(stepAt(L, [IN_PERSON], E, timing), 4);
    });

    test('a nudge set earlier than the heads-up is clamped to the heads-up', () => {
        const timing = timingFromSettings({ ...DEFAULT_SETTINGS, onlineHeadsupMinutes: 10, onlineNudgeMinutes: 20 });
        assert.equal(stepAt(S - 10 * MIN, [ONLINE], E, timing), 2);
        assert.equal(stepAt(S - 11 * MIN, [ONLINE], E, timing), 'none');
    });

    test('a negative offset is clamped to 0', () => {
        const timing = { ...TIMING, online: { ...TIMING.online, takeoverMs: -60000 } };
        assert.equal(stepAt(S, [ONLINE], E, timing), 4);
        assert.equal(stepAt(S - 1, [ONLINE], E, timing), 3);
    });
});

describe('plan: verdicts and missing data', () => {
    test('an ignorable meeting never alerts and is not in the indicator', () => {
        const r = p(S - MIN, [judged({ verdict: 'ignore' })]);
        assert.equal(r.primary, null);
        assert.equal(r.indicator, null);
    });

    test('a must-attend meeting with no deadline never alerts', () => {
        assert.equal(stepAt(S - MIN, [judged({ allDay: true, deadline: null })]), 'none');
    });
});

describe('plan: heads-up display and idle', () => {
    const state1 = reduce(E, { type: 'headsUpShown', key: KEY, start: S }, S - 30 * MIN);

    test('the heads-up stays for 15 s after it was first shown', () => {
        const card = p(S - 30 * MIN + 14999, [ONLINE], state1).primary;
        assert.equal(card.visible, true);
        assert.equal(card.recordHeadsUpShown, false);
    });

    test('the heads-up goes away on its own after 15 s', () => {
        const r = p(S - 30 * MIN + 15000, [ONLINE], state1);
        assert.equal(r.primary.visible, false);
        assert.equal(r.takeover, false);
    });

    test('the nudge shows after the heads-up went away', () => {
        const card = p(S - 10 * MIN, [ONLINE], state1).primary;
        assert.equal(card.step, 2);
        assert.equal(card.visible, true);
    });

    test('an idle owner does not consume the heads-up', () => {
        const idle = { userActive: false, dataHealthy: true, heldHeadsUpKey: null };
        for (const now of [S - 30 * MIN, S - 20 * MIN]) {
            const card = p(now, [ONLINE], E, TIMING, idle).primary;
            assert.equal(card.visible, true);
            assert.equal(card.recordHeadsUpShown, false);
        }
        const back = p(S - 15 * MIN, [ONLINE], E, TIMING, ENV).primary;
        assert.equal(back.visible, true);
        assert.equal(back.recordHeadsUpShown, true);
    });

    test('a held heads-up stays after its display time', () => {
        const card = p(S - 30 * MIN + 15000, [ONLINE], state1, TIMING, { ...ENV, heldHeadsUpKey: KEY }).primary;
        assert.equal(card.visible, true);
        assert.equal(card.recordHeadsUpShown, false);
    });

    test('a hold for another meeting does not keep this one', () => {
        const card = p(S - 30 * MIN + 15000, [ONLINE], state1, TIMING, { ...ENV, heldHeadsUpKey: 'occ:other|1' }).primary;
        assert.equal(card.visible, false);
    });

    test('a snooze wins over a hold', () => {
        const { state } = snoozeAt(S - 30 * MIN + 1000, [ONLINE], state1);
        const card = p(S - 30 * MIN + 15000, [ONLINE], state, TIMING, { ...ENV, heldHeadsUpKey: KEY }).primary;
        assert.equal(card.step, 1);
        assert.equal(card.visible, false);
    });

    test('a hold does nothing at step 2', () => {
        const held = p(S - 10 * MIN, [ONLINE], state1, TIMING, { ...ENV, heldHeadsUpKey: KEY }).primary;
        const notHeld = p(S - 10 * MIN, [ONLINE], state1).primary;
        assert.deepEqual(held, notHeld);
    });
});

// PRD §4, interfaces.md §2: the hold never delays another meeting. While any other
// meeting is visible at step 2 or later, the Plan is the Plan with no hold.
describe('plan: the heads-up hold yields to other meetings', () => {
    const held = key => ({ ...ENV, heldHeadsUpKey: key });

    test('a held heads-up with an earlier leave-by does not keep the card from another meeting\'s nudge', () => {
        const shown = reduce(E, { type: 'headsUpShown', key: IN_PERSON.key, start: S }, L - 10 * MIN);
        const B = judged({ key: 'occ:b|' + (L + 2 * MIN), start: L + 2 * MIN, deadline: L + 2 * MIN });
        const withHold = p(L - 7 * MIN, [IN_PERSON, B], shown, TIMING, held(IN_PERSON.key));
        const noHold = p(L - 7 * MIN, [IN_PERSON, B], shown);
        assert.equal(noHold.primary.key, B.key);
        assert.equal(noHold.primary.step, 2);
        assert.deepEqual(withHold, noHold);
    });

    test('a held heads-up is not listed beside another meeting\'s nudge', () => {
        const B = judged({ key: 'occ:b|' + (S - 15 * MIN), start: S - 15 * MIN, deadline: S - 15 * MIN });
        const state = reduce(E, { type: 'headsUpShown', key: KEY, start: S }, S - 30 * MIN);
        const withHold = p(S - 25 * MIN, [ONLINE, B], state, TIMING, held(KEY));
        assert.deepEqual(withHold, p(S - 25 * MIN, [ONLINE, B], state));
        assert.deepEqual(withHold.also, []);
    });

    test('a snoozed nudge does not end the hold', () => {
        const B = judged({ key: 'occ:b|' + (S - 15 * MIN), start: S - 15 * MIN, deadline: S - 15 * MIN });
        const shown = reduce(E, { type: 'headsUpShown', key: KEY, start: S }, S - 30 * MIN);
        const { card, state } = snoozeAt(S - 25 * MIN, [ONLINE, B], shown);
        assert.equal(card.key, B.key);
        const r = p(S - 24 * MIN, [ONLINE, B], state, TIMING, held(KEY));
        assert.equal(r.primary.key, KEY);
        assert.equal(r.primary.visible, true);
    });

    test('another meeting at its heads-up does not end the hold', () => {
        const B = judged({ key: 'occ:b|' + (S + 5 * MIN), start: S + 5 * MIN, deadline: S + 5 * MIN });
        const state = reduce(E, { type: 'headsUpShown', key: KEY, start: S }, S - 30 * MIN);
        const r = p(S - 24 * MIN, [ONLINE, B], state, TIMING, held(KEY));
        assert.equal(r.primary.key, KEY);
        assert.equal(r.primary.visible, true);
        assert.deepEqual(r.also, [{ key: B.key, step: 1 }]);
    });
});

describe('plan: return after being away (R-13)', () => {
    test('coming back 2 min before shows the insist step directly', () => {
        const r = p(S - 2 * MIN, [ONLINE]);
        assert.equal(r.primary.step, 3);
        assert.equal(r.primary.visible, true);
        assert.deepEqual(r.also, []);
    });

    test('coming back after the start shows the takeover', () => {
        const r = p(S + 5 * MIN, [ONLINE]);
        assert.equal(r.primary.step, 4);
        assert.equal(r.takeover, true);
    });

    test('coming back after leave-by shows the takeover for an in-person meeting', () => {
        assert.equal(stepAt(L + MIN, [IN_PERSON]), 4);
    });
});

describe('plan: snooze', () => {
    test('a nudge snooze lasts 2 min when the next step is further away', () => {
        const { card, state } = snoozeAt(S - 10 * MIN, [ONLINE]);
        assert.equal(card.snoozeUntil, S - 8 * MIN);
        assert.equal(p(S - 9 * MIN, [ONLINE], state).primary.visible, false);
        const back = p(S - 8 * MIN, [ONLINE], state).primary;
        assert.equal(back.step, 2);
        assert.equal(back.visible, true);
    });

    test('a nudge snooze never goes past the next step', () => {
        const { card, state } = snoozeAt(S - 4 * MIN, [ONLINE]);
        assert.equal(card.snoozeUntil, S - 3 * MIN);
        const next = p(S - 3 * MIN, [ONLINE], state).primary;
        assert.equal(next.step, 3);
        assert.equal(next.visible, true);
    });

    test('a heads-up snooze is limited by the nudge', () => {
        const { card, state } = snoozeAt(S - 11 * MIN, [ONLINE]);
        assert.equal(card.snoozeUntil, S - 10 * MIN);
        const next = p(S - 10 * MIN, [ONLINE], state).primary;
        assert.equal(next.step, 2);
        assert.equal(next.visible, true);
    });

    test('an insist snooze is limited by the takeover', () => {
        const { card, state } = snoozeAt(S - 150000, [ONLINE]);
        assert.equal(card.snoozeUntil, S - MIN);
        const r = p(S - MIN, [ONLINE], state);
        assert.equal(r.primary.step, 4);
        assert.equal(r.takeover, true);
    });

    test('a takeover snooze lasts 1 min and the takeover comes back every minute', () => {
        const first = snoozeAt(S - MIN, [ONLINE]);
        assert.equal(first.card.snoozeUntil, S);
        const hidden = p(S - 1, [ONLINE], first.state);
        assert.equal(hidden.takeover, false);
        assert.equal(hidden.primary.visible, false);
        assert.equal(p(S, [ONLINE], first.state).takeover, true);

        const second = snoozeAt(S, [ONLINE], first.state);
        assert.equal(second.card.snoozeUntil, S + MIN);
        assert.equal(p(S + MIN, [ONLINE], second.state).takeover, true);
    });

    test('the cutoff wins over a takeover snooze', () => {
        const { card, state } = snoozeAt(S + 570000, [ONLINE]);
        assert.equal(card.snoozeUntil, S + 630000);
        assert.equal(stepAt(S + 10 * MIN, [ONLINE], state), 'none');
    });

    test('an in-person nudge snooze lasts 2 min before the insist step', () => {
        assert.equal(snoozeAt(L - 5 * MIN, [IN_PERSON]).card.snoozeUntil, L - 3 * MIN);
    });
});

describe('plan: actionFor', () => {
    const card = p(S - 10 * MIN, [ONLINE]).primary;

    test('ack carries the key and start', () => {
        assert.deepEqual(actionFor(card, 'ack'), { type: 'ack', key: KEY, start: S });
    });

    test('snooze carries the end the plan computed', () => {
        assert.deepEqual(actionFor(card, 'snooze'), { type: 'snooze', key: KEY, start: S, until: card.snoozeUntil });
    });

    test('headsUpShown carries the key and start', () => {
        assert.deepEqual(actionFor(card, 'headsUpShown'), { type: 'headsUpShown', key: KEY, start: S });
    });

    test('skip carries the key and start', () => {
        assert.deepEqual(actionFor(card, 'skip'), { type: 'skip', key: KEY, start: S });
    });

    test('any other type is refused', () => {
        assert.throws(() => actionFor(card, 'join'), TypeError);
    });
});

describe('plan: acknowledge and skip', () => {
    test('after an acknowledgement nothing alerts, and the indicator keeps it until the deadline', () => {
        const state = ackAt(S - 10 * MIN, [ONLINE]);
        for (const now of [S - 3 * MIN, S - MIN, S, S + 5 * MIN])
            assert.equal(stepAt(now, [ONLINE], state), 'none', `at ${now - S}`);
        assert.equal(p(S - 5 * MIN, [ONLINE], state).indicator.key, KEY);
        assert.equal(p(S + 1, [ONLINE], state).indicator, null);
    });

    test('after a skip nothing alerts and the indicator drops it', () => {
        const card = p(S - 10 * MIN, [ONLINE]).primary;
        const state = reduce(E, actionFor(card, 'skip'), S - 10 * MIN);
        assert.equal(stepAt(S - MIN, [ONLINE], state), 'none');
        assert.equal(p(S - 5 * MIN, [ONLINE], state).indicator, null);
    });
});

describe('plan: a moved meeting', () => {
    test('an acknowledgement for the old time does not silence the new time', () => {
        const key = 'occ:r|' + S;
        const state = reduce(E, { type: 'ack', key, start: S }, S - 10 * MIN);
        const moved = judged({ key, start: S + 30 * MIN, deadline: S + 30 * MIN });
        assert.equal(stepAt(S + 29 * MIN, [moved], state), 4);
    });
});

describe('plan: overlapping meetings', () => {
    const A = judged({ key: 'occ:a|' + S });
    const B = judged({ key: 'occ:b|' + (S + 5 * MIN), start: S + 5 * MIN, deadline: S + 5 * MIN });

    test('the earlier deadline takes the card, the other is listed as "also"', () => {
        const r = p(S - 3 * MIN, [B, A]);
        assert.equal(r.primary.key, A.key);
        assert.equal(r.primary.step, 3);
        assert.deepEqual(r.also, [{ key: B.key, step: 2 }]);
    });

    test('after acknowledging the first, the second takes the card', () => {
        const state = reduce(E, { type: 'ack', key: A.key, start: S }, S - 3 * MIN);
        assert.equal(p(S - 3 * MIN, [A, B], state).primary.key, B.key);
    });

    test('an in-person meeting with an earlier leave-by beats an online meeting', () => {
        const C = judged({ key: 'occ:c|' + (S + 20 * MIN), start: S + 20 * MIN, mode: 'in-person', travelMinutes: 30,
            deadline: S - 10 * MIN, placeText: 'HQ', placeKey: 'hq' });
        const r = p(S - 12 * MIN, [A, C]);
        assert.equal(r.primary.key, C.key);
        assert.equal(r.primary.step, 3);
        assert.deepEqual(r.also, [{ key: A.key, step: 1 }]);
    });

    test('a takeover is never hidden behind a lower step', () => {
        const timing = { ...TIMING, inPerson: { headsUpMs: 60 * MIN, nudgeMs: 50 * MIN, insistMs: 40 * MIN, takeoverMs: 30 * MIN } };
        const Bp = judged({ key: 'occ:bp|' + (S + 40 * MIN), start: S + 40 * MIN, mode: 'in-person', travelMinutes: 30,
            deadline: S + 10 * MIN, placeText: 'HQ', placeKey: 'hq' });
        const r = p(S - 5 * MIN, [A, Bp], E, timing);
        assert.equal(r.primary.key, Bp.key);
        assert.equal(r.primary.step, 4);
        assert.equal(r.takeover, true);
        assert.deepEqual(r.also, [{ key: A.key, step: 2 }]);
    });

    test('a snoozed meeting gives way to a visible one and is not listed', () => {
        const { state } = snoozeAt(S - 9 * MIN, [A]);
        const r = p(S - 8 * MIN, [A, B], state);
        assert.equal(r.primary.key, B.key);
        assert.equal(r.primary.visible, true);
        assert.deepEqual(r.also, []);
    });

    test('when everything is snoozed the primary is hidden and there is no takeover', () => {
        const { state } = snoozeAt(S - MIN, [A]);
        const r = p(S - 30000, [A], state);
        assert.equal(r.primary.key, A.key);
        assert.equal(r.primary.visible, false);
        assert.equal(r.takeover, false);
    });

    test('"also" is sorted by deadline', () => {
        const C = judged({ key: 'occ:c|' + (S + 6 * MIN), start: S + 6 * MIN, deadline: S + 6 * MIN });
        const r = p(S - 3 * MIN, [C, B, A]);
        assert.equal(r.primary.key, A.key);
        assert.deepEqual(r.also, [{ key: B.key, step: 2 }, { key: C.key, step: 2 }]);
    });
});

describe('plan: the top-bar indicator', () => {
    const far = judged({ key: 'occ:far|' + (S + 12 * HOUR), start: S + 12 * HOUR, deadline: S + 12 * HOUR });

    test('a meeting 12 h away is the indicator target', () => {
        assert.deepEqual(p(S, [far]).indicator, { key: far.key, deadline: S + 12 * HOUR, msToDeadline: 12 * HOUR });
    });

    test('a meeting more than 12 h away is not', () => {
        assert.equal(p(S - 1, [far]).indicator, null);
    });

    test('a closer ignorable meeting is not chosen', () => {
        const near = judged({ key: 'occ:near|' + (S + HOUR), start: S + HOUR, deadline: S + HOUR, verdict: 'ignore' });
        const later = judged({ key: 'occ:later|' + (S + 2 * HOUR), start: S + 2 * HOUR, deadline: S + 2 * HOUR });
        assert.equal(p(S, [near, later]).indicator.key, later.key);
    });

    test('a passed deadline not acknowledged stays the target until the cutoff', () => {
        assert.deepEqual(p(S + 2 * MIN, [ONLINE]).indicator, { key: KEY, deadline: S, msToDeadline: -2 * MIN });
    });

    test('data health passes through', () => {
        assert.equal(p(S, [ONLINE], E, TIMING, { userActive: true, dataHealthy: false, heldHeadsUpKey: null }).dataHealthy, false);
        assert.equal(p(S, [ONLINE]).dataHealthy, true);
    });
});

describe('plan: purity and inputs', () => {
    test('deep-frozen inputs are accepted and the plan is frozen', () => {
        const state = deepFreeze(JSON.parse(JSON.stringify(reduce(E, { type: 'headsUpShown', key: KEY, start: S }, S - 30 * MIN))));
        const list = deepFreeze([judged(), judged({ key: 'occ:x|' + S })]);
        const r = plan(S - 3 * MIN, list, state, deepFreeze({ ...TIMING }), deepFreeze({ ...ENV }));
        assert.ok(Object.isFrozen(r));
        assert.ok(Object.isFrozen(r.primary));
        assert.ok(Object.isFrozen(r.also));
        assert.ok(Object.isFrozen(r.also[0]));
        assert.ok(Object.isFrozen(r.indicator));
    });

    test('a missing data-health flag is refused', () => {
        assert.throws(() => plan(S, [], E, TIMING, { userActive: true, heldHeadsUpKey: null }), { name: 'TypeError', message: /dataHealthy/ });
    });

    test('a hold that is not null or a non-empty string is refused', () => {
        for (const heldHeadsUpKey of [undefined, '', 5]) {
            assert.throws(() => plan(S, [], E, TIMING, { userActive: true, dataHealthy: true, heldHeadsUpKey }),
                { name: 'TypeError', message: /heldHeadsUpKey/ }, String(heldHeadsUpKey));
        }
    });

    test('a timing without a cutoff is refused', () => {
        const timing = { ...TIMING };
        delete timing.cutoffMs;
        assert.throws(() => plan(S, [], E, timing, ENV), { name: 'TypeError', message: /cutoffMs/ });
    });

    test('a non-finite now is refused', () => {
        assert.throws(() => plan(NaN, [], E, TIMING, ENV), TypeError);
    });
});
