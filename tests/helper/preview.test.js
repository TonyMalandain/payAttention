// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The preview command, installed from the built zip into a throwaway home
// (interfaces.md §7.3, checks 3 and 4): the real adapters, the installed layout,
// a keyfile settings backend, a private bus with an isolated EDS and an unlocked
// throwaway keyring, and a fake engine on 127.0.0.1. Never the owner's
// extensions directory, settings, calendars, bus or keyring.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createAiSession, throwawayKey } from '../ai/session.js';
import { startFakeEngine } from '../ai/fakeEngine.js';
import { writeFixtureCalendars, nextWholeHour, runHelper, killOnPrivateBus } from './isolatedEds.js';
import { judge } from '../../extension/core/judge.js';
import { DEFAULT_SETTINGS } from '../../extension/core/defaults.js';
import { occurrenceKey } from '../../extension/core/keys.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
// The UUID has one source: extension/metadata.json (PG-10).
const UUID = JSON.parse(fs.readFileSync(path.join(repoRoot, 'extension', 'metadata.json'), 'utf8')).uuid;
const ZIP = path.join(repoRoot, 'dist', `${UUID}.shell-extension.zip`);
const RUN_TIMEOUT_MS = 120_000;
const SETTINGS_GROUP = '[org/gnome/shell/extensions/payattention]';
const BAD_STDERR = ['destroy-failed', 'ai-failed', 'protocol-mismatch', 'helper-spawn-failed', 'internal error'];
const EDS_PROGRAMS = ['evolution-source-registry', 'evolution-calendar-factory', 'evolution-addressbook-factory'];

const MISSING = ['gjs', 'dbus-daemon', 'gnome-keyring-daemon', 'gnome-extensions']
    .filter(p => spawnSync('sh', ['-c', `command -v ${p}`]).status !== 0);
const SKIP = MISSING.length > 0 ? `preview tests skipped: ${MISSING.join(', ')} not on PATH` : false;

/** The newest modification time of any file under dir. */
function newestMtime(dir) {
    let newest = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
        if (entry.isFile())
            newest = Math.max(newest, fs.statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
    }
    return newest;
}

/** Refuses to run against a missing or stale zip: test:helper runs after build. */
function assertFreshZip() {
    if (!fs.existsSync(ZIP))
        throw new Error('run npm run build first: dist zip is missing');
    if (fs.statSync(ZIP).mtimeMs < newestMtime(path.join(repoRoot, 'extension')))
        throw new Error('dist zip is older than extension/: run npm run build');
}

