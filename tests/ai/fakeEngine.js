// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test support, not a test: a fake OpenAI-compatible engine on 127.0.0.1 only
// (Layer 2b). It records every request and answers from a queue of handlers.
import http from 'node:http';
import https from 'node:https';

const DEFAULT_CONTENT = '{"verdict":"must","reason":"fake engine"}';

/** A 200 body in the OpenAI Chat Completions shape with the given content. */
export function chatEnvelope(content) {
    return JSON.stringify({
        id: 'chatcmpl-fake', object: 'chat.completion', model: 'fake',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    });
}

/**
 * An HTTP (or HTTPS when tls is given) server on 127.0.0.1, port chosen by the OS.
 * Records every request as {method, path, headers, body, receivedAt}, answeredAt when answered,
 * and socketClosedAt once its connection closes.
 * Answers queued handlers in order, then the default: 200 chatEnvelope('{"verdict":"must","reason":"fake engine"}').
 * Handler: {status, headers?, body} | {delayMs, status, headers?, body} | {hold: true} (never answers until close).
 *
 * @param {{tls?: {key:string, cert:string}}} [options] PEM text
 * @returns {Promise<{endpoint:string, requests:object[],
 *                    queue:(...handlers) => void, close:() => Promise<void>}>}
 *          endpoint is 'http://127.0.0.1:<port>/v1', or 'https://…' with tls
 */
export async function startFakeEngine(options = {}) {
    const requests = [];
    const handlers = [];
    const timers = new Set();

    const onRequest = (req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const record = {
                method: req.method, path: req.url, headers: req.headers,
                body: Buffer.concat(chunks).toString('utf8'), receivedAt: Date.now(),
            };
            requests.push(record);
            req.socket.once('close', () => {
                record.socketClosedAt = Date.now();
            });
            const handler = handlers.shift() ?? { status: 200, body: chatEnvelope(DEFAULT_CONTENT) };
            if (handler.hold)
                return;
            const answer = () => {
                record.answeredAt = Date.now();
                res.writeHead(handler.status, { 'content-type': 'application/json', ...handler.headers });
                res.end(handler.body ?? '');
            };
            if (handler.delayMs) {
                const timer = setTimeout(() => {
                    timers.delete(timer);
                    answer();
                }, handler.delayMs);
                timers.add(timer);
            } else {
                answer();
            }
        });
    };

    const server = options.tls
        ? https.createServer({ key: options.tls.key, cert: options.tls.cert }, onRequest)
        : http.createServer(onRequest);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    const scheme = options.tls ? 'https' : 'http';

    return {
        endpoint: `${scheme}://127.0.0.1:${port}/v1`,
        requests,
        queue: (...more) => handlers.push(...more),
        close: () => {
            for (const timer of timers)
                clearTimeout(timer);
            timers.clear();
            const closed = new Promise(resolve => server.close(resolve));
            server.closeAllConnections();
            return closed;
        },
    };
}
