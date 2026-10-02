// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// gjs script, not a Node test: loads the real extension/prefs.js on a stub
// ExtensionPreferences, fills a window on the private broadway display, and runs
// one scenario. Run only by tests/ai/prefs.test.js inside tests/ai/prefsSession.js.
//
//   gjs -m prefsDriver.js <scenario> [args...]
//
// Prints `PREFS-STEP <json>` lines for Node to check, then `PREFS-DRIVER DONE`
// (exit 0) or `PREFS-DRIVER FAIL <message>` (exit 1). It never prints a key:
// keys arrive as argv and only booleans about them are printed.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';
import System from 'system';

import { ENGINE_KEY_SCHEMA } from '../../../extension/ai/keyring.js';
import { KEY_SAVE_FAILED, NOT_TESTED, TESTING, checkKey, describeKey } from '../../../extension/core/aiSetup.js';

const EXTENSION_DIR = Gio.File.new_for_uri(import.meta.url).get_parent()
    .resolve_relative_path('../../../extension').get_path();
// The UUID has one source: extension/metadata.json (PG-10).
const UUID = JSON.parse(new TextDecoder().decode(
    GLib.file_get_contents(`${EXTENSION_DIR}/metadata.json`)[1])).uuid;
const WAIT_MS = 10000;
const ENGINE_ONE = 'https://engine-one.example.test/v1';
const ENGINE_TWO = 'https://engine-two.example.test/v1';
const PRIVATE_HTTP = 'http://10.0.0.5:8080/v1';
// Another program's item with the same attribute: prefs must never touch it.
const OTHER_SCHEMA = new Secret.Schema('org.example.payattention-test.Other', Secret.SchemaFlags.NONE,
    { endpoint: Secret.SchemaAttributeType.STRING });
const OTHER_SECRET = 'not-a-payattention-item';
const SHOWN_PROPERTIES = ['text', 'title', 'subtitle', 'label', 'description'];
// The harness rule "never a real engine": Test connection runs only against 127.0.0.1.
const LOOPBACK_ENGINE = /^http:\/\/127\.0\.0\.1:\d+\/v1$/;
const TEST_WAIT_MS = 20000;

/** Prints one observation for Node. */
function step(object) {
    print('PREFS-STEP ' + JSON.stringify(object));
}

function check(condition, what) {
    if (!condition)
        throw new Error(`check failed: ${what}`);
}

/** Every widget under root, depth first, root included. */
function* walk(root) {
    yield root;
    for (let child = root.get_first_child(); child !== null; child = child.get_next_sibling())
        yield* walk(child);
}

/** The first widget under root whose name is `name`; throws when there is none. */
function find(root, name) {
    for (const w of walk(root)) {
        if (w.get_name() === name)
            return w;
    }
    throw new Error(`widget not found: ${name}`);
}

/** The first widget under root of `type` whose title passes `match`; throws when there is none. */
function findByTitle(root, type, match) {
    for (const w of walk(root)) {
        if (w instanceof type && match(w.title))
            return w;
    }
    throw new Error(`widget not found by title: ${type.name}`);
}

/** Resolves once predicate() is true, polling every 50 ms; rejects with `timed out: <what>`. */
function waitFor(predicate, timeoutMs, what) {
    return new Promise((resolve, reject) => {
        const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
        const poll = () => {
            try {
                if (predicate()) {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                }
            } catch (e) {
                reject(e);
                return GLib.SOURCE_REMOVE;
            }
            if (GLib.get_monotonic_time() > deadline) {
                reject(new Error(`timed out: ${what}`));
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        };
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, poll);
    });
}

/** Resolves after ms, from the main loop. */
function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

const decode = bytes => new TextDecoder().decode(bytes);

