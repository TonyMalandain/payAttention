// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test support, not a test: a throwaway session for the AI helper (Layer 2b).
// A throwaway home and XDG dirs, a private D-Bus, and an unlocked throwaway
// keyring on it. The environment is built from scratch: the owner's real bus,
// display and keyring files can never be reached.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { startPrivateBus, killOnPrivateBus } from '../helper/isolatedEds.js';
import { parseAiHelperLine, formatAiShellMessage, AI_PROTOCOL_VERSION } from '../../extension/core/aiProtocol.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
/** Absolute path of the AI helper's entry file. */
export const AI_MAIN = path.join(repoRoot, 'extension/ai/main.js');
const KEYRING_TOOL = path.join(import.meta.dirname, 'gjs/keyring.js');
const TOOL_TIMEOUT_MS = 20_000;
// A GLib log line: under G_MESSAGES_DEBUG, GLib's default writer sends DEBUG and INFO lines to stdout.
const GLIB_LOG_LINE = /^\(gjs:\d+\): [\w.-]+-(DEBUG|INFO|MESSAGE): /;

/** The model name every test configures. */
export const TEST_MODEL = 'fake-model';
/** Non-empty on purpose (an empty phrase makes the daemon prompt, fact 2). Not a secret: it guards a throwaway keyring holding throwaway keys. */
export const UNLOCK_PHRASE = 'payattention-test-unlock';
// The harness rule "never a real engine": only a loopback IPv4 address.
const LOOPBACK_ENGINE = /^https?:\/\/127\.0\.0\.1:\d+\/v1$/;

/** A fresh random fake key per call: 'pa-test-key-' + crypto.randomUUID(). */
export function throwawayKey() {
    return 'pa-test-key-' + crypto.randomUUID();
}

/** Run a program to completion with stdin text; rejects on a non-zero exit or after TOOL_TIMEOUT_MS. */
function run(program, args, env, input = '') {
    return new Promise((resolve, reject) => {
        const child = spawn(program, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.setEncoding('utf8').on('data', d => (stdout += d));
        child.stderr.setEncoding('utf8').on('data', d => (stderr += d));
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`${path.basename(program)} did not finish within ${TOOL_TIMEOUT_MS} ms`));
        }, TOOL_TIMEOUT_MS);
        child.once('error', e => {
            clearTimeout(timer);
            reject(e);
        });
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            if (code === 0)
                resolve(stdout);
            else
                reject(new Error(`${path.basename(program)} ${args[2] ?? args[0] ?? ''} exited with ${code ?? signal}: ${stderr}`));
        });
        child.stdin.end(input);
    });
}

/**
 * A throwaway session: <repo>/.test-home/ai-<name>/ (removed at start), with HOME, XDG_CONFIG_HOME,
 * XDG_DATA_HOME, XDG_CACHE_HOME and XDG_RUNTIME_DIR (mode 0700) inside it, LANG=C.UTF-8,
 * GSETTINGS_BACKEND=memory, GIO_USE_VFS=local, PATH from process.env, and NOTHING else from
 * process.env (never the real bus, DISPLAY or WAYLAND_DISPLAY).
 * Starts a private bus (startPrivateBus) and an unlocked throwaway keyring on it:
 * `gnome-keyring-daemon --unlock --components=secrets --daemonize` with UNLOCK_PHRASE on stdin,
 * and awaits its exit code 0.
 *
 * @param {string} name
 * @returns {Promise<{home:string, env:object,
 *   storeKey:(endpoint:string, key:string) => Promise<void>,
 *   lockKeyring:() => Promise<void>,
 *   countKeys:() => Promise<{ours:number, other:number}>,
 *   unreachableEnv:() => object,
 *   stop:() => Promise<void>}>}
 */
