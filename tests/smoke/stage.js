// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Check and stage-search helpers shared by the automation scripts run in an
// isolated gnome-shell (alert-ladder.js for the smoke, sample-check.js for the
// sample shell).
import GLib from 'gi://GLib';

import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export class CheckFailed extends Error {
    constructor(check, reason) {
        super(`${check}: ${reason}`);
        this.check = check;
    }
}

export function check(condition, name, reason) {
    if (!condition)
        throw new CheckFailed(name, reason);
}

export async function waitFor(pred, timeoutMs, stepMs = 200) {
    const until = GLib.get_monotonic_time() + timeoutMs * 1000;
    for (;;) {
        const value = pred();
        if (value)
            return value;
        if (GLib.get_monotonic_time() >= until)
            return null;
        await Scripting.sleep(stepMs);
    }
}

export async function mustWait(pred, timeoutMs, name, reason) {
    const value = await waitFor(pred, timeoutMs);
    check(value, name, `timed out after ${timeoutMs} ms: ${reason}`);
    return value;
}

export function findByName(actor, name) {
    if (actor.name === name)
        return actor;
    for (const child of actor.get_children()) {
        const found = findByName(child, name);
        if (found)
            return found;
    }
    return null;
}

export function findAll(actor, pred, out = []) {
    if (pred(actor))
        out.push(actor);
    for (const child of actor.get_children())
        findAll(child, pred, out);
    return out;
}
