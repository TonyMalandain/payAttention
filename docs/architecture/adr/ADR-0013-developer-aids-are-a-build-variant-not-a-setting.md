# ADR-0013 — Developer aids are a build variant, marked in the bundle's metadata.json, never a setting
- **Date:** 2026-10-01
- **Kind:** reversible. Nothing stored depends on it; the one stored trace it
  removes (`show-test-alert`) is inert and erased by `--purge` (`data.md`,
  "Removed keys").

## Context

PG-12 (D-036) hid "Test alert" behind a Settings switch, `show-test-alert`.
The owner rejected it: "The test alert is a dev feature. What's the point of
having a dev feature activable via settings? I meant we should use a feature
flag either triggered at build time or runtime via a command line argument or
config file option when running the mutter-devkit". D-037 closes the product
side: a normal install never shows it and has no switch; `npm run sample`
always shows it; the developer can put a copy with it into the real desktop on
purpose (for the PG-2 checks a nested window cannot do: alert sound, both
monitors, takeover over a full-screen window, PaperWM), and the normal install
command removes it; the smoke checks both.

Facts that bind the choice (measured 2026-10-01 on the owner's machine):

- `gnome-extensions pack` copies `metadata.json` verbatim, including a key the
  shell does not know.
- `gnome-extensions install --force` replaces the install directory wholesale:
  a file only in the earlier zip is gone afterwards.
- The shell parses the whole `metadata.json` and hands it to the extension as
  `this.metadata` (`misc/extensionUtils.js`, `extensions/sharedInternals.js` in
  the 50 resource bundle). Reading it costs us no I/O.
- The real session is Wayland. gnome-shell's environment is fixed at login by
  the user's systemd manager; nothing passes it a per-run argument.
- `constraints.md`: no synchronous I/O in the shell process; ADR-0003: no files
  of our own on disk.

## Options

1. **A build variant: a developer bundle whose `metadata.json` carries
   `"payattention-developer": true`.** `extension.js` reads it from
   `this.metadata`. The sample installs the developer bundle; a developer can
   install it into the real session with one command; the normal install
   overwrites it. Forever cost: two bundles from one build, and a build check
   that the normal one has no marker. The shipped bundle still carries the
   (inert) test alert code.
2. **A setting** (D-036, built in PG-12). Rejected by the owner: a setting is
   a promise to every user (D-037).
3. **An environment variable of gnome-shell.** Works in the sample, which
   already passes allowlisted extras. In the real session it needs
   `environment.d` or `systemctl --user set-environment` and a login, then
   applies to the whole session and survives every reinstall, so the normal
   install command cannot remove it. Fails D-037.
4. **A marker file.** In `~/.config`: needs a file read in the shell process,
   breaks "no files of our own" (ADR-0003), and survives a normal install.
   In the install directory: the normal install would remove it, but it is
   still a file read of ours for something the shell already reads for us in
   `metadata.json`.
5. **A generated JavaScript module** (`devBuild.js` overwritten by the
   developer build). Equivalent at run time, but the two bundles then differ in
   code, and the source tree needs a checked-in default that a failed build
   could leave overwritten. Data in `metadata.json` is the smaller difference.
6. **Strip the test alert from the normal bundle at build time.** A
   preprocessor, two code bases, and the smoke could no longer drive the
   ladder on the bundle that ships. Kept only as the answer if an
   extensions.gnome.org reviewer objects to the inert code (`constraints.md`).

## Decision

Option 1. **The deciding reason: it is the only carrier that the normal
install command removes by construction, that costs no I/O of ours, and that
works the same in the nested sample and the real Wayland session with nothing
to set per session.**

Binding rules (contract in `interfaces.md` §4.1):

- The marker is `"payattention-developer": true` in the bundled
  `metadata.json`, strictly `true`. Never in `extension/metadata.json`, and no
  build step writes into the working tree.
- `dist/<uuid>.shell-extension.zip` is always the normal bundle;
  `dist/<uuid>.developer.shell-extension.zip` is the developer bundle. The build
  checks each one's marker.
- Only `extension.js` reads it, and hands the controller one boolean. No
  setting, no environment variable, no file of ours.
- It gates only the menu's Test alert item. `runTestAlert()` stays ungated in
  every build (`interfaces.md` §4).
- Commands: `npm run sample` (developer bundle, always);
  `npm run install:developer` (developer bundle into the real session);
  `npm run install:local` (normal bundle, replaces a developer copy). Both
  installs load at the next login on Wayland.
- `show-test-alert` leaves the schema; stored values stay inert until
  `--purge` (`data.md`, "Removed keys").

## Consequences

- Easier: the owner's Settings and menu carry nothing for developers; the
  sample needs no viewing-aid setting for it; the smoke tests the bundle that
  ships, and the sample check tests the developer one.
- Harder: there are two bundles, so "which copy is installed" is a question;
  it is answered by the marker in the installed `metadata.json`
  (`testing-and-build.md`). A developer who forgets to reinstall the normal
  copy keeps a visible but harmless Test alert item.
- A developer aid can no longer be turned on in a running session; it takes an
  install and a login, like any code change on Wayland.
- Any future developer-only aid uses this marker and is recorded in
  `interfaces.md` §4.1; none becomes a setting.

## Revisit when

- An extensions.gnome.org reviewer objects to the inert test alert code, or to
  a non-standard key (it never ships, but a reviewer may see the build script):
  move to option 6 for that code.
- GNOME Shell gains a supported per-extension developer or debug flag.
- A developer aid is needed that must be switched on without a login.
