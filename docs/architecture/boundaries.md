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
  shell/                in-shell services: calendar feed, store, controller, environment
  ui/                   actors: indicator + menu, card, takeover, sound
tests/
  unit/                 node --test suites for extension/core and the gi-free shell modules
  helper/               node --test suites that run the helper against an isolated EDS
  fixtures/             synthetic snapshots (never real calendar data)
  smoke/                headless gnome-shell automation script(s)
scripts/                build, install, smoke wrappers
package.json            dev-only: test and lint tooling; never packed
eslint.config.js        dev-only
dist/                   build output (git-ignored)
```

Everything under `extension/` other than the files `gnome-extensions pack` picks up
by default (`metadata.json`, `extension.js`, `prefs.js`, `stylesheet.css`,
`schemas/`) must be passed with `--extra-source`. See `testing-and-build.md`.

## Import rules

| Directory | May import | Must not import |
|---|---|---|
| `core/` | other `core/` modules only | anything `gi://`, anything `resource://`, any Node built-in. No clock reads, timers, or I/O: time is a parameter. |
| `helper/` | `gi://` (ECal 2.0, EDataServer 1.2, ICalGLib 3.0, Gio, GioUnix, GLib), gjs's built-in `system` module, the protocol module in `core/` | `resource:///org/gnome/shell/...`, `shell/`, `ui/`, St/Clutter/Meta/Shell, the rest of `core/` |
| `shell/` | `core/`, `gi://` Gio/GLib/Meta/Shell, `resource:///org/gnome/shell/...` | ECal, EDataServer, ICalGLib, Gtk/Gdk/Adw, `ui/` internals, the `system` built-in |
| `ui/` | `gi://` St/Clutter/Gio/GLib/Meta/Shell, `resource:///org/gnome/shell/...`, `core/display.js` (formatting only) | `helper/`, the store, GSettings, ECal/EDataServer/ICalGLib, Gtk/Gdk/Adw, the `system` built-in |
| `extension.js` | `shell/`, `ui/`, the Extension base class | ECal, EDataServer, ICalGLib, Gtk/Gdk/Adw, the `system` built-in |
| `prefs.js` | `gi://` Gtk 4, Adw, Gio, GLib; `core/` (for defaults such as built-in word lists) | Clutter, Meta, St, Shell, `shell/`, `ui/`, `helper/` |

These are enforced with ESLint `no-restricted-imports` per directory, so a breach
fails lint rather than review.

- **`GioUnix` in the helper (allowed 2026-09-26).** Since GLib 2.80 the Unix
  stream classes live in `GioUnix`; the old `Gio.Unix*Stream` names still work
  but print a `Gjs-WARNING` on every use (measured, GLib 2.88.3). The helper
  needs stdin and stdout as streams, so it imports `GioUnix`. No other directory
  needs it.
- **The `system` built-in is the helper's only.** `System.exit` inside the shell
  process would end the desktop session, so `shell/`, `ui/`, `extension.js` and
  `prefs.js` must not import it.
- **Node-tested shell modules.** A `shell/` module may be unit-tested under Node
  in `tests/unit/` only if it has no `gi://` and no `resource://` imports; its
  GNOME parts are injected (`interfaces.md` §3).

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
  age. It is the only code that touches GSettings in the shell process.
- **Controller** must not draw. It must not reach into actors; it hands the UI a
  Plan and receives actions.
- **UI** must not decide. It never computes a step, a verdict, a deadline, or
  whether to show something. It must not own scheduling timers: the only timers in
  `ui/` are animations and display-only effects (for example, a pulsing border).
  It never writes settings; it emits actions.
- **Preferences** must not know alert state or the helper.

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
