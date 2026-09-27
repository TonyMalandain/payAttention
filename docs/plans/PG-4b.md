# Plan — PG-4b: the AI helper (a separate gjs process that asks the engine, reads the key from the keyring, and is tested against a fake engine only)

Spec: `docs/prd/meeting-guardian.md`, "Addendum 2026-09-27 — AI mode" (R-18, AI mode judges every meeting; R-19, the owner connects the engine of their choice). Product decisions D-019 to D-025. Architecture: ADR-0007 (OpenAI-compatible protocol, own gjs client on libsoup 3), ADR-0009 (keys in the GNOME keyring, amended), ADR-0010 (AI mode, amended), `interfaces.md` §6.4, §6.6, §6.7 and §6.8, `boundaries.md` (the `ai/` row), `testing-and-build.md` (Layer 2b).

**Sensitive: secrets, personal data, and the network.**
- This is the only code that opens a socket, and the only code that reads the API key.
- The key is looked up per request, sent only as `Authorization: Bearer …`, and only when `mayCarryKey(endpoint)` is true. It never reaches stdout, stderr, a diagnostic, or a test log.
- Each invite holds other people's names, email addresses and meeting text (D-020). The helper never logs an invite, a reply, a reason, a key or the endpoint. stderr carries short codes and HTTP status numbers only.
- Tests never call a real engine or touch the owner's keyring. Every test engine is on `127.0.0.1`, and every test key is a random throwaway value in a throwaway keyring.

## What changes, and for whom

Nothing changes for the owner yet. Rules mode spawns nothing, and nothing spawns `ai/main.js` until PG-4c (the shell) and PG-4d (prefs). This ticket delivers the process those tickets will spawn:
- it takes `configure`, `judge` and `probe` lines on stdin;
- it asks the configured engine once per request;
- it answers each request with exactly one `verdict` or `failed` line.

The build now packs `ai/`.

## The component

- **Responsible for:** `extension/ai/` turns one bounded invite into one verdict or one failure code, by asking the configured engine over the OpenAI-compatible connection.
- **Has drifted by:** nothing yet. The directory is new. Three nearby facts shape the plan:
  1. **The lint rules do not yet enforce what `boundaries.md` says.** It says "no other directory imports Soup … only `ai/` (read) and `prefs.js` (write) import Secret. The lint rules forbid both elsewhere". Today `eslint.config.js` forbids neither in `shell/`, `ui/` or `extension.js`. No rule forbids importing `ai/`, and there is no `ai/` block. Step 1 restores this before any Soup or Secret code exists.
  2. **The private D-Bus start-up is buried.** `tests/helper/isolatedEds.js` starts it inline inside `createIsolatedEds`, and the "kill by this bus only" `/proc` scan is hard-wired to one program name. The AI tests need both. Step 2 extracts them without changing behaviour.
  3. **`ai/` may not import `helper/`** (`boundaries.md`). So `helper/stdio.js` cannot be reused, and `ai/stdio.js` is a deliberate near-copy with a different formatter and log prefix. This is the same trade PG-4a made with `aiProtocol.js`'s private `parseLine`. It is noted for the architect as a known duplicate, not solved here.
- **This change belongs here because:** ADR-0010 and `boundaries.md` give `ai/` exactly this job, and nothing else in the system has network access or the key. The decisions (request body, response meaning, key rule) sit in two gi-free modules, so they are unit-tested under Node. The GNOME parts (Soup, Secret, stdio, main loop) are thin shells around them.

## Facts measured for this plan (2026-09-27, gjs 1.88.1, libsoup 3.6, libsecret, gnome-keyring 50.0)

The engineer relies on these. Each was run on the author's machine with throwaway probes outside the repository.

1. **A headless, isolated keyring works.** Inside a private bus, with `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR` (mode 0700) all in a throwaway directory, and an environment built with `env -i`:
   - Command: `printf '<non-empty phrase>' | gnome-keyring-daemon --unlock --components=secrets --daemonize`.
   - Results: `login.keyring` is created in `$XDG_DATA_HOME/keyrings/`, `Secret.password_store` into `Secret.COLLECTION_DEFAULT` succeeds, and a lookup by attribute finds it.
   - The daemon exits by itself when the private bus goes away.
2. **An empty unlock phrase does not work.** The daemon tries to show a prompt (`gcr-prompter: cannot open display`), and no login collection exists, so the store fails.
3. **A private bus auto-starts a keyring.** `/usr/share/dbus-1/services/…secrets…` means the first Secret call on a fresh private bus D-Bus-activates `gnome-keyring-daemon`, which uses the bus daemon's environment. **So the private bus alone does not isolate the keyring:** `HOME` and `XDG_DATA_HOME` must also be throwaway, or the activated daemon opens the owner's real keyring files. This goes to the architect (the Layer 2b text says the private bus is enough).
4. **`Secret.password_lookup` cannot tell "locked" from "absent".** For a locked item it returns `null` with no error, after a prompt fails (headless) or is shown to the owner (real session). `Secret.Service.search(schema, attrs, Secret.SearchFlags.ALL | Secret.SearchFlags.LOAD_SECRETS)`, *without* `UNLOCK`, gives three distinct answers and never prompts:
   - unlocked item: `get_locked() === false`, and the secret is loaded;
   - locked item: `get_locked() === true`, and there is no secret;
   - no item: an empty list.
5. **An unreachable Secret Service is an error.** With `DBUS_SESSION_BUS_ADDRESS=unix:path=<missing>`, `Secret.Service.get` fails with "Could not connect".
6. **In gjs, `Soup.Message.get_status()` throws** ("429 is not a valid value for enumeration Status") for codes missing from the enum. **`msg.status_code` works** for every code. Always use `status_code`.
7. **Soup 3 behaviour, measured:**
   - With `msg.set_flags(Soup.MessageFlags.NO_REDIRECT)`, a 302 comes back as status 302, and the `Location` is not requested.
   - A non-2xx status is not an error: `send_finish` returns a stream.
   - `msg.response_headers.get_one('Retry-After')` gives `'7'`.
   - Soup sends `Accept-Encoding: gzip, deflate` and decodes the reply itself.
8. **Soup error classes, measured:**
   - `Gio.Cancellable.cancel()` gives `Gio.IOErrorEnum.CANCELLED` (19).
   - A closed port gives `Gio.IOErrorEnum.CONNECTION_REFUSED` (39).
   - An unknown host gives a `Gio.ResolverError`.
   - A self-signed certificate on `https://127.0.0.1` gives a `Gio.TlsError` ("Unacceptable TLS certificate").
9. **Test prerequisites are present:** `openssl` (for a throwaway self-signed certificate), `unzip`, `dbus-daemon`, and `gnome-keyring-daemon`.
10. **Baseline:** `npm test` gives 992 tests and 992 passes.

## Module layout

