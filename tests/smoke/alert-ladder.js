// Automation script for the headless smoke test (scripts/smoke.sh), run by the
// shell's ui/scripting.js harness. Prints PAYATTENTION-SMOKE PASS, or
// PAYATTENTION-SMOKE FAIL <check>: <reason> at the first failed check.
// Never prints calendar titles other than the fixture's own.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'payattention@tonymalandain.github.io';
const ACTIVE = 1;
const INACTIVE = 2;
const FIXTURE_TITLE = 'Smoke client review · ';

class CheckFailed extends Error {
    constructor(check, reason) {
        super(`${check}: ${reason}`);
        this.check = check;
    }
}

function check(condition, name, reason) {
    if (!condition)
        throw new CheckFailed(name, reason);
}

async function waitFor(pred, timeoutMs, stepMs = 200) {
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

async function mustWait(pred, timeoutMs, name, reason) {
    const value = await waitFor(pred, timeoutMs);
    check(value, name, `timed out after ${timeoutMs} ms: ${reason}`);
    return value;
}

function findByName(actor, name) {
    if (actor.name === name)
        return actor;
    for (const child of actor.get_children()) {
        const found = findByName(child, name);
        if (found)
            return found;
    }
    return null;
}

function countByPrefix(actor, prefix) {
    let n = actor.name?.startsWith(prefix) ? 1 : 0;
    for (const child of actor.get_children())
        n += countByPrefix(child, prefix);
    return n;
}

const stageFind = name => findByName(global.stage, name);

/** Helper processes started from the smoke home's installed extension only. */
function helperPids(home) {
    const needle = `${home}/data/gnome-shell/extensions/${UUID}/helper/main.js`;
    const pids = [];
    const children = Gio.File.new_for_path('/proc').enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = children.next_file(null)) !== null) {
        const name = info.get_name();
        if (!/^\d+$/.test(name))
            continue;
        try {
            const [, bytes] = GLib.file_get_contents(`/proc/${name}/cmdline`);
            const cmdline = new TextDecoder().decode(bytes).replaceAll('\0', ' ');
            if (cmdline.includes(needle))
                pids.push(Number(name));
        } catch {
            // The process exited while we looked; it is not a helper any more.
        }
    }
    children.close(null);
    return pids;
}

const now = () => GLib.get_monotonic_time();

/** Clicks the centre of actor with a virtual pointer; returns what was under it, for diagnostics. */
async function clickActor(actor) {
    const seat = Clutter.get_default_backend().get_default_seat();
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    await Scripting.sleep(100);
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    const tx = Math.round(x + w / 2), ty = Math.round(y + h / 2);
    // Measured in headless 50.4: a new virtual pointer's first motions can lose x or
    // stop at a monitor edge, so move until the pointer is really there.
    const arrived = await waitFor(() => {
        const [px, py] = global.get_pointer();
        if (px === tx && py === ty)
            return true;
        pointer.notify_absolute_motion(now(), tx, ty);
        return false;
    }, 3000, 100);
    check(arrived, '6-ack', `the pointer never reached ${tx},${ty} (at ${global.get_pointer().slice(0, 2)})`);
    const under = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, tx, ty);
    const hover = actor.hover;
    const [px, py] = global.get_pointer();
    pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await Scripting.sleep(50);
    const pressed = actor.pressed;
    pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    return `under=${under?.name ?? under} reactive=${actor.reactive} hover=${hover} pressed=${pressed} pointer=${px},${py} at ${tx},${ty}`;
}

