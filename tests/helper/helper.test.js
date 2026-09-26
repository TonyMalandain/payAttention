import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseHelperLine } from '../../extension/core/protocol.js';
import {
    createIsolatedEds, runHelper, startHelper, addFixtureEvent, nextWholeHour, tokyoDate, u, HOUR_MS,
} from './isolatedEds.js';

const MIN_MS = 60_000;
const FIXTURE_CONTENT = ['Tokyo sync', 'Alice', 'owner@fixture.test', 'Rivoli', 'zoom.us', 'meet.google.com', 'Standup', 'Holiday', 'Erin'];

function assertNoContent(text, strings, where) {
    for (const secret of strings)
        assert.equal(text.includes(secret), false, `${where} contains ${JSON.stringify(secret)}`);
}

/** Tokyo midnight starting the Tokyo date of ms. */
function tokyoMidnight(ms) {
    const d = tokyoDate(ms);
    return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) - 9 * HOUR_MS;
}

const pairKey = e => `${e.uid}:${e.recurrenceId}`;
const byUidRid = (a, b) => (pairKey(a) < pairKey(b) ? -1 : pairKey(a) > pairKey(b) ? 1 : 0);
const find = (events, uid, recurrenceId = null) => events.find(e => e.uid === uid && e.recurrenceId === recurrenceId);

