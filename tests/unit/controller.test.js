import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Time formatting depends on the zone; fix it before the modules are loaded.
process.env.TZ = 'UTC';
const { Controller } = await import('../../extension/shell/controller.js');
const { recordSync } = await import('../../extension/shell/health.js');
const { formatSince } = await import('../../extension/core/display.js');
const { DEFAULT_SETTINGS } = await import('../../extension/core/defaults.js');
const { emptyAlertState } = await import('../../extension/core/alertState.js');
const { occurrenceKey, seriesKey } = await import('../../extension/core/keys.js');
const { T0, MIN, HOUR, OWNER, SOURCE, att, event, snapshot } = await import('./support/builders.js');

const EN = T0 - 2 * HOUR;       // when the controller is built
const JOIN = 'https://meet.google.com/abc-defg-hij';
const WORK = { ...SOURCE, remote: true, connection: 'connected' };

/** A must-attend online meeting: important word, the owner organises, 2 other guests, a Meet link. */
function meeting(over = {}) {
    return event({
        uid: 'client-1', summary: 'Client review', location: 'HQ', conferenceUris: [JOIN],
        organizer: { email: OWNER, name: 'me' },
        attendees: [att(OWNER), att('alice@external.test'), att('bob@external.test')],
        ...over,
    });
}
const MEETING = meeting();
const KEY = occurrenceKey(MEETING);
const SNAP = snapshot([MEETING], [WORK]);

function makeStore(onChange, h) {
    const store = {
        onChange,
        settings: { ...DEFAULT_SETTINGS, ...h.settings },
        overrides: { verdict: {}, mode: {} },
        travel: {},
        seeds: h.seeds ?? { dataAt: null, providerAt: null },
        alertWrites: [],
        clockWrites: [],
        verdictCalls: [],
        modeCalls: [],
        travelCalls: [],
        prunes: [],
        readSettings: () => ({ ...store.settings }),
        readOverrides: () => ({ verdict: { ...store.overrides.verdict }, mode: { ...store.overrides.mode } }),
        readTravel: () => ({ ...store.travel }),
        readAlertState: () => emptyAlertState(),
        writeAlertState: state => store.alertWrites.push(state),
        readHealthSeeds: () => store.seeds,
        writeHealthClocks: clocks => {
            h.log.push('store.writeHealthClocks');
            store.clockWrites.push(clocks);
        },
        setVerdictOverride: (key, verdict) => {
            store.verdictCalls.push([key, verdict]);
            if (verdict === null)
                delete store.overrides.verdict[key];
            else
                store.overrides.verdict[key] = verdict;
        },
        setModeOverride: (key, mode) => {
            store.modeCalls.push([key, mode]);
            if (mode === null)
                delete store.overrides.mode[key];
            else
                store.overrides.mode[key] = mode;
        },
        setTravel: (placeKey, minutes) => {
            store.travelCalls.push([placeKey, minutes]);
            store.travel[placeKey] = minutes;
        },
        pruneOccurrenceOverrides: now => store.prunes.push(now),
        destroy: () => h.log.push('store.destroy'),
    };
    return store;
}

function makeFeed(onUpdate, h) {
    const feed = {
        snapshot: null,
        acceptedAt: null,
        syncedAt: new Map(),
        refreshes: [],
        refresh: reason => feed.refreshes.push(reason),
        destroy: () => h.log.push('feed.destroy'),
        /** A snapshot accepted now, the way CalendarFeed records it. */
        deliver: snap => {
            feed.snapshot = snap;
            feed.acceptedAt = h.now;
            feed.syncedAt = recordSync(feed.syncedAt, snap, h.now);
            onUpdate();
        },
    };
    return feed;
}

function makeUi(dispatch, h) {
    const ui = {
        dispatch,
        views: [],
        sounds: 0,
        releases: 0,
        throwOnRender: false,
        get last() {
            return ui.views.at(-1);
        },
        render: view => {
            if (ui.throwOnRender)
                throw new Error('render broke');
            ui.views.push(view);
        },
        playAlertSound: () => ui.sounds++,
        releaseTakeover: () => ui.releases++,
        destroy: () => h.log.push('ui.destroy'),
    };
    return ui;
}

