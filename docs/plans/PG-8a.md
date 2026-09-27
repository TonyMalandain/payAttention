# Plan — PG-8a: move the GNOME-free orchestration out of `extension/shell/` into `extension/app/` (move only, no behaviour change)

Backlog: PG-8a, the first of three build steps for PG-8 ("See what payAttention would decide, from a terminal", R-20, D-032).
Architecture: ADR-0011 (ports and adapters: three rings, `app/` linted like `core/`), `interfaces.md` §7.1, `boundaries.md` ("Ports and adapters", "Import rules", the `app/` row), `testing-and-build.md` (validation sequence, build step).

## What changes, and for whom

Nobody using the extension notices anything. For the code: seven modules that never touch GNOME leave `extension/shell/` for a new `extension/app/` directory, and lint now fails any GNOME, Node or `system` import there, or any import from `app/` of an adapter. The pack ships `app/`.

Done when (backlog): all tests pass unchanged, and lint forbids GNOME imports in `app/`.

## The component

- **Responsible for (`extension/shell/` today):** running payAttention inside gnome-shell.
- **Has drifted by:** it holds two kinds of code. Seven modules are the application's orchestration and are GNOME-free: `controller.js`, `aiQueue.js`, `aiBudget.js`, `health.js`, `backoff.js`, `view.js`, `soundCue.js`. The other eight are GNOME adapters: `store.js`, `settingsKeys.js`, `calendarFeed.js`, `helperProcess.js`, `aiHelperClient.js`, `ticker.js`, `launcher.js`, `environment.js`. Only a test convention keeps the first group GNOME-free ("Node-tested shell modules", `boundaries.md`). No lint rule does. This is ADR-0011 "Leak 3". It grew with PG-1c (view), PG-3 (health, backoff), PG-4c (aiQueue, aiBudget) and PG-7 (soundCue).
- **`extension/app/` will be responsible for:** the application orchestration: turning injected inputs into verdicts, plans and views. It is pure JavaScript, and every outside part is injected.
- **This change belongs here because:** ADR-0011 and §7.1 name the directory, list the seven modules, and set the lint rule. This ticket builds the decision exactly as written. No module changes its job.

## Seams

No function, class or export changes. Only module paths change:

| Old path | New path |
|---|---|
| `extension/shell/controller.js` | `extension/app/controller.js` |
| `extension/shell/aiQueue.js` | `extension/app/aiQueue.js` |
| `extension/shell/aiBudget.js` | `extension/app/aiBudget.js` |
| `extension/shell/health.js` | `extension/app/health.js` |
| `extension/shell/backoff.js` | `extension/app/backoff.js` |
| `extension/shell/view.js` | `extension/app/view.js` |
| `extension/shell/soundCue.js` | `extension/app/soundCue.js` |

The lint rules become the seam that cannot be misused:

- a GNOME import, a Node import, a `system` import, the Shell's `global`, or a clock read in `app/` fails lint;
- so does an `app/` import of anything outside `app/` and `core/`;
- `ui/`, `helper/`, `ai/` and `prefs.js` cannot import `app/`. Today they cannot import these modules, because they cannot import `shell/`. The move must not open that door.

## Steps

The whole ticket is behaviour-preserving. Steps 1 to 3 are all **[repair]**: no production behaviour changes, and no assertion in any existing test changes. The only test edits are import paths, plus new lint cases.

### Step 1 — lint knows `app/`  [repair]

- **Test first.** Add these cases to `CASES` in `tests/unit/boundaries.test.js`, after the existing shell cases, under a comment `// app/ (ADR-0011): GNOME-free orchestration; imports only app/ and core/.`:

  | File | Code | Expect |
  |---|---|---|
  | `extension/app/probe.js` | `import Gio from 'gi://Gio'; export {Gio};` | `error` |
  | `extension/app/probe.js` | `import m from 'resource:///org/gnome/shell/ui/main.js'; export {m};` | `error` |
  | `extension/app/probe.js` | `import fs from 'node:fs'; export {fs};` | `error` |
  | `extension/app/probe.js` | `import p from 'path'; export {p};` | `error` |
  | `extension/app/probe.js` | `import System from 'system'; export {System};` | `error` |
  | `extension/app/probe.js` | `import {x} from '../shell/store.js'; export {x};` | `error` |
  | `extension/app/probe.js` | `import {x} from '../ui/card.js'; export {x};` | `error` |
  | `extension/app/probe.js` | `import {x} from '../helper/main.js'; export {x};` | `error` |
  | `extension/app/probe.js` | `import {x} from '../ai/main.js'; export {x};` | `error` |
  | `extension/app/probe.js` | `import {x} from '../preview/main.js'; export {x};` | `error` |
  | `extension/app/probe.js` | `import {x} from '../extension.js'; export {x};` | `error` |
  | `extension/app/probe.js` | `import {judge} from '../core/judge.js'; export {judge};` | `ok` |
  | `extension/app/probe.js` | `import {x} from './aiQueue.js'; export {x};` | `ok` |
  | `extension/app/probe.js` | `export const t = Date.now();` | `error` |
  | `extension/app/probe.js` | `export const r = Math.random();` | `error` |
  | `extension/app/probe.js` | `export const d = new Date(0);` | `ok` |
  | `extension/app/probe.js` | `export const g = global;` | `no-undef` |
  | `extension/app/probe.js` | `console.error('x');` | `ok` |
  | `extension/ui/probe.js` | `import {x} from '../app/view.js'; export {x};` | `error` |
  | `extension/helper/probe.js` | `import {x} from '../app/health.js'; export {x};` | `error` |
  | `extension/ai/probe.js` | `import {x} from '../app/aiQueue.js'; export {x};` | `error` |
  | `extension/prefs.js` | `import {x} from './app/view.js'; export {x};` | `error` |
  | `extension/shell/probe.js` | `import {x} from '../app/health.js'; export {x};` | `ok` |
  | `extension/extension.js` | `import {x} from './app/controller.js'; export {x};` | `ok` |

  Run `npm test`. The `app/` `error` and `no-undef` cases fail, because no rule covers `app/` yet. So do the `ui/`, `helper/`, `ai/` and `prefs.js` cases for `app/`. That failure proves these are the right tests.

