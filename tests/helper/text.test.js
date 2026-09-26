import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseAddress, truncateDescription } from '../../extension/helper/text.js';

describe('address normalisation', () => {
    test('trims, strips an uppercase MAILTO: and lowercases', () => {
        assert.equal(normaliseAddress(' MAILTO:Bob@X.Test '), 'bob@x.test');
    });

    test('null gives the empty string', () => {
        assert.equal(normaliseAddress(null), '');
    });

    test('undefined gives the empty string', () => {
        assert.equal(normaliseAddress(undefined), '');
    });

    test('a non-mailto URI is kept, lowercased', () => {
        assert.equal(normaliseAddress('urn:uuid:ABC'), 'urn:uuid:abc');
    });
});

describe('description truncation', () => {
    test('a short text is unchanged', () => {
        assert.equal(truncateDescription('a'), 'a');
    });

    test('null gives the empty string', () => {
        assert.equal(truncateDescription(null), '');
    });

    test('undefined gives the empty string', () => {
        assert.equal(truncateDescription(undefined), '');
    });

    test('a text of exactly 32768 units is unchanged', () => {
        const text = 'x'.repeat(32768);
        assert.equal(truncateDescription(text), text);
    });

    test('a text of 32769 units is cut to 32768', () => {
        assert.equal(truncateDescription('x'.repeat(32769)).length, 32768);
    });

    test('a cut that would split a surrogate pair drops the high surrogate', () => {
        assert.equal(truncateDescription('x'.repeat(32767) + '😀' + 'y'), 'x'.repeat(32767));
    });

    test('a surrogate pair that fits whole is kept', () => {
        const out = truncateDescription('x'.repeat(32766) + '😀' + 'y');
        assert.equal(out.length, 32768);
        assert.ok(out.endsWith('😀'));
    });
});
