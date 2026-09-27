// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// D-026: the project is Apache-2.0. These checks keep the licence files exact, the
// development dependencies on the allowed licences, and every source file headed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_LICENCES, dependencyLicenceProblems, headerProblem } from './support/licensing.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel));
const readJson = rel => JSON.parse(read(rel).toString('utf8'));

// https://www.apache.org/licenses/LICENSE-2.0.txt, unmodified, measured 2026-09-27.
const LICENSE_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';

describe('licence files', () => {
    test('LICENSE is the unmodified Apache License 2.0 text', () => {
        const sha = crypto.createHash('sha256').update(read('LICENSE')).digest('hex');
        assert.equal(sha, LICENSE_SHA256);
    });

    test('NOTICE names the project and the copyright holder', () => {
        assert.equal(read('NOTICE').toString('utf8'), 'payAttention — Copyright 2026 Tony Malandain\n');
    });

    test('package.json declares Apache-2.0', () => {
        assert.equal(readJson('package.json').license, 'Apache-2.0');
    });

    test('the package-lock.json root entry declares Apache-2.0', () => {
        assert.equal(readJson('package-lock.json').packages[''].license, 'Apache-2.0');
    });
});

/** A clean package.json and lock; each case below breaks one thing. */
function cleanPkg() {
    return { license: 'Apache-2.0', devDependencies: { foo: '^1.0.0' } };
}
function cleanLock(entry = { version: '1.0.0', license: 'MIT', dev: true }) {
    return { lockfileVersion: 3, packages: { '': { license: 'Apache-2.0' }, 'node_modules/foo': entry } };
}

describe('dependency licences', () => {
    test('the allowlist is exactly the six decided licences, frozen', () => {
        assert.deepEqual([...ALLOWED_LICENCES], ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'BlueOak-1.0.0']);
        assert.ok(Object.isFrozen(ALLOWED_LICENCES));
    });

    test('a clean package.json and lock have no problems', () => {
        assert.deepEqual(dependencyLicenceProblems(cleanPkg(), cleanLock()), []);
    });

    test('every allowed licence passes', () => {
        for (const license of ALLOWED_LICENCES)
            assert.deepEqual(dependencyLicenceProblems(cleanPkg(), cleanLock({ license, dev: true })), [], license);
    });

    // [case, pkg, lock, text the single problem must contain]
    const CASES = [
        ['GPL-3.0-only', cleanPkg(), cleanLock({ license: 'GPL-3.0-only', dev: true }), 'node_modules/foo'],
        ['LGPL-2.1-or-later', cleanPkg(), cleanLock({ license: 'LGPL-2.1-or-later', dev: true }), 'node_modules/foo'],
        ['missing license', cleanPkg(), cleanLock({ dev: true }), 'node_modules/foo'],
        ['non-string license', cleanPkg(), cleanLock({ license: { type: 'MIT' }, dev: true }), 'node_modules/foo'],
        ['SPDX expression', cleanPkg(), cleanLock({ license: '(MIT OR GPL-3.0-only)', dev: true }), 'node_modules/foo'],
        ['dev absent', cleanPkg(), cleanLock({ license: 'MIT' }), 'node_modules/foo'],
        ['dev false', cleanPkg(), cleanLock({ license: 'MIT', dev: false }), 'node_modules/foo'],
        ['a dependencies key', { ...cleanPkg(), dependencies: { bar: '1' } }, cleanLock(), 'dependencies'],
        ['an optionalDependencies key', { ...cleanPkg(), optionalDependencies: {} }, cleanLock(), 'optionalDependencies'],
        ['a peerDependencies key', { ...cleanPkg(), peerDependencies: {} }, cleanLock(), 'peerDependencies'],
        ['a bundleDependencies key', { ...cleanPkg(), bundleDependencies: [] }, cleanLock(), 'bundleDependencies'],
        ['a bundledDependencies key', { ...cleanPkg(), bundledDependencies: [] }, cleanLock(), 'bundledDependencies'],
        ['root lock licence differs', cleanPkg(),
            { lockfileVersion: 3, packages: { '': { license: 'MIT' }, 'node_modules/foo': { license: 'MIT', dev: true } } }, 'package-lock.json'],
        ['package.json licence is not Apache-2.0', { ...cleanPkg(), license: 'MIT' },
            { lockfileVersion: 3, packages: { '': { license: 'MIT' }, 'node_modules/foo': { license: 'MIT', dev: true } } }, 'package.json'],
    ];
    for (const [name, pkg, lock, names] of CASES) {
        test(`${name} is one problem naming ${names}`, () => {
            const problems = dependencyLicenceProblems(pkg, lock);
            assert.equal(problems.length, 1, problems.join('\n'));
            assert.ok(problems[0].includes(names), problems[0]);
        });
    }

    test('every problem is reported, not only the first', () => {
        const lock = cleanLock({ license: 'GPL-3.0-only', dev: true });
        lock.packages['node_modules/bar'] = { license: 'AGPL-3.0-only', dev: true };
        const problems = dependencyLicenceProblems({ ...cleanPkg(), dependencies: {} }, lock);
        assert.equal(problems.length, 3, problems.join('\n'));
    });

    test('the real package.json and package-lock.json are clean', () => {
        const problems = dependencyLicenceProblems(readJson('package.json'), readJson('package-lock.json'));
        assert.deepEqual(problems, [], problems.join('\n'));
    });
});

