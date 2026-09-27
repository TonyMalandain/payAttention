// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// data.md: the schema repeats DEFAULT_SETTINGS, and "a unit test keeps the two equal".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../../extension/core/defaults.js';
import { SETTINGS_KEYS, INTERNAL_KEYS } from '../../extension/shell/settingsKeys.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const SCHEMA_FILE = path.join(repoRoot, 'extension/schemas/org.gnome.shell.extensions.payattention.gschema.xml');

// data.md "Settings the owner edits", Range column.
const RANGES = {
    'online-headsup-minutes': [1, 240],
    'online-nudge-minutes': [0, 120],
    'online-insist-minutes': [0, 60],
    'online-takeover-minutes': [0, 30],
    'inperson-headsup-minutes': [1, 240],
    'inperson-nudge-minutes': [0, 120],
    'inperson-insist-minutes': [0, 60],
    'inperson-takeover-minutes': [0, 30],
    'default-travel-minutes': [0, 240],
    'headsup-display-seconds': [5, 120],
    'snooze-minutes': [1, 30],
    'takeover-snooze-minutes': [1, 10],
    'cutoff-minutes': [0, 60],
    'large-meeting-size': [2, 500],
};

// data.md "Values set from the menu and alerts" and "Internal".
const OTHER_KEYS = {
    'verdict-overrides': ['a{ss}', '{}'],
    'mode-overrides': ['a{ss}', '{}'],
    'travel-times': ['a{si}', '{}'],
    'alert-state': ['s', "''"],
    'health-data-at': ['x', '0'],
    'health-provider-at': ['x', '0'],
    'ai-verdicts': ['s', "''"],
};

const TYPE_OF_KIND = { int: 'i', bool: 'b', strv: 'as', str: 's' };

/** Every <key> of the schema: name → {type, default, range}. */
function readSchema() {
    const xml = fs.readFileSync(SCHEMA_FILE, 'utf8');
    const keys = new Map();
    for (const m of xml.matchAll(/<key\s+name="([^"]+)"\s+type="([^"]+)"\s*>([\s\S]*?)<\/key>/g)) {
        const [, name, type, body] = m;
        const def = body.match(/<default>([\s\S]*?)<\/default>/)?.[1].trim() ?? null;
        const range = body.match(/<range\s+min="(-?\d+)"\s+max="(-?\d+)"\s*\/>/);
        keys.set(name, { type, default: def, range: range ? [Number(range[1]), Number(range[2])] : null });
    }
    return keys;
}

function parseDefault(kind, text) {
    if (kind === 'int')
        return Number(text);
    if (kind === 'bool')
        return text === 'true' ? true : text === 'false' ? false : text;
    if (kind === 'str')
        return text.replace(/^'(.*)'$/s, '$1');
    return text === '[]' ? [] : text;
}

describe('schema equals DEFAULT_SETTINGS and data.md', () => {
    const schema = readSchema();

    test('the schema id and path', () => {
        const xml = fs.readFileSync(SCHEMA_FILE, 'utf8');
        assert.match(xml, /<schema\s+id="org\.gnome\.shell\.extensions\.payattention"\s+path="\/org\/gnome\/shell\/extensions\/payattention\/"/);
    });

    for (const { field, key, kind } of SETTINGS_KEYS) {
        test(`${key}: exists, has the right type, and defaults to DEFAULT_SETTINGS.${field}`, () => {
            const k = schema.get(key);
            assert.ok(k, `no key ${key}`);
            assert.equal(k.type, TYPE_OF_KIND[kind]);
            const def = DEFAULT_SETTINGS[field];
            assert.deepEqual(parseDefault(kind, k.default), Array.isArray(def) ? [...def] : def);
        });
    }

    for (const [key, [min, max]] of Object.entries(RANGES)) {
        test(`${key}: range ${min}–${max} contains its default`, () => {
            const k = schema.get(key);
            assert.ok(k, `no key ${key}`);
            assert.deepEqual(k.range, [min, max]);
            const def = Number(k.default);
            assert.ok(def >= min && def <= max, `default ${def} outside ${min}–${max}`);
        });
    }

    test('every integer key has a range', () => {
        const ints = [...schema].filter(([, k]) => k.type === 'i').map(([name]) => name).sort();
        assert.deepEqual(ints, Object.keys(RANGES).sort());
    });

    for (const [key, [type, def]] of Object.entries(OTHER_KEYS)) {
        test(`${key}: ${type} defaulting to ${def}`, () => {
            const k = schema.get(key);
            assert.ok(k, `no key ${key}`);
            assert.equal(k.type, type);
            assert.equal(k.default, def);
        });
    }

    test('there are no other keys', () => {
        const expected = [...SETTINGS_KEYS.map(k => k.key), ...Object.keys(OTHER_KEYS)].sort();
        assert.deepEqual([...schema.keys()].sort(), expected);
    });

    test('verdict-source: exactly the choices rules and ai, and its default is one of them', () => {
        const xml = fs.readFileSync(SCHEMA_FILE, 'utf8');
        const body = xml.match(/<key\s+name="verdict-source"[\s\S]*?<\/key>/)?.[0];
        assert.ok(body, 'no key verdict-source');
        const choices = [...body.matchAll(/<choice\s+value="([^"]*)"\s*\/>/g)].map(m => m[1]);
        assert.deepEqual(choices, ['rules', 'ai']);
        assert.ok(choices.includes(parseDefault('str', schema.get('verdict-source').default)));
    });

    test('every key has a summary', () => {
        const xml = fs.readFileSync(SCHEMA_FILE, 'utf8');
        for (const m of xml.matchAll(/<key\s+name="([^"]+)"[\s\S]*?<\/key>/g))
            assert.match(m[0], /<summary>[^<]+<\/summary>/, `${m[1]} has no summary`);
    });
});

describe('settings keys', () => {
    test('one entry per DEFAULT_SETTINGS field, in its order', () => {
        assert.deepEqual(SETTINGS_KEYS.map(k => k.field), Object.keys(DEFAULT_SETTINGS));
    });

    test('field names map to key names', () => {
        const byField = Object.fromEntries(SETTINGS_KEYS.map(k => [k.field, k]));
        assert.equal(byField.inpersonTakeoverMinutes.key, 'inperson-takeover-minutes');
        assert.equal(byField.onlineHeadsupMinutes.key, 'online-headsup-minutes');
        assert.deepEqual(byField.extraOwnerAddresses, { field: 'extraOwnerAddresses', key: 'extra-owner-addresses', kind: 'strv' });
        assert.equal(byField.soundEnabled.kind, 'bool');
        assert.equal(byField.cutoffMinutes.kind, 'int');
        assert.deepEqual(byField.verdictSource, { field: 'verdictSource', key: 'verdict-source', kind: 'str' });
        assert.equal(byField.aiModel.kind, 'str');
    });

    test('frozen', () => {
        assert.ok(Object.isFrozen(SETTINGS_KEYS));
        assert.ok(SETTINGS_KEYS.every(k => Object.isFrozen(k)));
    });

    test('the internal keys', () => {
        assert.deepEqual(INTERNAL_KEYS, ['alert-state', 'health-data-at', 'health-provider-at', 'ai-verdicts']);
        assert.ok(Object.isFrozen(INTERNAL_KEYS));
    });
});
