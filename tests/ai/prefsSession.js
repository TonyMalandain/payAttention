// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test support, not a test: a throwaway session for the real prefs.js (PG-4d).
// It is createAiSession (throwaway home, private bus, unlocked throwaway keyring,
// GSETTINGS_BACKEND=memory) plus the compiled schema, a stub ExtensionPreferences
// registered as a GResource, and a private headless GTK display. The owner's
// display, bus, settings and keyring are never reached.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createAiSession } from './session.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const GJS_DIR = path.join(import.meta.dirname, 'gjs');
const DRIVER = path.join(GJS_DIR, 'prefsDriver.js');
const DRIVER_TIMEOUT_MS = 60_000;
const DISPLAY_WAIT_MS = 5000;
const DISPLAY = 5;
const STEP_PREFIX = 'PREFS-STEP ';

const PROGRAMS = ['gjs', 'dbus-daemon', 'gnome-keyring-daemon', 'gtk4-broadwayd', 'glib-compile-resources',
    'glib-compile-schemas'];

/** Every program the prefs tests need that is not on PATH. */
export function missingPrefsPrograms() {
    return PROGRAMS.filter(p => spawnSync('sh', ['-c', `command -v ${p}`]).status !== 0);
}

function runOrThrow(program, args, env) {
    const r = spawnSync(program, args, { env, encoding: 'utf8' });
    if (r.status !== 0)
        throw new Error(`${program} failed (${r.status ?? r.signal}): ${r.stderr}`);
}

async function waitForFile(file, timeoutMs, what) {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file)) {
        if (Date.now() > deadline)
            throw new Error(`timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

/**
 * createAiSession(name), plus the compiled schema in <home>/schemas, the stub base class
 * compiled into <home>/prefs-stub.gresource, and `gtk4-broadwayd -u` on display :5 with its
 * socket inside the private XDG_RUNTIME_DIR (never without -u: it would listen on TCP).
 * env gains GSETTINGS_SCHEMA_DIR, GDK_BACKEND=broadway, BROADWAY_DISPLAY=:5, GTK_A11Y=none,
 * ADW_DISABLE_PORTAL=1 and PAYATTENTION_PREFS_STUB.
 *
 * @param {string} name
 * @returns {Promise<{home:string, env:object,
 *   runDriver:(scenario:string, args?:string[], extraEnv?:object) => Promise<{status:number, steps:object[], output:string}>,
 *   stop:() => Promise<void>}>} stop: SIGTERM broadwayd and await it, then the session's stop()
 */
export async function createPrefsSession(name) {
    const session = await createAiSession(name);
    const { home, env } = session;
    let broadway = null;
    let broadwayExited = Promise.resolve();
    try {
        const schemaDir = path.join(home, 'schemas');
        fs.mkdirSync(schemaDir, { recursive: true });
        runOrThrow('glib-compile-schemas', ['--strict', `--targetdir=${schemaDir}`, path.join(repoRoot, 'extension/schemas')], env);

        const xml = path.join(home, 'prefs-stub.gresource.xml');
        const gresource = path.join(home, 'prefs-stub.gresource');
        fs.writeFileSync(xml, `<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/org/gnome/Shell/Extensions/js/extensions">
    <file alias="prefs.js">stubExtensionPreferences.js</file>
  </gresource>
</gresources>
`);
        runOrThrow('glib-compile-resources', [`--sourcedir=${GJS_DIR}`, `--target=${gresource}`, xml], env);

        const socket = path.join(env.XDG_RUNTIME_DIR, 'broadway-http.sock');
        broadway = spawn('gtk4-broadwayd', ['-u', socket, `:${DISPLAY}`], { env, stdio: ['ignore', 'ignore', 'inherit'] });
        broadwayExited = new Promise(resolve => broadway.once('exit', resolve));
        await waitForFile(path.join(env.XDG_RUNTIME_DIR, `broadway${DISPLAY + 1}.socket`), DISPLAY_WAIT_MS,
            'the private broadway display');

        Object.assign(env, {
            GSETTINGS_SCHEMA_DIR: schemaDir,
            GDK_BACKEND: 'broadway',
            BROADWAY_DISPLAY: `:${DISPLAY}`,
            GTK_A11Y: 'none',
            ADW_DISABLE_PORTAL: '1',
            PAYATTENTION_PREFS_STUB: gresource,
        });
    } catch (e) {
        broadway?.kill('SIGTERM');
        await broadwayExited;
        await session.stop();
        throw e;
    }

    function runDriver(scenario, args = [], extraEnv = {}) {
        return new Promise((resolve, reject) => {
            const child = spawn('gjs', ['-m', DRIVER, scenario, ...args],
                { cwd: repoRoot, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '', stdout = '';
            child.stdout.setEncoding('utf8').on('data', d => {
                stdout += d;
                output += d;
            });
            child.stderr.setEncoding('utf8').on('data', d => (output += d));
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error(`prefs driver ${scenario} did not finish within ${DRIVER_TIMEOUT_MS} ms\n${output}`));
            }, DRIVER_TIMEOUT_MS);
            child.once('error', e => {
                clearTimeout(timer);
                reject(e);
            });
            child.once('exit', (code, signal) => {
                clearTimeout(timer);
                const steps = stdout.split('\n').filter(l => l.startsWith(STEP_PREFIX))
                    .map(l => JSON.parse(l.slice(STEP_PREFIX.length)));
                resolve({ status: code ?? signal, steps, output });
            });
        });
    }

    return {
        home,
        env,
        runDriver,
        stop: async () => {
            broadway.kill('SIGTERM');
            await broadwayExited;
            await session.stop();
        },
    };
}
