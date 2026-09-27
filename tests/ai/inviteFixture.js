// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test support, not a test: one meeting built to exercise every invite rule the
// engine request must obey (interfaces.md §6.2, D-020, D-022, D-024, D-025).
// Synthetic only: every address is on example.invalid.
import { event, att, snapshot, CONFIG, OWNER } from '../unit/support/builders.js';
import { buildInvite } from '../../extension/core/invite.js';
import { ownerIdentity } from '../../extension/core/owner.js';

export const TITLE = 'Hostile fixture: board prep';
export const CALENDAR = 'Family';
export const ZOOM_WITH_PASSCODE = 'https://zoom.us/j/123456789?pwd=AbCdEf';
export const ORGANISER_NAME = 'Olga Organiser';
export const ORGANISER_EMAIL = 'olga@example.invalid';
export const ROOM_NAME = 'Projector Suite';
export const ROOM_EMAIL = 'projector@rooms.example.invalid';
export const PLACE = '12 Example Street';
export const GUEST_COUNT = 30;

const RESPONSES = ['accepted', 'tentative', 'declined', 'needs-action'];

function guest(n) {
    const nn = String(n).padStart(2, '0');
    return {
        email: `guest${nn}@example.invalid`, name: `Guest ${nn}`,
        partstat: RESPONSES[n % RESPONSES.length], cutype: 'individual', role: 'req-participant',
    };
}

/** The meeting before the invite builder: a passcode link, a passcode line, a room, and too much of everything. */
export function hostileEvent() {
    return event({
        summary: TITLE,
        conferenceUris: [ZOOM_WITH_PASSCODE],
        // The passcode rule removes to the end of its line, so the long text is on the next line.
        description: `Join ${ZOOM_WITH_PASSCODE} Passcode: 123456\n` + 'd'.repeat(3000),
        location: PLACE,
        organizer: { email: ORGANISER_EMAIL, name: ORGANISER_NAME },
        attendees: [
            att(OWNER, 'accepted'),
            ...Array.from({ length: GUEST_COUNT }, (_, i) => guest(i + 1)),
            { email: ROOM_EMAIL, name: ROOM_NAME, partstat: 'accepted', cutype: 'room', role: 'non-participant' },
        ],
    });
}

/** @returns {Readonly<object>} the invite core builds from hostileEvent(), in the Family calendar at UTC-4 */
export function hostileInvite() {
    const ev = hostileEvent();
    return buildInvite(ev, ownerIdentity(snapshot([ev]), CONFIG), CALENDAR, -240);
}
