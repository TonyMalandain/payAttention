import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { testAlert, TEST_ALERT_TIMING } from '../../extension/core/testAlert.js';
import { plan, actionFor } from '../../extension/core/plan.js';
import { emptyAlertState, reduce } from '../../extension/core/alertState.js';
import { T0, ENV } from './support/builders.js';

const N = T0;
const t = testAlert(N);
const E = emptyAlertState();
const at = (now, state = E) => plan(now, t.judged, state, t.timing, ENV);
const stepAt = (now, state) => at(now, state).primary?.step ?? 'none';

describe('test alert: the occurrence', () => {
    test('one must-attend online meeting 30 s from now, with no link', () => {
        assert.equal(t.judged.length, 1);
        const [j] = t.judged;
        assert.equal(j.key, 'test:' + N);
        assert.equal(j.verdict, 'must');
        assert.equal(j.reason, 'test alert');
        assert.equal(j.reasonCode, 'test');
        assert.equal(j.joinUrl, null);
        assert.equal(j.mode, 'online');
        assert.equal(j.deadline, N + 30000);
        assert.equal(j.start, N + 30000);
        assert.equal(j.end, N + 90000);
        assert.equal(j.title, 'payAttention test alert');
    });

    test('it is frozen', () => {
        assert.ok(Object.isFrozen(t.judged));
        assert.ok(Object.isFrozen(t.judged[0]));
        assert.ok(Object.isFrozen(t.timing));
    });

    test('its timing is the fast ladder', () => {
        assert.equal(t.timing, TEST_ALERT_TIMING);
    });
});

describe('test alert: the ladder', () => {
    const cases = [[N - 1, 'none'], [N, 1], [N + 9999, 1], [N + 10000, 2], [N + 20000, 3], [N + 25000, 4]];
    for (const [now, expected] of cases) {
        test(`at +${now - N} ms the step is ${expected}`, () => {
            assert.equal(stepAt(now), expected);
        });
    }

    test('the takeover shows at +25 s', () => {
        assert.equal(at(N + 25000).takeover, true);
    });

    test('acknowledging ends it', () => {
        const state = reduce(E, actionFor(at(N + 25000).primary, 'ack'), N + 25000);
        assert.equal(stepAt(N + 26000, state), 'none');
    });

    test('never acted on, it gives up 60 s after its start', () => {
        assert.equal(stepAt(N + 89999), 4);
        assert.equal(stepAt(N + 90000), 'none');
    });

    test('a takeover snooze lasts 5 s', () => {
        assert.equal(at(N + 25000).primary.snoozeUntil, N + 30000);
    });

    test('the whole ladder runs within 30 s', () => {
        assert.ok(t.timing.online.headsUpMs - t.timing.online.takeoverMs <= 30000);
    });
});
