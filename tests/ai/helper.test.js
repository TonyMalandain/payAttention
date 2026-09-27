// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The AI helper process against a fake engine on 127.0.0.1 (testing-and-build.md,
// Layer 2b). Never a real engine, never the owner's bus or keyring.
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createAiSession, startAiHelper, TEST_MODEL } from './session.js';
import { startFakeEngine, chatEnvelope } from './fakeEngine.js';
import {
    hostileInvite, TITLE, CALENDAR, ORGANISER_NAME, ORGANISER_EMAIL, ROOM_NAME, ROOM_EMAIL, GUEST_COUNT,
} from './inviteFixture.js';
import { chatRequestBody } from '../../extension/ai/chat.js';
import { INVITE_FIELDS } from '../../extension/core/aiProtocol.js';
import { PROBE_INVITE } from '../../extension/core/aiPrompt.js';
import { REPLY_CORPUS } from '../unit/support/replyCorpus.js';

const MISSING = ['gjs', 'dbus-daemon', 'gnome-keyring-daemon']
    .filter(p => spawnSync('sh', ['-c', `command -v ${p}`]).status !== 0);
const SKIP = MISSING.length > 0 ? `AI helper tests skipped: ${MISSING.join(', ')} not on PATH` : false;
const NO_OPENSSL = spawnSync('sh', ['-c', 'command -v openssl']).status !== 0;

const DIAGNOSTIC_LINE = /^payattention-ai: [a-z0-9][a-z0-9._-]*( [A-Za-z0-9 ._:[\]-]*)?$/;