| Module | Responsible for (one sentence) | Imports | Tested by |
|---|---|---|---|
| `ai/chat.js` | The Chat Completions exchange as data: what is sent, which key header value is allowed, and what a response means. | `../core/aiPrompt.js` | Node, `tests/ai/chat.test.js` |
| `ai/service.js` | The protocol conversation: configuration, one request at a time, and one reply line per request. | `../core/aiProtocol.js`, `../core/aiPrompt.js`, `../core/aiEngine.js`, `./chat.js` | Node, `tests/ai/service.test.js` (fakes) |
| `ai/transport.js` | One HTTP POST with a deadline, a body-size cap and no redirects. | `gi://Soup?version=3.0`, `gi://Gio`, `gi://GLib`, `../core/aiEngine.js` | integration |
| `ai/keyring.js` | Reading the engine key for one endpoint without ever prompting. | `gi://Secret`, `gi://Gio`, `gi://GLib`, `../core/aiEngine.js` | integration |
| `ai/stdio.js` | The three file descriptors: protocol-only stdout, code-only stderr, and the stdin line reader. | `gi://Gio`, `gi://GioUnix`, `gi://GLib`, `../core/aiProtocol.js` | integration |
| `ai/main.js` | The process: argv, the main loop, the wiring, and the only exit. | `gi://GLib`, `system`, `../core/aiProtocol.js`, the four `./` modules above | integration |

`chat.js` and `service.js` have **no** `gi://` import, so they run under Node and gjs alike. That is the deciding-versus-doing split: every "what should happen" is in them, and every "touch the network, keyring or fd" is in the other four.

Like every current source file, new files have no SPDX header (PG-6 has not landed). Do not add one here.

## Seams (exact signatures)

### `core/aiEngine.js` (added, Step 3)

```js
/** The libsecret schema name of the engine keys (ADR-0009). Written by prefs, read by the AI helper. */
export const ENGINE_KEY_SCHEMA_NAME = 'org.gnome.shell.extensions.payattention.EngineKey';
/** The schema's one attribute. Its value is always normaliseEndpoint(endpoint). */
export const ENGINE_KEY_ATTRIBUTE = 'endpoint';
```

This is a stored format that two processes share: prefs (PG-4d) writes it and the helper reads it. `prefs.js` may not import `ai/`, but both may import `core/`, so the name is defined once there. Neither side can then spell it differently. `aiEngine.js` still imports nothing.

### `ai/chat.js`

```js
/** max_tokens in every request (interfaces §6.7). */
export const MAX_TOKENS = 400;
/** The longest stored key sent as a bearer token, in characters. */
export const MAX_KEY_LENGTH = 4096;

/**
 * @param {string} endpoint already normalised (configure was validated)
 * @returns {string} endpoint + '/chat/completions'
 */
export function chatUrl(endpoint)

/**
 * The request body, keys in this order: model, messages, temperature, max_tokens,
 * then response_format only when withResponseFormat.
 * messages = [{role:'system', content: SYSTEM_PROMPT}, {role:'user', content: JSON.stringify(invite)}].
 * temperature 0; response_format = {type:'json_schema', json_schema: REPLY_JSON_SCHEMA}.
 * No tools, functions or stream key, ever.
 *
 * @param {string} model
 * @param {object} invite a valid invite; serialised unchanged
 * @param {boolean} withResponseFormat
 * @returns {string} JSON text
 */
export function chatRequestBody(model, invite, withResponseFormat)

/**
 * What a key lookup means for the request.
 *   found, key ''                          -> {bearer: null}   (an empty key is a keyless engine, ADR-0010)
 *   found, key of 1..MAX_KEY_LENGTH chars,
 *          every char in U+0021..U+007E    -> {bearer: key}
 *   found, any other key                   -> {failure: 'config'}   (never sent: it could split a header)
 *   absent                                 -> {bearer: null}
 *   unavailable                            -> {failure: 'no-key'}
 *
 * @param {import('./service.js').KeyLookup} lookup
 * @returns {{bearer: string|null} | {failure: 'no-key'|'config'}}
 */
export function bearerFrom(lookup)

/**
 * What one HTTP response means. Never throws. Reads only choices[0].message.content.
 *
 * @param {{status:number, retryAfter:string|null, body:string}} response
 * @param {boolean} withResponseFormat whether the request carried response_format
 * @returns {{kind:'verdict', verdict:'must'|'ignore', reason:string}
 *         | {kind:'failed', code:string, retryAfterS?:number}
 *         | {kind:'retry-without-format'}}
 */
export function readChatResponse(response, withResponseFormat)
```

`readChatResponse` applies this table in order. It is the §6.7 mapping, plus the rows §6.7 leaves open, decided here and reported to the architect:

| Status | Outcome |
|---|---|
| 200–299 | `JSON.parse(body)`; a parse error gives `bad-reply`. `content = Array.isArray(obj?.choices) ? obj.choices[0]?.message?.content : undefined`. `parseReply(content)` gives a verdict, or `null`, which gives `bad-reply`. `content` goes to `parseReply` as it is, even when it is not a string. |
| 300–399 | `config` (redirects are not followed, so the endpoint is wrong) — *decided here* |
| 400, when `withResponseFormat` and `body.includes('response_format')` | `retry-without-format` |
| 401, 403 | `auth` |
| 402, 429 | `rate-limited`. `retryAfterS` is present only when `retryAfter` matches `/^\s*\d{1,9}\s*$/`, and it is then `Math.min(n, 86400)`. An HTTP-date or any other form gives no `retryAfterS`. |
| any other 400–499 | `config` |
| 500–599 | `server` |
| anything else | `server` — *decided here* |

### `ai/service.js`

```js
/**
 * @typedef {{state:'found', key:string} | {state:'absent'} | {state:'unavailable'}} KeyLookup
 * @typedef {{url:string, body:string, bearer:string|null, timeoutMs:number}} ChatPost
 * @typedef {{ok:true, status:number, retryAfter:string|null, body:string}
 *         | {ok:false, code:'timeout'|'network'|'tls'|'bad-reply'}} PostResult
 */

export class AiService {
    /**
     * @param {{send: (message:object) => void,          // Stdout.send: formats through formatAiHelperMessage
     *          diagnose: (code:string, detail?:string) => void,
     *          lookupKey: (endpoint:string) => Promise<KeyLookup>,   // never rejects
     *          post: (request:ChatPost) => Promise<PostResult>,       // rejects only on a programming error
     *          now: () => number,                        // ms; Date.now in main.js
     *          onFatal: () => void}} parts
     */
    constructor(parts)

    /**
     * One stdin line (without its newline).
     *
     * @param {string} line
     * @returns {Promise<void>} settles once this line's reply, if any, is written. Never rejects:
     *          an unexpected error calls parts.onFatal() instead.
     */
    handleLine(line)
}
```

What this seam makes impossible:
- **No order to get wrong.** There is no separate `configure()`, `judge()` or `lookup()` to call in the right order. The service reads lines and holds the configuration itself. A request before `configure` is answered `failed: config`; it is not dropped, and it does not throw.
- **Locked cannot be read as absent.** `KeyLookup` has three states, so a locked keyring can never become a keyless request.
- **Every reply goes through `send`.** `send` validates through `formatAiHelperMessage`, so the service cannot write a line the shell refuses.

