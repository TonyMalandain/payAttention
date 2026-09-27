# ADR-0011 — Ports and adapters: the verdict logic is platform-free, and every GNOME part is an adapter behind a named port
- **Date:** 2026-09-27
- **Kind:** reversible (a principle and a directory rule; no stored format or public contract changes)

## Context

The owner, verbatim (product NOTES, 2026-09-27): "intuitively, the
gnome-extension should be a shell and the core capabilities should be reusable.
Same with access to the calendar information. That the gnome-specific parts
should be well encapsulated into a contained component that can later be
changed for something else, like an O365 one, or a Google one, etc. There's no
reason for the core logic to be dependent on gnome."

Scope is unchanged: the product is GNOME only (`solution.md` "What the solution
is not"; product decision 2026-09-27 "Scope unchanged: GNOME only"). This ADR
is about the shape of the code, not about shipping anywhere else.

What forces a decision now: the verdict preview (R-20, D-032, PG-8) is the
first **second front end**. It must reuse the judgment and the calendar access
"not a copy". The review below found that the rules are already GNOME-free, but
the *composition* that turns inputs into verdicts is private to the alert
controller, so a second front end could not reuse it without copying.

Conformance review, 2026-09-27 (code read at commit `8cc50e5`):

- `extension/core/` — 22 files, no `gi://`, no `resource://`, lint-enforced
  (ADR-0002). Conforms.
- Calendar access is a separate process behind the snapshot protocol
  (`interfaces.md` §1), chosen by one argv in the composition root
  (`extension/extension.js:22-26`). Conforms. The protocol is iCalendar-shaped,
  not EDS-shaped; see "Calendar source neutrality" below.
- AI engine access is a separate process behind the AI protocol (§6.6).
  Conforms.
- **Leak 1 (blocks PG-8).** The verdict pipeline — read inputs, give the AI
  queue its engine, pump it, judge twice with withheld answers — lives inside
  the alert `Controller` (`extension/shell/controller.js:217-272, 376-383`
  as of this ADR; `extension/app/controller.js` since PG-8a).
  The only way to reuse it is to construct the whole controller, whose
  constructor writes (`_prune` at `controller.js:117` → `writeAlertState`,
  `pruneOccurrenceOverrides`, lines 268-274) and starts the alert ticker.
- **Leak 2 (blocks PG-8).** The store port is one read-write interface
  (`controller.js:21-37`). A front end that must never write cannot be handed
  "read only" structurally.
- **Leak 3 (does not block).** `extension/shell/` mixes gi-free application
  modules (`controller.js`, `aiQueue.js`, `aiBudget.js`, `health.js`,
  `backoff.js`, `view.js`, `soundCue.js`) with GNOME adapters (`store.js`,
  `calendarFeed.js`, `helperProcess.js`, `aiHelperClient.js`, `ticker.js`,
  `launcher.js`, `environment.js`). The gi-free rule for the first group is a
  test convention (`boundaries.md` "Node-tested shell modules"), not a lint
  rule, and the directory is named and linted as the Shell layer.
- **Leak 4 (does not block).** The key-store adapter is in three places:
  read in `extension/ai/keyring.js:16`, write in `extension/prefs.js:63`,
  clear in `scripts/uninstall.sh`; the libsecret schema name is a constant in
  `extension/core/aiEngine.js:12`. No logic depends on it; swapping the key
  store means touching three files.
- **Minor, accepted.** `core/protocol.js` holds `HELPER_ENV_UNSET`
  (`G_MESSAGES_DEBUG`, a GLib variable name) so every spawner agrees
  (`interfaces.md` §1 "Environment"). A constant, not a dependency.

### Calendar source neutrality

Could an Office 365 (Microsoft Graph) or Google Calendar reader produce the
snapshot? Yes, as a separate reader program. Both services give an iCalendar
UID (`iCalUId` / `iCalUID`), expanded instances with their original start
(the `recurrenceId`), start and end in UTC, all-day, subject, location, body,
status, free/busy (`showAs` / `transparency`), organiser, attendees with a
response and a required/optional/resource type, and an online-meeting URL.
Each maps onto the Occurrence DTO's iCalendar vocabulary. The three fields
that carry EDS-derived names are defined here by meaning, so another reader
knows what to put in them, with no protocol change:

- `sources[].backend` — a free diagnostic label of the source kind
  (`"caldav"`, `"graph"`, …). Core validates it as a string and never reads it.
- `sources[].remote` — the calendar lives at a provider and can be synced
  (EDS: refresh supported). A Graph or Google calendar is `true`.
- `sources[].connection` — the reader's link to the provider, in the listed
  vocabulary. `awaiting-credentials` = the provider needs the owner to sign in
  again; `ssl-failed` = the secure connection was refused; the rest are plain.

What would *not* carry over is the product rule "every calendar the clock menu
shows" (R-2): that is the EDS reader's job and stays in it, correctly.

## Options

1. **Ports and adapters, inside the existing pack root.** Name each port,
   keep each adapter in one place, move the gi-free application modules out of
   `shell/` into a new `extension/app/` directory linted like `core/`, and pull
   the verdict pipeline out of the alert controller into one reusable
   component. Forever cost: one more directory and lint block; the
   application layer's contracts (`interfaces.md` §3) become ones two front ends
   depend on, so they change with more care.
2. **Full re-layout: platform-free code outside `extension/`.** `core/` and
   `app/` at the repository root, the GNOME extension as one front end
   assembled by the build. Forever cost: the build must copy shared code into
   the pack and every relative import must resolve both in the tree and in the
   zip; tests, lint and every document's paths change. It buys nothing today,
   because every front end we have (the extension, prefs, the preview) runs
   from the installed GNOME pack.
3. **Leave the layout; add lint allowlists only.** Cheapest now; the principle
   stays implicit, the verdict pipeline stays private, and the preview copies
   the composition. Fails the owner's "no copy".

## Decision

Option 1. **The deciding reason: it removes the two leaks that would force a
copy (the private verdict pipeline and the write-only-or-nothing store), and
makes "no GNOME in the logic" a lint failure rather than a convention, without
moving code that has no second home to move to.**

The principle, as it binds from today:

- **Three rings.** `core/` (rules, pure, no I/O, no clock). `app/` (application
  orchestration: pure JavaScript, no `gi://`, no `resource://`, no Node
  built-ins; may import `core/`; every outside part injected). Adapters
  (everything that touches gjs, GLib, GNOME or the network). Dependencies point
  inward only: adapters may import `app/` and `core/`; `app/` and `core/` never
  import an adapter.
- **Front ends are compositions.** A front end (the extension, the preview)
  picks adapters and wires them to `app/`. It holds no judgment.
- **One verdict pipeline.** Only the verdict component in `app/` calls
  `core/judge.js`. A front end that shows verdicts gets them from that
  component. This is what makes "same judgment, not a copy" true by
  construction.
- **Out-of-process where the platform is heavy.** Calendar and AI engine
  access stay separate programs behind versioned NDJSON protocols. Replacing
  the calendar source means a new reader program and one argv.

The ports, and where each adapter lives (current state; `app/` after the
split):

| Port | Contract | Adapter today | Where |
|---|---|---|---|
| Calendar source | Snapshot protocol v1, a process over stdio (`interfaces.md` §1) | EDS reader (gjs process); supervised by the calendar feed | `extension/helper/`; client `extension/shell/calendarFeed.js` + `helperProcess.js`; chosen in `extension/extension.js` |
| Settings and overrides store | Reader facet (settings, overrides, travel, stored AI answers, change signal) and writer facet (alert state, AI answers, health clocks, overrides, travel, prune). Value formats are core's (ADR-0003 keys; alert-state and ai-verdicts JSON in `core/`) | GSettings / dconf | `extension/shell/store.js`, `settingsKeys.js`; `prefs.js` edits the same schema |
| Key store | "The AI engine adapter looks up its own key by normalised endpoint"; the key never crosses a protocol (ADR-0009) | libsecret / Secret Service (gnome-keyring) | read `extension/ai/keyring.js`, write `extension/prefs.js`, clear `scripts/uninstall.sh` |
| AI engine | AI helper protocol v1 (`interfaces.md` §6.6) | gjs process, libsoup, OpenAI-compatible HTTP | `extension/ai/`; client `extension/shell/aiHelperClient.js` |
| Clock | `now: () => number`, injected | `Date.now` | the composition root |
| Ticker | `createTicker(onTick) → {destroy}` | `GLib.timeout_add` | `extension/shell/ticker.js` |
| Environment (idle, resume) | `{isUserActive(), destroy()}` + `onResume` | Shell idle monitor, logind through the Shell's LoginManager — **Shell process only** | `extension/shell/environment.js` |
| UI sink | `render(View)`, `playAlertSound()`, `releaseTakeover()`, `dispatch(UiAction)` back | St/Clutter actors and the modal grab — **Shell process only** | `extension/ui/` |
| Link launcher | `launchUri(uri, onDone)` | `Gio.AppInfo` with the Shell's launch context — **Shell process only** | `extension/shell/launcher.js` |

`prefs.js` is not a port: it is a second GNOME front end, a settings editor
over the store's schema.

## Consequences

- **Easier.** A second front end (the preview, PG-8) reuses the verdict
  pipeline by composition. A new calendar source is a new reader program. A
  breach of "no GNOME in the logic" fails lint in `app/` as it already does in
  `core/`.
- **Harder.** The verdict component's contract has two callers, so the alert
  controller can no longer reshape it alone. Moving seven files out of
  `shell/` touches imports, tests, lint and `--extra-source` once.
- **Accepted, not repaid.** The key-store adapter stays in three places (Leak
  4). Repaying it needs a shared gjs module that both `ai/` and `prefs.js` may
  import, the same boundary change as the known `stdio.js` duplicate
  (`boundaries.md`); nothing wants it until a second key store exists.
- **We can no longer** add judgment to a front end, or call `judge` from
  anywhere but the verdict component, without an ADR.
- **What this does not do.** It does not make the product run elsewhere. The
  Shell-only adapters (environment, UI, launcher) have no second
  implementation, and none is designed. A non-GNOME front end would need its
  own; that is a product decision first.

## Revisit when

- A front end or calendar source must ship **outside** the GNOME extension zip
  (for example a standalone tool or another desktop): then option 2, the
  re-layout, starts paying for itself.
- A second calendar reader is actually built. A network-backed reader (Graph,
  Google) would break "network and secrets are the AI helper's only"
  (`boundaries.md`, ADR-0009), which needs its own ADR before any code.
- A second key store is needed (another desktop, or a platform keychain): then
  repay Leak 4.
