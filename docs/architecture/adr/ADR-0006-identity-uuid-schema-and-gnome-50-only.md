# ADR-0006 — Identity: UUID `payattention@tonymalandain.github.io`, schema `org.gnome.shell.extensions.payattention`, GNOME 50 only
- **Date:** 2026-09-26 (amended 2026-09-29, see "Amendment 2026-09-29" below)
- **Kind:** one-way door (UUID and schema path are where installed copies and stored settings live)
- **Status:** accepted; the original UUID choice (Option 1) is **superseded by the 2026-09-29 amendment**. The schema id, schema path and GNOME 50 rule stand unchanged.

## Context

The UUID names the install directory and the extension to the shell; the schema
id and path name where every stored value lives (ADR-0003). Changing either later
orphans existing installs and settings. The review rules require the form
`id@namespace`, no `gnome.org` namespace, and a schema under
`org.gnome.shell.extensions`.

## Options (as of 2026-09-26)

1. `payattention@<the author's work domain>` — the domain in the author's git
   identity, so the namespace is one they control. (The literal domain has
   been removed from the repository at the owner's request, D-034.)
2. `payattention@<personal handle>.github.io` — conventional for hobby extensions,
   but no such handle was known for this project at the time.

## Decision (2026-09-26) — SUPERSEDED in its UUID part

Option 1. The deciding reason then: the author controls the domain, so the
namespace cannot collide with anyone else's.

- UUID: `payattention@<work domain>` — **superseded, see the amendment.**
- Install directory: `~/.local/share/gnome-shell/extensions/<UUID>/`
- Schema id: `org.gnome.shell.extensions.payattention`
- Schema path: `/org/gnome/shell/extensions/payattention/`
- `metadata.json`: `"shell-version": ["50"]`, no `session-modes` key (ADR-0005),
  `"settings-schema": "org.gnome.shell.extensions.payattention"`.

Supporting only GNOME 50 follows the PRD's out-of-scope list.

## Amendment 2026-09-29 — the UUID becomes `payattention@tonymalandain.github.io`

**Why:** product decision D-034. The owner does not want their work domain in
the project; the old UUID read like a work email address. Option 2 is now
possible because the owner chose a personal handle (`tonymalandain`; that
it is the owner's own GitHub account is `assumed`, not checked). **The deciding reason: a namespace the owner controls personally,
with no employer in it.** A `github.io` namespace is the convention the GNOME
review accepts for personal extensions.

What changes and what does not:

| Item | Before | After |
|---|---|---|
| UUID | the work-domain UUID (superseded) | `payattention@tonymalandain.github.io` |
| Install directory | `…/extensions/<old UUID>/` | `~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io/` |
| Built zip | `dist/<old UUID>.shell-extension.zip` | `dist/payattention@tonymalandain.github.io.shell-extension.zip` |
| Schema id / path | `org.gnome.shell.extensions.payattention`, `/org/gnome/shell/extensions/payattention/` | unchanged |
| Keyring schema (ADR-0009) | `org.gnome.shell.extensions.payattention.EngineKey` | unchanged |

Because neither storage name contains the domain, **settings, overrides,
stored AI answers and AI engine keys carry over with no migration.** The
extension code never names its own UUID (it reads its path from the shell), so
the change is confined to `metadata.json`, the scripts, the tests and the docs.

**The one-time switch-over for an existing install** is a binding rule for
`scripts/install.sh` and `scripts/uninstall.sh`, stated in
`testing-and-build.md`, "Switching an existing install to the new UUID". In
short: a former copy is recognised by its settings schema, never by its name;
the enabled list swaps old for new in one write; the running shell, never the
script, deletes a copy it has loaded.

**No literal of the old UUID may appear anywhere in the repository** (owner's
requirement with D-034). That is why former copies are found by schema.

## Consequences

- Each new GNOME release needs a compatibility check and a `shell-version` bump
  (accepted in product decision D-002).
- Renaming the extension later means a new UUID. Since 2026-09-29 the
  switch-over rule makes that cheap as long as the schema id is kept: any
  installed `payattention@*` copy declaring our schema is treated as a former
  identity.
- The switch-over stops alerts from the moment `install.sh` runs until the
  owner logs out and back in (the running shell disables the old copy; on
  Wayland it cannot load the new one). Accepted as a one-time cost of D-034.

## Revisit when

The project is published under another owner or organisation.
