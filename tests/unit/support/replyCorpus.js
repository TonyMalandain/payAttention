// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// parseReply corpus: engine replies and what core accepts from each. Not a test
// file. Shared with the AI helper's fake-engine tests (Layer 2b, PG-4b).

const ok = (verdict, reason) => ({ verdict, reason });

/** @type {{name:string, text:*, expected:{verdict:string, reason:string}|null}[]} */
export const REPLY_CORPUS = [
    { name: 'plain JSON', text: '{"verdict":"must","reason":"client call"}', expected: ok('must', 'client call') },
    { name: 'leading whitespace', text: '\n  {"verdict":"ignore","reason":"a hold"}  ', expected: ok('ignore', 'a hold') },
    { name: 'a think block', text: '<think>hmm, a client\n{"verdict":"ignore"}</think>\n{"verdict":"must","reason":"r"}',
        expected: ok('must', 'r') },
    { name: 'an unterminated think block', text: '<think>{"verdict":"must","reason":"r"}', expected: null },
    { name: 'a json fence', text: '```json\n{"verdict":"ignore","reason":"r"}\n```', expected: ok('ignore', 'r') },
    { name: 'a fence without a language', text: '```\n{"verdict":"must","reason":"r"}\n```', expected: ok('must', 'r') },
    { name: 'a think block then a fence', text: '<think>x</think>\n```json\n{"verdict":"ignore","reason":"r"}\n```',
        expected: ok('ignore', 'r') },
    { name: 'an unterminated fence', text: '```json\n{"verdict":"must","reason":"r"}', expected: null },
    { name: 'two objects', text: '{"verdict":"must","reason":"r"}{"verdict":"ignore","reason":"r"}', expected: null },
    { name: 'an array', text: '[{"verdict":"must","reason":"r"}]', expected: null },
    { name: 'null', text: 'null', expected: null },
    { name: 'upper-case MUST', text: '{"verdict":"MUST","reason":"r"}', expected: null },
    { name: 'a bare string', text: '"must"', expected: null },
    { name: 'a missing reason', text: '{"verdict":"must"}', expected: null },
    { name: 'a numeric reason', text: '{"verdict":"must","reason":5}', expected: null },
    { name: 'an empty reason', text: '{"verdict":"must","reason":""}', expected: null },
    { name: 'extra keys are never read',
        text: '{"verdict":"ignore","reason":"r","joinUrl":"https://evil.example.test","mode":"in-person","deadline":0}',
        expected: ok('ignore', 'r') },
    { name: 'a 10 000-character reason is capped', text: JSON.stringify({ verdict: 'must', reason: 'y'.repeat(10000) }),
        expected: ok('must', 'y'.repeat(79) + '…') },
    { name: 'a reason with a newline and a bidi override is cleaned',
        text: JSON.stringify({ verdict: 'must', reason: 'line one\nline\u202E two' }), expected: ok('must', 'line one line two') },
    { name: 'markup is kept as plain text', text: '{"verdict":"must","reason":"<b>boss</b>"}', expected: ok('must', '<b>boss</b>') },
    { name: 'over 65 536 characters', text: JSON.stringify({ verdict: 'must', reason: 'r', pad: 'p'.repeat(65536) }),
        expected: null },
    { name: 'not a string', text: { verdict: 'must', reason: 'r' }, expected: null },
    { name: 'a verdict only through __proto__', text: '{"__proto__":{"verdict":"must"},"reason":"r"}', expected: null },
];
