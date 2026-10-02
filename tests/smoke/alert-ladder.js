// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Automation script for the headless smoke test (scripts/smoke.sh), run by the
// shell's ui/scripting.js harness. Prints PAYATTENTION-SMOKE PASS, or
// PAYATTENTION-SMOKE FAIL <check>: <reason> at the first failed check.
// Never prints calendar titles other than the fixture's own.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { ExtensionType } from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import { CheckFailed, check, waitFor, mustWait, findByName, findAll } from './stage.js';

// The UUID has one source: extension/metadata.json (PG-10).
const UUID = JSON.parse(new TextDecoder().decode(Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
    .get_child('extension').get_child('metadata.json').load_contents(null)[1])).uuid;
// A placeholder former identity (PG-10): install.sh finds former copies by schema, never by name.
const FORMER_UUID = 'payattention@former.example.test';
const SCHEMA_ID = 'org.gnome.shell.extensions.payattention';
const ACTIVE = 1;
const INACTIVE = 2;
const FIXTURE_TITLE = 'Smoke client review · ';

function countByPrefix(actor, prefix) {
    let n = actor.name?.startsWith(prefix) ? 1 : 0;
    for (const child of actor.get_children())
        n += countByPrefix(child, prefix);
    return n;
}

const stageFind = name => findByName(global.stage, name);

/** Calendar helper processes started from the smoke home's installed extension only. */
function helperPids(home) {
    return pidsRunning(`${home}/data/gnome-shell/extensions/${UUID}/helper/main.js`);
}

/** AI helper processes started from the smoke home's installed extension only (none in rules mode). */
function aiHelperPids(home) {
    return pidsRunning(`${home}/data/gnome-shell/extensions/${UUID}/ai/main.js`);
}

/** Processes whose command line contains `needle`. */
function pidsRunning(needle) {
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

let virtualPointer = null;

/**
 * One virtual pointer for the whole run, first moved to the middle of the primary
 * monitor. Measured in headless 50.4: a new virtual pointer's first motions can
 * land elsewhere (x lost, or stopped at a monitor edge); over the panel or the hot
 * corner that closed an open menu. So nothing is opened before this has run.
 */
async function pointerDevice(name) {
    if (virtualPointer)
        return virtualPointer;
    const seat = Clutter.get_default_backend().get_default_seat();
    const device = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    await Scripting.sleep(100);
    const m = Main.layoutManager.primaryMonitor;
    const sx = m.x + Math.round(m.width / 2), sy = m.y + Math.round(m.height / 2);
    const parked = await waitFor(() => {
        const [px, py] = global.get_pointer();
        if (px === sx && py === sy)
            return true;
        device.notify_absolute_motion(now(), sx, sy);
        return false;
    }, 3000, 100);
    check(parked, name, `the virtual pointer never reached ${sx},${sy} (at ${global.get_pointer().slice(0, 2)})`);
    virtualPointer = device;
    return device;
}

/** Clicks the centre of actor with the virtual pointer; returns what was under it, for diagnostics. */
async function clickActor(actor, name) {
    const pointer = await pointerDevice(name);
    const target = () => {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        return [Math.round(x + w / 2), Math.round(y + h / 2)];
    };
    // Motions can still be lost or stop at a monitor edge, so move until the pointer
    // is there and the actor is what is picked there.
    let tx, ty, under;
    const arrived = await waitFor(() => {
        [tx, ty] = target();
        const [px, py] = global.get_pointer();
        under = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, tx, ty);
        if (px === tx && py === ty && actor.contains(under))
            return true;
        pointer.notify_absolute_motion(now(), tx, ty);
        return false;
    }, 3000, 100);
    const chain = [];
    for (let a = under; a && chain.length < 8; a = a.get_parent())
        chain.push(a.name || a.constructor.name);
    check(arrived, name, `the pointer never reached the actor at ${tx},${ty} (at ${global.get_pointer().slice(0, 2)}, under ${chain.join('<')})`);
    const hover = actor.hover;
    const [px, py] = global.get_pointer();
    pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await Scripting.sleep(50);
    const pressed = actor.pressed;
    pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    return `under=${chain.join('<')} reactive=${actor.reactive} hover=${hover} pressed=${pressed} pointer=${px},${py} at ${tx},${ty}`;
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
    check(aiHelperPids(home).length === 0, name, `rules mode: expected no AI helper, found ${aiHelperPids(home).length}`);
    const aiStatus = findByName(Main.panel.statusArea.payattention.menu.actor, 'payattention-menu-ai-status');
    check(aiStatus, name, 'no AI status actor');
    check(!aiStatus.get_parent().visible, name, `the AI status line is shown in rules mode: "${aiStatus.text}"`);
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
    check(aiHelperPids(home).length === 0, name, `an AI helper is running (${aiHelperPids(home).length})`);
}

/**
 * Runs argv with the shell's environment; resolves with its exit status and merged stdout+stderr.
 * Asynchronous on purpose: the child may call back into this shell over D-Bus. The shell does not
 * promisify communicate_utf8_async, so the callback form is wrapped here.
 */
async function runProgram(argv) {
    const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
    const output = await new Promise((resolve, reject) => {
        proc.communicate_utf8_async(null, null, (p, result) => {
            try {
                resolve(p.communicate_utf8_finish(result)[1] ?? '');
            } catch (e) {
                reject(e);
            }
        });
    });
    return { status: proc.get_exit_status(), output };
}

/** Uninstall while a takeover holds the grab: stopped, nothing left, files and enabled entry gone. */
async function checkUninstall(name, home) {
    Main.extensionManager.enableExtension(UUID);
    await mustWait(() => Main.extensionManager.lookup(UUID)?.state === ACTIVE, 10000, name, 're-enable failed');
    await checkIndicator(name, home);
    Main.extensionManager.lookup(UUID).stateObj.runTestAlert();
    await mustWait(() => stageFind('payattention-takeover'), 45000, name, 'no takeover after re-enable');
    check(grabIsOurs(), name, 'the takeover does not hold the grab');

    const script = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
        .get_child('scripts').get_child('uninstall.sh').get_path();
    const { status, output } = await runProgram(['bash', script]);
    check(status === 0 && output.includes('Stopped: payAttention in the running session.'), name,
        `uninstall.sh exited ${status}: ${output}`);
    check(Main.extensionManager.lookup(UUID) === undefined, name, 'the shell still knows the extension');
    check(countByPrefix(global.stage, 'payattention') === 0, name,
        `${countByPrefix(global.stage, 'payattention')} payattention actors remain`);
    check(Main.panel.statusArea.payattention === undefined, name, 'the indicator is still registered');
    check(ourModalEntries().length === 0, name, 'a modal entry of ours remains');
    check(!grabIsOurs(), name, 'a grab of ours remains');
    await mustWait(() => helperPids(home).length === 0, 3000, name, 'the helper is still running');
    check(!GLib.file_test(`${home}/data/gnome-shell/extensions/${UUID}`, GLib.FileTest.EXISTS), name,
        'the install directory still exists');
    await mustWait(() => !global.settings.get_strv('enabled-extensions').includes(UUID), 3000, name,
        'the UUID is still in enabled-extensions');
}

