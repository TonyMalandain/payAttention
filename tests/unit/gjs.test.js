// ADR-0002: core runs unchanged under gjs as well as Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');

test('core imports and runs under gjs', t => {
    const probe = spawnSync('gjs', ['--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) {
        t.skip('gjs not installed');
        return;
    }
    const run = spawnSync('gjs', ['-m', 'tests/unit/support/gjs-core-check.js'],
        { cwd: repoRoot, encoding: 'utf8', timeout: 20000 });
    assert.equal(run.status, 0, `gjs exited ${run.status}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.match(run.stdout, /CORE-GJS OK/);
});
