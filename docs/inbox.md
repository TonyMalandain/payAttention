# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — PG-4a plan findings (filed by the product manager for the senior engineer)
- `interfaces.md` §6.1, ADR-0010 ("Eligible") and `testing-and-build.md` still say cancelled, declined and all-day meetings are sent. D-023 says they are not. §6.2 lists the calendar name as "never sent", but D-024 sends it (as a `calendar` field after `title`, at most 80 characters). D-022 cuts query and fragment from `videoLink` and from allowlisted links in the description and place. D-025 also removes text passcodes.
- For PG-4b: the `ai/` lint allowlist needs `core/aiProtocol.js`, `aiPrompt.js` and `aiEngine.js`. The AI protocol refuses unknown keys in both directions, unlike the calendar protocol; §6.6 should say so. Parsing the stored `ai-verdicts` belongs in core and is deferred to PG-4c.
