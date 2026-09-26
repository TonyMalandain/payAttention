# ADR-0002 — Verdicts and the ladder are a pure core, driven by a 1-second level-triggered tick
- **Date:** 2026-09-26
- **Kind:** reversible

## Context

The PRD's "Done when" requires automated tests for every verdict reason and for
timing: online, in person, hybrid, overrides, snooze limits, return after being
away, overlapping meetings, and the cutoff. Shell code cannot be unit-tested
outside a running shell. The ladder must also behave correctly across suspend,
lock, restart, clock changes, and meetings that move while an alert is up (R-8,
R-13).

## Options

1. **Edge-triggered timers.** Schedule a GLib timeout for each step of each meeting.
   Forever cost: every change (snooze, move, override, resume, lock) must cancel and
   reschedule the right timers; GLib's monotonic timers do not count suspended
   time, so steps fire late after sleep; the logic lives in shell code and can only
   be tested in a shell.
2. **Level-triggered pure core.** A pure `plan(now, judged, alertState, timing, env)`
   is called once a second; the UI reconciles to its result. Forever cost: one
   cheap function call per second, and the discipline of keeping `core/` free of
   GNOME imports.

## Decision

Option 2. `extension/core/` holds `judge`, `plan` and `reduce` (see `interfaces.md`)
and imports nothing from GNOME, so it runs unchanged under Node's test runner and
under gjs. **The deciding reason: the whole ladder, including every failure case,
becomes a function of its inputs** — testable with fake times and immune to missed
or stale timers.

## Consequences

- Easier: R-13 falls out of the model; suspend, lock and restart need no special
  code; all PRD timing cases are Node unit tests.
- Harder: `core/` may never read the clock or import `gi://` — enforced by lint.
  "Play the sound once" is an edge, so it lives in the controller, which compares
  consecutive Plans.
- The UI must be idempotent and cheap to call with an unchanged Plan.

## Revisit when

A measured per-tick cost exceeds the 1 ms budget in `constraints.md` on the
author's machine (then compute a next-change time and sleep until it, keeping the
same pure function).