/**
 * The switch-over with the running shell holding an earlier install (testing-and-build.md,
 * "Switching an existing install to the new UUID"): a former copy declaring our schema is
 * loaded and enabled, the new UUID is unknown to the shell, and install.sh runs once.
 */
async function checkSwitchOver(name, home) {
    const extDir = `${home}/data/gnome-shell/extensions`;
    const dir = Gio.File.new_for_path(`${extDir}/${FORMER_UUID}`);
    dir.make_directory_with_parents(null);
    GLib.file_set_contents(`${dir.get_path()}/metadata.json`, JSON.stringify({
        uuid: FORMER_UUID, name: 'payAttention former copy (smoke)', description: 'smoke fixture',
        'shell-version': ['50'], 'settings-schema': SCHEMA_ID,
    }));
    GLib.file_set_contents(`${dir.get_path()}/extension.js`,
        "import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';\n" +
        'export default class extends Extension { enable() {} disable() {} }\n');
    // What the shell does at login for every directory it scans.
    await Main.extensionManager.loadExtension(
        Main.extensionManager.createExtensionObject(FORMER_UUID, dir, ExtensionType.PER_USER));
    global.settings.set_strv('enabled-extensions', [...global.settings.get_strv('enabled-extensions'), FORMER_UUID]);
    await mustWait(() => Main.extensionManager.lookup(FORMER_UUID)?.state === ACTIVE, 10000, name,
        `the former copy did not start (state ${Main.extensionManager.lookup(FORMER_UUID)?.state})`);
    check(Main.extensionManager.lookup(UUID) === undefined, name, 'the shell already knows the new UUID');

    const script = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
        .get_child('scripts').get_child('install.sh').get_path();
    const { status, output } = await runProgram(['bash', script]);
    check(status === 0 && output.includes('log out and back in'), name, `install.sh exited ${status}: ${output}`);
    check(Main.extensionManager.lookup(FORMER_UUID) === undefined, name, 'the shell still has the former copy loaded');
    check(!GLib.file_test(dir.get_path(), GLib.FileTest.EXISTS), name, 'the former copy\'s directory remains');
    check(GLib.file_test(`${extDir}/${UUID}/schemas/gschemas.compiled`, GLib.FileTest.EXISTS), name,
        'the new UUID is not installed');
    const lists = () => ({
        enabled: global.settings.get_strv('enabled-extensions'),
        disabled: global.settings.get_strv('disabled-extensions'),
    });
    await mustWait(() => {
        const { enabled, disabled } = lists();
        return enabled.includes(UUID) && !enabled.includes(FORMER_UUID) && !disabled.includes(FORMER_UUID);
    }, 3000, name, `the lists are ${JSON.stringify(lists())}`);
    check(Main.extensionManager.lookup(UUID) === undefined, name, 'the running shell loaded the new UUID before login');
}

const verdictOverrides = settings => settings.get_value('verdict-overrides').recursiveUnpack();

/** Opens the menu and the submenu of the all-day fixture titled `title`; returns the submenu item. */
async function openFixtureRow(name, indicator, title) {
    indicator.menu.open(false);
    const row = await mustWait(() => findAll(indicator.menu.actor, a => a instanceof PopupMenu.PopupSubMenuMenuItem &&
        a.label.text.endsWith(title))[0], 3000, name, `no menu row for "${title}"`);
    row.setSubmenuShown(true);
    await mustWait(() => row.menu.actor.mapped, 3000, name, 'the meeting submenu did not open');
    await Scripting.sleep(300);
    return row;
}

/** A line of row's submenu that is shown (mapped: hidden lines stay in the tree) and reads text. */
const shownMenuLine = (row, text) => findAll(row.menu.actor, a => a instanceof PopupMenu.PopupMenuItem && a.mapped &&
    a.label?.text === text)[0] ?? null;
const rowDetail = row => findAll(row, a => a instanceof St.Label && a.has_style_class_name('payattention-row-detail'))[0]?.text;
const menuRow = (indicator, title) => findAll(indicator.menu.actor, a => a instanceof PopupMenu.PopupSubMenuMenuItem &&
    a.label.text.endsWith(title))[0] ?? null;

/**
 * The verdict switch in the menu: a click stores the override and leaves the menu and the
 * row open, now offering Back to automatic, which clears it, still without closing (PG-15).
 */
