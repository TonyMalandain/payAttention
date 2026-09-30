# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — lint bypass via `./../` (PG-8c review)
- Every lint pattern anchored on `^\.\./` can be sidestepped by writing `./../` (for example `import {StoreWriter} from './../shell/store.js'` in `preview/main.js`). The fix round closes it in `eslint.config.js`. Please record the rule, that patterns must match normalised paths, in boundaries.md.

## 2026-09-27 — for-architecture — a `..` inside the path still sidesteps the lint patterns (PG-8c fix round)
- The fix round made every relative pattern accept any `./` before or after the leading `..` (`./../`, `.././`, `././`). A specifier that climbs back mid-path is still not normalised: `import {StoreWriter} from '../core/../shell/store.js'` in `preview/main.js` passes lint. Closing it needs a rule choice (for example, refuse any relative specifier with a `.` or `..` segment after the first), which is yours. If nobody acts, the boundary rules remain bypassable by a deliberate import.

## 2026-09-27 — for-product — the Model field does not follow an outside change (PG-4f)
- PG-4f made the Address field follow a change of `ai-endpoint` made outside the Settings window. The Model field still keeps its old text when `ai-model` changes outside the window, which greys out Test connection and the key row until the owner retypes it. Not in the ticket, so left as is.

## 2026-09-30 — for-architecture — "cannot reach the owner's bus" is stronger than true (PG-11 Part D review)
- The private bus is only the default inside `isolated_run`. A command that unsets `DBUS_SESSION_BUS_ADDRESS` reaches the owner's bus through `$XDG_RUNTIME_DIR/bus` in the shared runtime folder (measured). Nothing in the smoke or sample does this. Please reword Layer 3 (and the plan's "a caller cannot reach the owner's bus") to "never by default".
