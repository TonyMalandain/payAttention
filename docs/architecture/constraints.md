# Constraints

Numbers every design is measured against, then the rules imposed from outside
(GNOME review guidelines, security). "Measured" means measured on the author's
machine on 2026-09-26; "assumed" means a target nobody has measured yet.

## Platform

| Constraint | Value | Source |
|---|---|---|
| GNOME Shell | 50 only (`"shell-version": ["50"]`) | PRD out-of-scope; measured 50.4 |
| Session | Wayland; no X11 code paths | measured |
| gjs | 1.88 (SpiderMonkey 140), ES modules | measured |
| evolution-data-server | 3.60, typelibs `ECal-2.0`, `EDataServer-1.2`, `ICalGLib-3.0` present | measured |
| Other extensions to coexist with | PaperWM, Blur my Shell, Move Clock, system-monitor-next | measured (`gnome-extensions list --enabled`) |

## Safety of the shell process

The shell is the whole desktop on Wayland: if it crashes, the session and every
open window go with it. So:

- **No EDS, ECal, EDataServer, or ICalGLib in the shell process.** Ever (ADR-0001).
- **No synchronous I/O, subprocess, or D-Bus calls in the shell process.**
- **Per-tick work** (`plan` + UI reconcile with an unchanged Plan): under 1 ms for
  500 judged occurrences (assumed; to be measured by a core benchmark test).
- **`judge`** runs only when its inputs change (new snapshot, settings, overrides),
  not per tick. Under 20 ms for 2 000 occurrences (assumed).
- **A modal grab is never left behind.** Every exit from the takeover releases it.

## Timing

| What | Value | Source |
|---|---|---|
| Controller tick | 1 s | ADR-0002 |
| A step appears after its time | within 1 s while unlocked and awake | follows from the tick |
| After unlock or resume | within 1 s of `enable()` / first tick; helper refresh requested on resume | ADR-0005 |
| Idle threshold for "owner is active" | 60 s | assumed |
| Snapshot range | [now − 1 h, now + 36 h) | covers "next 24 h" (PRD §1), today's menu, and meetings in progress up to the cutoff |
| Re-snapshot after a local EDS change | ≤ 3 s (2 s debounce) | assumed |
| Periodic re-snapshot | every 5 min (slides the range) | assumed |
| Remote sync by EDS | every 30 min by default | measured: 9 of 9 sources |
| Helper asks EDS to sync remote sources | every 10 min, and on resume | assumed; see NOTES "freshness" |
| Data considered stale | no good snapshot for 15 min → data-health flag false | assumed |
| Helper restart backoff | 1 s, doubling, capped at 5 min; reset after 10 min of healthy running | assumed |
| Per-source connect timeout in helper | 5 s; a slow source is reported `ok:false`, others still delivered | assumed |

## Scale

| What | Value | Source |
|---|---|---|
| Calendar sources | 9 (1 contacts/birthdays, 1 local, 7 CalDAV via GOA) | measured |
| Occurrences, next 7 days | 26, of which 8 have guests, 22 recurring | measured |
| Helper first snapshot, warm EDS | registry 26 ms; all sources, 7 days, ~60 ms | measured |
| Designed for | ≤ 50 sources, ≤ 2 000 occurrences in range | assumed |
| One snapshot line | ≤ 4 MiB; description capped at 32 768 characters | assumed |

## Privacy and security

- **No network from our code.** Neither the extension nor the helper opens a
  socket. EDS syncs with the owner's own providers as it already does (R-3).
- **No calendar content in logs.** Titles, people, places, descriptions, and links
  are never logged, by either process. Counts and short error codes only.
- **Untrusted text.** Everything in an event may come from a stranger's invite.
  Render as plain text; never as Pango markup.
- **Links.** "Join" opens only `https:` URLs whose host is on core's conferencing
  allowlist, through the desktop's default handler. Nothing else is ever launched.
- **Read-only calendars.** The helper calls no EDS method that writes.
- **No telemetry.** (Also a review rule.)

## GNOME extension review rules that bind this code

From the GNOME extensions review guidelines (gjs.guide), current for GNOME 45+:

- ES modules only. `extension.js` default-exports a subclass of `Extension`;
  `prefs.js` a subclass of `ExtensionPreferences`.
- **Nothing in the constructor or at module scope** except static data. No
  objects, signals, main-loop sources, or shell changes before `enable()`.
- **`disable()` undoes all of `enable()`:** destroy every actor, disconnect every
  signal, remove every main-loop source (even ones that already returned
  `SOURCE_REMOVE`), pop the modal grab, kill the helper, drop the settings object,
  clear module-scope maps. `disable()` runs on every screen lock (ADR-0005), so a
  leak here is a leak per lock.
- No `ByteArray`, `Lang`, or `Mainloop` imports. Use `TextDecoder`, classes, and
  `GLib.timeout_add*`.
- No Gtk/Gdk/Adw in the shell process; no Clutter/Meta/St/Shell in `prefs.js`.
- Subprocesses: no binaries, no privileged helpers; scripts in GJS (our helper is
  GJS); never spawn synchronously.
- Schema id and path under `org.gnome.shell.extensions` /
  `/org/gnome/shell/extensions/`; file named `<schema-id>.gschema.xml`; the XML is
  in the zip.
- `metadata.json`: only needed keys; no `session-modes` key (we use `user` only);
  `shell-version` lists only released versions.
- Licence GPL-2.0-or-later compatible. Code is readable, not minified. Logging is
  sparse.