export async function createAiSession(name) {
    const home = path.join(repoRoot, '.test-home', `ai-${name}`);
    fs.rmSync(home, { recursive: true, force: true });
    const env = {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_DATA_HOME: path.join(home, 'data'),
        XDG_CACHE_HOME: path.join(home, 'cache'),
        XDG_RUNTIME_DIR: path.join(home, 'runtime'),
        LANG: 'C.UTF-8',
        GSETTINGS_BACKEND: 'memory',
        GIO_USE_VFS: 'local',
    };
    for (const dir of ['config', 'data', 'cache'])
        fs.mkdirSync(path.join(home, dir), { recursive: true });
    fs.mkdirSync(env.XDG_RUNTIME_DIR, { mode: 0o700 });
    fs.chmodSync(env.XDG_RUNTIME_DIR, 0o700);

    const bus = await startPrivateBus(env);
    try {
        await run('gnome-keyring-daemon', ['--unlock', '--components=secrets', '--daemonize'], env, UNLOCK_PHRASE);
    } catch (e) {
        await bus.stop();
        killOnPrivateBus(env, 'gnome-keyring-daemon');
        throw e;
    }

    return {
        home,
        env,
        storeKey: async (endpoint, key) => {
            await run('gjs', ['-m', KEYRING_TOOL, 'store', endpoint, key], env);
        },
        lockKeyring: async () => {
            await run('gjs', ['-m', KEYRING_TOOL, 'lock'], env);
        },
        /** The keyring items of the engine key schema (ours) and of the test's other schema. */
        countKeys: async () => {
            const out = await run('gjs', ['-m', KEYRING_TOOL, 'count'], env);
            const match = /^KEYRING COUNT (\d+) (\d+)$/m.exec(out);
            if (!match)
                throw new Error(`keyring.js count printed no count: ${out}`);
            return { ours: Number(match[1]), other: Number(match[2]) };
        },
        unreachableEnv: () => ({ ...env, DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(home, 'no-bus')}` }),
        stop: async () => {
            await bus.stop();
            killOnPrivateBus(env, 'gnome-keyring-daemon');
        },
    };
}

/** The AI helper, with stdio piped. Every stdout line must be valid AI helper protocol. */
class AiHelperProcess {
    constructor(env, args, skipLibraryLog) {
        this._child = spawn('gjs', ['-m', AI_MAIN, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        this._lines = [];
        this._waiters = [];
        this._stdout = '';
        this._stderr = '';
        this._exit = new Promise(resolve => this._child.once('exit', (code, signal) => resolve({ code, signal })));
        this._child.stderr.setEncoding('utf8').on('data', d => (this._stderr += d));
        // A helper killed mid-write must not crash the test run.
        this._child.stdin.on('error', () => {});
        readline.createInterface({ input: this._child.stdout }).on('line', line => {
            this._stdout += line + '\n';
            if (skipLibraryLog && GLIB_LOG_LINE.test(line))
                return;
            const waiter = this._waiters.shift();
            if (waiter)
                waiter(line);
            else
                this._lines.push(line);
        });
    }

    /**
     * The next stdout line, proven to be a valid AI helper message.
     *
     * @returns {Promise<object>} the message; rejects on timeout or an invalid line
     */
    nextMessage(timeoutMs) {
        const check = line => {
            const parsed = parseAiHelperLine(line);
            assert.equal(parsed.ok, true, `invalid AI helper line: ${JSON.stringify(parsed)}`);
            return parsed.message;
        };
        if (this._lines.length > 0)
            return Promise.resolve(check(this._lines.shift()));
        return new Promise((resolve, reject) => {
            const waiter = line => {
                clearTimeout(timer);
                try {
                    resolve(check(line));
                } catch (e) {
                    reject(e);
                }
            };
            const timer = setTimeout(() => {
                this._waiters.splice(this._waiters.indexOf(waiter), 1);
                reject(new Error(`no AI helper message within ${timeoutMs} ms`));
            }, timeoutMs);
            this._waiters.push(waiter);
        });
    }

    /** The only way a test names an engine: a loopback address, never a real one. */
    configure(endpoint, timeoutMs = 10000) {
        if (!LOOPBACK_ENGINE.test(endpoint))
            throw new Error(`test engines must be on 127.0.0.1, got ${endpoint}`);
        this._child.stdin.write(formatAiShellMessage({
            type: 'configure', protocol: AI_PROTOCOL_VERSION, endpoint, model: TEST_MODEL, timeoutMs,
        }));
    }

    send(message) {
        if (message?.type === 'configure')
            throw new Error('use configure() to name an engine');
        this._child.stdin.write(formatAiShellMessage(message));
    }

    sendRaw(text) {
        if (text.includes('configure'))
            throw new Error('use configure() to name an engine');
        this._child.stdin.write(text);
    }

    closeStdin() {
        this._child.stdin.end();
    }

    /** @returns {Promise<{code:number|null, signal:string|null}>} rejects on timeout */
    exited(timeoutMs) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`AI helper did not exit within ${timeoutMs} ms`)), timeoutMs);
        });
        return Promise.race([this._exit, timeout]).finally(() => clearTimeout(timer));
    }

    /** Every stdout line read so far, valid or not. */
    stdout() {
        return this._stdout;
    }

    stderr() {
        return this._stderr;
    }

    /** For after-hooks: make sure a failed test leaves no process behind. */
    kill() {
        this._child.kill('SIGKILL');
    }
}

/**
 * Starts `gjs -m extension/ai/main.js` with env, stdio piped.
 *
 * @param {object} env
 * @param {string[]} [args] only the usage test passes any
 * @param {{skipLibraryLog?: boolean}} [options] skipLibraryLog: for a G_MESSAGES_DEBUG run only,
 *   nextMessage passes over GLib log lines (stdout() still has them); every other line must be protocol
 */
export function startAiHelper(env, args = [], { skipLibraryLog = false } = {}) {
    return new AiHelperProcess(env, args, skipLibraryLog);
}
