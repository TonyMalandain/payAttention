# PG-20 — Migration from today's code to the resulting design

- **Status:** proposed — awaiting owner approval. No slice may be planned or
  built until the owner approves `proposal.md`.
- **Date:** 2026-10-10
- **Built from:** `master` at `edbc7a0`.

## Rules every slice keeps

- **The product never stops working.** Each slice ends with the full
  validation sequence green (`npm run lint`, `npm test`, `npm run build`,
  `npm run test:helper`, `npm run smoke`; `testing-and-build.md`) and an
  installable zip that behaves exactly as before.
- **No behaviour change the owner can see.** Same alerts, same menu, same
  Settings window, same preview command and output, same stored settings and
  keyring items. A slice that would change any of these is out of PG-20.
- **One concept per slice.** A slice moves code *or* adds a port *or* moves a
  rule, never two of those at once, so a review can tell a move from a change.
- **What each slice means is fixed here; how it is built is the senior
  engineer's plan.** The slices below state the result and the constraint,
  not the steps.
- **Sizes** use the house scale: S = one focused change, one module; M =
  several modules, no new concept, no contract change; L = a new concept, new
  data, a contract change or a migration.
- **Order is a technical dependency only** ("needs first"). It says what must
  exist before a slice can be built, never when anything should be done.

## The slices

| # | Slice | Result when done | Size, and why | Needs first |
|---|---|---|---|---|
| 1 | **Lint checks resolved import paths** | Every boundary rule in `eslint.config.js` matches the import's path after it is resolved against the importing file, so `./../`, `../core/../shell/` and any other spelling cannot sidestep a rule. Closes the two `for-architecture` lint findings in `docs/inbox.md` (2026-09-27) and the lint item of BACKLOG PG-9. | **S** — one module (the lint configuration or one small local rule); no product code. | nothing |
| 2 | **Regroup the GNOME parts under `gnome/`** *(owner question 1; skipped if the owner chooses "later")* | `shell/` → `gnome/shell/`, `ui/` → `gnome/ui/`, `helper/` → `gnome/calendar/`, `ai/` → `gnome/net/`; imports, lint blocks, `scripts/build.sh` `DIRS` (`core app gnome preview`), the zip check, tests, smoke and sample scripts, and the documents follow. `extension.js`, `prefs.js`, `metadata.json`, `schemas/`, `stylesheet.css` and `preview/` stay at the root (GNOME and ADR-0012 fix their paths). No file's contents change except import paths and argv strings. | **M** — about thirty files move across several modules, but no new concept and no contract change; the preview command and every stored name stay. | 1 (boundaries must not loosen while paths change) |
| 3 | **One GNOME platform module and the Platform contract** | `app/platform.js` declares, as types only, the verdict-side and alert-side ports a pack supplies. `gnome/platform.js` builds the verdict side (store reader, calendar feed, network client, AI ticker, clock); `gnome/alertPlatform.js` builds the alert side (store writer, environment, UI, ticker, launcher). `extension.js` and `preview/main.js` compose from them; the program paths are named once. Lint lets `preview/` import `gnome/platform.js` but not `gnome/alertPlatform.js` or `StoreWriter`, so the preview stays read-only by construction (ADR-0012). One unit test proves a `View` and every `UiAction` survive a JSON round trip unchanged. | **M** — four modules change (two entry files, two new platform modules) plus one typedef file; no new behaviour and no contract change. | 2 (or today's folders, if 2 is skipped) |
| 4 | **Settings ranges move into `core/`** | `core/settings.js` declares each owner setting's field, default, kind and valid range (absorbing `core/defaults.js`); a unit test fails if the GSettings schema's defaults or `<range>`s differ from it, as the defaults test does today. The store and the Settings window keep reading the schema, which is now proven equal. | **S** — one core module and one test; no runtime path changes. | nothing |
| 5 | **The spawn environment rule leaves `core/`** | `HELPER_ENV_UNSET` (`G_MESSAGES_DEBUG`) moves from `core/protocol.js:16` to `gnome/common/spawnEnv.js`, imported by the calendar feed's and the network client's spawner and by the Settings window's Test connection. The rule (`interfaces.md` §1 "Environment") is unchanged. | **S** — one constant, three importers, one test moved. | 2 (for the folder name; otherwise `shell/`-side) |
| 6 | **Key-store port with one libsecret adapter** | `core/keyStore.js` declares `KeyStorePort` and the purpose `ai-engine`. `gnome/keystore/libsecretKeyStore.js` is the only code that imports `gi://Secret`; it **keeps today's stored format** (schema `org.gnome.shell.extensions.payattention.EngineKey`, attribute `endpoint`), so the owner's saved key is still found. `ai/keyring.js` and the copy in `prefs.js` go; the network program and the Settings window take the adapter; the schema name leaves `core/aiEngine.js`; `scripts/uninstall.sh` keeps its one repeat of the name, and the uninstall check now seeds items with the adapter's constant. Repays ADR-0011 Leak 4. | **M** — four modules (new adapter, network program, Settings window, uninstall check) and a lint rule; a new port, but no new stored data and no contract change visible outside the pack. Would be **L** if it changed the stored format, which is why it does not. | 2 (for the folder name) |
| 7 | **Network services become platform-free by rule** | `ai/service.js` → `app/services/aiService.js`; `ai/chat.js` → `core/providers/openaiChat.js`; lint holds both to the kernel's rules (no `gi://`, `resource://`, `system`, Node built-ins) and keeps the AI program's allowlist promise ("checks invites, never builds them"): services may import `core/aiProtocol.js`, `core/aiPrompt.js`, `core/aiEngine.js`, `core/providers/`, `core/keyStore.js`, nothing else of `core/`. `gnome/net/main.js` keeps stdin/stdout, the Soup transport and the key-store adapter. Behaviour and the AI protocol are unchanged. | **S** — two files move, one lint block; no behaviour change. | 2; 6 (the service takes the key store through its port) |

Record work that rides with the slices, not slices of its own: on approval
the draft ADR is numbered; the port contracts in `interfaces.md` and ADR-0011's
port table are reworded so none names a process (`proposal.md` P7); each
slice updates `boundaries.md` and `testing-and-build.md` for what it moved.

## Dependency picture

```
1 ──► 2 ──► 3
      │
      ├──► 5
      ├──► 6 ──► 7
4 (independent)
```

If the owner chooses "later" for the regroup, slice 2 drops out and 3, 5, 6, 7
land in today's folders (`shell/` for the platform module and spawn rule,
`keystore/` at the pack root for the adapter, `ai/` for the network program).

