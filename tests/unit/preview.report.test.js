// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The preview's presenter (interfaces.md §7.3): the text report and the version-1
// JSON object, from the judged list.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Time formatting depends on the zone; fix it before the modules are loaded.
process.env.TZ = 'UTC';
const { previewJson, previewText, formatPreview } = await import('../../extension/preview/report.js');
const { judge } = await import('../../extension/core/judge.js');
const { DEFAULT_SETTINGS } = await import('../../extension/core/defaults.js');
const { formatClock } = await import('../../extension/core/display.js');
const { T0, MIN, HOUR, SOURCE, event, snapshot } = await import('./support/builders.js');

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const NOW = T0 - HOUR;
const AI_SETTINGS = { ...DEFAULT_SETTINGS, verdictSource: 'ai', aiEndpoint: 'http://127.0.0.1:11434/v1', aiModel: 'test-model' };
const NO_PROGRESS = { pending: 0, byRules: 0 };

const ONLINE = event({ uid: 'online', summary: 'Client review', start: T0, end: T0 + 30 * MIN, conferenceUris: ['https://meet.google.com/abc-defg-hij'] });
const IN_PERSON = event({ uid: 'office', summary: 'Coffee', start: T0 + 2 * HOUR, end: T0 + 3 * HOUR, location: '12 Rue de Rivoli, Paris' });
const ENDED_NOW = event({ uid: 'ended', summary: 'Ended', start: T0 - 2 * HOUR, end: NOW });
const ONGOING = event({ uid: 'ongoing', summary: 'Ongoing', start: T0 - 90 * MIN, end: T0 - 30 * MIN });
const NEXT_DAY = Date.UTC(2026, 8, 29);
const ALL_DAY = event({ uid: 'holiday', summary: 'Holiday', start: NEXT_DAY, end: NEXT_DAY + 24 * HOUR, allDay: true });
const TOMORROW = event({ uid: 'tomorrow', summary: 'Tomorrow sync', start: NEXT_DAY + 9 * HOUR, end: NEXT_DAY + 10 * HOUR });

/** The judged list of events, in judge order. */
function judgedOf(events, { settings = DEFAULT_SETTINGS, overrides = { verdict: {}, mode: {} }, travel = {}, sources = [SOURCE] } = {}) {
    return judge(snapshot(events, sources), { ...settings, ai: null }, overrides, travel, {});
}

function input(over = {}) {
    return {
        now: NOW, settings: DEFAULT_SETTINGS, judged: judgedOf([ONLINE]), sources: [SOURCE],
        aiStatus: 'off', aiProgress: NO_PROGRESS, ...over,
    };
}

const lines = inp => previewText(inp).split('\n');
// C0, DEL and C1 controls, and U+202E (right-to-left override).
const CONTROLS = /[\p{Cc}\u202e]/u;

describe('preview report: which meetings', () => {
    test('the meetings not yet ended (or with no end), in judge order; one that ended at now is absent', () => {
        const judged = judgedOf([ENDED_NOW, ONGOING, ONLINE, IN_PERSON]);
        const noEnd = { ...judged.find(j => j.title === 'Coffee'), key: 'occ:noend|1', end: null };
        const inp = input({ judged: [...judged, noEnd] });
        const keys = previewJson(inp).meetings.map(m => m.key);
        const expected = [...judged.filter(j => j.title !== 'Ended'), noEnd].map(j => j.key);
        assert.deepEqual(keys, expected);
        assert.equal(keys.length, 4);

        const text = previewText(inp);
        assert.ok(!text.includes('Ended'));
        assert.equal(lines(inp).filter(l => /^ {2}\S/.test(l)).length, 4, 'one meeting line per listed meeting');
    });
});

describe('preview report: JSON', () => {
    test('the keys, in the §7.3 order', () => {
        const json = previewJson(input());
        assert.deepEqual(Object.keys(json), ['v', 'generatedAt', 'verdictSource', 'aiStatus', 'calendars', 'meetings']);
        assert.deepEqual(Object.keys(json.meetings[0]), [
            'key', 'seriesKey', 'start', 'end', 'title', 'verdict', 'reasonCode', 'reason', 'mode', 'overridden', 'travelMinutes',
        ]);
        assert.deepEqual(Object.keys(json.calendars[0]), ['name', 'ok', 'error']);
        assert.equal(json.v, 1);
        assert.equal(json.generatedAt, NOW);
        assert.equal(json.aiStatus, 'off');
    });

    test('a meeting carries the judged values', () => {
        const [j] = judgedOf([ONLINE]);
        const [m] = previewJson(input({ judged: [j] })).meetings;
        assert.deepEqual(m, {
            key: j.key, seriesKey: j.seriesKey, start: j.start, end: j.end, title: 'Client review', verdict: j.verdict,
            reasonCode: j.reasonCode, reason: j.reason, mode: 'online', overridden: false, travelMinutes: null,
        });
    });

    test('overridden is verdictOverridden: a mode override alone is not', () => {
        const [j] = judgedOf([ONLINE]);
        const byVerdict = judgedOf([ONLINE], { overrides: { verdict: { [j.key]: 'ignore' }, mode: {} } });
        const byMode = judgedOf([ONLINE], { overrides: { verdict: {}, mode: { [j.key]: 'in-person' } } });
        assert.equal(previewJson(input({ judged: byVerdict })).meetings[0].overridden, true);
        assert.equal(byMode[0].modeOverridden, true);
        assert.equal(previewJson(input({ judged: byMode })).meetings[0].overridden, false);
    });

    test('travelMinutes: null online, the judged minutes in person', () => {
        const judged = judgedOf([ONLINE, IN_PERSON], { settings: { ...DEFAULT_SETTINGS, defaultTravelMinutes: 45 } });
        const [online, office] = previewJson(input({ judged })).meetings;
        assert.equal(online.travelMinutes, null);
        assert.equal(office.mode, 'in-person');
        assert.equal(office.travelMinutes, 45);
    });

    test("verdictSource: 'rules' without an engine, even in AI mode with an unusable address; 'ai' with one", () => {
        assert.equal(previewJson(input()).verdictSource, 'rules');
        const unusable = { ...AI_SETTINGS, aiEndpoint: 'not a url' };
        assert.equal(previewJson(input({ settings: unusable })).verdictSource, 'rules');
        assert.equal(previewJson(input({ settings: AI_SETTINGS })).verdictSource, 'ai');
    });
});

