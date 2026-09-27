// The verdict rules of PRD §1 steps 2 to 6, in order. Internal to core.
import { findWord } from './words.js';

/** Every reason code a JudgedOccurrence can carry. Frozen. */
export const REASON_CODES = Object.freeze(['override-must', 'override-ignore', 'cancelled', 'declined', 'not-invited',
    'all-day', 'free', 'ignore-word', 'important-word', 'organizer', 'external', 'no-guests', 'large', 'small',
    'maybe', 'insufficient-data', 'test', 'ai-must', 'ai-ignore']);

const plural = n => (n === 1 ? '1 guest' : `${n} guests`);

const result = (verdict, reasonCode, reason) => ({ verdict, reasonCode, reason });

function hasExternalGuest(guests, ownerDomains) {
    return guests.some(email => {
        const domain = email.slice(email.lastIndexOf('@') + 1);
        return email.includes('@') && domain !== '' && !ownerDomains.has(domain);
    });
}

/**
 * The verdict from the rules, when the owner has not overridden it. The first
 * matching rule wins.
 *
 * @param {import('./types.js').OccurrenceDTO} event
 * @param {{role:string, partstat:string|null, guests:string[]}} facts from ownerFacts()
 * @param {{ignore:import('./types.js').WordMatcher, important:import('./types.js').WordMatcher,
 *          ownerDomains:Set<string>, largeMeetingSize:number}} ctx
 * @returns {{verdict:'must'|'ignore', reasonCode:import('./types.js').ReasonCode, reason:string}}
 */
export function ruleVerdict(event, facts, ctx) {
    const n = facts.guests.length;
    const answeredYesOrNot = facts.partstat === 'accepted' || facts.partstat === 'unanswered';

    // 2. Ignorable, and certain.
    if (event.status === 'cancelled')
        return result('ignore', 'cancelled', 'cancelled');
    if (facts.partstat === 'declined')
        return result('ignore', 'declined', 'you declined');
    if (facts.role === 'not-listed' && n >= 1)
        return result('ignore', 'not-invited', "not invited: someone else's meeting");
    if (event.allDay || !Number.isFinite(event.start))
        return result('ignore', 'all-day', 'all-day event');
    if (event.transparency === 'transparent')
        return result('ignore', 'free', 'marked as free time');
    const ignoreWord = findWord(ctx.ignore, event.summary);
    if (ignoreWord !== null)
        return result('ignore', 'ignore-word', `placeholder: '${ignoreWord}'`);

    // 3. Must-attend, and strong.
    const importantWord = findWord(ctx.important, event.summary);
    if (importantWord !== null)
        return result('must', 'important-word', `important: '${importantWord}'`);
    if (facts.role === 'organizer' && n >= 1)
        return result('must', 'organizer', `you organised it, ${plural(n)}`);
    if (ctx.ownerDomains.size > 0 && hasExternalGuest(facts.guests, ctx.ownerDomains) && answeredYesOrNot)
        return result('must', 'external', 'external guests');

    // 4. Ignorable, and weaker.
    if (n === 0)
        return result('ignore', 'no-guests', 'no other guests: personal block');
    if (n > ctx.largeMeetingSize && facts.role === 'attendee')
        return result('ignore', 'large', `large meeting (${plural(n)}): absence unlikely noticed`);

    // 5. Default: 1 to largeMeetingSize guests (D-012: a 1:1 counts).
    if (n >= 1 && n <= ctx.largeMeetingSize) {
        if (answeredYesOrNot)
            return result('must', 'small', `small meeting (${plural(n)}): absence noticed`);
        if (facts.partstat === 'tentative')
            return result('ignore', 'maybe', 'you answered maybe');
    }

    // 6. When unsure, warn.
    return result('must', 'insufficient-data', 'not enough information: treated as must-attend');
}

/**
 * The verdict when the owner overrode it.
 *
 * @param {'must'|'ignore'} value
 * @returns {{verdict:'must'|'ignore', reasonCode:import('./types.js').ReasonCode, reason:string}}
 */
export function overrideVerdict(value) {
    return value === 'must'
        ? result('must', 'override-must', 'you marked this must-attend')
        : result('ignore', 'override-ignore', 'you marked this ignore');
}

/**
 * The verdict when a stored AI answer applies.
 *
 * @param {'must'|'ignore'} value
 * @param {string} reason already normalised (normaliseReason)
 * @returns {{verdict:'must'|'ignore', reasonCode:'ai-must'|'ai-ignore', reason:string}} reason is 'AI: ' + reason
 */
export function aiVerdict(value, reason) {
    return result(value, value === 'must' ? 'ai-must' : 'ai-ignore', 'AI: ' + reason);
}
