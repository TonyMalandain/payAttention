# Boundaries

What each part owns, what it may import, and — the half that gets broken — what it
must not know. Directory level only. How each directory is organised inside is the
senior engineer's call.

## Repository layout

```
extension/              the pack source: exactly what ships in the zip
  metadata.json         uuid payattention@tonymalandain.github.io, shell-version ["50"]
  extension.js          composition root (enable/disable only)
  prefs.js              preferences window (GTK4/Adw process)
  stylesheet.css
  schemas/              org.gnome.shell.extensions.payattention.gschema.xml
  core/                 pure logic: protocol validation, keys, judge, plan, reduce
  helper/               the calendar helper program (run as a subprocess)
  ai/                   the AI helper program (run as a subprocess, only in AI mode; ADR-0010)
  shell/                GNOME adapters: calendar feed, store, AI client, ticker, environment, launcher
  ui/                   actors: indicator + menu, card, takeover, sound
  app/                  gi-free orchestration (ADR-0011): controller, AI queue and budget, health, backoff, view, sound cue; verdict component from PG-8b
  preview/              (from PG-8, ADR-0012) the terminal verdict preview, a second front end
tests/
  unit/                 node --test suites for extension/core, extension/app and gi-free shell modules
  helper/               node --test suites that run the helper against an isolated EDS
  fixtures/             synthetic snapshots (never real calendar data)
  ai/                   node --test suites that run the AI helper against a fake engine on 127.0.0.1
  smoke/                headless gnome-shell automation script(s), install/uninstall check
scripts/                build, install, uninstall (--purge), smoke wrappers
package.json            dev-only: test and lint tooling; never packed
eslint.config.js        dev-only
dist/                   build output (git-ignored)
```

Everything under `extension/` other than the files `gnome-extensions pack` picks up
by default (`metadata.json`, `extension.js`, `prefs.js`, `stylesheet.css`,
`schemas/`) must be passed with `--extra-source`. See `testing-and-build.md`.

## Ports and adapters (ADR-0011)

Three rings; dependencies point inward only. `core/` holds the rules (pure).
`app/` holds the application orchestration, pure JavaScript with every outside
part injected (`interfaces.md` §7.1, built in PG-8a). Everything that touches gjs, GLib, GNOME or the
network is an adapter. A front end (the extension, the preview) only composes
adapters with `app/`; only the verdict component (`app/verdicts.js`, from
PG-8b) calls `core/judge.js`. Until PG-8b lands, `app/controller.js` is that
caller.

| Port | Adapter | Where it lives |
|---|---|---|
| Calendar source (snapshot protocol, §1) | EDS reader process | `helper/`; client `shell/calendarFeed.js`, `shell/helperProcess.js` |
| Settings and overrides store (reader + writer facets) | GSettings | `shell/store.js`, `shell/settingsKeys.js`; edited by `prefs.js` |
| Key store (read only by the AI adapter) | libsecret | `ai/keyring.js` (read), `prefs.js` (write), `scripts/uninstall.sh` (clear) |
| AI engine (AI protocol, §6.6) | AI helper process | `ai/`; client `shell/aiHelperClient.js` |
| Clock | `Date.now`, injected | composition roots |
| Ticker | `GLib.timeout_add` | `shell/ticker.js` |
| Environment: idle, resume (Shell process only) | Shell idle monitor, LoginManager | `shell/environment.js` |
| UI sink (Shell process only) | St/Clutter actors, modal grab | `ui/` |
| Link launcher (Shell process only) | `Gio.AppInfo` + Shell launch context | `shell/launcher.js` |

- **Known leak: the key-store adapter is in three places** (ADR-0011 Leak 4):
  the libsecret schema is built in `ai/keyring.js` and again in `prefs.js`,
  and `scripts/uninstall.sh` repeats its name. Accepted until a second key
  store exists; repaying it is the same boundary change as the `stdio.js`
  duplicate below.

## Import rules