### `ai/transport.js`

```js
/** The largest response body read, in bytes after content decoding. */
export const MAX_RESPONSE_BYTES = 1048576;

export class HttpTransport {
    /** Creates one Soup.Session for the life of the process, with its timeout property left at 0 (the deadline below is the only timer). */
    constructor()

    /**
     * POST request.body as application/json to request.url, with
     * 'Authorization: Bearer <bearer>' only when bearer is not null, redirects off
     * (Soup.MessageFlags.NO_REDIRECT), and one deadline of timeoutMs covering
     * connect, send and the whole body read.
     *
     * @param {import('./service.js').ChatPost} request
     * @returns {Promise<import('./service.js').PostResult>}
     * @throws {TypeError} (synchronously) when bearer is not null and mayCarryKey(url) is false,
     *         or timeoutMs is not an integer >= 1
     */
    post(request)
}
```

- **Key guard.** `mayCarryKey` is checked again at the network boundary. The service already skips the lookup for such endpoints (see Step 5), so this second check can only fire on a programming error, which then becomes fatal. **A key can never go out over plain HTTP to a non-loopback host, whoever the caller is.**
- **How the transport classifies errors:**
  - its own deadline fired (a private `timedOut` flag, checked first): `timeout`;
  - `e instanceof GLib.Error && e.domain === Gio.tls_error_quark()`: `tls`;
  - any other `GLib.Error` (IO, resolver, Soup session errors): `network`;
  - a body over `MAX_RESPONSE_BYTES`: cancel the read, then `bad-reply`.
- **How the body is read.** `session.send_async`, then `stream.read_bytes_async(65536, …)` in a loop until an empty chunk. Decode with `new TextDecoder('utf-8')` (not fatal; bad bytes become U+FFFD). The status comes from `msg.status_code` (fact 6), and `retryAfter` from `msg.response_headers.get_one('Retry-After')`.
- **Every GLib callback body is wrapped in `try`.** A `GLib.Error` resolves as above. Anything else rejects the promise, so it reaches `onFatal` and does not leave the promise unsettled for ever.

### `ai/keyring.js`

```js
/** A lookup that has not finished in this time is treated as unavailable. */
export const KEY_LOOKUP_TIMEOUT_MS = 5000;

/** new Secret.Schema(ENGINE_KEY_SCHEMA_NAME, Secret.SchemaFlags.NONE, {[ENGINE_KEY_ATTRIBUTE]: Secret.SchemaAttributeType.STRING}) */
export const ENGINE_KEY_SCHEMA;

/**
 * The saved key for this endpoint. Never prompts (no SearchFlags.UNLOCK). Never rejects.
 *   Secret.Service.get(OPEN_SESSION) fails, the search fails, or the timeout passes -> {state:'unavailable'}
 *   no matching item                                                              -> {state:'absent'}
 *   an unlocked matching item whose secret reads as text                          -> {state:'found', key}
 *   only locked matching items, or a secret that is not text                      -> {state:'unavailable'}
 * With several unlocked items, the first one returned wins.
 *
 * @param {string} endpoint normalised
 * @returns {Promise<import('./service.js').KeyLookup>}
 */
export function lookupKey(endpoint)
```

Search flags: `Secret.SearchFlags.ALL | Secret.SearchFlags.LOAD_SECRETS` (fact 4). The timeout uses a `Gio.Cancellable` passed to both calls, and a `GLib.timeout_add` that cancels it.

### `ai/stdio.js`

It follows `helper/stdio.js`, with two differences: `send` formats through `formatAiHelperMessage`, and the stderr prefix is `payattention-ai:`.

```js
export class Stdout {
    constructor()                 // GioUnix.OutputStream.new(1, false)
    /** @throws {TypeError} when the message is not a valid AI helper message */
    send(message)
}
/** Writes 'payattention-ai: <code>[ <detail>]\n' to fd 2. It uses helper/stdio.js's code and detail patterns, and "(redacted)" for anything outside them. */
export function reportDiagnostic(code, detail = '')
/** Same contract as helper/stdio.js watchStdin: onLine per line, '�' for invalid UTF-8, onEof once. */
export function watchStdin({ onLine, onEof })
```

There is no `writeText`, because the AI helper has no plain-text mode.

### `ai/main.js` (no exports)

- It takes no arguments. Any argument gives `reportDiagnostic('usage')` and `exitSoon(2)`.
- `exitSoon(code)` is copied from `helper/main.js`: `GLib.idle_add(GLib.PRIORITY_HIGH, () => System.exit(code))`. It is the **only** exit, and it is only ever called from a main-loop callback or through this idle.
- **Start-up, inside a `GLib.idle_add` while the loop runs:**
  1. `stdout = new Stdout()`, then `stdout.send({type:'hello', protocol: AI_PROTOCOL_VERSION})`.
  2. `const transport = new HttpTransport()`.
  3. `service = new AiService({send: m => stdout.send(m), diagnose: reportDiagnostic, lookupKey, post: r => transport.post(r), now: () => Date.now(), onFatal: fatal})`.
  4. `watchStdin({onLine: l => service.handleLine(l), onEof: () => exitSoon(0)})`.
- **Start-up errors.** Any exception during start-up calls `fatal()`.
- **What `fatal()` does:** `reportDiagnostic('ai-failed')` and `exitSoon(1)`. It never prints the exception, which could carry a URL or invite text.
- **EOF with a request in flight still exits 0 at once.** The helper holds no state (`interfaces.md` §1).

### Closed list of stderr codes

| Code | Detail | From |
|---|---|---|
| `usage` | — | main |
| `ai-failed` | — | main (fatal) |
| `bad-command` | the protocol code, for example `bad-invite` | service |
| `not-configured` | — | service (a request before `configure`) |
| `configure-again` | — | service |
| `request-failed` | `<failure code>`, or `<failure code> <http status>` | service |

Nothing else is written to stderr by our code.

## Service behaviour (decided; Step 5 tests every row)

| Input line | What happens |
|---|---|
| Fails `parseAiShellLine` | `diagnose('bad-command', result.code)`. If the raw line JSON-parses to an object whose `type` is `judge` or `probe`, and `validateAiHelperMessage({type:'failed', id: obj.id, code:'bad-request'}).ok`, it sends `{type:'failed', id, code:'bad-request'}` at once. Otherwise there is no reply. |
| Valid `configure`, first one | It stores `{endpoint, model, timeoutMs}`. There is no reply. |
| Valid `configure`, again | `diagnose('configure-again')`, and the line is ignored. The first configuration stays. The shell kills and respawns on any engine change (§6.5), so this only happens through a shell bug, and it must not silently switch engines under a running request. |
| `judge` or `probe` before any valid `configure` | `diagnose('not-configured')`, and it sends `failed: config` at once. |
| `judge` | It is queued with `message.invite`. |
| `probe` | It is queued with `PROBE_INVITE`. |

**Queue.** Requests run one at a time, in arrival order. It is a promise tail: `done = tail.then(() => ask(...))`, then `tail = done.catch(() => {})`, and `handleLine` returns `done.catch(() => parts.onFatal())`. The shell sends one at a time anyway (§6.5). Running in order also keeps the `response_format` switch-off deterministic, and a buggy shell can never make the helper run several requests at once against the engine.

