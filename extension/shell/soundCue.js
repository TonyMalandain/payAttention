// When the alert sound plays: once each time a step-3 or step-4 alert newly
// shows. Pure; the controller also requires the sound-enabled setting.

/**
 * @param {{key: string, step: number}|null} previous the visible alert of the previous tick
 * @param {{key: string, step: number}|null} next the visible alert of this tick
 * @returns {boolean}
 */
export function shouldPlaySound(previous, next) {
    return next !== null && next.step >= 3 &&
        !(previous && previous.key === next.key && previous.step === next.step);
}
