// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test-only stand-in for the Extensions app's ExtensionPreferences base class.
// tests/ai/prefsSession.js compiles it into a GResource at the base class's URI,
// so the real prefs.js loads outside the Extensions app. It has only what
// prefs.js uses: if prefs.js ever needs more, the prefs tests fail loudly.
import Gio from 'gi://Gio';

export class ExtensionPreferences {
    constructor(metadata) {
        this.metadata = metadata;
    }

    get path() {
        return this.metadata.path;
    }

    getSettings() {
        return new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.payattention' });
    }
}