/** A controller with fake parts. `h` holds the parts, the clock and helpers. */
function setup({ settings = {}, seeds = null } = {}) {
    const h = { now: EN, log: [], launches: [], settings, seeds, tickers: 0 };
    const deps = {
        createStore: onChange => (h.store = makeStore(onChange, h)),
        createEnvironment: onResume => (h.env = {
            active: true,
            onResume,
            isUserActive: () => h.env.active,
            destroy: () => h.log.push('environment.destroy'),
        }),
        createFeed: onUpdate => (h.feed = makeFeed(onUpdate, h)),
        createUi: dispatch => (h.ui = makeUi(dispatch, h)),
        createTicker: onTick => {
            h.tickers++;
            return (h.ticker = {
                fire: onTick,
                throwOnDestroy: false,
                destroy: () => {
                    h.log.push('ticker.destroy');
                    if (h.ticker.throwOnDestroy)
                        throw new Error('ticker broke');
                },
            });
        },
        launchUri: (uri, onDone) => h.launches.push({ uri, onDone }),
        now: () => h.now,
    };
    h.controller = new Controller(deps);
    /** Move the clock to t and tick; the view rendered. */
    h.at = t => {
        h.now = t;
        h.ticker.fire();
        return h.ui.last;
    };
    /** Move the clock to t, deliver a snapshot and tick. */
    h.deliverAt = (t, snap = SNAP) => {
        h.now = t;
        h.feed.deliver(snap);
        h.ticker.fire();
        return h.ui.last;
    };
    h.dispatch = action => {
        h.ui.dispatch(action);
        return h.ui.last;
    };
    return h;
}

// console.error is expected in some tests; count it and keep the output clean.
let errors;
let realError;
beforeEach(() => {
    errors = [];
    realError = console.error;
    console.error = (...args) => errors.push(args);
});
afterEach(() => {
    console.error = realError;
});

const lastItem = (store, key) => store.alertWrites.at(-1)?.items[key];

describe('controller: construction and the ladder', () => {
    test('1. renders once while reading calendars, with no alert, and creates the ticker', () => {
        const h = setup();
        assert.equal(h.ui.views.length, 1);
        assert.equal(h.ui.last.menu.status, 'Reading calendars…');
        assert.equal(h.ui.last.alert, null);
        assert.equal(h.tickers, 1);
    });

    test('construction prunes the alert state and the overrides', () => {
        const h = setup();
        assert.equal(h.store.alertWrites.length, 1);
        assert.deepEqual(h.store.prunes, [EN]);
    });

    test('2. 25 min before the start: a step-1 card and the countdown in the top bar', () => {
        const h = setup();
        const v = h.deliverAt(T0 - 25 * MIN);
        assert.equal(v.alert.step, 1);
        assert.equal(v.alert.presentation, 'card');
        assert.ok(v.indicator.text.startsWith('Client review'), v.indicator.text);
    });

    test('3. 30 s before the start: the takeover', () => {
        const h = setup();
        const v = h.deliverAt(T0 - 30_000);
        assert.equal(v.alert.presentation, 'takeover');
        assert.equal(v.alert.step, 4);
    });

    test('4. ack clears the alert and records it', () => {
        const h = setup();
        h.deliverAt(T0 - 25 * MIN);
        const v = h.dispatch({ type: 'ack', key: KEY });
        assert.equal(v.alert, null);
        assert.equal(lastItem(h.store, KEY).done, 'ack');
    });

    test('an action on an alert that has gone does nothing', () => {
        const h = setup();
        h.deliverAt(T0 - HOUR);   // nothing on screen yet
        const writes = h.store.alertWrites.length;
        h.dispatch({ type: 'ack', key: KEY });
        assert.equal(h.store.alertWrites.length, writes);
    });

    test('5. snooze at step 4 hides for the takeover snooze, then the alert is back', () => {
        const h = setup();
        h.deliverAt(T0 - 30_000);
        assert.equal(h.dispatch({ type: 'snooze', key: KEY }).alert, null);
        assert.equal(h.at(T0 - 30_000 + 59_999).alert, null);
        assert.equal(h.at(T0 - 30_000 + 61_000).alert.step, 4);
    });

    test('5. snooze at step 2 ends at the step-3 time, not after 2 min', () => {
        const h = setup();
        h.deliverAt(T0 - 4 * MIN);
        assert.equal(h.ui.last.alert.step, 2);
        h.dispatch({ type: 'snooze', key: KEY });
        assert.equal(h.at(T0 - 3 * MIN - 1).alert, null);
        assert.equal(h.at(T0 - 3 * MIN).alert.step, 3);
    });
});

