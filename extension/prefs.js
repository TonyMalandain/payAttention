// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The settings window (PRD §6): edits the owner's settings keys only, never
// alert-state or the health-* keys, and the AI engine key, which it writes to
// the keyring and never reads back (ADR-0009).
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Secret from 'gi://Secret?version=1';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { parseList, normalizeDomains, normalizeAddresses } from './core/display.js';
import { BUILTIN_IMPORTANT_WORDS, BUILTIN_IGNORE_WORDS } from './core/words.js';
import {
    ENGINE_KEY_SCHEMA_NAME, ENGINE_KEY_ATTRIBUTE, normaliseEndpoint, mayCarryKey, isSendableKey, normaliseModel,
} from './core/aiEngine.js';
import { INVITE_FIELDS } from './core/aiProtocol.js';
import { HELPER_ENV_UNSET } from './core/protocol.js';
import {
    AI_WARNING, VERDICT_SOURCES, KEY_SAVE_FAILED, KEY_REMOVE_FAILED, NOT_TESTED, TESTING, describeMode, describeEndpoint, describeKey, checkKey,
    probeInput, probeResultFromLines, probeResultWhenStopped,
} from './core/aiSetup.js';

function group(title, description) {
    return new Adw.PreferencesGroup({ title, description: description ?? '' });
}

