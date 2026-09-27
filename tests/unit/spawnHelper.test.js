// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// interfaces.md §1 "Environment": a helper started by the shell never inherits
// G_MESSAGES_DEBUG, which would put library log lines (the AI endpoint among
// them) on its stdout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');

test('spawnHelper removes G_MESSAGES_DEBUG and pipes stdin and stdout', t => {
    const probe = spawnSync('gjs', ['--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) {
        t.skip('gjs not installed');
        return;
    }
    const run = spawnSync('gjs', ['-m', 'tests/unit/support/gjs-spawn-check.js'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, G_MESSAGES_DEBUG: 'all' },
    });
    const out = `stdout: ${run.stdout}\nstderr: ${run.stderr}`;
    assert.equal(run.status, 0, `gjs exited ${run.status}\n${out}`);
    const lines = run.stdout.split('\n');
    assert.ok(lines.includes('PARENT all'), `the variable really was set\n${out}`);
    assert.ok(lines.includes('CHILD UNSET'), out);
    assert.ok(lines.includes('ECHO ping'), out);
    assert.ok(lines.includes('SPAWN-CHECK OK'), out);
});
