// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The real prefs.js, loaded on a stub ExtensionPreferences, on a private headless
// GTK display, in the throwaway keyring session (PG-4d, testing-and-build.md
// Layer 2b). Never the owner's display, bus, settings or keyring.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createPrefsSession, missingPrefsPrograms } from './prefsSession.js';
import { throwawayKey } from './session.js';
import { startFakeEngine } from './fakeEngine.js';
import { killOnPrivateBus } from '../helper/isolatedEds.js';
import { normalizeDomains, parseList } from '../../extension/core/display.js';
import {
    AI_WARNING, VERDICT_SOURCES, FAILURE_TEXT, NOT_TESTED, TESTING, describeEndpoint, describeKey, describeMode,
} from '../../extension/core/aiSetup.js';
import { INVITE_FIELDS } from '../../extension/core/aiProtocol.js';
import { PROBE_INVITE } from '../../extension/core/aiPrompt.js';

const MISSING = missingPrefsPrograms();
const SKIP = MISSING.length > 0 ? `prefs tests skipped: ${MISSING.join(', ')} not on PATH` : false;

/** Runs a scenario and fails with the driver's whole output unless it printed DONE and exited 0. */
async function drive(session, scenario, args, extraEnv) {
    const r = await session.runDriver(scenario, args, extraEnv);
    assert.ok(r.status === 0 && r.output.includes('PREFS-DRIVER DONE'), `${scenario}:\n${r.output}`);
    return r;
}

/** The one step that has `key`, merged view of all steps otherwise. */
const merged = steps => Object.assign({}, ...steps);

describe('the pages that existed before PG-4d', { skip: SKIP }, () => {
    let session, seen;

    before(async () => {
        session = await createPrefsSession('prefs-existing');
        seen = merged((await drive(session, 'existing')).steps);
    });

    after(async () => {
        await session?.stop();
    });

    test('the window has the Alerts and Judgment pages, in that order', () => {
        assert.deepEqual(seen.pages.slice(0, 2), ['Alerts', 'Judgment']);
    });

    test('the Snooze spin row writes snooze-minutes', () => {
        assert.equal(seen.snooze, 7);
    });

    test('the email domains row stores the normalised list when applied', () => {
        assert.deepEqual(seen.domains, normalizeDomains(parseList(' Acme.TEST , b.test')));
    });

    test('Clear travel times resets travel-times', () => {
        assert.deepEqual(seen.travelBefore, { hq: 30 });
        assert.deepEqual(seen.travelAfter, {});
    });
});

