// GJS check of shell/store.js against the real compiled schema, run by
// scripts/smoke.sh with GSETTINGS_BACKEND=memory before the headless shell.
// Prints PAYATTENTION-STORE PASS or PAYATTENTION-STORE FAIL <reason>.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { Store } from '../../extension/shell/store.js';
import { DEFAULT_SETTINGS } from '../../extension/core/defaults.js';
import { emptyAlertState, reduce, serializeAlertState } from '../../extension/core/alertState.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.payattention';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 28, 14, 0, 0);

/**
 * gnome-shell adds connectObject/disconnectObject to every GObject
 * (misc/signalTracker.js); plain gjs does not. A minimal stand-in, test only.
 */
function withSignalTracker(settings) {
    const ids = new Map();
    settings.connectObject = (signal, handler, owner) => {
        ids.set(owner, [...(ids.get(owner) ?? []), settings.connect(signal, handler)]);
    };
    settings.disconnectObject = owner => {
        for (const id of ids.get(owner) ?? [])
            settings.disconnect(id);
        ids.delete(owner);
    };
    return settings;
}

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

function check(condition, what) {
    if (!condition)
        throw new Error(what);
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function stateWith(key, start) {
    return reduce(emptyAlertState(), { type: 'ack', key, start }, NOW);
}

async function main() {
    const settings = withSignalTracker(new Gio.Settings({ schema_id: SCHEMA_ID }));
    const changes = [];
    let store = new Store(settings, () => changes.push('change'));

    check(sameJson(store.readSettings(), { ...DEFAULT_SETTINGS }), 'readSettings equals DEFAULT_SETTINGS');

    // Verdict overrides: add, overwrite, delete.
    store.setVerdictOverride('occ:a|1', 'must');
    check(store.readOverrides().verdict['occ:a|1'] === 'must', 'verdict override added');
    store.setVerdictOverride('occ:a|1', 'ignore');
    check(store.readOverrides().verdict['occ:a|1'] === 'ignore', 'verdict override overwritten');
    store.setVerdictOverride('occ:a|1', null);
    check(!('occ:a|1' in store.readOverrides().verdict), 'verdict override deleted');
    store.setModeOverride('series:b', 'in-person');
    check(store.readOverrides().mode['series:b'] === 'in-person', 'mode override added');
    store.setModeOverride('series:b', null);
    check(sameJson(store.readOverrides(), { verdict: {}, mode: {} }), 'overrides back to empty');

    store.setTravel('hq', 45);
    check(store.readTravel().hq === 45, 'travel round-trips');

    // Coalesced alert-state writes.
    store.readAlertState();
    let emissions = 0;
    const id = settings.connect('changed::alert-state', () => emissions++);
    store.writeAlertState(stateWith('occ:x|1', 1));
    store.writeAlertState(stateWith('occ:x|2', 2));
    store.writeAlertState(stateWith('occ:x|3', 3));
    await sleep(250);
    check(emissions === 0, `no write before the delay (saw ${emissions})`);
    await sleep(600);
    check(emissions === 1, `exactly one alert-state write (saw ${emissions})`);
    check(settings.get_string('alert-state') === serializeAlertState(stateWith('occ:x|3', 3)), 'the last state was written');

    // destroy() flushes a pending write synchronously.
    store.writeAlertState(stateWith('occ:y|4', 4));
    store.destroy();
    check(settings.get_string('alert-state') === serializeAlertState(stateWith('occ:y|4', 4)), 'destroy flushes');
    settings.disconnect(id);

    // A corrupt stored value gives the empty state.
    settings.set_string('alert-state', '{"v":1,"items":');
    store = new Store(settings, () => changes.push('change'));
    check(sameJson(store.readAlertState(), emptyAlertState()), 'corrupt alert-state reads as empty');

    // Health seeds: 0 is unknown; epoch ms fit the int64 key exactly.
    check(sameJson(store.readHealthSeeds(), { dataAt: null, providerAt: null }), 'seeds default to null');
    store.writeHealthClocks({ dataAt: 1790000000000, providerAt: 1789999000000 });
    const seeds = store.readHealthSeeds();
    check(seeds.dataAt === 1790000000000 && seeds.providerAt === 1789999000000, `seeds round-trip (got ${JSON.stringify(seeds)})`);

    // Pruning occurrence overrides.
    const old = `occ:old|${NOW - 8 * DAY}`;
    const recent = `occ:recent|${NOW - 6 * DAY}`;
    for (const key of [old, recent, 'series:s']) {
        store.setVerdictOverride(key, 'ignore');
        store.setModeOverride(key, 'online');
    }
    store.pruneOccurrenceOverrides(NOW);
    const o = store.readOverrides();
    for (const kind of ['verdict', 'mode']) {
        check(!(old in o[kind]), `${kind}: the 8-day-old occurrence is pruned`);
        check(recent in o[kind] && 'series:s' in o[kind], `${kind}: the recent occurrence and the series are kept`);
    }

    // onChange: never for internal keys, always for owner settings.
    await sleep(100);
    changes.length = 0;
    settings.set_string('alert-state', '');
    settings.set_int64('health-data-at', 5);
    settings.set_int64('health-provider-at', 6);
    await sleep(100);
    check(changes.length === 0, `no onChange for internal keys (saw ${changes.length})`);
    settings.set_boolean('sound-enabled', false);
    await sleep(100);
    check(changes.length === 1, `onChange for sound-enabled (saw ${changes.length})`);

    store.destroy();
    settings.set_boolean('sound-enabled', true);
    await sleep(100);
    check(changes.length === 1, 'no onChange after destroy');
}

const loop = new GLib.MainLoop(null, false);
main().then(
    () => print('PAYATTENTION-STORE PASS'),
    e => print(`PAYATTENTION-STORE FAIL ${e.message}`)
).finally(() => loop.quit());
loop.run();
