// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Which takeover size fits a monitor, so the action buttons are always fully on
// screen. Pure, with no imports, so it is unit-tested under Node.

/** A monitor shorter than this (logical px) gets the compact takeover. */
export const COMPACT_BELOW_HEIGHT = 900;
/** A monitor narrower than this gets it too: the second button row is wide. */
export const COMPACT_BELOW_WIDTH = 1200;

/**
 * @param {{width: number, height: number}} monitor logical size
 * @returns {'regular'|'compact'} used as the `payattention-takeover-<size>` style class
 */
export function takeoverSize(monitor) {
    return monitor.height < COMPACT_BELOW_HEIGHT || monitor.width < COMPACT_BELOW_WIDTH ? 'compact' : 'regular';
}
