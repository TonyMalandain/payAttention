// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The AI helper's entry point (ADR-0010, interfaces.md §6.6). Takes no
// arguments, runs the main loop, wires the parts together, and is the only
// place that ends the process.
//
//   gjs -m main.js    hello, then one reply per judge or probe, until stdin closes
import GLib from 'gi://GLib';
import System from 'system';
import { AI_PROTOCOL_VERSION } from '../core/aiProtocol.js';
import { Stdout, reportDiagnostic, watchStdin } from './stdio.js';
import { HttpTransport } from './transport.js';
import { lookupKey } from './keyring.js';
import { AiService } from './service.js';

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

function fatal() {
    // Never print the exception: it could carry a URL or invite text.
    reportDiagnostic('ai-failed');
    exitSoon(1);
}

function start() {
    const stdout = new Stdout();
    stdout.send({ type: 'hello', protocol: AI_PROTOCOL_VERSION });
    const transport = new HttpTransport();
    const service = new AiService({
        send: m => stdout.send(m),
        diagnose: reportDiagnostic,
        lookupKey,
        post: r => transport.post(r),
        now: () => Date.now(),
        onFatal: fatal,
    });
    // The helper holds no state (interfaces.md §1): EOF exits at once, even with a request in flight.
    watchStdin({ onLine: line => service.handleLine(line), onEof: () => exitSoon(0) });
}

const loop = new GLib.MainLoop(null, false);
GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    if (System.programArgs.length > 0) {
        reportDiagnostic('usage');
        exitSoon(2);
    } else {
        try {
            start();
        } catch {
            fatal();
        }
    }
    return GLib.SOURCE_REMOVE;
});
loop.run();
