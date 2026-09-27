// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Pure text rules of the transcription.
import { MAX_DESCRIPTION_LENGTH } from '../core/protocol.js';

/**
 * Trim, strip one leading "mailto:" in any case, lowercase. null/undefined -> "".
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function normaliseAddress(value) {
    if (value === null || value === undefined)
        return '';
    return value.trim().replace(/^mailto:/i, '').toLowerCase();
}

/**
 * At most MAX_DESCRIPTION_LENGTH UTF-16 units; never ends on a lone high
 * surrogate. null/undefined -> "".
 *
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function truncateDescription(text) {
    if (text === null || text === undefined)
        return '';
    if (text.length <= MAX_DESCRIPTION_LENGTH)
        return text;
    let cut = MAX_DESCRIPTION_LENGTH;
    const last = text.charCodeAt(cut - 1);
    if (last >= 0xD800 && last <= 0xDBFF)
        cut -= 1;
    return text.slice(0, cut);
}