/** An integer setting, limited to the schema's range. */
function spinRow(settings, key, title, step = 1) {
    const [lower, upper] = settings.settings_schema.get_key(key).get_range().recursiveUnpack()[1];
    const row = new Adw.SpinRow({
        title,
        adjustment: new Gtk.Adjustment({ lower, upper, step_increment: step, page_increment: step * 10 }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/** A comma list, normalized when applied and shown back as stored. */
function listRow(settings, key, title, normalize) {
    const row = new Adw.EntryRow({ title, show_apply_button: true, text: settings.get_strv(key).join(', ') });
    row.connect('apply', () => {
        const normalized = normalize(parseList(row.text));
        settings.set_strv(key, normalized);
        row.text = normalized.join(', ');
    });
    return row;
}

function buttonRow(title, onActivated) {
    const row = new Adw.ButtonRow({ title });
    row.connect('activated', onActivated);
    return row;
}

const asIs = items => items;

/** The engine key schema (ADR-0009). Built per call: nothing at module scope. */
function engineKeySchema() {
    return new Secret.Schema(ENGINE_KEY_SCHEMA_NAME, Secret.SchemaFlags.NONE,
        { [ENGINE_KEY_ATTRIBUTE]: Secret.SchemaAttributeType.STRING });
}

/**
 * Whether a key is saved for this address. Never loads a secret, never unlocks, never rejects.
 *   normaliseEndpoint(address) null   -> 'no-address'
 *   Service.get or search fails       -> 'unavailable'
 *   no item                           -> 'none'
 *   at least one unlocked item        -> 'saved'
 *   only locked items                 -> 'saved-locked'
 *
 * @returns {Promise<import('./core/aiSetup.js').KeyState>}
 */
function keyState(address, cancellable) {
    const endpoint = normaliseEndpoint(address);
    if (endpoint === null)
        return Promise.resolve('no-address');
    return new Promise(resolve => {
        // Every failure is 'unavailable': the error itself is never kept, it could name the address.
        try {
            Secret.Service.get(Secret.ServiceFlags.NONE, cancellable, (_o, res) => {
                try {
                    const service = Secret.Service.get_finish(res);
                    service.search(engineKeySchema(), { [ENGINE_KEY_ATTRIBUTE]: endpoint }, Secret.SearchFlags.ALL,
                        cancellable, (_s, searchRes) => {
                            try {
                                const items = service.search_finish(searchRes);
                                if (items.length === 0)
                                    resolve('none');
                                else
                                    resolve(items.some(i => !i.get_locked()) ? 'saved' : 'saved-locked');
                            } catch {
                                resolve('unavailable');
                            }
                        });
                } catch {
                    resolve('unavailable');
                }
            });
        } catch {
            resolve('unavailable');
        }
    });
}

/**
 * Stores key for this address in Secret.COLLECTION_DEFAULT, replacing an item with the
 * same attributes. Never rejects.
 *
 * @returns {Promise<boolean>} false, without any keyring call, when !mayCarryKey(address) or
 *          !isSendableKey(key); false when the keyring call fails; true when stored
 */
function storeKey(address, key, cancellable) {
    if (!mayCarryKey(address) || !isSendableKey(key))
        return Promise.resolve(false);
    const endpoint = normaliseEndpoint(address);
    return new Promise(resolve => {
        try {
            Secret.password_store(engineKeySchema(), { [ENGINE_KEY_ATTRIBUTE]: endpoint }, Secret.COLLECTION_DEFAULT,
                `payAttention AI engine key for ${endpoint}`, key, cancellable, (_o, res) => {
                    try {
                        resolve(Secret.password_store_finish(res));
                    } catch {
                        resolve(false);
                    }
                });
        } catch {
            resolve(false);
        }
    });
}

/**
 * Secret.password_clear for this address's items. Never rejects.
 *
 * @returns {Promise<boolean>} false when normaliseEndpoint(address) is null or the call fails; true otherwise
 */
function removeKey(address, cancellable) {
    const endpoint = normaliseEndpoint(address);
    if (endpoint === null)
        return Promise.resolve(false);
    return new Promise(resolve => {
        try {
            Secret.password_clear(engineKeySchema(), { [ENGINE_KEY_ATTRIBUTE]: endpoint }, cancellable, (_o, res) => {
                try {
                    // false only means nothing matched: the address is still clear of keys.
                    Secret.password_clear_finish(res);
                    resolve(true);
                } catch {
                    resolve(false);
                }
            });
        } catch {
            resolve(false);
        }
    });
}

/**
 * One Test connection run: a fresh AI helper gets configure and probe at once, and is
 * killed as soon as it answers, stops, or the watchdog fires. stdin stays open until
 * then, because the helper exits at stdin EOF even with a request in flight. Never rejects.
 *
 * @param {string} helperPath GLib.build_filenamev([this.path, 'ai', 'main.js'])
 * @returns {Promise<import('./core/aiSetup.js').ProbeResult|null>} null only when cancellable was cancelled
 */
function testConnection(helperPath, address, model, cancellable) {
    const p = probeInput(address, model);
    if (!p.ok)
        return Promise.resolve(p.result);

    return new Promise(resolve => {
        const run = new Gio.Cancellable();
        let proc = null;
        let done = false;
        let watchdogId = 0;
        let cancelId = 0;

        const finish = result => {
            if (done)
                return;
            done = true;
            if (watchdogId !== 0) {
                GLib.source_remove(watchdogId);
                watchdogId = 0;
            }
            run.cancel();
            // Deferred: disconnecting inside the cancelled handler would deadlock.
            if (cancelId !== 0) {
                const id = cancelId;
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    cancellable.disconnect(id);
                    return GLib.SOURCE_REMOVE;
                });
            }
            proc?.force_exit();
            resolve(result);
        };

        try {
            // The same spawn rule as the shell (interfaces.md §1 "Environment"): library log
            // lines, which carry the address, must never reach the helper's stdout.
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
            });
            for (const name of HELPER_ENV_UNSET)
                launcher.unsetenv(name);
            proc = launcher.spawnv(['gjs', '-m', helperPath]);
        } catch {
            resolve(probeResultWhenStopped('spawn-failed'));
            return;
        }

        cancelId = cancellable.connect(() => finish(null));
        if (done)
            return;
        watchdogId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, p.watchdogMs, () => {
            watchdogId = 0;
            finish(probeResultWhenStopped('timed-out'));
            return GLib.SOURCE_REMOVE;
        });

        proc.get_stdin_pipe().write_bytes_async(new GLib.Bytes(new TextEncoder().encode(p.input)),
            GLib.PRIORITY_DEFAULT, run, (stream, res) => {
                try {
                    stream.write_bytes_finish(res);
                } catch {
                    finish(probeResultWhenStopped('exited'));
                }
            });

        const stdout = new Gio.DataInputStream({ base_stream: proc.get_stdout_pipe(), close_base_stream: true });
        const lines = [];
        const readNext = () => {
            stdout.read_line_async(GLib.PRIORITY_DEFAULT, run, (stream, res) => {
                let line;
                try {
                    [line] = stream.read_line_finish_utf8(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        finish(probeResultWhenStopped('exited'));
                    return;
                }
                if (line === null) {
                    finish(probeResultWhenStopped('exited'));
                    return;
                }
                lines.push(line);
                const result = probeResultFromLines(lines);
                if (result !== null)
                    finish(result);
                else
                    readNext();
            });
        };
        readNext();
    });
}

