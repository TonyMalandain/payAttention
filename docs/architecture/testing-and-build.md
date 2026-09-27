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
| 2. Unit | `npm test` | `node --test "tests/unit/**/*.test.js"` over `extension/core/` and the gi-free shell modules, plus a gjs run of core that fails on Node-only APIs. The directory form `node --test tests/unit/` fails on Node 24.11 (it treats the directory as a file). |
| 3. Schema | part of `npm run build` | `glib-compile-schemas --strict --dry-run extension/schemas` |
| 4. Build | `npm run build` | `mkdir -p dist && gnome-extensions pack extension --extra-source=core --extra-source=helper --extra-source=shell --extra-source=ui --extra-source=../LICENSE --extra-source=../NOTICE --force --out-dir=dist` (`scripts/build.sh`; LICENSE and NOTICE ship since PG-6, and the script checks the zip holds them). From PG-4, also `--extra-source=ai` (ADR-0010). |
| 5. Helper integration | `npm run test:helper` | `node --test "tests/helper/**/*.test.js"`: the helper against an isolated EDS with a fixture calendar (below). From PG-4 the same script also runs `tests/ai/**/*.test.js`: the AI helper against a fake engine (Layer 2b). |
| 6. Smoke | `npm run smoke` | A GJS store check (`GSETTINGS_BACKEND=memory`), then the install/uninstall check in a throwaway home (below), then a headless gnome-shell with the built zip installed and enabled (below). |
| 7. Real session | manual | Install, log out and in, check the journal and the checklist below. |

Setup once: `npm ci` (dev tools only; nothing from `node_modules` is ever packed).
Install into the real session: `npm run install:local` (not `install`, which npm
would run on every `npm install`/`npm ci`). `scripts/install.sh` also adds the UUID to
`org.gnome.shell enabled-extensions`, so it loads at the next login. It honours
`XDG_DATA_HOME` in its post-install check.

Remove: `npm run uninstall:local` (R-17, D-016). It stops the extension in the
running shell, removes the install directory, and takes the UUID out of
`enabled-extensions` and `disabled-extensions`. Settings are kept.
`npm run uninstall:local -- --purge` also erases
`/org/gnome/shell/extensions/payattention/`. From PG-4, `--purge` also clears
the keyring items of the AI key schema (ADR-0009), and a plain uninstall
reports them as kept. It never touches calendars, other extensions, other
settings, or other keyring items. It is safe to run twice.

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
  dbus-run-session -- gjs -m extension/helper/main.js --once
