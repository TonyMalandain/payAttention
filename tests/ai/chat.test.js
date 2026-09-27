// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// What the AI helper sends and what an engine's answer means (interfaces.md §6.7,
// §6.8). Pure: no network, no keyring.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_TOKENS, MAX_KEY_LENGTH, chatUrl, chatRequestBody, bearerFrom, readChatResponse,
} from '../../extension/ai/chat.js';
import { SYSTEM_PROMPT, REPLY_JSON_SCHEMA, PROBE_INVITE } from '../../extension/core/aiPrompt.js';
import { REPLY_CORPUS } from '../unit/support/replyCorpus.js';

const envelope = content => JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
const ok200 = body => ({ status: 200, retryAfter: null, body });
const VERDICT_BODY = envelope('{"verdict":"must","reason":"client call"}');

describe('chatUrl', () => {
    test('appends /chat/completions to the normalised endpoint', () => {
        assert.equal(chatUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1/chat/completions');
    });
});

describe('chatRequestBody', () => {
    test('with response_format: exactly the §6.7 keys, in order', () => {
        const body = JSON.parse(chatRequestBody('m1', PROBE_INVITE, true));
        assert.deepEqual(Object.keys(body), ['model', 'messages', 'temperature', 'max_tokens', 'response_format']);
        assert.equal(body.model, 'm1');
        assert.equal(body.messages.length, 2);
        assert.deepEqual(body.messages[0], { role: 'system', content: SYSTEM_PROMPT });
        assert.deepEqual(body.messages[1], { role: 'user', content: JSON.stringify(PROBE_INVITE) });
        assert.equal(body.temperature, 0);
        assert.equal(body.max_tokens, 400);
        assert.equal(MAX_TOKENS, 400);
        assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: REPLY_JSON_SCHEMA });
        for (const key of ['tools', 'functions', 'tool_choice', 'stream'])
            assert.equal(Object.hasOwn(body, key), false, key);
    });

    test('without response_format: the same body minus that one key', () => {
        const withFormat = JSON.parse(chatRequestBody('m1', PROBE_INVITE, true));
        const withoutText = chatRequestBody('m1', PROBE_INVITE, false);
        const without = JSON.parse(withoutText);
        assert.deepEqual(Object.keys(without), ['model', 'messages', 'temperature', 'max_tokens']);
        delete withFormat.response_format;
        assert.equal(withoutText, JSON.stringify(withFormat));
    });
});

describe('bearerFrom', () => {
    const found = key => ({ state: 'found', key });

    test('a found visible-ASCII key is the bearer', () => {
        assert.deepEqual(bearerFrom(found('sk-test')), { bearer: 'sk-test' });
    });

    test('an empty key is a keyless engine', () => {
        assert.deepEqual(bearerFrom(found('')), { bearer: null });
    });

    test('a key that could split a header, or is too long, is config and never sent', () => {
        for (const key of ['a b', 'a\nb', 'é', 'a'.repeat(MAX_KEY_LENGTH + 1)])
            assert.deepEqual(bearerFrom(found(key)), { failure: 'config' }, JSON.stringify(key.slice(0, 8)));
    });

    test('a key of exactly MAX_KEY_LENGTH characters is sent', () => {
        assert.equal(MAX_KEY_LENGTH, 4096);
        const key = 'a'.repeat(4096);
        assert.deepEqual(bearerFrom(found(key)), { bearer: key });
    });

    test('absent is keyless; unavailable is no-key', () => {
        assert.deepEqual(bearerFrom({ state: 'absent' }), { bearer: null });
        assert.deepEqual(bearerFrom({ state: 'unavailable' }), { failure: 'no-key' });
    });
});

