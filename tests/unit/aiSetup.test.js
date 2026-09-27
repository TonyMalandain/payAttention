// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// What the Verdicts settings page tells the owner (interfaces.md §6.9, PG-4d).
// The warning is the owner's consent screen for D-020, so it is pinned to the spec.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    AI_WARNING, VERDICT_SOURCES, PROBE_ID, PROBE_WATCHDOG_EXTRA_MS, KEY_SAVE_FAILED, KEY_REMOVE_FAILED, FAILURE_TEXT,
    describeMode, describeEndpoint, describeKey, checkKey, probeInput, probeResultFromLines, probeResultWhenStopped,
} from '../../extension/core/aiSetup.js';
import { DEFAULT_SETTINGS } from '../../extension/core/defaults.js';
import { AI_FAILURE_CODES, formatAiShellMessage, formatAiHelperMessage } from '../../extension/core/aiProtocol.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const PRD = path.join(repoRoot, 'docs/prd/meeting-guardian.md');
const SCHEMA_FILE = path.join(repoRoot, 'extension/schemas/org.gnome.shell.extensions.payattention.gschema.xml');

const RULES_DECIDE = 'The rules decide. Nothing is sent anywhere.';
const NOT_SET_UP = 'AI is not set up yet: enter a usable address and a model below. Until then the rules decide.';
const AI_DECIDES = 'The AI engine decides every meeting you can attend. If it cannot be reached, the rules decide.';

const INVALID = 'This is not a usable address. Use one like http://127.0.0.1:11434/v1 or https://api.example.com/v1.';
const REFUSED = 'Plain http:// is allowed only on this computer or your local network. Use https:// for this address.';
const LOOPBACK = 'On this computer: the invite does not leave it.';
const PRIVATE_HTTPS = 'On your local network: the invite leaves your computer.';
const PRIVATE_HTTP = 'On your local network: the invite leaves your computer. A key is never sent over plain http:// to another computer.';
const INTERNET = 'On the internet: the invite leaves your computer.';

const PASTE_FIRST = 'Paste a key first. To remove the saved key, use Remove.';
const UNUSABLE_KEY = 'This key cannot be used: it must be 1 to 4096 plain ASCII characters with no spaces.';

const YES = { ok: true, text: 'Yes: the engine answered.' };
const HELPER_BROKEN = { ok: false, text: 'No: the AI helper did not run correctly. Reinstall payAttention.' };

const hello = formatAiHelperMessage({ type: 'hello', protocol: 1 }).trimEnd();
const verdict = id => formatAiHelperMessage({ type: 'verdict', id, verdict: 'must', reason: 'fake' }).trimEnd();
const failed = (code, extra = {}) => formatAiHelperMessage({ type: 'failed', id: PROBE_ID, code, ...extra }).trimEnd();

describe('AI_WARNING', () => {
    test('is the spec\'s warning, verbatim', () => {
        assert.ok(fs.readFileSync(PRD, 'utf8').includes('"' + AI_WARNING + '"'));
    });

    test('includes the D-030 best-effort sentence', () => {
        assert.ok(AI_WARNING.includes('Passcodes and dial-in numbers are removed first, on a best-effort basis.'));
    });
});

describe('VERDICT_SOURCES', () => {
    test('values are rules then ai, the schema\'s choices', () => {
        const xml = fs.readFileSync(SCHEMA_FILE, 'utf8');
        const body = /<key\s+name="verdict-source"[^>]*>([\s\S]*?)<\/key>/.exec(xml)[1];
        const choices = [...body.matchAll(/<choice\s+value="([^"]*)"\s*\/>/g)].map(m => m[1]);
        assert.deepEqual(VERDICT_SOURCES.map(s => s.value), ['rules', 'ai']);
        assert.deepEqual(VERDICT_SOURCES.map(s => s.value), choices);
        assert.deepEqual(VERDICT_SOURCES.map(s => s.label), ['Rules', 'AI']);
        assert.ok(Object.isFrozen(VERDICT_SOURCES) && VERDICT_SOURCES.every(Object.isFrozen));
    });
});

describe('describeMode', () => {
    test('rules mode', () => {
        assert.equal(describeMode({ ...DEFAULT_SETTINGS, verdictSource: 'rules', aiModel: 'llama3' }), RULES_DECIDE);
    });

    test('an unknown mode is rules', () => {
        assert.equal(describeMode({ ...DEFAULT_SETTINGS, verdictSource: 'x', aiModel: 'llama3' }), RULES_DECIDE);
    });

    test('AI mode without a model is not set up', () => {
        assert.equal(describeMode({ ...DEFAULT_SETTINGS, verdictSource: 'ai', aiModel: '' }), NOT_SET_UP);
    });

    test('AI mode with an unusable address is not set up', () => {
        assert.equal(describeMode({ ...DEFAULT_SETTINGS, verdictSource: 'ai', aiEndpoint: 'http://api.example.test/v1',
            aiModel: 'm' }), NOT_SET_UP);
    });

    test('AI mode with an engine', () => {
        assert.equal(describeMode({ ...DEFAULT_SETTINGS, verdictSource: 'ai', aiModel: 'llama3' }), AI_DECIDES);
    });
});

