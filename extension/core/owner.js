// Who the owner is, and where they stand in one meeting. Internal to core.

/** An address as core compares it: trimmed, lower case, without "mailto:". */
export function normaliseAddress(address) {
    return address.trim().toLowerCase().replace(/^mailto:/, '');
}

function domainOf(address) {
    return address.slice(address.lastIndexOf('@') + 1);
}

/** People who count as guests: rooms and resources never do (D-011). Frozen. */
export const PERSON_CUTYPES = Object.freeze(['individual', 'unknown', 'group']);

// Best first. Anything else maps to 'unanswered'.
const PARTSTAT_PRECEDENCE = ['accepted', 'tentative', 'needs-action', 'delegated', 'other', 'declined'];
const PARTSTAT_FACT = { accepted: 'accepted', tentative: 'tentative', declined: 'declined' };

/**
 * The owner's addresses and domains, for one judge() call.
 *
 * @param {import('./types.js').Snapshot} snapshot owner addresses come from every source
 * @param {import('./types.js').JudgeConfig} config
 * @returns {{addresses:Set<string>, domains:Set<string>}}
 */
export function ownerIdentity(snapshot, config) {
    const addresses = new Set();
    const candidates = [
        ...snapshot.sources.map(s => s.ownerEmail).filter(e => e !== null),
        ...config.extraOwnerAddresses,
    ];
    for (const raw of candidates) {
        const address = normaliseAddress(raw);
        if (address !== '')
            addresses.add(address);
    }

    let domains;
    if (config.ownerDomains.length > 0) {
        domains = config.ownerDomains
            .map(d => d.trim().toLowerCase().replace(/^@/, ''))
            .filter(d => d !== '');
    } else {
        domains = [...addresses].map(domainOf);
    }
    return { addresses, domains: new Set(domains) };
}

function partstatRank(p) {
    const i = PARTSTAT_PRECEDENCE.indexOf(p);
    return i === -1 ? PARTSTAT_PRECEDENCE.length : i;
}

/**
 * The owner's own answer, the best by PARTSTAT_PRECEDENCE among their attendee entries.
 *
 * @param {import('./types.js').OccurrenceDTO} event
 * @param {{addresses:Set<string>, domains:Set<string>}} identity
 * @returns {import('./types.js').PartStat|'unknown'} 'unknown' when the owner has no attendee entry
 */
export function ownerResponse(event, identity) {
    const own = event.attendees
        .filter(a => identity.addresses.has(normaliseAddress(a.email)))
        .map(a => a.partstat);
    return own.length === 0 ? 'unknown' : own.toSorted((a, b) => partstatRank(a) - partstatRank(b))[0];
}

/**
 * Attendees who are guests: CUTYPE in PERSON_CUTYPES, not the owner, first
 * occurrence of each non-empty normalised address, in DTO order. The organiser
 * is not added (interfaces §6.2).
 *
 * @param {import('./types.js').OccurrenceDTO} event
 * @param {{addresses:Set<string>, domains:Set<string>}} identity
 * @returns {import('./types.js').Attendee[]} the DTO records, not copies
 */
export function guestAttendees(event, identity) {
    const seen = new Set();
    const guests = [];
    for (const a of event.attendees) {
        if (!PERSON_CUTYPES.includes(a.cutype))
            continue;
        const email = normaliseAddress(a.email);
        if (identity.addresses.has(email) || (email !== '' && seen.has(email)))
            continue;
        seen.add(email);
        guests.push(a);
    }
    return guests;
}

/**
 * The owner's role and answer in one meeting, and its guests (people other
 * than the owner).
 *
 * @param {import('./types.js').OccurrenceDTO} event
 * @param {{addresses:Set<string>, domains:Set<string>}} identity
 * @returns {{role:'organizer'|'attendee'|'not-listed'|'unknown',
 *            partstat:'accepted'|'declined'|'tentative'|'unanswered'|null,
 *            guests:string[]}}
 */
export function ownerFacts(event, identity) {
    const { addresses } = identity;
    const isOwner = email => addresses.has(normaliseAddress(email));

    const people = event.attendees
        .filter(a => PERSON_CUTYPES.includes(a.cutype))
        .map(a => normaliseAddress(a.email));
    if (event.organizer)
        people.push(normaliseAddress(event.organizer.email));
    const seen = new Set();
    const guests = [];
    for (const email of people) {
        if (email !== '' && seen.has(email))
            continue;
        seen.add(email);
        if (!addresses.has(email))
            guests.push(email);
    }

    const ownerEntries = event.attendees.filter(a => isOwner(a.email));
    let role;
    if (addresses.size === 0)
        role = 'unknown';
    else if (event.organizer && isOwner(event.organizer.email))
        role = 'organizer';
    else if (ownerEntries.length > 0)
        role = 'attendee';
    else
        role = 'not-listed';

    let partstat = null;
    if (ownerEntries.length > 0) {
        const rank = p => {
            const i = PARTSTAT_PRECEDENCE.indexOf(p);
            return i === -1 ? PARTSTAT_PRECEDENCE.length : i;
        };
        const best = ownerEntries.map(a => a.partstat).toSorted((a, b) => rank(a) - rank(b))[0];
        partstat = PARTSTAT_FACT[best] ?? 'unanswered';
    } else if (role === 'organizer') {
        partstat = 'accepted';
    }
    return { role, partstat, guests };
}
