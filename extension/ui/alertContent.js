// The content shared by a card and each takeover panel: text and buttons.
// Draws what the view says and reports clicks; decides nothing.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

// A click already under way when the alert appears must not choose an action.
const ARM_DELAY_MS = 800;

function label(styleClass, text) {
    return new St.Label({ style_class: styleClass, text });
}

function setText(actor, text) {
    if (actor.text !== text)
        actor.text = text;
}

/** Builds the content shared by a card and each takeover panel. */
export class AlertContent {
    /**
     * @param {import('../shell/view.js').AlertView} alert
     * @param {(action: object) => void} dispatch
     * @param {'card'|'takeover'} size
     */
    constructor(alert, dispatch, size) {
        this._dispatch = dispatch;
        this._key = alert.key;
        this._travelOpen = false;
        this._travelShown = null;
        this._alsoShown = null;
        this._actionsShown = null;
        this._buttons = [];
        this._armId = 0;

        const takeover = size === 'takeover';
        this._actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'payattention-content',
            x_align: takeover ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
            y_align: takeover ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
            x_expand: takeover,
            y_expand: takeover,
        });

        this._headline = label('payattention-headline', alert.headline);
        this._title = label('payattention-title', alert.title);
        this._title.clutter_text.line_wrap = true;
        this._actor.add_child(this._headline);
        this._actor.add_child(this._title);
        if (takeover) {
            this._countdown = label('payattention-countdown', alert.countdown);
            this._caption = label('payattention-caption', alert.countdownCaption);
            this._actor.add_child(this._countdown);
            this._actor.add_child(this._caption);
        }
        this._time = label('payattention-time', alert.timeLine);
        this._reason = label('payattention-reason', alert.reason);
        this._actor.add_child(this._time);
        this._actor.add_child(this._reason);

        this._travelBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL });
        this._alsoBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL });
        this._actionsBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, style_class: 'payattention-actions' });
        this._actor.add_child(this._travelBox);
        this._actor.add_child(this._alsoBox);
        this._actor.add_child(this._actionsBox);

        this.update(alert);
    }

    /** @returns {St.BoxLayout} */
    get actor() {
        return this._actor;
    }

    /**
     * Sets text only where it changed.
     *
     * @param {import('../shell/view.js').AlertView} alert
     */
    update(alert) {
        setText(this._headline, alert.headline);
        setText(this._title, alert.title);
        if (this._countdown) {
            setText(this._countdown, alert.countdown);
            setText(this._caption, alert.countdownCaption);
        }
        setText(this._time, alert.timeLine);
        setText(this._reason, alert.reason);
        this._updateTravel(alert.travel);
        this._updateAlso(alert.also);
        this._updateActions(alert);
    }

    destroy() {
        if (this._armId) {
            GLib.Source.remove(this._armId);
            this._armId = 0;
        }
        this._actor?.destroy();
        this._actor = null;
        this._buttons = [];
    }

    _updateTravel(travel) {
        const shown = JSON.stringify(travel);
        if (shown === this._travelShown)
            return;
        this._travelShown = shown;
        this._travelBox.destroy_all_children();
        if (!travel)
            return;
        if (travel.choices.length === 0) {
            this._travelBox.add_child(label('payattention-time', travel.text));
            return;
        }
        const toggle = new St.Button({ style_class: 'payattention-travel-toggle', label: `${travel.text} · change`, can_focus: true, x_align: Clutter.ActorAlign.START });
        const choices = new St.BoxLayout({ style_class: 'payattention-actions', visible: this._travelOpen });
        toggle.connect('clicked', () => {
            this._travelOpen = !this._travelOpen;
            choices.visible = this._travelOpen;
        });
        for (const minutes of travel.choices) {
            const button = new St.Button({ style_class: 'payattention-button', label: `${minutes} min`, can_focus: true });
            if (minutes === travel.minutes)
                button.add_style_class_name('payattention-choice-current');
            button.connect('clicked', () => this._dispatch({ type: 'setTravel', placeKey: travel.placeKey, minutes }));
            choices.add_child(button);
        }
        this._travelBox.add_child(toggle);
        this._travelBox.add_child(choices);
    }

    _updateAlso(also) {
        const shown = also.join('\n');
        if (shown === this._alsoShown)
            return;
        this._alsoShown = shown;
        this._alsoBox.destroy_all_children();
        for (const text of also)
            this._alsoBox.add_child(label('payattention-also', text));
    }

    _updateActions(alert) {
        // Rebuilt, and re-armed, only when the meeting or its choices change.
        const shown = `${alert.key}|${alert.canJoin}|${alert.offerSeries}`;
        if (shown === this._actionsShown)
            return;
        this._actionsShown = shown;
        this._key = alert.key;
        this._actionsBox.destroy_all_children();
        this._buttons = [];

        const row1 = new St.BoxLayout({ style_class: 'payattention-actions' });
        const row2 = new St.BoxLayout({ style_class: 'payattention-actions' });
        if (alert.canJoin)
            row1.add_child(this._button('join', 'Join', true, () => ({ type: 'join', key: this._key })));
        row1.add_child(this._button('ack', "I'm on it", !alert.canJoin, () => ({ type: 'ack', key: this._key })));
        row1.add_child(this._button('snooze', 'Snooze', false, () => ({ type: 'snooze', key: this._key })));
        row2.add_child(this._button('skip', 'Skip this one', false, () => ({ type: 'skip', key: this._key })));
        row2.add_child(this._button('ignore', 'Not important', false,
            () => ({ type: 'setVerdict', key: this._key, verdict: 'ignore', scope: 'occ' })));
        if (alert.offerSeries) {
            row2.add_child(this._button('ignore-series', 'Not important: whole series', false,
                () => ({ type: 'setVerdict', key: this._key, verdict: 'ignore', scope: 'series' })));
        }
        this._actionsBox.add_child(row1);
        this._actionsBox.add_child(row2);
        this._arm();
    }

    _button(id, text, primary, action) {
        const button = new St.Button({
            name: `payattention-action-${id}`,
            label: text,
            style_class: primary ? 'payattention-button payattention-button-primary' : 'payattention-button',
            can_focus: true,
            reactive: false,
        });
        button.connect('clicked', () => this._dispatch(action()));
        this._buttons.push(button);
        return button;
    }

    _arm() {
        if (this._armId)
            GLib.Source.remove(this._armId);
        this._armId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ARM_DELAY_MS, () => {
            this._armId = 0;
            for (const button of this._buttons)
                button.reactive = true;
            return GLib.SOURCE_REMOVE;
        });
    }
}
