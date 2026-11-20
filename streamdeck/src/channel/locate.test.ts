import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeStrip } from "./decode";
import { findStripCandidates, readCells } from "./locate";
import { CELL_PX, GRID_CELLS, HEADER_CELLS, IDLE, MAX_FIELDS, cellOffset, type RawImage } from "./protocol";

type Triple = [number, number, number];
interface Vectors {
  header: Triple[];
  fields: { value: number; cells: [Triple, Triple] }[];
}

const vectors: Vectors = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "vectors", "channel-v2.json"),
    "utf8",
  ),
);

const idle: Triple = [IDLE.r, IDLE.g, IDLE.b];
/** The 15 cells of a full grid: header, the five vector fields, cell 14 idle. */
const fullGrid: Triple[] = [...vectors.header, ...vectors.fields.flatMap((f) => f.cells), idle];
const expectedValues = vectors.fields.map((f) => f.value);

/** Deterministic PRNG (mulberry32) so noise is stable between runs. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded background noise, per channel uniform in [lo, hi). The default is full-range noise. A
 * narrow mid-grey range (BUSY) is busy like a game scene but can never satisfy the finder's
 * bright/dark thresholds, so tests of the grid itself cannot hit a chance false match.
 */
const BUSY: [number, number] = [96, 160];
function noiseImage(width: number, height: number, seed: number, [lo, hi] = [0, 256]): RawImage {
  const rand = prng(seed);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = lo + Math.floor(rand() * (hi - lo));
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function solidImage(width: number, height: number, v: number): RawImage {
  const data = new Uint8Array(width * height * 4).fill(v);
  return { width, height, data };
}

/**
 * Paint the grid with its top-left pixel at (x, y): cell i is a 4x4 block at cellOffset(i), the
 * 1 px gaps keep the background. Pixels outside the image are clipped. With `blur`, the 12 border
 * pixels of each cell are blended 50 % with whatever was behind them (the gap color); the 2x2 center stays exact.
 */
function paintGrid(img: RawImage, x: number, y: number, blur = false, cells: Triple[] = fullGrid): void {
  cells.forEach((cell, i) => {
    const { dx: cx, dy: cy } = cellOffset(i);
    for (let dy = 0; dy < CELL_PX; dy++) {
      for (let dx = 0; dx < CELL_PX; dx++) {
        const px = x + cx + dx;
        const py = y + cy + dy;
        if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
        const o = (py * img.width + px) * 4;
        const isCenter = dx >= 1 && dx <= 2 && dy >= 1 && dy <= 2;
        const k = blur && !isCenter ? 0.5 : 1;
        for (let c = 0; c < 3; c++) img.data[o + c] = Math.round(cell[c] * k + img.data[o + c] * (1 - k));
        img.data[o + 3] = 255;
      }
    }
  });
}

/** White, black, magenta, then a white version cell: matches the finder, is not a valid header. */
const decoyHeader: Triple[] = [...vectors.header.slice(0, 3), [255, 255, 255]];

describe("grid locator", () => {
  it("finds the grid at (0,0)", () => {
    const img = noiseImage(200, 100, 1, BUSY);
    paintGrid(img, 0, 0);
    expect(findStripCandidates(img)).toEqual([{ x: 2, y: 2 }]);
  });

  it("finds the grid at (1700, 230) in a 2560x1440 image", () => {
    const img = noiseImage(2560, 1440, 2, BUSY);
    paintGrid(img, 1700, 230);
    const candidates = findStripCandidates(img);
    expect(candidates).toEqual([{ x: 1702, y: 232 }]);
    const cells = readCells(img, candidates[0], HEADER_CELLS + 2 * MAX_FIELDS);
    expect(decodeStrip(cells)?.fields).toEqual(expectedValues);
  });

  it("finds the grid near the bottom-right edge", () => {
    const img = noiseImage(2560, 1440, 3, BUSY);
    paintGrid(img, 2560 - 24, 1440 - 14);
    expect(findStripCandidates(img)).toEqual([{ x: 2538, y: 1428 }]);
  });

  it("returns exactly one candidate for a single valid grid, sharp or blurred", () => {
    for (const blur of [false, true]) {
      const img = noiseImage(200, 100, 8, BUSY);
      paintGrid(img, 8, 31, blur);
      expect(findStripCandidates(img)).toEqual([{ x: 10, y: 33 }]);
    }
  });

  it("refines to a pixel inside cell 0 even when only the 2x2 centers match", () => {
    // border pixels of the three header cells turn mid-grey: only the centers pass the thresholds
    const img = noiseImage(200, 100, 10, BUSY);
    paintGrid(img, 20, 40);
    for (const i of [0, 1, 2]) {
      for (let dy = 0; dy < CELL_PX; dy++) {
        for (let dx = 0; dx < CELL_PX; dx++) {
          if (dx >= 1 && dx <= 2 && dy >= 1 && dy <= 2) continue;
          const o = ((40 + dy) * img.width + 20 + cellOffset(i).dx + dx) * 4;
          img.data.fill(128, o, o + 3);
        }
      }
    }
    expect(findStripCandidates(img)).toEqual([{ x: 22, y: 42 }]);
  });

  it("returns no candidate on an image without the grid", () => {
    expect(findStripCandidates(solidImage(200, 100, 255))).toEqual([]);
    expect(findStripCandidates(noiseImage(200, 100, 4, BUSY))).toEqual([]);
  });

  it("rejects every candidate found in full-range noise", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const img = noiseImage(200, 100, seed);
      for (const c of findStripCandidates(img)) {
        expect(decodeStrip(readCells(img, c, HEADER_CELLS + 2 * MAX_FIELDS))).toBeNull();
      }
    }
  });

  it("lists a decoy above and left of the real grid first", () => {
    const img = noiseImage(200, 100, 9, BUSY);
    paintGrid(img, 2, 5, false, decoyHeader);
    paintGrid(img, 8, 31);
    const candidates = findStripCandidates(img);
    expect(candidates).toEqual([
      { x: 4, y: 7 },
      { x: 10, y: 33 },
    ]);
    const strips = candidates
      .map((c) => decodeStrip(readCells(img, c, HEADER_CELLS + 2 * MAX_FIELDS)))
      .filter((s) => s !== null);
    expect(strips).toHaveLength(1);
    expect(strips[0].fields).toEqual(expectedValues);
  });

  it("scans the whole image, not a corner", () => {
    const img = noiseImage(400, 300, 5, BUSY);
    paintGrid(img, 300, 250);
    expect(findStripCandidates(img)).toEqual([{ x: 302, y: 252 }]);
  });

  it("scans a full 2560x1440 noisy image in under 150 ms", () => {
    const img = noiseImage(2560, 1440, 11);
    const start = performance.now();
    findStripCandidates(img);
    const ms = performance.now() - start;
    console.log(`full 2560x1440 noisy scan: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(150);
  });

  it("readCells reads origin + cellOffset(i) for all 15 cells by default", () => {
    const img = noiseImage(60, 40, 6, BUSY);
    paintGrid(img, 10, 10);
    const cells = readCells(img, { x: 12, y: 12 });
    expect(cells).toHaveLength(GRID_CELLS);
    expect(cells.slice(0, 3)).toEqual([
      { r: 255, g: 255, b: 255 },
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 0, b: 255 },
    ]);
    expect(cells[5]).toEqual({ r: 0, g: 170, b: 170 }); // row 1, column 0 (second cell of field 0)
    expect(cells[14]).toEqual(IDLE);
  });

  it("readCells honours count", () => {
    const img = noiseImage(60, 40, 6, BUSY);
    paintGrid(img, 10, 10);
    expect(readCells(img, { x: 12, y: 12 }, HEADER_CELLS)).toHaveLength(HEADER_CELLS);
  });

  it("readCells stops at the first cell outside the image", () => {
    const img = noiseImage(30, 40, 7, BUSY);
    paintGrid(img, 0, 0);
    // columns sit at x = 12, 17, 22, 27, 32: the fifth is outside a 30 px wide image
    expect(readCells(img, { x: 12, y: 2 })).toHaveLength(4);
    expect(readCells(img, { x: 2, y: 40 })).toEqual([]);
  });
});
