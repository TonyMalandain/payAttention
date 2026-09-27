// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Opens a URL with the desktop's default handler (the "Join" button).
import Gio from 'gi://Gio';

/**
 * Opens uri with the default handler. The URI is calendar data: never logged.
 *
 * @param {string} uri
 * @param {(ok: boolean) => void} onDone true once it opened; false on failure (logs payattention: join-failed)
 */
export function launchUri(uri, onDone) {
    // Only the error code is logged: a GLib message may quote the URI.
    const warn = e => console.warn('payattention: join-failed', e.code ?? '');
    try {
        const context = global.create_app_launch_context(0, -1);
        Gio.AppInfo.launch_default_for_uri_async(uri, context, null, (_source, res) => {
            let ok = false;
            try {
                ok = Gio.AppInfo.launch_default_for_uri_finish(res);
            } catch (e) {
                warn(e);
            }
            onDone(ok);
        });
    } catch (e) {
        warn(e);
        onDone(false);
    }
}
