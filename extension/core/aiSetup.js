// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// What the Verdicts settings tell the owner about AI mode: the warning, where an
// address sends the invite, what a key status or a key means, and what a Test
// connection run means (interfaces.md §6.9). Every text is a constant: no address,
// model, key or engine reply is ever put into one.
import {
    aiEngine, normaliseEndpoint, endpointClass, isUsableEndpoint, mayCarryKey, normaliseModel, isSendableKey,
} from './aiEngine.js';
import {
    AI_PROTOCOL_VERSION, AI_FAILURE_CODES, formatAiShellMessage, parseAiHelperLine,
} from './aiProtocol.js';

/** The spec's warning, verbatim (PRD addendum 2026-09-27, D-020, D-030). */
export const AI_WARNING = 'In AI mode the whole invite is sent to this engine. With a cloud engine it leaves your computer. Passcodes and dial-in numbers are removed first, on a best-effort basis.';

/** The mode choices in the order the settings list them: index 0 "Rules", 1 "AI". */
export const VERDICT_SOURCES = Object.freeze([
    Object.freeze({ value: 'rules', label: 'Rules' }),
    Object.freeze({ value: 'ai', label: 'AI' }),
]);

/** The id of the one probe a Test connection run sends. */
export const PROBE_ID = 'test-connection';

/** Added to the engine's timeout for the Test connection watchdog, as the shell's watchdog (interfaces.md §6.5). */
export const PROBE_WATCHDOG_EXTRA_MS = 10000;

/** Shown when the keyring refused or could not be reached while saving a key. */
export const KEY_SAVE_FAILED = 'Could not save the key: the keyring refused it or could not be reached.';
/** Shown when the keyring refused or could not be reached while removing a key. */
export const KEY_REMOVE_FAILED = 'Could not remove the key: the keyring refused or could not be reached.';

/** What each failure code of the probe means to the owner. Frozen; exactly the keys of AI_FAILURE_CODES. */
export const FAILURE_TEXT = Object.freeze({
    'timeout': 'No: the engine did not answer in time.',
    'network': 'No: nothing answered at this address. Check that the engine is running and the address is right.',
    'tls': "No: the secure connection failed. The engine's certificate was not accepted.",
    'auth': 'No: the engine refused the key. Check the API key saved for this address.',
    'rate-limited': 'No: the engine says there were too many requests, or there is no quota left. Try again later.',
    'server': 'No: the engine reported an error of its own. Try again later.',
    'bad-reply': 'No: the engine answered, but not with a verdict. Check the model name, or try another model.',
    'bad-request': 'No: the AI helper refused the test request. Reinstall payAttention.',
    'no-key': 'No: the saved key could not be read, because your keyring is locked or unreachable. Unlock it and try again.',
    'config': 'No: the engine refused the request. Check the address and the model name.',
});

/**
 * @typedef {'saved'|'saved-locked'|'none'|'unavailable'|'no-address'} KeyState
 * @typedef {Readonly<{ok:boolean, text:string}>} ProbeResult
 */

const result = (ok, text) => Object.freeze({ ok, text });

const YES = result(true, 'Yes: the engine answered.');
const HELPER_BROKEN = result(false, 'No: the AI helper did not run correctly. Reinstall payAttention.');
const NO_ADDRESS = result(false, 'No: enter a usable address first.');
const NO_MODEL = result(false, 'No: enter a model name first.');
const FAILURE_RESULTS = Object.freeze(Object.fromEntries(AI_FAILURE_CODES.map(c => [c, result(false, FAILURE_TEXT[c])])));
const STOPPED = Object.freeze({
    'spawn-failed': result(false, 'No: the AI helper could not be started. Check that gjs is installed.'),
    'exited': HELPER_BROKEN,
    'timed-out': FAILURE_RESULTS.timeout,
});

const MODE_TEXT = Object.freeze({
    rules: 'The rules decide. Nothing is sent anywhere.',
    notSetUp: 'AI is not set up yet: enter a usable address and a model below. Until then the rules decide.',
    ai: 'The AI engine decides every meeting you can attend. If it cannot be reached, the rules decide.',
});

const ENDPOINT_TEXT = Object.freeze({
    invalid: 'This is not a usable address. Use one like http://127.0.0.1:11434/v1 or https://api.example.com/v1.',
    refused: 'Plain http:// is allowed only on this computer or your local network. Use https:// for this address.',
    loopback: 'On this computer: the invite does not leave it.',
    privateHttps: 'On your local network: the invite leaves your computer.',
    privateHttp: 'On your local network: the invite leaves your computer. A key is never sent over plain http:// to another computer.',
    public: 'On the internet: the invite leaves your computer.',
});

const KEY_TEXT = Object.freeze({
    noAddress: 'Enter a usable address first.',
    unavailable: 'Could not reach your keyring, so it is not known whether a key is saved.',
    none: 'No key saved for this address. A local engine such as Ollama needs none.',
    noneNotAllowed: 'No key. A key is never sent over plain http:// to another computer.',
    saved: 'A key is saved for this address.',
    savedLocked: 'A key is saved for this address, but your keyring is locked. Unlock it, or AI stays unavailable.',
    savedNotAllowed: 'A key is saved for this address, but it is never sent over plain http:// to another computer.',
});

const PASTE_FIRST = result(false, 'Paste a key first. To remove the saved key, use Remove.');
const UNUSABLE_KEY = result(false, 'This key cannot be used: it must be 1 to 4096 plain ASCII characters with no spaces.');
const PASTE_EDGES = /^[ \t\r\n]+|[ \t\r\n]+$/g;

