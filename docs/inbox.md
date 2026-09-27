# Inbox — findings waiting for product or architecture

Agents append findings here, tagged `for-product` or `for-architecture`. The owner removes each entry once acted on.

## 2026-09-27 — for-architecture — PG-4a build: text passcodes are removed after cleaning, not before (D-025)
- `interfaces.md` §6.2 says the D-025 passcode rule runs "before cleaning and capping". The build (`extension/core/invite.js`, `withoutPasscodes`) cuts conferencing queries, then cleans, then removes text passcodes, then caps. Running it on cleaned text also catches a value on the next line ("Passcode:\n123456") or one behind a control or bidi character, which the raw-text order would send. It still runs before the cap, so a cut cannot leave half a passcode (tested).
- If nobody acts: §6.2 and the code disagree on the order. The output only differs for those hidden-character cases, where the code is the safer of the two.

## 2026-09-27 — for-design — PG-4a build: three gaps in the plan, closed with the smallest safe choice
- **Upper-case video link scheme.** `isConferenceUrl` accepts `HTTPS://…`, but `validateInvite` requires the link to start with `https://`. Such an invite would be refused by the helper as `bad-request` on every ask. `invite.js` lowercases the scheme only (test: "an upper-case HTTPS scheme…"). Confirm, or choose null instead.
- **Owner address normalisation.** The plan exports nothing from `owner.js` for "normalised email", so `invite.js` has a private copy of `normaliseAddress` (a one-liner, commented). If they drift, the invite's email form and owner matching disagree. Consider exporting it.
- **`buildInvite` with a non-finite start** returns `start: 'NaN-…'`, which fails `validateInvite`. `judge` never calls it for such events (D-023), so this cannot happen today. It becomes reachable only if another caller (PG-4c or PG-4d) builds invites directly.

## 2026-09-27 — for-architecture — licence constraint out of date (from the PG-6/PG-7 planner)
- `docs/architecture/constraints.md:125` still says "Licence GPL-2.0-or-later compatible". Product decision D-026 chose Apache-2.0. Reconcile it. The GNOME review rule is noted as an accepted cost in D-026.
- No new sound playback path is needed: D-028 follows GNOME's "None".

## 2026-09-27 — for-architecture — PG-4b plan: the keyring test is possible headless, but a private bus alone does not isolate it
- **Measured:** `printf '<non-empty phrase>' | gnome-keyring-daemon --unlock --components=secrets --daemonize`, run on a private bus with a throwaway `HOME` and `XDG_*`, gives a working, unlocked, throwaway keyring. An empty phrase does not work: the daemon tries to prompt, and no login collection is created. `testing-and-build.md` Layer 2b says this is "not verified". It is now, and the PG-4b plan uses it.
- **Contradiction:** Layer 2b says "the helper runs inside `dbus-run-session`, so it can never reach the owner's keyring". Measured: the first Secret call on a fresh private bus D-Bus-activates `gnome-keyring-daemon` (the `org.freedesktop.secrets` service file). That daemon opens `$XDG_DATA_HOME/keyrings/`. With the real `HOME` or `XDG_DATA_HOME`, that is the owner's real keyring file (locked, but opened). The PG-4b harness sets `HOME` and every `XDG_*` to a throwaway directory as well.
- If nobody acts: the doc's isolation rule stays too weak for the next person who writes a keyring test.

## 2026-09-27 — for-architecture — PG-4b plan: "locked gives no-key" needs a search, and the helper never prompts
- **Measured:** `Secret.password_lookup` returns `null` (no error) for a locked item, after a prompt. Headless, the prompt fails. In a real session, the owner would see an unlock prompt caused by a background process. So `password_lookup` reads "locked" as "no key", and would send a keyless request, which the ADR-0009 amendment forbids.
- **The plan uses** `Secret.Service.search` with `ALL | LOAD_SECRETS` and without `UNLOCK`. It never prompts, and gives three states:
  - an unlocked item: the key;
  - only locked items: `no-key`;
  - no item: keyless.

  A keyless engine therefore still works while the keyring is locked, as long as no key is saved for its endpoint. An endpoint that may not carry a key (`http:` to a private host) does not look one up at all.
- ADR-0009 says "the lookup may prompt or fail". Worth recording that the helper never prompts.

## 2026-09-27 — for-architecture — PG-4b plan: cases §6.7 does not map, decided in the plan
- **HTTP 3xx:** redirects are not followed, so a 3xx gives `config`.
- **Status outside 200–599** gives `server`.
- **Response body over 1 MiB** (after decoding) gives `bad-reply`. It is read with a cap, so a hostile engine cannot exhaust memory.
- **libsoup session or protocol errors** give `network`.
- **A stored key that is not 1–4 096 visible ASCII characters** gives `config`, and it is never sent (it could split a header). An empty key is keyless (ADR-0010).
- **One deadline** (`timeoutMs`) covers the key lookup, the request and the single `response_format` retry, so an answer never comes later than `timeoutMs` + about 1 s. Without that, the retry could exceed the shell's watchdog.
- **The key schema name** now lives once in `core/aiEngine.js` (`ENGINE_KEY_SCHEMA_NAME`, `ENGINE_KEY_ATTRIBUTE`), so prefs (PG-4d) and the helper cannot disagree on a stored format.
- **Known duplicate:** `ai/stdio.js` is a near-copy of `helper/stdio.js`, because `ai/` may not import `helper/`. A shared module for "a gjs subprocess's stdio" would be a boundary change.
- **Lint did not enforce** "no Soup or Secret outside `ai/` and prefs", which `boundaries.md` says it does. PG-4b Step 1 adds it.