describe('describeEndpoint', () => {
    const cases = [
        ['HTTP://LOCALHOST:11434/v1/', { endpoint: 'http://localhost:11434/v1', usable: true, keyAllowed: true, text: LOOPBACK }],
        ['http://10.0.0.5:8080/v1', { endpoint: 'http://10.0.0.5:8080/v1', usable: true, keyAllowed: false, text: PRIVATE_HTTP }],
        ['https://gpu.lan/v1', { endpoint: 'https://gpu.lan/v1', usable: true, keyAllowed: true, text: PRIVATE_HTTPS }],
        ['https://api.example.test/v1', { endpoint: 'https://api.example.test/v1', usable: true, keyAllowed: true, text: INTERNET }],
        ['http://api.example.test/v1', { endpoint: 'http://api.example.test/v1', usable: false, keyAllowed: false, text: REFUSED }],
        ['ftp://x', { endpoint: null, usable: false, keyAllowed: false, text: INVALID }],
        ['', { endpoint: null, usable: false, keyAllowed: false, text: INVALID }],
        [null, { endpoint: null, usable: false, keyAllowed: false, text: INVALID }],
        ['https://user@host/v1', { endpoint: null, usable: false, keyAllowed: false, text: INVALID }],
    ];
    for (const [address, expected] of cases) {
        test(`${JSON.stringify(address)}`, () => {
            const d = describeEndpoint(address);
            assert.deepEqual({ ...d }, expected);
            assert.ok(Object.isFrozen(d));
        });
    }
});

describe('describeKey', () => {
    const rows = [
        ['no-address', true, 'Enter a usable address first.'],
        ['no-address', false, 'Enter a usable address first.'],
        ['unavailable', true, 'Could not reach your keyring, so it is not known whether a key is saved.'],
        ['unavailable', false, 'Could not reach your keyring, so it is not known whether a key is saved.'],
        ['none', true, 'No key saved for this address. A local engine such as Ollama needs none.'],
        ['none', false, 'No key. A key is never sent over plain http:// to another computer.'],
        ['saved', true, 'A key is saved for this address.'],
        ['saved-locked', true, 'A key is saved for this address, but your keyring is locked. Unlock it, or AI stays unavailable.'],
        ['saved', false, 'A key is saved for this address, but it is never sent over plain http:// to another computer.'],
        ['saved-locked', false, 'A key is saved for this address, but it is never sent over plain http:// to another computer.'],
    ];
    for (const [state, keyAllowed, text] of rows) {
        test(`${state}, keyAllowed ${keyAllowed}`, () => {
            assert.equal(describeKey(state, keyAllowed), text);
        });
    }

    test('the keyring failure texts', () => {
        assert.equal(KEY_SAVE_FAILED, 'Could not save the key: the keyring refused it or could not be reached.');
        assert.equal(KEY_REMOVE_FAILED, 'Could not remove the key: the keyring refused or could not be reached.');
    });
});

describe('checkKey', () => {
    test('a pasted key is trimmed of space, tab, CR and LF', () => {
        const r = checkKey('  sk-test \n');
        assert.deepEqual({ ...r }, { ok: true, key: 'sk-test' });
        assert.ok(Object.isFrozen(r));
        assert.deepEqual({ ...checkKey('\tsk-test\r\n') }, { ok: true, key: 'sk-test' });
    });

    for (const input of ['', '   ', null]) {
        test(`${JSON.stringify(input)} asks for a key`, () => {
            const r = checkKey(input);
            assert.deepEqual({ ...r }, { ok: false, text: PASTE_FIRST });
            assert.ok(Object.isFrozen(r));
        });
    }

    for (const [input, label] of [['a b', 'a space inside'], ['é', 'non-ASCII'], ['a'.repeat(4097), '4097 characters']]) {
        test(`${label} cannot be used`, () => {
            assert.deepEqual({ ...checkKey(input) }, { ok: false, text: UNUSABLE_KEY });
        });
    }
});

