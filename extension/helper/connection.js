// Turns a source's remoteness, its client's online flag and its EDS
// connection-status name into the protocol `connection` value (D-013,
// interfaces.md addendum). Pure; the GI side passes the enum key name so the
// mapping never depends on EDS's numeric values.

/**
 * The protocol `connection` value for one source: null unless remote is true;
 * 'offline' when the client is not online; otherwise the EDS status name
 * mapped, 'unknown' for any other name or null.
 *
 * @param {{remote:boolean|null, online:boolean, statusName:string|null}} state
 * @returns {string|null}
 */
export function sourceConnection({ remote, online, statusName }) {
    if (remote !== true)
        return null;
    if (online !== true)
        return 'offline';
    switch (statusName) {
    case 'CONNECTED':
        return 'connected';
    case 'CONNECTING':
        return 'connecting';
    case 'DISCONNECTED':
        return 'disconnected';
    case 'AWAITING_CREDENTIALS':
        return 'awaiting-credentials';
    case 'SSL_FAILED':
        return 'ssl-failed';
    default:
        return 'unknown';
    }
}
