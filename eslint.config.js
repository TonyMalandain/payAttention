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
const TIME_MESSAGE = 'time and randomness are parameters in core/';

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
        ignores: ['extension/core/**'],
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
                    {
                        regex: '^(fs|path|os|child_process|util|events|stream|crypto|url|process|timers|worker_threads)(/.*)?$',
                        message: 'core/ is pure: no Node built-ins',
                    },
                    { regex: '^\\.\\./', message: 'core/ may import only core/ modules (core/ is flat)' },
                ],
            }],
            'no-restricted-properties': ['error',
                { object: 'Date', property: 'now', message: TIME_MESSAGE },
                { object: 'Math', property: 'random', message: TIME_MESSAGE },
            ],
            'no-restricted-syntax': ['error',
                { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: TIME_MESSAGE },
                { selector: "CallExpression[callee.name='Date']", message: TIME_MESSAGE },
            ],
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
                    { regex: '^\\.\\./(shell|ui|ai)/', message: 'helper may not import shell/, ui/ or ai/' },
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
                    { regex: '^\\.\\./(shell|ui|helper)/', message: 'the AI helper may not import shell/, ui/ or helper/' },
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
        files: ['extension/ui/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    NO_SHELL_SIDE_GI,
                    { regex: '^\\.\\./(shell|helper|ai)/', message: 'ui/ may not import shell/, helper/ or ai/' },
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
                    { regex: '^\\./(shell|ui|helper|ai)/', message: 'prefs may not import shell/, ui/, helper/ or ai/' },
                    NO_NODE,
                    NO_SYSTEM,
                ],
            }],
        },
    },
];