/**
 * What the mode means right now.
 *
 * @param {{verdictSource:*, aiEndpoint:*, aiModel:*}} settings
 * @returns {string}
 */
export function describeMode(settings) {
    if (settings.verdictSource !== 'ai')
        return MODE_TEXT.rules;
    return aiEngine(settings) === null ? MODE_TEXT.notSetUp : MODE_TEXT.ai;
}

function endpointText(endpoint, usable) {
    if (endpoint === null)
        return ENDPOINT_TEXT.invalid;
    if (!usable)
        return ENDPOINT_TEXT.refused;
    switch (endpointClass(endpoint)) {
    case 'loopback':
        return ENDPOINT_TEXT.loopback;
    case 'private':
        return endpoint.startsWith('https:') ? ENDPOINT_TEXT.privateHttps : ENDPOINT_TEXT.privateHttp;
    default:
        return ENDPOINT_TEXT.public;
    }
}

/**
 * What an address means: where the invite goes, and whether a key may be saved for it.
 *
 * @param {*} address as typed or as stored
 * @returns {Readonly<{endpoint:string|null, usable:boolean, keyAllowed:boolean, text:string}>}
 *   endpoint: normaliseEndpoint(address) (null when it is not an address at all);
 *   usable: isUsableEndpoint(address); keyAllowed: mayCarryKey(address)
 */
export function describeEndpoint(address) {
    const endpoint = normaliseEndpoint(address);
    const usable = isUsableEndpoint(address);
    return Object.freeze({ endpoint, usable, keyAllowed: mayCarryKey(address), text: endpointText(endpoint, usable) });
}

/**
 * The key status line.
 *
 * @param {KeyState} state
 * @param {boolean} keyAllowed describeEndpoint(stored address).keyAllowed
 * @returns {string}
 */
export function describeKey(state, keyAllowed) {
    switch (state) {
    case 'no-address':
        return KEY_TEXT.noAddress;
    case 'unavailable':
        return KEY_TEXT.unavailable;
    case 'none':
        return keyAllowed ? KEY_TEXT.none : KEY_TEXT.noneNotAllowed;
    case 'saved-locked':
        return keyAllowed ? KEY_TEXT.savedLocked : KEY_TEXT.savedNotAllowed;
    default:
        return keyAllowed ? KEY_TEXT.saved : KEY_TEXT.savedNotAllowed;
    }
}

/**
 * A key as pasted: trimmed of leading and trailing space, tab, CR and LF, then checked with isSendableKey.
 *
 * @param {*} text
 * @returns {{ok:true, key:string} | {ok:false, text:string}} frozen
 */
export function checkKey(text) {
    if (typeof text !== 'string')
        return PASTE_FIRST;
    const key = text.replace(PASTE_EDGES, '');
    if (key === '')
        return PASTE_FIRST;
    return isSendableKey(key) ? Object.freeze({ ok: true, key }) : UNUSABLE_KEY;
}

/**
 * What to write to a fresh AI helper for Test connection, or why it cannot run.
 * Uses aiEngine({verdictSource:'ai', aiEndpoint: address, aiModel: model}), so the
 * mode switch does not matter and every value is validated exactly as the shell does.
 *
 * @param {*} address stored ai-endpoint
 * @param {*} model stored ai-model
 * @returns {{ok:true, input:string, watchdogMs:number} | {ok:false, result:ProbeResult}} frozen
 */
export function probeInput(address, model) {
    if (!isUsableEndpoint(address))
        return Object.freeze({ ok: false, result: NO_ADDRESS });
    if (normaliseModel(model) === null)
        return Object.freeze({ ok: false, result: NO_MODEL });
    const engine = aiEngine({ verdictSource: 'ai', aiEndpoint: address, aiModel: model });
    const input = formatAiShellMessage({
        type: 'configure', protocol: AI_PROTOCOL_VERSION,
        endpoint: engine.endpoint, model: engine.model, timeoutMs: engine.timeoutMs,
    }) + formatAiShellMessage({ type: 'probe', id: PROBE_ID });
    return Object.freeze({ ok: true, input, watchdogMs: engine.timeoutMs + PROBE_WATCHDOG_EXTRA_MS });
}

/**
 * What the helper's stdout lines mean so far. Lines after the second are never read.
 *
 * @param {string[]} lines every line read so far, in order, without the newline
 * @returns {ProbeResult|null} null while the answer is still to come
 */
export function probeResultFromLines(lines) {
    if (lines.length === 0)
        return null;
    const first = parseAiHelperLine(lines[0]);
    if (!first.ok || first.message.type !== 'hello')
        return HELPER_BROKEN;
    if (lines.length === 1)
        return null;
    const second = parseAiHelperLine(lines[1]);
    if (!second.ok || second.message.id !== PROBE_ID)
        return HELPER_BROKEN;
    if (second.message.type === 'verdict')
        return YES;
    if (second.message.type === 'failed')
        return FAILURE_RESULTS[second.message.code];
    return HELPER_BROKEN;
}

/**
 * The result when the helper stopped before probeResultFromLines gave one.
 *
 * @param {'spawn-failed'|'exited'|'timed-out'} how
 * @returns {ProbeResult}
 */
export function probeResultWhenStopped(how) {
    return STOPPED[how] ?? HELPER_BROKEN;
}
