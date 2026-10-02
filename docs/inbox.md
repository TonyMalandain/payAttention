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
