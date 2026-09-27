// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test-only keyring writer for the throwaway keyring of tests/ai/session.js.
// Never run it against a real session bus.
//
//   gjs -m keyring.js store <endpoint> <key>   saves a key under the engine key schema
//   gjs -m keyring.js lock                     locks every collection
//
// Prints KEYRING OK and exits 0, or prints the error and exits 1.
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';
import System from 'system';
import { ENGINE_KEY_SCHEMA } from '../../../extension/ai/keyring.js';
import { ENGINE_KEY_ATTRIBUTE } from '../../../extension/core/aiEngine.js';

// Exits from inside a main-loop callback: ending any other way can hang or
// crash gjs (plan PG-1b, fact 1).
function finish(code, text) {
    GLib.idle_add(GLib.PRIORITY_HIGH, () => {
        (code === 0 ? print : printerr)(text);
        System.exit(code);
        return GLib.SOURCE_REMOVE;
    });
}

function store(endpoint, key) {
    Secret.password_store(ENGINE_KEY_SCHEMA, { [ENGINE_KEY_ATTRIBUTE]: endpoint }, Secret.COLLECTION_DEFAULT,
        'payAttention test key', key, null, (_o, res) => {
            try {
                Secret.password_store_finish(res);
                finish(0, 'KEYRING OK');
            } catch (e) {
                finish(1, `store failed: ${e.message}`);
            }
        });
}

function lock() {
    Secret.Service.get(Secret.ServiceFlags.LOAD_COLLECTIONS, null, (_o, res) => {
        try {
            const service = Secret.Service.get_finish(res);
            service.lock(service.get_collections(), null, (_s, lockRes) => {
                try {
                    service.lock_finish(lockRes);
                    finish(0, 'KEYRING OK');
                } catch (e) {
                    finish(1, `lock failed: ${e.message}`);
                }
            });
        } catch (e) {
            finish(1, `lock failed: ${e.message}`);
        }
    });
}

const loop = new GLib.MainLoop(null, false);
const [command, ...rest] = System.programArgs;
GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    if (command === 'store' && rest.length === 2)
        store(rest[0], rest[1]);
    else if (command === 'lock' && rest.length === 0)
        lock();
    else
        finish(1, 'usage: keyring.js store <endpoint> <key> | lock');
    return GLib.SOURCE_REMOVE;
});
loop.run();
