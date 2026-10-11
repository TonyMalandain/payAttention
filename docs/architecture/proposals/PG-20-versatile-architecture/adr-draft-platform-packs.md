# ADR-draft — A platform-neutral kernel with platform packs at the edge; process placement belongs to the pack

- **Status:** proposed — awaiting owner approval. Draft only: it is not in the
  decision log (`docs/architecture/adr/`) and binds no one. On approval it
  takes the next free ADR number at that time and moves into the log; until
  then ADR-0011 and ADR-0009 stand as written.
- **Date:** 2026-10-10
- **Kind:** reversible. It moves code and names ports; it changes no stored
  format, no protocol on the wire and no public contract (the preview command,
  the settings schema and the keyring format stay).
- **Extends:** ADR-0011 (ports and adapters). **Amends:** ADR-0009 (the key
  is reached through a port; its stored format is unchanged).
- **Serves:** D-049; the owner's PG-20 request (BACKLOG PG-20).

## Context

The owner asked for an architecture in which a KDE or web version needs only
a new UI and a repackaged platform integration, native mobile clients can sit
on a web API, every integration reaches the core by inversion of control, and
Google or Microsoft 365 calendars can be read — without any of these becoming
a product commitment, and without the GNOME product paying for them
(BACKLOG PG-20, product NOTES 2026-10-10).

ADR-0011 already separated pure rules (`core/`), GNOME-free orchestration
(`app/`) and GNOME adapters. A review at `edbc7a0` (proposal P1 to P7) found
what still stands in the way: two GNOME storage and logging names inside
`core/` (`core/aiEngine.js:12-14`, `core/protocol.js:16`); a password store
with no port, built twice (`ai/keyring.js:16`, `prefs.js:63`); platform-free
network logic indistinguishable from the gjs program around it (`ai/service.js`,
`ai/chat.js`); the composition written out three times (`extension.js:25-40`,
`preview/main.js:96-104`, `prefs.js:211`); setting ranges enforced only by the
GSettings schema; a top-level folder tree that sorts by four rules at once; and
port contracts in the record that name a process.

ADR-0011's premise that "nothing ships outside the GNOME zip, so a re-layout
buys nothing" still holds for moving code *out of* the pack. What changed is
a stated quality: the owner now requires that a second platform replace one
identifiable set of parts. That is a requirement, not a guess (`judging.md`).

## Options

1. **Complete the kernel; make the GNOME pack one unit (in-process kernel per
   front end).** Move platform names out of `core/`; a key-store port with
   one libsecret adapter keeping today's stored format; network services into
   `app/services/` and provider wire formats into `core/providers/`,
   lint-enforced platform-free; one GNOME platform module (verdict side and
   alert side) and a `Platform` contract in `app/`; setting ranges in `core/`;
   GNOME adapters grouped under `gnome/`; ports reworded so none names a
   process. Forever cost: a deeper folder level; the `Platform` contract and
   the settings spec must be kept honest (a test keeps the schema equal to the
   spec). Cost to the GNOME product: none at run time; seven small slices.
2. **One local agent process; every front end a client.** Move the whole
   kernel into one long-lived gjs agent that also reads calendars and talks to
   the network; the Shell UI, Settings, preview and any future front end
   speak one versioned local session protocol. Forever cost: an always-on
   process, a versioned protocol and its supervisor; every alert crosses a
   process boundary each second; an agent fault stops all alerts; the modal
   grab is driven from outside the process that must release it; "nothing is
   sent in rules mode" stops being a process fact.

## Decision

Option 1. **The deciding reason: it gives a second platform one named set of
parts to replace while the GNOME alert loop keeps running inside the desktop
process from the last good snapshot, so no alert ever depends on another
process — option 2 would trade that reliability (D-013, R-16) for symmetry
with platforms that may never exist.**

Binding rules, from the day it is accepted:

- **Kernel.** `core/` and `app/` (including `app/services/` and
  `core/providers/`) are plain ES2022 with no host API: no `gi://`, no
  `resource://`, no `system`, no Node built-ins, no global time zone reads
  outside the three places recorded as debt. They name no platform: no
  storage schema, no environment variable, no program path.
- **Packs.** Every platform part belongs to exactly one pack. The GNOME pack
  is `gnome/` plus the entry files GNOME and ADR-0012 fix at the pack root
  (`extension.js`, `prefs.js`, `metadata.json`, `schemas/`, `stylesheet.css`,
  `preview/`). One GNOME platform module builds every adapter; the preview may
  use only its verdict side.
- **Inversion of control.** The kernel receives every integration by plain
  constructor injection, in a composition root. No container, no service
  locator, no registry, no module-level mutable state. The `Platform` contract
  in `app/platform.js` lists what a pack supplies; port types stay with their
  consumers.
- **Process placement belongs to the pack.** A port says what the kernel
  needs, never how it is delivered. The GNOME pack keeps today's processes and
  reasons: the desktop process (UI, alert loop, kernel), the calendar program
  (ADR-0001), the network program, only while a network service is on
  (ADR-0010; it hosts every outside service, AI today and maps with PG-16),
  the Settings window and the preview. A new process needs a stated reason and
  the reuse of an existing one ruled out.
- **Product rules live in the kernel.** Defaults and valid ranges of every
  setting are declared in `core/`; a platform store may repeat them, proven
  equal by a test.
- **Keys go through `KeyStorePort`.** One adapter per platform; the GNOME
  adapter is the only code importing `gi://Secret` and keeps the existing
  keyring format for the AI key.
- **Plain data at the UI boundary.** `View` and `UiAction` stay JSON-safe
  plain data, guarded by a test, so a remote UI can carry them unchanged.

## Consequences

- **Easier.** A KDE pack replaces `gnome/` and the root entry files and
  reuses the kernel unchanged. A server pack reuses the kernel, the provider
  formats and the services in-process. A Google or Microsoft 365 reader is a
  provider format plus one shared service implementing the existing calendar
  source port. PG-16 lands with no new process and two small tickets fewer.
  The password store has one owner.
- **Harder.** Import paths in the GNOME pack get one level deeper. The
  `Platform` contract is a second place to update when a port is added. Two
  lint blocks more (`app/services/`, `gnome/keystore/`).
- **We can no longer** put a platform name, a storage schema, a program path
  or a host API in `core/` or `app/`; give the preview anything from the alert
  side of the platform; add a process to the GNOME pack without a stated
  reason; or keep a setting's valid range only in a platform's store.
- **Not done, on purpose.** No remote UI protocol, agent, server, web API,
  direct calendar reader, OAuth, multi-source merge, time-zone input or
  next-change scheduling is built. Each is designed in the PG-20 proposal with
  the trigger that would build it.

## Revisit when

- A second pack is actually built: then move `core/` and `app/` out of the
  GNOME pack root to a shared root (ADR-0011 option 2), because two packs
  would otherwise both reach into `extension/`.
- A chosen platform's UI runtime cannot host ES modules (a Plasma widget may
  be one): that pack hosts the kernel in a local agent with a remote UI
  protocol (option 2's pattern, for that pack only).
- A server pack is chosen: time zone and locale become inputs, and the alert
  session sleeps until the plan next changes instead of ticking every second.
- A network-backed calendar reader is chosen: it needs its own ADR first
  (R-2, R-3; ADR-0011 "Revisit when").