| Directory | May import | Must not import |
|---|---|---|
| `core/` | other `core/` modules only | anything `gi://`, anything `resource://`, any Node built-in. No clock reads, timers, or I/O: time is a parameter. |
| `helper/` | `gi://` (ECal 2.0, EDataServer 1.2, ICalGLib 3.0, Gio, GioUnix, GLib), gjs's built-in `system` module, the protocol module in `core/` | `resource:///org/gnome/shell/...`, `shell/`, `app/`, `ui/`, `ai/`, St/Clutter/Meta/Shell, Soup, Secret, the rest of `core/` |
| `ai/` | `gi://` (Soup 3.0, Secret 1, Gio, GioUnix, GLib), gjs's built-in `system` module, exactly `core/aiProtocol.js`, `core/aiPrompt.js` and `core/aiEngine.js` (the lint allowlist; `core/protocol.js` arrives only transitively, for its enum lists) | `resource:///org/gnome/shell/...`, `shell/`, `app/`, `ui/`, `helper/`, ECal/EDataServer/ICalGLib, St/Clutter/Meta/Shell, Gtk/Gdk/Adw, the rest of `core/` |
| `shell/` | `app/`, `core/` except `judge.js`, `gi://` Gio/GLib/Meta/Shell, `resource:///org/gnome/shell/...` | ECal, EDataServer, ICalGLib, Soup, Secret, Gtk/Gdk/Adw, `ui/`, `helper/`, `ai/`, `core/judge.js`, the `system` built-in |
| `ui/` | `gi://` St/Clutter/Gio/GLib/GObject/Pango/Meta/Shell, `resource:///org/gnome/shell/...`, `core/display.js` (formatting only) | `shell/` (so the store too), `app/`, `helper/`, `ai/`, the rest of `core/`, GSettings, ECal/EDataServer/ICalGLib, Soup, Secret, Gtk/Gdk/Adw, the `system` built-in |
| `app/` | other `app/` modules, `core/` (`core/judge.js` from `app/verdicts.js` only) | as `core/`: anything `gi://` or `resource://`, any Node built-in, the `system` built-in; `shell/`, `ui/`, `helper/`, `ai/`, `preview/`; `core/judge.js` outside `app/verdicts.js` |
| `preview/` (from PG-8, §7.3) | `core/` except `judge.js`, `plan.js`, `alertState.js`; the verdict component in `app/`; `shell/store.js`, `shell/calendarFeed.js`, `shell/aiHelperClient.js`, `shell/helperProcess.js`, `shell/ticker.js`; `gi://` Gio, GLib; the `system` built-in | `app/aiQueue.js`, `ui/`, `shell/environment.js`, `shell/launcher.js`, `helper/`, `ai/`, `resource:///org/gnome/shell/...`, St/Clutter/Meta/Shell, Gtk/Gdk/Adw, Soup, Secret, ECal/EDataServer/ICalGLib |
| `extension.js` | `shell/`, `app/`, `ui/`, the Extension base class | `core/`, `helper/`, `ai/`, ECal, EDataServer, ICalGLib, Soup, Secret, Gtk/Gdk/Adw, the `system` built-in |
| `prefs.js` | `gi://` Gtk 4, Adw, Gio, GLib, Secret 1 (to store and clear the AI key only, ADR-0009); `core/` (for defaults, built-in word lists, the invite field list it shows, the endpoint rules, the key rule in `aiEngine.js`, and every Settings decision in `aiSetup.js`) | Clutter, Meta, St, Shell, Soup, `shell/`, `app/`, `ui/`, `helper/`, `ai/`, `core/judge.js` (it may *spawn* `ai/main.js` for "Test connection", never import it) |

The "must not import" column is enforced with ESLint `no-restricted-imports` per
directory, so a breach fails lint rather than review. Two parts are not enforced
by lint and are held by review only: `shell/` using St/Clutter, and `ui/`
creating a `Gio.Settings`.

- **One caller of `core/judge.js` (ADR-0011; decided 2026-09-27).** Only
  `app/verdicts.js` may import it. Lint guard carried by PG-8c (which already
  adds the `preview/` block that forbids `judge.js`); until it lands, review
  holds it, and `app/controller.js` is the one caller until PG-8b replaces
  it. ESLint flat config *replaces* a rule's options when two blocks match
  the same file, so the guard is a pattern inside each directory's existing
  `no-restricted-imports` list (and an `app/` pattern that `verdicts.js`
  escapes), not a separate block, or it would silently disable the
  per-directory rules. `tests/` may import `judge.js`.

- **`GioUnix` in the helper (allowed 2026-09-26).** Since GLib 2.80 the Unix
  stream classes live in `GioUnix`; the old `Gio.Unix*Stream` names still work
  but print a `Gjs-WARNING` on every use (measured, GLib 2.88.3). The helper
  needs stdin and stdout as streams, so it imports `GioUnix`. No other directory
  needs it.
- **The `system` built-in is the helper's only.** `System.exit` inside the shell
  process would end the desktop session, so `shell/`, `app/`, `ui/`,
  `extension.js` and `prefs.js` must not import it.
- **The AI helper checks invites, it never builds them** (ADR-0010,
  amended). Its allowlist leaves out `core/invite.js`, `judge.js` and the
  rest of core, so the helper cannot reshape what is sent, only refuse it.
