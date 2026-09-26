import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { COMPACT_BELOW_HEIGHT, COMPACT_BELOW_WIDTH, takeoverSize } from '../../extension/ui/takeoverSize.js';

describe('takeover size class from the monitor (buttons always on screen)', () => {
    test('the thresholds', () => {
        assert.equal(COMPACT_BELOW_HEIGHT, 900);
        assert.equal(COMPACT_BELOW_WIDTH, 1200);
    });

    for (const [width, height, want] of [
        [1920, 1080, 'regular'],
        [1440, 900, 'regular'],
        [1200, 900, 'regular'],
        [1440, 899, 'compact'],
        [1280, 720, 'compact'],
        [1024, 768, 'compact'],
        [960, 540, 'compact'],
        [1199, 1200, 'compact'],
        [3840, 2160, 'regular'],
    ]) {
        test(`${width}x${height} is ${want}`, () => {
            assert.equal(takeoverSize({ width, height }), want);
        });
    }
});
