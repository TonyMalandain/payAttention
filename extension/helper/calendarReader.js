// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Every EDS conversation: the registry, the per-source clients, the change
// views, instance expansion and remote-sync requests. Read-only: the complete
// list of EDS calls allowed here is in docs/plans/PG-1b.md ("EDS calls").
import ECal from 'gi://ECal?version=2.0';
import EDataServer from 'gi://EDataServer?version=1.2';
import ICalGLib from 'gi://ICalGLib?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { normaliseAddress } from './text.js';
import { transcribeInstance } from './transcribe.js';
import { overlapsRange } from './range.js';
import { sourceConnection } from './connection.js';
import { SOURCE_ERRORS } from './messages.js';
import { reportDiagnostic } from './stdio.js';

/** How long one source may take to connect (constraints.md). */
export const CONNECT_TIMEOUT_MS = 5000;

// (guint32) -1: "do not wait for the backend to be online"; reads EDS's cache.
const DO_NOT_WAIT = 0xFFFFFFFF;

const REGISTRY_SIGNALS = ['source-added', 'source-removed', 'source-changed', 'source-enabled', 'source-disabled'];
const VIEW_SIGNALS = ['objects-added', 'objects-modified', 'objects-removed'];

/** The local zone, resolved on every read so that a zone change is picked up. */
function localZone() {
    const id = GLib.TimeZone.new_local().get_identifier();
    if (id === 'UTC' || id === 'Etc/UTC')
        return ICalGLib.Timezone.get_utc_timezone();
    return ICalGLib.Timezone.get_builtin_timezone(id) ??
        ECal.util_get_system_timezone() ??
        ICalGLib.Timezone.get_utc_timezone();
}

/** The EDataServer.SourceConnectionStatus key name for the source's current status, or null. */
function connectionStatusName(source) {
    const status = source.connection_status;
    return Object.keys(EDataServer.SourceConnectionStatus)
        .find(k => EDataServer.SourceConnectionStatus[k] === status) ?? null;
}

function calendarExtension(source) {
    return source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR);
}