/** Resolves once cond() is true; rejects after timeoutMs. */
async function waitFor(cond, timeoutMs, what) {
    const until = Date.now() + timeoutMs;
    while (!cond()) {
        if (Date.now() > until)
            throw new Error(`timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

/** Every live process whose command line contains text. */
function processesRunning(text) {
    const found = [];
    for (const pid of fs.readdirSync('/proc').filter(p => /^\d+$/.test(p))) {
        try {
            if (fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').includes(text))
                found.push(Number(pid));
        } catch {
            // gone, or not ours to read
        }
    }
    return found;
}

/**
 * One throwaway session with the fixture calendars and the built zip installed.
 *
 * @returns {Promise<{session:object, installDir:string, keyfile:string, previewEnv:object, baseMs:number,
 *   writeSettings:(lines:string[]) => void, stop:() => Promise<void>}>}
 */
async function installedSession(name) {
    assertFreshZip();
    const session = await createAiSession(`preview-${name}`);
    try {
        const baseMs = nextWholeHour(Date.now());
        writeFixtureCalendars(session.home, baseMs);
        const install = spawnSync('gnome-extensions', ['install', '--force', ZIP], { env: session.env, encoding: 'utf8' });
        assert.equal(install.status, 0, `gnome-extensions install failed: ${install.stderr}`);
        const installDir = path.join(session.env.XDG_DATA_HOME, 'gnome-shell/extensions', UUID);
        assert.ok(fs.existsSync(path.join(installDir, 'schemas/gschemas.compiled')), 'the installed schema is compiled');
        const keyfile = path.join(session.env.XDG_CONFIG_HOME, 'glib-2.0/settings/keyfile');
        fs.mkdirSync(path.dirname(keyfile), { recursive: true });
        const writeSettings = lines => fs.writeFileSync(keyfile, [SETTINGS_GROUP, ...lines, ''].join('\n'));
        writeSettings([]);
        const previewEnv = { ...session.env, GSETTINGS_BACKEND: 'keyfile', TZ: 'Asia/Tokyo' };
        return {
            session, installDir, keyfile, previewEnv, baseMs, writeSettings,
            stop: async () => {
                await session.stop();
                for (const program of EDS_PROGRAMS)
                    killOnPrivateBus(session.env, program);
            },
        };
    } catch (e) {
        await session.stop();
        throw e;
    }
}

/**
 * Runs a preview entry file with env to its exit; SIGKILLed after RUN_TIMEOUT_MS.
 * helpersAtExit lists the processes still running from the entry's install directory's
 * helper/main.js or ai/main.js at the moment the preview process exits. It is taken at
 * 'exit', not 'close': the helpers inherit stderr, so 'close' waits for them anyway.
 *
 * @returns {{child: import('node:child_process').ChildProcess,
 *   done: Promise<{code:number|null, signal:string|null, stdout:string, stderr:string, ms:number,
 *     helpersAtExit:number[]}>}}
 */
function startPreviewProcess(mainJs, env, args = []) {
    const installDir = path.dirname(path.dirname(mainJs));
    const helperMains = [path.join(installDir, 'helper/main.js'), path.join(installDir, 'ai/main.js')];
    let helpersAtExit = null;
    const started = Date.now();
    const child = spawn('gjs', ['-m', mainJs, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', d => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', d => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS);
    child.once('exit', () => {
        helpersAtExit = helperMains.flatMap(processesRunning);
        // A helper left behind holds the inherited stderr open, so 'close' would never
        // come: kill it (it is recorded above, so the test still fails).
        for (const pid of helpersAtExit) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {
                // already gone
            }
        }
    });
    const done = new Promise((resolve, reject) => {
        child.once('error', e => {
            clearTimeout(timer);
            reject(e);
        });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, stdout, stderr, ms: Date.now() - started, helpersAtExit });
        });
    });
    return { child, done };
}

const runPreview = (mainJs, env, args) => startPreviewProcess(mainJs, env, args).done;

function assertCleanStderr(stderr) {
    for (const bad of BAD_STDERR)
        assert.ok(!stderr.includes(bad), `stderr has ${bad}: ${stderr}`);
}

const byTitle = (meetings, title) => meetings.find(m => m.title === title);

describe('the preview, installed from the zip', { skip: SKIP }, () => {
    describe('rules mode', () => {
        let s;
        before(async () => {
            s = await installedSession('rules');
        });
        after(async () => {
            await s?.stop();
        });

        test('--json: the fixture verdicts, the stored override, and the keyfile unchanged', async () => {
            const helper = await runHelper({ ...s.session.env, TZ: 'Asia/Tokyo' }, ['--once']);
            assert.equal(helper.code, 0, helper.stderr);
            const snapshot = JSON.parse(helper.stdout.trim().split('\n').at(-1));
            const coffee = snapshot.events.find(e => e.summary === 'Coffee at the office');
            const coffeeKey = occurrenceKey(coffee);
            s.writeSettings([`verdict-overrides={${JSON.stringify(coffeeKey)}: 'must'}`]);
            const before = fs.readFileSync(s.keyfile);

            const r = await runPreview(path.join(s.installDir, 'preview/main.js'), s.previewEnv, ['--json']);
            assert.equal(r.code, 0, r.stderr);
            assertCleanStderr(r.stderr);
            const out = r.stdout.replace(/\n$/, '');
            assert.ok(!out.includes('\n'), 'one line');
            const json = JSON.parse(out);
            assert.equal(json.v, 1);
            assert.equal(json.verdictSource, 'rules');
            assert.equal(json.aiStatus, 'off');
            assert.deepEqual(json.calendars.find(c => c.name === 'Fixture'), { name: 'Fixture', ok: true, error: null });
            assert.equal(json.calendars.find(c => c.name === 'Broken').ok, false);

            const m = json.meetings.find(x => x.key === coffeeKey);
            assert.deepEqual([m.verdict, m.reasonCode, m.overridden], ['must', 'override-must', true]);
            assert.equal(byTitle(json.meetings, 'Cancelled call').reasonCode, 'cancelled');
            assert.equal(byTitle(json.meetings, 'Holiday').reasonCode, 'all-day');
            assert.equal(byTitle(json.meetings, 'Out of range'), undefined);

            const expected = judge(snapshot, { ...DEFAULT_SETTINGS, ai: null }, { verdict: { [coffeeKey]: 'must' }, mode: {} }, {}, {})
                .filter(j => j.end === null || j.end > json.generatedAt);
            const pick = x => ({ key: x.key, verdict: x.verdict, reasonCode: x.reasonCode, mode: x.mode });
            assert.deepEqual(json.meetings.map(pick), expected.map(pick));
            assert.deepEqual(json.meetings.map(x => x.overridden), expected.map(j => j.verdictOverridden));

            assert.ok(fs.readFileSync(s.keyfile).equals(before), 'the keyfile is byte-for-byte unchanged');
            assert.deepEqual(r.helpersAtExit, [], 'the calendar helper is gone when the preview exits 0');
        });

        test('text: the report, with no control byte but the line ends', async () => {
            const r = await runPreview(path.join(s.installDir, 'preview/main.js'), s.previewEnv);
            assert.equal(r.code, 0, r.stderr);
            assertCleanStderr(r.stderr);
            assert.ok(r.stdout.includes('Verdicts from: the rules'), r.stdout);
            assert.ok(r.stdout.includes('Tokyo sync'), r.stdout);
            const control = [...Buffer.from(r.stdout)].find(b => b < 0x20 && b !== 0x0a);
            assert.equal(control, undefined, 'no byte below 0x20 but the line ends');
        });
    });

    describe('AI mode', () => {
        let s, engine;
        before(async () => {
            s = await installedSession('ai');
            engine = await startFakeEngine();
        });
        after(async () => {
            await engine?.close();
            await s?.stop();
        });

        test('--json: AI verdicts from the fake engine with the stored key; nothing written, no key added', async () => {
            const key = throwawayKey();
            await s.session.storeKey(engine.endpoint, key);
            s.writeSettings(["verdict-source='ai'", `ai-endpoint='${engine.endpoint}'`, "ai-model='fake-model'"]);
            const before = fs.readFileSync(s.keyfile);
            const keysBefore = await s.session.countKeys();

            const r = await runPreview(path.join(s.installDir, 'preview/main.js'), s.previewEnv, ['--json']);
            assert.equal(r.code, 0, r.stderr);
            assertCleanStderr(r.stderr);
            const json = JSON.parse(r.stdout);
            assert.equal(json.verdictSource, 'ai');
            assert.equal(json.aiStatus, 'ok');
            const byAi = json.meetings.filter(m => m.reasonCode === 'ai-must');
            assert.ok(byAi.length > 0);
            for (const m of byAi)
                assert.equal(m.reason, 'AI: fake engine');
            assert.equal(byAi.length, engine.requests.length);
            for (const req of engine.requests)
                assert.equal(req.headers.authorization, `Bearer ${key}`);
            assert.equal(byTitle(json.meetings, 'Cancelled call').reasonCode, 'cancelled');
            assert.equal(byTitle(json.meetings, 'Holiday').reasonCode, 'all-day');

            assert.ok(fs.readFileSync(s.keyfile).equals(before), 'the keyfile is byte-for-byte unchanged');
            assert.deepEqual(await s.session.countKeys(), keysBefore);
            assert.deepEqual(r.helpersAtExit, [], 'both helpers are gone when the preview exits 0');
        });
    });

    describe('Ctrl-C', () => {
        let s, engine, running;
        before(async () => {
            s = await installedSession('sigint');
            engine = await startFakeEngine();
        });
        after(async () => {
            running?.child.kill('SIGKILL');
            await engine?.close();
            await s?.stop();
        });

        test('SIGINT while an ask is held: exit 130, both helpers gone, nothing written', async () => {
            await s.session.storeKey(engine.endpoint, throwawayKey());
            s.writeSettings(["verdict-source='ai'", `ai-endpoint='${engine.endpoint}'`, "ai-model='fake-model'"]);
            const before = fs.readFileSync(s.keyfile);
            engine.queue({ hold: true });

            running = startPreviewProcess(path.join(s.installDir, 'preview/main.js'), s.previewEnv, ['--json']);
            await waitFor(() => engine.requests.length === 1, 90_000, 'the first ask');
            const sentAt = Date.now();
            running.child.kill('SIGINT');
            const r = await running.done;
            assert.equal(r.code, 130, `exit ${r.code} ${r.signal}: ${r.stderr}`);
            assert.ok(Date.now() - sentAt < 5000, 'exited within 5 s');
            const helperMain = path.join(s.installDir, 'helper/main.js');
            const aiMain = path.join(s.installDir, 'ai/main.js');
            await waitFor(() => processesRunning(helperMain).length === 0 && processesRunning(aiMain).length === 0,
                3000, 'both helpers to exit');
            assert.ok(fs.readFileSync(s.keyfile).equals(before), 'the keyfile is byte-for-byte unchanged');
        });
    });

    describe('no calendar data', () => {
        let s;
        before(async () => {
            s = await installedSession('no-calendar');
        });
        after(async () => {
            await s?.stop();
        });

        test('an unreachable bus: exit 3 after 30 s, with the helper\'s own status line', async () => {
            const env = { ...s.previewEnv, DBUS_SESSION_BUS_ADDRESS: s.session.unreachableEnv().DBUS_SESSION_BUS_ADDRESS };
            const r = await runPreview(path.join(s.installDir, 'preview/main.js'), env);
            assert.equal(r.code, 3, r.stderr);
            assert.ok(r.ms >= 30_000, `ran ${r.ms} ms`);
            assert.ok(r.stderr.includes('no calendar data after 30 seconds'), r.stderr);
            assert.ok(r.stderr.includes('registry-failed'), r.stderr);
            assert.equal(r.stdout, '');
            assert.deepEqual(r.helpersAtExit, [], 'both helpers are gone when the preview exits 3');
        });
    });

    describe('not installed, and usage', () => {
        let s;
        before(async () => {
            s = await installedSession('usage');
        });
        after(async () => {
            await s?.stop();
        });

        test('a copy without a compiled schema: exit 2, not installed', async () => {
            const copy = path.join(s.session.env.XDG_DATA_HOME, 'not-installed-copy');
            fs.cpSync(s.installDir, copy, { recursive: true });
            fs.rmSync(path.join(copy, 'schemas/gschemas.compiled'));
            const r = await runPreview(path.join(copy, 'preview/main.js'), s.previewEnv);
            assert.equal(r.code, 2, r.stderr);
            assert.equal(r.stderr.trim(), 'payAttention is not installed');
            assert.equal(r.stdout, '');
        });

        test('--bogus: exit 1, usage on stderr; --help: exit 0, usage on stdout', async () => {
            const main = path.join(s.installDir, 'preview/main.js');
            const bogus = await runPreview(main, s.previewEnv, ['--bogus']);
            assert.equal(bogus.code, 1);
            assert.ok(bogus.stderr.startsWith('Usage: gjs -m '), bogus.stderr);
            assert.equal(bogus.stdout, '');
            const help = await runPreview(main, s.previewEnv, ['--help']);
            assert.equal(help.code, 0);
            assert.ok(help.stdout.startsWith('Usage: gjs -m '), help.stdout);
        });
    });
});
