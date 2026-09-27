# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — lint bypass via `./../` (PG-8c review)
- Every lint pattern anchored on `^\.\./` can be sidestepped by writing `./../` (for example `import {StoreWriter} from './../shell/store.js'` in `preview/main.js`). The fix round closes it in `eslint.config.js`. Please record the rule, that patterns must match normalised paths, in boundaries.md.