**One request (`ask(id, invite)`):**
1. `started = now()`.
2. If `mayCarryKey(endpoint)`:
   - `b = bearerFrom(await lookupKey(endpoint))`;
   - a `failure` sends `failed` with that code, and the request stops;
   - otherwise `bearer = b.bearer`.

   Else `bearer = null`, and **`lookupKey` is not called at all**. A keyless private-network engine never touches the keyring, so it works with a locked keyring and never causes a lookup.
3. Loop:
   - `remaining = timeoutMs − (now() − started)`. If `remaining < 1`, send `failed: timeout`.
   - `withFormat = this._useResponseFormat` (it starts `true`).
   - `result = await post({url: chatUrl(endpoint), body: chatRequestBody(model, invite, withFormat), bearer, timeoutMs: Math.floor(remaining)})`.
   - A `!result.ok` sends `failed` with `result.code`.
   - `outcome = readChatResponse(result, withFormat)`:
     - `retry-without-format`: set `this._useResponseFormat = false` (for the rest of the run, §6.7), and go round again;
     - `verdict`: send `{type:'verdict', id, verdict, reason}`;
     - `failed`: send `{type:'failed', id, code}`, plus `retryAfterS` when `outcome.retryAfterS !== undefined`.

   The loop ends: a retry only happens when `withFormat` was true, and it then becomes false.
4. **One deadline covers the key lookup, the first attempt and the retry.** This keeps every answer within `timeoutMs` plus about 1 s, well inside the shell's watchdog (`timeoutMs + 10 s`, §6.5).
5. **Every `failed` also calls `diagnose('request-failed', …)`:**
   - after an HTTP response, the detail is the code plus the HTTP status;
   - otherwise, the code only.

## Steps

Steps 1 and 2 are **repair: they must not change the behaviour of any shipped code or of any existing test**. `npm run lint`, `npm test` and `npm run test:helper` are green before and after each, with the same counts plus the new cases. Steps 3 to 10 are the feature, each test first. Land them as separate commits in this order.

### Step 1 — Lint enforces the `ai/` boundary and "Soup and Secret only where allowed"  [repair]
- **Test first:** add cases to `tests/unit/boundaries.test.js` `CASES`. Each must fail before the config change, which proves the rule is new, and pass after.
  - `extension/ai/probe.js`: `import Soup from 'gi://Soup?version=3.0'` → ok; `import Secret from 'gi://Secret'` → ok; `import GioUnix from 'gi://GioUnix'` → ok; `import System from 'system'` → ok; `import {x} from '../core/aiProtocol.js'` → ok; the same for `aiPrompt.js` and `aiEngine.js` → ok; `import {x} from './chat.js'` → ok.
  - `extension/ai/probe.js`: `'../core/invite.js'` → error; `'../core/judge.js'` → error; `'../core/protocol.js'` → error (it arrives only transitively); `'gi://ECal'` → error; `'gi://St'` → error; `'gi://Gtk?version=4.0'` → error; `'../helper/stdio.js'` → error; `'../shell/store.js'` → error; `'../ui/card.js'` → error; `'resource:///org/gnome/shell/ui/main.js'` → error; `'node:http'` → error.
  - `extension/shell/probe.js`: `gi://Soup?version=3.0` → error; `gi://Secret` → error; `'../ai/service.js'` → error.
  - `extension/ui/probe.js`: `gi://Soup?version=3.0` → error; `gi://Secret` → error; `'../ai/main.js'` → error.
  - `extension/extension.js`: `gi://Soup?version=3.0` → error; `gi://Secret` → error; `'./ai/main.js'` → error.
  - `extension/prefs.js`: `gi://Soup?version=3.0` → error; `gi://Secret` → ok; `'./ai/main.js'` → error.
  - `extension/helper/probe.js`: `gi://Soup?version=3.0` → error (this already passes; keep it as a guard); `'../ai/chat.js'` → error.
- **Then, in `eslint.config.js`:**
  - `NO_SHELL_SIDE_GI.regex` becomes `'^gi://(ECal|EDataServer|ICalGLib|Gtk|Gdk|Adw|Soup|Secret)(\\?|$)'`. The message becomes `'shell-side code may not use EDS, GTK/Adw, Soup or Secret (boundaries.md)'`.
  - shell: `'^\\.\\./(ui|helper|ai)/'`.
  - ui: `'^\\.\\./(shell|helper|ai)/'`.
  - `extension.js`: `'^\\./(helper|core|ai)/'`.
  - prefs:
    - `'^gi://(Clutter|Meta|St|Shell|Soup)(\\?|$)'`, with the message `'prefs runs outside the shell and never uses the network: no Clutter/Meta/St/Shell/Soup'`;
    - `'^\\./(shell|ui|helper|ai)/'`.
  - helper: `'^\\.\\./(shell|ui|ai)/'`.
  - A new block `files: ['extension/ai/**/*.js']` whose patterns are:
    - `{ regex: '^resource:', message: 'the AI helper runs outside the shell: no resource:// imports' }`;
    - `{ regex: '^gi://(?!(Soup|Secret|Gio|GioUnix|GLib)(\\?|$))', message: 'the AI helper may use only Soup, Secret, Gio, GioUnix, GLib' }`;
    - `{ regex: '^\\.\\./core/(?!(aiProtocol|aiPrompt|aiEngine)\\.js$)', message: 'the AI helper may import only core/aiProtocol.js, aiPrompt.js and aiEngine.js (ADR-0010)' }`;
    - `{ regex: '^\\.\\./(shell|ui|helper)/', message: 'the AI helper may not import shell/, ui/ or helper/' }`;
    - `{ regex: '^\\.\\./(extension|prefs)\\.js$', message: 'the AI helper may not import extension.js or prefs.js' }`;
    - `NO_NODE`.
  - Add `'tests/ai/gjs/**/*.js'` to the gjs globals block's `files`. Add `'tests/ai/**/*.js'` to the Node block's `files`, and `'tests/ai/gjs/**'` to its `ignores`.
- **Why here:** `boundaries.md` already states these rules. Lint is where this project enforces them.
- **Behaviour change:** none. `grep -rn "gi://Soup\|gi://Secret\|/ai/" extension` finds nothing today (checked).

### Step 2 — One private-bus start-up and one "kill on this bus only", shared by the helper and AI tests  [repair]
- **Test first:** none new. Existing `npm run test:helper` must be green before and after, with the same test count. This is a move of test support code.
- **Then, in `tests/helper/isolatedEds.js`, extract two exported functions from existing code, unchanged in behaviour:**
  ```js
  /**
   * Starts `dbus-daemon --session --nofork --print-address=1` with env (never the real bus),
   * sets env.DBUS_SESSION_BUS_ADDRESS, and returns a stop() that SIGTERMs it and awaits its exit.
   * @param {object} env built from scratch by the caller; mutated (bus address added)
   * @returns {Promise<{stop: () => Promise<void>}>}
   */
  export async function startPrivateBus(env)

  /**
   * SIGKILLs every process whose argv[0] basename is programName AND whose
   * environment carries env's private DBUS_SESSION_BUS_ADDRESS. Never matches by name alone.
   * @returns {number} how many were killed
   */
  export function killOnPrivateBus(env, programName)
  ```
  - `createIsolatedEds` calls `startPrivateBus(env)`, and its `stop` delegates to it.
  - `killIsolatedCalendarFactory(env)` becomes `return killOnPrivateBus(env, 'evolution-calendar-factory');`, and keeps its name and doc for its callers.
