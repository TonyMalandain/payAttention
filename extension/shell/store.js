// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Typed read and write of the GSettings schema (data.md), as two facets:
// StoreReader (reads only; the verdict component's, and the preview's only) and
// StoreWriter (the alert front end's). The only GSettings code in the shell
// process.
import GLib from 'gi://GLib';

import { parseAlertState, serializeAlertState } from '../core/alertState.js';
import { parseAiAnswers, serializeAiAnswers } from '../core/aiAnswers.js';
import { isExpiredOccurrenceKey } from '../core/keys.js';
import { SETTINGS_KEYS, INTERNAL_KEYS } from './settingsKeys.js';

// A burst of writes to one key is one write (data.md).
const FLUSH_DELAY_MS = 500;

const READERS = {
    int: (settings, key) => settings.get_int(key),
    bool: (settings, key) => settings.get_boolean(key),
    strv: (settings, key) => settings.get_strv(key),
    str: (settings, key) => settings.get_string(key),
};

/** @returns {object} the dictionary stored at key, unpacked */
function readDict(settings, key) {
    return settings.get_value(key).recursiveUnpack();
}

export class StoreReader {
    #settings;

    /**
     * The store's reader facet: reads only. It holds the Gio.Settings in a
     * private field, so no caller can reach it and write.
     *
     * @param {import('gi://Gio').default.Settings} settings the extension's settings
     * @param {() => void} onChange called when an owner setting or override changes; never for INTERNAL_KEYS
     */
    constructor(settings, onChange) {
        this.#settings = settings;
        settings.connectObject('changed', (_s, key) => {
            if (!INTERNAL_KEYS.includes(key))
                onChange();
        }, this);
    }

