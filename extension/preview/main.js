// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The preview's entry point (ADR-0012, interfaces.md §7.3): shows what payAttention
// would decide, from a terminal, and changes nothing. Composition only, like
// extension.js; it is the only place that ends the process.
//
//   gjs -m <install dir>/preview/main.js [--json]
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import System from 'system';

import { StoreReader } from '../shell/store.js';
import { CalendarFeed } from '../shell/calendarFeed.js';
import { AiHelperClient } from '../shell/aiHelperClient.js';
import { Ticker } from '../shell/ticker.js';
import {
    EXIT, STOP_SIGNALS, NOT_INSTALLED_TEXT, USAGE, signalExitCode, parseArgs, internalErrorText,
} from './cli.js';
import { startPreview } from './session.js';

const extensionDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();

/**
 * The only way the process ends. Deferred to a main-loop source, as in the
 * helper: System.exit from a callback chain hangs, and ending without it
 * segfaults (testing-and-build.md).
 */
function exitSoon(code) {
    GLib.idle_add(GLib.PRIORITY_HIGH, () => {
        System.exit(code);
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * The installed extension's settings, already in delay-apply mode, so nothing
 * the preview does can reach the backend (apply() is never called).
 *
 * @param {string} dir the extension's install directory
 * @returns {Gio.Settings|null} null when the metadata or the compiled schema is missing or unreadable
 */
function openInstalledSettings(dir) {
    try {
        const [, bytes] = Gio.File.new_for_path(`${dir}/metadata.json`).load_contents(null);
        const id = JSON.parse(new TextDecoder().decode(bytes))['settings-schema'];
        if (typeof id !== 'string')
            return null;
        const source = Gio.SettingsSchemaSource.new_from_directory(
            `${dir}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup(id, false);
        if (schema === null)
            return null;
        const settings = new Gio.Settings({ settings_schema: schema });
        settings.delay();
        return settings;
    } catch {
        // A missing file, bad JSON or a GLib.Error all mean the same to the owner: not installed.
        return null;
    }
}

function main() {
    const args = parseArgs(System.programArgs);
    if (args.help) {
        print(USAGE);
        exitSoon(EXIT.printed);
        return;
    }
    if (args.usageError) {
        printerr(USAGE);
        exitSoon(EXIT.error);
        return;
    }
    const settings = openInstalledSettings(extensionDir);
    if (settings === null) {
        printerr(NOT_INSTALLED_TEXT);
        exitSoon(EXIT.notInstalled);
        return;
    }

    let run = null;
    // Before startPreview, so a Ctrl-C during start-up is handled too.
    for (const signum of STOP_SIGNALS) {
        GLibUnix.signal_add(GLib.PRIORITY_HIGH, signum, () => {
            run?.stop();
            exitSoon(signalExitCode(signum));
            return GLib.SOURCE_REMOVE;
        });
    }

    try {
        run = startPreview({
            format: args.format,
            createStoreReader: onChange => new StoreReader(settings, onChange),
            createFeed: onUpdate => new CalendarFeed({
                argv: ['gjs', '-m', `${extensionDir}/helper/main.js`], onUpdate, now: () => Date.now(),
            }),
            createAiClient: engine => new AiHelperClient({
                argv: ['gjs', '-m', `${extensionDir}/ai/main.js`], engine, now: () => Date.now(),
            }),
            createTicker: onTick => new Ticker(1000, onTick),
            progress: line => printerr(line),
            onFinish: outcome => {
                if (outcome.stdout)
                    print(outcome.stdout);
                if (outcome.stderr)
                    printerr(outcome.stderr);
                exitSoon(outcome.code);
            },
            now: () => Date.now(),
        });
    } catch (e) {
        printerr(internalErrorText(e));
        exitSoon(EXIT.error);
    }
}

GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    main();
    return GLib.SOURCE_REMOVE;
});
new GLib.MainLoop(null, false).run();
