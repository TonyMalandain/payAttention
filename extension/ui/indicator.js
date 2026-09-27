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

const HIGHLIGHT = 'payattention-indicator-highlight';

function setText(actor, text) {
    if (actor.text !== text)
        actor.text = text;
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
        this._meetings = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._meetings);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Test alert', () => dispatch({ type: 'runTestAlert' }));
        this.menu.addAction('Settings', () => openPreferences());
    }

    /** @returns {St.BoxLayout} the panel box, for the pulse style class */
    get box() {
        return this._box;
    }

    /**
     * @param {import('../shell/view.js').View['indicator']} indicator
     * @param {import('../shell/view.js').View['menu']} menu
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

        if (menu.signature === this._signature)
            return;
        this._signature = menu.signature;
        // Deferred: this may run inside a menu item's own activate(), and the
        // menu still uses the item after its handlers return (close-on-activate).
        this._pendingRows = menu.meetings;
        if (!this._rebuildId) {
            this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._rebuildId = 0;
                this._rebuildRows();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _rebuildRows() {
        const rows = this._pendingRows;
        this._pendingRows = null;
        this._meetings.removeAll();
        for (const row of rows)
            this._meetings.addMenuItem(this._rowItem(row));
    }

    _onDestroy() {
        if (this._rebuildId) {
            GLib.Source.remove(this._rebuildId);
            this._rebuildId = 0;
        }
        super._onDestroy();
    }

    _rowItem(row) {
        const dispatch = this._dispatch;
        const key = row.key;
        const item = new PopupMenu.PopupSubMenuMenuItem(row.label);
        item.insert_child_above(new St.Label({
            text: row.detail,
            style_class: 'payattention-row-detail',
            y_align: Clutter.ActorAlign.CENTER,
        }), item.label);

        const reason = new PopupMenu.PopupMenuItem(row.reason);
        reason.setSensitive(false);
        item.menu.addMenuItem(reason);

        const must = new PopupMenu.PopupSwitchMenuItem('Must attend', row.isMust);
        must.connect('toggled', (_item, state) =>
            dispatch({ type: 'setVerdict', key, verdict: state ? 'must' : 'ignore', scope: 'occ' }));
        item.menu.addMenuItem(must);

        if (row.recurring) {
            item.menu.addAction('Apply to whole series', () =>
                dispatch({ type: 'setVerdict', key, verdict: row.isMust ? 'must' : 'ignore', scope: 'series' }));
        }
        if (row.overridden) {
            item.menu.addAction('Back to automatic', () => {
                dispatch({ type: 'setVerdict', key, verdict: null, scope: 'occ' });
                if (row.recurring)
                    dispatch({ type: 'setVerdict', key, verdict: null, scope: 'series' });
            });
        }
        item.menu.addAction(row.modeSwitchLabel, () => dispatch({ type: 'setMode', key, mode: row.otherMode }));

        if (row.travel) {
            const header = new PopupMenu.PopupMenuItem(row.travel.header);
            header.setSensitive(false);
            item.menu.addMenuItem(header);
            for (const minutes of row.travel.choices) {
                const choice = item.menu.addAction(`${minutes} min`, () =>
                    dispatch({ type: 'setTravel', placeKey: row.travel.placeKey, minutes }));
                choice.setOrnament(minutes === row.travel.minutes ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NO_DOT);
            }
        }
        return item;
    }
});
