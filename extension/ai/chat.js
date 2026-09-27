// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The Chat Completions exchange as data (interfaces.md §6.7, §6.8): what is
// sent, which key may go in the header, and what a response means. No I/O and
// no gi:// import, so it runs under Node and gjs alike.
import { SYSTEM_PROMPT, REPLY_JSON_SCHEMA, parseReply } from '../core/aiPrompt.js';
import { isSendableKey } from '../core/aiEngine.js';

export { MAX_KEY_LENGTH } from '../core/aiEngine.js';

/** max_tokens in every request (interfaces §6.7). */
export const MAX_TOKENS = 400;

const MAX_RETRY_AFTER_S = 86400;
const RETRY_AFTER_SECONDS = /^\s*\d{1,9}\s*$/;

/**
 * @param {string} endpoint already normalised (configure was validated)
 * @returns {string} endpoint + '/chat/completions'
 */
export function chatUrl(endpoint) {
    return endpoint + '/chat/completions';
}

/**
 * The request body, keys in this order: model, messages, temperature, max_tokens,
 * then response_format only when withResponseFormat.
 * messages = [{role:'system', content: SYSTEM_PROMPT}, {role:'user', content: JSON.stringify(invite)}].
 * temperature 0; response_format = {type:'json_schema', json_schema: REPLY_JSON_SCHEMA}.
 * No tools, functions or stream key, ever.
 *
 * @param {string} model
 * @param {object} invite a valid invite; serialised unchanged
 * @param {boolean} withResponseFormat
 * @returns {string} JSON text
 */
export function chatRequestBody(model, invite, withResponseFormat) {
    const body = {
        model,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(invite) },
        ],
        temperature: 0,
        max_tokens: MAX_TOKENS,
    };
    if (withResponseFormat)
        body.response_format = { type: 'json_schema', json_schema: REPLY_JSON_SCHEMA };
    return JSON.stringify(body);
}

/**
 * What a key lookup means for the request.
 *   found, key ''                          -> {bearer: null}   (an empty key is a keyless engine, ADR-0010)
 *   found, isSendableKey(key) (core: 1..MAX_KEY_LENGTH chars,
 *          every char in U+0021..U+007E)   -> {bearer: key}
 *   found, any other key                   -> {failure: 'config'}   (never sent: it could split a header)
 *   absent                                 -> {bearer: null}
 *   unavailable                            -> {failure: 'no-key'}
 *
 * @param {import('./service.js').KeyLookup} lookup
 * @returns {{bearer: string|null} | {failure: 'no-key'|'config'}}
 */
export function bearerFrom(lookup) {
    switch (lookup.state) {
    case 'found':
        if (lookup.key === '')
            return { bearer: null };
        return isSendableKey(lookup.key) ? { bearer: lookup.key } : { failure: 'config' };
    case 'absent':
        return { bearer: null };
    default:
        return { failure: 'no-key' };
    }
}

function readBody(body) {
    let obj;
    try {
        obj = JSON.parse(body);
    } catch {
        return { kind: 'failed', code: 'bad-reply' };
    }
    const content = Array.isArray(obj?.choices) ? obj.choices[0]?.message?.content : undefined;
    const reply = parseReply(content);
    if (reply === null)
        return { kind: 'failed', code: 'bad-reply' };
    return { kind: 'verdict', verdict: reply.verdict, reason: reply.reason };
}

function rateLimited(retryAfter) {
    const out = { kind: 'failed', code: 'rate-limited' };
    if (typeof retryAfter === 'string' && RETRY_AFTER_SECONDS.test(retryAfter))
        out.retryAfterS = Math.min(Number(retryAfter.trim()), MAX_RETRY_AFTER_S);
    return out;
}

/**
 * What one HTTP response means. Never throws. Reads only choices[0].message.content.
 *
 * @param {{status:number, retryAfter:string|null, body:string}} response
 * @param {boolean} withResponseFormat whether the request carried response_format
 * @returns {{kind:'verdict', verdict:'must'|'ignore', reason:string}
 *         | {kind:'failed', code:string, retryAfterS?:number}
 *         | {kind:'retry-without-format'}}
 */
export function readChatResponse(response, withResponseFormat) {
    const { status, retryAfter, body } = response;
    if (status >= 200 && status <= 299)
        return readBody(body);
    // Redirects are not followed, so a 3xx means the endpoint is wrong.
    if (status >= 300 && status <= 399)
        return { kind: 'failed', code: 'config' };
    if (status === 400 && withResponseFormat && body.includes('response_format'))
        return { kind: 'retry-without-format' };
    if (status === 401 || status === 403)
        return { kind: 'failed', code: 'auth' };
    if (status === 402 || status === 429)
        return rateLimited(retryAfter);
    if (status >= 400 && status <= 499)
        return { kind: 'failed', code: 'config' };
    return { kind: 'failed', code: 'server' };
}