async function checkMenuVerdict(name, ext) {
    const indicator = Main.panel.statusArea.payattention;
    const settings = ext.stateObj.getSettings();
    await pointerDevice(name);
    check(Object.keys(verdictOverrides(settings)).length === 0, name, 'overrides stored before the check');

    try {
        const row = await openFixtureRow(name, indicator, 'Smoke all-day check');
        const must = findAll(row.menu.actor, a => a instanceof PopupMenu.PopupSwitchMenuItem)[0];
        check(must?.state === false, name, `the must-attend switch is not off (${must?.state})`);
        let clicked;
        try {
            clicked = await clickActor(must, name);
        } catch (e) {
            if (e instanceof CheckFailed)
                e.message += `; menu open=${indicator.menu.isOpen} mapped=${indicator.menu.actor.mapped} sub open=${row.menu.isOpen} item mapped=${must.mapped} overview=${Main.overview.visible} startingUp=${Main.layoutManager._startingUp} grab=${global.stage.get_grab_actor()?.constructor.name}`;
            throw e;
        }
        await mustWait(() => Object.values(verdictOverrides(settings)).includes('must'), 3000, name,
            `the switch stored no must override (${clicked})`);
        await Scripting.sleep(1000);
        check(indicator.menu.isOpen, name, 'the menu closed after the switch was activated');
        check(row.menu.isOpen && indicator.menu.actor.contains(row), name,
            `the row is not open in the menu after the switch (open=${row.menu.isOpen})`);
        check(must.state === true, name, `the must-attend switch is ${must.state} after the click`);
        const detail = rowDetail(row);
        check(detail?.startsWith('Must attend') && detail.includes('overridden'), name, `the row's detail reads "${detail}"`);
        const siteVisit = menuRow(indicator, 'Smoke all-day site visit');
        check(siteVisit, name, 'the menu has no "Smoke all-day site visit" row');
        check(!siteVisit.menu.isOpen, name, 'another row opened');

        const back = await mustWait(() => shownMenuLine(row, 'Back to automatic'), 3000, name,
            'the open row shows no "Back to automatic" after the override');
        await clickActor(back, name);
        await mustWait(() => Object.keys(verdictOverrides(settings)).length === 0, 3000, name, 'Back to automatic left an override');
        await mustWait(() => !back.mapped, 3000, name, '"Back to automatic" is still shown after it cleared the override');
        check(indicator.menu.isOpen && row.menu.isOpen, name,
            `after Back to automatic: menu open=${indicator.menu.isOpen}, row open=${row.menu.isOpen}`);
    } finally {
        indicator.menu.close(false);
        await mustWait(() => !indicator.menu.isOpen, 3000, name, 'the menu stayed open');
    }
    await mustWait(() => stageFind('payattention-indicator-label')?.text.startsWith(FIXTURE_TITLE), 3000, name,
        'the indicator did not return to the fixture meeting');
}

/** The travel choices of an in-person row: one kind of single-choice mark, in one column, the current one filled (PRD §4). */
async function checkMenuTravelMarks(name) {
    const indicator = Main.panel.statusArea.payattention;
    try {
        const row = await openFixtureRow(name, indicator, 'Smoke all-day site visit');
        const lines = findAll(row.menu.actor, a => a instanceof PopupMenu.PopupMenuItem && /^\d+ min$/.test(a.label?.text ?? ''));
        const texts = lines.map(l => l.label.text);
        check(JSON.stringify(texts) === JSON.stringify(['10 min', '15 min', '20 min', '30 min', '45 min', '60 min', '90 min']),
            name, `travel lines are ${JSON.stringify(texts)}`);
        const marks = lines.map(l => findAll(l, a => a instanceof St.Icon && a.has_style_class_name('popup-menu-ornament'))[0]);
        marks.forEach((mark, i) => check(mark?.mapped, name, `${texts[i]} has no mapped mark`));

        const xs = marks.map(m => m.get_transformed_position()[0]);
        check(Math.max(...xs) - Math.min(...xs) <= 0.5, name,
            `marks not in one column: ${lines.map((l, i) => `${l.label.text} x=${xs[i]}`).join('; ')}`);

        const kinds = marks.map((m, i) => `${texts[i]}=${m.icon_name}`).join('; ');
        check(marks.every(m => m.icon_name === 'ornament-dot-checked-symbolic' || m.icon_name === 'ornament-dot-unchecked-symbolic'),
            name, `not one kind of single-choice mark: ${kinds}`);
        const checked = texts.filter((t, i) => marks[i].icon_name === 'ornament-dot-checked-symbolic');
        check(checked.length === 1 && checked[0] === '30 min', name, `the filled mark is not on 30 min alone: ${kinds}`);
    } finally {
        indicator.menu.close(false);
        await mustWait(() => !indicator.menu.isOpen, 3000, name, 'the menu stayed open');
    }
}

// Shown means mapped: hidden lines stay in the tree (PG-15).
const travelLines = row => findAll(row.menu.actor, a => a instanceof PopupMenu.PopupMenuItem && a.mapped &&
    /^\d+ min$/.test(a.label?.text ?? ''));
const markOf = line => findAll(line, a => a instanceof St.Icon && a.has_style_class_name('popup-menu-ornament'))[0]?.icon_name;
/** The shown travel choices of row whose round mark is filled. */
const filledChoices = row => travelLines(row).filter(l => markOf(l) === 'ornament-dot-checked-symbolic').map(l => l.label.text);
const unpacked = (settings, key) => settings.get_value(key).recursiveUnpack();

/**
 * A meeting with no place, switched to in person, gets the travel choices, and a
 * pick is saved for its series in meeting-travel-times, not travel-times (D-039, ADR-0014).
 * The switches and the pick all happen in one opening of the menu (PG-15).
 */
async function checkPlacelessTravel(name, ext) {
    const indicator = Main.panel.statusArea.payattention;
    const settings = ext.stateObj.getSettings();
    const title = 'Smoke all-day workshop';
    const open = row => `menu open=${indicator.menu.isOpen}, row open=${row.menu.isOpen}`;
    try {
        const row = await openFixtureRow(name, indicator, title);
        check(travelLines(row).length === 0, name, 'the row has travel choices while online with no place');
        const switchItem = shownMenuLine(row, 'Switch to in person');
        check(switchItem, name, 'no "Switch to in person" in the row');
        const switched = await clickActor(switchItem, name);
        await mustWait(() => Object.values(unpacked(settings, 'mode-overrides')).includes('in-person'), 3000, name,
            `the switch stored no in-person override (${switched})`);

        const lines = await mustWait(() => (travelLines(row).length === 7 ? travelLines(row) : null), 3000, name,
            'the switched row, without reopening, does not show seven travel choices');
        check(indicator.menu.isOpen && row.menu.isOpen, name, `after Switch to in person: ${open(row)}`);
        check(shownMenuLine(row, 'Switch to online'), name, 'the switched row offers no "Switch to online"');

        const placeTravel = JSON.stringify(unpacked(settings, 'travel-times'));
        const pick = lines.find(l => l.label.text === '45 min');
        check(pick, name, 'no "45 min" choice');
        const picked = await clickActor(pick, name);
        const want = JSON.stringify({ 'series:smoke-workshop@smoke.test': 45 });
        await mustWait(() => JSON.stringify(unpacked(settings, 'meeting-travel-times')) === want, 3000, name,
            `meeting-travel-times is not ${want} (${picked})`);
        check(JSON.stringify(unpacked(settings, 'travel-times')) === placeTravel, name, 'the pick changed travel-times');
        check(indicator.menu.isOpen && row.menu.isOpen, name, `after the pick: ${open(row)}`);
        const header = await mustWait(() => shownMenuLine(row, 'Travel time: 45 min'), 3000, name,
            'the open row does not read "Travel time: 45 min"');
        check(!header.sensitive, name, 'the travel header is clickable');
        check(JSON.stringify(filledChoices(row)) === JSON.stringify(['45 min']), name,
            `the filled mark is on ${JSON.stringify(filledChoices(row))}, want 45 min alone`);

        // Past a tick: the row stays open.
        await Scripting.sleep(1500);
        check(indicator.menu.isOpen && row.menu.isOpen, name, `a tick after the pick: ${open(row)}`);

        const toOnline = shownMenuLine(row, 'Switch to online');
        check(toOnline, name, 'no "Switch to online" after the pick');
        await clickActor(toOnline, name);
        await mustWait(() => travelLines(row).length === 0, 3000, name, 'the travel choices still show after Switch to online');
        check(indicator.menu.isOpen && row.menu.isOpen, name, `after Switch to online: ${open(row)}`);
    } finally {
        indicator.menu.close(false);
        settings.reset('mode-overrides');
        settings.reset('meeting-travel-times');
        await mustWait(() => !indicator.menu.isOpen, 3000, name, 'the menu stayed open');
    }
}

