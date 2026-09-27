// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The endpoint rules and the AI-mode switch (interfaces.md §6.4, §6.7). Getting
// mayCarryKey wrong sends an API key over plain http, so every rule has a row here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AI_TIMEOUT_MS, normaliseEndpoint, endpointClass, isUsableEndpoint, mayCarryKey, requestTimeoutMs,
    normaliseModel, aiEngine,
} from '../../extension/core/aiEngine.js';
import { DEFAULT_SETTINGS } from '../../extension/core/defaults.js';

describe('normaliseEndpoint', () => {
    const kept = [
        ['HTTP://LocalHost:11434/v1/', 'http://localhost:11434/v1'],
        ['https://API.example.com:443/v1', 'https://api.example.com/v1'],
        ['http://localhost:11434/v1/', 'http://localhost:11434/v1'],
        ['https://h.example.test/', 'https://h.example.test'],
        ['http://[::1]:8080/v1', 'http://[::1]:8080/v1'],
        ['http://[FE80::1]/', 'http://[fe80::1]'],
        ['https://h.test:0443/v1', 'https://h.test/v1'],
        ['  https://h.test/v1  ', 'https://h.test/v1'],
        ['http://h.test:80/x', 'http://h.test/x'],
        ['https://h.test:8443/Path/V1//', 'https://h.test:8443/Path/V1'],
        ['https://host.test./v1', 'https://host.test/v1'],
    ];
    for (const [input, expected] of kept) {
        test(`${JSON.stringify(input)} → ${expected}`, () => {
            assert.equal(normaliseEndpoint(input), expected);
        });
    }

    const refused = ['ftp://h.test', 'https://u:p@h.test', 'https://h.test/v1?x=1', 'https://h.test/#a',
        'https://h.test:70000', 'https://h.test:abc', 'https://[::1%eth0]/', 'https://[::ffff:127.0.0.1]/',
        'https://h_t.test', 'https://h.test/a b', 'https://h..test', '', 42, null, 'localhost:11434',
        'https://h.test:0', 'https://', 'https://h.test/a\\b', 'https://h.test/a\u0007', 'https://[1:2:3]/',
        'https://[1::2::3]/', 'https://h.test:123456'];
    for (const input of refused) {
        test(`${JSON.stringify(input)} → null`, () => {
            assert.equal(normaliseEndpoint(input), null);
        });
    }
});

describe('endpointClass', () => {
    const cases = {
        loopback: ['localhost', '127.0.0.1', '127.9.9.9', '[::1]', '[0:0:0:0:0:0:0:1]'],
        private: ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '100.64.0.1', '100.127.255.255',
            '169.254.1.1', '[fd00::1]', '[fe80::1]', 'gpu-box', 'nas.local', 'x.lan', 'y.internal', 'z.home.arpa'],
        public: ['172.32.0.1', '100.128.0.1', '8.8.8.8', '010.0.0.1', '127.1', 'api.example.test', 'foo.localhost',
            '[2001:db8::1]', '0.0.0.0'],
    };
    for (const [cls, hosts] of Object.entries(cases)) {
        for (const host of hosts) {
            test(`${host} is ${cls}`, () => {
                assert.equal(endpointClass(`https://${host}/v1`), cls);
            });
        }
    }

    test('an endpoint that does not normalise has no class', () => {
        assert.equal(endpointClass('ftp://h.test'), null);
        assert.equal(endpointClass(undefined), null);
    });
});

describe('isUsableEndpoint', () => {
    const rows = [
        ['https://127.0.0.1/v1', true],
        ['https://10.0.0.2/v1', true],
        ['https://api.example.test/v1', true],
        ['http://127.0.0.1:11434/v1', true],
        ['http://192.168.1.10:11434/v1', true],
        ['http://api.example.test/v1', false],
        [null, false],
        ['ftp://127.0.0.1', false],
    ];
    for (const [url, expected] of rows) {
        test(`${url} → ${expected}`, () => {
            assert.equal(isUsableEndpoint(url), expected);
        });
    }
});

