// gjs script, not a Node test: imports every core module and runs the pipeline
// once, proving core uses no Node-only API (ADR-0002). Run by gjs.test.js.
import System from 'system';

import { PROTOCOL_VERSION, parseHelperLine } from '../../../extension/core/protocol.js';
import { occurrenceKey } from '../../../extension/core/keys.js';
import { DEFAULT_SETTINGS } from '../../../extension/core/defaults.js';
import { timingFromSettings } from '../../../extension/core/timing.js';
import { BUILTIN_IGNORE_WORDS } from '../../../extension/core/words.js';
import { isConferenceUrl } from '../../../extension/core/links.js';
import { judge } from '../../../extension/core/judge.js';
import { emptyAlertState, parseAlertState, serializeAlertState, reduce } from '../../../extension/core/alertState.js';
import { plan, actionFor } from '../../../extension/core/plan.js';
import { testAlert } from '../../../extension/core/testAlert.js';
import { formatClock, formatSince } from '../../../extension/core/display.js';
import '../../../extension/core/types.js';

function check(condition, what) {
    if (!condition)
        throw new Error(`check failed: ${what}`);
}

try {
    const start = Date.UTC(2026, 8, 28, 14, 0, 0);
    const attendee = email => ({ email, name: email, partstat: 'accepted', cutype: 'individual', role: 'req-participant' });
    const snap = {
        type: 'snapshot', protocol: PROTOCOL_VERSION, generatedAt: start - 3600000,
        rangeStart: start - 7200000, rangeEnd: start + 36 * 3600000,
        sources: [{ uid: 'src-1', name: 'Work', backend: 'caldav', ownerEmail: 'me@acme.test', ok: true, error: null }],
        events: [{
            sourceUid: 'src-1', uid: 'evt-1', recurrenceId: null, recurring: false,
            start, end: start + 1800000, allDay: false,
            summary: 'Sync', location: 'HQ, Room 2', description: 'Join https://meet.google.com/abc-defg-hij',
            conferenceUris: [], status: 'confirmed', transparency: 'opaque',
            organizer: { email: 'alice@acme.test', name: 'alice' },
            attendees: [attendee('me@acme.test'), attendee('alice@acme.test'), attendee('bob@acme.test')],
        }],
    };

    const parsed = parseHelperLine(JSON.stringify(snap));
    check(parsed.ok, 'snapshot parses');
    check(BUILTIN_IGNORE_WORDS.length > 0 && isConferenceUrl('https://zoom.us/j/1'), 'words and links');

    const judged = judge(parsed.message, DEFAULT_SETTINGS, { verdict: {}, mode: {} }, {});
    check(judged.length === 1 && judged[0].verdict === 'must', 'judge: must-attend');
    check(judged[0].key === occurrenceKey(snap.events[0]), 'judge: key');
    check(judged[0].joinUrl === 'https://meet.google.com/abc-defg-hij', 'judge: join link');

    const timing = timingFromSettings(DEFAULT_SETTINGS);
    const env = { userActive: true, dataHealthy: true };
    const now = start - 60000;
    const result = plan(now, judged, emptyAlertState(), timing, env);
    check(result.primary !== null && result.primary.step === 4 && result.takeover, 'plan: takeover at 1 min');

    const state = reduce(emptyAlertState(), actionFor(result.primary, 'ack'), now);
    const reread = parseAlertState(serializeAlertState(state));
    check(reread.items[judged[0].key].done === 'ack', 'alert state round-trip');
    check(plan(now, judged, reread, timing, env).primary === null, 'plan: acknowledged');

    const t = testAlert(0);
    check(t.judged[0].key === 'test:0', 'test alert');

    check(typeof formatSince(0, 0) === 'string' && typeof formatClock(start) === 'string', 'display runs');

    print('CORE-GJS OK');
} catch (e) {
    print('CORE-GJS FAIL ' + e.message);
    System.exit(1);
}
