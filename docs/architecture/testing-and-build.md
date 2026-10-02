# Testing, build, install, validation

What is tested where, and the commands. Every mechanism below except the npm
script names was run on the author's machine on 2026-09-26 with a throwaway probe
extension. The npm scripts are the contract the engineers implement; the commands
behind them are the verified ones.

## The validation sequence

Run in this order. Each must pass before the next is worth running.

| Step | Command (contract) | What it runs |
|---|---|---|
| 1. Lint | `npm run lint` | `eslint .` with a flat config: gjs globals (`global`, `log`, `logError`, `print`, `console`), and the per-directory `no-restricted-imports` rules from `boundaries.md`. `preview/main.js` gets the gjs globals; the other `preview/` files are linted like `app/`. |
| 2. Unit | `npm test` | `node --test "tests/unit/**/*.test.js"` over `extension/core/`, `extension/app/`, the gi-free shell modules (`shell/settingsKeys.js`) and the preview's gi-free logic (`preview/cli.js`, `session.js`, `report.js`, and the parity test against the alert controller, `tests/unit/preview.parity.test.js`), plus a gjs run of core that fails on Node-only APIs. The directory form `node --test tests/unit/` fails on Node 24.11 (it treats the directory as a file). |
| 3. Schema | part of `npm run build` | `glib-compile-schemas --strict --dry-run extension/schemas` |
| 4. Build | `npm run build` | `scripts/build.sh`: `mkdir -p dist`, then `gnome-extensions pack extension` with one `--extra-source=<dir>` for each entry of its `DIRS` array (`core helper shell app ui ai preview`), plus `--extra-source=../LICENSE --extra-source=../NOTICE --force --out-dir=dist`. Every directory listed must be there, or the installed extension fails to import: `ai/` since PG-4 (ADR-0010), `app/` since PG-8a (ADR-0011), `preview/` since PG-8c (ADR-0012). The script checks the zip holds `ai/main.js`, `app/controller.js`, `preview/main.js`, LICENSE and NOTICE (shipped since PG-6), and that its `metadata.json` has no developer marker. From PG-13 (ADR-0013) every build makes **both** bundles, with no option or flag: the normal one, and the developer bundle, `dist/<uuid>.developer.shell-extension.zip`: the same files, with `"payattention-developer": true` added to the bundled `metadata.json` (checked present), never to `extension/metadata.json`. `dist/<uuid>.shell-extension.zip` is always the normal bundle. |
| 5. Helper integration | `npm run test:helper` | `node --test "tests/helper/**/*.test.js" "tests/ai/**/*.test.js"`: the helper against an isolated EDS with a fixture calendar (Layer 2), the AI helper against a fake engine (Layer 2b, from PG-4), and the preview installed from the zip (Layer 2c, from PG-8c). **Needs a fresh zip from step 4**: the preview test refuses to run when `dist/…shell-extension.zip` is missing or older than any file under `extension/`. |
| 6. Smoke | `npm run smoke` | A GJS store check (`GSETTINGS_BACKEND=memory`), then the install/uninstall check in a throwaway home (below), then the isolation check (`tests/smoke/isolation-check.sh`: the throwaway shell's environment refuses other homes and extras, runs on a private bus that can start only its allowlist, and none of that allowlist starts a keyring; below), then a headless gnome-shell with the normal zip installed and enabled (below), then, last, the sample shell's headless check `scripts/sample.sh --check` on the developer bundle (Layer 3b, from PG-11 Part D), so the sample's fixture and settings cannot rot unseen. So the smoke sees both bundles: no Test alert item in the normal one, the item in the developer one (ADR-0013). Needs no `mutter-devkit`. |
| 7. Real session | manual | Install, log out and in, check the journal and the checklist below. |

Setup once: `npm ci` (dev tools only; nothing from `node_modules` is ever packed).
Install into the real session: `npm run install:local` (not `install`, which npm
would run on every `npm install`/`npm ci`). It always installs the normal
bundle, so it also replaces a developer copy (ADR-0013).

**The developer copy in the real session** (D-037, ADR-0013), for the checks a
nested window cannot do (alert sound, both monitors, takeover over a
full-screen window, PaperWM): `npm run install:developer`
(`bash scripts/install.sh --developer`) installs the developer bundle by the
same path as `install:local`, so the UUID switch-over below and the enabled list
behave the same; it says it installed the developer copy. Log out and back in
to load it. To go back: `npm run install:local`, then log out and back in. To
see which copy is installed:
`grep -c payattention-developer ~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io/metadata.json`
(1 = developer, 0 = normal). The running shell keeps the copy it loaded until
the next login, whichever was installed since. `scripts/install.sh` also adds the UUID to
`org.gnome.shell enabled-extensions`, so it loads at the next login. It honours
`XDG_DATA_HOME` in its post-install check.

Remove: `npm run uninstall:local` (R-17, D-016). It stops the extension in the
running shell, removes the install directory, and takes the UUID out of
`enabled-extensions` and `disabled-extensions`. Settings are kept. When no
shell is reachable and the install directory exists, it refuses (exit 1,
nothing changed): the files may be in use by a shell it cannot see.
`npm run uninstall:local -- --purge` also erases
`/org/gnome/shell/extensions/payattention/`. From PG-4, `--purge` also clears
the keyring items of the AI key schema (ADR-0009), and a plain uninstall
reports them as kept. It never touches calendars, other extensions, other
settings, or other keyring items. It is safe to run twice. On a **locked** keyring
`Secret.password_clear` returns false with no error and removes nothing
(measured, PG-4e), so `--purge` searches again after clearing and fails
(exit 1, "your keyring is locked … Saved settings were not erased.") while any
item of the schema remains. It clears keys before settings, so a locked
keyring leaves both in place. An unreachable Secret Service also fails
`--purge`: the script cannot tell "no items" from "unreachable".

See the built extension without logging out: `npm run sample` (Layer 3b) opens
a separate GNOME Shell in a window, on a throwaway home and one test calendar.
Needs the `mutter-devkit` package once (`sudo dnf install mutter-devkit`).

### Switching an existing install to the new UUID (ADR-0006 amendment, D-034)

Binding on `scripts/install.sh` and `scripts/uninstall.sh`. The UUID changed to
`payattention@tonymalandain.github.io`; the owner's machine still has the
former copy installed, enabled and **loaded in the running shell**. The rule
guarantees: two copies are never enabled together; the running shell never
loses the files of a copy it has loaded; after the next logout/login no former
copy remains; settings, overrides, stored AI answers and AI keys are kept
(their storage names contain no domain, ADR-0006). The known cost: from the
moment the switch runs until the owner logs out and in, payAttention does not
alert (the running shell disables the former copy and, on Wayland, cannot load
the new one).

**Definitions.** `NEW=payattention@tonymalandain.github.io`,
`EXT=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions`,
`SCHEMA=org.gnome.shell.extensions.payattention`.

- **Former copy:** a directory `EXT/D` that is a real directory (not a
  symlink), where `D` matches `payattention@*`, `D` ≠ `NEW`, and
  `EXT/D/metadata.json` parses as JSON with `"uuid"` equal to `D` and
  `"settings-schema"` equal to `SCHEMA`. Former copies are **found by schema,
  never by name**: the old UUID must not appear anywhere in the repository
  (D-034), and this also covers any later rename. A former UUID left in a list
  with no directory is inert and is not touched (it cannot be told apart from
  another extension's name without writing the literal).
- **Shell state of a UUID `U`** — the only way it is detected, a read-only
  D-Bus method (`GetExtensionInfo` does a lookup and serialises metadata;
  it changes nothing in the shell, read in gnome-shell 50.5 `shellDBus.js`):

  ```sh
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.GetExtensionInfo "$U"
  ```

  | Result | State |
  |---|---|
  | exit ≠ 0 | UNREACHABLE (no shell on this session bus; `org.gnome.Shell` is not D-Bus-activatable, so this never starts one) |
  | output exactly `(@a{sv} {},)` | UNKNOWN: the running shell has no such extension; its files are not in use |
  | output contains `'uuid': <'U'>` | LOADED: the running shell has it in its extension map, enabled or not. The shell scans every extension directory at login, so a former copy present since login is always LOADED |
  | anything else | treat as UNREACHABLE |

  Do not use `gnome-extensions info` for this: it exits 2 both for "no such
  extension" and "no shell reachable" (measured, 50.5).

**install.sh**, in this order:

1. **Preflight, before the build and before any change.** Find former copies.
   If any has state UNREACHABLE, exit 1 with "an earlier payAttention install
   (`<dir>`) must be switched over from a terminal inside your GNOME session.
   Nothing was changed." The former copy keeps running.
2. Build, install `NEW`, check `schemas/gschemas.compiled` (as today). A failure
   here leaves the former copy enabled and running.
3. **One settings write, in one gjs process:** `enabled-extensions` becomes
   itself minus every former UUID and minus `NEW`, plus `NEW`;
   `disabled-extensions` becomes itself minus every former UUID and minus
   `NEW`; then `Gio.Settings.sync()`. Then re-read both lists in a fresh
   process and exit 1 if a former UUID is still in either or `NEW` is missing
   from `enabled-extensions`. Swapping in one write means no stored list ever
   holds both. The running shell reacts by running the former copy's own
   `disable()` (its settings listener) and ignores `NEW`, which it does not
   know until login.
4. **Remove each former copy by its state, queried again now:**
   - LOADED → `gnome-extensions uninstall <former UUID>`. The shell unloads it
     (disabling it first if needed) and deletes the directory itself, so files
     are never removed under a copy the shell still holds (measured PG-3; see
     Pitfalls).
   - UNKNOWN → `rm -rf --` the directory, after checking the path is
     `/*/gnome-shell/extensions/payattention@*`, is not `EXT/NEW`, and is not a
     symlink.
   - UNREACHABLE (the shell went away mid-run) → leave the directory, exit 1
     with the "from a terminal inside your GNOME session" message. The lists
     are already correct, so the next login enables only `NEW`, and the next
     install or uninstall removes the directory.
5. **Verify:** no former-copy directory remains and every former UUID now
   queries UNKNOWN; otherwise exit 1. Print that the switch happened, that
   settings and AI keys were kept, and that payAttention is off until the owner
   logs out and back in.

A second run finds no former copy and does only steps 2–3.

**uninstall.sh:** the same preflight (step 1: exit 1, nothing changed, when a
former copy is UNREACHABLE), then each former copy is removed exactly as in
step 4 and its UUID taken out of both lists in the same write as `NEW`, with the
same fresh-process re-read. Output names it as an earlier payAttention install.
**This happens on every uninstall, with or without `--purge`**: a former copy
is program files, not user data. `--purge` itself is unchanged: both identities
share one settings path and one keyring schema, so one purge covers both.

**What must be proven** (by the uninstall/install check and, for the LOADED
path, the headless shell): with no shell, a planted former copy (for example
`payattention@former.example.test` declaring `SCHEMA`) makes install and
uninstall refuse and change nothing; with a shell that has the former copy
loaded, one install leaves only `NEW` in `enabled-extensions`, no former
directory, the shell reporting the former UUID as UNKNOWN, and settings and
another extension untouched; a directory declaring another schema is never
touched.

## Layer 1 — core unit tests (Node)

`extension/core/` has no GNOME imports (ADR-0002), so Node 24 imports it directly.
Fixtures in `tests/fixtures/` are synthetic snapshots in the protocol format from
`interfaces.md` — never copies of real calendar data.

The PRD's "Done when" list maps onto core tests:

- **Verdict rules:** one test per reason in PRD §1, in rule order, including the
  missing-data default, "you answered maybe", overrides by occurrence then series,
  and duplicate occurrences from two calendars merging.
- **Online / in-person:** each named conferencing service, links in location vs
  description vs conference property, a place with a link is in person (D-038, which superseded D-007's "link wins"), placeholder words
  ("online", "TBD"), the mode override, and the https-plus-allowlist rule for Join.
  From PG-14 (D-040): a location made only of video-call wording, in any
  mix and with any punctuation ("Join Zoom Meeting", "Teams-Besprechung",
  "Microsoft Teams Meeting", "Google Meet – join"), is online; anything left
  over makes it in person: "Board room + Zoom", "Room 4.12 / Teams", "Meet at
  reception", "Remote office, 3rd floor", "Zoom 2", "Microsoft"; a service
  name inside a longer word ("Zoomlion Tower") is not a match; the
  whole-location no-place words ("TBD", "n/a", "remote") still mean no
  place. Join: an in-person meeting with
  a link has a `joinUrl`, also when switched to in person by the owner; a
  meeting without a link never has one, in either mode. In `app/view.js`, an
  in-person card with a link offers both the travel line and Join.
- **Timing:** deadline for online and in person; each step boundary; clamping of
  out-of-order offsets; snooze limited by the next step (not at step 4); return
  after being away (jump straight to the right step); overlapping meetings
  (earliest deadline primary, others "also"); the 10-minutes-after cutoff; a moved
  meeting invalidating its alert state; the heads-up not consumed while idle.
- **Travel target (PG-14, ADR-0014):** in person with a place → place entry; in
  person with no place → series entry, also for a one-off meeting; online →
  none; no fallback between the two maps; the value shown is the value a pick
  writes; `--purge` erases `meeting-travel-times` and a plain uninstall keeps it
  (uninstall check). "Clear travel times" resets both `travel-times` and
  `meeting-travel-times` (prefs tests, PG-4d harness; D-040).
- **Stored format:** occurrence, series and place keys; pruning; a corrupt
  `alert-state` string yielding empty state.
- **Budget:** `plan` over 500 occurrences under 1 ms, `judge` over 2 000 under
  20 ms, AI-mode `judge` under 200 ms (benchmark-style tests with a generous
  margin, so they catch order-of-magnitude regressions only). Each bound is
  checked against the **fastest** of at least 10 timed runs after warm-up, not
  the mean: `npm test` runs files in parallel, and other load only ever adds
  time, so the minimum is the stable figure. Never raise a bound to silence a
  flake, and never serialise the suite for it.

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

Programs these layers need beyond Node and gjs: `dbus-daemon`
(`dbus-run-session`), `gnome-keyring-daemon`, `glib-compile-schemas`, and, for
the prefs tests (PG-4d: the real `prefs.js` against a stub
`ExtensionPreferences` registered as a GResource, on a private headless GTK
display), `glib-compile-resources` and `gtk4-broadwayd`. **`gtk4-broadwayd`
must always be started with `-u <socket in the private XDG_RUNTIME_DIR>`.**
Without `-u` it opens an HTTP server on TCP port 8080 + display on every
interface, which would expose the test window to the network (measured,
PG-4d plan). The harness checks every program is present before it starts.

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
  (D-025, D-027, D-029); HTML made plain text first (line-ending tags as line
  ends, other tags dropped, entities decoded once), the whole shared
  `INVISIBLE_MARKS` list dropped, no-break spaces and hyphens made plain,
  `%xx` pauses and codes decoded, and phone dial-in strings replaced (D-029,
  D-030), in §6.2's order; `cleanText` and `validateInvite` covering every
  mark on the shared list; the dial-string scan staying linear on a long
  digit run (a timing-bounded case, not a pattern-shape assertion). These
  tests pin the formats we know; removal is best effort (D-030), so a green
  run is not a claim that no passcode can pass;
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
  `unavailable`;
- a recovery test (D-031): an engine failing with `network` is probed only at
  the end of each pause (30 s, 60 s, 90 s, 90 s…), the probes' spends are
  returned, and once it answers, the soonest waiting meeting is asked within
  91 s of the engine returning, even after a full hour of outage;
- a truthfulness test (D-031): the status is `ok` while meetings wait for
  their first answer with the engine fine, `unavailable` while any waiting
  meeting's last ask failed or the engine is down, and `ok` again once each
  waiting meeting has a current answer or the failed ones pass `cutoff`.

## Layer 2c — the preview, installed (fake data, fake engine)

From PG-8c (ADR-0012, `interfaces.md` §7.3 checks 3 and 4),
`tests/helper/preview.test.js`. The preview runs only from an installed copy,
so the test installs `dist/…shell-extension.zip` with
`gnome-extensions install` into Layer 2b's throwaway home (its own bus, XDG
directories and unlocked throwaway keyring), writes Layer 2's fixture
calendars into its isolated EDS, and runs the installed `preview/main.js`
with `GSETTINGS_BACKEND=keyfile` and `TZ=Asia/Tokyo` (times are the preview process's own).
Never the owner's extensions directory, settings, calendars, bus or keyring.
It proves:

- rules mode, `--json`: the fixture verdicts equal `judge` over the same
  snapshot, a stored override shows as overridden, a failing calendar is
  named, and the keyfile is byte-for-byte unchanged;
- text: the report, with no control byte but the line ends;
- AI mode against Layer 2b's fake engine: AI verdicts sent with the stored
  key, nothing written, no keyring item added;
- SIGINT while an ask is held: exit 130 within 5 s, both helpers gone,
  nothing written;
- an unreachable bus: exit 3 after 30 s, with the helper's own status line;
- a copy without a compiled schema: exit 2; `--bogus` exit 1, `--help` exit 0.

stderr must never contain `destroy-failed`, `ai-failed`,
`protocol-mismatch`, `helper-spawn-failed` or `internal error`. The whole
layer is skipped (not failed) when `gjs`, `dbus-daemon`,
`gnome-keyring-daemon` or `gnome-extensions` is not on `PATH`.

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
succeeds. From PG-13 (ADR-0013): a developer install leaves the marker in the
installed `metadata.json`, and the normal install that follows leaves no marker
and no file the normal bundle lacks; and a value stored under a removed key
(`show-test-alert`, `data.md` "Removed keys") is kept by a plain uninstall and
erased by `--purge`, as an owner's machine that had the PG-12 switch on will have. A stand-in shell on its private bus (`tests/smoke/fake-shell.js`)
answers `GetExtensionInfo`, so the scripts' real `gdbus` query sees UNKNOWN or
LOADED; stopping it gives UNREACHABLE. With it the check covers the switch-over
with placeholder former copies (refusal when unreachable, the one-write swap,
removal of UNKNOWN copies, a LOADED copy the shell refuses to uninstall, and
copies with another schema or behind a symlink left alone). The LOADED path
against the real shell is the ladder's last step, `10-switch-over`. It prints
`PAYATTENTION-UNINSTALL PASS` or `FAIL <check>: <reason>`.

`gnome-shell --headless` runs a complete shell with virtual monitors, in its own
D-Bus session, with an isolated home. The smoke never uses `--devkit` and must
not need the `mutter-devkit` package; only the sample window does (Layer 3b).

The isolation environment (the `env -i` list, the throwaway `XDG_*`
directories, keyfile settings, installing the built zip, writing a fixture
calendar) is defined once, in `scripts/isolated-shell.sh`, sourced by
`scripts/smoke.sh` and `scripts/sample.sh`. It accepts only two homes,
`.smoke-home` and `.sample-home` in the repository (not a symlink). `isolated_run`
runs its command on its own private session bus by default: `dbus-run-session` with a
generated config whose only service directory holds copies of a fixed allowlist
(`ISOLATED_BUS_SERVICES`), with no standard, runtime (`~/.local/share`) or
flatpak service directories, so any other name fails at once with
`ServiceUnknown`. It refuses a nested bus launcher in the command. It accepts only
the named extras in `ISOLATED_RUN_EXTRAS` (`LANG`, `WAYLAND_DISPLAY`, `GTK_A11Y`,
`PAYATTENTION_SMOKE_HOME`, `PAYATTENTION_SAMPLE_HOME`), so a caller can override
nothing it sets. It sets a throwaway `XDG_STATE_HOME` and a process marker,
`PAYATTENTION_ISOLATED_HOME`, which bus-started services inherit. The smoke's
shell therefore no longer gets portals, GNOME Online Accounts or
`org.gnome.Identity`. "By default" is exact, not a hedge: `XDG_RUNTIME_DIR` is
the owner's (the window and sound need it), so a command that unsets
`DBUS_SESSION_BUS_ADDRESS` falls back to `$XDG_RUNTIME_DIR/bus` and reaches the
owner's bus (measured, PG-11 Part D review). That is accepted: only a command
written into the smoke or sample runs here, none does this, and a command that
deliberately leaves the private bus is a defect in that command, not something
`isolated_run` can prevent without also taking away the shared runtime folder.
`scripts/smoke.sh` step 2b runs
`tests/smoke/isolation-check.sh`, which proves all of this without calling any
bus service. A second inline copy of that list anywhere is a defect: two copies
are two lists to keep safe. `tests/smoke/uninstall-check.sh` stays separate on
purpose (it needs real dconf and its own `XDG_RUNTIME_DIR`).

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
`destroy-failed`, `grab-failed`, `protocol-mismatch`, `helper-spawn-failed`,
`ai-failed`, `ai-protocol-mismatch`, `ai-spawn-failed`, and the helper's
`registry-failed`, `helper-failed`), and any `Gjs-CRITICAL` whose
line or stack trace mentions payattention.

What the smoke script checks:

1. `Main.extensionManager.lookup(uuid).state` is ACTIVE (1) and `error` is empty.
2. The indicator is in the panel and shows the fixture meeting that
   `scripts/smoke.sh` writes into the isolated EDS (`Smoke client review`, 2–3 h
   ahead), so the helper, `judge` and `plan` all ran on fixture data only.
   Do Not Disturb is set (`show-banners=false`) for the whole run.
   The fixture also has an all-day event (`Smoke all-day check`): it is in
   today's menu at any hour and never alerts. The script opens the menu, clicks
   that event's Must attend switch, and checks the override was stored and that
   the menu and the row stayed open, showing Back to automatic; then Back to
   automatic clears it, still without closing the menu (PG-15). A second
   all-day event with a place (`Smoke all-day site visit`) is in person: the
   script opens its row and
   checks the seven travel lines carry one kind of round mark in one column, the
   30 min one filled (check `2b-menu-travel`). A third all-day event with no
   place (`Smoke all-day workshop`) is switched to in person, given a travel
   time, and switched back to online, all without reopening the menu (check
   `2d-placeless-travel`, PG-15). From PG-13 (D-037, ADR-0013):
   the normal bundle's menu offers no Test alert item, and the installed schema
   has no `show-test-alert` key (check `2c-menu-test-alert`; replaces the PG-12
   flip check). The developer bundle's item is checked by the sample's check
   (Layer 3b). Step 3 below does not depend on the item: `runTestAlert()` is
   not gated in any build (`interfaces.md` §4).
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
   whose construction fails leave nothing on the stage. Then the menu redraws
   rows in place from synthetic Views through the installed `ui/indicator.js`
   (check `6e-menu-rows`, PG-15): an open row stays open with its new state, a
   drawn change is never reported as a click, and a row that is still listed
   stays open across a rebuild.
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

## Layer 3b — the sample shell (`npm run sample`, from PG-11 Part D)

A developer command, not a validation step: the owner looks at the built
extension in a window without logging out, and without it touching their
session's data. `npm run sample` → `bash scripts/sample.sh`; `--check` runs the
same setup headless and is the smoke's last step.

- **What it runs.** A fresh `.sample-home/` in the repository, the working tree
  built and installed there, one local calendar with one in-person must-attend
  fixture meeting timed so the heads-up is due at start, keyfile settings with
  the extension enabled, then `gnome-shell --devkit --wayland` through
  `isolated_run` (which provides the private allowlist bus) with a throwaway
  `HOME` and `XDG_STATE_HOME`.
  The window is drawn by `/usr/libexec/mutter-devkit` (`stack.md`).
- **Viewing aids.** The sample runs the **developer bundle** (ADR-0013), so the
  menu always offers Test alert with no extra step (D-037); `sample-check.js`
  checks the item is there (check `3b-test-alert`). It sets one setting,
  `headsup-display-seconds=120`, the top of that setting's own range
  (`data.md`), so the heads-up stays long enough to look at. That is an
  ordinary setting value in the throwaway keyfile, and the developer marker is
  a build fact, not a sample one: nothing under `extension/` knows about the
  sample. Any other departure from product behaviour for viewing's sake must be
  an existing setting or a developer aid recorded in `interfaces.md` §4.1, or it
  comes back here.
- **What it must never touch:** the owner's session bus, calendars (EDS),
  keyring, dconf, and `~/.local/share/gnome-shell/extensions`. The sample's
  private bus, which it uses by default (Layer 3: never the owner's bus by
  default, not "cannot"), can start only the allowlist, so no keyring or portal
  can start through it. `tests/smoke/isolation-check.sh` asserts the allowlist holds none
  of the keyring-starting names and no service file runs a keyring program;
  `sample-check.js` asserts the running shell's bus offers exactly the
  allowlist. The keyring-starting names, measured on Fedora 44 in
  `/usr/share/dbus-1/services`: `org.freedesktop.secrets`, `org.gnome.keyring`,
  `org.freedesktop.impl.portal.Secret` (all `gnome-keyring-daemon`),
  `org.kde.secretservicecompat`, `org.freedesktop.impl.portal.desktop.kwallet`
  (both `ksecretd`), `org.kde.kwalletd5`, `org.kde.kwalletd6` (both
  `kwalletd6`). An allowlist, not masks: a blocklist fails open when a new
  keyring name ships. No check ever starts a service (no `StartServiceByName`):
  a missing block would otherwise start the very daemon it keeps out. The script
  compares a recursive listing of the owner's extensions folder (everything
  under it, never its parent, which the live shell touches when it saves state),
  taken before the build and after the run, and fails if it changed.
- **What it shares with the live session, accepted:** (1) the owner's Wayland
  compositor, which shows the viewer window (`WAYLAND_DISPLAY` is passed only
  in window mode, as an explicit extra); (2) `XDG_RUNTIME_DIR`, so the nested
  shell's socket appears there, and the viewer's picture and any alert sound go
  through the owner's PipeWire/PulseAudio; (3) the real system bus, as in the
  smoke. None of these is a store of the owner's data. Bus-started helpers of the
  sample (for example the accessibility bus) may still create sockets in the
  shared runtime folder; accepted under (2), they hold no data. The same rule as the
  smoke holds: never *call* a service that changes machine state. Never fall
  back to `--display-server` or anything that takes the real seat.
- **Needs:** GNOME Shell 50 (checked first); window mode also needs
  `mutter-devkit` installed and `WAYLAND_DISPLAY` set, each with a one-line
  message and exit 1 before anything changes. `--check` needs neither.
- **Clean-up:** on any exit, every process of the owner's user carrying the
  sample's isolation marker (`PAYATTENTION_ISOLATED_HOME`) in its environment is
  stopped; a command-line match could kill the owner's own processes, such as a
  `tail -f` of the sample's log. `.sample-home/` is git- and lint-ignored.

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
next must-attend meeting from the real calendars; the normal copy's menu has no
Test alert; with the developer copy (`npm run install:developer`, above), Test
alert runs all four steps;
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
stopped, the menu says "AI unavailable — using rules", and (with the developer
copy) a Test alert still runs all four steps on time. The key is visible in Passwords and Keys and absent
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
  `misc/signalTracker.js` adds `connectObject`/`disconnectObject` to GObject.
  Any `shell/` module that also runs outside GNOME Shell must use plain
  `connect`/`disconnect` with a kept handler id: `shell/store.js` does, since
  the preview runs it under plain gjs (commit e30f715), so the store needs no
  stand-in. `shell/environment.js` (and `ui/`) still use `connectObject`; they
  run only in the shell, and a plain-gjs check of them must give the object a
  stand-in. Rule: run such checks inside the headless shell where possible; if
  a plain-gjs check needs the stand-in, put it in one shared test helper
  rather than copy it.
- **Counting `changed` signals cannot see a same-value write** (GSettings memory
  backend, found in PG-8b). A `set_*` that stores the value already there emits
  no `changed`, so a check like "writing X again does nothing" or "reading never
  writes" passes whether or not the code wrote. Instead, call `delay()` on the
  `Gio.Settings` under test and assert `!settings.get_has_unapplied()` after the
  action (and again after any flush, such as `destroy()`): in delay mode every
  write, same value or not, is held as unapplied. `tests/smoke/store-check.js`
  does this for the reader ("reading never writes") and for the writer's
  `ai-verdicts` seed. Keep counting signals only for checks that a *different*
  value was written, or that a write was coalesced.

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
