# ADR-0001 — Calendar data comes from EDS through an out-of-process gjs helper
- **Date:** 2026-09-26
- **Kind:** reversible (behind the snapshot protocol in `interfaces.md`)

## Context

The verdict rules (PRD §1, R-4) need, for each occurrence: attendees, the owner's
participation status, the organiser, free/busy transparency, location, description,
and the conference link. R-2 requires every calendar the clock menu shows, with no
second login. R-1 and the Installer profile make "breaks the desktop session" a
reason to give up — and on Wayland a gnome-shell crash ends the session.

Evidence gathered on the author's machine (GNOME Shell 50.4, EDS 3.60.2, gjs 1.88.1):

1. **The shell's own calendar service is too thin.** `org.gnome.Shell.CalendarServer`
   has one method, `SetTimeRange(x since, x until, b force_reload)`, and emits
   `EventsAddedOrUpdated(a(ssxxa{sv}))`: id, summary, start, end, and a small dict.
   No attendees, participation, organiser, transparency or description. It is also
   a singleton the clock menu drives; an extension calling `SetTimeRange` would
   fight the shell for its range.
2. **EDS has everything, and gjs can read it.** `ECal-2.0`, `EDataServer-1.2` and
   `ICalGLib-3.0` typelibs are installed and import from gjs. A read-only probe
   over the 9 selected calendar sources found, for the next 7 days: 26 occurrences
   (22 from recurring series, expanded with recurrence ids); 8 with attendees
   (22 attendees in total, with partstat and cutype); 8 with an organiser; 5 where
   the owner's calendar address was among the attendees; transparency on all 26;
   7 with a location; 25 with a description; 6 with an `X-GOOGLE-CONFERENCE` link;
   the owner's address available from the `cal-email-address` backend property on
   the 7 GOA CalDAV sources; times in named TZIDs; one occurrence present in two
   calendars. Registry load took 26 ms and all sources about 60 ms, warm.
3. **EDS objects crash gjs at teardown.** Four of four runs using the synchronous
   registry segfaulted on exit. The core dump shows `source_registry_dispose`
   running `g_main_context_iteration` from inside the SpiderMonkey GC sweep and
   jumping to address 0. A run using the async registry and async client connect
   also dumped core at exit; a minimal async-registry-only run with the main loop
   still running exited cleanly, so the fault depends on disposal timing. Inside
   gnome-shell, the same disposal would happen on `disable()` — which runs on every
   screen lock (ADR-0005) — and a segfault there kills the session.
4. **The async instance API cannot be awaited from gjs.** `ECal.Client.generate_instances`
   (async) takes no completion callback in gjs (only a destroy-notify that gjs does
   not expose), so there is no way to know when expansion has finished. The
   synchronous `generate_instances_sync` works, but it blocks — unacceptable in
   the shell's main thread, harmless in a separate process.

Evidence added later on 2026-09-26, while planning the helper (PG-1b). It
confirms the decision and sharpens its consequences:

5. **How a gjs process that touches EDS can exit.** Clean (status 0) only when
   `System.exit(code)` runs inside a GLib main-loop source callback while the loop
   runs: 5/5 runs, and 10/10 on stdin EOF. Ending the module, `loop.quit()` then
   return, and `System.exit` with no loop all segfaulted (139, 5/5 each).
   `System.exit` from a promise continuation (after `await`) hangs forever,
   measured on the fixture and on the real calendars; deferring it through
   `GLib.idle_add(PRIORITY_HIGH)` fixes it.
6. **`ECal.Client.refresh` only schedules a sync.** It returned `true` in 0–1 ms
   on all 7 CalDAV sources, so it cannot tell whether the provider was reached.
   The only sync signal EDS gives a read-only client is the link state
   (`EClient:online`, `ESource:connection-status`); see `interfaces.md`,
   addendum 2026-09-26 (D-013).

## Options

1. **In-process EDS via GI inside gnome-shell.** Fewest parts. Forever cost: any EDS,
   libical, or GI binding fault is a desktop crash (evidence 3), and recurrence
   expansion must be done without the only awaitable API (evidence 4) or by
   blocking the compositor.
2. **The shell's CalendarServer over D-Bus.** No new process. Forever cost: cannot
   meet R-4 at all (evidence 1); would need a second source for the missing fields
   anyway.
3. **A gjs helper subprocess owning all EDS access, speaking NDJSON over stdio.**
   One extra process (about the cost of the shell's own `gnome-shell-calendar-server`,
   which exists for the same reason). Forever cost: a protocol to keep in step,
   process supervision, and a startup of well under a second.
4. **A helper that owns a D-Bus name instead of stdio.** Same isolation as 3, plus
   an interface XML, a bus name, and activation or lifetime rules. Forever cost:
   more parts, and a helper whose lifetime is no longer tied to the extension.

## Decision

Option 3. The helper (`extension/helper/`) is a GJS program started by the
extension with `Gio.Subprocess`; it is the only code that imports ECal,
EDataServer or ICalGLib. It sends complete snapshots of the range as JSON lines on
stdout, reads refresh requests on stdin, and exits when stdin closes. **The single
deciding reason: a fault in calendar access must never be able to crash the
desktop session**, and evidence 3 shows such faults are not hypothetical.

The helper lists sources the way the clock menu does (enabled calendar sources
that are selected), expands recurrences with `generate_instances_sync`, watches
for changes with client views and the source registry, and asks EDS to sync
remote sources every 10 minutes and on resume (EDS's own default is 30 minutes;
see `constraints.md`). It is read-only.

## Consequences

- Easier: the shell process never blocks on calendar I/O; the helper may use the
  simple synchronous EDS APIs; a helper crash costs a restart, not a session; the
  helper can be run by hand (`--once`, `--summary`) and tested against a fixture
  EDS with no shell (verified).
- Harder: two processes to reason about; a versioned protocol (`interfaces.md`);
  supervision with backoff; a stale-data state the product must show.
- The helper's own exit must be made not to dump core (evidence 3). The kill from
  the shell (SIGKILL via `force_exit()`; "SIGTERM" here until the 2026-09-26
  correction) ends it without running the GC, so the risk is on the stdin-EOF path.
  The rule that works is evidence 5: one deferred exit, called from a main-loop
  callback, never from after an `await`.
- We can no longer assume calendar data is instantly available at `enable()`:
  the UI must handle "no snapshot yet".

## Revisit when

- GNOME Shell's CalendarServer starts exposing attendees, participation,
  organiser, and transparency (then option 2 removes the helper), or
- the extension review process rejects a spawned GJS helper, or
- gjs and EDS disposal is shown to be safe in-process across lock/unlock cycles
  *and* an awaitable instance-expansion API exists.
