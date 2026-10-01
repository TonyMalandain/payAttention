// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const BOUNDARY_RULES = new Set([
    'no-restricted-imports',
    'no-restricted-properties',
    'no-restricted-syntax',
    'no-undef',
]);

// [file path, code, expectation]. 'error' means at least one boundary rule fires.
const CASES = [
    ['extension/core/probe.js', "import Gio from 'gi://Gio'; export {Gio};", 'error'],
    ['extension/core/probe.js', "import fs from 'node:fs'; export {fs};", 'error'],
    ['extension/core/probe.js', "import p from 'path'; export {p};", 'error'],
    ['extension/core/probe.js', "import m from 'resource:///org/gnome/shell/ui/main.js'; export {m};", 'error'],
    ['extension/core/probe.js', "import {x} from '../shell/store.js'; export {x};", 'error'],
    ['extension/core/probe.js', "import {placeKey} from './keys.js'; export {placeKey};", 'ok'],
    ['extension/core/probe.js', 'export const t = Date.now();', 'error'],
    ['extension/core/probe.js', 'export const d = new Date();', 'error'],
    ['extension/core/probe.js', 'export const d = new Date(0);', 'ok'],
    ['extension/core/probe.js', 'export const r = Math.random();', 'error'],
    ['extension/core/probe.js', 'export const s = setTimeout;', 'no-undef'],
    ['extension/core/probe.js', 'export const u = URL;', 'no-undef'],
    ['extension/core/probe.js', 'console.log(1);', 'no-undef'],
    ['extension/helper/probe.js', "import ECal from 'gi://ECal?version=2.0'; export {ECal};", 'ok'],
    ['extension/helper/probe.js', "import St from 'gi://St'; export {St};", 'error'],
    ['extension/helper/probe.js', "import GioUnix from 'gi://GioUnix'; export {GioUnix};", 'ok'],
    ['extension/helper/probe.js', "import System from 'system'; export {System};", 'ok'],
    ['tests/helper/probe.test.js', 'export const e = process.env;', 'ok'],
    ['tests/helper/gjs/probe.js', 'print(1);', 'ok'],
    ['extension/helper/probe.js', "import {parseShellLine} from '../core/protocol.js'; export {parseShellLine};", 'ok'],
    ['extension/helper/probe.js', "import {judge} from '../core/judge.js'; export {judge};", 'error'],
    ['extension/helper/probe.js', "import {x} from '../shell/feed.js'; export {x};", 'error'],
    ['extension/helper/probe.js', "import m from 'resource:///org/gnome/shell/ui/main.js'; export {m};", 'error'],
    ['extension/shell/probe.js', "import ECal from 'gi://ECal'; export {ECal};", 'error'],
    ['extension/shell/probe.js', "import Gtk from 'gi://Gtk?version=4.0'; export {Gtk};", 'error'],
    ['extension/shell/probe.js', "import {x} from '../ui/card.js'; export {x};", 'error'],
    ['extension/shell/probe.js', "import {plan} from '../core/plan.js'; export {plan};", 'ok'],
    ['extension/shell/probe.js', "import * as Main from 'resource:///org/gnome/shell/ui/main.js'; export {Main}; log(global);", 'ok'],
    ['extension/ui/probe.js', "import {x} from '../shell/store.js'; export {x};", 'error'],
    ['extension/ui/probe.js', "import {x} from '../helper/main.js'; export {x};", 'error'],
    ['extension/ui/probe.js', "import E from 'gi://EDataServer'; export {E};", 'error'],
    ['extension/ui/probe.js', "import {plan} from '../core/plan.js'; export {plan};", 'error'],
    ['extension/ui/probe.js', "import {f} from '../core/display.js'; export {f};", 'ok'],
    ['extension/ui/probe.js', "import {f} from '../core/format.js'; export {f};", 'error'],
    ['extension/shell/probe.js', "import System from 'system'; export {System};", 'error'],
    ['extension/ui/probe.js', "import System from 'system'; export {System};", 'error'],
    ['extension/extension.js', "import System from 'system'; export {System};", 'error'],
    ['extension/prefs.js', "import System from 'system'; export {System};", 'error'],
    ['extension/ui/probe.js', "import St from 'gi://St'; export {St};", 'ok'],
    ['extension/extension.js', "import {x} from './helper/main.js'; export {x};", 'error'],
    ['extension/extension.js', "import Adw from 'gi://Adw'; export {Adw};", 'error'],
    ['extension/extension.js', "import {x} from './app/controller.js'; export {x};", 'ok'],
    ['extension/prefs.js', "import St from 'gi://St'; export {St};", 'error'],
    ['extension/prefs.js', "import {x} from './shell/store.js'; export {x};", 'error'],
    ['extension/prefs.js', "import {BUILTIN_IGNORE_WORDS} from './core/words.js'; export {BUILTIN_IGNORE_WORDS};", 'ok'],
    ['extension/prefs.js', "import Adw from 'gi://Adw'; export {Adw};", 'ok'],
    // The AI helper (PG-4b): only it opens a socket, and only it and prefs read the keyring.
    ['extension/ai/probe.js', "import Soup from 'gi://Soup?version=3.0'; export {Soup};", 'ok'],
    ['extension/ai/probe.js', "import Secret from 'gi://Secret'; export {Secret};", 'ok'],
    ['extension/ai/probe.js', "import GioUnix from 'gi://GioUnix'; export {GioUnix};", 'ok'],
    ['extension/ai/probe.js', "import System from 'system'; export {System};", 'ok'],
    ['extension/ai/probe.js', "import {x} from '../core/aiProtocol.js'; export {x};", 'ok'],
    ['extension/ai/probe.js', "import {x} from '../core/aiPrompt.js'; export {x};", 'ok'],
    ['extension/ai/probe.js', "import {x} from '../core/aiEngine.js'; export {x};", 'ok'],
    ['extension/ai/probe.js', "import {x} from './chat.js'; export {x};", 'ok'],
    ['extension/ai/probe.js', "import {x} from '../core/invite.js'; export {x};", 'error'],
    ['extension/ai/probe.js', "import {x} from '../core/judge.js'; export {x};", 'error'],
    ['extension/ai/probe.js', "import {x} from '../core/protocol.js'; export {x};", 'error'],
    ['extension/ai/probe.js', "import ECal from 'gi://ECal'; export {ECal};", 'error'],
    ['extension/ai/probe.js', "import St from 'gi://St'; export {St};", 'error'],
    ['extension/ai/probe.js', "import Gtk from 'gi://Gtk?version=4.0'; export {Gtk};", 'error'],
    ['extension/ai/probe.js', "import {x} from '../helper/stdio.js'; export {x};", 'error'],
    ['extension/ai/probe.js', "import {x} from '../shell/store.js'; export {x};", 'error'],
    ['extension/ai/probe.js', "import {x} from '../ui/card.js'; export {x};", 'error'],
    ['extension/ai/probe.js', "import m from 'resource:///org/gnome/shell/ui/main.js'; export {m};", 'error'],
    ['extension/ai/probe.js', "import http from 'node:http'; export {http};", 'error'],
    ['extension/shell/probe.js', "import Soup from 'gi://Soup?version=3.0'; export {Soup};", 'error'],
    ['extension/shell/probe.js', "import Secret from 'gi://Secret'; export {Secret};", 'error'],
    ['extension/shell/probe.js', "import {x} from '../ai/service.js'; export {x};", 'error'],
    ['extension/ui/probe.js', "import Soup from 'gi://Soup?version=3.0'; export {Soup};", 'error'],
    ['extension/ui/probe.js', "import Secret from 'gi://Secret'; export {Secret};", 'error'],
    ['extension/ui/probe.js', "import {x} from '../ai/main.js'; export {x};", 'error'],
    ['extension/extension.js', "import Soup from 'gi://Soup?version=3.0'; export {Soup};", 'error'],
    ['extension/extension.js', "import Secret from 'gi://Secret'; export {Secret};", 'error'],
    ['extension/extension.js', "import {x} from './ai/main.js'; export {x};", 'error'],
    ['extension/prefs.js', "import Soup from 'gi://Soup?version=3.0'; export {Soup};", 'error'],
    ['extension/prefs.js', "import Secret from 'gi://Secret'; export {Secret};", 'ok'],
    ['extension/prefs.js', "import {x} from './ai/main.js'; export {x};", 'error'],
    ['extension/helper/probe.js', "import Soup from 'gi://Soup?version=3.0'; export {Soup};", 'error'],
    ['extension/helper/probe.js', "import {x} from '../ai/chat.js'; export {x};", 'error'],
    // Every shell spawn goes through spawnHelper, which applies interfaces.md §1 "Environment".
    ['extension/shell/probe.js', "import Gio from 'gi://Gio'; export const p = Gio.Subprocess.new(['x'], 0);", 'error'],
    ['extension/shell/probe.js', "import Gio from 'gi://Gio'; export const l = new Gio.SubprocessLauncher({});", 'error'],
    ['extension/shell/helperProcess.js', "import Gio from 'gi://Gio'; export const l = new Gio.SubprocessLauncher({});", 'ok'],
    ['extension/shell/probe.js', "import Gio from 'gi://Gio'; export const f = Gio.SubprocessFlags.STDIN_PIPE;", 'ok'],
    // app/ (ADR-0011): GNOME-free orchestration; imports only app/ and core/.
    ['extension/app/probe.js', "import Gio from 'gi://Gio'; export {Gio};", 'error'],
    ['extension/app/probe.js', "import m from 'resource:///org/gnome/shell/ui/main.js'; export {m};", 'error'],
    ['extension/app/probe.js', "import fs from 'node:fs'; export {fs};", 'error'],
    ['extension/app/probe.js', "import p from 'path'; export {p};", 'error'],
    ['extension/app/probe.js', "import System from 'system'; export {System};", 'error'],
    ['extension/app/probe.js', "import {x} from '../shell/store.js'; export {x};", 'error'],
    ['extension/app/probe.js', "import {x} from '../ui/card.js'; export {x};", 'error'],
    ['extension/app/probe.js', "import {x} from '../helper/main.js'; export {x};", 'error'],
    ['extension/app/probe.js', "import {x} from '../ai/main.js'; export {x};", 'error'],
    ['extension/app/probe.js', "import {x} from '../preview/main.js'; export {x};", 'error'],
    ['extension/app/probe.js', "import {x} from '../extension.js'; export {x};", 'error'],
    ['extension/app/probe.js', "import {judge} from '../core/judge.js'; export {judge};", 'error'],
    ['extension/app/probe.js', "import {x} from './aiQueue.js'; export {x};", 'ok'],
    ['extension/app/probe.js', 'export const t = Date.now();', 'error'],
    ['extension/app/probe.js', 'export const r = Math.random();', 'error'],
    ['extension/app/probe.js', 'export const d = new Date(0);', 'ok'],
    ['extension/app/probe.js', 'export const g = global;', 'no-undef'],
    ['extension/app/probe.js', "console.error('x');", 'ok'],
    ['extension/ui/probe.js', "import {x} from '../app/view.js'; export {x};", 'error'],
    ['extension/helper/probe.js', "import {x} from '../app/health.js'; export {x};", 'error'],
    ['extension/ai/probe.js', "import {x} from '../app/aiQueue.js'; export {x};", 'error'],
    ['extension/prefs.js', "import {x} from './app/view.js'; export {x};", 'error'],
    ['extension/shell/probe.js', "import {x} from '../app/health.js'; export {x};", 'ok'],
    ['extension/extension.js', "import {x} from './app/controller.js'; export {x};", 'ok'],
    // One verdict pipeline (ADR-0011): only app/verdicts.js imports core/judge.js.
    ['extension/app/verdicts.js', "import {judge} from '../core/judge.js'; export {judge};", 'ok'],
    ['extension/app/verdicts.js', "import Gio from 'gi://Gio'; export {Gio};", 'error'],
    ['extension/shell/probe.js', "import {judge} from '../core/judge.js'; export {judge};", 'error'],
    ['extension/prefs.js', "import {judge} from './core/judge.js'; export {judge};", 'error'],
    ['extension/core/probe.js', "import {judge} from './judge.js'; export {judge};", 'error'],
    ['extension/ui/probe.js', "import {judge} from '../core/judge.js'; export {judge};", 'error'],
    // The preview (ADR-0012, interfaces.md §7.3): a read-only front end; main.js is its only gi code.
    ['extension/preview/main.js', "import Gio from 'gi://Gio'; export {Gio};", 'ok'],
    ['extension/preview/main.js', "import GLibUnix from 'gi://GLibUnix'; export {GLibUnix};", 'ok'],
    ['extension/preview/main.js', "import System from 'system'; export {System};", 'ok'],
    ['extension/preview/main.js', "import {StoreReader} from '../shell/store.js'; export {StoreReader};", 'ok'],
    ['extension/preview/main.js', "import {CalendarFeed} from '../shell/calendarFeed.js'; export {CalendarFeed};", 'ok'],
    ['extension/preview/main.js', "import {Ticker} from '../shell/ticker.js'; export {Ticker};", 'ok'],
    ['extension/preview/main.js', "import {x} from './session.js'; export {x};", 'ok'],
    ['extension/preview/main.js', 'print(1); printerr(2);', 'ok'],
    ['extension/preview/main.js', "import {StoreWriter} from '../shell/store.js'; export {StoreWriter};", 'error'],
    ['extension/preview/main.js', "import * as S from '../shell/store.js'; export {S};", 'error'],
    ['extension/preview/main.js', "import {launchUri} from '../shell/launcher.js'; export {launchUri};", 'error'],
    ['extension/preview/main.js', "import {Environment} from '../shell/environment.js'; export {Environment};", 'error'],
    ['extension/preview/main.js', "import {judge} from '../core/judge.js'; export {judge};", 'error'],
    ['extension/preview/main.js', "import {plan} from '../core/plan.js'; export {plan};", 'error'],
    ['extension/preview/main.js', "import {reduce} from '../core/alertState.js'; export {reduce};", 'error'],
    ['extension/preview/main.js', "import {AiQueue} from '../app/aiQueue.js'; export {AiQueue};", 'error'],
    ['extension/preview/main.js', "import {Controller} from '../app/controller.js'; export {Controller};", 'error'],
    ['extension/preview/main.js', "import {x} from '../ui/card.js'; export {x};", 'error'],
    ['extension/preview/main.js', "import {x} from '../helper/main.js'; export {x};", 'error'],
    ['extension/preview/main.js', "import {x} from '../ai/main.js'; export {x};", 'error'],
    ['extension/preview/main.js', "import m from 'resource:///org/gnome/shell/ui/main.js'; export {m};", 'error'],
    ['extension/preview/main.js', "import St from 'gi://St'; export {St};", 'error'],
    ['extension/preview/main.js', "import Soup from 'gi://Soup?version=3.0'; export {Soup};", 'error'],
    ['extension/preview/main.js', "import Secret from 'gi://Secret'; export {Secret};", 'error'],
    ['extension/preview/main.js', "import ECal from 'gi://ECal'; export {ECal};", 'error'],
    ['extension/preview/main.js', "import Gtk from 'gi://Gtk?version=4.0'; export {Gtk};", 'error'],
    ['extension/preview/main.js', "import Gio from 'gi://Gio'; export const l = new Gio.SubprocessLauncher({});", 'error'],
    ['extension/preview/main.js', "export const m = import('../shell/store.js');", 'error'],
    ['extension/preview/probe.js', "import {Verdicts} from '../app/verdicts.js'; export {Verdicts};", 'ok'],
    ['extension/preview/probe.js', "import {cleanText} from '../core/aiProtocol.js'; export {cleanText};", 'ok'],
    ['extension/preview/probe.js', "import {x} from './report.js'; export {x};", 'ok'],
    ['extension/preview/probe.js', "console.error('x');", 'ok'],
    ['extension/preview/probe.js', 'export const d = new Date(0);', 'ok'],
    ['extension/preview/probe.js', "import GLib from 'gi://GLib'; export {GLib};", 'error'],
    ['extension/preview/probe.js', "import System from 'system'; export {System};", 'error'],
    ['extension/preview/probe.js', "import {StoreReader} from '../shell/store.js'; export {StoreReader};", 'error'],
    ['extension/preview/probe.js', "import {isWaiting} from '../app/aiQueue.js'; export {isWaiting};", 'error'],
    ['extension/preview/probe.js', "import {judge} from '../core/judge.js'; export {judge};", 'error'],
    ['extension/preview/probe.js', 'export const t = Date.now();', 'error'],
    ['extension/preview/probe.js', 'print(1);', 'no-undef'],
    // Patterns match normalised paths: a './' before or after '..' must not sidestep them.
    ['extension/preview/main.js', "import {StoreWriter} from './../shell/store.js'; export {StoreWriter};", 'error'],
    ['extension/preview/main.js', "import {StoreWriter} from '././../shell/store.js'; export {StoreWriter};", 'error'],
    ['extension/preview/main.js', "import {StoreWriter} from '.././shell/store.js'; export {StoreWriter};", 'error'],
    ['extension/preview/main.js', "import {StoreReader} from './../shell/store.js'; export {StoreReader};", 'ok'],
    ['extension/preview/main.js', "import {launchUri} from './../shell/launcher.js'; export {launchUri};", 'error'],
    ['extension/preview/main.js', "import {judge} from './../core/judge.js'; export {judge};", 'error'],
    ['extension/preview/main.js', "import {AiQueue} from './../app/aiQueue.js'; export {AiQueue};", 'error'],
    ['extension/preview/main.js', "import {x} from './../ui/card.js'; export {x};", 'error'],
    ['extension/preview/main.js', "import {x} from './../prefs.js'; export {x};", 'error'],
    ['extension/preview/probe.js', "import {AiQueue} from './../app/aiQueue.js'; export {AiQueue};", 'error'],
    ['extension/preview/probe.js', "import {isWaiting} from '.././app/aiQueue.js'; export {isWaiting};", 'error'],
    ['extension/preview/probe.js', "import {StoreReader} from './../shell/store.js'; export {StoreReader};", 'error'],
    ['extension/preview/probe.js', "import {Verdicts} from './../app/verdicts.js'; export {Verdicts};", 'ok'],
    ['extension/core/probe.js', "import {x} from './../shell/store.js'; export {x};", 'error'],
    ['extension/core/probe.js', "import {judge} from '././judge.js'; export {judge};", 'error'],
    ['extension/app/probe.js', "import {x} from './../shell/store.js'; export {x};", 'error'],
    ['extension/app/probe.js', "import {judge} from './../core/judge.js'; export {judge};", 'error'],
    ['extension/app/probe.js', "import {judge} from '.././core/judge.js'; export {judge};", 'error'],
    ['extension/app/verdicts.js', "import {judge} from './../core/judge.js'; export {judge};", 'ok'],
    ['extension/app/probe.js', "import {placeKey} from '.././core/keys.js'; export {placeKey};", 'ok'],
    ['extension/preview/probe.js', "import {cleanText} from '.././core/aiProtocol.js'; export {cleanText};", 'ok'],
    ['extension/helper/probe.js', "import {judge} from './../core/judge.js'; export {judge};", 'error'],
    ['extension/helper/probe.js', "import {x} from './../shell/feed.js'; export {x};", 'error'],
    ['extension/helper/probe.js', "import {x} from './../prefs.js'; export {x};", 'error'],
    ['extension/helper/probe.js', "import {parseShellLine} from './../core/protocol.js'; export {parseShellLine};", 'ok'],
    ['extension/ai/probe.js', "import {x} from './../core/invite.js'; export {x};", 'error'],
    ['extension/ai/probe.js', "import {x} from './../shell/store.js'; export {x};", 'error'],
    ['extension/ai/probe.js', "import {x} from './../extension.js'; export {x};", 'error'],
    ['extension/ai/probe.js', "import {x} from './../core/aiProtocol.js'; export {x};", 'ok'],
    ['extension/shell/probe.js', "import {x} from './../ui/card.js'; export {x};", 'error'],
    ['extension/shell/probe.js', "import {judge} from './../core/judge.js'; export {judge};", 'error'],
    ['extension/ui/probe.js', "import {x} from './../shell/store.js'; export {x};", 'error'],
    ['extension/ui/probe.js', "import {plan} from './../core/plan.js'; export {plan};", 'error'],
    ['extension/ui/probe.js', "import {f} from './../core/display.js'; export {f};", 'ok'],
    ['extension/extension.js', "import {x} from '././helper/main.js'; export {x};", 'error'],
    ['extension/prefs.js', "import {x} from '././shell/store.js'; export {x};", 'error'],
    ['extension/prefs.js', "import {judge} from '././core/judge.js'; export {judge};", 'error'],
];