- **Then** edit `eslint.config.js`:
  1. Hoist three constants beside the existing ones, and use them in the `core/` block in place of the literals there. The `core/` block's behaviour stays the same:
     - `NODE_BUILTINS`: the `{ regex: '^(fs|path|…)(/.*)?$', … }` pattern object now inline in the core block, with its message changed to `'no Node built-ins in core/ or app/'`;
     - `NO_CLOCK_PROPERTIES`: the array of the two `no-restricted-properties` entries (`Date.now`, `Math.random`);
     - `NO_CLOCK_SYNTAX`: the array of the two `no-restricted-syntax` entries.
     - `TIME_MESSAGE` becomes `'time and randomness are parameters in core/ and app/'`.
  2. In the gjs-globals block (`files: ['extension/**/*.js', …]`), change `ignores: ['extension/core/**']` to `ignores: ['extension/core/**', 'extension/app/**']`.
  3. Add this block right after the `core/` block:
     ```js
     {
         // app/ is the application ring (ADR-0011): pure JavaScript, every outside part injected.
         // Only console is global: no Shell global, no gjs log/print.
         files: ['extension/app/**/*.js'],
         languageOptions: { globals: { console: 'readonly' } },
         rules: {
             'no-restricted-imports': ['error', {
                 patterns: [
                     { regex: '^(gi|resource|node):', message: 'app/ is GNOME-free: no gi://, resource:// or node: imports (ADR-0011)' },
                     NODE_BUILTINS,
                     NO_SYSTEM,
                     { regex: '^\\.\\./(?!core/)', message: 'app/ may import only app/ and core/ modules (ADR-0011)' },
                 ],
             }],
             'no-restricted-properties': ['error', ...NO_CLOCK_PROPERTIES],
             'no-restricted-syntax': ['error', ...NO_CLOCK_SYNTAX],
         },
     },
     ```
  4. Add `app` to the directory lists that must not be imported:
     - `helper/`: `'^\\.\\./(shell|ui|ai|app)/'`, message `'helper may not import shell/, ui/, ai/ or app/'`;
     - `ai/`: `'^\\.\\./(shell|ui|helper|app)/'`, message `'the AI helper may not import shell/, ui/, helper/ or app/'`;
     - `ui/`: `'^\\.\\./(shell|app|helper|ai)/'`, message `'ui/ may not import shell/, app/, helper/ or ai/'`;
     - `prefs.js`: `'^\\./(shell|app|ui|helper|ai)/'`, message `'prefs may not import shell/, app/, ui/, helper/ or ai/'`.
  5. Leave the `shell/` and `extension.js` blocks as they are. Both may import `app/` (`boundaries.md`; ADR-0011 "front ends are compositions").
- **Why here:** `eslint.config.js` is where `boundaries.md` says the "must not import" column is enforced, and `boundaries.test.js` keeps it honest.
- **Why the clock rules and the globals list:** ADR-0011 makes the clock an injected port, and says `app/` has "every outside part injected". None of the seven modules reads the clock today: `aiQueue.js:119` and `view.js:117` use `new Date(now)`, which is allowed. None of them uses a global other than `console`. So both rules cost nothing, and they catch a GNOME leak that imports cannot: the Shell's `global`.
- **Behaviour change:** none. `app/` is still empty, so no file changes its lint result.

### Step 2 — the move  [repair]

- **Test first:** none new. The whole existing suite is the test, unchanged except for import paths. Record `npm test`'s pass count before the move. It must be identical after.
- **Then:**
  1. `git mv` each of the seven files from `extension/shell/` to `extension/app/`. Do this in a commit that contains only the moves and the path edits below, so rename detection keeps their history.
  2. The moved files need no edits. Their imports are `../core/…` and same-directory `./…`, and both still resolve. Check with the grep in "Callers to update".
  3. Update every reference, as listed in "Callers to update".
  4. `extension/app/controller.js` header comment: leave it as is. It stays true.
