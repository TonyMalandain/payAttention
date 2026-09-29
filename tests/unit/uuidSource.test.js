// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// PG-10 (D-034): extension/metadata.json is the only file of code that spells out
// the extension's UUID. Scripts, tests and the build read it from there, so a
// later change of ID is one edit. Docs may name it for readers and are not walked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const METADATA = path.join('extension', 'metadata.json');
const CODE_DIRS = ['extension', 'scripts', 'tests'];
const CODE_FILES = ['eslint.config.js', 'package.json', 'package-lock.json'];

test('metadata.json declares a payattention@ UUID', () => {
    const { uuid } = JSON.parse(fs.readFileSync(path.join(repoRoot, METADATA), 'utf8'));
    assert.match(uuid, /^payattention@[a-z0-9.-]+$/);
});

test('no file of code other than extension/metadata.json spells out the UUID', () => {
    const { uuid } = JSON.parse(fs.readFileSync(path.join(repoRoot, METADATA), 'utf8'));
    const files = [...CODE_FILES];
    for (const dir of CODE_DIRS) {
        for (const entry of fs.readdirSync(path.join(repoRoot, dir), { recursive: true, withFileTypes: true })) {
            if (entry.isFile())
                files.push(path.relative(repoRoot, path.join(entry.parentPath, entry.name)));
        }
    }
    assert.ok(files.length > CODE_FILES.length, 'the walk found no files');
    const offenders = files
        .filter(f => f !== METADATA)
        .filter(f => fs.readFileSync(path.join(repoRoot, f), 'utf8').includes(uuid))
        .sort();
    assert.deepEqual(offenders, [], `read the UUID from ${METADATA} instead:\n${offenders.join('\n')}`);
});
