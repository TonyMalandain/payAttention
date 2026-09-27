// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Default settings, the single source for them (boundaries.md: prefs may import this).
// In-person offsets follow D-008 (10 / 5 / 2 / 0 min before leave-by); travel follows D-006.

/**
 * The default value of every setting, camelCase of the GSettings keys.
 * Frozen, arrays included. The PG-1c schema defaults must equal these.
 *
 * @type {Readonly<import('./types.js').Settings>}
 */
export const DEFAULT_SETTINGS = Object.freeze({
    onlineHeadsupMinutes: 30,
    onlineNudgeMinutes: 10,
    onlineInsistMinutes: 3,
    onlineTakeoverMinutes: 1,
    inpersonHeadsupMinutes: 10,
    inpersonNudgeMinutes: 5,
    inpersonInsistMinutes: 2,
    inpersonTakeoverMinutes: 0,
    defaultTravelMinutes: 30,
    headsupDisplaySeconds: 15,
    snoozeMinutes: 2,
    takeoverSnoozeMinutes: 1,
    cutoffMinutes: 10,
    largeMeetingSize: 15,
    extraImportantWords: Object.freeze([]),
    extraIgnoreWords: Object.freeze([]),
    ownerDomains: Object.freeze([]),
    extraOwnerAddresses: Object.freeze([]),
    soundEnabled: true,
    verdictSource: 'rules',
    aiEndpoint: 'http://127.0.0.1:11434/v1',
    aiModel: '',
});
