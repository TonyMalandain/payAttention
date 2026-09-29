// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// A stand-in for gnome-shell on a private session bus, for
// tests/smoke/uninstall-check.sh only: it owns org.gnome.Shell and answers
// org.gnome.Shell.Extensions.GetExtensionInfo the way gnome-shell 50.5 does, so
// the scripts' real gdbus query sees UNKNOWN or LOADED (testing-and-build.md,
// "Switching an existing install to the new UUID"). Nothing else is served.
//
//   gjs -m fake-shell.js <loaded-file>
//
// <loaded-file> holds one UUID per line, re-read on every call; those UUIDs are
// LOADED, every other one is UNKNOWN. Prints FAKE-SHELL READY once it owns the name.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const IFACE = `<node>
  <interface name="org.gnome.Shell.Extensions">
    <method name="GetExtensionInfo">
      <arg type="s" direction="in" name="uuid"/>
      <arg type="a{sv}" direction="out" name="info"/>
    </method>
  </interface>
</node>`;

const [loadedFile] = System.programArgs;
if (!loadedFile) {
    printerr('usage: gjs -m fake-shell.js <loaded-file>');
    System.exit(2);
}

function loaded() {
    if (!GLib.file_test(loadedFile, GLib.FileTest.EXISTS))
        return [];
    const [, bytes] = GLib.file_get_contents(loadedFile);
    return new TextDecoder().decode(bytes).split('\n').filter(line => line !== '');
}

const service = {
    GetExtensionInfo(uuid) {
        // The real shell serialises the whole metadata; the scripts only look for the uuid entry.
        return loaded().includes(uuid) ? { uuid: new GLib.Variant('s', uuid) } : {};
    },
};

const loop = new GLib.MainLoop(null, false);
const exported = Gio.DBusExportedObject.wrapJSObject(IFACE, service);
Gio.bus_own_name(Gio.BusType.SESSION, 'org.gnome.Shell', Gio.BusNameOwnerFlags.NONE,
    connection => exported.export(connection, '/org/gnome/Shell'),
    () => print('FAKE-SHELL READY'),
    () => {
        printerr('fake-shell: could not own org.gnome.Shell on this bus');
        loop.quit();
    });
loop.run();