- **Why here:** the AI tests need the same isolation. `testing-and-build.md` asks for shared test helpers rather than copies.
- **Behaviour change:** none.

### Step 3 — The keyring schema name is one constant in core  [feature]
- **Test first:** in `tests/unit/aiEngine.test.js`, assert:
  - `ENGINE_KEY_SCHEMA_NAME === 'org.gnome.shell.extensions.payattention.EngineKey'`;
  - `ENGINE_KEY_ATTRIBUTE === 'endpoint'`;
  - both are strings.

  The test fails with "not exported" first.
- **Then:** add the two exports shown under Seams to `extension/core/aiEngine.js`, after `AI_TIMEOUT_MS`.
- **Why here:** `aiEngine.js` owns "how the engine is addressed", and the keyring attribute *is* the normalised endpoint (§6.4). Both readers can import core.
- **Behaviour change:** new exports only.

### Step 4 — `ai/chat.js`: the request body, the key rule, and what a response means  [feature]
- **Test first,** `tests/ai/chat.test.js` (Node). Also change `package.json` `"test:helper"` to `node --test "tests/helper/**/*.test.js" "tests/ai/**/*.test.js"` in this step, so the new suite runs.
  - **`chatUrl`:** `'http://127.0.0.1:11434/v1'` → `'http://127.0.0.1:11434/v1/chat/completions'`.
  - **`chatRequestBody(model, PROBE_INVITE, true)`:**
    - parsed, its keys in order are exactly `['model','messages','temperature','max_tokens','response_format']`;
    - `messages` has length 2: system content `=== SYSTEM_PROMPT`, and user content `=== JSON.stringify(PROBE_INVITE)`;
    - `temperature === 0` and `max_tokens === 400`;
    - `response_format` deep-equals `{type:'json_schema', json_schema: REPLY_JSON_SCHEMA}`;
    - it has no `tools`, `functions`, `tool_choice` or `stream` key.

    With `false`, the keys are the same without `response_format`, and every other byte is equal.
  - **`bearerFrom`,** one test per row of its table:
    - `found 'sk-test'` → bearer;
    - `found ''` → `{bearer:null}`;
    - `found 'a b'`, `found 'a\nb'`, `found 'é'`, and 4097 × `'a'` → `{failure:'config'}`;
    - 4096 × `'a'` → bearer;
    - `absent` → `{bearer:null}`;
    - `unavailable` → `{failure:'no-key'}`.
  - **`readChatResponse`,** one test per table row:
    - 200 with an OpenAI envelope → verdict;
    - 204 with a valid envelope → verdict (any 2xx);
    - 200 with non-JSON → `bad-reply`;
    - 200 `{}`, 200 `{"choices":[]}` and 200 `{"choices":[{"message":{"content":null}}]}` → `bad-reply`;
    - 200 whose content is an object → `bad-reply`;
    - 302 → `config`;
    - 400 `…response_format…` with `true` → `retry-without-format`; the same with `false` → `config`;
    - 400 without the word → `config`;
    - 401 and 403 → `auth`;
    - 402 → `rate-limited` with no `retryAfterS`;
    - 429 with `'7'` → `retryAfterS: 7`; with `' 7 '` → 7; with `'999999999'` → 86400; with `'Wed, 21 Oct 2026 07:28:00 GMT'`, `'-1'` and `'1.5'` → no `retryAfterS` key at all (`Object.hasOwn` is false);
    - 404 → `config`; 500 and 503 → `server`; 600 → `server`.
  - **Injection:** for every `REPLY_CORPUS` entry (`tests/unit/support/replyCorpus.js`), wrap `text` as `choices[0].message.content` in a 200 envelope. `readChatResponse` gives `{kind:'verdict', ...expected}`, or `failed: bad-reply` when `expected` is null. One extra case: extra top-level keys in the envelope (`"joinUrl"`, `"mode"`) are ignored.

  Each test fails first because the module is missing.
- **Then:** write `extension/ai/chat.js` exactly as the Seams section says. It imports only `SYSTEM_PROMPT`, `REPLY_JSON_SCHEMA` and `parseReply` from `../core/aiPrompt.js`. It does no I/O and has no `gi://` import.
- **Why here:** this is the whole of "what is sent and what came back means" (§6.7, §6.8). Keeping it pure makes each mapping a one-line test.
- **Behaviour change:** new module; nothing calls it yet.

### Step 5 — `ai/service.js`: the conversation, with fakes  [feature]
- **Test first,** `tests/ai/service.test.js` (Node).
  - **Fakes:**
    - `send` pushes each message after checking `formatAiHelperMessage(m)` does not throw, so the test proves every reply is valid protocol;
    - `diagnose` records `[code, detail]`;
    - `lookupKey` records its endpoints and returns a scripted `KeyLookup`;
    - `post` records each `ChatPost` and returns scripted `PostResult`s. It can also advance a fake clock by a given number of ms before resolving;
    - `now` reads the fake clock;
    - `onFatal` counts its calls.
  - **Cases,** each on a fresh service:
    1. A `judge` before `configure` gives `failed config`, `not-configured` is diagnosed, and `post` is never called.
    2. `configure` gives no reply. Then `probe` posts exactly `chatRequestBody(model, PROBE_INVITE, true)` to `chatUrl(endpoint)` and replies with the verdict.
    3. A second `configure` with another endpoint is ignored (`configure-again`). The next `judge` goes to the first endpoint.
    4. An invalid `configure` (for example `timeoutMs: 500`) gives `bad-command invalid-configure`. The service stays unconfigured, so the next `judge` gives `failed config`.
    5. A `judge` whose invite has an extra key `uid` gives `failed bad-request` with its id, and `bad-command bad-invite` is diagnosed. The same happens for a missing `guestsTotal`, and for an invite over 8 192 bytes (25 guests with 80-character names and 200-character emails). `post` is never called.
    6. A `judge` with id `'bad id!'` gives no reply at all, and `bad-command` is diagnosed. Non-JSON gives no reply and `bad-command bad-json`.
    7. **Key rule by endpoint:**
       - `http://127.0.0.1:1/v1` and `https://engine.example.test/v1` call `lookupKey` with exactly that endpoint;
       - `http://10.0.0.5:8080/v1` and `http://gpu.lan/v1` **never call `lookupKey`**, and post with `bearer: null`.
    8. Lookup results:
       - `unavailable` gives `failed no-key`, and there is no post;
       - `found 'a b'` gives `failed config`, and there is no post;
       - `found 'k1'` posts with `bearer: 'k1'`;
       - `absent` posts with `bearer: null`.
    9. **`response_format` retry:**
       - the first post returns 400 with `response_format` in its body;
       - the second post's body is `chatRequestBody(…, false)`, and the verdict is sent;
       - a later `judge` in the same service posts without `response_format`.
       - A 400 without the word gives `failed config` after one post.
    10. **One deadline:**
        - with `timeoutMs 10000`, the first post advances the clock by 9 000 ms and returns the `response_format` 400. The second post gets `timeoutMs 1000`;
        - when the first post advances 10 000, there is no second post, and `failed timeout` is sent;
        - a `lookupKey` that advances the clock 4 000 ms leaves the post `timeoutMs 6000`.
    11. **Order:** two `judge`s sent back-to-back. The second `post` is not called until the first `post`'s promise has resolved (check with a deferred promise). The replies come in the same order.
    12. **Failures:**
        - a `PostResult` `{ok:false, code:'tls'}` gives `failed tls`, with `request-failed tls` diagnosed;
        - a 429 with `'7'` gives `{type:'failed', id, code:'rate-limited', retryAfterS:7}`, with `request-failed rate-limited 429` diagnosed.
    13. A `post` that rejects with a `TypeError` calls `onFatal` once, and `handleLine`'s promise still resolves. A later line is still handled, so the tail is not poisoned.
    14. **Nothing is logged but codes:** after all cases, every recorded diagnostic is joined and checked. It contains none of the invite's title, description, guest names, reason text, key or endpoint.
