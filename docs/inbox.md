# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.


## 2026-09-27 — for-architecture — build command out of date (from the PG-6/PG-7 engineer)
- The build row in `testing-and-build.md` gives the `gnome-extensions pack` command without `--extra-source=../LICENSE --extra-source=../NOTICE`, which PG-6 added.
- The `build.sh` zip check uses `grep -x` rather than `grep -q`, because of SIGPIPE under `pipefail`. That fact is worth one pitfall line.
