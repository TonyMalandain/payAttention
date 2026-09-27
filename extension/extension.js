// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The composition root: builds the controller in enable() and destroys it in
// disable(). No logic here.
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { AiHelperClient } from './shell/aiHelperClient.js';
import { CalendarFeed } from './shell/calendarFeed.js';
import { Controller } from './app/controller.js';
import { Environment } from './shell/environment.js';
import { launchUri } from './shell/launcher.js';
import { Store } from './shell/store.js';
import { Ticker } from './shell/ticker.js';
import { Ui } from './ui/ui.js';

const HELPER_ENTRY = 'main.js';
const AI_HELPER_ENTRY = 'main.js';

export default class PayAttentionExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        const helperPath = `${this.path}/helper/${HELPER_ENTRY}`;
        this._controller = new Controller({
            createStore: onChange => new Store(this._settings, onChange),
            createFeed: onUpdate => new CalendarFeed({ argv: ['gjs', '-m', helperPath], onUpdate, now: () => Date.now() }),
            createEnvironment: onResume => new Environment({ onResume }),
            createUi: dispatch => new Ui({ dispatch, openPreferences: () => this.openPreferences() }),
            createTicker: onTick => new Ticker(1000, onTick),
            createAiClient: engine => new AiHelperClient({
                argv: ['gjs', '-m', `${this.path}/ai/${AI_HELPER_ENTRY}`], engine, now: () => Date.now(),
            }),
            createAiTicker: onTick => new Ticker(1000, onTick),
            launchUri,
            now: () => Date.now(),
        });
    }

    disable() {
        this._controller?.destroy();
        this._controller = null;
        this._settings = null;
    }

    /** Runs the ~30 s test alert (interfaces.md §4; the menu and the smoke test use it). */
    runTestAlert() {
        this._controller?.runTestAlert();
    }
}
