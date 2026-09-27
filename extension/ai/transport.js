// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// One HTTP POST to the engine (ADR-0007, interfaces.md §6.7): one deadline for
// connect, send and the whole body read, a cap on the body, and no redirects.
// The only code in the extension that opens a socket.
import Soup from 'gi://Soup?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { mayCarryKey } from '../core/aiEngine.js';

/** The largest response body read, in bytes after content decoding. */
export const MAX_RESPONSE_BYTES = 1048576;

const CHUNK_BYTES = 65536;

function concat(chunks, total) {
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
        all.set(c, at);
        at += c.length;
    }
    return all;
}

/** Closes a response stream without a cancellable, so the deadline's cancel cannot stop the close. */
function closeQuietly(stream) {
    stream.close_async(GLib.PRIORITY_DEFAULT, null, (_c, closeRes) => {
        try {
            stream.close_finish(closeRes);
        } catch {
            // The outcome is already decided; a failed close only loses connection reuse or cleanup.
        }
    });
}

export class HttpTransport {
    /**
     * Creates one Soup.Session for the life of the process, with its timeout set to 0 (the deadline below is the
     * only timer). libsoup 3 defaults it to 60 s, which cut a slow local engine off as network before its deadline.
     * idle-timeout keeps its default: it only closes pooled connections with no request in flight.
     */
    constructor() {
        this._session = new Soup.Session({ timeout: 0 });
    }

    /**
     * POST request.body as application/json to request.url, with
     * 'Authorization: Bearer <bearer>' only when bearer is not null, redirects off
     * (Soup.MessageFlags.NO_REDIRECT), and one deadline of timeoutMs covering
     * connect, send and the whole body read.
     *
     * @param {import('./service.js').ChatPost} request
     * @returns {Promise<import('./service.js').PostResult>}
     * @throws {TypeError} (synchronously) when bearer is not null and mayCarryKey(url) is false,
     *         or timeoutMs is not an integer >= 1
     */
    post(request) {
        const { url, body, bearer, timeoutMs } = request;
        // Checked again at the network boundary: a key never goes over plain http to a non-loopback host.
        if (bearer !== null && !mayCarryKey(url))
            throw new TypeError('HttpTransport.post: a key may not be sent to this endpoint');
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
            throw new TypeError('HttpTransport.post: timeoutMs must be an integer >= 1');

        return new Promise((resolve, reject) => {
            const cancellable = new Gio.Cancellable();
            let timedOut = false;
            let settled = false;
            let timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
                timerId = 0;
                timedOut = true;
                cancellable.cancel();
                return GLib.SOURCE_REMOVE;
            });
            const settle = (fn, value) => {
                if (settled)
                    return;
                settled = true;
                if (timerId !== 0) {
                    GLib.source_remove(timerId);
                    timerId = 0;
                }
                fn(value);
            };
            const failWith = e => {
                if (timedOut)
                    settle(resolve, { ok: false, code: 'timeout' });
                else if (e instanceof GLib.Error)
                    settle(resolve, { ok: false, code: e.domain === Gio.tls_error_quark() ? 'tls' : 'network' });
                else
                    settle(reject, e);
            };

            try {
                const msg = Soup.Message.new('POST', url);
                msg.set_flags(Soup.MessageFlags.NO_REDIRECT);
                msg.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));
                if (bearer !== null)
                    msg.request_headers.append('Authorization', `Bearer ${bearer}`);

                this._session.send_async(msg, GLib.PRIORITY_DEFAULT, cancellable, (_s, res) => {
                    try {
                        const stream = this._session.send_finish(res);
                        // status_code, not get_status(): gjs throws on codes missing from the enum (429).
                        const status = msg.status_code;
                        const retryAfter = msg.response_headers.get_one('Retry-After');
                        this._readBody(stream, cancellable, (text, tooLarge) => {
                            if (tooLarge) {
                                cancellable.cancel();
                                settle(resolve, { ok: false, code: 'bad-reply' });
                            } else {
                                settle(resolve, { ok: true, status, retryAfter, body: text });
                            }
                        }, failWith);
                    } catch (e) {
                        failWith(e);
                    }
                });
            } catch (e) {
                failWith(e);
            }
        });
    }

    /** Reads the whole body, at most MAX_RESPONSE_BYTES; onDone(text, tooLarge) or onError(e). */
    _readBody(stream, cancellable, onDone, onError) {
        const chunks = [];
        let total = 0;
        const readNext = () => {
            stream.read_bytes_async(CHUNK_BYTES, GLib.PRIORITY_DEFAULT, cancellable, (_st, res) => {
                try {
                    const bytes = stream.read_bytes_finish(res);
                    const size = bytes.get_size();
                    if (size === 0) {
                        closeQuietly(stream);
                        onDone(new TextDecoder('utf-8').decode(concat(chunks, total)), false);
                        return;
                    }
                    total += size;
                    if (total > MAX_RESPONSE_BYTES) {
                        // Closing a half-read body drops the connection instead of leaving it open until exit.
                        closeQuietly(stream);
                        onDone(null, true);
                        return;
                    }
                    chunks.push(bytes.toArray());
                    readNext();
                } catch (e) {
                    onError(e);
                }
            });
        };
        readNext();
    }
}