describe('the Verdicts page', { skip: SKIP }, () => {
    let session;

    before(async () => {
        session = await createPrefsSession('prefs-verdicts');
    });

    after(async () => {
        await session?.stop();
    });

    test('layout: the page, the warning, what is sent, and the defaults', async () => {
        const seen = merged((await drive(session, 'layout')).steps);
        assert.deepEqual(seen.pages, ['Alerts', 'Judgment', 'Verdicts']);
        assert.deepEqual(seen.page, { title: 'Verdicts', icon: 'network-server-symbolic' });
        assert.equal(seen.warning, AI_WARNING);
        assert.equal(seen.engineTitle, 'AI engine');
        assert.equal(seen.fieldsTitle, 'What is sent for each meeting');
        assert.deepEqual(seen.fields, INVITE_FIELDS.map(f => f.label));
        assert.equal(seen.endpoint, 'http://127.0.0.1:11434/v1');
        assert.equal(seen.model, '');
        assert.equal(seen.key, '');
        assert.equal(seen.whereTitle, 'Where the invite goes');
        assert.equal(seen.where, describeEndpoint('http://127.0.0.1:11434/v1').text);
        assert.equal(seen.modeTitle, 'Who decides');
        assert.deepEqual(seen.modeLabels, VERDICT_SOURCES.map(s => s.label));
        assert.equal(seen.selected, 0);
        assert.equal(seen.modeSubtitle, describeMode({ verdictSource: 'rules' }));
        assert.equal(seen.testResult, NOT_TESTED);
        assert.deepEqual(seen.titles, {
            'payattention-ai-endpoint': 'Address',
            'payattention-ai-model': 'Model',
            'payattention-ai-key': 'API key for this address',
            'payattention-ai-key-status': 'Saved key',
            'payattention-ai-test': 'Test connection',
            'payattention-ai-test-result': 'Connection',
        });
        assert.equal(seen.removeLabel, 'Remove');
    });

    test('mode: the switch writes verdict-source once, and follows the settings', async () => {
        const seen = merged((await drive(session, 'mode')).steps);
        const ai = { verdictSource: 'ai', aiEndpoint: 'http://127.0.0.1:11434/v1' };
        assert.deepEqual(seen.afterAi, { stored: 'ai', subtitle: describeMode({ ...ai, aiModel: '' }) });
        assert.deepEqual(seen.afterModel, { stored: 'llama3', subtitle: describeMode({ ...ai, aiModel: 'llama3' }) });
        assert.deepEqual(seen.afterExternal, { selected: 0, subtitle: describeMode({ verdictSource: 'rules' }) });
        assert.equal(seen.writes, 1);
    });

    test('endpoint: only a usable address is stored, normalised', async () => {
        const { applied, unapplied, longModel, trimmedModel, emptyModel } =
            merged((await drive(session, 'endpoint', [throwawayKey()])).steps);
        const text = a => describeEndpoint(a).text;
        assert.deepEqual(applied, [
            { input: 'HTTP://LOCALHOST:11434/v1/', stored: 'http://localhost:11434/v1', text: 'http://localhost:11434/v1',
                error: false, where: text('http://localhost:11434/v1') },
            { input: 'http://api.example.test/v1', stored: 'http://localhost:11434/v1', text: 'http://api.example.test/v1',
                error: true, where: text('http://api.example.test/v1') },
            { input: 'ftp://x', stored: 'http://localhost:11434/v1', text: 'ftp://x', error: true, where: text('ftp://x') },
            { input: 'https://api.example.test/v1', stored: 'https://api.example.test/v1', text: 'https://api.example.test/v1',
                error: false, where: text('https://api.example.test/v1') },
            { input: 'http://10.0.0.5:8080/v1', stored: 'http://10.0.0.5:8080/v1', text: 'http://10.0.0.5:8080/v1',
                error: false, where: text('http://10.0.0.5:8080/v1') },
        ]);
        const allSensitive = { 'payattention-ai-key': true, 'payattention-ai-key-remove': true, 'payattention-ai-test': true };
        const allInsensitive = { 'payattention-ai-key': false, 'payattention-ai-key-remove': false, 'payattention-ai-test': false };
        assert.deepEqual(unapplied, { before: allSensitive, endpointEditing: allInsensitive, endpointBack: allSensitive,
            modelEditing: allInsensitive, modelBack: allSensitive });
        assert.deepEqual(longModel, { stored: 'llama3', error: true });
        assert.deepEqual(trimmedModel, { stored: 'llama3', text: 'llama3', error: false });
        assert.deepEqual(emptyModel, { stored: '' });
    });

    test('nothing else is written: only verdict-source, ai-endpoint and ai-model change', async () => {
        const seen = merged((await drive(session, 'nothing-else-written')).steps);
        assert.deepEqual(seen.changed, ['ai-endpoint', 'ai-model', 'verdict-source']);
    });
});