/** Resolves once cond() is true; rejects after timeoutMs. */
async function waitFor(cond, timeoutMs, what) {
    const until = Date.now() + timeoutMs;
    while (!cond()) {
        if (Date.now() > until)
            throw new Error(`timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

/** The raw judge line for an invite the shell side would refuse to format. */
const rawJudge = (id, invite) => JSON.stringify({ type: 'judge', id, invite }) + '\n';

/** The three invites the helper must refuse (the Step 5 cases). */
function badInvites() {
    const extra = { ...PROBE_INVITE, uid: 'x' };
    const missing = { ...PROBE_INVITE };
    delete missing.guestsTotal;
    const guests = Array.from({ length: 25 }, (_, i) => ({
        name: 'N'.repeat(78) + String(i).padStart(2, '0'),
        email: 'e'.repeat(180) + String(i).padStart(2, '0') + '@example.invalid',
        response: 'accepted', role: 'required',
    }));
    const large = { ...PROBE_INVITE, guests, guestsTotal: 25 };
    return [['b1', extra], ['b2', missing], ['b3', large]];
}

describe('AI helper process', { skip: SKIP }, () => {
    let session, engine;
    let helper = null;
    const stderrs = [];

    const start = (env = session.env, args) => {
        helper = startAiHelper(env, args);
        return helper;
    };
    const hello = async h => assert.deepEqual(await h.nextMessage(5000), { type: 'hello', protocol: 1 });

    before(async () => {
        session = await createAiSession('helper');
        engine = await startFakeEngine();
    });

    afterEach(() => {
        if (helper) {
            stderrs.push(helper.stderr());
            helper.kill();
            helper = null;
        }
    });

    after(async () => {
        await engine?.close();
        await session?.stop();
    });

    test('1. the first line is hello', async () => {
        const h = start();
        await hello(h);
    });

    test('2. any argument is a usage error: exit 2, a usage code, nothing on stdout', async () => {
        const h = start(session.env, ['--x']);
        assert.deepEqual(await h.exited(5000), { code: 2, signal: null });
        assert.match(h.stderr(), /payattention-ai: usage/);
        assert.equal(h.stdout(), '');
    });

    test('3a. closing stdin on an idle helper exits 0', async () => {
        const h = start();
        await hello(h);
        h.closeStdin();
        assert.deepEqual(await h.exited(5000), { code: 0, signal: null });
    });

    test('3b. closing stdin with a request in flight still exits 0 at once', async () => {
        const h = start();
        await hello(h);
        const before = engine.requests.length;
        engine.queue({ hold: true });
        h.configure(engine.endpoint);
        h.send({ type: 'probe', id: 'held' });
        await waitFor(() => engine.requests.length === before + 1, 5000, 'the held request');
        h.closeStdin();
        assert.deepEqual(await h.exited(5000), { code: 0, signal: null });
    });

    test('4. invite proof: exactly the invite, bounded, cleaned, and no key header', async () => {
        const invite = hostileInvite();
        const h = start();
        await hello(h);
        const before = engine.requests.length;
        h.configure(engine.endpoint);
        h.send({ type: 'judge', id: 'inv1', invite });
        assert.deepEqual(await h.nextMessage(10000),
            { type: 'verdict', id: 'inv1', verdict: 'must', reason: 'fake engine' });
        assert.equal(engine.requests.length, before + 1);
        const req = engine.requests.at(-1);
        assert.equal(req.method, 'POST');
        assert.equal(req.path, '/v1/chat/completions');
        assert.match(req.headers['content-type'], /^application\/json/);
        assert.equal(Object.hasOwn(req.headers, 'authorization'), false);

        const body = JSON.parse(req.body);
        assert.deepEqual(body, JSON.parse(chatRequestBody(TEST_MODEL, invite, true)));
        const user = body.messages[1].content;
        assert.equal(user, JSON.stringify(invite));
        assert.ok(Buffer.byteLength(user) <= 8192);
        const sent = JSON.parse(user);
        assert.deepEqual(Object.keys(sent), INVITE_FIELDS.map(f => f.key));

        for (const s of [CALENDAR, ORGANISER_NAME, ORGANISER_EMAIL, 'Guest 01', 'https://zoom.us/j/123456789', '[removed]'])
            assert.ok(req.body.includes(s), `the request lacks ${s}`);
        for (const s of ['?pwd=', 'AbCdEf', ROOM_NAME, ROOM_EMAIL])
            assert.equal(req.body.includes(s), false, `the request carries ${s}`);
        // The Zoom meeting id 123456789 contains the passcode's digits; the passcode itself must be gone.
        assert.equal(req.body.replaceAll('123456789', '').includes('123456'), false, 'the request carries the passcode');
        assert.equal(sent.guests.length, 25);
        assert.equal(sent.guestsTotal, GUEST_COUNT);
        assert.equal(Array.from(sent.description).length, 1500);
        for (const key of ['tools', 'functions', 'stream'])
            assert.equal(Object.hasOwn(body, key), false, key);
    });

    test('5. probe sends the fixed probe invite', async () => {
        const h = start();
        await hello(h);
        h.configure(engine.endpoint);
        h.send({ type: 'probe', id: 'p1' });
        const reply = await h.nextMessage(10000);
        assert.equal(reply.type, 'verdict');
        assert.equal(reply.id, 'p1');
        assert.equal(JSON.parse(engine.requests.at(-1).body).messages[1].content, JSON.stringify(PROBE_INVITE));
    });

    test('6. bad requests reach no engine', async () => {
        const h = start();
        await hello(h);
        h.configure(engine.endpoint);
        const before = engine.requests.length;
        for (const [id, invite] of badInvites()) {
            h.sendRaw(rawJudge(id, invite));
            assert.deepEqual(await h.nextMessage(5000), { type: 'failed', id, code: 'bad-request' });
        }
        assert.equal(engine.requests.length, before);
    });

    test('7. privacy: stderr carries codes only, never meeting text', () => {
        const text = stderrs.join('');
        assert.ok(text.length > 0, 'the tests above produced diagnostics');
        for (const s of [TITLE, CALENDAR, ORGANISER_NAME, ORGANISER_EMAIL, 'Guest 01', 'guest01@example.invalid',
            ROOM_NAME, 'fake engine', '127.0.0.1'])
            assert.equal(text.includes(s), false, `stderr carries ${s}`);
        for (const line of text.split('\n').filter(l => l.startsWith('payattention-ai:')))
            assert.match(line, DIAGNOSTIC_LINE);
    });
});

test('the Soup session has no timer of its own: the deadline is the only one', { skip: SKIP }, () => {
    // libsoup 3 defaults timeout to 60 s, which cut a slow local engine off as network before its deadline.
    // idle-timeout is not asserted: it only closes pooled connections with no request in flight.
    const probe = path.join(import.meta.dirname, 'gjs/sessionTimers.js');
    const run = spawnSync('gjs', ['-m', probe], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout.trim()).timeout, 0);
});

describe('AI helper failures, through the real Soup stack', { skip: SKIP }, () => {
    let session, engine;
    let helper = null;

    /** A fresh helper configured to `endpoint`, past its hello. */
    async function configured(endpoint = engine.endpoint, timeoutMs = 10000) {
        helper = startAiHelper(session.env);
        assert.deepEqual(await helper.nextMessage(5000), { type: 'hello', protocol: 1 });
        helper.configure(endpoint, timeoutMs);
        return helper;
    }

    /** Queue the handlers, send one judge, and return its one reply. */
    async function judgeWith(...handlers) {
        const h = await configured();
        engine.queue(...handlers);
        h.send({ type: 'probe', id: 'f1' });
        return h.nextMessage(10000);
    }

    const failed = (code, extra = {}) => ({ type: 'failed', id: 'f1', code, ...extra });

    before(async () => {
        session = await createAiSession('failures');
        engine = await startFakeEngine();
    });

    afterEach(() => {
        helper?.kill();
        helper = null;
    });

    after(async () => {
        await engine?.close();
        await session?.stop();
    });

    test('late: failed timeout within timeoutMs + 1 s', async () => {
        const h = await configured(engine.endpoint, 1500);
        engine.queue({ delayMs: 5000, status: 200, body: chatEnvelope('{"verdict":"must","reason":"late"}') });
        const sentAt = Date.now();
        h.send({ type: 'probe', id: 'f1' });
        assert.deepEqual(await h.nextMessage(10000), failed('timeout'));
        const elapsed = Date.now() - sentAt;
        assert.ok(elapsed >= 1400 && elapsed <= 2500, `replied after ${elapsed} ms`);
    });

    test('401 and 403 are auth', async () => {
        assert.deepEqual(await judgeWith({ status: 401, body: '{}' }), failed('auth'));
        helper.kill();
        assert.deepEqual(await judgeWith({ status: 403, body: '{}' }), failed('auth'));
    });

    test('429 and 402 are rate-limited, with retryAfterS only from Retry-After seconds', async () => {
        assert.deepEqual(await judgeWith({ status: 429, headers: { 'Retry-After': '7' }, body: '{}' }),
            failed('rate-limited', { retryAfterS: 7 }));
        helper.kill();
        assert.deepEqual(await judgeWith({ status: 429, body: '{}' }), failed('rate-limited'));
        helper.kill();
        assert.deepEqual(await judgeWith({ status: 402, body: '{}' }), failed('rate-limited'));
    });

    test('500 is server; 404 is config', async () => {
        assert.deepEqual(await judgeWith({ status: 500, body: 'oops' }), failed('server'));
        helper.kill();
        assert.deepEqual(await judgeWith({ status: 404, body: 'no' }), failed('config'));
    });

    test('a 302 is config, and the redirect is not followed', async () => {
        const before = engine.requests.length;
        const location = engine.endpoint.replace(/\/v1$/, '/elsewhere');
        assert.deepEqual(await judgeWith({ status: 302, headers: { Location: location }, body: '' }), failed('config'));
        assert.equal(engine.requests.length, before + 1);
    });

    test('a closed port is network', async () => {
        const probe = net.createServer();
        await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
        const { port } = probe.address();
        await new Promise(resolve => probe.close(resolve));
        const h = await configured(`http://127.0.0.1:${port}/v1`);
        h.send({ type: 'probe', id: 'f1' });
        assert.deepEqual(await h.nextMessage(10000), failed('network'));
    });

    test('a non-JSON body and a body over 1 MiB are bad-reply', async () => {
        assert.deepEqual(await judgeWith({ status: 200, body: 'not json at all' }), failed('bad-reply'));
        helper.kill();
        // A valid verdict padded past the cap: only MAX_RESPONSE_BYTES can make this bad-reply.
        const big = JSON.stringify({
            choices: [{ message: { content: '{"verdict":"must","reason":"big"}' } }], pad: 'x'.repeat(2 * 1024 * 1024),
        });
        assert.deepEqual(await judgeWith({ status: 200, body: big }), failed('bad-reply'));
    });

    test('after a body over 1 MiB the connection is closed, not left half read', async () => {
        const big = JSON.stringify({ pad: 'x'.repeat(4 * 1024 * 1024) });
        assert.deepEqual(await judgeWith({ status: 200, body: big }), failed('bad-reply'));
        const record = engine.requests.at(-1);
        // The helper is still running: only its own close can end the connection.
        await waitFor(() => record.socketClosedAt !== undefined, 3000, 'the oversize connection to close');
    });

    test('fenced JSON and a leading think block are read', async () => {
        const fenced = await judgeWith({ status: 200, body: chatEnvelope('```json\n{"verdict":"ignore","reason":"fenced"}\n```') });
        assert.deepEqual(fenced, { type: 'verdict', id: 'f1', verdict: 'ignore', reason: 'fenced' });
        helper.kill();
        const think = await judgeWith({ status: 200,
            body: chatEnvelope('<think>the owner is the host</think>\n{"verdict":"must","reason":"thought"}') });
        assert.deepEqual(think, { type: 'verdict', id: 'f1', verdict: 'must', reason: 'thought' });
    });

    test('a 400 naming response_format: one retry without it, and it stays off', async () => {
        const before = engine.requests.length;
        const reply = await judgeWith({ status: 400, body: '{"error":{"message":"response_format is not supported"}}' });
        assert.equal(reply.type, 'verdict');
        assert.equal(engine.requests.length, before + 2);
        const [first, second] = engine.requests.slice(-2).map(r => JSON.parse(r.body));
        assert.ok(Object.hasOwn(first, 'response_format'));
        assert.equal(Object.hasOwn(second, 'response_format'), false);
        delete first.response_format;
        assert.deepEqual(second, first);

        helper.send({ type: 'probe', id: 'f2' });
        assert.equal((await helper.nextMessage(10000)).type, 'verdict');
        assert.equal(engine.requests.length, before + 3);
        assert.equal(Object.hasOwn(JSON.parse(engine.requests.at(-1).body), 'response_format'), false);
    });

    test('a self-signed certificate is tls, and nothing reaches the engine', { skip: NO_OPENSSL && 'openssl not on PATH' },
        async () => {
            const keyFile = path.join(session.home, 'k.pem');
            const certFile = path.join(session.home, 'c.pem');
            const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile,
                '-out', certFile, '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
            assert.equal(made.status, 0, 'openssl made the throwaway certificate');
            const tlsEngine = await startFakeEngine({
                tls: { key: fs.readFileSync(keyFile, 'utf8'), cert: fs.readFileSync(certFile, 'utf8') },
            });
            try {
                const h = await configured(tlsEngine.endpoint);
                h.send({ type: 'probe', id: 'f1' });
                assert.deepEqual(await h.nextMessage(10000), failed('tls'));
                assert.equal(tlsEngine.requests.length, 0);
            } finally {
                await tlsEngine.close();
            }
        });
});

describe('AI helper injection corpus (the same corpus as core, Layer 1)', { skip: SKIP }, () => {
    let session, engine, helper;

    before(async () => {
        session = await createAiSession('corpus');
        engine = await startFakeEngine();
        helper = startAiHelper(session.env);
        assert.deepEqual(await helper.nextMessage(5000), { type: 'hello', protocol: 1 });
        helper.configure(engine.endpoint);
    });

    after(async () => {
        helper?.kill();
        await engine?.close();
        await session?.stop();
    });

    // nextMessage refuses any line with a key §6.6 does not allow, so each reply is proven to be only a verdict.
    REPLY_CORPUS.forEach((entry, i) => {
        test(`${i}: ${entry.name}`, async () => {
            // The content goes into the envelope as it is, even when it is not a string.
            engine.queue({ status: 200, body: chatEnvelope(entry.text) });
            helper.send({ type: 'judge', id: `c${i}`, invite: PROBE_INVITE });
            const want = entry.expected === null
                ? { type: 'failed', id: `c${i}`, code: 'bad-reply' }
                : { type: 'verdict', id: `c${i}`, ...entry.expected };
            assert.deepEqual(await helper.nextMessage(10000), want);
        });
    });
});