describe('controller: join', () => {
    test('6. opens the link and acknowledges only once it opened', () => {
        const h = setup();
        h.deliverAt(T0 - 25 * MIN);
        h.dispatch({ type: 'join', key: KEY });
        assert.equal(h.launches.length, 1);
        assert.equal(h.launches[0].uri, JOIN);
        assert.equal(lastItem(h.store, KEY)?.done ?? null, null);

        h.launches[0].onDone(false);
        assert.equal(h.at(T0 - 25 * MIN + 1000).alert.key, KEY);
        assert.equal(lastItem(h.store, KEY)?.done ?? null, null);

        h.launches[0].onDone(true);
        assert.equal(lastItem(h.store, KEY).done, 'ack');
        assert.equal(h.ui.last.alert, null);
    });

    test('6. a late success still acknowledges the meeting that was joined', () => {
        const h = setup();
        h.deliverAt(T0 - 25 * MIN);
        h.dispatch({ type: 'join', key: KEY });
        h.dispatch({ type: 'setVerdict', key: KEY, verdict: 'ignore', scope: 'occ' });
        assert.equal(h.ui.last.alert, null);
        h.launches[0].onDone(true);
        assert.equal(lastItem(h.store, KEY).done, 'ack');
    });

    test('no link: join does nothing', () => {
        const h = setup();
        const noLink = meeting({ conferenceUris: [], location: '' });
        h.deliverAt(T0 - 25 * MIN, snapshot([noLink], [WORK]));
        h.dispatch({ type: 'join', key: occurrenceKey(noLink) });
        assert.equal(h.launches.length, 0);
    });
});

