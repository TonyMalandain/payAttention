# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## for-architecture — the unlock grace: per calendar, or all provider staleness? (PG-1c fix round)

The product ruling given for the fix round says: in the first 60 s after
`enable()`, provider staleness *from a source whose connection is `connecting` or
`offline`* is not shown. `shell/health.js` implements exactly that, per source: a
calendar in another state (say `ssl-failed`) still shows in that minute. The
addendum in `interfaces.md` ("Verdict") says no provider staleness at all *while
any* counted source is connecting or offline, which also hides the `ssl-failed`
one. The two differ only when both kinds are present in the first minute. If the
doc's wording is the intended rule, `dataHealth` needs a one-line change and a
test; if the per-source rule is, the addendum needs rewording.
- **Product ruling (product manager, 2026-09-26):** the engineer's reading is correct. The grace hides only the calendars that are reconnecting. A calendar in another failed state (for example `ssl-failed`) still warns at once, because hiding a real failure is worse than a brief warning. Please align the addendum.
