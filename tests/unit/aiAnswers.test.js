// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    emptyAiAnswers, parseAiAnswers, serializeAiAnswers, recordAiAnswer, pruneAiAnswers,
} from '../../extension/core/aiAnswers.js';
import { T0, deepFreeze } from './support/builders.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = T0;
const K1 = 'occ:a|' + T0;
const K2 = 'occ:b|' + (T0 + 1000);
const GOOD = { fp: '0123456789abcd', verdict: 'must', reason: 'client call', at: NOW - 5000 };

const textOf = items => JSON.stringify({ v: 1, items });

// Each invalid item of test 3: its key and its value.
const INVALID = [
    ['a series key', 'series:x', GOOD],
    ['an occurrence key without a time', 'occ:a|abc', GOOD],
    ['an empty fp', K2, { ...GOOD, fp: '' }],
    ['a 65-character fp', K2, { ...GOOD, fp: 'f'.repeat(65) }],
    ['verdict MUST', K2, { ...GOOD, verdict: 'MUST' }],
    ['a reason with a newline', K2, { ...GOOD, reason: 'a\nb' }],
    ['a reason of 81 characters', K2, { ...GOOD, reason: 'r'.repeat(81) }],
    ['a reason with U+200B', K2, { ...GOOD, reason: 'a​b' }],
    ['at null', K2, { ...GOOD, at: null }],
    ['at "1"', K2, { ...GOOD, at: '1' }],
    ['an array item', K2, [GOOD]],
];

describe('aiAnswers: parse', () => {
    test('1. unreadable or unsupported text gives the empty value, frozen, never throwing', () => {
        for (const text of ['', null, undefined, '{', '[]', '{"v":2,"items":{}}', '{"v":1,"items":[]}']) {
            const a = parseAiAnswers(text);
            assert.deepEqual(a, emptyAiAnswers(), String(text));
            assert.ok(Object.isFrozen(a) && Object.isFrozen(a.items), String(text));
        }
        assert.deepEqual(emptyAiAnswers(), { v: 1, items: {} });
    });

    test('2. a valid value round-trips exactly', () => {
        const t = textOf({
            [K1]: { fp: GOOD.fp, verdict: 'must', reason: 'client call', at: NOW - 5000 },
            [K2]: { fp: 'ffff', verdict: 'ignore', reason: 'team social, optional', at: NOW },
        });
        const a = parseAiAnswers(t);
        assert.equal(serializeAiAnswers(a), t);
        assert.ok(Object.isFrozen(a.items[K1]));
    });

    for (const [what, key, value] of INVALID) {
        test(`3. an invalid item is dropped alone: ${what}`, () => {
            const a = parseAiAnswers(JSON.stringify({ v: 1, items: { [K1]: GOOD, [key]: value } }));
            assert.deepEqual(Object.keys(a.items), [K1]);
            assert.deepEqual(a.items[K1], GOOD);
        });
    }

    test('4. an extra field is dropped and the item kept with exactly its four fields', () => {
        const a = parseAiAnswers(textOf({ [K1]: { ...GOOD, joinUrl: 'https://evil.test' } }));
        assert.deepEqual(Object.keys(a.items[K1]), ['fp', 'verdict', 'reason', 'at']);
        assert.deepEqual(a.items[K1], GOOD);
    });
});

describe('aiAnswers: record', () => {
    test('5. adds, then replaces, with at = now, without mutating its input', () => {
        const empty = deepFreeze(emptyAiAnswers());
        const one = recordAiAnswer(empty, K1, { fp: 'aa', verdict: 'must', reason: 'x' }, NOW);
        assert.deepEqual(one.items[K1], { fp: 'aa', verdict: 'must', reason: 'x', at: NOW });
        assert.deepEqual(empty.items, {});
        const two = recordAiAnswer(deepFreeze(one), K1, { fp: 'bb', verdict: 'ignore', reason: 'y' }, NOW + 1);
        assert.deepEqual(two.items[K1], { fp: 'bb', verdict: 'ignore', reason: 'y', at: NOW + 1 });
        assert.deepEqual(one.items[K1].fp, 'aa');
        assert.ok(Object.isFrozen(two) && Object.isFrozen(two.items) && Object.isFrozen(two.items[K1]));
        assert.equal(serializeAiAnswers(two), serializeAiAnswers(parseAiAnswers(serializeAiAnswers(two))));
    });

    // The same rules as test 3, applied to the arguments. The value must never be in the message.
    const BAD_INPUTS = [
        ['key', 'series:x', GOOD, NOW],
        ['key', 'occ:a|abc', GOOD, NOW],
        ['fp', K1, { ...GOOD, fp: '' }, NOW],
        ['fp', K1, { ...GOOD, fp: 'f'.repeat(65) }, NOW],
        ['verdict', K1, { ...GOOD, verdict: 'MUST' }, NOW],
        ['reason', K1, { ...GOOD, reason: 'secret\nline' }, NOW],
        ['reason', K1, { ...GOOD, reason: 's'.repeat(81) }, NOW],
        ['reason', K1, { ...GOOD, reason: 'secret​mark' }, NOW],
        ['now', K1, GOOD, null],
        ['now', K1, GOOD, '1'],
    ];
    for (const [field, key, answer, now] of BAD_INPUTS) {
        test(`5. throws TypeError naming ${field}, never its value (${JSON.stringify(key)}, ${JSON.stringify(now)})`, () => {
            assert.throws(() => recordAiAnswer(emptyAiAnswers(), key, answer, now), e => {
                assert.ok(e instanceof TypeError);
                assert.ok(e.message.includes(field), e.message);
                for (const secret of ['secret', 'series:x', 'abc', 'MUST', 'fffff', 'sssss'])
                    assert.ok(!e.message.includes(secret), e.message);
                return true;
            });
        });
    }
});

describe('aiAnswers: prune', () => {
    const OLD = `occ:old|${NOW - 8 * DAY}`;
    const NEW = `occ:new|${NOW - 6 * DAY}`;

    test('6. drops entries more than the retention period past, keeps the rest', () => {
        const a = parseAiAnswers(textOf({ [OLD]: GOOD, [NEW]: GOOD }));
        const p = pruneAiAnswers(a, NOW);
        assert.deepEqual(Object.keys(p.items), [NEW]);
        assert.ok(Object.isFrozen(p) && Object.isFrozen(p.items));
    });

    test('6. returns the very same object when nothing expired', () => {
        const a = parseAiAnswers(textOf({ [NEW]: GOOD }));
        assert.equal(pruneAiAnswers(a, NOW), a);
        const e = emptyAiAnswers();
        assert.equal(pruneAiAnswers(e, NOW), e);
    });
});
