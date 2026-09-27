// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Keeps one AI helper process for one engine (ADR-0010) and carries one ask at
// a time to it, and its outcome back (interfaces.md §6.6). It decides nothing:
// the queue (aiQueue.js) decides what to ask, when, and what an outcome means,
// and its watchdog calls kill(). Logs carry codes only: never an invite, a
// line's content, a reason, the endpoint or the model.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { AI_PROTOCOL_VERSION, parseAiHelperLine, formatAiShellMessage } from '../core/aiProtocol.js';
import { nextRestartDelayMs } from './backoff.js';
import { spawnHelper } from './helperProcess.js';

export class AiHelperClient {
    /**
     * Starts nothing: the first ask() spawns the helper.
     *
     * @param {object} p
     * @param {string[]} p.argv ['gjs', '-m', '<extension dir>/ai/main.js']
     * @param {import('./aiQueue.js').AiEngine} p.engine from aiEngine(settings); fixed for this client's life
     * @param {() => number} p.now
     */
    constructor({ argv, engine, now }) {
        this._argv = argv;
        this._engine = engine;
        this._now = now;
        this._destroyed = false;
        // Stopped for good: a configure line that cannot be formatted, or a protocol mismatch.
        this._stopped = false;
        // The running helper: {proc, stdin, cancellable, queue: Uint8Array[], writing, warned: Set}, or null.
        this._io = null;
        this._spawnedAt = 0;
        this._restartAt = 0;
        this._previousDelay = null;
        this._nextId = 0;
        // {id: string|null, onDone}; id is null while a "later" outcome is pending.
        this._outstanding = null;
        this._later = new Set();
        this._loggedInvalidRequest = false;
    }

    /** @returns {boolean} not destroyed or stopped, no ask outstanding, and a helper is running or its restart delay has passed */
    get ready() {
        return !this._destroyed && !this._stopped && this._outstanding === null &&
            (this._io !== null || this._now() >= this._restartAt);
    }

    /**
     * Send one judge request. onDone is called exactly once, never inside ask(),
     * unless kill() or destroy() comes first.
     *
     * @param {import('../core/types.js').Invite} invite
     * @param {(outcome: import('./aiQueue.js').AiOutcome) => void} onDone
     * @throws {Error} 'ai-helper-client: not ready' when !ready
     */
    ask(invite, onDone) {
        if (!this.ready)
            throw new Error('ai-helper-client: not ready');
        const id = 'r' + String(++this._nextId);
        let line;
        try {
            line = formatAiShellMessage({ type: 'judge', id, invite });
        } catch (e) {
            // The message holds a code and a field path only.
            if (!this._loggedInvalidRequest) {
                this._loggedInvalidRequest = true;
                console.warn(`payattention: ai-invalid-request ${e.message}`);
            }
            this._deliverLater(onDone, { type: 'failed', code: 'bad-request' });
            return;
        }
        if (this._io === null && !this._spawn()) {
            this._deliverLater(onDone, { type: 'lost' });
            return;
        }
        this._outstanding = { id, onDone };
        this._write(this._io, line);
    }

    /** Drops the outstanding ask (onDone never called) and stops the helper; a later ask() respawns it. */
    kill() {
        this._stopProcess(true);
        this._dropAsk();
    }

