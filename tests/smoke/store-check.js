// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// GJS check of shell/store.js against the real compiled schema, run by
// scripts/smoke.sh with GSETTINGS_BACKEND=memory before the headless shell.
// Prints PAYATTENTION-STORE PASS or PAYATTENTION-STORE FAIL <reason>.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { StoreReader, StoreWriter } from '../../extension/shell/store.js';
import { DEFAULT_SETTINGS } from '../../extension/core/defaults.js';
import { emptyAlertState, reduce, serializeAlertState } from '../../extension/core/alertState.js';
import { emptyAiAnswers, recordAiAnswer, serializeAiAnswers } from '../../extension/core/aiAnswers.js';

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

function answersWith(key) {
    return recordAiAnswer(emptyAiAnswers(), key, { fp: 'abc', verdict: 'must', reason: 'r' }, NOW);
}

async function main() {
    const settings = withSignalTracker(new Gio.Settings({ schema_id: SCHEMA_ID }));
    const changes = [];
    let reader = new StoreReader(settings, () => changes.push('change'));
    let writer = new StoreWriter(settings);

    check(sameJson(reader.readSettings(), { ...DEFAULT_SETTINGS }), 'readSettings equals DEFAULT_SETTINGS');

    // Verdict overrides: add, overwrite, delete.
    writer.setVerdictOverride('occ:a|1', 'must');
    check(reader.readOverrides().verdict['occ:a|1'] === 'must', 'verdict override added');
    writer.setVerdictOverride('occ:a|1', 'ignore');
    check(reader.readOverrides().verdict['occ:a|1'] === 'ignore', 'verdict override overwritten');
    writer.setVerdictOverride('occ:a|1', null);
    check(!('occ:a|1' in reader.readOverrides().verdict), 'verdict override deleted');
    writer.setModeOverride('series:b', 'in-person');
    check(reader.readOverrides().mode['series:b'] === 'in-person', 'mode override added');
    writer.setModeOverride('series:b', null);
    check(sameJson(reader.readOverrides(), { verdict: {}, mode: {} }), 'overrides back to empty');

    writer.setTravel('hq', 45);
    check(reader.readTravel().hq === 45, 'travel round-trips');

    // Coalesced alert-state writes.
    writer.readAlertState();
    let emissions = 0;
    const id = settings.connect('changed::alert-state', () => emissions++);
    writer.writeAlertState(stateWith('occ:x|1', 1));
    writer.writeAlertState(stateWith('occ:x|2', 2));
    writer.writeAlertState(stateWith('occ:x|3', 3));
    await sleep(250);
    check(emissions === 0, `no write before the delay (saw ${emissions})`);
    await sleep(600);
    check(emissions === 1, `exactly one alert-state write (saw ${emissions})`);
    check(settings.get_string('alert-state') === serializeAlertState(stateWith('occ:x|3', 3)), 'the last state was written');

    // destroy() flushes a pending write synchronously.
    writer.writeAlertState(stateWith('occ:y|4', 4));
    writer.destroy();
    check(settings.get_string('alert-state') === serializeAlertState(stateWith('occ:y|4', 4)), 'destroy flushes');
    settings.disconnect(id);

    // Coalesced ai-verdicts writes, exactly like alert state.
    reader.destroy();
    reader = new StoreReader(settings, () => changes.push('change'));
    writer = new StoreWriter(settings);
    check(sameJson(reader.readAiAnswers(), emptyAiAnswers()), 'readAiAnswers of the default is empty');
    let aiEmissions = 0;
    const aiId = settings.connect('changed::ai-verdicts', () => aiEmissions++);
    writer.writeAiAnswers(answersWith(`occ:x|${NOW + 1}`));
    writer.writeAiAnswers(answersWith(`occ:x|${NOW + 2}`));
    writer.writeAiAnswers(answersWith(`occ:x|${NOW + 3}`));
    await sleep(250);
    check(aiEmissions === 0, `no ai-verdicts write before the delay (saw ${aiEmissions})`);
    await sleep(600);
    check(aiEmissions === 1, `exactly one ai-verdicts write (saw ${aiEmissions})`);
    check(settings.get_string('ai-verdicts') === serializeAiAnswers(answersWith(`occ:x|${NOW + 3}`)), 'the last answers were written');
    writer.writeAiAnswers(answersWith(`occ:y|${NOW + 4}`));
    writer.destroy();
    check(settings.get_string('ai-verdicts') === serializeAiAnswers(answersWith(`occ:y|${NOW + 4}`)), 'destroy flushes ai-verdicts');
    settings.disconnect(aiId);

    // A corrupt stored value gives the empty state.
    settings.set_string('alert-state', '{"v":1,"items":');
    settings.set_string('ai-verdicts', '{"v":1,"items":');
    reader.destroy();
    reader = new StoreReader(settings, () => changes.push('change'));
    writer = new StoreWriter(settings);
    check(sameJson(writer.readAlertState(), emptyAlertState()), 'corrupt alert-state reads as empty');
    check(sameJson(reader.readAiAnswers(), emptyAiAnswers()), 'corrupt ai-verdicts reads as empty');

    // Health seeds: 0 is unknown; epoch ms fit the int64 key exactly.
    check(sameJson(writer.readHealthSeeds(), { dataAt: null, providerAt: null }), 'seeds default to null');
    writer.writeHealthClocks({ dataAt: 1790000000000, providerAt: 1789999000000 });
    const seeds = writer.readHealthSeeds();
    check(seeds.dataAt === 1790000000000 && seeds.providerAt === 1789999000000, `seeds round-trip (got ${JSON.stringify(seeds)})`);

    // Pruning occurrence overrides.
    const old = `occ:old|${NOW - 8 * DAY}`;
    const recent = `occ:recent|${NOW - 6 * DAY}`;
    for (const key of [old, recent, 'series:s']) {
        writer.setVerdictOverride(key, 'ignore');
        writer.setModeOverride(key, 'online');
    }
    writer.pruneOccurrenceOverrides(NOW);
    const o = reader.readOverrides();
    for (const kind of ['verdict', 'mode']) {
        check(!(old in o[kind]), `${kind}: the 8-day-old occurrence is pruned`);
        check(recent in o[kind] && 'series:s' in o[kind], `${kind}: the recent occurrence and the series are kept`);
    }

    // onChange: never for internal keys, always for owner settings.
    await sleep(100);
    changes.length = 0;
    settings.set_string('alert-state', '');
    settings.set_string('ai-verdicts', '');
    settings.set_int64('health-data-at', 5);
    settings.set_int64('health-provider-at', 6);
    await sleep(100);
    check(changes.length === 0, `no onChange for internal keys (saw ${changes.length})`);
    settings.set_boolean('sound-enabled', false);
    await sleep(100);
    check(changes.length === 1, `onChange for sound-enabled (saw ${changes.length})`);

    // The reader cannot write: no write method, no reachable field.
    check(sameJson(Object.getOwnPropertyNames(StoreReader.prototype).sort(),
        ['constructor', 'destroy', 'readAiAnswers', 'readOverrides', 'readSettings', 'readTravel']),
    'the reader has only reads');
    check(Object.keys(reader).length === 0, 'the reader exposes no field');
    const delayed = withSignalTracker(new Gio.Settings({ schema_id: SCHEMA_ID }));
    delayed.delay();
    const delayedReader = new StoreReader(delayed, () => changes.push('delayed change'));
    delayedReader.readSettings();
    delayedReader.readOverrides();
    delayedReader.readTravel();
    delayedReader.readAiAnswers();
    check(!delayed.get_has_unapplied(), 'reading never writes');
    delayedReader.destroy();

    // The writer does not rewrite the stored AI answers (the coalescing seed).
    // The memory backend emits no 'changed' for a same-value write, so the
    // write is caught as an unapplied change on a delay()ed settings object.
    settings.set_string('ai-verdicts', serializeAiAnswers(answersWith('occ:z|1')));
    const pinned = new Gio.Settings({ schema_id: SCHEMA_ID });
    pinned.delay();
    const pinnedWriter = new StoreWriter(pinned);
    pinnedWriter.writeAiAnswers(answersWith('occ:z|1'));
    await sleep(600);
    check(!pinned.get_has_unapplied(), 'writing the stored AI answers again does nothing');
    pinnedWriter.destroy();
    check(!pinned.get_has_unapplied(), 'writing the stored AI answers again does nothing');

    writer.destroy();
    reader.destroy();
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
