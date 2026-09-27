# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — PG-4a3 fix round (D-030)
- `interfaces.md` §6.2 step 7: `#` or `*` must follow the last digit directly. Spaces or tabs (up to 3) are allowed only before a pause (`DIAL_CODE = /(?:[ \t]{0,3}[,;]+[\d#*]|[#*])/y`).
- Plain-text step additions:
  - comments, `<style>` and `<script>` blocks are dropped with their contents;
  - an unclosed block keeps its text, so later rules still read it;
  - conditional markers `<![if …]>` / `<![endif]>` are dropped;
  - namespaced tags (`<o:p>`) are dropped;
  - opening `<br>`, `<p>`, `<div>` and `<li>` are line ends.
- The order inside `plainText()`: blocks, conditional markers, tags, entities.

## 2026-09-27 — for-architecture — PG-4b (AI helper)
- **GLib log lines go to the helper's stdout when `G_MESSAGES_DEBUG` is set.** GLib's default writer sends DEBUG and INFO to stdout, so stdout is no longer protocol-only. The lines also carry the endpoint URL (libproxy logs `url=http://127.0.0.1:<port>`). The key, invite text and replies did not appear (measured with `G_MESSAGES_DEBUG=all`, `tests/ai/keyring.test.js` test 5). The calendar helper runs on the same GLib, so it is probably affected too (not measured). Nothing decides this yet: either the shell (PG-4c) spawns the helpers without `G_MESSAGES_DEBUG`, or each helper installs its own log writer. If nobody acts, an owner debugging with that variable set gets `bad-json` lines from the AI helper and the endpoint in the shell's log.
- **Known duplicate:** `extension/ai/stdio.js` is a near-copy of `extension/helper/stdio.js`, because `ai/` may not import `helper/` (boundaries.md). Sharing it would be a boundary decision.