describe('mayCarryKey', () => {
    const rows = [
        ['https://api.example.test/v1', true],
        ['https://10.0.0.2/v1', true],
        ['http://127.0.0.1:11434/v1', true],
        ['http://localhost:11434/v1', true],
        ['http://192.168.1.10:11434/v1', false],
        ['http://gpu-box:11434/v1', false],
        ['http://api.example.test/v1', false],
        ['not a url', false],
        [null, false],
    ];
    for (const [url, expected] of rows) {
        test(`${url} → ${expected}`, () => {
            assert.equal(mayCarryKey(url), expected);
        });
    }
});

describe('requestTimeoutMs', () => {
    test('the timeouts', () => {
        assert.equal(requestTimeoutMs('http://127.0.0.1:11434/v1'), 90000);
        assert.equal(requestTimeoutMs('http://192.168.1.10/v1'), 90000);
        assert.equal(requestTimeoutMs('https://api.example.test/v1'), 45000);
        assert.equal(requestTimeoutMs('http://api.example.test/v1'), null);
        assert.equal(requestTimeoutMs(null), null);
    });

    test('AI_TIMEOUT_MS is frozen', () => {
        assert.deepEqual(AI_TIMEOUT_MS, { local: 90000, public: 45000 });
        assert.ok(Object.isFrozen(AI_TIMEOUT_MS));
    });
});

describe('normaliseModel', () => {
    test('trimmed', () => {
        assert.equal(normaliseModel(' llama3.1:8b '), 'llama3.1:8b');
        assert.equal(normaliseModel('a'.repeat(200)), 'a'.repeat(200));
    });

    for (const bad of ['', '  ', 'a'.repeat(201), 'a\nb', 'a\u0000b', 7, null]) {
        test(`${JSON.stringify(bad)?.slice(0, 20)} → null`, () => {
            assert.equal(normaliseModel(bad), null);
        });
    }
});

describe('aiEngine', () => {
    const AI = { ...DEFAULT_SETTINGS, verdictSource: 'ai' };

    test('the default settings are rules mode', () => {
        assert.equal(aiEngine(DEFAULT_SETTINGS), null);
    });

    test('AI mode with no model is not set up', () => {
        assert.equal(aiEngine(AI), null);
    });

    test('AI mode with a model on the default endpoint', () => {
        const e = aiEngine({ ...AI, aiModel: 'm' });
        assert.deepEqual(e, {
            endpoint: 'http://127.0.0.1:11434/v1', model: 'm', engineTag: 'http://127.0.0.1:11434/v1|m',
            timeoutMs: 90000, endpointClass: 'loopback',
        });
        assert.ok(Object.isFrozen(e));
    });

    test("any other verdictSource, including 'AI', is rules mode", () => {
        assert.equal(aiEngine({ ...AI, verdictSource: 'AI', aiModel: 'm' }), null);
        assert.equal(aiEngine({ ...AI, verdictSource: undefined, aiModel: 'm' }), null);
    });

    test('plain http to a public host is not usable', () => {
        assert.equal(aiEngine({ ...AI, aiModel: 'm', aiEndpoint: 'http://api.example.test/v1' }), null);
    });

    test('an https public endpoint is normalised, with the public timeout', () => {
        const e = aiEngine({ ...AI, aiModel: ' m ', aiEndpoint: 'https://api.example.test/v1/' });
        assert.deepEqual(e, {
            endpoint: 'https://api.example.test/v1', model: 'm', engineTag: 'https://api.example.test/v1|m',
            timeoutMs: 45000, endpointClass: 'public',
        });
    });

    test('never throws on odd input', () => {
        assert.equal(aiEngine({}), null);
        assert.equal(aiEngine(null), null);
        assert.equal(aiEngine(undefined), null);
    });
});