describe('preview report: cleaning', () => {
    const [j] = judgedOf([ONLINE]);
    const dirty = { ...j, title: 'Board\u001b]0;pwned\u0007 sync‮', reason: 'AI: fine\u009b31m print', reasonCode: 'ai-must' };
    const badSource = { ...SOURCE, uid: 'bad', name: 'Bad\u001b[2J cal', ok: false, error: 'gone\u001b[0m away' };

    test('titles, reasons and calendar strings carry no control or bidi character, in both formats', () => {
        const inp = input({ judged: [dirty], sources: [SOURCE, badSource] });
        const text = previewText(inp);
        assert.ok(!CONTROLS.test(text.replaceAll('\n', '')), JSON.stringify(text));
        assert.ok(text.includes('Board ]0;pwned sync'));
        assert.ok(text.includes('AI: fine 31m print'));
        assert.ok(text.includes('Could not read: Bad [2J cal (gone [0m away)'));

        const parsed = JSON.parse(formatPreview(inp, 'json'));
        assert.equal(parsed.meetings[0].title, 'Board ]0;pwned sync');
        assert.equal(parsed.meetings[0].reason, 'AI: fine 31m print');
        assert.deepEqual(parsed.calendars[1], { name: 'Bad [2J cal', ok: false, error: 'gone [0m away' });
        for (const s of [parsed.meetings[0].title, parsed.meetings[0].reason, parsed.calendars[1].name, parsed.calendars[1].error])
            assert.ok(!CONTROLS.test(s), JSON.stringify(s));
    });

    test('the key is not cleaned: byte for byte the judged key', () => {
        const odd = { ...j, key: 'occ:a\u0007b|1', seriesKey: 'series:a\u0007b' };
        const [m] = JSON.parse(formatPreview(input({ judged: [odd] }), 'json')).meetings;
        assert.equal(m.key, odd.key);
        assert.equal(m.seriesKey, odd.seriesKey);
    });
});

describe('preview report: ASCII JSON', () => {
    test('every character is ASCII, and parsing gives back the cleaned title', () => {
        const [j] = judgedOf([ONLINE]);
        const title = 'Réunion 会議 😀';
        const out = formatPreview(input({ judged: [{ ...j, title }] }), 'json');
        for (let i = 0; i < out.length; i++)
            assert.ok(out.charCodeAt(i) <= 0x7e, `char ${i} is ${out.charCodeAt(i).toString(16)}`);
        assert.equal(JSON.parse(out).meetings[0].title, title);
        assert.ok(!out.includes('\n'));
    });
});