/** ECal.Client.connect as a promise, cancelled after CONNECT_TIMEOUT_MS. */
function connectClient(source) {
    return new Promise((resolve, reject) => {
        const cancellable = new Gio.Cancellable();
        const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONNECT_TIMEOUT_MS, () => {
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
        ECal.Client.connect(source, ECal.ClientSourceType.EVENTS, DO_NOT_WAIT, cancellable, (_o, res) => {
            GLib.source_remove(timerId);
            try {
                resolve(ECal.Client.connect_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

class CalendarReader {
    constructor(registry, onChange) {
        this._registry = registry;
        this._onChange = onChange;
        /** @type {Map<string, {client:object, view:object|null, handlers:Array<[object, number]>}>} */
        this._clients = new Map();
        // Never cleared: EDS objects are never released while the process
        // runs, because disposal timing is what crashes gjs (ADR-0001, evidence 3).
        this._retired = [];
    }

    _retire(uid, entry) {
        if (this._clients.get(uid) !== entry)
            return;
        this._clients.delete(uid);
        this._retired.push(entry);
        for (const [obj, id] of entry.handlers)
            obj.disconnect(id);
        try {
            entry.view?.stop();
        } catch {
            // The factory is gone, so its view is too. Never the error text:
            // it can carry a calendar path.
            reportDiagnostic('view-stop-failed');
        }
    }

    async _connect(source) {
        const uid = source.get_uid();
        const client = await connectClient(source);
        // Asked before anything is connected, so a throw leaves nothing behind.
        const remote = client.check_refresh_supported();
        const handlers = [];
        let view;
        try {
            [, view] = client.get_view_sync('#t', null);
            view.set_flags(ECal.ClientViewFlags.NONE);
            for (const signal of VIEW_SIGNALS)
                handlers.push([view, view.connect(signal, () => this._onChange())]);
            view.start();
        } catch {
            // Without a view, the periodic snapshots still cover this source.
            view = null;
        }
        const entry = { client, view, handlers };
        handlers.push([client, client.connect('backend-died', () => {
            this._retire(uid, entry);
            this._onChange();
        })]);
        // D-013: loss and recovery of a remote link reach the shell within the
        // debounce. Remote sources only: a local source has no link to lose.
        if (remote) {
            handlers.push([client, client.connect('notify::online', () => this._onChange())]);
            handlers.push([source, source.connect('notify::connection-status', () => this._onChange())]);
        }
        this._clients.set(uid, entry);
    }

    /**
     * Complete read of every selected calendar source. Never rejects for one
     * source's failure.
     *
     * @param {number} rangeStart epoch ms
     * @param {number} rangeEnd epoch ms
     * @returns {Promise<{sources:object[], events:object[], skipped:number}>}
     */
    async read(rangeStart, rangeEnd) {
        const zone = localZone();
        const listed = this._registry.list_enabled(EDataServer.SOURCE_EXTENSION_CALENDAR)
            .filter(s => calendarExtension(s).get_selected());
        const listedUids = new Set(listed.map(s => s.get_uid()));

        for (const [uid, entry] of [...this._clients])
            if (!listedUids.has(uid))
                this._retire(uid, entry);

        const errors = new Map();
        await Promise.allSettled(listed.filter(s => !this._clients.has(s.get_uid())).map(async source => {
            try {
                await this._connect(source);
            } catch (e) {
                const timedOut = e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
                errors.set(source.get_uid(), timedOut ? SOURCE_ERRORS.CONNECT_TIMEOUT : SOURCE_ERRORS.CONNECT_FAILED);
            }
        }));

        const sources = [];
        const events = [];
        let skipped = 0;
        for (const source of listed) {
            const uid = source.get_uid();
            const info = {
                uid,
                name: source.get_display_name() ?? '',
                backend: calendarExtension(source).get_backend_name() ?? '',
                ownerEmail: null,
                ok: false,
                error: errors.get(uid) ?? SOURCE_ERRORS.CONNECT_FAILED,
                remote: null,
                connection: null,
            };
            const entry = this._clients.get(uid);
            if (entry) {
                try {
                    const { client } = entry;
                    const remote = client.check_refresh_supported();
                    const connection = sourceConnection({
                        remote, online: client.is_online(), statusName: connectionStatusName(source),
                    });
                    client.set_default_timezone(zone);
                    const [, value] = client.get_backend_property_sync(ECal.BACKEND_PROPERTY_CAL_EMAIL_ADDRESS, null);
                    const found = [];
                    client.generate_instances_sync(Math.floor(rangeStart / 1000), Math.ceil(rangeEnd / 1000), null,
                        (icomp, instanceStart, instanceEnd) => {
                            try {
                                const dto = transcribeInstance(uid, icomp, instanceStart, instanceEnd, zone);
                                if (overlapsRange(dto.start, dto.end, rangeStart, rangeEnd))
                                    found.push(dto);
                            } catch {
                                // Counted, never logged: the instance is calendar content.
                                skipped++;
                            }
                            return true;
                        });
                    events.push(...found);
                    Object.assign(info, {
                        ownerEmail: normaliseAddress(value) || null, ok: true, error: null, remote, connection,
                    });
                } catch {
                    info.error = SOURCE_ERRORS.READ_FAILED;
                }
            }
            sources.push(info);
        }
        return { sources, events, skipped };
    }

    /**
     * Asks EDS to sync every connected source that supports refresh. EDS only
     * schedules the sync, so a success says nothing about the provider.
     *
     * @returns {Promise<{requested:number, failed:number}>}
     */
    async syncRemote() {
        const results = [];
        for (const { client } of this._clients.values()) {
            let supported;
            try {
                supported = client.check_refresh_supported();
            } catch {
                results.push(Promise.resolve(false));
                continue;
            }
            if (supported)
                results.push(requestRefresh(client));
        }
        const done = await Promise.all(results);
        return { requested: done.length, failed: done.filter(ok => !ok).length };
    }
}

/** client.refresh as a promise of whether the request could be made. */
function requestRefresh(client) {
    return new Promise(resolve => {
        client.refresh(null, (_o, res) => {
            try {
                resolve(client.refresh_finish(res));
            } catch {
                resolve(false);
            }
        });
    });
}

/**
 * Opens the EDS source registry. The only way to get a CalendarReader.
 *
 * @param {{onChange: () => void}} options onChange is called, with no
 *   arguments, on any registry, view, backend or link-state change
 * @returns {Promise<CalendarReader>} rejects with the GLib.Error if the registry cannot be opened
 */
export async function openCalendarReader({ onChange }) {
    const registry = await new Promise((resolve, reject) => {
        EDataServer.SourceRegistry.new(null, (_o, res) => {
            try {
                resolve(EDataServer.SourceRegistry.new_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
    for (const signal of REGISTRY_SIGNALS)
        registry.connect(signal, () => onChange());
    return new CalendarReader(registry, onChange);
}