/** This process's children whose command line mentions ai/main.js. */
function aiChildren() {
    const self = GLib.file_read_link('/proc/self');
    const out = [];
    const dir = GLib.Dir.open('/proc', 0);
    let name;
    while ((name = dir.read_name()) !== null) {
        if (!/^\d+$/.test(name))
            continue;
        try {
            const stat = decode(GLib.file_get_contents(`/proc/${name}/stat`)[1]);
            const ppid = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[1];
            const cmdline = decode(GLib.file_get_contents(`/proc/${name}/cmdline`)[1]).replaceAll('\0', ' ');
            if (ppid === self && cmdline.includes('ai/main.js'))
                out.push(name);
        } catch {
            // The process exited while we looked.
        }
    }
    dir.close();
    return out;
}

/** Whether none of these processes has G_MESSAGES_DEBUG in its environment. */
function childEnvClean(pids) {
    return pids.every(pid => !decode(GLib.file_get_contents(`/proc/${pid}/environ`)[1])
        .split('\0').some(v => v.startsWith('G_MESSAGES_DEBUG=')));
}

function checkLoopback(endpoint) {
    check(LOOPBACK_ENGINE.test(endpoint ?? ''), `test engines must be on 127.0.0.1, got ${endpoint}`);
}

/** Presses Test connection and resolves with what the result row says once it has an answer. */
async function pressTest(window) {
    const testRow = find(window, 'payattention-ai-test');
    const result = find(window, 'payattention-ai-test-result');
    testRow.emit('activated');
    const during = { text: result.subtitle, sensitive: testRow.get_sensitive() };
    await waitFor(() => result.subtitle !== TESTING && result.subtitle !== NOT_TESTED, TEST_WAIT_MS, 'a Test connection answer');
    return {
        during, text: result.subtitle,
        success: result.has_css_class('success'), error: result.has_css_class('error'),
        sensitiveAfter: testRow.get_sensitive(),
    };
}

/** Sets an entry row's text and applies it, as the owner pressing its apply button. */
function apply(row, text) {
    row.text = text;
    row.emit('apply');
}

/** The rows added to an expander row, in order (its own header row is not one of them). */
function expanderRows(expander) {
    return [...walk(expander)].filter(w => w instanceof Adw.ActionRow && w.get_ancestor(Adw.ExpanderRow) === expander &&
        w.title !== expander.title);
}

/** The throwaway keyring's items of `schema` for these attributes, with their secrets loaded. */
function keyringItems(schema, attributes) {
    const service = Secret.Service.get_sync(Secret.ServiceFlags.OPEN_SESSION, null);
    return service.search_sync(schema, attributes, Secret.SearchFlags.ALL | Secret.SearchFlags.LOAD_SECRETS, null);
}

/** Whether exactly one engine key item exists for endpoint, holding `key`. */
function holdsOnly(endpoint, key) {
    const items = keyringItems(ENGINE_KEY_SCHEMA, { endpoint });
    return items.length === 1 && items[0].get_secret()?.get_text() === key;
}

/** Whether any widget under root shows `secret` in a text-bearing property. */
function shows(root, secret) {
    return [...walk(root)].some(w => SHOWN_PROPERTIES.some(p => typeof w[p] === 'string' && w[p].includes(secret)));
}

/** The titles of the window's pages, in order. The window's own untitled search page is left out. */
function pageTitles(window) {
    return [...walk(window)].filter(w => w instanceof Adw.PreferencesPage && w.title !== '').map(p => p.title);
}

/** A window filled by a fresh Prefs, as the Extensions app would do. */
async function openWindow(Prefs, path = EXTENSION_DIR) {
    const window = new Adw.PreferencesWindow();
    const prefs = new Prefs({ uuid: UUID, path });
    await prefs.fillPreferencesWindow(window);
    return window;
}

