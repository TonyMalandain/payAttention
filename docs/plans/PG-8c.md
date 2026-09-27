# Plan — PG-8c: the verdict preview, a terminal command that shows what payAttention would decide and changes nothing

Backlog: PG-8c (last part of PG-8, "See what payAttention would decide, from a terminal").
Product: R-20 (the owner can see the verdicts without logging out), D-032 (a terminal preview, no nested desktop), D-033 (the preview never saves AI answers, even if the engine is asked twice).
Architecture: ADR-0012 (a second gjs front end in the pack, run from the installed copy, read-only by construction), ADR-0011 (front ends are compositions; one verdict pipeline), `interfaces.md` §7.2 and §7.3 (binding), §6.5 (the AI queue, binding), `boundaries.md` (the `preview/` row, "One caller of core/judge.js", the flat-config pitfall), `constraints.md` (30 s, 5 min, 120 asks/h).
Depends on: PG-8a and PG-8b, both committed (`770c7dd`). Every path below is the current one.

**Sensitive: personal data and secrets.** The preview prints meeting titles and reasons to the owner's terminal. In AI mode it sends invites to the owner's engine through the existing AI helper, and the AI helper reads the engine key from the keyring (unchanged code, ADR-0009). Nothing new is logged. Every calendar- or engine-derived string is cleaned before it is printed. The preview never writes settings, AI answers or keyring items, and this plan proves it with a byte check.

## What changes, and for whom

- **The owner** runs one command in a terminal on their desktop:
  `gjs -m ~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io/preview/main.js`, or `npm run preview` from the repository.
  - It lists every upcoming meeting (now to the end of the snapshot range, about 36 h), grouped by day: time, `MUST` or `ignore`, online or in person (with the travel time), title, and the reason. The verdicts come from the same component the extension uses, the same settings, overrides and travel times, and the owner's AI engine when AI mode is on.
  - It shows no alert and changes nothing.
  - `--json` prints one versioned object for scripts.
- **The code:** a second front end in `extension/preview/`, shipped in the zip.
  - The store reader now works outside the Shell process (a repair; see "Drift").
  - The verdict component gains one read-only accessor, `aiProgress(now)`.
  - Lint now enforces "only `app/verdicts.js` imports `core/judge.js`".

## The component

- **`extension/preview/`, responsible for:** composing the existing adapters and the verdict component into a one-shot terminal run that prints the judged list. It holds no judgment (ADR-0011: front ends are compositions).
- **`extension/app/verdicts.js`, responsible for:** turning the inputs into the judged list. It is the only caller of `judge` (§7.2). **No drift** (built in PG-8b).
- **`extension/shell/store.js` `StoreReader`, responsible for:** typed reads of the settings schema and the change signal. **It has drifted by one line of platform coupling.** It connects with `connectObject`/`disconnectObject` (store.js:42, 84). The Shell adds those to GObject (`misc/signalTracker.js`); plain `gjs` does not have them (`testing-and-build.md` pitfall "`connectObject` does not exist under plain `gjs`"; `tests/smoke/store-check.js:19-33` carries a stand-in for exactly this reason). So today `new StoreReader(...)` throws `TypeError: settings.connectObject is not a function` in any process but the Shell, and the preview is such a process. The facet was split in PG-8b so that the preview could hold it; this one line is what stops that from working.
- **This change belongs here because:**
  - the preview is the second front end ADR-0012 places in `extension/preview/`;
  - the store repair keeps the reader an adapter that works in every gjs process, which is its job;
  - `aiProgress` is a count over §6.5's "waiting meeting", the same family as the AI status the component already exposes (§7.2 "the AI state and status (`aiStatusOf`)"). The preview cannot compute it itself, because it may not import `app/aiQueue.js` (lint, §7.3), and copying `isWaiting` would be the copy R-20 forbids.

## Decisions this plan makes (stated once, used below)

1. **No repository-checkout mode.** §7.3 builds the settings from `<its own directory>/../schemas` and runs the helpers from `<its own directory>/..`. ADR-0012 rejected a repo-only run (option 3) because the previewed code and the installed code could differ unnoticed.
   - Run from the checkout (`gjs -m extension/preview/main.js`), the preview finds no compiled schema in `extension/schemas/` and exits 2, "payAttention is not installed". That is the correct message: the checkout is not installed.
   - The developer path is to install the checkout (`npm run install:local`, or `npm run build` then `gnome-extensions install --force dist/…zip`), then `npm run preview`. Installing does not load the new code into the running Shell on Wayland, so previewing the new version before logging out is exactly ADR-0012's use case.
   - The integration test (Step 10) is the isolated way to run the checkout's build: it installs the built zip into a throwaway home.
2. **`npm run preview`** runs the installed copy and honours `XDG_DATA_HOME`, as `scripts/install.sh` does. npm prints its banner on **stdout** (measured, npm 11.12.1), so the README gives `npm run -s preview -- --json` for JSON.
3. **Every string that comes from a calendar or the engine is cleaned with core `cleanText` in the text output and in the JSON output.** This covers `title`, `reason`, calendar `name` and `error`, and the model name. The JSON `key` and `seriesKey` are **not** cleaned: they are identifiers that must match the stored override keys, and cleaning could change them. JSON escaping covers them. Why clean the JSON too: a consumer running `jq -r '.meetings[].title'` prints the decoded string, so JSON escaping alone does not protect the terminal. "Unformatted" in §7.3 means no clock formatting and no capping; cleaning is neither.
4. **JSON output is ASCII-only.** Every code point above U+007E is written as a `\uXXXX` escape, which is still valid JSON. Why: gjs `print()` goes through `g_print`, which converts to the locale's charset, so a non-UTF-8 locale would corrupt the JSON. Text output is printed as is, and a lossy conversion there is acceptable.
5. **`overridden` in the JSON is `verdictOverridden`**, as the extension's menu row uses it (`app/view.js:100`).
6. **The 5-minute AI wait counts from the first accepted snapshot.** No ask can start before it. The worst case is 30 s plus 5 min.
7. **`generatedAt`** is the `now` at which the printed list was computed.
8. **Exit on a signal:** SIGINT, SIGTERM and SIGHUP (terminal closed) destroy the run, then exit with `128 + signal` (130, 143, 129), the shell convention. §7.3 lists 0 to 3 for the outcomes of a run; an interruption is not an outcome. This is a finding for the architect to fold into §7.3.
9. **Signals use `gi://GLibUnix` `signal_add`.** `GLib.unix_signal_add` prints a `Gjs-WARNING` on every use on gjs 1.88.1 (measured), the same move as `GioUnix` for the helper (`boundaries.md`, "`GioUnix` in the helper"). The preview's gi allowlist is therefore Gio, GLib and GLibUnix. This is a finding for the architect to fold into the `preview/` row.
10. **`preview/` is split** into one gjs entry (`main.js`) and gi-free modules that Node tests import (`cli.js`, `session.js`, `report.js`). §7.3's parity test needs "the preview's gi-free presenter". The gi-free files are linted like `app/`.
11. **`--help` / `-h`** prints the usage on stdout and exits 0. Any other unknown argument prints the usage on stderr and exits 1.