/** The normal bundle's menu offers no Test alert, even with show-test-alert stored as true (D-037, ADR-0013). */
async function checkMenuNoTestAlert(name, ext) {
    check(!Object.hasOwn(ext.metadata, 'payattention-developer'), name, 'the smoke is not running the normal bundle');
    check(!ext.stateObj.getSettings().settings_schema.has_key('show-test-alert'), name, 'the installed schema still has show-test-alert');
    const indicator = Main.panel.statusArea.payattention;
    const item = findByName(indicator.menu.actor, 'payattention-menu-test-alert');
    check(item, name, 'no Test alert menu item actor');
    try {
        indicator.menu.open(false);
        await mustWait(() => indicator.menu.actor.mapped, 3000, name, 'the menu did not open');
        check(!item.visible && !item.mapped, name, 'the normal bundle\'s menu offers Test alert');
    } finally {
        indicator.menu.close(false);
        await mustWait(() => !indicator.menu.isOpen, 3000, name, 'the menu stayed open');
    }
}

/** Every action button of the takeover lies inside its own monitor. */
function buttonsOnScreen(panels, monitors) {
    const outside = [];
    panels.forEach((panel, i) => {
        const m = monitors[i];
        const buttons = findAll(panel, a => a.name?.startsWith('payattention-action-'));
        if (buttons.length === 0)
            outside.push(`${i}: no buttons`);
        for (const b of buttons) {
            const [x, y] = b.get_transformed_position();
            const [w, h] = b.get_transformed_size();
            if (!b.mapped || x < m.x || y < m.y || x + w > m.x + m.width || y + h > m.y + m.height)
                outside.push(`${i}: ${b.name} at ${x},${y} ${w}x${h} (monitor ${m.x},${m.y} ${m.width}x${m.height})`);
        }
    });
    return outside;
}

/** Each title shows at most two lines, and the long one is ellipsized. */
function titleProblems(root) {
    return findAll(root, a => a.has_style_class_name?.('payattention-title')).flatMap(t => {
        const layout = t.clutter_text.get_layout();
        const [w, h] = t.clutter_text.get_size();
        return layout.get_line_count() <= 2 && layout.is_ellipsized() ? []
            : [`${layout.get_line_count()} lines, ellipsized=${layout.is_ellipsized()}, ${w}x${h}`];
    });
}

/** Travel texts under root that are ellipsized, narrower than their natural width, or off every monitor. */
function travelTextProblems(root) {
    const isTravelText = a => a.name === 'payattention-travel-text' || a.name === 'payattention-travel-change' ||
        a.name === 'payattention-travel-unit' || !!a.name?.startsWith('payattention-travel-choice-');
    return findAll(root, isTravelText).flatMap(a => {
        // A button's text is wherever St put it in the button (a `label:` button's child is not an St.Label).
        const text = findAll(a, t => t instanceof Clutter.Text)[0];
        if (!text)
            return [`${a.name}: no text actor under ${a.get_child?.()?.constructor.name ?? a.constructor.name}`];
        const ellipsized = text.get_layout().is_ellipsized();
        const width = text.get_width();
        const natural = text.get_preferred_width(-1)[1];
        const [x, y] = a.get_transformed_position();
        const [w, h] = a.get_transformed_size();
        const inside = Main.layoutManager.monitors.some(m =>
            x >= m.x && y >= m.y && x + w <= m.x + m.width && y + h <= m.y + m.height);
        return !ellipsized && width >= natural - 0.5 && a.mapped && inside ? []
            : [`${a.name}: ellipsized=${ellipsized} width=${width}/${natural}`];
    });
}

/** How the open travel row of card breaks PRD §4: on more than one line, or wider than the card's content. */
function travelRowProblems(card) {
    const content = card.actor.get_first_child();
    const max = card.actor.get_theme_node().get_max_width();
    const row = findByName(card.actor, 'payattention-travel-choices');
    if (!row)
        return ['no payattention-travel-choices'];
    // The unit is optional here, so that a row without it fails on its lines, not on a missing label.
    const items = [findByName(row, 'payattention-travel-unit'),
        ...findAll(row, a => !!a.name?.startsWith('payattention-travel-choice-'))].filter(a => a);
    const centres = items.map(a => {
        const [, y] = a.get_transformed_position();
        const [, h] = a.get_transformed_size();
        return Math.round(y + h / 2);
    });
    const [cx] = content.get_transformed_position();
    const [cw] = content.get_transformed_size();
    const [rx] = row.get_transformed_position();
    const [rw] = row.get_transformed_size();
    // Before its first layout St reports NaN, and NaN compares false with everything: never pass on it.
    if (![...centres, cx, cw, rx, rw].every(Number.isFinite))
        return [`the travel row is not laid out (y-centres ${centres.join(', ')}, row ${rx}+${rw}, content ${cx}+${cw})`];
    const problems = [];
    if (Math.max(...centres) - Math.min(...centres) > 1) {
        const distinct = [...new Set(centres)];
        problems.push(`the travel row is on ${distinct.length} lines (y-centres ${distinct.join(', ')})`);
    }
    if (!(max > 0))
        problems.push(`no max-width on the card (${max})`);
    else if (cw > max + 0.5)
        problems.push(`the card's content is ${cw} px, more than its ${max} px`);
    if (rx < cx - 0.5 || rx + rw > cx + cw + 0.5)
        problems.push(`the travel row (${rx}..${rx + rw}) runs outside the card's content (${cx}..${cx + cw})`);
    return problems;
}

