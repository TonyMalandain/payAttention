// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// "Rules mode behaves exactly as today" (PG-4a): judge() output pinned by a golden
// record generated once, before AI mode was added. Never regenerate it to make a test pass.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { judge } from '../../extension/core/judge.js';
import { REASON_CODES } from '../../extension/core/verdict.js';
import { CONFIG } from './support/builders.js';
import { rulesModeCases } from './support/rulesGolden.js';

const GOLDEN_FILE = path.resolve(import.meta.dirname, '../fixtures/judged-rules-golden.json');
const GOLDEN = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));

// JSON round-trip, so the comparison is on the same plain shape the golden holds.
const plain = v => JSON.parse(JSON.stringify(v));

describe('judge: rules mode equals the golden record', () => {
    for (const c of rulesModeCases()) {
        test(`${c.name}`, () => {
            assert.ok(Object.hasOwn(GOLDEN, c.name), `no golden entry ${c.name}`);
            assert.deepEqual(plain(judge(c.snapshot, CONFIG, c.overrides, c.travel)), GOLDEN[c.name]);
        });
    }

    test('config.ai null, with an ignore answer for every golden key, is still rules mode', () => {
        for (const c of rulesModeCases()) {
            const answers = Object.fromEntries(GOLDEN[c.name].map(r => [r.key, { fp: 'f', verdict: 'ignore', reason: 'r' }]));
            assert.deepEqual(plain(judge(c.snapshot, { ...CONFIG, ai: null }, c.overrides, c.travel, answers)), GOLDEN[c.name]);
        }
    });

    test('the AI settings alone do not switch the mode: only config.ai does', () => {
        for (const c of rulesModeCases()) {
            const config = { ...CONFIG, verdictSource: 'ai', aiModel: 'm' };
            assert.deepEqual(plain(judge(c.snapshot, config, c.overrides, c.travel)), GOLDEN[c.name]);
        }
    });

    test('no golden result carries an AI field', () => {
        for (const r of Object.values(GOLDEN).flat()) {
            for (const k of ['aiAsk', 'aiStale', 'ruleReason'])
                assert.ok(!Object.hasOwn(r, k), `${r.key} has ${k}`);
        }
    });

    test('the golden covers every reason code except test', () => {
        const seen = new Set(Object.values(GOLDEN).flat().map(r => r.reasonCode));
        for (const code of REASON_CODES.filter(c => c !== 'test' && !c.startsWith('ai-')))
            assert.ok(seen.has(code), `no golden result with ${code}`);
    });
});