## Design in one page

```
preview/main.js (gjs; composition only, like extension.js)
  openInstalledSettings(dir) ──► Gio.Settings, already delay()ed   (null → "payAttention is not installed", exit 2)
  startPreview({ format, createStoreReader: onChange => new StoreReader(settings, onChange),
                 createFeed:     onUpdate => new CalendarFeed({argv: ['gjs','-m',`${dir}/helper/main.js`], …}),
                 createAiClient: engine   => new AiHelperClient({argv: ['gjs','-m',`${dir}/ai/main.js`], …}),
                 createTicker:   onTick   => new Ticker(1000, onTick),
                 progress: printerr, onFinish, now: () => Date.now() })
  GLibUnix.signal_add(SIGINT|SIGTERM|SIGHUP) → run.stop(); exit 128+n
  every exit through exitSoon(code) while the GLib.MainLoop runs
      │
      ▼
preview/session.js  startPreview (gi-free)
  builds Verdicts with writeAnswers = a no-op it owns (no caller can pass a writer)
  1 s run tick: no snapshot by 30 s → outcome 3
               snapshot + no engine → print
               snapshot + engine → aiProgress(now).pending === 0 or 5 min since first snapshot → print
  on finish: format (report.js), destroy the tick and Verdicts (both helpers die), then onFinish once
      │
      ▼
app/verdicts.js  Verdicts (unchanged, plus aiProgress(now))
```

## Seams

### `extension/shell/store.js` (changed inside; signature unchanged)

`StoreReader` keeps `constructor(settings, onChange)`, `readSettings`, `readOverrides`, `readTravel`, `readAiAnswers` and `destroy`, unchanged.
- It holds the handler id in a second private field, `#changedId`.
- It connects with `settings.connect('changed', handler)` and disconnects with `settings.disconnect(this.#changedId)`.
- `destroy()` stays idempotent and exposes no field (`Object.keys(reader)` stays empty).

Misuse made impossible: building a reader in a plain gjs process no longer throws.

### `extension/app/aiQueue.js` (new export, next to `aiStatusOf`)

```js
/**
 * §6.5 "waiting meeting", counted for a front end that waits for the AI (the preview,
 * interfaces.md §7.3). Uses isWaiting, the one definition.
 *
 * @param {AiState} ai
 * @param {ReadonlyArray<import('../core/types.js').JudgedOccurrence>} judged
 * @param {number} cutoffMs
 * @param {number} now
 * @returns {Readonly<{pending: number, byRules: number}>} over the waiting meetings:
 *   byRules = those whose own last ask failed (ai.failedKeys) or all of them while ai.engineDown;
 *   pending = the rest (still to be answered). Frozen.
 */
export function aiProgressOf(ai, judged, cutoffMs, now)
```

Invariant (tested): given an engine, `byRules > 0` exactly when `aiStatusOf(...)` gives `'unavailable'`.

### `extension/app/verdicts.js` (one new method; nothing else changes)

```js
/**
 * How far the AI has got, for a front end that waits for it (interfaces.md §7.3).
 * Computes judgedList(now) first, so the counts always describe the list as of now.
 *
 * @param {number} now
 * @returns {Readonly<{pending: number, byRules: number}>} aiProgressOf over that list;
 *   {pending: 0, byRules: 0} without an engine (no aiAsk is ever set) and after destroy()
 */
aiProgress(now)
```

Misuse made impossible: calling it before `judgedList` gives stale counts. It does the preparation inside.

### `extension/preview/cli.js` (new, gi-free)

```js
export const EXIT = Object.freeze({ printed: 0, error: 1, notInstalled: 2, noCalendar: 3 });
export const STOP_SIGNALS = Object.freeze([1, 2, 15]);            // SIGHUP, SIGINT, SIGTERM
export const NOT_INSTALLED_TEXT = 'payAttention is not installed';
export const USAGE = '…';                                          // text below; no trailing newline
/** @returns {number} 128 + signum */
export function signalExitCode(signum)
/**
 * @param {string[]} argv System.programArgs
 * @returns {{format: 'text'|'json'} | {help: true} | {usageError: true}}
 *   [] → text; ['--json'] → json; ['--help'] or ['-h'] → help; anything else → usageError
 */
export function parseArgs(argv)
/** @returns {string} 'payAttention preview: internal error: ' + cleanText(String(error)) */
export function internalErrorText(error)
```

`USAGE`, exactly:

```
Usage: gjs -m <payAttention install directory>/preview/main.js [--json]
Shows what payAttention would decide for your upcoming meetings. Changes nothing.
  --json   print one JSON object (version 1) instead of text
Exit status: 0 printed, 1 usage or internal error, 2 not installed, 3 no calendar data within 30 s.
```

### `extension/preview/report.js` (new, gi-free): the presenter

```js
/**
 * @typedef {Readonly<{now: number,
 *   settings: import('../core/types.js').Settings,
 *   judged: ReadonlyArray<import('../core/types.js').JudgedOccurrence>,
 *   sources: ReadonlyArray<import('../core/types.js').SourceInfo>,
 *   aiStatus: 'off'|'ok'|'unavailable',
 *   aiProgress: Readonly<{pending: number, byRules: number}>}>} PreviewInput
 */
/** @returns {object} the §7.3 version-1 object (below) */
export function previewJson(input)
/** @returns {string} the text report, no trailing newline */
export function previewText(input)
/** @returns {string} 'json': JSON.stringify(previewJson(input)), ASCII-only; 'text': previewText(input) */
export function formatPreview(input, format)
```

Both outputs take their meetings from one private helper, `upcoming(judged, now)`: the judged occurrences in judge order with `j.end === null || j.end > now`. So text and JSON always list the same meetings. An unknown end is kept: a hidden meeting is the worse failure. The engine comes from `aiEngine(input.settings)` (core), so it agrees with the verdict component.

**`previewJson`**, keys in exactly this order (§7.3):
- `v: 1`
- `generatedAt: now`
- `verdictSource`: `'ai'` when `aiEngine(settings) !== null`, else `'rules'`
- `aiStatus`
- `calendars`: every source as `{name: cleanText(name), ok, error: error === null ? null : cleanText(error)}`
- `meetings`: per upcoming occurrence `{key, seriesKey, start, end, title: cleanText(title), verdict, reasonCode, reason: cleanText(reason), mode, overridden: verdictOverridden, travelMinutes}`. `travelMinutes` is the judged value, which is `null` online.

No other field.

**`previewText`**, lines in this order:
1. `payAttention verdicts, <DAY(now)> at <formatClock(now)>`
2. The verdict source line:
   - `Verdicts from: the rules` when there is no engine and `settings.verdictSource !== 'ai'`;
   - `Verdicts from: the rules (AI mode is on, but its address or model cannot be used)` when there is no engine and `settings.verdictSource === 'ai'`;
   - `Verdicts from: AI, model <cleanText(engine.model)>, <WHERE[engine.endpointClass]>` when there is an engine, with `WHERE = {loopback: 'on this computer', private: 'on your local network: invites leave your computer', public: 'on the internet: invites leave your computer'}`.
