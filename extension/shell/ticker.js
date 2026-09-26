// Calls a function at a fixed interval until destroyed.
import GLib from 'gi://GLib';

export class Ticker {
    /**
     * @param {number} intervalMs
     * @param {() => void} onTick
     */
    constructor(intervalMs, onTick) {
        this._id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            onTick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /** Idempotent. */
    destroy() {
        if (!this._id)
            return;
        GLib.Source.remove(this._id);
        this._id = 0;
    }
}
