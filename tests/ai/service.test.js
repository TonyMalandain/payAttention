// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The AI helper's protocol conversation (interfaces.md §6.6, §6.7), with every
// I/O part faked: no network, no keyring, no clock.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../../extension/ai/service.js';
import { chatUrl, chatRequestBody } from '../../extension/ai/chat.js';
import { formatAiHelperMessage } from '../../extension/core/aiProtocol.js';
import { PROBE_INVITE } from '../../extension/core/aiPrompt.js';

const LOOPBACK = 'http://127.0.0.1:1/v1';
const MODEL = 'test-model';
const TITLE = 'Quarterly secret merger review';
const REASON = 'fake engine reason text';
const KEY = 'pa-unit-key-5d1c';

// A valid invite with recognisable text, so case 14 can look for it in the diagnostics.
const INVITE = {
    ...structuredClone(PROBE_INVITE),
    title: TITLE,
    description: 'Discuss the deal with Zed',
    organiser: { name: 'Olga Organiser', email: 'olga@example.invalid' },
};

const envelope = content => JSON.stringify({ choices: [{ message: { content } }] });
const VERDICT = { ok: true, status: 200, retryAfter: null, body: envelope(JSON.stringify({ verdict: 'must', reason: REASON })) };
const FORMAT_400 = { ok: true, status: 400, retryAfter: null, body: '{"error":{"message":"response_format is not supported"}}' };

const configure = (endpoint = LOOPBACK, timeoutMs = 10000) =>
    JSON.stringify({ type: 'configure', protocol: 1, endpoint, model: MODEL, timeoutMs });
const judge = (id, invite = INVITE) => JSON.stringify({ type: 'judge', id, invite });
const probe = id => JSON.stringify({ type: 'probe', id });

const allDiagnostics = [];
const secrets = [TITLE, 'Discuss the deal', 'Olga Organiser', 'olga@example.invalid', REASON, KEY,
    '127.0.0.1', 'example.test', '10.0.0.5', 'gpu.lan'];

/**
 * A service over fakes. `posts` is the script for post(): each entry is a
 * PostResult, or {advanceMs, result}, or a function (request) => Promise<PostResult>.
 */
function harness({ lookup = { state: 'absent' }, lookupAdvanceMs = 0, posts = [] } = {}) {
    const h = { sent: [], diagnostics: [], lookups: [], requests: [], clock: 1_000_000, fatal: 0 };
    const script = [...posts];
    h.service = new AiService({
        send: m => {
            formatAiHelperMessage(m); // throws on anything the shell would refuse
            h.sent.push(m);
        },
        diagnose: (code, detail) => {
            h.diagnostics.push([code, detail]);
            allDiagnostics.push([code, detail]);
        },
        lookupKey: async endpoint => {
            h.lookups.push(endpoint);
            h.clock += lookupAdvanceMs;
            return lookup;
        },
        post: async request => {
            h.requests.push(request);
            const next = script.shift() ?? VERDICT;
            if (typeof next === 'function')
                return next(request);
            if (Object.hasOwn(next, 'advanceMs')) {
                h.clock += next.advanceMs;
                return next.result;
            }
            return next;
        },
        now: () => h.clock,
        onFatal: () => h.fatal++,
    });
    h.line = line => h.service.handleLine(line);
    return h;
}

const codes = h => h.diagnostics.map(d => d[0]);