```

- **An isolated EDS is never empty of sources.** It always has two built-in,
  selected, empty sources: `birthdays` (contacts) and `system-calendar` (local).
  "No calendars" in a test means 2 sources and 0 events.
- The helper test runs its own `dbus-daemon --session` instead of
  `dbus-run-session`, so a test-only writer can add an event through EDS on the
  same bus. The local backend does not notice direct edits to the `.ics` file.
- One test adds `remote-cal`, a CalDAV source on a closed loopback port
  (127.0.0.1:9), so a source reports `remote:true` without any network. Another
  SIGKILLs the isolated `evolution-calendar-factory`, found by the test's private
  bus address in its environment, never by name alone.

The test then validates the output line with core's protocol validator and checks
the fields: a named TZID converted to UTC, attendees with partstat and cutype, the
organiser, transparency, a recurring series expanded with recurrence ids, an
X-GOOGLE-CONFERENCE link, all-day, and a cancelled event. Verified: a
`TZID=America/New_York` 06:00 event came back as 10:00Z with 2 attendees.

Against the real calendars, by hand only: `gjs -m extension/helper/main.js --summary`
(counts only, safe to paste into a bug report).

## Layer 2b — AI helper integration (fake engine, no network)

From PG-4 (ADR-0007, ADR-0010). The AI helper is run against a **fake engine**:
a `node:http` server on `127.0.0.1`, on a port the OS picks. It speaks the
OpenAI Chat Completions shape and records every request body. The helper runs
inside `dbus-run-session` **and** with `HOME`, `XDG_DATA_HOME`,
`XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR` (mode 0700) in a throwaway directory,
in an environment built with `env -i`. A private bus alone is not isolation
(measured 2026-09-27): the first Secret call D-Bus-activates
`gnome-keyring-daemon`, which opens `$XDG_DATA_HOME/keyrings/`, so with the real
home it opens the owner's real keyring file.

Rules the tests hold:

- **Never a real engine.** The harness refuses any endpoint whose host is not
  `127.0.0.1`. No test, fixture or script contains a real provider URL or key.
- **Invite proof (D-020).** The recorded body's user message parses to exactly
  the invite that was sent, with exactly the keys in core's invite field list,
  and within 8 192 bytes. The body carries no `tools` and no second user
  message. The fixture event has a description, a place, a video link, an
  organiser, guests with names, emails and responses, a room, a calendar
  name, a Zoom link with `?pwd=` (as `videoLink` and repeated in the
  description), a "Passcode: 123456" line, and a too-long description and
  guest list. All of them must appear, capped as in `interfaces.md` §6.2, and
  the room, the `?pwd=` query and the passcode value must not. The helper
  refuses an invite with an extra key, a missing key, or over 8 192 bytes
  (`bad-request`), and the shell side refuses a helper line with an extra key
  (the AI protocol refuses unknown keys both ways, §6.6).
- **Failure mapping.** The fake engine can be made to answer late (past
  `timeoutMs`, which must give `failed: timeout` within `timeoutMs` + 1 s), 401,
  429 with `Retry-After`, 500, a closed port, non-JSON, fenced JSON, a leading
  `<think>` block, and a 400 that rejects `response_format` (which must give one
  retry without it).
- **Injection.** Replies that try to do more than choose a verdict (markup,
  newlines, bidi controls, 10 000 characters, extra keys such as `joinUrl` or
  `mode`, a verdict of `MUST`) give either a clean verdict with a normalised
  reason or `bad-reply`. The same corpus runs against core's reply validator in
  Layer 1.
- **Keys.** A headless test keyring works (measured 2026-09-27):
  `printf '<non-empty phrase>' | gnome-keyring-daemon --unlock --components=secrets --daemonize`
  inside the isolated environment above. An empty phrase does not work (the
  daemon tries to prompt). Tests prove that the `Authorization` header is sent
  over loopback `http:`, that no header is sent when no key is saved for the
  endpoint (keyless engine), that a key saved for another endpoint is never
  sent, that a locked item gives `no-key` without a prompt, and that the key
  never appears on the helper's stdout or stderr.

Layer 1 covers the rest in pure code:
- the invite builder, with its caps, the 8 192-byte cap, and cleaning; the
  `calendar` field after `title` (≤ 80, `""` for an unknown source, the kept
  copy's calendar after a merge); conferencing-link queries cut in
  `videoLink`, description and place, other links left whole (D-022); text
  passcodes (plurals too) replaced with `[removed]` to the end of the line
  (D-025, D-027, D-029); invisible marks dropped, HTML line-end tags turned
  into line ends, and phone dial-in strings replaced (D-029), in §6.2's order;
- the AI protocol validators: exactly the keys, both directions, at every
  level, and `retryAfterS` only with `rate-limited`;
- the fingerprint (every invite field changes it, text past a cap does not);
- `normaliseEndpoint` and `endpointClass`, including `http:` to a public host
  being refused;
- `judge` with `aiVerdicts`:
  - overrides win and produce no `aiAsk`, so they are never sent;
  - cancelled, owner-declined, all-day (including all-day and not-invited)
    and no-start occurrences are not eligible: no `aiAsk`, and a stored entry
    is ignored (D-023). Every other rule code, including `free`, is
    eligible;
  - a current answer applies;
  - a stale answer applies with a new `aiAsk`;
  - no answer gives the rule verdict and an `aiAsk`;
  - rules mode gives exactly today's output and no `aiAsk`.

The controller is tested with fake AI clients:
- one that never answers: every alert step must still appear at its time;
- one that fails: stale entries are withheld, so the rules decide;
- a budget test: the 121st request in an hour is not sent, and the status is
  `unavailable`.

## Layer 3 — shell smoke test (headless gnome-shell)

**Install and uninstall check** (`tests/smoke/uninstall-check.sh`, run by
`scripts/smoke.sh` before the shell). It runs `scripts/install.sh` and
`scripts/uninstall.sh` in a throwaway home under `.smoke-home/`, with `env -i`,
its own `dbus-run-session`, its own `XDG_*` directories and `XDG_RUNTIME_DIR`,
and the real dconf mechanism (no `GSETTINGS_BACKEND` override). So it proves
what an owner's dconf would see, and never reaches the owner's bus, dconf or
`~/.local/share`. It checks that another extension's files, list entries and
settings survive. It checks that settings are kept by a plain uninstall and gone
after `--purge`, that a bad option changes nothing, and that a second uninstall
succeeds. It prints `PAYATTENTION-UNINSTALL PASS` or `FAIL <check>: <reason>`.

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
    --virtual-monitor 960x540 --virtual-monitor 1024x768 \
    --wayland-display pa-smoke \
    --automation-script tests/smoke/<script>.js  > $T/shell.log 2>&1
```