    /** @returns {import('../core/types.js').Settings} */
    readSettings() {
        const out = {};
        for (const { field, key, kind } of SETTINGS_KEYS)
            out[field] = READERS[kind](this.#settings, key);
        return out;
    }

    /** @returns {import('../core/types.js').Overrides} */
    readOverrides() {
        return { verdict: readDict(this.#settings, 'verdict-overrides'), mode: readDict(this.#settings, 'mode-overrides') };
    }

    /** @returns {import('../core/types.js').TravelTimes} */
    readTravel() {
        return readDict(this.#settings, 'travel-times');
    }

    /**
     * The stored AI answers. A corrupt or partly invalid value is logged once
     * ('payattention: ai-verdicts-corrupt') and read as what could be kept.
     *
     * @returns {import('../core/types.js').StoredAiAnswers}
     */
    readAiAnswers() {
        const text = this.#settings.get_string('ai-verdicts');
        const answers = parseAiAnswers(text);
        if (text !== '' && serializeAiAnswers(answers) !== text)
            console.warn('payattention: ai-verdicts-corrupt');
        return answers;
    }

    /** Disconnects the change signal. Idempotent. */
    destroy() {
        if (!this.#settings)
            return;
        this.#settings.disconnectObject(this);
        this.#settings = null;
    }
}

export class StoreWriter {
    #settings;
    // GSettings key → {pending: string|null, lastWritten: string|null, flushId: number}
    #coalesced = new Map();

    /**
     * The store's writer facet: the alert front end's own state, and the owner's
     * choices it records. Never connects to 'changed'.
     *
     * @param {import('gi://Gio').default.Settings} settings the extension's settings
     */
    constructor(settings) {
        this.#settings = settings;
        // Writing back the stored answers is then a no-op, as when one object read and wrote them.
        this.#entry('ai-verdicts').lastWritten = settings.get_string('ai-verdicts');
    }

    /**
     * The stored alert state. A corrupt or partly invalid value is logged once
     * and read as what could be kept (possibly empty): acknowledged meetings may
     * alert again, which is the safe failure (data.md).
     *
     * @returns {import('../core/types.js').AlertState}
     */
    readAlertState() {
        const text = this.#settings.get_string('alert-state');
        const state = parseAlertState(text);
        if (text !== '' && serializeAlertState(state) !== text)
            console.warn('payattention: alert-state-corrupt');
        this.#entry('alert-state').lastWritten = text;
        return state;
    }

    /**
     * Store the alert state, coalesced: written FLUSH_DELAY_MS after the
     * first of a burst, or at destroy().
     *
     * @param {import('../core/types.js').AlertState} state
     */
    writeAlertState(state) {
        this.#writeCoalesced('alert-state', serializeAlertState(state));
    }

    /**
     * Store the AI answers, coalesced exactly like writeAlertState: written
     * FLUSH_DELAY_MS after the first of a burst, or at destroy(). Writing the
     * text already stored does nothing.
     *
     * @param {import('../core/types.js').StoredAiAnswers} answers
     */
    writeAiAnswers(answers) {
        this.#writeCoalesced('ai-verdicts', serializeAiAnswers(answers));
    }

    /** @returns {{dataAt: number|null, providerAt: number|null}} a stored 0 reads as null (unknown) */
    readHealthSeeds() {
        const read = key => this.#settings.get_int64(key) || null;
        return { dataAt: read('health-data-at'), providerAt: read('health-provider-at') };
    }

    /**
     * Persist the freshness clocks. Called once per disable(), never per tick.
     *
     * @param {{dataAt: number, providerAt: number}} clocks epoch ms; 0 = unknown
     */
    writeHealthClocks({ dataAt, providerAt }) {
        this.#settings.set_int64('health-data-at', dataAt);
        this.#settings.set_int64('health-provider-at', providerAt);
    }

    /**
     * @param {string} key an occurrence or series key
     * @param {'must'|'ignore'|null} verdict null removes the override
     */
    setVerdictOverride(key, verdict) {
        this.#setDictEntry('verdict-overrides', 'a{ss}', key, verdict);
    }

    /**
     * @param {string} key an occurrence or series key
     * @param {'online'|'in-person'|null} mode null removes the override
     */
    setModeOverride(key, mode) {
        this.#setDictEntry('mode-overrides', 'a{ss}', key, mode);
    }

    /**
     * @param {string} placeKey
     * @param {number} minutes
     */
    setTravel(placeKey, minutes) {
        this.#setDictEntry('travel-times', 'a{si}', placeKey, minutes);
    }

    /**
     * Remove occurrence overrides more than the retention period old (data.md "Pruning").
     *
     * @param {number} now
     */
    pruneOccurrenceOverrides(now) {
        for (const [key, type] of [['verdict-overrides', 'a{ss}'], ['mode-overrides', 'a{ss}']]) {
            const dict = readDict(this.#settings, key);
            const expired = Object.keys(dict).filter(k => isExpiredOccurrenceKey(k, now));
            if (expired.length === 0)
                continue;
            for (const k of expired)
                delete dict[k];
            this.#settings.set_value(key, new GLib.Variant(type, dict));
        }
    }

    /** Flushes every pending coalesced write. Idempotent. */
    destroy() {
        if (!this.#settings)
            return;
        for (const [key, entry] of this.#coalesced) {
            if (entry.flushId) {
                GLib.Source.remove(entry.flushId);
                entry.flushId = 0;
            }
            this.#flushKey(key);
        }
        this.#settings = null;
    }

    #entry(key) {
        let entry = this.#coalesced.get(key);
        if (!entry) {
            entry = { pending: null, lastWritten: null, flushId: 0 };
            this.#coalesced.set(key, entry);
        }
        return entry;
    }

    /** The first write of a burst arms one timeout; later writes replace what is pending. */
    #writeCoalesced(key, text) {
        const entry = this.#entry(key);
        entry.pending = text;
        if (entry.flushId)
            return;
        entry.flushId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FLUSH_DELAY_MS, () => {
            entry.flushId = 0;
            this.#flushKey(key);
            return GLib.SOURCE_REMOVE;
        });
    }

    #flushKey(key) {
        const entry = this.#entry(key);
        if (entry.pending !== null && entry.pending !== entry.lastWritten) {
            this.#settings.set_string(key, entry.pending);
            entry.lastWritten = entry.pending;
        }
        entry.pending = null;
    }

    #setDictEntry(key, type, entry, value) {
        const dict = readDict(this.#settings, key);
        const has = Object.hasOwn(dict, entry);
        if (value === null ? !has : has && dict[entry] === value)
            return;
        if (value === null)
            delete dict[entry];
        else
            dict[entry] = value;
        this.#settings.set_value(key, new GLib.Variant(type, dict));
    }
}