describe('probeInput', () => {
    test('a loopback engine: configure then probe, and the watchdog is the timeout plus 10 s', () => {
        const p = probeInput('http://127.0.0.1:11434/v1', 'llama3');
        assert.equal(p.ok, true);
        assert.equal(p.input, formatAiShellMessage({ type: 'configure', protocol: 1, endpoint: 'http://127.0.0.1:11434/v1',
            model: 'llama3', timeoutMs: 90000 }) + formatAiShellMessage({ type: 'probe', id: 'test-connection' }));
        assert.equal(p.watchdogMs, 100000);
        assert.equal(PROBE_WATCHDOG_EXTRA_MS, 10000);
        assert.ok(Object.isFrozen(p));
    });

    test('a public engine uses the public timeout', () => {
        const p = probeInput('https://api.example.test/v1', 'm');
        assert.equal(JSON.parse(p.input.split('\n')[0]).timeoutMs, 45000);
        assert.equal(p.watchdogMs, 55000);
    });

    test('the stored values are normalised as the shell does', () => {
        const p = probeInput('HTTP://127.0.0.1:11434/v1/', ' m ');
        const configure = JSON.parse(p.input.split('\n')[0]);
        assert.equal(configure.endpoint, 'http://127.0.0.1:11434/v1');
        assert.equal(configure.model, 'm');
    });

    test('an unusable address is refused, with no input', () => {
        const p = probeInput('http://api.example.test/v1', 'm');
        assert.deepEqual({ ...p, result: { ...p.result } }, { ok: false, result: { ok: false, text: 'No: enter a usable address first.' } });
        assert.ok(Object.isFrozen(p) && Object.isFrozen(p.result));
    });

    test('the address is checked before the model', () => {
        assert.equal(probeInput('ftp://x', '').result.text, 'No: enter a usable address first.');
    });

    test('an empty model is refused', () => {
        assert.deepEqual({ ...probeInput('http://127.0.0.1:11434/v1', '').result },
            { ok: false, text: 'No: enter a model name first.' });
    });

    test('the input carries no key', () => {
        const { input } = probeInput('http://127.0.0.1:11434/v1', 'llama3');
        for (const word of ['Authorization', 'Bearer', 'key'])
            assert.equal(input.includes(word), false, word);
    });
});

describe('probeResultFromLines', () => {
    test('nothing yet, or only hello: the answer is still to come', () => {
        assert.equal(probeResultFromLines([]), null);
        assert.equal(probeResultFromLines([hello]), null);
    });

    test('a verdict for the probe is Yes', () => {
        const r = probeResultFromLines([hello, verdict(PROBE_ID)]);
        assert.deepEqual({ ...r }, YES);
        assert.ok(Object.isFrozen(r));
    });

    for (const code of AI_FAILURE_CODES) {
        test(`failed ${code} is its No text`, () => {
            const r = probeResultFromLines([hello, failed(code)]);
            assert.deepEqual({ ...r }, { ok: false, text: FAILURE_TEXT[code] });
            assert.ok(Object.isFrozen(r));
        });
    }

    test('rate-limited with retryAfterS is the rate-limited text', () => {
        assert.equal(probeResultFromLines([hello, failed('rate-limited', { retryAfterS: 7 })]).text,
            FAILURE_TEXT['rate-limited']);
    });

    const broken = [
        [['not json'], 'a first line that is not JSON'],
        [['{"type":"hello","protocol":2}'], 'another protocol'],
        [[verdict(PROBE_ID)], 'a verdict before hello'],
        [[hello, hello], 'hello twice'],
        [[hello, verdict('other-id')], 'a verdict for another id'],
        [[hello, 'garbage'], 'garbage after hello'],
    ];
    for (const [lines, label] of broken) {
        test(`${label} means the helper is broken`, () => {
            assert.deepEqual({ ...probeResultFromLines(lines) }, HELPER_BROKEN);
        });
    }

    test('lines after the second are never read', () => {
        assert.deepEqual({ ...probeResultFromLines([hello, verdict(PROBE_ID), 'garbage']) }, YES);
    });
});

describe('FAILURE_TEXT', () => {
    test('has exactly the failure codes, each a No', () => {
        assert.deepEqual(new Set(Object.keys(FAILURE_TEXT)), new Set(AI_FAILURE_CODES));
        assert.ok(Object.values(FAILURE_TEXT).every(t => t.startsWith('No: ')));
        assert.ok(Object.isFrozen(FAILURE_TEXT));
    });

    test('the exact texts', () => {
        assert.deepEqual({ ...FAILURE_TEXT }, {
            'timeout': 'No: the engine did not answer in time.',
            'network': 'No: nothing answered at this address. Check that the engine is running and the address is right.',
            'tls': "No: the secure connection failed. The engine's certificate was not accepted.",
            'auth': 'No: the engine refused the key. Check the API key saved for this address.',
            'rate-limited': 'No: the engine says there were too many requests, or there is no quota left. Try again later.',
            'server': 'No: the engine reported an error of its own. Try again later.',
            'bad-reply': 'No: the engine answered, but not with a verdict. Check the model name, or try another model.',
            'bad-request': 'No: the AI helper refused the test request. Reinstall payAttention.',
            'no-key': 'No: the saved key could not be read, because your keyring is locked or unreachable. Unlock it and try again.',
            'config': 'No: the engine refused the request. Check the address and the model name.',
        });
    });
});

describe('probeResultWhenStopped', () => {
    const rows = [
        ['spawn-failed', { ok: false, text: 'No: the AI helper could not be started. Check that gjs is installed.' }],
        ['exited', HELPER_BROKEN],
        ['timed-out', { ok: false, text: 'No: the engine did not answer in time.' }],
    ];
    for (const [how, expected] of rows) {
        test(how, () => {
            const r = probeResultWhenStopped(how);
            assert.deepEqual({ ...r }, expected);
            assert.ok(Object.isFrozen(r));
        });
    }
});
