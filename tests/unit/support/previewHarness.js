// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// One preview run with fake parts. Test support, not a test file. Import it after
// fixing process.env.TZ, since time formatting depends on the zone.
import { startPreview } from '../../../extension/preview/session.js';
import { EN, makeStore, makeFeed, makeAiClient } from './controllerHarness.js';

/**
 * Starts a run over the fake store, feed and AI clients of controllerHarness.js.
 *
 * `h.at(t)` sets the clock to t, then fires every live ticker in creation order.
 * The AI ticker comes first, because the verdict component makes it while it is built.
 * `h.log` records the parts' destroy() calls and 'onFinish', in order.
 * `h.readerCalls` records every reader method called, by name.
 *
 * @param {object} [p]
 * @param {object} [p.settings] merged over DEFAULT_SETTINGS
 * @param {import('../../../extension/core/types.js').StoredAiAnswers|null} [p.aiAnswers]
 * @param {Function} [p.aiClient] makes each AI client, (engine, h) → client
 * @param {'text'|'json'} [p.format]
 * @param {(h: object) => void} [p.beforeStart] runs after the fakes exist, before startPreview
 */
export function setupPreview({ settings = {}, aiAnswers = null, aiClient = makeAiClient, format = 'json', beforeStart } = {}) {
    const h = {
        now: EN, log: [], settings, seeds: null, aiAnswers,
        aiClients: [], tickers: [], progress: [], outcomes: [], readerCalls: [], feed: null,
    };
    h.store = makeStore(h);
    const reader = new Proxy(h.store.reader, {
        get(target, name) {
            const value = target[name];
            if (typeof value !== 'function')
                return value;
            return (...args) => {
                h.readerCalls.push(name);
                return value(...args);
            };
        },
    });
    beforeStart?.(h);
    h.run = startPreview({
        format,
        createStoreReader: onChange => {
            h.store.onChange = onChange;
            return reader;
        },
        createFeed: onUpdate => {
            const feed = makeFeed(onUpdate, h);
            if (h.initialSnapshot) {
                feed.snapshot = h.initialSnapshot;
                feed.acceptedAt = h.now;
            }
            return (h.feed = feed);
        },
        createAiClient: engine => {
            const c = aiClient(engine, h);
            h.aiClients.push(c);
            return c;
        },
        createTicker: onTick => {
            const ticker = {
                fire: onTick,
                destroyed: false,
                destroy: () => {
                    ticker.destroyed = true;
                    h.log.push('ticker.destroy');
                },
            };
            h.tickers.push(ticker);
            return ticker;
        },
        progress: line => h.progress.push(line),
        onFinish: outcome => {
            h.log.push('onFinish');
            h.outcomes.push(outcome);
        },
        now: () => h.now,
    });
    Object.defineProperty(h, 'client', { get: () => h.aiClients.at(-1) });
    h.at = t => {
        h.now = t;
        for (const ticker of [...h.tickers]) {
            if (!ticker.destroyed)
                ticker.fire();
        }
    };
    return h;
}
