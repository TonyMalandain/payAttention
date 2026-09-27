# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — PG-4a build: text passcodes are removed after cleaning, not before (D-025)
- `interfaces.md` §6.2 says the D-025 passcode rule runs "before cleaning and capping". The build (`extension/core/invite.js`, `withoutPasscodes`) cuts conferencing queries, then cleans, then removes text passcodes, then caps. Running it on cleaned text also catches a value on the next line ("Passcode:\n123456") or one behind a control or bidi character, which the raw-text order would send. It still runs before the cap, so a cut cannot leave half a passcode (tested).
- If nobody acts: §6.2 and the code disagree on the order. The output only differs for those hidden-character cases, where the code is the safer of the two.

## 2026-09-27 — for-design — PG-4a build: three gaps in the plan, closed with the smallest safe choice
- **Upper-case video link scheme.** `isConferenceUrl` accepts `HTTPS://…`, but `validateInvite` requires the link to start with `https://`. Such an invite would be refused by the helper as `bad-request` on every ask. `invite.js` lowercases the scheme only (test: "an upper-case HTTPS scheme…"). Confirm, or choose null instead.
- **Owner address normalisation.** The plan exports nothing from `owner.js` for "normalised email", so `invite.js` has a private copy of `normaliseAddress` (a one-liner, commented). If they drift, the invite's email form and owner matching disagree. Consider exporting it.
- **`buildInvite` with a non-finite start** returns `start: 'NaN-…'`, which fails `validateInvite`. `judge` never calls it for such events (D-023), so this cannot happen today. It becomes reachable only if another caller (PG-4c or PG-4d) builds invites directly.

## 2026-09-27 — for-architecture — licence constraint out of date (from the PG-6/PG-7 planner)
- `docs/architecture/constraints.md:125` still says "Licence GPL-2.0-or-later compatible". Product decision D-026 chose Apache-2.0. Reconcile it. The GNOME review rule is noted as an accepted cost in D-026.
- No new sound playback path is needed: D-028 follows GNOME's "None".