/** Buttons of root that are not wholly inside one monitor. */
function buttonsOffMonitors(root) {
    return findAll(root, a => a.name?.startsWith('payattention-action-')).flatMap(b => {
        const [x, y] = b.get_transformed_position();
        const [w, h] = b.get_transformed_size();
        const inside = Main.layoutManager.monitors.some(m =>
            x >= m.x && y >= m.y && x + w <= m.x + m.width && y + h <= m.y + m.height);
        return b.mapped && inside ? [] : [`${b.name} at ${x},${y} ${w}x${h} mapped=${b.mapped}`];
    });
}

/** The widest and tallest alert: a 150-character title, Join, whole series and three "also" lines. */
const WORST_ALERT = Object.freeze({
    key: 'occ:smoke-worst|0', isTest: false, step: 4, presentation: 'takeover',
    headline: 'Your meeting is starting',
    title: 'Quarterly business review with the regional partners, the finance team and the external auditors about the budget plan for next year, part two (draft)',
    timeLine: 'Starts at 10:00 AM · in less than a minute', countdown: '0:30', countdownCaption: 'until it starts',
    reason: "Why: important: 'client'", travel: null,
    also: ['also: Design sync at 10:00 AM', 'also: Hiring panel at 10:00 AM', 'also: Vendor call at 10:00 AM'],
    canJoin: true, offerSeries: true,
});

/** An in-person heads-up with the default travel time: the travel line and the boxes (PRD §4). */
const IN_PERSON_ALERT = Object.freeze({
    key: 'occ:smoke-visit|0', isTest: false, step: 1, presentation: 'card',
    headline: 'Heads-up', title: 'Site visit', timeLine: 'Leave by 10:00 AM · in 10 min',
    countdown: '10:00', countdownCaption: 'until you leave', reason: 'Why: important: \'client\'',
    travel: {
        target: { kind: 'meeting', key: 'series:smoke-visit' }, minutes: 30, text: 'Travel: 30 min (default)',
        choices: [10, 15, 20, 30, 45, 60, 90], choicesOpen: false,
    },
    also: [], canJoin: false, offerSeries: false,
});

/** Menu rows for 6e-menu-rows: synthetic Views, so the check needs no calendar and no tick (PG-15). */
const ROW_A = Object.freeze({
    key: 'occ:smoke-a|1', label: '09:00  Smoke row A', detail: 'Ignorable · online', reason: 'Why: a',
    isMust: false, overridden: false, recurring: true, mode: 'online', otherMode: 'in-person',
    modeSwitchLabel: 'Switch to in person', travel: null,
});
const ROW_B = Object.freeze({
    key: 'occ:smoke-b|1', label: '10:00  Smoke row B', detail: 'Must attend · in person', reason: 'Why: b',
    isMust: true, overridden: false, recurring: false, mode: 'in-person', otherMode: 'online',
    modeSwitchLabel: 'Switch to online',
    travel: Object.freeze({
        target: { kind: 'place', key: 'smoke-place' }, minutes: 30, header: 'Travel time: 30 min (default)',
        choices: [10, 15, 20, 30, 45, 60, 90],
    }),
});
const ROW_C = Object.freeze({ ...ROW_A, key: 'occ:smoke-c|1', label: '08:00  Smoke row C', recurring: false });

/** WORST_ALERT, drawn by the installed UI modules as a takeover and as each card. */
async function checkWorstCase(name, home) {
    const base = `file://${home}/data/gnome-shell/extensions/${UUID}/ui`;
    const { Takeover } = await import(`${base}/takeover.js`);
    const { Card } = await import(`${base}/card.js`);
    const alert = WORST_ALERT;
    check(alert.title.length === 150, name, `the title is ${alert.title.length} characters`);

    const takeover = new Takeover();
    try {
        takeover.show(alert, () => {});
        const root = stageFind('payattention-takeover');
        check(root, name, 'the takeover did not appear');
        const panels = Main.layoutManager.monitors.map((_m, i) => findByName(root, `payattention-takeover-monitor-${i}`));
        await mustWait(() => buttonsOnScreen(panels, Main.layoutManager.monitors).length === 0, 2000, name,
            `a takeover button is off its monitor (${buttonsOnScreen(panels, Main.layoutManager.monitors).join('; ')})`);
        check(findByName(root, 'payattention-action-ignore-series'), name, 'no whole-series button');
        await mustWait(() => titleProblems(root).length === 0, 2000, name, `takeover title: ${titleProblems(root).join('; ')}`);
    } finally {
        takeover.hide();
    }

    for (const step of [1, 2, 3]) {
        const travel = step <= 2 ? { target: { kind: 'meeting', key: 'series:smoke-visit' }, minutes: 30, text: 'Travel: 30 min', choices: [10, 15, 20, 30, 45, 60, 90], choicesOpen: false } : null;
        const card = new Card({ ...alert, step, presentation: 'card', travel }, () => {});
        try {
            await mustWait(() => card.actor.mapped && buttonsOffMonitors(card.actor).length === 0, 2000, name,
                `a step-${step} card button is off screen (${buttonsOffMonitors(card.actor).join('; ')})`);
            await mustWait(() => titleProblems(card.actor).length === 0, 2000, name,
                `step-${step} card title: ${titleProblems(card.actor).join('; ')}`);
        } finally {
            card.destroy();
        }
    }
}

/**
 * IN_PERSON_ALERT's "Change time" is a link that asks the controller to
 * toggle the choices (the UI holds no open state, interfaces.md §3); drawn open, the
 * boxes are all there and every travel text reads in full (PRD §4).
 */