- **Then:** write `extension/ai/service.js` exactly as "Service behaviour" says. It has no `gi://` import. It imports:
  - `parseAiShellLine` and `validateAiHelperMessage` from `aiProtocol.js`;
  - `PROBE_INVITE` from `aiPrompt.js`;
  - `mayCarryKey` from `aiEngine.js`;
  - `chatUrl`, `chatRequestBody`, `bearerFrom` and `readChatResponse` from `./chat.js`.
- **Why here:** it owns the protocol conversation (§6.6), and it takes its I/O as parameters, the same pattern as the controller's injected factories (`interfaces.md` §3).
- **Behaviour change:** new module; nothing calls it yet.

### Step 6 — The process: stdio, transport, keyring, main, and the fake-engine harness; start, exit, and the invite proof  [feature]

**Harness (test support, not tests):**
- **`tests/ai/fakeEngine.js` (Node):**
  ```js
  /** A 200 body in the OpenAI Chat Completions shape with the given content. */
  export function chatEnvelope(content)
  /**
   * An HTTP (or HTTPS when tls is given) server on 127.0.0.1, port chosen by the OS.
   * Records every request as {method, path, headers, body, receivedAt}, and answeredAt when answered.
   * Answers queued handlers in order, then the default: 200 chatEnvelope('{"verdict":"must","reason":"fake engine"}').
   * Handler: {status, headers?, body} | {delayMs, status, headers?, body} | {hold: true} (never answers until close).
   * @param {{tls?: {key:string, cert:string}}} [options] PEM text
   * @returns {Promise<{endpoint:string, requests:object[],
   *                    queue:(...handlers) => void, close:() => Promise<void>}>}
   *          endpoint is 'http://127.0.0.1:<port>/v1', or 'https://…' with tls
   */
  export async function startFakeEngine(options)
  ```
- **`tests/ai/session.js` (Node):**
  ```js
  /**
   * A throwaway session: <repo>/.test-home/ai-<name>/ (removed at start), with HOME, XDG_CONFIG_HOME,
   * XDG_DATA_HOME, XDG_CACHE_HOME and XDG_RUNTIME_DIR (mode 0700) inside it, LANG=C.UTF-8,
   * GSETTINGS_BACKEND=memory, GIO_USE_VFS=local, PATH from process.env, and NOTHING else from
   * process.env (never the real bus, DISPLAY or WAYLAND_DISPLAY).
   * Starts a private bus (startPrivateBus) and an unlocked throwaway keyring on it:
   * `gnome-keyring-daemon --unlock --components=secrets --daemonize` with UNLOCK_PHRASE on stdin,
   * and awaits its exit code 0.
   * @returns {Promise<{home:string, env:object,
   *   storeKey:(endpoint:string, key:string) => Promise<void>,   // runs tests/ai/gjs/keyring.js store
   *   lockKeyring:() => Promise<void>,                          // runs tests/ai/gjs/keyring.js lock
   *   unreachableEnv:() => object,                              // env with DBUS_SESSION_BUS_ADDRESS=unix:path=<home>/no-bus
   *   stop:() => Promise<void>}>}                               // stops the bus, then killOnPrivateBus(env, 'gnome-keyring-daemon')
   */
  export async function createAiSession(name)
  /** Non-empty on purpose (an empty phrase makes the daemon prompt, fact 2). Not a secret: it guards a throwaway keyring holding throwaway keys. */
  export const UNLOCK_PHRASE = 'payattention-test-unlock';
  /** A fresh random fake key per call: 'pa-test-key-' + crypto.randomUUID(). */
  export function throwawayKey()
  /** Starts `gjs -m extension/ai/main.js` with env, stdio piped. */
  export function startAiHelper(env)
  ```
- **`AiHelperProcess`,** modelled on `HelperProcess` in `isolatedEds.js`, with these methods:
  - `nextMessage(timeoutMs)`: every stdout line must pass `parseAiHelperLine`, or the test fails;
  - `send(message)`: through `formatAiShellMessage`;
  - `sendRaw(text)`;
  - `configure(endpoint, timeoutMs = 10000)`;
  - `closeStdin()`, `exited(timeoutMs)`, `stderr()` and `kill()`.
- **The harness rule "never a real engine":** `configure()` throws unless `endpoint` matches `/^https?:\/\/127\.0\.0\.1:\d+\/v1$/`, and `send()` and `sendRaw()` throw on any `configure` line. So `configure()` is the only way to name an engine, and no test can reach a non-loopback address.
- **`tests/ai/gjs/keyring.js` (gjs, a test-only writer):**
  - `store <endpoint> <key>`: `Secret.password_store(ENGINE_KEY_SCHEMA, {endpoint}, Secret.COLLECTION_DEFAULT, 'payAttention test key', key, …)`;
  - `lock`: `Secret.Service.get(LOAD_COLLECTIONS)`, then `service.lock(service.get_collections())`.

  It imports `ENGINE_KEY_SCHEMA` from `extension/ai/keyring.js`, so the writer and reader cannot drift. It prints `KEYRING OK` and exits 0 from an idle callback, as `tests/helper/gjs/serviceStartOrder.js` does; otherwise it exits 1.