/**
 * The Verdicts page. Connects its own settings handlers; everything it starts is
 * cancelled through cancellable.
 *
 * @returns {Adw.PreferencesPage}
 */
function verdictsPage(settings, helperPath, cancellable) {
    const page = new Adw.PreferencesPage({
        name: 'payattention-verdicts', title: 'Verdicts', icon_name: 'network-server-symbolic',
    });
    const stored = () => ({
        verdictSource: settings.get_string('verdict-source'),
        aiEndpoint: settings.get_string('ai-endpoint'),
        aiModel: settings.get_string('ai-model'),
    });
    const indexOf = value => Math.max(0, VERDICT_SOURCES.findIndex(s => s.value === value));

    const who = group('Who decides');
    const modeRow = new Adw.ComboRow({
        name: 'payattention-verdict-source',
        title: 'Who decides',
        model: Gtk.StringList.new(VERDICT_SOURCES.map(s => s.label)),
        selected: indexOf(settings.get_string('verdict-source')),
        subtitle: describeMode(stored()),
    });
    who.add(modeRow);
    page.add(who);

    const engine = new Adw.PreferencesGroup({ name: 'payattention-ai-engine', title: 'AI engine', description: AI_WARNING });
    const fields = new Adw.ExpanderRow({ name: 'payattention-ai-fields', title: 'What is sent for each meeting' });
    for (const field of INVITE_FIELDS)
        fields.add_row(new Adw.ActionRow({ title: field.label }));
    const endpointRow = new Adw.EntryRow({
        name: 'payattention-ai-endpoint', title: 'Address', show_apply_button: true, text: settings.get_string('ai-endpoint'),
    });
    const whereRow = new Adw.ActionRow({ name: 'payattention-ai-where', title: 'Where the invite goes' });
    const modelRow = new Adw.EntryRow({
        name: 'payattention-ai-model', title: 'Model', show_apply_button: true, text: settings.get_string('ai-model'),
    });
    const keyRow = new Adw.PasswordEntryRow({ name: 'payattention-ai-key', title: 'API key for this address', show_apply_button: true });
    const keyStatusRow = new Adw.ActionRow({ name: 'payattention-ai-key-status', title: 'Saved key' });
    const removeButton = new Gtk.Button({ name: 'payattention-ai-key-remove', label: 'Remove', valign: Gtk.Align.CENTER });
    keyStatusRow.add_suffix(removeButton);
    const testRow = new Adw.ButtonRow({ name: 'payattention-ai-test', title: 'Test connection' });
    const testResultRow = new Adw.ActionRow({ name: 'payattention-ai-test-result', title: 'Connection', subtitle: NOT_TESTED });
    for (const row of [fields, endpointRow, whereRow, modelRow, keyRow, keyStatusRow, testRow, testResultRow])
        engine.add(row);
    page.add(engine);

    let testRunning = false;
    let testGeneration = 0;
    let keySaved = false;
    let keySaving = false;
    let keyGeneration = 0;

    const updateSensitivity = () => {
        const editing = endpointRow.text !== settings.get_string('ai-endpoint') ||
            modelRow.text !== settings.get_string('ai-model');
        const keyAllowed = describeEndpoint(settings.get_string('ai-endpoint')).keyAllowed;
        testRow.sensitive = !editing && !testRunning;
        keyRow.sensitive = !editing && keyAllowed && !keySaving;
        // Removing is always safe, so it does not depend on keyAllowed: saving does.
        removeButton.sensitive = !editing && keySaved;
    };

    const refreshKey = async () => {
        const generation = ++keyGeneration;
        const address = settings.get_string('ai-endpoint');
        // Empty and disabled until the answer, so neither describes the previous address.
        keyStatusRow.subtitle = '';
        keySaved = false;
        updateSensitivity();
        const state = await keyState(address, cancellable);
        if (generation !== keyGeneration || cancellable.is_cancelled())
            return;
        keySaved = state === 'saved' || state === 'saved-locked';
        keyStatusRow.subtitle = describeKey(state, describeEndpoint(address).keyAllowed);
        updateSensitivity();
    };

    const refresh = () => {
        const now = stored();
        whereRow.subtitle = describeEndpoint(now.aiEndpoint).text;
        modeRow.subtitle = describeMode(now);
        testGeneration++;
        testResultRow.subtitle = NOT_TESTED;
        testResultRow.remove_css_class('success');
        testResultRow.remove_css_class('error');
        refreshKey();
        updateSensitivity();
    };

    modeRow.connect('notify::selected', () => {
        const value = VERDICT_SOURCES[modeRow.selected].value;
        if (settings.get_string('verdict-source') !== value)
            settings.set_string('verdict-source', value);
    });
    settings.connect('changed::verdict-source', () => {
        const index = indexOf(settings.get_string('verdict-source'));
        if (modeRow.selected !== index)
            modeRow.selected = index;
        modeRow.subtitle = describeMode(stored());
    });

    endpointRow.connect('apply', () => {
        const d = describeEndpoint(endpointRow.text);
        if (!d.usable) {
            endpointRow.add_css_class('error');
            whereRow.subtitle = d.text;
            return;
        }
        endpointRow.remove_css_class('error');
        // Set the row first, so the changed:: handler sees no unapplied edit.
        endpointRow.text = d.endpoint;
        settings.set_string('ai-endpoint', d.endpoint);
    });

    modelRow.connect('apply', () => {
        const text = modelRow.text.trim();
        const model = text === '' ? '' : normaliseModel(text);
        if (model === null) {
            modelRow.add_css_class('error');
            return;
        }
        modelRow.remove_css_class('error');
        modelRow.text = model;
        settings.set_string('ai-model', model);
    });

    keyRow.connect('apply', async () => {
        const checked = checkKey(keyRow.text);
        if (!checked.ok) {
            keyStatusRow.subtitle = checked.text;
            keyRow.add_css_class('error');
            return;
        }
        // Cleared before any await, so the key is on screen no longer than it takes to press apply.
        keyRow.text = '';
        keyRow.remove_css_class('error');
        keySaving = true;
        updateSensitivity();
        const ok = await storeKey(settings.get_string('ai-endpoint'), checked.key, cancellable);
        keySaving = false;
        if (cancellable.is_cancelled())
            return;
        updateSensitivity();
        if (ok)
            refreshKey();
        else
            keyStatusRow.subtitle = KEY_SAVE_FAILED;
    });

    removeButton.connect('clicked', async () => {
        const ok = await removeKey(settings.get_string('ai-endpoint'), cancellable);
        if (cancellable.is_cancelled())
            return;
        if (ok)
            refreshKey();
        else
            keyStatusRow.subtitle = KEY_REMOVE_FAILED;
    });

    testRow.connect('activated', async () => {
        if (testRunning)
            return;
        testRunning = true;
        updateSensitivity();
        testResultRow.subtitle = TESTING;
        testResultRow.remove_css_class('success');
        testResultRow.remove_css_class('error');
        const generation = ++testGeneration;
        const result = await testConnection(helperPath, settings.get_string('ai-endpoint'),
            settings.get_string('ai-model'), cancellable);
        testRunning = false;
        // Settings changed during the run (refresh() moved the generation on): its answer is about old values.
        if (result !== null && generation === testGeneration) {
            testResultRow.subtitle = result.text;
            testResultRow.add_css_class(result.ok ? 'success' : 'error');
        }
        updateSensitivity();
    });

    endpointRow.connect('changed', updateSensitivity);
    modelRow.connect('changed', updateSensitivity);
    settings.connect('changed::ai-endpoint', () => {
        // A key typed but not saved was meant for the previous address, and so was its refusal.
        keyRow.text = '';
        keyRow.remove_css_class('error');
        // Follow a change made outside this window; one made here already shows the stored text.
        const address = settings.get_string('ai-endpoint');
        if (endpointRow.text !== address)
            endpointRow.text = address;
        endpointRow.remove_css_class('error');
        refresh();
    });
    settings.connect('changed::ai-model', refresh);

    refresh();
    return page;
}