async function checkTravelChoices(name, home) {
    const { Card } = await import(`file://${home}/data/gnome-shell/extensions/${UUID}/ui/card.js`);
    for (const step of [1, 2]) {
        const alert = { ...IN_PERSON_ALERT, step, headline: step === 1 ? 'Heads-up' : 'Get ready' };
        const actions = [];
        const closed = new Card(alert, action => actions.push(action));
        try {
            await mustWait(() => closed.actor.mapped, 2000, name, `the closed step-${step} card was never mapped`);
            const change = findByName(closed.actor, 'payattention-travel-change');
            check(change, name, `step-${step} card: no payattention-travel-change`);
            const clicked = await clickActor(change, name);
            await mustWait(() => actions.length > 0, 2000, name,
                `step-${step} card: Change time dispatched nothing (${clicked})`);
            const want = JSON.stringify([{ type: 'toggleTravelChoices', key: IN_PERSON_ALERT.key }]);
            check(JSON.stringify(actions) === want, name, `step-${step} card: dispatched ${JSON.stringify(actions)}, want ${want}`);
            check(!findByName(closed.actor, 'payattention-travel-choices')?.mapped, name,
                `step-${step} card: the travel choices opened by themselves`);
            // mapped, not visible: the label inside a hidden row keeps visible === true.
            check(!findByName(closed.actor, 'payattention-travel-unit')?.mapped, name,
                `step-${step} card: the "min:" label shows while the choices are closed`);
        } finally {
            closed.destroy();
        }

        const openActions = [];
        const card = new Card({ ...alert, travel: { ...alert.travel, choicesOpen: true } }, action => openActions.push(action));
        try {
            await mustWait(() => card.actor.mapped, 2000, name, `the open step-${step} card was never mapped`);
            const change = findByName(card.actor, 'payattention-travel-change');
            check(change, name, `open step-${step} card: no payattention-travel-change`);
            await mustWait(() => findByName(card.actor, 'payattention-travel-choices')?.visible, 2000, name,
                `step-${step} card: the travel choices are not drawn open`);
            const boxes = findAll(card.actor, a => !!a.name?.startsWith('payattention-travel-choice-'));
            check(boxes.length === 7, name, `step-${step} card: ${boxes.length} travel choices, want 7`);
            const current = boxes.filter(b => b.has_style_class_name('payattention-choice-current')).map(b => b.name);
            check(current.length === 1 && current[0] === 'payattention-travel-choice-30', name,
                `step-${step} card: marked as current: ${current.join(', ') || 'none'}`);
            // The message is taken after the wait: before layout it would only say "not laid out".
            await waitFor(() => travelRowProblems(card).length === 0, 2000);
            check(travelRowProblems(card).length === 0, name, `step-${step} card: ${travelRowProblems(card).join('; ')}`);
            await waitFor(() => travelTextProblems(card.actor).length === 0, 2000);
            check(travelTextProblems(card.actor).length === 0, name, `step-${step} card: ${travelTextProblems(card.actor).join('; ')}`);
            for (const box of boxes) {
                const text = findAll(box, t => t instanceof Clutter.Text)[0]?.text;
                check(text === box.name.slice('payattention-travel-choice-'.length), name,
                    `step-${step} card: ${box.name} reads "${text}", want the number only`);
            }
            const row = findByName(card.actor, 'payattention-travel-choices');
            const unit = findByName(card.actor, 'payattention-travel-unit');
            check(unit, name, `step-${step} card: no payattention-travel-unit`);
            check(unit.text === 'min:', name, `step-${step} card: the unit reads "${unit.text}", want "min:"`);
            check(unit.get_parent() === row, name, `step-${step} card: the "min:" label is not in the travel row`);
            check(row.get_first_child() === unit, name, `step-${step} card: the "min:" label is not first in the travel row`);
            // clickActor left the pointer where the closed card's link was, and this card draws its link there: check it at rest.
            change.hover = false;
            check(!change.has_key_focus(), name, `step-${step} card: the Change time link has key focus, so its at-rest look cannot be checked`);
            const text = change.get_child();
            const node = change.get_theme_node();
            const ack = findByName(card.actor, 'payattention-action-ack');
            check(change instanceof St.Button, name, `step-${step} card: the Change time link is a ${change.constructor.name}, not an St.Button`);
            check(text.text === 'Change time', name, `step-${step} card: the link reads "${text.text}", want "Change time"`);
            check(change.has_style_class_name('payattention-travel-change') && !change.has_style_class_name('payattention-button'), name,
                `step-${step} card: the Change time link is styled as a card button ("${change.get_style_class_name()}")`);
            check((text.get_theme_node().get_text_decoration() & St.TextDecoration.UNDERLINE) !== 0, name,
                `step-${step} card: the Change time link is not underlined`);
            check(node.get_font().get_size() < ack.get_theme_node().get_font().get_size(), name,
                `step-${step} card: the Change time link is not smaller than the card's buttons`);
            check(node.get_background_color().alpha === 0, name, `step-${step} card: the Change time link has a background`);
            const colour = text.get_theme_node().get_foreground_color().to_string();
            check(colour === '#99c1f1ff', name, `step-${step} card: the Change time link is ${colour}, want #99c1f1ff`);
            change.hover = true;
            const hovered = text.get_theme_node();
            check(hovered.get_foreground_color().to_string() === '#ffffffff', name,
                `step-${step} card: the hovered Change time link is ${hovered.get_foreground_color().to_string()}, want #ffffffff`);
            check((hovered.get_text_decoration() & St.TextDecoration.UNDERLINE) !== 0, name,
                `step-${step} card: the hovered Change time link is not underlined`);
            change.hover = false;
            // A pick hands back the View's travel target untouched (interfaces.md §3).
            const pick = await clickActor(findByName(card.actor, 'payattention-travel-choice-45'), name);
            await mustWait(() => openActions.length > 0, 2000, name, `step-${step} card: the 45 min pick dispatched nothing (${pick})`);
            const wantPick = JSON.stringify([{ type: 'setTravel', target: IN_PERSON_ALERT.travel.target, minutes: 45 }]);
            check(JSON.stringify(openActions) === wantPick, name,
                `step-${step} card: the pick dispatched ${JSON.stringify(openActions)}, want ${wantPick}`);
        } finally {
            card.destroy();
        }
    }
}

/**
 * The installed indicator, driven with synthetic Views: rows are redrawn in place, so an
 * open row stays open showing its new state, a drawn change is never reported as the
 * owner's, a row still listed stays open across a rebuild, and a travel pick after the
 * place changed carries the new place (PG-15).
 */
