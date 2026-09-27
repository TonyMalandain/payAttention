// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Whether the configured AI engine is usable, and how it is addressed: the
// endpoint rules and the AI-mode switch (interfaces.md §6.4, §6.7).
// Parsed by hand because gjs has no global URL. Imports nothing.

/** The request timeout by where the engine is. Frozen. (constraints.md, assumed) */
export const AI_TIMEOUT_MS = Object.freeze({ local: 90000, public: 45000 });

const ENDPOINT = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)$/;
const DEFAULT_PORTS = { http: 80, https: 443 };
const HOST_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const IPV4_OCTET = /^(0|[1-9]\d{0,2})$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;
const PRIVATE_SUFFIXES = ['.local', '.lan', '.internal', '.home.arpa'];
const MAX_MODEL_LENGTH = 200;

/** @returns {number[]|null} the 8 groups of a bracket-less IPv6 literal, or null */
function ipv6Groups(text) {
    const parts = text.split('::');
    if (parts.length > 2)
        return null;
    const split = s => (s === '' ? [] : s.split(':'));
    let groups;
    if (parts.length === 2) {
        const head = split(parts[0]);
        const tail = split(parts[1]);
        if (head.length + tail.length > 7)
            return null;
        groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
    } else {
        groups = split(text);
        if (groups.length !== 8)
            return null;
    }
    if (!groups.every(g => HEX_GROUP.test(g)))
        return null;
    return groups.map(g => parseInt(g, 16));
}

/** @returns {number[]|null} four octets when `host` is exactly a dotted-decimal IPv4 literal (no leading zeros) */
function ipv4Octets(host) {
    const parts = host.split('.');
    if (parts.length !== 4 || !parts.every(p => IPV4_OCTET.test(p)))
        return null;
    const octets = parts.map(Number);
    return octets.every(o => o <= 255) ? octets : null;
}

/**
 * @returns {{scheme:string, host:string, v6:number[]|null, port:string, path:string}|null}
 *   host is lowercased (with brackets for IPv6); port is '' or ':<n>' with defaults dropped
 */
function parseEndpoint(url) {
    if (typeof url !== 'string')
        return null;
    const m = ENDPOINT.exec(url.trim());
    if (!m)
        return null;
    const scheme = m[1].toLowerCase();
    const [, , authority, rawPath] = m;
    if (!Object.hasOwn(DEFAULT_PORTS, scheme) || authority.includes('@'))
        return null;

    const a = /^(\[[^\]]*\]|[^:[\]]*)(?::([^:]*))?$/.exec(authority);
    if (!a)
        return null;
    let host = a[1].toLowerCase();
    let v6 = null;
    if (host.startsWith('[')) {
        if (!/^\[[0-9a-f:]+\]$/.test(host))
            return null;
        v6 = ipv6Groups(host.slice(1, -1));
        if (v6 === null)
            return null;
    } else {
        if (host.endsWith('.'))
            host = host.slice(0, -1);
        if (!HOST_NAME.test(host))
            return null;
    }

    let port = '';
    if (a[2] !== undefined) {
        if (!/^\d{1,5}$/.test(a[2]))
            return null;
        const n = Number(a[2]);
        if (n < 1 || n > 65535)
            return null;
        if (n !== DEFAULT_PORTS[scheme])
            port = ':' + String(n);
    }

    if (/[\s\\]/.test(rawPath) || /\p{Cc}/u.test(rawPath))
        return null;
    const path = rawPath.replace(/\/+$/, '');
    return { scheme, host, v6, port, path };
}

function classOf({ host, v6 }) {
    if (v6 !== null) {
        if (v6.every((g, i) => g === (i === 7 ? 1 : 0)))
            return 'loopback';
        if ((v6[0] & 0xfe00) === 0xfc00 || (v6[0] & 0xffc0) === 0xfe80)
            return 'private';
        return 'public';
    }
    if (host === 'localhost')
        return 'loopback';
    const ip = ipv4Octets(host);
    if (ip !== null) {
        const [a, b] = ip;
        if (a === 127)
            return 'loopback';
        if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254))
            return 'private';
        return 'public';
    }
    // A dotted all-digit host that is not a literal falls through to 'public': the safe direction.
    if (!host.includes('.') || PRIVATE_SUFFIXES.some(s => host.endsWith(s)))
        return 'private';
    return 'public';
}

/**
 * The endpoint in its one canonical form: lowercase scheme and host, default
 * port dropped, no trailing `/`. Only http and https, no user-info, query or fragment.
 *
 * @param {*} url
 * @returns {string|null} `scheme://host[:port]path`, or null when it is not a usable address
 */
export function normaliseEndpoint(url) {
    const p = parseEndpoint(url);
    return p === null ? null : `${p.scheme}://${p.host}${p.port}${p.path}`;
}

/**
 * Where the engine's host is.
 *
 * @param {*} url
 * @returns {'loopback'|'private'|'public'|null} null when normaliseEndpoint gives null
 */
export function endpointClass(url) {
    const p = parseEndpoint(url);
    return p === null ? null : classOf(p);
}

/**
 * @param {*} url
 * @returns {boolean} https: with any class, or http: with loopback or private
 */
export function isUsableEndpoint(url) {
    const p = parseEndpoint(url);
    if (p === null)
        return false;
    return p.scheme === 'https' || classOf(p) !== 'public';
}

/**
 * Whether an API key may be sent to this endpoint.
 *
 * @param {*} url
 * @returns {boolean} true only for https:, or http: to a loopback host (interfaces §6.7)
 */
export function mayCarryKey(url) {
    const p = parseEndpoint(url);
    if (p === null)
        return false;
    return p.scheme === 'https' || classOf(p) === 'loopback';
}

/**
 * @param {*} url
 * @returns {number|null} AI_TIMEOUT_MS.local for loopback/private, .public for public, null when not usable
 */
export function requestTimeoutMs(url) {
    if (!isUsableEndpoint(url))
        return null;
    return endpointClass(url) === 'public' ? AI_TIMEOUT_MS.public : AI_TIMEOUT_MS.local;
}

/**
 * @param {*} model
 * @returns {string|null} trimmed; null when empty, over 200 characters, or containing a control character
 */
export function normaliseModel(model) {
    if (typeof model !== 'string')
        return null;
    const m = model.trim();
    if (m === '' || Array.from(m).length > MAX_MODEL_LENGTH || /\p{Cc}/u.test(m))
        return null;
    return m;
}

/**
 * The engine AI mode uses, or null when AI mode is off or not set up. The only
 * producer of an engine tag, so every caller agrees on it. Never throws.
 *
 * @param {import('./types.js').Settings} settings
 * @returns {Readonly<{endpoint:string, model:string, engineTag:string, timeoutMs:number,
 *                     endpointClass:'loopback'|'private'|'public'}>|null}
 */
export function aiEngine(settings) {
    if (typeof settings !== 'object' || settings === null || settings.verdictSource !== 'ai')
        return null;
    const model = normaliseModel(settings.aiModel);
    if (model === null || !isUsableEndpoint(settings.aiEndpoint))
        return null;
    const endpoint = normaliseEndpoint(settings.aiEndpoint);
    return Object.freeze({
        endpoint,
        model,
        engineTag: endpoint + '|' + model,
        timeoutMs: requestTimeoutMs(endpoint),
        endpointClass: endpointClass(endpoint),
    });
}
