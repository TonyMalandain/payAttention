// Word lists (PRD §1 steps 2f and 3a, PRD §2) and whole-word matching.

/** Title words that mark a placeholder (PRD §1 step 2), in PRD order. */
export const BUILTIN_IGNORE_WORDS = Object.freeze(['hold', 'placeholder', 'block', 'blocked', 'focus', 'focus time',
    'deep work', 'lunch', 'break', 'commute', 'travel', 'ooo', 'out of office', 'busy', 'tentative hold',
    'do not book', 'dnb', 'reminder', 'gym']);

/** Title words that mark a must-attend meeting (PRD §1 step 3), in PRD order. */
export const BUILTIN_IMPORTANT_WORDS = Object.freeze(['interview', 'client', 'customer', 'board', 'investor',
    'candidate', 'exec', 'review with', 'demo', 'pitch', 'contract', 'legal', 'offsite', '1:1', '1-1',
    'one on one']);

/** Location texts that are not a place to travel to (PRD §2). */
export const NOT_A_PLACE_WORDS = Object.freeze(['online', 'virtual', 'remote', 'tbd', 'tba', 'n/a', 'none', 'phone',
    'phone call', 'call', 'video call', 'zoom', 'zoom meeting', 'teams', 'teams meeting', 'microsoft teams',
    'microsoft teams meeting', 'google meet', 'meet', 'webex', 'hangout', 'google hangouts', 'whereby', 'jitsi',
    'goto meeting', 'gotomeeting', 'slack', 'slack huddle', 'huddle']);

// Marks a real matcher, so findWord cannot be handed an uncompiled list.
const COMPILED = Symbol('compiled word matcher');

function normalise(word) {
    return word.trim().replace(/\s+/g, ' ').toLowerCase();
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a word list once, for use with findWord(). Words are normalised
 * (trimmed, whitespace collapsed, lowercased), empty ones and duplicates are
 * dropped, and longer phrases are tried first so the most specific one wins.
 *
 * @param {string[]} builtin
 * @param {string[]} extra the owner's own words
 * @returns {import('./types.js').WordMatcher} opaque and frozen
 */
export function compileWords(builtin, extra) {
    const words = [];
    for (const raw of [...builtin, ...extra]) {
        const word = normalise(raw);
        if (word !== '' && !words.includes(word))
            words.push(word);
    }
    // Sorting is stable, so equal lengths keep list order, builtins first.
    const entries = words
        .toSorted((a, b) => b.length - a.length)
        .map(word => Object.freeze({
            word,
            regex: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu'),
        }));
    return Object.freeze({ [COMPILED]: true, entries: Object.freeze(entries) });
}

/**
 * The first list word, most specific first, that appears in `text` as a whole word.
 *
 * @param {import('./types.js').WordMatcher} matcher from compileWords()
 * @param {string} text
 * @returns {string|null} the normalised list word, or null
 * @throws {TypeError} when `matcher` did not come from compileWords()
 */
export function findWord(matcher, text) {
    if (typeof matcher !== 'object' || matcher === null || matcher[COMPILED] !== true)
        throw new TypeError('findWord: matcher must come from compileWords()');
    for (const { word, regex } of matcher.entries) {
        if (regex.test(text))
            return word;
    }
    return null;
}
