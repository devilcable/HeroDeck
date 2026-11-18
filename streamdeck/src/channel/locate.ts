import { CELL_PX, type RGB, type RawImage } from "./protocol";

/** Search region, from the image's top-left: covers a title bar and window borders. */
export const SEARCH_W = 128;
export const SEARCH_H = 64;

const BRIGHT_MIN = 160;
const DARK_MAX = 95;

function pixel(img: RawImage, x: number, y: number): RGB {
  const o = (y * img.width + x) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2] };
}

/** True when pixel (x, y) looks like the center of cell 0: white, then black, then magenta. */
function looksLikeStrip(img: RawImage, x: number, y: number): boolean {
  const white = pixel(img, x, y);
  if (white.r < BRIGHT_MIN || white.g < BRIGHT_MIN || white.b < BRIGHT_MIN) return false;
  const black = pixel(img, x + CELL_PX, y);
  if (black.r > DARK_MAX || black.g > DARK_MAX || black.b > DARK_MAX) return false;
  const marker = pixel(img, x + 2 * CELL_PX, y);
  return marker.r >= BRIGHT_MIN && marker.b >= BRIGHT_MIN && marker.g <= DARK_MAX;
}

/** Rounded centroid of all matches in the 5x3 window starting at the first match (x, y). */
function refine(img: RawImage, x: number, y: number, maxX: number, maxY: number): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let wy = y; wy < y + CELL_PX && wy < maxY; wy++) {
    for (let wx = Math.max(0, x - 2); wx <= x + 2 && wx < maxX; wx++) {
      if (looksLikeStrip(img, wx, wy)) {
        sx += wx;
        sy += wy;
        n++;
      }
    }
  }
  return { x: Math.round(sx / n), y: Math.round(sy / n) };
}

/**
 * Coarse finder: every candidate center of cell 0, in row-major order. Only decodeStrip validates
 * a candidate, so callers try them in order and keep the first that decodes (a false candidate
 * above or left of the real strip must not hide it).
 * The first match of a cell can be a border pixel, so each candidate is refined to the rounded
 * centroid of the matches around it; later matches within 2 px of a returned candidate belong to
 * the same cell and are skipped.
 */
export function findStripCandidates(img: RawImage): { x: number; y: number }[] {
  const maxX = Math.min(SEARCH_W, img.width - 2 * CELL_PX);
  const maxY = Math.min(SEARCH_H, img.height);
  const found: { x: number; y: number }[] = [];
  for (let y = 0; y < maxY; y++) {
    for (let x = 0; x < maxX; x++) {
      if (!looksLikeStrip(img, x, y)) continue;
      if (found.some((c) => Math.abs(c.x - x) <= 2 && Math.abs(c.y - y) <= 2)) continue;
      found.push(refine(img, x, y, maxX, maxY));
    }
  }
  return found;
}

/** The first candidate from findStripCandidates, or null. */
export function findStrip(img: RawImage): { x: number; y: number } | null {
  return findStripCandidates(img)[0] ?? null;
}

/** Read the center pixel of `count` cells starting at `origin`; stops at the image edge. */
export function readCells(img: RawImage, origin: { x: number; y: number }, count: number): RGB[] {
  const cells: RGB[] = [];
  if (origin.y < 0 || origin.y >= img.height) return cells;
  for (let i = 0; i < count; i++) {
    const x = origin.x + i * CELL_PX;
    if (x < 0 || x >= img.width) break;
    cells.push(pixel(img, x, origin.y));
  }
  return cells;
}