The automation script is an ES module exporting `async function run()` and
`function finish()` (the shell's `ui/scripting.js` harness; `Scripting.sleep(ms)`
waits). The shell exits when `run()` resolves. The script prints one
`PAYATTENTION-SMOKE PASS` or `PAYATTENTION-SMOKE FAIL <reason>` line; the wrapper
greps for it and also fails on any `JS ERROR` line, any `JS WARNING` naming
payattention, any "has been already disposed" line (its stack trace may name
only shell files), any of our own failure log codes (`tick-failed`,
`destroy-failed`, `grab-failed`, `protocol-mismatch`, `helper-spawn-failed`, and
the helper's `registry-failed`, `helper-failed`), and any `Gjs-CRITICAL` whose
line or stack trace mentions payattention.

What the smoke script checks:

1. `Main.extensionManager.lookup(uuid).state` is ACTIVE (1) and `error` is empty.
2. The indicator is in the panel and shows the fixture meeting that
   `scripts/smoke.sh` writes into the isolated EDS (`Smoke client review`, 2–3 h
   ahead), so the helper, `judge` and `plan` all ran on fixture data only.
   Do Not Disturb is set (`show-banners=false`) for the whole run.
   The fixture also has an all-day event (`Smoke all-day check`): it is in
   today's menu at any hour and never alerts. The script opens the menu, clicks
   that event's Must attend switch, and checks the override was stored and the
   menu closed; then "Back to automatic" clears it.
3. `runTestAlert()` on the extension object. Waits, then checks each step's actor;
   at the takeover, one overlay per monitor (2) and an active grab of ours.
   Escape does nothing, and the check proves the key event reached the takeover,
   so a lost key cannot pass it. Every action button lies inside its own monitor
   (one monitor is 960x540).
4. Clicks acknowledge on the **second** monitor with a virtual pointer; checks the
   overlays are gone and no grab of ours remains. Then it draws the worst-case
   alert (150-character title, Join, whole series, three "also" lines) through
   the installed `ui/` modules as a takeover and as each card: every button on
   screen, the title at most two lines and ellipsized. Then a `Ui` and a `Card`
   whose construction fails leave nothing on the stage.
5. Disables the extension; checks no actors of ours remain in the stage, no grab
   remains, and the helper process has exited.
6. The lock path: re-enable, start a takeover, disable during it, and repeat 5.
7. Uninstall while a takeover holds the grab (check `9-uninstall`, last,
   because the extension is gone afterwards). Nothing of ours is left on the
   stage, no grab remains, and the helper has exited.
8. From PG-4: rules mode is the default, so no AI helper process runs at any
   point of the smoke.

**Isolation boundary.** The smoke isolates the session bus, the XDG directories
(so settings and calendars) and nothing else. The system bus is the real one: the
headless shell logs "Registering display with GDM", and `shell/environment.js`
listens to logind's `prepare-for-sleep` on it. Both are harmless (a registration
attempt and a read-only signal). Accepted: a smoke script must never *call* a
system-bus service (logind, UPower, NetworkManager…) that changes machine state.

Checks are "no modal entry of ours", never an absolute `Main.modalCount`: in
headless 50.4 the overview is open at startup and holds one modal entry (verified).

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
alert and unlock (alert returns at the right step); suspend across a step time;
**network off for 15 min** shows "Calendar not updating since …" while cached
meetings still alert, and it clears within seconds of the network returning (D-013).

From PG-4, AI checks on the real session (ADR-0007, ADR-0010): in rules mode,
no `ai/main.js` process exists (`pgrep -af ai/main.js`). With a keyless local
engine (Ollama at `http://127.0.0.1:11434/v1`), and by hand with the owner's
cloud key, "Test connection" says yes, and every meeting without an override
that is not cancelled, declined or all-day shows "AI: …" once answered. With the engine
stopped, the menu says "AI unavailable — using rules", and a Test alert still
runs all four steps on time. The key is visible in Passwords and Keys and absent
from `dconf dump /org/gnome/shell/extensions/payattention/`. `--purge` removes
it. The journal holds no title, invite field, reason or key.

## Pitfalls found while verifying

