// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test-only probe: for each chat URL, prints whether the Soup.Session that
// HttpTransport would post it through has no proxy resolver (direct), and that
// session's timeout, as one JSON line {"<url>":{"direct":bool,"timeout":n},...}.
//
//   gjs -m sessionProxy.js <url>...
import System from 'system';
import { HttpTransport } from '../../../extension/ai/transport.js';

const transport = new HttpTransport();
const seen = {};
for (const url of System.programArgs) {
    const session = transport._sessionFor(url);
    seen[url] = { direct: session.proxy_resolver === null, timeout: session.timeout };
}
print(JSON.stringify(seen));