describe('controller: overrides', () => {
    test('7. setVerdict writes the occurrence key, or the series key, and passes null through', () => {
        const h = setup();
        h.deliverAt(T0 - 2 * HOUR);
        h.dispatch({ type: 'setVerdict', key: KEY, verdict: 'must', scope: 'series' });
        h.dispatch({ type: 'setVerdict', key: KEY, verdict: 'ignore', scope: 'occ' });
        h.dispatch({ type: 'setVerdict', key: KEY, verdict: null, scope: 'occ' });
        assert.deepEqual(h.store.verdictCalls, [[seriesKey(MEETING), 'must'], [KEY, 'ignore'], [KEY, null]]);
    });

    test('7. the next render shows the overridden verdict', () => {
        const h = setup();
        h.deliverAt(T0 - 2 * HOUR);
        const v = h.dispatch({ type: 'setVerdict', key: KEY, verdict: 'ignore', scope: 'occ' });
        assert.equal(v.menu.meetings[0].isMust, false);
        assert.equal(v.menu.meetings[0].overridden, true);
    });

    describe('a whole-series verdict also covers this occurrence (PRD §3)', () => {
        const SERIES = meeting({ uid: 'weekly-1', recurring: true, recurrenceId: T0 });
        const SKEY = occurrenceKey(SERIES);
        const SERIES_SNAP = snapshot([SERIES], [WORK]);

        test('occurrence must + "Not important: whole series" at the takeover: ignorable, takeover gone', () => {
            const h = setup();
            h.deliverAt(T0 - 2 * HOUR, SERIES_SNAP);
            h.dispatch({ type: 'setVerdict', key: SKEY, verdict: 'must', scope: 'occ' });
            assert.equal(h.at(T0 - 30_000).alert.presentation, 'takeover');

            const v = h.dispatch({ type: 'setVerdict', key: SKEY, verdict: 'ignore', scope: 'series' });
            assert.equal(v.alert, null);
            assert.equal(v.menu.meetings[0].isMust, false);
            assert.equal(h.store.overrides.verdict[SKEY], undefined);
            assert.equal(h.store.overrides.verdict[seriesKey(SERIES)], 'ignore');
        });

        test('occurrence ignore + "Must attend: whole series": must-attend again', () => {
            const h = setup();
            h.deliverAt(T0 - 2 * HOUR, SERIES_SNAP);
            h.dispatch({ type: 'setVerdict', key: SKEY, verdict: 'ignore', scope: 'occ' });
            const v = h.dispatch({ type: 'setVerdict', key: SKEY, verdict: 'must', scope: 'series' });
            assert.equal(v.menu.meetings[0].isMust, true);
            assert.equal(h.store.overrides.verdict[SKEY], undefined);
            assert.equal(h.store.overrides.verdict[seriesKey(SERIES)], 'must');
        });

        test('clearing the series verdict leaves the occurrence override alone', () => {
            const h = setup();
            h.deliverAt(T0 - 2 * HOUR, SERIES_SNAP);
            h.dispatch({ type: 'setVerdict', key: SKEY, verdict: 'ignore', scope: 'occ' });
            h.dispatch({ type: 'setVerdict', key: SKEY, verdict: null, scope: 'series' });
            assert.equal(h.store.overrides.verdict[SKEY], 'ignore');
        });
    });

    test('setVerdict on an unknown key does nothing', () => {
        const h = setup();
        h.deliverAt(T0 - 2 * HOUR);
        h.dispatch({ type: 'setVerdict', key: 'occ:nope|1', verdict: 'ignore', scope: 'series' });
        assert.deepEqual(h.store.verdictCalls, []);
    });

    test('8. setMode and setTravel reach the store and the next render', () => {
        const h = setup();
        h.deliverAt(T0 - 2 * HOUR);
        let v = h.dispatch({ type: 'setMode', key: KEY, mode: 'in-person' });
        assert.deepEqual(h.store.modeCalls, [[KEY, 'in-person']]);
        assert.equal(v.menu.meetings[0].mode, 'in-person');
        assert.equal(v.menu.meetings[0].travel.minutes, 30);

        v = h.dispatch({ type: 'setTravel', placeKey: 'hq', minutes: 45 });
        assert.deepEqual(h.store.travelCalls, [['hq', 45]]);
        assert.equal(v.menu.meetings[0].travel.minutes, 45);
    });

    test('18. a settings change from outside is picked up on the next tick', () => {
        const h = setup();
        h.deliverAt(T0 - 2 * HOUR);
        h.store.overrides.verdict[KEY] = 'ignore';
        h.store.onChange();
        const v = h.at(T0 - 2 * HOUR + 1000);
        assert.equal(v.menu.meetings[0].isMust, false);
    });
});

describe('controller: sound', () => {
    test('9. plays once when step 3 first shows, and once more at step 4', () => {
        const h = setup();
        h.deliverAt(T0 - 4 * MIN);
        assert.equal(h.ui.sounds, 0);
        h.at(T0 - 3 * MIN);
        assert.equal(h.ui.sounds, 1);
        h.at(T0 - 3 * MIN + 1000);
        assert.equal(h.ui.sounds, 1);
        h.at(T0 - MIN);
        assert.equal(h.ui.sounds, 2);
    });

    test('9. never when sound is off', () => {
        const h = setup({ settings: { soundEnabled: false } });
        h.deliverAt(T0 - 3 * MIN);
        h.at(T0 - MIN);
        assert.equal(h.ui.sounds, 0);
    });
});

