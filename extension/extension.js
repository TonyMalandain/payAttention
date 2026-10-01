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
import { StoreReader, StoreWriter } from './shell/store.js';
import { Ticker } from './shell/ticker.js';
import { Ui } from './ui/ui.js';

const HELPER_ENTRY = 'main.js';
const AI_HELPER_ENTRY = 'main.js';
// Only the developer bundle's metadata.json has it, strictly true (ADR-0013, interfaces.md §4.1).
const DEVELOPER_MARKER = 'payattention-developer';

export default class PayAttentionExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        const helperPath = `${this.path}/helper/${HELPER_ENTRY}`;
        this._controller = new Controller({
            createStoreReader: onChange => new StoreReader(this._settings, onChange),
            createStoreWriter: () => new StoreWriter(this._settings),
            createFeed: onUpdate => new CalendarFeed({ argv: ['gjs', '-m', helperPath], onUpdate, now: () => Date.now() }),
            createEnvironment: onResume => new Environment({ onResume }),
            createUi: dispatch => new Ui({ dispatch, openPreferences: () => this.openPreferences() }),
            createTicker: onTick => new Ticker(1000, onTick),
            createAiClient: engine => new AiHelperClient({
                argv: ['gjs', '-m', `${this.path}/ai/${AI_HELPER_ENTRY}`], engine, now: () => Date.now(),
            }),
            createAiTicker: onTick => new Ticker(1000, onTick),
            menuOffersTestAlert: this.metadata[DEVELOPER_MARKER] === true,
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