export default class PayAttentionPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Kept alive with the window.
        window._settings = settings;
        const cancellable = new Gio.Cancellable();
        window._aiCancellable = cancellable;

        const alerts = new Adw.PreferencesPage({ title: 'Alerts', icon_name: 'alarm-symbolic' });

        const online = group('Online meetings', 'Minutes before the start');
        online.add(spinRow(settings, 'online-headsup-minutes', 'Heads-up'));
        online.add(spinRow(settings, 'online-nudge-minutes', 'Nudge'));
        online.add(spinRow(settings, 'online-insist-minutes', 'Insist'));
        online.add(spinRow(settings, 'online-takeover-minutes', 'Takeover'));
        alerts.add(online);

        const inPerson = group('In-person meetings', 'Minutes before you must leave');
        inPerson.add(spinRow(settings, 'inperson-headsup-minutes', 'Heads-up'));
        inPerson.add(spinRow(settings, 'inperson-nudge-minutes', 'Nudge'));
        inPerson.add(spinRow(settings, 'inperson-insist-minutes', 'Insist'));
        inPerson.add(spinRow(settings, 'inperson-takeover-minutes', 'Takeover'));
        inPerson.add(spinRow(settings, 'default-travel-minutes', 'Default travel time (minutes)', 5));
        alerts.add(inPerson);

        const behaviour = group('Behaviour');
        behaviour.add(spinRow(settings, 'headsup-display-seconds', 'Heads-up stays for (seconds)'));
        behaviour.add(spinRow(settings, 'snooze-minutes', 'Snooze (minutes)'));
        behaviour.add(spinRow(settings, 'takeover-snooze-minutes', 'Snooze during takeover (minutes)'));
        behaviour.add(spinRow(settings, 'cutoff-minutes', 'Stop alerting after the start (minutes)'));
        const sound = new Adw.SwitchRow({ title: 'Sound at insist and takeover' });
        settings.bind('sound-enabled', sound, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(sound);
        const testAlert = new Adw.SwitchRow({ title: 'Show Test alert in the menu' });
        settings.bind('show-test-alert', testAlert, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(testAlert);
        alerts.add(behaviour);

        const judgment = new Adw.PreferencesPage({ title: 'Judgment', icon_name: 'emblem-important-symbolic' });

        const meetings = group('Meetings');
        meetings.add(spinRow(settings, 'large-meeting-size', 'Large meeting: more than this many guests'));
        judgment.add(meetings);

        // Adw.EntryRow has no subtitle, so the built-in lists go in the group description.
        const words = group('Words',
            `Built in, important: ${BUILTIN_IMPORTANT_WORDS.join(', ')}\nBuilt in, ignore: ${BUILTIN_IGNORE_WORDS.join(', ')}`);
        words.add(listRow(settings, 'extra-important-words', 'Extra important words', asIs));
        words.add(listRow(settings, 'extra-ignore-words', 'Extra ignore words', asIs));
        judgment.add(words);

        const you = group('You');
        you.add(listRow(settings, 'owner-domains', 'Your email domains (empty = detect from your calendars)', normalizeDomains));
        you.add(listRow(settings, 'extra-owner-addresses', 'Extra addresses of yours', normalizeAddresses));
        judgment.add(you);

        const saved = group('Saved choices');
        saved.add(buttonRow('Clear meeting overrides', () => {
            settings.reset('verdict-overrides');
            settings.reset('mode-overrides');
        }));
        saved.add(buttonRow('Clear travel times', () => settings.reset('travel-times')));
        judgment.add(saved);

        window.add(alerts);
        window.add(judgment);
        window.add(verdictsPage(settings, GLib.build_filenamev([this.path, 'ai', 'main.js']), cancellable));
        window.connect('close-request', () => {
            cancellable.cancel();
            return false;
        });
    }
}