    /** Stops the helper for good; no callback afterwards. Idempotent. */
    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._stopProcess(false);
        this._dropAsk();
    }

    /** @returns {boolean} true when a helper now runs, with its configure line queued first */
    _spawn() {
        let configure;
        try {
            configure = formatAiShellMessage({
                type: 'configure', protocol: AI_PROTOCOL_VERSION,
                endpoint: this._engine.endpoint, model: this._engine.model, timeoutMs: this._engine.timeoutMs,
            });
        } catch {
            // The error names a field, but the value would be the endpoint or the model: code only.
            console.warn('payattention: ai-invalid-configure');
            this._stopped = true;
            return false;
        }
        let proc;
        try {
            proc = spawnHelper(this._argv);
        } catch (e) {
            console.warn(`payattention: ai-spawn-failed ${e.message}`);
            this._scheduleRestart(0);
            return false;
        }
        this._spawnedAt = this._now();
        const io = {
            proc,
            stdin: proc.get_stdin_pipe(),
            cancellable: new Gio.Cancellable(),
            queue: [],
            writing: false,
            warned: new Set(),
        };
        this._io = io;
        const reader = new Gio.DataInputStream({ base_stream: proc.get_stdout_pipe(), close_base_stream: true });
        this._readNext(io, reader);
        proc.wait_async(io.cancellable, (_p, res) => this._onExit(io, res));
        this._write(io, configure);
        return true;
    }

    /** One write in flight per process: Gio refuses a second pending write on a stream. */
    _write(io, line) {
        io.queue.push(new TextEncoder().encode(line));
        this._writeNext(io);
    }

    _writeNext(io) {
        if (io.writing || io.queue.length === 0 || io !== this._io)
            return;
        const chunk = io.queue[0];
        io.writing = true;
        try {
            io.stdin.write_bytes_async(new GLib.Bytes(chunk), GLib.PRIORITY_DEFAULT, io.cancellable, (stream, res) => {
                io.writing = false;
                let written;
                try {
                    written = stream.write_bytes_finish(res);
                } catch {
                    // The helper is exiting (or was killed): the exit handler reports the ask.
                    io.queue.length = 0;
                    return;
                }
                if (io !== this._io) {
                    io.queue.length = 0;
                    return;
                }
                if (written < chunk.length)
                    io.queue[0] = chunk.subarray(written);
                else
                    io.queue.shift();
                this._writeNext(io);
            });
        } catch {
            // A closed pipe only means the helper is going away; the exit handler reports.
            io.writing = false;
            io.queue.length = 0;
        }
    }

    _readNext(io, reader) {
        reader.read_line_async(GLib.PRIORITY_DEFAULT, io.cancellable, (_r, res) => {
            let line;
            try {
                [line] = reader.read_line_finish_utf8(res);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`payattention: ai-read-failed ${e.message}`);
                // The queue's watchdog ends any outstanding ask.
                return;
            }
            // EOF: stop reading; the exit handler reports.
            if (line === null || io !== this._io || io.cancellable.is_cancelled())
                return;
            this._handleLine(io, line);
            if (io === this._io && !io.cancellable.is_cancelled())
                this._readNext(io, reader);
        });
    }

    _handleLine(io, line) {
        const r = parseAiHelperLine(line);
        if (!r.ok) {
            if (r.code === 'protocol-mismatch') {
                console.error(`payattention: ai-protocol-mismatch (want ${AI_PROTOCOL_VERSION})`);
                this._stopped = true;
                this._stopProcess(false);
                this._finish({ type: 'lost' });
                return;
            }
            // The field is a path, never content. The queue's watchdog ends the ask.
            this._warnOnce(io, `invalid-line ${r.code}`,
                `payattention: ai-invalid-line ${r.code}${r.field ? ' ' + r.field : ''}`);
            return;
        }
        const m = r.message;
        if (m.type === 'hello')
            return;
        if (this._outstanding === null || this._outstanding.id !== m.id) {
            this._warnOnce(io, 'unexpected-reply', 'payattention: ai-unexpected-reply');
            return;
        }
        if (m.type === 'verdict') {
            this._finish({ type: 'verdict', verdict: m.verdict, reason: m.reason });
        } else {
            const outcome = { type: 'failed', code: m.code };
            if (Object.hasOwn(m, 'retryAfterS'))
                outcome.retryAfterS = m.retryAfterS;
            this._finish(outcome);
        }
    }

    _onExit(io, res) {
        if (io.cancellable.is_cancelled() || this._destroyed || io !== this._io)
            return;
        const proc = io.proc;
        try {
            proc.wait_finish(res);
        } catch (e) {
            console.warn(`payattention: ai-helper-wait-failed ${e.message}`);
        }
        const how = proc.get_if_signaled() ? `signal ${proc.get_term_sig()}` : `status ${proc.get_exit_status()}`;
        console.warn(`payattention: ai-helper-exited ${how}`);
        io.cancellable.cancel();
        this._io = null;
        this._scheduleRestart(this._now() - this._spawnedAt);
        if (this._outstanding !== null && this._outstanding.id !== null)
            this._finish({ type: 'lost' });
    }

    /** Clears the outstanding ask, then reports its outcome. */
    _finish(outcome) {
        const ask = this._outstanding;
        this._outstanding = null;
        ask?.onDone(outcome);
    }

    /** "Later": from an idle source, so onDone is never called inside ask(). */
    _deliverLater(onDone, outcome) {
        this._outstanding = { id: null, onDone };
        const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._later.delete(sourceId);
            this._finish(outcome);
            return GLib.SOURCE_REMOVE;
        });
        this._later.add(sourceId);
    }

    /** No timer: ready stays false until the delay has passed, and the next ask spawns. */
    _scheduleRestart(ranForMs) {
        const delay = nextRestartDelayMs(this._previousDelay, ranForMs);
        this._previousDelay = delay;
        this._restartAt = this._now() + delay;
    }

    /** Cancels and SIGKILLs the running helper, if any, scheduling a restart when asked. */
    _stopProcess(restart) {
        const io = this._io;
        if (io === null)
            return;
        this._io = null;
        io.cancellable.cancel();
        io.queue.length = 0;
        // force_exit sends SIGKILL without waiting; the helper also exits on stdin EOF.
        io.proc.force_exit();
        if (restart)
            this._scheduleRestart(this._now() - this._spawnedAt);
    }

    /** Drops the outstanding ask without calling it, and every pending "later" source. */
    _dropAsk() {
        this._outstanding = null;
        for (const sourceId of this._later)
            GLib.Source.remove(sourceId);
        this._later.clear();
    }

    _warnOnce(io, id, text) {
        if (io.warned.has(id))
            return;
        io.warned.add(id);
        console.warn(text);
    }
}
