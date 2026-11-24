import { CELL_PITCH, CELL_PX, GRID_CELLS, cellOffset, type RGB, type RawImage } from "./protocol";

const BRIGHT_MIN = 160;
const DARK_MAX = 95;
/** Later matches closer than this (per axis) to a returned candidate belong to the same cell. */
const DEDUPE_PX = 3;

function pixel(img: RawImage, x: number, y: number): RGB {
  const o = (y * img.width + x) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2] };
}

/**
 * True when pixel (x, y) looks like the inside of cell 0: white there, black one pitch to the
 * right, magenta two pitches to the right. The caller keeps x + 2 * CELL_PITCH inside the image.
 */
function looksLikeGrid(d: Uint8Array, o: number): boolean {
  if (d[o] < BRIGHT_MIN || d[o + 1] < BRIGHT_MIN || d[o + 2] < BRIGHT_MIN) return false;
  const k = o + 4 * CELL_PITCH;
  if (d[k] > DARK_MAX || d[k + 1] > DARK_MAX || d[k + 2] > DARK_MAX) return false;
  const m = k + 4 * CELL_PITCH;
  return d[m] >= BRIGHT_MIN && d[m + 2] >= BRIGHT_MIN && d[m + 1] <= DARK_MAX;
}

/**
 * Rounded centroid of the matches in the CELL_PX x CELL_PX window starting at the first match
 * (x, y). The first row-major match of a clean cell is its top-left pixel, so the centroid lands
 * 2 px inside it: at least 1 px from the cell's edges, where blur and scaling disturb pixels.
 */
function refine(img: RawImage, x: number, y: number, maxX: number): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let wy = y; wy < y + CELL_PX && wy < img.height; wy++) {
    for (let wx = x; wx < x + CELL_PX && wx <= maxX; wx++) {
      if (looksLikeGrid(img.data, (wy * img.width + wx) * 4)) {
        sx += wx;
        sy += wy;
        n++;
      }
    }
  }
  return { x: Math.round(sx / n), y: Math.round(sy / n) };
}

/**
 * Coarse finder over the whole image: every candidate inside cell 0 of a grid, in row-major
 * order. The caller decides which area to pass. Only decodeStrip validates a candidate, so
 * callers try them in order and keep the first that decodes (a false candidate above or left of
 * the real grid must not hide it). Later matches within DEDUPE_PX of a returned candidate belong
 * to the same cell and are skipped.
 */
export function findStripCandidates(img: RawImage): { x: number; y: number }[] {
  const maxX = img.width - 1 - 2 * CELL_PITCH;
  const found: { x: number; y: number }[] = [];
  const d = img.data;
  for (let y = 0; y < img.height; y++) {
    let o = y * img.width * 4;
    for (let x = 0; x <= maxX; x++, o += 4) {
      // most pixels fail the first test: keep it inline, this loop visits every pixel of the image
      if (d[o] < BRIGHT_MIN || !looksLikeGrid(d, o)) continue;
      if (found.some((c) => Math.abs(c.x - x) <= DEDUPE_PX && Math.abs(c.y - y) <= DEDUPE_PX)) continue;
      found.push(refine(img, x, y, maxX));
    }
  }
  return found;
}

/** Read `count` grid cells at origin + cellOffset(i); stops at the first cell outside the image. */
export function readCells(img: RawImage, origin: { x: number; y: number }, count = GRID_CELLS): RGB[] {
  const cells: RGB[] = [];
  for (let i = 0; i < count; i++) {
    const { dx, dy } = cellOffset(i);
    const x = origin.x + dx;
    const y = origin.y + dy;
    if (x < 0 || x >= img.width || y < 0 || y >= img.height) break;
    cells.push(pixel(img, x, y));
  }
  return cells;
}
