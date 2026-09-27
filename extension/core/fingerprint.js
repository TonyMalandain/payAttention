// The identity of one question: prompt version, engine and invite (interfaces.md §6.2).
import { PROMPT_VERSION } from './aiPrompt.js';

/**
 * cyrb53 (public domain), seed 0, over the UTF-16 code units. Not a security
 * hash: it only tells one question from another.
 *
 * @param {string} text
 * @returns {string} 14 lowercase hex digits
 */
export function hash53(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * The fingerprint of asking this engine about this invite. A JSON array, not a
 * concatenation, so the parts cannot run into each other.
 *
 * @param {string} engineTag from aiEngine()
 * @param {import('./types.js').Invite} invite from buildInvite(), whose key order is fixed
 * @returns {string} hash53(JSON.stringify([PROMPT_VERSION, engineTag, invite]))
 */
export function fingerprint(engineTag, invite) {
    return hash53(JSON.stringify([PROMPT_VERSION, engineTag, invite]));
}
