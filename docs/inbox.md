# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## for-architecture — headless smoke: virtual input devices are unreliable on their first events (PG-1c)

Measured in headless gnome-shell 50.4 while building the PG-1c smoke test: the
first `notify_absolute_motion` from a newly created virtual pointer lost its x
(pointer landed at x=0), and in one run a later motion stopped at the edge of
monitor 0 (x=1280) instead of reaching monitor 1. `tests/smoke/alert-ladder.js`
now re-sends the motion until `global.get_pointer()` is at the target, and checks
that the Escape key actually reached the takeover (so "Escape does nothing"
cannot pass on a lost key event). If nobody records this in the "Pitfalls" of
`testing-and-build.md`, the next smoke test that clicks with a virtual pointer
will be flaky again (1 of 6 runs failed before the fix).

## for-architecture — the smoke isolates the session bus and XDG dirs, not the system bus (PG-1c)

`env -i` + `dbus-run-session` gives the headless shell a private session bus and
private XDG directories, as `testing-and-build.md` requires. The system bus is
still the real one: the headless shell logs "Registering display with GDM", and
`shell/environment.js` connects to logind's `prepare-for-sleep` through it. Nothing
observed was harmful, but "never touches the owner's session" holds for the
session bus, calendars and settings only. Worth stating as the known isolation
boundary, or deciding it is not acceptable.

## for-architecture — shell modules under plain gjs lack `connectObject` (PG-1c)

`connectObject`/`disconnectObject` are added to GObject by the shell's
`misc/signalTracker.js`, so they do not exist in a plain `gjs` process.
`tests/smoke/store-check.js` therefore installs a small stand-in on the
`Gio.Settings` it passes to `Store`. Any future GJS check of a `shell/` module
that uses `connectObject` needs the same; if that becomes common, a shared test
helper (or a rule about where such checks run) should be decided.
