import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Time formatting depends on the zone; fix it before the modules are loaded.
process.env.TZ = 'UTC';
const { buildView, TRAVEL_CHOICES_MIN } = await import('../../extension/shell/view.js');
const { formatClock, formatSince, formatShort } = await import('../../extension/core/display.js');
const { plan, actionFor } = await import('../../extension/core/plan.js');
const { emptyAlertState, reduce } = await import('../../extension/core/alertState.js');
const { testAlert } = await import('../../extension/core/testAlert.js');
const { T0, MIN, HOUR, TIMING, ENV, judged, judgeOne, event } = await import('./support/builders.js');

const E = emptyAlertState();
const OK = Object.freeze({ state: 'ok', since: null, calendars: [] });
const ONLINE = judged({ joinUrl: 'https://meet.google.com/abc-defg-hij' });
const LEAVE = T0 - 30 * MIN;
const IN_PERSON = judged({
    key: 'occ:p1|' + T0, seriesKey: 'series:p1', title: 'Site visit', mode: 'in-person',
    placeText: 'HQ', placeKey: 'hq', travelMinutes: 30, travelIsDefault: true, deadline: LEAVE,
});

/** The view the controller would build for `list` at `now`. */
function view(now, list, { state = E, health = OK, test = null, env = ENV } = {}) {
    const realPlan = plan(now, list, state, TIMING, env);
    const testPlan = test ? plan(now, test.judged, test.state ?? E, test.timing, env) : null;
    return buildView({
        plan: realPlan,
        testPlan,
        testJudged: test ? test.judged[0] : null,
        judged: list,
        judgedByKey: new Map(list.map(j => [j.key, j])),
        health,
        now,
    });
}

describe('view: which plan draws the alert', () => {
    test('a running test alert takes precedence over a real one', () => {
        const now = T0 - 25 * MIN;
        const v = view(now, [ONLINE], { test: testAlert(now) });
        assert.equal(v.alert.isTest, true);
        assert.equal(v.alert.key, 'test:' + now);
        assert.equal(v.alert.title, 'payAttention test alert');
    });

    test('the real alert, when no test is visible', () => {
        const v = view(T0 - 25 * MIN, [ONLINE]);
        assert.equal(v.alert.isTest, false);
        assert.equal(v.alert.key, ONLINE.key);
        assert.equal(v.alert.title, 'Client sync');
        assert.equal(v.alert.step, 1);
    });

    test('no visible primary gives no alert', () => {
        assert.equal(view(T0 - 2 * HOUR, [ONLINE]).alert, null);
    });
});

