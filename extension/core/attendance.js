// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Online or in person (PRD §2): a join link, a real place, or neither. Internal to core.
import { extractUrls, isConferenceUrl } from './links.js';
import { NOT_A_PLACE_WORDS } from './words.js';

// The same pattern as extractUrls, used to blank links out of the location.
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`()[\]{}]+/gi;
const EDGE_PUNCTUATION = /^[\s.,;:!?()[\]{}"'-]+|[\s.,;:!?()[\]{}"'-]+$/g;

/**
 * What the calendar data says about attending one meeting.
 *
 * @param {import('./types.js').OccurrenceDTO} event
 * @returns {{detected:'online'|'in-person'|'unknown', link:string|null, placeText:string}}
 *   `link` is the first allowlisted https link (conference field, then location,
 *   then description); `placeText` is the location without links, or '' when it
 *   is not a place (empty, or a word like "online" or "TBD")
 */
export function detectAttendance(event) {
    const candidates = [
        ...event.conferenceUris.map(u => u.trim()),
        ...extractUrls(event.location),
        ...extractUrls(event.description),
    ];
    const link = candidates.find(isConferenceUrl) ?? null;

    const p = event.location.replace(URL_IN_TEXT, ' ').replace(/\s+/g, ' ').trim();
    const comparable = p.toLowerCase().replace(EDGE_PUNCTUATION, '');
    const placeText = comparable === '' || NOT_A_PLACE_WORDS.includes(comparable) ? '' : p;

    const detected = link ? 'online' : placeText ? 'in-person' : 'unknown';
    return { detected, link, placeText };
}
