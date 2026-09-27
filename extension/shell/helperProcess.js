// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The one way the shell starts a helper program (interfaces.md §1). Lint refuses
// Gio.Subprocess and Gio.SubprocessLauncher in every other shell/ file.
import Gio from 'gi://Gio';

import { HELPER_ENV_UNSET } from '../core/protocol.js';

/**
 * Start a helper program: stdin and stdout piped, stderr inherited (so its code-only
 * diagnostics reach the journal), and every variable in HELPER_ENV_UNSET removed
 * from its environment (interfaces.md §1 "Environment"). The rest of the environment
 * is the shell's own: a launcher copies it when it is made.
 *
 * @param {string[]} argv
 * @returns {Gio.Subprocess}
 * @throws {GLib.Error} whatever Gio.SubprocessLauncher.spawnv throws (the caller logs its message)
 */
export function spawnHelper(argv) {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
    });
    for (const name of HELPER_ENV_UNSET)
        launcher.unsetenv(name);
    return launcher.spawnv(argv);
}