3. If there are no upcoming meetings: an empty line, then `No upcoming meetings.`
4. Otherwise, for each meeting in order:
   - when its local day (of `start ?? now`) differs from the previous meeting's: an empty line, then `<DAY(start)>`;
   - `  <time>  <MUST|ignore><' (your choice)' when verdictOverridden>  <mode>  <title>`, where:
     - time is `all day` when `allDay`, else `<formatClock(start)>–<formatClock(end)>` (just the start when `end` is null);
     - mode is `online`, or `in person, <travelMinutes> min travel`;
     - title is `cleanText(title)`, or `(no title)` when that is empty;
   - `    <cleanText(reason)>` on its own line. Core's reason is printed as it is: AI reasons already read "AI: …" (`core/verdict.js:99`).
5. The footer: an empty line, then only the lines that apply, in this order:
   - `Could not read: <cleanText(name)> (<cleanText(error ?? 'error')>), …` for sources with `ok === false`;
   - `<n> meeting(s) decided by the rules: the AI engine was unavailable.` when `aiProgress.byRules > 0`;
   - `<n> meeting(s) still waiting for the AI engine after 5 minutes: shown with the verdict payAttention gives now.` when `aiProgress.pending > 0`.

   Use "meeting" for n = 1 and "meetings" otherwise.

`DAY` is `new Intl.DateTimeFormat(undefined, {weekday: 'long', month: 'long', day: 'numeric'})`, built once at module level (as `core/display.js` does). `formatClock` is `core/display.js`'s.

### `extension/preview/session.js` (new, gi-free): one run

```js
export const SNAPSHOT_WAIT_MS = 30_000;   // constraints.md, §7.3
export const AI_WAIT_MS = 300_000;        // constraints.md, §7.3; counted from the first accepted snapshot
export const NO_CALENDAR_TEXT = 'payAttention: no calendar data after 30 seconds. The calendar helper\'s messages above say why. Run this in a terminal on your desktop, not over SSH.';
/** @typedef {{code: 0|1|3, stdout: string, stderr: string}} PreviewOutcome  no trailing newlines; '' = print nothing */
/**
 * Starts one preview run. Builds the verdict component, then a 1 s run tick.
 * Finishes exactly once: the run tick and the verdict component (so both helpers)
 * are destroyed first, then onFinish is called. onFinish is never called
 * synchronously inside startPreview, and never after stop().
 *
 * @param {object} deps
 * @param {'text'|'json'} deps.format
 * @param {(onChange: () => void) => import('../app/verdicts.js').StoreReaderPort} deps.createStoreReader
 * @param {(onUpdate: () => void) => import('../app/verdicts.js').FeedPort} deps.createFeed
 * @param {(engine: import('../app/aiQueue.js').AiEngine) => import('../app/aiQueue.js').AiClientPort} deps.createAiClient
 * @param {(onTick: () => void) => {destroy(): void}} deps.createTicker 1 s; used for the run tick and as the AI ticker
 * @param {(line: string) => void} deps.progress one stderr line, counts only
 * @param {(outcome: PreviewOutcome) => void} deps.onFinish
 * @param {() => number} deps.now
 * @returns {{stop(): void}} stop destroys everything; onFinish is then never called. Idempotent.
 * @throws {TypeError} before building anything, when one of the functions is missing
 * @throws whatever the Verdicts constructor throws (it has already cleaned up)
 */
export function startPreview(deps)
```

**The misuse this seam makes impossible:** a writer reaching the preview. `startPreview` takes no `writeAnswers` and no writer. It passes Verdicts its own no-op, `keepAnswersInMemoryOnly`. The `AiQueue` already keeps every answer it records in its own state (`aiQueue.js`: `this._answers = recordAiAnswer(…)` before `this._writeAnswers(…)`), so the answers live in memory for the run and are never stored (D-033). §7.3's "keep in memory" is exactly this.

Behaviour of the run tick, at `t = now()`, all inside one `try`:
1. If `verdicts.feedFacts.snapshot === null`:
   - if `t - startedAt >= SNAPSHOT_WAIT_MS`, finish with `{code: 3, stdout: '', stderr: NO_CALENDAR_TEXT}`;
   - else return.
2. `firstSnapshotAt ??= t`.
3. If `aiEngine(verdicts.inputs.settings) === null`, finish printed.
4. Else `p = verdicts.aiProgress(t)`. This computes the list, which is what lets the AI ticker pump (the backlog note: "the AI only progresses when the judged list is fetched").
   - If `p.pending > 0` and `t - firstSnapshotAt < AI_WAIT_MS`: when `p.pending` differs from the last reported value, call `progress('payAttention: asking the AI engine: <n> meeting(s) waiting')`; then return.
   - Otherwise finish printed.
5. **Finish printed:**
   - `input = {now: t, settings: verdicts.inputs.settings, judged: verdicts.judgedList(t).judged, sources: verdicts.feedFacts.snapshot.sources, aiStatus: verdicts.ai.status, aiProgress: verdicts.aiProgress(t)}`;
   - `stdout = formatPreview(input, format)`;
   - then finish with `{code: 0, stdout, stderr: ''}`.
6. Any exception: finish with `{code: 1, stdout: '', stderr: internalErrorText(e)}`.

"Finish" means: mark finished; destroy the run ticker, then Verdicts, each in its own `try` (a failure is logged with `console.error('payattention: destroy-failed <part>', e)`, the existing code); then `onFinish(outcome)`.

Construction order: Verdicts first, then the run ticker, so a failed Verdicts leaves nothing to clean.

### `extension/preview/main.js` (new, gjs entry): composition only

- `const extensionDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();`
- `exitSoon(code)`: `GLib.idle_add(GLib.PRIORITY_HIGH, () => { System.exit(code); return GLib.SOURCE_REMOVE; })`, the helper's pattern (`helper/main.js:23`, and the exit rule in `testing-and-build.md`). It is the only way the process ends.
- `openInstalledSettings(extensionDir)` is a local function. It returns a `Gio.Settings` that is **already in delay-apply mode**, or `null`. Steps:
  1. read `<dir>/metadata.json` and take `settings-schema`;
  2. `Gio.SettingsSchemaSource.new_from_directory(`${dir}/schemas`, Gio.SettingsSchemaSource.get_default(), false)`;
  3. `.lookup(id, false)`;
  4. `new Gio.Settings({settings_schema})`;
  5. `settings.delay()`;
  6. return it.

  Any missing file, parse error, `GLib.Error` or `null` lookup returns `null`. `apply()` is never called anywhere in `preview/`.

  This is the only way `main.js` gets settings, so no read can happen before `delay()`. The schema id is read from `metadata.json`, as `Extension.getSettings` does, so there is no second literal.
