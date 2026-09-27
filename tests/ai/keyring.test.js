// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The key path, headless, in a throwaway keyring on a private bus (Layer 2b,
// ADR-0009). Every key is a random throwaway value; the owner's keyring is never
// reached (tests/ai/session.js builds the environment from scratch).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createAiSession, startAiHelper, throwawayKey } from './session.js';
import { startFakeEngine } from './fakeEngine.js';

const MISSING = ['gjs', 'dbus-daemon', 'gnome-keyring-daemon']
    .filter(p => spawnSync('sh', ['-c', `command -v ${p}`]).status !== 0);
const SKIP = MISSING.length > 0
    ? `keyring tests skipped: ${MISSING.join(', ')} not available; key path checked by hand (Layer 4)`
    : false;

describe('AI helper key path', { skip: SKIP }, () => {
    let session, E1, E2, K1, keyringDir;
    const helpers = [];
    const outputs = [];

    /** A fresh helper configured to `endpoint`; returns its one reply to a probe. */
    async function probeWith(env, endpoint, options) {
        const h = startAiHelper(env, [], options);
        helpers.push(h);
        assert.deepEqual(await h.nextMessage(5000), { type: 'hello', protocol: 1 });
        h.configure(endpoint);
        h.send({ type: 'probe', id: 'k1' });
        const reply = await h.nextMessage(15000);
        h.closeStdin();
        await h.exited(5000);
        return { reply, h };
    }

    before(async () => {
        session = await createAiSession('keyring');
        keyringDir = path.join(session.home, 'data', 'keyrings');
        E1 = await startFakeEngine();
        E2 = await startFakeEngine();
        K1 = throwawayKey();
    });

    after(async () => {
        for (const h of helpers)
            h.kill();
        await E1?.close();
        await E2?.close();
        await session?.stop();
    });

    test('1. isolation: the key lands in the throwaway keyring', async () => {
        const keyringFiles = () => (fs.existsSync(keyringDir)
            ? fs.readdirSync(keyringDir).filter(f => f.endsWith('.keyring'))
            : []);
        const snapshot = () => keyringFiles().map(f => fs.readFileSync(path.join(keyringDir, f)).toString('base64')).join();
        const beforeStore = snapshot();
        await session.storeKey(E1.endpoint, K1);
        assert.ok(keyringFiles().length > 0, `no .keyring file in ${keyringDir}`);
        assert.notEqual(snapshot(), beforeStore, 'storing the key rewrote the throwaway keyring file');
    });

    test('2. the key is sent as a bearer header over loopback http', async () => {
        const { reply, h } = await probeWith({ ...session.env, G_MESSAGES_DEBUG: 'all' }, E1.endpoint,
            { skipLibraryLog: true });
        outputs.push(h.stdout(), h.stderr());
        assert.match(h.stdout(), /-DEBUG: /, 'library debug output was produced, so test 5 covers it');
        assert.equal(reply.type, 'verdict');
        assert.equal(E1.requests.length, 1);
        assert.equal(E1.requests[0].headers.authorization, 'Bearer ' + K1);
    });

    test('3. keyless: no item for the endpoint sends no header', async () => {
        const { reply, h } = await probeWith(session.env, E2.endpoint);
        outputs.push(h.stdout(), h.stderr());
        assert.equal(reply.type, 'verdict');
        assert.equal(E2.requests.length, 1);
        assert.equal(Object.hasOwn(E2.requests[0].headers, 'authorization'), false);
    });

    test('4. a key saved for another endpoint never reaches this one', () => {
        assert.equal(JSON.stringify(E2.requests).includes(K1), false);
    });

    test('5. the key never appears on the helper\'s stdout or stderr, even with library debug output', () => {
        assert.equal(outputs.length, 4);
        for (const text of outputs)
            assert.equal(text.includes(K1), false);
    });

    test('6. a locked keyring is no-key, and nothing is sent', async () => {
        await session.lockKeyring();
        const before = E1.requests.length;
        const { reply } = await probeWith(session.env, E1.endpoint);
        assert.deepEqual(reply, { type: 'failed', id: 'k1', code: 'no-key' });
        assert.equal(E1.requests.length, before);
    });

    test('7. an unreachable Secret Service is no-key, and nothing is sent', async () => {
        const before = E1.requests.length;
        const { reply } = await probeWith(session.unreachableEnv(), E1.endpoint);
        assert.deepEqual(reply, { type: 'failed', id: 'k1', code: 'no-key' });
        assert.equal(E1.requests.length, before);
    });
});
