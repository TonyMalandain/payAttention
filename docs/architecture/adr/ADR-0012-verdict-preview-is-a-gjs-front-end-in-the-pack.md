# ADR-0012 — The verdict preview is a second gjs front end, shipped in the extension pack, run from the installed copy, read-only by construction
- **Date:** 2026-09-27
- **Kind:** reversible, except the `--json` output once someone depends on it (versioned, `interfaces.md` §7)

## Context

R-20 (`solution.md`): "one command in a terminal lists their upcoming meetings
with the verdict and reason payAttention would give, from the rules or from
their AI engine. It uses exactly the same judgment and the same calendar access
as the extension, not a copy." D-032: a terminal preview, not a nested desktop;
the owner asked that it not be "a cheap trick… while still being tightly
coupled to the gnome-extension framework". Backlog PG-8 adds: it never shows an
alert or changes anything, and its verdicts match the extension's (tested).

ADR-0011 makes it a front end over the one verdict component in `app/`. What
is left to decide: the runtime, where it lives and runs from, how it reads the
owner's settings without being able to change them, and how parity is proved.

Facts that bind the choice:

- Both helpers are gjs programs spawned with `Gio.Subprocess`, and their
  supervising clients (`shell/calendarFeed.js`, `shell/aiHelperClient.js`,
  `shell/helperProcess.js`) are gjs with the spawn environment rule
  (`interfaces.md` §1). EDS has no Node binding; GSettings has none either.
- Extension schemas are compiled into the extension's install directory, not
  the system schema directory (`gnome-extensions install`, `testing-and-build.md`).
- On Wayland the running shell keeps the code it loaded at login. The installed
  copy can be newer than the running one; previewing that newer copy before
  logging out is exactly the use case.

## Options

1. **gjs, shipped in the pack as `extension/preview/`, run from the install
   directory.** Reuses the feed, the AI client, the store adapter and the
   verdict component unchanged. Forever cost: one more directory in the zip and
   in `--extra-source`; an extensions.gnome.org reviewer may ask why a
   terminal entry point ships (allowed: it is GJS, spawns only our own GJS
   helpers, and needs no user action to install anything).
2. **Node CLI in the repository.** Node can spawn `gjs -m helper/main.js`, but
   it would need its own subprocess supervisor for both helpers and its own
   GSettings reader (`gsettings`/`dconf` output parsing) — second
   implementations of two adapters, which is the copy R-20 forbids — and
   Node becomes a runtime dependency for the owner, where today it is dev-only.
3. **gjs, repository-only (`tools/preview/`), not shipped.** Runs the
   checkout's code against the installed schema. The previewed code and the
   installed code can differ with nothing to tell the owner, and it still needs
   the compiled schema from the install directory.

## Decision

Option 1. **The deciding reason: it is the only option in which the preview
runs the very files the extension runs, through the very adapters it uses, so
"same judgment and same calendar access" holds by construction rather than by
test alone.**

Binding rules (details in `interfaces.md` §7):

- **Invocation:** `gjs -m ~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io/preview/main.js [--json]`. (Path updated 2026-09-29 for the ADR-0006 amendment, D-034.)
  It needs the extension installed, not enabled.
- **Read-only by construction:** it opens the installed schema itself, puts
  the `Gio.Settings` into delay-apply mode before any read (`delay()`, never
  `apply()`), and is handed only the store's **reader** facet. It never
  receives a writer, never reads or writes alert state, and keeps any AI answer
  it obtains in memory only.
- **No alerts by construction:** `preview/` may not import `ui/`,
  `shell/environment.js`, `shell/launcher.js`, `core/plan.js`,
  `core/alertState.js`, or anything under `resource:///org/gnome/shell/`
  (lint).
- **One judgment:** `preview/` may not import `core/judge.js` or the AI queue;
  its verdicts come only from the verdict component (ADR-0011).

## Consequences

- Easier: the owner sees the installed version's verdicts, from rules or their
  engine, in seconds, without logging out; the same command is a support tool.
- Harder: the pack grows by one directory; the verdict component now has two
  callers.
- Cost accepted: in AI mode the preview asks the engine for every eligible
  meeting that has no current stored answer, and keeps those answers only in
  memory, so the extension later asks again. Double asks cost money on a cloud
  engine and send the same invites a second time. The preview has its own
  in-memory request budget (120/h, `constraints.md`); with the extension
  running too, an engine can see up to 240 asks an hour.
- Cost accepted: it must run inside the owner's desktop session (a terminal
  on the desktop). Over SSH without the session bus, EDS and the keyring are
  unreachable: no calendars (it exits with a message), and AI falls back to
  rules.
- We can no longer change the verdict component's contract for the alert
  front end alone.

## Revisit when

- The owner wants previews without engine calls, or shared answers with the
  extension (the latter is a write, and reopens "never changes anything").
- extensions.gnome.org review refuses the extra entry point: then option 3,
  with a version check against the installed `metadata.json`.