- **Network and secrets are the AI helper's only** (ADR-0010, ADR-0009). No
  other directory imports Soup, and only `ai/` (read) and `prefs.js` (write)
  import Secret. The lint rules forbid both elsewhere, so a breach fails lint.
  (Found 2026-09-27: `eslint.config.js` did not yet enforce this or any `ai/`
  rule; the PG-4b plan's first step adds it. Until that lands, review holds it.)
- **Known duplicate: `ai/stdio.js` near-copies `helper/stdio.js`**, because
  `ai/` may not import `helper/`. Accepted debt (PG-4b). Repaying it means a
  shared "gjs subprocess stdio" module both helpers may import, which is a
  boundary change and needs the architect.
- **Known duplicate: the keyring schema name in `scripts/uninstall.sh`.**
  `ENGINE_KEY_SCHEMA_NAME` is defined once in `core/aiEngine.js`, but a shell
  script cannot import core, and by the time `--purge` clears the keyring the
  installed copy of core is already gone. So the script repeats the name, with
  a comment naming the constant. Guarded, not trusted: the uninstall check
  seeds keyring items with core's constant and fails if the script leaves any
  (PG-4e). Accepted; there is nothing cheaper that works after removal.
- **`prefs.js` has three jobs, one of them decisions-free.** Widgets, the
  keyring write, and the one-off "Test connection" helper run stay in
  `prefs.js` (GNOME loads it from the extension root). All the decisions are
  in `core/aiSetup.js` (`interfaces.md` §6.9). No `prefs/` directory until a
  second gi module is needed beside it.
- **Node-tested modules.** Everything in `app/` is unit-tested under Node; lint
  keeps it gi-free (PG-8a), and its GNOME parts are injected (`interfaces.md`
  §3). A `shell/` adapter may be imported by a Node test only if it has no
  `gi://` and no `resource://` imports (today only `shell/settingsKeys.js`,
  from `tests/unit/schema.test.js`).

## What each part must not know

- **Core** must not know GNOME, EDS, GSettings, JSON-over-stdio, or the wall clock.
  It receives plain objects and returns plain objects. If a core function needs
  "now", it takes `now` as an argument. This is what keeps the verdict rules and
  the ladder testable under Node (ADR-0002).
- **Helper** must not know verdicts, settings, overrides, alert state, or the UI.
  It transcribes; it does not judge. It never calls any EDS method that creates,
  modifies, or removes an object ("not a calendar", `solution.md`). It must not
  log calendar content (titles, people, places) — counts and error codes only.
- **Calendar feed** must not know what a meeting means. It passes validated
  snapshots on; it never filters or edits events.
- **Store** must not know rules. It reads and writes typed values and prunes by key
  age. It is the only code that reads or writes GSettings in the shell process;
  `extension.js` only obtains the `Gio.Settings` object (`getSettings()`) and
  hands it to the store.
- **Controller** must not draw. It must not reach into actors; it hands the UI a
  Plan and receives actions.
- **UI** must not decide. It never computes a step, a verdict, a deadline, or
  whether to show something. It must not own scheduling timers: the only timers in
  `ui/` are animations and display-only effects (for example, a pulsing border).
  It never writes settings; it emits actions.
- **AI helper** must not know calendars, overrides, settings, alert state, or
  the UI. It receives its configuration and one bounded invite per request on
  stdin, and nothing else. It builds one request per invite, validates the
  reply with core, and returns a verdict or a short failure code. It never logs
  invites, titles, replies, reasons, or keys (codes and HTTP status only). It
  never follows a URL or runs anything named in a reply.
- **Core** also owns the invite field list, the invite builder and its size
  caps, the fingerprint, the endpoint rules (`normaliseEndpoint`,
  `endpointClass`), the prompt text, and the reply validator (`interfaces.md`
  §6). Because they are pure, the D-020 bounds, "overrides are not sent" and
  the injection promises are proven by unit tests.
- **Preferences** must not know alert state or the helper. It may spawn the
  AI helper for "Test connection" and read its one-line answer.

## Ownership of data

| Data | Owner (only writer) | Readers |
|---|---|---|
| Calendar events | the owner's calendar provider, via EDS | helper (read-only) |
| Last snapshot and its freshness | calendar feed | controller |
| Judged occurrences, Plan | controller (computed by core, in memory) | UI |
| Settings keys | prefs.js and the store (for values set from the menu) | store, prefs.js |
| Verdict overrides, mode overrides, travel times | store (on controller request) | store, prefs.js may clear |
| Alert state | store (on controller request, via core `reduce`) | controller |
| Persisted health clocks (`health-*` keys) | store (on controller request, in `disable()`) | controller, at `enable()` |
| AI settings (`verdict-source`, `ai-endpoint`, `ai-model`) | prefs.js | store, prefs.js |
| AI answers (`ai-verdicts`) | store (on controller request, from AI helper replies) | controller, into `judge` |
| AI engine keys (GNOME keyring, ADR-0009) | prefs.js | AI helper only; `scripts/uninstall.sh --purge` clears |
| Everything above, for the preview (ADR-0012) | nothing: the preview writes no data | preview reads settings, overrides, travel and AI answers through the store's reader facet, with the settings object in delay-apply mode |
