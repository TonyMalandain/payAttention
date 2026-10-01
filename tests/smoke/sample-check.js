// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Automation script for the sample shell's headless check (scripts/sample.sh
// --check), run by the shell's ui/scripting.js harness. Prints
// PAYATTENTION-SAMPLE PASS, or PAYATTENTION-SAMPLE FAIL <check>: <reason> at the
// first failed check. Never prints calendar titles other than the fixture's own.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { CheckFailed, check, mustWait, findByName, findAll } from './stage.js';

// The UUID has one source: extension/metadata.json (PG-10).
const UUID = JSON.parse(new TextDecoder().decode(Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
    .get_child('extension').get_child('metadata.json').load_contents(null)[1])).uuid;
const ACTIVE = 1;
const FIXTURE_TITLE = 'Client site visit';

async function runChecks() {
    // 0. Isolation: never the owner's config, data or home.
    const home = GLib.getenv('PAYATTENTION_SAMPLE_HOME') ?? '';
    check(home !== '', '0-isolation', 'PAYATTENTION_SAMPLE_HOME is not set');
    check(GLib.get_user_config_dir() === `${home}/config`, '0-isolation', 'the config dir is not the sample home');
    check(GLib.get_user_data_dir() === `${home}/data`, '0-isolation', 'the data dir is not the sample home');
    check(GLib.get_home_dir() === `${home}/home`, '0-isolation', 'the home dir is not the sample home');

    // 1. The extension is active.
    const ext = await mustWait(() => {
        const e = Main.extensionManager.lookup(UUID);
        return e?.state === ACTIVE ? e : null;
    }, 10000, '1-active', `state ${Main.extensionManager.lookup(UUID)?.state}`);
    check(!ext.error, '1-active', `extension error: ${ext.error}`);

    // 2. The in-person heads-up is due at start: its travel line and its button are shown.
    //    60 s: the helper's first snapshot comes first.
    await mustWait(() => {
        const text = findByName(global.stage, 'payattention-travel-text');
        const change = findByName(global.stage, 'payattention-travel-change');
        return text?.mapped && text.text === 'Travel: 30 min (default)' && change?.mapped;
    }, 60000, '2-heads-up', 'no heads-up with "Travel: 30 min (default)" and a mapped Change time link');

    // 3. The menu row of the fixture expands to the seven travel choices.
    const indicator = Main.panel.statusArea.payattention;
    check(indicator, '3-menu', 'the indicator is not in the panel');
    try {
        indicator.menu.open(false);
        const row = await mustWait(() => findAll(indicator.menu.actor, a => a instanceof PopupMenu.PopupSubMenuMenuItem &&
            a.label.text.endsWith(FIXTURE_TITLE))[0], 3000, '3-menu', `no menu row for "${FIXTURE_TITLE}"`);
        row.setSubmenuShown(true);
        await mustWait(() => findAll(row.menu.actor, a => a instanceof PopupMenu.PopupMenuItem &&
            /^\d+ min$/.test(a.label?.text ?? '')).length === 7, 3000, '3-menu', 'the row does not hold seven travel choices');

        // 3b. The sample turns show-test-alert on (a viewing aid, Layer 3b), so the menu offers Test alert.
        const testAlert = findByName(indicator.menu.actor, 'payattention-menu-test-alert');
        check(testAlert?.visible && testAlert.label.text === 'Test alert', '3b-test-alert', 'the sample menu does not offer Test alert');
    } finally {
        indicator.menu.close(false);
    }

    // 4. Private bus: the shell's bus is the one isolated_run wrote, and can start only its allowlist
    //    (tests/smoke/isolation-check.sh proves the allowlist has no keyring).
    check(GLib.getenv('PAYATTENTION_ISOLATED_HOME') === home, '4-private-bus', 'the shell was not started by isolated_run');
    const address = GLib.getenv('DBUS_SESSION_BUS_ADDRESS') ?? '';
    check(address !== '' && address !== `unix:path=${GLib.get_user_runtime_dir()}/bus`, '4-private-bus',
        'the shell is not on a private session bus');
    const expected = new Set();
    try {
        const children = Gio.File.new_for_path(`${home}/bus/services`)
            .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info = children.next_file(null); info; info = children.next_file(null)) {
            const name = info.get_name();
            if (name.endsWith('.service'))
                expected.add(name.slice(0, -'.service'.length));
        }
        children.close(null);
    } catch (e) {
        check(false, '4-private-bus', `${home}/bus/services is missing (${e.message})`);
    }
    check(expected.size > 0, '4-private-bus', `${home}/bus/services is empty`);
    // Listing activatable names starts nothing.
    const [listed] = Gio.DBus.session.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
        'ListActivatableNames', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, null).deepUnpack();
    const actual = new Set(listed.filter(n => n !== 'org.freedesktop.DBus'));
    const extra = [...actual].filter(n => !expected.has(n));
    const missing = [...expected].filter(n => !actual.has(n));
    check(extra.length === 0 && missing.length === 0, '4-private-bus',
        `the bus can start other names than ${home}/bus/services: extra [${extra.join(', ')}], missing [${missing.join(', ')}]`);
}

export async function run() {
    try {
        await runChecks();
        print('PAYATTENTION-SAMPLE PASS');
    } catch (e) {
        if (e instanceof CheckFailed)
            print(`PAYATTENTION-SAMPLE FAIL ${e.message}`);
        else
            print(`PAYATTENTION-SAMPLE FAIL script-error: ${e}\n${e.stack}`);
    }
}

export function finish() {
}