const SCENARIOS = {
    // The pages that existed before PG-4d, driven by title because their rows have no names.
    existing: async Prefs => {
        const window = await openWindow(Prefs);
        const settings = window._settings;
        step({ pages: pageTitles(window) });

        findByTitle(window, Adw.SpinRow, t => t === 'Snooze (minutes)').value = 7;
        step({ snooze: settings.get_int('snooze-minutes') });

        step({ showsTestAlert: shows(window, 'Test alert') });

        const domains = findByTitle(window, Adw.EntryRow, t => t.startsWith('Your email domains'));
        domains.text = ' Acme.TEST , b.test';
        domains.emit('apply');
        step({ domains: settings.get_strv('owner-domains') });

        settings.set_value('travel-times', new GLib.Variant('a{si}', { hq: 30 }));
        settings.set_value('meeting-travel-times', new GLib.Variant('a{si}', { 'series:a': 45 }));
        const before = settings.get_value('travel-times').recursiveUnpack();
        const meetingBefore = settings.get_value('meeting-travel-times').recursiveUnpack();
        findByTitle(window, Adw.ButtonRow, t => t === 'Clear travel times').emit('activated');
        step({
            travelBefore: before,
            travelAfter: settings.get_value('travel-times').recursiveUnpack(),
            meetingTravelBefore: meetingBefore,
            meetingTravelAfter: settings.get_value('meeting-travel-times').recursiveUnpack(),
        });
    },

    // The Verdicts page as it opens on default settings.
    layout: async Prefs => {
        const window = await openWindow(Prefs);
        const mode = find(window, 'payattention-verdict-source');
        const page = find(window, 'payattention-verdicts');
        step({
            pages: pageTitles(window),
            page: { title: page.title, icon: page.icon_name },
            warning: find(window, 'payattention-ai-engine').description,
            engineTitle: find(window, 'payattention-ai-engine').title,
            fieldsTitle: find(window, 'payattention-ai-fields').title,
            fields: expanderRows(find(window, 'payattention-ai-fields')).map(r => r.title),
            endpoint: find(window, 'payattention-ai-endpoint').text,
            model: find(window, 'payattention-ai-model').text,
            key: find(window, 'payattention-ai-key').text,
            where: find(window, 'payattention-ai-where').subtitle,
            whereTitle: find(window, 'payattention-ai-where').title,
            modeTitle: mode.title,
            modeLabels: [...Array(mode.model.get_n_items()).keys()].map(i => mode.model.get_string(i)),
            selected: mode.selected,
            modeSubtitle: mode.subtitle,
            testResult: find(window, 'payattention-ai-test-result').subtitle,
            titles: Object.fromEntries(['payattention-ai-endpoint', 'payattention-ai-model', 'payattention-ai-key',
                'payattention-ai-key-status', 'payattention-ai-test', 'payattention-ai-test-result']
                .map(n => [n, find(window, n).title])),
            removeLabel: find(window, 'payattention-ai-key-remove').label,
        });
    },

    // The mode switch and the model row.
    mode: async Prefs => {
        const window = await openWindow(Prefs);
        const settings = window._settings;
        const mode = find(window, 'payattention-verdict-source');
        mode.selected = 1;
        step({ afterAi: { stored: settings.get_string('verdict-source'), subtitle: mode.subtitle } });
        apply(find(window, 'payattention-ai-model'), 'llama3');
        step({ afterModel: { stored: settings.get_string('ai-model'), subtitle: mode.subtitle } });
        settings.set_string('verdict-source', 'rules');
        step({ afterExternal: { selected: mode.selected, subtitle: mode.subtitle } });
        let writes = 0;
        settings.connect('changed::verdict-source', () => writes++);
        mode.selected = 1;
        mode.selected = 1;
        step({ writes });
    },

    // The address and model rows: what is stored, and what is refused.
    endpoint: async (Prefs, [key]) => {
        const window = await openWindow(Prefs);
        const settings = window._settings;
        const row = find(window, 'payattention-ai-endpoint');
        const where = find(window, 'payattention-ai-where');
        const applied = [];
        for (const input of ['HTTP://LOCALHOST:11434/v1/', 'http://api.example.test/v1', 'ftp://x',
            'https://api.example.test/v1', 'http://10.0.0.5:8080/v1']) {
            apply(row, input);
            applied.push({ input, stored: settings.get_string('ai-endpoint'), text: row.text,
                error: row.has_css_class('error'), where: where.subtitle });
        }
        step({ applied });

        const sensitive = () => Object.fromEntries(['payattention-ai-key', 'payattention-ai-key-remove', 'payattention-ai-test']
            .map(n => [n, find(window, n).get_sensitive()]));
        const model = find(window, 'payattention-ai-model');
        apply(model, 'llama3');
        // An address that allows a key, with one saved: every control is sensitive before the edit,
        // so the greying below is caused by the edit alone.
        apply(row, ENGINE_ONE);
        apply(find(window, 'payattention-ai-key'), key);
        await waitFor(() => find(window, 'payattention-ai-key-status').subtitle === describeKey('saved', true), WAIT_MS,
            'the key saved before the edits');
        await waitFor(() => find(window, 'payattention-ai-key').get_sensitive(), WAIT_MS, 'the key row sensitive after the save');
        const before = sensitive();
        row.text = 'http://127.0.0.1:1/v1';
        const endpointEditing = sensitive();
        row.text = settings.get_string('ai-endpoint');
        const endpointBack = sensitive();
        model.text = 'other-model';
        const modelEditing = sensitive();
        model.text = settings.get_string('ai-model');
        const modelBack = sensitive();
        step({ unapplied: { before, endpointEditing, endpointBack, modelEditing, modelBack } });

        apply(model, 'm'.repeat(201));
        step({ longModel: { stored: settings.get_string('ai-model'), error: model.has_css_class('error') } });
        apply(model, ' llama3 ');
        step({ trimmedModel: { stored: settings.get_string('ai-model'), text: model.text, error: model.has_css_class('error') } });
        apply(model, '');
        step({ emptyModel: { stored: settings.get_string('ai-model') } });
    },

    // Editing the page writes only the three AI keys.
    'nothing-else-written': async Prefs => {
        const window = await openWindow(Prefs);
        const settings = window._settings;
        find(window, 'payattention-verdict-source').selected = 1;
        apply(find(window, 'payattention-ai-endpoint'), 'https://api.example.test/v1');
        apply(find(window, 'payattention-ai-endpoint'), 'http://api.example.test/v1');
        apply(find(window, 'payattention-ai-model'), 'llama3');
        const changed = settings.settings_schema.list_keys()
            .filter(k => !settings.get_value(k).equal(settings.get_default_value(k))).sort();
        step({ changed });
    },

    // The API key: saved, shown only as a status, per address, replaced, refused, removed.
    // Keys come in argv and are never printed: only booleans about them are.
    key: async (Prefs, [k1, k2]) => {
        Secret.password_store_sync(OTHER_SCHEMA, { endpoint: ENGINE_ONE }, Secret.COLLECTION_DEFAULT,
            'another program', OTHER_SECRET, null);

        const window = await openWindow(Prefs);
        const settings = window._settings;
        const endpointRow = find(window, 'payattention-ai-endpoint');
        const keyRow = find(window, 'payattention-ai-key');
        const status = find(window, 'payattention-ai-key-status');
        const remove = find(window, 'payattention-ai-key-remove');
        const statusIs = (text, what) => waitFor(() => status.subtitle === text, WAIT_MS, what);

        apply(endpointRow, ENGINE_ONE);
        await statusIs(describeKey('none', true), 'status none for engine-one');
        step({ first: { status: status.subtitle, removeSensitive: remove.get_sensitive() } });

        apply(keyRow, '  ' + k1 + '\n');
        const clearedAtOnce = keyRow.text === '';
        await statusIs(describeKey('saved', true), 'status saved after the first save');
        const items = keyringItems(ENGINE_KEY_SCHEMA, { endpoint: ENGINE_ONE });
        step({
            save: {
                clearedAtOnce,
                count: items.length,
                secretIsTrimmedKey: items[0]?.get_secret()?.get_text() === k1,
                labelRight: items[0]?.get_label() === `payAttention AI engine key for ${ENGINE_ONE}`,
                attributeRight: items[0]?.get_attributes().endpoint === ENGINE_ONE,
                removeSensitive: remove.get_sensitive(),
            },
        });

        step({
            notInSettings: settings.settings_schema.list_keys().every(k => !settings.get_value(k).print(true).includes(k1)),
        });
        const second = await openWindow(Prefs);
        await waitFor(() => find(second, 'payattention-ai-key-status').subtitle === describeKey('saved', true), WAIT_MS,
            'status saved in a second window');
        step({ notShown: { first: !shows(window, k1), second: !shows(second, k1) } });
        second.close();

        // A key typed but not saved belongs to the old address: changing the address clears it.
        keyRow.text = k2;
        apply(endpointRow, ENGINE_TWO);
        step({ addressChanged: { typedKeyCleared: keyRow.text === '', statusWhilePending: status.subtitle } });
        await statusIs(describeKey('none', true), 'status none for engine-two');
        apply(endpointRow, ENGINE_ONE);
        await statusIs(describeKey('saved', true), 'status saved for engine-one again');
        step({ perAddress: true });

        apply(keyRow, k2);
        await waitFor(() => holdsOnly(ENGINE_ONE, k2), WAIT_MS, 'one item holding K2');
        await waitFor(() => keyRow.get_sensitive(), WAIT_MS, 'the key row sensitive after the replace');
        step({ replaced: holdsOnly(ENGINE_ONE, k2) });

        apply(keyRow, 'a b');
        step({
            refusedSpace: {
                status: status.subtitle === checkKey('a b').text,
                kept: keyRow.text === 'a b',
                error: keyRow.has_css_class('error'),
                stillK2: holdsOnly(ENGINE_ONE, k2),
            },
        });
        apply(keyRow, '');
        step({ refusedEmpty: { status: status.subtitle === checkKey('').text, stillK2: holdsOnly(ENGINE_ONE, k2) } });

        remove.emit('clicked');
        await statusIs(describeKey('none', true), 'status none after Remove');
        step({
            removed: {
                count: keyringItems(ENGINE_KEY_SCHEMA, { endpoint: ENGINE_ONE }).length,
                removeSensitive: remove.get_sensitive(),
            },
        });

        apply(endpointRow, PRIVATE_HTTP);
        await statusIs(describeKey('none', false), 'status none, key not allowed');
        const before = keyringItems(ENGINE_KEY_SCHEMA, {}).length;
        const keySensitive = keyRow.get_sensitive();
        const removeSensitive = remove.get_sensitive();
        apply(keyRow, k1);
        await statusIs(KEY_SAVE_FAILED, 'the refused save on plain http');
        step({
            noKeyHere: {
                keySensitive, removeSensitive,
                unchanged: keyringItems(ENGINE_KEY_SCHEMA, {}).length === before,
            },
        });

        // A key saved there some other way can still be removed: removal is always safe.
        Secret.password_store_sync(ENGINE_KEY_SCHEMA, { endpoint: PRIVATE_HTTP }, Secret.COLLECTION_DEFAULT,
            'saved some other way', k1, null);
        apply(endpointRow, ENGINE_TWO);
        await statusIs(describeKey('none', true), 'status none for engine-two before the plain http key');
        apply(endpointRow, PRIVATE_HTTP);
        await statusIs(describeKey('saved', false), 'status saved, key not allowed');
        const removableKeySensitive = keyRow.get_sensitive();
        const removableRemoveSensitive = remove.get_sensitive();
        remove.emit('clicked');
        await statusIs(describeKey('none', false), 'status none after Remove on plain http');
        step({
            removableHere: {
                keySensitive: removableKeySensitive, removeSensitive: removableRemoveSensitive,
                count: keyringItems(ENGINE_KEY_SCHEMA, { endpoint: PRIVATE_HTTP }).length,
                removeSensitiveAfter: remove.get_sensitive(),
            },
        });

        const others = keyringItems(OTHER_SCHEMA, { endpoint: ENGINE_ONE });
        step({ otherKept: others.length === 1 && others[0].get_secret()?.get_text() === OTHER_SECRET });

        apply(endpointRow, ENGINE_ONE);
        await statusIs(describeKey('none', true), 'status none before the locked case');
        apply(keyRow, k1);
        await statusIs(describeKey('saved', true), 'status saved before locking');
        const service = Secret.Service.get_sync(Secret.ServiceFlags.OPEN_SESSION | Secret.ServiceFlags.LOAD_COLLECTIONS, null);
        service.lock_sync(service.get_collections(), null);
        apply(endpointRow, ENGINE_TWO);
        await statusIs(describeKey('none', true), 'status none for engine-two while locked');
        apply(endpointRow, ENGINE_ONE);
        await statusIs(describeKey('saved-locked', true), 'status saved-locked');
        step({ locked: status.subtitle, removeSensitive: remove.get_sensitive() });
    },

    // Test connection against the fake engine: a refused key, a Yes, a Yes with a key, a closed port, no model.
    probe: async (Prefs, [endpoint, closedEndpoint, key]) => {
        checkLoopback(endpoint);
        checkLoopback(closedEndpoint);
        const window = await openWindow(Prefs);
        const endpointRow = find(window, 'payattention-ai-endpoint');
        const modelRow = find(window, 'payattention-ai-model');
        apply(endpointRow, endpoint);
        apply(modelRow, 'test-model');
        step({ refusedKey: await pressTest(window) });
        step({ yes: await pressTest(window) });

        apply(find(window, 'payattention-ai-key'), key);
        await waitFor(() => find(window, 'payattention-ai-key-status').subtitle === describeKey('saved', true), WAIT_MS,
            'the key saved for the fake engine');
        step({ yesWithKey: await pressTest(window) });

        apply(endpointRow, closedEndpoint);
        step({ closed: await pressTest(window) });

        apply(modelRow, '');
        const noModel = await pressTest(window);
        step({ noModel: { ...noModel, children: aiChildren().length } });
        step({ childrenAtEnd: aiChildren().length });
    },

    // Prefs installed without its ai/ directory: the helper cannot run.
    'broken-helper': async (Prefs, [endpoint, path]) => {
        checkLoopback(endpoint);
        const window = await openWindow(Prefs, path);
        apply(find(window, 'payattention-ai-endpoint'), endpoint);
        apply(find(window, 'payattention-ai-model'), 'test-model');
        step({ broken: await pressTest(window) });
    },

    // Closing the window mid-test kills the helper. The helper runs without G_MESSAGES_DEBUG.
    'close-while-testing': async (Prefs, [endpoint, seenFile]) => {
        checkLoopback(endpoint);
        const window = await openWindow(Prefs);
        apply(find(window, 'payattention-ai-endpoint'), endpoint);
        apply(find(window, 'payattention-ai-model'), 'test-model');
        find(window, 'payattention-ai-test').emit('activated');
        await waitFor(() => GLib.file_test(seenFile, GLib.FileTest.EXISTS), 15000, 'the engine to receive the probe');
        const children = aiChildren();
        step({ running: { children: children.length, envClean: childEnvClean(children),
            parentHasDebug: GLib.getenv('G_MESSAGES_DEBUG') !== null } });
        window.emit('close-request');
        await sleep(500);
        step({ afterClose: { children: aiChildren().length, result: find(window, 'payattention-ai-test-result').subtitle } });
    },

    // An address change, from this window or from outside it: the key row's refusal, Remove,
    // and the address row follow the new address. Keys come in argv and are never printed.
    'address-change': async (Prefs, [key]) => {
        const window = await openWindow(Prefs);
        const settings = window._settings;
        // Another writer of the same settings, as the Extensions app or gsettings would be.
        const outside = new Gio.Settings({ schema_id: settings.schema_id });
        const endpointRow = find(window, 'payattention-ai-endpoint');
        const where = find(window, 'payattention-ai-where');
        const keyRow = find(window, 'payattention-ai-key');
        const status = find(window, 'payattention-ai-key-status');
        const remove = find(window, 'payattention-ai-key-remove');
        const test = find(window, 'payattention-ai-test');
        const statusIs = (text, what) => waitFor(() => status.subtitle === text, WAIT_MS, what);

        apply(endpointRow, ENGINE_ONE);
        apply(keyRow, key);
        await statusIs(describeKey('saved', true), 'a key saved for engine-one');
        await waitFor(() => keyRow.get_sensitive(), WAIT_MS, 'the key row sensitive after the save');

        // A refused key, then the address changes: the field empties and its red goes with it.
        apply(keyRow, 'a b');
        const refusedRed = keyRow.has_css_class('error');
        const removeBefore = remove.get_sensitive();
        apply(endpointRow, ENGINE_TWO);
        step({
            refusedThenAddress: { refusedRed, cleared: keyRow.text === '', red: keyRow.has_css_class('error') },
            pendingAway: { removeBefore, status: status.subtitle, removeSensitive: remove.get_sensitive() },
        });
        await statusIs(describeKey('none', true), 'status none for engine-two');
        step({ answeredAway: { removeSensitive: remove.get_sensitive() } });

        apply(endpointRow, ENGINE_ONE);
        const pendingBack = { status: status.subtitle, removeSensitive: remove.get_sensitive() };
        await statusIs(describeKey('saved', true), 'status saved for engine-one again');
        step({ pendingBack, answeredBack: { removeSensitive: remove.get_sensitive() } });

        // A change made outside the window: the address row follows, even over a refused address.
        apply(endpointRow, 'ftp://x');
        const typedRed = endpointRow.has_css_class('error');
        outside.set_string('ai-endpoint', ENGINE_TWO);
        const followed = {
            typedRed, text: endpointRow.text, red: endpointRow.has_css_class('error'), where: where.subtitle,
            status: status.subtitle, removeSensitive: remove.get_sensitive(),
        };
        await statusIs(describeKey('none', true), 'status none for engine-two, set outside');
        step({
            outside: {
                ...followed,
                removeSensitiveAfter: remove.get_sensitive(),
                keySensitiveAfter: keyRow.get_sensitive(),
                testSensitiveAfter: test.get_sensitive(),
            },
        });
    },

    // No Secret Service on the bus: the status says so.
    'key-unreachable': async Prefs => {
        const window = await openWindow(Prefs);
        apply(find(window, 'payattention-ai-endpoint'), ENGINE_ONE);
        const status = find(window, 'payattention-ai-key-status');
        await waitFor(() => status.subtitle === describeKey('unavailable', true), WAIT_MS, 'status unavailable');
        step({ unreachable: status.subtitle });
    },
};

// Exits from inside a main-loop callback: ending any other way can hang or
// crash gjs (plan PG-1b, fact 1).
function finish(code, text) {
    GLib.idle_add(GLib.PRIORITY_HIGH, () => {
        print(text);
        System.exit(code);
        return GLib.SOURCE_REMOVE;
    });
}

async function main() {
    const [scenario, ...args] = System.programArgs;
    const run = SCENARIOS[scenario];
    check(run !== undefined, `unknown scenario ${scenario}`);
    const stub = GLib.getenv('PAYATTENTION_PREFS_STUB');
    check(stub !== null, 'PAYATTENTION_PREFS_STUB is set');
    Gio.Resource.load(stub)._register();
    const { default: Prefs } = await import(`file://${EXTENSION_DIR}/prefs.js`);
    Adw.init();
    await run(Prefs, args);
}

const loop = new GLib.MainLoop(null, false);
GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    main().then(() => finish(0, 'PREFS-DRIVER DONE'),
        e => finish(1, `PREFS-DRIVER FAIL ${e.message}`));
    return GLib.SOURCE_REMOVE;
});
loop.run();
