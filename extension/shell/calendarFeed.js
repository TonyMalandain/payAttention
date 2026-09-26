// Keeps the calendar helper process alive (ADR-0001) and hands on its last
// accepted snapshot, when it was accepted, and when each calendar was last
// seen in sync. It records facts only; health.js decides what they mean.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { PROTOCOL_VERSION, parseHelperLine, formatShellMessage } from '../core/protocol.js';
import { isAcceptedSnapshot, recordSync } from './health.js';
import { nextRestartDelayMs } from './backoff.js';

export class CalendarFeed {
    /**
     * Spawns the helper immediately.
     *
     * @param {object} p
     * @param {string[]} p.argv the helper command line
     * @param {() => void} p.onUpdate called after each accepted snapshot
     * @param {() => number} p.now
     */
    constructor({ argv, onUpdate, now }) {
        this._argv = argv;
        this._onUpdate = onUpdate;
        this._now = now;
        this._snapshot = null;
        this._acceptedAt = null;
        // Kept across helper restarts (interfaces.md addendum).
        this._syncedAt = new Map();
        this._stopped = false;
        this._proc = null;
        this._reader = null;
        this._cancellable = null;
        this._restartSourceId = 0;
        this._previousDelay = null;
        this._spawnedAt = 0;
        this._warned = new Set();
        this._spawn();
    }

    /** @returns {import('../core/types.js').Snapshot|null} the last accepted snapshot */
    get snapshot() {
        return this._snapshot;
    }

    /** @returns {number|null} when the last snapshot was accepted */
    get acceptedAt() {
        return this._acceptedAt;
    }

    /** @returns {ReadonlyMap<string, number>} source uid → last time seen in sync */
    get syncedAt() {
        return this._syncedAt;
    }

    /**
     * Ask the helper for a fresh snapshot. Does nothing while no helper runs.
     *
     * @param {'resume'|'manual'} reason
     */
    refresh(reason) {
        if (!this._proc || this._stopped)
            return;
        const bytes = new GLib.Bytes(new TextEncoder().encode(formatShellMessage({ type: 'refresh', reason })));
        try {
            this._proc.get_stdin_pipe().write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, this._cancellable, (stream, res) => {
                try {
                    stream.write_bytes_finish(res);
                } catch {
                    // The helper is exiting; onExit restarts it and the new one sends a snapshot at once.
                }
            });
        } catch {
            // Same as above: a closed pipe only means the helper is going away.
        }
    }

    destroy() {
        this._stopped = true;
        if (this._restartSourceId) {
            GLib.Source.remove(this._restartSourceId);
            this._restartSourceId = 0;
        }
        this._cancellable?.cancel();
        // SIGTERM without waiting (interfaces.md §1); the helper also exits on stdin EOF.
        this._proc?.force_exit();
        this._proc = null;
        this._reader = null;
        this._cancellable = null;
        this._onUpdate = null;
    }

    _spawn() {
        this._cancellable = new Gio.Cancellable();
        this._warned.clear();
        this._spawnedAt = this._now();
        try {
            // Stderr is inherited, so the helper's diagnostics reach the journal.
            this._proc = Gio.Subprocess.new(this._argv,
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        } catch (e) {
            console.error('payattention: helper-spawn-failed', e.message);
            this._proc = null;
            this._scheduleRestart(0);
            return;
        }
        this._reader = new Gio.DataInputStream({ base_stream: this._proc.get_stdout_pipe(), close_base_stream: true });
        const proc = this._proc;
        const cancellable = this._cancellable;
        this._readNext(this._reader, cancellable);
        proc.wait_async(cancellable, (_p, res) => this._onExit(proc, res, cancellable));
    }

    _readNext(reader, cancellable) {
        reader.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (_r, res) => {
            let line;
            try {
                [line] = reader.read_line_finish_utf8(res);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn('payattention: helper-read-failed', e.message);
                return;
            }
            // EOF: stop reading; onExit handles the restart.
            if (line === null || this._stopped || cancellable.is_cancelled())
                return;
            this._handleLine(line);
            this._readNext(reader, cancellable);
        });
    }

    _handleLine(line) {
        const r = parseHelperLine(line);
        if (!r.ok) {
            if (r.code === 'protocol-mismatch') {
                console.error(`payattention: protocol-mismatch (want ${PROTOCOL_VERSION})`);
                // No restart: the data clock expires and the warning shows.
                this._stopped = true;
                this._proc?.force_exit();
                return;
            }
            // The field is a path, never content.
            this._warnOnce(`invalid-line ${r.code}`, `payattention: invalid-line ${r.code}${r.field ? ' ' + r.field : ''}`);
            return;
        }
        const message = r.message;
        if (message.type === 'snapshot') {
            if (!isAcceptedSnapshot(message))
                return;
            const t = this._now();
            this._snapshot = message;
            this._acceptedAt = t;
            this._syncedAt = recordSync(this._syncedAt, message, t);
            this._onUpdate?.();
        } else if (message.type === 'status') {
            // Diagnostic only (sync-failed included): never used for health.
            this._warnOnce(`status ${message.code}`, `payattention: helper-status ${message.level} ${message.code}`);
        }
    }

    _warnOnce(id, text) {
        if (this._warned.has(id))
            return;
        this._warned.add(id);
        console.warn(text);
    }

    _onExit(proc, res, cancellable) {
        if (cancellable.is_cancelled() || this._stopped)
            return;
        try {
            proc.wait_finish(res);
        } catch (e) {
            console.warn('payattention: helper-wait-failed', e.message);
        }
        const how = proc.get_if_signaled() ? `signal ${proc.get_term_sig()}` : `status ${proc.get_exit_status()}`;
        console.warn(`payattention: helper-exited ${how}`);
        this._proc = null;
        this._scheduleRestart(this._now() - this._spawnedAt);
    }

    _scheduleRestart(ranForMs) {
        const delay = nextRestartDelayMs(this._previousDelay, ranForMs);
        this._previousDelay = delay;
        this._restartSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._restartSourceId = 0;
            this._spawn();
            return GLib.SOURCE_REMOVE;
        });
    }
}