describe('preview report: text', () => {
    test('the header line', () => {
        assert.equal(lines(input())[0], `payAttention verdicts, ${DAY_FORMAT.format(NOW)} at ${formatClock(NOW)}`);
    });

    test('the three verdict-source lines', () => {
        assert.equal(lines(input())[1], 'Verdicts from: the rules');
        assert.equal(lines(input({ settings: { ...AI_SETTINGS, aiEndpoint: '' } }))[1],
            'Verdicts from: the rules (AI mode is on, but its address or model cannot be used)');
        assert.equal(lines(input({ settings: AI_SETTINGS }))[1], 'Verdicts from: AI, model test-model, on this computer');
        assert.equal(lines(input({ settings: { ...AI_SETTINGS, aiEndpoint: 'http://192.168.1.5:11434/v1' } }))[1],
            'Verdicts from: AI, model test-model, on your local network: invites leave your computer');
        assert.equal(lines(input({ settings: { ...AI_SETTINGS, aiEndpoint: 'https://api.example.test/v1' } }))[1],
            'Verdicts from: AI, model test-model, on the internet: invites leave your computer');
    });

    test('a meeting: time range, verdict, mode and title, then the reason on its own indented line', () => {
        const [j] = judgedOf([ONLINE]);
        const out = lines(input({ judged: [j] }));
        assert.deepEqual(out.slice(2), [
            '',
            DAY_FORMAT.format(T0),
            `  ${formatClock(T0)}–${formatClock(T0 + 30 * MIN)}  MUST  online  Client review`,
            `    ${j.reason}`,
        ]);
    });

    test('a day heading once per local day, and again when the day changes', () => {
        const judged = judgedOf([ONLINE, IN_PERSON, ALL_DAY, TOMORROW]);
        const out = lines(input({ judged }));
        const today = DAY_FORMAT.format(T0);
        const tomorrow = DAY_FORMAT.format(NEXT_DAY);
        assert.notEqual(today, tomorrow);
        assert.equal(out.filter(l => l === today).length, 1);
        assert.equal(out.filter(l => l === tomorrow).length, 1);
        assert.ok(out.indexOf(today) < out.indexOf(tomorrow));
        assert.equal(out[out.indexOf(tomorrow) - 1], '');
    });

    test('all day, in person with travel, and just the start when the end is unknown', () => {
        const judged = judgedOf([IN_PERSON, ALL_DAY], { settings: { ...DEFAULT_SETTINGS, defaultTravelMinutes: 45 } });
        const noEnd = { ...judgedOf([ONLINE])[0], end: null };
        const out = lines(input({ judged: [noEnd, ...judged] }));
        assert.ok(out.includes(`  ${formatClock(T0 + 2 * HOUR)}–${formatClock(T0 + 3 * HOUR)}  ${judged[0].verdict === 'must' ? 'MUST' : 'ignore'}  in person, 45 min travel  Coffee`), out.join('\n'));
        assert.ok(out.some(l => /^ {2}all day {2}ignore {2}\S.* {2}Holiday$/.test(l)), out.join('\n'));
        assert.ok(out.includes(`  ${formatClock(T0)}  MUST  online  Client review`), out.join('\n'));
    });

    test("' (your choice)' only on a verdict override", () => {
        const [j] = judgedOf([ONLINE]);
        const byVerdict = judgedOf([ONLINE], { overrides: { verdict: { [j.key]: 'ignore' }, mode: {} } });
        const byMode = judgedOf([ONLINE], { overrides: { verdict: {}, mode: { [j.key]: 'online' } } });
        assert.ok(previewText(input({ judged: byVerdict })).includes('  ignore (your choice)  online  Client review'));
        assert.ok(!previewText(input({ judged: byMode })).includes('your choice'));
        assert.ok(!previewText(input({ judged: [j] })).includes('your choice'));
    });

    test('(no title) for an empty or blank title', () => {
        const [j] = judgedOf([ONLINE]);
        assert.ok(previewText(input({ judged: [{ ...j, title: '' }] })).endsWith(`online  (no title)\n    ${j.reason}`));
        assert.ok(previewText(input({ judged: [{ ...j, title: ' \u0007 ' }] })).includes('online  (no title)'));
    });

    test('No upcoming meetings.', () => {
        assert.deepEqual(lines(input({ judged: judgedOf([ENDED_NOW]) })).slice(2), ['', 'No upcoming meetings.']);
        assert.deepEqual(lines(input({ judged: [] })).slice(2), ['', 'No upcoming meetings.']);
    });

    test('the footer: only the lines that apply, in order, singular and plural', () => {
        const bad = (uid, name, error) => ({ ...SOURCE, uid, name, ok: false, error });
        const full = previewText(input({
            sources: [SOURCE, bad('b1', 'Broken', 'no backend'), bad('b2', 'Other', null)],
            aiProgress: { pending: 2, byRules: 1 },
        }));
        assert.ok(full.endsWith([
            '',
            'Could not read: Broken (no backend), Other (error)',
            '1 meeting decided by the rules: the AI engine was unavailable.',
            '2 meetings still waiting for the AI engine after 5 minutes: shown with the verdict payAttention gives now.',
        ].join('\n')), full);

        const some = previewText(input({ aiProgress: { pending: 1, byRules: 3 } }));
        assert.ok(some.endsWith([
            '',
            '3 meetings decided by the rules: the AI engine was unavailable.',
            '1 meeting still waiting for the AI engine after 5 minutes: shown with the verdict payAttention gives now.',
        ].join('\n')), some);
        assert.ok(!some.includes('Could not read'));

        const none = previewText(input());
        assert.ok(!/Could not read|decided by the rules|still waiting/.test(none));
        assert.ok(none.endsWith(judgedOf([ONLINE])[0].reason), 'no footer, no blank line after the last meeting');
    });

    test('no trailing newline', () => {
        for (const inp of [input(), input({ judged: [] }), input({ aiProgress: { pending: 1, byRules: 0 } })]) {
            assert.ok(!previewText(inp).endsWith('\n'));
            assert.equal(formatPreview(inp, 'text'), previewText(inp));
            assert.ok(!formatPreview(inp, 'json').endsWith('\n'));
        }
    });
});