- **`gnome-extensions install` fails with "Can't recursively copy directory"** when
  the target `XDG_DATA_HOME` is on a different filesystem from the extraction
  directory (here `/tmp` is tmpfs, `$HOME` is not) and the zip contains
  subdirectories. Keep test homes on the home filesystem. `gnome-shell-test-tool`
  uses `/tmp` and therefore fails with our zip unless run with
  `TMPDIR=<dir on the home filesystem>`; that is why the smoke recipe above calls
  `gnome-shell` directly (it also needs two monitors, which the test tool does not
  offer). Installing from the home filesystem into `~/.local/share` with the
  default `TMPDIR` works (verified).
- **`node --test <directory>` fails on Node 24.11.** Always pass a quoted glob.
- **`gnome-extensions uninstall` leaves the UUID in `enabled-extensions`.** It
  runs `disable()` synchronously and deletes the directory (measured, PG-3),
  but it does not edit the lists. `scripts/uninstall.sh` removes the UUID from
  both lists itself, then re-reads them in a fresh process.
- **`gnome-extensions pack` segfaults** if the `--out-dir` directory does not exist.
  Create it first.
- **`gnome-extensions pack` includes only** `metadata.json`, `extension.js`,
  `prefs.js`, `stylesheet.css` and `schemas/` by default. Every code directory
  must be listed with `--extra-source`, or the installed extension fails to import.
- **Checking the zip under `pipefail`: use `grep -x … >/dev/null`, not `grep -q`.**
  `grep -q` exits at the first match, `unzip -Z1` then dies of SIGPIPE, and
  `pipefail` fails the build (`scripts/build.sh`).
- **`gnome-extensions install` compiles the schemas** into the install directory
  (`schemas/gschemas.compiled` appeared). No manual `glib-compile-schemas` step is
  needed for install; the dry-run in the build is only a validity check.
- **gjs segfaults at teardown after using EDS objects** (see ADR-0001). The helper's
  own exit path must not dump core; test it by closing the helper's stdin and
  checking the exit status in the helper integration test.
- **The exit rule for any gjs process that touches EDS** (ADR-0001, evidence 5):
  call `System.exit(code)` only from a GLib main-loop source callback while the
  loop runs, deferred with `GLib.idle_add(GLib.PRIORITY_HIGH, …)`. Ending the
  module, `loop.quit()` then return, or `System.exit` with no loop segfault (139);
  `System.exit` from a promise continuation (after `await`) **hangs forever**.
  One `exitSoon(code)` is the helper's only exit.

- **Headless virtual input drops early events** (gnome-shell 50.4, measured
  PG-1c: 1 of 6 runs failed). The first `notify_absolute_motion` of a new virtual
  pointer lost its x (landed at x=0); once, a motion stopped at the edge of
  monitor 0 instead of reaching monitor 1. Re-send the motion until
  `global.get_pointer()` is at the target before clicking, and confirm a key
  event arrived before asserting that it had no effect. Those stray first
  motions also closed an open popup menu (the grab went to the Activities
  button; 3 of 5 runs of the menu check failed), so `alert-ladder.js` uses one
  virtual pointer for the whole run, parked at the middle of the primary monitor
  before any menu opens, and clicks only once the target is what the stage picks
  at that point.
- **`connectObject` does not exist under plain `gjs`.** The shell's
  `misc/signalTracker.js` adds `connectObject`/`disconnectObject` to GObject, so a
  plain-gjs check of a `shell/` module that uses them (store, environment) must
  give the object a stand-in, as `tests/smoke/store-check.js` does. Rule: run such
  checks inside the headless shell where possible; if a second plain-gjs check
  needs the stand-in, move it to one shared test helper rather than copy it.

### EDS / libical API traps (measured, gjs 1.88.1, EDS 3.60)

- `ICalGLib.Time.as_timet()` ignores the zone; use `as_timet_with_zone(zone)`.
  For `Z` times `get_timezone()` is null.
- `ECal.util_get_system_timezone()` ignores `TZ`; `GLib.TimeZone.new_local()` honours it.
- `ICalGLib.Property.isa()` throws on `CONFERENCE` (unknown to the typelib): match
  properties by name.
- `ECal.Client.connect` wants `0xFFFFFFFF`, not `-1`, for "do not wait".
- ECal applies RFC 5545 attendee defaults: no `CUTYPE` → individual, no `PARTSTAT`
  → needs-action, no `ROLE` → req-participant. So `cutype:'unknown'` only comes
  from `X-`/`UNKNOWN` values.
- The `local` backend reports the placeholder `[Local Backend] EmailAddress` as
  `cal-email-address`. It is transcribed as is; it matches no attendee.
- `ECal.Client.refresh` only schedules a sync and returns `true` at once (0–1 ms,
  7 CalDAV sources). It is not evidence that the provider was reached.