describe('the API key', { skip: SKIP }, () => {
    let session, seen, output, K1, K2;

    before(async () => {
        session = await createPrefsSession('prefs-key');
        K1 = throwawayKey();
        K2 = throwawayKey();
        const r = await drive(session, 'key', [K1, K2], { G_MESSAGES_DEBUG: 'all' });
        seen = merged(r.steps);
        output = r.output;
    });

    after(async () => {
        await session?.stop();
    });

    test('an address with no key says so, and Remove is greyed out', () => {
        assert.deepEqual(seen.first, { status: describeKey('none', true), removeSensitive: false });
    });

    test('Save stores the trimmed key in the keyring under the normalised address, and clears the field at once', () => {
        assert.deepEqual(seen.save, {
            clearedAtOnce: true, count: 1, secretIsTrimmedKey: true, labelRight: true, attributeRight: true,
            removeSensitive: true,
        });
    });

    test('the key is never in the settings', () => {
        assert.equal(seen.notInSettings, true);
    });

    test('the key is never shown back, in this window or a new one', () => {
        assert.deepEqual(seen.notShown, { first: true, second: true });
    });

    test('a key typed but not saved is cleared when the address changes', () => {
        assert.equal(seen.addressChanged.typedKeyCleared, true);
    });

    test('the saved key line is empty while its lookup is pending', () => {
        assert.equal(seen.addressChanged.statusWhilePending, '');
    });

    test('keys are per address', () => {
        assert.equal(seen.perAddress, true);
    });

    test('saving again replaces the key: still one item', () => {
        assert.equal(seen.replaced, true);
    });

    test('a key that cannot be sent, or an empty field, is refused and nothing is stored', () => {
        assert.deepEqual(seen.refusedSpace, { status: true, kept: true, error: true, stillK2: true });
        assert.deepEqual(seen.refusedEmpty, { status: true, stillK2: true });
    });

    test('Remove clears the key and greys itself out', () => {
        assert.deepEqual(seen.removed, { count: 0, removeSensitive: false });
    });

    test('no key may be saved for plain http to another computer', () => {
        assert.deepEqual(seen.noKeyHere, { keySensitive: false, removeSensitive: false, unchanged: true });
    });

    test('a key saved for plain http to another computer can still be removed, but not replaced', () => {
        assert.deepEqual(seen.removableHere, { keySensitive: false, removeSensitive: true, count: 0, removeSensitiveAfter: false });
    });

    test('another program\'s keyring item is never touched', () => {
        assert.equal(seen.otherKept, true);
    });

    test('a locked keyring says so', () => {
        assert.equal(seen.locked, describeKey('saved-locked', true));
        assert.equal(seen.removeSensitive, true);
    });

    test('no key reaches any output, even with G_MESSAGES_DEBUG=all', () => {
        assert.equal(output.includes(K1), false);
        assert.equal(output.includes(K2), false);
    });

    test('an unreachable keyring says so', async () => {
        const unreachable = { DBUS_SESSION_BUS_ADDRESS: `unix:path=${session.home}/no-bus` };
        const r = merged((await drive(session, 'key-unreachable', [], unreachable)).steps);
        assert.equal(r.unreachable, describeKey('unavailable', true));
    });
});

describe('an address change', { skip: SKIP }, () => {
    let session, seen, output, K;
    const ENGINE_TWO = 'https://engine-two.example.test/v1';

    before(async () => {
        session = await createPrefsSession('prefs-address-change');
        K = throwawayKey();
        const r = await drive(session, 'address-change', [K]);
        seen = merged(r.steps);
        output = r.output;
    });

    after(async () => {
        await session?.stop();
    });

    test("a refused key's red style clears when the address change empties the field", () => {
        assert.deepEqual(seen.refusedThenAddress, { refusedRed: true, cleared: true, red: false });
    });

    test('Remove is disabled while the new address is looked up, never the old answer', () => {
        assert.deepEqual(seen.pendingAway, { removeBefore: true, status: '', removeSensitive: false });
        assert.deepEqual(seen.answeredAway, { removeSensitive: false });
        assert.deepEqual(seen.pendingBack, { status: '', removeSensitive: false });
    });

    test('Remove reflects the new address as soon as its lookup ends', () => {
        assert.deepEqual(seen.answeredBack, { removeSensitive: true });
        assert.equal(seen.outside.removeSensitiveAfter, false);
    });

    test('the address field follows a change of ai-endpoint made outside the window', () => {
        assert.deepEqual(seen.outside, {
            typedRed: true, text: ENGINE_TWO, red: false, where: describeEndpoint(ENGINE_TWO).text,
            status: '', removeSensitive: false,
            removeSensitiveAfter: false, keySensitiveAfter: true, testSensitiveAfter: true,
        });
    });

    test('no key reaches any output', () => {
        assert.equal(output.includes(K), false);
    });
});

