# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — proxy and the bearer key (PG-4b review note)
- A system proxy whose ignore list lacks `localhost`/`127.0.0.1` would receive a bearer key sent to an `http://127.0.0.1` engine. GNOME's default ignores loopback, and the plan put proxies out of scope. Worth one line, or a rule that loopback requests bypass the proxy.
