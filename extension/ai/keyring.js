// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Reading the engine key for one endpoint (ADR-0009), without ever prompting.
// Secret.password_lookup cannot tell a locked item from a missing one, so this
// searches without SearchFlags.UNLOCK: locked, absent and found stay distinct.
import Secret from 'gi://Secret';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ENGINE_KEY_SCHEMA_NAME, ENGINE_KEY_ATTRIBUTE } from '../core/aiEngine.js';

/** A lookup that has not finished in this time is treated as unavailable. */
export const KEY_LOOKUP_TIMEOUT_MS = 5000;

/** The engine key schema; its one attribute holds normaliseEndpoint(endpoint). */
export const ENGINE_KEY_SCHEMA = new Secret.Schema(ENGINE_KEY_SCHEMA_NAME, Secret.SchemaFlags.NONE,
    { [ENGINE_KEY_ATTRIBUTE]: Secret.SchemaAttributeType.STRING });

const UNAVAILABLE = Object.freeze({ state: 'unavailable' });
const ABSENT = Object.freeze({ state: 'absent' });

/** @returns {import('./service.js').KeyLookup} */
function readItems(items) {
    if (items.length === 0)
        return ABSENT;
    const item = items.find(i => !i.get_locked());
    if (item === undefined)
        return UNAVAILABLE;
    const text = item.get_secret()?.get_text() ?? null;
    return text === null ? UNAVAILABLE : { state: 'found', key: text };
}

/**
 * The saved key for this endpoint. Never prompts (no SearchFlags.UNLOCK). Never rejects.
 *   Secret.Service.get(OPEN_SESSION) fails, the search fails, or the timeout passes -> {state:'unavailable'}
 *   no matching item                                                              -> {state:'absent'}
 *   an unlocked matching item whose secret reads as text                          -> {state:'found', key}
 *   only locked matching items, or a secret that is not text                      -> {state:'unavailable'}
 * With several unlocked items, the first one returned wins.
 *
 * @param {string} endpoint normalised
 * @returns {Promise<import('./service.js').KeyLookup>}
 */
export function lookupKey(endpoint) {
    return new Promise(resolve => {
        const cancellable = new Gio.Cancellable();
        let settled = false;
        let timerId = 0;
        const done = result => {
            if (settled)
                return;
            settled = true;
            if (timerId !== 0) {
                GLib.source_remove(timerId);
                timerId = 0;
            }
            resolve(result);
        };
        timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, KEY_LOOKUP_TIMEOUT_MS, () => {
            timerId = 0;
            cancellable.cancel();
            done(UNAVAILABLE);
            return GLib.SOURCE_REMOVE;
        });

        // Every failure is "unavailable": the error itself is never kept, it could name the endpoint.
        try {
            Secret.Service.get(Secret.ServiceFlags.OPEN_SESSION, cancellable, (_o, res) => {
                try {
                    const service = Secret.Service.get_finish(res);
                    service.search(ENGINE_KEY_SCHEMA, { [ENGINE_KEY_ATTRIBUTE]: endpoint },
                        Secret.SearchFlags.ALL | Secret.SearchFlags.LOAD_SECRETS, cancellable, (_s, searchRes) => {
                            try {
                                done(readItems(service.search_finish(searchRes)));
                            } catch {
                                done(UNAVAILABLE);
                            }
                        });
                } catch {
                    done(UNAVAILABLE);
                }
            });
        } catch {
            done(UNAVAILABLE);
        }
    });
}
