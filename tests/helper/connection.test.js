import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTION_STATES } from '../../extension/core/protocol.js';
import { sourceConnection } from '../../extension/helper/connection.js';

describe('a source\'s protocol connection value', () => {
    test('a source that is not remote has none, even offline and connected', () => {
        assert.equal(sourceConnection({ remote: false, online: false, statusName: 'CONNECTED' }), null);
    });

    test('a source of unknown remoteness has none', () => {
        assert.equal(sourceConnection({ remote: null, online: true, statusName: 'CONNECTED' }), null);
    });

    test('a remote source whose client is not online is offline, whatever its status', () => {
        assert.equal(sourceConnection({ remote: true, online: false, statusName: 'CONNECTED' }), 'offline');
    });

    test('each EDS status name maps to its protocol value', () => {
        const expected = {
            CONNECTED: 'connected',
            CONNECTING: 'connecting',
            DISCONNECTED: 'disconnected',
            AWAITING_CREDENTIALS: 'awaiting-credentials',
            SSL_FAILED: 'ssl-failed',
        };
        for (const [statusName, value] of Object.entries(expected))
            assert.equal(sourceConnection({ remote: true, online: true, statusName }), value, statusName);
    });

    test('a status name EDS may add later is unknown', () => {
        assert.equal(sourceConnection({ remote: true, online: true, statusName: 'SOMETHING_NEW' }), 'unknown');
    });

    test('a missing status name is unknown', () => {
        assert.equal(sourceConnection({ remote: true, online: true, statusName: null }), 'unknown');
    });

    test('every value it can give is one core accepts', () => {
        const names = ['CONNECTED', 'CONNECTING', 'DISCONNECTED', 'AWAITING_CREDENTIALS', 'SSL_FAILED', 'X', null];
        for (const statusName of names) {
            for (const online of [true, false])
                assert.ok(CONNECTION_STATES.includes(sourceConnection({ remote: true, online, statusName })));
        }
    });
});
