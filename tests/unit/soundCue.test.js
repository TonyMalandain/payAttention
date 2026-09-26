import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldPlaySound } from '../../extension/shell/soundCue.js';

const a = step => ({ key: 'occ:a|1', step });

describe('sound edge', () => {
    test('nothing, then step 3: plays', () => {
        assert.equal(shouldPlaySound(null, a(3)), true);
    });

    test('the same key and step on the next tick: silent', () => {
        assert.equal(shouldPlaySound(a(3), a(3)), false);
        assert.equal(shouldPlaySound(a(4), a(4)), false);
    });

    test('step 3 to step 4: plays', () => {
        assert.equal(shouldPlaySound(a(3), a(4)), true);
    });

    test('step 4, hidden, then step 4 again: plays', () => {
        assert.equal(shouldPlaySound(a(4), null), false);
        assert.equal(shouldPlaySound(null, a(4)), true);
    });

    test('steps 1 and 2 never play', () => {
        assert.equal(shouldPlaySound(null, a(2)), false);
        assert.equal(shouldPlaySound(a(1), a(2)), false);
        assert.equal(shouldPlaySound(null, a(1)), false);
    });

    test('a different key at step 3: plays', () => {
        assert.equal(shouldPlaySound(a(3), { key: 'occ:b|1', step: 3 }), true);
    });
});