describe('AiService', () => {
    test('1. a judge before configure is failed config, and nothing is posted', async () => {
        const h = harness();
        await h.line(judge('j1'));
        assert.deepEqual(h.sent, [{ type: 'failed', id: 'j1', code: 'config' }]);
        assert.deepEqual(codes(h), ['not-configured']);
        assert.equal(h.requests.length, 0);
    });

    test('2. configure gives no reply; a probe posts the probe invite and replies with the verdict', async () => {
        const h = harness();
        await h.line(configure());
        assert.deepEqual(h.sent, []);
        await h.line(probe('p1'));
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].url, chatUrl(LOOPBACK));
        assert.equal(h.requests[0].body, chatRequestBody(MODEL, PROBE_INVITE, true));
        assert.equal(h.requests[0].timeoutMs, 10000);
        assert.deepEqual(h.sent, [{ type: 'verdict', id: 'p1', verdict: 'must', reason: REASON }]);
    });

    test('3. a second configure is ignored; the first engine stays', async () => {
        const h = harness();
        await h.line(configure());
        await h.line(configure('https://engine.example.test/v1'));
        assert.deepEqual(codes(h), ['configure-again']);
        assert.deepEqual(h.sent, []);
        await h.line(judge('j1'));
        assert.equal(h.requests[0].url, chatUrl(LOOPBACK));
    });

    test('4. an invalid configure leaves the service unconfigured', async () => {
        const h = harness();
        await h.line(configure(LOOPBACK, 500));
        assert.deepEqual(h.diagnostics, [['bad-command', 'invalid-configure']]);
        assert.deepEqual(h.sent, []);
        await h.line(judge('j1'));
        assert.deepEqual(h.sent, [{ type: 'failed', id: 'j1', code: 'config' }]);
        assert.equal(h.requests.length, 0);
    });

    test('5. an invite with an extra key, a missing key, or over 8 192 bytes is bad-request, never posted', async () => {
        const extra = { ...INVITE, uid: 'x' };
        const missing = { ...INVITE };
        delete missing.guestsTotal;
        const guests = Array.from({ length: 25 }, (_, i) => ({
            name: 'N'.repeat(78) + String(i).padStart(2, '0'),
            email: 'e'.repeat(180) + String(i).padStart(2, '0') + '@example.invalid',
            response: 'accepted', role: 'required',
        }));
        const large = { ...INVITE, guests, guestsTotal: 25 };
        assert.ok(Buffer.byteLength(JSON.stringify(large)) > 8192);
        for (const [id, invite] of [['x1', extra], ['x2', missing], ['x3', large]]) {
            const h = harness();
            await h.line(configure());
            await h.line(judge(id, invite));
            assert.deepEqual(h.sent, [{ type: 'failed', id, code: 'bad-request' }], id);
            assert.deepEqual(h.diagnostics, [['bad-command', 'bad-invite']], id);
            assert.equal(h.requests.length, 0, id);
        }
    });

    test('6. a bad id or a non-JSON line gets no reply at all', async () => {
        const h = harness();
        await h.line(configure());
        await h.line(judge('bad id!'));
        await h.line('{not json');
        assert.deepEqual(h.sent, []);
        assert.deepEqual(h.diagnostics, [['bad-command', 'invalid-judge'], ['bad-command', 'bad-json']]);
        assert.equal(h.requests.length, 0);
    });

    test('7. the key is looked up only where a key may be sent', async () => {
        for (const endpoint of [LOOPBACK, 'https://engine.example.test/v1']) {
            const h = harness();
            await h.line(configure(endpoint));
            await h.line(judge('j1'));
            assert.deepEqual(h.lookups, [endpoint]);
        }
        for (const endpoint of ['http://10.0.0.5:8080/v1', 'http://gpu.lan/v1']) {
            const h = harness({ lookup: { state: 'found', key: KEY } });
            await h.line(configure(endpoint));
            await h.line(judge('j1'));
            assert.deepEqual(h.lookups, [], endpoint);
            assert.equal(h.requests[0].bearer, null, endpoint);
            assert.equal(h.sent[0].type, 'verdict');
        }
    });

    test('8. what each lookup result does', async () => {
        const run = async lookup => {
            const h = harness({ lookup });
            await h.line(configure());
            await h.line(judge('j1'));
            return h;
        };
        let h = await run({ state: 'unavailable' });
        assert.deepEqual(h.sent, [{ type: 'failed', id: 'j1', code: 'no-key' }]);
        assert.equal(h.requests.length, 0);
        h = await run({ state: 'found', key: 'a b' });
        assert.deepEqual(h.sent, [{ type: 'failed', id: 'j1', code: 'config' }]);
        assert.equal(h.requests.length, 0);
        h = await run({ state: 'found', key: 'k1' });
        assert.equal(h.requests[0].bearer, 'k1');
        h = await run({ state: 'absent' });
        assert.equal(h.requests[0].bearer, null);
        assert.equal(h.sent[0].type, 'verdict');
    });

    test('9. a 400 naming response_format retries once without it, and it stays off', async () => {
        const h = harness({ posts: [FORMAT_400] });
        await h.line(configure());
        await h.line(judge('j1'));
        assert.equal(h.requests.length, 2);
        assert.equal(h.requests[0].body, chatRequestBody(MODEL, INVITE, true));
        assert.equal(h.requests[1].body, chatRequestBody(MODEL, INVITE, false));
        assert.deepEqual(h.sent, [{ type: 'verdict', id: 'j1', verdict: 'must', reason: REASON }]);
        await h.line(judge('j2'));
        assert.equal(h.requests[2].body, chatRequestBody(MODEL, INVITE, false));

        const plain = harness({ posts: [{ ok: true, status: 400, retryAfter: null, body: '{"error":"bad model"}' }] });
        await plain.line(configure());
        await plain.line(judge('j1'));
        assert.equal(plain.requests.length, 1);
        assert.deepEqual(plain.sent, [{ type: 'failed', id: 'j1', code: 'config' }]);
    });

    test('10. one deadline covers the lookup, the request and the retry', async () => {
        let h = harness({ posts: [{ advanceMs: 9000, result: FORMAT_400 }] });
        await h.line(configure());
        await h.line(judge('j1'));
        assert.deepEqual(h.requests.map(r => r.timeoutMs), [10000, 1000]);
        assert.equal(h.sent[0].type, 'verdict');

        h = harness({ posts: [{ advanceMs: 10000, result: FORMAT_400 }] });
        await h.line(configure());
        await h.line(judge('j1'));
        assert.equal(h.requests.length, 1);
        assert.deepEqual(h.sent, [{ type: 'failed', id: 'j1', code: 'timeout' }]);

        h = harness({ lookupAdvanceMs: 4000 });
        await h.line(configure());
        await h.line(judge('j1'));
        assert.equal(h.requests[0].timeoutMs, 6000);
    });

    test('11. requests run one at a time, in arrival order', async () => {
        let release;
        const first = new Promise(resolve => (release = resolve));
        const h = harness({ posts: [() => first] });
        await h.line(configure());
        const a = h.line(judge('j1'));
        const b = h.line(judge('j2'));
        for (let i = 0; i < 20; i++)
            await Promise.resolve();
        assert.equal(h.requests.length, 1, 'the second post waited for the first');
        release(VERDICT);
        await Promise.all([a, b]);
        assert.equal(h.requests.length, 2);
        assert.deepEqual(h.sent.map(m => m.id), ['j1', 'j2']);
    });

    test('12. failures are replied with their code, and diagnosed as codes', async () => {
        let h = harness({ posts: [{ ok: false, code: 'tls' }] });
        await h.line(configure());
        await h.line(judge('j1'));
        assert.deepEqual(h.sent, [{ type: 'failed', id: 'j1', code: 'tls' }]);
        assert.deepEqual(h.diagnostics, [['request-failed', 'tls']]);

        h = harness({ posts: [{ ok: true, status: 429, retryAfter: '7', body: '' }] });
        await h.line(configure());
        await h.line(judge('j1'));
        assert.deepEqual(h.sent, [{ type: 'failed', id: 'j1', code: 'rate-limited', retryAfterS: 7 }]);
        assert.deepEqual(h.diagnostics, [['request-failed', 'rate-limited 429']]);
    });

    test('13. a post that rejects is fatal once, and later lines are still handled', async () => {
        const h = harness({ posts: [() => Promise.reject(new TypeError('programming error'))] });
        await h.line(configure());
        await h.line(judge('j1'));
        assert.equal(h.fatal, 1);
        await h.line(judge('j2'));
        assert.equal(h.fatal, 1);
        assert.deepEqual(h.sent, [{ type: 'verdict', id: 'j2', verdict: 'must', reason: REASON }]);
    });

    // Last on purpose: the tests in a describe run in order, so this sees every diagnostic above.
    test('14. nothing is logged but codes', () => {
        assert.ok(allDiagnostics.length > 10);
        const text = JSON.stringify(allDiagnostics);
        for (const s of secrets)
            assert.equal(text.includes(s), false, `a diagnostic carries ${s}`);
    });
});
