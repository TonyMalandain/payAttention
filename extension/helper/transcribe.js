// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Turns one expanded instance (ICal/ECal objects) into one OccurrenceDTO
// (core/types.js). No I/O. The helper transcribes; it never judges.
import ECal from 'gi://ECal?version=2.0';
import ICalGLib from 'gi://ICalGLib?version=3.0';
import { normaliseAddress, truncateDescription } from './text.js';

/**
 * An ICal time as epoch ms UTC. Never as_timet(): it ignores the zone.
 *
 * @param {ICalGLib.Time} time
 * @param {ICalGLib.Timezone} localZone used for DATE values and floating times
 * @returns {number}
 */
export function toEpochMs(time, localZone) {
    let zone;
    if (time.is_date())
        zone = localZone;
    else if (time.is_utc())
        zone = ICalGLib.Timezone.get_utc_timezone();
    else
        zone = time.get_timezone() ?? localZone;
    return time.as_timet_with_zone(zone) * 1000;
}

function partstat(value) {
    switch (value) {
    case ICalGLib.ParameterPartstat.NEEDSACTION:
    case ICalGLib.ParameterPartstat.NONE:
        return 'needs-action';
    case ICalGLib.ParameterPartstat.ACCEPTED:
        return 'accepted';
    case ICalGLib.ParameterPartstat.DECLINED:
        return 'declined';
    case ICalGLib.ParameterPartstat.TENTATIVE:
        return 'tentative';
    case ICalGLib.ParameterPartstat.DELEGATED:
        return 'delegated';
    default:
        return 'other';
    }
}

function cutype(value) {
    switch (value) {
    case ICalGLib.ParameterCutype.INDIVIDUAL:
    case ICalGLib.ParameterCutype.NONE:
        return 'individual';
    case ICalGLib.ParameterCutype.GROUP:
        return 'group';
    case ICalGLib.ParameterCutype.RESOURCE:
        return 'resource';
    case ICalGLib.ParameterCutype.ROOM:
        return 'room';
    default:
        return 'unknown';
    }
}

function role(value) {
    switch (value) {
    case ICalGLib.ParameterRole.CHAIR:
        return 'chair';
    case ICalGLib.ParameterRole.REQPARTICIPANT:
    case ICalGLib.ParameterRole.NONE:
        return 'req-participant';
    case ICalGLib.ParameterRole.OPTPARTICIPANT:
        return 'opt-participant';
    case ICalGLib.ParameterRole.NONPARTICIPANT:
        return 'non-participant';
    default:
        return 'other';
    }
}

function status(value) {
    switch (value) {
    case ICalGLib.PropertyStatus.CONFIRMED:
        return 'confirmed';
    case ICalGLib.PropertyStatus.TENTATIVE:
        return 'tentative';
    case ICalGLib.PropertyStatus.CANCELLED:
        return 'cancelled';
    default:
        return 'none';
    }
}

function transparency(value) {
    switch (value) {
    case ECal.ComponentTransparency.OPAQUE:
        return 'opaque';
    case ECal.ComponentTransparency.TRANSPARENT:
        return 'transparent';
    default:
        return 'unknown';
    }
}

const LINK_PROPERTIES = ['X-GOOGLE-CONFERENCE', 'CONFERENCE', 'URL'];

/**
 * Link values, grouped in LINK_PROPERTIES order, each group in file order;
 * trimmed, empty and duplicate values dropped. Properties are identified by
 * name only: isa() throws on CONFERENCE (plan PG-1b, fact 9).
 */
function conferenceUris(icalComponent) {
    const groups = LINK_PROPERTIES.map(() => []);
    const any = ICalGLib.PropertyKind.ANY_PROPERTY;
    for (let p = icalComponent.get_first_property(any); p; p = icalComponent.get_next_property(any)) {
        const group = LINK_PROPERTIES.indexOf((p.get_property_name() ?? '').toUpperCase());
        if (group !== -1)
            groups[group].push((p.get_value_as_string() ?? '').trim());
    }
    return [...new Set(groups.flat().filter(v => v !== ''))];
}

/**
 * One instance from generate_instances_sync as an OccurrenceDTO. Does not keep
 * a reference to icalComponent.
 *
 * @param {string} sourceUid
 * @param {ICalGLib.Component} icalComponent
 * @param {ICalGLib.Time} instanceStart
 * @param {ICalGLib.Time} instanceEnd
 * @param {ICalGLib.Timezone} localZone
 * @returns {object} OccurrenceDTO
 */
export function transcribeInstance(sourceUid, icalComponent, instanceStart, instanceEnd, localZone) {
    // new_from_icalcomponent takes ownership, so it gets a clone.
    const comp = ECal.Component.new_from_icalcomponent(icalComponent.clone());
    const rid = icalComponent.get_recurrenceid();
    const recurrenceId = !rid || rid.is_null_time() ? null : toEpochMs(rid, localZone);
    const org = comp.get_organizer();
    return {
        sourceUid,
        uid: comp.get_uid() ?? '',
        recurrenceId,
        recurring: recurrenceId !== null,
        start: toEpochMs(instanceStart, localZone),
        end: toEpochMs(instanceEnd, localZone),
        allDay: instanceStart.is_date(),
        summary: comp.get_summary()?.get_value() ?? '',
        location: comp.get_location() ?? '',
        description: truncateDescription(comp.get_descriptions().map(t => t.get_value() ?? '').join('\n')),
        conferenceUris: conferenceUris(icalComponent),
        status: status(comp.get_status()),
        transparency: transparency(comp.get_transparency()),
        organizer: org ? { email: normaliseAddress(ECal.util_get_organizer_email(org)), name: org.get_cn() ?? '' } : null,
        attendees: comp.get_attendees().map(a => ({
            email: normaliseAddress(ECal.util_get_attendee_email(a)),
            name: a.get_cn() ?? '',
            partstat: partstat(a.get_partstat()),
            cutype: cutype(a.get_cutype()),
            role: role(a.get_role()),
        })),
    };
}