describe('view: the alert', () => {
    test('takeover at step 4, card before', () => {
        assert.equal(view(T0 - 30_000, [ONLINE]).alert.presentation, 'takeover');
        assert.equal(view(T0 - 30_000, [ONLINE]).alert.step, 4);
        assert.equal(view(T0 - 2 * MIN, [ONLINE]).alert.presentation, 'card');
    });

    test('online: headline, countdown, caption, time line and reason', () => {
        const now = T0 - 90_000;
        const a = view(now, [ONLINE]).alert;
        assert.equal(a.headline, 'About to start');
        assert.equal(a.countdown, '1:30');
        assert.equal(a.countdownCaption, 'until it starts');
        assert.equal(a.timeLine, `Starts at ${formatClock(T0)} · in 2 min`);
        assert.equal(a.reason, 'Why: x');
    });

    test('in person: the time line is the leave-by time', () => {
        const now = LEAVE - 5 * MIN;
        const a = view(now, [IN_PERSON]).alert;
        assert.equal(a.headline, 'Get ready');
        assert.equal(a.timeLine, `Leave by ${formatClock(LEAVE)} · in 5 min`);
    });

    test('past the deadline the caption says since', () => {
        const a = view(T0 + 2 * MIN, [ONLINE]).alert;
        assert.equal(a.countdown, '−2:00');
        assert.equal(a.countdownCaption, 'since it started');
    });

    test('the title is on one line and cut to 120 characters', () => {
        const long = judged({ title: 'a\n' + 'b'.repeat(200) });
        const a = view(T0 - 25 * MIN, [long]).alert;
        assert.equal(a.title.length, 120);
        assert.ok(a.title.startsWith('a b'));
    });

    test('travel shows for in person at steps 1 and 2, with the choices', () => {
        for (const now of [LEAVE - 10 * MIN, LEAVE - 5 * MIN]) {
            const a = view(now, [IN_PERSON]).alert;
            assert.deepEqual(a.travel, {
                placeKey: 'hq', minutes: 30, text: 'Travel: 30 min (default)', choices: TRAVEL_CHOICES_MIN,
            });
        }
    });

    test('travel is hidden at steps 3 and 4, and for online meetings', () => {
        assert.equal(view(LEAVE - 2 * MIN, [IN_PERSON]).alert.travel, null);
        assert.equal(view(LEAVE, [IN_PERSON]).alert.travel, null);
        assert.equal(view(T0 - 25 * MIN, [ONLINE]).alert.travel, null);
    });

    test('a stored travel time has no (default) mark', () => {
        const stored = { ...IN_PERSON, travelMinutes: 45, travelIsDefault: false, deadline: T0 - 45 * MIN };
        assert.equal(view(T0 - 50 * MIN, [stored]).alert.travel.text, 'Travel: 45 min');
    });

    test('an in-person meeting with no place has no travel choices', () => {
        const noPlace = { ...IN_PERSON, placeText: '', placeKey: null };
        const a = view(LEAVE - 10 * MIN, [noPlace]).alert;
        assert.equal(a.travel.placeKey, null);
        assert.deepEqual(a.travel.choices, []);
    });

    test('the travel choices', () => {
        assert.deepEqual(TRAVEL_CHOICES_MIN, [10, 15, 20, 30, 45, 60, 90]);
        assert.ok(Object.isFrozen(TRAVEL_CHOICES_MIN));
    });

    test('Join only with a link', () => {
        assert.equal(view(T0 - 25 * MIN, [ONLINE]).alert.canJoin, true);
        assert.equal(view(T0 - 25 * MIN, [judged()]).alert.canJoin, false);
    });

    test('the whole-series choice only for a real repeating meeting', () => {
        assert.equal(view(T0 - 25 * MIN, [judged({ recurring: true })]).alert.offerSeries, true);
        assert.equal(view(T0 - 25 * MIN, [judged()]).alert.offerSeries, false);
        const now = T0 - 25 * MIN;
        assert.equal(view(now, [judged({ recurring: true })], { test: testAlert(now) }).alert.offerSeries, false);
    });

    test('an overlapping meeting is listed as "also"', () => {
        const other = judged({ key: 'occ:j2|' + (T0 + 5 * MIN), title: 'Board\nreview', start: T0 + 5 * MIN, deadline: T0 + 5 * MIN });
        const a = view(T0 - 20 * MIN, [ONLINE, other]).alert;
        assert.equal(a.key, ONLINE.key);
        assert.deepEqual(a.also, [`also: Board review at ${formatClock(T0 + 5 * MIN)}`]);
    });

    test('the test alert lists no "also"', () => {
        const now = T0 - 25 * MIN;
        assert.deepEqual(view(now, [ONLINE], { test: testAlert(now) }).alert.also, []);
    });
});

describe('view: the indicator', () => {
    test('the next deadline: title and short countdown', () => {
        const v = view(T0 - 25 * MIN, [ONLINE]);
        assert.equal(v.indicator.text, 'Client sync · 25m');
    });

    test('the title is cut to 24 characters', () => {
        const long = judged({ title: 'Quarterly client planning review' });
        assert.equal(view(T0 - 2 * HOUR, [long]).indicator.text, `Quarterly client planni… · ${formatShort(2 * HOUR)}`);
    });

    test('nothing within 12 h gives the quiet icon', () => {
        const v = view(T0 - 13 * HOUR, [ONLINE]);
        assert.equal(v.indicator.text, null);
        assert.equal(v.indicator.highlighted, false);
    });

    test('highlighted while an alert is active but hidden', () => {
        const shownAt = T0 - 30 * MIN;
        const card = plan(shownAt, [ONLINE], E, TIMING, ENV).primary;
        const state = reduce(E, actionFor(card, 'headsUpShown'), shownAt);
        const v = view(T0 - 29 * MIN, [ONLINE], { state });
        assert.equal(v.alert, null);
        assert.equal(v.indicator.highlighted, true);
    });

    test('highlighted while a test alert runs', () => {
        const now = T0 - 5 * HOUR;
        assert.equal(view(now, [ONLINE], { test: testAlert(now) }).indicator.highlighted, true);
    });

    test('flashing only for a step-3 card', () => {
        assert.equal(view(T0 - 2 * MIN, [ONLINE]).indicator.flashing, true);
        assert.equal(view(T0 - 5 * MIN, [ONLINE]).indicator.flashing, false);
        assert.equal(view(T0 - 30_000, [ONLINE]).indicator.flashing, false);
    });

    test('the warning mark shows while stale, only', () => {
        const stale = { state: 'stale', since: T0 - HOUR, calendars: [] };
        assert.equal(view(T0 - 2 * HOUR, [ONLINE], { health: stale }).indicator.warning, true);
        assert.equal(view(T0 - 2 * HOUR, [ONLINE]).indicator.warning, false);
        assert.equal(view(T0 - 2 * HOUR, [ONLINE], { health: { state: 'waiting', since: null, calendars: [] } }).indicator.warning, false);
    });
});

