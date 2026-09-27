# Plan — PG-6: license the project under the Apache License 2.0

Spec: `BACKLOG.md` PG-6. Product decision D-026 (`docs/product/decisions.md`): Apache-2.0 for the whole project, replacing the undecided `GPL-2.0-or-later` in `package.json`.

## What changes, and for whom

- GitHub shows "Apache-2.0" on the repository page.
- Every source file says its licence and copyright.
- The packed extension carries `LICENSE` and `NOTICE`.
- `npm test` fails if a development dependency with a copyleft or unknown licence is added, or if a source file is missing its licence header. That includes files added later, for example by PG-4b in `extension/ai/`.

No run-time behaviour changes.

## The component

- **Responsible for:** the repository's packaging and dev tooling: `package.json`/`package-lock.json`, `scripts/build.sh`, and the repo-level checks that live in `tests/unit/`. `boundaries.test.js` is the precedent for a repo-level check in `npm test`.
- **Has drifted by:** one fact. `package.json` and the root entry of `package-lock.json` say `GPL-2.0-or-later`, and no decision was ever made for that value (D-026). Nothing else.
- **This change belongs here because:** licence metadata, what goes into the zip, and a check that runs in the validation sequence are all packaging and tooling. Nothing in `extension/` changes except the two header lines at the top of each file.

## Decisions made in this plan

1. **Header form (REUSE/SPDX).** Two lines, the same in every file:
   `SPDX-License-Identifier: Apache-2.0`
   `SPDX-FileCopyrightText: 2026 Tony Malandain`
   These are wrapped in the comment syntax of each file type:

   | Type | Line 1 | Line 2 | Placement |
   |---|---|---|---|
   | `.js` | `// SPDX-License-Identifier: Apache-2.0` | `// SPDX-FileCopyrightText: 2026 Tony Malandain` | first two lines, then one blank line, then the existing content unchanged |
   | `.sh` | `# SPDX-License-Identifier: Apache-2.0` | `# SPDX-FileCopyrightText: 2026 Tony Malandain` | lines 2–3, right after the `#!/usr/bin/env bash` shebang (the shebang must stay on line 1), then one blank line |
   | `.css` | `/* SPDX-License-Identifier: Apache-2.0 */` | `/* SPDX-FileCopyrightText: 2026 Tony Malandain */` | first two lines, then one blank line |
   | `.xml` (the schema) | `<!-- SPDX-License-Identifier: Apache-2.0 -->` | `<!-- SPDX-FileCopyrightText: 2026 Tony Malandain -->` | lines 2–3, right after `<?xml …?>`, which must stay on line 1. No blank line |

2. **Files that are not tagged**, and why:
   - **JSON cannot hold comments**: `extension/metadata.json`, `package.json`, `package-lock.json` and `tests/fixtures/*.json`. `metadata.json` has no licence key in GNOME's format, and adding unknown keys is not worth the review risk. The zip carries `LICENSE` and `NOTICE` instead. `package.json` carries the `license` field.
   - **Not source code**: `.ics` fixtures, docs, screenshots and `.gitignore`.
3. **Year.** The sweep writes `2026`. The check accepts any four-digit year from 2026 on, so a file added in 2027 may say 2027. The holder must be exactly `Tony Malandain`.
4. **NOTICE** is one line plus a newline, exactly: `payAttention — Copyright 2026 Tony Malandain`. The dash is an em dash, U+2014.
5. **LICENSE** is the file at https://www.apache.org/licenses/LICENSE-2.0.txt, byte for byte. Measured 2026-09-27: 202 lines, starting with an empty line, sha256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`. The appendix placeholder `Copyright [yyyy] [name of copyright owner]` stays as published: GitHub detects only an unmodified text.
6. **Dependency allowlist:** exactly `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `BlueOak-1.0.0`. Everything else fails: other SPDX ids, SPDX expressions such as `(MIT OR GPL-3.0-only)`, a missing `license`, or a non-string `license`. A person then reviews the package and, if it is acceptable, extends the list and `THIRD-PARTY.md` in the same change. The source of truth is `package-lock.json` (lockfileVersion 3, `packages[*].license`). Measured today: 79 packages, all `dev: true`, all on the list (MIT 55, Apache-2.0 12, BSD-2-Clause 6, ISC 4, BSD-3-Clause 1, BlueOak-1.0.0 1).
7. **"Nothing ships" is checked two ways:**
   - `package.json` has only `devDependencies`. It has no `dependencies`, `optionalDependencies`, `peerDependencies`, `bundleDependencies` or `bundledDependencies` key, and every non-root lock entry has `dev: true`.
   - Every `.js` file under `extension/` must carry *our* header, so a copied-in third-party file fails the header check.
8. **Where the zip gets the files:** `gnome-extensions pack` accepts `--extra-source=../LICENSE` and `--extra-source=../NOTICE`, paths relative to `extension/`, and puts them at the zip root. Verified with a throwaway extension on this machine (gnome-shell 50.5).

## Seams

The check logic is two pure functions in a new test support module, `tests/unit/support/licensing.js` (a sibling of `builders.js` and `rulesGolden.js`). They take values and return values, and they do no file I/O. The test file does the reading.

```js
/** Licences a development dependency may have. Frozen. */
export const ALLOWED_LICENCES = Object.freeze(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'BlueOak-1.0.0']);