- `main()` runs from `GLib.idle_add` once the loop runs:
  1. `parseArgs(System.programArgs)`:
     - `help`: `print(USAGE)`, exit 0;
     - `usageError`: `printerr(USAGE)`, exit 1.
  2. `openInstalledSettings` gives `null`: `printerr(NOT_INSTALLED_TEXT)`, exit 2.
  3. `run = startPreview({...})` with the factories in "Design in one page":
     - `progress: line => printerr(line)`;
     - `onFinish: o => { if (o.stdout) print(o.stdout); if (o.stderr) printerr(o.stderr); exitSoon(o.code); }`;
     - `now: () => Date.now()`.

     If `startPreview` throws: `printerr(internalErrorText(e))`, exit 1.
  4. For each `n` of `STOP_SIGNALS`: `GLibUnix.signal_add(GLib.PRIORITY_HIGH, n, () => { run?.stop(); exitSoon(signalExitCode(n)); return GLib.SOURCE_REMOVE; })`. Register these **before** `startPreview`, so a Ctrl-C during start-up is handled; `run` is `null` until then.
- Then `new GLib.MainLoop(null, false).run()`.
- Imports allowed here and used: `gi://Gio`, `gi://GLib`, `gi://GLibUnix`, `system`, `../shell/store.js` (`StoreReader` only), `../shell/calendarFeed.js`, `../shell/aiHelperClient.js`, `../shell/ticker.js`, `./cli.js`, `./session.js`.

### `eslint.config.js` (changed): exact shape

- Extract the gjs globals object into `const GJS_GLOBALS`. The gjs-code block uses it and adds `'extension/preview/**'` to its `ignores`.
- Add `const ONE_JUDGE = 'only app/verdicts.js may import core/judge.js (ADR-0011, boundaries.md)';`.
- **Judge guard, inside each existing list** (never a separate block: the flat-config pitfall in `boundaries.md`):
  - core: `{ regex: '^\\./judge\\.js$', message: ONE_JUDGE }`;
  - shell: `{ regex: '^\\.\\./core/judge\\.js$', message: ONE_JUDGE }`;
  - prefs: `{ regex: '^\\./core/judge\\.js$', message: ONE_JUDGE }`;
  - helper, ai, ui and extension.js already refuse it through their allowlists (probes added);
  - app: move the app list into `const APP_PATTERNS` (same four entries, same order). The existing app block uses it unchanged. Directly after that block, add:
    ```js
    {
        // After the app/ block on purpose: flat config replaces the option list, so this
        // repeats APP_PATTERNS and adds the judge guard for every app/ file but verdicts.js.
        files: ['extension/app/**/*.js'],
        ignores: ['extension/app/verdicts.js'],
        rules: { 'no-restricted-imports': ['error', { patterns: [...APP_PATTERNS, { regex: '^\\.\\./core/judge\\.js$', message: ONE_JUDGE }] }] },
    },
    ```
- **Preview blocks.** Shared constants:
  ```js
  const DYNAMIC_IMPORT = { selector: 'ImportExpression', message: 'no dynamic import() in preview/: lint cannot see what it loads' };
  const PREVIEW_COMMON = [
      { regex: '^\\.\\./core/(judge|plan|alertState)\\.js$', message: 'the preview never judges, plans or touches alert state (ADR-0012)' },
      { regex: '^\\.\\./app/(?!verdicts\\.js$)', message: 'the preview gets verdicts only from app/verdicts.js (ADR-0012)' },
      { regex: '^\\.\\./shell/store\\.js$', importNames: ['StoreWriter'], message: 'the preview is read-only: it never holds the store writer (ADR-0012)' },
      { regex: '^\\.\\./(ui|helper|ai)/', message: 'the preview may not import ui/, helper/ or ai/: it spawns the helpers (ADR-0012)' },
      { regex: '^\\.\\./(extension|prefs)\\.js$', message: 'the preview may not import extension.js or prefs.js' },
  ];
  ```
  - Entry block, `files: ['extension/preview/main.js']`, `languageOptions: { globals: GJS_GLOBALS }`:
    - `no-restricted-imports` patterns:
      - `...PREVIEW_COMMON`;
      - `{ regex: '^resource:', message: 'the preview runs outside the shell: no resource:// imports' }`;
      - `{ regex: '^gi://(?!(Gio|GLib|GLibUnix)(\\?|$))', message: 'the preview may use only Gio, GLib and GLibUnix' }`;
      - `{ regex: '^\\.\\./shell/(?!(store|calendarFeed|aiHelperClient|helperProcess|ticker)\\.js$)', message: 'from shell/ the preview may use only the store reader, the calendar feed, the AI client, the spawn rule and the ticker (interfaces.md §7.3)' }`;
      - `NO_NODE`.
    - `no-restricted-properties`: `Gio.Subprocess` and `Gio.SubprocessLauncher` with `SPAWN_MESSAGE`.
    - `no-restricted-syntax`: `[DYNAMIC_IMPORT]`.
  - Gi-free block, `files: ['extension/preview/**/*.js']`, `ignores: ['extension/preview/main.js']`, `languageOptions: { globals: { console: 'readonly' } }`:
    - `no-restricted-imports` patterns:
      - `...PREVIEW_COMMON`;
      - `{ regex: '^(gi|resource|node):', message: 'preview/ logic is GNOME-free so Node can test it; only preview/main.js may use gi:// (ADR-0011)' }`;
      - `NODE_BUILTINS`;
      - `NO_SYSTEM`;
      - `{ regex: '^\\.\\./(?!(core|app)/)', message: 'preview/ logic may import only core/, app/verdicts.js and preview/ modules' }`.
    - `no-restricted-properties`: `NO_CLOCK_PROPERTIES`.
    - `no-restricted-syntax`: `[...NO_CLOCK_SYNTAX, DYNAMIC_IMPORT]`.

`importNames` with `regex` was measured on ESLint 10.11.0. It flags `import { StoreWriter }`, `import * as S`, `export { StoreWriter } from` and `export * from`, and lets `import { StoreReader }` through. Dynamic `import()` is not seen by `no-restricted-imports`, hence `DYNAMIC_IMPORT`.

## Steps

Steps 1–2 are repairs and must not change behaviour: every existing test stays green, with no expectation changed. Steps 3 onward are the feature, test first. Land the repairs as their own commit(s), separate from the feature.

### Step 1 — the store reader works in any gjs process  [repair]

