# Stack

Every technology in use and why. Build-vs-adopt calls are at the bottom.

| Technology | Used for | Why this one |
|---|---|---|
| GNOME Shell 50 extension API (ESM) | The product (R-1) | The product is a GNOME extension by definition; ESM is the only form GNOME 45+ loads. |
| St, Clutter, Meta, Shell (in-shell) | Indicator, cards, takeover, idle monitor, modal grab | The only way to draw above windows on Wayland from an extension. |
| evolution-data-server 3.60 via GI: `ECal-2.0`, `EDataServer-1.2`, `ICalGLib-3.0` | Calendar data, in the helper only | The same service the clock menu reads, so "every calendar shown in the clock menu" (R-2) holds with no login. The only local source with attendees, participation, organiser, transparency and conference data (ADR-0001). |
| `gjs -m` subprocess + NDJSON over stdio | Helper transport | Isolates EDS from the shell with no bus name, no D-Bus XML, and a lifetime tied to a pipe (ADR-0001). |
| GSettings (dconf) | All durable state | Atomic writes, change signals, shared with prefs, visible to `dconf dump` (ADR-0003). |
| GTK 4 + libadwaita | `prefs.js` | What the shell's preferences host provides. |
| `Gio.AppInfo.launch_default_for_uri_async` | "Join" | Opens the owner's default browser or meeting app; no network code of ours. |
| Node 24, `node:test`, `node:assert` | Unit tests of `core/` (dev only) | Present on the machine; zero dependencies; runs the ESM core unchanged (ADR-0002). |
| ESLint (flat config) + `globals` | Lint, and enforcing import boundaries (dev only) | The GNOME project lints gjs with ESLint; `no-restricted-imports` makes boundaries mechanical. Installed from npm into `node_modules/`, never packed. |
| `gnome-extensions pack` / `install` | Build and local install | Official tool. `install` compiles the schemas into the install directory (verified). |
| `gnome-shell --headless --virtual-monitor … --automation-script` | Smoke tests in an isolated shell | Verified working on this machine, including two virtual monitors. No devkit package needed. |

## Build, adopt, or extend

- **Calendar access — adopt EDS.** Alternatives: Google/Microsoft APIs directly
  (network code, a second login, breaks R-2 and the spirit of R-3); parsing EDS's
  on-disk cache (private, unversioned format); the shell's `CalendarServer`
  (too few fields — see ADR-0001). EDS is the maintained system service that
  already holds exactly this data.
- **Verdicts, ladder, UI — build.** This is the product's differentiating logic.
  No GNOME extension found does importance judgment plus escalation (product
  decision D-002). Existing reminder extensions (Calendar Reminders, Next Meeting,
  Chronome) use the notification tray, which we must avoid for R-12.
- **iCalendar parsing — adopt libical through EDS.** Recurrence expansion and time
  zones are handled by `ECal.Client.generate_instances_sync`; we write none of it.
- **Test runner — adopt Node's built-in runner.** No gjs test framework is needed
  because core has no GNOME imports. Jasmine-gjs was not needed.
