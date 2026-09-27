# ADR-0009 — AI engine keys live in the GNOME keyring, written by prefs and read only by the AI helper
- **Date:** 2026-09-26
- **Kind:** reversible (the libsecret schema name and attributes are the only stored format)
- **Status:** amended twice on 2026-09-27 (see the end)

## Context

A cloud engine needs an API key (R-19). Some local servers accept one too (for
example LM Studio, vLLM, or a LiteLLM Proxy with a master key). ADR-0003 puts
all durable state in GSettings. But GSettings is dconf, a world-readable-by-user
binary file with no encryption. It shows in `dconf dump`, in backups, and in
screenshots of dconf-editor. A key there is a secret in plain text.

Measured on 2026-09-26: `gnome-keyring-daemon` owns `org.freedesktop.secrets`
on the owner's session bus, and `gi://Secret` (libsecret 0.21.8) imports from
gjs.

## Options

1. **GSettings key.** Simplest. Forever cost: the key is in plain text in
   dconf, in every backup of it, and in anything that dumps settings.
2. **A file under `~/.config` with mode 0600.** Forever cost: our own file
   format and permissions, still unencrypted at rest, and a second store next to
   GSettings (which ADR-0003 rejected).
3. **The Secret Service (GNOME keyring) via libsecret.** Forever cost: a
   dependency on a running Secret Service. On GNOME it is always there.
   Elsewhere, and in headless tests, it is absent unless provided.

## Decision

**Option 3.** Deciding reason: **the desktop already has an encrypted,
login-unlocked store made for exactly this, and nothing else keeps the key out
of plain-text dumps.** ADR-0003 still holds for everything that is not a
secret.

- **Schema:** `org.gnome.shell.extensions.payattention.EngineKey`, one
  attribute `endpoint` (string). It holds the engine's base URL, normalised: the
  scheme and host lowercased, the default port dropped, no trailing slash. Each
  engine address has its own key, so switching between a cloud service and a
  local engine never loses or mixes keys.
- **Writer:** `prefs.js` only (store and clear, async). The key field in prefs
  is a password entry. It is never echoed back, only "a key is saved" or "no
  key".
- **Reader:** the AI helper only, looked up by the `endpoint` of its
  configured base URL, async. The key is never in GSettings, never on the
  helper's stdio, never in the shell process, and never logged.
- **Plain HTTP:** a key is sent only over `https:`, or over `http:` to a
  loopback host. A `cloud` engine must be `https:` (`interfaces.md` §6).
- **Missing Secret Service or no key:** requests go without an
  `Authorization` header. The engine's 401 becomes `failed: auth`, which the
  menu shows as "AI unavailable — using rules".
- **Uninstall:** a plain uninstall keeps the keyring items, as it keeps
  settings (D-016), and its output says so. `--purge` also clears every item
  with this schema, and only those, without touching any other keyring item
  (see the testing and build doc).

## Consequences

- Easier: the key is encrypted at rest, unlocked at login with the session,
  and visible to the owner in Passwords and Keys (Seahorse) under a readable
  label.
- Harder: `dconf dump` is no longer a complete backup when AI is used with a
  key. Tests must never touch the owner's real keyring: helper tests run in a
  private D-Bus session, where there is no Secret Service unless the test
  provides one.
- If the login keyring is locked (for example after an auto-login), the
  lookup may prompt or fail (superseded by amendment 2: the helper never
  prompts). A failure gives `failed: no-key`, and the rules
  decide (assumed; checked on the real session, Layer 4).

## Revisit when

- The review process objects to libsecret use from an extension helper, or
- an owner needs AI on a session without a Secret Service.

## Amendment 2026-09-27

The decision stands: the key lives in the GNOME keyring, is written by prefs
and is read only by the AI helper. D-021 and ADR-0010 replace the separate
"local" and "cloud" settings with one endpoint, one model and one key. Two
rules above change:

- **One key field, still stored per endpoint.** Prefs shows one key field.
  It edits the item for the endpoint currently entered. Keying by normalised
  endpoint stays for a security reason that one setting makes sharper: **if the
  owner edits the endpoint, the key saved for the old address is never sent to
  the new one.** A cloud key cannot leak to a mistyped or hostile address, and
  switching back finds the old key again. An endpoint with no saved item is a
  keyless engine. That is the normal case for a local Ollama, and nothing has
  to be switched off for it.
- **Transport rule, by endpoint instead of by "location".** Core classifies
  the endpoint (`interfaces.md` §6.4):
  - `https:` to any host is allowed;
  - `http:` to a loopback host is allowed;
  - `http:` to a private-network host is allowed, but the key is never sent
    over it, and prefs says so;
  - `http:` to any other host is refused, and AI stays not set up.

  The old rule, "a `cloud` engine must be `https:`", is replaced by the last
  line.
- **Missing key.** An empty or absent key is a keyless request, not an error.
  `no-key` is kept only for a Secret Service that cannot be reached or is
  locked. It gives "AI unavailable — using rules", so a locked keyring never
  sends an unauthenticated request that the owner did not intend. **Correction
  to the text above:** "Missing Secret Service or no key: requests go without
  an `Authorization` header" now holds for "no key" only.

## Amendment 2026-09-27 (2) — the helper never prompts

Measured for the PG-4b plan (gjs 1.88.1, libsecret, gnome-keyring 50.0):
`Secret.password_lookup` returns `null`, with no error, for a locked item,
after a prompt. Headless the prompt fails; in a real session the owner would
see an unlock prompt caused by a background process. So it reads "locked" as
"no key" and would send the keyless request the first amendment forbids.

- **The helper reads the key with `Secret.Service.search(schema, attrs,
  ALL | LOAD_SECRETS)`, never with `UNLOCK`,** and never prompts. Three
  answers: an unlocked item gives the key; only locked items give `no-key`;
  no item gives a keyless request. An unreachable Secret Service is an error
  and gives `no-key`.
- A keyless engine therefore still works with a locked keyring, as long as no
  key is saved for its endpoint. An endpoint that may not carry a key (`http:`
  to a private host) does not look one up at all.
- The schema name and attribute are defined once, in `core/aiEngine.js`
  (`data.md`).
