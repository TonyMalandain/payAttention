// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The counts-only text for `--summary`: safe to paste into a bug report. Pure.
// It never includes a title, name, address, place, description, link, uid or
// calendar name.

const DAY_MS = 86_400_000;
const CUTYPES = ['individual', 'group', 'resource', 'room', 'unknown'];

const count = (list, predicate) => list.filter(predicate).length;

function sourceErrorsLine(sources) {
    const byCode = new Map();
    for (const s of sources) {
        if (!s.ok)
            byCode.set(s.error, (byCode.get(s.error) ?? 0) + 1);
    }
    if (byCode.size === 0)
        return 'source-errors none';
    const codes = [...byCode.keys()].sort();
    return 'source-errors ' + codes.map(c => `${c} ${byCode.get(c)}`).join(' ');
}

/**
 * Counts only.
 *
 * @param {object} snapshot a protocol snapshot message
 * @returns {string} 7 lines joined by '\n', with a trailing '\n'
 */
export function formatSummary(snapshot) {
    const { sources, events, generatedAt } = snapshot;
    const attendees = events.flatMap(e => e.attendees);
    const lines = [
        'payattention-helper summary (counts only)',
        `protocol ${snapshot.protocol}`,
        `sources ${sources.length} ok ${count(sources, s => s.ok)} failed ${count(sources, s => !s.ok)} ` +
            `with-owner-address ${count(sources, s => s.ownerEmail !== null)}`,
        sourceErrorsLine(sources),
        `occurrences ${events.length} recurring ${count(events, e => e.recurring)} all-day ${count(events, e => e.allDay)} ` +
            `cancelled ${count(events, e => e.status === 'cancelled')} tentative ${count(events, e => e.status === 'tentative')} ` +
            `with-attendees ${count(events, e => e.attendees.length > 0)} with-organizer ${count(events, e => e.organizer !== null)} ` +
            `with-conference-uri ${count(events, e => e.conferenceUris.length > 0)} ` +
            `with-location ${count(events, e => e.location !== '')} with-description ${count(events, e => e.description !== '')} ` +
            `transparent ${count(events, e => e.transparency === 'transparent')}`,
        `next-24h ${count(events, e => e.end > generatedAt && e.start < generatedAt + DAY_MS)}`,
        `attendees ${attendees.length} ` + CUTYPES.map(c => `${c} ${count(attendees, a => a.cutype === c)}`).join(' '),
    ];
    return lines.join('\n') + '\n';
}
