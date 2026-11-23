/** Channel protocol v1 constants and shared pixel types (pure TypeScript, no dependencies). */

export type RGB = { r: number; g: number; b: number };

/** RGBA, 4 bytes per pixel, row-major. */
export type RawImage = { width: number; height: number; data: Uint8Array };

/** The four levels a channel can take. */
export const LEVELS = [0, 85, 170, 255];
/** Largest distance (after normalization) between a channel and its nearest level. */
export const TOLERANCE = 30;
export const PROTOCOL_VERSION = 1;
/** Cell size in physical pixels. */
export const CELL_PX = 3;
/** White, black, marker, version. */
export const HEADER_CELLS = 4;
export const MAX_FIELDS = 4;
/** Minimum white - black distance, per channel, for a strip to be readable. */
export const MIN_CONTRAST = 100;
