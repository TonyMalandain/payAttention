// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// gjs script, not a Node test: starts a child through the shell's spawnHelper and
// prints what the child saw, so spawnHelper.test.js can check that the child has
// no G_MESSAGES_DEBUG and that stdin and stdout are piped (interfaces.md §1).
import GLib from 'gi://GLib';
import System from 'system';

import { spawnHelper } from '../../../extension/shell/helperProcess.js';

try {
    print(`PARENT ${GLib.getenv('G_MESSAGES_DEBUG') ?? 'UNSET'}`);
    const proc = spawnHelper(['sh', '-c', 'printf "%s\\n" "${G_MESSAGES_DEBUG-UNSET}"; read -r line; printf "%s\\n" "$line"']);
    const [, stdout] = proc.communicate_utf8('ping\n', null);
    const [first, second] = stdout.split('\n');
    print(`CHILD ${first}`);
    print(`ECHO ${second}`);
    print('SPAWN-CHECK OK');
} catch (e) {
    print(`SPAWN-CHECK FAIL ${e.message}`);
    System.exit(1);
}