describe('view: menu rows', () => {
    const NOW = Date.UTC(2026, 8, 28, 11, 0, 0);
    const at = (h, m = 0) => Date.UTC(2026, 8, 28, h, m, 0);
    const later = judged({ key: 'occ:a|1', title: 'Later today', start: at(13), end: at(13, 30), deadline: at(13) });
    const ended = judged({ key: 'occ:b|1', title: 'Ended', start: at(9), end: at(9, 30), deadline: at(9) });
    const tomorrow = judged({ key: 'occ:c|1', title: 'Tomorrow', start: Date.UTC(2026, 8, 29, 9), end: Date.UTC(2026, 8, 29, 10), deadline: Date.UTC(2026, 8, 29, 9) });
    const allDay = judged({ key: 'occ:d|1', title: 'Offsite', start: at(0), end: Date.UTC(2026, 8, 29, 0), allDay: true, deadline: null, verdict: 'ignore', reason: 'all day' });

    test('today only: later today and all-day are listed; ended and tomorrow are not', () => {
        const rows = view(NOW, [allDay, ended, later, tomorrow]).menu.meetings;
        assert.deepEqual(rows.map(r => r.key), ['occ:d|1', 'occ:a|1']);
    });

    test('labels: all day, or the start time, then the title', () => {
        const rows = view(NOW, [allDay, later]).menu.meetings;
        assert.equal(rows[0].label, 'All day  Offsite');
        assert.equal(rows[1].label, `${formatClock(at(13))}  Later today`);
    });

    test('judge order is kept', () => {
        const first = judged({ key: 'occ:z|1', title: 'Z', start: at(15), end: at(16), deadline: at(15) });
        const rows = view(NOW, [first, later]).menu.meetings;
        assert.deepEqual(rows.map(r => r.key), ['occ:z|1', 'occ:a|1']);
    });

    test('detail, reason and verdict fields', () => {
        const [must] = view(NOW, [later]).menu.meetings;
        assert.equal(must.detail, 'Must attend · online');
        assert.equal(must.reason, 'Why: x');
        assert.equal(must.isMust, true);
        assert.equal(must.overridden, false);
        const over = { ...later, verdict: 'ignore', verdictOverridden: true, mode: 'in-person', travelMinutes: 30, travelIsDefault: true, placeKey: 'hq', deadline: at(12, 30) };
        const [row] = view(NOW, [over]).menu.meetings;
        assert.equal(row.detail, 'Ignorable · in person · overridden');
        assert.equal(row.isMust, false);
        assert.equal(row.overridden, true);
    });

    test('the mode switch offers the other mode', () => {
        const [online] = view(NOW, [later]).menu.meetings;
        assert.equal(online.mode, 'online');
        assert.equal(online.otherMode, 'in-person');
        assert.equal(online.modeSwitchLabel, 'Switch to in person');
        const [inPerson] = view(NOW, [{ ...later, mode: 'in-person', travelMinutes: 30, placeKey: 'hq', deadline: at(12, 30) }]).menu.meetings;
        assert.equal(inPerson.otherMode, 'online');
        assert.equal(inPerson.modeSwitchLabel, 'Switch to online');
    });

    test('travel for in-person rows only, at any step', () => {
        const [online] = view(NOW, [later]).menu.meetings;
        assert.equal(online.travel, null);
        const [row] = view(NOW, [{ ...later, mode: 'in-person', travelMinutes: 20, travelIsDefault: false, placeKey: 'hq', deadline: at(12, 40) }]).menu.meetings;
        assert.deepEqual(row.travel, { placeKey: 'hq', minutes: 20, header: 'Travel time: 20 min', choices: TRAVEL_CHOICES_MIN });
        const [noPlace] = view(NOW, [{ ...later, mode: 'in-person', travelMinutes: 30, travelIsDefault: true, placeKey: null, deadline: at(12, 30) }]).menu.meetings;
        assert.deepEqual(noPlace.travel, { placeKey: null, minutes: 30, header: 'Travel time: 30 min (default)', choices: [] });
    });

    test('recurring is carried', () => {
        const [row] = view(NOW, [{ ...later, recurring: true }]).menu.meetings;
        assert.equal(row.recurring, true);
    });

    test('a judged meeting from judge() itself makes a row', () => {
        const j = judgeOne(event({ start: at(13), end: at(14), summary: 'From judge' }));
        const [row] = view(NOW, [j]).menu.meetings;
        assert.equal(row.label, `${formatClock(at(13))}  From judge`);
    });
});