/** A loopback port that was open a moment ago and is closed now. */
async function closedPort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

const userMessage = request => JSON.parse(request.body).messages.find(m => m.role === 'user').content;
const answered = (text, ok) => ({ text, success: ok, error: !ok, sensitiveAfter: true });

describe('Test connection', { skip: SKIP }, () => {
    let session, E;

    before(async () => {
        session = await createPrefsSession('prefs-test-connection');
        E = await startFakeEngine();
    });

    after(async () => {
        await E?.close();
        await session?.stop();
    });

    test('probe: No on a refused key, Yes, Yes with the saved key, No on a closed port, No without a model', async () => {
        const K = throwawayKey();
        const closed = `http://127.0.0.1:${await closedPort()}/v1`;
        E.queue({ status: 401, body: '{}' });
        const r = await drive(session, 'probe', [E.endpoint, closed, K]);
        const seen = merged(r.steps);

        assert.deepEqual(seen.refusedKey, { during: { text: TESTING, sensitive: false }, ...answered(FAILURE_TEXT.auth, false) });
        assert.deepEqual(seen.yes, { during: { text: TESTING, sensitive: false }, ...answered('Yes: the engine answered.', true) });
        assert.equal(seen.yesWithKey.text, 'Yes: the engine answered.');
        assert.equal(seen.closed.text, FAILURE_TEXT.network);
        assert.equal(seen.noModel.text, 'No: enter a model name first.');
        assert.equal(seen.noModel.children, 0);
        assert.equal(seen.childrenAtEnd, 0);

        assert.equal(E.requests.length, 3, 'no request for the closed port or the missing model');
        for (const request of E.requests) {
            assert.equal(request.method, 'POST');
            assert.equal(request.path, '/v1/chat/completions');
            assert.equal(userMessage(request), JSON.stringify(PROBE_INVITE), 'only the made-up test meeting is sent');
        }
        assert.equal(Object.hasOwn(E.requests[0].headers, 'authorization'), false);
        assert.equal(Object.hasOwn(E.requests[1].headers, 'authorization'), false);
        assert.equal(E.requests[2].headers.authorization, 'Bearer ' + K, 'the key prefs writes is the key the helper reads');
        assert.equal(r.output.includes(K), false);
    });

    test('broken-helper: without ai/ the answer says to reinstall', async () => {
        const noHelper = path.join(session.home, 'no-helper');
        fs.mkdirSync(noHelper, { recursive: true });
        const seen = merged((await drive(session, 'broken-helper', [E.endpoint, noHelper])).steps);
        assert.equal(seen.broken.text, 'No: the AI helper did not run correctly. Reinstall payAttention.');
        assert.equal(seen.broken.error, true);
    });

    test('close-while-testing: closing the window kills the helper, which ran without G_MESSAGES_DEBUG', async () => {
        const seenFile = path.join(session.home, 'engine-seen');
        const before = E.requests.length;
        E.queue({ hold: true });
        const poll = setInterval(() => {
            if (E.requests.length > before)
                fs.writeFileSync(seenFile, 'seen');
        }, 50);
        let r;
        try {
            r = await drive(session, 'close-while-testing', [E.endpoint, seenFile], { G_MESSAGES_DEBUG: 'all' });
        } finally {
            clearInterval(poll);
        }
        const seen = merged(r.steps);
        assert.deepEqual(seen.running, { children: 1, envClean: true, parentHasDebug: true });
        assert.equal(seen.afterClose.children, 0);
        assert.equal(killOnPrivateBus(session.env, 'gjs'), 0);
    });
});
