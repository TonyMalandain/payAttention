# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — plain-text-first order and the shared invisible-mark list (PG-4a3, D-030)
- `interfaces.md` (around lines 375 and 594) still gives the old list of removed characters and the old order.
- The new order in `withoutPasscodes`:
  1. HTML to plain text;
  2. entities decoded;
  3. `INVISIBLE_MARKS` removed (exported from core/aiProtocol.js, and also used by `cleanText`);
  4. separators normalised;
  5. conferencing queries cut;
  6. `%xx` decoded;
  7. dial strings removed (a linear scan, at least 7 digits);
  8. text passcodes removed.
- `cleanText` and `validateInvite` now strip or reject the whole shared list.