describe('view: menu status (D-010, D-013, D-014)', () => {
    const NOW = T0;
    const SINCE = Date.UTC(2026, 8, 28, 10, 42, 0);
    const stale = calendars => ({ state: 'stale', since: SINCE, calendars });
    const status = (health, list = [ONLINE]) => view(NOW - 2 * HOUR, list, { health }).menu.status;
    const clock = formatClock(SINCE);

    test('waiting', () => {
        assert.equal(status({ state: 'waiting', since: null, calendars: [] }), 'Reading calendars…');
    });

    test('stale, generic', () => {
        assert.equal(status(stale([])), `Calendar not updating since ${clock}. Alerts may be missing.`);
    });

    test('stale, one calendar is named', () => {
        assert.equal(status(stale(['Work'])), `Work calendar not updating since ${clock}. Alerts may be missing.`);
        assert.ok(clock.includes('10:42'));
    });

    test('stale, two calendars', () => {
        assert.equal(status(stale(['Work', 'Personal'])),
            `Calendars not updating since ${clock}: Work, Personal. Alerts may be missing.`);
    });

    test('stale, five calendars: three named and the rest counted', () => {
        assert.equal(status(stale(['A', 'B', 'C', 'D', 'E'])),
            `Calendars not updating since ${clock}: A, B, C, and 2 more. Alerts may be missing.`);
    });

    test('stale names are cut to 30 characters', () => {
        const long = 'x'.repeat(40);
        assert.equal(status(stale([long, 'B'])),
            `Calendars not updating since ${clock}: ${'x'.repeat(29)}…, B. Alerts may be missing.`);
    });

    test('stale since yesterday uses the weekday form', () => {
        const since = SINCE - 24 * HOUR;
        const s = view(NOW, [ONLINE], { health: { state: 'stale', since, calendars: [] } }).menu.status;
        assert.equal(s, `Calendar not updating since ${formatSince(since, NOW)}. Alerts may be missing.`);
        assert.notEqual(formatSince(since, NOW), formatClock(since));
    });

    test('ok with no rows: no more meetings today', () => {
        assert.equal(status(OK, []), 'No more meetings today');
    });

    test('ok with rows: no status', () => {
        assert.equal(status(OK), null);
    });

    test('while stale, the rows are still listed', () => {
        const v = view(NOW - 2 * HOUR, [ONLINE], { health: stale(['Work']) });
        assert.deepEqual(v.menu.meetings.map(r => r.key), [ONLINE.key]);
    });

    test('while stale with no rows, never "no meetings"', () => {
        assert.match(status(stale([]), []), /not updating/);
    });
});

describe('view: menu signature', () => {
    test('changes when a verdict changes', () => {
        const now = T0 - 2 * HOUR;
        const a = view(now, [ONLINE]).menu.signature;
        const b = view(now, [{ ...ONLINE, verdict: 'ignore', verdictOverridden: true }]).menu.signature;
        assert.notEqual(a, b);
    });

    test('stays the same when only now moves by 1 s', () => {
        const now = T0 - 2 * HOUR;
        assert.equal(view(now, [ONLINE]).menu.signature, view(now + 1000, [ONLINE]).menu.signature);
    });

    test('changes when a travel time changes', () => {
        const now = LEAVE - 2 * HOUR;
        const a = view(now, [IN_PERSON]).menu.signature;
        const b = view(now, [{ ...IN_PERSON, travelMinutes: 45 }]).menu.signature;
        assert.notEqual(a, b);
    });
});
