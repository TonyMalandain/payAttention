# ADR-0003 — All durable state lives in GSettings, keyed by iCalendar UID
- **Date:** 2026-09-26
- **Kind:** one-way door (the stored key format)

## Context

Three kinds of data must survive restarts and — because the extension is disabled
on every screen lock (ADR-0005) — every lock: the owner's settings (R-15), their
overrides and travel times (R-6, R-11), and per-occurrence alert state (acknowledged,
skipped, snoozed, heads-up already shown). Settings must be editable from
`prefs.js`, which runs in another process.

## Options

1. **GSettings for settings; a JSON file under the user state directory for
   overrides, travel and alert state.** Forever cost: our own file format, atomic
   replace, async I/O in the shell, corruption handling, and a second place to back
   up and to reset.
2. **Everything in GSettings.** Settings as typed keys; overrides and travel as
   `a{ss}` / `a{si}` dictionaries; alert state as one JSON string key. Forever
   cost: a schema that must stay compatible, and a JSON blob inside dconf.

## Decision

Option 2. **The deciding reason: one store with atomic writes, change
notification, and cross-process access already exists; a second store would add
parts and failure modes for no gain** at this data size (tens of entries). Key
format, fixed here because stored values depend on it:

- series: `series:<uid>`
- occurrence: `occ:<uid>|<recurrence-id or start, epoch ms>`
- place: location trimmed, whitespace collapsed, lowercased

Details, types and defaults are in `data.md`.

## Consequences

- Easier: `dconf dump /org/gnome/shell/extensions/payattention/` shows and backs up
  everything; prefs sees changes live; a reset is `dconf reset -f`.
- Harder: renaming or retyping a key loses the owner's values unless migrated, so
  schema changes need an ADR (`interfaces.md` §5).
- A moved single (non-recurring) meeting gets a new occurrence key: its overrides and
  acknowledgement no longer apply and it is judged afresh. Accepted: it errs toward
  warning.
- Occurrence entries are pruned after 7 days; series and place entries are kept.

## Revisit when

Alert state grows past what one dconf key should hold (more than about 64 KiB),
or overrides need to sync across machines.
