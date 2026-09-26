// Calendar freshness (D-010, D-013, D-014): the one definition of "stale".
// Pure. The feed records facts (when a snapshot was accepted, when each
// calendar was seen in sync); this module turns them into a verdict.

/** Data or a calendar older than this is stale (D-010). */
export const STALE_AFTER_MS = 15 * 60 * 1000;
/** No warning flashes while the first snapshot is on its way after enabling. */
export const STARTUP_GRACE_MS = 60 * 1000;

/** @typedef {import('../core/types.js').Snapshot} Snapshot */
/** @typedef {import('../core/types.js').SourceInfo} SourceInfo */
/** @typedef {{state: 'waiting'|'ok'|'stale', since: number|null, calendars: string[]}} Health */
/** @typedef {{dataAt: number|null, providerAt: number|null}} HealthSeeds */

/**
 * A snapshot is accepted when it lists no sources or at least one ok source.
 *
 * @param {Snapshot} snapshot
 * @returns {boolean}
 */
export function isAcceptedSnapshot(snapshot) {
    return snapshot.sources.length === 0 || snapshot.sources.some(s => s.ok);
}

/**
 * Whether a calendar is known to be talking to its provider right now.
 *
 * @param {SourceInfo} source
 * @returns {boolean}
 */
export function isInSync(source) {
    return source.ok && source.remote === true && source.connection === 'connected';
}

/**
 * A new map: prev plus uid → at for every source of snapshot that is in sync.
 * Never removes an entry. prev is not mutated.
 *
 * @param {ReadonlyMap<string, number>} prev
 * @param {Snapshot} snapshot
 * @param {number} at
 * @returns {Map<string, number>}
 */
export function recordSync(prev, snapshot, at) {
    const next = new Map(prev);
    for (const s of snapshot.sources) {
        if (isInSync(s))
            next.set(s.uid, at);
    }
    return next;
}

// Local calendars (remote:false) have no provider, so they never count.
function relevantSources(snapshot) {
    return snapshot ? snapshot.sources.filter(s => s.remote !== false) : [];
}

function clocks({ snapshot, acceptedAt, syncedAt, seeds, enabledAt }) {
    const dataClock = acceptedAt ?? seeds.dataAt ?? enabledAt;
    const sourceClock = s => syncedAt.get(s.uid) ?? seeds.providerAt ?? enabledAt;
    return { dataClock, sourceClock, relevant: relevantSources(snapshot) };
}

/**
 * Whether the calendar data can be trusted now, and if not, since when and
 * which calendars are to blame.
 *
 * @param {object} p
 * @param {Snapshot|null} p.snapshot last accepted snapshot, or null
 * @param {number|null} p.acceptedAt when it was accepted, or null
 * @param {ReadonlyMap<string, number>} p.syncedAt uid → last time seen in sync (this enable() only)
 * @param {HealthSeeds} p.seeds persisted at the last disable(); null = unknown
 * @param {number} p.enabledAt
 * @param {number} p.now
 * @returns {Health} calendars: display names of the calendars not updating; [] unless stale by provider only
 */
export function dataHealth(p) {
    const { acceptedAt, enabledAt, now } = p;
    if (acceptedAt === null && now - enabledAt < STARTUP_GRACE_MS)
        return { state: 'waiting', since: null, calendars: [] };

    const { dataClock, sourceClock, relevant } = clocks(p);
    const dataExpired = now - dataClock >= STALE_AFTER_MS;
    const staleSources = relevant.filter(s => now - sourceClock(s) >= STALE_AFTER_MS);

    // Without fresh data every calendar is affected, so the line stays generic.
    if (dataExpired)
        return { state: 'stale', since: Math.min(dataClock, ...staleSources.map(sourceClock)), calendars: [] };
    if (staleSources.length > 0) {
        const calendars = [...new Set(staleSources.map(s => s.name))];
        return { state: 'stale', since: Math.min(...staleSources.map(sourceClock)), calendars };
    }
    if (acceptedAt === null)
        return { state: 'waiting', since: null, calendars: [] };
    return { state: 'ok', since: null, calendars: [] };
}

/**
 * The clocks to persist at disable(), so the next enable() starts from them.
 *
 * @param {object} p same as dataHealth, without now
 * @param {Snapshot|null} p.snapshot
 * @param {number|null} p.acceptedAt
 * @param {ReadonlyMap<string, number>} p.syncedAt
 * @param {HealthSeeds} p.seeds
 * @param {number} p.enabledAt
 * @returns {{dataAt: number, providerAt: number}} 0 = unknown
 */
export function clocksToPersist(p) {
    const { dataClock, sourceClock, relevant } = clocks(p);
    let providerAt;
    if (p.snapshot === null)
        providerAt = p.seeds.providerAt ?? 0;
    else if (relevant.length === 0)
        providerAt = 0;
    else
        providerAt = Math.min(...relevant.map(sourceClock));
    return { dataAt: dataClock, providerAt };
}
