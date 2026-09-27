// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test-only writer: adds one VEVENT (argv[0]) to the FIXTURE calendar of the
// isolated EDS the test started. Never run it against a real session bus.
import GLib from 'gi://GLib';
import ECal from 'gi://ECal?version=2.0';
import EDataServer from 'gi://EDataServer?version=1.2';
import ICalGLib from 'gi://ICalGLib?version=3.0';
import System from 'system';

function exitSoon(code) {
    GLib.idle_add(GLib.PRIORITY_HIGH, () => {
        System.exit(code);
        return GLib.SOURCE_REMOVE;
    });
}

const loop = new GLib.MainLoop(null, false);
GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    try {
        const text = System.programArgs[0];
        const source = EDataServer.SourceRegistry.new_sync(null).ref_source('fixture-cal');
        const client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 0xFFFFFFFF, null);
        client.create_object_sync(ICalGLib.Component.new_from_string(text), ECal.OperationFlags.NONE, null);
        exitSoon(0);
    } catch (e) {
        printerr(`addEvent: ${e.message}`);
        exitSoon(1);
    }
    return GLib.SOURCE_REMOVE;
});
loop.run();