## What each slice leaves for the product

| After slice | The owner notices | The engineers notice |
|---|---|---|
| 1 | nothing | a boundary can no longer be sidestepped by a path spelling |
| 2 | nothing (the preview command is unchanged) | the tree says which folders are GNOME |
| 3 | nothing | one place names the programs and builds the adapters |
| 4 | nothing | a setting's valid range is a core fact, checked against the schema |
| 5 | nothing | `core/` names no GLib variable |
| 6 | nothing (the saved AI key is still found) | one password-store adapter; `core/` names no keyring schema |
| 7 | nothing | the AI request and reply code can be reused by any host |

## What is deliberately not in the migration

Each of these is designed in `resulting-design.md` §8 and waits for its
trigger. Building any of them now would make the GNOME product pay for a
platform that may never exist (owner, PG-20).

- A remote UI protocol, an agent process, a web API, a server.
- Direct Google or Microsoft 365 calendar readers, OAuth, a merge of several
  calendar sources.
- Time zone and locale as an input; sleeping until the next plan change.
- Moving `core/` and `app/` out of the GNOME pack root (ADR-0011 option 2).
- Merging the two `stdio.js` near-copies (`boundaries.md` known duplicate):
  repayable in or after slice 2, needed by nothing here.

## How the open tickets meet the slices

| Ticket | Relation to the slices |
|---|---|
| PG-18, buffer | Independent. Can land before, between or after any slice. If it lands after slice 4 its setting goes into `core/settings.js`; before, into `core/defaults.js` and is carried along. It creates `core/travel.js` if PG-16 has not. |
| PG-19, own calendars and full name | Independent of the slices. Its snapshot field is additive to protocol v1; its setting follows slice 4's rule if slice 4 has landed. Its AI part needs the ADR-0010 amendment and the product confirmation in `proposal.md` §9. |
| PG-16 and PG-17, travel estimates (parked) | When unparked, they need slices 6 and 7 (the key-store port and the platform-free services), and slice 3 if `MapsClient` is to be composed in the platform module. PG-16's own K1 then shrinks to "add the `maps` purpose" and K2 to "add `MapsService`, the line router and `MapsClient`". |
| PG-5, project address | Independent; `metadata.json` only. |
| PG-9, Model field; lint bypass | The lint part is slice 1. The Model field is independent. |
