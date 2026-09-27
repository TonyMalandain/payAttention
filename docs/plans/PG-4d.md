# Plan — PG-4d: the "Verdicts" settings page (mode, engine address, model, API key in the keyring, "Test connection", and the warning)

Spec: `docs/prd/meeting-guardian.md`, "Addendum 2026-09-27 — AI mode" (R-18, AI mode judges every meeting; R-19, the owner connects the engine of their choice). Product decisions D-019, D-020, D-021 and D-030 (the best-effort sentence). Architecture: ADR-0009 (keys in the GNOME keyring, both amendments), ADR-0010, `interfaces.md` §6.4 (endpoint rules) and §6.9 (the prefs section), `data.md` (the three AI keys, the keyring schema), `boundaries.md` (what `prefs.js` may import). The AI helper and its `probe` come from PG-4b (`docs/plans/PG-4b.md`).

**Sensitive: secrets, and personal data leaving the computer.**
- This is the only code that writes the API key. The key goes from a password entry straight into the GNOME keyring. It is never written to GSettings, never logged, never printed, never put back into any widget, and never read back by prefs. Prefs only asks the keyring *whether* an item exists; it never loads a secret.
- The warning is the owner's consent screen for D-020 (the whole invite goes to the engine). Its wording is the product's, verbatim, and a test pins it to the spec.
- Tests never touch the owner's real keyring, settings, bus or display. They run in PG-4b's throwaway session (`createAiSession`: `env -i`, throwaway `HOME`/`XDG_*`, private D-Bus, an unlocked throwaway keyring), with `GSETTINGS_BACKEND=memory` and a private GTK display (see "Facts measured").

## Depends on

PG-4b accepted and merged. This plan uses, unchanged: `extension/ai/main.js` and its `probe`; `extension/ai/chat.js` (`bearerFrom`, `MAX_KEY_LENGTH`); `ENGINE_KEY_SCHEMA_NAME` and `ENGINE_KEY_ATTRIBUTE` in `core/aiEngine.js`; the test harness `tests/ai/session.js` (`createAiSession`, `throwawayKey`), `tests/ai/fakeEngine.js` (`startFakeEngine`, `chatEnvelope`) and `tests/helper/isolatedEds.js` (`killOnPrivateBus`); and the lint rules of PG-4b Step 1 (prefs may import `gi://Secret`, not Soup, not `ai/`). If any of these is missing or has a different signature, stop (see the end).

## What changes, and for whom

The owner opens payAttention's settings and finds a third page, **Verdicts**. On it they can:
- pick who decides: **Rules** (the default) or **AI**;
- enter the engine's address and model name;
- save or remove an API key for that address;
- press **Test connection** and get a plain "Yes" or "No: <why>".

The page shows the spec's warning word for word. It also says, for the address entered, whether the invite stays on this computer or leaves it. The key is kept in the desktop keyring, per address. The key field never shows a saved key; it only says whether one is saved.

## The component

