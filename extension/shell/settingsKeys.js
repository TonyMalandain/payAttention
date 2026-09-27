// Which GSettings key holds each owner setting, and of what kind. Pure.
import { DEFAULT_SETTINGS } from '../core/defaults.js';

function kindOf(value) {
    if (typeof value === 'number')
        return 'int';
    if (typeof value === 'boolean')
        return 'bool';
    if (typeof value === 'string')
        return 'str';
    return 'strv';
}

/**
 * One entry per DEFAULT_SETTINGS field, in its order: the camelCase field,
 * its GSettings key (onlineHeadsupMinutes → online-headsup-minutes) and kind. Frozen.
 *
 * @type {ReadonlyArray<Readonly<{field: string, key: string, kind: 'int'|'bool'|'strv'|'str'}>>}
 */
export const SETTINGS_KEYS = Object.freeze(Object.entries(DEFAULT_SETTINGS).map(([field, value]) => Object.freeze({
    field,
    key: field.replace(/[A-Z]/g, c => '-' + c.toLowerCase()),
    kind: kindOf(value),
})));

/** Keys never shown in prefs and never reported to the controller as a settings change. */
export const INTERNAL_KEYS = Object.freeze(['alert-state', 'health-data-at', 'health-provider-at', 'ai-verdicts']);