describe('helper against the fixture calendar', () => {
    let H, eds, once, lines, snap, summary;
    let serving = null;

    before(async () => {
        H = nextWholeHour(Date.now());
        eds = await createIsolatedEds('read', H);
        once = await runHelper(eds.env, ['--once']);
        lines = once.stdout.split('\n').filter(l => l !== '');
        snap = JSON.parse(lines.at(-1));
        summary = await runHelper(eds.env, ['--summary']);
    });

    afterEach(() => {
        // A failed serve-mode test must not leave a helper running.
        serving?.kill();
        serving = null;
    });

    after(async () => {
        await eds?.stop();
    });

    test('--once exits 0 without a signal', () => {
        assert.deepEqual({ code: once.code, signal: once.signal }, { code: 0, signal: null });
    });

    test('--once prints exactly hello then one snapshot, both valid protocol', () => {
        assert.equal(lines.length, 2);
        for (const line of lines)
            assert.equal(parseHelperLine(line).ok, true);
        assert.equal(lines[0], '{"type":"hello","protocol":1}');
        assert.equal(snap.type, 'snapshot');
    });

    test('the range is one hour before generatedAt to 36 hours after', () => {
        assert.equal(snap.rangeStart, snap.generatedAt - 3_600_000);
        assert.equal(snap.rangeEnd, snap.generatedAt + 129_600_000);
    });

    test('sources are exactly the selected fixture sources (and nothing from a real bus)', () => {
        const withoutName = s => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'name'));
        assert.deepEqual(snap.sources.map(s => s.uid), ['birthdays', 'broken-cal', 'fixture-cal', 'system-calendar']);
        assert.deepEqual(withoutName(snap.sources[0]),
            { uid: 'birthdays', backend: 'contacts', ownerEmail: null, ok: true, error: null, remote: false, connection: null });
        assert.deepEqual(snap.sources[1],
            { uid: 'broken-cal', name: 'Broken', backend: 'no-such-backend', ownerEmail: null, ok: false, error: 'connect-failed', remote: null, connection: null });
        assert.deepEqual(snap.sources[2],
            { uid: 'fixture-cal', name: 'Fixture', backend: 'local', ownerEmail: 'owner@fixture.test', ok: true, error: null, remote: false, connection: null });
        assert.deepEqual(withoutName(snap.sources[3]),
            { uid: 'system-calendar', backend: 'local', ownerEmail: null, ok: true, error: null, remote: false, connection: null });
        assert.equal(typeof snap.sources[0].name, 'string');
        assert.equal(typeof snap.sources[3].name, 'string');
    });

    test('the occurrences are exactly the in-range instances, with times, zones and recurrence transcribed', () => {
        const h = HOUR_MS;
        const A = tokyoMidnight(H + 24 * h);
        const row = (uid, recurrenceId, start, end, allDay = false) =>
            ({ uid, recurrenceId, recurring: recurrenceId !== null, start, end, allDay });
        const expected = [
            row('tz-convert@fixture.test', null, H + h, H + 2 * h),
            row('zoom-description@fixture.test', null, H + 2 * h, H + 3 * h),
            row('series@fixture.test', H + 3 * h, H + 3 * h, H + 3 * h + 30 * MIN_MS),
            row('conference-and-url@fixture.test', null, H + 4 * h, H + 5 * h),
            row('location-only@fixture.test', null, H + 5 * h, H + 6 * h),
            row('cancelled@fixture.test', null, H + 6 * h, H + 7 * h),
            row('long-description@fixture.test', null, H + 7 * h, H + 8 * h),
            row('series@fixture.test', H + 9 * h, H + 10 * h, H + 10 * h + 30 * MIN_MS),
            row('series@fixture.test', H + 15 * h, H + 15 * h, H + 15 * h + 30 * MIN_MS),
            row('all-day@fixture.test', null, A, A + 24 * h, true),
        ];
        const actual = snap.events.map(({ uid, recurrenceId, recurring, start, end, allDay }) =>
            ({ uid, recurrenceId, recurring, start, end, allDay }));
        assert.deepEqual(actual.sort(byUidRid), expected.sort(byUidRid));
    });

    test('out-of-range events and the excluded series instance are absent', () => {
        assert.equal(snap.events.some(e => e.uid === 'too-late@fixture.test'), false);
        assert.equal(snap.events.some(e => e.uid === 'too-early@fixture.test'), false);
        assert.equal(find(snap.events, 'series@fixture.test', H + 21 * HOUR_MS), undefined);
    });

    test('events are sorted by start', () => {
        assert.ok(snap.events.length > 0);
        for (let i = 1; i < snap.events.length; i++)
            assert.ok(snap.events[i - 1].start <= snap.events[i].start, `events[${i}] out of order`);
    });

    test('every event comes from the fixture calendar', () => {
        assert.ok(snap.events.length > 0);
        assert.ok(snap.events.every(e => e.sourceUid === 'fixture-cal'));
    });

    test('the organiser and every attendee of tz-convert are transcribed, rooms as rooms', () => {
        const ev = find(snap.events, 'tz-convert@fixture.test');
        assert.deepEqual(ev.organizer, { email: 'alice@external.test', name: 'Alice Organiser' });
        assert.deepEqual(ev.attendees, [
            { email: 'owner@fixture.test', name: 'Owner', partstat: 'accepted', cutype: 'individual', role: 'req-participant' },
            { email: 'bob@external.test', name: 'Bob', partstat: 'tentative', cutype: 'individual', role: 'opt-participant' },
            { email: 'room4@rooms.fixture.test', name: 'Board Room 4', partstat: 'accepted', cutype: 'room', role: 'non-participant' },
            { email: 'projector@rooms.fixture.test', name: 'Projector', partstat: 'needs-action', cutype: 'resource', role: 'req-participant' },
            { email: 'team@fixture.test', name: 'Team', partstat: 'declined', cutype: 'group', role: 'chair' },
            { email: 'bot@fixture.test', name: '', partstat: 'delegated', cutype: 'unknown', role: 'other' },
            { email: 'carol@external.test', name: '', partstat: 'other', cutype: 'individual', role: 'req-participant' },
            { email: 'erin@external.test', name: 'Erin', partstat: 'needs-action', cutype: 'individual', role: 'req-participant' },
        ]);
    });

    test('an organiser without CN and an attendee with defaults are transcribed', () => {
        const ev = find(snap.events, 'cancelled@fixture.test');
        assert.deepEqual(ev.organizer, { email: 'dave@external.test', name: '' });
        assert.deepEqual(ev.attendees,
            [{ email: 'owner@fixture.test', name: '', partstat: 'accepted', cutype: 'individual', role: 'req-participant' }]);
    });

    test('status and transparency are transcribed for every event', () => {
        const h = HOUR_MS;
        const expected = [
            ['tz-convert@fixture.test', null, 'confirmed', 'opaque'],
            ['zoom-description@fixture.test', null, 'tentative', 'transparent'],
            ['series@fixture.test', H + 3 * h, 'none', 'unknown'],
            ['conference-and-url@fixture.test', null, 'none', 'unknown'],
            ['location-only@fixture.test', null, 'none', 'unknown'],
            ['cancelled@fixture.test', null, 'cancelled', 'unknown'],
            ['long-description@fixture.test', null, 'none', 'unknown'],
            ['series@fixture.test', H + 9 * h, 'none', 'unknown'],
            ['series@fixture.test', H + 15 * h, 'cancelled', 'unknown'],
            ['all-day@fixture.test', null, 'none', 'transparent'],
        ];
        for (const [uid, rid, status, transparency] of expected) {
            const ev = find(snap.events, uid, rid);
            assert.deepEqual({ status: ev.status, transparency: ev.transparency }, { status, transparency }, `${uid}:${rid}`);
        }
    });

    test('events without people have no organiser and no attendees', () => {
        for (const uid of ['zoom-description@fixture.test', 'location-only@fixture.test']) {
            const ev = find(snap.events, uid);
            assert.equal(ev.organizer, null, uid);
            assert.deepEqual(ev.attendees, [], uid);
        }
    });

    test('summary, location and description are transcribed for every event', () => {
        const h = HOUR_MS;
        const expected = [
            ['tz-convert@fixture.test', null, 'Tokyo sync', '', ''],
            ['zoom-description@fixture.test', null, 'Zoom in description', '', 'Join: https://zoom.us/j/123456789\nPasscode 42'],
            ['series@fixture.test', H + 3 * h, 'Standup', '', ''],
            ['conference-and-url@fixture.test', null, 'Teams via CONFERENCE', '', ''],
            ['location-only@fixture.test', null, 'Coffee at the office', '12 Rue de Rivoli, Paris', ''],
            ['cancelled@fixture.test', null, 'Cancelled call', '', ''],
            ['series@fixture.test', H + 9 * h, 'Standup (moved)', '', ''],
            ['series@fixture.test', H + 15 * h, 'Standup', '', ''],
            ['all-day@fixture.test', null, 'Holiday', '', ''],
        ];
        for (const [uid, rid, summary, location, description] of expected) {
            const ev = find(snap.events, uid, rid);
            assert.deepEqual({ summary: ev.summary, location: ev.location, description: ev.description },
                { summary, location, description }, `${uid}:${rid}`);
        }
    });

    test('a long description is cut before a split surrogate pair', () => {
        const ev = find(snap.events, 'long-description@fixture.test');
        assert.equal(ev.summary, 'Long');
        assert.equal(ev.description.length, 32767);
        assert.equal(ev.description, 'x'.repeat(32767));
    });

    test('conference links come from X-GOOGLE-CONFERENCE, CONFERENCE and URL, in that order', () => {
        assert.deepEqual(find(snap.events, 'tz-convert@fixture.test').conferenceUris, ['https://meet.google.com/abc-defg-hij']);
        assert.deepEqual(find(snap.events, 'zoom-description@fixture.test').conferenceUris, []);
        assert.deepEqual(find(snap.events, 'conference-and-url@fixture.test').conferenceUris,
            ['https://teams.microsoft.com/l/meetup-join/abc', 'https://example.test/agenda']);
        assert.deepEqual(find(snap.events, 'location-only@fixture.test').conferenceUris, []);
    });

    test('--summary exits 0 and prints the counts-only summary', () => {
        assert.deepEqual({ code: summary.code, signal: summary.signal }, { code: 0, signal: null });
        const out = summary.stdout.split('\n');
        assert.equal(out.length, 8);
        assert.equal(out[7], '');
        assert.deepEqual(out.slice(0, 5), [
            'payattention-helper summary (counts only)',
            'protocol 1',
            'sources 4 ok 3 failed 1 with-owner-address 1',
            'source-errors connect-failed 1',
            'occurrences 10 recurring 3 all-day 1 cancelled 2 tentative 1 with-attendees 2 with-organizer 2 ' +
                'with-conference-uri 2 with-location 1 with-description 2 transparent 2',
        ]);
        // Whether the all-day event starts within 24 h depends on the time of day.
        assert.match(out[5], /^next-24h (9|10)$/);
        assert.equal(out[6], 'attendees 9 individual 5 group 1 resource 1 room 1 unknown 1');
    });

    test('no calendar content reaches the summary or either stderr', () => {
        assertNoContent(summary.stdout, [...FIXTURE_CONTENT, 'Fixture'], '--summary stdout');
        assertNoContent(summary.stderr, [...FIXTURE_CONTENT, 'Fixture'], '--summary stderr');
        assertNoContent(once.stderr, [...FIXTURE_CONTENT, 'Fixture'], '--once stderr');
    });

    test('serve mode: hello, snapshot, refresh, bad input, and exit 0 when stdin closes', async () => {
        serving = startHelper(eds.env);
        assert.deepEqual((await serving.nextMessage(15000)).parsed.message, { type: 'hello', protocol: 1 });
        const first = (await serving.nextMessage(15000)).parsed.message;
        assert.equal(first.type, 'snapshot');
        assert.equal(first.events.length, 10);

        serving.send('{"type":"refresh","reason":"manual"}\n');
        const refreshed = (await serving.nextMessage(5000)).parsed.message;
        assert.equal(refreshed.type, 'snapshot');
        assert.ok(refreshed.generatedAt >= first.generatedAt);

        // The local sources support no refresh, so no sync-failed can come first.
        serving.send('garbage\n');
        assert.deepEqual((await serving.nextMessage(5000)).parsed.message, { type: 'status', level: 'warn', code: 'bad-command' });

        serving.closeStdin();
        assert.deepEqual(await serving.exited(10000), { code: 0, signal: null });
        assertNoContent(serving.stderr(), [...FIXTURE_CONTENT, 'Fixture'], 'serve stderr');
    });

    test('serve mode exits 0 when stdin closes during startup', async () => {
        serving = startHelper(eds.env);
        assert.deepEqual((await serving.nextMessage(15000)).parsed.message, { type: 'hello', protocol: 1 });
        serving.closeStdin();
        assert.deepEqual(await serving.exited(10000), { code: 0, signal: null });
    });
});