const JS_HEAD = '// SPDX-License-Identifier: Apache-2.0\n// SPDX-FileCopyrightText: 2026 Tony Malandain\n';
const SH_HEAD = '# SPDX-License-Identifier: Apache-2.0\n# SPDX-FileCopyrightText: 2026 Tony Malandain\n';
const CSS_HEAD = '/* SPDX-License-Identifier: Apache-2.0 */\n/* SPDX-FileCopyrightText: 2026 Tony Malandain */\n';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';
const XML_HEAD = '<!-- SPDX-License-Identifier: Apache-2.0 -->\n<!-- SPDX-FileCopyrightText: 2026 Tony Malandain -->\n';
const SHEBANG = '#!/usr/bin/env bash\n';

describe('source file headers', () => {
    // [case, path, text]: the header is right
    const GOOD = [
        ['js', 'extension/a.js', `${JS_HEAD}\nexport const a = 1;\n`],
        ['css', 'extension/stylesheet.css', `${CSS_HEAD}\n.a { color: red; }\n`],
        ['xml after the declaration', 'extension/schemas/s.xml', `${XML_DECL}${XML_HEAD}<schemalist/>\n`],
        ['sh after the shebang', 'scripts/a.sh', `${SHEBANG}${SH_HEAD}\nset -e\n`],
        ['a later year', 'extension/a.js', JS_HEAD.replace('2026', '2027')],
    ];
    for (const [name, relPath, text] of GOOD) {
        test(`${name} is accepted`, () => {
            assert.equal(headerProblem(relPath, text), null);
        });
    }

    // [case, path, text]: the header is wrong
    const BAD = [
        ['sh with the header above the shebang', 'scripts/a.sh', `${SH_HEAD}${SHEBANG}\nset -e\n`],
        ['xml with the header above the declaration', 'extension/schemas/s.xml', `${XML_HEAD}${XML_DECL}<schemalist/>\n`],
        ['a missing copyright line', 'extension/a.js', '// SPDX-License-Identifier: Apache-2.0\n\nexport const a = 1;\n'],
        ['a missing licence line', 'extension/a.js', '// SPDX-FileCopyrightText: 2026 Tony Malandain\n\nexport const a = 1;\n'],
        ['no header at all', 'extension/a.js', 'export const a = 1;\n'],
        ['the year 2025', 'extension/a.js', JS_HEAD.replace('2026', '2025')],
        ['another holder', 'extension/a.js', JS_HEAD.replace('Tony Malandain', 'Someone Else')],
        ['another licence', 'extension/a.js', JS_HEAD.replace('Apache-2.0', 'MIT')],
        ['the header lower in the file', 'extension/a.js', `export const a = 1;\n${JS_HEAD}`],
        ['js comment syntax in a css file', 'extension/stylesheet.css', JS_HEAD],
        ['an empty sh file', 'scripts/a.sh', ''],
    ];
    for (const [name, relPath, text] of BAD) {
        test(`${name} is a problem`, () => {
            const problem = headerProblem(relPath, text);
            assert.equal(typeof problem, 'string');
            assert.ok(problem.length > 0);
        });
    }

    test('an unknown file type is not skipped', () => {
        assert.equal(headerProblem('extension/a.ts', JS_HEAD), 'unsupported file type');
    });

    test('every .js, .sh, .css and .xml file in extension/, scripts/ and tests/, and eslint.config.js, has the header', () => {
        const files = ['eslint.config.js'];
        for (const dir of ['extension', 'scripts', 'tests']) {
            for (const entry of fs.readdirSync(path.join(repoRoot, dir), { recursive: true }))
                files.push(path.join(dir, entry));
        }
        const sources = files.filter(f => /\.(js|sh|css|xml)$/.test(f)).sort();
        assert.ok(sources.length > 0, 'the walk found no source files');
        const offenders = sources.flatMap(f => {
            const problem = headerProblem(f, read(f).toString('utf8'));
            return problem === null ? [] : [`${f}: ${problem}`];
        });
        assert.deepEqual(offenders, [], `${offenders.length} files without the licence header:\n${offenders.join('\n')}`);
    });
});
