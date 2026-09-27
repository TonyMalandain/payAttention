// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Lint config. The per-directory no-restricted-imports rules are the
// "must not import" column of docs/architecture/boundaries.md;
// tests/unit/boundaries.test.js keeps them honest.
import js from '@eslint/js';
import globals from 'globals';

const NO_NODE = { regex: '^node:', message: 'GNOME code cannot import Node modules' };
const NO_SHELL_SIDE_GI = {
    regex: '^gi://(ECal|EDataServer|ICalGLib|Gtk|Gdk|Adw|Soup|Secret)(\\?|$)',
    message: 'shell-side code may not use EDS, GTK/Adw, Soup or Secret (boundaries.md)',
};
const NO_SYSTEM = { regex: '^system$', message: 'only the helper may import system: System.exit would end the session (boundaries.md)' };
const TIME_MESSAGE = 'time and randomness are parameters in core/ and app/';
const NODE_BUILTINS = {
    regex: '^(fs|path|os|child_process|util|events|stream|crypto|url|process|timers|worker_threads)(/.*)?$',
    message: 'no Node built-ins in core/ or app/',
};
const NO_CLOCK_PROPERTIES = [
    { object: 'Date', property: 'now', message: TIME_MESSAGE },
    { object: 'Math', property: 'random', message: TIME_MESSAGE },
];
const NO_CLOCK_SYNTAX = [
    { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: TIME_MESSAGE },
    { selector: "CallExpression[callee.name='Date']", message: TIME_MESSAGE },
];
const SPAWN_MESSAGE = 'start helpers with spawnHelper() from shell/helperProcess.js (interfaces.md §1 "Environment")';

