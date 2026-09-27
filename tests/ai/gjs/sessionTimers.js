// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test-only probe: prints the libsoup timers of the Soup.Session that
// HttpTransport builds, as one JSON line {"timeout":n,"idleTimeout":n}.
//
//   gjs -m sessionTimers.js
import { HttpTransport } from '../../../extension/ai/transport.js';

const session = new HttpTransport()._session;
print(JSON.stringify({ timeout: session.timeout, idleTimeout: session.idle_timeout }));
