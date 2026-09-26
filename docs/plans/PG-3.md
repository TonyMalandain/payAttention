# Plan — PG-3: remove payAttention with one command

Spec: `docs/prd/meeting-guardian.md`, "Addendum 2026-09-26 — Uninstall" (requirement R-17). Product decision D-016: keep saved choices unless the owner asks to erase them.

**Sensitive:** this touches the owner's live GNOME settings and deletes files and settings. The script must only ever act on the one install directory, on our UUID inside the two `org.gnome.shell` extension lists, and (with `--purge`) on `/org/gnome/shell/extensions/payattention/`. The tests must never reach the owner's session bus, dconf database or `~/.local/share`. Every test environment is built from scratch with `env -i`.

## What changes, and for whom

The installer (the owner) runs `npm run uninstall:local`:
- if payAttention is running, it stops at once, with nothing left on screen and no calendar helper left running;
- its files are removed;
- it no longer loads at login.

Saved settings are kept. `npm run uninstall:local -- --purge` also erases them. Running it again, or with nothing installed, succeeds and says so.

## The component

- **Responsible for:** the dev/owner tooling in `scripts/` that puts the built extension into the owner's session and takes it back out (`boundaries.md`: "build, install, smoke wrappers").
- **Has drifted by:** one latent inconsistency. `scripts/install.sh` installs with `gnome-extensions install`, which follows `XDG_DATA_HOME`. Its post-install check, however, hard-codes `$HOME/.local/share/...`. Uninstall must look for the files where install put them, so both scripts must resolve the directory the same way. This is fixed first (Step 1).
- **This change belongs here because:** removing an install serves the same responsibility as creating one. It is a sibling of `install.sh`, not new product code. Nothing under `extension/` changes. The running extension is already stopped correctly by its own `disable()` (ADR-0004/0005, proven by smoke step 8). Uninstall only has to make the shell call `disable()`.

### Facts measured for this plan (2026-09-26, gnome-shell 50.4, all in isolated homes and buses)

1. **Uninstalling through the running shell stops the extension at once.** `gnome-extensions uninstall <uuid>` calls the shell over D-Bus. The shell then calls `extensionManager.unloadExtension()`, which runs our `disable()` synchronously before the D-Bus reply, and deletes the install directory (`ui/extensionDownloader.js`).
   - Measured in a headless shell with the extension ACTIVE and a test-alert takeover holding the grab, spawned asynchronously from the automation script: exit 0; `lookup(uuid)` became undefined; 0 `payattention*` actors; no grab; directory gone; no helper process.
   - `gnome-extensions info <uuid>` then exits 2.
