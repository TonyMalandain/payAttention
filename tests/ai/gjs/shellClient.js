// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test support, not a test: drives the shell's AiHelperClient against a fake
// engine for tests/ai/shellClient.test.js (Layer 2b). Run from the repo root:
//
//   gjs -m tests/ai/gjs/shellClient.js <scenario> <endpoint>
//
// Prints ASKED, OUTCOME <json>, READY <bool>, CHILDREN <n>, CHILD-ENV clean|dirty
// as the scenario says, then DONE. Never a real engine: only 127.0.0.1.
import GLib from 'gi://GLib';
import System from 'system';

import { AiHelperClient } from '../../../extension/shell/aiHelperClient.js';
import { aiEngine } from '../../../extension/core/aiEngine.js';
import { DEFAULT_SETTINGS } from '../../../extension/core/defaults.js';
import { PROBE_INVITE } from '../../../extension/core/aiPrompt.js';

const LOOPBACK_ENGINE = /^http:\/\/127\.0\.0\.1:\d+\/v1$/;
const OUTCOME_WAIT_MS = 15000;

const [scenario, endpoint] = System.programArgs;
if (!LOOPBACK_ENGINE.test(endpoint ?? '')) {
    printerr(`shellClient: test engines must be on 127.0.0.1, got ${endpoint}`);
    System.exit(2);
}

const repo = GLib.get_current_dir();
const engine = aiEngine({ ...DEFAULT_SETTINGS, verdictSource: 'ai', aiEndpoint: endpoint, aiModel: 'fake-model' });
const ARGV_FOR = {
    'exit': ['gjs', '-m', `${repo}/tests/ai/gjs/missing-entry.js`],
    'spawn-failed': [`${repo}/.test-home/no-such-binary`],
};
const client = new AiHelperClient({
    argv: ARGV_FOR[scenario] ?? ['gjs', '-m', `${repo}/extension/ai/main.js`],
    engine,
    now: () => Date.now(),
});

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

const decode = bytes => new TextDecoder().decode(bytes);

/** This script's child processes whose command line mentions ai/main.js. */
function aiChildren() {
    const self = GLib.file_read_link('/proc/self');
    const out = [];
    const dir = GLib.Dir.open('/proc', 0);
    let name;
    while ((name = dir.read_name()) !== null) {
        if (!/^\d+$/.test(name))
            continue;
        try {
            const stat = decode(GLib.file_get_contents(`/proc/${name}/stat`)[1]);
            const ppid = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[1];
            const cmdline = decode(GLib.file_get_contents(`/proc/${name}/cmdline`)[1]).replaceAll('\0', ' ');
            if (ppid === self && cmdline.includes('ai/main.js'))
                out.push(name);
        } catch {
            // The process exited while we looked.
        }
    }
    dir.close();
    return out;
}

function childEnvClean(pids) {
    return pids.every(pid => !decode(GLib.file_get_contents(`/proc/${pid}/environ`)[1])
        .split('\0').some(v => v.startsWith('G_MESSAGES_DEBUG=')));
}

/** Ask, print ASKED once ask() returns, and resolve with the outcome (or null after OUTCOME_WAIT_MS). */
function ask(invite = PROBE_INVITE, waitMs = OUTCOME_WAIT_MS) {
    return new Promise(resolve => {
        let settled = false;
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, waitMs, () => {
            settled = true;
            resolve(null);
            return GLib.SOURCE_REMOVE;
        });
        client.ask(invite, outcome => {
            print(`OUTCOME ${JSON.stringify(outcome)}`);
            if (settled)
                return;
            settled = true;
            GLib.Source.remove(timer);
            resolve(outcome);
        });
        print('ASKED');
    });
}

const SCENARIOS = {
    'verdict': () => ask(),
    'sequence': async () => {
        await ask();
        await ask();
    },
    'failed': async () => {
        await ask();
        await ask();
    },
    'kill': async () => {
        client.ask(PROBE_INVITE, outcome => print(`OUTCOME ${JSON.stringify(outcome)}`));
        await sleep(1500);
        client.kill();
        print(`READY ${client.ready}`);
        await sleep(1200);
        print(`READY ${client.ready}`);
        await ask();
    },
    'exit': async () => {
        await ask();
        print(`READY ${client.ready}`);
        await sleep(1200);
        print(`READY ${client.ready}`);
    },
    'spawn-failed': () => ask(),
    'bad-invite': async () => {
        await ask({ ...PROBE_INVITE, uid: 'x' });
        print(`CHILDREN ${aiChildren().length}`);
    },
    'destroy': async () => {
        client.ask(PROBE_INVITE, outcome => print(`OUTCOME ${JSON.stringify(outcome)}`));
        await sleep(1000);
        client.destroy();
        await sleep(1500);
        print(`CHILDREN ${aiChildren().length}`);
    },
    'debug-env': async () => {
        await ask();
        const pids = aiChildren();
        print(`CHILDREN ${pids.length}`);
        print(`CHILD-ENV ${childEnvClean(pids) ? 'clean' : 'dirty'}`);
    },
};

const loop = new GLib.MainLoop(null, false);
const run = SCENARIOS[scenario];
if (!run) {
    printerr(`shellClient: unknown scenario ${scenario}`);
    System.exit(2);
}
Promise.resolve().then(run).then(
    () => undefined,
    e => printerr(`shellClient: scenario failed: ${e.message}`)
).finally(() => {
    client.destroy();
    print('DONE');
    loop.quit();
});
loop.run();
