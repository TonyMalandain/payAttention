// Lint config. The per-directory no-restricted-imports rules are the
// "must not import" column of docs/architecture/boundaries.md;
// tests/unit/boundaries.test.js keeps them honest.
import js from '@eslint/js';
import globals from 'globals';

const NO_NODE = { regex: '^node:', message: 'GNOME code cannot import Node modules' };
const NO_SHELL_SIDE_GI = {
    regex: '^gi://(ECal|EDataServer|ICalGLib|Gtk|Gdk|Adw)(\\?|$)',
    message: 'shell-side code may not use EDS or GTK/Adw (boundaries.md)',
};
const TIME_MESSAGE = 'time and randomness are parameters in core/';

export default [
    { ignores: ['node_modules/**', 'dist/**', '.test-home/**'] },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    {
        // Code that runs in gjs.
        files: ['extension/**/*.js', 'tests/smoke/**/*.js', 'tests/unit/support/gjs-*.js'],
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
        files: ['eslint.config.js', 'tests/unit/**/*.js', 'scripts/**/*.js'],
        ignores: ['tests/unit/support/gjs-*.js'],
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
                        regex: '^gi://(?!(ECal|EDataServer|ICalGLib|Gio|GLib)(\\?|$))',
                        message: 'helper may use only ECal, EDataServer, ICalGLib, Gio, GLib',
                    },
                    { regex: '^\\.\\./core/(?!protocol\\.js$)', message: 'helper may import only core/protocol.js' },
                    { regex: '^\\.\\./(shell|ui)/', message: 'helper may not import shell/ or ui/' },
                    { regex: '^\\.\\./(extension|prefs)\\.js$', message: 'helper may not import extension.js or prefs.js' },
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
                    { regex: '^\\.\\./(ui|helper)/', message: 'shell/ may not import ui/ or helper/' },
                    NO_NODE,
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
                    { regex: '^\\.\\./(shell|helper)/', message: 'ui/ may not import shell/ or helper/' },
                    { regex: '^\\.\\./core/(?!format\\.js$)', message: 'ui/ may import only display helpers (core/format.js)' },
                    NO_NODE,
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
                    { regex: '^\\./(helper|core)/', message: 'extension.js may not import helper/ or core/ directly' },
                    NO_NODE,
                ],
            }],
        },
    },
    {
        files: ['extension/prefs.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    { regex: '^gi://(Clutter|Meta|St|Shell)(\\?|$)', message: 'prefs runs outside the shell: no Clutter/Meta/St/Shell' },
                    { regex: '^\\./(shell|ui|helper)/', message: 'prefs may not import shell/, ui/ or helper/' },
                    NO_NODE,
                ],
            }],
        },
    },
];
