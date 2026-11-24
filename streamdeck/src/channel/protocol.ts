/** Channel protocol v2 constants and shared pixel types (pure TypeScript, no dependencies). */

export type RGB = { r: number; g: number; b: number };

/** RGBA, 4 bytes per pixel, row-major. */
export type RawImage = { width: number; height: number; data: Uint8Array };

/** The four levels a channel can take. */
export const LEVELS = [0, 85, 170, 255];
/** Largest distance (after normalization) between a channel and its nearest level. */
export const TOLERANCE = 30;
export const PROTOCOL_VERSION = 2;
/** Cell size in physical pixels. */
export const CELL_PX = 4;
/** White, black, marker, version. */
export const HEADER_CELLS = 4;
export const MAX_FIELDS = 5;
/** The minimap button draws its cells in a grid of this many columns and rows, row-major. */
export const GRID_COLS = 5;
export const GRID_ROWS = 3;
export const GRID_CELLS = GRID_COLS * GRID_ROWS;
/** Distance in physical pixels between two cell origins (cell plus its 1 px gap). */
export const CELL_PITCH = 5;
/** Colour of a grid cell with no field: more than TOLERANCE from every level, so it never decodes. */
export const IDLE: RGB = { r: 48, g: 48, b: 48 };

/** Offset in physical pixels of grid cell `i` from the grid's top-left corner. */
export function cellOffset(i: number): { dx: number; dy: number } {
  return { dx: (i % GRID_COLS) * CELL_PITCH, dy: Math.floor(i / GRID_COLS) * CELL_PITCH };
}
/** Minimum white - black distance, per channel, for a strip to be readable. */
export const MIN_CONTRAST = 100;