- **`tests/ai/inviteFixture.js` (Node):** `hostileInvite()` returns `buildInvite(ev, ownerIdentity(snapshot([ev]), CONFIG), 'Family', -240)`, using `event`, `att`, `snapshot` and `CONFIG` from `tests/unit/support/builders.js`. `ev` has:
  - a title;
  - `conferenceUris: ['https://zoom.us/j/123456789?pwd=AbCdEf']`;
  - a description of `'Join https://zoom.us/j/123456789?pwd=AbCdEf Passcode: 123456 '` + 3 000 × `'d'`;
  - `location: '12 Example Street'`;
  - an organiser `Olga Organiser <olga@example.invalid>`;
  - the owner accepted;
  - 30 individual guests `Guest NN <guestNN@example.invalid>` with mixed responses;
  - one `cutype:'room'` attendee `Projector Suite <projector@rooms.example.invalid>`.

  It also exports those raw strings for the assertions.

**Tests, `tests/ai/helper.test.js` (Node, integration).** The whole file is skipped (`t.skip`, with the reason) when `gjs`, `dbus-daemon` or `gnome-keyring-daemon` is not on `PATH`. One session per `describe`, and every helper is killed in `afterEach` (the `helper.test.js` pattern).
1. **Hello:** the first line is exactly `{"type":"hello","protocol":1}`, within 5 s.
2. **Usage:** `gjs -m extension/ai/main.js --x` exits with code 2 and no signal. stderr contains `payattention-ai: usage`, and stdout is empty.
3. **EOF:**
   - closing stdin on an idle helper gives code 0 and no signal, within 5 s;
   - with a `{hold:true}` engine, after the engine has recorded the request, closing stdin also gives code 0 and no signal, within 5 s. This proves the exit path does not hang or dump core with a request in flight.
4. **Invite proof (D-020, D-022, D-024, D-025):** configure the fake engine, then send `judge` with `hostileInvite()`. The reply is `verdict must "fake engine"`. Exactly one request was recorded:
   - `POST /v1/chat/completions`, `content-type` starts with `application/json`, and there is **no `authorization` header** (keyless: no item in the throwaway keyring);
   - the body parsed deep-equals `JSON.parse(chatRequestBody(model, invite, true))`;
   - `messages[1].content === JSON.stringify(invite)`, and `Buffer.byteLength(messages[1].content) <= 8192`;
   - `Object.keys(JSON.parse(messages[1].content))` equals `INVITE_FIELDS.map(f => f.key)`.

   Then, on the recorded body text:
   - `'Family'`, `'Olga Organiser'`, `'olga@example.invalid'`, `'Guest 01'` and `'https://zoom.us/j/123456789'` are present;
   - `'?pwd='`, `'AbCdEf'`, `'123456'`, `'Projector Suite'` and `'projector@rooms.example.invalid'` are absent;
   - `'[removed]'` is present;
   - `guests.length === 25`, `guestsTotal === 30`, and `Array.from(description).length === 1500`;
   - there is no `tools`, `functions` or `stream` key.
5. **Probe:** `probe` with id `p1` gives a verdict. The recorded user content `=== JSON.stringify(PROBE_INVITE)`.
6. **Bad requests reach no engine:** an extra key, a missing key, or more than 8 192 bytes (the Step 5 invites, sent with `sendRaw` because `formatAiShellMessage` would refuse them) each give `failed bad-request` with the id. The engine's `requests.length` is unchanged.
7. **Privacy:** after the tests above, the helper's stderr contains none of the fixture strings (title, `Family`, the names, the emails, `fake engine`). Every stderr line that starts with `payattention-ai:` matches `/^payattention-ai: [a-z0-9][a-z0-9._-]*( [A-Za-z0-9 ._:[\]-]*)?$/`.

**Then (code):** write `ai/stdio.js`, `ai/transport.js`, `ai/keyring.js` and `ai/main.js` exactly as the Seams section says.
- **Why here:** they are the thin GNOME-facing shell around the pure decisions, as in the calendar helper. `exitSoon` and `watchStdin` are the proven patterns from `helper/`.
- **Behaviour change:** `gjs -m extension/ai/main.js` now exists and works. Nothing in the extension spawns it.

### Step 7 — Failure mapping against the fake engine  [feature]
- **Test first,** in `tests/ai/helper.test.js`, a `describe('failures')`. Each case queues a handler and sends one `judge`, then checks the one reply:
  - **Late:** configure with `timeoutMs 1500`, and a `{delayMs: 5000}` handler. The reply is `failed timeout`, with the time from send to reply between 1 400 and 2 500 ms (`timeoutMs + 1 s`, Layer 2b).
  - 401 → `auth`; 403 → `auth`.
  - 429 with `Retry-After: 7` → `{code:'rate-limited', retryAfterS:7}`; 429 without it → no `retryAfterS`; 402 → `rate-limited`.
  - 500 → `server`; 404 → `config`.
  - **302** with `Location: http://127.0.0.1:<engine port>/elsewhere` → `config`, and the engine recorded exactly one request (no redirect was followed).
  - **Closed port:** listen on `127.0.0.1:0`, note the port, and close it. Configure `http://127.0.0.1:<port>/v1` → `network`.
  - **Non-JSON body** → `bad-reply`. **A 2 MiB body** → `bad-reply` (`MAX_RESPONSE_BYTES`).
  - **Fenced JSON content** → verdict. **A leading `<think>` block** → verdict.
  - **The `response_format` 400:**
    - first a 400 with body `{"error":{"message":"response_format is not supported"}}`, then the default;
    - the reply is a verdict, and exactly 2 requests were recorded;
    - the first has `response_format`, the second does not, and they are otherwise equal;
    - a following `judge` records a request without `response_format`.
  - **TLS:** skipped unless `openssl` is on `PATH`.
    - Generate a throwaway self-signed certificate into the session home with `openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -days 1 -subj /CN=127.0.0.1`;
    - start `startFakeEngine({tls})`, and configure `https://127.0.0.1:<port>/v1`;
    - the reply is `failed tls`, and the engine recorded no request.
- **Then:** no new code should be needed. If a case fails, fix it in `chat.js` (mapping) or `transport.js` (classification), whichever owns it according to the Seams section.
- **Why here:** the Layer 2b failure list, proven through the real Soup stack.
- **Behaviour change:** none beyond Step 6.

### Step 8 — Injection corpus through the real process  [feature]
- **Test first:** in `tests/ai/helper.test.js`, one helper and one engine. For each `REPLY_CORPUS` entry `i`:
  - queue `{status:200, body: chatEnvelope(entry.text)}`, where `content` is the entry's value as is, even when it is not a string;
  - send `judge` with id `c<i>` and `PROBE_INVITE`-shaped data (use `PROBE_INVITE` itself);
  - the reply is `verdict` with `entry.expected`, or `failed bad-reply` when `expected` is null;
  - no reply line has any key besides those §6.6 allows, which `nextMessage` enforces through `parseAiHelperLine`.
- **Then:** nothing new. It must pass on Steps 4 to 6.
- **Why here:** Layer 2b says the same corpus runs against core (Layer 1, done in PG-4a) and against the helper. That proves "a reply can only pick a verdict" end to end.
- **Behaviour change:** none.