2. **The shell does not update the extension lists on uninstall.** It leaves the UUID in `org.gnome.shell enabled-extensions`, so the script must remove it.
3. **Disable writes a different list.** `gnome-extensions disable` (and the shell's `DisableExtension`) removes the UUID from `enabled-extensions` and *adds* it to `disabled-extensions`. The actual disable only happens later, on the settings-changed signal. So the script does not use `disable`: `uninstall` is the one call that stops the extension synchronously.
4. **Without a shell that knows the extension** (no shell on the bus, or the Wayland case "installed but not loaded until login"), both `gnome-extensions info` and `gnome-extensions uninstall` exit 2, in about 70 ms. Fallback: delete the directory ourselves.
5. **What `dconf reset -f` touches.**
   - `dconf reset -f /org/gnome/shell/extensions/payattention/` exits 0 even when the path is empty.
   - It does **not** touch `/org/gnome/shell/extensions/payattention-other/`: the trailing slash is an exact directory.
   - `dconf dump` of an empty path prints nothing.
6. **dconf can be fully isolated.** Use `env -i`, `HOME`, the four `XDG_*` variables and an own `XDG_RUNTIME_DIR` (mode 0700), under `dbus-run-session`. `ca.desrt.dconf` is then activated on the private bus and writes `$XDG_CONFIG_HOME/dconf/user`. The owner's database and shm file are never opened.
7. **A settings change reaches the headless shell.** `gjs` `Gio.Settings` writes under `GSETTINGS_BACKEND=keyfile` land in the smoke keyfile, and the shell's `global.settings` sees them.
8. **Subprocess calls need a hand-made promise inside the shell.** In the shell, `Gio.Subprocess.communicate_utf8_async` is not promisified: calling it with 2 arguments throws. Wrap it in a `Promise` with the callback form.

## Seams

### `scripts/uninstall.sh` (new) — the command-line contract

```
bash scripts/uninstall.sh [--purge] [--help]
npm run uninstall:local [-- --purge]
```

- **Arguments:**
  - no argument: stop, remove files, remove the UUID from both lists, keep settings;
  - `--purge`: also erase `/org/gnome/shell/extensions/payattention/`;
  - `--help` / `-h`: print the usage line and exit 0;
  - anything else: usage on stderr, exit 2, **nothing changed**.
- **Exit codes:**
  - `0`: done, including "nothing was installed";
  - `1`: a step failed; the message names the step;
  - `2`: usage error, or `--purge` refused (see below). Nothing changed.
- **Stdout, the exact lines.** Only the lines for things that actually happened are printed, in this order:
  ```
  Stopped: payAttention in the running session.
  Removed: <absolute install dir>
  Removed: payattention@tonymalandain.github.io from the enabled extensions.
  Removed: payattention@tonymalandain.github.io from the disabled extensions.
  Nothing to remove: payAttention is not installed.          (only if none of the four lines above printed)
  Erased: saved settings (/org/gnome/shell/extensions/payattention/).        (--purge)
  Kept: saved settings (/org/gnome/shell/extensions/payattention/). To erase them: npm run uninstall:local -- --purge   (no --purge)
  Calendars and other extensions were not touched.
  ```
- **Stderr on failure:** a single line starting `uninstall: `, then exit 1. Messages:
  - `uninstall: could not stop payAttention in the running session (gnome-extensions uninstall failed). Nothing was removed. Log out and in, then run this again.` Exit before any removal.
  - `uninstall: the running session still has payAttention loaded after uninstall.` This is the re-probe below.
  - `uninstall: could not remove payattention@tonymalandain.github.io from the GNOME extension lists. Run this from a terminal inside your GNOME session.`
  - `uninstall: could not erase /org/gnome/shell/extensions/payattention/. Run this from a terminal inside your GNOME session.`
- **Misuse designed out:**
  - Wrong arguments change nothing: they are parsed and validated before any action.
  - Purge cannot erase a store the settings do not live in. `--purge` with `GSETTINGS_BACKEND` set to anything other than empty or `dconf` exits 2 before any action, with this message: `uninstall: --purge erases the dconf database, but GSETTINGS_BACKEND=<value> keeps settings elsewhere. Nothing was changed.` This is exactly the smoke's keyfile case.
  - The directory to delete is built only from `${XDG_DATA_HOME:-$HOME/.local/share}` and the constant UUID, under `set -euo pipefail`. Before `rm -rf --` the script also checks that the path ends in `/gnome-shell/extensions/payattention@tonymalandain.github.io`, so an empty or odd variable can never widen the delete.
  - Running it twice is safe: every action is conditional on its target existing.

### `package.json` — new script

`"uninstall:local": "bash scripts/uninstall.sh"`, placed after `install:local`. It is not called `uninstall`, which is an npm lifecycle name (the same reason install is `install:local`).

### `tests/smoke/uninstall-check.sh` (new) — test contract used by `scripts/smoke.sh`

```
bash tests/smoke/uninstall-check.sh <absolute dir under $ROOT/.smoke-home/>
```

- It prints exactly one final line, `PAYATTENTION-UNINSTALL PASS` or `PAYATTENTION-UNINSTALL FAIL <check>: <reason>`, and exits 0 or 1.
- It refuses (FAIL `0-isolation`, exit 1) if the argument is not an absolute path under `$ROOT/.smoke-home/`. So it can never be pointed at a real home.

### `tests/smoke/alert-ladder.js` — one new function and one new step

```js
/** Runs argv with the shell's environment; resolves with its exit status and merged stdout+stderr. */
async function runProgram(argv)            // -> Promise<{ status: number, output: string }>

/** Uninstall while a takeover holds the grab: stopped, nothing left, files and enabled entry gone. */
async function checkUninstall(name, home)  // throws CheckFailed
```

`runProgram` is the only way the script spawns a process, and it is async. A synchronous spawn would deadlock: the shell must serve the D-Bus call that the child makes.

## Steps

Step 1 is a repair and changes no behaviour for the owner. Steps 2–5 are the feature. Land Step 1 as its own commit.

### Step 1 — install.sh finds its own install directory  [repair]

- **Test first:** write `tests/smoke/uninstall-check.sh` up to its install phase only: the isolation scaffolding below, then `bash scripts/install.sh`, then check that `$U/data/gnome-shell/extensions/payattention@tonymalandain.github.io/schemas/gschemas.compiled` exists and that `enabled-extensions` contains the UUID.
  - Because the check sets `XDG_DATA_HOME=$U/data`, which is not `$HOME/.local/share`, it fails today: install.sh's `test -f "$HOME/.local/share/..."` fails under `set -e`. That failure proves the test isolates the data directory the way the script must honour it.
  - Wire it into `scripts/smoke.sh` now (see the smoke.sh wiring below).
- **Then:** in `scripts/install.sh`, replace the `test -f "$HOME/.local/share/gnome-shell/extensions/$UUID/schemas/gschemas.compiled"` line.
  - Use a variable `DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"` defined next to `UUID`, and `test -f "$DIR/schemas/gschemas.compiled"`.
  - Nothing else in install.sh changes.
- **Why here:** install.sh owns "where the install lives". It must agree with `gnome-extensions install` (GLib's user data dir), which uninstall will also use.
- **Behaviour change:** none for the owner (`XDG_DATA_HOME` is unset, so it resolves to the same path). It only becomes correct when `XDG_DATA_HOME` is set.

**Isolation scaffolding of `uninstall-check.sh`** (decided, do not vary):

- **Outer part** (no argument besides the directory):
  - `set -euo pipefail`; `ROOT` from the script location, as in smoke.sh.
  - Validate `$1` as in the seam.
  - `rm -rf "$U"`, then `mkdir -p "$U"/{home,data,config,cache}` and `mkdir -m 700 "$U/run"`.
  - Re-exec itself under a fresh environment:
    ```
    env -i PATH="$PATH" LANG=C.UTF-8 HOME="$U/home" \
        XDG_DATA_HOME="$U/data" XDG_CONFIG_HOME="$U/config" XDG_CACHE_HOME="$U/cache" XDG_RUNTIME_DIR="$U/run" \
        PAYATTENTION_UNINSTALL_HOME="$U" \
        timeout 180 dbus-run-session -- bash "$0" --inner
    ```
    Do not set `GSETTINGS_BACKEND`: the check runs the real dconf mechanism (measured fact 6).
- **Inner part** (`--inner`):
  - First assert isolation: `HOME`, `XDG_DATA_HOME` and `XDG_CONFIG_HOME` all equal paths under `$PAYATTENTION_UNINSTALL_HOME`, and `DBUS_SESSION_BUS_ADDRESS` is non-empty. Otherwise FAIL `0-isolation`.
  - Define `fail() { echo "PAYATTENTION-UNINSTALL FAIL $1: $2"; exit 1; }`.
  - The last line of the inner part is always `echo PAYATTENTION-UNINSTALL PASS`. Steps 2 and 3 insert their checks before it.
  - The install and uninstall scripts are invoked as `bash "$ROOT/scripts/install.sh"` and `bash "$ROOT/scripts/uninstall.sh"`. `ROOT` is derived again in the inner part the same way.

**smoke.sh wiring** (Step 1, unchanged afterwards):
- Place it right after the store check (block 1), as a new block `1b`:
  ```
  bash "$ROOT/tests/smoke/uninstall-check.sh" "$T/uninstall" 2>&1 | tee "$T/uninstall.log" || true
  if ! grep -q '^PAYATTENTION-UNINSTALL PASS' "$T/uninstall.log"; then
      echo "smoke: uninstall check failed" >&2
      exit 1
  fi
  ```
- Update the header comment of smoke.sh to mention the install/uninstall check.
- `.gitignore` already covers `.smoke-home/`.

### Step 2 — uninstall with no running shell: files, lists, kept settings, second run  [feature]

- **Test first:** extend `uninstall-check.sh` (inner part), in this order. Each check has a named `fail` label.
  1. `2-seed`, before install:
     - `gsettings set org.gnome.shell enabled-extensions "['other@example.test']"`;
     - `gsettings set org.gnome.shell disabled-extensions "['third@example.test']"`;
     - `dconf write /org/gnome/shell/extensions/payattention-other/kept 1`;
     - create `$XDG_DATA_HOME/gnome-shell/extensions/other@example.test/metadata.json` containing `{}`.
  2. `2-install`: run install.sh and check as in Step 1.
     - Then `gsettings set org.gnome.shell disabled-extensions "['third@example.test', 'payattention@tonymalandain.github.io']"`, so removal from both lists is exercised.
     - Seed our settings with `dconf write /org/gnome/shell/extensions/payattention/snooze-minutes 5` and `dconf write /org/gnome/shell/extensions/payattention/travel-times "{'hq': 30}"`.
  3. `2-bad-option`: `uninstall.sh --bogus` exits 2, and the install dir still exists.
  4. `2-uninstall`: `uninstall.sh` exits 0. Then:
     - the install dir is gone;
     - `gsettings get org.gnome.shell enabled-extensions` is exactly `['other@example.test']`;
     - `disabled-extensions` is exactly `['third@example.test']`;
     - `dconf read .../payattention/snooze-minutes` is `5`;
     - `other@example.test/metadata.json` still exists;
     - `dconf read /org/gnome/shell/extensions/payattention-other/kept` is `1`;
     - the output contains `Removed: $XDG_DATA_HOME/gnome-shell/extensions/payattention@tonymalandain.github.io`, `Kept: saved settings` and `Calendars and other extensions were not touched.`;
     - the output does not contain `Stopped:`.
  5. `2-second-run`: `uninstall.sh` exits 0, and its output contains `Nothing to remove: payAttention is not installed.` The kept setting is still `5`.

  Today this fails at step 3 or 4, because `scripts/uninstall.sh` does not exist. That is the right failure.
- **Then:** write `scripts/uninstall.sh`. Style follows install.sh: shebang, a header comment saying what it does and what it never touches, `set -euo pipefail`, `ROOT` not needed, `UUID=payattention@tonymalandain.github.io`, `DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"`, `SETTINGS_PATH=/org/gnome/shell/extensions/payattention/`.
  - **a. Parse arguments.** One loop sets `purge=0|1`, handles `--help`/`-h`, and rejects anything else (usage: `Usage: npm run uninstall:local [-- --purge]`, exit 2). The purge backend guard also goes here (Step 3 adds its test; write the guard now, it is part of the seam).
  - **b. Stop in the running shell.**
    - Record whether `$DIR` existed before this step. Probe with `gnome-extensions info "$UUID" >/dev/null 2>&1`.
    - If it succeeds, run `gnome-extensions uninstall "$UUID"`. On a non-zero exit, print the "could not stop" error and exit 1.
    - Then re-probe: if `info` still succeeds, print the "still has payAttention loaded" error and exit 1.
    - Otherwise print `Stopped: …`. If `$DIR` existed before, print `Removed: $DIR`: the shell deleted it.
  - **c. Remove files.**
    - If `$DIR` still exists (no shell knew it, or the shell's copy lived elsewhere), apply the suffix guard from the seam, then `rm -rf -- "$DIR"` and print `Removed: $DIR`.
    - Do not print `Removed` twice for the same path. If b already printed it and the directory is still there, just remove it silently.
  - **d. Remove the UUID from both lists.**
    - Use one inline `gjs -c` in the style of install.sh. With `Gio.Settings({schema_id: 'org.gnome.shell'})`, for each of `enabled-extensions` and `disabled-extensions`: if the list contains the UUID, set it to the list without it and `print` the key name. Then `Gio.Settings.sync()`.
    - The shell prints `enabled-extensions` / `disabled-extensions` lines. Map each to its `Removed: … from the enabled|disabled extensions.` line.
    - Then verify in a fresh process: `gsettings get org.gnome.shell enabled-extensions` and `… disabled-extensions` must not contain `'$UUID'`. Otherwise print the "could not remove … from the GNOME extension lists" error and exit 1.
    - Write the settings with gjs, not `gsettings set`: the list edit needs the current value, and gjs avoids parsing GVariant text in bash. Read with `gsettings`, in a separate process, so the check sees what was really stored.
  - **e. Settings.** Without `--purge`, print the `Kept:` line. `--purge` is Step 3.
  - **f.** Print `Nothing to remove: payAttention is not installed.` if b, c and d printed nothing. Then print `Calendars and other extensions were not touched.`
  - **Order rationale (do not reorder):**
    - Stopping comes first, because it is the only step that can fail without leaving a half-removed state.
    - Files come before lists, so a failure in d leaves an entry pointing at nothing. The shell ignores such an entry, and a re-run fixes it.
    - Lists are handled after the shell has unloaded the extension, so removing them cannot race a second, settings-driven disable. Even if it did, `_callExtensionDisableWithRebase` returns early for an unknown or inactive extension.
- **Then:** add the `uninstall:local` script to `package.json`.
- **Why here:** `scripts/` owns getting the extension in and out of the session.
- **Behaviour change:** new command. Nothing else changes.

### Step 3 — the erase option  [feature]

- **Test first:** extend `uninstall-check.sh` after Step 2's checks.
  1. `3-purge-refused`: `GSETTINGS_BACKEND=keyfile bash "$ROOT/scripts/uninstall.sh" --purge` exits 2, and `snooze-minutes` is still `5`.
  2. `3-purge`: `uninstall.sh --purge` exits 0. Then:
     - `dconf dump /org/gnome/shell/extensions/payattention/` is empty;
     - `dconf read /org/gnome/shell/extensions/payattention-other/kept` is still `1` (this is the prefix boundary);
     - both lists are unchanged from Step 2;
     - the output contains `Erased: saved settings` and not `Kept:`.
  3. `3-purge-again`: `uninstall.sh --purge` exits 0 and prints `Erased: saved settings`.

  Before this step, 3-purge fails because the settings are still there.
- **Then:** in step e of `uninstall.sh`, with `--purge`:
  - run `dconf reset -f "$SETTINGS_PATH"`;
  - verify that `dconf dump "$SETTINGS_PATH"` prints nothing, otherwise print the "could not erase" error and exit 1;
  - print `Erased: …`.
  - The path is the constant `SETTINGS_PATH` with its trailing slash. Never build it from input.
- **Why here:** the erase option is part of the same one command (D-016).
- **Behaviour change:** `--purge` erases our settings path only.

### Step 4 — uninstall while running and showing a takeover (headless smoke)  [feature]

- **Test first:** in `tests/smoke/alert-ladder.js`:
  - Add `runProgram(argv)`, built on `Gio.Subprocess.new(argv, STDOUT_PIPE | STDERR_MERGE)` and `communicate_utf8_async(null, null, callback)` wrapped in a `Promise` (measured fact 8). It resolves `{ status: proc.get_exit_status(), output }`.
  - Add `checkUninstall(name, home)`:
    1. `Main.extensionManager.enableExtension(UUID)`, wait ACTIVE (10000 ms), then `checkIndicator(name, home)` (the helper is running: 1 pid).
    2. `stateObj.runTestAlert()`, then wait for `payattention-takeover` (45000 ms). Check that `grabIsOurs()`, so the uninstall provably happens under a grab.
    3. The script path is `Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_child('scripts').get_child('uninstall.sh').get_path()`. Then `const { status, output } = await runProgram(['bash', path])`.
    4. Check:
       - `status === 0`, and `output` includes `Stopped: payAttention in the running session.` (on failure, put `output` in the reason);
       - `Main.extensionManager.lookup(UUID) === undefined`;
       - `countByPrefix(global.stage, 'payattention') === 0`;
       - `Main.panel.statusArea.payattention === undefined`;
       - `ourModalEntries().length === 0` and `!grabIsOurs()`;
       - `mustWait(() => helperPids(home).length === 0, 3000, …)`;
       - `!GLib.file_test(\`${home}/data/gnome-shell/extensions/${UUID}\`, GLib.FileTest.EXISTS)`;
       - `mustWait(() => !global.settings.get_strv('enabled-extensions').includes(UUID), 3000, …)` (the keyfile monitor is asynchronous).
  - Call it as step 9 in `runLadder()`, after step 8: `await checkUninstall('9-uninstall', home);`. It must be last, because the extension is gone afterwards.
  - Update the header comment's description if it lists the steps (it does not today; leave it).
  - Before `scripts/uninstall.sh` exists this fails. After Steps 2–3 it must pass. If it fails on the D-Bus path, see "Stop and escalate".
- **Then:** no production change is expected. The measured facts say Step 2's script already does this. If the check fails, fix `uninstall.sh`, not the extension.
- **Why here:** the smoke is the only layer with a running shell (layer 3). The uninstall runs with the shell's own isolated environment: smoke bus, smoke XDG dirs, keyfile backend, the smoke's `WAYLAND_DISPLAY`.
- **Behaviour change:** none (test only).

### Step 5 — README  [feature, docs]

- In `README.md`, add a section `## Uninstall` directly after `## Install` (before `## First five minutes`):
  ```sh
  npm run uninstall:local              # stop it, remove it, keep your saved choices
  npm run uninstall:local -- --purge   # also erase overrides, travel times and settings
  ```
  - Then plain sentences:
    - If payAttention is running, it stops at once, and no alert stays on screen.
    - It no longer loads at login.
    - The output lists what was removed and what was kept.
    - Running it again is safe.
    - It never touches your calendars or other extensions.
  - Plus one sentence on reinstalling in the same session: to reinstall after uninstalling, run `npm run install:local`, then log out and back in, because GNOME loads extension code only at login.
- In `## Development`, the smoke sentence becomes: "The smoke test checks install and uninstall in a throwaway home, then runs a hidden, headless GNOME Shell with its own test calendar." The rest of the paragraph is unchanged.
- **Behaviour change:** documentation only.

### Step 6 — record the finding for the architect  [docs]

Append to `docs/inbox.md`:

```
## 2026-09-26 — for-architecture — PG-3 uninstall: testing-and-build.md is out of date
- The smoke gained two checks. `tests/smoke/uninstall-check.sh` runs install and uninstall in an isolated home, with isolated dconf (no GSETTINGS_BACKEND override, own XDG_RUNTIME_DIR). Smoke step 9 uninstalls while a takeover holds the grab.
- `npm run uninstall:local` exists.
- install.sh now honours XDG_DATA_HOME in its post-install check.
- Measured: `gnome-extensions uninstall` runs `disable()` synchronously and deletes the directory, but leaves the UUID in enabled-extensions.
- The Layer 3 list and the install section of testing-and-build.md need these lines. boundaries.md's "scripts/: build, install, smoke wrappers" should mention uninstall.
```

Do **not** edit `docs/architecture/`.

## Validation

Run the full sequence: `npm run lint`, `npm test`, `npm run build`, `npm run test:helper`, `npm run smoke`. Smoke must print `PAYATTENTION-UNINSTALL PASS` and `PAYATTENTION-SMOKE PASS`.

**Never** run `npm run uninstall:local` or `scripts/uninstall.sh` outside the test environments during development. The owner's real install must stay in place. PG-2, the owner's real-session check, depends on it.

## Callers to update

- `package.json` scripts: add `uninstall:local`. No existing script changes.
- `scripts/install.sh`: only the post-install check line (Step 1). Its callers (`npm run install:local`, now also `uninstall-check.sh`) are unaffected.
- `scripts/smoke.sh`: gains block 1b. Its caller (`npm run smoke`) is unchanged.
- No contract of the extension changes: no key, schema, protocol or file format. No external callers.

## Out of scope

- Anything under `extension/`. `disable()` is already proven to clean up (smoke steps 7–8). Do not add uninstall-specific code to the extension.
- `~/.local/share/gnome-shell/extension-updates/<uuid>`: our install never creates it. When the shell knows the extension, its own uninstall deletes it.
- Calendars, EDS, and the `disable-user-extensions` key: never read or written by uninstall.
- Refactoring the hard-coded UUID into a shared script library, and the backlog's housekeeping items: the 1200x900 smoke monitor, the lint rules, the plan deviations.
- `CLAUDE.md` and `docs/architecture/`: findings only, through the inbox (Step 6).

## Stop and escalate if

- The step-9 smoke check shows `gnome-extensions uninstall` failing inside the headless shell, for example because `org.gnome.Shell.Extensions` cannot be activated. Measured fact 1 says it works. If it does not, the stop mechanism must be redesigned: do not switch to editing `enabled-extensions` and sleeping.
- `dconf reset -f` touches anything outside `/org/gnome/shell/extensions/payattention/` in the check.
- Any test step would need the owner's real `DBUS_SESSION_BUS_ADDRESS`, `HOME`, `~/.config/dconf` or `~/.local/share`.
- `gnome-extensions info` succeeds for a *system* copy of the UUID (the shell refuses to uninstall system extensions). Uninstall then fails with exit 1, which is correct. Report it; do not add handling.
- Making the check pass seems to require a new tool or dependency beyond what `gnome-extensions`, `gsettings`, `gjs` and `dconf` provide. These are already on any GNOME system, and install and smoke already use the first three.
