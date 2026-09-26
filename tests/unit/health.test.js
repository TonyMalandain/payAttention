import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    STALE_AFTER_MS, STARTUP_GRACE_MS, isAcceptedSnapshot, isInSync, recordSync, dataHealth, clocksToPersist,
} from '../../extension/shell/health.js';
import { T0, MIN, SOURCE, snapshot } from './support/builders.js';

const EN = T0;               // enabledAt
const NO_SEEDS = { dataAt: null, providerAt: null };
const src = over => ({ ...SOURCE, remote: true, connection: 'connected', ...over });
/** A source from before D-013: no remote or connection field at all. */
function withoutSyncFields(source) {
    const copy = { ...source };
    delete copy.remote;
    delete copy.connection;
    return copy;
}
const WORK = src({ uid: 'work', name: 'Work' });
const PERSONAL = src({ uid: 'personal', name: 'Personal', connection: 'offline' });

/** Health after snapshots of `sources` delivered every 5 min from `EN`, up to and including `until`. */
function every5min(sources, until, seeds = NO_SEEDS) {
    let syncedAt = new Map();
    let acceptedAt = null;
    const snap = snapshot([], sources);
    for (let t = EN; t <= until; t += 5 * MIN) {
        acceptedAt = t;
        syncedAt = recordSync(syncedAt, snap, t);
    }
    return { snapshot: snap, acceptedAt, syncedAt, seeds, enabledAt: EN };
}

describe('health: constants', () => {
    test('15 min stale, 60 s grace', () => {
        assert.equal(STALE_AFTER_MS, 15 * MIN);
        assert.equal(STARTUP_GRACE_MS, 60_000);
    });
});

describe('health: accepted snapshots', () => {
    test('no sources is accepted', () => {
        assert.equal(isAcceptedSnapshot(snapshot([], [])), true);
    });

    test('one ok and one failing is accepted', () => {
        assert.equal(isAcceptedSnapshot(snapshot([], [src({ uid: 'a' }), src({ uid: 'b', ok: false, error: 'x' })])), true);
    });

    test('all failing is not accepted', () => {
        assert.equal(isAcceptedSnapshot(snapshot([], [src({ uid: 'a', ok: false }), src({ uid: 'b', ok: false })])), false);
    });
});

describe('health: isInSync', () => {
    test('true only for an ok remote connected source', () => {
        assert.equal(isInSync(src({})), true);
    });

    for (const connection of ['connecting', 'offline', 'unknown', null]) {
        test(`connection ${connection} is not in sync`, () => {
            assert.equal(isInSync(src({ connection })), false);
        });
    }

    test('a failed source, a local source and an unknown remote are not in sync', () => {
        assert.equal(isInSync(src({ ok: false })), false);
        assert.equal(isInSync(src({ remote: false })), false);
        assert.equal(isInSync(src({ remote: null })), false);
        assert.equal(isInSync(withoutSyncFields(src({}))), false);
    });
});

describe('health: recordSync', () => {
    test('adds in-sync uids only, keeps old entries, and does not mutate its input', () => {
        const prev = new Map([['old', 5]]);
        const next = recordSync(prev, snapshot([], [WORK, PERSONAL]), 100);
        assert.deepEqual([...next], [['old', 5], ['work', 100]]);
        assert.deepEqual([...prev], [['old', 5]]);
        assert.notEqual(next, prev);
    });

    test('a later sync moves the time forward', () => {
        const next = recordSync(new Map([['work', 5]]), snapshot([], [WORK]), 100);
        assert.equal(next.get('work'), 100);
    });
});