export default [
    { ignores: ['node_modules/**', 'dist/**', '.test-home/**', '.smoke-home/**'] },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    {
        // Code that runs in gjs.
        files: ['extension/**/*.js', 'tests/smoke/**/*.js', 'tests/unit/support/gjs-*.js', 'tests/helper/gjs/**/*.js',
            'tests/ai/gjs/**/*.js'],
        ignores: ['extension/core/**', 'extension/app/**'],
        languageOptions: {
            globals: {
                global: 'readonly',
                log: 'readonly',
                logError: 'readonly',
                print: 'readonly',
                printerr: 'readonly',
                console: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
            },
        },
    },
    {
        // Node code.
        files: ['eslint.config.js', 'tests/unit/**/*.js', 'tests/helper/**/*.js', 'tests/ai/**/*.js', 'scripts/**/*.js'],
        ignores: ['tests/unit/support/gjs-*.js', 'tests/helper/gjs/**', 'tests/ai/gjs/**'],
        languageOptions: { globals: globals.node },
    },
    {
        // Core is pure ES: no extra globals, so console, URL and timers are no-undef errors.
        files: ['extension/core/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    { regex: '^(gi|resource|node):', message: 'core/ is pure: no GNOME or Node imports (ADR-0002)' },
                    NODE_BUILTINS,
                    { regex: '^\\.\\./', message: 'core/ may import only core/ modules (core/ is flat)' },
                ],
            }],
            'no-restricted-properties': ['error', ...NO_CLOCK_PROPERTIES],
            'no-restricted-syntax': ['error', ...NO_CLOCK_SYNTAX],
        },
    },
    {
        // app/ is the application ring (ADR-0011): pure JavaScript, every outside part injected.
        // Only console is global: no Shell global, no gjs log/print.
        files: ['extension/app/**/*.js'],
        languageOptions: { globals: { console: 'readonly' } },
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    { regex: '^(gi|resource|node):', message: 'app/ is GNOME-free: no gi://, resource:// or node: imports (ADR-0011)' },
                    NODE_BUILTINS,
                    NO_SYSTEM,
                    { regex: '^\\.\\./(?!core/)', message: 'app/ may import only app/ and core/ modules (ADR-0011)' },
                ],
            }],
            'no-restricted-properties': ['error', ...NO_CLOCK_PROPERTIES],
            'no-restricted-syntax': ['error', ...NO_CLOCK_SYNTAX],
        },
    },
    {
        files: ['extension/helper/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    { regex: '^resource:', message: 'the helper runs outside the shell: no resource:// imports' },
                    {
                        regex: '^gi://(?!(ECal|EDataServer|ICalGLib|Gio|GioUnix|GLib)(\\?|$))',
                        message: 'helper may use only ECal, EDataServer, ICalGLib, Gio, GioUnix, GLib',
                    },
                    { regex: '^\\.\\./core/(?!protocol\\.js$)', message: 'helper may import only core/protocol.js' },
                    { regex: '^\\.\\./(shell|ui|ai|app)/', message: 'helper may not import shell/, ui/, ai/ or app/' },
                    { regex: '^\\.\\./(extension|prefs)\\.js$', message: 'helper may not import extension.js or prefs.js' },
                    NO_NODE,
                ],
            }],
        },
    },
    {
        files: ['extension/ai/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    { regex: '^resource:', message: 'the AI helper runs outside the shell: no resource:// imports' },
                    {
                        regex: '^gi://(?!(Soup|Secret|Gio|GioUnix|GLib)(\\?|$))',
                        message: 'the AI helper may use only Soup, Secret, Gio, GioUnix, GLib',
                    },
                    {
                        regex: '^\\.\\./core/(?!(aiProtocol|aiPrompt|aiEngine)\\.js$)',
                        message: 'the AI helper may import only core/aiProtocol.js, aiPrompt.js and aiEngine.js (ADR-0010)',
                    },
                    { regex: '^\\.\\./(shell|ui|helper|app)/', message: 'the AI helper may not import shell/, ui/, helper/ or app/' },
                    { regex: '^\\.\\./(extension|prefs)\\.js$', message: 'the AI helper may not import extension.js or prefs.js' },
                    NO_NODE,
                ],
            }],
        },
    },
    {
        files: ['extension/shell/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    NO_SHELL_SIDE_GI,
                    { regex: '^\\.\\./(ui|helper|ai)/', message: 'shell/ may not import ui/, helper/ or ai/' },
                    NO_NODE,
                    NO_SYSTEM,
                ],
            }],
        },
    },
    {
        files: ['extension/shell/**/*.js'],
        ignores: ['extension/shell/helperProcess.js'],
        rules: {
            'no-restricted-properties': ['error',
                { object: 'Gio', property: 'Subprocess', message: SPAWN_MESSAGE },
                { object: 'Gio', property: 'SubprocessLauncher', message: SPAWN_MESSAGE }],
        },
    },
    {
        files: ['extension/ui/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    NO_SHELL_SIDE_GI,
                    { regex: '^\\.\\./(shell|app|helper|ai)/', message: 'ui/ may not import shell/, app/, helper/ or ai/' },
                    { regex: '^\\.\\./core/(?!display\\.js$)', message: 'ui/ may import only display helpers (core/display.js)' },
                    NO_NODE,
                    NO_SYSTEM,
                ],
            }],
        },
    },
    {
        files: ['extension/extension.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    NO_SHELL_SIDE_GI,
                    { regex: '^\\./(helper|core|ai)/', message: 'extension.js may not import helper/, core/ or ai/ directly' },
                    NO_NODE,
                    NO_SYSTEM,
                ],
            }],
        },
    },
    {
        files: ['extension/prefs.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    { regex: '^gi://(Clutter|Meta|St|Shell|Soup)(\\?|$)', message: 'prefs runs outside the shell and never uses the network: no Clutter/Meta/St/Shell/Soup' },
                    { regex: '^\\./(shell|app|ui|helper|ai)/', message: 'prefs may not import shell/, app/, ui/, helper/ or ai/' },
                    NO_NODE,
                    NO_SYSTEM,
                ],
            }],
        },
    },
];
