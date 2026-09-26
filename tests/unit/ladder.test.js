// Each PRD "Done when" timing case through the real pipeline: judge -> plan -> reduce(actionFor).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../../extension/core/judge.js';
import { plan, actionFor } from '../../extension/core/plan.js';
import { emptyAlertState, reduce } from '../../extension/core/alertState.js';
import { T0, MIN, CONFIG, NO_OVERRIDES, ENV, TIMING, att, event, snapshot } from './support/builders.js';

const S = T0;
const E = emptyAlertState();
const MEET = 'https://meet.google.com/abc-defg-hij';
const PARIS = '12 Rue Exemple, Paris';

function pipeline(events, { overrides = NO_OVERRIDES, travel = {} } = {}) {
    const judged = judge(snapshot(events), CONFIG, overrides, travel);
    const at = (now, state = E) => plan(now, judged, state, TIMING, ENV);
    const stepAt = (now, state) => at(now, state).primary?.step ?? 'none';
    return { judged, at, stepAt };
}

const online = () => event({ description: `Join: ${MEET}` });
const inPerson = () => event({ location: PARIS });
const PARIS_TRAVEL = { travel: { '12 rue exemple, paris': 45 } };

describe('end to end', () => {
    test('online: steps at 30, 10, 3 and 1 min before, and Join ends it', () => {
        const { at, stepAt } = pipeline([online()]);
        assert.deepEqual([S - 30 * MIN, S - 10 * MIN, S - 3 * MIN, S - MIN].map(n => stepAt(n)), [1, 2, 3, 4]);
        const card = at(S - MIN).primary;
        const state = reduce(E, actionFor(card, 'ack'), S - MIN);
        assert.equal(stepAt(S - 30000, state), 'none');
    });

    test('in person with a stored 45 min travel: steps count to leave-by', () => {
        const { stepAt } = pipeline([inPerson()], PARIS_TRAVEL);
        assert.equal(stepAt(S - 55 * MIN - 1), 'none');
        assert.deepEqual([S - 55 * MIN, S - 50 * MIN, S - 47 * MIN, S - 45 * MIN].map(n => stepAt(n)), [1, 2, 3, 4]);
    });

    test('hybrid uses online timing even though a place is present', () => {
        const { stepAt } = pipeline([event({ location: 'HQ, Room 2', description: MEET })]);
        assert.equal(stepAt(S - 30 * MIN), 1);
        assert.equal(stepAt(S - MIN - 1), 3);
        assert.equal(stepAt(S - MIN), 4);
    });

    test('a placeholder overridden to must-attend alerts', () => {
        const { stepAt } = pipeline([event({ summary: 'Lunch' })],
            { overrides: { verdict: { ['occ:evt-1|' + S]: 'must' }, mode: {} } });
        assert.equal(stepAt(S - MIN), 4);
    });

    test('a meeting whose series is overridden to ignore never alerts', () => {
        const { at } = pipeline([event()], { overrides: { verdict: { 'series:evt-1': 'ignore' }, mode: {} } });
        const r = at(S - MIN);
        assert.equal(r.primary, null);
        assert.equal(r.indicator, null);
    });

    test('a hybrid meeting switched to in person takes over at leave-by', () => {
        const { stepAt } = pipeline([event({ location: 'HQ, Room 2', description: MEET })],
            { overrides: { verdict: {}, mode: { ['occ:evt-1|' + S]: 'in-person' } } });
        assert.equal(stepAt(S - 30 * MIN - 1), 3);
        assert.equal(stepAt(S - 30 * MIN), 4);
    });

    test('an in-person nudge snooze never goes past the insist step', () => {
        const { at } = pipeline([inPerson()], PARIS_TRAVEL);
        const L = S - 45 * MIN;
        const card = at(L - 5 * MIN).primary;
        assert.equal(card.step, 2);
        assert.equal(card.snoozeUntil, L - 3 * MIN);
        const state = reduce(E, actionFor(card, 'snooze'), L - 5 * MIN);
        assert.equal(at(L - 4 * MIN, state).primary.visible, false);
        const insist = at(L - 2 * MIN, state).primary;
        assert.equal(insist.step, 3);
        assert.equal(insist.visible, true);
    });

    test('coming back 2 min before shows the insist step first', () => {
        const { at } = pipeline([online()]);
        const r = at(S - 2 * MIN);
        assert.equal(r.primary.step, 3);
        assert.deepEqual(r.also, []);
    });

    test('overlapping meetings: the earlier deadline takes the card', () => {
        const { at } = pipeline([event({ uid: 'b', start: S + 5 * MIN }), event({ uid: 'a' })]);
        const r = at(S - 3 * MIN);
        assert.equal(r.primary.key, 'occ:a|' + S);
        assert.equal(r.primary.step, 3);
        assert.deepEqual(r.also, [{ key: 'occ:b|' + (S + 5 * MIN), step: 2 }]);
    });

    test('10 min after the start nothing alerts, online or in person', () => {
        assert.equal(pipeline([online()]).stepAt(S + 10 * MIN), 'none');
        assert.equal(pipeline([inPerson()], PARIS_TRAVEL).stepAt(S + 10 * MIN), 'none');
        assert.equal(pipeline([inPerson()], PARIS_TRAVEL).stepAt(S + 10 * MIN - 1), 4);
    });

    test('a cancelled meeting never alerts', () => {
        assert.equal(pipeline([event({ status: 'cancelled' })]).stepAt(S - MIN), 'none');
    });

    test('a meeting the owner is not invited to never alerts', () => {
        assert.equal(pipeline([event({ attendees: [att('alice@acme.test'), att('bob@acme.test')] })]).stepAt(S - MIN), 'none');
    });

    test('a 1:1 alerts (D-012)', () => {
        const oneToOne = event({ attendees: [att('me@acme.test'), att('alice@acme.test')] });
        assert.equal(pipeline([oneToOne]).stepAt(S - MIN), 4);
    });
});
