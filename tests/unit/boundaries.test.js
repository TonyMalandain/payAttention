// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
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
    ['extension/extension.js', "import {x} from './shell/controller.js'; export {x};", 'ok'],
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
