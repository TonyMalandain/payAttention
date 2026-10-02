// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// One meeting's row in the top-bar menu (PRD §5). Its changes never close the menu (PG-15).
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/** A line in a meeting's row that does its action and leaves the menu open (PG-15). */
const RowAction = GObject.registerClass({ GTypeName: 'PayAttentionRowAction' },
class RowAction extends PopupMenu.PopupMenuItem {
    /**
     * @param {string} text
     * @param {() => void} onActivate
     */
    _init(text, onActivate) {
        super._init(text);
        this._onActivate = onActivate;
    }

    // Never emits 'activate': the menu closes on that signal (popupMenu.js itemActivated).
    activate() {
        this._onActivate();
    }
});

/** The Must attend switch: reports only the owner's own changes, and leaves the menu open. */
const MustAttendSwitch = GObject.registerClass({ GTypeName: 'PayAttentionMustAttendSwitch' },
class MustAttendSwitch extends PopupMenu.PopupSwitchMenuItem {
    /**
     * @param {boolean} state
     * @param {(state: boolean) => void} onOwnerToggle called for a click, a key or a drag; never for showState()
     */
    _init(state, onOwnerToggle) {
        super._init('Must attend', state);
        this._drawing = false;
        this.connect('toggled', (_item, s) => {
            if (!this._drawing)
                onOwnerToggle(s);
        });
    }

    /** Draws the View's state. setToggleState emits 'toggled', so this is never reported as the owner's. */
    showState(state) {
        this._drawing = true;
        try {
            this.setToggleState(state);
        } finally {
            this._drawing = false;
        }
    }

    // Toggles without emitting 'activate' (PG-15).
    activate() {
        this.toggle();
    }
});

export class MeetingRow {
    /**
     * @param {import('../app/view.js').MeetingRow} row
     * @param {(action: object) => void} dispatch
     */
    constructor(row, dispatch) {
        this._dispatch = dispatch;
        this._item = new PopupMenu.PopupSubMenuMenuItem(row.label);
        this._detail = new St.Label({
            text: row.detail,
            style_class: 'payattention-row-detail',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._item.insert_child_above(this._detail, this._item.label);

        const menu = this._item.menu;
        this._reason = new PopupMenu.PopupMenuItem(row.reason);
        this._reason.setSensitive(false);
        menu.addMenuItem(this._reason);

        // Every handler reads this._row when it runs: the row is redrawn in place, so a captured row goes stale.
        this._must = new MustAttendSwitch(row.isMust, state =>
            dispatch({ type: 'setVerdict', key: this._row.key, verdict: state ? 'must' : 'ignore', scope: 'occ' }));
        menu.addMenuItem(this._must);
        this._series = new RowAction('Apply to whole series', () => {
            const r = this._row;
            dispatch({ type: 'setVerdict', key: r.key, verdict: r.isMust ? 'must' : 'ignore', scope: 'series' });
        });
        menu.addMenuItem(this._series);
        this._back = new RowAction('Back to automatic', () => {
            const r = this._row;
            dispatch({ type: 'setVerdict', key: r.key, verdict: null, scope: 'occ' });
            if (r.recurring)
                dispatch({ type: 'setVerdict', key: r.key, verdict: null, scope: 'series' });
        });
        menu.addMenuItem(this._back);
        this._mode = new RowAction(row.modeSwitchLabel, () =>
            dispatch({ type: 'setMode', key: this._row.key, mode: this._row.otherMode }));
        menu.addMenuItem(this._mode);
        this._travel = new PopupMenu.PopupMenuSection();
        menu.addMenuItem(this._travel);
        this._travelShape = undefined;
        this._header = null;
        this._choices = [];

        this._row = row;
        this._draw(row);
    }

    /** @returns {PopupMenu.PopupSubMenuMenuItem} the item to add to the menu section */
    get item() {
        return this._item;
    }

    /** @returns {string} the occurrence key this row draws */
    get key() {
        return this._row.key;
    }

    /** @returns {boolean} whether the owner has this row open */
    get expanded() {
        return this._item.menu.isOpen;
    }

    /** Opens this row without animation (to carry an open row across a rebuild). */
    expand() {
        this._item.menu.open(BoxPointer.PopupAnimation.NONE);
    }

    /**
     * Redraws this meeting in place: same widgets, so an open row stays open.
     *
     * @param {import('../app/view.js').MeetingRow} row the same meeting
     * @throws {Error} when row.key is not this row's key
     */
    update(row) {
        if (row.key !== this._row.key)
            throw new Error(`MeetingRow: update for ${row.key} on the row of ${this._row.key}`);
        this._draw(row);
    }

    _draw(row) {
        const hadFocus = this._focusInRow();
        this._row = row;
        this._item.label.text = row.label;
        this._detail.text = row.detail;
        this._reason.label.text = row.reason;
        this._must.showState(row.isMust);
        this._series.visible = row.recurring;
        this._back.visible = row.overridden;
        this._mode.label.text = row.modeSwitchLabel;
        this._drawTravel(row.travel);
        // A keyboard owner whose line was just hidden or rebuilt lands on the always-present switch.
        if (hadFocus && !this._focusInRow())
            this._must.grab_key_focus();
    }

    // The header and the choice lines; rebuilt only when the choices change (in practice, a mode switch).
    _drawTravel(travel) {
        const shape = travel === null ? null : travel.choices.join(',');
        if (shape !== this._travelShape) {
            this._travelShape = shape;
            this._travel.removeAll();
            this._header = null;
            this._choices = [];
            if (travel !== null) {
                this._header = new PopupMenu.PopupMenuItem(travel.header);
                this._header.setSensitive(false);
                this._travel.addMenuItem(this._header);
                for (const minutes of travel.choices) {
                    const item = new RowAction(`${minutes} min`, () =>
                        this._dispatch({ type: 'setTravel', target: this._row.travel.target, minutes }));
                    this._travel.addMenuItem(item);
                    this._choices.push({ minutes, item });
                }
            }
        }
        if (travel === null)
            return;
        this._header.label.text = travel.header;
        for (const { minutes, item } of this._choices)
            item.setOrnament(minutes === travel.minutes ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
    }

    // mapped, not merely present: a hidden line can keep key focus while no longer shown.
    _focusInRow() {
        const f = global.stage.get_key_focus();
        return f !== null && f.mapped && this._item.menu.actor.contains(f);
    }
}
