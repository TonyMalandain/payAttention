// The display model: plans, judged meetings and calendar health turned into
// exactly what the UI draws. Pure. Every choice of what to show is made here,
// so the UI decides nothing.
import {
    oneLine, formatShort, formatCountdown, formatRelative, formatClock, formatSince,
    calendarLabel, stepHeadline, countdownCaption,
} from '../core/display.js';

/** Travel times the owner can pick, in minutes (PRD §4). */
export const TRAVEL_CHOICES_MIN = Object.freeze([10, 15, 20, 30, 45, 60, 90]);

const MAX_NAMED_CALENDARS = 3;

/** @typedef {import('../core/types.js').Plan} Plan */
/** @typedef {import('../core/types.js').JudgedOccurrence} JudgedOccurrence */
/** @typedef {import('./health.js').Health} Health */
/**
 * @typedef {{key: string, label: string, detail: string, reason: string, isMust: boolean, overridden: boolean,
 *   recurring: boolean, mode: 'online'|'in-person', otherMode: 'online'|'in-person', modeSwitchLabel: string,
 *   travel: null|{placeKey: string|null, minutes: number, header: string, choices: number[]}}} MeetingRow
 */
/**
 * @typedef {{key: string, isTest: boolean, step: 1|2|3|4, presentation: 'card'|'takeover',
 *   headline: string, title: string, timeLine: string, countdown: string, countdownCaption: string, reason: string,
 *   travel: null|{placeKey: string|null, minutes: number, text: string, choices: number[]},
 *   also: string[], canJoin: boolean, offerSeries: boolean}} AlertView
 */
/**
 * @typedef {{indicator: {text: string|null, highlighted: boolean, flashing: boolean, warning: boolean},
 *   menu: {status: string|null, meetings: MeetingRow[], signature: string},
 *   alert: AlertView|null}} View
 */

// A meeting switched to in person with no place has nowhere to store a travel time.
const travelChoices = j => (j.placeKey !== null ? TRAVEL_CHOICES_MIN : []);
const defaultMark = j => (j.travelIsDefault ? ' (default)' : '');

function buildAlert(chosenPlan, j, isTest, judgedByKey, now) {
    const c = chosenPlan.primary;
    const toDeadline = c.deadline - now;
    const timeLine = j.mode === 'online'
        ? `Starts at ${formatClock(j.start)} · ${formatRelative(j.start - now)}`
        : `Leave by ${formatClock(c.deadline)} · ${formatRelative(toDeadline)}`;
    const travel = j.mode === 'in-person' && c.step <= 2
        ? {
            placeKey: j.placeKey,
            minutes: j.travelMinutes,
            text: `Travel: ${j.travelMinutes} min${defaultMark(j)}`,
            choices: travelChoices(j),
        }
        : null;
    const also = chosenPlan.also.map(({ key }) => {
        const other = judgedByKey.get(key);
        return `also: ${oneLine(other.title, 60)} at ${formatClock(other.start)}`;
    });
    return {
        key: c.key,
        isTest,
        step: c.step,
        presentation: chosenPlan.takeover ? 'takeover' : 'card',
        headline: stepHeadline(c.step, j.mode),
        title: oneLine(j.title, 120),
        timeLine,
        countdown: formatCountdown(toDeadline),
        countdownCaption: countdownCaption(j.mode, toDeadline),
        reason: `Why: ${j.reason}`,
        travel,
        also,
        canJoin: j.joinUrl !== null,
        offerSeries: j.recurring && !isTest,
    };
}

function chooseAlert({ plan, testPlan, testJudged, judgedByKey, now }) {
    if (testPlan?.primary?.visible)
        return buildAlert(testPlan, testJudged, true, judgedByKey, now);
    if (plan.primary?.visible)
        return buildAlert(plan, judgedByKey.get(plan.primary.key), false, judgedByKey, now);
    return null;
}

function buildRow(j) {
    const otherMode = j.mode === 'online' ? 'in-person' : 'online';
    const verdictText = j.verdict === 'must' ? 'Must attend' : 'Ignorable';
    const modeText = j.mode === 'online' ? 'online' : 'in person';
    return {
        key: j.key,
        label: `${j.allDay ? 'All day' : formatClock(j.start)}  ${oneLine(j.title, 40)}`,
        detail: `${verdictText} · ${modeText}${j.verdictOverridden ? ' · overridden' : ''}`,
        reason: `Why: ${j.reason}`,
        isMust: j.verdict === 'must',
        overridden: j.verdictOverridden,
        recurring: j.recurring,
        mode: j.mode,
        otherMode,
        modeSwitchLabel: otherMode === 'online' ? 'Switch to online' : 'Switch to in person',
        travel: j.mode === 'in-person'
            ? {
                placeKey: j.placeKey,
                minutes: j.travelMinutes,
                header: `Travel time: ${j.travelMinutes} min${defaultMark(j)}`,
                choices: travelChoices(j),
            }
            : null,
    };
}

function todaysRows(judged, now) {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const nextMidnight = midnight.getTime();
    return judged
        .filter(j => j.start !== null && j.end !== null && j.end > now && j.start < nextMidnight)
        .map(buildRow);
}

// D-010: never "no meetings" while stale. D-014: name the calendars.
function statusLine(health, rowCount, now) {
    if (health.state === 'waiting')
        return 'Reading calendars…';
    if (health.state === 'stale') {
        const since = formatSince(health.since, now);
        const names = health.calendars;
        if (names.length === 0)
            return `Calendar not updating since ${since}. Alerts may be missing.`;
        if (names.length === 1)
            return `${calendarLabel(names[0])} not updating since ${since}. Alerts may be missing.`;
        let list = names.slice(0, MAX_NAMED_CALENDARS).map(n => oneLine(n, 30)).join(', ');
        if (names.length > MAX_NAMED_CALENDARS)
            list += `, and ${names.length - MAX_NAMED_CALENDARS} more`;
        return `Calendars not updating since ${since}: ${list}. Alerts may be missing.`;
    }
    return rowCount === 0 ? 'No more meetings today' : null;
}

function signatureOf(rows) {
    return rows
        .map(r => [r.key, r.label, r.detail, r.reason, r.overridden, r.recurring, r.mode, r.travel?.minutes ?? ''].join('|'))
        .join('\n');
}

/**
 * The display model the UI draws.
 *
 * @param {object} p
 * @param {Plan} p.plan real meetings
 * @param {Plan|null} p.testPlan running test alert, or null
 * @param {JudgedOccurrence|null} p.testJudged the test alert's occurrence, or null
 * @param {ReadonlyArray<JudgedOccurrence>} p.judged real, in judge order
 * @param {ReadonlyMap<string, JudgedOccurrence>} p.judgedByKey real, by key
 * @param {Health} p.health
 * @param {number} p.now
 * @returns {View}
 */
export function buildView(p) {
    const { plan, testPlan, judged, judgedByKey, health, now } = p;
    const alert = chooseAlert(p);

    const target = plan.indicator;
    const text = target
        ? `${oneLine(judgedByKey.get(target.key).title, 24)} · ${formatShort(target.msToDeadline)}`
        : null;

    const meetings = todaysRows(judged, now);
    return {
        indicator: {
            text,
            highlighted: plan.primary !== null || (testPlan?.primary ?? null) !== null,
            flashing: alert?.step === 3 && alert.presentation === 'card',
            warning: health.state === 'stale',
        },
        menu: {
            status: statusLine(health, meetings.length, now),
            meetings,
            signature: signatureOf(meetings),
        },
        alert,
    };
}
