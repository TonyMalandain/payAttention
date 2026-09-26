// A corner (steps 1-2) or centred (step 3) alert card. Own chrome, never a
// notification (ADR-0004); it never takes key focus.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { AlertContent } from './alertContent.js';

const MARGIN = 24;

export class Card {
    /**
     * Its key, step and isTest are fixed for its lifetime.
     *
     * @param {import('../shell/view.js').AlertView} alert
     * @param {(action: object) => void} dispatch
     */
    constructor(alert, dispatch) {
        this._key = alert.key;
        this._step = alert.step;
        this._isTest = alert.isTest;
        this._root = new St.BoxLayout({
            name: 'payattention-card',
            style_class: `payattention-card payattention-card-step${alert.step}`,
            reactive: true,
            orientation: Clutter.Orientation.VERTICAL,
        });
        this._content = new AlertContent(alert, dispatch, 'card');
        this._root.add_child(this._content.actor);
        // Taken once: the card stays on the monitor it appeared on.
        this._monitorIndex = global.display.get_current_monitor();
        // Chrome stays above normal and full-screen windows and gets an input region.
        Main.layoutManager.addChrome(this._root);
        this._root.connect('notify::size', () => this._place());
        this._place();
    }

    get key() {
        return this._key;
    }

    get step() {
        return this._step;
    }

    get isTest() {
        return this._isTest;
    }

    /** @returns {St.BoxLayout} the root, for the pulse style class */
    get actor() {
        return this._root;
    }

    /** @param {import('../shell/view.js').AlertView} alert */
    update(alert) {
        this._content.update(alert);
    }

    destroy() {
        this._content?.destroy();
        this._content = null;
        // Destroying a chrome actor also untracks it.
        this._root?.destroy();
        this._root = null;
    }

    _place() {
        const wa = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
        if (!wa || !this._root)
            return;
        const [width, height] = this._root.get_size();
        let x, y;
        if (this._step <= 2) {
            x = wa.x + wa.width - width - MARGIN;
            y = wa.y + MARGIN;
        } else {
            x = wa.x + (wa.width - width) / 2;
            y = wa.y + (wa.height - height) / 2;
        }
        this._root.set_position(Math.round(x), Math.round(y));
    }
}
