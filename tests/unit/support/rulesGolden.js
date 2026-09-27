// The rules-mode golden cases (PG-4a Step 1). Not a test file. The golden JSON in
// tests/fixtures/judged-rules-golden.json was generated once from these cases on
// the code before AI mode existed; judge.rulesMode.test.js proves it still holds.
import { T0, MIN, OWNER, SOURCE, att, event, snapshot } from './builders.js';

const FAMILY = { uid: 'src-2', name: 'Family', backend: 'local', ownerEmail: OWNER, ok: true, error: null };

const guests = (n, domain = 'acme.test') => Array.from({ length: n }, (_, i) => att(`g${i + 1}@${domain}`));

/** One event per rule path, each with its own uid and a start 30 minutes after the previous. */
function ownerKnownEvents() {
    const at = i => ({ start: T0 + i * 30 * MIN, end: T0 + i * 30 * MIN + 30 * MIN });
    return [
        event({ uid: 'small', ...at(0) }),
        event({ uid: 'cancelled', status: 'cancelled', ...at(1) }),
        event({ uid: 'declined', attendees: [att(OWNER, 'declined'), att('alice@acme.test'), att('bob@acme.test')], ...at(2) }),
        event({ uid: 'not-invited', attendees: [att('alice@acme.test'), att('bob@acme.test')], ...at(3) }),
        event({ uid: 'all-day', allDay: true, start: T0, end: T0 + 24 * 60 * MIN }),
        event({ uid: 'all-day-not-invited', allDay: true, start: T0, end: T0 + 24 * 60 * MIN,
            attendees: [att('alice@acme.test'), att('bob@acme.test')] }),
        event({ uid: 'free', transparency: 'transparent', ...at(4) }),
        event({ uid: 'ignore-word', summary: 'Lunch', ...at(5) }),
        event({ uid: 'important-word', summary: 'Client review', ...at(6) }),
        event({ uid: 'organizer', organizer: { email: OWNER, name: 'me' }, ...at(7) }),
        event({ uid: 'external', attendees: [att(OWNER), att('alice@acme.test'), att('carol@partner.test')], ...at(8) }),
        event({ uid: 'no-guests', organizer: null, attendees: [att(OWNER)], ...at(9) }),
        event({ uid: 'large', attendees: [att(OWNER), ...guests(16)], ...at(10) }),
        event({ uid: 'maybe', attendees: [att(OWNER, 'tentative'), att('alice@acme.test'), att('bob@acme.test')], ...at(11) }),
        event({ uid: 'override-must', summary: 'Lunch', ...at(12) }),
        event({ uid: 'override-ignore', recurring: true, recurrenceId: T0 + 13 * 30 * MIN, ...at(13) }),
        event({ uid: 'mode-override', description: 'Join https://meet.google.com/abc-defg-hij', ...at(14) }),
        event({ uid: 'travel-stored', location: '1 Main St', ...at(15) }),
        event({ uid: 'travel-default', location: '22 Elm Road', ...at(16) }),
        event({ uid: 'online-zoom', description: 'Join https://us02web.zoom.us/j/81234?pwd=abc', ...at(17) }),
        event({ uid: 'duplicate', sourceUid: 'src-1',
            attendees: [att(OWNER, 'declined'), att('alice@acme.test'), att('bob@acme.test')], ...at(18) }),
        event({ uid: 'duplicate', sourceUid: 'src-2', ...at(18) }),
    ];
}

/**
 * The rules-mode cases, built fresh on each call.
 *
 * @returns {{name:string, snapshot:object, overrides:object, travel:object}[]}
 */
export function rulesModeCases() {
    return [
        {
            name: 'ownerKnown',
            snapshot: snapshot(ownerKnownEvents(), [SOURCE, FAMILY]),
            overrides: {
                verdict: {
                    [`occ:override-must|${T0 + 12 * 30 * MIN}`]: 'must',
                    'series:override-ignore': 'ignore',
                },
                mode: { [`occ:mode-override|${T0 + 14 * 30 * MIN}`]: 'in-person' },
            },
            travel: { '1 main st': 15 },
        },
        {
            name: 'ownerUnknown',
            snapshot: snapshot([event({ uid: 'small' })], [{ ...SOURCE, ownerEmail: null }]),
            overrides: { verdict: {}, mode: {} },
            travel: {},
        },
    ];
}
