// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The full-screen takeover: one panel per monitor and a modal grab, so only
// an action clears it (ADR-0004). The grab is always popped before the actors
// are destroyed.
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { AlertContent } from './alertContent.js';
import { takeoverSize } from './takeoverSize.js';

export class Takeover {
    /** Connects nothing and creates no actors. */
    constructor() {
        this._root = null;
        this._grab = null;
        this._panels = [];
        this._contents = [];
        this._alert = null;
        this._dispatch = null;
    }

    /** @returns {boolean} */
    get isShown() {
        return this._root !== null;
    }

    /**
     * Builds if needed, updates the text on every panel, then takes the grab if
     * it is not held. A failed grab is logged and retried on the next show().
     *
     * @param {import('../shell/view.js').AlertView} alert
     * @param {(action: object) => void} dispatch
     */
    show(alert, dispatch) {
        this._alert = alert;
        this._dispatch = dispatch;
        try {
            if (!this._root)
                this._build();
            for (const content of this._contents)
                content.update(alert);
        } catch (e) {
            this.hide();
            throw e;
        }
        if (this._grab)
            return;
        try {
            this._grab = Main.pushModal(this._root, { actionMode: Shell.ActionMode.SYSTEM_MODAL });
        } catch (e) {
            // The overlays still show; the next tick retries.
            console.error('payattention: grab-failed', e.message);
            this._grab = null;
        }
    }

    /** Rebuilds the panels for the current monitors, keeping the root and the grab. */
    relayout() {
        if (!this._root)
            return;
        try {
            this._destroyPanels();
            this._buildPanels();
        } catch (e) {
            this.hide();
            throw e;
        }
    }

    /** Pops the grab, then destroys the actors. Idempotent. */
    hide() {
        if (this._grab) {
            try {
                Main.popModal(this._grab);
            } catch (e) {
                console.error('payattention: grab-release-failed', e.message);
            }
            this._grab = null;
        }
        this._destroyPanels();
        this._root?.destroy();
        this._root = null;
    }

    destroy() {
        this.hide();
    }

    _build() {
        this._root = new St.Widget({
            name: 'payattention-takeover',
            style_class: 'payattention-takeover',
            reactive: true,
            constraints: new Clutter.BindConstraint({ source: global.stage, coordinate: Clutter.BindCoordinate.ALL }),
        });
        Main.layoutManager.modalDialogGroup.add_child(this._root);
        // Escape does nothing; Enter does nothing until the owner tabs to a button.
        this._root.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Tab)
                this._root.navigate_focus(global.stage.key_focus, St.DirectionType.TAB_FORWARD, true);
            else if (symbol === Clutter.KEY_ISO_Left_Tab)
                this._root.navigate_focus(global.stage.key_focus, St.DirectionType.TAB_BACKWARD, true);
            return Clutter.EVENT_STOP;
        });
        this._buildPanels();
    }

    _buildPanels() {
        Main.layoutManager.monitors.forEach((monitor, i) => {
            const panel = new St.BoxLayout({
                name: `payattention-takeover-monitor-${i}`,
                // Smaller text on small monitors keeps every button on screen.
                style_class: `payattention-takeover-panel payattention-takeover-${takeoverSize(monitor)}`,
                orientation: Clutter.Orientation.VERTICAL,
            });
            // The panel fills its monitor (a CENTER align would shrink it to its
            // natural size); the content centres itself inside it.
            panel.add_constraint(new Layout.MonitorConstraint({ index: i }));
            const content = new AlertContent(this._alert, this._dispatch, 'takeover');
            panel.add_child(content.actor);
            this._root.add_child(panel);
            this._panels.push(panel);
            this._contents.push(content);
        });
    }

    _destroyPanels() {
        for (const content of this._contents)
            content.destroy();
        for (const panel of this._panels)
            panel.destroy();
        this._contents = [];
        this._panels = [];
    }
}
