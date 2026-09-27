// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// gjs script, not a Node test: after one read, emits notify::connection-status
// on each source and notify::online on its client, and prints how many times
// onChange ran for each. Run by helper.test.js against an isolated EDS only.
// Reaches into the reader's private registry and clients: the handlers are
// the behaviour under test and nothing public exposes them.
import GLib from 'gi://GLib';
import System from 'system';

import { openCalendarReader } from '../../../extension/helper/calendarReader.js';

const UIDS = ['fixture-cal', 'remote-cal'];

// Exits from inside a main-loop callback (plan PG-1b, fact 1).
function finish(code, text) {
    GLib.idle_add(GLib.PRIORITY_HIGH, () => {
        (code === 0 ? print : printerr)(text);
        System.exit(code);
        return GLib.SOURCE_REMOVE;
    });
}

async function run() {
    let calls = 0;
    const reader = await openCalendarReader({ onChange: () => calls++ });
    const now = Date.now();
    await reader.read(now - 3_600_000, now + 3_600_000);
    const counts = {};
    for (const uid of UIDS) {
        const client = reader._clients.get(uid)?.client;
        if (!client)
            throw new Error(`${uid} is not connected`);
        calls = 0;
        reader._registry.ref_source(uid).notify('connection-status');
        const source = calls;
        calls = 0;
        client.notify('online');
        counts[uid] = { source, client: calls };
    }
    return counts;
}

const loop = new GLib.MainLoop(null, false);
GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    run().then(counts => finish(0, JSON.stringify(counts)), e => finish(1, `linkHandlers: ${e.message}`));
    return GLib.SOURCE_REMOVE;
});
loop.run();