### Step 9 — The key path, headless, in a throwaway keyring  [feature]
- **Test first,** `tests/ai/keyring.test.js` (Node, integration). The same skip rule as Step 6. Two fake engines, `E1` and `E2`, and `K1 = throwawayKey()`.
  1. **Isolation:** after `storeKey(E1.endpoint, K1)`, `<home>/data/keyrings/` exists and holds a `.keyring` file. This proves the keyring is the throwaway one (fact 3).
  2. **Header sent over loopback `http:`:** start the helper with `{...env, G_MESSAGES_DEBUG: 'all'}`, and configure `E1`. A `judge` gives a verdict, and the recorded `authorization === 'Bearer ' + K1`.
  3. **Keyless:** a second helper configured to `E2` (no item) gives a verdict, and there is no `authorization` header.
  4. **No cross-endpoint leak:** `K1` does not appear anywhere in `E2`'s recorded headers or bodies.
  5. **The key never leaks from the helper:** `K1` is not in the stdout or stderr of the helpers from tests 2 and 3. The `G_MESSAGES_DEBUG=all` run makes this cover library debug output too.
  6. **Locked:** `lockKeyring()`, then a fresh helper configured to `E1`. A `judge` gives `failed no-key`, and `E1` recorded no new request. So a locked keyring never sends an unauthenticated request (ADR-0009 amendment), and nothing prompts.
  7. **Unreachable Secret Service:** a helper started with `unreachableEnv()` and configured to `E1` gives `failed no-key`, and `E1` recorded no new request.
- **Then:** no new code should be needed. If a case fails, fix it in `keyring.js`.
- **Why here:** Layer 2b's key test, now proven possible headless (facts 1 to 5).
- **Fallback, only if an environment cannot run `gnome-keyring-daemon`:** the suite skips, printing `keyring tests skipped: gnome-keyring-daemon not available; key path checked by hand (Layer 4)`. The hand check on the real session is:
  1. Run `node -e` with a one-shot `node:http` server on `127.0.0.1:<port>` that prints each request's `authorization` header and answers `chatEnvelope`.
  2. Store a throwaway value: `secret-tool store --label='payAttention hand check' xdg:schema org.gnome.shell.extensions.payattention.EngineKey endpoint http://127.0.0.1:<port>/v1`.
  3. Pipe a `configure` line for that endpoint and one `probe` line into `gjs -m extension/ai/main.js`.
  4. Check that the header shows `Bearer <that value>`, and that the value is in neither the helper's output nor `journalctl --user -b`.
  5. Clear it with `secret-tool clear xdg:schema org.gnome.shell.extensions.payattention.EngineKey endpoint http://127.0.0.1:<port>/v1`.

  On this machine the automated test runs, so the fallback is not the plan of record.
- **Behaviour change:** none beyond Step 6.

### Step 10 — Pack `ai/` into the build  [feature]
- **Test first:** in `scripts/build.sh`, right after the existing `test -f`, add the check first:
  ```bash
  unzip -Z1 dist/payattention@tonymalandain.github.io.shell-extension.zip | grep -qx 'ai/main.js' \
      || { echo "ai/ is missing from the zip" >&2; exit 1; }
  ```
  `npm run build` must fail with that message before the next line.
- **Then:** add `--extra-source=ai` to the `gnome-extensions pack` line, after `--extra-source=ui`. `npm run build` passes. `unzip -Z1` then lists `ai/chat.js`, `ai/keyring.js`, `ai/main.js`, `ai/service.js`, `ai/stdio.js` and `ai/transport.js`, and nothing from `tests/`.
- **Why here:** `testing-and-build.md` step 4, "From PG-4, also `--extra-source=ai`". Without the check, a missing `ai/` would pass every step until PG-4c.
- **Behaviour change:** the zip now contains `ai/`. The installed extension still never spawns it.

### Validation (after every step, and in full at the end)

In this order: `npm run lint`, `npm test` (992 plus the new cases, 0 failures), `npm run build`, `npm run test:helper` (the existing helper suites plus `tests/ai/**`), `npm run smoke`. Report the real output. `.test-home/ai-*` is git-ignored already (`.test-home/`).

## Callers to update

- **`eslint.config.js` changes** (Step 1): none of the existing code breaks. Grep shows no current import of Soup, Secret or `ai/` anywhere.
- **`tests/helper/isolatedEds.js`** (Step 2): `createIsolatedEds` and `killIsolatedCalendarFactory` keep their signatures. Their callers (`tests/helper/helper.test.js`) do not change.
- **`core/aiEngine.js`** (Step 3): additive exports; no caller changes.
- **`package.json` `test:helper`** (Step 4): the contract name is unchanged; it runs one more glob, as `testing-and-build.md` step 5 says.
- **`scripts/build.sh`** (Step 10): same command, same output file.
- **New protocol endpoint:** `ai/main.js` implements §6.6 as written. Its future callers are `shell/` in PG-4c and `prefs.js` in PG-4d; neither exists yet. PG-4d must write keys with `ENGINE_KEY_SCHEMA_NAME` and `ENGINE_KEY_ATTRIBUTE` from core, with the attribute value `normaliseEndpoint(endpoint)`.

## Out of scope

- The controller queue, retry, budget, status, spawning and watchdog (PG-4c), prefs and "Test connection" (PG-4d), and `--purge` (PG-4e).
- Anything in `core/` beyond the two constants in Step 3. In particular, do not "fix" `validateInvite`, `parseReply` or `buildInvite`. If one of them looks wrong, stop.
- Sharing `helper/stdio.js` with `ai/`. The boundary forbids the import, and a shared module is a boundary decision for the architect.
- A prompt to unlock the keyring. The helper never passes `SearchFlags.UNLOCK`.
- Retries of any kind other than the single `response_format` retry. Retries are the shell's (§6.5).
- Following redirects, streaming, tools, or any request other than one `POST …/chat/completions` per `judge` or `probe`.
- SPDX headers (PG-6), `README.md`, and any `docs/architecture/` edit (findings go to `docs/inbox.md`).
- Proxy settings: Soup's default system proxy resolver stays as it is.

## Stop and escalate if

- `Secret.Service.search` without `UNLOCK` does not return locked items as `get_locked() === true` (fact 4), or `gnome-keyring-daemon --unlock` with a non-empty phrase does not create the default collection. Then the keyring design or the test isolation is wrong. Do not fall back to `password_lookup`, which reads "locked" as "absent".
- Any test would need an endpoint that is not `127.0.0.1`, a real provider URL, or the real session bus.
- Any `ai/` module seems to need an import outside the Step 1 allowlist (for example `invite.js` or `protocol.js` directly).
- `validateInvite` refuses `PROBE_INVITE` or `hostileInvite()`, or `formatAiHelperMessage` refuses a reason that `parseReply` returned. That is a PG-4a contract bug: stop, do not patch core.
- The existing `npm run test:helper` count or results change after Step 2.
- Any library writes invite text, a reply or the key to the helper's stderr, for example under `G_MESSAGES_DEBUG=all`.
- `NO_REDIRECT` does not stop Soup following a 302, or a `Gio.Cancellable` does not end a stalled read within about 1 s of the deadline.
- `gnome-extensions pack` refuses `--extra-source=ai`, or the smoke fails after Step 10.
