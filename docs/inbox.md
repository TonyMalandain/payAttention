# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — `lost` can block the queue head (PG-4c review), with a product rule
- By the §6.5 table, `lost` gets no retry record. An invite that crashes the helper every time is re-asked at the head of the queue after each restart, and blocks AI answers for every later meeting. That is fail-safe to the rules, but AI mode quietly stops working.
- **Product rule:** one meeting's invite must never block AI answers for other meetings. Decide the mechanism (for example: a key whose ask ends in `lost` twice in a row gets per-key backoff like `bad-reply`), write it into the §6.5 table, and say which ticket carries it.