describe('lint enforces the module boundaries', () => {
    const eslint = new ESLint({ cwd: repoRoot });

    for (const [file, code, expect] of CASES) {
        test(`${file}: ${code} -> ${expect}`, async () => {
            const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
            const fired = result.messages.filter(m => BOUNDARY_RULES.has(m.ruleId));
            if (expect === 'ok') {
                assert.deepEqual(fired, [], `expected no boundary errors, got ${JSON.stringify(fired)}`);
            } else if (expect === 'no-undef') {
                assert.ok(fired.some(m => m.ruleId === 'no-undef' && m.severity === 2),
                    `expected a no-undef error, got ${JSON.stringify(result.messages)}`);
            } else {
                assert.ok(fired.some(m => m.severity === 2),
                    `expected a boundary error, got ${JSON.stringify(result.messages)}`);
            }
        });
    }
});

describe('only the composition root knows the developer marker (boundaries.md, ADR-0013)', () => {
    test('no file under extension/ but extension.js names payattention-developer', () => {
        const dir = path.join(repoRoot, 'extension');
        const found = fs.readdirSync(dir, { recursive: true })
            .filter(f => f.endsWith('.js'))
            .filter(f => fs.readFileSync(path.join(dir, f), 'utf8').includes('payattention-developer'));
        assert.deepEqual(found, ['extension.js']);
    });
});