async function pressKey(keyval) {
    const seat = Clutter.get_default_backend().get_default_seat();
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    await Scripting.sleep(100);
    keyboard.notify_keyval(now(), keyval, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(now(), keyval, Clutter.KeyState.RELEASED);
}

const ourModalEntries = () => Main.modalActorFocusStack.filter(r => r.actor?.name?.startsWith('payattention'));
const grabIsOurs = () => !!global.stage.get_grab_actor()?.name?.startsWith('payattention');

async function checkIndicator(name, home) {
    check(Main.panel.statusArea.payattention, name, 'the indicator is not in the panel');
    await mustWait(() => {
        const label = stageFind('payattention-indicator-label');
        return label?.visible && label.text.startsWith(FIXTURE_TITLE);
    }, 30000, name, 'the indicator never showed the fixture meeting');

    const status = findByName(Main.panel.statusArea.payattention.menu.actor, 'payattention-menu-status');
    check(status, name, 'no menu status actor');
    const shown = status.get_parent().visible;
    check(!shown || status.text === 'No more meetings today', name,
        `unexpected menu status "${status.text}" (Reading…, or a stale warning for local calendars)`);
    check(helperPids(home).length === 1, name, `expected 1 helper process, found ${helperPids(home).length}`);
}

async function checkDisabled(name, home) {
    const ext = Main.extensionManager.lookup(UUID);
    Main.extensionManager.disableExtension(UUID);
    await mustWait(() => ext.state === INACTIVE, 5000, name, `state stayed ${ext.state}`);
    check(countByPrefix(global.stage, 'payattention') === 0, name,
        `${countByPrefix(global.stage, 'payattention')} payattention actors remain`);
    check(Main.panel.statusArea.payattention === undefined, name, 'the indicator is still registered');
    check(ourModalEntries().length === 0, name, 'a modal entry of ours remains');
    check(!grabIsOurs(), name, 'a grab of ours remains');
    await mustWait(() => helperPids(home).length === 0, 3000, name, 'the helper is still running');
}

async function runLadder() {
    // 0. Isolation: never the owner's config or data.
    const home = GLib.getenv('PAYATTENTION_SMOKE_HOME') ?? '';
    check(home !== '', '0-isolation', 'PAYATTENTION_SMOKE_HOME is not set');
    check(GLib.get_user_config_dir() === `${home}/config`, '0-isolation', 'the config dir is not the smoke home');
    check(GLib.get_user_data_dir() === `${home}/data`, '0-isolation', 'the data dir is not the smoke home');

    // 1. The extension is active.
    const ext = await mustWait(() => {
        const e = Main.extensionManager.lookup(UUID);
        return e?.state === ACTIVE ? e : null;
    }, 10000, '1-active', `state ${Main.extensionManager.lookup(UUID)?.state}`);
    check(!ext.error, '1-active', `extension error: ${ext.error}`);

    // 2. Feed → judge → indicator, from the fixture only.
    await checkIndicator('2-indicator', home);

    // 3. The test ladder, step by step.
    ext.stateObj.runTestAlert();
    const seen = new Set();
    const takeover = await mustWait(() => {
        const card = stageFind('payattention-card');
        for (const step of [1, 2, 3]) {
            if (card?.has_style_class_name(`payattention-card-step${step}`))
                seen.add(step);
        }
        return stageFind('payattention-takeover');
    }, 45000, '3-ladder', `no takeover; steps seen: ${[...seen].join(',')}`);
    const takeoverAt = now();
    check(seen.has(1) && seen.has(2) && seen.has(3), '3-ladder', `steps seen: ${[...seen].join(',')}`);

    // 4. The takeover: every monitor, our grab, the right buttons.
    check(takeover.get_parent() === Main.layoutManager.modalDialogGroup, '4-takeover', 'not in modalDialogGroup');
    const monitors = Main.layoutManager.monitors;
    check(monitors.length === 2, '4-takeover', `${monitors.length} monitors`);
    const panels = monitors.map((_m, i) => findByName(takeover, `payattention-takeover-monitor-${i}`));
    check(panels.every(p => p), '4-takeover', 'a monitor has no takeover panel');
    const geometry = () => panels.map((p, i) => {
        const [x, y] = p.get_transformed_position();
        const [w, h] = p.get_transformed_size();
        const m = monitors[i];
        return { ok: p.mapped && x === m.x && y === m.y && w === m.width && h === m.height, text: `${i}: mapped=${p.mapped} ${x},${y} ${w}x${h} want ${m.x},${m.y} ${m.width}x${m.height}` };
    });
    await mustWait(() => geometry().every(g => g.ok), 2000, '4-takeover',
        `a panel does not cover its monitor (${geometry().map(g => g.text).join('; ')})`);
    check(global.stage.get_grab_actor() === takeover, '4-takeover', 'the grab actor is not the takeover');
    check(ourModalEntries().length === 1, '4-takeover', `${ourModalEntries().length} modal entries of ours`);
    check(!stageFind('payattention-card'), '4-takeover', 'a card is still up');
    check(!findByName(takeover, 'payattention-action-join'), '4-takeover', 'Join shown without a link');
    check(findByName(takeover, 'payattention-action-skip') && findByName(takeover, 'payattention-action-ignore'),
        '4-takeover', 'Skip or Not important is missing');
    check(!findByName(takeover, 'payattention-action-ignore-series'), '4-takeover', 'whole-series shown for a single meeting');

    // 5. Escape reaches the takeover and does nothing.
    let sawEscape = false;
    const probeId = takeover.connect('captured-event', (_actor, event) => {
        if (event.type() === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape)
            sawEscape = true;
        return Clutter.EVENT_PROPAGATE;
    });
    await pressKey(Clutter.KEY_Escape);
    await Scripting.sleep(500);
    takeover.disconnect(probeId);
    check(sawEscape, '5-escape', 'the Escape key never reached the takeover');
    check(stageFind('payattention-takeover') === takeover, '5-escape', 'Escape changed the takeover');
    check(global.stage.get_grab_actor() === takeover, '5-escape', 'Escape changed the grab');

    // 6. Acknowledge on the second monitor, once the buttons are armed.
    const armedIn = 1500 - (now() - takeoverAt) / 1000;
    if (armedIn > 0)
        await Scripting.sleep(armedIn);
    const ack = findByName(panels[1], 'payattention-action-ack');
    check(ack, '6-ack', 'no ack button on monitor 1');
    const clicked = await clickActor(ack);
    await mustWait(() => !stageFind('payattention-takeover') && !stageFind('payattention-card') &&
        ourModalEntries().length === 0 && !grabIsOurs(), 2000, '6-ack', `the takeover or our grab remains (${clicked})`);
    await Scripting.sleep(3000);
    check(!stageFind('payattention-takeover') && !stageFind('payattention-card'), '6-ack', 'an alert came back');

    // 7. Disable: nothing of ours remains.
    await checkDisabled('7-disable', home);

    // 8. The lock path: disable while a takeover holds the grab.
    Main.extensionManager.enableExtension(UUID);
    await mustWait(() => Main.extensionManager.lookup(UUID)?.state === ACTIVE, 10000, '8-lock', 're-enable failed');
    await checkIndicator('8-lock', home);
    Main.extensionManager.lookup(UUID).stateObj.runTestAlert();
    await mustWait(() => stageFind('payattention-takeover'), 45000, '8-lock', 'no takeover after re-enable');
    await checkDisabled('8-lock', home);
}

export async function run() {
    try {
        await runLadder();
        print('PAYATTENTION-SMOKE PASS');
    } catch (e) {
        if (e instanceof CheckFailed)
            print(`PAYATTENTION-SMOKE FAIL ${e.message}`);
        else
            print(`PAYATTENTION-SMOKE FAIL script-error: ${e}\n${e.stack}`);
    }
}

export function finish() {
}
