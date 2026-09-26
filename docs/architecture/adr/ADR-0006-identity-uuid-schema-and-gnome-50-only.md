# ADR-0006 — Identity: UUID `payattention@tonymalandain.github.io`, schema `org.gnome.shell.extensions.payattention`, GNOME 50 only
- **Date:** 2026-09-26
- **Kind:** one-way door (UUID and schema path are where installed copies and stored settings live)

## Context

The UUID names the install directory and the extension to the shell; the schema
id and path name where every stored value lives (ADR-0003). Changing either later
orphans existing installs and settings. The review rules require the form
`id@namespace`, no `gnome.org` namespace, and a schema under
`org.gnome.shell.extensions`.

## Options

1. `payattention@tonymalandain.github.io` — the author's own domain (from the git identity),
   so the namespace is one they control.
2. `payattention@<personal handle>.github.io` — conventional for hobby extensions,
   but no such handle is known for this project.

## Decision

Option 1. **The deciding reason: the author controls `tonymalandain.github.io`, so the
namespace cannot collide with anyone else's.**

- UUID: `payattention@tonymalandain.github.io`
- Install directory: `~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io/`
- Schema id: `org.gnome.shell.extensions.payattention`
- Schema path: `/org/gnome/shell/extensions/payattention/`
- `metadata.json`: `"shell-version": ["50"]`, no `session-modes` key (ADR-0005),
  `"settings-schema": "org.gnome.shell.extensions.payattention"`.

Supporting only GNOME 50 follows the PRD's out-of-scope list.

## Consequences

- Each new GNOME release needs a compatibility check and a `shell-version` bump
  (accepted in product decision D-002).
- Renaming the extension later means a new UUID and a settings migration.

## Revisit when

The project is published under another owner or organisation.
