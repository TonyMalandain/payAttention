// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Lint config. The per-directory no-restricted-imports rules are the
// "must not import" column of docs/architecture/boundaries.md;
// tests/unit/boundaries.test.js keeps them honest.
import js from '@eslint/js';
import globals from 'globals';

// Every relative pattern starts with UP (a parent directory) or HERE (this directory), so
// './../x', '.././x' and '././x' cannot sidestep a rule written for '../x' or './x'.
// Each prefix consumes every './', so a lookahead after it sees the real directory name.
const UP = '^(?:\\./)*\\.\\./(?:\\./)*(?!\\./)';
const HERE = '^(?:\\./)+(?!\\./)';
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
const GJS_GLOBALS = {
    global: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    console: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
};
const DYNAMIC_IMPORT = { selector: 'ImportExpression', message: 'no dynamic import() in preview/: lint cannot see what it loads' };
const PREVIEW_COMMON = [
    { regex: UP + 'core/(judge|plan|alertState)\\.js$', message: 'the preview never judges, plans or touches alert state (ADR-0012)' },
    { regex: UP + 'app/(?!verdicts\\.js$)', message: 'the preview gets verdicts only from app/verdicts.js (ADR-0012)' },
    { regex: UP + 'shell/store\\.js$', importNames: ['StoreWriter'], message: 'the preview is read-only: it never holds the store writer (ADR-0012)' },
    { regex: UP + '(ui|helper|ai)/', message: 'the preview may not import ui/, helper/ or ai/: it spawns the helpers (ADR-0012)' },
    { regex: UP + '(extension|prefs)\\.js$', message: 'the preview may not import extension.js or prefs.js' },
];
const ONE_JUDGE = 'only app/verdicts.js may import core/judge.js (ADR-0011, boundaries.md)';
const APP_PATTERNS = [
    { regex: '^(gi|resource|node):', message: 'app/ is GNOME-free: no gi://, resource:// or node: imports (ADR-0011)' },
    NODE_BUILTINS,
    NO_SYSTEM,
    { regex: UP + '(?!core/)', message: 'app/ may import only app/ and core/ modules (ADR-0011)' },
];

export default [
    { ignores: ['node_modules/**', 'dist/**', '.test-home/**', '.smoke-home/**', '.sample-home/**', '.isolation-probe/**'] },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    {
        // Code that runs in gjs.
        files: ['extension/**/*.js', 'tests/smoke/**/*.js', 'tests/unit/support/gjs-*.js', 'tests/helper/gjs/**/*.js',
            'tests/ai/gjs/**/*.js'],
        ignores: ['extension/core/**', 'extension/app/**', 'extension/preview/**'],
        languageOptions: { globals: GJS_GLOBALS },
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
                    { regex: UP + '', message: 'core/ may import only core/ modules (core/ is flat)' },
                    { regex: HERE + 'judge\\.js$', message: ONE_JUDGE },
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
            'no-restricted-imports': ['error', { patterns: APP_PATTERNS }],
            'no-restricted-properties': ['error', ...NO_CLOCK_PROPERTIES],
            'no-restricted-syntax': ['error', ...NO_CLOCK_SYNTAX],
        },
    },
    {
        // After the app/ block on purpose: flat config replaces the option list, so this
        // repeats APP_PATTERNS and adds the judge guard for every app/ file but verdicts.js.
        files: ['extension/app/**/*.js'],
        ignores: ['extension/app/verdicts.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [...APP_PATTERNS, { regex: UP + 'core/judge\\.js$', message: ONE_JUDGE }],
            }],
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
                    { regex: UP + 'core/(?!protocol\\.js$)', message: 'helper may import only core/protocol.js' },
                    { regex: UP + '(shell|ui|ai|app)/', message: 'helper may not import shell/, ui/, ai/ or app/' },
                    { regex: UP + '(extension|prefs)\\.js$', message: 'helper may not import extension.js or prefs.js' },
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
                        regex: UP + 'core/(?!(aiProtocol|aiPrompt|aiEngine)\\.js$)',
                        message: 'the AI helper may import only core/aiProtocol.js, aiPrompt.js and aiEngine.js (ADR-0010)',
                    },
                    { regex: UP + '(shell|ui|helper|app)/', message: 'the AI helper may not import shell/, ui/, helper/ or app/' },
                    { regex: UP + '(extension|prefs)\\.js$', message: 'the AI helper may not import extension.js or prefs.js' },
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
                    { regex: UP + '(ui|helper|ai)/', message: 'shell/ may not import ui/, helper/ or ai/' },
                    { regex: UP + 'core/judge\\.js$', message: ONE_JUDGE },
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
                    { regex: UP + '(shell|app|helper|ai)/', message: 'ui/ may not import shell/, app/, helper/ or ai/' },
                    { regex: UP + 'core/(?!display\\.js$)', message: 'ui/ may import only display helpers (core/display.js)' },
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
                    { regex: HERE + '(helper|core|ai)/', message: 'extension.js may not import helper/, core/ or ai/ directly' },
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
                    { regex: HERE + '(shell|app|ui|helper|ai)/', message: 'prefs may not import shell/, app/, ui/, helper/ or ai/' },
                    { regex: HERE + 'core/judge\\.js$', message: ONE_JUDGE },
                    NO_NODE,
                    NO_SYSTEM,
                ],
            }],
        },
    },
    {
        // The preview's entry (ADR-0012, interfaces.md §7.3): its only gi code, composition only.
        files: ['extension/preview/main.js'],
        languageOptions: { globals: GJS_GLOBALS },
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    ...PREVIEW_COMMON,
                    { regex: '^resource:', message: 'the preview runs outside the shell: no resource:// imports' },
                    { regex: '^gi://(?!(Gio|GLib|GLibUnix)(\\?|$))', message: 'the preview may use only Gio, GLib and GLibUnix' },
                    {
                        regex: UP + 'shell/(?!(store|calendarFeed|aiHelperClient|helperProcess|ticker)\\.js$)',
                        message: 'from shell/ the preview may use only the store reader, the calendar feed, the AI client, the spawn rule and the ticker (interfaces.md §7.3)',
                    },
                    NO_NODE,
                ],
            }],
            'no-restricted-properties': ['error',
                { object: 'Gio', property: 'Subprocess', message: SPAWN_MESSAGE },
                { object: 'Gio', property: 'SubprocessLauncher', message: SPAWN_MESSAGE }],
            'no-restricted-syntax': ['error', DYNAMIC_IMPORT],
        },
    },
    {
        // The preview's logic: gi-free, linted like app/, so Node tests it.
        files: ['extension/preview/**/*.js'],
        ignores: ['extension/preview/main.js'],
        languageOptions: { globals: { console: 'readonly' } },
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    ...PREVIEW_COMMON,
                    { regex: '^(gi|resource|node):', message: 'preview/ logic is GNOME-free so Node can test it; only preview/main.js may use gi:// (ADR-0011)' },
                    NODE_BUILTINS,
                    NO_SYSTEM,
                    { regex: UP + '(?!(core|app)/)', message: 'preview/ logic may import only core/, app/verdicts.js and preview/ modules' },
                ],
            }],
            'no-restricted-properties': ['error', ...NO_CLOCK_PROPERTIES],
            'no-restricted-syntax': ['error', ...NO_CLOCK_SYNTAX, DYNAMIC_IMPORT],
        },
    },
];
