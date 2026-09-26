// Who the owner is, and where they stand in one meeting. Internal to core.

function normaliseAddress(address) {
    return address.trim().toLowerCase().replace(/^mailto:/, '');
}

function domainOf(address) {
    return address.slice(address.lastIndexOf('@') + 1);
}

// Guests are people: rooms and resources never count (D-011).
const PERSON_CUTYPES = ['individual', 'unknown', 'group'];

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