- **Responsible for:** `extension/prefs.js` is the settings window: it lets the owner edit their own settings (and, from this ticket, their AI engine key), and nothing the extension computes.
- **Has drifted by:** no drift today. Two facts shape the plan:
  1. **`prefs.js` has no tests at all.** It cannot be imported by plain gjs, because its base class comes from `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`, which only exists inside the Extensions app. Step 1 builds a harness that loads the real `prefs.js` with a stub base class, and pins today's pages before anything is added.
  2. **This ticket gives `prefs.js` two new jobs next to "build widgets":** writing to the keyring, and talking to the AI helper for one probe. They belong to prefs (ADR-0009 names prefs the only writer; `boundaries.md` lets prefs spawn `ai/main.js`). But they are GNOME I/O, not widget building. The plan keeps every *decision* (texts, what an address means, what a key may be, what the helper's lines mean) in a new pure core module, so `prefs.js` holds only widgets and thin I/O. A separate prefs directory would need `--extra-source`, a lint block and a `boundaries.md` change, so it is the architect's call: it goes to the inbox, not into this ticket.
- **This change belongs here because:** §6.9 and ADR-0009 put exactly this in `prefs.js`, and the settings window is where the owner edits the AI settings (`data.md`, "AI settings: owner prefs.js"). The pure part belongs in `core/`, which already owns the endpoint rules, the invite field list with its labels, and the AI protocol that prefs needs (`boundaries.md`: prefs may import core "for … the invite field list it shows, and the endpoint rules"). How `core/` is split into files is the senior engineer's call (`boundaries.md`, first paragraph).

## Facts measured for this plan (2026-09-27, gjs 1.88.1, GTK 4 / libadwaita 1.x, libsecret, gnome-keyring 50.0)

Each was run with throwaway probes in `/tmp`, outside the repository, in an `env -i` environment with a throwaway `HOME` and `XDG_RUNTIME_DIR` under `dbus-run-session`.

1. **The real `prefs.js` loads and fills a window outside the Extensions app** when a stub is registered at its base-class URI:
   - a stub module exporting `class ExtensionPreferences { constructor(metadata) {…} getSettings() {…} }`, compiled with `glib-compile-resources` into a `.gresource` whose prefix is `/org/gnome/Shell/Extensions/js/extensions` and file is `prefs.js`;
   - `Gio.Resource.load(<file>)._register()` before `await import('file://…/extension/prefs.js')`;
   - `Adw.init()`, `new Adw.PreferencesWindow()`, `await prefs.fillPreferencesWindow(window)`: the two current pages were added.
   - Loading the *real* Extensions-app resource instead does not work (it needs the app's private typelibs and services). Do not try.
2. **A private GTK display works headless:** `gtk4-broadwayd -u "$XDG_RUNTIME_DIR/<name>.sock" :5` with `GDK_BACKEND=broadway` and `BROADWAY_DISPLAY=:5`. Its display socket is created inside the private `XDG_RUNTIME_DIR`.
   - **Without `-u`, broadwayd opens an HTTP server on TCP `*:8085` (port 8080 + display), on every interface.** With `-u <socket>` there is no TCP listener (checked with `ss -ltn`). The `-u` flag is mandatory in the harness.
   - `GTK_A11Y=none` and `ADW_DISABLE_PORTAL=1` stop GTK and libadwaita from D-Bus-activating the accessibility bus and `xdg-desktop-portal` on the private bus (that activation only printed noise, but it starts processes).
3. **Widgets can be found and driven from a test script:** a recursive walk with `get_first_child()` / `get_next_sibling()` from the window finds rows by their `name` property, including rows inside another page's stack and inside an `Adw.ExpanderRow`. `row.emit('apply')` on an `Adw.EntryRow`, setting `comboRow.selected`, `buttonRow.emit('activated')`, `button.emit('clicked')` and `window.emit('close-request')` each run the connected handlers.
4. **Keyring behaviour (throwaway keyring):**
   - `Secret.Service.search_sync(schema, {}, Secret.SearchFlags.ALL, null)` without `LOAD_SECRETS` lists every item of a schema, locked or not, and `item.get_locked()` tells them apart. With `{endpoint}` it lists that address's items only.
   - `Secret.password_clear_sync(schema, attrs, null)` removes matching unlocked items only, and items of another schema with the same attribute are untouched. On a locked collection it returns `false`, with no error and no removal.
   - An unreachable Secret Service throws "Could not connect" (PG-4b fact 5).
5. **gjs does not promisify Gio or Secret async calls here.** Use the callback form wrapped in a `Promise`, as `shell/calendarFeed.js` and PG-3 do.

## Decisions made in this plan (reasoned; nobody could be asked mid-run)

1. **Everything acts on the applied values.** The address and the model are `Adw.EntryRow`s with an apply button, like the existing list rows. The key row, "Remove" and "Test connection" always use the *stored* `ai-endpoint` and `ai-model`. While the address or model row holds an unapplied edit, the key row, "Remove" and "Test connection" are insensitive. So "the fields as entered" (§6.9) and "the fields as stored" are always the same thing when a button can be pressed, and a key can never be saved against an address the owner is not looking at. Each keystroke is not written to the settings, because each write of `ai-endpoint` or `ai-model` makes the shell kill and respawn the AI helper and ends its pause (§6.5).
2. **Only a usable address is stored.** "Apply" on the address row writes `normaliseEndpoint(text)` when `isUsableEndpoint(text)` is true, and shows the normalised form back. Otherwise nothing is written, the row gets the `error` style class, and the line under it says why. An empty model is allowed (it means "AI is not set up", `data.md`). A non-empty model that `normaliseModel` refuses is not written.
3. **The warning is the spec's three sentences, verbatim, always shown.** §6.9 says the "leaves your computer" part depends on the address. That is met by a separate line for the address actually entered ("On this computer: the invite does not leave it." / "… leaves your computer."), worked out by core from the address. So the spec text is never edited, and the per-address fact is never missing. The labelled field list (`INVITE_FIELDS`, §6.9) is shown under the warning.
4. **The key rule is one rule, in core.** The helper refuses to send a stored key that is not 1 to 4 096 visible ASCII characters (`ai/chat.js`, PG-4b). Prefs must refuse to *save* such a key, or the owner saves a key that silently never works. Step 2 moves the rule into `core/aiEngine.js` (`isSendableKey`, `MAX_KEY_LENGTH`), and both sides import it. Leading and trailing whitespace (space, tab, CR, LF) of a pasted key is trimmed before the check; nothing else is changed.
5. **A key may be saved only where it may be sent** (`mayCarryKey`: `https:`, or `http:` to a loopback host). For `http:` to a private host the key row is insensitive and says why (ADR-0009, amendment 1: "prefs says so").
6. **Prefs never reads a secret.** The key status is a search without `LOAD_SECRETS` and without `UNLOCK`: it can tell "saved", "saved, but the keyring is locked", "none" and "keyring unreachable" apart without ever holding the key. Saving uses `Secret.password_store` into `Secret.COLLECTION_DEFAULT`, which replaces an item with the same attributes. A locked keyring may then show the desktop's unlock prompt: here the owner pressed the button, so that prompt is expected (ADR-0009 amendment 2 forbids prompts from the background helper only).
7. **"Test connection" is one short-lived helper.** Prefs spawns `gjs -m <extension dir>/ai/main.js`, writes `configure` and `probe` at once, reads lines until the answer, and then kills the helper with `force_exit()`. stdin stays open until then, because the helper exits at stdin EOF even with a request in flight (PG-4b). A watchdog of `timeoutMs + 10 000` ms (the shell's own watchdog, §6.5) ends a helper that never answers. Closing the window ends a running test and kills its helper. It is allowed in Rules mode too, so the owner can test before switching. It never sends calendar data: the helper's `probe` uses core's `PROBE_INVITE`.
8. **The page is a third `Adw.PreferencesPage` titled "Verdicts"** (icon `network-server-symbolic`, present in Adwaita), added after "Judgment". The spec calls it a section; a page keeps the warning, the field list and seven rows readable. The existing pages do not change.
9. **Texts other than the warning are decided here**, in plain words, and listed exactly below. The product may reword them later (a finding for product); a reword is a one-line change in core with its unit test.

## Seams

### `core/aiEngine.js` — two additions (Step 2)

```js
/** The longest API key that is ever sent, in characters (interfaces.md §6.7). */
export const MAX_KEY_LENGTH = 4096;

/**
 * Whether a stored key may be sent as a bearer token: a string of 1..MAX_KEY_LENGTH
 * characters, every one in U+0021..U+007E. Anything else could split a header.
 *
 * @param {*} key
 * @returns {boolean}
 */
export function isSendableKey(key)
```

Misuse made impossible: prefs and the helper can no longer disagree on which keys are usable.

### `core/aiSetup.js` — new, pure (Step 3)

Header comment (one sentence, the module's responsibility): "What the Verdicts settings tell the owner about AI mode: the warning, where an address sends the invite, what a key status or a key means, and what a Test connection run means (interfaces.md §6.9)." Imports only `./aiEngine.js` and `./aiProtocol.js`. No `gi://`, no I/O, no clock.

```js
/** The spec's warning, verbatim (PRD addendum 2026-09-27, D-020, D-030). */
export const AI_WARNING = 'In AI mode the whole invite is sent to this engine. With a cloud engine it leaves your computer. Passcodes and dial-in numbers are removed first, on a best-effort basis.';

/** The mode choices in the order the settings list them: index 0 "Rules", 1 "AI". */
export const VERDICT_SOURCES = Object.freeze([
    Object.freeze({ value: 'rules', label: 'Rules' }),
    Object.freeze({ value: 'ai', label: 'AI' }),
]);

/** The id of the one probe a Test connection run sends. */
export const PROBE_ID = 'test-connection';

/** Added to the engine's timeout for the Test connection watchdog, as the shell's watchdog (interfaces.md §6.5). */
export const PROBE_WATCHDOG_EXTRA_MS = 10000;

/**
 * @typedef {'saved'|'saved-locked'|'none'|'unavailable'|'no-address'} KeyState
 * @typedef {Readonly<{ok:boolean, text:string}>} ProbeResult
 */

/**
 * What the mode means right now.
 * @param {{verdictSource:*, aiEndpoint:*, aiModel:*}} settings
 * @returns {string}
 */
export function describeMode(settings)

/**
 * What an address means: where the invite goes, and whether a key may be saved for it.
 * @param {*} address as typed or as stored
 * @returns {Readonly<{endpoint:string|null, usable:boolean, keyAllowed:boolean, text:string}>}
 *   endpoint: normaliseEndpoint(address) (null when it is not an address at all);
 *   usable: isUsableEndpoint(address); keyAllowed: mayCarryKey(address)
 */
export function describeEndpoint(address)

/**
 * The key status line.
 * @param {KeyState} state
 * @param {boolean} keyAllowed describeEndpoint(stored address).keyAllowed
 * @returns {string}
 */
export function describeKey(state, keyAllowed)

/**
 * A key as pasted: trimmed of leading and trailing space, tab, CR and LF, then checked with isSendableKey.
 * @param {*} text
 * @returns {{ok:true, key:string} | {ok:false, text:string}}
 */
export function checkKey(text)

/**
 * What to write to a fresh AI helper for Test connection, or why it cannot run.
 * Uses aiEngine({verdictSource:'ai', aiEndpoint: address, aiModel: model}), so the
 * mode switch does not matter and every value is validated exactly as the shell does.
 * @param {*} address stored ai-endpoint
 * @param {*} model stored ai-model
 * @returns {{ok:true, input:string, watchdogMs:number} | {ok:false, result:ProbeResult}}
 *   input = formatAiShellMessage(configure) + formatAiShellMessage({type:'probe', id: PROBE_ID});
 *   configure = {type:'configure', protocol: AI_PROTOCOL_VERSION, endpoint, model, timeoutMs} from aiEngine;
 *   watchdogMs = timeoutMs + PROBE_WATCHDOG_EXTRA_MS
 */
export function probeInput(address, model)

/**
 * What the helper's stdout lines mean so far.
 * @param {string[]} lines every line read so far, in order, without the newline
 * @returns {ProbeResult|null} null while the answer is still to come
 */
export function probeResultFromLines(lines)

/**
 * The result when the helper stopped before probeResultFromLines gave one.
 * @param {'spawn-failed'|'exited'|'timed-out'} how
 * @returns {ProbeResult}
 */
export function probeResultWhenStopped(how)
```

Misuse made impossible:
- **No caller can compose a probe by hand.** `probeInput` is the only producer of the helper input. It validates through `aiEngine` and `formatAiShellMessage`, which throw on anything the helper would refuse.
- **One place interprets helper output.** `probeResultFromLines` takes the raw lines. The caller never parses JSON and never matches ids.
- **No text is built from input.** Every returned text is a constant from the tables below. No address, model, key, engine reply or reason is ever put into a text.

**The exact texts** (every string below is the whole string; a test checks each one):

`describeMode(settings)`:
| Condition | Text |
|---|---|
| `settings.verdictSource !== 'ai'` | `The rules decide. Nothing is sent anywhere.` |
| `'ai'` and `aiEngine(settings) === null` | `AI is not set up yet: enter a usable address and a model below. Until then the rules decide.` |
| `'ai'` and an engine | `The AI engine decides every meeting you can attend. If it cannot be reached, the rules decide.` |

`describeEndpoint(address).text`, checked in this order:
| Condition | Text |
|---|---|
| `normaliseEndpoint(address) === null` | `This is not a usable address. Use one like http://127.0.0.1:11434/v1 or https://api.example.com/v1.` |
| not usable (plain `http:` to a public host) | `Plain http:// is allowed only on this computer or your local network. Use https:// for this address.` |
| class `loopback` | `On this computer: the invite does not leave it.` |
| class `private`, scheme `https` | `On your local network: the invite leaves your computer.` |
| class `private`, scheme `http` | `On your local network: the invite leaves your computer. A key is never sent over plain http:// to another computer.` |
| class `public` (so `https`) | `On the internet: the invite leaves your computer.` |

The scheme is read from `endpoint.startsWith('https:')` on the normalised value.

`describeKey(state, keyAllowed)`:
| State | `keyAllowed` | Text |
|---|---|---|
| `no-address` | any | `Enter a usable address first.` |
| `unavailable` | any | `Could not reach your keyring, so it is not known whether a key is saved.` |
| `none` | true | `No key saved for this address. A local engine such as Ollama needs none.` |
| `none` | false | `No key. A key is never sent over plain http:// to another computer.` |
| `saved` | true | `A key is saved for this address.` |
| `saved-locked` | true | `A key is saved for this address, but your keyring is locked. Unlock it, or AI stays unavailable.` |
| `saved` or `saved-locked` | false | `A key is saved for this address, but it is never sent over plain http:// to another computer.` |

Two more exported constants, used by `prefs.js` after a failed keyring write:
```js
export const KEY_SAVE_FAILED = 'Could not save the key: the keyring refused it or could not be reached.';
export const KEY_REMOVE_FAILED = 'Could not remove the key: the keyring refused or could not be reached.';
```

`checkKey(text)`:
| Input | Result |
|---|---|
| not a string, or empty after trimming | `{ok:false, text:'Paste a key first. To remove the saved key, use Remove.'}` |
| trimmed, `isSendableKey` false | `{ok:false, text:'This key cannot be used: it must be 1 to 4096 plain ASCII characters with no spaces.'}` |
| trimmed, `isSendableKey` true | `{ok:true, key: <trimmed>}` |

`probeInput` when it cannot run (checked in this order):
| Condition | `result` |
|---|---|
| `!isUsableEndpoint(address)` | `{ok:false, text:'No: enter a usable address first.'}` |
| `normaliseModel(model) === null` | `{ok:false, text:'No: enter a model name first.'}` |

`probeResultFromLines(lines)`, in this order:
1. `lines.length === 0` → `null`.
2. `parseAiHelperLine(lines[0])` is not ok, or its message is not `hello` → `HELPER_BROKEN`.
3. `lines.length === 1` → `null`.
4. `r = parseAiHelperLine(lines[1])`:
   - `verdict` with `id === PROBE_ID` → `{ok:true, text:'Yes: the engine answered.'}`;
   - `failed` with `id === PROBE_ID` → `{ok:false, text: FAILURE_TEXT[code]}`;
   - anything else (not ok, another type, another id) → `HELPER_BROKEN`.
   Lines after the second are never read.

`HELPER_BROKEN` = `{ok:false, text:'No: the AI helper did not run correctly. Reinstall payAttention.'}` (module-private).

`FAILURE_TEXT` (exported, frozen, exactly the keys of `AI_FAILURE_CODES`):
| Code | Text |
|---|---|
| `timeout` | `No: the engine did not answer in time.` |
| `network` | `No: nothing answered at this address. Check that the engine is running and the address is right.` |
| `tls` | `No: the secure connection failed. The engine's certificate was not accepted.` |
| `auth` | `No: the engine refused the key. Check the API key saved for this address.` |
| `rate-limited` | `No: the engine says there were too many requests, or there is no quota left. Try again later.` |
| `server` | `No: the engine reported an error of its own. Try again later.` |
| `bad-reply` | `No: the engine answered, but not with a verdict. Check the model name, or try another model.` |
| `bad-request` | `No: the AI helper refused the test request. Reinstall payAttention.` |
| `no-key` | `No: the saved key could not be read, because your keyring is locked or unreachable. Unlock it and try again.` |
| `config` | `No: the engine refused the request. Check the address and the model name.` |

`probeResultWhenStopped(how)`:
| `how` | Result |
|---|---|
| `spawn-failed` | `{ok:false, text:'No: the AI helper could not be started. Check that gjs is installed.'}` |
| `exited` | `HELPER_BROKEN` |
| `timed-out` | `{ok:false, text: FAILURE_TEXT.timeout}` |

Every returned object is frozen.

### `prefs.js` — module-private functions (Steps 5 and 6)

None is exported. Each takes the *raw stored* address, and normalises and checks it inside, so no caller can store a key under an unnormalised or unsendable address.

```js
/** A new Secret.Schema(ENGINE_KEY_SCHEMA_NAME, Secret.SchemaFlags.NONE, {[ENGINE_KEY_ATTRIBUTE]: STRING}). Built per call: nothing at module scope. */
function engineKeySchema()

/**
 * Whether a key is saved for this address. Never loads a secret, never unlocks, never rejects.
 *   normaliseEndpoint(address) null                 -> 'no-address'
 *   Service.get or search fails                     -> 'unavailable'
 *   no item                                         -> 'none'
 *   at least one unlocked item                      -> 'saved'
 *   only locked items                               -> 'saved-locked'
 * @returns {Promise<import('./core/aiSetup.js').KeyState>}
 */
function keyState(address, cancellable)

/**
 * Stores key for this address in Secret.COLLECTION_DEFAULT, label
 * `payAttention AI engine key for ${endpoint}`. Never rejects.
 * @returns {Promise<boolean>} false, without any keyring call, when !mayCarryKey(address) or
 *          !isSendableKey(key); false when the keyring call fails; true when stored
 */
function storeKey(address, key, cancellable)

/**
 * Secret.password_clear for this address's items. Never rejects.
 * @returns {Promise<boolean>} false when normaliseEndpoint(address) is null or the call fails; true otherwise
 */
function removeKey(address, cancellable)

/**
 * One Test connection run (Decision 7). Never rejects.
 * @param {string} helperPath GLib.build_filenamev([this.path, 'ai', 'main.js'])
 * @returns {Promise<import('./core/aiSetup.js').ProbeResult|null>} null only when cancellable was cancelled
 */
function testConnection(helperPath, address, model, cancellable)

/**
 * The Verdicts page. Connects its own settings handlers; everything it starts is
 * cancelled through cancellable.
 * @returns {Adw.PreferencesPage}
 */
function verdictsPage(settings, helperPath, cancellable)
```

`fillPreferencesWindow` creates one `Gio.Cancellable`, keeps it as `window._aiCancellable` (next to `window._settings`), adds `verdictsPage(settings, GLib.build_filenamev([this.path, 'ai', 'main.js']), cancellable)` after the Judgment page, and connects `window` `close-request` to `() => { cancellable.cancel(); return false; }`.

New imports in `prefs.js`: `GLib from 'gi://GLib'`, `Secret from 'gi://Secret?version=1'`; from `./core/aiEngine.js`: `ENGINE_KEY_SCHEMA_NAME`, `ENGINE_KEY_ATTRIBUTE`, `normaliseEndpoint`, `mayCarryKey`, `isSendableKey`, `normaliseModel`; from `./core/aiProtocol.js`: `INVITE_FIELDS`; from `./core/aiSetup.js`: the exports above. The header comment of `prefs.js` gains: "…and the AI engine key, which it writes to the keyring and never reads back (ADR-0009)."

### Widget names (the test harness finds rows by these; they are part of the test contract)

| Name | Widget | Title / content |
|---|---|---|
| `payattention-verdicts` | `Adw.PreferencesPage` | title `Verdicts`, icon `network-server-symbolic` |
| `payattention-verdict-source` | `Adw.ComboRow` in group "Who decides" | title `Who decides`, model `Gtk.StringList` of the `VERDICT_SOURCES` labels, subtitle `describeMode(...)` |
| `payattention-ai-engine` | `Adw.PreferencesGroup` | title `AI engine`, description `AI_WARNING` |
| `payattention-ai-fields` | `Adw.ExpanderRow` | title `What is sent for each meeting`; one `Adw.ActionRow` per `INVITE_FIELDS` entry, title = its `label`, in order |
| `payattention-ai-endpoint` | `Adw.EntryRow` | title `Address`, `show_apply_button: true`, text = stored `ai-endpoint` |
| `payattention-ai-where` | `Adw.ActionRow` | title `Where the invite goes`, subtitle = `describeEndpoint(...).text` |
| `payattention-ai-model` | `Adw.EntryRow` | title `Model`, `show_apply_button: true`, text = stored `ai-model` |
| `payattention-ai-key` | `Adw.PasswordEntryRow` | title `API key for this address`, `show_apply_button: true`, text always `''` except while the owner types |
| `payattention-ai-key-status` | `Adw.ActionRow` | title `Saved key`, subtitle = `describeKey(...)` or a failure text; suffix `Gtk.Button` named `payattention-ai-key-remove`, label `Remove`, `valign: CENTER` |
| `payattention-ai-test` | `Adw.ButtonRow` | title `Test connection` |
| `payattention-ai-test-result` | `Adw.ActionRow` | title `Connection`, subtitle `Not tested yet.` / `Testing…` / a `ProbeResult.text`; style class `success` when ok, `error` when not |

Order in the "AI engine" group: fields, endpoint, where, model, key, key-status, test, test-result. The combo row sits alone in a first group titled `Who decides`, with no description.

## Steps

Steps 1 and 2 are **repair: they must not change any behaviour**. Step 1 adds tests of what `prefs.js` does today. Step 2 moves one rule and leaves every existing test green, with the same counts. Steps 3 to 7 are the feature, each test first. Land each step as its own commit, in this order.

Every new file starts with the two SPDX lines used across the repository (`// SPDX-License-Identifier: Apache-2.0`, `// SPDX-FileCopyrightText: 2026 Tony Malandain`); `tests/unit/licensing.test.js` checks it.

### Step 1 — A harness that runs the real `prefs.js`, and today's pages pinned  [repair]

- **Test support (new):**
  - `tests/ai/gjs/stubExtensionPreferences.js` (gjs). It exports `class ExtensionPreferences`:
    - `constructor(metadata)` stores `this.metadata = metadata`;
    - `get path()` returns `this.metadata.path`;
    - `getSettings()` returns `new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.payattention' })`.

    Nothing else: `prefs.js` uses only `path` and `getSettings()`. If it ever uses more, the harness fails loudly, which is the point.
  - `tests/ai/prefsSession.js` (Node):
    ```js
    /**
     * createAiSession(name) (PG-4b: throwaway home, private bus, unlocked throwaway keyring,
     * GSETTINGS_BACKEND=memory), plus:
     *  - `glib-compile-schemas --strict --targetdir=<home>/schemas extension/schemas`;
     *  - the stub compiled with `glib-compile-resources --sourcedir=tests/ai/gjs --target=<home>/prefs-stub.gresource <home>/prefs-stub.gresource.xml`,
     *    where the XML (written by this function) has prefix "/org/gnome/Shell/Extensions/js/extensions"
     *    and `<file alias="prefs.js">stubExtensionPreferences.js</file>`;
     *  - `gtk4-broadwayd -u <env.XDG_RUNTIME_DIR>/broadway-http.sock :5` spawned with env, awaited
     *    until <env.XDG_RUNTIME_DIR>/broadway6.socket exists (poll 50 ms, up to 5 s);
     *  - env gains GSETTINGS_SCHEMA_DIR, GDK_BACKEND=broadway, BROADWAY_DISPLAY=:5, GTK_A11Y=none,
     *    ADW_DISABLE_PORTAL=1, PAYATTENTION_PREFS_STUB=<gresource path>.
     * @returns {Promise<{home:string, env:object,
     *   runDriver:(scenario:string, args?:string[], extraEnv?:object) => Promise<{status:number, steps:object[], output:string}>,
     *   stop:() => Promise<void>}>}   // stop: SIGTERM broadwayd and await it, then the session's stop()
     */
    export async function createPrefsSession(name)
    /** Every program the prefs tests need: gjs, dbus-daemon, gnome-keyring-daemon, gtk4-broadwayd, glib-compile-resources, glib-compile-schemas. */
    export function missingPrefsPrograms()   // -> string[]
    ```
    `runDriver` runs `gjs -m tests/ai/gjs/prefsDriver.js <scenario> ...args` with the session env (plus `extraEnv`), a 60 s timeout, and collects stdout and stderr together as `output`. `steps` holds `JSON.parse` of every stdout line starting `PREFS-STEP `, in order. The broadwayd socket name is `broadway<display + 1>.socket` (measured: display `:7` gave `broadway8.socket`), so for `:5` it is `broadway6.socket`.
  - `tests/ai/gjs/prefsDriver.js` (gjs):
    - It registers `PAYATTENTION_PREFS_STUB` with `Gio.Resource.load(path)._register()`, then `await import()`s `extension/prefs.js` (the path comes from `import.meta.url`).
    - It calls `Adw.init()`, then creates `new Adw.PreferencesWindow()` and `new Prefs({ uuid: 'payattention@tonymalandain.github.io', path: <extension dir> })`, and awaits `fillPreferencesWindow(window)`.
    - `find(name)`: the recursive walk of fact 3. A missing widget throws `widget not found: <name>`.
    - `waitFor(predicate, timeoutMs, what)`: polls every 50 ms from a `GLib.timeout_add`; throws `timed out: <what>`.
    - `step(object)`: prints `PREFS-STEP ` + `JSON.stringify(object)`.
    - The scenario runs inside `GLib.idle_add` while a `GLib.MainLoop` runs. On success it prints `PREFS-DRIVER DONE` and calls `System.exit(0)`; on a thrown error it prints `PREFS-DRIVER FAIL <message>` and calls `System.exit(1)`, from inside the callback. This is the `serviceStartOrder.js` pattern.
    - **It never prints a key.** Keys arrive as argv; every check on them happens inside the driver, and only booleans are printed.
- **Test first:** `tests/ai/prefs.test.js` (Node, `node:test`). The whole file is skipped (`t.skip` with the list) when `missingPrefsPrograms()` is not empty. There is one session per `describe` and `stop()` runs in `after`.
  - Scenario `existing`, run by `describe('the pages that existed before PG-4d')`:
    - the window has pages titled `Alerts` and `Judgment`, in that order (walk `Adw.PreferencesPage` children, print their titles);
    - finding the `Snooze (minutes)` spin row by title and setting `value = 7` makes `settings.get_int('snooze-minutes') === 7`;
    - on the `Your email domains …` list row, setting text `' Acme.TEST , b.test'` and emitting `apply` stores `['acme.test', 'b.test']` (whatever `normalizeDomains` gives today: print what is stored, and assert in Node against `normalizeDomains(parseList(...))` imported from core);
    - activating the `Clear travel times` button row resets `travel-times` after it was set to `{'hq': 30}`.

    The driver finds these rows by title, because they have no names; do not add names to existing rows in this step.

  This step changes no production code. The test must pass as soon as the harness is complete. If it cannot pass without changing `prefs.js`, stop: fact 1 no longer holds.
- **Why here:** `prefs.js` is about to grow by a whole page. It needs a test home first, and `tests/ai/` already owns the throwaway keyring session that Step 5 needs.
- **Behaviour change:** none.

### Step 2 — The key rule lives in core, used by the helper  [repair]

- **Test first:** in `tests/unit/aiEngine.test.js`, a `describe('isSendableKey')`:
  - `MAX_KEY_LENGTH === 4096`;
  - `'sk-test'` → true; 4 096 × `'a'` → true; `'!'` and `'~'` → true;
  - `''` → false; 4 097 × `'a'` → false; `'a b'`, `'a\tb'`, `'a\nb'`, `'é'`, `'a\u007f'` and `' '` → false; `null`, `undefined`, `42` and `['k']` → false.

  They fail first with "not exported".
- **Then:** add `MAX_KEY_LENGTH` and `isSendableKey` to `extension/core/aiEngine.js`, after `ENGINE_KEY_ATTRIBUTE`. In `extension/ai/chat.js`:
  - delete its own `MAX_KEY_LENGTH` constant and its per-character check;
  - import both from `../core/aiEngine.js`;
  - `bearerFrom` uses `isSendableKey(key)` for the "1..MAX_KEY_LENGTH chars, every char in U+0021..U+007E" row;
  - keep `MAX_KEY_LENGTH` in chat.js's public surface with `export { MAX_KEY_LENGTH } from '../core/aiEngine.js';`, so no importer of chat.js changes.
- **Green before and after:** `npm run lint`, `npm test` (plus the new cases) and `npm run test:helper` (same count). `tests/ai/chat.test.js`'s `bearerFrom` cases are the guard.
- **Why here:** `aiEngine.js` owns "how the engine is addressed and what may be sent to it" (it already owns `mayCarryKey`). Both prefs and `ai/` may import it.
- **Behaviour change:** none.

### Step 3 — `core/aiSetup.js`: every decision the page makes, as values  [feature]

- **Test first:** `tests/unit/aiSetup.test.js` (Node).
  - **`AI_WARNING` is the spec's text:** read `docs/prd/meeting-guardian.md` and assert it includes `'"' + AI_WARNING + '"'`. Also assert that `AI_WARNING` includes `'Passcodes and dial-in numbers are removed first, on a best-effort basis.'` (D-030).
  - **`VERDICT_SOURCES`:** the values are exactly `['rules', 'ai']`, and equal the `<choices>` of `verdict-source` in the schema XML (read the file; `tests/unit/schema.test.js` shows how it is parsed).
  - **`describeMode`:** one test per row, using `DEFAULT_SETTINGS` spread with `verdictSource` and `aiModel`.
  - **`describeEndpoint`:** one test per row, plus the fields:
    - `'HTTP://LOCALHOST:11434/v1/'` → endpoint `'http://localhost:11434/v1'`, usable, keyAllowed, loopback text;
    - `'http://10.0.0.5:8080/v1'` → usable, not keyAllowed, private-http text;
    - `'https://gpu.lan/v1'` → private-https text, keyAllowed;
    - `'https://api.example.test/v1'` → internet text;
    - `'http://api.example.test/v1'` → endpoint not null, not usable, not keyAllowed, refused text;
    - `'ftp://x'`, `''`, `null` and `'https://user@host/v1'` → endpoint null, invalid text.
  - **`describeKey`:** every row of its table.
  - **`checkKey`:** `'  sk-test \n'` → `{ok:true, key:'sk-test'}`; `''`, `'   '` and `null` → the "Paste a key first" result; `'a b'`, `'é'` and 4 097 × `'a'` → the "cannot be used" result.
  - **`probeInput`:**
    - `('http://127.0.0.1:11434/v1', 'llama3')`: `input` equals `formatAiShellMessage({type:'configure', protocol:1, endpoint:'http://127.0.0.1:11434/v1', model:'llama3', timeoutMs:90000}) + formatAiShellMessage({type:'probe', id:'test-connection'})`, and `watchdogMs === 100000`;
    - `('https://api.example.test/v1', 'm')`: `timeoutMs 45000`, `watchdogMs 55000`;
    - `('http://api.example.test/v1', 'm')` → "enter a usable address first";
    - `('http://127.0.0.1:11434/v1', '')` → "enter a model name first";
    - the input contains no key: `'Authorization'`, `'Bearer'` and `'key'` are absent from `input`.
  - **`probeResultFromLines`,** with lines built by `formatAiHelperMessage(...).trimEnd()`:
    - `[]` → null; `[hello]` → null;
    - `[hello, verdict test-connection]` → the "Yes" result;
    - `[hello, failed test-connection <code>]` → `FAILURE_TEXT[code]`, for every code in `AI_FAILURE_CODES`;
    - `[hello, failed rate-limited with retryAfterS 7]` → the rate-limited text;
    - `['not json']`, `['{"type":"hello","protocol":2}']` and `[verdict …]` first → `HELPER_BROKEN`;
    - `[hello, hello]`, `[hello, verdict other-id]` and `[hello, 'garbage']` → `HELPER_BROKEN`;
    - `[hello, verdict test-connection, 'garbage']` → "Yes" (lines after the second are never read).
  - **`FAILURE_TEXT`:** its keys equal `AI_FAILURE_CODES` (same set), and every value starts with `'No: '`.
  - **`probeResultWhenStopped`:** each row.
  - **Frozen:** every returned object is frozen.

  All of them fail first because the module is missing.
- **Then:** write `extension/core/aiSetup.js` exactly as the Seams section says. Add one line to `tests/unit/support/gjs-core-check.js`: import `probeInput` from `aiSetup.js` and `check(probeInput('http://127.0.0.1:11434/v1', 'm').ok, 'aiSetup')`, so core still runs under gjs.
- **Why here:** these are decisions with no GNOME in them. As values they are one-line tests, and `prefs.js` only shows them.
- **Behaviour change:** new module; nothing uses it yet.

### Step 4 — The Verdicts page: mode, address, model, the warning and what is sent  [feature]

- **Test first,** in `tests/ai/prefs.test.js`, `describe('the Verdicts page')`. Each scenario below is a driver scenario. The driver prints what it sees, and Node asserts it.
  - **Scenario `layout`:**
    - the pages are `Alerts`, `Judgment` and `Verdicts`, in that order;
    - the `payattention-ai-engine` group's description `=== AI_WARNING` (Node imports it from core);
    - the `payattention-ai-fields` rows' titles equal `INVITE_FIELDS.map(f => f.label)`;
    - the `payattention-ai-endpoint` text is `'http://127.0.0.1:11434/v1'` (the schema default);
    - the `payattention-ai-model` text is `''`, and the `payattention-ai-key` text is `''`;
    - the `payattention-ai-where` subtitle is the loopback text;
    - the `payattention-verdict-source` selected index is 0, and its subtitle is the "rules decide" text;
    - the `payattention-ai-test-result` subtitle is `Not tested yet.`
  - **Scenario `mode`:**
    - setting `selected = 1` stores `verdict-source 'ai'`, and the subtitle becomes the "not set up" text;
    - setting the model row to `'llama3'` and emitting `apply` stores `ai-model 'llama3'`, and the subtitle becomes the "AI engine decides" text;
    - `settings.set_string('verdict-source', 'rules')` from the driver makes `selected` 0, and the subtitle the "rules decide" text;
    - setting `selected = 1` twice in a row writes the setting once: count `changed::verdict-source` signals in the driver; the count is 1.
  - **Scenario `endpoint`:** for each input, set the row text, emit `apply`, and print the stored value, the row text, whether the row has the `error` class, and the where-subtitle.
    - `'HTTP://LOCALHOST:11434/v1/'` → stored `'http://localhost:11434/v1'`, row text the same, no `error`, loopback text;
    - `'http://api.example.test/v1'` → the stored value is unchanged from the previous line, the row keeps the typed text, `error` is set, refused text;
    - `'ftp://x'` → unchanged, `error`, invalid text;
    - `'https://api.example.test/v1'` → stored, no `error`, internet text;
    - `'http://10.0.0.5:8080/v1'` → stored, private-http text.
    - **Unapplied edit:** after the last apply, set the endpoint row text to `'http://127.0.0.1:1/v1'` *without* `apply`. Then the `payattention-ai-key`, `payattention-ai-key-remove` and `payattention-ai-test` widgets are insensitive (`get_sensitive() === false`). Setting the text back to the stored value makes the test row sensitive again. The same holds for the model row.
    - A model of 201 × `'m'` with `apply` → not stored, `error` set.
  - **Scenario `nothing-else-written`:** after `layout`, `mode` and `endpoint` style edits, the only keys that differ from their defaults are `verdict-source`, `ai-endpoint` and `ai-model`. Walk `settings.settings_schema.list_keys()` and compare `get_value(k)` with `get_default_value(k)`.

  They fail first: there is no Verdicts page.
- **Then, in `prefs.js`:**
  - Add `verdictsPage(settings, helperPath, cancellable)` and the `fillPreferencesWindow` wiring from the Seams section. In this step the key and test rows exist and are wired only for sensitivity (Steps 5 and 6 fill them in).
  - **Mode combo:**
    - `selected` = the index of `settings.get_string('verdict-source')` in `VERDICT_SOURCES` (0 when not found);
    - `notify::selected` → `const value = VERDICT_SOURCES[row.selected].value; if (settings.get_string('verdict-source') !== value) settings.set_string('verdict-source', value);`;
    - `settings` `changed::verdict-source` → set `selected` when it differs, and refresh the subtitle.
  - **Address row `apply`:**
    - `const d = describeEndpoint(row.text)`;
    - if `d.usable`: `settings.set_string('ai-endpoint', d.endpoint)`, `row.text = d.endpoint`, `row.remove_css_class('error')`;
    - else: `row.add_css_class('error')`, and the where-row subtitle becomes `d.text`. Nothing is stored.
  - **Model row `apply`:**
    - `const t = row.text.trim()`;
    - `''` → store `''`;
    - else `const m = normaliseModel(t)`; `m === null` → `error` class, nothing stored; otherwise store `m`, `row.text = m`, remove `error`.
  - **`settings` `changed::ai-endpoint` and `changed::ai-model`** → one `refresh()` inside `verdictsPage`:
    - it sets the where-subtitle from the stored address;
    - it sets the mode subtitle from `describeMode({verdictSource, aiEndpoint, aiModel})` read from settings;
    - it sets the test result back to `Not tested yet.` and removes `success` and `error`;
    - from Step 5, it also refreshes the key status;
    - it updates sensitivity.
  - **Sensitivity** (one function, `updateSensitivity()`, called from `refresh()` and from both entry rows' `changed` signal):
    - `editing = endpointRow.text !== settings.get_string('ai-endpoint') || modelRow.text !== settings.get_string('ai-model')`;
    - test row sensitive = `!editing && !testRunning`;
    - key row and Remove sensitive = `!editing && describeEndpoint(stored).keyAllowed` (Remove additionally needs a saved state, Step 5).
  - Signal handlers on `settings` are connected once per window. They are not disconnected: `settings` lives and dies with the window (`window._settings`), as today.
- **Why here:** prefs owns editing these three settings (`data.md`). Every decision comes from core.
- **Behaviour change:** a new page. The three AI settings can now be edited. No other key is touched (tested).

### Step 5 — The API key: save, status, remove, in the keyring only  [feature]

- **Test first,** `describe('the API key')`, scenario `key`. Node passes `K1 = throwawayKey()`, `K2 = throwawayKey()` and the other test values as argv, and runs the driver with `extraEnv {G_MESSAGES_DEBUG: 'all'}`, so library debug output is covered too. In the driver, in this order:
  1. Store `ai-endpoint` `'https://engine-one.example.test/v1'` through the address row (`apply`). No network is used: prefs never connects to the address. The key status is `describeKey('none', true)`, after `waitFor` the status to leave the initial empty text.
  2. **Save:** set the key row text to `'  ' + K1 + '\n'` and emit `apply`.
     - Right after `emit` returns (synchronously), the key row text is `''`.
     - `waitFor` the status `describeKey('saved', true)`.
     - A direct `Secret.Service.search_sync(schema, {endpoint:'https://engine-one.example.test/v1'}, ALL | LOAD_SECRETS)` in the driver finds exactly one item. Its secret text `=== K1` (trimmed), its label is `payAttention AI engine key for https://engine-one.example.test/v1`, and its attributes include `endpoint: 'https://engine-one.example.test/v1'`. Print only booleans.
  3. **Not in settings:** for every key in `settings.settings_schema.list_keys()`, `settings.get_value(k).print(true)` does not contain `K1`.
  4. **Never shown back:** a walk of every widget in the window finds no `text`, `title`, `subtitle`, `label` or `description` property containing `K1`. Also build a second window with a second `fillPreferencesWindow` and repeat the walk.
  5. **Per address:** apply `'https://engine-two.example.test/v1'` → status `none`. Apply `'https://engine-one.example.test/v1'` again → status `saved`.
  6. **Replace:** save `K2` for engine-one → still exactly one item for that address, and its secret `=== K2`.
  7. **Refused keys are not stored:** set `'a b'` and `apply` → the status subtitle is the `checkKey` "cannot be used" text, the key row keeps its text, and there is still one item with secret `K2`. Then set `''` and `apply` → the "Paste a key first" text.
  8. **Remove:** click `payattention-ai-key-remove` → `waitFor` status `none`. The search finds zero items for engine-one. Remove is insensitive when the status is `none`.
  9. **Where no key may go:** apply `'http://10.0.0.5:8080/v1'` → the key row and Remove are insensitive, and the status is `describeKey('none', false)`. Emitting `apply` on the key row anyway with a text stores nothing (a search over the whole schema, `{}`, counts the same before and after).
  10. **Other items are never touched:** before step 1, the driver stores an item under schema `org.example.payattention-test.Other` with attribute `endpoint: 'https://engine-one.example.test/v1'`. After step 8 it is still there, with its secret unchanged.
  11. **Locked:** save `K1` for engine-one, then lock every collection (`service.lock_sync(service.get_collections(), null)`). Apply engine-two then engine-one again (to trigger a refresh) → status `describeKey('saved-locked', true)`. This step comes last, because the keyring stays locked.
  12. **Unreachable:** a separate run of scenario `key-unreachable`, with `extraEnv {DBUS_SESSION_BUS_ADDRESS: 'unix:path=<home>/no-bus'}`. Prefs then fails to reach the keyring, so the status is `describeKey('unavailable', true)`. That run needs no display change: broadway does not use D-Bus.

  In Node, after the `key` run: `output` (all of the driver's stdout and stderr, with `G_MESSAGES_DEBUG=all`) contains neither `K1` nor `K2`.

  It fails first: the key rows do nothing.
- **Then, in `prefs.js`:**
  - Write `engineKeySchema`, `keyState`, `storeKey` and `removeKey` as the Seams section says. Each keyring call uses the callback form wrapped in a `Promise`, with `cancellable`. `keyState` uses `Secret.Service.get(Secret.ServiceFlags.NONE, …)`, then `service.search(schema, {[ENGINE_KEY_ATTRIBUTE]: endpoint}, Secret.SearchFlags.ALL, …)`. Never `LOAD_SECRETS`, never `UNLOCK`.
  - **Key status refresh** (`refreshKey()`, called from `refresh()` and after save and remove):
    - a generation counter `keyGeneration` is incremented on each call;
    - it awaits `keyState(storedAddress, cancellable)`, and ignores the answer when the generation has moved on or `cancellable` is cancelled;
    - it sets the subtitle to `describeKey(state, describeEndpoint(stored).keyAllowed)`;
    - Remove is sensitive only for `saved` and `saved-locked`, and only when not editing.
  - **Key row `apply`:**
    - `const c = checkKey(row.text)`. If not ok, the status subtitle is `c.text`, the `error` class is added to the key row, and the text is kept (it is masked). Return.
    - Otherwise set `row.text = ''` **before any await**, remove `error`, and make the key row insensitive.
    - `const ok = await storeKey(settings.get_string('ai-endpoint'), c.key, cancellable)`.
    - Make the row sensitive again (via `updateSensitivity()`), then `refreshKey()`. When `ok` is false, the subtitle is `KEY_SAVE_FAILED` instead, and `refreshKey` is not called.
    - `c.key` is not kept anywhere after the call: no field, no closure outside this handler.
  - **Remove `clicked`:** `await removeKey(stored, cancellable)`, then `refreshKey()`, or `KEY_REMOVE_FAILED` when it returned false.
  - Nothing is logged in any of these paths.
- **Why here:** ADR-0009 makes prefs the only writer. Each function takes the raw stored address and checks it itself (Seams), so the key can only ever be stored under `normaliseEndpoint` of an address where `mayCarryKey` holds.
- **Behaviour change:** the owner can save and remove a key per address. It is stored only in the keyring.

### Step 6 — Test connection  [feature]

- **Test first,** `describe('Test connection')`. It uses the real `extension/ai/main.js` against PG-4b's fake engine on `127.0.0.1`: never a real engine. Node starts `E = await startFakeEngine()` and passes `E.endpoint` (`http://127.0.0.1:<port>/v1`) as argv. Each driver click waits until the result subtitle is neither `Testing…` nor `Not tested yet.` (timeout 20 s).
  - **Scenario `probe`,** with Node first calling `E.queue({status: 401, body: '{}'})`:
    1. Apply `E.endpoint` and model `'test-model'`. Click Test.
       - While it runs, the subtitle is `Testing…` and the test row is insensitive.
       - The result is `FAILURE_TEXT.auth`, with the `error` class.
    2. Click Test again (the queue is now empty, so the default verdict comes back) → `Yes: the engine answered.`, with the `success` class.
    3. Save `K = throwawayKey()` for `E.endpoint` (loopback, so a key is allowed). Click Test → Yes.
    4. Apply `http://127.0.0.1:<closed port>/v1` (Node listens on port 0, notes the port, and closes it) → `FAILURE_TEXT.network`.
    5. Apply model `''` → click Test → `No: enter a model name first.` At once, with no helper spawned.

    **In Node, after the run:**
    - `E.requests.length === 3`;
    - every request is `POST /v1/chat/completions`, and its user message content `=== JSON.stringify(PROBE_INVITE)`, so no calendar data was sent;
    - requests 0 and 1 have no `authorization` header, and request 2 has `authorization === 'Bearer ' + K`. This proves the key prefs writes is the key the helper reads: one stored format.
    - `output` does not contain `K`.
  - **Scenario `broken-helper`:** the driver builds `Prefs` with `path` = a directory under the session home that has no `ai/` inside. Apply `E.endpoint` and a model, then click Test → `No: the AI helper did not run correctly. Reinstall payAttention.`
  - **Scenario `close-while-testing`,** with `E.queue({hold: true})`:
    - apply `E.endpoint` and a model, and click Test;
    - the driver waits until `E.requests` grows: it polls a file Node writes. **Decided:** Node passes a path; after `E.requests.length` grows, Node writes `seen` into it. The driver `waitFor`s the file (up to 15 s);
    - then `window.emit('close-request')`, wait 500 ms, and finish.
    - **In Node:** after the driver exits, `killOnPrivateBus(session.env, 'gjs') === 0`. No gjs process is left on the private bus, so the helper was killed.
  - **The watchdog** is not run end to end (loopback gives `timeoutMs` 90 000 ms). Its value is unit-tested (`watchdogMs`, Step 3), and its effect is `probeResultWhenStopped('timed-out')`, also unit-tested.

  It fails first: the Test button does nothing.
- **Then, in `prefs.js`, `testConnection(helperPath, address, model, cancellable)`:**
  1. `const p = probeInput(address, model)`; if `!p.ok`, return `p.result`.
  2. `const run = new Gio.Cancellable()`. A `cancellable.connect(() => finish(null))` makes the outer cancellable end this run (disconnect it in `finish`).
  3. `proc = Gio.Subprocess.new(['gjs', '-m', helperPath], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE)`. stderr is inherited, as for the calendar helper; the AI helper writes only codes there. A throw → return `probeResultWhenStopped('spawn-failed')`.
  4. Write `p.input` with `get_stdin_pipe().write_bytes_async(new GLib.Bytes(new TextEncoder().encode(p.input)), GLib.PRIORITY_DEFAULT, run, cb)`. A write error → `finish(probeResultWhenStopped('exited'))`. **Do not close stdin.**
  5. Read with `new Gio.DataInputStream({base_stream: proc.get_stdout_pipe(), close_base_stream: true})` and `read_line_async` / `read_line_finish_utf8` in a loop (the `calendarFeed.js` `_readNext` pattern):
     - push each line;
     - `const r = probeResultFromLines(lines)`; when `r` is not null, `finish(r)`;
     - at EOF (`null`), `finish(probeResultWhenStopped('exited'))`;
     - a read error that is not `CANCELLED`, the same.
  6. Watchdog: `GLib.timeout_add(GLib.PRIORITY_DEFAULT, p.watchdogMs, …)` → `finish(probeResultWhenStopped('timed-out'))`.
  7. **`finish(result)` runs once** (a `done` flag):
     - it removes the watchdog source if still pending;
     - it cancels `run` and disconnects from `cancellable`;
     - it calls `proc.force_exit()`;
     - it resolves the promise with `result`.

  It is the only exit from `testConnection`, so every path kills the helper and removes the timer.
  - **The Test row `activated`:**
    - if a run is in progress, return;
    - set `testRunning = true`, `updateSensitivity()`, subtitle `Testing…`, and remove `success`/`error`;
    - note `const generation = ++testGeneration`;
    - `const r = await testConnection(helperPath, settings.get_string('ai-endpoint'), settings.get_string('ai-model'), cancellable)`;
    - set `testRunning = false`;
    - if `r === null`, or `generation !== testGeneration` (settings changed during the run: `refresh()` increments `testGeneration`), leave the subtitle as `refresh()` set it;
    - else set the subtitle to `r.text`, add `success` when `r.ok`, else `error`;
    - `updateSensitivity()`.
- **Why here:** §6.9 puts the probe in prefs, and `boundaries.md` allows prefs to spawn `ai/main.js`. The decisions are core's (Step 3); this is the thin I/O around them.
- **Behaviour change:** Test connection works and gives Yes or No with the reason.

### Step 7 — README  [feature, docs]

In `README.md`, add a section `## AI mode (optional)` directly after `## How it decides`, in plain sentences:
- By default the rules above decide. In **Settings → Verdicts** you can let an AI engine decide instead.
- Enter the engine's address and model. For Ollama on this computer, the address is already filled in (`http://127.0.0.1:11434/v1`); enter a model you have pulled, for example the one `ollama list` shows. For a cloud service, enter its `https://` address, model and API key.
- Press **Test connection**. It sends a made-up test meeting, never one of yours, and says Yes, or No with the reason.
- The API key is kept in your desktop keyring (Passwords and Keys), one per address, never in the settings. The key field never shows a saved key.
- Then the warning, as a quote, verbatim: `AI_WARNING`.
- One sentence: the Verdicts page shows whether the address you entered is on this computer or not, and lists every field that is sent.
- One sentence: if the engine cannot be reached, the rules decide, and the menu says "AI unavailable — using rules". (This behaviour is PG-4c's. If PG-4c has not landed when this step is written, keep the sentence anyway: it is the spec's behaviour.)

**Behaviour change:** documentation only.

### Step 8 — Findings for the architect and product  [docs]

Append to `docs/inbox.md` (do not edit `docs/architecture/` or `docs/product/`):

```
## 2026-09-27 — for-architecture — PG-4d settings page
- prefs.js now holds three jobs: widgets, the keyring writer, and a one-shot AI helper client for Test connection. All decisions are in core/aiSetup.js, but the GNOME I/O sits in prefs.js because a separate prefs module would need a new directory, --extra-source and a lint block. Worth deciding whether prefs gets a directory.
- interfaces.md §6.9 "configure from the fields as entered": built as "the applied fields". The key row, Remove and Test connection are insensitive while the address or model has an unapplied edit, so a key can never be saved for an address the owner is not looking at.
- The key-shape rule (1–4096 visible ASCII) moved to core/aiEngine.js (isSendableKey, MAX_KEY_LENGTH); ai/chat.js imports it. interfaces.md §6.7 could name it.
- New test layer: tests/ai/prefs.test.js runs the real prefs.js in the throwaway keyring session, with a stub ExtensionPreferences registered as a GResource and a private GTK display (gtk4-broadwayd). testing-and-build.md (Layer 2b and the prerequisites) should list gtk4-broadwayd and glib-compile-resources.
- Measured: gtk4-broadwayd without -u listens on TCP *:8080+display on every interface. The harness always passes -u <socket in XDG_RUNTIME_DIR>; any future use must too.

## 2026-09-27 — for-product — PG-4d settings wording
- The warning is the spec's text, verbatim and always shown. Next to it, a line for the entered address says "On this computer: the invite does not leave it." or "… the invite leaves your computer." (worked out from the address, interfaces.md §6.4).
- Every other text on the Verdicts page (mode lines, key status, the Yes/No reasons) was written by the senior engineer. They are listed in docs/plans/PG-4d.md and live in core/aiSetup.js. A reword is a one-line change there.
```

## Validation

After every step, and in full at the end, in this order: `npm run lint`, `npm test`, `npm run build`, `npm run test:helper` (it now includes `tests/ai/prefs.test.js`), `npm run smoke`. Report the real output.

`.test-home/` is already git-ignored. The prefs tests must pass on this machine, not skip: `gtk4-broadwayd`, `glib-compile-resources`, `glib-compile-schemas`, `gnome-keyring-daemon`, `dbus-daemon` and `gjs` are all present (checked 2026-09-27).

**Layer 4 (by hand, on the real session, after install and a log-out/in):**
- open Settings → Verdicts;
- with Ollama running, apply a model and press Test → Yes;
- save a throwaway key for an `https://` address, then check it in Passwords and Keys under "payAttention AI engine key for …";
- check that `dconf dump /org/gnome/shell/extensions/payattention/` does not contain it;
- remove it.

Never save the owner's real cloud key during development; the owner does that themselves.

## Callers to update

- **`core/aiEngine.js`** (Step 2): additive exports. `ai/chat.js` is the only new importer. Its own export `MAX_KEY_LENGTH` stays (re-exported), so importers of chat.js (`tests/ai/chat.test.js`) do not change.
- **`core/aiSetup.js`** (Step 3): new; imported by `prefs.js` and the tests only.
- **`prefs.js`:** called only by the GNOME Extensions app through `fillPreferencesWindow`. Its contract is unchanged.
- **Settings keys** `verdict-source`, `ai-endpoint` and `ai-model`: already in the schema, `data.md` and `DEFAULT_SETTINGS`. No schema change. The shell reads them (PG-4c); prefs writes only normalised, valid values, a subset of what the shell already accepts.
- **The keyring item format:** as ADR-0009 and PG-4b define it: schema `ENGINE_KEY_SCHEMA_NAME`, attribute `ENGINE_KEY_ATTRIBUTE` = `normaliseEndpoint(address)`. Its reader is `ai/keyring.js`, and Step 6 proves they agree. `scripts/uninstall.sh --purge` (PG-4e) clears it by schema.
- **Test support:** `tests/ai/session.js` and `tests/ai/fakeEngine.js` are used as they are, not changed.
- **No external callers.**

## Out of scope

- The shell side: the queue, status, "AI unavailable — using rules" and the budget (PG-4c). Uninstall `--purge` (PG-4e).
- Any change to `ai/` beyond Step 2's import swap. Any change to `core/aiEngine.js` beyond the two exports, or to `aiProtocol.js` and `aiPrompt.js`.
- Showing the engine's reason from the probe. The result is Yes or No only; the reply is untrusted text and not needed.
- Loading a list of models from the engine, and any network call from prefs itself.
- A timeout on keyring calls in prefs (the status just stays empty until libsecret answers), and unlocking the keyring from prefs (except the desktop's own prompt on save).
- Names or changes to the existing rows on the Alerts and Judgment pages.
- `docs/architecture/`, `docs/product/`, `BACKLOG.md`: findings go through `docs/inbox.md` only (Step 8).

## Stop and escalate if

- PG-4b is not merged, or `probe`, `ai/main.js`, `createAiSession`, `startFakeEngine`, `killOnPrivateBus` or `ENGINE_KEY_*` differ from the PG-4b plan.
- The stub-resource harness cannot load `prefs.js` (fact 1), or the Step 1 test cannot pass without changing `prefs.js`.
- `gtk4-broadwayd -u` opens any TCP listener (check with `ss -ltn` once), or any prefs test would need the owner's display, bus, `HOME`, dconf or keyring.
- `Secret.Service.search` without `LOAD_SECRETS` returns the secret, or needs `UNLOCK`, to list items. Prefs must never hold a stored key.
- `Secret.password_store` into `COLLECTION_DEFAULT` does not replace an item with the same attributes (Step 5, case 6 finds two items). Do not work around it with a clear-then-store; report it.
- A key, or anything derived from it, shows up in any test output, setting, widget or log line.
- The lint rules refuse an import this plan needs (`gi://Secret`, `gi://GLib` or `core/aiSetup.js` in `prefs.js`). Do not loosen lint without the architect.
- The helper exits on its own before answering when stdin is left open, or `force_exit()` leaves a gjs process on the private bus.
