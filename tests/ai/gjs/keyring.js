// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test-only keyring tool for a throwaway keyring: it stores, locks and counts
// items. Used by tests/ai/session.js and by tests/smoke/uninstall-check.sh, each
// on its own private bus and home. Never run it against a real session bus.
//
//   gjs -m keyring.js store <endpoint> <key>   saves a key under the engine key schema
//   gjs -m keyring.js lock                     locks every collection
//   gjs -m keyring.js store-other <endpoint> <key>
//                                              saves a key under OTHER_SCHEMA, same attribute
//   gjs -m keyring.js count                    prints KEYRING COUNT <ours> <other>: items of the
//                                              engine key schema and of OTHER_SCHEMA, locked ones
//                                              included, secrets never loaded
//
// Prints KEYRING OK (or the count) and exits 0, or prints the error and exits 1.
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';
import System from 'system';
import { ENGINE_KEY_SCHEMA } from '../../../extension/ai/keyring.js';
import { ENGINE_KEY_ATTRIBUTE } from '../../../extension/core/aiEngine.js';

/** Another application's schema with the same attribute: uninstall --purge must leave it alone. */
const OTHER_SCHEMA = new Secret.Schema('org.example.payattention-test.Other', Secret.SchemaFlags.NONE,
    { [ENGINE_KEY_ATTRIBUTE]: Secret.SchemaAttributeType.STRING });

// Exits from inside a main-loop callback: ending any other way can hang or
// crash gjs (plan PG-1b, fact 1).
function finish(code, text) {
    GLib.idle_add(GLib.PRIORITY_HIGH, () => {
        (code === 0 ? print : printerr)(text);
        System.exit(code);
        return GLib.SOURCE_REMOVE;
    });
}

function store(schema, endpoint, key) {
    Secret.password_store(schema, { [ENGINE_KEY_ATTRIBUTE]: endpoint }, Secret.COLLECTION_DEFAULT,
        'payAttention test key', key, null, (_o, res) => {
            try {
                Secret.password_store_finish(res);
                finish(0, 'KEYRING OK');
            } catch (e) {
                finish(1, `store failed: ${e.message}`);
            }
        });
}

function count() {
    Secret.Service.get(Secret.ServiceFlags.NONE, null, (_o, res) => {
        try {
            const service = Secret.Service.get_finish(res);
            const ours = service.search_sync(ENGINE_KEY_SCHEMA, {}, Secret.SearchFlags.ALL, null).length;
            const other = service.search_sync(OTHER_SCHEMA, {}, Secret.SearchFlags.ALL, null).length;
            finish(0, `KEYRING COUNT ${ours} ${other}`);
        } catch (e) {
            finish(1, `count failed: ${e.message}`);
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
        store(ENGINE_KEY_SCHEMA, rest[0], rest[1]);
    else if (command === 'store-other' && rest.length === 2)
        store(OTHER_SCHEMA, rest[0], rest[1]);
    else if (command === 'lock' && rest.length === 0)
        lock();
    else if (command === 'count' && rest.length === 0)
        count();
    else
        finish(1, 'usage: keyring.js store <endpoint> <key> | store-other <endpoint> <key> | lock | count');
    return GLib.SOURCE_REMOVE;
});
loop.run();