describe('helper follows calendar changes', () => {
    let H, eds, serving = null;

    before(async () => {
        H = nextWholeHour(Date.now());
        eds = await createIsolatedEds('live', H);
    });

    after(async () => {
        serving?.kill();
        await eds?.stop();
    });

    test('an event added through EDS appears in a new snapshot within 6 s', async () => {
        serving = startHelper(eds.env);
        assert.equal((await serving.nextMessage(15000)).parsed.message.type, 'hello');
        assert.equal((await serving.nextMessage(15000)).parsed.message.type, 'snapshot');

        await addFixtureEvent(eds.env, 'BEGIN:VEVENT\r\nUID:added@fixture.test\r\nDTSTAMP:20260101T000000Z\r\n' +
            `DTSTART:${u(H + 12 * HOUR_MS)}\r\nDTEND:${u(H + 13 * HOUR_MS)}\r\nSUMMARY:Added\r\nEND:VEVENT\r\n`);
        const added = Date.now();
        let found = null;
        while (!found) {
            const remaining = 6000 - (Date.now() - added);
            assert.ok(remaining > 0, 'no snapshot with the added event within 6 s');
            const message = (await serving.nextMessage(remaining)).parsed.message;
            if (message.type === 'snapshot')
                found = message.events.find(e => e.uid === 'added@fixture.test') ?? null;
        }
        assert.equal(found.start, H + 12 * HOUR_MS);

        serving.closeStdin();
        assert.deepEqual(await serving.exited(10000), { code: 0, signal: null });
    });
});
