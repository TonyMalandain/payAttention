# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — lint bypass via `./../` (PG-8c review)
- Every lint pattern anchored on `^\.\./` can be sidestepped by writing `./../` (for example `import {StoreWriter} from './../shell/store.js'` in `preview/main.js`). The fix round closes it in `eslint.config.js`. Please record the rule, that patterns must match normalised paths, in boundaries.md.

## 2026-09-27 — for-architecture — a `..` inside the path still sidesteps the lint patterns (PG-8c fix round)
- The fix round made every relative pattern accept any `./` before or after the leading `..` (`./../`, `.././`, `././`). A specifier that climbs back mid-path is still not normalised: `import {StoreWriter} from '../core/../shell/store.js'` in `preview/main.js` passes lint. Closing it needs a rule choice (for example, refuse any relative specifier with a `.` or `..` segment after the first), which is yours. If nobody acts, the boundary rules remain bypassable by a deliberate import.

## 2026-09-27 — for-product — the Model field does not follow an outside change (PG-4f)
- PG-4f made the Address field follow a change of `ai-endpoint` made outside the Settings window. The Model field still keeps its old text when `ai-model` changes outside the window, which greys out Test connection and the key row until the owner retypes it. Not in the ticket, so left as is.

## 2026-10-01 — for-architecture — testing-and-build.md step 4 says the build "can also" make the developer bundle (PG-13)
- Since PG-13, `scripts/build.sh` always makes both bundles, with no option (plan seam 6), and packs from a `DIRS` array instead of the one-line `gnome-extensions pack …` command the table still quotes. The row reads as if the developer bundle were optional. The PG-13 plan reserves `testing-and-build.md` to its owner, so it was not edited. If nobody acts, a reader may look for a flag that does not exist.

## 2026-10-02 — for-architecture: PG-14 doc follow-ups
- `testing-and-build.md` says the sample has one fixture meeting; after PG-14 it has two, and the smoke fixture has three all-day events.
- `interfaces.md` §2 lists the video-call vocabulary with "…"; the exact list is fixed in `docs/plans/PG-14.md` (no bare `microsoft`, `google`, `slack`, `goto`).
- A location with no letters or digits (for example "+") now reads as no place.

## 2026-10-02 — for-architecture — a 200 ms invite budget test fails under a loaded full run (seen during PG-14)
- `tests/unit/invite.test.js` "buildInvite: no catastrophic backtracking on 1 000 000 characters" › "digits split by spaces: under 200 ms" failed in 2 of 5 full `npm test` runs on the author's machine (228 ms before any PG-14 change, 285 ms after); it passes when run alone and in the other full runs. Its input is in the description only, so PG-14's place-text rule does not touch it. The budget or the way it is measured (single wall-clock run while the other test files run in parallel) is a `testing-and-build.md` decision, so it was not changed. If nobody acts, `npm test` fails at random and people learn to rerun it.

## 2026-10-02 — for-architecture: PG-15 notes
- Which meeting row is open in the menu is GNOME widget state in `ui/`, like whether the menu is open; unlike the card's travel choices, the controller does not hold it. Consider one line in `interfaces.md` §3 or `overview.md` "UI layer" so nobody moves it into the controller by analogy.
- The PG-15 plan has the engineer update the smoke list in `testing-and-build.md` (item 2 "the menu closed" becomes wrong; new `6e-menu-rows`), as in PG-11 Part C. Please check the wording afterwards.

## 2026-10-04 — for-architecture: PG-16 estimated travel time, design under discussion with the owner
- The owner will discuss the design live with the architect in a separate session. Not yet approved.
- Product record (closed decisions): `docs/product/decisions.md` D-041 to D-049; `docs/product/solution.md` R-3, R-11, R-21, R-22 and "What the solution is not"; spec: `docs/prd/meeting-guardian.md` "Addendum 2026-10-04 — Estimated travel time"; tickets PG-16, PG-17, PG-18 in `BACKLOG.md`.
- Owner's design feedback so far, verbatim:
  - "key storage should be abstracted, so that their is no direct dependency between core software and Gnome."
  - "Don't plan any upgrade scenario for the AI API key. Expect users to re-enter it manually."
  - "Why a program? Why not a component?" … "don't understand why it would run as an independent program. Makes no sense. Don't we already have independent programs decoupled from the UI? then that component should be called from those independent programs."
  - "Estimates need to be computed multiple times: When the appointment is detected, so we can set a rough reminder time. And when the reminder time sets off, so we can get proper estimate based on live traffic."
  - "If the API gives you the same time range, then take the upper bound + 30mins."
  - "where is the initial estimate saved?"
  - "I need to know components and classes involved. For instance: Component X: Reponsible for: / Dependents on: / Used by:"
  - "the gnome extension is supposed to be a wrapper around the core logic … Does this design honor that?"
  - "how would that change the existing folder structure in the repo?"
- Open with the owner: approval of the design; whether to keep the `ai/` → `net/` rename; whether the live estimate runs at the heads-up or 15 minutes before it (product recommends 15 minutes before; D-047 records "at the heads-up" until the owner changes it); acceptance of extra Google requests after each screen unlock.