describe('controller: fail open', () => {
    test('10. a render failure releases the takeover, logs once per distinct error, and recovers', () => {
        const h = setup();
        h.feed.deliver(SNAP);
        h.ui.throwOnRender = true;
        h.at(T0 - 30_000);
        h.at(T0 - 29_000);
        assert.equal(h.ui.releases, 2);
        assert.equal(errors.filter(e => e[0] === 'payattention: tick-failed').length, 1);

        h.ui.throwOnRender = false;
        const before = h.ui.views.length;
        h.at(T0 - 28_000);
        assert.equal(h.ui.views.length, before + 1);

        h.ui.throwOnRender = true;
        h.at(T0 - 27_000);
        assert.equal(errors.filter(e => e[0] === 'payattention: tick-failed').length, 2);
    });
});

describe('controller: test alert', () => {
    test('11. runs the fast ladder, in memory only', () => {
        const h = setup();
        const N = h.now;
        h.controller.runTestAlert();
        assert.equal(h.ui.last.alert.isTest, true);
        assert.equal(h.ui.last.alert.step, 1);
        assert.equal(h.at(N + 10_000).alert.step, 2);
        assert.equal(h.at(N + 20_000).alert.step, 3);
        const v = h.at(N + 25_000);
        assert.equal(v.alert.step, 4);
        assert.equal(v.alert.presentation, 'takeover');

        const writes = h.store.alertWrites.length;
        assert.equal(h.dispatch({ type: 'ack', key: 'test:' + N }).alert, null);
        assert.equal(h.store.alertWrites.length, writes);
        assert.equal(h.at(N + 26_000).alert, null);
    });

    test('11. the menu item starts it', () => {
        const h = setup();
        assert.equal(h.dispatch({ type: 'runTestAlert' }).alert.isTest, true);
    });

    test('11. "Not important" on the test ends it and writes nothing', () => {
        const h = setup();
        const N = h.now;
        h.controller.runTestAlert();
        const v = h.dispatch({ type: 'setVerdict', key: 'test:' + N, verdict: 'ignore', scope: 'occ' });
        assert.equal(v.alert, null);
        assert.deepEqual(h.store.verdictCalls, []);
    });

    test('the test ends by itself after its cutoff', () => {
        const h = setup();
        const N = h.now;
        h.controller.runTestAlert();
        assert.equal(h.at(N + 90_000).alert, null);
        assert.equal(h.ui.last.indicator.highlighted, false);
    });
});

describe('controller: heads-up and resume', () => {
    test('12. a heads-up seen while active is recorded', () => {
        const h = setup();
        h.deliverAt(T0 - 30 * MIN);
        assert.equal(lastItem(h.store, KEY).headsUpShownAt, T0 - 30 * MIN);
    });

    test('12. a heads-up while away is not recorded', () => {
        const h = setup();
        h.env.active = false;
        h.deliverAt(T0 - 30 * MIN);
        assert.equal(lastItem(h.store, KEY), undefined);
    });

    test('13. resume asks the feed to refresh', () => {
        const h = setup();
        h.env.onResume();
        assert.deepEqual(h.feed.refreshes, ['resume']);
    });
});

describe('controller: calendar health', () => {
    test('14. no data for 15 min: the warning and the generic line', () => {
        const h = setup();
        const v = h.at(EN + 15 * MIN);
        assert.equal(v.indicator.warning, true);
        assert.ok(v.menu.status.startsWith('Calendar not updating since'), v.menu.status);
    });

    test('15. one calendar not syncing while snapshots are fresh is named, and alerts go on', () => {
        const h = setup();
        const personal = { ...SOURCE, uid: 'src-2', name: 'Personal', remote: true, connection: 'offline' };
        const m = meeting({ start: EN + 20 * MIN, end: EN + 50 * MIN });
        const snap = snapshot([m], [WORK, personal]);
        for (let t = EN; t <= EN + 15 * MIN; t += 5 * MIN)
            h.deliverAt(t, snap);
        const now = EN + 15 * MIN;
        const v = h.ui.last;
        assert.equal(v.indicator.warning, true);
        assert.equal(v.menu.status, `Personal calendar not updating since ${formatSince(EN, now)}. Alerts may be missing.`);
        assert.deepEqual(v.menu.meetings.map(r => r.key), [occurrenceKey(m)]);
        assert.ok(v.alert.step >= 1);
    });

    test('16. seeds from the last run: no flash during the grace, stale after it', () => {
        const old = EN - 20 * MIN;
        const h = setup({ seeds: { dataAt: old, providerAt: old } });
        let v = h.at(EN + 59_000);
        assert.equal(v.indicator.warning, false);
        assert.equal(v.menu.status, 'Reading calendars…');
        v = h.at(EN + 60_000);
        assert.equal(v.indicator.warning, true);
    });
});

