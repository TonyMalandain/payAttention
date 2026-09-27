# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — PG-8a/8b plan findings
- Several docs name the old `shell/` paths for the 7 modules moving to `app/`: the `boundaries.md` "Node-tested shell modules" note, `interfaces.md` §2, §3 and §6.5, `overview.md`, and in `testing-and-build.md` the build command and the `npm test` description. In `boundaries.md`, the `extension.js` row should list `app/`.
- The "must not import" columns for `ui/`, `helper/`, `ai/` and `prefs.js` should name `app/` (PG-8a enforces it in lint).
- ADR-0011's "only the verdict component calls `core/judge.js`" is not enforced by lint. After PG-8b only `app/verdicts.js` imports it, so a guard would be cheap. Your call.
