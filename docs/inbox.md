# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.


## 2026-09-27 — for-architecture — build command out of date (from the PG-6/PG-7 engineer)
- The build row in `testing-and-build.md` gives the `gnome-extensions pack` command without `--extra-source=../LICENSE --extra-source=../NOTICE`, which PG-6 added.
- The `build.sh` zip check uses `grep -x` rather than `grep -q`, because of SIGPIPE under `pipefail`. That fact is worth one pitfall line.

## 2026-09-27 — for-architecture — interfaces.md §6.2 out of date after PG-4a2 (D-029)
- The keyword list now includes plurals (`passcodes?|passwords?|pwd|pins?`).
- New steps: invisible marks stripped, HTML line breaks turned into line ends, and dial-in strings replaced.
- The order in core is now: invisible marks, conferencing queries, HTML breaks, dial strings, text passcodes, cleaning, cap.
- `testing-and-build.md` line 149 should also cite D-029.
