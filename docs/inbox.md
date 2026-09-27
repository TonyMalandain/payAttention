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
