// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The calendar helper's entry point (ADR-0001). Parses argv, runs the main
// loop, wires the parts together, and is the only place that ends the process.
//
//   gjs -m main.js            serve mode: protocol v1 on stdout until stdin closes
//   gjs -m main.js --once     hello and one snapshot, then exit
//   gjs -m main.js --summary  counts only, for a bug report
import GLib from 'gi://GLib';
import System from 'system';
import { Stdout, reportDiagnostic, watchStdin } from './stdio.js';
import { openCalendarReader } from './calendarReader.js';
import { takeSnapshot, SnapshotService } from './snapshotService.js';
import { formatSummary } from './summary.js';
import { helloMessage, statusMessage, STATUS_CODES } from './messages.js';

/**
 * The only way the process ends. Deferred to a main-loop source because
 * System.exit from a promise continuation hangs, and ending without it (or
 * after loop.quit()) segfaults (plan PG-1b, fact 1).
 */
function exitSoon(code) {
    GLib.idle_add(GLib.PRIORITY_HIGH, () => {
        System.exit(code);
        return GLib.SOURCE_REMOVE;
    });
}

/** @returns {'serve'|'once'|'summary'|null} null for a usage error */
function parseMode(args) {
    if (args.length === 0)
        return 'serve';
    if (args.length === 1 && args[0] === '--once')
        return 'once';
    if (args.length === 1 && args[0] === '--summary')
        return 'summary';
    return null;
}

let stdout = null;
let mode = null;

async function openReader(options) {
    try {
        return await openCalendarReader(options);
    } catch {
        reportDiagnostic('registry-failed');
        if (mode === 'summary')
            stdout.writeText('error registry-failed\n');
        else
            stdout.send(statusMessage('error', STATUS_CODES.REGISTRY_FAILED));
        exitSoon(1);
        return null;
    }
}

async function runServe() {
    stdout.send(helloMessage());
    let service = null;
    // Before the registry opens, so EOF during startup still exits. Lines that
    // arrive before the service exists are dropped; the first snapshot follows
    // at once anyway.
    watchStdin({ onLine: line => service?.handleLine(line), onEof: () => exitSoon(0) });
    const reader = await openReader({ onChange: () => service?.requestChangeSnapshot() });
    if (!reader)
        return;
    service = new SnapshotService({ reader, stdout });
    service.start();
}

async function runOnce() {
    stdout.send(helloMessage());
    const reader = await openReader({ onChange: () => {} });
    if (!reader)
        return;
    const { message, skipped } = await takeSnapshot(reader, Date.now());
    stdout.send(message);
    if (skipped > 0)
        stdout.send(statusMessage('warn', STATUS_CODES.EVENT_SKIPPED));
    exitSoon(0);
}

async function runSummary() {
    const reader = await openReader({ onChange: () => {} });
    if (!reader)
        return;
    const { message } = await takeSnapshot(reader, Date.now());
    stdout.writeText(formatSummary(message));
    exitSoon(0);
}

async function run() {
    stdout = new Stdout();
    switch (mode) {
    case 'once':
        return runOnce();
    case 'summary':
        return runSummary();
    default:
        return runServe();
    }
}

function fatal() {
    // Never print the exception: a GLib error can carry a calendar name.
    reportDiagnostic('helper-failed');
    if (mode !== 'summary') {
        try {
            stdout?.send(statusMessage('error', STATUS_CODES.HELPER_FAILED));
        } catch {
            // stdout itself is broken; the diagnostic above is all that can be said.
        }
    }
    exitSoon(1);
}

const loop = new GLib.MainLoop(null, false);
mode = parseMode(System.programArgs);
GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    if (mode === null) {
        reportDiagnostic('usage');
        exitSoon(2);
    } else {
        run().catch(fatal);
    }
    return GLib.SOURCE_REMOVE;
});
loop.run();