describe('readChatResponse', () => {
    const failed = (code, extra = {}) => ({ kind: 'failed', code, ...extra });

    test('200 with an OpenAI envelope gives the verdict', () => {
        assert.deepEqual(readChatResponse(ok200(VERDICT_BODY), true),
            { kind: 'verdict', verdict: 'must', reason: 'client call' });
    });

    test('any 2xx is read', () => {
        assert.deepEqual(readChatResponse({ status: 204, retryAfter: null, body: VERDICT_BODY }, true),
            { kind: 'verdict', verdict: 'must', reason: 'client call' });
    });

    test('a 2xx that is not the envelope is bad-reply', () => {
        for (const body of ['not json', '{}', '{"choices":[]}', '{"choices":[{"message":{"content":null}}]}',
            '{"choices":{"0":{"message":{"content":"{\\"verdict\\":\\"must\\",\\"reason\\":\\"r\\"}"}}}}', 'null'])
            assert.deepEqual(readChatResponse(ok200(body), true), failed('bad-reply'), body);
    });

    test('content that is an object, not text, is bad-reply', () => {
        assert.deepEqual(readChatResponse(ok200(envelope({ verdict: 'must', reason: 'r' })), true), failed('bad-reply'));
    });

    test('3xx is config: redirects are not followed', () => {
        assert.deepEqual(readChatResponse({ status: 302, retryAfter: null, body: '' }, true), failed('config'));
    });

    test('a 400 naming response_format asks for one retry, only while the format was sent', () => {
        const r = { status: 400, retryAfter: null, body: '{"error":{"message":"response_format is not supported"}}' };
        assert.deepEqual(readChatResponse(r, true), { kind: 'retry-without-format' });
        assert.deepEqual(readChatResponse(r, false), failed('config'));
    });

    test('a 400 without the word is config', () => {
        assert.deepEqual(readChatResponse({ status: 400, retryAfter: null, body: '{"error":"bad model"}' }, true),
            failed('config'));
    });

    test('401 and 403 are auth', () => {
        for (const status of [401, 403])
            assert.deepEqual(readChatResponse({ status, retryAfter: null, body: '' }, true), failed('auth'));
    });

    test('402 is rate-limited without retryAfterS', () => {
        const out = readChatResponse({ status: 402, retryAfter: null, body: '' }, true);
        assert.deepEqual(out, failed('rate-limited'));
        assert.equal(Object.hasOwn(out, 'retryAfterS'), false);
    });

    test('429 carries retryAfterS only for whole seconds, capped at a day', () => {
        const r429 = retryAfter => readChatResponse({ status: 429, retryAfter, body: '' }, true);
        assert.deepEqual(r429('7'), failed('rate-limited', { retryAfterS: 7 }));
        assert.deepEqual(r429(' 7 '), failed('rate-limited', { retryAfterS: 7 }));
        assert.deepEqual(r429('999999999'), failed('rate-limited', { retryAfterS: 86400 }));
        for (const value of ['Wed, 21 Oct 2026 07:28:00 GMT', '-1', '1.5', null, '']) {
            const out = r429(value);
            assert.equal(out.code, 'rate-limited');
            assert.equal(Object.hasOwn(out, 'retryAfterS'), false, String(value));
        }
    });

    test('other 4xx are config; 5xx and anything outside 200-599 are server', () => {
        assert.deepEqual(readChatResponse({ status: 404, retryAfter: null, body: '' }, true), failed('config'));
        for (const status of [500, 503, 600, 199, 0])
            assert.deepEqual(readChatResponse({ status, retryAfter: null, body: '' }, true), failed('server'), String(status));
    });

    test('the injection corpus: a reply can only pick a verdict', () => {
        for (const entry of REPLY_CORPUS) {
            const out = readChatResponse(ok200(envelope(entry.text)), true);
            const want = entry.expected === null ? failed('bad-reply') : { kind: 'verdict', ...entry.expected };
            assert.deepEqual(out, want, entry.name);
        }
    });

    test('extra top-level keys in the envelope are ignored', () => {
        const body = JSON.stringify({
            joinUrl: 'https://evil.example.test', mode: 'in-person',
            choices: [{ message: { content: '{"verdict":"ignore","reason":"r"}' } }],
        });
        assert.deepEqual(readChatResponse(ok200(body), true), { kind: 'verdict', verdict: 'ignore', reason: 'r' });
    });
});
