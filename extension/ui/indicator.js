// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The top-bar countdown and the menu of today's meetings (PRD §5).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { MeetingRow } from './meetingRow.js';

const HIGHLIGHT = 'payattention-indicator-highlight';

function setText(actor, text) {
    if (actor.text !== text)
        actor.text = text;
}

/** True when both lists hold the same keys in the same order. */
function sameKeys(rowsDrawn, rows) {
    return rowsDrawn.length === rows.length && rowsDrawn.every((r, i) => r.key === rows[i].key);
}

export const Indicator = GObject.registerClass({ GTypeName: 'PayAttentionIndicator' },
class Indicator extends PanelMenu.Button {
    /**
     * @param {object} p
     * @param {(action: object) => void} p.dispatch
     * @param {() => void} p.openPreferences
     */
    _init({ dispatch, openPreferences }) {
        super._init(0.5, 'payAttention', false);
        this.name = 'payattention-indicator';
        this._dispatch = dispatch;
        this._signature = null;
        this._rows = [];
        this._pendingRows = null;
        this._rebuildId = 0;

        this._box = new St.BoxLayout({ style_class: 'payattention-indicator-box' });
        this._box.add_child(new St.Icon({ icon_name: 'alarm-symbolic', style_class: 'system-status-icon' }));
        this._warning = new St.Icon({
            icon_name: 'dialog-warning-symbolic',
            style_class: 'system-status-icon payattention-warning',
            visible: false,
        });
        this._box.add_child(this._warning);
        this._label = new St.Label({ name: 'payattention-indicator-label', y_align: Clutter.ActorAlign.CENTER, visible: false });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._box.add_child(this._label);
        this.add_child(this._box);

        this.menu.actor.name = 'payattention-menu';
        this._status = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
        this._status.label.name = 'payattention-menu-status';
        this._status.visible = false;
        this.menu.addMenuItem(this._status);
        this._aiStatus = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
        this._aiStatus.label.name = 'payattention-menu-ai-status';
        this._aiStatus.visible = false;
        this.menu.addMenuItem(this._aiStatus);
        this._meetings = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._meetings);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._testAlert = this.menu.addAction('Test alert', () => dispatch({ type: 'runTestAlert' }));
        this._testAlert.name = 'payattention-menu-test-alert';
        this._testAlert.visible = false;
        this.menu.addAction('Settings', () => openPreferences());
    }

    /** @returns {St.BoxLayout} the panel box, for the pulse style class */
    get box() {
        return this._box;
    }

    /**
     * @param {import('../app/view.js').View['indicator']} indicator
     * @param {import('../app/view.js').View['menu']} menu
     */
    update(indicator, menu) {
        this._label.visible = indicator.text !== null;
        if (indicator.text !== null)
            setText(this._label, indicator.text);
        this._warning.visible = indicator.warning;
        if (indicator.highlighted)
            this._box.add_style_class_name(HIGHLIGHT);
        else
            this._box.remove_style_class_name(HIGHLIGHT);

        this._status.visible = menu.status !== null;
        if (menu.status !== null)
            setText(this._status.label, menu.status);
        this._aiStatus.visible = menu.aiStatus !== null;
        if (menu.aiStatus !== null)
            setText(this._aiStatus.label, menu.aiStatus);
        this._testAlert.visible = menu.showTestAlert;

        if (menu.signature === this._signature)
            return;
        this._signature = menu.signature;
        // Deferred: this may run inside a menu item's own handler, and a redraw can
        // destroy that item (a rebuild, or the travel lines of a mode switch).
        this._pendingRows = menu.meetings;
        if (!this._rebuildId) {
            this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._rebuildId = 0;
                this._drawRows();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _drawRows() {
        const rows = this._pendingRows;
        this._pendingRows = null;
        if (sameKeys(this._rows, rows)) {
            rows.forEach((row, i) => this._rows[i].update(row));
            return;
        }
        // A meeting came, went or moved: rebuild, and keep the open row open if it is still listed.
        const openKey = this.menu.isOpen ? (this._rows.find(r => r.expanded)?.key ?? null) : null;
        this._meetings.removeAll();
        this._rows = rows.map(row => new MeetingRow(row, this._dispatch));
        for (const r of this._rows)
            this._meetings.addMenuItem(r.item);
        this._rows.find(r => r.key === openKey)?.expand();
    }

    _onDestroy() {
        if (this._rebuildId) {
            GLib.Source.remove(this._rebuildId);
            this._rebuildId = 0;
        }
        super._onDestroy();
    }
});
