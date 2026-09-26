# Testing, build, install, validation

What is tested where, and the commands. Every mechanism below except the npm
script names was run on the author's machine on 2026-09-26 with a throwaway probe
extension. The npm scripts are the contract the engineers implement; the commands
behind them are the verified ones.

## The validation sequence

Run in this order. Each must pass before the next is worth running.

| Step | Command (contract) | What it runs |
|---|---|---|
| 1. Lint | `npm run lint` | `eslint .` with a flat config: gjs globals (`global`, `log`, `logError`, `print`, `console`), and the per-directory `no-restricted-imports` rules from `boundaries.md`. |
| 2. Unit | `npm test` | `node --test tests/unit/` over `extension/core/`. |
| 3. Schema | part of `npm run build` | `glib-compile-schemas --strict --dry-run extension/schemas` |
| 4. Build | `npm run build` | `mkdir -p dist && gnome-extensions pack extension --extra-source=core --extra-source=helper --extra-source=shell --extra-source=ui --force --out-dir=dist` |
| 5. Helper integration | `npm run test:helper` | The helper against an isolated EDS with a fixture calendar (below). |
| 6. Smoke | `npm run smoke` | A headless gnome-shell with the built zip installed and enabled (below). |
| 7. Real session | manual | Install, log out and in, check the journal and the checklist below. |

Setup once: `npm ci` (dev tools only; nothing from `node_modules` is ever packed).

## Layer 1 — core unit tests (Node)

`extension/core/` has no GNOME imports (ADR-0002), so Node 24 imports it directly.
Fixtures in `tests/fixtures/` are synthetic snapshots in the protocol format from
`interfaces.md` — never copies of real calendar data.

The PRD's "Done when" list maps onto core tests:

- **Verdict rules:** one test per reason in PRD §1, in rule order, including the
  missing-data default, "you answered maybe", overrides by occurrence then series,
  and duplicate occurrences from two calendars merging.
- **Online / in-person:** each named conferencing service, links in location vs
  description vs conference property, hybrid (D-007), placeholder words
  ("online", "TBD"), the mode override, and the https-plus-allowlist rule for Join.
- **Timing:** deadline for online and in person; each step boundary; clamping of
  out-of-order offsets; snooze limited by the next step (not at step 4); return
  after being away (jump straight to the right step); overlapping meetings
  (earliest deadline primary, others "also"); the 10-minutes-after cutoff; a moved
  meeting invalidating its alert state; the heads-up not consumed while idle.
- **Stored format:** occurrence, series and place keys; pruning; a corrupt
  `alert-state` string yielding empty state.
- **Budget:** `plan` over 500 occurrences under 1 ms (a benchmark-style test with
  a generous margin, so it catches order-of-magnitude regressions only).

## Layer 2 — helper integration (real EDS, fake data)

The helper is run against a private EDS whose only calendar is a fixture `.ics`,
inside its own D-Bus session. Nothing touches the owner's calendars.

```sh
Z=<a directory on the home filesystem>        # e.g. .test-home/ in the repo, git-ignored
# $Z/config/evolution/sources/fixture-cal.source:
#   [Data Source]  DisplayName=Fixture  Enabled=true  Parent=local-stub
#   [Calendar]     BackendName=local    Selected=true
# $Z/data/evolution/calendar/fixture-cal/calendar.ics  <- written by the test, times relative to now
XDG_CONFIG_HOME=$Z/config XDG_DATA_HOME=$Z/data XDG_CACHE_HOME=$Z/cache \
GSETTINGS_BACKEND=memory \
  dbus-run-session -- gjs -m extension/helper/<entry>.js --once
```

The test then validates the output line with core's protocol validator and checks
the fields: a named TZID converted to UTC, attendees with partstat and cutype, the
organiser, transparency, a recurring series expanded with recurrence ids, an
X-GOOGLE-CONFERENCE link, all-day, and a cancelled event. Verified: a
`TZID=America/New_York` 06:00 event came back as 10:00Z with 2 attendees.

Against the real calendars, by hand only: `gjs -m extension/helper/<entry>.js --summary`
(counts only, safe to paste into a bug report).

## Layer 3 — shell smoke test (headless gnome-shell)

`gnome-shell --headless` runs a complete shell with virtual monitors, in its own
D-Bus session, with an isolated home. `--devkit` is not usable here (the
`mutter-devkit` package is not installed), and is not needed.