describe('health: dataHealth', () => {
    const base = { snapshot: null, acceptedAt: null, syncedAt: new Map(), enabledAt: EN };

    test('grace: no snapshot and old seeds is waiting for 59 s', () => {
        const h = dataHealth({ ...base, seeds: { dataAt: EN - 20 * MIN, providerAt: EN - 20 * MIN }, now: EN + 59_000 });
        assert.deepEqual(h, { state: 'waiting', since: null, calendars: [] });
    });

    test('grace: old seeds make it stale, generic, at 60 s, since the seeded data time', () => {
        const h = dataHealth({ ...base, seeds: { dataAt: EN - 20 * MIN, providerAt: EN - 20 * MIN }, now: EN + 60_000 });
        assert.deepEqual(h, { state: 'stale', since: EN - 20 * MIN, calendars: [] });
    });

    test('no seeds: waiting at 14 min, stale at 15 min since enabledAt', () => {
        assert.equal(dataHealth({ ...base, seeds: NO_SEEDS, now: EN + 14 * MIN }).state, 'waiting');
        assert.deepEqual(dataHealth({ ...base, seeds: NO_SEEDS, now: EN + 15 * MIN }),
            { state: 'stale', since: EN, calendars: [] });
    });

    test('provider stale while snapshots are fresh names the calendar (D-013, D-014)', () => {
        const now = EN + 15 * MIN;
        const h = dataHealth({ ...every5min([WORK, PERSONAL], now), now });
        assert.deepEqual(h, { state: 'stale', since: EN, calendars: ['Personal'] });
    });

    test('provider not yet 15 min old is ok', () => {
        const now = EN + 14 * MIN;
        assert.equal(dataHealth({ ...every5min([WORK, PERSONAL], now), now }).state, 'ok');
    });

    test('a local source that is never in sync never makes it stale', () => {
        const local = src({ uid: 'local', name: 'Personal', remote: false, connection: null });
        const now = EN + 60 * MIN;
        assert.deepEqual(dataHealth({ ...every5min([WORK, local], now), now }), { state: 'ok', since: null, calendars: [] });
    });

    test('a failed source (remote null) makes it stale after 15 min and is named', () => {
        const failed = src({ uid: 'bad', name: 'Team', ok: false, error: 'x', remote: null, connection: null });
        const now = EN + 15 * MIN;
        assert.deepEqual(dataHealth({ ...every5min([WORK, failed], now), now }),
            { state: 'stale', since: EN, calendars: ['Team'] });
    });

    test('an absent remote counts like null', () => {
        const bare = withoutSyncFields(src({ uid: 'bare', name: 'Old' }));
        const now = EN + 15 * MIN;
        assert.deepEqual(dataHealth({ ...every5min([WORK, bare], now), now }),
            { state: 'stale', since: EN, calendars: ['Old'] });
    });

    test('since is the older expired clock, and the line stays generic when data expired', () => {
        // Data accepted at EN + 5 min, the provider seeded 30 min before enabling.
        const snap = snapshot([], [PERSONAL]);
        const now = EN + 25 * MIN;
        const h = dataHealth({
            snapshot: snap, acceptedAt: EN + 5 * MIN, syncedAt: new Map(),
            seeds: { dataAt: null, providerAt: EN - 30 * MIN }, enabledAt: EN, now,
        });
        assert.deepEqual(h, { state: 'stale', since: EN - 30 * MIN, calendars: [] });
    });

    test('recovery: fresh data and every source in sync is ok', () => {
        const now = EN + 40 * MIN;
        const seeds = { dataAt: EN - 60 * MIN, providerAt: EN - 60 * MIN };
        assert.deepEqual(dataHealth({ ...every5min([WORK], now, seeds), now }), { state: 'ok', since: null, calendars: [] });
    });

    test('two stale sources with the same name are listed once', () => {
        const a = src({ uid: 'a', name: 'Shared', connection: 'offline' });
        const b = src({ uid: 'b', name: 'Shared', connection: 'offline' });
        const now = EN + 15 * MIN;
        assert.deepEqual(dataHealth({ ...every5min([WORK, a, b], now), now }).calendars, ['Shared']);
    });

    test('no snapshot yet after the grace, but not expired, is waiting', () => {
        assert.equal(dataHealth({ ...base, seeds: NO_SEEDS, now: EN + 2 * MIN }).state, 'waiting');
    });
});

describe('health: clocksToPersist', () => {
    test('a snapshot with relevant sources persists the data and provider clocks', () => {
        const now = EN + 10 * MIN;
        const { snapshot: snap, acceptedAt, syncedAt, enabledAt } = every5min([WORK, PERSONAL], now);
        assert.deepEqual(clocksToPersist({ snapshot: snap, acceptedAt, syncedAt, seeds: NO_SEEDS, enabledAt }),
            { dataAt: EN + 10 * MIN, providerAt: EN });
    });

    test('a snapshot with only local sources persists providerAt 0', () => {
        const local = src({ remote: false, connection: null });
        const now = EN + 10 * MIN;
        const p = every5min([local], now);
        assert.deepEqual(clocksToPersist(p), { dataAt: EN + 10 * MIN, providerAt: 0 });
    });

    test('no snapshot carries the seeds, or enabledAt and 0', () => {
        const base = { snapshot: null, acceptedAt: null, syncedAt: new Map(), enabledAt: EN };
        assert.deepEqual(clocksToPersist({ ...base, seeds: { dataAt: EN - MIN, providerAt: EN - 2 * MIN } }),
            { dataAt: EN - MIN, providerAt: EN - 2 * MIN });
        assert.deepEqual(clocksToPersist({ ...base, seeds: NO_SEEDS }), { dataAt: EN, providerAt: 0 });
    });
});
