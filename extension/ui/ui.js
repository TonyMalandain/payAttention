// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Draws a display model and reports clicks. Decides nothing: every string
// arrives resolved in the View. Imports nothing from core/.
import GLib from 'gi://GLib';

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Card } from './card.js';
import { Indicator } from './indicator.js';
import { Takeover } from './takeover.js';

const PULSE_MS = 600;
const PULSE_CLASS = 'payattention-pulse-on';
// GNOME Settings > Sound > Alert Sound sets this event in the user's sound theme
// (mutter's own bell plays it). The shell's sound player follows theme changes, and
// canberra falls back to the freedesktop "bell" when the chosen file is missing.
const ALERT_SOUND_EVENT = 'bell-window-system';

export class Ui {
    /**
     * Adds the indicator to the panel. No other actors until render().
     *
     * @param {object} p
     * @param {(action: object) => void} p.dispatch
     * @param {() => void} p.openPreferences
     */
    constructor({ dispatch, openPreferences }) {
        this._dispatch = dispatch;
        this._card = null;
        this._pulseId = 0;
        this._pulseOn = false;
        this._unredirectDisabled = false;
        this._takeover = new Takeover();
        this._indicator = null;
        try {
            this._indicator = new Indicator({ dispatch, openPreferences });
            Main.panel.addToStatusArea('payattention', this._indicator, 0, 'right');
            Main.layoutManager.connectObject('monitors-changed', () => this._onMonitorsChanged(), this);
        } catch (e) {
            // Nothing half-built stays in the panel.
            this.destroy();
            throw e;
        }
    }

    /**
     * Idempotent: the same view twice changes nothing.
     *
     * @param {import('../app/view.js').View} view
     */
    render(view) {
        this._indicator.update(view.indicator, view.menu);
        const a = view.alert;
        if (a === null) {
            this._destroyCard();
            this._takeover.hide();
        } else if (a.presentation === 'takeover') {
            this._destroyCard();
            if (this._indicator.menu.isOpen)
                this._indicator.menu.close(BoxPointer.PopupAnimation.NONE);
            this._takeover.show(a, this._dispatch);
        } else {
            this._takeover.hide();
            const c = this._card;
            if (!c || c.key !== a.key || c.step !== a.step || c.isTest !== a.isTest) {
                this._destroyCard();
                this._card = new Card(a, this._dispatch);
            } else {
                c.update(a);
            }
        }
        this._updateUnredirect();
        this._updatePulse(this._card?.step === 3 || view.indicator.flashing);
    }

    playAlertSound() {
        global.display.get_sound_player().play_from_theme(ALERT_SOUND_EVENT, 'payAttention alert', null);
    }

    /** Pops the grab and destroys the takeover actors. Safe to call any time. */
    releaseTakeover() {
        this._takeover.hide();
    }

    destroy() {
        // The grab goes first, whatever fails after it.
        try {
            this._takeover.hide();
        } finally {
            this._destroyCard();
            this._updatePulse(false);
            this._updateUnredirect();
            Main.layoutManager.disconnectObject(this);
            this._indicator?.destroy();
            this._indicator = null;
        }
    }

    _destroyCard() {
        this._card?.destroy();
        this._card = null;
    }

    // Lets cards draw over direct-scanout full-screen windows; pushModal does the same for the takeover.
    _updateUnredirect() {
        const want = this._card !== null;
        if (want && !this._unredirectDisabled) {
            global.compositor.disable_unredirect();
            this._unredirectDisabled = true;
        } else if (!want && this._unredirectDisabled) {
            global.compositor.enable_unredirect();
            this._unredirectDisabled = false;
        }
    }

    // A display-only timer (boundaries.md allows it).
    _updatePulse(needed) {
        if (needed && !this._pulseId) {
            this._pulseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PULSE_MS, () => {
                this._pulseOn = !this._pulseOn;
                this._setPulseClass(this._pulseOn);
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!needed && this._pulseId) {
            GLib.Source.remove(this._pulseId);
            this._pulseId = 0;
            this._pulseOn = false;
            this._setPulseClass(false);
        }
    }

    _setPulseClass(on) {
        for (const actor of [this._card?.actor, this._indicator?.box]) {
            if (!actor)
                continue;
            if (on)
                actor.add_style_class_name(PULSE_CLASS);
            else
                actor.remove_style_class_name(PULSE_CLASS);
        }
    }

    _onMonitorsChanged() {
        // The next tick recreates the card on the right monitor.
        this._destroyCard();
        this._updateUnredirect();
        this._takeover.relayout();
    }
}