- **Why here:** §7.1.
- **Behaviour change:** none.

### Step 3 — the pack ships `app/`  [repair]

- **Test first:** in `scripts/build.sh`, extend the existing zip check (the `ai/main.js` check) so that it also fails the build when `app/controller.js` is missing from the zip. Use the same `unzip -Z1 … | grep -x … >/dev/null || { echo "app/ is missing from the zip" >&2; exit 1; }` form, and the same comment about `grep -q`. Run `npm run build` **before** adding `--extra-source=app`: it must fail with "app/ is missing from the zip". That proves the check.
- **Then:** add `--extra-source=app` to the `gnome-extensions pack` line, after `--extra-source=shell`. Run `npm run build` again: it passes.
- **Why here:** `boundaries.md`: everything under `extension/` other than the default files must be passed with `--extra-source`. Without this, the packed extension fails to load (`extension.js` imports `./app/controller.js`).
- **Behaviour change:** none. The zip gains `app/` and loses nothing: `shell/` still holds eight files.

### Validation

Run the full sequence in order, and report the real output of each: `npm run lint`, `npm test`, `npm run build`, `npm run test:helper`, `npm run smoke`.

The smoke run is the proof that the installed pack loads with the new layout. It must pass exactly as before.

## Callers to update

Found with `grep -rnE "(controller|aiQueue|aiBudget|health|backoff|view|soundCue)\.js" extension tests scripts eslint.config.js package.json`. Re-run it after the edits. The only hits left must be same-directory `./` imports inside `extension/app/`, the `../app/` paths below, and prose comments naming a file without a directory.

Production code (real imports):
- `extension/extension.js:10`: `'./shell/controller.js'` → `'./app/controller.js'`.
- `extension/shell/calendarFeed.js:11-12`: `'./health.js'` → `'../app/health.js'`, `'./backoff.js'` → `'../app/backoff.js'`.
- `extension/shell/aiHelperClient.js:13`: `'./backoff.js'` → `'../app/backoff.js'`.

JSDoc type paths. These are not lint-checked, but they must stay correct:
- `extension/shell/aiHelperClient.js:22, 55`: `import('./aiQueue.js')` → `import('../app/aiQueue.js')`.
- `extension/ui/alertContent.js:26, 89`; `extension/ui/card.js:19, 66`; `extension/ui/takeover.js:37`; `extension/ui/indicator.js:71, 72`; `extension/ui/ui.js:52`: `import('../shell/view.js')` → `import('../app/view.js')`. These are type references only. `ui/` still does not import `app/` (step 1 forbids it).

Comments:
- `extension/core/display.js:6`: `shell/view.js` → `app/view.js`.

Tests (import paths only):
- `tests/unit/backoff.test.js:6`, `soundCue.test.js:6`, `view.test.js:9`, `health.test.js:8`, `aiBudget.test.js:7`, `aiQueue.test.js:12`, `controller.ai.test.js:11-12`, `support/controllerHarness.js:6-7`: `extension/shell/<module>.js` → `extension/app/<module>.js`.
- Unchanged, because they import adapters that stay in `shell/`: `tests/unit/schema.test.js` (`settingsKeys.js`), `tests/unit/support/gjs-spawn-check.js` (`helperProcess.js`), `tests/smoke/store-check.js` (`store.js`), `tests/ai/gjs/shellClient.js` (`aiHelperClient.js`).

Build: `scripts/build.sh` (step 3).

No contract outside the repository depends on these paths. `interfaces.md` §4 (the extension object the smoke test uses) is unaffected.

## Out of scope

- **Any code change in the seven modules.** That includes the verdict component and the store split, which are PG-8b.
- **Architecture documents.** `boundaries.md`, `interfaces.md` §2, §3 and §6.5, `overview.md`, `testing-and-build.md` (the build line and "the gi-free shell modules"). They still name `shell/` paths for the moved modules. They belong to the architect; this is reported as a finding, not edited here.
- Old plans in `docs/plans/` that name `shell/` paths. They are history.
- Making `tests/unit/support/gjs-core-check.js` also load `app/` under gjs. Tempting, but it is new coverage, not a move.
- A lint rule for "only the verdict component imports `core/judge.js`". It needs PG-8b's component first, and the architect's table first.
- The debt items in `BACKLOG.md` "Housekeeping" (St/Clutter in `shell/`, settings in `ui/`).

## Stop and escalate if

- Lint reports a `no-undef` or a restricted import inside a moved file. The move would then have exposed a real GNOME dependency. Do not add a global or loosen the block. Stop and report the line.
- Any existing test needs an assertion change, not just an import path.
- A moved module turns out to import an adapter that stays in `shell/`. The grep above says none does.
- `npm run smoke` fails where it passed before the move.
