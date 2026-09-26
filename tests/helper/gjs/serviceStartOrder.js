// gjs script, not a Node test: proves SnapshotService.start() asks for the
// remote sync only after the first read has connected the clients. Uses a
// fake reader and stdout; touches no EDS. Run by snapshotService.test.js.
import GLib from 'gi://GLib';
import System from 'system';

import { SnapshotService } from '../../../extension/helper/snapshotService.js';

const CASE_MS = 500;

function check(condition, what) {
    if (!condition)
        throw new Error(`check failed: ${what}`);
}

/** A reader whose read() connects its clients after about 100 ms. */
function fakeReader() {
    const fake = {
        connected: false,
        syncCalls: [],
        read() {
            return new Promise(resolve => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    fake.connected = true;
                    resolve({ sources: [], events: [], skipped: 0 });
                    return GLib.SOURCE_REMOVE;
                });
            });
        },
        syncRemote() {
            fake.syncCalls.push(fake.connected);
            return Promise.resolve({ requested: 0, failed: 0 });
        },
    };
    return fake;
}

const stdout = { send() {} };

// Exits from inside a main-loop callback: ending any other way can hang or
// crash gjs (plan PG-1b, fact 1).
function finish(code, text) {
    (code === 0 ? print : printerr)(text);
    System.exit(code);
}

const loop = new GLib.MainLoop(null, false);
const case1 = fakeReader();
new SnapshotService({ reader: case1, stdout }).start();

GLib.timeout_add(GLib.PRIORITY_DEFAULT, CASE_MS, () => {
    try {
        check(JSON.stringify(case1.syncCalls) === '[true]',
            `start() syncs once, after the first read connected (got ${JSON.stringify(case1.syncCalls)})`);
    } catch (e) {
        finish(1, e.message);
    }
    const case2 = fakeReader();
    const service = new SnapshotService({ reader: case2, stdout });
    service.start();
    service.handleLine('{"type":"refresh","reason":"manual"}');
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, CASE_MS, () => {
        try {
            check(case2.syncCalls.at(-1) === true,
                `a refresh during the first read still ends with a sync after connect (got ${JSON.stringify(case2.syncCalls)})`);
            finish(0, 'SERVICE-START OK');
        } catch (e) {
            finish(1, e.message);
        }
        return GLib.SOURCE_REMOVE;
    });
    return GLib.SOURCE_REMOVE;
});
loop.run();
