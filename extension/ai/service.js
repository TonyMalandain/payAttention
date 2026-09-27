// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The AI helper's protocol conversation (interfaces.md §6.6, §6.7): holds the
// configuration, runs one request at a time, and answers each with exactly one
// line. Every I/O part is passed in, so this module has no gi:// import.
// Diagnostics carry codes and HTTP status numbers only, never meeting text,
// replies, the key or the endpoint.
import { parseAiShellLine, validateAiHelperMessage } from '../core/aiProtocol.js';
import { PROBE_INVITE } from '../core/aiPrompt.js';
import { mayCarryKey } from '../core/aiEngine.js';
import { chatUrl, chatRequestBody, bearerFrom, readChatResponse } from './chat.js';

/**
 * @typedef {{state:'found', key:string} | {state:'absent'} | {state:'unavailable'}} KeyLookup
 * @typedef {{url:string, body:string, bearer:string|null, timeoutMs:number}} ChatPost
 * @typedef {{ok:true, status:number, retryAfter:string|null, body:string}
 *         | {ok:false, code:'timeout'|'network'|'tls'|'bad-reply'}} PostResult
 */

/** The id of a raw judge or probe line, when a bad-request reply to it would be valid; else null. */
function replyableId(line) {
    let obj;
    try {
        obj = JSON.parse(line);
    } catch {
        return null;
    }
    if (typeof obj !== 'object' || obj === null || (obj.type !== 'judge' && obj.type !== 'probe'))
        return null;
    return validateAiHelperMessage({ type: 'failed', id: obj.id, code: 'bad-request' }).ok ? obj.id : null;
}

export class AiService {
    /**
     * @param {{send: (message:object) => void,
     *          diagnose: (code:string, detail?:string) => void,
     *          lookupKey: (endpoint:string) => Promise<KeyLookup>,
     *          post: (request:ChatPost) => Promise<PostResult>,
     *          now: () => number,
     *          onFatal: () => void}} parts
     *   send formats through formatAiHelperMessage; lookupKey never rejects; post
     *   rejects only on a programming error; now is in ms.
     */
    constructor(parts) {
        this._parts = parts;
        this._config = null;
        this._useResponseFormat = true;
        this._tail = Promise.resolve();
    }

    /**
     * One stdin line (without its newline).
     *
     * @param {string} line
     * @returns {Promise<void>} settles once this line's reply, if any, is written. Never rejects:
     *          an unexpected error calls parts.onFatal() instead.
     */
    handleLine(line) {
        try {
            return this._handle(line);
        } catch {
            this._parts.onFatal();
            return Promise.resolve();
        }
    }

    _handle(line) {
        const { send, diagnose } = this._parts;
        const result = parseAiShellLine(line);
        if (!result.ok) {
            diagnose('bad-command', result.code);
            const id = replyableId(line);
            if (id !== null)
                send({ type: 'failed', id, code: 'bad-request' });
            return Promise.resolve();
        }
        const message = result.message;
        if (message.type === 'configure') {
            // The shell respawns on any engine change (§6.5); switching engines under a running request would be a bug.
            if (this._config !== null) {
                diagnose('configure-again');
                return Promise.resolve();
            }
            this._config = { endpoint: message.endpoint, model: message.model, timeoutMs: message.timeoutMs };
            return Promise.resolve();
        }
        if (this._config === null) {
            diagnose('not-configured');
            send({ type: 'failed', id: message.id, code: 'config' });
            return Promise.resolve();
        }
        const invite = message.type === 'probe' ? PROBE_INVITE : message.invite;
        const done = this._tail.then(() => this._ask(message.id, invite));
        this._tail = done.catch(() => {});
        return done.catch(() => this._parts.onFatal());
    }

    _fail(id, code, { status, retryAfterS } = {}) {
        const message = { type: 'failed', id, code };
        if (retryAfterS !== undefined)
            message.retryAfterS = retryAfterS;
        this._parts.diagnose('request-failed', status === undefined ? code : `${code} ${status}`);
        this._parts.send(message);
    }

    async _ask(id, invite) {
        const { lookupKey, post, now, send } = this._parts;
        const { endpoint, model, timeoutMs } = this._config;
        const started = now();

        // A keyless private-network engine never touches the keyring, so a locked keyring cannot block it.
        let bearer = null;
        if (mayCarryKey(endpoint)) {
            const b = bearerFrom(await lookupKey(endpoint));
            if (b.failure !== undefined) {
                this._fail(id, b.failure);
                return;
            }
            bearer = b.bearer;
        }

        // One deadline covers the lookup, the request and the single response_format retry (§6.7).
        for (;;) {
            const remaining = timeoutMs - (now() - started);
            if (remaining < 1) {
                this._fail(id, 'timeout');
                return;
            }
            const withFormat = this._useResponseFormat;
            const result = await post({
                url: chatUrl(endpoint),
                body: chatRequestBody(model, invite, withFormat),
                bearer,
                timeoutMs: Math.floor(remaining),
            });
            if (!result.ok) {
                this._fail(id, result.code);
                return;
            }
            const outcome = readChatResponse(result, withFormat);
            if (outcome.kind === 'retry-without-format') {
                // Off for the rest of the run (§6.7). Only reachable while withFormat was true, so the loop ends.
                this._useResponseFormat = false;
                continue;
            }
            if (outcome.kind === 'verdict') {
                send({ type: 'verdict', id, verdict: outcome.verdict, reason: outcome.reason });
                return;
            }
            this._fail(id, outcome.code, { status: result.status, retryAfterS: outcome.retryAfterS });
            return;
        }
    }
}