async function checkMenuRowsInPlace(name, home) {
    const { Indicator } = await import(`file://${home}/data/gnome-shell/extensions/${UUID}/ui/indicator.js`);
    await pointerDevice(name);
    const actions = [];
    const indicator = new Indicator({ dispatch: a => actions.push(a), openPreferences: () => {} });
    Main.panel.addToStatusArea('payattention-smoke-rows', indicator, 0, 'right');
    let n = 0;
    const draw = rows => indicator.update({ text: null, highlighted: false, flashing: false, warning: false },
        { status: null, aiStatus: null, showTestAlert: false, meetings: rows, signature: `smoke-${n++}` });
    const rowItems = () => findAll(indicator.menu.actor, a => a instanceof PopupMenu.PopupSubMenuMenuItem);
    const rowTitled = title => menuRow(indicator, title);
    const switchOf = row => findAll(row.menu.actor, a => a instanceof PopupMenu.PopupSwitchMenuItem)[0];
    const state = () => `menu open=${indicator.menu.isOpen}; rows ${rowItems().map(r => `${r.label.text} open=${r.menu.isOpen}`).join(', ')}`;

    try {
        // a. Two rows; the owner opens B.
        draw([ROW_A, ROW_B]);
        await mustWait(() => rowTitled('Smoke row A') && rowTitled('Smoke row B'), 3000, name, 'rows A and B were not drawn');
        indicator.menu.open(false);
        const rowA = rowTitled('Smoke row A');
        const rowB = rowTitled('Smoke row B');
        rowB.setSubmenuShown(true);
        await mustWait(() => rowB.menu.actor.mapped, 3000, name, 'row B did not open');

        // b. A new travel time: the same row, still open, the header and the mark moved.
        draw([ROW_A, { ...ROW_B, travel: { ...ROW_B.travel, minutes: 45, header: 'Travel time: 45 min' } }]);
        // Ends on either outcome, so the checks below say which one happened.
        await mustWait(() => rowTitled('Smoke row B') !== rowB || shownMenuLine(rowB, 'Travel time: 45 min'), 3000, name,
            'row B neither redrew nor was replaced');
        check(rowTitled('Smoke row B') === rowB, name, `row B was rebuilt, not redrawn (${state()})`);
        check(shownMenuLine(rowB, 'Travel time: 45 min'), name, 'row B does not read "Travel time: 45 min"');
        check(rowB.menu.isOpen && indicator.menu.isOpen, name, `after a travel change: ${state()}`);
        check(!rowA.menu.isOpen, name, 'row A opened by itself');
        check(JSON.stringify(filledChoices(rowB)) === JSON.stringify(['45 min']), name,
            `the filled mark is on ${JSON.stringify(filledChoices(rowB))}, want 45 min alone`);

        // c. Switched to online: the travel lines are gone, the switch offers in person.
        const online = { ...ROW_B, mode: 'online', otherMode: 'in-person', modeSwitchLabel: 'Switch to in person',
            detail: 'Must attend · online', travel: null };
        draw([ROW_A, online]);
        await mustWait(() => travelLines(rowB).length === 0 && shownMenuLine(rowB, 'Switch to in person') &&
            rowDetail(rowB) === 'Must attend · online', 3000, name, 'row B did not show itself online');
        check(rowTitled('Smoke row B') === rowB && rowB.menu.isOpen && indicator.menu.isOpen, name, `after online: ${state()}`);

        // d. Back in person: the seven choices are in the same open row.
        draw([ROW_A, ROW_B]);
        await mustWait(() => travelLines(rowB).length === 7, 3000, name, 'row B does not show seven travel lines');
        check(rowTitled('Smoke row B') === rowB && rowB.menu.isOpen, name, `after in person: ${state()}`);

        // e. An override drawn from the View: the switch follows, and nothing is reported.
        draw([ROW_A, { ...ROW_B, isMust: false, overridden: true, detail: 'Ignorable · in person · overridden' }]);
        const back = await mustWait(() => shownMenuLine(rowB, 'Back to automatic'), 3000, name, 'row B shows no "Back to automatic"');
        check(switchOf(rowB)?.state === false, name, `the Must attend switch is ${switchOf(rowB)?.state}, want off`);
        check(actions.length === 0, name, `a drawn change was reported as the owner's: ${JSON.stringify(actions)}`);

        // f. The focused line is hidden: the keyboard lands on the switch.
        back.grab_key_focus();
        check(back.has_key_focus(), name, '"Back to automatic" did not take key focus');
        draw([ROW_A, { ...ROW_B, isMust: false, detail: 'Ignorable · in person' }]);
        await mustWait(() => !back.mapped, 3000, name, '"Back to automatic" is still shown');
        check(switchOf(rowB).has_key_focus(), name,
            `the switch does not have key focus (focus on ${global.stage.get_key_focus()?.constructor.name})`);

        // g. A meeting came: rebuilt, and B is still open.
        draw([ROW_C, ROW_A, ROW_B]);
        await mustWait(() => rowItems().length === 3 && rowTitled('Smoke row C'), 3000, name, 'row C did not come');
        await mustWait(() => rowTitled('Smoke row B')?.menu.isOpen, 3000, name, 'row B is not open after the rebuild');
        check(!rowTitled('Smoke row A').menu.isOpen && !rowTitled('Smoke row C').menu.isOpen && indicator.menu.isOpen, name,
            `after a meeting came: ${state()}`);

        // h. B left: nothing open, the menu still is.
        draw([ROW_C, ROW_A]);
        await mustWait(() => rowItems().length === 2 && !rowTitled('Smoke row B'), 3000, name, 'row B did not leave');
        check(rowItems().every(r => !r.menu.isOpen) && indicator.menu.isOpen, name, `after B left: ${state()}`);

        // i. The owner's clicks in a row report the action and leave the menu and the row open.
        draw([ROW_C, ROW_A, ROW_B]);
        const rowB2 = await mustWait(() => rowTitled('Smoke row B'), 3000, name, 'row B did not come back');
        rowB2.setSubmenuShown(true);
        await mustWait(() => rowB2.menu.actor.mapped, 3000, name, 'row B did not open again');
        await Scripting.sleep(300);
        const clicks = [
            ['45 min', { type: 'setTravel', target: { kind: 'place', key: 'smoke-place' }, minutes: 45 }],
            ['Switch to online', { type: 'setMode', key: 'occ:smoke-b|1', mode: 'online' }],
        ];
        for (const [text, want] of clicks) {
            const line = shownMenuLine(rowB2, text);
            check(line, name, `row B shows no "${text}"`);
            const before = actions.length;
            const clicked = await clickActor(line, name);
            await mustWait(() => actions.length > before, 3000, name, `"${text}" reported nothing (${clicked})`);
            check(JSON.stringify(actions.at(-1)) === JSON.stringify(want), name,
                `"${text}" reported ${JSON.stringify(actions.at(-1))}, want ${JSON.stringify(want)}`);
            await Scripting.sleep(300);
            check(indicator.menu.isOpen && rowB2.menu.isOpen, name, `after "${text}": ${state()}`);
        }

        // j. The meeting's place changed, same choices: redrawn in place, a pick is saved under the new place.
        const moved = { kind: 'place', key: 'smoke-place-moved' };
        draw([ROW_C, ROW_A, { ...ROW_B, travel: { ...ROW_B.travel, target: moved } }]);
        await Scripting.sleep(300);
        check(rowTitled('Smoke row B') === rowB2 && rowB2.menu.isOpen, name, `after the place moved: ${state()}`);
        const pick = shownMenuLine(rowB2, '45 min');
        check(pick, name, 'row B shows no "45 min" after the place moved');
        const before = actions.length;
        const clicked = await clickActor(pick, name);
        await mustWait(() => actions.length > before, 3000, name, `"45 min" reported nothing after the place moved (${clicked})`);
        const wantMoved = { type: 'setTravel', target: moved, minutes: 45 };
        check(JSON.stringify(actions.at(-1)) === JSON.stringify(wantMoved), name,
            `after the place moved, "45 min" reported ${JSON.stringify(actions.at(-1))}, want ${JSON.stringify(wantMoved)}`);
    } finally {
        indicator.menu.close(false);
        indicator.destroy();
    }
}