/**
 * @param {object} pkg  parsed package.json
 * @param {object} lock parsed package-lock.json (lockfileVersion 3)
 * @returns {string[]} one line per problem, e.g. 'node_modules/foo: licence GPL-3.0-only is not allowed'; [] when clean
 */
export function dependencyLicenceProblems(pkg, lock)

/**
 * @param {string} relPath repo-relative path; its extension picks the comment syntax (.js .sh .css .xml)
 * @param {string} text    the file's content
 * @returns {string|null}  why the header is wrong, or null when it is right
 */
export function headerProblem(relPath, text)
```

Misuse designed out:
- **No partial result.** Both functions return every problem, so the test message lists every offender at once.
- **An unknown file type is not skipped.** `headerProblem` returns `'unsupported file type'` for any extension other than the four, so a mistake in the walk is caught.
- **No shared constant to keep in sync.** `dependencyLicenceProblems` also reports the root entry `packages[""].license` when it is not equal to `pkg.license`, and `pkg.license` when it is not `'Apache-2.0'`. The build file and the lock cannot then drift apart.

The new test file is `tests/unit/licensing.test.js`, in `node:test` + `node:assert/strict` style like the rest of `tests/unit/`.

## Steps

### Step 1 — the licence files and metadata exist and are exact  [feature]
- **Test first:** in `tests/unit/licensing.test.js`, `describe('licence files')`:
  - `LICENSE` sha256 equals the value in decision 5;
  - `NOTICE` equals `'payAttention — Copyright 2026 Tony Malandain\n'`;
  - `package.json` `license === 'Apache-2.0'`;
  - `package-lock.json` `packages[""].license === 'Apache-2.0'`.

  Paths come from the repo root, resolved the way `schema.test.js` does. The tests fail today: the files are missing and the value is GPL.
- **Then:**
  - download `LICENSE` with `curl -fsSL https://www.apache.org/licenses/LICENSE-2.0.txt -o LICENSE`. Do not edit it. Check the sha256.
  - write `NOTICE` at the root.
  - in `package.json`, set `"license": "Apache-2.0"`.
  - in `package-lock.json`, edit the single `"license"` line of the `""` entry by hand. Do not run `npm install`, which may churn the lock. Then run `npm ci` to prove the lock is still accepted.
- **Behaviour change:** metadata only.

### Step 2 — the dependency licence check  [feature]
- **Test first:** `describe('dependency licences')` in `licensing.test.js`. Table tests on `dependencyLicenceProblems` with small synthetic `pkg`/`lock` objects. Each case expects one problem naming the package:
  - `GPL-3.0-only`;
  - `LGPL-2.1-or-later`;
  - missing `license`;
  - `license: { type: 'MIT' }`;
  - `(MIT OR GPL-3.0-only)`;
  - an entry with `dev` absent/false;
  - a `dependencies` key in `pkg`;
  - a root lock licence that differs from `pkg.license`.

  One clean case expects `[]`. They fail before the function exists. Then one test runs it on the real `package.json` and `package-lock.json` and expects `[]`, with the problems joined into the assertion message.
- **Then:** write `ALLOWED_LICENCES` and `dependencyLicenceProblems` in `tests/unit/support/licensing.js`. Skip only the `""` key of `lock.packages` for the allowlist check (it is checked against `pkg.license` instead).
- **Behaviour change:** `npm test` now fails on a disallowed dependency licence. This is the "check in the test sequence" the ticket asks for.

