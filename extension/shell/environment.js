// Whether the owner is at the machine, and when it resumed from sleep.
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';

/** No input for this long means the owner is away (constraints.md). */
export const ACTIVE_IDLE_MS = 60_000;

export class Environment {
    /**
     * @param {object} p
     * @param {() => void} p.onResume called after the machine wakes from sleep
     */
    constructor({ onResume }) {
        this._loginManager = LoginManager.getLoginManager();
        this._loginManager.connectObject('prepare-for-sleep', (_lm, aboutToSuspend) => {
            if (!aboutToSuspend)
                onResume();
        }, this);
    }

    /** @returns {boolean} true when the owner used the keyboard or pointer within ACTIVE_IDLE_MS */
    isUserActive() {
        return global.backend.get_core_idle_monitor().get_idletime() < ACTIVE_IDLE_MS;
    }

    destroy() {
        this._loginManager?.disconnectObject(this);
        this._loginManager = null;
    }
}
