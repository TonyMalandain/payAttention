// Video-call links (PRD §2): https only, allowlisted hosts only (constraints.md).
// Parsed by hand because gjs has no global URL.

/** The conferencing services whose links count as a join link. Frozen. */
export const CONFERENCING_HOSTS = Object.freeze([
    { host: 'meet.google.com' },
    { host: 'zoom.us' },
    { host: 'zoomgov.com' },
    { host: 'teams.microsoft.com' },
    { host: 'teams.live.com' },
    { host: 'webex.com' },
    { host: 'whereby.com' },
    { host: 'meet.jit.si' },
    { host: '8x8.vc' },
    { host: 'meet.goto.com' },
    { host: 'gotomeeting.com' },
    { host: 'gotomeet.me' },
    { host: 'app.slack.com', pathPrefix: '/huddle/' },
].map(e => Object.freeze(e)));

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`()[\]{}]+/gi;

/**
 * Every http(s) link in a text, in text order, without trailing punctuation
 * and with `&amp;` unescaped.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractUrls(text) {
    return (text.match(URL_IN_TEXT) ?? [])
        .map(url => url.replace(/[.,;:!?]+$/, '').replaceAll('&amp;', '&'));
}

/**
 * Split an https link into host and path. Refuses anything that is not https,
 * has a user-info part, or has a host with unexpected characters.
 *
 * @param {string} url
 * @returns {{host:string, path:string}|null}
 */
export function parseHttpsUrl(url) {
    const m = /^https:\/\/([^/?#]*)(.*)$/i.exec(url);
    if (!m)
        return null;
    const [, authority, rest] = m;
    if (authority.includes('@'))
        return null;
    const host = authority.replace(/:\d+$/, '').toLowerCase().replace(/\.$/, '');
    if (!/^[a-z0-9.-]+$/.test(host))
        return null;
    const path = rest.split(/[?#]/)[0];
    return { host, path: path.startsWith('/') ? path : '/' };
}

/**
 * Whether a link is an https link to an allowlisted conferencing service, so it
 * is safe to open as "Join".
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isConferenceUrl(url) {
    const parsed = parseHttpsUrl(url);
    if (!parsed)
        return false;
    const { host, path } = parsed;
    return CONFERENCING_HOSTS.some(e =>
        (host === e.host || host.endsWith('.' + e.host)) &&
        (e.pathPrefix === undefined || path.startsWith(e.pathPrefix)));
}
