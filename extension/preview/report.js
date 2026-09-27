// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The preview's presenter (interfaces.md §7.3): the judged list as a text report
// for a terminal, or as the version-1 JSON object for scripts. Every string that
// comes from a calendar or the engine is cleaned before it is printed, in both
// formats. Gi-free, so Node tests it.
import { cleanText } from '../core/aiProtocol.js';
import { aiEngine } from '../core/aiEngine.js';
import { formatClock } from '../core/display.js';
import { meetingCount, unreadableCalendarText } from './cli.js';

// Built once, as core/display.js does: the options are static, the zone is the process's.
const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

const WHERE = Object.freeze({
    loopback: 'on this computer',
    private: 'on your local network: invites leave your computer',
    public: 'on the internet: invites leave your computer',
});

/**
 * @typedef {Readonly<{now: number,
 *   settings: import('../core/types.js').Settings,
 *   judged: ReadonlyArray<import('../core/types.js').JudgedOccurrence>,
 *   sources: ReadonlyArray<import('../core/types.js').SourceInfo>,
 *   aiStatus: 'off'|'ok'|'unavailable',
 *   aiProgress: Readonly<{pending: number, byRules: number}>}>} PreviewInput
 */

/**
 * The meetings both formats list: judge order, not yet ended. An unknown end is
 * kept, because a hidden meeting is the worse failure.
 */
function upcoming(judged, now) {
    return judged.filter(j => j.end === null || j.end > now);
}

/**
 * @param {PreviewInput} input
 * @returns {object} the §7.3 version-1 object
 */
export function previewJson(input) {
    const { now, settings, judged, sources, aiStatus } = input;
    return {
        v: 1,
        generatedAt: now,
        verdictSource: aiEngine(settings) !== null ? 'ai' : 'rules',
        aiStatus,
        calendars: sources.map(s => ({ name: cleanText(s.name), ok: s.ok, error: s.error === null ? null : cleanText(s.error) })),
        // key and seriesKey are identifiers that must match the stored override keys: never cleaned.
        meetings: upcoming(judged, now).map(j => ({
            key: j.key,
            seriesKey: j.seriesKey,
            start: j.start,
            end: j.end,
            title: cleanText(j.title),
            verdict: j.verdict,
            reasonCode: j.reasonCode,
            reason: cleanText(j.reason),
            mode: j.mode,
            overridden: j.verdictOverridden,
            travelMinutes: j.travelMinutes,
        })),
    };
}

function sourceLine(settings) {
    const engine = aiEngine(settings);
    if (engine !== null)
        return `Verdicts from: AI, model ${cleanText(engine.model)}, ${WHERE[engine.endpointClass]}`;
    if (settings.verdictSource === 'ai')
        return 'Verdicts from: the rules (AI mode is on, but its address or model cannot be used)';
    return 'Verdicts from: the rules';
}

function timeText(j) {
    if (j.allDay)
        return 'all day';
    if (j.end === null)
        return formatClock(j.start);
    return `${formatClock(j.start)}–${formatClock(j.end)}`;
}

/** '' for an all-day meeting: its row shows no online or in-person label (product, 2026-09-27). */
function modeText(j) {
    if (j.allDay)
        return '';
    return j.mode === 'online' ? 'online' : `in person, ${j.travelMinutes} min travel`;
}

function footerLines({ sources, aiProgress }) {
    const out = sources.filter(s => s.ok === false).map(s => unreadableCalendarText(s.name, s.error));
    if (aiProgress.byRules > 0)
        out.push(`${meetingCount(aiProgress.byRules)} decided by the rules: the AI engine was unavailable.`);
    if (aiProgress.pending > 0)
        out.push(`${meetingCount(aiProgress.pending)} still waiting for the AI engine after 5 minutes: shown with the verdict payAttention gives now.`);
    return out;
}

/**
 * @param {PreviewInput} input
 * @returns {string} the text report, no trailing newline
 */
export function previewText(input) {
    const { now, settings, judged } = input;
    const out = [`payAttention verdicts, ${DAY.format(now)} at ${formatClock(now)}`, sourceLine(settings)];
    const list = upcoming(judged, now);
    if (list.length === 0)
        out.push('', 'No upcoming meetings.');
    let previousDay = null;
    for (const j of list) {
        const day = DAY.format(j.start ?? now);
        if (day !== previousDay)
            out.push('', day);
        previousDay = day;
        const verdict = (j.verdict === 'must' ? 'MUST' : 'ignore') + (j.verdictOverridden ? ' (your choice)' : '');
        const title = cleanText(j.title) || '(no title)';
        out.push(`  ${[timeText(j), verdict, modeText(j), title].filter(Boolean).join('  ')}`, `    ${cleanText(j.reason)}`);
    }
    const footer = footerLines(input);
    if (footer.length > 0)
        out.push('', ...footer);
    return out.join('\n');
}

/**
 * JSON text that stays valid whatever the terminal's charset: every code unit
 * above U+007E becomes a \uXXXX escape. gjs print() converts to the locale's
 * charset, so raw UTF-8 could be corrupted.
 */
function asciiJson(value) {
    return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * @param {PreviewInput} input
 * @param {'text'|'json'} format
 * @returns {string} 'json': JSON.stringify(previewJson(input)), ASCII-only; 'text': previewText(input)
 */
export function formatPreview(input, format) {
    return format === 'json' ? asciiJson(previewJson(input)) : previewText(input);
}
