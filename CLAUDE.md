# payAttention

A GNOME Shell extension that makes sure you do not miss the meetings that matter.

## Where things live

Resolved by the product-manager agent on 2026-09-26. Correct anything wrong here —
the agents read this before they read anything else.

| What it holds | Where it is |
|---|---|
| product mode, index of product docs | `docs/product/00-index.md` |
| the problem, in prose | `docs/product/problem.md` |
| the solution and its requirements | `docs/product/solution.md` |
| user profiles | `docs/product/users.md` |
| closed product decisions and their reasons | `docs/product/decisions.md` |
| terms in user language | `docs/product/glossary.md` |
| the product working log | `docs/product/NOTES.md` |
| feature specs (PRDs) | `docs/prd/` |
| delivery status / the backlog | `BACKLOG.md` |
| architecture: index of architecture docs | `docs/architecture/00-index.md` (owned by the architect) |
| architecture: system overview, time/escalation model, UI layer, product term → code name | `docs/architecture/overview.md` |
| architecture: repo layout, module boundaries, import rules | `docs/architecture/boundaries.md` |
| architecture: contracts (helper protocol, core/controller/UI) | `docs/architecture/interfaces.md` |
| architecture: stored data, GSettings schema, key formats | `docs/architecture/data.md` |
| architecture: constraints, numbers, GNOME review rules | `docs/architecture/constraints.md` |
| architecture: tech stack and why | `docs/architecture/stack.md` |
| architecture decision records (ADRs) | `docs/architecture/adr/ADR-NNNN-<slug>.md` |
| architect working log | `docs/architecture/NOTES.md` |
| extension UUID / install dir | `payattention@tonymalandain.github.io` → `~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io/` |
| extension source (what ships) | `extension/` (`core/` pure logic, `helper/` calendar subprocess, `app/` GNOME-free orchestration, `shell/` in-shell GNOME adapters, `ai/` AI subprocess, `ui/` actors) |
| the plan for a task, before it is built | `docs/plans/<ticket>.md` (owned by the senior engineer) |
| findings waiting for product or architecture | `docs/inbox.md`, entries tagged `for-product` / `for-architecture` |
| how to run tests, lint, and build | `docs/architecture/testing-and-build.md` — in order: `npm run lint`, `npm test`, `npm run build`, `npm run test:helper`, `npm run smoke` (scripts created by the engineers to that contract) |
| user guide (install, first use, how it decides) | `README.md` |
| screenshots of the alert steps | `docs/screenshots/` |
| build timing for this experiment | `TIMELINE.md` |
