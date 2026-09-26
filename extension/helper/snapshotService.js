// When to read: the timers, the debounce, one read at a time, and refresh
// commands.
import GLib from 'gi://GLib';
import { parseShellLine } from '../core/protocol.js';
import { snapshotRange } from './range.js';
import { snapshotMessage, statusMessage, STATUS_CODES } from './messages.js';
import { reportDiagnostic } from './stdio.js';

/** constraints.md "periodic re-snapshot every 5 min". */
export const RESNAPSHOT_INTERVAL_S = 300;
/** ADR-0001 / constraints.md: ask EDS to sync remote sources every 10 min. */
export const REMOTE_SYNC_INTERVAL_S = 600;
/** constraints.md "≤ 3 s (2 s debounce)". */
export const CHANGE_DEBOUNCE_MS = 2000;

/**
 * Reads once and builds the snapshot message. nowMs is passed in; this
 * function never reads the clock.
 *
 * @param {{read: (rangeStart:number, rangeEnd:number) => Promise<{sources:object[], events:object[], skipped:number}>}} reader
 * @param {number} nowMs
 * @returns {Promise<{message:object, skipped:number}>}
 */
export async function takeSnapshot(reader, nowMs) {
    const { rangeStart, rangeEnd } = snapshotRange(nowMs);
    const { sources, events, skipped } = await reader.read(rangeStart, rangeEnd);
    const message = snapshotMessage({ generatedAt: nowMs, rangeStart, rangeEnd, sources, events });
    return { message, skipped };
}

/** Serve mode: snapshots on start, periodically, after changes and on refresh. */
export class SnapshotService {
    /**
     * @param {{reader: object, stdout: import('./stdio.js').Stdout}} parts
     *   reader from openCalendarReader
     */
    constructor({ reader, stdout }) {
        this._reader = reader;
        this._stdout = stdout;
        this._reading = false;
        this._again = false;
        this._syncing = false;
        this._debounceId = 0;
    }

    /** Snapshot now, then, once that read has connected the clients, remote sync; installs the two periodic timers. */
    start() {
        // Clients are connected inside the first read; syncing before it finishes would request nothing.
        this._snapshotNow().then(() => this._syncRemoteNow());
        // Never removed: the process ends with them.
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RESNAPSHOT_INTERVAL_S, () => {
            this._snapshotNow();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REMOTE_SYNC_INTERVAL_S, () => {
            this._syncRemoteNow();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * A calendar changed: snapshot within CHANGE_DEBOUNCE_MS. A pending timer
     * is not extended, so latency stays at 2 s or less.
     */
    requestChangeSnapshot() {
        if (this._debounceId !== 0)
            return;
        this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHANGE_DEBOUNCE_MS, () => {
            this._debounceId = 0;
            this._snapshotNow();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * One stdin line. A valid refresh (resume or manual) snapshots and syncs
     * now; anything else is reported as a bad command.
     *
     * @param {string} line
     */
    handleLine(line) {
        const r = parseShellLine(line);
        if (!r.ok) {
            this._send(statusMessage('warn', STATUS_CODES.BAD_COMMAND));
            return;
        }
        if (this._debounceId !== 0) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        this._snapshotNow();
        this._syncRemoteNow();
    }

    _send(message) {
        this._stdout.send(message);
    }

    async _snapshotNow() {
        if (this._reading) {
            this._again = true;
            return;
        }
        this._reading = true;
        try {
            // The clock is read here, at the edge.
            const { message, skipped } = await takeSnapshot(this._reader, Date.now());
            this._send(message);
            if (skipped > 0)
                this._send(statusMessage('warn', STATUS_CODES.EVENT_SKIPPED));
        } catch (e) {
            if (e instanceof TypeError) {
                // Core's message holds a code and a field path only, never a value.
                this._send(statusMessage('error', STATUS_CODES.SNAPSHOT_INVALID));
                reportDiagnostic('snapshot-invalid', e.message);
            } else {
                this._send(statusMessage('error', STATUS_CODES.SNAPSHOT_FAILED));
                reportDiagnostic('snapshot-failed');
            }
        } finally {
            this._reading = false;
            if (this._again) {
                this._again = false;
                this._snapshotNow();
            }
        }
    }

    async _syncRemoteNow() {
        if (this._syncing)
            return;
        this._syncing = true;
        try {
            const { requested, failed } = await this._reader.syncRemote();
            if (failed > 0)
                this._send(statusMessage('warn', STATUS_CODES.SYNC_FAILED));
            // So that fetched data shows up even if a view misses it.
            if (requested > 0)
                this.requestChangeSnapshot();
        } catch {
            this._send(statusMessage('warn', STATUS_CODES.SYNC_FAILED));
        } finally {
            this._syncing = false;
        }
    }
}
