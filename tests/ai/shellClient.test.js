// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The shell's AI helper client (shell/aiHelperClient.js) against the real AI
// helper and a fake engine on 127.0.0.1 (testing-and-build.md, Layer 2b).
// Never a real engine, never the owner's bus or keyring.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { createAiSession } from './session.js';
import { startFakeEngine } from './fakeEngine.js';
import { PROBE_INVITE } from '../../extension/core/aiPrompt.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const SCRIPT = 'tests/ai/gjs/shellClient.js';
const RUN_CAP_MS = 20_000;

const MISSING = ['gjs', 'dbus-daemon', 'gnome-keyring-daemon']
    .filter(p => spawnSync('sh', ['-c', `command -v ${p}`]).status !== 0);
const SKIP = MISSING.length > 0 ? `AI client tests skipped: ${MISSING.join(', ')} not on PATH` : false;

/** Runs the gjs driver for one scenario; resolves once it has printed DONE and exited. */
function runScenario(scenario, endpoint, env) {
    return new Promise((resolve, reject) => {
        const child = spawn('gjs', ['-m', SCRIPT, scenario, endpoint], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.setEncoding('utf8').on('data', d => (stdout += d));
        child.stderr.setEncoding('utf8').on('data', d => (stderr += d));
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`${scenario}: no DONE within ${RUN_CAP_MS} ms\nstdout: ${stdout}\nstderr: ${stderr}`));
        }, RUN_CAP_MS);
        child.once('exit', code => {
            clearTimeout(timer);
            const lines = stdout.split('\n');
            if (!lines.includes('DONE'))
                reject(new Error(`${scenario}: exited ${code} without DONE\nstdout: ${stdout}\nstderr: ${stderr}`));
            else
                resolve({ code, stdout, stderr, lines });
        });
    });
}

const outcomes = r => r.lines.filter(l => l.startsWith('OUTCOME ')).map(l => JSON.parse(l.slice('OUTCOME '.length)));
const printed = (r, prefix) => r.lines.filter(l => l.startsWith(prefix + ' ')).map(l => l.slice(prefix.length + 1));
const userMessage = request => JSON.parse(request.body).messages.find(m => m.role === 'user').content;
const VERDICT = { type: 'verdict', verdict: 'must', reason: 'fake engine' };

describe('shell AI helper client', { skip: SKIP }, () => {
    let session, engine;

    before(async () => {
        session = await createAiSession('shell-client');
        engine = await startFakeEngine();
    });

    after(async () => {
        await engine?.close();
        await session?.stop();
    });

    const run = async (scenario, extraEnv = {}) => {
        const r = await runScenario(scenario, engine.endpoint, { ...session.env, ...extraEnv });
        // No invite or reason text is ever logged.
        assert.ok(!r.stderr.includes('Connection test') && !r.stderr.includes('fake engine'), r.stderr);
        return r;
    };

    test('1. a verdict, for exactly the invite that was asked about', async () => {
        const before = engine.requests.length;
        const r = await run('verdict');
        assert.deepEqual(outcomes(r), [VERDICT]);
        const sent = engine.requests.slice(before);
        assert.equal(sent.length, 1);
        assert.equal(userMessage(sent[0]), JSON.stringify(PROBE_INVITE));
        assert.ok(!r.stderr.includes('configure-again') && !r.stderr.includes('not-configured'), r.stderr);
    });

    test('2. two asks in a row: one helper, configured once', async () => {
        const before = engine.requests.length;
        const r = await run('sequence');
        assert.deepEqual(outcomes(r), [VERDICT, VERDICT]);
        assert.equal(engine.requests.length - before, 2);
        assert.ok(!r.stderr.includes('configure-again'), r.stderr);
    });

    test('3. failures carry their code, and retryAfterS only when given', async () => {
        engine.queue({ status: 401, body: '{}' }, { status: 429, headers: { 'retry-after': '7' }, body: '{}' });
        const r = await run('failed');
        assert.deepEqual(outcomes(r), [
            { type: 'failed', code: 'auth' },
            { type: 'failed', code: 'rate-limited', retryAfterS: 7 },
        ]);
    });

    test('4. kill drops the outstanding ask; the next ask respawns after the restart delay', async () => {
        const before = engine.requests.length;
        engine.queue({ hold: true });
        const r = await run('kill');
        assert.deepEqual(outcomes(r), [VERDICT]);
        assert.deepEqual(printed(r, 'READY'), ['false', 'true']);
        assert.equal(engine.requests.length - before, 2);
    });

    test('5. a helper that exits: the ask is lost, and a restart waits', async () => {
        const r = await run('exit');
        assert.deepEqual(outcomes(r), [{ type: 'lost' }]);
        assert.deepEqual(printed(r, 'READY'), ['false', 'true']);
    });

    test('6. a helper that cannot start: lost, and never synchronously', async () => {
        const r = await run('spawn-failed');
        const events = r.lines.filter(l => l === 'ASKED' || l.startsWith('OUTCOME '));
        assert.deepEqual(events, ['ASKED', 'OUTCOME {"type":"lost"}']);
    });

    test('7. an invalid invite is refused before anything is started or sent', async () => {
        const before = engine.requests.length;
        const r = await run('bad-invite');
        assert.deepEqual(outcomes(r), [{ type: 'failed', code: 'bad-request' }]);
        assert.equal(engine.requests.length, before);
        assert.deepEqual(printed(r, 'CHILDREN'), ['0']);
    });

    test('8. destroy: no outcome afterwards, and no helper left', async () => {
        engine.queue({ hold: true });
        const r = await run('destroy');
        assert.deepEqual(outcomes(r), []);
        assert.deepEqual(printed(r, 'CHILDREN'), ['0']);
    });

    test('9. the helper is started without G_MESSAGES_DEBUG (interfaces.md §1)', async () => {
        const r = await run('debug-env', { G_MESSAGES_DEBUG: 'all' });
        assert.deepEqual(outcomes(r), [VERDICT]);
        assert.deepEqual(printed(r, 'CHILDREN'), ['1']);
        assert.deepEqual(printed(r, 'CHILD-ENV'), ['clean']);
        assert.ok(!r.stderr.includes('ai-invalid-line'), r.stderr);
        const hostPort = engine.endpoint.replace(/^http:\/\//, '').replace(/\/v1$/, '');
        assert.ok(!r.stdout.includes(hostPort) && !r.stderr.includes(hostPort), 'the endpoint never reaches a log');
    });
});