describe('controller: destroy', () => {
    test('17. persists the clocks before the store is destroyed', () => {
        const h = setup();
        const X = EN + 5 * MIN;
        h.deliverAt(X);
        h.controller.destroy();
        assert.deepEqual(h.store.clockWrites, [{ dataAt: X, providerAt: X }]);
        assert.ok(h.log.indexOf('store.writeHealthClocks') < h.log.indexOf('store.destroy'));
    });

    test('17. with no snapshot, the seeds (or enabledAt) are carried', () => {
        let h = setup();
        h.controller.destroy();
        assert.deepEqual(h.store.clockWrites, [{ dataAt: EN, providerAt: 0 }]);

        h = setup({ seeds: { dataAt: EN - HOUR, providerAt: EN - 2 * HOUR } });
        h.controller.destroy();
        assert.deepEqual(h.store.clockWrites, [{ dataAt: EN - HOUR, providerAt: EN - 2 * HOUR }]);
    });

    test('19. every part is destroyed in order, even when one throws', () => {
        const h = setup();
        h.ticker.throwOnDestroy = true;
        h.controller.destroy();
        assert.deepEqual(h.log, [
            'ticker.destroy', 'ui.destroy', 'feed.destroy', 'environment.destroy',
            'store.writeHealthClocks', 'store.destroy',
        ]);
        assert.ok(errors.some(e => e[0] === 'payattention: destroy-failed ticker'));
    });

    test('19. a second destroy does nothing', () => {
        const h = setup();
        h.controller.destroy();
        const n = h.log.length;
        h.controller.destroy();
        assert.equal(h.log.length, n);
    });

    test('19. a join that finishes after destroy does nothing', () => {
        const h = setup();
        h.deliverAt(T0 - 25 * MIN);
        h.dispatch({ type: 'join', key: KEY });
        const store = h.store;
        const writes = store.alertWrites.length;
        const views = h.ui.views.length;
        h.controller.destroy();
        h.launches[0].onDone(true);
        assert.equal(store.alertWrites.length, writes);
        assert.equal(h.ui.views.length, views);
    });

    test('actions after destroy are ignored', () => {
        const h = setup();
        h.deliverAt(T0 - 25 * MIN);
        h.controller.destroy();
        const views = h.ui.views.length;
        h.ui.dispatch({ type: 'ack', key: KEY });
        assert.equal(h.ui.views.length, views);
    });

    test('20. a part failing to build destroys the parts already built and rethrows', () => {
        const h = { log: [] };
        assert.throws(() => setupInto(h), /no panel/);
        assert.deepEqual(h.log, ['feed.destroy', 'environment.destroy', 'store.destroy']);
    });
});

/** setup() with createUi throwing, recording into h.log. */
function setupInto(h) {
    const inner = { now: EN, log: h.log, settings: {}, seeds: null };
    return new Controller({
        createStore: onChange => makeStore(onChange, inner),
        createEnvironment: onResume => ({ onResume, isUserActive: () => true, destroy: () => h.log.push('environment.destroy') }),
        createFeed: onUpdate => makeFeed(onUpdate, inner),
        createUi: () => {
            throw new Error('no panel');
        },
        createTicker: () => ({ destroy: () => h.log.push('ticker.destroy') }),
        launchUri: () => {},
        now: () => EN,
    });
}