- **Test first:** in `tests/smoke/store-check.js`:
  - delete `withSignalTracker` and its doc comment;
  - build both `settings` (line 59) and `delayed` (line 167) as plain `new Gio.Settings({ schema_id: SCHEMA_ID })`.

  Run the store check alone, exactly as `scripts/smoke.sh` step 1 does:
  - compile the schemas into `.smoke-home/schemas`;
  - run `env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 GSETTINGS_SCHEMA_DIR=… GSETTINGS_BACKEND=memory gjs -m tests/smoke/store-check.js`.

  It must print `PAYATTENTION-STORE FAIL settings.connectObject is not a function` (or gjs's equivalent TypeError text). That failure proves the check runs the reader in plain gjs.
- **Then:** in `extension/shell/store.js` `StoreReader`:
  - add `#changedId = 0`;
  - the constructor does `this.#changedId = settings.connect('changed', (_s, key) => { … unchanged body … });`;
  - `destroy()` does `this.#settings.disconnect(this.#changedId)` in place of `disconnectObject(this)`;
  - keep the idempotence guard and the file's header comment.
- **Why here:** the reader is the adapter both front ends hold. It must work in each front end's process.
- **Behaviour change:** none. The Shell's `connectObject` is a wrapper over `connect` that tracks the id by owner; with a plain JS owner it gives exactly this. The store check passes, including "no onChange after destroy" and "the reader exposes no field". Then run the full `npm run smoke`: the headless Shell must still pass.

### Step 2 — the helper fixture calendars can be written into any throwaway home  [repair, test support only]

- **Test first:** none new. `npm run test:helper` is green before and must be green after, unchanged.
- **Then:** in `tests/helper/isolatedEds.js`, move the file writes of `createIsolatedEds` into a new export:
  ```js
  /**
   * Writes the fixture sources (Fixture, Broken, Hidden, and Remote when withRemote) and the
   * fixture calendar under <home>/config/evolution/sources and <home>/data/evolution/calendar.
   * Creates <home>/cache. Never starts anything.
   * @param {string} home
   * @param {number} baseMs
   * @param {{withRemote?: boolean}} [options]
   */
  export function writeFixtureCalendars(home, baseMs, { withRemote = false } = {})
  ```
  `createIsolatedEds` keeps its signature. It still does the `rmSync` of its home, then calls `writeFixtureCalendars(home, baseMs, { withRemote })`, then builds `env` and starts the bus as today.
- **Why here:** Step 10 needs the same fixture inside the AI session's home (throwaway `HOME` and keyring). Copying the fixture would be a second source of truth.
- **Behaviour change:** none.

### Step 3 — lint: only `app/verdicts.js` imports `core/judge.js`  [feature: lint]

- **Test first:** in `tests/unit/boundaries.test.js`:
  - **change** the existing case `['extension/app/probe.js', "import {judge} from '../core/judge.js'; …", 'ok']` (line 116) to `'error'`. This is a deliberate change of expectation: the guard's purpose. Say so in the commit message;
  - add these cases:
    - `extension/app/verdicts.js` importing `judge` from `'../core/judge.js'` → `ok`;
    - `extension/app/verdicts.js` importing `Gio` from `'gi://Gio'` → `error` (the verdicts file keeps the app rules);
    - `extension/app/probe.js` importing `gi://Gio` → `error` (already present; it proves the superset block keeps the app rules);
    - `extension/shell/probe.js` importing `{judge}` from `'../core/judge.js'` → `error`;
    - `extension/prefs.js` importing `{judge}` from `'./core/judge.js'` → `error`;
    - `extension/core/probe.js` importing `{judge}` from `'./judge.js'` → `error`;
    - `extension/ui/probe.js` importing `{judge}` from `'../core/judge.js'` → `error`.

  Before the change, the shell, prefs, core and app ones fail.
- **Then:** make the `eslint.config.js` changes in "Seams" under "Judge guard" (`ONE_JUDGE`, `APP_PATTERNS` and the superset block).
- **Why here:** `boundaries.md` assigns this guard to PG-8c. It makes ADR-0011's "one verdict pipeline" a lint failure.
- **Behaviour change:** lint only. `npm run lint` over the tree stays clean: today only `app/verdicts.js` imports `judge.js` (checked).

### Step 4 — lint: the `preview/` blocks, before any preview file exists  [feature: lint]

- **Test first:** add cases to `boundaries.test.js`. Use `extension/preview/main.js` for the entry and `extension/preview/probe.js` for the gi-free files.
  - main.js, expect `ok`:
    - `import Gio from 'gi://Gio'`;
    - `import GLibUnix from 'gi://GLibUnix'`;
    - `import System from 'system'`;
    - `import {StoreReader} from '../shell/store.js'`;
    - `import {CalendarFeed} from '../shell/calendarFeed.js'`;
    - `import {Ticker} from '../shell/ticker.js'`;
    - `import {x} from './session.js'`;
    - `print(1); printerr(2);`.
  - main.js, expect `error`:
    - `import {StoreWriter} from '../shell/store.js'`;
    - `import * as S from '../shell/store.js'`;
    - `import {launchUri} from '../shell/launcher.js'`;
    - `import {Environment} from '../shell/environment.js'`;
    - `import {judge} from '../core/judge.js'`;
    - `import {plan} from '../core/plan.js'`;
    - `import {reduce} from '../core/alertState.js'`;
    - `import {AiQueue} from '../app/aiQueue.js'`;
    - `import {Controller} from '../app/controller.js'`;
    - `import {x} from '../ui/card.js'`;
    - `import {x} from '../helper/main.js'`;
    - `import {x} from '../ai/main.js'`;
    - `import m from 'resource:///org/gnome/shell/ui/main.js'`;
    - `import St from 'gi://St'`;
    - `import Soup from 'gi://Soup?version=3.0'`;
    - `import Secret from 'gi://Secret'`;
    - `import ECal from 'gi://ECal'`;
    - `import Gtk from 'gi://Gtk?version=4.0'`;
    - `import Gio from 'gi://Gio'; export const l = new Gio.SubprocessLauncher({});`;
    - `export const m = import('../shell/store.js');`.
  - probe.js, expect `ok`:
    - `import {Verdicts} from '../app/verdicts.js'`;
    - `import {cleanText} from '../core/aiProtocol.js'`;
    - `import {x} from './report.js'`;
    - `console.error('x');`;
    - `export const d = new Date(0);`.
  - probe.js, expect `error`:
    - `import GLib from 'gi://GLib'`;
    - `import System from 'system'`;
    - `import {StoreReader} from '../shell/store.js'`;
    - `import {isWaiting} from '../app/aiQueue.js'`;
    - `import {judge} from '../core/judge.js'`;
    - `export const t = Date.now();`.
  - probe.js, expect `no-undef`:
    - `print(1);`.

  Before the blocks exist, the gjs-globals block covers `preview/`, so most of the `error` cases fail.
- **Then:** make the `eslint.config.js` changes in "Seams" under "Preview blocks" and the `GJS_GLOBALS` extraction.
- **Why here:** §7.3 "Parity 1, by construction (lint)". It must be in place before the files it guards.
- **Behaviour change:** lint only.

### Step 5 — the verdict component reports AI progress  [feature]

- **Test first:**
  - `tests/unit/aiQueue.test.js`, new `describe('aiProgressOf')`:
    - no `aiAsk` anywhere gives `{pending: 0, byRules: 0}`;
    - three waiting, none failed, engine up gives `{3, 0}`;
    - one in `failedKeys` gives `{2, 1}`;
    - `engineDown` gives `{0, 3}`;
    - a meeting that started more than `cutoffMs` ago is not counted;
    - the result is frozen;
    - for each of these states, `byRules > 0 === (aiStatusOf({hasEngine: true, …}) === 'unavailable')`.
  - `tests/unit/verdicts.test.js`, reusing its existing setup:
    - rules mode after a snapshot gives `{0, 0}`;
    - AI mode with two eligible meetings and no answers gives `pending: 2` **without** a prior `judgedList` call (this proves it computes the list itself);
    - after one answer is delivered through the fake client, `pending: 1`;
    - after a `network` failure (engine down), `{0, n}`;
    - after `destroy()`, `{0, 0}`.
- **Then:**
  - `aiProgressOf` in `app/aiQueue.js`, directly after `aiStatusOf`, using `isWaiting`;
  - `aiProgress(now)` in `app/verdicts.js`, after `judgedList`. If destroyed, return a frozen `{pending: 0, byRules: 0}`; else `aiProgressOf(this._ai, this.judgedList(now).judged, this._inputs.timing.cutoffMs, now)`.
  - Do not change either file's header comment.
- **Why here:** §6.5 owns "waiting". The verdict component owns the list and the AI state.
- **Behaviour change:** new read-only accessor. The controller does not call it, so the alert front end is unchanged.

### Step 6 — the CLI texts and argument rules  [feature]

- **Test first:** `tests/unit/preview.cli.test.js`:
  - `parseArgs`: `[]`, `['--json']`, `['--help']`, `['-h']`, `['--json', '--json']` (usageError), `['--jsn']` (usageError), `['x']` (usageError);
  - `signalExitCode(2) === 130`;
  - `STOP_SIGNALS` deep-equals `[1, 2, 15]`;
  - `internalErrorText(new Error('a\u001b[2Jb'))` contains no `\u001b`;
  - `USAGE` matches the text in "Seams" exactly;
  - `EXIT` deep-equals `{printed: 0, error: 1, notInstalled: 2, noCalendar: 3}`.

  It fails on import (no module).
- **Then:** `extension/preview/cli.js` exactly as in "Seams", with the SPDX header lines every source file carries.
- **Behaviour change:** new module.

### Step 7 — the presenter  [feature]

- **Test first:** `tests/unit/preview.report.test.js`. Set `process.env.TZ = 'UTC'` before importing, as the controller tests do. Build inputs with `tests/unit/support/builders.js` and core `judge`: tests may import `judge.js`.
  - **Filter and order:** the meetings are the judged ones with `end > now` or `end === null`, in judge order. A meeting that ended at `now` is absent. Text and JSON list the same keys.
  - **JSON shape:**
    - `Object.keys` of the top level and of a meeting equal the §7.3 lists, in order;
    - `v === 1`;
    - `generatedAt === now`;
    - `overridden === verdictOverridden` (a mode override alone gives `false`);
    - `travelMinutes` is `null` online and the judged minutes in person;
    - `verdictSource`: `'rules'` with no engine (also when `verdictSource: 'ai'` with an unusable address), `'ai'` with one.
  - **Cleaning:**
    - a title `'Board\u001b]0;pwned\u0007 sync‮'` and an AI reason with `\u009b` come out with no C0 or C1 control and no U+202E, in both formats;
    - a source name with `\u001b` is cleaned in `calendars` and in the text footer;
    - `key` is byte-for-byte the judged key.
  - **ASCII JSON:**
    - a title `'Réunion 会議 😀'` gives a `formatPreview(…, 'json')` string whose every char code is ≤ 0x7E;
    - `JSON.parse` of it gives back the cleaned title exactly.
  - **Text:**
    - the header line;
    - each of the three verdict-source lines;
    - a day heading appears once per local day, and again when the day changes;
    - `all day`;
    - `in person, 45 min travel`;
    - ` (your choice)` only on a verdict override;
    - `(no title)` for an empty title;
    - the reason on its own indented line;
    - `No upcoming meetings.`;
    - the footer lines only when they apply, with singular and plural;
    - no trailing newline.
- **Then:** `extension/preview/report.js` as in "Seams". It imports `cleanText` (`core/aiProtocol.js`), `aiEngine` (`core/aiEngine.js`) and `formatClock` (`core/display.js`), and nothing from `app/`.
- **Why here:** the preview's own presentation. It is the preview's counterpart of `app/view.js`, which the preview may not import.
- **Behaviour change:** new module.

### Step 8 — one run: waits, finishes once, never writes  [feature]

- **Test first:** add `tests/unit/support/previewHarness.js`, test support, not a test.
  - It reuses `makeStore`, `makeFeed` and `makeAiClient` from `controllerHarness.js`.
  - It exports `setupPreview({settings, aiAnswers, aiClient, format})`, which returns `h`, with:
    - `h.now`;
    - `h.store`;
    - `h.feed`;
    - `h.aiClients`;
    - `h.tickers`: every ticker made, in creation order, each `{fire, destroyed}`;
    - `h.progress`: the lines;
    - `h.outcomes`;
    - `h.run`: the `{stop}` handle;
    - `h.at(t)`: set `h.now = t`, then fire every live ticker in creation order. The AI ticker comes first, because Verdicts makes it during construction.

  Then `tests/unit/preview.session.test.js`:
  1. A missing dep throws `TypeError` and no factory is called.
  2. No snapshot:
     - at `+29 999` ms, no outcome;
     - at `+30 000`, exactly one outcome `{code: 3, stdout: '', stderr: NO_CALENDAR_TEXT}`;
     - the feed is destroyed, and the tickers are destroyed before `onFinish` runs (record the order).
  3. Rules mode: the snapshot is delivered, then one tick gives `code 0` whose stdout equals `formatPreview` of the same inputs; nothing is asked.
  4. AI mode:
     - no outcome while one of two meetings waits;
     - one progress line per change of the count (`2`, then `1`), none repeated;
     - once both are answered, `code 0`, and the JSON meetings carry `reasonCode: 'ai-must'`.
  5. AI mode, the engine never answers: no outcome at first snapshot + `AI_WAIT_MS − 1`; `code 0` at `+AI_WAIT_MS`, and the text footer says `still waiting`.
  6. AI mode, the first ask fails with `network`: the run finishes on the next tick, and the footer says `decided by the rules`.
  7. **Never writes:**
     - after an answer, `h.store.aiWrites` is empty and `h.store.aiAnswers` is the same object it was;
     - only the reader's methods were called (wrap the reader to record calls).
  8. `stop()`: every ticker, the feed and the AI client are destroyed; later ticks give no outcome; a second `stop()` does nothing.
  9. An internal failure: settings with `largeMeetingSize: 0` (core `judge` throws `TypeError` on it at the first `judgedList`). After the snapshot, one tick gives `code 1`, stderr starting with `payAttention preview: internal error:`, and everything is destroyed.
  10. `onFinish` is never called during `startPreview` (a snapshot already present at construction still waits for the first tick).
- **Then:** `extension/preview/session.js` as in "Seams".
- **Why here:** the run is the preview's orchestration. It is gi-free, so all of its timing is tested with a fake clock.
- **Behaviour change:** new module.

### Step 9 — parity with the alert controller (§7.3 check 2)  [feature: test]

- **Test first (and only):** `tests/unit/preview.parity.test.js`, with `TZ = 'UTC'`.
  - For each scenario, build the controller with `controllerHarness.setup()` and the run with `previewHarness.setupPreview()` over identical settings, stored answers and store contents, and deliver the same snapshot at the same `now`.
  - Drive both with the same outcomes: answer or fail each ask on both fake clients in the same order, and move both clocks together (`h.at(t)` on both).
  - When the run finishes, parse its JSON. For every occurrence in `controller._judged` with `end === null || end > now` (the precedent for reading `_judged` is `controller.ai.test.js:450`), assert that a meeting with the same `key` exists with equal `verdict`, `reasonCode`, `reason`, `mode`, and `overridden === verdictOverridden`. Assert also that the run lists no other key.

  Scenarios:
  - (a) rules mode with an occurrence verdict override, a series verdict override on a recurring meeting, and a mode override with a stored travel time;
  - (b) AI mode with one current stored answer (fp from judge's `aiAsk.fp`, as `controller.ai.test.js` `fpOf` does), one stale stored answer (fp `'old'`) and one meeting with none; both clients answer the two asks identically;
  - (c) AI mode where the first ask fails with `network` on both, so the stale answer is withheld by the second pass and the rules decide.
- **Then:** no production code. If a scenario fails, **stop** (see "Stop and escalate").
- **Behaviour change:** none.

### Step 10 — the entry, the pack, and the integration run (§7.3 checks 3 and 4)  [feature]

- **Test first:**
  - Add `countKeys()` to `createAiSession`'s return in `tests/ai/session.js`. It runs `gjs -m tests/ai/gjs/keyring.js count` through the existing `run` and parses `KEYRING COUNT <ours> <other>` into `{ours, other}`.
  - Write `tests/helper/preview.test.js`.

  **Setup, once per `describe`:**
  1. Refuse to run with a clear message ("run npm run build first" / "dist zip is older than extension/: run npm run build") when `dist/payattention@tonymalandain.github.io.shell-extension.zip` is missing, or older than the newest file under `extension/`. `test:helper` runs after `build` in the validation sequence.
  2. `session = await createAiSession('preview-<case>')`: a throwaway home, a private bus and an unlocked keyring. The bus is started with `GSETTINGS_BACKEND=memory`, so EDS and the keyring daemon, which the bus activates, never touch the keyfile.
  3. `writeFixtureCalendars(session.home, baseMs)` with `baseMs = nextWholeHour(Date.now())`.
  4. Install the zip: `gnome-extensions install --force <zip>` with `session.env`. Assert `<home>/data/gnome-shell/extensions/payattention@tonymalandain.github.io/schemas/gschemas.compiled` exists. The home is `.test-home/`, on the home filesystem, which avoids the cross-filesystem pitfall.
  5. `previewEnv = { ...session.env, GSETTINGS_BACKEND: 'keyfile', TZ: 'Asia/Tokyo' }`. Write `<home>/config/glib-2.0/settings/keyfile` with a `[org/gnome/shell/extensions/payattention]` group. GVariant text accepts JSON-quoted strings.
  6. Run `gjs -m <installDir>/preview/main.js [args]` with `previewEnv`, collecting stdout, stderr and the exit code, with a 120 s kill timeout.

  **Cases:**
  - **Rules, `--json`** (check 3 and the settings half of check 4):
    1. First run the calendar helper once with `session.env` (`runHelper(session.env, ['--once'])` from `isolatedEds.js`) to get the snapshot.
    2. Take the key of `Coffee at the office` with core `occurrenceKey`, and seed `verdict-overrides={"<key>": 'must'}`.
    3. Record the keyfile bytes, run the preview, and assert:
       - exit 0, and stderr contains none of `destroy-failed`, `ai-failed`, `protocol-mismatch`, `helper-spawn-failed` or `internal error`;
       - stdout is one line, and `JSON.parse` gives `v === 1` and `verdictSource === 'rules'`;
       - `calendars` contains `Fixture` with `ok: true` and `Broken` with `ok: false`;
       - the Coffee meeting has `verdict: 'must'`, `reasonCode: 'override-must'` and `overridden: true`, which proves the keyfile was read;
       - `Cancelled call` has `reasonCode: 'cancelled'`; `Holiday` has `reasonCode: 'all-day'`;
       - `Out of range` is absent;
       - the whole `meetings` list equals, by `key`, `verdict`, `reasonCode`, `mode` and `overridden`, `judge(snapshot, {...DEFAULT_SETTINGS, ai: null}, {verdict: {[key]: 'must'}, mode: {}}, {}, {})` filtered by `end > generatedAt`;
       - **the keyfile bytes are identical after the run.**
  - **Rules, text:** exit 0; stdout contains `Verdicts from: the rules` and `Tokyo sync`; stdout contains no byte below 0x20 other than `\n`.
  - **AI, `--json`** (the keyring half of check 4):
    1. `engine = await startFakeEngine()`, then `session.storeKey(engine.endpoint, key = throwawayKey())`.
    2. Seed `verdict-source='ai'`, `ai-endpoint='<engine.endpoint>'` and `ai-model='fake-model'`.
    3. Record the keyfile bytes and `await session.countKeys()`, then run, and assert:
       - exit 0, `verdictSource: 'ai'`, `aiStatus: 'ok'`;
       - every meeting with `reasonCode: 'ai-must'` has `reason: 'AI: fake engine'`;
       - their number equals `engine.requests.length`;
       - every request's `authorization` header is `Bearer <key>`;
       - `Cancelled call` and `Holiday` keep their rule codes;
       - **the keyfile bytes are identical and `countKeys()` is unchanged.**
  - **Ctrl-C:**
    1. As in the AI case, but `engine.queue({hold: true})`, so the first ask never returns.
    2. Wait until `engine.requests.length === 1`, then send `SIGINT`, and assert:
       - exit code 130 within 5 s;
       - within 3 s, no process whose `/proc/<pid>/cmdline` contains `<installDir>/helper/main.js` or `<installDir>/ai/main.js`;
       - the keyfile bytes are unchanged.
  - **No calendar:** run with `{...previewEnv, DBUS_SESSION_BUS_ADDRESS: <session.unreachableEnv().DBUS_SESSION_BUS_ADDRESS>}`. Assert exit 3 after at least 30 s, stderr containing `no calendar data after 30 seconds` and `registry-failed` (the feed's own `helper-status` line), and empty stdout.
  - **Not installed:** copy the install directory to `<home>/data/not-installed-copy/`, delete its `schemas/gschemas.compiled`, and run its `preview/main.js`. Assert exit 2, stderr `payAttention is not installed`, and empty stdout.
  - **Usage:**
    - `--bogus`: exit 1, usage on stderr, empty stdout;
    - `--help`: exit 0, usage on stdout.

  All of these fail first because the zip has no `preview/`.
- **Then:**
  1. `scripts/build.sh`:
     - add `--extra-source=preview` after `--extra-source=ai`;
     - add a zip check for `preview/main.js`, the same form as the `app/controller.js` one, with the message `"preview/ is missing from the zip"`. Keep `grep -x … >/dev/null`, never `grep -q`.
  2. `extension/preview/main.js` exactly as in "Seams".
- **Why here:** the entry is the only gi code of the front end. The integration run is the only proof that the real adapters, the installed layout and the owner's backend behave as the unit tests assume.
- **Behaviour change:** the zip ships `preview/`, and the command exists.

### Step 11 — the npm shortcut and the README  [feature: docs]

- **Test first:** none automated. The README command is the one the integration test runs: `gjs -m <install dir>/preview/main.js`.
- **Then:**
  - `package.json` `scripts`, after `"uninstall:local"`:
    ```json
    "preview": "gjs -m \"${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/payattention@tonymalandain.github.io/preview/main.js\""
    ```
  - `README.md`: a new section directly after "AI mode (optional)", with this text (keep it; plain words, as the rest of the README):

    ````markdown
    ## See what it would decide, from a terminal

    To check the verdicts without logging out, run this in a terminal on your desktop:

    ```sh
    gjs -m ~/.local/share/gnome-shell/extensions/payattention@tonymalandain.github.io/preview/main.js
    ```

    From this folder, `npm run preview` does the same.

    It lists your meetings from now to about 36 hours ahead, by day: the time, MUST or ignore, online or in person (with the travel time), the title, and the reason. It uses your saved settings, your choices from the menu, your travel times, and your AI engine when AI mode is on. It never shows an alert and never changes anything: not your settings, not your saved AI answers.

    - payAttention must be installed; it does not need to be running. The preview runs the installed copy. After `npm run install:local`, it shows the new version's verdicts before you log out.
    - In AI mode it asks your engine about every meeting that has no saved answer, and waits up to 5 minutes. A meeting still unanswered then shows the verdict payAttention gives now. The preview does not save the answers, so the extension asks again later: with a cloud engine, those meetings are sent, and paid for, twice.
    - Run it on your desktop, not over SSH. Without your desktop session it cannot reach your calendars or your keyring. Times are in the terminal's time zone.
    - For scripts, add `--json` for one JSON object (`"v": 1`): `npm run -s preview -- --json`. Exit status: 0 printed, 1 usage or internal error, 2 not installed, 3 no calendar data within 30 seconds.
    ````
  - `README.md` "Development": append one sentence: "To preview a checkout's verdicts, install it (`npm run install:local`) and run `npm run preview`: the preview always runs the installed copy."
- **Behaviour change:** documentation and a shortcut.

### Validation

In order, as `docs/architecture/testing-and-build.md`: `npm run lint`, `npm test`, `npm run build`, `npm run test:helper`, `npm run smoke`. Report the real output.

The real-session check is **the owner's**, not the engineer's: install and run the command in their desktop terminal. The engineer must not run `npm run install:local` against the owner's session.

## Callers to update

- `StoreReader` (same signature): `extension/extension.js:25` (no change needed); `tests/smoke/store-check.js` (stand-in removed, Step 1); `extension/preview/main.js` (new).
- `Verdicts` (additive `aiProgress`): `app/controller.js` does not call it and needs no change; `preview/session.js` (new).
- `app/aiQueue.js` (additive `aiProgressOf`): `app/verdicts.js`.
- `eslint.config.js` (restructured app list, new blocks): `tests/unit/boundaries.test.js` (one expectation flipped, cases added).
- `scripts/build.sh` (new directory in the zip): `scripts/install.sh`, `scripts/smoke.sh` and `tests/smoke/uninstall-check.sh` consume the zip unchanged. Uninstall removes the whole directory, so `preview/` goes with it.
- `tests/helper/isolatedEds.js` `createIsolatedEds` (same signature) and `tests/ai/session.js` `createAiSession` (one more returned function): their existing callers are unchanged.
- `package.json` `scripts`: a new key only.
- The `--json` format v1 is new. It has no callers yet, and it is stable from this ticket on (§7.3).

## Out of scope

- A repository-checkout run mode, a schema-path flag, or a compiled schema in `extension/schemas/` (Decision 1).
- A "stored answers only" or "no engine calls" option (D-033 names it as a later option).
- Any change to `app/controller.js`, `app/view.js` (including reusing its `reasonLine`), the AI queue's behaviour, pacing or budget, `health.js`, `calendarFeed.js` or `aiHelperClient.js`.
- `connectObject` in `shell/environment.js`. It runs only in the Shell.
- The PG-8a leftover probe in `boundaries.test.js`, and every Housekeeping item in `BACKLOG.md`.
- Editing `docs/architecture/*`, `docs/product/*`, `BACKLOG.md` or `docs/inbox.md`. The architect folds the findings below.
- A smoke-test step for the preview. The integration test covers it; the headless Shell is not involved.

## Stop and escalate if

- **The parity test (Step 9) fails.** The preview and the extension disagree, and the cause is in the shared pipeline or in the harness, not in the preview. Do not adjust the preview to match; report the scenario and the diff.
- **The keyfile bytes, or `countKeys()`, change in any integration run.** Something writes. Find the writer by diffing the keyfile, and report it; never loosen the assertion.
- The preview needs any import outside its lint allowlist (for example `app/aiQueue.js`, `app/view.js`, a second `shell/` module, or `GioUnix`). That is a boundary change for the architect.
- The AI side does not progress in the integration run (no request reaches the fake engine within 30 s of the first snapshot). Do not add a pump call or a second path into the queue; report it.
- `GLibUnix.signal_add` is missing or warns on the machine's gjs, or `print()` output is truncated or reordered when stdout is a pipe.
- `gnome-extensions install` fails in the test home. Do not move the home to `/tmp` (the cross-filesystem pitfall); report it.
- Step 1's change makes any existing smoke check fail inside the headless Shell.
- ESLint reports a boundary rule as switched off for any existing directory after the restructure (an existing probe turning from `error` to `ok`).

## Findings for others (not acted on here)

- **For the architect (fold into `interfaces.md` §7.2 and §7.3, `boundaries.md` and `testing-and-build.md`):**
  - §7.2: the verdict component also exposes `aiProgress(now)`, backed by `aiProgressOf` in `app/aiQueue.js`.
  - §7.3:
    - exit `128 + signal` on SIGINT, SIGTERM and SIGHUP;
    - `title`, `reason` and calendar strings are `cleanText`-ed in the JSON too, keys are not;
    - JSON output is ASCII-only;
    - `overridden` means `verdictOverridden`;
    - the 5-minute wait counts from the first accepted snapshot;
    - `generatedAt` is the computation time.
  - `boundaries.md` `preview/` row:
    - `gi://GLibUnix` is allowed (the signal API moved there, as `GioUnix` did);
    - `preview/` is split into a gjs entry (`main.js`) and gi-free modules linted like `app/`, which Node tests import.
  - `testing-and-build.md`:
    - the `connectObject` pitfall no longer applies to `shell/store.js` after Step 1 (still to `environment.js`);
    - build step 4 now includes `--extra-source=preview` and checks `preview/main.js`;
    - `npm run test:helper` now needs the zip from `npm run build`;
    - a "Layer 2c: preview integration" paragraph.
- **For product:** the README now carries the double-ask cost of D-033 in owner words. Nothing to decide.