### Step 3 — every source file carries the header  [feature]
- **Test first:**
  - `describe('source file headers')`: table tests on `headerProblem`:
    - js, css and xml correct → `null`;
    - sh with the shebang and then the header → `null`;
    - sh with the header *above* the shebang → problem;
    - xml with the header above `<?xml` → problem;
    - a missing copyright line → problem;
    - year `2025` → problem, year `2027` → `null`;
    - another holder → problem;
    - `.ts` → `'unsupported file type'`.
  - Then the sweep test:
    - walk `extension/`, `scripts/` and `tests/` recursively (`fs.readdirSync(dir, { recursive: true })`), plus the root file `eslint.config.js`;
    - keep files ending in `.js`, `.sh`, `.css` or `.xml`, and sort them;
    - call `headerProblem` on each;
    - expect no offenders, with every offender and its reason in the message.

    It walks the filesystem, not `git ls-files`, so an untracked new file (PG-4b's `extension/ai/*.js`) fails too. It fails today on every file.
- **Then:**
  - write `headerProblem` in `tests/unit/support/licensing.js`. The regexes are anchored per line, with the year as `(20[2-9]\d)` and `>= 2026`.
  - do the sweep: add the header to every file the test lists, placed as in decision 1. Use a one-off shell command that you do not commit. Do not reformat or reword anything else in those files.
  - run the whole validation sequence: lint, test, build, test:helper, smoke. The schema must still compile under `glib-compile-schemas --strict`, and every `.sh` must still run.
- **Behaviour change:** none at run time.

### Step 4 — the zip carries LICENSE and NOTICE  [feature]
- **Test first:** in `scripts/build.sh`, after the existing `test -f` line, add a failing assertion that the zip lists both files at its root:
  ```bash
  for f in LICENSE NOTICE; do
      unzip -Z1 "dist/payattention@tonymalandain.github.io.shell-extension.zip" | grep -qx "$f" \
          || { echo "build: $f missing from the zip" >&2; exit 1; }
  done
  ```
  Run `npm run build`. It must fail with "LICENSE missing from the zip".
- **Then:** add `--extra-source=../LICENSE --extra-source=../NOTICE` to the `gnome-extensions pack` call. If PG-4b has already added `--extra-source=ai`, keep it. Then run `npm run build` (passes) and `npm run smoke` (installs that zip into the headless shell).
- **Behaviour change:** two extra files in the zip. The shell ignores them.

### Step 5 — the written record  [feature, docs]
- **`README.md`:** add a last section, after "Development":
  ```markdown
  ## License

  payAttention is licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Tony Malandain; see [`NOTICE`](NOTICE).
  The extension contains no third-party code. The development tools and the GNOME libraries it uses are listed, with their licences, in [`THIRD-PARTY.md`](THIRD-PARTY.md).
  ```
- **`THIRD-PARTY.md`** at the root, with these sections:
  1. **Shipped with the extension:** none. The zip holds only this project's files plus `LICENSE` and `NOTICE`.
  2. **Development tools (never shipped, `devDependencies` only):**
     - the direct ones, with version and licence: `eslint` 10.11.0 MIT, `@eslint/js` 10.0.1 MIT, `globals` 17.12.0 MIT;
     - the transitive total by licence, measured 2026-09-27: 79 packages, MIT 55, Apache-2.0 12, BSD-2-Clause 6, ISC 4, BSD-3-Clause 1, BlueOak-1.0.0 1;
     - the sentence: "Checked on every `npm test` by `tests/unit/licensing.test.js` against `package-lock.json`. A licence outside MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, BlueOak-1.0.0 fails the check."
  3. **Provided by the system at run time (not copied), with their Fedora 44 licences:**
     - GNOME Shell 50 and Mutter (GPL-2.0-or-later);
     - GJS (MIT / LGPL, see package);
     - GLib/Gio/GObject (LGPL-2.1-or-later);
     - Pango (LGPL-2.0-or-later);
     - GTK 4 (LGPL-2.1-or-later) and libadwaita (LGPL-2.1-or-later), in preferences only;
     - Evolution Data Server (LGPL-2.0-or-later);
     - libical-glib (LGPL-2.1-only OR MPL-2.0);
     - libcanberra (LGPL-2.1-or-later), through the shell's sound player.
  4. **Compatibility:** one paragraph restating D-026's cost, no new claims. Apache-2.0 is compatible with GPL-3.0, and GNOME Shell is GPL-2.0-*or-later*, so the combination can be distributed. A reviewer on extensions.gnome.org could still question it.
- No test. These are prose. The reviewer reads them against D-026.

## Callers to update

- `package.json` `license`: read by npm only. The lock root entry is updated in Step 1.
- `scripts/build.sh`: called by `npm run build`, and indirectly by `smoke.sh` and `install.sh`, which consume the zip. They are unaffected by the two extra entries.
- No code contract changes.

## Files added after this ticket (PG-4b and later)

The header test walks `extension/`, `scripts/` and `tests/` on disk. Any new `.js`/`.sh`/`.css`/`.xml` file fails `npm test` until it starts with the two lines in decision 1. The PG-4b engineer adds them when creating each file in `extension/ai/` and its tests. It is not a separate step.

If PG-4b lands first, this ticket's sweep simply covers its files too. If both touch `scripts/build.sh`, keep both sets of `--extra-source` flags.

## Out of scope

- `docs/architecture/constraints.md` line 125 ("Licence GPL-2.0-or-later compatible"). It is the architect's; it is reported below, not edited.
- `extension/metadata.json`: unchanged.
- No new npm package: no license-checker, no REUSE tool. The check is in-repo code.
- Rewording any existing file comment during the sweep.

## Stop and escalate if

- The downloaded `LICENSE` sha256 differs from decision 5. The text may have been republished; confirm it with the architect before committing.
- `gnome-extensions pack` rejects `../LICENSE` on the real tree.
- `glib-compile-schemas --strict` or any `.sh` fails because of the header.
- `npm ci` rejects the hand-edited lock.
- A current dependency fails the allowlist. The measured list above says none does; if one does, the list changed and the product owner must see it.