/** A constructor that fails leaves nothing of ours on the stage. */
async function checkFailedConstruction(name, home) {
    const base = `file://${home}/data/gnome-shell/extensions/${UUID}/ui`;
    const { Ui } = await import(`${base}/ui.js`);
    const { Card } = await import(`${base}/card.js`);
    const menus = () => findAll(global.stage, a => a.name === 'payattention-menu').length;
    check(menus() === 1, name, `${menus()} menus before the check`);

    // The status-area role is taken by the running extension, so a second Ui fails.
    let error = null;
    try {
        new Ui({ dispatch: () => {}, openPreferences: () => {} });
    } catch (e) {
        error = e;
    }
    check(error, name, 'a second Ui did not fail');
    check(menus() === 1, name, `${menus()} menus after a failed Ui (${error})`);

    // A failure after addChrome: placing the card throws.
    const layout = Main.layoutManager;
    layout.getWorkAreaForMonitor = () => {
        throw new Error('smoke: injected work-area failure');
    };
    error = null;
    try {
        new Card({ ...WORST_ALERT, step: 1, presentation: 'card' }, () => {});
    } catch (e) {
        error = e;
    } finally {
        delete layout.getWorkAreaForMonitor;
    }
    check(error?.message === 'smoke: injected work-area failure', name, `the card did not fail as injected (${error})`);
    check(!stageFind('payattention-card'), name, 'the card of a failed construction is still on the stage');
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
    await checkMenuVerdict('2-menu-verdict', ext);
    await checkMenuTravelMarks('2b-menu-travel');
    await checkMenuNoTestAlert('2c-menu-test-alert', ext);
    await checkPlacelessTravel('2d-placeless-travel', ext);

    // 3. The test ladder, step by step.
    // Records which sound the ladder asks for. It does not call through: the headless
    // shell has no audio.
    const soundCalls = [];
    const realPlay = Meta.SoundPlayer.prototype.play_from_theme;
    Meta.SoundPlayer.prototype.play_from_theme = function (name, description) {
        soundCalls.push({ name, description });
    };
    try {
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
        check(soundCalls.length === 2 && soundCalls.every(c => c.name === 'bell-window-system' && c.description === 'payAttention alert'),
            '3-sound', `sound calls: ${JSON.stringify(soundCalls)}`);

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
        await mustWait(() => buttonsOnScreen(panels, monitors).length === 0, 2000, '4-takeover',
            `a button is off its monitor (${buttonsOnScreen(panels, monitors).join('; ')})`);
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
        const clicked = await clickActor(ack, '6-ack');
        await mustWait(() => !stageFind('payattention-takeover') && !stageFind('payattention-card') &&
            ourModalEntries().length === 0 && !grabIsOurs(), 2000, '6-ack', `the takeover or our grab remains (${clicked})`);
        await Scripting.sleep(3000);
        check(!stageFind('payattention-takeover') && !stageFind('payattention-card'), '6-ack', 'an alert came back');
        check(aiHelperPids(home).length === 0, '6-ack', `rules mode: an AI helper ran during the ladder (${aiHelperPids(home).length})`);

        // 6b. The worst-case alert keeps every button on screen and the title to two lines.
        await checkWorstCase('6b-worst-case', home);

        // 6c. A UI constructor that fails cleans up after itself.
        await checkFailedConstruction('6c-failed-construction', home);

        // 6d. The travel boxes of an in-person card open from a button and read in full.
        await checkTravelChoices('6d-travel-choices', home);

        // 6e. The menu redraws a meeting's row in place, so an open row stays open (PG-15).
        await checkMenuRowsInPlace('6e-menu-rows', home);

        // 7. Disable: nothing of ours remains.
        await checkDisabled('7-disable', home);

        // 8. The lock path: disable while a takeover holds the grab.
        Main.extensionManager.enableExtension(UUID);
        await mustWait(() => Main.extensionManager.lookup(UUID)?.state === ACTIVE, 10000, '8-lock', 're-enable failed');
        await checkIndicator('8-lock', home);
        Main.extensionManager.lookup(UUID).stateObj.runTestAlert();
        await mustWait(() => stageFind('payattention-takeover'), 45000, '8-lock', 'no takeover after re-enable');
        await checkDisabled('8-lock', home);

        // 9. Uninstall while a takeover holds the grab: the extension is gone afterwards.
        await checkUninstall('9-uninstall', home);

        // 10. Last: install.sh switches over from a former copy the shell has loaded.
        await checkSwitchOver('10-switch-over', home);
    } finally {
        Meta.SoundPlayer.prototype.play_from_theme = realPlay;
    }
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