```sh
T=<fresh directory on the home filesystem>   # NOT /tmp — see pitfalls
mkdir -p $T/data/gnome-shell/extensions $T/config/glib-2.0/settings $T/cache
XDG_DATA_HOME=$T/data gnome-extensions install --force dist/payattention@tonymalandain.github.io.shell-extension.zip
printf '[org/gnome/shell]\nenabled-extensions=["payattention@tonymalandain.github.io"]\n' \
  > $T/config/glib-2.0/settings/keyfile
XDG_CONFIG_HOME=$T/config XDG_DATA_HOME=$T/data XDG_CACHE_HOME=$T/cache \
GSETTINGS_BACKEND=keyfile \
  dbus-run-session -- gnome-shell --headless \
    --virtual-monitor 1280x720 --virtual-monitor 1024x768 \
    --wayland-display pa-smoke \
    --automation-script tests/smoke/<script>.js  > $T/shell.log 2>&1
```

The automation script is an ES module exporting `async function run()` and
`function finish()` (the shell's `ui/scripting.js` harness; `Scripting.sleep(ms)`
waits). The shell exits when `run()` resolves. The script prints one
`PAYATTENTION-SMOKE PASS` or `PAYATTENTION-SMOKE FAIL <reason>` line; the wrapper
greps for it and also fails on any `JS ERROR` line or stack mentioning the UUID.

What the smoke script checks:

1. `Main.extensionManager.lookup(uuid).state` is ACTIVE (1) and `error` is empty.
2. The indicator is in the panel. The helper started and sent `hello` and one
   snapshot (empty here: the isolated EDS has no calendars).
3. `runTestAlert()` on the extension object. Waits, then checks each step's actor;
   at the takeover, one overlay per monitor (2) and an active grab.
4. Sends the acknowledge action; checks the overlays are gone and no grab remains.
5. Disables the extension; checks no actors of ours remain in the stage, no grab
   remains, and the helper process has exited.

Verified: a probe extension reached state 1 with two monitors reported.

## Layer 4 — the real session (manual)

On Wayland an extension's new code only loads after logging out and in; there is
no shell restart. Iterate in the headless shell; use the real session to confirm.

```sh
npm run build
gnome-extensions install --force dist/payattention@tonymalandain.github.io.shell-extension.zip
# log out and in (first time: gnome-extensions enable payattention@tonymalandain.github.io)
gnome-extensions info payattention@tonymalandain.github.io      # State: ACTIVE, no error
journalctl --user -b -o cat /usr/bin/gnome-shell | grep -iE 'payattention|JS ERROR'
```

Checklist (PRD "Done when" plus what headless cannot show): the top bar shows the
next must-attend meeting from the real calendars; Test alert runs all four steps;
the takeover cannot be dismissed without an action, with PaperWM enabled, over a
full-screen window, on every monitor, and in Do Not Disturb; lock during an
alert and unlock (alert returns at the right step); suspend across a step time.

## Pitfalls found while verifying

- **`gnome-extensions install` fails with "Can't recursively copy directory"** when
  the target `XDG_DATA_HOME` is on a different filesystem from the extraction
  directory (here `/tmp` is tmpfs, `$HOME` is not) and the zip contains
  subdirectories. Keep test homes on the home filesystem. `gnome-shell-test-tool`
  uses `/tmp` and therefore fails with our zip unless run with
  `TMPDIR=<dir on the home filesystem>`; that is why the smoke recipe above calls
  `gnome-shell` directly (it also needs two monitors, which the test tool does not
  offer).
- **`gnome-extensions pack` segfaults** if the `--out-dir` directory does not exist.
  Create it first.
- **`gnome-extensions pack` includes only** `metadata.json`, `extension.js`,
  `prefs.js`, `stylesheet.css` and `schemas/` by default. Every code directory
  must be listed with `--extra-source`, or the installed extension fails to import.
- **`gnome-extensions install` compiles the schemas** into the install directory
  (`schemas/gschemas.compiled` appeared). No manual `glib-compile-schemas` step is
  needed for install; the dry-run in the build is only a validity check.
- **gjs segfaults at teardown after using EDS objects** (see ADR-0001). The helper's
  own exit path must not dump core; test it by closing the helper's stdin and
  checking the exit status in the helper integration test.
