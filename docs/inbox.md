# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-26 — for-architecture — senior engineer (PG-1a plan)

1. **In-person default offsets in `data.md` contradict D-008.** `data.md` has `inperson-insist-minutes` 0 and `inperson-takeover-minutes` 1. D-008 sets insist 2 and takeover 0 (leave-by). Core's `DEFAULT_SETTINGS` follows D-008 (10/5/2/0), and the PG-1c schema must use the same numbers. `data.md`, and the ordering remark in `overview.md`, need updating. Core still clamps offsets so they can never be out of order.
2. **There is no settings key for extra owner addresses.** PRD §6 and D-009 name "extra owner addresses", but `data.md` has no key for them. Core reads `extraOwnerAddresses` (a string array). Suggested key: `extra-owner-addresses`, type `as`, default `[]`.
3. **`node --test tests/unit/` fails on Node 24.11.** Node treats a directory argument as a file, and the run fails with "test failed". The `npm test` script uses `node --test "tests/unit/**/*.test.js"` instead. `testing-and-build.md` should record this form.
4. **gjs 1.88 has no global `URL`** (`ReferenceError: URL is not defined`, and no `structuredClone` either). Core runs under gjs as well as Node, so core parses link hosts by hand, and a gjs test run guards against Node-only APIs. This constraint is worth adding to `constraints.md`.
5. **Guest counting is wider than the NOTES entry "Guests exclude rooms and resources".** Following PRD §1 ("people other than the owner") and D-011, core counts the organiser and CUTYPE `group` attendees as guests. It does not count rooms or resources. Counting more guests errs toward warning.
6. **Internal reshapes of `interfaces.md` §2 and §3, no stored-format change:**
   - "Heads-up shown" is signalled by the Plan (`primary.recordHeadsUpShown`), so it is never recorded while the owner is idle. The controller dispatches it.
   - The snooze action carries the end time that `plan` computed (`actionFor(card, 'snooze')`), so the `alert-state` shape in `data.md` is unchanged.
   - The conferencing allowlist is a constant in core, not part of `config`.

### 2026-09-26 — In-person step defaults in data.md contradict D-008 — for-architecture
- **From:** senior engineer, plan `docs/plans/PG-1c.md`.
- **Finding:** `data.md` gives `inperson-insist-minutes` = 0 and `inperson-takeover-minutes` = 1 (and the NOTES "ordering finding" still describes the old PRD order). Product decision D-008 sets the in-person steps at 10 / 5 / 2 / 0 minutes before leave-by.
- **What the plan does:** the schema follows D-008: insist 2, takeover 0. PRD/decisions win on behaviour.
- **Asked:** update the `data.md` table and close the NOTES ordering question.

### 2026-09-26 — Schema key added: `extra-owner-addresses` — for-architecture
- **From:** senior engineer, PG-1c plan.
- **Finding:** PRD §6 and D-009 require "extra owner addresses" in settings, but `data.md` has no key for them.
- **What the plan does:** adds `extra-owner-addresses` (`as`, default `[]`). This is additive, which `interfaces.md` §5 allows. The plan also gives every integer key a range, which `data.md` left open (for example step offsets 0–120, travel 0–240, heads-up display 5–120 s, large meeting 2–500).
- **Asked:** record the key and the ranges in `data.md`.

### 2026-09-26 — Controller ↔ UI contract reshaped (internal) — for-architecture
- **From:** senior engineer, PG-1c plan.
- **Finding:** three changes to `interfaces.md` §3, which is marked internal:
  - The UI reports every action through one `dispatch(action)` instead of eight callbacks.
  - `headsUpShown` is recorded by the controller on the tick where the step-1 card is visible and the owner is active, not reported by the UI. This is level-triggered, and it removes an edge from the UI.
  - The UI receives a resolved display model (`View`, built by the pure `shell/view.js`) instead of a raw Plan plus judged occurrences, so "what to show" (travel only at steps 1–2, Join only with a link, never "no meetings" while stale) stays out of `ui/`.
- **Also:**
  - Formatting helpers are a new pure module, `core/display.js`, used by `shell/view.js` and `prefs.js`.
  - The controller takes its GNOME parts as injected factories, so `controller.js`, `view.js` and three small helpers have no `gi://` imports and are unit-tested under Node in `tests/unit/` (`boundaries.md` describes `tests/unit/` as core-only).
- **Asked:** update §3 and the tests note in `boundaries.md` if you agree.

### 2026-09-26 — What counts as "fresh" calendar data (D-010) — for-architecture
- **From:** senior engineer, PG-1c plan.
- **Finding:** `constraints.md` says "no good snapshot for 15 min → stale" but does not define "good".
- **What the plan does:**
  - A valid snapshot is fresh when it lists no sources or at least one source with `ok: true`.
  - A snapshot where every source failed does not replace the previous one and does not reset the stale clock.
  - Freshness is in memory, so after a lock/unlock (`disable`/`enable`) the 15-minute clock starts again from `enable()`. Data that was already stale before the lock shows the warning 15 min after unlock, not at once.
- **Asked:** confirm, or decide to persist the last-good time in GSettings.

### 2026-09-26 — Validation and install mechanics added by PG-1c — for-architecture
- **From:** senior engineer, PG-1c plan.
- **Finding:** additions to `testing-and-build.md`:
  - `npm run smoke` also runs a GJS store check (`GSETTINGS_BACKEND=memory`) before the headless shell. The shell run sets Do Not Disturb (`show-banners=false`), clicks the acknowledge button on the second monitor with a virtual pointer, checks that Escape does nothing, and runs disable-during-takeover and re-enable (the lock path).
  - The install npm script is `install:local`, because a script named `install` would run on `npm install`/`npm ci`.
  - `scripts/install.sh` adds the UUID to `org.gnome.shell enabled-extensions` so it loads at next login.
  - Verified: `gnome-extensions install` from the home filesystem to `~/.local/share` works with the default `TMPDIR`. The cross-filesystem pitfall applies only to targets on another filesystem.
  - Verified in headless 50.4: at startup the overview is open and holds one modal entry, so the smoke checks "no modal entry of ours" rather than an absolute `Main.modalCount`.
- **Asked:** fold these into `testing-and-build.md` if you agree.
